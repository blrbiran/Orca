import type {SavedResultEligibilityV1} from "./controlTypes.js";
/**
 * Task 9: the browser's only door to the control plane.
 *
 * Nothing in this module decides anything. A read returns the server's DTO; a
 * write returns either the server's own answer (2xx or a durable 4xx, both of
 * which have a ledger row) or `uncertain`, which is what a lost response, a
 * never-answered fetch and every 5xx collapse to: the command may or may not
 * have committed, so the caller keeps the id and looks it up (spec §9.3). A
 * caller that guessed "it failed" and re-issued with a new id would be creating
 * a second execution the ledger never asked for.
 */
import { csrfHeader, failureFrom, noteAnswer } from "./api.js";
import i18n from "./i18n.js";
import type {
  AgentPreferencesViewV1,
  AgentInstallationStateV1,
  AgentInstallationPreviewV1,
  AgentSelectionPreviewV1,
  AgentModelsViewV1,
  AgentsViewV1,
  CommandEnvelopeV1,
  CommandErrorV1,
  CommandLookupV1,
  CommandSuccessV1,
  ConfirmPayloadV1,
  ContinueTaskPayloadV1,
  ControlConfigV1,
  ControlSummaryV1,
  EstimatePayloadV1,
  EvidenceManifestV1,
  GroupDecisionsViewV1,
  GroupViewV1,
  HandoffStopPayloadV1,
  ImportPlanPayloadV1,
  IntegrationSchemeV1,
  ProposalEditPayloadV1,
  ProposalSetAgentPayloadV1,
  RecoveryRetryPayloadV1,
  RetryTaskPayloadV1,
  SettleUnknownUsagePayloadV1,
  RecoveryViewV1,
  RepositoryIntegrationV1,
  RepositoryWorkspaceV1,
  RequirementAnswerPayloadV1,
  RequirementConsensusPayloadV1,
  RequirementDraftAcceptPayloadV1,
  RequirementDraftFeedbackPayloadV1,
  RequirementOpenPayloadV1,
  RequirementViewV1,
  ResumeFromHandoffPayloadV1,
  RunActivityV1,
  SetGroupIntegrationPayloadV1,
  SetLimitPayloadV1,
  SetTaskLabelsPayloadV1,
  SetTaskLoopPayloadV1,
  UsageViewV1,
} from "./controlTypes.js";
import type { ControlRefusal, UncertainCommand } from "./controlState.js";

export const UNCERTAIN_COMMANDS_KEY = "orca.control.uncertain";

const segment = (value: string): string => encodeURIComponent(value);

function refusalOf(what: string, status: number | null, body: unknown, fallbackMessage: string): ControlRefusal {
  const fields = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const error = typeof fields.error === "object" && fields.error !== null ? (fields.error as Partial<CommandErrorV1>) : undefined;
  return {
    status,
    code: typeof error?.code === "string" ? error.code : typeof fields.code === "string" ? fields.code : `http-${status ?? "unreachable"}`,
    message: typeof error?.message === "string" ? error.message : typeof fields.message === "string" ? fields.message : `${what}: ${fallbackMessage}`,
    commandRevision: typeof error?.commandRevision === "number" ? error.commandRevision : null,
  };
}

export class ControlRequestError extends Error {
  constructor(readonly refusal: ControlRefusal) {
    super(`${refusal.code}: ${refusal.message}`);
    this.name = "ControlRequestError";
  }
}

/** What the page shows for anything a control request threw. */
export function controlFailureFrom(err: unknown): ControlRefusal {
  if (err instanceof ControlRequestError) return err.refusal;
  const refusal = failureFrom(err);
  return { status: refusal.status, code: refusal.code, message: refusal.message, commandRevision: null };
}

export async function controlGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, signal === undefined ? undefined : { signal });
  } catch (err) {
    throw new ControlRequestError(refusalOf(`GET ${path}`, null, undefined, err instanceof Error ? err.message : i18n.t("panelErrors.noAnswer")));
  }
  const body: unknown = await res.json().catch(() => undefined);
  noteAnswer(res.status, body);
  if (!res.ok) throw new ControlRequestError(refusalOf(`GET ${path}`, res.status, body, i18n.t("panelErrors.answered", { status: res.status })));
  return body as T;
}

/** GET /api/control/config -- src/panel/controlApi.ts. */
export const fetchControlConfig = (): Promise<ControlConfigV1> => controlGet<ControlConfigV1>("/api/control/config");
/** GET /api/control/summary -- with `sinceChangeSeq` the answer lists only the groups that moved. */
export function fetchControlSummary(sinceChangeSeq?: number): Promise<ControlSummaryV1> {
  const query = sinceChangeSeq === undefined ? "" : `?sinceChangeSeq=${sinceChangeSeq}`;
  return controlGet<ControlSummaryV1>(`/api/control/summary${query}`);
}
/** GET /api/control/groups/:groupId -- the canonical view of one group. */
export const fetchControlGroup = (groupId: string): Promise<GroupViewV1> =>
  controlGet<GroupViewV1>(`/api/control/groups/${segment(groupId)}`);
/** GET /api/control/groups/:groupId/requirement -- one requirement in full (N1 spec §11.2). */
export const fetchRequirement = (groupId: string): Promise<RequirementViewV1> =>
  controlGet<RequirementViewV1>(`/api/control/groups/${segment(groupId)}/requirement`);
/** GET /api/control/groups/:groupId/decisions -- control run decisions plan Task 8: the group's decisions, read from refs. */
export const fetchGroupDecisions = (groupId: string): Promise<GroupDecisionsViewV1> =>
  controlGet<GroupDecisionsViewV1>(`/api/control/groups/${segment(groupId)}/decisions`);
/** GET /api/control/recovery -- every blocker the panel can see, across groups. */
export const fetchControlRecovery = (): Promise<RecoveryViewV1> => controlGet<RecoveryViewV1>("/api/control/recovery");
/** GET /api/control/runs/:runId/evidence -- the manifest of raw evidence retained for one run. */
export const fetchRunEvidence = (runId: string): Promise<EvidenceManifestV1> =>
  controlGet<EvidenceManifestV1>(`/api/control/runs/${segment(runId)}/evidence`);

export const fetchSavedResultEligibility=(runId:string):Promise<SavedResultEligibilityV1>=>controlGet(`/api/control/runs/${segment(runId)}/saved-result-eligibility`);

/** GET /api/control/runs/:runId/activity -- issue-fixes spec §5.2: the run's newest 200 activity rows. */
const activityKinds = new Set(["usage-settled", "command", "run-claimed", "run-started", "phase", "run-blocked", "run-resumed", "run-settled", "task-retried", "integration", "stop", "stop-cleared", "archived", "unarchived", "correction-closed"]);
function activityResponse(runId: string, value: unknown): RunActivityV1 {
  const invalid = (): never => { throw new ControlRequestError({ status: 200, code: "activity-response-invalid", message: i18n.t("control.activity.responseInvalid"), commandRevision: null }); };
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalid();
  const answer = value as Record<string, unknown>;
  if (answer.schema !== "orca-run-activity-v1" || answer.runId !== runId || !Array.isArray(answer.entries) || answer.entries.length > 200 || Object.keys(answer).some(key => !["schema", "runId", "entries"].includes(key))) return invalid();
  let previous = Number.POSITIVE_INFINITY;
  for (const item of answer.entries) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return invalid();
    const entry = item as Record<string, unknown>;
    if (!Number.isSafeInteger(entry.seq) || (entry.seq as number) <= 0 || (entry.seq as number) >= previous
      || Object.keys(entry).some(key => !["seq", "groupId", "taskId", "runId", "at", "kind", "body"].includes(key))
      || typeof entry.groupId !== "string" || !entry.groupId || entry.runId !== runId
      || !(entry.taskId === null || typeof entry.taskId === "string")
      || !Number.isSafeInteger(entry.at) || (entry.at as number) < 0
      || !activityKinds.has(String(entry.kind))
      || typeof entry.body !== "object" || entry.body === null || Array.isArray(entry.body)) return invalid();
    previous = entry.seq as number;
  }
  return answer as RunActivityV1;
}
export const fetchRunActivity = async (runId: string): Promise<RunActivityV1> =>
  activityResponse(runId, await controlGet<unknown>(`/api/control/runs/${segment(runId)}/activity`));

/** Accounts spec §5.3: GET /api/control/usage with the query the Usage panel's pickers name (web/src/UsagePanel.tsx). */
export const fetchUsageView = (query: string): Promise<UsageViewV1> => controlGet<UsageViewV1>(`/api/control/usage?${query}`);

/** Agent selection spec §6.8: the installation table, as ccloop answered it through the panel. */
export const fetchAgentsView = (): Promise<AgentsViewV1> => controlGet<AgentsViewV1>("/api/control/agents");
/** Spec 2026-10-15 §5 (R3, R4): one installation's models, from ccloop's cache unless `refresh` (owner only) asks it to probe. */
/**
 * The panel bounds its own ccloop call at 60 s (src/panel/controlAssembly.ts PORT_TIMEOUT_MS); a read with no answer
 * past that would keep the page's in-flight mark set and skip every background re-read until an owner's Refresh
 * (session 4de777f4 deferred minor). Past this bound the read fails and the list shows as unavailable.
 */
export const MODEL_READ_TIMEOUT_MS = 75_000;
/** A read is a GET of ccloop's cached list; a refresh re-probes the agent's CLI, so it is a POST carrying the CSRF header. */
export async function fetchAgentModels(installation: string, refresh = false): Promise<AgentModelsViewV1> {
  const path = `/api/control/agents/${segment(installation)}/models`;
  if (!refresh) return controlGet<AgentModelsViewV1>(path, AbortSignal.timeout(MODEL_READ_TIMEOUT_MS));
  return controlProbe<AgentModelsViewV1>(`${path}/refresh`, AbortSignal.timeout(MODEL_READ_TIMEOUT_MS));
}
export const AGENT_PREFERENCES_PATH = "/api/control/operator/agent-preferences";
/** This panel operator's defaults and the revision they are at. */
export const fetchAgentPreferences = (): Promise<AgentPreferencesViewV1> => controlGet<AgentPreferencesViewV1>(AGENT_PREFERENCES_PATH);
export const AGENT_UPDATE_PATH = "/api/control/operator/apply-agent-update";
const PENDING_AGENT_UPDATE_KEY = "orca.agent-update.pending";
export type PendingAgentUpdateEnvelope = { commandId: string; expectedRevision: number; payload: { previewId: string; baseTableHash: string; acceptedChangeIds: string[] } };
export function readPendingAgentUpdate(storage: Storage | null | undefined): PendingAgentUpdateEnvelope | null {
  try {
    const raw = storage?.getItem(PENDING_AGENT_UPDATE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const row = value as Partial<PendingAgentUpdateEnvelope>;
    if (typeof row.commandId !== "string" || !Number.isSafeInteger(row.expectedRevision) || row.expectedRevision! < 0
      || typeof row.payload?.previewId !== "string" || !/^[a-f0-9]{64}$/.test(row.payload.baseTableHash)
      || !Array.isArray(row.payload.acceptedChangeIds) || !row.payload.acceptedChangeIds.every((id) => typeof id === "string")) return null;
    return row as PendingAgentUpdateEnvelope;
  } catch { return null; }
}
export function writePendingAgentUpdate(storage: Storage | null | undefined, value: PendingAgentUpdateEnvelope | null): void {
  try { if (value === null) storage?.removeItem(PENDING_AGENT_UPDATE_KEY); else storage?.setItem(PENDING_AGENT_UPDATE_KEY, JSON.stringify(value)); }
  catch { /* Browsers without session storage still retain the in-memory command for this page. */ }
}
export const fetchAgentInstallationState = (): Promise<AgentInstallationStateV1> => controlGet<AgentInstallationStateV1>("/api/control/operator/agent-installations");
/** A probe sent as a POST with an empty body (it changes no ledger, but it spawns an agent CLI, so it carries the CSRF header). */
async function controlProbe<T>(path: string, signal?: AbortSignal): Promise<T> {
  // A network failure or the read's time bound throws as fetch threw it; controlFailureFrom names it for the page.
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json", ...csrfHeader() }, body: "{}", ...(signal === undefined ? {} : { signal }) });
  const body: unknown = await res.json().catch(() => undefined);
  noteAnswer(res.status, body);
  if (!res.ok) throw new ControlRequestError(refusalOf(`POST ${path}`, res.status, body, i18n.t("panelErrors.answered", { status: res.status })));
  return body as T;
}
export const detectAgentInstallations = (): Promise<AgentInstallationPreviewV1> => controlProbe<AgentInstallationPreviewV1>("/api/control/operator/agent-update-preview");
export const fetchAgentInstallationPreview = (): Promise<AgentInstallationStateV1> => controlGet<AgentInstallationStateV1>("/api/control/operator/agent-update-preview");
/** The confirm's own resolution of a group's agent slots, for the proposal version the server holds now. */
export const fetchAgentPreview = (groupId: string): Promise<AgentSelectionPreviewV1> =>
  controlGet<AgentSelectionPreviewV1>(`/api/control/groups/${segment(groupId)}/agent-preview`);

/** Execution driver spec §3.2: a trusted repository's workspace mode and the revision it is at. */
export const fetchRepositoryWorkspace = (repoId: string): Promise<RepositoryWorkspaceV1> =>
  controlGet<RepositoryWorkspaceV1>(`/api/control/repositories/${segment(repoId)}/workspace`);

export const workspaceModePath = (repoId: string): string => `/api/control/repositories/${segment(repoId)}/workspace-mode`;

/** Integration spec §3.4: a trusted repository's integration default and the settings revision it is at. */
export const fetchRepositoryIntegration = (repoId: string): Promise<RepositoryIntegrationV1> =>
  controlGet<RepositoryIntegrationV1>(`/api/control/repositories/${segment(repoId)}/integration`);

export const integrationSchemePath = (repoId: string): string => `/api/control/repositories/${segment(repoId)}/integration`;

/** Integration spec §3.1: set-integration-scheme, naming the whole scheme under the settings revision it was read at. */
export const sendIntegrationScheme = (repoId: string, integration: IntegrationSchemeV1, expectedRevision: number, commandId: string = nextCommandId()): Promise<ControlAnswer> =>
  sendControlCommand(integrationSchemePath(repoId), { commandId, expectedRevision, payload: { integration } });

/**
 * Offer a manifest the caller already read as a download. The read has to come
 * first: the manifest is built in the page from the read's answer, so a refusal
 * is named in the page rather than shown as a bare error document.
 */
export function saveEvidenceManifest(manifest: EvidenceManifestV1): void {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(manifest, null, 2)}\n`], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `evidence-${manifest.runId}.json`;
  anchor.click();
  // Revoked on the next tick, once the browser has taken the URL.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Labels and progress spec §4.2: one piece of a run's evidence, fetched with the session cookie (like the manifest, so
 * a refusal is named in the page) and offered as a download named after its evidence id.
 */
export async function downloadEvidenceArtifact(entry: EvidenceManifestV1["entries"][number]): Promise<void> {
  let res: Response;
  try {
    res = await fetch(entry.downloadUrl);
  } catch (err) {
    throw new ControlRequestError(refusalOf(`GET ${entry.downloadUrl}`, null, undefined, err instanceof Error ? err.message : i18n.t("panelErrors.noAnswer")));
  }
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => undefined);
    noteAnswer(res.status, body);
    throw new ControlRequestError(refusalOf(`GET ${entry.downloadUrl}`, res.status, body, i18n.t("panelErrors.answered", { status: res.status })));
  }
  const url = URL.createObjectURL(await res.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = entry.evidenceId;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export type ControlAnswer = { kind: "answered"; status: number; body: CommandSuccessV1 | { error: CommandErrorV1 } } | { kind: "uncertain"; refusal: ControlRefusal };

/**
 * POST one command envelope. A durable answer -- success or refusal -- comes
 * back as `answered`; anything that leaves the outcome unknown comes back
 * `uncertain` rather than as a swallowed error.
 */
export async function sendControlCommand(path: string, envelope: CommandEnvelopeV1): Promise<ControlAnswer> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...csrfHeader() },
      body: JSON.stringify(envelope),
    });
  } catch (err) {
    return { kind: "uncertain", refusal: refusalOf(`POST ${path}`, null, undefined, err instanceof Error ? err.message : i18n.t("panelErrors.neverAnswered")) };
  }
  const body: unknown = await res.json().catch(() => undefined);
  noteAnswer(res.status, body);
  if (res.status >= 500) return { kind: "uncertain", refusal: refusalOf(`POST ${path}`, res.status, body, i18n.t("panelErrors.mayNotHaveCommitted")) };
  return { kind: "answered", status: res.status, body: body as CommandSuccessV1 | { error: CommandErrorV1 } };
}

/** The refusal a durable 4xx answer carries, in the shape the page shows. */
export function refusalFromAnswer(answer: Extract<ControlAnswer, { kind: "answered" }>): ControlRefusal {
  const error = (answer.body as { error?: CommandErrorV1 }).error;
  return {
    status: answer.status,
    code: error?.code ?? "command-result-invalid",
    message: error?.message ?? i18n.t("panelErrors.noOutcome"),
    commandRevision: error?.commandRevision ?? null,
  };
}

export type CommandRecovery =
  | { kind: "found"; lookup: CommandLookupV1 }
  | { kind: "absent"; refusal: ControlRefusal }
  | { kind: "missing-group"; refusal: ControlRefusal }
  | { kind: "unresolved"; refusal: ControlRefusal };

/**
 * GET the retained result of a command the browser lost the answer to. `absent`
 * is spec §4.1's `404 command-result-not-found` and nothing else: the ledger
 * holds no such command, so the person may issue the intent again under a new
 * id. Every other refusal -- an unreachable panel, a 5xx, a missing session -- is
 * `unresolved`, because dropping the id there would turn a re-issue into a
 * second execution rather than a retry of this one.
 */
export async function recoverUncertainCommand(groupId: string, commandId: string): Promise<CommandRecovery> {
  const path = `/api/control/groups/${segment(groupId)}/commands/${segment(commandId)}`;
  try {
    return { kind: "found", lookup: await controlGet<CommandLookupV1>(path) };
  } catch (err) {
    const refusal = controlFailureFrom(err);
    if (refusal.code === "command-result-not-found") return { kind: "absent", refusal };
    if (!groupId.startsWith("@") && refusal.status === 404 && refusal.code === "group-not-found") return { kind: "missing-group", refusal };
    return { kind: "unresolved", refusal };
  }
}

/** A command the UI can offer, already carrying the revision the server was last seen at. */
export type ControlAction =
  | { verb: "import-plan"; groupId: string; expectedRevision: number; payload: ImportPlanPayloadV1 }
  | { verb: "proposal-edit"; groupId: string; expectedRevision: number; payload: ProposalEditPayloadV1 }
  | { verb: "proposal-set-agent"; groupId: string; expectedRevision: number; payload: ProposalSetAgentPayloadV1 }
  | { verb: "estimate"; groupId: string; expectedRevision: number; payload: EstimatePayloadV1 }
  | { verb: "confirm"; groupId: string; expectedRevision: number; payload: ConfirmPayloadV1 }
  | { verb: "set-limit"; groupId: string; expectedRevision: number; payload: SetLimitPayloadV1 }
  | { verb: "start" | "pause-dispatch" | "resume-dispatch"; groupId: string; expectedRevision: number; payload: Record<string, never> }
  | { verb: "handoff-stop"; groupId: string; expectedRevision: number; payload: HandoffStopPayloadV1 }
  | { verb: "resume-from-handoff"; groupId: string; expectedRevision: number; payload: ResumeFromHandoffPayloadV1 }
  | { verb: "continue-task"; groupId: string; taskId: string; expectedRevision: number; payload: ContinueTaskPayloadV1 }
  | { verb: "recovery-retry"; groupId: string; expectedRevision: number; payload: RecoveryRetryPayloadV1 }
  // Issue fixes spec §4.2(2): retry a task whose run ccloop ended failed, as a new run.
  | { verb: "settle-unknown-usage"; groupId: string; expectedRevision: number; payload: SettleUnknownUsagePayloadV1 }
  | { verb:"verify-saved-result";groupId:string;taskId:string;expectedRevision:number;payload:{sourceRunId:string;sourceAttempt:number;capsuleHash:string} }
  | { verb: "retry-task"; groupId: string; expectedRevision: number; payload: RetryTaskPayloadV1 }
  // Issue-fixes spec §6.3: archive and unarchive a group (empty payload).
  | { verb: "archive-group" | "unarchive-group"; groupId: string; expectedRevision: number; payload: Record<string, never> }
  // Integration spec §3.1, §6.5, §7: the group's scheme, Retry, and an owner's approval of an agent's resolution.
  | { verb: "set-group-integration"; groupId: string; expectedRevision: number; payload: SetGroupIntegrationPayloadV1 }
  | { verb: "retry-integration" | "resolve-integration-conflict"; groupId: string; expectedRevision: number; payload: Record<string, never> }
  | { verb: "set-task-labels"; groupId: string; taskId: string; expectedRevision: number; payload: SetTaskLabelsPayloadV1 }
  | { verb: "set-task-loop"; groupId: string; taskId: string; expectedRevision: number; payload: SetTaskLoopPayloadV1 }
  // N1 spec §11.1: the requirement commands (accept's server route is Task 10's).
  | { verb: "requirement-open"; groupId: string; expectedRevision: number; payload: RequirementOpenPayloadV1 }
  | { verb: "requirement-answer"; groupId: string; expectedRevision: number; payload: RequirementAnswerPayloadV1 }
  | { verb: "requirement-consensus"; groupId: string; expectedRevision: number; payload: RequirementConsensusPayloadV1 }
  | { verb: "requirement-draft-feedback"; groupId: string; expectedRevision: number; payload: RequirementDraftFeedbackPayloadV1 }
  | { verb: "requirement-draft-accept"; groupId: string; expectedRevision: number; payload: RequirementDraftAcceptPayloadV1 }
  // Control run decisions plan Tasks 9-11: an owner approves a refused decision with an undo.how, or rejects it (no
  // `because` key when the person wrote no line -- the server's schema refuses an empty one).
  | { verb: "approve-pending-decision"; groupId: string; expectedRevision: number; payload: { pendingId: string; undoHow: string } }
  | { verb: "reject-pending-decision"; groupId: string; expectedRevision: number; payload: { pendingId: string; because?: string } };

/** The route a verb is served on -- src/panel/controlApi.ts's mutation table. */
export function controlCommandPath(action: ControlAction): string {
  const group = `/api/control/groups/${segment(action.groupId)}`;
  switch (action.verb) {
    case "import-plan":
      return "/api/control/groups/import-plan";
    case "proposal-edit":
      return `${group}/proposal/edit`;
    case "proposal-set-agent":
      return `${group}/proposal/agent`;
    case "estimate":
      return `${group}/estimates`;
    case "confirm":
      return `${group}/confirm`;
    case "set-limit":
      return `${group}/set-limit`;
    case "start":
      return `${group}/start`;
    case "pause-dispatch":
      return `${group}/pause-dispatch`;
    case "handoff-stop":
      return `${group}/handoff-stop`;
    case "resume-dispatch":
      return `${group}/resume-dispatch`;
    case "resume-from-handoff":
      return `${group}/resume-from-handoff`;
    case "continue-task":
      return `${group}/tasks/${segment(action.taskId)}/continue`;
    case "set-task-labels":
      return `${group}/tasks/${segment(action.taskId)}/labels`;
    case "set-task-loop":
      return `${group}/tasks/${segment(action.taskId)}/loop`;
    case "recovery-retry":
      return "/api/control/recovery/retry";
    case "settle-unknown-usage":
      return `${group}/settle-unknown-usage`;
    case "verify-saved-result":return `${group}/tasks/${segment(action.taskId)}/verify-saved-result`;
    case "retry-task":
      return `${group}/retry-task`;
    case "set-group-integration":
      return `${group}/integration`;
    case "retry-integration":
      return `${group}/integration/retry`;
    case "resolve-integration-conflict":
      return `${group}/integration/resolve`;
    case "archive-group":
      return `${group}/archive`;
    case "unarchive-group":
      return `${group}/unarchive`;
    case "requirement-open":
      return "/api/control/requirements";
    case "requirement-answer":
      return `${group}/requirement/answer`;
    case "requirement-consensus":
      return `${group}/requirement/consensus`;
    case "requirement-draft-feedback":
      return `${group}/requirement/feedback`;
    case "requirement-draft-accept":
      return `${group}/requirement/accept`;
    case "approve-pending-decision":
      return `${group}/decisions/approve`;
    case "reject-pending-decision":
      return `${group}/decisions/reject`;
  }
}

/**
 * A command id is minted once per intent and then kept: the ledger dedupes on the
 * whole raw envelope, so a retry of an uncertain command must replay this exact
 * id and revision, never a fresh one.
 */
export function nextCommandId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function commandEnvelope(commandId: string, action: ControlAction): CommandEnvelopeV1 {
  return { commandId, expectedRevision: action.expectedRevision, payload: { ...action.payload } };
}

/** sessionStorage keeps an unresolved id across a reload; storage can be missing or throw. */
export function readUncertainCommands(storage: Pick<Storage, "getItem"> | undefined): UncertainCommand[] {
  try {
    const raw = storage?.getItem(UNCERTAIN_COMMANDS_KEY);
    const value: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is UncertainCommand => {
      const record = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
      return typeof record.groupId === "string" && typeof record.commandId === "string";
    });
  } catch {
    return [];
  }
}

export function writeUncertainCommands(storage: Pick<Storage, "setItem" | "removeItem"> | undefined, commands: readonly UncertainCommand[]): void {
  try {
    if (commands.length === 0) storage?.removeItem(UNCERTAIN_COMMANDS_KEY);
    else storage?.setItem(UNCERTAIN_COMMANDS_KEY, JSON.stringify([...commands]));
  } catch {
    // Not remembered; the command stays unresolved in this tab only.
  }
}
