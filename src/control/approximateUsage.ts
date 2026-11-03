/**
 * Spec 2026-11-03 soft-mode approximate usage (human ruling, session 43913afc: 「同意。我们之前的很多裁定在新的语义下可能有一些
 * 过期了，一些需要、可以修改。」): a single call in a group with no token limit whose usage the tool did not report is not
 * blocked for a person to settle. Its observed floor (ccloop's `usageLowerBound`, a total; none ⇒ 0) is booked as ordinary usage --
 * moved from the group's `reserved` to `used`, into the run's `cumulative`, with `remaining = max(grant - cumulative, 0)`
 * kept -- the run is marked `usageApproximate`, and its purpose completes as a known-usage call does.
 * Flow calls are out: their pool is finite (flow call settlement spec D1 (a)). Code only (Rule 5).
 */
import { recordActivity } from "./activity.js";
import { readRun, saveRun, syncWebBudget, type RunRecord } from "./budget.js";
import { ControlError } from "./errors.js";
import { readGroup, saveGroup } from "./queries.js";
import type { ControlStore } from "./store.js";
import { bookSettledUsage } from "./usageLedger.js";
import { isFlowCallRun } from "../flow/calls.js";

export interface UsageApproximate { floorTokens: number | null; reason: string; at: number }

/** §2: the group has no token limit, and the run is not a flow call. */
export function approximateUsageApplies(store: ControlStore, run: { groupId: string }): boolean {
  if (isFlowCallRun(run)) return false;
  const limit = (readGroup(store, run.groupId) as { limit?: { tokens?: number | null } }).limit;
  return limit !== undefined && limit.tokens === null;
}

/** §2 steps 1-4, inside the caller's transaction, before the purpose's own completion. */
export function bookApproximateFloorInTransaction(store: ControlStore, runId: string, input: { floorTokens: number | null; reason: string; at: number }): void {
  const run = readRun(store, runId) as RunRecord & { usageApproximate?: UsageApproximate; phase?: string; purpose?: string };
  if (!run.unknown.work && !run.unknown.handoff) throw new ControlError("run-usage-not-unknown");
  const group = readGroup(store, run.groupId);
  const floor = input.floorTokens ?? 0;
  if (!Number.isSafeInteger(floor) || floor < 0) throw new ControlError("recovery-blocked", `approximate-floor:${floor}`);
  const work = run.cumulative.work, grant = run.grant.work;
  // Review (session 43913afc) m3: ccloop's floor is the call's observed total, so only what it adds to the usage already
  // booked for the run is booked now (never counted twice).
  const tokens = Math.max(floor - work.tokens, 0);
  work.tokens += tokens;
  const held = run.remaining.work.tokens ?? 0;
  run.remaining.work = { ...run.remaining.work, tokens: grant.tokens === null ? null : Math.max(grant.tokens - work.tokens, 0) } as never;
  group.used = { ...group.used, tokens: group.used.tokens + tokens };
  group.reserved = { ...group.reserved, tokens: Math.max(group.reserved.tokens - Math.min(tokens, held), 0) };
  run.unknown = { work: false, handoff: false };
  run.usageApproximate = { floorTokens: input.floorTokens, reason: input.reason, at: input.at };
  bookSettledUsage(store, { run, groupBody: group as unknown as Record<string, unknown>, bucket: "work", tokens, appliedAt: input.at });
  saveRun(store, run);
  syncWebBudget(store, group, run);
  if (group.budgetVersion === Number.MAX_SAFE_INTEGER) throw new ControlError("numeric-overflow");
  group.budgetVersion += 1;
  saveGroup(store, group);
  recordActivity(store, { groupId: run.groupId, taskId: null, runId, kind: "usage-settled",
    body: { method: "approximate-floor", floorTokens: input.floorTokens, reason: input.reason, principal: "orca-auto", at: input.at } });
}
