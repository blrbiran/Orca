import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync, mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { driverHarness } from "./fixtures/driverHarness.js";
import { CLEANUP_AWAITING_STOP_RECHECK_MS, saveDriverRun, stepCleanupFailed } from "../../src/control/executionDriver.js";
import type { ExecutionPort } from "../../src/control/executionPort.js";

/**
 * Tester #360 (plan 2026-11-18 tester batch D, D1): a settled-failed run with no saved `report:<runId>` is a legal shape
 * (a run blocked before step C wrote one, then retried). It used to throw `control-terminal-pending` every round, forever,
 * with a stderr line each time, and never lost its workspace. Now: when ccloop never accepted it it is archived without a
 * stop proof and cleaned once; when ccloop proves it stopped (a stop proof at collect) it is archived with that proof and
 * cleaned; while ccloop may still be running it, its workspace is
 * kept -- deleting a tree a live agent writes into would lose that agent's work -- and the wait is named once.
 */

afterEach(() => { vi.restoreAllMocks(); });

/**
 * A failed run retried into settled-failed, then stripped of its saved report (the shape #360 met). `collected` counts
 * ccloop collects; `answer` replaces what a collect answers (`alive`: nothing yet; `terminal-only`: the failed terminal
 * written before the worker's stop is proved -- no stop proof; `wrong-generation`: a stop proof of another generation).
 */
async function failedWithoutReport(shape: "never-accepted" | "alive" | "proved-stopped") {
  const alive = { value: false };
  const answer = { value: "real" as "real" | "terminal-only" | "wrong-generation" };
  const collected = { value: 0 };
  // Review 3 (M1): what reading a stop proof's evidence does -- `read-fails` throws, `hash-mismatch` answers other bytes.
  const evidenceFault = { value: null as null | "read-fails" | "hash-mismatch" };
  const t = await driverHarness([{ taskId: "a" }], {
    behaviour: () => "failed",
    // ccloop still running it: a collect with nothing to report yet (no candidate, no terminal, no stop proof).
    wrapPort: (port: ExecutionPort): ExecutionPort => ({ ...port, readEvidence: async (ref) => {
      if (evidenceFault.value === "read-fails") throw new Error("evidence-unreadable");
      const bytes = await port.readEvidence(ref);
      return evidenceFault.value === "hash-mismatch" ? Buffer.concat([bytes, Buffer.from("x")]) : bytes;
    }, collect: async (envelope, after) => {
      collected.value += 1;
      if (alive.value) return { events: [], candidate: null, terminal: null };
      const report = await port.collect(envelope, after);
      if (answer.value === "terminal-only" && report.candidate !== null) return { ...report, candidate: { ...report.candidate, stopProof: null } };
      if (answer.value === "wrong-generation" && report.candidate?.stopProof) return { ...report, candidate: { ...report.candidate, stopProof: { ...report.candidate.stopProof, generation: report.candidate.stopProof.generation + 1 } } };
      return report;
    } }),
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
  // A run ccloop never accepted has nothing to collect either: no terminal, no stop proof. Only `executionId === null`
  // can tell it from a live one.
  if (shape === "alive" || shape === "never-accepted") alive.value = true;
  const run = t.body(id);
  expect(run).toMatchObject({ state: "settled-failed", drive: { cleanedUp: false } });
  expect(t.h.store.db.prepare("SELECT 1 FROM outbox WHERE id=?").get(`report:${id}`)).toBeUndefined();
  expect(archiveOf(t, id)).toBeUndefined();
  const workspace = run.drive.workspacePath as string;
  expect(existsSync(workspace)).toBe(true);
  collected.value = 0;
  return { t, driver, id, workspace, alive, answer, collected, evidenceFault };
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

  it("accepted and ccloop proves it stopped (a stop proof of this execution at collect): archived with that proof and cleaned", async () => {
    const { t, id, workspace } = await failedWithoutReport("proved-stopped");
    try {
      expect(await stepCleanupFailed(t.deps, id)).toBe(true);
      expect(t.body(id)).toMatchObject({ state: "settled-failed", drive: { cleanedUp: true, cleanupError: null } });
      expect(existsSync(workspace)).toBe(false);
      // Ruling (2026-11-18 tester batch D review): 「这次批准改写所有必要的判据」 -- review of D1: the stop proof ccloop gave
      // is the archive's stop proof, not null. (Was: archived with `stop-unconfirmed`.)
      // mutation: archive with stopProof null -> stop-unconfirmed, red here.
      expect(archiveOf(t, id)?.missing ?? ["no archive"]).not.toContain("stop-unconfirmed");
      expect(archiveOf(t, id)).toBeDefined();
    } finally { await t.h.dispose(); }
  });

  // Review of D1: a terminal is not a stop -- ccloop writes it before its worker is proved gone; only a stop proof of this
  // execution and generation lets the workspace go.
  it.each(["terminal-only", "wrong-generation"] as const)("accepted, collect answers %s: workspace kept, cleanup-awaiting-stop", async (shape) => {
    const { t, id, workspace, answer } = await failedWithoutReport("proved-stopped");
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      answer.value = shape;
      // mutation: treat a terminal (or any stop proof) as stopped -> archived and cleaned, red here.
      expect(await stepCleanupFailed(t.deps, id)).toBe(false);
      expect(t.body(id).drive).toMatchObject({ cleanedUp: false, cleanupError: "cleanup-awaiting-stop" });
      expect(existsSync(workspace)).toBe(true);
      expect(archiveOf(t, id)).toBeUndefined();
    } finally { vi.restoreAllMocks(); await t.h.dispose(); }
  });

  // Review of D1: the no-repository skip is for a run ccloop never accepted. An accepted one with no result repository is
  // not cleaned without its archive; the failure is the round's to record, as any cleanup failure.
  it("accepted, proved stopped, but no result repository: not cleaned, the archive failure is thrown for the round", async () => {
    const { t, id, workspace } = await failedWithoutReport("proved-stopped");
    try {
      await rm(join(t.body(id).drive.sourceDir, "repo"), { recursive: true, force: true });
      // mutation: skip the archive whenever the repository is missing -> cleaned with no archive, red here.
      await expect(stepCleanupFailed(t.deps, id)).rejects.toThrow();
      expect(t.body(id).drive).toMatchObject({ cleanedUp: false });
      expect(existsSync(workspace)).toBe(true);
    } finally { await t.h.dispose(); }
  });

  // Review 3 (M1): a stop proof whose bytes cannot be read (or fail their hash) throws for the round; the next round must
  // not collect again at once -- the delay stays until the proof is stored and the run archived.
  it.each(["read-fails", "hash-mismatch"] as const)("accepted, proved stopped, the proof's evidence %s: thrown, and ccloop is not asked again before the delay", async (fault) => {
    const { t, id, workspace, collected, evidenceFault } = await failedWithoutReport("proved-stopped");
    evidenceFault.value = fault;
    try {
      await expect(stepCleanupFailed(t.deps, id)).rejects.toThrow(fault === "read-fails" ? "evidence-unreadable" : "artifact-hash-mismatch");
      expect(collected.value).toBe(1);
      // mutation: lift the delay before the proof is read (checked.delete first) -> a second collect now, red here.
      expect(await stepCleanupFailed(t.deps, id)).toBe(false);
      expect(collected.value).toBe(1);
      expect(t.body(id).drive).toMatchObject({ cleanedUp: false });
      expect(existsSync(workspace)).toBe(true);
    } finally { vi.restoreAllMocks(); await t.h.dispose(); }
  });

  it("Review Focus 4: accepted, no stop proof, still running -- workspace kept, cleanup-awaiting-stop, one log line over many rounds", async () => {
    const { t, driver, id, workspace, collected } = await failedWithoutReport("alive");
    const lines: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => { lines.push(String(chunk)); return true; });
    try {
      for (let round = 0; round < 6; round += 1) await driver.round();
      expect(t.body(id)).toMatchObject({ state: "settled-failed", drive: { cleanedUp: false, cleanupError: "cleanup-awaiting-stop" } });
      expect(existsSync(workspace)).toBe(true);
      expect(archiveOf(t, id)).toBeUndefined();
      expect(lines.filter((line) => line.includes(id))).toHaveLength(1);
      expect(lines.filter((line) => line.includes("control-terminal-pending"))).toEqual([]);
      // Review of D1: ccloop is asked once, then again only after CLEANUP_AWAITING_STOP_RECHECK_MS.
      // mutation: drop the recheck delay -> one collect per round, red here.
      expect(collected.value).toBe(1);
    } finally { vi.restoreAllMocks(); await driver.stop(); await t.h.dispose(); }
  });

  it("the wait ends when ccloop proves the stop: the next visit archives and cleans", async () => {
    const { t, id, workspace, alive } = await failedWithoutReport("alive");
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      expect(await stepCleanupFailed(t.deps, id)).toBe(false);
      expect(t.body(id).drive).toMatchObject({ cleanedUp: false, cleanupError: "cleanup-awaiting-stop" });
      expect(existsSync(workspace)).toBe(true);
      // ccloop's collect now answers the run's failed terminal with its stop proof -- asked again once the delay has passed.
      alive.value = false;
      expect(await stepCleanupFailed(t.deps, id)).toBe(false);
      t.deps.now = () => new Date(Date.now() + CLEANUP_AWAITING_STOP_RECHECK_MS + 1);
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
      // A cleanup that fails the same way every round.
      // Ruling (2026-11-19 change-sized runs P0 x Track D merge): the old way (point sourceDir at a missing path) no longer
      // fails -- the run was archived at C, so the cleanup does not archive again, and a missing copy has nothing to
      // remove. A source directory that exists but is not named for the run is refused by removeResultCopies
      // (cleanup-path-invalid) on every round, which keeps what this test measures: one stderr line for a repeated error.
      const other = `${t.body(id).drive.sourceDir}-other`;
      mkdirSync(join(other, "repo"), { recursive: true });
      saveDriverRun(t.h.store, { ...t.body(id), drive: { ...t.body(id).drive, sourceDir: other } });
      vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => { lines.push(String(chunk)); return true; });
      for (let round = 0; round < 5; round += 1) await driver.round();
      expect(t.body(id).drive.cleanupError).not.toBeNull();
      expect(lines.filter((line) => line.includes(id))).toHaveLength(1);
    } finally { vi.restoreAllMocks(); await driver.stop(); await t.h.dispose(); }
  });
});
