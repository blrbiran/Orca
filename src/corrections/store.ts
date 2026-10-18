import { appendFile, readFile } from "node:fs/promises";
import { CORRECTIONS_FILE_MODE, correctionsFile } from "./paths.js";
import { CorrectRejection } from "./rejection.js";
import { withStoreLock } from "./storeLock.js";
import { correctionSchema } from "./schema.js";
import type { Correction } from "./schema.js";
import { readWithdrawals, withdrawnIds } from "./withdrawals.js";

export const CORRECTION_ALREADY_RECORDED = "correction-already-recorded";
export const DUPLICATE_CORRECTION_ID = "duplicate-correction-id";
export const CORRECTION_NOT_FOUND = "correction-not-found";
/**
 * Control run decisions plan Task 10 (debug-task design §12.3): a correction of a decision a landing refused names
 * `{ runId, pendingId }`, and there is no ledger row for --close to overturn. Closing it is that design's own path.
 *
 * Decisions review spec §5.2: moved here from correct.ts (which re-exports it) because withdrawals.ts throws it too,
 * and importing it from correct.ts would pull the ledger writer and the repo lock into every reader of the
 * withdrawals store.
 */
export const CORRECTION_TARGET_NOT_A_DECISION = "correction-target-not-a-decision";

export async function readCorrections(dir: string): Promise<Correction[]> {
  const text = await readFile(correctionsFile(dir), "utf8").catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  });

  const rows: Correction[] = [];
  for (const raw of text.split("\n")) {
    if (raw.trim().length === 0) continue;
    rows.push(correctionSchema.parse(JSON.parse(raw)));
  }
  return rows;
}

/**
 * The raw append. The caller must already hold the store lock — this is not
 * checked, because the only way to check it would be to take the lock here,
 * and the whole point of the split is that the read, the judgement and the
 * append happen inside ONE hold (§14.7).
 *
 * The separator is the same lesson the ledger writer records: `appendFile`
 * concatenates bytes and inserts nothing, so a store whose last line has no
 * newline would get the new row glued onto the end of the old one — reported
 * as success, unparseable on disk.
 *
 * `mode` applies only when this call CREATES the file. An existing file keeps
 * whatever mode it has: that is a person's data and this program does not get
 * to decide it (§14.17).
 */
export async function appendCorrectionLocked(dir: string, row: Correction): Promise<void> {
  correctionSchema.parse(row);

  const file = correctionsFile(dir);
  const existingText = await readFile(file, "utf8").catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  });
  const separator = existingText.length > 0 && !existingText.endsWith("\n") ? "\n" : "";
  await appendFile(file, `${separator}${JSON.stringify(row)}\n`, { mode: CORRECTIONS_FILE_MODE });
}

/**
 * The critical section: acquire → read → judge → append → release, with the
 * release in a `finally` by construction (withStoreLock).
 *
 * Two checks, not one. The id check alone is nearly unreachable in practice —
 * an id is derived from a row that contains `at`, so running the same command
 * twice produces two different ids and two rows land silently, inflating the
 * denominator of A' §4.4's fix rate with nothing reporting it (§4.1). The
 * semantic check is the one a person actually trips, and `--again` is what
 * makes "yes, I really mean a second one" an explicit act rather than a silent
 * side effect.
 *
 * The key includes projectKey (§14.6): decision ids are derived and repeat
 * across clones and forks.
 */
export async function recordCorrection(
  dir: string,
  row: Correction,
  opts: { again: boolean },
): Promise<void> {
  await withStoreLock(dir, async () => {
    const rows = await readCorrections(dir);

    if (rows.some((existing) => existing.id === row.id)) {
      throw new CorrectRejection(
        DUPLICATE_CORRECTION_ID,
        `a correction with id ${row.id} is already in the store — this exact row has already been recorded`,
      );
    }

    if (!opts.again) {
      // Decisions review spec §5.3: a withdrawn correction no longer blocks a fresh one, so recording again after a
      // withdrawal needs no --again. Read inside this same hold, so a withdrawal cannot land between the two reads.
      // An unreadable withdrawals file refuses (correction-withdrawals-unreadable) rather than reading as "none".
      const withdrawn = withdrawnIds(await readWithdrawals(dir));
      const existing = rows.find(
        (candidate) =>
          !withdrawn.has(candidate.id) &&
          candidate.projectKey === row.projectKey &&
          candidate.decisionId === row.decisionId &&
          // Control run decisions plan Task 10: the target is decisionId or { runId, pendingId } (schema.ts).
          candidate.runId === row.runId &&
          candidate.pendingId === row.pendingId &&
          candidate.by === row.by,
      );
      if (existing !== undefined) {
        throw new CorrectRejection(
          CORRECTION_ALREADY_RECORDED,
          `${row.by} has already corrected ${row.decisionId ?? `pending decision ${row.pendingId} of run ${row.runId}`} in ${row.projectKey}: correction ${existing.id} ` +
            `(recorded ${existing.at}). Pass --again to record another one on purpose.`,
        );
      }
    }

    await appendCorrectionLocked(dir, row);
  });
}

export async function loadCorrection(dir: string, id: string): Promise<Correction> {
  return withStoreLock(dir, async () => {
    const found = (await readCorrections(dir)).find((row) => row.id === id);
    if (found === undefined) {
      throw new CorrectRejection(
        CORRECTION_NOT_FOUND,
        `no correction with id ${JSON.stringify(id)} in ${correctionsFile(dir)}`,
      );
    }
    return found;
  });
}
