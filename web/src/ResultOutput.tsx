import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { noteAnswer, onLoginRequired } from "./api.js";
import { controlFailureFrom, ControlRequestError } from "./controlApi.js";
import type { ResultOutputMetadataV1, ResultOutputV1 } from "./controlTypes.js";
import { fetchResultOutput, resultOutputPath } from "./resultApi.js";
import { SafeMarkdown } from "./SafeMarkdown.js";
export function ResultOutput(props: { runId: string; groupId: string; attempt: number; output: ResultOutputMetadataV1; active: boolean; identity: string }): JSX.Element {
 const { t } = useTranslation(); const [preview, setPreview] = useState<ResultOutputV1 | null>(null); const [error, setError] = useState<string | null>(null);
 const lifecycle = useRef({ active: props.active, identity: props.identity, sequence: 0, revoked: false });
 lifecycle.current.active = props.active; lifecycle.current.identity = props.identity;
 const abort = useRef<AbortController | null>(null);
 useEffect(() => { lifecycle.current.revoked = false; setPreview(null); setError(null); lifecycle.current.sequence++; abort.current?.abort(); return () => { lifecycle.current.sequence++; abort.current?.abort(); }; }, [props.active, props.identity]);
 useEffect(() => onLoginRequired(() => {
  lifecycle.current.revoked = true; lifecycle.current.sequence++; abort.current?.abort(); setPreview(null); setError(null);
 }), []);
 const begin = (): { current: () => boolean; signal: AbortSignal } | null => {
  if (!props.active || lifecycle.current.revoked) return null;
  abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
  const sequence = ++lifecycle.current.sequence, identity = props.identity;
  return { signal: controller.signal, current: () => !lifecycle.current.revoked && lifecycle.current.active && lifecycle.current.identity === identity && lifecycle.current.sequence === sequence && !controller.signal.aborted };
 };
 const load = async (): Promise<void> => {
  const request = begin(); if (!request) return; setPreview(null); setError(null);
  try {
   const answer = await fetchResultOutput(props.runId, props.output.outputId, request.signal);
   if (!request.current()) return;
   if (answer.schema !== "orca-result-output-v1" || answer.runId !== props.runId || answer.groupId !== props.groupId || answer.attempt !== props.attempt || answer.outputId !== props.output.outputId || answer.path !== props.output.path || (answer.downloadUrl !== null && answer.downloadUrl !== resultOutputPath(props.runId, props.output.outputId) + "?download=1")) { setError("result-response-stale"); return; }
   setPreview(answer);
  } catch (err) { if (request.current()) setError(controlFailureFrom(err).code); }
 };
 const download = async (): Promise<void> => {
  const request = begin(); if (!request || preview === null || preview.downloadUrl === null) return; setError(null);
  try {
   const response = await fetch(preview.downloadUrl, { signal: request.signal });
   if (!response.ok) { const body = await response.json().catch(() => null); noteAnswer(response.status, body); throw new ControlRequestError({ status: response.status, code: body?.error?.code ?? `http-${response.status}`, message: body?.error?.message ?? "", commandRevision: null }); }
   const blob = await response.blob(); if (!request.current()) return;
   const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = props.output.outputId; anchor.click(); URL.revokeObjectURL(url);
  } catch (err) { if (request.current()) setError(controlFailureFrom(err).code); }
 };
 return <li>
  <code>{props.output.path}</code> · {props.output.label} · {t(`results.outputStatus.${props.output.status}`)}{" "}
  <button type="button" disabled={!props.active} onClick={() => void load()}>{t("results.preview", { label: props.output.label })}</button>
  {error !== null && <p role="alert">{t("results.refused", { code: error })}</p>}
  {props.active && preview !== null && <section aria-label={t("results.outputRegion", { path: preview.path })}>
   <p>{t(`results.outputStatus.${preview.status}`)} · {t("results.outputIdentity", { runId: preview.runId, attempt: preview.attempt, outputId: preview.outputId, bytes: preview.byteLength ?? t("common.na") })}</p>
   {preview.content !== null && <SafeMarkdown text={preview.content} />}
   {preview.downloadUrl !== null && <button type="button" onClick={() => void download()}>{t("results.download", { path: preview.path })}</button>}
  </section>}
 </li>;
}
