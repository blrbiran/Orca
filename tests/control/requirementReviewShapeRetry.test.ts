import { describe, expect, it } from "vitest";
import { readRun } from "../../src/control/budget.js";
import { buildReviewPrompt } from "../../src/control/requirementReview.js";
import { readGroup } from "../../src/control/queries.js";
import { allMet, reviewWorld, type ReviewWorld } from "./fixtures/reviewWorld.js";

/**
 * Tester #358 (plan 2026-11-18 tester batch D, D3; triage g1 #358): a review call whose answer came back in a broken shape
 * (ccloop's `single-call-output-invalid` -- two JSON objects in one answer, seen on Codex in prompt mode) says nothing about
 * the work, yet it settled the whole review `not-passed/failed` and left the group for a person. It is asked once more in
 * the same round; only a second broken answer settles `failed`. Each call is billed as every call is.
 */

const settle = async (w: ReviewWorld, until: () => boolean) => {
  await w.runAll();
  await w.t.until(w.driver, until, 120);
};
const reviewRuns = (w: ReviewWorld) => w.calls.filter((c) => c.purpose === "requirement-review").map((c) => c.runId);
/** The activity rows saying a review call was asked again. */
const askedAgain = (w: ReviewWorld) => w.t.h.store.db.prepare("SELECT run_id, body FROM activity WHERE group_id='g' AND kind='requirement-review'").all()
  .map((row) => ({ runId: String(row.run_id), body: JSON.parse(String(row.body)) as Record<string, unknown> })).filter((row) => row.body.result === "asked-again");
const booked = (w: ReviewWorld, runId: string) => readRun(w.t.h.store, runId).cumulative.work.tokens;
/** The group's used tokens equal what its runs booked -- every call billed, none twice. */
const ledgerMatchesRuns = (w: ReviewWorld) => {
  const runs = w.t.h.store.db.prepare("SELECT id FROM runs WHERE group_id='g'").all().map((row) => readRun(w.t.h.store, String(row.id)));
  return (readGroup(w.t.h.store, "g") as unknown as { used: { tokens: number } }).used.tokens === runs.reduce((sum, run) => sum + (run.cumulative.work.tokens ?? 0) + (run.cumulative.handoff.tokens ?? 0), 0);
};

describe("a review answer with a broken shape is asked once more (#358)", () => {
  it("invalid, then a good answer: the review passes in round 1 after two calls, both billed", async () => {
    let n = 0;
    const w = await reviewWorld({ answer: () => (n += 1) === 1
      ? { outcome: "failed", errorCode: "single-call-output-invalid", tokens: 7_000 }
      : { outcome: "complete", output: allMet(), tokens: 9_000 } });
    try {
      await settle(w, () => w.review()?.state === "passed" || w.review()?.state === "not-passed");
      // mutation: no retry -> state not-passed/failed after one call, red here.
      expect(w.review()).toMatchObject({ state: "passed" });
      expect(w.review()!.rounds).toEqual([expect.objectContaining({ roundNo: 1, result: "passed" })]);
      const runs = reviewRuns(w);
      expect(runs).toHaveLength(2);
      expect(runs.map((id) => booked(w, id))).toEqual([7_000, 9_000]);
      expect(ledgerMatchesRuns(w)).toBe(true);
    } finally { await w.t.h.dispose(); }
  }, 180000);

  // Review of D3 (I3): Codex refusing an answer printed twice (ccloop codexSingleCall `notSingle("messages")` /
  // `notSingle("turns")`, the record's errorCode as ccloop writes it) is the same broken shape, asked once more.
  it.each(["codex-single-call-not-single:messages", "codex-single-call-not-single:turns"])("%s, then a good answer: asked once more, and the activity says so", async (errorCode) => {
    let n = 0;
    const w = await reviewWorld({ answer: () => (n += 1) === 1 ? { outcome: "failed", errorCode, tokens: 7_000 } : { outcome: "complete", output: allMet(), tokens: 9_000 } });
    try {
      await settle(w, () => w.review()?.state === "passed" || w.review()?.state === "not-passed");
      // mutation: re-ask only single-call-output-invalid -> not-passed/failed after one call, red here.
      expect.soft(w.review()).toMatchObject({ state: "passed" });
      expect.soft(reviewRuns(w)).toHaveLength(2);
      // mutation: drop the activity row -> [], red here.
      expect.soft(askedAgain(w)).toEqual([{ runId: reviewRuns(w)[0], body: expect.objectContaining({ roundNo: 1, result: "asked-again", failure: errorCode }) }]);
    } finally { await w.t.h.dispose(); }
  }, 180000);

  it("codex-single-call-not-single:tool (the model ran a tool) is not asked again", async () => {
    const w = await reviewWorld({ answer: () => ({ outcome: "failed", errorCode: "codex-single-call-not-single:tool", tokens: 7_000 }) });
    try {
      await settle(w, () => w.review()?.state === "not-passed");
      for (let i = 0; i < 5; i += 1) await w.driver.round();
      expect(w.review()).toMatchObject({ state: "not-passed", why: "failed" });
      expect(reviewRuns(w)).toHaveLength(1);
      expect(askedAgain(w)).toEqual([]);
    } finally { await w.t.h.dispose(); }
  }, 180000);

  // Review of D3 (I3): ccloop's omp adapter answers single-call-output-invalid also for a model stopped at its output cap
  // (stopReason "length"); the record carries the same code and no cause, so Orca cannot tell it apart and this case is it
  // too -- the one re-ask may hit the same cap, and the round then settles failed as below (bounded: exactly two calls).
  it("invalid twice: the round settles failed after exactly two calls, as today's one failed call did", async () => {
    const w = await reviewWorld({ answer: () => ({ outcome: "failed", errorCode: "single-call-output-invalid", tokens: 7_000 }) });
    try {
      await settle(w, () => w.review()?.state === "not-passed");
      for (let i = 0; i < 5; i += 1) await w.driver.round();
      expect(w.review()).toMatchObject({ state: "not-passed", why: "failed" });
      expect(w.review()!.rounds).toEqual([expect.objectContaining({ roundNo: 1, result: "failed", summary: "review call failed: single-call-output-invalid" })]);
      expect(reviewRuns(w)).toHaveLength(2);
      expect(reviewRuns(w).map((id) => booked(w, id))).toEqual([7_000, 7_000]);
      expect(ledgerMatchesRuns(w)).toBe(true);
    } finally { await w.t.h.dispose(); }
  }, 180000);

  it("a call that failed for another reason is not asked again", async () => {
    const w = await reviewWorld({ answer: () => ({ outcome: "failed", errorCode: "codex-exit-error" }) });
    try {
      await settle(w, () => w.review()?.state === "not-passed");
      for (let i = 0; i < 5; i += 1) await w.driver.round();
      expect(w.review()).toMatchObject({ state: "not-passed", why: "failed" });
      expect(reviewRuns(w)).toHaveLength(1);
    } finally { await w.t.h.dispose(); }
  }, 180000);

  it("the prompt says checkConflict is null when there is none", () => {
    const prompt = buildReviewPrompt({ idea: "i", statement: "s", criteria: [{ id: "AC1", text: "t" }], openBranches: [], changedFiles: [], diff: "", truncated: false } as never);
    expect(prompt).toContain('"checkConflict": null when there is none');
  });
});
