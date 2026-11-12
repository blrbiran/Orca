/**
 * Task 9: one group, exactly as the server described it.
 *
 * The buttons here only name an intent and the revision this view was read at;
 * every answer -- accepted, refused, deferred, unknown -- comes back through the
 * reads. A run whose stop is still unresolved stays displayed as unresolved
 * rather than being painted green, because the ledger has not decided whether an
 * execution is still alive.
 */
import { ChargeRetry } from "./ChargeRetry.js";
import type { JSX } from "react";
import { Fragment, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { actionRow, chipRow, taskGoal } from "./ui/classes.js";
import { Menu, MenuItem } from "./ui/Menu.js";
import { useTranslation } from "react-i18next";
import { scheduleIdFor, type ControlAction } from "./controlApi.js";
import { AccountContext, mayHumanOnly } from "./AuthGate.js";
import { AgentSelectionEditor, selectionsHashFor } from "./AgentSelectionEditor.js";
import { BudgetEditor } from "./BudgetEditor.js";
import { goalSummary } from "./CardGoal.js";
import { DependencyGraph } from "./DependencyGraph.js";
import { EvidenceLink } from "./EvidenceLink.js";
import { FolderPlacementBlock } from "./FolderPlacement.js";
import { GitScheme } from "./GitScheme.js";
import { reviewWording } from "./groupCategory.js";
import { GroupIntegrationConfirm } from "./IntegrationScheme.js";
import { MultiDirLandingBlock } from "./MultiDirLanding.js";
import { RefusalNotice } from "./RefusalNotice.js";
import { RunReason } from "./RunReason.js";
import { RunOutputBound } from "./RunOutputBound.js";
import { RunPostMergeCheck } from "./RunPostMergeCheck.js";
import { GroupAcceptanceProblem } from "./GroupAcceptanceProblem.js";
import { GroupFullSuiteWarning } from "./GroupFullSuiteWarning.js";
import { RequirementReviewPanel } from "./RequirementReviewPanel.js";
import { LandingWatchProblem } from "./LandingWatchProblem.js";
import { GroupAllowances } from "./GroupAllowances.js";
import { explainEstimateReason } from "./ccloopCodes.js";
import { archiveOpen, hasFailureOutcome, retryRunOpen, runNumberOf, shownWorkStatus } from "./runFacts.js";
import { UsageSettlement } from "./UsageSettlement.js";
import { SkillsGiven } from "./SkillsGiven.js";
import { NeedsHumanBadge, runNeedsHuman, type GroupDecisionsRead } from "./RunDecisions.js";
import type {
  AgentSelectionPreviewV1, AgentsViewV1, AmountDimensionV1, ControlConfigV1, ContinuationSelectionV1, GroupOrchestrationV1, GroupViewV1, ModelListState, OperatorPreferencesV1, RepositoryIntegrationV1, RepositoryWorkspaceV1,
  RunViewV1, WorkItemViewV1,
} from "./controlTypes.js";
import type { ControlRefusal, UncertainCommand } from "./controlState.js";
import { LabelChips, SavedResultEntry, TaskDetail, expectedText, progressText } from "./TaskDetail.js";
import { NoChangeChip } from "./NoChange.js";
import { RunTranscript } from "./AgentTranscript.js";
import { ObservedPathRetry } from "./ObservedPathRetry.js";
import { planText } from "./LoopPlanCard.js";
import { currentLanguage, enumText } from "./i18n.js";
import { Tokens, formatTokens, shortTokens } from "./TokenInput.js";
import { capScopeText } from "./UsagePanel.js";
import { closingText } from "./CorrectionsView.js";
import { isRetryKey } from "./reviewKeys.js";
import { useClock } from "./clock.js";
import { LiveNoteBox, LiveNoteList } from "./LiveNotes.js";
import { GroupHandoffs } from "./GroupHandoffs.js";
import { NOTE_MAX_BYTES, utf8Bytes, type NoteScope } from "./operatorNote.js";
import { Select } from "./ui/Select.js";

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

/** #226 (i): a work item whose current run is in flight -- what the Live region lists. */
const IN_FLIGHT: ReadonlySet<WorkItemViewV1["status"]> = new Set(["starting", "active", "continuing"]);

/** The work Live lists as running now -- also what the Live tab's hint counts, so the two never disagree. */
function runningNow(view: GroupViewV1): Array<{ taskId: string; run: RunViewV1 }> {
  return view.workItems.flatMap((item) => {
    const run = item.currentRunId === null ? undefined : view.runs.find((candidate) => candidate.runId === item.currentRunId);
    return run !== undefined && (IN_FLIGHT.has(item.status) || item.category === "running") ? [{ taskId: item.taskId, run }] : [];
  });
}

/** The runs the Problems region lists (a focused run is shown there too, but is not a problem the tab counts). */
const isProblemRun = (run: RunViewV1): boolean => hasFailureOutcome(run) || run.state === "blocked" || run.unknownUsageSettlement !== undefined;

/**
 * #226 (i): the group's Live region -- each work item running now with its run's phase, attempt, tokens and elapsed time
 * and its transcript, opened by itself on the latest call; with nothing running, the most recent run. `active` is the
 * region being shown: the pane stays mounted when hidden, and a hidden transcript must ask nothing.
 */
function LiveRegion(props: { view: GroupViewV1; active: boolean; now?: number; archived: boolean; onCommand: (action: ControlAction) => void }): JSX.Element {
  const { t } = useTranslation();
  const ticking = useClock(30_000);
  const now = props.now ?? ticking;
  const { view } = props;
  const running = runningNow(view);
  const latest = running.length === 0 ? runsInCreationOrder(view.runs).at(-1) : undefined;
  const shown = latest === undefined ? running : [{ taskId: latest.taskId ?? latest.runId, run: latest }];
  const facts = (run: RunViewV1): string => [
    t("control.group.liveFacts", { phase: enumText("runPhase", run.phase), attempt: run.providerAttemptOrdinal }),
    // Tester D19: the agent and model this run was frozen with.
    ...(run.agent === undefined ? [] : [run.agent.model === null
      ? t("control.group.liveAgentDefault", { installation: run.agent.installation })
      : t("control.group.liveAgent", { installation: run.agent.installation, model: run.agent.model })]),
    t("control.group.liveTokens", { tokens: shortTokens(run.used.tokens) }),
    ...(run.startedAt != null ? [t("control.group.liveElapsed", { minutes: Math.max(0, Math.floor(((run.endedAt ?? now) - run.startedAt) / 60_000)) })] : []),
  ].join(" · ");
  return <>
    {running.length === 0 && <p>{t(latest === undefined ? "control.group.liveNone" : "control.group.liveLatest")}</p>}
    {shown.map(({ taskId, run }) => {
      const name = t(latest === undefined ? "control.group.liveItem" : "control.group.liveLatestItem", { taskId });
      return <section key={run.runId} aria-label={name}>
        <h4>{name}</h4>
        <p className="num" title={formatTokens(run.used.tokens, currentLanguage())}>{enumText("runState", run.state)} · {facts(run)}</p>
        <RunTranscript runId={run.runId} active={props.active} follow />
        {/* Tester follow-up G Part 5: the task's notes and the box to add one, at the bottom of its Live entry. */}
        {run.taskId !== null && <>
          <LiveNoteList notes={(view.liveNotes ?? []).filter((note) => note.taskId === run.taskId)} running={latest === undefined} />
          <LiveNoteBox view={view} taskId={run.taskId} archived={props.archived} onCommand={props.onCommand} />
        </>}
      </section>;
    })}
  </>;
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
  return { verb: "retry-task", groupId: view.summary.groupId, expectedRevision: view.summary.commandRevision, payload: { taskId: String(run.taskId), runId: run.runId } };
}

/**
 * Spec 2026-10-27 single-call unknown usage §9 R1: an estimate run whose usage is unknown and whose block reason says so --
 * still blocked, or (code review S1) closed by a stop with its usage still unknown (the server's settlement preview is
 * then present and unsettled). Either is settled by charging its grant.
 */
const estimateUsageUnknown = (run: RunViewV1): boolean => run.estimateId !== null && /^estimate-usage-unknown(:|$)/.test(run.blockedReason ?? "")
  && (run.state === "blocked" || (run.state.startsWith("settled-") && run.unknownUsageSettlement !== undefined && run.unknownUsageSettlement.settlement === undefined));

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
  ) : null) : estimateUsageUnknown(run) ? (
    // Spec 2026-10-27 single-call unknown usage §9 R1: an estimate blocked on unknown usage is retried by charging its grant.
    <ChargeRetry charge={{ tokens: run.remaining.tokens ?? 0, usageLowerBound: run.usageLowerBound ?? null }}
      onCharge={() => onCommand({ verb: "recovery-retry", groupId, expectedRevision: revision, payload: { scope: "run", runId: run.runId, acknowledge: "charge-remaining-grant" } })}
      onChargeFloor={() => onCommand({ verb: "recovery-retry", groupId, expectedRevision: revision, payload: { scope: "run", runId: run.runId, acknowledge: "charge-observed-floor" } })} />
  ) : run.state === "blocked" && run.blockedReason ? (
    <button
      type="button"
      onClick={() => onCommand({ verb: "recovery-retry", groupId, expectedRevision: revision, payload: { scope: "run", runId: run.runId } })}
    >
      {t("control.group.retryRun", { id: run.taskId ?? run.runId })}
    </button>
  ) : null;
  return archived ? null : <>{active && retryRunOpen(view, run) && <><p>{t("control.group.retryFromHead")}</p><p>{t("control.group.retryKeepsPaths")}</p></>}{button}{active && retryRunOpen(view, run) && <ObservedPathRetry view={view} run={run} onCommand={onCommand} />}</>;
}

import { overviewRegionId } from "./overviewNavigation.js";
import { GroupResults } from "./GroupResults.js";
import { GroupDetailRegions } from "./GroupDetailRegions.js";
import { RegionDrafts } from "./regionDraft.js";
import { ReviewDetail } from "./ReviewDetail.js";
import type { GroupDecisionsViewV1 } from "./controlTypes.js";
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
  onCommand: (action: ControlAction) => void | Promise<number | null>;
  onSourceRequirement?: (groupId: string) => void;
  /** Open a criteria-review group from its parent's detail using the existing group navigator. */
  onSelectGroup?: (groupId: string) => void;
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
  /** Review-exit spec 2026-11-05 §3.4 (D4): this group's start was queued at the cap; how many groups go first. */
  startQueued?: number;
  /** Control run decisions plan Task 11: this group's decisions as last read (or its failed read); absent or null shows no badge and no section. */
  decisions?: GroupDecisionsRead | null;
  /** Open a decision's detail, where it is corrected (App.tsx). */
  onCorrectDecision?: (projectKey: string, decisionId: string, origin?: { groupId: string; taskId: string | null; runId: string }) => void;
  /** Tester round 2 §9.3 (H11): the route naming this group; its region and open task come from it. */
  route?: { region: DetailRegion | null; taskId: string | null } | null;
  /** §9.3: a region tab, an opened or closed task -- reported up so App writes it to the URL (replace). */
  onRouteChange?: (region: DetailRegion, taskId: string | null) => void;
  /** Checks spec 2026-10-22 §6.6: another group's command revision (a review group's, to dismiss its finding); null if unknown. */
  revisionOf?: (groupId: string) => number | null;
}

/**
 * Checks spec 2026-10-22 §6.5, §6.6 (review focus 5): a model-review finding in a group's decisions. Its flag's row is the
 * review group's, so Dismiss (ratify-flagged-decision with the person's note) targets the REVIEW group under that group's
 * revision, whatever group's view it is dismissed from; with that revision unknown it cannot be sent. Major red, minor grey.
 */
function FindingFlag(props: {
  flag: NonNullable<GroupDecisionsViewV1["groupFlags"]>[number]; groupId: string; revision: number; archived: boolean;
  revisionOf?: (groupId: string) => number | null; onCommand: (action: ControlAction) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const { flag } = props;
  const [note, setNote] = useState("");
  const [detail, setDetail] = useState(false);
  const owner = flag.ownerGroupId ?? props.groupId;
  const ownerRevision = flag.ownerGroupId === undefined ? (props.archived ? null : props.revision) : props.revisionOf?.(owner) ?? null;
  const severity = flag.severity ?? "major";
  return (
    <div data-testid="group-flag">
      <span className="badge" data-testid="group-flag-severity" {...(severity === "major" ? { "data-tone": "danger" } : {})}>{t(`control.decisions.severity.${severity}` as const)}</span>{" "}
      {t("control.decisions.flaggedReason", { source: flag.source, reason: flag.reason })}
      {flag.ownerGroupId !== undefined && <>{" · "}{t("control.decisions.reviewOwner", { groupId: owner })}</>}{" "}
      <input type="text" aria-label={t("control.decisions.dismissNote")} placeholder={t("control.decisions.dismissNote")} value={note} onChange={(event) => setNote(event.currentTarget.value)} />
      <button type="button" disabled={ownerRevision === null}
        onClick={() => { if (ownerRevision !== null) props.onCommand({ verb: "ratify-flagged-decision", groupId: owner, expectedRevision: ownerRevision, payload: note.trim() === "" ? { decisionId: flag.decisionId } : { decisionId: flag.decisionId, note: note.trim() } }); }}>
        {t("control.decisions.dismiss")}
      </button>{" "}
      <button type="button" aria-expanded={detail} onClick={() => setDetail(!detail)}>{t("control.decisions.reviewDetail")}</button>
      {detail && <ReviewDetail reviewGroupId={owner} />}
    </div>
  );
}

/** The version of the estimate with this id in the same group; the id itself when the list does not carry it. */
function estimateVersionOf(view: GroupViewV1, estimateId: string): string {
  const found = view.estimates.find((candidate) => candidate.estimateId === estimateId);
  return found === undefined ? estimateId : String(found.estimateVersion);
}

/**
 * Kanban spec 2026-10-20 §3.1-§3.4: where a confirmed group is on its way to starting on its own. Nothing for a group
 * already started or stopped (the stop banner says that); a start refused again and again is an alert (needs you).
 */
function OrchestrationLine(props: { orchestration: GroupOrchestrationV1 | undefined }): JSX.Element | null {
  const { t } = useTranslation();
  const o = props.orchestration;
  if (o === undefined || o.state === "started" || o.state === "stopped") return null;
  if (o.refusal?.persistent === true) return <p role="alert" data-testid="orchestration-line">{t("control.orchestration.refusedPersistent", { code: o.refusal.code, count: o.refusal.count })}</p>;
  const text = o.state === "held" ? t("control.orchestration.held")
    : o.state === "waiting-slot" ? t("control.orchestration.waitingSlot")
    : o.state === "waiting-prerequisite" ? t("control.orchestration.waitingFor", { groups: o.waitingFor.join(", ") })
    : o.state === "backoff" ? t("control.orchestration.backoff", { code: o.refusal?.code ?? "" })
    : t("control.orchestration.queued");
  return <p role="status" data-testid="orchestration-line">{text}</p>;
}

/** Tester round 2 §4.2.3: a run figure as the banners write it -- tokens short (K/M/B), any other dimension as is. */
const figure = (dimension: AmountDimensionV1, n: number | null | undefined): string => n == null ? "—" : dimension === "tokens" ? shortTokens(n) : String(n);

/**
 * Tester round 2 §4.2.3 (H1) and §4.2.5: an estimate over its grant is a warning, one line per over dimension; a blocked
 * group names the first non-estimate run that went over; a token deficit an estimate left names the limit raise.
 */
function GrantBanners({ view }: { view: GroupViewV1 }): JSX.Element {
  const { t } = useTranslation();
  const over = (run: RunViewV1): AmountDimensionV1[] => run.overGrant ?? [];
  const estimates = view.runs.filter((run) => run.phase === "estimate" && over(run).length > 0);
  const blocker = view.summary.state === "blocked" ? view.runs.find((run) => run.phase !== "estimate" && over(run).length > 0) : undefined;
  // Session 3cfc2e73 D2 (spec 2026-11-05 §3.2): in a group that is not blocked (no token limit), each non-estimate run
  // over its grant is a status line, one per over dimension.
  const overRuns = view.summary.state === "blocked" ? [] : view.runs.filter((run) => run.phase !== "estimate" && over(run).length > 0);
  const line = (run: RunViewV1, dimension: AmountDimensionV1) => ({ runId: run.runId, dimension: enumText("dimension", dimension), used: figure(dimension, run.used[dimension]), grant: figure(dimension, run.grant?.[dimension]) });
  const deficit = view.ledger.budgetDeficit.tokens;
  return <>
    {estimates.flatMap((run) => over(run).map((dimension) => (
      <p key={`${run.runId}:${dimension}`} role="status" data-testid="estimate-over-grant">{t("control.group.estimateOverGrant", line(run, dimension))}</p>
    )))}
    {estimates.length > 0 && deficit > 0 && view.ledger.groupLimit.tokens !== null && (
      <p role="alert" data-testid="estimate-deficit">{t("control.group.estimateDeficit", { deficit: shortTokens(deficit) })}</p>
    )}
    {overRuns.flatMap((run) => over(run).map((dimension) => (
      <p key={`${run.runId}:${dimension}`} role="status" data-testid="run-over-grant">{t("control.group.runOverGrant", line(run, dimension))}</p>
    )))}
    {blocker !== undefined && <p role="alert" data-testid="blocked-banner">{t("control.group.blockedBanner", line(blocker, over(blocker)[0]!))}</p>}
  </>;
}

/** Tester round 2 §7.4 item 3 (D6): a task slot resolves only through the person's own default agent, which Orca's automatic confirm cannot use. */
function ownAgentOnly(preview: AgentSelectionPreviewV1 | null | undefined): boolean {
  return (preview?.slots ?? []).some((slot) => slot.taskId !== null && slot.outcome.kind === "resolved" && slot.outcome.frozen.provenance.agent === "operator");
}

/**
 * Scheduled flows and groups spec 2026-10-24 §13.3: an owner saves this group's plan to the library, or schedules the
 * group in one `schedule-from-group` (never `schedule-set`). The confirm-mode line reads the group's own scheme.
 */
function GroupLibraryActions({ view, onCommand }: { view: GroupViewV1; onCommand: (action: ControlAction) => void }): JSX.Element | null {
  const { t } = useTranslation();
  const mayAct = mayHumanOnly(useContext(AccountContext));
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const goal = (view.summary.goal ?? view.plan.goal).slice(0, 200);
  const name0 = goal === "" ? view.summary.groupId : goal;
  // The server caps a schedule's name at 80; the library's name above keeps its 200.
  const scheduleGoal = (view.summary.goal ?? view.plan.goal).slice(0, 80);
  const [name, setName] = useState(scheduleGoal.trim() === "" ? view.summary.groupId : scheduleGoal);
  const [cron, setCron] = useState("");
  const [limit, setLimit] = useState("");
  const tokenLimit = limit.trim() === "" ? null : Number(limit);
  const limitValid = tokenLimit === null || (Number.isSafeInteger(tokenLimit) && tokenLimit > 0);
  const scheme = view.integration?.scheme ?? null;
  const mode = scheme !== null && scheme.delivery !== "keep"
    ? t("schedules.groupConfirmMode.delivery", { delivery: t(`control.integration.deliveries.${scheme.delivery}`) })
    : tokenLimit !== null ? t("schedules.groupConfirmMode.limited") : t("schedules.groupConfirmMode.auto");
  if (!mayAct) return null;
  const groupId = view.summary.groupId;
  const save = (): void => {
    if (name.trim() === "" || cron.trim() === "" || !limitValid) return;
    onCommand({ verb: "schedule-from-group", groupId, expectedRevision: view.summary.commandRevision, payload: {
      scheduleId: scheduleIdFor(name.trim(), `${groupId}\0${cron.trim()}`), name: name.trim(), cron: cron.trim(), enabled: true,
      ...(tokenLimit !== null ? { tokenLimit } : {}),
    } });
    setOpen(false);
  };
  return (
    <>
      {/* Tester follow-up F §3 (#81, human 「要收起来」): both are rare, so they wait in the group's "⋯" menu, not its header. */}
      <Menu open={menuOpen} onOpenChange={setMenuOpen}
        trigger={<button type="button" className="ms-0" aria-label={t("group.more")}>⋯</button>}>
        <MenuItem onSelect={() => onCommand({ verb: "plan-library-save", groupId, expectedRevision: 0, payload: { source: { kind: "group", groupId }, name: name0 } })}>
          {t("group.savePlan")}
        </MenuItem>
        <MenuItem onSelect={() => setOpen(true)}>{t("group.scheduleThis")}</MenuItem>
      </Menu>
      {open && (
        <div role="dialog" aria-label={t("group.scheduleThis")}>
          <label>{t("settings.schedules.name")}<input type="text" maxLength={80} value={name} onChange={(event) => setName(event.currentTarget.value)} /></label>
          <label>{t("schedules.cron")}<input type="text" value={cron} onChange={(event) => setCron(event.currentTarget.value)} /></label>
          <label>{t("settings.schedules.tokenLimit")}
            <input type="number" min={1} step={1} value={limit} onChange={(event) => setLimit(event.currentTarget.value)} />
          </label>
          <p data-testid="group-schedule-mode">{mode}</p>
          <button type="button" disabled={name.trim() === "" || cron.trim() === "" || !limitValid} onClick={save}>{t("settings.schedules.save")}</button>{" "}
          <button type="button" onClick={() => setOpen(false)}>{t("settings.schedules.cancel")}</button>
        </div>
      )}
    </>
  );
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
  // Tester round 2 §4.2.3: the server refuses every prestart command of a blocked group, so its editors are read-only.
  const preparationReadOnly = archived || view.summary.state === "blocked";
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
  const workCounts = ([["continuableWork", continuable.length], ["retryableWork", retryableCount], ["unresolvedWork", unresolvedCount]] as const)
    .filter(([, n]) => n > 0);
  // #226 (ii): an optional note every continuation sent from here carries; the continued run reads it at its next plan
  // and execute (ccloop operatorNoteGate) -- never injected into a running turn.
  const [noteText, setNoteText] = useState("");
  const [noteScope, setNoteScope] = useState<NoteScope>("next-attempt");
  const noteBody = noteText.trim();
  const noteTooLarge = utf8Bytes(noteBody) > NOTE_MAX_BYTES;
  const withNote = <T extends object>(payload: T): T => (noteBody === "" ? payload : { ...payload, operatorNote: { text: noteBody, scope: noteScope } });
  const selections = (): ContinuationSelectionV1[] =>
    continuable.map(({ run, checkpointId }) => withNote({ taskId: String(run.taskId), predecessorRunId: run.runId, checkpointId }));
  // Labels and progress spec §4.2: the label filter (any of) and the open task live in page memory only.
  const [labelFilter, setLabelFilter] = useState<string[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(() => view.summary.state !== "running" || props.route?.taskId != null || props.focus?.taskId != null);
  const [openRunId, setOpenRunId] = useState<string | null>(props.focus?.runId ?? null);
  useLayoutEffect(() => { if (props.focus?.runId != null) setOpenRunId(props.focus.runId); }, [props.focusRequest]);
  const [openTask, setOpenTask] = useState<string | null>(props.route != null ? props.route.taskId : props.focus?.groupId === groupId ? props.focus.taskId : null);
  useLayoutEffect(() => { if (props.focus?.groupId === groupId && props.focus.taskId !== null) setOpenTask(props.focus.taskId); }, [props.focus, props.focusRequest]);
  const regionDrafts = useRef(new Map<string, unknown>());
  const [region, setRegion] = useState<DetailRegion>(() => props.route?.region != null ? props.route.region : props.focus?.groupId === groupId ? focusedDetailRegion(view, props.focus.region) : defaultDetailRegion(view));
  // Tester round 2 §9.3: a route that names this group (Back, a typed hash) sets the region and the open task.
  useLayoutEffect(() => {
    if (props.route == null) return;
    if (props.route.region !== null) setRegion(props.route.region);
    setOpenTask(props.route.taskId);
  }, [props.route?.region, props.route?.taskId]);
  const selectRegion = (next: DetailRegion): void => { setRegion(next); props.onRouteChange?.(next, openTask); };
  const toggleTask = (taskId: string): void => { const next = openTask === taskId ? null : taskId; setOpenTask(next); props.onRouteChange?.(region, next); };
  // Only explicit navigation selects a region; projection changes keep the person's current choice.
  useLayoutEffect(() => { if (props.focus?.groupId === groupId) setRegion(focusedDetailRegion(view, props.focus.region)); }, [props.focus, props.focusRequest]);
  const [requestedRun, setRequestedRun] = useState<string | null>(null);
  useLayoutEffect(() => { if (region === "runs" && requestedRun !== null) document.getElementById(runRegionId(groupId, requestedRun))?.focus(); }, [region, requestedRun]);
  const openRun = (runId: string): void => { setRequestedRun(runId); setOpenRunId(runId); selectRegion("runs"); };
  const allLabels = [...new Set(view.workItems.flatMap((item) => item.labels ?? []))].sort();
  // A checked label no task carries any more (removed in the detail editor, or by another read) has no checkbox left to
  // uncheck, so it must stop filtering -- otherwise the table stays empty with no way out.
  const activeFilter = labelFilter.filter((label) => allLabels.includes(label));
  const shownItems = activeFilter.length === 0
    ? view.workItems
    : view.workItems.filter((item) => (item.labels ?? []).some((label) => activeFilter.includes(label)));
  const shownBlocked = shownItems.filter((item) => shownWorkStatus(item) === "blocked").length;
  const hiddenBlocked = view.workItems.filter((item) => shownWorkStatus(item) === "blocked").length - shownBlocked;
  const toggleFilter = (label: string): void =>
    setLabelFilter((current) => (current.includes(label) ? current.filter((other) => other !== label) : [...current, label]));
  const openItem = view.workItems.find((item) => item.taskId === openTask);
  // Issue #57: `r` retries the open task's current run where the task detail offers its Retry task button (retryRunOpen),
  // like Decisions' keys only from the page body or inside this group, and never from a hidden pane.
  const sectionRef = useRef<HTMLElement>(null);
  // Tester #53: a group opened from the Board or a list card is mounted below the card grid, out of view; it scrolls its
  // own heading in. An Overview or route focus on this group scrolls to its own target instead (App's focus effect).
  useEffect(() => { if (props.focus?.groupId !== groupId) sectionRef.current?.scrollIntoView?.({ block: "start" }); }, [groupId]);
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
      {/* Re-review m-c: an estimate settled by its charge (RunRetry) does not also show the task settlement's refusal. */}
      {!estimateUsageUnknown(run) && <UsageSettlement compact active={active} key={JSON.stringify([revision, run.unknownUsageSettlement, props.roles])} run={run} roles={props.roles} archived={archived} groupId={groupId} revision={revision} onCommand={onCommand} onCommands={props.onCommands} />}
      {item !== undefined && <SavedResultEntry view={view} item={item} onCommand={onCommand} archived={archived} active={active} />}
    </div>;
  };

  const dispatchControls = (<>
      <div id={overviewRegionId("group", groupId, "dispatch")} tabIndex={-1} data-overview-region="dispatch">
      <h3>{t("control.group.dispatch")}</h3>
      {/* #228: the bar is above every tab, so it stays short -- only the non-zero counts, as one row of chips. */}
      {workCounts.length > 0 && (
        <ul className={chipRow} aria-label={t("control.group.workCounts")}>
          {workCounts.map(([key, n]) => <li key={key} className="badge"><span>{t(`control.group.${key}`)}</span> <span className="num">{n}</span></li>)}
        </ul>
      )}
      {continuable.length > 0 && <p>{t("control.group.continueFromCheckpoint")}</p>}
      {handoffActive && view.summary.stopState === "handoff-complete" && <p>{t("control.group.resumeForRetry")}</p>}
      {!archived && view.summary.state === "ready" && view.summary.executionPending !== true && props.startQueued !== undefined && (
        <p role="status" data-testid="start-queued">{t("control.group.startQueued", { ahead: props.startQueued })}</p>
      )}
      {!archived && continuable.length > 0 && (stopMode === null || (handoffActive && view.summary.stopState === "handoff-complete")) && (
        <div className="continue-note grid max-w-2xl gap-2" role="group" aria-label={t("control.group.continueNote.title")}>
          <textarea aria-label={t("control.group.continueNote.text")} placeholder={t("control.group.continueNote.placeholder")} value={noteText}
            onChange={(event) => setNoteText(event.currentTarget.value)} />
          <Select aria-label={t("flow.note.scope")} value={noteScope} onValueChange={setNoteScope}
            options={[{ value: "next-attempt", label: t("flow.note.next-attempt") }, { value: "remaining-attempts", label: t("flow.note.remaining-attempts") }]} />
          {noteTooLarge && <p data-tone="warn" role="status">{t("flow.note.tooLarge")}</p>}
        </div>
      )}
      {!archived && (
        <div role="toolbar" aria-label={t("control.group.dispatchActions")} className={actionRow}>
          {/* Issue-fixes spec §3.2 (4): start refuses every stop intent (stop-mode-conflict), so it is not offered under one. */}
          {/* Feedback #53: a Web-started group stays ready through its first run; executionPending is the server's "not startable". */}
          {view.summary.state === "ready" && view.summary.executionPending !== true && stopMode === null && (
            // DESIGN.md: one primary per view -- a ready group's Start is its main action.
            <button type="button" className="btn-primary" onClick={() => onCommand({ verb: "start", groupId, expectedRevision: revision, payload: {} })}>{t("control.group.start")}</button>
          )}
          {/* Tester #15: a done group dispatches nothing more, so there is nothing to pause or hand off. A draft keeps both: a
              pause there holds the start that confirming would otherwise bring. */}
          {!handoffActive && stopMode !== "pause" && view.summary.state !== "done" && (
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
              disabled={noteTooLarge}
              onClick={() => { onCommand({ verb: "resume-from-handoff", groupId, expectedRevision: revision, payload: { selections: selections() } }); setNoteText(""); }}
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
              disabled={noteTooLarge}
              onClick={() => {
                onCommand({
                  verb: "continue-task",
                  groupId,
                  taskId: String(run.taskId),
                  expectedRevision: revision,
                  payload: withNote({ predecessorRunId: run.runId, checkpointId }),
                });
                setNoteText("");
              }}
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
        </div>
      )}
      </div>
  </>);

  return (
    // Ruling R1 (#219): only the selected region is rendered; unsent input in a region lives in this store meanwhile.
    <RegionDrafts.Provider value={regionDrafts.current}>
    <section ref={sectionRef} aria-label={t("control.group.region", { groupId })}>
      <h2>
        {/* #81/#228: the revision and projection counters are in the Technical region, not the first screen. */}
        {t("control.group.heading", { groupId, state: enumText("groupState", view.summary.state) })}
      </h2>
      {(view.summary.criteriaReviews ?? []).length > 0 && (
        <div className="detail-block" data-testid="criteria-reviews">
          <h3>{t("control.group.criteriaReview.heading")}</h3>
          <ul>
            {view.summary.criteriaReviews!.map((review) => (
              <li key={review.debugGroupId}>
                {t("control.group.criteriaReview.status", { taskId: review.taskId, state: t(`control.group.criteriaReview.state.${review.state}` as const) })}
                {review.reason !== null && ` · ${review.reason}`}{" "}
                {props.onSelectGroup === undefined ? review.debugGroupId : (
                  <button type="button" onClick={() => props.onSelectGroup?.(review.debugGroupId)}>
                    {t("control.group.criteriaReview.open", { groupId: review.debugGroupId })}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {decisions !== null && decisions.pendingCount > 0 && <p><NeedsHumanBadge testId="group-needs-human" /></p>}
      {/* Kanban spec §9a: flagged decisions are shown at the top, red; nothing waits on them. */}
      {decisions !== null && (decisions.flaggedCount ?? 0) > 0 && (
        <p><span className="badge" data-tone="danger" data-testid="group-flagged">{t("control.decisions.groupFlagged", { count: decisions.flaggedCount })}</span></p>
      )}
      {decisions !== null && (decisions.groupFlags ?? []).filter((flag) => flag.state === "flagged").map((flag) => flag.source === "model-review" ? (
        <FindingFlag key={flag.decisionId} flag={flag} groupId={groupId} revision={revision} archived={archived} revisionOf={props.revisionOf} onCommand={props.onCommand} />
      ) : (
        <p key={flag.decisionId} data-testid="group-flag">
          <span className="badge" data-tone="danger">{t("control.decisions.flagged")}</span>{" "}
          {t("control.decisions.flaggedReason", { source: flag.source, reason: flag.reason })}{" "}
          <button type="button" disabled={archived}
            onClick={() => props.onCommand({ verb: "ratify-flagged-decision", groupId, expectedRevision: revision, payload: { decisionId: flag.decisionId } })}>
            {t("control.decisions.ratify")}
          </button>
        </p>
      ))}
      {/* Checks spec 2026-10-22 §7: a review group's own view shows its review's detail (the card opens this view). */}
      {view.summary.systemDebug?.source.kind === "model-review" && <ReviewDetail reviewGroupId={groupId} />}
      {/* Final review T11 (Rule 12): a failed decisions read is said for the group too, not only inside an open task. */}
      {decisionsFailed !== null && <p data-testid="group-decisions-read-failed">{t("control.decisions.readFailed", { code: decisionsFailed })}</p>}
      {view.summary.claimBlocked && <p role="alert">{t("control.group.claimBlocked")}</p>}
      <OrchestrationLine orchestration={view.summary.orchestration} />
      {/* Spec 2026-10-08 §2.2(d), §6.5: the group's refusal is among the alerts at the top, above every action. */}
      {props.refusal ? <RefusalNotice refusal={props.refusal} testId="group-refusal" /> : null}
      <GrantBanners view={view} />
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
        <p role="status" data-testid="spend-cap-block" title={`${formatTokens(view.spendCapBlock.capTokens, currentLanguage())} / ${formatTokens(view.spendCapBlock.grantTokens, currentLanguage())}`}>
          {t("control.group.spendCapBlock", {
            scope: capScopeText(view.spendCapBlock.scope),
            period: t(`usage.capPeriod.${view.spendCapBlock.period}` as const),
            // Issue #84: short figures (K/M/B), the exact ones in the title.
            cap: shortTokens(view.spendCapBlock.capTokens),
            grant: shortTokens(view.spendCapBlock.grantTokens),
          })}{" "}
          <a href="#metrics">{t("control.group.spendCapLink")}</a>
        </p>
      )}
      {/* #81/#228: the goal leads; the plan hash and graph version are in the Technical region. */}
      <p>{view.plan.goal}</p>
      {view.summary.debug !== undefined && <DebugMark debug={view.summary.debug} />}
      {view.summary.requirement !== undefined && <a href="#requirements" onClick={() => props.onSourceRequirement?.(groupId)}>{t("control.group.sourceRequirement")}</a>}
      {!archived && view.summary.state !== "clarifying" && <GroupLibraryActions view={view} onCommand={onCommand} />}
      {archived && (
        <p role="status" aria-label={t("control.group.archivedRegion")}>
          {t("control.group.archivedBanner")}{" "}
          <button type="button" onClick={() => onCommand({ verb: "unarchive-group", groupId, expectedRevision: revision, payload: {} })}>
            {t("control.group.unarchive")}
          </button>
        </p>
      )}
      {/* #81: only a line that says something about this group; the generic one every page carried is gone. */}
      {reviewWording(view.summary) !== null && <p>{t(reviewWording(view.summary) === "goal-review" ? "detail.goalReview" : "detail.tasksBlocked")}</p>}
      {/* Issue #47: the execution controls are one bar above the region tabs, shown whatever tab is open. */}
      {dispatchControls}
      {/* What Problems and Live hold, said on their tabs: the region's own lists, plus the group's refusal shown above. */}
      <GroupDetailRegions groupId={groupId} selected={region} onSelect={selectRegion}
        hints={{ problem: view.recoveryBlockers.length + view.runs.filter(isProblemRun).length + (props.refusal ? 1 : 0) + (view.summary.acceptance?.result === "failed" ? 1 : 0) + (view.summary.landingWatch?.regressions.length ?? 0), live: runningNow(view).length }} regions={{
        progress: <>
      {allLabels.length > 0 && (
        <div className="mb-2 flex flex-wrap items-start gap-2" role="toolbar" aria-label={t("control.group.filterRegion")}>
          <details className="relative" open={filterOpen} onToggle={(event) => setFilterOpen(event.currentTarget.open)}>
            <summary role="button" aria-expanded={filterOpen} className="cursor-pointer rounded-control border border-line-strong px-3 py-1.5">{t("control.group.filterButton", { n: activeFilter.length })}</summary>
            <fieldset aria-label={t("control.group.filterRegion")} className="absolute z-10 min-w-40 rounded-card border border-line-strong bg-elevated p-3 shadow-float">
              <legend>{t("control.group.filterLegend")}</legend>
              {allLabels.map((label) => (
                <label className="flex gap-1" key={label}>
                  <input type="checkbox" checked={activeFilter.includes(label)} onChange={() => toggleFilter(label)} />
                  {label}
                </label>
              ))}
              <button type="button" disabled={activeFilter.length === 0} onClick={() => setLabelFilter([])}>{t("control.group.filterClear")}</button>
            </fieldset>
          </details>
        </div>
      )}
      <DependencyGraph items={view.workItems} runs={view.runs} now={props.now} openTask={openTask} onOpen={toggleTask} />
      <h3>{t("control.group.workItems")}</h3>
      <button type="button" aria-expanded={tasksOpen} aria-controls={`tasks-${groupId}`} onClick={() => setTasksOpen(!tasksOpen)}>
        {t("control.group.taskDisclosure", { n: shownItems.length })}
      </button>
      {!tasksOpen && shownBlocked > 0 && <span className="badge" data-tone="warn"> {t("control.group.blockedCount", { n: shownBlocked })}</span>}
      {hiddenBlocked > 0 && <span className="badge" data-tone="warn" data-testid="hidden-blocked-count">
        {t("control.group.blockedCount", { n: hiddenBlocked })} · {t("control.group.filterButton", { n: activeFilter.length })} · <button type="button" onClick={() => setLabelFilter([])}>{t("control.group.filterClear")}</button>
      </span>}
      <table id={`tasks-${groupId}`} aria-label={t("control.group.taskTable")} data-collapsed={!tasksOpen}>
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
                <button type="button" aria-expanded={openTask === item.taskId} onClick={() => toggleTask(item.taskId)}>
                  {item.taskId}
                </button>
                {/* Tester round 2 §8.2 (H5): what the task is for, one line; the whole goal in the title. */}
                {item.objective !== undefined && <> <span className={`task-goal ${taskGoal}`} title={item.objective.goal}>{goalSummary(item.objective.goal)}</span></>}
                {taskNeedsHuman(item.taskId) && <> <NeedsHumanBadge /></>}
              </td>
              <td>{enumText("workStatus", shownWorkStatus(item))}{view.runs.filter(run => run.runId === item.currentRunId).map(run => <RunReason key={run.runId} run={run} />)}
                {view.runs.filter(run => run.runId === item.currentRunId).map(run => remedies(run, props.active !== false && region === "progress"))}</td>
              <td><LabelChips labels={item.labels} /><NoChangeChip item={item} />{item.loopPlan ? <span className="plan-chip"> {planText(item.loopPlan.planId, item.loopPlan.planVersion, "name")}</span> : null}</td>
              <td>{progressText(item.progress)}{item.expected !== undefined && <small className="block num" data-testid={`task-expected-${item.taskId}`}>{expectedText(item.expected)}</small>}</td>
              <td>{item.currentRunId ?? t("common.none")}</td>
              <td>{item.pendingRunId ?? t("common.none")}</td>
              <td>{item.dependencyTaskIds.join(", ") || t("common.none")}</td>
            </tr>
          ))}
        </tbody>
      </table>

        </>,
        live: <LiveRegion view={view} active={props.active !== false && region === "live"} now={props.now} archived={archived} onCommand={onCommand} />,
        preparation: <>
      <section aria-label={t("control.preparation.reviewTitle")}>
        <h3>{t("control.preparation.reviewTitle")}</h3>
        <p>{t("control.preparation.goal", { goal: view.plan.goal })}</p>
        <ul>{view.plan.successConditions.map((condition, index) => <li key={index}>{condition}</li>)}</ul>
        <p>{t("control.preparation.workspace", { mode: workspaceMode ?? t("common.unknown") })}</p>
      </section>
      {view.summary.scheduleStart !== undefined && (
        <div data-testid="group-schedule-start">
          <p>{t("group.startedBySchedule", { name: view.summary.scheduleStart.name, slot: new Date(view.summary.scheduleStart.slot).toLocaleString() })}</p>
          {view.summary.scheduleStart.waitingReason !== null && (
            <p data-tone="warn" data-testid="group-schedule-waiting">{t("group.waitingSince", { slot: new Date(view.summary.scheduleStart.slot).toLocaleString(), reason: view.summary.scheduleStart.waitingReason })}</p>
          )}
        </div>
      )}
      {/* Tester #7/#13/#14: the agents, the part most often changed, come first; the budget table and the confirm buttons at its end follow, so confirm is the last thing on the page. */}
      {props.agents !== undefined && (
        <AgentSelectionEditor
          view={view} agents={props.agents} preview={props.preview ?? null} preferences={props.agentPreferences}
          onReread={props.onRereadPreview}
          agentsFailure={props.agentsFailure}
          retryNotice={props.retryNotice}
          models={props.models} onRefreshModels={props.onRefreshModels}
          archived={archived} blocked={view.summary.state === "blocked"}
          drafts={drafts} onDraft={onDraft} onCommand={onCommand}
        />
      )}
      <BudgetEditor view={view} config={config} drafts={drafts} onDraft={onDraft} onCommand={onCommand} onCommands={props.onCommands} archived={preparationReadOnly} selectionsHash={selectionsHashFor(view, props.preview)}
        suggestedTarget={props.integrationFor?.(view.plan.repoId)?.suggestedTarget ?? null}
        ownAgent={ownAgentOnly(props.preview)} />
</>,
        problem: <>
      <h3>{t("detail.problem")}</h3>
      {view.recoveryBlockers.map((blocker, index) => <p key={index}>{blocker.code}</p>)}
      {/* Tester follow-up E §5 (#241): a failed group acceptance, with Recheck, and Waive for an owner. */}
      <GroupAcceptanceProblem groupId={groupId} acceptance={view.summary.acceptance} roles={props.roles} archived={archived} revision={revision} onCommand={onCommand} />
      {/* Full suite spec 2026-11-12 §5 (#279): no full-suite command set (with the suggestion and Adopt), or a flaky suite; never blocking. */}
      <GroupFullSuiteWarning repoId={view.plan.repoId} acceptance={view.summary.acceptance} archived={archived} />
      {/* Tester follow-up G spec §3.3, §3.5: the requirement review and its exits. */}
      <RequirementReviewPanel groupId={groupId} review={view.summary.requirementReview} archived={archived} revision={revision} onCommand={onCommand} />
      {/* Tester follow-up G §6.2 (#269): a check that turned red on the group branch after a landing. */}
      <LandingWatchProblem groupId={groupId} landingWatch={view.summary.landingWatch} />
      {/* Tester follow-up G §6.3 (#189): what this group lets through; listed here, not counted as a problem. */}
      <GroupAllowances groupId={groupId} revision={revision} allowances={view.summary.allowances} roles={props.roles} archived={archived} onCommand={onCommand} />
      {view.runs.filter(run => isProblemRun(run) || run.runId === props.focus?.runId).map(run => <div key={run.runId} data-problem-run-id={run.runId} tabIndex={-1}>
        <p>{run.taskId ?? run.runId} · {enumText("runState", run.state)} <RunReason run={run} /></p>
        <RunOutputBound run={run} />
        {remedies(run, props.active !== false && region === "problem")}
        <button type="button" onClick={() => openRun(run.runId)}>{t("detail.openRun", { runId: run.runId })}</button>
      </div>)}
</>,
        results: <>
      <GroupResults view={view} active={props.active !== false && region === "results"} scope={props.resultsScope ?? ""} />
      <GroupHandoffs view={view} />
      <p>{t("detail.resultsEvidence")}</p>
      {view.runs.map(run => <button key={run.runId} type="button" onClick={() => openRun(run.runId)}>{t("detail.openRun", { runId: run.runId })}</button>)}
      <div id={overviewRegionId("group", groupId, "integration")} tabIndex={-1} data-overview-region="integration">
      {/* Dir-requirements spec §9.3: a dir group's region is its folder placement, not the scheme picker (§7: its delivery is fixed). */}
      {view.summary.multiDir !== undefined ? (
        <MultiDirLandingBlock view={view} onCommand={onCommand} archived={archived} />
      ) : view.summary.placement !== undefined ? (
        <FolderPlacementBlock view={view} onCommand={onCommand} archived={archived} />
      ) : (
        <>
          <GitScheme view={view} workspace={workspace} onCommand={onCommand} archived={archived} />
          {/* Fix round 1 F1: a started group's scheme stays an owner's to change, outside the (button-free for keep) Git section. */}
          {view.proposal.state === "confirmed" && (
            <GroupIntegrationConfirm view={view} suggestedTarget={props.integrationFor?.(view.plan.repoId)?.suggestedTarget ?? null} onCommand={onCommand} archived={archived} />
          )}
        </>
      )}

      </div>
</>,
        runs: <>
      <h3>{t("control.group.runs")}</h3>
      {/* Tester #244: the table scrolls in its own box on a narrow screen (its 40rem rule, DESIGN.md); the open run's
          detail sits below it, full width, so the table's width never widens the transcript. */}
      <div className="runs-table-box max-w-full overflow-x-auto">
      <table className="num runs-table">
        <thead>
          <tr>
            <th>{t("control.group.runsTh.run")}</th><th>{t("control.group.runsTh.phase")}</th><th>{t("control.group.runsTh.state")}</th>
            <th>{t("control.group.runsTh.profile")}</th><th>{t("control.group.runsTh.used")}</th><th>{t("control.group.runsTh.remaining")}</th>
          </tr>
        </thead>
        <tbody>
          {runsInCreationOrder(view.runs).map((run, index, orderedRuns) => (
            <Fragment key={run.runId}>
            <tr id={runRegionId(groupId, run.runId)} tabIndex={-1} data-run-id={run.runId}>
              <td>
                <button type="button" aria-expanded={openRunId === run.runId} aria-controls={`run-detail-${run.runId}`}
                  aria-label={t(openRunId === run.runId ? "control.group.closeRun" : "control.group.openRun", { run: run.taskId != null && view.runs.some((other) => other.runId !== run.runId && other.taskId === run.taskId) ? `${run.taskId} · ${t("control.group.runLabel", { n: index + 1 })}` : run.taskId ?? run.estimateId ?? t("control.group.runLabel", { n: index + 1 }) })}
                  onClick={() => setOpenRunId(openRunId === run.runId ? null : run.runId)}>{openRunId === run.runId ? "▾" : "▸"}</button>{" "}
                {run.taskId ?? run.estimateId ?? <details><summary>{t("control.group.runLabel", { n: index + 1 })}</summary><code>{run.runId}</code></details>}
              </td>
              <td>{enumText("runPhase", run.phase)}</td>
              <td className="run-state [&>div]:mb-1">
                <div>{enumText("runState", run.state)}</div>
                <div><RunReason run={run} /></div>
                <DebugRepro run={run} />
                <RunOutputBound run={run} />
                {!estimateUsageUnknown(run) && <UsageSettlement key={JSON.stringify([revision, run.unknownUsageSettlement, props.roles])} run={run} roles={props.roles} archived={archived} groupId={groupId} revision={revision} onCommand={onCommand} onCommands={props.onCommands} />}
                {run.failureCode !== null && <div><code>{run.failureCode}</code></div>}
                <div>{t("control.group.attempt", { attempt: run.providerAttemptOrdinal, claim: run.claimOrdinal ?? t("common.na") })}{runNumberOf(view, run, orderedRuns.slice(0, index + 1)) > 0 ? t("control.group.taskRun", { n: runNumberOf(view, run, orderedRuns.slice(0, index + 1)) }) : ""}</div>
                <RunRetry view={view} run={run} archived={archived} onCommand={onCommand} />
              </td>
              <td><details><summary>{run.profile.profileId}</summary><code>{run.profile.profileHash}</code></details></td>
              {/* Spec 2026-11-03 soft-mode approximate usage: a booked floor is said to be one, never shown as a reported figure. */}
              <td><Tokens n={run.used.tokens} />{run.usageApproximate !== undefined && <span className="badge" data-tone="warn" data-testid="usage-approximate">{run.usageApproximate.floorTokens === null ? t("control.group.usageApproximateNone") : t("control.group.usageApproximate")}</span>}</td>
              <td>{run.remaining.tokens===null ? t(run.tokenRemainingStatus==="unknown"?"control.progress.tokensUnknown":"budget.unlimited") : <Tokens n={run.remaining.tokens} />}</td>
            </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
      </div>
      {runsInCreationOrder(view.runs).flatMap((run, index) => openRunId === run.runId ? [(
        <div key={run.runId} id={`run-detail-${run.runId}`} data-run-detail={run.runId} className="min-w-0 rounded-card border border-line bg-well p-3">
          <h4 className="mt-0">{t("control.group.runDetail", { run: run.taskId ?? run.estimateId ?? t("control.group.runLabel", { n: index + 1 }) })}</h4>
          <RunPostMergeCheck check={run.postMergeCheck} />
          <RunTranscript runId={run.runId} active={props.active !== false && region === "runs"} autoOpen />
          <EvidenceLink runId={run.runId} />
          {run.evidenceIds.length > 0 && <details><summary>{t("control.group.evidenceCount", { n: run.evidenceIds.length })}</summary><ul>{run.evidenceIds.map((id) => <li key={id}><code>{id}</code></li>)}</ul></details>}
        </div>
      )] : [])}

</>,
        technical: <>
      {/* #81/#228: moved here from the header and the plan line. */}
      <p className="num">{t("control.group.counters", { revision, projection: view.summary.projectionSeq })}</p>
      <p className="num">{t("control.group.planLine", { hash: short(view.plan.planHash), graphVersion: view.graphVersion })}</p>
      <SkillsGiven view={view} />
      {/* #228: moved here from the execution bar -- command ids are a technical fact, not a control. */}
      <p>{t("control.group.recent", { commands: view.recentCommandIds.join(", ") || t("common.none") })}</p>

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
      {openItem !== undefined && <TaskDetail key={openItem.taskId} active={props.active !== false} view={view} item={openItem} roles={props.roles} drafts={drafts} onDraft={onDraft} onCommand={onCommand} workspaceMode={workspaceMode} archived={archived} decisions={decisions} decisionsFailed={decisionsFailed} onCorrectDecision={props.onCorrectDecision} resultsActive={props.active !== false && region === "results"} resultsScope={props.resultsScope ?? ""} />}
    </section>
    </RegionDrafts.Provider>
  );
}
