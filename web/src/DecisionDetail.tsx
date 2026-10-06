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
 */
import { useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { CorrectionForm } from "./api.js";
import { enumText } from "./i18n.js";
import { en } from "./locales/en.js";
import { WEB_CORRECTION_KINDS } from "./types.js";
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
}: {
  decision: Decision;
  onAgree?: () => void;
  onCorrect?: (form: CorrectionForm) => void;
  draft?: CorrectionForm;
  onDraft?: (form: CorrectionForm) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [own, setOwn] = useState<CorrectionForm>(EMPTY_CORRECTION);
  const form = onDraft === undefined ? own : draft ?? EMPTY_CORRECTION;
  const edit = (change: Partial<CorrectionForm>): void => (onDraft ?? setOwn)({ ...form, ...change });
  return (
    <article className="decision-detail">
      <p className="row-id">{decision.id}</p>
      <h2 data-testid="decision-question">{decision.question}</h2>
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
          <ul className="alternatives">
            {decision.alternatives.map((alt) => (
              <li key={alt.option}>
                <span className="option" data-testid="alternative-option">
                  {alt.option}
                </span>
                <span className="why-not" data-testid="alternative-why-not">
                  {alt.why_not}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="actions">
        <button type="button" className="btn-primary" onClick={onAgree}>
          {t("decisions.agree")}
        </button>
        <p className="detail-help">{t("decisions.agreeHelp")}</p>
        <form
          className="correction-form"
          onSubmit={(event) => {
            event.preventDefault();
            onCorrect?.(form);
          }}
        >
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
          <p className="detail-help">{t("decisions.correctNote")}</p>
        </form>
      </div>
    </article>
  );
}
