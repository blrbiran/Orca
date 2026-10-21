/**
 * CLI v2 spec §11: the one table every command is defined in. Parsing, help, the MCP refusal list and the generated
 * references all read it. Rows live in `domains/*`; a row's handler loads on demand (plan Review Focus 1).
 */
import { COMMAND_ROWS } from "./domains/command.js";
import { CONTROL_ROWS } from "./domains/control.js";
import { DEV_ROWS, TOOL_ROWS } from "./domains/dev.js";
import { META_ROWS } from "./domains/meta.js";
import { READ_ROWS } from "./domains/reads.js";
import { PROPOSAL_ROWS } from "./domains/proposal.js";
import { SETTINGS_ROWS } from "./domains/settings.js";
import { WORK_ROWS } from "./domains/work.js";
import type { CommandDef, FindResult } from "./types.js";

export const REGISTRY: readonly CommandDef[] = [...META_ROWS, ...READ_ROWS, ...WORK_ROWS, ...PROPOSAL_ROWS, ...SETTINGS_ROWS, ...COMMAND_ROWS, ...TOOL_ROWS, ...DEV_ROWS, ...CONTROL_ROWS];

/**
 * Spec §11: the control verbs with no command, reachable only through `orca control send` (references/escape-hatch.md).
 * tests/commands/verbCoverage.test.ts fails on any other verb the panel knows that no row maps.
 */
export const ESCAPE_HATCH_ONLY = ["shutdown", "system-debug-open"] as const;

const words = (def: CommandDef): string[] => [def.domain, ...(def.action === null ? [] : def.action.split(" "))];

export function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length]!;
}

/** The longest registered path that prefixes argv; else the nearest command within distance 3 (spec §4). */
export function findCommand(argv: readonly string[], registry: readonly CommandDef[] = REGISTRY): FindResult {
  let best: CommandDef | null = null;
  let bestLength = 0;
  for (const def of registry) {
    const path = words(def);
    if (path.length > argv.length || path.length <= bestLength) continue;
    if (path.every((word, i) => argv[i] === word)) { best = def; bestLength = path.length; }
  }
  if (best !== null) return { def: best, rest: argv.slice(bestLength) };
  return { suggestion: suggest(argv, registry) };
}

/**
 * Spec §4 / plan Task 14: the old top-level names, removed without aliases (human ruling). Each answers "did you mean"
 * with its v2 command; tests/commands/removedNames.test.ts holds every file to this table.
 */
export const REMOVED_NAMES: Readonly<Record<string, string>> = {
  validate: "decision validate", plan: "plan preview", correct: "dev correct", metrics: "decision metrics",
  "compact-reviews": "decision compact-reviews", level: "dev level", gate: "dev gate", chain: "dev chain", agents: "agent",
  checkpoint: "dev checkpoint", resume: "dev resume", "check-append-only": "dev check-append-only",
};

/** A removed name's v2 command, with the old sub-action when the v2 command has it (`chain start` ⇒ `dev chain start`). */
function renamed(typed: readonly string[], registry: readonly CommandDef[]): string | null {
  if (!Object.hasOwn(REMOVED_NAMES, typed[0]!)) return null;
  const target = REMOVED_NAMES[typed[0]!]!;
  const longer = typed[1] === undefined ? null : `${target} ${typed[1]}`;
  return longer !== null && registry.some((def) => words(def).join(" ") === longer) ? longer : target;
}

/**
 * Spec §4 did-you-mean: a removed name answers with its v2 command; within a known domain compare its actions; otherwise
 * every command's path and last word.
 */
export function suggest(argv: readonly string[], registry: readonly CommandDef[] = REGISTRY): string | null {
  const typed = argv.filter((word) => !word.startsWith("-"));
  if (typed.length === 0) return null;
  const old = renamed(typed, registry);
  if (old !== null) return old;
  const inDomain = registry.filter((def) => def.domain === typed[0] && def.action !== null);
  const candidates = inDomain.length > 0 ? inDomain : registry;
  let best: { path: string; distance: number } | null = null;
  for (const def of candidates) {
    const path = words(def);
    const distances = inDomain.length > 0
      ? [levenshtein(typed.slice(1, path.length).join(" "), path.slice(1).join(" "))]
      : [levenshtein(typed.slice(0, path.length).join(" "), path.join(" ")), levenshtein(typed[0]!, path[path.length - 1]!)];
    const distance = Math.min(...distances);
    if (distance <= 3 && (best === null || distance < best.distance)) best = { path: path.join(" "), distance };
  }
  return best?.path ?? null;
}

export const domainsOf = (registry: readonly CommandDef[] = REGISTRY): string[] => [...new Set(registry.map((def) => def.domain))];
