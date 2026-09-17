export type Runtime = "claude-code";

/** D spec §3.1. One reading of how much of the context window the next call will carry. */
export interface Reading {
  kind: "reading";
  runtime: Runtime;
  sessionRef: string;
  promptTokens: number;
  outputTokens: number;
  windowTokens: number;
  compactionReserveTokens?: number;
  observedAt: string;
}

/** Never replaced by a zero: a missing reading is reported every time (D spec §4). */
export interface NoReading {
  kind: "no-reading";
  runtime: Runtime;
  sessionRef: string;
  reason: string;
}

/** D spec 3.1: prompt plus output of the last call — a conservative estimate, never a lower bound. */
export function levelOf(reading: Reading): number {
  return reading.promptTokens + reading.outputTokens;
}
