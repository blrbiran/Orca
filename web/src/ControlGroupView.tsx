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
import type {
  AgentSelectionPreviewV1, AgentsViewV1, ControlConfigV1, ContinuationSelectionV1, GroupViewV1, OperatorPreferencesV1, RepositoryWorkspaceV1,
  RunViewV1,
} from "./controlTypes.js";
import type { UncertainCommand } from "./controlState.js";
import { LabelChips, TaskDetail, progressText } from "./TaskDetail.js";
import { planText } from "./LoopPlanCard.js";
import { enumText } from "./i18n.js";

const short = (hash: string): string => hash.slice(0, 12);

/**
 * A held run the person may continue: the server marks it `continuable` (handoff delivery spec §13.1 C-4),
 * because a normally completed run also displays as `settled-recoverable` and must never be continued.
 */
export function continuableRuns(view: GroupViewV1): Array<{ run: RunViewV1; checkpointId: string }> {
  return view.runs.flatMap((run) => {
    if (run.taskId === null || run.continuable !== true) return [];
    const checkpoint = view.checkpoints.find((candidate) => candidate.runId === run.runId && candidate.state !== "unknown");
    return checkpoint ? [{ run, checkpointId: checkpoint.checkpointId }] : [];
  });
}

export interface ControlGroupViewProps {
  view: GroupViewV1;
  config: ControlConfigV1;
  uncertain: UncertainCommand[];
  drafts: Record<string, string>;
  onDraft: (key: string, text: string) => void;
  onCommand: (action: ControlAction) => void;
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
}

export function ControlGroupView(props: ControlGroupViewProps): JSX.Element {
  const { view, config, uncertain, drafts, onDraft, onCommand } = props;
  const { t } = useTranslation();
  const groupId = view.summary.groupId;
  const revision = view.summary.commandRevision;
  const handoffActive = view.summary.stopMode === "handoff";
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
  const workspaceMode = props.workspace === undefined ? undefined
    : props.workspace !== null && props.workspace.repoId === view.plan.repoId ? props.workspace.workspaceMode : null;

  return (
    <section aria-label={t("control.group.region", { groupId })}>
      <h2>
        {t("control.group.heading", { groupId, state: enumText("groupState", view.summary.state), revision, projection: view.summary.projectionSeq })}
      </h2>
      {view.summary.claimBlocked && <p role="alert">{t("control.group.claimBlocked")}</p>}
      <p>
        {t("control.group.planLine", { goal: view.plan.goal, hash: short(view.plan.planHash), graphVersion: view.graphVersion })}
      </p>
      {view.stop !== null && (
        <p role="status">
          {t("control.group.stop", {
            mode: enumText("stopMode", view.stop.mode),
            state: enumText("stopState", view.stop.state),
            accepted: view.stop.acceptedAt ?? t("common.na"),
            deadline: view.stop.deadlineAt ?? t("common.none"),
            n: view.stop.frozenRunIds.length,
            runs: view.stop.frozenRunIds.join(", ") || t("common.none"),
          })}
        </p>
      )}
      <BudgetEditor view={view} config={config} drafts={drafts} onDraft={onDraft} onCommand={onCommand} onCommands={props.onCommands} selectionsHash={selectionsHashFor(view, props.preview)} />
      {props.agents !== undefined && (
        <AgentSelectionEditor
          view={view} agents={props.agents} preview={props.preview ?? null} preferences={props.agentPreferences}
          onReread={props.onRereadPreview}
          agentsFailure={props.agentsFailure}
          retryNotice={props.retryNotice}
          drafts={drafts} onDraft={onDraft} onCommand={onCommand}
        />
      )}

      <h3>{t("control.group.workItems")}</h3>
      <DependencyGraph items={view.workItems} openTask={openTask} onOpen={(taskId) => setOpenTask(openTask === taskId ? null : taskId)} />
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
      {openItem !== undefined && <TaskDetail key={openItem.taskId} view={view} item={openItem} drafts={drafts} onDraft={onDraft} onCommand={onCommand} workspaceMode={workspaceMode} />}

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
          {view.runs.map((run) => (
            <tr key={run.runId}>
              <td>{run.taskId ?? run.estimateId ?? run.runId}</td>
              <td>{enumText("runPhase", run.phase)}</td>
              <td>
                {enumText("runState", run.state)}
                {run.blockedReason ? ` — ${run.blockedReason}` : ""}
                {run.failureCode !== null ? ` (${run.failureCode})` : ""}
                {t("control.group.attempt", { attempt: run.providerAttemptOrdinal, claim: run.claimOrdinal ?? t("common.na") })}
                {/* Execution driver final review I5: a run the driver blocked carries its reason on the run, not as a
                    recovery blocker, so its one remedy (spec §2.3, the run-scope recovery-retry) is offered here. */}
                {run.state === "blocked" && run.blockedReason ? (
                  <button
                    type="button"
                    onClick={() => onCommand({ verb: "recovery-retry", groupId, expectedRevision: revision, payload: { scope: "run", runId: run.runId } })}
                  >
                    {t("control.group.retryRun", { id: run.taskId ?? run.runId })}
                  </button>
                ) : null}
              </td>
              <td>{run.profile.profileId} {short(run.profile.profileHash)}</td>
              <td>{run.used.tokens}</td>
              <td>{run.remaining.tokens}</td>
              <td>
                <EvidenceLink runId={run.runId} />
                {run.evidenceIds.length > 0 ? ` ${run.evidenceIds.join(", ")}` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <GitScheme view={view} workspace={props.workspace} />

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
      {view.summary.state === "ready" && !handoffActive && (
        <button type="button" onClick={() => onCommand({ verb: "start", groupId, expectedRevision: revision, payload: {} })}>{t("control.group.start")}</button>
      )}
      {!handoffActive && view.summary.stopMode !== "pause" && (
        <>
          <button type="button" onClick={() => onCommand({ verb: "pause-dispatch", groupId, expectedRevision: revision, payload: {} })}>{t("control.group.pause")}</button>
          <button type="button" onClick={() => onCommand({ verb: "handoff-stop", groupId, expectedRevision: revision, payload: {} })}>{t("control.group.handoffStop")}</button>
        </>
      )}
      {view.summary.stopMode === "pause" && (
        <button type="button" onClick={() => onCommand({ verb: "resume-dispatch", groupId, expectedRevision: revision, payload: {} })}>{t("control.group.resume")}</button>
      )}
      {handoffActive && view.summary.stopState === "handoff-complete" && continuable.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => onCommand({ verb: "resume-from-handoff", groupId, expectedRevision: revision, payload: { selections: selections() } })}
          >
            {t("control.group.continueSelected", { n: continuable.length })}
          </button>
          {continuable.map(({ run, checkpointId }) => (
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
        </>
      )}
      {/* Handoff delivery spec §13.1 I-4: when every frozen run finished or restarted, nothing is continuable,
          and the group's only way out of handoff-complete is a resume with no selections. */}
      {handoffActive && view.summary.stopState === "handoff-complete" && continuable.length === 0 && (
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
      <p>{t("control.group.recent", { commands: view.recentCommandIds.join(", ") || t("common.none") })}</p>
    </section>
  );
}
