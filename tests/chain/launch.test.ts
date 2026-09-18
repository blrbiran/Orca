import { mkdtemp, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type LaunchRequest, claudeArgv, formatBudget, launchClaudeCode, parseResult } from "../../src/chain/launch/claudeCode.js";
import { type FakeClaude, fakeClaude } from "../helpers/fakeClaude.js";
import { tempRepo } from "../helpers/tempRepo.js";

const SID = "11111111-0000-4000-8000-000000000001";
let fakes: FakeClaude[] = [];
afterEach(async () => {
  for (const f of fakes) await f.teardown();
  fakes = [];
});

async function setup(opts: { brokenShebang?: boolean } = {}) {
  const fake = await fakeClaude(opts);
  fakes.push(fake);
  const repo = await tempRepo();
  const logDir = join(await realpath(await mkdtemp(join(tmpdir(), "orca-chain-logs-"))), "chain-0000000a");
  const req = (over: Partial<LaunchRequest> = {}): LaunchRequest => ({
    repo,
    prompt: "the prompt\nwith two lines",
    sessionId: SID,
    model: "claude-opus-5[1m]",
    budgetUsd: 2.5,
    timeoutMs: 20_000,
    logDir,
    n: 1,
    chainId: "chain-0000000a",
    baseEnv: fake.env(),
    graceMs: 300,
    pollMs: 100,
    ...over,
  });
  return { fake, repo, logDir, req };
}

describe("launchClaudeCode (D-launch spec §2.2-4/5, §4.2, §8.2-2)", () => {
  it("A1 the argv is the template, item for item", async () => {
    const { fake, req } = await setup();
    await launchClaudeCode(req());
    expect((await fake.call(1))?.argv).toEqual([
      "-p", "the prompt\nwith two lines", "--output-format", "json", "--permission-mode", "auto",
      "--model", "claude-opus-5[1m]", "--session-id", SID, "--max-budget-usd", "2.5",
    ]);
  });

  it("A2 the child env drops every class of variable that can switch hooks off or steer the wrapper, keeps the rest, and sets the two chain variables (plan PC-21)", async () => {
    const { fake, req } = await setup();
    const mustDrop = {
      CLAUDE_CODE_SIMPLE: "1",
      CLAUDE_CODE_SAFE_MODE: "1",
      CLAUDECODE: "1",
      CLAUDE_CODE_SESSION_ID: "parent-session",
      CLAUDE_CODE_MESSAGING_SOCKET: "/tmp/sock",
      CMUX_SURFACE_ID: "s",
      CMUX_ANYTHING: "x",
    };
    const mustKeep = { CLAUDE_CODE_ENTRYPOINT: "keep-1", CLAUDE_CODE_SESSIONS: "keep-2", CMUXLIKE: "keep-3", MY_CMUX_X: "keep-4", KEEP_ME: "yes" };
    await launchClaudeCode(req({ baseEnv: fake.env({ ...mustDrop, ...mustKeep, ORCA_CHAIN_ID: "stale" }) }));
    const env = (await fake.call(1))?.env ?? {};
    expect(Object.keys(mustDrop).filter((k) => k in env)).toEqual([]);
    expect(Object.keys(env).filter((k) => /^CMUX_|^CLAUDE_CODE_SESSION_|^CLAUDE_CODE_MESSAGING_/.test(k))).toEqual([]);
    expect(Object.fromEntries(Object.keys(mustKeep).map((k) => [k, env[k]]))).toEqual(mustKeep);
    expect([env.ORCA_CHAIN_ID, env.ORCA_CHAIN_SESSION]).toEqual(["chain-0000000a", SID]);
  });

  it("A3 stdin is /dev/null, cwd is the repository, stdout and stderr land in two files", async () => {
    const { fake, repo, logDir, req } = await setup();
    await fake.scenario(1, { result: { subtype: "success", cost: 0.25 }, stderr: "to stderr\n" });
    const r = await launchClaudeCode(req());
    const call = await fake.call(1);
    expect([call?.stdinIsDevNull, call?.cwd]).toEqual([true, repo]);
    expect([r.stdoutPath, r.stderrPath]).toEqual([join(logDir, "1.stdout.json"), join(logDir, "1.stderr.txt")]);
    expect(JSON.parse(await readFile(r.stdoutPath, "utf8"))).toEqual({
      type: "result", subtype: "success", is_error: false, total_cost_usd: 0.25, session_id: SID, num_turns: 1,
    });
    expect(await readFile(r.stderrPath, "utf8")).toBe("to stderr\n");
  });

  it("A4 reports the exit code, the cost and the subtype from the result JSON; nulls when there is none", async () => {
    const { fake, req } = await setup();
    await fake.scenario(1, { result: { subtype: "error_max_budget_usd", cost: 1.2 }, exitCode: 1 });
    expect(await launchClaudeCode(req())).toMatchObject({ outcome: { kind: "exited", exitCode: 1 }, costUsd: 1.2, subtype: "error_max_budget_usd", leftoverProcesses: 0 });
    await fake.scenario(2, { result: null, exitCode: 0 });
    expect(await launchClaudeCode(req({ n: 2 }))).toMatchObject({ outcome: { kind: "exited", exitCode: 0 }, costUsd: null, subtype: null });
  });

  it("A5 at the timeout the whole group gets SIGTERM, then SIGKILL after the grace; nothing is left", async () => {
    const { fake, req } = await setup();
    await fake.scenario(1, { steps: [{ do: "background" }, { do: "ignoreTerm" }, { do: "sleep", ms: 30_000 }] });
    const started = Date.now();
    const r = await launchClaudeCode(req({ timeoutMs: 300 }));
    expect(r.outcome).toEqual({ kind: "timeout" });
    expect([r.costUsd, r.subtype, r.leftoverProcesses]).toEqual([null, null, 0]);
    // Nominal about 0.6 s (300 ms timeout + 300 ms grace). The bound is loose on purpose (review M6: under the full suite
    // process start-up alone can take seconds); it only has to stay well below the fake's 30 s sleep, which is what a
    // missing SIGKILL would show.
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(await fake.residue()).toEqual([]);
  }, 45_000);

  it("A6 after a normal exit, a process the session left in its group is counted and killed", async () => {
    const { fake, req } = await setup();
    await fake.scenario(1, { steps: [{ do: "background" }] });
    const r = await launchClaudeCode(req());
    expect(r.outcome).toEqual({ kind: "exited", exitCode: 0 });
    expect(r.leftoverProcesses).toBe(1);
    expect(await fake.residue()).toEqual([]);
  }, 15_000);

  it("A7 a claude that cannot be executed is launch-failed, with the reason", async () => {
    const { fake, req } = await setup({ brokenShebang: true });
    // An absolute path (plan PC-24): through a PATH walk, execvp would go on past the bad interpreter to the next claude.
    const r = await launchClaudeCode(req({ claudeBin: fake.claude }));
    expect(r.outcome.kind === "launch-failed" && r.outcome.reason).toContain("ENOENT");
    const missing = await launchClaudeCode(req({ claudeBin: join(fake.bin, "no-such-claude") }));
    expect(missing.outcome.kind).toBe("launch-failed");
  });

  it("A8 an abort (the supervisor was signalled) ends the session through its group", async () => {
    const { fake, req } = await setup();
    await fake.scenario(1, { steps: [{ do: "sleep", ms: 30_000 }] });
    const abort = new AbortController();
    setTimeout(() => abort.abort(), 300);
    const r = await launchClaudeCode(req({ signal: abort.signal }));
    expect(r.outcome).toEqual({ kind: "exited", exitCode: null });
    expect(await fake.residue()).toEqual([]);
  }, 15_000);

  it("A10 a stdout log the session deleted reads as no result JSON, not as a crash (plan PC-22)", async () => {
    const { fake, logDir, req } = await setup();
    await fake.scenario(1, { steps: [{ do: "rm", path: join(logDir, "1.stdout.json") }], result: { subtype: "success", cost: 0.5 } });
    expect(await launchClaudeCode(req())).toMatchObject({ outcome: { kind: "exited", exitCode: 0 }, costUsd: null, subtype: null });
  });

  it("A9 onPoll runs while the session is alive (the supervisor latches stop requests there)", async () => {
    const { fake, req } = await setup();
    await fake.scenario(1, { steps: [{ do: "sleep", ms: 700 }] });
    let polls = 0;
    await launchClaudeCode(req({ onPoll: () => { polls += 1; } }));
    expect(polls).toBeGreaterThan(1);
  });
});

describe("launch adapter, pure parts", () => {
  it("U1 claudeArgv has exactly twelve items", () => {
    expect(claudeArgv({ prompt: "p", model: "m", sessionId: "s", budgetUsd: 1 })).toEqual([
      "-p", "p", "--output-format", "json", "--permission-mode", "auto", "--model", "m", "--session-id", "s", "--max-budget-usd", "1",
    ]);
  });
  it("U2 formatBudget floors to 1/10000 USD, never rounding up past what is left", () => {
    expect([formatBudget(18.765439), formatBudget(2.5), formatBudget(0.4)]).toEqual(["18.7654", "2.5", "0.4"]);
  });
  it("U3 parseResult reads the result object only", () => {
    expect(parseResult('noise\n{"type":"result","subtype":"success","total_cost_usd":0.5}\n')).toEqual({ costUsd: 0.5, subtype: "success" });
    expect(parseResult('{"type":"assistant","total_cost_usd":9}')).toEqual({ costUsd: null, subtype: null });
    expect(parseResult('{"type":"result","subtype":"success","total_cost_usd":-1}')).toEqual({ costUsd: null, subtype: "success" });
    expect(parseResult("")).toEqual({ costUsd: null, subtype: null });
  });
});
