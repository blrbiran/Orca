import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readArtifact } from "../../src/control/archive.js";
import { deliverSchedulerWakes } from "../../src/control/dispatch.js";
import { createExecutionDriver, DriverCrash } from "../../src/control/executionDriver.js";
import { createWebWakeHandlers } from "../../src/control/webDispatch.js";
import { readWebGroup } from "../../src/control/webService.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";

// Execution driver spec §2.2 E and §2.1 (CR1): a landed run settles through the ledger's own
// checkpoint path, its workspace is cleaned, and the group keeps going without another start command.

describe("E: settle a landed run (spec §2.2, deviation D2)", () => {
  it("persists settled with the work done, acceptance naming the landing, and every ledger view still reading", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "landed");
      const before = readWebGroup(t.h.store, "g").ledger.committedRemaining.tokens;
      const remaining = t.body(runId).remaining;
      await t.until(driver, () => t.body(runId).drive?.cleanedUp === true);
      const run = t.body(runId);
      expect(run).toMatchObject({ state: "settled", recoverable: true });
      expect(t.h.store.db.prepare("SELECT active FROM runs WHERE id=?").get(runId)).toEqual({ active: 0 });
      expect(JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body)).status).toBe("done");
      const view = readControlGroup(t.h.store, "epoch-test", "g");
      expect(view.runs.find((entry) => entry.runId === runId)!.state).toBe("settled-recoverable");
      expect(view.workItems.find((entry) => entry.taskId === "a")!.status).toBe("completed");
      expect(readWebGroup(t.h.store, "g").ledger.committedRemaining.tokens).toBe(before - remaining.work.tokens - remaining.handoff.tokens);
      const acceptance = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM outbox WHERE id=? AND kind='acceptance'").get(`acceptance:${runId}`)!.body));
      expect(JSON.parse((await readArtifact(t.h.store, acceptance.source)).toString())).toMatchObject({ runId, checksPassed: true, landing: "landed", commit: run.drive.landedCommit });
      // Fix round 1 (review Important 2): "then the projection" is only true if publication actually
      // ran -- these are the exact rows `commitCandidate` (checkpoints.ts) queues for this settle.
      expect(t.h.store.db.prepare("SELECT delivered FROM outbox WHERE id=?").get(`projection:${run.checkpointId}`)).toEqual({ delivered: 1 });
      expect(t.h.store.db.prepare("SELECT delivered FROM outbox WHERE id=?").get(`task-handoff:g:a:${run.checkpointId}`)).toEqual({ delivered: 1 });
      expect(t.h.store.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE kind='group-handoff' AND delivered=0").get()).toEqual({ n: 0 });
    } finally { await t.h.dispose(); }
  });

  it("cleans only the run's own workspace and incoming ref, keeps its source directory, and never touches orca/<group>", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).drive?.cleanedUp === true);
      const drive = t.body(runId).drive;
      expect(existsSync(drive.workspacePath)).toBe(false);
      expect(git(t.repo, "worktree", "list", "--porcelain").split("\n")).not.toContain(`worktree ${drive.workspacePath}`);
      expect(git(t.repo, "for-each-ref", "--format=%(refname)", "refs/orca/")).toBe("");
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(drive.landedCommit);
      expect(existsSync(drive.sourceDir)).toBe(true);
    } finally { await t.h.dispose(); }
  });

  it("settles an empty result without acceptance, so its work is blocked (deviation D14)", async () => {
    const t = await driverHarness([{ taskId: "a" }], { files: () => ({}) }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).drive?.cleanedUp === true);
      expect(t.body(runId).state).toBe("settled");
      expect(t.h.store.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE kind='acceptance'").get()!.n).toBe(0);
      expect(JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body)).status).toBe("blocked");
    } finally { await t.h.dispose(); }
  });

  it("commits the checkpoint exactly once across a death after the acceptance", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      const crashing = createExecutionDriver({ ...t.deps, crash: (point) => { if (point === "E-after-acceptance") throw new DriverCrash(point); } });
      await t.until(crashing, () => crashing.crashed !== null);
      expect(t.body(runId).state).toBe("landed");
      await t.until(t.driver(), () => t.body(runId).drive?.cleanedUp === true);
      expect(t.h.store.db.prepare("SELECT COUNT(*) AS n FROM checkpoints WHERE run_id=?").get(runId)).toEqual({ n: 1 });
      expect(t.h.store.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE kind='acceptance'").get()).toEqual({ n: 1 });
    } finally { await t.h.dispose(); }
  });

  it("R2b: an independent run settles while its sibling is blocked at B'", async () => {
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }], { behaviour: (id) => (id === "a" ? "unknown" : "succeed") }); try {
      const a = await t.claim();
      const b = await t.claim();
      await t.until(t.driver(), () => t.body(a).state === "blocked" && t.body(b).drive?.cleanedUp === true);
      expect(t.body(a).drive.blockedReason).toBe("inspect-unknown");
      expect(t.body(b).state).toBe("settled");
      expect(t.fake.calls.inspect).toBe(10);
    } finally { await t.h.dispose(); }
  });
});

describe("P7 (controller ruling 2026-09-25): a cleanup failure never blocks a settled run", () => {
  it("keeps the run settled with cleanedUp:false and cleanupError recorded, then finishes cleanup once the fault clears", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      let fail = true;
      // Faults only the resolveRepository call `stepE`'s cleanup makes after the run is already
      // `settled` in the store -- A2, D and R call the same deps.resolveRepository while the run is
      // still in an earlier state, so this leaves the run's path to `landed`/`settled` untouched.
      const faultyDeps = {
        ...t.deps,
        resolveRepository: (repoId: string) => {
          if (fail && t.body(runId).state === "settled") throw new Error("workspace-unreachable");
          return t.deps.resolveRepository(repoId);
        },
      };
      const driver = createExecutionDriver(faultyDeps);
      // Waits for the fault's own error to land on the run, not just for `settled` -- the per-run
      // error handler overwrites `cleanupError` with whatever the most recent attempt hit, and settle
      // and cleanup can both land within the same round once publication succeeds on its own first try.
      await t.until(driver, () => {
        const drive = t.body(runId).drive;
        return t.body(runId).state === "settled" && typeof drive?.cleanupError === "string" && drive.cleanupError.includes("workspace-unreachable");
      });
      const failed = t.body(runId);
      expect(failed.state).toBe("settled");
      expect(failed.drive.cleanedUp).toBe(false);
      fail = false;
      await t.until(driver, () => t.body(runId).drive?.cleanedUp === true);
      const recovered = t.body(runId);
      expect(recovered.state).toBe("settled");
      expect(recovered.drive.cleanupError).toBe(null);
    } finally { await t.h.dispose(); }
  });
});

describe("fix round 1 (review Important 1/2): a publish failure after settle is its own field", () => {
  it("records publishError separately from cleanupError, survives a successful cleanup, and clears only once publishing succeeds", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      // A poison outbox row inserted before this run's own: `publishPending`'s drain (projection.ts)
      // processes every undelivered `projection`/`task-handoff`/`group-handoff` row in one pass, in
      // rowid order, and a throw on one row aborts the whole pass -- exactly what a broken handoff
      // packet or an IO fault would do, exercised here without touching the (now-fixed) fake port.
      t.h.store.db.prepare("INSERT INTO outbox(id,kind,body,delivered) VALUES ('task-handoff:poison','task-handoff',?,0)")
        .run(JSON.stringify({ groupId: "g", taskId: "does-not-exist" }));
      const driver = t.driver();
      await t.until(driver, () => {
        const drive = t.body(runId).drive;
        return t.body(runId).state === "settled" && typeof drive?.publishError === "string";
      });
      const failed = t.body(runId);
      expect(failed.state).toBe("settled");
      expect(failed.drive.publishError).toContain("task-checkpoint-not-committed");
      // Cleanup does not wait on publication, and a successful cleanup must not erase publishError.
      await t.until(driver, () => t.body(runId).drive?.cleanedUp === true);
      expect(t.body(runId).state).toBe("settled");
      expect(t.body(runId).drive.publishError).not.toBe(null);
      expect(t.body(runId).drive.cleanupError).toBe(null);
      t.h.store.db.prepare("DELETE FROM outbox WHERE id='task-handoff:poison'").run();
      await t.until(driver, () => t.body(runId).drive?.publishError === null);
      const recovered = t.body(runId);
      expect(recovered.state).toBe("settled");
      expect(recovered.drive.cleanedUp).toBe(true);
      expect(t.h.store.db.prepare("SELECT delivered FROM outbox WHERE id=?").get(`projection:${recovered.checkpointId}`)).toEqual({ delivered: 1 });
      expect(t.h.store.db.prepare("SELECT delivered FROM outbox WHERE id=?").get(`task-handoff:g:a:${recovered.checkpointId}`)).toEqual({ delivered: 1 });
    } finally { await t.h.dispose(); }
  });
});

describe("CR1: the group keeps going after one start command (spec §2.1)", () => {
  // Up to 200 rounds of real git subprocesses; comfortably under 5s alone, but this repo runs test
  // files in parallel, and under that contention it can cross the default vitest timeout.
  it("runs independent tasks side by side and a dependent task on top of its dependency", async () => {
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }, { taskId: "c", dependsOn: ["a"] }]); try {
      await t.claim();
      const driver = t.driver();
      const { start } = createWebWakeHandlers({ ...t.dispatch, service: t.service });
      const workStatus = (id: string) => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(id)!.body)).status;
      const runOf = (task: string) => t.h.store.db.prepare("SELECT id FROM runs WHERE group_id='g' AND work_item_id=?").get(task);
      let sideBySide = false;
      for (let i = 0; i < 200 && !["a", "b", "c"].every((id) => workStatus(id) === "done"); i += 1) {
        await deliverSchedulerWakes(t.h.store, { start });
        await driver.round();
        const a = runOf("a"), b = runOf("b");
        if (a && b && t.body(String(a.id)).state !== "settled" && t.body(String(b.id)).state !== "settled") sideBySide = true;
      }
      expect(["a", "b", "c"].map(workStatus)).toEqual(["done", "done", "done"]);
      expect(sideBySide).toBe(true);
      const aLanded = t.body(String(runOf("a")!.id)).drive.landedCommit;
      const cBase = t.body(String(runOf("c")!.id)).drive.base;
      expect(() => git(t.repo, "merge-base", "--is-ancestor", aLanded, cBase)).not.toThrow();
      expect(git(t.repo, "show", "refs/heads/orca/g:c")).toBe("c");
      expect(Number(t.h.store.db.prepare("SELECT COUNT(*) AS n FROM scheduler_wakes WHERE id LIKE 'drive:g:%'").get()!.n)).toBeGreaterThanOrEqual(2);
    } finally { await t.h.dispose(); }
  }, 30000);

  it("arms nothing for a group nobody started", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      await t.driver().round();
      expect(t.h.store.db.prepare("SELECT COUNT(*) AS n FROM scheduler_wakes WHERE kind='start'").get()).toEqual({ n: 0 });
    } finally { await t.h.dispose(); }
  });
});
