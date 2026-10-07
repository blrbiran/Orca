/**
 * Review finding (Task 10 round): one run's evidence, reachable from the page.
 *
 * `/api/control/*` used to authenticate by a header a bare `<a href>` cannot
 * send, so the links here answered 401; it now takes the session cookie
 * (accounts spec §3.4). The manifest is still fetched through the same client
 * as every other control read and handed to the browser as a download; a
 * refusal is named rather than swallowed.
 */
import { useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { controlFailureFrom, fetchRunEvidence, saveEvidenceManifest } from "./controlApi.js";

export function EvidenceLink(props: { runId: string; label?: string }): JSX.Element {
  const { t } = useTranslation();
  const [refusal, setRefusal] = useState<string | null>(null);
  const load = async (): Promise<void> => {
    setRefusal(null);
    try {
      saveEvidenceManifest(await fetchRunEvidence(props.runId));
    } catch (err) {
      setRefusal(controlFailureFrom(err).code);
    }
  };
  return (
    <>
      <button type="button" onClick={() => void load()}>{props.label ?? t("control.evidence.button")}</button>
      {refusal !== null && <span role="alert">{t("control.evidence.refused", { code: refusal })}</span>}
    </>
  );
}
