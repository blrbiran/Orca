import { dirname } from "node:path";
import { rmSync } from "node:fs";
import { ensurePrivateDir, readTextOrNull, writePrivateFile } from "./files.js";
import { tailLogs, waitExit, type ManagerState, type ServiceContext, type ServiceManager } from "./manager.js";
import { renderPlist } from "./render.js";

/** launchctl's "no such service" answers (ESRCH 3, 113, 125): not loaded, as opposed to failed. */
export const LAUNCHD_NOT_LOADED = new Set([3, 113, 125]);

const launchctl = (ctx: ServiceContext, args: string[]) => ctx.run("launchctl", args, { env: ctx.env });
/** Spec §4: gui/<uid> when launchctl managername answers Aqua, else user/<uid>. */
function domain(ctx: ServiceContext): string {
  const answer = launchctl(ctx, ["managername"]);
  return answer.code === 0 && answer.stdout.trim() === "Aqua" ? `gui/${ctx.uid}` : `user/${ctx.uid}`;
}
const target = (ctx: ServiceContext, dom: string): string => `${dom}/${ctx.paths.label}`;
const failed = (ctx: ServiceContext, verb: string, r: { code: number; stderr: string }): number => {
  ctx.err(`orca panel: launchctl ${verb} exited ${r.code}: ${r.stderr.trim()}`);
  return 1;
};

/** Spec §4/§9: exit 5 means the label is still draining; bootout and retry until the deadline. */
async function bootstrap(ctx: ServiceContext, dom: string): Promise<number> {
  const deadline = ctx.now() + ctx.bootstrapDeadlineMs;
  for (;;) {
    const r = launchctl(ctx, ["bootstrap", dom, ctx.paths.plistFile]);
    if (r.code === 0) return 0;
    if (r.code !== 5 || ctx.now() >= deadline) return failed(ctx, "bootstrap", r);
    launchctl(ctx, ["bootout", target(ctx, dom)]);
    await ctx.sleep(500);
  }
}

function printState(ctx: ServiceContext, dom: string): ManagerState {
  const r = launchctl(ctx, ["print", target(ctx, dom)]);
  if (r.code !== 0) return { loaded: false, state: "not loaded", pid: null };
  const pid = /^\s*pid = (\d+)$/m.exec(r.stdout)?.[1];
  return { loaded: true, state: /^\s*state = (.+)$/m.exec(r.stdout)?.[1]?.trim() ?? "unknown", pid: pid === undefined ? null : Number(pid) };
}

export const launchd: ServiceManager = {
  kind: "launchd",
  async install(ctx) {
    ensurePrivateDir(dirname(ctx.paths.plistFile));
    writePrivateFile(ctx.paths.plistFile, renderPlist(ctx.paths));
    const dom = domain(ctx);
    launchctl(ctx, ["bootout", target(ctx, dom)]); // spec §4: errors ignored -- nothing may be loaded yet
    const enabled = launchctl(ctx, ["enable", target(ctx, dom)]);
    if (enabled.code !== 0) return failed(ctx, "enable", enabled);
    return bootstrap(ctx, dom);
  },
  async start(ctx) {
    const dom = domain(ctx);
    const r = launchctl(ctx, ["kickstart", target(ctx, dom)]);
    if (r.code === 0) return 0;
    if (LAUNCHD_NOT_LOADED.has(r.code)) return bootstrap(ctx, dom);
    return failed(ctx, "kickstart", r);
  },
  async stop(ctx) {
    const r = launchctl(ctx, ["bootout", target(ctx, domain(ctx))]);
    if (r.code === 0) return 0;
    if (LAUNCHD_NOT_LOADED.has(r.code)) { ctx.out("orca panel: not loaded; nothing to stop"); return 0; }
    return failed(ctx, "bootout", r);
  },
  async restart(ctx) {
    const dom = domain(ctx);
    const wanted = renderPlist(ctx.paths);
    if (readTextOrNull(ctx.paths.plistFile) === wanted) {
      const r = launchctl(ctx, ["kickstart", "-k", target(ctx, dom)]);
      if (r.code === 0) return 0;
      if (LAUNCHD_NOT_LOADED.has(r.code)) return bootstrap(ctx, dom);
      return failed(ctx, "kickstart -k", r);
    }
    // Spec §4/§9: kickstart -k would keep running the old plist. Rewrite, bootout, wait for the old pid, bootstrap.
    const { pid } = printState(ctx, dom);
    ensurePrivateDir(dirname(ctx.paths.plistFile));
    writePrivateFile(ctx.paths.plistFile, wanted);
    launchctl(ctx, ["bootout", target(ctx, dom)]);
    if (pid !== null && !(await waitExit(ctx, pid))) {
      ctx.err(`orca panel: pid ${pid} did not exit within ${ctx.exitWaitMs} ms after bootout; not bootstrapping over it`);
      return 1;
    }
    return bootstrap(ctx, dom);
  },
  state(ctx) { return printState(ctx, domain(ctx)); },
  logs: tailLogs,
  async uninstall(ctx) {
    const r = launchctl(ctx, ["bootout", target(ctx, domain(ctx))]);
    if (r.code !== 0 && !LAUNCHD_NOT_LOADED.has(r.code)) return failed(ctx, "bootout", r);
    rmSync(ctx.paths.plistFile, { force: true });
    rmSync(ctx.paths.runScript, { force: true });
    return 0;
  },
};
