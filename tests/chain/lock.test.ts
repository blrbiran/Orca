import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { acquireChainLock, lockState, processStartTime } from "../../src/chain/lock.js";
import { chainLockDir } from "../../src/chain/paths.js";
import { git } from "../../src/scheduler/gitExec.js";
import { tempRepo } from "../helpers/tempRepo.js";

const deadPid = (): Promise<number> =>
  new Promise((resolve) => {
    const child = spawn("true");
    child.once("exit", () => resolve(child.pid as number));
  });

describe("chain lock (D-launch spec §5.1-2, review 8)", () => {
  it("L1 acquire, then held by this process; a second acquire is chain-running; release frees it", async () => {
    const repo = await tempRepo();
    const lock = await acquireChainLock(repo, "chain-0000000a");
    const state = await lockState(repo);
    expect(state.kind === "held" && [state.holder.chainId, state.holder.pid]).toEqual(["chain-0000000a", process.pid]);
    await expect(acquireChainLock(repo, "chain-0000000b")).rejects.toMatchObject({ code: "chain-running" });
    expect(await git(repo, ["status", "--porcelain"])).toBe("");
    await lock.release();
    expect(await lockState(repo)).toEqual({ kind: "free" });
  });

  it("L2 the right pid with the wrong start time is a reused pid: stale, refused by name, never cleaned up", async () => {
    const repo = await tempRepo();
    const lock = await acquireChainLock(repo, "chain-0000000a");
    await writeFile(join(await chainLockDir(repo), "holder.json"), JSON.stringify({ chainId: "chain-0000000a", pid: process.pid, startedAt: "Thu Jan  1 00:00:00 1970" }));
    const state = await lockState(repo);
    expect(state.kind).toBe("stale");
    await expect(acquireChainLock(repo, "chain-0000000b")).rejects.toMatchObject({ code: "chain-lock-stale" });
    expect(existsSync(await chainLockDir(repo))).toBe(true);
    await lock.release();
  });

  it("L3 a dead pid is stale", async () => {
    const repo = await tempRepo();
    const lock = await acquireChainLock(repo, "chain-0000000a");
    const pid = await deadPid();
    await writeFile(join(await chainLockDir(repo), "holder.json"), JSON.stringify({ chainId: "chain-0000000a", pid, startedAt: "x" }));
    expect(await lockState(repo)).toEqual({
      kind: "stale",
      holder: { chainId: "chain-0000000a", pid, startedAt: "x" },
      why: `pid ${pid} is not running`,
    });
    await lock.release();
  });

  it("L4 processStartTime is a non-empty string for this process and null for a dead one", async () => {
    expect((await processStartTime(process.pid))?.length).toBeGreaterThan(0);
    expect(await processStartTime(await deadPid())).toBeNull();
  });

  it("L5 in a linked worktree the lock lives in that worktree's own git dir (plan PC-1)", async () => {
    const repo = await tempRepo();
    const wt = `${repo}-wt`;
    await git(repo, ["worktree", "add", "-q", wt, "-b", "wt"]);
    const lock = await acquireChainLock(wt, "chain-0000000a");
    // `git worktree add` names the worktree after the directory's last segment.
    expect(await chainLockDir(wt)).toBe(join(repo, ".git", "worktrees", basename(wt), "orca-chain", "lock"));
    expect(await git(wt, ["status", "--porcelain"])).toBe("");
    await lock.release();
  });
});
