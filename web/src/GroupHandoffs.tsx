import { useState, type JSX } from "react";
import { useTranslation } from "react-i18next";
import { fetchTaskHandoff } from "./controlApi.js";
import type { GroupViewV1, HandoffFileStateV1, TaskHandoffViewV1 } from "./controlTypes.js";

/**
 * Tester follow-up G Part 4.7: each task's handoffs, versions by run, the summary shown and the handoff read when a version
 * is opened (it can be 8 KB; the view carries only the summary).
 */
export function GroupHandoffs(props: { view: GroupViewV1 }): JSX.Element | null {
  const { t } = useTranslation();
  const handoffs = props.view.handoffs;
  if (handoffs === undefined || handoffs.length === 0) return null;
  const tasks = [...new Set(handoffs.map((entry) => entry.taskId))];
  return <section aria-label={t("control.handoffs.title")}>
    <h3>{t("control.handoffs.title")}</h3>
    {tasks.map((taskId) => (
      <section key={taskId} aria-label={t("control.handoffs.task", { taskId })}>
        <h4>{t("control.handoffs.task", { taskId })}</h4>
        {handoffs.filter((entry) => entry.taskId === taskId).map((entry) => <HandoffVersion key={entry.runId} groupId={props.view.summary.groupId} entry={entry} />)}
      </section>
    ))}
  </section>;
}

function HandoffVersion(props: { groupId: string; entry: TaskHandoffViewV1 }): JSX.Element {
  const { t } = useTranslation();
  const { entry } = props;
  const [handoff, setHandoff] = useState<string | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const word = (file: HandoffFileStateV1): string => file.state === "stored" ? t("control.handoffs.stored") : file.state === "truncated" ? t("control.handoffs.truncated") : file.state === "missing" ? t("control.handoffs.missing") : t("control.handoffs.invalid");
  const state = (file: HandoffFileStateV1): string => file.reason === null ? word(file) : `${word(file)} (${file.reason})`;
  const open = (): void => {
    if (handoff !== undefined || entry.handoff.state !== "stored") return;
    fetchTaskHandoff(props.groupId, entry.taskId, entry.runId).then((content) => setHandoff(content.handoff), () => setFailed(true));
  };
  return <details onToggle={(event) => { if ((event.currentTarget as HTMLDetailsElement).open) open(); }}>
    <summary>{t("control.handoffs.version", { runId: entry.runId, outcome: entry.outcome, handoff: state(entry.handoff), summary: state(entry.summary) })}</summary>
    {entry.summaryText !== null && <pre className="whitespace-pre-wrap" aria-label={t("control.handoffs.summary")}>{entry.summaryText}</pre>}
    {entry.handoff.state === "stored" && (failed
      ? <p data-tone="danger" role="status">{t("control.handoffs.readFailed")}</p>
      : handoff === undefined ? <p>{t("control.handoffs.loading")}</p>
        : <pre className="whitespace-pre-wrap" aria-label={t("control.handoffs.handoff")}>{handoff}</pre>)}
  </details>;
}
