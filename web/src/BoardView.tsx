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
import { CardGoal } from "./CardGoal.js";
import type { FlowListV1, GroupSummaryV1 } from "./controlTypes.js";
import { BOARD_COLUMNS, boardColumn, boardDrop, needsAttention, type BoardColumn } from "./groupCategory.js";
import { GroupGraph } from "./GroupGraph.js";
import { currentLanguage, enumText } from "./i18n.js";
import { formatTokens, shortTokens } from "./TokenInput.js";
import { inScope, type GroupScope } from "./projectScope.js";
import { KNOWN_FAILURE_CAUSES, knownCause } from "./RunReason.js";

export interface BoardViewProps {
  groups: GroupSummaryV1[];
  scope: GroupScope;
  repoLabel?: (repoId: string) => string;
  onOpen: (group: GroupSummaryV1) => void;
  onCommand: (action: ControlAction) => void;
  /** Flow engine spec §14.1: flow runs, each a card for its parent with a template badge (children are never cards). */
  flows?: FlowListV1["runs"];
  onOpenFlow?: (flowRunId: string) => void;
  /** Plan Task 10-B: what the board shows first, top left under its title (the flow start button). */
  toolbar?: JSX.Element;
}

type FlowRun = FlowListV1["runs"][number];
/** A flow run's column: waiting on the person, running, or finished (stopped runs end there too, with their state). */
export function flowColumn(run: FlowRun): BoardColumn {
  if (run.state === "paused" || run.needsYou > 0) return run.state === "done" || run.state === "stopped" ? "done" : "needs-you";
  return run.state === "done" || run.state === "stopped" ? "done" : "running";
}
/** The template's id from its ref (`builtin/<id>@<version>`). */
const templateOf = (ref: string): string => ref.replace(/^builtin\//, "").replace(/@\d+$/, "");

function FlowCard(props: { run: FlowRun; onOpen: () => void }): JSX.Element {
  const { t } = useTranslation();
  const { run } = props;
  return (
    <li className="board-card" data-testid={`board-flow-${run.flowRunId}`}>
      <button type="button" className="board-card-open" onClick={props.onOpen}>{run.flowRunId} · {t(`flow.state.${run.state}`, { defaultValue: run.state })}</button>
      <span className="badge" data-tone="info" data-testid="board-flow-badge">{t("board.card.flowTemplate", { template: templateOf(run.templateRef) })}</span>
      {run.scheduled != null && <span className="badge" data-tone="info" data-testid="board-flow-scheduled">{t("board.card.scheduled", { name: run.scheduled.name })}</span>}
      {run.dir !== null && <p className="board-card-goal">{run.dir}</p>}
      {run.needsYou > 0 && <p className="detail-note" data-testid="board-card-reason">{t("board.card.flowNeedsYou", { count: run.needsYou })}</p>}
      <p className="detail-note">{t("board.card.flowPool", { drawn: shortTokens(run.poolDrawn), pool: shortTokens(run.poolTokens) })}</p>
    </li>
  );
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
      <CardGoal group={group} as="p" className="board-card-goal" />
      {group.completion !== undefined && group.completion.total > 0 && (
        <progress value={group.completion.done} max={group.completion.total}
          aria-label={t("control.groupCard.progress", { done: group.completion.done, total: group.completion.total })} />
      )}
      {group.debug !== undefined && <span className="badge" data-tone="info">{t("board.card.debug", { correctionId: group.debug.correctionId })}</span>}
      {group.systemDebug !== undefined && <span className="badge" data-tone="info">{t("board.card.systemDebug", { groupId: "groupId" in group.systemDebug.source ? group.systemDebug.source.groupId : group.systemDebug.source.kind === "model-review" ? group.systemDebug.source.target : group.systemDebug.source.reviewGroupId, kind: group.systemDebug.source.kind })}</span>}
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
        // Issue #84: the budget's figures short (K/M/B), the exact ones in the title.
        <p className="detail-note" title={[facts.budget.usedTokens, facts.budget.limitTokens].flatMap((n) => (n === null ? [] : [formatTokens(n, currentLanguage())])).join(" / ")}>
          {facts.budget.limitTokens === null ? t("board.card.budgetUnlimited", { used: shortTokens(facts.budget.usedTokens) }) : t("board.card.budget", { used: shortTokens(facts.budget.usedTokens), limit: shortTokens(facts.budget.limitTokens) })}
          {facts.pendingDecisions > 0 ? ` · ${t("board.card.decisions", { count: facts.pendingDecisions })}` : ""}
          {facts.firstFailure !== null ? ` · ${t("board.card.failure", { taskId: facts.firstFailure.taskId, cause: (KNOWN_FAILURE_CAUSES as readonly string[]).includes(facts.firstFailure.cause) ? t(`control.failureCause.label.${knownCause(facts.firstFailure.cause)}`) : facts.firstFailure.cause })}` : ""}
        </p>
      )}
      {/* Checks spec 2026-10-22 §7: a model review's findings this group is involved in -- major red, minor grey (P5). */}
      {(facts?.reviewFindings?.major ?? 0) > 0 && <span className="badge" data-tone="danger" data-testid="board-card-findings-major">{t("board.card.findingsMajor", { count: facts!.reviewFindings!.major })}</span>}
      {(facts?.reviewFindings?.minor ?? 0) > 0 && <span className="badge" data-testid="board-card-findings-minor">{t("board.card.findingsMinor", { count: facts!.reviewFindings!.minor })}</span>}
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
  // A run on a folder belongs to no project (null): it is shown in every scope; one tied to a project, in that project's.
  const flows = (props.flows ?? []).filter((run) => run.projectId === null || inScope(scope, run.projectId));
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
      {props.toolbar !== undefined && <div className="board-toolbar">{props.toolbar}</div>}
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
            const flowCards = flows.filter((run) => flowColumn(run) === column);
            return (
              <section key={column} className="board-column" aria-label={t(`board.column.${column}` as const)} data-column={column}
                onDragOver={(event) => event.preventDefault()} onDrop={drop(column)}>
                <h3>{t(`board.column.${column}` as const)} <span className="nav-count">{cards.length + flowCards.length}</span></h3>
                <ul>
                  {cards.map((group) => <BoardCard key={group.groupId} group={group} repoText={label(group.repoId)} onOpen={() => props.onOpen(group)} />)}
                  {flowCards.map((run) => <FlowCard key={run.flowRunId} run={run} onOpen={() => props.onOpenFlow?.(run.flowRunId)} />)}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
