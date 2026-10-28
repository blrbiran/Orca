import { useContext, useState, type JSX } from "react";
import { confirmInline } from "./ui/classes.js";
import { useTranslation } from "react-i18next";
import { AccountContext, mayHumanOnly } from "./AuthGate.js";

/**
 * Spec 2026-10-27 single-call unknown usage §9 R1, R6: a single call blocked on unknown usage (a requirement's clarify or
 * split call, an estimate) is retried only by charging its remaining grant -- the amount the server names. The confirm
 * says so and that the retry reserves another grant; `onCharge` sends recovery-retry with the acknowledgement. An owner's
 * act (humanOnly.ts `recovery-retry.acknowledge`); a member is told who can do it instead of a control that 403s.
 */
export function ChargeRetry(props: { charge: { tokens: number; usageLowerBound: number | null }; onCharge: () => void }): JSX.Element {
  const { t } = useTranslation();
  const mayCharge = mayHumanOnly(useContext(AccountContext));
  const [open, setOpen] = useState(false);
  const tokens = props.charge.tokens.toLocaleString("en-US");
  return <>
    {props.charge.usageLowerBound !== null && <>{t("chargeRetry.lowerBound", { tokens: props.charge.usageLowerBound.toLocaleString("en-US") })} </>}
    {!mayCharge ? <span role="note">{t("chargeRetry.owner")}</span>
      : !open ? <button type="button" onClick={() => setOpen(true)}>{t("chargeRetry.open", { tokens })}</button>
      // Session e236bbe4: the confirm is an inline box toned warn (it spends a grant: "needs action", DESIGN.md).
      : <span role="group" className={`confirm-inline ${confirmInline}`} data-tone="warn" aria-label={t("chargeRetry.open", { tokens })}>{t("chargeRetry.confirmText", { tokens })}{" "}
        <button type="button" onClick={() => { setOpen(false); props.onCharge(); }}>{t("chargeRetry.confirm", { tokens })}</button>{" "}
        <button type="button" className="btn-quiet" onClick={() => setOpen(false)}>{t("chargeRetry.cancel")}</button></span>}
  </>;
}
