import type { CommandIo, LocalHandler, ParsedArgs } from "../types.js";
import { readStdin } from "./stdin.js";

/**
 * CLI v2 plan Task 7: the registry parsed the arguments; the tools moved out of src/cli.ts (devTools.ts) still take an
 * argv. This writes the parsed flags back in their own `--name value` form, so a tool's own checks (a malformed
 * `--repo k=p`) still answer by their own names.
 */
function flagArgv(args: ParsedArgs, names: readonly string[]): string[] {
  const out: string[] = [];
  for (const name of names) {
    const value = args.flags[name];
    if (value === undefined || value === false) continue;
    if (value === true) out.push(`--${name}`);
    else for (const one of Array.isArray(value) ? value : [value]) out.push(`--${name}`, String(one));
  }
  return out;
}

const tools = () => import("./devTools.js");
const positional = (args: ParsedArgs, name: string): string[] => {
  const value = args.positionals[name];
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
};

/** CLI v2 spec §5, §14 R8: `orca dev gate`; exit 2 = block. */
export async function runGate(args: ParsedArgs, io: CommandIo): Promise<number> {
  if (args.flags.hook !== "claude-code") {
    io.stderr("orca dev gate: only --hook claude-code is supported\n");
    return 1;
  }
  const { gateHookClaudeCode } = await import("../../gate/hook.js");
  const result = await gateHookClaudeCode(io.stdinText ?? (await readStdin()));
  io.stderr(result.stderr);
  return result.exitCode;
}

/** `orca dev level`: the PostToolUse hook; it answers exit 0 with the injection on stdout (D spec 3, 4). */
export async function runLevel(args: ParsedArgs, io: CommandIo): Promise<number> {
  if (args.flags.hook !== "claude-code") {
    io.stderr("orca dev level: only --hook claude-code is supported\n");
    return 1;
  }
  const { levelHookClaudeCode } = await import("../../level/hook.js");
  io.stdout(await levelHookClaudeCode(io.stdinText ?? (await readStdin())));
  return 0;
}

/** `orca dev check-append-only`: a git diff on stdin; exit 1 = it deletes a line (`scripts/githooks/pre-commit`). */
export async function runCheckAppendOnly(_args: ParsedArgs, io: CommandIo): Promise<number> {
  const { checkAppendOnly } = await import("../../ledger/appendOnly.js");
  const result = checkAppendOnly(io.stdinText ?? (await readStdin()));
  if (result.ok) {
    io.stdout("ok: append-only\n");
    return 0;
  }
  for (const reason of result.reasons) io.stderr(`${reason}\n`);
  return 1;
}

export const runValidate: LocalHandler = async (args) => (await tools()).runValidate(positional(args, "path"));
export const runPlanPreview: LocalHandler = async (args) =>
  (await tools()).runPlan([...positional(args, "path"), ...(args.global.verbose ? ["--verbose"] : [])]);
export const runMetrics: LocalHandler = async (args) =>
  (await tools()).runMetrics([...flagArgv(args, ["root", "repo", "as-of"]), ...(args.global.json ? ["--json"] : [])]);
export const runCompactReviews: LocalHandler = async (args) => (await tools()).runCompactReviews(flagArgv(args, ["apply", "root", "repo"]));
export const runCheckpointWrite: LocalHandler = async (args) =>
  (await tools()).runCheckpoint(["write", ...flagArgv(args, ["repo", "session", "transcript", "draft"])]);
export const runResume: LocalHandler = async (args) => (await tools()).runResume(flagArgv(args, ["repo", "checkpoint"]));

/** `orca dev correct` keeps its own argument grammar (a raw row): its parser's refusals carry their own exit codes. */
export const runCorrect: LocalHandler = async (args) => (await tools()).runCorrect(args.raw ?? []);

/** `orca dev chain start|stop|unlock` keep their own grammar (raw rows); the exit codes are the chain's (§4.3). */
export function runChain(sub: "start" | "stop" | "unlock"): LocalHandler {
  return async (args) => {
    const { runChainCommand } = await import("../../chain/command.js");
    return runChainCommand([sub, ...(args.raw ?? [])]);
  };
}

/** `orca agent init|show|refresh`: the installation table's writer; ccloop is ORCA_CCLOOP_BIN, else the installed package. */
export function runAgents(sub: "init" | "show" | "refresh"): LocalHandler {
  return async (_args, io) => {
    const { withDefaultCcloopBin } = await import("../../control/ccloopBin.js");
    const { runAgentsCommand } = await import("../../agents/command.js");
    const { env, notInstalled } = withDefaultCcloopBin(io.env);
    if (notInstalled !== null) {
      io.stderr(`orca agent: ${notInstalled.message}\n`);
      return 1;
    }
    return runAgentsCommand([sub], env, { stdout: io.stdout, stderr: io.stderr });
  };
}
