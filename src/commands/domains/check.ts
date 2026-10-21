/**
 * Checks spec 2026-10-22 §7 (deferred to CLI v2 there; plan Tasks 3, 4, 6, 9): the `orca check` domain. Settings write
 * the project layer, or the global one with --global (each its own revision); `lock` is global only. Who may send each
 * is decided by the panel (humanOnly.ts SOCKET_TIER): a custom command, a budget, adding or enabling a schedule and
 * locks need a person token; the rest is open to the socket agent; a run Orca dispatched is refused all of them.
 */
import type { CommandDef, PositionalDef, RevisionScope, WriteContext } from "../types.js";
import { text } from "./format.js";
import { invalid, json, list, str, verb } from "./verbs.js";

const KINDS = ["integration-check", "model-review"] as const;
const KIND: PositionalDef = { name: "kind", summary: "integration-check|model-review", required: true };
const GLOBAL = { name: "global", type: "boolean" as const, summary: "the global layer (every project without its own value) instead of this project's" };
const kindOf = (c: WriteContext): (typeof KINDS)[number] => {
  const kind = c.args.positionals.kind;
  if (typeof kind !== "string" || !(KINDS as readonly string[]).includes(kind)) throw invalid("kind wants integration-check|model-review");
  return kind as (typeof KINDS)[number];
};
const isGlobal = (c: WriteContext): boolean => c.args.flags.global === true;
const layerScope = (c: WriteContext): RevisionScope => (isGlobal(c) ? "orchestration" : "repository");
const layerRoute = (leaf: string) => async (c: WriteContext): Promise<string> =>
  (isGlobal(c) ? `operator/checks/${leaf}` : `repositories/${(await c.project()).repoId}/checks/${leaf}`);
const projectRoute = (leaf: string) => async (c: WriteContext): Promise<string> => `repositories/${(await c.project()).repoId}/checks/${leaf}`;
const int = (c: WriteContext, flag: string): number | undefined => (typeof c.args.flags[flag] === "number" ? c.args.flags[flag] as number : undefined);

function settingsSet(c: WriteContext): Record<string, unknown> {
  const kind = kindOf(c);
  const set: Record<string, unknown> = {};
  if (c.args.flags.on === true && c.args.flags.off === true) throw invalid("give at most one of --on and --off");
  if (c.args.flags.on === true) set.enabled = true;
  if (c.args.flags.off === true) set.enabled = false;
  const trigger = json(c, "trigger");
  if (trigger !== undefined) set.trigger = trigger;
  if (kind === "integration-check") {
    if (str(c, "command") !== undefined && c.args.flags["no-command"] === true) throw invalid("give at most one of --command and --no-command");
    if (str(c, "command") !== undefined) set.command = str(c, "command");
    if (c.args.flags["no-command"] === true) set.command = null;
    if (int(c, "budget-tokens") !== undefined || int(c, "max-groups") !== undefined) throw invalid("--budget-tokens and --max-groups are model-review fields");
  } else {
    if (str(c, "command") !== undefined || c.args.flags["no-command"] === true) throw invalid("--command and --no-command are integration-check fields");
    if (int(c, "budget-tokens") !== undefined) set.budgetTokens = int(c, "budget-tokens");
    if (int(c, "max-groups") !== undefined) set.maxGroupsPerReview = int(c, "max-groups");
  }
  if (Object.keys(set).length === 0) throw invalid("nothing to set: give --on, --off, --trigger, or a field of the kind");
  return set;
}

export const CHECK_ROWS: CommandDef[] = [
  {
    domain: "check", action: "show", summary: "the effective check settings, where each value comes from, locks, scheduled checks and each check's state",
    positionals: [], flags: [GLOBAL], access: "open",
    mapsTo: { kind: "read", paths: async (c) => [isGlobal(c) ? "checks" : `checks?repoId=${encodeURIComponent((await c.project()).repoId)}`] },
    examples: ["orca check show", "orca check show --global"], format: (body) => text(body),
  },
  {
    domain: "check", action: "findings", summary: "a model review's record: range, groups, valid findings, dropped findings with reasons",
    positionals: [{ name: "review", summary: "the review group id (check show names the last one)", required: true }], flags: [], access: "open",
    mapsTo: { kind: "read", paths: (c) => [`checks/reviews/${encodeURIComponent(String(c.args.positionals.review))}`] },
    examples: ["orca check findings sysreview-…"], format: (body) => text(body),
  },
  verb({ domain: "check", action: "set", summary: "set a check kind's fields in this project (or --global); --command and --budget-tokens need a person token",
    verb: "set-check-settings", scope: layerScope, positionals: [KIND],
    flags: [
      GLOBAL, { name: "on", type: "boolean", summary: "switch the kind's event trigger on" }, { name: "off", type: "boolean", summary: "switch the kind's event trigger off (its scheduled checks still run)" },
      { name: "trigger", type: "string", summary: "the whole trigger as JSON {all:[{any:[{kind:…},…]},…]}" },
      { name: "command", type: "string", humanOnly: true, summary: "integration-check: a command to run instead of the groups' own checks" },
      { name: "no-command", type: "boolean", summary: "integration-check: run the groups' own checks" },
      { name: "budget-tokens", type: "integer", humanOnly: true, summary: "model-review: the review's token budget" },
      { name: "max-groups", type: "integer", summary: "model-review: at most this many groups per review" },
    ],
    examples: ["orca check set model-review --off", "orca check set integration-check --on --no-command", "orca check set model-review --budget-tokens 500000 --global"],
    route: layerRoute("settings"), payload: (c) => ({ kind: kindOf(c), set: settingsSet(c), clear: [] }) }),
  verb({ domain: "check", action: "reset", summary: "remove a kind's fields from this project (or --global) so the next layer applies",
    verb: "set-check-settings", scope: layerScope,
    positionals: [KIND, { name: "field", summary: "enabled|trigger|command (integration-check); enabled|trigger|budgetTokens|maxGroupsPerReview (model-review)", required: true, variadic: true }],
    flags: [GLOBAL], examples: ["orca check reset model-review trigger budgetTokens"],
    route: layerRoute("settings"),
    payload: (c) => {
      const fields = c.args.positionals.field;
      return { kind: kindOf(c), set: {}, clear: [...new Set(Array.isArray(fields) ? fields : [String(fields)])] };
    } }),
  verb({ domain: "check", action: "schedule", summary: "add, replace or remove a scheduled check in this project (or --global); adding or enabling one needs a person token",
    verb: "set-scheduled-check", scope: layerScope, positionals: [{ name: "id", summary: "the scheduled check's id (a-z, 0-9, -)", required: true }],
    flags: [
      GLOBAL, { name: "kind", type: "string", summary: "integration-check|model-review" }, { name: "cron", type: "string", summary: "5 fields, at most hourly, in the usage calendar's time zone" },
      { name: "off", type: "boolean", summary: "keep it, disabled (a project entry with a global id disables it here)" },
      { name: "remove", type: "boolean", summary: "remove it from the layer" },
    ],
    examples: ["orca check schedule weekly --kind model-review --cron '0 9 * * 1'", "orca check schedule weekly --remove"],
    route: layerRoute("scheduled"),
    payload: (c) => {
      const id = String(c.args.positionals.id);
      if (c.args.flags.remove === true) {
        if (str(c, "kind") !== undefined || str(c, "cron") !== undefined || c.args.flags.off === true) throw invalid("--remove takes no other flag");
        return { id, remove: true };
      }
      const kind = str(c, "kind"), cron = str(c, "cron");
      if (kind === undefined || cron === undefined) throw invalid("give --kind and --cron (or --remove)");
      return { id, kind, cron, enabled: c.args.flags.off !== true };
    } }),
  verb({ domain: "check", action: "lock", summary: "set the global lock list (needs a person token); no --lock clears every lock",
    verb: "set-check-locks", scope: "orchestration", access: "token",
    flags: [{ name: "lock", type: "string", repeatable: true, summary: "integrationCheck.command|modelReview.budgetTokens (repeatable)" }],
    examples: ["orca check lock --lock modelReview.budgetTokens --as-person", "orca check lock --as-person"],
    route: () => "operator/checks/locks", payload: (c) => ({ locks: [...new Set(list(c, "lock"))].sort() }) }),
  verb({ domain: "check", action: "run", summary: "run a check kind now in this project (ignores its trigger; still waits for a run in flight and skips an empty range)",
    verb: "run-check-now", scope: "repository", positionals: [KIND], examples: ["orca check run model-review"],
    route: projectRoute("run"), payload: (c) => ({ kind: kindOf(c) }) }),
  verb({ domain: "check", action: "resume", summary: "re-arm a check kind paused after three errored runs in this project",
    verb: "resume-check", scope: "repository", positionals: [KIND], examples: ["orca check resume model-review"],
    route: projectRoute("resume"), payload: (c) => ({ kind: kindOf(c) }) }),
];
