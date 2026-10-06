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
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
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
  fetchTodo,
  recordCorrection,
  recordReview,
  renameProject,
  requestChainStart,
  requestChainStop,
  startChainBody,
} from "./api.js";
import type { PanelRefusal, PostResult, RecordCorrectionInput } from "./api.js";
import { bannersFor, readDismissed, writeDismissed } from "./chainBanner.js";
import { ChainBanners, ChainPanel } from "./ChainPanel.js";
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
  fetchAgentPreview,
  fetchAgentsView,
  fetchRepositoryWorkspace,
  nextCommandId,
  readUncertainCommands,
  recoverUncertainCommand,
  refusalFromAnswer,
  sendControlCommand,
  workspaceModePath,
  writeUncertainCommands,
} from "./controlApi.js";
import type { ControlAction } from "./controlApi.js";
import { ControlPanel } from "./ControlPanel.js";
import { initialControlState, reduceControlState, summaryView } from "./controlState.js";
import type { ControlRefusal, UncertainCommand } from "./controlState.js";
import type {
  AgentPreferencesViewV1, AgentSelectionPreviewV1, AgentsViewV1, CommandSuccessV1, ControlConfigV1, ControlSummaryV1, OperatorPreferencesV1, RepositoryWorkspaceV1, RequirementViewV1,
} from "./controlTypes.js";
import { DecisionDetail } from "./DecisionDetail.js";
import type { Decision } from "./DecisionDetail.js";
import { ErrorPage } from "./ErrorPage.js";
import i18n, { currentLanguage, writeLanguage } from "./i18n.js";
import { DecisionsView, NO_FILTER } from "./DecisionsView.js";
import type { DecisionFilter } from "./DecisionsView.js";
import { MemoryView } from "./MemoryView.js";
import { pickProject, projectName, readProject, writeProject } from "./project.js";
import type { ProjectsAnswerV1 } from "./project.js";
import { ProjectControl } from "./ProjectControl.js";
import { allowsAll, groupScope, readProjectView, writeProjectView } from "./projectScope.js";
import type { ProjectView } from "./projectScope.js";
import { ProjectNames } from "./projectNames.js";
import { MetricsView } from "./MetricsView.js";
import { Refusal } from "./Refusal.js";
import { RequirementsPanel } from "./RequirementsPanel.js";
import { labelsDraftKey } from "./TaskDetail.js";
import { loopDraftKey } from "./LoopPlanCard.js";
import { DEFAULT_SECTION, sectionFromHash } from "./sections.js";
import type { Section } from "./sections.js";
import { SectionPane, Shell, controlAlert } from "./Shell.js";
import { applyTheme, readTheme, writeTheme } from "./theme.js";
import type { ThemePref } from "./theme.js";
import { acceptArrival } from "./selection.js";
import type { ChainRepoView, DecisionListRow, MetricsReport, PanelCoverage } from "./types.js";

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
  todo: DecisionListRow[];
  report: MetricsReport;
  coverage: PanelCoverage;
}

type RecordedKey = "decisions.recordedReviewed" | "decisions.correctionRecorded";
type Outcome = { kind: "recorded"; text: RecordedKey } | { kind: "refused"; refusal: PanelRefusal };

export function App(): JSX.Element {
  const { t } = useTranslation();
  const [home, setHome] = useState<HomeState | null>(null);
  const [error, setError] = useState<PanelRefusal | null>(null);
  const [selected, setSelected] = useState<DecisionListRow | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [lastCorrection, setLastCorrection] = useState<RecordCorrectionInput | null>(null);
  /** The row whose answer may still be applied; read by `acceptArrival` when one arrives. */
  const wanted = useRef<DecisionListRow | null>(null);

  const [chains, setChains] = useState<ChainRepoView[] | null>(null);
  const [chainOutcome, setChainOutcome] = useState<ChainOutcome | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissed(browserStorage()));
  // Panel UI redesign spec §5.1: the active section lives in the URL hash; the theme choice in this browser only.
  const [section, setSection] = useState<Section>(() =>
    typeof window === "undefined" ? DEFAULT_SECTION : sectionFromHash(window.location.hash),
  );
  const [filter, setFilter] = useState<DecisionFilter>(NO_FILTER);
  const [theme, setTheme] = useState<ThemePref>(() => readTheme(browserStorage()));
  useEffect(() => {
    const onHash = (): void => setSection(sectionFromHash(window.location.hash));
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
  /** Execution driver spec §3.2: the chosen project's (else the first trusted repository's) workspace mode, null until read. */
  const [workspace, setWorkspace] = useState<RepositoryWorkspaceV1 | null>(null);
  /** Agent selection spec §6.8: the installation table and this operator's defaults; null until read, or when the port refuses. */
  const [agents, setAgents] = useState<AgentsViewV1 | null>(null);
  const [agentPreferences, setAgentPreferences] = useState<AgentPreferencesViewV1 | null>(null);
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
  /** The last refusal of a command sent from Requirements, shown there (Task control keeps showing every refusal). */
  const [requirementRefusal, setRequirementRefusal] = useState<ControlRefusal | null>(null);
  /** The open requirement, for the poll tick, which outlives the render it was built in. */
  const requirementNow = useRef<string | null>(null);
  requirementNow.current = selectedRequirement;
  /** The reducer's latest value, for callbacks that outlive the render they were built in. */
  const controlNow = useRef(control);
  controlNow.current = control;
  /** Command ids whose lookup is already in flight, so one tick does not ask twice. */
  const resolving = useRef<Set<string>>(new Set());

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
      dispatchControl({ type: "refusal", groupId: null, value: controlFailureFrom(err) });
    }
    for (const command of controlNow.current.uncertainCommandIds) void resolveUncertain(command);
  };

  const readControlGroup = async (groupId: string): Promise<void> => {
    try {
      dispatchControl({ type: "group", value: await fetchControlGroup(groupId) });
    } catch (err) {
      dispatchControl({ type: "refusal", groupId, value: controlFailureFrom(err) });
    }
  };

  const readRequirement = async (groupId: string): Promise<void> => {
    try {
      const value = await fetchRequirement(groupId);
      setRequirementViews((all) => ({ ...all, [groupId]: value }));
    } catch (err) {
      dispatchControl({ type: "refusal", groupId, value: controlFailureFrom(err) });
    }
  };

  /**
   * A command the browser lost the answer to is looked up, never re-issued: the
   * ledger dedupes on the whole raw envelope, so a fresh id would be a second
   * intent -- possibly a second execution -- rather than a retry of this one.
   */
  const resolveUncertain = async (command: UncertainCommand): Promise<void> => {
    const id = `${command.groupId}\0${command.commandId}`;
    if (resolving.current.has(id)) return;
    resolving.current.add(id);
    const result = await recoverUncertainCommand(command.groupId, command.commandId);
    resolving.current.delete(id);
    if (result.kind === "unresolved") {
      // The lookup told us nothing, so the command is still unresolved: keep the id
      // for the next tick and show why this round could not conclude.
      dispatchControl({ type: "refusal", groupId: command.groupId, value: result.refusal });
      return;
    }
    dispatchControl({ type: "command-resolved", value: command });
    if (result.kind === "absent") dispatchControl({ type: "refusal", groupId: command.groupId, value: result.refusal });
    await readControlGroup(command.groupId);
  };

  /**
   * Send one intent. Whatever the ledger says afterwards is read, not inferred here. Answers the commandRevision a
   * success carries, or null when the command did not succeed (refused, or its outcome unknown).
   */
  const sendControl = async (action: ControlAction): Promise<number | null> => {
    // N1 spec §11.2: a requirement's details come from its own view; a clarifying group has no group view (DR25).
    const requirementVerb = action.verb.startsWith("requirement-") || ((action.verb === "recovery-retry" || action.verb === "handoff-stop" || action.verb === "set-limit")
      && controlNow.current.groups[action.groupId]?.state === "clarifying");
    const commandId = nextCommandId();
    const command = { groupId: action.groupId, commandId };
    dispatchControl({ type: "command-uncertain", value: command });
    // Spec §5: an answer that arrives after the scope changed may fill the cache, but must not reopen a detail.
    const scopeAtSend = scopeKeyNow.current;
    const answer = await sendControlCommand(controlCommandPath(action), commandEnvelope(commandId, action));
    if (answer.kind === "uncertain") {
      // The id stays where it is: sessionStorage keeps it across a reload, and the
      // next tick looks it up. The page shows that the outcome is unknown.
      dispatchControl({ type: "refusal", groupId: action.groupId, value: answer.refusal });
      if (requirementVerb) setRequirementRefusal(answer.refusal);
      return null;
    }
    dispatchControl({ type: "command-resolved", value: command });
    // Labels and progress spec §4.2 (plan finding F11): a label draft is the person's own data -- cleared only once this
    // command succeeded; a refusal (and an uncertain answer, above) leaves it for them.
    if (answer.status < 400 && action.verb === "set-task-labels") dispatchControl({ type: "draft", key: labelsDraftKey(action.groupId, action.taskId), text: "" });
    // Loop plans spec §4.2: a loop draft is the person's own data, cleared only once set-task-loop succeeded. W7 ruling: an
    // estimate's suggestion (the only set-task-loop that carries workProvenance, BudgetEditor.tsx suggestedLoopActions)
    // leaves an open draft alone; the card then says the plan changed after the draft began.
    if (answer.status < 400 && action.verb === "set-task-loop" && action.payload.workProvenance === undefined) dispatchControl({ type: "draft", key: loopDraftKey(action.groupId, action.taskId), text: "" });
    if (answer.status >= 400) {
      const refusal = refusalFromAnswer(answer);
      dispatchControl({ type: "refusal", groupId: action.groupId, value: refusal });
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
    if (!requirementVerb || (action.verb === "requirement-draft-accept" && answer.status < 400)) await readControlGroup(action.groupId);
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

  /**
   * Read the installation table and this operator's defaults. Wave 4 review I-1, ruling review R17: a read that
   * failed is retried on AGENT_RETRY_DELAYS_MS while the page is visible (when `retry`), then by the operator.
   */
  const loadAgents = async (retry: boolean): Promise<void> => {
    try {
      const table = await fetchAgentsView();
      const preferences = await fetchAgentPreferences();
      setAgents(table);
      setAgentPreferences(preferences);
      agentsRetries.current = 0;
      setAgentsRetry(null);
    } catch (err) {
      const refusal = controlFailureFrom(err);
      dispatchControl({ type: "refusal", groupId: null, value: refusal });
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

  /** Name the choice under the revision it was read at; whatever the server says is read back, not assumed. */
  const sendWorkspaceMode = async (mode: "worktree" | "clone", expectedRevision: number): Promise<void> => {
    if (workspace === null) return;
    const scope = `@repository:${workspace.repoId}`;
    const answer = await sendControlCommand(workspaceModePath(workspace.repoId), { commandId: nextCommandId(), expectedRevision, payload: { workspaceMode: mode } });
    if (answer.kind === "uncertain") dispatchControl({ type: "refusal", groupId: scope, value: answer.refusal });
    else if (answer.status >= 400) dispatchControl({ type: "refusal", groupId: scope, value: refusalFromAnswer(answer) });
    try { setWorkspace(await fetchRepositoryWorkspace(workspace.repoId)); } catch { /* the refusal above already says why */ }
  };

  /** Name the operator's new defaults under the revision they were read at; whatever the server says is read back. */
  const sendAgentPreferences = async (preferences: OperatorPreferencesV1, expectedRevision: number): Promise<void> => {
    if (agentPreferences === null) return;
    const scope = `@operator:${agentPreferences.operatorId}`;
    // Review P5: the payload is { preferences } only; the revision travels in the envelope.
    const answer = await sendControlCommand(AGENT_PREFERENCES_PATH, { commandId: nextCommandId(), expectedRevision, payload: { preferences } });
    if (answer.kind === "uncertain") dispatchControl({ type: "refusal", groupId: scope, value: answer.refusal });
    else if (answer.status >= 400) dispatchControl({ type: "refusal", groupId: scope, value: refusalFromAnswer(answer) });
    try { setAgentPreferences(await fetchAgentPreferences()); } catch { /* the refusal above already says why */ }
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
  const workspaceRepoId = controlRepoId === undefined ? controlConfig?.repositories[0]?.repoId : controlRepoId;
  useEffect(() => {
    if (controlConfig === null) return;
    if (workspaceRepoId === undefined || workspaceRepoId === null) { setWorkspace(null); return; }
    void fetchRepositoryWorkspace(workspaceRepoId).then(setWorkspace, () => setWorkspace(null));
  }, [controlConfig, workspaceRepoId]);

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
        dispatchControl({ type: "refusal", groupId, value: controlFailureFrom(err) });
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
    try {
      const [todoBody, metrics] = await Promise.all([fetchTodo(), fetchMetrics()]);
      setHome({ todo: todoBody.rows, report: metrics.report, coverage: metrics.panel_review_coverage });
    } catch (err) {
      setError(failureFrom(err));
    }
  };

  useEffect(() => {
    void loadHome();
  }, []);

  /**
   * Parked finding N-1 / ruling R71. Opening another row takes the previous
   * decision off the screen FIRST, so the buttons and the text under them can
   * never mean two different decisions; and an answer is only applied when it
   * is still the one being waited for, so a slow answer that arrives after the
   * person moved on is dropped instead of repainting the page behind them.
   */
  useEffect(() => {
    setOutcome(null);
    setLastCorrection(null);
    setDecision(null);
    wanted.current = selected;
    if (selected === null) return;
    void (async () => {
      try {
        const body = await fetchDecision(selected.projectKey, selected.id);
        if (!acceptArrival(wanted.current, selected)) return;
        setDecision(body.decision as Decision);
      } catch (err) {
        if (!acceptArrival(wanted.current, selected)) return;
        setError(failureFrom(err));
      }
    })();
  }, [selected]);

  /** Shows what happened; after a success, refetches so the to-do list and coverage reflect it. */
  const send = async (post: () => Promise<PostResult<unknown>>, recorded: RecordedKey): Promise<void> => {
    try {
      const result = await post();
      if (!result.ok) {
        setOutcome({ kind: "refused", refusal: result });
        return;
      }
      setOutcome({ kind: "recorded", text: recorded });
      await loadHome();
    } catch (err) {
      setOutcome({ kind: "refused", refusal: failureFrom(err) });
    }
  };

  if (error !== null) return <ErrorPage failure={error} />;
  if (home === null) return <main>{t("shell.loading")}</main>;

  const dismiss = (chainId: string): void => {
    const next = new Set(dismissed);
    next.add(chainId);
    setDismissed(next);
    writeDismissed(browserStorage(), next);
  };
  const summary = controlConfig !== null && control.recovery !== null ? summaryView(control) : null;
  const detail =
    selected !== null && decision !== null ? (
      <>
      <DecisionDetail
        decision={decision}
        onAgree={() => {
          void send(() => recordReview(selected.projectKey, selected.id), "decisions.recordedReviewed");
        }}
        onCorrect={(form) => {
          const body = correctionBody({ projectKey: selected.projectKey, decisionId: selected.id }, form);
          setLastCorrection(body);
          void send(() => recordCorrection(body), "decisions.correctionRecorded");
        }}
      />
      {outcome?.kind === "recorded" && <p role="status">{t(outcome.text)}</p>}
      {outcome?.kind === "refused" && (
        <Refusal
          refusal={outcome.refusal}
          onRecordAnother={() => {
            if (lastCorrection === null) return;
            void send(() => recordCorrection({ ...lastCorrection, again: true }), "decisions.correctionRecorded");
          }}
        />
      )}
      </>
    ) : null;

  return (
    <ProjectNames.Provider value={nameOf}>
    <Shell
      active={section}
      badges={{
        unreviewed: home.todo.length,
        chainRunning: chains?.some((r) => r.chain?.state === "running") ?? false,
        controlAlert: controlAlert(
          summary === null || controlConfig === null || control.recovery === null
            ? null
            : {
                executionPort: controlConfig.executionPort,
                resetRequired: summary.resetRequired,
                refetchRequired: control.refetchRequired,
                dispatchBlocked: summary.dispatchBlocked || control.recovery.dispatchBlocked,
                blockers: control.recovery.blockers.length,
                refusal: control.refusal !== null,
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
      theme={theme}
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
      banners={chains !== null ? <ChainBanners banners={bannersFor(chains, dismissed)} onDismiss={dismiss} /> : null}
    >
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
          config={controlConfig}
          summary={summaryView(control)}
          recovery={control.recovery}
          groups={control.canonical}
          selected={selectedGroup}
          drafts={control.drafts}
          uncertain={control.uncertainCommandIds}
          refusal={control.refusal}
          refetchRequired={control.refetchRequired}
          repoId={controlRepoId}
          scope={scope}
          repoLabel={repoLabel}
          targets={targets}
          onSelect={setSelectedGroup}
          onDraft={(key, text) => dispatchControl({ type: "draft", key, text })}
          onCommand={(action) => {
            void sendControl(action);
          }}
          onCommands={(actions) => {
            void sendControlSequence(actions);
          }}
          workspace={workspace}
          onWorkspaceMode={(mode, revision) => { void sendWorkspaceMode(mode, revision); }}
          agents={agents}
          preferences={agentPreferences}
          previews={previews}
          onAgentPreferences={(preferences, revision) => { void sendAgentPreferences(preferences, revision); }}
          onRereadPreview={manualReread}
            retryNotice={retryNotice(agents === null ? agentsRetry : previewRetry)}
          agentsFailure={agentsFailure}
        />
      )}
      </SectionPane>
      <SectionPane section="requirements" active={section}>
        {controlConfig !== null && control.recovery !== null && (
          <RequirementsPanel config={controlConfig} summary={summaryView(control)} views={requirementViews} selected={selectedRequirement} agents={agents}
            language={currentLanguage()} refusal={requirementRefusal}
            scope={scope} repoLabel={repoLabel} targets={targets}
            repoId={controlRepoId} onRepo={(repoId) => { const entry = projects?.find((p) => p.controlRepoId === repoId); if (entry) chooseProject(entry.projectKey); }}
            onSelect={(groupId) => { setSelectedRequirement(groupId); void readRequirement(groupId); }} onCommand={(action) => { void sendControl(action); }} />
        )}
      </SectionPane>
      <SectionPane section="decisions" active={section}>
        <DecisionsView rows={home.todo} filter={filter} onFilter={setFilter} selected={selected} onOpen={setSelected} detail={detail} />
      </SectionPane>
      <SectionPane section="memory" active={section}>
        <MemoryView active={section === "memory"} project={project} onProject={chooseProject} />
      </SectionPane>
      <SectionPane section="metrics" active={section}>
        <MetricsView report={home.report} coverage={home.coverage} />
      </SectionPane>
    </Shell>
    </ProjectNames.Provider>
  );
}
