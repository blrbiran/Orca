import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { CardGoal } from "./CardGoal.js";
import { enumText } from "./i18n.js";
import { explainRunReason } from "./refusalExplain.js";
import { reasonCode } from "./runFacts.js";
import type { WorkItemCategoryV1 } from "./controlTypes.js";
import type { OverviewModel, OverviewQueueRow } from "./overviewModel.js";
import { overviewColumn as column, overviewRowButton as rowButton, overviewRowItem as rowItem, overviewRowList as rowList } from "./ui/classes.js";
import type { OverviewTarget } from "./overviewNavigation.js";
const rowText = "my-2";
/** Taste refinement P1-4: the queue keeps every step that is not a decision review, and at most this many reviews. */
export const OVERVIEW_DECISION_LIMIT = 3;
export function visibleQueue(queue: OverviewQueueRow[]): { rows: OverviewQueueRow[]; hiddenDecisions: number; decisions: number } {
  let shown = 0;
  const decisions = queue.filter((row) => row.target.kind === "decision").length;
  const rows = queue.filter((row) => row.target.kind !== "decision" || shown++ < OVERVIEW_DECISION_LIMIT);
  return { rows, hiddenDecisions: decisions - Math.min(decisions, OVERVIEW_DECISION_LIMIT), decisions };
}
/**
 * Issue #56: a step's reason code in words, as the group view's RunReason explains it, with the raw code kept as small
 * secondary text; a code this panel has no words for is shown as sent. A decision's question and a command id are not codes.
 */
function QueueReason({ row }: { row: OverviewQueueRow }): JSX.Element {
  const words = row.kind === "decision-review" || row.kind === "command-unknown" ? null : explainRunReason(reasonCode(row.reason));
  return words === null ? <>{row.reason}</> : <>{words} <small><code>{row.reason}</code></small></>;
}
/** Progress first in DOM and narrow layouts; each queue row only opens its owner. */
export function Overview(props: { model: OverviewModel; onOpen: (target: OverviewTarget) => void; onImport: () => void; onRequirement: () => void; onViewDecisions?: () => void }): JSX.Element {
 const { t } = useTranslation(); const { model } = props; const queue = visibleQueue(model.queue);
 return <section aria-label={t("overview.title")} >
  <div className="flex flex-wrap items-baseline justify-between gap-4"><h2>{t("overview.title")}</h2><div className="flex flex-wrap gap-2"><button type="button" className={`${rowButton} ms-0`} onClick={props.onRequirement}>{t("overview.newRequirement")}</button><button type="button" className={`${rowButton} ms-0`} onClick={props.onImport}>{t("overview.import")}</button></div></div>
  <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] items-start gap-8 max-[850px]:grid-cols-[minmax(0,1fr)] max-[850px]:gap-4">
   <section className={column} aria-label={t("overview.progress")}><h3>{t("overview.progress")}</h3>
    {model.scopeUnavailable && <p role="status">{t("overview.scopeUnavailable")}</p>}
    {model.sources.filter((s) => s.kind === "progress" && s.status !== "available").map((s) => <p role="status" key={s.kind}>{t(`overview.source.${s.kind}`)} · {t(`overview.status.${s.status}`)}{s.error ? ` · ${s.error}` : ""}</p>)}
    {model.issues.map((issue, i) => <p role="alert" data-tone="warn" key={JSON.stringify([issue.groupId, issue.reason, i])}>{issue.groupId ?? t("overview.global")} · {issue.reason}</p>)}
    {/* Tester #23: the empty state points at the two buttons in the heading that start work. */}
    {model.progress.length === 0 && model.complete && <p>{t("overview.noProgress")}</p>}
    <ul className={rowList}>{model.progress.map(({ group, owner, ownerUnknown, target }) => <li key={group.groupId} className={rowItem}>
     <div className="flex flex-wrap items-baseline justify-between gap-3"><button type="button" className={rowButton} onClick={() => props.onOpen(target)}><CardGoal group={group} fallback={group.groupId} /></button><span>{owner || t("overview.global")}{ownerUnknown ? ` · ${t("overview.ownerUnknown")}` : ""}</span></div>
     <p className={rowText}>{enumText("groupState", group.state)}{group.state === "review" ? ` · ${t("overview.goalReview")}` : group.state === "done" ? ` · ${t("overview.deliverySeparate")}` : ""}</p>
     {group.completion ? <><p className={rowText}>{t("overview.tasks", { done: group.completion.done, total: group.completion.total })}</p>{group.completion.total > 0 && <progress className="w-full max-w-full" value={group.completion.done} max={group.completion.total} aria-label={t("overview.taskProgress")} />}</> : group.requirement ? <p className={rowText}>{t("overview.requirementProgress", { round: group.requirement.roundNo ?? "—", questions: group.requirement.openQuestions })}</p> : <p className={rowText}>{t("overview.taskCountsUnavailable")}</p>}
     {group.counts && <p className={`${rowText} flex flex-wrap gap-3`}>{Object.entries(group.counts).map(([kind, n]) => <span key={kind}>{t(`control.graph.category.${kind as WorkItemCategoryV1}`)} {n}</span>)}</p>}
    </li>)}</ul>
   </section>
   <section className={column} aria-label={t("overview.queue")}><h3>{t("overview.queue")}</h3>
    {model.sources.filter((s) => s.kind !== "progress" && s.status !== "available").map((s) => <p role="status" key={s.kind}>{t(`overview.source.${s.kind}`)} · {t(`overview.status.${s.status}`)}{s.error ? ` · ${s.error}` : ""}</p>)}
    {/* Tester #25: the queue is already in priority order (overviewModel.ts); its first row is marked as the next step. */}
    <ul className={rowList}>{queue.rows.map((row, index) => <li key={row.key} className={rowItem} data-next={index === 0 ? "true" : undefined}>
     {index === 0 && <span className="overview-next mr-1.5 inline-block rounded-control px-1.5 text-xs font-semibold" data-tone="warn">{t("overview.nextMark")}</span>}
     <button type="button" className={rowButton} onClick={() => props.onOpen(row.target)}>{t(`overview.step.${row.kind}`)} · {row.target.kind === "group" || row.target.kind === "requirement" ? row.target.groupId : row.target.kind === "decision" ? row.target.id : t("overview.global")}</button>
     <p className={rowText}>{row.owner || t("overview.global")}{row.ownerUnknown ? ` · ${t("overview.ownerUnknown")}` : ""} · <QueueReason row={row} /></p>
     {row.ownerRequired && <p className={rowText}>{t("overview.ownerRequired")}</p>}
    </li>)}</ul>
    {queue.hiddenDecisions > 0 && <p><a href="#decisions" onClick={() => props.onViewDecisions?.()}>{t("overview.viewAllDecisions", { n: queue.decisions })}</a></p>}
    {model.queue.length === 0 && model.complete && <p>{t("overview.noAttention")}</p>}
   </section>
  </div>
 </section>;
}
