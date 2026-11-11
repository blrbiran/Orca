import { useContext, useState, type JSX } from "react";
import { confirmInline } from "./ui/classes.js";
import { useTranslation } from "react-i18next";
import { AccountContext, mayHumanOnly } from "./AuthGate.js";

/**
 * Spec 2026-10-27 single-call unknown usage §9 R1, R6: a single call blocked on unknown usage (a requirement's clarify or
 * split call, an estimate) is retried only by charging its remaining grant -- the amount the server names. The confirm
 * says so and that the retry reserves another grant; `onCharge` sends recovery-retry with the acknowledgement. An owner's
 * act (humanOnly.ts `recovery-retry.acknowledge`); a member is told who can do it instead of a control that 403s.
 * Tester follow-up F §2 (#116): where the caller passes `onChargeFloor` and ccloop observed a floor, charging that floor
 * (approximate, `charge-observed-floor`) is offered beside it. Flow calls pass none (their forms are unchanged).
 */
export function ChargeRetry(props: { charge: { tokens: number; usageLowerBound: number | null }; onCharge: () => void; onChargeFloor?: () => void }): JSX.Element {
  const { t } = useTranslation();
  const mayCharge = mayHumanOnly(useContext(AccountContext));
  const [open, setOpen] = useState<"grant" | "floor" | null>(null);
  const tokens = props.charge.tokens.toLocaleString("en-US");
  const floor = props.charge.usageLowerBound?.toLocaleString("en-US") ?? "";
  const floorOffered = props.charge.usageLowerBound !== null && props.onChargeFloor !== undefined;
  return <>
    {props.charge.usageLowerBound !== null && <>{t("chargeRetry.lowerBound", { tokens: floor })} </>}
    {!mayCharge ? <span role="note">{t("chargeRetry.owner")}</span>
      : open === null ? <>
        <button type="button" onClick={() => setOpen("grant")}>{t("chargeRetry.open", { tokens })}</button>
        {floorOffered && <>{" "}<button type="button" data-testid="charge-observed-floor" onClick={() => setOpen("floor")}>{t("chargeRetry.floorOpen", { tokens: floor })}</button></>}
      </>
      // Session e236bbe4: the confirm is an inline box toned warn (it spends a grant: "needs action", DESIGN.md).
      : open === "grant" ? <span role="group" className={`confirm-inline ${confirmInline}`} data-tone="warn" aria-label={t("chargeRetry.open", { tokens })}>{t("chargeRetry.confirmText", { tokens })}{" "}
        <button type="button" onClick={() => { setOpen(null); props.onCharge(); }}>{t("chargeRetry.confirm", { tokens })}</button>{" "}
        <button type="button" className="btn-quiet" onClick={() => setOpen(null)}>{t("chargeRetry.cancel")}</button></span>
      : <span role="group" className={`confirm-inline ${confirmInline}`} data-tone="warn" aria-label={t("chargeRetry.floorOpen", { tokens: floor })}>{t("chargeRetry.floorConfirmText", { tokens: floor })}{" "}
        <button type="button" onClick={() => { setOpen(null); props.onChargeFloor?.(); }}>{t("chargeRetry.floorConfirm", { tokens: floor })}</button>{" "}
        <button type="button" className="btn-quiet" onClick={() => setOpen(null)}>{t("chargeRetry.cancel")}</button></span>}
  </>;
}
