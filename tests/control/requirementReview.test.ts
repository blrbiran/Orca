import { describe, expect, it } from "vitest";
import { buildReviewPrompt, classifyReviewOutput, REVIEW_DIFF_MAX_BYTES } from "../../src/control/requirementReview.js";
import { readGroupSummary } from "../../src/panel/controlViews.js";
import { allMet, CRITERIA, reviewWorld, verdicts, type ReviewWorld } from "./fixtures/reviewWorld.js";

/**
 * Tester follow-up G spec §3.1-§3.3, §3.6-§3.8 (human: 「没有统一标准，一般会对照需求看具体实现的结果」; the playback 「同意」):
 * a requirement group created under follow-up G is reviewed against its acceptance criteria after every task is done and
 * its acceptance passed, and is done only when the review passes. A group created before the release, or not from a
 * requirement, is not reviewed. An answer that does not match the criteria, or a cannot-judge, stops the group in Problems.
 */
const settle = async (w: ReviewWorld, until: () => boolean) => {
  await w.runAll();
  await w.t.until(w.driver, until, 120);
};
const ids = CRITERIA.map((c) => c.id);

describe("the requirement review (tester follow-up G §3)", () => {
  it("a requirement group created under G is reviewed after acceptance and is done only when the review passes", async () => {
    const w = await reviewWorld();
    try {
      await settle(w, () => w.review()?.state === "passed");
      expect(w.calls.map((c) => c.purpose)).toEqual(["requirement-review"]);
      expect(w.review()!.rounds).toEqual([expect.objectContaining({ roundNo: 1, result: "passed" })]);
      await w.t.until(w.driver, () => w.groupStatus() === "done", 60);
    } finally { await w.t.h.dispose(); }
  }, 180000);

  it("a reviewed group is not done while its review is pending", async () => {
    const w = await reviewWorld({ answer: () => ({ outcome: "complete", output: verdicts({ AC1: "met", AC2: "cannot-judge" }) }) });
    try {
      await settle(w, () => w.review()?.state === "not-passed");
      for (let i = 0; i < 5; i += 1) await w.driver.round();
      // mutation M8a: drop the reviewSatisfied line in prerequisiteDone -> the done pass marks it done, red
      expect(w.groupStatus()).not.toBe("done");
      expect(w.review()).toMatchObject({ state: "not-passed", why: "cannot-judge" });
      expect(readGroupSummary(w.t.h.store, "g").requirementReview?.problem).toBe("requirement-review-not-passed:cannot-judge");
    } finally { await w.t.h.dispose(); }
  }, 180000);

  it("a group created before the release, or not from a requirement, is not reviewed", async () => {
    for (const options of [{ followupG: false }, { requirement: false }]) {
      const w = await reviewWorld(options);
      try {
        await w.runAll();
        await w.t.until(w.driver, () => w.groupStatus() === "done", 120);
        // mutation M8b: drop isFollowupG from reviewRequired -> a review call, red
        expect(w.calls).toEqual([]);
        expect(w.review()).toBeNull();
      } finally { await w.t.h.dispose(); }
    }
  }, 240000);

  it("an answer that does not match the criteria is invalid", () => {
    const met = allMet();
    // mutation M8c: accept a missing id -> passed, red
    expect(classifyReviewOutput({ ...met, criteria: met.criteria.slice(0, 1) }, ids)).toEqual({ result: "invalid", reason: "criterion-missing:AC2" });
    expect(classifyReviewOutput({ ...met, criteria: [...met.criteria, { ...met.criteria[0]!, id: "AC9" }] }, ids)).toEqual({ result: "invalid", reason: "criterion-unknown:AC9" });
    expect(classifyReviewOutput({ ...met, criteria: [{ ...met.criteria[0]!, evidence: [] }, met.criteria[1]] }, ids)).toEqual({ result: "invalid", reason: "evidence-missing:AC1" });
    const notMet = verdicts({ AC1: "not-met", AC2: "met" });
    expect(classifyReviewOutput({ ...notMet, criteria: [{ ...notMet.criteria[0]!, missing: null }, notMet.criteria[1]] }, ids)).toEqual({ result: "invalid", reason: "missing-unsaid:AC1" });
    expect(classifyReviewOutput(met, ids)).toMatchObject({ result: "passed" });
    // mutation M8d: treat cannot-judge as met -> passed, red
    expect(classifyReviewOutput(verdicts({ AC1: "met", AC2: "cannot-judge" }), ids)).toMatchObject({ result: "cannot-judge" });
    expect(classifyReviewOutput(verdicts({ AC1: "not-met", AC2: "cannot-judge" }), ids)).toMatchObject({ result: "cannot-judge" });
  });

  it("an invalid answer stops the group in Problems, never passes it", async () => {
    const w = await reviewWorld({ answer: () => ({ outcome: "complete", output: { criteria: [], summary: "?" } }) });
    try {
      await settle(w, () => w.review()?.state === "not-passed");
      expect(w.review()).toMatchObject({ state: "not-passed", why: "invalid", rounds: [expect.objectContaining({ result: "invalid" })] });
      expect(w.groupStatus()).not.toBe("done");
    } finally { await w.t.h.dispose(); }
  }, 180000);

  it("the prompt is bounded and names binaries", async () => {
    const big = "x".repeat(300_000);
    // Task b also adds an image (a NUL byte makes git call it binary).
    const w = await reviewWorld({ tasks: [{ taskId: "a" }, { taskId: "b", targetPaths: ["b", "img.png"] }],
      harness: { files: (id): Record<string, string | null> => (id === "a" ? { a: `${big}\n` } : { b: "b\n", "img.png": "\u0000PNG-BYTES-SECRET" }) } });
    try {
      await settle(w, () => w.review()?.state === "passed");
      const prompt = w.calls[0]!.prompt;
      const diff = prompt.slice(prompt.indexOf("The group's diff against its base:"));
      // mutation M8e: no cut -> the 300 KB file is in the prompt whole, red
      expect(Buffer.byteLength(diff, "utf8")).toBeLessThan(REVIEW_DIFF_MAX_BYTES + 2_000);
      expect(prompt).toContain(`The diff was cut at ${REVIEW_DIFF_MAX_BYTES} bytes`);
      expect(prompt).toContain("- AC1: a.txt says hello");
      expect(prompt).toMatch(/- A img\.png 17 [a-f0-9]{64} \(binary: named only, its bytes are not shown\)/);
      expect(prompt).not.toContain("PNG-BYTES-SECRET");
    } finally { await w.t.h.dispose(); }
    const named = buildReviewPrompt({ idea: "i", statement: "s", criteria: CRITERIA, openBranches: [], diff: "", truncated: false,
      changedFiles: [{ path: "img.png", status: "A", bytes: 3, sha256: "f".repeat(64), binary: true }] });
    expect(named).toContain(`- A img.png 3 ${"f".repeat(64)} (binary: named only, its bytes are not shown)`);
  }, 180000);

  it("an unfunded review is named and does not pass", async () => {
    let capped = false;
    const holder: { w?: ReviewWorld } = {};
    const w = await reviewWorld({ harness: { duringCollect: async () => {
      const t = holder.w?.t;
      if (t === undefined || capped) return;
      // The second task's collect: a spend cap reached before the review is claimed.
      if (t.h.store.db.prepare("SELECT 1 FROM work_items WHERE group_id='g' AND json_extract(body,'$.status')='done'").get() === undefined) return;
      capped = true;
      const cap = t.h.rawCommand("cap-1", 0, "set-spend-cap", { kind: "spend" } as never, { scope: "all", period: "total", tokens: 1 });
      const { withCommandContext } = await import("../../src/control/commandClient.js");
      withCommandContext(cap.commandId, { client: "web", principal: "user:owner" }, () => t.service.setSpendCap(cap as never));
    } } });
    holder.w = w;
    try {
      await settle(w, () => w.review()?.state === "not-passed");
      expect(w.review()).toMatchObject({ state: "not-passed", why: "unfunded", rounds: [expect.objectContaining({ result: "unfunded", runId: null })] });
      expect(w.calls).toEqual([]);
    } finally { await w.t.h.dispose(); }
  }, 180000);
});
