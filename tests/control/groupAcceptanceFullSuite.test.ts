import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ExecutionDriver } from "../../src/control/executionDriver.js";
import { readGroupActivity } from "../../src/control/activity.js";
import { acceptanceProblem, fullSuiteWarning } from "../../src/control/groupAcceptanceRecord.js";
import { landingWatchOf } from "../../src/control/landingWatchRecord.js";
import { deliverSchedulerWakes } from "../../src/control/dispatch.js";
import { createWebWakeHandlers } from "../../src/control/webDispatch.js";
import { isGroupAcceptancePathOf } from "../../src/control/workspace.js";
import { readRepositorySettingsBody, writeRepositorySettingsBody } from "../../src/control/workspaceSettings.js";
import { driverHarness } from "./fixtures/driverHarness.js";

// Full suite spec 2026-11-12 (#279): a group was "done, acceptance passed" on 8 focused checks while its full suite was red
// on a behaviour between two tasks' areas. With the project's full-suite command set (its integration-check command), the
// acceptance runs it once after the union, once more when red; unset, nothing more runs (human: 「方案A」) and the record
// names what code would suggest -- never run until a person adopts it (「人采纳才用」).

type Harness = Awaited<ReturnType<typeof driverHarness>>;
const group = (t: Harness) => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
const commandsOf = (t: Harness) => (group(t).acceptance.commands as Array<{ command: string; exit: string }>).map((c) => [c.command, c.exit]);

/** A person sets (adopts) the project's full-suite command: the integration-check command of its repository layer. */
function setSuite(t: Harness, command: string): void {
  const repoId = group(t).plan.repoId as string;
  const current = readRepositorySettingsBody(t.h.store, repoId) ?? { workspaceMode: "worktree" as const, revision: 0 };
  writeRepositorySettingsBody(t.h.store, repoId, { ...current, revision: current.revision + 1, checks: { ...current.checks, integrationCheck: { command } } });
}

async function untilDeadline(driver: ExecutionDriver, predicate: () => boolean, deadlineMs = 20_000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (!predicate() && Date.now() < deadline) {
    await driver.round();
    if (!predicate()) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!predicate()) throw new Error("the driver did not reach the expected state before the deadline");
}

/** A suite command that logs where it ran and exits as `script` says; `runs` counts its runs (shell arithmetic). */
function suite(script: string): { command: string; log: string; runs: () => string[] } {
  const dir = mkdtempSync(join(tmpdir(), "orca-suite-"));
  const log = join(dir, "calls"), counter = join(dir, "n");
  return {
    log,
    command: `echo "$PWD" >> '${log}'; n=$(( $(cat '${counter}' 2>/dev/null || echo 0) + 1 )); echo $n > '${counter}'; ${script}`,
    runs: () => existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [],
  };
}

describe("group acceptance and the project's full suite (spec §4)", { timeout: 90_000 }, () => {
  it("unset: only the union runs, the group is done, and the record names the suggestion without running it", async () => {
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }]); try {
      // The repository's checkout has a test script: "npm test" is suggested. Run in the scratch tree it would fail (no
      // package.json is committed), so a suggestion that ran would turn this acceptance red.
      writeFileSync(join(t.repo, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
      await t.claim(); await t.claim();
      const driver = t.driver();
      await untilDeadline(driver, () => group(t).status === "done");
      const record = group(t).acceptance;
      expect(record.result).toBe("passed");
      expect(commandsOf(t)).toEqual([["true", "0"]]);
      expect(record.fullSuite).toEqual({ command: null, suggestion: "npm test", exits: [], flaky: false });
      expect(fullSuiteWarning(record)).toBe("full-suite-not-set");
    } finally { await t.h.dispose(); }
  });

  it("set: the suite runs once after the union, in the acceptance's scratch tree, and the group is done", async () => {
    const s = suite("true");
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }]); try {
      await t.claim(); await t.claim();
      setSuite(t, s.command);
      const driver = t.driver();
      await untilDeadline(driver, () => group(t).status === "done");
      const record = group(t).acceptance;
      expect(record.result).toBe("passed");
      expect(commandsOf(t)).toEqual([["true", "0"], [s.command, "0"]]);
      expect(record.fullSuite).toEqual({ command: s.command, suggestion: null, exits: ["0"], flaky: false });
      expect(s.runs().map((path) => isGroupAcceptancePathOf(basename(path), "g"))).toEqual([true]);
      expect(fullSuiteWarning(record)).toBeNull();
    } finally { await t.h.dispose(); }
  });

  it("red once, green on the retry: passed, recorded flaky, and the group is done", async () => {
    const s = suite("test $n -ge 2");
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }]); try {
      await t.claim(); await t.claim();
      setSuite(t, s.command);
      const driver = t.driver();
      await untilDeadline(driver, () => group(t).status === "done");
      const record = group(t).acceptance;
      expect(record.result).toBe("passed");
      expect(commandsOf(t)).toEqual([["true", "0"], [s.command, "1"], [s.command, "0"]]);
      expect(record.fullSuite).toEqual({ command: s.command, suggestion: null, exits: ["1", "0"], flaky: true });
      expect(fullSuiteWarning(record)).toBe(`full-suite-flaky:${s.command}`);
    } finally { await t.h.dispose(); }
  });

  it("red twice: the acceptance failed on the suite, and the group is not done", async () => {
    const s = suite("false");
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }]); try {
      await t.claim(); await t.claim();
      setSuite(t, s.command);
      const driver = t.driver();
      await untilDeadline(driver, () => group(t).acceptance !== undefined);
      const record = group(t).acceptance;
      expect(record.result).toBe("failed");
      expect(commandsOf(t)).toEqual([["true", "0"], [s.command, "1"], [s.command, "1"]]);
      expect(record.fullSuite).toEqual({ command: s.command, suggestion: null, exits: ["1", "1"], flaky: false });
      expect(acceptanceProblem(record)).toBe(`group-acceptance-failed:${s.command}`);
      for (let i = 0; i < 5; i += 1) await driver.round();
      expect(group(t).status).not.toBe("done");
      expect(s.runs()).toHaveLength(2);
    } finally { await t.h.dispose(); }
  });

  it("set: a group with one landing is checked too (the suite ran on no task's tree)", async () => {
    const s = suite("true");
    const t = await driverHarness([{ taskId: "a" }]); try {
      setSuite(t, s.command);
      await t.claim();
      const driver = t.driver();
      await untilDeadline(driver, () => group(t).status === "done");
      expect(group(t).acceptance).toMatchObject({ result: "passed", fullSuite: { command: s.command, exits: ["0"] } });
      expect(s.runs()).toHaveLength(1);
      // The group waited for it: done is recorded after the acceptance, never before (the gate reads the setting).
      const rows = readGroupActivity(t.h.store, "g", 200);
      const accepted = rows.find((row) => row.kind === "group-acceptance"), done = rows.find((row) => row.kind === "group-done");
      expect(done!.seq).toBeGreaterThan(accepted!.seq);
    } finally { await t.h.dispose(); }
  });

  it("the landing watch keeps running only the union, never the suite (#269)", async () => {
    const s = suite("true");
    // b never finishes, so the group is never all done and only the watch runs on a's landing.
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }], { behaviour: (id) => id === "b" ? "stoppable-silent" : "succeed" }); try {
      setSuite(t, s.command);
      await t.claim();
      const driver = t.driver();
      const { start } = createWebWakeHandlers({ ...t.dispatch, service: t.service });
      for (let i = 0; i < 80 && landingWatchOf(group(t)) === null; i += 1) {
        await deliverSchedulerWakes(t.h.store, { start });
        await driver.round();
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(Object.keys(landingWatchOf(group(t))!.states)).toEqual(["true"]);
      expect(s.runs()).toEqual([]);
    } finally { await t.h.dispose(); }
  }, 120_000);
});
