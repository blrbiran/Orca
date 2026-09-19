import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { checkGate } from "../../src/chain/gateCheck.js";
import { makeChainRepo } from "../helpers/chainRepo.js";

let cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanups) await c();
  cleanups = [];
});
async function fixture(): Promise<string> {
  const repo = await makeChainRepo({ gate: true });
  cleanups.push(repo.cleanup);
  return repo.path;
}
async function emptyDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "orca-gate-home-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
/** Plan PC-19: the user-level settings lookup always lands in an empty temporary directory, never the person's ~/.claude. */
async function safeEnv(over: NodeJS.ProcessEnv = {}): Promise<NodeJS.ProcessEnv> {
  return { ...process.env, CLAUDE_CONFIG_DIR: await emptyDir(), HOME: await emptyDir(), ...over };
}
async function editSettings(repo: string, edit: (s: any) => void): Promise<void> {
  const path = join(repo, ".claude", "settings.json");
  const s = JSON.parse(await readFile(path, "utf8"));
  edit(s);
  await writeFile(path, JSON.stringify(s, null, 2));
}
const HOOK_TS = (body: string) => `export async function gateHookClaudeCode(): Promise<{ exitCode: 0 | 2; stderr: string }> {\n  ${body}\n}\n`;
const MUST_BLOCK = "the gate hook let the must-block sample through: git push exited ";

/**
 * Final review Important-1: a prefilter that moves a `sleep 3171` into its own session with the hook's stderr as its
 * own, and records its pid so the test can confirm it was alive and then kill it (the check cannot: it never learns the
 * pid). `then` is what the prefilter does next: fall through to the real gate, or hang like a stuck gate.
 */
const ESCAPING_PREFILTER = (then: string) =>
  [
    'import { spawn } from "node:child_process";',
    'import { appendFileSync } from "node:fs";',
    'const c = spawn("sleep", ["3171"], { detached: true, stdio: ["ignore", "ignore", "inherit"] });',
    'appendFileSync(`${process.env.CLAUDE_PROJECT_DIR}/escaped.pids`, `${c.pid}\\n`);',
    "c.unref();",
    then,
    "",
  ].join("\n");
/** Confirms each recorded escaped pid is still one of our sleeps, kills it, and returns what `ps` saw beforehand. */
async function killEscaped(repo: string): Promise<string[]> {
  const pids = (await readFile(join(repo, "escaped.pids"), "utf8").catch(() => "")).split("\n").filter((l) => l !== "");
  const seen: string[] = [];
  for (const pid of pids) {
    const command = (await promisify(execFile)("ps", ["-o", "command=", "-p", pid]).then((r) => r.stdout, () => "")).trim();
    seen.push(command);
    if (command === "sleep 3171") process.kill(Number(pid), "SIGKILL");
  }
  return seen;
}

describe("checkGate: D-launch spec §5.2 items 1–3 (review C1), with must-catch samples", () => {
  it("K0 an intact copy of this checkout's gate passes", async () => {
    expect(await checkGate(await fixture(), await safeEnv())).toEqual({ ok: true });
  }, 30_000);

  it("K1 PreToolUse removed", async () => {
    const repo = await fixture();
    await editSettings(repo, (s) => delete s.hooks.PreToolUse);
    expect(await checkGate(repo, await safeEnv())).toEqual({ ok: false, reason: ".claude/settings.json hooks.PreToolUse is not exactly the Tier 0 gate hook of src/gate/settings.ts" });
  });

  it("K2 the hook command changed by one character", async () => {
    const repo = await fixture();
    await editSettings(repo, (s) => (s.hooks.PreToolUse[0].hooks[0].command += " "));
    expect(await checkGate(repo, await safeEnv())).toEqual({ ok: false, reason: ".claude/settings.json hooks.PreToolUse is not exactly the Tier 0 gate hook of src/gate/settings.ts" });
  }, 30_000);

  it("K3 one deny entry missing", async () => {
    const repo = await fixture();
    await editSettings(repo, (s) => s.permissions.deny.pop());
    expect(await checkGate(repo, await safeEnv())).toEqual({ ok: false, reason: ".claude/settings.json permissions.deny is not exactly the Tier 0 deny list of src/gate/settings.ts" });
  }, 30_000);

  it("K4 disableAllHooks in settings.json (plan PC-5)", async () => {
    const repo = await fixture();
    await editSettings(repo, (s) => (s.disableAllHooks = true));
    expect(await checkGate(repo, await safeEnv())).toEqual({ ok: false, reason: ".claude/settings.json sets disableAllHooks, which switches every hook off" });
  }, 30_000);

  it("K5 settings.local.json exists", async () => {
    const repo = await fixture();
    await writeFile(join(repo, ".claude", "settings.local.json"), "{}\n");
    expect(await checkGate(repo, await safeEnv())).toEqual({
      ok: false,
      reason: ".claude/settings.local.json exists: its disableAllHooks can switch the gate off, and git does not see the file",
    });
  }, 30_000);

  it("K6 settings.json is not JSON", async () => {
    const repo = await fixture();
    await writeFile(join(repo, ".claude", "settings.json"), "{");
    const r = await checkGate(repo, await safeEnv());
    expect(r.ok === false && r.reason.startsWith(".claude/settings.json cannot be read as JSON: ")).toBe(true);
  });

  it("K7 a prefilter that lets everything through: the push sample exits 0", async () => {
    const repo = await fixture();
    await writeFile(join(repo, "scripts", "gate-prefilter.mjs"), "process.exit(0);\n");
    const r = await checkGate(repo, await safeEnv());
    expect(r.ok === false && r.reason.startsWith(`${MUST_BLOCK}0`)).toBe(true);
  }, 30_000);

  it("K8 the gate code in the worktree changed to allow everything while the settings stay equal (spec §7-2)", async () => {
    const repo = await fixture();
    await writeFile(join(repo, "src", "gate", "hook.ts"), HOOK_TS('return { exitCode: 0, stderr: "" };'));
    const r = await checkGate(repo, await safeEnv());
    expect(r.ok === false && r.reason.startsWith(`${MUST_BLOCK}0`)).toBe(true);
  }, 30_000);

  it("K9 an exit 2 that is not the gate's own line", async () => {
    const repo = await fixture();
    await writeFile(join(repo, "src", "gate", "hook.ts"), HOOK_TS('return { exitCode: 2, stderr: "nope\\n" };'));
    const r = await checkGate(repo, await safeEnv());
    expect(r.ok === false && r.reason.startsWith(`${MUST_BLOCK}2, stderr "nope\\n"`)).toBe(true);
  }, 30_000);

  it("K10 a gate that blocks everything fails the must-pass sample", async () => {
    const repo = await fixture();
    await writeFile(join(repo, "src", "gate", "hook.ts"), HOOK_TS('return { exitCode: 2, stderr: "orca gate: everything is blocked\\n" };'));
    const r = await checkGate(repo, await safeEnv());
    expect(r.ok === false && r.reason.startsWith("the gate hook blocked the must-pass sample: git status exited 2")).toBe(true);
  }, 30_000);

  it("K11 every sample is new: a random uuid session_id, the real cwd, a transcript_path that exists (plan PC-18, review I3(b))", async () => {
    const repo = await fixture();
    // A probe gate that records what it was fed, then answers like the real one: blocks the push, passes the rest.
    await writeFile(
      join(repo, "src", "gate", "hook.ts"),
      [
        'import { appendFileSync, existsSync } from "node:fs";',
        "export async function gateHookClaudeCode(stdinText: string): Promise<{ exitCode: 0 | 2; stderr: string }> {",
        "  const input = JSON.parse(stdinText);",
        '  appendFileSync(`${process.env.CLAUDE_PROJECT_DIR}/probe-log.jsonl`, `${JSON.stringify({ ...input, transcriptExists: existsSync(input.transcript_path) })}\\n`);',
        '  return input.tool_input.command === "git push" ? { exitCode: 2, stderr: "orca gate: probe\\n" } : { exitCode: 0, stderr: "" };',
        "}",
        "",
      ].join("\n"),
    );
    expect(await checkGate(repo, await safeEnv())).toEqual({ ok: true });
    expect(await checkGate(repo, await safeEnv())).toEqual({ ok: true });
    const fed = (await readFile(join(repo, "probe-log.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { session_id: string; cwd: string; transcript_path: string; transcriptExists: boolean; tool_input: { command: string } });
    expect(fed.map((x) => [x.tool_input.command, x.cwd, x.transcriptExists])).toEqual([
      ["git push", repo, true],
      ["git status", repo, true],
      ["git push", repo, true],
      ["git status", repo, true],
    ]);
    const ids = fed.map((x) => x.session_id);
    expect(ids.every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(4);
    expect(new Set(fed.map((x) => x.transcript_path)).size).toBe(4);
  }, 60_000);

  it("K12 disableAllHooks in the user-level settings under $CLAUDE_CONFIG_DIR fails the check (plan PC-19, review I3(c))", async () => {
    const repo = await fixture();
    const config = await emptyDir();
    await writeFile(join(config, "settings.json"), '{"disableAllHooks": true}\n');
    expect(await checkGate(repo, await safeEnv({ CLAUDE_CONFIG_DIR: config }))).toEqual({
      ok: false,
      reason: `${join(config, "settings.json")} sets disableAllHooks, which switches every hook off, the gate included`,
    });
  });

  it("K13 without CLAUDE_CONFIG_DIR the user-level settings are $HOME/.claude/settings.json; an unreadable one fails too", async () => {
    const repo = await fixture();
    const home = await emptyDir();
    await mkdir(join(home, ".claude"));
    await writeFile(join(home, ".claude", "settings.json"), '{"disableAllHooks": true}\n');
    const env = { ...(await safeEnv({ HOME: home })) };
    delete env.CLAUDE_CONFIG_DIR;
    expect(await checkGate(repo, env)).toEqual({
      ok: false,
      reason: `${join(home, ".claude", "settings.json")} sets disableAllHooks, which switches every hook off, the gate included`,
    });
    await writeFile(join(home, ".claude", "settings.json"), "{");
    const broken = await checkGate(repo, env);
    expect(broken.ok === false && broken.reason.startsWith(`${join(home, ".claude", "settings.json")} cannot be read as JSON: `)).toBe(true);
  });
  it("K14 a prefilter that leaves an escaped process holding the hook's stderr: the check still returns, on the hook's own verdict (final review Important-1)", async () => {
    const repo = await fixture();
    // Before the repository is removed (cleanups run in order): the pid file lives in it.
    cleanups.unshift(async () => void (await killEscaped(repo)));
    await writeFile(join(repo, "scripts", "gate-prefilter.mjs"), ESCAPING_PREFILTER("process.exit(1);"));
    const t0 = Date.now();
    const r = await checkGate(repo, await safeEnv());
    const elapsed = Date.now() - t0;
    // Both samples fell through to the real gate, which blocked the push and passed the status.
    expect(r).toEqual({ ok: true });
    expect(elapsed).toBeLessThan(30_000);
    // The escaped sleeps were alive — still holding the pipe — when the check returned; then they are killed here.
    expect(await killEscaped(repo)).toEqual(["sleep 3171", "sleep 3171"]);
  }, 60_000);

  it("K15 a prefilter that hangs after leaving an escaped process: gate-check failure on the sample timeout, not a hang (final review Important-1)", async () => {
    const repo = await fixture();
    // Before the repository is removed (cleanups run in order): the pid file lives in it.
    cleanups.unshift(async () => void (await killEscaped(repo)));
    await writeFile(join(repo, "scripts", "gate-prefilter.mjs"), ESCAPING_PREFILTER("setInterval(() => {}, 1_000);"));
    const t0 = Date.now();
    const r = await checkGate(repo, await safeEnv());
    const elapsed = Date.now() - t0;
    expect(r).toEqual({ ok: false, reason: 'the gate hook did not finish the git push sample within 10000 ms; its process group was killed, stderr ""' });
    expect(elapsed).toBeGreaterThanOrEqual(10_000);
    expect(elapsed).toBeLessThan(30_000);
    expect(await killEscaped(repo)).toEqual(["sleep 3171"]);
  }, 60_000);

  it("K17 a prefilter that hangs on the must-pass sample only: gate-check failure naming that sample (final review Important-1)", async () => {
    const repo = await fixture();
    await writeFile(
      join(repo, "scripts", "gate-prefilter.mjs"),
      [
        'let input = "";',
        'process.stdin.on("data", (c) => (input += c));',
        'process.stdin.on("end", () => (JSON.parse(input).tool_input.command === "git status" ? setInterval(() => {}, 1_000) : process.exit(1)));',
        "",
      ].join("\n"),
    );
    const t0 = Date.now();
    const r = await checkGate(repo, await safeEnv());
    expect(r).toEqual({ ok: false, reason: 'the gate hook did not finish the git status sample within 10000 ms; its process group was killed, stderr ""' });
    expect(Date.now() - t0).toBeLessThan(30_000);
  }, 60_000);

  it("K16 stderr written after the hook's shell exited still counts while the drain lasts (final review Important-1)", async () => {
    const repo = await fixture();
    // The gate line comes from a child in the hook's own group, 300 ms after the hook itself answered exit 2.
    await writeFile(
      join(repo, "src", "gate", "hook.ts"),
      [
        'import { spawn } from "node:child_process";',
        "export async function gateHookClaudeCode(stdinText: string): Promise<{ exitCode: 0 | 2; stderr: string }> {",
        '  if (JSON.parse(stdinText).tool_input.command !== "git push") return { exitCode: 0, stderr: "" };',
        '  spawn("/bin/sh", ["-c", "sleep 0.3; printf \'orca gate: late\\\\n\' >&2"], { stdio: ["ignore", "ignore", "inherit"] }).unref();',
        '  return { exitCode: 2, stderr: "" };',
        "}",
        "",
      ].join("\n"),
    );
    expect(await checkGate(repo, await safeEnv())).toEqual({ ok: true });
  }, 30_000);

  it("K18 settling a successful check kills the hook's same-group children before test cleanup (spec §13 item 3)", async () => {
    const repo = await fixture();
    const children = async (): Promise<Array<{ pid: number; command: string }>> => {
      const pids = (await readFile(join(repo, "same-group.pids"), "utf8").catch(() => "")).trim().split("\n").filter(Boolean);
      return Promise.all(pids.map(async (pid) => ({
        pid: Number(pid),
        command: (await promisify(execFile)("ps", ["-o", "command=", "-p", pid]).then((r) => r.stdout, () => "")).trim(),
      })));
    };
    // Cleanup runs even when the deletion mutation leaves both children alive.
    cleanups.unshift(async () => {
      for (const child of await children()) {
        if (child.command === "sleep 3172") {
          try { process.kill(child.pid, "SIGKILL"); } catch { /* Already exited. */ }
        }
      }
    });
    await writeFile(join(repo, "scripts", "gate-prefilter.mjs"), [
      'import { spawn } from "node:child_process";',
      'import { appendFileSync } from "node:fs";',
      'const c = spawn("sleep", ["3172"], { stdio: ["ignore", "ignore", "inherit"] });',
      'c.once("spawn", () => {',
      '  process.kill(c.pid, 0);',
      '  appendFileSync(`${process.env.CLAUDE_PROJECT_DIR}/same-group.pids`, `${c.pid}\\n`);',
      '  process.exit(1);',
      '});',
      '',
    ].join("\n"));
    expect(await checkGate(repo, await safeEnv())).toEqual({ ok: true });
    // Positive control: both samples really launched a live child.
    expect((await children()).length).toBe(2);
    await expect.poll(async () => (await children()).filter((c) => c.command === "sleep 3172"), { timeout: 2_000 }).toEqual([]);
  }, 30_000);
});
