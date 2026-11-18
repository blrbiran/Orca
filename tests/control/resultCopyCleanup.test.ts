import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createExecutionDriver, DriverCrash, stepCleanupFailed } from "../../src/control/executionDriver.js";
import { verifySnapshot } from "../../src/control/snapshot.js";
import { driverHarness } from "./fixtures/driverHarness.js";

/**
 * Change-sized runs spec 2026-11-19 §5.6 (P0-5, P0-6; review I1): a settled run's `<sourceDir>/repo` goes once the
 * archive that holds it persisted, at step E and in a failed run's cleanup. The order is the contract: the removal runs
 * before the `cleanedUp` write, so a crash between them resumes; and a failed run's cleanup archives only when nothing
 * is archived yet, so a crash after the removal never makes a later round read the copy that is gone.
 */
type Harness = Awaited<ReturnType<typeof driverHarness>>;
const archiveRows = (t: Harness, runId: string) => t.h.store.db.prepare("SELECT body FROM outbox WHERE kind='archive' AND json_extract(body,'$.runId')=? ORDER BY rowid").all(runId).map((row) => JSON.parse(String(row.body)) as { snapshot: { artifactId: string; hash: string } | null; missing: string[] });
const repoOf = (t: Harness, runId: string) => join(t.body(runId).drive.sourceDir, "repo");
const crashingAt = (t: Harness, at: string) => ({ ...t.deps, crash: (point: string) => { if (point === at) throw new DriverCrash(point as never); } });

describe("step E removes the result copy (change-sized runs §5.6, P0-5)", () => {
  // M5.1: drop the call -> repo still there, red. M5.2: call it before archiveRun -> result-copy-unarchived, the run is
  // blocked at E and never cleaned, red.
  it("a landed run's settle removes <sourceDir>/repo after its archive persisted, keeps the source directory, and its snapshot still verifies", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "landed");
      expect(existsSync(repoOf(t, runId))).toBe(true);
      await t.until(driver, () => t.body(runId).drive?.cleanedUp === true);
      expect(t.body(runId)).toMatchObject({ state: "settled", drive: { cleanupError: null } });
      expect(existsSync(repoOf(t, runId))).toBe(false);
      expect(existsSync(t.body(runId).drive.sourceDir)).toBe(true);
      const rows = archiveRows(t, runId);
      expect(rows.at(-1)!.missing).toEqual([]);
      await verifySnapshot(t.h.store, rows.at(-1)!.snapshot!);
    } finally { await t.h.dispose(); }
  }, 30000);

  // M5.3: write cleanedUp above the crash point -> after the crash the run reads cleaned up with its copy still there, red
  it("a crash between the workspace cleanup and the removal resumes to cleanedUp with the copy gone", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      const crashing = createExecutionDriver(crashingAt(t, "E-before-result-copies"));
      await t.until(crashing, () => crashing.crashed !== null);
      expect(t.body(runId)).toMatchObject({ state: "settled", drive: { cleanedUp: false } });
      expect(existsSync(t.body(runId).drive.workspacePath)).toBe(false);
      expect(existsSync(repoOf(t, runId))).toBe(true);
      const archived = archiveRows(t, runId).length;
      await t.until(t.driver(), () => t.body(runId).drive?.cleanedUp === true);
      expect(t.body(runId).drive).toMatchObject({ cleanedUp: true, cleanupError: null });
      expect(existsSync(repoOf(t, runId))).toBe(false);
      expect(archiveRows(t, runId)).toHaveLength(archived);
    } finally { await t.h.dispose(); }
  }, 30000);
});

describe("a failed run's cleanup removes the result copy, resumably (change-sized runs §5.6, P0-6, review I1)", () => {
  // M5.4: re-archive unconditionally -> the resumed cleanup reads the removed copy (ENOENT from realpath), red
  it("a failed run's cleanup resumes after a crash that followed the removal, without re-archiving", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "failed" }); const driver = t.driver(); try {
      const id = await t.claim();
      await t.until(driver, () => t.body(id).state === "blocked");
      expect(t.service.retryTask(t.h.command("retry-task", { taskId: "a" }))).not.toHaveProperty("error");
      expect(t.body(id).state).toBe("settled-failed");
      const archived = archiveRows(t, id).length;
      expect(archived).toBeGreaterThan(0);
      await expect(stepCleanupFailed(crashingAt(t, "cleanup-failed-after-result-copies"), id)).rejects.toThrow(DriverCrash);
      expect(existsSync(repoOf(t, id))).toBe(false);
      expect(t.body(id).drive.cleanedUp).toBe(false);
      expect(await stepCleanupFailed(t.deps, id)).toBe(true);
      expect(t.body(id)).toMatchObject({ state: "settled-failed", drive: { outcome: "failed", cleanedUp: true, cleanupError: null } });
      expect(archiveRows(t, id)).toHaveLength(archived);
      expect(existsSync(repoOf(t, id))).toBe(false);
    } finally { await driver.stop(); await t.h.dispose(); }
  }, 30000);

  // M5.5: never archive in the cleanup -> no row, the removal refuses (result-copy-unarchived), red
  it("a failed run with no archive row is archived exactly once by its cleanup", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "failed" }); const driver = t.driver(); try {
      const id = await t.claim();
      await t.until(driver, () => t.body(id).state === "blocked");
      t.h.store.db.prepare("DELETE FROM outbox WHERE kind='archive' AND json_extract(body,'$.runId')=?").run(id);
      expect(t.service.retryTask(t.h.command("retry-task", { taskId: "a" }))).not.toHaveProperty("error");
      expect(await stepCleanupFailed(t.deps, id)).toBe(true);
      const rows = archiveRows(t, id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.missing).toEqual([]);
      expect(t.body(id).drive).toMatchObject({ cleanedUp: true, cleanupError: null });
      expect(existsSync(repoOf(t, id))).toBe(false);
    } finally { await driver.stop(); await t.h.dispose(); }
  }, 30000);
});
