import { describe, expect, it } from "vitest";
import { WebControlService } from "../../src/control/webService.js";
import { applyPanelShutdown, freezeShutdownWindow, runControlPanelStartup, shutdownCommandId, shutdownGroup, withAdmission } from "../../src/panel/controlLifecycle.js";
import { groupStopState, readStopIntent } from "../../src/control/stopIntent.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { importControlPlan } from "../../src/control/planImport.js";
import { lookupCommandResult } from "../../src/control/commandLedger.js";
import { createAdmissionGate } from "../../src/control/admissionGate.js";
import { canonicalBytes } from "../../src/control/canonicalJson.js";
import { ControlError } from "../../src/control/errors.js";
import { profileSnapshot, webFixture } from "../control/fixtures/web.js";
import type { CommandSuccessV1, RawAuthorityCommandV1 } from "../../src/control/webProtocol.js";
import type { ControlStore } from "../../src/control/store.js";

const ACCEPTED_AT = "2026-09-20T10:00:00.000Z";
const MAX_INSTANT = "9999-12-31T23:59:59.999Z";
const EPOCH = "epoch-test";
const GRACE_MS = 120_000;

const revisionOf = (store: ControlStore, groupId: string): number =>
  Number(store.db.prepare("SELECT revision FROM groups WHERE id=?").get(groupId)!.revision);
const projectionOf = (store: ControlStore, groupId: string): number =>
  Number(store.db.prepare("SELECT projection_seq FROM groups WHERE id=?").get(groupId)!.projection_seq);
const stopRow = (store: ControlStore, groupId: string): { mode: string; revision: number; body: string } | undefined => {
  const row = store.db.prepare("SELECT mode,revision,body FROM stop_intents WHERE group_id=?").get(groupId);
  return row ? { mode: String(row.mode), revision: Number(row.revision), body: String(row.body) } : undefined;
};
const commandRows = (store: ControlStore, groupId: string): string[] =>
  store.db.prepare("SELECT id FROM commands WHERE group_id=? ORDER BY id").all(groupId).map((row) => String(row.id));
const outboxIds = (store: ControlStore): string[] =>
  store.db.prepare("SELECT id FROM outbox ORDER BY id").all().map((row) => String(row.id));

type ShutdownSuccess = CommandSuccessV1 & { result: Extract<CommandSuccessV1["result"], { kind: "shutdown" }> };
const asShutdownResult = (result: CommandSuccessV1): ShutdownSuccess => result as ShutdownSuccess;

/** Two imported-and-confirmed groups, `g` from the shared fixture and `h` imported beside it. */
async function shutdownHarness(claims: readonly string[] = []) {
  const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]);
  const gate = createAdmissionGate();
  let sequence = 0;
  const next = () => `command-${++sequence}`;
  const groupCommand = (groupId: string, expectedRevision: number, verb: RawAuthorityCommandV1["verb"], payload: unknown) =>
    h.rawCommand(next(), expectedRevision, verb, { kind: "group", groupId }, payload) as never;
  const imported = importControlPlan({ ...h.deps, estimatorObservation: () => ({ profile: h.frozen, observed: profileSnapshot().profile.capabilities, probeFailureCode: null }) },
    groupCommand("h", 0, "import-plan", { groupId: "h", repoId: "repo", planId: "plan" }) as never);
  if ("error" in imported) throw new Error(`second group import failed: ${JSON.stringify(imported)}`);
  const clock = { value: new Date(ACCEPTED_AT) };
  const deps = { store: h.store, profileRouter: h.deps.profileRouter, admissionGate: gate, epoch: EPOCH, shutdownGraceMs: GRACE_MS,
    now: () => clock.value, beforeCommit: undefined as (() => void) | undefined };
  const service = new WebControlService({ ...h.deps, admissionGate: gate, now: () => clock.value });
  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): confirmation resolves agent selections through ccloop first, so it is awaited and carries the previewed selectionsHash.
  // Group "h" is imported from the same plan by the same operator, so the previewed hash is the same.
  await service.confirm(h.command("confirm", await h.confirmPayload()));
  await service.confirm(groupCommand("h", revisionOf(h.store, "h"), "confirm", await h.confirmPayload()) as never);
  for (const groupId of claims) {
    await service.start(groupCommand(groupId, revisionOf(h.store, groupId), "start", {}) as never);
    expect((await deliverScheduledStart({ store: h.store, profileRouter: h.deps.profileRouter, admissionGate: gate }, groupId)).kind).toBe("claimed");
  }
  const shutdown = (overrides: Partial<typeof deps> = {}) => applyPanelShutdown({ ...deps, ...overrides }).then(asShutdownResult);
  return { h, service, gate, deps, clock, groupCommand, shutdown, next };
}

/** A persisted stop intent that no command wrote, to stand in for an earlier epoch. */
function seedIntent(store: ControlStore, groupId: string, intent: { mode: string; state: string; frozenRunIds: string[]; acceptedAt: string | null; deadlineAt: string | null }): void {
  const body = canonicalBytes(intent).toString("utf8");
  store.db.prepare("INSERT INTO stop_intents(group_id,mode,revision,body) VALUES (?,?,?,?) ON CONFLICT(group_id) DO UPDATE SET mode=excluded.mode,revision=excluded.revision,body=excluded.body")
    .run(groupId, intent.mode, revisionOf(store, groupId), body);
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!;
  const group = JSON.parse(String(row.body)) as Record<string, unknown>;
  group.stopped = true;
  store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(group), groupId);
}

describe("shutdown window", () => {
  it("freezes the deadline from the wall clock and saturates at the maximum instant", () => {
    const accepted = new Date(ACCEPTED_AT);
    expect(freezeShutdownWindow({ now: () => accepted, shutdownGraceMs: GRACE_MS }))
      .toEqual({ shutdownAcceptedAt: ACCEPTED_AT, shutdownDeadlineAt: new Date(accepted.getTime() + GRACE_MS).toISOString() });
    expect(freezeShutdownWindow({ now: () => new Date(Date.parse(MAX_INSTANT) - 1_000), shutdownGraceMs: GRACE_MS }))
      .toEqual({ shutdownAcceptedAt: new Date(Date.parse(MAX_INSTANT) - 1_000).toISOString(), shutdownDeadlineAt: MAX_INSTANT });
  });

  it("keeps the default grace at two minutes when the panel configures none", () => {
    expect(freezeShutdownWindow({ now: () => new Date(ACCEPTED_AT) }))
      .toEqual({ shutdownAcceptedAt: ACCEPTED_AT, shutdownDeadlineAt: new Date(Date.parse(ACCEPTED_AT) + 120_000).toISOString() });
  });
});

describe("panel shutdown transaction", () => {
  it("waits for a writer admitted before the gate and then commits every group at once", async () => {
    const ctx = await shutdownHarness(); const { h, gate, shutdown } = ctx; try {
      const admittedBeforeGate = gate.enter();
      const pending = shutdown();
      expect(stopRow(h.store, "g")).toBeUndefined();
      await new Promise((resolve) => setImmediate(resolve));
      expect(stopRow(h.store, "g")).toBeUndefined();
      expect(commandRows(h.store, "@global")).toEqual([]);
      admittedBeforeGate();
      const result = await pending;
      expect(result.result).toMatchObject({ kind: "shutdown" });
      expect(result.result.groups.map((entry) => entry.groupId)).toEqual(["g", "h"]);
      expect(stopRow(h.store, "g")).toBeDefined();
      expect(stopRow(h.store, "h")).toBeDefined();
    } finally { await h.dispose(); }
  });

  it("refuses a writer that arrives after draining begins", async () => {
    const ctx = await shutdownHarness(); const { h, gate, shutdown } = ctx; try {
      await shutdown();
      expect(gate.draining).toBe(true);
      let invoked = false;
      expect(() => { invoked = withAdmission({ admissionGate: gate }, () => true) === true; }).toThrowError(new ControlError("panel-draining"));
      expect(invoked).toBe(false);
      expect(withAdmission({}, () => "no gate")).toBe("no gate");
    } finally { await h.dispose(); }
  });

  it("commits one global command and leaves unchanged groups out of the command ledger and projection", async () => {
    const ctx = await shutdownHarness(); const { h, shutdown } = ctx; try {
      const paused = await ctx.service.pauseDispatch(ctx.groupCommand("h", revisionOf(h.store, "h"), "pause-dispatch", {}) as never);
      expect(paused).toMatchObject({ result: { kind: "paused" } });
      const before = { g: { revision: revisionOf(h.store, "g"), projection: projectionOf(h.store, "g") }, h: { revision: revisionOf(h.store, "h"), projection: projectionOf(h.store, "h") } };
      const result = await shutdown();
      expect(result.commandRevision).toBeNull();
      expect(result.projectionSeq).toBeNull();
      expect(result.verb).toBe("shutdown");
      expect(result.target).toEqual({ kind: "global", epoch: EPOCH });
      const entries = Object.fromEntries(result.result.groups.map((entry) => [entry.groupId, entry]));
      expect(entries.g).toMatchObject({ disposition: "created", changed: true });
      expect(entries.h).toMatchObject({ disposition: "preserved-pause", changed: false, frozenRunIds: [] });
      expect(revisionOf(h.store, "g")).toBe(before.g.revision + 1);
      expect(projectionOf(h.store, "g")).toBe(before.g.projection + 1);
      // An unchanged pause gets no per-group recent-command entry and no projection advance.
      expect(revisionOf(h.store, "h")).toBe(before.h.revision);
      expect(projectionOf(h.store, "h")).toBe(before.h.projection);
      expect(commandRows(h.store, "h")).not.toContain(shutdownCommandId(EPOCH));
      expect(commandRows(h.store, "@global")).toEqual([shutdownCommandId(EPOCH)]);
      const replay = lookupCommandResult(h.store, "@global", shutdownCommandId(EPOCH))!;
      expect(replay.body).toEqual(result);
    } finally { await h.dispose(); }
  });

  it("gives a ready group an empty frozen set that completes, so restart can resume and start", async () => {
    const ctx = await shutdownHarness(); const { h, shutdown } = ctx; try {
      await shutdown();
      const intent = readStopIntent(h.store, "g")!;
      expect(intent).toMatchObject({ mode: "shutdown", state: "handoff-complete", frozenRunIds: [], acceptedAt: ACCEPTED_AT });
      expect(groupStopState(h.store, "g")).toBe("handoff-complete");
      expect(intent.deadlineAt).toBe(new Date(Date.parse(ACCEPTED_AT) + GRACE_MS).toISOString());
    } finally { await h.dispose(); }
  });

  it("strengthens a pause only when an active run must be stopped, and freezes that run", async () => {
    const ctx = await shutdownHarness(["g"]); const { h, shutdown } = ctx; try {
      for (const groupId of ["g", "h"]) {
        const paused = await ctx.service.pauseDispatch(ctx.groupCommand(groupId, revisionOf(h.store, groupId), "pause-dispatch", {}) as never);
        if ("error" in paused) throw new Error(JSON.stringify(paused));
      }
      const active = h.store.db.prepare("SELECT id FROM runs WHERE group_id='g' AND active=1").get()!;
      const result = await shutdown();
      const entries = Object.fromEntries(result.result.groups.map((entry) => [entry.groupId, entry]));
      expect(entries.g).toMatchObject({ disposition: "strengthened-pause", changed: true, frozenRunIds: [String(active.id)] });
      expect(entries.h).toMatchObject({ disposition: "preserved-pause", changed: false, frozenRunIds: [] });
      expect(readStopIntent(h.store, "g")!.mode).toBe("shutdown");
      expect(readStopIntent(h.store, "h")!.mode).toBe("pause");
      // The frozen run gets exactly one durable request identity for this shutdown.
      expect(h.store.db.prepare("SELECT id FROM outbox WHERE kind='handoff-request' AND json_extract(body,'$.runId')=?").all(String(active.id)).map((row) => String(row.id)))
        .toEqual([`shutdown:g:${entries.g.commandRevision}:${String(active.id)}`]);
      expect(groupStopState(h.store, "g")).toBe("handoff-pending");
    } finally { await h.dispose(); }
  });

  it("preserves a stronger human handoff-stop byte-for-byte", async () => {
    const ctx = await shutdownHarness(); const { h, shutdown } = ctx; try {
      const stopped = await ctx.service.handoffStop(ctx.groupCommand("g", revisionOf(h.store, "g"), "handoff-stop", {}) as never);
      if ("error" in stopped) throw new Error(JSON.stringify(stopped));
      const before = { intent: stopRow(h.store, "g")!, revision: revisionOf(h.store, "g"), projection: projectionOf(h.store, "g"), outbox: outboxIds(h.store) };
      const result = await shutdown();
      const entry = result.result.groups.find((group) => group.groupId === "g")!;
      expect(entry).toMatchObject({ disposition: "preserved-handoff", changed: false, commandRevision: before.revision, projectionSeq: before.projection });
      expect(stopRow(h.store, "g")).toEqual(before.intent);
      expect(revisionOf(h.store, "g")).toBe(before.revision);
      expect(outboxIds(h.store)).toEqual(before.outbox);
    } finally { await h.dispose(); }
  });

  it("never extends an equal-strength shutdown intent from an earlier epoch", async () => {
    const ctx = await shutdownHarness(); const { h, shutdown, deps } = ctx; try {
      const earlier = { mode: "shutdown", state: "handoff-pending", frozenRunIds: [] as string[], acceptedAt: "2026-09-19T10:00:00.000Z", deadlineAt: "2026-09-19T10:02:00.000Z" };
      seedIntent(h.store, "g", earlier);
      const before = stopRow(h.store, "g")!;
      const result = await shutdown();
      expect(result.result.groups.find((group) => group.groupId === "g")).toMatchObject({ disposition: "preserved-shutdown", changed: false });
      expect(stopRow(h.store, "g")).toEqual(before);
      // A later epoch under the same intent still must not rewrite the frozen deadline.
      ctx.clock.value = new Date("2026-09-21T10:00:00.000Z");
      await applyPanelShutdown({ ...deps, epoch: "epoch-later" });
      expect(stopRow(h.store, "g")!.body).toBe(before.body);
    } finally { await h.dispose(); }
  });

  it("records an inconsistent frozen set as a blocker while still committing the other groups", async () => {
    const ctx = await shutdownHarness(["g"]); const { h, shutdown } = ctx; try {
      const active = String(h.store.db.prepare("SELECT id FROM runs WHERE group_id='g' AND active=1").get()!.id);
      seedIntent(h.store, "g", { mode: "shutdown", state: "handoff-pending", frozenRunIds: ["run-not-in-set"], acceptedAt: ACCEPTED_AT, deadlineAt: MAX_INSTANT });
      const before = { intent: stopRow(h.store, "g")!, revision: revisionOf(h.store, "g"), projection: projectionOf(h.store, "g") };
      const result = await shutdown();
      const entry = result.result.groups.find((group) => group.groupId === "g")!;
      expect(entry).toMatchObject({ disposition: "blocked-inconsistent", changed: false, commandRevision: before.revision, blockerCode: "shutdown-frozen-set-inconsistent" });
      expect(stopRow(h.store, "g")).toEqual(before.intent);
      expect(h.store.db.prepare("SELECT id,scope,code FROM recovery_blockers WHERE group_id='g'").all())
        .toEqual([{ id: `shutdown-inconsistent:g:${shutdownCommandId(EPOCH)}`, scope: "group", code: "shutdown-frozen-set-inconsistent" }]);
      // The blocker is the only mutation: the command revision stays fixed and the projection advances once.
      expect(revisionOf(h.store, "g")).toBe(before.revision);
      expect(projectionOf(h.store, "g")).toBe(before.projection + 1);
      expect(result.result.groups.find((group) => group.groupId === "h")).toMatchObject({ disposition: "created", changed: true });
    } finally { await h.dispose(); }
  });

  it("leaves nothing behind when the commit is lost and replays the closed result once it succeeds", async () => {
    const ctx = await shutdownHarness(); const { h, shutdown, deps } = ctx; try {
      const before = { g: revisionOf(h.store, "g"), h: revisionOf(h.store, "h") };
      await expect(shutdown({ beforeCommit: () => { throw new Error("lost"); } })).rejects.toThrow("lost");
      expect(h.store.db.prepare("SELECT COUNT(*) AS n FROM stop_intents").get()!.n).toBe(0);
      expect(commandRows(h.store, "@global")).toEqual([]);
      expect(revisionOf(h.store, "g")).toBe(before.g);
      const first = await shutdown();
      const second = await applyPanelShutdown(deps);
      expect(second).toEqual(first);
      expect(commandRows(h.store, "@global")).toEqual([shutdownCommandId(EPOCH)]);
      expect(revisionOf(h.store, "g")).toBe(before.g + 1);
      expect(revisionOf(h.store, "h")).toBe(before.h + 1);
    } finally { await h.dispose(); }
  });
});

describe("shutdown exemption and a persisted frozen set (review round 1, Important 2)", () => {
  it("does not flag shutdown-frozen-set-inconsistent for a Web work run frozen before a driver existed, once a later shutdown exempts it", async () => {
    const ctx = await shutdownHarness(["g"]); const { h } = ctx; try {
      const window = freezeShutdownWindow({ now: () => ctx.clock.value, shutdownGraceMs: GRACE_MS });
      // First shutdown: no driver yet (exemptDriverRuns=false, the default), so the Web work run is frozen
      // and durably gets a handoff request the ordinary way.
      const first = shutdownGroup(h.store, "g", window, "shutdown-1");
      expect(first).toMatchObject({ disposition: "created", changed: true });
      expect(first.frozenRunIds.length).toBe(1);
      const runId = first.frozenRunIds[0];
      expect(h.store.db.prepare("SELECT id FROM handoff_requests WHERE group_id='g' AND run_id=?").get(runId)).toBeDefined();
      // Second shutdown: a driver now exists, so `active` excludes this run -- but the stop intent from
      // the first call already froze it. The frozen-set-consistency check must not be tripped by that:
      // the already-persisted handoff request is what keeps it consistent, and the earlier intent is
      // preserved untouched (the exemption does not retroactively unfreeze an already-frozen run).
      const second = shutdownGroup(h.store, "g", window, "shutdown-2", true);
      expect(second).toMatchObject({ disposition: "preserved-shutdown", changed: false, blockerCode: null, frozenRunIds: [runId] });
      expect(h.store.db.prepare("SELECT COUNT(*) AS n FROM recovery_blockers WHERE group_id='g'").get()!.n).toBe(0);
    } finally { await h.dispose(); }
  });
});

describe("startup order", () => {
  it("recovers control state before the panel listens and never listens after a failed recovery", async () => {
    const order: string[] = [];
    await runControlPanelStartup({
      recover: async () => { order.push("recover"); },
      listen: async () => { order.push("listen"); },
    });
    expect(order).toEqual(["recover", "listen"]);
    const attempts: string[] = [];
    await expect(runControlPanelStartup({
      recover: async () => { attempts.push("recover"); throw new Error("recovery-blocked"); },
      listen: async () => { attempts.push("listen"); },
    })).rejects.toThrow("recovery-blocked");
    expect(attempts).toEqual(["recover"]);
  });
});
