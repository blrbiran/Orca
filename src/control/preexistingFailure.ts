/**
 * Pre-existing failures spec 2026-11-18 L2 (#341): a check that was already red before a task changed anything becomes one
 * problem row on the group, keyed by the command, with three answers a person records for the review.
 *
 * Two sources feed a row (Task 3 ruling in the ledger):
 * - `agent`: a run's result carries a major decision whose question starts with the fixed marker the loop contract tells
 *   the agent verbatim (loopPlans.ts PREEXISTING_FAILURE_CONSTRAINT). Orca reads the marker, never free text (Rule 5),
 *   and records one `preexisting-failure` activity row per command per run when the run's terminal is collected.
 * - `base-check`: L3's base run answered red at the group's (repository, base) for a command one of this group's task
 *   runs failed with `required-check-failed` (baseCheckRecord.ts) -- whichever group's run asked for it first.
 *
 * The answers live in the group body under `preexistingFailureAnswers`, keyed by the command; a group with none has no
 * key, so every group recorded before this change keeps its bytes.
 */
import { recordActivity } from "./activity.js";
import { answeredBaseChecksAt, baseCheckScopeOf } from "./baseCheckRecord.js";
import { applyWebCommand } from "./commandLedger.js";
import { dirWorkspaceOf } from "./dirGroup.js";
import { multiDirOf } from "./multiGroup.js";
import { reviewRequired } from "./requirementReviewRecord.js";
import { settlingPersonFor } from "./commandClient.js";
import { ControlError } from "./errors.js";
import { cutUtf8 } from "./noChange.js";
import { reportedDecisionsOf } from "./reportedDecisions.js";
import { commandSuccess } from "./stopIntent.js";
import type { ControlStore } from "./store.js";
import type { CommandErrorBodyV1, CommandSuccessV1, PreexistingFailureAnswer, RawAuthorityCommandV1 } from "./webProtocol.js";

/** Spec L2, verbatim: the marker a reported decision's question starts with; the command follows it. */
export const PREEXISTING_FAILURE_PREFIX = "Pre-existing failure:";
/** Bounds on what one report keeps (the activity row and the problem row show them). */
export const PREEXISTING_COMMAND_MAX_BYTES = 1024;
export const PREEXISTING_CHOSE_MAX_BYTES = 2048;
/** At most this many distinct commands are kept from one run's report. */
export const PREEXISTING_PER_RUN_MAX = 16;

export interface PreexistingFailureReport { command: string; chose: string }
export interface PreexistingFailureRow {
  command: string;
  /** The task runs whose agent reported it (first report first); empty when only the base run found it. */
  reportedBy: Array<{ taskId: string; runId: string; chose: string }>;
  /**
   * Where Orca learned it: the agent's report, the base run, or both (in that order). Empty for an answered row whose
   * reports were pruned by activity retention (Task 2 review I-2): the answer is kept and still reaches the review.
   */
  sources: Array<"agent" | "base-check">;
  /** The base run's red answer: the run of this group that failed the check, and when the base answered. */
  baseCheck?: { taskId: string; runId: string; at: number };
  answer: PreexistingFailureAnswer | null;
  /** Who recorded the answer, and when; absent while unanswered. */
  answered?: { by: string; at: number };
  /** Task 2 review I-1: whether an answer can reach anyone -- the group has a requirement review that runs (answerableGroup). */
  answerable: boolean;
}

/**
 * Task 2 review I-1: the answers are told only to the requirement review, so only a group whose review runs can be answered:
 * one created from a requirement under follow-up G (reviewRequired: not a plan-file group, flow child or debug group) that
 * is neither multi-directory nor dir (the review pass records those `not-run`, requirementReview.ts). Any other group's
 * rows are information only. (A dir flow group carries no requirement block, so reviewRequired already says no.)
 */
export function answerableGroup(store: ControlStore, groupId: string, body: unknown): boolean {
  return reviewRequired(store, groupId, body) && multiDirOf(body) === null && dirWorkspaceOf(body) === null;
}

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined;

/**
 * Spec L2: the reported decisions that carry the marker -- major ones only (an absent grade reads as major, as every
 * reader of `importance` does), whose question starts with the marker exactly. The command is what follows, trimmed, with
 * one pair of enclosing backticks removed, so `npm test` and npm test are one command. One entry per command, the first.
 */
export function preexistingFailuresOf(decisions: unknown[]): PreexistingFailureReport[] {
  const found = new Map<string, string>();
  for (const decision of decisions) {
    if (field(decision, "importance") === "minor") continue;
    const question = field(decision, "question");
    if (typeof question !== "string" || !question.startsWith(PREEXISTING_FAILURE_PREFIX)) continue;
    let command = question.slice(PREEXISTING_FAILURE_PREFIX.length).trim();
    if (command.length >= 2 && command.startsWith("`") && command.endsWith("`")) command = command.slice(1, -1).trim();
    command = cutUtf8(command, PREEXISTING_COMMAND_MAX_BYTES);
    if (command === "" || found.has(command)) continue;
    const chose = field(decision, "chose");
    found.set(command, cutUtf8(typeof chose === "string" ? chose : "", PREEXISTING_CHOSE_MAX_BYTES));
    if (found.size >= PREEXISTING_PER_RUN_MAX) break;
  }
  return [...found].map(([command, chose]) => ({ command, chose }));
}

/**
 * Inside the caller's transaction, when a task run's terminal is collected (landed or not): one activity row per reported
 * command. A run that already has rows (a collect replayed after a crash) records nothing again. Returns how many.
 */
export function recordPreexistingFailures(store: ControlStore, run: { groupId: string; taskId: string; runId: string }, result: unknown): number {
  const reported = reportedDecisionsOf(result);
  if (reported.kind !== "array") return 0;
  const reports = preexistingFailuresOf(reported.entries);
  if (reports.length === 0) return 0;
  if (store.db.prepare("SELECT 1 FROM activity WHERE run_id=? AND kind='preexisting-failure' LIMIT 1").get(run.runId) !== undefined) return 0;
  for (const report of reports) {
    recordActivity(store, { groupId: run.groupId, taskId: run.taskId, runId: run.runId, kind: "preexisting-failure", body: { taskId: run.taskId, runId: run.runId, ...report } });
  }
  return reports.length;
}

/** A task run of the group whose last rejection was `required-check-failed` on a named command (its stored drive). */
export interface FailedCheck { taskId: string; runId: string; command: string }
export function failedCheckOf(run: unknown): FailedCheck | null {
  const taskId = field(run, "taskId"), runId = field(run, "runId"), last = field(field(run, "drive"), "lastFailure");
  const command = field(last, "failingCommand");
  if (typeof taskId !== "string" || typeof runId !== "string" || field(last, "rejectCategory") !== "required-check-failed" || typeof command !== "string") return null;
  return { taskId, runId, command };
}

type AnswerRecord = { answer: PreexistingFailureAnswer; by: string; at: number };
const ANSWERS: readonly string[] = ["allow-fix", "relative", "edit-requirement"];
function answersOf(body: unknown): Map<string, AnswerRecord> {
  const stored = field(body, "preexistingFailureAnswers");
  const answers = new Map<string, AnswerRecord>();
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return answers;
  for (const [command, value] of Object.entries(stored)) {
    const answer = field(value, "answer"), by = field(value, "by"), at = field(value, "at");
    if (typeof answer === "string" && ANSWERS.includes(answer) && typeof by === "string" && typeof at === "number") answers.set(command, { answer: answer as PreexistingFailureAnswer, by, at });
  }
  return answers;
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The group's rows, by command. `scope` is the group's (repository, base) for the base-check source (null: none -- a
 * multi-directory or dir group, or no base yet); `failed` are its task runs that failed a check. Two indexed reads: the
 * group's `preexisting-failure` activity rows, and the answered base checks at exactly (repository, base).
 */
export function preexistingFailureRows(store: ControlStore, groupId: string, body: unknown, scope: { repoId: string; base: string } | null, failed: readonly FailedCheck[]): PreexistingFailureRow[] {
  const rows = new Map<string, PreexistingFailureRow>();
  const rowFor = (command: string): PreexistingFailureRow => {
    let row = rows.get(command);
    if (row === undefined) { row = { command, reportedBy: [], sources: [], answer: null, answerable: false }; rows.set(command, row); }
    return row;
  };
  for (const entry of store.db.prepare("SELECT body FROM activity WHERE group_id=? AND kind='preexisting-failure' ORDER BY seq").all(groupId)) {
    const report = JSON.parse(String(entry.body)) as { taskId: string; runId: string; command: string; chose: string };
    const row = rowFor(report.command);
    if (!row.sources.includes("agent")) row.sources.push("agent");
    if (!row.reportedBy.some((by) => by.runId === report.runId)) row.reportedBy.push({ taskId: report.taskId, runId: report.runId, chose: report.chose });
  }
  if (scope !== null && failed.length > 0) {
    for (const check of answeredBaseChecksAt(store, scope.repoId, scope.base)) {
      if (check.result !== "red") continue;
      const own = failed.find((run) => run.command === check.command);
      if (own === undefined) continue;
      const row = rowFor(check.command);
      row.sources.push("base-check");
      row.baseCheck = { taskId: own.taskId, runId: own.runId, at: check.at ?? check.requestedAt };
    }
  }
  // Task 2 review I-2: an answer outlives its sources (activity retention may prune the only report): it keeps its row.
  for (const [command, answer] of answersOf(body)) {
    const row = rowFor(command);
    row.answer = answer.answer; row.answered = { by: answer.by, at: answer.at };
  }
  if (rows.size === 0) return [];
  const answerable = answerableGroup(store, groupId, body);
  for (const row of rows.values()) row.answerable = answerable;
  return [...rows.values()].sort((a, b) => compareText(a.command, b.command));
}

/** Outside a polled view: the same rows, reading the group's runs and base itself. */
export function readPreexistingFailures(store: ControlStore, groupId: string, body: unknown): PreexistingFailureRow[] {
  // Task 2 review minor 2: a run body that does not decode reports nothing, as in the view (it is named in unreadableRuns).
  const failed = store.db.prepare("SELECT body FROM runs WHERE group_id=? ORDER BY rowid").all(groupId).flatMap((row) => {
    let run: unknown;
    try { run = JSON.parse(String(row.body)); } catch { return []; }
    const check = failedCheckOf(run);
    return check === null ? [] : [check];
  });
  return preexistingFailureRows(store, groupId, body, baseCheckScopeOf(store, groupId), failed);
}

/** What each answer tells the reviewer. */
const ANSWER_MEANS: Record<PreexistingFailureAnswer, string> = {
  "allow-fix": "the person allows the change that repaired it -- it is an allowed change, not a breach of the requirement",
  relative: "the person judges this check relative to the group's base -- failures already present at the base do not count against the work",
  "edit-requirement": "the person wants the requirement itself changed, which Orca cannot do to an accepted requirement yet -- judge the work against the requirement as it is written here",
};

/** The review's "What Orca recorded beyond the diff" (spec L2): one line per row, with what the person answered. */
export function preexistingFailureFactLines(store: ControlStore, groupId: string, body: unknown): string[] {
  return readPreexistingFailures(store, groupId, body).map((row) => {
    const learned = [
      ...(row.reportedBy.length === 0 ? [] : [`reported by ${row.reportedBy.map((by) => `${by.taskId} (chose: ${cutUtf8(by.chose, 300) || "nothing said"})`).join(", ")}`]),
      ...(row.baseCheck === undefined ? [] : [`red at the group's base when Orca ran it there after ${row.baseCheck.taskId} failed it`]),
    ].join("; ") || "its reports are no longer kept";
    const answer = row.answer === null ? "not answered by the person" : `answered "${row.answer}": ${ANSWER_MEANS[row.answer]}`;
    return `Pre-existing failure \`${cutUtf8(row.command, 300)}\` (already failing before a task changed anything): ${learned}. ${answer}.`;
  });
}

export type AnswerPreexistingFailureCommand = Extract<RawAuthorityCommandV1, { verb: "answer-preexisting-failure" }>;

/**
 * `answer-preexisting-failure` (a person's act, socket tier token): records the answer for one row of the group, keyed
 * by its command; a later answer replaces an earlier one. Refused when the group has no row for the command.
 */
export function applyAnswerPreexistingFailure(deps: { store: ControlStore }, command: AnswerPreexistingFailureCommand): CommandSuccessV1 | CommandErrorBodyV1 {
  return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, {
    rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
    apply: (context) => {
      const groupId = command.target.groupId;
      const row = deps.store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
      if (row === undefined) throw new ControlError("group-not-found");
      const body = JSON.parse(String(row.body)) as Record<string, unknown>;
      const { command: check, answer } = command.payload;
      if (!readPreexistingFailures(deps.store, groupId, body).some((entry) => entry.command === check)) throw new ControlError("preexisting-failure-not-reported");
      // Task 2 review I-1: with no requirement review to tell, an answer would do nothing; the rows are information only.
      if (!answerableGroup(deps.store, groupId, body)) throw new ControlError("preexisting-failure-not-answerable");
      const by = settlingPersonFor(command.commandId);
      if (by === null) throw new ControlError("preexisting-failure-person-required");
      const stored = field(body, "preexistingFailureAnswers");
      const answers = typeof stored === "object" && stored !== null && !Array.isArray(stored) ? stored as Record<string, unknown> : {};
      const next = { ...body, preexistingFailureAnswers: { ...answers, [check]: { answer, by, at: deps.store.now() } } };
      deps.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(next), groupId);
      return commandSuccess(context, { kind: "preexisting-failure-answered", groupId, command: check, answer });
    },
  }).body;
}
