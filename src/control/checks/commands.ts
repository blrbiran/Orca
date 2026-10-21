import type { AdmissionGate } from "../admissionGate.js";
import { canonicalBytes } from "../canonicalJson.js";
import { applyWebCommand, type WebCommandContext } from "../commandLedger.js";
import { ControlError } from "../errors.js";
import { readOrchestrationSettings, writeOrchestrationSettings } from "../orchestration.js";
import type { ControlStore } from "../store.js";
import { readUsageCalendar } from "../usageCalendar.js";
import type { CommandErrorBodyV1, CommandSuccessV1, RawAuthorityCommandV1 } from "../webProtocol.js";
import { readRepositorySettingsBody, writeRepositorySettingsBody } from "../workspaceSettings.js";
import { validateSchedule } from "./cron.js";
import { projectTargets } from "./pass.js";
import { BUILTIN_CHECKS } from "./settings.js";
import { MAX_SCHEDULED_CHECKS, type GlobalChecksLayer, type ScheduledCheck } from "./settingsSchema.js";
import { EMPTY_CHECK_STATE, readCheckState, writeCheckState } from "./state.js";
import { validateTrigger } from "./trigger.js";

/**
 * Checks spec 2026-10-22 §2.4, §4, §5.4: the person's check commands. Settings write one layer -- the project's
 * (`repository_settings`, its revision) or the global one (`@orchestration`, its revision) -- and every value is checked
 * by code on write (Rule 5): triggers and crons against their bounds and the panel's time zone, the scheduled-check
 * limit per layer, and the global locks (a project value may only tighten a locked field). Run-now and resume write the
 * check's state only; the settings revision does not move.
 */
type Verb = "set-check-settings" | "set-scheduled-check" | "set-check-locks" | "run-check-now" | "resume-check";
export type CheckCommand<V extends Verb> = Extract<RawAuthorityCommandV1, { verb: V }>;
export interface CheckCommandDeps { store: ControlStore; admissionGate?: AdmissionGate; knownRepository(repoId: string): boolean }
type Result = Extract<CommandSuccessV1["result"], { kind: "check-settings-set" | "scheduled-check-set" | "check-locks-set" | "check-run-requested" | "check-resumed" }>;

function run<C extends RawAuthorityCommandV1>(deps: CheckCommandDeps, command: C, apply: (context: WebCommandContext, payload: C["payload"]) => { result: Result; moved: boolean }): CommandSuccessV1 | CommandErrorBodyV1 {
  const release = deps.admissionGate?.enter();
  try {
    return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, {
      rawCommand: command,
      expand: () => ({ ...command, schema: "orca-authority-command-v1" }) as never,
      authorityChanged: false,
      projectionGroupIds: [],
      apply: (context) => {
        const target = context.rawCommand.target;
        if (target.kind === "repository" && !deps.knownRepository(target.repoId)) throw new ControlError("control-target-not-allowed");
        const { result, moved } = apply(context, context.effectiveCommand.payload as C["payload"]);
        return { status: 200, body: {
          schema: "orca-command-success-v1", commandId: context.rawCommand.commandId, actorId: context.rawCommand.actorId,
          verb: context.rawCommand.verb, target: context.rawCommand.target,
          commandRevision: moved ? context.nextCommandRevision : context.currentCommandRevision, projectionSeq: null,
          effectivePayloadHash: context.effectivePayloadHash, authorityCommandHash: context.authorityCommandHash, result,
        } };
      },
    }).body;
  } finally { release?.(); }
}

/** The layer a settings command writes, and its writer under the command's next revision. */
function layerOf(store: ControlStore, target: RawAuthorityCommandV1["target"]): { repoId: string | null; layer: GlobalChecksLayer; write(next: GlobalChecksLayer, revision: number): void } {
  if (target.kind === "orchestration") {
    const settings = readOrchestrationSettings(store);
    return {
      repoId: null, layer: settings.checks ?? {},
      write: (next, revision) => {
        const { checks: _old, ...rest } = settings;
        writeOrchestrationSettings(store, Object.keys(next).length === 0 ? rest : { ...rest, checks: next }, revision);
      },
    };
  }
  if (target.kind !== "repository") throw new ControlError("control-target-not-allowed");
  const current = readRepositorySettingsBody(store, target.repoId);
  return {
    repoId: target.repoId, layer: current?.checks ?? {},
    write: (next, revision) => {
      const { checks: _old, ...rest } = current ?? { workspaceMode: "worktree" as const };
      // The project layer never carries locks (§4.2); its schema refuses them.
      writeRepositorySettingsBody(store, target.repoId, Object.keys(next).length === 0 ? { ...rest, revision } : { ...rest, revision, checks: next });
    },
  };
}
const same = (a: unknown, b: unknown): boolean => canonicalBytes(a ?? null).equals(canonicalBytes(b ?? null));
const KEY = { "integration-check": "integrationCheck", "model-review": "modelReview" } as const;

/** §4.1, §4.2: write and clear one kind's fields in one layer. */
export function applySetCheckSettings(deps: CheckCommandDeps, command: CheckCommand<"set-check-settings">): CommandSuccessV1 | CommandErrorBodyV1 {
  return run(deps, command, (context, payload) => {
    const { repoId, layer, write } = layerOf(deps.store, context.rawCommand.target);
    const set = payload.set as Record<string, unknown>;
    if (set.trigger !== undefined) validateTrigger(set.trigger, readUsageCalendar(deps.store).timeZone);
    if (repoId !== null) {
      const global = readOrchestrationSettings(deps.store).checks ?? {};
      const locks = global.locks ?? [];
      if (payload.kind === "integration-check" && locks.includes("integrationCheck.command") && typeof payload.set.command === "string"
        && payload.set.command !== (global.integrationCheck?.command ?? BUILTIN_CHECKS["integration-check"].command)) {
        throw new ControlError("check-setting-locked", "integrationCheck.command");
      }
      if (payload.kind === "model-review" && locks.includes("modelReview.budgetTokens") && payload.set.budgetTokens !== undefined
        && payload.set.budgetTokens > (global.modelReview?.budgetTokens ?? BUILTIN_CHECKS["model-review"].budgetTokens)) {
        throw new ControlError("check-setting-locked", "modelReview.budgetTokens");
      }
    }
    const key = KEY[payload.kind];
    const kindLayer: Record<string, unknown> = { ...(layer[key] ?? {}), ...set };
    for (const field of payload.clear) delete kindLayer[field];
    const next: GlobalChecksLayer = { ...layer };
    if (Object.keys(kindLayer).length === 0) delete next[key]; else (next as Record<string, unknown>)[key] = kindLayer;
    if (same(next, layer)) throw new ControlError("no-op-command");
    write(next, context.nextCommandRevision);
    return { result: { kind: "check-settings-set", repoId, checks: next }, moved: true };
  });
}

/** §2.4: add, replace (by id) or remove one scheduled check of a layer; at most 8 per layer. */
export function applySetScheduledCheck(deps: CheckCommandDeps, command: CheckCommand<"set-scheduled-check">): CommandSuccessV1 | CommandErrorBodyV1 {
  return run(deps, command, (context, payload) => {
    const { repoId, layer, write } = layerOf(deps.store, context.rawCommand.target);
    const current = layer.scheduled ?? [];
    let scheduled: ScheduledCheck[];
    if ("remove" in payload) {
      if (!current.some((entry) => entry.id === payload.id)) throw new ControlError("no-op-command");
      scheduled = current.filter((entry) => entry.id !== payload.id);
    } else {
      validateSchedule(payload.cron, readUsageCalendar(deps.store).timeZone);
      const entry: ScheduledCheck = { id: payload.id, kind: payload.kind, cron: payload.cron, enabled: payload.enabled, params: {} };
      const at = current.findIndex((other) => other.id === payload.id);
      if (at >= 0 && same(current[at], entry)) throw new ControlError("no-op-command");
      if (at < 0 && current.length >= MAX_SCHEDULED_CHECKS) throw new ControlError("check-schedule-limit", `${current.length} of ${MAX_SCHEDULED_CHECKS}`);
      scheduled = at >= 0 ? current.map((other, i) => (i === at ? entry : other)) : [...current, entry];
    }
    const next: GlobalChecksLayer = { ...layer, scheduled };
    if (scheduled.length === 0) delete next.scheduled;
    write(next, context.nextCommandRevision);
    return { result: { kind: "scheduled-check-set", repoId, scheduled }, moved: true };
  });
}

/** §4.2: the global layer's whole lock list (an admin act; a repository target is refused). */
export function applySetCheckLocks(deps: CheckCommandDeps, command: CheckCommand<"set-check-locks">): CommandSuccessV1 | CommandErrorBodyV1 {
  return run(deps, command, (context, payload) => {
    if (context.rawCommand.target.kind !== "orchestration") throw new ControlError("control-target-not-allowed");
    const locks = [...payload.locks].sort();
    const { layer, write } = layerOf(deps.store, context.rawCommand.target);
    if (same(locks, [...(layer.locks ?? [])].sort())) throw new ControlError("no-op-command");
    const next: GlobalChecksLayer = { ...layer, locks };
    if (locks.length === 0) delete next.locks;
    write(next, context.nextCommandRevision);
    return { result: { kind: "check-locks-set", locks }, moved: true };
  });
}

function repositoryTargets(store: ControlStore, target: RawAuthorityCommandV1["target"]): { repoId: string; targets: string[] } {
  if (target.kind !== "repository") throw new ControlError("control-target-not-allowed");
  return { repoId: target.repoId, targets: projectTargets(store, target.repoId) };
}

/**
 * §2.4 "Run now": a pending run on every target of the kind; the next check pass starts it whatever the trigger says,
 * while paused too, but still after the in-flight run and only over a non-empty range (else `skipped: nothing new`).
 */
export function applyRunCheckNow(deps: CheckCommandDeps, command: CheckCommand<"run-check-now">): CommandSuccessV1 | CommandErrorBodyV1 {
  return run(deps, command, (context, { kind }) => {
    const { repoId, targets } = repositoryTargets(deps.store, context.rawCommand.target);
    if (targets.length === 0) throw new ControlError("control-argument-invalid", "the project has no local target branch to check");
    const pendingRun = { commandId: context.rawCommand.commandId, at: deps.store.now() };
    for (const target of targets) writeCheckState(deps.store, repoId, kind, target, { ...(readCheckState(deps.store, repoId, kind, target) ?? EMPTY_CHECK_STATE), pendingRun });
    return { result: { kind: "check-run-requested", repoId, checkKind: kind, targets }, moved: false };
  });
}

/** §5.4: clear the failure-streak pause of the kind on every paused target; nothing paused is a no-op. */
export function applyResumeCheck(deps: CheckCommandDeps, command: CheckCommand<"resume-check">): CommandSuccessV1 | CommandErrorBodyV1 {
  return run(deps, command, (context, { kind }) => {
    const { repoId } = repositoryTargets(deps.store, context.rawCommand.target);
    const paused = deps.store.db.prepare("SELECT target FROM check_state WHERE repo_id=? AND kind=? ORDER BY target").all(repoId, kind)
      .map((row) => String(row.target)).filter((target) => readCheckState(deps.store, repoId, kind, target)?.paused === true);
    if (paused.length === 0) throw new ControlError("no-op-command");
    for (const target of paused) writeCheckState(deps.store, repoId, kind, target, { ...readCheckState(deps.store, repoId, kind, target)!, paused: false, failureStreak: 0 });
    return { result: { kind: "check-resumed", repoId, checkKind: kind, targets: paused }, moved: false };
  });
}
