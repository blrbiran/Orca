import {useTranslation} from "react-i18next";
/**
 * Issue fixes spec §4.2(5), §2.2(a): a run's reason, explained in the reader's language, with the raw reason beside it
 * (monospace) -- ccloop's own for a failed run, else the driver's blocked reason. Nothing for a run with neither.
 */
import type { JSX } from "react";
import type { RunViewV1 } from "./controlTypes.js";
import { codedNextStep } from "./ccloopCodes.js";
import { explainRunReason } from "./refusalExplain.js";
import { hasFailureOutcome, reasonCode, runReasonText } from "./runFacts.js";

/** Failure-cause spec 2026-10-21 §5: the causes this panel words; any other (a newer ccloop's) reads as `unknown`. */
export const KNOWN_FAILURE_CAUSES = ["auth", "quota", "rate-limited", "provider-5xx", "network", "context-overflow", "stalled", "executable-missing",
  "required-check-failed", "verifier-rejected", "budget-exhausted", "tool-rule-violated", "setup-failed", "unknown"] as const;
export type KnownFailureCause = typeof KNOWN_FAILURE_CAUSES[number];
export const knownCause = (cause: string): KnownFailureCause => (KNOWN_FAILURE_CAUSES as readonly string[]).includes(cause) ? cause as KnownFailureCause : "unknown";

/** Task setup and check retry spec 2026-11-04 §4.7: why the ladder left a run out (its `ladder-skipped` activity row). */
export type LadderSkipReason = "setup-failed" | "could-not-run" | "authored-budget-exhausted" | "retry-funding-missing";
/** The causes whose next step says Orca escalates the run itself -- untrue once the ladder left the run out. */
const ESCALATING_CAUSES: ReadonlySet<KnownFailureCause> = new Set(["required-check-failed", "verifier-rejected"]);

/**
 * `ladderSkipped`: the run's `ladder-skipped` reason, when the caller read one (the task page). Final-review fix wave
 * (minor 1): a cause whose next step promises an automatic escalation says the skip sentence instead.
 */
export function RunReason(props: { run: RunViewV1; ladderSkipped?: LadderSkipReason }): JSX.Element | null {
  const {t}=useTranslation();const lineage=props.run.recoveryOf?<> · {t("control.savedResult.lineage",{runId:props.run.recoveryOf.sourceRunId,attempt:props.run.recoveryOf.sourceAttempt})}</>:null;
  if(props.run.savedResultOrdinaryRetry||props.run.outcome==="not-started")return <>{lineage} — {t("control.savedResult.notDispatched")}</>;
  const raw = runReasonText(props.run);
  if (raw === null && props.run.failureCode === null && !hasFailureOutcome(props.run)
    && !["blocked", "settled-failed", "failed-before-provider"].includes(props.run.state)) return lineage;
  const diagnosis = props.run.diagnosis ?? { phase: props.run.phase, step: null, cause: "unknown" as const, attempt: props.run.providerAttemptOrdinal };
  const phase = t(`control.diagnosis.phase.${diagnosis.phase}`);
  const cause = t(`control.diagnosis.cause.${diagnosis.cause}`);
  const next = t(`control.diagnosis.next.${diagnosis.cause}`);
  const text = raw === null ? null : explainRunReason(reasonCode(raw));
  // ccloop's typed cause, when it stated one, with what to do next (en/zh); the raw reason stays beside it.
  const failure = props.run.failureCause ?? null, causeKey = knownCause(failure?.cause ?? "unknown");
  // Issue #60: under an unknown (or unstated) cause, a ccloop code the panel has words for names the next step itself.
  const coded = causeKey === "unknown" ? codedNextStep(raw, props.run.failureCode) : null;
  const skipped = props.ladderSkipped !== undefined && ESCALATING_CAUSES.has(causeKey) ? t(`control.ladder.skipped.${props.ladderSkipped}`) : null;
  // Final-review fix wave (I4): a setup failure's detail (ccloop's words for which command failed and how) follows its line.
  const setupDetail = causeKey === "setup-failed" && failure?.detail ? <>{" "}<code>{failure.detail}</code></> : null;
  const causeLine = failure === null && coded === null ? null : <span>{t("control.failureCause.line", { cause: t(`control.failureCause.label.${causeKey}`), next: coded ?? skipped ?? t(`control.failureCause.next.${causeKey}`) })}{failure !== null && failure.retries > 0 && t("control.failureCause.retries", { retries: failure.retries })}{setupDetail} </span>;
  // Quota failover spec 2026-11-03 §3 (session 3cfc2e73, batch FB): the run was not switched and its installation rests --
  // until the vendor's named reset, or the default rest's end.
  const rest = props.run.quotaRest;
  const restLine = rest === undefined ? null : <span data-testid="run-quota-rest">{t(`control.quotaRest.${rest.source}`, { installation: rest.installation, time: new Date(rest.until).toLocaleString() })} </span>;
  return <>{lineage} — {causeLine}{restLine}<span>{t("control.diagnosis.phaseLabel", { phase })}{diagnosis.step && ` · ${t("control.diagnosis.stepLabel", { step: t(`control.diagnosis.step.${diagnosis.step}`) })}`} · {t("control.diagnosis.attempt", { attempt: diagnosis.attempt })} · {cause}. {next}</span> {t("control.diagnosis.identity", { runId: props.run.runId })}{raw !== null && <> · {text !== null && `${text} `}<code>{raw}</code></>}{props.run.failureCode !== null && <>{" · "}<code>{props.run.failureCode}</code></>}<FormatFailureWorkLines work={props.run.diagnosis?.formatFailureWork} /></>;
}

type FormatFailureWork = NonNullable<NonNullable<RunViewV1["diagnosis"]>["formatFailureWork"]>;
const block = { display: "block" } as const;

/**
 * Session 3cfc2e73 D7 (#158): an omp execute format failure's work survives only under ccloop's attempt refs; each ref, what
 * it changed against the attempt's base, and the git command to see it, so a person can take the work by hand (the same
 * facts `orca run show` prints). Spans, not blocks: the reason renders inside a paragraph or a table cell.
 */
function FormatFailureWorkLines(props: { work: FormatFailureWork | undefined }): JSX.Element | null {
  const { t } = useTranslation();
  const work = props.work;
  if (work === undefined) return null;
  const base = work.attemptBase;
  return <span data-testid="run-format-failure-work" style={block}>
    <span style={block}>{t("control.formatFailureWork.heading", { attempt: work.attempt, count: work.refs.length })}{base !== null && <> {t("control.formatFailureWork.base")} <code>{base.slice(0, 12)}</code></>}</span>
    {work.issues.map((issue, index) => <span key={`issue-${index}`} style={block}>{t("control.formatFailureWork.refused")} <code>{issue.path === "" ? t("control.formatFailureWork.topLevel") : issue.path}</code>: {issue.message}</span>)}
    {work.refs.map((ref) => <span key={ref.ref} style={block}>
      <code>{ref.ref}</code>{ref.commit === null ? <> — {t("control.formatFailureWork.missing")}</> : <> = <code>{ref.commit.slice(0, 12)}</code> — {t("control.formatFailureWork.files", { count: ref.files.length, more: ref.filesMore ? "+" : "" })}
        {ref.stat.length > 0 && <code style={{ ...block, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{ref.stat.map((line) => line.trim()).join("\n")}</code>}
        {base !== null && <span style={block}>{t("control.formatFailureWork.seeIt")} <code>{["git", "diff", base.slice(0, 12), ref.ref].join(" ")}</code></span>}</>}
    </span>)}
  </span>;
}
