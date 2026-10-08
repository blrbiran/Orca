/**
 * Spec 2026-10-08 §2.2(d): a refusal where the person acted -- what happened and what to do, a refused plan's problems one
 * per line, and the server's code as sent (small, monospace) so the explanation can always be checked against it.
 */
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { ControlRefusal } from "./controlState.js";
import { explainRefusal } from "./refusalExplain.js";

export function RefusalNotice({ refusal, testId }: { refusal: ControlRefusal; testId: string }): JSX.Element {
  useTranslation(); // re-render when the language changes: explainRefusal reads it
  const { text, items } = explainRefusal(refusal);
  return (
    <div className="refusal" role="alert" data-testid={testId} data-status={refusal.status ?? ""}>
      <p>{text}</p>
      {items.length > 0 && (
        <ul>
          {items.map((item, index) => <li key={index}>{item}</li>)}
        </ul>
      )}
      <p><code className="refusal-code">{refusal.code}</code></p>
    </div>
  );
}
