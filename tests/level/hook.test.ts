import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { levelHookClaudeCode } from "../../src/level/hook.js";
import { checkpointFixture, putCheckpoint } from "../helpers/checkpoint.js";
import { runCli } from "../helpers/runCli.js";
import { tempRepo } from "../helpers/tempRepo.js";
import { SESSION, jsonl, modelRow, usageRow } from "../helpers/transcript.js";

async function setup(prompt: number, config?: unknown) {
  const repo = await tempRepo();
  if (config !== undefined) {
    await mkdir(join(repo, ".orca"));
    await writeFile(join(repo, ".orca", "level.json"), JSON.stringify(config));
  }
  const transcriptPath = join(await mkdtemp(join(tmpdir(), "orca-transcript-")), "t.jsonl");
  await writeFile(transcriptPath, jsonl([modelRow("claude-opus-5[1m]"), usageRow({ input: prompt, cacheRead: 0, cacheCreation: 0, output: 0 })]));
  const stdin = JSON.stringify({ session_id: SESSION, transcript_path: transcriptPath, cwd: repo, hook_event_name: "PostToolUse" });
  return { repo, transcriptPath, stdin };
}

function context(stdout: string): string {
  const parsed = JSON.parse(stdout);
  expect(parsed.hookSpecificOutput.hookEventName).toBe("PostToolUse");
  return parsed.hookSpecificOutput.additionalContext;
}

describe("orca level --hook claude-code (D spec 3 delivery shim, 4)", () => {
  // Final review I2: the hook reads CLAUDE_PROJECT_DIR. A session running these tests may have it set
  // (Claude Code exports it to hook commands), so every test starts without it and restores it after.
  let previousProjectDir: string | undefined;
  beforeEach(() => {
    previousProjectDir = process.env.CLAUDE_PROJECT_DIR;
    delete process.env.CLAUDE_PROJECT_DIR;
  });
  afterEach(() => {
    if (previousProjectDir === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = previousProjectDir;
  });

  it("prints nothing below T1", async () => {
    const s = await setup(329_999);
    expect(await levelHookClaudeCode(s.stdin)).toBe("");
  });

  it("at T1 tells the session to write a checkpoint, with a command naming its session and transcript", async () => {
    const s = await setup(330_000);
    const text = context(await levelHookClaudeCode(s.stdin));
    expect(text).toContain("Write a checkpoint now.");
    expect(text).toContain(`'--session' '${SESSION}' '--transcript' '${s.transcriptPath}'`);
  });

  it("does not ask again when this session's band already has a checkpoint", async () => {
    const s = await setup(330_000);
    const path = await putCheckpoint(s.repo, "orca-dev-0a1b2c3d.json", checkpointFixture());
    expect(context(await levelHookClaudeCode(s.stdin))).toContain(`A checkpoint for this band is at ${path}.`);
  });

  it("says nothing to a subagent's tool call, whose stdin carries the parent's session and transcript (final review I3)", async () => {
    // Live check (handoff section 十, Q2): a subagent's PostToolUse stdin has the parent's session_id and
    // transcript_path; only agent_id and agent_type tell it apart. Past the parent's T1 with no checkpoint,
    // the main session is asked to write one — the subagent must not be asked to write the parent's.
    const s = await setup(450_000);
    expect(context(await levelHookClaudeCode(s.stdin))).toContain("Write a checkpoint and hand off now;");
    const subagent = JSON.stringify({ ...JSON.parse(s.stdin), agent_id: "a0fdd46fd31394cf6", agent_type: "general-purpose" });
    expect(await levelHookClaudeCode(subagent)).toBe("");
  });

  it("says there is no reading when the hook input lacks the transcript path", async () => {
    const text = context(await levelHookClaudeCode(JSON.stringify({ session_id: SESSION })));
    expect(text).toBe("orca level: no reading — hook input lacks session_id, transcript_path or cwd");
  });

  it("says there is no reading, naming the file, when the repository config is invalid", async () => {
    const s = await setup(1, { t1: "x" });
    expect(context(await levelHookClaudeCode(s.stdin)).startsWith("orca level: no reading — .orca/level.json")).toBe(true);
  });

  it("reports an unreadable checkpoint even below T1", async () => {
    const s = await setup(1);
    const bad = await putCheckpoint(s.repo, "bad.json", "{");
    expect(context(await levelHookClaudeCode(s.stdin)).startsWith(`orca level: unreadable checkpoint ${bad}: `)).toBe(true);

    // Final review I1: a throw inside the hook (readdir on a checkpoints path that is a file: ENOTDIR) is
    // injected as a missing reading, never propagated to leave the agent with nothing (D spec 4).
    const t = await setup(1);
    await mkdir(join(t.repo, ".orca"));
    await writeFile(join(t.repo, ".orca", "checkpoints"), "");
    expect(context(await levelHookClaudeCode(t.stdin))).toBe(
      `orca level: no reading — ENOTDIR: not a directory, scandir '${join(t.repo, ".orca", "checkpoints")}'`,
    );
  });

  it("says there is no reading, naming the path, when the transcript cannot be read", async () => {
    const s = await setup(1);
    const stdin = JSON.stringify({ session_id: SESSION, transcript_path: "/nonexistent/t.jsonl", cwd: s.repo });
    expect(context(await levelHookClaudeCode(stdin))).toContain("no reading — transcript /nonexistent/t.jsonl cannot be read");
  });

  it("resolves the repository from CLAUDE_PROJECT_DIR, not from a stdin cwd the session moved into (final review I2)", async () => {
    const project = await setup(330_000);
    // The other repository's config is invalid: reading it instead of the project's would be a missing reading.
    const elsewhere = await setup(330_000, { t1: "x" });
    process.env.CLAUDE_PROJECT_DIR = project.repo;
    const stdin = JSON.stringify({ session_id: SESSION, transcript_path: project.transcriptPath, cwd: elsewhere.repo });
    expect(context(await levelHookClaudeCode(stdin))).toContain(`'--repo' '${project.repo}' '--session'`);
    const path = await putCheckpoint(project.repo, "orca-dev-0a1b2c3d.json", checkpointFixture());
    expect(context(await levelHookClaudeCode(stdin))).toContain(`A checkpoint for this band is at ${path}.`);
  });

  it("without CLAUDE_PROJECT_DIR resolves the repository from the stdin cwd: its top level, or the cwd itself outside git", async () => {
    const s = await setup(330_000);
    const sub = join(s.repo, "sub");
    await mkdir(sub);
    const fromSub = JSON.stringify({ session_id: SESSION, transcript_path: s.transcriptPath, cwd: sub });
    expect(context(await levelHookClaudeCode(fromSub))).toContain(`'--repo' '${s.repo}' '--session'`);
    const outside = await realpath(await mkdtemp(join(tmpdir(), "orca-not-a-repo-")));
    const fromOutside = JSON.stringify({ session_id: SESSION, transcript_path: s.transcriptPath, cwd: outside });
    expect(context(await levelHookClaudeCode(fromOutside))).toContain(`'--repo' '${outside}' '--session'`);
  });

  it("through the real process: exits 0 with the injection on stdout, and refuses another runtime with 1", async () => {
    const s = await setup(330_000);
    const ok = await runCli(["level", "--hook", "claude-code"], s.stdin);
    expect(ok.code).toBe(0);
    expect(context(ok.stdout)).toContain("Write a checkpoint now.");
    const refused = await runCli(["level", "--hook", "codex"], s.stdin);
    expect(refused.code).toBe(1);
  });
});
