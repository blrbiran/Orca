/**
 * Tester #319 (proposal 1, human-agreed): the conclusion card at the top of a group's Results. It answers four questions
 * without scrolling, from facts the group view already carries: is it done (completion and the group acceptance), where
 * does it deliver (the Git section's own sentence, or a dir / multi group's folders), is anything waiting for the person
 * (each line leads to the existing place that has the action; this card sends no command, and every button it has carries
 * `data-no-command`), and the work branch with its tip.
 *
 * Review fix 1: it never says "Nothing" while the summary's needs-you (the server's one rule, controlOverview.ts) holds --
 * it names what it can, each on the region the server's own row points to, and otherwise says something waits.
 */
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { GroupDecisionsViewV1, GroupViewV1 } from "./controlTypes.js";
import { PR_URL, short, workBranch } from "./GitScheme.js";
import { enumText } from "./i18n.js";
import { integrationSentence } from "./IntegrationScheme.js";
import { runNeedsHuman } from "./RunDecisions.js";

export interface ResultsConclusionProps {
  view: GroupViewV1;
  /** This group's decisions read; null while it is loading, or when it failed. */
  decisions: GroupDecisionsViewV1 | null;
  /** The failed read's code (App keeps a failed read as failed, Rule 12); null otherwise. */
  decisionsFailed: string | null;
  /** The count the Problems tab carries. */
  problemCount: number;
  onOpenProblems: () => void;
  onOpenIntegration: () => void;
  onOpenTask: (taskId: string) => void;
}

const copy = (text: string): void => { void navigator.clipboard?.writeText(text); };
/** The server's needs-you rows for a placement and a multi landing (controlOverview.ts groupSteps). */
const STOPPED_PLACEMENT = new Set(["folder-changed", "folder-unwritable", "folder-missing", "failed"]);
const STOPPED_LANDING = new Set(["partial", "blocked", "folder-changed", "folder-unwritable"]);

export function ResultsConclusion(props: ResultsConclusionProps): JSX.Element {
  const { t } = useTranslation();
  const { view } = props;
  const { summary } = view;
  const branch = workBranch(view);
  const folders = summary.multiDir !== undefined || summary.placement !== undefined;
  const scheme = view.integration?.scheme ?? { delivery: "keep" as const };
  const completion = summary.completion;
  const tip = summary.acceptance?.tip ?? null;
  const pr = view.integration?.pr ?? null;
  const prLabel = pr === null ? "" : t("control.integration.pr", { number: pr.number, state: t(pr.ready ? "control.integration.prReady" : "control.integration.prDraft") });

  const delivery = summary.multiDir !== undefined ? t("control.results.deliveryKind.multi")
    : summary.placement !== undefined ? t("control.results.deliveryKind.folder")
    : integrationSentence(scheme, summary.groupId);

  // Every button here moves on the page or copies text; the marker says so to the archived-group criterion.
  const go = (label: string, onClick: () => void): JSX.Element => (
    <>{" "}<button type="button" data-no-command onClick={onClick}>{label}</button></>
  );
  const toProblems = go(t("control.results.openProblems"), props.onOpenProblems);
  const toIntegration = go(t("control.results.openIntegration"), props.onOpenIntegration);

  const waiting: JSX.Element[] = [];
  if (props.problemCount > 0) waiting.push(<li key="problems">{t("control.results.problems", { count: props.problemCount })}{toProblems}</li>);
  const integrationState = view.integration?.state;
  const integrationWords = integrationState === "blocked" || integrationState === "conflict" ? t(`control.integration.state.${integrationState}`)
    : summary.placement !== undefined && STOPPED_PLACEMENT.has(summary.placement.state) ? t(`control.results.placementState.${summary.placement.state as "failed"}`)
    : summary.multiDir?.landing != null && STOPPED_LANDING.has(summary.multiDir.landing.state) ? t(`control.results.landingState.${summary.multiDir.landing.state as "partial"}`)
    : null;
  if (integrationWords !== null) waiting.push(<li key="integration">{t("control.results.integration", { state: integrationWords })}{toIntegration}</li>);
  if (summary.state === "blocked") waiting.push(<li key="blocked">{t("control.results.blocked")}{toProblems}</li>);
  // As the server's rule: a stop still settling waits for the person; a pause or a completed handoff does not.
  if (summary.stopState !== null && summary.stopState !== "paused" && summary.stopState !== "handoff-complete") {
    waiting.push(<li key="stop">{t("control.results.stop", { state: enumText("stopState", summary.stopState) })}{toProblems}</li>);
  }
  if (summary.deliveredAcceptance?.problem !== undefined) waiting.push(<li key="delivered">{t("control.results.deliveredFailed")}{toProblems}</li>);
  if (summary.requirementReview?.problem !== undefined) waiting.push(<li key="review">{t("control.results.reviewProblem")}{toProblems}</li>);
  // Review fix 2: while the read loads or after it failed, the summary's count stands in; a failed read says so.
  if (props.decisionsFailed !== null) waiting.push(<li key="decisions-failed">{t("control.results.decisionsUnread", { code: props.decisionsFailed })}</li>);
  const pending = props.decisions?.pendingCount ?? summary.card?.pendingDecisions ?? 0;
  const decisionTask = props.decisions?.tasks.find((task) => task.runs.some(runNeedsHuman))?.taskId;
  if (pending > 0) waiting.push(
    <li key="decisions">{t("control.results.decisions", { count: pending })}
      {decisionTask !== undefined && go(t("control.results.openTask", { taskId: decisionTask }), () => props.onOpenTask(decisionTask))}</li>);
  // Re-review Minor 1: a failed decisions read says nothing about what waits, so it does not stand in for the fallback.
  if (summary.needsYou === true && waiting.every((item) => item.key === "decisions-failed")) waiting.push(<li key="needs-you">{t("control.results.needsYou")}{toProblems}</li>);
  // Re-review ruling: "Waiting for you" claims no more than the server's needs-you, so the merge Orca leaves to the person
  // (this panel has no button for it, GitScheme, board spec C4) is said under the delivery sentence: a finished keep or
  // push-branch group, and a github-pr group once its pull request is marked ready.
  const merge = folders ? null
    : summary.state === "done" && scheme.delivery === "keep" ? t("control.results.mergeYours", { branch })
    : summary.state === "done" && scheme.delivery === "push-branch" ? t("control.results.mergePushed", { branch, target: scheme.target, remote: scheme.remote })
    : scheme.delivery === "github-pr" && pr !== null && pr.ready ? t("control.results.mergePr", { number: pr.number })
    : null;
  // Tester #365(a): a kept delivery's files are on the work branch only; say so, and how to list and take them.
  const kept = !folders && summary.state === "done" && scheme.delivery === "keep";

  return (
    <section aria-label={t("control.results.conclusion")} data-testid="results-conclusion" className="detail-block min-w-0 wrap-anywhere">
      <h3>{t("control.results.conclusion")}</h3>
      <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 max-md:grid-cols-1 [&_dd]:m-0 [&_dd]:min-w-0 [&_dt]:text-muted">
        <dt>{t("control.results.done")}</dt>
        <dd data-conclusion="done">
          {completion === undefined ? t("control.results.doneUnread") : t("control.results.doneCount", completion)}
          {" · "}
          {t("control.results.acceptance", { result: t(`control.results.acceptanceResult.${summary.acceptance?.result ?? "not-run"}`) })}
        </dd>
        <dt>{t("control.results.delivery")}</dt>
        <dd data-conclusion="delivery">
          <span data-conclusion="delivery-sentence">{delivery}</span>
          {pr !== null && <>{" · "}{PR_URL.test(pr.url) ? <a href={pr.url}>{prLabel}</a> : prLabel}</>}
          {merge !== null && <span className="block" data-conclusion="merge">{merge}</span>}
          {kept && <>
            <span className="block" data-conclusion="kept">{tip === null ? t("control.results.keptOn", { branch }) : t("control.results.keptOnTip", { branch, tip: short(tip) })}</span>
            <span className="block" data-conclusion="kept-take">{t("control.results.keptTake", { branch, groupId: summary.groupId })}</span>
          </>}
        </dd>
        <dt>{t("control.results.waiting")}</dt>
        <dd data-conclusion="waiting">
          {waiting.length === 0 ? t("control.results.nothing") : <ul className="m-0 grid list-none gap-1 p-0">{waiting}</ul>}
        </dd>
        {!folders && <>
          <dt>{t("control.results.artifact")}</dt>
          <dd data-conclusion="artifact">
            <code>{branch}</code>{" "}
            <button type="button" data-no-command className="btn-quiet px-1 text-xs" onClick={() => copy(branch)}>{t("control.results.copyBranch")}</button>
            {" · "}
            {/* Review fix 4: a recorded acceptance without a tip is final ("no accepted tip"); only no record is "yet". */}
            {tip === null ? t(summary.acceptance === undefined ? "control.results.noTip" : "control.results.noAcceptedTip") : <>
              {t("control.results.tip")}{" "}<code title={tip}>{short(tip)}</code>{" "}
              <button type="button" data-no-command className="btn-quiet px-1 text-xs" onClick={() => copy(tip)}>{t("control.results.copyTip")}</button>
            </>}
          </dd>
        </>}
      </dl>
    </section>
  );
}
