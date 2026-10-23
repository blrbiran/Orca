/**
 * Tester round 2 spec §9.4 (ruling H11): the shared back line. App shows it only while the hash its own push wrote is the
 * current one, so the entry Back returns to is known to be Orca's.
 */
import type { JSX } from "react";
import { useTranslation } from "react-i18next";

export function BackLine(props: { label: string }): JSX.Element {
  const { t } = useTranslation();
  return <p className="back-line"><button type="button" onClick={() => window.history.back()}>{t("nav.back", { label: props.label })}</button></p>;
}
