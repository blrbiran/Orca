import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ExecutionDriver } from "../../src/control/executionDriver.js";
import { readGroupActivity } from "../../src/control/activity.js";
import { groupAcceptancePathOf } from "../../src/control/workspace.js";
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
      expect(acceptanceCalls(log).map((path) => basename(path))).toEqual([basename(groupAcceptancePathOf(t.deps.roots, "g"))]);
      expect(existsSync(groupAcceptancePathOf(t.deps.roots, "g"))).toBe(false);
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
