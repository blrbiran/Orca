import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ExecutionDriver } from "../../src/control/executionDriver.js";
import { readGroupActivity } from "../../src/control/activity.js";
import { isGroupAcceptancePathOf } from "../../src/control/workspace.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";

// Tester follow-up E §5 (#241): every task's checks ran on its own attempt and (R2) on its merge, yet a later landing can
// break an earlier task's checks unseen -- the tester's group was 7/7 done while its final `npm test` failed. A group is
// now accepted on its final tip (the union of its done tasks' setup and required checks, in a scratch worktree) before it
// is delivered and done. The synthetic ccloop runs no checks, so every invocation recorded here is Orca's own. The check
// below fails only in the acceptance worktree and only while the flag file exists, so the post-merge checks stay green.

const LANDED = ["landed", "settled"];

async function untilDeadline(driver: ExecutionDriver, predicate: () => boolean, deadlineMs = 20_000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (!predicate() && Date.now() < deadline) {
    await driver.round();
    if (!predicate()) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!predicate()) throw new Error("the driver did not reach the expected state before the deadline");
}

type Harness = Awaited<ReturnType<typeof driverHarness>>;
const group = (t: Harness) => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
const acceptanceRows = (t: Harness) => readGroupActivity(t.h.store, "g", 200).filter((entry) => entry.kind === "group-acceptance");
const groupDoneRows = (t: Harness) => readGroupActivity(t.h.store, "g", 200).filter((entry) => entry.kind === "group-done");
const tip = (t: Harness) => git(t.repo, "rev-parse", "refs/heads/orca/g");

function scratch(): { log: string; flag: string; check: string } {
  const dir = mkdtempSync(join(tmpdir(), "orca-acc-"));
  const log = join(dir, "calls"), flag = join(dir, "red");
  // Green everywhere but the acceptance worktree; there, red while the flag exists.
  return { log, flag, check: `echo "$PWD" >> '${log}'; case "$PWD" in *group-acceptance-*) test ! -f '${flag}' ;; *) true ;; esac` };
}
// Ruling (2026-11-12, tester follow-up F): each acceptance check now has its own scratch worktree
// (`group-acceptance-<g>.check-<n>`), so these criteria name it by isGroupAcceptancePathOf instead of one fixed path.
const scratchDirs = (t: Harness): string[] => readdirSync(t.deps.roots.workspacesRoot).filter((name) => isGroupAcceptancePathOf(name, "g"));
const acceptanceCalls = (log: string): string[] => existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter((line) => basename(line).startsWith("group-acceptance-")) : [];

describe("a group is accepted on its final tip before it is done (tester follow-up E §5, #241)", { timeout: 90_000 }, () => {
  it("a failed acceptance keeps the group out of done, is not rerun on the same tip (even by a new driver), and reruns when the tip moves", async () => {
    const { log, flag, check } = scratch();
    writeFileSync(flag, "red\n");
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }], { requiredChecks: [check] }); try {
      const ids = [await t.claim(), await t.claim()];
      const driver = t.driver();
      await untilDeadline(driver, () => group(t).acceptance !== undefined);
      expect(ids.every((id) => LANDED.includes(t.body(id).state))).toBe(true);
      const record = group(t).acceptance;
      expect(record.result).toBe("failed");
      expect(record.tip).toBe(tip(t));
      expect(record.commands.map((c: { command: string; exit: string }) => [c.command, c.exit])).toEqual([[check, "1"]]);
      expect(acceptanceCalls(log).map((path) => isGroupAcceptancePathOf(basename(path), "g"))).toEqual([true]);
      expect(scratchDirs(t)).toEqual([]);
      // One activity row, with the record as its body; and the group is not done.
      expect(acceptanceRows(t).map((row) => row.body)).toEqual([record]);
      for (let i = 0; i < 5; i += 1) await driver.round();
      expect(group(t).status).not.toBe("done");
      expect(groupDoneRows(t)).toEqual([]);
      // The check would pass now, but the tip has not moved: nothing reruns, not even after a restart.
      rmSync(flag);
      const restarted = t.driver();
      for (let i = 0; i < 5; i += 1) await restarted.round();
      expect(acceptanceCalls(log)).toHaveLength(1);
      expect(group(t).acceptance.result).toBe("failed");
      // A person's commit on orca/g moves the tip: the acceptance reruns on it by itself, passes, and the group is done.
      const fix = join(t.h.root, "fix");
      git(t.repo, "worktree", "add", "-q", fix, "orca/g");
      writeFileSync(join(fix, "fixed"), "fixed\n");
      git(fix, "add", "fixed");
      git(fix, "commit", "-qm", "person: fix the group");
      git(t.repo, "worktree", "remove", fix);
      const moved = tip(t);
      await untilDeadline(restarted, () => group(t).status === "done");
      expect(group(t).acceptance).toMatchObject({ result: "passed", tip: moved });
      expect(acceptanceCalls(log)).toHaveLength(2);
      expect(acceptanceRows(t).map((row) => row.body.result)).toEqual(["passed", "failed"]);
    } finally { await t.h.dispose(); }
  });

  it("runs every union check after an earlier check fails and preserves each exit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "orca-acceptance-union-"));
    const log = join(dir, "checks");
    const first = `case "$PWD" in *group-acceptance-*) echo first >> '${log}'; exit 4 ;; *) true ;; esac`;
    const second = `case "$PWD" in *group-acceptance-*) echo second >> '${log}'; true ;; *) true ;; esac`;
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }], { requiredChecks: [first, second] }); try {
      await t.claim(); await t.claim();
      const driver = t.driver();
      await untilDeadline(driver, () => group(t).acceptance !== undefined);
      const record = group(t).acceptance;
      expect(record.result).toBe("failed");
      expect(record.commands.slice(0, 2).map((command: { command: string; exit: string }) => [command.command, command.exit])).toEqual([[first, "4"], [second, "0"]]);
      expect(readFileSync(log, "utf8").trim().split("\n")).toEqual(["first", "second"]);
    } finally { await t.h.dispose(); }
  });

  it("stops the acceptance union when setup fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "orca-acceptance-setup-failure-"));
    const log = join(dir, "commands");
    const setup = `case "$PWD" in *group-acceptance-*) echo setup >> '${log}'; exit 9 ;; *) true ;; esac`;
    const check = `case "$PWD" in *group-acceptance-*) echo check >> '${log}'; true ;; *) true ;; esac`;
    const t = await driverHarness([
      { taskId: "a", contextExtra: { setupCommands: [setup] } },
      { taskId: "b", contextExtra: { setupCommands: [setup] } },
    ], { requiredChecks: [check] }); try {
      await t.claim(); await t.claim();
      const driver = t.driver();
      await untilDeadline(driver, () => group(t).acceptance !== undefined);
      const record = group(t).acceptance;
      expect(record.result).toBe("failed");
      expect(record.commands.slice(0, 1).map((command: { command: string; exit: string }) => [command.command, command.exit])).toEqual([[`setup: ${setup}`, "9"]]);
      expect(readFileSync(log, "utf8").trim().split("\n")).toEqual(["setup"]);
    } finally { await t.h.dispose(); }
  });

  it("a passing acceptance runs the tasks' setup union, then their checks once each, and the group is done after it", async () => {
    const { log, check } = scratch();
    const t = await driverHarness([
      { taskId: "a", contextExtra: { setupCommands: ["true"] } },
      { taskId: "b", contextExtra: { setupCommands: ["true", "echo set-up"] } },
    ], { requiredChecks: [check] }); try {
      const ids = [await t.claim(), await t.claim()];
      const driver = t.driver();
      await untilDeadline(driver, () => group(t).status === "done");
      expect(ids.every((id) => LANDED.includes(t.body(id).state))).toBe(true);
      const record = group(t).acceptance;
      expect(record).toMatchObject({ result: "passed", tip: tip(t) });
      expect(record.tail).toBeUndefined();
      expect(record.commands.map((c: { command: string; exit: string }) => [c.command, c.exit])).toEqual([["setup: true", "0"], ["setup: echo set-up", "0"], [check, "0"]]);
      expect(acceptanceCalls(log)).toHaveLength(1);
      // The acceptance is recorded before the group is done, never after.
      const [accepted] = acceptanceRows(t), [done] = groupDoneRows(t);
      expect(accepted!.body).toEqual(record);
      expect(done!.seq).toBeGreaterThan(accepted!.seq);
    } finally { await t.h.dispose(); }
  });

  // A stopped driver leaves no acceptance check half-done: stop() aborts it and waits until its scratch worktree is gone, so
  // whatever comes next (a restart, a test's teardown removing the state directory) never races its git or its commands.
  it("stop() aborts a running acceptance check and returns only once its scratch worktree is removed, recording nothing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "orca-acc-"));
    const started = join(dir, "started");
    const check = `case "$PWD" in *group-acceptance-*) touch '${started}'; sleep 30 ;; *) true ;; esac`;
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }], { requiredChecks: [check] }); try {
      await t.claim(); await t.claim();
      const driver = t.driver();
      await untilDeadline(driver, () => existsSync(started));
      const before = Date.now();
      await driver.stop();
      expect(Date.now() - before).toBeLessThan(15_000);
      expect(scratchDirs(t)).toEqual([]);
      expect(group(t).acceptance).toBeUndefined();
      expect(acceptanceRows(t)).toEqual([]);
    } finally { await t.h.dispose(); }
  });

  it("a single landing that edits an existing test stays pending for a human disposition", async () => {
    const baseTest = "it('works', () => { expect(1).toBe(1); });\n";
    const t = await driverHarness([{ taskId: "a", targetPaths: ["tests/**", "a"] }], {
      requiredChecks: ["true"], files: () => ({ a: "a\n", "tests/existing.test.ts": `${baseTest}// additive-looking edit\n` }),
    }); try {
      mkdirSync(join(t.repo, "tests"), { recursive: true });
      writeFileSync(join(t.repo, "tests", "existing.test.ts"), baseTest);
      git(t.repo, "add", "tests/existing.test.ts"); git(t.repo, "commit", "-qm", "test baseline");
      await t.claim();
      const driver = t.driver();
      await untilDeadline(driver, () => group(t).acceptance !== undefined);
      expect(group(t).acceptance).toMatchObject({ result: "test-change-pending", testChanges: { paths: ["tests/existing.test.ts"] } });
      expect(group(t).status).not.toBe("done");
    } finally { await t.h.dispose(); }
  });

  it("requires a disposition when a required check's existing script changes", async () => {
    const before = "process.stdout.write('base\\n');\n";
    const after = "process.stdout.write('tip\\n');\n";
    const t = await driverHarness([{ taskId: "a", targetPaths: ["a", "scripts/**"] }, { taskId: "b" }], {
      requiredChecks: ["node scripts/check-tests.mjs"],
      files: (taskId) => taskId === "a"
        ? { a: "a\\n", "scripts/check-tests.mjs": after }
        : { [taskId]: `${taskId}\\n` },
    });
    try {
      mkdirSync(join(t.repo, "scripts"), { recursive: true });
      writeFileSync(join(t.repo, "scripts", "check-tests.mjs"), before);
      git(t.repo, "add", "scripts/check-tests.mjs"); git(t.repo, "commit", "-qm", "check script baseline");
      await t.claim(); await t.claim();
      const driver = t.driver();
      await untilDeadline(driver, () => group(t).acceptance !== undefined || group(t).status === "done");
      expect(group(t).acceptance).toMatchObject({
        result: "test-change-pending",
        testChanges: { paths: ["scripts/check-tests.mjs"], weakeningSignals: ["check-script-changed:scripts/check-tests.mjs"], pendingResult: "passed" },
      });
    } finally { await t.h.dispose(); }
  });

  it("a group with one landed task records not-needed, runs nothing, writes no acceptance row, and is done", async () => {
    const { log, flag, check } = scratch();
    writeFileSync(flag, "red\n");
    const t = await driverHarness([{ taskId: "a" }], { requiredChecks: [check] }); try {
      await t.claim();
      const driver = t.driver();
      await untilDeadline(driver, () => group(t).status === "done");
      expect(group(t).acceptance).toMatchObject({ result: "not-needed", why: "single-landing", tip: tip(t), commands: [] });
      expect(acceptanceCalls(log)).toEqual([]);
      expect(acceptanceRows(t)).toEqual([]);
    } finally { await t.h.dispose(); }
  });
});
