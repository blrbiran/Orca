/**
 * Board spec 2026-10-03 B3, D4-D6: the group's git scheme as the server recorded it. The work branch and the landing shape
 * are facts of the driver (execution driver spec §5.1); each run's mode, base and landing come from its drive record.
 * For a keep group, merging into main and pushing are a person's: shown as waiting on a person, never as queued, and
 * this panel has no button for either. For a group whose integration is not keep, merging and pushing are Orca's per
 * docs/superpowers/specs/2026-10-08-integration-and-panel-fixes-design.md (CLAUDE.md Rule 15 governs agents developing
 * Orca, not Orca at runtime): the area shows the scheme, where its integration stands, and an owner's Retry and Resolve.
 */
import { useContext } from "react";
import type { JSX } from "react";
import { Trans, useTranslation } from "react-i18next";
import { AccountContext, mayHumanOnly } from "./AuthGate.js";
import type { ControlAction } from "./controlApi.js";
import type { GroupIntegrationViewV1, GroupViewV1, RepositoryWorkspaceV1 } from "./controlTypes.js";
import { integrationReasonText, integrationSentence } from "./IntegrationScheme.js";

const short = (commit: string): string => commit.slice(0, 12);
/** Final review Minor 3: only `https://<host>/<owner>/<name>/pull/<n>` is ever a link; anything else is shown as text. */
const PR_URL = /^https:\/\/[A-Za-z0-9.-]+\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/;

/** Integration spec §6.5, §9.1: where a non-keep group's integration stands; an owner may Retry a block and approve a resolution. */
function IntegrationState(props: { groupId: string; revision: number; integration: GroupIntegrationViewV1; onCommand?: (action: ControlAction) => void }): JSX.Element {
  const { t } = useTranslation();
  const mayAct = mayHumanOnly(useContext(AccountContext)) && props.onCommand !== undefined;
  const { integration, groupId, revision } = props;
  const send = (verb: "retry-integration" | "resolve-integration-conflict"): void => props.onCommand?.({ verb, groupId, expectedRevision: revision, payload: {} });
  const commit = (value: string | null): string => (value === null ? t("control.integration.notYet") : short(value));
  const pr = integration.pr;
  const prLabel = pr === null ? "" : t("control.integration.pr", { number: pr.number, state: t(pr.ready ? "control.integration.prReady" : "control.integration.prDraft") });
  return (
    <>
      <li>{integrationSentence(integration.scheme, groupId)}</li>
      <li>{t(integration.frozen ? "control.integration.approved" : "control.integration.unapproved")}</li>
      <li>{t("control.integration.stateLine", { state: t(`control.integration.state.${integration.state}`) })}</li>
      {integration.reason !== null && <li>{t("control.integration.reasonLine", { reason: integrationReasonText(integration.reason) })}</li>}
      <li>{t("control.integration.lastIntegrated", { commit: commit(integration.lastIntegrated) })}</li>
      <li>{t("control.integration.integratedCommit", { commit: commit(integration.integratedCommit) })}</li>
      {pr !== null && <li>{PR_URL.test(pr.url) ? <a href={pr.url}>{prLabel}</a> : prLabel}</li>}
      {mayAct && (integration.state === "blocked" || integration.state === "conflict") && (
        <li><button type="button" onClick={() => send("retry-integration")}>{t("control.integration.retry")}</button></li>
      )}
      {/* Final review Minor 4: a conflict its copy did not reproduce has nothing to approve; Retry recomputes it. */}
      {mayAct && integration.state === "conflict" && integration.reason !== "integration-conflict-unreproducible" && (
        <li><button type="button" onClick={() => send("resolve-integration-conflict")}>{t("control.integration.resolve")}</button></li>
      )}
    </>
  );
}

export function GitScheme(props: { view: GroupViewV1; workspace?: RepositoryWorkspaceV1 | null; onCommand?: (action: ControlAction) => void }): JSX.Element {
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
        {view.integration === undefined
          ? (
            <>
              <li>{t("control.git.merge")}</li>
              <li>{t("control.git.push")}</li>
            </>
          )
          : <IntegrationState groupId={groupId} revision={view.summary.commandRevision} integration={view.integration} onCommand={props.onCommand} />}
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
