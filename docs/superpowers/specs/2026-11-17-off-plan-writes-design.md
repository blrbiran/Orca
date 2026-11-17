# Off-plan writes: a task's targetPaths is a plan, not a wall (#346, #345, #321)

Session 2026-11-17 evening (Orca). Tester issues #346 (the decision), #345 and #321 (instances), in
`orca_archived_files/issue-20261023.md`. Status: **design only, for the human's review; nothing is built.**

## Human ruling this design rests on

The controller offered three directions for #346: (a) stop a run only when it writes into the write set of a task that
may run in parallel with it, and let every other off-plan write through, recorded; (b) the tester's option A (the
allowlist becomes a recorded signal, only the denylist stops); (c) only patch the split (#345 plus prompt wording).
Human, verbatim: 「选 (a) 我的折中方案」.

This is consistent with an earlier ruling that is not reopened: "conflict detection / classification / resolution /
verification is the trunk; the write-set test is an optimisation" (handoff §5.2 item 5).

## Why

`targetPaths` does two jobs whose needs pull apart:

| Use | Wants | Today |
|---|---|---|
| Layering: implicit edges where write sets intersect (`src/scheduler/graph.ts` `buildImplicitEdges`) | precise paths | unchanged by this design |
| The agent's write permission: the contract's `safetyPolicy.allowlistPaths` (`src/control/loopPlans.ts` `materialize...`: `allowlistPaths: [...inputs.targetPaths]`), enforced by ccloop `evaluatePathPolicy` as `humanGateHit` | room for ordinary engineering | a single unlisted file stops the run at `blocked_waiting_human` |

`targetPaths` come from one tool-less model call that sees the requirement and the file tree. It cannot know that the
work will need a new module (#345: `src/board/cli.js`), a README line (#265, #321: 7.3M tokens of finished work thrown
away), or an export in a neighbouring file. Every patch so far (`splitImpliedPaths`, `--allow-observed-paths`, path
allowances) acts before the run on what the plan names, or after a stop on what a person approves; none covers "the plan
was not precise".

What the allowlist really protects is the parallel schedule: two tasks run at once only because their write sets do not
intersect. A write outside both sets cannot break that promise more than a merge conflict at landing, which Orca already
detects and resolves. A write into a *parallel sibling's* set can: it races the sibling's own change.

## Goals

- A task may write files its plan did not name, unless another task that can run in parallel with it claims them.
- Every off-plan write is visible: an activity row, the task view, the review's Orca facts.
- No ccloop change and no repin: ccloop already treats an empty allowlist as "no allowlist" and enforces the denylist
  (`src/policy/pathPolicy.ts`, `allowlistMisses` returns `[]` for an empty allowlist).
- Layering, `#335` narrowing and the write-set rules stay exactly as they are.

## Non-goals

- Old groups (loop plan version ≤ 3) keep their contracts, `--allow-observed-paths` and path allowances.
- Dir / folder groups (no git path policy) are unchanged.
- Writes into another *group's* claims (two groups on one repository): integration conflicts handle them, as today.
- `maxFilesTouched`: unchanged (v2/v3 defaults are already unbounded).

## Approaches considered

1. **Siblings' claims as the denylist, at confirm (chosen).** Deterministic, frozen with the contract, enforced by
   ccloop as it is. Costs: a sibling hit still stops the run (by design), and the contract bytes change, so it is a new
   loop plan version.
2. **Live check at landing only** (no denylist; Orca compares the landed paths with siblings still running). The race is
   already lost when it is seen; the sibling's work or this one must be redone. Rejected.
3. **A ccloop "advisory allowlist" mode.** Needs a ccloop contract change and repin for what an empty allowlist already
   gives. Rejected.

## Design

### W1. Who is a parallel sibling

For task `T` in a confirmed plan, `parallel(T)` = every other task of the same plan that is neither an ancestor nor a
descendant of `T` in the plan graph (explicit `dependsOn` ∪ implicit write-set edges, the same graph `layers` is built
from). Its claims: `parallelClaims(T)` = the union of their write sets (`targetPaths` ∪ `allowlistPaths` as
`writeSetOf` reads them), as declared strings. By construction no claim in `parallelClaims(T)` intersects `T`'s own
write set (an intersection would have been an implicit edge); the materializer asserts it and refuses the plan if not
(`off-plan-claims-overlap`, a code bug, never expected).

Path shapes are only the three `PATH_SHAPES` allows (exact, `<dir>/**`, `**`), which ccloop's matcher reads exactly.

### W2. The contract (loop plan version 4)

A new loop plan version for every plan id (the materializer is versioned, and old contracts' bytes and hashes must not
move). Version 4 differs from 3 only in `safetyPolicy`:

- `allowlistPaths: []`
- `denylistPaths: protectedPaths ∪ parallelClaims(T)` (sorted, de-duplicated)
- `context.constraints` gains one line when `parallelClaims(T)` is non-empty: `Other tasks of this group change these
  paths at the same time; do not modify them: <paths>.` and one line always: `targetPaths are the files this task is
  expected to change; change others when the work needs them.`

Multi-directory groups: the same per repository entry (`context.additionalRepos[].allowlistPaths: []` sent explicitly,
since ccloop defaults an absent one to that repo's `targetPaths`), with siblings' claims in that repository.

`parallelClaims` is computed at confirm from the confirmed plan, so it is frozen with the contract. A task added later
(review fix, debug, system debug, `requirement narrow-path` re-validation) computes it against the plan it joins; a
review-fix task, which runs after every work task is done, has no parallel siblings.

### W3. Recording an off-plan write

When a run lands, Orca compares the landed commit's changed paths (already computed for landing) with `T`'s
`targetPaths`. Paths outside them are recorded:

- activity `off-plan-write {taskId, runId, paths}` (paths capped at 64, with a count);
- the task view's last-run line, `task show`, and the review prompt's "What Orca recorded beyond the diff" (one line per
  task with off-plan paths).

It is information, never a failure, and it does not feed back into the plan.

### W4. A write into a sibling's claim

ccloop stops the run as today (`blocked_waiting_human`, `denylist match: <path>`). Orca classifies the block: when the
path matches `parallelClaims(T)`, the run's failure cause shows `parallel-claim` with the sibling's taskId(s), and the
next action is **retry after the sibling** -- a new verb option `orca task retry <g> <T> --after <sibling>` (Web: the
same as one button on the problem row) that amends `T`'s contract (adds `dependsOn: <sibling>`, removes that sibling's
claims from `T`'s denylist, re-validates the graph) and dispatches `T` again once the sibling has landed. A path in
`protectedPaths` is a protected-path stop, unchanged.

**Open for the human (W4)**: should Orca do this retry automatically (as `orca-auto`, like the path-allowance pass), or
wait for a person? The controller's recommendation: automatic. The amendment only orders two tasks the plan left
unordered and never widens what any task may write beyond what its sibling already owns once it has landed.

### W5. What stays

- Implicit edges, layers, `parallelCandidates`, `#335`'s `overlapSerialized` and `narrow-target-path`.
- `splitImpliedPaths` (#265) still adds successCondition-named paths to `targetPaths`: they still order tasks.
- `--allow-observed-paths` and path allowances still serve version ≤ 3 contracts; for version 4 an allowlist miss cannot
  happen.

## Risks

- Two parallel siblings both write the same unclaimed file: the second landing conflicts and goes through the conflict
  resolution path (owner approval, an agent resolves). Cost: one resolution instead of one blocked run.
- An agent widens its change more than a person wants. Mitigation: the off-plan record is in the review's facts, so a
  criterion like "only touch X" can be judged; the denylist still holds protected paths.
- A large `parallelClaims` list in `constraints` makes the prompt longer (bounded by the plan size; split caps tasks).

## Acceptance (each a command that exits 0 / non-0)

1. Unit: `parallelClaims` on a diamond (A→B, A→C, B→D, C→D, B/C disjoint) gives B's claims to C and C's to B, nothing
   to A or D.
2. Contract golden: a version-4 task has `allowlistPaths: []`, the denylist and the two constraint lines; a version-3
   contract's bytes are unchanged.
3. Driver with real ccloop (`ORCA_CCLOOP_BIN` = the ccloop source build): a task that writes an unlisted file in a
   directory nobody claims lands, and `off-plan-write` names the file.
4. Same world: a task that writes its parallel sibling's claimed file stops `blocked_waiting_human`, the view shows
   `parallel-claim` naming the sibling, and `--after <sibling>` re-dispatches it after the sibling lands.
5. The #345 shape: `board-cli` (`targetPaths: [src/cli.js, test/board-cli.test.js]`) writing `src/board/cli.js` lands.

## Left to the builder

Exact names (activity body fields, failure cause string, CLI flag), where the confirm step passes `parallelClaims` into
the materializer's inputs, and the en/zh strings.

## Ruling on W4 (human, 2026-11-17, Orca session `0e0846ae`)

The controller's recommendation stands, verbatim answer 「按建议走」: a run stopped on a write into a parallel sibling's
claim (`parallel-claim`) is retried by Orca automatically, as `orca-auto`, once that sibling has landed -- the same
amendment `--after <sibling>` makes (adds `dependsOn: <sibling>`, removes that sibling's claims from the task's denylist,
re-validates the graph). A person may still run `orca task retry … --after <sibling>` themselves. Not built yet.
