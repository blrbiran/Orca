import { readLedgerAtRef } from "./ledgerAtRef.js";

/**
 * Debug-task design §12.1 (controller ruling C1, plan Task 6): a correction is closed when the ref's tree holds its
 * closing row -- the `decision` row deriveRows writes (src/corrections/derive.ts): id `<fixRunId>/1`, evidence naming
 * `correction <id>`. Read from git objects at `ref` only, never `git log --all`, so the rows a debug group landed on its
 * own branch (`orca/debug-<id>`) do not count until they reach the ref. A ref that does not resolve holds nothing.
 * Task 10 builds the full closed state on this one predicate.
 */
export async function correctionClosedAtRef(repo: string, ref: string, correctionId: string, fixRunId: string): Promise<boolean> {
  const lines = await readLedgerAtRef(repo, ref);
  if (lines === null) return false;
  const id = `${fixRunId}/1`;
  return lines.some(({ value }) => {
    if (typeof value !== "object" || value === null) return false;
    const row = value as { ev?: unknown; id?: unknown; evidence?: unknown };
    return row.ev === "decision" && row.id === id && Array.isArray(row.evidence) && row.evidence.includes(`correction ${correctionId}`);
  });
}
