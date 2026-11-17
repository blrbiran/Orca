/**
 * Tester #327 (option A, human-approved): a group's prerequisite groups, at the top of its Progress region -- each one's
 * state, tasks done and work branch, with the prerequisites behind it indented under it, so a chain A <- B <- C reads in
 * order. Everything comes from the group summaries the page already polls (no read of its own). "Landed" is the server's
 * word (the summary's `landed`, its prerequisiteDone): the moment a dependent stops waiting for that group.
 */
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { GroupSummaryV1 } from "./controlTypes.js";
import { boardColumn, groupLed, type BoardColumn } from "./groupCategory.js";

/** DESIGN.md "Tone, not role": running is info, waiting is warn, needs-you is danger, settled has no tone. */
const COLUMN_TONE: Partial<Record<BoardColumn, "info" | "warn" | "danger">> = { running: "info", queued: "warn", "needs-you": "danger" };

export interface GroupDependenciesProps {
  /** The open group's own id, so a chain that leads back to it (refused by the server) cannot recurse. */
  groupId: string;
  /** The open group's direct prerequisites, in the order they were added; none -> no card. */
  dependsOn: readonly string[] | undefined;
  /** A group's summary as the page last read it; undefined when the page has not read that group. */
  groupOf: (groupId: string) => GroupSummaryV1 | undefined;
  /** Open a prerequisite group with the app's own navigation; without it the ids are plain text. */
  onSelectGroup?: (groupId: string) => void;
}

function DependencyRows(props: Omit<GroupDependenciesProps, "dependsOn" | "groupId"> & { ids: readonly string[]; path: ReadonlySet<string> }): JSX.Element {
  const { t } = useTranslation();
  return (
    <ul className="m-0 list-none ps-0">
      {props.ids.map((id) => {
        const summary = props.groupOf(id);
        const landed = summary?.landed === true;
        const column = summary === undefined ? null : boardColumn(summary);
        // A group already on this chain is not expanded again (the server refuses cycles; this only keeps the page finite).
        const behind = summary?.dependsOn === undefined || props.path.has(id) ? [] : summary.dependsOn;
        const completion = summary?.completion;
        return (
          <li key={id} className="min-w-0 py-1" data-testid={`dependency-${id}`}>
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
              {/* Ruling H8: the status light; decorative, the state is the badge's text. A landed group is settled (dim). */}
              <span className="led" data-led={summary === undefined || landed ? "idle" : groupLed(summary)} aria-hidden="true" />
              {props.onSelectGroup === undefined ? <span className="font-medium [overflow-wrap:anywhere]">{id}</span> : (
                <button type="button" className="btn-quiet min-w-0 px-1 font-medium [overflow-wrap:anywhere]" title={t("control.dependencies.open", { groupId: id })}
                  onClick={() => props.onSelectGroup?.(id)}>{id}</button>
              )}
              {summary === undefined || column === null ? <span className="text-xs text-muted">{t("control.dependencies.unknown")}</span> : <>
                <span className="badge" data-testid={`dependency-state-${id}`} data-tone={landed ? "ok" : COLUMN_TONE[column]}>
                  {landed ? t("control.dependencies.landed") : t(`board.column.${column}`)}
                </span>
                {/* Its tasks are done but its dependents still wait (integration, acceptance or review not through yet). */}
                {!landed && column === "done" && <span className="text-xs text-muted">{t("control.dependencies.notLanded")}</span>}
                {completion !== undefined && completion.total > 0 && (
                  <span className="num text-xs text-muted" data-testid={`dependency-tasks-${id}`}>{t("board.card.tasksDone", { done: completion.done, total: completion.total })}</span>
                )}
                {summary.branch !== undefined && <span className="[font-family:var(--mono)] text-xs text-muted [overflow-wrap:anywhere]">{t("control.dependencies.branch", { branch: summary.branch })}</span>}
              </>}
            </div>
            {behind.length > 0 && (
              <div className="ms-1 border-s border-line ps-3" data-testid={`dependency-behind-${id}`}>
                <DependencyRows groupOf={props.groupOf} onSelectGroup={props.onSelectGroup} ids={behind} path={new Set([...props.path, id])} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function GroupDependencies(props: GroupDependenciesProps): JSX.Element | null {
  const { t } = useTranslation();
  if (props.dependsOn === undefined || props.dependsOn.length === 0) return null;
  return (
    <section className="detail-block mb-4 min-w-0" aria-label={t("control.dependencies.heading")} data-testid="group-dependencies">
      <h3 className="m-0">{t("control.dependencies.heading")}</h3>
      <p className="mt-1 mb-1 text-xs text-muted">{t("control.dependencies.note")}</p>
      <DependencyRows groupOf={props.groupOf} onSelectGroup={props.onSelectGroup} ids={props.dependsOn} path={new Set([props.groupId])} />
    </section>
  );
}
