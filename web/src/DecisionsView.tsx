/**
 * Panel UI redesign spec §5.1 (rulings U1, U2). Pure: App owns the fetches, the selection
 * and the detail; this lays out the heading, the filters, the list and the detail slot.
 * It takes over PanelHome's job (task 8 ruling K5): the Decisions pane is the default
 * section, so the first screen is still the work a person owes.
 */
import { ShortcutsHelp } from "./ShortcutsHelp.js";
import { sectionHead, sectionLede } from "./ui/classes.js";
import { useState } from "react";
import type { JSX, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { DecisionList } from "./DecisionList.js";
import { enumText } from "./i18n.js";
import { kindLabel, sortKinds } from "./kindRank.js";
import { en } from "./locales/en.js";
import { MinorToggle, visibleByImportance } from "./MinorToggle.js";
import { useProjectName } from "./projectNames.js";
import { ALL_PROJECTS } from "./projectScope.js";
import { Select } from "./ui/Select.js";
import type { ProjectV1 } from "./project.js";
import type { SourceStatus } from "./overviewModel.js";
import type { DecisionListRow, DecisionStatusRow } from "./types.js";

export interface DecisionFilter {
  kind: string;
  scope: string;
  projectKey: string;
}
export const NO_FILTER: DecisionFilter = { kind: "", scope: "", projectKey: "" };

/** In English (criteria read them); the render uses the reader's language (panel i18n spec §3.3). */
export const HIDDEN_BY_FILTER = en.decisions.hiddenByFilter;
export const HIDDEN_MINOR = en.decisions.hiddenMinor;
export const NOT_IN_LIST = en.decisions.notInList;

/** Spec §9.2(1). Unreviewed is the default and today's list; Reviewed is reviewed at any tier; All is every row. */
export type DecisionStatus = "unreviewed" | "reviewed" | "all";
export const DECISION_STATUSES: readonly DecisionStatus[] = ["unreviewed", "reviewed", "all"];

export function rowsForStatus<R extends DecisionStatusRow>(rows: readonly R[], status: DecisionStatus): R[] {
  return rows.filter((r) => status === "all" || (status === "reviewed" ? r.reviewed : r.highTier && !r.reviewed));
}

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
      <Select
        value={props.filter[props.name]}
        onValueChange={(value) => props.onFilter?.({ ...props.filter, [props.name]: value })}
        options={[{ value: "", label: t("decisions.any") }, ...values.map((v) => ({ value: v, label: props.optionText ? props.optionText(v) : v }))]}
      />
    </label>
  );
}

/** The global project scope (project filtering spec §3): the same choice the sidebar makes, shown here as the repository select. */
export interface DecisionsScope {
  projects: readonly ProjectV1[];
  /** A projectKey, or ALL_PROJECTS. */
  value: string;
  allowAll: boolean;
  onChange: (value: string) => void;
}

export function DecisionsView(props: {
  scope?: DecisionsScope;
  rows: readonly DecisionListRow[];
  filter: DecisionFilter;
  onFilter?: (f: DecisionFilter) => void;
  /** Absent: no status select (the rows are whatever the caller chose to pass). */
  status?: DecisionStatus;
  onStatus?: (s: DecisionStatus) => void;
  /** The rows of the chosen status have not arrived yet (Reviewed / All are read on demand). */
  loading?: boolean;
  /** Independent todo availability; absent for existing standalone/statistical lists. */
  sourceStatus?: SourceStatus;
  selected?: Pick<DecisionListRow, "projectKey" | "id"> | null;
  onOpen?: (row: DecisionListRow) => void;
  detail?: ReactNode;
  /** Taste refinement P1-3: reviews recorded in this browser since the panel opened; shown once there is one. */
  reviewedCount?: number;
  /**
   * Reported-decisions spec 2026-10-20 §6: whether minor decisions are listed. App owns it so j / k walks the rows on
   * screen; absent, the view keeps its own (major only until the person asks).
   */
  showMinor?: boolean;
  onShowMinor?: (next: boolean) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const name = useProjectName();
  const [ownShowMinor, setOwnShowMinor] = useState(false);
  const showMinor = props.showMinor ?? ownShowMinor;
  const onShowMinor = props.onShowMinor ?? setOwnShowMinor;
  const filtered = filterRows(props.rows, props.filter);
  const shown = visibleByImportance(filtered, showMinor);
  // Final review M-T8: the heading says which decisions are listed; Unreviewed (and no status select) keeps today's.
  const heading = props.status === "reviewed" ? { title: "decisions.titleReviewed", lede: "decisions.ledeReviewed" } as const
    : props.status === "all" ? { title: "decisions.titleAll", lede: "decisions.ledeAll" } as const
    : { title: "decisions.title", lede: "decisions.lede" } as const;
  // A detail stays open after its row leaves the list (filtered away, collapsed as minor, or reviewed); say which. A
  // collapsed minor row is matched by the filters, so its note says minor and offers the minor rows (handoff §4.2 item 7).
  const same = (r: DecisionListRow): boolean => r.projectKey === props.selected?.projectKey && r.id === props.selected?.id;
  const note = !props.selected || props.detail == null ? null
    : !props.rows.some(same) ? t("decisions.notInList")
    : !filtered.some(same) ? t("decisions.hiddenByFilter")
    : !shown.some(same) ? <>{t("decisions.hiddenMinor")} <button type="button" onClick={() => onShowMinor(true)}>{t("decisions.hiddenMinorShow")}</button></>
    : null;
  return (
    <div className="decisions">
      <div className={sectionHead}>
        <h1 className="text-xl">{t(heading.title)}</h1>
        <span className="count" data-testid="decision-count">{props.sourceStatus !== undefined && props.sourceStatus !== "available" ? "—" : t("decisions.count", { shown: shown.length, total: props.rows.length })}</span>
        {props.reviewedCount !== undefined && props.reviewedCount > 0 && (
          <span className="count" data-testid="reviewed-count">{t("decisions.reviewedThisSession", { n: props.reviewedCount })}</span>
        )}
        <ShortcutsHelp />
      </div>
      <p className={`section-lede ${sectionLede}`}>
        {t(heading.lede)}
      </p>
      <p className="kbd-hint">{t("decisions.keyHint")}</p>
      <div className="filters flex flex-wrap gap-3 mb-3 [&_label]:m-0 [&_label]:flex-row [&_label]:items-center">
        {props.status !== undefined && (
          <label>
            {t("decisions.filterStatus")}
            <Select value={props.status} onValueChange={(value) => props.onStatus?.(value)}
              options={DECISION_STATUSES.map((s) => ({ value: s, label: t(`decisions.status.${s}`) }))} />
          </label>
        )}
        <FilterSelect label={t("decisions.filterKind")} name="kind" values={distinct(props.rows, (r) => String(r.kind))} filter={props.filter} onFilter={props.onFilter} order={sortKinds} optionText={kindLabel} />
        <FilterSelect label={t("decisions.filterScope")} name="scope" values={distinct(props.rows, (r) => String(r.scope))} filter={props.filter} onFilter={props.onFilter} optionText={(value) => enumText("decisionScope", value)} />
        {props.scope === undefined ? (
          <FilterSelect label={t("decisions.filterRepository")} name="projectKey" values={distinct(props.rows, (r) => r.projectKey)} filter={props.filter} onFilter={props.onFilter} optionText={name} />
        ) : (
          <label>
            {t("decisions.filterRepository")}
            <Select value={props.scope.value} onValueChange={(value) => props.scope?.onChange(value)} placeholder={t("settings.projectPick.choose")}
              options={[
                ...(props.scope.allowAll ? [{ value: ALL_PROJECTS, label: t("project.all") }] : []),
                ...props.scope.projects.map((entry) => ({ value: entry.projectKey, label: name(entry.projectKey) })),
              ]} />
          </label>
        )}
      </div>
      <div className="split">
        <div className="split-list">
          {props.sourceStatus === "unavailable" ? (
            <p className="empty">{t("overview.status.unavailable")}</p>
          ) : props.loading === true ? (
            <p className="empty">{t("decisions.loading")}</p>
          ) : props.rows.length === 0 ? (
            <p className="empty">{t(props.status === undefined || props.status === "unreviewed" ? "decisions.nothingToReview" : "decisions.nothingInStatus")}</p>
          ) : filtered.length === 0 ? (
            <p className="empty">{t("decisions.noMatch")}</p>
          ) : (
            <>
              {shown.length === 0 ? <p className="empty">{t("decisions.onlyMinor")}</p> : <DecisionList rows={shown} selected={props.selected} onOpen={props.onOpen} />}
              <MinorToggle entries={filtered} showMinor={showMinor} onToggle={onShowMinor} copy="decisions" />
            </>
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
