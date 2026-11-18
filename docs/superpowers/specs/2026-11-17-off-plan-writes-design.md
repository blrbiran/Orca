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

## Correction 1 (plan 2026-11-18)

Written 2026-11-18 by the Task 7 implementer (Claude Opus 5.5) of Orca session 2026-11-18 (the second of the day; plan
`docs/superpowers/plans/2026-11-18-off-plan-writes.md`, ledger `.superpowers/sdd/2026-11-18-off-plan-writes/progress.md`),
on branch `feat/off-plan-writes-346`, following commit `9209fa08` (`fix(control): the parallel-claim pass reads only
orchestrated, running groups and waits for settled usage (#346 W4, fix round 1)`). The text above is kept verbatim; where
it and this section differ, this section records what was built. Sources: the plan's "Decisions the plan makes", the
ledger's `Ruling:` / "Parked" / "minor (deferred)" / "Deviation" lines, and the deviation sections of
`task-1..6-report.md` in the ledger's directory. Each item: what, why, cost or limit.

### The plan's three decisions (where the spec left room)

1. **Where the claims live.** What: not in the archived plan or the recipe (both are hashed before confirm) but in a new
   optional execution-snapshot key `offPlan` (`[{taskId, siblings: [{siblingId, claims: [{repoKey, path}]}]}]`), computed
   in `prepareExecutionSnapshot` and read back by every `deriveContract` caller. A snapshot of a group with no v4 task
   omits the key, so its bytes do not move. Why: this is "frozen with the contract" (W2), and it lets `--after` rewrite one
   task's entry without re-deriving its siblings. Cost: one more snapshot key that the panel's snapshot check
   (`controlViews.validateExecutionSnapshot`) must re-derive with.
2. **"Adds dependsOn" (W4).** What: `--after <sibling>` appends the sibling to the *work item's* `dependsOn`, the only
   field the dispatcher reads (`orchestration.ts` `dependencyReady`); the archived plan's `dependencyTaskIds` are not
   touched. Why: the archived plan is hashed authority. Cost: two places now say what a task waits for (see item 9).
3. **Overlapping unordered pairs (W1).** What: the spec's `off-plan-claims-overlap` refusal at confirm is not built. A
   pair whose write sets intersect is never a parallel sibling (its claims would deny the task its own targets). Why:
   plan-file import may not turn implicit edges into `dependsOn`, so such a pair is legal input, not a code bug. Cost:
   see item 6 (such a pair's claims are not denied even if the dispatcher runs the two at once).

### Deviations recorded while building

4. **Repositories are keyed by directory; claims are receiver-relative (Task 2, fix round 1).** What: a repository is
   `posix.resolve(repoPath)` (`context.repoPath` for the primary, `additionalRepos[].repoPath` for extras), lexical only.
   A claim handed to task T is keyed `null` for T's primary directory, T's own extra key for one of T's extra
   directories, and dropped when T has no entry for that directory. A sibling whose claims are all dropped is not frozen,
   and a task left with no sibling has no entry. Why: in a multi-directory group two tasks' primaries can be different
   directories, so keying by role (primary/extra) missed real siblings and put claims under the wrong key (reviewer probe).
   Limit: two entries of one contract that resolve to the same directory are not handled (the later one wins); a relative
   `repoPath` would resolve against the process cwd (every producer passes absolute paths).
5. **The dependency graph includes implicit edges (Task 3, controller ruling on Task 2).** What: `frozenOffPlan` runs
   `buildGraph` over directory-qualified write sets and adds each implicit edge to the task's dependencies before
   computing siblings, so a pair ordered only through an implicit write-set edge is not parallel. Why: W1 names "the same
   graph `layers` is built from". Cost: none beyond W1.
6. **A plan-file import's implicit edges are not dispatcher edges (Task 3, concern 4).** What: the snapshot treats an
   implicit edge as ordering a pair, but the dispatcher reads only `dependsOn`. Limit: a plan-file import whose tasks'
   write sets intersect may run them at once, and their claims are not denied to each other. The denylist is then weaker
   than the dispatcher's real parallelism; landing conflicts handle it, as before #346.
7. **A confirmed `set-task-loop` (Task 3, fix round 1).** What: it keeps the task's frozen entry and refuses
   `off-plan-claims-overlap` (409) when the task's new write set meets its own frozen sibling claims. So the code exists,
   but for this case, not for item 3's. Siblings are not re-frozen: a path the amendment newly adds that no sibling
   claims is allowed for the task and is **not** added to its siblings' denylists. Why: re-freezing would re-derive
   other tasks' confirmed contracts. Limit: a sibling may write that new path without being stopped; a landing conflict
   then handles it. A v3 task changed to v4 after confirm has no entry (no sibling denylist); a v4 task changed to v3
   keeps its denylist (only stricter). A confirmed `set-task-loop` on a multi-directory loop task refuses
   `execution-policy-unrepresentable` before this check (reachability not checked).
8. **Orca's own harvest bound for v4 is the denylist (Task 4b, controller ruling).** What: the collect step
   (`executionDriver` stepC) and accept-attempt bounded a run's writes by `targetPaths ∪ allowlistPaths`, so with an
   empty allowlist every off-plan write blocked at C `out-of-bounds` and never landed -- no plan task covered it. Now
   (`src/control/harvestBound.ts`) a repository whose `allowlistPaths` is an explicit empty array is bounded by its
   denylist (protected paths ∪ frozen sibling claims), with ccloop's matcher (exact, `<dir>/**` prefix, `**`); a
   non-empty allowlist keeps the old bound byte for byte, and an *absent* extra-repository allowlist keeps it too (ccloop
   defaults it to that repository's targetPaths). Why: the spec's goal ("a task may write files its plan did not name")
   was unreachable otherwise; Orca's check stays a second line behind ccloop's denylist. Cost and limits:
   - "v4" here means "an empty allowlist", so any contract with an empty allowlist takes the denylist bound, including
     hand-written ones and **debug tasks**: a debug task with no original, or whose original's allowlist is empty
     (`debugPlan.ts` `debugContract`), and a system debug task (`systemDebug.ts`, `allowlistPaths: []`) are now bounded
     by their denylist where Orca used to bound them by targetPaths.
   - **`orca run` (`src/scheduler/run.ts`) keeps the old bound.** Its contracts have no frozen sibling claims, so a
     denylist bound would drop its only collision check. Consequence: under `orca run` a v4 off-plan write still lands as
     a `boundary` decision and the round exits 2; no `off-plan-write` row is written there.
   - Two end-to-end pins were lost and are now covered only directly: the multi-directory `out-of-bounds:<key>:<paths>`
     join, and the shas a blocked multi run keeps.
   - An accepted attempt (accept-attempt) now records its off-plan writes too (Task 4 fix round 1); an E-block acceptance
     that D already landed adds no second row.
9. **Classification at block time (Task 5, fix round 1).** What: the `parallel-claim` diagnosis is decided once, when the
   block is recorded, and stored as `drive.parallelClaim {path, repoKey, siblingIds}`; the view and the orca-auto pass
   read only that. Runs blocked before this change are not backfilled (they keep their earlier diagnosis). Why: computed
   per view from the *current* frozen entry, a run's cause flipped to `unknown` after `--after` rewrote the entry, and
   each poll paid one confirmed-execution read per blocked run. An unreadable confirmed execution at block time stores no
   claim (the block is still recorded). Limits: `parallel-claim` is decided only while the cause is otherwise `unknown`
   and before `path-policy`; the stop reason's paths are split on `,` and `;` without escaping, so a path containing
   them is read as pieces (a wrong positive needs a piece to match a claim).
10. **`--after` and a live run (Task 6).** What: `after-task-has-live-run` refuses only a live run that is **not**
    `blocked`. Why: the parallel-claim stop is itself an active run in state `blocked` -- the very run the retry settles
    -- so refusing every active run would make `--after` impossible in the case it exists for. Other refusals:
    `after-not-a-sibling`, `after-cycle` (Review Focus 1: two siblings stopped on each other -- the second retry is
    refused and left to a person).
11. **`afterDependsOn` on the work item; the panel's authority check accepts it (Task 6).** What: besides `dependsOn`,
    the work item records what `--after` added (`afterDependsOn`, sorted, unique). The panel's work-item authority check,
    which compared `dependsOn` with the archived plan's edges, now accepts plan edges ∪ `afterDependsOn` and validates
    those ids (own id and unknown ids refused). Why: without it the whole group view blocked as `work-item-authority`
    after any `--after`. Limit: the work-item view does not show `afterDependsOn`, so a waiting task does not say which
    added dependency it waits for (deferred minor).
12. **The orca-auto pass (Task 6, fix round 1).** What: `parallelClaimPass` (in `systemDebugPass`, after the worker-lost
    pass, before the ladder) reads only groups Orca orchestrates -- orchestration mode `run`, not a flow child, not
    archived, not paused or stopped -- the same filter as the worker-lost pass. It waits while usage events are past the
    run's highWater or the run's usage is unknown, and passes over a run that already carries a `ladder-skipped` note.
    A retry the task's budget cannot fund is not sent and is noted as `ladder-skipped`. One command per stopped run
    (`orca-auto-parallel-claim-<task>-<run>`), applied or refused, is the record. Why: without the filter a paused or
    archived group booked a durable refusal and was never retried after resume; without the waits a usage-pending run's
    one retry was booked as refused. Limits: the pass orders the task after `siblingIds[0]` only; if the next run stops on
    another sibling's claim, that run gets its own retry. The archived/flow-child filters are copied from the worker-lost
    pass and not pinned by their own tests.
13. **Saved-result recovery refuses an `--after`-amended task (Task 6, known limit).** What:
    `src/control/savedResultRecovery.ts` compares `work.dependsOn` with the archived plan's edges, so a saved-result
    verify on a task amended by `--after` is refused `saved-result-source-stale`. Not changed. Cost: it fails safe (a
    refusal, no wrong landing); such a task's saved result cannot be recovered that way.

### Parked limits

14. **Activity retention.** The `off-plan-write` row is an activity row; a group keeps its newest 500
    (`ACTIVITY_RETENTION`), so in a long group an early landing's row can be pruned before the requirement review reads
    it, and its fact line and run-view field disappear. Keeping it durable would need a store change.
15. **Multi-directory recording compares only the first written directory** (the one the contract is rooted at): an
    extra directory's off-plan writes are not recorded.
16. **A mixed v3 + v4 group's review fix task** gets a narrow allowlist (the union of the v3 tasks' lists), as Review
    Focus 3 accepted; pinned by a test so a change is seen. A pure-v4 group's fix task has no allowlist.

### Acceptance 3-5 as built

`tests/control/offPlanWritesE2E.test.ts` (Task 7) drives acceptance 3, 4 and 5 through the real ccloop build
(`ORCA_CCLOOP_BIN` = the ccloop source build's `dist/cli.js`) with its scripted fake codex; no provider is called.
Acceptance 4 is exercised through the orca-auto pass (the W4 ruling), not a person's `--after`, which Task 6's own tests
cover. The fake codex creates no directories, so a file in a subdirectory has its directory (an empty `.gitkeep`)
committed in the base first; the off-plan files themselves are new. Without `ORCA_CCLOOP_BIN` the file is skipped, not
passed.
