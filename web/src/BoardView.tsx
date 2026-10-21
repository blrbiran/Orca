/**
 * Kanban spec 2026-10-20 §4: the board, in its own tab -- how the person watches Orca take confirmed groups to done.
 * Groups only (task state is the scheduler's); columns come from the server's summary (groupCategory.ts boardColumn).
 * A drag is weak: an allowed drop sends exactly one existing command (boardDrop), any other drop is refused on the page
 * and the card stays where the summary puts it. A second view draws the person's edges between groups (§3.3, §9a.5).
 */
import { useState } from "react";
import type { DragEvent, JSX } from "react";
import { useTranslation } from "react-i18next";
import type { ControlAction } from "./controlApi.js";
import type { GroupSummaryV1 } from "./controlTypes.js";
import { BOARD_COLUMNS, boardColumn, boardDrop, needsAttention, type BoardColumn } from "./groupCategory.js";
import { GroupGraph } from "./GroupGraph.js";
import { enumText } from "./i18n.js";
import { inScope, type GroupScope } from "./projectScope.js";
import { KNOWN_FAILURE_CAUSES, knownCause } from "./RunReason.js";

export interface BoardViewProps {
  groups: GroupSummaryV1[];
  scope: GroupScope;
  repoLabel?: (repoId: string) => string;
  onOpen: (group: GroupSummaryV1) => void;
  onCommand: (action: ControlAction) => void;
}

/** Why a needs-you card needs the person, in the order the list's attention rule checks it. */
function needsYouReason(group: GroupSummaryV1): "refused" | "paused" | "stopping" | "blocked" | "recovery" | null {
  if (!needsAttention(group)) return null;
  if (group.orchestration?.refusal?.persistent === true) return "refused";
  if (group.stopState === "paused") return "paused";
  if (group.stopState != null && group.stopState !== "handoff-complete") return "stopping";
  if ((group.counts?.blocked ?? 0) > 0 || group.state === "blocked") return "blocked";
  return "recovery";
}

function BoardCard(props: { group: GroupSummaryV1; repoText: string; onOpen: () => void }): JSX.Element {
  const { t } = useTranslation();
  const { group } = props;
  const o = group.orchestration;
  const waiting = o?.state === "waiting-prerequisite" ? t("board.card.waitingFor", { groups: o.waitingFor.join(", ") })
    : o?.state === "waiting-slot" ? t("board.card.waitingSlot")
    : o?.state === "held" ? t("board.card.held") : null;
  const reason = needsYouReason(group);
  const facts = group.card;
  const onDragStart = (event: DragEvent<HTMLElement>): void => { event.dataTransfer.setData("text/plain", group.groupId); };
  return (
    <li className="board-card" draggable onDragStart={onDragStart} data-testid={`board-card-${group.groupId}`}>
      <button type="button" className="board-card-open" onClick={props.onOpen}>
        {group.groupId} · {enumText("groupState", group.state)}{props.repoText}
      </button>
      {group.goal !== undefined && <p className="board-card-goal">{group.goal}</p>}
      {group.completion !== undefined && group.completion.total > 0 && (
        <progress value={group.completion.done} max={group.completion.total}
          aria-label={t("control.groupCard.progress", { done: group.completion.done, total: group.completion.total })} />
      )}
      {group.debug !== undefined && <span className="badge" data-tone="info">{t("board.card.debug", { correctionId: group.debug.correctionId })}</span>}
      {group.systemDebug !== undefined && <span className="badge" data-tone="info">{t("board.card.systemDebug", { groupId: group.systemDebug.source.groupId, kind: group.systemDebug.source.kind })}</span>}
      {(group.escalation ?? []).map((entry) => (
        <p key={entry.taskId} className="detail-note" data-testid="board-card-escalation">
          {entry.state === "debugging" ? t("board.card.escalating", { taskId: entry.taskId, debugGroupId: entry.debugGroupId })
            : entry.state === "rerunning" ? t("board.card.rerunning", { taskId: entry.taskId })
            : t("board.card.escalationExhausted", { taskId: entry.taskId, reason: entry.reason ?? "" })}
        </p>
      ))}
      {group.stopState !== null && <span className="badge">{enumText("stopState", group.stopState)}</span>}
      {waiting !== null && <p className="detail-note">{waiting}</p>}
      {reason !== null && <p className="detail-note" data-testid="board-card-reason">{t(`board.card.reason.${reason}` as const)}</p>}
      {facts !== undefined && (
        <p className="detail-note">
          {facts.budget.limitTokens === null ? t("board.card.budgetUnlimited", { used: facts.budget.usedTokens }) : t("board.card.budget", { used: facts.budget.usedTokens, limit: facts.budget.limitTokens })}
          {facts.pendingDecisions > 0 ? ` · ${t("board.card.decisions", { count: facts.pendingDecisions })}` : ""}
          {facts.firstFailure !== null ? ` · ${t("board.card.failure", { taskId: facts.firstFailure.taskId, cause: (KNOWN_FAILURE_CAUSES as readonly string[]).includes(facts.firstFailure.cause) ? t(`control.failureCause.label.${knownCause(facts.firstFailure.cause)}`) : facts.firstFailure.cause })}` : ""}
        </p>
      )}
    </li>
  );
}

export function BoardView(props: BoardViewProps): JSX.Element {
  const { t } = useTranslation();
  const [view, setView] = useState<"board" | "graph">("board");
  const [showArchived, setShowArchived] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const scope = props.scope;
  if (scope.kind === "unresolved") return <p role="note">{t("project.listUnavailable")}</p>;
  const groups = props.groups.filter((group) => inScope(scope, group.repoId));
  const label = (repoId: string): string => (scope.kind === "all" ? ` · ${props.repoLabel?.(repoId) ?? repoId}` : "");
  const columns = BOARD_COLUMNS.filter((column) => column !== "archived" || showArchived);

  const drop = (to: BoardColumn) => (event: DragEvent<HTMLElement>): void => {
    event.preventDefault();
    const group = groups.find((candidate) => candidate.groupId === event.dataTransfer.getData("text/plain"));
    if (group === undefined) return;
    const decided = boardDrop(group, to);
    if ("refused" in decided) {
      if (decided.refused !== "same") setRefusal(t("board.dropRefused", { groupId: group.groupId, column: t(`board.column.${to}` as const) }));
      return;
    }
    setRefusal(null);
    props.onCommand({ verb: decided.verb, groupId: group.groupId, expectedRevision: group.commandRevision, payload: {} });
  };

  return (
    <section className="board" aria-label={t("board.title")}>
      <h2>{t("board.title")}</h2>
      <div role="group" aria-label={t("board.viewChoice")}>
        <button type="button" aria-pressed={view === "board"} onClick={() => setView("board")}>{t("board.viewBoard")}</button>
        <button type="button" aria-pressed={view === "graph"} onClick={() => setView("graph")}>{t("board.viewGraph")}</button>
        {view === "board" && (
          <label><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.currentTarget.checked)} />{t("board.showArchived")}</label>
        )}
      </div>
      {refusal !== null && <p role="alert" data-testid="board-refusal">{refusal}</p>}
      {view === "graph" ? <GroupGraph groups={groups} onCommand={props.onCommand} /> : (
        <div className="board-columns">
          {columns.map((column) => {
            const cards = groups.filter((group) => boardColumn(group) === column);
            return (
              <section key={column} className="board-column" aria-label={t(`board.column.${column}` as const)} data-column={column}
                onDragOver={(event) => event.preventDefault()} onDrop={drop(column)}>
                <h3>{t(`board.column.${column}` as const)} <span className="nav-count">{cards.length}</span></h3>
                <ul>
                  {cards.map((group) => <BoardCard key={group.groupId} group={group} repoText={label(group.repoId)} onOpen={() => props.onOpen(group)} />)}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
