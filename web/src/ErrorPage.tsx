/**
 * Final review I-3 / ruling R66: spec §5's first-class error page. When the
 * metrics or the to-do list cannot be loaded -- above all when E2's integrity
 * gate refuses (`unresolved-project-keys`, which names the keys it could not
 * resolve) -- the person must be able to read WHAT was refused, not only that
 * something answered 409. Pure, for `renderToStaticMarkup`.
 */
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { PanelRefusal } from "./api.js";
import { refusalText } from "./i18n.js";

export function ErrorPage({ failure }: { failure: PanelRefusal }): JSX.Element {
  const { t } = useTranslation();
  return (
    <main className="error-page" role="alert">
      <h1>{t("panelErrors.title")}</h1>
      <p data-testid="error-status">
        {failure.status === null ? t("panelErrors.noAnswerFromPanel") : t("panelErrors.answered", { status: failure.status })}
      </p>
      <p>
        <code data-testid="error-code">{failure.code}</code>
      </p>
      <p data-testid="error-message">{refusalText(failure)}</p>
    </main>
  );
}
