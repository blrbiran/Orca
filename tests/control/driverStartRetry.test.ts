import { describe, expect, it, vi } from "vitest";
import { ControlError } from "../../src/control/errors.js";
import { transientDriveError } from "../../src/control/executionDriver.js";
import { driverHarness } from "./fixtures/driverHarness.js";

// Tester #267: a machine that slept through a collect left its run blocked at C with no outcome (control-peer-timeout),
// and no command named a way out. A transient failure at B, B' or C is now retried in place on later rounds, as step E's
// is (#229/#230): those steps only ask ccloop again, which is what recovery retry --run would have the run do.

async function withStderr<T>(body: (lines: string[]) => Promise<T>): Promise<T> {
  const lines: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => { lines.push(String(chunk)); return true; });
  try { return await body(lines); } finally { spy.mockRestore(); }
}

const workStatus = (t: Awaited<ReturnType<typeof driverHarness>>, taskId: string): string =>
  JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body)).status;

describe("B/B'/C: a transient failure is retried in place before the run blocks (#267)", () => {
  it("a collect that timed out once (a machine asleep) is asked again, and the run lands", async () => {
    let failures = 0;
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "succeed", duringCollect: async () => { if (failures > 0) { failures -= 1; throw new ControlError("control-peer-timeout"); } } }); try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "accepted");
      failures = 1;
      await withStderr(async (lines) => {
        for (let i = 0; i < 40 && t.body(runId).drive?.cleanedUp !== true && t.body(runId).state !== "blocked"; i += 1) await driver.round();
        expect({ state: t.body(runId).state, blockedAt: t.body(runId).drive.blockedAt, work: workStatus(t, "a") }).toEqual({ state: "settled", blockedAt: null, work: "done" });
        expect(lines.filter((line) => line.startsWith(`orca-driver: ${runId}: `))).toEqual([`orca-driver: ${runId}: C: control-peer-timeout; transient, retry 1 of 3\n`]);
      });
    } finally { await t.h.dispose(); }
  }, 60000);

  it("counts only consecutive failures: a step that answered in between starts the count again", async () => {
    // Two timeouts at C, then C answers; later E meets a persistent conflict. E gets its own three retries, not the one
    // left over from C's two.
    let failures = 0;
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "succeed", duringCollect: async () => { if (failures > 0) { failures -= 1; throw new ControlError("control-peer-timeout"); } } }); try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "accepted");
      failures = 2;
      await withStderr(async (lines) => {
        for (let i = 0; i < 40 && t.body(runId).state !== "landed" && t.body(runId).state !== "blocked"; i += 1) await driver.round();
        expect(t.body(runId).state).toBe("landed");
        // A row for `acceptance-<runId>` naming another hash: the register check refuses it at E (driverSettleRetry.test.ts).
        t.h.store.db.prepare("INSERT INTO artifacts VALUES (?,?,?)").run(`acceptance-${runId}`, "0".repeat(64), JSON.stringify({ path: `artifacts/acceptance-${runId}/data` }));
        for (let i = 0; i < 20 && t.body(runId).state !== "blocked"; i += 1) await driver.round();
        expect(lines.filter((line) => line.startsWith(`orca-driver: ${runId}: `)).map((line) => { const m = /: (C|E): .*(retry \d of 3)\n$/.exec(line); return m !== null ? `${m[1]} ${m[2]}` : line.includes(": blocked at E: ") ? "blocked at E" : line; }))
          .toEqual(["C retry 1 of 3", "C retry 2 of 3", "E retry 1 of 3", "E retry 2 of 3", "E retry 3 of 3", "blocked at E"]);
      });
    } finally { await t.h.dispose(); }
  }, 60000);

  it("blocks a failure at C that is not transient at once", async () => {
    let failing = false;
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "succeed", duringCollect: async () => { if (failing) throw new ControlError("report-identity-conflict"); } }); try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "accepted");
      failing = true;
      await withStderr(async (lines) => {
        for (let i = 0; i < 10 && t.body(runId).state !== "blocked"; i += 1) await driver.round();
        expect({ state: t.body(runId).state, blockedAt: t.body(runId).drive.blockedAt, outcome: t.body(runId).drive.outcome }).toEqual({ state: "blocked", blockedAt: "C", outcome: null });
        expect(lines.filter((line) => line.startsWith(`orca-driver: ${runId}: `))).toEqual([`orca-driver: ${runId}: blocked at C: report-identity-conflict\n`]);
      });
    } finally { await t.h.dispose(); }
  }, 60000);

  it("classes as transient E's failures, a ccloop call that timed out and a dropped connection; not a ccloop exit", () => {
    const errno = (code: string) => Object.assign(new Error(code), { code });
    const verdicts = Object.fromEntries([
      ["control-peer-timeout", new ControlError("control-peer-timeout")], ["artifact-id-conflict", new ControlError("artifact-id-conflict", "x")],
      ["ECONNRESET", errno("ECONNRESET")], ["ECONNREFUSED", errno("ECONNREFUSED")], ["EPIPE", errno("EPIPE")], ["ETIMEDOUT", errno("ETIMEDOUT")],
      ["EBUSY", errno("EBUSY")], ["EAGAIN", errno("EAGAIN")], ["ENOENT", errno("ENOENT")],
      ["control-peer-exit", new ControlError("control-peer-exit", "1:boom")], ["report-identity-conflict", new ControlError("report-identity-conflict")],
      ["EACCES", errno("EACCES")], ["plain", new Error("boom")],
    ].map(([name, error]) => [name as string, transientDriveError(error)]));
    expect(verdicts).toEqual({
      "control-peer-timeout": true, "artifact-id-conflict": true, ECONNRESET: true, ECONNREFUSED: true, EPIPE: true, ETIMEDOUT: true,
      EBUSY: true, EAGAIN: true, ENOENT: true, "control-peer-exit": false, "report-identity-conflict": false, EACCES: false, plain: false,
    });
  });
});
