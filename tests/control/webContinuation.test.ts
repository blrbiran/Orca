import { describe, expect, it } from "vitest";
import { WebControlService } from "../../src/control/webService.js";
import { continuationIdentity, continuationWakeBody } from "../../src/control/continuation.js";
import { groupStopState, readStopIntent } from "../../src/control/stopIntent.js";
import { deliverScheduledStart, settleProviderAttempt } from "../../src/control/webDispatch.js";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import { readCanonicalRecord } from "../../src/control/snapshot.js";
import { add, subtract } from "../../src/control/budget.js";
import { dimensions, zero } from "../../src/control/commands.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";
import type { WebFixtureTask } from "./fixtures/web.js";
import type { CapabilityViewV1, CommandSuccessV1 } from "../../src/control/webProtocol.js";
import type { Amount } from "../../src/control/types.js";
import type { ControlStore } from "../../src/control/store.js";

const ACCEPTED_AT = "2026-09-20T10:00:00.000Z";
/** The default `complex-1m` grant for one task; `attempts` and `sessions` are the smallest dimensions. */
const WORK_GRANT: Amount = { tokens: 3_000_000, activeMs: 14_400_000, attempts: 3, sessions: 3 };
const HANDOFF_GRANT: Amount = { tokens: 300_000, activeMs: 1_800_000, attempts: 0, sessions: 0 };
const USED: Amount = { tokens: 10_000, activeMs: 60_000, attempts: 1, sessions: 1 };

const amount = (patch: Partial<Amount> = {}): Amount => ({ ...zero(), ...patch });
const clamp = (grant: Amount, used: Amount): Amount => {
  const result = zero();
  for (const dimension of dimensions) result[dimension] = Math.max(grant[dimension] - used[dimension], 0);
  return result;
};
const grantOf = (bucket: string): Amount => (bucket === "work" ? WORK_GRANT : HANDOFF_GRANT);
const capabilities = (patch: Partial<CapabilityViewV1> = {}): CapabilityViewV1 =>
  Object.assign(structuredClone(profileSnapshot().profile.capabilities), patch);

interface WorkRow {
  status: string; currentRunId: string | null; pendingRunId: string | null; claimOrdinal: number | undefined;
  lineageRunIds: string[]; grant: { work: Amount; handoff: Amount };
}

function workRow(store: ControlStore, taskId: string): WorkRow {
  const row = store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id=?").get("g", taskId);
  if (!row) throw new Error(`no work item ${taskId}`);
  return JSON.parse(String(row.body)) as WorkRow;
}

function saveWorkRow(store: ControlStore, taskId: string, body: Record<string, unknown>): void {
  store.db.prepare("UPDATE work_items SET body=? WHERE group_id=? AND id=?").run(JSON.stringify(body), "g", taskId);
}

interface RunRow {
  runId: string; state: string; phase: string; active: number; generation: number; claimOrdinal: number | null;
  continuationIntentId: string | null; grant: { work: Amount; handoff: Amount };
  remaining: { work: Amount; handoff: Amount }; cumulative: { work: Amount; handoff: Amount };
  unknown: { work: boolean; handoff: boolean }; recoverable: boolean; checkpointId: string | null;
  workItemId: string; [key: string]: unknown;
}

function runRow(store: ControlStore, runId: string): RunRow {
  const row = store.db.prepare("SELECT active,body FROM runs WHERE id=?").get(runId);
  if (!row) throw new Error(`no run ${runId}`);
  return { ...(JSON.parse(String(row.body)) as RunRow), active: Number(row.active) };
}

function storeRun(store: ControlStore, runId: string, body: Record<string, unknown>): void {
  store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(body), runId);
}

function taskRuns(store: ControlStore, taskId: string): RunRow[] {
  return store.db.prepare("SELECT id FROM runs WHERE group_id=? AND work_item_id=? ORDER BY id").all("g", taskId)
    .map((row) => runRow(store, String(row.id)));
}

function activeRunIds(store: ControlStore): string[] {
  return store.db.prepare("SELECT id FROM runs WHERE group_id=? AND active=1 ORDER BY id").all("g")
    .map((row) => String(row.id));
}

interface Allocation { ownerKind: string; ownerId: string; bucket: string; state: string; amount: Amount }

function allocations(store: ControlStore, taskId: string): Allocation[] {
  const proposal = JSON.parse(String(store.db.prepare("SELECT body FROM budget_proposals WHERE group_id=?").get("g")!.body)) as { allocations: Allocation[] };
  return proposal.allocations.filter((row) => row.ownerKind === "task" && row.ownerId === taskId);
}

function saveProposal(store: ControlStore, edit: (proposal: { allocations: Allocation[] }) => void): void {
  const row = store.db.prepare("SELECT body FROM budget_proposals WHERE group_id=?").get("g")!;
  const proposal = JSON.parse(String(row.body)) as { allocations: Allocation[] };
  edit(proposal);
  store.db.prepare("UPDATE budget_proposals SET body=? WHERE group_id=?").run(canonicalBytes(proposal).toString("utf8"), "g");
}

function wakeRows(store: ControlStore): Array<{ id: string; kind: string; delivered: number }> {
  return store.db.prepare("SELECT id,kind,delivered FROM scheduler_wakes ORDER BY rowid").all()
    .map((row) => ({ id: String(row.id), kind: String(row.kind), delivered: Number(row.delivered) }));
}

function pendingWakes(store: ControlStore): string[] {
  return wakeRows(store).filter((row) => row.delivered === 0).map((row) => row.id);
}

function groupBody(store: ControlStore): Record<string, unknown> {
  return JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as Record<string, unknown>;
}

function revisionOf(store: ControlStore): number {
  return Number(store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision);
}

function commandCount(store: ControlStore): number {
  return Number(store.db.prepare("SELECT COUNT(*) AS n FROM commands WHERE group_id='g'").get()!.n);
}

function claimEnvelope(store: ControlStore, runId: string): Record<string, unknown> {
  const row = store.db.prepare("SELECT body FROM outbox WHERE id=? AND kind='work-claim'").get(`work:g:${runId}`);
  if (!row) throw new Error(`no work-claim outbox for ${runId}`);
  const { envelopeHash } = JSON.parse(String(row.body)) as { envelopeHash: string };
  return JSON.parse(readCanonicalRecord(store, envelopeHash)) as Record<string, unknown>;
}

/** The durable ready-work wake a settlement transaction leaves for the next ordinary claim. */
function armOrdinaryClaim(store: ControlStore): void {
  const revision = revisionOf(store);
  store.db.prepare("INSERT INTO scheduler_wakes(id,group_id,kind,body,delivered) VALUES (?,?,'start',?,0) ON CONFLICT(id) DO UPDATE SET delivered=0")
    .run(`scheduler-wake:g:${revision}:settled`, "g", canonicalBytes({ groupId: "g", startRevision: revision }).toString("utf8"));
}

/** A confirmed group with two independent tasks, one ordinary claim armed by `start`. */
async function continuationFixture(tasks: readonly WebFixtureTask[] = [{ taskId: "a" }, { taskId: "b" }]) {
  const h = await webFixture(profileSnapshot(), tasks);
  const clock = { value: new Date(ACCEPTED_AT) };
  const deps = { ...h.deps, now: () => clock.value };
  const service = new WebControlService(deps);
  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): confirmation resolves agent selections through ccloop first, so it is awaited and carries the previewed selectionsHash.
  await service.confirm(h.command("confirm", await h.confirmPayload()));
  await service.start(h.command("start", {}));
  return { h, deps, service, clock };
}

type Ctx = { h: Awaited<ReturnType<typeof webFixture>>; deps: Parameters<typeof deliverScheduledStart>[0] };

/**
 * Claim one task and settle its run as the canonical recoverable predecessor §6.3 names:
 * terminal-recoverable with its committed checkpoint, its task and both commitment rows
 * moved to `held` at the inherited grant, and settled usage moved from reserve to used.
 */
async function recoverablePredecessor(ctx: Ctx, taskId: string, used: Amount = USED): Promise<{ runId: string; checkpointId: string; predecessor: { taskId: string; predecessorRunId: string; checkpointId: string } }> {
  const { h } = ctx;
  armOrdinaryClaim(h.store);
  await deliverScheduledStart(ctx.deps, "g");
  const runId = activeRunIds(h.store).map((id) => runRow(h.store, id)).find((run) => run.workItemId === taskId)?.runId;
  if (!runId) throw new Error(`task ${taskId} claimed nothing`);
  const checkpointId = `cp-${taskId}`;
  h.store.transaction(() => {
    const run = runRow(h.store, runId);
    const usage = { work: used, handoff: zero() };
    const total = add(usage.work, usage.handoff);
    const deactivated = h.store.db.prepare("UPDATE runs SET active=0 WHERE id=? AND active=1").run(runId);
    if (deactivated.changes !== 1) throw new Error(`run ${runId} was not active`);
    storeRun(h.store, runId, {
      ...run, state: "settled-recoverable", recoverable: true, checkpointId,
      cumulative: usage, remaining: { work: clamp(run.grant.work, usage.work), handoff: clamp(run.grant.handoff, usage.handoff) },
      unknown: { work: false, handoff: false },
    });
    const candidate = { checkpointId, groupId: "g", workItemId: taskId, taskId, runId, generation: run.generation,
      graphVersion: run.graphVersion, targetVersion: run.targetVersion, usageHighWater: 0, result: "partial",
      artifacts: [], snapshot: null, missing: [], unresolvedRequestIds: [], stopProof: null, terminalOutcome: "cancelled" };
    h.store.db.prepare("INSERT INTO checkpoints(id,run_id,hash,body) VALUES (?,?,?,?)")
      .run(checkpointId, runId, sha256Canonical(candidate), canonicalBytes(candidate).toString("utf8"));
    const work = workRow(h.store, taskId);
    saveWorkRow(h.store, taskId, { ...work, status: "held", pendingRunId: null,
      grant: { work: clamp(work.grant.work, usage.work), handoff: clamp(work.grant.handoff, usage.handoff) } });
    saveProposal(h.store, (proposal) => {
      for (const row of proposal.allocations) {
        if (row.ownerKind !== "task" || row.ownerId !== taskId) continue;
        const usedOf = row.bucket === "work" ? usage.work : usage.handoff;
        row.state = "held";
        row.amount = clamp(grantOf(row.bucket), usedOf);
      }
    });
    const group = groupBody(h.store) as unknown as { used: Amount; reserved: Amount; ledger: { used: Amount; committedRemaining: Amount } };
    group.used = add(group.used, total);
    group.reserved = subtract(group.reserved, total);
    group.ledger = { ...group.ledger, used: group.used, committedRemaining: group.reserved };
    h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(group));
  });
  return { runId, checkpointId, predecessor: { taskId, predecessorRunId: runId, checkpointId } };
}

/** A handoff-stop that reached `handoff-complete`: every frozen run already settled. */
type HandoffStopped = CommandSuccessV1 & { result: Extract<CommandSuccessV1["result"], { kind: "handoff-stopped" }> };

async function stoppedAfterHandoff(ctx: { h: Awaited<ReturnType<typeof webFixture>>; service: WebControlService }): Promise<HandoffStopped> {
  const result = await ctx.service.handoffStop(ctx.h.command("handoff-stop", {}));
  if ("error" in result || result.result.kind !== "handoff-stopped") throw new Error(JSON.stringify(result));
  expect(groupStopState(ctx.h.store, "g")).toBe("handoff-complete");
  return result as HandoffStopped;
}

const selection = (predecessor: { taskId: string; predecessorRunId: string; checkpointId: string }) =>
  ({ taskId: predecessor.taskId, predecessorRunId: predecessor.predecessorRunId, checkpointId: predecessor.checkpointId });

describe("batch resume from handoff", () => {
  it("registers every selection in one transaction and clears the completed handoff stop", async () => {
    const ctx = await continuationFixture(); const { h, service } = ctx; try {
      const a = await recoverablePredecessor(ctx, "a");
      const b = await recoverablePredecessor(ctx, "b");
      await stoppedAfterHandoff(ctx);
      const before = { revision: revisionOf(h.store), wakes: pendingWakes(h.store), commands: commandCount(h.store) };
      const result = await service.resumeFromHandoff(h.command("resume-from-handoff", { selections: [selection(b.predecessor), selection(a.predecessor)] }));
      if ("error" in result || result.result.kind !== "resumed-from-handoff") throw new Error(JSON.stringify(result));
      const resumeRevision = revisionOf(h.store);
      // The request-array order survives into the registration, so wake delivery keeps it.
      expect(result.result.pendingRuns.map((run) => run.taskId)).toEqual(["b", "a"]);
      expect(result.result.pendingRuns.every((run) => run.claimOrdinal === 1)).toBe(true);
      expect(readStopIntent(h.store, "g")).toBeNull();
      expect(groupBody(h.store).stopped).toBe(false);
      expect(result.result.wakeId).toBe(`scheduler-wake:g:${resumeRevision}`);
      for (const [taskId, predecessor] of [["a", a], ["b", b]] as const) {
        const work = workRow(h.store, taskId);
        const registered = result.result.pendingRuns.find((run) => run.taskId === taskId)!;
        expect(work.status).toBe("continuing");
        // Registration leaves the lineage pointing at the settled predecessor.
        expect(work.currentRunId).toBe(predecessor.runId);
        expect(work.lineageRunIds).toEqual([predecessor.runId]);
        expect(work.pendingRunId).toBe(registered.pendingRunId);
        expect(work.pendingRunId).not.toBe(predecessor.runId);
        expect(idSchemaFree(work.pendingRunId!)).toBe(true);
        expect(work.claimOrdinal).toBe(1);
        expect(registered.continuationIntentId).toBe(continuationIdentity("g", resumeRevision, taskId, predecessor.runId).continuationIntentId);
        expect(allocations(h.store, taskId).every((row) => row.state === "continuing")).toBe(true);
      }
      // The held commitments transferred in place: one row per bucket, unchanged amounts.
      expect(allocations(h.store, "a")).toHaveLength(2);
      expect(allocations(h.store, "a").find((row) => row.bucket === "work")!.amount).toEqual(subtract(WORK_GRANT, USED));
      expect(wakeRows(h.store).map((row) => row.id)).toContain(`scheduler-wake:g:${resumeRevision}`);
      expect(pendingWakes(h.store).sort()).toEqual([...before.wakes, `scheduler-wake:g:${resumeRevision}`].sort());
      expect(continuationWakeBody(h.store, "g")).toMatchObject({ resumeRevision, continuations: [{ taskId: "b" }, { taskId: "a" }] });
      expect(revisionOf(h.store)).toBe(before.revision + 1);
      expect(commandCount(h.store)).toBe(before.commands + 1);
    } finally { await h.dispose(); }
  });

  it("holds an unselected recoverable task out of both the continuation batch and ordinary dispatch", async () => {
    const ctx = await continuationFixture(); const { h, service } = ctx; try {
      const a = await recoverablePredecessor(ctx, "a");
      await recoverablePredecessor(ctx, "b");
      await stoppedAfterHandoff(ctx);
      const result = await service.resumeFromHandoff(h.command("resume-from-handoff", { selections: [selection(a.predecessor)] }));
      if ("error" in result || result.result.kind !== "resumed-from-handoff") throw new Error(JSON.stringify(result));
      expect(result.result.pendingRuns.map((run) => run.taskId)).toEqual(["a"]);
      expect(workRow(h.store, "b").status).toBe("held");
      expect(workRow(h.store, "b").pendingRunId).toBeNull();
      expect(allocations(h.store, "b").every((row) => row.state === "held")).toBe(true);
      expect(await deliverScheduledStart(ctx.deps, "g")).toEqual({ kind: "claimed", runId: result.result.pendingRuns[0].pendingRunId });
      // The ordinary ready-work path claims neither the held item nor the continuing one.
      armOrdinaryClaim(h.store);
      expect(await deliverScheduledStart(ctx.deps, "g")).toMatchObject({ kind: "idle" });
      expect(taskRuns(h.store, "b")).toHaveLength(1);
      expect(workRow(h.store, "b").status).toBe("held");
    } finally { await h.dispose(); }
  });

  it("rejects the whole batch when one selection is not the canonical recoverable predecessor", async () => {
    const ctx = await continuationFixture(); const { h, service } = ctx; try {
      const a = await recoverablePredecessor(ctx, "a");
      const b = await recoverablePredecessor(ctx, "b");
      await stoppedAfterHandoff(ctx);
      const before = { revision: revisionOf(h.store), wakes: pendingWakes(h.store), commands: commandCount(h.store), a: workRow(h.store, "a"), b: workRow(h.store, "b") };
      const result = await service.resumeFromHandoff(h.command("resume-from-handoff", {
        selections: [selection(a.predecessor), { ...selection(b.predecessor), checkpointId: "cp-forged" }],
      }));
      expect(result).toMatchObject({ error: { code: "continuation-predecessor-unrecoverable" } });
      expect(workRow(h.store, "a")).toEqual(before.a);
      expect(workRow(h.store, "b")).toEqual(before.b);
      expect(allocations(h.store, "a").every((row) => row.state === "held")).toBe(true);
      expect(revisionOf(h.store)).toBe(before.revision);
      expect(pendingWakes(h.store)).toEqual(before.wakes);
      // A durable rejection is still an immutable command outcome, so the ledger row counts.
      expect(commandCount(h.store)).toBe(before.commands + 1);
      expect(readStopIntent(h.store, "g")!.state).toBe("handoff-complete");
      expect(groupBody(h.store).stopped).toBe(true);
    } finally { await h.dispose(); }
  });

  it("refuses a selection whose predecessor run is not the task's canonical settled history", async () => {
    const ctx = await continuationFixture(); const { h, service } = ctx; try {
      const a = await recoverablePredecessor(ctx, "a");
      await stoppedAfterHandoff(ctx);
      // A run id that never existed for the task cannot be a predecessor.
      const result = await service.resumeFromHandoff(h.command("resume-from-handoff", {
        selections: [{ ...selection(a.predecessor), predecessorRunId: "run-never-claimed" }],
      }));
      expect(result).toMatchObject({ error: { code: "continuation-predecessor-unrecoverable" } });
      expect(workRow(h.store, "a").status).toBe("held");
      expect(workRow(h.store, "a").pendingRunId).toBeNull();
      expect(activeRunIds(h.store)).toEqual([]);
    } finally { await h.dispose(); }
  });

  it("clears a completed stop with an empty selection when the frozen set was empty", async () => {
    const ctx = await continuationFixture(); const { h, service } = ctx; try {
      const stopped = await stoppedAfterHandoff(ctx);
      expect(stopped.result.frozenRunIds).toEqual([]);
      const before = revisionOf(h.store);
      const result = await service.resumeFromHandoff(h.command("resume-from-handoff", { selections: [] }));
      if ("error" in result || result.result.kind !== "resumed-from-handoff") throw new Error(JSON.stringify(result));
      expect(result.result.pendingRuns).toEqual([]);
      expect(result.result.wakeId).toBe(`scheduler-wake:g:${before + 1}`);
      expect(readStopIntent(h.store, "g")).toBeNull();
      expect(groupBody(h.store).stopped).toBe(false);
      expect(continuationWakeBody(h.store, "g")).toMatchObject({ resumeRevision: before + 1, continuations: [] });
    } finally { await h.dispose(); }
  });

  it("refuses to resume a partial handoff and never clears a pause with resume-from-handoff", async () => {
    const ctx = await continuationFixture(); const { h, service } = ctx; try {
      const paused = await service.pauseDispatch(h.command("pause-dispatch", {}));
      if ("error" in paused) throw new Error(JSON.stringify(paused));
      const rejected = await service.resumeFromHandoff(h.command("resume-from-handoff", { selections: [] }));
      expect(rejected).toMatchObject({ error: { code: "stop-mode-conflict" } });
      expect(readStopIntent(h.store, "g")!.mode).toBe("pause");
      expect(groupBody(h.store).stopped).toBe(true);
    } finally { await h.dispose(); }
  });

  it("refuses a stopped handoff whose group state is not complete", async () => {
    const ctx = await continuationFixture(); const { h, service } = ctx; try {
      await recoverablePredecessor(ctx, "a");
      // Task b keeps an active run, so its frozen request leaves the stop unresolved.
      expect(await deliverScheduledStart(ctx.deps, "g")).toMatchObject({ kind: "claimed" });
      await service.handoffStop(h.command("handoff-stop", {}));
      expect(groupStopState(h.store, "g")).toBe("handoff-pending");
      const before = revisionOf(h.store);
      const result = await service.resumeFromHandoff(h.command("resume-from-handoff", { selections: [] }));
      expect(result).toMatchObject({ error: { code: "group-state-invalid" } });
      expect(revisionOf(h.store)).toBe(before);
      expect(workRow(h.store, "a").status).toBe("held");
      expect(readStopIntent(h.store, "g")!.state).toBe("handoff-pending");
    } finally { await h.dispose(); }
  });

  it("replays the persisted result after response loss without a second claim registration", async () => {
    const ctx = await continuationFixture(); const { h, service } = ctx; try {
      const a = await recoverablePredecessor(ctx, "a");
      const b = await recoverablePredecessor(ctx, "b");
      await stoppedAfterHandoff(ctx);
      const command = h.command("resume-from-handoff", { selections: [selection(a.predecessor), selection(b.predecessor)] });
      const before = commandCount(h.store);
      const first = await service.resumeFromHandoff(command);
      const second = await service.resumeFromHandoff(command);
      if ("error" in first || first.result.kind !== "resumed-from-handoff") throw new Error(JSON.stringify(first));
      if ("error" in second || second.result.kind !== "resumed-from-handoff") throw new Error(JSON.stringify(second));
      expect(second).toEqual(first);
      expect(second.result.pendingRuns.map((run) => run.pendingRunId).sort())
        .toEqual(first.result.pendingRuns.map((run) => run.pendingRunId).sort());
      expect(revisionOf(h.store)).toBe(first.commandRevision);
      // Replaying a ledger entry is a lookup, not a second command row or a second registration.
      expect(commandCount(h.store)).toBe(before + 1);
      expect(wakeRows(h.store).filter((row) => row.kind === "resume")).toHaveLength(1);
      expect(continuationWakeBody(h.store, "g")!.continuations).toHaveLength(2);
      expect(workRow(h.store, "a").pendingRunId).toBe(first.result.pendingRuns[0].pendingRunId);
    } finally { await h.dispose(); }
  });

  it("refuses a selection whose held commitment no longer equals the inherited grant", async () => {
    const ctx = await continuationFixture(); const { h, service } = ctx; try {
      const a = await recoverablePredecessor(ctx, "a");
      await stoppedAfterHandoff(ctx);
      // Simulate a released commitment: the reserve went back but the run still claims usage.
      saveProposal(h.store, (proposal) => {
        for (const row of proposal.allocations) if (row.ownerId === "a" && row.bucket === "work") row.amount = amount({ tokens: 1 });
      });
      const before = { revision: revisionOf(h.store), wakes: pendingWakes(h.store) };
      const result = await service.resumeFromHandoff(h.command("resume-from-handoff", { selections: [selection(a.predecessor)] }));
      expect(result).toMatchObject({ error: { code: "recovery-blocked" } });
      expect(revisionOf(h.store)).toBe(before.revision);
      expect(pendingWakes(h.store)).toEqual(before.wakes);
      expect(workRow(h.store, "a").pendingRunId).toBeNull();
    } finally { await h.dispose(); }
  });

  it("refuses a soft-overrun predecessor that leaves no representable subtraction and rolls back", async () => {
    const ctx = await continuationFixture(); const { h, service } = ctx; try {
      // `attempts` exceeds the whole work grant: the inherited grant would go negative.
      const a = await recoverablePredecessor(ctx, "a", amount({ tokens: 10_000, activeMs: 60_000, attempts: 4, sessions: 3 }));
      await stoppedAfterHandoff(ctx);
      const before = { revision: revisionOf(h.store), wakes: pendingWakes(h.store), commands: commandCount(h.store), work: workRow(h.store, "a") };
      await expect(service.resumeFromHandoff(h.command("resume-from-handoff", { selections: [selection(a.predecessor)] })))
        .rejects.toThrow("budget-overrun");
      expect(revisionOf(h.store)).toBe(before.revision);
      expect(pendingWakes(h.store)).toEqual(before.wakes);
      expect(commandCount(h.store)).toBe(before.commands);
      expect(workRow(h.store, "a")).toEqual(before.work);
      expect(continuationWakeBody(h.store, "g")).toBeNull();
      expect(groupBody(h.store).stopped).toBe(true);
    } finally { await h.dispose(); }
  });
});

describe("continuation claim, lineage, and re-arm", () => {
  it("consumes the registered pending run id once and appends it to the task lineage", async () => {
    const ctx = await continuationFixture(); const { h, service } = ctx; try {
      const a = await recoverablePredecessor(ctx, "a");
      await stoppedAfterHandoff(ctx);
      const result = await service.resumeFromHandoff(h.command("resume-from-handoff", { selections: [selection(a.predecessor)] }));
      if ("error" in result || result.result.kind !== "resumed-from-handoff") throw new Error(JSON.stringify(result));
      const registered = result.result.pendingRuns[0];
      const resumeRevision = revisionOf(h.store);
      expect(await deliverScheduledStart(ctx.deps, "g")).toEqual({ kind: "claimed", runId: registered.pendingRunId });
      const run = runRow(h.store, registered.pendingRunId);
      expect(run).toMatchObject({ state: "starting", phase: "work", active: 1, generation: 1, claimOrdinal: 1, continuationIntentId: registered.continuationIntentId });
      // The claim carries the inherited grant, not the original plan default.
      expect(run.grant).toEqual({ work: subtract(WORK_GRANT, USED), handoff: HANDOFF_GRANT });
      expect(run.remaining).toEqual(run.grant);
      // The colon form is the desired identity; the persisted column keeps the hash-shaped one.
      expect(claimEnvelope(h.store, run.runId)).toMatchObject({
        claimIdentity: `${continuationIdentity("g", resumeRevision, "a", a.runId).desiredIntentId}:attempt:1`,
        continuationIntentId: registered.continuationIntentId, phase: "work",
      });
      const work = workRow(h.store, "a");
      expect(work).toMatchObject({ status: "running", currentRunId: run.runId, pendingRunId: null });
      expect(work.lineageRunIds).toEqual([a.runId, run.runId].sort());
    } finally { await h.dispose(); }
  });

  it("redelivers a lost continuation wake without registering or claiming a second run", async () => {
    const ctx = await continuationFixture(); const { h, service } = ctx; try {
      const a = await recoverablePredecessor(ctx, "a");
      await stoppedAfterHandoff(ctx);
      const result = await service.resumeFromHandoff(h.command("resume-from-handoff", { selections: [selection(a.predecessor)] }));
      if ("error" in result || result.result.kind !== "resumed-from-handoff") throw new Error(JSON.stringify(result));
      const registered = result.result.pendingRuns[0];
      expect(await deliverScheduledStart(ctx.deps, "g")).toEqual({ kind: "claimed", runId: registered.pendingRunId });
      h.store.db.prepare("UPDATE scheduler_wakes SET delivered=0 WHERE kind='resume'").run();
      expect(await deliverScheduledStart(ctx.deps, "g")).toEqual({ kind: "claimed", runId: registered.pendingRunId });
      expect(taskRuns(h.store, "a")).toHaveLength(2);
      expect(workRow(h.store, "a").lineageRunIds).toHaveLength(2);
      expect(continuationWakeBody(h.store, "g")).toBeNull();
    } finally { await h.dispose(); }
  });

  it("leaves the registered pending run id and ordinal untouched when the pre-claim probe fails", async () => {
    const ctx = await continuationFixture(); const { h, service } = ctx; try {
      const a = await recoverablePredecessor(ctx, "a");
      await stoppedAfterHandoff(ctx);
      const result = await service.resumeFromHandoff(h.command("resume-from-handoff", { selections: [selection(a.predecessor)] }));
      if ("error" in result || result.result.kind !== "resumed-from-handoff") throw new Error(JSON.stringify(result));
      const registered = result.result.pendingRuns[0];
      const before = revisionOf(h.store);
      h.setObserved(capabilities({ budgetEnforcement: "unavailable" }));
      expect(await deliverScheduledStart(ctx.deps, "g")).toMatchObject({ kind: "blocked" });
      const work = workRow(h.store, "a");
      expect(work).toMatchObject({ status: "continuing", pendingRunId: registered.pendingRunId, claimOrdinal: 1 });
      expect(work.lineageRunIds).toEqual([a.runId]);
      expect(taskRuns(h.store, "a")).toHaveLength(1);
      // Retry reuses the unconsumed pending id and ordinal.
      h.setObserved(capabilities());
      expect(await deliverScheduledStart(ctx.deps, "g")).toEqual({ kind: "claimed", runId: registered.pendingRunId });
      expect(workRow(h.store, "a").pendingRunId).toBeNull();
      expect(revisionOf(h.store)).toBe(before);
    } finally { await h.dispose(); }
  });

  it("re-arms a continuing intent after a failed-before-provider run with a new ordinal and run id", async () => {
    const ctx = await continuationFixture(); const { h, service } = ctx; try {
      const a = await recoverablePredecessor(ctx, "a");
      await stoppedAfterHandoff(ctx);
      const result = await service.resumeFromHandoff(h.command("resume-from-handoff", { selections: [selection(a.predecessor)] }));
      if ("error" in result || result.result.kind !== "resumed-from-handoff") throw new Error(JSON.stringify(result));
      const first = result.result.pendingRuns[0];
      const resumeRevision = revisionOf(h.store);
      expect(await deliverScheduledStart(ctx.deps, "g")).toEqual({ kind: "claimed", runId: first.pendingRunId });
      await settleProviderAttempt(ctx.deps, { runId: first.pendingRunId, phase: "work", firstAttemptProof: "invalid" });
      // The failed run stays historical and the logical item returns to `continuing`.
      expect(workRow(h.store, "a")).toMatchObject({ status: "continuing", currentRunId: first.pendingRunId, pendingRunId: null, claimOrdinal: 1 });
      const command = h.runCommand("recovery-retry", first.pendingRunId, { scope: "run", runId: first.pendingRunId });
      const retried = await service.recoveryRetry(command);
      if ("error" in retried || retried.result.kind !== "recovery-observed") throw new Error(JSON.stringify(retried));
      const rearmed = workRow(h.store, "a");
      expect(rearmed.claimOrdinal).toBe(2);
      expect(rearmed.pendingRunId).not.toBeNull();
      expect(rearmed.pendingRunId).not.toBe(first.pendingRunId);
      expect(rearmed.lineageRunIds).toEqual([a.runId, first.pendingRunId].sort());
      expect(continuationWakeBody(h.store, "g")).toMatchObject({ resumeRevision, continuations: [{ taskId: "a", predecessorRunId: a.runId, claimOrdinal: 2, pendingRunId: rearmed.pendingRunId }] });
      expect(await deliverScheduledStart(ctx.deps, "g")).toEqual({ kind: "claimed", runId: rearmed.pendingRunId });
      // The re-arm keeps the checkpoint-bearing predecessor and never reuses a claim identity.
      const intent = continuationIdentity("g", resumeRevision, "a", a.runId);
      expect(claimEnvelope(h.store, rearmed.pendingRunId!)).toMatchObject({
        claimIdentity: `${intent.desiredIntentId}:attempt:2`, continuationIntentId: intent.continuationIntentId,
      });
      expect(claimEnvelope(h.store, first.pendingRunId)).toMatchObject({ claimIdentity: `${intent.desiredIntentId}:attempt:1` });
      expect(taskRuns(h.store, "a").map((run) => run.runId).sort()).toEqual([a.runId, first.pendingRunId, rearmed.pendingRunId!].sort());
    } finally { await h.dispose(); }
  });

  it("blocks as identity-space-exhausted when the continuation claim ordinal cannot advance", async () => {
    const ctx = await continuationFixture(); const { h, service } = ctx; try {
      const a = await recoverablePredecessor(ctx, "a");
      await stoppedAfterHandoff(ctx);
      const result = await service.resumeFromHandoff(h.command("resume-from-handoff", { selections: [selection(a.predecessor)] }));
      if ("error" in result || result.result.kind !== "resumed-from-handoff") throw new Error(JSON.stringify(result));
      const first = result.result.pendingRuns[0];
      expect(await deliverScheduledStart(ctx.deps, "g")).toEqual({ kind: "claimed", runId: first.pendingRunId });
      await settleProviderAttempt(ctx.deps, { runId: first.pendingRunId, phase: "work", firstAttemptProof: "invalid" });
      saveWorkRow(h.store, "a", { ...workRow(h.store, "a"), claimOrdinal: Number.MAX_SAFE_INTEGER });
      const before = { wakes: pendingWakes(h.store), work: workRow(h.store, "a") };
      const retried = await service.recoveryRetry(h.runCommand("recovery-retry", first.pendingRunId, { scope: "run", runId: first.pendingRunId }));
      expect(retried).toMatchObject({ error: { code: "identity-space-exhausted" } });
      expect(workRow(h.store, "a").pendingRunId).toBeNull();
      expect(continuationWakeBody(h.store, "g")).toBeNull();
      expect(pendingWakes(h.store)).toEqual(before.wakes);
    } finally { await h.dispose(); }
  });
});

describe("direct per-task continue", () => {
  it("continues one held task while the group is dispatch-enabled", async () => {
    const ctx = await continuationFixture(); const { h, service } = ctx; try {
      const a = await recoverablePredecessor(ctx, "a");
      const b = await recoverablePredecessor(ctx, "b");
      await stoppedAfterHandoff(ctx);
      const resumed = await service.resumeFromHandoff(h.command("resume-from-handoff", { selections: [selection(a.predecessor)] }));
      if ("error" in resumed) throw new Error(JSON.stringify(resumed));
      expect(await deliverScheduledStart(ctx.deps, "g")).toMatchObject({ kind: "claimed" });
      const before = revisionOf(h.store);
      const result = await service.continueTask(h.taskCommand("continue-task", "b", { predecessorRunId: b.runId, checkpointId: b.checkpointId }));
      if ("error" in result || result.result.kind !== "task-continuing") throw new Error(JSON.stringify(result));
      const continueRevision = revisionOf(h.store);
      expect(continueRevision).toBe(before + 1);
      expect(result.result).toMatchObject({
        claimOrdinal: 1,
        continuationIntentId: continuationIdentity("g", continueRevision, "b", b.runId).continuationIntentId,
        wakeId: `scheduler-wake:g:${continueRevision}`,
      });
      const work = workRow(h.store, "b");
      expect(work).toMatchObject({ status: "continuing", currentRunId: b.runId, pendingRunId: result.result.pendingRunId, claimOrdinal: 1 });
      expect(work.pendingRunId).not.toBe(b.runId);
      expect(allocations(h.store, "b").every((row) => row.state === "continuing")).toBe(true);
      expect(allocations(h.store, "b")).toHaveLength(2);
      expect(continuationWakeBody(h.store, "g")!.continuations).toEqual([
        expect.objectContaining({ taskId: "b", predecessorRunId: b.runId, checkpointId: b.checkpointId, claimOrdinal: 1 }),
      ]);
      expect(await deliverScheduledStart(ctx.deps, "g")).toEqual({ kind: "claimed", runId: result.result.pendingRunId });
      expect(workRow(h.store, "b").lineageRunIds).toEqual([b.runId, result.result.pendingRunId].sort());
      expect(workRow(h.store, "a").status).toBe("running");
    } finally { await h.dispose(); }
  });

  it("refuses a direct continue that would bypass a group stop intent", async () => {
    const ctx = await continuationFixture(); const { h, service } = ctx; try {
      const a = await recoverablePredecessor(ctx, "a");
      const paused = await service.pauseDispatch(h.command("pause-dispatch", {}));
      if ("error" in paused) throw new Error(JSON.stringify(paused));
      const before = { revision: revisionOf(h.store), wakes: pendingWakes(h.store), commands: commandCount(h.store) };
      const result = await service.continueTask(h.taskCommand("continue-task", "a", { predecessorRunId: a.runId, checkpointId: a.checkpointId }));
      expect(result).toMatchObject({ error: { code: "group-stopped" } });
      expect(revisionOf(h.store)).toBe(before.revision);
      expect(pendingWakes(h.store)).toEqual(before.wakes);
      expect(commandCount(h.store)).toBe(before.commands + 1);
      expect(workRow(h.store, "a").status).toBe("held");
      expect(continuationWakeBody(h.store, "g")).toBeNull();
    } finally { await h.dispose(); }
  });

  it("refuses to continue a task whose commitment is not held and mutates nothing", async () => {
    const ctx = await continuationFixture(); const { h, service } = ctx; try {
      const a = await recoverablePredecessor(ctx, "a");
      await stoppedAfterHandoff(ctx);
      const resumed = await service.resumeFromHandoff(h.command("resume-from-handoff", { selections: [selection(a.predecessor)] }));
      if ("error" in resumed || resumed.result.kind !== "resumed-from-handoff") throw new Error(JSON.stringify(resumed));
      // The same recoverable predecessor, but the commitment already transferred.
      const before = { revision: revisionOf(h.store), wakes: pendingWakes(h.store), registered: workRow(h.store, "a").pendingRunId };
      const result = await service.continueTask(h.taskCommand("continue-task", "a", { predecessorRunId: a.runId, checkpointId: a.checkpointId }));
      expect(result).toMatchObject({ error: { code: "work-already-active" } });
      expect(revisionOf(h.store)).toBe(before.revision);
      expect(pendingWakes(h.store)).toEqual(before.wakes);
      expect(workRow(h.store, "a").pendingRunId).toBe(before.registered);
    } finally { await h.dispose(); }
  });
});

describe("dependency eligibility", () => {
  it("keeps a dependent ineligible while its predecessor is only continuing", async () => {
    const ctx = await continuationFixture([{ taskId: "a" }, { taskId: "b", dependsOn: ["a"] }]); const { h, service } = ctx; try {
      const a = await recoverablePredecessor(ctx, "a");
      await stoppedAfterHandoff(ctx);
      const result = await service.resumeFromHandoff(h.command("resume-from-handoff", { selections: [selection(a.predecessor)] }));
      if ("error" in result || result.result.kind !== "resumed-from-handoff") throw new Error(JSON.stringify(result));
      expect(await deliverScheduledStart(ctx.deps, "g")).toEqual({ kind: "claimed", runId: result.result.pendingRuns[0].pendingRunId });
      // Dependency checks read the logical task status, and `continuing` never satisfies one.
      expect(workRow(h.store, "b").status).toBe("ready");
      expect(taskRuns(h.store, "b")).toEqual([]);
      armOrdinaryClaim(h.store);
      expect(await deliverScheduledStart(ctx.deps, "g")).toMatchObject({ kind: "idle" });
      expect(taskRuns(h.store, "b")).toEqual([]);
    } finally { await h.dispose(); }
  });
});

/** `idSchema` accepts the hash-shaped persisted identity and rejects the colon form. */
function idSchemaFree(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value);
}
