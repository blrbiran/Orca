import { spawn } from "node:child_process";
import { QUIET_GIT, unsetInheritedGitEnv } from "./workspace.js";

/**
 * Integration spec §6: the one runner every integration git and gh child goes through -- the pass, the setters' checks
 * and confirm's preflight. Argument arrays only (no shell), no GIT_* variable inherited from Orca's environment (but the
 * person's own ssh command, sshEnv), never a prompt, and a deadline (ORCA_INTEGRATION_TIMEOUT_MS, 60 s unless set).
 */
export interface ChildResult { code: number; stdout: string; stderr: string }
export type ChildFailure = { kind: "transient" | "permanent"; code: string; message: string };
export interface ChildOptions {
  cwd: string;
  /** Written to the child's stdin, which is then closed (it is closed at once without one). */
  input?: string;
  /** A git child run with QUIET_GIT: no hook and no fsmonitor of the repository runs on Orca's behalf. */
  quiet?: boolean;
  /** Variables set for this child over the runner's own environment (childEnv). */
  env?: Record<string, string>;
}
export type RunChild = (bin: string, args: string[], opts: ChildOptions) => Promise<ChildResult>;

/** The child outlived the deadline; it and every process it started were killed. */
export class ChildTimeout extends Error {
  constructor(readonly bin: string, readonly args: string[], readonly ms: number) {
    super(`${bin} ${args.join(" ")}: no answer within ${ms} ms`);
    this.name = "ChildTimeout";
  }
}
/** The child could not be started at all (a missing binary, a missing directory). */
export class ChildSpawnFailed extends Error {
  constructor(readonly bin: string, readonly reason: unknown) {
    super(`${bin}: could not start: ${reason instanceof Error ? reason.message : String(reason)}`);
    this.name = "ChildSpawnFailed";
  }
}

const DEFAULT_TIMEOUT_MS = 60_000;
export function integrationTimeoutMs(): number {
  const value = Number(process.env.ORCA_INTEGRATION_TIMEOUT_MS);
  return Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

export function childEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env, ...unsetInheritedGitEnv(),
    GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1",
  };
}

/** The git subcommands that talk to a remote (and so may run ssh). */
const NETWORK_SUBCOMMANDS: ReadonlySet<string> = new Set(["fetch", "push", "ls-remote"]);
function gitSubcommand(args: string[]): string | null {
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "-c") { i += 1; continue; }
    if (!args[i]!.startsWith("-")) return args[i]!;
  }
  return null;
}

/**
 * Final review Minor 6: a git child that talks to a remote never prompts over ssh (BatchMode) -- unless the person chose
 * their own ssh command: in the environment (passed on, since childEnv drops every inherited GIT_* variable) or in
 * git's config (`core.sshCommand`, which a GIT_SSH_COMMAND would override). The config is read with the plain runner,
 * so the test seam counts only the children the integration itself starts.
 */
async function sshEnv(bin: string, args: string[], cwd: string): Promise<Record<string, string>> {
  if (bin !== "git" || !NETWORK_SUBCOMMANDS.has(gitSubcommand(args) ?? "")) return {};
  const own = process.env.GIT_SSH_COMMAND;
  if (own !== undefined && own !== "") return { GIT_SSH_COMMAND: own };
  const configured = await spawnRunChild("git", ["config", "--get", "core.sshCommand"], { cwd, quiet: true })
    .then((answer) => answer.code === 0 && answer.stdout.trim() !== "", () => false);
  return configured ? {} : { GIT_SSH_COMMAND: "ssh -o BatchMode=yes" };
}

/**
 * Never throws on a non-zero exit (the caller reads `code`); throws ChildTimeout past the deadline and ChildSpawnFailed
 * when nothing could be started. The child leads its own process group and the whole group is killed on timeout: a
 * transport helper's grandchild (`ext::`, ssh) would otherwise keep the pipes open after the child itself died.
 */
export const spawnRunChild: RunChild = (bin, args, opts) => new Promise((resolve, reject) => {
  const argv = opts.quiet ? [...QUIET_GIT, ...args] : args;
  const ms = integrationTimeoutMs();
  let child;
  try {
    child = spawn(bin, argv, { cwd: opts.cwd, env: { ...childEnv(), ...opts.env }, detached: true, stdio: ["pipe", "pipe", "pipe"] });
  } catch (error) { reject(new ChildSpawnFailed(bin, error)); return; }
  const stdout: Buffer[] = [], stderr: Buffer[] = [];
  let settled = false;
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    try { if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ }
    reject(new ChildTimeout(bin, argv, ms));
  }, ms);
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  child.on("error", (error) => {
    if (settled) return;
    settled = true; clearTimeout(timer);
    reject(new ChildSpawnFailed(bin, error));
  });
  child.on("close", (code, signal) => {
    if (settled) return;
    settled = true; clearTimeout(timer);
    resolve({ code: code ?? (signal === null ? 1 : 128), stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
  });
  // A child that exits before reading all of it fails through `close`; the pipe's EPIPE is that same failure.
  child.stdin.on("error", () => undefined);
  child.stdin.end(opts.input);
});

let override: RunChild | null = null;
/** Test seam: replaces (or, with null, restores) the runner, so a criterion can count every child started. */
export function __setRunChildForTests(runner: RunChild | null): void { override = runner; }

export async function runChild(bin: string, args: string[], opts: ChildOptions): Promise<ChildResult> {
  const env = { ...(await sshEnv(bin, args, opts.cwd)), ...opts.env };
  return (override ?? spawnRunChild)(bin, args, Object.keys(env).length === 0 ? opts : { ...opts, env });
}

/** A quiet git child in `repo`. */
export function gitChild(repo: string, args: string[], input?: string): Promise<ChildResult> {
  return runChild("git", args, { cwd: repo, quiet: true, ...(input === undefined ? {} : { input }) });
}

/** A failure a later attempt may not see: the network, not the repository. */
export function classifyNetwork(stderr: string): "transient" | null {
  // "unable to access" alone also prefixes an HTTP 401/403 (a revoked token), which no retry fixes: only its network
  // causes are transient (fix round 1, I3).
  return /Could not resolve host|Connection refused|timed out|unable to access .*(?:Could not resolve|Failed to connect|timed out|Connection refused)/i.test(stderr) ? "transient" : null;
}

export type PushOutcome = "ok" | "moved" | { refused: string } | { failed: string; transient: boolean };

/**
 * spec §6.1 step 4: `git push --porcelain` (never forced), judged from git's own per-ref line. `moved` is the remote
 * branch having commits the pushed one does not contain (`[rejected] (fetch first)` / `(non-fast-forward)`); any other
 * `!` line is a refusal (a protected branch, a hook, a permission) with git's message. No line at all is a failure to
 * talk to the remote, transient when it reads like the network.
 */
export async function pushPorcelain(repo: string, remote: string, refspec: string): Promise<PushOutcome> {
  const answer = await gitChild(repo, ["push", "--porcelain", remote, refspec]);
  const line = answer.stdout.split("\n").find((candidate) => /^[ +\-*!=]\t/.test(candidate));
  if (line === undefined) {
    const message = oneLine(answer.stderr || answer.stdout);
    return { failed: message, transient: classifyNetwork(answer.stderr) !== null };
  }
  const flag = line[0], summary = line.split("\t")[2] ?? "";
  // Accepted, or already there ("=", up to date): either way the remote branch now holds the pushed commit.
  if (flag !== "!") return "ok";
  if (/^\[rejected\] \((?:fetch first|non-fast-forward)\)/.test(summary)) return "moved";
  return { refused: oneLine(`${summary} ${answer.stderr}`) };
}

/** git's words on one line, bounded, for a record's reason. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 500);
}

/** `ls-remote` of one branch: its commit, null when the remote has no such branch; throws a RemoteFailure otherwise. */
export class RemoteFailure extends Error {
  constructor(readonly transient: boolean, message: string) { super(message); this.name = "RemoteFailure"; }
}
export async function remoteTip(repo: string, remote: string, branch: string): Promise<string | null> {
  const answer = await gitChild(repo, ["ls-remote", "--quiet", remote, `refs/heads/${branch}`]);
  if (answer.code !== 0) throw new RemoteFailure(classifyNetwork(answer.stderr) !== null, oneLine(answer.stderr));
  const line = answer.stdout.split("\n").find((candidate) => candidate.endsWith(`\trefs/heads/${branch}`));
  return line === undefined ? null : line.split("\t")[0]!;
}

/** Whether `ancestor` is reachable from `descendant` (both must be local objects). */
export async function isAncestor(repo: string, ancestor: string, descendant: string): Promise<boolean> {
  const answer = await gitChild(repo, ["merge-base", "--is-ancestor", ancestor, descendant]);
  if (answer.code === 0) return true;
  if (answer.code === 1) return false;
  throw new Error(`merge-base --is-ancestor ${ancestor} ${descendant}: ${oneLine(answer.stderr)}`);
}

/**
 * spec §6.1 step 2: the remote branch already holds `commit` -- its tip is it, or contains it. A tip the repository does
 * not have is fetched into `scratchRef` first (an Orca-owned ref; the person's FETCH_HEAD is not written).
 */
export async function remoteHas(repo: string, remote: string, branch: string, commit: string, scratchRef: string): Promise<boolean> {
  const tip = await remoteTip(repo, remote, branch);
  if (tip === null) return false;
  if (tip === commit) return true;
  if ((await gitChild(repo, ["cat-file", "-e", `${tip}^{commit}`])).code !== 0) await fetchInto(repo, remote, branch, scratchRef);
  return isAncestor(repo, commit, tip).catch(() => false);
}

/** The remote answers but has no such branch. */
export class BranchMissing extends Error { constructor(branch: string) { super(`the remote has no branch ${branch}`); this.name = "BranchMissing"; } }
/**
 * Fetches `refs/heads/<branch>` of `remote` into `ref` (forced: it is Orca's own) and answers the commit fetched. Throws
 * BranchMissing when the remote answers without the branch, RemoteFailure when it does not answer.
 */
export async function fetchInto(repo: string, remote: string, branch: string, ref: string): Promise<string> {
  const answer = await gitChild(repo, ["fetch", "--quiet", "--no-tags", "--no-write-fetch-head", remote, `+refs/heads/${branch}:${ref}`]);
  if (answer.code !== 0) {
    // The remote answering at all tells a missing branch from a missing remote (as confirm's preflight does); one that
    // does not answer is transient when that reads like the network.
    const listed = await gitChild(repo, ["ls-remote", "--quiet", remote]);
    if (listed.code === 0) throw new BranchMissing(branch);
    throw new RemoteFailure(classifyNetwork(listed.stderr) !== null, oneLine(answer.stderr));
  }
  return revParse(repo, ref);
}

export async function revParse(repo: string, rev: string): Promise<string> {
  const answer = await gitChild(repo, ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`]);
  if (answer.code !== 0) throw new Error(`rev-parse ${rev}: ${oneLine(answer.stderr) || "not a commit"}`);
  return answer.stdout.trim();
}

/** A local ref's commit, null when there is no such ref. */
export async function refTip(repo: string, ref: string): Promise<string | null> {
  const answer = await gitChild(repo, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  return answer.code === 0 ? answer.stdout.trim() : null;
}

/** Throws with git's words unless the child exited 0; answers its stdout. */
export async function gitOk(repo: string, args: string[], input?: string): Promise<string> {
  const answer = await gitChild(repo, args, input);
  if (answer.code !== 0) throw new Error(`git ${args[0]}: ${oneLine(answer.stderr) || `exit ${answer.code}`}`);
  return answer.stdout;
}

/** `merge-tree --name-only` on a conflict: the tree, the conflicted names, a blank line, then git's messages. */
export function conflictedNames(stdout: string): string[] {
  const lines = stdout.split("\n");
  const end = lines.indexOf("", 1);
  return [...new Set(lines.slice(1, end === -1 ? lines.length : end).filter((line) => line.length > 0))];
}
