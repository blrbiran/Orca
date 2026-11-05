import { existsSync } from "node:fs";
import { readServiceConfig } from "./files.js";
import { readPanelJson } from "./instance.js";
import { launchd } from "./launchd.js";
import type { ServiceContext, ServiceManager } from "./manager.js";
import { ServiceRejection } from "./rejection.js";

/**
 * Issue #120 (session 3cfc2e73): on macOS a panel can run under launchd or as a detached process, and neither manager
 * looked at the other. A detached panel (or any process) holding the port made launchd's panel exit 78 on bind, which
 * launchd retries every ThrottleInterval (spec §5, unchanged here). `start --detach` and `restart` now refuse when the
 * other manager already runs a panel or something else holds the configured port, naming the manager and the pid.
 */

/** The port service.json's args name, or null (none, or 0: any free port, which nothing else can hold). */
function configuredPort(ctx: ServiceContext): number | null {
  let args: string[];
  try { args = readServiceConfig(ctx.paths).args; } catch { return null; }
  const at = args.indexOf("--port");
  const port = at < 0 ? NaN : Number(args[at + 1]);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

/** The pid listening on the port, as lsof answers; null when none listens or lsof is not there to ask. */
function portHolder(ctx: ServiceContext, port: number): number | null {
  const r = ctx.run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { env: ctx.env });
  if (r.code !== 0) return null;
  const pid = Number(r.stdout.trim().split("\n")[0]);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

/** The pid panel.json names when that process is alive and is the one recorded (same start time); else null. */
function recordedPanelPid(ctx: ServiceContext): number | null {
  let read: ReturnType<typeof readPanelJson>;
  try { read = readPanelJson(ctx.paths.panelJson); } catch { return null; }
  if (read.kind !== "valid") return null;
  return ctx.startTimeOf(read.body.pid) === read.body.startTime ? read.body.pid : null;
}

const refuse = (message: string): never => { throw new ServiceRejection("service-manager-conflict", message); };

export function assertNoOtherManager(ctx: ServiceContext, manager: ServiceManager, platform: NodeJS.Platform, verb: "start --detach" | "restart"): void {
  const port = configuredPort(ctx);
  const holder = port === null ? null : portHolder(ctx, port);
  if (manager.kind === "detached") {
    if (platform === "darwin" && existsSync(ctx.paths.plistFile)) {
      const job = launchd.state(ctx);
      if (job.loaded) {
        refuse(`launchd already manages this panel (${ctx.paths.label}, ${job.pid === null ? "loaded; it starts the panel again on exit" : `pid ${job.pid}`}); `
          + `a detached panel beside it fights launchd for the port. Use orca panel ${verb === "restart" ? "restart" : "start"} without the detached manager, or orca panel uninstall first`);
      }
    }
    const own = recordedPanelPid(ctx);
    if (holder !== null && holder !== own) refuse(`port ${port} is held by pid ${holder}, which is not the panel ${ctx.paths.panelJson} names; stop it first (lsof -nP -iTCP:${port} -sTCP:LISTEN shows it)`);
    return;
  }
  if (manager.kind !== "launchd") return;
  const job = launchd.state(ctx);
  const recorded = recordedPanelPid(ctx);
  if (recorded !== null && recorded !== job.pid) {
    refuse(`a panel launchd does not run (pid ${recorded}, from ${ctx.paths.panelJson}; started by orca panel start --detach or by hand) is running; `
      + `launchd's panel would exit 78 on its port and be retried every 10 s. Stop it first (ORCA_SERVICE_MANAGER=detached orca panel stop, or kill ${recorded}), then orca panel ${verb}`);
  }
  if (holder !== null && holder !== job.pid) {
    refuse(`port ${port} is held by pid ${holder}, which launchd does not run (launchd's pid: ${job.pid ?? "none"}); launchd's panel would exit 78 on bind and be retried every 10 s. Stop pid ${holder} first, then orca panel ${verb}`);
  }
}
