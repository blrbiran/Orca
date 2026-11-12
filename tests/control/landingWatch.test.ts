import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { runEveryCheck } from "../../src/control/checkCommand.js";
import { deliverSchedulerWakes } from "../../src/control/dispatch.js";
import { watchLandings, type LandingWatchCheck } from "../../src/control/landingWatch.js";
import { landingWatchOf } from "../../src/control/landingWatchRecord.js";
import { createWebWakeHandlers } from "../../src/control/webDispatch.js";
import { write, type ExecutionDriver } from "../../src/control/executionDriver.js";
import { groupAcceptancePathOf, isGroupAcceptancePathOf, isLandingWatchPathOf, landingWatchPathOf } from "../../src/control/workspace.js";
import { driverHarness } from "./fixtures/driverHarness.js";

// Tester follow-up G Part 6 §6.2 (#269): on every landing the union of the group's checks runs on the group branch tip, off
// the round and blocking nothing; a check that was green and turns red after a landing is a problem naming that landing.

const AS = { runId: "landing-watch-test" };
const CHECK = "test ! -e broken";
type Harness = Awaited<ReturnType<typeof driverHarness>>;
const groupBody = (t: Harness) => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
const runOf = (t: Harness, task: string): string | null => {
  const row = t.h.store.db.prepare("SELECT id FROM runs WHERE group_id='g' AND work_item_id=? ORDER BY rowid DESC").get(task);
  return row === undefined ? null : String(row.id);
};
const watchRows = (t: Harness) => t.h.store.db.prepare("SELECT body FROM activity WHERE group_id='g' AND kind='landing-watch' ORDER BY seq").all().map((row) => JSON.parse(String(row.body)));

/**
 * a: guarded by `test ! -e broken`; b (after a) writes `broken`; d (after b) deletes it; c never finishes (its run waits for
 * a handoff that never comes), so the group is never all done, and c's own check (`test -e c-done`) is red from the start.
 */
async function world() {
  return driverHarness([
    { taskId: "a", requiredChecks: [CHECK] },
    { taskId: "b", dependsOn: ["a"], targetPaths: ["broken"] },
    { taskId: "c", requiredChecks: ["test -e c-done"] },
    { taskId: "d", dependsOn: ["b"], targetPaths: ["broken"] },
  ], {
    behaviour: (id) => id === "c" ? "stoppable-silent" : "succeed",
    files: (id) => id === "b" ? { broken: "x\n" } : id === "d" ? { broken: null } : { [id]: `${id}\n` },
  });
}

async function rounds(t: Harness, driver: ExecutionDriver, until: () => boolean, deliver: boolean, max = 80): Promise<void> {
  const { start } = createWebWakeHandlers({ ...t.dispatch, service: t.service });
  for (let i = 0; i < max && !until(); i += 1) {
    if (deliver) await deliverSchedulerWakes(t.h.store, { start });
    await driver.round();
    // The watch runs off the round; give its commands a moment before the next round reads it.
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (!until()) throw new Error("the expected state was not reached");
}

const states = (t: Harness) => landingWatchOf(groupBody(t))?.states ?? {};
const regressions = (t: Harness) => landingWatchOf(groupBody(t))?.regressions ?? [];

describe("#269: runEveryCheck", () => {
  it("every check runs even after one fails", async () => {
    const outcome = await runEveryCheck(mkdtempSync(join(tmpdir(), "every-")), [], ["false", "true"], 5000, AS);
    expect(outcome.setupFailure).toBeNull();
    expect(outcome.commands.map((c) => c.exit)).toEqual(["1", "0"]);
  });

  it("a failed setup runs no check", async () => {
    const outcome = await runEveryCheck(mkdtempSync(join(tmpdir(), "every-")), ["false"], ["true"], 5000, AS);
    expect(outcome.setupFailure?.command).toBe("setup: false");
    expect(outcome.commands.length).toBe(1);
  });

  it("a check that times out is red with the bound it hit", async () => {
    const outcome = await runEveryCheck(mkdtempSync(join(tmpdir(), "every-")), [], ["sleep 5", "true"], 300, AS);
    expect(outcome.commands.map((c) => c.exit)).toEqual(["timeout 300 ms", "0"]);
  });

  it("an acceptance sweep never names a watch worktree, nor a watch sweep an acceptance one", () => {
    const roots = { workspacesRoot: "/w" } as Parameters<typeof landingWatchPathOf>[0];
    expect(isGroupAcceptancePathOf(basename(landingWatchPathOf(roots, "g", 3)), "g")).toBe(false);
    expect(isLandingWatchPathOf(basename(groupAcceptancePathOf(roots, "g", 3)), "g")).toBe(false);
    expect(isLandingWatchPathOf(basename(landingWatchPathOf(roots, "g", 3)), "g")).toBe(true);
  });
});

describe("#269: the landing watch", () => {
  it("a landing that breaks an earlier task's check is a problem naming it; it clears when the check is green again", async () => {
    const t = await world(); try {
      const driver = t.driver();
      await t.claim(); // a
      // a landed and was watched: its check green; c's check red from the first watch, and no regression for it.
      await rounds(t, driver, () => states(t)[CHECK] === "green", false);
      expect(states(t)["test -e c-done"]).toBe("red");
      expect(regressions(t)).toEqual([]);
      // b lands (claimed after a landed); d is not claimed until the regression is recorded.
      await rounds(t, driver, () => runOf(t, "b") !== null, true);
      await rounds(t, driver, () => regressions(t).length > 0, false);
      expect(regressions(t)).toEqual([expect.objectContaining({ command: CHECK, landedTaskIds: ["b"], exit: "1" })]);
      expect(watchRows(t)).toEqual([expect.objectContaining({ transition: "turned-red", command: CHECK, landedTaskIds: ["b"] })]);
      // Nothing waited on it: c's run is running, not blocked.
      await rounds(t, driver, () => runOf(t, "c") !== null && runOf(t, "d") !== null, true);
      expect(t.body(runOf(t, "c")!).state).not.toBe("blocked");
      // d removes `broken`: the check is green again and the regression clears.
      await rounds(t, driver, () => regressions(t).length === 0, true);
      expect(states(t)[CHECK]).toBe("green");
      expect(watchRows(t).map((row) => row.transition)).toEqual(["turned-red", "turned-green"]);
    } finally { await t.h.dispose(); }
  }, 120000);

  it("a tip that moved under a watch is watched next, naming the later landing", async () => {
    const t = await world(); try {
      const paths: string[] = [];
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      t.deps.beforeScratchRemoved = async (path) => { if (!path.includes("landing-watch-")) return; paths.push(path); if (paths.length === 1) await held; };
      const driver = t.driver();
      await t.claim(); // a
      await rounds(t, driver, () => paths.length === 1, false);
      const aLanded = t.body(runOf(t, "a")!).drive.landedCommit as string;
      // b lands while the first watch is held on a's tip.
      await rounds(t, driver, () => runOf(t, "b") !== null && typeof t.body(runOf(t, "b")!).drive?.landedCommit === "string", true);
      expect(paths.length).toBe(1);
      release();
      await rounds(t, driver, () => regressions(t).length > 0, false);
      expect(regressions(t)).toEqual([expect.objectContaining({ command: CHECK, landedTaskIds: ["b"] })]);
      expect(regressions(t)[0]!.tip).not.toBe(aLanded);
      expect(paths.length).toBe(2);
      // The first record was the held watch's, for a's tip, covering a only.
      expect(watchRows(t)).toHaveLength(1);
    } finally { await t.h.dispose(); }
  }, 120000);

  it("a group whose tasks are all done is left to acceptance", async () => {
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b", dependsOn: ["a"] }]); try {
      const driver = t.driver();
      await t.claim();
      const { start } = createWebWakeHandlers({ ...t.dispatch, service: t.service });
      const done = () => ["a", "b"].every((id) => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(id)!.body)).status === "done");
      for (let i = 0; i < 120 && !done(); i += 1) { await deliverSchedulerWakes(t.h.store, { start }); await driver.round(); }
      expect(done()).toBe(true);
      await driver.stop();
      // Forget every watch: both landings are uncovered, yet with every task done no watch starts.
      write(t.deps, () => { const body = groupBody(t); delete body.landingWatch; t.h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(body)); });
      const checks = new Map<string, LandingWatchCheck>();
      await watchLandings({ store: t.h.store, roots: t.deps.roots, resolveRepository: t.deps.resolveRepository, write: (action) => write(t.deps, action), stopped: () => false }, checks);
      expect(checks.size).toBe(0);
    } finally { await t.h.dispose(); }
  }, 120000);
});
