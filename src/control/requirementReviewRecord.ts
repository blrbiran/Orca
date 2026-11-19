/**
 * Tester follow-up G spec §3 (human: 「没有统一标准，一般会对照需求看具体实现的结果」): the requirement review record kept on
 * the group body as `requirementReview`, and the predicates the done gate (groupEdges.ts prerequisiteDone) and the views
 * read. Body reads only (no store module beyond the type), so modules on the driver's import cycle can read it without the
 * review runner (requirementReview.ts) -- as groupAcceptanceRecord.ts is kept.
 */
import { isFollowupG } from "./modelVersion.js";
import type { ControlStore } from "./store.js";

export type CriterionVerdictKind = "met" | "not-met" | "cannot-judge";
/**
 * Tester #343 (spec 2026-11-17 S5): who can meet a criterion -- `work` (changing repository files), `plan` (the accepted
 * plan itself) or `person` (only the person can decide). The reviewer classifies; code routes on it (Rule 5).
 */
export type FixableBy = "work" | "plan" | "person";
export interface CriterionVerdict {
  id: string; verdict: CriterionVerdictKind; evidence: Array<{ path: string; line: number | null }>; missing: string | null;
  /** Required in every new answer; absent in a round recorded before S5. */
  fixableBy?: FixableBy;
}
export type ReviewRoundResult = "passed" | "not-met" | "cannot-judge" | "invalid" | "failed" | "unfunded";
export interface ReviewRound {
  roundNo: number; tip: string; runId: string | null; at: number; result: ReviewRoundResult; criteria: CriterionVerdict[]; summary: string;
  /** The person's or agent's note a re-run carried into this round's prompt. */
  note?: string;
  /** The fix task this round opened, and who opened it (`auto`, or the principal of a hand fix). */
  fixTaskId?: string; fixBy?: string;
  /** Tester #340: the conflict the reviewer reported (a not-met criterion vs. a required check and the person's restriction). */
  checkConflict?: { criterionId: string; requiredCheck: string; because: string };
  /** Tester #343: the not-met criteria no automatic fix covers (fixableBy `plan` or `person`), left to the person. */
  leftToPerson?: string[];
  /**
   * Tester #377: the not-met criteria code judged red only because the base was already red (requirementReview.ts
   * relativePasses) -- not counted as not-met. Absent in a round with none, and in every round recorded before.
   */
  relativePass?: RelativePass[];
}
/** Tester #377: a criterion about the full suite, red on the reviewed tip with an exit the group's base gave too. */
export interface RelativePass { criterionId: string; command: string; tipExits: string[]; baseExits: string[] }
/**
 * #337 (spec 2026-11-19 §5.1, human: 「不要卡在」): `noted` -- a folder or multi-directory group's review that did not pass,
 * after its automatic fix rounds. It keeps the `why`, is shown as a note (reviewNote), and satisfies the done gate.
 */
export type ReviewState = "pending" | "reviewing" | "passed" | "fixing" | "not-passed" | "accepted" | "not-run" | "noted";
export type ReviewWhy = "multi-repo" | "dir" | "unfunded" | "invalid" | "cannot-judge" | "rounds-exhausted" | "failed" | "check-conflict" | "not-fixable-by-work";
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

// #337 §5.1, §9: `noted` ends a folder or multi-directory group's review; `not-run` stays satisfied for the records before it.
const SATISFIED: ReadonlySet<ReviewState> = new Set(["passed", "accepted", "not-run", "noted"]);

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

/** #337 §5.5: the note a `noted` review shows (a Problems row that is not "needs you"); null otherwise. reviewProblem is separate. */
export function reviewNote(review: RequirementReview | null): string | null {
  return review?.state === "noted" ? `requirement-review-noted:${review.why ?? "?"}` : null;
}
