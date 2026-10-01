import { randomUUID } from "node:crypto";
import { add, subtract } from "./budget.js";
import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { fits, zero } from "./commands.js";
import { ControlError } from "./errors.js";
import { buildClarifyPrompt, CLARIFY_JSON_SCHEMA, classifyClarifyOutput } from "./requirementClarify.js";
import { buildRepositoryOverview } from "./requirementOverview.js";
import {
  clarifyingLedger, latestDraft, latestRound, queueRequirementCall, readDraft, readRequirementGroup, readRound, readRounds, saveRequirementGroup,
  writeDraft, writeRound, type RequirementGroup,
} from "./requirementRecords.js";
import { MAX_AUTO_RETRIES, REQUIREMENT_CALL_GRANT, type CallRecord } from "./requirementSchemas.js";
import { assertCallUsageBooked, closeSingleCall, insertSingleCallRun, verifyStoppedSingleCall, type StoppedSingleCallRun } from "./singleCallLedger.js";
import type { SingleCallHandler, SingleCallPrepareDeps, SingleCallRunRow } from "./singleCallPurposes.js";
import { writeCanonicalRecord } from "./snapshot.js";
import type { AdmissionGate } from "./admissionGate.js";
import type { ControlStore } from "./store.js";

/**
 * N1 spec §5.2, §7 (and §8 for Task 7's split): a requirement's call -- a round's clarify call or a draft's split call --
 * claimed from its durable wake, prepared at A2 with the repository overview, and settled into the clarifying group's
 * own ledger (never releaseRunReserve's legacy branch, survey S28). The claim and settlement plumbing every single call
 * shares lives in singleCallLedger.ts (PR-I4); the ledger mirror is clarifyingLedger's (PR-I5).
 */

export type RequirementTarget = { kind: "round" | "draft"; no: number; workItemId: string; purpose: "clarify" | "split" };
export interface SettledRun extends StoppedSingleCallRun { overview?: { hash: string; commit: string } | null }

/** DR4: `round-<n>` is a clarify call, `draft-<n>` a split call. */
export function targetOf(workItemId: string): RequirementTarget {
  const match = /^(round|draft)-([1-9]\d*)$/.exec(workItemId);
  if (!match) throw new ControlError("recovery-blocked", `requirement-work-item:${workItemId}`);
  const kind = match[1] as "round" | "draft";
  return { kind, no: Number(match[2]), workItemId, purpose: kind === "round" ? "clarify" : "split" };
}

/** The call a clarifying group is waiting for: the latest round while there is no consensus, else the latest draft. */
export function pendingRequirementCall(store: ControlStore, groupId: string): RequirementTarget | null {
  const group = readRequirementGroup(store, groupId);
  if (group.status !== "clarifying") return null;
  if (group.requirement.consensus === null) {
    const round = latestRound(store, groupId);
    return round?.state === "drafting" ? targetOf(`round-${round.roundNo}`) : null;
  }
  const draft = latestDraft(store, groupId);
  return draft?.state === "drafting" ? targetOf(`draft-${draft.draftNo}`) : null;
}

/** PR-I5: the clarifying ledger mirror after `reserved` moved; usage booking keeps `usageUnknown` (budget.ts). */
function syncLedger(group: RequirementGroup): void {
  group.ledger = clarifyingLedger(group.limit, group.used, group.reserved, group.ledger.usageUnknown);
}

function setWaiting(store: ControlStore, groupId: string, target: RequirementTarget, waiting: "requirement-budget-exhausted" | null): void {
  if (target.kind === "round") { const round = readRound(store, groupId, target.no); if (round.waiting !== waiting) writeRound(store, groupId, { ...round, waiting }); }
  else { const draft = readDraft(store, groupId, target.no); if (draft.waiting !== waiting) writeDraft(store, groupId, { ...draft, waiting }); }
}

/**
 * A requirement call's rows are keyed by work item (DR4), so each attempt of a round or draft replaces the previous
 * attempt's claim and contract rows; an earlier attempt's run is inactive by then (preflight scan m15).
 */
function upsertOutbox(store: ControlStore, id: string, kind: string, body: unknown): void {
  store.db.prepare("INSERT INTO outbox(id,kind,body,delivered) VALUES (?,?,?,1) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(id, kind, canonicalBytes(body).toString("utf8"));
}

/**
 * N1 spec §5.2 and DR14: claim the call the group is waiting for, in the wake handler's transaction. A grant that no
 * longer fits the remaining limit is not claimed: the round or draft waits with requirement-budget-exhausted.
 */
export function claimRequirementCallInTransaction(store: ControlStore, groupId: string): "claimed" | "nothing" | "waiting" | "held" {
  const group = readRequirementGroup(store, groupId);
  if (group.status !== "clarifying") return "nothing";
  if (group.stopped || store.db.prepare("SELECT group_id FROM stop_intents WHERE group_id=?").get(groupId)) return "held";
  const target = pendingRequirementCall(store, groupId);
  if (target === null) return "nothing";
  if (store.db.prepare("SELECT id FROM runs WHERE group_id=? AND work_item_id=? AND active=1").get(groupId, target.workItemId)) return "nothing";
  const reserved = add(group.reserved, REQUIREMENT_CALL_GRANT);
  if (!fits(group.used, reserved, group.limit)) { setWaiting(store, groupId, target, "requirement-budget-exhausted"); return "waiting"; }
  setWaiting(store, groupId, target, null);
  const attempt = (target.kind === "round" ? readRound(store, groupId, target.no).calls : readDraft(store, groupId, target.no).calls).length + 1;
  const slot = group.requirement.agentSlot, profile = group.requirement.profile;
  const contract = { schema: "orca-requirement-call-contract-v1", groupId, requirementId: group.requirement.requirementId, purpose: target.purpose,
    workItemId: target.workItemId, attempt, grant: { work: { ...REQUIREMENT_CALL_GRANT }, handoff: zero() }, profile, configHash: slot.configHash };
  const contractHash = sha256Canonical(contract);
  writeCanonicalRecord(store, groupId, contractHash, canonicalBytes(contract).toString("utf8"));
  upsertOutbox(store, `single-call-contract:${groupId}:${target.workItemId}`, "single-call-contract", { groupId, workItemId: target.workItemId, contractHash });
  const runId = `run-${randomUUID()}`;
  const { envelopeHash } = insertSingleCallRun(store, {
    groupId, workItemId: target.workItemId, runId, ownerToken: randomUUID(), purpose: target.purpose, identity: { estimateId: null, overview: null },
    graphVersion: 1, targetVersion: attempt, commandId: target.workItemId, slot, agentCapabilities: slot.capabilities, workGrant: REQUIREMENT_CALL_GRANT, profile,
    claimIdentity: `single-call:${groupId}:${target.workItemId}:${attempt}`, derivedContractHash: contractHash,
  });
  upsertOutbox(store, `single-call:${groupId}:${target.workItemId}`, "single-call-claim", { groupId, workItemId: target.workItemId, runId, envelopeHash });
  group.reserved = reserved;
  syncLedger(group);
  saveRequirementGroup(store, group);
  return "claimed";
}

/** The pump's `requirement-call` handler: true when the wake's effect is in place; a held group keeps the wake pending. */
export async function claimRequirementCall(deps: { store: ControlStore; admissionGate?: AdmissionGate }, groupId: string): Promise<boolean> {
  const release = deps.admissionGate?.enter();
  try { return deps.store.transaction(() => claimRequirementCallInTransaction(deps.store, groupId)) !== "held"; }
  finally { release?.(); }
}

/**
 * A2 (spec §6): the overview of HEAD's commit, built from the target repository. Only this half is caught by the
 * handler as `repository-path`: a resolveRepository refusal, or any failure of the build (git, export, cache).
 * Task 5: overview builds are safe only one at a time (the builder sweeps every tmp-* directory). This runs only from
 * the driver's A2 (executionDriver.ts stepA2SingleCall), and the driver's pass visits its runs one after another and a
 * re-entrant round joins the pass in flight (createExecutionDriver), so no two builds overlap.
 */
async function buildOverviewFor(deps: SingleCallPrepareDeps, run: SingleCallRunRow, group: RequirementGroup) {
  const repo = deps.resolveRepository(group.requirement.repoId);
  return buildRepositoryOverview({ repo, repoId: group.requirement.repoId, stateDir: deps.store.stateDir, runId: run.runId, astGrepBin: deps.astGrepBin ?? null });
}

/** The overview stored with the group and named on the run, before the prompt is built. A store fault here is not the repository's. */
function storeOverview(deps: SingleCallPrepareDeps, run: SingleCallRunRow, built: Awaited<ReturnType<typeof buildOverviewFor>>): void {
  const release = deps.admissionGate?.enter();
  try {
    deps.store.transaction(() => {
      writeCanonicalRecord(deps.store, run.groupId, built.hash, built.canonicalJson);
      const row = deps.store.db.prepare("SELECT body FROM runs WHERE id=?").get(run.runId);
      if (!row) throw new ControlError("run-not-found");
      const body = JSON.parse(String(row.body)) as Record<string, unknown>;
      body.overview = { hash: built.hash, commit: built.overview.commit };
      deps.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(body), run.runId);
    });
  } finally { release?.(); }
}

/**
 * Ce (spec §5.1 "complete in the store") for both requirement purposes: the stop and usage checks every single call
 * shares (singleCallLedger.ts), the unused grant given back to the clarifying ledger, the call recorded with its
 * purpose's outcome.
 */
export function settleRequirementCall(
  deps: { store: ControlStore; admissionGate?: AdmissionGate }, runRow: SingleCallRunRow, commitTerminal: () => void,
  record: (store: ControlStore, group: RequirementGroup, target: RequirementTarget, run: SettledRun) => void,
): void {
  const release = deps.admissionGate?.enter();
  try {
    deps.store.transaction(() => {
      const receiptId = `single-call-result:${runRow.groupId}:${runRow.runId}`;
      if (deps.store.db.prepare("SELECT id FROM outbox WHERE id=? AND kind='single-call-result'").get(receiptId)) return;
      commitTerminal();
      const row = deps.store.db.prepare("SELECT id,active,body FROM runs WHERE id=?").get(runRow.runId);
      if (!row) throw new ControlError("run-not-found");
      const run: SettledRun = verifyStoppedSingleCall(deps.store, row, { groupId: runRow.groupId, workItemId: runRow.workItemId, workGrant: REQUIREMENT_CALL_GRANT }, "requirement-call-ledger");
      const group = readRequirementGroup(deps.store, run.groupId);
      assertCallUsageBooked(group, run, "requirement-usage-unknown");
      group.reserved = subtract(group.reserved, run.remaining.work);
      syncLedger(group);
      record(deps.store, group, targetOf(run.workItemId), run);
      saveRequirementGroup(deps.store, group);
      closeSingleCall(deps.store, run.runId, { id: receiptId, kind: "single-call-result", body: { groupId: run.groupId, runId: run.runId } });
    });
  } finally { release?.(); }
}

export const callOf = (run: SettledRun, outcome: CallRecord["outcome"], reason: string | null): CallRecord => ({
  runId: run.runId, overviewHash: run.overview?.hash ?? null, commit: run.overview?.commit ?? null, usage: run.cumulative.work, outcome, reason,
});

/** Spec §7.3 and H7: a valid round awaits answers; an invalid one is retried at most twice, then fails. */
function recordClarify(store: ControlStore, group: RequirementGroup, target: RequirementTarget, run: SettledRun, rawOutput: unknown): void {
  const round = readRound(store, group.groupId, target.no);
  if (round.state !== "drafting") throw new ControlError("recovery-blocked", "requirement-round-moved");
  const earlierQuestionIds = readRounds(store, group.groupId).filter((r) => r.roundNo < round.roundNo).flatMap((r) => r.result?.questions.map((q) => q.id) ?? []);
  const classified = classifyClarifyOutput(rawOutput, { roundNo: round.roundNo, requirementId: group.requirement.requirementId, earlierQuestionIds });
  round.calls = [...round.calls, callOf(run, classified.ok ? "valid" : "invalid", classified.ok ? null : classified.reason)];
  if (classified.ok) {
    Object.assign(round, { result: classified.result, state: "awaiting-answers", lastInvalidReason: null });
    if (round.roundNo === 1) group.requirement.slug = classified.result.slug;
  } else if (round.retries < MAX_AUTO_RETRIES) {
    Object.assign(round, { retries: round.retries + 1, lastInvalidReason: classified.reason });
    queueRequirementCall(store, group.groupId, `retry-${run.runId}`);
  } else {
    Object.assign(round, { state: "failed", reasonCode: "clarify-output-invalid", lastInvalidReason: classified.reason });
  }
  writeRound(store, group.groupId, round);
}

/**
 * Stop (stopIntent.ts terminaliseRun, inside the request's settlement): the call ended under a stop proof, its usage
 * already booked by collection. Its round or draft is interrupted and the unused grant given back. The group stays
 * stopped with its completed handoff intent; DR15's recovery-retry (Task 9) lifts both and re-queues the round.
 */
export function interruptRequirementCall(store: ControlStore, groupId: string, run: SettledRun): void {
  const group = readRequirementGroup(store, groupId);
  group.reserved = subtract(group.reserved, run.remaining.work);
  syncLedger(group);
  const target = targetOf(run.workItemId), call = callOf(run, "interrupted", null);
  if (target.kind === "round") {
    const round = readRound(store, groupId, target.no);
    if (round.state === "drafting") writeRound(store, groupId, { ...round, state: "interrupted", calls: [...round.calls, call] });
  } else {
    const draft = readDraft(store, groupId, target.no);
    if (draft.state === "drafting") writeDraft(store, groupId, { ...draft, state: "interrupted", calls: [...draft.calls, call] });
  }
  saveRequirementGroup(store, group);
}

export const CLARIFY_HANDLER: SingleCallHandler = {
  purpose: "clarify",
  async prepare(deps, run) {
    const group = readRequirementGroup(deps.store, run.groupId);
    const target = targetOf(run.workItemId);
    const round = readRound(deps.store, run.groupId, target.no);
    if (group.status !== "clarifying" || round.state !== "drafting") return { blocked: "requirement-call-target-moved" };
    // A resolveRepository refusal or a failed build is repository-shaped and named on the run; recovery-retry re-runs A2.
    let built: Awaited<ReturnType<typeof buildOverviewFor>>;
    try { built = await buildOverviewFor(deps, run, group); } catch { return { blocked: "repository-path" }; }
    // Outside the catch: a draining panel or a store fault ends the round as any other step's does.
    storeOverview(deps, run, built);
    return {
      prompt: buildClarifyPrompt({ idea: group.requirement.idea, contentLanguage: group.requirement.contentLanguage, overview: built,
        earlier: readRounds(deps.store, run.groupId).filter((r) => r.roundNo < target.no), retryReason: round.lastInvalidReason }),
      responseSchema: CLARIFY_JSON_SCHEMA as Record<string, unknown>,
      maxOutputTokens: group.requirement.maxOutputTokens,
    };
  },
  classify: classifyClarifyOutput,
  complete(deps, run, rawOutput, commitTerminal) {
    settleRequirementCall(deps, run, commitTerminal, (store, group, target, settled) => recordClarify(store, group, target, settled, rawOutput));
  },
  usageUnknownReason: "requirement-usage-unknown",
};
