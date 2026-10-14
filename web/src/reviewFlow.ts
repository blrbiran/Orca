import { rowKey } from "./DecisionList.js";
import type { DecisionListRow } from "./types.js";

/**
 * Taste refinement P1-3: where the review queue goes after a review lands. `before` is the list as the person saw it
 * when they acted, `now` the refreshed one. Null means stay: the reviewed row is still listed (refresh failed, or it
 * did not leave), or nothing is left.
 */
export function nextAfterReview(
  before: readonly DecisionListRow[],
  reviewed: Pick<DecisionListRow, "projectKey" | "id">,
  now: readonly DecisionListRow[],
): DecisionListRow | null {
  const key = rowKey(reviewed);
  const present = new Map(now.map((row) => [rowKey(row), row] as const));
  if (present.has(key)) return null;
  const at = before.findIndex((row) => rowKey(row) === key);
  if (at === -1) return null;
  for (let i = at + 1; i < before.length; i++) { const hit = present.get(rowKey(before[i]!)); if (hit) return hit; }
  for (let i = at - 1; i >= 0; i--) { const hit = present.get(rowKey(before[i]!)); if (hit) return hit; }
  return null;
}
