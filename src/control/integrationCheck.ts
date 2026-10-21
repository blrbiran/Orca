import { createHash } from "node:crypto";
import { dispatchedEnv } from "./commandClient.js";
import { join } from "node:path";
import { z } from "zod";
import { taskContractSchema } from "../scheduler/planFile.js";
import type { AdmissionGate } from "./admissionGate.js";
import { isGroupArchived } from "./archivedMark.js";
import { applyWebCommand } from "./commandLedger.js";
import { ControlError } from "./errors.js";
import { ChildTimeout, gitChild, spawnRunChild } from "./integrationGit.js";
import { readGroupIntegration } from "./integrationScheme.js";
import { runningGroupIds } from "./orchestration.js";
import { readArchivedPlan } from "./queries.js";
import type { ControlStore } from "./store.js";
import { removeOwnPath, type WorkspaceRoots } from "./workspace.js";
import { readRepositorySettingsBody, writeRepositorySettingsBody, type RepositorySettingsBody } from "./workspaceSettings.js";
import type { CommandErrorBodyV1, CommandSuccessV1, RawAuthorityCommandV1 } from "./webProtocol.js";

/**
 * Kanban spec 2026-10-20 §7 layer 1 (human: "同意，但是不要那么频繁，并且可以关闭。有的代码跑test 太费时间"): after groups
 * that each passed their own checks were merged into the target, Orca runs the checks again on the merged result. Code
 * only (Rule 5). It runs when >= 2 groups landed since the last check AND (no group of the repository is running OR
 * >= 6 h passed since the last check). It runs the repository's integration command when one is set, else the landed
 * groups' required checks, in a detached worktree of the target's head. A red result opens a system debug group
 * (system debug task spec 2026-10-21). Off unless an owner turns it on (builder's call, §11 of the kanban spec: a fresh
 * worktree has no installed dependencies, so an unconfigured check could only go red and spend a debug run).
 */
export const INTEGRATION_CHECK_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Each command's bound: the slow suites the human named fit; a hung one cannot hold the check forever. */
export const INTEGRATION_CHECK_COMMAND_TIMEOUT_MS = 60 * 60 * 1000;
const TAIL_CHARS = 2048;

export type SetIntegrationCheckCommand = Extract<RawAuthorityCommandV1, { verb: "set-integration-check" }>;
export interface IntegrationCheckSetting { enabled: boolean; command: string | null }

export function readIntegrationCheckSetting(store: ControlStore, repoId: string): IntegrationCheckSetting {
  // Checks spec 2026-10-22 §4.1: the project layer's integration check (absent is off, no command).
  const layer = readRepositorySettingsBody(store, repoId)?.checks?.integrationCheck;
  return { enabled: layer?.enabled ?? false, command: layer?.command ?? null };
}

/** The setting under the repository settings body's revision (as the scheme and the workspace mode). */
export function applySetIntegrationCheck(
  deps: { store: ControlStore; admissionGate?: AdmissionGate; knownRepository(repoId: string): boolean },
  command: SetIntegrationCheckCommand,
): CommandSuccessV1 | CommandErrorBodyV1 {
  const release = deps.admissionGate?.enter();
  try {
    return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, {
      rawCommand: command,
      expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
      authorityChanged: false,
      projectionGroupIds: [],
      apply: (context) => {
        const target = context.rawCommand.target;
        if (target.kind !== "repository" || !deps.knownRepository(target.repoId)) throw new ControlError("control-target-not-allowed");
        const setting = context.effectiveCommand.payload as IntegrationCheckSetting;
        const current = readRepositorySettingsBody(deps.store, target.repoId);
        const before = readIntegrationCheckSetting(deps.store, target.repoId);
        if (before.enabled === setting.enabled && before.command === setting.command) throw new ControlError("no-op-command");
        const checks = { ...current?.checks, integrationCheck: { ...current?.checks?.integrationCheck, enabled: setting.enabled, command: setting.command } };
        const next: RepositorySettingsBody = { ...(current ?? { workspaceMode: "worktree" }), revision: context.nextCommandRevision, checks };
        writeRepositorySettingsBody(deps.store, target.repoId, next);
        return { status: 200, body: {
          schema: "orca-command-success-v1", commandId: context.rawCommand.commandId, actorId: context.rawCommand.actorId,
          verb: context.rawCommand.verb, target: context.rawCommand.target, commandRevision: context.nextCommandRevision, projectionSeq: null,
          effectivePayloadHash: context.effectivePayloadHash, authorityCommandHash: context.authorityCommandHash,
          result: { kind: "integration-check-set", repoId: target.repoId, integrationCheck: { enabled: setting.enabled, command: setting.command } },
        } };
      },
    }).body;
  } finally { release?.(); }
}

const lastSchema = z.object({
  state: z.enum(["running", "passed", "failed", "errored"]), at: z.number().int(), commit: z.string().nullable(), groups: z.array(z.string()),
  detail: z.string().nullable(), debugGroupId: z.string().nullable(),
}).strict();
const stateSchema = z.object({
  /** When the newest check started (store clock); null before the first. */
  lastAt: z.number().int().nullable(),
  /** Each landed group's integrated commit the last finished check covered. */
  covered: z.record(z.string(), z.string()),
  last: lastSchema.nullable(),
}).strict();
export type IntegrationCheckState = z.infer<typeof stateSchema>;
const EMPTY: IntegrationCheckState = { lastAt: null, covered: {}, last: null };
const metaKey = (repoId: string): string => `integration-check:${repoId}`;

/** The repository's check state (the `meta` table: a fact Orca records, not a setting anyone sets). */
export function readIntegrationCheckState(store: ControlStore, repoId: string): IntegrationCheckState {
  const row = store.db.prepare("SELECT value FROM meta WHERE key=?").get(metaKey(repoId));
  if (row === undefined) return EMPTY;
  const parsed = stateSchema.safeParse(JSON.parse(String(row.value)));
  if (!parsed.success) throw new ControlError("recovery-blocked", "integration-check-state-invalid");
  return parsed.data;
}
function writeState(store: ControlStore, repoId: string, state: IntegrationCheckState): void {
  store.transaction(() => store.db.prepare("INSERT INTO meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(metaKey(repoId), JSON.stringify(stateSchema.parse(state))));
}

export interface LandedGroup { groupId: string; integratedCommit: string; target: string; checks: string[] }

/** The repository's groups merged into a local target (the only delivery a check on the target can see). */
export function landedGroups(store: ControlStore, repoId: string): LandedGroup[] {
  return store.db.prepare("SELECT id, body FROM groups ORDER BY rowid").all().flatMap((row) => {
    const groupId = String(row.id);
    let body: Record<string, unknown>;
    try { body = JSON.parse(String(row.body)) as Record<string, unknown>; } catch { return []; }
    if ((body.plan as { repoId?: unknown } | undefined)?.repoId !== repoId || isGroupArchived(store, groupId)) return [];
    let integration: ReturnType<typeof readGroupIntegration>;
    try { integration = readGroupIntegration(body); } catch { return []; }
    if (integration === null || integration.scheme.delivery !== "local" || integration.integratedCommit === null) return [];
    let checks: string[] = [];
    try {
      checks = readArchivedPlan(store, groupId).plan.tasks.flatMap((task) => taskContractSchema.parse(JSON.parse(task.originalContractCanonicalJson)).verification.requiredChecks);
    } catch { /* a plan that cannot be read adds no check */ }
    return [{ groupId, integratedCommit: integration.integratedCommit, target: integration.scheme.target, checks }];
  });
}

/** §7 layer 1's trigger, by code: what to check now, or null. */
export function integrationCheckDue(store: ControlStore, repoId: string, now: number): { landed: LandedGroup[]; since: LandedGroup[] } | null {
  if (!readIntegrationCheckSetting(store, repoId).enabled) return null;
  const state = readIntegrationCheckState(store, repoId);
  if (state.last?.state === "running") return null;
  const landed = landedGroups(store, repoId);
  const since = landed.filter((group) => state.covered[group.groupId] !== group.integratedCommit);
  if (since.length < 2) return null;
  const repoOf = (groupId: string): unknown => { try { return readArchivedPlan(store, groupId).plan.repoId; } catch { return null; } };
  const idle = runningGroupIds(store).every((groupId) => repoOf(groupId) !== repoId);
  const longEnough = state.lastAt === null || now - state.lastAt >= INTEGRATION_CHECK_MIN_INTERVAL_MS;
  return idle || longEnough ? { landed, since } : null;
}

export interface CheckFailure { command: string; exit: string; tail: string }
export interface IntegrationCheckRun { commit: string; failures: CheckFailure[]; commands: string[] }

const tail = (text: string): string => text.length <= TAIL_CHARS ? text : text.slice(text.length - TAIL_CHARS);

/**
 * Run the commands in a detached worktree of `target`'s head under the driver's workspaces root (removed afterwards).
 * Each command as ccloop runs a required check (`sh -lc`, inherited environment); a timeout is a failure.
 * `personDir`: the panel's empty `dispatched-person` directory, the commands' ORCA_PERSON_DIR (CLI v2 spec §15.3, review M1).
 */
export async function runIntegrationCheck(repo: string, roots: WorkspaceRoots, repoId: string, target: string, commands: string[], at: number, personDir: string): Promise<IntegrationCheckRun> {
  const head = await gitChild(repo, ["rev-parse", "--verify", `refs/heads/${target}^{commit}`]);
  if (head.code !== 0) throw new Error(`integration-check: target ${target} unreadable: ${head.stderr.trim().slice(0, 200)}`);
  const commit = head.stdout.trim();
  const checkId = `integration-check-${createHash("sha256").update(repoId).digest("hex").slice(0, 12)}-${at}`;
  const path = join(roots.workspacesRoot, checkId);
  const added = await gitChild(repo, ["worktree", "add", "--detach", path, commit]);
  if (added.code !== 0) throw new Error(`integration-check: worktree: ${added.stderr.trim().slice(0, 200)}`);
  const failures: CheckFailure[] = [];
  try {
    for (const command of commands) {
      try {
        const answer = await spawnRunChild("sh", ["-lc", command], { cwd: path, timeoutMs: INTEGRATION_CHECK_COMMAND_TIMEOUT_MS, inheritEnv: true, env: dispatchedEnv({ runId: checkId, personDir }) }); // CLI v2 spec §15.3-§15.4 (review M1)
        if (answer.code !== 0) failures.push({ command, exit: String(answer.code), tail: tail(`${answer.stdout}\n${answer.stderr}`.trim()) });
      } catch (error) {
        if (!(error instanceof ChildTimeout)) throw error;
        failures.push({ command, exit: `timeout ${INTEGRATION_CHECK_COMMAND_TIMEOUT_MS} ms`, tail: "" });
      }
    }
  } finally {
    await removeOwnPath(repo, roots, path).catch(() => undefined);
  }
  return { commit, failures, commands };
}

/** Record that a check started (so a second pass does not start another), and how it ended. */
export function recordIntegrationCheckStarted(store: ControlStore, repoId: string, at: number, groups: string[]): void {
  const state = readIntegrationCheckState(store, repoId);
  writeState(store, repoId, { ...state, lastAt: at, last: { state: "running", at, commit: null, groups, detail: null, debugGroupId: null } });
}
export function recordIntegrationCheckEnded(store: ControlStore, repoId: string, landed: LandedGroup[], last: z.infer<typeof lastSchema>): void {
  const state = readIntegrationCheckState(store, repoId);
  // An errored check (no worktree, no target) covers nothing: the same groups are checked next time.
  const covered = last.state === "errored" ? state.covered : { ...state.covered, ...Object.fromEntries(landed.map((group) => [group.groupId, group.integratedCommit])) };
  writeState(store, repoId, { ...state, covered, last });
}

/** A check that was running when Orca stopped never ends: the next start sees `running` with no process and forgets it. */
export function forgetInterruptedIntegrationCheck(store: ControlStore, repoId: string): void {
  const state = readIntegrationCheckState(store, repoId);
  if (state.last?.state === "running") writeState(store, repoId, { ...state, last: { ...state.last, state: "errored", detail: "interrupted: Orca stopped while it ran" } });
}

/** The facts a red check gives its debug task (system debug task spec §2): which commands failed, their exit and output tail. */
export function integrationCheckFacts(run: IntegrationCheckRun, groups: string[], target: string): string[] {
  return [
    `the target ${target} at ${run.commit}, after groups ${groups.join(", ")} were merged into it, fails these checks:`,
    ...run.failures.map((failure) => `\`${failure.command}\` exited ${failure.exit}${failure.tail === "" ? "" : `; the end of its output:\n${failure.tail}`}`.slice(0, 4096)),
  ].slice(0, 32);
}
