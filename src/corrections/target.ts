import { namesDecision, type Correction } from "./schema.js";
import type { CorrectionRow } from "./fields.js";
import { CorrectRejection } from "./rejection.js";
import { CORRECTION_ROW_INVALID } from "./record.js";

/**
 * What a correction points at (debug-task design §12.3): a recorded decision, or a decision a landing refused, named by
 * the run and its pending item. The schema already requires exactly one of the two; this is the single place that reads
 * it, so no caller re-derives it from the optional fields.
 */
export type CorrectionTarget =
  | { kind: "decision"; decisionId: string }
  | { kind: "pending"; runId: string; pendingId: string };

export function correctionTargetOf(row: Correction | CorrectionRow): CorrectionTarget {
  const { runId, pendingId } = row;
  const pending = runId !== undefined && pendingId !== undefined;
  const partial = (runId !== undefined) !== (pendingId !== undefined);
  const names = namesDecision(row);
  if (names === pending || partial) {
    throw new CorrectRejection(CORRECTION_ROW_INVALID, "a correction names exactly one target: decisionId, or both runId and pendingId");
  }
  return names ? { kind: "decision", decisionId: row.decisionId } : { kind: "pending", runId: runId as string, pendingId: pendingId as string };
}
