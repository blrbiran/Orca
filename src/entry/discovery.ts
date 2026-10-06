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
  if (input.stateDirFlag !== undefined && input.stateDirFlag.length > 0) return join(input.stateDirFlag, CONTROL_SOCKET_NAME);
  const file = projectsFilePath(input.env);
  const read = readProjectsFile(file);
  if (read.kind === "invalid") throw new EntryRejection("control-projects-file-invalid", `${file}: ${read.reason}`);
  if (read.kind === "valid" && read.config.controlStateDir !== undefined) return join(read.config.controlStateDir, CONTROL_SOCKET_NAME);
  return join(controlRoot(input.env), "panel", CONTROL_SOCKET_NAME);
}
