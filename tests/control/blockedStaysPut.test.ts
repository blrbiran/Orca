import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { readStopIntent } from "../../src/control/stopIntent.js";
import type { ExecutionDriver } from "../../src/control/executionDriver.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";
import { requestOf, requestState, stop, work, type Harness } from "./fixtures/handoffHarness.js";

// Final fix wave FR-C2 (final review C2, controller ruling 2026-09-25): the driver round's generic catch used to
// re-block every run it caught at `stepOf(run)`, which is "E" for a run already blocked. `blockedAt` decides how a
// blocked run is closed under a stop (spec §13.2 I-3) and where a retry resumes it (spec §2.3), so a second error on
// a blocked run rewrote both: its request stuck in `collecting` forever (closeBlocked read a saved report that never
// existed), and a run-scope retry marked a never-landed run `landed` -- one of which (a conflict the group could not
// afford) then settled as `settled` with its change neither landed nor in any continuable checkpoint (spec §3).
// Each criterion drives the real failure (a transient collect error, an H-settle that throws) through the round.

/** Rounds of the driver, recording the run's (state, blockedAt) after each. */
async function rounds(t: Harness, driver: ExecutionDriver, runId: string, count: number): Promise<Array<[string, string | null]>> {
  const seen: Array<[string, string | null]> = [];
  for (let i = 0; i < count; i += 1) {
    await driver.round();
    seen.push([t.body(runId).state, t.body(runId).drive.blockedAt]);
  }
  return seen;
}

/**
 * A stoppable run under handoff-stop whose first collect after delivery fails: the catch blocks the `accepted` run
 * at C, as it always did. `failuresAfterBlock` more collects then fail, each on the already-blocked run.
 */
async function blockedAtC(failuresAfterBlock: number) {
  const flaky = { failures: 0 };
  const t = await driverHarness([{ taskId: "a" }], {
    behaviour: () => "stoppable",
    duringCollect: async () => { if (flaky.failures > 0) { flaky.failures -= 1; throw new Error("ccloop collect transiently failed"); } },
  });
  const runId = await t.claim();
  const driver = t.driver();
  await t.until(driver, () => t.body(runId).state === "accepted");
  const [requestId] = await stop(t);
  flaky.failures = 1;
  await t.until(driver, () => t.body(runId).state === "blocked");
  flaky.failures = failuresAfterBlock;
  return { t, driver, runId, requestId: requestId! };
}

describe("a blocked run keeps the step it was blocked at through a later error (final fix wave FR-C2)", { timeout: 60_000 }, () => {
  it("a C-blocked run under stop whose collect fails once more stays at C, and its request still settles recoverable", async () => {
    const { t, driver, runId, requestId } = await blockedAtC(1); try {
      expect(t.body(runId).drive).toMatchObject({ blockedAt: "C", blockedReason: "ccloop collect transiently failed" });
      expect(requestState(t, requestId)).toBe("collecting");
      const seen = await rounds(t, driver, runId, 6);
      // Round 1's collect fails again on the blocked run and is recorded on it; round 2 collects and H-settles.
      expect(seen[0]).toEqual(["blocked", "C"]);
      expect(requestState(t, requestId)).toBe("settled-recoverable");
      expect(t.body(runId)).toMatchObject({ state: "settled-recoverable", recoverable: true, drive: { landedCommit: null } });
      expect(work(t, "a").status).toBe("held");
      expect(readStopIntent(t.h.store, "g")!.state).toBe("handoff-complete");
    } finally { await t.h.dispose(); }
  });

  it("records the later error after the original reason, without growing it round after round", async () => {
    const { t, driver, runId, requestId } = await blockedAtC(3); try {
      await rounds(t, driver, runId, 3);
      expect(requestState(t, requestId)).toBe("collecting");
      expect(t.body(runId).drive).toMatchObject({
        blockedAt: "C", blockedReason: "ccloop collect transiently failed | then: ccloop collect transiently failed",
      });
    } finally { await t.h.dispose(); }
  });

  it("a run-scope retry of such a run resumes it at C (accepted), never as landed, and its request then settles", async () => {
    const { t, driver, runId, requestId } = await blockedAtC(3); try {
      const before = await rounds(t, driver, runId, 3);
      expect(before.every(([state, at]) => state === "blocked" && at === "C")).toBe(true);
      const retried = await t.service.recoveryRetry(t.h.runCommand("recovery-retry", runId, { scope: "run", runId }));
      expect("error" in retried ? retried.error : retried.result).toMatchObject({ kind: "recovery-observed", resolved: true });
      expect(t.body(runId)).toMatchObject({ state: "accepted", drive: { blockedAt: null, landedCommit: null } });
      await t.until(driver, () => requestState(t, requestId) === "settled-recoverable");
      expect(t.body(runId)).toMatchObject({ state: "settled-recoverable", recoverable: true, drive: { landedCommit: null } });
      expect(readStopIntent(t.h.store, "g")!.state).toBe("handoff-complete");
    } finally { await t.h.dispose(); }
  });

  it("a conflict-parked run whose H-settle throws once stays at D; a retry resumes it at D and it is parked held, its change in a checkpoint", async () => {
    const t = await driverHarness([{ taskId: "a", targetPaths: ["shared.txt"] }, { taskId: "b", targetPaths: ["shared.txt"] }],
      { files: (id) => ({ "shared.txt": id === "a" ? "A\n" : "B\n" }) }); try {
      const ids = [await t.claim(), await t.claim()];
      const driver = t.driver();
      await t.until(driver, () => ids.some((id) => t.body(id).drive?.blockedReason === "reconcile-budget"), 120);
      const parked = ids.find((id) => t.body(id).drive?.blockedReason === "reconcile-budget")!;
      const tip = git(t.repo, "rev-parse", "refs/heads/orca/g");
      await stop(t);
      // H-settle reads the run's saved report; for one round it cannot (the row is moved aside), so step H throws.
      const report = `report:${parked}`;
      t.h.store.db.prepare("UPDATE outbox SET id=? WHERE id=?").run(`${report}:aside`, report);
      const thrown = await rounds(t, driver, parked, 1);
      t.h.store.db.prepare("UPDATE outbox SET id=? WHERE id=?").run(report, `${report}:aside`);
      expect(thrown).toEqual([["blocked", "D"]]);
      expect(t.body(parked).drive.blockedReason).toBe("reconcile-budget | then: control-terminal-pending");
      expect(requestState(t, requestOf(t, parked))).toBe("request-pending");
      const retried = await t.service.recoveryRetry(t.h.runCommand("recovery-retry", parked, { scope: "run", runId: parked }));
      expect("error" in retried ? retried.error : retried.result).toMatchObject({ kind: "recovery-observed", resolved: true });
      expect(t.body(parked)).toMatchObject({ state: "collected", drive: { landedCommit: null } });
      // From D the run tries its landing again; the conflict's reconciliation (scripted to fail, so nothing lands)
      // runs in its own process, so rounds are paced by the clock until the request closes.
      await writeFile(t.deps.adapterConfigPath, JSON.stringify({ status: "failed", spent: 1, holdMs: 0, files: {} }));
      const after: Array<[string, string | null]> = [];
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline && requestState(t, requestOf(t, parked)) === "request-pending") {
        after.push(...await rounds(t, driver, parked, 1));
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      // Never landed, never settled through E: the change is not on orca/g, so it must end in a checkpoint.
      expect(after.some(([state]) => state === "landed" || state === "settled")).toBe(false);
      expect(requestState(t, requestOf(t, parked))).toBe("settled-recoverable");
      expect(t.body(parked)).toMatchObject({ state: "settled-recoverable", recoverable: true, drive: { landedCommit: null } });
      expect(work(t, t.body(parked).taskId).status).toBe("held");
      expect(JSON.parse(String(t.h.store.db.prepare("SELECT body FROM checkpoints WHERE id=?").get(t.body(parked).checkpointId)!.body)).result).toBe("partial");
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(tip);
      const landedTask = String(t.body(ids.find((id) => id !== parked)!).taskId);
      expect(git(t.repo, "show", "refs/heads/orca/g:shared.txt")).toBe(landedTask.toUpperCase());
      expect(readStopIntent(t.h.store, "g")!.state).toBe("handoff-complete");
    } finally { await t.h.dispose(); }
  });
});
