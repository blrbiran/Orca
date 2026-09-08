import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { appendEvent } from "../../src/ledger/writer.js";
import type { DecisionEvent } from "../../src/ledger/schema.js";

export { captureStreams, runCli } from "../scheduler/sandbox.js";

const execFileAsync = promisify(execFile);
const ID = ["-c", "user.name=fixture", "-c", "user.email=fixture@invalid"];

export async function git(repo: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", [...ID, ...args], { cwd: repo });
  return stdout;
}

/**
 * 🔴 CLAUDE.md Rule 17. Every criterion that touches the corrections store runs
 * inside this: ORCA_CORRECTIONS_DIR is pointed at a throwaway directory and the
 * previous value is restored in a `finally`. A criterion that wrote into a
 * person's real ~/.orca would be unacceptable even if it only wrote one line.
 */
export async function withCorrectionsDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "orca-corrections-"));
  const previous = process.env.ORCA_CORRECTIONS_DIR;
  process.env.ORCA_CORRECTIONS_DIR = dir;
  try {
    return await fn(dir);
  } finally {
    if (previous === undefined) delete process.env.ORCA_CORRECTIONS_DIR;
    else process.env.ORCA_CORRECTIONS_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
}

export const ORIGINAL: DecisionEvent = {
  ev: "decision",
  id: "orca-dev-1/1",
  at: "2026-09-01T00:00:00.000Z",
  run: "orca-dev-1",
  question: "用哪种锁",
  chose: "进程内互斥",
  alternatives: [{ option: "文件租约", why_not: "当时觉得太重" }],
  because: "实现最快",
  undo: { how: "git revert <ref>", cost: "要回滚三个仓库的 W 分支", blast_radius: "三个仓库" },
  scope: "repo",
  kind: "interface",
};

/**
 * Ruling 1 (task 9): the next task's criteria need this too, and cannot
 * import it from a sibling test file — so it lives here, next to the other
 * fixture helpers, rather than inside close.test.ts.
 */
export const closeArgs = (repo: string, overrides: string[] = []): string[] => [
  "correct", "--repo", repo, "--by", "amy",
  "--decision", "orca-dev-1/1", "--kind", "not_my_taste", "--because", "进程内互斥跨进程无效",
  "--chose-instead", "改用文件租约",
  "--undo-how", "删掉 src/scheduler/pool.ts 里的那处互斥",
  ...overrides,
];

export interface TargetRepo {
  path: string;
  decisionsDir: string;
  cleanup(): Promise<void>;
}

/** A throwaway target repo with a remote, one commit, and one decision to overturn. */
export async function makeTargetRepo(options: { remote?: string; seedDecision?: boolean } = {}): Promise<TargetRepo> {
  const root = await mkdtemp(join(tmpdir(), "orca-target-"));
  const path = join(root, "repo");
  await mkdir(path, { recursive: true });
  await git(path, ["init"]);
  await git(path, ["remote", "add", "origin", options.remote ?? "https://github.com/biran/orca.git"]);
  await writeFile(join(path, "README.md"), "seed\n");
  await git(path, ["add", "-A"]);
  await git(path, ["commit", "-m", "init"]);

  const decisionsDir = join(path, ".decisions");
  if (options.seedDecision !== false) {
    await appendEvent(decisionsDir, "orca-dev-1", ORIGINAL);
    await git(path, ["add", "-A"]);
    await git(path, ["commit", "-m", "seed the decision to be overturned"]);
  }

  return { path, decisionsDir, cleanup: () => rm(root, { recursive: true, force: true }) };
}
