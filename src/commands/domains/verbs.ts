/** Helpers every write row uses: the row builder, the reads pins come from, and argument conversions. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { CommandVerbV1 } from "../../control/webProtocol.js";
import { EntryRejection } from "../../entry/envelope.js";
import type { CommandDef, FlagDef, PositionalDef, VerbMapping, WriteContext } from "../types.js";
import { text } from "./format.js";
import { adviceOf, type SuggestionView } from "../../control/budgetSuggestions.js";

export const GROUP: PositionalDef = { name: "group", summary: "a group id or a unique prefix", required: true };
export const TASK: PositionalDef = { name: "task", summary: "a task id or a unique prefix", required: true };

type Row = {
  domain: string; action: string; summary: string; verb: CommandVerbV1; scope?: VerbMapping["scope"];
  positionals?: PositionalDef[]; flags?: FlagDef[]; access?: "open" | "token"; examples?: string[];
  route: VerbMapping["route"]; payload: VerbMapping["payload"]; scopeId?: VerbMapping["scopeId"]; requiresIfRevision?: boolean;
  conflictDocument?: VerbMapping["conflictDocument"]; hint?: CommandDef["hint"];
};

export const verb = (row: Row): CommandDef => ({
  domain: row.domain, action: row.action, summary: row.summary, positionals: row.positionals ?? [], flags: row.flags ?? [], access: row.access ?? "open",
  mapsTo: {
    kind: "verb", verb: row.verb, scope: row.scope ?? "group", route: row.route, payload: row.payload,
    ...(row.scopeId === undefined ? {} : { scopeId: row.scopeId }), ...(row.requiresIfRevision ? { requiresIfRevision: true } : {}),
    ...(row.conflictDocument === undefined ? {} : { conflictDocument: row.conflictDocument }),
  },
  examples: row.examples ?? [], format: (body) => text(body), ...(row.hint === undefined ? {} : { hint: row.hint }),
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
  profiles: Array<{ profileId: string; profileHash: string }>;
  defaults: { estimatorProfileId: string; estimatorProfileHash: string; estimateMode: "strict" | "soft" } | null;
}

/** What the unestimated-default lines read: a group view, or `orca proposal show`'s document (no estimates in it). */
export interface UnestimatedSource {
  allocations?: GroupView["allocations"];
  plan?: { planHash: string };
  proposal?: { state?: string; proposalVersion?: number };
  summary?: { state?: string; archived?: boolean };
  estimates?: SuggestionView["estimates"];
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
const withLines = (base: string, lines: string[]): string => (lines.length === 0 ? base : `${base}\n${lines.join("\n")}`);
/** Issue #212: the authored work allocation is a request; a claim funds what the group limit leaves after handoffs. */
export function fundingLines(preview: unknown): string[] {
  const rows = (preview as { rows?: Array<{ taskId: string; authoredTokens: number | null; fundableTokens: number | null; reason: string | null }> } | null)?.rows ?? [];
  if (rows.length === 0) return [];
  const tokens = (n: number | null): string => n === null ? "unlimited" : String(n);
  return ["funding at the current group limit (the authored allocations are requests, not grants):",
    ...rows.map((row) => `  task ${row.taskId}: authored ${tokens(row.authoredTokens)}; a claim now funds ${row.fundableTokens === null ? `nothing (${row.reason ?? "unavailable"})` : tokens(row.fundableTokens)}`)];
}
/** Human text of a group view or a proposal document, with the unestimated-default lines (D3). */
export function formatWithUnestimated(body: unknown): string {
  const b = body as (UnestimatedSource & { summary?: { groupId?: string }; groupId?: string }) | null;
  const groupId = b?.summary?.groupId ?? b?.groupId;
  const live = new Set(["starting", "unknown", "attempt-unknown", "running", "collected", "landed", "reconciling"]);
  const runs = b === null ? [] : (b as { runs?: Array<{ taskId?: unknown; state?: unknown }> }).runs ?? [];
  const count = runs.filter((run) => typeof run.taskId === "string" && typeof run.state === "string" && live.has(run.state)).length;
  return withLines(text(body), [...(count > 0 ? [`execution: ${count} task run${count === 1 ? "" : "s"} in progress`] : []),
    ...(typeof groupId === "string" && b !== null ? unestimatedLines(groupId, b) : [])]);
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
