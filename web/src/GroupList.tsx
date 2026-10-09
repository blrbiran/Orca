/**
 * Issue-fixes spec §6.4: the Task control group list. Each group is one card and the whole card is the button; its
 * accessible name is the row text the list always had (id, state, done/total, stop, blockers and, in All projects, the
 * repository), and the rest of the card describes it. The chips filter by groupCategory; the choice is kept per viewer.
 */
import { useId, useState } from "react";
import type { JSX } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useClock } from "./clock.js";
import type { GroupSummaryV1 } from "./controlTypes.js";
import {
  GROUP_FILTERS, groupCategory, groupFilterStorage, matchesGroupFilter, needsAttention, readGroupFilter, writeGroupFilter, type GroupFilter,
} from "./groupCategory.js";
import { enumText } from "./i18n.js";
import { inScope, type GroupScope } from "./projectScope.js";
import { hashFor } from "./sections.js";

export interface GroupListProps {
  groups: GroupSummaryV1[];
  selected: string | null;
  scope?: GroupScope;
  repoLabel?: (repoId: string) => string;
  onSelect: (groupId: string) => void;
  /** Tests pin the clock; the page reads it every 30 s. */
  now?: number;
}

/** Final review (E8 deferred minor): minutes up to 119, then whole hours up to 47, then whole days. */
function updatedText(t: TFunction, minutes: number): string {
  if (minutes === 0) return t("control.groupCard.updatedNow");
  if (minutes < 120) return t("control.groupCard.updated", { minutes });
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? t("control.groupCard.updatedHours", { hours }) : t("control.groupCard.updatedDays", { days: Math.floor(hours / 24) });
}

function GroupCard(props: { group: GroupSummaryV1; selected: boolean; repoText: string; now: number; onSelect: () => void }): JSX.Element {
  const { t } = useTranslation();
  const { group } = props;
  const base = useId();
  const category = groupCategory(group);
  const updated = group.updatedAt === undefined || group.updatedAt === null ? null : Math.max(0, Math.floor((props.now - group.updatedAt) / 60_000));
  return (
    <button
      type="button"
      className="group-card"
      data-category={category}
      aria-current={props.selected}
      aria-labelledby={(props.repoText === "" ? [`${base}-name`] : [`${base}-name`, `${base}-repo`]).join(" ")}
      aria-describedby={`${base}-detail`}
      onClick={props.onSelect}
    >
      <span id={`${base}-name`} className="group-card-name">
        {group.groupId} · {enumText("groupState", group.state)}
        {group.completion !== undefined ? t("control.groupDone", { done: group.completion.done, total: group.completion.total }) : ""}
        {group.stopState !== null ? ` · ${enumText("stopState", group.stopState)}` : ""}
        {group.recoveryBlockerCount > 0 ? t("control.groupBlockers", { n: group.recoveryBlockerCount }) : ""}
      </span>
      <span id={`${base}-detail`} className="group-card-detail">
        {group.goal !== undefined && <span className="group-card-goal">{group.goal}</span>}
        {group.completion !== undefined && group.completion.total > 0 && (
          <progress value={group.completion.done} max={group.completion.total}
            aria-label={t("control.groupCard.progress", { done: group.completion.done, total: group.completion.total })} />
        )}
        <span className="group-chip" data-category={category}>{t(`control.groupCategory.${category}` as const)}</span>
        {needsAttention(group) && <span className="group-badge">{t("control.groupCard.attention")}</span>}
        {group.branch !== undefined && <code>{group.branch}</code>}
        {updated !== null && <span>{updatedText(t, updated)}</span>}
      </span>
      {props.repoText !== "" && <span id={`${base}-repo`}>{props.repoText}</span>}
    </button>
  );
}

export function GroupList(props: GroupListProps): JSX.Element {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<GroupFilter>(() => readGroupFilter(groupFilterStorage()));
  const ticking = useClock(30_000);
  const now = props.now ?? ticking;
  const scope = props.scope;
  const listed = scope === undefined ? props.groups : props.groups.filter((group) => inScope(scope, group.repoId));
  const shown = listed.filter((group) => matchesGroupFilter(group, filter));
  // In All projects a row names its repository, after today's text (project filtering spec §5).
  const label = (repoId: string): string => (scope?.kind === "all" ? ` · ${props.repoLabel?.(repoId) ?? repoId}` : "");
  const choose = (next: GroupFilter): void => { setFilter(next); writeGroupFilter(groupFilterStorage(), next); };
  return (
    <>
      <div role="group" aria-label={t("control.groupFilter.region")} className="group-filter">
        {GROUP_FILTERS.map((option) => (
          <button key={option} type="button" aria-pressed={filter === option} onClick={() => choose(option)}>
            {option === "all" ? t("control.groupFilter.all") : t(`control.groupCategory.${option}` as const)}
          </button>
        ))}
      </div>
      <nav aria-label={t("control.groupsNav")} className="group-list">
        {scope?.kind === "unresolved" ? (
          // Plan decision P1: with no project list a row could belong to any project, so none is shown.
          <p role="note">{t("project.listUnavailable")}</p>
        ) : listed.length === 0 ? <p>{t("control.noGroups")}</p> : shown.length === 0 && <p>{t("control.groupFilter.empty")}</p>}
        {shown.map((group) => group.state === "clarifying" ? (
          // N1 spec §11.2: a clarifying group has no group view (DR25); it is operated in Requirements until accept.
          <a key={group.groupId} className="group-card" href={hashFor("requirements")}>{group.groupId} · {enumText("groupState", group.state)} · {t("control.requirementBadge")}{label(group.repoId)}</a>
        ) : (
          <GroupCard key={group.groupId} group={group} selected={group.groupId === props.selected} repoText={label(group.repoId)} now={now} onSelect={() => props.onSelect(group.groupId)} />
        ))}
      </nav>
    </>
  );
}
