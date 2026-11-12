import { chmodSync, existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readGroupActivity } from "../../src/control/activity.js";
import { stepA1, stepA2, stepC } from "../../src/control/executionDriver.js";
import { readCanonicalRecord } from "../../src/control/snapshot.js";
import { groupHandoffsDir, readHandoffRecords } from "../../src/control/taskHandoffs.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { loop } from "./fixtures/taskLoop.js";

/**
 * Tester follow-up G Part 4 through the driver: A2 hands every run its handoff directories (§10.5: every group, from the
 * upgrade on), stepC ingests what the agent left whatever the outcome, and nothing about a handoff -- missing, invalid, or
 * an ingest that throws -- ever blocks a run (Part 4.6). Exactly one activity row per run that deserves one.
 */
let cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const c of cleanups.reverse()) await c(); cleanups = []; });

async function harness() {
  const t = await driverHarness([{ taskId: "a", loop: loop("a") }]);
  cleanups.push(() => t.h.dispose());
  return t;
}
const envelopeOf = (t: Awaited<ReturnType<typeof harness>>, runId: string) => JSON.parse(readCanonicalRecord(t.h.store, t.body(runId).drive.envelopeHash));
const handoffRows = (t: Awaited<ReturnType<typeof harness>>) => readGroupActivity(t.h.store, "g", 500).filter((row) => row.kind === "handoff-invalid");

describe("the driver sends and ingests task handoffs", { timeout: 60_000 }, () => {
  it("A2 sends work.handoff pointing at groups/<g>/handoffs/runs/<run>/{in,out}, and in/README.md exists", async () => {
    const t = await harness();
    const runId = await t.claim();
    expect(stepA1(t.deps, runId)).toBe(true);
    expect(await stepA2(t.deps, runId)).toBe(true);
    const root = realpathSync(join(t.h.store.stateDir, "groups", "g", "handoffs"));
    const handoff = envelopeOf(t, runId).work.handoff;
    expect(handoff).toEqual({ inputDir: join(root, "runs", runId, "in"), outputDir: join(root, "runs", runId, "out") });
    expect(readFileSync(join(handoff.inputDir, "README.md"), "utf8")).toContain("# Handoffs for task a\n");
    expect(existsSync(handoff.outputDir)).toBe(true);
    // Never under the run's source directory or its workspace (ccloop refuses both at accept).
    expect(handoff.inputDir.startsWith(`${t.body(runId).drive.sourceDir}/`)).toBe(false);
    expect(handoff.inputDir.startsWith(`${t.body(runId).drive.workspacePath}/`)).toBe(false);
  });

  // mutation M-O3c: drop the "existing record ⇒ activity:false" check -> the replayed stepC writes a second row, red
  it("stepC of a succeeded run whose agent wrote nothing records missing and one handoff-invalid row; a rerun of stepC adds no second row", async () => {
    const t = await harness();
    const runId = await t.claim();
    await t.until(t.driver(), () => t.body(runId).state === "accepted");
    class Crash extends Error {}
    await expect(stepC({ ...t.deps, crash: (point) => { if (point === "C-after-handoff") throw new Crash(point); } }, runId)).rejects.toBeInstanceOf(Crash);
    expect(t.body(runId).state).toBe("accepted");
    expect(handoffRows(t)).toHaveLength(1);
    await t.until(t.driver(), () => t.body(runId).state === "settled");
    const rows = handoffRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ taskId: "a", runId, body: { handoff: { state: "missing", reason: null, bytes: null }, summary: { state: "missing", reason: null, bytes: null } } });
    expect(readHandoffRecords(t.h.store.stateDir, "g").map((record) => [record.runId, record.outcome])).toEqual([[runId, "succeeded"]]);
  });

  it("stepC of a run whose out/ holds valid files records them and writes no row; the run still lands", async () => {
    const t = await harness();
    const runId = await t.claim();
    await t.until(t.driver(), () => t.body(runId).drive?.prepared === true);
    const { outputDir } = envelopeOf(t, runId).work.handoff;
    writeFileSync(join(outputDir, "handoff.md"), "# What I learned\n");
    writeFileSync(join(outputDir, "summary.md"), "did a\n");
    await t.until(t.driver(), () => t.body(runId).state === "settled");
    expect(handoffRows(t)).toEqual([]);
    const root = groupHandoffsDir(t.h.store.stateDir, "g");
    expect(readFileSync(join(root, `handoff-a-${runId}.md`), "utf8")).toBe("# What I learned\n");
    expect(readFileSync(join(root, `summary-a-${runId}.md`), "utf8")).toBe("did a\n");
    expect(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body).toContain('"status":"done"');
  });

  // mutation M-O3b: rethrow from the ingest catch -> stepC throws and the run never lands, red
  it("an ingest that throws (unreadable handoffs dir) blocks nothing: the run moves on and the error is logged once", async () => {
    const t = await harness();
    const runId = await t.claim();
    await t.until(t.driver(), () => t.body(runId).state === "accepted");
    const root = groupHandoffsDir(t.h.store.stateDir, "g");
    const lines: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => { lines.push(String(chunk)); return true; });
    chmodSync(root, 0o000);
    try { await t.until(t.driver(), () => t.body(runId).state === "settled"); }
    finally { chmodSync(root, 0o700); spy.mockRestore(); }
    expect(lines.filter((line) => line.startsWith(`orca-driver: handoff ingest ${runId}: `))).toHaveLength(1);
    expect(handoffRows(t)).toEqual([]);
  });
});
