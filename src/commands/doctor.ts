import { existsSync, lstatSync, readdirSync, statSync } from "node:fs";
import { connect } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { contextOf, report, runChecks, STATUS_CHECKS, type Check, type CheckContext, type StatusCheck } from "./status.js";
import type { CommandIo, ParsedArgs } from "./types.js";

/**
 * CLI v2 spec §8: `orca doctor` -- status's checks plus slower ones, and one line per failure saying what to do.
 * Read-only like status: it names a fix, it never applies one.
 */

/** The agent CLIs' directories the agents table needs on the service's PATH (what `orca panel install` computes). */
export async function agentPathCheck(ctx: CheckContext): Promise<StatusCheck> {
  const { servicePaths } = await import("../service/paths.js");
  const { readServiceConfig } = await import("../service/files.js");
  const { missingAgentPathDirs } = await import("../service/config.js");
  const paths = servicePaths(ctx.env);
  if (!existsSync(paths.configFile)) return { level: "warn", subject: "agent-path", fact: `no service installed (no ${paths.configFile}); nothing to compare` };
  const config = readServiceConfig(paths);
  const missing = missingAgentPathDirs(config, ctx.env.PATH ?? "");
  if (missing.length > 0) {
    return { level: "fail", subject: "agent-path", fact: `the service PATH in ${paths.configFile} lacks ${missing.join(", ")}, which the agents table needs`, fix: "orca panel install (restart keeps the stored PATH; install recomputes it)" };
  }
  return { level: "ok", subject: "agent-path", fact: `the service PATH reaches every agent the table names` };
}

/**
 * Rule 17's modes for what Orca writes under ~/.orca: the directory itself and its entries one level down (control,
 * panel, person, agents.json, …), directories 0700 and files 0600. Dot-entries (a person's own git, say) are not Orca's.
 * Named, never changed: they are the person's.
 */
export async function orcaModesCheck(ctx: CheckContext): Promise<StatusCheck> {
  const root = join(ctx.env.HOME !== undefined && ctx.env.HOME.length > 0 ? ctx.env.HOME : homedir(), ".orca");
  if (!existsSync(root)) return { level: "ok", subject: "orca-modes", fact: `no ${root}` };
  const open: { dirs: string[]; files: string[] } = { dirs: [], files: [] };
  for (const path of [root, ...readdirSync(root).filter((name) => !name.startsWith(".")).sort().map((name) => join(root, name))]) {
    const stat = lstatSync(path);
    if ((stat.mode & 0o077) === 0) continue;
    if (stat.isDirectory()) open.dirs.push(path);
    else if (stat.isFile()) open.files.push(path);
  }
  if (open.dirs.length + open.files.length === 0) return { level: "ok", subject: "orca-modes", fact: `${root}: directories 0700, files 0600` };
  const fixes = [...(open.dirs.length > 0 ? [`chmod 700 ${open.dirs.join(" ")}`] : []), ...(open.files.length > 0 ? [`chmod 600 ${open.files.join(" ")}`] : [])];
  return { level: "warn", subject: "orca-modes", fact: `open to group or others: ${[...open.dirs, ...open.files].join(", ")}`, fix: fixes.join("; ") };
}

const isSocket = (path: string): boolean => { try { return lstatSync(path).isSocket(); } catch { return false; } };

/** True when something accepts a connection on the socket; false on ECONNREFUSED (no listener: a stale file). */
const listening = (path: string): Promise<boolean> => new Promise((resolve) => {
  const socket = connect(path);
  socket.setTimeout(2_000, () => { socket.destroy(); resolve(true); });
  socket.once("connect", () => { socket.destroy(); resolve(true); });
  socket.once("error", (error: NodeJS.ErrnoException) => resolve(error.code !== "ECONNREFUSED" && error.code !== "ENOENT"));
});

/** Control sockets under the control root and the service's panel.json that no panel listens on. */
export async function staleSocketsCheck(ctx: CheckContext): Promise<StatusCheck> {
  const { controlRoot } = await import("../panel/controlOptions.js");
  const { CONTROL_SOCKET_NAME } = await import("../panel/controlSocketPath.js");
  const { servicePaths } = await import("../service/paths.js");
  const { readPanelJson } = await import("../service/instance.js");
  const root = controlRoot(ctx.env);
  const candidates = new Set<string>();
  let entries: string[] = [];
  try { entries = readdirSync(root).sort(); } catch { entries = []; }
  for (const name of entries) candidates.add(join(root, name, CONTROL_SOCKET_NAME));
  const panel = readPanelJson(servicePaths(ctx.env).panelJson);
  if (panel.kind === "valid" && panel.body.socketPath !== null) candidates.add(panel.body.socketPath);
  const stale: string[] = [];
  for (const path of candidates) if (isSocket(path) && !(await listening(path))) stale.push(path);
  if (stale.length === 0) return { level: "ok", subject: "stale-sockets", fact: `none under ${root}` };
  return { level: "fail", subject: "stale-sockets", fact: `no panel listens on ${stale.join(", ")}`, fix: `start the panel that owns it (it replaces the file), or rm ${stale.join(" ")}` };
}

const isFile = (path: string): boolean => { try { return statSync(path).isFile(); } catch { return false; } };

/**
 * Issue 92: the ccloop bin a panel would start with exists. A panel without one boots with no execution port. The
 * environment is the installed service's when there is one (launchd hands it that, not this shell's), and the
 * installed package resolves from that service's entry, the way the panel process resolves it; otherwise this shell
 * and this checkout.
 */
export async function ccloopBinCheck(ctx: CheckContext): Promise<StatusCheck> {
  const { servicePaths } = await import("../service/paths.js");
  const { readServiceConfig } = await import("../service/files.js");
  const { CcloopNotInstalled, installedCcloopBin } = await import("../control/ccloopBin.js");
  const paths = servicePaths(ctx.env);
  const service = existsSync(paths.configFile) ? readServiceConfig(paths) : null;
  const env: NodeJS.ProcessEnv = service?.env ?? ctx.env;
  const whose = service === null ? "this shell" : `the service (${paths.configFile})`;
  const named = env.ORCA_CCLOOP_BIN;
  if (named !== undefined) {
    if (named.length === 0) return { level: "fail", subject: "ccloop-bin", fact: `ORCA_CCLOOP_BIN is empty in ${whose}: its panel has no execution port`, fix: "unset ORCA_CCLOOP_BIN to use the installed ccloop, or point it at a ccloop build's dist/cli.js" };
    if (!isFile(named)) return { level: "fail", subject: "ccloop-bin", fact: `ORCA_CCLOOP_BIN=${named} in ${whose} is not a file: its panel has no execution port`, fix: "point ORCA_CCLOOP_BIN at a ccloop build's dist/cli.js, or unset it to use the installed ccloop" };
    return { level: "ok", subject: "ccloop-bin", fact: `${named} (ORCA_CCLOOP_BIN in ${whose})` };
  }
  try {
    return { level: "ok", subject: "ccloop-bin", fact: `${installedCcloopBin(service?.entry ?? join(ctx.checkout, "package.json"))} (the installed ccloop; ORCA_CCLOOP_BIN unset in ${whose})` };
  } catch (error) {
    if (!(error instanceof CcloopNotInstalled)) throw error;
    return { level: "fail", subject: "ccloop-bin", fact: error.message, fix: "npm install in the Orca checkout, then orca panel restart" };
  }
}

export const DOCTOR_CHECKS: readonly Check[] = [...STATUS_CHECKS, agentPathCheck, orcaModesCheck, staleSocketsCheck, ccloopBinCheck];

export async function runDoctor(args: ParsedArgs, io: CommandIo, checks: readonly Check[] = DOCTOR_CHECKS): Promise<number> {
  return report(await runChecks(checks, contextOf(args, io)), args, io, "orca-doctor-v1", true);
}
