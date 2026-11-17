import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * The four-line `git` wrapper this directory kept re-declaring.
 *
 * Task 10's review recorded the duplication as a deferred minor; Task 11 kept
 * a third copy rather than consolidate, on the grounds that there was no
 * shared home and making one meant editing two files that task had no other
 * reason to touch. Task 12 needs a FOURTH consumer (`ledgerWiring.ts`), which
 * is where "one more copy" stops being cheaper than a home — so this became
 * the home, with `land.ts` and `run.ts` left carrying their own and the
 * remaining three definitions registered rather than hidden.
 *
 * ⚠️ That registration is now discharged: this is the ONLY definition. The
 * convergence round that closed it is the one the round after C's execution
 * was told to do, so a fourth copy appearing here again is a regression, not
 * a Rule 3 deferral.
 *
 * `execFile`, never a shell: every argument here is data (a ref name, a path,
 * a commit message) and several of them come out of a plan file, so a shell
 * would make a task id with a `;` in it a command.
 */
export async function git(repo: string, args: string[], options: GitOptions = {}): Promise<string> {
  return (await runGit(repo, args, options, "utf8")) as string;
}

/** As `git`, but stdout as the raw bytes git wrote: a path that is not valid UTF-8 survives (N1 Task 11 review). */
export async function gitBytes(repo: string, args: string[], options: GitOptions = {}): Promise<Buffer> {
  return (await runGit(repo, args, options, "buffer")) as Buffer;
}

async function runGit(repo: string, args: string[], options: GitOptions, encoding: "utf8" | "buffer"): Promise<string | Buffer> {
  // N1 plan F14: the requirement export sets the commit identity per call, bounds every child, and feeds the document,
  // the trees and the commit message on stdin. Every other caller passes nothing and gets exactly the call it had.
  const pending = execFileAsync("git", args, {
    cwd: repo,
    encoding,
    ...(options.env === undefined ? {} : { env: { ...process.env, ...options.env } }),
    ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs, killSignal: "SIGKILL" as const }),
    ...(options.maxBuffer === undefined ? {} : { maxBuffer: options.maxBuffer }),
  });
  // A child that exits before reading all of it fails through `pending`; the pipe's EPIPE is that same failure.
  if (options.input !== undefined) { pending.child.stdin?.on("error", () => undefined); pending.child.stdin?.end(options.input); }
  return (await pending).stdout;
}

export interface GitOptions {
  /** Merged over process.env for this child only. */
  env?: NodeJS.ProcessEnv;
  /** The child is killed (SIGKILL) after this long. */
  timeoutMs?: number;
  /** Written to the child's stdin, which is then closed. */
  input?: string | Buffer;
  /** Bytes of stdout the child may write before the call fails (Node's default is 1 MiB; #334). */
  maxBuffer?: number;
}

/**
 * Tester #334: at most `limit` bytes of a git child's stdout, for output read only to be cut (a review's diff). The child
 * is killed once more than `limit` bytes arrived, so a diff of any size is neither held in memory nor a failed call;
 * `truncated` says whether anything was left unread. A child that fails on its own is an error, as with `git`.
 */
export function gitPrefix(repo: string, args: string[], limit: number): Promise<{ stdout: Buffer; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let size = 0, truncated = false, stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      if (truncated) return;
      if (size + chunk.length > limit) {
        chunks.push(chunk.subarray(0, limit - size)); size = limit; truncated = true;
        child.kill("SIGKILL");
        return;
      }
      chunks.push(chunk); size += chunk.length;
    });
    child.stderr.on("data", (chunk: Buffer) => { if (stderr.length < 4096) stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (truncated || code === 0) { resolve({ stdout: Buffer.concat(chunks), truncated }); return; }
      reject(new Error(`git ${args.join(" ")} exited ${code ?? signal}: ${stderr.trim()}`));
    });
  });
}

/**
 * The identity every commit orca makes carries, passed per invocation rather
 * than read from the environment — for the same reason ccloop's own
 * worktreeManager does it: the repository being written is frequently a
 * throwaway clone or a CI checkout with no user.email set, where `git merge
 * --no-ff` and `git commit` fail outright. Depending on ambient config would
 * break landing in exactly the setups it exists to serve.
 *
 * ⚠️ Measured, and worth knowing before trusting a mutation of this constant:
 * an absent repository identity is NOT by itself enough to make `git commit`
 * fail — git derives one from the OS user and host and commits with a
 * warning (recorded in P0's ERRATUM 1). It fails when
 * `user.useConfigOnly=true` and the global config is empty, which is the CI
 * shape. So a criterion that deletes this constant will pass on a developer
 * laptop; the reason to keep it is the machine that is not one.
 */
export const ORCA_IDENTITY = ["-c", "user.name=orca", "-c", "user.email=orca@invalid"];
