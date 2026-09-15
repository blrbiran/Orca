import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { readLedgerLeniently } from "../metrics/lenientRead.js";

/**
 * Top-level *.jsonl only, same file set and order as src/metrics/collect.ts's
 * `ledgerFiles`. That function is not exported there, so its four lines are
 * copied here rather than editing E2 (task 6 ruling H2): `src/metrics/**` gets
 * zero diff from this task.
 */
async function ledgerFiles(repo: string): Promise<string[]> {
  const dir = join(repo, ".decisions");
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
    .map((e) => join(dir, e.name))
    .sort();
}

/**
 * Reads the WHOLE decision row (question/chose/alternatives/because/undo and
 * all) -- the detail page needs every field, unlike the flattened
 * `DecisionObservation` metrics uses. Not a new parser: `readLedgerLeniently`
 * (E2) hands back the unjudged raw value for every `ev: "decision"` line, and
 * this just walks the same file set collect() does looking for a matching id.
 *
 * `repoPath` is a value api.ts already resolved from `observations.repos`
 * (spec ruling H2) -- never a filesystem path built from what a browser sent,
 * so a caller cannot use `projectKey` to read outside a discovered repository.
 */
export async function loadDecisionRow(repoPath: string, decisionId: string): Promise<unknown | undefined> {
  for (const file of await ledgerFiles(repoPath)) {
    const read = await readLedgerLeniently(file);
    for (const row of read.rows) {
      if (row.kind !== "decision") continue;
      const value = row.value as { id?: unknown };
      if (value.id === decisionId) return row.value;
    }
  }
  return undefined;
}
