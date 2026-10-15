import { describe, expect, it } from "vitest";
import { readConfirmedTaskExecution } from "../../src/control/executionSnapshot.js";
import { WebControlService, readWebGroup } from "../../src/control/webService.js";
import { deliverScheduledStart, readWorkClaimEnvelope } from "../../src/control/webDispatch.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { change, errorOf, loop, workBody } from "./fixtures/taskLoop.js";
import { webFixture } from "./fixtures/web.js";

// Start guard spec (2026-10-15) §3.3, criteria 7 and 8 (human ruling 2): a task's loop plan stays editable while its group
// runs; an edit reaches only tasks not yet started. The states are built by production code, never a flipped status --
// a flipped column passes checks that a real running group would not.
type T = Awaited<ReturnType<typeof driverHarness>>;
const THREE = [{ taskId: "a", loop: loop("a") }, { taskId: "b", loop: loop("b") }, { taskId: "c", loop: loop("c") }];
const pendingStart = (t: T) => t.h.store.db.prepare("SELECT id FROM scheduler_wakes WHERE group_id='g' AND kind IN ('start','no-start') AND delivered=0").get() !== undefined;
async function claimSecond(t: T, driver: ReturnType<T["driver"]>): Promise<string> {
  await t.until(driver, () => pendingStart(t));
  const claimed = await deliverScheduledStart(t.dispatch, "g");
  if (claimed.kind !== "claimed") throw new Error(JSON.stringify(claimed));
  return claimed.runId;
}

describe("set-task-loop while the group runs (spec B §3.3)", () => {
  it("C7: in a review group, after a checkpoint and with another task running, an unstarted task's plan changes and nothing else does", async () => {
    const t = await driverHarness(THREE, { behaviour: (id) => (id === "b" ? "stoppable" : "succeed") });
    try {
      const driver = t.driver();
      await t.claim();
      const runB = await claimSecond(t, driver);
      await t.until(driver, () => readWebGroup(t.h.store, "g").status === "review" && t.body(runB).state === "accepted");
      const before = { a: workBody(t.h, "a").derivedContractHash, b: workBody(t.h, "b").derivedContractHash, c: workBody(t.h, "c").derivedContractHash };
      expect(errorOf(await t.service.setTaskLoop(change(t.h, "b", { inputs: { goal: "write b, changed" } })))).toMatchObject({ code: "task-already-started" });
      expect(await t.service.setTaskLoop(change(t.h, "c", { inputs: { goal: "write c, changed" } }))).toMatchObject({ result: { kind: "task-loop-set", taskId: "c", loopVersion: 1 } });
      expect(readConfirmedTaskExecution(t.h.store, "g", "c").contract.objective.goal).toBe("write c, changed");
      expect([workBody(t.h, "a").derivedContractHash, workBody(t.h, "b").derivedContractHash]).toEqual([before.a, before.b]);
      expect(workBody(t.h, "c").derivedContractHash).not.toBe(before.c);
    } finally { await t.h.dispose(); }
  }, 60_000);

  it("C7: a paused group takes a change to an unstarted task", async () => {
    const h = await webFixture(undefined, [{ taskId: "a", loop: loop("a") }, { taskId: "b", loop: loop("b") }]);
    try {
      const service = new WebControlService(h.deps);
      expect(await service.confirm(h.command("confirm", await h.confirmPayload()))).not.toHaveProperty("error");
      expect(await service.pauseDispatch(h.command("pause-dispatch", {}))).toMatchObject({ result: { kind: "paused" } });
      expect(await service.setTaskLoop(change(h, "a", { inputs: { goal: "write a, changed" } }))).toMatchObject({ result: { kind: "task-loop-set", taskId: "a" } });
    } finally { await h.dispose(); }
  });

  it("C7: a handoff-stopped group does not", async () => {
    const h = await webFixture(undefined, [{ taskId: "a", loop: loop("a") }, { taskId: "b", loop: loop("b") }]);
    try {
      const service = new WebControlService(h.deps);
      expect(await service.confirm(h.command("confirm", await h.confirmPayload()))).not.toHaveProperty("error");
      expect(await service.handoffStop(h.command("handoff-stop", {}))).toMatchObject({ result: { kind: "handoff-stopped" } });
      expect(await service.setTaskLoop(change(h, "a", { inputs: { goal: "write a, changed" } }))).toMatchObject({ error: { code: "group-state-invalid" } });
    } finally { await h.dispose(); }
  });

  it("C8: a task whose run finished keeps its contract -- its change is refused, another's is accepted, and its retry runs the contract frozen at its claim", async () => {
    const t = await driverHarness(THREE, { behaviour: (id) => (id === "b" ? "failed" : "succeed") });
    try {
      const driver = t.driver();
      await t.claim();
      const runB = await claimSecond(t, driver);
      await t.until(driver, () => readWebGroup(t.h.store, "g").status === "review" && t.body(runB).state === "blocked");
      const frozen = workBody(t.h, "b").derivedContractHash;
      expect(t.service.retryTask(t.h.command("retry-task", { taskId: "b" }))).toMatchObject({ result: { kind: "task-retried", taskId: "b" } });
      expect(workBody(t.h, "b").status).toBe("ready");
      expect(errorOf(await t.service.setTaskLoop(change(t.h, "b", { inputs: { goal: "write b, changed" } })))).toMatchObject({ code: "task-already-started" });
      expect(await t.service.setTaskLoop(change(t.h, "c", { inputs: { goal: "write c, changed" } }))).toMatchObject({ result: { kind: "task-loop-set", taskId: "c" } });
      const retried = await claimSecond(t, driver);
      expect([t.body(retried).taskId, readWorkClaimEnvelope(t.h.store, "g", retried).derivedContractHash]).toEqual(["b", frozen]);
    } finally { await t.h.dispose(); }
  }, 60_000);
});
