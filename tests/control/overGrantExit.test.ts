import { join } from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { openControlStore, type ControlStore } from "../../src/control/store.js";
import { recordUsage } from "../../src/control/usage.js";
import { readWebGroup } from "../../src/control/webService.js";
import { autoRetryFundingRefusal } from "../../src/control/retryTask.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { replenishStartWakes } from "../../src/control/executionDriver.js";
import { readControlGroup, readGroupSummary } from "../../src/panel/controlViews.js";
import { rm } from "node:fs/promises";
import { TASK_WORK } from "../../src/control/defaultAmounts.js";
import type { Amount } from "../../src/control/types.js";
import { driverHarness, type HarnessOptions } from "./fixtures/driverHarness.js";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

/**
 * Session 3cfc2e73 D2 (spec 2026-11-05 §3.2, §4 criteria 10-13). A group with no token limit (`limit.tokens === null`)
 * is not blocked by a run over its grant in any dimension: the breach is recorded on the run and shown (summary
 * `overGrant`, the run view's `overGrant`). A limited group still blocks, and set-limit or the task's retry lifts the
 * block by rule. Driven through the driver's synthetic ccloop.
 */
type Harness = Awaited<ReturnType<typeof driverHarness>>;
const group = (t: Harness) => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
const work = (t: Harness, taskId: string) => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body));
let artifact = 0;
const book = (t: Harness, runId: string, eventSeq: number, cumulative: Amount) => recordUsage(t.h.store, {
  runId, generation: 1, eventSeq, bucket: "work", cumulative, source: { artifactId: `over-${++artifact}`, hash: "a".repeat(64) } });
/** A direct edit of one work item, for a state the synthetic ccloop does not produce on its own. */
const pokeWork = (t: Harness, taskId: string, change: (w: Record<string, any>) => void): void => {
  const w = work(t, taskId); change(w);
  t.h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id=?").run(JSON.stringify(w), taskId);
};
/** The synthetic ccloop reports 5 activeMs per run (driverPort.ts); a funded task's authored 4 makes its run go over. */
const smallActiveMs = (t: Harness, taskId: string): void => pokeWork(t, taskId, (w) => { w.grant.work.activeMs = 4; });
/** Task a fails; every other task succeeds. */
const failingA: HarnessOptions["behaviour"] = (id) => (id === "a" ? "failed" : "succeed");
async function failedRun(t: Harness): Promise<{ runId: string; driver: ReturnType<Harness["driver"]> }> {
  const runId = await t.claim();
  const driver = t.driver();
  await t.until(driver, () => t.body(runId).state === "blocked");
  return { runId, driver };
}
async function claimAgain(t: Harness, driver: ReturnType<Harness["driver"]>): Promise<string> {
  await driver.round();
  const delivered = await deliverScheduledStart(t.dispatch, "g");
  if (delivered.kind !== "claimed") throw new Error(`no claim: ${JSON.stringify(delivered)}`);
  return delivered.runId;
}
const retry = (t: Harness, payload: Record<string, unknown> = {}) => t.service.retryTask(t.h.command("retry-task", { taskId: "a", ...payload } as never));
const code = (answer: unknown) => (answer as { error?: { code: string; message: string } }).error ?? null;

describe("criterion 10: an unlimited group's breach is recorded, not blocking", () => {
  it("an unlimited group's work-run breach leaves it dispatchable and shows overGrant", async () => {
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }], { tokenPolicy: "optional-v1" }); try {
      expect(group(t).limit.tokens).toBeNull();
      const runId = await t.claim();
      const grant = t.body(runId).grant.work as Amount;
      book(t, runId, 1, { tokens: 10, activeMs: 1, attempts: grant.attempts + 1, sessions: 1 });
      expect(t.body(runId).breaches).toEqual([1]);
      expect(group(t).status).not.toBe("blocked");
      expect(readGroupSummary(t.h.store, "g").overGrant).toBe(true);
      expect(readControlGroup(t.h.store, "epoch", "g").runs.find((run) => run.runId === runId)!.overGrant).toEqual(["attempts"]);
      // Dispatchable: the other task is claimed while the breached run is still active.
      expect(replenishStartWakes({ store: t.h.store, admissionGate: t.h.deps.admissionGate }).length + Number(t.h.store.db.prepare("SELECT COUNT(*) AS n FROM scheduler_wakes WHERE group_id='g' AND delivered=0").get()!.n)).toBeGreaterThan(0);
      const second = await deliverScheduledStart(t.dispatch, "g");
      expect(second.kind).toBe("claimed");
    } finally { await t.h.dispose(); }
  });

  it("an activeMs breach in an unlimited group does not block", async () => {
    const t = await driverHarness([{ taskId: "a" }], { tokenPolicy: "optional-v1" }); try {
      const runId = await t.claim();
      const grant = t.body(runId).grant.work as Amount;
      book(t, runId, 1, { tokens: 10, activeMs: grant.activeMs + 1, attempts: 1, sessions: 1 });
      expect(t.body(runId).breaches).toEqual([1]);
      expect(group(t).status).not.toBe("blocked");
    } finally { await t.h.dispose(); }
  });

  it("a limited group's work-run breach still blocks, and its summary carries no overGrant chip", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      expect(group(t).limit.tokens).not.toBeNull();
      const runId = await t.claim();
      const grant = t.body(runId).grant.work as Amount;
      book(t, runId, 1, { ...grant, tokens: grant.tokens! + 1 });
      expect(group(t).status).toBe("blocked");
      expect(readGroupSummary(t.h.store, "g").overGrant).toBeUndefined();
    } finally { await t.h.dispose(); }
  });
});

describe("criterion 11: a limited group's over-grant exits", () => {
  const limited = () => driverHarness([{ taskId: "a" }], { behaviour: failingA, workTokens: () => TASK_WORK.tokens + 1 });

  it("set-limit on an over-grant-blocked limited group lifts it by rule, and dispatch resumes after the retry", async () => {
    const t = await limited(); try {
      const { runId, driver } = await failedRun(t);
      expect(t.body(runId).breaches.length).toBeGreaterThan(0);
      expect(group(t).status).toBe("blocked");
      const limit = readWebGroup(t.h.store, "g").limit;
      const answer = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, tokens: limit.tokens! + 5_000_000 } }));
      expect(code(answer)).toBeNull();
      // The failed run is still active (blocked at C, not yet retried): the rule gives `running`.
      expect(group(t).status).toBe("running");
      expect(code(retry(t))).toBeNull();
      expect(await claimAgain(t, driver)).not.toBe(runId);
    } finally { await t.h.dispose(); }
  });

  it("set-limit is refused when a block reason is not an over-grant", async () => {
    const t = await limited(); try {
      const body = group(t); body.status = "blocked";
      t.h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(body));
      const limit = readWebGroup(t.h.store, "g").limit;
      expect(code(t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, tokens: limit.tokens! + 5_000_000 } })))?.code).toBe("group-state-invalid");
      expect(group(t).status).toBe("blocked");
    } finally { await t.h.dispose(); }
  });

  it("the retry of a fixed-grant task lifts its over-grant block by rule (#161)", async () => {
    const t = await limited(); try {
      // A reserve the retry's re-reservation of the full grant fits in, raised before the run.
      const limit = readWebGroup(t.h.store, "g").limit;
      expect(code(t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, tokens: limit.tokens! + 10_000_000 } })))).toBeNull();
      const { runId } = await failedRun(t);
      expect(group(t).status).toBe("blocked");
      expect(code(retry(t))).toBeNull();
      expect(t.body(runId).state).toBe("settled-failed");
      // No active run, task a ready again: the rule gives `review`.
      expect(group(t).status).toBe("review");
    } finally { await t.h.dispose(); }
  });

});

describe("criterion 13: funding after a non-blocking breach", () => {
  /**
   * The behaviour, stated (spec §3.2 leaves it to the builder): the group is not blocked, but a run's breach in a non-token
   * dimension uses up that dimension of the task's authored work ceiling -- every later grant is the ceiling less the
   * lineage's usage (fundedAllowance.ts decideFundedAllowance) -- so the task's next run is not funded and its retry is
   * refused authored-budget-exhausted (retryTask.ts). The group's other tasks keep running (criterion 10).
   */
  // Ruling (2026-11-11, tester follow-up E): 「这次批准改写所有必要的判据」 — spec 2026-11-11-tester-followup-e-design.md §8
  // overrides budget spec 2026-11-11 §7 item 7's first consequence: in a group with no token limit the ladder's automatic
  // retry still counts the lineage (refused authored-budget-exhausted), while a person's explicit retry starts its run
  // with the task's own active time. (Was: the explicit retry refused authored-budget-exhausted.)
  it("in an unlimited group the ladder refuses the breached task authored-budget-exhausted, an explicit retry starts it fresh, and the group stays unblocked", async () => {
    const t = await driverHarness([{ taskId: "a" }], { tokenPolicy: "optional-v1", behaviour: failingA }); try {
      smallActiveMs(t, "a");
      const { runId, driver } = await failedRun(t);
      expect(t.body(runId).breaches.length).toBeGreaterThan(0);
      expect(group(t).status).not.toBe("blocked");
      expect(autoRetryFundingRefusal(t.h.store, "g", "a", runId)).toBe("authored-budget-exhausted");
      const plain = code(retry(t));
      expect(plain).toBeNull();
      expect(t.body(runId).state).toBe("settled-failed");
      expect(group(t).status).not.toBe("blocked");
      void driver;
    } finally { await t.h.dispose(); }
  });
});

describe("criterion 12: the 21 -> 22 repair", () => {
  const REPAIR_AT = 4242;
  /** Close the harness's store, rewrite group g to `blocked` (as the old usage.ts left it), mark it schema 21, reopen. */
  async function reopenedAt21(t: Harness): Promise<ControlStore> {
    const stateDir = t.h.store.stateDir;
    t.h.store.close();
    const raw = new DatabaseSync(join(stateDir, "control.sqlite"));
    const body = JSON.parse(String(raw.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
    body.status = "blocked";
    raw.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(body));
    raw.prepare("UPDATE meta SET value='21' WHERE key='schemaVersion'").run();
    raw.close();
    return openControlStore({ stateDir, now: () => REPAIR_AT });
  }
  const read = (store: ControlStore) => JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));

  it("the migration repairs an unlimited over-grant-blocked group and leaves a limited one blocked", async () => {
    const unlimited = await driverHarness([{ taskId: "a" }], { tokenPolicy: "optional-v1" });
    let store: ControlStore | null = null;
    try {
      const runId = await unlimited.claim();
      const grant = unlimited.body(runId).grant.work as Amount;
      book(unlimited, runId, 1, { tokens: 10, activeMs: grant.activeMs + 1, attempts: 1, sessions: 1 });
      store = await reopenedAt21(unlimited);
      expect(store.db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()!.value).toBe("24"); // Ruling: 「这次批准改写所有必要的判据」 (schema 23 -> 24, raw usage detail)
      const body = read(store);
      // The claimed run is still active: the rule gives `running`.
      expect(body.status).toBe("running");
      expect(body.statusRepairs).toEqual([{ from: "blocked", to: "running", cause: "over-grant-unlimited", runIds: [runId], by: "migration-21-to-22", at: REPAIR_AT }]);
    } finally { store?.close(); await rm(unlimited.h.root, { recursive: true, force: true }); }
    const limited = await driverHarness([{ taskId: "a" }]);
    store = null;
    try {
      const runId = await limited.claim();
      const grant = limited.body(runId).grant.work as Amount;
      book(limited, runId, 1, { ...grant, tokens: grant.tokens! + 1 });
      store = await reopenedAt21(limited);
      const body = read(store);
      expect(body.status).toBe("blocked");
      expect(body.statusRepairs).toBeUndefined();
    } finally { store?.close(); await rm(limited.h.root, { recursive: true, force: true }); }
  });

  it("an unlimited blocked group with no over-grant run is left as it is", async () => {
    const t = await driverHarness([{ taskId: "a" }], { tokenPolicy: "optional-v1" });
    let store: ControlStore | null = null;
    try {
      store = await reopenedAt21(t);
      expect(read(store).status).toBe("blocked");
      expect(read(store).statusRepairs).toBeUndefined();
    } finally { store?.close(); await rm(t.h.root, { recursive: true, force: true }); }
  });
});
