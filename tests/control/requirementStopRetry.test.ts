import { describe, expect, it } from "vitest";
import { groupStopState, settleHandoffRequest } from "../../src/control/stopIntent.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { ROUND_ONE } from "./fixtures/requirementOutputs.js";

/**
 * Issue 91 (triage: the held wake is intentional; the real gap is this). A clarifying group stopped by handoff-stop
 * while its round's call was running ends in one of three stop states. recovery-retry lifted only handoff-complete;
 * a stop whose frozen call could not hand off (handoff-partial) or whose handoff outcome is unknown
 * (handoff-unresolved) had no retry at all, so the requirement stayed stopped with nothing to press.
 *
 * - handoff-partial: every frozen call is settled (a requirement call's settlement interrupts its round either way),
 *   so nothing is in flight -- the retry lifts the stop and re-queues the round, exactly as for handoff-complete.
 * - handoff-unresolved: a frozen call's outcome is not known, so the stop must NOT be lifted (a second call could run
 *   beside the first). The retry asks for that handoff's outcome again, as the run-scope retry does; once it settles
 *   the stop is complete or partial, and the next retry lifts it.
 */
/**
 * A clarifying group whose round 1 call is in flight, stopped by handoff-stop: one frozen run with an open handoff
 * request. The driver is not advanced after the stop, so the criterion settles that request itself.
 */
async function stoppedWhileDrafting() {
  const x = await requirementHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE }], stoppable: true });
  await x.until(() => x.runs()[0]?.state === "accepted" && x.fake.calls.collect > 0);
  expect(await x.service.handoffStop(x.command("handoff-stop", {}))).toMatchObject({ result: { kind: "handoff-stopped", frozenRunIds: [x.runs()[0]!.runId] } });
  const requestId = String(x.store.db.prepare("SELECT id FROM handoff_requests WHERE group_id='r'").get()!.id);
  const settle = (outcome: "settled-unrecoverable" | "outcome-unknown", reasonCode: string) =>
    settleHandoffRequest({ store: x.store, profileRouter: x.deps.router }, { requestId, outcome, reasonCode });
  const retry = () => x.service.recoveryRetry(x.command("recovery-retry", { scope: "group", groupId: "r" }));
  return { x, requestId, settle, retry };
}

describe("recovery-retry on a stopped clarifying group (issue 91)", () => {
  it("lifts a handoff-partial stop and re-queues the interrupted round, as it does a handoff-complete one", async () => {
    const { x, settle, retry } = await stoppedWhileDrafting();
    try {
      settle("settled-unrecoverable", "handoff-capability-unavailable");
      expect(groupStopState(x.store, "r")).toBe("handoff-partial");
      expect(x.round(1).state).toBe("interrupted");
      expect(await retry()).toMatchObject({ result: { kind: "recovery-observed", resolved: true } });
      expect(groupStopState(x.store, "r")).toBe("none");
      expect(x.group().stopped).toBe(false);
      expect(x.round(1).state).toBe("drafting");
      expect(x.store.db.prepare("SELECT kind FROM scheduler_wakes WHERE group_id='r' AND delivered=0").all().map((row) => String(row.kind))).toEqual(["requirement-call"]);
    } finally { await x.dispose(); }
  });

  it("asks again for a handoff-unresolved stop's unknown outcome, and keeps the stop while it is unknown", async () => {
    const { x, requestId, settle, retry } = await stoppedWhileDrafting();
    try {
      settle("outcome-unknown", "handoff-outcome-unknown");
      expect(groupStopState(x.store, "r")).toBe("handoff-unresolved");
      expect(await retry()).toMatchObject({ result: { kind: "recovery-observed", resolved: true } });
      const request = JSON.parse(String(x.store.db.prepare("SELECT body FROM handoff_requests WHERE id=?").get(requestId)!.body)) as { state: string };
      expect(request.state).toBe("request-pending");
      expect(x.store.db.prepare("SELECT id FROM outbox WHERE kind='handoff-recovery' AND delivered=0").all().map((row) => String(row.id))).toHaveLength(1);
      // Not lifted: the frozen call may still be running.
      expect(groupStopState(x.store, "r")).not.toBe("none");
      expect(x.group().stopped).toBe(true);
    } finally { await x.dispose(); }
  });
});
