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
 */
import type { JSX } from "react";
import type { CorrectionForm } from "./api.js";
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

export function DecisionDetail({
  decision,
  onAgree,
  onCorrect,
}: {
  decision: Decision;
  onAgree?: () => void;
  onCorrect?: (form: CorrectionForm) => void;
}): JSX.Element {
  return (
    <article className="decision-detail">
      <h2 data-testid="decision-question">{decision.question}</h2>
      <p className="chose" data-testid="decision-chose">
        {decision.chose}
      </p>
      <p className="because" data-testid="decision-because">
        {decision.because}
      </p>
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
      <button type="button" onClick={onAgree}>
        Agree
      </button>
      <form
        className="correction-form"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          onCorrect?.({
            kind: String(data.get("kind")) as CorrectionKind,
            because: String(data.get("because") ?? ""),
            chose_instead: String(data.get("chose_instead") ?? ""),
          });
        }}
      >
        <label>
          Kind
          <select name="kind" defaultValue={WEB_CORRECTION_KINDS[0]}>
            {WEB_CORRECTION_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        </label>
        <label>
          Because
          <textarea name="because" required />
        </label>
        <label>
          Chose instead (optional)
          <input name="chose_instead" type="text" />
        </label>
        <button type="submit">Correct</button>
      </form>
    </article>
  );
}
