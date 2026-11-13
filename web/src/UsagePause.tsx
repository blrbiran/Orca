/**
 * Tester follow-up G spec §2.3-§2.5 (Part B, O6): a task's budget state in an expectation-model group, in the task detail.
 * Over its expectation is an amber hint only (nothing stops). A task at its pause line waits for a person or an
 * orchestrating agent: Continue (to the next line, with an optional note its agent reads) or Stop. A task at the group cap
 * waits for a top-up. A person's hard cap is named, so nobody looks for a pause line it does not have.
 */
import { useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { ControlAction } from "./controlApi.js";
import type { WorkItemViewV1 } from "./controlTypes.js";
import { shortTokens } from "./TokenInput.js";

const ratioText = (used: number, expected: number | null): string | null => (expected === null || expected === 0 ? null : (Math.round((used / expected) * 10) / 10).toFixed(1));

export function UsagePause(props: { groupId: string; revision: number; item: WorkItemViewV1; onCommand: (action: ControlAction) => void | Promise<number | null>; archived: boolean }): JSX.Element | null {
  const { t } = useTranslation();
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const state = props.item.budgetState;
  if (state === undefined) return null;
  const decide = (decision: "continue" | "stop"): void => {
    if (sending) return;
    const text = note.trim();
    const answer = props.onCommand({ verb: "usage-pause-decide", groupId: props.groupId, taskId: props.item.taskId, expectedRevision: props.revision,
      payload: { decision, ...(decision === "continue" && text !== "" ? { note: { text, scope: "next-attempt" as const } } : {}) } });
    if (answer === undefined) return;
    setSending(true);
    void answer.finally(() => setSending(false));
  };
  const pause = state.usagePause;
  return (
    <div data-testid={`usage-pause-${props.item.taskId}`}>
      {state.hardCapTokens !== null && <p className="detail-note num" data-testid="budget-hard-cap">{t("control.budgetState.hardCap", { tokens: shortTokens(state.hardCapTokens) })}</p>}
      {state.overExpectation !== null && pause === null && (
        <p className="detail-note num" data-tone="warn" data-testid="budget-over-expectation">
          {t("control.budgetState.overExpectation", { used: shortTokens(state.overExpectation.usedTokens), expected: shortTokens(state.overExpectation.expectationTokens), ratio: ratioText(state.overExpectation.usedTokens, state.overExpectation.expectationTokens) ?? "?" })}
        </p>
      )}
      {pause !== null && (
        <div role="group" aria-label={t("control.budgetState.waiting")} data-testid="budget-waiting-decision">
          <p className="detail-note num" data-tone="warn">
            {t("control.budgetState.waitingLine", { used: shortTokens(pause.usedTokens), ratio: ratioText(pause.usedTokens, pause.expectationTokens) ?? "?" })}
          </p>
          {/* Tester #295 residue (follow-up K): continue starts this task afresh; its partial work is discarded. */}
          {pause.restartsFresh === true && <p className="detail-note" data-tone="warn" data-testid="budget-restarts-fresh">{t("control.budgetState.restartsFresh")}</p>}
          {!props.archived && (
            <>
              <input aria-label={t("control.budgetState.note")} placeholder={t("control.budgetState.note")} value={note} onChange={(event) => setNote(event.target.value)} disabled={sending} />
              <button type="button" className="btn" disabled={sending} onClick={() => decide("continue")}>{t("control.budgetState.continue")}</button>
              <button type="button" className="btn-quiet" disabled={sending} onClick={() => decide("stop")}>{t("control.budgetState.stop")}</button>
            </>
          )}
        </div>
      )}
      {state.groupCapStop !== null && <p className="detail-note num" data-tone="warn" data-testid="budget-group-cap">{t("control.budgetState.groupCap", { used: shortTokens(state.groupCapStop.observedTokens) })}</p>}
      {state.usageStopped !== null && <p className="detail-note" data-testid="budget-usage-stopped">{t("control.budgetState.stopped", { principal: state.usageStopped.principal })}</p>}
    </div>
  );
}
