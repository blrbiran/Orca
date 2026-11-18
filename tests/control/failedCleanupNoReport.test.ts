import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { driverHarness } from "./fixtures/driverHarness.js";
import { saveDriverRun, stepCleanupFailed } from "../../src/control/executionDriver.js";
import type { ExecutionPort } from "../../src/control/executionPort.js";

/**
 * Tester #360 (plan 2026-11-18 tester batch D, D1): a settled-failed run with no saved `report:<runId>` is a legal shape
 * (a run blocked before step C wrote one, then retried). It used to throw `control-terminal-pending` every round, forever,
 * with a stderr line each time, and never lost its workspace. Now: when ccloop never accepted it, or ccloop proves it
 * stopped, it is archived without a stop proof and cleaned once; while ccloop may still be running it, its workspace is
 * kept -- deleting a tree a live agent writes into would lose that agent's work -- and the wait is named once.
 */

afterEach(() => { vi.restoreAllMocks(); });

/** A failed run retried into settled-failed, then stripped of its saved report (the shape #360 met). */
async function failedWithoutReport(shape: "never-accepted" | "alive" | "proved-stopped") {
  const alive = { value: false };
  const t = await driverHarness([{ taskId: "a" }], {
    behaviour: () => "failed",
    // ccloop still running it: a collect with nothing to report yet (no candidate, no terminal, no stop proof).
    wrapPort: (port: ExecutionPort): ExecutionPort => ({ ...port, collect: async (envelope, after) => alive.value ? { events: [], candidate: null, terminal: null } : port.collect(envelope, after) }),
  });
  const driver = t.driver();
  const id = await t.claim();
  await t.until(driver, () => t.body(id).state === "blocked");
  expect(t.service.retryTask(t.h.command("retry-task", { taskId: "a" }))).not.toHaveProperty("error");
  t.h.store.db.prepare("DELETE FROM outbox WHERE id=?").run(`report:${id}`);
  // A run blocked before C has neither a report nor C's archive of the failed attempt.
  for (const row of t.h.store.db.prepare("SELECT id, body FROM outbox WHERE kind='archive'").all())
    if (JSON.parse(String(row.body)).runId === id) t.h.store.db.prepare("DELETE FROM outbox WHERE id=?").run(String(row.id));
  if (shape === "never-accepted") saveDriverRun(t.h.store, { ...t.body(id), executionId: null });
  if (shape === "alive") alive.value = true;
  const run = t.body(id);
  expect(run).toMatchObject({ state: "settled-failed", drive: { cleanedUp: false } });
  expect(t.h.store.db.prepare("SELECT 1 FROM outbox WHERE id=?").get(`report:${id}`)).toBeUndefined();
  expect(archiveOf(t, id)).toBeUndefined();
  const workspace = run.drive.workspacePath as string;
  expect(existsSync(workspace)).toBe(true);
  return { t, driver, id, workspace, alive };
}

const archiveOf = (t: Awaited<ReturnType<typeof driverHarness>>, runId: string) =>
  t.h.store.db.prepare("SELECT body FROM outbox WHERE kind='archive'").all().map((row) => JSON.parse(String(row.body))).find((body) => body.runId === runId);

describe("a settled-failed run with no saved report (#360)", { timeout: 60000 }, () => {
  it("never accepted by ccloop: archived without a stop proof, workspace removed, cleaned once", async () => {
    const { t, id, workspace } = await failedWithoutReport("never-accepted");
    try {
      expect(await stepCleanupFailed(t.deps, id)).toBe(true);
      expect(t.body(id)).toMatchObject({ state: "settled-failed", drive: { cleanedUp: true, cleanupError: null } });
      expect(existsSync(workspace)).toBe(false);
      expect(archiveOf(t, id)?.missing).toContain("stop-unconfirmed");
      // Cleaned once: a second visit has nothing left to do.
      expect(await stepCleanupFailed(t.deps, id)).toBe(false);
    } finally { await t.h.dispose(); }
  });

  it("never accepted and ccloop left no result repository: nothing of ccloop's to archive, workspace removed, cleaned", async () => {
    const { t, id, workspace } = await failedWithoutReport("never-accepted");
    try {
      await rm(join(t.body(id).drive.sourceDir, "repo"), { recursive: true, force: true });
      expect(await stepCleanupFailed(t.deps, id)).toBe(true);
      expect(t.body(id)).toMatchObject({ state: "settled-failed", drive: { cleanedUp: true, cleanupError: null } });
      expect(existsSync(workspace)).toBe(false);
      expect(archiveOf(t, id)).toBeUndefined();
    } finally { await t.h.dispose(); }
  });

  it("accepted and ccloop proves it stopped (collect has a terminal): archived without a stop proof and cleaned", async () => {
    const { t, id, workspace } = await failedWithoutReport("proved-stopped");
    try {
      expect(await stepCleanupFailed(t.deps, id)).toBe(true);
      expect(t.body(id)).toMatchObject({ state: "settled-failed", drive: { cleanedUp: true, cleanupError: null } });
      expect(existsSync(workspace)).toBe(false);
      expect(archiveOf(t, id)?.missing).toContain("stop-unconfirmed");
    } finally { await t.h.dispose(); }
  });

  it("Review Focus 4: accepted, no stop proof, still running -- workspace kept, cleanup-awaiting-stop, one log line over many rounds", async () => {
    const { t, driver, id, workspace } = await failedWithoutReport("alive");
    const lines: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => { lines.push(String(chunk)); return true; });
    try {
      for (let round = 0; round < 6; round += 1) await driver.round();
      expect(t.body(id)).toMatchObject({ state: "settled-failed", drive: { cleanedUp: false, cleanupError: "cleanup-awaiting-stop" } });
      expect(existsSync(workspace)).toBe(true);
      expect(archiveOf(t, id)).toBeUndefined();
      expect(lines.filter((line) => line.includes(id))).toHaveLength(1);
      expect(lines.filter((line) => line.includes("control-terminal-pending"))).toEqual([]);
    } finally { vi.restoreAllMocks(); await driver.stop(); await t.h.dispose(); }
  });

  it("the wait ends when ccloop proves the stop: the next visit archives and cleans", async () => {
    const { t, id, workspace, alive } = await failedWithoutReport("alive");
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      expect(await stepCleanupFailed(t.deps, id)).toBe(false);
      expect(t.body(id).drive).toMatchObject({ cleanedUp: false, cleanupError: "cleanup-awaiting-stop" });
      expect(existsSync(workspace)).toBe(true);
      // ccloop's collect now answers the run's failed terminal with its stop proof.
      alive.value = false;
      expect(await stepCleanupFailed(t.deps, id)).toBe(true);
      expect(t.body(id).drive).toMatchObject({ cleanedUp: true, cleanupError: null });
      expect(existsSync(workspace)).toBe(false);
    } finally { vi.restoreAllMocks(); await t.h.dispose(); }
  });
});

describe("a step failure on a settled run is logged when it changes, not every round (#360)", { timeout: 60000 }, () => {
  it("the same cleanup error on every round writes one stderr line", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "failed" });
    const driver = t.driver();
    const lines: string[] = [];
    try {
      const id = await t.claim();
      await t.until(driver, () => t.body(id).state === "blocked");
      expect(t.service.retryTask(t.h.command("retry-task", { taskId: "a" }))).not.toHaveProperty("error");
      // A cleanup that fails the same way every round: the run's source directory went missing.
      saveDriverRun(t.h.store, { ...t.body(id), drive: { ...t.body(id).drive, sourceDir: `${t.body(id).drive.sourceDir}-gone` } });
      vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => { lines.push(String(chunk)); return true; });
      for (let round = 0; round < 5; round += 1) await driver.round();
      expect(t.body(id).drive.cleanupError).not.toBeNull();
      expect(lines.filter((line) => line.includes(id))).toHaveLength(1);
    } finally { vi.restoreAllMocks(); await driver.stop(); await t.h.dispose(); }
  });
});
