/**
 * Scheduled flows and groups spec 2026-10-24 §13.1: the plan library's rows of the `plan` domain (`plan preview` stays
 * in dev.ts). Reads are open; `save` is open unless it appends to an entry (`--entry`, token); `import` is token: it
 * trusts bytes from outside Orca. `import` and `export --out` touch local files in this process only (planFiles.ts) --
 * the panel is sent a document, never a path.
 */
import { EntryRejection } from "../../entry/envelope.js";
import { resolveId } from "../resolve.js";
import type { CommandDef, PositionalDef, WriteContext } from "../types.js";
import { text } from "./format.js";
import { invalid, str, verb } from "./verbs.js";

const ENTRY: PositionalDef = { name: "entry", summary: "a plan library entry id (pl-…; orca plan list names them)", required: true };
const VERSION = { name: "version", type: "string" as const, summary: "a version's sha256 (orca plan show lists them); default: the newest" };
const entryOf = (c: WriteContext): string => String(c.args.positionals.entry);
const enc = encodeURIComponent;

interface EntryView { entryId: string; projectId: string; head: { sha256: string } | null; versions: Array<{ sha256: string }> }
const readEntry = async (c: WriteContext, entryId = entryOf(c)): Promise<EntryView> => await c.read(`plan-library/${enc(entryId)}`) as EntryView;

/** `--version` as given (it must be one of the entry's), else the entry's newest version. */
async function versionOf(c: WriteContext, entry: EntryView): Promise<string> {
  const named = str(c, "version");
  if (named !== undefined) return resolveId("version", named, entry.versions.map((v) => v.sha256));
  if (entry.head === null) throw new EntryRejection("plan-library-entry-not-found", `${entry.entryId} has no version`);
  return entry.head.sha256;
}

/** The save's source: a group's archived plan, or a requirement's draft with the hash the panel shows for it now. */
async function saveSource(c: WriteContext): Promise<Record<string, unknown>> {
  const group = str(c, "group"), requirement = str(c, "requirement"), draft = c.args.flags.draft;
  if ((group === undefined) === (requirement === undefined)) throw invalid("give exactly one of --group and --requirement");
  const summary = await c.read("summary") as { groups: Array<{ groupId: string }> };
  const ids = summary.groups.map((g) => g.groupId);
  if (group !== undefined) {
    if (draft !== undefined) throw invalid("--draft goes with --requirement");
    return { kind: "group", groupId: resolveId("group", group, ids) };
  }
  if (typeof draft !== "number") throw invalid("--requirement wants --draft <n>");
  const groupId = resolveId("group", requirement!, ids);
  const view = await c.read(`groups/${enc(groupId)}/requirement`) as { drafts: Array<{ draftNo: number; draftHash: string | null }> };
  const found = view.drafts.find((d) => d.draftNo === draft);
  if (found === undefined || found.draftHash === null) throw new EntryRejection("id-not-found", `${groupId} has no draft ${draft} with a plan`);
  return { kind: "requirement-draft", groupId, draftNo: draft, draftHash: found.draftHash };
}

export const PLAN_ROWS: CommandDef[] = [
  {
    domain: "plan", action: "list", summary: "this project's plan library: entries, their newest version and the schedules that use them",
    positionals: [], flags: [{ name: "archived", type: "boolean", summary: "include archived entries" }], access: "open",
    mapsTo: { kind: "read", paths: async (c) => [`plan-library?repoId=${enc((await c.project()).repoId)}${c.args.flags.archived === true ? "&archived=1" : ""}`] },
    examples: ["orca plan list", "orca plan list --archived"], format: (body) => text(body),
  },
  {
    domain: "plan", action: "show", summary: "a library entry with every version's provenance (by, via, origin, time); --version adds that version's document",
    positionals: [ENTRY], flags: [VERSION], access: "open",
    mapsTo: {
      kind: "read",
      paths: async (c) => {
        if (str(c, "version") === undefined) return [`plan-library/${enc(entryOf(c))}`];
        return [`plan-library/${enc(entryOf(c))}`, `plan-library/${enc(entryOf(c))}/versions/${await versionOf(c, await readEntry(c))}`];
      },
      compose: (bodies) => ({ ...(bodies[0] as object), document: bodies[1] }),
    },
    examples: ["orca plan show pl-0123456789abcdef", "orca plan show pl-0123456789abcdef --version 3f2a…"], format: (body) => text(body),
  },
  verb({ domain: "plan", action: "save", summary: "save a group's plan, or a requirement's split draft, to the plan library (--entry appends a version: person token)",
    verb: "plan-library-save", scope: "plan-library",
    flags: [
      { name: "group", type: "string", summary: "the group whose plan is saved" },
      { name: "requirement", type: "string", summary: "the requirement group whose split draft is saved (with --draft)" },
      { name: "draft", type: "integer", summary: "the draft number (orca requirement show)" },
      { name: "name", type: "string", summary: "the entry's name; default: the group id" },
      { name: "entry", type: "string", humanOnly: true, summary: "append a version to this entry instead of making a new one" },
    ],
    examples: ["orca plan save --group g-1a2b", "orca plan save --requirement g-req --draft 2 --name 'export split'", "orca plan save --group g-1a2b --entry pl-0123456789abcdef --as-person"],
    route: () => "plan-library/save",
    payload: async (c) => {
      const source = await saveSource(c);
      const entry = str(c, "entry");
      return { source, name: str(c, "name") ?? String(source.groupId), ...(entry === undefined ? {} : { entryId: entry }) };
    } }),
  verb({ domain: "plan", action: "import", summary: "import a plan file (orca-plan-v1, or a scheduler plan file whose contracts are inlined) into this project's library; needs a person token",
    verb: "plan-library-import", scope: "plan-library", access: "token",
    positionals: [{ name: "path", summary: "the plan file; read here, never sent as a path", required: true }],
    flags: [
      { name: "name", type: "string", summary: "the entry's name; default: the file's name" },
      { name: "entry", type: "string", summary: "append a version to this entry instead of making a new one" },
    ],
    examples: ["orca plan import plans/weekly.json --as-person", "orca plan import exported.orca-plan.json --entry pl-0123456789abcdef --as-person"],
    route: () => "plan-library/import",
    payload: async (c) => {
      const project = await c.project();
      const { readPlanForImport } = await import("../planFiles.js");
      const { doc, provenance } = readPlanForImport(c.io.cwd, String(c.args.positionals.path), project);
      const entry = str(c, "entry");
      return { projectId: project.repoId, name: str(c, "name") ?? provenance.fileName, ...(entry === undefined ? {} : { entryId: entry }), doc, provenance };
    } }),
  {
    domain: "plan", action: "export", summary: "write a library version's orca-plan-v1 bytes to a new file (mode 0600; an existing path is refused)",
    positionals: [ENTRY], flags: [VERSION, { name: "out", type: "string", required: true, summary: "the new file to write" }], access: "open",
    mapsTo: {
      kind: "read",
      paths: async (c) => [`plan-library/${enc(entryOf(c))}/versions/${await versionOf(c, await readEntry(c))}`],
      compose: async (bodies, c) => {
        const { writeExport } = await import("../planFiles.js");
        return { schema: "orca-plan-export-v1", entryId: entryOf(c), ...writeExport(c.io.cwd, String(c.args.flags.out), bodies[0], await versionOf(c, await readEntry(c))) };
      },
    },
    examples: ["orca plan export pl-0123456789abcdef --out weekly.orca-plan.json"], format: (body) => text(body),
  },
  verb({ domain: "plan", action: "archive", summary: "hide a library entry from lists (refused while a schedule uses it)",
    verb: "plan-library-archive", scope: "plan-library", positionals: [ENTRY],
    examples: ["orca plan archive pl-0123456789abcdef"], route: () => "plan-library/archive", payload: (c) => ({ entryId: entryOf(c) }) }),
];
