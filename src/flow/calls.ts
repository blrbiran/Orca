/**
 * Flow engine spec §6.2-§6.3 (plan Task 10; Task 8 deferral (a)): a flow run's single calls -- `flow-draft`,
 * `flow-review`, `flow-ask`, `rerun-proposal`, and a flow `clarify` step's `clarify` -- run on the parent group through
 * the existing execution driver, each with an allocation drawn from the run pool.
 *
 * - Claim (the kernel's call port, in its own transaction): draw from the pool (idempotent per call id), freeze the
 *   prompt, schema and output cap as the call's contract, and insert the single-call run on the parent's frozen profile
 *   and agent slot (flow/parent.ts); the driver takes it from `starting` as any single call.
 * - Settle (Ce, in the driver's transaction): the shared stop and usage checks, the unused grant back to the parent's
 *   ledger and to the pool, and the raw output stored on the execution (`callResult`). The handler judges nothing: the
 *   kernel's next pass gives it to the kind's `collect` (completeFlowCall), which may need the kernel's own I/O.
 *
 * A pool that cannot fund the call parks the execution with `flow-pool-exhausted`, as for a work child.
 */
import { callOf, type SettledRun } from "../control/requirementCalls.js";
import type { CallRecord } from "../control/requirementSchemas.js";
import { randomUUID } from "node:crypto";
import { add, subtract } from "../control/budget.js";
import { canonicalBytes, sha256Canonical } from "../control/canonicalJson.js";
import { zero } from "../control/commands.js";
import { ControlError } from "../control/errors.js";
import { readGroup, saveGroup } from "../control/queries.js";
import { REQUIREMENT_CALL_GRANT } from "../control/requirementSchemas.js";
import { singleCallClaimRowOf, type SingleCallPurpose } from "../control/singleCall.js";
import { assertCallUsageBooked, closeSingleCall, insertSingleCallRun, verifyStoppedSingleCall, type StoppedSingleCallRun } from "../control/singleCallLedger.js";
import type { SingleCallHandler, SingleCallRunRow } from "../control/singleCallPurposes.js";
import { readCanonicalRecord, writeCanonicalRecord } from "../control/snapshot.js";
import type { AdmissionGate } from "../control/admissionGate.js";
import type { ControlStore } from "../control/store.js";
import type { FlowCallPort, FlowCallRequest } from "./kernel.js";
import { readParentConfirmation } from "./parent.js";
import { drawAllocation, POOL_EXHAUSTED, returnUnspent } from "./pool.js";
import { FEEDBACK_KEY, finishExecution, getIntake, getPlan, listExecutions, moveIntake, PLAN_KEY, putPlan, type ExecutionKey } from "./store.js";
import type { IntakeBody } from "./feedback/intakeSchema.js";
import type { CallRef } from "./spend.js";

/** What a flow call's run row carries besides the shared single-call fields: the execution it answers. */
export interface FlowCallIdentity { flowRunId: string; stepKey: string; seq: number }
export type FlowCallResult = { runId: string; rawOutput: unknown; failure: string | null };

const contractRowOf = (groupId: string, workItemId: string): string => `single-call-contract:${groupId}:${workItemId}`;

function executionOf(store: ControlStore, key: ExecutionKey) {
  return listExecutions(store, key.flowRunId).find((e) => e.stepKey === key.stepKey && e.seq === key.seq);
}

/**
 * Spec §7.3: a plan's rerun-proposal call answers the plan (`{flowRunId, "@plan", planNo}`), not an execution. Its
 * waiting state is the plan's open proposal; its result goes onto the proposal for the kernel's next pass.
 */
type PlanCall = { call: { runId?: string } | null; callResult?: FlowCallResult; skips: unknown; calls?: CallRef[] };
function planCallOf(store: ControlStore, key: ExecutionKey) {
  const plan = getPlan(store, key.flowRunId, key.seq);
  const proposal = plan?.proposal as PlanCall | null | undefined;
  return plan === null || plan.state !== "proposed" || proposal == null || proposal.call === null || proposal.skips !== null ? null : { plan, proposal };
}
function setPlanCall(store: ControlStore, key: ExecutionKey, patch: Partial<PlanCall>): void {
  const open = planCallOf(store, key)!;
  putPlan(store, { ...open.plan, proposal: { ...open.proposal, ...patch } });
}

/**
 * Gaps spec §4.4, §4.6: a feedback intake's single call (triage, its clarify round) answers the intake
 * (`{flowRunId, "@feedback", messageSeq}`); its waiting state is the intake's open `call`, its result goes there too.
 */
function intakeCallOf(store: ControlStore, key: ExecutionKey) {
  const intake = getIntake(store, key.flowRunId, key.seq);
  const call = intake?.body.call ?? null;
  return intake === null || call === null || call.callResult !== null ? null : { intake, call };
}
function setIntakeCall(store: ControlStore, key: ExecutionKey, patch: Partial<NonNullable<IntakeBody["call"]>>): void {
  const open = intakeCallOf(store, key)!;
  moveIntake(store, key.flowRunId, key.seq, open.intake.state, open.intake.state, { ...open.intake.body, call: { ...open.call, ...patch } }, Date.now());
}
function claimIntakeCall(store: ControlStore, request: FlowCallRequest): "claimed" | "exhausted" | "unconfirmed" {
  const open = intakeCallOf(store, request.key);
  if (open?.call.runId !== null) throw new ControlError("recovery-blocked", `flow-call-intake-moved:${request.key.seq}`);
  // Gaps spec §10: the intake appended the call's entry before it sent it (intake.ts); the claim names its run there.
  // A claim with no such entry breaks that invariant: refused loud, before anything is drawn (Rule 12).
  const calls = [...open!.intake.body.calls];
  let entry = -1;
  for (let i = calls.length - 1; i >= 0 && entry < 0; i -= 1) if (calls[i]!.runId === undefined && calls[i]!.purpose === request.purpose) entry = i;
  if (entry < 0) throw new ControlError("recovery-blocked", `flow-call-intake-unrequested:${request.key.seq}:${request.purpose}`);
  const parent = readParentConfirmation(store, request.groupId);
  if (parent?.call == null) { setIntakeCall(store, request.key, { callResult: { runId: "", rawOutput: null, failure: "flow-call-unconfirmed" } }); return "unconfirmed"; }
  const claimed = insertCallRun(store, request, parent.call);
  if ("exhausted" in claimed) { setIntakeCall(store, request.key, { callResult: { runId: "", rawOutput: null, failure: POOL_EXHAUSTED } }); return "exhausted"; }
  // Gaps spec §10: the run that answers this call stays named on the intake's calls list (its spend reads it).
  calls[entry] = { ...calls[entry]!, runId: claimed.runId };
  moveIntake(store, request.key.flowRunId, request.key.seq, open!.intake.state, open!.intake.state, { ...open!.intake.body, call: { ...open!.call, runId: claimed.runId }, calls }, Date.now());
  return "claimed";
}

/**
 * The claim, in the caller's transaction. Answers `claimed`, `exhausted` (the execution is parked) or `unconfirmed`
 * (the parent has no call profile: the execution fails `flow-call-unconfirmed`).
 */
export function claimFlowCall(store: ControlStore, request: FlowCallRequest, at: number): "claimed" | "exhausted" | "unconfirmed" {
  if (request.key.stepKey === PLAN_KEY) return claimPlanCall(store, request, at);
  if (request.key.stepKey === FEEDBACK_KEY) return claimIntakeCall(store, request);
  const parent = readParentConfirmation(store, request.groupId);
  const execution = executionOf(store, request.key);
  if (execution === undefined || execution.state !== "running") throw new ControlError("recovery-blocked", `flow-call-execution-moved:${request.key.stepKey}#${request.key.seq}`);
  const body = execution.body as Record<string, unknown>;
  const { call: _sent, ...unsent } = body;
  if (parent?.call == null) {
    finishExecution(store, request.key, "running", "failed", at, { body: { ...unsent, failure: "flow-call-unconfirmed" } });
    return "unconfirmed";
  }
  const claimed = insertCallRun(store, request, parent.call);
  if ("exhausted" in claimed) {
    finishExecution(store, request.key, "running", "parked", at, { body: { ...unsent, needsYou: { reason: POOL_EXHAUSTED, detail: claimed.exhausted } } });
    return "exhausted";
  }
  // Gaps spec §10: `calls` keeps every run this execution's calls were answered by; completeFlowCall deletes only `call`.
  const calls = [...((body.calls as CallRef[] | undefined) ?? []), { runId: claimed.runId, purpose: request.purpose }];
  finishExecution(store, request.key, "running", "running", at, { body: { ...body, call: { purpose: request.purpose, runId: claimed.runId }, calls } });
  return "claimed";
}

/** The plan's proposal call: as an execution's, except that what cannot be funded settles the proposal as failed. */
function claimPlanCall(store: ControlStore, request: FlowCallRequest, _at: number): "claimed" | "exhausted" | "unconfirmed" {
  if (planCallOf(store, request.key) === null) throw new ControlError("recovery-blocked", `flow-call-plan-moved:${request.key.seq}`);
  const parent = readParentConfirmation(store, request.groupId);
  if (parent?.call == null) {
    setPlanCall(store, request.key, { callResult: { runId: "", rawOutput: null, failure: "flow-call-unconfirmed" } });
    return "unconfirmed";
  }
  const claimed = insertCallRun(store, request, parent.call);
  if ("exhausted" in claimed) {
    setPlanCall(store, request.key, { callResult: { runId: "", rawOutput: null, failure: POOL_EXHAUSTED } });
    return "exhausted";
  }
  setPlanCall(store, request.key, { call: { runId: claimed.runId }, calls: [...(planCallOf(store, request.key)!.proposal.calls ?? []), { runId: claimed.runId, purpose: request.purpose }] });
  return "claimed";
}

/** Draw the call's grant from the pool, freeze its contract and insert its single-call run on the parent's frozen slot. */
function insertCallRun(store: ControlStore, request: FlowCallRequest, parentCall: NonNullable<NonNullable<ReturnType<typeof readParentConfirmation>>["call"]>): { runId: string } | { exhausted: { remaining: number; wanted: number } } {
  const parent = { call: parentCall };
  // A work item id takes no '@'; '.plan' is no step id (slugs have no '.') and no LIKE wildcard.
  const segment = request.key.stepKey === PLAN_KEY ? ".plan" : request.key.stepKey === FEEDBACK_KEY ? ".feedback" : request.key.stepKey;
  const attempt = store.db.prepare("SELECT count(*) AS n FROM runs WHERE group_id=? AND work_item_id LIKE ?").get(request.groupId, `flow-${segment}-${request.key.seq}-%`)!.n as number + 1;
  const workItemId = `flow-${segment}-${request.key.seq}-${attempt}`;
  const row = store.db.prepare("SELECT pool_tokens, pool_drawn FROM flow_runs WHERE id=?").get(request.key.flowRunId)!;
  const wanted = Math.min(REQUIREMENT_CALL_GRANT.tokens, Number(row.pool_tokens) - Number(row.pool_drawn));
  const draw = drawAllocation(store, request.key.flowRunId, `call:${request.groupId}:${workItemId}`, wanted);
  if ("exhausted" in draw) return draw;
  const grant = { ...REQUIREMENT_CALL_GRANT, tokens: draw.drawn };
  const contract = {
    schema: "orca-flow-call-contract-v1", groupId: request.groupId, ...request.key, purpose: request.purpose, attempt,
    prompt: request.prompt, responseSchema: request.responseSchema, maxOutputTokens: Math.min(request.maxOutputTokens, parent.call.maxOutputTokens),
    grant: { work: grant, handoff: zero() }, profile: parent.call.profile, configHash: parent.call.agentSlot.configHash,
  };
  const contractHash = sha256Canonical(contract);
  writeCanonicalRecord(store, request.groupId, contractHash, canonicalBytes(contract).toString("utf8"));
  store.db.prepare("INSERT INTO outbox(id,kind,body,delivered) VALUES (?,?,?,1)").run(contractRowOf(request.groupId, workItemId), "single-call-contract",
    canonicalBytes({ groupId: request.groupId, workItemId, contractHash }).toString("utf8"));
  const runId = `run-${randomUUID()}`;
  const flowCall: FlowCallIdentity = { ...request.key };
  const { envelopeHash } = insertSingleCallRun(store, {
    groupId: request.groupId, workItemId, runId, ownerToken: randomUUID(), purpose: request.purpose as SingleCallPurpose, identity: { flowCall },
    graphVersion: 1, targetVersion: attempt, commandId: workItemId, slot: parent.call.agentSlot, agentCapabilities: parent.call.agentSlot.capabilities,
    workGrant: grant, profile: parent.call.profile, claimIdentity: `single-call:${request.groupId}:${workItemId}:${attempt}`, derivedContractHash: contractHash,
  });
  const claimRow = singleCallClaimRowOf("single-call", request.groupId, workItemId, runId);
  store.db.prepare("INSERT INTO outbox(id,kind,body,delivered) VALUES (?,?,?,1)").run(claimRow.id, claimRow.kind, canonicalBytes({ groupId: request.groupId, workItemId, runId, envelopeHash }).toString("utf8"));
  // The parent's ledger holds the grant while the call runs, as a clarifying group's does (requirementCalls.ts).
  const group = readGroup(store, request.groupId);
  group.reserved = add(group.reserved, grant);
  saveGroup(store, group);
  return { runId };
}

/** The production call port: each request is claimed at once, in its own transaction; the pump's driver runs it. */
export function createFlowCallPort(deps: { store: ControlStore; now(): number; admissionGate?: AdmissionGate; kick?(): void }): FlowCallPort {
  return {
    request(request) {
      const release = deps.admissionGate?.enter();
      try { deps.store.transaction(() => claimFlowCall(deps.store, request, deps.now())); }
      finally { release?.(); }
      deps.kick?.();
    },
  };
}

function flowCallOf(run: SingleCallRunRow): FlowCallIdentity {
  const identity = (run as { flowCall?: FlowCallIdentity }).flowCall;
  if (identity === undefined) throw new ControlError("recovery-blocked", `flow-call-identity-missing:${run.runId}`);
  return identity;
}

/** The unused grant back to the parent's ledger and to the pool, once the call's usage is known. */
function giveBack(store: ControlStore, run: StoppedSingleCallRun, identity: FlowCallIdentity): void {
  const group = readGroup(store, run.groupId);
  // Usage booking already took what the call spent out of `reserved` (usage.ts); what is left of the grant goes too.
  group.reserved = subtract(group.reserved, run.remaining.work);
  saveGroup(store, group);
  returnUnspent(store, identity.flowRunId, `call:${run.groupId}:${run.workItemId}`, run.cumulative.work.tokens);
}

/** The output (or the failure) on the execution, for the kernel's next pass; a call the execution no longer waits on is dropped. */
function storeResult(store: ControlStore, identity: FlowCallIdentity, result: FlowCallResult): void {
  if (identity.stepKey === PLAN_KEY) {
    if (planCallOf(store, identity)?.proposal.call?.runId === result.runId) setPlanCall(store, identity, { callResult: result });
    return;
  }
  if (identity.stepKey === FEEDBACK_KEY) {
    if (intakeCallOf(store, identity)?.call.runId === result.runId) setIntakeCall(store, identity, { callResult: result });
    return;
  }
  const execution = executionOf(store, identity);
  const call = (execution?.body as { call?: { runId?: string } } | undefined)?.call;
  if (execution === undefined || execution.state !== "running" || call?.runId !== result.runId) return;
  finishExecution(store, identity, "running", "running", Date.now(), { body: { ...(execution.body as object), callResult: result } });
}

export const FLOW_CALL_HANDLER: Omit<SingleCallHandler, "purpose"> = {
  async prepare(deps, run) {
    const identity = flowCallOf(run);
    const execution = executionOf(deps.store, identity);
    const moved = identity.stepKey === PLAN_KEY ? planCallOf(deps.store, identity)?.proposal.call?.runId !== run.runId
      : identity.stepKey === FEEDBACK_KEY ? intakeCallOf(deps.store, identity)?.call.runId !== run.runId
      : execution === undefined || execution.state !== "running" || (execution.body as { call?: { runId?: string } }).call?.runId !== run.runId;
    if (moved) return { blocked: "flow-call-target-moved" };
    const pointer = deps.store.db.prepare("SELECT body FROM outbox WHERE id=? AND kind='single-call-contract'").get(contractRowOf(run.groupId, run.workItemId));
    if (pointer === undefined) return { blocked: "flow-call-contract-missing" };
    const contract = JSON.parse(readCanonicalRecord(deps.store, String(JSON.parse(String(pointer.body)).contractHash))) as { prompt: string; responseSchema: Record<string, unknown>; maxOutputTokens: number };
    return { prompt: contract.prompt, responseSchema: contract.responseSchema, maxOutputTokens: contract.maxOutputTokens };
  },
  classify: () => null,
  complete(deps, runRow, rawOutput, commitTerminal, failure = null) {
    const release = deps.admissionGate?.enter();
    try {
      deps.store.transaction(() => {
        const receiptId = `single-call-result:${runRow.groupId}:${runRow.runId}`;
        if (deps.store.db.prepare("SELECT id FROM outbox WHERE id=? AND kind='single-call-result'").get(receiptId)) return;
        commitTerminal();
        const row = deps.store.db.prepare("SELECT id,active,body FROM runs WHERE id=?").get(runRow.runId);
        if (!row) throw new ControlError("run-not-found");
        const identity = flowCallOf(runRow);
        const grant = (JSON.parse(String(row.body)) as { grant: { work: StoppedSingleCallRun["grant"]["work"] } }).grant.work;
        const run = verifyStoppedSingleCall(deps.store, row, { groupId: runRow.groupId, workItemId: runRow.workItemId, workGrant: grant }, "flow-call-ledger");
        assertCallUsageBooked(readGroup(deps.store, run.groupId) as unknown as Parameters<typeof assertCallUsageBooked>[0], run, "flow-call-usage-unknown");
        giveBack(deps.store, run, identity);
        storeResult(deps.store, identity, { runId: run.runId, rawOutput, failure });
        closeSingleCall(deps.store, run.runId, { id: receiptId, kind: "single-call-result", body: { groupId: run.groupId, runId: run.runId } });
      });
    } finally { release?.(); }
  },
  usageUnknownReason: "flow-call-usage-unknown",
};

/** Stop (stopIntent.ts terminaliseRun): the call ended under a stop; its grant goes back and the execution learns it failed. */
export function interruptFlowCall(store: ControlStore, run: StoppedSingleCallRun): void {
  const identity = flowCallOf(run as unknown as SingleCallRunRow);
  giveBack(store, run, identity);
  storeResult(store, identity, { runId: run.runId, rawOutput: null, failure: "interrupted" });
}

/**
 * Task 8 deferral (d): a flow clarify round's record of one of its calls, as a requirement round keeps it (callOf):
 * the settled run's id and usage. Null when the execution's output came from no driver run (a criterion's fake port).
 */
export function callRecordOf(store: ControlStore, runId: string | undefined, outcome: CallRecord["outcome"], reason: string | null): CallRecord | null {
  if (runId === undefined) return null;
  const row = store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId);
  if (row === undefined) return null;
  return callOf(JSON.parse(String(row.body)) as SettledRun, outcome, reason);
}

/** Whether a single-call run row is a flow call (its purpose may be `clarify`, shared with a requirement's). */
export const isFlowCallRun = (run: unknown): boolean => typeof run === "object" && run !== null && (run as { flowCall?: unknown }).flowCall !== undefined;
