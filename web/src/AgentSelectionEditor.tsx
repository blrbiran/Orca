/**
 * Agent selection spec §6.8 (T15): the proposal view's agent editing. Group slots and each task's own layer are
 * edited as proposal-set-agent commands under the proposal version on screen; each slot shows what the server
 * resolved and, per field, which layer it came from. A slot ccloop refused, or could not answer for now, is red
 * with the code. Nothing here resolves, merges or hashes anything -- the preview is the server's (T14).
 */
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { ControlAction } from "./controlApi.js";
import { SelectionFields, contextLabel, panelPartialFromFields, selectionFieldErrors } from "./AgentFields.js";
import type {
  AgentSelectionPreviewV1, AgentSelectionV1, AgentSlotV1, AgentsViewV1, GroupAgentOverridesV1, GroupViewV1, ModelListState, OperatorPreferencesV1,
  PanelPartialSelectionV1, PartialSelectionV1, SelectionProvenanceV1, SlotOutcomeV1,
} from "./controlTypes.js";
import { enumText } from "./i18n.js";
import { explainBesideCode } from "./ccloopCodes.js";

type Scope = { kind: "group"; slot: AgentSlotV1 } | { kind: "task"; taskId: string };

export const agentDraftPrefix = (groupId: string, scope: Scope): string =>
  scope.kind === "group" ? `${groupId}:agent:group:${scope.slot}` : `${groupId}:agent:task:${scope.taskId}`;

/** The hash a confirm may carry: only a resolution of this group, at this proposal version, that resolved whole. */
export function selectionsHashFor(view: GroupViewV1, preview: AgentSelectionPreviewV1 | null | undefined): string | null {
  if (!preview || view.proposal.state !== "editable") return null;
  if (preview.groupId !== view.summary.groupId || preview.proposalVersion !== view.proposal.proposalVersion) return null;
  return preview.selectionsHash;
}

/**
 * The agent a layer inherits when it names none: the effective agent of the layers below it (spec §6.3,
 * `slotLayers`). The worker's group layer and a task's layer sit on the operator default (a task also on the
 * group worker layer); the estimator's group layer on operator → operator-estimator when the operator's estimator
 * role names any field (never then the group worker layer), and otherwise on the group worker layer -- the effective
 * group primary, as `slotLayers` builds it; the reconcile group layer on operator → operator-reconcile → group worker.
 */
export function inheritedAgentFor(
  scope: Scope, preferences: OperatorPreferencesV1 | null | undefined, overrides: GroupAgentOverridesV1,
  planLayers?: AgentSelectionPreviewV1["planLayers"],
): string | undefined {
  const operator = preferences?.defaultAgent;
  // Ruling review R7: a group level is the plan's layer under the panel's; a null panel agent masks the plan's.
  const groupWorker = (below: string | undefined): string | undefined => levelAgent(overrides.worker, planLayers?.group.worker, below);
  if (scope.kind === "task") return groupWorker(operator);
  if (scope.slot === "worker") return operator;
  if (scope.slot === "estimator") return preferences?.estimator && Object.values(preferences.estimator).some((value) => value !== undefined)
    ? preferences.estimator.agent ?? operator : groupWorker(operator);
  return groupWorker(preferences?.reconcile?.agent ?? operator);
}

/** The agent one level ends up naming: the panel's own, else (unless the panel masks it) the plan's, else `below`. */
function levelAgent(panel: PanelPartialSelectionV1 | undefined, plan: PartialSelectionV1 | undefined, below: string | undefined): string | undefined {
  if (typeof panel?.agent === "string") return panel.agent;
  return panel?.agent === null ? below : plan?.agent ?? below;
}

function SelectionCells(props: { selection: AgentSelectionV1; provenance: SelectionProvenanceV1 }): JSX.Element {
  const { selection, provenance } = props;
  const { t } = useTranslation();
  return (
    <>
      <td>{selection.agent} <small>{t("agents.from", { source: enumText("selectionSource", provenance.agent) })}</small></td>
      <td>{selection.model} <small>{t("agents.from", { source: enumText("selectionSource", provenance.model) })}</small></td>
      <td>{contextLabel(selection.contextWindow)} <small>{t("agents.from", { source: enumText("selectionSource", provenance.contextWindow) })}</small></td>
    </>
  );
}

/** A slot that did not resolve: refused for good (rejected), or ccloop did not answer this time (unavailable). */
function FailedCell(props: { outcome: Exclude<SlotOutcomeV1, { kind: "resolved" }> }): JSX.Element {
  const { outcome } = props;
  const { t } = useTranslation();
  const words = explainBesideCode(outcome.code);
  return (
    <td colSpan={3} role="alert" data-outcome={outcome.kind} style={{ color: "red" }}>
      {outcome.kind === "rejected" ? t("agents.rejected") : t("agents.unavailable")} · {outcome.code}{words !== null ? ` · ${words}` : ""}
    </td>
  );
}

export interface AgentSelectionEditorProps {
  view: GroupViewV1;
  agents: AgentsViewV1 | null;
  preview: AgentSelectionPreviewV1 | null;
  /** This operator's defaults, for the agent a layer inherits; absent until read. */
  preferences?: OperatorPreferencesV1 | null;
  drafts: Record<string, string>;
  onDraft: (key: string, text: string) => void;
  onCommand: (action: ControlAction) => void;
  /**
   * T15 fix round 1: invalidate and re-fetch this group's preview. Nothing re-reads it on a timer (each read
   * spawns ccloop), so an unavailable slot or a read that failed twice waits for this.
   */
  onReread?: () => void;
  /**
   * Wave 4 review I-1: the server's code when the installation table or the preferences could not be read
   * (control-port-unconfigured, or a failure Re-read may cure). Shown instead of "Resolving…", which never ends.
   */
  agentsFailure?: string | null;
  /** Ruling review R17: the page's backoff retry, shown so the operator knows it is retrying and when it stopped. */
  retryNotice?: string | null;
  /** Issue-fixes spec §6.3: an archived group refuses every command but the unarchive, so no action is offered (read-only). */
  archived?: boolean;
  /** Tester round 2 §4.2.3: a blocked group -- no edit is offered (the server refuses them), but the preview may be re-read. */
  blocked?: boolean;
  /** Spec 2026-10-15 §5 (R3): each installation's model list as last read, and (owner only) re-probing one. */
  models?: (installationId: string) => ModelListState | undefined;
  onRefreshModels?: (installationId: string) => void;
}

export function AgentSelectionEditor(props: AgentSelectionEditorProps): JSX.Element {
  const { view, agents, preview, drafts, onDraft, onCommand } = props;
  // Tester round 2 §4.2.3: a blocked group's editors are read-only like an archived one's, but Re-read stays (review minor 11).
  const archived = props.archived === true || props.blocked === true;
  const trulyArchived = props.archived === true;
  const groupId = view.summary.groupId;
  const { t } = useTranslation();

  if (view.proposal.state === "confirmed") {
    const reconcile = view.agents?.reconcile ?? null;
    return (
      <section aria-label={t("agents.region")}>
        <h3>{t("agents.frozenTitle")}</h3>
        <table>
          <thead><tr><th>{t("agents.th.slot")}</th><th>{t("agents.th.agent")}</th><th>{t("agents.th.model")}</th><th>{t("agents.th.context")}</th></tr></thead>
          <tbody>
            {view.workItems.map((item) => (
              <tr key={item.taskId} data-slot={`task:${item.taskId}`}>
                <td>{item.taskId}</td>
                {item.agent && item.agentProvenance ? <SelectionCells selection={item.agent} provenance={item.agentProvenance} /> : <td colSpan={3}>{t("agents.notRecorded")}</td>}
              </tr>
            ))}
            <tr data-slot="reconcile">
              <td>{enumText("agentSlot", "reconcile")}</td>
              {reconcile !== null ? <SelectionCells selection={reconcile.selection} provenance={reconcile.provenance} /> : <td colSpan={3}>{t("agents.notRecorded")}</td>}
            </tr>
          </tbody>
        </table>
      </section>
    );
  }

  const reread = (
    <>
      {props.onReread && !trulyArchived && <button type="button" onClick={props.onReread}>{t("agents.reread")}</button>}
      {props.retryNotice ? <p role="status" data-retry="">{props.retryNotice}</p> : null}
    </>
  );
  if (agents === null && props.agentsFailure) {
    return (
      <section aria-label={t("agents.region")}>
        <h3>{t("agents.title")}</h3>
        <p role="alert">{t("agents.cannotRead", { code: props.agentsFailure })}</p>
        {reread}
      </section>
    );
  }
  if (agents === null || preview === null) {
    return <section aria-label={t("agents.region")}><h3>{t("agents.title")}</h3><p role="status">{t("agents.resolving")}</p>{reread}</section>;
  }

  const stale = preview.proposalVersion !== view.proposal.proposalVersion;
  const send = (scope: Scope, partial: PanelPartialSelectionV1 | null): void => {
    onCommand({
      verb: "proposal-set-agent", groupId, expectedRevision: view.summary.commandRevision,
      payload: { baseProposalVersion: view.proposal.proposalVersion, scope, partial },
    });
  };
  const inherited = (scope: Scope): string | undefined => inheritedAgentFor(scope, props.preferences, preview.groupOverrides, preview.planLayers);
  // Ruling review R7: the plan's values at each level (the estimator has no plan layer, ruling R8).
  const plannedFor = (scope: Scope): PartialSelectionV1 | undefined =>
    scope.kind === "task" ? preview.planLayers.tasks[scope.taskId] ?? undefined
      : scope.slot === "estimator" ? undefined : preview.planLayers.group[scope.slot];

  // Tester round 2 §6.2.4: the task slots that resolved through a layer other than their own (task or task-plan).
  const workerRole = preview.rolePreviews?.worker;
  const inheriting = preview.slots.filter((entry) => entry.taskId !== null && entry.outcome.kind === "resolved"
    && entry.outcome.frozen.provenance.agent !== "task" && entry.outcome.frozen.provenance.agent !== "task-plan").length;

  return (
    <section aria-label={t("agents.region")}>
      <h3>{t("agents.proposalTitle", { version: view.proposal.proposalVersion })}</h3>
      {stale && <p role="status">{t("agents.staleResolution", { version: preview.proposalVersion })}</p>}
      {preview.selectionsHash === null && <p role="alert">{t("agents.unresolved")}</p>}
      {reread}
      {!archived && (["worker", "estimator", "reconcile"] as const).map((slot) => {
        const scope: Scope = { kind: "group", slot };
        const prefix = agentDraftPrefix(groupId, scope);
        const roleOutcome = slot === "worker" ? preview.rolePreviews?.worker : slot === "estimator" ? preview.rolePreviews?.estimator : preview.slots.find((entry) => entry.key === "reconcile")?.outcome;
        const inheritance = roleOutcome?.kind === "resolved" ? roleOutcome.frozen : undefined;
        const inheritedAgent = inherited(scope) ?? inheritance?.selection.agent;
        const partial = panelPartialFromFields(agents, prefix, preview.groupOverrides[slot], plannedFor(scope), drafts, inheritedAgent);
        const invalid = selectionFieldErrors(agents, prefix, preview.groupOverrides[slot], plannedFor(scope), drafts, inheritedAgent).length > 0;
        return (
          <div key={slot}>
            <SelectionFields agents={agents} prefix={prefix} label={t("agents.groupSlot", { slot: enumText("agentSlot", slot) })} current={preview.groupOverrides[slot]} planned={plannedFor(scope)} inheritedAgent={inheritedAgent} inheritance={inheritance} drafts={drafts} onDraft={onDraft} models={props.models} onRefreshModels={props.onRefreshModels} />
            <button type="button" disabled={invalid || Object.keys(partial).length === 0} onClick={() => send(scope, partial)}>{t("agents.setGroup", { slot: enumText("agentSlot", slot) })}</button>
            <button type="button" disabled={preview.groupOverrides[slot] === undefined} onClick={() => send(scope, null)}>{t("agents.clearGroup", { slot: enumText("agentSlot", slot) })}</button>
            {/* Tester round 2 §6.2.5: no layer names an agent for the group worker. */}
            {slot === "worker" && workerRole?.kind === "rejected" && workerRole.code === "agent-unselected" && (
              <p role="note" data-testid="agents-no-worker">{t("agents.noWorker")} <a href="#settings/agents">{t("nav.globalSettings")}</a></p>
            )}
            {slot === "estimator" && (
              // Wave 3 review M-7 / ruling R7: the estimator is not part of the confirm; it is used at the next re-estimate.
              <small>{t("agents.estimatorNote")}</small>
            )}
          </div>
        );
      })}
      {/* Review minor 8: plural forms; no line when no task inherits. */}
      {workerRole?.kind === "resolved" && inheriting > 0 && (
        <p data-testid="agents-inherit-line">{t("agents.inheritLine", { count: inheriting, agent: `${workerRole.frozen.selection.agent} · ${workerRole.frozen.selection.model}` })}</p>
      )}
      <table>
        <thead><tr><th>{t("agents.th.slot")}</th><th>{t("agents.th.agent")}</th><th>{t("agents.th.model")}</th><th>{t("agents.th.context")}</th><th>{t("agents.th.ownLayer")}</th></tr></thead>
        <tbody>
          {preview.slots.map((entry) => {
            const taskId = entry.taskId;
            const own = taskId === null ? undefined : preview.taskOverrides[taskId] ?? undefined;
            const scope: Scope | null = taskId === null ? null : { kind: "task", taskId };
            const prefix = scope === null ? "" : agentDraftPrefix(groupId, scope);
            const partial = scope === null ? {} : panelPartialFromFields(agents, prefix, own, plannedFor(scope), drafts, inherited(scope));
            const invalid = scope !== null && selectionFieldErrors(agents, prefix, own, plannedFor(scope), drafts, inherited(scope)).length > 0;
            return (
              <tr key={entry.key} data-slot={entry.key}>
                <td>{taskId ?? enumText("agentSlot", "reconcile")}</td>
                {entry.outcome.kind === "resolved"
                  ? <SelectionCells selection={entry.outcome.frozen.selection} provenance={entry.outcome.frozen.provenance} />
                  : <FailedCell outcome={entry.outcome} />}
                <td>
                  {scope !== null && !archived && (
                    // Tester round 2 §6.2.3 (#6): a task inherits the group worker unless it says otherwise, so its own
                    // fields fold away -- open only for a task with its own override or a slot that did not resolve.
                    <details open={own != null || entry.outcome.kind !== "resolved"} data-task-override={taskId}>
                      <summary>{t("agents.overrideTask", { taskId: String(taskId) })}</summary>
                      <SelectionFields agents={agents} prefix={prefix} label={t("agents.taskLayer", { taskId: String(taskId) })} current={own} planned={plannedFor(scope)} inheritedAgent={inherited(scope) ?? (entry.outcome.kind === "resolved" ? entry.outcome.frozen.selection.agent : undefined)} inheritance={entry.outcome.kind === "resolved" ? entry.outcome.frozen : undefined} drafts={drafts} onDraft={onDraft} models={props.models} onRefreshModels={props.onRefreshModels} />
                      <button type="button" disabled={invalid || Object.keys(partial).length === 0} onClick={() => send(scope, partial)}>{t("agents.setTask", { taskId: String(taskId) })}</button>
                      <button type="button" disabled={own === undefined} onClick={() => send(scope, null)}>{t("agents.clearTask", { taskId: String(taskId) })}</button>
                    </details>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
