import { describe, expect, it } from "vitest";
import { REVIEW_DIFF_MAX_BYTES } from "../../src/control/requirementReview.js";
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
