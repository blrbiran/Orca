/**
 * The one place Orca knows where a run result keeps the decisions the agent reported:
 * the top-level `decisions` property. Everything downstream reads it through here.
 */
export type ReportedDecisions =
  | { kind: "absent" }
  | { kind: "array"; entries: unknown[] }
  | { kind: "malformed"; value: unknown };

export function reportedDecisionsOf(result: unknown): ReportedDecisions {
  if (typeof result !== "object" || result === null || !("decisions" in result)) return { kind: "absent" };
  const value = (result as { decisions?: unknown }).decisions;
  if (value === undefined) return { kind: "absent" };
  return Array.isArray(value) ? { kind: "array", entries: value } : { kind: "malformed", value };
}
