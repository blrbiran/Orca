import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { readLedgerLeniently } from "../metrics/lenientRead.js";

/**
 * Top-level *.jsonl only, same file set and order as src/metrics/collect.ts's
 * `ledgerFiles`. That function is not exported there, so its four lines are
 * copied here rather than editing E2 (task 6 ruling H2): `src/metrics/**` gets
 * zero diff from this task.
 */
export async function ledgerFiles(repo: string): Promise<string[]> {
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

/**
 * Panel UI redesign spec §4 (human ruling U1, session a50f4d80): the list rows now
 * carry each decision's question. Same file set and order as `loadDecisionRow`, and
 * the FIRST line for an id wins -- the same line `loadDecisionRow` opens -- so the
 * summary on a row and the detail behind it are never two different decisions.
 */
export async function loadQuestions(repoPath: string): Promise<Map<string, string>> {
  const questions = new Map<string, string>();
  // An id is claimed by its FIRST decision line even when that line's question is
  // unusable, so a later line can never lend a question to a detail that shows another.
  const seen = new Set<string>();
  for (const file of await ledgerFiles(repoPath)) {
    const read = await readLedgerLeniently(file);
    for (const row of read.rows) {
      if (row.kind !== "decision") continue;
      const value = row.value as { id?: unknown; question?: unknown };
      if (typeof value.id !== "string" || seen.has(value.id)) continue;
      seen.add(value.id);
      if (typeof value.question !== "string" || value.question === "") continue;
      questions.set(value.id, value.question);
    }
  }
  return questions;
}

/**
 * The list is a to-do list: a summary that cannot be read must not take the rows
 * away with it. `ledgerFiles` already swallows a readdir failure; what can still
 * throw is reading one ledger file.
 */
export async function loadQuestionsOrEmpty(repoPath: string): Promise<Map<string, string>> {
  try {
    return await loadQuestions(repoPath);
  } catch {
    return new Map();
  }
}
