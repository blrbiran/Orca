import { useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { ControlAction } from "./controlApi.js";
import type { RequirementReviewV1 } from "./controlTypes.js";

const bytes = (text: string): number => new TextEncoder().encode(text).length;
type Exit = "review-accept" | "review-rerun" | "review-fix";
/** The server's bounds (webProtocol.ts reviewNotePayloadSchema, reviewFixPayloadSchema). */
const BOUND: Record<Exit, number> = { "review-accept": 2048, "review-rerun": 2048, "review-fix": 4096 };

/**
 * Tester follow-up G spec §3.3, §3.5: a requirement group's review -- where it stands, and for the latest round each
 * acceptance criterion's verdict with its evidence or what is missing. A review that did not pass offers its three exits
 * to a person and an orchestrating agent alike (the server checks again): accept as is, re-run with a note, fix by hand.
 * Nothing is offered on an archived group.
 */
export function RequirementReviewPanel(props: { groupId: string; review: RequirementReviewV1 | undefined; archived: boolean; revision: number; onCommand: (action: ControlAction) => void }): JSX.Element | null {
  const { t } = useTranslation();
  const [open, setOpen] = useState<Exit | null>(null);
  const [text, setText] = useState("");
  const review = props.review;
  if (review === undefined) return null;
  const last = review.rounds.at(-1);
  const sendable = open !== null && text.trim() !== "" && bytes(text) <= BOUND[open];
  const send = (): void => {
    if (open === null || !sendable) return;
    const base = { groupId: props.groupId, expectedRevision: props.revision };
    props.onCommand(open === "review-fix" ? { verb: open, ...base, payload: { goal: text } } : { verb: open, ...base, payload: { note: text } });
    setOpen(null); setText("");
  };
  return (
    <section data-requirement-review={props.groupId} aria-label={t("control.review.heading")}>
      <h4>{t("control.review.heading")}</h4>
      <p data-tone={review.state === "not-passed" ? "danger" : review.state === "passed" || review.state === "accepted" ? "ok" : "info"}>
        {t(`control.review.state.${review.state}`)}{review.problem !== undefined && <> <code>{review.problem}</code></>}
      </p>
      {review.accepted !== undefined && <p>{t("control.review.acceptedBy", { by: review.accepted.by, note: review.accepted.note })}</p>}
      {last !== undefined && last.criteria.length > 0 && (
        <ul aria-label={t("control.review.criteria")}>
          {last.criteria.map((c) => (
            <li key={c.id} data-verdict={c.verdict}>
              <code>{c.id}</code> {t(`control.review.verdict.${c.verdict}`)}
              {c.missing !== null && <> — {c.missing}</>}
              {c.evidence.length > 0 && <> ({c.evidence.map((e) => (e.line === null ? e.path : `${e.path}:${e.line}`)).join(", ")})</>}
            </li>
          ))}
        </ul>
      )}
      {last !== undefined && last.summary !== "" && <p className="detail-note">{last.summary}</p>}
      {review.state === "not-passed" && !props.archived && (open === null ? (
        <>
          <button type="button" onClick={() => setOpen("review-fix")}>{t("control.review.fix")}</button>
          <button type="button" onClick={() => setOpen("review-rerun")}>{t("control.review.rerun")}</button>
          <button type="button" onClick={() => setOpen("review-accept")}>{t("control.review.accept")}</button>
        </>
      ) : (
        <div role="group" aria-label={t(`control.review.${open === "review-fix" ? "fix" : open === "review-rerun" ? "rerun" : "accept"}`)}>
          <label>
            {t(open === "review-fix" ? "control.review.goal" : "control.review.note")}
            <textarea value={text} aria-invalid={open !== null && bytes(text) > BOUND[open]} onChange={(event) => setText(event.target.value)} />
          </label>
          <button type="button" disabled={!sendable} onClick={send}>{t("control.review.send")}</button>
          <button type="button" className="btn-quiet" onClick={() => { setOpen(null); setText(""); }}>{t("control.review.cancel")}</button>
        </div>
      ))}
    </section>
  );
}
