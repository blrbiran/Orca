// Tier 0 gate spec §12 (tester follow-up I, 2026-11-13). Human, Orca session 7e164691: 「在人明确要求的情况下要允许push」.
// A push is the one Tier 0 move the human now lets an agent make, and only after the human said so in their own prompt.
// These criteria pin both halves: the grant can only come from the token at the start of a prompt, for one session and
// for 12 h; and even a granted session can only make a plain push to origin. Every directory is a temp ORCA_GATE_DIR
// (Rule 17): no criterion here reads or writes the person's real ~/.orca.
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type BranchOf, classify } from "../../src/gate/classify.js";
import { gateHookClaudeCode } from "../../src/gate/hook.js";
import { PUSH_GRANT_MS, promptHookClaudeCode, promptIntent, pushGrantPath } from "../../src/gate/pushGrant.js";
import { GATE_USER_PROMPT_SUBMIT, PROMPT_HOOK_COMMAND } from "../../src/gate/settings.js";
import { runCli } from "../helpers/runCli.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const HEAD =
  "orca gate: push is Tier 0 (CLAUDE.md Rule 15) — do not retry or rephrase it; list it under awaitingHuman in the checkpoint and continue with reversible work.";
const NO_GRANT = `${HEAD} A person can allow a plain push for this session (12 h) by starting their next message with allow-push.\n`;
const SCOPE =
  "A grant admits only `git push origin [<ref>…]` with -u/--set-upstream, -q/--quiet, -v/--verbose, -n/--dry-run, --porcelain or --follow-tags; a person runs any other push in their own terminal.";
const notCoveredLine = (why: string) => `${HEAD} This session's push grant does not cover it: ${why}. ${SCOPE}\n`;
const NOW = Date.parse("2026-11-13T10:00:00.000Z");

const gateEnv = async (): Promise<NodeJS.ProcessEnv> => ({ ORCA_GATE_DIR: join(await realpath(await mkdtemp(join(tmpdir(), "orca-gate-dir-"))), "gate") });
const prompt = (text: string, sessionId: unknown = "sess-a", extra: Record<string, unknown> = {}) =>
  JSON.stringify({ session_id: sessionId, transcript_path: "/t.jsonl", cwd: "/", hook_event_name: "UserPromptSubmit", prompt: text, ...extra });
const bash = (command: string, sessionId = "sess-a") =>
  JSON.stringify({ session_id: sessionId, transcript_path: "/t.jsonl", cwd: "/", hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } });
const noBranch: BranchOf = async (dir) => {
  throw new Error(`no branch for ${dir}`);
};
const gate = (input: string, env: NodeJS.ProcessEnv, now = NOW) => gateHookClaudeCode(input, { env, now, branchOf: noBranch });
const exists = (path: string) => stat(path).then(() => true, () => false);

describe("promptIntent: only the human's own leading token grants (spec §12)", () => {
  it.each<[string, "grant" | "revoke" | null]>([
    ["allow-push", "grant"],
    ["allow-push 推吧", "grant"],
    ["/allow-push", "grant"],
    ["ALLOW-PUSH, then push main", "grant"],
    ["  \nallow-push", "grant"],
    // Quoted or pasted text that merely mentions the token (a report, a resume output) must not grant.
    ["please allow-push", null],
    ["the human can type allow-push", null],
    ["disallow-push", null],
    ["allow-pushes", null],
    ["allow-push-x", null],
    ["allow_push", null],
    ["push it", null],
    ["deny-push", "revoke"],
    ["/revoke-push", "revoke"],
    ["ok, Deny-Push now", "revoke"],
    ["allow-push … actually deny-push", "revoke"],
    ["undeny-push", null],
    ["deny-pushes", null],
  ])("%j → %s", (text, expected) => {
    expect(promptIntent(text)).toBe(expected);
  });
});

describe("the UserPromptSubmit hook writes, keeps and revokes the grant (spec §12)", () => {
  it("allow-push writes {sessionId, grantedAt, expiresAt} for 12 h under ORCA_GATE_DIR, 0700/0600, and says so in one stdout line", async () => {
    const env = await gateEnv();
    const out = promptHookClaudeCode(prompt("allow-push"), env, NOW);
    const expiresAt = new Date(NOW + PUSH_GRANT_MS).toISOString();
    expect(out).toEqual({ stdout: `orca gate: push allowed for this session until ${expiresAt} (human said allow-push)\n`, stderr: "" });
    expect(expiresAt).toBe("2026-11-13T22:00:00.000Z");
    const path = pushGrantPath(env.ORCA_GATE_DIR!, "sess-a");
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ sessionId: "sess-a", grantedAt: "2026-11-13T10:00:00.000Z", expiresAt });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(dirname(path))).mode & 0o777).toBe(0o700);
    expect((await stat(env.ORCA_GATE_DIR!)).mode & 0o777).toBe(0o700);
  });

  it("writes nothing and prints nothing for a prompt without the leading token", async () => {
    const env = await gateEnv();
    for (const text of ["push it now", "disallow-push", "please allow-push", "allow-pushes"]) {
      expect(promptHookClaudeCode(prompt(text), env, NOW)).toEqual({ stdout: "", stderr: "" });
    }
    expect(await exists(env.ORCA_GATE_DIR!)).toBe(false);
  });

  it("reads `user_prompt` when `prompt` is absent", async () => {
    const env = await gateEnv();
    const input = JSON.stringify({ session_id: "sess-a", hook_event_name: "UserPromptSubmit", user_prompt: "allow-push" });
    expect(promptHookClaudeCode(input, env, NOW).stdout).toMatch(/^orca gate: push allowed for this session until /);
    expect(await exists(pushGrantPath(env.ORCA_GATE_DIR!, "sess-a"))).toBe(true);
  });

  it("deny-push deletes this session's grant and leaves another session's", async () => {
    const env = await gateEnv();
    promptHookClaudeCode(prompt("allow-push"), env, NOW);
    promptHookClaudeCode(prompt("allow-push", "sess-b"), env, NOW);
    expect(promptHookClaudeCode(prompt("deny-push"), env, NOW)).toEqual({ stdout: "", stderr: "" });
    expect(await exists(pushGrantPath(env.ORCA_GATE_DIR!, "sess-a"))).toBe(false);
    expect(await exists(pushGrantPath(env.ORCA_GATE_DIR!, "sess-b"))).toBe(true);
  });

  it("a chain session (ORCA_CHAIN_ID) gets no grant: the chain wrote its prompt and no person is watching", async () => {
    const env: NodeJS.ProcessEnv = { ...(await gateEnv()), ORCA_CHAIN_ID: "chain-1" };
    expect(promptHookClaudeCode(prompt("allow-push"), env, NOW)).toEqual({ stdout: "", stderr: "orca gate: a chain session gets no push grant\n" });
    expect(await exists(env.ORCA_GATE_DIR!)).toBe(false);
  });

  it("never throws on bad input: one stderr line, nothing written", async () => {
    const env = await gateEnv();
    expect(promptHookClaudeCode("not json", env, NOW)).toEqual({ stdout: "", stderr: "orca gate: prompt hook input is not JSON; no push grant changed\n" });
    expect(promptHookClaudeCode("null", env, NOW)).toEqual({ stdout: "", stderr: "orca gate: prompt hook input has no prompt; no push grant changed\n" });
    for (const id of ["../escape", "", 7, null]) {
      expect(promptHookClaudeCode(prompt("allow-push", id), env, NOW)).toEqual({
        stdout: "",
        stderr: "orca gate: prompt hook input has no usable session_id; no push grant changed\n",
      });
    }
    expect(await exists(env.ORCA_GATE_DIR!)).toBe(false);
    // ORCA_GATE_DIR under a regular file: the write fails, and the hook still answers with one line instead of throwing.
    const file = join(await realpath(await mkdtemp(join(tmpdir(), "orca-gate-file-"))), "f");
    await writeFile(file, "x");
    const failed = promptHookClaudeCode(prompt("allow-push"), { ORCA_GATE_DIR: join(file, "gate") }, NOW);
    expect(failed.stdout).toBe("");
    expect(failed.stderr).toMatch(/^orca gate: prompt hook failed: .*; no push grant changed\n$/);
  });

  it("through the real process: exit 0 on malformed stdin and on a grant, which lands only under ORCA_GATE_DIR", async () => {
    const env = await gateEnv();
    const bad = await runCli(["dev", "gate", "--hook", "claude-code-prompt"], "{", repoRoot, { ...process.env, ...env });
    expect([bad.code, bad.stdout, bad.stderr]).toEqual([0, "", "orca gate: prompt hook input is not JSON; no push grant changed\n"]);
    const ok = await runCli(["dev", "gate", "--hook", "claude-code-prompt"], prompt("allow-push", "sess-real"), repoRoot, { ...process.env, ...env });
    expect([ok.code, ok.stderr]).toEqual([0, ""]);
    expect(ok.stdout).toMatch(/^orca gate: push allowed for this session until \S+ \(human said allow-push\)\n$/);
    expect(await readdir(join(env.ORCA_GATE_DIR!, "push-grants"))).toEqual(["sess-real.json"]);
  });

  it("the settings command never blocks a prompt: no node_modules ⇒ exit 0 with one line; no 'push' in the prompt ⇒ tsx never starts", async () => {
    expect((JSON.parse(await readFile(join(repoRoot, ".claude", "settings.json"), "utf8")) as { hooks: { UserPromptSubmit: unknown } }).hooks.UserPromptSubmit).toEqual(
      GATE_USER_PROMPT_SUBMIT,
    );
    const bare = await realpath(await mkdtemp(join(tmpdir(), "orca-no-modules-")));
    const sh = (input: string) =>
      new Promise<{ code: number | null; stdout: string; stderr: string }>((resolvePromise, reject) => {
        const child = spawn("/bin/sh", ["-c", PROMPT_HOOK_COMMAND], { env: { ...process.env, CLAUDE_PROJECT_DIR: bare } });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (c: Buffer) => (stdout += c.toString("utf8")));
        child.stderr.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
        child.on("error", reject);
        child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
        child.stdin.end(input);
      });
    const failed = await sh(prompt("allow-push"));
    expect([failed.code, failed.stdout]).toEqual([0, ""]);
    expect(failed.stderr.trimEnd().split("\n").at(-1)).toBe("orca gate: prompt hook failed (exit 127) — no push grant changed");
    expect(await sh(prompt("fix the tests"))).toEqual({ code: 0, stdout: "", stderr: "" });
  });
});

describe("the PreToolUse gate admits a plain push only with this session's live grant (spec §12)", () => {
  const writeGrant = async (env: NodeJS.ProcessEnv, file: string, body: Record<string, unknown>) => {
    await mkdir(join(env.ORCA_GATE_DIR!, "push-grants"), { recursive: true });
    await writeFile(pushGrantPath(env.ORCA_GATE_DIR!, file), JSON.stringify(body));
  };

  it("without a grant every push is blocked, and the refusal says the human can type allow-push", async () => {
    const env = await gateEnv();
    expect(await gate(bash("git push origin main"), env)).toEqual({ exitCode: 2, stderr: NO_GRANT });
  });

  it("with a live grant for this session a plain push to origin passes; the grant ends at expiresAt", async () => {
    const env = await gateEnv();
    promptHookClaudeCode(prompt("allow-push"), env, NOW);
    expect(await gate(bash("git push origin main"), env)).toEqual({ exitCode: 0, stderr: "" });
    expect(await gate(bash("git push origin main"), env, NOW + PUSH_GRANT_MS - 1)).toEqual({ exitCode: 0, stderr: "" });
    expect(await gate(bash("git push origin main"), env, NOW + PUSH_GRANT_MS)).toEqual({ exitCode: 2, stderr: NO_GRANT });
  });

  it("a grant for another session is ignored, by file name and by the sessionId inside the file", async () => {
    const env = await gateEnv();
    promptHookClaudeCode(prompt("allow-push", "sess-b"), env, NOW);
    expect(await gate(bash("git push origin main"), env)).toEqual({ exitCode: 2, stderr: NO_GRANT });
    await writeGrant(env, "sess-a", { sessionId: "sess-b", grantedAt: new Date(NOW).toISOString(), expiresAt: new Date(NOW + 1000).toISOString() });
    expect(await gate(bash("git push origin main"), env)).toEqual({ exitCode: 2, stderr: NO_GRANT });
  });

  it("an expired grant, one not yet started, and an unreadable one are no grant", async () => {
    const env = await gateEnv();
    await writeGrant(env, "sess-a", { sessionId: "sess-a", grantedAt: new Date(NOW - 2000).toISOString(), expiresAt: new Date(NOW - 1000).toISOString() });
    expect(await gate(bash("git push origin main"), env)).toEqual({ exitCode: 2, stderr: NO_GRANT });
    await writeGrant(env, "sess-a", { sessionId: "sess-a", grantedAt: new Date(NOW + 1000).toISOString(), expiresAt: new Date(NOW + 2000).toISOString() });
    expect(await gate(bash("git push origin main"), env)).toEqual({ exitCode: 2, stderr: NO_GRANT });
    await writeFile(pushGrantPath(env.ORCA_GATE_DIR!, "sess-a"), "{");
    expect(await gate(bash("git push origin main"), env)).toEqual({ exitCode: 2, stderr: NO_GRANT });
  });

  it("with a grant, a push the grant does not cover is blocked naming why, without the allow-push hint", async () => {
    const env = await gateEnv();
    promptHookClaudeCode(prompt("allow-push"), env, NOW);
    expect(await gate(bash("git push --force origin main"), env)).toEqual({ exitCode: 2, stderr: notCoveredLine("option --force") });
    expect(await gate(bash("gh pr merge 1"), env)).toEqual({
      exitCode: 2,
      stderr: "orca gate: outward gh write is Tier 0 (CLAUDE.md Rule 15) — do not retry or rephrase it; list it under awaitingHuman in the checkpoint and continue with reversible work.\n",
    });
  });

  it("through the real process: the grant written by the prompt hook admits the push in the gate hook", async () => {
    const env = { ...process.env, ...(await gateEnv()) };
    expect((await runCli(["dev", "gate", "--hook", "claude-code"], bash("git push origin main", "sess-real"), repoRoot, env)).code).toBe(2);
    expect((await runCli(["dev", "gate", "--hook", "claude-code-prompt"], prompt("allow-push", "sess-real"), repoRoot, env)).code).toBe(0);
    const passed = await runCli(["dev", "gate", "--hook", "claude-code"], bash("git push origin main", "sess-real"), repoRoot, env);
    expect([passed.code, passed.stderr]).toEqual([0, ""]);
  });
});

describe("classify with a push grant: only a plain push to origin (spec §12)", () => {
  const push = (notCovered: string) => ({ kind: "block", action: "push", notCovered });
  const allow = { kind: "allow" };
  it.each<[string, object]>([
    ["git push origin main", allow],
    ["git push origin", allow],
    ["git push -u origin feat", allow],
    ["git push --set-upstream origin feat", allow],
    ["git push -qv origin main", allow],
    ["git push --dry-run --porcelain origin main", allow],
    ["git push -n origin main", allow],
    ["git push --follow-tags origin main", allow],
    ["git push origin HEAD:refs/heads/x", allow],
    ["git push origin main feat", allow],
    ["git -C ../ccloop push origin main", allow],
    ["rtk git push origin main", allow],
    ["git push --force origin main", push("option --force")],
    ["git push -f origin main", push("option -f")],
    ["git push -uf origin main", push("option -uf")],
    ["git push --force-with-lease origin main", push("option --force-with-lease")],
    ["git push --force-with-lease=main origin main", push("option --force-with-lease=main")],
    ["git push --force-if-includes origin main", push("option --force-if-includes")],
    ["git push origin +main", push("refspec +main forces")],
    ["git push origin +main:main", push("refspec +main:main forces")],
    ["git push --delete origin x", push("option --delete")],
    ["git push -d origin x", push("option -d")],
    ["git push origin :x", push("refspec :x deletes")],
    ["git push --mirror origin", push("option --mirror")],
    ["git push --all origin", push("option --all")],
    ["git push --prune origin main", push("option --prune")],
    ["git push --tags origin", push("option --tags")],
    ["git push -o ci.skip origin main", push("option -o")],
    ["git push origin main -- x", push("option --")],
    ["git push", push("no remote named")],
    ["git push -u", push("no remote named")],
    ["git push upstream main", push("remote upstream is not origin")],
    ["git push https://example.com/r.git main", push("remote https://example.com/r.git is not origin")],
    ["git push origin $REF", push("$REF is not a literal word")],
    ["git push origin 'refs/heads/*:refs/heads/*'", push("refspec refs/heads/*:refs/heads/* is a pattern")],
    ["git -c remote.origin.mirror=true push origin", push("a -c or GIT_CONFIG_* setting can change what the push does")],
    ["GIT_CONFIG_COUNT=1 git push origin main", push("a -c or GIT_CONFIG_* setting can change what the push does")],
    ["env GIT_CONFIG_PARAMETERS=x git push origin main", push("a -c or GIT_CONFIG_* setting can change what the push does")],
    ["git status && git push --force origin main", push("option --force")],
    ['sh -c "git push -f origin main"', push("option -f")],
    ["echo $(git push -f origin main)", push("option -f")],
  ])("%s", async (command, expected) => {
    expect(await classify(command, "/r", noBranch, true)).toEqual(expected);
  });

  it("without the grant the same plain push is the unconditional push block", async () => {
    expect(await classify("git push origin main", "/r", noBranch)).toEqual({ kind: "block", action: "push" });
    expect(await classify("git push origin main", "/r", noBranch, false)).toEqual({ kind: "block", action: "push" });
  });
});
