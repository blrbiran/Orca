# A red full suite is classified against the group's base

**Status:** accepted 2026-11-16 (session `2026-11-16`, human ruling: continue and report at the end).
**Issues:** #279, #283, #312, #314 (their common residue), tester groups `dogfood-20261112-*` / `20261114-*` / `20261115-1`.

## The problem

The project's full-suite command (its `integration-check.command`) runs once at the group's tip and,
after a green union, once more when red. A repository that was **already red at the commit the group
branched from** -- the dogfood repositories' `test/readme.test.js` asserting `version===1` while the
CLI prints `3` -- therefore fails every group's acceptance forever. `#312` and `#314` fixed the review
gate so a failing tip is still reviewed; they did not give the group a way to be done. The only exit is
a person's `waive-acceptance`, and `recovery list` never names the group.

## Decision

Keep the full-suite command and its two-run rule. When the tip's suite is red twice, run the **same
command at the group's base** (the base of its first work run, frozen before any task landed):

- base red twice too → `result:"passed-relative"`; the group may be done. The record keeps both runs
  (`fullSuite.exits` at the tip, `fullSuite.baseline = {tip, exits, tail}`), and the command list
  appends both baseline runs as `baseline: <cmd>` so the evidence is readable.
- base green (or green on its retry) → `result:"failed"`; this group introduced the failure. Only the
  tip's commands stay in the record, so `failedCommandOf` keeps naming the real failing command.
- base cannot be checked out → `failed`, as today (a conservative answer, never a silent pass).

The union checks (setup + each task's required checks) are **not** run at the base: they are written
for the new tree and would fail for reasons unrelated to the group. Only the project-wide suite is
classified.

`passed-relative` is satisfied by `acceptanceSatisfied` (the done pass, the integration pass, the
review gate). `acceptanceProblem` stays null. `fullSuiteWarning` reports
`full-suite-pre-existing:<command>` (an amber note, never a blocking problem). A `waive-acceptance`
still overrides a `failed` record, unchanged.

## Why this shape

- **Exit-code comparison, not test-name diffing**: the command is arbitrary shell; parsing its output
  for test ids is unreliable. Two exits answer the product question ("was this repository red before
  this group?") without inventing a taxonomy.
- **Run the base only after a red tip**: a green tip pays nothing; the extra run is paid exactly for
  the groups that are otherwise stuck.
- **The base is the first work run's `drive.base`**: the group branch is created from it, and every
  later claim's base is that branch tip. It is already stored, no new field.
- **Not a waiver**: a waiver says "a person accepts this failing tip"; `passed-relative` says "the
  same command was already red at the base", which is a fact, not an acceptance.

## Non-goals

- No default full-suite run when the project has no command (the #279 ruling stands: label, do not
  run).
- No per-test baseline list, no flaky-test memory, no change to the two-run rule.
- No change to the union of task checks, the focused checks, or the requirement review's own gate.

## Tests

`tests/control/groupAcceptanceFullSuite.test.ts`:

1. red at the tip, red at the base → `passed-relative`, group done, the record names the base and both
   exits, and the baseline runs appear as `baseline: <cmd>`.
2. red at the tip, green at the base → `failed`, no baseline commands in the record, group not done.
3. the existing green / flaky / unset cases stay green and run no baseline.

Mutations: drop the baseline run → case 1 is `failed` (red); classify on any base exit instead of two
red runs → case 2 passes (red).