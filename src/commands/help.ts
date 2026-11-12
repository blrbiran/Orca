import { EntryRejection } from "../entry/envelope.js";
import { commandPath, GLOBAL_FLAGS } from "./parse.js";
import { domainsOf, levenshtein, REGISTRY } from "./registry.js";
import type { CommandDef, CommandIo, FlagDef, ParsedArgs } from "./types.js";

/** Domains whose every row is hidden stay out of the top level; `orca help <domain>` still lists them (spec §5, §10). */
const HIDDEN_DOMAINS_NOTE = "  orca help dev                  tools for developing Orca itself (hooks, checkpoints, chains)";

function flagUsage(flag: FlagDef): string {
  const value = flag.type === "boolean" ? `--${flag.name}` : `--${flag.name} <${flag.name}>`;
  return flag.required ? value : `[${value}]`;
}

export function usageLine(def: CommandDef): string {
  const positionals = def.positionals.map((p) => {
    const word = `<${p.name}>${p.variadic ? "..." : ""}`;
    return p.required ? word : `[${word}]`;
  });
  return ["orca", commandPath(def), ...positionals, ...def.flags.map(flagUsage)].join(" ");
}

function listing(rows: readonly CommandDef[]): string {
  return rows.map((def) => {
    const head = `  ${usageLine(def)}`;
    return head.length < 48 ? `${head.padEnd(48)} ${def.summary}` : `${head}\n${" ".repeat(49)}${def.summary}`;
  }).join("\n");
}

function commandHelp(def: CommandDef): string {
  const lines = [`usage: ${usageLine(def)}`, "", def.summary];
  if (def.positionals.length > 0 || def.flags.length > 0) {
    lines.push("");
    for (const p of def.positionals) lines.push(`  <${p.name}>  ${p.summary}`);
    for (const f of def.flags) lines.push(`  ${flagUsage(f).replace(/^\[|\]$/g, "")}  ${f.summary}${f.humanOnly ? " (person token: --as-person)" : ""}`);
  }
  if (def.access === "token") lines.push("", "Needs a person token over the socket: orca auth login, then --as-person.");
  if (def.exitCodes !== undefined) {
    lines.push("");
    for (const [code, meaning] of Object.entries(def.exitCodes)) lines.push(`  exit ${code}: ${meaning}`);
  }
  if (def.examples.length > 0) lines.push("", ...def.examples.map((example) => `  ${example}`));
  return `${lines.join("\n")}\n`;
}

/** Spec §4: generated from the registry. `[]` = top level; `[domain]`; `[domain, ...action]`. */
export function renderHelp(topic: readonly string[], registry: readonly CommandDef[] = REGISTRY): string {
  if (topic.length === 0) {
    const shown = registry.filter((def) => !def.hidden);
    return [
      "usage: orca <domain> <action> [ids] [--flags]",
      "",
      listing(shown),
      "",
      "  orca panel run|install|start|stop|restart|uninstall|status|logs, orca user add|passwd|disable|list|rotate-key",
      "                                                 the service and its accounts (unchanged)",
      HIDDEN_DOMAINS_NOTE,
      "",
      "Global flags:",
      ...GLOBAL_FLAGS.map((flag) => `  ${flagUsage(flag).replace(/^\[|\]$/g, "").padEnd(30)} ${flag.summary}`),
      "",
    ].join("\n");
  }
  const action = topic.slice(1).join(" ");
  const exact = registry.find((def) => def.domain === topic[0] && (def.action ?? "") === action);
  if (exact !== undefined && (topic.length > 1 || exact.action === null)) return commandHelp(exact);
  const rows = registry.filter((def) => def.domain === topic[0]);
  if (rows.length > 0 && topic.length === 1) return `usage: orca ${topic[0]} <action> [ids] [--flags]\n\n${listing(rows)}\n`;
  const wanted = topic.join(" ");
  const names = [...domainsOf(registry), ...registry.map(commandPath)];
  const nearest = names.map((name) => ({ name, distance: levenshtein(wanted, name) })).filter((n) => n.distance <= 3).sort((a, b) => a.distance - b.distance)[0];
  throw new EntryRejection("control-cli-argument-invalid", `no help for ${JSON.stringify(wanted)}${nearest ? `; did you mean orca help ${nearest.name}?` : ""}`);
}

const flagJson = (f: FlagDef) => ({ name: f.name, type: f.type, required: f.required === true, ...(f.repeatable ? { repeatable: true } : {}), ...(f.humanOnly ? { humanOnly: true } : {}), summary: f.summary });
const commandJson = (def: CommandDef) => ({
  command: commandPath(def), usage: usageLine(def), summary: def.summary, access: def.access, ...(def.hidden ? { hidden: true } : {}),
  positionals: def.positionals.map((p) => ({ name: p.name, required: p.required, ...(p.variadic ? { variadic: true } : {}), summary: p.summary })),
  flags: def.flags.map(flagJson), ...(def.exitCodes === undefined ? {} : { exitCodes: def.exitCodes }), examples: def.examples,
});

/**
 * Tester #272 (5)/(6): the help as data, so an agent need not parse text. The same rows the text shows (the top level
 * leaves hidden domains out; `help <domain>` and `help <domain> <action>` select as the text does), plus the global flags.
 */
export function helpJson(topic: readonly string[], registry: readonly CommandDef[] = REGISTRY): unknown {
  renderHelp(topic, registry); // the same unknown-topic refusal as the text
  const action = topic.slice(1).join(" ");
  const exact = registry.find((def) => def.domain === topic[0] && (def.action ?? "") === action);
  const rows = topic.length === 0 ? registry.filter((def) => !def.hidden)
    : exact !== undefined && (topic.length > 1 || exact.action === null) ? [exact]
    : registry.filter((def) => def.domain === topic[0]);
  return { schema: "orca-help-v1", commands: rows.map(commandJson), globalFlags: GLOBAL_FLAGS.map(flagJson) };
}

export async function runHelp(args: ParsedArgs, io: CommandIo): Promise<number> {
  const raw = args.positionals.topic;
  const topic = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  io.stdout(args.global.json ? `${JSON.stringify({ schema: "orca-cli-response-v1", status: 200, body: helpJson(topic) })}\n` : renderHelp(topic));
  return 0;
}
