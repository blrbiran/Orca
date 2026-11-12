import {validSavedNoDispatch} from "./savedResultNoDispatch.js";
import { activeAllowances, pathsCovered } from "./groupAllowances.js";
import {claimCapBlocking} from "./spendCaps.js";
import { readFundedAllowance, hasOptionalTaskPolicy } from "./fundedAllowance.js";
import { finiteCommitment, remainingBudget, type BudgetAmount } from "./tokenPolicy.js";
import { readGroup, saveGroup } from "./queries.js";
import { createHash } from "node:crypto";
import { readWorkClaimEnvelope } from "./webDispatch.js";
import type { AdmissionGate } from "./admissionGate.js";
import { recoveryRetryCommand, type DriveRecord } from "./driveRecord.js";
import type { ControlStore } from "./store.js";
import type { PathPolicyMissV1 } from "./pathPolicyMisses.js";
import type { Amount } from "./types.js";
import type { CommandErrorBodyV1, CommandSuccessV1, RawAuthorityCommandV1 } from "./webProtocol.js";
import type { FrozenWorkAgent } from "./agentFreeze.js";
import { applyAgentSwitch, AUTO_AGENT, runAgentAgrees, type SwitchSource } from "./agentSwitch.js";
import { commandPrincipalFor, routedDispatchedRunFor } from "./commandClient.js";
import { appendTopUp, topUpSum, withTopUp } from "./workTopUp.js";
import { authorizeWorkTopUp } from "./authorizeWorkTopUp.js";
import { continuationIdentity, registrationOf } from "./continuation.js";
import { validateRetryGrantSource } from "./retryGrant.js";
import { validTerminalClosure } from "./terminalRunClosure.js";
import { hasValidUsageSettlement, lineageWorkUsage, releasedSettlementCheckpoint, settlementSame } from "./usageSettlement.js";
import { readConfirmedTaskExecution } from "./executionSnapshot.js";
import { recordActivity } from "./activity.js";
import { add, groupUsageUnknown } from "./budget.js";
import { applyWebCommand } from "./commandLedger.js";
import { dimensions } from "./commands.js";
import { ControlError } from "./errors.js";
import { refuseFlowChild } from "../flow/groups.js";
import { readBudgetProposal, readWork, saveWork } from "./queries.js";
import { overGrantBlockRuns, unblockedStatus } from "./overGrantBlock.js";
import {
  ADOPTABLE_STATES, commandSuccess, groupCommandTarget, latestRequestForRun, readGroupBody, readRunBody, readStopIntent, releaseCommitment,
  reserveCommitment, saveRunBody, setAllocationStates,
} from "./stopIntent.js";

/**
 * Issue fixes spec §4.2(2) (human ruling H2): a task whose current run ccloop ended failed is started again. In one
 * transaction the failed run is settled `settled-failed` (inactive; its booked usage stays, its remainder is released and
 * the task's grant re-reserved, so the allocation stays `confirmed` at its grant), the task returns to `ready` with
 * `currentRunId` still on that run (the view requires it to be the task's last run row until the next claim replaces it),
 * and the driver is left to archive and clean it (`drive.cleanedUp` false). Normal dispatch then claims the task from the
 * group branch's current head (H3); nothing here arms a wake -- the driver's replenishStartWakes does.
 * The run's endedAt and its `run-settled` row come from saveRunBody's noteRunWrite (activity.ts RUN_ENDED_STATES).
 * D9/M3 §9: a held failed handoff restores the run's own claim grant into retrying; a manually settled released
 * failure reserves that full grant without releasing again. The live source survives normal no-provider reclaims.
 */
export type RetryTaskCommand = Extract<RawAuthorityCommandV1, { verb: "retry-task" }>;
export type RetryTaskResult = CommandSuccessV1 | CommandErrorBodyV1;
/**
 * `switchTo` (quota failover spec 2026-11-03 §8): the frozen selection a retry on another installation gives the task,
 * resolved through ccloop before this transaction (agentSwitch.ts resolveAgentSwitch); `source` says who chose it.
 * `auto` (session 3cfc2e73): the payload said `agent: "auto"` and the service chose this selection (webService.ts
 * retryTaskOnAgent); with `agent: "auto"` and no `switchTo` the task keeps its selection.
 */
/**
 * `prerequisiteDone` (session 3cfc2e73 D2): D1's done rule (groupEdges.ts), passed in by webService.ts so this module on
 * the control import cycle does not import groupEdges.ts; absent, a lifted block never lands on `done`.
 */
export interface RetryTaskDeps { store: ControlStore; admissionGate?: AdmissionGate; beforeCommit?: () => void; switchTo?: { frozen: FrozenWorkAgent; source: SwitchSource; auto?: true }; prerequisiteDone?: (store: ControlStore, groupId: string) => boolean;
  ladderInProgress?: (store: ControlStore, groupId: string, taskId: string, runId: string) => string | null;
  applyObservedPaths?: (store: ControlStore, groupId: string, taskId: string, runId: string, misses: readonly PathPolicyMissV1[], commandId: string, actor: string) => unknown }

interface RetriedWork { workItemId: string; taskId: string | null; targetVersion: number; lineageRunIds?: string[]; status: string; currentRunId?: string | null; grant: { work: Amount; handoff: Amount }; retryGrantSourceRunId?: string; pendingRunId?: string | null; continuation?: { continuationIntentId: string; pendingRunId: string } | null }

/** A grant-shaped pair summed per dimension: what the group's committed amount holds for it. */
const both = (amount: { work: Amount; handoff: Amount }): Amount => add(amount.work, amount.handoff);

/** Retry work top-up spec 2026-11-06 §2 "The command": the payload's `work`, an absent dimension 0; null when not sent. */
const topUpOf = (command: RetryTaskCommand): Amount | null => {
  const work = command.payload.work;
  return work === undefined ? null : { tokens: work.tokens ?? 0, activeMs: work.activeMs ?? 0, attempts: work.attempts ?? 0, sessions: work.sessions ?? 0 };
};

/** Why a ladder's automatic retry is refused funding; the attempt-cost form names the fresh grant and one attempt's cost. */
export type AutoRetryFundingRefusal = "authored-budget-exhausted" | "retry-funding-missing" | `retry-funding-below-attempt-cost:${number}/${number}`;

/**
 * Tester follow-up B T2 (#234, #202): what retrying an optional-policy task's failed run leaves its next claim, by the
 * task's authored work -- authored + every top-up (+ `incoming`) - lineage usage, as the claim's decideFundedAllowance
 * sizes it (the group's headroom may fund less) -- and what one attempt of that lineage has cost (its token usage over the
 * attempts it used, rounded up; null when it used none). Null when the run has no funded allowance to read.
 */
export interface RetryFunding { authored: BudgetAmount; inherited: Amount; fresh: BudgetAmount; perAttemptTokens: number | null }
export function retryFundingOf(store: ControlStore, groupId: string, taskId: string, runId: string, incoming: Amount | null = null): RetryFunding | null {
  const run = readRunBody(store, runId), work = readWork(store, groupId, taskId) as unknown as RetriedWork;
  const funding = readFundedAllowance(store, run as never);
  if (funding === null) return null;
  const authored = withTopUp(work.grant.work, add(topUpSum(store, groupId, taskId, null), incoming ?? { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 }));
  const inherited = add(funding.inheritedUsage, lineageWorkUsage(run));
  return { authored, inherited, fresh: remainingBudget(authored, inherited), perAttemptTokens: inherited.attempts > 0 ? Math.ceil(inherited.tokens / inherited.attempts) : null };
}

/**
 * Issue #202: display-only, what retrying the task's current run with a `tokens` top-up would leave its next claim, read by
 * `task retry --work` before it acts (GET groups/<g>/funding-preview?retry=<task>&tokens=<n>). Null when the task has no
 * current run, is not under the optional token policy (its retry takes no top-up), or its run has no funded allowance.
 */
export interface RetryFundingPreview { taskId: string; runId: string; authoredTokens: number | null; lineageTokens: number; lineageAttempts: number; freshTokens: number | null; perAttemptTokens: number | null }
export function retryFundingPreview(store: ControlStore, groupId: string, taskId: string, tokens: number): RetryFundingPreview | null {
  const work = readWork(store, groupId, taskId) as unknown as RetriedWork;
  if (typeof work.currentRunId !== "string" || !hasOptionalTaskPolicy(store, groupId, taskId)) return null;
  const funding = retryFundingOf(store, groupId, taskId, work.currentRunId, { tokens, activeMs: 0, attempts: 0, sessions: 0 });
  if (funding === null) return null;
  return { taskId, runId: work.currentRunId, authoredTokens: funding.authored.tokens, lineageTokens: funding.inherited.tokens, lineageAttempts: funding.inherited.attempts,
    freshTokens: funding.fresh.tokens, perAttemptTokens: funding.perAttemptTokens };
}

/**
 * A ladder cannot finish its job if its required automatic retry has no authored budget left -- or (#234) less than one
 * attempt of the failed lineage has cost: ccloop checks its budget only between phases, so such a run overshoots into the
 * group's deficit instead of stopping. An unlimited token dimension is never refused by that floor.
 */
export function autoRetryFundingRefusal(store: ControlStore, groupId: string, taskId: string, runId: string): AutoRetryFundingRefusal | null {
  if (!hasOptionalTaskPolicy(store, groupId, taskId)) return null;
  const funding = retryFundingOf(store, groupId, taskId, runId);
  if (funding === null) return "retry-funding-missing";
  const { fresh, perAttemptTokens } = funding;
  if (dimensions.some((dimension) => fresh[dimension] === 0)) return "authored-budget-exhausted";
  return fresh.tokens !== null && perAttemptTokens !== null && fresh.tokens < perAttemptTokens ? `retry-funding-below-attempt-cost:${fresh.tokens}/${perAttemptTokens}` : null;
}

/**
 * Tester #264: the `authored-budget-exhausted` refusal names each dimension with no work left, with the task's authored
 * amount (+ top-ups and credit), the lineage's usage and what is left, and the `--work` top-up that would let it run: one
 * attempt or session, or one attempt's worth of tokens or active time as the lineage spent them (1 when it spent none).
 */
export function authoredBudgetExhausted(groupId: string, taskId: string, authored: BudgetAmount, inherited: Amount, left: BudgetAmount): string {
  const spent = dimensions.filter((d) => left[d] === 0);
  const want = (d: typeof dimensions[number]): number => d === "attempts" || d === "sessions" || inherited.attempts === 0 ? 1 : Math.max(1, Math.ceil(inherited[d] / inherited.attempts));
  const named = spent.map((d) => `${d}(authored=${authored[d]},inherited=${inherited[d]},fresh=${left[d]})`).join(",");
  return `authored-budget-exhausted:${named}; add work to the retry: orca task retry ${groupId} ${taskId} --work '${JSON.stringify(Object.fromEntries(spent.map((d) => [d, want(d)])))}'`;
}

/**
 * Tester follow-up E §8 (overrides budget spec 2026-11-11 §7 item 7's first consequence): the attempts and active time an
 * explicit retry in a group whose `limit.tokens` is null credits back -- what the lineage used beyond every earlier top-up
 * and credit, so authored + top-ups + credit - lineage is the task's own amount again (plus this retry's top-up). Null
 * when the rule does not apply: a finite group (byte for byte as before), or a retry Orca sent itself (the ladder, quota
 * retries, failover: they keep counting the lineage). Tokens and sessions are never credited.
 */
function freshStartWant(store: ControlStore, groupId: string, command: RetryTaskCommand, inherited: Amount, prior: Amount): Amount | null {
  if (readGroup(store, groupId).limit.tokens !== null) return null;
  if (command.actorId === "orca-auto" || commandPrincipalFor(command.commandId) === "orca-auto") return null;
  return { tokens: 0, sessions: 0, attempts: Math.max(0, inherited.attempts - prior.attempts), activeMs: Math.max(0, inherited.activeMs - prior.activeMs) };
}

/** Normal failed-recovery retry keeps its real failure; no-dispatch consumption has separate proof and authority. */
function recordSavedOrdinaryRetry(store:ControlStore,runId:string,commandId:string):void {
  const run=readRunBody(store,runId);
  if(run.mode!=="verify-saved-result"&&run.recoveryOf===undefined)return;
  readFundedAllowance(store,run as never);
  const drive=run.drive as DriveRecord|undefined;
  if(run.mode!=="verify-saved-result"||!run.recoveryOf||run.state!=="settled-failed"||typeof drive?.outcome!=="string"||drive.outcome==="succeeded"||drive.outcome==="not-started"||run.savedNoDispatchConsumedBy!==undefined)throw new ControlError("recovery-blocked","saved-result-retry-authority");
  saveRunBody(store,{...run,savedOrdinaryRetryCommandId:commandId},false);
}

export function applyRetryTask(deps: RetryTaskDeps, command: RetryTaskCommand): RetryTaskResult {
  const { store } = deps;
  const release = deps.admissionGate?.enter();
  try {
    return applyWebCommand<RetryTaskResult>(store, {
      rawCommand: command,
      expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
      apply: context => {
        const groupId = groupCommandTarget(command);
        const taskId = command.payload.taskId;
        const incoming = topUpOf(command);
        // Spec §4.2(2), in the spec's order. Archived groups are refused by Part E (group-archived).
        const group = readGroupBody(store, groupId);
        refuseFlowChild(store, groupId);
        if (group.status === "clarifying") throw new ControlError("group-state-invalid", "clarifying");
        if (group.stopped || readStopIntent(store, groupId) !== null) throw new ControlError("stop-mode-conflict");
        const work = readWork(store, groupId, taskId) as unknown as RetriedWork;
        // CLI v2 spec §14 R2: the stale-retry guard the revision used to be -- before any eligibility check.
        if (command.payload.runId !== undefined && work.currentRunId !== command.payload.runId) throw new ControlError("task-run-moved", command.payload.runId);
        // Issue #150: a finished task has nothing to retry; say so (after R2's guard, which stays first).
        if (work.status === "done") throw new ControlError("work-already-done", taskId);
        if (typeof work.currentRunId !== "string") throw new ControlError("task-not-retryable", "no-run");
        const runId = work.currentRunId;
        const run = readRunBody(store, runId);
        const live = Number(store.db.prepare("SELECT active FROM runs WHERE id=?").get(runId)?.active ?? 0) === 1;
        const newest = store.db.prepare("SELECT id FROM runs WHERE group_id=? AND work_item_id=? ORDER BY rowid DESC LIMIT 1").get(groupId, taskId);
        if (run.runId !== runId || run.groupId !== groupId || run.workItemId !== taskId || run.taskId !== taskId || work.taskId !== taskId
          || run.targetVersion !== work.targetVersion || newest?.id !== runId || !work.lineageRunIds?.includes(runId)
          || !runAgentAgrees(work, run)) throw new ControlError("recovery-blocked", "retry-identity");
        // A confirmed ladder is already fixing this exact failed run. A competing manual retry can claim from the
        // branch just as its fix folds, then finish with empty-result; draft ladders may still be superseded.
        if (command.actorId !== "orca-auto") {
          const ladder = deps.ladderInProgress?.(store, groupId, taskId, runId);
          if (ladder !== undefined && ladder !== null) throw new ControlError("task-not-retryable", `debug-in-progress:${ladder}`);
        }
        const claim = readWorkClaimEnvelope(store, groupId, runId);
        if (claim.runId !== runId || claim.groupId !== groupId || claim.workItemId !== taskId || claim.generation !== run.generation
          || claim.claimOrdinal !== run.claimOrdinal || claim.continuationIntentId !== (run.continuationIntentId ?? null)
          || claim.derivedContractHash !== (work as RetriedWork & { derivedContractHash: string }).derivedContractHash
          || !settlementSame(claim.grants, run.grant) || claim.ownerTokenHash !== createHash("sha256").update(String(run.ownerToken)).digest("hex")) {
          throw new ControlError("recovery-blocked", "retry-claim-identity");
        }
        const allocations = readBudgetProposal(store, groupId).allocations.filter(a => a.ownerKind === "task" && a.ownerId === taskId);
        // Quota failover spec §8: the payload's installation must be the one resolved before this transaction.
        // `auto` (session 3cfc2e73): the service chose, or kept, the selection (webService.ts retryTaskOnAuto).
        if (command.payload.agent !== AUTO_AGENT && ((command.payload.agent === undefined) !== (deps.switchTo === undefined)
          || (deps.switchTo !== undefined && deps.switchTo.frozen.agent.agent !== command.payload.agent))) throw new ControlError("recovery-blocked", "agent-switch-unresolved");
        if(run.mode==="verify-saved-result"&&run.state==="settled-restartable"){
          if(deps.switchTo!==undefined)throw new ControlError("task-not-retryable","agent-switch-saved-result");
          if(!validSavedNoDispatch(store,run)||groupUsageUnknown(store,groupId))throw new ControlError("task-not-retryable","saved-result-no-dispatch-proof");
          if(hasOptionalTaskPolicy(store,groupId,taskId)||run.grant.work.tokens===null)throw new ControlError("task-not-retryable","saved-result-no-dispatch-funding");
          if(claimCapBlocking(store,groupId,run.grant.work.tokens+run.grant.handoff.tokens,store.now()))throw new ControlError("task-not-retryable","spend-cap-reached");
          readConfirmedTaskExecution(store,groupId,taskId);
          if(incoming!==null)throw new ControlError("retry-top-up-unsupported","saved-result-no-dispatch");
          saveRunBody(store,{...run,state:"settled-failed",savedNoDispatchConsumedBy:command.commandId,drive:{...run.drive!,outcome:"not-started",stopReason:"saved-result-not-dispatched"}},false);
          Object.assign(work,{status:"ready",retryGrantSourceRunId:runId,pendingRunId:null});setAllocationStates(store,groupId,taskId,"retrying",run.grant);saveWork(store,groupId,work as never);
          recordActivity(store,{groupId,taskId,runId,kind:"task-retried",body:{fromRunId:runId,reason:"saved-result-not-dispatched"}});deps.beforeCommit?.();return commandSuccess(context,{kind:"task-retried",taskId,fromRunId:runId});
        }
        const held = !live && run.state === "settled-recoverable" && run.recoverable === true && work.status === "held"
          && allocations.length === 2 && allocations.every(a => a.state === "held" && settlementSame(a.amount, run.remaining[a.bucket as "work" | "handoff"]))
          && settlementSame(work.grant, run.remaining);
        const released = !live && run.state === "settled-failed" && work.status === "blocked" && run.recoverable === false
          && allocations.length === 2 && allocations.every(a => a.state === "terminal") && settlementSame(work.grant, run.grant)
          && (run.usageSettlement as { reservationDisposition?: string } | undefined)?.reservationDisposition === "released" && hasValidUsageSettlement(store, run);
        // Terminal-closure spec 2026-11-07: an explicit closure released this run's remainder already. A malformed marker
        // refuses by name instead of falling through to the ordinary live-failure branch.
        if (run.terminalClosure !== undefined && !validTerminalClosure(store, run as never)) throw new ControlError("recovery-blocked", "retry-closure-invalid");
        // Issue #205: an optional-policy run is funded with a fresh grant (authored + top-ups - inherited usage, within the
        // group's headroom), which differs from the work item's authored grant by construction; its proof is the funded
        // allowance the claim recorded for it. A finite-legacy run is still re-granted in full, so equality stays its check.
        const closedGrantMatches = hasOptionalTaskPolicy(store, groupId, taskId)
          ? (() => { const funding = readFundedAllowance(store, run as never); return funding !== null && settlementSame(funding.grant, run.grant); })()
          : settlementSame(work.grant, run.grant);
        const closed = !live && run.state === "settled-failed" && run.recoverable === false && run.terminalClosure !== undefined
          && validTerminalClosure(store, run as never) && work.status === "blocked" && allocations.length === 2
          && allocations.every(a => a.state === "terminal") && closedGrantMatches;
        if ((!live || run.state !== "blocked") && !held && !released && !closed) throw new ControlError("task-not-retryable", `run-state:${run.state}`);
        const drive = run.drive as DriveRecord | undefined;
        // Tester #229 (plan 2026-11-10 follow-up B, T1): a run blocked at another step is resumed in place by recovery-retry
        // (its block is not a ccloop failure); the refusal names that command.
        if (drive === undefined || (live && drive.blockedAt !== "C")) throw new ControlError("task-not-retryable",
          drive?.blockedAt == null ? `blocked-at:${drive?.blockedAt ?? "none"}` : `blocked-at:${drive.blockedAt}:${recoveryRetryCommand(runId)}`);
        // A codex-skills-* failure sets an outcome too (review C3), so it is retryable like any other ccloop failure.
        // Tester #267: blocked at C before ccloop stated any outcome (its collect failed), recovery-retry collects it again.
        if (drive.outcome === null || drive.outcome === "succeeded") throw new ControlError("task-not-retryable", `outcome:${drive.outcome ?? "none"}${live && drive.outcome === null ? `:${recoveryRetryCommand(runId)}` : ""}`);
        const observed = command.payload.allowObservedPaths === true ? drive.pathPolicyMisses : null;
        if (command.payload.allowanceId !== undefined && command.payload.allowObservedPaths !== true) throw new ControlError("observed-paths-invalid", "allowance-id-needs-observed-paths");
        if (command.payload.allowObservedPaths === true) {
          if (command.payload.runId === undefined) throw new ControlError("observed-paths-invalid", "run-id-required");
          // Tester follow-up G §6.3 (#189): Orca retries a covered block only under an active group path allowance that covers
          // every one of the run's misses; a dispatched run never.
          const auto = command.actorId === "orca-auto" || commandPrincipalFor(command.commandId) === "orca-auto";
          if (routedDispatchedRunFor(command.commandId) !== null || (auto && !allowanceCovers(store, groupId, command.payload.allowanceId, drive.pathPolicyMisses)))
            throw new ControlError("observed-paths-not-allowed", "dispatched-or-auto");
          if (drive.outcome !== "blocked_waiting_human" || !drive.stopReason?.startsWith("allowlist miss: "))
            throw new ControlError("observed-paths-not-allowed", "not-an-allowlist-block");
          if (observed == null || observed.length === 0) throw new ControlError("observed-paths-unavailable");
          if (deps.applyObservedPaths === undefined) throw new ControlError("recovery-blocked", "observed-path-writer-missing");
        }
        // releaseRunReserve's conditions (budget.ts): no request still owns the run, and its usage is known and complete.
        const request = latestRequestForRun(store, groupId, runId);
        if (request !== null && ADOPTABLE_STATES.includes(request.state)) throw new ControlError("task-not-retryable", `handoff-request-open:${request.requestId}`);
        if (run.unknown.work || run.unknown.handoff) throw new ControlError("task-not-retryable", "usage-unknown");
        if (store.db.prepare("SELECT seq FROM usage_events WHERE run_id=? AND seq>?").get(runId, Number(run.highWater))) throw new ControlError("task-not-retryable", "usage-pending");
        // The new run is claimed at the task's current grant (after a continuation, the continuation's), so the net new
        // reservation is grant - remainder in each dimension; it must fit the group's unallocated reserve.
        // Controller ruling 2026-10-09: new inactive M3 admissions also require every historical group run's usage to be known.
        if ((held || released) && groupUsageUnknown(store, groupId)) {
          const pending = store.db.prepare("SELECT 1 FROM usage_events e JOIN runs r ON r.id=e.run_id WHERE r.group_id=? AND e.seq>json_extract(r.body,'$.highWater') LIMIT 1").get(groupId);
          throw new ControlError("task-not-retryable", pending ? "usage-pending" : "usage-unknown");
        }
        if ((held || released) ? work.pendingRunId !== null : work.pendingRunId != null) throw new ControlError("task-not-retryable", "continuation-pending");
        if (work.continuation != null) {
          const registration = registrationOf(work.continuation);
          const identity = registration && continuationIdentity(groupId, registration.resumeRevision, taskId, registration.predecessorRunId);
          if (!registration || registration.taskId !== taskId || registration.continuationIntentId !== run.continuationIntentId
            || registration.pendingRunId !== run.runId || registration.claimOrdinal !== run.claimOrdinal
            || registration.desiredIntentId !== identity?.desiredIntentId || registration.continuationIntentId !== identity.continuationIntentId) {
            throw new ControlError("task-not-retryable", "continuation-identity");
          }
        }
        if (held) {
          if (request?.state !== "settled-recoverable") throw new ControlError("task-not-retryable", "handoff-settlement");
          releasedSettlementCheckpoint(store, run as never);
        }
        // Quota failover spec §8: the switch, after every eligibility check above and before A2 re-reads the task, so the
        // re-issued snapshot and the work item's new selection are checked together; a refusal below rolls it back.
        // Session 3cfc2e73 ruling: the switch names who made it -- the routed principal (an agent or a person), else the actor.
        const switched = deps.switchTo === undefined ? null
          : applyAgentSwitch(store, groupId, taskId, runId, deps.switchTo.frozen, commandPrincipalFor(command.commandId) ?? command.actorId,
            deps.switchTo.auto === true ? "auto" : deps.switchTo.source === "failover" ? "quota" : "person");
        if (switched !== null) Object.assign(work, readWork(store, groupId, taskId));
        validateRetryGrantSource(store, groupId, work);
        readConfirmedTaskExecution(store, groupId, taskId);
        if (run.usageSettlement !== undefined && !hasValidUsageSettlement(store, run)) throw new ControlError("recovery-blocked", "retry-settlement");
        // Session 3cfc2e73 D2 (spec 2026-11-05 §3.2): the group is blocked because a run went over its grant.
        const overGrantBlocked = group.status === "blocked" && overGrantBlockRuns(store.db, groupId).length > 0;
        if(hasOptionalTaskPolicy(store,groupId,taskId)) {
          const funding=readFundedAllowance(store,run as never);if(!funding)throw new ControlError("recovery-blocked","retry-funding-missing");
          const inherited=add(funding.inheritedUsage,lineageWorkUsage(run));
          // Retry work top-up spec 2026-11-06 §2: the new run (the newest) reads the authored grant plus every top-up, and this one.
          if(incoming!==null&&dimensions.every(d=>incoming[d]===0))throw new ControlError("retry-top-up-empty");
          if(incoming!==null&&incoming.tokens>0&&work.grant.work.tokens===null)throw new ControlError("retry-top-up-no-effect","tokens");
          // Tester follow-up E §8: in a group with no token limit, an explicit retry (a person's or an agent's; never Orca's
          // own -- the ladder and the quota retries keep counting the lineage) credits back the attempts and active time the
          // lineage used beyond earlier top-ups, so the new run starts with the task's own.
          const prior=topUpSum(store,groupId,taskId,null);
          const want=freshStartWant(store,groupId,command,inherited,prior);
          const authored=withTopUp(work.grant.work,add(add(prior,incoming??{tokens:0,activeMs:0,attempts:0,sessions:0}),want??{tokens:0,activeMs:0,attempts:0,sessions:0}));
          let left=remainingBudget(authored,inherited);
          if(dimensions.some(d=>left[d]===0))throw new ControlError("task-not-retryable",authoredBudgetExhausted(groupId,taskId,authored,inherited,left));
          const personAuthority=incoming===null?false:authorizeWorkTopUp(store,groupId,command.commandId,incoming,'retry-top-up');
          if(!released && !closed){saveRunBody(store,{...run,state:"settled-failed",recoverable:false,drive:{...drive,cleanedUp:false}},false);releaseCommitment(store,groupId,add(finiteCommitment(run.remaining.work),run.remaining.handoff));}
          let freshStart:Amount|null=null;
          if(want!==null){
            // Never more than the group's own non-token limits leave the claim (decideFundedAllowance, fundingReleased), read
            // after the release above as the claim will see it: a credit the claim could not fund would strand the task ready.
            const live=readGroup(store,groupId),handoff=work.grant.handoff,credit={...want};
            for(const d of ["activeMs","attempts"] as const)credit[d]=Math.min(want[d],Math.max(0,live.limit[d]-live.used[d]-live.reserved[d]-handoff[d]-(left[d]-want[d])));
            left={...left,activeMs:left.activeMs-(want.activeMs-credit.activeMs),attempts:left.attempts-(want.attempts-credit.attempts)};
            if(left.attempts===0||left.activeMs===0)throw new ControlError("task-not-retryable",authoredBudgetExhausted(groupId,taskId,{...authored,attempts:authored.attempts-(want.attempts-credit.attempts),activeMs:authored.activeMs-(want.activeMs-credit.activeMs)},inherited,left));
            if(credit.attempts>0||credit.activeMs>0){
              appendTopUp(store,groupId,taskId,runId,{amount:credit,commandId:command.commandId,by:commandPrincipalFor(command.commandId)??command.actorId,personAuthority:false,at:store.now(),kind:"fresh-start"});
              freshStart=credit;
            }
          }
          if(incoming!==null){
            // Spec §2 "Headroom": the claim's own non-token fit (fundedAllowance.ts decideFundedAllowance, fundingReleased), read
            // after the failed run's remainder is released as the claim will see it; refused here so the task is never left
            // ready and unclaimable. A refusal rolls back the release above with the command's savepoint.
            const live=readGroup(store,groupId),limit=live.limit,handoff=work.grant.handoff;
            for(const d of ["activeMs","attempts","sessions"] as const)if(live.used[d]+live.reserved[d]+left[d]+handoff[d]>limit[d])throw new ControlError("group-budget-unavailable",d);
            appendTopUp(store,groupId,taskId,runId,{amount:incoming,commandId:command.commandId,by:commandPrincipalFor(command.commandId)??command.actorId,personAuthority,at:store.now()});
          }
          Object.assign(work,{status:"ready",fundingReleased:true,pendingRunId:null});
          delete work.continuation;delete work.retryGrantSourceRunId;delete (work as {allowancePredecessorRunId?:string}).allowancePredecessorRunId;
          setAllocationStates(store,groupId,taskId,"confirmed");saveWork(store,groupId,work as never);
          const resumedGroup=readGroup(store,groupId);resumedGroup.status="running";saveGroup(store,resumedGroup);
          recordSavedOrdinaryRetry(store,runId,command.commandId);recordActivity(store,{groupId,taskId,runId,kind:"task-retried",body:{fromRunId:runId,...(switched===null?{}:{agent:switched}),...(incoming===null?{}:{topUp:incoming}),...(freshStart===null?{}:{freshStart})}});
          if (observed !== null && observed !== undefined) deps.applyObservedPaths!(store, groupId, taskId, runId, observed, command.commandId, command.payload.allowanceId !== undefined ? `allowance:${command.payload.allowanceId}` : commandPrincipalFor(command.commandId) ?? command.actorId);
          deps.beforeCommit?.();
          // The receipt says what the new run starts with when the fresh-start rule applied (the CLI prints it).
          return commandSuccess(context,{kind:"task-retried",taskId,fromRunId:runId,...(want===null?{}:{nextRun:{attempts:left.attempts,activeMs:left.activeMs}})});
        }
        const retrying = held || released || closed || work.retryGrantSourceRunId !== undefined || allocations.some(a => a.state === "continuing");
        const grant = both(retrying ? run.grant : work.grant), remaining = released || closed ? { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 } : both(run.remaining);
        const reserve = readBudgetProposal(store, groupId).explicitUnallocatedReserve;
        for (const d of dimensions) {
          if(reserve[d]===null)continue;
          const shortfall = grant[d] - remaining[d] - reserve[d]!;
          if (shortfall > 0) throw new ControlError("group-reserve-insufficient", `${d}:${shortfall}`);
        }
        // Retry work top-up spec 2026-11-06 §2 "Scope": this branch re-grants the failed run's full grant; it takes no top-up.
        if (incoming !== null) throw new ControlError("retry-top-up-unsupported", "finite-legacy");
        // Effect 1: the run alone moves; `remaining` stays on it (the view checks remaining == max(grant - cumulative, 0)).
        if (!released && !closed) saveRunBody(store, { ...run, state: "settled-failed", recoverable: false, drive: { ...drive, cleanedUp: false } }, false);
        if (!released && !closed) releaseCommitment(store, groupId, remaining);
        reserveCommitment(store, groupId, grant);
        // Effect 2.
        work.status = "ready";
        if (retrying) {
          work.grant = structuredClone(run.grant);
          work.retryGrantSourceRunId = runId;
          setAllocationStates(store, groupId, taskId, "retrying", run.grant);
        }
        if (work.continuation != null) delete work.continuation;
        work.pendingRunId = null;
        saveWork(store, groupId, work as never);
        recordSavedOrdinaryRetry(store,runId,command.commandId);
        // Session 3cfc2e73 D2 (triage #161): the retry lifts the over-grant block it answers, by set-limit's rule.
        if (overGrantBlocked) { const lifted = readGroup(store, groupId); lifted.status = unblockedStatus(store, groupId, deps.prerequisiteDone ?? (() => false)); saveGroup(store, lifted); }
        // Effect 4 (the command revision advances in applyWebCommand).
        recordActivity(store, { groupId, taskId, runId, kind: "task-retried", body: { fromRunId: runId, ...(switched === null ? {} : { agent: switched }) } });
        if (observed !== null && observed !== undefined) deps.applyObservedPaths!(store, groupId, taskId, runId, observed, command.commandId, command.payload.allowanceId !== undefined ? `allowance:${command.payload.allowanceId}` : commandPrincipalFor(command.commandId) ?? command.actorId);
        deps.beforeCommit?.();
        return commandSuccess(context, { kind: "task-retried", taskId, fromRunId: runId });
      },
    }).body;
  } finally { release?.(); }
}

/** Tester follow-up G §6.3 (#189): the named allowance is an active path allowance of this group, and the active path allowances cover every miss. */
function allowanceCovers(store: ControlStore, groupId: string, allowanceId: string | undefined, misses: readonly PathPolicyMissV1[] | null | undefined): boolean {
  if (allowanceId === undefined || misses == null || misses.length === 0) return false;
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
  if (row === undefined) return false;
  const active = activeAllowances(JSON.parse(String(row.body)), store.now()).filter((allowance) => allowance.request.type === "path");
  return active.some((allowance) => allowance.allowanceId === allowanceId) && pathsCovered(active, misses) !== null;
}
