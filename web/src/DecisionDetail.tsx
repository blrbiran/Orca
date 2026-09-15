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
 */
import type { JSX } from "react";

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
  onCorrect?: () => void;
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
      <button type="button" onClick={onCorrect}>
        Correct
      </button>
    </article>
  );
}
