import type { NoReading, Reading } from "./types.js";

const USAGE_FIELDS = ["input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "output_tokens"] as const;
const ONE_MILLION_SUFFIX = "[1m]";

/**
 * D spec 2.1 and 9. The prompt size of the last main-chain call, from the transcript Claude Code writes.
 * The window comes from the last model attachment: `message.model` does not tell the 1M variant apart
 * (measured), `attachment.identity.modelId` does. Every row that is not a reading is skipped by name
 * below; anything the adapter cannot account for is a NoReading, never a zero.
 */
export function readClaudeCodeTranscript(
  text: string,
  sessionRef: string,
  windows: Record<string, number>,
): Reading | NoReading {
  const none = (reason: string): NoReading => ({ kind: "no-reading", runtime: "claude-code", sessionRef, reason });
  const lines = text.split("\n");
  let modelId: string | undefined;
  let last: { prompt: number; output: number; at: string } | undefined;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "") continue;
    // JSON of unknown shape; every field used below is checked before it is trusted.
    let row: any;
    try {
      row = JSON.parse(line);
    } catch {
      // The runtime appends while we read: only a final segment with no newline after it may be torn.
      if (i === lines.length - 1) continue;
      return none(`transcript line ${i + 1} is not JSON`);
    }
    if (typeof row !== "object" || row === null) return none(`transcript line ${i + 1} is not an object`);
    if (typeof row.sessionId === "string" && row.sessionId !== sessionRef) {
      return none(`transcript line ${i + 1} belongs to session ${row.sessionId}, not ${sessionRef}`);
    }
    if (row.type === "attachment" && row.attachment?.type === "model") {
      const id = row.attachment.identity?.modelId;
      if (typeof id !== "string" || id === "") return none(`model attachment on line ${i + 1} has no identity.modelId`);
      modelId = id;
      continue;
    }
    if (row.type !== "assistant" || row.isSidechain === true) continue;
    const usage = row.message?.usage;
    if (usage === undefined || usage === null) continue;
    // Measured: rows the runtime synthesizes carry an all-zero usage and are not a model call.
    if (row.message.model === "<synthetic>") continue;
    for (const field of USAGE_FIELDS) {
      const value = usage[field];
      if (!Number.isInteger(value) || value < 0) return none(`usage on line ${i + 1} lacks a count for ${field}`);
    }
    if (typeof row.timestamp !== "string") return none(`usage on line ${i + 1} has no timestamp`);
    last = {
      prompt: usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens,
      output: usage.output_tokens,
      at: row.timestamp,
    };
  }

  if (last === undefined) return none("no main-chain call with usage yet");
  if (modelId === undefined) return none("no model attachment in transcript");
  const windowTokens = modelId.endsWith(ONE_MILLION_SUFFIX) ? 1_000_000 : windows[modelId];
  if (windowTokens === undefined) {
    return none(`no window size known for model ${modelId}; add it to .orca/level.json windows`);
  }
  return {
    kind: "reading",
    runtime: "claude-code",
    sessionRef,
    promptTokens: last.prompt,
    outputTokens: last.output,
    windowTokens,
    observedAt: last.at,
  };
}
