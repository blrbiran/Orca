/**
 * Control run decisions plan Task 11: one run's decisions, as GET /api/control/groups/:groupId/decisions read them.
 *
 * A decision a landing refused waits for a person (goal.md §1.1): its undo.how field starts as the agent's, the person
 * may change it, and Approve sends what the field holds; Reject sends the person's line only when there is one (the
 * server's schema refuses an empty `because`). 纠正 opens the correction only for a decision in the checked-out working
 * tree of a known project, the only place the corrections flow can find it; anywhere else the button stays, disabled,
 * with a note saying why. A settled run that reported nothing says so in so many words (§3.1); an unsettled run may
 * still report, so it says only that its decisions are not final.
 */
import { useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { ControlAction } from "./controlApi.js";
import type { GroupDecisionsViewV1 } from "./controlTypes.js";

type DecisionRun = GroupDecisionsViewV1["tasks"][number]["runs"][number];
type PendingItem = DecisionRun["pending"][number];

export interface RunDecisionsProps {
  groupId: string;
  revision: number;
  run: DecisionRun;
  projectKey: string | null;
  onCommand: (action: ControlAction) => void;
  onCorrect?: (projectKey: string, decisionId: string) => void;
  archived: boolean;
}

const pair = (question: string | null, chose: string | null): string => `${question ?? "—"} → ${chose ?? "—"}`;

/** Whether one of the run's refused decisions still waits for a person. */
export const runNeedsHuman = (run: DecisionRun): boolean => run.pending.some((item) => item.state === "pending");

/** The badge a pending item, its task and its group carry (DESIGN.md: needs-action is warn). */
export function NeedsHumanBadge(props: { testId?: string }): JSX.Element {
  const { t } = useTranslation();
  return <span className="badge" data-tone="warn" data-testid={props.testId}>{t("control.decisions.needsHuman")}</span>;
}

function PendingRow(props: { item: PendingItem; groupId: string; revision: number; onCommand: (action: ControlAction) => void; archived: boolean }): JSX.Element {
  const { item, groupId, revision, onCommand, archived } = props;
  const { t } = useTranslation();
  const [undoHow, setUndoHow] = useState(item.undoHow ?? "");
  const [because, setBecause] = useState("");
  const open = item.state === "pending";
  const line = because.trim();
  return (
    <li aria-label={item.pendingId}>
      {open ? <NeedsHumanBadge /> : <span>{t(item.state === "approved" ? "control.decisions.approved" : "control.decisions.rejected")}</span>}{" "}
      {pair(item.question, item.chose)}
      <p className="detail-note">{t("control.decisions.reason", { reason: item.reason })}</p>
      {open && (
        <>
          <label>
            {t("control.decisions.undoHowLabel")}
            <input value={undoHow} onChange={(event) => setUndoHow(event.target.value)} />
          </label>
          <button type="button" disabled={archived || undoHow.trim() === ""}
            onClick={() => onCommand({ verb: "approve-pending-decision", groupId, expectedRevision: revision, payload: { pendingId: item.pendingId, undoHow: undoHow.trim() } })}>
            {t("control.decisions.approve")}
          </button>
          <label>
            {t("control.decisions.rejectBecauseLabel")}
            <input value={because} onChange={(event) => setBecause(event.target.value)} />
          </label>
          <button type="button" disabled={archived}
            onClick={() => onCommand({ verb: "reject-pending-decision", groupId, expectedRevision: revision,
              payload: line === "" ? { pendingId: item.pendingId } : { pendingId: item.pendingId, because: line } })}>
            {t("control.decisions.reject")}
          </button>
        </>
      )}
    </li>
  );
}

export function RunDecisions(props: RunDecisionsProps): JSX.Element {
  const { run, projectKey } = props;
  const { t } = useTranslation();
  const reportedLine = !run.settled ? "control.decisions.notSettled"
    : run.reported === "absent" ? "control.decisions.notReported"
    : run.reported === "malformed" ? "control.decisions.malformed"
    : run.reported === "unreadable" ? "control.decisions.unreadable"
    : null;
  return (
    <section aria-label={t("control.decisions.region", { runId: run.runId })}>
      <h5>{t("control.decisions.region", { runId: run.runId })}</h5>
      {reportedLine !== null && <p>{t(reportedLine)}</p>}
      {run.pending.length > 0 && (
        <ul>
          {run.pending.map((item) => (
            <PendingRow key={item.pendingId} item={item} groupId={props.groupId} revision={props.revision} onCommand={props.onCommand} archived={props.archived} />
          ))}
        </ul>
      )}
      {run.decisions.length > 0 && (
        <ul>
          {run.decisions.map((decision) => {
            const correctable = decision.where === "working-tree" && projectKey !== null;
            return (
              <li key={decision.id} aria-label={decision.id}>
                <code>{decision.id}</code> {pair(decision.question, decision.chose)}
                {decision.where === "group-branch" && <> · {t("control.decisions.notIntegrated")}</>}{" "}
                <button type="button" disabled={!correctable}
                  onClick={() => { if (correctable) props.onCorrect?.(projectKey, decision.id); }}>
                  {t("control.decisions.correct")}
                </button>
                {!correctable && <p className="detail-note">{t("control.decisions.correctUnavailable")}</p>}
              </li>
            );
          })}
        </ul>
      )}
      {run.unlanded.length > 0 && (
        <>
          <h5>{t("control.decisions.unlanded")}</h5>
          <ul aria-label={t("control.decisions.unlanded")}>
            {run.unlanded.map((entry) => <li key={entry.entryIndex}>{pair(entry.question, entry.chose)}</li>)}
          </ul>
        </>
      )}
    </section>
  );
}
