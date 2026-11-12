import { describe, expect, it } from "vitest";
import { withCommandContext } from "../../src/control/commandClient.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { driverHarness } from "./fixtures/driverHarness.js";

/**
 * Reviewed acceptance (spec 2026-11-11 §7, #227), the read side: once an owner's acceptance is recorded on a run, the
 * group view still answers (the persisted run schema is strict, so an unknown `operatorAcceptance` key refused the whole
 * view), and the run carries the acceptance's state for the Web -- pending, landed or refused, with the person's note.
 * Named mutations (each seen red, Rule 9): drop `operatorAcceptance` from persistedRunSchema -> the view refuses
 * (run-invalid); drop the view field from runViews -> the run carries no `operatorAcceptance`.
 */
const OWNER = { client: "web", principal: "user:owner" };
const NOTE = "read the diff; the checks are what matter";

describe("the run view after an owner accepts an attempt (#227)", { timeout: 60_000 }, () => {
  it("still answers, and names the pending acceptance with its note; a run with none carries no field", async () => {
    const t = await driverHarness([{ taskId: "a", targetPaths: ["a"] }], { behaviour: () => "failed", sealedOwnerProof: true });
    try {
      const runId = await t.claim(), driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "blocked");
      const closed = t.service.closeRun(t.h.command("close-run", { runId }));
      if ("error" in closed) throw new Error(JSON.stringify(closed));
      await t.until(driver, () => t.body(runId).drive.cleanedUp === true);
      expect(readControlGroup(t.h.store, "epoch-test", "g").runs.find((r) => r.runId === runId)).not.toHaveProperty("operatorAcceptance");
      const command = t.h.command("accept-attempt", { taskId: "a", runId, note: NOTE }, "acc-view");
      const answer = await withCommandContext(command.commandId, OWNER, () => t.service.acceptAttempt(command as never));
      expect(answer).toMatchObject({ result: { kind: "attempt-accept-requested" } });
      const at = t.body(runId).operatorAcceptance.at;
      expect(readControlGroup(t.h.store, "epoch-test", "g").runs.find((r) => r.runId === runId)?.operatorAcceptance)
        .toEqual({ state: "pending", note: NOTE, principal: "user:owner", at, reason: null, landedCommit: null });
    } finally { await t.h.dispose(); }
  });
});

/**
 * #227 residual: the Web's accept form listed only a loop task's checks and showed nothing of what the attempt changed. The
 * run view now carries, for a run the server could accept, the setup and required checks the driver will run (from the
 * confirmed contract, whatever the task kind) and the attempt's diff against the run's base, rebuilt from the same archive
 * snapshot the driver lands. The fixture's attempt adds `a` ("a\n") and deletes `base.txt` ("base\n", driverHarness.ts),
 * so the expected stat is known from the fixture, not read back from the code under test.
 */
describe("what the person reads before accepting an attempt (#227 residual)", { timeout: 120_000 }, () => {
  // mutation: attemptReviewOf answers requiredChecks: [] -> red
  // mutation: the background read never stores its answer (diff stays null) -> red
  // mutation: the offered test ignores a pending acceptance -> the field stays after accept -> red
  it("names the task's required checks and the attempt's diff stat, and drops both once an acceptance is pending", async () => {
    const t = await driverHarness([{ taskId: "a", targetPaths: ["a", "base.txt"] }], { behaviour: () => "failed", sealedOwnerProof: true,
      requiredChecks: ["test -f a"], files: () => ({ a: "a\n", "base.txt": null }) });
    try {
      const runId = await t.claim(), driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "blocked");
      const closed = t.service.closeRun(t.h.command("close-run", { runId }));
      if ("error" in closed) throw new Error(JSON.stringify(closed));
      await t.until(driver, () => t.body(runId).drive.cleanedUp === true);
      const review = () => readControlGroup(t.h.store, "epoch-test", "g").runs.find((r) => r.runId === runId)?.attemptReview;
      expect(review()).toMatchObject({ requiredChecks: ["test -f a"], setupCommands: [] });
      const deadline = Date.now() + 60_000;
      while (review()?.diff == null && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
      const diff = review()!.diff!;
      expect(diff.shortstat).toBe("2 files changed, 1 insertion(+), 1 deletion(-)");
      expect(diff.stat.slice(0, 2).map((line) => line.trim().split(/\s+/)[0])).toEqual(["a", "base.txt"]);
      const command = t.h.command("accept-attempt", { taskId: "a", runId, note: NOTE }, "acc-review");
      await withCommandContext(command.commandId, OWNER, () => t.service.acceptAttempt(command as never));
      expect(review()).toBeUndefined();
    } finally { await t.h.dispose(); }
  });
});
