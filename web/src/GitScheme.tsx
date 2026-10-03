/**
 * Board spec 2026-10-03 B3, D4-D6: the group's git scheme as the server recorded it. The work branch and the landing shape
 * are facts of the driver (execution driver spec §5.1); each run's mode, base and landing come from its drive record.
 * Merging into main and pushing are a person's (CLAUDE.md Rule 15): shown as waiting on a person, never as queued, and
 * this panel has no button for either.
 */
import type { JSX } from "react";
import { Trans, useTranslation } from "react-i18next";
import type { GroupViewV1, RepositoryWorkspaceV1 } from "./controlTypes.js";

const short = (commit: string): string => commit.slice(0, 12);

export function GitScheme(props: { view: GroupViewV1; workspace?: RepositoryWorkspaceV1 | null }): JSX.Element {
  const { t } = useTranslation();
  const { view } = props;
  const groupId = view.summary.groupId;
  const runs = view.runs.filter((run) => run.taskId !== null && run.git != null);
  const mode = props.workspace?.repoId === view.plan.repoId ? props.workspace.workspaceMode : null;
  return (
    <section aria-label={t("control.git.region")}>
      <h3>{t("control.git.region")}</h3>
      <ul>
        <li><Trans i18nKey="control.git.branch" values={{ groupId }} components={{ code: <code /> }} /></li>
        <li>
          {mode === null
            ? t("control.git.modeUnread")
            : t("control.git.mode", { mode: t(mode === "worktree" ? "control.workspace.aWorktree" : "control.workspace.aClone") })}
        </li>
        <li>{t("control.git.merge")}</li>
        <li>{t("control.git.push")}</li>
      </ul>
      {runs.length === 0
        ? <p>{t("control.git.noRuns")}</p>
        : (
          <table aria-label={t("control.git.runsRegion")}>
            <thead>
              <tr><th>{t("control.git.th.task")}</th><th>{t("control.git.th.run")}</th><th>{t("control.git.th.mode")}</th><th>{t("control.git.th.base")}</th><th>{t("control.git.th.landed")}</th></tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.runId}>
                  <td>{run.taskId}</td>
                  <td>{run.runId}</td>
                  <td>{t(run.git!.workspaceMode === "worktree" ? "control.workspace.aWorktree" : "control.workspace.aClone")}</td>
                  <td>{run.git!.base === null ? t("common.none") : <code>{short(run.git!.base)}</code>}</td>
                  <td>{run.git!.landedCommit === null ? t("control.git.notLanded") : <code>{short(run.git!.landedCommit)}</code>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </section>
  );
}
