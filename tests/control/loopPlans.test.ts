import { describe, expect, it } from "vitest";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import { TASK_WORK } from "../../src/control/estimator.js";
import {
  LOOP_PLAN_IDS, choosePlanByLabels, currentLoopPlanVersion, expandLoopTask, expandRecipe, isLoopPlanId, loopPlanDefinition, type LoopPlanFileInput,
} from "../../src/control/loopPlans.js";
import { taskContractSchema } from "../../src/scheduler/planFile.js";

/**
 * Loop plans spec §2.2, §2.3, §2.4, §3.2 (criteria 1, 2, 3, 5). The expansion is deterministic code (goal.md §3.3 hard
 * constraint 1, Rule 5); each plan's rules must land in the contract fields ccloop and Orca enforce (spec §2.1); a path
 * shape neither ccloop's matcher nor Orca's write set reads is refused before it becomes a contract (R8); labels choose a
 * plan only by the table's priority (D6).
 */
const REPO = "/abs/repo";
const BUGFIX_CONSTRAINTS = [
  "First add or change a test that reproduces the bug and fails for that reason; only then change the code so that it passes.",
  "Do not change behavior the bug does not involve.",
];
const TERMINAL = ["succeeded", "blocked_waiting_human", "exhausted", "cancelled", "failed"];
const input = (over: Partial<LoopPlanFileInput> = {}): LoopPlanFileInput => ({
  goal: "fix login", successCondition: "the login test passes", targetPaths: ["src/auth/**", "tests/auth/**"], checks: ["npm test"], ...over,
});
/** Each plan's own well-formed input: investigate needs exactly one exact report file (spec §3.2). */
const inputFor = (plan: string, over: Partial<LoopPlanFileInput> = {}): LoopPlanFileInput =>
  input({ plan, ...(plan === "investigate" ? { targetPaths: ["docs/report.md"] } : {}), ...over });
const expanded = (plan: string, over: Partial<LoopPlanFileInput> = {}) => {
  const result = expandLoopTask("fix-login", REPO, inputFor(plan, over), []);
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result;
};
const contractOf = (plan: string, over: Partial<LoopPlanFileInput> = {}) => JSON.parse(expanded(plan, over).canonicalJson);
const refusal = (loop: LoopPlanFileInput): string | null => {
  const result = expandLoopTask("fix-login", REPO, loop, []);
  return result.ok ? null : result.reason;
};

describe("the expansion is pure and pinned (criterion 1)", () => {
  it("expands bugfix's fixed input to exactly these bytes, and records its recipe", () => {
    // Rewritten under human ruling H19 (2026-10-01) for loop plans v2.
    // v1's bytes, from an explicit v1 recipe: an archived v1 recipe must keep re-expanding to them (spec §2.2).
    const v1 = expandRecipe("fix-login", REPO, { ...expanded("bugfix").recipe, planVersion: 1 });
    if (!v1.ok) throw new Error(v1.reason);
    expect(JSON.parse(v1.canonicalJson)).toEqual({
      objective: { taskId: "fix-login", goal: "fix login", successCondition: "the login test passes", nonGoals: [] },
      context: { repoPath: REPO, targetPaths: ["src/auth/**", "tests/auth/**"], relevantDocs: [], buildTestCommands: ["npm test"], constraints: BUGFIX_CONSTRAINTS },
      executionPolicy: { autonomyLevel: "L2", maxAttempts: 3, tokenBudget: 3_000_000, totalRuntimeBudgetMs: 14_400_000, perAttemptTimeoutMs: 3_600_000, worktreeRequired: true, partialOutcomeRecoveryWindowMs: 60_000 },
      safetyPolicy: { allowlistPaths: ["src/auth/**", "tests/auth/**"], denylistPaths: [], maxFilesTouched: 25, humanGateConditions: [] },
      verification: { verifierType: "agent", requiredChecks: ["npm test"], rejectOn: ["REJECT:no-red-first"], evidenceRequired: [] },
      escalationAndExit: { escalationTargets: [], pauseOn: [], stopOn: [], terminalStates: TERMINAL },
    });
    expect(v1.hash).toBe(sha256Canonical(JSON.parse(v1.canonicalJson)));
    // The v2 twin (human rulings H2/H3): the same input, now with no file cap and a phase timeout of MAX_TIMER_MS.
    const result = expanded("bugfix");
    const v2 = JSON.parse(v1.canonicalJson);
    v2.executionPolicy.perAttemptTimeoutMs = 2_147_483_647;
    v2.safetyPolicy.maxFilesTouched = Number.MAX_SAFE_INTEGER;
    expect(JSON.parse(result.canonicalJson)).toEqual(v2);
    expect(result.hash).toBe(sha256Canonical(JSON.parse(result.canonicalJson)));
    expect(result.recipe).toEqual({
      schema: "orca-loop-recipe-v1", planId: "bugfix", planVersion: 2, chosenBy: "explicit",
      inputs: { goal: "fix login", successCondition: "the login test passes", targetPaths: ["src/auth/**", "tests/auth/**"], checks: ["npm test"], nonGoals: [], relevantDocs: [], protectedPaths: [], maxFilesTouched: null },
    });
  });

  it.each([...LOOP_PLAN_IDS])("%s: is a fixed point of the contract schema, re-expands from its recipe, and hashes the same twice", (plan) => {
    // Rewritten under human ruling H19 (2026-10-01) for loop plans v2.
    const first = expanded(plan), second = expanded(plan);
    expect(second.hash).toBe(first.hash);
    // queries.ts readArchivedPlan re-parses every archived contract and compares canonical bytes (Review Focus 1).
    expect(canonicalBytes(taskContractSchema.parse(JSON.parse(first.canonicalJson))).toString("utf8")).toBe(first.canonicalJson);
    const again = expandRecipe("fix-login", REPO, first.recipe);
    expect(again.ok && again.canonicalJson).toBe(first.canonicalJson);
    // v1 stays in the registry; the current version is the highest one (ledger 2026-09-30, MX-20b/c: with one version
    // per plan, "newest" could not be told from "first").
    expect(loopPlanDefinition(plan, 1)).not.toBeNull();
    expect(currentLoopPlanVersion(plan)).toBe(2);
    expect(first.recipe.planVersion).toBe(2);
    expect(loopPlanDefinition(plan, 3)).toBeNull();
  });

  const changes: Array<[string, Partial<LoopPlanFileInput>]> = [
    ["goal", { goal: "fix logout" }], ["successCondition", { successCondition: "all tests pass" }],
    ["targetPaths", { targetPaths: ["src/auth/**"] }], ["checks", { checks: ["npm test", "npm run lint"] }],
    ["nonGoals", { nonGoals: ["no UI change"] }], ["relevantDocs", { relevantDocs: ["docs/auth.md"] }],
    ["protectedPaths", { protectedPaths: ["tests/fixtures/**"] }], ["maxFilesTouched", { maxFilesTouched: 7 }],
  ];
  it.each(changes)("changing %s alone changes the hash", (_field, over) => {
    expect(expanded("bugfix", over).hash).not.toBe(expanded("bugfix").hash);
  });

  it("gives every plan today's Web default work budget (spec §2.3: TASK_WORK)", () => {
    for (const plan of LOOP_PLAN_IDS) {
      const policy = contractOf(plan).executionPolicy;
      expect([policy.tokenBudget, policy.totalRuntimeBudgetMs, policy.maxAttempts]).toEqual([TASK_WORK.tokens, TASK_WORK.activeMs, TASK_WORK.attempts]);
    }
  });
});

describe("loop plans v2 (human rulings H2/H3, 2026-10-01)", () => {
  it.each([...LOOP_PLAN_IDS])("%s v2: no file cap unless the inputs set one (investigate stays 1), and a phase timeout of MAX_TIMER_MS", (plan) => {
    const contract = contractOf(plan);
    expect(contract.safetyPolicy.maxFilesTouched).toBe(plan === "investigate" ? 1 : Number.MAX_SAFE_INTEGER);
    expect(contract.executionPolicy.perAttemptTimeoutMs).toBe(2_147_483_647);
  });

  it.each([...LOOP_PLAN_IDS])("%s: a v1 recipe still expands with v1's defaults, so its stored bytes stay reproducible", (plan) => {
    const v2 = expanded(plan);
    const v1 = expandRecipe("fix-login", REPO, { ...v2.recipe, planVersion: 1 });
    if (!v1.ok) throw new Error(v1.reason);
    expect(v1.contract.safetyPolicy).toMatchObject({ maxFilesTouched: plan === "investigate" ? 1 : 25 });
    expect(v1.contract.executionPolicy).toMatchObject({ perAttemptTimeoutMs: 3_600_000 });
    expect(v1.hash).not.toBe(v2.hash);
  });
});

describe("each plan's rules land in the contract (criterion 2)", () => {
  // investigate refuses a file cap other than 1 (R-F15, rulings P2), so its input carries none and still expands to 1.
  const givenFor = (plan: string): Partial<LoopPlanFileInput> =>
    plan === "investigate" ? { protectedPaths: ["tests/fixtures/**"] } : { protectedPaths: ["tests/fixtures/**"], maxFilesTouched: 7 };
  const WRITE_SET = ["src/auth/**", "tests/auth/**"];
  const rows: Array<[string, { allow: string[]; max: number; verifier: string; rejectOn: string[]; constraints: string[] }]> = [
    ["standard", { allow: WRITE_SET, max: 7, verifier: "command", rejectOn: ["REJECT:unused"], constraints: [] }],
    ["bugfix", { allow: WRITE_SET, max: 7, verifier: "agent", rejectOn: ["REJECT:no-red-first"], constraints: BUGFIX_CONSTRAINTS }],
    ["refactor", { allow: WRITE_SET, max: 7, verifier: "command", rejectOn: ["REJECT:unused"], constraints: ["Change no observable behavior; every existing check must pass unchanged."] }],
    ["design", { allow: WRITE_SET, max: 7, verifier: "agent", rejectOn: ["REJECT:empty-document"], constraints: ["The deliverable is a document; change no code."] }],
    ["investigate", { allow: ["docs/report.md"], max: 1, verifier: "agent", rejectOn: ["REJECT:empty-report"], constraints: ["Investigate only; write the findings to the report file and change nothing else."] }],
  ];
  describe.each(rows)("%s", (plan, want) => {
    it("allowlist = targetPaths (the git-backed write set)", () => {
      expect(contractOf(plan, givenFor(plan)).safetyPolicy.allowlistPaths).toEqual(want.allow);
      expect(contractOf(plan, givenFor(plan)).context.targetPaths).toEqual(want.allow);
    });
    it("denylist = protectedPaths", () => expect(contractOf(plan, givenFor(plan)).safetyPolicy.denylistPaths).toEqual(["tests/fixtures/**"]));
    it("maxFilesTouched", () => expect(contractOf(plan, givenFor(plan)).safetyPolicy.maxFilesTouched).toBe(want.max));
    it("verifierType", () => expect(contractOf(plan, givenFor(plan)).verification.verifierType).toBe(want.verifier));
    it("rejectOn", () => expect(contractOf(plan, givenFor(plan)).verification.rejectOn).toEqual(want.rejectOn));
    it("constraints", () => expect(contractOf(plan, givenFor(plan)).context.constraints).toEqual(want.constraints));
    it("checks are both the build/test commands and the required checks", () => {
      const contract = contractOf(plan, givenFor(plan));
      expect([contract.context.buildTestCommands, contract.verification.requiredChecks]).toEqual([["npm test"], ["npm test"]]);
    });
  });
});

describe("refusals (criterion 3)", () => {
  it("refuses an unknown plan", () => expect(refusal(input({ plan: "yolo" }))).toBe("unknown-plan"));
  it("refuses a recipe whose plan version the registry does not hold (versions are never invented, spec §2.2)", () => {
    // Rewritten under human ruling H19 (2026-10-01) for loop plans v2.
    const recipe = { ...expanded("bugfix").recipe, planVersion: 3 };
    expect(expandRecipe("fix-login", REPO, recipe)).toEqual({ ok: false, reason: "unknown-plan" });
    expect([loopPlanDefinition("bugfix", 3), currentLoopPlanVersion("yolo")]).toEqual([null, null]);
    expect([isLoopPlanId("bugfix"), isLoopPlanId("yolo")]).toEqual([true, false]);
  });
  it.each([["/etc/passwd"], ["src/../secrets"], ["src/*.ts"], ["src/*"], ["*"], ["**/x.ts"], ["src/**/x.ts"], ["src//a.ts"], ["./src/a.ts"], ["src/"]])(
    "refuses the path shape %s in targetPaths and in protectedPaths", (path) => {
      expect(refusal(input({ plan: "standard", targetPaths: [path] }))).toBe("path-shape");
      expect(refusal(input({ plan: "standard", protectedPaths: [path] }))).toBe("path-shape");
    });
  it.each([["src/a.ts"], ["src/**"], ["**"], ["README.md"]])("accepts the path shape %s", (path) => {
    expect(refusal(input({ plan: "standard", targetPaths: [path] }))).toBeNull();
  });
  it.each([[["docs/a.md", "docs/b.md"]], [["docs/**"]], [["**"]]])("investigate refuses targetPaths %j", (targetPaths) => {
    expect(refusal(input({ plan: "investigate", targetPaths }))).toBe("investigate-target");
  });
  it("investigate refuses a file cap other than 1 instead of silently overriding it (R-F15), after the target check", () => {
    const investigate = (over: Partial<LoopPlanFileInput>) => refusal(input({ plan: "investigate", targetPaths: ["docs/report.md"], ...over }));
    expect(investigate({ maxFilesTouched: 7 })).toBe("investigate-max-files");
    expect(investigate({ maxFilesTouched: 1 })).toBeNull();
    expect(investigate({})).toBeNull();
    expect(investigate({ targetPaths: ["docs/**"], maxFilesTouched: 7 })).toBe("investigate-target");
  });
  it("design refuses the whole repository and accepts a documents prefix", () => {
    expect(refusal(input({ plan: "design", targetPaths: ["**"] }))).toBe("design-target");
    expect(refusal(input({ plan: "design", targetPaths: ["docs/**"] }))).toBeNull();
  });
});

describe("choosing a plan from labels (criterion 5, spec §2.4)", () => {
  const table: Array<[string[], string, string | null]> = [
    [["investigate"], "investigate", "investigate"], [["design"], "design", "design"], [["doc"], "design", "doc"],
    [["bug"], "bugfix", "bug"], [["refactor"], "refactor", "refactor"],
    [["feature"], "standard", "feature"], [["test"], "standard", "test"], [["perf"], "standard", "perf"],
    [["security"], "standard", "security"], [["chore"], "standard", "chore"], [[], "standard", null],
  ];
  it.each(table)("%j chooses %s", (labels, planId, label) => expect(choosePlanByLabels(labels)).toEqual({ planId, label }));
  it("takes the highest priority of several labels, whatever their order", () => {
    expect(choosePlanByLabels(["bug", "refactor"]).planId).toBe("bugfix");
    expect(choosePlanByLabels(["refactor", "bug"]).planId).toBe("bugfix");
    expect(choosePlanByLabels(["chore", "design", "bug"]).planId).toBe("design");
    expect(choosePlanByLabels(["bug", "investigate"]).planId).toBe("investigate");
  });
  it("ignores custom labels", () => {
    expect(choosePlanByLabels(["custom:bug"])).toEqual({ planId: "standard", label: null });
    expect(choosePlanByLabels(["custom:investigate", "refactor"]).planId).toBe("refactor");
  });
  it("lets an explicit plan win over the labels, and records how the plan was chosen", () => {
    const explicit = expandLoopTask("t", REPO, input({ plan: "standard" }), ["bug"]);
    const chosen = expandLoopTask("t", REPO, input(), ["bug"]);
    expect(explicit.ok && explicit.recipe).toMatchObject({ planId: "standard", chosenBy: "explicit" });
    expect(chosen.ok && chosen.recipe).toMatchObject({ planId: "bugfix", chosenBy: "labels" });
  });
});
