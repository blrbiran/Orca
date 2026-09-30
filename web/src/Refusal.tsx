/**
 * Final review I-3 / ruling R66: what the person sees when the panel refused
 * an Agree or a Correct. Pure, so a criterion can render it with
 * `renderToStaticMarkup` (plan ruling 2). The server's `code` and `message`
 * are shown as sent -- in English; in Chinese the message is the entry for its
 * code when there is one (panel i18n spec §3.2) -- the message is the panel's
 * own sentence (spec §4.4), and for a failed `reviewed` mark it is the only
 * place the person learns the correction landed but the mark did not (spec
 * §4.3.1), so the Chinese entries for the codes that path relays carry it.
 *
 * "Record another" is offered ONLY when the server named `again` as the field
 * to retry with (a second correction on the same decision, spec §4.4) -- on any
 * other refusal, resending with `again: true` would change nothing and would
 * tell the person something false about what went wrong.
 */
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { PanelRefusal } from "./api.js";
import { refusalText } from "./i18n.js";

export function Refusal({
  refusal,
  onRecordAnother,
}: {
  refusal: PanelRefusal;
  onRecordAnother?: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="refusal" role="alert">
      <p>
        <code data-testid="refusal-code">{refusal.code}</code>
      </p>
      <p data-testid="refusal-message">{refusalText(refusal)}</p>
      {refusal.retry_field === "again" && (
        <button type="button" data-testid="record-another" onClick={onRecordAnother}>
          {t("panelErrors.recordAnother")}
        </button>
      )}
    </div>
  );
}
