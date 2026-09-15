/**
 * Final review I-3 / ruling R66: what the person sees when the panel refused
 * an Agree or a Correct. Pure, so a criterion can render it with
 * `renderToStaticMarkup` (plan ruling 2). The server's `code` and `message`
 * are shown as sent -- the message is the panel's own sentence (spec §4.4),
 * and for a failed `reviewed` mark it is the only place the person learns the
 * correction landed but the mark did not (spec §4.3.1).
 *
 * "Record another" is offered ONLY when the server named `again` as the field
 * to retry with (a second correction on the same decision, spec §4.4) -- on any
 * other refusal, resending with `again: true` would change nothing and would
 * tell the person something false about what went wrong.
 */
import type { JSX } from "react";
import type { PanelRefusal } from "./api.js";

export function Refusal({
  refusal,
  onRecordAnother,
}: {
  refusal: PanelRefusal;
  onRecordAnother?: () => void;
}): JSX.Element {
  return (
    <div className="refusal" role="alert">
      <p>
        <code data-testid="refusal-code">{refusal.code}</code>
      </p>
      <p data-testid="refusal-message">{refusal.message}</p>
      {refusal.retry_field === "again" && (
        <button type="button" data-testid="record-another" onClick={onRecordAnother}>
          Record another
        </button>
      )}
    </div>
  );
}
