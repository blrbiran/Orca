import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createExecutionDriver, type ExecutionDriver } from "../../src/control/executionDriver.js";
import { reconcileNextAction, stepD } from "../../src/control/driverLanding.js";
import { readWebGroup } from "../../src/control/webService.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";

// Execution driver spec §5.3: a conflicting landing is reconciled by a separate run (human ruling),
// charged to the group, and lands as an ordinary merge of the tip and the run's own attempt.
const conflicting = [{ taskId: "a", targetPaths: ["shared.txt"] }, { taskId: "b", targetPaths: ["shared.txt"] }];
const files = (id: string) => ({ "shared.txt": id === "a" ? "A\n" : "B\n" });
// Landed or, once Task 7 exists, already settled: both keep drive.landedCommit.
const LANDED = ["landed", "settled"];
// Deviation (Task 6 implementer, 2026-09-25): the reconciliation is a background process, and rounds
// run back to back never yield to the event loop, so it gets no wall time (measured: after 120 such
// rounds its spawn had not begun). Each round here is paced; the round limits stay as the brief gave them.
const paced = (driver: ExecutionDriver): ExecutionDriver => ({
  round: async () => { await new Promise((resolve) => setTimeout(resolve, 20)); return driver.round(); },
  kick: () => driver.kick(), start: (intervalMs) => driver.start(intervalMs), stop: () => driver.stop(),
  get crashed() { return driver.crashed; },
});

async function twoConflicting(reconcile: { files: Record<string, string>; status?: string; spent?: number; holdMs?: number }, affordable = true) {
  const t = await driverHarness(conflicting, { files });
  await writeFile(t.deps.adapterConfigPath, JSON.stringify({ status: "succeeded", spent: 7, holdMs: 0, ...reconcile }));
  if (affordable) {
    // Deviation D12: by default the group's reserve (20% of base) is smaller than one task's token
    // budget, so a reconciliation is refused until another run settles. Raise the ceiling explicitly.
    const limit = readControlGroup(t.h.store, "epoch-test", "g").ledger.groupLimit;
    const raised = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, tokens: limit.tokens + 10_000_000 } }));
    if ("error" in raised) throw new Error(`set-limit refused: ${JSON.stringify(raised.error)}`);
  }
  const ids = [await t.claim(), await t.claim()];
  const spawns = () => existsSync(`${t.deps.adapterConfigPath}.runs`) ? readFileSync(`${t.deps.adapterConfigPath}.runs`, "utf8").trim().split("\n") : [];
  return { ...t, ids, spawns };
}

// Deviation (Task 6 implementer): the brief's own wait loops alone may take 5 s (100 x 50 ms), the
// vitest default timeout, on top of a two-run harness; the scenarios get room so a slow machine is not a red.
describe("reconciling a conflict (spec §5.3)", { timeout: 30_000 }, () => {
  it("RC1: a separate run resolves the conflict and it lands as a merge of the tip and the run's own attempt", async () => {
    const t = await twoConflicting({ files: { "shared.txt": "A\nB\n" } }); try {
      const driver = paced(t.driver());
      await t.until(driver, () => t.ids.every((id) => [...LANDED, "blocked"].includes(t.body(id).state)), 120);
      const [first, second] = [...t.ids].sort((x, y) => (t.body(x).drive.reconcile === null ? -1 : 1) - (t.body(y).drive.reconcile === null ? -1 : 1));
      expect(t.ids.every((id) => LANDED.includes(t.body(id).state))).toBe(true);
      const reconciled = t.body(second).drive;
      expect(reconciled.reconcile).toMatchObject({ outcome: "succeeded", otherTaskId: t.body(first).taskId });
      expect(git(t.repo, "show", "refs/heads/orca/g:shared.txt")).toBe("A\nB");
      expect(git(t.repo, "rev-parse", `${reconciled.landedCommit}^1`)).toBe(t.body(first).drive.landedCommit);
      expect(git(t.repo, "rev-parse", `${reconciled.landedCommit}^2`)).toBe(reconciled.attemptSha);
      expect(git(t.repo, "log", "-1", "--format=%s", reconciled.landedCommit)).toBe(`orca: land ${second} (reconciled with ${t.body(first).taskId})`);
      expect(t.spawns()).toHaveLength(1);
      expect(git(reconciled.reconcile.copyPath, "rev-parse", `refs/orca/conflict/${second}`)).toBe(reconciled.reconcile.conflictCommit);
      expect(git(t.repo, "for-each-ref", "--format=%(refname)", "refs/orca/conflict/")).toBe("");
    } finally { await t.h.dispose(); }
  });

  it("books the reconciliation's spend on the group once, and the ledger still conserves", async () => {
    const t = await twoConflicting({ files: { "shared.txt": "A\nB\n" }, spent: 7 }); try {
      const driver = paced(t.driver());
      await t.until(driver, () => t.ids.every((id) => [...LANDED, "blocked"].includes(t.body(id).state)), 120);
      await driver.round(); await driver.round();
      // Each synthetic task reports 10 tokens of work; the reconciliation reports 7.
      expect(readWebGroup(t.h.store, "g").used.tokens).toBe(27);
      expect(t.h.store.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE kind='reconcile-usage'").get()!.n).toBe(1);
      expect(() => readControlGroup(t.h.store, "epoch-test", "g")).not.toThrow();
    } finally { await t.h.dispose(); }
  });

  it("blocks the conflict before any reconciliation run when the group cannot afford it", async () => {
    const t = await twoConflicting({ files: { "shared.txt": "A\nB\n" } }, false); try {
      // Both runs are collected in the same round; D is then stepped by hand so that no settle (Task 7)
      // can release the first run's commitment before the second one's affordability check.
      await t.until(t.driver(), () => t.ids.every((id) => t.body(id).state === "collected"));
      const [landed, blocked] = [...t.ids].sort();
      await stepD(t.deps, landed!);
      await stepD(t.deps, blocked!);
      expect(t.body(blocked).drive).toMatchObject({ blockedAt: "D", blockedReason: "reconcile-budget", reconcile: null });
      expect(t.spawns()).toHaveLength(0);
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(t.body(landed).drive.landedCommit);
    } finally { await t.h.dispose(); }
  });

  it("blocks a reconciliation that leaves conflict markers, and orca/<group> keeps only the first landing", async () => {
    const t = await twoConflicting({ files: { "shared.txt": "<<<<<<< ours\nA\n=======\nB\n>>>>>>> theirs\n" } }); try {
      const driver = paced(t.driver());
      await t.until(driver, () => t.ids.some((id) => t.body(id).state === "blocked"), 120);
      const blocked = t.ids.find((id) => t.body(id).state === "blocked")!;
      const landed = t.ids.find((id) => id !== blocked)!;
      expect(t.body(blocked).drive).toMatchObject({ blockedAt: "R", blockedReason: "markers-remaining:shared.txt" });
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(t.body(landed).drive.landedCommit);
    } finally { await t.h.dispose(); }
  });

  it("blocks a conflict that no landed run of the group explains", async () => {
    const t = await driverHarness([{ taskId: "a", targetPaths: ["shared.txt"] }], { files: () => ({ "shared.txt": "A\n" }) }); try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "collected");
      git(t.repo, "checkout", "-q", "orca/g");
      await writeFile(`${t.repo}/shared.txt`, "a person's own\n");
      git(t.repo, "add", "shared.txt");
      git(t.repo, "commit", "-qm", "by hand");
      await t.until(driver, () => t.body(runId).state === "blocked");
      expect(t.body(runId).drive).toMatchObject({ blockedAt: "D", blockedReason: "reconcile-other-side:0" });
    } finally { await t.h.dispose(); }
  });

  it("waits for a reconciliation still running, and collects it once it ends, with one spawn", async () => {
    const t = await twoConflicting({ files: { "shared.txt": "A\nB\n" }, holdMs: 800 }); try {
      const driver = paced(t.driver());
      await t.until(driver, () => t.ids.some((id) => t.body(id).drive?.reconcile?.pid != null), 120);
      await driver.round();
      expect(t.ids.some((id) => t.body(id).state === "reconciling")).toBe(true);
      for (let i = 0; i < 100 && !t.ids.every((id) => LANDED.includes(t.body(id).state)); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        await driver.round();
      }
      expect(t.ids.every((id) => LANDED.includes(t.body(id).state))).toBe(true);
      expect(t.spawns()).toHaveLength(1);
    } finally { await t.h.dispose(); }
  });

  it("after a restart, waits on a recorded live reconciliation process instead of spawning a second one", async () => {
    const t = await twoConflicting({ files: { "shared.txt": "A\nB\n" }, holdMs: 1500 }); try {
      await t.until(paced(t.driver()), () => t.ids.some((id) => t.body(id).drive?.reconcile?.pid != null), 120);
      const restarted = createExecutionDriver(t.deps);
      for (let i = 0; i < 100 && !t.ids.every((id) => LANDED.includes(t.body(id).state)); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        await restarted.round();
      }
      expect(t.ids.every((id) => LANDED.includes(t.body(id).state))).toBe(true);
      expect(t.spawns()).toHaveLength(1);
    } finally { await t.h.dispose(); }
  });

  it("after a restart with a spawn recorded but no process id, blocks instead of running a second reconciliation", async () => {
    const t = await twoConflicting({ files: { "shared.txt": "A\nB\n" } }); try {
      await t.until(t.driver(), () => t.ids.some((id) => t.body(id).state === "reconciling"), 120);
      const runId = t.ids.find((id) => t.body(id).state === "reconciling")!;
      const body = t.body(runId);
      t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({ ...body, drive: { ...body.drive, reconcile: { ...body.drive.reconcile, spawning: true, pid: null } } }), runId);
      await createExecutionDriver(t.deps).round();
      expect(t.body(runId).drive).toMatchObject({ blockedAt: "R", blockedReason: "reconcile-orphan-unknown" });
      expect(t.spawns()).toHaveLength(0);
    } finally { await t.h.dispose(); }
  });
});

describe("what a restarted driver does with a reconciliation it finds (spec §5.3(6), deviation D17)", () => {
  it.each([
    [{ loopStatus: "succeeded", spawning: true, pid: 5, alive: true }, "collect"],
    [{ loopStatus: "exhausted", spawning: true, pid: null, alive: false }, "collect"],
    [{ loopStatus: null, spawning: true, pid: 5, alive: true }, "wait"],
    [{ loopStatus: null, spawning: true, pid: null, alive: false }, "orphan"],
    [{ loopStatus: null, spawning: true, pid: 5, alive: false }, "spawn"],
    [{ loopStatus: "planning", spawning: false, pid: null, alive: false }, "spawn"],
  ] as const)("%o ⇒ %s", (input, action) => {
    expect(reconcileNextAction(input)).toBe(action);
  });
});
