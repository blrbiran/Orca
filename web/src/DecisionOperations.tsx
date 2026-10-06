/**
 * Project filtering spec §11 R3: the global, owner-labelled notice of decision requests whose owner is not the open
 * decision. App renders it in Shell's banners, outside every section pane, so it stays visible across sections and
 * scope changes. Each line names its project and decision, so an old refusal never reads as an error of the decision
 * on screen. "Record another" is offered only for a correction the server refused naming `again`, and is labelled with
 * that record's owner. Pure: App hands it everything.
 */
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { DecisionRequest } from "./decisionRequests.js";
import { refusalText } from "./i18n.js";

export function DecisionOperations({
  requests,
  projectName,
  onDismiss,
  onRecordAnother,
}: {
  requests: DecisionRequest[];
  projectName: (projectKey: string) => string;
  onDismiss: (requestId: string) => void;
  onRecordAnother: (record: DecisionRequest) => void;
}): JSX.Element | null {
  const { t } = useTranslation();
  if (requests.length === 0) return null;
  return (
    <section className="callout decision-operations" aria-label={t("decisions.operations")}>
      <ul>
        {requests.map((record) => {
          const names = { project: projectName(record.owner.projectKey), decision: record.owner.decisionId };
          const status = record.status.kind === "pending"
            ? t("decisions.operationPending")
            : record.status.kind === "recorded" ? t(record.status.text) : t("decisions.operationRefused");
          const verb = t(record.verb === "agree" ? "decisions.agree" : "decisions.correct");
          return (
            <li key={record.requestId}>
              <p data-testid="operation-line">{t("decisions.operationLine", { ...names, verb, status })}</p>
              {record.status.kind === "refused" && (
                <>
                  <p><code>{record.status.refusal.code}</code></p>
                  <p>{refusalText(record.status.refusal)}</p>
                  {record.status.refusal.retry_field === "again" && record.payload !== null && (
                    <button type="button" onClick={() => onRecordAnother(record)}>{t("decisions.recordAnotherFor", names)}</button>
                  )}
                </>
              )}
              {record.status.kind !== "pending" && (
                <button type="button" onClick={() => onDismiss(record.requestId)}>{t("decisions.dismissOperation")}</button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
