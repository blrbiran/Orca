import { recordActivity } from "./activity.js";
import { listFlaggedDecisions, ratifyFlag, type FlaggedDecisionRow } from "./flaggedDecisions.js";
import { allowPendingDecision, listPendingDecisions } from "./pendingDecisions.js";
import type { PathPolicyMissV1 } from "./pathPolicyMisses.js";
import type { ControlStore } from "./store.js";

/**
 * Tester follow-up G §6.3 (#189, human 「本组里同类请示都自动放行」): a person or an orchestrating agent lets one request
 * through, or every request of the same kind in this group. The group body keeps the list (`allowances`), each with who,
 * how, when and from which request; a revoked one applies to nothing after it was revoked (what it let through stays).
 * Group-scoped only: nothing reads another group's list, nothing copies it (no project default).
 *
 * "Same kind" (§10.4): a path request grants exactly the paths the request named (equality on repoKey and path, never a
 * derived parent or pattern); a decision request's kind is the tuple below, equal on every field (a null matches only null).
 */
export type AllowanceRequest =
  | { type: "path"; paths: Array<{ repoKey: string | null; path: string }> }
  | { type: "pending-decision"; kind: string | null; scope: string | null }
  | { type: "flagged-decision"; source: string; kind: string | null; scope: string | null };

export interface GroupAllowance {
  allowanceId: string;
  request: AllowanceRequest;
  from: { runId: string } | { pendingId: string } | { decisionId: string };
  by: string; via: string; principal: string | null; commandId: string; at: number;
  revoked?: { by: string; via: string; commandId: string; at: number };
}

export function allowancesOf(body: unknown): GroupAllowance[] {
  const value = (body as { allowances?: unknown } | null)?.allowances;
  return Array.isArray(value) ? value as GroupAllowance[] : [];
}

/** The allowances in force at `at`: not revoked, or revoked later than `at`. */
export function activeAllowances(body: unknown, at: number): GroupAllowance[] {
  return allowancesOf(body).filter((allowance) => allowance.revoked === undefined || allowance.revoked.at > at);
}

const text = (value: unknown): string | null => typeof value === "string" ? value : null;

/** A pending (refused) decision's kind: the reported entry's own `kind` and `scope`. */
export function pendingRequestKey(entry: unknown): Extract<AllowanceRequest, { type: "pending-decision" }> {
  const reported = (entry ?? {}) as { kind?: unknown; scope?: unknown };
  return { type: "pending-decision", kind: text(reported.kind), scope: text(reported.scope) };
}

export function flaggedRequestKey(row: FlaggedDecisionRow): Extract<AllowanceRequest, { type: "flagged-decision" }> {
  return { type: "flagged-decision", source: row.source, kind: row.kind, scope: row.scope };
}

export function sameDecisionKind(a: AllowanceRequest, b: AllowanceRequest): boolean {
  if (a.type === "path" || b.type === "path" || a.type !== b.type) return false;
  if (a.kind !== b.kind || a.scope !== b.scope) return false;
  return a.type === "pending-decision" || a.source === (b as { source: string }).source;
}

/** The path allowances that together cover every miss (exact repoKey and path), or null when any miss is uncovered. */
export function pathsCovered(allowances: readonly GroupAllowance[], misses: readonly PathPolicyMissV1[]): GroupAllowance[] | null {
  if (misses.length === 0) return null;
  const covering = new Set<GroupAllowance>();
  for (const miss of misses) {
    const found = allowances.find((allowance) => allowance.request.type === "path"
      && allowance.request.paths.some((path) => path.repoKey === miss.repoKey && path.path === miss.path));
    if (found === undefined) return null;
    covering.add(found);
  }
  return [...covering];
}

/**
 * Inside the caller's transaction: every open pending decision and flag of this group that an active decision allowance
 * covers is settled -- a pending one as allowed (no ledger line: approve needs a person's undo.how, plan A6), a flag as
 * ratified by the allowance -- with one `allowance` activity row each.
 */
export function applyDecisionAllowances(store: ControlStore, groupId: string): Array<{ allowanceId: string; pendingId?: string; decisionId?: string }> {
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
  if (row === undefined) return [];
  const now = store.now();
  const allowances = activeAllowances(JSON.parse(String(row.body)), now).filter((allowance) => allowance.request.type !== "path");
  if (allowances.length === 0) return [];
  const applied: Array<{ allowanceId: string; pendingId?: string; decisionId?: string }> = [];
  for (const pending of listPendingDecisions(store, groupId)) {
    if (pending.state !== "pending") continue;
    const key = pendingRequestKey(pending.entry.entry);
    const allowance = allowances.find((candidate) => sameDecisionKind(candidate.request, key));
    if (allowance === undefined) continue;
    allowPendingDecision(store, pending.pendingId, { by: `allowance:${allowance.allowanceId}`, via: "panel", at: now, commandId: allowance.commandId, allowanceId: allowance.allowanceId });
    recordActivity(store, { groupId, runId: pending.runId, kind: "allowance", body: { action: "applied", allowanceId: allowance.allowanceId, pendingId: pending.pendingId } });
    applied.push({ allowanceId: allowance.allowanceId, pendingId: pending.pendingId });
  }
  for (const flag of listFlaggedDecisions(store, groupId)) {
    if (flag.state !== "flagged") continue;
    const allowance = allowances.find((candidate) => sameDecisionKind(candidate.request, flaggedRequestKey(flag)));
    if (allowance === undefined) continue;
    ratifyFlag(store, groupId, flag.decisionId, { actorId: `allowance:${allowance.allowanceId}`, via: "panel", commandId: allowance.commandId, at: new Date(now).toISOString(), note: `allowed by ${allowance.allowanceId}` });
    recordActivity(store, { groupId, runId: flag.runId, kind: "allowance", body: { action: "applied", allowanceId: allowance.allowanceId, decisionId: flag.decisionId } });
    applied.push({ allowanceId: allowance.allowanceId, decisionId: flag.decisionId });
  }
  return applied;
}
