/**
 * Panel UI redesign spec §5.1 (rulings U1, U2). Pure: App owns the fetches, the selection
 * and the detail; this lays out the heading, the filters, the list and the detail slot.
 * It takes over PanelHome's job (task 8 ruling K5): the Decisions pane is the default
 * section, so the first screen is still the work a person owes.
 */
import type { JSX, ReactNode } from "react";
import { DecisionList } from "./DecisionList.js";
import type { DecisionListRow } from "./types.js";

export interface DecisionFilter {
  kind: string;
  scope: string;
  projectKey: string;
}
export const NO_FILTER: DecisionFilter = { kind: "", scope: "", projectKey: "" };

export function filterRows(rows: readonly DecisionListRow[], filter: DecisionFilter): DecisionListRow[] {
  return rows.filter(
    (r) =>
      (filter.kind === "" || r.kind === filter.kind) &&
      (filter.scope === "" || r.scope === filter.scope) &&
      (filter.projectKey === "" || r.projectKey === filter.projectKey),
  );
}

const distinct = (rows: readonly DecisionListRow[], pick: (r: DecisionListRow) => string): string[] =>
  [...new Set(rows.map(pick))].sort();

function FilterSelect(props: {
  label: string;
  name: keyof DecisionFilter;
  values: string[];
  filter: DecisionFilter;
  onFilter?: (f: DecisionFilter) => void;
}): JSX.Element {
  // A value whose last row was just reviewed away stays listed, so the select still shows
  // what is filtering the (now empty) list instead of claiming "any" (final review Important 1).
  const current = props.filter[props.name];
  const values = current === "" || props.values.includes(current) ? props.values : [...props.values, current].sort();
  return (
    <label>
      {props.label}
      <select
        name={`filter-${props.name}`}
        value={props.filter[props.name]}
        onChange={(e) => props.onFilter?.({ ...props.filter, [props.name]: e.currentTarget.value })}
      >
        <option value="">any</option>
        {values.map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
    </label>
  );
}

export function DecisionsView(props: {
  rows: readonly DecisionListRow[];
  filter: DecisionFilter;
  onFilter?: (f: DecisionFilter) => void;
  selected?: Pick<DecisionListRow, "projectKey" | "id"> | null;
  onOpen?: (row: DecisionListRow) => void;
  detail?: ReactNode;
}): JSX.Element {
  const shown = filterRows(props.rows, props.filter);
  return (
    <div className="decisions">
      <div className="section-head">
        <h1>Unreviewed high-tier decisions</h1>
        <span className="count" data-testid="decision-count">{shown.length} of {props.rows.length}</span>
      </div>
      <p className="section-lede">
        High-tier decisions an agent recorded that nobody has reviewed yet. Open one, read it, then Agree or Correct.
      </p>
      <div className="filters">
        <FilterSelect label="Kind" name="kind" values={distinct(props.rows, (r) => String(r.kind))} filter={props.filter} onFilter={props.onFilter} />
        <FilterSelect label="Scope" name="scope" values={distinct(props.rows, (r) => String(r.scope))} filter={props.filter} onFilter={props.onFilter} />
        <FilterSelect label="Repository" name="projectKey" values={distinct(props.rows, (r) => r.projectKey)} filter={props.filter} onFilter={props.onFilter} />
      </div>
      <div className="split">
        <div className="split-list">
          {props.rows.length === 0 ? (
            <p className="empty">Nothing to review. Every high-tier decision has been reviewed.</p>
          ) : shown.length === 0 ? (
            <p className="empty">No decision matches these filters.</p>
          ) : (
            <DecisionList rows={shown} selected={props.selected} onOpen={props.onOpen} />
          )}
        </div>
        <div className="split-detail">{props.detail ?? <p className="empty">Select a decision to read it.</p>}</div>
      </div>
    </div>
  );
}
