// Issue #156 (session 3cfc2e73): `orca group apply-estimate` is the CLI's "Apply all suggestions". Before it, an agent on
// the CLI could not apply a ready estimate without hand-built JSON, so paid-for estimates went unused. It must send what
// the panel's "Apply all" sends -- the shared transform's commands, proposal-edit first, then one set-task-loop per loop
// task, each at the revision the previous answer named -- and nothing when it is a dry run or there is no usable advice.
import { describe, expect, it } from "vitest";
import { suggestionActions } from "../../src/control/budgetSuggestions.js";
import { cli, useFakePanels, type Recorded } from "./fixtures/fakePanel.js";
import { H, world } from "./fixtures/world.js";

useFakePanels();

const human = { provenance: "human", estimateId: null };
const prov = { tokens: human, activeMs: human, attempts: human, sessions: human };
const amount = (tokens: number | null, activeMs = 10, attempts = 1, sessions = 1) => ({ tokens, activeMs, attempts, sessions });
const INPUTS = { goal: "g", successCondition: "s", targetPaths: ["a.txt"], checks: ["true"], nonGoals: [], relevantDocs: [], protectedPaths: [], maxFilesTouched: null };
const OUTPUT = {
  schema: "budget-estimate-v1", planHash: H.plan, groupRationale: "r",
  tasks: [
    { taskId: "t1", complexity: "M", confidence: "high", work: amount(800, 20, 1, 3), handoff: amount(0, 10, 0, 0), rationale: "r", assumptions: [] },
    { taskId: "t2", complexity: "S", confidence: "high", work: amount(300), handoff: amount(50, 10, 1, 1), rationale: "r", assumptions: [] },
  ],
  goalReviewReserve: amount(900),
};
function adviceView(over: { stale?: boolean; state?: string; output?: unknown; proposalState?: string; unlimited?: boolean } = {}) {
  return {
    schema: "orca-control-group-v1", epoch: "e", changeSeq: 9,
    summary: { groupId: "g-alpha", repoId: "repo-1", state: "draft", commandRevision: 5 },
    plan: { repoId: "repo-1", planId: "plan-a", planHash: H.plan, goal: "ship", successConditions: [] },
    proposal: { state: over.proposalState ?? "editable", proposalVersion: 3, planHash: H.plan, budgetMode: null, contextPolicy: { handoffAtContextTokens: null }, profiles: null, executionSnapshotHash: null },
    // Ruling (2026-11-11, session f958ec3f): human approved rewriting necessary criteria; this now encodes a finite group
    // (the only kind whose estimate is applied as a ceiling, spec 2026-11-11 §7 Q4), so #156's criteria below pin that path;
    // `unlimited` gives the group with no token limit, where the estimate is the expectation (§7 item 5).
    ledger: { groupLimit: amount(over.unlimited ? null : 50_000) },
    allocations: [
      { ownerKind: "task", ownerId: "t1", bucket: "work", state: "draft-encumbered", amount: amount(null), fieldProvenance: prov },
      { ownerKind: "task", ownerId: "t1", bucket: "handoff", state: "draft-encumbered", amount: amount(0, 10, 0, 0), fieldProvenance: prov },
      { ownerKind: "task", ownerId: "t2", bucket: "work", state: "draft-encumbered", amount: amount(null), fieldProvenance: prov },
      { ownerKind: "task", ownerId: "t2", bucket: "handoff", state: "draft-encumbered", amount: amount(50, 10, 1, 1), fieldProvenance: prov },
      { ownerKind: "goal-review", ownerId: "g-alpha:goal-review", bucket: "review", state: "draft-encumbered", amount: amount(1000), fieldProvenance: prov },
    ],
    workItems: [
      { taskId: "t1", status: "draft", currentRunId: null, labelsVersion: 0, loopPlan: { planId: "standard", loopVersion: 2, inputs: INPUTS } },
      { taskId: "t2", status: "draft", currentRunId: null, labelsVersion: 0, loopPlan: null },
    ],
    estimates: [
      { estimateId: "est-old", estimateVersion: 1, state: "ready", output: { ...OUTPUT, goalReviewReserve: amount(1) } },
      { estimateId: "est-new", estimateVersion: 2, state: over.state ?? "ready", output: over.output === undefined ? OUTPUT : over.output, ...(over.stale ? { stale: true } : {}) },
    ],
    runs: [], checkpoints: [],
  };
}

/** A panel whose revision advances with each accepted command, refusing a stale expectedRevision as commandLedger.ts does. */
async function advisedWorld(view = adviceView(), refuse?: (request: Recorded, nth: number) => boolean) {
  let revision = view.summary.commandRevision;
  let nth = 0;
  const accept = (request: Recorded) => {
    const sent = JSON.parse(request.text) as { commandId: string; expectedRevision: number };
    if (refuse?.(request, nth++)) return { status: 422, body: { error: { code: "proposal-version-conflict", message: "stale", retryable: false } } };
    if (sent.expectedRevision !== revision) return { status: 409, body: { error: { code: "revision-conflict", message: "stale", commandRevision: revision, retryable: false } } };
    revision += 1;
    return { status: 200, body: { commandId: sent.commandId, commandRevision: revision, result: { kind: "ok" } } };
  };
  const w = await world({}, { "POST *": accept });
  w.state.view = view as never;
  return w;
}

describe("orca group apply-estimate (#156)", () => {
  it("sends the shared transform's commands in order: proposal-edit, then set-task-loop, each at the revision the previous answered", async () => {
    const w = await advisedWorld();
    const out = await cli(["group", "apply-estimate", "g-alpha", "--json"], w.dir);
    expect(out.code).toBe(0);
    const expected = suggestionActions(adviceView() as never, { kind: "all" });
    expect(expected.map((a) => a.verb)).toEqual(["proposal-edit", "set-task-loop"]);
    expect(w.posts().map((p) => [p.path, p.expectedRevision, p.payload])).toEqual([
      ["groups/g-alpha/proposal/edit", 5, expected[0]!.payload],
      ["groups/g-alpha/tasks/t1/loop", 6, expected[1]!.payload],
    ]);
    // What the transform decided, spelled out: t2's work tokens and the goal review's tokens through proposal-edit; t1
    // (a loop task) through set-task-loop with workProvenance for the dimensions that change; t1's sessions never.
    // Ruling (2026-11-12, tester follow-up F): #162 applies a task's work attempts as at least 2; both tasks' estimates say 1
    // against a proposal of 1, so each now also sends attempts 2 (t2 through proposal-edit, t1 through set-task-loop).
    expect(expected[0]!.payload).toEqual({ baseProposalVersion: 3, operations: [
      { target: { scope: "task", taskId: "t2", allocation: "work", dimension: "tokens" }, value: 300, provenance: "model", estimateId: "est-new" },
      { target: { scope: "task", taskId: "t2", allocation: "work", dimension: "attempts" }, value: 2, provenance: "model", estimateId: "est-new" },
      { target: { scope: "goal-review", dimension: "tokens" }, value: 900, provenance: "model", estimateId: "est-new" },
    ] });
    expect(expected[1]!.payload).toEqual({ baseLoopVersion: 2, plan: "standard", inputs: INPUTS, work: { tokens: 800, activeMs: 20, attempts: 2 },
      workProvenance: { tokens: { provenance: "model", estimateId: "est-new" }, activeMs: { provenance: "model", estimateId: "est-new" }, attempts: { provenance: "model", estimateId: "est-new" } } });
    expect(out.json().body).toMatchObject({ schema: "orca-apply-estimate-v1", estimateId: "est-new", dryRun: false, applied: [{ commandRevision: 6 }, { commandRevision: 7 }] });
  });

  it("--dry-run prints the same commands and sends nothing", async () => {
    const w = await advisedWorld();
    const out = await cli(["group", "apply-estimate", "g-alpha", "--dry-run"], w.dir);
    expect(out.code).toBe(0);
    expect(w.posts()).toEqual([]);
    expect(out.stdout).toContain("would send 2 command(s) from estimate est-new");
    expect(out.stdout).toContain("task t1 work activeMs = 20 (set-task-loop)");
    expect(out.stdout).toContain("sessions are not set by an estimate (R10)");
  });

  it("refuses here, sending nothing, when the newest estimate is not ready, is stale, or the proposal is confirmed", async () => {
    for (const [view, code] of [
      [adviceView({ state: "blocked-capability", output: null }), "estimate-not-ready"],
      [adviceView({ proposalState: "confirmed" }), "estimate-not-ready"],
      [adviceView({ stale: true }), "estimate-stale"],
    ] as const) {
      const w = await advisedWorld(view as ReturnType<typeof adviceView>);
      const out = await cli(["group", "apply-estimate", "g-alpha", "--json"], w.dir);
      expect([out.code, out.json().body.error.code]).toEqual([1, code]);
      expect(w.posts()).toEqual([]);
    }
  });

  it("a proposal already at its suggestions: nothing to apply, nothing sent", async () => {
    const view = adviceView();
    // Ruling (2026-11-12, tester follow-up F): at its suggestions means work attempts 2 now (#162's floor over the estimate's 1).
    view.allocations[0]!.amount = amount(800, 20, 2, 1);
    view.allocations[2]!.amount = amount(300, 10, 2);
    view.allocations[4]!.amount = amount(900);
    const w = await advisedWorld(view);
    const out = await cli(["group", "apply-estimate", "g-alpha"], w.dir);
    expect(out.code).toBe(0);
    expect(w.posts()).toEqual([]);
    expect(out.stdout).toContain("nothing to apply");
  });

  it("an unlimited group: the estimate is recorded as the expectation, exit 0, and no task-work ceiling is sent (§7 item 5)", async () => {
    const w = await advisedWorld(adviceView({ unlimited: true }));
    const out = await cli(["group", "apply-estimate", "g-alpha"], w.dir);
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("the group has no token limit, so estimate est-new is recorded as the expectation, not a ceiling");
    // mutation: drop the expectation lines from formatApplied -> red
    expect(out.stdout).toContain("  task t1: expected 800 tokens");
    expect(out.stdout).toContain("  task t2: expected 300 tokens");
    expect(out.stdout).not.toContain("already matches");
    // Only the goal review's tokens (and no handoff here: both already match) go out; never a task's work.
    const ops = w.posts().flatMap((p) => (p.payload as { operations?: Array<{ target: { scope: string; allocation?: string } }> }).operations ?? []);
    expect(w.posts().map((p) => p.path)).toEqual(["groups/g-alpha/proposal/edit"]);
    expect(ops.filter((op) => op.target.scope === "task" && op.target.allocation === "work")).toEqual([]);
    // With nothing left to send, it still names the expectation rather than "nothing to apply".
    const settled = adviceView({ unlimited: true });
    settled.allocations[4]!.amount = amount(900);
    const w2 = await advisedWorld(settled);
    const quiet = await cli(["group", "apply-estimate", "g-alpha"], w2.dir);
    expect([quiet.code, w2.posts()]).toEqual([0, []]);
    expect(quiet.stdout).toContain("recorded as the expectation");
    expect(quiet.stdout).not.toContain("nothing to apply");
    // A finite group's JSON answer carries no expectations key (its bytes are as before).
    const finite = await cli(["group", "apply-estimate", "g-alpha", "--json", "--dry-run"], (await advisedWorld()).dir);
    expect(finite.json().body).not.toHaveProperty("expectations");
  });

  // Tester follow-up F §4 (#162): an estimate's attempts=1 made the first exhausted attempt the end of the task.
  it("raises a task's work attempts below 2 to 2 and says so; an estimate of 2 or more is not named (#162)", async () => {
    const out = await cli(["group", "apply-estimate", "g-alpha", "--dry-run"], (await advisedWorld()).dir);
    expect(out.code).toBe(0);
    // mutation: drop the raisedAttempts line from formatApplied -> red
    expect(out.stdout).toContain("  task t1 work attempts: the estimate said 1; raised to 2, as an applied estimate sets at least 2");
    expect(out.stdout).toContain("  task t2 work attempts: the estimate said 1; raised to 2, as an applied estimate sets at least 2");
    const json = await cli(["group", "apply-estimate", "g-alpha", "--dry-run", "--json"], (await advisedWorld()).dir);
    expect(json.json().body.raisedAttempts).toEqual([{ taskId: "t1", estimated: 1, applied: 2 }, { taskId: "t2", estimated: 1, applied: 2 }]);
    // An estimate of 3 attempts is applied as 3 and named nowhere.
    const three = adviceView({ output: { ...OUTPUT, tasks: OUTPUT.tasks.map((task) => ({ ...task, work: { ...task.work, attempts: 3 } })) } });
    const plain = await cli(["group", "apply-estimate", "g-alpha", "--dry-run", "--json"], (await advisedWorld(three)).dir);
    expect(plain.json().body).not.toHaveProperty("raisedAttempts");
    const ops = (plain.json().body.actions as Array<{ payload: { operations?: Array<{ target: { dimension: string; allocation?: string }; value: number }>; work?: { attempts: number } } }>);
    expect(ops[0]!.payload.operations!.filter((op) => op.target.allocation === "work" && op.target.dimension === "attempts").map((op) => op.value)).toEqual([3]);
    expect(ops[1]!.payload.work!.attempts).toBe(3);
  });

  it("stops at the first refusal and names what was applied before it", async () => {
    const w = await advisedWorld(adviceView(), (_request, nth) => nth === 1);
    const out = await cli(["group", "apply-estimate", "g-alpha", "--json"], w.dir);
    expect(out.code).toBe(2);
    expect(out.json().body).toMatchObject({ error: { code: "proposal-version-conflict" }, applied: [{ verb: "proposal-edit", commandRevision: 6 }] });
    expect(w.posts().length).toBe(2);
  });
});
