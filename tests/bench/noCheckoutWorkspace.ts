/**
 * Change-sized runs spec 2026-11-19 §12 P0-A: the no-checkout run workspace on a large repository. Not a test tier.
 *
 *   ORCA_BENCH_REPO=<repo> ORCA_CONTROL_DIR=<scratch>/state npx tsx tests/bench/noCheckoutWorkspace.ts > p0a.json 2> p0a.err
 *
 * The measured repository is only read: a `clone --local --no-checkout` of it under the control directory is the target,
 * and a `later` commit (commit-tree + update-ref, no checkout) moves the target's HEAD past `base`. For each mode it runs
 * the real ensureWorkspace at `base`, measures the workspace, cuts an attempt worktree from it with no start point (as
 * ccloop cuts it), removes the attempt and runs the real cleanupRunWorkspace. One JSON object per mode on stdout, then a
 * summary; exit 1 on any breach of the spec's thresholds.
 *
 * `unsharedBytes` is measured right after ensureWorkspace, before the attempt exists: an attempt registered in a clone
 * workspace writes its own index under `<ws>/.git/worktrees/`, which is ccloop's attempt (C3), not the workspace (C1).
 */
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { cleanupRunWorkspace, controlWorkspaceRoots, ensureWorkspace, workspacePathOf } from "../../src/control/workspace.js";
import type { WorkspaceMode } from "../../src/control/workspaceSettings.js";
import { privateDirectory } from "../../src/control/paths.js";

const ENSURE_MS_MAX = 2_000;
const UNSHARED_BYTES_MAX = 1_048_576;
const CCLOOP_PIN = "dd491c1af70cf10b1e2ea102160514c37c8250e8";

const git = (cwd: string, ...args: string[]): string => execFileSync("/usr/bin/git", ["-c", "core.hooksPath=/dev/null", "-c", "gc.auto=0", "-c", "maintenance.auto=false", ...args], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
const uptime = (): string => execFileSync("/usr/bin/uptime", { encoding: "utf8" }).trim();

function refuse(message: string): never { process.stderr.write(`noCheckoutWorkspace: ${message}\n`); process.exit(2); }

/** Apparent sizes of regular files with a link count of 1 under `root` (hardlinked packs are not new bytes). */
function unsharedBytes(root: string): number {
  let total = 0;
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const stat = lstatSync(path);
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile() && stat.nlink === 1) total += stat.size;
    }
  };
  walk(root);
  return total;
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
  const uptimeBefore = uptime();
  const orcaCommit = git(process.cwd(), "rev-parse", "HEAD");
  const scratch = privateDirectory(join(control, "bench-scratch"));
  const target = join(scratch, "target");
  if (existsSync(target)) refuse(`${target} exists; give a fresh ORCA_CONTROL_DIR`);
  git(scratch, "clone", "-q", "--local", "--no-checkout", resolve(repo), target);
  const base = git(target, "rev-parse", "HEAD^{commit}");
  const later = git(target, "commit-tree", `${base}^{tree}`, "-p", base, "-m", "later");
  git(target, "update-ref", "HEAD", later);
  const roots = controlWorkspaceRoots(join(control, "state"));
  const results: Record<string, unknown>[] = [];
  let ok = true;
  for (const mode of ["worktree", "clone"] as WorkspaceMode[]) {
    const runId = `run-bench-${mode}`;
    const path = workspacePathOf(roots, runId);
    const started = performance.now();
    await ensureWorkspace(target, mode, path, base, roots);
    const ensureMs = Math.round(performance.now() - started);
    const entries = readdirSync(path).sort();
    const gitDir = resolve(path, git(path, "rev-parse", "--git-dir"));
    const bytes = unsharedBytes(path) + (mode === "worktree" ? unsharedBytes(gitDir) : 0);
    const headIsBase = git(path, "rev-parse", "HEAD") === base;
    const attempt = join(scratch, `attempt-${mode}`);
    const attemptStarted = performance.now();
    git(path, "worktree", "add", "-q", "--detach", attempt);
    const attemptMs = Math.round(performance.now() - attemptStarted);
    const attemptHeadIsBase = git(attempt, "rev-parse", "HEAD") === base;
    git(path, "worktree", "remove", "--force", attempt);
    await cleanupRunWorkspace(target, roots, runId, path);
    const result = { mode, ensureMs, entries, unsharedBytes: bytes, gitDir, headIsBase, attemptHeadIsBase, attemptMs, workspaceRemoved: !existsSync(path) };
    const breaches = [
      ...(ensureMs > ENSURE_MS_MAX ? [`ensureMs ${ensureMs} > ${ENSURE_MS_MAX}`] : []),
      ...(JSON.stringify(entries) !== JSON.stringify([".git"]) ? [`entries ${JSON.stringify(entries)}`] : []),
      ...(bytes > UNSHARED_BYTES_MAX ? [`unsharedBytes ${bytes} > ${UNSHARED_BYTES_MAX}`] : []),
      ...(headIsBase ? [] : ["workspace HEAD is not base"]),
      ...(attemptHeadIsBase ? [] : ["attempt HEAD is not base"]),
    ];
    if (breaches.length > 0) ok = false;
    results.push({ ...result, breaches });
    process.stdout.write(`${JSON.stringify({ ...result, breaches })}\n`);
  }
  process.stdout.write(`${JSON.stringify({ summary: ok ? "pass" : "fail", base, later, orcaCommit, ccloopPin: CCLOOP_PIN, uptimeBefore, uptimeAfter: uptime(), scratch })}\n`);
  process.exit(ok ? 0 : 1);
}

main().catch((error: unknown) => { process.stderr.write(`noCheckoutWorkspace: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); process.exit(2); });
