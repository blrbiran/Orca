// Budget defaults spec 2026-11-11 §7 "Option A, made precise" items 1 and 3 (tester #224/#234/#238/#241/#162): in a group
// whose token limit is null an estimate is an expectation, not a per-task ceiling. Applying one used to write its finite
// work tokens, attempts and active time into every task, and confirm froze them as the contract's hard stops -- the
// stops the tester hit. So the shared suggestion transform (the panel's "Apply" and `orca group apply-estimate`) offers no
// task-work tokens, attempts or activeMs in an unlimited group, for loop and non-loop tasks alike; handoff and goal-review
// reserves are finite-only amounts and keep today's behaviour. A finite group's output must not move by one byte (§7 Q4).
import { describe, expect, it } from "vitest";
import { suggestionActions } from "../../src/control/budgetSuggestions.js";
import { sha256Canonical } from "../../src/control/canonicalJson.js";

const H = "a".repeat(64);
const prov = { provenance: "human", estimateId: null };
const fieldProvenance = { tokens: prov, activeMs: prov, attempts: prov, sessions: prov };
const amount = (tokens: number | null, activeMs = 10, attempts = 1, sessions = 1) => ({ tokens, activeMs, attempts, sessions });
const INPUTS = { goal: "g", successCondition: "s", targetPaths: ["a.txt"], checks: ["true"], nonGoals: [], relevantDocs: [], protectedPaths: [], maxFilesTouched: null };
const OUTPUT = {
  schema: "budget-estimate-v1", planHash: H, groupRationale: "r",
  tasks: [
    // t1 is a loop task (set-task-loop owns its work); t2 is not (proposal-edit). Every work dimension differs from the
    // proposal, the handoff rows differ in tokens, and the goal review differs: each kind of suggestion is on offer.
    { taskId: "t1", complexity: "M", confidence: "high", work: amount(800, 20, 2, 3), handoff: amount(40, 10, 0, 0), rationale: "r", assumptions: [] },
    { taskId: "t2", complexity: "S", confidence: "high", work: amount(300, 30, 1, 2), handoff: amount(60, 10, 1, 1), rationale: "r", assumptions: [] },
  ],
  goalReviewReserve: amount(900),
};

function view(groupTokens: number | null) {
  return {
    summary: { groupId: "g-alpha", commandRevision: 5 },
    plan: { planHash: H },
    proposal: { state: "editable", proposalVersion: 3 },
    ledger: { groupLimit: amount(groupTokens, 1_000, 10, 10) },
    allocations: [
      { ownerKind: "task", ownerId: "t1", bucket: "work", amount: amount(null, 50, 3, 3), fieldProvenance },
      { ownerKind: "task", ownerId: "t1", bucket: "handoff", amount: amount(0, 10, 0, 0), fieldProvenance },
      { ownerKind: "task", ownerId: "t2", bucket: "work", amount: amount(null, 50, 3, 3), fieldProvenance },
      { ownerKind: "task", ownerId: "t2", bucket: "handoff", amount: amount(50, 10, 1, 1), fieldProvenance },
      { ownerKind: "goal-review", ownerId: "g-alpha:goal-review", bucket: "review", amount: amount(1000), fieldProvenance },
    ],
    workItems: [
      { taskId: "t1", loopPlan: { planId: "standard", loopVersion: 2, inputs: INPUTS } },
      { taskId: "t2", loopPlan: null },
    ],
    estimates: [{ estimateId: "est-1", estimateVersion: 1, state: "ready", output: OUTPUT, stale: false }],
  };
}

const TASK_WORK_DIMENSIONS = ["tokens", "activeMs", "attempts"];

describe("an unlimited group: the estimate is an expectation, not a ceiling (§7 items 1, 3)", () => {
  it("offers no task-work tokens, attempts or activeMs for loop and non-loop tasks; handoff and goal review unchanged", () => {
    const actions = suggestionActions(view(null) as never, { kind: "all" });
    // mutation: drop the null-limit guard -> t1's set-task-loop and t2's work tokens/activeMs/attempts come back, red
    expect(actions.filter((action) => action.verb === "set-task-loop")).toEqual([]);
    const operations = actions.flatMap((action) => action.verb === "proposal-edit" ? action.payload.operations : []);
    expect(operations.filter((op) => op.target.scope === "task" && op.target.allocation === "work" && TASK_WORK_DIMENSIONS.includes(op.target.dimension))).toEqual([]);
    // What is still sent, spelled out: t2's work sessions (outside the spec's three task-work amounts), both handoff
    // rows' tokens, and the goal review's tokens, each as the model's from est-1.
    const model = { provenance: "model", estimateId: "est-1" };
    expect(actions).toEqual([{ verb: "proposal-edit", groupId: "g-alpha", expectedRevision: 5, payload: { baseProposalVersion: 3, operations: [
      { target: { scope: "task", taskId: "t1", allocation: "handoff", dimension: "tokens" }, value: 40, ...model },
      { target: { scope: "task", taskId: "t2", allocation: "work", dimension: "sessions" }, value: 2, ...model },
      { target: { scope: "task", taskId: "t2", allocation: "handoff", dimension: "tokens" }, value: 60, ...model },
      { target: { scope: "goal-review", dimension: "tokens" }, value: 900, ...model },
    ] } }]);
  });

  it("a field or row scope on a task's work offers nothing either", () => {
    const v = view(null) as never;
    for (const dimension of ["tokens", "activeMs", "attempts"] as const) {
      expect(suggestionActions(v, { kind: "field", target: { scope: "task", taskId: "t2", allocation: "work", dimension } }), dimension).toEqual([]);
      expect(suggestionActions(v, { kind: "field", target: { scope: "task", taskId: "t1", allocation: "work", dimension } }), dimension).toEqual([]);
    }
    expect(suggestionActions(v, { kind: "row", ownerKind: "task", ownerId: "t1", bucket: "work" })).toEqual([]);
  });
});

describe("a finite group: byte-identical to before (§7 Q4)", () => {
  it("suggestionActions' output hashes to the golden captured before the change", () => {
    // Golden captured on the base commit 395e5f8d (before any change of this round) with
    //   TMPDIR=/tmp npx vitest run tests/control/estimateExpectationSuggestions.test.ts
    // run against the unchanged src/: the value below is the hash that run printed (log golden-suggestions-base.log).
    // mutation: apply the null-limit guard to every group -> the finite output loses its task-work suggestions, red
    const actions = suggestionActions(view(5_000_000) as never, { kind: "all" });
    // Ruling (2026-11-12, tester follow-up F): #162 applies a task's work attempts as at least 2, so t2's (estimated 1) is
    // sent as 2. The output differs from the golden by exactly that one value: put the estimate's 1 back, and the bytes are
    // the golden's again.
    const t2Attempts = (op: { target: { scope: string; taskId?: string; allocation?: string; dimension: string } }) =>
      op.target.scope === "task" && op.target.taskId === "t2" && op.target.allocation === "work" && op.target.dimension === "attempts";
    const edit = actions[0]!;
    if (edit.verb !== "proposal-edit") throw new Error("proposal-edit first");
    expect(edit.payload.operations.filter(t2Attempts).map((op) => op.value)).toEqual([2]);
    const before = [{ ...edit, payload: { ...edit.payload, operations: edit.payload.operations.map((op) => (t2Attempts(op) ? { ...op, value: 1 } : op)) } }, ...actions.slice(1)];
    expect(sha256Canonical(before)).toBe("530ad67758d15bb1dd674eb5da04eb0010868e6352a6c133f5d38ed01410016e");
    // Not an empty golden: the finite output does carry both task-work routes.
    expect(actions.map((action) => action.verb)).toEqual(["proposal-edit", "set-task-loop"]);
  });
});
