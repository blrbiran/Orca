import { readArtifact } from "./archive.js";
import { add } from "./budget.js";
import { snapshotSchema, verifySnapshot } from "./snapshot.js";
import { applyWebCommand } from "./commandLedger.js";
import { settlingPersonFor } from "./commandClient.js";
import { isDirGroup } from "./dirGroup.js";
import { abandonedRun } from "./abandonRun.js";
import { isMultiGroup } from "./multiGroup.js";
import { ControlError } from "./errors.js";
import { groupHasReconcilingRun, readWork, saveWork } from "./queries.js";
import { commandSuccess, groupCommandTarget, readGroupBody, readRunBody, readStopIntent, releaseCommitment, saveRunBody, setAllocationStates, type RunBody } from "./stopIntent.js";
import { finiteCommitment } from "./tokenPolicy.js";
import { refuseFlowChild } from "../flow/groups.js";
import type { AdmissionGate } from "./admissionGate.js";
import type { CheckFailure } from "./checkCommand.js";
import type { DriveRecord } from "./driveRecord.js";
import type { PendingEntry } from "./runLedger.js";
import type { ControlStore } from "./store.js";
import type { ArtifactRef } from "./types.js";
import type { CommandErrorBodyV1, CommandSuccessV1, RawAuthorityCommandV1 } from "./webProtocol.js";

/**
 * Reviewed acceptance (spec 2026-11-11 §7, #227): `task accept-attempt` -- an owner lands the last attempt of a terminal,
 * settled, failed run after Orca re-runs the task's required checks on it. Two phases: this command checks the
 * preconditions and records the intent on the run (`operatorAcceptance`); the execution driver rebuilds the attempt from
 * the run's archive snapshot, merges it onto the group branch tip, runs the task's setup and required checks on the merged
 * tree off-round, and lands it by compare-and-swap, or refuses it by name (acceptAttemptDriver.ts). A closed run's
 * accounting is never touched: it is already settled. A completed-but-unsettled run (spec 2026-11-16) keeps its
 * `drive.outcome`; an E-block that never settled releases the remainder it still holds, as `close-run` does.
 */
export type AcceptAttemptCommand = Extract<RawAuthorityCommandV1, { verb: "accept-attempt" }>;

/** What a landing staged before its compare-and-swap, so a driver that dies after the swap finishes it (never twice). */
export interface StagedAcceptance { attemptSha: string; old: string; next: string; proof: ArtifactRef; pending: PendingEntry[] }

export interface OperatorAcceptance {
  commandId: string; principal: string; note: string; at: number;
  /** The archive snapshot the command checked; the driver rebuilds the attempt from exactly this one. */
  snapshot: ArtifactRef;
  state: "pending" | "landed" | "refused";
  reason: string | null; failure: CheckFailure | null;
  staged: StagedAcceptance | null;
  attemptSha: string | null; landedCommit: string | null; proof: ArtifactRef | null;
}

type AcceptRun = RunBody & {
  drive?: DriveRecord; mode?: string; recoveryOf?: unknown; operatorAcceptance?: OperatorAcceptance;
  operatorSettlement?: { kind: "completed-attempt"; outcome: string; at: number; principal: string } | { kind: "abandoned"; by: string; note: string; at: number };
  remaining?: { work: Record<string, number | null>; handoff: Record<string, number | null> };
};

export function operatorAcceptanceOf(run: object): OperatorAcceptance | null {
  const value = (run as { operatorAcceptance?: unknown }).operatorAcceptance;
  return value === undefined || value === null ? null : value as OperatorAcceptance;
}

/** The newest archive snapshot the driver recorded for a run (stepC's, then cleanup's); null when it kept none. */
export function latestRunSnapshot(store: ControlStore, runId: string): ArtifactRef | null {
  const row = store.db.prepare("SELECT body FROM outbox WHERE kind='archive' AND json_extract(body,'$.runId')=? ORDER BY rowid DESC LIMIT 1").get(runId);
  if (row === undefined) return null;
  const snapshot = (JSON.parse(String(row.body)) as { snapshot?: ArtifactRef | null }).snapshot;
  return snapshot === undefined || snapshot === null ? null : snapshot;
}

export type PreparedAcceptance = { kind: "ready"; snapshot: ArtifactRef } | { kind: "refused"; code: "accept-attempt-snapshot-missing" | "accept-attempt-snapshot-partial"; detail: string };

/**
 * Before the transaction (it reads artifacts): the run's snapshot must be whole -- nothing the capture named missing, the
 * bundle's HEAD and every index blob as recorded. A partial one names what is missing.
 */
export async function prepareAcceptAttempt(store: ControlStore, runId: string): Promise<PreparedAcceptance> {
  const ref = latestRunSnapshot(store, runId);
  if (ref === null) return { kind: "refused", code: "accept-attempt-snapshot-missing", detail: "no-archive-snapshot" };
  let parsed: ReturnType<typeof snapshotSchema.safeParse>;
  try { parsed = snapshotSchema.safeParse(JSON.parse((await readArtifact(store, ref)).toString())); }
  catch (error) { return { kind: "refused", code: "accept-attempt-snapshot-missing", detail: error instanceof ControlError ? error.code : "snapshot-unreadable" }; }
  if (!parsed.success) return { kind: "refused", code: "accept-attempt-snapshot-partial", detail: "snapshot-invalid" };
  if (parsed.data.missing.length > 0) return { kind: "refused", code: "accept-attempt-snapshot-partial", detail: parsed.data.missing.slice(0, 20).join(",") };
  try { await verifySnapshot(store, ref); }
  catch (error) { return { kind: "refused", code: "accept-attempt-snapshot-partial", detail: error instanceof ControlError ? error.code : "snapshot-unverifiable" }; }
  return { kind: "ready", snapshot: ref };
}

export interface AcceptAttemptDeps {
  store: ControlStore; admissionGate?: AdmissionGate;
  /** webService.ts confirmedLadderFor: a confirmed debug ladder owns the run until it folds or settles. */
  ladderInProgress?: (store: ControlStore, groupId: string, taskId: string, runId: string) => string | null;
}

export function applyAcceptAttempt(deps: AcceptAttemptDeps, command: AcceptAttemptCommand, prepared: PreparedAcceptance): CommandSuccessV1 | CommandErrorBodyV1 {
  const { store } = deps;
  const release = deps.admissionGate?.enter();
  try {
    return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(store, {
      rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
      apply: (context) => {
        // Archived groups are refused by the ledger (group-archived), before this.
        const groupId = groupCommandTarget(command), { taskId, runId, note } = command.payload;
        refuseFlowChild(store, groupId);
        if (isMultiGroup(store, groupId)) throw new ControlError("accept-attempt-unsupported", "multi-dir");
        if (isDirGroup(store, groupId)) throw new ControlError("accept-attempt-unsupported", "dir");
        const group = readGroupBody(store, groupId);
        if (group.stopped || readStopIntent(store, groupId) !== null) throw new ControlError("stop-mode-conflict");
        const run = readRunBody(store, runId) as AcceptRun;
        if (run.groupId !== groupId || run.taskId !== taskId) throw new ControlError("run-not-found");
        const work = readWork(store, groupId, taskId) as unknown as { status: string; currentRunId?: string | null; targetVersion: number };
        if (work.status === "done") throw new ControlError("work-already-done", taskId);
        const recorded = operatorAcceptanceOf(run);
        if (recorded !== null && recorded.state !== "refused") throw new ControlError("accept-attempt-pending", recorded.state);
        const outcome = run.drive?.outcome ?? null;
        if (outcome === null) throw new ControlError("accept-attempt-run-not-terminal");
        if (run.mode !== undefined || run.recoveryOf !== undefined || run.phase !== "work") throw new ControlError("accept-attempt-unsupported", "recovery-run");
        // Stuck-runs spec 2026-11-17 S2, human ruling 2026-11-17 (「按你的建议走」): an abandoned run keeps no work to accept --
        // a person judged it worthless; keeping work is what a handoff is for.
        if (abandonedRun(run) || (run as { abandon?: unknown }).abandon !== undefined) throw new ControlError("accept-attempt-unsupported", "abandoned");
        const active = Number(store.db.prepare("SELECT active FROM runs WHERE id=?").get(runId)?.active ?? 0) === 1;
        // Spec 2026-11-16: a run whose work is complete but whose settlement never finished may be
        // accepted too -- a ceiling stop during verify (settled-recoverable/exhausted) or an E-block
        // whose attempt already landed (blocked/E/succeeded). A replay of our own conversion reads
        // as the ordinary closed shape, so it stays admissible.
        const converted = run.operatorSettlement?.kind === "completed-attempt";
        const closed = !active && run.state === "settled-failed" && (outcome !== "succeeded" || converted);
        const ceiling = run.state === "settled-recoverable" && outcome === "exhausted";
        const eBlock = run.state === "blocked" && run.drive?.blockedAt === "E" && outcome === "succeeded";
        if (!closed && !ceiling && !eBlock) {
          if (outcome === "succeeded") throw new ControlError("accept-attempt-run-succeeded");
          throw new ControlError("accept-attempt-run-not-settled", run.state);
        }
        const newest = store.db.prepare("SELECT id FROM runs WHERE group_id=? AND work_item_id=? ORDER BY rowid DESC LIMIT 1").get(groupId, taskId);
        if (work.currentRunId !== runId || newest?.id !== runId || (closed ? work.status !== "blocked" : work.status === "done") || work.targetVersion !== run.targetVersion)
          throw new ControlError("accept-attempt-run-not-current", work.status);
        const ladder = deps.ladderInProgress?.(store, groupId, taskId, runId) ?? null;
        if (ladder !== null) throw new ControlError("accept-attempt-debug-in-progress", ladder);
        if (groupHasReconcilingRun(store, groupId)) throw new ControlError("accept-attempt-group-reconciling");
        const principal = settlingPersonFor(command.commandId);
        if (principal === null) throw new ControlError("accept-attempt-person-required");
        if (prepared.kind === "refused") throw new ControlError(prepared.code, prepared.detail);
        // The snapshot checked before the transaction must still be the run's newest.
        const current = latestRunSnapshot(store, runId);
        if (current === null || current.artifactId !== prepared.snapshot.artifactId || current.hash !== prepared.snapshot.hash) throw new ControlError("accept-attempt-snapshot-missing", "changed");
        const settlement = closed ? null : { kind: "completed-attempt" as const, outcome, at: store.now(), principal };
        const intent: OperatorAcceptance = {
          commandId: command.commandId, principal, note, at: store.now(), snapshot: prepared.snapshot, state: "pending",
          reason: null, failure: null, staged: null, attemptSha: null, landedCommit: null, proof: null,
        };
        if (settlement === null) {
          saveRunBody(store, { ...run, operatorAcceptance: intent } as RunBody);
        } else {
          // The acceptance driver is written against a blocked, inactive run: an E-block that never
          // settled still holds its remainder, so release it as close-run would; a ceiling settle
          // already released its own.
          if (eBlock) {
            if (run.remaining !== undefined) releaseCommitment(store, groupId, add(finiteCommitment(run.remaining.work as never), run.remaining.handoff as never));
            setAllocationStates(store, groupId, run.workItemId, "terminal");
          }
          if (work.status !== "blocked") { work.status = "blocked"; saveWork(store, groupId, work as never); }
          saveRunBody(store, { ...run, state: "settled-failed", operatorAcceptance: intent, operatorSettlement: settlement } as RunBody, false);
        }
        return commandSuccess(context, { kind: "attempt-accept-requested", runId, taskId });
      },
    }).body;
  } finally { release?.(); }
}
