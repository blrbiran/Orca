import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildServiceConfig } from "./config.js";
import { detached } from "./detached.js";
import { readServiceConfig, tailLines, writeServiceFiles } from "./files.js";
import { identifyPanel } from "./identify.js";
import type { PanelJsonV1 } from "./instance.js";
import { launchd } from "./launchd.js";
import { defaultContext, type ServiceContext, type ServiceIo, type ServiceManager } from "./manager.js";
import { servicePaths, type ServicePaths } from "./paths.js";
import { ServiceRejection } from "./rejection.js";
import { renderPlist, renderRunSh, renderServiceEnv, renderUnit } from "./render.js";
import { statusLines } from "./status.js";
import { realRuntimeProbe, systemd, systemdEnv } from "./systemd.js";
import { runTool, type RunTool } from "./tools.js";

export { SERVICE_SUBCOMMANDS } from "./subcommands.js";
const MANAGERS: Record<string, ServiceManager> = { launchd, systemd, detached };

export function selectManager(input: { env: NodeJS.ProcessEnv; platform: NodeJS.Platform; detach: boolean; run: RunTool; uid: number }): { manager: ServiceManager; auto: boolean } {
  const forced = input.env.ORCA_SERVICE_MANAGER;
  if (forced !== undefined && forced !== "") {
    const manager = MANAGERS[forced];
    if (manager === undefined) throw new ServiceRejection("service-manager-invalid", `ORCA_SERVICE_MANAGER=${forced}: want launchd, systemd or detached`);
    return { manager, auto: false };
  }
  if (input.detach) return { manager: detached, auto: false };
  if (input.platform === "darwin") return { manager: launchd, auto: true };
  if (input.platform === "linux") {
    const answer = input.run("systemctl", ["--user", "show-environment"], { env: systemdEnv(input.env, input.uid, realRuntimeProbe) });
    return { manager: answer.code === 0 ? systemd : detached, auto: true };
  }
  throw new ServiceRejection("service-platform-unsupported", `orca panel services run on macOS and Linux, not ${input.platform}`);
}

/** Plan D14: with no manager found, the person types --detach, accepting no restart and no reboot survival. */
export function startNeedsDetach(kind: ServiceManager["kind"], auto: boolean, detach: boolean): boolean {
  return kind === "detached" && auto && !detach;
}

/** What `status` calls installed: the manager's own file, never systemd's `loaded` (`systemctl show` exits 0 for a missing unit). */
export function installedFile(kind: ServiceManager["kind"], paths: ServicePaths): string {
  return kind === "launchd" ? paths.plistFile : kind === "systemd" ? paths.unitFile : paths.runScript;
}

const defaultCheckout = (): string => join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function parseLogs(args: string[]): { follow: boolean; lines: number } {
  let follow = false, lines = 200;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "-f") { follow = true; continue; }
    if (args[i] === "-n" && /^[1-9]\d{0,5}$/.test(args[i + 1] ?? "")) { lines = Number(args[i + 1]); i += 1; continue; }
    throw new ServiceRejection("service-argument-invalid", `orca panel logs takes -f and -n <lines>, not ${JSON.stringify(args[i])}`);
  }
  return { follow, lines };
}

/**
 * Spec §9: a manager's exit code says the job was submitted, not that the panel runs. Wait for the panel panel.json
 * names to answer a real request; after an install or a restart, the panel from before it does not count.
 */
async function waitForPanel(ctx: ServiceContext, kind: string, verb: string, before: PanelJsonV1 | null): Promise<number> {
  const deadline = ctx.now() + ctx.startWaitMs;
  for (;;) {
    const id = await identifyPanel(ctx.paths.panelJson);
    const old = id.answering && before !== null && id.panel.pid === before.pid && id.panel.startTime === before.startTime;
    if (id.answering && !old) { ctx.out(`orca panel: answering at ${id.panel.url} (pid ${id.panel.pid})`); return 0; }
    if (ctx.now() >= deadline) {
      const why = id.answering ? `only the panel from before the ${verb} (pid ${id.panel.pid}) answered` : id.reason;
      ctx.err(`orca panel: ${kind} accepted ${verb}, but no panel answered through ${ctx.paths.panelJson} within ${ctx.startWaitMs} ms (${why}); see orca panel status and orca panel logs`);
      return 1;
    }
    await ctx.sleep(200);
  }
}

export interface ServiceSeams { ctx?: Partial<ServiceContext>; platform?: NodeJS.Platform }

export async function runServiceCommand(sub: string, args: string[], env: NodeJS.ProcessEnv, io: ServiceIo, seams: ServiceSeams = {}): Promise<number> {
  try {
    const paths = servicePaths(env);
    const ctx: ServiceContext = { ...defaultContext(env, paths, io), ...seams.ctx };
    const detach = sub === "start" && args.includes("--detach");
    const rest = sub === "install" ? args.filter((a) => a !== "--dry-run") : args.filter((a) => !(sub === "start" && a === "--detach"));
    if (sub !== "install" && sub !== "logs" && rest.length > 0) throw new ServiceRejection("service-argument-invalid", `orca panel ${sub} takes no ${JSON.stringify(rest[0])}`);
    const { manager, auto } = selectManager({ env, platform: seams.platform ?? process.platform, detach, run: ctx.run, uid: ctx.uid });
    // The detached manager waits for its own child's pid itself; it starts nothing on install.
    const confirm = (verb: string, code: number, before: PanelJsonV1 | null = null): Promise<number> =>
      code !== 0 || manager.kind === "detached" ? Promise.resolve(code) : waitForPanel(ctx, manager.kind, verb, before);
    switch (sub) {
      case "install": {
        const { config, warnings } = buildServiceConfig({
          // config.ts does not check these: a relative checkout would put a relative entry into run.sh.
          args: rest, env, execPath: process.execPath, checkout: resolve(env.ORCA_SERVICE_CHECKOUT || defaultCheckout()), home: homedir(), panelDir: paths.panelDir,
        });
        for (const warning of warnings) ctx.err(`orca panel: warning: ${warning}`);
        if (args.includes("--dry-run")) {
          const files: Array<[string, string]> = [[paths.configFile, `${JSON.stringify(config, null, 2)}\n`], [paths.envFile, renderServiceEnv(config)], [paths.runScript, renderRunSh(config, paths)]];
          if (manager.kind === "launchd") files.push([paths.plistFile, renderPlist(paths)]);
          if (manager.kind === "systemd") files.push([paths.unitFile, renderUnit(config, paths)]);
          for (const [path, text] of files) io.stdout(`--- ${path}\n${text}`);
          return 0;
        }
        writeServiceFiles(paths, config);
        const before = await identifyPanel(paths.panelJson);
        const code = await manager.install(ctx);
        if (code !== 0) {
          // Spec §9: no rollback in v1. Re-running install is idempotent and is the way out.
          ctx.err(`orca panel: install did not finish: the files under ${paths.panelDir} are written but the service may not be loaded. Fix the error above, then re-run orca panel install`);
          return 1;
        }
        return confirm("install", code, before.answering ? before.panel : null);
      }
      case "start":
        if (startNeedsDetach(manager.kind, auto, detach)) throw new ServiceRejection("service-detach-required", "no service manager here; orca panel start --detach starts a process that neither restarts on crash nor survives a reboot");
        return confirm("start", await manager.start(ctx));
      case "stop": return manager.stop(ctx);
      case "restart": {
        writeServiceFiles(paths, readServiceConfig(paths)); // plan D20
        const now = await identifyPanel(paths.panelJson);
        return confirm("restart", await manager.restart(ctx), now.answering ? now.panel : null);
      }
      case "status": {
        const file = installedFile(manager.kind, paths);
        if (!existsSync(file)) throw new ServiceRejection("service-not-installed", `${file} does not exist; orca panel install installs the service`);
        const s = statusLines(manager.kind, manager.state(ctx), await identifyPanel(paths.panelJson), manager.kind === "systemd" ? [] : tailLines(paths.errLog, 5), paths.errLog);
        for (const line of s.lines) ctx.out(line);
        return s.code;
      }
      // Managers return the tool's raw code (130 on Ctrl-C under -f); this command answers 0 or 1.
      case "logs": return manager.logs(ctx, parseLogs(rest)) === 0 ? 0 : 1;
      case "uninstall": return manager.uninstall(ctx);
      default: throw new ServiceRejection("service-argument-invalid", `unknown orca panel subcommand ${sub}`);
    }
  } catch (error) {
    if (error instanceof ServiceRejection) { io.stderr(`rejected: ${error.code}: ${error.message}\n`); return 1; }
    throw error;
  }
}
