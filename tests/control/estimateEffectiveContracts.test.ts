import { describe, expect, it } from "vitest";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import { readArchivedPlan, readBudgetProposal, readEstimateRecord } from "../../src/control/queries.js";
import { WebControlService } from "../../src/control/webService.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { expandLoopPlan } from "../../src/control/loopPlans.js";
import { change, errorOf, inputs, loop, type Fixture } from "./fixtures/taskLoop.js";
import { webFixture } from "./fixtures/web.js";

/**
 * Loop plans spec §5.1 applied to the estimate chain (W6, 2026-10-01): an estimate is built from each task's effective
 * contract, not the imported one, while planHash stays the plan's identity; an estimate built before a set-task-loop
 * change is marked stale in the group view, and applying its suggestions is refused as estimate-stale.
 */
const CHANGED = { inputs: { goal: "write a, changed" } };
const fixture = () => webFixture(undefined, [{ taskId: "a", loop: loop("a") }, { taskId: "c" }]);
const amount = (tokens: number) => ({ tokens, activeMs: tokens, attempts: 1, sessions: 1 });

/** Runs the fixture's import-time estimate to `ready` with an answer whose goal-review suggestion is 1 234 tokens. */
async function readyEstimate(h: Fixture, service: WebControlService, estimateId: string): Promise<void> {
  const run = await service.claimEstimate("g", estimateId);
  const row = JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(run!.runId)!.body));
  row.state = "settled-restartable";
  h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(row), run!.runId);
  const task = (taskId: string) => ({ taskId, complexity: "M", confidence: "high", work: amount(100), handoff: amount(10), rationale: "small", assumptions: ["clean"] });
  service.completeEstimate("g", estimateId, { schema: "budget-estimate-v1", planHash: readArchivedPlan(h.store, "g").planHash,
    tasks: [task("a"), task("c")], goalReviewReserve: amount(1_234), groupRationale: "small" });
  expect(readEstimateRecord(h.store, "g", estimateId).state).toBe("ready");
}
const snapshotTask = (h: Fixture, estimateId: string, taskId: string) =>
  JSON.parse(readEstimateRecord(h.store, "g", estimateId).request!.planSnapshotCanonicalJson).tasks.find((t: { taskId: string }) => t.taskId === taskId);
const viewOf = (h: Fixture, estimateId: string) => readControlGroup(h.store, "epoch", "g").estimates.find((e) => e.estimateId === estimateId)!;
const reestimate = (h: Fixture, service: WebControlService) => service.createEstimate(h.command("estimate", {
  proposalVersion: readBudgetProposal(h.store, "g").proposalVersion, estimatorProfileId: "all", estimatorProfileHash: h.frozen.profileHash, estimateMode: "soft" }));

describe("an estimate sees the tasks' effective contracts (W6)", () => {
  it("builds an estimate made after a plan change from the changed contract, under the same planHash", async () => {
    const h = await fixture();
    try {
      const service = new WebControlService(h.deps);
      expect(service.setTaskLoop(change(h, "a", CHANGED))).toMatchObject({ result: { kind: "task-loop-set" } });
      const created = await reestimate(h, service) as { result: { estimateId: string } };
      const estimateId = created.result.estimateId;
      const record = readEstimateRecord(h.store, "g", estimateId);
      expect(record.request!.planHash).toBe(readArchivedPlan(h.store, "g").planHash);
      expect(JSON.parse(snapshotTask(h, estimateId, "a").originalContractCanonicalJson).objective.goal).toBe("write a, changed");
      expect(snapshotTask(h, estimateId, "a").loop.inputs.goal).toBe("write a, changed");
      // The import-time estimate still carries the contract it was built from.
      expect(JSON.parse(snapshotTask(h, h.estimateId, "a").originalContractCanonicalJson).objective.goal).toBe("write a");
      expect(viewOf(h, estimateId).stale).toBe(false);
    } finally { await h.dispose(); }
  });

  it("marks an estimate made before a plan change stale, and refuses applying its suggestion as estimate-stale", async () => {
    const h = await fixture();
    try {
      const service = new WebControlService(h.deps);
      await readyEstimate(h, service, h.estimateId);
      expect(viewOf(h, h.estimateId).stale).toBe(false);
      expect(service.setTaskLoop(change(h, "a", CHANGED))).toMatchObject({ result: { kind: "task-loop-set" } });
      expect(viewOf(h, h.estimateId).stale).toBe(true);
      const version = readBudgetProposal(h.store, "g").proposalVersion;
      const apply = service.editProposal(h.command("proposal-edit", { baseProposalVersion: version,
        operations: [{ target: { scope: "goal-review", dimension: "tokens" }, value: 1_234, provenance: "model", estimateId: h.estimateId }] }));
      expect(errorOf(apply)).toMatchObject({ code: "estimate-stale" });
      expect(readBudgetProposal(h.store, "g").proposalVersion).toBe(version);
      // The same number typed by a person is an ordinary edit.
      expect(service.editProposal(h.command("proposal-edit", { baseProposalVersion: version,
        operations: [{ target: { scope: "goal-review", dimension: "tokens" }, value: 1_234, provenance: "human" }] }))).toMatchObject({ result: { kind: "proposal-edited" } });
    } finally { await h.dispose(); }
  });

  it("does not mark an estimate stale when the contracts are unchanged, and the snapshot's forgeries stay recovery-blocked", async () => {
    const h = await fixture();
    try {
      const service = new WebControlService(h.deps);
      expect(service.setTaskLoop(change(h, "a", CHANGED))).toMatchObject({ result: { kind: "task-loop-set" } });
      const estimateId = ((await reestimate(h, service)) as { result: { estimateId: string } }).result.estimateId;
      const original = String(h.store.db.prepare("SELECT body FROM estimates WHERE group_id='g' AND id=?").get(estimateId)!.body);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const forge = (edit: (plan: any) => void) => {
        const body = JSON.parse(original);
        const plan = JSON.parse(body.request.planSnapshotCanonicalJson);
        edit(plan);
        body.request.planSnapshotCanonicalJson = canonicalBytes(plan).toString("utf8");
        body.requestHash = sha256Canonical(body.request);
        h.store.db.prepare("UPDATE estimates SET body=? WHERE group_id='g' AND id=?").run(canonicalBytes(body).toString("utf8"), estimateId);
        return () => readEstimateRecord(h.store, "g", estimateId);
      };
      const retarget = (task: { originalContractCanonicalJson: string; originalContractHash: string }, edit: (contract: { objective: { goal: string } }) => void) => {
        const contract = JSON.parse(task.originalContractCanonicalJson); edit(contract);
        task.originalContractCanonicalJson = canonicalBytes(contract).toString("utf8"); task.originalContractHash = sha256Canonical(contract);
      };
      // The plan outside its tasks is the archive's.
      expect(forge((plan) => { plan.goal = "forged"; })).toThrow("recovery-blocked");
      // No task is added.
      expect(forge((plan) => { plan.tasks.push({ ...plan.tasks[1], taskId: "d" }); })).toThrow("recovery-blocked");
      // A hand-written task's contract is never changed.
      expect(forge((plan) => { retarget(plan.tasks[1], (contract) => { contract.objective.goal = "forged"; }); })).toThrow("recovery-blocked");
      // ...not even to one a recipe it never had expands to.
      expect(forge((plan) => {
        const repoPath = JSON.parse(plan.tasks[1].originalContractCanonicalJson).context.repoPath;
        const expanded = expandLoopPlan("c", repoPath, "standard", inputs("c"));
        if (!expanded.ok) throw new Error(expanded.reason);
        Object.assign(plan.tasks[1], { loop: expanded.recipe, originalContractHash: expanded.hash, originalContractCanonicalJson: expanded.canonicalJson });
      })).toThrow("recovery-blocked");
      // A loop task changes only its recipe and contract.
      expect(forge((plan) => { plan.tasks[0].targetVersion = 7; })).toThrow("recovery-blocked");
      // Its contract hashes to its originalContractHash...
      expect(forge((plan) => { plan.tasks[0].originalContractHash = "0".repeat(64); })).toThrow("recovery-blocked");
      // ...and is what its recipe expands to.
      expect(forge((plan) => { retarget(plan.tasks[0], (contract) => { contract.objective.goal = "forged"; }); })).toThrow("recovery-blocked");
      h.store.db.prepare("UPDATE estimates SET body=? WHERE group_id='g' AND id=?").run(original, estimateId);
      expect(viewOf(h, estimateId).stale).toBe(false);
      // Changing the task back to its imported contract makes the post-change estimate stale and the import-time one current.
      expect(service.setTaskLoop(change(h, "a", { base: 1 }))).toMatchObject({ result: { kind: "task-loop-set" } });
      expect(viewOf(h, estimateId).stale).toBe(true);
      expect(viewOf(h, h.estimateId).stale).toBe(false);
    } finally { await h.dispose(); }
  });
});
