import type { CommandIo, ParsedArgs } from "../types.js";
import { readStdin } from "./stdin.js";

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
