import { amountSchema } from "./schema.js";
import { ceilingOutstanding, liveCeilingOf, syncCeilingReserve } from "./liveCeiling.js";
import { add, budgetBalance, readRun, saveRun, subtract, syncWebBudget } from "./budget.js";
import { dimensions } from "./commands.js";
import { hasTokenPolicy } from "./fundedAllowance.js";
import { finiteCommitment } from "./tokenPolicy.js";
import { isGroupArchived } from "./archivedMark.js";
import { recordActivity } from "./activity.js";
import { applyWebCommand } from "./commandLedger.js";
import { AGENT_SETTLE_NOTE, settlingPrincipalFor } from "./commandClient.js";
import { ControlError } from "./errors.js";
import { readGroup, readBudgetProposal, readWork, saveGroup, saveWork, type GroupRecord } from "./queries.js";
import { ADOPTABLE_STATES, commandSuccess, groupCommandTarget, latestRequestForRun, readStopIntent, reserveCommitment, setAllocationStates, settleManuallyFailedRequestInTransaction, settleRecoveredRequestInTransaction } from "./stopIntent.js";
import { knownZeroProved, releasedSettlementCheckpoint, settlementProof, settlementSame, unmeteredChargeSchema, usageSettlementSchema, workerLostRun, type SettlementRun, type UsageSettlement } from "./usageSettlement.js";
import { bookSettledUsage } from "./usageLedger.js";
import type { AdmissionGate } from "./admissionGate.js";
import type { ControlStore } from "./store.js";
import type { Amount } from "./types.js";
import type { RawAuthorityCommandV1, CommandSuccessV1, CommandErrorBodyV1 } from "./webProtocol.js";

export type SettleUnknownUsageCommand = Extract<RawAuthorityCommandV1, { verb: "settle-unknown-usage" }>;
export type SettleAcknowledge = SettleUnknownUsageCommand["payload"]["acknowledge"];
/** The acknowledgement a run's remainder admits: a proved-zero failure releases its reservation; an unlimited work
 * token remainder can only be released unmetered; otherwise the remainder is charged. */
export const settlementAcknowledgeFor = (run: SettlementRun): Exclude<SettleAcknowledge, "charge-observed-floor"> =>
  knownZeroProved(run) ? "release-known-zero" : run.remaining.work.tokens === null && liveCeilingOf(run) === null ? "release-unmetered" : "charge-remaining-grant";
/**
 * Follow-up H (gap k, ruling R4: the group cap is hard): an expectation-model run has no work grant; what its unknown usage
 * could have spent is its live ceiling, so its "remaining grant" is the ceiling's unused part, charged in full. Null for a
 * run without a ceiling.
 */
const ceilingRemainder = (run: SettlementRun): number | null => liveCeilingOf(run) === null ? null : ceilingOutstanding(run as never);
/**
 * Tester follow-up F §2 (#116, ledger C3): ccloop's observed floor as the soft path reads it (the loop run's `usageLowerBound`,
 * executionDriver.ts), or null when ccloop observed none. The explicit `charge-observed-floor` is admitted only with one.
 */
export function observedFloorOf(run: SettlementRun): number | null {
  const tokens = (run.usageLowerBound as { tokens?: unknown } | undefined)?.tokens;
  return typeof tokens === "number" && Number.isSafeInteger(tokens) && tokens > 0 ? tokens : null;
}
/**
 * Tester follow-up I (seat K; the controller's dogfood run, g-28d9b560): the floor `charge-observed-floor` books. ccloop's
 * floor counts the calls that ended without a report, on top of the usage already booked (spec 2026-11-06 §3.2), and is
 * written by the worker that ran them -- which, for a worker-lost run, was killed before it could. Such a run's usage up to
 * the death was observed and is booked, so its floor beyond that is 0: settling at the floor books what was observed. A
 * worker-lost run that observed nothing, and any other run without ccloop's floor, still has none (null).
 */
export function workerLostFloor(run: SettlementRun): number | null {
  return observedFloorOf(run) ?? (workerLostRun(run) && run.cumulative.work.tokens > 0 ? 0 : null);
}
/**
 * Tester follow-up I (seat K): a worker-lost run's `charge-remaining-grant`. Only tokens are unknown -- the killed call's --
 * so only tokens are charged at the remainder (or the unused live ceiling); the attempts, sessions and active time it never
 * reached were not spent (spec 2026-11-12 §5.4: the machine lost the work, the task did not fail), so they stay as observed.
 */
const workerLostCharge = (amount: Amount): Amount => ({ tokens: amount.tokens, activeMs: 0, attempts: 0, sessions: 0 });
/** The work token remainder once a floor is booked (spec 2026-11-06 §3.2): max(grant - cumulative, 0), null when unlimited. */
const remainderAfterFloor = (run: SettlementRun, floor: number): number | null =>
  run.grant.work.tokens === null ? null : Math.max(run.grant.work.tokens - (run.cumulative.work.tokens + floor), 0);
export interface SettleUnknownUsageDeps { store: ControlStore; admissionGate?: AdmissionGate; now?: () => Date; beforeCommit?: () => void; afterEvidence?: () => Promise<void> }

/** Optional request-local raw work reader; writers omit it and retain their transaction's database reads. */
export interface SettlementAdmissionReadContext {
  readonly store: ControlStore;
  readonly groupId: string;
  readWork(id: string): unknown;
}

export function settlementAdmission(store: ControlStore, run: SettlementRun, context?: SettlementAdmissionReadContext, acknowledge: SettleAcknowledge = settlementAcknowledgeFor(run)): "committed" | "released" | "recovered" {
  const group = readGroup(store, run.groupId), work = (context?.store === store && context.groupId === run.groupId
    ? context.readWork(run.workItemId) : readWork(store, run.groupId, run.workItemId)) as unknown as { taskId: string; currentRunId?: string; status: string; grant: unknown; pendingRunId?: string | null };
  if (acknowledge === "release-known-zero" && !knownZeroProved(run)) throw new ControlError("run-usage-not-settleable", "known-zero-not-proved");
  if (acknowledge === "charge-observed-floor") {
    // Tester follow-up F §2 (#116, ledger C3): a finite remainder only (an unlimited one keeps its forms), and only with a floor.
    // Tester follow-up I (G spec §16, human 「按你的建议走」): an expectation-model run's live ceiling bounds it as a finite
    // remainder does, so it is admitted too; without a floor it is refused and its unused ceiling stays held.
    if (run.remaining.work.tokens === null && liveCeilingOf(run) === null) throw new ControlError("run-usage-not-settleable", "unlimited-remainder");
    if (workerLostFloor(run) === null) throw new ControlError("run-usage-not-settleable", "observed-floor-unknown");
  } else if (acknowledge !== settlementAcknowledgeFor(run)) throw new ControlError("run-usage-not-settleable", run.remaining.work.tokens === null && liveCeilingOf(run) === null ? "unlimited-remainder" : "finite-remainder");
  if (isGroupArchived(store, run.groupId)) throw new ControlError("group-archived");
  if (run.usageSettlement !== undefined) throw new ControlError("run-usage-settled");
  if ((group as { status?: string }).status === "clarifying") throw new ControlError("group-state-invalid", "clarifying");
  if (run.phase !== "work" || run.taskId === null || run.estimateId !== null || work.taskId !== run.taskId || work.currentRunId !== run.runId
    || ["done", "continuing"].includes(work.status) || work.pendingRunId != null || !run.drive || run.drive.outcome === "succeeded"
    || (run.drive.outcome == null && !stoppedWorking(run))) throw new ControlError("run-usage-not-settleable", "current-failed-task");
  const active = Number(store.db.prepare("SELECT active FROM runs WHERE id=?").get(run.runId)?.active) === 1;
  const request = latestRequestForRun(store, run.groupId, run.runId);
  if (request && ADOPTABLE_STATES.includes(request.state)) throw new ControlError("run-usage-not-settleable", "handoff-request-open");
  if (store.db.prepare("SELECT seq FROM usage_events WHERE run_id=? AND seq>?").get(run.runId, run.highWater)) throw new ControlError("run-usage-pending");
  if (!run.unknown.work && !run.unknown.handoff) throw new ControlError("run-usage-not-unknown");
  const stop = readStopIntent(store, run.groupId);
  if (stoppedWorking(run)) {
    // Spec 2026-10-14-handoff-stop-unknown-usage-design.md §3.1: stopped while working, so there is no failure to settle;
    // its usage alone kept the handoff from settling recoverable, and the run goes back to recoverable once it is settled.
    // Its partial checkpoint is checked with the evidence (settlementProof, releasedSettlementCheckpoint).
    if (active || work.status !== "blocked" || request?.state !== "settled-unrecoverable" || request.failureCode !== "usage-unsettled") throw new ControlError("run-usage-not-settleable", "stopped-handoff");
    if (stop?.mode === "pause" || (group.stopped && !stop)) throw new ControlError("stop-mode-conflict");
    if (!hasTokenPolicy(store, run.groupId)) {
      // §3.2 finite-legacy: the charge and the commitment parked again for the continuation must both fit the group limit.
      const parked = add(run.remaining.work as never, run.remaining.handoff), available = budgetBalance(group.limit, group.used, group.reserved).reserve;
      // Tester follow-up F §2: an observed floor charges its tokens only and parks the remainder after it (bookObservedFloor).
      const floor = acknowledge === "charge-observed-floor" ? workerLostFloor(run)! : null;
      const after = floor === null ? null : add({ ...run.remaining.work, tokens: remainderAfterFloor(run, floor) ?? 0 } as never, run.remaining.handoff);
      for (const d of dimensions) {
        const needed = after === null ? 2 * parked[d] : after[d] + (d === "tokens" ? floor! : 0);
        const shortfall = available[d] === null ? 0 : needed - available[d]!;
        if (shortfall > 0) throw new ControlError("group-reserve-insufficient", `${d}:${shortfall}`);
      }
    }
    return "recovered";
  }
  if (active && run.state === "blocked" && run.drive.blockedAt === "C") {
    if (group.stopped || stop) throw new ControlError("stop-mode-conflict");
    return "committed";
  }
  const allocations = readBudgetProposal(store, run.groupId).allocations.filter(a => a.ownerKind === "task" && a.ownerId === run.taskId);
  if (active || run.state !== "settled-unrecoverable" || work.status !== "blocked" || allocations.length !== 2 || allocations.some(a => a.state !== "terminal")
    || !settlementSame(work.grant, run.grant) || request?.state !== "settled-unrecoverable" || request.failureCode !== "usage-unsettled") throw new ControlError("run-usage-not-settleable", "released-handoff");
  if (stop?.mode === "pause" || (group.stopped && !stop)) throw new ControlError("stop-mode-conflict");
  return "released";
}
/**
 * The charge arithmetic of a settlement (spec 2026-10-13 §A), shared with a single call's settlement (spec 2026-10-27
 * single-call unknown usage §9 R1, singleCallSettlement.ts): each bucket's charge moves into the run's cumulative, its
 * remainder is emptied and its usage is no longer unknown; the group's `used` grows by the charge and, when
 * `releaseReserved`, its `reserved` shrinks by it. A metered charge is booked as settled usage (D9).
 */
export function chargeRunRemainder(
  store: ControlStore, run: Pick<SettlementRun, "runId" | "groupId" | "remaining" | "cumulative" | "unknown"> & { phase?: string; purpose?: string },
  group: Pick<GroupRecord, "used" | "reserved">, charged: { work: Omit<Amount, "tokens"> & { tokens: number | null }; handoff: Amount },
  options: { unmetered: boolean; releaseReserved: boolean; releaseReservedAmount?: Amount; at: number; keepUncharged?: boolean; basis: "remaining-grant" | "known-zero" },
): void {
  // Unmetered work tokens book nothing: the run keeps its observed cumulative and its unlimited (null) remainder.
  const work = { ...charged.work, tokens: charged.work.tokens ?? 0 }, delta = add(work, charged.handoff);
  group.used = add(group.used, delta);
  // A known-zero settlement charges nothing but gives back the whole reservation the run held.
  if (options.releaseReserved) group.reserved = subtract(group.reserved, options.releaseReservedAmount ?? delta);
  for (const b of ["work", "handoff"] as const) {
    const amount = b === "work" ? work : charged.handoff, tokens = charged[b].tokens;
    // Tester follow-up I (seat K, the dogfood run's 423): a dimension with no grant has no remainder (null), as every read
    // checks (controlViews.ts validAccounting) -- an expectation-model run's work tokens, charged at its unused ceiling;
    // `keepUncharged` (a worker-lost run) keeps what was not charged.
    const before = run.remaining[b] as unknown as Record<"tokens" | "activeMs" | "attempts" | "sessions", number | null>;
    run.cumulative[b] = add(run.cumulative[b], amount);
    run.remaining[b] = Object.fromEntries((["tokens", "activeMs", "attempts", "sessions"] as const).map(d => [d,
      (b === "work" && d === "tokens" && options.unmetered) || before[d] === null ? null : options.keepUncharged ? Math.max(before[d]! - amount[d], 0) : 0])) as never;
    run.unknown[b] = false;
    if (tokens !== null) bookSettledUsage(store, { run, groupBody: group as unknown as Record<string, unknown>, bucket: b, tokens, appliedAt: options.at, basis: options.basis });
  }
}
/**
 * The booking of an observed floor (spec 2026-11-06 soft-mode loop run settlement §3.2 arithmetic, §3.4 reservations), shared
 * by Orca's approximate settlement (softLoopSettlement.ts) and a person's or agent's explicit `charge-observed-floor` (tester
 * follow-up F §2, #116), extracted rather than copied. The floor and the baseline count disjoint calls, so the floor itself
 * is booked as work usage; the run is marked `usageApproximate`. Returns the charge and the remainder after the floor (a
 * finite-legacy continuation's commitment, §3.4 last row).
 */
export function bookObservedFloor(store: ControlStore, run: SettlementRun, group: GroupRecord,
  input: { floorTokens: number | null; reason: string; disposition: "committed" | "released" | "recovered"; legacy: boolean; at: number; basis: "observed-floor" | "soft-loop-floor" },
): { charged: { work: Amount; handoff: Amount }; parked: { work: unknown; handoff: Amount } } {
  const { disposition, legacy, at } = input, floor = input.floorTokens ?? 0;
  if (!Number.isSafeInteger(floor) || floor < 0) throw new ControlError("recovery-blocked", `approximate-floor:${floor}`);
  const before = { work: structuredClone(run.remaining.work), handoff: structuredClone(run.remaining.handoff) }, held = before.work.tokens ?? 0;
  run.cumulative.work = { ...run.cumulative.work, tokens: run.cumulative.work.tokens + floor };
  run.remaining.work = { ...run.remaining.work, tokens: run.grant.work.tokens === null ? null : Math.max(run.grant.work.tokens - run.cumulative.work.tokens, 0) } as never;
  run.unknown = { work: false, handoff: false };
  run.usageApproximate = { floorTokens: input.floorTokens, reason: input.reason, at };
  group.used = { ...group.used, tokens: group.used.tokens + floor };
  // §3.4: committed -- the floor leaves the run's own reservation (approximateUsage.ts semantics), the rest stays for its
  // retry; released -- the stop already gave it back; recovered optional-v1 (plan reading 3) -- the whole remainder is
  // released, as a known-usage recoverable stop's (stopIntent.ts terminaliseRun); finite-legacy -- re-parked by the caller.
  if (disposition === "committed") group.reserved = { ...group.reserved, tokens: Math.max(group.reserved.tokens - Math.min(floor, held), 0) };
  if (disposition === "recovered" && !legacy) {
    const release = add(finiteCommitment(before.work), before.handoff);
    group.reserved = Object.fromEntries((["tokens", "activeMs", "attempts", "sessions"] as const).map(d => [d, Math.max(group.reserved[d] - release[d], 0)])) as unknown as Amount;
  }
  bookSettledUsage(store, { run, groupBody: group as unknown as Record<string, unknown>, bucket: "work", tokens: floor, appliedAt: at, basis: input.basis });
  const zero = { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 };
  return { charged: { work: { ...zero, tokens: floor }, handoff: zero }, parked: { work: structuredClone(run.remaining.work), handoff: structuredClone(run.remaining.handoff) } };
}
/**
 * The disposition tail of a settlement, after its booking: shared by a person's settlement and Orca's approximate one
 * (spec 2026-11-06 soft-mode loop run settlement §3.3 step 4, extracted rather than copied). `parked` is the finite-legacy
 * continuation's commitment (a person's: the remainder before the charge; Orca's: the remainder after the floor).
 */
export function finishUsageSettlement(store: ControlStore, input: {
  groupId: string; run: SettlementRun; group: GroupRecord; marker: UsageSettlement; disposition: "committed" | "released" | "recovered";
  requestId: string | null; legacy: boolean; parked: { work: unknown; handoff: Amount }; activity: Record<string, unknown>;
}): void {
  const { groupId, run, group, marker, disposition, legacy, parked } = input;
  run.usageSettlement = marker;
  // Preserve endedAt/activity: this is manual accounting, not another provider terminalisation/release.
  if (disposition === "released") { run.state = "settled-failed"; run.recoverable = false; }
  if (disposition === "recovered") Object.assign(run, { state: "settled-recoverable", recoverable: true, failureCode: null });
  if (disposition !== "committed") store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(run), run.runId);
  else saveRun(store, run as never);
  syncWebBudget(store, group, run as never);
  if (group.budgetVersion === Number.MAX_SAFE_INTEGER) throw new ControlError("numeric-overflow");
  group.budgetVersion += 1; saveGroup(store, group);
  if (disposition === "released") settleManuallyFailedRequestInTransaction(store, groupId, input.requestId!, marker);
  if (disposition === "recovered") {
    // §3.2: where terminaliseRun puts a recoverable stop with known usage. A finite-legacy continuation is funded from
    // the parked commitment.
    const task = readWork(store, groupId, run.workItemId) as unknown as Record<string, unknown>;
    Object.assign(task, { status: "held" }, legacy ? { grant: parked } : { fundingReleased: true });
    saveWork(store, groupId, task as never);
    setAllocationStates(store, groupId, run.workItemId, "held", legacy ? parked as never : undefined);
    if (legacy) reserveCommitment(store, groupId, add(parked.work as never, parked.handoff));
    settleRecoveredRequestInTransaction(store, groupId, input.requestId!, marker);
  }
  recordActivity(store, { groupId, taskId: run.taskId, runId: run.runId, kind: "usage-settled", body: input.activity });
}
/** A run the owner's handoff stop ended while it was still working: no outcome, and only its usage kept it unrecoverable. */
const stoppedWorking = (run: SettlementRun): boolean => run.drive?.outcome === null && run.state === "settled-unrecoverable";
export async function applySettleUnknownUsage(deps: SettleUnknownUsageDeps, command: SettleUnknownUsageCommand): Promise<CommandSuccessV1 | CommandErrorBodyV1> {
  const { store } = deps;
  // Tester #103 review (2026-10-28) kept this the Web owner's: the marker is checked against this command's ledger row,
  // and a socket row recorded only `agent:<c>`. Socket usage settlement spec 2026-10-29: the row now also records the
  // person token's account (`person_principal`, ledgerPersonFor), so an owner's person token settles too, booked to it.
  // Tester follow-up E §8: or a socket agent's own principal for charge-remaining-grant and release-known-zero (never a run
  // Orca dispatched); its row records no person, and the marker names the agent.
  const principal = settlingPrincipalFor(command.commandId, command.payload.acknowledge);
  if (principal === null) throw new Error(`control-verb-human-only: an owner (Web account or person token) required; ${AGENT_SETTLE_NOTE}`);
  const release = deps.admissionGate?.enter();
  try {
    // Evidence read before authority transaction. Its exact run/report/checkpoint snapshot is rechecked inside it.
    let evidence: { body: unknown; proof: ReturnType<typeof settlementProof>; checkpoint: ReturnType<typeof releasedSettlementCheckpoint> | null } | { error: unknown };
    try {
      const run = readRun(store, command.payload.runId) as unknown as SettlementRun;
      const disposition = settlementAdmission(store, run, undefined, command.payload.acknowledge);
      evidence = { body: structuredClone(run), proof: settlementProof(store, run), checkpoint: disposition !== "committed" ? releasedSettlementCheckpoint(store, run) : null };
    } catch (error) { evidence = { error }; }
    await deps.afterEvidence?.();
    return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(store, {
      rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
      apply: context => {
        const groupId = groupCommandTarget(command), run = readRun(store, command.payload.runId) as unknown as SettlementRun;
        if (run.groupId !== groupId || run.taskId !== command.payload.taskId || run.generation !== command.payload.generation) throw new ControlError("run-usage-not-settleable", "identity");
        const disposition = settlementAdmission(store, run, undefined, command.payload.acknowledge);
        if ("error" in evidence) throw evidence.error;
        if (!settlementSame(run, evidence.body) || !settlementSame(settlementProof(store, run), evidence.proof)
          || (disposition !== "committed" && !settlementSame(releasedSettlementCheckpoint(store, run), evidence.checkpoint))) throw new ControlError("run-usage-not-settleable", "evidence-changed");
        const resolution = (request: ReturnType<typeof latestRequestForRun>) => disposition !== "committed"
          ? { handoffResolution: { requestId: request!.requestId, previousState: "settled-unrecoverable", previousFailureCode: "usage-unsettled", ...evidence.checkpoint! } } : {};
        if (command.payload.acknowledge === "charge-observed-floor") {
          // Tester follow-up F §2 (#116, ledger C3): booked as the soft path books it (bookObservedFloor), but by this settler.
          const at = (deps.now ?? (() => new Date()))().getTime(), floorTokens = workerLostFloor(run)!;
          const reason = (run.drive as { blockedReason?: string | null } | undefined)?.blockedReason ?? (run.failureCode as string | null | undefined) ?? "usage-unknown";
          const request = latestRequestForRun(store, groupId, run.runId), group = readGroup(store, groupId);
          const legacy = disposition === "recovered" && !hasTokenPolicy(store, groupId);
          const { charged, parked } = bookObservedFloor(store, run, group, { floorTokens, reason, disposition, legacy, at, basis: "observed-floor" });
          // Tester follow-up I (G spec §16): the floor is booked and the unused live ceiling held for the unknown usage
          // (follow-up H, gap k) is given back in the same write; the run's usage is no longer unknown.
          if (liveCeilingOf(run) !== null) syncCeilingReserve(store, group, run as never);
          const marker = usageSettlementSchema.parse({ method: "observed-floor", commandId: command.commandId, principal, at,
            groupId, taskId: run.taskId, workItemId: run.workItemId, runId: run.runId, generation: run.generation, highWater: run.highWater,
            charged, floorTokens, reason, reservationDisposition: disposition, ...evidence.proof, ...resolution(request) });
          finishUsageSettlement(store, { groupId, run, group, marker, disposition, requestId: request?.requestId ?? null, legacy, parked,
            activity: { method: marker.method, floorTokens, reason, charged, principal, at } });
          deps.beforeCommit?.();
          return commandSuccess(context, { kind: "usage-settled" as const, taskId: run.taskId!, runId: run.runId, generation: run.generation, at, charged, method: marker.method });
        }
        const unmetered = command.payload.acknowledge === "release-unmetered", knownZero = command.payload.acknowledge === "release-known-zero",
          at = (deps.now ?? (() => new Date()))().getTime();
        const zero = { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 };
        const charged = unmetered ? unmeteredChargeSchema.parse({ work: run.remaining.work, handoff: run.remaining.handoff })
          : knownZero ? { work: { ...zero }, handoff: { ...zero } }
          : { work: amountSchema.parse(ceilingRemainder(run) === null ? run.remaining.work : { ...run.remaining.work, tokens: ceilingRemainder(run) }), handoff: amountSchema.parse(run.remaining.handoff) };
        // Tester follow-up I (seat K): a worker-lost run is charged its token remainder only (workerLostCharge).
        const lostWorker = !unmetered && !knownZero && workerLostRun(run);
        if (lostWorker) Object.assign(charged, { work: workerLostCharge(charged.work as Amount), handoff: workerLostCharge(charged.handoff) });
        // Follow-up H (gap k): the ceiling's unused part is held through liveCeilingReserved, not run.remaining; the re-derivation
        // below gives that hold back, so the charge here releases only the rest.
        const ceilingHeld = !unmetered && !knownZero ? ceilingRemainder(run) ?? 0 : 0;
        const request = latestRequestForRun(store, groupId, run.runId);
        const marker = usageSettlementSchema.parse({ method: knownZero ? "known-zero" : unmetered ? "owner-acknowledged-unmetered" : "remaining-grant", commandId: command.commandId, principal, at,
          groupId, taskId: run.taskId, workItemId: run.workItemId, runId: run.runId, generation: run.generation, highWater: run.highWater,
          charged, reservationDisposition: disposition, ...evidence.proof, ...resolution(request),
        });
        const group = readGroup(store, groupId);
        // §3.2: an optional-v1 stop kept its reservation (allocations `unknown`); a finite-legacy stop already released it.
        const legacy = disposition === "recovered" && !hasTokenPolicy(store, groupId), parked = { work: structuredClone(run.remaining.work), handoff: structuredClone(run.remaining.handoff) };
        chargeRunRemainder(store, run, group, charged, { unmetered, keepUncharged: lostWorker, releaseReserved: disposition === "committed" || (disposition === "recovered" && !legacy),
          ...(knownZero ? { releaseReservedAmount: add(finiteCommitment(run.remaining.work), run.remaining.handoff) }
            : ceilingHeld > 0 ? { releaseReservedAmount: subtract(add(charged.work as Amount, charged.handoff), { tokens: ceilingHeld, activeMs: 0, attempts: 0, sessions: 0 }) } : {}), at,
          basis: knownZero ? "known-zero" : "remaining-grant" });
        if (liveCeilingOf(run) !== null) syncCeilingReserve(store, group, run as never);
        finishUsageSettlement(store, { groupId, run, group, marker, disposition, requestId: request?.requestId ?? null, legacy, parked, activity: { method: marker.method, charged, principal, at } });
        deps.beforeCommit?.();
        const receipt = { kind: "usage-settled" as const, taskId: run.taskId!, runId: run.runId, generation: run.generation, at };
        return commandSuccess(context, { ...receipt, charged: marker.charged, method: marker.method });
      },
    }).body;
  } finally { release?.(); }
}
