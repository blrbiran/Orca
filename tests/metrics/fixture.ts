import { deriveCorrectionId } from "../../src/corrections/fields.js";
import type { Correction } from "../../src/corrections/schema.js";
import type { Observations } from "../../src/metrics/collect.js";
import type { DecisionKind, DecisionScope } from "../../src/ledger/types.js";

export function d(
  id: string,
  at: string,
  kind: DecisionKind,
  scope: DecisionScope,
  verdict: "ok" | "downgraded",
): Observations["decisions"][number] {
  return { projectKey: "github.com/biran/a", id, at, kind, scope, verdict };
}

export function c(decisionId: string, kind: Correction["kind"], at: string): { row: Correction } {
  const base = { projectKey: "github.com/biran/a", decisionId, kind, because: "理由", at, by: "amy" };
  return { row: { id: deriveCorrectionId(base), ...base } };
}

/**
 * 🔴 GHOST is the correction whose decision was never scanned. It has to exist
 * as a ROW, not only as an entry in unresolvedDecisions: the mutation that
 * moves such a correction INTO a kind bucket needs something to move, and with
 * no row the in-bucket count would be a constant no mutation could change.
 */
export const GHOST = c("orca-dev-archived/7", "wrong", "2026-04-02T00:00:00.000Z");

/**
 * ⚠️ Every collection here holds at least TWO entries and is given out of
 * order. `unkeyableRepos` and `malformed` are the only two fed straight from
 * directory-walk order, so leaving them empty would make the "shuffle the
 * inputs and diff" criterion an identity operation on exactly the collections
 * it exists to guard.
 */
export const OBS: Observations = {
  asOf: "2026-09-09T00:00:00.000Z",
  asOfMode: "explicit",
  repos: [
    { projectKey: "github.com/biran/z-empty", path: "/z" },
    { projectKey: "github.com/biran/a", path: "/a" },
    { projectKey: "github.com/biran/m-fork", path: "/m" },
  ],
  decisions: [
    d("orca-dev-1/1", "2026-01-05T00:00:00.000Z", "interface", "repo", "ok"),
    d("orca-dev-1/2", "2026-01-06T00:00:00.000Z", "reconcile", "repo", "downgraded"),
    d("orca-dev-1/3", "2026-02-01T00:00:00.000Z", "dependency", "file", "ok"),
    /**
     * 🔴 A decision in ANOTHER repository carrying the id GHOST's correction
     * points at. Decision ids repeat across clones and forks (that is why a
     * correction carries projectKey at all), so a lookup keyed by id alone
     * would bucket GHOST by this row's kind. Without this entry the criterion
     * below cannot go red — measured.
     */
    { ...d("orca-dev-archived/7", "2026-01-07T00:00:00.000Z", "boundary", "repo", "ok"),
      projectKey: "github.com/biran/m-fork" },
  ],
  corrections: [
    c("orca-dev-1/1", "wrong", "2026-03-01T00:00:00.000Z"),
    c("orca-dev-1/2", "stale", "2026-03-02T00:00:00.000Z"),
    c("orca-dev-1/3", "not_my_taste", "2026-04-01T00:00:00.000Z"),
    GHOST,
  ],
  overturned: [],
  excludedAsFuture: 0,
  unresolvedDecisions: [
    { correctionId: GHOST.row.id, projectKey: "github.com/biran/a", decisionId: "orca-dev-archived/7" },
  ],
  unkeyableRepos: [
    { path: "/tmp/z-copy", reason: "not a URL" },
    { path: "/tmp/a-copy", reason: "not a URL" },
  ],
  malformed: [
    { file: "/repo/.decisions/z.jsonl", line: 3, bytes: 10, reason: "not valid JSON", torn: false },
    { file: "/repo/.decisions/a.jsonl", line: 1, bytes: 20, reason: "not valid JSON", torn: false },
  ],
};
