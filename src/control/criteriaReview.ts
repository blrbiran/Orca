import type { AdmissionGate } from "./admissionGate.js";
import { isGroupArchived } from "./archivedMark.js";
import { applyWebCommand } from "./commandLedger.js";
import { ControlError } from "./errors.js";
import { readOrchestrationSettings } from "./orchestration.js";
import { readSystemDebugMark, type SystemDebugSource } from "./systemDebug.js";
import type { ControlStore } from "./store.js";
import type { CommandErrorBodyV1, CommandSuccessV1, RawAuthorityCommandV1 } from "./webProtocol.js";
import { readRepositorySettingsBody, writeRepositorySettingsBody } from "./workspaceSettings.js";

/**
 * Protect-acceptance-criteria spec 2026-10-21 §5 (human: "同意加这个逻辑，但是这个逻辑也要能被关闭"), as built (spec §9):
 * each red `test-change` flag is judged by an agent before a person sees it. The judge is a system debug group of source
 * `criteria-review` (system debug task spec) told to change nothing when the change was justified, and otherwise to
 * restore the stronger criteria and fix the code. Which flags are judged, and what the outcome means, is code (Rule 5):
 * an attempt that changed nothing outside `.decisions/` is "justified" (the flag is cleared as orca-auto); one that
 * changed something "restored" the criteria (cleared too); a failed judge leaves the flag red.
 */
export const CRITERIA_REVIEW_FLAG_SOURCE = "test-change";

/** §5: on unless switched off -- the repository's own setting, else the global default, else on. */
export function criteriaReviewEnabled(store: ControlStore, repoId: string): boolean {
  return readRepositorySettingsBody(store, repoId)?.criteriaReview ?? readOrchestrationSettings(store).criteriaReview ?? true;
}

export interface CriteriaReviewCandidate {
  decisionId: string; groupId: string; runId: string; taskId: string; repoId: string; reason: string; evidence: string[];
  landedCommit: string | null; source: SystemDebugSource;
}

function groupBody(store: ControlStore, groupId: string): Record<string, unknown> | null {
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
  if (row === undefined) return null;
  try { return JSON.parse(String(row.body)) as Record<string, unknown>; } catch { return null; }
}

/**
 * The red `test-change` flags a reviewer may judge: on a run of a task, in a group that is not archived, whose
 * repository has the reviewer on. A flag raised on a criteria-review debug group's own landing is the person's (§7a.5:
 * no loop). `isOpen` answers whether the judge for a source already exists (one per flagged run).
 */
export function criteriaReviewCandidates(store: ControlStore, isOpen: (source: SystemDebugSource) => boolean): CriteriaReviewCandidate[] {
  const out: CriteriaReviewCandidate[] = [];
  for (const row of store.db.prepare("SELECT decision_id, group_id, run_id, body FROM flagged_decisions WHERE source=? AND state='flagged' ORDER BY rowid").all(CRITERIA_REVIEW_FLAG_SOURCE)) {
    const groupId = String(row.group_id), runId = row.run_id === null ? null : String(row.run_id);
    if (runId === null || isGroupArchived(store, groupId)) continue;
    const body = groupBody(store, groupId);
    if (body === null) continue;
    let mark: ReturnType<typeof readSystemDebugMark>;
    try { mark = readSystemDebugMark(body); } catch { continue; }
    if (mark?.source.kind === "criteria-review") continue;
    const repoId = (body.plan as { repoId?: unknown } | undefined)?.repoId;
    if (typeof repoId !== "string" || !criteriaReviewEnabled(store, repoId)) continue;
    const runRow = store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId);
    if (runRow === undefined) continue;
    const run = JSON.parse(String(runRow.body)) as { taskId?: unknown; drive?: { landedCommit?: unknown } };
    if (typeof run.taskId !== "string") continue;
    const source: SystemDebugSource = { kind: "criteria-review", groupId, taskId: run.taskId, runId };
    if (isOpen(source)) continue;
    const flag = JSON.parse(String(row.body)) as { reason: string; evidence: string[] };
    out.push({
      decisionId: String(row.decision_id), groupId, runId, taskId: run.taskId, repoId, reason: flag.reason, evidence: flag.evidence,
      landedCommit: typeof run.drive?.landedCommit === "string" ? run.drive.landedCommit : null, source,
    });
  }
  return out;
}

/** The facts the judge is given: Orca's flag and where the change is, nothing interpreted (as ladderFacts). */
export function criteriaReviewFacts(candidate: CriteriaReviewCandidate): string[] {
  const facts = [
    `decision ${candidate.decisionId} was flagged: ${candidate.reason}`,
    ...candidate.evidence.slice(0, 16).map((line) => `evidence: ${line}`),
    candidate.landedCommit === null ? `the change is the landing of run ${candidate.runId} on orca/${candidate.groupId}`
      : `the landed change (read it with git show): ${candidate.landedCommit}`,
    "If the task's goal required this change to its checks, change nothing: an attempt with no changes records the change as justified.",
  ];
  return facts.map((fact) => fact.slice(0, 4096));
}

/** The flag a criteria-review debug group judges: its source run's `criteria` decision. */
export const criteriaDecisionIdOf = (source: Extract<SystemDebugSource, { runId: string | null }>): string => `${source.runId}/orca-criteria`;

/**
 * §5's verdict, from the judge's own run once it settled succeeded: `justified` when the attempt was empty (Deviation D14:
 * an empty result is not landed, so `landedCommit` stays null), `restored` when it landed a change; null while it has not
 * settled (or cannot be read). A failed judge is settled by the system debug pass as `debug-failed` (the flag stays red).
 */
export function criteriaReviewVerdict(store: ControlStore, debugGroupId: string): "justified" | "restored" | null {
  const work = store.db.prepare("SELECT body FROM work_items WHERE group_id=? ORDER BY rowid").all(debugGroupId)
    .map((row) => JSON.parse(String(row.body)) as { kind?: unknown; currentRunId?: unknown }).find((item) => item.kind === "task");
  if (typeof work?.currentRunId !== "string") return null;
  const runRow = store.db.prepare("SELECT body FROM runs WHERE id=?").get(work.currentRunId);
  const run = runRow === undefined ? undefined : JSON.parse(String(runRow.body)) as { state?: unknown; drive?: { landedCommit?: unknown; outcome?: unknown } };
  const drive = run?.drive;
  if (run?.state !== "settled" || drive === undefined || drive.outcome !== "succeeded") return null;
  return drive.landedCommit === null ? "justified" : typeof drive.landedCommit === "string" ? "restored" : null;
}

export type SetCriteriaReviewCommand = Extract<RawAuthorityCommandV1, { verb: "set-criteria-review" }>;

/** §5's per-repository switch, under the repository settings body's revision (as set-integration-check). */
export function applySetCriteriaReview(
  deps: { store: ControlStore; admissionGate?: AdmissionGate; knownRepository(repoId: string): boolean },
  command: SetCriteriaReviewCommand,
): CommandSuccessV1 | CommandErrorBodyV1 {
  const release = deps.admissionGate?.enter();
  try {
    return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, {
      rawCommand: command,
      expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
      authorityChanged: false,
      projectionGroupIds: [],
      apply: (context) => {
        const target = context.rawCommand.target;
        if (target.kind !== "repository" || !deps.knownRepository(target.repoId)) throw new ControlError("control-target-not-allowed");
        const { enabled } = context.effectiveCommand.payload as { enabled: boolean };
        const current = readRepositorySettingsBody(deps.store, target.repoId);
        if (current?.criteriaReview === enabled) throw new ControlError("no-op-command");
        writeRepositorySettingsBody(deps.store, target.repoId, { ...(current ?? { workspaceMode: "worktree" }), revision: context.nextCommandRevision, criteriaReview: enabled });
        return { status: 200, body: {
          schema: "orca-command-success-v1", commandId: context.rawCommand.commandId, actorId: context.rawCommand.actorId,
          verb: context.rawCommand.verb, target: context.rawCommand.target, commandRevision: context.nextCommandRevision, projectionSeq: null,
          effectivePayloadHash: context.effectivePayloadHash, authorityCommandHash: context.authorityCommandHash,
          result: { kind: "criteria-review-set", repoId: target.repoId, enabled },
        } };
      },
    }).body;
  } finally { release?.(); }
}
