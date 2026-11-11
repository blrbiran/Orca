/**
 * CLI v2 plan Task 3: the read rows (spec §4). A row with one path prints that GET's body verbatim under --json; a
 * composed row (spec §14 R6 run show, proposal/task/project show) builds its body from the reads it names.
 */
import { EntryRejection } from "../../entry/envelope.js";
import { resolveId } from "../resolve.js";
import type { CommandDef, FlagDef, PositionalDef, ReadMapping, WriteContext } from "../types.js";
import { compact, field, text } from "./format.js";
import { emptyResultLines, formatWithUnestimated, fundingLines, proposalDocument, unestimatedLines, type EmptyResultRun } from "./verbs.js";
import type { FormatFailureWork } from "../../panel/formatFailureWork.js";
import { rejectsOutputSchema } from "../../control/structuredOutputHint.js";

type Row = Omit<CommandDef, "access" | "mapsTo" | "examples" | "format" | "flags" | "positionals"> & {
  positionals?: PositionalDef[]; flags?: FlagDef[]; examples?: string[]; format?: CommandDef["format"];
  paths: ReadMapping["paths"]; compose?: ReadMapping["compose"];
};
const read = (row: Row): CommandDef => ({
  domain: row.domain, action: row.action, summary: row.summary, positionals: row.positionals ?? [], flags: row.flags ?? [], access: "open",
  mapsTo: { kind: "read", paths: row.paths, ...(row.compose === undefined ? {} : { compose: row.compose }) },
  examples: row.examples ?? [], format: row.format ?? ((body) => text(body)),
});
const GROUP: PositionalDef = { name: "group", summary: "a group id or a unique prefix", required: true };
const TASK: PositionalDef = { name: "task", summary: "a task id or a unique prefix", required: true };
const RUN: PositionalDef = { name: "run", summary: "a run id", required: true };
const ids = (context: WriteContext, name: string): string => context.ids[name]!;
/** `orca proposal show`'s unestimated-default lines, read in compose from the group view (Dogfood run 3 F23). */
let proposalNote: string[] = [];

interface GroupView { summary: { groupId: string; repoId?: string; state?: string; commandRevision: number; completion?: { done: number; total: number }; counts?: Record<string, number>; stopState?: string | null; executionPending?: boolean; overGrant?: boolean; archived?: boolean; recoveryBlockerCount?: number; projectionSeq?: number }; proposal: unknown; allocations: unknown[]; ledger: { groupLimit: unknown }; workItems: Array<{ taskId: string }>; runs: Array<{ runId: string; taskId: string | null }> }
interface Summary { groups: Array<{ groupId: string; repoId?: string; state?: string; commandRevision?: number; goal?: string; counts?: { running?: number; blocked?: number; done?: number; idle?: number; waiting?: number }; completion?: { done: number; total: number }; stopState?: string | null; overGrant?: boolean; archived?: boolean }> }

/**
 * Spec §14 R6: the group holding a run -- the one --group names, else the first group whose view lists it.
 * Tester follow-up E §3 (#242): a named group must list the run too; no server route takes a group and a run together,
 * so this is the only membership check, and it runs before the run's activity or evidence is read.
 */
async function groupOfRun(context: WriteContext, runId: string): Promise<string> {
  const summary = await context.read("summary") as Summary;
  const named = context.args.flags.group;
  if (typeof named === "string") {
    const groupId = resolveId("group", named, summary.groups.map((g) => g.groupId));
    const view = await context.read(`groups/${groupId}`) as GroupView;
    if (!view.runs.some((run) => run.runId === runId)) throw new EntryRejection("run-not-found", `run ${runId} is not in group ${groupId}`);
    return groupId;
  }
  for (const { groupId } of summary.groups) {
    let view: GroupView;
    try { view = await context.read(`groups/${groupId}`) as GroupView; } catch { continue; }
    if (view.runs.some((run) => run.runId === runId)) return groupId;
  }
  throw new EntryRejection("run-not-found", `no group lists run ${JSON.stringify(runId)}; pass --group <group>`);
}

/** Spec §14 R7: the retained-result lookup needs its scope; exactly one scope flag (the global --project included). */
async function commandScope(context: WriteContext): Promise<string> {
  const { flags, global } = context.args;
  const chosen = ["group", "operator", "spend", "corrections", "orchestration"].filter((name) => flags[name] !== undefined);
  if (global.project !== undefined) chosen.push("project");
  if (chosen.length !== 1) throw new EntryRejection("control-cli-argument-invalid", "orca command show wants exactly one of --group <group>, --project <project>, --operator, --spend, --corrections, --orchestration");
  switch (chosen[0]) {
    case "group": {
      const summary = await context.read("summary") as Summary;
      return resolveId("group", String(flags.group), summary.groups.map((g) => g.groupId));
    }
    case "project": return `@repository:${(await context.project()).repoId}`;
    case "operator": return `@operator:${String(field(await context.read("operator/agent-preferences"), "operatorId"))}`;
    default: return `@${chosen[0]}`;
  }
}

const groupList = (body: unknown): string => {
  const groups = (body as Summary).groups ?? [];
  return groups.length === 0 ? "no groups" : groups.map((g) => {
    const count = g.counts?.running ?? 0;
    const state = count > 0 && (g.state === "ready" || g.state === "review") ? `${g.state} · running ${count} task${count === 1 ? "" : "s"}` : g.state ?? "";
    // Tester #166: the list used to hide a paused, over-grant or blocked group behind its state word.
    const flags = [
      g.stopState !== null && g.stopState !== undefined ? (g.stopState === "paused" ? "paused" : `stopping (${g.stopState})`) : "",
      g.overGrant === true ? "over grant" : "",
      (g.counts?.blocked ?? 0) > 0 ? `blocked ${g.counts!.blocked}` : "",
      g.archived === true ? "archived" : "",
    ].filter((flag) => flag !== "").join(", ");
    const completion = g.completion === undefined ? "" : `  done ${g.completion.done}/${g.completion.total}`;
    return `${g.groupId}  ${g.repoId ?? ""}  ${state}${flags === "" ? "" : ` · ${flags}`}${completion}  rev ${g.commandRevision ?? "?"}${g.goal ? `  ${g.goal}` : ""}`;
  }).join("\n");
};

interface ProjectRow { projectKey: string; controlRepoId: string | null; path: string; kind?: string; dirs?: Array<{ projectKey: string }> }

/**
 * Issue 146: each row names its kind; a multi lists its members instead of the primary's path it carries for display.
 * Issue 148: a projects file the panel could not apply, and edits waiting for a restart, are said after the rows.
 */
const projectList = (body: unknown): string => {
  const rows = (field(body, "projects") as ProjectRow[] | undefined) ?? [];
  const lines = rows.map((p) => `${p.projectKey}  ${p.kind ?? "repo"}  ${p.controlRepoId ?? "(no control)"}  ${p.kind === "multi" ? `members ${(p.dirs ?? []).map((d) => d.projectKey).join(", ")}` : p.path}`);
  if (lines.length === 0) lines.push("no projects");
  const fileError = field(body, "fileError");
  if (typeof fileError === "string") lines.push(`error: the projects file is not in effect (the list above is the last good one): ${fileError}`);
  const pending = field(body, "pendingRestart");
  if (Array.isArray(pending) && pending.length > 0) lines.push(`restart needed for: ${pending.join(", ")} (orca panel restart)`);
  return lines.join("\n");
};

/** `orca run transcript`: the listing, or one call's window; the window options are the Web route's query (tail|before|after). */
function transcriptPath(context: WriteContext): string {
  const { flags } = context.args;
  const run = encodeURIComponent(ids(context, "run"));
  const call = flags.call, before = flags.before, after = flags.after;
  if (call === undefined) {
    if (before !== undefined || after !== undefined || flags.thinking === true) throw new EntryRejection("control-cli-argument-invalid", "--before, --after and --thinking choose a window of one call: pass --call <attempt>/<phase>/<seq>");
    return `runs/${run}/transcripts`;
  }
  const match = /^([0-9]+)\/([a-z][a-z-]{0,31})\/([0-9]+)$/.exec(String(call));
  if (match === null) throw new EntryRejection("control-cli-argument-invalid", `--call wants <attempt>/<phase>/<seq> as orca run transcript ${ids(context, "run")} lists it, not ${JSON.stringify(call)}`);
  if (before !== undefined && after !== undefined) throw new EntryRejection("control-cli-argument-invalid", "pass at most one of --before and --after");
  const query = [before !== undefined ? `before=${String(before)}` : after !== undefined ? `after=${String(after)}` : "tail=1", ...(flags.thinking === true ? ["include=thinking"] : [])];
  return `runs/${run}/transcripts/${match[1]}/${match[2]}/${match[3]}?${query.join("&")}`;
}

interface TranscriptCallRow { attempt: number; phase: string; seq: number; runtime: string | null; recorded: boolean; bytes: number | null; final: boolean }
interface TranscriptEvent { at: number; kind: string; meta?: Record<string, string>; num?: Record<string, number>; flag?: Record<string, boolean>; fields?: Record<string, { text: string; more: boolean }> }

/** Issue #184: one evidence entry's content, under the identity the panel answered with (text or base64). */
function evidenceContent(body: unknown): string {
  const b = body as { evidenceId?: string; sha256?: string; byteLength?: number; truncated?: boolean; encoding?: string; text?: string; base64?: string };
  if (b.encoding === undefined) return text(body); // the manifest, as before
  const head = `evidence ${b.evidenceId ?? "?"}  sha256 ${b.sha256 ?? "?"}  ${b.byteLength ?? "?"} B${b.truncated === true ? " (truncated)" : ""}`;
  if (b.encoding === "utf8") return `${head}\n${b.text ?? ""}`;
  return `${head}  encoding base64 (binary; pipe through base64 -d to keep the bytes)\n${b.base64 ?? ""}`;
}

function transcriptText(body: unknown): string {
  const b = body as { schema?: string; available?: boolean; reason?: string; calls?: TranscriptCallRow[]; events?: TranscriptEvent[]; start?: number; end?: number; runtime?: string; final?: boolean };
  if (b.schema === "orca-run-transcripts-v1") {
    if (b.available === false) return `transcripts unavailable: ${b.reason ?? "unknown"}`;
    const calls = b.calls ?? [];
    return calls.length === 0 ? "no transcript calls" : calls.map((c) => `${c.attempt}/${c.phase}/${c.seq}  ${c.runtime ?? "?"}  ${c.recorded ? `${c.bytes ?? "?"} B` : "not recorded"}${c.final ? "  final" : "  live"}`).join("\n");
  }
  const events = b.events ?? [];
  const lines = events.map((e) => {
    const meta = e.meta === undefined ? "" : ` ${Object.entries(e.meta).map(([k, v]) => `${k}=${v}`).join(" ")}`;
    const fields = Object.entries(e.fields ?? {}).map(([k, f]) => `  ${k}: ${f.text}${f.more ? " …" : ""}`);
    return [`@${e.at} ${e.kind}${meta}`, ...fields].join("\n");
  });
  return [`${b.runtime ?? "?"} window [${b.start ?? "?"}, ${b.end ?? "?"})${b.final ? " final" : " live"}`, ...(lines.length === 0 ? ["(no events)"] : lines)].join("\n");
}

interface PostMergeCheckView { result: string; why?: string; commands: Array<{ command: string; exit: string; ms: number }>; tail?: string }

/**
 * Tester follow-up E §4 (#245): one line for what the landing's post-merge check did -- passed (how many commands, how
 * long), not needed (why), or failed (the command and its exit) with its output tail on indented lines below.
 */
export function postMergeCheckLines(check: PostMergeCheckView | undefined): string[] {
  if (check === undefined) return [];
  if (check.result === "not-needed") return [`post-merge check: not needed (${check.why ?? "?"})`];
  const n = check.commands.length;
  const ran = `(${n} command${n === 1 ? "" : "s"}, ${Math.round(check.commands.reduce((sum, c) => sum + c.ms, 0) / 1000)} s)`;
  if (check.result === "passed") return [`post-merge check: passed ${ran}`];
  const last = check.commands.at(-1);
  return [`post-merge check: failed: ${last?.command ?? "?"} exited ${last?.exit ?? "?"} ${ran}`, ...(check.tail ?? "").split("\n").filter((line) => line !== "").map((line) => `  ${line}`)];
}

/**
 * Session 3cfc2e73 D7 (#158): an omp execute format failure keeps the attempt's work only under ccloop's attempt refs.
 * Name them, what each changed against the attempt's base, and the read-only git to look at it, so a person can take
 * the work by hand.
 */
function formatFailureLines(work: FormatFailureWork | undefined): string[] {
  if (work === undefined) return [];
  const base = work.attemptBase;
  return [
    `execute format failure (attempt ${work.attempt}): the attempt's work is kept under ${work.refs.length === 1 ? "this ref" : "these refs"} in the project repository${base === null ? "" : `, on base ${base.slice(0, 12)}`}`,
    ...work.issues.map((issue) => `  refused: ${issue.path === "" ? "(top level)" : issue.path}: ${issue.message}`),
    ...work.refs.flatMap((ref) => ref.commit === null
      ? [`  ${ref.ref}: not found in the project repository (not published yet, or removed)`]
      : [`  ${ref.ref} = ${ref.commit.slice(0, 12)}: ${ref.files.length}${ref.filesMore ? "+" : ""} file${ref.files.length === 1 && !ref.filesMore ? "" : "s"} changed`,
        ...ref.stat.map((line) => `    ${line.trim()}`),
        ...(base === null ? [] : [`    see it: git diff ${base.slice(0, 12)} ${ref.ref}`])]),
  ];
}

interface RunResultsBody {
  runId?: string; groupId?: string; taskId?: string | null; availability?: string; source?: { status: string; reason: string | null };
  attempts?: Array<{ attempt: number; current: boolean; execution: string; verification: string; outputs: Array<{ status: string }> }>;
  recoverability?: Recoverability;
}
type Eligibility = { status: string; reason?: string } | { unreadable: string };
/**
 * Tester follow-up F §4 (#183): whether the run's saved result can be recovered, as `run results` adds it to the results
 * body (--json too, only-add): yes with the command that does it, no with the eligibility's reason, or unknown with the
 * code the eligibility read failed with.
 */
interface Recoverability { recoverable: "yes" | "no" | "unknown"; reason: string | null; next: string | null }

/** The refusal code of a read that failed (the panel's answer, or a refusal made here). */
function readFailureCode(error: unknown): string {
  const e = error as { response?: { body?: { error?: { code?: unknown } } }; code?: unknown };
  const code = e?.response?.body?.error?.code ?? e?.code;
  return typeof code === "string" ? code : "unreadable";
}

function recoverabilityOf(eligibility: Eligibility, b: RunResultsBody): Recoverability {
  if ("unreadable" in eligibility) return { recoverable: "unknown", reason: eligibility.unreadable, next: null };
  if (eligibility.status !== "eligible") return { recoverable: "no", reason: eligibility.reason ?? eligibility.status, next: null };
  return { recoverable: "yes", reason: null, next: b.taskId != null && b.groupId !== undefined ? `orca task verify-saved-result ${b.groupId} ${b.taskId}` : null };
}

/**
 * Tester #183 + D17: `run results` printed a truncated dump, so a rejected verification was invisible, and its availability
 * said nothing about recovery. One line per attempt, then whether the saved result can be recovered and the command that does it.
 * Tester follow-up F §4 (#183): the availability is the task result capture's (the task's explanation and outputs), not
 * the saved result's; `results: available` above `recoverable: no` read as a contradiction, so the line names what it is.
 */
function runResultsText(body: unknown): string {
  const b = body as RunResultsBody;
  const source = b.source === undefined || b.source.status === "available" ? "" : ` (source ${b.source.status}${b.source.reason === null ? "" : `: ${b.source.reason}`})`;
  const lines = [`run ${b.runId ?? "?"}  group ${b.groupId ?? "?"}  task ${b.taskId ?? "-"}`, `task explanation and outputs: ${b.availability ?? "?"}${source}`];
  for (const a of b.attempts ?? []) {
    const counts = new Map<string, number>();
    for (const output of a.outputs) counts.set(output.status, (counts.get(output.status) ?? 0) + 1);
    const outputs = a.outputs.length === 0 ? "0" : `${a.outputs.length} (${[...counts].map(([status, n]) => `${n} ${status}`).join(", ")})`;
    lines.push(`attempt ${a.attempt}${a.current ? " (current)" : ""}: execution ${a.execution}, verification ${a.verification}, outputs ${outputs}`);
  }
  const r = b.recoverability;
  if (r === undefined) return lines.join("\n");
  lines.push(r.recoverable === "yes" ? "recoverable: yes" : `recoverable: ${r.recoverable} (${r.reason ?? "?"})`);
  if (r.next !== null) lines.push(`next: ${r.next}`);
  return lines.join("\n");
}

/**
 * Tester D19: an installation's model here is the default a run gets when nothing chose another, not what any run ran on
 * (`orca run show` names that); the line says so.
 */
function agentList(body: unknown): string {
  const b = body as { installations?: Array<{ id: string; kind?: string; version?: string; defaults?: { model?: string } }>; rests?: Array<{ installation: string; until: number; source: string }> };
  const lines = (b.installations ?? []).map((i) => `${i.id}  ${i.kind ?? "?"}  ${i.version ?? "?"}  default model ${i.defaults?.model ?? "?"}`);
  if (lines.length === 0) lines.push("no agent installations");
  for (const rest of b.rests ?? []) lines.push(`${rest.installation} rests until ${new Date(rest.until).toISOString()} (${rest.source})`);
  return lines.join("\n");
}

interface DecisionsBody {
  groupId?: string; pendingCount?: number; flaggedCount?: number;
  tasks?: Array<{ taskId: string; runs: Array<{
    runId: string;
    decisions?: Array<{ id: string; question: string; chose: string; importance: string; flag: { state: string } | null }>;
    pending?: Array<{ pendingId: string; reason: string; question: string | null; chose: string | null; state: string; importance: string }>;
    unlanded?: Array<{ entryIndex: number; question: string | null; chose: string | null; importance: string }>;
  }> }>;
}

/**
 * Tester #189: `decision list` printed a truncated dump, so the pendingId an approve or reject needs could not be read
 * off it. One line per decision; a pending one still waiting gets the exact commands that answer it.
 */
function decisionList(body: unknown): string {
  const b = body as DecisionsBody;
  const group = b.groupId ?? "<group>";
  const said = (question: string | null, chose: string | null) => `${question ?? "?"} -> ${chose ?? "?"}`;
  const lines = [`group ${b.groupId ?? "?"}  pending ${b.pendingCount ?? 0}  flagged ${b.flaggedCount ?? 0}`];
  for (const task of b.tasks ?? []) for (const run of task.runs) {
    for (const d of run.decisions ?? []) lines.push(`landed ${d.id} (${d.importance}): ${said(d.question, d.chose)}${d.flag === null ? "" : ` [${d.flag.state}]`}`);
    for (const p of run.pending ?? []) {
      lines.push(`pending ${p.pendingId} (${run.runId}, ${p.importance}, ${p.reason}): ${said(p.question, p.chose)}${p.state === "pending" ? "" : ` [${p.state}]`}`);
      if (p.state === "pending") {
        lines.push(`  approve: orca decision approve ${group} ${p.pendingId} --undo-how '<an executable undo>'`);
        lines.push(`  reject:  orca decision reject ${group} ${p.pendingId} [--because '<why>']`);
      }
    }
    for (const u of run.unlanded ?? []) lines.push(`unlanded ${run.runId} #${u.entryIndex} (${u.importance}): ${said(u.question, u.chose)} (never landed; no pending id to approve)`);
  }
  if (lines.length === 1) lines.push("no decisions");
  return lines.join("\n");
}

export const READ_ROWS: CommandDef[] = [
  read({ domain: "project", action: "list", summary: "the registered projects: key, kind, control repository id, and root (a multi's member projects)", paths: () => ["projects"],
    format: projectList }),
  read({ domain: "project", action: "show", summary: "the project's workspace mode and integration settings (and their revision)",
    paths: async (context) => { const { repoId } = await context.project(); return [`repositories/${repoId}/workspace`, `repositories/${repoId}/integration`]; },
    compose: async (bodies, context) => {
      const p = await context.project();
      // Issue 146: a dir or multi project says so (a multi with its members); a repository's body keeps its shape.
      return {
        schema: "orca-project-show-v1", repoId: p.repoId, projectKey: p.projectKey, path: p.path,
        ...(p.kind === undefined ? {} : { kind: p.kind }), ...(p.dirs === undefined ? {} : { dirs: p.dirs }),
        workspace: bodies[0], integration: bodies[1],
      };
    } }),
  // Issue 151: every group by default (spec §4); with --project, only that project's groups.
  read({ domain: "group", action: "list", summary: "every group (with --project, that project's): id, repository, state, revision, goal", paths: () => ["summary"],
    compose: async ([summary], context) => {
      if (context.args.global.project === undefined) return summary;
      const { repoId } = await context.project();
      return { ...(summary as Summary), groups: (summary as Summary).groups.filter((g) => g.repoId === repoId) };
    },
    format: groupList }),
  read({ domain: "group", action: "show", summary: "one group's full view", positionals: [GROUP], paths: (c) => [`groups/${ids(c, "group")}`], format: formatWithUnestimated }),
  // Issue #199: the summary route answers the compact body itself, so a poll ships neither the full view's plan and
  // runs nor a clarifying group's refusal (its full view is refused; its summary is not).
  read({ domain: "group", action: "brief", summary: "one group's state, completion, counts and blockers, without the full view", positionals: [GROUP],
    paths: (c) => [`groups/${ids(c, "group")}/brief`] }),
  read({ domain: "requirement", action: "show", summary: "a requirement's rounds, drafts and document", positionals: [GROUP], paths: (c) => [`groups/${ids(c, "group")}/requirement`] }),
  read({ domain: "proposal", action: "show", summary: "the group's budget proposal: version, allocations, group limit, revision", positionals: [GROUP],
    paths: (c) => [`groups/${ids(c, "group")}`, `groups/${ids(c, "group")}/funding-preview`],
    // Dogfood run 3 F23: the document carries no estimates, so its lines are read from the view it is composed from (the
    // confirm row's pattern, one command per CLI process); its JSON is unchanged.
    compose: ([view, funding]) => { const v = view as Parameters<typeof proposalDocument>[0]; proposalNote = [...unestimatedLines(v.summary.groupId, v), ...fundingLines(funding)]; return proposalDocument(v); },
    format: (body) => { const lines = proposalNote; proposalNote = []; return lines.length === 0 ? text(body) : `${text(body)}\n${lines.join("\n")}`; } }),
  read({ domain: "task", action: "show", summary: "one task of a group and its runs", positionals: [GROUP, TASK], paths: (c) => [`groups/${ids(c, "group")}`],
    compose: ([view], c) => {
      const v = view as GroupView;
      return { schema: "orca-task-show-v1", groupId: v.summary.groupId, revision: v.summary.commandRevision, task: v.workItems.find((w) => w.taskId === ids(c, "task")), runs: v.runs.filter((r) => r.taskId === ids(c, "task")) };
    },
    // Tester follow-up F §4 (empty-result): the task's current run, when its attempt changed nothing, in words.
    format: (body) => {
      const b = body as { task?: { currentRunId?: unknown }; runs?: EmptyResultRun[] };
      const lines = emptyResultLines((b.runs ?? []).filter((run) => run.runId === b.task?.currentRunId));
      return lines.length === 0 ? text(body) : `${text(body)}\n${lines.join("\n")}`;
    } }),
  read({ domain: "run", action: "show", summary: "one run: its entry in the group view, the newest 10 activity rows, the evidence summary",
    positionals: [RUN], flags: [{ name: "group", type: "string", summary: "the run's group (default: found from the groups the summary lists)" }],
    paths: async (c) => { const groupId = await groupOfRun(c, ids(c, "run")); return [`groups/${groupId}`, `runs/${ids(c, "run")}/activity`, `runs/${ids(c, "run")}/evidence`]; },
    compose: ([view, activity, evidence], c) => {
      const v = view as GroupView;
      const entries = (field(activity, "entries") as unknown[] | undefined) ?? [];
      const manifest = (field(evidence, "entries") as Array<{ evidenceId: string; kind: string; byteLength: number }> | undefined) ?? [];
      return {
        schema: "orca-run-show-v1", groupId: v.summary.groupId, run: v.runs.find((r) => r.runId === ids(c, "run")),
        activity: { entries: entries.slice(0, 10), more: entries.length > 10 },
        evidence: { count: manifest.length, entries: manifest.map(({ evidenceId, kind, byteLength }) => ({ evidenceId, kind, byteLength })) },
      };
    },
    format: (body) => {
      const b = body as { groupId: string; run: { runId?: string; taskId?: string | null; state?: string; agent?: { installation: string; model: string | null }; stopReason?: string | null; pathPolicyMisses?: Array<{ repoKey: string | null; path: string }>; failureCause?: { cause: string; phase: string | null; retries: number; detail: string | null } | null; diagnosis?: { formatFailureWork?: FormatFailureWork; failureCause?: { detail: string | null } }; postMergeCheck?: PostMergeCheckView } | undefined; activity: { entries: Array<{ kind: string; at: number; body: unknown }> }; evidence: { count: number } };
      // Issue #140: why a run stopped is what a person opens run show for; it gets whole lines, not the 160-char line.
      const cause = b.run?.failureCause ?? null;
      const why = [
        ...(b.run?.state === undefined ? [] : [`state: ${b.run.state}`]),
        // Tester D19: the agent and model this run was frozen with, not the installation's default.
        ...(b.run?.agent === undefined ? [] : [`agent: ${b.run.agent.installation}, model ${b.run.agent.model ?? "(the agent's default)"}`]),
        ...(b.run?.stopReason == null ? [] : [`stopReason: ${b.run.stopReason}`]),
        ...(cause === null ? [] : [`failureCause: ${cause.cause}${cause.phase === null ? "" : ` (phase ${cause.phase})`}${cause.retries > 0 ? `, ${cause.retries} retr${cause.retries === 1 ? "y" : "ies"}` : ""}`]),
        ...(cause?.detail == null ? [] : [`detail: ${cause.detail}`]),
        // #122: a provider's 400 about the response format has one way out, ccloop's opt-in prompt mode.
        ...(rejectsOutputSchema([cause?.detail, b.run?.diagnosis?.failureCause?.detail, b.run?.stopReason])
          ? [`hint: the provider refused the structured-output request (--output-schema). Set "structuredOutput": "prompt" on the codex installation ${b.run?.agent?.installation ?? "the run used"} in the agents table; ccloop never chooses it on its own.`] : []),
        ...(b.run?.pathPolicyMisses?.length ? ["observed path misses:", ...b.run.pathPolicyMisses.map((miss) => `  ${miss.repoKey === null ? "" : `${miss.repoKey}:`}${miss.path}`), ...(b.run.taskId ? [`To allow only these paths: orca task retry ${b.groupId} ${b.run.taskId} --allow-observed-paths`] : [])] : []),
        ...formatFailureLines(b.run?.diagnosis?.formatFailureWork),
        ...emptyResultLines(b.run === undefined ? [] : [b.run as EmptyResultRun]),
        ...postMergeCheckLines(b.run?.postMergeCheck),
      ];
      return [`group ${b.groupId}`, `run ${compact(b.run)}`, ...why, "activity (newest first):", ...b.activity.entries.map((e) => `  ${e.at} ${e.kind} ${compact(e.body, 100)}`), `evidence: ${b.evidence.count} entr${b.evidence.count === 1 ? "y" : "ies"}`].join("\n");
    } }),
  read({ domain: "run", action: "activity", summary: "a run's newest 200 activity rows, newest first", positionals: [RUN], paths: (c) => [`runs/${ids(c, "run")}/activity`] }),
  // Issue #184: an agent that has an evidence id from the manifest can read that entry's content, not only list it.
  read({ domain: "run", action: "evidence", summary: "a run's evidence manifest, or one entry's content when --id names it",
    positionals: [RUN],
    flags: [
      { name: "id", type: "string", summary: "an evidence id the manifest lists: print that entry's content" },
      { name: "max-bytes", type: "integer", summary: "with --id: cap the content sent (default 262144; 0 sends the whole entry)" },
    ],
    examples: ["orca run evidence run-1", "orca run evidence run-1 --id ev-1"],
    paths: (c) => {
      const path = `runs/${ids(c, "run")}/evidence`;
      const id = c.args.flags.id;
      if (typeof id !== "string") return [path];
      const max = c.args.flags["max-bytes"];
      return [`${path}/${id}/content${typeof max === "number" ? `?maxBytes=${max}` : ""}`];
    },
    format: (body) => evidenceContent(body) }),
  // Live transcript spec Correction (session 3cfc2e73, F5): the socket serves the Web's transcript routes; a run Orca
  // dispatched is refused there. Without --call: the run's calls (no paths); with it: one window, the tail by default.
  read({ domain: "run", action: "transcript", summary: "a run's agent transcript: its calls, or one call's window (tail by default), redacted as the Web shows it",
    positionals: [RUN],
    flags: [
      { name: "call", type: "string", summary: "<attempt>/<phase>/<seq> as the call list prints it (default: list the calls)" },
      { name: "before", type: "integer", summary: "the window ending at this byte offset: pass a shown window's start to page back" },
      { name: "after", type: "integer", summary: "the window starting at this byte offset: pass a shown window's end to follow" },
      { name: "thinking", type: "boolean", summary: "include thinking events" },
    ],
    examples: ["orca run transcript run-1", "orca run transcript run-1 --call 1/plan/1", "orca run transcript run-1 --call 1/plan/1 --before 4096"],
    paths: (c) => [transcriptPath(c)], format: transcriptText }),
  read({ domain: "run", action: "results", summary: "a run's saved results: the task's explanation and outputs per attempt, and whether the saved result can be recovered",
    positionals: [RUN], paths: (c) => [`runs/${ids(c, "run")}/results`],
    // Tester follow-up F §4 (#183): --json reads the eligibility too and adds `recoverability` to the body (only-add);
    // --quiet prints nothing, so it reads nothing more.
    compose: async ([results], c) => {
      if (c.args.global.quiet || typeof results !== "object" || results === null) return results;
      let eligibility: Eligibility;
      try { eligibility = await c.read(`runs/${ids(c, "run")}/saved-result-eligibility`) as Eligibility; }
      catch (error) { eligibility = { unreadable: readFailureCode(error) }; }
      return { ...results, recoverability: recoverabilityOf(eligibility, results as RunResultsBody) };
    },
    format: runResultsText }),
  read({ domain: "run", action: "eligibility", summary: "whether a run's saved result can be verified instead of re-run", positionals: [RUN], paths: (c) => [`runs/${ids(c, "run")}/saved-result-eligibility`] }),
  read({ domain: "decision", action: "list", summary: "a group's landed, pending and unlanded decisions", positionals: [GROUP], paths: (c) => [`groups/${ids(c, "group")}/decisions`], format: decisionList }),
  read({ domain: "correction", action: "list", summary: "every recorded correction, its debug groups and closed state", paths: () => ["corrections"] }),
  read({ domain: "agent", action: "list", summary: "the agent installations the panel can run", paths: () => ["agents"], format: agentList }),
  // Session af2ceee1 F7: an agent could not read the preferences it was about to replace with `agent set-preferences`.
  read({ domain: "agent", action: "preferences", summary: "the operator's current agent preferences (defaultAgent, perAgent, estimator, reconcile, review) and their revision", paths: () => ["operator/agent-preferences"] }),
  read({ domain: "agent", action: "models", summary: "an installation's models", positionals: [{ name: "installation", summary: "an installation id", required: true }],
    paths: (c) => [`agents/${ids(c, "installation")}/models`] }),
  read({ domain: "usage", action: "show", summary: "tokens used per model, the caps and the spend revision",
    flags: [
      { name: "scope", type: "string", summary: "all (default) or repo:<repoId>" }, { name: "from", type: "integer", summary: "epoch ms" },
      { name: "to", type: "integer", summary: "epoch ms" }, { name: "group-by", type: "string", summary: "model|repo|day|week|month" },
    ],
    paths: ({ args }) => {
      const query = [`scope=${encodeURIComponent(String(args.flags.scope ?? "all"))}`];
      for (const [flag, key] of [["from", "from"], ["to", "to"], ["group-by", "groupBy"]] as const) if (args.flags[flag] !== undefined) query.push(`${key}=${encodeURIComponent(String(args.flags[flag]))}`);
      return [`usage?${query.join("&")}`];
    } }),
  read({ domain: "orchestration", action: "show", summary: "how many groups run at once, and how many hold a slot now", paths: () => ["orchestration"] }),
  read({ domain: "recovery", action: "list", summary: "what blocks dispatch: global, group and run blockers", paths: () => ["recovery"] }),
  read({ domain: "command", action: "show", summary: "a command's retained result, looked up under its scope",
    positionals: [{ name: "commandId", summary: "the id the CLI printed (cli-<uuid>)", required: true }],
    flags: [
      { name: "group", type: "string", summary: "a group's command" }, { name: "operator", type: "boolean", summary: "an operator setting's command" },
      { name: "spend", type: "boolean", summary: "a spend command" }, { name: "corrections", type: "boolean", summary: "a correction command" },
      { name: "orchestration", type: "boolean", summary: "an orchestration command" },
    ],
    examples: ["orca command show cli-0f1e… --group g1", "orca command show cli-0f1e… --spend"],
    paths: async (c) => [`groups/${await commandScope(c)}/commands/${ids(c, "commandId")}`] }),
];
