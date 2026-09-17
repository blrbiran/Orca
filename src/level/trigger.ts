import { levelOf } from "./types.js";
import type { NoReading, Reading } from "./types.js";

export interface Thresholds {
  t1: number;
  t2: number;
}
export type Band = 0 | 1 | 2;
export interface Covering {
  path: string;
  band: 1 | 2;
}
export type Decision = { kind: "silent" } | { kind: "write" | "inform" | "breach" | "no-reading"; text: string };

export function effectiveThresholds(reading: Reading, configured: Thresholds): Thresholds {
  const usable = reading.windowTokens - (reading.compactionReserveTokens ?? 0);
  return { t1: Math.min(configured.t1, usable), t2: Math.min(configured.t2, usable) };
}

// When the window pulls T1 and T2 together, a level at T1 is also at T2 and lands in band 2 (spec 4).
export function bandOf(level: number, effective: Thresholds): Band {
  if (level >= effective.t2) return 2;
  if (level >= effective.t1) return 1;
  return 0;
}

export function decide(
  input: Reading | NoReading,
  configured: Thresholds,
  covering: Covering | null,
  writeCommand: string,
): Decision {
  if (input.kind === "no-reading") {
    return { kind: "no-reading", text: `orca level: no reading — ${input.reason}` };
  }
  const effective = effectiveThresholds(input, configured);
  const level = levelOf(input);
  const band = bandOf(level, effective);
  if (band === 0) return { kind: "silent" };

  const head = `orca level: ${level} of ${input.windowTokens} tokens (T1 ${effective.t1}, T2 ${effective.t2})`;
  if (band === 2) {
    if (covering !== null && covering.band >= band) {
      return { kind: "breach", text: `${head} is past T2, the session limit. A checkpoint for this band is at ${covering.path}: hand off now.` };
    }
    return {
      kind: "breach",
      text: `${head} is past T2, the session limit. Write a checkpoint and hand off now; this overrun is recorded in the checkpoint. ${writeCommand}`,
    };
  }
  if (covering !== null && covering.band >= band) {
    return { kind: "inform", text: `${head}. A checkpoint for this band is at ${covering.path}.` };
  }
  return { kind: "write", text: `${head}. Write a checkpoint now. ${writeCommand}` };
}
