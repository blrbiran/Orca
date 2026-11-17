import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { RunViewV1 } from "./controlTypes.js";
import { sessionCleanupCommand } from "../../src/control/sessionCleanupCommand.js";

export { sessionCleanupCommand };

/**
 * Tester #349 (human's ruling, session 4389b15f, 2026-11-18): a Codex session ccloop could not delete keeps the run's prompt
 * in its private rollout. The run settled on its real result; this is a standing notice with the command that deletes it,
 * shown on the run and listed (not counted) in the group's Problems region.
 */
export function SessionCleanupNotice(props: { run: RunViewV1 }): JSX.Element | null {
  const { t } = useTranslation();
  const entries = props.run.sessionCleanup ?? [];
  if (entries.length === 0) return null;
  return <div data-session-cleanup-run-id={props.run.runId}>{entries.map((entry) => (
    <p key={entry.threadId} data-tone="warn">
      {t(entry.state === "failed" ? "control.sessionCleanup.failed" : "control.sessionCleanup.retryFailed", { threadId: entry.threadId, runId: props.run.runId, detail: entry.detail })}{" "}
      {t("control.sessionCleanup.command")} <code>{sessionCleanupCommand(entry)}</code>
    </p>
  ))}</div>;
}

/** The Problems region's rows: every run of the group with such a session, listed, not counted as a problem. */
export function SessionCleanupRows(props: { runs: readonly RunViewV1[] }): JSX.Element {
  return <>{props.runs.map((run) => <SessionCleanupNotice key={run.runId} run={run} />)}</>;
}
