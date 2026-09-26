import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, link, lstat, mkdir, open, readdir, rename, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, parse } from "node:path";
import { createCcloopExecutionPort } from "../control/ccloopPort.js";
import { AGENTS_DIR_MODE, AGENTS_FILE_MODE, AgentsPathError, agentsTablePath, draftPathOf } from "./paths.js";

/**
 * Agent selection spec §6.7 and §8: `orca agents init|show`. The only place Orca writes the installation table,
 * which is user data outside any repository (Rule 17): the path is ORCA_AGENTS_TABLE or ~/.orca/agents.json, new
 * directories are 0700 and new files 0600 whatever the umask, an existing directory or file keeps its mode, and an
 * existing table is never overwritten -- the new detection goes to `<table>.draft.json` with a diff against it.
 * ccloop writes nothing outside the repository here; it only answers on stdout (spec §4.3).
 */
export interface AgentsIo { stdout(text: string): void; stderr(text: string): void }

const USAGE = "usage: orca agents init | orca agents show   (table: $ORCA_AGENTS_TABLE or ~/.orca/agents.json; ccloop: $ORCA_CCLOOP_BIN)\n";
const MAX_OUTPUT = 16 * 1024 * 1024;
const PORT_TIMEOUT_MS = 60_000;

class AgentsRefusal extends Error {}

function run(binary: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { encoding: "utf8", env, maxBuffer: MAX_OUTPUT, timeout: PORT_TIMEOUT_MS }, (error, stdout, stderr) => {
      if (error && typeof (error as { code?: unknown }).code !== "number") return reject(error);
      resolve({ code: error ? Number((error as { code: number }).code) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

function settings(env: NodeJS.ProcessEnv): { table: string; binary: string } {
  let table: string;
  try { table = agentsTablePath(env); } catch (error) {
    if (error instanceof AgentsPathError) throw new AgentsRefusal(error.message);
    throw error;
  }
  if (!isAbsolute(table)) throw new AgentsRefusal(`ORCA_AGENTS_TABLE must be an absolute path, got ${JSON.stringify(table)}`);
  const binary = env.ORCA_CCLOOP_BIN;
  if (binary === undefined || binary.length === 0 || !isAbsolute(binary)) throw new AgentsRefusal("ORCA_CCLOOP_BIN must name the ccloop binary by an absolute path");
  return { table, binary };
}

/** The table `ccloop agents detect` drafted, with its own schema checked; nothing else of the answer is trusted here. */
async function detectedTable(binary: string, env: NodeJS.ProcessEnv): Promise<unknown> {
  const detected = await run(binary, ["agents", "detect"], env);
  if (detected.code !== 0) throw new AgentsRefusal(`ccloop agents detect exited ${detected.code}: ${detected.stderr.trim()}`);
  let answer: { schema?: unknown; table?: { schema?: unknown } };
  try { answer = JSON.parse(detected.stdout); } catch { throw new AgentsRefusal("ccloop agents detect printed something that is not JSON"); }
  if (answer?.schema !== "ccloop-agents-detect-v1" || answer.table?.schema !== "ccloop-agents-table-v1") {
    throw new AgentsRefusal("ccloop agents detect did not answer ccloop-agents-detect-v1 with a ccloop-agents-table-v1 table");
  }
  return answer.table;
}

/** Every missing ancestor of `dir` is created 0700 and chmod-ed to it, so the umask cannot widen or narrow it. */
async function ensureDirectory(dir: string): Promise<void> {
  const missing: string[] = [];
  for (let cursor = dir; cursor !== parse(cursor).root; cursor = dirname(cursor)) {
    try { await lstat(cursor); break; } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      missing.unshift(cursor);
    }
  }
  for (const path of missing) {
    await mkdir(path, { mode: AGENTS_DIR_MODE });
    await chmod(path, AGENTS_DIR_MODE);
  }
}

const tempPattern = (table: string): RegExp => new RegExp(`^\\.${basename(table).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.orca-agents-[0-9a-f]{16}\\.tmp$`);

/**
 * spec §8: a failed init leaves at most one temporary file of its own naming pattern beside the table; the next
 * init removes those. Only regular files are removed: a symlink or directory bearing the name is not this
 * program's and is neither followed nor touched.
 */
async function removeStaleTemps(table: string): Promise<void> {
  const dir = dirname(table), pattern = tempPattern(table);
  for (const name of await readdir(dir)) {
    if (!pattern.test(name)) continue;
    const path = join(dir, name);
    if ((await lstat(path)).isFile()) await unlink(path);
  }
}

/** Written whole and 0600 into a fresh temporary file beside the table, so the final step is one atomic name change. */
async function writeTemp(table: string, bytes: string): Promise<string> {
  const temp = join(dirname(table), `.${basename(table)}.orca-agents-${randomBytes(8).toString("hex")}.tmp`);
  const handle = await open(temp, "wx", AGENTS_FILE_MODE);
  try {
    await handle.chmod(AGENTS_FILE_MODE);
    await handle.writeFile(bytes);
    await handle.sync();
  } finally { await handle.close(); }
  return temp;
}

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function init(env: NodeJS.ProcessEnv, io: AgentsIo): Promise<number> {
  const { table, binary } = settings(env);
  const bytes = `${JSON.stringify(await detectedTable(binary, env), null, 2)}\n`;
  await ensureDirectory(dirname(table));
  await removeStaleTemps(table);
  const temp = await writeTemp(table, bytes);
  if (!(await exists(table))) {
    try {
      // link, not rename: link refuses an existing name, so a table that appeared since the check is never replaced.
      await link(temp, table);
      await unlink(temp);
      io.stdout(`orca agents: wrote ${table}\n`);
      return 0;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  const draft = draftPathOf(table);
  // The draft is this program's own output; replacing it is allowed, and rename replaces a symlink, never its target.
  await rename(temp, draft);
  io.stdout(`orca agents: ${table} exists and was left unchanged; the new detection is in ${draft}\n`);
  const diff = await run("git", ["diff", "--no-index", "--no-color", "--", table, draft], env);
  if (diff.code !== 0 && diff.code !== 1) throw new AgentsRefusal(`git diff failed: ${diff.stderr.trim()}`);
  io.stdout(diff.code === 0 ? "orca agents: the draft and the table are identical\n" : diff.stdout);
  return 0;
}

async function show(env: NodeJS.ProcessEnv, io: AgentsIo): Promise<number> {
  const { table, binary } = settings(env);
  const validated = await run(binary, ["agents", "validate", table], env);
  io.stdout(`ccloop agents validate ${table} (exit ${validated.code}):\n${validated.stdout}`);
  if (validated.stderr.length > 0) io.stderr(validated.stderr);
  const port = createCcloopExecutionPort({ binary, agentsTablePath: table, timeoutMs: PORT_TIMEOUT_MS });
  let failed = validated.code !== 0;
  let installations;
  try { installations = (await port.listAgents()).installations; } catch (error) {
    io.stdout(`ccloop control capabilities refused the table: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  for (const installation of installations) {
    try {
      const resolution = await port.resolveAgent({ agent: installation.id });
      io.stdout(`${installation.id} (${installation.kind} ${installation.version}): ${JSON.stringify(resolution.selection)} configHash ${resolution.configHash}\n`);
    } catch (error) {
      failed = true;
      io.stdout(`${installation.id} (${installation.kind} ${installation.version}): refused: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
  return failed ? 1 : 0;
}

export async function runAgentsCommand(args: string[], env: NodeJS.ProcessEnv, io: AgentsIo): Promise<number> {
  if (args.length !== 1 || (args[0] !== "init" && args[0] !== "show")) { io.stderr(USAGE); return 1; }
  try {
    return args[0] === "init" ? await init(env, io) : await show(env, io);
  } catch (error) {
    if (!(error instanceof AgentsRefusal)) throw error;
    io.stderr(`orca agents: ${error.message}\n`);
    return 1;
  }
}
