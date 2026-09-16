import { fsArchiveIo } from "../metrics/collect.js";
import type { DiscoveredRepo } from "../metrics/discover.js";
import { readLedgerLeniently } from "../metrics/lenientRead.js";
import type { ArchiveIo } from "../metrics/resolve.js";
import type { LedgerView } from "./compactClassify.js";
import { ledgerFiles } from "./decisionSource.js";
import { readReviews } from "./reviewsStore.js";

export interface WantedDecision {
  projectKey: string;
  decisionId: string;
}

const idOf = (value: unknown): string | undefined => {
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
};

/**
 * A decision id is `<run-id>/<n>` and its ledger file is `<run-id>.jsonl`
 * (spec section 1.8 measured 156 of 156). The id is read from reviews.jsonl,
 * which is data, so a run part carrying a path separator is refused rather
 * than joined into a path: it would read a file outside the archive.
 */
function runIdOf(decisionId: string): string | undefined {
  const slash = decisionId.lastIndexOf("/");
  if (slash <= 0) return undefined;
  const runId = decisionId.slice(0, slash);
  if (runId.includes("/") || runId.includes("\\")) return undefined;
  return runId;
}

async function decisionIdsIn(file: string, into: Set<string>): Promise<boolean> {
  const read = await readLedgerLeniently(file);
  for (const row of read.rows) {
    if (row.kind !== "decision") continue;
    // Every ev:"decision" line counts, whatever validateLine would say about
    // it (spec section 3.1): a validator that tightens later must not turn a
    // reviewed decision into an orphan.
    const id = idOf(row.value);
    if (id !== undefined) into.add(id);
  }
  return read.malformed.length > 0;
}

/**
 * spec section 3.1 / ruling R-E. One view per DISCOVERED repository; a
 * repository missing from the map is "repo-not-discovered" to the classifier.
 * Only the archive files of runs that `wanted` actually names are read, one
 * level down, the same stat-by-name shape as src/metrics/resolve.ts.
 *
 * A malformed line in the TOP-LEVEL ledger makes the whole repository not
 * judged: it could be hiding an id, and a hidden id is a false orphan. A
 * malformed line in an ARCHIVE file can only hide evidence, which turns into
 * "decision-not-found" -- the safe direction -- so it needs no rule.
 */
export async function buildLedgerViews(
  repos: readonly DiscoveredRepo[],
  wanted: readonly WantedDecision[],
  io: ArchiveIo = fsArchiveIo,
): Promise<Map<string, LedgerView>> {
  const views = new Map<string, LedgerView>();
  for (const repo of repos) {
    const topLevelIds = new Set<string>();
    let malformed = false;
    for (const file of await ledgerFiles(repo.path)) {
      if (await decisionIdsIn(file, topLevelIds)) malformed = true;
    }
    if (malformed) {
      views.set(repo.projectKey, { judged: false, reason: "ledger-has-malformed-lines" });
      continue;
    }

    const runIds = new Set<string>();
    for (const w of wanted) {
      if (w.projectKey !== repo.projectKey || topLevelIds.has(w.decisionId)) continue;
      const runId = runIdOf(w.decisionId);
      if (runId !== undefined) runIds.add(runId);
    }
    const archivedIds = new Set<string>();
    if (runIds.size > 0) {
      const years = await io.listYearDirs(repo.path);
      for (const runId of runIds) {
        for (const year of years) {
          const path = `${repo.path}/.decisions/archive/${year}/${runId}.jsonl`;
          if (await io.statFile(path)) await decisionIdsIn(path, archivedIds);
        }
      }
    }
    views.set(repo.projectKey, { judged: true, topLevelIds, archivedIds });
  }
  return views;
}

/**
 * The decisions an unlocked read of reviews.jsonl names. A row appended after
 * this read is not in `wanted`, so its archive file is never read and it can
 * only come out "decision-not-found" or "kept" -- never a false orphan.
 */
export async function wantedDecisions(dir: string): Promise<WantedDecision[]> {
  return (await readReviews(dir)).map((row) => ({ projectKey: row.projectKey, decisionId: row.decisionId }));
}
