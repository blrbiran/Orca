/**
 * Task 9: the budget editor.
 *
 * It renders the proposal the server already computed, takes the person's typed
 * numbers as drafts, and hands one command back per action. It never derives a
 * reserve, a deficit, an "is there budget" answer or a snapshot hash: those are
 * the ledger's, and the panel shows them read-only. A field whose value came
 * from the model or a complex-1m default says so next to the box, because the
 * person is about to type over it.
 */
import type { JSX } from "react";
import type { ControlAction } from "./controlApi.js";
import type {
  Amount,
  AmountDimensionV1,
  ControlConfigV1,
  FieldProvenanceV1,
  GroupViewV1,
  ProposalOperationV1,
  ProposalTargetV1,
} from "./controlTypes.js";

export const DIMENSIONS: AmountDimensionV1[] = ["tokens", "activeMs", "attempts", "sessions"];

export function budgetFieldKey(groupId: string, target: ProposalTargetV1): string {
  return target.scope === "task"
    ? `${groupId}:task:${target.taskId}:${target.allocation}:${target.dimension}`
    : `${groupId}:goal-review:${target.dimension}`;
}

export function groupLimitKey(groupId: string, dimension: AmountDimensionV1): string {
  return `${groupId}:group-limit:${dimension}`;
}

export const CONTEXT_POLICY_KEY = (groupId: string): string => `${groupId}:context-policy`;

export function provenanceText(provenance: FieldProvenanceV1): string {
  if (provenance.provenance === "model") return `model ${provenance.estimateId ?? ""}`.trim();
  return provenance.provenance === "complex-1m-default" ? "complex-1m default" : provenance.provenance;
}

function targetOf(view: GroupViewV1, ownerId: string, bucket: string, dimension: AmountDimensionV1): ProposalTargetV1 | null {
  if (bucket === "review") return { scope: "goal-review", dimension };
  if (bucket !== "work" && bucket !== "handoff") return null;
  const task = view.workItems.find((item) => item.taskId === ownerId);
  return task ? { scope: "task", taskId: ownerId, allocation: bucket, dimension } : null;
}

function valueFor(drafts: Record<string, string>, key: string, serverValue: number): string {
  const draft = drafts[key];
  return draft === undefined ? String(serverValue) : draft;
}

/** The edits actually typed: a draft that reads as a different safe integer from the server's value. */
export function editedOperations(view: GroupViewV1, drafts: Record<string, string>): ProposalOperationV1[] {
  const groupId = view.summary.groupId;
  const operations: ProposalOperationV1[] = [];
  for (const allocation of view.allocations) {
    if (allocation.ownerKind !== "task" && allocation.ownerKind !== "goal-review") continue;
    for (const dimension of DIMENSIONS) {
      const target = targetOf(view, allocation.ownerId, allocation.bucket, dimension);
      if (target === null) continue;
      const draft = drafts[budgetFieldKey(groupId, target)];
      if (draft === undefined || draft.trim() === "") continue;
      const value = Number(draft);
      if (!Number.isSafeInteger(value) || value < 0 || value === allocation.amount[dimension]) continue;
      operations.push({ target, value, provenance: "human" });
    }
  }
  return operations;
}

function limitAmount(view: GroupViewV1, drafts: Record<string, string>): Amount {
  const groupId = view.summary.groupId;
  const limit = { ...view.ledger.groupLimit };
  for (const dimension of DIMENSIONS) {
    const draft = drafts[groupLimitKey(groupId, dimension)];
    if (draft === undefined || draft.trim() === "") continue;
    const value = Number(draft);
    if (Number.isSafeInteger(value) && value >= 0) limit[dimension] = value;
  }
  return limit;
}

export interface BudgetEditorProps {
  view: GroupViewV1;
  config: ControlConfigV1;
  drafts: Record<string, string>;
  onDraft: (key: string, text: string) => void;
  onCommand: (action: ControlAction) => void;
}

export function BudgetEditor(props: BudgetEditorProps): JSX.Element {
  const { view, config, drafts, onDraft, onCommand } = props;
  const groupId = view.summary.groupId;
  const editable = view.proposal.state === "editable";
  const estimator = view.estimates.at(-1) ?? null;
  const observedEnforcement = view.proposal.profiles === null
    ? config.profiles[0]?.observed.budgetEnforcement ?? "unknown"
    : "frozen at confirmation";
  const contextUnavailable = config.profiles.some((profile) => profile.observed.contextObservation === "unavailable");
  const confirmProfile = (kind: "estimator" | "worker" | "handoff" | "goalReview") =>
    view.proposal.profiles?.[kind] ?? { profileId: config.defaults.estimatorProfileId, profileHash: config.defaults.estimatorProfileHash };

  const submitEdit = (): void => {
    const operations = editedOperations(view, drafts);
    if (operations.length === 0) return;
    onCommand({
      verb: "proposal-edit",
      groupId,
      expectedRevision: view.summary.commandRevision,
      payload: { baseProposalVersion: view.proposal.proposalVersion, operations },
    });
  };
  const submitLimit = (): void => {
    onCommand({ verb: "set-limit", groupId, expectedRevision: view.summary.commandRevision, payload: { limit: limitAmount(view, drafts) } });
  };
  const submitConfirm = (): void => {
    const contextDraft = drafts[CONTEXT_POLICY_KEY(groupId)];
    const tokens = contextDraft === undefined || contextDraft.trim() === "" ? null : Number(contextDraft);
    onCommand({
      verb: "confirm",
      groupId,
      expectedRevision: view.summary.commandRevision,
      payload: {
        planHash: view.plan.planHash,
        proposalVersion: view.proposal.proposalVersion,
        budgetMode: view.proposal.budgetMode ?? config.defaults.estimateMode,
        profileIds: {
          estimator: confirmProfile("estimator").profileId, worker: confirmProfile("worker").profileId,
          handoff: confirmProfile("handoff").profileId, goalReview: confirmProfile("goalReview").profileId,
        },
        profileHashes: {
          estimator: confirmProfile("estimator").profileHash, worker: confirmProfile("worker").profileHash,
          handoff: confirmProfile("handoff").profileHash, goalReview: confirmProfile("goalReview").profileHash,
        },
        contextPolicy: { handoffAtContextTokens: tokens === null || !Number.isSafeInteger(tokens) ? null : tokens },
      },
    });
  };
  const submitEstimate = (): void => {
    if (estimator === null) return;
    onCommand({
      verb: "estimate",
      groupId,
      expectedRevision: view.summary.commandRevision,
      payload: {
        proposalVersion: view.proposal.proposalVersion,
        estimatorProfileId: estimator.profile.profileId,
        estimatorProfileHash: estimator.profile.profileHash,
        estimateMode: estimator.mode,
      },
    });
  };

  return (
    <section aria-label="Budget proposal">
      <h3>Proposal v{view.proposal.proposalVersion} · {view.proposal.state}</h3>
      <p role="status">
        budget mode {view.proposal.budgetMode ?? "not chosen"} · observed enforcement {observedEnforcement}
        {view.proposal.budgetMode === "soft" ? " · soft: an overrun is settled after the fact, not prevented" : ""}
      </p>
      {contextUnavailable && (
        <p role="note">context observation unavailable · the context watermark cannot hand off automatically</p>
      )}
      <table>
        <thead>
          <tr><th>owner</th><th>bucket</th><th>state</th>{DIMENSIONS.map((dimension) => <th key={dimension}>{dimension}</th>)}</tr>
        </thead>
        <tbody>
          {view.allocations.map((allocation) => (
            <tr key={`${allocation.ownerKind}:${allocation.ownerId}:${allocation.bucket}`}>
              <td>{allocation.ownerKind} {allocation.ownerId}</td>
              <td>{allocation.bucket}</td>
              <td>{allocation.state}</td>
              {DIMENSIONS.map((dimension) => {
                const target = targetOf(view, allocation.ownerId, allocation.bucket, dimension);
                if (target === null) return <td key={dimension}>{allocation.amount[dimension]}</td>;
                const key = budgetFieldKey(groupId, target);
                return (
                  <td key={dimension}>
                    <label>
                      <span className="sr-only">{allocation.ownerId} {allocation.bucket} {dimension}</span>
                      <input
                        value={valueFor(drafts, key, allocation.amount[dimension])}
                        readOnly={!editable}
                        inputMode="numeric"
                        onChange={(event) => onDraft(key, event.target.value)}
                      />
                      <small>{provenanceText(allocation.fieldProvenance[dimension])}</small>
                    </label>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <fieldset>
        <legend>Group limit</legend>
        {DIMENSIONS.map((dimension) => (
          <label key={dimension}>
            {dimension}
            <input
              value={valueFor(drafts, groupLimitKey(groupId, dimension), view.ledger.groupLimit[dimension])}
              inputMode="numeric"
              onChange={(event) => onDraft(groupLimitKey(groupId, dimension), event.target.value)}
            />
          </label>
        ))}
        <button type="button" onClick={submitLimit}>Set limit</button>
      </fieldset>
      <label>
        Hand off at context tokens (blank keeps it unset)
        <input
          value={valueFor(drafts, CONTEXT_POLICY_KEY(groupId), view.proposal.contextPolicy.handoffAtContextTokens ?? 0)}
          inputMode="numeric"
          onChange={(event) => onDraft(CONTEXT_POLICY_KEY(groupId), event.target.value)}
        />
      </label>
      <p>
        used {view.ledger.used.tokens} · committed {view.ledger.committedRemaining.tokens} · reserve {view.ledger.explicitUnallocatedReserve.tokens}
        {view.ledger.budgetDeficit.tokens > 0 ? ` · deficit ${view.ledger.budgetDeficit.tokens}` : ""}
        {view.ledger.usageUnknown ? " · usage unknown" : ""}
      </p>
      <button type="button" disabled={!editable || editedOperations(view, drafts).length === 0} onClick={submitEdit}>Save proposal</button>
      {estimator !== null && <button type="button" onClick={submitEstimate}>Re-estimate</button>}
      <button type="button" onClick={submitConfirm}>Confirm budget</button>
    </section>
  );
}
