# Task A1 report
Commit c03d4e3 fix(import): report every plan problem in one refusal, one item per line (branch fix/issues-20261008).
Files: src/scheduler/planFile.ts, tests/scheduler/planSourceItems.test.ts (new), tests/control/requirementSplit.test.ts.

## Implemented
Brief's code verbatim (rejectItems, originalOrItem, two-stage schedulerControlPlanSourceOf).

## Deviations
1. Pre-flight amendment 6: the existing requirementSplit test "hands back what the Web import refuses beyond the checks above"
   (import:control-metadata) went red from A1's change, so its A2 rewrite (comment lines + expectation
   import:missing-success-conditions) is committed here. A2 must NOT redo it; A2 keeps its importReasons work and the new
   requirementSplitItems.test.ts.
2. Controller amendment (non-ASCII task id) is impossible at stage 2: loadPlan stage 1 refuses any taskId outside RUN_ID
   (/^[A-Za-z0-9][A-Za-z0-9._-]*$/) with `unusable-task-id` (seen RED: ["unusable-task-id"]). So a non-ASCII taskId can never
   reach `missing-target-version:`. The five-problem criterion keeps ASCII ids. Added instead test "carries non-ASCII text and
   commas in an item verbatim..." (contract path "合约,目录/a.json" -> `unreadable-source:<path>` beside missing-target-version:a).
   A4's decode test should feed a detail with non-ASCII in an `unreadable-source:` / `malformed:` item, not in a task id.
   The comma-in-zod-message case is kept ("keeps a schema issue whose message holds commas...").

## Tests ($S=scratchpad/orca/A1)
- RED (red.txt, load 2.88): 5 of 7 failed for the brief's expected reasons (with the non-ASCII-id attempt, the first one failed on unusable-task-id, which led to deviation 2).
- GREEN: planSourceItems + requirementSplit + tests/scheduler (62 files, 310 tests) rc=0; tests/control whole dir + requirementAccept/E2E: 133 files pass, 1 red driverProgress "P3/R1..." (5010 ms timeout, load ~17-21) -> re-run alone 7/7 pass (known load-flake family). npm run typecheck rc=0.
- Web unchanged; web check not run.

## Mutation (clone made after commit; worktree git status clean after)
1. early return after duplicate-success-condition -> RED: "names five problems...", "orders one task's items..."
2. originalOrItem rethrows -> RED: "orders...", "names every task's broken contract file", "carries non-ASCII..."
3. join(",") -> RED: five problems, orders, contract files, commas-in-message, non-ASCII
4. escape removed -> RED: "writes a newline inside an item as \n"
(Mutation 1 first attempt used a failed sed on macOS; redone with python, outputs above are from the corrected runs.)

## Concerns
`git diff | wc -c` printed 1 (the rtk wrapper appends a newline) after the clone work; `git status --short` shows only the untracked sdd dir and node_modules symlinks.
