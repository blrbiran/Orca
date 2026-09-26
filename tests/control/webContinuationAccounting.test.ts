import { describe, expect, it } from "vitest";
import type { SQLInputValue } from "node:sqlite";
import { WebControlService } from "../../src/control/webService.js";
import { settleHandoffRequest } from "../../src/control/stopIntent.js";
import { createWebWakeHandlers, deliverScheduledStart } from "../../src/control/webDispatch.js";
import { deliverSchedulerWakes } from "../../src/control/dispatch.js";
import { recordUsage } from "../../src/control/usage.js";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import { subtract } from "../../src/control/budget.js";
import { dimensions, zero } from "../../src/control/commands.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";
import type { Amount } from "../../src/control/types.js";

const ACCEPTED_AT = "2026-09-20T10:00:00.000Z";
const WORK_GRANT: Amount = { tokens: 3_000_000, activeMs: 14_400_000, attempts: 3, sessions: 3 };
const HANDOFF_GRANT: Amount = { tokens: 300_000, activeMs: 1_800_000, attempts: 0, sessions: 0 };
const BIG_LIMIT: Amount = { tokens: 9_000_000, activeMs: 43_200_000, attempts: 12, sessions: 12 };
const USED: Amount = { tokens: 10_000, activeMs: 60_000, attempts: 1, sessions: 1 };

const clamp = (grant: Amount, used: Amount): Amount => {
  const result = zero();
  for (const dimension of dimensions) result[dimension] = Math.max(grant[dimension] - used[dimension], 0);
  return result;
};
const inherited = { work: clamp(WORK_GRANT, USED), handoff: clamp(HANDOFF_GRANT, zero()) };

type Fixture = Awaited<ReturnType<typeof webFixture>>;
type ControlStore = Fixture["store"];
type StopDeps = Parameters<typeof settleHandoffRequest>[0];

function body<T>(store: ControlStore, sql: string, ...args: SQLInputValue[]): T {
  return JSON.parse(String((store.db.prepare(sql).get(...args) as { body: string }).body)) as T;
}

interface RunView {
  state: string; phase: string; taskId: string; workItemId: string; checkpointId: string | null; recoverable: boolean;
  generation: number; graphVersion: number; targetVersion: number; highWater: number;
  grant: { work: Amount; handoff: Amount }; remaining: { work: Amount; handoff: Amount };
}

const runView = (store: ControlStore, runId: string) => body<RunView>(store, "SELECT body FROM runs WHERE id=?", runId);
const workRow = (store: ControlStore, taskId: string) =>
  body<{ grant: { work: Amount; handoff: Amount }; status: string; currentRunId: string | null }>(store, "SELECT body FROM work_items WHERE group_id=? AND id=?", "g", taskId);
const allocationAmounts = (store: ControlStore, taskId: string) => {
  const proposal = body<{ allocations: Array<{ ownerKind: string; ownerId: string; bucket: string; amount: Amount }> }>(store, "SELECT body FROM budget_proposals WHERE group_id=?", "g");
  return Object.fromEntries(proposal.allocations
    .filter(row => row.ownerKind === "task" && row.ownerId === taskId)
    .map(row => [row.bucket, row.amount]));
};
const ledger = (store: ControlStore) => body<{ used: Amount; reserved: Amount; status: string }>(store, "SELECT body FROM groups WHERE id=?", "g");
const requestIdFor = (store: ControlStore, runId: string) => String((store.db.prepare("SELECT id FROM handoff_requests WHERE run_id=?").get(runId) as { id: string }).id);
const activeRunIds = (store: ControlStore) => (store.db.prepare("SELECT id FROM runs WHERE group_id='g' AND active=1 ORDER BY id").all() as Array<{ id: string }>).map(row => String(row.id));
const runCount = (store: ControlStore, taskId: string) => Number((store.db.prepare("SELECT COUNT(*) AS n FROM runs WHERE group_id='g' AND work_item_id=?").get(taskId) as { n: number }).n);
const pendingWakes = (store: ControlStore) => (store.db.prepare("SELECT id FROM scheduler_wakes WHERE group_id='g' AND delivered=0 ORDER BY rowid").all() as Array<{ id: string }>).map(row => String(row.id));
const revisionOf = (store: ControlStore) => Number((store.db.prepare("SELECT revision FROM groups WHERE id='g'").get() as { revision: number }).revision);

/** The durable ready-work wake a settlement leaves for the next ordinary claim. */
function armOrdinaryClaim(store: ControlStore): void {
  const revision = revisionOf(store);
  store.db.prepare("INSERT INTO scheduler_wakes(id,group_id,kind,body,delivered) VALUES (?,?,'start',?,0) ON CONFLICT(id) DO UPDATE SET delivered=0")
    .run(`scheduler-wake:g:${revision}:settled`, "g", canonicalBytes({ groupId: "g", startRevision: revision }).toString("utf8"));
}

/** Charge `used` against an active run through the adapter-facing usage recorder. */
function chargeUsage(store: ControlStore, runId: string, used: Amount): void {
  recordUsage(store, {
    runId, generation: 1, eventSeq: 1, bucket: "work", cumulative: used,
    source: { artifactId: `usage-${runId}`, hash: sha256Canonical({ runId, used }) },
  });
}

/**
 * Settle `runId` recoverably through the adapter-facing API and park the committed-checkpoint
 * identity on it. No production settlement path writes that identity for a web handoff, so
 * §6.3's predecessor validation is otherwise unreachable.
 */
function settleRecoverable(store: ControlStore, deps: StopDeps, runId: string): { taskId: string; predecessorRunId: string; checkpointId: string } {
  settleHandoffRequest(deps, { requestId: requestIdFor(store, runId), outcome: "settled-recoverable" });
  const run = runView(store, runId);
  const checkpointId = `cp-${runId}`;
  const candidate = {
    schema: "orca-checkpoint-candidate-v1", checkpointId, groupId: "g", workItemId: run.workItemId, taskId: run.taskId, runId,
    generation: run.generation, graphVersion: run.graphVersion, targetVersion: run.targetVersion, usageHighWater: run.highWater,
    result: "partial", artifacts: [], snapshot: null, missing: [], unresolvedRequestIds: [], stopProof: null,
    terminalOutcome: "cancelled",
  };
  store.db.prepare("INSERT INTO checkpoints(id,run_id,hash,body) VALUES (?,?,?,?)")
    .run(checkpointId, runId, sha256Canonical(candidate), canonicalBytes(candidate).toString("utf8"));
  store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({ ...run, checkpointId, recoverable: true }), runId);
  return { taskId: run.taskId, predecessorRunId: runId, checkpointId };
}

/** A confirmed group with one `starting` run per named task. */
async function runningTasks(tasks: string[]) {
  const h = await webFixture(profileSnapshot(), tasks.map(taskId => ({ taskId })));
  const deps = { ...h.deps, now: () => new Date(ACCEPTED_AT) };
  const service = new WebControlService(deps);
  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): confirmation resolves agent selections through ccloop first, so it is awaited and carries the previewed selectionsHash.
  await service.confirm(h.command("confirm", await h.confirmPayload()));
  await service.start(h.command("start", {}));
  await deliverScheduledStart(deps, "g");
  for (let extra = 1; extra < tasks.length; extra += 1) {
    armOrdinaryClaim(h.store);
    await deliverScheduledStart(deps, "g");
  }
  expect(activeRunIds(h.store)).toHaveLength(tasks.length);
  return { h, deps, service };
}

/** Spend, then stop the group and hand every running task back recoverably. */
async function handedOff(tasks: string[]) {
  const ctx = await runningTasks(tasks);
  const { h, service } = ctx;
  for (const runId of activeRunIds(h.store)) chargeUsage(h.store, runId, USED);
  const stopped = await service.handoffStop(h.command("handoff-stop", {}));
  if ("error" in stopped) throw new Error(JSON.stringify(stopped));
  return ctx;
}

describe("recoverable handoff settlement and continuation grants", () => {
  it("parks only the unspent remainder of the predecessor grant on a recoverable settlement", async () => {
    const { h, deps } = await handedOff(["a"]);
    try {
      const [runId] = activeRunIds(h.store);
      settleRecoverable(h.store, deps, runId);
      // §5.1.1 books `recoverable, held, or continuing work` at `each predecessor bucket's
      // grant minus settled cumulative usage`, so the parked commitment reads that remainder.
      expect(runView(h.store, runId).remaining).toEqual(inherited);
      expect(allocationAmounts(h.store, "a")).toEqual(inherited);
      expect(workRow(h.store, "a").grant).toEqual(inherited);
    } finally { await h.dispose(); }
  });

  it("keeps the ledger conserved across a real settlement so authority changes stay admissible", async () => {
    const { h, deps, service } = await handedOff(["a"]);
    try {
      settleRecoverable(h.store, deps, activeRunIds(h.store)[0]);
      expect(service.setLimit(h.command("set-limit", { limit: BIG_LIMIT }))).toMatchObject({ result: { kind: "limit-set" } });
    } finally { await h.dispose(); }
  });

  it("claims a continuation at the inherited remainder, not at the original plan grant", async () => {
    const { h, deps, service } = await handedOff(["a"]);
    try {
      const predecessor = settleRecoverable(h.store, deps, activeRunIds(h.store)[0]);
      const resumed = await service.resumeFromHandoff(h.command("resume-from-handoff", { selections: [predecessor] }));
      if ("error" in resumed || resumed.result.kind !== "resumed-from-handoff") throw new Error(JSON.stringify(resumed));
      const pendingRunId = resumed.result.pendingRuns[0].pendingRunId;
      expect(await deliverScheduledStart(deps, "g")).toEqual({ kind: "claimed", runId: pendingRunId });

      const continuation = runView(h.store, pendingRunId);
      expect(continuation.grant).toEqual({ work: subtract(WORK_GRANT, USED), handoff: HANDOFF_GRANT });
      expect(continuation.remaining).toEqual(continuation.grant);
      // The group limit is 4M tokens with 10k already spent; a continuation that re-booked the
      // full 3M plan grant would put 3_010_000 of 4_000_000 behind one task, and the run would
      // then hold more than the group reserves, failing conservation on every later write.
      expect(continuation.grant.work.tokens).toBeLessThan(WORK_GRANT.tokens);
      expect(service.setLimit(h.command("set-limit", { limit: BIG_LIMIT }))).toMatchObject({ result: { kind: "limit-set" } });
    } finally { await h.dispose(); }
  });

  it("releases a commitment exactly once when the adapter settles the same request twice", async () => {
    const { h, deps, service } = await handedOff(["a"]);
    try {
      const runId = activeRunIds(h.store)[0];
      settleHandoffRequest(deps, { requestId: requestIdFor(h.store, runId), outcome: "settled-unrecoverable", reasonCode: "profile-changed" });
      const settled = ledger(h.store);
      expect(settled.reserved.tokens).toBeGreaterThan(0);
      // A re-delivered settle is the same settlement, not a second one: releasing twice
      // under-books the group's live runs and lets `fits()` admit claims past the limit.
      expect(settleHandoffRequest(deps, { requestId: requestIdFor(h.store, runId), outcome: "settled-unrecoverable", reasonCode: "profile-changed" }))
        .toMatchObject({ state: "settled-unrecoverable" });
      expect(ledger(h.store)).toEqual(settled);
      expect(workRow(h.store, "a").status).toBe("blocked");
    } finally { await h.dispose(); }
  });

  it("leaves a wake with unknown usage undelivered instead of claiming on an unknowable budget", async () => {
    const { h, deps, service } = await runningTasks(["a"]);
    try {
      const runId = activeRunIds(h.store)[0];
      // A gap in the adapter's usage stream is what sets the flag, and it is sticky until
      // recovery resolves the actual usage (§5.1.1, last row).
      recordUsage(h.store, {
        runId, generation: 1, eventSeq: 1, bucket: "work", cumulative: null,
        source: { artifactId: `gap-${runId}`, hash: sha256Canonical({ runId, gap: true }) },
      });
      const stopped = await service.handoffStop(h.command("handoff-stop", {}));
      if ("error" in stopped) throw new Error(JSON.stringify(stopped));
      const predecessor = settleRecoverable(h.store, deps, runId);
      const resumed = await service.resumeFromHandoff(h.command("resume-from-handoff", { selections: [predecessor] }));
      if ("error" in resumed || resumed.result.kind !== "resumed-from-handoff") throw new Error(JSON.stringify(resumed));
      const pendingRunId = resumed.result.pendingRuns[0].pendingRunId;

      expect(await deliverScheduledStart(deps, "g")).toMatchObject({ kind: "blocked", reason: "usage-unknown" });
      expect(h.store.db.prepare("SELECT id FROM runs WHERE id=?").get(pendingRunId)).toBeUndefined();
      expect(pendingWakes(h.store)).toContain(`scheduler-wake:g:${revisionOf(h.store)}`);
    } finally { await h.dispose(); }
  });

  it("claims every registered continuation of one resume wake", async () => {
    const { h, deps, service } = await handedOff(["a", "b"]);
    try {
      const predecessors = activeRunIds(h.store).map(runId => settleRecoverable(h.store, deps, runId));
      const resumed = await service.resumeFromHandoff(h.command("resume-from-handoff", { selections: predecessors }));
      if ("error" in resumed || resumed.result.kind !== "resumed-from-handoff") throw new Error(JSON.stringify(resumed));
      expect(resumed.result.pendingRuns).toHaveLength(2);

      await deliverSchedulerWakes(h.store, createWebWakeHandlers({ ...h.deps, service }));

      // §6.3 has wake delivery attempt the registered continuations in request order, so one
      // sweep may not leave the second task `continuing` with no wake left to run it.
      const claimed = new Set((h.store.db.prepare("SELECT id FROM runs WHERE group_id='g'").all() as Array<{ id: string }>).map(row => String(row.id)));
      expect(resumed.result.pendingRuns.filter(row => claimed.has(row.pendingRunId))).toHaveLength(2);
      for (const registered of resumed.result.pendingRuns) {
        expect(runView(h.store, registered.pendingRunId).state, registered.taskId).toBe("starting");
      }
      expect(pendingWakes(h.store)).toEqual([]);
      expect(runCount(h.store, "a")).toBe(2);
      expect(runCount(h.store, "b")).toBe(2);
    } finally { await h.dispose(); }
  });
});
