import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { enumText } from "./i18n.js";
import { explainRunReason } from "./refusalExplain.js";
import { reasonCode } from "./runFacts.js";
import type { WorkItemCategoryV1 } from "./controlTypes.js";
import type { OverviewModel, OverviewQueueRow } from "./overviewModel.js";
import type { OverviewTarget } from "./overviewNavigation.js";
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
 return <section aria-label={t("overview.title")} className="overview">
  <div className="overview-heading"><h2>{t("overview.title")}</h2><div><button type="button" onClick={props.onRequirement}>{t("overview.newRequirement")}</button><button type="button" onClick={props.onImport}>{t("overview.import")}</button></div></div>
  <div className="overview-layout">
   <section aria-label={t("overview.progress")}><h3>{t("overview.progress")}</h3>
    {model.scopeUnavailable && <p role="status">{t("overview.scopeUnavailable")}</p>}
    {model.sources.filter((s) => s.kind === "progress" && s.status !== "available").map((s) => <p role="status" key={s.kind}>{t(`overview.source.${s.kind}`)} · {t(`overview.status.${s.status}`)}{s.error ? ` · ${s.error}` : ""}</p>)}
    {model.issues.map((issue, i) => <p role="alert" data-tone="warn" key={JSON.stringify([issue.groupId, issue.reason, i])}>{issue.groupId ?? t("overview.global")} · {issue.reason}</p>)}
    {model.progress.length === 0 && model.complete && <p>{t("overview.noProgress")}</p>}
    <ul className="overview-progress">{model.progress.map(({ group, owner, ownerUnknown, target }) => <li key={group.groupId}>
     <div><button type="button" onClick={() => props.onOpen(target)}>{group.goal || group.groupId}</button><span>{owner || t("overview.global")}{ownerUnknown ? ` · ${t("overview.ownerUnknown")}` : ""}</span></div>
     <p>{enumText("groupState", group.state)}{group.state === "review" ? ` · ${t("overview.goalReview")}` : group.state === "done" ? ` · ${t("overview.deliverySeparate")}` : ""}</p>
     {group.completion ? <><p>{t("overview.tasks", { done: group.completion.done, total: group.completion.total })}</p>{group.completion.total > 0 && <progress value={group.completion.done} max={group.completion.total} aria-label={t("overview.taskProgress")} />}</> : group.requirement ? <p>{t("overview.requirementProgress", { round: group.requirement.roundNo ?? "—", questions: group.requirement.openQuestions })}</p> : <p>{t("overview.taskCountsUnavailable")}</p>}
     {group.counts && <p className="overview-counts">{Object.entries(group.counts).map(([kind, n]) => <span key={kind}>{t(`control.graph.category.${kind as WorkItemCategoryV1}`)} {n}</span>)}</p>}
    </li>)}</ul>
   </section>
   <section aria-label={t("overview.queue")}><h3>{t("overview.queue")}</h3>
    {model.sources.filter((s) => s.kind !== "progress" && s.status !== "available").map((s) => <p role="status" key={s.kind}>{t(`overview.source.${s.kind}`)} · {t(`overview.status.${s.status}`)}{s.error ? ` · ${s.error}` : ""}</p>)}
    <ul className="overview-queue">{queue.rows.map((row) => <li key={row.key}>
     <button type="button" onClick={() => props.onOpen(row.target)}>{t(`overview.step.${row.kind}`)} · {row.target.kind === "group" || row.target.kind === "requirement" ? row.target.groupId : row.target.kind === "decision" ? row.target.id : t("overview.global")}</button>
     <p>{row.owner || t("overview.global")}{row.ownerUnknown ? ` · ${t("overview.ownerUnknown")}` : ""} · <QueueReason row={row} /></p>
     {row.ownerRequired && <p>{t("overview.ownerRequired")}</p>}
    </li>)}</ul>
    {queue.hiddenDecisions > 0 && <p><a href="#decisions" onClick={() => props.onViewDecisions?.()}>{t("overview.viewAllDecisions", { n: queue.decisions })}</a></p>}
    {model.queue.length === 0 && model.complete && <p>{t("overview.noAttention")}</p>}
   </section>
  </div>
 </section>;
}
