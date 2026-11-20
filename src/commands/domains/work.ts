/**
 * CLI v2 plan Task 4: requirement, group and task writes (spec §4 table; plan "Control verbs → commands"). Every pin
 * (round and draft numbers, draft hash, proposal version, plan hash, profile hashes, selections hash, base versions, the
 * run a retry acts on) is filled from a read made in this invocation.
 */
import { EntryRejection } from "../../entry/envelope.js";
import { resolveId } from "../resolve.js";
import type { CommandDef, WriteContext } from "../types.js";
import {
  adoptFullSuiteLine, checkpointOf, type ClarifyRoundView, config, contextHandoffLines, DELIVERY_FOR_LATER, DELIVERY_NOT_CHOSEN, type EstimateHistory, FULL_SUITE_NOT_SET, currentRun, file, fillRoundAnswer, fundingLines, historyLines, withFunding, group, GROUP, type GroupView, groupView, invalid, json, list, newGroupId, profileBinding, str, task, TASK, softCeilingLines, unestimatedLines, verb, workItem,
} from "./verbs.js";
import { SCHEME_FLAGS, schemeFromFlags } from "./settings.js";
import { SYSTEM_LABELS } from "../../control/labels.js";
import { text } from "./format.js";

/**
 * Tester #206: a stale saved-result source leaves a person one way to land the attempt: `task accept-attempt`. Named only
 * when the view says that verb could take this run (acceptAttempt.ts preconditions: a work run, not a recovery, failed or
 * exhausted, no acceptance pending or landed, not a dir or multi group, not stopped or archived); a run still `blocked`
 * needs its accounting closed first (`group close-run`, which wants the same kind of run), a `settled-failed` one does not.
 */
export function acceptAttemptWayOut(view: unknown, groupId: string, taskId: string, runId: string): string | null {
  const v = view as { summary?: { stopState?: unknown; archived?: unknown; placement?: unknown; multiDir?: unknown };
    runs?: Array<{ runId: string; state?: string; phase?: string; outcome?: string | null; recoveryOf?: unknown; operatorAcceptance?: { state: string } }> };
  const s = v.summary ?? {};
  if ((s.stopState ?? null) !== null || s.archived === true || s.placement !== undefined || s.multiDir !== undefined) return null;
  const run = (v.runs ?? []).find((entry) => entry.runId === runId);
  if (run === undefined || run.phase !== "work" || run.recoveryOf !== undefined || run.outcome == null || run.outcome === "succeeded") return null;
  if (run.operatorAcceptance !== undefined && run.operatorAcceptance.state !== "refused") return null;
  const accept = `orca task accept-attempt ${groupId} ${taskId} --run ${runId} --note <why>`;
  if (run.state === "settled-failed") return `a person may land its last attempt instead: ${accept}`;
  if (run.state === "blocked") return `a person may land its last attempt instead: close its accounting first (orca group close-run ${groupId} --run ${runId}), then ${accept}`;
  return null;
}

/**
 * #226 (ii): a note for a continued task's run -- delivered at its plan and execute boundary as the start envelope's
 * `work.operatorNote` (live transcript spec §10.5.2; ccloop's operatorNoteGate). Never injected into a running turn.
 */
const NOTE_SCOPES = ["next-attempt", "remaining-attempts"] as const;
const NOTE_FLAGS = [
  { name: "note", type: "string" as const, summary: "a note the continued run's agent reads at its next plan/execute (at most 4096 bytes)" },
  { name: "note-scope", type: "string" as const, summary: "next-attempt (default) or remaining-attempts" },
];
function operatorNote(c: WriteContext): { text: string; scope: typeof NOTE_SCOPES[number] } | undefined {
  const note = str(c, "note");
  const scope = str(c, "note-scope");
  if (note === undefined) {
    if (scope !== undefined) throw invalid("--note-scope goes with --note");
    return undefined;
  }
  if (note.trim() === "") throw invalid("--note is empty");
  if (Buffer.byteLength(note, "utf8") > 4096) throw invalid(`--note is ${Buffer.byteLength(note, "utf8")} bytes; at most 4096`);
  if (scope !== undefined && !(NOTE_SCOPES as readonly string[]).includes(scope)) throw invalid(`--note-scope wants ${NOTE_SCOPES.join(" or ")}`);
  return { text: note, scope: (scope ?? "next-attempt") as typeof NOTE_SCOPES[number] };
}

type RoundView = ClarifyRoundView;
interface RequirementView {
  summary: { archived?: boolean; archiveKind?: "archived" | "closed"; requirement?: { roundNo: number | null; draftNo: number | null } };
  rounds?: RoundView[]; drafts: Array<{ draftNo: number; draftHash: string | null; output?: { requirementConflicts?: unknown[] } | null }>;
}
const requirement = async (c: WriteContext): Promise<RequirementView> => await c.read(`groups/${group(c)}/requirement`) as RequirementView;
/**
 * Issue #132: a pin this CLI cannot fill is refused here, before the panel's archive gate could answer. On an archived
 * group that refusal names the archive (the panel's own code), not the missing round or draft.
 */
function missing(c: WriteContext, view: RequirementView, code: string, message: string): EntryRejection {
  if (view.summary.archived === true) {
    // Tester #355: a closed group is refused by the panel as group-closed, so this pin's refusal names it too.
    return view.summary.archiveKind === "closed" ? new EntryRejection("group-closed", `${group(c)} is closed; orca group unclose ${group(c)} first`)
      : new EntryRejection("group-archived", `${group(c)} is archived; orca group unarchive ${group(c)} first`);
  }
  return new EntryRejection(code, message);
}
async function roundNo(c: WriteContext): Promise<number> {
  return (await currentRound(c)).roundNo;
}
/** The current round's number and, when the view holds it, its row (state and result). */
async function currentRound(c: WriteContext): Promise<{ roundNo: number; row: RoundView | undefined }> {
  const view = await requirement(c);
  const round = view.summary.requirement?.roundNo ?? null;
  if (round === null) throw missing(c, view, "requirement-no-round", `${group(c)} has no clarification round`);
  return { roundNo: round, row: view.rounds?.find((r) => r.roundNo === round) };
}
/** #231: the named answers and decisions, filled to the whole round as the Web's defaults (fillRoundAnswer). */
function filledAnswer(c: WriteContext, round: RoundView | undefined) {
  return fillRoundAnswer(round, {
    answers: list(c, "answer").map((value) => {
      const at = value.indexOf("=");
      return at === -1 ? { id: value, kind: "recommended" as const } : { id: value.slice(0, at), kind: "text" as const, text: value.slice(at + 1) };
    }),
    glossaryDecisions: list(c, "glossary").map((v) => decision(v, "glossary")), adrDecisions: list(c, "adr").map((v) => decision(v, "adr")),
  });
}
/**
 * Tester follow-up B T3 (#240): consensus on a round still awaiting answers is the panel's rule (spec §11.1 item 3), and it
 * drops that round's glossary entries and ADRs from the document. The Web confirms it first (Issue 88); the CLI refuses it
 * unless --unanswered says the person means it.
 */
function unansweredRefusal(groupId: string, roundNo: number, round: RoundView | undefined): EntryRejection | null {
  if (round?.state !== "awaiting-answers" || round.result === undefined || round.result === null) return null;
  const { questions, glossary, adrs } = round.result;
  const entries = `${glossary.length} glossary entr${glossary.length === 1 ? "y" : "ies"} and ${adrs.length} ADR(s)`;
  // Tester #354: a round with no questions still waits on its glossary entries and ADRs; answering it keeps them. With
  // nothing to decide either, consensus drops nothing (the Web sends it as is).
  if (questions.length === 0 && glossary.length + adrs.length === 0) return null;
  if (questions.length === 0) return new EntryRejection("requirement-round-unanswered", `round ${roundNo} has no questions, but its ${entries} wait for a decision; consensus now drops them from the document. orca requirement answer ${groupId} --finish accepts them (--glossary/--adr <id>=reject drops one) and closes clarification; or pass --unanswered to agree without them`);
  return new EntryRejection("requirement-round-unanswered", `round ${roundNo} has ${questions.length} unanswered question(s); consensus now closes it unanswered and drops its ${glossary.length} glossary entr${glossary.length === 1 ? "y" : "ies"} and ${adrs.length} ADR(s) from the document. Answer it (orca requirement answer), or pass --unanswered to agree as it stands`);
}
/** #231: the panel's answer-set refusal (`group-state-invalid:<kind>:missing=…;extra=…`), one readable line per kind. */
function answerSetHint(error: { code: string; message: string }): string | undefined {
  if (error.code !== "group-state-invalid") return undefined;
  const lines = error.message.replace(/^group-state-invalid:/, "").split("|").flatMap((part) => {
    const match = /^(answers|glossary-decisions|adr-decisions):(.+)$/.exec(part);
    if (match === null) return [];
    const ids = Object.fromEntries(match[2]!.split(";").map((field) => field.split("=") as [string, string]));
    return [`${match[1]}: ${["missing", "extra", "duplicate"].filter((k) => ids[k] !== undefined).map((k) => `${k} ${ids[k]!.split(",").join(", ")}`).join("; ")}`];
  });
  return lines.length === 0 ? undefined : `the round's ids do not match (orca requirement show lists them): ${lines.join(" | ")}`;
}
async function latestDraft(c: WriteContext): Promise<RequirementView["drafts"][number]> {
  const view = await requirement(c);
  const draftNo = view.summary.requirement?.draftNo ?? null;
  const draft = draftNo === null ? undefined : view.drafts.find((d) => d.draftNo === draftNo);
  if (draft === undefined) throw missing(c, view, "requirement-no-draft", `${group(c)} has no draft`);
  return draft;
}
/**
 * Tester #379: a draft edit on a group whose split was accepted is refused (`requirement-already-accepted:
 * draft-edits-closed:<n>`); no state takes one again. The way to change the split before confirm is to re-split the
 * clarified requirement as a new group (spec 2026-11-19 resplit-as-new-group §6), for every project kind -- named as the
 * refusal's next command. (It was the plan library route, or for a folder or multi-directory project a new requirement.)
 */
const acceptedDraftOf = (error: { code: string; message: string }): string | null =>
  error.code === "requirement-already-accepted" ? /(^|:)draft-edits-closed:(\d+)$/.exec(error.message)?.[2] ?? null : null;
/** #379-381 review (I1 b): an edit the re-validation undoes is refused as changing nothing (requirementDraftEdit.ts). */
const noChangeHint = "nothing changed: once re-validated, the edited split is the draft you reviewed (a file the task's goal names as new is added back to that task); orca requirement feedback asks for a different split";
const acceptedSplit = {
  hint: async (error: { code: string; message: string }): Promise<string | undefined> => {
    if (error.code === "no-op-command" && error.message === "no-op-command:draft-edit-no-change") return noChangeHint;
    const draftNo = acceptedDraftOf(error);
    if (draftNo === null) return undefined;
    return `the split was accepted (draft ${draftNo}), so draft edits are closed; to split it again before the group is confirmed, re-split it as a new group with what was wrong (the next line): the clarification is copied and this group is archived`;
  },
  next: async (error: { code: string; message: string }, c: WriteContext): Promise<string[] | undefined> =>
    acceptedDraftOf(error) === null ? undefined : [`orca requirement resplit ${group(c)} --text "<what was wrong with the split>"`],
};
/**
 * #379-381 review (M3): apply-parallel drops only declared edges; a pair ordered because both tasks list the same file
 * (an implicit edge; requirement show names it) is freed by dropping the file from the task that only reads it.
 * Tester #384: a candidate is now a declared edge whose pair a broad write-set overlap already orders, a person names the
 * pairs (`--pair`, repeatable) or asks for all of them (`--all`), and naming none drops nothing.
 */
const applyParallelRefusals = {
  ...acceptedSplit,
  hint: async (error: { code: string; message: string }, c?: WriteContext): Promise<string | undefined> => {
    const name = c === undefined ? "<group>" : group(c);
    if (error.message === "group-state-invalid:draft-edit-no-parallel-candidates")
      return `no declared dependsOn edge is a parallel candidate (a candidate is a declared edge whose pair a broad target path already orders); two tasks that run one after the other because both list the same file as a target path (requirement show names them) run together after orca requirement drop-path ${name} --task <task> --path <file> on the one that only reads it`;
    if (error.message === "group-state-invalid:draft-edit-no-pairs-selected")
      return `name the pairs to drop: orca requirement apply-parallel ${name} --pair <before>:<after> (repeatable; requirement show lists each as before ∥ after), or --all to drop every candidate`;
    if (error.message === "group-state-invalid:draft-edit-pairs-and-all") return `name the pairs with --pair, or drop every candidate with --all -- not both`;
    if (error.message.startsWith("group-state-invalid:draft-edit-not-a-parallel-candidate:"))
      return `that pair is not a candidate on this draft; requirement show lists the candidates as before ∥ after, and --pair takes before:after`;
    return await acceptedSplit.hint(error);
  },
};
/** Tester #384: one `--pair before:after` (taskIds carry no colon). */
function pairOf(value: string): { before: string; after: string } {
  const at = value.indexOf(":");
  if (at <= 0 || at === value.length - 1) throw invalid(`--pair wants before:after (a candidate as requirement show lists it, before ∥ after), got ${JSON.stringify(value)}`);
  return { before: value.slice(0, at), after: value.slice(at + 1) };
}
const decision = (value: string, flag: string): { id: string; accept: boolean } => {
  const at = value.lastIndexOf("=");
  const verdict = value.slice(at + 1);
  if (at <= 0 || (verdict !== "accept" && verdict !== "reject")) throw invalid(`--${flag} wants <id>=accept|reject, got ${JSON.stringify(value)}`);
  return { id: value.slice(0, at), accept: verdict === "accept" };
};

const empty = (domain: string, action: string, summary: string, verbName: Parameters<typeof verb>[0]["verb"], path: string): CommandDef =>
  verb({ domain, action, summary, verb: verbName, positionals: [GROUP], route: (c) => `groups/${group(c)}/${path}`, payload: () => ({}) });

/**
 * Review-exit spec 2026-11-05 §3.4 (D4): a start (or a never-started group's resume) answered `queued-for-slot` says so in
 * one line; every other answer prints as before.
 */
/** Tester #370 (correction 2026-11-18): an unarchive that paused the group says how to let it run. */
const unarchiveFormat = (row: CommandDef): CommandDef => ({ ...row, format: (body) => {
  const result = (body as { result?: { kind?: unknown; groupId?: unknown; paused?: unknown } } | null)?.result;
  // Tester #355: an unclose pauses the same way.
  return (result?.kind === "unarchived" || result?.kind === "unclosed") && result.paused === true
    ? `${result.kind} ${String(result.groupId)}; paused so it does not run on its own -- let it run with: orca group resume ${String(result.groupId)}` : row.format(body);
} });

/** #379 review (I1): the edges a re-split was refused for (requirement-resplit-group-edges), null for another refusal. */
function resplitEdgesOf(error: { code: string; message: string }): { prerequisites: string[]; dependents: string[] } | null {
  if (error.code !== "requirement-resplit-group-edges") return null;
  const parts = new Map(error.message.slice(`${error.code}:`.length).split(";").map((part) => [part.slice(0, part.indexOf(":")), part.slice(part.indexOf(":") + 1)] as const));
  const ids = (role: string) => parts.get(role)?.split(",").filter((id) => id.length > 0) ?? [];
  return { prerequisites: ids("prerequisites"), dependents: ids("dependents") };
}
/** Tester #379: a re-split names the new group and that this one is archived. */
const resplitFormat = (row: CommandDef): CommandDef => ({ ...row, format: (body) => {
  const result = (body as { result?: { kind?: unknown; groupId?: unknown; newGroupId?: unknown; draftNo?: unknown } } | null)?.result;
  if (result?.kind !== "requirement-resplit") return row.format(body);
  const [old, fresh] = [String(result.groupId), String(result.newGroupId)];
  return `re-split ${old} as ${fresh} (draft ${String(result.draftNo)} is being drafted); ${old} is archived. orca requirement show ${fresh} follows it`;
} });

const queuedFormat = (row: CommandDef): CommandDef => ({ ...row, format: (body) => {
  const result = (body as { result?: { kind?: unknown; ahead?: unknown } } | null)?.result;
  return result?.kind === "queued-for-slot" ? `queued: ${String(result.ahead)} ahead; it starts when a slot frees (orca orchestration show)` : row.format(body);
} });

/**
 * Tester #369 (c): a pause stops new claims only; an attempt already running keeps going (stuck-runs spec: an accepted run
 * is not held). The receipt says so for the runs the group view shows running, and names the command that ends one now.
 * Review of D4 (I6): the view is read after the pause is answered (formatWith), so the read never holds or blocks the
 * pause, and a run still running then is one that keeps going; a read that fails gives the plain receipt.
 * Ruling (2026-11-18 tester batch D review 3): view `starting` (claimed, starting, start-pending) is a run that never
 * reached the provider, and a pause settles it and gives its task back (stuck-runs spec S1, settlePausedUnstarted), so it
 * does not keep going; it is named apart as not started yet.
 */
type ViewRun = { runId: string; taskId: string | null; state?: string };
const taskRunIds = (view: unknown, state: string): string[] => ((view as { runs?: ViewRun[] }).runs ?? [])
  .filter((run) => run.state === state && run.taskId !== null).map((run) => run.runId);
const pausedFormat = (row: CommandDef): CommandDef => ({ ...row, formatWith: async (body, c) => {
  const result = (body as { result?: { kind?: unknown } } | null)?.result;
  if (result?.kind !== "paused") return row.format(body);
  let running: string[]; let starting: string[];
  try { const view = await groupView(c); running = taskRunIds(view, "running"); starting = taskRunIds(view, "starting"); } catch { running = []; starting = []; }
  const startingLine = starting.length === 0 ? [] : [`${starting.length} ${starting.length === 1 ? "run" : "runs"} not started yet; the pause returns ${starting.length === 1 ? "it" : "them"} to the task list (${starting.join(", ")})`];
  if (running.length === 0) return ["paused: no new run is claimed", ...startingLine].join("\n");
  return [`paused: no new run is claimed; ${running.length} ${running.length === 1 ? "run already running keeps going until it ends" : "runs already running keep going until they end"} (${running.join(", ")})`,
    ...startingLine, `to end one now: orca run abandon ${group(c)} --run <run> --note <why>`].join("\n");
} });

/**
 * Tester follow-up E §7 (#251): an answer that queued the next round says so and names --finish (the tester did not
 * know the round they answered was not the last); one that closed clarification says the split is next.
 */
const answeredFormat = (row: CommandDef): CommandDef => ({ ...row, format: (body) => {
  const result = (body as { result?: { kind?: unknown; roundNo?: unknown; nextRoundNo?: unknown; finished?: unknown } } | null)?.result;
  const printed = row.format(body);
  if (result?.kind !== "requirement-answered") return printed;
  if (result.finished === true) {
    // Tester #272 (3): after --finish an agent ran `requirement consensus` by habit and was refused; say what is next.
    const next = answeredGroup === null ? [] : [`next: no consensus is needed; when draft 1 is awaiting review (orca requirement show ${answeredGroup}), orca requirement accept ${answeredGroup}`];
    return [`${printed}\nclarification closed at round ${String(result.roundNo)} with these answers; draft 1 is drafting`, ...next].join("\n");
  }
  return typeof result.nextRoundNo === "number" ? `${printed}\nround ${result.nextRoundNo} is now drafting; use --finish to stop after a round` : printed;
}, jsonBody: (body) => {
  // Tester #272 (3), only-add: a finished answer's --json body names the next command.
  const result = (body as { result?: { kind?: unknown; finished?: unknown } } | null)?.result;
  return result?.kind === "requirement-answered" && result.finished === true && answeredGroup !== null ? { ...(body as object), next: `orca requirement accept ${answeredGroup}` } : body;
} });
/**
 * Pre-existing failures spec L2 (#341): `edit-requirement` is recorded like the other answers, for the requirement review.
 * Task 2 review I-3: Orca cannot change an accepted requirement yet (requirement-revise works only while clarifying), so
 * the line after it says so and names only where the requirement can be read.
 */
const preexistingFailureFormat = (row: CommandDef): CommandDef => ({ ...row, format: (body) => {
  const result = (body as { result?: { kind?: unknown; answer?: unknown; groupId?: unknown } } | null)?.result;
  const printed = row.format(body);
  return result?.kind === "preexisting-failure-answered" && result.answer === "edit-requirement" && typeof result.groupId === "string"
    ? `${printed}\nnext: recorded for the requirement review, which judges the work against the requirement as written; Orca cannot change an accepted requirement yet (read it: orca requirement show ${result.groupId})` : printed;
} });
/** Tester #272 (4): what follows `<code>:` in a refusal's message ("" when nothing does). */
const refusalDetail = (error: { code: string; message: string }): string =>
  error.message.startsWith(`${error.code}:`) ? error.message.slice(error.code.length + 1) : "";
/** A refusal that already names its way on (driveRecord.ts recoveryRetryCommand) gives that command as `next`. */
const namedRecovery = (detail: string): string | undefined => /orca recovery retry --run \S+/.exec(detail)?.[0];
/** settle-usage cannot be undone, so its acknowledgement is left to choose (the verb's flag says which form is whose). */
const settleUsageCommand = (groupId: string, taskId: string): string =>
  `orca task settle-usage ${groupId} ${taskId} --acknowledge <charge-remaining-grant|charge-observed-floor|release-known-zero>`;

/**
 * Tester #272 (4): `task retry`'s refusals that leave an agent without a next step. A run still in Orca's hands (any state
 * but settled-*) is watched, and recovery list names what holds it if it does not move; a settled or blocked run that is
 * not retryable is read with run show, which says what it can still be; unknown usage is settled first; pending usage
 * is retried again once it lands.
 */
async function retryNext(error: { code: string; message: string }, c: WriteContext): Promise<string[] | undefined> {
  // Tester #368 (b): a --model the installation's catalog does not list; the installation is --agent's, else the task's own.
  if (error.code === "agent-selection-invalid" && typeof c.args.flags.model === "string") {
    const named = c.args.flags.agent;
    const installation = typeof named === "string" && named !== "auto" ? named
      : ((await groupView(c)).workItems.find((item) => item.taskId === task(c)) as { agent?: { agent: string } | null } | undefined)?.agent?.agent;
    return installation === undefined ? undefined : [`orca agent models ${installation}`];
  }
  if (error.code !== "task-not-retryable") return undefined;
  const detail = refusalDetail(error);
  const named = namedRecovery(detail);
  if (named !== undefined) return [named];
  if (detail.startsWith("run-state:") || detail.startsWith("blocked-at:") || detail.startsWith("outcome:")) {
    const runId = await currentRun(c);
    const state = detail.startsWith("run-state:") ? detail.slice("run-state:".length) : null;
    return state !== null && !state.startsWith("settled-") ? [`orca run show ${runId}`, "orca recovery list"] : [`orca run show ${runId}`];
  }
  if (detail === "usage-unknown") return [settleUsageCommand(group(c), task(c))];
  if (detail === "usage-pending") return [`orca task retry ${group(c)} ${task(c)}`];
  return undefined;
}

/**
 * Tester #272 (4): `group close-run`'s refusals for a run with no proved terminal failure. A run that recovery retry
 * resumes names that command; unknown usage is settled first; otherwise the run is read, and its task retried.
 */
async function closeRunNext(error: { code: string; message: string }, c: WriteContext): Promise<string[] | undefined> {
  if (error.code !== "run-closure-not-terminal" && error.code !== "run-closure-evidence") return undefined;
  const detail = refusalDetail(error), runId = str(c, "run")!;
  const named = namedRecovery(detail);
  if (named !== undefined) return [named];
  const taskId = (await groupView(c)).runs.find((run) => run.runId === runId)?.taskId ?? null;
  if (detail === "usage-unknown" && taskId !== null) return [settleUsageCommand(group(c), taskId)];
  return [`orca run show ${runId}`, ...(taskId === null ? [] : [`orca task retry ${group(c)} ${taskId}`])];
}

/**
 * Tester #386 (a): `task continue` of a run that ended `exhausted` and recorded no checkpoint used to stop at
 * `checkpoint-not-found` with no way on. The refusal names the retry, and -- when the group has a finite token limit --
 * the complete four-field limit a further attempt needs (its tokens raised by what this run used).
 */
async function continueNext(error: { code: string; message: string }, c: WriteContext): Promise<string[] | undefined> {
  if (error.code !== "checkpoint-not-found") return undefined;
  const runId = await currentRun(c);
  const view = await groupView(c);
  const run = view.runs.find((entry) => entry.runId === runId);
  if (run?.outcome !== "exhausted") return undefined;
  const retry = `orca task retry ${group(c)} ${run.taskId ?? task(c)}`;
  const limit = view.ledger.groupLimit;
  if (limit.tokens === null) return [retry];
  const raised = JSON.stringify({ tokens: limit.tokens + Math.max(1, run.used?.tokens ?? 0), activeMs: limit.activeMs, attempts: limit.attempts, sessions: limit.sessions });
  return [`orca group set-limit ${group(c)} --limit '${raised}'`, retry];
}

const LIMIT_DIMENSIONS = ["tokens", "activeMs", "attempts", "sessions"] as const;
type LimitAmount = GroupView["ledger"]["groupLimit"];
const limitCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/**
 * Tester #386 (b): `--limit` takes the whole budget object, a partial one (the group's current limit fills what it leaves
 * out), or a bare token count. The merge happens here, on this side of the socket, so the panel's budgetAmountSchema stays
 * strict on the wire; an object that names an unknown field, or merges to a value the schema would refuse, is refused here
 * with the field that is wrong.
 */
export function mergedLimit(raw: string, current: LimitAmount): LimitAmount {
  const wanted = `--limit wants a budget object {"tokens":<n|null>,"activeMs":<n>,"attempts":<n>,"sessions":<n>}, a partial one of it (the group's current limit fills the rest), or a token count`;
  let parsed: unknown;
  try { parsed = JSON.parse(raw) as unknown; } catch { throw invalid(wanted); }
  if (typeof parsed === "number") {
    if (!limitCount(parsed)) throw invalid(`--limit: tokens wants a non-negative safe integer or null, not ${JSON.stringify(parsed)}`);
    return { ...current, tokens: parsed };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw invalid(wanted);
  const patch = parsed as Record<string, unknown>;
  const unknown = Object.keys(patch).filter((key) => !(LIMIT_DIMENSIONS as readonly string[]).includes(key));
  if (unknown.length > 0) throw invalid(`--limit: unknown field${unknown.length === 1 ? "" : "s"} ${unknown.map((key) => JSON.stringify(key)).join(", ")}; it takes ${LIMIT_DIMENSIONS.join(", ")}`);
  const merged: Record<string, unknown> = { ...current };
  const invalidFields = LIMIT_DIMENSIONS.filter((dimension) => dimension in patch
    && (dimension === "tokens" ? patch[dimension] !== null && !limitCount(patch[dimension]) : !limitCount(patch[dimension])));
  for (const dimension of LIMIT_DIMENSIONS) if (dimension in patch && !invalidFields.includes(dimension)) merged[dimension] = patch[dimension];
  if (invalidFields.length > 0) throw invalid(`--limit: invalid ${invalidFields.join(", ")} (tokens takes a non-negative safe integer or null; the other dimensions take a non-negative safe integer)`);
  const incomplete = LIMIT_DIMENSIONS.filter((dimension) => dimension === "tokens" ? merged.tokens !== null && !limitCount(merged.tokens) : !limitCount(merged[dimension]));
  if (incomplete.length > 0) throw invalid(`--limit: the merged limit has no usable value for ${incomplete.join(", ")}; pass ${incomplete.join(" and ")} so the group limit is complete`);
  return merged as unknown as LimitAmount;
}

/**
 * Tester follow-up K (#272 rest): `task decide-usage`'s refusals. No room for the next line names the set-limit the refusal
 * already carries; a task not waiting is read in the group's brief; with no expectation stop is the decision left; a paused
 * or stopped group is read, and resumed if it was paused.
 */
function decideUsageNext(error: { code: string; message: string }, c: WriteContext): string[] | undefined {
  if (error.code === "usage-pause-group-headroom") {
    const named = /orca group set-limit \S+ --limit .+$/.exec(refusalDetail(error))?.[0];
    return named === undefined ? undefined : [named];
  }
  if (error.code === "usage-pause-not-waiting") return [`orca group brief ${group(c)}`];
  if (error.code === "usage-pause-no-headroom") return [`orca task decide-usage ${group(c)} ${task(c)} --decision stop`];
  if (error.code === "group-stopped") return [`orca group brief ${group(c)}`, `orca group resume ${group(c)}`];
  return undefined;
}

/**
 * Tester follow-up K (#272 rest): `task settle-usage`'s refusals. The wrong acknowledgement for this run names the one it
 * takes (settleUnknownUsage.ts settlementAcknowledgeFor: an unlimited remainder is released, by a person; any other is
 * charged); usage still arriving is settled again; a run this verb cannot settle is read.
 */
async function settleUsageNext(error: { code: string; message: string }, c: WriteContext): Promise<string[] | undefined> {
  const settle = (acknowledge: string) => `orca task settle-usage ${group(c)} ${task(c)} --acknowledge ${acknowledge}`;
  const detail = refusalDetail(error);
  if (error.code === "run-usage-pending") return [settle(str(c, "acknowledge")!)];
  if (error.code === "run-usage-not-settleable") {
    if (detail === "unlimited-remainder") return [`${settle("release-unmetered")} --as-person`];
    if (["observed-floor-unknown", "known-zero-not-proved", "finite-remainder"].includes(detail)) return [settle("charge-remaining-grant")];
    return [`orca run show ${await currentRun(c)}`];
  }
  if (error.code === "run-usage-settled" || error.code === "run-usage-not-unknown") return [`orca run show ${await currentRun(c)}`];
  return undefined;
}

/** The group `requirement answer` answered, for its output's next step (one command per CLI process). */
let answeredGroup: string | null = null;

/**
 * #251: the panel refuses consensus (`group-state-invalid:round-state`) while the latest round is drafting -- the round
 * a plain answer queued. Name it and --finish, read from the requirement view; any other refusal gets no hint.
 */
async function consensusHint(error: { code: string; message: string }, c?: WriteContext): Promise<string | undefined> {
  // Tester #272 (3): consensus after `answer --finish` (or a second consensus) is refused by design; name what is next.
  if (error.code === "group-state-invalid" && /(^|:)consensus-reached$/.test(error.message) && c !== undefined) {
    return `clarification is already closed (answer --finish or an earlier consensus closed it), so no consensus is needed: when the split draft is awaiting review (orca requirement show ${group(c)}), orca requirement accept ${group(c)}, or ask for changes with orca requirement feedback ${group(c)} --text '<what to change>'`;
  }
  if (error.code !== "group-state-invalid" || !/(^|:)round-state$/.test(error.message) || c === undefined) return undefined;
  const view = await requirement(c);
  const roundNo = view.summary.requirement?.roundNo ?? null;
  const round = view.rounds?.find((r) => r.roundNo === roundNo);
  return round?.state === "drafting"
    ? `round ${roundNo} is drafting (the round your last answer queued); wait for it and agree then, or answer with --finish next time to stop clarifying after a round`
    : undefined;
}

/**
 * Issue #144(d)/#140 (dogfood run 3, session 86352010): the result line is cut at 160 characters, which hid a blocked
 * estimate's state and reason. Import and estimate print both on their own lines after it; their JSON is unchanged. The
 * import result names the reason `estimateReasonCode` (planImport.ts), the estimate result `reasonCode`.
 */
const estimateFormat = (row: CommandDef, reasonField: "estimateReasonCode" | "reasonCode"): CommandDef => ({ ...row, format: (body) => {
  const result = (body as { result?: Record<string, unknown> } | null)?.result;
  if (result === undefined || result === null || typeof result.estimateState !== "string") return row.format(body);
  const reason = result[reasonField];
  const next = result.kind === "imported" && typeof result.groupId === "string"
    ? `\nnext: inspect the imported group's agent selections and budgets before confirmation (panel overrides are not copied): orca control get groups/${result.groupId}/agent-preview; orca proposal show ${result.groupId}`
    : "";
  return `${row.format(body)}\nestimate: ${result.estimateState}\nreason: ${typeof reason === "string" ? reason : "none"}${next}`;
} });

/**
 * Tester follow-up F §4 (#173): the warnings the payload of `group estimate` or `group confirm` found, for --json: the
 * answer's body gains `warnings` (only-add; absent when there is none). #381 (session 3ba26002, human ruling 2): the
 * older-instruction warning that began this is gone; only confirm's full-suite line is left.
 */
let instructionWarnings: string[] = [];
/** Issue #212: the funding preview `group confirm` read, for --json's `funding` (withFunding; only-add). */
let confirmFunding: unknown = null;
/** Tester #173/#224/#266 (follow-up L): the view's estimateHistory `group confirm` read, for --json's `estimateHistory` (only-add). */
let confirmHistory: EstimateHistory | undefined;
const withWarnings = (row: CommandDef): CommandDef => ({ ...row, jsonBody: (body) => {
  const warnings = instructionWarnings; instructionWarnings = [];
  const funding = confirmFunding; confirmFunding = null;
  const history = confirmHistory; confirmHistory = undefined;
  const answered = withFunding(warnings.length === 0 || typeof body !== "object" || body === null ? body : { ...body, warnings }, funding);
  return history === undefined || typeof answered !== "object" || answered === null || "error" in answered ? answered : { ...answered, estimateHistory: history };
} });

/** #224: the lines a row's payload left for its human output, after what the row prints (one command per CLI process). */
let estimateNote: string[] = [];
const withNote = (take: () => string[], row: CommandDef): CommandDef => ({ ...row, format: (body) => {
  const lines = take(), printed = row.format(body);
  return lines.length === 0 ? printed : `${printed}\n${lines.join("\n")}`;
} });

export const WORK_ROWS: CommandDef[] = [
  // --- requirement
  verb({ domain: "requirement", action: "open", summary: "open a requirement from an idea; the group id is generated unless --group names one", verb: "requirement-open",
    flags: [
      { name: "idea", type: "string", required: true, summary: "what to build" }, { name: "group", type: "string", summary: "the new group's id" },
      { name: "language", type: "string", summary: "en|zh: the requirement's content language" },
      { name: "limit", type: "string", humanOnly: true, summary: "the requirement's budget as JSON {tokens,activeMs,attempts,sessions}" },
      // Issue #143: the Web's agent picker (RequirementsPanel.tsx) sends payload.agent; the CLI could not.
      { name: "agent", type: "string", summary: "the installation that runs this requirement's agent calls (orca agent list); default: your agent preferences, else the one installed agent when exactly one is" },
    ],
    scopeId: (c) => newGroupIdOnce(c), route: () => "requirements",
    payload: async (c) => ({
      groupId: newGroupIdOnce(c), repoId: (await c.project()).repoId, idea: str(c, "idea"),
      ...(str(c, "language") === undefined ? {} : { contentLanguage: str(c, "language") }), ...(str(c, "limit") === undefined ? {} : { limit: json(c, "limit") }),
      ...(str(c, "agent") === undefined ? {} : { agent: { agent: str(c, "agent") } }),
    }),
    hint: async (error, c) => {
      // Tester #401: the panel stores a refusal's detail with its code prefixed (`agent-selection-rejected:estimator:…`),
      // so match the detail with or without that prefix; matching only the bare detail made this hint unreachable.
      const detail = error.message.startsWith(`${error.code}:`) ? error.message.slice(error.code.length + 1) : error.message;
      if (error.code !== "agent-selection-rejected" || !detail.startsWith("estimator:agent-unselected")) return undefined;
      const generic = "no agent is selected: pass --agent <installation> (see orca agent list), or set a defaultAgent with orca agent set-preferences";
      // Tester follow-up E §7 (#246): with no defaultAgent and exactly one perAgent entry, name that installation.
      let prefs: { defaultAgent?: unknown; perAgent?: unknown } | undefined;
      try { prefs = c === undefined ? undefined : (await c.read("operator/agent-preferences") as { preferences?: typeof prefs }).preferences; }
      catch { return generic; }
      const perAgent = prefs?.perAgent !== null && typeof prefs?.perAgent === "object" ? Object.keys(prefs.perAgent) : [];
      if (prefs?.defaultAgent === undefined && perAgent.length === 1) {
        return `no agent is selected: pass --agent ${perAgent[0]} (the one installation your agent preferences configure), or set a defaultAgent with orca agent set-preferences`;
      }
      // Tester #401: name what is installed, so the refusal carries the value a person has to type.
      let installed: string[] = [];
      try {
        const listed = c === undefined ? undefined : await c.read("agents") as { installations?: Array<{ id?: unknown }> };
        installed = (listed?.installations ?? []).map((installation) => installation.id).filter((id): id is string => typeof id === "string" && id.length > 0).sort();
      } catch { /* the table cannot be read: the generic sentence stands */ }
      return installed.length === 0 ? generic : generic.replace("no agent is selected: ", `no agent is selected: installed: ${installed.join(", ")}; `);
    },
    examples: ["orca requirement open --idea \"add a dark mode\"", "orca requirement open --idea \"add a dark mode\" --agent claude-main"] }),
  answeredFormat(verb({ domain: "requirement", action: "answer", summary: "answer the current round: --answer <qid> takes the recommendation, --answer <qid>=<text> answers in words; a question not named takes its recommendation and a glossary entry or ADR not named is accepted, as the Web's defaults",
    verb: "requirement-answer", positionals: [GROUP],
    flags: [
      { name: "answer", type: "string", repeatable: true, summary: "<questionId> or <questionId>=<text>" },
      { name: "glossary", type: "string", repeatable: true, summary: "<id>=accept|reject" }, { name: "adr", type: "string", repeatable: true, summary: "<id>=accept|reject" },
      // Tester follow-up E §7 (#251).
      { name: "finish", type: "boolean", summary: "close clarification with these answers: no next round is drafted, and the split is drafted from this round (no requirement consensus follows; the answer names the next command, under --json as `next`)" },
    ],
    route: (c) => `groups/${group(c)}/requirement/answer`,
    payload: async (c) => {
      const round = await currentRound(c);
      answeredGroup = group(c);
      return { roundNo: round.roundNo, ...filledAnswer(c, round.row), ...(c.args.flags.finish === true ? { finish: true } : {}) };
    },
    hint: answerSetHint })),
  verb({ domain: "requirement", action: "consensus", summary: "close clarification at the current round; a round still awaiting answers is refused unless --unanswered", verb: "requirement-consensus", positionals: [GROUP],
    flags: [{ name: "unanswered", type: "boolean", summary: "agree with a round still awaiting answers: its questions stay open and its glossary entries and ADRs are dropped" }],
    route: (c) => `groups/${group(c)}/requirement/consensus`,
    payload: async (c) => {
      const round = await currentRound(c);
      const refusal = c.args.flags.unanswered === true ? null : unansweredRefusal(group(c), round.roundNo, round.row);
      if (refusal !== null) throw refusal;
      return { roundNo: round.roundNo };
    },
    hint: consensusHint }),
  verb({ domain: "requirement", action: "continue", summary: "grant exactly one more clarification round after the cap", verb: "requirement-clarify-more", positionals: [GROUP],
    route: (c) => `groups/${group(c)}/requirement/clarify-more`, payload: async (c) => ({ roundNo: await roundNo(c) }) }),
  // Flow engine spec §10.3 (W-76): a new round revising round --round; the file holds {answers, glossaryDecisions,
  // adrDecisions, reason?, exclude?} as requirement-answer's payload (answers as {id, kind, text?}).
  verb({ domain: "requirement", action: "revise", summary: "revise an answered clarification round (a new round; at most one clarify call)", verb: "requirement-revise", positionals: [GROUP],
    flags: [{ name: "round", type: "string", required: true, summary: "the round number to revise" }, { name: "file", type: "string", required: true, summary: "the answers JSON {answers, glossaryDecisions, adrDecisions, reason?, exclude?}" }],
    route: (c) => `groups/${group(c)}/requirement/revise`,
    payload: (c) => {
      const body = file(c);
      if (body === null || typeof body !== "object" || Array.isArray(body)) throw invalid("--file wants a JSON object");
      const roundNo = Number(str(c, "round"));
      if (!Number.isSafeInteger(roundNo) || roundNo < 1) throw invalid("--round wants a round number");
      return { ...(body as object), roundNo };
    } }),
  verb({ domain: "requirement", action: "feedback", summary: "ask for a new draft of the split", verb: "requirement-draft-feedback", positionals: [GROUP],
    flags: [{ name: "text", type: "string", required: true, summary: "what to change" }],
    route: (c) => `groups/${group(c)}/requirement/feedback`, payload: async (c) => ({ draftNo: (await latestDraft(c)).draftNo, feedback: str(c, "text") }), ...acceptedSplit }),
  // Tester #379 (spec 2026-11-19 resplit-as-new-group): an accepted, unconfirmed split found wrong is split again as a new
  // group -- the clarification copied, the accepted draft sent back with the feedback, this group archived.
  // Controller ruling (Rule 11, session 3ba26002): the flag is `--text`, as `requirement feedback` above names the same
  // text; the payload key is that sibling's too (`feedback`).
  resplitFormat(verb({ domain: "requirement", action: "resplit", summary: "split an accepted requirement again as a new group (before confirm): the clarification is copied, the new split gets the feedback, this group is archived", verb: "requirement-resplit", positionals: [GROUP],
    flags: [{ name: "text", type: "string", required: true, summary: "what was wrong with the accepted split" }, { name: "group", type: "string", summary: "the new group's id (default: generated)" }],
    route: (c) => `groups/${group(c)}/requirement/resplit`, payload: (c) => ({ newGroupId: newGroupIdOnce(c), feedback: str(c, "text") }),
    hint: async (error, c) => {
      const status = error.code === "proposal-confirmed" ? /^proposal-confirmed:resplit:(.+)$/.exec(error.message)?.[1] : undefined;
      if (status !== undefined) return `${c === undefined ? "the group" : group(c)} is confirmed (${status}), so it is not re-split: it may start at any time. To start over, archive it and open a new requirement (the next lines)`;
      const edges = resplitEdgesOf(error);
      if (edges !== null) {
        const named = [edges.prerequisites.length === 0 ? null : `it waits for ${edges.prerequisites.join(", ")}`, edges.dependents.length === 0 ? null : `${edges.dependents.join(", ")} wait${edges.dependents.length === 1 ? "s" : ""} for it`].filter((part) => part !== null).join("; ");
        return `${c === undefined ? "the group" : group(c)} has group dependencies (${named}): a re-split archives it, so a group waiting for it would wait forever and the new group would not wait for its prerequisites. Remove them, re-split, and add them on the new group (the next lines); pause a confirmed dependent first (orca group pause <group>) so it does not start in between`;
      }
      // #379 review (M2): a group opened from a plan, not a requirement, has no clarification to copy and no draft to review.
      if (error.code === "requirement-not-accepted" && error.message.endsWith(":no-requirement")) return `${c === undefined ? "the group" : group(c)} was not opened as a requirement (no clarification to copy), so it is not re-split; to change its tasks before confirm, archive it and import the changed plan or open a requirement`;
      return error.code === "requirement-not-accepted" ? "the split is not accepted yet: a draft under review takes orca requirement feedback <group> --text \"...\"" : undefined;
    },
    next: async (error, c) => {
      if (error.code === "proposal-confirmed" && error.message.startsWith("proposal-confirmed:resplit:")) return [`orca group archive ${group(c)}`, "orca requirement open --idea \"<the requirement, changed>\""];
      const edges = resplitEdgesOf(error);
      if (edges === null) return undefined;
      const old = group(c);
      return [...edges.prerequisites.map((id) => `orca group undepend ${old} --on ${id}`), ...edges.dependents.map((id) => `orca group undepend ${id} --on ${old}`),
        `orca requirement resplit ${old} --text "<what was wrong with the split>" --group <new>`,
        ...edges.prerequisites.map((id) => `orca group depend <new> --on ${id}`), ...edges.dependents.map((id) => `orca group depend ${id} --on <new>`)];
    },
    examples: ["orca requirement resplit g-1 --text \"the two modules do not import each other; run them in parallel\""] })),
  // #351 addendum (spec D2): a draft whose split reports it does not meet the requirement as written is accepted only on
  // purpose (the Web's "Accept anyway"); the refusal is the CLI's own, the payload is the same either way.
  verb({ domain: "requirement", action: "accept", summary: "accept the current draft: the group becomes a draft task group; a draft reporting requirement conflicts is refused unless --despite-conflicts", verb: "requirement-draft-accept", positionals: [GROUP],
    flags: [{ name: "despite-conflicts", type: "boolean", summary: "accept a draft whose split reports it does not meet the requirement as written" }],
    route: (c) => `groups/${group(c)}/requirement/accept`,
    payload: async (c) => {
      const d = await latestDraft(c);
      if (d.draftHash === null) throw missing(c, await requirement(c), "requirement-no-draft", `draft ${d.draftNo} has no output yet`);
      const conflicts = d.output?.requirementConflicts?.length ?? 0;
      if (conflicts > 0 && c.args.flags["despite-conflicts"] !== true) {
        throw new EntryRejection("requirement-draft-conflicts", `draft ${d.draftNo} reports ${conflicts} conflict(s) with the requirement as written (orca requirement show ${group(c)}); send feedback, or pass --despite-conflicts to accept it as it stands`);
      }
      return { draftNo: d.draftNo, draftHash: d.draftHash };
    } }),
  // Tester follow-up K (#284, #265): apply one of the current draft's hints (requirement show lists them); Orca re-validates
  // the edited split as the next draft, awaiting review. No model call is made.
  verb({ domain: "requirement", action: "apply-parallel", summary: "drop the dependsOn edges of the parallel-candidate pairs a person names (--pair, repeatable) or of all of them (--all); the result is the next draft", verb: "requirement-draft-edit", positionals: [GROUP],
    route: (c) => `groups/${group(c)}/requirement/edit`,
    flags: [{ name: "pair", type: "string", repeatable: true, summary: "<before>:<after> of a candidate requirement show lists (repeatable); naming none drops nothing" },
      { name: "all", type: "boolean", summary: "drop every listed candidate's edge (the old one-shot behaviour)" }],
    payload: async (c) => {
      const d = await latestDraft(c);
      if (d.draftHash === null) throw missing(c, await requirement(c), "requirement-no-draft", `draft ${d.draftNo} has no output yet`);
      const pairs = list(c, "pair").map(pairOf), all = c.args.flags["all"] === true;
      if (all && pairs.length > 0) throw invalid("--all and --pair cannot be combined; name the pairs to drop, or ask for all of them");
      return { draftNo: d.draftNo, draftHash: d.draftHash,
        edit: { kind: "apply-parallel-candidates", ...(pairs.length === 0 ? {} : { pairs }), ...(all ? { all: true as const } : {}) } };
    },
    examples: ["orca requirement show g1   # lists the candidates, each as before ∥ after", "orca requirement apply-parallel g1 --pair T3:T4a",
      "orca requirement apply-parallel g1 --all"], ...applyParallelRefusals }),
  verb({ domain: "requirement", action: "add-implied-path", summary: "add a path the current draft lists as implied to that task's target paths; the result is the next draft", verb: "requirement-draft-edit", positionals: [GROUP],
    flags: [{ name: "task", type: "string", required: true, summary: "the task whose success condition names the path" }, { name: "path", type: "string", required: true, summary: "the path, as requirement show lists it" }],
    route: (c) => `groups/${group(c)}/requirement/edit`,
    payload: async (c) => { const d = await latestDraft(c); if (d.draftHash === null) throw missing(c, await requirement(c), "requirement-no-draft", `draft ${d.draftNo} has no output yet`); return { draftNo: d.draftNo, draftHash: d.draftHash, edit: { kind: "add-implied-path", taskId: str(c, "task"), path: str(c, "path") } }; },
    examples: ["orca requirement add-implied-path g1 --task cli --path README.md"], ...acceptedSplit }),
  // Tester #335: a broad claim (src/**) the current draft shares between tasks no dependency orders serialises them; the
  // person narrows the claim to the paths inside it the task writes. Orca re-validates the split as the next draft.
  verb({ domain: "requirement", action: "narrow-path", summary: "replace one of a task's target paths in the current draft with paths inside it; the result is the next draft", verb: "requirement-draft-edit", positionals: [GROUP],
    flags: [{ name: "task", type: "string", required: true, summary: "the task whose target path is narrowed" }, { name: "path", type: "string", required: true, summary: "the target path as the draft lists it (for example src/**)" },
      { name: "to", type: "string", repeatable: true, required: true, summary: "a path inside it the task writes (repeatable)" }],
    route: (c) => `groups/${group(c)}/requirement/edit`,
    payload: async (c) => { const d = await latestDraft(c); if (d.draftHash === null) throw missing(c, await requirement(c), "requirement-no-draft", `draft ${d.draftNo} has no output yet`); return { draftNo: d.draftNo, draftHash: d.draftHash, edit: { kind: "narrow-target-path", taskId: str(c, "task"), path: str(c, "path"), to: list(c, "to") } }; },
    examples: ["orca requirement show g1   # lists 'run one after the other only because their target paths overlap'", "orca requirement narrow-path g1 --task velocity --path 'src/**' --to src/report/velocity.js"], ...acceptedSplit }),
  // Tester #380: a task the split gave a sibling's file (so their write sets intersect and the pair runs one after the
  // other) loses that one target path. Orca re-validates the split as the next draft; the last path is never dropped.
  verb({ domain: "requirement", action: "drop-path", summary: "remove one of a task's target paths in the current draft (never its last); the result is the next draft", verb: "requirement-draft-edit", positionals: [GROUP],
    flags: [{ name: "task", type: "string", required: true, summary: "the task whose target path is removed" }, { name: "path", type: "string", required: true, summary: "the target path as the draft lists it" }],
    route: (c) => `groups/${group(c)}/requirement/edit`,
    payload: async (c) => { const d = await latestDraft(c); if (d.draftHash === null) throw missing(c, await requirement(c), "requirement-no-draft", `draft ${d.draftNo} has no output yet`); return { draftNo: d.draftNo, draftHash: d.draftHash, edit: { kind: "drop-target-path", taskId: str(c, "task"), path: str(c, "path") } }; },
    examples: ["orca requirement show g1   # health-model lists src/health/report.js, which only health-report writes", "orca requirement drop-path g1 --task health-model --path src/health/report.js"], ...acceptedSplit }),
  verb({ domain: "requirement", action: "classify", summary: "set the requirement's class (it sets the clarification caps)", verb: "requirement-classify", positionals: [GROUP],
    flags: [{ name: "scope", type: "string", required: true, summary: "small|medium|large" }, { name: "clarity", type: "string", required: true, summary: "the clarity class" }],
    route: (c) => `groups/${group(c)}/requirement/classify`, payload: (c) => ({ scope: str(c, "scope"), clarity: str(c, "clarity") }) }),
  // Issue #236: a frozen selector the catalog no longer lists (or ccloop's single-call-unsupported) blocks a round; this
  // re-selects the requirement's agent and drafts that round again, keeping the rounds already answered.
  verb({ domain: "requirement", action: "set-agent", summary: "re-select the requirement's agent; a round or draft blocked on the old one is drafted again", verb: "requirement-set-agent", positionals: [GROUP],
    flags: [
      { name: "agent", type: "string", summary: "the installation (orca agent list); default: as your agent preferences choose" },
      { name: "model", type: "string", summary: "the model, as the installation's catalog lists it (orca agent models <installation>)" },
    ],
    route: (c) => `groups/${group(c)}/requirement/set-agent`,
    payload: (c) => {
      const agent = str(c, "agent"), model = str(c, "model");
      if (agent === undefined && model === undefined) throw invalid("give --agent, --model or both");
      return { agent: { ...(agent === undefined ? {} : { agent }), ...(model === undefined ? {} : { model }) } };
    },
    examples: ["orca requirement set-agent g-1 --model tokenswitch/mode-x", "orca requirement set-agent g-1 --agent codex-main --model gpt-5"] }),

  // --- group
  estimateFormat(verb({ domain: "group", action: "import", summary: "import a registered plan, or a plan library version (--library), as a new draft group", verb: "import-plan",
    positionals: [{ name: "plan", summary: "a plan id (or unique prefix) from orca project show / config; not with --library", required: false }],
    flags: [
      { name: "group", type: "string", summary: "the new group's id" }, { name: "estimator-profile", type: "string", summary: "estimate with this profile" },
      { name: "estimate-mode", type: "string", summary: "strict|soft" },
      // Scheduled flows and groups spec §5.5, §13.1: a library entry's version instead of a registered plan.
      { name: "library", type: "string", summary: "a plan library entry (orca plan list) instead of a registered plan" },
      { name: "version", type: "string", summary: "with --library: the displayed version number or a sha256 prefix (numeric SHA prefixes need sha256:); default: the entry's newest" },
    ],
    examples: ["orca group import plan-a", "orca group import --library pl-0123456789abcdef"],
    scopeId: (c) => newGroupIdOnce(c), route: () => "groups/import-plan",
    payload: async (c) => {
      const library = str(c, "library");
      if ((library === undefined) === (c.ids.plan === undefined)) throw invalid("give a plan id or --library <entry>, not both");
      if (library === undefined && str(c, "version") !== undefined) throw invalid("--version goes with --library");
      const profile = str(c, "estimator-profile");
      const binding = profile === undefined ? null : await profileBinding(c, profile);
      let source: Record<string, unknown>;
      if (library !== undefined) {
        const entry = await c.read(`plan-library/${encodeURIComponent(library)}`) as { entryId: string; projectId: string; head: { sha256: string } | null; versions: Array<{ version: number; sha256: string }> };
        const named = str(c, "version");
        const numeric = named !== undefined && /^\d+$/.test(named);
        const selected = numeric ? entry.versions.find((v) => v.version === Number(named)) : undefined;
        if (numeric && selected === undefined) throw new EntryRejection("id-not-found", `no version ${JSON.stringify(named)}; use sha256:${named} for a numeric SHA prefix`);
        const sha256 = named === undefined ? entry.head?.sha256 : numeric ? selected!.sha256
          : resolveId("version", named.startsWith("sha256:") ? named.slice(7) : named, entry.versions.map((v) => v.sha256));
        if (sha256 === undefined) throw new EntryRejection("plan-library-entry-not-found", `${entry.entryId} has no version`);
        source = { repoId: entry.projectId, libraryEntry: { entryId: entry.entryId, sha256 } };
      } else {
        const plans = (await config(c)).plans;
        const planId = resolveId("plan", c.ids.plan!, plans.map((p) => p.planId));
        source = { repoId: plans.find((p) => p.planId === planId)!.repoId, planId };
      }
      // Issue 141: the plan (or library entry) decides the project; a --project naming another one is refused, not ignored.
      if (c.args.global.project !== undefined) {
        const named = await c.project();
        if (named.repoId !== source.repoId) {
          const what = library !== undefined ? `library entry ${library}` : `plan ${String(source.planId)}`;
          throw new EntryRejection("import-project-mismatch", `--project names ${named.projectKey} (${named.repoId}), but ${what} belongs to ${String(source.repoId)}; drop --project or name that project`);
        }
      }
      return {
        groupId: newGroupIdOnce(c), ...source,
        ...(binding === null ? {} : { estimatorProfileId: binding.profileId, estimatorProfileHash: binding.profileHash }),
        ...(str(c, "estimate-mode") === undefined ? {} : { estimateMode: str(c, "estimate-mode") }),
      };
    } }), "estimateReasonCode"),
  withWarnings(withNote(() => { const lines = estimateNote; estimateNote = []; return lines; }, estimateFormat(verb({ domain: "group", action: "estimate", summary: "ask the estimator for budgets at the current proposal version", verb: "estimate", positionals: [GROUP],
    flags: [{ name: "estimator-profile", type: "string", summary: "default: the panel's estimator" }, { name: "mode", type: "string", summary: "strict|soft; default: the panel's" }],
    route: (c) => `groups/${group(c)}/estimates`,
    payload: async (c) => {
      const view = await config(c), defaults = view.defaults;
      const named = str(c, "estimator-profile");
      const binding = named !== undefined ? await profileBinding(c, named) : defaults === null ? null : { profileId: defaults.estimatorProfileId, profileHash: defaults.estimatorProfileHash };
      const mode = str(c, "mode") ?? defaults?.estimateMode;
      if (binding === null || mode === undefined) throw new EntryRejection("estimator-unconfigured", "the panel has no estimator default; pass --estimator-profile and --mode");
      // #381 (session 3ba26002, human ruling 2): Orca always estimates with its newest instruction, so the
      // older-instruction warning is gone; nothing else fills these for an estimate.
      estimateNote = [];
      instructionWarnings = [];
      return { proposalVersion: (await groupView(c)).proposal.proposalVersion, estimatorProfileId: binding.profileId, estimatorProfileHash: binding.profileHash, estimateMode: mode };
    } }), "reasonCode"))),
  withWarnings({ ...verb({ domain: "group", action: "confirm", summary: "confirm the task plan as shown now; it starts when a slot is free unless --hold", verb: "confirm", positionals: [GROUP],
    flags: [
      { name: "hold", type: "boolean", summary: "confirm only; start it later with orca group start" },
      { name: "budget-mode", type: "string", summary: "strict|soft when the proposal has none" },
      { name: "worker-profile", type: "string", summary: "bind the worker profile" }, { name: "handoff-profile", type: "string", summary: "bind the handoff profile" },
      { name: "goal-review-profile", type: "string", summary: "bind the goal-review profile" },
      { name: "handoff-at-context-tokens", type: "integer", summary: "optional: hand off at this many context tokens (not active: no installed agent reports context usage)" },
    ],
    route: (c) => `groups/${group(c)}/confirm`, payload: (c) => confirmPayload(c) }),
    // Session 3cfc2e73 D3: the confirm result carries no allocations; the lines come from the view the payload read.
    format: (body: unknown) => { const lines = confirmNote; confirmNote = []; return lines.length === 0 ? text(body) : `${text(body)}\n${lines.join("\n")}`; } }),
  queuedFormat(empty("group", "start", "start a confirmed group (one confirmed with --hold); at the running-group cap it is queued", "start", "start")),
  pausedFormat(empty("group", "pause", "stop dispatching new runs (running ones finish)", "pause-dispatch", "pause-dispatch")),
  queuedFormat(empty("group", "resume", "dispatch again after a pause", "resume-dispatch", "resume-dispatch")),
  verb({ domain: "group", action: "stop-handoff", summary: "stop: running tasks hand off and stop", verb: "handoff-stop", positionals: [GROUP],
    flags: [{ name: "deadline", type: "string", summary: "UTC YYYY-MM-DDTHH:mm:ss.sssZ" }],
    route: (c) => `groups/${group(c)}/handoff-stop`, payload: (c) => (str(c, "deadline") === undefined ? {} : { handoffDeadlineAt: str(c, "deadline") }) }),
  verb({ domain: "group", action: "resume-handoff", summary: "resume after a completed handoff; --continue <task> continues that task from its checkpoint", verb: "resume-from-handoff",
    positionals: [GROUP], flags: [{ name: "continue", type: "string", repeatable: true, summary: "a task to continue (repeatable)" }, ...NOTE_FLAGS],
    route: (c) => `groups/${group(c)}/resume-from-handoff`,
    payload: async (c) => {
      const items = (await groupView(c)).workItems;
      const note = operatorNote(c);
      if (note !== undefined && list(c, "continue").length === 0) throw invalid("--note goes with --continue <task>: only a continued task's run reads it");
      const selections = [];
      for (const given of list(c, "continue")) {
        const taskId = resolveId("task", given, items.map((w) => w.taskId));
        const runId = items.find((w) => w.taskId === taskId)!.currentRunId;
        if (runId === null) throw new EntryRejection("task-has-no-run", `task ${taskId} has no run to continue`);
        selections.push({ taskId, predecessorRunId: runId, checkpointId: await checkpointOf(c, runId), ...(note === undefined ? {} : { operatorNote: note }) });
      }
      return { selections };
    } }),
  empty("group", "archive", "archive a group (set it aside, abandoned or not wanted): records stay, it refuses every command but unarchive and close; a closed group archived becomes archived", "archive-group", "archive"),
  unarchiveFormat(empty("group", "unarchive", "unarchive a group (one that would run on its own is paused: orca group resume lets it run)", "unarchive-group", "unarchive")),
  // Tester #355: close is the done group's terminal mark -- not close-run, which closes one failed run's accounting.
  empty("group", "close", "close a done group (finished, hide it): records stay, it refuses every command but unclose and archive; an archived done group closed becomes closed. Not close-run", "close-group", "close"),
  unarchiveFormat(empty("group", "unclose", "unclose a closed group: it is done and listed again", "unclose-group", "unclose")),
  // Terminal run closure #169: a proved terminal failure's accounting ends without accepting its work; then archive works.
  verb({ domain: "group", action: "close-run", summary: "close a proved terminal failed run's accounting (it stays failed; retry or archive next)", verb: "close-run", positionals: [GROUP],
    flags: [{ name: "run", type: "string", required: true, summary: "the run to close (orca run show <run> names it)" }],
    route: (c) => `groups/${group(c)}/close-run`, payload: (c) => ({ runId: str(c, "run") }),
    hint: (error) => error.code === "run-closure-evidence" || error.code === "run-closure-not-terminal"
      ? "this run has no proved terminal failure; retry the task, or settle unknown usage if the run reports it"
      : undefined,
    next: closeRunNext }),
  // Stuck-runs spec 2026-11-17 S2 (#344): a person ends a running attempt now; the driver stops it and settles it failed.
  verb({ domain: "run", action: "abandon", summary: "end a running attempt now: Orca stops it and settles it failed, its task blocked until a person retries it (a person's act)",
    verb: "abandon-run", positionals: [GROUP], access: "token",
    flags: [
      { name: "run", type: "string", required: true, summary: "the running run to abandon (orca group show <group> lists the runs)" },
      { name: "note", type: "string", required: true, summary: "why this attempt cannot succeed; recorded on the run" },
    ],
    route: (c) => `groups/${group(c)}/abandon-run`,
    payload: (c) => {
      const note = str(c, "note")!;
      if (note.trim().length === 0) throw invalid("--note wants why you abandon the attempt");
      return { runId: str(c, "run"), note };
    },
    hint: (error) => error.code === "run-abandon-not-running"
      ? "only a run that is starting or running can be abandoned; a stopped one is retried (orca task retry) or closed (orca group close-run)"
      : undefined }),
  verb({ domain: "group", action: "set-limit", summary: "set the group's budget limit", verb: "set-limit", positionals: [GROUP], access: "token",
    flags: [{ name: "limit", type: "string", required: true, summary: "a token count, or a budget object {tokens,activeMs,attempts,sessions} (a partial one keeps the group's current values for the rest)" }],
    route: (c) => `groups/${group(c)}/set-limit`,
    // Tester #386 (b): the panel's budgetAmountSchema stays strict; a partial --limit is merged here with the group's
    // current limit, so the wire always carries the complete four-field object.
    payload: async (c) => ({ limit: mergedLimit(str(c, "limit")!, (await groupView(c)).ledger.groupLimit) }),
    examples: ["orca group set-limit g1 --limit 24000000", "orca group set-limit g1 --limit '{\"tokens\":24000000}'", "orca group set-limit g1 --limit '{\"tokens\":24000000,\"activeMs\":3600000,\"attempts\":6,\"sessions\":6}'"] }),
  verb({ domain: "group", action: "cap", summary: "lower a draft group's token ceiling; raising or removing it requires a person", verb: "proposal-edit", positionals: [GROUP],
    flags: [{ name: "tokens", type: "string", required: true, summary: "finite token ceiling below the current one" }],
    route: (c) => `groups/${group(c)}/proposal/edit`, payload: async (c) => {
      const raw = str(c, "tokens")!;
      if (!/^(0|[1-9][0-9]*)$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw invalid("--tokens wants a non-negative safe integer");
      const tokens = Number(raw), view = await groupView(c), current = view.ledger.groupLimit;
      if (view.proposal.state !== "editable") {
        // Tester #389: an unlimited group can be confirmed by Orca itself; then its proposal is closed to cap, and a person
        // changes the ceiling with set-limit (the command the message names).
        const autoConfirmed = (view.recentCommandIds ?? []).some((id) => id.startsWith("orca-auto-confirm-unlimited-v"));
        throw invalid(autoConfirmed
          ? `group ${group(c)} was already auto-confirmed (Orca confirmed it as an unlimited group), so group cap cannot edit it; a person sets the ceiling with orca group set-limit ${group(c)} --limit <a lower token ceiling>`
          : "group cap needs an editable proposal and a lower token ceiling");
      }
      if (current.tokens !== null && tokens >= current.tokens) throw invalid("group cap needs an editable proposal and a lower token ceiling");
      return { baseProposalVersion: view.proposal.proposalVersion, operations: [], proposedGroupLimit: { ...current, tokens }, capOnly: true };
    }, examples: ["orca group cap g1 --tokens 300000"] }),
  verb({ domain: "group", action: "set-integration", summary: "where this group's finished work goes", verb: "set-group-integration", positionals: [GROUP], flags: SCHEME_FLAGS,
    route: (c) => `groups/${group(c)}/integration`, payload: (c) => ({ integration: schemeFromFlags(c) }) }),
  empty("group", "retry-integration", "a blocked or conflicted integration back to idle", "retry-integration", "integration/retry"),
  // Delivery tail spec D6 (#333): skip the backoff and integrate at the next round; tasks done and acceptance still required.
  empty("group", "integrate", "integrate the group's finished work at the next round (an idle integration; skips only the retry wait)", "integrate-now", "integration/now"),
  empty("group", "resolve-integration", "approve an agent resolving the group's integration conflict", "resolve-integration-conflict", "integration/resolve"),
  // Tester follow-up E §5 (#241): the ways out of a failed group acceptance besides a moved tip.
  empty("group", "recheck", "run a failed group acceptance again on the same tip (a flaky check)", "recheck-acceptance", "acceptance/recheck"),
  // Tester follow-up G spec §3.5: the exits of a requirement review that did not pass (a person or an orchestrating agent).
  verb({ domain: "group", action: "review-accept", summary: "accept a group whose requirement review did not pass as it is, with why", verb: "review-accept", positionals: [GROUP], access: "open",
    flags: [{ name: "note", type: "string", required: true, summary: "why the group is accepted as it is (at most 2048 bytes)" }],
    route: (c) => `groups/${group(c)}/review/accept`, payload: (c) => ({ note: str(c, "note") }) }),
  verb({ domain: "group", action: "review-rerun", summary: "run a group's requirement review again, telling the reviewer what to look at", verb: "review-rerun", positionals: [GROUP], access: "open",
    flags: [{ name: "note", type: "string", required: true, summary: "what the reviewer should look at (at most 2048 bytes)" }],
    route: (c) => `groups/${group(c)}/review/rerun`, payload: (c) => ({ note: str(c, "note") }) }),
  verb({ domain: "group", action: "review-fix", summary: "open a fix task in the group for what its requirement review found (does not use up an automatic round)", verb: "review-fix", positionals: [GROUP], access: "open",
    flags: [{ name: "goal", type: "string", required: true, summary: "what the fix task should do (at most 4096 bytes)" },
      { name: "path", type: "string", repeatable: true, summary: "a file the fix task may write (default: the files the review named)" }],
    route: (c) => `groups/${group(c)}/review/fix`, payload: (c) => ({ goal: str(c, "goal"), ...(list(c, "path").length === 0 ? {} : { paths: list(c, "path") }) }) }),
  verb({ domain: "group", action: "waive-acceptance", summary: "accept a group whose acceptance failed on its tip anyway (a person's act)",
    verb: "waive-acceptance", positionals: [GROUP], access: "token",
    flags: [{ name: "note", type: "string", required: true, summary: "why you accept the failed tip; recorded with the waiver and in the group's activity" }],
    route: (c) => `groups/${group(c)}/acceptance/waive`, payload: (c) => ({ note: str(c, "note") }),
    examples: ["orca group waive-acceptance g1 --note 'the red test is the known flaky one; tracked in #12'"] }),
  // Pre-existing failures spec L2 (#341): the person's answer to a check that was already red before a task changed anything.
  preexistingFailureFormat(verb({ domain: "group", action: "preexisting-failure", summary: "answer a check that already failed before the work: allow-fix, relative or edit-requirement (a person's act)",
    verb: "answer-preexisting-failure", positionals: [GROUP], access: "token",
    flags: [
      { name: "command", type: "string", required: true, summary: "the check as the group's problem row names it (orca group show <group>: preexistingFailures)" },
      { name: "answer", type: "string", required: true, summary: "allow-fix (the change that repaired it is allowed), relative (judge the check against the base) or edit-requirement (you want the requirement changed); recorded and told to the group's requirement review" },
    ],
    route: (c) => `groups/${group(c)}/preexisting-failure`,
    // Tester #402: a miss names the rows, and an ambiguous prefix says to type more; both are copyable.
    hint: (error) => {
      const detail = error.message.startsWith(`${error.code}:`) ? error.message.slice(error.code.length + 1) : error.message;
      if (error.code === "preexisting-failure-command-ambiguous") return `--command matches more than one row (${detail}); pass more of the command`;
      if (error.code === "preexisting-failure-not-reported") return detail === "" || detail === "undefined"
        ? "the group reports no pre-existing failure to answer"
        : `--command must name one of these rows: ${detail}`;
      return undefined;
    },
    payload: (c) => {
      const answer = str(c, "answer");
      if (answer !== "allow-fix" && answer !== "relative" && answer !== "edit-requirement") throw invalid("--answer wants allow-fix, relative or edit-requirement");
      return { command: str(c, "command"), answer };
    },
    examples: ["orca group preexisting-failure g1 --command 'npm test' --answer relative"] })),
  // Dir-requirements spec §9.2: the person's answer to a folder change that stopped a dir group's placement.
  verb({ domain: "group", action: "folder-change", summary: "answer a folder change that stopped placement: --take-folder, --recheck or --withhold",
    verb: "resolve-folder-change", positionals: [GROUP], access: "token",
    flags: [
      { name: "take-folder", type: "boolean", summary: "keep the folder's changes and continue" },
      { name: "recheck", type: "boolean", summary: "look at the folder again" },
      { name: "withhold", type: "boolean", summary: "leave these paths out of the folder and place the rest" },
      { name: "dir", type: "string", summary: "the multi project's folder member (required on a multi group)" },
    ],
    route: (c) => `groups/${group(c)}/folder-change`,
    payload: (c) => {
      const chosen = (["take-folder", "recheck", "withhold"] as const).filter((flag) => c.args.flags[flag] === true);
      if (chosen.length !== 1) throw invalid("give exactly one of --take-folder, --recheck and --withhold");
      const dir = str(c, "dir");
      return { action: chosen[0], ...(dir === undefined ? {} : { dir }) };
    } }),
  // Multi-directory projects spec §9.7: the person's answer to a stopped landing (retry the rest, or record it as done).
  verb({ domain: "group", action: "multi-land", summary: "answer a stopped multi-directory landing: --retry-rest or --mark-resolved",
    verb: "multi-dir-landing", positionals: [GROUP], access: "token",
    flags: [
      { name: "retry-rest", type: "boolean", summary: "pre-check and land the directories not yet landed" },
      { name: "mark-resolved", type: "boolean", summary: "record that the person landed them: they are not due again" },
    ],
    route: (c) => `groups/${group(c)}/multi-dir-landing`,
    payload: (c) => {
      const chosen = (["retry-rest", "mark-resolved"] as const).filter((flag) => c.args.flags[flag] === true);
      if (chosen.length !== 1) throw invalid("give exactly one of --retry-rest and --mark-resolved");
      return { action: chosen[0] };
    } }),
  ...(["depend", "undepend"] as const).map((action) => verb({
    domain: "group", action, summary: action === "depend" ? "make the group wait until --on <group> has landed" : "remove that wait",
    verb: action === "depend" ? "add-group-dependency" : "remove-group-dependency", positionals: [GROUP],
    flags: [{ name: "on", type: "string", required: true, summary: "the group that must land first" },
      ...(action === "depend" ? [{ name: "replace", type: "string" as const, summary: "replace an existing prerequisite atomically" }] : [])],
    route: (c) => `groups/${group(c)}/dependencies/${action === "depend" ? "add" : "remove"}`,
    hint: (error) => action === "depend" && error.code === "group-edge-dependent-started"
      ? "the dependent group already started; dependencies must be set before it starts. Inspect it with orca group show <group>; use a new draft group for a different dependency order"
      : undefined,
    payload: async (c) => {
      const summary = await c.read("summary") as { groups: Array<{ groupId: string }> };
      const choices = summary.groups.map((g) => g.groupId), replaces = action === "depend" ? str(c, "replace") : undefined;
      return { dependsOn: resolveId("group", str(c, "on")!, choices),
        ...(replaces === undefined ? {} : { replaces: resolveId("group", replaces, choices) }) };
    },
  })),

  // --- task
  { ...verb({ domain: "task", action: "retry", summary: "start again a task whose current run failed (the run read now is the one retried), optionally on another installation", verb: "retry-task", positionals: [GROUP, TASK],
    flags: [{ name: "agent", type: "string", summary: "retry on this agent installation instead (quota failover spec §8; not for a task with skills); `auto` hands the choice back to orca-auto (unlocks a task a switch pinned); refused to a run Orca dispatched" },
      // Tester #368 (b): a confirmed task's model changes on its retry.
      { name: "model", type: "string", summary: "retry with this model (orca agent models <installation> lists them; checked against the catalog where one is read, codex): on --agent's installation, else the task's own; not with --agent auto; refused to a run Orca dispatched" },
      { name: "allow-observed-paths", type: "boolean", summary: "allow only the exact paths the last blocked run reported missing; inspect `orca run show` first" },
      // Off-plan writes W4 (#346): the retry the parallel-claim diagnosis names.
      { name: "after", type: "string", summary: "run the task after this sibling task (it stopped writing a file that sibling changes at the same time): waits for it to finish and stops denying its files; not with --allow-observed-paths" },
      // Retry work top-up spec 2026-11-06 §2 "The command".
      { name: "work", type: "string", summary: "add work to the task's budget for this retry and every later run, as JSON {tokens?,activeMs?,attempts?,sessions?} (an omitted dimension adds 0); a person may always, an agent up to the orchestration agent top-up cap; refused to a run Orca dispatched; only a task under the optional token policy" }],
    route: (c) => `groups/${group(c)}/retry-task`, payload: async (c) => {
      const work = json(c, "work");
      if (work !== undefined && (work === null || typeof work !== "object" || Array.isArray(work))) throw invalid("--work wants a JSON object {tokens?,activeMs?,attempts?,sessions?}");
      // Review M2 (#368 b): auto lets orca-auto choose the selection, so a model beside it would be dropped.
      if (c.args.flags.agent === "auto" && typeof c.args.flags.model === "string") throw invalid("--agent auto lets orca-auto choose the agent and model, so it does not take --model: drop --model to hand the choice back, or drop --agent auto to retry with that model on the task's installation (or name one with --agent <installation>)");
      if (work !== undefined) retryNote = await retryFundingLines(c, (work as { tokens?: unknown }).tokens ?? 0);
      return { taskId: task(c), runId: await currentRun(c), ...(c.args.flags["allow-observed-paths"] === true ? { allowObservedPaths: true } : {}), ...(typeof c.args.flags.after === "string" ? { after: resolveId("task", c.args.flags.after, (await groupView(c)).workItems.map((w) => w.taskId)) } : {}), ...(typeof c.args.flags.agent === "string" ? { agent: c.args.flags.agent } : {}), ...(typeof c.args.flags.model === "string" ? { model: c.args.flags.model } : {}), ...(work === undefined ? {} : { work }) };
    }, next: retryNext }),
    // Tester follow-up B T2 (#202): the fresh grant the retry's next run gets, read before the write (print-only).
    format: (body: unknown) => {
      // Tester follow-up E §8: what the new run starts with, when the receipt says (an explicit retry in a group with no token limit).
      // Tester follow-up I (seat L; dogfood g-28d9b560): the receipt says why (`because`); a worker-lost credit in a group with
      // a token limit read "the group has no token limit". A receipt without it (an older panel) keeps the old words.
      const next = (body as { result?: { taskId?: string; nextRun?: { attempts: number; activeMs: number; because?: string } } } | null)?.result;
      const why = next?.nextRun?.because === "worker-lost" ? "its lost run's attempts are credited back: the machine lost that work" : "fresh: the group has no token limit";
      const fresh = next?.nextRun === undefined ? [] : [`the new run of ${next.taskId} gets ${next.nextRun.attempts} attempts and ${Math.round(next.nextRun.activeMs / 60_000)} min active time (${why})`];
      const lines = [...retryNote, ...fresh]; retryNote = [];
      return lines.length === 0 ? text(body) : `${text(body)}\n${lines.join("\n")}`;
    } },
  verb({ domain: "task", action: "continue", summary: "continue a task's current run from its newest complete checkpoint; --note tells its agent something", verb: "continue-task", positionals: [GROUP, TASK],
    flags: NOTE_FLAGS,
    route: (c) => `groups/${group(c)}/tasks/${task(c)}/continue`,
    payload: async (c) => {
      const note = operatorNote(c);
      const runId = await currentRun(c);
      return { predecessorRunId: runId, checkpointId: await checkpointOf(c, runId), ...(note === undefined ? {} : { operatorNote: note }) };
    }, next: continueNext }),
  // Tester follow-up G Part 5: a note for the task's agent; it reaches the agent at its next phase start, never mid-call.
  verb({ domain: "task", action: "note", summary: "add a note to a task's agent, delivered at its next step (plan, execute, verify, next attempt or continuation)", verb: "add-live-note", positionals: [GROUP, TASK],
    flags: [{ name: "text", type: "string", required: true, summary: "the note, at most 2048 UTF-8 bytes" }],
    route: (c) => `groups/${group(c)}/tasks/${task(c)}/live-notes`,
    payload: (c) => ({ text: String(c.args.flags.text) }) }),
  // Tester follow-up G spec §2.5: a task waiting at its pause line (used ~10x its expectation) continues to the next line or stops.
  verb({ domain: "task", action: "decide-usage", summary: "decide on a task waiting at its pause line: --decision continue (to the next line; --note tells its agent something) or stop", verb: "usage-pause-decide", positionals: [GROUP, TASK],
    flags: [{ name: "decision", type: "string", required: true, summary: "continue|stop" }, ...NOTE_FLAGS],
    route: (c) => `groups/${group(c)}/tasks/${task(c)}/usage-pause`,
    payload: (c) => {
      const decision = str(c, "decision");
      if (decision !== "continue" && decision !== "stop") throw invalid("--decision wants continue|stop");
      const note = operatorNote(c);
      return { decision, ...(note === undefined ? {} : { note }) };
    },
    next: decideUsageNext,
    examples: ["orca task decide-usage g1 t1 --decision continue --note \"finish the parser, skip the docs\"", "orca task decide-usage g1 t1 --decision stop"] }),
  verb({ domain: "task", action: "set-loop", summary: "set a task's loop plan from a JSON file {plan,inputs,work,workProvenance?,skills?}", verb: "set-task-loop", positionals: [GROUP, TASK],
    flags: [{ name: "file", type: "string", required: true, summary: "the loop JSON" }],
    route: (c) => `groups/${group(c)}/tasks/${task(c)}/loop`,
    payload: async (c) => {
      const body = file(c);
      if (body === null || typeof body !== "object" || Array.isArray(body)) throw invalid("--file wants a JSON object");
      return { baseLoopVersion: (await workItem(c)).loopPlan?.loopVersion ?? 0, ...(body as object) };
    } }),
  verb({ domain: "task", action: "set-labels", summary: "set a task's labels (--label repeatable), or --clear back to the plan's", verb: "set-task-labels", positionals: [GROUP, TASK],
    flags: [{ name: "label", type: "string", repeatable: true, summary: "a label" }, { name: "clear", type: "boolean", summary: "drop the operator's labels" }],
    route: (c) => `groups/${group(c)}/tasks/${task(c)}/labels`,
    payload: async (c) => {
      if (c.args.flags.clear === true && list(c, "label").length > 0) throw invalid("--clear takes no --label");
      return { labels: c.args.flags.clear === true ? null : list(c, "label"), baseLabelsVersion: (await workItem(c)).labelsVersion ?? 0 };
    },
    // Tester #186: the refusal named the bad value but not one it could use instead.
    hint: (error) => error.code === "labels-invalid" ? `valid labels: ${SYSTEM_LABELS.join(", ")}, or custom:<text>` : undefined }),
  verb({ domain: "task", action: "verify-saved-result", summary: "verify the current run's saved result instead of re-running (after run eligibility says eligible)",
    verb: "verify-saved-result", positionals: [GROUP, TASK],
    flags: [{ name: "work", type: "string", summary: "add work for the verification run as JSON {tokens?,activeMs?,attempts?,sessions?}; a person may always, an agent within the top-up cap; refused to a run Orca dispatched" }],
    route: (c) => `groups/${group(c)}/tasks/${task(c)}/verify-saved-result`,
    payload: async (c) => {
      const work = json(c, "work");
      if (work !== undefined && (work === null || typeof work !== "object" || Array.isArray(work))) throw invalid("--work wants a JSON object {tokens?,activeMs?,attempts?,sessions?}");
      const runId = await currentRun(c);
      const answer = await c.read(`runs/${runId}/saved-result-eligibility`) as { status: string; reason?: string; recoveryOf?: { sourceRunId: string; sourceAttempt: number; capsuleHash: string } };
      if (answer.status !== "eligible" || answer.recoveryOf === undefined) {
        const wayOut = answer.reason === "saved-result-source-stale" ? acceptAttemptWayOut(await groupView(c), group(c), task(c), runId) : null;
        throw new EntryRejection("saved-result-unavailable", `the saved result is not eligible: ${answer.reason ?? answer.status}${wayOut === null ? "" : `; ${wayOut}`}`);
      }
      const { sourceRunId, sourceAttempt, capsuleHash } = answer.recoveryOf;
      return { sourceRunId, sourceAttempt, capsuleHash, ...(work === undefined ? {} : { work }) };
    } }),
  // Reviewed acceptance (spec 2026-11-11 §7): an owner lands a terminal, settled run's last attempt after Orca re-runs its checks.
  verb({ domain: "task", action: "accept-attempt", summary: "land a failed, settled run's last attempt after Orca re-runs the task's checks on it (an owner's act)",
    verb: "accept-attempt", positionals: [GROUP, TASK], access: "token",
    flags: [
      { name: "run", type: "string", required: true, summary: "the terminal run whose last attempt to accept (orca run show <run> names it)" },
      { name: "note", type: "string", required: true, summary: "why you accept it; recorded with the acceptance and in the run's decision ledger" },
    ],
    route: (c) => `groups/${group(c)}/accept-attempt`,
    payload: (c) => ({ taskId: task(c), runId: str(c, "run"), note: str(c, "note") }),
    hint: (error) => error.code === "accept-attempt-run-not-settled"
      ? "close the run's accounting first (orca group close-run, or orca task settle-usage), then accept its attempt"
      : undefined }),
  // Tester follow-up G spec §1.4: revoke a no-change completion (or a no-change stop) and run the task again in this group.
  verb({ domain: "task", action: "reopen", summary: "revoke a task's no-change completion and run it again in this group with a note for its agent",
    verb: "reopen-task", positionals: [GROUP, TASK], access: "open",
    flags: [{ name: "note", type: "string", required: true, summary: "what the agent should know; delivered as the new run's operator note (at most 2048 bytes)" }],
    route: (c) => `groups/${group(c)}/reopen-task`,
    payload: async (c) => ({ taskId: task(c), runId: await currentRun(c), note: str(c, "note") }) }),
  // Tester follow-up G spec §10.1: accept a task stopped as a provable no change (no change twice, the judge unfunded or failed).
  verb({ domain: "task", action: "accept-no-change", summary: "accept a task that stopped with no change on its current run as done, with why",
    verb: "accept-no-change", positionals: [GROUP, TASK], access: "open",
    flags: [{ name: "note", type: "string", required: true, summary: "why no change is the right result; recorded with the acceptance (at most 2048 bytes)" }],
    route: (c) => `groups/${group(c)}/accept-no-change`,
    payload: async (c) => ({ taskId: task(c), runId: await currentRun(c), note: str(c, "note") }) }),
  // Tester follow-up E §8: an agent may charge the grant or settle a proved zero without a person token; release-unmetered
  // wants one (humanOnly.ts SOCKET_TIER), so the verb is open and its flag says which form is a person's.
  verb({ domain: "task", action: "settle-usage", summary: "settle a run's unknown usage (cannot be undone)", verb: "settle-unknown-usage", positionals: [GROUP, TASK], access: "open",
    // Tester follow-up F §2 (#116, ledger C3): charge-observed-floor books a finite remainder's run at ccloop's observed floor.
    flags: [{ name: "acknowledge", type: "string", required: true, summary: "charge-remaining-grant|charge-observed-floor|release-known-zero|release-unmetered: an agent may send charge-remaining-grant, or release-known-zero when ccloop proved the failed run spent nothing, or charge-observed-floor (charges only the floor ccloop observed, marked approximate; a finite remainder, or a live ceiling, with a known floor -- a worker-lost run that observed usage has 0 beyond it --, else refused observed-floor-unknown: then charge-remaining-grant), without a person token; release-unmetered needs a person token (orca auth login, then --as-person); refused to a run Orca dispatched" }],
    hint: (error) => error.code === "control-person-token-required"
      ? "without a person token, send --acknowledge charge-remaining-grant (or release-known-zero when proved, or charge-observed-floor when ccloop observed a floor); release-unmetered is a person's: orca auth login, then --as-person"
      // Tester follow-up I (G spec §16): no floor -- the unused grant or live ceiling stays held until charged.
      : error.message.endsWith(":observed-floor-unknown")
        ? "ccloop observed no usage floor for this run: settle with --acknowledge charge-remaining-grant (charges the unused grant or live ceiling), or wait; until then that part stays held"
        : undefined,
    route: (c) => `groups/${group(c)}/settle-unknown-usage`,
    payload: async (c) => {
      const runId = await currentRun(c);
      const generation = (await groupView(c)).runs.find((r) => r.runId === runId)?.unknownUsageSettlement?.generation;
      if (generation === undefined) throw new EntryRejection("usage-not-unknown", `run ${runId} has no unknown usage to settle`);
      return { taskId: task(c), runId, generation, acknowledge: str(c, "acknowledge") };
    }, next: settleUsageNext }),
];

/** One generated id per invocation: the payload and the revision lookup must name the same new group. */
const generated = new WeakMap<WriteContext, string>();
function newGroupIdOnce(c: WriteContext): string {
  let id = generated.get(c);
  if (id === undefined) { id = newGroupId(c); generated.set(c, id); }
  return id;
}

interface AgentPreview {
  proposalVersion?: number; selectionsHash: string | null;
  slots?: Array<{ key: string; slot: string; taskId: string | null; outcome: { kind: string; code?: string } }>;
}

/**
 * Issue #144: name each slot that does not resolve, with its code and the command that sets it, instead of one line
 * pointing at `orca agent list` (which only lists installations and fixes nothing).
 */
function unresolvedMessage(groupId: string, preview: AgentPreview): string {
  const failed = (preview.slots ?? []).filter((slot) => slot.outcome.kind !== "resolved");
  if (failed.length === 0) return "an agent slot does not resolve at this proposal version; see orca proposal show";
  const lines = failed.map((slot) => {
    const target = slot.taskId === null ? `--slot ${slot.slot}` : `--task ${slot.taskId}`;
    const next = slot.outcome.kind === "unavailable" ? "ccloop could not be asked just now; retry" : `set it with orca proposal set-agent ${groupId} ${target} --agent <installation>`;
    return `${`${slot.key}: ${slot.outcome.kind} ${slot.outcome.code ?? ""}`.trimEnd()}; ${next}`;
  });
  // Tester follow-up E §7 (#250): the group worker slot is the batch set (tester-round2 spec): it reaches every task's
  // worker and the reconcile slot. Lead with it when one of those has no agent at all; a slot naming a missing
  // installation is not fixed by it.
  const batch = failed.some((slot) => (slot.slot === "worker" || slot.slot === "reconcile") && slot.outcome.code === "agent-unselected")
    ? [`orca proposal set-agent ${groupId} --slot worker --agent <installation>  (sets every task and reconcile)`] : [];
  return `${failed.length} agent slot(s) do not resolve:\n  ${[...batch, ...lines].join("\n  ")}`;
}

/**
 * Tester follow-up B T2 (#202): `task retry --work`'s human lines -- what the panel's funding preview says retrying this
 * task with these tokens funds its next run (authored + top-ups - lineage usage; the group's headroom may fund less), and a
 * warning when that is below what one attempt of the task has cost. Nothing when the preview cannot say (the write then
 * answers for itself): this note never stops the command.
 */
let retryNote: string[] = [];
async function retryFundingLines(c: WriteContext, tokens: unknown): Promise<string[]> {
  if (typeof tokens !== "number" || !Number.isSafeInteger(tokens) || tokens < 0) return [];
  let retry: { authoredTokens: number | null; lineageTokens: number; freshTokens: number | null; perAttemptTokens: number | null } | null | undefined;
  try { retry = (await c.read(`groups/${group(c)}/funding-preview?retry=${encodeURIComponent(task(c))}&tokens=${tokens}`) as { retry?: typeof retry }).retry; }
  catch { return []; }
  if (retry === null || retry === undefined) return [];
  if (retry.freshTokens === null) return [`the next run of ${task(c)} has no token limit`];
  return [`the next run of ${task(c)} is funded at most ${retry.freshTokens} tokens (authored ${retry.authoredTokens} with top-ups, minus ${retry.lineageTokens} used by its earlier runs)`,
    ...(retry.perAttemptTokens !== null && retry.freshTokens < retry.perAttemptTokens
      ? [`warning: ${retry.freshTokens} tokens is less than one attempt of ${task(c)} has cost (${retry.perAttemptTokens}); the run may stop or overspend before it finishes an attempt`] : [])];
}

/** Spec §4: confirm's pins, as the Web's confirm builds them (BudgetEditor.tsx submitConfirm), read now. */
/** Session 3cfc2e73 D3: the unestimated-default lines of the view `group confirm` read, for its human output (one command per CLI process). */
let confirmNote: string[] = [];
async function fullSuiteConfirmLines(c: WriteContext, repoId: string): Promise<string[]> {
  let suggested: unknown;
  try { suggested = (await c.read(`checks?repoId=${encodeURIComponent(repoId)}`) as { suggestedCommand?: unknown } | null)?.suggestedCommand; } catch { return []; }
  return typeof suggested === "string"
    ? [`full suite: ${FULL_SUITE_NOT_SET}, so group acceptance will run only the tasks' own checks`, ...adoptFullSuiteLine(suggested)] : [];
}
/** The repository read's `chosen` (absent: an older panel, read as chosen); a panel without the read says nothing. */
async function deliveryChoiceConfirmLines(c: WriteContext, repoId: string): Promise<string[]> {
  let chosen: unknown;
  try { chosen = (await c.read(`repositories/${encodeURIComponent(repoId)}/integration`) as { chosen?: unknown } | null)?.chosen; } catch { return []; }
  return chosen === false ? [DELIVERY_NOT_CHOSEN, DELIVERY_FOR_LATER] : [];
}
async function confirmPayload(c: WriteContext): Promise<unknown> {
  const view = await groupView(c);
  const funding = await c.read(`groups/${group(c)}/funding-preview`);
  confirmHistory = (view as { estimateHistory?: EstimateHistory }).estimateHistory;
  confirmNote = [...unestimatedLines(group(c), view, { afterConfirm: true }), ...softCeilingLines(view), ...fundingLines(funding), ...historyLines(confirmHistory)];
  confirmFunding = funding;
  const defaults = (await config(c)).defaults;
  const preview = await c.read(`groups/${group(c)}/agent-preview`) as AgentPreview;
  // Tester #144(b): an already confirmed proposal is the panel's to answer (no-op-command), not this pre-check's. The panel
  // refuses it before it compares selections, so an unresolved preview sends the all-zero hash -- which, should the
  // proposal have been reopened meanwhile, matches no resolution and is refused there.
  const confirmed = view.proposal.state === "confirmed";
  if (!confirmed && (preview.selectionsHash === null || preview.proposalVersion !== view.proposal.proposalVersion)) {
    throw new EntryRejection("agent-selection-unresolved", unresolvedMessage(group(c), preview));
  }
  const flagFor = { worker: "worker-profile", handoff: "handoff-profile", goalReview: "goal-review-profile" } as const;
  const bind = async (kind: "estimator" | "worker" | "handoff" | "goalReview") => {
    if (kind !== "estimator" && str(c, flagFor[kind]) !== undefined) return profileBinding(c, str(c, flagFor[kind])!);
    if (view.proposal.profiles !== null) return view.proposal.profiles[kind];
    return defaults === null ? null : { profileId: defaults.estimatorProfileId, profileHash: defaults.estimatorProfileHash };
  };
  const bindings = { estimator: await bind("estimator"), worker: await bind("worker"), handoff: await bind("handoff"), goalReview: await bind("goalReview") };
  // #381 ruling 2: no older-instruction warning; `warnings` now carries only the full-suite line below.
  instructionWarnings = [];
  for (const kind of ["worker", "handoff", "goalReview"] as const) {
    if (bindings[kind] === null) throw new EntryRejection("confirm-profile-missing", `no ${kind} profile; pass --${flagFor[kind]} <id>`);
  }
  const budgetMode = view.proposal.budgetMode ?? str(c, "budget-mode") ?? defaults?.estimateMode;
  if (budgetMode === undefined) throw new EntryRejection("confirm-budget-mode-missing", "the proposal has no budget mode; pass --budget-mode strict|soft");
  const tokens = c.args.flags["handoff-at-context-tokens"];
  const threshold = typeof tokens === "number" ? tokens : view.proposal.contextPolicy.handoffAtContextTokens;
  confirmNote.push(...contextHandoffLines(threshold));
  // Tester follow-up K, item 2 (human ruling ①): no full-suite command set, one detected -- name it and how to adopt it;
  // nothing is run or required. A panel without the read, or one that refuses it, adds no line.
  const suiteLines = typeof view.plan.repoId === "string" ? await fullSuiteConfirmLines(c, view.plan.repoId) : [];
  confirmNote.push(...suiteLines);
  instructionWarnings.push(...suiteLines.slice(0, 1));
  // Working-tree delivery spec §4.2 item 3: on a project nobody chose a delivery for, the question once after the receipt;
  // confirm proceeds. Not for a folder or multi-directory group (their delivery is fixed).
  if (typeof view.plan.repoId === "string" && (view.summary as { placement?: unknown; multiDir?: unknown }).placement === undefined
    && (view.summary as { multiDir?: unknown }).multiDir === undefined) confirmNote.push(...await deliveryChoiceConfirmLines(c, view.plan.repoId));
  return {
    planHash: view.plan.planHash, proposalVersion: view.proposal.proposalVersion, budgetMode,
    profileIds: { estimator: bindings.estimator?.profileId ?? null, worker: bindings.worker!.profileId, handoff: bindings.handoff!.profileId, goalReview: bindings.goalReview!.profileId },
    profileHashes: { estimator: bindings.estimator?.profileHash ?? null, worker: bindings.worker!.profileHash, handoff: bindings.handoff!.profileHash, goalReview: bindings.goalReview!.profileHash },
    contextPolicy: { handoffAtContextTokens: threshold },
    selectionsHash: preview.selectionsHash ?? "0".repeat(64),
    ...(view.integration === undefined ? {} : { integrationHash: view.integration.schemeHash }),
    ...(c.args.flags.hold === true ? { hold: true } : {}),
  };
}
