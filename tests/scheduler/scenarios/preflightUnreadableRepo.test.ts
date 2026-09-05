import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RUNTIME_CHECKS } from "../../../src/scheduler/planReport.js";
import { captureStdout, makeSandbox, runCli, seedRejectablePlan } from "../sandbox.js";

// The final whole-branch review's parked finding, promoted to the top
// follow-up: for a `targetRepo` that is not a git repository at all,
// preflight's ref reads swallowed their error and answered "no such ref",
// which renders as `[pass] work-branch-already-exists` — a green line, in the
// report a human approves a round from, for a check that was never evaluated.
// That is finding B6's shape exactly, and it sat one line above two genuine
// failures that prove git could not have answered.
//
// The criterion is written against the RENDERED REPORT rather than against
// preflight()'s rejection list, because the fabricated pass is a property of
// what the human reads: `checkLine` turns "no rejection carries this code"
// into `[pass] <code>`, so a check that cannot answer must produce a
// rejection or it necessarily prints green.
describe("preflight on a target repo git cannot read (final review, promoted follow-up)", () => {
  it("prints no [pass] for any runtime check when the target repo is not a git repository", async () => {
    const s = await makeSandbox();
    try {
      const notARepo = join(s.root, "not-a-repo");
      await mkdir(notARepo, { recursive: true });

      const planPath = await seedRejectablePlan(s, { targetRepo: notARepo });
      const { result: rc, stdout } = await captureStdout(() => runCli(["plan", planPath]));

      // §9.3: a plan with rejections exits 1. Pinned so a future change that
      // makes this path exit 0 cannot leave the assertions below vacuously
      // true against an empty report.
      expect(rc).toBe(1);

      // The load-bearing one: not a single runtime check may claim to have
      // passed, because git answered none of them.
      for (const code of RUNTIME_CHECKS) {
        expect(stdout).not.toContain(`[pass] ${code}`);
      }

      // And the check that used to fabricate the pass must say what happened,
      // rather than implying the branch was looked up and found absent.
      expect(stdout).toContain(`[fail] ${RUNTIME_CHECKS[0]}`);
      expect(stdout).toMatch(/cannot determine whether the branch .* exists/);
    } finally {
      await s.cleanup();
    }
  });
});
