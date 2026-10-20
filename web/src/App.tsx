/**
 * task 8. `App` owns the ONLY side effects in this package: it fetches (via
 * `web/src/api.ts`) and then feeds the result to pure components that a
 * criterion can render with `renderToStaticMarkup` (plan ruling 2) --
 * `PanelHome` for the default view (task 8 ruling K5) and `DecisionDetail`
 * for whichever row was opened. `useEffect` never runs during static
 * server rendering, so this component's own render is never exercised
 * against a live server in a test; `PanelHome` and `DecisionDetail` carry
 * that weight instead.
 *
 * *** ERRATUM (2026-09-16, run orca-dev-5d5c8055, final review of E3, ruling R66) ***
 * The first version `void`ed both POSTs, so a refused Agree or Correct changed
 * nothing on the page, and a successful one left the row on the to-do list
 * until reload. Every outcome is now shown: a refusal through `Refusal` (with
 * "record another" when the server names `again`), a success as a status line
 * followed by a refetch of the to-do list and metrics. A load failure renders
 * `ErrorPage` with the server's code and message. `Refusal` and `ErrorPage`
 * are pure and carry the criteria (web/tests/outcome.test.tsx).
 *
 * *** ERRATUM (2026-09-27, session a50f4d80, rulings U1/U2) ***
 * PanelHome is gone: the default view is the Decisions pane (DecisionsView), inside Shell.
 * Every pane stays mounted and only styles.css hides the inactive ones (panel UI redesign
 * spec §5.1): App-level criteria find Task control's buttons by role from the default pane.
 *
 * *** ERRATUM (2026-10-06, Orca session 32306496, project filtering spec §11 R3) ***
 * The single `outcome` / `lastCorrection` described above no longer exist. Decision POST
 * results are request records (web/src/decisionRequests.ts): a record is shown inline only
 * for the selected owner's active request, and every other record is shown in the
 * owner-labelled notice (DecisionOperations), so a result never lands on another decision.
 */
import { useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import {
  correctionBody,
  addProject,
  failureFrom,
  fetchChains,
  fetchDecision,
  fetchMetrics,
  fetchProjects,
  fetchDecisions,
  fetchTodo,
  recordCorrection,
  recordReview,
  renameProject,
  requestChainStart,
  requestChainStop,
  startChainBody,
  withdrawCorrection,
  withdrawReview,
} from "./api.js";
import type { CorrectionForm, DecisionReviewState, PanelRefusal, RecordCorrectionInput } from "./api.js";
import { bannersFor, readDismissed, writeDismissed } from "./chainBanner.js";
import { ChainBanners, ChainPanel } from "./ChainPanel.js";
import { readShowAdvanced, writeShowAdvanced } from "./advancedPreference.js";
import type { ChainOutcome } from "./ChainPanel.js";
import {
  AGENT_PREFERENCES_PATH,
  commandEnvelope,
  controlCommandPath,
  controlFailureFrom,
  fetchControlConfig,
  fetchControlGroup,
  fetchControlRecovery,
  fetchControlSummary,
  fetchRequirement,
  fetchAgentPreferences,
  fetchAgentInstallationState,
  detectAgentInstallations,
  refreshAgentVersions,
  AGENT_UPDATE_PATH,
  readPendingAgentUpdate,
  writePendingAgentUpdate,
  fetchAgentPreview,
  fetchAgentModels,
  fetchAgentsView,
  fetchGroupDecisions,
  fetchRepositoryIntegration,
  fetchRepositoryWorkspace,
  nextCommandId,
  readUncertainCommands,
  recoverUncertainCommand,
  refusalFromAnswer,
  sendControlCommand,
  sendIntegrationScheme,
  workspaceModePath,
  writeUncertainCommands,
} from "./controlApi.js";
import type { ControlAction } from "./controlApi.js";
import { AccountContext } from "./AuthGate.js";
import { ControlPanel } from "./ControlPanel.js";
import { initialControlState, reduceControlState, summaryView } from "./controlState.js";
import type { ControlAnswer } from "./controlApi.js";
import type { ControlRefusal, UncertainCommand } from "./controlState.js";
import { UncertainOperations } from "./UncertainOperations.js";
import type {
  AgentPreferencesViewV1, AgentInstallationStateV1, AgentSelectionPreviewV1, AgentsViewV1, CommandSuccessV1, ControlConfigV1, ControlSummaryV1, GroupDecisionsViewV1, IntegrationSchemeV1, ModelListState, OperatorPreferencesV1, RepositoryIntegrationV1,
  RepositoryWorkspaceV1, RequirementViewV1, OverviewV1, RecoveryViewV1,
} from "./controlTypes.js";
import { DecisionDetail } from "./DecisionDetail.js";
import { AttemptNotice, CorrectionsView, debugOpenAction, sendCorrectionCommand } from "./CorrectionsView.js";
import type { CorrectionAttempt } from "./CorrectionsView.js";
import { RefusalNotice } from "./RefusalNotice.js";
import { DecisionOperations } from "./DecisionOperations.js";
import { EMPTY_REQUESTS, dismissRequest, inlineRequest, noticeRequests, pendingWithdrawals, retryPayload, settleRequest, startRequest } from "./decisionRequests.js";
import type { DecisionRequest, DecisionRequests } from "./decisionRequests.js";
import { EMPTY_DRAFTS, clearIfUnchanged, correctionKey, setDraft } from "./detailDrafts.js";
import type { DetailDrafts, DraftSlot } from "./detailDrafts.js";
import type { Decision } from "./DecisionDetail.js";
import { Overview } from "./Overview.js";
import { fetchOverview } from "./overviewApi.js";
import { deriveOverview, loadingSource, sourceFailure } from "./overviewModel.js";
import type { OverviewSource } from "./overviewModel.js";
import { overviewFocusId } from "./overviewNavigation.js";
import type { OverviewTarget } from "./overviewNavigation.js";
import { ErrorPage } from "./ErrorPage.js";
import i18n, { currentLanguage, refusalDetail, writeLanguage } from "./i18n.js";
import { codeAndDetail } from "./ccloopCodes.js";
import { DecisionsView, NO_FILTER, filterRows, rowsForStatus } from "./DecisionsView.js";
import { isMinor, visibleByImportance } from "./MinorToggle.js";
import { rowKey } from "./DecisionList.js";
import { nextAfterReview } from "./reviewFlow.js";
import { reviewKeyAction } from "./reviewKeys.js";
import type { DecisionFilter, DecisionStatus } from "./DecisionsView.js";
import { MemoryView } from "./MemoryView.js";
import { pickProject, projectName, readProject, writeProject } from "./project.js";
import type { ProjectsAnswerV1 } from "./project.js";
import { ProjectControl } from "./ProjectControl.js";
import { ALL_PROJECTS, allowsAll, groupScope, readProjectView, writeProjectView } from "./projectScope.js";
import type { ProjectView } from "./projectScope.js";
import { ProjectNames } from "./projectNames.js";
import { MetricsView } from "./MetricsView.js";
import { UsagePanel } from "./UsagePanel.js";
import { Refusal } from "./Refusal.js";
import { RequirementsPanel } from "./RequirementsPanel.js";
import { labelsDraftKey } from "./TaskDetail.js";
import { loopDraftKey } from "./LoopPlanCard.js";
import { DEFAULT_SECTION, sectionFromHash } from "./sections.js";
import type { Section } from "./sections.js";
import { GlobalSettings } from "./GlobalSettings.js";
import { ProjectSettings } from "./ProjectSettings.js";
import { SectionPane, Shell, controlAlert } from "./Shell.js";
import { applyTheme, readTheme, writeTheme } from "./theme.js";
import type { ThemePref } from "./theme.js";
import { acceptArrival } from "./selection.js";
import { recoveryRetryAction } from "./recoveryTarget.js";
import type { ChainRepoView, DecisionListRow, DecisionStatusRow, MetricsReport, PanelCoverage } from "./types.js";

type DecisionIdentity = Pick<DecisionListRow, "projectKey" | "id">;

/** localStorage, or undefined where touching it throws. */
function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** sessionStorage: an unresolved command id survives a reload, a page refresh does not outlive the tab. */
function browserSession(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

/** The control summary is polled this fast (spec §9.2); the panel itself never pushes. */
const CONTROL_POLL_MS = 2_000;
/**
 * Ruling review R17 (human ruling 2026-09-27, "节奏改为 10、20、40、80、160"): a read of the agent preview or of the
 * installation table that failed, or a preview in which ccloop could not answer a slot for now, is read again after
 * these delays -- at most this many times, never while the page is hidden -- and then waits for the operator.
 */
export const AGENT_RETRY_DELAYS_MS = [10_000, 20_000, 40_000, 80_000, 160_000] as const;
export type RetryState = { state: "waiting"; attempt: number; delayMs: number } | { state: "stopped" } | { state: "paused" } | null;
/** Ruling review R17's notice, in the reader's language (panel i18n spec §3.3); exported for the criterion. */
export const retryNotice = (retry: RetryState): string | null => {
  if (retry === null) return null;
  if (retry.state === "waiting") return i18n.t("agents.retryWaiting", { seconds: retry.delayMs / 1000, attempt: retry.attempt, total: AGENT_RETRY_DELAYS_MS.length });
  if (retry.state === "paused") return i18n.t("agents.retryPaused");
  return i18n.t("agents.retryStopped", { total: AGENT_RETRY_DELAYS_MS.length });
};
const pageHidden = (): boolean => typeof document !== "undefined" && document.visibilityState === "hidden";

/** The sidebar footer's lines (panel i18n spec §3.3); exported for the pseudo-locale criterion. */
export function footerLines(summary: ControlSummaryV1 | null): string[] {
  if (summary === null) return [];
  return [i18n.t("shell.epoch", { epoch: summary.epoch }), i18n.t(summary.dispatchBlocked ? "common.dispatchBlocked" : "common.dispatchLive")];
}

interface HomeState {
  report: MetricsReport;
  coverage: PanelCoverage;
}

/** A refusal without its retry field: an Agree has no correction to record again, whatever the server named. */
const withoutRetry = ({ retry_field: _dropped, ...rest }: PanelRefusal): PanelRefusal => rest;

export function App(): JSX.Element {
  const account = useContext(AccountContext);
  const { t } = useTranslation();
  const [metricsFailure, setMetricsFailure] = useState<PanelRefusal | null>(null);
  type OwnedSource<T> = OverviewSource<T> & { identity: string };
  const [todoSource, setTodoSource] = useState<OwnedSource<readonly DecisionListRow[]>>({ ...loadingSource(), identity: "" });
  const [overviewSource, setOverviewSource] = useState<OwnedSource<OverviewV1>>({ ...loadingSource(), identity: "" });
  const [recoverySource, setRecoverySource] = useState<OwnedSource<RecoveryViewV1>>({ ...loadingSource(), identity: "" });
  const todoSeq = useRef(0), overviewSeq = useRef(0), recoverySeq = useRef(0), navigationSeq = useRef(0);
  const [overviewFocus, setOverviewFocus] = useState<{ target: OverviewTarget; request: number } | null>(null);
  const focusedRequest = useRef(0);
  const [overviewNavigationFailure, setOverviewNavigationFailure] = useState<string | null>(null);
  const authNow = useRef(account); authNow.current = account;
  const [home, setHome] = useState<HomeState | null>(null);
  const [error, setError] = useState<PanelRefusal | null>(null);
  // Only a row's identity is read off the open decision (Task 11: 纠正 opens one no list row carries yet).
  const [selected, setSelected] = useState<DecisionIdentity | null>(null);
  /** A body belongs to the read that accepted it, never merely to a reused detail wrapper. */
  const [acceptedDecision, setAcceptedDecision] = useState<{
    owner: Pick<DecisionListRow, "projectKey" | "id">; body: Decision; identity: string; request: number | null;
    review?: DecisionReviewState;
  } | null>(null);
  /** Decisions review withdraw spec §7: bumped after a recorded Agree / Correct / withdrawal to read the open detail again. */
  const [detailRefresh, setDetailRefresh] = useState(0);
  const [overviewDecisionRead, setOverviewDecisionRead] = useState<{
    owner: DecisionListRow; identity: string; request: number;
  } | null>(null);
  /**
   * Project filtering spec §11 R3: every Agree / Correct sent, by request, independent of the open detail. Its answer
   * updates only its own record; the detail shows only its owner's active request, the global notice every other one.
   */
  const [decisionRequests, setDecisionRequests] = useState<DecisionRequests>(EMPTY_REQUESTS);
  /**
   * Debug task plan Task 13 (§3.1, ruling C11): the debug-group open sent right after a correction is recorded, by its
   * decision (correctionKey). A failed open leaves the correction recorded and shows here with its Retry; an answer that
   * named no correction could not be followed by an open at all, and says so.
   */
  const [debugOpens, setDebugOpens] = useState<Record<string, CorrectionAttempt | { refusal: ControlRefusal }>>({});
  /** Ruling C12: the Decisions page's two tabs; the Corrections list lives here, not in a section of its own. */
  const [decisionsTab, setDecisionsTab] = useState<"decisions" | "corrections">("decisions");
  /** The row whose answer may still be applied; read by `acceptArrival` when one arrives. */
  const wanted = useRef<DecisionIdentity | null>(null);

  const [chains, setChains] = useState<ChainRepoView[] | null>(null);
  const [chainOutcome, setChainOutcome] = useState<ChainOutcome | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissed(browserStorage()));
  // Panel UI redesign spec §5.1: the active section lives in the URL hash; the theme choice in this browser only.
  const [section, setSection] = useState<Section>(() =>
    typeof window === "undefined" ? DEFAULT_SECTION : sectionFromHash(window.location.hash),
  );
  const [filter, setFilter] = useState<DecisionFilter>(NO_FILTER);
  // Reported-decisions spec 2026-10-20 §6: minor decisions are listed only once asked for; j / k walks what is listed.
  const [showMinor, setShowMinor] = useState(false);
  // Spec §9.2(1): Unreviewed reads /api/todo (home.todo, also the sidebar badge); the other two read /api/decisions.
  const [status, setStatus] = useState<DecisionStatus>("unreviewed");
  const [allRows, setAllRows] = useState<DecisionStatusRow[] | null>(null);
  /** Taste refinement P1-3: reviews this browser recorded since it opened the panel, and a pending move to the next row. */
  const [reviewedThisSession, setReviewedThisSession] = useState(0);
  const [pendingAdvance, setPendingAdvance] = useState<{ reviewed: DecisionIdentity; before: DecisionListRow[] } | null>(null);
  const [theme, setTheme] = useState<ThemePref>(() => readTheme(browserStorage()));
  const [showAdvanced, setShowAdvanced] = useState(() => readShowAdvanced(browserStorage()));
  useEffect(() => {
    const onHash = (): void => { navigationSeq.current++; setSection(sectionFromHash(window.location.hash)); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  /** Null while the control plane is not mounted on this panel; then the page shows no control section at all. */
  const [controlConfig, setControlConfig] = useState<ControlConfigV1 | null>(null);
  /** Project registry spec §7: the whole answer, including file errors, editability and restart warnings. */
  const [projectsAnswer, setProjectsAnswer] = useState<ProjectsAnswerV1 | null>(null);
  const projects = projectsAnswer?.projects ?? null;
  const [project, setProject] = useState<string | null>(null);
  /** Project filtering spec §3: one project, or every project. Kept in this browser beside the chosen project. */
  const [projectView, setProjectView] = useState<ProjectView>(() => readProjectView(browserStorage()));
  /**
   * Execution driver spec §3.2, project filtering spec §5: each repository's workspace mode as last read, by repoId.
   * `workspaceSeq` numbers the reads of one repository, so a late answer never replaces a newer one.
   */
  const [workspaces, setWorkspaces] = useState<Record<string, RepositoryWorkspaceV1>>({});
  const workspaceSeq = useRef<Record<string, number>>({});
  /** Integration spec §9.1: each repository's integration default as last read, by repoId; numbered like the workspace reads. */
  const [integrations, setIntegrations] = useState<Record<string, RepositoryIntegrationV1>>({});
  const integrationSeq = useRef<Record<string, number>>({});
  /** Control run decisions plan Task 11: each group's decisions as last read, by groupId; only the newest read is applied. */
  const [groupDecisions, setGroupDecisions] = useState<Record<string, GroupDecisionsViewV1 | { failed: string }>>({});
  const decisionsSeq = useRef(0);
  /** Agent selection spec §6.8: the installation table and this operator's defaults; null until read, or when the port refuses. */
  const [agents, setAgents] = useState<AgentsViewV1 | null>(null);
  const [agentPreferences, setAgentPreferences] = useState<AgentPreferencesViewV1 | null>(null);
  /** Spec 2026-10-15 §5 (R3): each omp or codex installation's model list as last read, by installation id. */
  const [agentModels, setAgentModels] = useState<Record<string, ModelListState>>({});
  /** Numbers the model reads of one installation (as workspaceSeq does), so a late answer never replaces a newer one. */
  const modelsSeq = useRef<Record<string, number>>({});
  /** The installations whose newest model read has not answered yet; a background read does not start another. */
  const modelsInFlight = useRef<Record<string, boolean>>({});
  const [agentInstallations, setAgentInstallations] = useState<AgentInstallationStateV1 | null>(null);
  const [localPendingUpdate, setLocalPendingUpdate] = useState(() => readPendingAgentUpdate(browserSession()));
  const [agentUpdateNotice, setAgentUpdateNotice] = useState<string | null>(null);
  const [agentUpdateBusy, setAgentUpdateBusy] = useState(false);
  /**
   * Wave 4 review I-1: the code the server gave when the installation table or the preferences could not be
   * read (e.g. control-port-unconfigured), so the proposal view says why instead of resolving forever.
   */
  const [agentsFailure, setAgentsFailure] = useState<string | null>(null);
  /** The server's resolution per open group; a new proposal version or new preferences re-read it. */
  const [previews, setPreviews] = useState<Record<string, AgentSelectionPreviewV1>>({});
  /**
   * Wave 3 review I-3: bumped to re-read the open group's preview when the one on screen can no longer be
   * confirmed -- the server refused it as agent-selection-changed, the read did not conclude (one automatic
   * retry), or the operator pressed Re-read. The key below does not move for any of these on its own.
   */
  const [previewNonce, setPreviewNonce] = useState(0);
  /** T15 fix round 1: only the answer to the latest preview request may land; an older one arriving late is dropped. */
  const previewSeq = useRef(0);
  /**
   * Ruling review R17: retries spent in the current round and the pending timer. One failure code is one report on
   * the page without any bookkeeping here: the control state keeps one refusal per group (battery R17-M8 measured it).
   */
  const previewRetries = useRef(0);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const agentsRetries = useRef(0);
  const agentsTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [previewRetry, setPreviewRetry] = useState<RetryState>(null);
  const [agentsRetry, setAgentsRetry] = useState<RetryState>(null);
  /** Bumped when the page comes back into view (R17 a): the table, the preferences and the open preview are read again. */
  const [returnNonce, setReturnNonce] = useState(0);
  // The ids still waiting on a lookup are restored in the initializer, not in an
  // effect: the effect that mirrors the reducer's list back into sessionStorage runs
  // on the very same mount commit, and would clear the key before anything read it.
  const [control, dispatchControl] = useReducer(reduceControlState, undefined, () => ({
    ...initialControlState(), uncertainCommandIds: readUncertainCommands(browserSession()),
  }));
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  /** N1 spec §11.2: each requirement's view as last read, and the one open in Requirements. */
  const [requirementViews, setRequirementViews] = useState<Record<string, RequirementViewV1>>({});
  const [selectedRequirement, setSelectedRequirement] = useState<string | null>(null);
  /**
   * Project filtering spec §11 R2: unsent detail inputs (requirement answers, split feedback, a raised limit, a new
   * requirement per target, a decision correction), keyed by owner. Held here so closing a detail or switching scope
   * never loses them; never persisted.
   */
  const [detailDrafts, setDetailDrafts] = useState<DetailDrafts>(EMPTY_DRAFTS);
  const onDetailDraft = useCallback(<S extends DraftSlot>(slot: S, key: string, value: DetailDrafts[S][string]): void => {
    setDetailDrafts((all) => setDraft(all, slot, key, value));
  }, []);
  /** The last refusal of a command sent from Requirements, shown there (Task control shows a group's at the top of its view). */
  const [requirementRefusal, setRequirementRefusal] = useState<ControlRefusal | null>(null);
  /** The open requirement, for the poll tick, which outlives the render it was built in. */
  const requirementNow = useRef<string | null>(null);
  requirementNow.current = selectedRequirement;
  /** The reducer's latest value, for callbacks that outlive the render they were built in. */
  const controlNow = useRef(control);
  controlNow.current = control;
  /** Command ids whose lookup is already in flight, so one tick does not ask twice. */
  const resolving = useRef<Set<string>>(new Set());
  /** Closed identities bridge the time between a fast lookup and the reducer's next render. */
  const closedLookups = useRef<Set<string>>(new Set());

  const loadChains = async (): Promise<void> => {
    try {
      setChains((await fetchChains()).repos);
    } catch (err) {
      setChainOutcome({ kind: "refused", refusal: failureFrom(err) });
    }
  };
  // Spec §6.2: the banner appears when a chain stops, so the status is re-read while the page is open.
  useEffect(() => {
    void loadChains();
    const timer = setInterval(() => void loadChains(), 5_000);
    return () => clearInterval(timer);
  }, []);

  const chainAction = async (act: () => Promise<ChainOutcome>): Promise<void> => {
    try {
      setChainOutcome(await act());
    } catch (err) {
      setChainOutcome({ kind: "refused", refusal: failureFrom(err) });
    }
    await loadChains();
  };

  /**
   * Spec §9.2: the summary is polled, never pushed. Once the client has an epoch,
   * a tick asks only for what moved (`sinceChangeSeq`) -- a partial answer that
   * must not evict the groups it does not mention. A voided cache asks for
   * everything instead.
   */
  const readControlTick = async (): Promise<void> => {
    const state = controlNow.current;
    const since = state.epoch !== null && !state.refetchRequired ? state.changeSeq : undefined;
    try {
      const summary = await fetchControlSummary(since);
      dispatchControl({ type: "summary", value: summary, partial: since !== undefined });
      dispatchControl({ type: "recovery", value: await fetchControlRecovery() });
      // N1 spec §11.2: the open requirement's details move with the summary's changeSeq pull -- re-read when it is listed.
      const open = requirementNow.current;
      if (open !== null && summary.groups.some((group) => group.groupId === open)) void readRequirement(open);
    } catch (err) {
      dispatchControl({ type: "refusal", place: "panel", groupId: null, value: controlFailureFrom(err) });
    }
    for (const command of controlNow.current.uncertainCommandIds) void resolveUncertain(command);
  };

  const readControlGroup = async (groupId: string): Promise<void> => {
    try {
      dispatchControl({ type: "group", value: await fetchControlGroup(groupId) });
    } catch (err) {
      dispatchControl({ type: "refusal", place: "group", groupId, value: controlFailureFrom(err) });
    }
  };

  const readRequirement = async (groupId: string): Promise<void> => {
    try {
      const value = await fetchRequirement(groupId);
      setRequirementViews((all) => ({ ...all, [groupId]: value }));
    } catch (err) {
      dispatchControl({ type: "refusal", place: "panel", groupId, value: controlFailureFrom(err) });
    }
  };

  /**
   * A command the browser lost the answer to is looked up, never re-issued: the
   * ledger dedupes on the whole raw envelope, so a fresh id would be a second
   * intent -- possibly a second execution -- rather than a retry of this one.
   */
  const resolveUncertain = async (command: UncertainCommand, explicit = false): Promise<void> => {
    const id = `${command.groupId}\0${command.commandId}`;
    if ((!explicit && (command.parked || closedLookups.current.has(id))) || resolving.current.has(id)) return;
    resolving.current.add(id);
    const result = await recoverUncertainCommand(command.groupId, command.commandId);
    resolving.current.delete(id);
    if (result.kind === "missing-group") {
      closedLookups.current.add(id);
      dispatchControl({ type: "command-parked", value: command, reason: "group-missing" });
      return;
    }
    if (result.kind === "unresolved") {
      // The lookup told us nothing, so the command is still unresolved: keep the id
      // for the next tick and show why this round could not conclude.
      closedLookups.current.delete(id);
      if (explicit) dispatchControl({ type: "command-resumed", value: command });
      dispatchControl({ type: "command-lookup-failed", value: command, refusal: result.refusal });
      return;
    }
    closedLookups.current.add(id);
    // Reloaded results may arrive before the first summary is committed into React's cache.
    let group: ControlSummaryV1["groups"][number] | undefined = controlNow.current.groups[command.groupId];
    if (command.importPlan !== true && group === undefined) {
      try { group = (await fetchControlSummary()).groups.find((candidate) => candidate.groupId === command.groupId); }
      catch (err) {
        closedLookups.current.delete(id);
        dispatchControl({ type: "command-lookup-failed", value: command, refusal: controlFailureFrom(err) });
        return; // Keep the original id until its owner can be read safely.
      }
    }
    // A retained answer resolves the original identity even after its owner group disappeared.
    // An absent result is typed by the lookup route only while its group still exists.
    dispatchControl({ type: "command-resolved", value: command });
    const place = command.importPlan === true ? ("import" as const) : ("group" as const);
    if (result.kind === "absent") dispatchControl({ type: "refusal", place, groupId: command.groupId, value: result.refusal });
    // The command did reach the ledger and succeeded: the unknown outcome shown where the person acted is answered.
    const succeeded = result.kind === "found" && result.lookup.originalStatus < 400;
    if (succeeded) dispatchControl({ type: "command-succeeded", place, groupId: command.groupId });
    // Final review A5+A6-1: it reached the ledger and was refused -- that refusal replaces the unknown outcome, where this
    // command's refusals are shown (an import's in the import form, with a refused plan's problems).
    if (result.kind === "found" && !succeeded) {
      const refusal = refusalFromAnswer({ kind: "answered", status: result.lookup.originalStatus, body: result.lookup.body });
      dispatchControl({ type: "refusal", place, groupId: command.groupId, value: refusal });
    }
    // An import that did not succeed made no group: reading it would only store a group-not-found no view shows.
    if ((command.importPlan === true && !succeeded) || group === undefined) return;
    if (group?.state === "clarifying" || group?.requirement !== undefined) {
      const refusal = result.kind === "absent" ? result.refusal : succeeded ? null
        : refusalFromAnswer({ kind: "answered", status: result.lookup.originalStatus, body: result.lookup.body });
      setRequirementRefusal(refusal);
      await readRequirement(command.groupId);
      if (group.state !== "clarifying") await readControlGroup(command.groupId);
    } else await readControlGroup(command.groupId);
  };

  /**
   * Send one intent. Whatever the ledger says afterwards is read, not inferred here. Answers the commandRevision a
   * success carries, or null when the command did not succeed (refused, or its outcome unknown).
   */
  const sendControl = async (action: ControlAction): Promise<number | null> => {
    // N1 spec §11.2: a requirement's details come from its own view; a clarifying group has no group view (DR25).
    const owner = controlNow.current.groups[action.groupId];
    const requirementArchive = (action.verb === "archive-group" || action.verb === "unarchive-group") && owner?.requirement !== undefined;
    const requirementVerb = action.verb.startsWith("requirement-") || requirementArchive
      || ((action.verb === "recovery-retry" || action.verb === "handoff-stop" || action.verb === "set-limit") && owner?.state === "clarifying");
    const commandId = nextCommandId();
    // Spec 2026-10-08 §2.2(d): an import's refusal is shown in the import form, every other command's in its group.
    const place = action.verb === "import-plan" ? ("import" as const) : ("group" as const);
    const command: UncertainCommand = place === "import"
      ? { groupId: action.groupId, commandId, importPlan: true, verb: action.verb, payload: action.payload }
      : { groupId: action.groupId, commandId, verb: action.verb, payload: action.payload };
    dispatchControl({ type: "command-uncertain", value: command });
    // Spec §5: an answer that arrives after the scope changed may fill the cache, but must not reopen a detail.
    const scopeAtSend = scopeKeyNow.current;
    const answer = await sendControlCommand(controlCommandPath(action), commandEnvelope(commandId, action));
    if (answer.kind === "uncertain") {
      // The id stays where it is: sessionStorage keeps it across a reload, and the
      // next tick looks it up. The page shows that the outcome is unknown.
      dispatchControl({ type: "refusal", place, groupId: action.groupId, value: answer.refusal });
      if (requirementVerb) setRequirementRefusal(answer.refusal);
      return null;
    }
    dispatchControl({ type: "command-resolved", value: command });
    // A success clears the refusal shown where the person acted; another group's stays (spec 2026-10-08 §2.2(d)).
    if (answer.status < 400) dispatchControl({ type: "command-succeeded", place, groupId: action.groupId });
    // Labels and progress spec §4.2 (plan finding F11): a label draft is the person's own data -- cleared only once this
    // command succeeded; a refusal (and an uncertain answer, above) leaves it for them.
    if (answer.status < 400 && action.verb === "set-task-labels") dispatchControl({ type: "draft", key: labelsDraftKey(action.groupId, action.taskId), text: "" });
    // Loop plans spec §4.2: a loop draft is the person's own data, cleared only once set-task-loop succeeded. W7 ruling: an
    // estimate's suggestion (the only set-task-loop that carries workProvenance, BudgetEditor.tsx suggestedLoopActions)
    // leaves an open draft alone; the card then says the plan changed after the draft began.
    if (answer.status < 400 && action.verb === "set-task-loop" && action.payload.workProvenance === undefined) dispatchControl({ type: "draft", key: loopDraftKey(action.groupId, action.taskId), text: "" });
    if (answer.status >= 400) {
      const refusal = refusalFromAnswer(answer);
      dispatchControl({ type: "refusal", place, groupId: action.groupId, value: refusal });
      // The server re-resolved at confirm time and got another hash (changed), or found a slot it refuses
      // (rejected, wave 4 M-1): either way the preview on screen is void and must not be sent again.
      if (refusal.code === "agent-selection-changed" || refusal.code === "agent-selection-rejected") rereadPreview(action.groupId, 0);
    }
    if (requirementVerb) setRequirementRefusal(answer.status >= 400 ? refusalFromAnswer(answer) : null);
    // A refused open made no group: reading it would only replace the refusal on screen with group-not-found.
    if (requirementVerb && (action.verb !== "requirement-open" || answer.status < 400)) {
      if (action.verb === "requirement-open" && scopeKeyNow.current === scopeAtSend) setSelectedRequirement(action.groupId);
      await readRequirement(action.groupId);
    }
    // Accept turns the group into a plan group: Task control reads it from here on.
    // A refused import made no group either (mirrors the requirement-open guard above).
    if (place === "import" && answer.status >= 400) return null;
    if (!requirementVerb || (requirementArchive && owner?.state !== "clarifying") || (action.verb === "requirement-draft-accept" && answer.status < 400)) await readControlGroup(action.groupId);
    return answer.status < 400 ? (answer.body as CommandSuccessV1).commandRevision : null;
  };

  /**
   * W5 (human ruling H16: no manual step): one control's commands, in order. Each after the first is sent at the
   * commandRevision the previous success returned -- the group's revision right after it, not the last poll's -- and
   * the first that does not succeed stops the rest; its refusal shows as any refusal does.
   */
  const sendControlSequence = async (actions: ControlAction[]): Promise<void> => {
    let revision: number | null = null;
    for (const [index, action] of actions.entries()) {
      revision = await sendControl(index === 0 ? action : { ...action, expectedRevision: revision! });
      if (revision === null) return;
    }
  };

  /** Card actions read the exact owner at click time; a stale card cannot submit its old revision. */
  const sendGroupCardAction = async (groupId: string, verb: "archive-group" | "unarchive-group", repoId: string): Promise<void> => {
    try {
      const scopeAtClick = scopeKeyNow.current;
      const sourceAtClick = sourceIdentityNow.current;
      const summaryOwner = controlNow.current.groups[groupId];
      if (summaryOwner === undefined || summaryOwner.repoId !== repoId) return;
      const fresh = summaryOwner.state === "clarifying" ? await fetchRequirement(groupId) : await fetchControlGroup(groupId);
      if (fresh.summary.groupId !== groupId || fresh.summary.repoId !== repoId) return;
      if (verb === "unarchive-group" ? fresh.summary.archived !== true : fresh.summary.archived === true) return;
      // A project/auth/epoch change during the GET invalidates this click. The ledger judges all remaining archive guards.
      if (scopeAtClick !== scopeKeyNow.current || sourceAtClick !== sourceIdentityNow.current
        || controlNow.current.groups[groupId]?.repoId !== repoId) return;
      if (fresh.schema === "orca-requirement-view-v1") setRequirementViews((all) => ({ ...all, [groupId]: fresh }));
      else dispatchControl({ type: "group", value: fresh });
      await sendControl({ verb, groupId, expectedRevision: fresh.summary.commandRevision, payload: {} });
    } catch (err) {
      dispatchControl({ type: "refusal", place: "group", groupId, value: controlFailureFrom(err) });
    }
  };

  /**
   * Spec 2026-10-15 §5 (R3, R4): one installation's models; ccloop's own cache serves a read, `refresh` (owner) re-probes.
   * Each read spawns ccloop and the page re-reads the agents table whenever it comes back into view, so a background read
   * (`refresh` false) is skipped while one is in flight, and a list already on screen stays there until its answer lands.
   * An owner's Refresh always reads. Only the newest read of an installation is applied.
   */
  const loadModels = async (id: string, refresh: boolean): Promise<void> => {
    if (!refresh && modelsInFlight.current[id] === true) return;
    const seq = (modelsSeq.current[id] ?? 0) + 1;
    modelsSeq.current[id] = seq;
    modelsInFlight.current[id] = true;
    setAgentModels((all) => (all[id]?.state === "ready" ? all : { ...all, [id]: { state: "loading" } }));
    let next: ModelListState;
    try {
      next = { state: "ready", view: await fetchAgentModels(id, refresh) };
    } catch (err) {
      const refusal = controlFailureFrom(err);
      const parsed = refusal.code === "ccloop-failed" ? codeAndDetail(refusalDetail(refusal)) : { code: refusal.code, detail: "" };
      next = { state: "unavailable", ...parsed };
    }
    if (modelsSeq.current[id] !== seq) return;
    modelsInFlight.current[id] = false;
    setAgentModels((all) => ({ ...all, [id]: next }));
  };
  /**
   * Read the installation table and this operator's defaults. Wave 4 review I-1, ruling review R17: a read that
   * failed is retried on AGENT_RETRY_DELAYS_MS while the page is visible (when `retry`), then by the operator.
   */
  const loadAgents = async (retry: boolean): Promise<void> => {
    try {
      const table = await fetchAgentsView();
      const preferences = await fetchAgentPreferences();
      setAgents(table);
      for (const row of table.installations) if (row.kind === "omp" || row.kind === "codex") void loadModels(row.id, false);
      setAgentPreferences(preferences);
      try { setAgentInstallations(await fetchAgentInstallationState()); } catch { setAgentInstallations(null); }
      agentsRetries.current = 0;
      setAgentsRetry(null);
    } catch (err) {
      const refusal = controlFailureFrom(err);
      // The amber no-port note already says this, so it is not a panel alert (taste round 2, H1-b).
      if (refusal.code !== "control-port-unconfigured") dispatchControl({ type: "refusal", place: "panel", groupId: null, value: refusal });
      setAgentsFailure(refusal.code);
      // An unconfigured port stays so until the panel restarts: nothing to retry.
      if (!retry || controlConfig?.executionPort !== "configured") return;
      clearTimeout(agentsTimer.current);
      if (pageHidden()) { setAgentsRetry({ state: "paused" }); return; }
      const attempt = agentsRetries.current;
      if (attempt >= AGENT_RETRY_DELAYS_MS.length) { setAgentsRetry({ state: "stopped" }); return; }
      agentsRetries.current = attempt + 1;
      const delayMs = AGENT_RETRY_DELAYS_MS[attempt]!;
      setAgentsRetry({ state: "waiting", attempt: attempt + 1, delayMs });
      agentsTimer.current = setTimeout(() => {
        if (pageHidden()) { setAgentsRetry({ state: "paused" }); return; }
        void loadAgents(true);
      }, delayMs);
    }
  };

  /**
   * Ruling review R17 (d): the open preview is read again after the next backoff delay -- without dropping the one
   * on screen, which cannot be confirmed anyway (its hash is null) and shows which slot is waiting.
   */
  const schedulePreviewRetry = (): void => {
    clearTimeout(previewTimer.current);
    if (pageHidden()) { setPreviewRetry({ state: "paused" }); return; }
    const attempt = previewRetries.current;
    if (attempt >= AGENT_RETRY_DELAYS_MS.length) { setPreviewRetry({ state: "stopped" }); return; }
    previewRetries.current = attempt + 1;
    const delayMs = AGENT_RETRY_DELAYS_MS[attempt]!;
    setPreviewRetry({ state: "waiting", attempt: attempt + 1, delayMs });
    previewTimer.current = setTimeout(() => {
      if (pageHidden()) { setPreviewRetry({ state: "paused" }); return; }
      setPreviewNonce((value) => value + 1);
    }, delayMs);
  };
  /** A new round: no retry pending, none spent. */
  const resetPreviewRetries = (): void => {
    clearTimeout(previewTimer.current);
    previewRetries.current = 0;
    setPreviewRetry(null);
  };
  /** The operator's Re-read (R17 c): a fresh round of retries, the table and preferences again if they are missing. */
  const manualReread = (groupId: string): void => {
    resetPreviewRetries();
    clearTimeout(agentsTimer.current);
    agentsRetries.current = 0;
    setAgentsRetry(null);
    rereadPreview(groupId, 0);
  };

  /** Drop a group's preview, so no confirm can carry it, and read it again after `delayMs`. */
  const rereadPreview = (groupId: string, delayMs: number): void => {
    // Wave 4 review I-1: without the table or the preferences no preview is read at all, so read them first.
    if (agents === null || agentPreferences === null) void loadAgents(false);
    setPreviews((prior) => {
      const next = { ...prior };
      delete next[groupId];
      return next;
    });
    if (delayMs === 0) setPreviewNonce((value) => value + 1);
    else setTimeout(() => setPreviewNonce((value) => value + 1), delayMs);
  };

  // Settings feedback is display-only, keyed by the actual owner; unrelated panel refusals never enter it.
  const [settingsRefusals, setSettingsRefusals] = useState<Record<string, { epoch: string | null; refusal: ControlRefusal | null }>>({});
  const settingsSeq = useRef<Record<string, number>>({});
  const beginSettingsSave = (scope: string): { seq: number; epoch: string | null } => {
    const seq = (settingsSeq.current[scope] ?? 0) + 1;
    settingsSeq.current[scope] = seq;
    return { seq, epoch: controlNow.current.epoch };
  };
  const showSettingsAnswer = (scope: string, request: { seq: number; epoch: string | null }, answer: ControlAnswer): void => {
    if (settingsSeq.current[scope] !== request.seq || controlNow.current.epoch !== request.epoch) return;
    const refusal = answer.kind === "uncertain" ? answer.refusal : answer.status >= 400 ? refusalFromAnswer(answer) : null;
    setSettingsRefusals((current) => ({ ...current, [scope]: { epoch: controlNow.current.epoch, refusal } }));
  };
  const settingsRefusal = (scope: string): ControlRefusal | null => {
    const feedback = settingsRefusals[scope];
    return feedback?.epoch === control.epoch ? feedback.refusal : null;
  };

  /** Name the choice under the revision it was read at; whatever the server says is read back, not assumed. */
  const sendWorkspaceMode = async (repoId: string, mode: "worktree" | "clone", expectedRevision: number): Promise<void> => {
    const scope = `@repository:${repoId}`;
    const request = beginSettingsSave(scope);
    const answer = await sendControlCommand(workspaceModePath(repoId), { commandId: nextCommandId(), expectedRevision, payload: { workspaceMode: mode } });
    showSettingsAnswer(scope, request, answer);
    if (answer.kind === "uncertain") dispatchControl({ type: "refusal", place: "panel", groupId: scope, value: answer.refusal });
    else if (answer.status >= 400) dispatchControl({ type: "refusal", place: "panel", groupId: scope, value: refusalFromAnswer(answer) });
    await readWorkspace(repoId); // a failed read leaves the refusal above to say why
  };

  /** Integration spec §3.1: name the repository's scheme under the revision it was read at; the answer is read back. */
  const sendRepositoryIntegration = async (repoId: string, scheme: IntegrationSchemeV1, expectedRevision: number): Promise<void> => {
    const scope = `@repository:${repoId}`;
    const request = beginSettingsSave(scope);
    const answer = await sendIntegrationScheme(repoId, scheme, expectedRevision);
    showSettingsAnswer(scope, request, answer);
    if (answer.kind === "uncertain") dispatchControl({ type: "refusal", place: "panel", groupId: scope, value: answer.refusal });
    else if (answer.status >= 400) dispatchControl({ type: "refusal", place: "panel", groupId: scope, value: refusalFromAnswer(answer) });
    await readIntegration(repoId);
  };

  /** Name the operator's new defaults under the revision they were read at; whatever the server says is read back. */
  const sendAgentPreferences = async (preferences: OperatorPreferencesV1, expectedRevision: number): Promise<void> => {
    if (agentPreferences === null) return;
    const scope = `@operator:${agentPreferences.operatorId}`;
    // Review P5: the payload is { preferences } only; the revision travels in the envelope.
    const request = beginSettingsSave(scope);
    const answer = await sendControlCommand(AGENT_PREFERENCES_PATH, { commandId: nextCommandId(), expectedRevision, payload: { preferences } });
    showSettingsAnswer(scope, request, answer);
    if (answer.kind === "uncertain") dispatchControl({ type: "refusal", place: "panel", groupId: scope, value: answer.refusal });
    else if (answer.status >= 400) dispatchControl({ type: "refusal", place: "panel", groupId: scope, value: refusalFromAnswer(answer) });
    try { setAgentPreferences(await fetchAgentPreferences()); } catch { /* the refusal above already says why */ }
  };

  /** Spec 2026-10-20 §3.3: the owner's Refresh versions, then the table and the detection state read again. */
  const refreshVersions = async (): Promise<void> => {
    setAgentUpdateBusy(true);
    try { await refreshAgentVersions(); setAgentUpdateNotice(null); }
    catch (error) { setAgentUpdateNotice(controlFailureFrom(error).message); }
    await loadAgents(false);
    setAgentUpdateBusy(false);
  };
  const detectInstallationUpdates = async (): Promise<void> => {
    setAgentUpdateBusy(true);
    try {
      await detectAgentInstallations();
      setAgentInstallations(await fetchAgentInstallationState());
      setAgentUpdateNotice(null);
    } catch (error) { setAgentUpdateNotice(controlFailureFrom(error).message); }
    finally { setAgentUpdateBusy(false); }
  };
  const applyInstallationUpdates = async (acceptedChangeIds: string[]): Promise<void> => {
    const view = agentInstallations, preview = view?.preview;
    if (!view || !preview || acceptedChangeIds.length === 0) return;
    setAgentUpdateBusy(true);
    const commandId = nextCommandId();
    const envelope = { commandId, expectedRevision: view.revision,
      payload: { previewId: preview.previewId, baseTableHash: preview.baseTableHash, acceptedChangeIds: [...acceptedChangeIds].sort() } };
    setLocalPendingUpdate(envelope); writePendingAgentUpdate(browserSession(), envelope);
    const answer = await sendControlCommand(AGENT_UPDATE_PATH, envelope);
    if (answer.kind === "uncertain") setAgentUpdateNotice(`${answer.refusal.message} (${commandId})`);
    else if (answer.status >= 400) { setLocalPendingUpdate(null); writePendingAgentUpdate(browserSession(), null); setAgentUpdateNotice(refusalFromAnswer(answer).message); }
    else {
      setLocalPendingUpdate(null); writePendingAgentUpdate(browserSession(), null);
      setAgentUpdateNotice(null);
      await loadAgents(false);
    }
    try { setAgentInstallations(await fetchAgentInstallationState()); } catch { /* old view remains visible */ }
    setAgentUpdateBusy(false);
  };
  const retryPendingInstallationUpdate = async (): Promise<void> => {
    const pending = agentInstallations?.pendingCommand;
    const local = localPendingUpdate;
    if (!pending && !local) return;
    setAgentUpdateBusy(true);
    if (!pending && local && agentPreferences) {
      const result = await recoverUncertainCommand(`@operator:${agentPreferences.operatorId}`, local.commandId);
      if (result.kind === "found" || result.kind === "absent") {
        setLocalPendingUpdate(null); writePendingAgentUpdate(browserSession(), null);
        setAgentUpdateNotice(result.kind === "absent" ? result.refusal.message
          : result.lookup.originalStatus >= 400 ? refusalFromAnswer({ kind: "answered", status: result.lookup.originalStatus, body: result.lookup.body }).message : null);
        if (result.kind === "found" && result.lookup.originalStatus < 300) await loadAgents(false);
      } else setAgentUpdateNotice(result.refusal.message);
      setAgentUpdateBusy(false);
      return;
    }
    if (!pending) { setAgentUpdateBusy(false); return; }
    const answer = await sendControlCommand(AGENT_UPDATE_PATH, {
      commandId: pending.commandId, expectedRevision: pending.expectedRevision, payload: pending.payload,
    });
    if (answer.kind === "uncertain") setAgentUpdateNotice(`${answer.refusal.message} (${pending.commandId})`);
    else if (answer.status >= 400) { setAgentUpdateNotice(refusalFromAnswer(answer).message); setLocalPendingUpdate(null); writePendingAgentUpdate(browserSession(), null); }
    else { setAgentUpdateNotice(null); setLocalPendingUpdate(null); writePendingAgentUpdate(browserSession(), null); await loadAgents(false); }
    try { setAgentInstallations(await fetchAgentInstallationState()); } catch { /* retain command for another explicit retry */ }
    setAgentUpdateBusy(false);
  };

  useEffect(() => {
    void (async () => {
      try {
        setControlConfig(await fetchControlConfig());
      } catch {
        setControlConfig(null);
      }
    })();
  }, []);

  useEffect(() => {
    if (controlConfig === null) return;
    // A command id that survived the reload is resolved before anything else reads.
    for (const command of controlNow.current.uncertainCommandIds) void resolveUncertain(command);
    void readControlTick();
    const timer = setInterval(() => void readControlTick(), CONTROL_POLL_MS);
    return () => clearInterval(timer);
  }, [controlConfig]);

  // Project switcher spec D2, project registry spec §7: the stored (or current) choice while it is still listed, else
  // the first project. Re-read after an add or rename and whenever the window regains focus (another tab may have
  // added one). A failed read leaves no choice: every section acts on the first repository as before.
  const readProjects = useCallback((): Promise<void> => fetchProjects().then(
    (answer) => {
      setProjectsAnswer(answer);
      setProject((current) => pickProject(answer.projects, current ?? readProject(browserStorage())));
    },
    () => { setProjectsAnswer(null); setProject(null); },
  ), []);
  useEffect(() => { void readProjects(); }, [readProjects]);
  useEffect(() => {
    const onFocus = (): void => { void readProjects(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [readProjects]);
  const rereadAfterProjectChange = async (): Promise<void> => {
    await readProjects();
    try { setControlConfig(await fetchControlConfig()); } catch { /* keep the config already on screen */ }
  };
  const chooseProject = (projectKey: string): void => {
    setProject(projectKey);
    setProjectView("project");
    writeProject(browserStorage(), projectKey);
    writeProjectView(browserStorage(), "project");
  };
  const chooseAll = (): void => {
    setProjectView("all");
    writeProjectView(browserStorage(), "all");
  };
  // "All projects" needs two or more projects: a stored "all" over a shorter list is normalised to "project".
  const projectCount = projectsAnswer?.projects.length ?? null;
  useEffect(() => {
    if (projectCount === null || allowsAll(projectCount) || projectView !== "all") return;
    setProjectView("project");
    writeProjectView(browserStorage(), "project");
  }, [projectCount, projectView]);
  // The scope the lists are filtered by (spec §3, §5).
  const scope = groupScope(projectsAnswer, project, projectView);
  // Spec §5: the open group, requirement and decision close when the scope changes. The first resolved scope (nothing
  // was chosen before it) closes nothing, and a failed project list (no project) neither closes nor counts as a
  // change. Drafts are the person's own data and are never touched.
  const scopeKey = JSON.stringify([scope.kind === "all", project]);
  /** The scope key now, for a command whose answer outlives the render it was sent from. */
  const scopeKeyNow = useRef(scopeKey);
  scopeKeyNow.current = scopeKey;
  const lastScopeKey = useRef<string | null>(null);
  useEffect(() => {
    if (project === null) return;
    const previous = lastScopeKey.current;
    lastScopeKey.current = scopeKey;
    if (previous === null || previous === scopeKey) return;
    setSelectedGroup(null);
    setSelectedRequirement(null);
    setSelected(null);
  }, [scopeKey]);
  // Source identity is updated during render: a reply cannot land between a scope/auth/epoch change and effect cleanup.
  const sourceIdentity = JSON.stringify([account, control.epoch, scope, project]);
  const sourceIdentityNow = useRef(sourceIdentity); sourceIdentityNow.current = sourceIdentity;
  const todo = todoSource.identity === sourceIdentity ? todoSource : loadingSource<readonly DecisionListRow[]>();
  const overview = overviewSource.identity === sourceIdentity ? overviewSource : loadingSource<OverviewV1>();
  const overviewRecovery = recoverySource.identity === sourceIdentity ? recoverySource : loadingSource<RecoveryViewV1>();
  const readTodo = async (): Promise<void> => {
    const identity = sourceIdentityNow.current, seq = ++todoSeq.current;
    try {
      const body = await fetchTodo();
      if (identity !== sourceIdentityNow.current || seq !== todoSeq.current) return;
      setTodoSource({ identity, status: "available", data: body.rows, error: null });
    } catch (err) {
      if (identity !== sourceIdentityNow.current || seq !== todoSeq.current) return;
      setTodoSource((prior) => ({ ...sourceFailure(prior.identity === identity ? prior : loadingSource(), failureFrom(err).message), identity }));
    }
  };
  const readOverview = async (): Promise<void> => {
    const identity = sourceIdentityNow.current, epoch = controlNow.current.epoch, seq = ++overviewSeq.current;
    try {
      const value = await fetchOverview();
      if (identity !== sourceIdentityNow.current || seq !== overviewSeq.current || (epoch !== null && value.epoch !== epoch)) return;
      setOverviewSource((prior) => prior.identity === identity && prior.data !== null && prior.data.changeSeq > value.changeSeq ? prior : { identity, status: "available", data: value, error: null });
    } catch (err) {
      if (identity !== sourceIdentityNow.current || seq !== overviewSeq.current) return;
      setOverviewSource((prior) => ({ ...sourceFailure(prior.identity === identity ? prior : loadingSource(), failureFrom(err).message), identity }));
    }
  };
  const readOverviewRecovery = async (): Promise<void> => {
    const identity = sourceIdentityNow.current, epoch = controlNow.current.epoch, seq = ++recoverySeq.current;
    try {
      const value = await fetchControlRecovery();
      if (identity !== sourceIdentityNow.current || seq !== recoverySeq.current || (epoch !== null && value.epoch !== epoch)) return;
      setRecoverySource({ identity, status: "available", data: value, error: null });
    } catch (err) {
      if (identity !== sourceIdentityNow.current || seq !== recoverySeq.current) return;
      setRecoverySource((prior) => ({ ...sourceFailure(prior.identity === identity ? prior : loadingSource(), failureFrom(err).message), identity }));
    }
  };
  useEffect(() => {
    // Every pane has its initial todo read; only Overview maintains the independent refresh timer.
    if (section === "overview" || todoSource.identity !== sourceIdentity) void readTodo();
    if (section !== "overview") return;
    void readOverview(); void readOverviewRecovery();
    const todoTimer = setInterval(() => void readTodo(), 5_000);
    const controlTimer = setInterval(() => { void readOverview(); void readOverviewRecovery(); }, CONTROL_POLL_MS);
    return () => { clearInterval(todoTimer); clearInterval(controlTimer); todoSeq.current++; overviewSeq.current++; recoverySeq.current++; };
  }, [sourceIdentity, section === "overview"]);
  useEffect(() => () => { todoSeq.current++; overviewSeq.current++; recoverySeq.current++; navigationSeq.current++; }, []);

  const decision = acceptedDecision !== null && selected !== null
    && acceptedDecision.identity === sourceIdentity && acceptArrival(selected, acceptedDecision.owner)
    && (overviewDecisionRead === null || acceptedDecision.request === overviewDecisionRead.request)
    ? acceptedDecision.body : null;
  const decisionReview = decision !== null ? acceptedDecision?.review : undefined;
  const openDecisionRow = (row: DecisionIdentity): void => {
    navigationSeq.current++; setOverviewFocus(null); setOverviewDecisionRead(null); setSelected(row);
  };
  /**
   * Control run decisions plan Task 11: a group's 纠正 opens that decision's detail in Decisions, as a list row does. The
   * detail is read by projectKey and id; a decision no list row carries yet is opened by that identity alone, and the
   * pane says it is not in the list.
   */
  const openDecisionById = (projectKey: string, decisionId: string): void => {
    openDecisionRow({ projectKey, id: decisionId });
    setSection("decisions"); window.location.hash = "decisions";
  };
  const overviewModel = deriveOverview({ projection: overview, todo, recovery: overviewRecovery, uncertain: control.uncertainCommandIds,
    scope, projectKey: project, projects, roles: account?.user.roles ?? [] });
  const overviewModelNow = useRef(overviewModel); overviewModelNow.current = overviewModel;
  const overviewNow = useRef(overview); overviewNow.current = overview;
  const openOverviewTarget = (target: OverviewTarget): void => {
    const request = ++navigationSeq.current, identity = sourceIdentityNow.current;
    setOverviewNavigationFailure(null);
    const current = (): boolean => navigationSeq.current === request && identity === sourceIdentityNow.current;
    const unavailable = (): void => { if (current()) { setOverviewNavigationFailure(t("overview.navigationUnavailable")); void readProjects(); void readOverview(); void readTodo(); } };
    const finish = (section: Section): void => {
      setSection(section); window.location.hash = section;
      setOverviewFocus({ target, request });
    };
    if (target.kind === "global-control") { void readControlTick(); finish("tasks"); return; }
    if (target.kind === "decision") {
      if (todo.status !== "available") { unavailable(); return; }
      const row = todo.data?.find((row) => row.projectKey === target.projectKey && row.id === target.id);
      if (row === undefined || (scope.kind === "project" && target.projectKey !== project)) { unavailable(); return; }
      // Every click owns a fresh read, including the same retained todo row during a pending refresh.
      setOverviewDecisionRead({ owner: row, identity, request }); setSelected(row);
      wanted.current = row; setAcceptedDecision(null);
      void fetchDecision(target.projectKey, target.id).then(
        (body) => {
          if (!current()) return;
          setStatus("unreviewed"); setFilter(NO_FILTER); setSelected(row);
          setAcceptedDecision({ owner: row, body: body.decision as Decision, identity, request, review: body.review });
          finish("decisions");
        },
        () => {
          if (!current()) return;
          setSelected(null); setOverviewDecisionRead(null);
          unavailable();
        },
      );
      return;
    }
    const owner = overview.data?.groups.find((g) => g.groupId === target.groupId && g.archived !== true);
    if (overview.status !== "available" || owner === undefined
      || (scope.kind === "project" && owner.repoId !== scope.repoId)) { unavailable(); return; }
    void (async () => {
      try {
        if (target.kind === "requirement") {
          const value = await fetchRequirement(target.groupId);
          if (!current()) return;
          if (value.summary.groupId !== target.groupId || value.summary.repoId !== owner.repoId || value.summary.archived === true
            || value.epoch !== overviewNow.current.data?.epoch || value.changeSeq < Math.max(overviewNow.current.data?.changeSeq ?? 0, controlNow.current.changeSeq)) { unavailable(); return; }
          if (!overviewModelNow.current.progress.some((p) => p.group.groupId === target.groupId)) { unavailable(); return; }
          setRequirementViews((all) => ({ ...all, [target.groupId]: value })); setSelectedRequirement(target.groupId); finish("requirements");
        } else {
          const value = await fetchControlGroup(target.groupId);
          if (!current()) return;
          if (value.summary.groupId !== target.groupId || value.summary.repoId !== owner.repoId || value.summary.archived === true
            || value.epoch !== overviewNow.current.data?.epoch || value.changeSeq < Math.max(overviewNow.current.data?.changeSeq ?? 0, controlNow.current.changeSeq)
            || (target.taskId !== null && !value.workItems.some((item) => item.taskId === target.taskId))
            || (target.runId !== null && !value.runs.some((run) => run.runId === target.runId))) { unavailable(); return; }
          if (!overviewModelNow.current.progress.some((p) => p.group.groupId === target.groupId)) { unavailable(); return; }
          dispatchControl({ type: "group", value }); setSelectedGroup(target.groupId); finish("tasks");
        }
      } catch { unavailable(); }
    })();
  };
  useEffect(() => {
    if (overviewFocus === null || focusedRequest.current === overviewFocus.request) return;
    if (overviewFocus.target.kind === "decision" && (
      section !== "decisions" || decision === null || acceptedDecision?.request !== overviewFocus.request
      || !acceptArrival(acceptedDecision.owner, overviewFocus.target)
    )) return;
    const element = document.getElementById(overviewFocusId(overviewFocus.target));
    if (element === null) return;
    element.focus(); element.scrollIntoView?.({ block: "nearest" }); focusedRequest.current = overviewFocus.request;
  }, [overviewFocus, selected, decision, acceptedDecision, selectedGroup, control.canonical, selectedRequirement, requirementViews, section]);

  // The chosen project's control repository: undefined while no project is chosen (the first repository, as before),
  // null when the control plane does not hold the chosen project.
  const chosen = projects?.find((entry) => entry.projectKey === project);
  const nameOf = useCallback((key: string) => {
    const entry = projects?.find((candidate) => candidate.projectKey === key);
    return entry ? projectName(entry) : key;
  }, [projects]);
  const controlRepoId = chosen === undefined ? undefined : chosen.controlRepoId;
  // Plan decision P5: a repository's name is its project's, else the config's display name, else the repoId itself --
  // never the selected project's name.
  const repoLabel = useMemo(() => (repoId: string): string => {
    const owner = projects?.find((entry) => entry.controlRepoId === repoId);
    if (owner !== undefined) return projectName(owner);
    return controlConfig?.repositories.find((entry) => entry.repoId === repoId)?.displayName ?? repoId;
  }, [projects, controlConfig]);
  // Spec §6: what an All-projects import or new requirement may target -- a registered project's control repository.
  const targets = useMemo(() => (projects ?? []).flatMap((entry) => (entry.controlRepoId === null ? [] : [entry.controlRepoId])), [projects]);
  /** Read one repository's workspace mode; only the newest read of that repository is applied (spec §8). */
  const readWorkspace = async (repoId: string): Promise<void> => {
    const seq = (workspaceSeq.current[repoId] ?? 0) + 1;
    workspaceSeq.current[repoId] = seq;
    let answer: RepositoryWorkspaceV1 | null = null;
    try { answer = await fetchRepositoryWorkspace(repoId); } catch { /* an unread repository shows no mode */ }
    if (workspaceSeq.current[repoId] !== seq) return;
    setWorkspaces((current) => {
      if (answer !== null) return { ...current, [repoId]: answer };
      const { [repoId]: _gone, ...rest } = current;
      return rest;
    });
  };
  /** Read one repository's integration default; only the newest read of that repository is applied. */
  const readIntegration = async (repoId: string): Promise<void> => {
    const seq = (integrationSeq.current[repoId] ?? 0) + 1;
    integrationSeq.current[repoId] = seq;
    let answer: RepositoryIntegrationV1 | null = null;
    try { answer = await fetchRepositoryIntegration(repoId); } catch { /* an unread repository shows no integration section */ }
    if (integrationSeq.current[repoId] !== seq) return;
    setIntegrations((current) => {
      if (answer !== null) return { ...current, [repoId]: answer };
      const { [repoId]: _gone, ...rest } = current;
      return rest;
    });
  };
  // Plan decision P3: the panel-level selector belongs to the chosen project's repository, in project mode only.
  const panelRepoId = scope.kind === "project" ? scope.repoId : null;
  const openRepoId = selectedGroup === null ? null : control.canonical[selectedGroup]?.plan.repoId ?? null;
  useEffect(() => {
    if (controlConfig === null || panelRepoId === null) return;
    void readWorkspace(panelRepoId);
    void readIntegration(panelRepoId);
  }, [controlConfig, panelRepoId]);
  // Control run decisions plan Task 11: the open group's decisions, read again whenever its projection or revision moves.
  const openGroupView = selectedGroup === null ? undefined : control.canonical[selectedGroup];
  useEffect(() => {
    if (selectedGroup === null || openGroupView === undefined) return;
    const seq = ++decisionsSeq.current, groupId = selectedGroup;
    fetchGroupDecisions(groupId).then(
      (value) => { if (seq === decisionsSeq.current) setGroupDecisions((all) => ({ ...all, [groupId]: value })); },
      // A failed read is kept as failed (Rule 12): the group says its decisions could not be read, rather than showing a
      // stale read as current or silently dropping its badge.
      (err: unknown) => { if (seq === decisionsSeq.current) setGroupDecisions((all) => ({ ...all, [groupId]: { failed: controlFailureFrom(err).code } })); },
    );
  }, [selectedGroup, openGroupView?.changeSeq, openGroupView?.summary.commandRevision]);
  // Spec §5: an open group's detail always uses its own repository's workspace, whatever the scope.
  useEffect(() => {
    if (controlConfig === null || openRepoId === null) return;
    void readWorkspace(openRepoId);
    void readIntegration(openRepoId);
  }, [controlConfig, openRepoId]);

  useEffect(() => {
    writeUncertainCommands(browserSession(), control.uncertainCommandIds);
  }, [control.uncertainCommandIds]);

  // Agent selection spec §6.8. An unconfigured port is asked too: its refusal code is what the proposal view shows.
  useEffect(() => {
    if (controlConfig === null) return;
    void loadAgents(true);
  }, [controlConfig]);

  // Ruling review R17 (a): the operator usually fixes an installation outside this page (a terminal), so coming back
  // to the page -- focus, or the tab becoming visible -- reads the table, the preferences and the open preview again.
  useEffect(() => {
    const back = (): void => { if (!pageHidden()) setReturnNonce((value) => value + 1); };
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", back);
    return () => { window.removeEventListener("focus", back); document.removeEventListener("visibilitychange", back); };
  }, []);
  useEffect(() => {
    if (returnNonce === 0 || controlConfig === null || controlConfig.executionPort !== "configured") return;
    clearTimeout(agentsTimer.current);
    agentsRetries.current = 0;
    setAgentsRetry(null);
    void loadAgents(true);
    resetPreviewRetries();
    setPreviewNonce((value) => value + 1);
  }, [returnNonce]);

  // The preview is re-read whenever what it depends on moved: the open group, its proposal version, the
  // preferences -- or the page decided the one it holds is void (previewNonce).
  const openGroup = selectedGroup === null ? undefined : control.canonical[selectedGroup];
  // Ruling review R17 (b): the installation table's content is part of the key, so a table that changed (a new
  // version recorded after an upgrade) re-reads the preview by itself; the same table read again does not.
  const agentsKey = agents === null ? null : JSON.stringify(agents.installations);
  const baseKey = openGroup === undefined || openGroup.proposal.state !== "editable"
    ? null
    : `${openGroup.summary.groupId}\0${openGroup.proposal.proposalVersion}\0${agentPreferences?.revision ?? -1}\0${agentsKey}`;
  const previewKey = baseKey === null ? null : `${baseKey}\0${previewNonce}`;
  // Another group, proposal version, preferences or table is a new round of retries (R17).
  useEffect(() => { resetPreviewRetries(); }, [baseKey]);
  useEffect(() => {
    if (previewKey === null || openGroup === undefined || agents === null) return;
    const groupId = openGroup.summary.groupId;
    const seq = ++previewSeq.current;
    void fetchAgentPreview(groupId).then(
      (value) => {
        if (seq !== previewSeq.current) return;
        // An unavailable slot (spec §6.8, wave 3 I-1) is shown red with its code; R17 reads it again on the backoff.
        setPreviews((prior) => ({ ...prior, [groupId]: value }));
        if (value.slots.some((slot) => slot.outcome.kind === "unavailable")) schedulePreviewRetry();
        else resetPreviewRetries();
      },
      (err) => {
        if (seq !== previewSeq.current) return;
        dispatchControl({ type: "refusal", place: "group", groupId, value: controlFailureFrom(err) });
        schedulePreviewRetry();
      },
    );
  }, [previewKey]);

  // Opening a group, a voided cache and a projection gap all mean: re-read it canonically.
  // Each of those empties the cache entry it voids, so "not cached" is the whole trigger: also reading while the
  // voided mark is still up made every arriving body the cause of the next GET.
  // Web-recoverable-control spec §3.2: the open group is also re-read once the projection has moved past the cached
  // body (its changeSeq is older than the summary's), with the cached body left on the page until the new one
  // arrives. This is wider than "its projectionSeq moved" -- another group moving re-reads it too -- and it is what
  // keeps the open group fresh now that a summary no longer voids the cache. Only strictly older counts, so a body
  // read after the summary (after a command) reads nothing, and an arriving body settles it.
  useEffect(() => {
    if (controlConfig === null || selectedGroup === null) return;
    const cached = control.canonical[selectedGroup];
    if (cached !== undefined && cached.changeSeq >= control.changeSeq) return;
    void readControlGroup(selectedGroup);
  }, [controlConfig, selectedGroup, control.canonical, control.changeSeq]);

  const loadHome = async (): Promise<void> => {
    const auth = authNow.current;
    try {
      const metrics = await fetchMetrics();
      if (auth !== authNow.current) return;
      setHome({ report: metrics.report, coverage: metrics.panel_review_coverage }); setMetricsFailure(null);
    } catch (err) { if (auth === authNow.current) setMetricsFailure(failureFrom(err)); }
  };
  useEffect(() => { void loadHome(); }, [account]);

  // Reviewed / All follow the independent decision read, including after a recorded review when metrics failed.
  useEffect(() => {
    if (status === "unreviewed") return;
    let live = true;
    void fetchDecisions().then(
      (body) => { if (live) setAllRows(body.rows); },
      (err) => { if (live) setError(failureFrom(err)); },
    );
    return () => { live = false; };
  }, [status, todo.data]);

  const statusRows: readonly DecisionListRow[] =
    status === "unreviewed" ? todo.data ?? [] : rowsForStatus(allRows ?? [], status);
  // Final review M-T8: Reviewed / All before their first read are loading, not empty.
  const statusLoading = status === "unreviewed" ? todo.status === "loading" : allRows === null;
  // The Decisions pane's rows and filter, shared by both of its branches and by the review loop (taste refinement P1-3).
  const scopedDecisionRows = projects === null || scope.kind === "all" ? statusRows : statusRows.filter((row) => row.projectKey === project);
  const effectiveDecisionFilter = projects === null ? filter : { ...filter, projectKey: "" };
  const visibleDecisionRows = visibleByImportance(filterRows(scopedDecisionRows, effectiveDecisionFilter), showMinor);

  /**
   * Parked finding N-1 / ruling R71. Opening another row takes the previous
   * decision off the screen FIRST, so the buttons and the text under them can
   * never mean two different decisions; and an answer is only applied when it
   * is still the one being waited for, so a slow answer that arrives after the
   * person moved on is dropped instead of repainting the page behind them.
   */
  useEffect(() => {
    // The explicit Overview request above owns both read and arrival; never issue a second selected-row GET for it.
    if (overviewDecisionRead !== null) {
      if (overviewDecisionRead.identity !== sourceIdentity || !acceptArrival(selected, overviewDecisionRead.owner)) {
        // A context/selection change cancels this intent; it must not become an automatic read of the old owner.
        setOverviewDecisionRead(null); setSelected(null); setAcceptedDecision(null);
      }
      return;
    }
    setAcceptedDecision(null);
    wanted.current = selected;
    if (selected === null) return;
    const identity = sourceIdentityNow.current;
    let live = true;
    void (async () => {
      try {
        const body = await fetchDecision(selected.projectKey, selected.id);
        if (!live || identity !== sourceIdentityNow.current || !acceptArrival(wanted.current, selected)) return;
        setAcceptedDecision({ owner: selected, body: body.decision as Decision, identity, request: null, review: body.review });
      } catch (err) {
        if (!live || identity !== sourceIdentityNow.current || !acceptArrival(wanted.current, selected)) return;
        setError(failureFrom(err));
      }
    })();
    return () => { live = false; };
  }, [selected, sourceIdentity, overviewDecisionRead]);

  /**
   * Decisions review withdraw spec §7: after a recorded request the open detail is read again IN PLACE -- the body on
   * screen stays until the new one lands, so the inline result under it never blinks -- and the new answer is kept
   * only while the same decision is still the wanted one (the rule above). The read that opened it keeps its
   * `request`, so an Overview-opened detail stays shown.
   */
  useEffect(() => {
    if (detailRefresh === 0 || selected === null) return;
    const owner = selected, identity = sourceIdentityNow.current;
    let live = true;
    void (async () => {
      try {
        const body = await fetchDecision(owner.projectKey, owner.id);
        if (!live || identity !== sourceIdentityNow.current || !acceptArrival(wanted.current, owner)) return;
        setAcceptedDecision((prior) => prior === null || prior.identity !== identity || !acceptArrival(prior.owner, owner)
          ? prior : { ...prior, body: body.decision as Decision, review: body.review });
      } catch (err) {
        if (!live || identity !== sourceIdentityNow.current || !acceptArrival(wanted.current, owner)) return;
        setError(failureFrom(err));
      }
    })();
    return () => { live = false; };
  }, [detailRefresh]);

  /**
   * Spec §11 R3: send one Agree or Correct as its own request record (owner, verb, a copy of the exact payload) and
   * apply its answer to that record only -- whatever is selected by then. After a success, refetch so the to-do list
   * and coverage reflect it (the scope and the open detail stay as they are). Spec §11 R2: a correction's success
   * clears its owner's draft only if it still equals `submittedForm`; a refusal or a transport error keeps it.
   */
  const submitDecision = async (
    owner: { projectKey: string; decisionId: string },
    verb: "agree" | "correct",
    payload: RecordCorrectionInput | null,
    submittedForm?: CorrectionForm,
    advanceFrom?: { reviewed: DecisionIdentity; before: DecisionListRow[] },
  ): Promise<void> => {
    const requestId = nextCommandId();
    const sent = payload === null ? null : { ...payload };
    setDecisionRequests((all) => startRequest(all, { requestId, owner, verb, payload: sent }));
    try {
      const result = sent === null ? await recordReview(owner.projectKey, owner.decisionId) : await recordCorrection(sent);
      if (!result.ok) {
        const { ok: _ok, ...refusal } = result;
        setDecisionRequests((all) => settleRequest(all, requestId, { kind: "refused", refusal }));
        return;
      }
      setDecisionRequests((all) => settleRequest(all, requestId, { kind: "recorded", text: verb === "agree" ? "decisions.recordedReviewed" : "decisions.correctionRecorded" }));
      if (verb === "correct") void openDebugGroup(owner, result.body);
      if (submittedForm !== undefined) setDetailDrafts((all) => clearIfUnchanged(all, "correction", correctionKey(owner.projectKey, owner.decisionId), submittedForm));
      setReviewedThisSession((n) => n + 1);
      await Promise.all([readTodo(), loadHome()]);
      if (verb === "agree" && advanceFrom !== undefined) setPendingAdvance(advanceFrom);
      setDetailRefresh((n) => n + 1);
    } catch (err) {
      setDecisionRequests((all) => settleRequest(all, requestId, { kind: "refused", refusal: failureFrom(err) }));
    }
  };
  /**
   * Debug task plan Task 13 (§3.1 panel bullet, ruling C11): the panel form keeps POST /api/corrections, and once the row is
   * stored it opens the correction's debug group at once (expected revision 0). The record's outcome never depends on it.
   */
  const openDebugGroup = async (owner: { projectKey: string; decisionId: string }, answer: unknown): Promise<void> => {
    const key = correctionKey(owner.projectKey, owner.decisionId);
    const id = (answer as { correction?: { id?: unknown } } | null)?.correction?.id;
    if (typeof id !== "string") {
      setDebugOpens((all) => ({ ...all, [key]: { refusal: { status: 200, code: "command-result-invalid", message: "command-result-invalid", commandRevision: null } } }));
      return;
    }
    await sendDebugOpen(key, debugOpenAction(id), nextCommandId());
  };
  const sendDebugOpen = async (key: string, action: CorrectionAttempt["action"], commandId: string): Promise<void> => {
    setDebugOpens((all) => ({ ...all, [key]: { action, commandId, outcome: { kind: "pending" } } }));
    const attempt = await sendCorrectionCommand(action, commandId);
    setDebugOpens((all) => ({ ...all, [key]: attempt }));
  };
  /**
   * Decisions review withdraw spec §7 / §10.1: a withdrawal is a request record like Agree / Correct, but it never
   * advances -- the decision stays open, the lists and coverage are re-read, and its detail is read again so the
   * withdrawal shows. It is not a review, so the session count does not move.
   */
  const submitWithdraw = async (
    owner: { projectKey: string; decisionId: string },
    withdrawal: { verb: "withdraw-review" } | { verb: "withdraw-correction"; correctionId: string },
  ): Promise<void> => {
    const requestId = nextCommandId();
    const target = withdrawal.verb === "withdraw-correction" ? { correctionId: withdrawal.correctionId } : {};
    setDecisionRequests((all) => startRequest(all, { requestId, owner, verb: withdrawal.verb, payload: null, ...target }));
    try {
      const result = withdrawal.verb === "withdraw-review"
        ? await withdrawReview(owner.projectKey, owner.decisionId)
        : await withdrawCorrection(withdrawal.correctionId);
      if (!result.ok) {
        const { ok: _ok, ...refusal } = result;
        setDecisionRequests((all) => settleRequest(all, requestId, { kind: "refused", refusal }));
        // A refusal can still follow a write: the correction route's 409 after the withdrawal landed but the review
        // mark did not (final review Minor 3). Read the detail again so it shows what the files now hold.
        setDetailRefresh((n) => n + 1);
        return;
      }
      const text = withdrawal.verb === "withdraw-review" ? "decisions.reviewWithdrawn" : "decisions.correctionWithdrawn";
      setDecisionRequests((all) => settleRequest(all, requestId, { kind: "recorded", text }));
      await Promise.all([readTodo(), loadHome()]);
      setDetailRefresh((n) => n + 1);
    } catch (err) {
      setDecisionRequests((all) => settleRequest(all, requestId, { kind: "refused", refusal: failureFrom(err) }));
    }
  };
  /** "Record another" of one refused record: its own stored payload with again:true, under its own owner. */
  const recordAnother = (record: DecisionRequest): void => {
    const retry = retryPayload(record);
    if (retry !== null) void submitDecision(record.owner, "correct", retry);
  };

  // Taste refinement P1-3: once the list has been re-read after an Agree, open the row that followed the reviewed one
  // -- only if that row is still the open one and has left the list. Runs every render; returns at once when idle.
  useEffect(() => {
    if (pendingAdvance === null) return;
    setPendingAdvance(null);
    if (selected === null || rowKey(selected) !== rowKey(pendingAdvance.reviewed)) return;
    const next = nextAfterReview(pendingAdvance.before, pendingAdvance.reviewed, visibleDecisionRows);
    if (next !== null) openDecisionRow(next);
  }, [pendingAdvance, visibleDecisionRows]);

  // Taste refinement P1-3: j / k move, a agrees, c starts a correction -- on the Decisions pane only, never while
  // typing (reviewKeyAction), and never a second Agree while this decision's first is in flight (Review Focus 2).
  // No dependency array: rebound every render, so the handler always reads the current state.
  useEffect(() => {
    if (section !== "decisions" || decisionsTab !== "decisions") return;
    const onKey = (event: KeyboardEvent): void => {
      const action = reviewKeyAction(event);
      if (action === null) return;
      // Final review M6 (WCAG 2.1.4): act only with focus on the page body or inside the Decisions pane, never while it
      // sits on some other control (an account-bar or notice button), where a stray `a` would record an Agree.
      // Visual acceptance (session fb98aa31): Decisions' own nav link also counts -- clicking it is how a person
      // arrives here, and focus stays on it.
      const target = event.target as Element | null;
      if (target !== document.body && target?.closest?.('.section-pane[data-section="decisions"]') == null && target?.closest?.('.nav-item[href="#decisions"]') == null) return;
      const at = selected === null ? -1 : visibleDecisionRows.findIndex((row) => rowKey(row) === rowKey(selected));
      if (action === "next" || action === "previous") {
        const to = visibleDecisionRows[action === "next" ? at + 1 : Math.max(at - 1, 0)];
        // Final review M5: j on the last row / k on the first resolves to the open row itself; do not re-open (re-fetch) it.
        if (to !== undefined && (selected === null || rowKey(to) !== rowKey(selected))) {
          event.preventDefault(); openDecisionRow(to);
          requestAnimationFrame(() => document.querySelector('.decision-row[aria-current="true"]')?.scrollIntoView?.({ block: "nearest" }));
        }
      } else if (action === "agree" && selected !== null && decision !== null) {
        // Fix round 1: no second Agree while one is in flight, nor once one is recorded for this row (the ledger would
        // keep a duplicate review, and the session count would count it twice).
        const record = inlineRequest(decisionRequests, selected);
        if (record?.status.kind === "pending" || (record?.status.kind === "recorded" && record.verb === "agree")) return;
        // Spec §7: nor while the open detail reads reviewed -- the Agree button is disabled then, and so is its key.
        if (decisionReview?.mine === "reviewed") return;
        event.preventDefault();
        void submitDecision({ projectKey: selected.projectKey, decisionId: selected.id }, "agree", null, undefined, { reviewed: selected, before: visibleDecisionRows });
      } else if (action === "correct") {
        const pane = document.querySelector('.section-pane[data-section="decisions"]');
        const box = pane?.querySelector<HTMLTextAreaElement>('textarea[name="because"]') ?? null;
        if (box !== null) { event.preventDefault(); box.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (error !== null) return <ErrorPage failure={error} />;

  const dismiss = (chainId: string): void => {
    const next = new Set(dismissed);
    next.add(chainId);
    setDismissed(next);
    writeDismissed(browserStorage(), next);
  };
  const summary = controlConfig !== null && control.recovery !== null ? summaryView(control) : null;
  const inline = inlineRequest(decisionRequests, selected);
  const debugOpen = selected === null ? undefined : debugOpens[correctionKey(selected.projectKey, selected.id)];
  const detail =
    selected !== null && decision !== null ? (
      <>
      <div id="overview-decision-detail" tabIndex={-1} data-overview-region="decision">
      <DecisionDetail
        decision={decision}
        draft={detailDrafts.correction[correctionKey(selected.projectKey, selected.id)]}
        onDraft={(form) => onDetailDraft("correction", correctionKey(selected.projectKey, selected.id), form)}
        onAgree={() => {
          void submitDecision({ projectKey: selected.projectKey, decisionId: selected.id }, "agree", null, undefined, { reviewed: selected, before: visibleDecisionRows });
        }}
        onCorrect={(form) => {
          const owner = { projectKey: selected.projectKey, decisionId: selected.id };
          void submitDecision(owner, "correct", correctionBody(owner, form), form);
        }}
        review={decisionReview}
        withdrawing={pendingWithdrawals(decisionRequests, { projectKey: selected.projectKey, decisionId: selected.id })}
        onWithdrawReview={() => {
          void submitWithdraw({ projectKey: selected.projectKey, decisionId: selected.id }, { verb: "withdraw-review" });
        }}
        onWithdrawCorrection={(correctionId) => {
          void submitWithdraw({ projectKey: selected.projectKey, decisionId: selected.id }, { verb: "withdraw-correction", correctionId });
        }}
      />
      </div>
      {inline?.status.kind === "recorded" && <p role="status" data-tone="ok">{t(inline.status.text)}</p>}
      {inline?.status.kind === "refused" && (
        <Refusal
          refusal={inline.payload === null ? withoutRetry(inline.status.refusal) : inline.status.refusal}
          onRecordAnother={() => recordAnother(inline)}
        />
      )}
      {debugOpen !== undefined && ("refusal" in debugOpen
        ? <RefusalNotice refusal={debugOpen.refusal} testId="debug-open-refusal" />
        : <AttemptNotice attempt={debugOpen} onResend={(action, commandId) => { void sendDebugOpen(correctionKey(selected!.projectKey, selected!.id), action, commandId); }} />)}
      </>
    ) : null;
  const modelsFor = (id: string): ModelListState | undefined => agentModels[id];
  // Spec 2026-10-15 §5 (R4): only an owner may make ccloop re-probe (the server refuses a member), so only an owner sees the button.
  const refreshModels = (account?.user.roles ?? []).includes("owner") ? (id: string): void => { void loadModels(id, true); } : undefined;

  return (
    <ProjectNames.Provider value={nameOf}>
    <Shell
      active={section}
      showAdvanced={showAdvanced}
      badges={{
        // Reported-decisions spec 2026-10-20 §6 (goal.md §1.3): the badge counts what asks for attention, so not minor rows.
        unreviewed: todo.status === "available" ? todo.data?.filter((row) => !isMinor(row)).length ?? null : null,
        chainRunning: chains?.some((r) => r.chain?.state === "running") ?? false,
        controlAlert: controlAlert(
          summary === null || control.recovery === null
            ? null
            : {
                resetRequired: summary.resetRequired,
                dispatchBlocked: summary.dispatchBlocked || control.recovery.dispatchBlocked,
                blockers: control.recovery.blockers.length,
                refusal: control.panelRefusal !== null || control.importRefusal !== null || Object.keys(control.refusals).length > 0,
              },
        ),
      }}
      footer={footerLines(summary)}
      projectControl={projectsAnswer === null ? null : (
        <ProjectControl
          answer={projectsAnswer}
          project={project}
          view={projectView}
          onAll={chooseAll}
          onProject={chooseProject}
          onAdd={async (input) => {
            const result = await addProject(input);
            if (result.ok) { await rereadAfterProjectChange(); chooseProject(result.body.project.projectKey); }
            return result;
          }}
          onRename={async (id, name) => {
            const result = await renameProject(id, name);
            if (result.ok) await rereadAfterProjectChange();
            return result;
          }}
        />
      )}
      banners={
        <>
          {chains !== null && <ChainBanners banners={bannersFor(chains, dismissed)} onDismiss={dismiss} />}
          {chains?.filter((repo) => repo.chain?.state === "running").map((repo) => <div key={repo.repoKey} role="status" data-tone="info" className="chain-banner">
            <a href="#chains">{t("chains.activeBanner", { chainId: repo.chain!.chainId })}</a>{" "}
            <button type="button" onClick={() => { void chainAction(async () => {
              const answer = await requestChainStop(repo.repoKey, repo.chain!.chainId);
              return answer.ok ? { kind: "stop-requested", chainId: repo.chain!.chainId } : { kind: "refused", refusal: answer };
            }); }}>{t("chains.stop")}</button>
          </div>)}
          <UncertainOperations commands={control.uncertainCommandIds}
            onCheck={(command) => { void resolveUncertain(command, true); }}
            onDismiss={(command) => dispatchControl({ type: "command-dismissed", value: command })} />
          <DecisionOperations
            requests={noticeRequests(decisionRequests, selected)}
            projectName={nameOf}
            onDismiss={(requestId) => setDecisionRequests((all) => dismissRequest(all, requestId))}
            onRecordAnother={recordAnother}
          />
        </>
      }
    >
      <SectionPane section="global-settings" active={section}>
        <GlobalSettings
          theme={theme}
          showAdvanced={showAdvanced}
          onAdvanced={(value) => { setShowAdvanced(value); writeShowAdvanced(browserStorage(), value); }}
          language={currentLanguage()}
          onLanguage={(lang) => {
            writeLanguage(browserStorage(), lang);
            void i18n.changeLanguage(lang);
          }}
          onTheme={(pref) => {
            setTheme(pref);
            writeTheme(browserStorage(), pref);
            applyTheme(document.documentElement, pref);
          }}
          refusal={agentPreferences === null ? null : settingsRefusal(`@operator:${agentPreferences.operatorId}`)}
          agents={agents === null || agentPreferences === null ? null : {
            agents, preferences: agentPreferences, drafts: control.drafts,
            onDraft: (key, text) => dispatchControl({ type: "draft", key, text }),
            onSave: (preferences, revision) => { void sendAgentPreferences(preferences, revision); },
            installationState: agentInstallations,
            updateNotice: agentUpdateNotice,
            updateBusy: agentUpdateBusy,
            onDetectUpdates: () => { void detectInstallationUpdates(); },
            onRefreshVersions: () => { void refreshVersions(); },
            onApplyUpdates: (ids) => { void applyInstallationUpdates(ids); },
            onRetryPendingUpdate: () => { void retryPendingInstallationUpdate(); },
            unansweredCommandId: localPendingUpdate?.commandId ?? null,
            models: modelsFor, onRefreshModels: refreshModels,
          }}
        />
      </SectionPane>
      <SectionPane section="project-settings" active={section}>
        <ProjectSettings key={panelRepoId ?? "unresolved"} repoId={panelRepoId} repoLabel={panelRepoId === null ? null : repoLabel(panelRepoId)}
          refusal={panelRepoId === null ? null : settingsRefusal(`@repository:${panelRepoId}`)}
          workspace={panelRepoId === null ? null : workspaces[panelRepoId] ?? null}
          integration={panelRepoId === null ? null : integrations[panelRepoId] ?? null}
          onWorkspaceMode={(mode, revision) => { if (panelRepoId !== null) void sendWorkspaceMode(panelRepoId, mode, revision); }}
          onIntegrationScheme={(scheme, revision) => { if (panelRepoId !== null) void sendRepositoryIntegration(panelRepoId, scheme, revision); }}
        />
      </SectionPane>
      <SectionPane section="overview" active={section}>
        {overviewNavigationFailure && <p role="alert">{overviewNavigationFailure}</p>}
        <Overview model={overviewModel} onOpen={openOverviewTarget}
          onImport={() => openOverviewTarget({ kind: "global-control", region: "import" })}
          onViewDecisions={() => { setStatus("unreviewed"); setFilter(NO_FILTER); setSelected(null); }}
          onRequirement={() => { navigationSeq.current++; setSelectedRequirement(null); setSection("requirements"); window.location.hash = "requirements"; }} />
      </SectionPane>
      <SectionPane section="chains" active={section}>
      {chains === null && <p className="empty">{t("chains.notLoaded")}</p>}
      {chains !== null && (
        <ChainPanel
          repos={chains}
          banners={[]}
          outcome={chainOutcome}
          onDismiss={dismiss}
          onStart={(form) => {
            void chainAction(async () => {
              const r = await requestChainStart(startChainBody(form));
              return r.ok ? { kind: "started", chainId: r.body.chainId } : { kind: "refused", refusal: r };
            });
          }}
          project={project}
          onProject={chooseProject}
          onStop={(repoKey, chainId) => {
            void chainAction(async () => {
              const r = await requestChainStop(repoKey, chainId);
              return r.ok ? { kind: "stop-requested", chainId } : { kind: "refused", refusal: r };
            });
          }}
        />
      )}
      </SectionPane>
      <SectionPane section="tasks" active={section}>
      {(controlConfig === null || control.recovery === null) && (
        <p className="empty">{t("control.unavailable")}</p>
      )}
      {controlConfig !== null && control.recovery !== null && (
        <ControlPanel
          active={section === "tasks"}
          resultsScope={JSON.stringify([account?.user.id, scope])}
          roles={account?.user.roles ?? []}
          config={controlConfig}
          summary={summaryView(control)}
          recovery={control.recovery}
          groups={control.canonical}
          selected={selectedGroup}
          drafts={control.drafts}
          uncertain={control.uncertainCommandIds.filter((command) => !command.parked)}
          refusal={control.panelRefusal}
          groupRefusals={control.refusals}
          importRefusal={control.importRefusal}
          refetchRequired={control.refetchRequired}
          repoId={controlRepoId}
          scope={scope}
          repoLabel={repoLabel}
          targets={targets}
          focusRequest={overviewFocus?.request}
          focus={overviewFocus?.target.kind === "group" ? overviewFocus.target : null}
          onSelect={(id) => { navigationSeq.current++; setOverviewFocus(null); setSelectedGroup(id); }}
          onSelectRequirement={(id) => { navigationSeq.current++; setOverviewFocus(null); setSelectedRequirement(id); setSection("requirements"); window.location.hash = "requirements"; void readRequirement(id); }}
          onSourceRequirement={(id) => { navigationSeq.current++; setOverviewFocus(null); setSelectedRequirement(id); setSection("requirements"); window.location.hash = "requirements"; void readRequirement(id); }}
          onGroupAction={(groupId, verb, repoId) => { void sendGroupCardAction(groupId, verb, repoId); }}
          onOpenDispatch={(groupId) => { const request = ++navigationSeq.current; setSelectedGroup(groupId); setOverviewFocus({ target: { kind: "group", groupId, region: "dispatch", taskId: null, runId: null }, request }); }}
          onDraft={(key, text) => dispatchControl({ type: "draft", key, text })}
          onCommand={(action) => {
            void sendControl(action);
          }}
          onCommands={(actions) => {
            void sendControlSequence(actions);
          }}
          controlState={control}
          onRecoveryRetry={(target) => {
            // Spec §11 R1: built now, from the target's own current summary; nothing is sent when it may not be.
            const action = recoveryRetryAction(controlNow.current, target);
            if (action !== null) void sendControl(action);
          }}
          onRecoveryReread={() => void readControlTick()}
          workspace={panelRepoId === null ? null : workspaces[panelRepoId] ?? null}
          workspaceFor={(repoId) => workspaces[repoId] ?? null}
          integration={panelRepoId === null ? null : integrations[panelRepoId] ?? null}
          integrationFor={(repoId) => integrations[repoId] ?? null}
          decisionsFor={(groupId) => groupDecisions[groupId] ?? null}
          onCorrectDecision={openDecisionById}
          agents={agents}
          preferences={agentPreferences}
          previews={previews}
          onRereadPreview={manualReread}
            retryNotice={retryNotice(agents === null ? agentsRetry : previewRetry)}
          agentsFailure={agentsFailure}
          models={modelsFor} onRefreshModels={refreshModels}
        />
      )}
      </SectionPane>
      <SectionPane section="requirements" active={section}>
        {controlConfig !== null && control.recovery !== null && (
          <RequirementsPanel config={controlConfig} summary={summaryView(control)} views={requirementViews} selected={selectedRequirement} agents={agents}
            onPrepare={(groupId) => { const request = ++navigationSeq.current; setOverviewFocus({ target: { kind: "group", groupId, region: "preparation", taskId: null, runId: null }, request }); setSelectedGroup(groupId); setSection("tasks"); window.location.hash = "tasks"; void readControlGroup(groupId); }}
            onGroupAction={(groupId, verb, repoId) => { void sendGroupCardAction(groupId, verb, repoId); }}
            groupRefusals={control.refusals}
            focus={overviewFocus?.target.kind === "requirement" ? overviewFocus.target : null}
            language={currentLanguage()} refusal={requirementRefusal}
            scope={scope} repoLabel={repoLabel} targets={targets} drafts={detailDrafts} onDraft={onDetailDraft}
            repoId={controlRepoId} onRepo={(repoId) => { const entry = projects?.find((p) => p.controlRepoId === repoId); if (entry) chooseProject(entry.projectKey); }}
            onSelect={(groupId) => { navigationSeq.current++; setOverviewFocus(null); setSelectedRequirement(groupId); void readRequirement(groupId); }}
            onCommand={(action, submitted) => {
              void (async () => {
                const revision = await sendControl(action);
                // Spec §11 R2: a success clears the submitted draft only if it is unchanged since; a failure keeps it.
                if (revision !== null && submitted) setDetailDrafts((all) => clearIfUnchanged(all, submitted.slot, submitted.key, submitted.value as DetailDrafts[DraftSlot][string]));
              })();
            }} />
        )}
      </SectionPane>
      <SectionPane section="decisions" active={section}>
        {/* Toggle buttons, not ARIA tabs: the group view's region tabs are the page's one tablist. */}
        <div role="group" aria-label={t("corrections.tabs")} className="detail-region-tabs">
          {(["decisions", "corrections"] as const).map((tab) => (
            <button key={tab} type="button" aria-pressed={decisionsTab === tab} onClick={() => setDecisionsTab(tab)}>
              {t(tab === "decisions" ? "corrections.tabDecisions" : "corrections.tabCorrections")}
            </button>
          ))}
        </div>
        {decisionsTab === "corrections" ? <CorrectionsView active={section === "decisions"} /> : <>
        {todo.status !== "available" && <p role="status">{t("overview.source.decisions")} · {t(`overview.status.${todo.status}`)}{todo.error ? ` · ${todo.error}` : ""}</p>}
        {projects === null ? (
          // Plan decision P2: without a project list the rows keep today's repository filter.
          <DecisionsView rows={scopedDecisionRows} status={status} onStatus={setStatus} loading={statusLoading} sourceStatus={status === "unreviewed" ? todo.status : undefined} filter={effectiveDecisionFilter} onFilter={setFilter} selected={selected} onOpen={openDecisionRow} detail={detail} reviewedCount={reviewedThisSession} showMinor={showMinor} onShowMinor={setShowMinor} />
        ) : (
          // With one, the pane follows the global scope: rows are restricted here, and its repository select is the sidebar's.
          <DecisionsView
            rows={scopedDecisionRows}
            status={status}
            onStatus={setStatus}
            loading={statusLoading} sourceStatus={status === "unreviewed" ? todo.status : undefined}
            filter={effectiveDecisionFilter}
            onFilter={setFilter}
            selected={selected}
            onOpen={openDecisionRow}
            detail={detail}
            reviewedCount={reviewedThisSession}
            showMinor={showMinor}
            onShowMinor={setShowMinor}
            scope={{
              projects,
              value: scope.kind === "all" ? ALL_PROJECTS : project ?? "",
              allowAll: allowsAll(projects.length),
              onChange: (value) => (value === ALL_PROJECTS ? chooseAll() : chooseProject(value)),
            }}
          />
        )}
        </>}
      </SectionPane>
      <SectionPane section="memory" active={section}>
        <MemoryView active={section === "memory"} project={project} onProject={chooseProject} />
      </SectionPane>
      <SectionPane section="metrics" active={section}>
        {metricsFailure !== null ? <ErrorPage failure={metricsFailure} /> : home === null ? <p>{t("shell.loading")}</p> : <MetricsView report={home.report} coverage={home.coverage} />}
        {/* Accounts spec §7: usage is per control repository, so a project the control plane does not hold offers All only. */}
        <UsagePanel project={controlRepoId ?? null} active={section === "metrics"} />
      </SectionPane>
    </Shell>
    </ProjectNames.Provider>
  );
}
