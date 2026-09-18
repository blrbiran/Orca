import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { levelHookClaudeCode } from "../../src/level/hook.js";
import { ORCA_IDENTITY, git } from "../../src/scheduler/gitExec.js";
import { isolateChainEnv } from "../helpers/chainEnv.js";
import { checkpointFixture, putCheckpoint } from "../helpers/checkpoint.js";
import { tempRepo } from "../helpers/tempRepo.js";
import { SESSION, jsonl, modelRow, usageRow } from "../helpers/transcript.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SHAPE =
  '{"next":["..."],"open":["..."],"awaitingHuman":[{"kind":"irreversible|tied-evidence|named-authorization|ccloop-change","what":"..."}],"measure":["<command>"],"chain":{"status":"continue|done|blocked","why":"..."}}';
const ASK = 'This session runs in an unattended chain: write an exit checkpoint with "chain": {"status": "continue", "why": "<one sentence>"} now, then end this session.';

async function setup(prompt: number) {
  const repo = await tempRepo();
  const transcriptPath = join(await realpath(await mkdtemp(join(tmpdir(), "orca-transcript-"))), "t.jsonl");
  await writeFile(transcriptPath, jsonl([modelRow("claude-opus-5[1m]"), usageRow({ input: prompt, cacheRead: 0, cacheCreation: 0, output: 0 })]));
  const stdin = JSON.stringify({ session_id: SESSION, transcript_path: transcriptPath, cwd: repo, hook_event_name: "PostToolUse" });
  const command =
    `Run: '${repoRoot}/node_modules/.bin/tsx' '${repoRoot}/src/cli.ts' 'checkpoint' 'write' '--repo' '${repo}' '--session' '${SESSION}' ` +
    `'--transcript' '${transcriptPath}' '--draft' <draft.json> where the draft is a file outside the repository shaped like ${SHAPE}`;
  return { repo, transcriptPath, stdin, command };
}
const context = (stdout: string): string => JSON.parse(stdout).hookSpecificOutput.additionalContext;
async function commitCheckpoint(repo: string, value: unknown): Promise<string> {
  const path = await putCheckpoint(repo, "orca-dev-0a1b2c3d.json", value);
  await git(repo, ["add", "--", ".orca/checkpoints/orca-dev-0a1b2c3d.json"]);
  await git(repo, [...ORCA_IDENTITY, "commit", "-q", "-m", "checkpoint"]);
  return path;
}

describe("orca level in a chain session (D-launch spec §3.2)", () => {
  isolateChainEnv();
  let previousProjectDir: string | undefined;
  beforeEach(() => {
    previousProjectDir = process.env.CLAUDE_PROJECT_DIR;
    delete process.env.CLAUDE_PROJECT_DIR;
    process.env.ORCA_CHAIN_ID = "chain-0000000a";
  });
  afterEach(() => {
    if (previousProjectDir === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = previousProjectDir;
  });

  it("H1 band 1 without an exit checkpoint: write one with continue and end the session", async () => {
    const s = await setup(330_000);
    expect(context(await levelHookClaudeCode(s.stdin))).toBe(`orca level: 330000 of 1000000 tokens (T1 330000, T2 450000). ${ASK} ${s.command}`);
  });

  it("H2 band 2 without an exit checkpoint: past T2, the same request", async () => {
    const s = await setup(450_000);
    expect(context(await levelHookClaudeCode(s.stdin))).toBe(
      `orca level: 450000 of 1000000 tokens (T1 330000, T2 450000) is past T2, the session limit. ${ASK} ${s.command}`,
    );
  });

  it("H3 below T1 with no exit checkpoint says nothing", async () => {
    const s = await setup(329_999);
    expect(await levelHookClaudeCode(s.stdin)).toBe("");
  });

  it("H4 a mid-session checkpoint (no chain) does not count as covering in a chain (review I9)", async () => {
    const s = await setup(330_000);
    await commitCheckpoint(s.repo, checkpointFixture());
    expect(context(await levelHookClaudeCode(s.stdin))).toBe(`orca level: 330000 of 1000000 tokens (T1 330000, T2 450000). ${ASK} ${s.command}`);
  });

  it("H5 an exit checkpoint at HEAD is announced at any band, T1 or not", async () => {
    const low = await setup(1);
    const path = await commitCheckpoint(low.repo, checkpointFixture({ chain: { status: "continue", why: "w" } }));
    expect(context(await levelHookClaudeCode(low.stdin))).toBe(
      `orca level: 1 of 1000000 tokens (T1 330000, T2 450000). The exit checkpoint for this session is at ${path}: end this session now.`,
    );
    const high = await setup(450_000);
    const highPath = await commitCheckpoint(high.repo, checkpointFixture({ chain: { status: "done", why: "w" }, next: [] }));
    expect(context(await levelHookClaudeCode(high.stdin))).toBe(
      `orca level: 450000 of 1000000 tokens (T1 330000, T2 450000). The exit checkpoint for this session is at ${highPath}: end this session now.`,
    );
  });

  it("H6 an exit checkpoint only in the worktree does not count (read from HEAD)", async () => {
    const s = await setup(330_000);
    await putCheckpoint(s.repo, "orca-dev-0a1b2c3d.json", checkpointFixture({ chain: { status: "continue", why: "w" } }));
    expect(context(await levelHookClaudeCode(s.stdin))).toBe(`orca level: 330000 of 1000000 tokens (T1 330000, T2 450000). ${ASK} ${s.command}`);
  });

  it("H7 a subagent's call stays silent in a chain", async () => {
    const s = await setup(450_000);
    expect(await levelHookClaudeCode(JSON.stringify({ ...JSON.parse(s.stdin), agent_id: "a0fdd46fd31394cf6" }))).toBe("");
  });

  it("H8 no reading is still reported every time in a chain", async () => {
    const s = await setup(1);
    const stdin = JSON.stringify({ session_id: SESSION, transcript_path: "/nonexistent/t.jsonl", cwd: s.repo });
    expect(context(await levelHookClaudeCode(stdin))).toBe(
      "orca level: no reading — transcript /nonexistent/t.jsonl cannot be read: ENOENT: no such file or directory, open '/nonexistent/t.jsonl'",
    );
  });
});
