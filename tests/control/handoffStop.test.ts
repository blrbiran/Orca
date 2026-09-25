import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import { persistCanonicalCheckpoint } from "../../src/control/checkpoints.js";
import { readBudgetProposal } from "../../src/control/queries.js";
import {
  freezeRun, handoffRequestFromOutbox, readHandoffRequest, readStopIntent, saveHandoffRequest, settleCompletedRunRequestInTransaction,
  settleHandoffRequest, writeHandoffRequest,
} from "../../src/control/stopIntent.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import type { Candidate } from "../../src/control/types.js";
import { driverHarness } from "./fixtures/driverHarness.js";

// Handoff delivery spec §11 I9, §11 C1, §13.1 C-5, §13.2 C-1, C-6, I-10, Minor a: the stop-side parts the
// driver's H step (Task 4) and the continuation's A2 (Task 5) are assembled from.

const row = (t: Awaited<ReturnType<typeof driverHarness>>, table: "runs" | "work_items", id: string): string =>
  String(t.h.store.db.prepare(`SELECT body FROM ${table} WHERE id=?`).get(id)!.body);

async function stopped(tasks = [{ taskId: "a" }]) {
  const t = await driverHarness(tasks);
  const runIds: string[] = [];
  for (let i = 0; i < tasks.length; i += 1) runIds.push(await t.claim());
  return { t, runIds };
}

async function handoffStop(t: Awaited<ReturnType<typeof driverHarness>>): Promise<string[]> {
  const result = await t.service.handoffStop(t.h.command("handoff-stop", {}));
  if ("error" in result || result.result.kind !== "handoff-stopped") throw new Error(`handoff-stop refused: ${JSON.stringify(result)}`);
  return result.result.requestIds;
}

describe("a restartable run gives its task back (spec §11 I9, Minor a)", () => {
  it("puts a plain run's task back to ready, keeps the allocation confirmed and gives nothing back to the group", async () => {
    const { t, runIds: [runId] } = await stopped(); try {
      const [requestId] = await handoffStop(t);
      const reservedBefore = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)).reserved;
      const allocationsBefore = readBudgetProposal(t.h.store, "g").allocations.filter((a) => a.ownerId === "a").map((a) => ({ state: a.state, amount: a.amount }));
      settleHandoffRequest({ store: t.h.store, profileRouter: t.h.deps.profileRouter }, { requestId: requestId!, outcome: "settled-restartable" });
      expect(t.body(runId!)).toMatchObject({ state: "settled-restartable" });
      expect(t.h.store.db.prepare("SELECT active FROM runs WHERE id=?").get(runId!)!.active).toBe(0);
      // Before this slice the task was parked `held` with no way out (stopIntent.ts terminaliseRun, review I9).
      expect(JSON.parse(row(t, "work_items", "a")).status).toBe("ready");
      expect(readBudgetProposal(t.h.store, "g").allocations.filter((a) => a.ownerId === "a").map((a) => ({ state: a.state, amount: a.amount }))).toEqual(allocationsBefore);
      expect(JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)).reserved).toEqual(reservedBefore);
      expect(readControlGroup(t.h.store, "epoch-test", "g").runs.map((run) => run.state)).toEqual(["settled-restartable"]);
    } finally { await t.h.dispose(); }
  });
});

describe("a run that finished settles its request on its own (spec §11 C1)", () => {
  // Handoff delivery (human ruling 2026-09-25, spec §12: this slice may rewrite criteria; ruling 88 (b)(c)): this criterion
  // was added in this slice (Task 3) and its setup is corrected to the function's precondition (a run already settled
  // through E) under the controller ruling on the C-5 stop state (deriveStopState counts an active run with a settled
  // request as unresolved), 2026-09-25.
  it("marks only the request settled-recoverable: the run, its work item and the allocations are not touched", async () => {
    const { t, runIds: [runId] } = await stopped(); try {
      const [requestId] = await handoffStop(t);
      // E's releaseRunReserve leaves a settled run inactive; that is the only run this function is called for.
      t.h.store.db.prepare("UPDATE runs SET active=0 WHERE id=?").run(runId!);
      const before = { run: row(t, "runs", runId!), work: row(t, "work_items", "a"), proposal: JSON.stringify(readBudgetProposal(t.h.store, "g")) };
      t.h.store.transaction(() => settleCompletedRunRequestInTransaction(t.h.store, "g", requestId!));
      expect(readHandoffRequest(t.h.store, "g", requestId!).request.state).toBe("settled-recoverable");
      expect({ run: row(t, "runs", runId!), work: row(t, "work_items", "a"), proposal: JSON.stringify(readBudgetProposal(t.h.store, "g")) }).toEqual(before);
      expect(readStopIntent(t.h.store, "g")!.state).toBe("handoff-complete");
      // A second call is the same settlement, not a second one.
      t.h.store.transaction(() => settleCompletedRunRequestInTransaction(t.h.store, "g", requestId!));
      expect(readHandoffRequest(t.h.store, "g", requestId!).request.state).toBe("settled-recoverable");
    } finally { await t.h.dispose(); }
  });
});

describe("the delivered request is rebuilt from its original outbox row (spec §13.2 I-10)", () => {
  it("maps a human stop to reason human and keeps the outbox deadline even after the request row's deadline is shortened", async () => {
    const { t, runIds: [runId] } = await stopped(); try {
      const [requestId] = await handoffStop(t);
      const intent = readStopIntent(t.h.store, "g")!;
      const built = handoffRequestFromOutbox(t.h.store, requestId!);
      expect(built).toEqual({ protocol: 1, requestId, runId, generation: 1, reason: "human", deadlineAt: intent.deadlineAt });
      // adoptRequest/deliverHandoffStop shorten the row, never the outbox: ccloop judges a replay by the whole
      // request's canonical hash (ccloop handoff.ts), so a replay must carry the bytes first sent.
      const { request } = readHandoffRequest(t.h.store, "g", requestId!);
      t.h.store.transaction(() => saveHandoffRequest(t.h.store, "g", { ...request, deadlineAt: "2026-01-01T00:00:00.000Z" }));
      expect(handoffRequestFromOutbox(t.h.store, requestId!)).toEqual(built);
    } finally { await t.h.dispose(); }
  });

  it("maps a shutdown freeze to reason shutdown", async () => {
    const { t, runIds: [runId] } = await stopped(); try {
      const requestId = t.h.store.transaction(() => freezeRun(t.h.store, "g", runId!, "shutdown", 99, "2026-09-25T00:00:00.000Z", "2026-09-25T00:02:00.000Z"));
      expect(handoffRequestFromOutbox(t.h.store, requestId)).toMatchObject({ reason: "shutdown", deadlineAt: "2026-09-25T00:02:00.000Z", runId });
    } finally { await t.h.dispose(); }
  });
});

describe("a stop never loses its brake over one contradictory run (spec §13.1 C-5)", () => {
  it("records the run whose request already settled as a recovery blocker and still freezes the group's other run", async () => {
    const { t, runIds } = await stopped([{ taskId: "a" }, { taskId: "b" }]); try {
      const [settledRun, liveRun] = runIds;
      t.h.store.transaction(() => writeHandoffRequest(t.h.store, { requestId: "handoff-old", runId: settledRun!, state: "settled-recoverable", deadlineAt: "2026-09-25T00:30:00.000Z", phaseAttemptOrdinal: 1, failureCode: null, evidenceIds: [] }, "g"));
      const requestIds = await handoffStop(t);
      expect(requestIds).toHaveLength(2);
      expect(requestIds).toContain("handoff-old");
      const fresh = requestIds.find((id) => id !== "handoff-old")!;
      expect(readHandoffRequest(t.h.store, "g", fresh).request).toMatchObject({ runId: liveRun, state: "request-pending" });
      expect(t.h.store.db.prepare("SELECT run_id,scope,code FROM recovery_blockers WHERE group_id='g'").all().map((r) => ({ ...r })))
        .toEqual([{ run_id: settledRun, scope: "run", code: "handoff-request-already-settled" }]);
    } finally { await t.h.dispose(); }
  });
});

describe("a handoff checkpoint is stored as canonical bytes (spec §13.2 C-1)", () => {
  const candidate = (runId: string, checkpointId = `settle-${runId}-0123456789abcdef`): Candidate => ({
    groupId: "g", workItemId: "a", taskId: "a", runId, generation: 1, graphVersion: 1, targetVersion: 1, checkpointId, usageHighWater: 2,
    result: "partial", artifacts: [{ artifactId: "x", hash: "a".repeat(64) }], snapshot: { artifactId: "s", hash: "b".repeat(64) }, missing: [],
    unresolvedRequestIds: [], stopProof: { executionId: "e", generation: 1, isolated: true, source: { artifactId: "p", hash: "c".repeat(64) } },
    terminalOutcome: "executing", handoff: { artifactId: "h", hash: "d".repeat(64) },
  });

  it("writes the file as canonicalBytes and answers sha256Canonical, the identity all three readers accept, and a replay is a no-op", async () => {
    const { t, runIds: [runId] } = await stopped(); try {
      const c = candidate(runId!);
      const first = await persistCanonicalCheckpoint(t.h.store, c);
      const path = join(t.h.store.stateDir, "checkpoints", runId!, `${c.checkpointId}.json`);
      expect(readFileSync(path).equals(canonicalBytes(c))).toBe(true);
      expect(first).toEqual({ checkpointId: c.checkpointId, hash: sha256Canonical(c), body: canonicalBytes(c).toString("utf8") });
      // exportResumeBundle hashes JSON.stringify(JSON.parse(file)); on canonical bytes that is the same hash.
      expect(Buffer.from(JSON.stringify(JSON.parse(readFileSync(path, "utf8")))).equals(canonicalBytes(c))).toBe(true);
      expect(await persistCanonicalCheckpoint(t.h.store, c)).toEqual(first);
    } finally { await t.h.dispose(); }
  });

  it("refuses different bytes under an id already written", async () => {
    const { t, runIds: [runId] } = await stopped(); try {
      await persistCanonicalCheckpoint(t.h.store, candidate(runId!));
      await expect(persistCanonicalCheckpoint(t.h.store, { ...candidate(runId!), usageHighWater: 3 })).rejects.toThrow("checkpoint-id-conflict");
      expect(existsSync(join(t.h.store.stateDir, "checkpoints", runId!))).toBe(true);
    } finally { await t.h.dispose(); }
  });
});
