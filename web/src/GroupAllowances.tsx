import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { Role } from "./auth.js";
import type { ControlAction } from "./controlApi.js";
import type { AllowanceRequestKindV1, GroupAllowanceV1 } from "./controlTypes.js";

const fromOf = (from: GroupAllowanceV1["from"]): string => "runId" in from ? from.runId : "pendingId" in from ? from.pendingId : from.decisionId;

/**
 * Tester follow-up G §6.3 (#189): "allowed in this group" -- each allowance with what it lets through, who, how, when and
 * from which request; an owner revokes an active one (later requests only: what it let through stays). Nothing when empty.
 */
export function GroupAllowances(props: { groupId: string; revision: number; allowances: GroupAllowanceV1[] | undefined; roles?: readonly Role[]; archived: boolean; onCommand: (action: ControlAction) => void }): JSX.Element | null {
  const { t } = useTranslation();
  const allowances = props.allowances ?? [];
  if (allowances.length === 0) return null;
  const what = (request: AllowanceRequestKindV1): string => request.type === "path"
    ? t("control.allowances.paths", { paths: request.paths.map((p) => p.repoKey === null ? p.path : `${p.repoKey}:${p.path}`).join(", ") })
    : t("control.allowances.decisions", { source: request.type === "pending-decision" ? t("control.allowances.pendingSource") : request.source, kind: request.kind ?? "?", scope: request.scope ?? "?" });
  const owner = props.roles?.includes("owner") === true;
  return (
    <section data-group-allowances={props.groupId} aria-label={t("control.allowances.title")}>
      <h3>{t("control.allowances.title")}</h3>
      <ul>
        {allowances.map((allowance) => (
          <li key={allowance.allowanceId} data-allowance={allowance.allowanceId}>
            <code>{allowance.allowanceId}</code> {what(allowance.request)}{" "}
            <span className="detail-note">{t("control.allowances.by", { by: allowance.by, via: allowance.via, at: new Date(allowance.at).toISOString(), from: fromOf(allowance.from) })}</span>
            {allowance.revoked !== undefined
              ? <span className="badge">{t("control.allowances.revoked")}</span>
              : owner && !props.archived && (
                <button type="button" className="btn-quiet" onClick={() => props.onCommand({ verb: "revoke-allowance", groupId: props.groupId, expectedRevision: props.revision, payload: { allowanceId: allowance.allowanceId } })}>
                  {t("control.allowances.revoke")}
                </button>
              )}
          </li>
        ))}
      </ul>
    </section>
  );
}
