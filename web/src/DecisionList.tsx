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
import { useTranslation } from "react-i18next";
import { enumText } from "./i18n.js";
import { kindLevel } from "./kindRank.js";
import { en } from "./locales/en.js";
import { MinorTag } from "./MinorToggle.js";
import { useProjectName } from "./projectNames.js";
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

/** In English (criteria read it); the render uses the reader's language. */
export const NO_QUESTION = en.decisions.noQuestion;

/** spec §5.1: the viewer's local date, YYYY-MM-DD; an unparseable `at` shows its own first ten characters. */
export function localDay(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at.slice(0, 10);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * A decision row is one button that is the whole row: flat, full width, a column of its lines. The open one (aria-current)
 * is tinted with an accent bar on its start edge; hover tints it too, the open one included.
 */
const decisionRow = "decision-row flex w-full flex-col items-stretch gap-1.5 rounded-none border-0 bg-transparent px-3.5 py-3 text-left font-normal text-fg shadow-none"
  + " hover:bg-hover active:transform-none aria-[current=true]:bg-accent-subtle aria-[current=true]:shadow-bar-start hover:aria-[current=true]:bg-hover";
/** The kind pill's dot, coloured by the kind's importance level (data-level, from kindRank); no level, no dot. */
export const kindDot = "data-[level]:before:mr-1.5 data-[level]:before:size-1.75 data-[level]:before:rounded-full data-[level]:before:content-['']"
  + " data-[level=1]:before:bg-kind-1 data-[level=2]:before:bg-kind-2 data-[level=3]:before:bg-kind-3";

export function DecisionList({
  rows,
  selected,
  onOpen,
}: {
  rows: readonly DecisionListRow[];
  selected?: Pick<DecisionListRow, "projectKey" | "id"> | null;
  onOpen?: (row: DecisionListRow) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const name = useProjectName();
  const selectedKey = selected ? rowKey(selected) : null;
  return (
    <ul className="decision-list m-0 list-none p-0 [&>li+li]:border-t [&>li+li]:border-line">
      {rows.map((row) => {
        const key = rowKey(row);
        return (
          <li key={key}>
            <button type="button" className={decisionRow} aria-current={key === selectedKey ? "true" : undefined} onClick={() => onOpen?.(row)}>
              <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                <MinorTag entry={row} copy="decisions" />
                <span className={`pill field-kind ${kindDot}`} data-level={kindLevel(String(row.kind))}>{enumText("decisionKind", String(row.kind))}</span>
                <span className="pill field-scope">{enumText("decisionScope", String(row.scope))}</span>
                {row.verdict !== "ok" && <span className="badge field-verdict whitespace-nowrap text-warn" data-tone="warn">{enumText("decisionVerdict", String(row.verdict))}</span>}
                <span className="field-projectKey font-semibold">{name(String(row.projectKey))}</span>
                <time className="field-at font-data" dateTime={String(row.at)}>{localDay(String(row.at))}</time>
              </span>
              <span className="row-question wrap-anywhere line-clamp-2 text-sm text-fg-strong">{row.question ?? t("decisions.noQuestion")}</span>
              <span className="row-id field-id font-data text-xs text-muted">{String(row.id)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
