import { z } from "zod";
import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { safeInteger } from "./schema.js";
import { isSafeSkillName, PROFILE_NAME_PATTERN } from "../skills/syncskill.js";

/**
 * Loop plans (docs/superpowers/specs/2026-09-30-loop-plans-design.md §2, §3.2; goal.md §3.3): Orca's built-in recipes
 * that turn a few task inputs into a complete ccloop task contract. Everything here is pure -- no clock, filesystem or
 * model (goal.md §3.3 hard constraint 1, Rule 5) -- so an archived recipe re-expands to the bytes it once produced.
 *
 * This module imports nothing from src/scheduler or webProtocol.ts: planFile.ts and webProtocol.ts import it, and
 * estimator.ts imports webProtocol.ts. The two facts that would need those imports -- the expansion is a fixed point of
 * taskContractSchema, and the budget equals TASK_WORK -- are pinned by tests/control/loopPlans.test.ts instead.
 */

export const LOOP_PLAN_IDS = ["standard", "bugfix", "refactor", "design", "investigate"] as const;
export type LoopPlanId = (typeof LOOP_PLAN_IDS)[number];
export const LOOP_RECIPE_SCHEMA = "orca-loop-recipe-v1" as const;

export interface LoopPlanDefinition {
  planId: LoopPlanId;
  version: number;
  /** The plan's name in English, the source of record the panel's English resource must equal (panel i18n spec §6.9). */
  name: string;
  /** Soft constraints, into context.constraints: they reach the planner and executor, never the verifier (spec §2.1). */
  constraints: readonly string[];
  verifierType: "command" | "agent";
  /** A case-sensitive substring over every evidence string (spec §2.2, C4); a dead placeholder for a command verifier. */
  // ERRATUM (ccloop pin 1e4e434, 2026-10-01): from that ccloop on, rejectOn is only a condition in the verifier prompt;
  // ccloop no longer searches evidence for it (ccloop spec 2026-10-01-rejecton-verifier-judgment-design.md).
  rejectOn: string;
  /** The discipline line in English with its strength (spec §4.1), the panel's source of record (panel i18n spec §6.9); null when the plan has none. */
  discipline: string | null;
  /** Spec §2.3: the file cap when the inputs name none (investigate is always 1). */
  defaultMaxFilesTouched: number;
  /** Spec §2.3: executionPolicy.perAttemptTimeoutMs; the Web path clamps it to the task's active time (executionSnapshot.ts). */
  perAttemptTimeoutMs: number;
  /** Appended to the task's success condition, which the verifier reads (C4: a requirement, not a rejectOn token); null for none. */
  successConditionSuffix: string | null;
  /** C4: required checks, run before the task's own, that every target document exists and is not empty. */
  documentChecks: boolean;
}

/**
 * Spec §2.2 last bullet: a change to a plan's text or rules adds a version; no version is ever edited or removed, so an
 * old recipe still renders and still re-expands to its stored bytes (the projection checks it, controlViews.ts).
 */
const V1_DEFAULTS = { defaultMaxFilesTouched: 25, perAttemptTimeoutMs: 3_600_000, successConditionSuffix: null, documentChecks: false } as const;
/**
 * v2 (human rulings H2/H3, 2026-10-01): no file cap unless the inputs set one (ccloop's schema needs a positive integer
 * and only compares it, so "none" is the largest safe integer). Phase timeout: three hours (human ruling, 2026-10-01,
 * replacing H3's "no phase timeout of the plan's own"; v2 was edited in place by the same ruling, as no task used it
 * yet). On the Web path the derived contract still clamps it to the task's active time and to what a Node timer holds
 * (executionSnapshot.ts derivedPhaseTimeoutMs, MAX_TIMER_MS in schema.ts).
 */
const V2_DEFAULTS = { defaultMaxFilesTouched: Number.MAX_SAFE_INTEGER, perAttemptTimeoutMs: 10_800_000, successConditionSuffix: null, documentChecks: false } as const;
/**
 * C4 (measured 2026-10-01 with real claude, ledger "## C4"): an approving verifier may quote a rule's rejectOn token
 * ("... so REJECT:empty-document does not apply"), and ccloop's substring match then fails good work with no retry. So
 * no v2 plan relies on a token: design and investigate are checked by a command (each target document exists and is
 * not empty), and bugfix's red-first requirement is part of the success condition its verifier reads. The human ruled
 * (2026-10-01) that this edits v2 in place, a one-off exception to spec §2.2 above: v2 was pushed but no task used it.
 * ERRATUM (ccloop pin 1e4e434, 2026-10-01): "ccloop's substring match then fails good work" held for the ccloop this
 * was measured on; the pinned ccloop no longer searches evidence for rejectOn, so v1's tokens are prompt-only too.
 */
const V2_CHANGES: Partial<Record<LoopPlanId, Partial<LoopPlanDefinition>>> = {
  bugfix: { rejectOn: "REJECT:unused", successConditionSuffix: "Also: a test that reproduces the bug was added, and it failed before the fix." },
  design: {
    verifierType: "command", rejectOn: "REJECT:unused", documentChecks: true,
    discipline: "The deliverable is a document: a command checks that it exists and is not empty; \"no code changes\" is an instruction to the agent",
  },
  investigate: {
    verifierType: "command", rejectOn: "REJECT:unused", documentChecks: true,
    discipline: "Investigate only; findings go to the report file: a command checks that it exists and is not empty",
  },
};
const V1_PLANS: ReadonlyArray<Omit<LoopPlanDefinition, "version" | keyof typeof V1_DEFAULTS>> = [
  { planId: "standard", name: "Standard", constraints: [], verifierType: "command", rejectOn: "REJECT:unused", discipline: null },
  {
    planId: "bugfix", name: "Bug fix (red first)",
    constraints: [
      "First add or change a test that reproduces the bug and fails for that reason; only then change the code so that it passes.",
      "Do not change behavior the bug does not involve.",
    ],
    verifierType: "agent", rejectOn: "REJECT:no-red-first",
    discipline: "Write a failing test that reproduces the bug, then fix it (checked by a model, not proven mechanically)",
  },
  {
    planId: "refactor", name: "Safe refactor", constraints: ["Change no observable behavior; every existing check must pass unchanged."],
    verifierType: "command", rejectOn: "REJECT:unused",
    discipline: "No observable behavior change (an instruction to the agent; only the checks are enforced)",
  },
  {
    planId: "design", name: "Design / docs first", constraints: ["The deliverable is a document; change no code."],
    verifierType: "agent", rejectOn: "REJECT:empty-document",
    discipline: "The deliverable is a document, no code changes (checked by a model, not proven mechanically)",
  },
  {
    planId: "investigate", name: "Investigate only", constraints: ["Investigate only; write the findings to the report file and change nothing else."],
    verifierType: "agent", rejectOn: "REJECT:empty-report",
    discipline: "Investigate only; findings go to the report file, nothing else changes (checked by a model, not proven mechanically)",
  },
];
const REGISTRY: readonly LoopPlanDefinition[] = [
  ...V1_PLANS.map((plan) => ({ ...plan, version: 1, ...V1_DEFAULTS })),
  ...V1_PLANS.map((plan) => ({ ...plan, version: 2, ...V2_DEFAULTS, ...V2_CHANGES[plan.planId] })),
];

/** Spec §2.3: shared by every plan and version. The budget numbers equal TASK_WORK (estimator.ts); loopPlans.test.ts pins that. */
const EXECUTION_POLICY = {
  autonomyLevel: "L2", maxAttempts: 3, tokenBudget: 3_000_000, totalRuntimeBudgetMs: 14_400_000,
  worktreeRequired: true, partialOutcomeRecoveryWindowMs: 60_000,
} as const;
const TERMINAL_STATES = ["succeeded", "blocked_waiting_human", "exhausted", "cancelled", "failed"] as const;

const pathEntrySchema = z.string().min(1);
/** A recipe's inputs, every optional field filled, so the same task always has the same recipe bytes. */
export const loopInputsSchema = z
  .object({
    goal: z.string().min(1),
    successCondition: z.string().min(1),
    targetPaths: z.array(pathEntrySchema).min(1),
    checks: z.array(z.string().min(1)).min(1),
    nonGoals: z.array(z.string()),
    relevantDocs: z.array(z.string()),
    protectedPaths: z.array(pathEntrySchema),
    maxFilesTouched: safeInteger.positive().nullable(),
  })
  .strict();
export type LoopInputs = z.infer<typeof loopInputsSchema>;

/**
 * Syncskill integration spec §10.4: the skill set a loop task declares -- a syncskill profile, or explicit names. It is
 * never part of the ccloop contract (expandRecipe builds the contract field by field) and never part of loopInputsSchema.
 */
const loopSkillsShape = z.union([
  z.object({ profile: z.string().regex(PROFILE_NAME_PATTERN) }).strict(),
  z.object({ names: z.array(z.string()).min(1) }).strict(),
]);
export type LoopSkills = { profile: string } | { names: string[] };

/** Which part of a skills value breaks the shape, so a refusal says what to fix instead of zod's union fallout. */
function skillsShapeDetail(raw: unknown): string {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return "not-an-object";
  const keys = Object.keys(raw);
  if (keys.includes("profile") && keys.includes("names")) return "both-profile-and-names";
  if (!keys.includes("profile") && !keys.includes("names")) return "neither-profile-nor-names";
  if (keys.length !== 1) return "unknown-key";
  const value = raw as { profile?: unknown; names?: unknown };
  if ("profile" in value) return "profile-name";
  if (!Array.isArray(value.names) || !value.names.every((name) => typeof name === "string")) return "names-not-strings";
  return "empty-names";
}

/** Like the plan file's labels: one `skills-shape:<detail>` issue in place of the union's per-branch messages. */
export const loopSkillsSchema = z.unknown().transform((raw, ctx): LoopSkills => {
  const parsed = loopSkillsShape.safeParse(raw);
  if (parsed.success) return parsed.data;
  ctx.addIssue({ code: z.ZodIssueCode.custom, message: `skills-shape:${skillsShapeDetail(raw)}` });
  return z.NEVER;
});

/** Spec §10.4 shape check, for a value that may not have come through loopSkillsSchema: names sorted and unique, or "skills-shape". */
export function normalizeLoopSkills(skills: LoopSkills): LoopSkills | "skills-shape" {
  const parsed = loopSkillsSchema.safeParse(skills);
  if (!parsed.success) return "skills-shape";
  const value = parsed.data;
  if ("profile" in value) return { profile: value.profile };
  if (!value.names.every(isSafeSkillName)) return "skills-shape";
  return { names: [...new Set(value.names)].sort() };
}

/** Spec §3.1 (D3): the plan file's `loop` object. No budget: Web import never read a contract's budget. */
export const loopPlanFileSchema = z
  .object({
    plan: z.string().min(1).optional(),
    goal: z.string().min(1),
    successCondition: z.string().min(1),
    targetPaths: z.array(pathEntrySchema).min(1),
    checks: z.array(z.string().min(1)).min(1),
    nonGoals: z.array(z.string()).optional(),
    relevantDocs: z.array(z.string()).optional(),
    protectedPaths: z.array(pathEntrySchema).optional(),
    maxFilesTouched: safeInteger.positive().optional(),
    skills: loopSkillsSchema.optional(),
  })
  .strict();
export type LoopPlanFileInput = z.infer<typeof loopPlanFileSchema>;

/** Spec §3.2: what an archived plan entry (import) or an amendment record (a later change) keeps of a loop task. */
export const loopRecipeSchema = z
  .object({
    schema: z.literal(LOOP_RECIPE_SCHEMA),
    planId: z.enum(LOOP_PLAN_IDS),
    planVersion: safeInteger.positive(),
    chosenBy: z.enum(["explicit", "labels"]),
    inputs: loopInputsSchema,
    // Spec §10.4: optional and never defaulted, so a recipe without skills keeps its bytes (names stored sorted and unique).
    skills: loopSkillsSchema.optional(),
  })
  .strict();
export type LoopRecipe = z.infer<typeof loopRecipeSchema>;

export type LoopRefusal = "unknown-plan" | "path-shape" | "investigate-target" | "investigate-max-files" | "design-target" | "skills-shape";
export type LoopExpansion = { ok: true; contract: Record<string, unknown>; canonicalJson: string; hash: string } | { ok: false; reason: LoopRefusal };
export type LoopTaskExpansion =
  | { ok: true; contract: Record<string, unknown>; canonicalJson: string; hash: string; recipe: LoopRecipe }
  | { ok: false; reason: LoopRefusal };

export function isLoopPlanId(value: string): value is LoopPlanId {
  return (LOOP_PLAN_IDS as readonly string[]).includes(value);
}

export function loopPlanDefinition(planId: string, version: number): LoopPlanDefinition | null {
  return REGISTRY.find((plan) => plan.planId === planId && plan.version === version) ?? null;
}

export function currentLoopPlanVersion(planId: string): number | null {
  let newest: number | null = null;
  for (const plan of REGISTRY) if (plan.planId === planId && (newest === null || plan.version > newest)) newest = plan.version;
  return newest;
}

/** An exact relative path: no `*` anywhere, not absolute, no empty, `.` or `..` segment. */
function exactPath(entry: string): boolean {
  if (entry.startsWith("/") || entry.includes("*")) return false;
  return entry.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/**
 * Spec §3.2 path-shape (R8): the only shapes ccloop's matcher and Orca's write set (src/scheduler/writeSet.ts
 * normalizeClaim) both read -- an exact relative path, `<prefix>/**`, or `**`.
 */
function pathShapeOk(entry: string): boolean {
  if (entry === "**") return true;
  if (entry.endsWith("/**")) return exactPath(entry.slice(0, -"/**".length));
  return exactPath(entry);
}

/** Spec §2.3: the version's default unless the input says otherwise; investigate always 1. */
function maxFilesOf(plan: LoopPlanDefinition, inputs: LoopInputs): number {
  return plan.planId === "investigate" ? 1 : inputs.maxFilesTouched ?? plan.defaultMaxFilesTouched;
}

/** A POSIX shell word for a relative path; `./` keeps a path starting with `-` from reading as an option. */
const shellPath = (path: string): string => `'./${path.replace(/'/g, "'\\''")}'`;

/**
 * C4: a check ccloop runs (`sh -lc`, in the attempt's worktree) that the target document exists and is not empty. An
 * exact path must be a non-empty regular file; `<prefix>/**` must hold at least one non-empty regular file.
 */
export function documentCheck(target: string): string {
  if (target.endsWith("/**")) return `test -n "$(find ${shellPath(target.slice(0, -"/**".length))} -type f -size +0c 2>/dev/null | head -n 1)"`;
  return `test -f ${shellPath(target)} && test -s ${shellPath(target)}`;
}

/** Spec §3.2: the recipe's contract, for the recipe's own plan version; the re-expansion the projection checks. */
export function expandRecipe(taskId: string, repoPath: string, recipe: LoopRecipe): LoopExpansion {
  const plan = loopPlanDefinition(recipe.planId, recipe.planVersion);
  if (plan === null) return { ok: false, reason: "unknown-plan" };
  const { inputs } = recipe;
  if (![...inputs.targetPaths, ...inputs.protectedPaths].every(pathShapeOk)) return { ok: false, reason: "path-shape" };
  if (plan.planId === "investigate" && (inputs.targetPaths.length !== 1 || !exactPath(inputs.targetPaths[0]!))) {
    return { ok: false, reason: "investigate-target" };
  }
  // R-F15 (Rule 12): investigate always writes one file; a different cap is refused, never silently overridden.
  if (plan.planId === "investigate" && inputs.maxFilesTouched !== null && inputs.maxFilesTouched !== 1) {
    return { ok: false, reason: "investigate-max-files" };
  }
  if (plan.planId === "design" && inputs.targetPaths.includes("**")) return { ok: false, reason: "design-target" };
  const contract = {
    objective: {
      taskId, goal: inputs.goal, nonGoals: [...inputs.nonGoals],
      successCondition: plan.successConditionSuffix === null ? inputs.successCondition : `${inputs.successCondition}\n${plan.successConditionSuffix}`,
    },
    context: {
      repoPath, targetPaths: [...inputs.targetPaths], relevantDocs: [...inputs.relevantDocs],
      buildTestCommands: [...inputs.checks], constraints: [...plan.constraints],
    },
    executionPolicy: { ...EXECUTION_POLICY, perAttemptTimeoutMs: plan.perAttemptTimeoutMs },
    safetyPolicy: {
      allowlistPaths: [...inputs.targetPaths], denylistPaths: [...inputs.protectedPaths],
      maxFilesTouched: maxFilesOf(plan, inputs), humanGateConditions: [],
    },
    verification: {
      verifierType: plan.verifierType, rejectOn: [plan.rejectOn], evidenceRequired: [],
      requiredChecks: [...(plan.documentChecks ? inputs.targetPaths.map(documentCheck) : []), ...inputs.checks],
    },
    escalationAndExit: { escalationTargets: [], pauseOn: [], stopOn: [], terminalStates: [...TERMINAL_STATES] },
  };
  return { ok: true, contract, canonicalJson: canonicalBytes(contract).toString("utf8"), hash: sha256Canonical(contract) };
}

/** A named plan at its current version (the set-task-loop door, spec §5.2 step 4, and the plan file's). */
export function expandLoopPlan(taskId: string, repoPath: string, planId: string, inputs: LoopInputs, chosenBy: "explicit" | "labels" = "explicit", skills?: LoopSkills): LoopTaskExpansion {
  const version = currentLoopPlanVersion(planId);
  if (version === null || !isLoopPlanId(planId)) return { ok: false, reason: "unknown-plan" };
  // An explicit `undefined` would make canonical JSON throw, so an absent skills is an omitted key.
  const normalized = skills === undefined ? undefined : normalizeLoopSkills(skills);
  if (normalized === "skills-shape") return { ok: false, reason: "skills-shape" };
  const recipe: LoopRecipe = {
    schema: LOOP_RECIPE_SCHEMA, planId, planVersion: version, chosenBy, inputs: structuredClone(inputs),
    ...(normalized === undefined ? {} : { skills: normalized }),
  };
  const expanded = expandRecipe(taskId, repoPath, recipe);
  return expanded.ok ? { ...expanded, recipe } : expanded;
}

export function normalizeLoopInputs(input: LoopPlanFileInput): LoopInputs {
  return {
    goal: input.goal, successCondition: input.successCondition, targetPaths: [...input.targetPaths], checks: [...input.checks],
    nonGoals: [...(input.nonGoals ?? [])], relevantDocs: [...(input.relevantDocs ?? [])], protectedPaths: [...(input.protectedPaths ?? [])],
    maxFilesTouched: input.maxFilesTouched ?? null,
  };
}

/** Spec §2.4, §3.2: a plan-file task -- its named plan, or the one its labels choose. */
export function expandLoopTask(taskId: string, repoPath: string, input: LoopPlanFileInput, labels: readonly string[]): LoopTaskExpansion {
  const planId = input.plan ?? choosePlanByLabels(labels).planId;
  return expandLoopPlan(taskId, repoPath, planId, normalizeLoopInputs(input), input.plan === undefined ? "labels" : "explicit", input.skills);
}

/** Spec §2.4 (D6), highest priority first. `custom:` labels never match: no vocabulary word starts with the prefix. */
const LABEL_PRIORITY: ReadonlyArray<{ labels: readonly string[]; planId: LoopPlanId }> = [
  { labels: ["investigate"], planId: "investigate" },
  { labels: ["design", "doc"], planId: "design" },
  { labels: ["bug"], planId: "bugfix" },
  { labels: ["refactor"], planId: "refactor" },
  { labels: ["feature", "test", "perf", "security", "chore"], planId: "standard" },
];

export function choosePlanByLabels(labels: readonly string[]): { planId: LoopPlanId; label: string | null } {
  for (const row of LABEL_PRIORITY) {
    const hit = row.labels.find((label) => labels.includes(label));
    if (hit !== undefined) return { planId: row.planId, label: hit };
  }
  return { planId: "standard", label: null };
}
