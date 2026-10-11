import {useTranslation} from "react-i18next";
/**
 * Issue fixes spec §4.2(5), §2.2(a): a run's reason, explained in the reader's language, with the raw reason beside it
 * (monospace) -- ccloop's own for a failed run, else the driver's blocked reason. Nothing for a run with neither.
 */
import type { JSX } from "react";
import type { RunViewV1 } from "./controlTypes.js";
import { explainRunReason } from "./refusalExplain.js";
import { reasonCode, runReasonText } from "./runFacts.js";

export function RunReason(props: { run: RunViewV1 }): JSX.Element | null {
  const {t}=useTranslation();const lineage=props.run.recoveryOf?<> · {t("control.savedResult.lineage",{runId:props.run.recoveryOf.sourceRunId,attempt:props.run.recoveryOf.sourceAttempt})}</>:null;
  if(props.run.savedResultOrdinaryRetry||props.run.outcome==="not-started")return <>{lineage} — {t("control.savedResult.notDispatched")}</>;
  const raw = runReasonText(props.run);
  if (raw === null && props.run.failureCode === null && props.run.state !== "blocked") return lineage;
  const diagnosis = props.run.diagnosis ?? { phase: props.run.phase, step: null, cause: "unknown" as const, attempt: props.run.providerAttemptOrdinal };
  const phase = t(`control.diagnosis.phase.${diagnosis.phase}`);
  const cause = t(`control.diagnosis.cause.${diagnosis.cause}`);
  const next = t(`control.diagnosis.next.${diagnosis.cause}`);
  const text = raw === null ? null : explainRunReason(reasonCode(raw));
  return <>{lineage} — <span>{t("control.diagnosis.phaseLabel", { phase })}{diagnosis.step && ` · ${t("control.diagnosis.stepLabel", { step: t(`control.diagnosis.step.${diagnosis.step}`) })}`} · {t("control.diagnosis.attempt", { attempt: diagnosis.attempt })} · {cause}. {next}</span> {t("control.diagnosis.identity", { runId: props.run.runId })}{raw !== null && <> · {text !== null && `${text} `}<code>{raw}</code></>}{props.run.failureCode !== null && <>{" · "}<code>{props.run.failureCode}</code></>}</>;
}
