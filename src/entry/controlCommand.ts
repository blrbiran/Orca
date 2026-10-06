import { readFileSync } from "node:fs";
import { CLIENT_PATTERN } from "../control/commandClient.js";
import { discoverSocketPath } from "./discovery.js";
import { EntryRejection, exitCodeFor, localError, type CliResponseV1 } from "./envelope.js";
import { controlGet, controlSend } from "./operations.js";

const VALUE_FLAGS = new Set(["--control-state-dir", "--client-name", "--expected-revision", "--payload", "--payload-file", "--command-id"]);

/** Spec §4: `orca control get|send`. stdout carries exactly one JSON line, whatever happens short of a crash. */
export async function runControlCommand(
  args: string[],
  env: NodeJS.ProcessEnv,
  io: { write(line: string): void; readFile(path: string): string } = { write: (line) => process.stdout.write(line), readFile: (path) => readFileSync(path, "utf8") },
): Promise<number> {
  const print = (response: CliResponseV1): number => { io.write(`${JSON.stringify(response)}\n`); return exitCodeFor(response); };
  try {
    const [sub, target, ...rest] = args;
    const flags = new Map<string, string>();
    for (let i = 0; i < rest.length; i += 2) {
      const name = rest[i]!, value = rest[i + 1];
      if (!VALUE_FLAGS.has(name) || value === undefined || flags.has(name)) throw new EntryRejection("control-cli-argument-invalid", `unexpected argument ${JSON.stringify(name)}`);
      flags.set(name, value);
    }
    if ((sub !== "get" && sub !== "send") || target === undefined) throw new EntryRejection("control-cli-argument-invalid", "usage: orca control get <path> | send <route> --expected-revision <n> --payload <json>");
    const name = flags.get("--client-name");
    const client = name === undefined ? "cli" : `cli:${name}`;
    if (!CLIENT_PATTERN.test(client)) throw new EntryRejection("control-cli-argument-invalid", "--client-name wants letters, digits, . _ - (at most 64)");
    const socketPath = discoverSocketPath({ stateDirFlag: flags.get("--control-state-dir"), env });
    if (sub === "get") {
      for (const only of ["--expected-revision", "--payload", "--payload-file", "--command-id"]) if (flags.has(only)) throw new EntryRejection("control-cli-argument-invalid", `${only} is for send`);
      return print(await controlGet({ socketPath, client, path: target }));
    }
    const revisionText = flags.get("--expected-revision");
    if (revisionText === undefined || !/^(0|[1-9][0-9]*)$/.test(revisionText)) throw new EntryRejection("control-cli-argument-invalid", "--expected-revision wants a non-negative integer");
    const inline = flags.get("--payload"), file = flags.get("--payload-file");
    if ((inline === undefined) === (file === undefined)) throw new EntryRejection("control-cli-argument-invalid", "give exactly one of --payload and --payload-file");
    let payload: unknown;
    try { payload = JSON.parse(inline ?? io.readFile(file!)); }
    catch { throw new EntryRejection("control-cli-argument-invalid", "the payload is not readable JSON"); }
    return print(await controlSend({ socketPath, client, route: target, expectedRevision: Number(revisionText), payload, commandId: flags.get("--command-id") }));
  } catch (error) {
    if (error instanceof EntryRejection) return print(localError(error));
    throw error;
  }
}
