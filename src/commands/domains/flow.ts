/**
 * Flow engine spec §11.2, §14.2 (plan Task 12): the `orca flow settings` commands. Settings write this project's layer,
 * or the global one with --global (each its own revision); locks are global only. Both verbs are human-only: a socket
 * agent needs a person token (humanOnly.ts SOCKET_TIER) and a run Orca dispatched is refused them. The other `orca flow`
 * commands arrive with plan Task 15.
 */
import type { CommandDef, RevisionScope, WriteContext } from "../types.js";
import { text } from "./format.js";
import { invalid, list, verb } from "./verbs.js";

const GLOBAL = { name: "global", type: "boolean" as const, summary: "the global layer (every project without its own value) instead of this project's" };
const isGlobal = (c: WriteContext): boolean => c.args.flags.global === true;
const layerScope = (c: WriteContext): RevisionScope => (isGlobal(c) ? "orchestration" : "repository");
const layerRoute = async (c: WriteContext): Promise<string> => (isGlobal(c) ? "operator/flows/settings" : `repositories/${(await c.project()).repoId}/flows/settings`);
const FIELDS = "effects.local|effects.cost|effects.external|effects.irreversible|rerunReview|roles|allowedSkillSources|budgets.tokensPerRun";

/** `<field> <value>` as the nested `set` of the payload; JSON values for roles and allowedSkillSources. */
function setOf(c: WriteContext): Record<string, unknown> {
  const field = String(c.args.positionals.field);
  const raw = c.args.positionals.value;
  if (raw === undefined) throw invalid(`give a value for ${field}`);
  const value = String(raw);
  const [head, tail] = field.split(".");
  if (head === "effects" && tail !== undefined) return { effects: { [tail]: value } };
  if (field === "rerunReview") return { rerunReview: value };
  if (field === "budgets.tokensPerRun") {
    const tokens = Number(value);
    if (!Number.isSafeInteger(tokens) || tokens < 1) throw invalid("budgets.tokensPerRun wants a positive integer");
    return { budgets: { tokensPerRun: tokens } };
  }
  if (field === "roles" || field === "allowedSkillSources") {
    try { return { [field]: JSON.parse(value) as unknown }; } catch { throw invalid(`${field} wants JSON`); }
  }
  throw invalid(`field wants ${FIELDS}`);
}

export const FLOW_ROWS: CommandDef[] = [
  {
    domain: "flow", action: "settings show", summary: "the effective flow settings of this project (or --global): each value, where it comes from, and its lock",
    positionals: [], flags: [GLOBAL], access: "open",
    mapsTo: { kind: "read", paths: async (c) => [isGlobal(c) ? "flows/settings" : `flows/settings?repoId=${encodeURIComponent((await c.project()).repoId)}`] },
    examples: ["orca flow settings show", "orca flow settings show --global"], format: (body) => text(body),
  },
  verb({ domain: "flow", action: "settings set", summary: "set one flow setting in this project (or --global); needs a person token",
    verb: "set-flow-settings", scope: layerScope, access: "token",
    positionals: [{ name: "field", summary: FIELDS, required: true }, { name: "value", summary: "a level (apply-flag|confirm|stage-only|follow-template), auto|review, an integer, or JSON", required: true }],
    flags: [GLOBAL],
    examples: ["orca flow settings set effects.external confirm --as-person", "orca flow settings set budgets.tokensPerRun 1000000 --global --as-person"],
    route: layerRoute, payload: (c) => ({ set: setOf(c), clear: [] }) }),
  verb({ domain: "flow", action: "settings clear", summary: "remove flow settings from this project (or --global) so the next layer applies; needs a person token",
    verb: "set-flow-settings", scope: layerScope, access: "token",
    positionals: [{ name: "field", summary: FIELDS, required: true, variadic: true }], flags: [GLOBAL],
    examples: ["orca flow settings clear effects.cost rerunReview --as-person"],
    route: layerRoute,
    payload: (c) => {
      const fields = c.args.positionals.field;
      return { set: {}, clear: [...new Set(Array.isArray(fields) ? fields : [String(fields)])] };
    } }),
  verb({ domain: "flow", action: "settings lock", summary: "set the global flow lock list (needs a person token); no --lock clears every lock",
    verb: "set-flow-locks", scope: "orchestration", access: "token",
    flags: [{ name: "lock", type: "string", repeatable: true, summary: "effects.<class>|allowedSkillSources|budgets.tokensPerRun (repeatable)" }],
    examples: ["orca flow settings lock --lock effects.irreversible --as-person", "orca flow settings lock --as-person"],
    route: () => "operator/flows/locks", payload: (c) => ({ locks: [...new Set(list(c, "lock"))].sort() }) }),
];
