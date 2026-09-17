import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const orcaRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** POSIX single-quote quoting: the text is pasted into a shell by an agent. */
export const shellQuote = (s: string): string => `'${s.replaceAll("'", `'\\''`)}'`;

/** An absolute command line that runs this checkout's CLI from any working directory. */
export function orcaCommand(args: string[]): string {
  return [join(orcaRoot, "node_modules", ".bin", "tsx"), join(orcaRoot, "src", "cli.ts"), ...args].map(shellQuote).join(" ");
}
