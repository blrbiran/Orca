import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import express from "express";
import { registerControlReadRoutes, verifyControlJsonBody } from "../../src/panel/controlApi.js";
import { WebControlService } from "../../src/control/webService.js";
import {
  readStopIntent,
  groupStopState,
  freezeHandoffDuration,
  deliverHandoffStop,
  beginHandoffAttempt,
  settleHandoffRequest,
} from "../../src/control/stopIntent.js";
import { createWebWakeHandlers, deliverScheduledStart, recordProofAck, settleProviderAttempt } from "../../src/control/webDispatch.js";
import { createExecutionProfileRouter, resolveProfile } from "../../src/control/profiles.js";
import type { ExecutionProfileRouter } from "../../src/control/profiles.js";
import { deliverSchedulerWakes } from "../../src/control/dispatch.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import { readCanonicalRecord } from "../../src/control/snapshot.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";
import type { CapabilityViewV1 } from "../../src/control/webProtocol.js";
import type { ControlStore } from "../../src/control/store.js";

const ACCEPTED_AT = "2026-09-20T10:00:00.000Z";
const MAX_INSTANT = "9999-12-31T23:59:59.999Z";

/** A confirmed group "g" whose only activity is one durable budget estimate. */
async function stopFixture(capabilityPatch: Partial<CapabilityViewV1> = {}, snapshot = profileSnapshot()) {
  const h = await webFixture(snapshot);
  const observed = structuredClone(snapshot.profile.capabilities) as CapabilityViewV1;
  Object.assign(observed, capabilityPatch);
  h.setObserved(observed);
  const clock = { value: new Date(ACCEPTED_AT) };
  const deps = { ...h.deps, now: () => clock.value };
  const service = new WebControlService(deps);
  service.confirm(h.command("confirm", h.confirmPayload()));
  const stopped = (beforeCommit?: () => void) => new WebControlService(beforeCommit ? { ...deps, beforeCommit } : deps);
  return { h, service, clock, deps, stopped };
}

/** Confirmed group with exactly one `starting` task run claimed by the scheduler. */
async function startedFixture() {
  const fixture = await stopFixture();
  const { h, service } = fixture;
  await service.start(h.command("start", {}));
  await deliverScheduledStart({ store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate }, "g");
  return fixture;
}

function workRuns(store: ControlStore): Array<{ runId: string; state: string; phase: string; active: number; providerAttemptOrdinal: number }> {
  return store.db.prepare("SELECT id,active,body FROM runs ORDER BY id").all().map((row) => {
    const body = JSON.parse(String(row.body)) as Record<string, unknown>;
    return {
      runId: String(row.id), state: String(body.state), phase: String(body.phase), active: Number(row.active),
      providerAttemptOrdinal: Number(body.providerAttemptOrdinal),
    };
  });
}

function requests(store: ControlStore): Array<{ requestId: string; runId: string; state: string; deadlineAt: string; phaseAttemptOrdinal: number; failureCode: string | null }> {
  return store.db.prepare("SELECT id,run_id,state,body FROM handoff_requests ORDER BY id").all().map((row) => {
    const body = JSON.parse(String(row.body)) as Record<string, unknown>;
    return {
      requestId: String(row.id), runId: String(row.run_id), state: String(row.state),
      deadlineAt: String(body.deadlineAt), phaseAttemptOrdinal: Number(body.phaseAttemptOrdinal),
      failureCode: (body.failureCode ?? null) as string | null,
    };
  });
}

function joinRows(store: ControlStore): Array<{ requestId: string; desiredRequestId: string; body: Record<string, unknown> }> {
  return store.db.prepare("SELECT request_id,joined_request_id,body FROM handoff_request_joins ORDER BY request_id").all().map((row) => ({
    requestId: String(row.request_id), desiredRequestId: String(row.joined_request_id), body: JSON.parse(String(row.body)) as Record<string, unknown>,
  }));
}

function outboxRows(store: ControlStore, kind: string): Array<{ id: string; delivered: number }> {
  return store.db.prepare("SELECT id,delivered FROM outbox WHERE kind=? ORDER BY id").all(kind)
    .map((row) => ({ id: String(row.id), delivered: Number(row.delivered) }));
}

function seedRequest(store: ControlStore, groupId: string, runId: string, state: string, deadlineAt: string): string {
  const requestId = `context-handoff-seeded-${runId}`;
  const body = { requestId, runId, state, deadlineAt, phaseAttemptOrdinal: 1, failureCode: null, evidenceIds: [] };
  store.db.prepare("INSERT INTO handoff_requests(id,group_id,run_id,state,body) VALUES (?,?,?,?,?)")
    .run(requestId, groupId, runId, state, canonicalBytes(body).toString("utf8"));
  return requestId;
}

function seedIntent(store: ControlStore, groupId: string, mode: string, body: Record<string, unknown>): void {
  const revision = Number(store.db.prepare("SELECT revision FROM groups WHERE id=?").get(groupId)!.revision);
  store.db.prepare("INSERT INTO stop_intents(group_id,mode,revision,body) VALUES (?,?,?,?)")
    .run(groupId, mode, revision, canonicalBytes(body).toString("utf8"));
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!;
  const group = JSON.parse(String(row.body)) as Record<string, unknown>;
  group.stopped = true;
  store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(group), groupId);
}

function setRunState(store: ControlStore, runId: string, patch: Record<string, unknown>): void {
  const body = JSON.parse(String(store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body)) as Record<string, unknown>;
  store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({ ...body, ...patch }), runId);
}

describe("stop command composition", () => {
  it("records a typed pause intent that blocks a pending start claim without touching the wake", async () => {
    const { h, service } = await stopFixture(); try {
      await service.start(h.command("start", {}));
      const result = await service.pauseDispatch(h.command("pause-dispatch", {}));
      expect(result).toMatchObject({ result: { kind: "paused", stopMode: "pause" } });
      expect(readStopIntent(h.store, "g")).toEqual({ mode: "pause", state: "paused", frozenRunIds: [], acceptedAt: null, deadlineAt: null });
      expect(JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)).stopped).toBe(true);
      const drained = await deliverSchedulerWakes(h.store, createWebWakeHandlers({ ...h.deps, service }));
      expect(drained.delivered).toEqual([]);
      expect(workRuns(h.store).filter((run) => run.phase === "work")).toEqual([]);
    } finally { await h.dispose(); }
  });

  it("replays an identical pause command from the ledger without a second mutation", async () => {
    const { h, service } = await stopFixture(); try {
      const command = h.command("pause-dispatch", {});
      const first = await service.pauseDispatch(command);
      const revision = Number(h.store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision);
      const replay = await service.pauseDispatch(command);
      expect(replay).toEqual(first);
      expect(Number(h.store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision)).toBe(revision);
    } finally { await h.dispose(); }
  });

  it("returns stop-already-active for a new pause command id instead of an implicit no-op", async () => {
    const { h, service } = await stopFixture(); try {
      await service.pauseDispatch(h.command("pause-dispatch", {}));
      expect(await service.pauseDispatch(h.command("pause-dispatch", {}))).toMatchObject({ error: { code: "stop-already-active" } });
      expect(h.store.db.prepare("SELECT count(*) AS n FROM stop_intents").get()!.n).toBe(1);
    } finally { await h.dispose(); }
  });

  it("rejects a pause over an existing human handoff or shutdown intent with stop-mode-conflict", async () => {
    const { h, service } = await startedFixture(); try {
      await service.handoffStop(h.command("handoff-stop", {}));
      expect(await service.pauseDispatch(h.command("pause-dispatch", {}))).toMatchObject({ error: { code: "stop-mode-conflict" } });
      h.store.db.prepare("DELETE FROM stop_intents").run();
      seedIntent(h.store, "g", "shutdown", {
        mode: "shutdown", state: "handoff-pending", frozenRunIds: workRuns(h.store).map((run) => run.runId),
        acceptedAt: ACCEPTED_AT, deadlineAt: "2026-09-20T10:30:00.000Z",
      });
      expect(await service.pauseDispatch(h.command("pause-dispatch", {}))).toMatchObject({ error: { code: "stop-mode-conflict" } });
      expect(String(h.store.db.prepare("SELECT mode FROM stop_intents WHERE group_id='g'").get()!.mode)).toBe("shutdown");
    } finally { await h.dispose(); }
  });

  it("strengthens an existing pause into a handoff-stop in one transaction", async () => {
    const { h, service } = await startedFixture(); try {
      const runId = workRuns(h.store).find((run) => run.phase === "work")!.runId;
      await service.pauseDispatch(h.command("pause-dispatch", {}));
      const result = await service.handoffStop(h.command("handoff-stop", {}));
      if ("error" in result || result.result.kind !== "handoff-stopped") throw new Error("handoff-stop rejected");
      expect(readStopIntent(h.store, "g")).toMatchObject({ mode: "handoff", state: "handoff-pending", frozenRunIds: [runId], acceptedAt: ACCEPTED_AT });
      expect(h.store.db.prepare("SELECT count(*) AS n FROM stop_intents WHERE group_id='g'").get()!.n).toBe(1);
      expect(requests(h.store).map((request) => request.runId)).toEqual([runId]);
    } finally { await h.dispose(); }
  });

  it("returns stop-already-active for a second human handoff-stop", async () => {
    const { h, service } = await startedFixture(); try {
      const first = await service.handoffStop(h.command("handoff-stop", {}));
      expect(first).toMatchObject({ result: { kind: "handoff-stopped" } });
      expect(await service.handoffStop(h.command("handoff-stop", {}))).toMatchObject({ error: { code: "stop-already-active" } });
    } finally { await h.dispose(); }
  });

  it("never replaces an unresolved or completed-but-uncleared shutdown deadline and frozen set", async () => {
    const { h, service } = await startedFixture(); try {
      const runId = workRuns(h.store).find((run) => run.phase === "work")!.runId;
      const original = { mode: "shutdown", state: "handoff-pending", frozenRunIds: [runId], acceptedAt: "2026-09-20T09:00:00.000Z", deadlineAt: "2026-09-20T09:05:00.000Z" };
      h.store.db.prepare("DELETE FROM stop_intents").run();
      seedIntent(h.store, "g", "shutdown", original);
      const before = readStopIntent(h.store, "g")!;
      expect(await service.handoffStop(h.command("handoff-stop", {}))).toMatchObject({ error: { code: "stop-mode-conflict" } });
      expect(readStopIntent(h.store, "g")).toEqual(before);
      h.store.db.prepare("UPDATE stop_intents SET body=? WHERE group_id=?")
        .run(canonicalBytes({ ...original, state: "handoff-complete" }).toString("utf8"), "g");
      expect(await service.handoffStop(h.command("handoff-stop", {}))).toMatchObject({ error: { code: "stop-mode-conflict" } });
      expect(readStopIntent(h.store, "g")!.deadlineAt).toBe("2026-09-20T09:05:00.000Z");
    } finally { await h.dispose(); }
  });

  it("clears only a pause with resume-dispatch and rejects a handoff intent", async () => {
    const { h, service } = await stopFixture(); try {
      await service.start(h.command("start", {}));
      await service.pauseDispatch(h.command("pause-dispatch", {}));
      const resumed = await service.resumeDispatch(h.command("resume-dispatch", {}));
      expect(resumed).toMatchObject({ result: { kind: "scheduled", operation: "resume-dispatch" } });
      expect(readStopIntent(h.store, "g")).toBeNull();
      expect(JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)).stopped).toBe(false);
      await deliverSchedulerWakes(h.store, createWebWakeHandlers({ ...h.deps, service }));
      expect(workRuns(h.store).filter((run) => run.phase === "work")).toHaveLength(1);
      await service.handoffStop(h.command("handoff-stop", {}));
      expect(await service.resumeDispatch(h.command("resume-dispatch", {}))).toMatchObject({ error: { code: "stop-mode-conflict" } });
      expect(readStopIntent(h.store, "g")!.mode).toBe("handoff");
    } finally { await h.dispose(); }
  });
});

describe("handoff-stop atomicity", () => {
  it("leaves no latch, request, or outbox row when the transaction is interrupted before commit", async () => {
    const { h, service } = await startedFixture(); try {
      const runId = workRuns(h.store).find((run) => run.phase === "work")!.runId;
      const before = JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)).stopped;
      const crashing = new WebControlService({ ...h.deps, now: () => new Date(ACCEPTED_AT), beforeCommit: () => { throw new Error("crash-before-commit"); } });
      await expect(crashing.handoffStop(h.command("handoff-stop", {}))).rejects.toThrow("crash-before-commit");
      expect(readStopIntent(h.store, "g")).toBeNull();
      expect(requests(h.store)).toEqual([]);
      expect(outboxRows(h.store, "handoff-request")).toEqual([]);
      expect(JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)).stopped).toBe(before);
      const result = await service.handoffStop(h.command("handoff-stop", {}));
      if ("error" in result || result.result.kind !== "handoff-stopped") throw new Error("handoff-stop rejected");
      expect(readStopIntent(h.store, "g")!.frozenRunIds).toEqual(result.result.frozenRunIds);
      expect(result.result.frozenRunIds).toEqual([runId]);
    } finally { await h.dispose(); }
  });

  it("freezes every active run and commits one deterministic request identity per frozen run", async () => {
    const { h, service } = await startedFixture(); try {
      const workRun = workRuns(h.store).find((run) => run.phase === "work")!;
      setRunState(h.store, workRun.runId, { state: "accepted", providerAttemptOrdinal: 1 });
      const estimateRun = await service.claimEstimate("g", h.estimateId);
      const frozen = [workRun.runId, String((estimateRun as { runId: string }).runId)].sort();
      const result = await service.handoffStop(h.command("handoff-stop", {}));
      if ("error" in result || result.result.kind !== "handoff-stopped") throw new Error("handoff-stop rejected");
      const stopRevision = result.result.stopRevision;
      expect(result.result.frozenRunIds).toEqual(frozen);
      expect(result.result.requestIds).toHaveLength(frozen.length);
      expect(requests(h.store).map((request) => request.runId).sort()).toEqual(frozen);
      expect(requests(h.store).map((request) => request.requestId).sort()).toEqual([...result.result.requestIds].sort());
      const desired = outboxRows(h.store, "handoff-request").map((row) => row.id).sort();
      expect(desired).toEqual(frozen.map((runId) => `handoff-stop:g:${stopRevision}:${runId}`).sort());
      expect(outboxRows(h.store, "handoff-request").every((row) => row.delivered === 0)).toBe(true);
      expect(readStopIntent(h.store, "g")!.state).toBe("handoff-pending");
    } finally { await h.dispose(); }
  });

  it("replays the persisted latch after response loss without recomputing the deadline", async () => {
    const { h, service } = await startedFixture(); try {
      const command = h.command("handoff-stop", {});
      const first = await service.handoffStop(command);
      const second = await service.handoffStop(command);
      expect(second).toEqual(first);
      expect(requests(h.store)).toHaveLength(1);
      expect(outboxRows(h.store, "handoff-request")).toHaveLength(1);
    } finally { await h.dispose(); }
  });
});

describe("frozen-set resolution", () => {
  it("freezes starting, accepted and attempt-unknown runs but never a terminal failed-before-provider run", async () => {
    const { h, service } = await startedFixture(); try {
      const starting = workRuns(h.store).find((run) => run.phase === "work")!;
      await settleProviderAttempt({ store: h.store, profileRouter: h.deps.profileRouter }, { runId: starting.runId, phase: "work", firstAttemptProof: "invalid" });
      const failedRunId = starting.runId;
      await deliverSchedulerWakes(h.store, createWebWakeHandlers({ ...h.deps, service }));
      const restarted = workRuns(h.store).find((run) => run.phase === "work" && run.runId !== failedRunId)!;
      setRunState(h.store, restarted.runId, { state: "attempt-unknown" });
      const result = await service.handoffStop(h.command("handoff-stop", {}));
      if ("error" in result || result.result.kind !== "handoff-stopped") throw new Error("handoff-stop rejected");
      // Draining the re-arm also delivered the group's estimate wake, so that in-flight
      // estimate run is frozen too; this test is about the work-phase set.
      const phases = new Map(workRuns(h.store).map((run) => [run.runId, run.phase]));
      expect(result.result.frozenRunIds.filter((id) => phases.get(id) === "work")).toEqual([restarted.runId]);
      expect(result.result.frozenRunIds).not.toContain(failedRunId);
    } finally { await h.dispose(); }
  });

  it("reaches handoff-complete vacuously when the frozen set is empty", async () => {
    const { h, service } = await stopFixture(); try {
      const result = await service.handoffStop(h.command("handoff-stop", {}));
      if ("error" in result || result.result.kind !== "handoff-stopped") throw new Error("handoff-stop rejected");
      expect(result.result.frozenRunIds).toEqual([]);
      expect(result.result.requestIds).toEqual([]);
      expect(groupStopState(h.store, "g")).toBe("handoff-complete");
      expect(requests(h.store)).toEqual([]);
    } finally { await h.dispose(); }
  });

  it("always includes a start-unknown estimate so the frozen set cannot be vacuously complete", async () => {
    const { h, service } = await stopFixture(); try {
      const estimateRun = await service.claimEstimate("g", h.estimateId);
      h.store.db.prepare("UPDATE estimates SET state='start-unknown' WHERE group_id='g' AND id=?").run(h.estimateId);
      const result = await service.handoffStop(h.command("handoff-stop", {}));
      if ("error" in result || result.result.kind !== "handoff-stopped") throw new Error("handoff-stop rejected");
      expect(result.result.frozenRunIds).toEqual([String((estimateRun as { runId: string }).runId)]);
      expect(groupStopState(h.store, "g")).toBe("handoff-pending");
      expect(requests(h.store).map((request) => request.state)).toEqual(["request-pending"]);
    } finally { await h.dispose(); }
  });
});

describe("one open handoff request per run and generation", () => {
  it("adopts a run's existing open context request with a deterministic join and no second outbox", async () => {
    const { h, service } = await startedFixture(); try {
      const runId = workRuns(h.store).find((run) => run.phase === "work")!.runId;
      const existing = seedRequest(h.store, "g", runId, "request-pending", "2026-09-20T11:00:00.000Z");
      const result = await service.handoffStop(h.command("handoff-stop", {}));
      if ("error" in result || result.result.kind !== "handoff-stopped") throw new Error("handoff-stop rejected");
      expect(result.result.requestIds).toEqual([existing]);
      expect(requests(h.store).map((request) => request.requestId)).toEqual([existing]);
      const joins = joinRows(h.store);
      const desired = `handoff-stop:g:${result.result.stopRevision}:${runId}`;
      expect(joins).toHaveLength(1);
      expect(joins[0]).toMatchObject({ requestId: existing, desiredRequestId: desired });
      expect(joins[0].body).toMatchObject({ schema: "orca-handoff-join-v1", joinId: `handoff-join:${desired}:${existing}`, runId, generation: 1, origin: "handoff" });
      expect(outboxRows(h.store, "handoff-request").map((row) => row.id)).toEqual([]);
    } finally { await h.dispose(); }
  });

  it("shortens the adopted request to the earlier effective deadline and never extends it", async () => {
    const { h, service, clock } = await startedFixture(); try {
      const runId = workRuns(h.store).find((run) => run.phase === "work")!.runId;
      const existing = seedRequest(h.store, "g", runId, "request-pending", "2026-09-20T10:10:00.000Z");
      const result = await service.handoffStop(h.command("handoff-stop", { handoffDeadlineAt: "2026-09-20T12:00:00.000Z" }));
      if ("error" in result || result.result.kind !== "handoff-stopped") throw new Error("handoff-stop rejected");
      expect(requests(h.store).find((request) => request.requestId === existing)!.deadlineAt).toBe("2026-09-20T10:10:00.000Z");
      expect(readStopIntent(h.store, "g")!.deadlineAt).toBe("2026-09-20T12:00:00.000Z");
      clock.value = new Date("2026-09-20T10:20:00.000Z");
      const later = await service.handoffStop(h.command("handoff-stop", { handoffDeadlineAt: "2026-09-20T13:00:00.000Z" }));
      expect(later).toMatchObject({ error: { code: "stop-already-active" } });
      expect(requests(h.store).find((request) => request.requestId === existing)!.deadlineAt).toBe("2026-09-20T10:10:00.000Z");
    } finally { await h.dispose(); }
  });

  // Handoff delivery (human ruling 2026-09-25, spec §12: this slice may rewrite criteria; ruling 88 (b)(c)): spec §13.1 C-5 --
  // an active run whose only request already settled is recorded as a run-scope recovery blocker (Web spec §6.2) and the
  // stop is not refused as a whole; the run still never gets a second request.
  it("treats an active run whose only request already settled as a recovery blocker, not as permission for a second request", async () => {
    const { h, service } = await startedFixture(); try {
      const runId = workRuns(h.store).find((run) => run.phase === "work")!.runId;
      const existing = seedRequest(h.store, "g", runId, "settled-recoverable", "2026-09-20T11:00:00.000Z");
      const result = await service.handoffStop(h.command("handoff-stop", {}));
      if ("error" in result || result.result.kind !== "handoff-stopped") throw new Error(`handoff-stop refused: ${JSON.stringify(result)}`);
      expect(result.result.requestIds).toEqual([existing]);
      expect(requests(h.store).map((request) => request.requestId)).toEqual([existing]);
      expect(h.store.db.prepare("SELECT run_id,scope,code FROM recovery_blockers WHERE group_id='g'").all().map((row) => ({ ...row })))
        .toEqual([{ run_id: runId, scope: "run", code: "handoff-request-already-settled" }]);
      expect(readStopIntent(h.store, "g")).toMatchObject({ mode: "handoff", frozenRunIds: [runId] });
    } finally { await h.dispose(); }
  });

  // Handoff delivery Task 4 (controller ruling on Task 3's open question, 2026-09-25; Web spec §6.2): an active run
  // whose latest request already settled is a contradiction, so the group is not handoff-complete while it lasts.
  it("keeps the group handoff-unresolved while an active run's only request is already settled", async () => {
    const { h, service } = await startedFixture(); try {
      const runId = workRuns(h.store).find((run) => run.phase === "work")!.runId;
      seedRequest(h.store, "g", runId, "settled-recoverable", "2026-09-20T11:00:00.000Z");
      const result = await service.handoffStop(h.command("handoff-stop", {}));
      if ("error" in result || result.result.kind !== "handoff-stopped") throw new Error(`handoff-stop refused: ${JSON.stringify(result)}`);
      expect(Number(h.store.db.prepare("SELECT active FROM runs WHERE id=?").get(runId)!.active)).toBe(1);
      expect(readStopIntent(h.store, "g")!.state).toBe("handoff-unresolved");
      expect(groupStopState(h.store, "g")).toBe("handoff-unresolved");
    } finally { await h.dispose(); }
  });
});

describe("handoff deadline clocks", () => {
  it("expands an omitted deadline to acceptedAt plus thirty minutes and pins the absolute instant", async () => {
    const { h, service, clock } = await startedFixture(); try {
      const result = await service.handoffStop(h.command("handoff-stop", {}));
      if ("error" in result || result.result.kind !== "handoff-stopped") throw new Error("handoff-stop rejected");
      expect(result.result).toMatchObject({ acceptedAt: ACCEPTED_AT, handoffDeadlineAt: "2026-09-20T10:30:00.000Z" });
      expect(readStopIntent(h.store, "g")).toMatchObject({ acceptedAt: ACCEPTED_AT, deadlineAt: "2026-09-20T10:30:00.000Z" });
      clock.value = new Date("2026-09-20T09:00:00.000Z");
      expect(readStopIntent(h.store, "g")!.deadlineAt).toBe("2026-09-20T10:30:00.000Z");
      expect(freezeHandoffDuration(result.result.acceptedAt, result.result.handoffDeadlineAt)).toBe(30 * 60_000);
    } finally { await h.dispose(); }
  });

  it("saturates an omitted deadline at the maximum protocol instant and shortens the monotonic duration", async () => {
    const { h, service, clock } = await startedFixture(); try {
      clock.value = new Date("9999-12-31T23:59:00.000Z");
      const result = await service.handoffStop(h.command("handoff-stop", {}));
      if ("error" in result || result.result.kind !== "handoff-stopped") throw new Error("handoff-stop rejected");
      expect(result.result).toMatchObject({ acceptedAt: "9999-12-31T23:59:00.000Z", handoffDeadlineAt: MAX_INSTANT });
      expect(freezeHandoffDuration(result.result.acceptedAt, result.result.handoffDeadlineAt)).toBe(59_999);
      expect(freezeHandoffDuration(ACCEPTED_AT, ACCEPTED_AT)).toBe(0);
      expect(freezeHandoffDuration(ACCEPTED_AT, "2026-09-20T09:00:00.000Z")).toBe(0);
    } finally { await h.dispose(); }
  });

  it("keeps a supplied past deadline verbatim so it expires immediately", async () => {
    const { h, service } = await startedFixture(); try {
      const result = await service.handoffStop(h.command("handoff-stop", { handoffDeadlineAt: "2020-01-01T00:00:00.000Z" }));
      if ("error" in result || result.result.kind !== "handoff-stopped") throw new Error("handoff-stop rejected");
      expect(result.result.handoffDeadlineAt).toBe("2020-01-01T00:00:00.000Z");
      expect(readStopIntent(h.store, "g")!.deadlineAt).toBe("2020-01-01T00:00:00.000Z");
      expect(freezeHandoffDuration(result.result.acceptedAt, result.result.handoffDeadlineAt)).toBe(0);
      expect(groupStopState(h.store, "g")).toBe("handoff-pending");
    } finally { await h.dispose(); }
  });

  it("keeps the absolute wall deadline independent of the run's remaining active-time budget", async () => {
    const { h, service } = await startedFixture(); try {
      const runId = workRuns(h.store).find((run) => run.phase === "work")!.runId;
      const before = JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body)).remaining as { work: { activeMs: number } };
      const result = await service.handoffStop(h.command("handoff-stop", {}));
      if ("error" in result || result.result.kind !== "handoff-stopped") throw new Error("handoff-stop rejected");
      expect(JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body)).remaining).toEqual(before);
      expect(before.work.activeMs).toBeGreaterThan(0);
      expect(requests(h.store)[0].deadlineAt).toBe("2026-09-20T10:30:00.000Z");
      expect(Date.parse(result.result.handoffDeadlineAt) - Date.parse(result.result.acceptedAt)).toBe(30 * 60_000);
      settleHandoffRequest(depsOf(h), { requestId: requests(h.store)[0].requestId, outcome: "outcome-unknown" });
      expect(JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body)).remaining.work.activeMs).toBe(before.work.activeMs);
    } finally { await h.dispose(); }
  });
});

describe("group stop state derivation", () => {
  it("derives handoff-unresolved ahead of every other pending disposition", async () => {
    const { h, service } = await startedFixture(); try {
      await service.handoffStop(h.command("handoff-stop", {}));
      expect(groupStopState(h.store, "g")).toBe("handoff-pending");
      settleHandoffRequest(depsOf(h), { requestId: requests(h.store)[0].requestId, outcome: "outcome-unknown" });
      expect(groupStopState(h.store, "g")).toBe("handoff-unresolved");
      expect(readStopIntent(h.store, "g")!.state).toBe("handoff-unresolved");
    } finally { await h.dispose(); }
  });

  it("keeps handoff-pending while any frozen run is in flight and falls to handoff-partial only when none is", async () => {
    const { h, service } = await startedFixture(); try {
      await service.claimEstimate("g", h.estimateId);
      await service.handoffStop(h.command("handoff-stop", {}));
      const [first, second] = requests(h.store);
      settleHandoffRequest(depsOf(h), { requestId: first.requestId, outcome: "settled-unrecoverable", reasonCode: "profile-changed" });
      expect(groupStopState(h.store, "g")).toBe("handoff-pending");
      settleHandoffRequest(depsOf(h), { requestId: second.requestId, outcome: "settled-unrecoverable", reasonCode: "identity-space-exhausted" });
      expect(groupStopState(h.store, "g")).toBe("handoff-partial");
      expect(readStopIntent(h.store, "g")!.state).toBe("handoff-partial");
    } finally { await h.dispose(); }
  });

  it("derives handoff-complete only when every frozen run settled recoverably or restartably", async () => {
    const { h, service } = await stopFixture(); try {
      const estimateRun = await service.claimEstimate("g", h.estimateId);
      const runId = String((estimateRun as { runId: string }).runId);
      await service.handoffStop(h.command("handoff-stop", {}));
      const reservedBefore = JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)).reserved;
      const requestId = requests(h.store)[0].requestId;
      settleHandoffRequest({ store: h.store, profileRouter: h.deps.profileRouter }, { requestId, outcome: "settled-restartable" });
      expect(groupStopState(h.store, "g")).toBe("handoff-complete");
      expect(workRuns(h.store).find((run) => run.runId === runId)).toMatchObject({ state: "settled-restartable", active: 0 });
      expect(String(h.store.db.prepare("SELECT state FROM estimates WHERE group_id='g' AND id=?").get(h.estimateId)!.state)).toBe("interrupted");
      const reservedAfter = JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)).reserved;
      expect(reservedAfter.tokens).toBeLessThan(reservedBefore.tokens);
    } finally { await h.dispose(); }
  });

  it("holds the reserve and never renders an unknown stop as a successful handoff", async () => {
    const { h, service } = await stopFixture(); try {
      const estimateRun = await service.claimEstimate("g", h.estimateId);
      const runId = String((estimateRun as { runId: string }).runId);
      await service.handoffStop(h.command("handoff-stop", {}));
      const requestId = requests(h.store)[0].requestId;
      setRunState(h.store, runId, { unknown: { work: true, handoff: true } });
      settleHandoffRequest(depsOf(h), { requestId, outcome: "outcome-unknown" });
      const reserved = JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)).reserved;
      const runBody = JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body));
      expect(reserved.tokens).toBeGreaterThan(0);
      expect(groupStopState(h.store, "g")).toBe("handoff-unresolved");
      expect(workRuns(h.store).find((run) => run.runId === runId)!.state).not.toBe("settled-restartable");
      const view = readControlGroup(h.store, "epoch-test", "g");
      expect(view.stop).toMatchObject({ state: "handoff-unresolved" });
      expect(view.runs.find((run) => run.runId === runId)!.state).toBe(String(runBody.state));
      expect(view.recoveryBlockers).toEqual([]);
    } finally { await h.dispose(); }
  });
});


describe("handoff stop delivery", () => {
  it("latches a mechanical in-run handoff without charging any provider attempt or session", async () => {
    const { h, service } = await startedFixture(); try {
      const runId = workRuns(h.store).find((run) => run.phase === "work")!.runId;
      await service.handoffStop(h.command("handoff-stop", {}));
      const requestId = requests(h.store)[0].requestId;
      const deps = { store: h.store, profileRouter: h.deps.profileRouter };
      expect(deliverHandoffStop(deps, "g")).toEqual([{ requestId, runId, state: "latched" }]);
      expect(requests(h.store)[0]).toMatchObject({ requestId, state: "latched", phaseAttemptOrdinal: 1 });
      expect(workRuns(h.store).find((run) => run.runId === runId)!.providerAttemptOrdinal).toBe(0);
      expect(outboxRows(h.store, "handoff-attempt")).toEqual([]);
      expect(h.store.db.prepare("SELECT count(*) AS n FROM attempt_evidence WHERE phase='handoff'").get()!.n).toBe(0);
      expect(groupStopState(h.store, "g")).toBe("handoff-pending");
    } finally { await h.dispose(); }
  });

  it("re-delivers a lost handoff outbox under the same deterministic identity with no duplicate request", async () => {
    const { h, service } = await startedFixture(); try {
      const runId = workRuns(h.store).find((run) => run.phase === "work")!.runId;
      await service.handoffStop(h.command("handoff-stop", {}));
      const requestId = requests(h.store)[0].requestId;
      const stopRevision = Number(h.store.db.prepare("SELECT revision FROM stop_intents WHERE group_id='g'").get()!.revision);
      const deps = { store: h.store, profileRouter: h.deps.profileRouter };
      const delivered = [{ requestId, runId, state: "latched" }];
      expect(deliverHandoffStop(deps, "g")).toEqual(delivered);
      h.store.db.prepare("UPDATE outbox SET delivered=0 WHERE kind='handoff-request'").run();
      expect(deliverHandoffStop(deps, "g")).toEqual(delivered);
      expect(requests(h.store).map((request) => request.requestId)).toEqual([requestId]);
      expect(outboxRows(h.store, "handoff-request")).toEqual([{ id: `handoff-stop:g:${stopRevision}:${runId}`, delivered: 1 }]);
    } finally { await h.dispose(); }
  });

  it("settles an interrupted estimator as restartable and returns only its known unused commitment", async () => {
    const { h, service } = await stopFixture(); try {
      const estimateRun = await service.claimEstimate("g", h.estimateId);
      const runId = String((estimateRun as { runId: string }).runId);
      await service.handoffStop(h.command("handoff-stop", {}));
      const deps = { store: h.store, profileRouter: h.deps.profileRouter };
      deliverHandoffStop(deps, "g");
      settleHandoffRequest(deps, { requestId: requests(h.store)[0].requestId, outcome: "settled-restartable" });
      expect(String(h.store.db.prepare("SELECT state FROM estimates WHERE group_id='g' AND id=?").get(h.estimateId)!.state)).toBe("interrupted");
      expect(workRuns(h.store).find((run) => run.runId === runId)).toMatchObject({ state: "settled-restartable", active: 0 });
      expect(groupStopState(h.store, "g")).toBe("handoff-complete");
    } finally { await h.dispose(); }
  });

  it("leaves an estimator with unknown usage unresolved with its reserve held", async () => {
    const { h, service } = await stopFixture(); try {
      const estimateRun = await service.claimEstimate("g", h.estimateId);
      const runId = String((estimateRun as { runId: string }).runId);
      await service.handoffStop(h.command("handoff-stop", {}));
      const reservedBefore = JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)).reserved;
      setRunState(h.store, runId, { unknown: { work: true, handoff: true } });
      settleHandoffRequest(depsOf(h), { requestId: requests(h.store)[0].requestId, outcome: "outcome-unknown" });
      expect(JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)).reserved).toEqual(reservedBefore);
      expect(String(h.store.db.prepare("SELECT state FROM estimates WHERE group_id='g' AND id=?").get(h.estimateId)!.state)).toBe("running");
      expect(workRuns(h.store).find((run) => run.runId === runId)).toMatchObject({ active: 1 });
      expect(groupStopState(h.store, "g")).toBe("handoff-unresolved");
    } finally { await h.dispose(); }
  });
});

describe("model-assisted handoff attempts", () => {
  it("reserves one attempt plus one handoff session under the request attempt identity", async () => {
    const { h, service } = await modelAssistedFixture(); try {
      const runId = workRuns(h.store).find((run) => run.phase === "work")!.runId;
      const requestId = requests(h.store)[0].requestId;
      const deps = { store: h.store, profileRouter: h.deps.profileRouter };
      expect(await beginHandoffAttempt(deps, requestId)).toMatchObject({ kind: "reserved", phaseAttemptOrdinal: 1 });
      const row = outboxRow(h.store, `handoff-attempt:${requestId}:1`);
      expect(JSON.parse(String(row.body))).toMatchObject({ requestId, runId, phase: "handoff", sessionReservation: 1, attemptReservation: 1 });
      const envelope = handoffEnvelope(h.store, requestId, 1);
      expect(envelope).toMatchObject({ schema: "orca-dispatch-envelope-v1", phase: "handoff", runId, generation: 1, claimIdentity: `${requestId}:attempt:1`, profiles: { estimator: null, worker: null, handoff: expect.objectContaining({ profileId: "all" }) } });
      expect(requests(h.store)[0]).toMatchObject({ requestId, state: "request-pending", phaseAttemptOrdinal: 1 });
      expect(workRuns(h.store).find((run) => run.runId === runId)!.providerAttemptOrdinal).toBe(1);
    } finally { await h.dispose(); }
  });

  it("charges only the attempt once a prior handoff provider marker exists", async () => {
    const { h, service } = await modelAssistedFixture(); try {
      const runId = workRuns(h.store).find((run) => run.phase === "work")!.runId;
      const requestId = requests(h.store)[0].requestId;
      const deps = { store: h.store, profileRouter: h.deps.profileRouter };
      const first = await beginHandoffAttempt(deps, requestId);
      if (first.kind !== "reserved") throw new Error("first handoff attempt was not reserved");
      recordProofAck({ store: h.store }, { runId, phase: "handoff", providerAttemptOrdinal: 1, record: {
        schema: "orca-provider-start-v1", runId, generation: 1, phase: "handoff", artifactHash: null,
        dispatchEnvelopeHash: sha256Canonical(first.envelope), providerAttemptOrdinal: 1, startedAt: ACCEPTED_AT,
      } });
      const second = await beginHandoffAttempt(deps, requestId);
      expect(second).toMatchObject({ kind: "reserved", phaseAttemptOrdinal: 2 });
      expect(JSON.parse(String(outboxRow(h.store, `handoff-attempt:${requestId}:2`).body))).toMatchObject({ sessionReservation: 0, attemptReservation: 1 });
    } finally { await h.dispose(); }
  });

  it("makes a pre-attempt capability failure retryable with no attempt, session, or ordinal change", async () => {
    const { h, service } = await modelAssistedFixture(); try {
      const runId = workRuns(h.store).find((run) => run.phase === "work")!.runId;
      const requestId = requests(h.store)[0].requestId;
      const deps = { store: h.store, profileRouter: h.deps.profileRouter };
      expect(await beginHandoffAttempt(deps, requestId)).toMatchObject({ kind: "reserved" });
      h.setObserved({ ...structuredClone(profileSnapshot().profile.capabilities), handoffExecution: "model-assisted-v1", handoffControl: "phase-end" } as CapabilityViewV1);
      expect(await beginHandoffAttempt(deps, requestId)).toMatchObject({ kind: "capability-unavailable", reasonCode: "handoff-capability-unavailable" });
      expect(requests(h.store)[0]).toMatchObject({ state: "request-pending", phaseAttemptOrdinal: 1, failureCode: "handoff-capability-unavailable" });
      expect(outboxRows(h.store, "handoff-attempt").map((row) => row.id)).toEqual([`handoff-attempt:${requestId}:1`]);
      expect(workRuns(h.store).find((run) => run.runId === runId)!.providerAttemptOrdinal).toBe(1);
    } finally { await h.dispose(); }
  });

  it("settles the request unrecoverably when the frozen handoff profile disappears", async () => {
    const { h, service } = await modelAssistedFixture(); try {
      const requestId = requests(h.store)[0].requestId;
      const foreign = structuredClone(profileSnapshot());
      foreign.profile.capabilities.handoffExecution = "model-assisted-v1";
      foreign.resolved.adapterImplementationHash = "e".repeat(64);
      const router = createExecutionProfileRouter([resolveProfile(foreign)]);
      expect(await beginHandoffAttempt({ store: h.store, profileRouter: router }, requestId))
        .toMatchObject({ kind: "settled-unrecoverable", reasonCode: "profile-changed" });
      expect(requests(h.store)[0]).toMatchObject({ state: "settled-unrecoverable", failureCode: "profile-changed" });
      expect(groupStopState(h.store, "g")).toBe("handoff-partial");
    } finally { await h.dispose(); }
  });

  it("makes a lost proof acknowledgement outcome-unknown and closed to a further attempt", async () => {
    const { h, service } = await modelAssistedFixture(); try {
      const requestId = requests(h.store)[0].requestId;
      const deps = { store: h.store, profileRouter: h.deps.profileRouter };
      await beginHandoffAttempt(deps, requestId);
      settleHandoffRequest(deps, { requestId, outcome: "outcome-unknown" });
      expect(requests(h.store)[0].state).toBe("outcome-unknown");
      expect(groupStopState(h.store, "g")).toBe("handoff-unresolved");
      expect(await beginHandoffAttempt(deps, requestId)).toMatchObject({ kind: "closed", state: "outcome-unknown" });
      expect(outboxRows(h.store, "handoff-attempt").map((row) => row.id)).toEqual([`handoff-attempt:${requestId}:1`]);
    } finally { await h.dispose(); }
  });

  it("requeues the same deterministic request under run-scoped recovery and increments the next ordinal", async () => {
    const { h, service } = await modelAssistedFixture(); try {
      const runId = workRuns(h.store).find((run) => run.phase === "work")!.runId;
      const requestId = requests(h.store)[0].requestId;
      const deps = { store: h.store, profileRouter: h.deps.profileRouter };
      await beginHandoffAttempt(deps, requestId);
      settleHandoffRequest(deps, { requestId, outcome: "outcome-unknown" });
      const command = h.runCommand("recovery-retry", runId, { scope: "run", runId });
      const retry = await service.recoveryRetry(command);
      expect(retry).toMatchObject({ result: { kind: "recovery-observed", resolved: true } });
      expect(hasDurableIdentity(h.store, `handoff-recovery:${requestId}:${command.commandId}`)).toBe(true);
      expect(requests(h.store)[0]).toMatchObject({ state: "request-pending", failureCode: null });
      expect(await beginHandoffAttempt(deps, requestId)).toMatchObject({ kind: "reserved", phaseAttemptOrdinal: 2 });
    } finally { await h.dispose(); }
  });

  it("settles unrecoverable with identity-space-exhausted when the phase ordinal overflows", async () => {
    const { h, service } = await modelAssistedFixture(); try {
      const requestId = requests(h.store)[0].requestId;
      setRequestOrdinal(h.store, requestId, Number.MAX_SAFE_INTEGER);
      expect(await beginHandoffAttempt({ store: h.store, profileRouter: h.deps.profileRouter }, requestId))
        .toMatchObject({ kind: "settled-unrecoverable", reasonCode: "identity-space-exhausted" });
      expect(requests(h.store)[0]).toMatchObject({ state: "settled-unrecoverable", failureCode: "identity-space-exhausted" });
    } finally { await h.dispose(); }
  });
});

describe("stop and continuation mutation routes", () => {
  /** The confirmed group served over a real HTTP stack, the way the Panel mounts it. */
  async function serveRoutes() {
    const { h, service } = await stopFixture();
    const app = express();
    app.use(express.json({ verify: verifyControlJsonBody }));
    registerControlReadRoutes(app, { store: h.store, epoch: "epoch", config: { readView: async () => ({}) } as never, service });
    const server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("address");
    const revision = () => Number(h.store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision);
    const post = async (path: string, body: unknown) => {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/control${path}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() as Record<string, unknown> };
    };
    const lookup = async (groupId: string, commandId: string) =>
      await (await fetch(`http://127.0.0.1:${address.port}/api/control/groups/${groupId}/commands/${commandId}`)).json() as Record<string, unknown>;
    return { h, post, lookup, revision, close: async () => { await new Promise<void>(resolve => server.close(() => resolve())); await h.dispose(); } };
  }

  it("serves every stop, continuation, and recovery verb with its durable replay identity", async () => {
    const s = await serveRoutes(); try {
      const pause = { commandId: "http-pause", expectedRevision: s.revision(), payload: {} };
      const paused = await s.post("/groups/g/pause-dispatch", pause);
      expect(paused.status).toBe(200);
      expect(paused.body).toMatchObject({ verb: "pause-dispatch", result: { kind: "paused", stopMode: "pause" }, actorId: expect.stringMatching(/^operator-/) });
      expect((await s.post("/groups/g/pause-dispatch", pause)).body).toEqual(paused.body);
      expect(await s.lookup("g", "http-pause")).toEqual({ schema: "orca-command-lookup-v1", originalStatus: 200, body: paused.body });

      const resumed = await s.post("/groups/g/resume-dispatch", { commandId: "http-resume", expectedRevision: s.revision(), payload: {} });
      expect(resumed.status).toBe(202);
      expect(resumed.body).toMatchObject({ verb: "resume-dispatch", result: { kind: "scheduled", operation: "resume-dispatch" } });

      const stopped = await s.post("/groups/g/handoff-stop", { commandId: "http-handoff", expectedRevision: s.revision(), payload: {} });
      expect(stopped.status).toBe(200);
      expect(stopped.body).toMatchObject({ verb: "handoff-stop", result: { kind: "handoff-stopped", frozenRunIds: [], requestIds: [] } });

      const cleared = await s.post("/groups/g/resume-from-handoff", { commandId: "http-resume-handoff", expectedRevision: s.revision(), payload: { selections: [] } });
      expect(cleared.status).toBe(200);
      expect(cleared.body).toMatchObject({ verb: "resume-from-handoff", result: { kind: "resumed-from-handoff", pendingRuns: [] } });

      const groupRetry = await s.post("/recovery/retry", { commandId: "http-retry-group", expectedRevision: s.revision(), payload: { scope: "group", groupId: "g" } });
      expect(groupRetry.status).toBe(200);
      expect(groupRetry.body).toMatchObject({ verb: "recovery-retry", target: { kind: "group", groupId: "g" }, result: { kind: "recovery-observed", resolved: false } });
    } finally { await s.close(); }
  });

  it("scopes a task-target and a run-target command to the owning group ledger", async () => {
    const s = await serveRoutes(); try {
      const continued = await s.post("/groups/g/tasks/a/continue", {
        commandId: "http-continue", expectedRevision: s.revision(), payload: { predecessorRunId: "run-absent", checkpointId: "checkpoint-absent" },
      });
      expect(continued.status).toBe(422);
      expect(continued.body).toMatchObject({ error: { code: "continuation-predecessor-unrecoverable", retryable: false } });
      expect(await s.lookup("g", "http-continue")).toMatchObject({ originalStatus: 422 });

      const missing = await s.post("/recovery/retry", { commandId: "http-retry-run", expectedRevision: s.revision(), payload: { scope: "run", runId: "run-absent" } });
      expect(missing.status).toBe(404);
      expect(missing.body).toMatchObject({ error: { code: "run-not-found" } });
      expect(await s.lookup("g", "http-retry-run")).toMatchObject({ error: { code: "command-result-not-found" } });
    } finally { await s.close(); }
  });

  it("answers 503 retryable while the admission gate drains", async () => {
    const s = await serveRoutes(); try {
      s.h.deps.admissionGate.beginDrain();
      const draining = await s.post("/groups/g/pause-dispatch", { commandId: "http-draining", expectedRevision: s.revision(), payload: {} });
      expect(draining.status).toBe(503);
      expect(draining.body).toMatchObject({ error: { code: "panel-draining", retryable: true } });
      expect(s.h.store.db.prepare("SELECT id FROM commands WHERE id='http-draining'").get()).toBeUndefined();
    } finally { await s.close(); }
  });
});

/** A group confirmed under a model-assisted handoff profile with a funded handoff grant. */
async function modelAssistedFixture() {
  const snapshot = structuredClone(profileSnapshot());
  snapshot.profile.capabilities.handoffExecution = "model-assisted-v1";
  const h = await webFixture(snapshot);
  h.setObserved(structuredClone(snapshot.profile.capabilities) as CapabilityViewV1);
  const clock = { value: new Date(ACCEPTED_AT) };
  const service = new WebControlService({ ...h.deps, now: () => clock.value });
  const proposalVersion = Number(h.store.db.prepare("SELECT proposal_version FROM budget_proposals WHERE group_id='g'").get()!.proposal_version);
  const edited = service.editProposal(h.command("proposal-edit", {
    baseProposalVersion: proposalVersion,
    operations: [
      { target: { scope: "task", taskId: "a", allocation: "handoff", dimension: "attempts" }, value: 1, provenance: "human" },
      { target: { scope: "task", taskId: "a", allocation: "handoff", dimension: "sessions" }, value: 1, provenance: "human" },
    ],
  }));
  if ("error" in edited) throw new Error(`model-assisted fixture edit rejected: ${JSON.stringify(edited)}`);
  service.confirm(h.command("confirm", h.confirmPayload()));
  await service.start(h.command("start", {}));
  await deliverScheduledStart({ store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate }, "g");
  await service.handoffStop(h.command("handoff-stop", {}));
  return { h, service, clock };
}

function depsOf(h: { store: ControlStore; deps: { profileRouter: ExecutionProfileRouter } }) {
  return { store: h.store, profileRouter: h.deps.profileRouter };
}

/** A durable recovery identity may live in the outbox, the wake queue, or the command ledger. */
function hasDurableIdentity(store: ControlStore, id: string): boolean {
  return ["outbox", "scheduler_wakes", "commands"].some((table) => store.db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(id) !== undefined);
}

function outboxRow(store: ControlStore, id: string): { body: string } {
  const row = store.db.prepare("SELECT body FROM outbox WHERE id=?").get(id);
  if (!row) throw new Error(`no outbox row ${id}`);
  return { body: String(row.body) };
}

function handoffEnvelope(store: ControlStore, requestId: string, ordinal: number): Record<string, unknown> {
  const { body } = outboxRow(store, `handoff-attempt:${requestId}:${ordinal}`);
  const { envelopeHash } = JSON.parse(body) as { envelopeHash: string };
  return JSON.parse(readCanonicalRecord(store, envelopeHash)) as Record<string, unknown>;
}

function setRequestOrdinal(store: ControlStore, requestId: string, ordinal: number): void {
  const row = store.db.prepare("SELECT body FROM handoff_requests WHERE id=?").get(requestId)!;
  const body = JSON.parse(String(row.body)) as Record<string, unknown>;
  store.db.prepare("UPDATE handoff_requests SET body=? WHERE id=?").run(canonicalBytes({ ...body, phaseAttemptOrdinal: ordinal }).toString("utf8"), requestId);
}
