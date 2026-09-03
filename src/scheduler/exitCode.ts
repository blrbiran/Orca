/**
 * spec §6.3's precedence: 3 > 2 > 1 > 0. Every task or round-level event
 * contributes one of these four values; the round's exit code is whichever
 * contribution is the most severe.
 *
 * This used to be `contributions.reduce((worst, code) => Math.max(worst, code), 0)`
 * inline in run.ts, and it was faithful only by coincidence — the four codes
 * happen to already be in the right order, so the largest integer is also the
 * most severe one. That coincidence is not a rule: nothing pinned the ordering
 * on its own, and the day a fifth contribution is added whose severity does
 * not match its numeric value, `Math.max` silently reorders it. Spelling the
 * precedence out as its own table makes the ordering the thing a criterion
 * and a mutation (`M-EXIT`) can hold in place, independent of what the
 * numbers happen to be.
 *
 * 3 means "a person has to come back and do something" (an escalation); 2
 * means "this path is dead, read the log" (an ordinary failure). Demoting a 3
 * to a 2 would make the errand a human owes vanish into a pile of failures;
 * ranking a 2 above a 3 would only remind twice — the safer of the two
 * mistakes, which is why 3 wins whenever both are present rather than the
 * two being merged or averaged. There is no ranking under which a failure (2)
 * loses to nothing failing (0): nextflow's IGNORE strategy exits 0 by default
 * and needs an opt-in flag to behave otherwise; this scheduler has no such
 * flag; there is no mode in which a task failed and the round still exits 0.
 */
export type ExitContribution = 0 | 1 | 2 | 3;

// Most severe first. reduceExitCode walks this list and returns the first
// value present in `contributions` — NOT `Math.max`, on purpose, so that
// M-EXIT (swap the first two entries) is a one-line, self-contained mutation
// that reverses the 3-vs-2 precedence without touching the numbers 3 and 2
// themselves.
const PRECEDENCE: readonly ExitContribution[] = [3, 2, 1, 0];

export function reduceExitCode(contributions: ExitContribution[]): ExitContribution {
  for (const code of PRECEDENCE) {
    if (contributions.includes(code)) return code;
  }
  // No contribution at all (an empty round, or every task's contribution
  // happened to be filtered out before reaching here) is the same as "nothing
  // failed and nothing escalated": exit 0.
  return 0;
}
