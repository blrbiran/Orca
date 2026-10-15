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
    <div className="refusal" role="alert" data-tone="danger" data-testid={testId} data-status={refusal.status ?? ""}>
      <p>{text}</p>
      {items.length > 0 && (
        <ul>
          {items.map((item, index) => <li key={index}>{item}</li>)}
        </ul>
      )}
      {/* ccloop error codes spec (2026-10-15) §4.6, human ruling 2: a ccloop failure shows ccloop's code and its detail (the server cut it to 512). */}
      <p><code className="refusal-code">{refusal.code === "ccloop-failed" ? refusal.message : refusal.code}</code></p>
    </div>
  );
}
