import { describe, expect, it } from "vitest";
import { withCommandContext } from "../../src/control/commandClient.js";
import { acceptanceOf } from "../../src/control/groupAcceptanceRecord.js";
import { reviewRequirements } from "../../src/control/requirementReview.js";
import { newRound, writeRound } from "../../src/control/requirementRecords.js";
import { reviewNote, reviewProblem, reviewSatisfied } from "../../src/control/requirementReviewRecord.js";
import { git } from "./fixtures/driverHarness.js";
import { editGroup, groupBodyOf, holdReview, makeDirGroup, reviewActivities } from "./fixtures/folderReviewWorld.js";
import { reviewWorld, verdicts, type ReviewWorld } from "./fixtures/reviewWorld.js";

/**
 * #337 (spec 2026-11-19 §5.1, §5.6, §5.7, criterion C3; human ruling 2 「同意」: a folder or multi-directory group's review
 * that does not pass is shown but never holds done): a repository group still ends `not-passed`; every other site that
 * saves `not-passed` maps a folder group's review to `noted` -- an unfunded claim, an unprepared call, a work branch that is
 * gone (the acceptance record untouched), a claim error no retry changes. The person may accept a noted review; rerun and
 * fix stay refused. A group finished before (`not-run`) is not reviewed now.
 */
const notMet = () => ({ outcome: "complete" as const, output: verdicts({ AC1: "not-met", AC2: "met" }) });
const fixFiles = (id: string): Record<string, string | null> => (id.startsWith("review-fix-") ? { a: `fixed by ${id}\n` } : { [id]: `${id}\n` });
const passDeps = (w: ReviewWorld) => ({ store: w.t.h.store, resolveRepository: () => w.t.repo, write: <T>(action: () => T): T => w.t.h.store.transaction(action) });

/** A folder group whose tasks ran with the review held off, its acceptance recorded; `release` lets the pass meet it. */
async function heldDirGroup(): Promise<{ w: ReviewWorld; release(): void }> {
  const w = await reviewWorld({ answer: notMet });
  makeDirGroup(w);
  const held = holdReview(w);
  await w.runAll();
  await w.t.until(w.driver, () => acceptanceOf(groupBodyOf(w)) !== null, 60);
  await w.driver.stop();
  return { w, release: held.release };
}

describe("a review that does not pass, by group kind (#337 C3)", () => {
  it("a repository group with the same rounds still ends not-passed", async () => {
    const w = await reviewWorld({ answer: notMet, harness: { files: fixFiles } });
    try {
      await w.runAll();
      await w.t.until(w.driver, () => w.review()?.state === "fixing", 120);
      for (let fix = 0; fix < 2; fix += 1) {
        await w.runAll();
        await w.t.until(w.driver, () => w.review()?.state === "not-passed" || (w.review()?.state === "fixing" && w.review()!.rounds.length === fix + 2), 120);
      }
      // mutation M5: map every group -> noted, red
      expect(w.review()).toMatchObject({ state: "not-passed", why: "rounds-exhausted", autoFixRounds: 2 });
      expect(reviewProblem(w.review())).toBe("requirement-review-not-passed:rounds-exhausted");
      expect(reviewNote(w.review())).toBeNull();
      expect(reviewSatisfied(w.t.h.store, "g", groupBodyOf(w))).toBe(false);
    } finally { await w.t.h.dispose(); }
  }, 400000);

  it("noted is satisfied, and its note is not a problem", async () => {
    const w = await reviewWorld();
    try {
      editGroup(w, (body) => { body.requirementReview = { state: "noted", why: "rounds-exhausted", rounds: [], autoFixRounds: 2 }; });
      // mutation M6: drop noted from SATISFIED -> false, red
      expect(reviewSatisfied(w.t.h.store, "g", groupBodyOf(w))).toBe(true);
      expect(reviewNote(w.review())).toBe("requirement-review-noted:rounds-exhausted");
      expect(reviewProblem(w.review())).toBeNull();
    } finally { await w.t.h.dispose(); }
  }, 120000);

  it("a claim the group cannot fund ends a folder group's review noted", async () => {
    const { w, release } = await heldDirGroup();
    try {
      const cap = w.t.h.rawCommand("cap-1", 0, "set-spend-cap", { kind: "spend" } as never, { scope: "all", period: "total", tokens: 1 });
      withCommandContext(cap.commandId, { client: "web", principal: "user:owner" }, () => w.t.service.setSpendCap(cap as never));
      release();
      expect(await reviewRequirements(passDeps(w))).toBe(true);
      // mutation M19: leave the claim-time unfunded site unmapped -> not-passed, red
      expect(w.review()).toMatchObject({ state: "noted", why: "unfunded", rounds: [expect.objectContaining({ result: "unfunded", runId: null })] });
      expect(reviewActivities(w).at(-1)).toMatchObject({ roundNo: 1, result: "unfunded", state: "noted" });
      expect(w.calls).toEqual([]);
    } finally { await w.t.h.dispose(); }
  }, 240000);

  it("a call that cannot be prepared ends a folder group's review noted, its activity too", async () => {
    const w = await reviewWorld({ answer: notMet });
    try {
      makeDirGroup(w);
      // The clarification's criteria are gone: the claim succeeds, the prompt cannot be built (as requirementReviewPrepare).
      w.t.h.store.transaction(() => writeRound(w.t.h.store, "g", { ...newRound(1), state: "answered", closedByConsensus: true,
        result: { slug: null, statement: "Two files say hello world.", acceptanceCriteria: [], questions: [], frontierEmpty: true, openBranches: [], glossary: [], adrs: [] } }));
      await w.runAll();
      await w.t.until(w.driver, () => w.review()?.state === "noted" || w.review()?.state === "not-passed", 120);
      // mutation M20: leave the unprepared site unmapped -> not-passed, red
      expect(w.review()).toMatchObject({ state: "noted", why: "failed",
        rounds: [expect.objectContaining({ result: "failed", summary: expect.stringContaining("requirement-review-criteria-missing") })] });
      expect(reviewActivities(w).at(-1)).toMatchObject({ roundNo: 1, result: "failed", state: "noted" });
      expect(w.calls).toEqual([]);
    } finally { await w.t.h.dispose(); }
  }, 240000);

  it("a folder group whose vault work branch is gone ends noted and leaves its acceptance record as it was", async () => {
    const { w, release } = await heldDirGroup();
    try {
      const acceptance = acceptanceOf(groupBodyOf(w));
      expect(acceptance).toMatchObject({ result: "not-run", why: "dir" });
      git(w.t.repo, "update-ref", "-d", "refs/heads/orca/g");
      release();
      expect(await reviewRequirements(passDeps(w))).toBe(true);
      expect(w.review()).toMatchObject({ state: "noted", why: "failed", rounds: [expect.objectContaining({ result: "failed", runId: null, summary: "the work branch orca/g is gone" })] });
      // mutation M21: record the branch missing on the acceptance -> overwritten (work-branch-missing), red
      expect(acceptanceOf(groupBodyOf(w))).toEqual(acceptance);
      expect(reviewSatisfied(w.t.h.store, "g", groupBodyOf(w))).toBe(true);
      // A noted review gets no new round.
      expect(await reviewRequirements(passDeps(w))).toBe(false);
      expect(w.review()!.rounds).toHaveLength(1);
    } finally { await w.t.h.dispose(); }
  }, 240000);

  it("a claim error no retry changes (requirement-review-profile) ends a folder group's review noted", async () => {
    const { w, release } = await heldDirGroup();
    try {
      // No work run names its execution profile: reviewerOf throws recovery-blocked, every time.
      for (const row of w.t.h.store.db.prepare("SELECT id, body FROM runs WHERE group_id='g'").all()) {
        const body = JSON.parse(String(row.body)) as Record<string, unknown>;
        delete body.executionProfile;
        w.t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(body), row.id);
      }
      release();
      expect(await reviewRequirements(passDeps(w))).toBe(true);
      // mutation M22: keep the retry for recovery-blocked -> no review record, red
      expect(w.review()).toMatchObject({ state: "noted", why: "failed", rounds: [expect.objectContaining({ result: "failed", runId: null, summary: "requirement-review-profile" })] });
      expect(reviewActivities(w).at(-1)).toMatchObject({ roundNo: 1, result: "failed", state: "noted" });
    } finally { await w.t.h.dispose(); }
  }, 240000);

  it("the person may accept a noted review; rerun and fix stay refused", async () => {
    const w = await reviewWorld();
    try {
      editGroup(w, (body) => { body.requirementReview = { state: "noted", why: "rounds-exhausted", autoFixRounds: 2,
        rounds: [{ roundNo: 1, tip: "a".repeat(40), runId: null, at: 0, result: "not-met", criteria: [], summary: "s" }] }; });
      const refusal = (answer: unknown) => (answer as { error?: { code: string; message: string } }).error ?? null;
      // mutation M23: admit noted for rerun -> accepted, red
      expect(refusal(w.t.service.reviewRerun(w.t.h.command("review-rerun", { note: "again" })))).toMatchObject({ code: "requirement-review-not-open" });
      expect(refusal(w.t.service.reviewFix(w.t.h.command("review-fix", { goal: "fix it" })))).toMatchObject({ code: "requirement-review-not-open" });
      expect(w.review()).toMatchObject({ state: "noted" });
      expect(w.t.service.reviewAccept(w.t.h.command("review-accept", { note: "fine as it is" }))).toMatchObject({ result: { kind: "review-accepted" } });
      expect(w.review()).toMatchObject({ state: "accepted", accepted: { note: "fine as it is" } });
      expect(reviewNote(w.review())).toBeNull();
    } finally { await w.t.h.dispose(); }
  }, 120000);

  it("a folder group finished before (its review not-run) is not reviewed now", async () => {
    const w = await reviewWorld({ answer: notMet });
    try {
      makeDirGroup(w);
      editGroup(w, (body) => { body.requirementReview = { state: "not-run", why: "dir", rounds: [], autoFixRounds: 0 }; });
      await w.runAll();
      await w.t.until(w.driver, () => acceptanceOf(groupBodyOf(w)) !== null, 60);
      for (let i = 0; i < 5; i += 1) await w.driver.round();
      expect(w.calls).toEqual([]);
      expect(w.review()).toEqual({ state: "not-run", why: "dir", rounds: [], autoFixRounds: 0 });
    } finally { await w.t.h.dispose(); }
  }, 240000);
});
