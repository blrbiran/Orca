import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { levelHookClaudeCode } from "../../src/level/hook.js";
import { isolateChainEnv } from "../helpers/chainEnv.js";
import { checkpointFixture, putCheckpoint } from "../helpers/checkpoint.js";
import { tempRepo } from "../helpers/tempRepo.js";
import { SESSION, jsonl, modelRow, usageRow } from "../helpers/transcript.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const golden = async (): Promise<Record<string, string>> => JSON.parse(await readFile(join(repoRoot, "tests", "level", "fixtures", "hook-golden.json"), "utf8"));

async function setup(prompt: number) {
  const repo = await tempRepo();
  const transcriptPath = join(await realpath(await mkdtemp(join(tmpdir(), "orca-transcript-"))), "t.jsonl");
  await writeFile(transcriptPath, jsonl([modelRow("claude-opus-5[1m]"), usageRow({ input: prompt, cacheRead: 0, cacheCreation: 0, output: 0 })]));
  const stdin = JSON.stringify({ session_id: SESSION, transcript_path: transcriptPath, cwd: repo, hook_event_name: "PostToolUse" });
  return { repo, transcriptPath, stdin };
}
const normalize = (out: string, s: { repo: string; transcriptPath: string }): string =>
  out.replaceAll(s.transcriptPath, "<TRANSCRIPT>").replaceAll(s.repo, "<REPO>").replaceAll(repoRoot, "<ORCA>");
const BAND2 = { kind: "reading" as const, level: 460_000, windowTokens: 1_000_000, t1: 330_000, t2: 450_000, band: 2 as const };

describe("orca level without ORCA_CHAIN_ID is byte for byte what it was at 96cae2b (D-launch spec §3.2, §8.2-4)", () => {
  isolateChainEnv();
  let previousProjectDir: string | undefined;
  beforeEach(() => {
    previousProjectDir = process.env.CLAUDE_PROJECT_DIR;
    delete process.env.CLAUDE_PROJECT_DIR;
  });
  afterEach(() => {
    if (previousProjectDir === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = previousProjectDir;
  });

  it.each([
    ["band0", 329_999, "none"],
    ["band1", 330_000, "none"],
    ["band1-covered", 330_000, "band1"],
    ["band2", 450_000, "none"],
    ["band2-covered", 450_000, "band2"],
  ] as const)("%s", async (name, prompt, cover) => {
    const s = await setup(prompt);
    if (cover === "band1") await putCheckpoint(s.repo, "orca-dev-0a1b2c3d.json", checkpointFixture());
    if (cover === "band2") await putCheckpoint(s.repo, "orca-dev-0a1b2c3d.json", checkpointFixture({ level: BAND2 }));
    expect(normalize(await levelHookClaudeCode(s.stdin), s)).toBe((await golden())[name]);
  });

  it("no-reading", async () => {
    const s = await setup(1);
    const stdin = JSON.stringify({ session_id: SESSION, transcript_path: "/nonexistent/t.jsonl", cwd: s.repo });
    expect(normalize(await levelHookClaudeCode(stdin), s)).toBe((await golden())["no-reading"]);
  });
});
