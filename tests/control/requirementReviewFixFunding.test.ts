import { describe, expect, it } from "vitest";
import { openFixTask } from "../../src/control/requirementReview.js";
import { readBudgetProposal, readWork } from "../../src/control/queries.js";
import { reserveCommitment } from "../../src/control/stopIntent.js";
import type { ReviewRound } from "../../src/control/requirementReviewRecord.js";
import { reviewWorld } from "./fixtures/reviewWorld.js";

/**
 * Tester #377 (human ruling, session 3ba26002: 「同意」; stuck-runs spec Correction of 2026-11-19): an automatic fix task's
 * token cap never exceeds what the group has left. The tester's group had 1.58M unallocated while the cap (twice the
 * source's used tokens) was 4.09M, so the fix was refused `unfunded` and the group stopped with budget still left.
 */
const ROUND: ReviewRound = { roundNo: 1, tip: "d".repeat(40), runId: null, at: 0, result: "not-met", summary: "s",
  criteria: [{ id: "AC1", verdict: "not-met", evidence: [{ path: "a", line: 1 }], missing: "a.txt does not say hello", fixableBy: "work" },
    { id: "AC2", verdict: "met", evidence: [{ path: "b", line: 1 }], missing: null, fixableBy: "work" }] };
const zero = { activeMs: 0, attempts: 0, sessions: 0 };

/** A reviewed group whose work is done, its unallocated reserve then cut down to `left` tokens. */
async function groupLeftWith(left: (handoffTokens: number) => number) {
  const w = await reviewWorld();
  await w.runAll();
  await w.t.until(w.driver, () => w.review()?.state === "passed", 120);
  const store = w.t.h.store;
  const handoff = readWork(store, "g", "a").grant.handoff.tokens;
  const reserve = readBudgetProposal(store, "g").explicitUnallocatedReserve.tokens!;
  const target = left(handoff);
  store.transaction(() => reserveCommitment(store, "g", { tokens: reserve - target, ...zero }));
  expect(readBudgetProposal(store, "g").explicitUnallocatedReserve.tokens).toBe(target);
  return { w, store, handoff };
}

describe("an automatic fix task is funded from what the group has left (#377)", () => {
  it("opens the fix with the group's remainder (less its handoff) when that is below the 1M floor", async () => {
    const { w, store, handoff } = await groupLeftWith((h) => h + 400_000);
    try {
      const opened = store.transaction(() => openFixTask(store, "g", structuredClone(ROUND), "auto"));
      // mutation: drop the clamp by the group's remainder in openFixTask -> refused unfunded, red
      expect(opened).toEqual({ taskId: "review-fix-1" });
      expect(readWork(store, "g", "review-fix-1").grant.work.tokens).toBe(400_000);
      expect(readWork(store, "g", "review-fix-1").grant.handoff.tokens).toBe(handoff);
      expect(readBudgetProposal(store, "g").explicitUnallocatedReserve.tokens).toBe(0);
    } finally { await w.t.h.dispose(); }
  }, 300000);

  it("keeps the 1M floor when the group can pay it", async () => {
    const { w, store } = await groupLeftWith((h) => h + 1_500_000);
    try {
      expect(store.transaction(() => openFixTask(store, "g", structuredClone(ROUND), "auto"))).toEqual({ taskId: "review-fix-1" });
      // The source used 10 tokens: twice that is below the floor, and the group can pay the floor.
      expect(readWork(store, "g", "review-fix-1").grant.work.tokens).toBe(1_000_000);
      expect(readBudgetProposal(store, "g").explicitUnallocatedReserve.tokens).toBe(500_000);
    } finally { await w.t.h.dispose(); }
  }, 300000);

  it("stays unfunded only when nothing is left for the fix's work once its handoff is reserved", async () => {
    const { w, store } = await groupLeftWith((h) => h);
    try {
      // mutation: drop the nothing-left guard -> a 0-token work grant, which deriveContract refuses -> refused failed, red
      expect(store.transaction(() => openFixTask(store, "g", structuredClone(ROUND), "auto"))).toEqual({ refused: "unfunded", detail: "group-budget-unavailable:tokens" });
      expect(store.db.prepare("SELECT id FROM work_items WHERE group_id='g' AND id LIKE 'review-fix-%'").all()).toEqual([]);
    } finally { await w.t.h.dispose(); }
  }, 300000);
});
