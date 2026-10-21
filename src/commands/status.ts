import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CommandIo, ParsedArgs } from "./types.js";

/**
 * CLI v2 spec §8: `orca status`, and the checks `orca doctor` shares. Each check is one injectable function that reads
 * and never writes, starts or fixes anything; its modules load on demand so `orca panel …` never pays for them.
 */
export interface StatusCheck { level: "ok" | "warn" | "fail"; subject: string; fact: string; fix?: string }
export interface CheckContext { env: NodeJS.ProcessEnv; stateDirFlag?: string; checkout: string }
export type Check = (ctx: CheckContext) => Promise<StatusCheck>;

/** The Orca checkout this CLI runs from: the nearest directory above this module holding a package.json. */
export function cliCheckout(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, "package.json")) && dirname(dir) !== dir) dir = dirname(dir);
  return dir;
}

const homeOf = (env: NodeJS.ProcessEnv): string => (env.HOME !== undefined && env.HOME.length > 0 ? env.HOME : homedir());
export const packageVersion = (checkout: string): string =>
  (JSON.parse(readFileSync(join(checkout, "package.json"), "utf8")) as { version: string }).version;
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The service manager's view: installed or not, and its state (launchctl print / systemctl show; read-only). */
export async function serviceCheck(ctx: CheckContext): Promise<StatusCheck> {
  const { servicePaths } = await import("../service/paths.js");
  const { installedFile, selectManager } = await import("../service/command.js");
  const { defaultContext } = await import("../service/manager.js");
  const { runTool } = await import("../service/tools.js");
  const paths = servicePaths(ctx.env);
  const { manager } = selectManager({ env: ctx.env, platform: process.platform, detach: false, run: runTool, uid: process.getuid?.() ?? 0 });
  const file = installedFile(manager.kind, paths);
  if (!existsSync(file)) return { level: "warn", subject: "service", fact: `not installed (no ${file}); a panel may still run by hand`, fix: "orca panel install" };
  const state = manager.state(defaultContext(ctx.env, paths, { stdout: () => undefined, stderr: () => undefined }));
  if (!state.loaded) return { level: "warn", subject: "service", fact: `${manager.kind}: installed, not loaded`, fix: "orca panel start" };
  return { level: "ok", subject: "service", fact: `${manager.kind} ${state.state} pid=${state.pid ?? "-"}` };
}

/** Is the panel answering on its control socket. A GET, never a start. */
export async function panelSocketCheck(ctx: CheckContext): Promise<StatusCheck> {
  const { discoverSocketPath } = await import("../entry/discovery.js");
  const { requestOverSocket } = await import("../entry/socketClient.js");
  const { EntryRejection } = await import("../entry/envelope.js");
  try {
    const socketPath = discoverSocketPath({ stateDirFlag: ctx.stateDirFlag, env: ctx.env });
    const { status, body } = await requestOverSocket({ socketPath, method: "GET", path: "summary", client: "cli", timeoutMs: 10_000 });
    if (status !== 200) return { level: "fail", subject: "panel", fact: `${socketPath} answered ${status}`, fix: "orca panel logs" };
    const groups = (body as { groups?: unknown[] }).groups?.length ?? 0;
    return { level: "ok", subject: "panel", fact: `answering on ${socketPath} (${groups} group${groups === 1 ? "" : "s"})` };
  } catch (error) {
    if (error instanceof EntryRejection) return { level: "fail", subject: "panel", fact: `${error.code}: ${error.message}`, fix: "orca panel start (orca panel status says why it stopped)" };
    throw error;
  }
}

/** The service panel's HTTP address, as its panel.json names it: GET / answers 200. No panel.json: a panel run by hand. */
export async function panelHttpCheck(ctx: CheckContext): Promise<StatusCheck> {
  const { servicePaths } = await import("../service/paths.js");
  const { readPanelJson } = await import("../service/instance.js");
  const file = servicePaths(ctx.env).panelJson;
  const read = readPanelJson(file);
  if (read.kind === "missing") return { level: "warn", subject: "panel-http", fact: `no ${file} (only the service panel writes one)` };
  if (read.kind === "invalid") return { level: "fail", subject: "panel-http", fact: `${file}: ${read.reason}`, fix: "orca panel restart" };
  try {
    const response = await fetch(`${read.body.url}/`, { signal: AbortSignal.timeout(5_000) });
    if (response.status === 200) return { level: "ok", subject: "panel-http", fact: `${read.body.url} answers (version ${read.body.version})` };
    return { level: "fail", subject: "panel-http", fact: `${read.body.url} answered ${response.status}`, fix: "orca panel logs" };
  } catch (error) {
    return { level: "fail", subject: "panel-http", fact: `${read.body.url}: ${message(error)}`, fix: "orca panel status" };
  }
}

/** The control store's schema version (opened read-only) against the one this CLI's code writes. */
export async function schemaCheck(ctx: CheckContext): Promise<StatusCheck> {
  const { discoverSocketPath } = await import("../entry/discovery.js");
  const { schemaVersion } = await import("../control/migrations.js");
  let stateDir: string;
  try { stateDir = dirname(discoverSocketPath({ stateDirFlag: ctx.stateDirFlag, env: ctx.env })); }
  catch (error) { return { level: "warn", subject: "schema", fact: `no control state directory found (${message(error)})` }; }
  const file = join(stateDir, "control.sqlite");
  if (!existsSync(file)) return { level: "warn", subject: "schema", fact: `no control store at ${file} yet; this CLI writes schema ${schemaVersion}` };
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(file, { readOnly: true });
  let stored: string;
  try { stored = String((db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get() as { value?: unknown } | undefined)?.value ?? ""); }
  finally { db.close(); }
  if (stored === schemaVersion) return { level: "ok", subject: "schema", fact: `control schema ${stored} (${file})` };
  if (Number(stored) < Number(schemaVersion)) return { level: "warn", subject: "schema", fact: `store ${stored}, CLI ${schemaVersion}: the panel migrates it on its next start`, fix: "orca panel restart" };
  return { level: "fail", subject: "schema", fact: `store ${stored} is not this CLI's ${schemaVersion} (${file})`, fix: "update this Orca checkout (git pull, npm install, npm run build)" };
}

/** The agents table: present, JSON, a ccloop-agents-table-v1 document. */
export async function agentsTableCheck(ctx: CheckContext): Promise<StatusCheck> {
  const { agentsTablePath } = await import("../agents/paths.js");
  const table = agentsTablePath(ctx.env);
  if (!existsSync(table)) return { level: "warn", subject: "agents", fact: `no agents table at ${table}`, fix: "orca agent init" };
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(table, "utf8")); }
  catch (error) { return { level: "fail", subject: "agents", fact: `${table} is not JSON (${message(error)})`, fix: `orca agent init writes a draft beside ${table}; compare and fix the table by hand` }; }
  const schema = (parsed as { schema?: unknown } | null)?.schema;
  if (schema !== "ccloop-agents-table-v1") return { level: "fail", subject: "agents", fact: `${table} is not a ccloop-agents-table-v1 table (schema ${JSON.stringify(schema ?? null)})`, fix: `orca agent init writes a draft beside ${table}; compare and fix the table by hand` };
  const installations = (parsed as { installations?: unknown }).installations;
  return { level: "ok", subject: "agents", fact: `${table}${Array.isArray(installations) ? ` (${installations.length} installation${installations.length === 1 ? "" : "s"})` : ""}` };
}

const pinOf = (spec: string | undefined): string | null => spec?.match(/#([0-9a-f]{7,40})$/)?.[1] ?? null;

/** The ccloop commit package.json pins against the one installed in node_modules (npm's lockfile entry for it). */
export async function ccloopPinCheck(ctx: CheckContext): Promise<StatusCheck> {
  const manifest = JSON.parse(readFileSync(join(ctx.checkout, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
  const pinned = pinOf(manifest.dependencies?.ccloop);
  let installed: string | null;
  try { installed = pinOf((JSON.parse(readFileSync(join(ctx.checkout, "node_modules", ".package-lock.json"), "utf8")) as { packages?: Record<string, { resolved?: string }> }).packages?.["node_modules/ccloop"]?.resolved); }
  catch { installed = null; }
  const override = ctx.env.ORCA_CCLOOP_BIN !== undefined && ctx.env.ORCA_CCLOOP_BIN.length > 0 ? `; ORCA_CCLOOP_BIN=${ctx.env.ORCA_CCLOOP_BIN} overrides it` : "";
  if (pinned === null) return { level: "fail", subject: "ccloop", fact: "package.json pins no ccloop commit", fix: "node scripts/pin-ccloop.mjs <commit>" };
  if (installed === null) return { level: "fail", subject: "ccloop", fact: `pinned ${pinned.slice(0, 7)}, none installed under ${join(ctx.checkout, "node_modules")}${override}`, fix: "npm install" };
  if (installed !== pinned) return { level: "fail", subject: "ccloop", fact: `pinned ${pinned.slice(0, 7)}, installed ${installed.slice(0, 7)}${override}`, fix: "npm install" };
  return { level: "ok", subject: "ccloop", fact: `${pinned.slice(0, 7)} pinned and installed${override}` };
}

/** ORCA_CCMEM_BIN: unset is a warning (memory off); set, it must be an absolute executable file. */
export async function ccmemCheck(ctx: CheckContext): Promise<StatusCheck> {
  const bin = ctx.env.ORCA_CCMEM_BIN;
  if (bin === undefined || bin.length === 0) return { level: "warn", subject: "ccmem", fact: "ORCA_CCMEM_BIN is not set; memory features are off" };
  if (!isAbsolute(bin)) return { level: "fail", subject: "ccmem", fact: `ORCA_CCMEM_BIN=${bin} is not an absolute path`, fix: "set ORCA_CCMEM_BIN to the ccmem binary's absolute path" };
  try { accessSync(bin, constants.X_OK); }
  catch (error) { return { level: "fail", subject: "ccmem", fact: `ORCA_CCMEM_BIN=${bin}: ${message(error)}`, fix: "build ccmem, or point ORCA_CCMEM_BIN at its binary" }; }
  return { level: "ok", subject: "ccmem", fact: `${bin} is executable` };
}

/** Where agents load the orca-control skill from (Claude Code, the shared agents dir, Codex). */
export const skillCopies = (env: NodeJS.ProcessEnv): string[] =>
  [".claude", ".agents", ".codex"].map((dir) => join(homeOf(env), dir, "skills", "orca-control", "SKILL.md"));

export const frontmatterVersion = (text: string): string | null =>
  text.match(/^---\n([\s\S]*?)\n---/)?.[1]?.match(/^version:\s*(\S+)\s*$/m)?.[1] ?? null;

/** Spec §8: every installed skill copy's frontmatter `version:` against this CLI's package version. */
export async function skillCheck(ctx: CheckContext): Promise<StatusCheck> {
  const cli = packageVersion(ctx.checkout);
  const candidates = skillCopies(ctx.env);
  const found = candidates.filter((path) => existsSync(path));
  const source = join(ctx.checkout, "skills", "orca-control");
  if (found.length === 0) return { level: "warn", subject: "skill", fact: `no installed orca-control skill found (looked in ${candidates.map((path) => dirname(path)).join(", ")})`, fix: `link ${source} into your agent's skills directory` };
  const wrong = found.map((path) => ({ path, version: frontmatterVersion(readFileSync(path, "utf8")) })).filter((copy) => copy.version !== cli);
  if (wrong.length > 0) {
    return {
      level: "fail", subject: "skill",
      fact: `${wrong.map((copy) => `${copy.path} is version ${copy.version ?? "(none)"}`).join("; ")}; the CLI is ${cli}`,
      fix: `replace it with ${source} (a link keeps it current)`,
    };
  }
  return { level: "ok", subject: "skill", fact: `${found.join(", ")} at ${cli}` };
}

export const STATUS_CHECKS: readonly Check[] = [serviceCheck, panelSocketCheck, panelHttpCheck, schemaCheck, agentsTableCheck, ccloopPinCheck, ccmemCheck, skillCheck];

/** Every check in order; one that throws is a fail by name, never a crash of the whole screen. */
export async function runChecks(checks: readonly Check[], ctx: CheckContext): Promise<StatusCheck[]> {
  const results: StatusCheck[] = [];
  for (const check of checks) {
    try { results.push(await check(ctx)); }
    catch (error) { results.push({ level: "fail", subject: "check", fact: `${check.name || "a check"} threw: ${message(error)}` }); }
  }
  return results;
}

export const contextOf = (args: ParsedArgs, io: CommandIo): CheckContext =>
  ({ env: io.env, checkout: cliCheckout(), ...(args.global.controlStateDir === undefined ? {} : { stateDirFlag: args.global.controlStateDir }) });

/** Spec §8: one line per check, `ok|warn|fail <subject>: <fact>`, plus (doctor) one fix line per failure; exit 1 on any fail. */
export function report(results: readonly StatusCheck[], args: ParsedArgs, io: CommandIo, schema: string, fixes: boolean): number {
  const code = results.some((check) => check.level === "fail") ? 1 : 0;
  if (args.global.json) {
    io.stdout(`${JSON.stringify({ schema: "orca-cli-response-v1", status: 200, body: { schema, checks: results } })}\n`);
    return code;
  }
  if (args.global.quiet && code === 0) return code;
  const lines: string[] = [];
  for (const check of results) {
    lines.push(`${check.level} ${check.subject}: ${check.fact}\n`);
    if (fixes && check.level === "fail") lines.push(`  fix: ${check.fix ?? "no known fix; the fact above names what is wrong"}\n`);
  }
  io.stdout(lines.join(""));
  return code;
}

export async function runStatus(args: ParsedArgs, io: CommandIo, checks: readonly Check[] = STATUS_CHECKS): Promise<number> {
  const results = await runChecks(checks, contextOf(args, io));
  // Fix advice is doctor's; status keeps its one-line-per-check shape.
  return report(results.map(({ fix: _fix, ...rest }) => rest), args, io, "orca-status-v1", false);
}

/** `orca version`: the CLI's package version. */
export async function runVersion(args: ParsedArgs, io: CommandIo): Promise<number> {
  const version = packageVersion(cliCheckout());
  io.stdout(args.global.json ? `${JSON.stringify({ schema: "orca-cli-response-v1", status: 200, body: { schema: "orca-version-v1", version } })}\n` : `orca ${version}\n`);
  return 0;
}
