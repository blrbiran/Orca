import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync, rmSync } from "node:fs";
import { ensurePrivateDir, ensurePrivateFile } from "./files.js";
import { identifyPanel } from "./identify.js";
import { readPanelJson } from "./instance.js";
import { tailLogs, waitExit, type ManagerState, type ServiceContext, type ServiceManager } from "./manager.js";

export const DETACHED_NOTICE = "orca panel: no service manager: started as a detached process, which neither restarts on crash nor survives a reboot";

/** The pid panel.json names, only if it still has the start time panel.json recorded (spec §8). */
function ownPanel(ctx: ServiceContext): { pid: number; startTime: string; now: string | null } | null {
  const read = readPanelJson(ctx.paths.panelJson);
  if (read.kind !== "valid") return null;
  return { pid: read.body.pid, startTime: read.body.startTime, now: ctx.startTimeOf(read.body.pid) };
}

export const detached: ServiceManager = {
  kind: "detached",
  async install(ctx) { ctx.out("orca panel: installed without a service manager; start it with orca panel start --detach"); return 0; },
  async start(ctx) {
    const current = await identifyPanel(ctx.paths.panelJson);
    if (current.answering) { ctx.out(`orca panel: already answering at ${current.panel.url}`); return 0; }
    if (!existsSync(ctx.paths.runScript)) { ctx.err("orca panel: not installed (no run.sh); run orca panel install first"); return 1; }
    ensurePrivateDir(ctx.paths.logsDir);
    ensurePrivateFile(ctx.paths.outLog);
    ensurePrivateFile(ctx.paths.errLog);
    const outFd = openSync(ctx.paths.outLog, "a");
    const errFd = openSync(ctx.paths.errLog, "a");
    let pid: number | undefined;
    try {
      // Spec §2: its own session (detached), output to the log files, nothing tying it to this process.
      const child = spawn("/bin/sh", [ctx.paths.runScript], { cwd: ctx.paths.panelDir, detached: true, stdio: ["ignore", outFd, errFd], env: { HOME: ctx.env.HOME ?? "", PATH: "/usr/bin:/bin" } });
      pid = child.pid;
      child.unref();
    } finally { closeSync(outFd); closeSync(errFd); }
    ctx.out(DETACHED_NOTICE);
    const deadline = ctx.now() + ctx.startWaitMs;
    for (;;) {
      const id = await identifyPanel(ctx.paths.panelJson);
      if (id.answering && id.panel.pid === pid) { ctx.out(`orca panel: answering at ${id.panel.url} (pid ${pid})`); return 0; }
      if (pid === undefined || !ctx.isAlive(pid)) { ctx.err(`orca panel: the panel exited during start; see ${ctx.paths.errLog}`); return 1; }
      if (ctx.now() >= deadline) { ctx.err(`orca panel: no answer within ${ctx.startWaitMs} ms; see ${ctx.paths.errLog}`); return 1; }
      await ctx.sleep(200);
    }
  },
  async stop(ctx) {
    const own = ownPanel(ctx);
    if (own === null || own.now === null) { ctx.out("orca panel: not running; nothing to stop"); return 0; }
    if (own.now !== own.startTime) {
      ctx.err(`orca panel: pid ${own.pid} started at ${own.now}, not at ${own.startTime}: it is not the panel panel.json names, so it is not signalled`);
      return 1;
    }
    process.kill(own.pid, "SIGTERM");
    if (!(await waitExit(ctx, own.pid))) { ctx.err(`orca panel: pid ${own.pid} did not exit within ${ctx.exitWaitMs} ms`); return 1; }
    return 0;
  },
  async restart(ctx) {
    const stopped = await detached.stop(ctx);
    return stopped !== 0 ? stopped : detached.start(ctx);
  },
  state(ctx): ManagerState {
    const own = ownPanel(ctx);
    return own !== null && own.now === own.startTime ? { loaded: true, state: "running", pid: own.pid } : { loaded: false, state: "not running", pid: null };
  },
  logs: tailLogs,
  async uninstall(ctx) {
    const stopped = await detached.stop(ctx);
    if (stopped !== 0) return stopped;
    rmSync(ctx.paths.runScript, { force: true });
    return 0;
  },
};
