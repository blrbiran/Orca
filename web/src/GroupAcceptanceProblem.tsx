import { useRegionDraft } from "./regionDraft.js";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { Role } from "./auth.js";
import type { ControlAction } from "./controlApi.js";
import type { GroupAcceptanceV1 } from "./controlTypes.js";

/** The server's bound on the note (webProtocol.ts waiveAcceptancePayloadSchema). */
const NOTE_MAX = 2048;

/**
 * Tester follow-up E §5 (#241): the Problems row of a group whose acceptance failed on its final tip -- its code, what
 * failed, the output tail; Recheck for anyone (a flaky check runs again on the same tip), Waive for an owner (accepts the
 * failed tip, with a note saying why). The server refuses both by name for an acceptance that has not failed.
 */
export function GroupAcceptanceProblem(props: { groupId: string; acceptance: GroupAcceptanceV1 | undefined; roles?: readonly Role[]; archived: boolean; revision: number; onCommand: (action: ControlAction) => void }): JSX.Element | null {
  const { t } = useTranslation();
  // Ruling R1 (#219): an unsent waiver note outlives a region switch (regionDraft.ts).
  const [open, setOpen] = useRegionDraft(`waive-open:${props.groupId}`, () => false);
  const [note, setNote] = useRegionDraft(`waive-note:${props.groupId}`, () => "");
  const acceptance = props.acceptance;
  // Tester #278: a work branch that no longer exists is recorded, not retried; a new landing checks it again.
  if (acceptance?.result === "not-run" && acceptance.why === "work-branch-missing") {
    return <p role="note" data-acceptance-branch-missing={props.groupId}>{t("control.groupAcceptance.branchMissing", { branch: `orca/${props.groupId}` })}</p>;
  }
  if (acceptance === undefined || acceptance.result !== "failed") return null;
  const last = acceptance.commands.at(-1);
  const sendable = note.trim() !== "" && note.length <= NOTE_MAX;
  const send = (): void => {
    if (!sendable) return;
    props.onCommand({ verb: "waive-acceptance", groupId: props.groupId, expectedRevision: props.revision, payload: { note } });
    setOpen(false); setNote("");
  };
  return (
    <div data-problem-acceptance={props.groupId}>
      <p data-tone="danger"><code>{acceptance.problem ?? ""}</code></p>
      <p>{t("control.groupAcceptance.failed", { command: last?.command ?? "?", exit: last?.exit ?? "?", tip: (acceptance.tip ?? "").slice(0, 12) })}</p>
      {acceptance.tail !== undefined && <pre className="whitespace-pre-wrap">{acceptance.tail}</pre>}
      {!props.archived && (
        <>
          <button type="button" onClick={() => props.onCommand({ verb: "recheck-acceptance", groupId: props.groupId, expectedRevision: props.revision, payload: {} })}>
            {t("control.groupAcceptance.recheck")}
          </button>
          {props.roles?.includes("owner") === true && (!open ? <button type="button" onClick={() => setOpen(true)}>{t("control.groupAcceptance.waive")}</button> : (
            <div role="group" aria-label={t("control.groupAcceptance.waive")}>
              <p>{t("control.groupAcceptance.waiveExplain")}</p>
              <label>
                {t("control.groupAcceptance.note")}
                <textarea value={note} maxLength={NOTE_MAX} onChange={(event) => setNote(event.target.value)} />
              </label>
              <button type="button" disabled={!sendable} onClick={send}>{t("control.groupAcceptance.send")}</button>
              <button type="button" className="btn-quiet" onClick={() => { setOpen(false); setNote(""); }}>{t("control.groupAcceptance.cancel")}</button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
