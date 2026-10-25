import { describe, expect, it } from "vitest";
import { WebControlService } from "../../src/control/webService.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import {
  applyFlowHandoffStop,
  applyResumeDispatch,
  flowHandoffDeadline,
  readStopIntent,
  type FlowStopMarker,
} from "../../src/control/stopIntent.js";
import { applyResumeFromHandoff } from "../../src/control/continuation.js";
import type { ControlStore } from "../../src/control/store.js";
import { webFixture } from "./fixtures/web.js";

const ACCEPTED_AT = "2026-10-26T00:00:00.000Z";
const DEADLINE_AT = "2026-10-26T01:01:00.000Z";
const MARKER: FlowStopMarker = { flowRunId: "flow-run-1", stepKey: "implement", seq: 3, reason: "pause" };

async function confirmedGroup() {
  const h = await webFixture();
  const service = new WebControlService(h.deps);
  const confirmed = await service.confirm(h.command("confirm", await h.confirmPayload()));
  if ("error" in confirmed) throw new Error(`confirm refused: ${JSON.stringify(confirmed.error)}`);
  return { h, service };
}

/** A confirmed group whose one work run is claimed (as `startedFixture` in stopIntent.test.ts). */
async function runningGroup() {
  const fixture = await confirmedGroup();
  const { h, service } = fixture;
  const started = await service.start(h.command("start", {}));
  if ("error" in started) throw new Error(`start refused: ${JSON.stringify(started.error)}`);
  await deliverScheduledStart({ store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate }, "g");
  return fixture;
}

function revisionOf(store: ControlStore): number {
  return Number(store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision);
}

function workRunIds(store: ControlStore): string[] {
  return store.db.prepare("SELECT id,body FROM runs WHERE group_id='g' AND active=1").all()
    .map((row) => ({ runId: String(row.id), body: JSON.parse(String(row.body)) as { phase?: string } }))
    .filter((run) => run.body.phase === "work").map((run) => run.runId);
}

function requestIdsOf(store: ControlStore): string[] {
  return store.db.prepare("SELECT id FROM handoff_requests WHERE group_id='g' ORDER BY id").all().map((row) => String(row.id));
}

function stoppedOf(store: ControlStore): boolean {
  return JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)).stopped as boolean;
}

describe("flow handoff deadline (spec §10.5.1)", () => {
  it("adds the per-attempt timeout plus sixty seconds, not the thirty-minute default", () => {
    expect(flowHandoffDeadline(ACCEPTED_AT, 60 * 60_000)).toBe(DEADLINE_AT);
    expect(Date.parse(flowHandoffDeadline(ACCEPTED_AT, 60 * 60_000)) - Date.parse(ACCEPTED_AT)).toBe(3_660_000);
  });

  it("saturates at the maximum protocol instant", () => {
    expect(flowHandoffDeadline("9999-12-31T23:59:00.000Z", 60 * 60_000)).toBe("9999-12-31T23:59:59.999Z");
  });
});

describe("applyFlowHandoffStop", () => {
  it("records the marker on a handoff intent, bumps the revision by one, stops the group and freezes its active runs", async () => {
    const { h } = await runningGroup(); try {
      const runIds = workRunIds(h.store);
      expect(runIds).toHaveLength(1);
      const before = revisionOf(h.store);
      const result = applyFlowHandoffStop(h.store, "g", { acceptedAt: ACCEPTED_AT, deadlineAt: DEADLINE_AT, flowStop: MARKER });
      expect(readStopIntent(h.store, "g")).toMatchObject({
        mode: "handoff", state: "handoff-pending", frozenRunIds: runIds, acceptedAt: ACCEPTED_AT, deadlineAt: DEADLINE_AT, flowStop: MARKER,
      });
      expect(revisionOf(h.store)).toBe(before + 1);
      expect(stoppedOf(h.store)).toBe(true);
      expect(requestIdsOf(h.store)).toEqual([...result.requestIds].sort());
      expect(result.state).toBe("handoff-pending");
    } finally { await h.dispose(); }
  });

  it("is idempotent for the identical marker: no second revision bump and one intent", async () => {
    const { h } = await runningGroup(); try {
      const first = applyFlowHandoffStop(h.store, "g", { acceptedAt: ACCEPTED_AT, deadlineAt: DEADLINE_AT, flowStop: MARKER });
      const revision = revisionOf(h.store);
      const second = applyFlowHandoffStop(h.store, "g", { acceptedAt: ACCEPTED_AT, deadlineAt: DEADLINE_AT, flowStop: MARKER });
      expect(second).toEqual(first);
      expect(revisionOf(h.store)).toBe(revision);
      expect(h.store.db.prepare("SELECT count(*) AS n FROM stop_intents").get()!.n).toBe(1);
      expect(requestIdsOf(h.store)).toHaveLength(1);
    } finally { await h.dispose(); }
  });

  it("refuses a pre-existing pause with stop-mode-conflict", async () => {
    const { h, service } = await confirmedGroup(); try {
      await service.pauseDispatch(h.command("pause-dispatch", {}));
      expect(() => applyFlowHandoffStop(h.store, "g", { acceptedAt: ACCEPTED_AT, deadlineAt: DEADLINE_AT, flowStop: MARKER }))
        .toThrow("stop-mode-conflict");
      expect(readStopIntent(h.store, "g")!.mode).toBe("pause");
    } finally { await h.dispose(); }
  });

  it("refuses a foreign handoff intent with stop-mode-conflict", async () => {
    const { h, service } = await runningGroup(); try {
      await service.handoffStop(h.command("handoff-stop", {}));
      expect(() => applyFlowHandoffStop(h.store, "g", { acceptedAt: ACCEPTED_AT, deadlineAt: DEADLINE_AT, flowStop: MARKER }))
        .toThrow("stop-mode-conflict");
      expect(readStopIntent(h.store, "g")!.flowStop).toBeUndefined();
      const revision = revisionOf(h.store);
      expect(() => applyFlowHandoffStop(h.store, "g", { acceptedAt: ACCEPTED_AT, deadlineAt: DEADLINE_AT, flowStop: MARKER }))
        .toThrow("stop-mode-conflict");
      expect(revisionOf(h.store)).toBe(revision);
    } finally { await h.dispose(); }
  });
});

describe("direct resume side door (spec §10.5.1)", () => {
  it("refuses resume-dispatch on an intent whose stop came from the flow", async () => {
    const { h } = await runningGroup(); try {
      applyFlowHandoffStop(h.store, "g", { acceptedAt: ACCEPTED_AT, deadlineAt: DEADLINE_AT, flowStop: MARKER });
      const result = applyResumeDispatch({ store: h.store, profileRouter: h.deps.profileRouter }, h.command("resume-dispatch", {}));
      expect(result).toMatchObject({ error: { code: "flow-pause-resume-via-flow" } });
      expect(readStopIntent(h.store, "g")!.flowStop).toEqual(MARKER);
    } finally { await h.dispose(); }
  });

  it("refuses resume-from-handoff on an intent whose stop came from the flow", async () => {
    const { h } = await runningGroup(); try {
      applyFlowHandoffStop(h.store, "g", { acceptedAt: ACCEPTED_AT, deadlineAt: DEADLINE_AT, flowStop: MARKER });
      const result = applyResumeFromHandoff({ store: h.store, profileRouter: h.deps.profileRouter }, h.command("resume-from-handoff", { selections: [] }));
      expect(result).toMatchObject({ error: { code: "flow-pause-resume-via-flow" } });
      expect(readStopIntent(h.store, "g")!.flowStop).toEqual(MARKER);
    } finally { await h.dispose(); }
  });

  it("still resumes an intent without a marker exactly as before", async () => {
    const { h, service } = await confirmedGroup(); try {
      await service.pauseDispatch(h.command("pause-dispatch", {}));
      const resumed = applyResumeDispatch({ store: h.store, profileRouter: h.deps.profileRouter }, h.command("resume-dispatch", {}));
      expect(resumed).toMatchObject({ result: { operation: "resume-dispatch" } });
      expect(readStopIntent(h.store, "g")).toBeNull();
      expect(stoppedOf(h.store)).toBe(false);
      await service.handoffStop(h.command("handoff-stop", {}));
      const cleared = applyResumeFromHandoff({ store: h.store, profileRouter: h.deps.profileRouter }, h.command("resume-from-handoff", { selections: [] }));
      expect(cleared).toMatchObject({ result: { kind: "resumed-from-handoff" } });
      expect(readStopIntent(h.store, "g")).toBeNull();
    } finally { await h.dispose(); }
  });
});
