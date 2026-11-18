/**
 * Issue-fixes spec §6.4: the Task control group list. Each group is one card and the whole card is the button; its
 * accessible name is the row text the list always had (id, state, done/total, stop, blockers and, in All projects, the
 * repository), and the rest of the card describes it. The chips filter by groupCategory; the choice is kept per viewer.
 * Tester #357 (human ruling 2026-11-19 on #92: list multi-select with bulk archive/close, no bulk retry, nothing on the
 * Board): every chip says how many groups it holds; where the page can send card actions, each card has a selection box
 * beside its button, and a toolbar sends one command per selected group -- no server batch -- listing each one's outcome.
 */
import { useId, useState } from "react";
import type { GroupCardVerb } from "./controlApi.js";
import { RefusalNotice } from "./RefusalNotice.js";
import type { JSX } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { CardGoal } from "./CardGoal.js";
import { useClock } from "./clock.js";
import type { GroupSummaryV1 } from "./controlTypes.js";
import {
  GROUP_FILTERS, groupCategory, groupFilterStorage, groupLed, matchesGroupFilter, needsAttention, readGroupFilter, writeGroupFilter, type GroupFilter,
} from "./groupCategory.js";
import { groupStateText } from "./i18n.js";
import { inScope, type GroupScope } from "./projectScope.js";
import { hashFor } from "./sections.js";
import { GroupActionsMenu } from "./GroupActionsMenu.js";
import { groupBadge, groupBulk, groupCard, groupCardDetail, groupCardGoal, groupCardLead, groupCardName, groupChip, groupFilter, groupList, groupSelect } from "./ui/classes.js";
import type { ControlRefusal } from "./controlState.js";

export interface GroupListProps {
  groups: GroupSummaryV1[];
  selected: string | null;
  scope?: GroupScope;
  repoLabel?: (repoId: string) => string;
  onSelect: (groupId: string) => void;
  onSelectRequirement?: (groupId: string) => void;
  onAction?: (groupId: string, verb: GroupCardVerb, repoId: string) => void;
  /**
   * Tester #357: one group's bulk command, answered with how it went (`skipped`: the group was already so, or changed under
   * the click). A refusal's code and next are the group's refusal, read from `refusals`. Without it the list has no selection.
   */
  onBulkAction?: (groupId: string, verb: BulkVerb, repoId: string) => Promise<BulkOutcome>;
  refusals?: Record<string, ControlRefusal>;
  onOpenDispatch?: (groupId: string) => void;
  /** Tests pin the clock; the page reads it every 30 s. */
  now?: number;
}

export type BulkVerb = "archive-group" | "close-group";
export type BulkOutcome = "succeeded" | "refused" | "skipped";
/** Tester #357: close is offered for a selection only when the server could take it for every group: each one is done. */
export function bulkCloseOpen(groups: readonly GroupSummaryV1[]): boolean {
  return groups.length > 0 && groups.every((group) => group.state === "done" && group.archiveKind !== "closed");
}

/** Tester #357: a card's selection box, a sibling of the card's button or link (one cannot hold the other). */
function SelectBox(props: { groupId: string; checked: boolean; onChange: (checked: boolean) => void }): JSX.Element {
  const { t } = useTranslation();
  return <label className={groupSelect}>
    <input type="checkbox" checked={props.checked} onChange={(event) => props.onChange(event.currentTarget.checked)} aria-label={t("control.groupBulk.select", { groupId: props.groupId })} />
  </label>;
}

/**
 * Tester #288: a group with a stop intent leads its state line with the stop, so "review" after a stop no longer reads
 * as a group still at work. Pausing/Stopping: the intent is recorded and the stop has no state yet (or is settling).
 * "Needs you" stays a category chip; it is not a state.
 */
export type StopLabel = "pausing" | "paused" | "stopping" | "stopped" | "partial" | "unresolved";
export function stopLabel(group: Pick<GroupSummaryV1, "stopMode" | "stopState">): StopLabel | null {
  switch (group.stopState) {
    case "paused": return "paused";
    case "handoff-pending": return "stopping";
    case "handoff-complete": return "stopped";
    case "handoff-partial": return "partial";
    case "handoff-unresolved": return "unresolved";
    case null: return group.stopMode === null ? null : group.stopMode === "pause" ? "pausing" : "stopping";
  }
}

/** Final review (E8 deferred minor): minutes up to 119, then whole hours up to 47, then whole days. */
function updatedText(t: TFunction, minutes: number): string {
  if (minutes === 0) return t("control.groupCard.updatedNow");
  if (minutes < 120) return t("control.groupCard.updated", { minutes });
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? t("control.groupCard.updatedHours", { hours }) : t("control.groupCard.updatedDays", { days: Math.floor(hours / 24) });
}

function GroupCard(props: { group: GroupSummaryV1; selected: boolean; repoText: string; now: number; onSelect: () => void; onAction?: GroupListProps["onAction"]; refusal?: ControlRefusal; onOpenDispatch?: () => void; selectBox?: JSX.Element }): JSX.Element {
  const { t } = useTranslation();
  const { group } = props;
  const base = useId();
  const category = groupCategory(group);
  const stop = stopLabel(group);
  const updated = group.updatedAt === undefined || group.updatedAt === null ? null : Math.max(0, Math.floor((props.now - group.updatedAt) / 60_000));
  return <GroupActionsMenu group={group} onOpen={props.onSelect} onAction={props.onAction} refusal={props.selected ? null : props.refusal} onOpenDispatch={props.onOpenDispatch}>{(onContextMenu) => (<>
    <button
      type="button"
      className={`group-card ${groupCard}`}
      data-category={category}
      aria-current={props.selected}
      aria-labelledby={(props.repoText === "" ? [`${base}-name`] : [`${base}-name`, `${base}-repo`]).join(" ")}
      aria-describedby={`${base}-goal ${base}-detail`}
      onClick={props.onSelect}
      onContextMenu={onContextMenu}
    >
      {/* Tester #17: what the group is for leads the card; its id and state follow as the smaller line. */}
      <span id={`${base}-goal`} className={`group-card-lead ${groupCardLead}`}><CardGoal group={group} className={`group-card-goal ${groupCardGoal}`} /></span>
      <span id={`${base}-name`} className={`group-card-name ${groupCardName}`}>
        {/* Ruling H8: the status light; decorative, the state is in this text. */}
        <span className="led" data-led={groupLed(group)} aria-hidden="true" />
        {/* Tester #370: an archived group's stored state is not what it is now. */}
        {group.groupId} · {stop !== null && <><strong data-testid="group-card-stop">{t(`control.groupCard.stop.${stop}` as const)}</strong> · </>}{groupStateText(group)}
        {group.completion !== undefined ? t("control.groupDone", { done: group.completion.done, total: group.completion.total }) : ""}
        {group.recoveryBlockerCount > 0 ? t("control.groupBlockers", { n: group.recoveryBlockerCount }) : ""}
      </span>
      <span id={`${base}-detail`} className={`group-card-detail ${groupCardDetail}`}>
        {group.completion !== undefined && group.completion.total > 0 && (
          <progress value={group.completion.done} max={group.completion.total}
            aria-label={t("control.groupCard.progress", { done: group.completion.done, total: group.completion.total })} />
        )}
        <span className={`group-chip ${groupChip}`} data-category={category}>{t(`control.groupCategory.${category}` as const)}</span>
        {/* Issue #218: the chip already says "Needs attention"; the badge adds it only where the chip says something else (archived). */}
        {needsAttention(group) && category !== "attention" && <span className={`group-badge ${groupBadge}`}>{t("control.groupCard.attention")}</span>}
        {group.branch !== undefined && <code>{group.branch}</code>}
        {updated !== null && <span>{updatedText(t, updated)}</span>}
      </span>
      {props.repoText !== "" && <span id={`${base}-repo`}>{props.repoText}</span>}
    </button>
    {props.selectBox}
  </>)}</GroupActionsMenu>;
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
  // Tester #357: a selection belongs to the chip it was made under; another chip starts a new one.
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [outcomes, setOutcomes] = useState<ReadonlyArray<{ groupId: string; verb: BulkVerb; outcome: BulkOutcome }>>([]);
  const [busy, setBusy] = useState(false);
  const choose = (next: GroupFilter): void => { setFilter(next); writeGroupFilter(groupFilterStorage(), next); setPicked(new Set()); setOutcomes([]); };
  const bulk = props.onBulkAction;
  const selection = shown.filter((group) => picked.has(group.groupId));
  const pick = (groupId: string) => (checked: boolean): void => setPicked((all) => {
    const next = new Set(all);
    if (checked) next.add(groupId); else next.delete(groupId);
    return next;
  });
  const selectBox = (groupId: string): JSX.Element | undefined => bulk === undefined ? undefined
    : <SelectBox groupId={groupId} checked={picked.has(groupId)} onChange={pick(groupId)} />;
  // One command per group, in order, each at the revision its own fresh read gives (App's card action); a refusal stops
  // nothing else. No bulk retry or pause (#92 ruling).
  const run = async (verb: BulkVerb): Promise<void> => {
    if (bulk === undefined || busy) return;
    setBusy(true);
    const done: Array<{ groupId: string; verb: BulkVerb; outcome: BulkOutcome }> = [];
    try {
      for (const group of selection) {
        let outcome: BulkOutcome;
        try { outcome = await bulk(group.groupId, verb, group.repoId); } catch { outcome = "refused"; }
        done.push({ groupId: group.groupId, verb, outcome });
      }
    } finally {
      setOutcomes(done);
      setPicked(new Set(done.filter((row) => row.outcome === "refused").map((row) => row.groupId)));
      setBusy(false);
    }
  };
  const closeOpen = bulkCloseOpen(selection);
  return (
    <>
      <div role="group" aria-label={t("control.groupFilter.region")} className={`group-filter ${groupFilter}`}>
        {GROUP_FILTERS.map((option) => (
          <button key={option} type="button" aria-pressed={filter === option} onClick={() => choose(option)}>
            {option === "all" ? t("control.groupFilter.all") : t(`control.groupCategory.${option}` as const)}
            {/* Tester #357: each chip says how many groups of this project scope it holds. */}
            {" "}<span className="tabular-nums">({listed.filter((group) => matchesGroupFilter(group, option)).length})</span>
          </button>
        ))}
      </div>
      {bulk !== undefined && (selection.length > 0 || outcomes.length > 0) && (
        <div role="group" aria-label={t("control.groupBulk.region")} className={groupBulk} aria-busy={busy}>
          {selection.length > 0 && <>
            <span>{t("control.groupBulk.selected", { n: selection.length })}</span>
            <button type="button" disabled={busy} onClick={() => { void run("archive-group"); }}>{t("control.groupBulk.archive")}</button>
            <button type="button" disabled={busy || !closeOpen} aria-describedby={closeOpen ? undefined : "group-bulk-close-reason"}
              onClick={() => { void run("close-group"); }}>{t("control.groupBulk.close")}</button>
            {!closeOpen && <small id="group-bulk-close-reason">{t("control.groupBulk.closeNeedsDone")}</small>}
            <button type="button" className="btn-quiet" disabled={busy} onClick={() => setPicked(new Set())}>{t("control.groupBulk.clear")}</button>
          </>}
          {outcomes.length > 0 && (
            <ul aria-label={t("control.groupBulk.outcomes")}>
              {outcomes.map((row) => (
                <li key={row.groupId} data-testid={`bulk-outcome-${row.groupId}`} data-outcome={row.outcome}>
                  {row.outcome === "refused" && props.refusals?.[row.groupId] !== undefined
                    ? <>{row.groupId}: <RefusalNotice refusal={props.refusals[row.groupId]!} testId={`bulk-refusal-${row.groupId}`} /></>
                    : t(`control.groupBulk.outcome.${row.outcome}.${row.verb}` as const, { groupId: row.groupId })}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <nav aria-label={t("control.groupsNav")} className={`group-list ${groupList}`}>
        {scope?.kind === "unresolved" ? (
          // Plan decision P1: with no project list a row could belong to any project, so none is shown.
          <p role="note">{t("project.listUnavailable")}</p>
        ) : listed.length === 0 ? <p>{t("control.noGroups")} <a href={hashFor("requirements")}>{t("control.startFromRequirement")}</a></p> : shown.length === 0 && <p>{t("control.groupFilter.empty")}</p>}
        {shown.map((group) => group.state === "clarifying" ? (
          // N1 spec §11.2: a clarifying group has no group view (DR25); it is operated in Requirements until accept.
          <GroupActionsMenu key={group.groupId} group={group} onOpen={() => props.onSelectRequirement?.(group.groupId)} onAction={props.onAction} refusal={props.refusals?.[group.groupId]}>{(onContextMenu) => (
            <><a className={`group-card ${groupCard}`} href={hashFor("requirements")} onClick={() => props.onSelectRequirement?.(group.groupId)} onContextMenu={onContextMenu}
              aria-labelledby={`req-name-${group.groupId}`} aria-describedby={`req-goal-${group.groupId}`}>
              {/* Task 11 acceptance (session ffec7b28): the card names its requirement the way every other card does; tester #17: first. */}
              <span id={`req-goal-${group.groupId}`} className={`group-card-lead ${groupCardLead}`}><CardGoal group={group} className={`group-card-goal ${groupCardGoal}`} /></span>
              <span id={`req-name-${group.groupId}`} className={`group-card-name ${groupCardName}`}><span className="led" data-led={groupLed(group)} aria-hidden="true" />{group.groupId} · {groupStateText(group)} · {t("control.requirementBadge")}{label(group.repoId)}</span>
            </a>{selectBox(group.groupId)}</>
          )}</GroupActionsMenu>
        ) : (
          <GroupCard key={group.groupId} group={group} selected={group.groupId === props.selected} repoText={label(group.repoId)} now={now} onSelect={() => props.onSelect(group.groupId)} onAction={props.onAction} refusal={props.refusals?.[group.groupId]} onOpenDispatch={props.onOpenDispatch && (() => props.onOpenDispatch!(group.groupId))} selectBox={selectBox(group.groupId)} />
        ))}
      </nav>
    </>
  );
}
