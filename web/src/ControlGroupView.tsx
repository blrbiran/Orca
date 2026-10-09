/**
 * Task 9: one group, exactly as the server described it.
 *
 * The buttons here only name an intent and the revision this view was read at;
 * every answer -- accepted, refused, deferred, unknown -- comes back through the
 * reads. A run whose stop is still unresolved stays displayed as unresolved
 * rather than being painted green, because the ledger has not decided whether an
 * execution is still alive.
 */
import type { JSX } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ControlAction } from "./controlApi.js";
import { AgentSelectionEditor, selectionsHashFor } from "./AgentSelectionEditor.js";
import { BudgetEditor } from "./BudgetEditor.js";
import { DependencyGraph } from "./DependencyGraph.js";
import { EvidenceLink } from "./EvidenceLink.js";
import { GitScheme } from "./GitScheme.js";
import { GroupIntegrationConfirm } from "./IntegrationScheme.js";
import { RefusalNotice } from "./RefusalNotice.js";
import { RunReason } from "./RunReason.js";
import { archiveOpen, hasFailureOutcome, retryRunOpen } from "./runFacts.js";
import { UsageSettlement } from "./UsageSettlement.js";
import { SkillsGiven } from "./SkillsGiven.js";
import type {
  AgentSelectionPreviewV1, AgentsViewV1, ControlConfigV1, ContinuationSelectionV1, GroupViewV1, OperatorPreferencesV1, RepositoryIntegrationV1, RepositoryWorkspaceV1,
  RunViewV1,
} from "./controlTypes.js";
import type { ControlRefusal, UncertainCommand } from "./controlState.js";
import { LabelChips, TaskDetail, progressText } from "./TaskDetail.js";
import { planText } from "./LoopPlanCard.js";
import { currentLanguage, enumText } from "./i18n.js";
import { formatTokens, shortTokens } from "./TokenInput.js";
import { capScopeText } from "./UsagePanel.js";

const short = (hash: string): string => hash.slice(0, 12);

/**
 * A held run the person may continue: the server marks it `continuable` (handoff delivery spec §13.1 C-4),
 * because a normally completed run also displays as `settled-recoverable` and must never be continued.
 */
export function continuableRuns(view: GroupViewV1): Array<{ run: RunViewV1; checkpointId: string }> {
  return view.runs.flatMap((run) => {
    if (run.taskId === null || run.continuable !== true || run.state === "settled-failed") return [];
    const checkpoint = view.checkpoints.find((candidate) => candidate.runId === run.runId && candidate.state !== "unknown");
    return checkpoint ? [{ run, checkpointId: checkpoint.checkpointId }] : [];
  });
}

export interface ControlGroupViewProps {
  roles?: readonly import("./auth.js").Role[];
  view: GroupViewV1;
  config: ControlConfigV1;
  uncertain: UncertainCommand[];
  drafts: Record<string, string>;
  onDraft: (key: string, text: string) => void;
  onCommand: (action: ControlAction) => void;
  /** Issue-fixes spec §6.5: the clock the graph's elapsed and no-progress text is read against; the graph reads it itself when absent. */
  now?: number;
  /** W5: commands one control sends in order (BudgetEditor's onCommands). */
  onCommands?: (actions: ControlAction[]) => void;
  /** Agent selection spec §6.8: absent on a page that never reads the installation table (and in older criteria). */
  agents?: AgentsViewV1 | null;
  /** The server's resolution of this group's agent slots; the confirm carries its hash. */
  preview?: AgentSelectionPreviewV1 | null;
  /** This operator's defaults, for the agent an unnamed layer inherits. */
  agentPreferences?: OperatorPreferencesV1 | null;
  /** Drop this group's agent preview and read it again. */
  onRereadPreview?: () => void;
  /** Why the installation table or the preferences could not be read (the server's code). */
  agentsFailure?: string | null;
  /** Ruling review R17: what the page's retry of the agent reads is doing, if anything. */
  retryNotice?: string | null;
  /** Board spec 2026-10-03 B3, D7: the page's read of the repository's workspace mode; absent on pages that never read it. */
  workspace?: RepositoryWorkspaceV1 | null;
/** Project filtering spec §5: the workspace of one repository; preferred over `workspace` for this group's own repository. */
workspaceFor?: (repoId: string) => RepositoryWorkspaceV1 | null;
  /** Integration spec §9.1: a repository's integration read, for the target its confirm step suggests. */
  integrationFor?: (repoId: string) => RepositoryIntegrationV1 | null;
  /** Spec 2026-10-08 §2.2(d): this group's last refusal, shown at the top until a later success of this group. */
  refusal?: ControlRefusal | null;
}

export function ControlGroupView(props: ControlGroupViewProps): JSX.Element {
  const { view, config, uncertain, drafts, onDraft, onCommand } = props;
  const { t } = useTranslation();
  const groupId = view.summary.groupId;
  const revision = view.summary.commandRevision;
  const stopMode = view.summary.stopMode;
  // Issue-fixes spec §3.2 (3): a panel shutdown that froze runs is left the same way as a human handoff-stop, through the
  // resume dialog once its stop state is handoff-complete.
  const handoffActive = stopMode === "handoff" || stopMode === "shutdown";
  // Issue-fixes spec §6.3: the server refuses every command of an archived group but the unarchive (group-archived).
  const archived = view.summary.archived === true;
  const continuable = continuableRuns(view);
  const selections = (): ContinuationSelectionV1[] =>
    continuable.map(({ run, checkpointId }) => ({ taskId: String(run.taskId), predecessorRunId: run.runId, checkpointId }));
  // Labels and progress spec §4.2: the label filter (any of) and the open task live in page memory only.
  const [labelFilter, setLabelFilter] = useState<string[]>([]);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const allLabels = [...new Set(view.workItems.flatMap((item) => item.labels ?? []))].sort();
  // A checked label no task carries any more (removed in the detail editor, or by another read) has no checkbox left to
  // uncheck, so it must stop filtering -- otherwise the table stays empty with no way out.
  const activeFilter = labelFilter.filter((label) => allLabels.includes(label));
  const shownItems = activeFilter.length === 0
    ? view.workItems
    : view.workItems.filter((item) => (item.labels ?? []).some((label) => activeFilter.includes(label)));
  const toggleFilter = (label: string): void =>
    setLabelFilter((current) => (current.includes(label) ? current.filter((other) => other !== label) : [...current, label]));
  const openItem = view.workItems.find((item) => item.taskId === openTask);
  const workspace = props.workspaceFor?.(view.plan.repoId) ?? props.workspace;
  const workspaceMode = workspace === undefined ? undefined
    : workspace !== null && workspace.repoId === view.plan.repoId ? workspace.workspaceMode : null;

  return (
    <section aria-label={t("control.group.region", { groupId })}>
      <h2>
        {t("control.group.heading", { groupId, state: enumText("groupState", view.summary.state), revision, projection: view.summary.projectionSeq })}
      </h2>
      {view.summary.claimBlocked && <p role="alert">{t("control.group.claimBlocked")}</p>}
      {/* Spec 2026-10-08 §2.2(d), §6.5: the group's refusal is among the alerts at the top, above every action. */}
      {props.refusal ? <RefusalNotice refusal={props.refusal} testId="group-refusal" /> : null}
      {/* Issue-fixes spec §3.2 (4): one banner for any stop intent -- how it stopped, its state, and the one way out. */}
      {view.stop !== null && (
        <div role="status" data-testid="stop-banner">
          <p>{t(`control.group.stopBanner.how.${view.stop.mode}` as const)}</p>
          <p>{t(`control.group.stopBanner.exit.${view.stop.state}` as const)}</p>
          <p>
            {t("control.group.stop", {
              mode: enumText("stopMode", view.stop.mode),
              state: enumText("stopState", view.stop.state),
              accepted: view.stop.acceptedAt ?? t("common.na"),
              deadline: view.stop.deadlineAt ?? t("common.none"),
              n: view.stop.frozenRunIds.length,
              runs: view.stop.frozenRunIds.join(", ") || t("common.none"),
            })}
          </p>
        </div>
      )}
      {/* Accounts spec §6.3.1, §7: a claim waiting on a spend cap names the cap and links to the Usage panel. */}
      {view.spendCapBlock && (
        <p role="status" data-testid="spend-cap-block">
          {t("control.group.spendCapBlock", {
            scope: capScopeText(view.spendCapBlock.scope),
            period: t(`usage.capPeriod.${view.spendCapBlock.period}` as const),
            cap: view.spendCapBlock.capTokens,
            grant: view.spendCapBlock.grantTokens,
          })}{" "}
          <a href="#metrics">{t("control.group.spendCapLink")}</a>
        </p>
      )}
      <p>
        {t("control.group.planLine", { goal: view.plan.goal, hash: short(view.plan.planHash), graphVersion: view.graphVersion })}
      </p>
      {archived && (
        <p role="status" aria-label={t("control.group.archivedRegion")}>
          {t("control.group.archivedBanner")}{" "}
          <button type="button" onClick={() => onCommand({ verb: "unarchive-group", groupId, expectedRevision: revision, payload: {} })}>
            {t("control.group.unarchive")}
          </button>
        </p>
      )}
      <DependencyGraph items={view.workItems} runs={view.runs} now={props.now} openTask={openTask} onOpen={(taskId) => setOpenTask(openTask === taskId ? null : taskId)} />
      <h3>{t("control.group.workItems")}</h3>
      {allLabels.length > 0 && (
        <fieldset aria-label={t("control.group.filterRegion")}>
          <legend>{t("control.group.filterLegend")}</legend>
          {allLabels.map((label) => (
            <label key={label}>
              <input type="checkbox" checked={activeFilter.includes(label)} onChange={() => toggleFilter(label)} />
              {label}
            </label>
          ))}
        </fieldset>
      )}
      <table>
        <thead>
          <tr>
            <th>{t("control.group.th.task")}</th><th>{t("control.group.th.status")}</th><th>{t("control.group.th.labels")}</th>
            <th>{t("control.group.th.progress")}</th><th>{t("control.group.th.run")}</th><th>{t("control.group.th.pending")}</th>
            <th>{t("control.group.th.dependsOn")}</th>
          </tr>
        </thead>
        <tbody>
          {shownItems.map((item) => (
            <tr key={item.taskId}>
              <td>
                <button type="button" aria-expanded={openTask === item.taskId} onClick={() => setOpenTask(openTask === item.taskId ? null : item.taskId)}>
                  {item.taskId}
                </button>
              </td>
              <td>{enumText("workStatus", item.status)}</td>
              <td><LabelChips labels={item.labels} />{item.loopPlan ? <span className="plan-chip"> {planText(item.loopPlan.planId, item.loopPlan.planVersion, "name")}</span> : null}</td>
              <td>{progressText(item.progress)}</td>
              <td>{item.currentRunId ?? t("common.none")}</td>
              <td>{item.pendingRunId ?? t("common.none")}</td>
              <td>{item.dependencyTaskIds.join(", ") || t("common.none")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {openItem !== undefined && <TaskDetail key={openItem.taskId} view={view} item={openItem} drafts={drafts} onDraft={onDraft} onCommand={onCommand} workspaceMode={workspaceMode} archived={archived} />}

      <h3>{t("control.group.runs")}</h3>
      <table>
        <thead>
          <tr>
            <th>{t("control.group.runsTh.run")}</th><th>{t("control.group.runsTh.phase")}</th><th>{t("control.group.runsTh.state")}</th>
            <th>{t("control.group.runsTh.profile")}</th><th>{t("control.group.runsTh.used")}</th><th>{t("control.group.runsTh.remaining")}</th>
            <th>{t("control.group.runsTh.evidence")}</th>
          </tr>
        </thead>
        <tbody>
          {view.runs.map((run, index) => (
            <tr key={run.runId}>
              <td>{run.taskId ?? run.estimateId ?? <details><summary>{t("control.group.runLabel", { n: index + 1 })}</summary><code>{run.runId}</code></details>}</td>
              <td>{enumText("runPhase", run.phase)}</td>
              <td className="run-state">
                <div>{enumText("runState", run.state)}</div>
                <div><RunReason run={run} /></div>
                {retryRunOpen(view, run) && <p>{t("control.group.retryFromHead")}</p>}
                <UsageSettlement key={JSON.stringify([revision, run.unknownUsageSettlement, props.roles])} run={run} roles={props.roles} archived={archived} groupId={groupId} revision={revision} onCommand={onCommand} />
                {run.failureCode !== null && <div><code>{run.failureCode}</code></div>}
                <div>{t("control.group.attempt", { attempt: run.providerAttemptOrdinal, claim: run.claimOrdinal ?? t("common.na") })}</div>
                {/* Execution driver final review I5: a run the driver blocked carries its reason on the run, not as a
                    recovery blocker, so its one remedy (spec §2.3, the run-scope recovery-retry) is offered here. */}
                {/* Issue fixes spec §4.2(5): a run ccloop ended failed is retried as a task (a new run), and only where the
                    server accepts retry-task; it never falls back to the run-scope recovery-retry, which refuses a terminal
                    failure (run-terminal-failed). Any other blocked run keeps recovery-retry. */}
                {archived ? null : hasFailureOutcome(run) ? (retryRunOpen(view, run) ? (
                  <button
                    type="button"
                    onClick={() => onCommand({ verb: "retry-task", groupId, expectedRevision: revision, payload: { taskId: String(run.taskId) } })}
                  >
                    {t("control.group.retryTask", { taskId: String(run.taskId) })}
                  </button>
                ) : null) : run.state === "blocked" && run.blockedReason ? (
                  <button
                    type="button"
                    onClick={() => onCommand({ verb: "recovery-retry", groupId, expectedRevision: revision, payload: { scope: "run", runId: run.runId } })}
                  >
                    {t("control.group.retryRun", { id: run.taskId ?? run.runId })}
                  </button>
                ) : null}
              </td>
              <td><details><summary>{run.profile.profileId}</summary><code>{run.profile.profileHash}</code></details></td>
              <td><span title={formatTokens(run.used.tokens, currentLanguage())}>{shortTokens(run.used.tokens, "en")}</span></td>
              <td><span title={formatTokens(run.remaining.tokens, currentLanguage())}>{shortTokens(run.remaining.tokens, "en")}</span></td>
              <td>
                <EvidenceLink runId={run.runId} />
                {run.evidenceIds.length > 0 && <details><summary>{t("control.group.evidenceCount", { n: run.evidenceIds.length })}</summary><ul>{run.evidenceIds.map((id) => <li key={id}><code>{id}</code></li>)}</ul></details>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <BudgetEditor view={view} config={config} drafts={drafts} onDraft={onDraft} onCommand={onCommand} onCommands={props.onCommands} archived={archived} selectionsHash={selectionsHashFor(view, props.preview)}
        suggestedTarget={props.integrationFor?.(view.plan.repoId)?.suggestedTarget ?? null} />
      {props.agents !== undefined && (
        <AgentSelectionEditor
          view={view} agents={props.agents} preview={props.preview ?? null} preferences={props.agentPreferences}
          onReread={props.onRereadPreview}
          agentsFailure={props.agentsFailure}
          retryNotice={props.retryNotice}
          archived={archived}
          drafts={drafts} onDraft={onDraft} onCommand={onCommand}
        />
      )}

      <GitScheme view={view} workspace={workspace} onCommand={onCommand} archived={archived} />
      {/* Fix round 1 F1: a started group's scheme stays an owner's to change, outside the (button-free for keep) Git section. */}
      {view.proposal.state === "confirmed" && (
        <GroupIntegrationConfirm view={view} suggestedTarget={props.integrationFor?.(view.plan.repoId)?.suggestedTarget ?? null} onCommand={onCommand} archived={archived} />
      )}

      <SkillsGiven view={view} />

      {view.handoffRequests.length > 0 && (
        <>
          <h3>{t("control.group.handoffRequests")}</h3>
          <ul>
            {view.handoffRequests.map((request) => (
              <li key={request.requestId}>
                {t("control.group.handoffLine", { requestId: request.requestId, runId: request.runId, state: enumText("requestState", request.state), deadline: request.deadlineAt })}
                {request.failureCode !== null ? ` · ${request.failureCode}` : ""}
                {t("control.group.handoffEvidence", { ids: request.evidenceIds.join(", ") || t("common.none") })}
              </li>
            ))}
          </ul>
        </>
      )}

      {view.estimates.length > 0 && (
        <>
          <h3>{t("control.group.estimates")}</h3>
          <ul>
            {view.estimates.map((estimate) => (
              <li key={estimate.estimateId}>
                {t("control.group.estimateLine", {
                  estimateId: estimate.estimateId,
                  version: estimate.estimateVersion,
                  state: enumText("estimateState", estimate.state),
                  mode: enumText("budgetMode", estimate.mode),
                  profileId: estimate.profile.profileId,
                  hash: short(estimate.profile.profileHash),
                })}
                {estimate.reasonCode !== null ? ` · ${estimate.reasonCode}` : ""}
              </li>
            ))}
          </ul>
        </>
      )}

      {uncertain.length > 0 && (
        <p role="status">{t("control.group.waiting", { commands: uncertain.map((command) => command.commandId).join(", ") })}</p>
      )}

      <h3>{t("control.group.dispatch")}</h3>
      {continuable.length > 0 && <p>{t("control.group.continueFromCheckpoint")}</p>}
      {handoffActive && view.summary.stopState === "handoff-complete" && <p>{t("control.group.resumeForRetry")}</p>}
      {!archived && (
        <>
          {/* Issue-fixes spec §3.2 (4): start refuses every stop intent (stop-mode-conflict), so it is not offered under one. */}
          {view.summary.state === "ready" && stopMode === null && (
            <button type="button" onClick={() => onCommand({ verb: "start", groupId, expectedRevision: revision, payload: {} })}>{t("control.group.start")}</button>
          )}
          {!handoffActive && stopMode !== "pause" && (
            <>
              <button type="button" onClick={() => onCommand({ verb: "pause-dispatch", groupId, expectedRevision: revision, payload: {} })}>{t("control.group.pause")}</button>
              <button type="button" onClick={() => onCommand({ verb: "handoff-stop", groupId, expectedRevision: revision, payload: {} })}>{t("control.group.handoffStop")}</button>
            </>
          )}
          {stopMode === "pause" && (
            <button type="button" onClick={() => onCommand({ verb: "resume-dispatch", groupId, expectedRevision: revision, payload: {} })}>{t("control.group.resume")}</button>
          )}
          {handoffActive && view.summary.stopState === "handoff-complete" && continuable.length > 0 && (
            <button
              type="button"
              onClick={() => onCommand({ verb: "resume-from-handoff", groupId, expectedRevision: revision, payload: { selections: selections() } })}
            >
              {t("control.group.continueSelected", { n: continuable.length })}
            </button>
          )}
          {/* Issue-fixes ruling (Part C flag 2): continue-task is refused under any stop intent, so a single task's
              continuation is offered only once the group has none (for example after a resume with no selections). */}
          {stopMode === null && continuable.map(({ run, checkpointId }) => (
            <button
              key={run.runId}
              type="button"
              onClick={() => onCommand({
                verb: "continue-task",
                groupId,
                taskId: String(run.taskId),
                expectedRevision: revision,
                payload: { predecessorRunId: run.runId, checkpointId },
              })}
            >
              {t("control.group.continueTask", { taskId: String(run.taskId) })}
            </button>
          ))}
          {/* Handoff delivery spec §13.1 I-4: when every frozen run finished or restarted, nothing is continuable,
              and the group's only way out of handoff-complete is a resume with no selections. Issue-fixes ruling (C3
              follow-up): it is offered beside the batch continuation too, so held tasks can then be continued one by one. */}
          {handoffActive && view.summary.stopState === "handoff-complete" && (
            <button
              type="button"
              onClick={() => onCommand({ verb: "resume-from-handoff", groupId, expectedRevision: revision, payload: { selections: [] } })}
            >
              {t("control.group.resumeNoContinuation")}
            </button>
          )}
          {view.recoveryBlockers.length > 0 && (
            <button
              type="button"
              onClick={() => onCommand({ verb: "recovery-retry", groupId, expectedRevision: revision, payload: { scope: "group", groupId } })}
            >
              {t("control.group.retryRecovery", { groupId })}
            </button>
          )}
          {/* Final review M1: offered only where archive-group is accepted (no button the server always refuses). */}
          {archiveOpen(view) && (
            <button type="button" onClick={() => onCommand({ verb: "archive-group", groupId, expectedRevision: revision, payload: {} })}>
              {t("control.group.archive")}
            </button>
          )}
        </>
      )}
      <p>{t("control.group.recent", { commands: view.recentCommandIds.join(", ") || t("common.none") })}</p>
    </section>
  );
}
