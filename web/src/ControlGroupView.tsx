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
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
import { RunOutputBound } from "./RunOutputBound.js";
import { explainEstimateReason } from "./ccloopCodes.js";
import { archiveOpen, hasFailureOutcome, retryRunOpen, runNumberOf } from "./runFacts.js";
import { UsageSettlement } from "./UsageSettlement.js";
import { SkillsGiven } from "./SkillsGiven.js";
import { NeedsHumanBadge, runNeedsHuman, type GroupDecisionsRead } from "./RunDecisions.js";
import type {
  AgentSelectionPreviewV1, AgentsViewV1, ControlConfigV1, ContinuationSelectionV1, GroupViewV1, ModelListState, OperatorPreferencesV1, RepositoryIntegrationV1, RepositoryWorkspaceV1,
  RunViewV1,
} from "./controlTypes.js";
import type { ControlRefusal, UncertainCommand } from "./controlState.js";
import { LabelChips, SavedResultEntry, TaskDetail, progressText } from "./TaskDetail.js";
import { planText } from "./LoopPlanCard.js";
import { currentLanguage, enumText } from "./i18n.js";
import { formatTokens, shortTokens } from "./TokenInput.js";
import { capScopeText } from "./UsagePanel.js";
import { closingText } from "./CorrectionsView.js";
import { isRetryKey } from "./reviewKeys.js";

const short = (hash: string): string => hash.slice(0, 12);
/** Estimate usable-answer spec, correction of 2026-10-20: a withdrawn estimate's reasonCode prefix (the reason follows). */
const WITHDRAWN = "estimate-withdrawn:";

/**
 * Debug task plan Task 13: a group a correction opened says so, with its frozen input's missing pieces, why the original
 * agent was not used, where its checks came from and what its landing did about the correction.
 */
function DebugMark({ debug }: { debug: NonNullable<GroupViewV1["summary"]["debug"]> }): JSX.Element {
  const { t } = useTranslation();
  const missing = debug.missing ?? [];
  return (
    <div className="detail-block" data-testid="debug-mark">
      <p>
        <span className="badge" data-tone="info" data-testid="debug-badge">{t("debugGroup.badge", { ordinal: debug.ordinal })}</span>{" "}
        {t("debugGroup.correction", { correctionId: debug.correctionId })}
      </p>
      {debug.missing !== undefined && (
        <p data-testid="debug-input" data-tone={missing.length > 0 ? "warn" : undefined}>
          {missing.length === 0 ? t("debugGroup.inputComplete") : t("debugGroup.inputMissing", { pieces: missing.map((piece) => t(`debugGroup.piece.${piece}`)).join(t("debugGroup.pieceSeparator")) })}
        </p>
      )}
      {debug.agentFallback != null && <p data-testid="debug-fallback" data-tone="warn">{t("debugGroup.agentFallback", { reason: debug.agentFallback.reason })}</p>}
      {debug.checks !== undefined && (
        <p data-testid="debug-checks">{t(`debugGroup.checks.${debug.checks.from}`, { by: t(`debugGroup.namedBy.${debug.checks.namedBy ?? "none"}`) })}</p>
      )}
      {debug.closing != null && <p data-testid="debug-closing">{closingText(debug.closing)}</p>}
    </div>
  );
}

/** Task 8's reproduce-first check of a debug run: in progress, or skipped (未复现) with the agent's reason. */
function DebugRepro({ run }: { run: RunViewV1 }): JSX.Element | null {
  const { t } = useTranslation();
  if (run.debugRepro === undefined) return null;
  return (
    <div data-testid="debug-repro" data-tone={run.debugRepro.state === "skipped" ? "warn" : "info"}>
      {run.debugRepro.state === "checking" ? t("debugGroup.reproChecking") : t("debugGroup.reproSkipped", { label: t("debugRepro.skipped"), reason: run.debugRepro.reason })}
    </div>
  );
}

/**
 * Feedback #59: the Runs table's display order. The view sends runs in id order (UUIDs); when every run carries its
 * creation position the table shows creation order, else the order it was sent in. Nothing else reorders runs.
 */
function runsInCreationOrder(runs: readonly RunViewV1[]): readonly RunViewV1[] {
  return runs.every((run) => run.createdOrdinal !== undefined)
    ? [...runs].sort((left, right) => left.createdOrdinal! - right.createdOrdinal!)
    : runs;
}

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

/** The retry-task the Runs table's and the task detail's Retry task buttons send; the `r` key sends this same one (issue #57). */
function retryTaskAction(view: GroupViewV1, run: RunViewV1): ControlAction {
  return { verb: "retry-task", groupId: view.summary.groupId, expectedRevision: view.summary.commandRevision, payload: { taskId: String(run.taskId) } };
}

/** A run's retry, as the Runs table offers it; the Problems row and the work item row offer this same one (feedback #56/#57). */
function RunRetry({ view, run, archived, onCommand, active = true }: { view: GroupViewV1; run: RunViewV1; archived: boolean; onCommand: (action: ControlAction) => void; active?: boolean }): JSX.Element | null {
  const { t } = useTranslation();
  const groupId = view.summary.groupId;
  const revision = view.summary.commandRevision;
  // Execution driver final review I5: a run the driver blocked carries its reason on the run, not as a
  // recovery blocker, so its one remedy (spec §2.3, the run-scope recovery-retry) is offered here.
  // Issue fixes spec §4.2(5): a run ccloop ended failed is retried as a task (a new run), and only where the
  // server accepts retry-task; it never falls back to the run-scope recovery-retry, which refuses a terminal
  // failure (run-terminal-failed). Any other blocked run keeps recovery-retry.
  // The budget-reservation hint travels with the retry wherever it is offered (Runs table, Problems row, work item row);
  // a row in a hidden pane (`active` false) does not repeat it, as it does not repeat the settlement's reason.
  const button = hasFailureOutcome(run) ? (retryRunOpen(view, run) ? (
    <button
      type="button"
      onClick={() => onCommand(retryTaskAction(view, run))}
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
  ) : null;
  return archived ? null : <>{active && retryRunOpen(view, run) && <p>{t("control.group.retryFromHead")}</p>}{button}</>;
}

import { overviewRegionId } from "./overviewNavigation.js";
import { GroupResults } from "./GroupResults.js";
import { GroupDetailRegions } from "./GroupDetailRegions.js";
import { defaultDetailRegion, focusedDetailRegion, runRegionId, type DetailRegion } from "./detailRegion.js";
import type { OverviewTarget } from "./overviewNavigation.js";

export interface ControlGroupViewProps {
  active?: boolean;
  resultsScope?: string;
  focusRequest?: number;
  focus?: Extract<OverviewTarget, { kind: "group" }> | null;
  roles?: readonly import("./auth.js").Role[];
  view: GroupViewV1;
  config: ControlConfigV1;
  uncertain: UncertainCommand[];
  drafts: Record<string, string>;
  onDraft: (key: string, text: string) => void;
  onCommand: (action: ControlAction) => void;
  onSourceRequirement?: (groupId: string) => void;
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
  /** Spec 2026-10-15 §5 (R3): each installation's model list as last read, and (owner only) re-probing one. */
  models?: (installationId: string) => ModelListState | undefined;
  onRefreshModels?: (installationId: string) => void;
  /** Board spec 2026-10-03 B3, D7: the page's read of the repository's workspace mode; absent on pages that never read it. */
  workspace?: RepositoryWorkspaceV1 | null;
/** Project filtering spec §5: the workspace of one repository; preferred over `workspace` for this group's own repository. */
workspaceFor?: (repoId: string) => RepositoryWorkspaceV1 | null;
  /** Integration spec §9.1: a repository's integration read, for the target its confirm step suggests. */
  integrationFor?: (repoId: string) => RepositoryIntegrationV1 | null;
  /** Spec 2026-10-08 §2.2(d): this group's last refusal, shown at the top until a later success of this group. */
  refusal?: ControlRefusal | null;
  /** Control run decisions plan Task 11: this group's decisions as last read (or its failed read); absent or null shows no badge and no section. */
  decisions?: GroupDecisionsRead | null;
  /** Open a decision's detail, where it is corrected (App.tsx). */
  onCorrectDecision?: (projectKey: string, decisionId: string) => void;
}

/** The version of the estimate with this id in the same group; the id itself when the list does not carry it. */
function estimateVersionOf(view: GroupViewV1, estimateId: string): string {
  const found = view.estimates.find((candidate) => candidate.estimateId === estimateId);
  return found === undefined ? estimateId : String(found.estimateVersion);
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
  const retryableCount = view.runs.filter((run) => retryRunOpen(view, run)).length;
  const unresolvedWork = new Set(view.workItems.filter((item) => item.status === "start-unknown").map((item) => `task:${item.taskId}`));
  const unresolvedKey = (runId: string): string => {
    const taskId = view.runs.find((run) => run.runId === runId)?.taskId;
    return taskId === null || taskId === undefined ? `run:${runId}` : `task:${taskId}`;
  };
  for (const run of view.runs) if (run.state === "unknown" || run.state === "attempt-unknown") unresolvedWork.add(unresolvedKey(run.runId));
  for (const blocker of view.recoveryBlockers) if (blocker.scope === "run" && blocker.runId !== null) unresolvedWork.add(unresolvedKey(blocker.runId));
  const unresolvedCount = unresolvedWork.size;
  const selections = (): ContinuationSelectionV1[] =>
    continuable.map(({ run, checkpointId }) => ({ taskId: String(run.taskId), predecessorRunId: run.runId, checkpointId }));
  // Labels and progress spec §4.2: the label filter (any of) and the open task live in page memory only.
  const [labelFilter, setLabelFilter] = useState<string[]>([]);
  const [openTask, setOpenTask] = useState<string | null>(props.focus?.groupId === groupId ? props.focus.taskId : null);
  useLayoutEffect(() => { if (props.focus?.groupId === groupId && props.focus.taskId !== null) setOpenTask(props.focus.taskId); }, [props.focus, props.focusRequest]);
  const [region, setRegion] = useState<DetailRegion>(() => props.focus?.groupId === groupId ? focusedDetailRegion(view, props.focus.region) : defaultDetailRegion(view));
  // Only explicit navigation selects a region; projection changes keep the person's current choice.
  useLayoutEffect(() => { if (props.focus?.groupId === groupId) setRegion(focusedDetailRegion(view, props.focus.region)); }, [props.focus, props.focusRequest]);
  const [requestedRun, setRequestedRun] = useState<string | null>(null);
  useLayoutEffect(() => { if (region === "runs" && requestedRun !== null) document.getElementById(runRegionId(groupId, requestedRun))?.focus(); }, [region, requestedRun]);
  const openRun = (runId: string): void => { setRequestedRun(runId); setRegion("runs"); };
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
  // Issue #57: `r` retries the open task's current run where the task detail offers its Retry task button (retryRunOpen),
  // like Decisions' keys only from the page body or inside this group, and never from a hidden pane.
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (props.active === false) return;
    const onKey = (event: KeyboardEvent): void => {
      if (!isRetryKey(event)) return;
      const target = event.target as Node | null;
      if (target !== document.body && (target === null || sectionRef.current?.contains(target) !== true)) return;
      const run = openItem?.currentRunId == null ? undefined : view.runs.find((candidate) => candidate.runId === openItem.currentRunId);
      if (run === undefined || !retryRunOpen(view, run)) return;
      event.preventDefault();
      onCommand(retryTaskAction(view, run));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const workspace = props.workspaceFor?.(view.plan.repoId) ?? props.workspace;
  // A read of another group (the page's last one, while this group's is on its way) is no read of this one.
  const read = props.decisions ?? null;
  const decisions = read !== null && !("failed" in read) && read.groupId === groupId ? read : null;
  const decisionsFailed = read !== null && "failed" in read ? read.failed : null;
  const taskNeedsHuman = (taskId: string): boolean => decisions?.tasks.some((task) => task.taskId === taskId && task.runs.some(runNeedsHuman)) === true;
  const workspaceMode = workspace === undefined ? undefined
    : workspace !== null && workspace.repoId === view.plan.repoId ? workspace.workspaceMode : null;

  // Feedback #56/#57: a run's remedies -- retry, settlement, saved-result verification -- beside its reason wherever a row
  // shows one, each the existing button behind its existing gate. Verification belongs to the task's current run.
  // `active`: the row's pane is the one shown. Hidden panes stay mounted, and each eligibility read spawns a ccloop child,
  // so a hidden row neither reads eligibility nor repeats the settlement's one-line reason (fix round 1).
  const remedies = (run: RunViewV1, active: boolean): JSX.Element => {
    const item = view.workItems.find((candidate) => candidate.taskId === run.taskId && candidate.currentRunId === run.runId);
    return <div key={`remedies-${run.runId}`}>
      <RunRetry view={view} run={run} archived={archived} onCommand={onCommand} active={active} />
      <UsageSettlement compact active={active} key={JSON.stringify([revision, run.unknownUsageSettlement, props.roles])} run={run} roles={props.roles} archived={archived} groupId={groupId} revision={revision} onCommand={onCommand} />
      {item !== undefined && <SavedResultEntry view={view} item={item} onCommand={onCommand} archived={archived} active={active} />}
    </div>;
  };

  const dispatchControls = (<>
      <div id={overviewRegionId("group", groupId, "dispatch")} tabIndex={-1} data-overview-region="dispatch">
      <h3>{t("control.group.dispatch")}</h3>
      <dl className="execution-work-kinds">
        <dt>{t("control.group.continuableWork")}</dt><dd>{continuable.length}</dd>
        <dt>{t("control.group.retryableWork")}</dt><dd>{retryableCount}</dd>
        <dt>{t("control.group.unresolvedWork")}</dt><dd>{unresolvedCount}</dd>
      </dl>
      {continuable.length > 0 && <p>{t("control.group.continueFromCheckpoint")}</p>}
      {handoffActive && view.summary.stopState === "handoff-complete" && <p>{t("control.group.resumeForRetry")}</p>}
      {!archived && (
        <>
          {/* Issue-fixes spec §3.2 (4): start refuses every stop intent (stop-mode-conflict), so it is not offered under one. */}
          {/* Feedback #53: a Web-started group stays ready through its first run; executionPending is the server's "not startable". */}
          {view.summary.state === "ready" && view.summary.executionPending !== true && stopMode === null && (
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
      </div>
  </>);

  return (
    <section ref={sectionRef} aria-label={t("control.group.region", { groupId })}>
      <h2>
        {t("control.group.heading", { groupId, state: enumText("groupState", view.summary.state), revision, projection: view.summary.projectionSeq })}
      </h2>
      {decisions !== null && decisions.pendingCount > 0 && <p><NeedsHumanBadge testId="group-needs-human" /></p>}
      {/* Kanban spec §9a: flagged decisions are shown at the top, red; nothing waits on them. */}
      {decisions !== null && (decisions.flaggedCount ?? 0) > 0 && (
        <p><span className="badge" data-tone="danger" data-testid="group-flagged">{t("control.decisions.groupFlagged", { count: decisions.flaggedCount })}</span></p>
      )}
      {/* Final review T11 (Rule 12): a failed decisions read is said for the group too, not only inside an open task. */}
      {decisionsFailed !== null && <p data-testid="group-decisions-read-failed">{t("control.decisions.readFailed", { code: decisionsFailed })}</p>}
      {view.summary.claimBlocked && <p role="alert">{t("control.group.claimBlocked")}</p>}
      {/* Spec 2026-10-08 §2.2(d), §6.5: the group's refusal is among the alerts at the top, above every action. */}
      {props.refusal ? <RefusalNotice refusal={props.refusal} testId="group-refusal" /> : null}
      {/* Issue-fixes spec §3.2 (4): one banner for any stop intent -- how it stopped, its state, and the one way out. */}
      {view.stop !== null && (
        <div role="status" data-testid="stop-banner">
          <strong>{t(view.stop.state === "handoff-pending" || view.stop.state === "handoff-unresolved" ? "control.group.stopping" : "control.group.stopped")}</strong>{" · "}
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
      {view.summary.debug !== undefined && <DebugMark debug={view.summary.debug} />}
      {view.summary.requirement !== undefined && <a href="#requirements" onClick={() => props.onSourceRequirement?.(groupId)}>{t("control.group.sourceRequirement")}</a>}
      {archived && (
        <p role="status" aria-label={t("control.group.archivedRegion")}>
          {t("control.group.archivedBanner")}{" "}
          <button type="button" onClick={() => onCommand({ verb: "unarchive-group", groupId, expectedRevision: revision, payload: {} })}>
            {t("control.group.unarchive")}
          </button>
        </p>
      )}
      <p>{t(view.summary.state === "review" ? "detail.goalReview" : "detail.nextAction")}</p>
      {/* Issue #47: the execution controls are one bar above the region tabs, shown whatever tab is open. */}
      {dispatchControls}
      <GroupDetailRegions groupId={groupId} selected={region} onSelect={setRegion} regions={{
        progress: <>
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
                {taskNeedsHuman(item.taskId) && <> <NeedsHumanBadge /></>}
              </td>
              <td>{enumText("workStatus", item.status)}{view.runs.filter(run => run.runId === item.currentRunId).map(run => <RunReason key={run.runId} run={run} />)}
                {view.runs.filter(run => run.runId === item.currentRunId).map(run => remedies(run, props.active !== false && region === "progress"))}</td>
              <td><LabelChips labels={item.labels} />{item.loopPlan ? <span className="plan-chip"> {planText(item.loopPlan.planId, item.loopPlan.planVersion, "name")}</span> : null}</td>
              <td>{progressText(item.progress)}</td>
              <td>{item.currentRunId ?? t("common.none")}</td>
              <td>{item.pendingRunId ?? t("common.none")}</td>
              <td>{item.dependencyTaskIds.join(", ") || t("common.none")}</td>
            </tr>
          ))}
        </tbody>
      </table>

        </>,
        preparation: <>
      <section aria-label={t("control.preparation.reviewTitle")}>
        <h3>{t("control.preparation.reviewTitle")}</h3>
        <p>{t("control.preparation.goal", { goal: view.plan.goal })}</p>
        <ul>{view.plan.successConditions.map((condition, index) => <li key={index}>{condition}</li>)}</ul>
        <p>{t("control.preparation.agentReview")}</p>
        <p>{t("control.preparation.workspace", { mode: workspaceMode ?? t("common.unknown") })}</p>
        <p>{t("control.preparation.integrationReview")}</p>
        <p>{t("control.preparation.tokenPolicy")}</p>
        <p>{t("control.preparation.sequence")}</p>
      </section>
      <BudgetEditor view={view} config={config} drafts={drafts} onDraft={onDraft} onCommand={onCommand} onCommands={props.onCommands} archived={archived} selectionsHash={selectionsHashFor(view, props.preview)}
        suggestedTarget={props.integrationFor?.(view.plan.repoId)?.suggestedTarget ?? null} />
      {props.agents !== undefined && (
        <AgentSelectionEditor
          view={view} agents={props.agents} preview={props.preview ?? null} preferences={props.agentPreferences}
          onReread={props.onRereadPreview}
          agentsFailure={props.agentsFailure}
          retryNotice={props.retryNotice}
          models={props.models} onRefreshModels={props.onRefreshModels}
          archived={archived}
          drafts={drafts} onDraft={onDraft} onCommand={onCommand}
        />
      )}
</>,
        problem: <>
      <h3>{t("detail.problem")}</h3>
      {view.recoveryBlockers.map((blocker, index) => <p key={index}>{blocker.code}</p>)}
      {view.runs.filter(run => hasFailureOutcome(run) || run.state === "blocked" || run.unknownUsageSettlement !== undefined || run.runId === props.focus?.runId).map(run => <div key={run.runId} data-problem-run-id={run.runId} tabIndex={-1}>
        <p>{run.taskId ?? run.runId} · {enumText("runState", run.state)} <RunReason run={run} /></p>
        <RunOutputBound run={run} />
        {remedies(run, props.active !== false && region === "problem")}
        <button type="button" onClick={() => openRun(run.runId)}>{t("detail.openRun", { runId: run.runId })}</button>
      </div>)}
</>,
        results: <>
      <GroupResults view={view} active={props.active !== false && region === "results"} scope={props.resultsScope ?? ""} />
      <p>{t("detail.resultsEvidence")}</p>
      {view.runs.map(run => <button key={run.runId} type="button" onClick={() => openRun(run.runId)}>{t("detail.openRun", { runId: run.runId })}</button>)}
      <div id={overviewRegionId("group", groupId, "integration")} tabIndex={-1} data-overview-region="integration">
      <GitScheme view={view} workspace={workspace} onCommand={onCommand} archived={archived} />
      {/* Fix round 1 F1: a started group's scheme stays an owner's to change, outside the (button-free for keep) Git section. */}
      {view.proposal.state === "confirmed" && (
        <GroupIntegrationConfirm view={view} suggestedTarget={props.integrationFor?.(view.plan.repoId)?.suggestedTarget ?? null} onCommand={onCommand} archived={archived} />
      )}

      </div>
</>,
        runs: <>
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
          {runsInCreationOrder(view.runs).map((run, index, orderedRuns) => (
            <tr key={run.runId} id={runRegionId(groupId, run.runId)} tabIndex={-1} data-run-id={run.runId}>
              <td>{run.taskId ?? run.estimateId ?? <details><summary>{t("control.group.runLabel", { n: index + 1 })}</summary><code>{run.runId}</code></details>}</td>
              <td>{enumText("runPhase", run.phase)}</td>
              <td className="run-state">
                <div>{enumText("runState", run.state)}</div>
                <div><RunReason run={run} /></div>
                <DebugRepro run={run} />
                <RunOutputBound run={run} />
                <UsageSettlement key={JSON.stringify([revision, run.unknownUsageSettlement, props.roles])} run={run} roles={props.roles} archived={archived} groupId={groupId} revision={revision} onCommand={onCommand} />
                {run.failureCode !== null && <div><code>{run.failureCode}</code></div>}
                <div>{t("control.group.attempt", { attempt: run.providerAttemptOrdinal, claim: run.claimOrdinal ?? t("common.na") })}{runNumberOf(view, run, orderedRuns.slice(0, index + 1)) > 0 ? t("control.group.taskRun", { n: runNumberOf(view, run, orderedRuns.slice(0, index + 1)) }) : ""}</div>
                <RunRetry view={view} run={run} archived={archived} onCommand={onCommand} />
              </td>
              <td><details><summary>{run.profile.profileId}</summary><code>{run.profile.profileHash}</code></details></td>
              <td><span title={formatTokens(run.used.tokens, currentLanguage())}>{shortTokens(run.used.tokens, "en")}</span></td>
              <td>{run.remaining.tokens===null ? t(run.tokenRemainingStatus==="unknown"?"control.progress.tokensUnknown":"budget.unlimited") : <span title={formatTokens(run.remaining.tokens, currentLanguage())}>{shortTokens(run.remaining.tokens, "en")}</span>}</td>
              <td>
                <EvidenceLink runId={run.runId} />
                {run.evidenceIds.length > 0 && <details><summary>{t("control.group.evidenceCount", { n: run.evidenceIds.length })}</summary><ul>{run.evidenceIds.map((id) => <li key={id}><code>{id}</code></li>)}</ul></details>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

</>,
        technical: <>
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
                  profileId: estimate.profile?.profileId ?? t("budget.noEstimator"),
                  hash: estimate.profile === null ? "" : short(estimate.profile.profileHash),
                })}
                {estimate.reasonCode !== null ? ` · ${estimate.reasonCode}` : ""}
                {estimate.reasonCode !== null && explainEstimateReason(estimate.reasonCode) !== null ? ` · ${explainEstimateReason(estimate.reasonCode)}` : ""}
                {estimate.compatibilityReasonCodes?.length ? ` · ${estimate.compatibilityReasonCodes.join(", ")}` : ""}
                {(estimate.repairs ?? []).length > 0 ? ` · ${t("control.group.estimateRepaired", { codes: (estimate.repairs ?? []).join(", ") })}` : ""}
                {estimate.origin !== undefined ? ` · ${t("control.group.estimateRetryOf", { version: estimateVersionOf(view, estimate.origin.of) })}` : ""}
                {estimate.retriedAs !== undefined ? ` · ${t("control.group.estimateRetriedAs", { version: estimateVersionOf(view, estimate.retriedAs) })}` : ""}
                {estimate.retrySkipped !== undefined ? ` · ${t("control.group.estimateRetrySkipped", { code: estimate.retrySkipped })}` : ""}
                {estimate.state === "withdrawn" && estimate.reasonCode?.startsWith(WITHDRAWN) ? ` · ${t("control.group.estimateWithdrawn", { reason: enumText("estimateWithdrawnReason", estimate.reasonCode.slice(WITHDRAWN.length)) })}` : ""}
              </li>
            ))}
          </ul>
        </>
      )}

      {uncertain.length > 0 && (
        <p role="status">{t("control.group.waiting", { commands: uncertain.map((command) => command.commandId).join(", ") })}</p>
      )}

</>,
      }} />
      {openItem !== undefined && <TaskDetail key={openItem.taskId} view={view} item={openItem} roles={props.roles} drafts={drafts} onDraft={onDraft} onCommand={onCommand} workspaceMode={workspaceMode} archived={archived} decisions={decisions} decisionsFailed={decisionsFailed} onCorrectDecision={props.onCorrectDecision} resultsActive={props.active !== false && region === "results"} resultsScope={props.resultsScope ?? ""} />}
    </section>
  );
}
