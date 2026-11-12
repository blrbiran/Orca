/**
 * Tester follow-up G spec §3 (human: 「没有统一标准，一般会对照需求看具体实现的结果」): the requirement review record kept on
 * the group body as `requirementReview`, and the predicates the done gate (groupEdges.ts prerequisiteDone) and the views
 * read. Body reads only (no store module beyond the type), so modules on the driver's import cycle can read it without the
 * review runner (requirementReview.ts) -- as groupAcceptanceRecord.ts is kept.
 */
import { isFollowupG } from "./modelVersion.js";
import type { ControlStore } from "./store.js";

export type CriterionVerdictKind = "met" | "not-met" | "cannot-judge";
export interface CriterionVerdict { id: string; verdict: CriterionVerdictKind; evidence: Array<{ path: string; line: number | null }>; missing: string | null }
export type ReviewRoundResult = "passed" | "not-met" | "cannot-judge" | "invalid" | "failed" | "unfunded";
export interface ReviewRound {
  roundNo: number; tip: string; runId: string | null; at: number; result: ReviewRoundResult; criteria: CriterionVerdict[]; summary: string;
  /** The person's or agent's note a re-run carried into this round's prompt. */
  note?: string;
  /** The fix task this round opened, and who opened it (`auto`, or the principal of a hand fix). */
  fixTaskId?: string; fixBy?: string;
}
export type ReviewState = "pending" | "reviewing" | "passed" | "fixing" | "not-passed" | "accepted" | "not-run";
export type ReviewWhy = "multi-repo" | "dir" | "unfunded" | "invalid" | "cannot-judge" | "rounds-exhausted" | "failed";
export interface RequirementReview {
  state: ReviewState; why?: ReviewWhy; rounds: ReviewRound[]; autoFixRounds: number;
  accepted?: { by: string; note: string; at: number };
  rerun?: { by: string; note: string; at: number };
}

/** The group body's review record; null when no review was ever recorded. */
export function reviewOf(body: unknown): RequirementReview | null {
  const value = (body as { requirementReview?: unknown } | null)?.requirementReview;
  return value === undefined || value === null || typeof value !== "object" ? null : value as RequirementReview;
}

/**
 * §3.1, §3.8, §10.5: a group created from a requirement under follow-up G is reviewed; a group created before the release,
 * an imported plan or a flow, a flow run's hidden child and a debug group Orca opened itself are not.
 */
export function reviewRequired(_store: Pick<ControlStore, "db">, _groupId: string, body: unknown): boolean {
  const b = (body ?? {}) as { requirement?: unknown; flow?: { role?: unknown } | null; systemDebug?: unknown; debug?: unknown };
  if (b.requirement === undefined || !isFollowupG(body)) return false;
  return b.flow?.role !== "child" && b.systemDebug === undefined && b.debug === undefined;
}

const SATISFIED: ReadonlySet<ReviewState> = new Set(["passed", "accepted", "not-run"]);

/** §3.6: the done gate -- a reviewed group is done only when its review passed, a person or agent accepted it, or it cannot run. */
export function reviewSatisfied(store: Pick<ControlStore, "db">, groupId: string, body: unknown): boolean {
  if (!reviewRequired(store, groupId, body)) return true;
  const review = reviewOf(body);
  return review !== null && SATISFIED.has(review.state);
}

/** §3.5: the problem a review that did not pass shows (Problems, Board, `group show`); null otherwise. */
export function reviewProblem(review: RequirementReview | null): string | null {
  return review?.state === "not-passed" ? `requirement-review-not-passed:${review.why ?? "?"}` : null;
}
