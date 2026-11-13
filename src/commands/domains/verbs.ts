/** Helpers every write row uses: the row builder, the reads pins come from, and argument conversions. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { CommandVerbV1 } from "../../control/webProtocol.js";
import { EntryRejection } from "../../entry/envelope.js";
import type { CommandDef, FlagDef, PositionalDef, VerbMapping, WriteContext } from "../types.js";
import { text } from "./format.js";
import { phaseEndBudgetLines, phaseEndOfRuns, type UsageRun } from "./usageLines.js";
import { groupUsageDetailLines, type UsageDetailLine } from "./usageDetailLines.js";
import { adviceOf, usedRatio, type SuggestionView } from "../../control/budgetSuggestions.js";
import { NEWEST_ESTIMATE_INSTRUCTION, olderEstimateInstruction } from "../../control/estimateInstructionAge.js";

export const GROUP: PositionalDef = { name: "group", summary: "a group id or a unique prefix", required: true };
export const TASK: PositionalDef = { name: "task", summary: "a task id or a unique prefix", required: true };

type Row = {
  domain: string; action: string; summary: string; verb: CommandVerbV1; scope?: VerbMapping["scope"];
  positionals?: PositionalDef[]; flags?: FlagDef[]; access?: "open" | "token"; examples?: string[];
  route: VerbMapping["route"]; payload: VerbMapping["payload"]; scopeId?: VerbMapping["scopeId"]; requiresIfRevision?: boolean;
  conflictDocument?: VerbMapping["conflictDocument"]; hint?: CommandDef["hint"]; next?: CommandDef["next"];
};

export const verb = (row: Row): CommandDef => ({
  domain: row.domain, action: row.action, summary: row.summary, positionals: row.positionals ?? [], flags: row.flags ?? [], access: row.access ?? "open",
  mapsTo: {
    kind: "verb", verb: row.verb, scope: row.scope ?? "group", route: row.route, payload: row.payload,
    ...(row.scopeId === undefined ? {} : { scopeId: row.scopeId }), ...(row.requiresIfRevision ? { requiresIfRevision: true } : {}),
    ...(row.conflictDocument === undefined ? {} : { conflictDocument: row.conflictDocument }),
  },
  examples: row.examples ?? [], format: (body) => text(body), ...(row.hint === undefined ? {} : { hint: row.hint }),
  ...(row.next === undefined ? {} : { next: row.next }),
});

export const invalid = (message: string): EntryRejection => new EntryRejection("control-cli-argument-invalid", message);
export const group = (c: WriteContext): string => c.ids.group!;
export const task = (c: WriteContext): string => c.ids.task!;
export const str = (c: WriteContext, flag: string): string | undefined => (typeof c.args.flags[flag] === "string" ? c.args.flags[flag] as string : undefined);
export const list = (c: WriteContext, flag: string): string[] => (Array.isArray(c.args.flags[flag]) ? c.args.flags[flag] as string[] : []);
export const newGroupId = (c: WriteContext): string => str(c, "group") ?? `g-${randomUUID().slice(0, 8)}`;

export function json(c: WriteContext, flag: string): unknown {
  const value = str(c, flag);
  if (value === undefined) return undefined;
  try { return JSON.parse(value) as unknown; } catch { throw invalid(`--${flag} wants JSON`); }
}

/** A clarify round as the requirement and flow views carry it: its state and the ids its result asks the person about. */
export interface ClarifyRoundView {
  roundNo: number; state?: string;
  result?: { questions: Array<{ id: string }>; glossary: Array<{ id: string }>; adrs: Array<{ id: string }> } | null;
}
type ClarifyAnswer = { id: string; kind: "recommended" } | { id: string; kind: "text"; text: string };
type ClarifyDecision = { id: string; accept: boolean };
/**
 * Tester follow-up B T3 (#231): a round's answer as the Web's RoundForm.send makes it -- a question not named takes its
 * recommendation, a glossary entry or ADR not named is accepted -- with what the person named winning. An id the round
 * does not hold is sent as named, so the panel's refusal names it. A round not awaiting answers is sent as named.
 */
export function fillRoundAnswer(round: ClarifyRoundView | undefined, named: { answers: ClarifyAnswer[]; glossaryDecisions: ClarifyDecision[]; adrDecisions: ClarifyDecision[] }) {
  const result = round?.state === "awaiting-answers" ? round.result ?? null : null;
  if (result === null) return named;
  const fill = <T extends { id: string }>(ids: ReadonlyArray<{ id: string }>, given: T[], fallback: (id: string) => T): T[] =>
    [...ids.map(({ id }) => given.find((g) => g.id === id) ?? fallback(id)), ...given.filter((g) => !ids.some((i) => i.id === g.id))];
  return {
    answers: fill<ClarifyAnswer>(result.questions, named.answers, (id) => ({ id, kind: "recommended" })),
    glossaryDecisions: fill(result.glossary, named.glossaryDecisions, (id) => ({ id, accept: true })),
    adrDecisions: fill(result.adrs, named.adrDecisions, (id) => ({ id, accept: true })),
  };
}

/** `--file <path>`: a JSON document, read relative to cwd. */
export function file(c: WriteContext, flag = "file"): unknown {
  const path = str(c, flag);
  if (path === undefined) return undefined;
  let textValue: string;
  try { textValue = readFileSync(resolve(c.io.cwd, path), "utf8"); } catch (error) { throw invalid(`--${flag}: cannot read ${path}: ${(error as Error).message}`); }
  try { return JSON.parse(textValue) as unknown; } catch { throw invalid(`--${flag}: ${path} is not JSON`); }
}

export interface GroupView {
  summary: { groupId: string; commandRevision: number; state?: string; archived?: boolean };
  plan: { planHash: string };
  proposal: { state?: string; proposalVersion: number; budgetMode: "strict" | "soft" | null; contextPolicy: { handoffAtContextTokens: number | null }; profiles: null | Record<"estimator" | "worker" | "handoff" | "goalReview", { profileId: string; profileHash: string } | null> };
  ledger: { groupLimit: { tokens: number | null; activeMs: number; attempts: number; sessions: number } };
  allocations: Array<{ ownerKind: string; ownerId: string; bucket: string; amount: Record<string, number | null>; fieldProvenance?: Record<string, { provenance: string; estimateId: string | null }> }>;
  workItems: Array<{ taskId: string; currentRunId: string | null; labelsVersion?: number; loopPlan?: { loopVersion: number } | null }>;
  runs: Array<{ runId: string; taskId: string | null; unknownUsageSettlement?: { generation: number } }>;
  checkpoints: Array<{ checkpointId: string; runId: string; taskId: string; state: string }>;
  integration?: { schemeHash: string };
}
export interface ConfigView {
  plans: Array<{ planId: string; repoId: string }>;
  profiles: Array<{ profileId: string; profileHash: string; estimatorInstructionVersion?: string | null }>;
  defaults: { estimatorProfileId: string; estimatorProfileHash: string; estimateMode: "strict" | "soft" } | null;
}

/**
 * Tester follow-up B T3 (#224): a line naming an estimator profile pinned to an estimate instruction older than the newest
 * this Orca holds (estimateInstructionAge.ts); none when it is the newest, unknown or not reported.
 * Tester follow-up F §4 (#173): the same words reach --json, as the answer's `warnings` (withWarnings, work.ts).
 */
export function instructionLines(view: ConfigView, profileId: string | null | undefined): string[] {
  const version = olderEstimateInstruction(view.profiles.find((p) => p.profileId === profileId)?.estimatorInstructionVersion);
  if (version === null) return [];
  return [`warning: estimator profile ${profileId} uses estimate instruction ${version}; the newest is ${NEWEST_ESTIMATE_INSTRUCTION}. Its estimates follow the older instruction; update the profile's estimatorPreflight.instructionVersion to use the newest`];
}

/** What the unestimated-default lines read: a group view, or `orca proposal show`'s document (no estimates in it). */
export interface UnestimatedSource {
  allocations?: GroupView["allocations"];
  plan?: { planHash: string };
  proposal?: { state?: string; proposalVersion?: number };
  summary?: { state?: string; archived?: boolean };
  estimates?: SuggestionView["estimates"];
  ledger?: { groupLimit: { tokens: number | null } };
  /** Tester follow-up G §11: present (true) on a group of the expectation model, where task tokens are expectations. */
  expectationModel?: true;
}

/**
 * Session 3cfc2e73 D3 (spec 2026-11-05 §3.3): one line per task whose work tokens are unlimited by default -- no person
 * set them and no estimate was applied -- then the path to an estimate. Empty when there is none. `orca group confirm`,
 * `orca group show` and `orca proposal show` print it under their human output; their JSON is unchanged.
 * Dogfood run 3 F23 (session 86352010): the lines follow the state. A ready estimate for the current plan that was not
 * applied is named, and the path is `apply-estimate`, not a new estimate; an editable proposal is not told to reopen --
 * only a confirmed one (`afterConfirm`: confirm's own lines, read from the view before the confirm it reports) is.
 */
export function unestimatedLines(groupId: string, source: UnestimatedSource, opts: { afterConfirm?: boolean } = {}): string[] {
  const tasks = (source.allocations ?? []).filter((a) => a.ownerKind === "task" && a.bucket === "work" && a.amount.tokens === null
    && a.fieldProvenance?.tokens?.provenance === "complex-1m-default");
  if (tasks.length === 0) return [];
  // adviceOf answers only for an editable proposal; a confirmed one keeps its ready estimate for after a reopen.
  const ready = source.plan === undefined || source.estimates === undefined ? null
    : adviceOf({ plan: source.plan, proposal: { state: "editable", proposalVersion: source.proposal?.proposalVersion ?? 0 }, estimates: source.estimates } as SuggestionView);
  // Budget defaults spec 2026-11-11 §7 item 5: in a group with no token limit an estimate is each task's expectation, not a
  // ceiling, so a ready one is named by what it expects -- never as "not applied" -- and there is nothing to apply.
  // Tester follow-up I (seat K; dogfood g-28d9b560): so is a group of the expectation model with a token limit -- its
  // estimate is applied as each task's expectation, so it was still named "ready but not applied" after apply-estimate.
  const limitTokens = source.ledger?.groupLimit.tokens;
  if (limitTokens === null || source.expectationModel === true) {
    const advisory = typeof limitTokens === "number"
      ? `in this group a task's tokens are an expectation and the group's token limit (${limitTokens}) is the only ceiling, so an estimate is advisory: each task's expected tokens`
      : "in a group with no token limit an estimate is advisory: each task's expected tokens, not a ceiling";
    if (ready !== null) {
      const expected = (taskId: string) => ready.output.tasks.find((t) => t.taskId === taskId)?.work.tokens;
      const lines = tasks.map((a) => `task ${a.ownerId}: tokens: unlimited (${expected(a.ownerId) === undefined ? "default, not estimated" : `default; expected ${expected(a.ownerId)} tokens from estimate ${ready.estimateId}`})`);
      if (source.summary?.state === "done" || source.summary?.archived === true) return lines;
      return [...lines, `${advisory}; to cap a task, set its tokens (orca proposal replace ${groupId} --file <ops.json> --if-revision <n>)`];
    }
    if (source.summary?.state === "done" || source.summary?.archived === true) return tasks.map((a) => `task ${a.ownerId}: tokens: unlimited (default, not estimated)`);
    const reopen = `before the group starts, reopen its proposal with a proposal edit (orca proposal replace ${groupId} --file <ops.json> --if-revision <n>), then `;
    const editable = opts.afterConfirm !== true && source.proposal?.state === "editable";
    return [...tasks.map((a) => `task ${a.ownerId}: tokens: unlimited (default, not estimated)`),
      `to estimate: ${editable ? "" : reopen}orca group estimate ${groupId}, orca group confirm ${groupId} (${advisory})`];
  }
  const state = ready === null ? "default, not estimated" : `default; estimate ${ready.estimateId} is ready but not applied`;
  // A settled or archived group may still carry the default, but can no longer act on pre-start budget advice.
  if (source.summary?.state === "done" || source.summary?.archived === true) {
    return tasks.map((a) => `task ${a.ownerId}: tokens: unlimited (${state})`);
  }
  const editable = opts.afterConfirm !== true && source.proposal?.state === "editable";
  const reopen = `before the group starts, reopen its proposal with a proposal edit (orca proposal replace ${groupId} --file <ops.json> --if-revision <n>), then `;
  const path = ready === null
    ? `to estimate: ${editable ? "" : reopen}orca group estimate ${groupId}, orca group apply-estimate ${groupId}, orca group confirm ${groupId}`
    : `to apply it: ${editable ? "" : reopen}orca group apply-estimate ${groupId} (--dry-run shows what it sets), orca group confirm ${groupId}`;
  return [...tasks.map((a) => `task ${a.ownerId}: tokens: unlimited (${state})`), path];
}
/**
 * Budget defaults spec 2026-11-11 §7 item 4: per task that has an expectation (the view derives one only in a group with no
 * token limit) and has run, what it used against what was expected -- "×3.2" -- or "unknown" when its usage is unknown.
 */
export function expectationLines(source: { workItems?: Array<{ taskId: string; lineageRunIds?: string[]; expected?: { tokens: number; estimateId: string | null; stale: boolean; usedTokens: number | null } }> }): string[] {
  return (source.workItems ?? []).flatMap((item) => {
    const e = item.expected;
    if (e === undefined || (item.lineageRunIds?.length ?? 0) === 0) return [];
    const ratio = usedRatio(e);
    const used = e.usedTokens === null ? "unknown" : `${e.usedTokens} tokens${ratio === null ? "" : ` (×${ratio} its estimate)`}`;
    // Tester follow-up G spec §2.2: a person's amount in an expectation-model group has no estimate.
    return [`task ${item.taskId}: used ${used}; expected ${e.tokens} tokens from ${e.estimateId === null ? "the amount a person set" : `estimate ${e.estimateId}`}${e.stale ? " (stale)" : ""}`];
  });
}

type BudgetState = { hardCapTokens: number | null; usagePause: { usedTokens: number; expectationTokens: number | null; line: number } | null; usageStopped: { principal: string } | null; groupCapStop: { observedTokens: number } | null };
/**
 * Tester follow-up G spec §2.3-§2.5 (plan O6): what waits on a person or an orchestrating agent in an expectation-model
 * group, with the command that answers it; a hard cap is named so the operator knows the task has no pause line.
 */
export function budgetStateLines(groupId: string, source: { workItems?: Array<{ taskId: string; budgetState?: BudgetState }> }): string[] {
  return (source.workItems ?? []).flatMap((item) => {
    const s = item.budgetState;
    if (s === undefined) return [];
    const lines: string[] = [];
    if (s.hardCapTokens !== null) lines.push(`task ${item.taskId}: hard cap ${s.hardCapTokens} tokens (a person's; no pause line)`);
    if (s.usagePause !== null) {
      const e = s.usagePause.expectationTokens;
      const ratio = e === null || e === 0 ? "" : `, ×${Math.round((s.usagePause.usedTokens / e) * 10) / 10} of the expectation`;
      lines.push(`task ${item.taskId}: waiting for a decision: used ${s.usagePause.usedTokens}${ratio} (pause line ${s.usagePause.line})`,
        `  next: orca task decide-usage ${groupId} ${item.taskId} --decision continue [--note '<what to do next>']  or  --decision stop`);
    }
    if (s.groupCapStop !== null) lines.push(`task ${item.taskId}: group cap reached (the group has used its token limit; this run used ${s.groupCapStop.observedTokens})`,
      `  next: orca group set-limit ${groupId} --limit '{"tokens":<higher>,...}'  (the task continues with its work; a codex task stops between turns, so it may pass the cap by one turn)`);
    if (s.usageStopped !== null) lines.push(`task ${item.taskId}: stopped over its expectation by ${s.usageStopped.principal}`);
    return lines;
  });
}
const withLines = (base: string, lines: string[]): string => (lines.length === 0 ? base : `${base}\n${lines.join("\n")}`);
/** Issue #212: the authored work allocation is a request; a claim funds what the group limit leaves after handoffs. */
export function fundingLines(preview: unknown): string[] {
  const rows = (preview as { rows?: Array<{ taskId: string; authoredTokens: number | null; fundableTokens: number | null; reason: string | null }> } | null)?.rows ?? [];
  if (rows.length === 0) return [];
  const tokens = (n: number | null): string => n === null ? "unlimited" : String(n);
  return ["funding at the current group limit (the authored allocations are requests, not grants):",
    // Tester follow-up I (seat K): a funded claim with no token amount (no group token limit) is funded unlimited, not
    // "nothing"; a task waiting for its dependencies is named so, not as a missing budget.
    ...rows.map((row) => `  task ${row.taskId}: authored ${tokens(row.authoredTokens)}; a claim now funds ${row.reason === "dependencies-pending" ? "nothing yet (it waits for its dependencies)"
      : row.reason !== null ? `nothing (${row.reason})` : tokens(row.fundableTokens)}`)];
}
/**
 * Issue #212: agents read --json, not the funding lines. A body gains `funding`, the funding preview's rows (each task's
 * authored tokens and what a claim now funds, or why nothing), after its own fields; absent when the preview has no rows.
 */
export function withFunding(body: unknown, preview: unknown): unknown {
  const rows = (preview as { rows?: unknown[] } | null)?.rows ?? [];
  return rows.length === 0 || typeof body !== "object" || body === null || "error" in body ? body : { ...body, funding: rows };
}
/**
 * Tester follow-up F §1 (#195, human ruling 「要改」): the context hand-off threshold does nothing today -- no installed agent
 * reports context usage, so nothing in production feeds Orca a context observation (contextControl.ts) -- and confirm no
 * longer requires one. `orca group confirm` and `orca proposal show` say so under their human output; their JSON is unchanged.
 */
export function contextHandoffLines(threshold: number | null): string[] {
  return [`context hand-off: not active (no installed agent reports context usage); ${threshold === null
    ? "no threshold is set, and none is needed (--handoff-at-context-tokens is optional)"
    : `the threshold ${threshold} is recorded, but nothing acts on it`}`];
}
/** Human text of a group view or a proposal document, with the unestimated-default lines (D3). */
interface AcceptanceView { tip: string | null; result: string; why?: string; commands: Array<{ command: string; exit: string; ms: number }>; tail?: string; waived?: { by: string; note: string } }

/**
 * Tester follow-up E §5 (#241): the group's acceptance on its final tip. A failed one is the problem
 * `group-acceptance-failed:<command>`, with its output tail and the two commands that answer it; anything else is one line.
 */
export function acceptanceLines(groupId: string, a: AcceptanceView | undefined): string[] {
  if (a === undefined) return [];
  const tip = a.tip === null ? "" : ` on ${a.tip.slice(0, 12)}`;
  const n = a.commands.length;
  const ran = `(${n} command${n === 1 ? "" : "s"}, ${Math.round(a.commands.reduce((sum, c) => sum + c.ms, 0) / 1000)} s)`;
  if (a.result === "passed") return [`acceptance: passed${tip} ${ran}`];
  if (a.result === "not-needed") return [`acceptance: not needed (${a.why ?? "?"})`];
  // #278: a work branch that no longer exists is recorded, not retried; a new landing checks it again.
  if (a.result === "not-run" && a.why === "work-branch-missing") return [`acceptance: not run (work-branch-missing: orca/${groupId} does not exist; checked again after a new landing)`];
  if (a.result === "not-run") return [`acceptance: not run (${a.why ?? "?"})`];
  if (a.result === "waived") return [`acceptance: waived${tip} by ${a.waived?.by ?? "?"}: ${a.waived?.note ?? ""}`];
  const last = a.commands.at(-1);
  return [
    `problem: group-acceptance-failed:${last?.command ?? "?"} (exited ${last?.exit ?? "?"} on orca/${groupId}${a.tip === null ? "" : ` at ${a.tip.slice(0, 12)}`})`,
    ...(a.tail ?? "").split("\n").filter((line) => line !== "").map((line) => `  ${line}`),
    `next: orca group recheck ${groupId}  (a flaky check: run it again on this tip)`,
    `  or: orca group waive-acceptance ${groupId} --note '<why>'  (a person accepts this tip anyway)`,
  ];
}

/** Tester follow-up G spec §3.3: the requirement review as the group summary sends it. */
export interface ReviewView {
  state: string; why?: string; problem?: string; autoFixRounds?: number;
  rounds: Array<{ roundNo: number; tip: string; result: string; criteria: Array<{ id: string; verdict: string; evidence: Array<{ path: string; line: number | null }>; missing: string | null }>; fixTaskId?: string }>;
  accepted?: { by: string; note: string };
}

/**
 * Tester follow-up G spec §3.3, §3.5: one line for a review that passed (or stands), and for one that did not pass its
 * problem code, each criterion of its last round, and the three commands that answer it.
 */
export function reviewLines(groupId: string, review: ReviewView | undefined): string[] {
  if (review === undefined) return [];
  const last = review.rounds.at(-1);
  if (review.state === "passed") return [`review: passed on ${(last?.tip ?? "?").slice(0, 12)} (round ${last?.roundNo ?? "?"})`];
  if (review.state === "accepted") return [`review: accepted as it is by ${review.accepted?.by ?? "?"}: ${review.accepted?.note ?? ""}`];
  if (review.state === "fixing") return [`review: fixing (task ${last?.fixTaskId ?? "?"}, round ${last?.roundNo ?? "?"})`];
  if (review.state !== "not-passed") return [`review: ${review.state}${review.why === undefined ? "" : ` (${review.why})`}`];
  return [
    `problem: ${review.problem ?? `requirement-review-not-passed:${review.why ?? "?"}`}`,
    ...(last?.criteria ?? []).map((c) => `  ${c.id} ${c.verdict}: ${c.missing ?? c.evidence[0]?.path ?? ""}`),
    `next: orca group review-fix ${groupId} --goal '<what to fix>'`,
    `  or: orca group review-rerun ${groupId} --note '<what to look at>'`,
    `  or: orca group review-accept ${groupId} --note '<why accept as is>'`,
  ];
}

interface LandingWatchView { regressions: Array<{ command: string; landedTaskIds: string[]; tip: string; exit: string; tail?: string; problem: string }> }

/**
 * Tester follow-up G §6.2 (#269): a check that turned red on the group branch after a landing, one problem per regression,
 * with the tasks that landed, its output tail and what answers it. No lines without a regression.
 */
export function landingWatchLines(groupId: string, w: LandingWatchView | undefined): string[] {
  return (w?.regressions ?? []).flatMap((r) => [
    `problem: ${r.problem} (after ${r.landedTaskIds.join(", ")} landed; exited ${r.exit} on orca/${groupId} at ${r.tip.slice(0, 12)})`,
    ...(r.tail ?? "").split("\n").filter((line) => line !== "").map((line) => `  ${line}`),
    "next: add a task that fixes it, or wait for the task that owns it; the watch runs again on the next landing",
  ]);
}

interface AllowanceView {
  allowanceId: string; by: string; via: string; at: number;
  request: { type: "path"; paths: Array<{ repoKey: string | null; path: string }> } | { type: "pending-decision"; kind: string | null; scope: string | null } | { type: "flagged-decision"; source: string; kind: string | null; scope: string | null };
  from: { runId?: string; pendingId?: string; decisionId?: string };
  revoked?: { by: string; at: number };
}

/** Tester follow-up G §6.3 (#189): what this group lets through, each with who, how, when and from which request. */
export function allowanceLines(allowances: readonly AllowanceView[] | undefined): string[] {
  if (allowances === undefined || allowances.length === 0) return [];
  const iso = (at: number): string => new Date(at).toISOString();
  const what = (r: AllowanceView["request"]): string => r.type === "path" ? `paths ${r.paths.map((p) => p.repoKey === null ? p.path : `${p.repoKey}:${p.path}`).join(", ")}`
    : r.type === "pending-decision" ? `pending decisions of kind ${r.kind ?? "?"} scope ${r.scope ?? "?"}`
    : `${r.source} flags of kind ${r.kind ?? "?"} scope ${r.scope ?? "?"}`;
  return ["allowed in this group:", ...allowances.map((a) => `  ${a.allowanceId}: ${what(a.request)} by ${a.by} via ${a.via} at ${iso(a.at)} from ${a.from.runId ?? a.from.pendingId ?? a.from.decisionId ?? "?"}${a.revoked === undefined ? "" : ` (revoked by ${a.revoked.by} at ${iso(a.revoked.at)})`}`)];
}

/** A run as the group view lists it, for the empty-result lines. */
export interface EmptyResultRun { runId?: unknown; taskId?: unknown; blockedReason?: unknown }

/**
 * Tester follow-up F §4 (empty-result): a task blocked because its attempt changed nothing (executionDriver.ts
 * EMPTY_RESULT_REASON) showed only the bare code. Say what happened and what the operator can do today. Verified on this
 * round's base: `task retry` refuses the finished run (task-not-retryable:run-state:settled) and `task set-loop` refuses
 * a started task (task-already-started), so no command moves this task in its group; the ways on are a new group. An
 * exit in the same group is out of scope this round (design §7).
 */
// Tester follow-up G spec §1 / §10.1: a provable no change now completes (or is judged); empty-result is left only for an
// attempt that is not a provable no change (its tree differs from its base, or it is a criteria-review verdict).
export function emptyResultLines(runs: readonly EmptyResultRun[]): string[] {
  return runs.filter((run) => run.blockedReason === "empty-result").flatMap((run) => [
    `task ${String(run.taskId ?? "?")}: empty-result: run ${String(run.runId ?? "?")} finished without changing any file, so there was nothing to land and the task stays blocked`,
    "  this attempt is not a provable no change (its tree differs from its base, or it is a criteria-review verdict), so it cannot complete in this group and orca task reopen does not apply",
    "  if a change was needed: say in the task what to change, and run it in a new group",
  ]);
}

/**
 * Worker-lost recovery spec 2026-11-12 §5.6: a run whose ccloop worker died (the machine restarted or the process was
 * killed), and one whose worker ccloop cannot check, in words with what happens next -- `group show` (each task's current
 * run) and `run show` print the same lines.
 */
export function workerLostLines(runs: ReadonlyArray<EmptyResultRun & { failureCause?: { cause?: unknown } | null }>): string[] {
  return runs.flatMap((run) => {
    const id = String(run.runId ?? "?"), task = String(run.taskId ?? "?");
    if (run.failureCause?.cause === "worker-lost") return [`task ${task}: worker lost (the machine restarted or the process was killed): run ${id}`,
      "  Orca starts the task again by itself, without using up its attempts (at most 3 times in a row); orca recovery list names what holds it"];
    if (typeof run.blockedReason === "string" && run.blockedReason.startsWith("worker-undetermined")) return [`task ${task}: ccloop cannot tell whether run ${id}'s worker is alive`,
      `  make sure no worker process of the run is left, then check again: orca recovery retry --run ${id}`];
    return [];
  });
}

/** Tester follow-up G spec §1.2: a task's no-change record as the group view lists it. */
export interface NoChangeItem { taskId?: unknown; currentRunId?: unknown; noChangeCompletion?: { runId?: unknown; ordinal?: unknown; decidedBy?: unknown } }
const NO_CHANGE_BLOCK_PREFIXES = ["no-change-twice", "no-change-judge-failed", "no-change-judge-unfunded", "no-change-not-met"];

/**
 * Tester follow-up G spec §1.2, §1.4, §10.1: each task completed with no change (who decided, a second time said so) and
 * its revoke command; each task stopped as a provable no change and the two commands that answer it.
 */
export function noChangeLines(groupId: string, items: readonly NoChangeItem[], runs: readonly EmptyResultRun[]): string[] {
  const done = items.filter((item) => item.noChangeCompletion !== undefined).flatMap((item) => {
    const record = item.noChangeCompletion!, task = String(item.taskId ?? "?");
    const nth = record.ordinal === 2 ? ", 2nd time" : typeof record.ordinal === "number" && record.ordinal > 2 ? `, ${record.ordinal}th time` : "";
    return [`task ${task}: no change (${String(record.decidedBy ?? "?")}${nth}) in run ${String(record.runId ?? "?")}`,
      `  revoke: orca task reopen ${groupId} ${task} --note '<what to change>'`];
  });
  const stopped = runs.filter((run) => typeof run.blockedReason === "string" && NO_CHANGE_BLOCK_PREFIXES.some((p) => run.blockedReason === p || (run.blockedReason as string).startsWith(`${p}:`))).flatMap((run) => {
    const task = String(run.taskId ?? "?");
    return [`task ${task}: ${String(run.blockedReason)}: run ${String(run.runId ?? "?")} changed nothing and waits for a decision`,
      `next: orca task accept-no-change ${groupId} ${task} --note '<why>'`,
      `  or: orca task reopen ${groupId} ${task} --note '<what to change>'`];
  });
  return [...done, ...stopped];
}

export function formatWithUnestimated(body: unknown): string {
  const b = body as (UnestimatedSource & { summary?: { groupId?: string; acceptance?: AcceptanceView; landingWatch?: LandingWatchView; allowances?: AllowanceView[] }; groupId?: string }) | null;
  const groupId = b?.summary?.groupId ?? b?.groupId;
  const live = new Set(["starting", "unknown", "attempt-unknown", "running", "collected", "landed", "reconciling"]);
  const runs = b === null ? [] : (b as { runs?: Array<{ taskId?: unknown; state?: unknown } & EmptyResultRun> }).runs ?? [];
  const count = runs.filter((run) => typeof run.taskId === "string" && typeof run.state === "string" && live.has(run.state)).length;
  // Empty-result: only a task's current run (an older one was replaced and says nothing about the task now).
  const current = new Set(((b as { workItems?: Array<{ currentRunId?: unknown }> } | null)?.workItems ?? []).map((item) => item.currentRunId));
  return withLines(text(body), [...(count > 0 ? [`execution: ${count} task run${count === 1 ? "" : "s"} in progress`] : []),
    ...emptyResultLines(runs.filter((run) => current.has(run.runId))),
    ...workerLostLines(runs.filter((run) => current.has(run.runId))),
    ...(typeof groupId === "string" ? noChangeLines(groupId, (b as { workItems?: NoChangeItem[] } | null)?.workItems ?? [], runs.filter((run) => current.has(run.runId))) : []),
    ...(typeof groupId === "string" && b !== null ? unestimatedLines(groupId, b) : []),
    ...(b === null ? [] : expectationLines(b as Parameters<typeof expectationLines>[0])),
    // Tester #285: the group's used figure lags while a run whose agent reports at phase end is under way.
    ...((note) => phaseEndBudgetLines(note.runIds, note.asOf))(phaseEndOfRuns(runs as UsageRun[])),
    ...groupUsageDetailLines(runs as Array<{ usageDetail?: UsageDetailLine[] }>),
    ...(typeof groupId === "string" && b !== null ? budgetStateLines(groupId, b as Parameters<typeof budgetStateLines>[1]) : []),
    ...(typeof groupId === "string" ? acceptanceLines(groupId, b?.summary?.acceptance) : []),
    ...(typeof groupId === "string" ? reviewLines(groupId, (b?.summary as { requirementReview?: ReviewView } | undefined)?.requirementReview) : []),
    ...(typeof groupId === "string" ? landingWatchLines(groupId, b?.summary?.landingWatch) : []),
    ...(typeof groupId === "string" ? landingWatchLines(groupId, b?.summary?.landingWatch) : []),
    ...allowanceLines(b?.summary?.allowances)]);
}

/** `orca proposal show`'s body: the proposal part of the group view and the revision it was read at. */
export function proposalDocument(view: GroupView & { ledger: { groupLimit: unknown } }): unknown {
  return { schema: "orca-proposal-view-v1", groupId: view.summary.groupId, revision: view.summary.commandRevision, proposal: view.proposal, allocations: view.allocations, groupLimit: view.ledger.groupLimit };
}

export const groupView = async (c: WriteContext): Promise<GroupView> => await c.read(`groups/${group(c)}`) as GroupView;
export const config = async (c: WriteContext): Promise<ConfigView> => await c.read("config") as ConfigView;

export async function workItem(c: WriteContext): Promise<GroupView["workItems"][number]> {
  const item = (await groupView(c)).workItems.find((w) => w.taskId === task(c));
  if (item === undefined) throw new EntryRejection("id-not-found", `no task ${task(c)} in ${group(c)}`);
  return item;
}

export async function currentRun(c: WriteContext): Promise<string> {
  const item = await workItem(c);
  if (item.currentRunId === null) throw new EntryRejection("task-has-no-run", `task ${task(c)} of ${group(c)} has no current run`);
  return item.currentRunId;
}

/** The newest complete checkpoint of a run: what a continuation resumes from. */
export async function checkpointOf(c: WriteContext, runId: string): Promise<string> {
  const found = (await groupView(c)).checkpoints.filter((cp) => cp.runId === runId && cp.state === "complete").at(-1);
  if (found === undefined) throw new EntryRejection("checkpoint-not-found", `run ${runId} has no complete checkpoint`);
  return found.checkpointId;
}

export async function profileBinding(c: WriteContext, profileId: string): Promise<{ profileId: string; profileHash: string }> {
  const profile = (await config(c)).profiles.find((p) => p.profileId === profileId);
  if (profile === undefined) throw new EntryRejection("id-not-found", `no profile ${profileId} in the panel's config`);
  return { profileId: profile.profileId, profileHash: profile.profileHash };
}
