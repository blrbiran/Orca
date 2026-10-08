import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DriverCrash } from "../../src/control/executionDriver.js";
import type { ControlRuntime } from "../../src/panel/controlAssembly.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { taskRunNumber } from "../../web/src/runFacts.js";
import { ccloopWorlds, g, noBlocked, raw, realBinary, startGroup, until, workRuns } from "./fixtures/ccloopWorld.js";

/**
 * Execution driver spec §7.2 E1, E2, W1, T1 and R1 against the real ccloop build (ORCA_CCLOOP_BIN, which
 * must contain ccloop changes C1-C3) and its scripted fake codex. Everything is relocated under a
 * temporary root. The honest claim these support (deviation D1): with fake codex, a soft group, and an
 * estimator whose estimate is blocked-capability because contextWindowTokens is null, Web dispatch runs
 * from confirm to settle and lands on orca/<groupId>. Not "Web dispatch works".
 *
 * The world, its boot/die/teardown and the command helpers live in fixtures/ccloopWorld.ts (moved there
 * unchanged for handoffE2E.test.ts, handoff delivery preflight I11).
 */
const { world, removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "orca-driver-e2e-", epochPrefix: "epoch-e2e-" });
// Retried: every scenario shuts its runtime down in a finally, but a shutdown does not wait for a
// background reconciliation `ccloop run` (the Task 6 deferral), so after a failed E1 that child can
// still be writing under the root when this runs. A passing scenario leaves no child behind.
afterAll(removeRoots);

const workStatus = (runtime: ControlRuntime, taskId: string): string =>
  JSON.parse(String(runtime.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body)).status;

describe.skipIf(!realBinary)("the execution driver against real ccloop (spec §7.2)", { timeout: 420_000 }, () => {
  relocateHome("orca-driver-e2e-home-");

  it("E1: three tasks, two in conflict and one dependent, from confirm to settle on orca/<group>, spending no more than planned", async () => {
    const w = await world([
      { taskId: "a", targetPaths: ["shared.txt"] }, { taskId: "b", targetPaths: ["shared.txt"] },
      // Fix round 1 (controller ruling): the production-common command verifier goes through to settle.
      { taskId: "c", dependsOn: ["a"], targetPaths: ["c.txt"], verifierType: "command" },
    ], {
      a: { files: { "shared.txt": "A\n" } }, b: { files: { "shared.txt": "B\n" } }, c: { files: { "c.txt": "C\n" } },
      "reconcile-a-b": { files: { "shared.txt": "A\nB\n" } }, "reconcile-b-a": { files: { "shared.txt": "A\nB\n" } },
    });
    const before = w.human();
    const runtime = await w.boot(); try {
      // Deviation D12: the default reserve cannot afford a reconciliation until another run settles.
      await startGroup(runtime, w.repoId, 10_000_000);
      runtime.startPump(50);
      await until(() => { noBlocked(runtime); return ["a", "b", "c"].every((id) => workStatus(runtime, id) === "done") && workRuns(runtime).every((run) => run.body.drive?.cleanedUp === true); }, 360_000, "every task to settle");
      const runs = workRuns(runtime);
      expect(runs.map((run) => run.body.state)).toEqual(["settled", "settled", "settled"]);
      expect(readControlGroup(runtime.store, runtime.epoch, "g").runs.map((run) => run.state)).toEqual(["settled-recoverable", "settled-recoverable", "settled-recoverable"]);
      expect(g(w.repo, "show", "refs/heads/orca/g:shared.txt")).toBe("A\nB");
      expect(g(w.repo, "show", "refs/heads/orca/g:c.txt")).toBe("C");
      const reconciled = runs.filter((run) => run.body.drive.reconcile !== null);
      expect(reconciled).toHaveLength(1);
      // Spec §3.5: a settled, landed run's own workspace is removed; everything else is kept as the scene.
      // What is left is exactly the reconciled run's conflict copy and its reconciliation runs directory
      // (the synthesized contract and ccloop's loop state), and no worktree but the person's.
      const reconciledId = reconciled[0]!.runId;
      expect(readdirSync(`${runtime.store.stateDir}.workspaces`).sort()).toEqual([`conflict-${reconciledId}`, `reconcile-${reconciledId}`]);
      expect(w.worktrees()).toEqual([`worktree ${w.repo}`]);
      expect(g(w.repo, "log", "-1", "--format=%s", reconciled[0]!.body.drive.landedCommit)).toMatch(/^orca: land run-.* \(reconciled with [ab]\)$/);
      const a = runs.find((run) => run.task === "a")!, c = runs.find((run) => run.task === "c")!;
      expect(() => g(w.repo, "merge-base", "--is-ancestor", a.body.drive.landedCommit, c.body.drive.base)).not.toThrow();
      // Four ccloop runs (three tasks, one reconciliation), each planning and executing once. Only a and b
      // have an agent verifier, which calls the provider once each; c's command verifier and the
      // synthesized reconciliation contract's (src/scheduler/reconcile.ts) call none. 4 + 4 + 2 = 10.
      const phases = w.calls();
      expect(phases).toHaveLength(10);
      expect(["plan", "execute", "verify"].map((phase) => phases.filter((call) => call === phase).length)).toEqual([4, 4, 2]);
      expect(w.human()).toEqual(before);
      // Accounts spec §5.1 (Task 7): the pinned ccloop states no byModel, so every applied delta is one unattributed row,
      // and the ledger adds up to exactly what the group used.
      // CORRECTION (accounts plan Task 12, 2026-10-08): the re-pin to ccloop c82b212 brings Part B, so the pinned ccloop
      // now states byModel and every applied delta is a `reported` row naming the run's model; the sentence above was true
      // of the old pin (c3af4d6) only. The per-model wire itself is pinned by usageByModelE2E.test.ts. The one exception is
      // the reconciliation's own `ccloop run`: recordReconcileUsage books its tokens as one unattributed run-work row on the
      // reconciled run (accounts Task 7 ruling: v8 has no `reconcile` source), so that row is pinned by name.
      const ledger = runtime.store.db.prepare("SELECT run_id,source,model,tokens,quality FROM usage_ledger WHERE group_id='g'").all();
      expect(ledger.length).toBeGreaterThan(0);
      const unattributed = ledger.filter((row) => row.quality === "unattributed");
      expect(unattributed.map((row) => ({ run_id: row.run_id, source: row.source, model: row.model }))).toEqual([{ run_id: reconciledId, source: "run-work", model: null }]);
      expect(ledger.filter((row) => !unattributed.includes(row) && (row.model === null || row.quality !== "reported" || !["run-work", "run-handoff"].includes(String(row.source))))).toEqual([]);
      const usedTokens = Number(runtime.store.db.prepare("SELECT json_extract(body,'$.used.tokens') AS tokens FROM groups WHERE id='g'").get()!.tokens);
      expect(ledger.reduce((sum, row) => sum + Number(row.tokens), 0)).toBe(usedTokens);
      // Controller ruling (Task 7): a real settle publishes -- each run's projection and task handoff,
      // and every group handoff, reach delivered=1, with no publish failure left on any run.
      const delivered = (id: string): unknown => runtime.store.db.prepare("SELECT delivered FROM outbox WHERE id=?").get(id);
      for (const run of runs) {
        expect(run.body.drive.publishError).toBe(null);
        expect(delivered(`projection:${run.body.checkpointId}`)).toEqual({ delivered: 1 });
        expect(delivered(`task-handoff:g:${run.task}:${run.body.checkpointId}`)).toEqual({ delivered: 1 });
      }
      const groupHandoffs = runtime.store.db.prepare("SELECT delivered FROM outbox WHERE kind='group-handoff'").all().map((row) => Number(row.delivered));
      expect(groupHandoffs.length).toBeGreaterThan(0);
      expect(groupHandoffs.every((value) => value === 1)).toBe(true);
      expect(runtime.store.dispatchBlocked).toBe(false);
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });

  it.each(["worktree", "clone"] as const)("E2/W1: in %s mode the run's workspace exists while it runs and is gone once it settles", async (mode) => {
    const w = await world([{ taskId: "a", targetPaths: ["shared.txt"] }], { a: { files: { "shared.txt": "A\n" } } });
    const runtime = await w.boot(); try {
      if (mode === "clone") {
        const set = await runtime.service.setWorkspaceMode(raw(runtime, "mode", "set-workspace-mode", { workspaceMode: "clone" }, { kind: "repository", repoId: w.repoId }));
        expect(set).toMatchObject({ result: { kind: "workspace-mode-set", workspaceMode: "clone" } });
      }
      await startGroup(runtime, w.repoId);
      runtime.startPump(50);
      let seen = false;
      await until(() => {
        noBlocked(runtime);
        const run = workRuns(runtime)[0];
        const drive = run?.body.drive;
        if (drive?.prepared === true && run!.body.state !== "settled") {
          expect(drive.workspaceMode).toBe(mode);
          if (mode === "worktree") expect(g(w.repo, "worktree", "list", "--porcelain").split("\n")).toContain(`worktree ${drive.workspacePath}`);
          else expect(statSync(join(drive.workspacePath, ".git")).isDirectory()).toBe(true);
          seen = true;
        }
        return seen && drive?.cleanedUp === true;
      }, 240_000, "the run to settle", 20);
      const drive = workRuns(runtime)[0]!.body.drive;
      expect(existsSync(drive.workspacePath)).toBe(false);
      expect(w.worktrees()).toEqual([`worktree ${w.repo}`]);
      // The clean one-task run's end state, which R1 compares against: one landing on orca/g.
      expect(w.landings()).toBe(1);
      expect(readdirSync(`${runtime.store.stateDir}.workspaces`)).toEqual([]);
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });

  it("T1: a run whose checks fail ends blocked by its terminal, and orca/<group> does not move", async () => {
    const w = await world([{ taskId: "a", targetPaths: ["shared.txt"], requiredChecks: ["false"], verifierType: "command" }], { a: { files: { "shared.txt": "A\n" } } });
    const runtime = await w.boot(); try {
      await startGroup(runtime, w.repoId);
      runtime.startPump(50);
      await until(() => workRuns(runtime)[0]?.body.state === "blocked", 240_000, "the run to block");
      const drive = workRuns(runtime)[0]!.body.drive;
      expect(drive.blockedAt).toBe("C");
      expect(drive.blockedReason).toMatch(/^terminal:(failed|exhausted|blocked_waiting_human|cancelled)$/);
      expect(g(w.repo, "rev-parse", "refs/heads/orca/g")).toBe(g(w.repo, "rev-parse", "main"));
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });

  // Issue fixes spec §4.4 (issue 16): a run ccloop ended failed keeps ccloop's reason; retry-task settles it, the group
  // view reads at once, and the pump and driver run the task again from the group branch. Part D ruling 8: against the
  // real binary only "not succeeded" and "a reason string" are asserted; the exact codex-result-invalid reason is pinned
  // on the synthetic port.
  // Deviation from the D9 brief (measured, D9 report): the brief failed run 1 by giving fake codex no script entry, so it
  // exits 3 at execute. Real ccloop then books that phase's usage as null, the run carries unknown work usage, and
  // retry-task refuses it (task-not-retryable:usage-unknown, spec §4.2(2)); the group's usageUnknown also stops dispatch
  // (webDispatch.ts), so run 2 could never be claimed. Run 1 here fails in a way whose usage is known instead: the task's
  // command check passes only once a flag file outside the workspace exists, and the test creates it before retrying.
  it("R-F: retry-task after a ccloop failure settles the run as settled-failed, and run 2 lands", async () => {
    const flagDir = await mkdtemp(join(tmpdir(), "orca-retry-flag-"));
    const flag = join(flagDir, "pass");
    const w = await world([{ taskId: "a", targetPaths: ["a.txt"], requiredChecks: [`test -e ${flag}`], verifierType: "command" }], { a: { files: { "a.txt": "A\n" } } });
    const runtime = await w.boot(); try {
      await startGroup(runtime, w.repoId, 1_000_000);
      runtime.startPump(50);
      await until(() => workRuns(runtime)[0]?.body.state === "blocked", 240_000, "the first run to fail");
      const first = workRuns(runtime)[0]!;
      expect(first.body.drive.blockedAt).toBe("C");
      expect(first.body.drive.outcome).not.toBe("succeeded");
      expect(typeof first.body.drive.stopReason).toBe("string");
      expect(readControlGroup(runtime.store, runtime.epoch, "g").runs[0]).toMatchObject({ state: "blocked", stopReason: first.body.drive.stopReason, outcome: first.body.drive.outcome });
      await writeFile(flag, "");
      const retried = runtime.service.retryTask(raw(runtime, "retry", "retry-task", { taskId: "a" }));
      expect("error" in retried ? retried.error : retried.result).toEqual({ kind: "task-retried", taskId: "a", fromRunId: first.runId });
      expect(readControlGroup(runtime.store, runtime.epoch, "g").runs.map((run) => run.state)).toEqual(["settled-failed"]);
      await until(() => workStatus(runtime, "a") === "done" && workRuns(runtime).every((run) => run.body.drive?.cleanedUp === true), 240_000, "run 2 to land and both runs to be cleaned");
      const second = workRuns(runtime).find((run) => run.runId !== first.runId)!;
      expect(new Map(workRuns(runtime).map((run) => [run.runId, run.body.state]))).toEqual(new Map([[first.runId, "settled-failed"], [second.runId, "settled"]]));
      expect(taskRunNumber(readControlGroup(runtime.store, runtime.epoch, "g"), "a")).toBe(2);
      expect(w.show("a.txt")).toBe("A");
      expect(readdirSync(`${runtime.store.stateDir}.workspaces`)).toEqual([]);
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); await rm(flagDir, { recursive: true, force: true }); }
  });

  it.each(["A2-after-workspace", "B-after-accept", "C-after-terminal", "D-after-cas", "E-after-acceptance"] as const)(
    "R1 %s: a death between an external action and its record ends where a clean run ends, spending no more", async (point) => {
      const w = await world([{ taskId: "a", targetPaths: ["shared.txt"] }], { a: { files: { "shared.txt": "A\n" } } });
      const before = w.human();
      try {
        const first = await w.boot((at) => { if (at === point) throw new DriverCrash(at); });
        await startGroup(first, w.repoId);
        first.startPump(50);
        await until(() => first.driver?.crashed === point, 240_000, `the crash at ${point}`);
        w.die(first);
        const second = await w.boot();
        expect(second.store.dispatchBlocked).toBe(false);
        second.startPump(50);
        await until(() => { noBlocked(second); return workStatus(second, "a") === "done" && workRuns(second)[0]?.body.drive?.cleanedUp === true; }, 240_000, "the run to settle after the restart");
        expect(w.calls()).toEqual(["plan", "execute", "verify"]);
        expect(readdirSync(`${second.store.stateDir}.runs`)).toHaveLength(1);
        expect(g(w.repo, "show", "refs/heads/orca/g:shared.txt")).toBe("A");
        // Measured independently of the driver's own cleanedUp flag: the end state E2's clean run ends in --
        // one landing (a D-after-cas replay that landed twice would show two), no worktree but the
        // person's, an empty workspaces root, and the person's checkout untouched.
        expect(w.landings()).toBe(1);
        expect(w.worktrees()).toEqual([`worktree ${w.repo}`]);
        expect(readdirSync(`${second.store.stateDir}.workspaces`)).toEqual([]);
        expect(w.human()).toEqual(before);
        expect(second.store.dispatchBlocked).toBe(false);
        expect(await second.shutdown()).toBe(true);
      } finally { await w.teardown(); }
    });
});
