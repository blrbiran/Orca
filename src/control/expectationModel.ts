import { z } from "zod";
import { flowBlockOf } from "../flow/groups.js";
import { ControlError } from "./errors.js";
import { isFollowupG } from "./modelVersion.js";
import { effectivePlanCanonicalJson, estimateIsStale, readArchivedPlan, readEstimateRecord } from "./queries.js";
import { idSchema, safeInteger } from "./schema.js";
import type { ControlStore } from "./store.js";

/**
 * Tester follow-up G spec §2 (budget) and §10.3: in a group created under the follow-up G model, a task's token amount
 * is an expectation, the group's token limit is the one hard line, and a person may make one task's amount a hard cap
 * with a separate switch. A flow run's hidden child keeps the rules it had (plan D5: its run pool is a separate design).
 */
export const EXPECTATION_FLOOR_TOKENS = 1_000_000;
/** Spec §2.5: the pause line is this many times the expectation (bounded by half the group limit in a finite group). */
export const PAUSE_LINE_MULTIPLE = 10;

export function expectationModelApplies(group: unknown): boolean {
  return isFollowupG(group) && flowBlockOf(group)?.role !== "child";
}

export const tokenIntentSchema = z.object({
  tokens: safeInteger.positive(),
  hard: z.boolean(),
  provenance: z.enum(["complex-1m-default", "model", "human", "system"]),
  estimateId: idSchema.nullable(),
}).strict();
export type TokenIntent = z.infer<typeof tokenIntentSchema>;

/**
 * Spec §2.2 / §10.3: what a task-work token amount becomes in an expectation-model group. Null clears it. Without the hard
 * switch it is an expectation, floored at 1M (#266); with it, a cap of exactly the value (no floor, no pause line).
 */
export function writeTokenIntent(value: number | null, hard: boolean, source: { provenance: TokenIntent["provenance"]; estimateId: string | null }): TokenIntent | null {
  if (value === null) {
    if (hard) throw new ControlError("hard-cap-needs-tokens");
    return null;
  }
  if (hard && value <= 0) throw new ControlError("hard-cap-needs-tokens");
  return { tokens: hard ? value : Math.max(EXPECTATION_FLOOR_TOKENS, value), hard, provenance: source.provenance, estimateId: source.estimateId };
}

/** The intent stored on a task's work item body, or null. A body that does not parse is refused by name. */
export function tokenIntentOf(work: unknown): TokenIntent | null {
  const raw = (work as { tokenIntent?: unknown } | null)?.tokenIntent;
  if (raw === undefined || raw === null) return null;
  const parsed = tokenIntentSchema.safeParse(raw);
  if (!parsed.success) throw new ControlError("recovery-blocked", "token-intent-invalid");
  return parsed.data;
}

/** A person's hard cap for the task (§10.3), or null. */
export function hardCapOf(work: unknown): number | null {
  const intent = tokenIntentOf(work);
  return intent !== null && intent.hard ? intent.tokens : null;
}

export interface TaskExpectation { tokens: number; estimateId: string | null; source: "intent" | "estimate" }

/**
 * Spec §2.2: a task's expectation -- the amount a person set (unless it is a hard cap, which has none), else the task's
 * work tokens in the newest ready estimate for the group's plan, floored at 1M. A stale estimate is no expectation (§2.5:
 * "a task with no (or a stale) expectation has no pause line").
 */
export function taskExpectation(store: ControlStore, groupId: string, work: { taskId: string | null }): TaskExpectation | null {
  const intent = tokenIntentOf(work);
  if (intent !== null) return intent.hard ? null : { tokens: intent.tokens, estimateId: intent.estimateId, source: "intent" };
  if (work.taskId === null) return null;
  const planHash = readArchivedPlan(store, groupId).planHash;
  let newest: { estimateId: string; version: number; tokens: number } | null = null;
  let current: string | null = null;
  for (const row of store.db.prepare("SELECT id FROM estimates WHERE group_id=? AND state='ready'").all(groupId)) {
    const estimate = readEstimateRecord(store, groupId, String(row.id));
    if (estimate.output === null || estimate.output.planHash !== planHash) continue;
    current ??= effectivePlanCanonicalJson(store, groupId);
    if (estimateIsStale(estimate, current)) continue;
    const task = estimate.output.tasks.find(t => t.taskId === work.taskId);
    if (task === undefined) continue;
    if (newest === null || estimate.estimateVersion > newest.version) newest = { estimateId: estimate.estimateId, version: estimate.estimateVersion, tokens: task.work.tokens };
  }
  return newest === null ? null : { tokens: Math.max(EXPECTATION_FLOOR_TOKENS, newest.tokens), estimateId: newest.estimateId, source: "estimate" };
}

/**
 * Spec §2.5, the formula the spec left to the builder (plan O5). `multiple` is 1 until the first "continue"; the k-th line
 * (k > 1) is decided when the task had used `taskUsedAtDecision` and the group `groupUsedAtDecision`:
 * - k = 1: L === null ? 10E : min(10E, floor(L / 2));
 * - k > 1: L === null ? 10kE : min(10kE, u + floor(max(0, L - G) / 2)).
 * In words: each continue moves the line to the next multiple of 10x the expectation, but never lets the task take more
 * than half of what the group had left when the person decided.
 */
export function pauseLineFor(input: { expectationTokens: number; multiple: number; groupLimitTokens: number | null; taskUsedAtDecision: number; groupUsedAtDecision: number }): number {
  const { expectationTokens: e, multiple: k, groupLimitTokens: l } = input;
  const line = PAUSE_LINE_MULTIPLE * k * e;
  if (l === null) return line;
  if (k <= 1) return Math.min(line, Math.floor(l / 2));
  return Math.min(line, input.taskUsedAtDecision + Math.floor(Math.max(0, l - input.groupUsedAtDecision) / 2));
}
