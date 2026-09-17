import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tempRepo } from "./tempRepo.js";
import { jsonl, modelRow, usageRow } from "./transcript.js";

export const NOW = (): Date => new Date("2026-09-17T03:00:00.000Z");

/** A repository, plus a transcript and a draft kept outside it — where a real session keeps them. */
export async function checkpointSession(prompt: number, draft: unknown): Promise<{ repo: string; transcriptPath: string; draftPath: string }> {
  const repo = await tempRepo();
  const outside = await mkdtemp(join(tmpdir(), "orca-session-"));
  const transcriptPath = join(outside, "t.jsonl");
  await writeTranscript(transcriptPath, prompt);
  const draftPath = join(outside, "draft.json");
  await writeFile(draftPath, JSON.stringify(draft));
  return { repo, transcriptPath, draftPath };
}

export async function writeTranscript(path: string, prompt: number): Promise<void> {
  await writeFile(path, jsonl([modelRow("claude-opus-5[1m]"), usageRow({ input: prompt, cacheRead: 0, cacheCreation: 0, output: 1 })]));
}
