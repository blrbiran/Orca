import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { RunViewV1 } from "./controlTypes.js";

/** Spec 2026-10-15 §6.2: the result is used as normal; this only says the call went over its declared bound. */
export function RunOutputBound(props: { run: RunViewV1 }): JSX.Element | null {
  const { t } = useTranslation();
  if (props.run.outputBoundExceededBy === undefined) return null;
  return <small role="note">{t("control.outputBound.exceeded", { tokens: props.run.outputBoundExceededBy })}</small>;
}
