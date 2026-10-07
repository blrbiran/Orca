import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { controlRoot } from "../panel/controlOptions.js";
import { CONTROL_SOCKET_NAME } from "../panel/controlSocket.js";
import { projectsFilePath, readProjectsFile } from "../panel/projectsFile.js";
import { EntryRejection } from "./envelope.js";

/**
 * Spec §4.3: the same answer the panel's default file/registry mode gives (controlOptions.ts:135), read-only.
 * Deterministic and never guessed past: a broken projects file is refused, not skipped.
 */
export function discoverSocketPath(input: { stateDirFlag?: string; env: NodeJS.ProcessEnv }): string {
  if (input.stateDirFlag !== undefined) {
    // Final review H5: an empty flag is a mistake to name, not a request for the default socket.
    if (input.stateDirFlag.length === 0) throw new EntryRejection("control-cli-argument-invalid", "--control-state-dir wants a directory, not an empty string");
    return join(input.stateDirFlag, CONTROL_SOCKET_NAME);
  }
  const file = projectsFilePath(input.env);
  let read: ReturnType<typeof readProjectsFile>;
  // Final review I1: a stat that fails other than ENOENT (EACCES, ENOTDIR) is refused by name, not thrown raw.
  try { read = readProjectsFile(file); }
  catch (error) { throw new EntryRejection("control-projects-file-invalid", `${file}: ${error instanceof Error ? error.message : String(error)}`); }
  if (read.kind === "invalid") throw new EntryRejection("control-projects-file-invalid", `${file}: ${read.reason}`);
  if (read.kind === "valid" && read.config.controlStateDir !== undefined) return join(read.config.controlStateDir, CONTROL_SOCKET_NAME);
  const root = controlRoot(input.env);
  const fallback = join(root, "panel", CONTROL_SOCKET_NAME);
  if (isSocket(fallback)) return fallback;
  // Human review 2026-10-07: a legacy --repo panel keeps its socket at <root>/<repo key> (controlOptions.ts), which the
  // steps above never name. Exactly one socket under the root is that panel; several are named, not chosen between.
  let entries: string[];
  try { entries = readdirSync(root).sort(); } catch { return fallback; }
  const found = entries.map(name => join(root, name, CONTROL_SOCKET_NAME)).filter(isSocket);
  if (found.length === 1) return found[0]!;
  if (found.length > 1) throw new EntryRejection("control-socket-ambiguous", `more than one panel socket under ${root}: ${found.join(", ")}; pass --control-state-dir <dir>`);
  return fallback;
}

function isSocket(path: string): boolean {
  try { return lstatSync(path).isSocket(); } catch { return false; }
}
