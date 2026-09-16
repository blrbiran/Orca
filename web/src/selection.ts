/**
 * Parked finding N-1 (E3 final review, ruling R71). `App` starts one
 * `GET /api/decision` per opened row and nothing made those answers arrive in
 * the order they were asked for, so a slow first answer could land after the
 * person had already opened a second row and paint the wrong decision under
 * the buttons that act on the new one. A correction is append-only.
 *
 * This predicate is the ONLY thing standing between a finished fetch and the
 * screen: App holds the row it currently wants in a ref and asks here before
 * applying anything. It is deliberately not a second, redundant gate in the
 * render path -- a guard that something else already covers cannot be pinned
 * by a mutation that deletes only itself.
 *
 * It compares `rowKey`s rather than the two strings separately, because
 * `projectKey` and `id` are both unrestricted: the pair ("a::b", "c") and the
 * pair ("a", "b::c") are different rows that a fixed-separator join would call
 * the same one (DecisionList.tsx's `rowKey` comment, review finding I-1 /
 * ruling R60). Getting that wrong here would mean applying one repository's
 * answer to another repository's row.
 */
import { rowKey } from "./DecisionList.js";
import type { DecisionListRow } from "./types.js";

type RowIdentity = Pick<DecisionListRow, "projectKey" | "id">;

/** Whether an answer that was asked for on behalf of `arrivedFor` may still be shown. */
export function acceptArrival(wanted: RowIdentity | null, arrivedFor: RowIdentity): boolean {
  if (wanted === null) return false;
  return rowKey(wanted) === rowKey(arrivedFor);
}
