import { describe, expect, it } from "vitest";
import { DEBUG_DIFF_INLINE_MAX_BYTES, DEBUG_INPUT_SCHEMA, debugDiffCommand, type DebugInputV1 } from "../../src/control/debugInput.js";
import {
  buildDebugPlanSource, DEBUG_DEFAULT_BUILD_TEST_COMMANDS, DEBUG_DEFAULT_EXECUTION_POLICY, DEBUG_DEFAULT_TARGET_PATHS,
  DEBUG_REPRODUCTION_CONDITION, DEBUG_TASK_ID, DEBUG_TEST_DIRS, debugGoalText, debugPlanId,
} from "../../src/control/debugPlan.js";
import { TASK_WORK } from "../../src/control/estimator.js";
import { expandLoopPlan } from "../../src/control/loopPlans.js";
import { normalizeControlPlan } from "../../src/control/planImport.js";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import type { Correction } from "../../src/corrections/schema.js";
import type { DecisionEvent } from "../../src/ledger/schema.js";
import { taskContractSchema } from "../../src/scheduler/planFile.js";

// Debug task Task 4: the debug group's plan is a pure transform of the frozen input (design §4.1, §4.3, §12.7). Every
// fixture below is built here and handed in; the assertions read what the transform returned, never a value written into
// that output by the test.
const BASE = "a".repeat(40);
const ATTEMPT = "b".repeat(40);

const decision: DecisionEvent = {
  ev: "decision", id: "run-1/agent-0", at: "2026-10-18T00:00:00.000Z", run: "run-1", question: "which lock guards the store",
  chose: "an in-process mutex", alternatives: [{ option: "a file lease", why_not: "too heavy for one process" }],
  because: "it is the fastest", undo: { how: "git revert x", cost: "one repo", blast_radius: "one repo" }, scope: "repo", kind: "interface",
};

const original = taskContractSchema.parse({
  objective: { taskId: "a", goal: "guard the store", successCondition: "the store is guarded" },
  context: { repoPath: "/repo", targetPaths: ["src/store/**", "README.md"], buildTestCommands: ["npm test", "npm run typecheck"] },
  executionPolicy: {
    autonomyLevel: "L2", maxAttempts: 2, perAttemptTimeoutMs: 1_000_000, totalRuntimeBudgetMs: 2_000_000,
    tokenBudget: 123_456, worktreeRequired: true, partialOutcomeRecoveryWindowMs: 5_000,
  },
  safetyPolicy: { allowlistPaths: ["docs/**", "src/store/**"], maxFilesTouched: 7 },
  verification: { verifierType: "agent", requiredChecks: ["npm test", "node check-docs.js"], rejectOn: ["REJECT:x"] },
  escalationAndExit: {},
});

function correction(kind: Correction["kind"], extra: Partial<Correction> = {}): Correction {
  return {
    id: "c_1", projectKey: "example.invalid/o/r", decisionId: decision.id, kind, because: "the mutex deadlocks under fork",
    at: "2026-10-18T01:00:00.000Z", by: "owner@example.invalid", ...extra,
  } as Correction;
}

function input(overrides: Partial<DebugInputV1> = {}): DebugInputV1 {
  return {
    schema: DEBUG_INPUT_SCHEMA, correction: correction("wrong"), decision, decisionWhere: "target", pending: null,
    originalRun: { runId: "run-1", groupId: "g", taskId: "a", agent: { agent: "claude", model: "m", contextWindow: "200k" } as never, configHash: "h" },
    commits: { base: BASE, attemptSha: ATTEMPT, diff: "diff --git a/x b/x\n+changed\n" }, contract: original, missing: [], ...overrides,
  };
}

const OPTS = { repoPath: "/repo", existingTestDirs: [] as string[], agent: undefined };
const contractOf = (source: ReturnType<typeof buildDebugPlanSource>) => taskContractSchema.parse(source.tasks[0]!.originalContract);
/** The inlined diff: what stands between the goal's diff fence lines. */
const inlinedDiff = (goal: string): string => {
  const match = /\n(`{3,})diff\n([\s\S]*?)\n\1\n/.exec(goal);
  expect(match).not.toBeNull();
  return match![2]!;
};

describe("debugGoalText", () => {
  it("goal text names the decision, the choice, the reason and the alternative", () => {
    const cases: Array<[Correction["kind"], string]> = [
      ["not_my_taste", "change to a lock file per process"],
      ["wrong", "fix what is wrong"],
      ["stale", "bring it up to date"],
    ];
    for (const [kind, sentence] of cases) {
      const text = debugGoalText(input({ correction: correction(kind, { chose_instead: "a lock file per process" }) }));
      expect(text).toContain(decision.id);
      expect(text).toContain(decision.chose);
      expect(text).toContain("the mutex deadlocks under fork");
      expect(text).toContain("a lock file per process");
      expect(text).toContain(sentence);
      // Each kind has its own sentence only.
      for (const [, other] of cases.filter(([k]) => k !== kind)) expect(text).not.toContain(other);
    }
  });

  it("names the human's alternative for a kind whose sentence does not carry it", () => {
    const text = debugGoalText(input({ correction: correction("wrong", { chose_instead: "a lock file per process" }) }));
    expect(text).toContain("The human's alternative: a lock file per process");
  });

  it("goal text tells the agent to reproduce first", () => {
    const text = debugGoalText(input());
    expect(text).toContain("add a test that fails on the current code");
    expect(text).toContain("declare `reproTests`");
  });

  it("goal text names each missing piece", () => {
    const noRun = debugGoalText(input({ originalRun: null, commits: null, contract: null, missing: ["run"] }));
    expect(noRun).toContain("commits and contract are unavailable");
    const noBase = debugGoalText(input({ commits: null, missing: ["base"] }));
    expect(noBase).toContain("recorded no base commit");
    const noAttempt = debugGoalText(input({ commits: null, missing: ["attemptSha"] }));
    expect(noAttempt).toContain("recorded no attempt commit");
    const noObjects = debugGoalText(input({ commits: null, missing: ["objects"] }));
    expect(noObjects).toContain("no longer in the repository");
    const noContract = debugGoalText(input({ contract: null, missing: ["contract"] }));
    expect(noContract).toContain("contract could not be read");
    // Nothing missing: none of those sentences.
    const whole = debugGoalText(input());
    for (const sentence of ["commits and contract are unavailable", "recorded no base commit", "recorded no attempt commit", "no longer in the repository", "contract could not be read"]) {
      expect(whole).not.toContain(sentence);
    }
  });

  it("a diff within the cap is inlined whole and no command is named", () => {
    const diff = "diff --git a/x b/x\n+changed\n";
    const text = debugGoalText(input());
    expect(inlinedDiff(text)).toBe(diff);
    expect(text).not.toContain(debugDiffCommand(BASE, ATTEMPT));
  });

  it("the diff is inlined up to the cap, then named by command", () => {
    const diff = "+" + "q".repeat(DEBUG_DIFF_INLINE_MAX_BYTES);
    expect(Buffer.byteLength(diff)).toBe(DEBUG_DIFF_INLINE_MAX_BYTES + 1);
    const text = debugGoalText(input({ commits: { base: BASE, attemptSha: ATTEMPT, diff } }));
    const inlined = inlinedDiff(text);
    expect(Buffer.byteLength(inlined)).toBeLessThanOrEqual(DEBUG_DIFF_INLINE_MAX_BYTES);
    expect(inlined.length).toBeGreaterThan(0);
    expect(diff.startsWith(inlined)).toBe(true);
    expect(text).toContain(`git diff --no-color ${BASE} ${ATTEMPT} -- . ':(exclude).decisions'`);
  });

  it("the cut never splits a multi-byte character", () => {
    // 1 + 2*(cap/2) bytes: the cap falls on the second byte of an "é".
    const diff = "+" + "é".repeat(DEBUG_DIFF_INLINE_MAX_BYTES / 2);
    const inlined = inlinedDiff(debugGoalText(input({ commits: { base: BASE, attemptSha: ATTEMPT, diff } })));
    expect(Buffer.byteLength(inlined)).toBeLessThanOrEqual(DEBUG_DIFF_INLINE_MAX_BYTES);
    expect(inlined).not.toContain("�");
    expect(diff.startsWith(inlined)).toBe(true);
  });

  it("a fence longer than the diff's own backtick runs keeps the diff whole", () => {
    const diff = "+ a fenced block in a doc:\n+````js\n+x\n+````\n+```";
    expect(inlinedDiff(debugGoalText(input({ commits: { base: BASE, attemptSha: ATTEMPT, diff } })))).toBe(diff);
  });

  it("names the original run and the original task's goal", () => {
    const text = debugGoalText(input());
    expect(text).toContain("The original run: run-1 (group g, task a).");
    expect(text).toContain("The original task's goal: guard the store");
  });

  it("quotes the original non-goals, constraints and denylist as context, and omits empty ones", () => {
    const fuller = taskContractSchema.parse({
      ...original, objective: { ...original.objective, nonGoals: ["do not touch the API"] },
      context: { ...original.context, constraints: ["keep the change small"] },
      safetyPolicy: { ...original.safetyPolicy, denylistPaths: ["vendor/**"] },
    });
    const text = debugGoalText(input({ contract: fuller }));
    expect(text).toContain("The original task's non-goals (context; not binding on this task): do not touch the API");
    expect(text).toContain("The original task's constraints (context; not binding on this task): keep the change small");
    expect(text).toContain("Paths this task may not write (inherited from the original task): vendor/**");
    const contract = contractOf(buildDebugPlanSource(input({ contract: fuller }), OPTS));
    expect([contract.objective.nonGoals, contract.context.constraints, contract.safetyPolicy.denylistPaths]).toEqual([[], [], ["vendor/**"]]);
    const plain = debugGoalText(input());
    for (const label of ["non-goals (context", "constraints (context", "may not write"]) expect(plain).not.toContain(label);
  });

  it("a pending question with quotes and backslashes appears verbatim", () => {
    const question = 'use "retry" from C:\\tools\\net';
    const pending = { pendingId: "pending-run-1-0", ledgerRun: "run-1", entryIndex: 0, reason: "r", at: "2026-10-18T00:30:00.000Z", evidence: [], entry: { question } };
    const text = debugGoalText(input({
      correction: correction("wrong", { decisionId: undefined, runId: "run-1", pendingId: pending.pendingId }), decision: null, decisionWhere: null, pending,
    }));
    expect(text).toContain(`question: ${question}`);
  });

  it("a pending target's goal carries the pending entry's question, its refusal and the human's reason", () => {
    const pending = {
      pendingId: "pending-run-1-0", ledgerRun: "run-1", entryIndex: 0, reason: "tier-0: undo.how is not executable",
      at: "2026-10-18T00:30:00.000Z", evidence: ["run run-1"],
      entry: { question: "which retry policy for the fetcher", chose: "three tries", because: "the API flakes" },
    };
    const text = debugGoalText(input({
      correction: correction("wrong", { decisionId: undefined, runId: "run-1", pendingId: pending.pendingId }), decision: null, decisionWhere: null, pending,
    }));
    expect(text).toContain("pending-run-1-0");
    expect(text).toContain("which retry policy for the fetcher");
    expect(text).toContain("three tries");
    expect(text).toContain("tier-0: undo.how is not executable");
    expect(text).toContain("the mutex deadlocks under fork");
    expect(text).toContain("add a test that fails on the current code");
    expect(text).toContain("declare `reproTests`");
  });
});

describe("buildDebugPlanSource", () => {
  it("write set = targetPaths ∪ allowlistPaths ∪ existing test dirs", () => {
    const without = contractOf(buildDebugPlanSource(input(), OPTS));
    expect(without.context.targetPaths).toEqual(["README.md", "docs/**", "src/store/**"]);
    expect(without.context.targetPaths.some((path) => path.startsWith("tests/"))).toBe(false);
    const withTests = contractOf(buildDebugPlanSource(input(), { ...OPTS, existingTestDirs: ["tests", "spec"] }));
    expect(withTests.context.targetPaths).toEqual(["README.md", "docs/**", "spec/**", "src/store/**", "tests/**"]);
  });

  it("an original allowlist is widened to the write set, so the new test may be written", () => {
    const contract = contractOf(buildDebugPlanSource(input(), { ...OPTS, existingTestDirs: ["tests"] }));
    expect(contract.safetyPolicy.allowlistPaths).toEqual(["README.md", "docs/**", "src/store/**", "tests/**"]);
  });

  it("an original with no allowlist stays unrestricted", () => {
    const open = taskContractSchema.parse({ ...original, safetyPolicy: { ...original.safetyPolicy, allowlistPaths: [] } });
    const contract = contractOf(buildDebugPlanSource(input({ contract: open }), { ...OPTS, existingTestDirs: ["tests"] }));
    expect(contract.safetyPolicy.allowlistPaths).toEqual([]);
  });

  it("budgets and checks come from the original", () => {
    const contract = contractOf(buildDebugPlanSource(input(), OPTS));
    expect(contract.executionPolicy).toEqual(original.executionPolicy);
    expect(contract.context.buildTestCommands).toEqual(original.context.buildTestCommands);
    expect(contract.verification.requiredChecks).toEqual(original.context.buildTestCommands);
    expect(contract.safetyPolicy.maxFilesTouched).toBe(original.safetyPolicy.maxFilesTouched);
  });

  it("success conditions: reproduction first, then each original check, once each", () => {
    const doubled = taskContractSchema.parse({ ...original, context: { ...original.context, buildTestCommands: ["npm test", "npm test", "npm run typecheck"] } });
    const source = buildDebugPlanSource(input({ contract: doubled }), OPTS);
    expect(source.successConditions).toEqual([DEBUG_REPRODUCTION_CONDITION, "npm test", "npm run typecheck"]);
    expect(contractOf(source).verification.requiredChecks).toEqual(["npm test", "npm run typecheck"]);
    expect(() => normalizeControlPlan({ ...source, repoId: "r", planId: debugPlanId("debug-c_1") })).not.toThrow();
  });

  it("the contract's success condition is the reproduction requirement", () => {
    expect(contractOf(buildDebugPlanSource(input(), OPTS)).objective.successCondition).toBe(DEBUG_REPRODUCTION_CONDITION);
    expect(contractOf(buildDebugPlanSource(input({ contract: null, missing: ["contract"] }), OPTS)).objective.successCondition).toBe(DEBUG_REPRODUCTION_CONDITION);
  });

  it("no original contract: defaults taken from the estimator and the loop plans", () => {
    const contract = contractOf(buildDebugPlanSource(input({ contract: null, missing: ["contract"] }), { ...OPTS, existingTestDirs: ["tests"] }));
    expect(contract.executionPolicy).toEqual(DEBUG_DEFAULT_EXECUTION_POLICY);
    // The brief: the budget numbers are TASK_WORK's.
    expect([contract.executionPolicy.maxAttempts, contract.executionPolicy.totalRuntimeBudgetMs, contract.executionPolicy.tokenBudget])
      .toEqual([TASK_WORK.attempts, TASK_WORK.activeMs, TASK_WORK.tokens]);
    // The rest are the current loop plans' (a "standard" task expanded now).
    const loop = expandLoopPlan("t", "/repo", "standard", {
      goal: "g", successCondition: "s", targetPaths: ["**"], checks: ["true"], nonGoals: [], relevantDocs: [], protectedPaths: [], maxFilesTouched: null,
    });
    if (!loop.ok) throw new Error(loop.reason);
    const loopContract = taskContractSchema.parse(loop.contract);
    expect(contract.executionPolicy.perAttemptTimeoutMs).toBe(loopContract.executionPolicy.perAttemptTimeoutMs);
    expect(contract.executionPolicy.partialOutcomeRecoveryWindowMs).toBe(loopContract.executionPolicy.partialOutcomeRecoveryWindowMs);
    expect(contract.safetyPolicy.maxFilesTouched).toBe(loopContract.safetyPolicy.maxFilesTouched);
    expect(contract.verification.verifierType).toBe(loopContract.verification.verifierType);
    expect(contract.context.targetPaths).toEqual([...DEBUG_DEFAULT_TARGET_PATHS, "tests/**"]);
    expect(contract.context.targetPaths).toContain(".");
    expect(contract.context.buildTestCommands).toEqual([...DEBUG_DEFAULT_BUILD_TEST_COMMANDS]);
    expect(contract.context.buildTestCommands).toEqual(["<to be named by the agent as reproCommand>"]);
    expect(contract.safetyPolicy.allowlistPaths).toEqual([]);
  });

  it("the plan's goal is the goal text's first line; the task keeps the whole text", () => {
    const source = buildDebugPlanSource(input(), OPTS);
    expect(source.goal).toBe("Debug task for correction c_1 (wrong, by owner@example.invalid at 2026-10-18T01:00:00.000Z).");
    expect(contractOf(source).objective.goal).toBe(debugGoalText(input()));
  });

  it("the agent layer is the plan's group `agent`", () => {
    const agent = { agent: "codex", model: "gpt-x" };
    expect(buildDebugPlanSource(input(), { ...OPTS, agent }).agent).toEqual(agent);
    expect("agent" in buildDebugPlanSource(input(), OPTS)).toBe(false);
  });

  it("the source normalizes", () => {
    for (const frozen of [input(), input({ originalRun: null, commits: null, contract: null, missing: ["run"] })]) {
      const source = buildDebugPlanSource(frozen, { ...OPTS, existingTestDirs: [...DEBUG_TEST_DIRS] });
      const plan = normalizeControlPlan({ ...source, repoId: "r", planId: debugPlanId("debug-c_1") });
      expect(plan.tasks.map((task) => task.taskId)).toEqual([DEBUG_TASK_ID]);
      expect(plan.planId).toBe("debug-c_1-plan");
      const task = source.tasks[0]!;
      expect(task.originalContractCanonicalJson).toBe(canonicalBytes(task.originalContract).toString("utf8"));
      expect(task.originalContractHash).toBe(sha256Canonical(task.originalContract));
      expect(contractOf(source).objective.taskId).toBe(DEBUG_TASK_ID);
      expect(contractOf(source).objective.goal).toBe(debugGoalText(frozen));
      expect(contractOf(source).context.repoPath).toBe("/repo");
    }
  });
});
