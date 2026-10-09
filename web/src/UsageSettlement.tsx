import { useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { Role } from "./auth.js";
import type { Amount, RunViewV1 } from "./controlTypes.js";
import type { ControlAction } from "./controlApi.js";
import { refusalText } from "./i18n.js";

/** Read-only server amounts: never recompute the authoritative charge in the browser. */
function ChargeTable({ amounts, settled }: { amounts: { work: Amount; handoff: Amount }; settled: boolean }): JSX.Element {
  const { t } = useTranslation();
  return <table aria-label={t(settled ? "control.settlement.charged" : "control.settlement.remaining")}>
    <thead><tr>{(["bucket", "tokens", "activeMs", "attempts", "sessions"] as const).map(key => <th key={key}>{t(`control.settlement.${key}`)}</th>)}</tr></thead>
    <tbody>{(["work", "handoff"] as const).map(bucket => <tr key={bucket}><th>{t(`control.settlement.${bucket}`)}</th>{(["tokens", "activeMs", "attempts", "sessions"] as const).map(dimension => <td key={dimension}>{amounts[bucket][dimension]}</td>)}</tr>)}</tbody>
  </table>;
}

/** The caller keys by the preview/revision/roles so changing evidence or identity discards prior consent. */
export function UsageSettlement({ run, roles, archived, groupId, revision, onCommand }: { run: RunViewV1; roles?: readonly Role[]; archived: boolean; groupId: string; revision: number; onCommand: (action: ControlAction) => void }): JSX.Element | null {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [approved, setApproved] = useState(false);
  const preview = run.unknownUsageSettlement;
  if (!preview) return null;
  if (preview.settlement) {
    const marker = preview.settlement;
    return <div><p>{t("control.settlement.receipt", { method: t("control.settlement.method"), principal: marker.principal, at: new Date(marker.at).toISOString() })}</p><ChargeTable amounts={marker.charged} settled /><p>{t("control.settlement.after")}</p></div>;
  }
  const owner = roles?.includes("owner") === true;
  return <div>
    <p>{t("control.settlement.unknown")}</p>
    {!owner && <p>{t("control.settlement.contactOwner")}</p>}
    {preview.refusalReason && <p role="status">{refusalText({ code: preview.refusalReason.split(":")[0]!, message: preview.refusalReason, status: null })}</p>}
    {!archived && owner && preview.allowed && run.taskId !== null && (!open ? <button type="button" onClick={() => setOpen(true)}>{t("control.settlement.open")}</button> : <div role="group" aria-label={t("control.settlement.confirmation")}>
      <ChargeTable amounts={preview.remaining} settled={false} />
      <p>{t("control.settlement.warning")}</p>
      <label><input type="checkbox" checked={approved} onChange={event => setApproved(event.currentTarget.checked)} />{t("control.settlement.approve")}</label>
      <button type="button" disabled={!approved} onClick={() => { if (!approved) return; setOpen(false); setApproved(false); onCommand({ verb: "settle-unknown-usage", groupId, expectedRevision: revision, payload: { taskId: run.taskId!, runId: run.runId, generation: preview.generation, acknowledge: "charge-remaining-grant" } }); }}>{t("control.settlement.confirm")}</button>
      <button type="button" onClick={() => { setOpen(false); setApproved(false); }}>{t("control.settlement.cancel")}</button>
    </div>)}
  </div>;
}
