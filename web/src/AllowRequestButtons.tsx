import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { ControlAction } from "./controlApi.js";
import type { AllowRequestV1 } from "./controlTypes.js";

/**
 * Tester follow-up G §6.3 (#189): the two ways to let a request through. "Allow this kind in this group" is the default
 * (first, primary): it records an allowance that also lets every same-kind request of this group through; "Allow this
 * one" settles only this request. Nothing for an archived group.
 */
export function AllowRequestButtons(props: { groupId: string; revision: number; request: AllowRequestV1; archived: boolean; onCommand: (action: ControlAction) => void }): JSX.Element | null {
  const { t } = useTranslation();
  if (props.archived) return null;
  const send = (scope: "one" | "group") => props.onCommand({ verb: "allow-request", groupId: props.groupId, expectedRevision: props.revision, payload: { request: props.request, scope } });
  return (
    <span data-allow-request="">
      <button type="button" onClick={() => send("group")}>{t("control.allowances.allowKind")}</button>
      <button type="button" className="btn-quiet" onClick={() => send("one")}>{t("control.allowances.allowOne")}</button>
    </span>
  );
}
