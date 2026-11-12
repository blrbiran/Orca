import { describe, expect, it } from "vitest";
import { readArtifact } from "../../src/control/archive.js";
import { withCommandContext } from "../../src/control/commandClient.js";
import { buildNoChangeJudgePrompt, JUDGE_BASE_MAX_BYTES } from "../../src/control/noChangeJudge.js";
import { reopenEligibility } from "../../src/control/reopenTask.js";
import { readWebGroup } from "../../src/control/webService.js";
import { replenishStartWakes } from "../../src/control/executionDriver.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { answerSingleCalls, type SingleCallAnswer } from "./fixtures/singleCallAnswers.js";

/**
 * Tester follow-up G spec §10.1 (controller's call): a command verifier never judges the goal, so a command-verified run
 * that changed nothing asks one goal-judge call first. `met` completes the task as no change naming the judge; `not-met`
 * and `cannot-judge` re-run it once in the same group with the finding as its note; a second no change stops in Problems
 * as `no-change-twice`, where a person or an orchestrating agent accepts it as no change or reopens it.
 */
type Harness = Awaited<ReturnType<typeof driverHarness>>;
const workOf = (t: Harness, taskId = "a") => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body));
const rowsOf = (t: Harness, kind: string) => t.h.store.db.prepare("SELECT body FROM activity WHERE group_id='g' AND kind=? ORDER BY seq").all(kind).map((r) => JSON.parse(String(r.body)));
const workRuns = (t: Harness) => t.h.store.db.prepare("SELECT id FROM runs WHERE group_id='g' AND work_item_id='a' ORDER BY rowid").all().map((r) => String(r.id));
const proofOf = async (t: Harness, runId: string) => {
  const row = t.h.store.db.prepare("SELECT body FROM outbox WHERE id=?").get(`acceptance:${runId}`);
  if (row === undefined) return null;
  const record = JSON.parse(String(row.body));
  return { accepted: record.accepted, ...JSON.parse((await readArtifact(t.h.store, record.source)).toString()) };
};

/** The driver arms a start wake for the ready task (replenishStartWakes); delivering it claims the re-run. */
async function claimAgain(t: Harness): Promise<string> {
  replenishStartWakes({ store: t.h.store, admissionGate: t.h.deps.admissionGate });
  const delivered = await deliverScheduledStart(t.dispatch, "g");
  if (delivered.kind !== "claimed") throw new Error(`no claim: ${JSON.stringify(delivered)}`);
  return delivered.runId;
}

/** A command-verified task that changes nothing, whose goal judge answers `answers` in order. */
async function judged(answers: SingleCallAnswer[], options: Parameters<typeof driverHarness>[1] = {}) {
  const t = await driverHarness([{ taskId: "a" }], { files: () => ({}), ...options });
  // Room in the group's limit for the judge's call and a full re-run (the fixture's limit fits one run's attempts).
  const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
  const raised = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, activeMs: limit.activeMs * 4, attempts: limit.attempts + 20, sessions: limit.sessions + 20 } }));
  if ("error" in raised) throw new Error(`set-limit refused: ${JSON.stringify(raised.error)}`);
  const queue = [...answers];
  const seen = answerSingleCalls(t, () => queue.shift() ?? { outcome: "complete", output: { verdict: "met", finding: "fallback" } });
  const first = await t.claim();
  return { t, first, calls: seen.calls, driver: t.driver() };
}

describe("the goal judge decides a command-verified no-change run (tester follow-up G §10.1)", () => {
  it("met completes the task as no change and names the judge", async () => {
    const { t, first, calls, driver } = await judged([{ outcome: "complete", output: { verdict: "met", finding: "already implemented in base.txt" } }]);
    try {
      await t.until(driver, () => workOf(t).status === "done");
      expect(calls.map((c) => c.purpose)).toEqual(["no-change-judge"]);
      // mutation M5a: skip the acceptance insert on met -> no proof, red
      expect(await proofOf(t, first)).toMatchObject({ accepted: true, landing: "no-change", decidedBy: "judge", judge: { finding: "already implemented in base.txt" } });
      expect(rowsOf(t, "no-change-completed")).toEqual([expect.objectContaining({ runId: first, decidedBy: "judge", ordinal: 1, judge: expect.objectContaining({ finding: "already implemented in base.txt" }) })]);
      expect(t.body(first).drive.noChangeJudge).toMatchObject({ state: "met" });
      expect(t.body(first).drive.blockedReason).toBeNull();
    } finally { await t.h.dispose(); }
  }, 60000);

  it("not-met re-runs the task once in the same group with the finding as its note", async () => {
    const finding = "README.md does not say how to run the tool";
    const { t, first, driver } = await judged([{ outcome: "complete", output: { verdict: "not-met", finding } }]);
    try {
      // mutation M5b: skip the reopen -> the task never becomes ready again, red (the driver does not reach the state)
      await t.until(driver, () => workOf(t).status === "ready");
      const second = await claimAgain(t);
      expect(t.body(second).operatorNote).toEqual({ text: finding, scope: "remaining-attempts" });
      expect(rowsOf(t, "no-change-judged")).toEqual([expect.objectContaining({ verdict: "not-met", finding })]);
      // The judge's own re-run withdrew nothing (no acceptance existed), so no person's revoke row is written.
      expect(rowsOf(t, "no-change-revoked")).toEqual([]);
      expect(t.body(first).drive.noChangeJudge).toMatchObject({ state: "not-met", finding });
    } finally { await t.h.dispose(); }
  }, 60000);

  it("cannot-judge and an invalid answer are treated as not-met", async () => {
    for (const output of [{ verdict: "cannot-judge", finding: "base.txt is not shown in full" }, { nonsense: 1 }]) {
      const { t, driver } = await judged([{ outcome: "complete", output }]);
      try {
        // mutation M5c: treat cannot-judge as met -> done, never ready again, red
        await t.until(driver, () => workOf(t).status === "ready" || workOf(t).status === "done");
        expect(workOf(t).status).toBe("ready");
        expect(t.body(await claimAgain(t)).operatorNote?.scope).toBe("remaining-attempts");
        expect(rowsOf(t, "no-change-judged")[0]!.verdict).toBe("cannot-judge");
      } finally { await t.h.dispose(); }
    }
  }, 90000);

  it("a second no-change after the judge's re-run stops as no-change-twice; accept-no-change completes it", async () => {
    const { t, calls, driver } = await judged([{ outcome: "complete", output: { verdict: "not-met", finding: "add a usage section" } }]);
    try {
      await t.until(driver, () => workOf(t).status === "ready");
      const second = await claimAgain(t);
      await t.until(driver, () => typeof t.body(second).drive?.blockedReason === "string" || calls.length > 1);
      expect(t.body(second).drive.blockedReason).toBe("no-change-twice");
      // mutation M5d: drop the noChangeRerun check -> a second judge call, red
      expect(calls.length).toBe(1);
      expect(reopenEligibility(t.h.store, "g", "a", second)).toBe("blocked");
      const command = t.h.command("accept-no-change", { taskId: "a", runId: second, note: "base.txt already covers the goal" });
      const accepted = await withCommandContext(command.commandId, { client: "web", principal: "user:owner" }, () => t.service.acceptNoChange(command));
      expect(accepted).toMatchObject({ result: { kind: "no-change-accepted", taskId: "a", runId: second } });
      expect(workOf(t).status).toBe("done");
      expect(await proofOf(t, second)).toMatchObject({ accepted: true, landing: "no-change", decidedBy: "person", note: "base.txt already covers the goal" });
      expect(rowsOf(t, "no-change-completed").at(-1)).toMatchObject({ runId: second, decidedBy: "person", note: "base.txt already covers the goal" });
    } finally { await t.h.dispose(); }
  }, 90000);

  it("an unfunded judge is named on the run and the task can still be reopened", async () => {
    let capped = false;
    const t0: { t?: Harness } = {};
    const { t, first, calls, driver } = await judged([], { duringCollect: async () => {
      if (capped || t0.t === undefined) return; capped = true;
      // A spend cap reached while the run works: the judge's claim cannot be funded (the work run's claim was before it).
      const cap = t0.t.h.rawCommand("cap-1", 0, "set-spend-cap", { kind: "spend" } as never, { scope: "all", period: "total", tokens: 1 });
      const set = withCommandContext(cap.commandId, { client: "web", principal: "user:owner" }, () => t0.t!.service.setSpendCap(cap as never));
      if ("error" in (set as object)) throw new Error(`set-spend-cap refused: ${JSON.stringify(set)}`);
    } });
    t0.t = t;
    try {
      await t.until(driver, () => t.body(first).drive?.cleanedUp === true);
      // mutation M5e: claim regardless of funding -> a judge call, red
      expect(t.body(first).drive.blockedReason).toBe("no-change-judge-unfunded:spend-cap");
      expect(calls).toEqual([]);
      expect(reopenEligibility(t.h.store, "g", "a", first)).toBe("blocked");
    } finally { await t.h.dispose(); }
  }, 60000);

  it("a failed judge call names its code on the work run", async () => {
    const { t, first, driver } = await judged([{ outcome: "failed", errorCode: "codex-timeout" }]);
    try {
      await t.until(driver, () => typeof t.body(first).drive?.blockedReason === "string" && t.body(first).drive.blockedReason.startsWith("no-change-judge-failed"));
      expect(t.body(first).drive.blockedReason).toBe("no-change-judge-failed:codex-timeout");
      expect(reopenEligibility(t.h.store, "g", "a", first)).toBe("blocked");
    } finally { await t.h.dispose(); }
  }, 60000);

  it("the judge prompt carries the goal, the explanation and the base tree, bounded", async () => {
    const { t, calls, driver } = await judged([{ outcome: "complete", output: { verdict: "met", finding: "ok" } }]);
    try {
      await t.until(driver, () => workOf(t).status === "done");
      const prompt = calls[0]!.prompt;
      expect(prompt).toContain("Task goal: ship");
      expect(prompt).toContain("Success condition: passes");
      expect(prompt).toContain("- base.txt");
      expect(prompt).toContain("(the agent gave none)");
      expect(prompt).not.toContain("were cut to fit");
    } finally { await t.h.dispose(); }
    const big = buildNoChangeJudgePrompt({ goal: "g", successCondition: "s", requiredChecks: ["true"], explanation: "nothing was missing", baseListing: ["a"], baseFiles: [{ path: "a", text: "x".repeat(JUDGE_BASE_MAX_BYTES) }], truncated: true });
    expect(big).toContain("nothing was missing");
    expect(big).toContain("were cut to fit");
  }, 60000);
});
