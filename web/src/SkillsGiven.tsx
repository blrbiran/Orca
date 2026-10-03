/**
 * Syncskill integration spec §4.6: the skills each task run was given -- syncskill's lock as the run's drive record holds
 * it. A skill with no resolved commit is a local one. The snapshot's own path is a local path and is not shown.
 */
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { GroupViewV1 } from "./controlTypes.js";

const short = (commit: string): string => commit.slice(0, 12);

export function SkillsGiven(props: { view: GroupViewV1 }): JSX.Element | null {
  const { t } = useTranslation();
  const runs = props.view.runs.filter((run) => run.taskId !== null && run.skills != null && run.skills.lock.length > 0);
  if (runs.length === 0) return null;
  return (
    <section aria-label={t("control.skills.region")}>
      <h3>{t("control.skills.region")}</h3>
      <table aria-label={t("control.skills.runsRegion")}>
        <thead>
          <tr><th>{t("control.skills.th.task")}</th><th>{t("control.skills.th.run")}</th><th>{t("control.skills.th.skill")}</th><th>{t("control.skills.th.commit")}</th><th>{t("control.skills.th.md5")}</th></tr>
        </thead>
        <tbody>
          {runs.flatMap((run) => run.skills!.lock.map((entry) => (
            <tr key={`${run.runId}/${entry.name}`}>
              <td>{run.taskId}</td>
              <td>{run.runId}</td>
              <td>{entry.name}</td>
              <td>{entry.resolved_commit === null ? t("control.skills.local") : <code>{short(entry.resolved_commit)}</code>}</td>
              <td><code>{entry.content_md5}</code></td>
            </tr>
          )))}
        </tbody>
      </table>
    </section>
  );
}
