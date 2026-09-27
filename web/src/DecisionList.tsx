/**
 * src/panel/listProjection.ts's comment explains why: `question` (and every
 * derivative of it) carries the reasoning, so a "one line summary" pulled
 * from it would let a person read the reasoning off the list while the
 * ledger records that they never opened it. This component renders ONLY the
 * fields `WEB_LIST_FIELDS` names -- it never spreads or reads any other key
 * off a row, so an extra field on the row object (a server bug, or a test
 * fixture probing for one) can never leak into the markup.
 *
 * *** ERRATUM (2026-09-27, session a50f4d80, human ruling U1) ***
 * The row now also shows `question` (panel UI redesign spec §2). What still holds: this
 * component reads each field by name and never spreads the row, so any OTHER key on the
 * object still cannot reach the markup. Text above kept verbatim.
 */
import type { JSX } from "react";
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

export const NO_QUESTION = "(no question recorded)";

export function DecisionList({
  rows,
  selected,
  onOpen,
}: {
  rows: readonly DecisionListRow[];
  selected?: Pick<DecisionListRow, "projectKey" | "id"> | null;
  onOpen?: (row: DecisionListRow) => void;
}): JSX.Element {
  const selectedKey = selected ? rowKey(selected) : null;
  return (
    <ul className="decision-list">
      {rows.map((row) => {
        const key = rowKey(row);
        return (
          <li key={key}>
            <button type="button" className="decision-row" aria-current={key === selectedKey ? "true" : undefined} onClick={() => onOpen?.(row)}>
              <span className="row-meta">
                <span className="pill field-kind">{String(row.kind)}</span>
                <span className="pill field-scope">{String(row.scope)}</span>
                {row.verdict !== "ok" && <span className="pill pill-warn field-verdict">{String(row.verdict)}</span>}
                <span className="row-project field-projectKey">{String(row.projectKey)}</span>
                <time className="row-at field-at" dateTime={String(row.at)}>{String(row.at).slice(0, 10)}</time>
              </span>
              <span className="row-question">{row.question ?? NO_QUESTION}</span>
              <span className="row-id field-id">{String(row.id)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
