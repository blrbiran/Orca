/** Helpers every write row uses: the row builder, the reads pins come from, and argument conversions. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { CommandVerbV1 } from "../../control/webProtocol.js";
import { EntryRejection } from "../../entry/envelope.js";
import type { CommandDef, FlagDef, PositionalDef, VerbMapping, WriteContext } from "../types.js";
import { text } from "./format.js";

export const GROUP: PositionalDef = { name: "group", summary: "a group id or a unique prefix", required: true };
export const TASK: PositionalDef = { name: "task", summary: "a task id or a unique prefix", required: true };

type Row = {
  domain: string; action: string; summary: string; verb: CommandVerbV1; scope?: VerbMapping["scope"];
  positionals?: PositionalDef[]; flags?: FlagDef[]; access?: "open" | "token"; examples?: string[];
  route: VerbMapping["route"]; payload: VerbMapping["payload"]; scopeId?: VerbMapping["scopeId"]; requiresIfRevision?: boolean;
  conflictDocument?: VerbMapping["conflictDocument"];
};

export const verb = (row: Row): CommandDef => ({
  domain: row.domain, action: row.action, summary: row.summary, positionals: row.positionals ?? [], flags: row.flags ?? [], access: row.access ?? "open",
  mapsTo: {
    kind: "verb", verb: row.verb, scope: row.scope ?? "group", route: row.route, payload: row.payload,
    ...(row.scopeId === undefined ? {} : { scopeId: row.scopeId }), ...(row.requiresIfRevision ? { requiresIfRevision: true } : {}),
    ...(row.conflictDocument === undefined ? {} : { conflictDocument: row.conflictDocument }),
  },
  examples: row.examples ?? [], format: (body) => text(body),
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
  summary: { groupId: string; commandRevision: number };
  plan: { planHash: string };
  proposal: { proposalVersion: number; budgetMode: "strict" | "soft" | null; contextPolicy: { handoffAtContextTokens: number | null }; profiles: null | Record<"estimator" | "worker" | "handoff" | "goalReview", { profileId: string; profileHash: string } | null> };
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
