/**
 * Off-plan writes #346, spec acceptance 3-5 (plan Task 7), through the real ccloop build ORCA_CCLOOP_BIN names and its
 * scripted fake codex (no provider is called). The loop tasks are imported at the current loop plan version (4): an empty
 * allowlist, the parallel siblings' frozen claims as the denylist.
 *  3. a write outside targetPaths, in a directory no sibling claims, lands and is recorded as `off-plan-write`;
 *  4. a write into a parallel sibling's claim stops `blocked_waiting_human`, is diagnosed `parallel-claim` naming the
 *     sibling, and the orca-auto pass (human ruling on W4, 2026-11-17, 「按建议走」) retries it `--after` the sibling: the
 *     task is dispatched again only on top of the sibling's landing, and then lands;
 *  5. the #345 shape: `board-cli` (`targetPaths: [src/cli.js, test/board-cli.test.js]`) writing `src/board/cli.js` lands.
 * These are integration criteria over Tasks 1-6, not red-first; the mutation that turns 4 red is Task 3's derivation off.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readConfirmedTaskExecution } from "../../src/control/executionSnapshot.js";
import { readWork } from "../../src/control/queries.js";
import type { ControlRuntime } from "../../src/panel/controlAssembly.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { ccloopWorlds, g, realBinary, startGroup, until, type RunRow, type Task, type World } from "./fixtures/ccloopWorld.js";

const { world, removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "orca-off-plan-e2e-", epochPrefix: "epoch-off-plan-e2e-" });
afterAll(removeRoots);

const loopTask = (taskId: string, targetPaths: string[]): Task =>
  ({ taskId, targetPaths, loop: { plan: "standard", goal: `write ${targetPaths.join(", ")}`, successCondition: "files exist", targetPaths, checks: ["true"] } });
/** Work runs in the order they were claimed (run ids are random). */
const runsInOrder = (runtime: ControlRuntime): RunRow[] => runtime.store.db.prepare("SELECT id,work_item_id,body FROM runs WHERE group_id='g' ORDER BY rowid").all()
  .map((row) => ({ runId: String(row.id), task: String(row.work_item_id), body: JSON.parse(String(row.body)) })).filter((row) => row.body.phase === "work");
const runsOf = (runtime: ControlRuntime, taskId: string): RunRow[] => runsInOrder(runtime).filter((run) => run.task === taskId);
const landed = (run: RunRow | undefined): boolean => run?.body.state === "settled" && run.body.drive?.outcome === "succeeded";
const offPlanRows = (runtime: ControlRuntime) => runtime.store.db.prepare("SELECT run_id, body FROM activity WHERE group_id='g' AND kind='off-plan-write' ORDER BY seq").all()
  .map((row) => ({ runId: String(row.run_id), ...JSON.parse(String(row.body)) }));
/** A run that stopped for any reason the scenario does not expect is reported by that reason, not waited out. */
const noUnexpectedBlock = (runtime: ControlRuntime, allowed: (run: RunRow) => boolean = () => false): void => {
  const blocked = runsInOrder(runtime).filter((run) => run.body.state === "blocked" && !allowed(run));
  if (blocked.length > 0) throw new Error(`blocked: ${blocked.map((run) => `${run.task}=${run.body.drive?.blockedReason} ${run.body.drive?.stopReason ?? ""}`).join(", ")}`);
};
/**
 * The fake codex writes a script entry's files with a bare writeFileSync (no mkdir), so a file in a subdirectory needs
 * that directory in the base: one commit on the target's HEAD (which the group's work branch starts from) with an empty
 * `.gitkeep` in each. The off-plan files themselves are new in every case.
 */
async function seedDirectories(w: World, dirs: string[]): Promise<void> {
  for (const dir of dirs) {
    await mkdir(join(w.repo, dir), { recursive: true });
    await writeFile(join(w.repo, dir, ".gitkeep"), "");
  }
  g(w.repo, "add", ...dirs.map((dir) => `${dir}/.gitkeep`));
  g(w.repo, "commit", "-qm", "directories");
}
/**
 * Orca acts on its own only in a group it orchestrates (`run`). startGroup confirms "only" (hold), but its start records
 * `run` (orchestration.ts recordStarted), so a started group is orchestrated until set back to `hold`; a held group's
 * started tasks still dispatch, only the orca-auto passes (systemDebug.ts) pass it over.
 */
const orchestrate = (runtime: ControlRuntime, mode: "run" | "hold" = "run"): void => {
  runtime.store.db.prepare("UPDATE group_orchestration SET body=json_set(body,'$.mode',?) WHERE group_id='g'").run(mode);
};

describe.skipIf(!realBinary)("off-plan writes through the real ccloop binary (#346 acceptance 3-5)", { timeout: 600_000 }, () => {
  relocateHome("orca-off-plan-e2e-home-");

  it("a write outside targetPaths in a directory no sibling claims lands, and off-plan-write names it (acceptance 3)", async () => {
    const w = await world([loopTask("a", ["src/a.txt"]), loopTask("b", ["lib/b.txt"])], {
      a: { files: { "src/a.txt": "A\n", "docs/notes.md": "notes\n" }, reportedChangedFiles: ["src/a.txt", "docs/notes.md"] },
      b: { files: { "lib/b.txt": "B\n" }, reportedChangedFiles: ["lib/b.txt"] },
    });
    await seedDirectories(w, ["src", "lib", "docs"]);
    const runtime = await w.boot();
    try {
      await startGroup(runtime, w.repoId, 1_000_000);
      // The world is what the criterion says: v4 contracts, a and b parallel, each denying the other's target, nothing under docs/.
      const a = readConfirmedTaskExecution(runtime.store, "g", "a").contract;
      expect(a.safetyPolicy.allowlistPaths).toEqual([]);
      expect(a.safetyPolicy.denylistPaths).toContain("lib/b.txt");
      expect(a.safetyPolicy.denylistPaths.some((path) => path.startsWith("docs"))).toBe(false);
      expect(readConfirmedTaskExecution(runtime.store, "g", "b").contract.safetyPolicy.denylistPaths).toContain("src/a.txt");
      runtime.startPump(50);
      await until(() => { noUnexpectedBlock(runtime); return landed(runsOf(runtime, "a")[0]) && landed(runsOf(runtime, "b")[0]); }, 300_000, "a and b to land");
      const runA = runsOf(runtime, "a")[0]!;
      expect(runsOf(runtime, "a")).toHaveLength(1);
      expect(w.show("docs/notes.md")).toBe("notes");
      expect(w.show("src/a.txt")).toBe("A");
      expect(w.show("lib/b.txt")).toBe("B");
      // b wrote only its own target: no row for it.
      expect(offPlanRows(runtime)).toEqual([{ runId: runA.runId, taskId: "a", paths: ["docs/notes.md"], count: 1 }]);
    } finally { await w.teardown(); }
  });

  it("a write into a parallel sibling's claim stops, is diagnosed parallel-claim, and orca-auto retries it after the sibling lands (acceptance 4)", async () => {
    // b sleeps in execute so that a's stop, its diagnosis and the automatic retry all happen while b is still running.
    const w = await world([loopTask("a", ["a.txt"]), loopTask("b", ["b.txt"])], {
      a: { files: { "a.txt": "A\n", "b.txt": "from a\n" }, reportedChangedFiles: ["a.txt", "b.txt"] },
      b: { files: { "b.txt": "B\n" }, reportedChangedFiles: ["b.txt"], delayMs: { execute: 45_000 } },
    });
    const runtime = await w.boot();
    try {
      await startGroup(runtime, w.repoId, 1_000_000);
      // Ruling (session 3ba26002, human: 「这次批准改写所有必要的判据」): setup only, the assertions are unchanged.
      // Held until the stop is read: orchestrated, the parallel-claim pass retries a's stop on the next pump (~60-130 ms
      // after it, measured), and that retry's `--after b` drops b's claim from a's confirmed contract -- a 100 ms poll could
      // miss the stop and read the denylist already without b.txt.
      orchestrate(runtime, "hold");
      runtime.startPump(50);
      // mutation: Task 3's derivation off (no sibling claim denied) -> a lands with b.txt instead of stopping, red here
      await until(() => {
        if (landed(runsOf(runtime, "a")[0])) throw new Error("a landed its write into b's claim instead of stopping");
        noUnexpectedBlock(runtime, (run) => run.task === "a");
        return runsOf(runtime, "a")[0]?.body.state === "blocked" || runsOf(runtime, "a").length > 1;
      }, 300_000, "a to stop on b's claim");
      const first = runsOf(runtime, "a")[0]!;
      expect(first.body.drive).toMatchObject({ outcome: "blocked_waiting_human", blockedAt: "C", stopReason: "denylist match: b.txt" });
      expect(first.body.drive.parallelClaim).toEqual({ path: "b.txt", repoKey: null, siblingIds: ["b"] });
      // Read after the stop, so the mutation below is seen at the landing, not short-circuited by this line.
      expect(readConfirmedTaskExecution(runtime.store, "g", "a").contract.safetyPolicy.denylistPaths).toContain("b.txt");
      expect(readControlGroup(runtime.store, runtime.epoch, "g").runs.find((run) => run.runId === first.runId)?.diagnosis).toMatchObject({ cause: "parallel-claim", siblings: ["b"] });
      orchestrate(runtime);

      // Orca's own retry, once for this run: the command row is its record. The order each was first seen in: the retry
      // (while b still runs, so the wait is not trivial), b's landing commit, a's second run. a's second run must never be
      // claimed before b has landed.
      const commandId = `orca-auto-parallel-claim-a-${first.runId}`;
      const order: string[] = [];
      await until(() => {
        noUnexpectedBlock(runtime, (run) => run.runId === first.runId);
        const bRun = runsOf(runtime, "b")[0], second = runsOf(runtime, "a")[1];
        if (!order.includes("retry") && runtime.store.db.prepare("SELECT 1 FROM commands WHERE group_id='g' AND id=?").get(commandId) !== undefined) order.push("retry");
        if (!order.includes("b") && typeof bRun?.body.drive?.landedCommit === "string") order.push("b");
        if (!order.includes("a2") && second !== undefined) order.push("a2");
        return landed(second);
      }, 400_000, "a's retry to land");
      expect(order).toEqual(["retry", "b", "a2"]);
      expect(readWork(runtime.store, "g", "a")).toMatchObject({ dependsOn: ["b"], afterDependsOn: ["b"] });
      expect(readConfirmedTaskExecution(runtime.store, "g", "a").contract.safetyPolicy.denylistPaths).not.toContain("b.txt");
      const bRun = runsOf(runtime, "b")[0]!, second = runsOf(runtime, "a")[1]!;
      expect(runsOf(runtime, "a")).toHaveLength(2);
      // The retry started on top of b's landing, and landed after it.
      expect(() => g(w.repo, "merge-base", "--is-ancestor", bRun.body.drive.landedCommit, second.body.drive.base)).not.toThrow();
      expect(w.show("a.txt")).toBe("A");
      expect(w.show("b.txt")).toBe("from a");
      expect(runsOf(runtime, "a")[0]!.body.state).toBe("settled-failed");
      // a's write of b.txt is off its own plan: recorded with its landing.
      expect(offPlanRows(runtime)).toEqual([{ runId: second.runId, taskId: "a", paths: ["b.txt"], count: 1 }]);
    } finally { await w.teardown(); }
  });

  it("the #345 shape: board-cli writing src/board/cli.js lands (acceptance 5)", async () => {
    const targets = ["src/cli.js", "test/board-cli.test.js"];
    const w = await world([loopTask("board-cli", targets)], {
      "board-cli": { files: { "src/cli.js": "import './board/cli.js';\n", "test/board-cli.test.js": "test\n", "src/board/cli.js": "export {};\n" },
        reportedChangedFiles: [...targets, "src/board/cli.js"] },
    });
    await seedDirectories(w, ["src", "src/board", "test"]);
    const runtime = await w.boot();
    try {
      await startGroup(runtime, w.repoId, 1_000_000);
      expect(readConfirmedTaskExecution(runtime.store, "g", "board-cli").contract.safetyPolicy.allowlistPaths).toEqual([]);
      runtime.startPump(50);
      await until(() => { noUnexpectedBlock(runtime); return landed(runsOf(runtime, "board-cli")[0]); }, 300_000, "board-cli to land");
      expect(w.show("src/board/cli.js")).toBe("export {};");
      expect(offPlanRows(runtime)).toEqual([{ runId: runsOf(runtime, "board-cli")[0]!.runId, taskId: "board-cli", paths: ["src/board/cli.js"], count: 1 }]);
    } finally { await w.teardown(); }
  });
});
