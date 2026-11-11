/**
 * Single-call estimate spec §7, loop plans W5 (human ruling H6): which commands apply an estimate's suggestions to a
 * proposal. One pure transform, shared by the panel's budget editor (web/src/BudgetEditor.tsx: "use N", "Apply row",
 * "Apply all") and the CLI's `orca group apply-estimate` (issue #156, session 3cfc2e73), so both send the same commands.
 *
 * Moved verbatim from web/src/BudgetEditor.tsx. web/ imports this file, and task 8 ruling K2 says web/ cannot import
 * src/ because a browser bundle cannot ship the server's module graph. So this module imports nothing (types
 * included), and tests/control/budgetSuggestionsShared.test.ts fails if an import appears. Its types are structural:
 * the panel's GroupViewV1 and the server's group view both fit them.
 */
export type SuggestionDimension = "tokens" | "activeMs" | "attempts" | "sessions";
export const DIMENSIONS: SuggestionDimension[] = ["tokens", "activeMs", "attempts", "sessions"];

export type SuggestionTarget =
  | { scope: "task"; taskId: string; allocation: "work" | "handoff"; dimension: SuggestionDimension }
  | { scope: "goal-review"; dimension: SuggestionDimension };
type FullAmount = Record<SuggestionDimension, number>;
export interface SuggestionOutput { planHash: string; tasks: ReadonlyArray<{ taskId: string; work: FullAmount; handoff: FullAmount }>; goalReviewReserve: FullAmount }
type Allocation = { ownerKind: string; ownerId: string; bucket: string; amount: { tokens: number | null; activeMs: number; attempts: number; sessions: number } };
type LoopPlan = { planId: string; loopVersion: number; inputs: unknown; skills?: unknown };
export interface SuggestionView {
  summary: { groupId: string; commandRevision: number };
  plan: { planHash: string };
  // Budget defaults spec 2026-11-11 §7 item 3: the group's token limit decides whether an estimate's task work is a ceiling.
  ledger: { groupLimit: { tokens: number | null } };
  proposal: { state: string; proposalVersion: number };
  allocations: ReadonlyArray<Allocation>;
  workItems: ReadonlyArray<{ taskId: string; loopPlan?: LoopPlan | null }>;
  estimates: ReadonlyArray<{ estimateId: string; estimateVersion: number; state: string; output: SuggestionOutput | null; stale?: boolean }>;
}
export type SuggestedOperation = { target: SuggestionTarget; value: number; provenance: "model"; estimateId: string };
type LoopWorkDimension = "tokens" | "activeMs" | "attempts";
export type SuggestionAction =
  | { verb: "proposal-edit"; groupId: string; expectedRevision: number; payload: { baseProposalVersion: number; operations: SuggestedOperation[] } }
  | { verb: "set-task-loop"; groupId: string; taskId: string; expectedRevision: number; payload: {
    baseLoopVersion: number; plan: string; inputs: unknown; work: { tokens: number | null; activeMs: number; attempts: number };
    workProvenance: Partial<Record<LoopWorkDimension, { provenance: "model"; estimateId: string }>>; skills?: unknown;
  } };

export function budgetFieldKey(groupId: string, target: SuggestionTarget): string {
  return target.scope === "task"
    ? `${groupId}:task:${target.taskId}:${target.allocation}:${target.dimension}`
    : `${groupId}:goal-review:${target.dimension}`;
}

/** Loop plans spec §4.3 (C6): a loop task's work budget is changed only through set-task-loop (its plan card, or a suggestion). */
export const loopOwned = (item: { loopPlan?: LoopPlan | null }): boolean => item.loopPlan !== undefined && item.loopPlan !== null;

export function targetOf(view: SuggestionView, ownerId: string, bucket: string, dimension: SuggestionDimension): SuggestionTarget | null {
  if (bucket === "review") return { scope: "goal-review", dimension };
  if (bucket !== "work" && bucket !== "handoff") return null;
  const task = view.workItems.find((item) => item.taskId === ownerId);
  // Read-only here, so no edit and no suggestion ever sends proposal-edit for it (Drafter finding F14); its suggestions
  // go through set-task-loop instead (suggestedLoopActions).
  if (task !== undefined && bucket === "work" && loopOwned(task)) return null;
  return task ? { scope: "task", taskId: ownerId, allocation: bucket, dimension } : null;
}

/** Single-call estimate spec §7: what one "apply" control covers. */
export type SuggestionScope =
  | { kind: "field"; target: SuggestionTarget }
  | { kind: "row"; ownerKind: "task" | "goal-review"; ownerId: string; bucket: "work" | "handoff" | "review" }
  | { kind: "all" };

type OutputOf<V extends SuggestionView> = NonNullable<V["estimates"][number]["output"]>;

/**
 * The estimate that may advise this proposal, or null: the newest by version (the view lists estimates by id, drafter
 * finding F12), and only when it is ready, for this plan, and the proposal is still editable. Anything else and the
 * editor is exactly what it was before suggestions existed.
 */
export function adviceOf<V extends SuggestionView>(view: V): { estimateId: string; output: OutputOf<V>; stale: boolean } | null {
  if (view.proposal.state !== "editable") return null;
  let newest: V["estimates"][number] | null = null;
  for (const estimate of view.estimates) if (newest === null || estimate.estimateVersion > newest.estimateVersion) newest = estimate;
  if (newest === null || newest.state !== "ready" || newest.output === null || newest.output.planHash !== view.plan.planHash) return null;
  return { estimateId: newest.estimateId, output: newest.output as OutputOf<V>, stale: newest.stale === true };
}

/**
 * Budget defaults spec 2026-11-11 §7 items 1 and 3 (tester #224/#234/#238/#241/#162): in a group whose token limit is null
 * an estimate's task work (tokens, attempts, active time) is an expectation, not a ceiling, so it is never offered as one;
 * the server refuses it too (estimate-advisory-in-unlimited-group). Handoff and goal-review reserves are unaffected.
 */
export const estimateIsAdvisory = (view: { ledger: { groupLimit: { tokens: number | null } } }): boolean => view.ledger.groupLimit.tokens === null;
const ADVISORY_DIMENSIONS: ReadonlyArray<SuggestionDimension> = ["tokens", "activeMs", "attempts"];
const advisoryTaskWork = (view: SuggestionView, allocation: Allocation, dimension: SuggestionDimension): boolean =>
  estimateIsAdvisory(view) && allocation.ownerKind === "task" && allocation.bucket === "work" && ADVISORY_DIMENSIONS.includes(dimension);

/**
 * §7 item 4: how far a task's known usage is from its expectation, as a multiple to one decimal (3.2 = used 3.2× the
 * estimate); null when the usage is unknown or the expectation is 0.
 */
export function usedRatio(expected: { tokens: number; usedTokens: number | null }): number | null {
  if (expected.usedTokens === null || expected.tokens <= 0) return null;
  return Math.round((expected.usedTokens / expected.tokens) * 10) / 10;
}

function suggestedAmount(output: SuggestionOutput, allocation: Allocation): FullAmount | null {
  if (allocation.ownerKind === "goal-review" && allocation.bucket === "review") return output.goalReviewReserve;
  if (allocation.ownerKind !== "task" || (allocation.bucket !== "work" && allocation.bucket !== "handoff")) return null;
  return output.tasks.find((task) => task.taskId === allocation.ownerId)?.[allocation.bucket] ?? null;
}

/**
 * The only place that decides which suggestions a control sends (the editedOperations of the model's advice): each
 * field in `scope` whose suggested value differs from the proposal's, as provenance "model" with the estimate's id --
 * the exact number the server re-checks (verifyModelField). A field already at its suggestion sends nothing.
 */
export function suggestedOperations(view: SuggestionView, scope: SuggestionScope): SuggestedOperation[] {
  const advice = adviceOf(view);
  // W6: the server refuses a stale estimate's values (estimate-stale), so none is offered.
  if (advice === null || advice.stale) return [];
  const groupId = view.summary.groupId;
  const operations: SuggestedOperation[] = [];
  for (const allocation of view.allocations) {
    const suggested = suggestedAmount(advice.output, allocation);
    if (suggested === null) continue;
    if (scope.kind === "row" && (allocation.ownerKind !== scope.ownerKind || allocation.ownerId !== scope.ownerId || allocation.bucket !== scope.bucket)) continue;
    for (const dimension of DIMENSIONS) {
      const target = targetOf(view, allocation.ownerId, allocation.bucket, dimension);
      if (target === null) continue;
      if (scope.kind === "field" && budgetFieldKey(groupId, target) !== budgetFieldKey(groupId, scope.target)) continue;
      if (advisoryTaskWork(view, allocation, dimension)) continue;
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
export function suggestedLoopActions(view: SuggestionView, scope: SuggestionScope): SuggestionAction[] {
  const advice = adviceOf(view);
  if (advice === null || advice.stale) return [];
  const groupId = view.summary.groupId;
  const actions: SuggestionAction[] = [];
  for (const allocation of view.allocations) {
    if (allocation.ownerKind !== "task" || allocation.bucket !== "work") continue;
    const plan = view.workItems.find((item) => item.taskId === allocation.ownerId)?.loopPlan;
    if (plan === undefined || plan === null) continue;
    if (scope.kind === "row" && (scope.ownerKind !== "task" || scope.ownerId !== allocation.ownerId || scope.bucket !== "work")) continue;
    const suggested = suggestedAmount(advice.output, allocation);
    if (suggested === null) continue;
    const work = { tokens: allocation.amount.tokens, activeMs: allocation.amount.activeMs, attempts: allocation.amount.attempts };
    const workProvenance: Partial<Record<LoopWorkDimension, { provenance: "model"; estimateId: string }>> = {};
    for (const dimension of LOOP_WORK_DIMENSIONS) {
      if (scope.kind === "field" && budgetFieldKey(groupId, scope.target) !== budgetFieldKey(groupId, { scope: "task", taskId: allocation.ownerId, allocation: "work", dimension })) continue;
      if (advisoryTaskWork(view, allocation, dimension)) continue;
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
export function suggestionActions(view: SuggestionView, scope: SuggestionScope): SuggestionAction[] {
  const operations = suggestedOperations(view, scope);
  const edit: SuggestionAction[] = operations.length === 0 ? [] : [{
    verb: "proposal-edit", groupId: view.summary.groupId, expectedRevision: view.summary.commandRevision,
    payload: { baseProposalVersion: view.proposal.proposalVersion, operations },
  }];
  return [...edit, ...suggestedLoopActions(view, scope)];
}
