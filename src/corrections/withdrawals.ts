import { appendFile, readFile } from "node:fs/promises";
import { z } from "zod";
import { CORRECTIONS_FILE_MODE, withdrawalsFile } from "./paths.js";
import { CorrectRejection } from "./rejection.js";
import { namesDecision } from "./schema.js";
import type { DecisionCorrection } from "./schema.js";
import { CORRECTION_NOT_FOUND, CORRECTION_TARGET_NOT_A_DECISION, readCorrections } from "./store.js";
import { withStoreLock } from "./storeLock.js";

/**
 * Decisions review and correction withdraw spec §5.1: a withdrawal lives in its OWN file,
 * `<correctionsDir>/correction-withdrawals.jsonl`, not as a new row shape in corrections.jsonl. That file's readers
 * are strict and some of them run inside older builds (§3): a row they do not know would make every one of them
 * refuse the whole store. Here, corrections.jsonl is never written at all — it stays byte-identical across a
 * withdrawal.
 *
 * Append-only like its neighbour: a withdrawal is never undone by deleting its row. A correction is withdrawn when
 * this file has a row naming its id.
 *
 * Strict for the same reason correctionSchema is strict: a row that does not parse is a refusal by name, never a
 * guess.
 */
export const withdrawalSchema = z
  .object({
    correctionId: z.string().min(1),
    /** Copied from the correction, so a reader can key withdrawals by project without joining corrections.jsonl. */
    projectKey: z.string().min(1),
    by: z.string().min(1),
    at: z.string().min(1),
  })
  .strict();

export type CorrectionWithdrawal = z.infer<typeof withdrawalSchema>;

/** §5.2's refusals, in the order withdrawCorrection checks them (not-found and not-a-decision live in store.ts). */
export const CORRECTION_NOT_YOURS = "correction-not-yours";
export const CORRECTION_ALREADY_WITHDRAWN = "correction-already-withdrawn";
export const CORRECTION_CLOSED = "correction-closed";
/** §5.3: `orca correct --close` on a withdrawn correction (thrown in correct.ts). */
export const CORRECTION_WITHDRAWN = "correction-withdrawn";
/**
 * A line of the withdrawals file that does not parse. Never read as "nothing is withdrawn": that reading would turn
 * every withdrawn correction back into an open one — an "already corrected" block on the next record, a --close
 * that lands an overturn the person took back.
 */
export const CORRECTION_WITHDRAWALS_UNREADABLE = "correction-withdrawals-unreadable";

/**
 * Strict read. ENOENT is "nobody has withdrawn anything yet", the ordinary state before the first withdrawal; any
 * other read error is rethrown as is, the way readCorrections does. The caller decides whether to hold the store
 * lock: recordCorrection and withdrawCorrection already hold it (it is not re-entrant), --close takes it for this
 * read alone. Metrics read this file leniently instead (spec §5.3), with their own reader.
 */
export async function readWithdrawals(dir: string): Promise<CorrectionWithdrawal[]> {
  const file = withdrawalsFile(dir);
  const text = await readFile(file, "utf8").catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  });

  const rows: CorrectionWithdrawal[] = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    if (raw.trim().length === 0) continue;
    try {
      rows.push(withdrawalSchema.parse(JSON.parse(raw)));
    } catch (error) {
      throw new CorrectRejection(
        CORRECTION_WITHDRAWALS_UNREADABLE,
        `line ${index + 1} of ${file} is not a correction withdrawal (${(error as Error).message.split("\n")[0]}); ` +
          `fix or remove that line by hand — nothing reads the file as "no withdrawals" while it is there`,
      );
    }
  }
  return rows;
}

export function withdrawnIds(rows: readonly CorrectionWithdrawal[]): Set<string> {
  return new Set(rows.map((row) => row.correctionId));
}

/**
 * The critical section, one store-lock hold: read both files → judge → append (same shape as recordCorrection).
 *
 * §5.2's refusals, in this order: not-found, target-not-a-decision, not-yours, already-withdrawn, closed. The order
 * is part of the contract: a person withdrawing someone else's already-withdrawn correction is told it is not
 * theirs, not that it is already withdrawn.
 *
 * `isClosed` is the caller's: closed-ness needs the ledger scan the panel route already runs before taking this
 * lock. The window between that scan and this append is accepted and recorded in §5.2, not fixed: closing writes
 * the ledger, not this store.
 *
 * The review mark that came with the correction (§5.4) is NOT this function's: the route withdraws it afterwards.
 */
export async function withdrawCorrection(
  dir: string,
  input: { correctionId: string; by: string; at: string; isClosed: (c: DecisionCorrection) => boolean },
): Promise<{ correction: DecisionCorrection; withdrawal: CorrectionWithdrawal }> {
  return withStoreLock(dir, async () => {
    const corrections = await readCorrections(dir);
    const withdrawals = await readWithdrawals(dir);

    const correction = corrections.find((row) => row.id === input.correctionId);
    if (correction === undefined) {
      throw new CorrectRejection(CORRECTION_NOT_FOUND, `no correction with id ${JSON.stringify(input.correctionId)}`);
    }
    if (!namesDecision(correction)) {
      throw new CorrectRejection(
        CORRECTION_TARGET_NOT_A_DECISION,
        `correction ${correction.id} names pending decision ${correction.pendingId} of run ${correction.runId}, ` +
          `not a recorded decision: withdrawing it is not supported`,
      );
    }
    if (correction.by !== input.by) {
      throw new CorrectRejection(
        CORRECTION_NOT_YOURS,
        `correction ${correction.id} was recorded by ${correction.by}; only they can withdraw it`,
      );
    }
    const earlier = withdrawals.find((row) => row.correctionId === correction.id);
    if (earlier !== undefined) {
      throw new CorrectRejection(
        CORRECTION_ALREADY_WITHDRAWN,
        `correction ${correction.id} was already withdrawn by ${earlier.by} at ${earlier.at}`,
      );
    }
    if (input.isClosed(correction)) {
      throw new CorrectRejection(
        CORRECTION_CLOSED,
        `correction ${correction.id} is already closed: its overturn is in the ledger, so withdrawing it would ` +
          `leave a fix with no correction behind it. To change your mind, record a new correction instead`,
      );
    }

    const withdrawal = withdrawalSchema.parse({
      correctionId: correction.id,
      projectKey: correction.projectKey,
      by: input.by,
      at: input.at,
    });
    // The same two rules as appendCorrectionLocked (store.ts records why): a separator when the last line has no
    // newline, so the row is never glued onto it; and an explicit mode that applies only when this call CREATES the
    // file — an existing file keeps the mode its person gave it.
    const file = withdrawalsFile(dir);
    const existingText = await readFile(file, "utf8").catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw error;
    });
    const separator = existingText.length > 0 && !existingText.endsWith("\n") ? "\n" : "";
    await appendFile(file, `${separator}${JSON.stringify(withdrawal)}\n`, { mode: CORRECTIONS_FILE_MODE });
    return { correction, withdrawal };
  });
}
