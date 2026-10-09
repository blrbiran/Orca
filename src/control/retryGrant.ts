import { createHash } from "node:crypto";
import { frozenWorkAgent } from "./agentFreeze.js";
import { sha256Canonical } from "./canonicalJson.js";
import { ControlError } from "./errors.js";
import { readArchivedPlan, readBudgetProposal } from "./queries.js";
import { idSchema } from "./schema.js";
import { readCanonicalRecord } from "./snapshot.js";
import { latestRequestForRun } from "./stopIntent.js";
import type { ControlStore } from "./store.js";
import { hasValidUsageSettlement, settlementSame } from "./usageSettlement.js";
import { dispatchEnvelopeSchema } from "./webProtocol.js";

/** Live retry commitment authority, shared by dispatch, contract readers and the panel. */
export function validateRetryGrantSource(store: ControlStore, groupId: string, subject: unknown): void {
  const work = subject as Record<string, any>;
  const proposal = readBudgetProposal(store, groupId);
  const allocations = proposal.allocations.filter(a => a.ownerKind === "task" && a.ownerId === work.workItemId);
  const sourceId = work.retryGrantSourceRunId;
  const bad = (detail: string): never => { throw new ControlError("recovery-blocked", `retry-source:${work.workItemId}:${detail}`); };
  if (sourceId === undefined) {
    if (allocations.some(a => a.state === "retrying")) bad("missing");
    return;
  }
  try {
    if (!idSchema.safeParse(sourceId).success || allocations.length !== 2 || allocations.some(a => a.state !== "retrying")
      || work.pendingRunId != null || work.continuation != null || !["ready", "running", "blocked"].includes(work.status)) bad("work-state");
    const graphVersion = readArchivedPlan(store, groupId).graphVersion;
    const rows = store.db.prepare("SELECT id,group_id,work_item_id,generation,active,body FROM runs WHERE group_id=? AND work_item_id=? ORDER BY rowid").all(groupId, work.workItemId);
    const index = rows.findIndex(row => row.id === sourceId);
    if (index < 0 || rows.at(-1)?.id !== work.currentRunId || !Array.isArray(work.lineageRunIds)
      || work.lineageRunIds.length !== rows.length || new Set(work.lineageRunIds).size !== rows.length || rows.some(row => !work.lineageRunIds.includes(row.id))) bad("lineage");
    const source = JSON.parse(String(rows[index]!.body));
    if (Number(rows[index]!.active) !== 0 || source.state !== "settled-failed" || source.drive?.outcome == null || source.drive.outcome === "succeeded"
      || source.unknown.work || source.unknown.handoff || !settlementSame(work.grant, source.grant)) bad("source-state");
    if (source.usageSettlement !== undefined && !hasValidUsageSettlement(store, source)) bad("settlement");
    for (const bucket of ["work", "handoff"] as const) {
      const allocation = allocations.find(a => a.bucket === bucket);
      if (!allocation || !settlementSame(allocation.amount, source.grant[bucket])) bad("amount");
    }
    for (let i = index; i < rows.length; i++) {
      const row = rows[i]!, run = JSON.parse(String(row.body));
      if (run.runId !== row.id || run.groupId !== groupId || run.workItemId !== work.workItemId || run.taskId !== work.taskId
        || run.generation !== Number(row.generation) || run.graphVersion !== graphVersion || run.targetVersion !== work.targetVersion
        || !settlementSame(frozenWorkAgent(run), frozenWorkAgent(work)) || !settlementSame(run.grant, source.grant)) bad("identity");
      const claimRow = store.db.prepare("SELECT body FROM outbox WHERE id=? AND kind='work-claim'").get(`work:${groupId}:${run.runId}`);
      if (!claimRow) bad("claim");
      const hash = JSON.parse(String(claimRow!.body)).envelopeHash;
      const envelope = dispatchEnvelopeSchema.parse(JSON.parse(readCanonicalRecord(store, hash)));
      if (sha256Canonical(envelope) !== hash || envelope.runId !== run.runId || envelope.groupId !== groupId || envelope.workItemId !== work.workItemId
        || envelope.generation !== run.generation || envelope.claimOrdinal !== run.claimOrdinal
        || envelope.continuationIntentId !== (run.continuationIntentId ?? null) || envelope.derivedContractHash !== work.derivedContractHash
        || !proposal.profiles || !settlementSame(run.executionProfile, { workKind: "task", ...proposal.profiles.worker })
        || !settlementSame(run.handoffProfile, { workKind: "handoff", ...proposal.profiles.handoff })
        || !settlementSame(envelope.profiles.worker, proposal.profiles.worker) || !settlementSame(envelope.profiles.handoff, proposal.profiles.handoff)
        || envelope.ownerTokenHash !== createHash("sha256").update(run.ownerToken).digest("hex") || !settlementSame(envelope.grants, source.grant)) bad("claim-identity");
      if (store.db.prepare("SELECT seq FROM usage_events WHERE run_id=? AND seq>?").get(run.runId, run.highWater)) bad("pending-usage");
      if (i === index) continue;
      if (run.continuationIntentId != null) bad("continuation");
      const parts = envelope.claimIdentity.split(":");
      if (parts.length !== 6 || parts[0] !== "task" || parts[1] !== groupId || parts[3] !== work.taskId
        || parts[4] !== "attempt" || Number(parts[5]) !== run.claimOrdinal || !Number.isSafeInteger(Number(parts[2])) || Number(parts[2]) <= 0) bad("normal-claim");
      const current = i === rows.length - 1;
      if (current && Number(row.active) === 1) {
        if (!["running", "blocked"].includes(work.status)
          || !["starting", "start-pending", "accepted", "unknown", "collected", "landed", "reconciling", "blocked", "attempt-unknown", "attempt-proof-invalid"].includes(run.state)) bad("active-work");
        continue;
      }
      const noStart = run.state === "failed-before-provider" && run.failureCode === "request-bound-proof-invalid" && run.executionId === null;
      const restartable = run.state === "settled-restartable" && run.executionId === null && latestRequestForRun(store, groupId, run.runId)?.state === "settled-restartable";
      if (Number(row.active) !== 0 || (!noStart && !restartable) || (current && work.status !== "ready")
        || run.unknown.work || run.unknown.handoff || !settlementSame(run.remaining, run.grant)
        || ["work", "handoff"].some(b => Object.values(run.cumulative[b]).some(v => v !== 0))) bad("no-provider");
    }
    if (rows.length === index + 1 && work.status !== "ready") bad("source-work");
  } catch (error) {
    if (error instanceof ControlError && error.code === "recovery-blocked") throw error;
    bad("invalid");
  }
}
