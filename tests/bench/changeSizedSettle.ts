/**
 * Change-sized runs spec 2026-11-19 §12 A2: step E of a v2 run on a large repository, through Orca's real code. Not a test
 * tier.
 *
 *   ORCA_BENCH_REPO=<repo> ORCA_CONTROL_DIR=<scratch>/state npx tsx tests/bench/changeSizedSettle.ts > bench.json 2> bench.err
 *
 * The measured repository is only read: a `clone --local --no-checkout` of it under the control directory is the target.
 * The bench runs the real ensureWorkspace (worktree mode) at the target's HEAD, cuts an attempt worktree from the workspace
 * as ccloop does, makes a 2-file change there and records it as ccloop P1 records a kept worktree (a copy of the
 * worktree's index, `add -A` + `write-tree` under GIT_INDEX_FILE, `commit-tree -p HEAD`, both attempt refs, the worktree
 * removed), then step C's checkAttempt and pinAttempt, then -- timed as step E -- the real archiveRunV2 over a source
 * directory holding a 70-file run directory, followed by the real cleanupRunWorkspace; then the real
 * verifySnapshotInRepository, timed. One JSON object on stdout; exit 1 on any breach of §12's thresholds, 2 on a refusal
 * or an error.
 *
 * Every size is an apparent size in bytes (no `du`). `artifactBytes` is the growth of `<state>/artifacts/*` /data files
 * across the archive, measured on disk, so it counts whatever the archive wrote (a tree walk would show here), not what it
 * says it wrote. `logsBytes` is the sum of the run directory's files as written, `changeBytes` the bundle artifact,
 * `metaBytes` the snapshot artifact plus the archive manifest. `targetObjectsGrowthBytes` is the growth of the target's
 * `.git/objects` across everything from the attempt to the end (the change's objects and the pin; the target's packs are
 * hardlinked from the measured repository and do not change).
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { checkAttempt, pinAttempt } from "../../src/control/attemptPin.js";
import { privateDirectory } from "../../src/control/paths.js";
import { snapshotV2Schema, archiveRunV2, verifySnapshotInRepository } from "../../src/control/snapshotV2.js";
import { openControlStore } from "../../src/control/store.js";
import { readArtifact } from "../../src/control/archive.js";
import { cleanupRunWorkspace, controlWorkspaceRoots, ensureWorkspace, sourceDirOf, workspacePathOf } from "../../src/control/workspace.js";

const STEP_E_PLUS_VERIFY_MS_MAX = 10_000;
const META_BYTES_MAX = 65_536;
const SOURCE_SLACK_BYTES = 1_048_576;
const LOG_FILES = 70;

const git = (cwd: string, args: string[], env?: NodeJS.ProcessEnv): string => execFileSync("/usr/bin/git",
  ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "gc.auto=0", "-c", "maintenance.auto=false", ...args],
  { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...(env === undefined ? {} : { env: { ...process.env, ...env } }) }).trim();
const uptime = (): string => execFileSync("/usr/bin/uptime", { encoding: "utf8" }).trim();

function refuse(message: string): never { process.stderr.write(`changeSizedSettle: ${message}\n`); process.exit(2); }

/** Apparent sizes of every regular file under `root` (0 when it does not exist). */
function treeBytes(root: string): number {
  if (!existsSync(root)) return 0;
  let total = 0;
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name), stat = lstatSync(path);
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile()) total += stat.size;
    }
  };
  walk(root);
  return total;
}

/** Each artifact's stored bytes, by artifact id (`<state>/artifacts/<id>/data`). */
function artifactSizes(stateDir: string): Map<string, number> {
  const root = join(stateDir, "artifacts"), sizes = new Map<string, number>();
  if (!existsSync(root)) return sizes;
  for (const id of readdirSync(root)) {
    const data = join(root, id, "data");
    if (existsSync(data)) sizes.set(id, statSync(data).size);
  }
  return sizes;
}

async function main(): Promise<void> {
  const repo = process.env.ORCA_BENCH_REPO, control = process.env.ORCA_CONTROL_DIR;
  if (repo === undefined || repo === "" || control === undefined || control === "") refuse("set both ORCA_BENCH_REPO and ORCA_CONTROL_DIR");
  if (!isAbsolute(control)) refuse("ORCA_CONTROL_DIR must be absolute");
  // Rule 17: never the person's real control directory.
  const real = join(homedir(), ".orca");
  const resolved = existsSync(control) ? realpathSync(control) : resolve(control);
  const realOrca = existsSync(real) ? realpathSync(real) : real;
  const rel = relative(realOrca, resolved);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) refuse(`refusing a control directory under ${real}`);
  if (existsSync(control)) refuse(`${control} exists; give a fresh ORCA_CONTROL_DIR`);
  const uptimeBefore = uptime();
  const orcaCommit = git(process.cwd(), ["rev-parse", "HEAD"]);
  const ccloopPin = (JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { dependencies: Record<string, string> }).dependencies.ccloop ?? null;

  // The target: a hardlinked no-checkout clone; the measured repository is never written.
  mkdirSync(control, { recursive: true, mode: 0o700 });
  const scratch = privateDirectory(join(realpathSync(control), "bench-scratch"));
  const target = join(scratch, "target");
  git(scratch, ["clone", "-q", "--local", "--no-checkout", resolve(repo), target]);
  const base = git(target, ["rev-parse", "HEAD^{commit}"]);
  const trackedFiles = git(target, ["ls-tree", "-r", "--name-only", "-z", base]).split("\0").filter(Boolean).length;
  const trackedBytes = git(target, ["ls-tree", "-r", "-l", base]).split("\n").reduce((sum, line) => {
    const size = /^\d+ blob [0-9a-f]+\s+(\d+)\t/.exec(line)?.[1];
    return sum + (size === undefined ? 0 : Number(size));
  }, 0);
  const stateDir = join(realpathSync(control), "state");
  const store = await openControlStore({ stateDir });
  const roots = controlWorkspaceRoots(stateDir);
  const runId = `run-${randomUUID()}`;
  const executionId = `execution-${runId}`;
  // archiveRunV2 reads only the run's id, execution and generation; the bench has no group, so the row stands alone (its
  // foreign keys are off for this one insert, in this scratch store only).
  store.db.exec("PRAGMA foreign_keys=OFF");
  store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES (?,?,?,1,0,?)")
    .run(runId, "bench", "bench", JSON.stringify({ runId, groupId: "bench", workItemId: "bench", generation: 1, executionId }));
  store.db.exec("PRAGMA foreign_keys=ON");
  const objectsBefore = treeBytes(join(target, ".git", "objects"));

  // A2: the real no-checkout workspace.
  const workspace = workspacePathOf(roots, runId);
  await ensureWorkspace(target, "worktree", workspace, base, roots);

  // ccloop's attempt worktree and a 2-file change (one tracked file edited, one file added), recorded as P1 records a kept
  // worktree: the worktree's own index and HEAD are left as they were.
  const sourceDir = privateDirectory(sourceDirOf(roots, runId));
  const runDir = privateDirectory(join(sourceDir, "run"));
  const attemptDir = join(runDir, "worktrees", "attempt-1");
  mkdirSync(join(runDir, "worktrees"), { recursive: true, mode: 0o700 });
  const attemptStarted = performance.now();
  git(workspace, ["worktree", "add", "-q", "--detach", attemptDir]);
  const attemptCheckoutMs = Math.round(performance.now() - attemptStarted);
  const edited = git(attemptDir, ["ls-tree", "-r", "--name-only", "-z", "HEAD"]).split("\0").filter(Boolean).find((path) => {
    try { return lstatSync(join(attemptDir, path)).isFile(); } catch { return false; }
  });
  if (edited === undefined) refuse("the repository has no regular tracked file to edit");
  writeFileSync(join(attemptDir, edited), Buffer.concat([readFileSync(join(attemptDir, edited)), Buffer.from(`\n// bench ${runId}\n`)]));
  writeFileSync(join(attemptDir, `orca-bench-${runId}.txt`), `added by the change-sized settle bench for ${runId}\n`);
  const recordStarted = performance.now();
  const indexCopy = join(runDir, "attempt-record.index");
  copyFileSync(git(attemptDir, ["rev-parse", "--path-format=absolute", "--git-path", "index"]), indexCopy);
  const env = { GIT_INDEX_FILE: indexCopy };
  git(attemptDir, ["add", "-A"], env);
  const tree = git(attemptDir, ["write-tree"], env);
  const sha = git(attemptDir, ["-c", "user.name=ccloop", "-c", "user.email=ccloop@example.invalid", "commit-tree", tree, "-p", "HEAD", "-m", `ccloop attempt ${runId}`]);
  const ref = `refs/ccloop/${runId}/attempts/1`;
  git(attemptDir, ["update-ref", ref, sha]);
  git(attemptDir, ["update-ref", "refs/ccloop/run/attempts/1", sha]);
  rmSync(indexCopy);
  git(workspace, ["worktree", "remove", "--force", attemptDir]);
  const recordMs = Math.round(performance.now() - recordStarted);

  // Step C: the attempt's checks and the create-only pin, in the target.
  const checkFailure = await checkAttempt(workspace, base, sha, { tree, ref });
  if (checkFailure !== null) refuse(`step C check failed: ${checkFailure}`);
  const pinned = await pinAttempt(target, workspace, runId, sha);
  if ("refused" in pinned) refuse(`pin refused: ${pinned.refused}`);

  // The run directory a run leaves for its logs: 70 files of distinct content, 512..4,096 bytes.
  let logsBytes = 0;
  for (let i = 0; i < LOG_FILES; i += 1) {
    const dir = join(runDir, i % 2 === 0 ? "logs" : join("attempts", "1"));
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const size = 512 + ((i * 449) % 3_585);
    const line = `${runId} log ${i} `;
    const bytes = Buffer.from(line.repeat(Math.ceil(size / line.length)).slice(0, size));
    writeFileSync(join(dir, `log-${String(i).padStart(2, "0")}.txt`), bytes, { mode: 0o600 });
    logsBytes += bytes.length;
  }

  // Step E: the archive (pin no-op, range bundle, logs, snapshot, manifest, outbox row), then the workspace cleanup.
  const artifactsBefore = artifactSizes(stateDir);
  const stopProof = { executionId, generation: 1, isolated: true as const, source: { artifactId: "bench-stop", hash: "0".repeat(64) } };
  const stepEStarted = performance.now();
  const archived = await archiveRunV2(store, { runId, sourceDir, stopProof, repositories: [{ key: null, targetRepo: target, base, attempt: sha, head: base, source: "ccloop-live", from: workspace }] });
  const archiveMs = Math.round(performance.now() - stepEStarted);
  const cleanupStarted = performance.now();
  await cleanupRunWorkspace(target, roots, runId, workspace);
  const cleanupMs = Math.round(performance.now() - cleanupStarted);
  const stepE_ms = Math.round(performance.now() - stepEStarted);
  const artifactsAfter = artifactSizes(stateDir);

  // The snapshot verified in the target (§7.2 level 2).
  if (archived.snapshot === null) refuse(`no snapshot; missing ${JSON.stringify(archived.missing)}`);
  const verifyStarted = performance.now();
  await verifySnapshotInRepository(store, archived.snapshot, () => target);
  const verify_ms = Math.round(performance.now() - verifyStarted);

  const snapshot = snapshotV2Schema.parse(JSON.parse((await readArtifact(store, archived.snapshot)).toString()));
  const manifest = archived.artifacts.find((entry) => entry.artifactId.startsWith("archive-"));
  let artifactBytes = 0, newArtifacts = 0;
  for (const [id, size] of artifactsAfter) if (!artifactsBefore.has(id)) { artifactBytes += size; newArtifacts += 1; }
  const changeBytes = snapshot.bundle === null ? 0 : artifactsAfter.get(snapshot.bundle.artifactId) ?? -1;
  const metaBytes = (artifactsAfter.get(archived.snapshot.artifactId) ?? -1) + (manifest === undefined ? -1 : artifactsAfter.get(manifest.artifactId) ?? -1);
  const sourceBytes = treeBytes(sourceDir);
  const workspacesEntries = existsSync(roots.workspacesRoot) ? readdirSync(roots.workspacesRoot).length : 0;
  const targetObjectsGrowthBytes = treeBytes(join(target, ".git", "objects")) - objectsBefore;
  store.close();

  const breaches = [
    ...(stepE_ms + verify_ms > STEP_E_PLUS_VERIFY_MS_MAX ? [`stepE_ms + verify_ms = ${stepE_ms + verify_ms} > ${STEP_E_PLUS_VERIFY_MS_MAX}`] : []),
    ...(artifactBytes !== logsBytes + changeBytes + metaBytes ? [`artifactBytes ${artifactBytes} != logsBytes + changeBytes + metaBytes = ${logsBytes + changeBytes + metaBytes}`] : []),
    ...(metaBytes > META_BYTES_MAX ? [`metaBytes ${metaBytes} > ${META_BYTES_MAX}`] : []),
    ...(sourceBytes > logsBytes + SOURCE_SLACK_BYTES ? [`sourceBytes ${sourceBytes} > logsBytes + ${SOURCE_SLACK_BYTES}`] : []),
    ...(workspacesEntries !== 0 ? [`workspacesEntries ${workspacesEntries} != 0`] : []),
    ...(archived.missing.length !== 0 ? [`missing ${JSON.stringify(archived.missing)}`] : []),
  ];
  process.stdout.write(`${JSON.stringify({
    stepE_ms, verify_ms, changeBytes, logsBytes, metaBytes, artifactBytes, sourceBytes, workspacesEntries, targetObjectsGrowthBytes,
    uptimeBefore, uptimeAfter: uptime(),
    detail: { archiveMs, cleanupMs, attemptCheckoutMs, recordMs, newArtifacts, logFiles: LOG_FILES, trackedFiles, trackedBytes, base, attempt: sha, pinned: pinned.pinned.ref, orcaCommit, ccloopPin, scratch },
    breaches, result: breaches.length === 0 ? "pass" : "fail",
  })}\n`);
  process.exit(breaches.length === 0 ? 0 : 1);
}

main().catch((error: unknown) => { process.stderr.write(`changeSizedSettle: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); process.exit(2); });
