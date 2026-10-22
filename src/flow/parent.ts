/**
 * Flow engine spec §6.2-§6.3 (plan Task 10): the run's parent group. It has no plan and no tasks; it is confirmed once,
 * at start, by `orca-auto` with the run budget pool (`flow_runs.pool_tokens`) -- no estimate call (P4) -- and it
 * carries what every later act on the run is confirmed with:
 *
 * - `call`: the frozen profile and agent slot of the run's single calls (draft, review, ask candidates, the rerun
 *   proposal), which run on the parent and draw from the pool;
 * - `children`: the profiles and budget mode each hidden `work` child is confirmed with (a child copies the parent's).
 *
 * Its ledger fields (`used`, `reserved`, `budgetVersion`) are the ones usage booking moves for a single call on it; the
 * pool itself is the run's (pool.ts). The panel supplies the confirmation (`FlowDeps.confirmParent`); without one (a
 * criterion's fake ports) `confirmed.call` and `confirmed.children` are null and only the fake ports can serve the run.
 */
import type { FrozenSlot } from "../control/agentSelection.js";
import type { ControlStore } from "../control/store.js";
import { REQUIREMENT_LIMIT_DEFAULT } from "../control/requirementSchemas.js";
import type { BudgetAmount } from "../control/tokenPolicy.js";
import { flowBlockOf } from "./groups.js";

export interface ProfileBinding { profileId: string; profileHash: string }
export interface FlowParentConfirmation {
  /** The run's single calls: frozen at start, as a requirement's are at open. */
  call: { profile: ProfileBinding; agentSlot: FrozenSlot; maxOutputTokens: number } | null;
  /** What each `work` child is confirmed with by orca-auto. */
  children: {
    budgetMode: "soft" | "strict";
    profiles: { estimator: ProfileBinding | null; worker: ProfileBinding; handoff: ProfileBinding; goalReview: ProfileBinding };
    contextPolicy: { handoffAtContextTokens: number | null };
  } | null;
}
export interface FlowParentConfirmed extends FlowParentConfirmation { by: "orca-auto"; via: "orca"; commandId: string; at: number; poolTokens: number }

const zero = () => ({ tokens: 0, activeMs: 0, attempts: 0, sessions: 0 });

/** The deterministic command id of the parent's one confirmation. */
export const parentConfirmCommandId = (flowRunId: string): string => `orca-auto-confirm-${flowRunId}`;

/** §6.2-§6.3: the parent's body, confirmed once with the pool. */
export function parentGroupBody(input: {
  groupId: string; flowRunId: string; projectId: string | null; workspaceKind: string; vaultId: string | null; repoId: string | null;
  poolTokens: number; confirmation: FlowParentConfirmation; at: number; goal: string;
}): Record<string, unknown> {
  // The pool is the token limit; the other dimensions are a clarifying group's (the calls on the parent are its only runs).
  const limit: BudgetAmount = { ...REQUIREMENT_LIMIT_DEFAULT, tokens: input.poolTokens };
  const confirmed: FlowParentConfirmed = {
    by: "orca-auto", via: "orca", commandId: parentConfirmCommandId(input.flowRunId), at: input.at, poolTokens: input.poolTokens, ...input.confirmation,
  };
  return {
    groupId: input.groupId, status: "flow", projectKey: input.repoId, goal: input.goal, successConditions: [], budgetMode: input.confirmation.children?.budgetMode ?? "soft",
    limit, reviewReserve: zero(), deadlineAt: null, revision: 0, commandRevision: 0, graphVersion: 1, stopped: false,
    used: zero(), reserved: zero(), reviewRemaining: zero(), budgetVersion: 1,
    ledger: { groupLimit: limit, used: zero(), committedRemaining: zero(), explicitUnallocatedReserve: limit, budgetDeficit: zero(), usageUnknown: false },
    flow: { role: "parent", flowRunId: input.flowRunId, projectId: input.projectId, workspaceKind: input.workspaceKind, vaultId: input.vaultId },
    confirmed,
  };
}

/** The parent's confirmation; null when the group is not a confirmed flow parent. */
export function readParentConfirmation(store: ControlStore, groupId: string): FlowParentConfirmed | null {
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
  if (row === undefined) return null;
  const body = JSON.parse(String(row.body)) as { confirmed?: FlowParentConfirmed };
  return flowBlockOf(body)?.role === "parent" && body.confirmed !== undefined ? body.confirmed : null;
}
