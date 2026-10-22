/**
 * Flow engine spec §9.3, §11.2 (H24-H26, H29; plan Task 12, C18): run policy, field by field project > global > built-in,
 * every value read with where it came from and whether a global lock binds it. Pure resolution over the two layers.
 *
 * Effect levels: `apply-flag` < `confirm` < `stage-only` (tighter to the right). `follow-template` takes the step's
 * `recommendedLevel`, else the class default; an `irreversible` step never reaches `apply-flag` through a template, and in
 * phase 1 not at all (its `apply-flag` needs the person token of CLI v2 §15: every channel refuses it,
 * `flow-setting-needs-person-token`) -- except configured delivery: a push/PR the person set in the Web UI is their
 * explicit choice and runs `apply-flag` (H26). A lock (global only) lets a project only tighten: a looser project value
 * is ignored while the lock stands and shown as `overriddenByLock`.
 */
import { readOrchestrationSettings } from "../control/orchestration.js";
import type { ControlStore } from "../control/store.js";
import { readRepositorySettingsBody } from "../control/workspaceSettings.js";
import { FLOW_EFFECT_CLASSES, type FlowEffectClass, type FlowLevel, type FlowLevelSetting, type FlowLockablePath, type FlowsLayer, type GlobalFlowsLayer } from "./settingsSchema.js";

export type SettingSource = "project" | "global" | "builtin";
export interface Sourced<T> { value: T; source: SettingSource; lockedBy: "global" | null; overriddenByLock?: T }
export interface ResolvedLevel { value: FlowLevel; source: "project" | "global" | "template" | "builtin"; lockedBy: "global" | null; overriddenByLock?: FlowLevel }

/** §9.1: the class defaults. */
export const BUILTIN_LEVELS: Readonly<Record<FlowEffectClass, FlowLevel>> = { local: "apply-flag", cost: "apply-flag", external: "apply-flag", irreversible: "confirm" };
/** Global Constraints default: the run pool when no layer and no template sets one. */
export const BUILTIN_TOKENS_PER_RUN = 2_000_000;
const RANK: Readonly<Record<FlowLevel, number>> = { "apply-flag": 0, confirm: 1, "stage-only": 2 };

/** A setting value as a level for this step, and where the level came from: the setting, the template, or the class default. */
function levelOf(cls: FlowEffectClass, setting: FlowLevelSetting, recommended: FlowLevel | undefined): { value: FlowLevel; origin: "setting" | "template" | "builtin" } {
  if (setting !== "follow-template") return { value: setting, origin: "setting" };
  if (recommended === undefined) return { value: BUILTIN_LEVELS[cls], origin: "builtin" };
  // §9.3: an irreversible step can never resolve to apply-flag through a template.
  if (cls === "irreversible" && recommended === "apply-flag") return { value: BUILTIN_LEVELS.irreversible, origin: "builtin" };
  return { value: recommended, origin: "template" };
}

/**
 * §9.3: the level an effect-classed step runs at. `configuredDelivery`: the step is the delivery the person configured
 * (push/PR from the Web UI), which runs `apply-flag` as their explicit project choice (still under any lock).
 */
export function resolveLevel(cls: FlowEffectClass, step: { recommendedLevel?: FlowLevel }, project: FlowsLayer | null, global: GlobalFlowsLayer | null, opts: { configuredDelivery?: boolean } = {}): ResolvedLevel {
  const rec = step.recommendedLevel;
  const at = (layer: "project" | "global", setting: FlowLevelSetting | undefined): ResolvedLevel | null => {
    if (setting === undefined) return null;
    const { value, origin } = levelOf(cls, setting, rec);
    return { value, source: origin === "setting" ? layer : origin, lockedBy: null };
  };
  const builtin: ResolvedLevel = { value: BUILTIN_LEVELS[cls], source: "builtin", lockedBy: null };
  let mine = opts.configuredDelivery === true ? { value: "apply-flag" as const, source: "project" as const, lockedBy: null } : at("project", project?.effects?.[cls]);
  const theirs = at("global", global?.effects?.[cls]) ?? builtin;
  // Phase 1: nothing but configured delivery reaches irreversible apply-flag (the writes are refused; this is the backstop).
  const clampIrreversible = (r: ResolvedLevel): ResolvedLevel => (cls === "irreversible" && r.value === "apply-flag" && opts.configuredDelivery !== true ? builtin : r);
  if (mine !== null) mine = clampIrreversible(mine);
  const bound = clampIrreversible(theirs);
  if (!(global?.locks ?? []).includes(`effects.${cls}` as FlowLockablePath)) return mine ?? bound;
  if (mine === null) return { ...bound, lockedBy: "global" };
  return RANK[mine.value] >= RANK[bound.value] ? { ...mine, lockedBy: "global" } : { ...bound, lockedBy: "global", overriddenByLock: mine.value };
}

/** The two layers of a project (null: the global layer only). */
export function flowLayers(store: ControlStore, repoId: string | null): { project: FlowsLayer | null; global: GlobalFlowsLayer | null } {
  return { project: repoId === null ? null : readRepositorySettingsBody(store, repoId)?.flows ?? null, global: readOrchestrationSettings(store).flows ?? null };
}

function pick<T>(project: T | undefined, global: T | undefined, builtin: T): Sourced<T> {
  if (project !== undefined) return { value: project, source: "project", lockedBy: null };
  if (global !== undefined) return { value: global, source: "global", lockedBy: null };
  return { value: builtin, source: "builtin", lockedBy: null };
}
/** Under a lock: the project value only when `allowed` says it is not looser than the bound (the global value, else built-in). */
function locked<T>(project: T | undefined, global: T | undefined, builtin: T, isLocked: boolean, allowed: (mine: T, bound: T) => boolean): Sourced<T> {
  if (!isLocked) return pick(project, global, builtin);
  const bound = pick(undefined, global, builtin);
  if (project === undefined) return { ...bound, lockedBy: "global" };
  return allowed(project, bound.value) ? { value: project, source: "project", lockedBy: "global" } : { ...bound, lockedBy: "global", overriddenByLock: project };
}

/** A level setting is no looser than the bound: equal, or both levels and at least as tight, or the tightest level. */
export function settingNotLooser(mine: FlowLevelSetting, bound: FlowLevelSetting): boolean {
  if (mine === bound || mine === "stage-only") return true;
  return mine !== "follow-template" && bound !== "follow-template" && RANK[mine] >= RANK[bound];
}

export interface FlowSettingsRead {
  effects: Record<FlowEffectClass, Sourced<FlowLevelSetting>>;
  rerunReview: Sourced<"auto" | "review">;
  roles: Sourced<Record<string, { agent: string; model?: string }>>;
  allowedSkillSources: Sourced<string[] | null>;
  budgets: { tokensPerRun: Sourced<number> };
  locks: FlowLockablePath[];
}

/** §11.2: what Web and `--json` render, per field `{value, source, lockedBy}`. */
export function readFlowSettings(store: ControlStore, repoId: string | null): FlowSettingsRead {
  const { project, global } = flowLayers(store, repoId);
  const locks = [...(global?.locks ?? [])].sort();
  const isLocked = (path: FlowLockablePath) => locks.includes(path);
  const effects = Object.fromEntries(FLOW_EFFECT_CLASSES.map((cls) => [cls, locked<FlowLevelSetting>(project?.effects?.[cls], global?.effects?.[cls], BUILTIN_LEVELS[cls], isLocked(`effects.${cls}`), settingNotLooser)])) as FlowSettingsRead["effects"];
  return {
    effects,
    rerunReview: pick(project?.rerunReview, global?.rerunReview, "review"),
    roles: pick(project?.roles, global?.roles, {}),
    allowedSkillSources: locked<string[] | null>(project?.allowedSkillSources, global?.allowedSkillSources, null, isLocked("allowedSkillSources"),
      (mine, bound) => bound === null || mine!.every((source) => bound.includes(source))),
    budgets: { tokensPerRun: locked(project?.budgets?.tokensPerRun, global?.budgets?.tokensPerRun, BUILTIN_TOKENS_PER_RUN, isLocked("budgets.tokensPerRun"), (mine, bound) => mine <= bound) },
    locks,
  };
}
