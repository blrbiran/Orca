/**
 * spec section 4.1's detail pane: the reasoning a `DecisionListRow` withholds
 * on purpose (src/panel/listProjection.ts). Unlike the list, this component
 * DOES render `question` / `chose` / `because` and every alternative -- that
 * is the whole point of opening a decision.
 *
 * task 8 ruling K7: `onAgree` / `onCorrect` are the only interaction this
 * component has, and neither has a frontend criterion here -- Task 9's
 * end-to-end run covers the HTTP side. They stay thin: App.tsx wires them
 * straight to `web/src/api.ts`'s `recordReview` / `recordCorrection`.
 *
 * *** ERRATUM (2026-09-16, run orca-dev-5d5c8055, final review of E3, ruling R66) ***
 * `Correct` was a bare button that App.tsx posted with `because: ""`, which
 * correctionSchema refuses every time -- the button could never record a
 * correction. It is now a form: `kind` (every correction kind), `because`
 * (required) and `chose_instead` (optional). The form hands `onCorrect` the
 * boxes as typed; `correctionBody` (web/src/api.ts) decides what is sent.
 *
 * *** ERRATUM (2026-09-27, session f8281a60, human ruling U1) ***
 * The first paragraph is no longer true of `question`: the list row now carries it
 * (panel UI redesign spec §2). `chose`, `because` and the alternatives are still
 * withheld from the list and appear only here. Text above kept verbatim.
 *
 * *** ERRATUM (2026-10-18, session b304f167, decisions review withdraw spec §7) ***
 * `onAgree` / `onCorrect` are no longer the only interaction: with `review` (GET /api/decision's review state) the
 * detail lists who has it reviewed and every correction on it, and offers `onWithdrawReview` / `onWithdrawCorrection`
 * exactly where the server would accept them. Agree stays the one primary, disabled once the viewer has it reviewed.
 */
import { useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { CorrectionForm, DecisionReviewState } from "./api.js";
import { enumText } from "./i18n.js";
import { en } from "./locales/en.js";
import { WEB_CORRECTION_KINDS } from "./types.js";
import { actionsBox, detailHelp } from "./ui/classes.js";
import type { CorrectionKind } from "./types.js";

export interface DecisionAlternative {
  option: string;
  why_not: string;
}

/**
 * The raw shape `GET /api/decision` answers with (src/panel/decisionSource.ts
 * reads it as `unknown` off the ledger; src/ledger/schema.ts's
 * `decisionEventSchema` is where these field names come from).
 */
export interface Decision {
  id: string;
  question: string;
  chose: string;
  because: string;
  alternatives: DecisionAlternative[];
}

/** In English (criteria read them); the render uses the reader's language (panel i18n spec §3.3). */
export const AGREE_HELP = en.decisions.agreeHelp;
export const CORRECT_NOTE = en.decisions.correctNote;
export const KIND_HELP: Record<CorrectionKind, string> = en.decisions.kindHelp;

/** An untouched correction form. */
const EMPTY_CORRECTION: CorrectionForm = { kind: WEB_CORRECTION_KINDS[0], because: "", chose_instead: "" };

/**
 * Project filtering spec §11 R2: the correction form is controlled. With `onDraft` its content is the caller's
 * (`draft`, kept by App under the decision's owner so it outlives this detail); without it, this component's own.
 */
export function DecisionDetail({
  decision,
  onAgree,
  onCorrect,
  draft,
  onDraft,
  review,
  withdrawing,
  onWithdrawReview,
  onWithdrawCorrection,
}: {
  decision: Decision;
  onAgree?: () => void;
  onCorrect?: (form: CorrectionForm) => void;
  draft?: CorrectionForm;
  onDraft?: (form: CorrectionForm) => void;
  review?: DecisionReviewState;
  /** What of this decision has a withdrawal pending: its button is disabled until the answer lands. */
  withdrawing?: { review: boolean; corrections: ReadonlySet<string> };
  onWithdrawReview?: () => void;
  onWithdrawCorrection?: (id: string) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [own, setOwn] = useState<CorrectionForm>(EMPTY_CORRECTION);
  const form = onDraft === undefined ? own : draft ?? EMPTY_CORRECTION;
  const edit = (change: Partial<CorrectionForm>): void => (onDraft ?? setOwn)({ ...form, ...change });
  const reviewed = review?.mine === "reviewed";
  // Spec §4.4: an own open correction holds the review, so the server would refuse its withdrawal; do not offer it.
  const canWithdrawReview = reviewed && !review.corrections.some((c) => c.mine && c.state === "open");
  return (
    <article className="decision-detail">
      <p className="row-id font-data text-xs text-muted">{decision.id}</p>
      <h2 className="wrap-anywhere" data-testid="decision-question">{decision.question}</h2>
      <div className="detail-block">
        <h3>{t("decisions.chose")}</h3>
        <p className="chose" data-testid="decision-chose">
          {decision.chose}
        </p>
      </div>
      <div className="detail-block">
        <h3>{t("decisions.because")}</h3>
        <p className="because" data-testid="decision-because">
          {decision.because}
        </p>
      </div>
      {decision.alternatives.length > 0 && (
        <div className="detail-block">
          <h3>{t("decisions.rejected")}</h3>
          <ul className="alternatives m-0 pl-4.5">
            {decision.alternatives.map((alt) => (
              <li key={alt.option} className="wrap-anywhere">
                <span className="option block text-fg-strong" data-testid="alternative-option">
                  {alt.option}
                </span>
                <span className="why-not block text-sm text-muted" data-testid="alternative-why-not">
                  {alt.why_not}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {review !== undefined && review.reviewers.length > 0 && (
        <div className="detail-block" data-tone="ok" data-testid="decision-reviewers">
          <h3>{t("decisions.reviewersTitle")}</h3>
          <ul className="reviewers m-0 pl-4.5">
            {review.reviewers.map((r) => (
              <li key={r.by}>
                {r.by} · <time dateTime={r.at}>{r.at}</time>
              </li>
            ))}
          </ul>
          {canWithdrawReview && (
            <button type="button" onClick={onWithdrawReview} disabled={withdrawing?.review === true}>
              {t("decisions.withdrawReview")}
            </button>
          )}
        </div>
      )}
      {review !== undefined && review.corrections.length > 0 && (
        <div className="detail-block" data-testid="decision-corrections">
          <h3>{t("decisions.correctionsTitle")}</h3>
          <ul className="corrections m-0 pl-4.5 [&_li]:wrap-anywhere">
            {review.corrections.map((c) => (
              <li
                key={c.id}
                data-correction-id={c.id}
                className={c.state === "withdrawn" ? "correction-withdrawn line-through" : undefined}
                data-tone={c.state === "closed" ? "ok" : undefined}
              >
                {enumText("correctionKind", c.kind)} · {c.because} · {c.by} · <time dateTime={c.at}>{c.at}</time> ·{" "}
                <span className="correction-state">{t(`decisions.correctionState.${c.state}`)}</span>
                {c.withdrawable && (
                  <button type="button" onClick={() => onWithdrawCorrection?.(c.id)} disabled={withdrawing?.corrections.has(c.id) === true}>
                    {t("decisions.withdraw")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className={`actions ${actionsBox}`}>
        <button type="button" className="btn-primary" onClick={onAgree} disabled={reviewed}>
          {reviewed ? t("decisions.agreeDone") : t("decisions.agree")}
        </button>
        <p className={`detail-help ${detailHelp}`}>{t("decisions.agreeHelp")}</p>
        <form
          className="correction-form mt-4 border-0 border-t border-dashed border-line pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            onCorrect?.(form);
          }}
        >
          {/* Taste refinement P1-3. Not an <h3>: the detail's h3s are its reading blocks (pinned by decisionsI18n.test.tsx). */}
          <p className="text-sm text-muted" role="heading" aria-level={3}>{t("decisions.correctionTitle")}</p>
          <label>
            {t("decisions.kind")}
            <select name="kind" value={form.kind} onChange={(e) => edit({ kind: e.currentTarget.value as CorrectionKind })}>
              {WEB_CORRECTION_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {t("decisions.kindOption", { kind: enumText("correctionKind", kind), help: t(`decisions.kindHelp.${kind}`) })}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("decisions.because")}
            <textarea name="because" required value={form.because} onChange={(e) => edit({ because: e.currentTarget.value })} />
          </label>
          <label>
            {t("decisions.choseInstead")}
            <input name="chose_instead" type="text" value={form.chose_instead} onChange={(e) => edit({ chose_instead: e.currentTarget.value })} />
          </label>
          <button type="submit">{t("decisions.correct")}</button>
          <p className={`detail-help ${detailHelp}`}>{t("decisions.correctNote")}</p>
        </form>
      </div>
    </article>
  );
}
