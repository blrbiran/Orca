/**
 * CLI v2 plan Task 5 (spec §4, §6.3): proposal edits. set-budget and set-agent change one value under the base version
 * read now; replace sends a whole operation list and is refused without --if-revision; edit is a TTY convenience that
 * shows the document in $EDITOR and sends the changed values as replace --if-revision <the revision read>.
 */
import { EntryRejection } from "../../entry/envelope.js";
import type { CommandDef, CommandIo, ParsedArgs } from "../types.js";
import { file, group, GROUP, groupView, invalid, json, proposalDocument, str, verb, type GroupView } from "./verbs.js";

const DIMENSIONS = ["tokens", "activeMs", "attempts", "sessions"];
const baseVersion = async (c: Parameters<typeof groupView>[0]) => (await groupView(c)).proposal.proposalVersion;

export const REPLACE_ROW: CommandDef = verb({
  domain: "proposal", action: "replace", summary: "send a whole operation list {operations, proposedGroupLimit?} from a file; refused without --if-revision",
  verb: "proposal-edit", positionals: [GROUP], requiresIfRevision: true,
  flags: [{ name: "file", type: "string", required: true, summary: "the JSON document" }],
  route: (c) => `groups/${group(c)}/proposal/edit`,
  payload: async (c) => {
    const body = file(c) as { operations?: unknown; proposedGroupLimit?: unknown } | null;
    if (body === null || typeof body !== "object" || !Array.isArray(body.operations)) throw invalid("--file wants {\"operations\": [...]} (orca proposal show prints the current one)");
    return { baseProposalVersion: await baseVersion(c), operations: body.operations, ...(body.proposedGroupLimit === undefined ? {} : { proposedGroupLimit: body.proposedGroupLimit }) };
  },
  conflictDocument: async (c) => proposalDocument(await groupView(c) as GroupView & { ledger: { groupLimit: unknown } }),
  examples: ["orca proposal show g1 --json > p.json   # edit the operations", "orca proposal replace g1 --file ops.json --if-revision 12"],
});

/** The editable document: one operation per allocation dimension, as it stands now. */
export function editableOperations(view: GroupView): Array<{ target: Record<string, string>; value: number | null }> {
  const operations: Array<{ target: Record<string, string>; value: number | null }> = [];
  for (const allocation of view.allocations) {
    for (const dimension of DIMENSIONS) {
      if (!(dimension in allocation.amount)) continue;
      const value = allocation.amount[dimension] ?? null;
      if (allocation.ownerKind === "task") operations.push({ target: { scope: "task", taskId: allocation.ownerId, allocation: allocation.bucket, dimension }, value });
      else if (allocation.ownerKind === "goal-review") operations.push({ target: { scope: "goal-review", dimension }, value });
    }
  }
  return operations;
}

async function runEdit(args: ParsedArgs, io: CommandIo): Promise<number> {
  const { refuse } = await import("../run.js");
  if (!io.stdinIsTTY) {
    return refuse(new EntryRejection("control-cli-argument-invalid", "orca proposal edit needs a terminal; an agent uses orca proposal show, then orca proposal replace --file <ops.json> --if-revision <n>"), args.global.json, io);
  }
  const { mkdtempSync, readFileSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const { contextFor, openSession, resolveIds, runPanelCommand } = await import("../panelCommand.js");
  const session = openSession(args, io);
  const context = contextFor(args, io, session, await resolveIds(args, session));
  const view = await groupView(context);
  const shown = editableOperations(view);
  const dir = mkdtempSync(join(tmpdir(), "orca-proposal-"));
  try {
    const path = join(dir, "proposal.json");
    writeFileSync(path, `${JSON.stringify({ groupId: view.summary.groupId, revision: view.summary.commandRevision, operations: shown }, null, 2)}\n`, { mode: 0o600 });
    const editor = io.env.VISUAL ?? io.env.EDITOR ?? "vi";
    const edited = spawnSync("sh", ["-c", `${editor} "$1"`, "sh", path], { stdio: "inherit", env: io.env });
    if (edited.status !== 0) return refuse(new EntryRejection("editor-failed", `${editor} exited ${edited.status ?? edited.signal}`), args.global.json, io);
    let after: { operations?: Array<{ target: unknown; value: unknown }> };
    try { after = JSON.parse(readFileSync(path, "utf8")) as typeof after; } catch { return refuse(invalid("the edited document is not JSON"), args.global.json, io); }
    const before = new Map(shown.map((op) => [JSON.stringify(op.target), op.value]));
    const changed = (after.operations ?? []).filter((op) => before.get(JSON.stringify(op.target)) !== op.value).map((op) => ({ target: op.target, value: op.value, provenance: "human" }));
    if (changed.length === 0) { io.stdout("nothing changed\n"); return 0; }
    const opsPath = join(dir, "ops.json");
    writeFileSync(opsPath, JSON.stringify({ operations: changed }), { mode: 0o600 });
    return await runPanelCommand(REPLACE_ROW, { positionals: { group: view.summary.groupId }, flags: { file: opsPath }, global: { ...args.global, ifRevision: view.summary.commandRevision } }, io);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const PROPOSAL_ROWS: CommandDef[] = [
  verb({ domain: "proposal", action: "set-budget", summary: "set one budget value: --task <t> --allocation work|handoff, or --goal-review; --dimension; --value <n>|none",
    verb: "proposal-edit", positionals: [GROUP],
    flags: [
      { name: "task", type: "string", summary: "a task's allocation" }, { name: "allocation", type: "string", summary: "work|handoff" },
      { name: "goal-review", type: "boolean", summary: "the goal review's allocation" },
      { name: "dimension", type: "string", required: true, summary: "tokens|activeMs|attempts|sessions" },
      { name: "value", type: "string", required: true, summary: "a non-negative integer, or none (a task's work tokens only: no ceiling)" },
      { name: "proposed-group-limit", type: "string", humanOnly: true, summary: "also propose the group limit (JSON)" },
    ],
    route: (c) => `groups/${group(c)}/proposal/edit`,
    payload: async (c) => {
      const dimension = str(c, "dimension")!;
      if (!DIMENSIONS.includes(dimension)) throw invalid("--dimension wants tokens|activeMs|attempts|sessions");
      const raw = str(c, "value")!;
      if (raw !== "none" && !/^(0|[1-9][0-9]*)$/.test(raw)) throw invalid("--value wants a non-negative integer or none");
      const taskId = str(c, "task");
      if ((taskId === undefined) === (c.args.flags["goal-review"] !== true)) throw invalid("give exactly one of --task <t> and --goal-review");
      let target: Record<string, string>;
      if (taskId !== undefined) {
        const allocation = str(c, "allocation");
        if (allocation !== "work" && allocation !== "handoff") throw invalid("--task wants --allocation work|handoff");
        target = { scope: "task", taskId, allocation, dimension };
      } else target = { scope: "goal-review", dimension };
      const limit = json(c, "proposed-group-limit");
      return {
        baseProposalVersion: await baseVersion(c), operations: [{ target, value: raw === "none" ? null : Number(raw), provenance: "human" }],
        ...(limit === undefined ? {} : { proposedGroupLimit: limit }),
      };
    },
    examples: ["orca proposal set-budget g1 --task t1 --allocation work --dimension tokens --value 800000"] }),
  verb({ domain: "proposal", action: "set-agent", summary: "set one agent selection layer (--slot worker|estimator|reconcile, or --task <t>); --clear removes it",
    verb: "proposal-set-agent", positionals: [GROUP],
    flags: [
      { name: "slot", type: "string", summary: "worker|estimator|reconcile" }, { name: "task", type: "string", summary: "a task's own layer" },
      { name: "agent", type: "string", summary: "an installation id" }, { name: "model", type: "string", summary: "a model" },
      { name: "clear", type: "boolean", summary: "clear the panel's layer" },
    ],
    route: (c) => `groups/${group(c)}/proposal/agent`,
    payload: async (c) => {
      const slot = str(c, "slot"), taskId = str(c, "task");
      if ((slot === undefined) === (taskId === undefined)) throw invalid("give exactly one of --slot and --task");
      const partial = c.args.flags.clear === true ? null : { ...(str(c, "agent") === undefined ? {} : { agent: str(c, "agent") }), ...(str(c, "model") === undefined ? {} : { model: str(c, "model") }) };
      if (partial !== null && Object.keys(partial).length === 0) throw invalid("give --agent and/or --model, or --clear");
      return { baseProposalVersion: await baseVersion(c), scope: slot !== undefined ? { kind: "group", slot } : { kind: "task", taskId }, partial };
    } }),
  REPLACE_ROW,
  {
    domain: "proposal", action: "edit", summary: "TTY only: edit the proposal in $EDITOR; the changed values are sent as replace --if-revision <the revision read>",
    positionals: [GROUP], flags: [], access: "open", mapsTo: { kind: "local", load: async () => runEdit },
    examples: ["orca proposal edit g1"], format: () => "",
  },
];
