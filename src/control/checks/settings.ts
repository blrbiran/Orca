import { z } from "zod";
import { readOrchestrationSettings } from "../orchestration.js";
import type { ControlStore } from "../store.js";
import { readRepositorySettingsBody } from "../workspaceSettings.js";
import { LOCKABLE_PATHS, scheduledCheckSchema, type ChecksLayer, type GlobalChecksLayer, type LockablePath, type ScheduledCheck } from "./settingsSchema.js";
import { checkStateSchema, listCheckStates } from "./state.js";
import { BUILTIN_TRIGGERS, triggerSchema, type Trigger } from "./trigger.js";

/**
 * Checks spec 2026-10-22 §4.1–§4.3: the effective check settings, field by field project > global > built-in, each with
 * the layer it came from and whether a global lock binds it. Locks (§4.2) only tighten: under a lock a project
 * `budgetTokens` above the global one, or a project `command` that is neither absent, null nor the global one, is
 * ignored and the global value is shown instead.
 */
export type Source = "project" | "global" | "builtin";
export interface Sourced<T> { value: T; source: Source; lockedBy: "global" | null }
export interface EffectiveChecks {
  kinds: {
    "integration-check": { enabled: Sourced<boolean>; trigger: Sourced<Trigger>; command: Sourced<string | null> };
    "model-review": { enabled: Sourced<boolean>; trigger: Sourced<Trigger>; budgetTokens: Sourced<number>; maxGroupsPerReview: Sourced<number> };
  };
  scheduled: Array<Sourced<ScheduledCheck> & { scope: "project" | "global" }>;
  locks: LockablePath[];
}

/** Spec §3 and §4.1, verbatim. */
export const BUILTIN_CHECKS = {
  "integration-check": { enabled: false, trigger: BUILTIN_TRIGGERS["integration-check"], command: null as string | null },
  "model-review": { enabled: true, trigger: BUILTIN_TRIGGERS["model-review"], budgetTokens: 1_000_000, maxGroupsPerReview: 12 },
} as const;

function pick<T>(project: T | undefined, global: T | undefined, builtin: T): Sourced<T> {
  if (project !== undefined) return { value: project, source: "project", lockedBy: null };
  if (global !== undefined) return { value: global, source: "global", lockedBy: null };
  return { value: builtin, source: "builtin", lockedBy: null };
}
/** Under a lock: the project value only when `allowed` says it is not looser than the global layer's value. */
function locked<T>(project: T | undefined, global: T | undefined, builtin: T, isLocked: boolean, allowed: (project: T, bound: T) => boolean): Sourced<T> {
  if (!isLocked) return pick(project, global, builtin);
  const bound = pick(undefined, global, builtin);
  return project !== undefined && allowed(project, bound.value) ? { value: project, source: "project", lockedBy: "global" } : { ...bound, lockedBy: "global" };
}

export function effectiveChecks(store: ControlStore, repoId: string | null): EffectiveChecks {
  const global: GlobalChecksLayer = readOrchestrationSettings(store).checks ?? {};
  const project: ChecksLayer = repoId === null ? {} : readRepositorySettingsBody(store, repoId)?.checks ?? {};
  const locks = [...(global.locks ?? [])].sort();
  const isLocked = (path: LockablePath) => locks.includes(path);
  const pi = project.integrationCheck ?? {}, gi = global.integrationCheck ?? {}, bi = BUILTIN_CHECKS["integration-check"];
  const pm = project.modelReview ?? {}, gm = global.modelReview ?? {}, bm = BUILTIN_CHECKS["model-review"];
  const globalScheduled = global.scheduled ?? [], projectScheduled = project.scheduled ?? [];
  const globalIds = new Set(globalScheduled.map((entry) => entry.id));
  const projectById = new Map(projectScheduled.map((entry) => [entry.id, entry]));
  const scheduled: EffectiveChecks["scheduled"] = [
    ...globalScheduled.map((entry) => {
      const own = projectById.get(entry.id);
      return own === undefined ? { value: entry, source: "global" as const, lockedBy: null, scope: "global" as const } : { value: own, source: "project" as const, lockedBy: null, scope: "global" as const };
    }),
    ...projectScheduled.filter((entry) => !globalIds.has(entry.id)).map((entry) => ({ value: entry, source: "project" as const, lockedBy: null, scope: "project" as const })),
  ];
  return {
    kinds: {
      "integration-check": {
        enabled: pick(pi.enabled, gi.enabled, bi.enabled),
        trigger: pick<Trigger>(pi.trigger, gi.trigger, bi.trigger),
        command: locked<string | null>(pi.command, gi.command, bi.command, isLocked("integrationCheck.command"), (mine, bound) => mine === null || mine === bound),
      },
      "model-review": {
        enabled: pick(pm.enabled, gm.enabled, bm.enabled),
        trigger: pick<Trigger>(pm.trigger, gm.trigger, bm.trigger),
        budgetTokens: locked(pm.budgetTokens, gm.budgetTokens, bm.budgetTokens, isLocked("modelReview.budgetTokens"), (mine, bound) => mine <= bound),
        maxGroupsPerReview: pick(pm.maxGroupsPerReview, gm.maxGroupsPerReview, bm.maxGroupsPerReview),
      },
    },
    scheduled,
    locks,
  };
}

// The read body (§4.3): `orca-checks-v1`. `state` carries each (kind, target)'s watermark and run facts (§5.4); the
// global read has none.
const sourced = <T extends z.ZodTypeAny>(value: T) => z.object({ value, source: z.enum(["project", "global", "builtin"]), lockedBy: z.literal("global").nullable() }).strict();
export const checksReadSchema = z.object({
  schema: z.literal("orca-checks-v1"),
  repoId: z.string().min(1).nullable(),
  kinds: z.object({
    "integration-check": z.object({ enabled: sourced(z.boolean()), trigger: sourced(triggerSchema), command: sourced(z.string().nullable()) }).strict(),
    "model-review": z.object({ enabled: sourced(z.boolean()), trigger: sourced(triggerSchema), budgetTokens: sourced(z.number().int()), maxGroupsPerReview: sourced(z.number().int()) }).strict(),
  }).strict(),
  scheduled: z.array(sourced(scheduledCheckSchema).extend({ scope: z.enum(["project", "global"]) }).strict()),
  locks: z.array(z.enum(LOCKABLE_PATHS)),
  state: z.array(z.object({ kind: z.enum(["integration-check", "model-review"]), target: z.string().min(1), state: checkStateSchema }).strict()),
}).strict();
export type ChecksReadV1 = z.infer<typeof checksReadSchema>;

export const checksRead = (store: ControlStore, repoId: string | null): ChecksReadV1 =>
  checksReadSchema.parse({ schema: "orca-checks-v1", repoId, ...effectiveChecks(store, repoId), state: repoId === null ? [] : listCheckStates(store, repoId) });
