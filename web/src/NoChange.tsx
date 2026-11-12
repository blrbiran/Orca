import { useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { ControlAction } from "./controlApi.js";
import type { RunViewV1, WorkItemViewV1 } from "./controlTypes.js";

/** The server's bound on the note, in UTF-8 bytes (webProtocol.ts noChangeNoteSchema). */
const NOTE_MAX_BYTES = 2048;
const bytes = (text: string): number => new TextEncoder().encode(text).length;
/** Tester follow-up G spec §10.1: the blocks a provable no change stops in (reopenTask.ts NO_CHANGE_BLOCKS). */
const NO_CHANGE_BLOCKS = ["no-change-twice", "no-change-judge-failed", "no-change-judge-unfunded", "no-change-not-met"];
export const noChangeBlocked = (reason: string | null | undefined): boolean =>
  typeof reason === "string" && NO_CHANGE_BLOCKS.some((block) => reason === block || reason.startsWith(`${block}:`));

/** Tester follow-up G spec §1.2: the "no change" marker of a task row; "2nd time" (and on) from the record's ordinal. */
export function NoChangeChip(props: { item: WorkItemViewV1 }): JSX.Element | null {
  const { t } = useTranslation();
  const record = props.item.noChangeCompletion;
  if (record === undefined) return null;
  return <span className="plan-chip" data-testid={`no-change-${props.item.taskId}`}> {record.ordinal > 1 ? t("control.noChange.chipNth", { n: record.ordinal }) : t("control.noChange.chip")}</span>;
}

/** A note box and its send button, for one of the two actions; disabled while the note is blank or over the bound. */
function NoteAction(props: { label: string; explain: string; onSend: (note: string) => void }): JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const sendable = note.trim() !== "" && bytes(note) <= NOTE_MAX_BYTES;
  if (!open) return <button type="button" onClick={() => setOpen(true)}>{props.label}</button>;
  return (
    <div role="group" aria-label={props.label}>
      <p>{props.explain}</p>
      <label>
        {t("control.noChange.note")}
        <textarea value={note} aria-invalid={bytes(note) > NOTE_MAX_BYTES} onChange={(event) => setNote(event.target.value)} />
      </label>
      <button type="button" disabled={!sendable} onClick={() => { if (!sendable) return; props.onSend(note); setOpen(false); setNote(""); }}>{t("control.noChange.send")}</button>
      <button type="button" className="btn-quiet" onClick={() => { setOpen(false); setNote(""); }}>{t("control.noChange.cancel")}</button>
    </div>
  );
}

/**
 * Tester follow-up G spec §1.2, §1.4, §10.1: on a task's run, the no-change record (who decided, why) and "Revoke and
 * re-run"; or, for a run stopped as a provable no change, "Accept as no change" and "Revoke and re-run". Open to a person
 * and an orchestrating agent alike (the server checks everything again); nothing on an archived group.
 */
export function NoChangeRecord(props: { run: RunViewV1; item: WorkItemViewV1; archived: boolean; groupId: string; revision: number; onCommand: (action: ControlAction) => void }): JSX.Element | null {
  const { run, item } = props;
  const { t } = useTranslation();
  const record = item.noChangeCompletion?.runId === run.runId ? item.noChangeCompletion : undefined;
  const stopped = run.runId === item.currentRunId && item.status === "blocked" && noChangeBlocked(run.blockedReason);
  if (record === undefined && !stopped) return null;
  const send = (verb: "reopen-task" | "accept-no-change") => (note: string) =>
    props.onCommand({ verb, groupId: props.groupId, expectedRevision: props.revision, payload: { taskId: item.taskId, runId: run.runId, note } });
  const reopen = <NoteAction label={t("control.noChange.reopen")} explain={t("control.noChange.reopenExplain")} onSend={send("reopen-task")} />;
  return (
    <div data-testid={`no-change-record-${run.runId}`}>
      {record !== undefined && (
        <p role="status" data-tone="info">
          {record.ordinal > 1 ? t("control.noChange.recordNth", { by: record.decidedBy, n: record.ordinal }) : t("control.noChange.record", { by: record.decidedBy })}
          {record.why !== null && <> — {record.why}</>}
        </p>
      )}
      {stopped && run.noChangeJudge?.finding !== undefined && <p>{t("control.noChange.finding", { finding: run.noChangeJudge.finding })}</p>}
      {!props.archived && (record !== undefined && run.runId === item.currentRunId && item.status === "completed" ? reopen : stopped ? (
        <>
          <NoteAction label={t("control.noChange.accept")} explain={t("control.noChange.acceptExplain")} onSend={send("accept-no-change")} />
          {reopen}
        </>
      ) : null)}
    </div>
  );
}
