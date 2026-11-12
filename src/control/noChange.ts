import { readArtifact } from "./archive.js";
import { recordActivity } from "./activity.js";
import { ControlError } from "./errors.js";
import { readWork, saveWork } from "./queries.js";
import { readSystemDebugMark } from "./systemDebug.js";
import { readTaskResultState } from "./taskResultStore.js";
import { resultExplanationContentSchema } from "./webProtocol.js";
import type { ControlStore } from "./store.js";

/**
 * Tester follow-up G spec §1 (human: 「希望 Orca 自动判完成（事后在活动里留一条可撤销的记录）」) with §10.1: a run ccloop
 * reports succeeded whose attempt tree equals its base completes its task as "no change" -- directly when ccloop's agent
 * verifier approved the goal or the contract declares its command checks decide it, after one goal-judge call when a
 * command verifier only ran the checks. A criteria-review judge group keeps D14: its empty attempt *is* its verdict
 * (protect-acceptance-criteria spec §5), settled by its run.
 */
export type NoChangeRoute = "complete" | "judge" | "none";

interface RouteContract { verification: { verifierType?: string; commandChecksDecideGoal?: boolean } }

export function noChangeRouteOf(contract: RouteContract, groupBody: unknown): NoChangeRoute {
  if (readSystemDebugMark(groupBody)?.source.kind === "criteria-review") return "none";
  if (contract.verification.verifierType === "agent" || contract.verification.commandChecksDecideGoal === true) return "complete";
  return "judge";
}

/** Spec §1 multi-repo: a multi run completes as no change only when every directory's tree equals its base. */
export function allDirsUnchanged(dirs: ReadonlyArray<{ baseTree: string; attemptTree: string }>): boolean {
  return dirs.length > 0 && dirs.every((dir) => dir.baseTree === dir.attemptTree);
}

export const NO_CHANGE_EXPLANATION_MAX_BYTES = 2048;

/** Cut a string to at most `max` UTF-8 bytes on a character boundary. */
export function cutUtf8(text: string, max: number): string {
  if (Buffer.byteLength(text, "utf8") <= max) return text;
  let out = "";
  for (const char of text) {
    if (Buffer.byteLength(out + char, "utf8") > max) break;
    out += char;
  }
  return out;
}

/**
 * Spec §1.2: the agent's own account of why nothing needed changing -- the newest task result whose explanation is
 * available (its completed work, conclusions and limitations, one per line), cut to the byte bound; null when the run
 * reported none or it cannot be read.
 */
export async function noChangeExplanationOf(store: ControlStore, runId: string): Promise<string | null> {
  const state = readTaskResultState(store, runId);
  const observations = [...(state?.observations ?? [])]
    .filter((o) => o.manifest.explanation.status === "available" && o.manifest.explanation.ref !== null)
    .sort((a, b) => b.manifest.attempt - a.manifest.attempt || b.manifest.revision - a.manifest.revision);
  const newest = observations[0];
  if (newest === undefined) return null;
  try {
    const bytes = await readArtifact(store, newest.manifest.explanation.ref!);
    const content = resultExplanationContentSchema.parse(JSON.parse(bytes.toString("utf8")));
    const lines = [...content.completedWork, ...content.conclusions, ...content.limitations].map((line) => line.trim()).filter((line) => line.length > 0);
    return lines.length === 0 ? null : cutUtf8(lines.join("\n"), NO_CHANGE_EXPLANATION_MAX_BYTES);
  } catch { return null; }
}

export interface NoChangeCompletion {
  runId: string; ordinal: number;
  decidedBy: "agent-verifier" | "command-checks" | "judge" | "person" | `agent:${string}`;
  at: number;
}

type NoChangeWork = { workItemId: string; noChangeCompletion?: NoChangeCompletion; noChangeCount?: number };

/**
 * Spec §1.2, in the caller's transaction: the task's visible "no change" record and one `no-change-completed` activity
 * row. `ordinal` counts the task's no-change completions (a second one says "2nd time"); it is kept on the work item, not
 * counted from activity rows, which a busy group's retention drops.
 */
export function recordNoChangeCompletionInTransaction(store: ControlStore, input: {
  groupId: string; taskId: string; runId: string; decidedBy: NoChangeCompletion["decidedBy"]; explanation: string | null;
  judge?: { runId: string; finding: string }; note?: string;
}): NoChangeCompletion {
  const work = readWork(store, input.groupId, input.taskId) as unknown as NoChangeWork;
  const ordinal = (work.noChangeCount ?? 0) + 1;
  const completion: NoChangeCompletion = { runId: input.runId, ordinal, decidedBy: input.decidedBy, at: store.now() };
  work.noChangeCompletion = completion;
  work.noChangeCount = ordinal;
  saveWork(store, input.groupId, work as never);
  recordActivity(store, { groupId: input.groupId, taskId: input.taskId, runId: input.runId, kind: "no-change-completed",
    body: { runId: input.runId, decidedBy: input.decidedBy, ordinal, explanation: input.explanation, ...(input.judge === undefined ? {} : { judge: input.judge }), ...(input.note === undefined ? {} : { note: input.note }) } });
  return completion;
}

/**
 * Spec §10.1, in the caller's transaction, once the no-change acceptance row for `runId` is written: the task blocked on
 * its settled no-change run becomes done (the goal judge said `met`, or a person or an orchestrating agent accepted it as
 * no change). The invariants are repairAcceptedWork's -- the run is settled and continuable, it is the task's current
 * run, and the task's target and the group's graph versions are the run's -- else nothing is written
 * (`recovery-blocked:no-change-invariant`).
 */
export function completeNoChangeInTransaction(store: ControlStore, input: {
  groupId: string; taskId: string; runId: string; decidedBy: NoChangeCompletion["decidedBy"]; explanation: string | null;
  judge?: { runId: string; finding: string }; note?: string;
}): NoChangeCompletion {
  const row = store.db.prepare("SELECT body FROM runs WHERE id=? AND group_id=?").get(input.runId, input.groupId);
  const run = row === undefined ? null : JSON.parse(String(row.body)) as { state: string; recoverable: boolean; targetVersion: number; graphVersion: number; drive?: Record<string, unknown> };
  const work = readWork(store, input.groupId, input.taskId) as unknown as { status: string; currentRunId?: string | null; targetVersion: number };
  const group = JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id=?").get(input.groupId)!.body)) as { graphVersion: number };
  if (run === null || run.state !== "settled" || run.recoverable !== true || run.drive === undefined || work.currentRunId !== input.runId
    || work.targetVersion !== run.targetVersion || group.graphVersion !== run.graphVersion) throw new ControlError("recovery-blocked", "no-change-invariant");
  run.drive = { ...run.drive, blockedReason: null };
  store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(run), input.runId);
  saveWork(store, input.groupId, { ...readWork(store, input.groupId, input.taskId), status: "done" } as never);
  return recordNoChangeCompletionInTransaction(store, input);
}
