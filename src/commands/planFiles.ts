/**
 * Scheduled flows and groups spec 2026-10-24 §5.3 (c), §13.1, §16: the two local file acts of the `plan` rows, done in the
 * CLI's own process (the panel never reads or writes a path).
 *
 * - `plan import <path>`: an `orca-plan-v1` document is sent as it is; a scheduler plan file has its contract paths read
 *   and inlined -- each must lie inside the project's repository and is reached without a symbolic link in any component
 *   (the checkedPath rule of src/panel/controlConfig.ts) -- and its loop tasks kept as recipes. Its `targetRepo` must be the
 *   project's path. What is sent is `{doc, provenance: {fileName, fileSha256, format}}`, never a path.
 * - `plan export --out <path>`: a new file, mode 0600 set explicitly, written to a temp file in the same directory and
 *   published with a link that cannot overwrite (an existing path and a missing directory are refused); the temp file is
 *   removed on any failure. The written bytes are read back and must hash to the version's sha256.
 */
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, existsSync, fchmodSync, fstatSync, fsyncSync, linkSync, lstatSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from "node:fs";
import { basename, dirname, isAbsolute, parse, relative, resolve, sep } from "node:path";
import { canonicalBytes } from "../control/canonicalJson.js";
import { expandLoopTask, type LoopPlanFileInput } from "../control/loopPlans.js";
import { EntryRejection } from "../entry/envelope.js";

const sha256Hex = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");
const invalid = (message: string): EntryRejection => new EntryRejection("control-cli-argument-invalid", message);
type Raw = Record<string, unknown>;

/** A contract path a scheduler plan file names, read only if it is inside `repo` and no component is a symbolic link. */
function readContract(repo: string, planDir: string, taskId: string, contract: string): unknown {
  const refused = (why: string): never => { throw new EntryRejection("plan-library-contract-path-refused", `plan-library-contract-path-refused:${taskId}: ${why}`); };
  const path = resolve(planDir, contract);
  const rel = relative(repo, path);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) refused(`${path} is outside the repository ${repo}`);
  let cursor = parse(path).root;
  for (const part of path.slice(cursor.length).split(sep).filter(Boolean)) {
    cursor = resolve(cursor, part);
    let stat;
    try { stat = lstatSync(cursor); } catch { return refused(`${cursor} does not exist`); }
    if (stat.isSymbolicLink()) refused(`${cursor} is a symbolic link`);
  }
  let fd: number | undefined;
  try {
    const before = lstatSync(path);
    if (!before.isFile()) refused(`${path} is not a regular file`);
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(fd);
    if (opened.ino !== before.ino || opened.dev !== before.dev) refused(`${path} changed while it was opened`);
    const text = readFileSync(fd, "utf8");
    try { return JSON.parse(text) as unknown; } catch { throw new EntryRejection("control-plan-rejected", `contract-json:${taskId}`); }
  } catch (error) {
    if (error instanceof EntryRejection) throw error;
    return refused(`${path} cannot be read: ${(error as Error).message}`);
  } finally { if (fd !== undefined) closeSync(fd); }
}

/** The scheduler plan file as an `orca-plan-v1` document: repository-bound fields dropped, contracts inline, loops as recipes. */
function docOfPlanFile(plan: Raw, project: { path: string }, planPath: string): unknown {
  const repo = project.path;
  if (typeof plan.targetRepo !== "string" || resolve(plan.targetRepo) !== resolve(repo)) {
    throw new EntryRejection("plan-library-target-mismatch", `the plan's targetRepo ${JSON.stringify(plan.targetRepo)} is not this project's path ${repo}`);
  }
  if (!Array.isArray(plan.tasks)) throw new EntryRejection("control-plan-rejected", "malformed:tasks: a list of tasks");
  const tasks = (plan.tasks as Raw[]).map((task) => {
    const taskId = String(task.taskId);
    const kept: Raw = { taskId: task.taskId, dependsOn: task.dependsOn, targetVersion: task.targetVersion };
    if (task.agent !== undefined) kept.agent = task.agent;
    if (task.labels !== undefined) kept.labels = task.labels;
    if (task.loop !== undefined) {
      const expanded = expandLoopTask(taskId, repo, task.loop as LoopPlanFileInput, Array.isArray(task.labels) ? task.labels as string[] : []);
      if (!expanded.ok) throw new EntryRejection("control-plan-rejected", `loop-plan-invalid:${taskId}:${expanded.reason}`);
      kept.loop = expanded.recipe;
    } else if (typeof task.contract === "string") {
      kept.contract = readContract(repo, dirname(planPath), taskId, task.contract);
    }
    return kept;
  });
  return {
    schema: "orca-plan-v1", goal: plan.goal, successConditions: plan.successConditions,
    ...(plan.agent === undefined ? {} : { agent: plan.agent }), ...(plan.reconcileAgent === undefined ? {} : { reconcileAgent: plan.reconcileAgent }),
    tasks,
  };
}

/** `plan import`'s payload body: the document and where it came from. */
export function readPlanForImport(cwd: string, file: string, project: { path: string }): { doc: unknown; provenance: { fileName: string; fileSha256: string; format: "orca-plan-v1" | "scheduler-plan-file" } } {
  const path = resolve(cwd, file);
  let bytes: Buffer;
  try { bytes = readFileSync(path); } catch (error) { throw invalid(`cannot read ${file}: ${(error as Error).message}`); }
  let parsed: unknown;
  try { parsed = JSON.parse(bytes.toString("utf8")) as unknown; } catch { throw invalid(`${file} is not JSON`); }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw invalid(`${file} is not a plan (a JSON object)`);
  const raw = parsed as Raw;
  const format = raw.schema === "orca-plan-v1" ? "orca-plan-v1" as const : "scheduler-plan-file" as const;
  const doc = format === "orca-plan-v1" ? raw : docOfPlanFile(raw, project, path);
  return { doc, provenance: { fileName: basename(path), fileSha256: sha256Hex(bytes), format } };
}

/** `plan export --out`: the version's canonical bytes into a new 0600 file (§16). Answers what was written. */
export function writeExport(cwd: string, out: string, doc: unknown, sha256: string): { out: string; bytes: number; sha256: string } {
  const target = resolve(cwd, out);
  if (existsSync(target)) throw invalid("--out exists");
  const dir = dirname(target);
  let dirStat;
  try { dirStat = statSync(dir); } catch { throw invalid(`--out's directory ${dir} does not exist`); }
  if (!dirStat.isDirectory()) throw invalid(`--out's directory ${dir} is not a directory`);
  const bytes = canonicalBytes(doc);
  const temp = resolve(dir, `.${basename(target)}.orca-tmp-${randomUUID()}`);
  let fd: number | undefined;
  try {
    fd = openSync(temp, "wx", 0o600); fchmodSync(fd, 0o600);
    writeSync(fd, bytes); fsyncSync(fd); closeSync(fd); fd = undefined;
    // What landed on disk is the version the panel named, or nothing is published.
    if (sha256Hex(readFileSync(temp)) !== sha256) throw new EntryRejection("plan-library-hash-mismatch", `the bytes read do not hash to ${sha256}`);
    try { linkSync(temp, target); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw invalid("--out exists");
      throw error;
    }
    return { out: target, bytes: bytes.length, sha256 };
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temp); } catch { /* not created, or already gone */ }
  }
}
