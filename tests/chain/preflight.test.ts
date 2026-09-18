import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireChainLock } from "../../src/chain/lock.js";
import { chainLockDir, chainStateDir } from "../../src/chain/paths.js";
import { preflight } from "../../src/chain/preflight.js";
import { commitChainRecord } from "../../src/chain/record.js";
import { ORCA_IDENTITY, git } from "../../src/scheduler/gitExec.js";
import { recordFixture } from "../helpers/chainRecord.js";
import { makeChainRepo } from "../helpers/chainRepo.js";
import { type FakeClaude, fakeClaude } from "../helpers/fakeClaude.js";

let cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanups.reverse()) await c();
  cleanups = [];
});
async function setup(model?: string) {
  const repo = await makeChainRepo({ gate: false, model });
  const fake: FakeClaude = await fakeClaude();
  cleanups.push(repo.cleanup, fake.teardown);
  const ok = async () => ({ ok: true as const });
  const deps = { gateCheck: ok, env: fake.env(), claudeBin: "claude" };
  const args = (over: Record<string, unknown> = {}) => ({
    repo: repo.path, by: "tester", goal: "the goal", maxSessions: 2, maxCostUsd: 1, chainId: "chain-0000000c", via: "cli", ...over,
  });
  const snapshot = async () => ({
    head: (await git(repo.path, ["rev-parse", "HEAD"])).trim(),
    status: await git(repo.path, ["status", "--porcelain", "--untracked-files=all"]),
    chains: existsSync(join(repo.path, ".orca", "chains")),
    logs: existsSync(join(repo.path, ".orca", "chain-logs")),
  });
  return { repo: repo.path, deps, args, snapshot };
}
const commitAll = async (repo: string, m: string) => {
  await git(repo, ["add", "-A"]);
  await git(repo, [...ORCA_IDENTITY, "commit", "-q", "-m", m]);
};

describe("preflight: D-launch spec §5.1 — refused by name, exit 1, nothing written", () => {
  it("PF0 all clear: the resolved repo, branch, head, id, config and timeout", async () => {
    const s = await setup();
    const before = await s.snapshot();
    const p = await preflight(s.args(), s.deps);
    expect([p.repo, p.branch, p.head, p.chainId, p.config, p.timeoutMin]).toEqual([
      s.repo, "main", before.head, "chain-0000000c", { model: "orca-fake-model", sessionTimeoutMin: 360 }, 360,
    ]);
    expect(await s.snapshot()).toEqual(before);
    expect(existsSync(await chainStateDir(s.repo))).toBe(false);
  });

  it.each([
    ["a blank goal", { goal: "  " }],
    ["no --by", { by: "" }],
    ["zero sessions", { maxSessions: 0 }],
    ["a cost that is not a number", { maxCostUsd: Number.NaN }],
    ["an infinite cost", { maxCostUsd: Number.POSITIVE_INFINITY }],
    ["a missing cost (no default)", { maxCostUsd: undefined }],
    ["a malformed chain id", { chainId: "chain-XYZ" }],
    ["an unknown via", { via: "robot" }],
  ])("PF1 %s is chain-args-invalid", async (_name, over) => {
    const s = await setup();
    const before = await s.snapshot();
    await expect(preflight(s.args(over), s.deps)).rejects.toMatchObject({ code: "chain-args-invalid", exitCode: 1 });
    expect(await s.snapshot()).toEqual(before);
  });

  it("PF2 a path that does not exist is repo-not-found", async () => {
    const s = await setup();
    await expect(preflight(s.args({ repo: join(s.repo, "no-such-dir") }), s.deps)).rejects.toMatchObject({ code: "repo-not-found" });
  });

  it("PF3 a directory outside git is not-a-repository", async () => {
    const s = await setup();
    const outside = join(s.repo, "..", `${basename(s.repo)}-plain`);
    await mkdir(outside);
    cleanups.push(() => rm(outside, { recursive: true, force: true }));
    await expect(preflight(s.args({ repo: outside }), s.deps)).rejects.toMatchObject({ code: "not-a-repository" });
  });

  it("PF4 a subdirectory is not-repository-top-level", async () => {
    const s = await setup();
    await expect(preflight(s.args({ repo: join(s.repo, ".orca") }), s.deps)).rejects.toMatchObject({ code: "not-repository-top-level" });
  });

  it("PF5 a chain id that already has a record is chain-id-exists", async () => {
    const s = await setup();
    await commitChainRecord(s.repo, recordFixture({ chainId: "chain-0000000c" }), "m");
    await expect(preflight(s.args(), s.deps)).rejects.toMatchObject({ code: "chain-id-exists" });
  });

  it("PF6 a dirty worktree is worktree-dirty", async () => {
    const s = await setup();
    await writeFile(join(s.repo, "stray.txt"), "x\n");
    await expect(preflight(s.args(), s.deps)).rejects.toMatchObject({ code: "worktree-dirty" });
  });

  it("PF7 a detached HEAD is detached-head", async () => {
    const s = await setup();
    await git(s.repo, ["checkout", "-q", "--detach"]);
    await expect(preflight(s.args(), s.deps)).rejects.toMatchObject({ code: "detached-head" });
  });

  it("PF8 a live chain lock is chain-running", async () => {
    const s = await setup();
    const lock = await acquireChainLock(s.repo, "chain-0000000d");
    cleanups.push(() => lock.release());
    await expect(preflight(s.args(), s.deps)).rejects.toMatchObject({ code: "chain-running" });
  });

  it("PF9 a lock whose holder is gone is chain-lock-stale, and is left in place", async () => {
    const s = await setup();
    const lock = await acquireChainLock(s.repo, "chain-0000000d");
    cleanups.push(() => lock.release());
    await writeFile(join(await chainLockDir(s.repo), "holder.json"), JSON.stringify({ chainId: "chain-0000000d", pid: process.pid, startedAt: "never" }));
    await expect(preflight(s.args(), s.deps)).rejects.toMatchObject({ code: "chain-lock-stale" });
    expect(existsSync(await chainLockDir(s.repo))).toBe(true);
  });

  it("PF10 the scheduler's repo lock held is repo-lock-held (review I11)", async () => {
    const s = await setup();
    await mkdir(join(s.repo, ".git", "orca-lock"));
    await expect(preflight(s.args(), s.deps)).rejects.toMatchObject({ code: "repo-lock-held" });
  });

  it("PF11 no claude on PATH is claude-not-found", async () => {
    const s = await setup();
    await expect(preflight(s.args(), { ...s.deps, env: { ...s.deps.env, PATH: "/usr/bin:/bin" } })).rejects.toMatchObject({ code: "claude-not-found" });
  });

  it("PF12 chain logs that git does not ignore are chain-logs-not-ignored (plan PC-2)", async () => {
    const s = await setup();
    await writeFile(join(s.repo, ".gitignore"), "node_modules\n");
    await commitAll(s.repo, "no chain-logs ignore");
    await expect(preflight(s.args(), s.deps)).rejects.toMatchObject({ code: "chain-logs-not-ignored" });
  });

  it("PF13 no .orca/chain.json is chain-config-missing", async () => {
    const s = await setup();
    await git(s.repo, ["rm", "-q", "--", ".orca/chain.json"]);
    await commitAll(s.repo, "no chain config");
    await expect(preflight(s.args(), s.deps)).rejects.toMatchObject({ code: "chain-config-missing" });
  });

  it("PF14 a model orca level cannot find a window for is model-window-unknown (review M9)", async () => {
    const s = await setup("claude-haiku-4-5-20251001");
    await expect(preflight(s.args(), s.deps)).rejects.toMatchObject({ code: "model-window-unknown" });
  });

  it("PF15 a failed gate check is gate-check-failed with its reason", async () => {
    const s = await setup();
    const refusal = preflight(s.args(), { ...s.deps, gateCheck: async () => ({ ok: false as const, reason: "the reason" }) });
    await expect(refusal).rejects.toMatchObject({ code: "gate-check-failed", message: "the reason" });
  });

  it("PF17 no node_modules/.bin/tsx in the target is tsx-missing (plan PC-23, review M5)", async () => {
    const s = await setup();
    await rm(join(s.repo, "node_modules"));
    await expect(preflight(s.args(), s.deps)).rejects.toMatchObject({ code: "tsx-missing" });
  });

  it("PF16 --session-timeout-min wins over .orca/chain.json, which wins over 360 (plan PC-13)", async () => {
    const s = await setup();
    expect((await preflight(s.args({ sessionTimeoutMin: 0.005 }), s.deps)).timeoutMin).toBe(0.005);
    await writeFile(join(s.repo, ".orca", "chain.json"), '{"model":"claude-opus-5[1m]","sessionTimeoutMin":90}\n');
    await commitAll(s.repo, "timeout 90");
    expect((await preflight(s.args(), s.deps)).timeoutMin).toBe(90);
  });
  it("PF18 ORCA_CHAIN_ID in the supervisor's environment is nested-chain, before anything else is looked at (final review Important-2)", async () => {
    const s = await setup();
    const before = await s.snapshot();
    let gateChecked = false;
    const deps = { ...s.deps, env: { ...s.deps.env, ORCA_CHAIN_ID: "chain-0000000a" }, gateCheck: async () => ((gateChecked = true), { ok: true as const }) };
    const refusal = preflight(s.args(), deps);
    await expect(refusal).rejects.toMatchObject({ code: "nested-chain", exitCode: 1 });
    await expect(refusal).rejects.toThrow("ORCA_CHAIN_ID is set (chain-0000000a): this is a chain session, and a chain session cannot start a chain");
    expect(gateChecked).toBe(false);
    expect(await s.snapshot()).toEqual(before);
  });
});
