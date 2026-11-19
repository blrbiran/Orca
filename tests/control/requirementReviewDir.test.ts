import { describe, expect, it } from "vitest";
import { prerequisiteDone } from "../../src/control/groupEdges.js";
import { acceptanceOf } from "../../src/control/groupAcceptanceRecord.js";
import { reviewSatisfied } from "../../src/control/requirementReviewRecord.js";
import { editGroup, groupBodyOf, makeDirGroup, reviewActivities } from "./fixtures/folderReviewWorld.js";
import { reviewWorld } from "./fixtures/reviewWorld.js";

/**
 * #337 (spec 2026-11-19 §4.1, §5.1-§5.2, criterion C1; human: 「可以派agent审。不要卡在」, ruling 2 「同意」): a folder (dir)
 * group is reviewed like a repository group, in its vault -- before is the folder's import, after is `orca/<g>` with
 * Orca's own files (`.decisions/`, the requirement document) left out; the prompt says what the import leaves out and
 * which paths placement withheld. A not-met `work` finding opens the automatic fix rounds; once they are used up the
 * review ends `noted` (activity too), the group is not held, and the acceptance record stays `not-run: dir`.
 */
const png = (width: number, height: number): Buffer => {
  const head = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  const dims = Buffer.alloc(8); dims.writeUInt32BE(width, 0); dims.writeUInt32BE(height, 4);
  return Buffer.concat([head, Buffer.from("IHDR"), dims, Buffer.from([8, 6, 0, 0, 0])]);
};
const notMet = () => ({ outcome: "complete" as const, output: {
  criteria: [{ id: "AC1", verdict: "not-met", evidence: [{ path: "a", line: 1 }], missing: "a.txt must say hello", fixableBy: "work" },
    { id: "AC2", verdict: "met", evidence: [{ path: "b", line: 1 }], missing: null, fixableBy: "work" }], summary: "a needs work" } });

describe("a folder group's requirement review (#337 C1)", () => {
  it("reviews the vault's work without Orca's own files, runs the fix rounds, and ends noted without holding the group", async () => {
    const w = await reviewWorld({ answer: notMet, harness: { files: (id): Record<string, string | null> => id === "a"
      // The task's own work, an image, and the two kinds of Orca's own file a folder's work branch holds.
      ? { a: "a\n", "pic.png": png(3, 2) as unknown as string, ".decisions/run-1.jsonl": "{}\n", "docs/requirements/x.md": "# the requirement\n" }
      : id.startsWith("review-fix-") ? { a: `fixed by ${id}\n` } : { [id]: `${id}\n` } } });
    try {
      makeDirGroup(w, { withheld: ["b"] });
      await w.runAll();
      await w.t.until(w.driver, () => w.review()?.state === "fixing", 120);
      // mutation M1-style guard: the old pass wrote not-run and claimed nothing.
      expect(w.calls).toHaveLength(1);
      const prompt = w.calls[0]!.prompt;
      expect(prompt).toContain("The folder's changes: before = the copy of the folder Orca took when the work started; after = the work Orca will place into the folder:");
      expect(prompt).not.toContain("The group's diff against its base:");
      // mutation M8: drop the exclusion fact line -> red
      expect(prompt).toContain("Orca's copy of the folder leaves out: any file over 50 MiB and anything past 500 MiB in total; files the folder's .gitignore excludes; .git/, node_modules/, .DS_Store; nested repositories and special files; .decisions/. A criterion about such a file cannot be judged from this review.");
      // mutation M9: drop the withheld line -> red
      expect(prompt).toContain("Placement withheld these paths from the folder (they are in the work below but not in the person's folder): b\n");
      expect(prompt).toMatch(/\n- A pic\.png 29 [0-9a-f]{64} \(binary: PNG image, 3x2 pixels; its other bytes are not shown\)\n/);
      expect(prompt).toContain("Acceptance: not run -- Orca runs no group-wide check on a folder or multi-directory group; each task's own checks ran on its attempt.");
      expect(prompt).toContain("Delivery: Orca places the work into the person's folder or branches by itself; this review judges Orca's work branches, not the person's folder or branches.");
      expect(prompt).toContain("changing files in the repository (or, for a folder group, the folder) can meet it");
      // mutation M10: drop the :(exclude) pathspecs -> the ledger and the document are in the list and the diff, red
      expect(prompt).toContain("\n- A a 2 ");
      for (const own of [".decisions/run-1.jsonl", "docs/requirements/x.md"]) {
        expect(prompt).not.toContain(`\n- A ${own} `);
        expect(prompt).not.toContain(`+++ b/${own}`);
      }
      expect(w.review()).toMatchObject({ state: "fixing", autoFixRounds: 1, rounds: [expect.objectContaining({ result: "not-met", fixTaskId: "review-fix-1", fixBy: "auto" })] });

      // mutation M2: keep the acceptance-tip waits for a folder group -> no round 2, red (until throws)
      await w.runAll();
      await w.t.until(w.driver, () => (w.review()?.rounds.length ?? 0) === 2 && w.review()?.state === "fixing", 120);
      await w.runAll();
      await w.t.until(w.driver, () => w.review()?.state === "noted" || w.review()?.state === "not-passed", 120);
      // mutation M1: drop settledReview for a folder group -> not-passed, red
      expect(w.review()).toMatchObject({ state: "noted", why: "rounds-exhausted", autoFixRounds: 2 });
      expect(w.review()!.rounds.map((round) => round.result)).toEqual(["not-met", "not-met", "not-met"]);
      expect(w.t.h.store.db.prepare("SELECT id FROM work_items WHERE group_id='g' AND id LIKE 'review-fix-%' ORDER BY id").all().map((row) => row.id)).toEqual(["review-fix-1", "review-fix-2"]);
      // mutation M11: map after recordActivity -> the last activity says not-passed, red
      const activities = reviewActivities(w);
      expect(activities.at(-1)).toMatchObject({ roundNo: 3, result: "not-met", state: "noted" });
      expect(activities.filter((row) => row.state === "not-passed")).toEqual([]);
      // The acceptance record is the folder's own (never rewritten by the review), and the review no longer holds done.
      expect(acceptanceOf(groupBodyOf(w))).toMatchObject({ result: "not-run", why: "dir", tip: null });
      expect(reviewSatisfied(w.t.h.store, "g", groupBodyOf(w))).toBe(true);
      // These criteria never place into the folder (no vault env: the pass records `failed`); a caught-up placement stands for it.
      editGroup(w, (body) => { body.placement = { ...(body.placement as { landedTip: string }), state: "idle", detail: null, tip: (body.placement as { landedTip: string }).landedTip }; });
      expect(prerequisiteDone(w.t.h.store, "g")).toBe(true);
    } finally { await w.t.h.dispose(); }
  }, 400000);
});
