import { EntryRejection, localError } from "../entry/envelope.js";
import { renderHelp } from "./help.js";
import { GLOBAL_FLAGS, parseArgs, rawGlobals } from "./parse.js";
import { findCommand, REGISTRY } from "./registry.js";
import type { CommandDef, CommandIo, GlobalFlags, ParsedArgs } from "./types.js";

/** A refusal made here: one JSON line under --json, else one line on stderr; exit 1 (spec §7). */
export function refuse(error: EntryRejection, json: boolean, io: Pick<CommandIo, "stdout" | "stderr">, commandId?: string): number {
  if (json) io.stdout(`${JSON.stringify(localError(error, commandId))}\n`);
  else io.stderr(`orca: ${error.code}: ${error.message}\n`);
  return 1;
}

async function execute(def: CommandDef, args: ParsedArgs, io: CommandIo, registry: readonly CommandDef[]): Promise<number> {
  if (args.global.help && !def.raw) {
    io.stdout(renderHelp([def.domain, ...(def.action === null ? [] : def.action.split(" "))], registry));
    return 0;
  }
  const mapping = def.mapsTo;
  if (mapping.kind === "local") return (await mapping.load())(args, io);
  const { runPanelCommand } = await import("./panelCommand.js");
  return runPanelCommand(def, args, io);
}

/**
 * Issue #142: global flags written before the command (`orca --json group list`, `orca --project X project show`,
 * `orca --help group list`) are moved behind the command words, so they mean exactly what the trailing form means.
 * Only known global flags are moved, each with its value (`--x v` or `--x=v`); the first other word stops the scan.
 */
export function hoistGlobalFlags(argv: readonly string[], registry: readonly CommandDef[] = REGISTRY): string[] {
  const leading: string[] = [];
  let i = 0;
  while (i < argv.length && argv[i]!.startsWith("--")) {
    const arg = argv[i]!;
    const eq = arg.indexOf("=");
    const flag = GLOBAL_FLAGS.find((known) => known.name === arg.slice(2, eq === -1 ? undefined : eq));
    if (flag === undefined) break;
    const width = flag.type === "boolean" || eq !== -1 || i + 1 >= argv.length ? 1 : 2;
    leading.push(...argv.slice(i, i + width));
    i += width;
  }
  if (leading.length === 0) return [...argv];
  const words = argv.slice(i);
  const found = findCommand(words, registry);
  // Flags go right after the command words (before any `--`), so parseArgs reads them as flags, not positionals.
  if ("def" in found) return [...words.slice(0, words.length - found.rest.length), ...leading, ...found.rest];
  return [...words, ...leading];
}

/**
 * CLI v2 spec §4, §11: run argv through the registry. null = no registered command matches, so the caller may still try
 * the `panel`, `user` and `mcp` arms (their own grammar) before answering with `unknownCommand`.
 */
export async function runRegistered(typed: readonly string[], io: CommandIo, registry: readonly CommandDef[] = REGISTRY): Promise<number | null> {
  const argv = hoistGlobalFlags(typed, registry);
  const found = findCommand(argv, registry);
  if (!("def" in found)) {
    if (typed[0] === "--help") { io.stdout(renderHelp([], registry)); return 0; }
    return null;
  }
  const { def, rest } = found;
  let global: GlobalFlags = rawGlobals(rest);
  try {
    const args: ParsedArgs = def.raw ? { positionals: {}, flags: {}, global, raw: rest } : parseArgs(def, rest);
    global = args.global;
    return await execute(def, args, io, registry);
  } catch (error) {
    if (error instanceof EntryRejection) return refuse(error, global.json, io);
    throw error;
  }
}

/** Spec §4: an unknown command names the nearest registered one and exits 1; null when nothing is near. */
export function unknownCommand(typed: readonly string[], io: Pick<CommandIo, "stderr">, registry: readonly CommandDef[] = REGISTRY): number | null {
  const argv = hoistGlobalFlags(typed, registry);
  const found = findCommand(argv, registry);
  if ("def" in found || found.suggestion === null) return null;
  io.stderr(`orca: unknown command ${JSON.stringify(argv.filter((word) => !word.startsWith("-")).slice(0, 2).join(" "))}; did you mean orca ${found.suggestion}?\n`);
  return 1;
}

export function processIo(stdinText?: string): CommandIo {
  return {
    stdout: (text) => { process.stdout.write(text); },
    stderr: (text) => { process.stderr.write(text); },
    env: process.env, cwd: process.cwd(), stdinIsTTY: process.stdin.isTTY === true,
    ...(stdinText === undefined ? {} : { stdinText }),
  };
}
