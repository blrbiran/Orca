import { describe, expect, it } from "vitest";
import { WebControlService } from "../../src/control/webService.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { frozenRunIds, readStopIntent } from "../../src/control/stopIntent.js";
import { lookupCommandResult } from "../../src/control/commandLedger.js";
import { commandSuccessSchema } from "../../src/control/webProtocol.js";
import { applyPanelShutdown, freezeShutdownWindow, shutdownCommandId, shutdownGroup } from "../../src/panel/controlLifecycle.js";
import { webFixture } from "../control/fixtures/web.js";
import type { ControlStore } from "../../src/control/store.js";

// Handoff delivery spec §6, §12(3) (human: "空闲的也跳过") and §13.2 I-8 (m5). A group the execution
// driver owns -- a Web plan group (planHash) that has been started (a start wake exists) while a driver
// exists -- gets no shutdown stop intent and is not stopped, so after a restart the driver keeps
// dispatching with no human command. Every other group is frozen exactly as Web spec §6.4 says.

const ACCEPTED_AT = "2026-09-25T10:00:00.000Z";
const EPOCH = "epoch-shutdown-driver";
const window = freezeShutdownWindow({ now: () => new Date(ACCEPTED_AT), shutdownGraceMs: 120_000 });

type Fixture = Awaited<ReturnType<typeof webFixture>>;
const revisionOf = (store: ControlStore): number => Number(store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision);
const projectionOf = (store: ControlStore): number => Number(store.db.prepare("SELECT projection_seq FROM groups WHERE id='g'").get()!.projection_seq);
const stopped = (store: ControlStore): boolean => (JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as { stopped: boolean }).stopped;
const count = (store: ControlStore, sql: string): number => Number(store.db.prepare(sql).get()!.n);

/** A confirmed group `g`; `start` arms the start wake, `claim` delivers it into one `starting` Web work run. */
async function group(options: { start: boolean; claim: boolean }): Promise<{ h: Fixture; service: WebControlService; runId: string | null }> {
  const h = await webFixture();
  const service = new WebControlService(h.deps);
  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): confirmation resolves agent selections through ccloop first, so it is awaited and carries the previewed selectionsHash.
  const confirmed = await service.confirm(h.command("confirm", await h.confirmPayload()));
  if ("error" in confirmed) throw new Error(JSON.stringify(confirmed));
  let runId: string | null = null;
  if (options.start) {
    const started = await service.start(h.command("start", {}));
    if ("error" in started) throw new Error(JSON.stringify(started));
  }
  if (options.claim) {
    const claim = await deliverScheduledStart({ store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate }, "g");
    if (claim.kind !== "claimed") throw new Error(JSON.stringify(claim));
    runId = claim.runId;
  }
  return { h, service, runId };
}

describe("graceful shutdown and driver-owned groups (handoff delivery m5)", () => {
  it("skips a started group whose only active run is the driver's Web work run: no stop intent, not stopped, no request", async () => {
    const { h, runId } = await group({ start: true, claim: true }); try {
      expect(frozenRunIds(h.store, "g")).toEqual([runId]);
      const before = { revision: revisionOf(h.store), projection: projectionOf(h.store) };
      const entry = shutdownGroup(h.store, "g", window, shutdownCommandId(EPOCH), true);
      expect(entry).toEqual({ groupId: "g", disposition: "skipped-driver-owned", changed: false, commandRevision: before.revision,
        projectionSeq: before.projection, frozenRunIds: [], requestIds: [], blockerCode: null });
      expect(readStopIntent(h.store, "g")).toBeNull();
      expect(count(h.store, "SELECT COUNT(*) AS n FROM stop_intents")).toBe(0);
      expect(stopped(h.store)).toBe(false);
      expect(count(h.store, "SELECT COUNT(*) AS n FROM handoff_requests")).toBe(0);
      expect(count(h.store, "SELECT COUNT(*) AS n FROM outbox WHERE kind='handoff-request'")).toBe(0);
      expect(revisionOf(h.store)).toBe(before.revision);
    } finally { await h.dispose(); }
  });

  it("skips a started driver-owned group that is idle, with no active run at all", async () => {
    const { h } = await group({ start: true, claim: false }); try {
      expect(frozenRunIds(h.store, "g")).toEqual([]);
      const entry = shutdownGroup(h.store, "g", window, shutdownCommandId(EPOCH), true);
      expect(entry).toMatchObject({ disposition: "skipped-driver-owned", changed: false, frozenRunIds: [], requestIds: [] });
      expect(readStopIntent(h.store, "g")).toBeNull();
      expect(stopped(h.store)).toBe(false);
    } finally { await h.dispose(); }
  });

  it("freezes a started group exactly as before when no driver exists, idle or running", async () => {
    const running = await group({ start: true, claim: true }); try {
      const { h, runId } = running;
      const before = revisionOf(h.store);
      const entry = shutdownGroup(h.store, "g", window, shutdownCommandId(EPOCH), false);
      expect(entry).toMatchObject({ disposition: "created", changed: true, commandRevision: before + 1, frozenRunIds: [runId] });
      expect(entry.requestIds).toHaveLength(1);
      expect(readStopIntent(h.store, "g")).toMatchObject({ mode: "shutdown", frozenRunIds: [runId], acceptedAt: ACCEPTED_AT });
      expect(stopped(h.store)).toBe(true);
      expect(count(h.store, "SELECT COUNT(*) AS n FROM handoff_requests")).toBe(1);
    } finally { await running.h.dispose(); }
    // Idle is the case where only the driver switch tells the two apart: no run is left to exempt.
    const idle = await group({ start: true, claim: false }); try {
      const entry = shutdownGroup(idle.h.store, "g", window, shutdownCommandId(EPOCH), false);
      expect(entry).toMatchObject({ disposition: "created", changed: true, frozenRunIds: [] });
      expect(readStopIntent(idle.h.store, "g")).toMatchObject({ mode: "shutdown", state: "handoff-complete" });
      expect(stopped(idle.h.store)).toBe(true);
    } finally { await idle.h.dispose(); }
  });

  it("freezes a group that was never started even when a driver exists: it is not the driver's yet", async () => {
    const { h } = await group({ start: false, claim: false }); try {
      const entry = shutdownGroup(h.store, "g", window, shutdownCommandId(EPOCH), true);
      expect(entry).toMatchObject({ disposition: "created", changed: true, frozenRunIds: [] });
      expect(readStopIntent(h.store, "g")).toMatchObject({ mode: "shutdown", state: "handoff-complete" });
      expect(stopped(h.store)).toBe(true);
    } finally { await h.dispose(); }
  });

  it("freezes a started group whose body carries no planHash: the planHash is part of the definition", async () => {
    const { h } = await group({ start: true, claim: false }); try {
      const row = h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!;
      const { planHash: _dropped, ...rest } = JSON.parse(String(row.body)) as Record<string, unknown>;
      h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(rest));
      const entry = shutdownGroup(h.store, "g", window, shutdownCommandId(EPOCH), true);
      expect(entry).toMatchObject({ disposition: "created", changed: true });
      expect(stopped(h.store)).toBe(true);
    } finally { await h.dispose(); }
  });

  it("preserves an existing pause on an idle driver-owned group: the skip never pre-empts an earlier intent", async () => {
    const { h, service } = await group({ start: true, claim: false }); try {
      const paused = await service.pauseDispatch(h.command("pause-dispatch", {}));
      if ("error" in paused) throw new Error(JSON.stringify(paused));
      const entry = shutdownGroup(h.store, "g", window, shutdownCommandId(EPOCH), true);
      expect(entry).toMatchObject({ disposition: "preserved-pause", changed: false, frozenRunIds: [] });
      expect(readStopIntent(h.store, "g")!.mode).toBe("pause");
      expect(stopped(h.store)).toBe(true);
    } finally { await h.dispose(); }
  });

  it("H7: freezes a driver-owned group as before while a non-driver run (an estimate) is active in it", async () => {
    const { h, service, runId } = await group({ start: true, claim: true }); try {
      const estimate = await service.claimEstimate("g", h.estimateId);
      const estimateRunId = String((estimate as { runId: string }).runId);
      expect(frozenRunIds(h.store, "g")).toEqual([runId, estimateRunId].sort());
      const entry = shutdownGroup(h.store, "g", window, shutdownCommandId(EPOCH), true);
      // The driver's own run stays exempt (execution driver spec §4); only the estimate is frozen.
      expect(entry).toMatchObject({ disposition: "created", changed: true, frozenRunIds: [estimateRunId] });
      expect(entry.requestIds).toHaveLength(1);
      expect(readStopIntent(h.store, "g")).toMatchObject({ mode: "shutdown", frozenRunIds: [estimateRunId] });
      expect(stopped(h.store)).toBe(true);
    } finally { await h.dispose(); }
  });

  it("commits the new disposition under the global command and replays it through the ledger schema", async () => {
    const { h } = await group({ start: true, claim: true }); try {
      const result = await applyPanelShutdown({ store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate,
        epoch: EPOCH, now: () => new Date(ACCEPTED_AT), shutdownGraceMs: 120_000, exemptDriverRuns: true });
      expect(commandSuccessSchema.safeParse(result).success).toBe(true);
      expect(result.result).toMatchObject({ kind: "shutdown", groups: [{ groupId: "g", disposition: "skipped-driver-owned", changed: false }] });
      const replay = lookupCommandResult(h.store, "@global", shutdownCommandId(EPOCH))!;
      expect(replay.body).toEqual(result);
      expect(stopped(h.store)).toBe(false);
    } finally { await h.dispose(); }
  });
});
