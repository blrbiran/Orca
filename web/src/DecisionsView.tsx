/**
 * Panel UI redesign spec §5.1 (rulings U1, U2). Pure: App owns the fetches, the selection
 * and the detail; this lays out the heading, the filters, the list and the detail slot.
 * It takes over PanelHome's job (task 8 ruling K5): the Decisions pane is the default
 * section, so the first screen is still the work a person owes.
 */
import type { JSX, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { DecisionList } from "./DecisionList.js";
import { enumText } from "./i18n.js";
import { kindLabel, sortKinds } from "./kindRank.js";
import { en } from "./locales/en.js";
import type { DecisionListRow } from "./types.js";

export interface DecisionFilter {
  kind: string;
  scope: string;
  projectKey: string;
}
export const NO_FILTER: DecisionFilter = { kind: "", scope: "", projectKey: "" };

/** In English (criteria read them); the render uses the reader's language (panel i18n spec §3.3). */
export const HIDDEN_BY_FILTER = en.decisions.hiddenByFilter;
export const NOT_IN_LIST = en.decisions.notInList;

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
  order?: (values: readonly string[]) => string[];
  optionText?: (value: string) => string;
}): JSX.Element {
  const { t } = useTranslation();
  // A value whose last row was just reviewed away stays listed, so the select still shows
  // what is filtering the (now empty) list instead of claiming "any" (final review Important 1).
  const current = props.filter[props.name];
  const order = props.order ?? ((v: readonly string[]) => [...v].sort());
  const values = order(current === "" || props.values.includes(current) ? props.values : [...props.values, current]);
  return (
    <label>
      {props.label}
      <select
        name={`filter-${props.name}`}
        value={props.filter[props.name]}
        onChange={(e) => props.onFilter?.({ ...props.filter, [props.name]: e.currentTarget.value })}
      >
        <option value="">{t("decisions.any")}</option>
        {values.map((v) => <option key={v} value={v}>{props.optionText ? props.optionText(v) : v}</option>)}
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
  const { t } = useTranslation();
  const shown = filterRows(props.rows, props.filter);
  // A detail stays open after its row leaves the list (filtered away, or reviewed); say which.
  const same = (r: DecisionListRow): boolean => r.projectKey === props.selected?.projectKey && r.id === props.selected?.id;
  const note = !props.selected || props.detail == null ? null
    : !props.rows.some(same) ? t("decisions.notInList")
    : !shown.some(same) ? t("decisions.hiddenByFilter")
    : null;
  return (
    <div className="decisions">
      <div className="section-head">
        <h1>{t("decisions.title")}</h1>
        <span className="count" data-testid="decision-count">{t("decisions.count", { shown: shown.length, total: props.rows.length })}</span>
      </div>
      <p className="section-lede">
        {t("decisions.lede")}
      </p>
      <div className="filters">
        <FilterSelect label={t("decisions.filterKind")} name="kind" values={distinct(props.rows, (r) => String(r.kind))} filter={props.filter} onFilter={props.onFilter} order={sortKinds} optionText={kindLabel} />
        <FilterSelect label={t("decisions.filterScope")} name="scope" values={distinct(props.rows, (r) => String(r.scope))} filter={props.filter} onFilter={props.onFilter} optionText={(value) => enumText("decisionScope", value)} />
        <FilterSelect label={t("decisions.filterRepository")} name="projectKey" values={distinct(props.rows, (r) => r.projectKey)} filter={props.filter} onFilter={props.onFilter} />
      </div>
      <div className="split">
        <div className="split-list">
          {props.rows.length === 0 ? (
            <p className="empty">{t("decisions.nothingToReview")}</p>
          ) : shown.length === 0 ? (
            <p className="empty">{t("decisions.noMatch")}</p>
          ) : (
            <DecisionList rows={shown} selected={props.selected} onOpen={props.onOpen} />
          )}
        </div>
        <div className="split-detail">
          {note !== null && <p className="detail-note" role="note">{note}</p>}
          {props.detail ?? <p className="empty">{t("decisions.selectOne")}</p>}
        </div>
      </div>
    </div>
  );
}
