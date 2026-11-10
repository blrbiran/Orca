import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ControlError } from "../../src/control/errors.js";
import { transientSettleError } from "../../src/control/executionDriver.js";
import { driverHarness } from "./fixtures/driverHarness.js";

// Tester #229/#230 (plan 2026-11-10 follow-up B, T1): a run blocked at E by an artifact-id-conflict stayed blocked for
// good -- the driver never advances a blocked run, and its catch logged nothing. Step E is idempotent (content-addressed
// archive, checkpoint id from the candidate), so a transient failure there is retried a bounded number of times (3) on
// later rounds before the run is left blocked; every block in that catch is named on stderr with the step and detail.

const workStatus = (t: Awaited<ReturnType<typeof driverHarness>>, taskId: string): string =>
  JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body)).status;

/** A row for `acceptance-<runId>` naming another hash: the real register check refuses it (`<id>:hash-row`). */
const conflictingRow = (t: Awaited<ReturnType<typeof driverHarness>>, runId: string): void => {
  t.h.store.db.prepare("INSERT INTO artifacts VALUES (?,?,?)").run(`acceptance-${runId}`, "0".repeat(64), JSON.stringify({ path: `artifacts/acceptance-${runId}/data` }));
};

async function withStderr<T>(body: (lines: string[]) => Promise<T>): Promise<T> {
  const lines: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => { lines.push(String(chunk)); return true; });
  try { return await body(lines); } finally { spy.mockRestore(); }
}

describe("E: a transient failure is retried before the run stays blocked (#229, #230)", () => {
  it("retries a one-shot artifact-id-conflict at E on a later round, and the checkpoint lands", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "landed");
      conflictingRow(t, runId);
      await withStderr(async (lines) => {
        const failedOnce = (): boolean => t.body(runId).state === "blocked" || lines.some((line) => line.includes(`acceptance-${runId}:hash-row`));
        for (let i = 0; i < 10 && !failedOnce(); i += 1) await driver.round();
        expect(failedOnce()).toBe(true);
        // The conflict clears (the one-shot): the next attempt must find nothing in its way.
        t.h.store.db.prepare("DELETE FROM artifacts WHERE id=? AND hash=?").run(`acceptance-${runId}`, "0".repeat(64));
        for (let i = 0; i < 30 && t.body(runId).drive?.cleanedUp !== true; i += 1) await driver.round();
        expect({ state: t.body(runId).state, blockedReason: t.body(runId).drive.blockedReason, work: workStatus(t, "a") })
          .toEqual({ state: "settled", blockedReason: null, work: "done" });
        expect(t.h.store.db.prepare("SELECT COUNT(*) AS n FROM checkpoints WHERE run_id=?").get(runId)).toEqual({ n: 1 });
        expect(lines.filter((line) => line.includes(`orca-driver: ${runId}: E: artifact-id-conflict:acceptance-${runId}:hash-row; transient, retry 1 of 3`))).toHaveLength(1);
      });
    } finally { await t.h.dispose(); }
  }, 60000);

  it("leaves a persistent conflict blocked at E after 3 retries, naming the artifact and the check", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "landed");
      conflictingRow(t, runId);
      await withStderr(async (lines) => {
        for (let i = 0; i < 20; i += 1) await driver.round();
        const detail = `artifact-id-conflict:acceptance-${runId}:hash-row`;
        expect({ state: t.body(runId).state, blockedAt: t.body(runId).drive.blockedAt, blockedReason: t.body(runId).drive.blockedReason })
          .toEqual({ state: "blocked", blockedAt: "E", blockedReason: detail });
        const ours = lines.filter((line) => line.startsWith(`orca-driver: ${runId}: `));
        expect(ours.filter((line) => line.includes("transient, retry"))).toEqual([1, 2, 3].map((n) => `orca-driver: ${runId}: E: ${detail}; transient, retry ${n} of 3\n`));
        expect(ours.filter((line) => line.includes("blocked at"))).toEqual([`orca-driver: ${runId}: blocked at E: ${detail}\n`]);
      });
    } finally { await t.h.dispose(); }
  }, 60000);

  it("blocks a non-transient failure at E at once, and says so on stderr", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "landed");
      // A regular file where the acceptance artifact's directory goes: the archive refuses it as not a directory.
      const artifacts = join(t.h.store.stateDir, "artifacts");
      await mkdir(artifacts, { recursive: true, mode: 0o700 });
      await writeFile(join(artifacts, `acceptance-${runId}`), "not a directory");
      await withStderr(async (lines) => {
        for (let i = 0; i < 10; i += 1) await driver.round();
        expect({ state: t.body(runId).state, blockedAt: t.body(runId).drive.blockedAt, blockedReason: t.body(runId).drive.blockedReason })
          .toEqual({ state: "blocked", blockedAt: "E", blockedReason: "control-path-not-directory" });
        expect(lines.filter((line) => line.startsWith(`orca-driver: ${runId}: `)))
          .toEqual([`orca-driver: ${runId}: blocked at E: control-path-not-directory\n`]);
      });
    } finally { await t.h.dispose(); }
  }, 60000);

  it("blocks a transient I/O failure at another step (C) at once: only E is retried", async () => {
    let failing = false;
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "succeed", duringCollect: async () => { if (failing) throw Object.assign(new Error("EBUSY: collect raced"), { code: "EBUSY" }); } }); try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "accepted");
      failing = true;
      await withStderr(async (lines) => {
        for (let i = 0; i < 10 && t.body(runId).state !== "blocked"; i += 1) await driver.round();
        expect({ state: t.body(runId).state, blockedAt: t.body(runId).drive.blockedAt }).toEqual({ state: "blocked", blockedAt: "C" });
        expect(lines.filter((line) => line.startsWith(`orca-driver: ${runId}: `)))
          .toEqual([`orca-driver: ${runId}: blocked at C: EBUSY: collect raced\n`]);
      });
    } finally { await t.h.dispose(); }
  }, 60000);

  it("classes as transient only an artifact-id-conflict and the I/O races EBUSY, EAGAIN and ENOENT", () => {
    const errno = (code: string) => Object.assign(new Error(code), { code });
    const verdicts = Object.fromEntries([
      ["artifact-id-conflict", new ControlError("artifact-id-conflict", "x:hash-row")],
      ["EBUSY", errno("EBUSY")], ["EAGAIN", errno("EAGAIN")], ["ENOENT", errno("ENOENT")],
      ["EACCES", errno("EACCES")], ["ENOSPC", errno("ENOSPC")], ["plain", new Error("boom")],
      ["control-path-not-directory", new ControlError("control-path-not-directory")], ["recovery-blocked", new ControlError("recovery-blocked", "x")],
    ].map(([name, error]) => [name as string, transientSettleError(error)]));
    expect(verdicts).toEqual({
      "artifact-id-conflict": true, EBUSY: true, EAGAIN: true, ENOENT: true,
      EACCES: false, ENOSPC: false, plain: false, "control-path-not-directory": false, "recovery-blocked": false,
    });
  });
});
