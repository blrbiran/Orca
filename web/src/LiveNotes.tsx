import { useContext, useRef, useState, type JSX, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import type { ControlAction } from "./controlApi.js";
import type { GroupViewV1, LiveNoteViewV1 } from "./controlTypes.js";
import { utf8Bytes } from "./operatorNote.js";
import { RegionDrafts, useRegionDraft } from "./regionDraft.js";

/**
 * Tester follow-up G Part 5: the Live note box. A note joins the task's queue and reaches its agent at the next phase start
 * (plan, execute, verify), next attempt or continuation -- never mid-call. The server's bound is 1..2048 UTF-8 bytes
 * (addLiveNotePayloadSchema); a done task or an archived group takes none.
 */
export const LIVE_NOTE_MAX_BYTES = 2048;

/** A task's notes, in send order, each with where it is. */
export function LiveNoteList(props: { notes: readonly LiveNoteViewV1[]; running?: boolean }): JSX.Element | null {
  const { t } = useTranslation();
  if (props.notes.length === 0) return null;
  const state = (note: LiveNoteViewV1): string => note.state === "queued"
    ? t(props.running === true ? "control.liveNotes.queuedRunning" : "control.liveNotes.queuedWaiting")
    : note.state === "delivered" && note.delivered !== null
      ? t("control.liveNotes.delivered", { phase: note.delivered.phase, attempt: note.delivered.attempt })
      : t("control.liveNotes.undelivered");
  return <ul aria-label={t("control.liveNotes.list")}>
    {props.notes.map((note) => (
      <li key={note.noteId} data-note-state={note.state}>
        <span className="whitespace-pre-wrap">{note.text}</span>{" "}
        <span data-tone={note.state === "undelivered" ? "warn" : note.state === "delivered" ? "ok" : "info"}>({state(note)})</span>
      </li>
    ))}
  </ul>;
}

/**
 * The box under a task in Live: a textarea, its byte count, and Send note. Enter sends (when Send would), Shift+Enter is a
 * new line, and Enter while an input method is composing (isComposing, keyCode 229, or between compositionstart and
 * compositionend) only confirms the composition -- it never sends (#243).
 */
export function LiveNoteBox(props: { view: GroupViewV1; taskId: string; archived: boolean; pending?: boolean; unconfirmed?: boolean; onEdit?: () => void; onCommand: (action: ControlAction) => void | Promise<number | null> }): JSX.Element {
  const { t } = useTranslation();
  const draftKey = `live-note:${props.view.summary.groupId}:${props.taskId}`;
  const drafts = useContext(RegionDrafts);
  const [text, setText] = useRegionDraft(draftKey, () => "");
  const [sending, setSending] = useState(false);
  const [localUnconfirmed, setLocalUnconfirmed] = useState(false);
  const unconfirmed = props.unconfirmed ?? localUnconfirmed;
  const inFlight = useRef(false);
  const item = props.view.workItems.find((candidate) => candidate.taskId === props.taskId);
  const finished = item?.status === "completed";
  const reason = props.archived ? t("control.liveNotes.archived") : finished ? t("control.liveNotes.finished") : null;
  const bytes = utf8Bytes(text);
  const tooLarge = bytes > LIVE_NOTE_MAX_BYTES;
  const composing = useRef(false);
  const canSend = reason === null && text.length > 0 && !tooLarge && !sending && props.pending !== true && !unconfirmed;
  const send = async (): Promise<void> => {
    if (!canSend || inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setLocalUnconfirmed(false);
    const sent = text;
    try {
      const revision = await props.onCommand({ verb: "add-live-note", groupId: props.view.summary.groupId, taskId: props.taskId, expectedRevision: props.view.summary.commandRevision, payload: { text: sent } });
      if (typeof revision === "number") setText((current) => {
        const latest = drafts?.get(draftKey);
        return typeof latest === "string" && latest !== sent ? latest : current === sent ? "" : current;
      });
      else setLocalUnconfirmed(true);
    } catch {
      setLocalUnconfirmed(true);
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== "Enter" || event.shiftKey) return;
    if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    if (canSend) send();
  };
  return <div className="grid max-w-2xl gap-2" role="group" aria-label={t("control.liveNotes.title", { taskId: props.taskId })}>
    <textarea aria-label={t("control.liveNotes.text")} placeholder={t("control.liveNotes.placeholder")} value={text} disabled={reason !== null} readOnly={reason !== null}
      aria-invalid={tooLarge} onChange={(event) => { setText(event.currentTarget.value); setLocalUnconfirmed(false); props.onEdit?.(); }} onKeyDown={onKeyDown}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} />
    <p>{t("control.liveNotes.hint")}</p>
    <p className="num">{t("control.liveNotes.bytes", { bytes, max: LIVE_NOTE_MAX_BYTES })}</p>
    {tooLarge && <p data-tone="warn" role="status">{t("control.liveNotes.tooLarge")}</p>}
    {unconfirmed && <p data-tone="warn" role="status">{t("control.liveNotes.unconfirmed")}</p>}
    {reason !== null && <p role="note">{reason}</p>}
    <div><button type="button" disabled={!canSend} onClick={send}>{t("control.liveNotes.send")}</button></div>
  </div>;
}
