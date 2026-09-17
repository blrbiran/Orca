import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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
  });

  it("says there is no reading, naming the path, when the transcript cannot be read", async () => {
    const s = await setup(1);
    const stdin = JSON.stringify({ session_id: SESSION, transcript_path: "/nonexistent/t.jsonl", cwd: s.repo });
    expect(context(await levelHookClaudeCode(stdin))).toContain("no reading — transcript /nonexistent/t.jsonl cannot be read");
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
