import { z } from "zod";
import {
  REFERENCE_EVENT_SCHEMAS,
  decisionEventSchema,
  isReferenceEventName,
} from "./schema.js";
import type { ValidationResult } from "./types.js";
import { undoHowIsExecutable } from "./undoExecutable.js";

const ATTRIBUTION_FIELDS = new Set(["taskId", "runId"]);

/**
 * True only when every issue zod raised is "this attribution field is absent".
 * A wrong-typed taskId, an empty runId, or any problem on another field all
 * fall through to a rejection, so the downgrade cannot widen by accident.
 * The three discriminators were measured against the pinned zod version rather
 * than assumed: a missing field reports code "invalid_type" with received
 * "undefined", an empty string reports "too_small", and a wrong type reports
 * received "number".
 */
function issuesAreOnlyMissingAttribution(issues: readonly z.ZodIssue[]): boolean {
  return (
    issues.length > 0 &&
    issues.every(
      (i) =>
        i.code === "invalid_type" &&
        i.received === "undefined" &&
        i.path.length === 1 &&
        typeof i.path[0] === "string" &&
        ATTRIBUTION_FIELDS.has(i.path[0]),
    )
  );
}

function rejected(reasons: string[]): ValidationResult {
  return { verdict: "rejected", reasons };
}

/**
 * spec §3.8 checks 1 / 2 / 4, applied to a single JSON line.
 * Check 3 is wired in by Task 3; check 5 belongs to validateFile;
 * check 6 belongs to checkAppendOnly.
 */
export function validateLine(raw: string): ValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return rejected([`not valid JSON: ${(error as Error).message}`]);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return rejected(["line is not a JSON object"]);
  }

  const ev = (parsed as { ev?: unknown }).ev;

  if (ev === "decision") {
    const result = decisionEventSchema.safeParse(parsed);
    if (!result.success) {
      return rejected(result.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`));
    }
    // Check 3 comes after the schema: rejection-class failures take priority
    // over downgrades (decision orca-dev-09cc3ea1/3).
    if (!undoHowIsExecutable(result.data.undo.how)) {
      return {
        verdict: "downgraded",
        tier: 0,
        reasons: [`undo.how is not executable: ${JSON.stringify(result.data.undo.how)}`],
      };
    }
    return { verdict: "ok" };
  }

  if (isReferenceEventName(ev)) {
    // Each reference event has its own shape now — bound carries attribution,
    // overturned is pinned all the way down, superseded is still the loose
    // one. The lookup is a Record keyed by ReferenceEventName rather than a
    // ternary chain, so a fourth name cannot be added without a schema.
    const schema = REFERENCE_EVENT_SCHEMAS[ev];
    const result = schema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`);
      // A bound whose *only* complaints are the two attribution fields is not
      // malformed — it is a line written before the fields existed, and the
      // ledger being append-only it can never acquire them. Tier 0 is the
      // honest verdict: a human, not an agent, has to say which task this
      // belongs to. Anything else wrong with the record is still a rejection;
      // widening this would quietly turn hard failures into warnings.
      //
      // ⚠️ This downgrade sits behind TWO independent guards: the `ev ===
      // "bound"` test here, and ATTRIBUTION_FIELDS holding only taskId and
      // runId. None of overturned's fields are in that set, so loosening
      // either guard on its own turns no criterion red — a redundant guard
      // cannot be pinned by a mutation that deletes only itself. This comment
      // is the only thing guarding it, deliberately: do NOT invent a
      // criterion that "covers" this, because such a criterion would pass
      // whether or not the guard exists and would prove nothing. What IS
      // pinned is the outcome — see tests/ledger/overturnedEvent.test.ts.
      if (ev === "bound" && issuesAreOnlyMissingAttribution(result.error.issues)) {
        return { verdict: "downgraded", tier: 0, reasons: issues };
      }
      return rejected(issues);
    }
    return { verdict: "ok" };
  }

  return rejected([`unknown ev: ${JSON.stringify(ev)}`]);
}
