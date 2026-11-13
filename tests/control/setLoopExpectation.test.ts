// Tester #307 (follow-up J): in an expectation-model group, `task set-loop` with a finite work token budget wrote it as
// the task's authored ceiling, while the claim gives every expectation-model task run a null token grant (its live ceiling
// bounds it, webDispatch.ts createStartingRun). The funded-allowance read then judged the null grant over the finite
// authored remainder as forged (`funded-grant-authority`), so `group show`, `task show` and `run show` answered 423 from the
// first claim on; and the 500M never reached the task's expectation, so its pause line stayed 10x the estimate.
// Read side: an expectation-model run's null work-token grant is accepted whatever the authored ceiling (a row already
// stored that way reads without a DB edit). Write side: set-loop in such a group writes the amount as the task's token
// intent, as `proposal set-budget` does (G spec §2.2, §10.3: an expectation, never a cap; set-loop has no hard switch).
import { describe, expect, it } from "vitest";
import { readRun } from "../../src/control/budget.js";
import { taskExpectation } from "../../src/control/expectationModel.js";
import { pauseLineOf } from "../../src/control/liveCeiling.js";
import { readGroup, readWork } from "../../src/control/queries.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { WebControlService } from "../../src/control/webService.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { change, errorOf, loop, workAllocation, workBody, writeWork, type Fixture } from "./fixtures/taskLoop.js";
import { webFixture } from "./fixtures/web.js";

const M = 1_000_000;
const BIG = 500 * M;

async function claimAfterConfirm(h: Fixture, service: WebControlService): Promise<string> {
  expect(await service.confirm(h.command("confirm", { ...await h.confirmPayload(), budgetMode: "soft" }))).toMatchObject({ result: { kind: "confirmed" } });
  expect(await service.start(h.command("start", {}))).not.toHaveProperty("error");
  const claim = await deliverScheduledStart(h.deps, "g");
  if (claim.kind !== "claimed") throw new Error(`claim: ${JSON.stringify(claim)}`);
  return claim.runId;
}

describe("set-loop with a finite token budget in an expectation-model group (#307)", () => {
  it("writes the amount as the task's soft token intent, its expectation follows it, and every view reads", async () => {
    // The default model for a new group is the expectation model (followup-g); its token limit is null here.
    const h = await webFixture(undefined, [{ taskId: "a", loop: loop("a") }], { tokenPolicy: "optional-v1" });
    try {
      const service = new WebControlService(h.deps);
      const before = workAllocation(h, "a").amount;
      expect(errorOf(await service.setTaskLoop(change(h, "a", { tokens: BIG })))).toBeUndefined();
      // mutation: drop the tokenIntent write in setTaskLoop -> no intent, the expectation stays the estimate's, red
      expect(workBody(h, "a").tokenIntent).toEqual({ tokens: BIG, hard: false, provenance: "human", estimateId: null });
      // Like set-budget: the allocation's tokens stay as they were (bounded by the group), only the intent moved.
      expect(workAllocation(h, "a").amount.tokens).toBe(before.tokens);
      // The same amount again changes nothing.
      expect(errorOf(await service.setTaskLoop(change(h, "a", { base: 1, tokens: BIG })))).toMatchObject({ code: "no-op-command" });
      // The plan card sends the allocation's own tokens with a change of inputs; that keeps the person's expectation.
      // mutation: write the intent whenever the group is expectation-model (drop the equal-to-allocation guard) -> cleared, red
      expect(errorOf(await service.setTaskLoop(change(h, "a", { base: 1, inputs: { goal: "write a, again" } })))).toBeUndefined();
      expect(workBody(h, "a").tokenIntent).toMatchObject({ tokens: BIG });
      const runId = await claimAfterConfirm(h, service);
      const work = readWork(h.store, "g", "a");
      expect(taskExpectation(h.store, "g", work as never)).toMatchObject({ tokens: BIG, source: "intent" });
      // This group has no token limit, so the task has no pause line (#300); in a finite group it is min(10 x 500M, L/2).
      expect(pauseLineOf(h.store, readGroup(h.store, "g"), work as never)).toBeNull();
      expect(readRun(h.store, runId).grant.work.tokens).toBeNull();
      // group show, task show and run show all read this view (run show finds the run in it).
      expect(readControlGroup(h.store, "epoch", "g").runs.map((r) => r.runId)).toContain(runId);
    } finally { await h.dispose(); }
  });

  it("a run already stored with a finite authored ceiling and a null grant (the tester's row) reads without a DB edit", async () => {
    const h = await webFixture(undefined, [{ taskId: "a", loop: loop("a") }], { tokenPolicy: "optional-v1" });
    try {
      const service = new WebControlService(h.deps);
      const runId = await claimAfterConfirm(h, service);
      // The shape the old set-loop left behind: the work item's authored work tokens finite, the claim's funded allowance
      // and the run's token policy naming them as its authored ceiling, and the grant null (the expectation-model claim).
      const work = workBody(h, "a") as { grant: { work: Record<string, unknown> } };
      writeWork(h, "a", { grant: { ...work.grant, work: { ...work.grant.work, tokens: BIG } } });
      const allowance = JSON.parse(String(h.store.db.prepare("SELECT body FROM funded_allowances WHERE run_id=?").get(runId)!.body));
      h.store.db.prepare("UPDATE funded_allowances SET body=? WHERE run_id=?").run(JSON.stringify({ ...allowance, authoredTokenCeiling: BIG }), runId);
      const run = JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body));
      h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({ ...run, tokenPolicy: { ...run.tokenPolicy, authoredTokenCeiling: BIG } }), runId);
      expect(run.grant.work.tokens).toBeNull();
      // mutation: drop the expectation-model acceptance in readFundedAllowance -> recovery-blocked:funded-grant-authority, red
      // group show, task show and run show all read this view (run show finds the run in it).
      expect(readControlGroup(h.store, "epoch", "g").runs.map((r) => r.runId)).toContain(runId);
    } finally { await h.dispose(); }
  });
});
