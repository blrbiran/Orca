import type { ClaimedPath } from "./writeSet.js";

export type ConflictKind = "equal" | "new-contains-old" | "new-inside-old";

export interface PathConflict {
  kind: ConflictKind;
  a: ClaimedPath;
  b: ClaimedPath;
}

/**
 * Path containment, not string prefix. The two differ on exactly one case —
 * "src/a" against "src/ab.ts" — and that case is the reason this is a trie
 * over path segments rather than a startsWith call: a string-prefix
 * implementation answers "intersecting" there, over-serialising, and answers
 * correctly everywhere else, so nothing else in this file would catch it.
 *
 * The empty prefix (from a bare **) is the repository root and contains
 * everything, which falls out of the segment comparison for free.
 */
function segments(normalized: string): string[] {
  return normalized.split("/").filter((s) => s.length > 0);
}

/**
 * Exported for §7's reconciliation (harvest.ts), which asks a question
 * classify() cannot answer: classify is symmetric-by-cases and reports a
 * relation in either direction, while "is this actual path inside something
 * the task declared" is DIRECTIONAL -- a declared "src/a/b.ts" and an actual
 * "src/a" are related but not in-bounds. Re-deriving segment containment there
 * would put two independent readers of spec §3.2's rule in the tree, which is
 * the drift planFile.ts's detectCycle comment already records this repository
 * treating as a defect once a shared home exists.
 */
export function contains(outer: string, inner: string): boolean {
  const o = segments(outer);
  const i = segments(inner);
  if (o.length > i.length) return false;
  return o.every((seg, idx) => seg === i[idx]);
}

/**
 * Cases 2 and 3 of spec 3.2 are one computation (a prefix relation) and two
 * diagnoses (what the reader has to do about it differs). They share the
 * judgement deliberately: giving each its own predicate is how "delete one
 * branch and everything stays green" happens.
 */
export function classify(a: ClaimedPath, b: ClaimedPath): ConflictKind | null {
  if (a.normalized === b.normalized) return "equal";
  if (contains(b.normalized, a.normalized)) return "new-contains-old";
  if (contains(a.normalized, b.normalized)) return "new-inside-old";
  return null;
}

export function intersect(a: ClaimedPath[], b: ClaimedPath[]): PathConflict[] {
  const out: PathConflict[] = [];
  for (const x of a) {
    for (const y of b) {
      const kind = classify(x, y);
      // Every conflicting pair, never just the first: a caller who fixes one
      // and re-runs to find the next is a caller the tool is wasting.
      if (kind !== null) out.push({ kind, a: x, b: y });
    }
  }
  return out;
}
