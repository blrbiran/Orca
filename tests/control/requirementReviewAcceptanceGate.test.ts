import { describe, expect, it } from "vitest";
import { readRepositorySettingsBody, writeRepositorySettingsBody } from "../../src/control/workspaceSettings.js";
import { allMet, reviewWorld } from "./fixtures/reviewWorld.js";

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
        ...settings, revision: settings.revision + 1, checks: { integrationCheck: { command: "false" } },
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
});
