import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findCommand } from "../../src/commands/registry.js";
import { GATE_HOOK_COMMAND, LEVEL_HOOK_COMMAND } from "../../src/gate/settings.js";

// CLI v2 spec §5 / plan Task 7: the Tier 0 gate hook must keep working at every commit. The hook strings are the single
// source of what .claude/settings.json runs; each must name a registered `orca dev` command (not an old top-level name
// that Task 14 deletes) and the settings file must carry the same bytes.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PUSH_LINE =
  "orca gate: push is Tier 0 (CLAUDE.md Rule 15) — do not retry or rephrase it; list it under awaitingHuman in the checkpoint and continue with reversible work.\n";

function sh(command: string, input: string) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolvePromise, reject) => {
    const child = spawn("/bin/sh", ["-c", command], { env: { ...process.env, CLAUDE_PROJECT_DIR: repoRoot } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

/** The words after `src/cli.ts` up to the hook flag: the orca command the hook runs. */
const cliWords = (command: string): string[] => {
  const match = /src\/cli\.ts (.*?) --hook claude-code/.exec(command);
  if (match === null) throw new Error(`no src/cli.ts … --hook claude-code in ${command}`);
  return match[1]!.split(" ");
};

describe("the hook strings run registered orca dev commands (CLI v2 spec §5)", () => {
  it("GATE_HOOK_COMMAND resolves to orca dev gate, is what .claude/settings.json runs, and blocks a push with exit 2", async () => {
    const found = findCommand([...cliWords(GATE_HOOK_COMMAND), "--hook", "claude-code"]);
    expect("def" in found && [found.def.domain, found.def.action]).toEqual(["dev", "gate"]);
    const settings = JSON.parse(await readFile(join(repoRoot, ".claude", "settings.json"), "utf8"));
    expect(settings.hooks.PreToolUse.map((entry: { hooks: Array<{ command: string }> }) => entry.hooks[0]!.command)).toEqual([GATE_HOOK_COMMAND]);
    const input = JSON.stringify({ session_id: "s", transcript_path: "/t.jsonl", cwd: "/", hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "git push" } });
    expect(await sh(GATE_HOOK_COMMAND, input)).toEqual({ code: 2, stdout: "", stderr: PUSH_LINE });
  }, 30_000);

  it("LEVEL_HOOK_COMMAND resolves to orca dev level, is what .claude/settings.json runs, and answers a missing reading with exit 0", async () => {
    const found = findCommand([...cliWords(LEVEL_HOOK_COMMAND), "--hook", "claude-code"]);
    expect("def" in found && [found.def.domain, found.def.action]).toEqual(["dev", "level"]);
    const settings = JSON.parse(await readFile(join(repoRoot, ".claude", "settings.json"), "utf8"));
    expect(settings.hooks.PostToolUse.map((entry: { hooks: Array<{ command: string }> }) => entry.hooks[0]!.command)).toEqual([LEVEL_HOOK_COMMAND]);
    const out = await sh(LEVEL_HOOK_COMMAND, "not json");
    expect([out.code, out.stderr]).toEqual([0, ""]);
    expect(JSON.parse(out.stdout).hookSpecificOutput.additionalContext).toBe("orca level: no reading — hook input is not JSON");
  }, 30_000);
});
