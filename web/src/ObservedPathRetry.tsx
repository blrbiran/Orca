import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { AllowRequestButtons } from "./AllowRequestButtons.js";
import type { ControlAction } from "./controlApi.js";
import type { GroupViewV1, RunViewV1 } from "./controlTypes.js";

/** Only the server's typed, Git-observed misses may be proposed for a path-expanding retry. */
export function ObservedPathRetry({ view, run, onCommand }: { view: GroupViewV1; run: RunViewV1; onCommand: (action: ControlAction) => void }): JSX.Element | null {
  const { t } = useTranslation();
  if (run.outcome !== "blocked_waiting_human") return null;
  const misses = run.pathPolicyMisses;
  if (!misses?.length) return <p>{t("control.group.noObservedPathEvidence")}</p>;
  return <div>
    <p>{t("control.group.observedPathIntro")}</p>
    <ul>{misses.map((miss) => <li key={`${miss.repoKey ?? ""}:${miss.path}`}><code>{miss.repoKey === null ? miss.path : `${miss.repoKey}:${miss.path}`}</code></li>)}</ul>
    {/* Tester follow-up G §6.3 (#189): allow these exact paths for every task of the group (default), or only this retry. */}
    <AllowRequestButtons groupId={view.summary.groupId} revision={view.summary.commandRevision} request={{ kind: "path", runId: run.runId }} archived={view.summary.archived === true} onCommand={onCommand} />
    <button type="button" onClick={() => onCommand({ verb: "retry-task", groupId: view.summary.groupId, expectedRevision: view.summary.commandRevision,
      payload: { taskId: String(run.taskId), runId: run.runId, allowObservedPaths: true } })}>{t("control.group.retryObservedPaths")}</button>
  </div>;
}
