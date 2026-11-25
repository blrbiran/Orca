// #478 (spec 2026-11-25-ceiling-stop-keeps-work-design.md §5.2, §6 criteria 6-8, 11): a live-ceiling stop ccloop judged
// resumable carries its continuation (allowanceContinuation, the saved state, the usage ledger) in the handoff packet. Orca
// validates it inside the ceiling settle, settles the run continuable, routes the task as before (auto-continue, group-cap
// wait, pause-line wait), and the next claim continues that run -- resuming its attempt, which is counted once (goal 2).
// The synthetic ccloop (fixtures/driverPort.ts `ceilingContinuation`) writes ccloop's packet shape (ccloop handoff.ts).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readGroupActivity } from "../../src/control/activity.js";
import { archiveAdmission, collectInto, readStartEnvelope, stepC } from "../../src/control/executionDriver.js";
import { commitCandidate, readCommittedCheckpoint } from "../../src/control/checkpoints.js";
import { archiveRun } from "../../src/control/archive.js";
import { readFundedAllowance } from "../../src/control/fundedAllowance.js";
import type { Candidate } from "../../src/control/types.js";
import { readWork } from "../../src/control/queries.js";
import { persistedRunProblem, readControlGroup, readControlRecovery, readGroupSummary } from "../../src/panel/controlViews.js";
import { withCommandContext } from "../../src/control/commandClient.js";
import { budgetStateLines, ceilingStopNext } from "../../src/commands/domains/verbs.js";
import { readWebGroup } from "../../src/control/webService.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import type { StartEnvelope } from "../../src/control/executionPort.js";
import { driverHarness } from "./fixtures/driverHarness.js";

type Harness = Awaited<ReturnType<typeof driverHarness>>;
const M = 1_000_000;

interface Knobs { exhausted: boolean; workTokens: number; cause: "group" | "pause-line" | "task-cap"; nextPhase: "plan" | "execute" | "verify" | null; phase?: "plan" | "execute" | "verify"; at?: "mid-call" | "boundary"; savedStop?: unknown }
async function harness(limit: number, knobs: Knobs, extra: Parameters<typeof driverHarness>[1] = {}): Promise<Harness> {
  const stopOf = (envelope: StartEnvelope) => ({ revision: envelope.liveCeiling!.revision, tokens: envelope.liveCeiling!.tokens, cause: knobs.cause, observedTokens: knobs.workTokens, phase: knobs.phase ?? "execute", at: knobs.at ?? "mid-call" });
  const t = await driverHarness([{ taskId: "a" }], {
    tokenPolicy: "optional-v1", modelVersion: "followup-g",
    behaviour: () => knobs.exhausted ? "exhausted" : "stoppable",
    workTokens: () => knobs.workTokens,
    liveCeilingStop: (_id: string, envelope: StartEnvelope) => knobs.exhausted && envelope.liveCeiling !== undefined ? stopOf(envelope) : undefined,
    ceilingContinuation: () => knobs.nextPhase === null ? undefined : { nextPhase: knobs.nextPhase, ...(knobs.savedStop === undefined ? {} : { savedStop: knobs.savedStop }) },
    stopReason: () => knobs.exhausted ? "live token ceiling reached" : null,
    ...extra,
  });
  setLimit(t, limit);
  return t;
}
function setLimit(t: Harness, tokens: number): unknown {
  const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
  return t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, tokens } }));
}
const work = (t: Harness) => readWork(t.h.store, "g", "a") as unknown as Record<string, unknown> & { status: string; grant: { work: { attempts: number } } };
/** The task's authored attempts, set before its first claim (a 1-attempt task, spec §6 criterion 3's Orca half). */
function authorAttempts(t: Harness, attempts: number): void {
  const body = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body));
  body.grant.work.attempts = attempts;
  t.h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='a'").run(JSON.stringify(body));
}
const setIntent = (t: Harness, intent: unknown) => {
  const body = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body));
  body.tokenIntent = intent;
  t.h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='a'").run(JSON.stringify(body));
};
async function nextRun(t: Harness, driver: ReturnType<Harness["driver"]>): Promise<string> {
  await driver.round();
  const delivered = await deliverScheduledStart(t.dispatch, "g");
  if (delivered.kind !== "claimed") throw new Error(`no claim: ${JSON.stringify(delivered)}`);
  return delivered.runId;
}
async function prepared(t: Harness, driver: ReturnType<Harness["driver"]>, runId: string): Promise<void> {
  for (let i = 0; i < 400 && t.body(runId).drive?.prepared !== true; i++) await driver.round();
}
/** What makes a continuation one (stepA2): its envelope's input checkpoint is the stopped run's, and it resumed that attempt. */
function expectContinues(t: Harness, second: string, first: string): void {
  expect(readStartEnvelope(t.h.store, t.body(second)).inputCheckpoint).toMatchObject({ predecessorRunId: first });
  expect(t.body(second).resumesAttemptOf).toBe(first);
  // Criterion 7 (Orca half): the lineage inherits the stopped run's work tokens whole, and its attempt once.
  expect(t.body(second).tokenPolicy.inheritedUsage).toMatchObject({ tokens: t.body(first).cumulative.work.tokens, attempts: 0 });
  // readFundedAllowance re-derives the same lineage from the stored rows, so the group view and retry can read the run.
  expect(readFundedAllowance(t.h.store, t.body(second))?.inheritedUsage.attempts).toBe(0);
  expect(persistedRunProblem(t.body(first))).toBeNull();
  expect(persistedRunProblem(t.body(second))).toBeNull();
}

describe("a resumable live-ceiling stop keeps its paid work (#478 §5.2)", { timeout: 300_000 }, () => {
  // mutation: drop `ceilingContinuation=mark` in settleCeilingStop's onSettled -> no mark, no resumesAttemptOf, red
  // mutation: drop the resumedAttempts subtraction in inheritedWorkUsage -> grant attempts 0, no claim, red
  it("is continuable and auto-continues at ≥1M headroom; a 1-attempt task resumes its only attempt", async () => {
    const knobs: Knobs = { exhausted: true, workTokens: 2 * M, cause: "group", nextPhase: "execute" };
    const t = await harness(20 * M, knobs);
    try {
      authorAttempts(t, 1);
      const driver = t.driver();
      const first = await t.claim();
      await t.until(driver, () => t.body(first).state === "settled-recoverable", 200);
      expect(t.body(first)).toMatchObject({ recoverable: true, ceilingContinuation: { nextPhase: "execute", resumesAttempt: true } });
      expect((await readCommittedCheckpoint(t.h.store, first)).missing).toEqual([]);
      expect(work(t)).toMatchObject({ status: "ready", allowancePredecessorRunId: first });
      knobs.exhausted = false;
      const second = await nextRun(t, driver);
      expect(t.body(second).grant.work.attempts).toBe(1);
      await prepared(t, driver, second);
      expectContinues(t, second, first);
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  it("below 1M it waits at the group cap, and set-limit continues it", async () => {
    const knobs: Knobs = { exhausted: true, workTokens: 0, cause: "group", nextPhase: "verify" };
    const t = await harness(3 * M, knobs);
    try {
      const driver = t.driver();
      const first = await t.claim();
      knobs.workTokens = t.body(first).liveCeiling.tokens - 100_000;
      await t.until(driver, () => t.body(first).state === "settled-recoverable", 200);
      expect(t.body(first)).toMatchObject({ recoverable: true, ceilingContinuation: { nextPhase: "verify", resumesAttempt: true } });
      expect(work(t)).toMatchObject({ status: "blocked", groupCapStop: { runId: first } });
      expect(setLimit(t, 13 * M)).toMatchObject({ result: { kind: "limit-set" } });
      knobs.exhausted = false;
      const second = await nextRun(t, driver);
      await prepared(t, driver, second);
      expectContinues(t, second, first);
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  it("at the pause line it waits, and decide-usage continue continues it", async () => {
    const knobs: Knobs = { exhausted: true, workTokens: 10_400_000, cause: "pause-line", nextPhase: "execute" };
    const t = await harness(100 * M, knobs);
    try {
      setIntent(t, { tokens: M, hard: false, provenance: "human", estimateId: null });
      const driver = t.driver();
      const first = await t.claim();
      await t.until(driver, () => t.body(first).state === "settled-recoverable", 200);
      expect(t.body(first)).toMatchObject({ recoverable: true, ceilingContinuation: { nextPhase: "execute", resumesAttempt: true } });
      expect(work(t)).toMatchObject({ status: "blocked", usagePause: { runId: first } });
      const answer = t.service.usagePauseDecide(t.h.taskCommand("usage-pause-decide", "a", { decision: "continue" } as never));
      expect(answer).toMatchObject({ result: { kind: "usage-pause-decided", decision: "continue" } });
      expect(answer).not.toMatchObject({ result: { note: expect.anything() } });
      knobs.exhausted = false;
      const second = await nextRun(t, driver);
      await prepared(t, driver, second);
      expectContinues(t, second, first);
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  // The boundary before a new attempt starts that attempt afresh: nothing is resumed, so nothing is subtracted.
  it("a stop at the boundary before a new attempt resumes no attempt", async () => {
    const knobs: Knobs = { exhausted: true, workTokens: 2 * M, cause: "group", nextPhase: "plan", phase: "plan", at: "boundary" };
    const t = await harness(20 * M, knobs);
    try {
      const driver = t.driver();
      const first = await t.claim();
      await t.until(driver, () => t.body(first).state === "blocked", 200);
      // A boundary plan stop carries the previous attempt's rejection in ccloop; this fixture's attempt-1 packet has none,
      // so it is refused by name -- the plan-without-rejection exception is attempt 1's plan cut mid-call only.
      expect(t.body(first)).toMatchObject({ state: "blocked", drive: { blockedAt: "C", blockedReason: "ceiling-continuation:resume-handoff-invalid:allowance-evidence" } });
      await driver.stop();
    } finally { await t.h.dispose(); }
    const cut: Knobs = { exhausted: true, workTokens: 2 * M, cause: "group", nextPhase: "plan", phase: "plan", at: "mid-call" };
    const u = await harness(20 * M, cut);
    try {
      const driver = u.driver();
      const first = await u.claim();
      await u.until(driver, () => u.body(first).state === "settled-recoverable", 200);
      expect(u.body(first)).toMatchObject({ recoverable: true, ceilingContinuation: { nextPhase: "plan", resumesAttempt: true } });
      await driver.stop();
    } finally { await u.h.dispose(); }
  });

  // mutation: drop the validateAllowanceCheckpoint call in ceilingContinuationMark -> settled-recoverable, red
  it("a forged continuation (its saved stop is not the reported one) blocks the run at C by name", async () => {
    const knobs: Knobs = { exhausted: true, workTokens: 2 * M, cause: "group", nextPhase: "execute", savedStop: { cause: "pause-line", phase: "execute", at: "mid-call" } };
    const t = await harness(20 * M, knobs);
    try {
      const driver = t.driver();
      const first = await t.claim();
      await t.until(driver, () => t.body(first).state === "blocked", 200);
      expect(t.body(first).drive).toMatchObject({ blockedAt: "C", blockedReason: "ceiling-continuation:resume-handoff-invalid:allowance-evidence", outcome: "exhausted" });
      expect(t.h.store.db.prepare("SELECT COUNT(*) AS n FROM checkpoints WHERE run_id=?").get(first)).toEqual({ n: 0 });
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  // Criterion 8 / review focus 3: the checkpoint is written, the DB transaction (and onSettled) never ran; the next C visit
  // finishes it from the orphan, and a re-settle of the same report changes nothing.
  it("a crash between commit and onSettled re-settles to the same state", async () => {
    const knobs: Knobs = { exhausted: true, workTokens: 2 * M, cause: "group", nextPhase: "execute" };
    const t = await harness(20 * M, knobs);
    try {
      const driver = t.driver();
      const runId = await t.claim();
      await t.until(driver, () => t.body(runId).state === "accepted");
      const report = await collectInto(t.deps, t.body(runId));
      const sourceDir = t.body(runId).drive.sourceDir;
      const raw = report.candidate!;
      const archive = await archiveRun(t.h.store, { runId, sourceDir, repoDir: join(sourceDir, "repo"), stopProof: raw.stopProof }, archiveAdmission(t.deps));
      const checkpointId = `ceiling-${runId}`;
      const candidate: Candidate = { ...raw, checkpointId, artifacts: [...archive.artifacts, ...raw.artifacts, raw.handoff], snapshot: archive.snapshot };
      await expect(commitCandidate(t.h.store, candidate, { ...archiveAdmission(t.deps), afterArchive: async () => { throw new Error("crash after file"); } })).rejects.toThrow("crash after file");
      const original = JSON.parse(readFileSync(join(t.h.store.stateDir, "checkpoints", runId, `${checkpointId}.json`), "utf8")) as Candidate;
      expect(await stepC(t.deps, runId)).toBe(true);
      const once = { run: t.body(runId), work: work(t) };
      expect(once.run).toMatchObject({ state: "settled-recoverable", recoverable: true, ceilingContinuation: { nextPhase: "execute", resumesAttempt: true } });
      expect(once.work).toMatchObject({ status: "ready", allowancePredecessorRunId: runId });
      expect((await readCommittedCheckpoint(t.h.store, runId)).snapshot).toEqual(original.snapshot);
      // A late visit of the same report (the driver's next round) settles nothing again.
      await stepC(t.deps, runId);
      await driver.round();
      expect(t.body(runId)).toEqual(once.run);
      expect(work(t)).toEqual(once.work);
      expect(t.h.store.db.prepare("SELECT COUNT(*) AS n FROM checkpoints WHERE run_id=?").get(runId)).toEqual({ n: 1 });
      expect(readGroupActivity(t.h.store, "g", 50).filter(e => e.kind === "group-cap-reached")).toHaveLength(1);
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  // Criterion 11 (regression guard): a ceiling stop whose packet carries no continuation settles as before -- no mark, and
  // its continuation is charged the stopped attempt as every other later run is.
  it("a stop without a continuation is unchanged", async () => {
    const knobs: Knobs = { exhausted: true, workTokens: 2 * M, cause: "group", nextPhase: null };
    const t = await harness(20 * M, knobs);
    try {
      const driver = t.driver();
      const first = await t.claim();
      await t.until(driver, () => t.body(first).state === "settled-recoverable", 200);
      expect(t.body(first)).not.toHaveProperty("ceilingContinuation");
      knobs.exhausted = false;
      const second = await nextRun(t, driver);
      expect(t.body(second)).not.toHaveProperty("resumesAttemptOf");
      expect(t.body(second).tokenPolicy.inheritedUsage.attempts).toBe(1);
      await driver.stop();
    } finally { await t.h.dispose(); }
  });
});

// #478 §5.3-§5.4 (criteria 9, 10): the second exit -- take what the stopped run made -- is named on every surface, and a
// refused acceptance gives the continuation and the wait back while a landed one ends them.
const OWNER = { client: "web", principal: "user:owner" } as const;
const accept = (t: Harness, runId: string, id: string) => withCommandContext(id, OWNER, () =>
  t.service.acceptAttempt(t.h.command("accept-attempt", { taskId: "a", runId, note: "the attempt is enough" }, id) as never));
async function capWait(knobs: Knobs, extra: Parameters<typeof driverHarness>[1] = {}): Promise<{ t: Harness; driver: ReturnType<Harness["driver"]>; first: string }> {
  const t = await harness(3 * M, knobs, extra);
  const driver = t.driver();
  const first = await t.claim();
  knobs.workTokens = t.body(first).liveCeiling.tokens - 100_000;
  await t.until(driver, () => t.body(first).state === "settled-recoverable", 200);
  expect(work(t)).toMatchObject({ status: "blocked", groupCapStop: { runId: first } });
  return { t, driver, first };
}

describe("a waiting ceiling stop's exits (#478 §5.3, §5.4)", { timeout: 300_000 }, () => {
  // mutation: drop the ceilingStopExits call in the group summary (orAccept "") -> firstFailure.next without accept, red
  // mutation: drop ceilingStopRows from readControlRecovery -> ceilingStops undefined, red
  it("group brief, group show and recovery list name set-limit and accept-attempt", async () => {
    const knobs: Knobs = { exhausted: true, workTokens: 0, cause: "group", nextPhase: "execute" };
    const { t, driver, first } = await capWait(knobs);
    try {
      const raise = `orca group set-limit g --limit ${3 * M + knobs.workTokens} --as-person`;
      const take = `orca task accept-attempt g a --run ${first} --note '<why the attempt is enough>'`;
      expect(readGroupSummary(t.h.store, "g").card!.firstFailure).toMatchObject({ cause: "group-cap-reached", next: `orca group set-limit g --limit <a higher limit>  or  ${take}` });
      expect(budgetStateLines("g", readControlGroup(t.h.store, "epoch", "g") as never)).toContain(`  or: ${take}  (lands the stopped run's attempt after Orca re-runs the task's checks on it; no more tokens)`);
      expect(readControlRecovery(t.h.store, "epoch").ceilingStops).toEqual([{ groupId: "g", taskId: "a", runId: first, cause: "group", next: [raise, take] }]);
      // The printed raise is batch A's (ceilingStopWait): one way on, worded once.
      const command = t.h.command("retry-task", { taskId: "a", runId: first });
      const retried = withCommandContext(command.commandId, { client: "web", principal: "user:owner", personAuthority: true }, () => t.service.retryTask(command)) as { error: { message: string } };
      expect(ceilingStopNext(retried.error.message.slice("task-not-retryable:".length))).toBe(raise);
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  // Review focus 4. mutation: drop the ceilingRestore branch in acceptAttemptDriver.ts refuse -> settled-failed, red
  it("a refused accept on a resumable ceiling run stays continuable and waiting", async () => {
    const knobs: Knobs = { exhausted: true, workTokens: 0, cause: "group", nextPhase: "execute" };
    // The task's own check refuses the attempt on the merged tree (the attempt wrote `a`).
    const { t, driver, first } = await capWait(knobs, { requiredChecks: ["test ! -f a"] });
    try {
      expect(await accept(t, first, "acc-refused")).toMatchObject({ result: { kind: "attempt-accept-requested" } });
      await t.until(driver, () => t.body(first).operatorAcceptance?.state === "refused", 600);
      expect(t.body(first)).toMatchObject({ state: "settled-recoverable", recoverable: true, ceilingContinuation: { nextPhase: "execute" } });
      expect(t.body(first)).not.toHaveProperty("operatorSettlement");
      expect(work(t)).toMatchObject({ status: "blocked", groupCapStop: { runId: first }, allowancePredecessorRunId: first });
      expect(persistedRunProblem(t.body(first))).toBeNull();
      expect(setLimit(t, 13 * M)).toMatchObject({ result: { kind: "limit-set" } });
      knobs.exhausted = false;
      const second = await nextRun(t, driver);
      await prepared(t, driver, second);
      expectContinues(t, second, first);
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  // mutation: drop the wait deletes in completeAcceptedAttempt -> groupCapStop kept, red
  it("a landed accept clears the wait and no continuation starts", async () => {
    const knobs: Knobs = { exhausted: true, workTokens: 0, cause: "group", nextPhase: "execute" };
    const { t, driver, first } = await capWait(knobs);
    try {
      expect(await accept(t, first, "acc-landed")).toMatchObject({ result: { kind: "attempt-accept-requested" } });
      await t.until(driver, () => work(t).status === "done", 600);
      expect(work(t)).not.toHaveProperty("groupCapStop");
      expect(work(t)).not.toHaveProperty("allowancePredecessorRunId");
      await driver.round();
      expect((await deliverScheduledStart(t.dispatch, "g")).kind).not.toBe("claimed");
      expect(t.h.store.db.prepare("SELECT COUNT(*) AS n FROM runs WHERE group_id='g' AND work_item_id='a'").get()).toEqual({ n: 1 });
      expect(readControlRecovery(t.h.store, "epoch").ceilingStops).toBeUndefined();
      await driver.stop();
    } finally { await t.h.dispose(); }
  });
});
