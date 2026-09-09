import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { correctionsFile } from "../corrections/paths.js";
import { validateLine } from "../ledger/validateLine.js";
import type { DecisionEvent } from "../ledger/schema.js";
import { discoverRepos, enforceIntegrityGate } from "./discover.js";
import type { DiscoverOptions, DiscoveredRepo, UnkeyableRepo } from "./discover.js";
import { readCorrectionsLeniently, readLedgerLeniently } from "./lenientRead.js";
import { MetricsRejection } from "./rejection.js";
import { resolveOverturned } from "./resolve.js";
import type { ArchiveIo } from "./resolve.js";
import type {
  DecisionObservation,
  MalformedLine,
  OverturnedObservation,
  UnresolvedDecision,
} from "./types.js";
import type { Correction } from "../corrections/schema.js";

// Re-exported so a caller that already imports collect does not need a second
// import path for the refusal type it has to catch.
export { MetricsRejection } from "./rejection.js";
export type { DiscoveredRepo, UnkeyableRepo } from "./discover.js";

export const FUTURE_ROWS_WITHOUT_AS_OF = "future-rows-without-as-of";
export const AS_OF_NOT_A_TIMESTAMP = "as-of-not-a-timestamp";

export interface CorrectionObservation {
  /**
   * 🔴 The WHOLE row, not a handful of fields. deriveFixRunId hashes all seven
   * of CORRECTION_FIELDS (projectKey, decisionId, kind, chose_instead, because,
   * at, by); dropping any of them makes the archived fix run unfindable.
   */
  row: Correction;
}

export interface Observations {
  asOf: string;
  asOfMode: "explicit" | "wall_clock";
  /**
   * 🔴 Carried whole, including repositories with zero decisions — that is
   * exactly the repository §2.1's scan exists to find, and rebuilding this list
   * from `decisions` would make it disappear.
   */
  repos: DiscoveredRepo[];
  decisions: DecisionObservation[];
  corrections: CorrectionObservation[];
  overturned: OverturnedObservation[];
  excludedAsFuture: number;
  unresolvedDecisions: UnresolvedDecision[];
  unkeyableRepos: UnkeyableRepo[];
  malformed: MalformedLine[];
}

export interface CollectOptions extends DiscoverOptions {
  correctionsDir: string;
  /** ISO 8601. Given ⇒ filter mode; absent ⇒ wall-clock mode (spec §4.2). */
  asOf?: string;
  /** spec §4.3: injected, never read from a clock in here. */
  now?: () => string;
}

/**
 * The one place in this subsystem that touches the filesystem for the archive.
 * Exported so a criterion can measure its traversal size directly: the risk
 * that "one level" quietly becomes "walk the whole tree" lives HERE, in the
 * real implementation, and the injected fake in resolve.ts's tests cannot see
 * it.
 */
export const fsArchiveIo: ArchiveIo = {
  async listYearDirs(repoPath: string): Promise<string[]> {
    const entries = await readdir(join(repoPath, ".decisions", "archive"), {
      withFileTypes: true,
    }).catch(() => []);
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  },
  async statFile(path: string): Promise<boolean> {
    return stat(path).then(
      () => true,
      () => false,
    );
  },
  async readFile(path: string): Promise<string> {
    return readFile(path, "utf8");
  },
};

/**
 * spec §4.2, rewritten after the first review seat's finding C1.
 *
 * --as-of has ONE meaning: filter the input set to what existed at that
 * instant. It is not a `now` substitute wearing a guard. The original design
 * kept a "negative age ⇒ refuse" guard alongside it, which meant any store
 * holding a row newer than the --as-of refused the query outright — the exact
 * historical query the flag exists for. And the guard's message blamed clock
 * skew, when the ordinary cause was a person passing an earlier time.
 *
 * So the guard lives in the one place it is true: when NO --as-of was given,
 * as-of is the wall clock, and no legal path produces a row dated after it.
 */
export async function collect(opts: CollectOptions): Promise<Observations> {
  const asOfMode = opts.asOf === undefined ? "wall_clock" : "explicit";
  const asOf = opts.asOf ?? (opts.now ?? (() => new Date().toISOString()))();
  if (Number.isNaN(Date.parse(asOf))) {
    throw new MetricsRejection(
      AS_OF_NOT_A_TIMESTAMP,
      `--as-of ${JSON.stringify(asOf)} is not an ISO 8601 timestamp`,
    );
  }
  const asOfMs = Date.parse(asOf);

  const { repos, unkeyable } = await discoverRepos(opts);
  const malformed: MalformedLine[] = [];
  const decisions: DecisionObservation[] = [];
  const future: string[] = [];
  const overturned: OverturnedObservation[] = [];
  const unresolvedDecisions: UnresolvedDecision[] = [];

  const keep = (at: string, label: string): boolean => {
    if (Date.parse(at) <= asOfMs) return true;
    future.push(label);
    return false;
  };

  const storeRead = await readCorrectionsLeniently(correctionsFile(opts.correctionsDir));
  malformed.push(...storeRead.malformed);

  const corrections: CorrectionObservation[] = [];
  for (const row of storeRead.rows) {
    if (!keep(row.at, row.id)) continue;
    corrections.push({ row });
  }

  for (const repo of repos) {
    const closed = new Set<string>();
    const decisionIds = new Set<string>();

    for (const file of await ledgerFiles(repo.path)) {
      const read = await readLedgerLeniently(file);
      malformed.push(...read.malformed);
      for (const row of read.rows) {
        if (row.kind === "overturned") {
          if (!keep(row.row.at, `${row.row.correctionId} (overturned)`)) continue;
          closed.add(row.row.correctionId);
          overturned.push({ correctionId: row.row.correctionId, at: row.row.at });
          continue;
        }
        // spec §3.4 / A' §1.1: validateLine owns the verdict. A `rejected`
        // decision is not a legal record and stays out of the denominator; a
        // `downgraded` one is legal and goes in. Neither is a malformed line.
        const verdict = validateLine(row.raw);
        if (verdict.verdict === "rejected") continue;
        const event = row.value as DecisionEvent;
        if (!keep(event.at, event.id)) continue;
        decisionIds.add(event.id);
        decisions.push({
          projectKey: repo.projectKey,
          id: event.id,
          at: event.at,
          kind: event.kind,
          scope: event.scope,
          verdict: verdict.verdict === "downgraded" ? "downgraded" : "ok",
        });
      }
    }

    const mine = corrections.filter((c) => c.row.projectKey === repo.projectKey);
    const resolved = await resolveOverturned(
      {
        repoPath: repo.path,
        projectKey: repo.projectKey,
        corrections: mine,
        scanned: { overturnedCorrectionIds: closed, decisionIds },
      },
      fsArchiveIo,
    );
    overturned.push(...resolved.overturned);
    unresolvedDecisions.push(...resolved.unresolvedDecisions);
  }

  if (asOfMode === "wall_clock" && future.length > 0) {
    throw new MetricsRejection(
      FUTURE_ROWS_WITHOUT_AS_OF,
      `${future.length} row(s) are dated after now (${asOf}), and no --as-of was given:\n` +
        `${[...future].sort().map((f) => `  ${f}`).join("\n")}\n` +
        `No legal path produces these — it is clock skew or a bad \`at\`. ` +
        `Pass --as-of to ask what the numbers looked like at a chosen instant instead.`,
    );
  }

  // 🔴 The gate runs on the FULL set of keys in the store, not on the filtered
  // one: a key whose only correction is newer than --as-of still names a
  // repository whose decisions belong in the denominator, and hiding it here
  // would make the gate's silence depend on a flag.
  enforceIntegrityGate(
    repos,
    storeRead.rows.map((r) => r.projectKey),
  );

  overturned.sort((a, b) =>
    a.correctionId < b.correctionId ? -1 : a.correctionId > b.correctionId ? 1 : 0,
  );
  unresolvedDecisions.sort((a, b) =>
    a.correctionId < b.correctionId ? -1 : a.correctionId > b.correctionId ? 1 : 0,
  );
  malformed.sort((a, b) => (a.file !== b.file ? (a.file < b.file ? -1 : 1) : a.line - b.line));

  return {
    asOf,
    asOfMode,
    repos,
    decisions,
    corrections,
    overturned,
    excludedAsFuture: future.length,
    unresolvedDecisions,
    unkeyableRepos: unkeyable,
    malformed,
  };
}

/** Top-level *.jsonl only — A' §3.7.1: archive/ is not scanned by default. */
async function ledgerFiles(repo: string): Promise<string[]> {
  const dir = join(repo, ".decisions");
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
    .map((e) => join(dir, e.name))
    .sort();
}
