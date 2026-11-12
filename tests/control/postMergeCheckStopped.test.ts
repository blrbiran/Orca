import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readRunActivity } from "../../src/control/activity.js";
import type { ExecutionDriver } from "../../src/control/executionDriver.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { postMergeCheckLines } from "../../src/commands/domains/reads.js";
import { driverHarness } from "./fixtures/driverHarness.js";

// Tester follow-up E §4 (#245): every post-merge check leaves an auditable record -- passed, failed or not needed. A check the
// driver's stop aborted left nothing: the run sat `collected` with no word of a check that had started. It now records
// `skipped` (why `stopped`) on the run and in its activity; nothing moved, and the next driver merges, checks and lands,
// whose record replaces it.

async function untilDeadline(driver: ExecutionDriver, predicate: () => boolean, deadlineMs = 20_000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (!predicate() && Date.now() < deadline) {
    await driver.round();
    if (!predicate()) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!predicate()) throw new Error("the driver did not reach the expected state before the deadline");
}

describe("a post-merge check the driver stopped records skipped:stopped (#245)", { timeout: 60_000 }, () => {
  it("records it on the run and in its activity, the run stays collected, and the next driver checks again and lands", async () => {
    const dir = mkdtempSync(join(tmpdir(), "orca-pmc-stop-"));
    const hold = join(dir, "hold"), started = join(dir, "started");
    rmSync(hold, { force: true });
    // Only the merged tree (both files) runs long, and only while `hold` exists; every other check passes at once.
    const check = `if test -f a && test -f b && test -f '${hold}'; then touch '${started}'; sleep 30; fi; true`;
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }], { requiredChecks: [check] }); try {
      const ids = [await t.claim(), await t.claim()];
      writeFileSync(hold, "");
      const first = t.driver();
      await untilDeadline(first, () => existsSync(started));
      const checked = ids.find((id) => t.body(id).state === "collected")!;
      expect(t.body(checked).drive.postMergeCheck).toBeUndefined();
      await first.stop();
      const drive = t.body(checked).drive;
      expect(t.body(checked).state).toBe("collected");
      expect(drive.landedCommit).toBeNull();
      expect(drive.postMergeCheck).toMatchObject({ result: "skipped", why: "stopped", attemptSha: drive.attemptSha, commands: [] });
      const rows = readRunActivity(t.h.store, checked, 50).filter((row) => row.kind === "post-merge-check");
      expect(rows.map((row) => (row.body as { result: string }).result)).toEqual(["skipped"]);
      // The view carries it (its schema admits the record).
      const shown = readControlGroup(t.h.store, "epoch", "g").runs.find((run) => run.runId === checked)!.postMergeCheck;
      expect(shown).toMatchObject({ result: "skipped", why: "stopped" });
      // run show says it in words, not as a failed check.
      expect(postMergeCheckLines(shown)).toEqual(["post-merge check: skipped (stopped); the run did not land, and the next driver merges and checks again"]);
      // The next driver merges again, checks again and lands; that landing's record replaces the skipped one.
      rmSync(hold, { force: true });
      const second = t.driver();
      await untilDeadline(second, () => ["landed", "settled"].includes(t.body(checked).state));
      expect(t.body(checked).drive.postMergeCheck).toMatchObject({ result: "passed" });
    } finally { await t.h.dispose(); }
  });
});
