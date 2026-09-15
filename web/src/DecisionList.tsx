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
        <li key={`${row.projectKey}::${row.id}`}>
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
