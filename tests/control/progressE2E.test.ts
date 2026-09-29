import { afterAll, describe, expect, it } from "vitest";
import type { ControlRuntime } from "../../src/panel/controlAssembly.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { ccloopWorlds, noBlocked, realBinary, startGroup, until, workRuns } from "./fixtures/ccloopWorld.js";

/**
 * Labels and progress spec §5.2 E2E and §8 R13, against the real ccloop build (ORCA_CCLOOP_BIN, which must contain the
 * ccloop change that makes collect answer `progress`) and its scripted fake codex. One task whose execute phase sleeps
 * long enough for several driver rounds: the group view must show the `execute` step while it runs, and 1/1 once the
 * task settles. The skip below only fires with no binary configured; the gate (plan Task 8 Step 5) proves from the JSON
 * reporter that this criterion ran and passed rather than skipped.
 */
const { world, removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "orca-progress-e2e-", epochPrefix: "epoch-progress-" });
afterAll(removeRoots);

const workStatus = (runtime: ControlRuntime, taskId: string): string =>
  JSON.parse(String(runtime.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body)).status;

describe.skipIf(!realBinary)("task progress against real ccloop (labels and progress spec §5.2)", { timeout: 300_000 }, () => {
  relocateHome("orca-progress-e2e-home-");

  it("P-E2E: a single task shows the execute step while ccloop executes, and the group reads 1/1 once it settles", async () => {
    const w = await world([{ taskId: "a", targetPaths: ["a.txt"], verifierType: "command" }], { a: { files: { "a.txt": "A\n" }, delayMs: { execute: 4_000 } } });
    const runtime = await w.boot();
    try {
      await startGroup(runtime, w.repoId);
      runtime.startPump(50);
      const seen: string[] = [];
      await until(() => {
        noBlocked(runtime);
        const step = readControlGroup(runtime.store, runtime.epoch, "g").workItems[0]!.progress?.step ?? null;
        if (step !== null && seen.at(-1) !== step) seen.push(step);
        return seen.includes("execute");
      }, 120_000, "the execute step to be observed", 50);
      await until(() => { noBlocked(runtime); return workStatus(runtime, "a") === "done" && workRuns(runtime).every((run) => run.body.drive?.cleanedUp === true); }, 180_000, "the task to settle");
      const view = readControlGroup(runtime.store, runtime.epoch, "g");
      expect(view.summary.completion).toEqual({ done: 1, total: 1 });
      expect(view.workItems[0]!.progress?.step).toBe("succeeded");
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });
});
