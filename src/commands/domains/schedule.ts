/**
 * Scheduled flows and groups spec 2026-10-24 §13.1: the `schedule` domain's rows and the `group schedule` one. A create
 * names its schedule here (`--id`, else `scheduleIdFor(--name)`) because the write's scope is the schedule itself, revision
 * 0 while it does not exist; an edit's start is read now and sent whole, as the verb replaces it whole. `--version` of an
 * `add group` is required here: a group start always pins one explicit version.
 */
import { scheduleIdFor } from "../../control/schedules/model.js";
import type { CommandDef, PositionalDef, WriteContext } from "../types.js";
import { text } from "./format.js";
import { group, GROUP, invalid, list, str, verb } from "./verbs.js";

const SCHEDULE: PositionalDef = { name: "schedule", summary: "a schedule id (orca schedule list)", required: true };
const CRON = { name: "cron", type: "string" as const, summary: "5-field cron (minute hour day month weekday), at most hourly" };
const CRON_REQUIRED = { ...CRON, required: true };
const NAME = { name: "name", type: "string" as const, summary: "the schedule's name; default: the template, entry or group" };
const DISABLED = { name: "disabled", type: "boolean" as const, summary: "create it switched off" };
const ID = { name: "id", type: "string" as const, summary: "the schedule's id; default: sch-<slug of the name>" };
const PARAM = { name: "param", type: "string" as const, repeatable: true, summary: "a template param, k=v (repeatable)" };
const TOKEN_LIMIT = { name: "token-limit", type: "integer" as const, summary: "the fired groups' token limit; default: unlimited" };
const POOL = { name: "pool", type: "integer" as const, summary: "how much flow-run capacity one fire may take" };
const enc = encodeURIComponent;
const scheduleOf = (c: WriteContext): string => String(c.args.positionals.schedule);
const int = (c: WriteContext, flag: string): number | undefined => (typeof c.args.flags[flag] === "number" ? c.args.flags[flag] as number : undefined);
const enabled = (c: WriteContext): boolean => c.args.flags.disabled !== true;

interface VersionView { version: number; sha256: string; by: string; via: string; at: number; origin: string }

/** §13.1, §14 `schedules.versionProvenance`: the pinned version's provenance, then the confirm mode its start gives (§9.3). Stderr only, informational. */
async function announcePin(c: WriteContext, entryId: string, sha256: string): Promise<void> {
  if (c.args.global.quiet) return;
  try {
    const entry = await c.read(`plan-library/${enc(entryId)}`) as { versions?: VersionView[] };
    const pinned = (entry.versions ?? []).find((v) => v.sha256 === sha256);
    if (pinned === undefined) return;
    c.io.stderr(`version ${pinned.sha256} — saved by ${pinned.by} via ${pinned.via} at ${new Date(pinned.at).toISOString()} from ${pinned.origin}\n`);
  } catch { /* best effort: the pin is what matters, not the note about it */ }
}

function announceMode(c: WriteContext, tokenLimit: number | null, integration: { delivery?: unknown } | null): void {
  if (c.args.global.quiet) return;
  const reasons: string[] = [];
  if (tokenLimit !== null) reasons.push(`token limit ${tokenLimit}`);
  if (integration !== null) reasons.push(`delivery ${String(integration.delivery)}`);
  c.io.stderr(reasons.length === 0 ? "confirm mode: runs on its own\n" : `confirm mode: waits for your click (${reasons.join(", ")})\n`);
}

/** One client-computed id per invocation: the payload and the revision lookup must name the same new schedule. */
const generated = new WeakMap<WriteContext, string>();
function newScheduleId(c: WriteContext, fallbackName: string): string {
  let id = generated.get(c);
  if (id === undefined) { id = str(c, "id") ?? scheduleIdFor(str(c, "name") ?? fallbackName); generated.set(c, id); }
  return id;
}

const scalar = (raw: string): string | number | boolean =>
  raw === "true" ? true : raw === "false" ? false : /^-?\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : raw;

function paramsOf(c: WriteContext): Record<string, string | number | boolean> {
  // Own keys only: `--param __proto__=x` stays a key the panel refuses as not a parameter, never a silent drop.
  const params = Object.create(null) as Record<string, string | number | boolean>;
  for (const given of list(c, "param")) {
    const at = given.indexOf("=");
    if (at <= 0) throw invalid(`--param wants k=v, got ${JSON.stringify(given)}`);
    params[given.slice(0, at)] = scalar(given.slice(at + 1));
  }
  return params;
}

/** §13.1: a flow start at the version the build ships (the panel fills it when the template names none). */
const addFlow = verb({
  domain: "schedule", action: "add flow", verb: "schedule-set",
  summary: "a builtin flow template on a cron (at most hourly), at the version the build ships; needs a person token",
  positionals: [{ name: "template", summary: "a builtin template (wechat-article or wechat-article@3)", required: true }],
  flags: [CRON_REQUIRED, PARAM, { name: "clarify", type: "string", summary: "skip: do not ask the template's clarifications" }, { name: "unattended", type: "boolean", summary: "start without a person watching" }, POOL, NAME, DISABLED, ID],
  access: "token",
  examples: ["orca schedule add flow wechat-article --cron '0 9 * * 1' --param idea='a topic' --name weekly"],
  scope: "schedule", scopeId: (c) => newScheduleId(c, String(c.args.positionals.template)),
  route: (c) => `schedules/${enc(newScheduleId(c, String(c.args.positionals.template)))}`,
  payload: async (c) => {
    const template = String(c.args.positionals.template);
    const clarify = str(c, "clarify");
    if (clarify !== undefined && clarify !== "skip") throw invalid("--clarify wants skip");
    const pool = int(c, "pool");
    return {
      projectId: (await c.project()).repoId, name: str(c, "name") ?? template, cron: String(c.args.flags.cron), enabled: enabled(c),
      start: {
        kind: "flow", template, params: paramsOf(c),
        ...(clarify === undefined ? {} : { clarify }), ...(c.args.flags.unattended === true ? { unattended: true } : {}),
        ...(pool === undefined ? {} : { pool }),
      },
    };
  },
});

const addGroup = verb({
  domain: "schedule", action: "add group", verb: "schedule-set",
  summary: "a plan library entry at one explicit version on a cron; --version is required (orca plan show lists an entry's versions); needs a person token",
  positionals: [{ name: "entry", summary: "a plan library entry (pl-…; orca plan list names them)", required: true }],
  flags: [{ name: "version", type: "string", required: true, summary: "the version's sha256 (orca plan show lists them)" }, CRON_REQUIRED, TOKEN_LIMIT, NAME, DISABLED, ID],
  access: "token",
  examples: ["orca schedule add group pl-0123456789abcdef --version 3f2a… --cron '0 9 * * 1' --name weekly"],
  scope: "schedule", scopeId: (c) => newScheduleId(c, String(c.args.positionals.entry)),
  route: (c) => `schedules/${enc(newScheduleId(c, String(c.args.positionals.entry)))}`,
  payload: async (c) => {
    const entryId = String(c.args.positionals.entry);
    const tokenLimit = int(c, "token-limit") ?? null;
    await announcePin(c, entryId, String(c.args.flags.version));
    announceMode(c, tokenLimit, null);
    return {
      projectId: (await c.project()).repoId, name: str(c, "name") ?? entryId, cron: String(c.args.flags.cron), enabled: enabled(c),
      start: { kind: "group", entryId, sha256: String(c.args.flags.version), tokenLimit, integration: null },
    };
  },
});

const edit = verb({
  domain: "schedule", action: "edit", verb: "schedule-set",
  summary: "change a schedule's cron or name, a flow's params and pool, or a group's pinned version and token limit; needs a person token",
  positionals: [SCHEDULE],
  flags: [
    CRON, PARAM, NAME,
    { name: "repin", type: "string", summary: "a group schedule's new version sha256 (orca plan show lists them)" },
    POOL, TOKEN_LIMIT, { name: "unlimited", type: "boolean", summary: "the group's token limit back to unlimited" },
  ],
  access: "token",
  examples: ["orca schedule edit sch-weekly --cron '0 10 * * 1'", "orca schedule edit sch-weekly --repin 3f2a…"],
  scope: "schedule", scopeId: scheduleOf,
  route: (c) => `schedules/${enc(scheduleOf(c))}`,
  payload: async (c) => {
    const scheduleId = scheduleOf(c);
    const cron = str(c, "cron"), name = str(c, "name"), repin = str(c, "repin");
    const params = paramsOf(c), pool = int(c, "pool"), tokenLimit = int(c, "token-limit");
    const unlimited = c.args.flags.unlimited === true;
    if (tokenLimit !== undefined && unlimited) throw invalid("give at most one of --token-limit and --unlimited");
    const set: Record<string, unknown> = {};
    if (cron !== undefined) set.cron = cron;
    if (name !== undefined) set.name = name;
    if (Object.keys(params).length > 0 || repin !== undefined || pool !== undefined || tokenLimit !== undefined || unlimited) {
      const current = await c.read(`schedules/${enc(scheduleId)}`) as { kind: "flow" | "group"; start: Record<string, unknown> };
      if (current.kind === "flow") {
        if (repin !== undefined || tokenLimit !== undefined || unlimited) throw invalid("a flow schedule has no --repin, --token-limit or --unlimited");
        const start: Record<string, unknown> = { ...current.start, params: { ...(current.start.params as Record<string, unknown>), ...params } };
        if (pool !== undefined) start.pool = pool;
        set.start = start;
      } else {
        if (Object.keys(params).length > 0 || pool !== undefined) throw invalid("a group schedule has no --param or --pool");
        const start: Record<string, unknown> = { ...current.start };
        if (repin !== undefined) start.sha256 = repin;
        if (unlimited) start.tokenLimit = null;
        else if (tokenLimit !== undefined) start.tokenLimit = tokenLimit;
        set.start = start;
        if (repin !== undefined) await announcePin(c, String(start.entryId), repin);
        announceMode(c, typeof start.tokenLimit === "number" ? start.tokenLimit : null, (start.integration ?? null) as { delivery?: unknown } | null);
      }
    }
    if (Object.keys(set).length === 0) throw invalid("nothing to set: give --cron, --name, --param, --repin, --pool, --token-limit or --unlimited");
    return { set };
  },
});

const scheduleList: CommandDef = {
  domain: "schedule", action: "list", summary: "this project's schedules: kind, cron, next three slots, last fire and newer-version information",
  positionals: [], flags: [{ name: "all", type: "boolean", summary: "every project's schedules, not just this one" }], access: "open",
  mapsTo: {
    kind: "read",
    paths: async (c) => {
      if (c.args.flags.all !== true) return [`schedules?repoId=${enc((await c.project()).repoId)}`];
      // §13.1 `--all`: one read per project with a control repository, in the order the panel lists them (no project resolution).
      const listed = await c.read("projects") as { projects: Array<{ controlRepoId: string | null }> };
      const repoIds = [...new Set(listed.projects.flatMap((p) => (typeof p.controlRepoId === "string" && p.controlRepoId.length > 0 ? [p.controlRepoId] : [])))];
      return repoIds.map((repoId) => `schedules?repoId=${enc(repoId)}`);
    },
    compose: (bodies, c) => c.args.flags.all === true
      ? { schema: "orca-schedules-v1", all: true, schedules: bodies.flatMap((body) => (body as { schedules: unknown[] }).schedules) }
      : bodies[0],
  },
  examples: ["orca schedule list", "orca schedule list --all"], format: (body) => text(body),
};

const scheduleFires: CommandDef = {
  domain: "schedule", action: "fires", summary: "one schedule's fires, newest first: slot, outcome, reason and what it started",
  positionals: [SCHEDULE],
  flags: [{ name: "limit", type: "integer", summary: "how many fires, newest first (default 50, at most 200)" }], access: "open",
  mapsTo: {
    kind: "read",
    paths: (c) => {
      const limit = c.args.flags.limit;
      if (limit === undefined) return [`schedules/${enc(scheduleOf(c))}/fires`];
      if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw invalid("--limit wants an integer 1..200");
      return [`schedules/${enc(scheduleOf(c))}/fires?limit=${limit}`];
    },
  },
  examples: ["orca schedule fires sch-weekly --limit 10"], format: (body) => text(body),
};

const scheduleShow: CommandDef = {
  domain: "schedule", action: "show", summary: "one schedule's body and revision, its next three slots, last fire and newer-version information",
  positionals: [SCHEDULE], flags: [], access: "open",
  mapsTo: { kind: "read", paths: (c) => [`schedules/${enc(scheduleOf(c))}`] },
  examples: ["orca schedule show sch-weekly"], format: (body) => text(body),
};

export const SCHEDULE_ROWS: CommandDef[] = [
  scheduleList,
  scheduleShow,
  scheduleFires,
  addFlow,
  addGroup,
  edit,
  verb({ domain: "schedule", action: "enable", summary: "turn a schedule's fires on; needs a person token", verb: "schedule-enable",
    positionals: [SCHEDULE], access: "token", examples: ["orca schedule enable sch-weekly"],
    scope: "schedule", scopeId: scheduleOf, route: (c) => `schedules/${enc(scheduleOf(c))}/enable`, payload: () => ({ enabled: true }) }),
  verb({ domain: "schedule", action: "disable", summary: "turn a schedule's fires off (its row and fires stay)", verb: "schedule-enable",
    positionals: [SCHEDULE], examples: ["orca schedule disable sch-weekly"],
    scope: "schedule", scopeId: scheduleOf, route: (c) => `schedules/${enc(scheduleOf(c))}/enable`, payload: () => ({ enabled: false }) }),
  verb({ domain: "schedule", action: "remove", summary: "mark a schedule removed: it never fires again and frees its place in the limit", verb: "schedule-remove",
    positionals: [SCHEDULE], examples: ["orca schedule remove sch-weekly"],
    scope: "schedule", scopeId: scheduleOf, route: (c) => `schedules/${enc(scheduleOf(c))}/remove`, payload: () => ({}) }),
  verb({ domain: "schedule", action: "resume", summary: "resume a schedule paused after repeated failed starts", verb: "schedule-resume",
    positionals: [SCHEDULE], examples: ["orca schedule resume sch-weekly"],
    scope: "schedule", scopeId: scheduleOf, route: (c) => `schedules/${enc(scheduleOf(c))}/resume`, payload: () => ({}) }),
  verb({ domain: "group", action: "schedule", summary: "schedule this group from its archived plan: one library version pins the fires; needs a person token",
    verb: "schedule-from-group", positionals: [GROUP], flags: [CRON_REQUIRED, TOKEN_LIMIT, NAME, DISABLED, ID], access: "token",
    examples: ["orca group schedule g-1a2b --cron '0 9 * * 1' --name weekly"],
    route: (c) => `groups/${enc(group(c))}/schedule`,
    payload: (c) => {
      const tokenLimit = int(c, "token-limit");
      return {
        scheduleId: newScheduleId(c, group(c)), name: str(c, "name") ?? group(c), cron: String(c.args.flags.cron), enabled: enabled(c),
        ...(tokenLimit === undefined ? {} : { tokenLimit }),
      };
    } }),
];
