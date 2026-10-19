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
import { MinorToggle, isMinor, visibleByImportance } from "./MinorToggle.js";

type DecisionRun = GroupDecisionsViewV1["tasks"][number]["runs"][number];
/** A group's decisions as the page last read them, or the code its read failed with (fix round 1, Rule 12). */
export type GroupDecisionsRead = GroupDecisionsViewV1 | { failed: string };
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

/**
 * Whether one of the run's refused decisions still waits for a person. Reported-decisions spec 2026-10-20 §6
 * (goal.md §1.3): a minor one does not demand attention -- like the group's pendingCount -- but stays confirmable.
 */
export const runNeedsHuman = (run: DecisionRun): boolean => run.pending.some((item) => item.state === "pending" && !isMinor(item));

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
  // Reported-decisions spec 2026-10-20 §6: each list shows its major entries and holds the minor ones behind its own control.
  const [showMinor, setShowMinor] = useState({ pending: false, decisions: false, unlanded: false });
  const toggle = (list: keyof typeof showMinor) => (next: boolean) => setShowMinor((current) => ({ ...current, [list]: next }));
  const pending = visibleByImportance(run.pending, showMinor.pending);
  const decisions = visibleByImportance(run.decisions, showMinor.decisions);
  const unlanded = visibleByImportance(run.unlanded, showMinor.unlanded);
  const reportedLine = !run.settled ? "control.decisions.notSettled"
    : run.reported === "absent" ? "control.decisions.notReported"
    : run.reported === "malformed" ? "control.decisions.malformed"
    : run.reported === "unreadable" ? "control.decisions.unreadable"
    : null;
  return (
    <section aria-label={t("control.decisions.region", { runId: run.runId })}>
      <h5>{t("control.decisions.region", { runId: run.runId })}</h5>
      {reportedLine !== null && <p>{t(reportedLine)}</p>}
      {pending.length > 0 && (
        <ul>
          {pending.map((item) => (
            <PendingRow key={item.pendingId} item={item} groupId={props.groupId} revision={props.revision} onCommand={props.onCommand} archived={props.archived} />
          ))}
        </ul>
      )}
      <MinorToggle entries={run.pending} showMinor={showMinor.pending} onToggle={toggle("pending")} copy="control.decisions" list="pending" />
      {decisions.length > 0 && (
        <ul>
          {decisions.map((decision) => {
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
      <MinorToggle entries={run.decisions} showMinor={showMinor.decisions} onToggle={toggle("decisions")} copy="control.decisions" list="decisions" />
      {run.unlanded.length > 0 && (
        <>
          <h5>{t("control.decisions.unlanded")}</h5>
          {unlanded.length > 0 && (
            <ul aria-label={t("control.decisions.unlanded")}>
              {unlanded.map((entry) => <li key={entry.entryIndex}>{pair(entry.question, entry.chose)}</li>)}
            </ul>
          )}
          <MinorToggle entries={run.unlanded} showMinor={showMinor.unlanded} onToggle={toggle("unlanded")} copy="control.decisions" list="unlanded" />
        </>
      )}
    </section>
  );
}
