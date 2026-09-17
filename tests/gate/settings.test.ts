// tests/gate/settings.test.ts
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const COMMAND =
  'in=$(cat); printf \'%s\' "$in" | node "$CLAUDE_PROJECT_DIR"/scripts/gate-prefilter.mjs && exit 0; printf \'%s\' "$in" | "$CLAUDE_PROJECT_DIR"/node_modules/.bin/tsx "$CLAUDE_PROJECT_DIR"/src/cli.ts gate --hook claude-code || { rc=$?; [ "$rc" -eq 2 ] && exit 2; echo "orca gate: hook failed (exit $rc) — blocked" >&2; exit 2; }';
const DENY_BASE = [
  "git push*",
  "git branch -d*",
  "git branch -D*",
  "git branch --delete*",
  "git worktree remove*",
  "git worktree prune*",
  "gh pr merge*",
  "gh repo sync*",
];
const DENY = DENY_BASE.flatMap((p) => [`Bash(${p})`, `Bash(rtk ${p})`, `Bash(rtk proxy ${p})`]);
const PUSH_LINE =
  "orca gate: push is Tier 0 (CLAUDE.md Rule 15) — do not retry or rephrase it; list it under awaitingHuman in the checkpoint and continue with reversible work.\n";
const stdin = (command: string) => JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd: "/" });

function sh(projectDir: string, input: string) {
  return new Promise<{ code: number | null; stderr: string }>((resolvePromise, reject) => {
    const child = spawn("/bin/sh", ["-c", COMMAND], { env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir } });
    let stderr = "";
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code, stderr }));
    child.stdin.end(input);
  });
}

describe(".claude/settings.json wires the Tier 0 gate (spec 5, 6.2)", () => {
  it("parses, carries the gate hook object exactly, and denies exactly the listed literal forms", async () => {
    const settings = JSON.parse(await readFile(join(repoRoot, ".claude", "settings.json"), "utf8"));
    expect(settings.hooks.PreToolUse).toContainEqual({ matcher: "Bash", hooks: [{ type: "command", command: COMMAND, timeout: 10 }] });
    expect([...settings.permissions.deny].sort()).toEqual([...DENY].sort());
  });

  it("command line layer: without node_modules a push is blocked naming exit 127, and a command without git or gh still runs", async () => {
    const bare = await realpath(await mkdtemp(join(tmpdir(), "orca-no-modules-")));
    await mkdir(join(bare, "scripts"));
    await copyFile(join(repoRoot, "scripts", "gate-prefilter.mjs"), join(bare, "scripts", "gate-prefilter.mjs"));
    const pushed = await sh(bare, stdin("git push"));
    expect(pushed.code).toBe(2);
    expect(pushed.stderr.trimEnd().split("\n").at(-1)).toBe("orca gate: hook failed (exit 127) — blocked");
    expect(await sh(bare, stdin("npm ci"))).toEqual({ code: 0, stderr: "" });
  });

  it("command line layer: the hook's own exit 2 passes through with its one line and nothing added", async () => {
    expect(await sh(repoRoot, stdin("git push"))).toEqual({ code: 2, stderr: PUSH_LINE });
  });
});
