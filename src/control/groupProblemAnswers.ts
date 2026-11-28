/**
 * Tester #359 review (M2): the commands that answer a group-level problem, in the order they are offered. One place for the
 * summary's `groupProblem.next` (controlViews.ts) and the CLI's `next:` / `or:` lines (commands/domains/verbs.ts), so the two
 * cannot drift. Commands only; each reader adds its own words around them.
 */

/** Tester #343: a not-met criterion no automatic fix covers, with who can meet it (`plan`, else a person). */
export interface LeftCriterion { id: string; by: string }

/** Tester #343: the last round's criteria left to a person, each with its `fixableBy` (a person when unrecorded). */
export function leftToPerson(last: { leftToPerson?: string[]; criteria: ReadonlyArray<{ id: string; fixableBy?: string }> } | undefined): LeftCriterion[] {
  return (last?.leftToPerson ?? []).map((id) => ({ id, by: last!.criteria.find((c) => c.id === id)?.fixableBy ?? "person" }));
}

/**
 * Follow-up G §3.5: a review that did not pass -- fix, rerun, accept. Tester #343: one whose criteria no change to files can
 * meet gets no fix task; a criterion only the plan can meet is answered by a new requirement first. Tester #392: that used
 * to suggest `orca requirement feedback`, which refuses after confirm (`requirement-already-accepted`); a new requirement is
 * the step that works on a confirmed group.
 */
export function reviewAnswers(groupId: string, why: string | undefined, left: ReadonlyArray<LeftCriterion>): string[] {
  const rerun = `orca group review-rerun ${groupId} --note '<what to look at>'`, accept = `orca group review-accept ${groupId} --note '<why accept as is>'`;
  if (why === "test-change-only") return [
    `orca group review-rerun ${groupId} --note '<after restoring the changed test paths>'`, accept,
  ];
  // Tester #343/#392: a criterion only the plan can meet is answered by a new requirement (the step that works on an
  // accepted group). Tester #502: that holds in every review shape that records one, a check conflict included.
  const plan = left.some((c) => c.by === "plan") ? ["orca requirement open --idea '<the requirement, with the plan changed>'"] : [];
  if (why !== "not-fixable-by-work") return [`orca group review-fix ${groupId} --goal '<what to fix>'`, ...plan, rerun, accept];
  return [...plan, accept, rerun];
}

/** Follow-up E §5 (#241): a failed acceptance is rechecked; only command failures are waivable, never a measured test-count shortfall. */
export function acceptanceAnswers(groupId: string, shortfall = false): string[] {
  const recheck = `orca group recheck ${groupId}`;
  return shortfall ? [recheck] : [recheck, `orca group waive-acceptance ${groupId} --note '<why>'`];
}

export function acceptanceTestChangeAnswers(groupId: string): string[] {
  return [`orca group accept-test-changes ${groupId} --note '<why>' --tip <tip> --digest <digest>`];
}

/** Delivery tail spec D3: a failed acceptance on the delivered commit -- recheck it, or a person waives it. */
export function deliveredAcceptanceAnswers(groupId: string, shortfall = false): string[] {
  const recheck = `orca group recheck-acceptance ${groupId}`;
  return shortfall ? [recheck] : [recheck, `orca group waive-acceptance ${groupId} --note '<why the delivered tree is accepted>'`];
}
