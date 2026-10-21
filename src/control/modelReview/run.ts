import type { PartialSelection } from "../agentSelection.js";
import { readAgentPreferences } from "../agentPreferences.js";
import { isGroupArchived } from "../archivedMark.js";
import type { RangeGroup } from "../checks/range.js";
import { listFlaggedDecisions } from "../flaggedDecisions.js";
import { readArchivedPlan, readBudgetProposal } from "../queries.js";
import type { ControlStore } from "../store.js";
import { taskContractSchema } from "../../scheduler/planFile.js";
import { intersect } from "../../scheduler/pathTrie.js";
import { normalizeClaim } from "../../scheduler/writeSet.js";
import type { ReviewInputs } from "./inputs.js";
import { REVIEW_WRITE_SET } from "./plan.js";

/**
 * Checks spec 2026-10-22 §6.1-§6.5: what code decides around a model review's run (Rule 5) -- whose profiles confirm it,
 * whether the repository's own denylist allows its findings file, what it is given to read, and which one end its group
 * reached. The model only finds; every rule here is code.
 */

/** §6.1: a review not admitted (started) within this long of opening is ended `not-admitted` and archived. */
export const MODEL_REVIEW_ADMIT_MS = 24 * 60 * 60 * 1000;

const groupBody = (store: ControlStore, groupId: string): Record<string, unknown> | null => {
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
  if (row === undefined) return null;
  try { return JSON.parse(String(row.body)) as Record<string, unknown>; } catch { return null; }
};

/**
 * §6.1: the newest confirmed group of the repository by confirm time (its orchestration row), not archived; system
 * groups only when no other exists. Among `among` only, when given (a finding's involved groups).
 */
export function newestConfirmedGroup(store: ControlStore, repoId: string, among?: readonly string[]): string | null {
  const rows = store.db.prepare("SELECT g.id AS id, g.body AS body, o.body AS orchestration FROM groups g JOIN group_orchestration o ON o.group_id=g.id ORDER BY g.rowid").all();
  const confirmed: Array<{ id: string; at: number; system: boolean }> = [];
  for (const row of rows) {
    const id = String(row.id);
    if (among !== undefined && !among.includes(id)) continue;
    let body: Record<string, unknown>, at: number;
    try { body = JSON.parse(String(row.body)) as Record<string, unknown>; at = Number((JSON.parse(String(row.orchestration)) as { confirmedAt?: unknown }).confirmedAt); } catch { continue; }
    if ((body.plan as { repoId?: unknown } | undefined)?.repoId !== repoId || isGroupArchived(store, id) || !Number.isFinite(at)) continue;
    try { if (readBudgetProposal(store, id).state !== "confirmed") continue; } catch { continue; }
    confirmed.push({ id, at, system: Object.hasOwn(body, "systemDebug") || Object.hasOwn(body, "debug") });
  }
  const pick = (list: typeof confirmed) => list.reduce<(typeof confirmed)[number] | null>((best, entry) => best === null || entry.at >= best.at ? entry : best, null)?.id ?? null;
  return pick(confirmed.filter((entry) => !entry.system)) ?? pick(confirmed);
}

/**
 * §6.1 Agent: the `review` slot of the person who confirmed the profile group; absent ⇒ that person's `defaultAgent`.
 * The review is confirmed as orca-auto, which has no preferences of its own, so the slot is carried as the plan's agent.
 */
export function reviewAgentOf(store: ControlStore, profileGroupId: string): PartialSelection | undefined {
  for (const row of store.db.prepare("SELECT result FROM commands WHERE group_id=? ORDER BY rowid DESC").all(profileGroupId)) {
    let result: { verb?: unknown; actorId?: unknown; error?: unknown };
    try { result = JSON.parse(String(row.result)) as typeof result; } catch { continue; }
    if (result.verb !== "confirm" || result.error !== undefined || typeof result.actorId !== "string") continue;
    try {
      const prefs = readAgentPreferences(store, result.actorId).preferences;
      return prefs.review ?? (typeof prefs.defaultAgent === "string" ? { agent: prefs.defaultAgent } : undefined);
    } catch { return undefined; }
  }
  return undefined;
}

/** §6.5: a finding's fix runs where its newest involved group's work ran (a frozen task agent), as other system debug groups. */
export function groupWorkerAgent(store: ControlStore, groupId: string): PartialSelection | undefined {
  for (const row of store.db.prepare("SELECT body FROM work_items WHERE group_id=? ORDER BY rowid").all(groupId)) {
    const agent = (JSON.parse(String(row.body)) as { agent?: { agent?: unknown; model?: unknown } }).agent;
    if (typeof agent?.agent === "string" && typeof agent.model === "string") return { agent: agent.agent, model: agent.model };
  }
  return undefined;
}

type Contract = ReturnType<typeof taskContractSchema.parse>;
const contractsOf = (store: ControlStore, groupId: string): Contract[] => {
  try { return readArchivedPlan(store, groupId).plan.tasks.map((task) => taskContractSchema.parse(JSON.parse(task.originalContractCanonicalJson))); } catch { return []; }
};

/** §6.1 step 1 (Rule 16): the union of the range groups' contract denylists. */
export function rangeDenylist(store: ControlStore, groups: readonly RangeGroup[]): string[] {
  return [...new Set(groups.flatMap((group) => contractsOf(store, group.groupId).flatMap((contract) => contract.safetyPolicy.denylistPaths)))].sort();
}

/** Whether the review's write set meets the denylist (any overlap denies). */
export function reviewPathDenied(denylist: readonly string[]): boolean {
  if (denylist.length === 0) return false;
  return intersect(REVIEW_WRITE_SET.map(normalizeClaim), denylist.map(normalizeClaim)).length > 0;
}

/** §6.2 items 2-4, by code from the store (bounded later by the head rule in writeReviewInputs). */
export function reviewInputsOf(store: ControlStore, range: { target: string; from: string; to: string }, groups: readonly RangeGroup[], diffStat: (group: RangeGroup) => string, instruction: string): ReviewInputs {
  const requirements: Record<string, string> = {}, decisions: Record<string, unknown[]> = {};
  const conflicts: unknown[] = [];
  for (const group of groups) {
    const body = groupBody(store, group.groupId);
    const requirement = (body?.requirement as { document?: unknown } | undefined)?.document;
    requirements[group.groupId] = typeof requirement === "string" ? requirement
      : [`goal: ${String(body?.goal ?? "")}`, ...contractsOf(store, group.groupId).map((contract) => `task ${contract.objective.taskId}: ${contract.objective.goal}`)].join("\n");
    const flags = listFlaggedDecisions(store, group.groupId);
    // The decision ledger lines themselves landed with the group (`.decisions/**` at the head); the flags are Orca's.
    decisions[group.groupId] = flags.filter((flag) => flag.source !== "integration-conflict" && flag.source !== "reconcile").map((flag) => ({ id: flag.decisionId, source: flag.source, state: flag.state, reason: flag.reason, evidence: flag.evidence }));
    for (const flag of flags) if (flag.source === "integration-conflict" || flag.source === "reconcile") conflicts.push({ groupId: group.groupId, id: flag.decisionId, source: flag.source, reason: flag.reason, evidence: flag.evidence });
  }
  return {
    range: { ...range, groups: groups.map((group) => ({ groupId: group.groupId, goal: String(groupBody(store, group.groupId)?.goal ?? ""), integratedCommit: group.integratedCommit, paths: group.paths, diffStat: diffStat(group) })) },
    requirements, decisions, conflicts, instruction,
  };
}

/** A run's drive facts the end mapping reads (driveRecord.ts). */
export interface ReviewRunFacts {
  state: string; outcome: string | null; blockedReason: string | null; landedCommit: string | null; base: string | null;
  failureCause: string | null; budgetSnapshot: { attemptsRemaining: number; timeRemainingMs: number; tokenBudgetRemaining: number | null } | null;
}

/**
 * §6.1: a run that ended without success, to exactly one errored detail. A terminal whose snapshot shows nothing left of
 * a dimension is `budget: <dimension>` (the outcome `exhausted` alone is not enough); `blocked_waiting_human` is its own;
 * an attempt Orca refused for writing outside its write set is `not-read-only`; any other is `run-failed:<cause|outcome>`.
 */
export function failedRunDetail(run: ReviewRunFacts): string {
  if (run.blockedReason?.startsWith("out-of-bounds:") === true) return "not-read-only";
  const snapshot = run.budgetSnapshot;
  if (snapshot !== null) {
    if (snapshot.tokenBudgetRemaining === 0) return "budget: tokens";
    if (snapshot.attemptsRemaining === 0) return "budget: attempts";
    if (snapshot.timeRemainingMs === 0) return "budget: time";
  }
  if (run.outcome === "blocked_waiting_human") return "blocked-waiting-human";
  return `run-failed:${run.failureCause ?? run.outcome ?? run.blockedReason ?? "unknown"}`;
}
