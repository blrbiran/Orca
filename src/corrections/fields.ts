import { createHash } from "node:crypto";
import { deriveRunId } from "../scheduler/runId.js";
import type { Correction } from "./schema.js";

/** A correction row before its id exists — the id is a function of everything else. */
export type CorrectionRow = Omit<Correction, "id">;

/**
 * 🔴 The ONE definition of which fields identify a correction, and in what
 * order. Both derivations below read it: the correction id (a hash of the
 * canonical JSON) and the fix run id (deriveRunId over the canonical JSON,
 * keyed by that same correction id).
 *
 * Why one constant and not two: `by` reaches the run id by TWO routes — the
 * canonical JSON, and the correction id that is deriveRunId's third argument.
 * With two definitions, deleting `by` from one of them leaves the other
 * intact, both run ids still differ, and the criterion that is supposed to
 * pin "two people never write the same ledger file" cannot be made to go red
 * by any mutation at all (measured by the third review seat). One constant is
 * what gives that mutation a single place to land.
 *
 * ⚠️ This supersedes spec §4's literal formula
 * `sha256(projectKey|decisionId|at|because|by)`: §14.0's table changes the id's
 * field sequence to "the same named constant the run id uses", and §14.11's
 * conclusion says the run id is a function of THE WHOLE correction row plus its
 * id. Keeping a pipe-joined five-field subset for the id would have left two
 * definitions standing, which is the defect being fixed.
 *
 * The `satisfies readonly (keyof CorrectionRow)[]` constraint buys a compile
 * error for a typo'd field name here: without it, an entry that doesn't match
 * a real key would resolve to `undefined` when canonicalCorrectionJson indexes
 * the row with it, and the "absent optional field" guard would silently drop
 * it from both derivations instead of failing to compile.
 */
export const CORRECTION_FIELDS = [
  "projectKey",
  "decisionId",
  "kind",
  "chose_instead",
  "because",
  "at",
  "by",
] as const satisfies readonly (keyof CorrectionRow)[];

/**
 * Field order comes from CORRECTION_FIELDS, not from the object's own key
 * order: two rows built by different code paths must hash the same.
 * An absent optional field is omitted rather than written as null, so a row
 * that never had a `chose_instead` and one that had it removed cannot exist as
 * two different byte sequences.
 */
export function canonicalCorrectionJson(row: CorrectionRow): string {
  const canonical: Record<string, unknown> = {};
  for (const field of CORRECTION_FIELDS) {
    const value = (row as Record<string, unknown>)[field];
    if (value !== undefined) canonical[field] = value;
  }
  return JSON.stringify(canonical);
}

export function deriveCorrectionId(row: CorrectionRow): string {
  const hash = createHash("sha256").update(canonicalCorrectionJson(row), "utf8");
  return `c_${hash.digest("hex").slice(0, 16)}`;
}

/**
 * spec §7.1: the run id is derived from the correction row AS STORED, never
 * from the command line. The stored row is what a later `--close` reads back,
 * so the same correction always resolves to the same ledger file — which is
 * what makes a second `--close` collide with Check B instead of quietly
 * writing a second overturned into a different file (§14.1).
 *
 * deriveRunId is reused rather than re-implemented (spec §12 finding 4): a
 * hand-copied derivation across a module boundary drifts silently. `orca-fix-`
 * is its `orca-<taskId>-<hash8>` shape with the task id "fix".
 */
export function deriveFixRunId(row: CorrectionRow, correctionId: string): string {
  return deriveRunId("fix", Buffer.from(canonicalCorrectionJson(row), "utf8"), correctionId);
}
