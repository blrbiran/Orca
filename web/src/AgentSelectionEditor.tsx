/**
 * Agent selection spec §6.8 (T15): the proposal view's agent editing. Group slots and each task's own layer are
 * edited as proposal-set-agent commands under the proposal version on screen; each slot shows what the server
 * resolved and, per field, which layer it came from. A slot ccloop refused, or could not answer for now, is red
 * with the code. Nothing here resolves, merges or hashes anything -- the preview is the server's (T14).
 */
import type { JSX } from "react";
import type { ControlAction } from "./controlApi.js";
import { SelectionFields, contextLabel, partialFromFields } from "./AgentFields.js";
import type {
  AgentSelectionPreviewV1, AgentSelectionV1, AgentSlotV1, AgentsViewV1, GroupAgentOverridesV1, GroupViewV1, OperatorPreferencesV1,
  PartialSelectionV1, SelectionProvenanceV1, SlotOutcomeV1,
} from "./controlTypes.js";

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
 * group worker layer); the estimator's group layer on operator → operator-estimator, never the group worker
 * layer; the reconcile group layer on operator → operator-reconcile → group worker.
 */
export function inheritedAgentFor(scope: Scope, preferences: OperatorPreferencesV1 | null | undefined, overrides: GroupAgentOverridesV1): string | undefined {
  const operator = preferences?.defaultAgent;
  if (scope.kind === "task") return overrides.worker?.agent ?? operator;
  if (scope.slot === "worker") return operator;
  if (scope.slot === "estimator") return preferences?.estimator?.agent ?? operator;
  return overrides.worker?.agent ?? preferences?.reconcile?.agent ?? operator;
}

function SelectionCells(props: { selection: AgentSelectionV1; provenance: SelectionProvenanceV1 }): JSX.Element {
  const { selection, provenance } = props;
  return (
    <>
      <td>{selection.agent} <small>from {provenance.agent}</small></td>
      <td>{selection.model} <small>from {provenance.model}</small></td>
      <td>{contextLabel(selection.contextWindow)} <small>from {provenance.contextWindow}</small></td>
    </>
  );
}

/** A slot that did not resolve: refused for good (rejected), or ccloop did not answer this time (unavailable). */
function FailedCell(props: { outcome: Exclude<SlotOutcomeV1, { kind: "resolved" }> }): JSX.Element {
  const { outcome } = props;
  return (
    <td colSpan={3} role="alert" data-outcome={outcome.kind} style={{ color: "red" }}>
      {outcome.kind === "rejected" ? "rejected" : "unavailable for now, Re-read to ask again"} · {outcome.code}
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
}

export function AgentSelectionEditor(props: AgentSelectionEditorProps): JSX.Element {
  const { view, agents, preview, drafts, onDraft, onCommand } = props;
  const groupId = view.summary.groupId;

  if (view.proposal.state === "confirmed") {
    const reconcile = view.agents?.reconcile ?? null;
    return (
      <section aria-label="Agent selection">
        <h3>Agents (frozen at confirmation)</h3>
        <table>
          <thead><tr><th>slot</th><th>agent</th><th>model</th><th>context</th></tr></thead>
          <tbody>
            {view.workItems.map((item) => (
              <tr key={item.taskId} data-slot={`task:${item.taskId}`}>
                <td>{item.taskId}</td>
                {item.agent && item.agentProvenance ? <SelectionCells selection={item.agent} provenance={item.agentProvenance} /> : <td colSpan={3}>not recorded</td>}
              </tr>
            ))}
            <tr data-slot="reconcile">
              <td>reconcile</td>
              {reconcile !== null ? <SelectionCells selection={reconcile.selection} provenance={reconcile.provenance} /> : <td colSpan={3}>not recorded</td>}
            </tr>
          </tbody>
        </table>
      </section>
    );
  }

  const reread = props.onReread && <button type="button" onClick={props.onReread}>Re-read agent selections</button>;
  if (agents === null || preview === null) {
    return <section aria-label="Agent selection"><h3>Agents</h3><p role="status">Resolving agent selections…</p>{reread}</section>;
  }

  const stale = preview.proposalVersion !== view.proposal.proposalVersion;
  const send = (scope: Scope, partial: PartialSelectionV1 | null): void => {
    onCommand({
      verb: "proposal-set-agent", groupId, expectedRevision: view.summary.commandRevision,
      payload: { baseProposalVersion: view.proposal.proposalVersion, scope, partial },
    });
  };
  const inherited = (scope: Scope): string | undefined => inheritedAgentFor(scope, props.preferences, preview.groupOverrides);

  return (
    <section aria-label="Agent selection">
      <h3>Agents · proposal v{view.proposal.proposalVersion}</h3>
      {stale && <p role="status">The resolution shown is for proposal v{preview.proposalVersion}; re-reading. Confirm waits for it.</p>}
      {preview.selectionsHash === null && <p role="alert">A selection below did not resolve; confirm is not offered until every slot resolves.</p>}
      {reread}
      {(["worker", "estimator", "reconcile"] as const).map((slot) => {
        const scope: Scope = { kind: "group", slot };
        const prefix = agentDraftPrefix(groupId, scope);
        const partial = partialFromFields(agents, prefix, preview.groupOverrides[slot], drafts, inherited(scope));
        return (
          <div key={slot}>
            <SelectionFields agents={agents} prefix={prefix} label={`Group ${slot}`} current={preview.groupOverrides[slot]} inheritedAgent={inherited(scope)} drafts={drafts} onDraft={onDraft} />
            <button type="button" disabled={Object.keys(partial).length === 0} onClick={() => send(scope, partial)}>Set group {slot} agent</button>
            <button type="button" disabled={preview.groupOverrides[slot] === undefined} onClick={() => send(scope, null)}>Clear group {slot} agent</button>
            {slot === "estimator" && (
              // Wave 3 review M-7 / ruling R7: the estimator is not part of the confirm; it is used at the next re-estimate.
              <small> Used from the next re-estimate on; like any proposal change it moves the proposal version.</small>
            )}
          </div>
        );
      })}
      <table>
        <thead><tr><th>slot</th><th>agent</th><th>model</th><th>context</th><th>this task's own layer</th></tr></thead>
        <tbody>
          {preview.slots.map((entry) => {
            const taskId = entry.taskId;
            const own = taskId === null ? undefined : preview.taskOverrides[taskId] ?? undefined;
            const scope: Scope | null = taskId === null ? null : { kind: "task", taskId };
            const prefix = scope === null ? "" : agentDraftPrefix(groupId, scope);
            const partial = scope === null ? {} : partialFromFields(agents, prefix, own, drafts, inherited(scope));
            return (
              <tr key={entry.key} data-slot={entry.key}>
                <td>{taskId ?? "reconcile"}</td>
                {entry.outcome.kind === "resolved"
                  ? <SelectionCells selection={entry.outcome.frozen.selection} provenance={entry.outcome.frozen.provenance} />
                  : <FailedCell outcome={entry.outcome} />}
                <td>
                  {scope !== null && (
                    <>
                      <SelectionFields agents={agents} prefix={prefix} label={`Task ${taskId}`} current={own} inheritedAgent={inherited(scope)} drafts={drafts} onDraft={onDraft} />
                      <button type="button" disabled={Object.keys(partial).length === 0} onClick={() => send(scope, partial)}>Set agent for task {taskId}</button>
                      <button type="button" disabled={own === undefined} onClick={() => send(scope, null)}>Clear agent for task {taskId}</button>
                    </>
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
