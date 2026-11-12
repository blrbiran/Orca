import { describe, expect, it } from "vitest";
import { decideFundedAllowance } from "../../src/control/fundedAllowance.js";
import { readGroup } from "../../src/control/queries.js";
import { deliverScheduledStart, nextClaimableTask } from "../../src/control/webDispatch.js";
import { replenishStartWakes } from "../../src/control/executionDriver.js";
import { driverHarness } from "./fixtures/driverHarness.js";

// Tester follow-up G Part 6 §6.1 (#192): a dependent task is claimable as soon as its dependency's run landed on the
// group branch -- with a commit, outcome succeeded, no block reason and every usage observed -- not only once the
// dependency's settle made its work item `done`. Settle (archive, publish) runs after; nothing is overspent because
// the landed run still holds its reserve and its booked usage is already in group.used.

type Harness = Awaited<ReturnType<typeof driverHarness>>;
const workOf = (t: Harness, id: string) => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(id)!.body));
const patchRun = (t: Harness, runId: string, patch: (run: Record<string, any>) => void): void => {
  const run = t.body(runId); patch(run);
  t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(run), runId);
};

async function landA(t: Harness): Promise<string> {
  const runId = await t.claim();
  const driver = t.driver();
  await t.until(driver, () => t.body(runId).state === "landed");
  return runId;
}

describe("#192: a dependency that landed releases its dependent", () => {
  it("a dependent is claimable once its dependency landed, before it settles", async () => {
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b", dependsOn: ["a"] }]); try {
      await landA(t);
      expect(workOf(t, "a").status).not.toBe("done");
      expect(nextClaimableTask(t.h.store, "g")).toEqual({ workItemId: "b" });
      expect(decideFundedAllowance(t.h.store, "g", null, Date.now()).workItemId).toBe("b");
    } finally { await t.h.dispose(); }
  }, 30000);

  it("a landed dependency whose usage is not fully observed releases nothing", async () => {
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b", dependsOn: ["a"] }]); try {
      const aRun = await landA(t);
      patchRun(t, aRun, (run) => { run.unknown = { ...run.unknown, work: true }; });
      expect(nextClaimableTask(t.h.store, "g")).toBeNull();
      patchRun(t, aRun, (run) => { run.unknown = { ...run.unknown, work: false }; });
      expect(nextClaimableTask(t.h.store, "g")).toEqual({ workItemId: "b" });
      // A usage event past the run's high water: usage seen after the landing is not booked yet.
      const highWater = t.body(aRun).highWater as number;
      t.h.store.db.prepare("INSERT INTO usage_events(run_id,seq,payload_hash,body) VALUES(?,?,?,?)").run(aRun, highWater + 1, "x", JSON.stringify({ bucket: "work", cumulative: { tokens: 1, activeMs: 0, attempts: 0, sessions: 0 } }));
      expect(nextClaimableTask(t.h.store, "g")).toBeNull();
    } finally { await t.h.dispose(); }
  }, 30000);

  it("a landed dependency with a block reason, or no commit, releases nothing", async () => {
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b", dependsOn: ["a"] }]); try {
      const aRun = await landA(t);
      const drive = t.body(aRun).drive;
      patchRun(t, aRun, (run) => { run.drive = { ...drive, blockedReason: "x" }; });
      expect(nextClaimableTask(t.h.store, "g")).toBeNull();
      patchRun(t, aRun, (run) => { run.drive = { ...drive, landedCommit: null, landedDirs: null }; });
      expect(nextClaimableTask(t.h.store, "g")).toBeNull();
      patchRun(t, aRun, (run) => { run.drive = { ...drive, outcome: "failed" }; });
      expect(nextClaimableTask(t.h.store, "g")).toBeNull();
      patchRun(t, aRun, (run) => { run.drive = drive; });
      expect(nextClaimableTask(t.h.store, "g")).toEqual({ workItemId: "b" });
    } finally { await t.h.dispose(); }
  }, 30000);

  it("the dependent's fit counts the landed run's usage and its held reserve", async () => {
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b", dependsOn: ["a"] }], { workTokens: () => 40 }); try {
      // A confirmed Web group holds every task's grant in its reserve from confirmation on.
      const confirmed = readGroup(t.h.store, "g");
      const aRun = await landA(t);
      const landed = readGroup(t.h.store, "g");
      const a = t.body(aRun);
      // a's 40 tokens moved from reserved to used when they were booked; nothing of a's remaining grant was released.
      expect(landed.used.tokens).toBe(confirmed.used.tokens + 40);
      expect(landed.reserved.tokens).toBe(confirmed.reserved.tokens - 40);
      expect(a.remaining.work.tokens).toBe(a.grant.work.tokens - 40);
      replenishStartWakes({ store: t.h.store, admissionGate: t.h.deps.admissionGate });
      const delivered = await deliverScheduledStart(t.dispatch, "g");
      expect(delivered.kind).toBe("claimed");
      const bRun = (delivered as { runId: string }).runId;
      expect(bRun).not.toBe(aRun);
      expect(t.body(bRun).workItemId).toBe("b");
      // Claiming b spends nothing of a's hold: used and reserved are as they were, a's remaining is unchanged.
      const after = readGroup(t.h.store, "g");
      expect(after.used).toEqual(landed.used);
      expect(after.reserved).toEqual(landed.reserved);
      expect(t.body(aRun).remaining).toEqual(a.remaining);
      expect(t.body(aRun).state).toBe("landed");
    } finally { await t.h.dispose(); }
  }, 30000);
});
