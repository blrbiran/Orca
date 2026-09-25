import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createExecutionDriver, stepE, type ExecutionDriver } from "../../src/control/executionDriver.js";
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
// Deviation (Task 6 implementer; fix round 1, m3): the reconciliation is a background process, so
// its progress is wall-clock time, not rounds (measured: 120 back-to-back rounds passed before its
// spawn had begun). Where a reconciliation must finish, the bound is an honest deadline: rounds 50 ms
// apart for at most 20 s.
async function untilDeadline(driver: ExecutionDriver, predicate: () => boolean, deadlineMs = 20_000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await driver.round();
  }
  if (!predicate()) throw new Error("the driver did not reach the expected state before the deadline");
}

// Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): adapted to the agent selection wire -- the ExecutionPort surface is resolveAgent/listAgents, claims and work items carry a frozen `agent`, envelopes are protocol 2, the reconcile table is `agentsTablePath`; what the criterion encodes is unchanged.
async function twoConflicting(reconcile: { files: Record<string, string>; status?: string; spent?: number; holdMs?: number; refuse?: string }, affordable = true) {
  const t = await driverHarness(conflicting, { files });
  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): adapted to the agent selection wire -- the ExecutionPort surface is resolveAgent/listAgents, claims and work items carry a frozen `agent`, envelopes are protocol 2, the reconcile table is `agentsTablePath`; what the criterion encodes is unchanged.
  await writeFile(t.deps.agentsTablePath, JSON.stringify({ status: "succeeded", spent: 7, holdMs: 0, ...reconcile }));
  if (affordable) {
    // Deviation D12: by default the group's reserve (20% of base) is smaller than one task's token
    // budget, so a reconciliation is refused until another run settles. Raise the ceiling explicitly.
    const limit = readControlGroup(t.h.store, "epoch-test", "g").ledger.groupLimit;
    const raised = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, tokens: limit.tokens + 10_000_000 } }));
    if ("error" in raised) throw new Error(`set-limit refused: ${JSON.stringify(raised.error)}`);
  }
  const ids = [await t.claim(), await t.claim()];
  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): adapted to the agent selection wire -- the ExecutionPort surface is resolveAgent/listAgents, claims and work items carry a frozen `agent`, envelopes are protocol 2, the reconcile table is `agentsTablePath`; what the criterion encodes is unchanged.
  const spawns = () => existsSync(`${t.deps.agentsTablePath}.runs`) ? readFileSync(`${t.deps.agentsTablePath}.runs`, "utf8").trim().split("\n") : [];
  return { ...t, ids, spawns };
}

// Deviation (Task 6 implementer): the brief's own wait loops alone may take 5 s (100 x 50 ms), the
// vitest default timeout, on top of a two-run harness; the scenarios get room so a slow machine is not a red.
describe("reconciling a conflict (spec §5.3)", { timeout: 30_000 }, () => {
  it("RC1: a separate run resolves the conflict and it lands as a merge of the tip and the run's own attempt", async () => {
    const t = await twoConflicting({ files: { "shared.txt": "A\nB\n" } }); try {
      const driver = t.driver();
      await untilDeadline(driver, () => t.ids.every((id) => [...LANDED, "blocked"].includes(t.body(id).state)));
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

  it("spawns the reconciliation as ccloop run --agents <table> --agent-selection <file>, the file 0600 and holding a frozen selection with its configHash (agent selection spec §4.9)", async () => {
    const t = await twoConflicting({ files: { "shared.txt": "A\nB\n" } }); try {
      const driver = t.driver();
      await untilDeadline(driver, () => t.ids.every((id) => [...LANDED, "blocked"].includes(t.body(id).state)));
      expect(t.ids.every((id) => LANDED.includes(t.body(id).state))).toBe(true);
      const reconciled = t.ids.find((id) => t.body(id).drive.reconcile !== null)!;
      const selections = readFileSync(`${t.deps.agentsTablePath}.selections`, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      // Agent selection plan T7 bridge -- T11 leaves it, plan T12 deletes this (plan P9) and asserts the group's frozen
      // reconcile slot instead: until then the reconciliation runs with the conflicted run's own selection and configHash.
      expect(selections).toEqual([{ selection: { selection: t.body(reconciled).agent, configHash: t.body(reconciled).configHash }, mode: 0o600 }]);
      expect(t.body(reconciled).agent).toEqual({ agent: "codex", model: "fixture-model", contextWindow: "agent-default" });
    } finally { await t.h.dispose(); }
  });

  // Plan T6 ruling (agent selection): `ccloop run --agents` exits 1 on any refusal -- a stale configHash, a drifted
  // version -- with the refusal's code first on stderr, and 2 only for a run that completed without succeeding. The
  // reconciliation reads its own exit codes (never the control wire's "2:" rule): a refusal blocks the run under
  // ccloop's code, with no terminal outcome, and is not spawned again.
  it("blocks a reconciliation ccloop run --agents refuses (exit 1) under the code its stderr starts with, and does not spawn it again", async () => {
    const t = await twoConflicting({ files: { "shared.txt": "A\nB\n" }, refuse: "control-config-hash-mismatch: the selection file names another configHash" }); try {
      const driver = t.driver();
      await untilDeadline(driver, () => t.ids.some((id) => t.body(id).state === "blocked"));
      const blocked = t.ids.find((id) => t.body(id).state === "blocked")!;
      expect(t.body(blocked).drive).toMatchObject({ blockedAt: "R", blockedReason: "reconcile-refused:control-config-hash-mismatch", reconcile: { outcome: null } });
      for (let round = 0; round < 5; round += 1) await driver.round();
      expect(t.spawns()).toHaveLength(1);
      expect(t.body(blocked).state).toBe("blocked");
    } finally { await t.h.dispose(); }
  });

  it("books the reconciliation's spend on the group once, and the ledger still conserves", async () => {
    const t = await twoConflicting({ files: { "shared.txt": "A\nB\n" }, spent: 7 }); try {
      const driver = t.driver();
      await untilDeadline(driver, () => t.ids.every((id) => [...LANDED, "blocked"].includes(t.body(id).state)));
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
      const driver = t.driver();
      await untilDeadline(driver, () => t.ids.some((id) => t.body(id).state === "blocked"));
      const blocked = t.ids.find((id) => t.body(id).state === "blocked")!;
      const landed = t.ids.find((id) => id !== blocked)!;
      expect(t.body(blocked).drive).toMatchObject({ blockedAt: "R", blockedReason: "markers-remaining:shared.txt" });
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(t.body(landed).drive.landedCommit);
      // Fix round 1 (I1): the refused reconciliation's spend (7, the fixture default) is booked too.
      expect(readWebGroup(t.h.store, "g").used.tokens).toBe(27);
    } finally { await t.h.dispose(); }
  });

  // Fix round 1 (controller ruling, I1 and m9; spec §5.3(5) over the brief): a reconciliation that
  // ends other than succeeded is blocked by its status, and what it spent is still booked on the group:
  // 10 + 10 for the two tasks' synthetic work, 7 for the reconciliation.
  it("blocks a reconciliation that ended failed, and still books its spend on the group", async () => {
    const t = await twoConflicting({ files: { "shared.txt": "A\nB\n" }, status: "failed", spent: 7 }); try {
      const driver = t.driver();
      await untilDeadline(driver, () => t.ids.some((id) => t.body(id).state === "blocked"));
      const blocked = t.ids.find((id) => t.body(id).state === "blocked")!;
      const landed = t.ids.find((id) => id !== blocked)!;
      expect(t.body(blocked).drive).toMatchObject({ blockedAt: "R", blockedReason: "reconcile-terminal:failed", reconcile: { outcome: "failed" } });
      expect(readWebGroup(t.h.store, "g").used.tokens).toBe(27);
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(t.body(landed).drive.landedCommit);
      expect(t.spawns()).toHaveLength(1);
    } finally { await t.h.dispose(); }
  });

  // Fix round 1 (m9): spec §5.3(6) checks affordability again before every spawn, not only at D.
  it("blocks at R, before spawning, a reconciliation the group can no longer afford", async () => {
    const t = await twoConflicting({ files: { "shared.txt": "A\nB\n" } }); try {
      await t.until(t.driver(), () => t.ids.some((id) => t.body(id).state === "reconciling"), 120);
      const runId = t.ids.find((id) => t.body(id).state === "reconciling")!;
      expect(t.body(runId).drive.reconcile).toMatchObject({ spawning: false, pid: null });
      // The landed run is settled first (Task 7's E, called directly so R is not stepped), so no release
      // of its commitment can reopen the reserve; then the ceiling is set at what is occupied: no reserve.
      const other = t.ids.find((id) => id !== runId)!;
      // What stepE throws after the settle is its own projection work, which the driver logs for a settled
      // run (ruling P7); here only the settle matters, and it is asserted.
      await stepE(t.deps, other).catch(() => undefined);
      expect(t.body(other).state).toBe("settled");
      const { groupLimit: limit, used, committedRemaining } = readControlGroup(t.h.store, "epoch-test", "g").ledger;
      const lowered = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, tokens: used.tokens + committedRemaining.tokens } }));
      if ("error" in lowered) throw new Error(`set-limit refused: ${JSON.stringify(lowered.error)}`);
      await createExecutionDriver(t.deps).round();
      expect(t.body(runId).drive).toMatchObject({ blockedAt: "R", blockedReason: "reconcile-budget", reconcile: { spawning: false, pid: null } });
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
      const driver = t.driver();
      await untilDeadline(driver, () => t.ids.some((id) => t.body(id).drive?.reconcile?.pid != null));
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
      await untilDeadline(t.driver(), () => t.ids.some((id) => t.body(id).drive?.reconcile?.pid != null));
      const restarted = createExecutionDriver(t.deps);
      for (let i = 0; i < 100 && !t.ids.every((id) => LANDED.includes(t.body(id).state)); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        await restarted.round();
      }
      expect(t.ids.every((id) => LANDED.includes(t.body(id).state))).toBe(true);
      expect(t.spawns()).toHaveLength(1);
    } finally { await t.h.dispose(); }
  });

  // Final review I3 (controller ruling, 2026-09-25): spec §4's premise -- a driver run's work is a process of
  // its own that outlives the panel -- holds for the reconciliation too. It is spawned detached (its own process
  // group, so a terminal's Ctrl-C to the panel's group does not reach it) with its output in files, not pipes
  // that close with the panel; a stopped driver's successor waits on it and never spawns a second one.
  it("spawns the reconciliation as its own process group with its output in files, and a new driver after stop() finishes it with one spawn", async () => {
    const t = await twoConflicting({ files: { "shared.txt": "A\nB\n" }, holdMs: 1500 }); try {
      const first = t.driver();
      await untilDeadline(first, () => t.ids.some((id) => t.body(id).drive?.reconcile?.pid != null));
      const runId = t.ids.find((id) => t.body(id).drive?.reconcile?.pid != null)!;
      const { pid, runsDir, reconcileRunId } = t.body(runId).drive.reconcile;
      expect(Number(execFileSync("ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf8" }).trim())).toBe(pid);
      for (const name of ["ccloop.stdout.log", "ccloop.stderr.log"]) {
        expect(statSync(join(runsDir, reconcileRunId, name)).mode & 0o777).toBe(0o600);
      }
      await first.stop();
      const second = createExecutionDriver(t.deps);
      await untilDeadline(second, () => t.ids.every((id) => LANDED.includes(t.body(id).state)));
      expect(t.body(runId).drive.reconcile).toMatchObject({ pid, outcome: "succeeded" });
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

// Final review I2 (controller ruling, 2026-09-25): a reconciled merge whose swap fails with the tip unmoved is
// blocked at R with git's error; only a moved tip goes back to D, where it would conflict and pay again.
describe("a reconciliation whose landing swap fails without the tip moving (final review I2)", { timeout: 30_000 }, () => {
  it("blocks at R naming the leftover lock, and spawns no second reconciliation", async () => {
    const t = await twoConflicting({ files: { "shared.txt": "A\nB\n" }, holdMs: 800 }); try {
      const driver = t.driver();
      await untilDeadline(driver, () => t.ids.some((id) => t.body(id).state === "reconciling"));
      const runId = t.ids.find((id) => t.body(id).state === "reconciling")!;
      const tip = git(t.repo, "rev-parse", "refs/heads/orca/g");
      writeFileSync(`${t.repo}/.git/refs/heads/orca/g.lock`, `${tip}\n`);
      await untilDeadline(driver, () => t.body(runId).state === "blocked");
      expect(t.body(runId).drive.blockedAt).toBe("R");
      expect(t.body(runId).drive.blockedReason).toMatch(/^cas-failed:refs\/heads\/orca\/g: .*g\.lock/);
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(tip);
      expect(t.spawns()).toHaveLength(1);
    } finally { await t.h.dispose(); }
  });
});

// Final review I4 (controller ruling, 2026-09-25): spec §2.3's only manual remedy, a run-scope recovery-retry, has
// to act on a run blocked at R. When the reconciliation it holds was already collected and refused (failed, or
// markers left), the retry discards that terminal state and runs it again. Each spawn is booked under its own
// persisted sequence number, so a retry never books a spawn twice and a new spawn is always booked.
describe("a person's retry of a run blocked at R (final review I4)", { timeout: 30_000 }, () => {
  const bookings = (t: { h: { store: { db: { prepare(sql: string): { all(): unknown[] } } } } }) =>
    (t.h.store.db.prepare("SELECT body FROM outbox WHERE kind='reconcile-usage' ORDER BY id").all() as Array<{ body: string }>).map((row) => JSON.parse(row.body).spawnKey);

  it("re-runs a failed reconciliation: two spawns, two distinct bookings, never three", async () => {
    const t = await twoConflicting({ files: { "shared.txt": "A\nB\n" }, status: "failed", spent: 7 }); try {
      const driver = t.driver();
      await untilDeadline(driver, () => t.ids.some((id) => t.body(id).state === "blocked"));
      const runId = t.ids.find((id) => t.body(id).state === "blocked")!;
      expect(t.body(runId).drive.blockedReason).toBe("reconcile-terminal:failed");
      expect(bookings(t)).toHaveLength(1);
      // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): adapted to the agent selection wire -- the ExecutionPort surface is resolveAgent/listAgents, claims and work items carry a frozen `agent`, envelopes are protocol 2, the reconcile table is `agentsTablePath`; what the criterion encodes is unchanged.
      await writeFile(t.deps.agentsTablePath, JSON.stringify({ status: "succeeded", spent: 7, holdMs: 0, files: { "shared.txt": "A\nB\n" } }));
      const retried = await t.service.recoveryRetry(t.h.runCommand("recovery-retry", runId, { scope: "run", runId }));
      expect(retried).toMatchObject({ result: { kind: "recovery-observed", resolved: true } });
      await untilDeadline(driver, () => t.ids.every((id) => LANDED.includes(t.body(id).state)));
      await driver.round(); await driver.round();
      expect(t.spawns()).toHaveLength(2);
      expect(t.body(runId).drive.reconcile).toMatchObject({ outcome: "succeeded" });
      expect(git(t.repo, "show", "refs/heads/orca/g:shared.txt")).toBe("A\nB");
      const keys = bookings(t);
      expect(keys).toHaveLength(2);
      expect(new Set(keys).size).toBe(2);
      // 10 + 10 for the two tasks, 7 for each of the two reconciliations.
      expect(readWebGroup(t.h.store, "g").used.tokens).toBe(34);
    } finally { await t.h.dispose(); }
  });

  it("retries a collected reconciliation whose landing failed without running it again or booking it twice", async () => {
    const t = await twoConflicting({ files: { "shared.txt": "A\nB\n" }, holdMs: 800 }); try {
      const driver = t.driver();
      await untilDeadline(driver, () => t.ids.some((id) => t.body(id).state === "reconciling"));
      const runId = t.ids.find((id) => t.body(id).state === "reconciling")!;
      const lock = `${t.repo}/.git/refs/heads/orca/g.lock`;
      writeFileSync(lock, `${git(t.repo, "rev-parse", "refs/heads/orca/g")}\n`);
      await untilDeadline(driver, () => t.body(runId).state === "blocked");
      expect(t.body(runId).drive.blockedAt).toBe("R");
      rmSync(lock);
      const retried = await t.service.recoveryRetry(t.h.runCommand("recovery-retry", runId, { scope: "run", runId }));
      expect(retried).toMatchObject({ result: { kind: "recovery-observed", resolved: true } });
      await untilDeadline(driver, () => LANDED.includes(t.body(runId).state));
      await driver.round(); await driver.round();
      expect(t.spawns()).toHaveLength(1);
      expect(bookings(t)).toHaveLength(1);
      expect(readWebGroup(t.h.store, "g").used.tokens).toBe(27);
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

// Final review I4: a terminal loop state already collected and refused is run again once the process is gone.
describe("what the driver does with a reconciliation already collected and refused (final review I4)", () => {
  it.each([
    [{ loopStatus: "failed", spawning: false, pid: null, alive: false, collected: true }, "spawn"],
    [{ loopStatus: "succeeded", spawning: false, pid: 5, alive: false, collected: true }, "spawn"],
    [{ loopStatus: "failed", spawning: true, pid: 5, alive: true, collected: true }, "wait"],
    [{ loopStatus: "failed", spawning: false, pid: null, alive: false, collected: false }, "collect"],
  ] as const)("%o ⇒ %s", (input, action) => {
    expect(reconcileNextAction(input)).toBe(action);
  });
});
