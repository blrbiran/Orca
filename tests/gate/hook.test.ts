import { spawn } from "node:child_process";
import { chmod, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { gateHookClaudeCode } from "../../src/gate/hook.js";
import { git } from "../../src/scheduler/gitExec.js";
import { runCli } from "../helpers/runCli.js";
import { tempRepo } from "../helpers/tempRepo.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PUSH_LINE =
  "orca gate: push is Tier 0 (CLAUDE.md Rule 15) — do not retry or rephrase it; list it under awaitingHuman in the checkpoint and continue with reversible work.\n";
const stdin = (command: string, cwd = "/", extra: Record<string, unknown> = {}) =>
  JSON.stringify({ session_id: "s", transcript_path: "/t.jsonl", cwd, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, ...extra });

function run(file: string, args: string[], input: string, env: NodeJS.ProcessEnv) {
  return new Promise<{ code: number | null; stderr: string; ms: number }>((resolvePromise, reject) => {
    const started = Date.now();
    const child = spawn(file, args, { env });
    let stderr = "";
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code, stderr, ms: Date.now() - started }));
    child.stdin.end(input);
  });
}

describe("orca gate --hook claude-code (Tier 0 gate spec 4, 6.2)", () => {
  it("through the real process: a push exits 2 with the one literal line; a status exits 0 silently; another runtime is refused with 1", async () => {
    const blocked = await runCli(["gate", "--hook", "claude-code"], stdin("git push"));
    expect([blocked.code, blocked.stdout, blocked.stderr]).toEqual([2, "", PUSH_LINE]);
    const allowed = await runCli(["gate", "--hook", "claude-code"], stdin("git status"));
    expect([allowed.code, allowed.stdout, allowed.stderr]).toEqual([0, "", ""]);
    const other = await runCli(["gate", "--hook", "codex"], stdin("git push"));
    expect(other.code).toBe(1);
  });

  it("lets a tool that is not Bash through, and gates a subagent's call like the main session's", async () => {
    expect(await gateHookClaudeCode(JSON.stringify({ tool_name: "Edit", tool_input: { file_path: "/x" }, cwd: "/" }))).toEqual({ exitCode: 0, stderr: "" });
    expect(await gateHookClaudeCode(stdin("git push", "/", { agent_id: "a0fdd46fd31394cf6", agent_type: "general-purpose" }))).toEqual({
      exitCode: 2,
      stderr: PUSH_LINE,
    });
  });

  it("fails closed on input it cannot read and on a classifier that throws (spec 4 layer 1)", async () => {
    expect(await gateHookClaudeCode("not json")).toEqual({
      exitCode: 2,
      stderr:
        "orca gate: this command is Tier 0 (CLAUDE.md Rule 15) — do not retry or rephrase it; list it under awaitingHuman in the checkpoint and continue with reversible work. Could not decide: hook input is not JSON.\n",
    });
    expect(await gateHookClaudeCode(JSON.stringify({ tool_input: { command: "ls" }, cwd: "/" }))).toEqual({
      exitCode: 2,
      stderr:
        "orca gate: this command is Tier 0 (CLAUDE.md Rule 15) — do not retry or rephrase it; list it under awaitingHuman in the checkpoint and continue with reversible work. Could not decide: hook input lacks tool_name, tool_input.command or cwd.\n",
    });
    const boom = async () => {
      throw new Error("boom");
    };
    expect(await gateHookClaudeCode(stdin("ls"), { classify: boom })).toEqual({
      exitCode: 2,
      stderr:
        "orca gate: this command is Tier 0 (CLAUDE.md Rule 15) — do not retry or rephrase it; list it under awaitingHuman in the checkpoint and continue with reversible work. Could not decide: boom.\n",
    });
  });

  it("reads the real current branch: a merge on main exits 2, on another branch 0", async () => {
    const repo = await tempRepo();
    const merged = await runCli(["gate", "--hook", "claude-code"], stdin("git merge x", repo));
    expect(merged.code).toBe(2);
    await git(repo, ["checkout", "-q", "-b", "feat"]);
    const onFeat = await runCli(["gate", "--hook", "claude-code"], stdin("git merge x", repo));
    expect([onFeat.code, onFeat.stderr]).toEqual([0, ""]);
  });

  it("blocks within the hook's 10 s when git hangs, naming the 5 s deadline (spec 4)", async () => {
    const bin = await realpath(await mkdtemp(join(tmpdir(), "orca-slow-git-")));
    await writeFile(join(bin, "git"), "#!/bin/sh\nexec sleep 30\n");
    await chmod(join(bin, "git"), 0o755);
    const cwd = await realpath(await mkdtemp(join(tmpdir(), "orca-gate-cwd-")));
    const out = await run(join(repoRoot, "node_modules", ".bin", "tsx"), [join(repoRoot, "src", "cli.ts"), "gate", "--hook", "claude-code"], stdin("git merge x", cwd), {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
    });
    expect(out.code).toBe(2);
    expect(out.ms).toBeLessThan(10_000);
    expect(out.stderr).toBe(
      `orca gate: this command is Tier 0 (CLAUDE.md Rule 15) — do not retry or rephrase it; list it under awaitingHuman in the checkpoint and continue with reversible work. Could not decide: cannot read the current branch of ${cwd}: the gate's 5 s deadline ran out.\n`,
    );
  }, 20_000);

  it("prefilter: exits 0 only for a command naming neither git nor gh (plan PC-1)", async () => {
    const prefilter = join(repoRoot, "scripts", "gate-prefilter.mjs");
    const code = async (input: string) => (await run(process.execPath, [prefilter], input, process.env)).code;
    expect(await code(stdin("npm ci", "/Users/me/github/high"))).toBe(0);
    expect(await code(stdin("git status"))).toBe(1);
    expect(await code(stdin("gh pr view 1"))).toBe(1);
    expect(await code("not json")).toBe(1);
    expect(await code(JSON.stringify({ tool_input: {} }))).toBe(1);
  });
});
