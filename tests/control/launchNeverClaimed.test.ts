// Tester follow-up J (#308): ccloop 9c83b38 answers `{kind:"unknown", launch:"never-claimed"}` for an accepted execution
// whose launcher gave up before any worker claimed it -- nothing ran, and a re-issued accept with the same envelope
// launches it afresh. Why it matters: the dogfood split sat blocked as `inspect-unknown` after ten inspections of a worker
// that never existed, `recovery list` was empty and `group show` said only `requirement-not-split`.
// - A: B' re-issues the stored envelope byte for byte (bounded by LAUNCH_RELAUNCH_LIMIT) and the run goes on when a
//   relaunch is claimed; never more than the limit, then blocked `launch-never-claimed` at B' (not ten inspections).
// - B: such a blocked requirement call is in `recovery list` (blockedCalls) and the requirement summary with
//   `orca recovery retry --run`, `group show`'s refusal names it, and the retry relaunches with the count reset.
import { describe, expect, it } from "vitest";
import { LAUNCH_RELAUNCH_LIMIT } from "../../src/control/executionDriver.js";
import { readControlGroup, readControlRecovery, requirementSummaryOf } from "../../src/panel/controlViews.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { ROUND_ONE, ROUND_TWO } from "./fixtures/requirementOutputs.js";

describe("B': a launch no worker claimed is accepted again, bounded (#308)", () => {
  it("relaunches with the same envelope bytes and goes on once a relaunch is claimed", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "never-claimed-once" }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "accepted" || t.body(runId).state === "blocked");
      // mutation A1 (stepBPrime treats never-claimed as a plain unknown) -> red here: one accept, then inspect-unknown.
      expect(t.body(runId).state).toBe("accepted");
      expect(t.fake.calls.accept).toHaveLength(2);
      expect(t.fake.calls.accept[1]).toEqual(t.fake.calls.accept[0]);
      expect(t.body(runId).drive).toMatchObject({ relaunches: 1, inspectUnknown: 0, blockedReason: null });
    } finally { await t.h.dispose(); }
  });

  it("blocks `launch-never-claimed` at B' after LAUNCH_RELAUNCH_LIMIT relaunches, not after ten inspections", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "never-claimed" }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      // mutation A2 (no limit check) -> red here (the run keeps relaunching until inspect-unknown or the round cap).
      expect(t.body(runId).drive).toMatchObject({ blockedAt: "B'", blockedReason: "launch-never-claimed", relaunches: LAUNCH_RELAUNCH_LIMIT });
      expect(t.fake.calls.accept).toHaveLength(1 + LAUNCH_RELAUNCH_LIMIT);
      expect(t.fake.calls.inspect).toBe(LAUNCH_RELAUNCH_LIMIT + 1);
      expect(t.h.store.dispatchBlocked).toBe(false);
    } finally { await t.h.dispose(); }
  });
});

describe("a requirement call blocked on a launch no worker claimed is visible and retryable (#308)", () => {
  it("is in recovery list and the summary with recovery retry, group show names it, and the retry relaunches", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE }, { purpose: "clarify", output: ROUND_TWO }] });
    try {
      await x.until(() => x.round(1).state === "awaiting-answers");
      x.fake.neverClaim(1 + LAUNCH_RELAUNCH_LIMIT);
      const result = x.round(1).result!;
      expect(x.service.answerRequirement(x.command("requirement-answer", { roundNo: 1, answers: result.questions.map((q) => ({ id: q.id, kind: "recommended" })),
        glossaryDecisions: result.glossary.map((e) => ({ id: e.id, accept: true })), adrDecisions: result.adrs.map((a) => ({ id: a.id, accept: false })) }))).toMatchObject({ result: { nextRoundNo: 2 } });
      const roundTwo = () => x.runs().filter((run) => run.workItemId === "round-2");
      await x.until(() => roundTwo().some((run) => run.state === "blocked"));
      const runId = roundTwo()[0]!.runId as string, next = `orca recovery retry --run ${runId}`;
      // mutation B1 (blockedCallRows returns nothing) -> red here.
      expect(readControlRecovery(x.store, "epoch").blockedCalls).toEqual([{ groupId: "r", runId, purpose: "clarify", blockedAt: "B'", reason: "launch-never-claimed", next }]);
      // mutation B2 (the summary's blocked call names no next for a B' block) -> red here.
      expect(requirementSummaryOf(x.store, "r").blockedRun).toEqual({ runId, reason: "launch-never-claimed", next });
      // mutation B3 (requirement-not-split without the blocked call) -> red here.
      expect(() => readControlGroup(x.store, "epoch", "r")).toThrow(`requirement-not-split:requirement call ${runId} blocked: launch-never-claimed`);
      const retried = await x.service.recoveryRetry(x.command("recovery-retry", { scope: "run", runId }, { kind: "run", groupId: "r", runId }));
      expect("error" in retried ? retried.error : retried.result).toMatchObject({ kind: "recovery-observed", resolved: true });
      // mutation B4 (recovery-retry keeps the relaunch count) -> red here: the resumed run blocks again with no accept.
      expect(x.runs().find((run) => run.runId === runId)!.drive.relaunches).toBeUndefined();
      await x.until(() => x.round(2).state === "awaiting-answers");
      expect(x.fake.calls.accept.filter((envelope) => envelope.claim.runId === runId)).toHaveLength(2 + LAUNCH_RELAUNCH_LIMIT);
      expect(readControlRecovery(x.store, "epoch").blockedCalls).toBeUndefined();
    } finally { await x.dispose(); }
  });
});
