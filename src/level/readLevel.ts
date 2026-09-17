import { readFile } from "node:fs/promises";
import { readClaudeCodeTranscript } from "./claudeCode.js";
import { DEFAULT_THRESHOLDS, type LevelConfig, LevelConfigRejection, loadLevelConfig } from "./config.js";
import type { Thresholds } from "./trigger.js";
import type { NoReading, Reading } from "./types.js";

/** The one place that turns (repository, session, transcript) into a reading — shared by the hook and by checkpoint write. */
export async function readLevel(
  repo: string,
  sessionRef: string,
  transcriptPath: string,
): Promise<{ input: Reading | NoReading; thresholds: Thresholds }> {
  const none = (reason: string): NoReading => ({ kind: "no-reading", runtime: "claude-code", sessionRef, reason });
  let config: LevelConfig;
  try {
    config = await loadLevelConfig(repo);
  } catch (err) {
    if (err instanceof LevelConfigRejection) return { input: none(err.message), thresholds: DEFAULT_THRESHOLDS };
    throw err;
  }
  let text: string;
  try {
    text = await readFile(transcriptPath, "utf8");
  } catch (err) {
    return { input: none(`transcript ${transcriptPath} cannot be read: ${(err as Error).message}`), thresholds: config };
  }
  return { input: readClaudeCodeTranscript(text, sessionRef, config.windows), thresholds: config };
}
