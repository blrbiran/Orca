import { userInfo } from "node:os";
import type { ServicePaths } from "./paths.js";
import { isProcessAlive, processStartTime } from "./processInfo.js";
import { runTool, type RunTool } from "./tools.js";

export interface ServiceIo { stdout(text: string): void; stderr(text: string): void }
export interface ManagerState { loaded: boolean; state: string; pid: number | null }
export interface ServiceContext {
  paths: ServicePaths; env: NodeJS.ProcessEnv; run: RunTool; uid: number; user: string;
  out(line: string): void; err(line: string): void;
  sleep(ms: number): Promise<void>; now(): number;
  isAlive(pid: number): boolean; startTimeOf(pid: number): string | null;
  bootstrapDeadlineMs: number; exitWaitMs: number; startWaitMs: number;
}
export interface ServiceManager {
  readonly kind: "launchd" | "systemd" | "detached";
  install(ctx: ServiceContext): Promise<number>;   // service.json/env/run.sh already written by the caller
  start(ctx: ServiceContext): Promise<number>;
  stop(ctx: ServiceContext): Promise<number>;
  restart(ctx: ServiceContext): Promise<number>;   // service.env/run.sh already re-rendered by the caller (D20)
  state(ctx: ServiceContext): ManagerState;
  logs(ctx: ServiceContext, opts: { follow: boolean; lines: number }): number;
  uninstall(ctx: ServiceContext): Promise<number>;
}

/** Polls until the pid is gone or ctx.exitWaitMs passes (spec §4: ExitTimeOut 20 s + 10 s). */
export async function waitExit(ctx: ServiceContext, pid: number): Promise<boolean> {
  const deadline = ctx.now() + ctx.exitWaitMs;
  while (ctx.isAlive(pid)) {
    if (ctx.now() >= deadline) return false;
    await ctx.sleep(200);
  }
  return true;
}

/** The launchd and detached managers' logs: both write the same two files, so both tail them the same way. */
export function tailLogs(ctx: ServiceContext, opts: { follow: boolean; lines: number }): number {
  return ctx.run("tail", ["-n", String(opts.lines), ...(opts.follow ? ["-F"] : []), ctx.paths.outLog, ctx.paths.errLog], { env: ctx.env, inherit: true }).code;
}

export function defaultContext(env: NodeJS.ProcessEnv, paths: ServicePaths, io: ServiceIo): ServiceContext {
  return {
    paths, env, run: runTool as RunTool,
    uid: process.getuid?.() ?? 0,
    user: env.USER !== undefined && env.USER.length > 0 ? env.USER : userInfo().username,
    out: (line) => io.stdout(`${line}\n`), err: (line) => io.stderr(`${line}\n`),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now: () => Date.now(),
    isAlive: isProcessAlive, startTimeOf: processStartTime,
    bootstrapDeadlineMs: 30_000, exitWaitMs: 30_000, startWaitMs: 30_000,
  };
}
