import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { GroupViewV1 } from "./controlTypes.js";
import i18n from "./i18n.js";
import { shortTokens } from "./TokenInput.js";
import { COST_LONG_RUNNING_MS, COST_MIN_COMPARABLE_TASKS, costRunOfView, taskCosts, type CostReason, type TaskCost } from "../../src/control/taskCost.js";

/**
 * Tester #321 part C: what each task has cost over all its runs, against the group median over its finished peers -- the
 * same computation `orca group brief` and `orca task show` print (src/control/taskCost.ts). A notice only: nothing here
 * pauses, stops or changes a run, a budget or a retry.
 */
export function groupTaskCosts(view: GroupViewV1, now: number): TaskCost[] {
  return taskCosts(view.runs.map(costRunOfView), now);
}

const minutes = (ms: number): number => Math.round(ms / 60_000);

function ownText(cost: TaskCost): string {
  // Unknown usage is not 0 (review ruling 2026-11-18): it is said to be unknown.
  const tokens = cost.tokens === null ? i18n.t("control.taskCost.tokensUnknown") : i18n.t("control.taskCost.tokens", { tokens: shortTokens(cost.tokens) });
  return i18n.t("control.taskCost.own", { count: cost.runs, minutes: minutes(cost.ms), tokens }) + (cost.underWay ? i18n.t("control.taskCost.soFar") : "");
}

const REASON_TEXT: Record<Exclude<CostReason, "long-running">, (cost: TaskCost) => string> = {
  "tokens-multiple": (cost) => i18n.t("control.taskCost.reasonTokens", { times: cost.tokensMultiple!.toFixed(1) }),
  "time-multiple": (cost) => i18n.t("control.taskCost.reasonTime", { times: cost.timeMultiple!.toFixed(1) }),
};

/**
 * A flagged task in one sentence: why, what it cost, and that nothing was stopped. The 30-minute line applies only where
 * there is no median (taskCost.ts), so a task it flags is said to have run long, not to cost more than its group.
 */
export function flaggedText(cost: TaskCost): string {
  if (cost.reasons.includes("long-running")) return i18n.t("control.taskCost.longRunning", { taskId: cost.taskId, minutes: minutes(COST_LONG_RUNNING_MS), own: ownText(cost) });
  return i18n.t("control.taskCost.flagged", { taskId: cost.taskId, own: ownText(cost),
    reasons: cost.reasons.map((reason) => REASON_TEXT[reason as Exclude<CostReason, "long-running">](cost)).join(i18n.t("control.taskCost.reasonJoin")) });
}

/** The task's cost and what it is compared with, for the task detail. */
export function costLineText(cost: TaskCost): string {
  const against = cost.medianTokens === null || cost.medianMs === null
    ? i18n.t("control.taskCost.tooFew", { count: cost.comparable, needed: COST_MIN_COMPARABLE_TASKS })
    : i18n.t("control.taskCost.median", { n: cost.comparable, tokens: shortTokens(Math.round(cost.medianTokens)), minutes: minutes(cost.medianMs) });
  return i18n.t("control.taskCost.line", { own: ownText(cost), against });
}

/** The Problems rows: one per flagged task. Listed, not counted on the tab (review ruling 2026-11-18, as GroupAllowances). */
export function CostOutlierRows(props: { costs: readonly TaskCost[] }): JSX.Element {
  useTranslation();
  return <>{props.costs.map((cost) => (
    <div key={cost.taskId} data-cost-task-id={cost.taskId}>
      <p data-tone="warn">{flaggedText(cost)}</p>
    </div>
  ))}</>;
}

/** The task detail's cost line, and the flagged sentence when the task is flagged. */
export function TaskCostLine(props: { cost: TaskCost | undefined }): JSX.Element | null {
  useTranslation();
  const { cost } = props;
  if (cost === undefined) return null;
  return <>
    <p className="num" data-testid={`task-cost-${cost.taskId}`}>{costLineText(cost)}</p>
    {cost.reasons.length > 0 && <p data-tone="warn" data-testid={`task-cost-flagged-${cost.taskId}`}>{flaggedText(cost)}</p>}
  </>;
}
