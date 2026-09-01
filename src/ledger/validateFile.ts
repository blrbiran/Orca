import { validateLine } from "./validateLine.js";
import type { ValidationResult } from "./types.js";

export interface LineVerdict {
  lineNumber: number;
  result: ValidationResult;
}

export interface FileVerdict {
  verdict: "ok" | "downgraded" | "rejected";
  lines: LineVerdict[];
}

const REFERENCE_EVENTS = new Set(["bound", "superseded", "overturned"]);

/**
 * spec §3.8 check 5: the id a bound / superseded / overturned event references
 * must exist in this file. "Exist" = there is a record in this file with
 * ev=decision and the same id. Order is not required — the spec's text is
 * "exists in this file", and adding an ordering constraint would be a
 * tightening this plan has no authority to make.
 */
export function validateFile(rawLines: string[]): FileVerdict {
  const entries: Array<{ lineNumber: number; raw: string }> = [];
  rawLines.forEach((raw, index) => {
    if (raw.trim().length > 0) {
      entries.push({ lineNumber: index + 1, raw });
    }
  });

  const decisionIds = new Set<string>();
  for (const entry of entries) {
    try {
      const parsed = JSON.parse(entry.raw) as { ev?: unknown; id?: unknown };
      if (parsed.ev === "decision" && typeof parsed.id === "string") {
        decisionIds.add(parsed.id);
      }
    } catch {
      // Lines that fail to parse are left for validateLine to reject; here we only collect ids.
    }
  }

  const lines: LineVerdict[] = entries.map((entry) => {
    const result = validateLine(entry.raw);
    if (result.verdict === "rejected") {
      return { lineNumber: entry.lineNumber, result };
    }

    let parsed: { ev?: unknown; id?: unknown };
    try {
      parsed = JSON.parse(entry.raw) as { ev?: unknown; id?: unknown };
    } catch {
      return { lineNumber: entry.lineNumber, result };
    }

    if (typeof parsed.ev === "string" && REFERENCE_EVENTS.has(parsed.ev)) {
      if (typeof parsed.id !== "string" || !decisionIds.has(parsed.id)) {
        return {
          lineNumber: entry.lineNumber,
          result: {
            verdict: "rejected",
            reasons: [`${parsed.ev} references unknown decision id: ${JSON.stringify(parsed.id)}`],
          },
        };
      }
    }

    return { lineNumber: entry.lineNumber, result };
  });

  const hasRejected = lines.some((l) => l.result.verdict === "rejected");
  const hasDowngraded = lines.some((l) => l.result.verdict === "downgraded");

  return {
    verdict: hasRejected ? "rejected" : hasDowngraded ? "downgraded" : "ok",
    lines,
  };
}
