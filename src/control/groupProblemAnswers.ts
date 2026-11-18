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
 * meet gets no fix task; a criterion only the plan can meet is answered by a new plan draft first.
 */
export function reviewAnswers(groupId: string, why: string | undefined, left: ReadonlyArray<LeftCriterion>): string[] {
  const rerun = `orca group review-rerun ${groupId} --note '<what to look at>'`, accept = `orca group review-accept ${groupId} --note '<why accept as is>'`;
  if (why !== "not-fixable-by-work") return [`orca group review-fix ${groupId} --goal '<what to fix>'`, rerun, accept];
  const plan = left.some((c) => c.by === "plan") ? [`orca requirement feedback ${groupId} --text '<what to change in the plan>'`] : [];
  return [...plan, accept, rerun];
}

/** Follow-up E §5 (#241): a failed group acceptance -- run it again (a flaky check), or a person waives it. */
export function acceptanceAnswers(groupId: string): string[] {
  return [`orca group recheck ${groupId}`, `orca group waive-acceptance ${groupId} --note '<why>'`];
}

/** Delivery tail spec D3: a failed acceptance on the delivered commit -- recheck it, or a person waives it. */
export function deliveredAcceptanceAnswers(groupId: string): string[] {
  return [`orca group recheck-acceptance ${groupId}`, `orca group waive-acceptance ${groupId} --note '<why the delivered tree is accepted>'`];
}
