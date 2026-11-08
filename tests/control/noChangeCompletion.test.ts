import { describe, expect, it } from "vitest";
import { readArtifact } from "../../src/control/archive.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";

// Tester #127 and #138 (design Correction 2): an ordinary task may complete with no net tracked change only when its
// contract explicitly says its command checks decide the goal. The tree equality is checked against Git; every other
// empty result keeps D14's block. The declaration's type gate itself is pinned by decisiveChecksContract.test.ts.
const workOf = (t: Awaited<ReturnType<typeof driverHarness>>, runId: string) =>
  JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body)).status;

describe("a checked no-change task completes only by its authored declaration", () => {
  it("accepts a proved clean tree, runs the declared checks, and names the no-change landing", async () => {
    const t = await driverHarness([{ taskId: "a", commandChecksDecideGoal: true }], { files: () => ({}) }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).drive?.cleanedUp === true);
      const drive = t.body(runId).drive;
      const row = t.h.store.db.prepare("SELECT body FROM outbox WHERE id=?").get(`acceptance:${runId}`);
      expect(row, "a declared clean result earns acceptance").toBeDefined();
      const acceptance = JSON.parse(String((row as { body: string }).body));
      // mutation: accept every empty result without the check evidence -> checksPassed is false here, red
      const bytes = JSON.parse((await readArtifact(t.h.store, acceptance.source)).toString());
      expect(bytes).toMatchObject({ runId, checksPassed: true, landing: "no-change", commit: drive.attemptSha });
      // mutation: drop the tree-equality guard -> this run's tree differs and the criterion must go red next test
      expect(gitTree(t, drive.attemptSha)).toBe(gitTree(t, drive.base));
      expect(workOf(t, runId)).toBe("done");
    } finally { await t.h.dispose(); }
  }, 30000);

  it("keeps the same empty result blocked without the declaration", async () => {
    const t = await driverHarness([{ taskId: "a" }], { files: () => ({}) }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).drive?.cleanedUp === true);
      expect(t.h.store.db.prepare("SELECT body FROM outbox WHERE id=?").get(`acceptance:${runId}`)).toBeUndefined();
      expect(workOf(t, runId)).toBe("blocked");
      expect(t.body(runId).drive.blockedReason).toBe("empty-result");
    } finally { await t.h.dispose(); }
  }, 30000);
});

function gitTree(t: Awaited<ReturnType<typeof driverHarness>>, rev: string): string {
  return git(t.repo, "rev-parse", `${rev}^{tree}`);
}
