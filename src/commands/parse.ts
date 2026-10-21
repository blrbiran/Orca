import { EntryRejection } from "../entry/envelope.js";
import type { CommandDef, FlagDef, GlobalFlags, ParsedArgs } from "./types.js";

/** Spec §4: on every command. `--command-id`, `--if-revision` and `--as-person` matter only to writes. */
export const GLOBAL_FLAGS: readonly FlagDef[] = [
  { name: "json", type: "boolean", summary: "print exactly one JSON line: {schema,status,commandId?,body,request?}" },
  { name: "project", type: "string", summary: "the project (id or path); default: the registered repository holding cwd" },
  { name: "control-state-dir", type: "string", summary: "the panel's control state directory (its socket lives there)" },
  { name: "quiet", type: "boolean", summary: "print nothing on success" },
  { name: "verbose", type: "boolean", summary: "print more" },
  { name: "help", type: "boolean", summary: "this command's help" },
  { name: "command-id", type: "string", summary: "use this id for a new request (a write)" },
  { name: "if-revision", type: "integer", summary: "send this revision instead of the one just read (a write)" },
  { name: "as-person", type: "boolean", summary: "send the person token stored by orca login" },
];

const NON_NEGATIVE = /^(0|[1-9][0-9]*)$/;
const invalid = (message: string): EntryRejection => new EntryRejection("control-cli-argument-invalid", message);

function convert(flag: FlagDef, value: string): string | number {
  if (flag.type !== "integer") return value;
  if (!NON_NEGATIVE.test(value) || !Number.isSafeInteger(Number(value))) throw invalid(`--${flag.name} wants a non-negative integer, got ${JSON.stringify(value)}`);
  return Number(value);
}

/** Spec §4: positionals, then `--flag value` / `--flag=value` / `--switch` in any order; anything unknown is refused. */
export function parseArgs(def: CommandDef, rest: string[]): ParsedArgs {
  const known = new Map<string, { flag: FlagDef; global: boolean }>();
  for (const flag of GLOBAL_FLAGS) known.set(flag.name, { flag, global: true });
  for (const flag of def.flags) known.set(flag.name, { flag, global: false });
  const words: string[] = [];
  const flags: ParsedArgs["flags"] = {};
  const globals: Record<string, string | number | boolean> = {};
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]!;
    if (arg === "--") { words.push(...rest.slice(i + 1)); break; }
    if (!arg.startsWith("--")) { words.push(arg); continue; }
    const eq = arg.indexOf("=");
    const name = arg.slice(2, eq === -1 ? undefined : eq);
    const entry = known.get(name);
    if (entry === undefined) throw invalid(`unknown flag --${name} for orca ${commandPath(def)}`);
    let value: string | number | boolean;
    if (entry.flag.type === "boolean") {
      if (eq !== -1) throw invalid(`--${name} takes no value`);
      value = true;
    } else {
      const text = eq === -1 ? rest[++i] : arg.slice(eq + 1);
      if (text === undefined) throw invalid(`--${name} wants a value`);
      value = convert(entry.flag, text);
    }
    if (entry.global) {
      if (name in globals) throw invalid(`--${name} given twice`);
      globals[name] = value;
    } else if (entry.flag.repeatable) {
      const prior = flags[name];
      flags[name] = [...(Array.isArray(prior) ? prior : []), String(value)];
    } else {
      if (name in flags) throw invalid(`--${name} given twice`);
      flags[name] = value;
    }
  }
  const global: GlobalFlags = {
    json: globals.json === true, quiet: globals.quiet === true, verbose: globals.verbose === true, help: globals.help === true, asPerson: globals["as-person"] === true,
    ...(globals.project === undefined ? {} : { project: String(globals.project) }),
    ...(globals["control-state-dir"] === undefined ? {} : { controlStateDir: String(globals["control-state-dir"]) }),
    ...(globals["command-id"] === undefined ? {} : { commandId: String(globals["command-id"]) }),
    ...(globals["if-revision"] === undefined ? {} : { ifRevision: Number(globals["if-revision"]) }),
  };
  if (global.help) return { positionals: {}, flags, global };
  const positionals: ParsedArgs["positionals"] = {};
  let at = 0;
  for (const positional of def.positionals) {
    if (positional.variadic) {
      const taken = words.slice(at);
      at = words.length;
      if (positional.required && taken.length === 0) throw invalid(`orca ${commandPath(def)} wants <${positional.name}>`);
      if (taken.length > 0) positionals[positional.name] = taken;
      continue;
    }
    const word = words[at];
    if (word === undefined) {
      if (positional.required) throw invalid(`orca ${commandPath(def)} wants <${positional.name}>`);
      continue;
    }
    positionals[positional.name] = word;
    at += 1;
  }
  if (at < words.length) throw invalid(`unexpected argument ${JSON.stringify(words[at])} for orca ${commandPath(def)}`);
  for (const flag of def.flags) {
    if (flag.required && !(flag.name in flags)) throw invalid(`orca ${commandPath(def)} wants --${flag.name}`);
  }
  return { positionals, flags, global };
}

export function commandPath(def: Pick<CommandDef, "domain" | "action">): string {
  return def.action === null ? def.domain : `${def.domain} ${def.action}`;
}

/** The global flags a raw command still honours, read without refusing its own flags. */
export function rawGlobals(rest: string[]): GlobalFlags {
  return { json: rest.includes("--json"), quiet: false, verbose: false, help: rest.includes("--help"), asPerson: false };
}
