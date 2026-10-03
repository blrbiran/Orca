import { describe, expect, it } from "vitest";
import { readArchivedPlan, readBudgetProposal, readEstimateRecord } from "../../src/control/queries.js";
import { WebControlService } from "../../src/control/webService.js";
import { change, errorOf, loop, workAllocation, type Change, type Fixture } from "./fixtures/taskLoop.js";
import { webFixture } from "./fixtures/web.js";

/**
 * W5 (human, 2026-10-01: "人工手填不合理，为什么不能自动填呢？"): an estimate's suggestion for a loop task's work budget is
 * applied through set-task-loop, still the budget's only owner (loop plans spec §4.3, C6). A dimension sent with provenance
 * "model" must equal the estimate's suggestion for that task's work allocation (the rule proposal-edit's model fields
 * follow, verifyModelField), from an estimate that is current after the change (W6), and is recorded as the allocation's
 * field provenance so confirmation re-checks it like any other model field.
 */
const SUGGESTED = { tokens: 1_500_000, activeMs: 7_000_000, attempts: 2, sessions: 1 };
const fixture = () => webFixture(undefined, [{ taskId: "a", loop: loop("a") }, { taskId: "c" }]);

async function readyEstimate(h: Fixture, service: WebControlService): Promise<void> {
  const run = await service.claimEstimate("g", h.estimateId);
  const row = JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(run!.runId)!.body));
  row.state = "settled-restartable";
  h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(row), run!.runId);
  const task = (taskId: string) => ({ taskId, complexity: "M", confidence: "high", work: SUGGESTED, handoff: { tokens: 1, activeMs: 1, attempts: 0, sessions: 0 }, rationale: "small", assumptions: ["clean"] });
  service.completeEstimate("g", h.estimateId, { schema: "budget-estimate-v1", planHash: readArchivedPlan(h.store, "g").planHash,
    tasks: [task("a"), task("c")], goalReviewReserve: { tokens: 1, activeMs: 1, attempts: 1, sessions: 1 }, groupRationale: "small" });
  expect(readEstimateRecord(h.store, "g", h.estimateId).state).toBe("ready");
}
const model = (h: Fixture) => ({ provenance: "model" as const, estimateId: h.estimateId });
/** A set-task-loop whose `dimensions` carry model provenance from the fixture's estimate. */
const apply = (h: Fixture, c: Change, dimensions: Array<"tokens" | "activeMs" | "attempts">) => {
  const command = change(h, "a", c);
  return { ...command, payload: { ...command.payload, workProvenance: Object.fromEntries(dimensions.map((d) => [d, model(h)])) } };
};

describe("set-task-loop applies an estimate's work suggestion (W5)", () => {
  it("accepts the suggested values, records them as the model's, and confirmation re-checks them", async () => {
    const h = await fixture();
    try {
      const service = new WebControlService(h.deps);
      await readyEstimate(h, service);
      const before = workAllocation(h, "a");
      expect(await service.setTaskLoop(apply(h, { tokens: SUGGESTED.tokens, activeMs: SUGGESTED.activeMs }, ["tokens", "activeMs"])))
        .toMatchObject({ result: { kind: "task-loop-set", taskId: "a" } });
      const after = workAllocation(h, "a");
      expect(after.amount).toEqual({ ...before.amount, tokens: SUGGESTED.tokens, activeMs: SUGGESTED.activeMs });
      expect(after.fieldProvenance.tokens).toEqual(model(h));
      expect(after.fieldProvenance.activeMs).toEqual(model(h));
      expect(after.fieldProvenance.attempts).toEqual(before.fieldProvenance.attempts);
      expect(await service.confirm(h.command("confirm", await h.confirmPayload()))).toMatchObject({ result: { kind: "confirmed" } });
    } finally { await h.dispose(); }
  });

  it("refuses a value that is not the suggestion, as proposal-edit does, and writes nothing", async () => {
    const h = await fixture();
    try {
      const service = new WebControlService(h.deps);
      await readyEstimate(h, service);
      const before = workAllocation(h, "a");
      expect(errorOf(await service.setTaskLoop(apply(h, { tokens: SUGGESTED.tokens + 1 }, ["tokens"])))).toMatchObject({ code: "proposal-version-conflict" });
      expect(workAllocation(h, "a")).toEqual(before);
      // The same number sent as the person's own is an ordinary change.
      expect(await service.setTaskLoop(change(h, "a", { tokens: SUGGESTED.tokens + 1 }))).toMatchObject({ result: { kind: "task-loop-set" } });
      expect(workAllocation(h, "a").fieldProvenance.tokens).toEqual({ provenance: "human", estimateId: null });
    } finally { await h.dispose(); }
  });

  it("refuses a suggestion from an estimate a plan change made stale, and one the same command makes stale", async () => {
    const h = await fixture();
    try {
      const service = new WebControlService(h.deps);
      await readyEstimate(h, service);
      const version = readBudgetProposal(h.store, "g").proposalVersion;
      expect(errorOf(await service.setTaskLoop(apply(h, { tokens: SUGGESTED.tokens, inputs: { goal: "write a, changed" } }, ["tokens"]))))
        .toMatchObject({ code: "estimate-stale" });
      expect(readBudgetProposal(h.store, "g").proposalVersion).toBe(version);
      expect(await service.setTaskLoop(change(h, "a", { inputs: { goal: "write a, changed" } }))).toMatchObject({ result: { kind: "task-loop-set", loopVersion: 1 } });
      expect(errorOf(await service.setTaskLoop(apply(h, { base: 1, tokens: SUGGESTED.tokens, inputs: { goal: "write a, changed" } }, ["tokens"]))))
        .toMatchObject({ code: "estimate-stale" });
    } finally { await h.dispose(); }
  });
});
