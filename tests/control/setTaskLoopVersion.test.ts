import { describe, expect, it } from "vitest";
import { expandRecipe } from "../../src/control/loopPlans.js";
import { readArchivedPlan, readBudgetProposal, readEstimateRecord } from "../../src/control/queries.js";
import { writeCanonicalRecord } from "../../src/control/snapshot.js";
import { effectivePlanTask, writeTaskAmendment } from "../../src/control/taskAmendments.js";
import { WebControlService } from "../../src/control/webService.js";
import { change, loop, workBody, writeWork, type Fixture } from "./fixtures/taskLoop.js";
import { webFixture } from "./fixtures/web.js";

/**
 * Ledger W7 ruling (2026-10-01): a set-task-loop naming the task's current plan with its current inputs keeps the
 * task's plan version -- only a change of plan or inputs expands at the current version. Otherwise, once v2 exists, a
 * budget-only change (or an estimate's suggestion applied in one click) would silently re-expand a v1 task as v2,
 * change its contract, mark it "changed", and have the suggestion refused as estimate-stale.
 */
const fixture = () => webFixture(undefined, [{ taskId: "a", loop: loop("a") }, { taskId: "c" }]);
const SUGGESTED = { tokens: 1_500_000, activeMs: 7_000_000, attempts: 2, sessions: 1 };

/** Gives task a a v1 recipe, as a set-task-loop before v2 existed would have left it (the record set-task-loop writes). */
function makeV1(h: Fixture): void {
  const archived = readArchivedPlan(h.store, "g").plan.tasks.find((task) => task.taskId === "a")!;
  const repoPath = JSON.parse(archived.originalContractCanonicalJson).context.repoPath;
  const recipe = { ...archived.loop!, planVersion: 1, chosenBy: "explicit" as const };
  const expanded = expandRecipe("a", repoPath, recipe);
  if (!expanded.ok) throw new Error(expanded.reason);
  writeCanonicalRecord(h.store, "g", expanded.hash, expanded.canonicalJson);
  const amendmentHash = writeTaskAmendment(h.store, "g", { schema: "orca-task-amendment-v1", groupId: "g", taskId: "a", loopVersion: 1,
    previousContractHash: archived.originalContractHash, recipe, originalContractHash: expanded.hash, originalContractCanonicalJson: expanded.canonicalJson });
  writeWork(h, "a", { amendmentHash, loopVersion: 1, originalContractHash: expanded.hash, contract: { contentAddressedHash: expanded.hash } });
}
const effective = (h: Fixture) => effectivePlanTask(h.store, "g", readArchivedPlan(h.store, "g").plan.tasks.find((task) => task.taskId === "a")!, workBody(h, "a"));

describe("set-task-loop keeps the task's plan version unless the plan or its inputs change (W7)", () => {
  it("a budget-only change keeps a v1 task at v1, with the same contract bytes, and does not mark it changed", async () => {
    const h = await fixture();
    try {
      makeV1(h);
      const before = effective(h);
      expect(new WebControlService(h.deps).setTaskLoop(change(h, "a", { base: 1, tokens: 2_000_000 }))).toMatchObject({ result: { kind: "task-loop-set", loopVersion: 2 } });
      const after = effective(h);
      expect(after.loop!.planVersion).toBe(1);
      expect(after.originalContractCanonicalJson).toBe(before.originalContractCanonicalJson);
      expect(workBody(h, "a").planChanged).toBeUndefined();
    } finally { await h.dispose(); }
  });

  it("an estimate's suggestion applied to a v1 task is accepted, and the task stays v1", async () => {
    const h = await fixture();
    try {
      makeV1(h);
      const service = new WebControlService(h.deps);
      const created = await service.createEstimate(h.command("estimate", {
        proposalVersion: readBudgetProposal(h.store, "g").proposalVersion, estimatorProfileId: "all", estimatorProfileHash: h.frozen.profileHash, estimateMode: "soft" }));
      const estimateId = (created as { result: { estimateId: string } }).result.estimateId;
      const run = await service.claimEstimate("g", estimateId);
      const row = JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(run!.runId)!.body));
      row.state = "settled-restartable";
      h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(row), run!.runId);
      const task = (taskId: string) => ({ taskId, complexity: "M", confidence: "high", work: SUGGESTED, handoff: { tokens: 1, activeMs: 1, attempts: 0, sessions: 0 }, rationale: "small", assumptions: ["clean"] });
      service.completeEstimate("g", estimateId, { schema: "budget-estimate-v1", planHash: readArchivedPlan(h.store, "g").planHash,
        tasks: [task("a"), task("c")], goalReviewReserve: { tokens: 1, activeMs: 1, attempts: 1, sessions: 1 }, groupRationale: "small" });
      expect(readEstimateRecord(h.store, "g", estimateId).state).toBe("ready");
      const command = change(h, "a", { base: 1, tokens: SUGGESTED.tokens });
      const model = { provenance: "model" as const, estimateId };
      expect(service.setTaskLoop({ ...command, payload: { ...command.payload, workProvenance: { tokens: model } } }))
        .toMatchObject({ result: { kind: "task-loop-set", loopVersion: 2 } });
      expect(effective(h).loop!.planVersion).toBe(1);
    } finally { await h.dispose(); }
  });

  it("an input change moves a v1 task to the current version", async () => {
    const h = await fixture();
    try {
      makeV1(h);
      expect(new WebControlService(h.deps).setTaskLoop(change(h, "a", { base: 1, inputs: { goal: "write a, changed" } }))).toMatchObject({ result: { kind: "task-loop-set" } });
      expect(effective(h).loop!.planVersion).toBe(2);
      expect(workBody(h, "a").planChanged).toBe(true);
    } finally { await h.dispose(); }
  });
});
