import { useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { Role } from "./auth.js";
import type { ControlAction } from "./controlApi.js";
import type { RunViewV1 } from "./controlTypes.js";

/** The server's bound on the note (webProtocol.ts abandonRunPayloadSchema). */
const NOTE_MAX = 2048;
/** The run states the server lets a person abandon (abandonRun.ts): not yet at the provider, or running. */
const ABANDONABLE = new Set(["starting", "start-pending", "accepted", "running"]);

/** Stuck-runs spec 2026-11-17 S2: an abandon request ccloop did not act on within the grace (driverHandoff.ts). */
export const abandonUnresolved = (run: RunViewV1): boolean => run.abandon?.unresolvedAt !== undefined && ABANDONABLE.has(run.state);

/**
 * Stuck-runs spec 2026-11-17 S2 (#344): "Abandon this attempt" -- an owner judged a running attempt worthless and ends it.
 * Said to everyone once requested (and, past the grace, that ccloop has not stopped it); offered to an owner on a work run
 * that is starting or running with no request yet. The server checks it all again and refuses by name. A danger-toned
 * confirm group with a note, as other owner acts with a note (AcceptAttempt.tsx).
 */
export function AbandonRun(props: { run: RunViewV1; roles?: readonly Role[]; archived: boolean; groupId: string; revision: number; onCommand: (action: ControlAction) => void }): JSX.Element | null {
  const { run } = props;
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  if (run.abandon !== undefined) {
    return <p role="status" data-tone={abandonUnresolved(run) ? "danger" : "warn"}>
      {t(abandonUnresolved(run) ? "control.abandonRun.unresolved" : "control.abandonRun.requested", { principal: run.abandon.by, note: run.abandon.note })}
    </p>;
  }
  const offered = !props.archived && props.roles?.includes("owner") === true && run.phase === "work" && run.taskId !== null
    && run.recoveryOf === undefined && ABANDONABLE.has(run.state);
  if (!offered) return null;
  const sendable = note.trim() !== "" && note.length <= NOTE_MAX;
  const send = (): void => {
    if (!sendable) return;
    props.onCommand({ verb: "abandon-run", groupId: props.groupId, expectedRevision: props.revision, payload: { runId: run.runId, note } });
    setOpen(false); setNote("");
  };
  if (!open) return <button type="button" onClick={() => setOpen(true)}>{t("control.abandonRun.open")}</button>;
  return (
    <div role="group" className="confirm-inline" data-tone="danger" aria-label={t("control.abandonRun.open")}>
      <p>{t("control.abandonRun.explain")}</p>
      <label>
        {t("control.abandonRun.note")}
        <textarea value={note} maxLength={NOTE_MAX} aria-invalid={note.length > NOTE_MAX} onChange={(event) => setNote(event.target.value)} />
      </label>
      <button type="button" disabled={!sendable} onClick={send}>{t("control.abandonRun.send")}</button>
      <button type="button" className="btn-quiet" onClick={() => { setOpen(false); setNote(""); }}>{t("control.abandonRun.cancel")}</button>
    </div>
  );
}
