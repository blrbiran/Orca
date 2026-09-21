/**
 * Review finding (Task 10 round): one run's evidence, reachable from the page.
 *
 * `/api/control/*` authenticates by the `x-orca-token` header, which a bare
 * `<a href>` cannot send -- so the links here used to answer 401. The manifest
 * is fetched through the same client as every other control read and handed to
 * the browser as a download; a refusal is named rather than swallowed.
 */
import { useState } from "react";
import type { JSX } from "react";
import { controlFailureFrom, fetchRunEvidence, saveEvidenceManifest } from "./controlApi.js";

export function EvidenceLink(props: { runId: string; label?: string }): JSX.Element {
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
      <button type="button" onClick={() => void load()}>{props.label ?? "evidence"}</button>
      {refusal !== null && <span role="alert">{`evidence refused · ${refusal}`}</span>}
    </>
  );
}
