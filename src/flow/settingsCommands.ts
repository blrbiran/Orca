/**
 * Flow engine spec §11.2 (S1 §4.4 shape; plan Task 12, C18): the person's flow settings commands. `set-flow-settings`
 * writes one layer -- the project's (`repository_settings`, its revision) or the global one (`@orchestration`, its
 * revision); `set-flow-locks` writes the global lock list (an admin act; a project-layer lock is refused). Both are
 * human-only. Every value is checked by code on write (Rule 5):
 *
 * - `irreversible: apply-flag` is refused from every channel in phase 1 (`flow-setting-needs-person-token`: it needs CLI
 *   v2's person token, §11.2 [BC-B5]);
 * - under a global lock a project value looser than the global one is refused `flow-setting-locked`, naming the lock.
 */
import type { AdmissionGate } from "../control/admissionGate.js";
import { canonicalBytes } from "../control/canonicalJson.js";
import { applyWebCommand, type WebCommandContext } from "../control/commandLedger.js";
import { ControlError } from "../control/errors.js";
import { readOrchestrationSettings, writeOrchestrationSettings } from "../control/orchestration.js";
import type { ControlStore } from "../control/store.js";
import type { CommandErrorBodyV1, CommandSuccessV1, RawAuthorityCommandV1 } from "../control/webProtocol.js";
import { readRepositorySettingsBody, writeRepositorySettingsBody } from "../control/workspaceSettings.js";
import { BUILTIN_LEVELS, BUILTIN_TOKENS_PER_RUN, settingNotLooser } from "./settings.js";
import { FLOW_EFFECT_CLASSES, type FlowsLayer, type FlowSettingField, type GlobalFlowsLayer } from "./settingsSchema.js";
import { FlowRefusal } from "./kernel.js";
import { checkParamValue } from "./params.js";
import { BUILTIN_ROOT, loadBuiltin, TEMPLATE_FILE } from "./template/load.js";
import { existsSync } from "node:fs";
import { join } from "node:path";

type Verb = "set-flow-settings" | "set-flow-locks";
export type FlowSettingsCommand<V extends Verb> = Extract<RawAuthorityCommandV1, { verb: V }>;
export interface FlowSettingsDeps { store: ControlStore; admissionGate?: AdmissionGate; knownRepository(repoId: string): boolean; builtinRoot?: string }
type Result = Extract<CommandSuccessV1["result"], { kind: "flow-settings-set" | "flow-locks-set" }>;

export const FLOW_SETTING_LOCKED = "flow-setting-locked";
export const FLOW_SETTING_NEEDS_PERSON_TOKEN = "flow-setting-needs-person-token";

function run<C extends RawAuthorityCommandV1>(deps: FlowSettingsDeps, command: C, apply: (context: WebCommandContext, payload: C["payload"]) => Result): CommandSuccessV1 | CommandErrorBodyV1 {
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
        const result = apply(context, context.effectiveCommand.payload as C["payload"]);
        return { status: 200, body: {
          schema: "orca-command-success-v1", commandId: context.rawCommand.commandId, actorId: context.rawCommand.actorId,
          verb: context.rawCommand.verb, target: context.rawCommand.target, commandRevision: context.nextCommandRevision, projectionSeq: null,
          effectivePayloadHash: context.effectivePayloadHash, authorityCommandHash: context.authorityCommandHash, result,
        } };
      },
    }).body;
  } finally { release?.(); }
}

/** The layer a command writes and its writer under the command's next revision. */
function layerOf(store: ControlStore, target: RawAuthorityCommandV1["target"]): { repoId: string | null; layer: GlobalFlowsLayer; write(next: GlobalFlowsLayer, revision: number): void } {
  if (target.kind === "orchestration") {
    const settings = readOrchestrationSettings(store);
    return {
      repoId: null, layer: settings.flows ?? {},
      write: (next, revision) => {
        const { flows: _old, ...rest } = settings;
        writeOrchestrationSettings(store, Object.keys(next).length === 0 ? rest : { ...rest, flows: next }, revision);
      },
    };
  }
  if (target.kind !== "repository") throw new ControlError("control-target-not-allowed");
  const current = readRepositorySettingsBody(store, target.repoId);
  return {
    repoId: target.repoId, layer: current?.flows ?? {},
    write: (next, revision) => {
      const { flows: _old, ...rest } = current ?? { workspaceMode: "worktree" as const };
      writeRepositorySettingsBody(store, target.repoId, Object.keys(next).length === 0 ? { ...rest, revision } : { ...rest, revision, flows: next as FlowsLayer });
    },
  };
}
const same = (a: unknown, b: unknown): boolean => canonicalBytes(a ?? null).equals(canonicalBytes(b ?? null));

/** Drop empty nested objects, so a cleared field leaves no `{}` behind. */
function tidy(layer: GlobalFlowsLayer): GlobalFlowsLayer {
  const out: Record<string, unknown> = { ...layer };
  // A template with no preset left is dropped, then an empty paramDefaults with it.
  if (out.paramDefaults !== undefined) out.paramDefaults = Object.fromEntries(Object.entries(out.paramDefaults as Record<string, object>).filter(([, values]) => Object.keys(values).length > 0));
  for (const key of ["effects", "budgets", "roles", "paramDefaults"] as const) if (out[key] !== undefined && Object.keys(out[key] as object).length === 0) delete out[key];
  return out as GlobalFlowsLayer;
}

/**
 * Gaps spec §8.2: a preset for a built-in template is checked against its param's type now (an `image` by its shape:
 * the file is read only at start, §16); a preset for any other template is checked at start.
 */
function presetRefusal(builtinRoot: string | undefined, presets: NonNullable<FlowsLayer["paramDefaults"]>): string | null {
  for (const [templateId, values] of Object.entries(presets)) {
    let declared: NonNullable<ReturnType<typeof loadBuiltin>["template"]["params"]>;
    // Only "no such built-in" defers the check to start; a built-in that fails to load is refused by name.
    if (!existsSync(join(builtinRoot ?? BUILTIN_ROOT, templateId, TEMPLATE_FILE))) continue;
    try { declared = loadBuiltin(templateId, builtinRoot).template.params ?? {}; }
    catch (error) { throw new ControlError("flow-template-invalid", (error as Error).message); }
    for (const [paramId, value] of Object.entries(values)) {
      const param = declared[paramId];
      if (param === undefined) return `${templateId}.${paramId}: not a parameter of the template`;
      try { checkParamValue(paramId, param, value); }
      catch (error) { if (error instanceof FlowRefusal) return `${templateId}.${paramId}: ${error.detail}`; throw error; }
    }
  }
  return null;
}

/** The project value a global lock refuses, by the lock's path; null when none. */
function lockRefusal(set: FlowsLayer, global: GlobalFlowsLayer): string | null {
  const locks = global.locks ?? [];
  for (const cls of FLOW_EFFECT_CLASSES) {
    const mine = set.effects?.[cls];
    if (mine !== undefined && locks.includes(`effects.${cls}`) && !settingNotLooser(mine, global.effects?.[cls] ?? BUILTIN_LEVELS[cls])) return `effects.${cls}`;
  }
  const tokens = set.budgets?.tokensPerRun;
  if (tokens !== undefined && locks.includes("budgets.tokensPerRun") && tokens > (global.budgets?.tokensPerRun ?? BUILTIN_TOKENS_PER_RUN)) return "budgets.tokensPerRun";
  const sources = set.allowedSkillSources;
  if (sources !== undefined && locks.includes("allowedSkillSources") && global.allowedSkillSources !== undefined && !sources.every((s) => global.allowedSkillSources!.includes(s))) return "allowedSkillSources";
  return null;
}

/** §11.2: write and clear fields of one layer. */
export function applySetFlowSettings(deps: FlowSettingsDeps, command: FlowSettingsCommand<"set-flow-settings">): CommandSuccessV1 | CommandErrorBodyV1 {
  return run(deps, command, (context, payload) => {
    const { repoId, layer, write } = layerOf(deps.store, context.rawCommand.target);
    const set = payload.set as FlowsLayer;
    // Phase 1 [BC-B5]: irreversible apply-flag needs the person token CLI v2 §15 brings; no channel has it yet.
    if (set.effects?.irreversible === "apply-flag") throw new ControlError(FLOW_SETTING_NEEDS_PERSON_TOKEN, "effects.irreversible");
    if (repoId !== null) {
      const locked = lockRefusal(set, readOrchestrationSettings(deps.store).flows ?? {});
      if (locked !== null) throw new ControlError(FLOW_SETTING_LOCKED, locked);
    }
    if (set.paramDefaults !== undefined) {
      const refused = presetRefusal(deps.builtinRoot, set.paramDefaults);
      if (refused !== null) throw new ControlError("flow-param-invalid", refused);
    }
    const next: Record<string, unknown> = { ...layer };
    for (const [key, value] of Object.entries(set)) {
      if (key === "paramDefaults") {
        // Per template, per param: a preset set for one param leaves the others of that template as they were.
        const merged: Record<string, Record<string, unknown>> = { ...(layer.paramDefaults ?? {}) };
        for (const [templateId, values] of Object.entries(value as Record<string, Record<string, unknown>>)) merged[templateId] = { ...(merged[templateId] ?? {}), ...values };
        next[key] = merged;
        continue;
      }
      next[key] = (key === "effects" || key === "budgets" || key === "roles") ? { ...(layer[key] ?? {}), ...(value as object) } : value;
    }
    for (const field of payload.clear as string[]) {
      const [head, tail, param] = field.split(".") as [string, string | undefined, string | undefined];
      // Gaps spec §8.2, §13: `paramDefaults.<template>.<param>` removes that one preset; tidy drops an emptied template.
      if (param !== undefined) {
        const templates = next[head] as Record<string, Record<string, unknown>> | undefined;
        if (templates?.[tail!] !== undefined) { const values = { ...templates[tail!] }; delete values[param]; next[head] = { ...templates, [tail!]: values }; }
      } else if (tail === undefined) delete next[head];
      else if (next[head] !== undefined) { const inner = { ...(next[head] as Record<string, unknown>) }; delete inner[tail]; next[head] = inner; }
    }
    const tidied = tidy(next as GlobalFlowsLayer);
    if (same(tidied, layer)) throw new ControlError("no-op-command");
    write(tidied, context.nextCommandRevision);
    return { kind: "flow-settings-set", repoId, flows: tidied };
  });
}

/** §11.2: the global layer's whole lock list (an admin act); a project-layer lock is refused. */
export function applySetFlowLocks(deps: FlowSettingsDeps, command: FlowSettingsCommand<"set-flow-locks">): CommandSuccessV1 | CommandErrorBodyV1 {
  return run(deps, command, (context, payload) => {
    if (context.rawCommand.target.kind !== "orchestration") throw new ControlError("control-target-not-allowed", "flow locks live in the global layer only");
    const locks = [...payload.locks].sort();
    const { layer, write } = layerOf(deps.store, context.rawCommand.target);
    if (same(locks, [...(layer.locks ?? [])].sort())) throw new ControlError("no-op-command");
    const next: GlobalFlowsLayer = { ...layer, locks };
    if (locks.length === 0) delete next.locks;
    write(next, context.nextCommandRevision);
    return { kind: "flow-locks-set", locks };
  });
}
