import { useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { Role } from "./auth.js";
import type { ControlAction } from "./controlApi.js";
import type { RunViewV1, WorkItemViewV1 } from "./controlTypes.js";
import { hasFailureOutcome } from "./runFacts.js";

/** The server's bound on the note (webProtocol.ts acceptAttemptPayloadSchema). */
const NOTE_MAX = 2048;

/**
 * Reviewed acceptance (spec 2026-11-11 §7, #227): where an owner's acceptance of this run's attempt stands, said to everyone,
 * and for an owner the way to ask for one. It is offered only where the server could accept it (acceptAttempt.ts): a work
 * run that ended in a failure, whose accounting is settled, that is still the task's current run while the task is blocked
 * on it, with no acceptance pending or landed. The server checks all of it again and refuses by name.
 */
export function AcceptAttempt(props: { run: RunViewV1; item: WorkItemViewV1; roles?: readonly Role[]; archived: boolean; groupId: string; revision: number; onCommand: (action: ControlAction) => void }): JSX.Element | null {
  const { run, item } = props;
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const recorded = run.operatorAcceptance;
  const state = recorded === undefined ? null : (
    <p role="status" data-tone={recorded.state === "pending" ? "info" : recorded.state === "landed" ? "ok" : "danger"}>
      {recorded.state === "pending" ? t("control.acceptAttempt.pending", { principal: recorded.principal, note: recorded.note })
        : recorded.state === "landed" ? t("control.acceptAttempt.landed", { principal: recorded.principal, commit: recorded.landedCommit ?? "", note: recorded.note })
        : t("control.acceptAttempt.refused", { principal: recorded.principal, reason: recorded.reason ?? "", note: recorded.note })}
    </p>
  );
  const offered = !props.archived && props.roles?.includes("owner") === true && run.phase === "work" && run.recoveryOf === undefined
    && run.state === "settled-failed" && hasFailureOutcome(run) && run.runId === item.currentRunId && item.status === "blocked"
    && (recorded === undefined || recorded.state === "refused");
  if (!offered) return state;
  const sendable = note.trim() !== "" && note.length <= NOTE_MAX;
  // #227 residual: the server names the checks the driver will run (any task kind) and the attempt's diff; a view without
  // the field (an older server) falls back to the loop plan's checks, as before.
  const review = run.attemptReview;
  const checks = review?.requiredChecks ?? item.loopPlan?.inputs.checks ?? [];
  const send = (): void => {
    if (!sendable) return;
    props.onCommand({ verb: "accept-attempt", groupId: props.groupId, expectedRevision: props.revision, payload: { taskId: item.taskId, runId: run.runId, note } });
    setOpen(false); setNote("");
  };
  return (
    <div>
      {state}
      {!open ? <button type="button" onClick={() => setOpen(true)}>{t("control.acceptAttempt.open")}</button> : (
        <div role="group" aria-label={t("control.acceptAttempt.open")}>
          <p>{t("control.acceptAttempt.explain")}</p>
          {review !== undefined && (
            <div data-testid="accept-attempt-diff">
              <p>{t("control.acceptAttempt.diffHeading")}</p>
              {review.diff === null ? <p>{t("control.acceptAttempt.diffReading")}</p> : <>
                <p className="num">{review.diff.shortstat}</p>
                <pre className="num">{review.diff.stat.join("\n")}</pre>
              </>}
            </div>
          )}
          {(review?.setupCommands.length ?? 0) > 0 && (
            <>
              <p>{t("control.acceptAttempt.setupHeading")}</p>
              <ul aria-label={t("control.acceptAttempt.setupHeading")}>{review!.setupCommands.map((command) => <li key={command}><code>{command}</code></li>)}</ul>
            </>
          )}
          {checks.length > 0 && (
            <>
              <p>{t("control.acceptAttempt.checksHeading")}</p>
              <ul aria-label={t("control.acceptAttempt.checksHeading")}>{checks.map((check) => <li key={check}><code>{check}</code></li>)}</ul>
            </>
          )}
          {review !== undefined && checks.length === 0 && <p role="note" data-tone="warn">{t("control.acceptAttempt.noChecks")}</p>}
          <label>
            {t("control.acceptAttempt.note")}
            <textarea value={note} maxLength={NOTE_MAX} aria-invalid={note.length > NOTE_MAX} onChange={(event) => setNote(event.target.value)} />
          </label>
          <button type="button" disabled={!sendable} onClick={send}>{t("control.acceptAttempt.send")}</button>
          <button type="button" className="btn-quiet" onClick={() => { setOpen(false); setNote(""); }}>{t("control.acceptAttempt.cancel")}</button>
        </div>
      )}
    </div>
  );
}
