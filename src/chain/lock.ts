import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { chainLockDir, chainStateDir } from "./paths.js";
import { ChainRejection } from "./rejection.js";

export interface LockHolder {
  chainId: string;
  pid: number;
  startedAt: string;
}
export type LockState = { kind: "free" } | { kind: "held"; holder: LockHolder } | { kind: "stale"; holder: LockHolder | null; why: string };

/**
 * `ps -o lstart=` in the C locale and in UTC; null when there is no such process. The pid alone can be reused (review 8).
 * UTC (final review Minor-3): lstart is local time, so a reader under another TZ would see a live holder as a reused pid.
 */
export async function processStartTime(pid: number): Promise<string | null> {
  try {
    const { stdout } = await promisify(execFile)("ps", ["-o", "lstart=", "-p", String(pid)], { env: { ...process.env, LC_ALL: "C", TZ: "UTC" } });
    const text = stdout.trim();
    return text === "" ? null : text;
  } catch {
    return null;
  }
}

export async function lockState(repo: string): Promise<LockState> {
  const dir = await chainLockDir(repo);
  let text: string;
  try {
    text = await readFile(join(dir, "holder.json"), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return (await readFile(dir).then(() => true, (e: NodeJS.ErrnoException) => e.code === "EISDIR"))
      ? { kind: "stale", holder: null, why: `${dir} exists without holder.json` }
      : { kind: "free" };
  }
  let holder: LockHolder;
  try {
    const raw = JSON.parse(text) as Partial<LockHolder>;
    if (typeof raw.chainId !== "string" || typeof raw.pid !== "number" || typeof raw.startedAt !== "string") throw new Error("wrong shape");
    holder = { chainId: raw.chainId, pid: raw.pid, startedAt: raw.startedAt };
  } catch (err) {
    return { kind: "stale", holder: null, why: `holder.json cannot be read: ${(err as Error).message}` };
  }
  const started = await processStartTime(holder.pid);
  if (started === null) return { kind: "stale", holder, why: `pid ${holder.pid} is not running` };
  if (started !== holder.startedAt) return { kind: "stale", holder, why: `pid ${holder.pid} started at ${started}, not ${holder.startedAt}: the pid was reused` };
  return { kind: "held", holder };
}

/**
 * D-launch spec §5.1-2: a lock whose holder is gone is refused by name and never cleaned up here — a person confirms
 * and runs `orca chain unlock`. Shared by the preflight (§5.1) and by acquireChainLock.
 */
export async function assertLockFree(repo: string): Promise<void> {
  const state = await lockState(repo);
  if (state.kind === "held") throw new ChainRejection("chain-running", `chain ${state.holder.chainId} is running in ${repo} (pid ${state.holder.pid})`);
  if (state.kind === "stale") {
    throw new ChainRejection("chain-lock-stale", `a chain lock is left in ${repo} and its holder is gone (${state.why}); check, then run \`orca chain unlock --repo ${repo}\``);
  }
}

/** D-launch spec §5.1-2: one chain per worktree. `mkdir` is the atomic step, as in src/scheduler/repoLock.ts. */
export async function acquireChainLock(repo: string, chainId: string): Promise<{ release(): Promise<void> }> {
  await assertLockFree(repo);
  const startedAt = await processStartTime(process.pid);
  if (startedAt === null) throw new Error(`cannot read this process's own start time (pid ${process.pid})`);
  await mkdir(await chainStateDir(repo), { recursive: true, mode: 0o700 });
  const dir = await chainLockDir(repo);
  try {
    await mkdir(dir, { mode: 0o700 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") throw new ChainRejection("chain-running", `another chain took the lock in ${repo} just now`);
    throw err;
  }
  await writeFile(join(dir, "holder.json"), `${JSON.stringify({ chainId, pid: process.pid, startedAt })}\n`, { mode: 0o600 });
  let released = false;
  return {
    release: async () => {
      if (released) return;
      released = true;
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export async function removeChainLock(repo: string): Promise<void> {
  await rm(await chainLockDir(repo), { recursive: true, force: true });
}
