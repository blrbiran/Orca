/**
 * src/panel/listProjection.ts's comment explains why: `question` (and every
 * derivative of it) carries the reasoning, so a "one line summary" pulled
 * from it would let a person read the reasoning off the list while the
 * ledger records that they never opened it. This component renders ONLY the
 * fields `WEB_LIST_FIELDS` names -- it never spreads or reads any other key
 * off a row, so an extra field on the row object (a server bug, or a test
 * fixture probing for one) can never leak into the markup.
 */
import type { JSX } from "react";
import { WEB_LIST_FIELDS } from "./types.js";
import type { DecisionListRow } from "./types.js";

/**
 * review finding I-1 / controller ruling R60. `projectKey` and `id` are both
 * unrestricted strings, so a fixed-separator join (the earlier double-colon
 * join here) collides: {projectKey: "a::b", id: "c"} and {projectKey: "a",
 * id: "b::c"} would join to the same string. src/panel/coverage.ts's own
 * `keyOf` avoids exactly this class of collision on the server; this file
 * does not repeat that choice (see below).
 *
 * `JSON.stringify([a, b])` is injective for any two strings: JSON escapes
 * every double-quote and backslash inside each element and wraps each one in
 * its own pair of unescaped double-quotes, so the separating comma between
 * the two array slots can never be produced by the CONTENTS of either
 * string -- there is no pair of distinct (a, b) that encodes to the same
 * array literal. This needs no control character to make it work, which
 * matters here specifically: a raw control byte has already slipped into
 * this plan more than once by way of an escape sequence typed as source text
 * (this very file, in an earlier round) -- a printable-only encoding removes
 * that whole failure class from this key.
 */
export function rowKey(row: Pick<DecisionListRow, "projectKey" | "id">): string {
  return JSON.stringify([row.projectKey, row.id]);
}

export function DecisionList({
  rows,
  onOpen,
}: {
  rows: readonly DecisionListRow[];
  onOpen?: (row: DecisionListRow) => void;
}): JSX.Element {
  return (
    <ul className="decision-list">
      {rows.map((row) => (
        <li key={rowKey(row)}>
          <button type="button" onClick={() => onOpen?.(row)}>
            {WEB_LIST_FIELDS.map((field) => (
              <span key={field} className={`field-${field}`}>
                {String(row[field])}
              </span>
            ))}
          </button>
        </li>
      ))}
    </ul>
  );
}
