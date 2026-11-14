import { describe, expect, it } from "vitest";
import { acceptanceCommands } from "../../src/control/groupAcceptance.js";
import { readConfirmedTaskExecution } from "../../src/control/executionSnapshot.js";
import { git } from "./fixtures/driverHarness.js";
import { reviewWorld, verdicts } from "./fixtures/reviewWorld.js";

/**
 * Tester follow-up G spec §3.4-§3.5 (human: 「自动在同一组里开一个修复任务（把复核的发现当说明）」): a review round with
 * unmet criteria opens one fix task in the same group covering all of them, whose goal is the findings and whose write
 * set is the files the review named; once it lands the group is accepted and reviewed again. At most two automatic
 * rounds: a third not-met stops the group in Problems.
 */
const fixFiles = (id: string): Record<string, string | null> => (id.startsWith("review-fix-") ? { a: `fixed a by ${id}\n` } : { [id]: `${id}\n` });

describe("a not-met review opens a fix task in the same group (tester follow-up G §3.4)", () => {
  it("a not-met round opens one fix task covering every unmet criterion, and the review runs again after it lands", async () => {
    const answers = [verdicts({ AC1: "not-met", AC2: "not-met" }), verdicts({ AC1: "met", AC2: "met" })];
    const w = await reviewWorld({ harness: { files: fixFiles }, answer: () => ({ outcome: "complete", output: answers.shift() }) });
    try {
      await w.runAll();
      await w.t.until(w.driver, () => w.review()?.state === "fixing", 120);
      const fixes = w.t.h.store.db.prepare("SELECT id FROM work_items WHERE group_id='g' AND id LIKE 'review-fix-%'").all().map((r) => String(r.id));
      // mutation M9a: one fix task per criterion -> two tasks, red
      expect(fixes).toEqual(["review-fix-1"]);
      const contract = readConfirmedTaskExecution(w.t.h.store, "g", "review-fix-1").contract;
      expect(contract.objective.goal).toContain("AC1");
      expect(contract.objective.goal).toContain("AC2");
      expect(contract.context.targetPaths).toEqual(["a", "b"]);
      // the fix task's checks are the group's union of required checks
      expect(contract.verification.requiredChecks).toEqual(acceptanceCommands(w.t.h.store, "g").checks);
      await w.runAll();
      await w.t.until(w.driver, () => w.review()?.state === "passed", 120);
      expect(w.review()).toMatchObject({ autoFixRounds: 1, rounds: [expect.objectContaining({ result: "not-met", fixTaskId: "review-fix-1", fixBy: "auto" }), expect.objectContaining({ result: "passed" })] });
      expect(git(w.t.repo, "show", "refs/heads/orca/g:a")).toBe("fixed a by review-fix-1");
      await w.t.until(w.driver, () => w.groupStatus() === "done", 60);
    } finally { await w.t.h.dispose(); }
  }, 300000);

  // Follow-up L (dogfood g-28d9b560): in an expectation-model group (optional-v1, a task's work grant has no token
  // number) the fix task was appended with tokens 0, which deriveContract refuses, so no fix task could ever open -- the
  // automatic round stopped `failed` and `review-fix` answered a bare recovery-blocked:review-fix.
  it("opens the fix task in an expectation-model group, whose tasks' work grants carry no token number", async () => {
    const answers = [verdicts({ AC1: "not-met", AC2: "met" }), verdicts({ AC1: "met", AC2: "met" })];
    const w = await reviewWorld({ tasks: [{ taskId: "a", tokenBudget: null }, { taskId: "b", tokenBudget: null }] as never,
      harness: { files: fixFiles, tokenPolicy: "optional-v1" }, answer: () => ({ outcome: "complete", output: answers.shift() }) });
    try {
      const grantTokens = (id: string) => JSON.parse(String(w.t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(id)!.body)).grant.work.tokens;
      expect(grantTokens("a")).toBeNull();
      await w.runAll();
      await w.t.until(w.driver, () => w.review()?.state === "fixing" || w.review()?.state === "not-passed", 120);
      expect(w.review()).toMatchObject({ state: "fixing", autoFixRounds: 1 });
      // the fix task is funded like its siblings: no token number, the expectation model's grant
      expect(grantTokens("review-fix-1")).toBeNull();
      await w.runAll();
      await w.t.until(w.driver, () => w.review()?.state === "passed", 120);
      expect(git(w.t.repo, "show", "refs/heads/orca/g:a")).toBe("fixed a by review-fix-1");
    } finally { await w.t.h.dispose(); }
  }, 300000);

  it("the third not-met round stops the group in Problems", async () => {
    const w = await reviewWorld({ harness: { files: fixFiles }, answer: () => ({ outcome: "complete", output: verdicts({ AC1: "not-met", AC2: "met" }) }) });
    try {
      for (let i = 0; i < 4 && w.review()?.state !== "not-passed"; i += 1) {
        const before = w.review()?.rounds.length ?? 0;
        await w.runAll();
        await w.t.until(w.driver, () => (w.review()?.rounds.length ?? 0) > before && w.review()?.state !== "reviewing", 120);
      }
      // mutation M9b: `<=` for `<` on the bound -> a third fix task, red
      expect(w.review()).toMatchObject({ state: "not-passed", why: "rounds-exhausted", autoFixRounds: 2 });
      expect(w.review()!.rounds.map((r) => r.fixTaskId ?? null)).toEqual(["review-fix-1", "review-fix-2", null]);
      expect(w.t.h.store.db.prepare("SELECT COUNT(*) AS n FROM work_items WHERE group_id='g' AND id LIKE 'review-fix-%'").get()!.n).toBe(2);
      expect(w.groupStatus()).not.toBe("done");
    } finally { await w.t.h.dispose(); }
  }, 600000);
});
