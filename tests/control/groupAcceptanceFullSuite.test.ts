import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ExecutionDriver } from "../../src/control/executionDriver.js";
import { readGroupActivity } from "../../src/control/activity.js";
import { acceptanceProblem, acceptanceSatisfied, fullSuiteWarning } from "../../src/control/groupAcceptanceRecord.js";
import { landingWatchOf } from "../../src/control/landingWatchRecord.js";
import { deliverSchedulerWakes } from "../../src/control/dispatch.js";
import { createWebWakeHandlers } from "../../src/control/webDispatch.js";
import { isGroupAcceptancePathOf } from "../../src/control/workspace.js";
import { readRepositorySettingsBody, writeRepositorySettingsBody } from "../../src/control/workspaceSettings.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";

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

/** A suite that logs whether it ran in the tip tree (task a present) or the base tree, and exits as `script` says. */
function suiteAtBase(script: string): { command: string; runs: () => string[] } {
  const dir = mkdtempSync(join(tmpdir(), "orca-suite-"));
  const log = join(dir, "calls"), counter = join(dir, "n");
  return {
    command: `echo "$(test -f a && echo tip || echo base)" >> '${log}'; n=$(( $(cat '${counter}' 2>/dev/null || echo 0) + 1 )); echo $n > '${counter}'; ${script}`,
    runs: () => existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [],
  };
}

describe("group acceptance and the project's full suite (spec §4)", { timeout: 90_000 }, () => {
  it("#387: the record carries what the suite said it ran (`# tests N`), the evidence a partial run cannot fake", async () => {
    const s = suite("echo '# tests 79'; echo '# pass 79'; echo '# fail 0'; true");
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }]); try {
      await t.claim(); await t.claim();
      setSuite(t, s.command);
      const driver = t.driver();
      await untilDeadline(driver, () => group(t).status === "done");
      const record = group(t).acceptance;
      expect(record.fullSuite).toMatchObject({ exits: ["0"], flaky: false, tests: 79 });
      expect(fullSuiteWarning(record)).toBeNull();
    } finally { await t.h.dispose(); }
  });

  it("#383: a suite task runs already reported red is run twice even when the first run is green, and the record says so", async () => {
    const s = suite("true");
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }]); try {
      await t.claim(); await t.claim();
      setSuite(t, s.command);
      // What a task run's report leaves behind (preexistingFailure.ts's activity row).
      t.h.store.db.prepare("INSERT INTO activity(group_id,kind,body,at) VALUES ('g','preexisting-failure',?,0)")
        .run(JSON.stringify({ taskId: "a", runId: "run-reported", command: s.command, chose: "left it for the owner" }));
      const driver = t.driver();
      await untilDeadline(driver, () => group(t).status === "done");
      const record = group(t).acceptance;
      expect(record.result).toBe("passed");
      // Ruling: human approval, 2026-11-20 (P1) -- task runs reported this suite red, so two greens after that are a
      // flaky suite, not a stable one. The old `flaky: false` here recorded exactly the state #383 reported.
      expect(record.fullSuite).toMatchObject({ exits: ["0", "0"], flaky: true, reported: 1 });
      expect(s.runs()).toHaveLength(2);
      expect(fullSuiteWarning(record)).toBe(`full-suite-reported-flaky:${s.command}`);
    } finally { await t.h.dispose(); }
  });

  it("#383: a suite no task run reported red stays non-flaky after its single green", async () => {
    const s = suite("true");
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }]); try {
      await t.claim(); await t.claim();
      setSuite(t, s.command);
      const driver = t.driver();
      await untilDeadline(driver, () => group(t).status === "done");
      const record = group(t).acceptance;
      // No report behind it: one green suffices, and the record carries no `reported` field.
      expect(record.fullSuite).toEqual({ command: s.command, suggestion: null, exits: ["0"], flaky: false });
      expect(s.runs()).toHaveLength(1);
    } finally { await t.h.dispose(); }
  });

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

  it("red twice at the tip, green at the base: the acceptance failed (this group broke it)", async () => {
    const s = suiteAtBase("test ! -f a");
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }]); try {
      await t.claim(); await t.claim();
      setSuite(t, s.command);
      const driver = t.driver();
      await untilDeadline(driver, () => group(t).acceptance !== undefined);
      const record = group(t).acceptance;
      expect(record.result).toBe("failed");
      expect(commandsOf(t)).toEqual([["true", "0"], [s.command, "1"], [s.command, "1"]]);
      expect(record.fullSuite).toEqual({ command: s.command, suggestion: null, exits: ["1", "1"], flaky: false });
      expect(record.fullSuite.baseline).toBeUndefined();
      expect(acceptanceProblem(record)).toBe(`group-acceptance-failed:${s.command}`);
      // The baseline was still measured, once green at the base (so no retry there).
      expect(s.runs()).toEqual(["tip", "tip", "base"]);
      for (let i = 0; i < 5; i += 1) await driver.round();
      expect(group(t).status).not.toBe("done");
    } finally { await t.h.dispose(); }
  });

  it("red twice at the tip and at the base: passed relative to the base, and the group is done (spec 2026-11-16)", async () => {
    const s = suiteAtBase("false");
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }]); try {
      await t.claim(); await t.claim();
      setSuite(t, s.command);
      const base = git(t.repo, "rev-parse", "main");
      const driver = t.driver();
      await untilDeadline(driver, () => group(t).status === "done");
      const record = group(t).acceptance;
      expect(record.result).toBe("passed-relative");
      expect(commandsOf(t)).toEqual([["true", "0"], [s.command, "1"], [s.command, "1"], [`baseline: ${s.command}`, "1"], [`baseline: ${s.command}`, "1"]]);
      expect(record.fullSuite).toMatchObject({ command: s.command, exits: ["1", "1"], baseline: { tip: base, exits: ["1", "1"] } });
      expect(fullSuiteWarning(record)).toBe(`full-suite-pre-existing:${s.command}`);
      expect(acceptanceProblem(record)).toBeNull();
      expect(s.runs()).toEqual(["tip", "tip", "base", "base"]);
    } finally { await t.h.dispose(); }
  });

  // Review of #377 (C1): a task check red at the tip stops the union before the suite runs; the base was still compared
  // and a red suite there made the record passed-relative, so acceptance was satisfied with a red task check.
  it("a task check red at the tip with the suite red at the base: failed, and the base is not compared (#377 review C1)", async () => {
    const s = suiteAtBase("false");
    // Red only in the acceptance's scratch tree, so each task's own run of it passes.
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }], { requiredChecks: [`case "$PWD" in *group-acceptance-*) exit 7 ;; *) true ;; esac`] }); try {
      await t.claim(); await t.claim();
      setSuite(t, s.command);
      const driver = t.driver();
      await untilDeadline(driver, () => group(t).acceptance !== undefined);
      const record = group(t).acceptance;
      // mutation: drop the suiteExits test before the base comparison (and at the classification) -> passed-relative, red
      expect(record.result).toBe("failed");
      expect(record.fullSuite.baseline).toBeUndefined();
      expect(record.fullSuite.exits).toEqual([]);
      expect(commandsOf(t).map(([, exit]) => exit)).toEqual(["7"]);
      expect(s.runs()).toEqual([]);
      expect(acceptanceSatisfied(t.h.store, "g", group(t))).toBe(false);
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
