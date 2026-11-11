import { useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { Role } from "./auth.js";
import type { Amount, RunViewV1 } from "./controlTypes.js";
import type { ControlAction } from "./controlApi.js";
import { refusalText } from "./i18n.js";

/** Read-only server amounts: never recompute the authoritative charge in the browser. */
function ChargeTable({ amounts, settled }: { amounts: { work: import("./controlTypes.js").BudgetAmount; handoff: Amount }; settled: boolean }): JSX.Element {
  // An unlimited (null) work token dimension is released unmetered: it is never rendered as 0 or left blank.
  const { t } = useTranslation();
  return <table aria-label={t(settled ? "control.settlement.charged" : "control.settlement.remaining")}>
    <thead><tr>{(["bucket", "tokens", "activeMs", "attempts", "sessions"] as const).map(key => <th key={key}>{t(`control.settlement.${key}`)}</th>)}</tr></thead>
    <tbody>{(["work", "handoff"] as const).map(bucket => <tr key={bucket}><th>{t(`control.settlement.${bucket}`)}</th>{(["tokens", "activeMs", "attempts", "sessions"] as const).map(dimension => <td key={dimension}>{amounts[bucket][dimension] ?? t("control.settlement.notMetered")}</td>)}</tr>)}</tbody>
  </table>;
}

/**
 * The caller keys by the preview/revision/roles so changing evidence or identity discards prior consent. `compact`
 * (feedback #56/#57: a row that already shows the run's reason) offers only the settlement itself, behind the same gate;
 * where it offers no button it keeps one line saying why (the server's refusal, else contact an owner), shown only while
 * the row is `active` (its pane is the one shown, fix round 1).
 */
export function UsageSettlement({ run, roles, archived, groupId, revision, onCommand, compact = false, active = true }: { run: RunViewV1; roles?: readonly Role[]; archived: boolean; groupId: string; revision: number; onCommand: (action: ControlAction) => void; compact?: boolean; active?: boolean }): JSX.Element | null {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [approved, setApproved] = useState(false);
  const [floorOpen, setFloorOpen] = useState(false);
  const [floorApproved, setFloorApproved] = useState(false);
  const preview = run.unknownUsageSettlement;
  if (!preview) return null;
  if (preview.settlement) {
    if (compact) return null;
    const marker = preview.settlement;
    // Spec 2026-11-06 §3.5: Orca's approximate floor is not a person's charge; it names the floor it booked.
    if (marker.method === "approximate-floor") {
      const at = new Date(marker.at).toISOString();
      return <div><p>{marker.floorTokens === null ? t("control.settlement.approximateReceiptNone", { at }) : t("control.settlement.approximateReceipt", { at, tokens: marker.floorTokens.toLocaleString("en-US") })}</p></div>;
    }
    // Tester follow-up F §2 (#116): a person's or agent's explicit observed floor names the floor and who booked it.
    if (marker.method === "observed-floor") {
      return <div><p data-testid="observed-floor-receipt">{t("control.settlement.observedReceipt", { principal: marker.principal, at: new Date(marker.at).toISOString(), tokens: marker.floorTokens.toLocaleString("en-US") })}</p><p>{t(marker.reservationDisposition === "recovered" ? "control.settlement.afterRecovered" : "control.settlement.floorAfter")}</p></div>;
    }
    const unmetered = marker.method === "owner-acknowledged-unmetered";
    return <div><p>{t("control.settlement.receipt", { method: t(unmetered ? "control.settlement.methodUnmetered" : "control.settlement.method"), principal: marker.principal, at: new Date(marker.at).toISOString() })}</p><ChargeTable amounts={marker.charged} settled /><p>{t(marker.reservationDisposition === "recovered" ? "control.settlement.afterRecovered" : unmetered ? "control.settlement.afterUnmetered" : "control.settlement.after")}</p></div>;
  }
  const owner = roles?.includes("owner") === true;
  // The server names the one acknowledgement this remainder admits; the browser never chooses between charge and release.
  const release = preview.acknowledge !== "charge-remaining-grant";
  const offered = !archived && owner && preview.allowed && run.taskId !== null;
  const refusal = preview.refusalReason ? <p role="status" data-tone="warn">{refusalText({ code: preview.refusalReason.split(":")[0]!, message: preview.refusalReason, status: null })}</p> : null;
  const automatic = preview.approximateRefusal ? <p role="status" data-tone="warn" data-testid="approximate-refused">{t("control.settlement.approximateRefused", { code: preview.approximateRefusal })}</p> : null;
  // Tester follow-up F §2 (#116): the observed-floor form beside it, with the server's own admission answer and floor.
  const floor = preview.observedFloor;
  const floorOffered = !archived && owner && floor?.allowed === true && run.taskId !== null;
  const floorTokens = floor?.tokens.toLocaleString("en-US") ?? "";
  if (compact && !offered && !floorOffered) return !active ? null : refusal ?? (!owner ? <p>{t("control.settlement.contactOwner")}</p> : null);
  const floorChoice = floorOffered && !open && (!floorOpen ? <button type="button" data-testid="settle-observed-floor" onClick={() => setFloorOpen(true)}>{t("control.settlement.floorOpen", { tokens: floorTokens })}</button>
    : <div role="group" aria-label={t("control.settlement.floorConfirmation")}>
      <p>{t("control.settlement.floorWarning", { tokens: floorTokens })}</p>
      <label><input type="checkbox" checked={floorApproved} onChange={event => setFloorApproved(event.currentTarget.checked)} />{t("control.settlement.floorApprove")}</label>
      <button type="button" disabled={!floorApproved} onClick={() => { if (!floorApproved) return; setFloorOpen(false); setFloorApproved(false); onCommand({ verb: "settle-unknown-usage", groupId, expectedRevision: revision, payload: { taskId: run.taskId!, runId: run.runId, generation: preview.generation, acknowledge: "charge-observed-floor" } }); }}>{t("control.settlement.floorConfirm", { tokens: floorTokens })}</button>
      <button type="button" onClick={() => { setFloorOpen(false); setFloorApproved(false); }}>{t("control.settlement.cancel")}</button>
    </div>);
  return <div>
    {!compact && <p>{t("control.settlement.unknown")}</p>}
    {!compact && run.usageLowerBound != null && <p>{t("chargeRetry.lowerBound", { tokens: run.usageLowerBound.toLocaleString("en-US") })}</p>}
    {!compact && !owner && <p>{t("control.settlement.contactOwner")}</p>}
    {!compact && refusal}
    {!compact && automatic}
    {offered && !floorOpen && (!open ? <button type="button" onClick={() => setOpen(true)}>{t(release ? "control.settlement.releaseOpen" : "control.settlement.open")}</button> : <div role="group" aria-label={t("control.settlement.confirmation")}>
      <ChargeTable amounts={preview.remaining} settled={false} />
      <p>{t(release ? "control.settlement.releaseWarning" : "control.settlement.warning")}</p>
      <label><input type="checkbox" checked={approved} onChange={event => setApproved(event.currentTarget.checked)} />{t(release ? "control.settlement.releaseApprove" : "control.settlement.approve")}</label>
      <button type="button" disabled={!approved} onClick={() => { if (!approved) return; setOpen(false); setApproved(false); onCommand({ verb: "settle-unknown-usage", groupId, expectedRevision: revision, payload: { taskId: run.taskId!, runId: run.runId, generation: preview.generation, acknowledge: preview.acknowledge } }); }}>{t(release ? "control.settlement.releaseConfirm" : "control.settlement.confirm")}</button>
      <button type="button" onClick={() => { setOpen(false); setApproved(false); }}>{t("control.settlement.cancel")}</button>
    </div>)}
    {floorChoice}
  </div>;
}
