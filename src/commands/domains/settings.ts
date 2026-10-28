/**
 * CLI v2 plan Task 6 (spec §4 table): project, decision, correction, agent, usage, orchestration and recovery writes. Each
 * sends its scope's revision read now (spec §6.1): repository, operator, spend, orchestration, corrections (0), group.
 */
import { EntryRejection } from "../../entry/envelope.js";
import { resolveId } from "../resolve.js";
import type { CommandDef, PositionalDef, WriteContext } from "../types.js";
import { file, group, GROUP, invalid, list, str, verb } from "./verbs.js";

const ID: PositionalDef = { name: "id", summary: "the pending item's id", required: true };
const CORRECTION: PositionalDef = { name: "correction", summary: "a correction id (c_ + 16 hex)", required: true };
const repo = async (c: WriteContext): Promise<string> => (await c.project()).repoId;
const onOff = (c: WriteContext): boolean => {
  if ((c.args.flags.on === true) === (c.args.flags.off === true)) throw invalid("give exactly one of --on and --off");
  return c.args.flags.on === true;
};
const ON_OFF = [{ name: "on", type: "boolean" as const, summary: "switch it on" }, { name: "off", type: "boolean" as const, summary: "switch it off" }];
const correction = (c: WriteContext): string => c.ids.correction!;

/** Integration spec §3: one scheme, from flags (the same flags as `orca group set-integration`). */
export function schemeFromFlags(c: WriteContext): unknown {
  const delivery = str(c, "delivery");
  if (delivery === "keep") return { delivery };
  const need = (flag: string): string => { const value = str(c, flag); if (value === undefined) throw invalid(`--delivery ${delivery} wants --${flag}`); return value; };
  if (delivery === "local") return { delivery, trigger: need("trigger"), method: need("method"), target: need("target") };
  if (delivery === "push-target") return { delivery, trigger: need("trigger"), method: need("method"), target: need("target"), remote: need("remote") };
  if (delivery === "push-branch" || delivery === "github-pr") return { delivery, trigger: need("trigger"), target: need("target"), remote: need("remote") };
  throw invalid("--delivery wants keep|local|push-target|push-branch|github-pr");
}
export const SCHEME_FLAGS = [
  { name: "delivery", type: "string" as const, required: true, summary: "keep|local|push-target|push-branch|github-pr (anything but keep needs a person token)" },
  { name: "trigger", type: "string" as const, summary: "task|group" }, { name: "method", type: "string" as const, summary: "merge|squash" },
  { name: "target", type: "string" as const, summary: "the target branch" }, { name: "remote", type: "string" as const, summary: "the remote" },
];

interface Summary { groups: Array<{ groupId: string }> }

/** Debug task plan Task 6: a correction's debug groups are `debug-<id>`, `debug-<id>-2`, …; the newest is the one acted on. */
export async function debugGroupOf(c: WriteContext, correctionId: string, reopen: boolean): Promise<string> {
  const base = `debug-${correctionId}`;
  const ordinals = (await c.read("summary") as Summary).groups
    .map((g) => (g.groupId === base ? 1 : g.groupId.startsWith(`${base}-`) ? Number(g.groupId.slice(base.length + 1)) : NaN))
    .filter((n) => Number.isSafeInteger(n));
  const newest = ordinals.length === 0 ? 0 : Math.max(...ordinals);
  const ordinal = reopen || newest === 0 ? newest + 1 : newest;
  return ordinal === 1 ? base : `${base}-${ordinal}`;
}

/** The group a run belongs to: from the recovery read's blockers, else the first group whose view lists it. */
export async function groupOfRunId(c: WriteContext, runId: string): Promise<string> {
  const blockers = ((await c.read("recovery")) as { blockers?: Array<{ groupId: string; runId: string | null }> }).blockers ?? [];
  const blocked = blockers.find((b) => b.runId === runId);
  if (blocked !== undefined) return blocked.groupId;
  for (const { groupId } of (await c.read("summary") as Summary).groups) {
    try {
      const view = await c.read(`groups/${groupId}`) as { runs: Array<{ runId: string }> };
      if (view.runs.some((r) => r.runId === runId)) return groupId;
    } catch { /* a group whose view is refused (clarifying) cannot hold the run */ }
  }
  throw new EntryRejection("run-not-found", `no group lists run ${JSON.stringify(runId)}`);
}

async function recoveryTarget(c: WriteContext): Promise<{ scope: "run"; runId: string } | { scope: "group"; groupId: string }> {
  const run = str(c, "run"), named = str(c, "group");
  if ((run === undefined) === (named === undefined)) throw invalid("give exactly one of --run <run> and --group <group>");
  if (run !== undefined) return { scope: "run", runId: run };
  return { scope: "group", groupId: resolveId("group", named!, (await c.read("summary") as Summary).groups.map((g) => g.groupId)) };
}

export const SETTINGS_ROWS: CommandDef[] = [
  // --- project (repository scope)
  verb({ domain: "project", action: "set-workspace-mode", summary: "worktree or clone for the project's runs", verb: "set-workspace-mode", scope: "repository",
    flags: [{ name: "mode", type: "string", required: true, summary: "worktree|clone" }],
    route: async (c) => `repositories/${await repo(c)}/workspace-mode`, payload: (c) => ({ workspaceMode: str(c, "mode") }) }),
  verb({ domain: "project", action: "set-integration", summary: "where the project's finished work goes by default", verb: "set-integration-scheme", scope: "repository", flags: SCHEME_FLAGS,
    route: async (c) => `repositories/${await repo(c)}/integration`, payload: (c) => ({ integration: schemeFromFlags(c) }) }),
  verb({ domain: "project", action: "set-criteria-review", summary: "whether Orca's reviewer judges a flagged test change before a person sees it", verb: "set-criteria-review", scope: "repository",
    flags: ON_OFF, route: async (c) => `repositories/${await repo(c)}/criteria-review`, payload: (c) => ({ enabled: onOff(c) }) }),
  {
    domain: "project", action: "register-plan", summary: "register (or re-trust) a git-tracked plan file of the project so it can be imported",
    positionals: [{ name: "path", summary: "the plan file, relative to cwd or absolute", required: true }], flags: [], access: "open",
    mapsTo: { kind: "local", load: async () => (await import("../local/registerPlan.js")).runRegisterPlan },
    examples: ["orca project register-plan docs/plans/next.json"], format: () => "",
  },

  // --- decision (group scope)
  verb({ domain: "decision", action: "approve", summary: "approve a decision a landing refused, with an executable undo.how", verb: "approve-pending-decision", positionals: [GROUP, ID],
    flags: [{ name: "undo-how", type: "string", required: true, summary: "the executable undo" }],
    route: (c) => `groups/${group(c)}/decisions/approve`, payload: (c) => ({ pendingId: c.ids.id, undoHow: str(c, "undo-how") }) }),
  verb({ domain: "decision", action: "reject", summary: "reject a decision a landing refused (records a correction)", verb: "reject-pending-decision", positionals: [GROUP, ID],
    flags: [{ name: "because", type: "string", summary: "a line of your own" }],
    route: (c) => `groups/${group(c)}/decisions/reject`, payload: (c) => ({ pendingId: c.ids.id, ...(str(c, "because") === undefined ? {} : { because: str(c, "because") }) }) }),
  verb({ domain: "decision", action: "ratify", summary: "accept a landed decision Orca flagged (dismiss a review finding, with --note saying why)", verb: "ratify-flagged-decision",
    positionals: [GROUP, { name: "id", summary: "the decision id", required: true }],
    flags: [{ name: "note", type: "string", summary: "why (kept beside the ratification; at most 2048 characters)" }],
    route: (c) => `groups/${group(c)}/decisions/ratify`, payload: (c) => ({ decisionId: c.ids.id, ...(str(c, "note") === undefined ? {} : { note: str(c, "note") }) }) }),

  // --- correction (corrections scope: revision 0; debug opens a group)
  // Flow engine spec §13.2–§13.3 (W-COR): --decision names a decision, --run alone a finished run, neither the repository.
  verb({ domain: "correction", action: "record", summary: "record a correction of a decision, a run (--run) or, with neither, the project", verb: "correction-record", scope: "corrections",
    flags: [
      { name: "decision", type: "string", summary: "<run-id>/<n>" }, { name: "run", type: "string", summary: "a finished run's id (instead of --decision)" },
      { name: "kind", type: "string", required: true, summary: "wrong|not_my_taste|stale" },
      { name: "because", type: "string", required: true, summary: "why" }, { name: "chose-instead", type: "string", summary: "what was chosen instead" },
      { name: "again", type: "boolean", summary: "record it although the decision has a correction already" },
    ],
    route: () => "corrections",
    payload: async (c) => ({
      repoId: await repo(c), ...(str(c, "decision") === undefined ? {} : { decisionId: str(c, "decision") }),
      ...(str(c, "run") === undefined ? {} : { runId: str(c, "run") }), kind: str(c, "kind"), because: str(c, "because"),
      ...(str(c, "chose-instead") === undefined ? {} : { chose_instead: str(c, "chose-instead") }), ...(c.args.flags.again === true ? { again: true } : {}),
    }) }),
  verb({ domain: "correction", action: "close", summary: "close a correction by hand with its undo.how", verb: "correction-close", scope: "corrections", positionals: [CORRECTION],
    flags: [
      { name: "undo-how", type: "string", required: true, summary: "the executable undo" }, { name: "chose-instead", type: "string", summary: "what was chosen instead" },
      { name: "undo-cost", type: "string", summary: "the undo's cost" }, { name: "undo-blast-radius", type: "string", summary: "the undo's blast radius" },
    ],
    route: (c) => `corrections/${correction(c)}/close`,
    payload: (c) => ({
      correctionId: correction(c), undoHow: str(c, "undo-how"),
      ...Object.fromEntries((["chose-instead", "undo-cost", "undo-blast-radius"] as const).flatMap((flag) => {
        const value = str(c, flag);
        return value === undefined ? [] : [[flag.replace(/-([a-z])/g, (_m, ch: string) => ch.toUpperCase()), value]];
      })),
    }) }),
  verb({ domain: "correction", action: "withdraw", summary: "withdraw a correction", verb: "correction-withdraw", scope: "corrections", positionals: [CORRECTION],
    route: (c) => `corrections/${correction(c)}/withdraw`, payload: (c) => ({ correctionId: correction(c) }) }),
  verb({ domain: "correction", action: "debug", summary: "open the correction's debug group (spends nothing); --reopen for the next one", verb: "correction-debug-open", positionals: [CORRECTION],
    flags: [
      { name: "reopen", type: "boolean", summary: "open the next debug group once the newest is stopped or archived" },
      { name: "check", type: "string", repeatable: true, summary: "a check the debug task is held to (repeatable)" },
      { name: "undo-how", type: "string", summary: "the owner's undo.how for the closing row" },
    ],
    scopeId: (c) => debugGroupOf(c, correction(c), c.args.flags.reopen === true),
    route: (c) => `corrections/${correction(c)}/debug-group`,
    payload: (c) => ({
      correctionId: correction(c), ...(c.args.flags.reopen === true ? { reopen: true } : {}),
      ...(list(c, "check").length === 0 ? {} : { checks: list(c, "check") }), ...(str(c, "undo-how") === undefined ? {} : { undoHow: str(c, "undo-how") }),
    }) }),

  // --- agent (operator scope)
  verb({ domain: "agent", action: "set-preferences", summary: "set the operator's agent preferences from a JSON file, or only the model review's agent (--review)", verb: "set-agent-preferences", scope: "operator",
    flags: [
      { name: "file", type: "string", summary: "the preferences JSON (orca-agent-preferences-v1 .preferences)" },
      { name: "review", type: "string", summary: "the model review's agent, <installation>[:<model>] (on top of --file, else of the current preferences)" },
    ],
    route: () => "operator/agent-preferences",
    payload: async (c) => {
      const review = str(c, "review");
      if (str(c, "file") === undefined && review === undefined) throw invalid("give --file <preferences.json>, --review <installation>[:<model>], or both");
      const base = str(c, "file") !== undefined ? file(c) : (await c.read("operator/agent-preferences") as { preferences: unknown }).preferences;
      if (review === undefined) return { preferences: base };
      const at = review.indexOf(":");
      const slot = at < 0 ? { agent: review } : { agent: review.slice(0, at), model: review.slice(at + 1) };
      return { preferences: { ...(base as object), review: slot } };
    } }),
  verb({ domain: "agent", action: "apply-update", summary: "apply the detected installation changes named by --accept", verb: "apply-agent-update", scope: "operator", access: "token",
    flags: [{ name: "accept", type: "string", repeatable: true, required: true, summary: "a change id from the update preview (repeatable)" }],
    route: () => "operator/apply-agent-update",
    payload: async (c) => {
      const preview = (await c.read("operator/agent-update-preview") as { preview: { previewId: string; baseTableHash: string } | null }).preview;
      if (preview === null) throw new EntryRejection("agent-update-preview-missing", "no installation update preview; the person runs detection in the Web UI first");
      return { previewId: preview.previewId, baseTableHash: preview.baseTableHash, acceptedChangeIds: [...new Set(list(c, "accept"))].sort() };
    } }),

  // --- usage (spend scope; token tier)
  verb({ domain: "usage", action: "set-cap", summary: "set a spend cap", verb: "set-spend-cap", scope: "spend", access: "token",
    flags: [
      { name: "scope", type: "string", required: true, summary: "all|repo:<repoId>" }, { name: "period", type: "string", required: true, summary: "total|week|month" },
      { name: "tokens", type: "integer", required: true, summary: "the cap" },
    ],
    route: () => "operator/set-spend-cap", payload: (c) => ({ scope: str(c, "scope"), period: str(c, "period"), tokens: c.args.flags.tokens }) }),
  verb({ domain: "usage", action: "clear-cap", summary: "clear a spend cap", verb: "clear-spend-cap", scope: "spend", access: "token",
    flags: [{ name: "scope", type: "string", required: true, summary: "all|repo:<repoId>" }, { name: "period", type: "string", required: true, summary: "total|week|month" }],
    route: () => "operator/clear-spend-cap", payload: (c) => ({ scope: str(c, "scope"), period: str(c, "period") }) }),
  verb({ domain: "usage", action: "set-calendar", summary: "the usage calendar's time zone and first weekday", verb: "set-usage-calendar", scope: "spend", access: "token",
    flags: [{ name: "time-zone", type: "string", required: true, summary: "an IANA zone" }, { name: "week-start", type: "integer", required: true, summary: "1 Monday .. 7 Sunday" }],
    route: () => "operator/set-usage-calendar", payload: (c) => ({ timeZone: str(c, "time-zone"), weekStart: c.args.flags["week-start"] }) }),

  // --- orchestration
  verb({ domain: "orchestration", action: "set", summary: "how many groups run at once; the reviewer default; quota-wait installations", verb: "set-orchestration-settings", scope: "orchestration",
    flags: [
      { name: "max-running-groups", type: "integer", required: true, summary: "1..64" }, { name: "criteria-review", type: "string", summary: "on|off: the reviewer's global default" },
      { name: "quota-wait", type: "string", repeatable: true, summary: "an installation whose quota failures are retried after 30 min (repeatable)" },
    ],
    route: () => "operator/set-orchestration-settings",
    payload: (c) => {
      const review = str(c, "criteria-review");
      if (review !== undefined && review !== "on" && review !== "off") throw invalid("--criteria-review wants on|off");
      return {
        maxRunningGroups: c.args.flags["max-running-groups"], ...(review === undefined ? {} : { criteriaReview: review === "on" }),
        ...(list(c, "quota-wait").length === 0 ? {} : { quotaWait: list(c, "quota-wait") }),
      };
    } }),

  // --- recovery (the group it acts on)
  verb({ domain: "recovery", action: "retry", summary: "resume a run (--run) or a group (--group) blocked for a reason other than a terminal failure", verb: "recovery-retry",
    flags: [{ name: "run", type: "string", summary: "a blocked run" }, { name: "group", type: "string", summary: "a blocked group" },
      // Tester #103 (2026-10-28): the panel's "charge and retry" for a clarify, split or estimate call blocked on unknown usage.
      { name: "acknowledge", type: "string", summary: "charge-remaining-grant: settle a single call's unknown usage by charging its remaining grant, then retry (--run only; needs a person token)" }],
    scopeId: async (c) => { const target = await recoveryTarget(c); return target.scope === "group" ? target.groupId : groupOfRunId(c, target.runId); },
    route: () => "recovery/retry", payload: async (c) => {
      const target = await recoveryTarget(c), acknowledge = str(c, "acknowledge");
      if (acknowledge === undefined) return target;
      if (target.scope !== "run") throw invalid("--acknowledge goes with --run <run>");
      if (acknowledge !== "charge-remaining-grant") throw invalid("--acknowledge wants charge-remaining-grant");
      return { ...target, acknowledge };
    } }),
];
