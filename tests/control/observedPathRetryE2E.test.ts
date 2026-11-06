import { afterAll, describe, expect, it } from "vitest";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { readConfirmedTaskExecution } from "../../src/control/executionSnapshot.js";
import { ccloopWorlds, raw, realBinary, startGroup, until, workRuns } from "./fixtures/ccloopWorld.js";

const { world, removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "orca-observed-path-e2e-", epochPrefix: "epoch-path-e2e-" });
afterAll(removeRoots);

describe.skipIf(!realBinary)("observed paths through the pinned ccloop binary", { timeout: 420_000 }, () => {
  relocateHome("orca-observed-path-e2e-home-");

  it("reports two Git-observed misses, retries with an immutable path amendment, and settles the next run", async () => {
    const paths = ["one.test.ts", "two.test.ts"];
    const w = await world([{ taskId: "a", targetPaths: ["shared.txt"], loop: { plan: "standard", goal: "write result and tests", successCondition: "files exist", targetPaths: ["shared.txt"], checks: ["true"] } }],
      { a: { files: { "shared.txt": "A\n", [paths[0]!]: "one\n", [paths[1]!]: "two\n" }, reportedChangedFiles: ["shared.txt", ...paths] } });
    const runtime = await w.boot();
    try {
      await startGroup(runtime, w.repoId, 1_000_000);
      runtime.startPump(50);
      await until(() => workRuns(runtime)[0]?.body.state === "blocked", 240_000, "allowlist block");
      const first = workRuns(runtime)[0]!;
      expect(first.body.drive).toMatchObject({ outcome: "blocked_waiting_human", blockedAt: "C" });
      expect(first.body.drive.pathPolicyMisses).toEqual(paths.map((path) => ({ repoKey: null, path })));
      const frozenEvidence = { misses: first.body.drive.pathPolicyMisses, reason: first.body.drive.stopReason, claim: first.body.claim };
      const retried = runtime.service.retryTask(raw(runtime, "path-retry", "retry-task", { taskId: "a", runId: first.runId, allowObservedPaths: true }));
      expect(retried).toMatchObject({ result: { kind: "task-retried", taskId: "a", fromRunId: first.runId } });
      const amended = readConfirmedTaskExecution(runtime.store, "g", "a");
      expect(amended.contract.context.targetPaths).toEqual(["shared.txt", ...paths]);
      expect(readControlGroup(runtime.store, runtime.epoch, "g").runs[0]?.pathPolicyMisses).toEqual(paths.map((path) => ({ repoKey: null, path })));
      await until(() => workRuns(runtime).find((run) => run.runId !== first.runId)?.body.state === "settled", 240_000, "amended retry to settle");
      const after = workRuns(runtime), original = after.find((run) => run.runId === first.runId)!, second = after.find((run) => run.runId !== first.runId)!;
      expect(second.body.drive.outcome).toBe("succeeded");
      expect(original.body.state).toBe("settled-failed");
      expect({ misses: original.body.drive.pathPolicyMisses, reason: original.body.drive.stopReason, claim: original.body.claim }).toEqual(frozenEvidence);
      expect(w.show(paths[0]!)).toBe("one");
      expect(w.show(paths[1]!)).toBe("two");
    } finally { await w.teardown(); }
  });
});
