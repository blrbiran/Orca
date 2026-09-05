import { REFERENCE_EVENT_TYPES } from "./schema.js";
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

/**
 * Decision ids contributed by the *other* ledgers in the same .decisions/
 * directory.
 *
 * Required, not optional. An optional parameter would leave the scope as
 * something a caller has to remember to pass, and this round already walked
 * into that exact shape once: the writer was going to build the scope based on
 * what was being appended, while this function judges what the file contains.
 * A caller that means "this file only" says so with an empty set, and that
 * `new Set()` is the criterion stating its own scope out loud.
 */
export interface ResolutionScope {
  externalDecisionIds: ReadonlySet<string>;
}

const REFERENCE_EVENTS = new Set<string>(REFERENCE_EVENT_TYPES);

/**
 * spec §3.8 check 5, scoped by event type (A' spec ERRATUM 2):
 *
 *   bound.id              file  — it is always in the same run as its decision
 *   overturned.replacedBy file  — the decision the fix agent just wrote
 *   overturned.id         scope — crossing runs is what this event is for
 *   superseded.id         scope — same
 *
 * The basis is that a decision id is already `<run-id>/<n>`: globally unique
 * and self-describing. "Must be in the same file" was never a requirement of
 * that id's meaning, only of the single-file view check 5 was written from.
 *
 * Order is still not required — the spec says "exists in this file", not
 * "appears before".
 */
export function validateFile(rawLines: string[], scope: ResolutionScope): FileVerdict {
  const entries: Array<{ lineNumber: number; raw: string }> = [];
  rawLines.forEach((raw, index) => {
    if (raw.trim().length > 0) {
      entries.push({ lineNumber: index + 1, raw });
    }
  });

  const fileDecisionIds = new Set<string>();
  for (const entry of entries) {
    try {
      const parsed = JSON.parse(entry.raw) as { ev?: unknown; id?: unknown };
      if (parsed.ev === "decision" && typeof parsed.id === "string") {
        fileDecisionIds.add(parsed.id);
      }
    } catch {
      // Lines that fail to parse are left for validateLine to reject; here we only collect ids.
    }
  }

  const scopedIds = new Set<string>(fileDecisionIds);
  for (const id of scope.externalDecisionIds) scopedIds.add(id);

  /**
   * No fourth verdict state. "Could not resolve" stays a rejection, and the
   * reason carries the scope it searched instead — adding a state would ripple
   * into the CLI's 0/1/2 exit codes and into pre-commit's tolerance of 2.
   */
  const unresolved = (
    ev: string,
    field: string,
    id: unknown,
    where: "file" | "scope",
  ): ValidationResult => ({
    verdict: "rejected",
    reasons: [
      `${ev} references unknown decision id in ${field}: ${JSON.stringify(id)}` +
        (where === "scope"
          ? ` (searched this file plus ${scope.externalDecisionIds.size} external id(s); validate the whole .decisions/ directory to widen the scope)`
          : " (this reference must resolve inside its own file)"),
    ],
  });

  const lines: LineVerdict[] = entries.map((entry) => {
    const result = validateLine(entry.raw);
    if (result.verdict === "rejected") {
      return { lineNumber: entry.lineNumber, result };
    }

    let parsed: { ev?: unknown; id?: unknown; replacedBy?: unknown };
    try {
      parsed = JSON.parse(entry.raw) as { ev?: unknown; id?: unknown; replacedBy?: unknown };
    } catch {
      return { lineNumber: entry.lineNumber, result };
    }

    if (typeof parsed.ev === "string" && REFERENCE_EVENTS.has(parsed.ev)) {
      const fileScoped = parsed.ev === "bound";
      const pool = fileScoped ? fileDecisionIds : scopedIds;
      if (typeof parsed.id !== "string" || !pool.has(parsed.id)) {
        return {
          lineNumber: entry.lineNumber,
          result: unresolved(parsed.ev, "id", parsed.id, fileScoped ? "file" : "scope"),
        };
      }
      if (parsed.ev === "overturned") {
        if (typeof parsed.replacedBy !== "string" || !fileDecisionIds.has(parsed.replacedBy)) {
          return {
            lineNumber: entry.lineNumber,
            result: unresolved(parsed.ev, "replacedBy", parsed.replacedBy, "file"),
          };
        }
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
