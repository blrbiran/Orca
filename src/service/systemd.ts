import { existsSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { ensurePrivateDir, readServiceConfig, readTextOrNull, writePrivateFile } from "./files.js";
import type { ManagerState, ServiceContext, ServiceManager } from "./manager.js";
import { renderUnit } from "./render.js";

export interface RuntimeProbe { ownerOf(path: string): number | null; exists(path: string): boolean }
export const realRuntimeProbe: RuntimeProbe = {
  ownerOf: (path) => { try { return statSync(path).uid; } catch { return null; } },
  exists: existsSync,
};

/** Spec §4 preflight: services and ssh sessions often lack the user manager's runtime dir and bus. */
export function systemdEnv(env: NodeJS.ProcessEnv, uid: number, probe: RuntimeProbe): NodeJS.ProcessEnv {
  const out = { ...env };
  const runtime = env.XDG_RUNTIME_DIR;
  if (runtime === undefined || runtime === "" || probe.ownerOf(runtime) !== uid) out.XDG_RUNTIME_DIR = `/run/user/${uid}`;
  const bus = join(out.XDG_RUNTIME_DIR!, "bus");
  if ((out.DBUS_SESSION_BUS_ADDRESS ?? "") === "" && probe.exists(bus)) out.DBUS_SESSION_BUS_ADDRESS = `unix:path=${bus}`;
  return out;
}

/** Plan D18: before every systemctl --user. Without linger the panel stops at logout. Orca never runs sudo. */
function preflight(ctx: ServiceContext): NodeJS.ProcessEnv {
  const env = systemdEnv(ctx.env, ctx.uid, realRuntimeProbe);
  const linger = ctx.run("loginctl", ["show-user", ctx.user, "-p", "Linger"], { env });
  if (linger.code !== 0 || linger.stdout.trim() !== "Linger=yes") {
    const enabled = ctx.run("loginctl", ["enable-linger", ctx.user], { env });
    if (enabled.code !== 0) ctx.err(`orca panel: linger is off for ${ctx.user}, so the panel stops at logout. Run: sudo loginctl enable-linger ${ctx.user}`);
  }
  return env;
}

function systemctl(ctx: ServiceContext, env: NodeJS.ProcessEnv, args: string[]): number {
  const r = ctx.run("systemctl", ["--user", ...args], { env });
  if (r.code !== 0) ctx.err(`orca panel: systemctl --user ${args.join(" ")} exited ${r.code}: ${r.stderr.trim()}`);
  return r.code === 0 ? 0 : 1;
}

function writeUnit(ctx: ServiceContext): boolean {
  const wanted = renderUnit(readServiceConfig(ctx.paths), ctx.paths);
  if (readTextOrNull(ctx.paths.unitFile) === wanted) return false;
  ensurePrivateDir(dirname(ctx.paths.unitFile));
  writePrivateFile(ctx.paths.unitFile, wanted);
  return true;
}

export const systemd: ServiceManager = {
  kind: "systemd",
  async install(ctx) {
    writeUnit(ctx);
    const env = preflight(ctx);
    if (systemctl(ctx, env, ["daemon-reload"]) !== 0) return 1;
    return systemctl(ctx, env, ["enable", "--now", ctx.paths.unit]);
  },
  async start(ctx) { return systemctl(ctx, preflight(ctx), ["start", ctx.paths.unit]); },
  async stop(ctx) { return systemctl(ctx, preflight(ctx), ["stop", ctx.paths.unit]); },
  async restart(ctx) {
    writeUnit(ctx);
    const env = preflight(ctx);
    // Always reload: a rewrite whose reload failed must not leave the next restart on the old unit (cheap and idempotent).
    if (systemctl(ctx, env, ["daemon-reload"]) !== 0) return 1;
    return systemctl(ctx, env, ["restart", ctx.paths.unit]);
  },
  state(ctx): ManagerState {
    const r = ctx.run("systemctl", ["--user", "show", ctx.paths.unit, "-p", "ActiveState,SubState,MainPID,NRestarts"], { env: preflight(ctx) });
    if (r.code !== 0) return { loaded: false, state: "not loaded", pid: null };
    const value = (key: string): string => new RegExp(`^${key}=(.*)$`, "m").exec(r.stdout)?.[1]?.trim() ?? "";
    const pid = Number(value("MainPID"));
    return { loaded: true, state: `${value("ActiveState")}/${value("SubState")} restarts=${value("NRestarts")}`, pid: pid > 0 ? pid : null };
  },
  logs(ctx, opts) {
    return ctx.run("journalctl", ["--user", "-u", ctx.paths.unit, "-n", String(opts.lines), ...(opts.follow ? ["-f"] : [])], { env: preflight(ctx), inherit: true }).code;
  },
  async uninstall(ctx) {
    const env = preflight(ctx);
    systemctl(ctx, env, ["disable", "--now", ctx.paths.unit]); // reported, not fatal: an unloaded unit is still removed
    rmSync(ctx.paths.unitFile, { force: true });
    return systemctl(ctx, env, ["daemon-reload"]);
  },
};
