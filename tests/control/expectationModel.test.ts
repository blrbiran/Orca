// Tester follow-up G spec §2.2, §2.3 and §10.3 (plan Part B, O1): in a group created under the follow-up G model a task's
// token amount is an expectation (at least 1M), whoever set it; the group's token limit is the one hard line; and a person
// makes one task's amount a hard cap only with the separate hard switch. An estimate never writes a task ceiling there.
// A group created before the release keeps today's rules, and the hard switch is refused there by name.
import { describe, expect, it } from "vitest";
import { suggestionActions } from "../../src/control/budgetSuggestions.js";
import { hardCapOf, taskExpectation, tokenIntentOf } from "../../src/control/expectationModel.js";
import { readArchivedPlan, readBudgetProposal, readEstimateRecord, readWork } from "../../src/control/queries.js";
import { readConfirmedTaskExecution } from "../../src/control/executionSnapshot.js";
import { WebControlService } from "../../src/control/webService.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { webFixture } from "./fixtures/web.js";

type Fixture = Awaited<ReturnType<typeof webFixture>>;
const HANDOFF = { tokens: 1, activeMs: 1, attempts: 0, sessions: 0 };
const TOKENS = { scope: "task", taskId: "a", allocation: "work", dimension: "tokens" } as const;

async function group(options: { expectation: boolean }): Promise<{ h: Fixture; service: WebControlService }> {
  const h = await webFixture(undefined, [{ taskId: "a" }], { tokenPolicy: "optional-v1", ...(options.expectation ? { modelVersion: "followup-g" as const } : {}) });
  const service = new WebControlService(h.deps);
  // A finite group: what a person who set a 20M limit has.
  const limit = readBudgetProposal(h.store, "g").groupLimit;
  const edited = service.editProposal(h.command("proposal-edit", { baseProposalVersion: readBudgetProposal(h.store, "g").proposalVersion, operations: [], proposedGroupLimit: { ...limit, tokens: 20_000_000 } }));
  expect("error" in edited ? edited.error : "ok").toBe("ok");
  return { h, service };
}

async function readyEstimate(h: Fixture, service: WebControlService, work: { tokens: number; activeMs: number; attempts: number; sessions: number }): Promise<string> {
  const estimateId = await h.requestEstimate(service);
  const run = await service.claimEstimate("g", estimateId);
  const row = JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(run!.runId)!.body));
  row.state = "settled-restartable";
  h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(row), run!.runId);
  service.completeEstimate("g", estimateId, { schema: "budget-estimate-v1", planHash: readArchivedPlan(h.store, "g").planHash,
    tasks: [{ taskId: "a", complexity: "M", confidence: "high", work, handoff: HANDOFF, rationale: "small", assumptions: ["clean"] }],
    goalReviewReserve: { tokens: 1, activeMs: 1, attempts: 1, sessions: 1 }, groupRationale: "small" });
  expect(readEstimateRecord(h.store, "g", estimateId).state).toBe("ready");
  return estimateId;
}

const workAllocation = (h: Fixture) => readBudgetProposal(h.store, "g").allocations.find(a => a.ownerKind === "task" && a.ownerId === "a" && a.bucket === "work")!;
const edit = (h: Fixture, service: WebControlService, op: Record<string, unknown>) =>
  service.editProposal(h.command("proposal-edit", { baseProposalVersion: readBudgetProposal(h.store, "g").proposalVersion, operations: [op as never] }));

describe("the expectation model (tester follow-up G spec §2.2, §10.3)", { timeout: 60_000 }, () => {
  it("an estimate applied in a finite expectation-model group writes an expectation, not a ceiling", async () => {
    const { h, service } = await group({ expectation: true });
    try {
      // The import wrote no task token ceiling: the group limit is the one hard line.
      expect(workAllocation(h).amount.tokens).toBeNull();
      const before = structuredClone(workAllocation(h).amount);
      const estimateId = await readyEstimate(h, service, { tokens: 300_000, activeMs: 7_000_000, attempts: 4, sessions: 1 });
      const view = readControlGroup(h.store, "epoch", "g");
      expect(view.expectationModel).toBe(true);
      // "Apply all" offers no task work tokens, attempts or active time: they are advisory here, as in an unlimited group.
      const ops = suggestionActions(view, { kind: "all" }).flatMap(action => action.verb === "proposal-edit" ? action.payload.operations : []);
      expect(ops.filter(op => op.target.scope === "task" && op.target.allocation === "work" && ["tokens", "activeMs", "attempts"].includes(op.target.dimension))).toEqual([]);
      for (const action of suggestionActions(view, { kind: "all" })) if (action.verb === "proposal-edit") service.editProposal(h.command("proposal-edit", action.payload as never));
      const { sessions: _s1, ...advisoryBefore } = before;
      const { sessions: _s2, ...advisoryAfter } = workAllocation(h).amount;
      expect(advisoryAfter).toEqual(advisoryBefore);
      // The task's expectation is the estimate's work tokens, floored at 1M (#266).
      expect(taskExpectation(h.store, "g", readWork(h.store, "g", "a"))).toEqual({ tokens: 1_000_000, estimateId, source: "estimate" });
    } finally { await h.dispose(); }
  });

  it("a model value for a task's work tokens is refused by name in an expectation-model group", async () => {
    const { h, service } = await group({ expectation: true });
    try {
      const estimateId = await readyEstimate(h, service, { tokens: 1_500_000, activeMs: 7_000_000, attempts: 2, sessions: 1 });
      expect(edit(h, service, { target: TOKENS, value: 1_500_000, provenance: "model", estimateId })).toMatchObject({ error: { code: "estimate-advisory-in-expectation-group" } });
      expect(workAllocation(h).amount.tokens).toBeNull();
    } finally { await h.dispose(); }
  });

  it("a person's amount is an expectation unless the hard switch is on", async () => {
    const { h, service } = await group({ expectation: true });
    try {
      expect(edit(h, service, { target: TOKENS, value: 5_000_000, provenance: "human" })).toMatchObject({ result: { kind: "proposal-edited" } });
      expect(tokenIntentOf(readWork(h.store, "g", "a"))).toEqual({ tokens: 5_000_000, hard: false, provenance: "human", estimateId: null });
      expect(taskExpectation(h.store, "g", readWork(h.store, "g", "a"))).toEqual({ tokens: 5_000_000, estimateId: null, source: "intent" });
      expect(workAllocation(h).amount.tokens).toBeNull();
      // Below the floor without the switch: an expectation of 1M.
      expect(edit(h, service, { target: TOKENS, value: 300_000, provenance: "human" })).toMatchObject({ result: { kind: "proposal-edited" } });
      expect(tokenIntentOf(readWork(h.store, "g", "a"))).toMatchObject({ tokens: 1_000_000, hard: false });
      // With the switch: a cap of exactly the value, no floor, and no expectation (so no pause line).
      expect(edit(h, service, { target: TOKENS, value: 400_000, provenance: "human", hard: true })).toMatchObject({ result: { kind: "proposal-edited" } });
      expect(tokenIntentOf(readWork(h.store, "g", "a"))).toEqual({ tokens: 400_000, hard: true, provenance: "human", estimateId: null });
      expect(hardCapOf(readWork(h.store, "g", "a"))).toBe(400_000);
      expect(taskExpectation(h.store, "g", readWork(h.store, "g", "a"))).toBeNull();
      expect(workAllocation(h).amount.tokens).toBeNull();
    } finally { await h.dispose(); }
  });

  it("hard without tokens is refused by name", async () => {
    const { h, service } = await group({ expectation: true });
    try {
      expect(edit(h, service, { target: TOKENS, value: null, provenance: "human", hard: true })).toMatchObject({ error: { code: "hard-cap-needs-tokens" } });
      expect(edit(h, service, { target: { ...TOKENS, dimension: "attempts" }, value: 3, provenance: "human", hard: true })).toMatchObject({ error: { code: "hard-cap-needs-tokens" } });
      expect(tokenIntentOf(readWork(h.store, "g", "a"))).toBeNull();
    } finally { await h.dispose(); }
  });

  it("hard in a legacy group is refused by name and changes nothing", async () => {
    const { h, service } = await group({ expectation: false });
    try {
      const before = JSON.stringify(readBudgetProposal(h.store, "g"));
      expect(edit(h, service, { target: TOKENS, value: 400_000, provenance: "human", hard: true })).toMatchObject({ error: { code: "hard-cap-legacy-group" } });
      expect(JSON.stringify(readBudgetProposal(h.store, "g"))).toBe(before);
      expect(readControlGroup(h.store, "epoch", "g")).not.toHaveProperty("expectationModel");
    } finally { await h.dispose(); }
  });

  it("confirm keeps the intent on the task and freezes no task token ceiling", async () => {
    const { h, service } = await group({ expectation: true });
    try {
      expect(edit(h, service, { target: TOKENS, value: 2_000_000, provenance: "human" })).toMatchObject({ result: { kind: "proposal-edited" } });
      expect(await service.confirm(h.command("confirm", { ...await h.confirmPayload(), budgetMode: "soft" }))).toMatchObject({ result: { kind: "confirmed" } });
      const work = readWork(h.store, "g", "a");
      expect(tokenIntentOf(work)).toMatchObject({ tokens: 2_000_000, hard: false });
      expect(work.grant.work.tokens).toBeNull();
      expect(readConfirmedTaskExecution(h.store, "g", "a").contract.executionPolicy.tokenBudget).toBeNull();
      expect(readBudgetProposal(h.store, "g").state).toBe("confirmed");
      expect(workAllocation(h).amount.tokens).toBeNull();
    } finally { await h.dispose(); }
  });
});
