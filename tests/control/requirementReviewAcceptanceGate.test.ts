import { describe, expect, it, vi } from "vitest";
import { readRepositorySettingsBody, writeRepositorySettingsBody } from "../../src/control/workspaceSettings.js";
import { git } from "./fixtures/driverHarness.js";
import { allMet, reviewWorld, verdicts } from "./fixtures/reviewWorld.js";

// #337 C4 (M24): a seam that holds the acceptance pass back for a while; while `held` is false it is the pass itself.
const acceptancePass = vi.hoisted(() => ({ held: false }));
vi.mock("../../src/control/groupAcceptance.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/control/groupAcceptance.js")>();
  return { ...actual, acceptGroups: (...args: Parameters<typeof actual.acceptGroups>) => (acceptancePass.held ? Promise.resolve(false) : actual.acceptGroups(...args)) };
});

/**
 * #314 (same root cause as #312): the first review round waited for group acceptance to pass, so a repository with an
 * existing failing test never got reviewed at all -- 8/8 tasks done, acceptance failed, group stuck in `review`, and
 * `review-rerun` / `review-accept` refused with `requirement-review-not-open:none`. Acceptance and review are two gates
 * that both have to pass for `done`; one must not veto the other.
 */
describe("the first review round does not wait for a passing acceptance (#314)", () => {
  it("reviews the failing tip and still keeps the group out of done", async () => {
    const w = await reviewWorld({ answer: () => ({ outcome: "complete", output: allMet() }) });
    try {
      const settings = readRepositorySettingsBody(w.t.h.store, "repo") ?? { workspaceMode: "worktree" as const, revision: 0 };
      writeRepositorySettingsBody(w.t.h.store, "repo", {
        ...settings, revision: settings.revision + 1, checks: { integrationCheck: { command: "test ! -f a" } },
      });
      await w.runAll();
      await w.t.until(w.driver, () => w.review() !== null, 120);
      await w.t.until(w.driver, () => w.calls.some((call) => call.purpose === "requirement-review"), 120);
      // The round says why the group is not delivered even though the review runs.
      const reviewCall = w.calls.find((call) => call.purpose === "requirement-review");
      expect(reviewCall?.prompt).toContain("Group acceptance failed on this tip");
      // #314 B: the accepted plan is part of the review input (here from the archived contracts: reviewWorld stores no draft).
      expect(reviewCall?.prompt).toContain("The accepted delivery plan");
      expect(reviewCall?.prompt).toContain("- a (");
      expect(w.groupStatus()).not.toBe("done");
      await w.t.until(w.driver, () => w.review()?.state === "passed", 120);
      // A passed review is not a delivered group while the acceptance on its tip failed.
      expect(w.groupStatus()).not.toBe("done");
    } finally { await w.t.h.dispose(); }
  }, 180000);

  /**
   * #337 C4 (spec 2026-11-19 §11.2, M24): the converse of a folder group's review, which skips these waits. A repository
   * group's fix task moves the tip; its next round waits for the acceptance pass to check that tip (here held back for a
   * while), so the round is never judged on the old tip's acceptance record.
   */
  it("a repository group's round after a fix waits for the acceptance on the fix's new tip (#337 C4)", async () => {
    const answers = [verdicts({ AC1: "not-met", AC2: "met" }), allMet()];
    const w = await reviewWorld({ harness: { files: (id) => (id.startsWith("review-fix-") ? { a: `fixed a by ${id}\n` } : { [id]: `${id}\n` }) },
      answer: () => ({ outcome: "complete", output: answers.shift() }) });
    const group = () => JSON.parse(String(w.t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
    try {
      const settings = readRepositorySettingsBody(w.t.h.store, "repo") ?? { workspaceMode: "worktree" as const, revision: 0 };
      writeRepositorySettingsBody(w.t.h.store, "repo", { ...settings, revision: settings.revision + 1, checks: { integrationCheck: { command: "test ! -f a" } } });
      await w.runAll();
      await w.t.until(w.driver, () => w.review()?.state === "fixing", 120);
      const oldTip = git(w.t.repo, "rev-parse", "refs/heads/orca/g");
      await w.t.until(w.driver, () => group().acceptance?.tip === oldTip, 120);
      expect(group().acceptance).toMatchObject({ result: "failed", tip: oldTip });
      acceptancePass.held = true;
      await w.runAll();
      const newTip = git(w.t.repo, "rev-parse", "refs/heads/orca/g");
      expect(newTip).not.toBe(oldTip);
      for (let i = 0; i < 10; i += 1) await w.driver.round();
      // mutation M24: drop the two acceptance-tip waits -> round 2 is claimed on the new tip while the record is the old
      // tip's, red
      expect(group().acceptance.tip).toBe(oldTip);
      expect(w.review()).toMatchObject({ state: "fixing" });
      expect(w.review()!.rounds).toHaveLength(1);
      acceptancePass.held = false;
      for (let i = 0; i < 40 && w.review()?.rounds.length !== 2; i += 1) await w.driver.round();
      expect(w.review()?.rounds.map((round) => round.tip)).toEqual([oldTip, newTip]);
      expect(group().acceptance).toMatchObject({ result: "failed", tip: newTip });
      expect(w.calls.filter((call) => call.purpose === "requirement-review")[1]!.prompt).toContain(`Acceptance on the reviewed tip ${newTip.slice(0, 12)}: failed`);
    } finally { acceptancePass.held = false; await w.t.h.dispose(); }
  }, 300000);
});
