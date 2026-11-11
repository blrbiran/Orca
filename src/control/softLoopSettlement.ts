/**
 * Spec 2026-11-06 soft-mode loop run settlement (recommendation (d), with the human's answers §6, session 86352010): a loop
 * run of a group with no token limit whose usage the tool did not report is settled by Orca, not left for a person. Its
 * observed floor (ccloop's `usageLowerBound`; none ⇒ 0) is booked as work usage through Orca's own panel-class command,
 * `settle-approximate-usage` under orca-auto, whose ledger row backs the `approximate-floor` marker -- or, refused, is the
 * record of why it was not (§3.3). Code only (Rule 5).
 */
import { approximateUsageApplies } from "./approximateUsage.js";
import { readRun } from "./budget.js";
import { withCommandContext } from "./commandClient.js";
import { applyWebCommand } from "./commandLedger.js";
import { ControlError } from "./errors.js";
import { hasTokenPolicy } from "./fundedAllowance.js";
import { readBudgetProposal, readGroup } from "./queries.js";
import { bookObservedFloor, finishUsageSettlement, settlementAdmission } from "./settleUnknownUsage.js";
import { approximateCommandId, softLoopSince } from "./softLoopSince.js";
import { commandSuccess, groupCommandTarget, latestRequestForRun } from "./stopIntent.js";
import { releasedSettlementCheckpoint, settlementProof, usageSettlementSchema, type SettlementRun } from "./usageSettlement.js";
import type { AdmissionGate } from "./admissionGate.js";
import type { ControlStore } from "./store.js";
import type { CommandErrorBodyV1, CommandSuccessV1, RawAuthorityCommandV1 } from "./webProtocol.js";

/** As orchestration.ts's ORCHESTRATION_ACTOR (Q8); written here, not imported, to keep that module out of this one's imports. */
const ORCA_AUTO = "orca-auto";
export type SettleApproximateUsageCommand = Extract<RawAuthorityCommandV1, { verb: "settle-approximate-usage" }>;
export interface SoftLoopSettlementDeps { store: ControlStore; admissionGate?: AdmissionGate; now?: () => Date }
type LoopRun = SettlementRun & { mode?: unknown; recoveryOf?: unknown; endedAt?: unknown; usageLowerBound?: { tokens: number }; usageApproximate?: unknown; failureCode?: string | null };

/**
 * §6 Q2: a task budget a person set (the plan's tokenBudget, or a person's proposal edit) keeps today's person path; a grant
 * the estimator sized (`model`) or none (null) follows the group. Read from the task's work allocation (provenance enum,
 * webProtocol.ts fieldProvenanceSchema). No allocation reads as authored (the person path, as today).
 */
export function authoredTaskBudget(store: ControlStore, groupId: string, taskId: string): boolean {
  const work = readBudgetProposal(store, groupId).allocations.find(a => a.ownerKind === "task" && a.ownerId === taskId && a.bucket === "work");
  return work === undefined || (work.amount.tokens !== null && work.fieldProvenance.tokens.provenance !== "model");
}

/** §3.6 (plan reading 5): when the run stopped -- endedAt, else its first block at C (a blocked run has no endedAt). */
function stoppedAt(store: ControlStore, run: LoopRun): number | null {
  if (typeof run.endedAt === "number") return run.endedAt;
  const row = store.db.prepare("SELECT MIN(at) AS at FROM activity WHERE run_id=? AND kind='run-blocked' AND json_extract(body,'$.blockedAt')='C'").get(run.runId);
  return row?.at === null || row?.at === undefined ? null : Number(row.at);
}

/** §3.3 step 1, §6 Q2 and Q7, §3.6: the runs the pass settles. */
export function approximateLoopScope(store: ControlStore, run: LoopRun): boolean {
  if (run.phase !== "work" || run.taskId === null) return false;
  // Finding 5 / Q7: saved-result verification and recovery runs keep the person's path.
  if (run.mode !== undefined || run.recoveryOf !== undefined) return false;
  if (!approximateUsageApplies(store, run)) return false;
  if (authoredTaskBudget(store, run.groupId, run.taskId)) return false;
  const since = softLoopSince(store), stopped = stoppedAt(store, run);
  return since !== null && stopped !== null && stopped >= since;
}

/** §3.3 "When the pass is refused": states already shown on the run and group; the pass looks again on a later round. */
const TRANSIENT = new Set(["stop-mode-conflict", "run-usage-not-settleable:handoff-request-open", "run-usage-pending", "group-archived"]);

/** The command's apply (§3.3 steps 2-5, §3.4): admission and proof are read inside the ledger transaction. */
export function applySettleApproximateUsage(deps: SoftLoopSettlementDeps, command: SettleApproximateUsageCommand): CommandSuccessV1 | CommandErrorBodyV1 {
  const { store } = deps;
  // Plan reading 2: the row names orca-auto as its principal, the receipt ccloop compares.
  return withCommandContext(command.commandId, { client: "panel", principal: ORCA_AUTO }, () => applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(store, {
    rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
    apply: context => {
      const groupId = groupCommandTarget(command), run = readRun(store, command.payload.runId) as unknown as LoopRun;
      if (run.groupId !== groupId || run.taskId !== command.payload.taskId || run.generation !== command.payload.generation) throw new ControlError("run-usage-not-settleable", "identity");
      const disposition = settlementAdmission(store, run);
      const proof = settlementProof(store, run), checkpoint = disposition !== "committed" ? releasedSettlementCheckpoint(store, run) : null;
      const at = (deps.now ?? (() => new Date()))().getTime(), floorTokens = run.usageLowerBound?.tokens ?? null;
      const reason = (run.drive as { blockedReason?: string | null } | undefined)?.blockedReason ?? run.failureCode ?? "usage-unknown";
      const request = latestRequestForRun(store, groupId, run.runId), group = readGroup(store, groupId);
      const legacy = disposition === "recovered" && !hasTokenPolicy(store, groupId);
      // §3.2 arithmetic (finding 1) and §3.4 reservations: shared with the explicit observed-floor form (tester follow-up F §2).
      // A finite-legacy continuation is funded from the remainder after the floor (§3.4 last row): `parked`.
      const { charged, parked } = bookObservedFloor(store, run, group, { floorTokens, reason, disposition, legacy, at });
      const marker = usageSettlementSchema.parse({ method: "approximate-floor", commandId: command.commandId, principal: ORCA_AUTO, at,
        groupId, taskId: run.taskId, workItemId: run.workItemId, runId: run.runId, generation: run.generation, highWater: run.highWater,
        charged, floorTokens, reason, reservationDisposition: disposition, ...proof,
        ...(disposition !== "committed" ? { handoffResolution: { requestId: request!.requestId, previousState: "settled-unrecoverable", previousFailureCode: "usage-unsettled", ...checkpoint! } } : {}),
      });
      finishUsageSettlement(store, { groupId, run, group, marker, disposition, requestId: request?.requestId ?? null, legacy, parked,
        activity: { method: "approximate-floor", floorTokens, reason, principal: ORCA_AUTO, at } });
      return commandSuccess(context, { kind: "usage-settled", taskId: run.taskId!, runId: run.runId, generation: run.generation, at, charged, method: "approximate-floor" });
    },
  }).body);
}

/**
 * One run: skipped when out of scope, when its command row exists (applied or refused, it is final), or while a transient
 * code holds it; otherwise the command is issued once. The revision is read in the same synchronous stretch as the apply.
 */
export function bookApproximateLoopRun(deps: SoftLoopSettlementDeps, runId: string): "settled" | "refused" | "skipped" {
  const { store } = deps;
  const run = readRun(store, runId) as unknown as LoopRun;
  if (!approximateLoopScope(store, run)) return "skipped";
  const commandId = approximateCommandId(run.runId, run.generation);
  if (store.db.prepare("SELECT 1 FROM commands WHERE group_id=? AND id=?").get(run.groupId, commandId) !== undefined) return "skipped";
  try { settlementAdmission(store, run); } catch (error) {
    if (!(error instanceof ControlError)) throw error;
    if (TRANSIENT.has(error.message)) return "skipped";
  }
  const revision = store.db.prepare("SELECT revision FROM groups WHERE id=?").get(run.groupId);
  if (revision === undefined) return "skipped";
  const body = applySettleApproximateUsage(deps, {
    schema: "orca-raw-command-v1", commandId, actorId: ORCA_AUTO, expectedRevision: Number(revision.revision),
    verb: "settle-approximate-usage", target: { kind: "group", groupId: run.groupId }, payload: { taskId: run.taskId!, runId: run.runId, generation: run.generation },
  });
  return "error" in body ? "refused" : "settled";
}

/** §3.3 "Where it runs": once per driver round, over every run whose usage is unknown; true when one was settled. */
export function softLoopSettlementPass(deps: SoftLoopSettlementDeps): boolean {
  const { store } = deps;
  if (softLoopSince(store) === null) return false;
  let settled = false;
  for (const row of store.db.prepare("SELECT id FROM runs WHERE json_extract(body,'$.unknown.work')=1 OR json_extract(body,'$.unknown.handoff')=1 ORDER BY rowid").all()) {
    const release = deps.admissionGate?.enter();
    try { if (bookApproximateLoopRun(deps, String(row.id)) === "settled") settled = true; } finally { release?.(); }
  }
  return settled;
}
