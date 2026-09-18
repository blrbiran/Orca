import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runChainCommand } from "../../src/chain/command.js";
import { acquireChainLock, lockState } from "../../src/chain/lock.js";
import { chainLockDir, chainStateDir, stopRequestPath } from "../../src/chain/paths.js";
import { commitChainRecord } from "../../src/chain/record.js";
import { readChainRecord } from "../../src/chain/recordSchema.js";
import { type ChainDeps, defaultChainDeps } from "../../src/chain/run.js";
import { git } from "../../src/scheduler/gitExec.js";
import { isolateChainEnv } from "../helpers/chainEnv.js";
import { recordFixture } from "../helpers/chainRecord.js";
import { ORCA_ROOT, makeChainRepo } from "../helpers/chainRepo.js";
import { type FakeClaude, fakeClaude } from "../helpers/fakeClaude.js";

const RECORDER = join(ORCA_ROOT, "tests", "chain", "fixtures", "record-node.cjs");
let cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const c of cleanups.reverse()) await c();
  cleanups = [];
});

async function target(gate = true): Promise<{ repo: string; fake: FakeClaude }> {
  const t = await makeChainRepo({ gate });
  const fake = await fakeClaude();
  cleanups.push(t.cleanup, fake.teardown);
  return { repo: t.path, fake };
}

/** The real CLI, detached, killed as a group on its deadline and again in afterEach (tsx runs the script in a child node). */
function cli(args: string[], env: NodeJS.ProcessEnv, deadlineMs = 90_000) {
  const child = spawn(join(ORCA_ROOT, "node_modules", ".bin", "tsx"), [join(ORCA_ROOT, "src", "cli.ts"), ...args], {
    cwd: ORCA_ROOT,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (c: Buffer) => (stdout += c.toString("utf8")));
  child.stderr.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
  const kill = (): void => {
    try {
      process.kill(-(child.pid as number), "SIGKILL");
    } catch {
      // Already gone.
    }
  };
  cleanups.push(kill);
  const result = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const timer = setTimeout(() => {
      kill();
      reject(new Error(`orca chain did not exit within ${deadlineMs} ms; its group was killed. stderr: ${stderr}`));
    }, deadlineMs);
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
  return { result, stdout: () => stdout };
}

function cliRoles(log: string): string[] {
  return log
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l) as { argv: string[] })
    .filter((e) => e.argv.some((a) => a === "src/cli.ts" || a.endsWith("/src/cli.ts")))
    .map((e) =>
      e.argv.includes("chain") && e.argv.includes("start") ? "supervisor" : e.argv.includes("gate") && e.argv.includes("--hook") ? "gate" : `other: ${e.argv.slice(1).join(" ")}`,
    );
}

function capture(over: Partial<ChainDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  // Object.assign onto defaultChainDeps()'s own object, not a spread into a new one: defaultChainDeps's gateCheck
  // closes lazily over that object's own `env` field (controller note, Task 7 review), and a spread copy would leave
  // the closure pointed at the original, un-overridden object — silently defeating a later `deps.env = …` (E10).
  const deps = defaultChainDeps();
  const overrides: Partial<ChainDeps> = { out: (t: string) => void out.push(t), err: (t: string) => void err.push(t), notify: async () => null };
  Object.assign(deps, overrides, over);
  return { deps, out, err };
}

const START = (repo: string, id: string) => ["chain", "start", "--repo", repo, "--by", "tester", "--goal", "two files", "--max-sessions", "3", "--max-cost-usd", "5", "--chain-id", id];

describe("orca chain through the real CLI (D-launch spec §4.3, §5.3, §8.2-3/11)", () => {
  isolateChainEnv();

  it("E1 two sessions with the real gate check: exit 0, one notification, no orca child process, no forbidden stub called", async () => {
    const { repo, fake } = await target();
    await fake.scenario(1, { steps: [{ do: "commit", file: "one.txt" }, { do: "exitCheckpoint", status: "continue" }], result: { subtype: "success", cost: 0.25 } });
    await fake.scenario(2, { steps: [{ do: "commit", file: "two.txt" }, { do: "exitCheckpoint", status: "done", next: [] }], result: { subtype: "success", cost: 0.5 } });
    const nodeLog = join(fake.dir, "node.jsonl");
    const run = await cli(START(repo, "chain-0000000e"), fake.env({ NODE_OPTIONS: `--require ${RECORDER}`, ORCA_TEST_NODE_LOG: nodeLog })).result;
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("orca chain: started chain-0000000e\n");
    expect(run.stdout).toContain("orca chain chain-0000000e stopped: done (done)\n");
    expect(run.stdout).toContain("sessions: 2; cost: 0.75 USD, as reported by claude\n");
    const r = await readChainRecord(repo, "chain-0000000e");
    expect(r.sessions.map((x) => [x.n, x.chain?.status, x.costUsd])).toEqual([[1, "continue", 0.25], [2, "done", 0.5]]);
    const calls = await fake.calls();
    expect(calls.filter((c) => c.name.startsWith("forbidden-"))).toEqual([]);
    expect(calls.filter((c) => c.name === "osascript")).toEqual([
      { name: "osascript", argv: ["-e", "on run argv", "-e", "display notification (item 1 of argv) with title (item 2 of argv)", "-e", "end run", "chain-0000000e: done", "orca chain done"] },
    ]);
    const roles = cliRoles(await readFile(nodeLog, "utf8"));
    expect(roles.filter((x) => x.startsWith("other"))).toEqual([]);
    expect(roles).toContain("supervisor");
    expect(roles).toContain("gate");
  }, 120_000);

  it("E8 must-catch for E1: an orca child started by absolute path is seen by the recorder", async () => {
    const { repo, fake } = await target(false);
    const nodeLog = join(fake.dir, "node.jsonl");
    await cli(["resume", "--repo", repo], fake.env({ NODE_OPTIONS: `--require ${RECORDER}`, ORCA_TEST_NODE_LOG: nodeLog })).result;
    const others = cliRoles(await readFile(nodeLog, "utf8")).filter((x) => x.startsWith("other: "));
    expect(others.length).toBeGreaterThan(0);
    expect(others.every((x) => x.includes(" resume --repo "))).toBe(true);
  }, 60_000);

  it("E2 a refused start exits 1 and writes nothing", async () => {
    const { repo, fake } = await target(false);
    const head = (await git(repo, ["rev-parse", "HEAD"])).trim();
    const args = START(repo, "chain-0000000e").filter((a, i, all) => a !== "--max-cost-usd" && all[i - 1] !== "--max-cost-usd");
    const run = await cli(args, fake.env()).result;
    expect([run.code, run.stderr]).toEqual([1, "rejected: chain-args-invalid: maxCostUsd: Required\n"]);
    expect((await git(repo, ["rev-parse", "HEAD"])).trim()).toBe(head);
    expect([existsSync(join(repo, ".orca", "chains")), existsSync(join(repo, ".orca", "chain-logs")), existsSync(await chainStateDir(repo))]).toEqual([false, false, false]);
  }, 60_000);

  it("E3 blocked through the CLI exits 3", async () => {
    const { repo, fake } = await target();
    await fake.scenario(1, {
      steps: [{ do: "commit", file: "one.txt" }, { do: "exitCheckpoint", status: "blocked", awaitingHuman: [{ kind: "irreversible", what: "push main" }] }],
    });
    const run = await cli(START(repo, "chain-0000000e"), fake.env()).result;
    expect(run.code).toBe(3);
    expect(run.stdout).toContain("awaiting a human:\n  - [irreversible] push main\n");
  }, 120_000);

  it("E4 SIGINT to the supervisor ends the running session through its group, records stop-requested and frees the lock (spec §5.3)", async () => {
    const { repo, fake } = await target();
    await fake.scenario(1, { steps: [{ do: "sleep", ms: 60_000 }] });
    const run = cli(START(repo, "chain-0000000e"), fake.env());
    const waitUntil = Date.now() + 60_000;
    while (!(run.stdout().includes("orca chain: started chain-0000000e") && (await fake.call(1)) !== null)) {
      if (Date.now() > waitUntil) throw new Error("the chain never started its first session");
      await new Promise((r) => setTimeout(r, 100));
    }
    const pid = (await readChainRecord(repo, "chain-0000000e")).supervisorPid;
    const signalledAt = Date.now();
    process.kill(pid, "SIGINT");
    const result = await run.result;
    // Nominal: well under a second (TERM to the group, the fake dies, the record is committed). The bound is loose for
    // the full suite's load (review M6); what it must separate is the session sleeping out its 60 s when the signal
    // does not reach the group (mutation M8-6).
    expect(Date.now() - signalledAt).toBeLessThan(20_000);
    expect(result.code).toBe(4);
    const r = await readChainRecord(repo, "chain-0000000e");
    expect(r.stop).toMatchObject({ reason: "stop-requested", category: "limit", detail: "the supervisor was signalled" });
    expect([r.sessions[0].outcome, r.sessions[0].exitCode]).toEqual(["exited", null]);
    expect(await lockState(repo)).toEqual({ kind: "free" });
    expect(await fake.residue()).toEqual([]);
  }, 180_000);

  it("E9 SIGHUP (the terminal went away) is handled like SIGINT (plan PC-23, review M4)", async () => {
    const { repo, fake } = await target();
    await fake.scenario(1, { steps: [{ do: "sleep", ms: 60_000 }] });
    const run = cli(START(repo, "chain-0000000d"), fake.env());
    const waitUntil = Date.now() + 60_000;
    while (!(run.stdout().includes("orca chain: started chain-0000000d") && (await fake.call(1)) !== null)) {
      if (Date.now() > waitUntil) throw new Error("the chain never started its first session");
      await new Promise((r) => setTimeout(r, 100));
    }
    process.kill((await readChainRecord(repo, "chain-0000000d")).supervisorPid, "SIGHUP");
    const result = await run.result;
    expect(result.code).toBe(4);
    expect((await readChainRecord(repo, "chain-0000000d")).stop).toMatchObject({ reason: "stop-requested", detail: "the supervisor was signalled" });
    expect(await lockState(repo)).toEqual({ kind: "free" });
    expect(await fake.residue()).toEqual([]);
  }, 180_000);

  it("E5 an unforeseen error in a chain subcommand is exit 2, never main()'s 3 (review I8); an unknown subcommand is 1", async () => {
    const { repo, fake } = await target(false);
    const c = capture({ env: fake.env(), gateCheck: async () => { throw new Error("gate probe exploded"); } });
    expect(await runChainCommand(START(repo, "chain-0000000e").slice(1), c.deps)).toBe(2);
    expect(c.err.join("").startsWith("orca chain: Error: gate probe exploded")).toBe(true);
    const u = capture();
    expect(await runChainCommand(["pause"], u.deps)).toBe(1);
  }, 60_000);

  it("E10 the default gate check reads deps.env, not the ambient process.env (controller note on Task 7 review)", async () => {
    const { repo } = await target(true);
    // A harmless stand-in for the ambient environment: no settings.json inside it, so a checkGate that (wrongly) fell
    // back to process.env would read this and pass — proving the failure below can only come from deps.env.
    const harmless = await mkdtemp(join(tmpdir(), "orca-gate-harmless-"));
    // What deps.env is meant to be read from: the launch adapter's own CLAUDE_CONFIG_DIR, poisoned with
    // disableAllHooks so the gate check must refuse it (plan PC-19).
    const poisoned = await mkdtemp(join(tmpdir(), "orca-gate-poison-"));
    await writeFile(join(poisoned, "settings.json"), JSON.stringify({ disableAllHooks: true }));
    const savedConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = harmless; // Rule 17/CLAUDE.md: never let this criterion read the real ~/.claude.
    cleanups.push(async () => {
      if (savedConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = savedConfigDir;
      await rm(harmless, { recursive: true, force: true });
      await rm(poisoned, { recursive: true, force: true });
    });
    const c = capture();
    // Direct mutation after construction (same pattern as W16's `s.deps.claudeBin = …`), which defaultChainDeps's
    // lazy `deps.env` read must honour.
    c.deps.env = { ...process.env, CLAUDE_CONFIG_DIR: poisoned };
    // A preflight-time refusal (D-launch spec §4.3): exit 1, nothing written — not the in-loop gate-check-failed's 2.
    expect(await runChainCommand(START(repo, "chain-0000000c").slice(1), c.deps)).toBe(1);
    expect(c.err.join("")).toContain("rejected: gate-check-failed");
    expect(c.err.join("")).toContain("disableAllHooks");
    expect(existsSync(join(repo, ".orca", "chains"))).toBe(false);
  }, 60_000);

  it("E11 defaultChainDeps' own resume wiring routes through chainGit too, not just the test double's (fix round 1 follow-up)", async () => {
    // W30 (tests/chain/run.test.ts) only proves that test file's own handcrafted ChainDeps mirrors production
    // wiring — it never calls defaultChainDeps() at all. This exercises the shipped wiring itself, in-process
    // (capture() calls defaultChainDeps() directly), against the same trace mechanism W30 uses.
    // Two sessions, not one (measured, fix round 2): resume()'s first call (session 1, no checkpoint yet) only
    // runs `rev-parse --show-toplevel` and a `git log` that comes up empty before throwing "no-checkpoint" —
    // neither trips fsmonitor. It is latestCheckpoint's `diff-tree` call, reached only once a prior session's
    // checkpoint exists (i.e. session 2's resume()), that does.
    const { repo, fake } = await target();
    const trace = join(fake.dir, "hook-trace.txt");
    await writeFile(join(repo, ".git", "hooks", "pre-commit"), `#!/bin/sh\necho pre-commit >> '${trace}'\nexit 0\n`, { mode: 0o755 });
    const monitor = join(repo, ".git", "fsmonitor.sh");
    await writeFile(monitor, `#!/bin/sh\necho fsmonitor >> '${trace}'\nexit 1\n`, { mode: 0o755 });
    await git(repo, ["config", "core.fsmonitor", monitor]);
    await fake.scenario(1, { steps: [{ do: "commit", file: "one.txt" }, { do: "exitCheckpoint", status: "continue" }], result: { subtype: "success", cost: 0.1 } });
    await fake.scenario(2, { steps: [{ do: "commit", file: "two.txt" }, { do: "exitCheckpoint", status: "done", next: [] }], result: { subtype: "success", cost: 0.1 } });
    const c = capture();
    c.deps.env = fake.env();
    expect(await runChainCommand(START(repo, "chain-0000000b").slice(1), c.deps)).toBe(0);
    expect(existsSync(trace)).toBe(false);
  }, 60_000);

  it("E6 orca chain stop: refused without a running chain; with one, it writes the request the supervisor latches", async () => {
    const { repo } = await target(false);
    const none = capture();
    expect(await runChainCommand(["stop", "--repo", repo], none.deps)).toBe(1);
    expect(none.err.join("")).toContain("rejected: no-running-chain: ");
    await commitChainRecord(repo, recordFixture({ chainId: "chain-0000000f" }), "m");
    const lock = await acquireChainLock(repo, "chain-0000000f");
    cleanups.push(() => lock.release());
    const ok = capture();
    expect(await runChainCommand(["stop", "--repo", repo], ok.deps)).toBe(0);
    expect(existsSync(await stopRequestPath(repo, "chain-0000000f"))).toBe(true);
    const bad = capture();
    expect(await runChainCommand(["stop", "--repo", repo, "--chain-id", "chain-XYZ"], bad.deps)).toBe(1);
    expect(bad.err.join("")).toContain("rejected: chain-id-invalid: ");
  }, 60_000);

  it("E7 orca chain unlock: refuses when nothing is locked or the holder is alive; otherwise removes the lock and ends the record (review M13, plan PC-6)", async () => {
    const { repo } = await target(false);
    const none = capture();
    expect(await runChainCommand(["unlock", "--repo", repo], none.deps)).toBe(1);
    expect(none.err.join("")).toContain("rejected: no-chain-lock: ");
    await commitChainRecord(repo, recordFixture({ chainId: "chain-0000000f" }), "m");
    const lock = await acquireChainLock(repo, "chain-0000000f");
    const live = capture();
    expect(await runChainCommand(["unlock", "--repo", repo], live.deps)).toBe(1);
    expect(live.err.join("")).toContain("rejected: chain-running: ");
    expect(existsSync(await chainLockDir(repo))).toBe(true);
    await writeFile(join(await chainLockDir(repo), "holder.json"), JSON.stringify({ chainId: "chain-0000000f", pid: process.pid, startedAt: "never" }));
    const stale = capture();
    expect(await runChainCommand(["unlock", "--repo", repo], stale.deps)).toBe(0);
    await lock.release();
    expect(existsSync(await chainLockDir(repo))).toBe(false);
    const r = await readChainRecord(repo, "chain-0000000f");
    expect([r.state, r.stop?.reason, r.stop?.category]).toEqual(["stopped", "unlocked-by-human", "anomaly"]);
    expect((await git(repo, ["log", "-1", "--format=%s"])).trim()).toBe("chore(chain): chain-0000000f, stopped, unlocked-by-human");
    expect((await git(repo, ["show", "--name-only", "--format=", "HEAD"])).trim()).toBe(".orca/chains/chain-0000000f.json");
  }, 60_000);
});
