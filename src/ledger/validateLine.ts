import { decisionEventSchema, referenceEventSchema } from "./schema.js";
import type { ValidationResult } from "./types.js";
import { undoHowIsExecutable } from "./undoExecutable.js";

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

  if (ev === "bound" || ev === "superseded" || ev === "overturned") {
    const result = referenceEventSchema.safeParse(parsed);
    if (!result.success) {
      return rejected(result.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`));
    }
    return { verdict: "ok" };
  }

  return rejected([`unknown ev: ${JSON.stringify(ev)}`]);
}
