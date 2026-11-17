import { describe, expect, it } from "vitest";
import { resumeBlockedDriverRun } from "../../src/control/driveRecord.js";
import { blockRun, stepA1 } from "../../src/control/executionDriver.js";
import { REVIEW_DIFF_MAX_BYTES, reviewRequirements } from "../../src/control/requirementReview.js";
import { settleNeverStartedRunInTransaction } from "../../src/control/stopIntent.js";
import { newRound, writeRound } from "../../src/control/requirementRecords.js";
import { groupNeedsYou } from "../../src/panel/controlOverview.js";
import { readGroupSummary } from "../../src/panel/controlViews.js";
import { reviewWorld } from "./fixtures/reviewWorld.js";

/**
 * Tester #334: a requirement review that cannot even be prepared must not hold a finished group for good. Two halves:
 * (1) a group diff larger than Node's default 1 MiB child-output buffer is read bounded at REVIEW_DIFF_MAX_BYTES instead
 * of crashing the call before it starts; (2) any preparation failure -- the call was never handed to ccloop, so nothing
 * was spent -- closes the review run (active=0, its grant back to the group) and settles the round `failed`, so the
 * review leaves `reviewing`, the person's review-accept / review-rerun / review-fix answer, and the group shows it.
 */
const groupBody = (w: Awaited<ReturnType<typeof reviewWorld>>) => JSON.parse(String(w.t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
const reviewRuns = (w: Awaited<ReturnType<typeof reviewWorld>>) => w.t.h.store.db.prepare("SELECT id, active, body FROM runs WHERE group_id='g' AND work_item_id LIKE 'requirement-review-%'").all()
  .map((row) => ({ id: String(row.id), active: Number(row.active), body: JSON.parse(String(row.body)) as { state: string; failureCode?: string | null } }));

describe("a requirement review that cannot be prepared (#334)", () => {
  it("reads a group diff over 1 MiB bounded instead of failing the review before it starts", async () => {
    // 1.5 MiB of text in one task: more than execFile's default maxBuffer, so an unbounded `git diff` read throws.
    const big = `${"0123456789abcdef".repeat(64)}\n`.repeat(1_536);
    const w = await reviewWorld({ harness: { files: (id): Record<string, string | null> => (id === "a" ? { a: big } : { b: "b\n" }) } });
    try {
      await w.runAll();
      await w.t.until(w.driver, () => w.review()?.state === "passed" || w.review()?.state === "not-passed", 120);
      // mutation: read the diff with the default buffer -> the run blocks at A2 with "stdout maxBuffer length exceeded", red
      expect(w.review()).toMatchObject({ state: "passed" });
      const prompt = w.calls[0]!.prompt;
      expect(prompt).toContain(`The diff was cut at ${REVIEW_DIFF_MAX_BYTES} bytes`);
      expect(Buffer.byteLength(prompt.slice(prompt.indexOf("The group's diff against its base:")), "utf8")).toBeLessThan(REVIEW_DIFF_MAX_BYTES + 2_000);
    } finally { await w.t.h.dispose(); }
  }, 240000);

  it("closes a review run whose preparation failed, settles the round failed and leaves the person's exits open", async () => {
    const w = await reviewWorld();
    try {
      // The clarification's criteria are gone: the review is claimed (the claim does not read them) but its prompt cannot
      // be built, deterministically, every time it is tried.
      w.t.h.store.transaction(() => writeRound(w.t.h.store, "g", { ...newRound(1), state: "answered", closedByConsensus: true,
        result: { slug: null, statement: "Two files say hello world.", acceptanceCriteria: [], questions: [], frontierEmpty: true, openBranches: [], glossary: [], adrs: [] } }));
      const reserved = () => groupBody(w).reserved as { tokens: number; attempts: number };
      let whileReviewing: { tokens: number; attempts: number } | null = null;
      await w.runAll();
      await w.t.until(w.driver, () => {
        if (w.review()?.state === "reviewing" && whileReviewing === null) whileReviewing = reserved();
        return w.review()?.state === "not-passed";
      }, 120);
      // mutation: drop the pass's close of an unprepared review -> the review stays `reviewing` with an active blocked run, red
      expect(w.review()).toMatchObject({ state: "not-passed", why: "failed",
        rounds: [expect.objectContaining({ roundNo: 1, result: "failed", summary: expect.stringContaining("requirement-review-criteria-missing") })] });
      expect(w.calls).toEqual([]);
      const runs = reviewRuns(w);
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({ active: 0, body: { state: "failed-before-provider", failureCode: "requirement-review-prepare-failed" } });
      // Nothing was spent and the grant went back: the claim's reservation (REQUIREMENT_REVIEW_GRANT) is released.
      expect(whileReviewing).not.toBeNull();
      expect(whileReviewing!.tokens - reserved().tokens).toBe(600_000);
      expect(whileReviewing!.attempts - reserved().attempts).toBe(1);
      // The group says why it is not done (mutation: drop the review row from the overview -> needsYou false, red).
      const summary = readGroupSummary(w.t.h.store, "g");
      expect(summary.requirementReview?.problem).toBe("requirement-review-not-passed:failed");
      expect(groupNeedsYou(w.t.h.store, "g")).toBe(true);
      // The person's exits answer now (before: requirement-review-not-open:reviewing); accept makes the group done.
      const command = w.t.h.command("review-accept", { note: "checked by hand" });
      expect(w.t.service.reviewAccept(command)).toMatchObject({ result: { kind: "review-accepted" } });
      await w.t.until(w.driver, () => w.groupStatus() === "done", 60);
    } finally { await w.t.h.dispose(); }
  }, 240000);
});

/**
 * Tester #350: the #334 close matched only an active run. A person who followed the advice and ran `recovery retry` (or
 * any stop that settled the run) left the never-prepared review run settled and inactive -- and the review in `reviewing`
 * for good, with no exit (review-accept / rerun / fix need `not-passed`). Runs settled before #334 are stuck the same way.
 * The run's facts did not change: it never prepared, so it never reached a provider. A review round whose latest run
 * never prepared and can no longer advance is closed as #334 closes it; one that may still advance, or may have reached
 * a provider, is left alone.
 */
const reviewDeps = (w: Awaited<ReturnType<typeof reviewWorld>>) => ({ store: w.t.h.store, resolveRepository: w.t.deps.resolveRepository, write: <T>(action: () => T) => w.t.h.store.transaction(action) });
const runRow = (w: Awaited<ReturnType<typeof reviewWorld>>, runId: string) => {
  const row = w.t.h.store.db.prepare("SELECT active, body FROM runs WHERE id=?").get(runId)!;
  return { active: Number(row.active), body: JSON.parse(String(row.body)) as { state: string; executionId?: string | null; drive: { blockedAt: string | null; prepared?: boolean } } };
};
/**
 * Runs the group to the review's claim (the round's run exists, active, still `starting`, not yet driven), then -- unless
 * `a1` is false -- takes the driver's own first step on it (A1: its drive record, its attempt reserved), so the test can
 * block it at A2 as a failed preparation does. The driver itself would block it and the review pass close it in one
 * round, which leaves no moment to settle it between.
 */
async function claimedReview(w: Awaited<ReturnType<typeof reviewWorld>>, a1 = true): Promise<string> {
  await w.runAll();
  await w.t.until(w.driver, () => w.review()?.state === "reviewing", 120);
  const runs = reviewRuns(w);
  expect(runs).toHaveLength(1);
  expect(runs[0]!.active).toBe(1);
  if (a1) expect(stepA1(w.t.deps, runs[0]!.id)).toBe(true);
  return runs[0]!.id;
}
const PREPARE_FAILURE = "stdout maxBuffer length exceeded";

describe("a never-prepared review run that was settled before the review pass closed it (#350)", () => {
  it("closes the round of a settled, inactive, never-prepared run so the review leaves `reviewing` and reaches a verdict", async () => {
    const w = await reviewWorld();
    try {
      const runId = await claimedReview(w);
      const reserved = () => (groupBody(w).reserved as { tokens: number }).tokens;
      const whileReviewing = reserved();
      // The field state, written by the code that writes it: the preparation blocks at A2 (executionDriver blockRun), then
      // the run is settled as never started (stopIntent.ts, the stop's accounting: its grant back to the group, inactive).
      blockRun(w.t.deps, runId, "A2", PREPARE_FAILURE, { prepared: false });
      w.t.h.store.transaction(() => settleNeverStartedRunInTransaction(w.t.h.store, "g", runId));
      expect(runRow(w, runId)).toMatchObject({ active: 0, body: { state: "settled-restartable", executionId: null, drive: { blockedAt: "A2", prepared: false } } });
      const settled = reserved();
      expect(whileReviewing - settled).toBe(600_000);
      // mutation: select only `active=1` rows again -> the review stays `reviewing` and the driver never gets here, red
      await w.t.until(w.driver, () => w.review()?.state !== "reviewing", 20);
      expect(w.review()).toMatchObject({ state: "not-passed", why: "failed",
        rounds: [expect.objectContaining({ roundNo: 1, runId, result: "failed", summary: expect.stringContaining(PREPARE_FAILURE) })] });
      expect(w.calls).toEqual([]);
      // The stop already gave the grant back: closing the round must not release it a second time.
      expect(reserved()).toBe(settled);
      expect(runRow(w, runId)).toMatchObject({ active: 0, body: { state: "settled-restartable" } });
      // The person's exit answers now, and the group reaches a verdict: a new round is reviewed and passes, the group is done.
      expect(w.t.service.reviewRerun(w.t.h.command("review-rerun", { note: "the diff is read bounded now" }))).toMatchObject({ result: { kind: "review-rerun-requested" } });
      await w.t.until(w.driver, () => w.review()?.state === "passed", 120);
      expect(w.review()!.rounds.map((round) => [round.roundNo, round.result])).toEqual([[1, "failed"], [2, "passed"]]);
      await w.t.until(w.driver, () => w.groupStatus() === "done", 60);
    } finally { await w.t.h.dispose(); }
  }, 240000);

  it("leaves alone a review run that may still advance, or may have reached a provider", async () => {
    const w = await reviewWorld();
    try {
      const runId = await claimedReview(w);
      const passes = async () => { for (let i = 0; i < 3; i += 1) await reviewRequirements(reviewDeps(w)); };
      // A person's `recovery retry` resumed the blocked run (driveRecord.ts): active, back to A2's resume state, so the
      // driver prepares it again. Closing it now would race a call that may yet start.
      blockRun(w.t.deps, runId, "A2", PREPARE_FAILURE, { prepared: false });
      w.t.h.store.transaction(() => resumeBlockedDriverRun(w.t.h.store, runId));
      expect(runRow(w, runId)).toMatchObject({ active: 1, body: { drive: { blockedAt: null, prepared: false } } });
      await passes();
      // mutation: qualify any active run (drop the active branch's blocked-at-A2 check) -> closed, red
      expect(w.review()).toMatchObject({ state: "reviewing", rounds: [] });
      expect(runRow(w, runId).active).toBe(1);
      // Settled and inactive, but its prompt was built: it may have been handed to ccloop, so it is not closed as unprepared.
      blockRun(w.t.deps, runId, "A2", PREPARE_FAILURE, { prepared: true });
      w.t.h.store.transaction(() => settleNeverStartedRunInTransaction(w.t.h.store, "g", runId));
      expect(runRow(w, runId)).toMatchObject({ active: 0, body: { state: "settled-restartable", drive: { blockedAt: "A2", prepared: true } } });
      await passes();
      // mutation: drop the `prepared !== true` check -> the round is closed `failed`, red
      expect(w.review()).toMatchObject({ state: "reviewing", rounds: [] });
      // Likewise a run that has an execution (it was given to ccloop), whatever its drive says.
      w.t.h.store.transaction(() => {
        const body = { ...runRow(w, runId).body, executionId: "execution-350" };
        body.drive = { ...body.drive, prepared: false };
        w.t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(body), runId);
      });
      await passes();
      // mutation: drop the `executionId` check -> the round is closed `failed`, red
      expect(w.review()).toMatchObject({ state: "reviewing", rounds: [] });
      // Review of #350: settled by an unrecoverable stop, never prepared by its drive record. Only `settled-restartable` is
      // written by the paths that proved the run never started; an unrecoverable stop proved nothing, so it is left alone.
      w.t.h.store.transaction(() => {
        const body = { ...runRow(w, runId).body, executionId: null, state: "settled-unrecoverable" };
        w.t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(body), runId);
      });
      expect(runRow(w, runId)).toMatchObject({ active: 0, body: { state: "settled-unrecoverable", executionId: null, drive: { prepared: false } } });
      await passes();
      // mutation: accept every terminal run state on the inactive branch (isTerminalRunState) -> closed `failed`, red
      expect(w.review()).toMatchObject({ state: "reviewing", rounds: [] });
      expect(w.calls).toEqual([]);
    } finally { await w.t.h.dispose(); }
  }, 240000);

  /**
   * Review of #350 (reproduced by the reviewer): a stop settles a never-prepared run from other states than blocked at A2,
   * and every such settlement clears or never had `blockedAt === "A2"`. `recovery retry` resumes the blocked run
   * (start-pending, blockedAt cleared) and an open stop then settles it; a run stopped while `starting` has no drive record;
   * one blocked at A1 never reached A2. Each is `settled-restartable` -- only a proved never-started settlement writes it.
   */
  it.each([
    { origin: "resumed by recovery retry, then settled by a stop", a1: true, before: (w: Awaited<ReturnType<typeof reviewWorld>>, runId: string) => {
      blockRun(w.t.deps, runId, "A2", PREPARE_FAILURE, { prepared: false });
      w.t.h.store.transaction(() => resumeBlockedDriverRun(w.t.h.store, runId));
      expect(runRow(w, runId)).toMatchObject({ active: 1, body: { state: "start-pending", drive: { blockedAt: null, prepared: false } } });
    } },
    { origin: "settled while still starting", a1: false, before: () => undefined },
    { origin: "blocked at A1, then settled", a1: true, before: (w: Awaited<ReturnType<typeof reviewWorld>>, runId: string) => {
      blockRun(w.t.deps, runId, "A1", "strict-proof-unimplemented");
    } },
  ])("closes the round of a never-prepared run settled restartable from any state: $origin", async ({ a1, before }) => {
    const w = await reviewWorld();
    try {
      const runId = await claimedReview(w, a1);
      before(w, runId);
      w.t.h.store.transaction(() => settleNeverStartedRunInTransaction(w.t.h.store, "g", runId));
      expect(runRow(w, runId)).toMatchObject({ active: 0, body: { state: "settled-restartable", executionId: null } });
      expect(runRow(w, runId).body.drive?.blockedAt ?? null).not.toBe("A2");
      const settled = (groupBody(w).reserved as { tokens: number }).tokens;
      for (let i = 0; i < 3; i += 1) await reviewRequirements(reviewDeps(w));
      // mutation: require `blockedAt === "A2"` on the inactive branch too -> the review stays `reviewing`, red
      expect(w.review()).toMatchObject({ state: "not-passed", why: "failed",
        rounds: [expect.objectContaining({ roundNo: 1, runId, result: "failed", summary: expect.stringContaining("review could not be prepared") })] });
      expect((groupBody(w).reserved as { tokens: number }).tokens).toBe(settled);
      expect(w.calls).toEqual([]);
    } finally { await w.t.h.dispose(); }
  }, 240000);
});
