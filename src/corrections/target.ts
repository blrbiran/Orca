import { namesDecision, type Correction } from "./schema.js";
import type { CorrectionRow } from "./fields.js";
import { CorrectRejection } from "./rejection.js";
import { CORRECTION_ROW_INVALID } from "./record.js";

/**
 * What a correction points at (debug-task design §12.3, flow engine spec §13.1): a recorded decision; a decision a
 * landing refused, named by the run and its pending item; a whole run (a bare run); or nothing but the repository (one
 * sentence). The schema already allows only these four; this is the single place that reads them, so no caller
 * re-derives a target from the optional fields.
 */
export type CorrectionTarget =
  | { kind: "decision"; decisionId: string }
  | { kind: "pending"; runId: string; pendingId: string }
  | { kind: "run"; runId: string }
  | { kind: "repository" };

export function correctionTargetOf(row: Correction | CorrectionRow): CorrectionTarget {
  const { runId, pendingId } = row;
  if ((pendingId !== undefined && runId === undefined) || (namesDecision(row) && runId !== undefined)) {
    throw new CorrectRejection(CORRECTION_ROW_INVALID, "a correction names at most one target: decisionId, runId (with or without pendingId), or none; pendingId needs runId");
  }
  if (namesDecision(row)) return { kind: "decision", decisionId: row.decisionId };
  if (runId !== undefined && pendingId !== undefined) return { kind: "pending", runId, pendingId };
  if (runId !== undefined) return { kind: "run", runId };
  return { kind: "repository" };
}

/** The target in words, for refusals and memory text; the two original shapes keep their wording. */
export function describeCorrectionTarget(row: Correction | CorrectionRow): string {
  const target = correctionTargetOf(row);
  switch (target.kind) {
    case "decision": return `decision ${target.decisionId}`;
    case "pending": return `pending decision ${target.pendingId} of run ${target.runId}`;
    case "run": return `run ${target.runId}`;
    case "repository": return `repository ${row.projectKey}`;
  }
}
