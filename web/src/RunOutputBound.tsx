import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { RunViewV1 } from "./controlTypes.js";
import { currentLanguage } from "./i18n.js";
import { formatTokens } from "./TokenInput.js";

/** Spec 2026-10-15 §6.2: the result is used as normal; this only says the call went over its declared bound. */
export function RunOutputBound(props: { run: RunViewV1 }): JSX.Element | null {
  const { t } = useTranslation();
  if (props.run.outputBoundExceededBy === undefined) return null;
  // A neutral block note (DESIGN.md: no tone), the count written as the rest of the row writes tokens.
  return <p role="note">{t("control.outputBound.exceeded", { tokens: formatTokens(props.run.outputBoundExceededBy, currentLanguage()) })}</p>;
}
