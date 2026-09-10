import { CORRECTION_FIELDS, deriveCorrectionId } from "./fields.js";
import type { CorrectionRow } from "./fields.js";
import { CorrectRejection } from "./rejection.js";
import { correctionSchema } from "./schema.js";
import type { Correction } from "./schema.js";
import { recordCorrection } from "./store.js";

/**
 * A row reached this far without being a legal correction. Named, because the
 * alternative is what this seam was built to remove: the schema parse inside
 * appendCorrectionLocked throws a bare ZodError, which carries no `code`, so
 * cli.ts's catch falls through to exit 3 and prints a Zod dump at a person who
 * typed one wrong flag. Measured: `--chose-instead ""` does exactly that today.
 */
export const CORRECTION_ROW_INVALID = "correction-row-invalid";

/**
 * 🔴 E3 spec §2.3 / §9 item 6, authorised by the human on 2026-09-10: the ONE
 * place a new correction is turned into a stored row.
 *
 * Why it exists: `correct(argv)` parses argv, writes stdout and returns an exit
 * code, so a request handler cannot call it -- and the row literal plus its id
 * derivation had grown a second copy inside that function. fields.ts records
 * the bill for exactly this shape: with the construction written twice, the
 * criterion that says the two paths agree cannot be made to go red by any
 * mutation, because there is no single place to mutate.
 *
 * It takes an already-built row and touches neither argv nor stdout, so the
 * panel and the CLI can both stand on it.
 *
 * ⚠️ §2.3's named toxicity, and the reason the check below is here rather than
 * left to the store: `canonicalCorrectionJson` only collects a field when it is
 * not `undefined`, so `chose_instead: ""` and an omitted `chose_instead` derive
 * DIFFERENT ids -- measured, c_ead8e04b… vs c_407cfe6e… -- and the store's
 * duplicate check therefore misses. An empty box in a web form is the shape
 * that produces it.
 *
 * *** ERRATUM (2026-09-10, first external review of the seam) ***
 * Those two ids are not reproducible from anything written down: the row they
 * were measured on was never recorded, and re-deriving them from this file's
 * own fixture (tests/corrections/recordSeam.test.ts) yields a different pair.
 * The MECHANISM above is confirmed -- an empty string and an absent field do
 * derive different ids -- but treat the two literals as unverifiable. CLAUDE.md
 * Rule 14 wants the measuring command alongside any recorded measurement, and
 * this comment was written without one. Recorded here rather than edited above
 * because the line is published text.
 *
 * ⚠️ It refuses rather than normalising `""` to absent. Coercing would let
 * someone who left the box empty believe they had said something, and the
 * field it silently drops is the one A' §4.3 calls the most valuable in the
 * row (CLAUDE.md Rule 12: fail loud).
 */
export async function recordNewCorrection(
  dir: string,
  row: CorrectionRow,
  opts: { again: boolean },
): Promise<Correction> {
  // Key order matches what correct.ts wrote before this seam existed: the
  // stored bytes are JSON.stringify of this object, and rows already on disk
  // have `id` first.
  const stored: Correction = { id: deriveCorrectionId(row), ...row };

  const parsed = correctionSchema.safeParse(stored);
  if (!parsed.success) {
    const named = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    // The empty-string advice is conditional, and the condition is measured
    // rather than assumed: only say "leave it out" when a field really did
    // arrive as "".
    //
    // *** ERRATUM (2026-09-10, first external review of the seam) ***
    // As first written this sentence was appended to EVERY schema failure.
    // correctionSchema's superRefine also refuses `not_my_taste` with no
    // chose_instead (schema.ts), and that issue asks for the OPPOSITE -- the
    // field must be filled in. Measured on the real CLI: `orca correct --kind
    // not_my_taste --because ...` with no --chose-instead answered
    //   "chose_instead: required when kind is not_my_taste. An optional field
    //    must be left out, not sent empty ..."
    // -- two contradictory instructions in one refusal, on a path reachable
    // today, with no criterion covering it. Giving a person who mistyped one
    // flag something they can act on is this guard's entire reason to exist.
    const sentEmpty = CORRECTION_FIELDS.filter(
      (field) => (row as Record<string, unknown>)[field] === "",
    );
    const advice =
      sentEmpty.length === 0
        ? ""
        : ` An optional field must be left out, not sent empty (${sentEmpty.join(", ")}) -- an empty ` +
          `string and an absent field derive different correction ids, so the duplicate check would ` +
          `not see them as the same row.`;
    throw new CorrectRejection(CORRECTION_ROW_INVALID, `this is not a legal correction row: ${named}.${advice}`);
  }

  await recordCorrection(dir, stored, opts);
  return stored;
}
