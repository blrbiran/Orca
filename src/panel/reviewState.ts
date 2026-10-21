import type { ReviewRow } from "./reviewsStore.js";

/** The two actions that carry a person's review state; `opened` does not. */
export type ReviewStateAction = "reviewed" | "withdrawn";

// A NUL (U+0000) join, not a space: spec section 4.2 keys by (projectKey, id) because a
// decision id repeats across clones and forks (compute.ts's decisionByKey
// carries the same lesson). A space-joined key would collide whenever either
// half itself contains a space; neither projectKey nor a decision id is
// guaranteed free of one.
//
// (decisions review withdraw spec section 4.2) Moved here from coverage.ts,
// unchanged, so the state map and coverage share one definition of "the same
// decision".
export const keyOf = (projectKey: string, id: string): string => `${projectKey}\x00${id}`;

export function isStateAction(action: string): action is ReviewStateAction {
  return action === "reviewed" || action === "withdrawn";
}

/**
 * decisions review withdraw spec section 4.3: the one dedupe rule for state
 * rows, shared by the panel's writer and `orca decision compact-reviews`. A state row
 * is a duplicate exactly when it equals the person's current state for that
 * decision: reviewed -> reviewed changes nothing, reviewed -> withdrawn ->
 * reviewed is three real acts. `current` is undefined when the person has no
 * state row yet; a first `withdrawn` is then NOT a duplicate here -- refusing
 * it is the route's job (section 4.4), not the dedupe's.
 */
export function isDuplicateStateRow(current: ReviewStateAction | undefined, action: ReviewStateAction): boolean {
  return current === action;
}

/**
 * decisions review withdraw spec section 4.2. Per (projectKey, decisionId) --
 * the `keyOf` key -- and then per `by`, the action of the LATEST
 * reviewed/withdrawn row in file order. File order, not `at`: `at` is a wall
 * clock across machines, while append order under the reviews lock is the
 * order the acts happened. `opened` rows take no part.
 *
 * The inner map keeps each person at the position of their FIRST state row
 * (a Map `set` on an existing key does not move it), which is the first-seen
 * order `activeReviewers` promises.
 */
export function reviewStates(rows: readonly ReviewRow[]): Map<string, Map<string, ReviewStateAction>> {
  const states = new Map<string, Map<string, ReviewStateAction>>();
  for (const r of rows) {
    if (!isStateAction(r.action)) continue;
    const decisionKey = keyOf(r.projectKey, r.decisionId);
    let byPerson = states.get(decisionKey);
    if (byPerson === undefined) {
      byPerson = new Map();
      states.set(decisionKey, byPerson);
    }
    byPerson.set(r.by, r.action);
  }
  return states;
}

/** The people whose state on this decision is `reviewed`, in first-seen order. */
export function activeReviewers(
  states: ReadonlyMap<string, ReadonlyMap<string, ReviewStateAction>>,
  projectKey: string,
  decisionId: string,
): string[] {
  const byPerson = states.get(keyOf(projectKey, decisionId));
  if (byPerson === undefined) return [];
  const active: string[] = [];
  for (const [by, action] of byPerson) if (action === "reviewed") active.push(by);
  return active;
}
