import type { JSX } from "react";
import { useTranslation } from "react-i18next";

/**
 * Tester #348 review: a run whose stored body the server's run read schema cannot decode is left out of the view's runs
 * (so nothing about it is guessed) and named in `unreadableRuns` -- on the group, and on the task that owns it. Without
 * this the run silently vanished from Runs and from the task's detail. One line per run: its id and why.
 */
export function UnreadableRuns(props: { entries: ReadonlyArray<{ runId: string; reason: string }> | undefined }): JSX.Element | null {
  const { t } = useTranslation();
  const entries = props.entries ?? [];
  if (entries.length === 0) return null;
  return (
    <div data-unreadable-runs="">
      {entries.map((entry) => (
        <p key={entry.runId} data-tone="danger" data-unreadable-run={entry.runId}>{t("control.unreadableRuns.line", { runId: entry.runId, reason: entry.reason })}</p>
      ))}
    </div>
  );
}
