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
import { useContext } from "react";
import type { JSX } from "react";
import { AccountContext, mayHumanOnly } from "./AuthGate.js";
import { GroupIntegrationConfirm } from "./IntegrationScheme.js";
import { useTranslation } from "react-i18next";
import type { ControlAction } from "./controlApi.js";
import i18n, { enumText } from "./i18n.js";
import type {
  AllocationViewV1,
  Amount,
  AmountDimensionV1,
  BudgetEstimateV1,
  ControlConfigV1,
  FieldProvenanceV1,
  GroupViewV1,
  ProposalOperationV1,
  ProposalTargetV1,
  SetTaskLoopPayloadV1,
  WorkItemViewV1,
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
  if (provenance.provenance === "model" && provenance.estimateId) return i18n.t("budget.provenanceModel", { estimateId: provenance.estimateId });
  return enumText("fieldProvenance", provenance.provenance);
}

/** Loop plans spec §4.3 (C6): a loop task's work budget is changed only through set-task-loop (its plan card, or a suggestion). */
export const loopOwned = (item: WorkItemViewV1): boolean => item.loopPlan !== undefined && item.loopPlan !== null;

function targetOf(view: GroupViewV1, ownerId: string, bucket: string, dimension: AmountDimensionV1): ProposalTargetV1 | null {
  if (bucket === "review") return { scope: "goal-review", dimension };
  if (bucket !== "work" && bucket !== "handoff") return null;
  const task = view.workItems.find((item) => item.taskId === ownerId);
  // Read-only here, so no edit and no suggestion ever sends proposal-edit for it (Drafter finding F14); its suggestions
  // go through set-task-loop instead (suggestedLoopActions).
  if (task !== undefined && bucket === "work" && loopOwned(task)) return null;
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

/** Single-call estimate spec §7: what one "apply" control covers. */
export type SuggestionScope =
  | { kind: "field"; target: ProposalTargetV1 }
  | { kind: "row"; ownerKind: "task" | "goal-review"; ownerId: string; bucket: "work" | "handoff" | "review" }
  | { kind: "all" };

/**
 * The estimate that may advise this proposal, or null: the newest by version (the view lists estimates by id, drafter
 * finding F12), and only when it is ready, for this plan, and the proposal is still editable. Anything else and the
 * editor is exactly what it was before suggestions existed.
 */
export function adviceOf(view: GroupViewV1): { estimateId: string; output: BudgetEstimateV1; stale: boolean } | null {
  if (view.proposal.state !== "editable") return null;
  let newest: GroupViewV1["estimates"][number] | null = null;
  for (const estimate of view.estimates) if (newest === null || estimate.estimateVersion > newest.estimateVersion) newest = estimate;
  if (newest === null || newest.state !== "ready" || newest.output === null || newest.output.planHash !== view.plan.planHash) return null;
  return { estimateId: newest.estimateId, output: newest.output, stale: newest.stale === true };
}

function suggestedAmount(output: BudgetEstimateV1, allocation: AllocationViewV1): Amount | null {
  if (allocation.ownerKind === "goal-review" && allocation.bucket === "review") return output.goalReviewReserve;
  if (allocation.ownerKind !== "task" || (allocation.bucket !== "work" && allocation.bucket !== "handoff")) return null;
  return output.tasks.find((task) => task.taskId === allocation.ownerId)?.[allocation.bucket] ?? null;
}

/**
 * The only place that decides which suggestions a control sends (the editedOperations of the model's advice): each
 * field in `scope` whose suggested value differs from the proposal's, as provenance "model" with the estimate's id --
 * the exact number the server re-checks (verifyModelField). A field already at its suggestion sends nothing.
 */
export function suggestedOperations(view: GroupViewV1, scope: SuggestionScope): ProposalOperationV1[] {
  const advice = adviceOf(view);
  // W6: the server refuses a stale estimate's values (estimate-stale), so none is offered.
  if (advice === null || advice.stale) return [];
  const groupId = view.summary.groupId;
  const operations: ProposalOperationV1[] = [];
  for (const allocation of view.allocations) {
    const suggested = suggestedAmount(advice.output, allocation);
    if (suggested === null) continue;
    if (scope.kind === "row" && (allocation.ownerKind !== scope.ownerKind || allocation.ownerId !== scope.ownerId || allocation.bucket !== scope.bucket)) continue;
    for (const dimension of DIMENSIONS) {
      const target = targetOf(view, allocation.ownerId, allocation.bucket, dimension);
      if (target === null) continue;
      if (scope.kind === "field" && budgetFieldKey(groupId, target) !== budgetFieldKey(groupId, scope.target)) continue;
      if (suggested[dimension] === allocation.amount[dimension]) continue;
      operations.push({ target, value: suggested[dimension], provenance: "model", estimateId: advice.estimateId });
    }
  }
  return operations;
}

const LOOP_WORK_DIMENSIONS = ["tokens", "activeMs", "attempts"] as const;

/**
 * W5 (human ruling H6, superseding plan ruling R-F14): a loop task's work suggestion is applied through its one owner,
 * set-task-loop, keeping the task's current plan and inputs. The budget is the current work amount with each suggested
 * dimension in `scope` that differs replaced, and workProvenance names the estimate for exactly those dimensions (the
 * server re-checks each, verifyModelField). Sessions is not in set-task-loop's payload, so it is never suggested here.
 */
export function suggestedLoopActions(view: GroupViewV1, scope: SuggestionScope): ControlAction[] {
  const advice = adviceOf(view);
  if (advice === null || advice.stale) return [];
  const groupId = view.summary.groupId;
  const actions: ControlAction[] = [];
  for (const allocation of view.allocations) {
    if (allocation.ownerKind !== "task" || allocation.bucket !== "work") continue;
    const plan = view.workItems.find((item) => item.taskId === allocation.ownerId)?.loopPlan;
    if (plan === undefined || plan === null) continue;
    if (scope.kind === "row" && (scope.ownerKind !== "task" || scope.ownerId !== allocation.ownerId || scope.bucket !== "work")) continue;
    const suggested = suggestedAmount(advice.output, allocation);
    if (suggested === null) continue;
    const work = { tokens: allocation.amount.tokens, activeMs: allocation.amount.activeMs, attempts: allocation.amount.attempts };
    const workProvenance: NonNullable<SetTaskLoopPayloadV1["workProvenance"]> = {};
    for (const dimension of LOOP_WORK_DIMENSIONS) {
      if (scope.kind === "field" && budgetFieldKey(groupId, scope.target) !== budgetFieldKey(groupId, { scope: "task", taskId: allocation.ownerId, allocation: "work", dimension })) continue;
      if (suggested[dimension] === allocation.amount[dimension]) continue;
      work[dimension] = suggested[dimension];
      workProvenance[dimension] = { provenance: "model", estimateId: advice.estimateId };
    }
    if (Object.keys(workProvenance).length === 0) continue;
    actions.push({
      verb: "set-task-loop", groupId, taskId: allocation.ownerId, expectedRevision: view.summary.commandRevision,
      // Syncskill integration spec §10.4: the payload is the task's full desired state, so its skill set goes back unchanged.
      payload: { baseLoopVersion: plan.loopVersion, plan: plan.planId, inputs: plan.inputs, work, workProvenance, ...(plan.skills === undefined ? {} : { skills: plan.skills }) },
    });
  }
  return actions;
}

/**
 * Every command one suggestion control sends, in the order they must be sent: the proposal-edit first, then one
 * set-task-loop per loop task. A set-task-loop on a draft proposal advances proposalVersion (reopenProposal), which a
 * later proposal-edit's baseProposalVersion would miss; a proposal-edit does not touch any task's loopVersion, and one
 * task's set-task-loop does not touch another's. So in this order only expectedRevision changes between them.
 */
export function suggestionActions(view: GroupViewV1, scope: SuggestionScope): ControlAction[] {
  const operations = suggestedOperations(view, scope);
  const edit: ControlAction[] = operations.length === 0 ? [] : [{
    verb: "proposal-edit", groupId: view.summary.groupId, expectedRevision: view.summary.commandRevision,
    payload: { baseProposalVersion: view.proposal.proposalVersion, operations },
  }];
  return [...edit, ...suggestedLoopActions(view, scope)];
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
  /**
   * W5 (human ruling H16: no manual step): send these in order, each at the commandRevision the previous one's success
   * returned, stopping at the first that does not succeed. Used when one control needs more than one command. Absent
   * (a render without the page around it), only the first is sent; the rest stay offered on screen.
   */
  onCommands?: (actions: ControlAction[]) => void;
  /**
   * Agent selection spec §6.4 step 3: the hash of the agent resolution on screen (the group's preview, T15).
   * Without one, confirm is not offered: a confirmation is never sent unbound to the selections the operator saw.
   */
  selectionsHash?: string | null;
  /** Integration spec §9.1: the target the group's repository suggests, for a keep group an owner switches on. */
  suggestedTarget?: string | null;
}

export function BudgetEditor(props: BudgetEditorProps): JSX.Element {
  const { view, config, drafts, onDraft, onCommand } = props;
  const { t } = useTranslation();
  // Accounts spec §3.5: set-limit is human-only; a member sees the limit but no control the server would refuse.
  const mayLimit = mayHumanOnly(useContext(AccountContext));
  const groupId = view.summary.groupId;
  const editable = view.proposal.state === "editable";
  const estimator = view.estimates.at(-1) ?? null;
  const advice = adviceOf(view);
  const allSuggested = suggestionActions(view, { kind: "all" });
  // Spec §7: applying a suggestion is its own command, never a draft; the server re-checks every value.
  // Ruling 26 (Orca ledger 2026-09-27-single-call-estimate §3.21; session c85d2c4e, 2026-09-28): an unsaved draft of a
  // field being applied was left in place and kept masking the applied value, so applying drops those fields' drafts --
  // choosing the model's number replaces what was typed there. Drafts of other fields stay.
  const applySuggestions = (actions: ControlAction[]): void => {
    if (actions.length === 0) return;
    for (const action of actions) {
      if (action.verb !== "proposal-edit") continue;
      for (const operation of action.payload.operations) {
        const key = budgetFieldKey(groupId, operation.target);
        if (drafts[key] !== undefined) onDraft(key, "");
      }
    }
    if (actions.length > 1 && props.onCommands !== undefined) props.onCommands(actions);
    else onCommand(actions[0]!);
  };
  const firstProfile = config.profiles[0];
  const observedEnforcement = view.proposal.profiles === null
    ? firstProfile === undefined ? t("common.unknown") : enumText("budgetEnforcement", firstProfile.observed.budgetEnforcement)
    : t("budget.frozenAtConfirmation");
  const contextUnavailable = config.profiles.some((profile) => profile.observed.contextObservation === "unavailable");
  // Backlog #11(b) (Orca handoff §9.1): handoffControl "durable" and a handoffExecution are what dispatch requires of a
  // task or handoff profile (webDispatch.ts probeBlocksDispatch, budget.ts assertCapabilities); a group bound to one
  // that lacks them is refused as claim-capability-unavailable and nothing more, so the two values are named here.
  const handoffBlocked = config.profiles.filter((profile) =>
    (profile.allowedWorkKinds.includes("task") || profile.allowedWorkKinds.includes("handoff"))
    && (profile.observed.handoffControl !== "durable" || profile.observed.handoffExecution === null));
  // Ruling R7: a panel started without --estimator-profile/--estimate-mode serves `defaults: null`.
  // There is then nothing to fall back to, so confirming is refused here rather than sent with a
  // guessed profile or a guessed mode -- guessing the mode is the strict-versus-soft fault itself.
  const defaults = config.defaults;
  const confirmBlocked = defaults === null && (view.proposal.profiles === null || view.proposal.budgetMode === null);
  const shownSelectionsHash = props.selectionsHash ?? null;
  // Integration spec §3.2, ruling R2: confirming a group Orca merges or pushes is an owner's approval of its scheme.
  const integrationBlocked = view.integration !== undefined && !mayLimit;
  const confirmProfile = (kind: "estimator" | "worker" | "handoff" | "goalReview") =>
    view.proposal.profiles?.[kind] ?? { profileId: defaults?.estimatorProfileId ?? "", profileHash: defaults?.estimatorProfileHash ?? "" };

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
    if (confirmBlocked || shownSelectionsHash === null || integrationBlocked) return;
    const contextDraft = drafts[CONTEXT_POLICY_KEY(groupId)];
    const tokens = contextDraft === undefined || contextDraft.trim() === "" ? null : Number(contextDraft);
    onCommand({
      verb: "confirm",
      groupId,
      expectedRevision: view.summary.commandRevision,
      payload: {
        planHash: view.plan.planHash,
        proposalVersion: view.proposal.proposalVersion,
        budgetMode: view.proposal.budgetMode ?? defaults!.estimateMode,
        profileIds: {
          estimator: confirmProfile("estimator").profileId, worker: confirmProfile("worker").profileId,
          handoff: confirmProfile("handoff").profileId, goalReview: confirmProfile("goalReview").profileId,
        },
        profileHashes: {
          estimator: confirmProfile("estimator").profileHash, worker: confirmProfile("worker").profileHash,
          handoff: confirmProfile("handoff").profileHash, goalReview: confirmProfile("goalReview").profileHash,
        },
        contextPolicy: { handoffAtContextTokens: tokens === null || !Number.isSafeInteger(tokens) ? null : tokens },
        selectionsHash: shownSelectionsHash,
        // The hash of the scheme on screen binds the approval to it; a keep group adds no key, so its hash is unchanged.
        ...(view.integration === undefined ? {} : { integrationHash: view.integration.schemeHash }),
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
    <section aria-label={t("budget.region")}>
      <h3>{t("budget.heading", { version: view.proposal.proposalVersion, state: enumText("proposalState", view.proposal.state) })}</h3>
      <p role="status">
        {t("budget.modeLine", { mode: view.proposal.budgetMode === null ? t("budget.notChosen") : enumText("budgetMode", view.proposal.budgetMode), enforcement: observedEnforcement })}
        {view.proposal.budgetMode === "soft" ? t("budget.softNote") : ""}
      </p>
      {contextUnavailable && (
        <p role="note">{t("budget.contextUnavailable")}</p>
      )}
      {handoffBlocked.map((profile) => (
        <p role="note" key={`handoff-capability:${profile.profileId}`}>
          {t("budget.handoffBlocked", { profileId: profile.profileId, control: enumText("handoffControl", profile.observed.handoffControl), execution: profile.observed.handoffExecution === null ? t("common.none") : enumText("handoffExecution", profile.observed.handoffExecution) })}
        </p>
      ))}
      <table>
        <thead>
          <tr><th>{t("budget.th.owner")}</th><th>{t("budget.th.bucket")}</th><th>{t("budget.th.state")}</th>{DIMENSIONS.map((dimension) => <th key={dimension}>{enumText("dimension", dimension)}</th>)}{advice !== null && <th>{t("budget.th.suggestion")}</th>}</tr>
        </thead>
        <tbody>
          {view.allocations.map((allocation) => (
            <tr key={`${allocation.ownerKind}:${allocation.ownerId}:${allocation.bucket}`}>
              <td>{enumText("ownerKind", allocation.ownerKind)} {allocation.ownerId}</td>
              <td>{enumText("bucket", allocation.bucket)}</td>
              <td>{enumText("allocationState", allocation.state)}</td>
              {DIMENSIONS.map((dimension) => {
                const target = targetOf(view, allocation.ownerId, allocation.bucket, dimension);
                if (target === null) {
                  const owned = allocation.ownerKind === "task" && allocation.bucket === "work" && view.workItems.some((item) => item.taskId === allocation.ownerId && loopOwned(item));
                  const [loopAction] = owned ? suggestedLoopActions(view, { kind: "field", target: { scope: "task", taskId: allocation.ownerId, allocation: "work", dimension } }) : [];
                  const loopValue = loopAction?.verb === "set-task-loop" && dimension !== "sessions" ? loopAction.payload.work[dimension] : null;
                  return (
                    <td key={dimension}>
                      {allocation.amount[dimension]}{owned ? <small>{t("budget.changeInCard")}</small> : null}
                      {loopValue !== null && (
                        <button type="button" aria-label={t("budget.useFor", { value: loopValue, owner: allocation.ownerId, bucket: enumText("bucket", allocation.bucket), dimension: enumText("dimension", dimension) })}
                          onClick={() => applySuggestions([loopAction!])}>{t("budget.use", { value: loopValue })}</button>
                      )}
                    </td>
                  );
                }
                const key = budgetFieldKey(groupId, target);
                const [fieldOperation] = suggestedOperations(view, { kind: "field", target });
                return (
                  <td key={dimension}>
                    <label>
                      <span className="sr-only">{allocation.ownerId} {enumText("bucket", allocation.bucket)} {enumText("dimension", dimension)}</span>
                      <input
                        value={valueFor(drafts, key, allocation.amount[dimension])}
                        readOnly={!editable}
                        inputMode="numeric"
                        onChange={(event) => onDraft(key, event.target.value)}
                      />
                      <small>{provenanceText(allocation.fieldProvenance[dimension])}</small>
                    </label>
                    {fieldOperation !== undefined && (
                      <button type="button" aria-label={t("budget.useFor", { value: fieldOperation.value, owner: allocation.ownerId, bucket: enumText("bucket", allocation.bucket), dimension: enumText("dimension", dimension) })}
                        onClick={() => applySuggestions(suggestionActions(view, { kind: "field", target }))}>{t("budget.use", { value: fieldOperation.value })}</button>
                    )}
                  </td>
                );
              })}
              {advice !== null && (() => {
                const row = allocation.ownerKind === "task" || allocation.ownerKind === "goal-review"
                  ? suggestionActions(view, { kind: "row", ownerKind: allocation.ownerKind, ownerId: allocation.ownerId, bucket: allocation.bucket as "work" | "handoff" | "review" })
                  : [];
                return <td>{row.length > 0 && <button type="button" aria-label={t("budget.applyRowFor", { owner: allocation.ownerId, bucket: enumText("bucket", allocation.bucket) })} onClick={() => applySuggestions(row)}>{t("budget.applyRow")}</button>}</td>;
              })()}
            </tr>
          ))}
        </tbody>
      </table>
      {advice?.stale === true && <p role="note">{t("budget.staleEstimate")}</p>}
      {allSuggested.length > 0 && <button type="button" onClick={() => applySuggestions(allSuggested)}>{t("budget.applyAll")}</button>}
      {advice !== null && (
        <details>
          <summary>{t("budget.rationale", { estimateId: advice.estimateId })}</summary>
          <p>{advice.output.groupRationale}</p>
          <ul>
            {advice.output.tasks.map((task) => (
              <li key={task.taskId}>
                {t("budget.rationaleLine", { taskId: task.taskId, complexity: enumText("complexity", task.complexity), confidence: enumText("confidence", task.confidence), rationale: task.rationale })}
                <ul>{task.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul>
              </li>
            ))}
          </ul>
        </details>
      )}
      <fieldset>
        <legend>{t("budget.groupLimit")}</legend>
        {DIMENSIONS.map((dimension) => (
          <label key={dimension}>
            {enumText("dimension", dimension)}
            <input
              value={valueFor(drafts, groupLimitKey(groupId, dimension), view.ledger.groupLimit[dimension])}
              inputMode="numeric"
              readOnly={!mayLimit}
              onChange={(event) => onDraft(groupLimitKey(groupId, dimension), event.target.value)}
            />
          </label>
        ))}
        {mayLimit ? <button type="button" onClick={submitLimit}>{t("budget.setLimit")}</button> : <p role="note">{t("budget.ownerSetsLimit")}</p>}
      </fieldset>
      <label>
        {t("budget.handoffAt")}
        <input
          value={valueFor(drafts, CONTEXT_POLICY_KEY(groupId), view.proposal.contextPolicy.handoffAtContextTokens ?? 0)}
          inputMode="numeric"
          onChange={(event) => onDraft(CONTEXT_POLICY_KEY(groupId), event.target.value)}
        />
      </label>
      <p>
        {t("budget.ledger", { used: view.ledger.used.tokens, committed: view.ledger.committedRemaining.tokens, reserve: view.ledger.explicitUnallocatedReserve.tokens })}
        {view.ledger.budgetDeficit.tokens > 0 ? t("budget.deficit", { deficit: view.ledger.budgetDeficit.tokens }) : ""}
        {view.ledger.usageUnknown ? t("budget.usageUnknown") : ""}
      </p>
      <button type="button" disabled={!editable || editedOperations(view, drafts).length === 0} onClick={submitEdit}>{t("budget.save")}</button>
      {estimator !== null && <button type="button" onClick={submitEstimate}>{t("budget.reestimate")}</button>}
      {editable && <GroupIntegrationConfirm view={view} suggestedTarget={props.suggestedTarget ?? null} onCommand={onCommand} />}
      {editable && shownSelectionsHash === null && <p role="note">{t("budget.confirmWaits")}</p>}
      <button type="button" disabled={shownSelectionsHash === null || integrationBlocked} onClick={submitConfirm}>{t("budget.confirm")}</button>
    </section>
  );
}
