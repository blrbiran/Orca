import { accessSync, closeSync, constants, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
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
  /** The agents table's text, or null when it cannot be read. A seam so a criterion never reads the real ~/.orca. */
  readTable?: (path: string) => string | null;
}

/** Plan D6: flags whose value is (or ends in) a path. */
const PATH_FLAGS = new Set(["--repo", "--root", "--profile", "--projects-file", "--control-state-dir", "--dist", "--plan"]);
const pathOf = (flag: string, value: string): string =>
  flag === "--repo" ? value.slice(value.indexOf("=") + 1) : flag === "--plan" ? value.split("=").slice(2).join("=") : value;
const VERSION_MANAGER = /\/(\.nvm|\.fnm|fnm|\.volta|\.asdf)\//;

const defaultIsDirectory = (path: string): boolean => { try { return statSync(path).isDirectory(); } catch { return false; } };
const defaultReadTable = (path: string): string | null => { try { return readFileSync(path, "utf8"); } catch { return null; } };
const isExecutableFile = (path: string): boolean => {
  try { accessSync(path, constants.X_OK); return statSync(path).isFile(); } catch { return false; }
};
/** The first line of a file, read from its first 256 bytes only: an agent command can be a large native binary. */
function firstLine(path: string): string {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const buffer = Buffer.alloc(256);
    return buffer.subarray(0, readSync(fd, buffer, 0, buffer.length, 0)).toString("latin1").split("\n")[0]!;
  } catch { return ""; } finally { if (fd !== undefined) closeSync(fd); }
}

/**
 * Issue #72: the directories the agents the service will run need on PATH. Each absolute agent command's own directory,
 * and, for a `#!/usr/bin/env <name>` script, the directory the installing shell's PATH resolves <name> to (omp is
 * `#!/usr/bin/env bun` under ~/.bun/bin). Never the shell's whole PATH: the service must not depend on whatever the
 * installing terminal happened to carry.
 */
function agentPathDirs(tablePath: string, shellPath: string, readTable: (path: string) => string | null): { dirs: string[]; warnings: string[] } {
  const text = readTable(tablePath);
  let installations: unknown;
  try { installations = text === null ? undefined : (JSON.parse(text) as { installations?: unknown }).installations; } catch { installations = undefined; }
  if (installations === null || typeof installations !== "object") {
    return { dirs: [], warnings: [`agents table ${tablePath} could not be read as an agents table; the service PATH carries no agent directories. Re-run orca panel install once it can.`] };
  }
  const searched = shellPath.split(":").filter((dir) => isAbsolute(dir));
  const dirs: string[] = [], warnings: string[] = [];
  for (const [id, installation] of Object.entries(installations as Record<string, unknown>)) {
    const command = (installation as { command?: unknown } | null)?.command;
    const executable = Array.isArray(command) ? command[0] : undefined;
    if (typeof executable !== "string" || !isAbsolute(executable)) continue;
    dirs.push(dirname(executable));
    const name = /^#!\s*\/usr\/bin\/env\s+([^\s/-][^\s/]*)/.exec(firstLine(executable))?.[1];
    if (name === undefined) continue;
    const found = searched.find((dir) => isExecutableFile(join(dir, name)));
    if (found !== undefined) dirs.push(found);
    else warnings.push(`agent ${id}: ${executable} starts with #!/usr/bin/env ${name}, but ${name} is not on this shell's PATH; the service PATH leaves it out and ${id} will fail to start under the service`);
  }
  return { dirs, warnings };
}

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
  const agents = env.ORCA_AGENTS_TABLE === undefined
    ? { dirs: [], warnings: [] }
    : agentPathDirs(env.ORCA_AGENTS_TABLE, input.env.PATH ?? "", input.readTable ?? defaultReadTable);
  const pathDirs = [dirname(input.execPath), ...agents.dirs, ...SYSTEM_PATH_DIRS].filter((dir, index, all) => all.indexOf(dir) === index && isDirectory(dir));
  env.HOME = input.home;
  env.PATH = pathDirs.join(":");
  env.NODE_OPTIONS = "";
  env.ORCA_PANEL_DIR = input.panelDir;
  const sorted = Object.fromEntries(Object.keys(env).sort().map((key) => [key, env[key]!]));
  const entry = checkDist(input.checkout);
  const warnings = VERSION_MANAGER.test(input.execPath)
    ? [`node ${input.execPath} is managed by a version manager; uninstalling that version stops the service. Re-run orca panel install after changing node.`]
    : [];
  warnings.push(...agents.warnings);
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
