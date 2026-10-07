import { readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { PanelRejection } from "../panel/rejection.js";
import { panelArgsWithDefaultProjects, parsePanelArgs } from "../panel/server.js";
import { ServiceRejection } from "./rejection.js";

/** Spec §3 plus plan D3: the only variables taken from the installing shell. Every one of them is a path. */
export const CAPTURED_ENV = [
  "ORCA_AGENTS_TABLE", "ORCA_CCMEM_BIN", "ORCA_SYNCSKILL_BIN", "ORCA_CCLOOP_BIN", "ORCA_CONTROL_DIR",
  "SYNCSKILL_DIR", "CCMEM_DATA_ROOT", "ORCA_CORRECTIONS_DIR", "ORCA_PROJECTS_FILE",
] as const;
export const SYSTEM_PATH_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
export const SERVICE_CONFIG_SCHEMA = "orca-panel-service-v1";

export interface ServiceConfigV1 { schema: typeof SERVICE_CONFIG_SCHEMA; node: string; entry: string; args: string[]; env: Record<string, string> }
export interface ServiceConfigInput {
  args: string[]; env: NodeJS.ProcessEnv; execPath: string; checkout: string; home: string; panelDir: string;
  isDirectory?: (path: string) => boolean;
}

/** Plan D6: flags whose value is (or ends in) a path. */
const PATH_FLAGS = new Set(["--repo", "--root", "--profile", "--projects-file", "--control-state-dir", "--dist", "--plan"]);
const pathOf = (flag: string, value: string): string =>
  flag === "--repo" ? value.slice(value.indexOf("=") + 1) : flag === "--plan" ? value.split("=").slice(2).join("=") : value;
const VERSION_MANAGER = /\/(\.nvm|\.fnm|fnm|\.volta|\.asdf)\//;

const defaultIsDirectory = (path: string): boolean => { try { return statSync(path).isDirectory(); } catch { return false; } };

export function buildServiceConfig(input: ServiceConfigInput): { config: ServiceConfigV1; warnings: string[] } {
  const { args } = input;
  if (args.includes("--service")) throw new ServiceRejection("service-argument-reserved", "--service is added by the service itself; leave it out");
  for (let i = 0; i < args.length; i += 1) {
    const value = args[i + 1];
    if (PATH_FLAGS.has(args[i]!) && value !== undefined && !isAbsolute(pathOf(args[i]!, value))) {
      throw new ServiceRejection("service-path-not-absolute", `${args[i]} ${value}: the service does not run in this shell's directory; give an absolute path`);
    }
  }
  if (!isAbsolute(input.panelDir)) throw new ServiceRejection("service-path-not-absolute", `ORCA_PANEL_DIR=${input.panelDir}: give an absolute path`);
  // Plan D7: the panel's own parser, so install refuses exactly what the service would refuse at every start.
  try { parsePanelArgs(panelArgsWithDefaultProjects(args, input.env), input.env); }
  catch (error) {
    if (error instanceof PanelRejection) throw new ServiceRejection("service-panel-args-invalid", `${error.code}: ${error.message}`);
    throw error;
  }
  const env: Record<string, string> = {};
  for (const name of CAPTURED_ENV) {
    const value = input.env[name];
    if (value === undefined || value === "") continue;
    if (!isAbsolute(value)) throw new ServiceRejection("service-path-not-absolute", `${name}=${value}: the service does not run in this shell's directory; give an absolute path`);
    env[name] = value;
  }
  const isDirectory = input.isDirectory ?? defaultIsDirectory;
  const pathDirs = [dirname(input.execPath), ...SYSTEM_PATH_DIRS].filter((dir, index, all) => all.indexOf(dir) === index && isDirectory(dir));
  env.HOME = input.home;
  env.PATH = pathDirs.join(":");
  env.NODE_OPTIONS = "";
  env.ORCA_PANEL_DIR = input.panelDir;
  const sorted = Object.fromEntries(Object.keys(env).sort().map((key) => [key, env[key]!]));
  const entry = checkDist(input.checkout);
  const warnings = VERSION_MANAGER.test(input.execPath)
    ? [`node ${input.execPath} is managed by a version manager; uninstalling that version stops the service. Re-run orca panel install after changing node.`]
    : [];
  return { config: { schema: SERVICE_CONFIG_SCHEMA, node: input.execPath, entry, args: [...args], env: sorted }, warnings };
}

/** Spec §3: the service runs the built dist/cli.js; a missing or stale build is refused by name. */
export function checkDist(checkout: string): string {
  const entry = join(checkout, "dist", "cli.js");
  let built: number;
  try { built = statSync(entry).mtimeMs; }
  catch { throw new ServiceRejection("service-dist-missing", `${entry} does not exist; run npm run build in ${checkout}`); }
  for (const item of readdirSync(join(checkout, "src"), { withFileTypes: true, recursive: true })) {
    if (!item.isFile() || !item.name.endsWith(".ts")) continue;
    const file = join(item.parentPath, item.name);
    if (statSync(file).mtimeMs > built) throw new ServiceRejection("service-dist-stale", `${file} is newer than ${entry}; run npm run build in ${checkout}`);
  }
  return entry;
}
