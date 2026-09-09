import { deriveFixRunId } from "../corrections/fields.js";
import type { CorrectionRow } from "../corrections/fields.js";
import type { Correction } from "../corrections/schema.js";
import { MetricsRejection } from "./rejection.js";
import type { OverturnedObservation, UnresolvedDecision } from "./types.js";

export const ARCHIVE_NAME_AMBIGUOUS = "archive-name-ambiguous";

/**
 * spec §3.4.2, first review seat's finding C4.
 *
 * The fix rate's numerator comes from `overturned` rows, and `orca correct
 * --close` writes them into its OWN new run file (spec §1.11). That file ages
 * like any other and gets `git mv`'d into archive/. Once it does, the default
 * scan cannot see it, and a correction closed months ago reappears as backlog:
 * the fix rate drops and "age of the oldest open correction" reports one that
 * is not open. The failure points at "nobody is doing the work", which is the
 * worst possible direction for it to point.
 *
 * The cheap exact fix: deriveFixRunId is a pure function of the correction ROW,
 * and the file is named `<runId>.jsonl`. So for each correction with no
 * overturned in the default scan, compute the one filename it could be in and
 * ask for that one name.
 *
 * 🔴 ONE level, not a recursive walk. A' §3.7.1 item 2 says archiving moves a
 * run file into `.decisions/archive/<YYYY>/` — the depth is fixed upstream. A
 * recursive walk would be wider than needed AND would trade away §3.4.2's
 * stated cost ("one stat per open correction") for a whole-tree traversal per
 * repository, in a way a criterion that only checks which files were READ
 * cannot observe. That is why the io is injected and the criterion counts the
 * paths it was asked for.
 *
 * 🔴 Zero fs, zero clock, zero git — same discipline spec §5 puts on compute.
 * Paths are joined with string concatenation rather than node:path so that this
 * module imports nothing; package.json's `os` is ["darwin","linux"], which is
 * the boundary that makes that acceptable.
 */
export interface ArchiveIo {
  listYearDirs(repoPath: string): Promise<string[]>;
  statFile(path: string): Promise<boolean>;
  readFile(path: string): Promise<string>;
}

export interface ResolveInput {
  repoPath: string;
  projectKey: string;
  corrections: ReadonlyArray<{ row: Correction }>;
  scanned: {
    overturnedCorrectionIds: ReadonlySet<string>;
    decisionIds: ReadonlySet<string>;
  };
}

export interface ResolveOutput {
  overturned: OverturnedObservation[];
  unresolvedDecisions: UnresolvedDecision[];
}

function rowOf(correction: Correction): CorrectionRow {
  const { id: _id, ...row } = correction;
  return row;
}

export async function resolveOverturned(
  input: ResolveInput,
  io: ArchiveIo,
): Promise<ResolveOutput> {
  const overturned: OverturnedObservation[] = [];
  const unresolvedDecisions: UnresolvedDecision[] = [];

  // Read once per repository, not once per correction: listing the year dirs is
  // the same answer every time and the cost §3.4.2 promised is one stat per
  // OPEN correction, not one readdir.
  let yearDirs: string[] | undefined;

  for (const { row } of input.corrections) {
    if (!input.scanned.decisionIds.has(row.decisionId)) {
      unresolvedDecisions.push({
        correctionId: row.id,
        projectKey: input.projectKey,
        decisionId: row.decisionId,
      });
    }

    // spec §3.4.2's cost: only a correction the default scan did NOT close
    // reaches the archive at all.
    if (input.scanned.overturnedCorrectionIds.has(row.id)) continue;

    if (yearDirs === undefined) yearDirs = await io.listYearDirs(input.repoPath);
    const basename = `${deriveFixRunId(rowOf(row), row.id)}.jsonl`;

    const hits: string[] = [];
    for (const year of yearDirs) {
      const path = `${input.repoPath}/.decisions/archive/${year}/${basename}`;
      if (await io.statFile(path)) hits.push(path);
    }

    if (hits.length === 0) continue;
    if (hits.length > 1) {
      // The same correction closed into two files. Choosing between them would
      // silently pick a number for the fix rate.
      throw new MetricsRejection(
        ARCHIVE_NAME_AMBIGUOUS,
        `the fix run for correction ${row.id} appears in ${hits.length} places:\n` +
          `${hits.map((p) => `  ${p}`).join("\n")}\n` +
          `Only one of them can be the real one, and picking would be a guess.`,
      );
    }

    const text = await io.readFile(hits[0]);
    for (const line of text.split("\n")) {
      if (line.trim().length === 0) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        // A bad line inside an archived fix run is reported by the ordinary
        // lenient read when --all is used; here it simply is not the row we
        // came for.
        continue;
      }
      const ev = parsed as { ev?: unknown; correctionId?: unknown; at?: unknown };
      if (ev.ev === "overturned" && ev.correctionId === row.id && typeof ev.at === "string") {
        overturned.push({ correctionId: row.id, at: ev.at });
        break;
      }
    }
  }

  overturned.sort((a, b) => (a.correctionId < b.correctionId ? -1 : a.correctionId > b.correctionId ? 1 : 0));
  unresolvedDecisions.sort((a, b) =>
    a.correctionId < b.correctionId ? -1 : a.correctionId > b.correctionId ? 1 : 0,
  );
  return { overturned, unresolvedDecisions };
}
