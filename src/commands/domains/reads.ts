/**
 * CLI v2 plan Task 3: the read rows (spec §4). A row with one path prints that GET's body verbatim under --json; a
 * composed row (spec §14 R6 run show, proposal/task/project show) builds its body from the reads it names.
 */
import { EntryRejection } from "../../entry/envelope.js";
import { resolveId } from "../resolve.js";
import type { CommandDef, FlagDef, PositionalDef, ReadMapping, WriteContext } from "../types.js";
import { compact, field, text } from "./format.js";

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

interface GroupView { summary: { groupId: string; commandRevision: number }; proposal: unknown; allocations: unknown[]; ledger: { groupLimit: unknown }; workItems: Array<{ taskId: string }>; runs: Array<{ runId: string; taskId: string | null }> }
interface Summary { groups: Array<{ groupId: string; state?: string; commandRevision?: number; goal?: string }> }

/** Spec §14 R6: the group holding a run -- the one --group names, else the first group whose view lists it. */
async function groupOfRun(context: WriteContext, runId: string): Promise<string> {
  const summary = await context.read("summary") as Summary;
  const named = context.args.flags.group;
  if (typeof named === "string") return resolveId("group", named, summary.groups.map((g) => g.groupId));
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
  return groups.length === 0 ? "no groups" : groups.map((g) => `${g.groupId}  ${g.state ?? ""}  rev ${g.commandRevision ?? "?"}${g.goal ? `  ${g.goal}` : ""}`).join("\n");
};

export const READ_ROWS: CommandDef[] = [
  read({ domain: "project", action: "list", summary: "the registered projects, their roots and control repository ids", paths: () => ["projects"],
    format: (body) => ((field(body, "projects") as Array<{ projectKey: string; controlRepoId: string | null; path: string }> | undefined) ?? []).map((p) => `${p.projectKey}  ${p.controlRepoId ?? "(no control)"}  ${p.path}`).join("\n") || "no projects" }),
  read({ domain: "project", action: "show", summary: "the project's workspace mode and integration settings (and their revision)",
    paths: async (context) => { const { repoId } = await context.project(); return [`repositories/${repoId}/workspace`, `repositories/${repoId}/integration`]; },
    compose: async (bodies, context) => { const p = await context.project(); return { schema: "orca-project-show-v1", repoId: p.repoId, projectKey: p.projectKey, path: p.path, workspace: bodies[0], integration: bodies[1] }; } }),
  read({ domain: "group", action: "list", summary: "every group: id, state, revision, goal", paths: () => ["summary"], format: groupList }),
  read({ domain: "group", action: "show", summary: "one group's full view", positionals: [GROUP], paths: (c) => [`groups/${ids(c, "group")}`] }),
  read({ domain: "requirement", action: "show", summary: "a requirement's rounds, drafts and document", positionals: [GROUP], paths: (c) => [`groups/${ids(c, "group")}/requirement`] }),
  read({ domain: "proposal", action: "show", summary: "the group's budget proposal: version, allocations, group limit, revision", positionals: [GROUP],
    paths: (c) => [`groups/${ids(c, "group")}`],
    compose: ([view]) => { const v = view as GroupView; return { schema: "orca-proposal-view-v1", groupId: v.summary.groupId, revision: v.summary.commandRevision, proposal: v.proposal, allocations: v.allocations, groupLimit: v.ledger.groupLimit }; } }),
  read({ domain: "task", action: "show", summary: "one task of a group and its runs", positionals: [GROUP, TASK], paths: (c) => [`groups/${ids(c, "group")}`],
    compose: ([view], c) => {
      const v = view as GroupView;
      return { schema: "orca-task-show-v1", groupId: v.summary.groupId, revision: v.summary.commandRevision, task: v.workItems.find((w) => w.taskId === ids(c, "task")), runs: v.runs.filter((r) => r.taskId === ids(c, "task")) };
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
      const b = body as { groupId: string; run: unknown; activity: { entries: Array<{ kind: string; at: number; body: unknown }> }; evidence: { count: number } };
      return [`group ${b.groupId}`, `run ${compact(b.run)}`, "activity (newest first):", ...b.activity.entries.map((e) => `  ${e.at} ${e.kind} ${compact(e.body, 100)}`), `evidence: ${b.evidence.count} entr${b.evidence.count === 1 ? "y" : "ies"}`].join("\n");
    } }),
  read({ domain: "run", action: "activity", summary: "a run's newest 200 activity rows, newest first", positionals: [RUN], paths: (c) => [`runs/${ids(c, "run")}/activity`] }),
  read({ domain: "run", action: "evidence", summary: "a run's evidence manifest", positionals: [RUN], paths: (c) => [`runs/${ids(c, "run")}/evidence`] }),
  read({ domain: "run", action: "results", summary: "a run's saved results", positionals: [RUN], paths: (c) => [`runs/${ids(c, "run")}/results`] }),
  read({ domain: "run", action: "eligibility", summary: "whether a run's saved result can be verified instead of re-run", positionals: [RUN], paths: (c) => [`runs/${ids(c, "run")}/saved-result-eligibility`] }),
  read({ domain: "decision", action: "list", summary: "a group's landed, pending and unlanded decisions", positionals: [GROUP], paths: (c) => [`groups/${ids(c, "group")}/decisions`] }),
  read({ domain: "correction", action: "list", summary: "every recorded correction, its debug groups and closed state", paths: () => ["corrections"] }),
  read({ domain: "agent", action: "list", summary: "the agent installations the panel can run", paths: () => ["agents"] }),
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
