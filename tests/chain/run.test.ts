import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NO_CHECKPOINT_TEXT } from "../../src/chain/decide.js";
import { chainGit } from "../../src/chain/git.js";
import { resumeOutcome } from "../../src/checkpoint/resume.js";
import type { GateCheck } from "../../src/chain/gateCheck.js";
import { launchClaudeCode } from "../../src/chain/launch/claudeCode.js";
import { lockState } from "../../src/chain/lock.js";
import { stopRequestPath } from "../../src/chain/paths.js";
import { readChainRecord } from "../../src/chain/recordSchema.js";
import { type ChainDeps, pollForStop, startChain } from "../../src/chain/run.js";
import { git } from "../../src/scheduler/gitExec.js";
import { isolateChainEnv } from "../helpers/chainEnv.js";
import { ORCA_ROOT, makeChainRepo } from "../helpers/chainRepo.js";
import { type FakeClaude, type Step, fakeClaude } from "../helpers/fakeClaude.js";

const ID = "chain-0000000a";
const REL = `.orca/chains/${ID}.json`;
const SIDS = [
  "11111111-0000-4000-8000-000000000001",
  "22222222-0000-4000-8000-000000000002",
  "33333333-0000-4000-8000-000000000003",
  "44444444-0000-4000-8000-000000000004",
];
const work = (n: number): Step => ({ do: "commit", file: `work-${n}.txt` });
const cont: Step = { do: "exitCheckpoint", status: "continue" };
const done: Step = { do: "exitCheckpoint", status: "done", why: "goal met", next: [] };
const subject = (what: string) => `chore(chain): ${ID}, ${what}`;

let cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanups.reverse()) await c();
  cleanups = [];
});

async function setup(opts: { brokenShebang?: boolean } = {}) {
  const target = await makeChainRepo({ gate: false });
  const fake = await fakeClaude(opts);
  cleanups.push(target.cleanup, fake.teardown);
  const out: string[] = [];
  const err: string[] = [];
  const notes: Array<[string, string]> = [];
  let calls = 0;
  let gateHook = async (_call: number, _repo: string): Promise<GateCheck> => ({ ok: true });
  let next = 0;
  const deps: ChainDeps = {
    launch: launchClaudeCode,
    // Controller ruling on W30: production wiring routes resume's own git calls through chainGit too (plan
    // PC-20) — mirrored here, not through defaultChainDeps() which this handcrafted ChainDeps bypasses
    // entirely, so W30's assertion actually exercises the fix instead of silently missing it.
    resume: (opts) => resumeOutcome({ ...opts, git: chainGit }),
    gateCheck: (repo) => gateHook(++calls, repo),
    notify: async (title, body) => {
      notes.push([title, body]);
      return null;
    },
    out: (t) => void out.push(t),
    err: (t) => void err.push(t),
    now: () => new Date(),
    newSessionId: () => SIDS[next++],
    claudeBin: "claude",
    env: fake.env(),
    pollMs: 100,
    graceMs: 300,
    supervisorRoot: ORCA_ROOT,
  };
  const repo = target.path;
  return {
    repo,
    fake,
    deps,
    out,
    err,
    notes,
    stopPath: () => stopRequestPath(repo, ID),
    gate: (h: (call: number, repo: string) => Promise<GateCheck>) => {
      gateHook = h;
    },
    run: (over: Record<string, unknown> = {}) =>
      startChain({ repo, by: "tester", goal: "the goal", maxSessions: 3, maxCostUsd: 5, chainId: ID, via: "cli", ...over }, deps),
  };
}
const record = (repo: string) => readChainRecord(repo, ID);
const subjects = async (repo: string) => (await git(repo, ["log", "--format=%s", "--", REL])).trim().split("\n");
async function recordCommitPaths(repo: string): Promise<string[]> {
  const shas = (await git(repo, ["log", "--format=%H", "--", REL])).trim().split("\n");
  const out: string[] = [];
  for (const sha of shas) out.push((await git(repo, ["diff-tree", "--root", "--no-commit-id", "--name-only", "-r", sha])).trim());
  return out;
}
const promptOf = async (fake: FakeClaude, n: number) => (await fake.call(n))?.argv[1] ?? "";
async function budgetOf(fake: FakeClaude, n: number): Promise<string | undefined> {
  const argv = (await fake.call(n))?.argv ?? [];
  return argv[argv.indexOf("--max-budget-usd") + 1];
}

describe("startChain: the supervisor loop (D-launch spec §2, §4, §8.2-3)", () => {
  isolateChainEnv();

  it("W1 continue → continue → done: exit 0, one record commit per step, each touching only the record", async () => {
    const s = await setup();
    await s.fake.scenario(1, { steps: [work(1), cont], result: { subtype: "success", cost: 1.25 } });
    await s.fake.scenario(2, { steps: [work(2), cont], result: { subtype: "success", cost: 1 } });
    await s.fake.scenario(3, { steps: [work(3), done], result: { subtype: "success", cost: 0.5 } });
    expect(await s.run()).toBe(0);
    const r = await record(s.repo);
    expect(r.sessions.map((x) => [x.n, x.sessionRef, x.outcome, x.exitCode, x.subtype, x.costUsd, x.chain?.status, x.commits, x.exitCheckpoint, x.leftoverProcesses])).toEqual([
      [1, SIDS[0], "exited", 0, "success", 1.25, "continue", 1, ".orca/checkpoints/orca-dev-11111111.json", 0],
      [2, SIDS[1], "exited", 0, "success", 1, "continue", 1, ".orca/checkpoints/orca-dev-22222222.json", 0],
      [3, SIDS[2], "exited", 0, "success", 0.5, "done", 1, ".orca/checkpoints/orca-dev-33333333.json", 0],
    ]);
    expect([r.state, r.stop?.reason, r.stop?.category, r.stop?.detail, r.stop?.awaitingHuman]).toEqual(["stopped", "done", "done", "goal met", []]);
    expect([r.startedBy, r.goal, r.limits, r.model, r.branch]).toEqual([
      { via: "cli", by: "tester" }, "the goal", { maxSessions: 3, maxCostUsd: 5, sessionTimeoutMin: 360 }, "orca-fake-model", "main",
    ]);
    expect((await s.fake.call(1))?.argv.slice(6, 8)).toEqual(["--model", "orca-fake-model"]);
    expect(await subjects(s.repo)).toEqual([subject("session 3, done"), subject("session 2, continue"), subject("session 1, continue"), subject("started")]);
    expect(await recordCommitPaths(s.repo)).toEqual([REL, REL, REL, REL]);
    expect([await budgetOf(s.fake, 1), await budgetOf(s.fake, 2), await budgetOf(s.fake, 3)]).toEqual(["5", "3.75", "2.75"]);
    expect(await promptOf(s.fake, 1)).toContain(NO_CHECKPOINT_TEXT);
    const p2 = await promptOf(s.fake, 2);
    expect(p2).toContain(`Your session id is ${SIDS[1]}.`);
    expect(p2).toContain(`run orca-dev-11111111, session ${SIDS[0]}, written `);
    expect(s.notes).toEqual([["orca chain done", `${ID}: done`]]);
    expect(s.out.join("")).toContain(`orca chain: started ${ID}\n`);
    expect(s.out.join("")).toContain(`orca chain ${ID} stopped: done (done)\n`);
    expect(await lockState(s.repo)).toEqual({ kind: "free" });
  }, 60_000);

  it("W2 blocked: exit 3, awaitingHuman carried into the record and the summary", async () => {
    const s = await setup();
    await s.fake.scenario(1, {
      steps: [work(1), { do: "exitCheckpoint", status: "blocked", why: "only the push is left", awaitingHuman: [{ kind: "irreversible", what: "push main" }] }],
    });
    expect(await s.run()).toBe(3);
    expect((await record(s.repo)).stop).toMatchObject({ reason: "blocked", category: "blocked", detail: "only the push is left", awaitingHuman: ["[irreversible] push main"] });
    expect(s.out.join("")).toContain("awaiting a human:\n  - [irreversible] push main\n");
  }, 30_000);

  it("W3 a session with no commit outside .orca/checkpoints: no-progress, exit 4", async () => {
    const s = await setup();
    await s.fake.scenario(1, { steps: [cont] });
    expect(await s.run()).toBe(4);
    const r = await record(s.repo);
    expect([r.stop?.reason, r.sessions[0].commits]).toEqual(["no-progress", 0]);
  }, 30_000);

  it("W4 a stop request before the first session: no session starts", async () => {
    const s = await setup();
    const stop = await s.stopPath();
    await mkdir(dirname(stop), { recursive: true });
    await writeFile(stop, "");
    expect(await s.run()).toBe(4);
    const r = await record(s.repo);
    expect([r.stop?.reason, r.sessions.length, await s.fake.call(1)]).toEqual(["stop-requested", 0, null]);
    expect(await subjects(s.repo)).toEqual([subject("stopped, stop-requested"), subject("started")]);
  }, 30_000);

  it("W5 a stop request written during a session and deleted before it ends is latched (review I10)", async () => {
    const s = await setup();
    const stop = await s.stopPath();
    await s.fake.scenario(1, { steps: [{ do: "touch", path: stop }, { do: "sleep", ms: 600 }, { do: "rm", path: stop }, work(1), cont] });
    expect(await s.run()).toBe(4);
    expect((await record(s.repo)).stop).toMatchObject({ reason: "stop-requested", category: "limit", detail: null });
    expect(await subjects(s.repo)).toEqual([subject("session 1, stop-requested"), subject("started")]);
  }, 30_000);

  it("W6 the budget ran out inside the session (error_max_budget_usd): max-cost, exit 4", async () => {
    const s = await setup();
    await s.fake.scenario(1, { steps: [], result: { subtype: "error_max_budget_usd", cost: 1.2 }, exitCode: 1 });
    expect(await s.run()).toBe(4);
    const r = await record(s.repo);
    expect([r.stop?.reason, r.stop?.detail, r.sessions[0].costUsd]).toEqual(["max-cost", "the session ran out of its --max-budget-usd", 1.2]);
  }, 30_000);

  it("W7 the cumulative cost reaches the limit; each session gets only what is left", async () => {
    const s = await setup();
    await s.fake.scenario(1, { steps: [work(1), cont], result: { subtype: "success", cost: 0.6 } });
    await s.fake.scenario(2, { steps: [work(2), cont], result: { subtype: "success", cost: 0.6 } });
    expect(await s.run({ maxCostUsd: 1 })).toBe(4);
    expect([(await record(s.repo)).stop?.reason, await budgetOf(s.fake, 1), await budgetOf(s.fake, 2)]).toEqual(["max-cost", "1", "0.4"]);
  }, 30_000);

  it("W8 the session limit: max-sessions, exit 4", async () => {
    const s = await setup();
    await s.fake.scenario(1, { steps: [work(1), cont] });
    await s.fake.scenario(2, { steps: [work(2), cont] });
    expect(await s.run({ maxSessions: 2 })).toBe(4);
    const r = await record(s.repo);
    expect([r.stop?.reason, r.sessions.length]).toEqual(["max-sessions", 2]);
  }, 30_000);

  it("W9 a dirty worktree after the session: the final record is still committed, alone, and the dirt stays", async () => {
    const s = await setup();
    await s.fake.scenario(1, { steps: [work(1), cont, { do: "write", file: "dirt.txt" }] });
    expect(await s.run()).toBe(2);
    expect((await record(s.repo)).stop?.reason).toBe("dirty-after-session");
    expect(await recordCommitPaths(s.repo)).toEqual([REL, REL]);
    expect(await git(s.repo, ["status", "--porcelain"])).toBe("?? dirt.txt\n");
    expect(await lockState(s.repo)).toEqual({ kind: "free" });
  }, 30_000);

  it("W10 a guarded path committed in the session: gate-modified, naming it", async () => {
    const s = await setup();
    await s.fake.scenario(1, { steps: [{ do: "commit", file: ".orca/level.json", content: "{}\n" }, cont] });
    expect(await s.run()).toBe(2);
    expect((await record(s.repo)).stop).toMatchObject({ reason: "gate-modified", category: "anomaly", detail: ".orca/level.json" });
  }, 30_000);

  it("W11 settings.local.json created (ignored, so the worktree looks clean): gate-modified", async () => {
    const s = await setup();
    await s.fake.scenario(1, { steps: [{ do: "write", file: ".claude/settings.local.json", content: "{}\n" }, work(1), cont] });
    expect(await s.run()).toBe(2);
    expect((await record(s.repo)).stop).toMatchObject({ reason: "gate-modified", detail: ".claude/settings.local.json" });
  }, 30_000);

  it("W12 the session switched branches: branch-changed; the final record lands where HEAD is", async () => {
    const s = await setup();
    await s.fake.scenario(1, { steps: [{ do: "git", args: ["checkout", "-q", "-b", "other"] }, work(1), cont] });
    expect(await s.run()).toBe(2);
    expect((await record(s.repo)).stop?.reason).toBe("branch-changed");
    expect([(await git(s.repo, ["rev-parse", "--abbrev-ref", "HEAD"])).trim(), (await subjects(s.repo))[0]]).toEqual(["other", subject("session 1, branch-changed")]);
  }, 30_000);

  it("W13 the session rewrote the commit it started from: history-rewritten", async () => {
    const s = await setup();
    await s.fake.scenario(1, { steps: [{ do: "git", args: ["commit", "-q", "--amend", "-m", "rewritten start"] }, work(1), cont] });
    expect(await s.run()).toBe(2);
    expect((await record(s.repo)).stop?.reason).toBe("history-rewritten");
  }, 30_000);

  it("W14 no exit checkpoint: no-exit-checkpoint", async () => {
    const s = await setup();
    await s.fake.scenario(1, { steps: [work(1)] });
    expect(await s.run()).toBe(2);
    expect((await record(s.repo)).stop?.reason).toBe("no-exit-checkpoint");
  }, 30_000);

  it("W15 the timeout: session-timeout, the cost is unreadable and says so", async () => {
    const s = await setup();
    await s.fake.scenario(1, { steps: [{ do: "sleep", ms: 10_000 }] });
    expect(await s.run({ sessionTimeoutMin: 0.005 })).toBe(2);
    const r = await record(s.repo);
    expect([r.stop?.reason, r.sessions[0].outcome, r.sessions[0].exitCode, r.sessions[0].costUsd, r.limits.sessionTimeoutMin]).toEqual(["session-timeout", "timeout", null, null, 0.005]);
    expect(s.out.join("")).toContain("cost: unreadable (a session reported no total_cost_usd)");
    expect(await s.fake.residue()).toEqual([]);
  }, 30_000);

  it("W16 a claude that cannot start: launch-failed", async () => {
    const s = await setup({ brokenShebang: true });
    // An absolute path (plan PC-24): a PATH walk would go on past the bad interpreter to the machine's real claude.
    s.deps.claudeBin = s.fake.claude;
    expect(await s.run()).toBe(2);
    const r = await record(s.repo);
    expect([r.stop?.reason, r.sessions[0].outcome]).toEqual(["launch-failed", "launch-failed"]);
    expect(r.stop?.detail).toContain("ENOENT");
  }, 30_000);

  it("W17 no result JSON: cost-unreadable", async () => {
    const s = await setup();
    await s.fake.scenario(1, { steps: [work(1), cont], result: null });
    expect(await s.run()).toBe(2);
    expect((await record(s.repo)).stop?.reason).toBe("cost-unreadable");
  }, 30_000);

  it("W18 a failed session: session-failed with the exit code and subtype", async () => {
    const s = await setup();
    await s.fake.scenario(1, { steps: [work(1), cont], result: { subtype: "error_during_execution", cost: 0.1 }, exitCode: 1 });
    expect(await s.run()).toBe(2);
    expect((await record(s.repo)).stop).toMatchObject({ reason: "session-failed", detail: "exit 1, subtype error_during_execution" });
  }, 30_000);

  it("W19 resume exit 2 (a measurement changed) does not stop the chain; the next session sees it (spec §4.4)", async () => {
    const s = await setup();
    await s.fake.scenario(1, {
      steps: [
        { do: "commit", file: "flag.txt" },
        { do: "exitCheckpoint", status: "continue", measurements: [{ command: "test -f flag.txt", exitCode: 0 }] },
        { do: "git", args: ["rm", "-q", "flag.txt"] },
        { do: "git", args: ["commit", "-q", "-m", "drop the flag"] },
      ],
    });
    await s.fake.scenario(2, { steps: [work(2), done] });
    expect(await s.run()).toBe(0);
    expect(await promptOf(s.fake, 2)).toContain("  CHANGED exit 0 -> 1: test -f flag.txt (output ");
  }, 30_000);

  it("W20 resume refused (a gated measurement): resume-failed before session 2", async () => {
    const s = await setup();
    await s.fake.scenario(1, { steps: [work(1), { do: "exitCheckpoint", status: "continue", measurements: [{ command: "git push origin main", exitCode: 0 }] }] });
    expect(await s.run()).toBe(2);
    const r = await record(s.repo);
    expect(r.stop?.reason).toBe("resume-failed");
    expect(r.stop?.detail?.startsWith('measurement-gated: measurement "git push origin main" was not run: orca gate: push is Tier 0')).toBe(true);
    expect([await s.fake.call(2), (await subjects(s.repo))[0]]).toEqual([null, subject("stopped, resume-failed")]);
  }, 30_000);

  it("W21 the gate check fails before session 2: gate-check-failed with the reason", async () => {
    const s = await setup();
    s.gate(async (call) => (call === 3 ? { ok: false, reason: "the reason" } : { ok: true }));
    await s.fake.scenario(1, { steps: [work(1), cont] });
    expect(await s.run()).toBe(2);
    const r = await record(s.repo);
    expect([r.stop?.reason, r.stop?.detail, r.sessions.length, (await subjects(s.repo))[0]]).toEqual(["gate-check-failed", "the reason", 1, subject("stopped, gate-check-failed")]);
  }, 30_000);

  it("W22 someone else dirtied the worktree between sessions: dirty-before-session", async () => {
    const s = await setup();
    s.gate(async (call, repo) => {
      if (call === 3) await writeFile(join(repo, "stray.txt"), "s\n");
      return { ok: true };
    });
    await s.fake.scenario(1, { steps: [work(1), cont] });
    expect(await s.run()).toBe(2);
    expect((await record(s.repo)).stop?.reason).toBe("dirty-before-session");
  }, 30_000);

  it("W23 the branch changed between sessions: branch-changed before session 2", async () => {
    const s = await setup();
    s.gate(async (call, repo) => {
      if (call === 3) await git(repo, ["checkout", "-q", "-b", "other"]);
      return { ok: true };
    });
    await s.fake.scenario(1, { steps: [work(1), cont] });
    expect(await s.run()).toBe(2);
    const r = await record(s.repo);
    expect([r.stop?.reason, r.sessions.length, (await subjects(s.repo))[0]]).toEqual(["branch-changed", 1, subject("stopped, branch-changed")]);
  }, 30_000);

  it("W24 a process the session left behind is counted in the record and ended", async () => {
    const s = await setup();
    await s.fake.scenario(1, { steps: [{ do: "background" }, work(1), done] });
    expect(await s.run()).toBe(0);
    expect((await record(s.repo)).sessions[0].leftoverProcesses).toBe(1);
    expect(await s.fake.residue()).toEqual([]);
  }, 30_000);

  it("W25 a refused record commit: record-commit-refused, exit 2, the file on disk says so, HEAD keeps the last committed record", async () => {
    const s = await setup();
    // Plan PC-20: hooks never run for the supervisor, so the refusal is a held index lock the session leaves behind.
    await s.fake.scenario(1, { steps: [work(1), cont, { do: "touch", path: join(s.repo, ".git", "index.lock") }] });
    expect(await s.run()).toBe(2);
    const onDisk = JSON.parse(await readFile(join(s.repo, REL), "utf8"));
    const atHead = JSON.parse(await git(s.repo, ["show", `HEAD:${REL}`]));
    expect([onDisk.state, onDisk.stop.reason, onDisk.sessions.length]).toEqual(["stopped", "record-commit-refused", 1]);
    expect(onDisk.stop.detail.startsWith(`${REL} is written but git refused to commit it: `)).toBe(true);
    expect([atHead.state, atHead.sessions.length]).toEqual(["running", 0]);
    expect(await lockState(s.repo)).toEqual({ kind: "free" });
  }, 30_000);

  it("W26 a failed notification is one warning line and changes nothing else (spec §5.3)", async () => {
    const s = await setup();
    s.deps.notify = async () => "osascript: boom";
    await s.fake.scenario(1, { steps: [work(1), done] });
    expect(await s.run()).toBe(0);
    expect(s.err.join("")).toContain("orca chain: warning: the macOS notification failed (osascript: boom); the chain record has the outcome\n");
  }, 30_000);

  it("W27 a chain in the supervisor's own checkout gets a warning (spec §7-6)", async () => {
    const s = await setup();
    s.deps.supervisorRoot = s.repo;
    await s.fake.scenario(1, { steps: [work(1), done] });
    expect(await s.run()).toBe(0);
    expect(s.err[0].startsWith(`orca chain: warning: ${s.repo} is the checkout this supervisor runs from`)).toBe(true);
  }, 30_000);

  it("W28 an unforeseen error inside the loop still ends the record, releases the lock and exits 2", async () => {
    const s = await setup();
    s.deps.launch = async () => {
      throw new Error("launch exploded");
    };
    expect(await s.run()).toBe(2);
    expect((await record(s.repo)).stop).toMatchObject({ reason: "supervisor-error", category: "anomaly", detail: "launch exploded" });
    expect((await subjects(s.repo))[0]).toBe(subject("stopped, supervisor-error"));
    expect(await lockState(s.repo)).toEqual({ kind: "free" });
  }, 30_000);

  it("W29 a stop request left at the end of a session is seen right after it (no polling needed)", async () => {
    const s = await setup();
    s.deps.pollMs = 60_000;
    await s.fake.scenario(1, { steps: [work(1), cont, { do: "touch", path: await s.stopPath() }] });
    expect(await s.run()).toBe(4);
    expect(await subjects(s.repo)).toEqual([subject("session 1, stop-requested"), subject("started")]);
  }, 30_000);

  it("W30 the target's pre-commit hook and fsmonitor never run for the supervisor (plan PC-20, review I4)", async () => {
    const s = await setup();
    const trace = join(s.fake.dir, "hook-trace.txt");
    await writeFile(join(s.repo, ".git", "hooks", "pre-commit"), `#!/bin/sh\necho pre-commit >> '${trace}'\nexit 0\n`, { mode: 0o755 });
    const monitor = join(s.repo, ".git", "fsmonitor.sh");
    await writeFile(monitor, `#!/bin/sh\necho fsmonitor >> '${trace}'\nexit 1\n`, { mode: 0o755 });
    await git(s.repo, ["config", "core.fsmonitor", monitor]);
    await s.fake.scenario(1, { steps: [work(1), cont] });
    await s.fake.scenario(2, { steps: [work(2), done] });
    expect(await s.run()).toBe(0);
    // The fake's own git calls skip both too (fake-claude.mjs), so any trace here would be the supervisor's.
    expect(existsSync(trace)).toBe(false);
  }, 60_000);

  it("W31 a session that deleted its own stdout log: cost-unreadable, not a supervisor error (plan PC-22, review M1)", async () => {
    const s = await setup();
    const log = join(s.repo, ".orca", "chain-logs", ID, "1.stdout.json");
    await s.fake.scenario(1, { steps: [work(1), cont, { do: "rm", path: log }], result: { subtype: "success", cost: 0.5 } });
    expect(await s.run()).toBe(2);
    expect((await record(s.repo)).stop?.reason).toBe("cost-unreadable");
  }, 30_000);

  it("W32 resume that throws (the CLI's exit 3) stops the chain as resume-failed before any session (spec §4.4, review M2)", async () => {
    const s = await setup();
    s.deps.resume = async () => {
      throw new Error("resume exploded");
    };
    expect(await s.run()).toBe(2);
    const r = await record(s.repo);
    expect([r.stop?.reason, r.stop?.detail, r.sessions.length, await s.fake.call(1)]).toEqual(["resume-failed", "resume threw: resume exploded", 0, null]);
  }, 30_000);
});

describe("pollForStop: onPoll's own logic, direct (review m1 — Task 6's launch adapter awaits it as `void req.onPoll?.()`)", () => {
  it("a throwing check resolves without rejecting, and does not latch", async () => {
    const latched = { value: false };
    await expect(pollForStop(() => Promise.reject(new Error("boom")), latched)).resolves.toBeUndefined();
    expect(latched.value).toBe(false);
  });

  it("a check that finds a stop request latches", async () => {
    const latched = { value: false };
    await pollForStop(() => Promise.resolve(true), latched);
    expect(latched.value).toBe(true);
  });

  it("once latched, the check is not called again", async () => {
    let calls = 0;
    const latched = { value: true };
    await pollForStop(async () => {
      calls += 1;
      return true;
    }, latched);
    expect(calls).toBe(0);
  });
});
