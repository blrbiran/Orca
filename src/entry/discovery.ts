import { lstatSync, readdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { controlRoot } from "../panel/controlOptions.js";
import { CONTROL_SOCKET_NAME } from "../panel/controlSocket.js";
import { projectsFilePath, readProjectsFile } from "../panel/projectsFile.js";
import { readPanelJson } from "../service/instance.js";
import { panelDir } from "../service/paths.js";
import { isProcessAlive } from "../service/processInfo.js";
import { EntryRejection } from "./envelope.js";

/**
 * Spec §4.3: the same answer the panel's default file/registry mode gives (controlOptions.ts:135), read-only.
 * Deterministic and never guessed past: a broken projects file is refused, not skipped.
 * Order: --control-state-dir, the service panel's panel.json (panel service spec §5), the projects file's
 * controlStateDir, <control root>/panel, else the one socket under the control root.
 */
export function discoverSocketPath(input: { stateDirFlag?: string; env: NodeJS.ProcessEnv }): string {
  if (input.stateDirFlag !== undefined) {
    // Final review H5: an empty flag is a mistake to name, not a request for the default socket.
    if (input.stateDirFlag.length === 0) throw new EntryRejection("control-cli-argument-invalid", "--control-state-dir wants a directory, not an empty string");
    return join(input.stateDirFlag, CONTROL_SOCKET_NAME);
  }
  // Panel service spec §5: the service panel says where its socket is. A panel.json that does not parse is refused by
  // name (like a broken projects file); one that names no socket, a dead pid, or a path that is not a socket falls through.
  // panelDir() does not check absoluteness (plan Task 3): a relative ORCA_PANEL_DIR would resolve against the agent's
  // cwd, so it is read as no service at all.
  const serviceDir = panelDir(input.env);
  if (isAbsolute(serviceDir)) {
    const serviceJson = join(serviceDir, "panel.json");
    let service: ReturnType<typeof readPanelJson>;
    // As for the projects file (final review I1): a read that fails other than ENOENT is refused by name, not thrown raw.
    try { service = readPanelJson(serviceJson); }
    catch (error) { throw new EntryRejection("control-panel-json-invalid", `${serviceJson}: ${error instanceof Error ? error.message : String(error)}`); }
    if (service.kind === "invalid") throw new EntryRejection("control-panel-json-invalid", `${serviceJson}: ${service.reason}`);
    // Task 9 review: a crash leaves both panel.json and the socket file behind, so a dead pid falls through -- else the
    // stale path would shadow a live legacy --repo panel (agent-entry spec §14). A reused pid still lets it win; the
    // connect then fails loudly with panel-not-running.
    if (service.kind === "valid" && service.body.socketPath !== null && isProcessAlive(service.body.pid) && isSocket(service.body.socketPath)) return service.body.socketPath;
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
