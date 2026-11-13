// Tester follow-up I (seat L; the controller's paid dogfood run, group g-28d9b560): a codex run stopped at its pause line
// mid-execute leaves a checkpoint whose attempt evidence is missing, so it is not `recoverable` -- and "continue" made a
// continuation that exportResumeBundle refuses: every claim blocked at A2 `resume-predecessor-unrecoverable`, recovery
// retry blocked it again, task retry and close-run pointed back at recovery retry, and recovery list and the group's
// blocker count said nothing. Why it matters: a person who chose "continue" must get the task working again, and a run
// that cannot go on by itself must be listed where a person looks, with the command that moves it.
// - A: a stopped run with no complete checkpoint is continued as a fresh run (no input checkpoint, the group branch as its
//   base, the usual fresh-run handoffs); one with a complete checkpoint is still resumed (liveCeilingSettle.test.ts,
//   usagePauseDecision.test.ts).
// - B: a run the pre-fix driver left blocked at A2 that way is listed in recovery list's `blockedRuns` with
//   `orca recovery retry --run <id>`, counted in recoveryBlockerCount (not in claimBlocked), and that command starts it.
import { describe, expect, it } from "vitest";
import { readStartEnvelope, stepA1 } from "../../src/control/executionDriver.js";
import { readWork } from "../../src/control/queries.js";
import { readWebGroup } from "../../src/control/webService.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { readControlGroup, readControlRecovery, readGroupSummary } from "../../src/panel/controlViews.js";
import { budgetStateLines } from "../../src/commands/domains/verbs.js";
import { USAGE_PAUSE_FRESH_START } from "../../src/control/driveRecord.js";
import type { StartEnvelope } from "../../src/control/executionPort.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";

type Harness = Awaited<ReturnType<typeof driverHarness>>;
const M = 1_000_000;
// What ccloop's candidate names missing for a run stopped inside its first execute (the real b89650fe checkpoint).
const MID_EXECUTE = ["attempts/1/execution.json", "attempts/1/verify.json"];

async function paused(decide = true): Promise<{ t: Harness; driver: ReturnType<Harness["driver"]>; first: string; knobs: { exhausted: boolean } }> {
  const knobs = { exhausted: true };
  const t = await driverHarness([{ taskId: "a" }], {
    tokenPolicy: "optional-v1", modelVersion: "followup-g",
    behaviour: () => knobs.exhausted ? "exhausted" : "succeed",
    workTokens: () => knobs.exhausted ? 10 * M : 10,
    candidateMissing: () => knobs.exhausted ? MID_EXECUTE : [],
    liveCeilingStop: (_id: string, envelope: StartEnvelope) => knobs.exhausted && envelope.liveCeiling !== undefined
      ? { revision: 1, tokens: envelope.liveCeiling.tokens, cause: "pause-line" as const, observedTokens: 10 * M, phase: "execute" as const, at: "boundary" as const } : undefined,
    stopReason: () => knobs.exhausted ? "live token ceiling reached" : null,
  });
  const limitNow = readWebGroup(t.h.store, "g").ledger.groupLimit;
  t.service.setLimit(t.h.command("set-limit", { limit: { ...limitNow, tokens: 20 * M } }));
  const work = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body));
  work.tokenIntent = { tokens: M, hard: false, provenance: "human", estimateId: null };
  t.h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='a'").run(JSON.stringify(work));
  const driver = t.driver();
  const first = await t.claim();
  await t.until(driver, () => t.body(first).state === "settled-recoverable", 200);
  // The real shape: settled recoverable as a run, but its checkpoint cannot be continued from.
  expect(t.body(first)).toMatchObject({ state: "settled-recoverable", recoverable: false, checkpointId: `ceiling-${first}` });
  expect(readWork(t.h.store, "g", "a")).toMatchObject({ status: "blocked", usagePause: { multiple: 1 }, allowancePredecessorRunId: first });
  if (decide) {
    const answer = t.service.usagePauseDecide(t.h.taskCommand("usage-pause-decide", "a", { decision: "continue" } as never));
    expect(answer).toMatchObject({ result: { kind: "usage-pause-decided", decision: "continue" } });
  }
  knobs.exhausted = false;
  return { t, driver, first, knobs };
}

async function claimNext(t: Harness, driver: ReturnType<Harness["driver"]>): Promise<string> {
  await driver.round();
  const claimed = await deliverScheduledStart(t.dispatch, "g");
  if (claimed.kind !== "claimed") throw new Error(JSON.stringify(claimed));
  return claimed.runId;
}

describe("continue at the pause line when the stopped run has no complete checkpoint (tester follow-up I, A and B)", { timeout: 300_000 }, () => {
  it("A: the task starts again as a fresh run from the group branch, and the stopped run's workspace goes", async () => {
    const { t, driver, first } = await paused();
    try {
      const second = await claimNext(t, driver);
      for (let i = 0; i < 400 && t.body(second).drive?.prepared !== true && t.body(second).state !== "blocked"; i++) await driver.round();
      // mutation A1 (resume whatever the predecessor): blocked at A2 resume-predecessor-unrecoverable -> red here.
      expect(t.body(second).drive).toMatchObject({ prepared: true, blockedAt: null });
      const envelope = readStartEnvelope(t.h.store, t.body(second));
      expect(envelope.inputCheckpoint).toBeNull();
      // A fresh run's base is the group's work branch, not the stopped run's base.
      expect(envelope.work.kind === "loop" ? envelope.work.base : null).toBe(git(t.repo, "rev-parse", "refs/heads/orca/g"));
      // It carries what every fresh run carries: its handoff directories.
      expect(envelope.work.kind === "loop" ? envelope.work.handoff : undefined).toBeDefined();
      // mutation A2 (no cleanup of the skipped predecessor): its workspace stays, cleanedUp false -> red here.
      expect(t.body(first).drive).toMatchObject({ cleanedUp: true, cleanupError: null });
      await t.until(driver, () => readWork(t.h.store, "g", "a").status === "done", 400);
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  it("B: a continuation the old driver blocked at A2 is listed with recovery retry, counted, and that retry starts it", async () => {
    const { t, driver } = await paused();
    try {
      const second = await claimNext(t, driver);
      // The stored row the pre-fix driver wrote for the real run-4c75c470: past A1, blocked at A2 before any provider call.
      expect(stepA1(t.deps, second)).toBe(true);
      const row = t.body(second);
      row.state = "blocked";
      row.drive = { ...row.drive, blockedAt: "A2", blockedReason: "resume-predecessor-unrecoverable" };
      t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(row), second);
      const next = `orca recovery retry --run ${second}`;
      // mutation B1 (no blockedRuns in the recovery view) -> red here.
      expect(readControlRecovery(t.h.store, "epoch").blockedRuns).toEqual([{ groupId: "g", taskId: "a", runId: second, blockedAt: "A2", reason: "resume-predecessor-unrecoverable", next }]);
      // mutation B2 (recoveryBlockerCount counts blocker rows only) -> red here. It does not hold the group's claims.
      expect(readGroupSummary(t.h.store, "g")).toMatchObject({ recoveryBlockerCount: 1, claimBlocked: false });
      const retried = await t.service.recoveryRetry(t.h.runCommand("recovery-retry", second, { scope: "run", runId: second }));
      expect("error" in retried ? retried.error : retried.result).toMatchObject({ kind: "recovery-observed", resolved: true });
      for (let i = 0; i < 400 && t.body(second).drive?.prepared !== true && t.body(second).state !== "blocked"; i++) await driver.round();
      expect(t.body(second).drive).toMatchObject({ prepared: true, blockedAt: null });
      expect(readStartEnvelope(t.h.store, t.body(second)).inputCheckpoint).toBeNull();
      expect(readControlRecovery(t.h.store, "epoch").blockedRuns).toBeUndefined();
      expect(readGroupSummary(t.h.store, "g").recoveryBlockerCount).toBe(0);
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  // Tester #295 residue (follow-up K): continue on such a run starts the task afresh (A above), so its partial work is gone.
  // A person or agent offered "continue|stop" must be told that before choosing, not find it out after.
  it("C: every place that offers continue says it restarts the task from scratch, discarding the partial work", async () => {
    const { t, driver, first } = await paused(false);
    try {
      expect(USAGE_PAUSE_FRESH_START).toMatch(/from scratch/);
      expect(USAGE_PAUSE_FRESH_START).toMatch(/discard/);
      // The board card's next step.
      expect(readGroupSummary(t.h.store, "g").card!.firstFailure).toEqual({ taskId: "a", cause: "usage-paused",
        next: "orca task decide-usage g a --decision continue|stop", note: USAGE_PAUSE_FRESH_START });
      // The CLI's next-step lines (group show) from the group view.
      const lines = budgetStateLines("g", readControlGroup(t.h.store, "epoch", "g") as never);
      expect(lines.join("\n")).toContain(USAGE_PAUSE_FRESH_START);
      // A run continue resumes from (a complete checkpoint) gets no such note: the note is about this run, not every pause.
      const setRecoverable = (value: boolean) => {
        const row = t.body(first);
        row.recoverable = value;
        t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(row), first);
      };
      setRecoverable(true);
      expect(readGroupSummary(t.h.store, "g").card!.firstFailure).not.toHaveProperty("note");
      expect(budgetStateLines("g", readControlGroup(t.h.store, "epoch", "g") as never).join("\n")).not.toContain(USAGE_PAUSE_FRESH_START);
      setRecoverable(false);
      // The decide-usage answer.
      const answer = t.service.usagePauseDecide(t.h.taskCommand("usage-pause-decide", "a", { decision: "continue" } as never));
      expect(answer).toMatchObject({ result: { kind: "usage-pause-decided", decision: "continue", note: USAGE_PAUSE_FRESH_START } });
      await driver.stop();
    } finally { await t.h.dispose(); }
  });
});
