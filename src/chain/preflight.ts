import { access, constants, realpath, stat } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { type ChainStartArgs, ChainStartSchema } from "./args.js";
import { type ChainConfig, loadChainConfig, modelWindowKnown } from "./config.js";
import { currentBranch, headOf, worktreeClean } from "./facts.js";
import { chainGit as git } from "./git.js";
import type { GateCheck } from "./gateCheck.js";
import { assertLockFree } from "./lock.js";
import { CHAIN_LOGS_DIR, chainRecordRelPath, newChainId } from "./paths.js";
import { ChainRejection } from "./rejection.js";

export interface PreflightDeps {
  gateCheck: (repo: string) => Promise<GateCheck>;
  env: NodeJS.ProcessEnv;
  claudeBin: string;
}
export interface Preflighted {
  args: ChainStartArgs;
  repo: string;
  head: string;
  branch: string;
  chainId: string;
  config: ChainConfig;
  timeoutMin: number;
}

const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false);

export async function findExecutable(name: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  const candidates = name.includes("/") ? [name] : (env.PATH ?? "").split(delimiter).filter((d) => d !== "").map((d) => join(d, name));
  for (const candidate of candidates) {
    const ok = await access(candidate, constants.X_OK).then(() => stat(candidate).then((s) => s.isFile()), () => false);
    if (ok) return candidate;
  }
  return null;
}

/**
 * D-launch spec §5.1: everything checked before anything is written. Arguments first (they cost nothing), then the
 * repository (item 1, with plan PC-2's log ignore before the clean check), the locks (2, 3), the runtime and model
 * (5), the gate (6). Every failure is a named ChainRejection with exit 1.
 */
export async function preflight(raw: unknown, deps: PreflightDeps): Promise<Preflighted> {
  const parsed = ChainStartSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ChainRejection("chain-args-invalid", parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "));
  }
  const args = parsed.data;
  let repo: string;
  try {
    repo = await realpath(args.repo);
  } catch {
    throw new ChainRejection("repo-not-found", `${args.repo} does not exist`);
  }
  let top: string;
  try {
    top = (await git(repo, ["rev-parse", "--show-toplevel"])).trim();
  } catch {
    throw new ChainRejection("not-a-repository", `${repo} is not inside a git repository`);
  }
  if ((await realpath(top)) !== repo) throw new ChainRejection("not-repository-top-level", `${repo} is not the top level of its repository (${top})`);
  const chainId = args.chainId ?? newChainId();
  if (await exists(join(repo, chainRecordRelPath(chainId)))) throw new ChainRejection("chain-id-exists", `${chainRecordRelPath(chainId)} already exists`);
  // Plan PC-2, before the clean check: the panel creates the log file before it spawns this command, so an
  // unignored log directory must be named as such, not reported as a dirty worktree.
  const logProbe = `${CHAIN_LOGS_DIR}/${chainId}/supervisor.log`;
  if (!(await git(repo, ["check-ignore", "-q", "--", logProbe]).then(() => true, () => false))) {
    throw new ChainRejection("chain-logs-not-ignored", `${CHAIN_LOGS_DIR}/ is not ignored in ${repo}; add it to .gitignore and commit (the supervisor's logs would dirty the worktree)`);
  }
  if (!(await worktreeClean(repo))) throw new ChainRejection("worktree-dirty", `${repo} has uncommitted changes; a chain starts from a clean worktree`);
  const branch = await currentBranch(repo);
  if (branch === null) throw new ChainRejection("detached-head", `${repo} is not on a branch`);
  await assertLockFree(repo);
  // Plan PC-1: the scheduler's own spelling (src/scheduler/repoLock.ts:29). In a linked worktree it cannot exist.
  if (await exists(join(repo, ".git", "orca-lock"))) {
    throw new ChainRejection("repo-lock-held", `the scheduler's repo lock ${join(repo, ".git", "orca-lock")} is held (review I11: a chain needs the worktree to itself)`);
  }
  if ((await findExecutable(deps.claudeBin, deps.env)) === null) throw new ChainRejection("claude-not-found", `${deps.claudeBin} is not an executable on PATH`);
  // Plan PC-23 (review M5): the gate hook and the checkpoint command in the prompt both run the target's own tsx;
  // a fresh worktree often has no node_modules.
  if ((await findExecutable(join(repo, "node_modules", ".bin", "tsx"), deps.env)) === null) {
    throw new ChainRejection("tsx-missing", `${join(repo, "node_modules", ".bin", "tsx")} does not exist: install or link node_modules in ${repo} first`);
  }
  const config = await loadChainConfig(repo);
  if (!(await modelWindowKnown(repo, config.model))) {
    throw new ChainRejection("model-window-unknown", `orca level knows no window for model ${config.model}: use a [1m] model or add it to .orca/level.json windows`);
  }
  const gate = await deps.gateCheck(repo);
  if (!gate.ok) throw new ChainRejection("gate-check-failed", gate.reason);
  return { args, repo, head: await headOf(repo), branch, chainId, config, timeoutMin: args.sessionTimeoutMin ?? config.sessionTimeoutMin };
}
