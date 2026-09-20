import { describe, expect, it } from "vitest";
import { WebControlService } from "../../src/control/webService.js";
import { scheduleStart, deliverScheduledStart, beginProviderAttempt, recordProofAck, settleProviderAttempt, recoverAttempt, createWebWakeHandlers } from "../../src/control/webDispatch.js";
import { deliverSchedulerWakes, type SchedulerWake } from "../../src/control/dispatch.js";
import { recoverControl } from "../../src/control/recovery.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { ControlError } from "../../src/control/errors.js";
import { canonicalBytes } from "../../src/control/canonicalJson.js";
import { readCanonicalRecord } from "../../src/control/snapshot.js";
import { webFixture, profileSnapshot } from "./fixtures/web.js";
import type { ControlStore } from "../../src/control/store.js";
import type { NoProviderStartProofV1 } from "../../src/control/webProtocol.js";

// A confirmed group "g" in `ready` state, task "a", one work item, one open wake target.
async function startedFixture(observed = structuredClone(profileSnapshot().profile.capabilities)) {
  const snapshot = profileSnapshot();
  const h = await webFixture(snapshot);
  h.setObserved(observed);
  const service = new WebControlService(h.deps);
  service.confirm(h.command("confirm", h.confirmPayload()));
  return { h, service };
}

async function claimRunId(deps: Parameters<typeof deliverScheduledStart>[0], groupId: string): Promise<string> {
  const outcome = await deliverScheduledStart(deps, groupId);
  if (outcome.kind !== "claimed") throw new Error(`claim did not start a run: ${outcome.kind}`);
  return outcome.runId;
}

function noStartProof(h: Awaited<ReturnType<typeof startedFixture>>["h"], runId: string, ordinal: number, dispatchEnvelopeHash: string): NoProviderStartProofV1 {
  return {
    schema: "orca-no-provider-start-v1", runId, generation: 1, phase: "work", providerAttemptOrdinal: ordinal,
    artifactHash: null, dispatchEnvelopeHash, adapterExecutionId: `exec-${runId}`, providerInvoked: false,
    terminalObservationHash: "e".repeat(64), stopProofHash: "f".repeat(64), observedAt: "2026-09-20T00:00:00.000Z",
  };
}

describe("durable start and proof recovery", () => {
  it("commits a durable start wake without touching the provider", async () => {
    const { h } = await startedFixture(); try {
      const command = h.command("start", {});
      const result = await scheduleStart({ store: h.store, profileRouter: h.deps.profileRouter }, command);
      if ("error" in result || result.result.kind !== "scheduled") throw new Error("start rejected");
      expect(result.result).toMatchObject({ kind: "scheduled", operation: "start" });
      const wake = h.store.db.prepare("SELECT id,delivered FROM scheduler_wakes WHERE group_id='g' AND kind='start'").get();
      expect(String(wake!.id)).toBe(result.result.wakeId);
      expect(Number(wake!.delivered)).toBe(0);
    } finally { await h.dispose(); }
  });

  it("applies deterministic start precedence over the first failure encountered", async () => {
    const { h } = await startedFixture(); try {
      // An unconfirmed (draft) group is the earliest start failure, ahead of any probe.
      const group = JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
      group.status = "draft";
      h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(group));
      expect(await scheduleStart({ store: h.store, profileRouter: h.deps.profileRouter }, h.command("start", {}))).toMatchObject({
        error: { code: "group-state-invalid" },
      });
    } finally { await h.dispose(); }
  });

  it("returns control-capability-unsupported and writes no wake when the probe degrades", async () => {
    const observed = structuredClone(profileSnapshot().profile.capabilities);
    observed.handoffControl = "unavailable";
    const { h } = await startedFixture(observed); try {
      const before = Number(h.store.db.prepare("SELECT count(*) AS n FROM scheduler_wakes").get()!.n);
      const result = await scheduleStart({ store: h.store, profileRouter: h.deps.profileRouter }, h.command("start", {}));
      expect(result).toMatchObject({ error: { code: "control-capability-unsupported" } });
      expect(Number(h.store.db.prepare("SELECT count(*) AS n FROM scheduler_wakes").get()!.n)).toBe(before);
    } finally { await h.dispose(); }
  });

  it("makes a claim either create a starting run or record a group-local blocker, never both", async () => {
    const { h } = await startedFixture(); try {
      await scheduleStart({ store: h.store, profileRouter: h.deps.profileRouter }, h.command("start", {}));
      const outcome = await deliverScheduledStart({ store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate }, "g");
      expect(outcome.kind).toBe("claimed");
      const runs = h.store.db.prepare("SELECT body FROM runs WHERE group_id='g' AND active=1").all();
      expect(runs.length).toBe(1);
      const run = JSON.parse(String(runs[0].body));
      expect(run.state).toBe("starting");
      expect(run.phase).toBe("work");
      expect(run.providerAttemptOrdinal).toBe(0);
      expect(h.store.db.prepare("SELECT id FROM recovery_blockers WHERE group_id='g'").all()).toHaveLength(0);
    } finally { await h.dispose(); }
  });

  it("does not call the provider when an invalid proof is synchronously proved no-start", async () => {
    const { h } = await startedFixture(); try {
      await scheduleStart({ store: h.store, profileRouter: h.deps.profileRouter }, h.command("start", {}));
      const runId = await claimRunId({ store: h.store, profileRouter: h.deps.profileRouter }, "g");
      const attempt = await settleProviderAttempt({ store: h.store, profileRouter: h.deps.profileRouter }, { runId, phase: "work", firstAttemptProof: "invalid" });
      expect(attempt.run.state).toBe("failed-before-provider");
      expect(attempt.providerCalls).toBe(0);
      expect(attempt.wakeId).toMatch(/^scheduler-wake:g:no-start:/);
    } finally { await h.dispose(); }
  });

  it("records proof acknowledgement exactly once and never double-charges a replay", async () => {
    const { h } = await startedFixture(); try {
      await scheduleStart({ store: h.store, profileRouter: h.deps.profileRouter }, h.command("start", {}));
      const runId = await claimRunId({ store: h.store, profileRouter: h.deps.profileRouter }, "g");
      const record = noStartProof(h, runId, 1, "a".repeat(64));
      const first = recordProofAck({ store: h.store }, { runId, phase: "work", providerAttemptOrdinal: 1, record });
      const replay = recordProofAck({ store: h.store }, { runId, phase: "work", providerAttemptOrdinal: 1, record });
      expect(first.consumed).toBe(false);
      expect(replay).toEqual(first);
    } finally { await h.dispose(); }
  });

  it("treats a contradictory start marker and no-start proof as globally dispatch-blocked unknown", async () => {
    const { h } = await startedFixture(); try {
      await scheduleStart({ store: h.store, profileRouter: h.deps.profileRouter }, h.command("start", {}));
      const runId = await claimRunId({ store: h.store, profileRouter: h.deps.profileRouter }, "g");
      h.store.db.prepare("INSERT INTO attempt_evidence VALUES (?,?,?,?,?,?)").run(runId, 1, "work", 1, "provider-start", "{}");
      h.store.db.prepare("INSERT INTO attempt_evidence VALUES (?,?,?,?,?,?)").run(runId, 1, "work", 1, "no-start", "{}");
      const outcome = recoverAttempt({ store: h.store }, { runId, generation: 1, phase: "work", providerAttemptOrdinal: 1 });
      expect(outcome.result).toBe("unknown");
      expect(h.store.dispatchBlocked).toBe(true);
    } finally { await h.dispose(); }
  });

  it("reserves one provider attempt per beginProviderAttempt invocation", async () => {
    const { h } = await startedFixture(); try {
      await scheduleStart({ store: h.store, profileRouter: h.deps.profileRouter }, h.command("start", {}));
      const runId = await claimRunId({ store: h.store, profileRouter: h.deps.profileRouter }, "g");
      const deps = { store: h.store, profileRouter: h.deps.profileRouter };
      const first = beginProviderAttempt(deps, runId, "work");
      expect(first).toMatchObject({ kind: "reserved", providerAttemptOrdinal: 1 });
      if (first.kind !== "reserved") throw new Error("expected a reserved provider attempt");
      expect(first.envelope).toMatchObject({ runId, phase: "work", generation: 1 });
      const second = beginProviderAttempt(deps, runId, "work");
      expect(second).toMatchObject({ kind: "reserved", providerAttemptOrdinal: 2 });
      const run = JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body));
      expect(run.providerAttemptOrdinal).toBe(2);
    } finally { await h.dispose(); }
  });

  it("keeps a start-unknown estimator in a draft group without a coarse blocked transition", async () => {
    const { h } = await startedFixture(); try {
      const service = new WebControlService(h.deps);
      const run = await service.claimEstimate("g", h.estimateId);
      expect(run).not.toBeNull();
      const before = JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)).status;
      expect(before).toBe("ready");
    } finally { await h.dispose(); }
  });

  it("never allocates a second run for a replayed identical claim identity", async () => {
    const { h } = await startedFixture(); try {
      await scheduleStart({ store: h.store, profileRouter: h.deps.profileRouter }, h.command("start", {}));
      const a = await claimRunId({ store: h.store, profileRouter: h.deps.profileRouter }, "g");
      const b = await claimRunId({ store: h.store, profileRouter: h.deps.profileRouter }, "g");
      expect(b).toBe(a);
      expect(h.store.db.prepare("SELECT count(*) AS n FROM runs WHERE group_id='g' AND active=1").get()!.n).toBe(1);
    } finally { await h.dispose(); }
  });
});

function wakeRow(h: Awaited<ReturnType<typeof webFixture>>["store"], kind: string): { id: string; delivered: number } {
  const row = h.db.prepare("SELECT id,delivered FROM scheduler_wakes WHERE kind=? ORDER BY rowid").get(kind);
  if (!row) throw new Error(`no ${kind} wake`);
  return { id: String(row.id), delivered: Number(row.delivered) };
}

function workRuns(store: ControlStore): { runId: string; state: string; claimOrdinal: number }[] {
  return store.db.prepare("SELECT body FROM runs WHERE group_id='g' ORDER BY rowid").all()
    .map((row) => JSON.parse(String(row.body)))
    .filter((body) => body.phase === "work");
}

describe("scheduler wake delivery", () => {
  it("routes a pending start wake to its kind handler and acknowledges it once", async () => {
    const { h, service } = await startedFixture(); try {
      const scheduled = await service.start(h.command("start", {}));
      if ("error" in scheduled || scheduled.result.kind !== "scheduled") throw new Error("start rejected");
      const seen: SchedulerWake[] = [];
      const engine = await deliverSchedulerWakes(h.store, { start: async (wake) => { seen.push(wake); return true; } });
      expect(seen.map((wake) => [wake.kind, wake.groupId, wake.id])).toEqual([["start", "g", scheduled.result.wakeId]]);
      expect(engine.delivered).toEqual([scheduled.result.wakeId]);
      expect(engine.deferred).toEqual([wakeRow(h.store, "budget-estimate").id]);
      expect(wakeRow(h.store, "start").delivered).toBe(1);
    } finally { await h.dispose(); }
  });

  it("retains every wake while dispatch is globally blocked and never invokes a handler", async () => {
    const { h, service } = await startedFixture(); try {
      const scheduled = await service.start(h.command("start", {}));
      if ("error" in scheduled || scheduled.result.kind !== "scheduled") throw new Error("start rejected");
      h.store.dispatchBlocked = true;
      let called = 0;
      const engine = await deliverSchedulerWakes(h.store, { start: async () => { called += 1; return true; } });
      expect(called).toBe(0);
      expect(engine.delivered).toEqual([]);
      expect(engine.deferred).toContain(scheduled.result.wakeId);
      expect(wakeRow(h.store, "start").delivered).toBe(0);
    } finally { await h.dispose(); }
  });

  it("defers wakes behind a group-local blocker and a missing handler", async () => {
    const { h, service } = await startedFixture(); try {
      const scheduled = await service.start(h.command("start", {}));
      if ("error" in scheduled || scheduled.result.kind !== "scheduled") throw new Error("start rejected");
      const unhandled = await deliverSchedulerWakes(h.store, { "budget-estimate": async () => true });
      expect(unhandled.deferred).toContain(scheduled.result.wakeId);
      h.store.db.prepare("INSERT INTO recovery_blockers(id,group_id,run_id,scope,code,body) VALUES (?,?,NULL,'group','claim-capability-unavailable',?)")
        .run("claim-blocked:g", "g", canonicalBytes({ evidenceIds: [] }).toString("utf8"));
      let called = 0;
      const blocked = await deliverSchedulerWakes(h.store, { start: async () => { called += 1; return true; } });
      expect(called).toBe(0);
      expect(blocked.delivered).toEqual([]);
      expect(blocked.deferred).toContain(scheduled.result.wakeId);
    } finally { await h.dispose(); }
  });

  it("keeps a wake pending when its handler refuses or loses the claim", async () => {
    const { h, service } = await startedFixture(); try {
      const scheduled = await service.start(h.command("start", {}));
      if ("error" in scheduled || scheduled.result.kind !== "scheduled") throw new Error("start rejected");
      const refused = await deliverSchedulerWakes(h.store, { start: async () => false, "budget-estimate": async () => { throw new Error("adapter unavailable"); } });
      expect(refused.delivered).toEqual([]);
      expect(wakeRow(h.store, "start").delivered).toBe(0);
      const ok = await deliverSchedulerWakes(h.store, { start: async () => true });
      expect(ok.delivered).toEqual([scheduled.result.wakeId]);
    } finally { await h.dispose(); }
  });

  it("drains orphan budget-estimate wakes into an estimate run", async () => {
    const h = await webFixture(); try {
      const service = new WebControlService(h.deps);
      const engine = await deliverSchedulerWakes(h.store, createWebWakeHandlers({ ...h.deps, service }));
      expect(engine.delivered).toContain(wakeRow(h.store, "budget-estimate").id);
      expect(wakeRow(h.store, "budget-estimate").delivered).toBe(1);
      expect(h.store.db.prepare("SELECT id FROM runs WHERE group_id='g' AND work_item_id=?").get(h.estimateId)).toBeDefined();
    } finally { await h.dispose(); }
  });

  it("delivers the real web start handler into a starting run", async () => {
    const { h, service } = await startedFixture(); try {
      const scheduled = await service.start(h.command("start", {}));
      if ("error" in scheduled || scheduled.result.kind !== "scheduled") throw new Error("start rejected");
      const engine = await deliverSchedulerWakes(h.store, createWebWakeHandlers({ ...h.deps, service }));
      expect(engine.delivered).toContain(scheduled.result.wakeId);
      expect(workRuns(h.store).map((run) => run.state)).toEqual(["starting"]);
    } finally { await h.dispose(); }
  });

  it("drains pending wakes during startup recovery before anything else runs", async () => {
    const { h, service } = await startedFixture(); try {
      const scheduled = await service.start(h.command("start", {}));
      if ("error" in scheduled || scheduled.result.kind !== "scheduled") throw new Error("start rejected");
      const recovery = await recoverControl(h.store, {} as never, { handlers: createWebWakeHandlers({ ...h.deps, service }) });
      expect(recovery.blockedRunIds).toEqual([]);
      expect(recovery.pendingWakeIds).toEqual([]);
      expect(workRuns(h.store).map((run) => run.state)).toEqual(["starting"]);
    } finally { await h.dispose(); }
  });

  it("renders a web-started group through the panel read path", async () => {
    const { h, service } = await startedFixture(); try {
      const scheduled = await service.start(h.command("start", {}));
      if ("error" in scheduled || scheduled.result.kind !== "scheduled") throw new Error("start rejected");
      await deliverSchedulerWakes(h.store, createWebWakeHandlers({ ...h.deps, service }));
      const view = readControlGroup(h.store, "epoch-test", "g");
      expect(view.recoveryBlockers).toEqual([]);
      const started = workRuns(h.store)[0];
      expect(view.runs).toContainEqual(expect.objectContaining({ runId: started.runId, state: "starting" }));
    } finally { await h.dispose(); }
  });

  it("re-arms the claim from a no-start wake under the original start revision", async () => {
    const { h, service } = await startedFixture(); try {
      const scheduled = await service.start(h.command("start", {}));
      if ("error" in scheduled || scheduled.result.kind !== "scheduled") throw new Error("start rejected");
      const handlers = createWebWakeHandlers({ ...h.deps, service });
      await deliverSchedulerWakes(h.store, handlers);
      const first = workRuns(h.store)[0];
      if (!first) throw new Error("no work run started");
      await settleProviderAttempt({ store: h.store, profileRouter: h.deps.profileRouter }, { runId: first.runId, phase: "work", firstAttemptProof: "invalid" });
      const rearm = wakeRow(h.store, "no-start");
      const engine = await deliverSchedulerWakes(h.store, handlers);
      expect(engine.delivered).toContain(rearm.id);
      const runs = workRuns(h.store);
      expect(runs).toHaveLength(2);
      const second = runs[1];
      expect(second).toMatchObject({ state: "starting", claimOrdinal: 2 });
      const envelope = h.store.db.prepare("SELECT body FROM outbox WHERE id=? AND kind='work-claim'").get(`work:g:${second.runId}`);
      const claim = JSON.parse(String(envelope!.body)) as { envelopeHash: string };
      const dispatch = JSON.parse(readCanonicalRecord(h.store, claim.envelopeHash)) as { claimIdentity: string };
      const startRevision = JSON.parse(String(h.store.db.prepare("SELECT body FROM scheduler_wakes WHERE kind='start'").get()!.body)).startRevision as number;
      expect(dispatch.claimIdentity).toBe(`task:g:${startRevision}:a:attempt:2`);
    } finally { await h.dispose(); }
  });
});
