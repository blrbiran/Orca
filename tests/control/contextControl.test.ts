import { describe, expect, it } from "vitest";
import { acceptContextObservation } from "../../src/control/contextControl.js";
import { webFixture, profileSnapshot } from "./fixtures/web.js";
import { WebControlService } from "../../src/control/webService.js";
import { scheduleStart, deliverScheduledStart, beginProviderAttempt } from "../../src/control/webDispatch.js";
import type { ContextObservationV1 } from "../../src/control/webProtocol.js";

function realtimeSnapshot() {
  const snapshot = profileSnapshot();
  snapshot.profile.capabilities.contextObservation = "realtime";
  snapshot.profile.contextTokenizer = { tokenizerId: "tiktoken-o200k", tokenizerVersion: "1" };
  snapshot.resolved.tokenizerArtifactHashes = [{ purpose: "context", contentHash: "9".repeat(64) }];
  return snapshot;
}

async function runFixture(contextObservation: "realtime" | "phase-end", threshold: number | null = 800_000) {
  const snapshot = realtimeSnapshot();
  snapshot.profile.capabilities.contextObservation = contextObservation;
  const h = await webFixture(snapshot);
  const service = new WebControlService(h.deps);
  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): confirmation resolves agent selections through ccloop first, so it is awaited and carries the previewed selectionsHash.
  await service.confirm(h.command("confirm", { ...(await h.confirmPayload()), contextPolicy: { handoffAtContextTokens: threshold } }));
  await scheduleStart({ store: h.store, profileRouter: h.deps.profileRouter }, h.command("start", {}));
  const claimed = await deliverScheduledStart({ store: h.store, profileRouter: h.deps.profileRouter }, "g");
  if (claimed.kind !== "claimed") throw new Error(`claim did not start a run: ${claimed.kind}`);
  const runId = claimed.runId;
  const profile = h.deps.profileRouter.resolve("task", "all", h.frozen.profileHash);
  const policy = { handoffAtContextTokens: threshold };
  let sequence = 0;
  const observation = (over: Partial<ContextObservationV1> = {}): ContextObservationV1 => ({
    schema: "orca-context-observation-v1", runId, generation: 1, workerSessionOrdinal: 1, sequence: ++sequence,
    occupiedInputTokens: 100_000, requestMaxOutputTokens: 1000, tokenizerId: "tiktoken-o200k", tokenizerVersion: "1",
    observedAt: "2026-09-20T00:00:00.000Z", ...over,
  });
  const callWith = (observationValue: ContextObservationV1) =>
    acceptContextObservation({ store: h.store }, { observation: observationValue, policy, profile });
  const call = (over: Partial<ContextObservationV1> = {}) => callWith(observation(over));
  return { h, runId, call, callWith, observation };
}

describe("context-watermark control", () => {
  it("accepts the first realtime observation below threshold without a handoff request", async () => {
    const { h, runId, call } = await runFixture("realtime"); try {
      expect(call()).toMatchObject({ kind: "observed" });
      expect(h.store.db.prepare("SELECT count(*) AS n FROM handoff_requests WHERE run_id=?").get(runId)!.n).toBe(0);
    } finally { await h.dispose(); }
  });

  it("replays a byte-identical duplicate observation idempotently", async () => {
    const { h, call, observation } = await runFixture("realtime"); try {
      const first = call();
      expect(first).toMatchObject({ kind: "observed" });
      const duplicate = acceptContextObservation({ store: h.store }, {
        observation: { ...observation(), sequence: 1 },
        policy: { handoffAtContextTokens: 800_000 },
        profile: h.deps.profileRouter.resolve("task", "all", h.frozen.profileHash),
      });
      expect(duplicate).toEqual(first);
    } finally { await h.dispose(); }
  });

  it("records context-observation-invalid on a sequence gap", async () => {
    const { h, call } = await runFixture("realtime"); try {
      expect(call({ sequence: 5 })).toMatchObject({ kind: "invalid", code: "context-observation-invalid" });
    } finally { await h.dispose(); }
  });

  it("records context-observation-invalid on a divergent duplicate", async () => {
    const { h, runId, call } = await runFixture("realtime"); try {
      call();
      expect(call({ sequence: 1, occupiedInputTokens: 999 })).toMatchObject({ kind: "invalid", code: "context-observation-invalid" });
      const latch = h.store.db.prepare("SELECT reason FROM context_latches WHERE run_id=?").get(runId);
      expect(String(latch!.reason)).toBe("context-observation-gap");
    } finally { await h.dispose(); }
  });

  it("rejects a session ordinal other than one", async () => {
    const { h, call } = await runFixture("realtime"); try {
      expect(call({ workerSessionOrdinal: 2 })).toMatchObject({ kind: "invalid", code: "context-observation-invalid" });
    } finally { await h.dispose(); }
  });

  it("rejects an observation from a stale generation without altering current state", async () => {
    const { h, call } = await runFixture("realtime"); try {
      expect(call({ generation: 0 })).toMatchObject({ kind: "invalid", code: "context-observation-invalid" });
    } finally { await h.dispose(); }
  });

  it("enforces the hard context fit independent of the threshold", async () => {
    const { h, call } = await runFixture("realtime", 900_000); try {
      // 999_500 occupied + 1_000 output exceeds the 1_000_000 window even below threshold.
      expect(call({ occupiedInputTokens: 999_500 })).toMatchObject({ kind: "invalid", code: "context-observation-invalid" });
    } finally { await h.dispose(); }
  });

  it("creates one context handoff request and suppresses the imminent work attempt on first crossing", async () => {
    const { h, runId, call } = await runFixture("realtime"); try {
      const result = call({ occupiedInputTokens: 850_000 });
      expect(result).toMatchObject({ kind: "handoff-requested" });
      const desired = `context-handoff-request:${runId}:1:800000`;
      const outbox = h.store.db.prepare("SELECT id,body FROM outbox WHERE kind='handoff-request'").get() as { id: string; body: string } | undefined;
      expect(String(outbox!.id)).toBe(desired);
      const requests = h.store.db.prepare("SELECT id,state,body FROM handoff_requests WHERE run_id=?").all(runId);
      expect(requests).toHaveLength(1);
      const body = JSON.parse(String(requests[0].body));
      expect(body).toMatchObject({ requestId: requests[0].id, runId, state: "request-pending", failureCode: null, evidenceIds: [] });
      expect(body.deadlineAt).toBe("2026-09-20T00:30:00.000Z");
      expect(body.phaseAttemptOrdinal).toBe(1);
      expect(JSON.parse(String(outbox!.body)).requestId).toBe(requests[0].id);
    } finally { await h.dispose(); }
  });

  it("replays the same request identity for a duplicate crossing observation", async () => {
    const { h, callWith, observation } = await runFixture("realtime"); try {
      const crossing = observation({ occupiedInputTokens: 850_000 });
      const first = callWith(crossing);
      expect(first).toMatchObject({ kind: "handoff-requested" });
      expect(callWith(crossing)).toEqual(first);
    } finally { await h.dispose(); }
  });

  it("refuses to reserve a work attempt once the context crossing is latched", async () => {
    const { h, runId, call } = await runFixture("realtime"); try {
      const crossing = call({ occupiedInputTokens: 850_000 });
      expect(crossing).toMatchObject({ kind: "handoff-requested" });
      if (crossing.kind !== "handoff-requested") throw new Error("expected a handoff request");
      const attempt = beginProviderAttempt({ store: h.store, profileRouter: h.deps.profileRouter }, runId, "work");
      expect(attempt).toMatchObject({ kind: "suppressed", requestId: crossing.requestId });
      const run = JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body));
      expect(run.providerAttemptOrdinal).toBe(0);
    } finally { await h.dispose(); }
  });

  it("keeps the crossing latch permanent so a later drop creates no second request", async () => {
    const { h, runId, call } = await runFixture("realtime"); try {
      const crossed = call({ occupiedInputTokens: 850_000 });
      const dropped = call({ occupiedInputTokens: 100_000 });
      expect(crossed).toMatchObject({ kind: "handoff-requested" });
      expect(dropped).toMatchObject({ kind: "observed" });
      expect(h.store.db.prepare("SELECT count(*) AS n FROM handoff_requests WHERE run_id=?").get(runId)!.n).toBe(1);
    } finally { await h.dispose(); }
  });

  it("latches a gap immediately with reason context-observation-gap", async () => {
    const { h, runId, call } = await runFixture("realtime"); try {
      call({ sequence: 4 });
      const latch = h.store.db.prepare("SELECT reason FROM context_latches WHERE run_id=?").get(runId);
      expect(String(latch!.reason)).toBe("context-observation-gap");
    } finally { await h.dispose(); }
  });

  it("records phase-end crossing as advisory only, accepting exactly one observation", async () => {
    const { h, runId, call, observation } = await runFixture("phase-end"); try {
      const result = call({ sequence: 1, occupiedInputTokens: 850_000 });
      expect(result).toMatchObject({ kind: "advisory" });
      expect(h.store.db.prepare("SELECT count(*) AS n FROM handoff_requests WHERE run_id=?").get(runId)!.n).toBe(0);
      const second = acceptContextObservation({ store: h.store }, { observation: observation({ sequence: 1 }), policy: { handoffAtContextTokens: 800_000 }, profile: h.deps.profileRouter.resolve("task", "all", h.frozen.profileHash) });
      expect(second).toMatchObject({ kind: "invalid", code: "context-observation-invalid" });
    } finally { await h.dispose(); }
  });

  it("joins an already-open handoff request instead of creating a second", async () => {
    const { h, runId, call } = await runFixture("realtime"); try {
      h.store.db.prepare("INSERT INTO handoff_requests(id,group_id,run_id,state,body) VALUES ('handoff-request-pre-existing','g',?, 'request-pending', ?)").run(runId, "{}");
      const result = call({ occupiedInputTokens: 850_000 });
      expect(result).toMatchObject({ kind: "joined", requestId: "handoff-request-pre-existing" });
      expect(h.store.db.prepare("SELECT count(*) AS n FROM handoff_requests WHERE run_id=?").get(runId)!.n).toBe(1);
      const join = h.store.db.prepare("SELECT request_id,joined_request_id FROM handoff_request_joins").get() as { request_id: string; joined_request_id: string } | undefined;
      expect(String(join!.request_id)).toBe("handoff-request-pre-existing");
      expect(String(join!.joined_request_id)).toBe(`context-handoff-request:${runId}:1:800000`);
    } finally { await h.dispose(); }
  });
});
