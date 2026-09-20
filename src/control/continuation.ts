import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { ControlStore } from "./store.js";
import type { Claim, CommandMeta, ExecutionProfileBinding } from "./types.js";
import type { CommandErrorBodyV1, CommandSuccessV1, ExecutionSnapshotV1, RawAuthorityCommandV1 } from "./webProtocol.js";
import type { ExecutionProfileRouter } from "./profiles.js";
import type { AdmissionGate } from "./admissionGate.js";
import { applyCommand, dimensions, fits, zero } from "./commands.js";
import { readBudgetProposal, readGroup, readWork, saveGroup, saveWork } from "./queries.js";
import { add, readRun, subtract, type RunRecord } from "./budget.js";
import { ControlError } from "./errors.js";
import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { applyWebCommand } from "./commandLedger.js";
import { idSchema, safeInteger } from "./schema.js";
import {
  commandSuccess,
  groupCommandTarget,
  groupStopState,
  readGroupBody,
  readStopIntent,
  saveGroupBody,
  setAllocationStates,
  type RunBody,
  type StopDeps,
} from "./stopIntent.js";

export interface ContinuationClaimInput extends CommandMeta {groupId:string;predecessorRunId:string;workItemId:string;taskId:string;graphVersion:number;targetVersion:number;executionProfile?:ExecutionProfileBinding;handoffProfile?:ExecutionProfileBinding}
export function claimContinuation(store:ControlStore,input:ContinuationClaimInput):Claim {
 const {groupId,predecessorRunId,workItemId,taskId,graphVersion,targetVersion,executionProfile,handoffProfile,...meta}=input;
 return applyCommand(store,groupId,meta,{verb:"continue",predecessorRunId,workItemId,taskId,graphVersion,targetVersion,executionProfile:executionProfile??null,handoffProfile:handoffProfile??null},()=>{
  if(store.dispatchBlocked)throw new ControlError("control-recovery-required");const group=readGroup(store,groupId),work=readWork(store,groupId,workItemId),predecessor=readRun(store,predecessorRunId);
  if(predecessor.state!=="settled"||!predecessor.recoverable||!predecessor.checkpointId)throw new ControlError("continuation-predecessor-unrecoverable");
  if(predecessor.groupId!==groupId||predecessor.workItemId!==workItemId||predecessor.taskId!==taskId||work.taskId!==taskId)throw new ControlError("continuation-identity-conflict");
  if(group.graphVersion!==graphVersion||predecessor.graphVersion!==graphVersion)throw new ControlError("graph-version-conflict");
  if(work.targetVersion!==targetVersion||predecessor.targetVersion!==targetVersion||work.configHash!==predecessor.configHash)throw new ControlError("target-version-conflict");
  if(store.db.prepare("SELECT id FROM runs WHERE group_id=? AND work_item_id=? AND active=1").get(groupId,workItemId))throw new ControlError("work-already-active");
  const grant={work:subtract(predecessor.grant.work,predecessor.cumulative.work),handoff:subtract(predecessor.grant.handoff,predecessor.cumulative.handoff)};
  if(dimensions.some(key=>grant.work[key]===0))throw new ControlError("continuation-budget-unavailable");
  const total=add(grant.work,grant.handoff),reserved=add(group.reserved,total);if(!fits(group.used,reserved,group.limit))throw new ControlError("group-budget-unavailable");
  group.reserved=reserved;group.budgetVersion++;group.status="running";saveGroup(store,group);
  const claim:Claim={groupId,workItemId,taskId,runId:"run-"+randomUUID(),generation:1,graphVersion,targetVersion,commandId:meta.commandId,configHash:work.configHash,grant,ownerToken:randomUUID()};
  const run:RunRecord={...claim,...(executionProfile?{executionProfile}:{}),...(handoffProfile?{handoffProfile}:{}),executionId:null,state:"claimed",checkpointId:null,recoverable:false,remaining:structuredClone(grant),cumulative:{work:zero(),handoff:zero()},unknown:{work:true,handoff:true},highWater:0,breaches:[],handoffWorkItemId:null,predecessorRunId};
  store.db.prepare("INSERT INTO runs VALUES (?,?,?,?,1,?)").run(claim.runId,groupId,workItemId,1,JSON.stringify(run));work.status="running";saveWork(store,groupId,work);return claim;
 });
}

// --- Web recoverable control (spec §6.3) -------------------------------------
// The legacy `claimContinuation` above belongs to the pre-Web scheduler path and
// stays byte-identical; the functions below are the Web command surface.

export type ContinuationDeps = StopDeps;
export type ResumeFromHandoffCommand = Extract<RawAuthorityCommandV1, { verb: "resume-from-handoff" }>;
export type ContinueTaskCommand = Extract<RawAuthorityCommandV1, { verb: "continue-task" }>;
export type ContinuationCommandResult = CommandSuccessV1 | CommandErrorBodyV1;

/**
 * One continuation registered by a resume/continue command and consumed by its claim.
 * It lives both in the work item (`continuation`) and in the durable resume wake, and it
 * is what lets a later re-arm reuse the same intent identity with a fresh ordinal.
 */
export interface RegisteredContinuation {
  resumeRevision: number;
  taskId: string;
  desiredIntentId: string;
  continuationIntentId: string;
  predecessorRunId: string;
  checkpointId: string;
  pendingRunId: string;
  claimOrdinal: number;
}

interface ContinuationWork {
  workItemId: string;
  taskId: string | null;
  kind: string;
  status: string;
  currentRunId: string | null;
  pendingRunId: string | null;
  claimOrdinal?: number;
  lineageRunIds?: string[];
  grant: { work: Record<string, number>; handoff: Record<string, number> };
  continuation?: RegisteredContinuation;
}

const registeredContinuationSchema = z
  .object({
    resumeRevision: safeInteger.positive(),
    taskId: idSchema,
    desiredIntentId: z.string().min(1),
    continuationIntentId: idSchema,
    predecessorRunId: idSchema,
    checkpointId: idSchema,
    pendingRunId: idSchema,
    claimOrdinal: safeInteger.positive(),
  })
  .strict();

/** One continuation registration inside a wake body. */
function registrationOf(value: unknown): RegisteredContinuation | null {
  const parsed = registeredContinuationSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * The spec's colon-form string is the desired continuation identity, which lives in
 * the claim-attempt identity and the wake key. The persisted `continuationIntentId`
 * must stay `idSchema`-shaped for the panel read path.
 */
export function continuationIdentity(groupId: string, revision: number, taskId: string, predecessorRunId: string): { desiredIntentId: string; continuationIntentId: string } {
  const desiredIntentId = `continuation:${groupId}:${revision}:${taskId}:${predecessorRunId}`;
  return { desiredIntentId, continuationIntentId: `continuation-${createHash("sha256").update(desiredIntentId).digest("hex")}` };
}

/** The durable wake body that carries a batch's registered continuations in request order. */
export function continuationWakeBody(store: ControlStore, groupId: string): { resumeRevision: number; continuations: RegisteredContinuation[] } | null {
  const row = store.db.prepare("SELECT body FROM scheduler_wakes WHERE group_id=? AND kind='resume' AND delivered=0 ORDER BY rowid").get(groupId);
  if (!row) return null;
  const body = JSON.parse(String(row.body)) as { resumeRevision: number; continuations?: unknown[] };
  if (!Number.isSafeInteger(body.resumeRevision) || !Array.isArray(body.continuations)) return null;
  const continuations = body.continuations.map(registrationOf);
  if (continuations.some((registered) => registered === null)) return null;
  return { resumeRevision: Number(body.resumeRevision), continuations: continuations as RegisteredContinuation[] };
}

function runBody(store: ControlStore, runId: string): RunBody | null {
  const row = store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId);
  if (!row) return null;
  return JSON.parse(String(row.body)) as RunBody;
}

/**
 * §6.3's canonical recoverable predecessor: the task's most recent run, terminal and
 * recoverable, holding the committed checkpoint the caller named, with the commitment
 * still parked as `held`.
 */
function assertPredecessor(store: ControlStore, groupId: string, work: ContinuationWork, predecessorRunId: string, checkpointId: string): RunBody {
  const unrecoverable = (): ControlError => new ControlError("continuation-predecessor-unrecoverable", `${groupId}:${work.workItemId}:${predecessorRunId}`);
  const run = runBody(store, predecessorRunId);
  if (!run || run.groupId !== groupId || run.workItemId !== work.workItemId || run.taskId !== work.taskId) throw unrecoverable();
  if (run.state !== "settled-recoverable" || run.recoverable !== true || run.checkpointId !== checkpointId) throw unrecoverable();
  const checkpoint = store.db.prepare("SELECT run_id,hash,body FROM checkpoints WHERE id=?").get(checkpointId);
  if (!checkpoint || String(checkpoint.run_id) !== predecessorRunId) throw unrecoverable();
  const candidate = JSON.parse(String(checkpoint.body)) as { checkpointId: string; runId: string; taskId: string; result: string };
  if (candidate.checkpointId !== checkpointId || candidate.runId !== predecessorRunId || candidate.taskId !== work.taskId
    || sha256Canonical(candidate) !== String(checkpoint.hash) || candidate.result !== "partial") throw unrecoverable();
  if (work.currentRunId !== predecessorRunId) throw unrecoverable();
  if (work.status !== "held") throw new ControlError("work-already-active", work.workItemId);
  return run;
}

function registerContinuation(store: ControlStore, groupId: string, selection: { taskId: string; predecessorRunId: string; checkpointId: string }, resumeRevision: number): RegisteredContinuation {
  const row = store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id=?").get(groupId, selection.taskId);
  if (!row) throw new ControlError("work-not-found", selection.taskId);
  const work = JSON.parse(String(row.body)) as ContinuationWork;
  if (work.kind !== "task" || work.taskId !== selection.taskId || work.workItemId !== selection.taskId) {
    throw new ControlError("continuation-predecessor-unrecoverable", selection.taskId);
  }
  const run = assertPredecessor(store, groupId, work, selection.predecessorRunId, selection.checkpointId);
  const proposal = readBudgetProposal(store, groupId);
  for (const allocation of proposal.allocations) {
    if (allocation.ownerKind !== "task" || allocation.ownerId !== work.workItemId) continue;
    const remaining = run.remaining[allocation.bucket as "work" | "handoff"];
    if (!remaining) continue;
    for (const dimension of dimensions) {
      // A commitment that was already given back cannot be continued; that is corruption, not a refusal.
      if (allocation.amount[dimension] < remaining[dimension]) throw new ControlError("recovery-blocked", `continuation-commitment:${work.workItemId}:${allocation.bucket}`);
    }
  }
  if (dimensions.some((dimension) => work.grant.work[dimension] <= 0)) throw new ControlError("budget-overrun", work.workItemId);
  const { desiredIntentId, continuationIntentId } = continuationIdentity(groupId, resumeRevision, work.workItemId, selection.predecessorRunId);
  const registered: RegisteredContinuation = {
    resumeRevision, taskId: work.workItemId, desiredIntentId, continuationIntentId,
    predecessorRunId: selection.predecessorRunId, checkpointId: selection.checkpointId,
    pendingRunId: `run-${randomUUID()}`, claimOrdinal: 1,
  };
  saveWork(store, groupId, { ...work, status: "continuing", pendingRunId: registered.pendingRunId, claimOrdinal: 1, continuation: registered } as never);
  setAllocationStates(store, groupId, work.workItemId, "continuing");
  return registered;
}

/** Arm (or re-arm) the durable wake that carries this batch of registrations in request order. */
function armContinuationWake(store: ControlStore, groupId: string, resumeRevision: number, registrations: readonly RegisteredContinuation[]): string {
  const wakeId = `scheduler-wake:${groupId}:${resumeRevision}`;
  store.db.prepare(`INSERT INTO scheduler_wakes(id,group_id,kind,body,delivered) VALUES (?,?,'resume',?,0)
    ON CONFLICT(id) DO UPDATE SET kind='resume', body=excluded.body, delivered=0`)
    .run(wakeId, groupId, canonicalBytes({ groupId, resumeRevision, continuations: registrations }).toString("utf8"));
  return wakeId;
}

function pendingRunViews(registrations: readonly RegisteredContinuation[]): Extract<CommandSuccessV1["result"], { kind: "resumed-from-handoff" }>["pendingRuns"] {
  return registrations.map(registered => ({
    taskId: registered.taskId, continuationIntentId: registered.continuationIntentId,
    pendingRunId: registered.pendingRunId, claimOrdinal: registered.claimOrdinal,
  }));
}

/**
 * Clear a handoff stop that reached its terminal state and register every selected
 * predecessor as a continuation in the same transaction. The batch is all-or-nothing:
 * one unrepresentable selection rolls the whole registration back.
 */
export function applyResumeFromHandoff(deps: ContinuationDeps, command: ResumeFromHandoffCommand): ContinuationCommandResult {
  const { store } = deps;
  const release = deps.admissionGate?.enter();
  try {
    return applyWebCommand<ContinuationCommandResult>(store, {
      rawCommand: command,
      expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
      apply: context => {
        const groupId = groupCommandTarget(command);
        const intent = readStopIntent(store, groupId);
        if (intent?.mode === "pause") throw new ControlError("stop-mode-conflict");
        if (groupStopState(store, groupId) !== "handoff-complete") throw new ControlError("group-state-invalid");
        const group = readGroupBody(store, groupId);
        const registrations = command.payload.selections
          .map(selection => registerContinuation(store, groupId, selection, context.nextCommandRevision));
        store.db.prepare("DELETE FROM stop_intents WHERE group_id=?").run(groupId);
        group.stopped = false;
        saveGroupBody(store, group);
        const wakeId = armContinuationWake(store, groupId, context.nextCommandRevision, registrations);
        deps.beforeCommit?.();
        return commandSuccess(context, { kind: "resumed-from-handoff", wakeId, pendingRuns: pendingRunViews(registrations) });
      },
    }).body;
  } finally { release?.(); }
}

/** Continue one held task directly while the group is dispatch-enabled. */
export function applyContinueTask(deps: ContinuationDeps, command: ContinueTaskCommand): ContinuationCommandResult {
  const { store } = deps;
  const release = deps.admissionGate?.enter();
  try {
    return applyWebCommand<ContinuationCommandResult>(store, {
      rawCommand: command,
      expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
      apply: context => {
        if (command.target.kind !== "task") throw new ControlError("control-target-not-allowed");
        const { groupId, taskId } = command.target;
        const group = readGroupBody(store, groupId);
        if (group.stopped || readStopIntent(store, groupId) !== null) throw new ControlError("group-stopped");
        const registered = registerContinuation(store, groupId, { taskId, ...command.payload }, context.nextCommandRevision);
        const wakeId = armContinuationWake(store, groupId, context.nextCommandRevision, [registered]);
        deps.beforeCommit?.();
        return commandSuccess(context, {
          kind: "task-continuing", continuationIntentId: registered.continuationIntentId,
          pendingRunId: registered.pendingRunId, claimOrdinal: registered.claimOrdinal, wakeId,
        });
      },
    }).body;
  } finally { release?.(); }
}

/**
 * Re-arm a continuation whose reserved run proved `failed-before-provider`: the intent
 * identity stays put, the claim ordinal advances, and a fresh pending run id replaces the
 * burned one. Any other run gets nothing.
 */
export function rearmFailedContinuation(store: ControlStore, groupId: string, run: RunBody): string | null {
  const intent = run.continuationIntentId ?? null;
  if (intent === null || run.state !== "failed-before-provider") return null;
  const work = readWork(store, groupId, run.workItemId) as unknown as ContinuationWork;
  const registered = work.continuation;
  if (!registered || registered.continuationIntentId !== intent) return null;
  if (work.status !== "continuing" || work.currentRunId !== run.runId || work.pendingRunId !== null) return null;
  const claimOrdinal = (work.claimOrdinal ?? 0) + 1;
  if (!Number.isSafeInteger(claimOrdinal)) throw new ControlError("identity-space-exhausted", work.workItemId);
  const rearm: RegisteredContinuation = { ...registered, pendingRunId: `run-${randomUUID()}`, claimOrdinal };
  saveWork(store, groupId, { ...work, pendingRunId: rearm.pendingRunId, claimOrdinal, continuation: rearm } as never);
  const wakeId = `scheduler-wake:${groupId}:${registered.resumeRevision}`;
  const prior = store.db.prepare("SELECT body FROM scheduler_wakes WHERE id=?").get(wakeId);
  const batch = prior === undefined ? [] : ((JSON.parse(String(prior.body)) as { continuations?: unknown[] }).continuations ?? []);
  const registrations = batch
    .filter(candidate => (candidate as RegisteredContinuation).taskId !== rearm.taskId)
    .map(registrationOf)
    .filter((candidate): candidate is RegisteredContinuation => candidate !== null);
  return armContinuationWake(store, groupId, registered.resumeRevision, [...registrations, rearm]);
}

/** Consume one registered pending run id, appending it to the task lineage. Idempotent. */
export function continuationAlreadyClaimed(store: ControlStore, registered: RegisteredContinuation): boolean {
  return store.db.prepare("SELECT id FROM runs WHERE id=?").get(registered.pendingRunId) !== undefined;
}

/** A registration stays claimable only while the work item still points at its pending run id. */
function continuationClaimable(store: ControlStore, groupId: string, registered: RegisteredContinuation): boolean {
  const work = readWork(store, groupId, registered.taskId) as unknown as ContinuationWork | undefined;
  return work?.status === "continuing" && work.pendingRunId === registered.pendingRunId;
}

/** The registrations a single wake delivery can act on, in request order. */
export function claimableContinuations(store: ControlStore, groupId: string, registrations: readonly RegisteredContinuation[]): RegisteredContinuation[] {
  return registrations.filter(registered => !continuationAlreadyClaimed(store, registered) && continuationClaimable(store, groupId, registered));
}
