import { describe, expect, it } from "vitest";
import { readRunActivity } from "../../src/control/activity.js";
import { withCommandContext } from "../../src/control/commandClient.js";
import { isTerminallyFailedRun } from "../../src/control/driveRecord.js";
import { readBudgetProposal, readGroup, readWork } from "../../src/control/queries.js";
import { validTerminalClosure } from "../../src/control/terminalRunClosure.js";
import { readControlRecovery } from "../../src/panel/controlViews.js";
import { driverHarness } from "./fixtures/driverHarness.js";

/** Deleting the terminal-closure scan must leave the failed run active and make these criteria RED. */
describe("terminal run closure (#169)", () => {
  it.each(["failed", "exhausted"] as const)("closes a proved %s run without accepting its work, so its paused group can archive", async (outcome) => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => outcome, sealedOwnerProof: true });
    try {
      const runId = await t.claim(), driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "blocked");
      expect(readControlRecovery(t.h.store, "epoch-test").terminalRuns).toEqual([{ groupId: "g", taskId: "a", runId, outcome, next: "close-run" }]);
      const closed = t.service.closeRun(t.h.command("close-run", { runId }));
      if ("error" in closed) throw new Error(JSON.stringify(closed.error));
      const run = t.body(runId);
      const group = readGroup(t.h.store, "g");
      expect(run.drive).toMatchObject({ outcome, blockedAt: "C", blockedReason: `terminal:${outcome}` });
      expect(run.terminalClosure).toMatchObject({ runId, outcome, generation: run.generation, highWater: run.highWater });
      expect(validTerminalClosure(t.h.store, run)).toBe(true);
      expect(Number(t.h.store.db.prepare("SELECT active FROM runs WHERE id=?").get(runId)!.active)).toBe(0);
      expect(readControlRecovery(t.h.store, "epoch-test").terminalRuns ?? []).toEqual([]);
      expect(readWork(t.h.store, "g", "a").status).toBe("blocked");
      expect(readBudgetProposal(t.h.store, "g").allocations.filter((a) => a.ownerKind === "task" && a.ownerId === "a").map((a) => a.state)).toEqual(["terminal", "terminal"]);
      expect(group.used.tokens).toBe(run.cumulative.work.tokens + run.cumulative.handoff.tokens);
      expect(readRunActivity(t.h.store, runId, 50).filter((row) => row.kind === "run-settled")).toHaveLength(1);
      await t.service.pauseDispatch(t.h.command("pause-dispatch", {}));
      expect(t.service.archiveGroup(t.h.command("archive-group", {}))).toMatchObject({ result: { kind: "archived", groupId: "g" } });
    } finally { await t.h.dispose(); }
  });

  it("keeps an unknown-usage run open until its owner settlement, then closes it exactly once", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "failed-usage-unknown", sealedOwnerProof: true });
    try {
      const runId = await t.claim(), driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "blocked");
      const before = readGroup(t.h.store, "g");
      expect(t.body(runId).unknown.work).toBe(true);
      expect(readControlRecovery(t.h.store, "epoch-test").terminalRuns).toEqual([{ groupId: "g", taskId: "a", runId, outcome: "failed", next: "settle-usage" }]);
      expect(Number(t.h.store.db.prepare("SELECT active FROM runs WHERE id=?").get(runId)!.active)).toBe(1);
      expect(before.reserved.tokens).toBeGreaterThan(0);
      await driver.round();
      expect(Number(t.h.store.db.prepare("SELECT active FROM runs WHERE id=?").get(runId)!.active)).toBe(1);
      const run = t.body(runId);
      const settled = await withCommandContext("settle-169", { client: "web", principal: "user:owner" }, () => (t.service as any).settleUnknownUsage({
        schema: "orca-raw-command-v1", commandId: "settle-169", actorId: "human", expectedRevision: Number(t.h.store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision),
        verb: "settle-unknown-usage", target: { kind: "group", groupId: "g" },
        payload: { taskId: "a", runId, generation: run.generation, acknowledge: run.remaining.work.tokens === null ? "release-unmetered" : "charge-remaining-grant" },
      }));
      if ("error" in settled) throw new Error(JSON.stringify(settled.error));
      const closedRun = t.service.closeRun(t.h.command("close-run", { runId }));
      if ("error" in closedRun) throw new Error(JSON.stringify(closedRun.error));
      expect(t.body(runId).state).toBe("settled-failed");
      expect(validTerminalClosure(t.h.store, t.body(runId))).toBe(true);
      const closed = readGroup(t.h.store, "g");
      await driver.round();
      expect(readGroup(t.h.store, "g").reserved).toEqual(closed.reserved);
      expect(readRunActivity(t.h.store, runId, 50).filter((row) => row.kind === "run-settled")).toHaveLength(1);
    } finally { await t.h.dispose(); }
  });

  it("refuses a forged marker and a forged proof even when the blocker's failure fields look terminal", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "failed", sealedOwnerProof: true });
    try {
      const runId = await t.claim(), driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "blocked");
      expect(t.service.closeRun(t.h.command("close-run", { runId }))).toMatchObject({ result: { kind: "run-closed", alreadyClosed: false } });
      const run = t.body(runId);
      expect(validTerminalClosure(t.h.store, { ...run, terminalClosure: undefined })).toBe(false);
      expect(validTerminalClosure(t.h.store, { ...run, terminalClosure: { ...run.terminalClosure, outcome: "succeeded" } })).toBe(false);
      t.h.store.transaction(() => {
        const body = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body));
        body.terminalClosure.highWater += 1;
        t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(body), runId);
      });
      expect(validTerminalClosure(t.h.store, t.body(runId))).toBe(false);
    } finally { await t.h.dispose(); }
  });

  it("retries a closed failure as a fresh run without changing the closed run's accounting", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "failed", sealedOwnerProof: true, tokenPolicy: "optional-v1" });
    try {
      const runId = await t.claim(), driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "blocked");
      expect(t.service.closeRun(t.h.command("close-run", { runId }))).toMatchObject({ result: { kind: "run-closed", alreadyClosed: false } });
      const before = t.body(runId);
      expect(t.service.retryTask(t.h.command("retry-task", { taskId: "a" }))).toMatchObject({ result: { kind: "task-retried", fromRunId: runId } });
      const after = t.body(runId);
      expect(after).toMatchObject({ state: before.state, grant: before.grant, cumulative: before.cumulative, terminalClosure: before.terminalClosure });
      expect(Number(t.h.store.db.prepare("SELECT active FROM runs WHERE id=?").get(runId)!.active)).toBe(0);
      // Ladder, quota wait and failover read the same predicate; the closed run keeps its terminal identity.
      expect(isTerminallyFailedRun(t.body(runId))).toBe(true);
      expect(t.service.closeRun(t.h.command("close-run", { runId }))).toMatchObject({ result: { kind: "run-closed", alreadyClosed: true } });
      await driver.round();
      const next = await t.claim();
      expect(next).not.toBe(runId);
    } finally { await t.h.dispose(); }
  });

  it("refuses a retry whose closed run's marker no longer verifies", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "failed", sealedOwnerProof: true, tokenPolicy: "optional-v1" });
    try {
      const runId = await t.claim(), driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "blocked");
      expect(t.service.closeRun(t.h.command("close-run", { runId }))).toMatchObject({ result: { kind: "run-closed", alreadyClosed: false } });
      t.h.store.transaction(() => {
        const body = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body));
        body.terminalClosure.stopProof.hash = "0".repeat(64);
        t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(body), runId);
      });
      expect(t.service.retryTask(t.h.command("retry-task", { taskId: "a" }))).toMatchObject({ error: { code: "recovery-blocked", message: "recovery-blocked:retry-closure-invalid" } });
    } finally { await t.h.dispose(); }
  });
});
