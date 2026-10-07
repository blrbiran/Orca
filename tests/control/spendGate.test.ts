import { describe, expect, it } from "vitest";
import { recordUsage } from "../../src/control/usage.js";
import { readProjectionState } from "../../src/control/projectionJournal.js";
import { replenishStartWakes } from "../../src/control/executionDriver.js";
import { claimRequirementCallInTransaction } from "../../src/control/requirementCalls.js";
import { committedTokens, gateClaim } from "../../src/control/spendCaps.js";
import { createWebWakeHandlers, deliverScheduledStart, scheduleStart, type WebDispatchDeps } from "../../src/control/webDispatch.js";
import { deliverSchedulerWakes } from "../../src/control/dispatch.js";
import { WebControlService } from "../../src/control/webService.js";
import { sha256Canonical } from "../../src/control/canonicalJson.js";
import { readControlGroup, readRequirementView } from "../../src/panel/controlViews.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import type { ControlStore } from "../../src/control/store.js";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 8, 12);

const setCap = (store: ControlStore, period: "total" | "week" | "month", tokens: number) =>
  store.db.prepare("INSERT INTO spend_caps(scope,period,tokens,updated_at,updated_by) VALUES ('all',?,?,1,'user:u1') ON CONFLICT(scope,period) DO UPDATE SET tokens=excluded.tokens").run(period, tokens);
/** What claiming a work item promises: its work and handoff grant tokens, read from its row (D4). */
const grantOf = (store: ControlStore, groupId: string, workItemId: string): number => {
  const work = JSON.parse(String(store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id=?").get(groupId, workItemId)!.body)) as { grant: { work: { tokens: number }; handoff: { tokens: number } } };
  return work.grant.work.tokens + work.grant.handoff.tokens;
};
const runCount = (store: ControlStore, groupId: string) => Number(store.db.prepare("SELECT count(*) AS n FROM runs WHERE group_id=?").get(groupId)!.n);
const blockRow = (store: ControlStore, groupId: string) => store.db.prepare("SELECT body FROM spend_cap_blocks WHERE group_id=?").get(groupId);

/** A confirmed group "g" with tasks a and b, started (one start wake pending), and a dispatch clock the criterion moves. */
async function started() {
  const h = await webFixture(profileSnapshot(), [{ taskId: "a" }, { taskId: "b" }]);
  const service = new WebControlService(h.deps);
  await service.confirm(h.command("confirm", await h.confirmPayload()));
  const scheduled = await scheduleStart({ store: h.store, profileRouter: h.deps.profileRouter }, h.command("start", {}));
  if ("error" in scheduled || scheduled.result.kind !== "scheduled") throw new Error(`start rejected: ${JSON.stringify(scheduled)}`);
  const clock = { now: T0 };
  const deps: WebDispatchDeps = { store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate, now: () => new Date(clock.now) };
  const startWake = () => Number(h.store.db.prepare("SELECT delivered FROM scheduler_wakes WHERE id=?").get(scheduled.result.kind === "scheduled" ? scheduled.result.wakeId : "")!.delivered);
  return { h, service, deps, clock, startWake };
}

describe("the claim gate (spec §6.3.1, D9)", () => {
  it("blocks at headroom, claims nothing, keeps the wake, and resumes after a cap raise without a command", async () => {
    const { h, service, deps, startWake } = await started(); try {
      const G = grantOf(h.store, "g", "a");
      expect(G).toBeGreaterThan(0);
      setCap(h.store, "total", G - 1);
      const changeSeq = () => readProjectionState(h.store).changeSeq;
      const before = changeSeq();
      expect(await deliverScheduledStart(deps, "g")).toEqual({ kind: "blocked", reason: "spend-cap-reached" });
      expect(runCount(h.store, "g")).toBe(0);
      expect(startWake()).toBe(0);
      expect(readControlGroup(h.store, "epoch", "g").spendCapBlock).toEqual({ code: "spend-cap-reached", scope: "all", period: "total", capTokens: G - 1, grantTokens: G });
      // The block is a projection change, so a panel watching the group sees it; an unchanged repeat is not another one.
      const afterBlock = changeSeq();
      expect(afterBlock).toBeGreaterThan(before);
      expect(await deliverScheduledStart(deps, "g")).toEqual({ kind: "blocked", reason: "spend-cap-reached" });
      expect(changeSeq()).toBe(afterBlock);
      // The pump's start handler answers "not delivered" for it, so the wake stays pending (D9).
      await deliverSchedulerWakes(h.store, createWebWakeHandlers({ ...deps, service }));
      expect(startWake()).toBe(0);
      // (The pump also claims the import's queued estimate, which fits; no task run is made.)
      expect(Number(h.store.db.prepare("SELECT count(*) AS n FROM runs WHERE group_id='g' AND work_item_id IN ('a','b')").get()!.n)).toBe(0);
      // Not a recovery blocker: the group stays dispatchable and nothing has to be retried by hand.
      expect(h.store.db.prepare("SELECT count(*) AS n FROM recovery_blockers WHERE group_id='g'").get()!.n).toBe(0);
      // The estimate run the pump claimed holds its grant (D4), so the cap is raised to leave exactly G beside it.
      h.store.db.prepare("UPDATE spend_caps SET tokens=? WHERE scope='all' AND period='total'").run(G + committedTokens(h.store, "all", null));
      expect((await deliverScheduledStart(deps, "g")).kind).toBe("claimed");
      expect(startWake()).toBe(1);
      expect(readControlGroup(h.store, "epoch", "g").spendCapBlock).toBe(null);
      expect(blockRow(h.store, "g")).toBe(undefined);
    } finally { await h.dispose(); }
  });

  it("a claim of nothing never blocks, and clears a block nothing waits on any more", async () => {
    const { h, deps } = await started(); try {
      setCap(h.store, "total", 1);
      expect(await deliverScheduledStart(deps, "g")).toEqual({ kind: "blocked", reason: "spend-cap-reached" });
      h.store.db.prepare("INSERT INTO usage_ledger(applied_at,group_id,repo_id,run_id,source,model,tokens,quality) VALUES (?,?,?,?,?,?,?,?)").run(T0, "g", "repo", null, "run-work", null, 5, "unattributed");
      // Headroom is now negative; a grant of 0 still fits it.
      expect(h.store.transaction(() => gateClaim(h.store, "g", 0, T0))).toBe(true);
      expect(blockRow(h.store, "g")).toBe(undefined);
      expect(h.store.transaction(() => gateClaim(h.store, "g", 1, T0))).toBe(false);
      expect(blockRow(h.store, "g")).not.toBe(undefined);
    } finally { await h.dispose(); }
  });

  it("a new week resumes it", async () => {
    const { h, deps, clock } = await started(); try {
      const G = grantOf(h.store, "g", "a");
      setCap(h.store, "week", G);
      h.store.db.prepare("INSERT INTO usage_ledger(applied_at,group_id,repo_id,run_id,source,model,tokens,quality) VALUES (?,?,?,?,?,?,?,?)")
        .run(clock.now, "g", "repo", null, "run-work", null, 1, "unattributed");
      expect(await deliverScheduledStart(deps, "g")).toEqual({ kind: "blocked", reason: "spend-cap-reached" });
      expect(JSON.parse(String(blockRow(h.store, "g")!.body))).toMatchObject({ period: "week", capTokens: G, grantTokens: G });
      clock.now += 8 * DAY;
      expect((await deliverScheduledStart(deps, "g")).kind).toBe("claimed");
    } finally { await h.dispose(); }
  });

  it("what claimed runs still hold is committed", async () => {
    const { h, deps } = await started(); try {
      const Ga = grantOf(h.store, "g", "a"), Gb = grantOf(h.store, "g", "b");
      setCap(h.store, "total", Ga + Gb - 1);
      expect((await deliverScheduledStart(deps, "g")).kind).toBe("claimed");
      expect(replenishStartWakes({ store: h.store })).toHaveLength(1);
      expect(await deliverScheduledStart(deps, "g")).toEqual({ kind: "blocked", reason: "spend-cap-reached" });
      expect(runCount(h.store, "g")).toBe(1);
      // Nothing was used, so it is what run a still holds that leaves b without room.
      expect(JSON.parse(String(blockRow(h.store, "g")!.body))).toMatchObject({ capTokens: Ga + Gb - 1, grantTokens: Gb });
      h.store.db.prepare("UPDATE spend_caps SET tokens=? WHERE scope='all' AND period='total'").run(Ga + Gb);
      expect((await deliverScheduledStart(deps, "g")).kind).toBe("claimed");
    } finally { await h.dispose(); }
  });

  it("an estimate waits under a cap", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }, { taskId: "b" }]); try {
      const service = new WebControlService(h.deps);
      const state = () => String(h.store.db.prepare("SELECT state FROM estimates WHERE group_id='g' AND id=?").get(h.estimateId)!.state);
      expect(state()).toBe("queued");
      setCap(h.store, "total", 1);
      expect(await service.claimEstimate("g", h.estimateId)).toBe(null);
      expect(state()).toBe("queued");
      expect(runCount(h.store, "g")).toBe(0);
      expect(JSON.parse(String(blockRow(h.store, "g")!.body))).toMatchObject({ code: "spend-cap-reached", scope: "all", period: "total", capTokens: 1 });
      h.store.db.prepare("DELETE FROM spend_caps").run();
      expect(await service.claimEstimate("g", h.estimateId)).not.toBe(null);
      expect(state()).toBe("running");
      expect(blockRow(h.store, "g")).toBe(undefined);
    } finally { await h.dispose(); }
  });

  it("a clarify or split call waits under a cap", async () => {
    const x = await requirementHarness({ answers: [] }); try {
      const wake = () => Number(x.store.db.prepare("SELECT delivered FROM scheduler_wakes WHERE group_id='r' AND kind='requirement-call'").get()!.delivered);
      setCap(x.store, "total", 1);
      expect(x.store.transaction(() => claimRequirementCallInTransaction(x.store, "r", T0))).toBe("capped");
      await x.deliver();
      expect(wake()).toBe(0);
      expect(runCount(x.store, "r")).toBe(0);
      expect(readRequirementView(x.store, "epoch", "r").spendCapBlock).toMatchObject({ code: "spend-cap-reached", scope: "all", period: "total", capTokens: 1 });
      x.store.db.prepare("DELETE FROM spend_caps").run();
      await x.deliver();
      expect(wake()).toBe(1);
      expect(runCount(x.store, "r")).toBe(1);
      expect(readRequirementView(x.store, "epoch", "r").spendCapBlock).toBe(null);
    } finally { await x.dispose(); }
  });

  it("a cap never aborts a run in progress", async () => {
    const { h, deps } = await started(); try {
      const outcome = await deliverScheduledStart(deps, "g");
      if (outcome.kind !== "claimed") throw new Error(outcome.kind);
      const runRow = () => h.store.db.prepare("SELECT active,body FROM runs WHERE id=?").get(outcome.runId)!;
      const stateBefore = JSON.parse(String(runRow().body)).state;
      setCap(h.store, "total", 1);
      const cumulative = { tokens: 50, activeMs: 1, attempts: 1, sessions: 1 };
      recordUsage(h.store, { runId: outcome.runId, generation: 1, eventSeq: 1, bucket: "work", cumulative, source: { artifactId: `usage-${outcome.runId}`, hash: sha256Canonical({ cumulative }) } });
      expect(Number(h.store.db.prepare("SELECT sum(tokens) AS n FROM usage_ledger WHERE run_id=?").get(outcome.runId)!.n)).toBe(50);
      expect(Number(runRow().active)).toBe(1);
      expect(JSON.parse(String(runRow().body)).state).toBe(stateBefore);
    } finally { await h.dispose(); }
  });
});
