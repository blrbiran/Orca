/**
 * Tester #319 (proposal 1, human-agreed): the conclusion card at the top of a group's Results. It answers four questions
 * without scrolling, from facts the group view already carries: is it done (completion and the group acceptance), where
 * does it deliver (the integration scheme, or a dir / multi group's folders), is anything waiting for the person (each
 * line leads to the existing place that has the action; this card sends no command), and the work branch with its tip.
 */
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { GroupDecisionsViewV1, GroupViewV1 } from "./controlTypes.js";
import { PR_URL, short, workBranch } from "./GitScheme.js";
import { runNeedsHuman } from "./RunDecisions.js";

export interface ResultsConclusionProps {
  view: GroupViewV1;
  /** This group's decisions read, or null when there is none (or it failed). */
  decisions: GroupDecisionsViewV1 | null;
  /** The count the Problems tab carries. */
  problemCount: number;
  onOpenProblems: () => void;
  onOpenIntegration: () => void;
  onOpenTask: (taskId: string) => void;
}

const copy = (text: string): void => { void navigator.clipboard?.writeText(text); };

export function ResultsConclusion(props: ResultsConclusionProps): JSX.Element {
  const { t } = useTranslation();
  const { view } = props;
  const branch = workBranch(view);
  const folders = view.summary.multiDir !== undefined || view.summary.placement !== undefined;
  const scheme = view.integration?.scheme ?? { delivery: "keep" as const };
  const completion = view.summary.completion;
  const tip = view.summary.acceptance?.tip ?? null;

  const delivery = view.summary.multiDir !== undefined ? t("control.results.deliveryKind.multi")
    : view.summary.placement !== undefined ? t("control.results.deliveryKind.folder")
    : t(`control.results.deliveryKind.${scheme.delivery}`, { branch, target: "target" in scheme ? scheme.target : "", remote: "remote" in scheme ? scheme.remote : "" });
  const pr = view.integration?.pr ?? null;
  const prLabel = pr === null ? "" : t("control.integration.pr", { number: pr.number, state: t(pr.ready ? "control.integration.prReady" : "control.integration.prDraft") });

  const waiting: JSX.Element[] = [];
  if (props.problemCount > 0) waiting.push(
    <li key="problems">{t("control.results.problems", { count: props.problemCount })}{" "}
      <button type="button" onClick={props.onOpenProblems}>{t("control.results.openProblems")}</button></li>);
  const integrationState = view.integration?.state;
  if (integrationState === "blocked" || integrationState === "conflict") waiting.push(
    <li key="integration">{t("control.results.integration", { state: t(`control.integration.state.${integrationState}`) })}{" "}
      <button type="button" onClick={props.onOpenIntegration}>{t("control.results.openIntegration")}</button></li>);
  const pending = props.decisions?.pendingCount ?? 0;
  const decisionTask = props.decisions?.tasks.find((task) => task.runs.some(runNeedsHuman))?.taskId;
  if (pending > 0) waiting.push(
    <li key="decisions">{t("control.results.decisions", { count: pending })}
      {decisionTask !== undefined && <>{" "}<button type="button" onClick={() => props.onOpenTask(decisionTask)}>{t("control.results.openTask", { taskId: decisionTask })}</button></>}</li>);
  // A finished keep group: merging is the person's, and this panel has no button for it (GitScheme, board spec C4).
  if (!folders && scheme.delivery === "keep" && view.summary.state === "done") waiting.push(
    <li key="merge">{t("control.results.mergeYours", { branch })}</li>);

  return (
    <section aria-label={t("control.results.conclusion")} data-testid="results-conclusion" className="detail-block min-w-0 wrap-anywhere">
      <h3>{t("control.results.conclusion")}</h3>
      <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 max-md:grid-cols-1 [&_dd]:m-0 [&_dd]:min-w-0 [&_dt]:text-muted">
        <dt>{t("control.results.done")}</dt>
        <dd data-conclusion="done">
          {completion === undefined ? t("control.results.doneUnread") : t("control.results.doneCount", completion)}
          {" · "}
          {t("control.results.acceptance", { result: t(`control.results.acceptanceResult.${view.summary.acceptance?.result ?? "not-run"}`) })}
        </dd>
        <dt>{t("control.results.delivery")}</dt>
        <dd data-conclusion="delivery">
          {delivery}
          {pr !== null && <>{" · "}{PR_URL.test(pr.url) ? <a href={pr.url}>{prLabel}</a> : prLabel}</>}
        </dd>
        <dt>{t("control.results.waiting")}</dt>
        <dd data-conclusion="waiting">
          {waiting.length === 0 ? t("control.results.nothing") : <ul className="m-0 grid list-none gap-1 p-0">{waiting}</ul>}
        </dd>
        {!folders && <>
          <dt>{t("control.results.artifact")}</dt>
          <dd data-conclusion="artifact">
            <code>{branch}</code>{" "}
            <button type="button" className="btn-quiet px-1 text-xs" onClick={() => copy(branch)}>{t("control.results.copyBranch")}</button>
            {" · "}
            {tip === null ? t("control.results.noTip") : <>
              {t("control.results.tip")}{" "}<code title={tip}>{short(tip)}</code>{" "}
              <button type="button" className="btn-quiet px-1 text-xs" onClick={() => copy(tip)}>{t("control.results.copyTip")}</button>
            </>}
          </dd>
        </>}
      </dl>
    </section>
  );
}
