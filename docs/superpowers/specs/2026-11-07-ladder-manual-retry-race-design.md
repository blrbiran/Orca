# Manual retry while a ladder fix is running

## Intent

An automatic ladder must have a fundable follow-up retry before it spends on a debug run or folds that run's fix into the parent branch. In the real dogfood, `multiply` exhausted its authored 150k work budget. Orca nevertheless spent 195,035 tokens on a debug group, folded its fix, and only then found that its own retry was refused as `authored-budget-exhausted`. A later explicit top-up retry saw an already fixed branch, returned `empty-result`, and left the parent 1/2 blocked. A separate interleaving with a live manual retry is also possible and is guarded below.

## Approaches

1. Let both run and reconcile at landing: requires a new authority rule for two writers to the same task, and still wastes a provider run. Rejected.
2. Check the same optional-v1 authored remainder used by `retry-task` before either ladder level and before fold. Leave an unfunded task for explicit top-up, with a `ladder-skipped` reason; do not move its parent branch. Also refuse a competing manual retry while a confirmed ladder group for that exact failed run is unsettled, while preserving draft supersession. Chosen.
3. Cancel the ladder from a manual retry: requires a safe stop and accounting path for a live debug run. Separate work.

## Behavior

- `retry-task` checks a leaf dependency supplied by Web service for an unsettled, confirmed ladder group whose source is the task's current failed run. A non-auto command is refused as `task-not-retryable:debug-in-progress:<groupId>` before changing run, work or budget. The user can inspect that group and retry after it settles if its fix fails.
- For an optional-v1 task with no authored work remaining, the ladder skips both automatic retry and debug-group creation. Its run gets one `ladder-skipped:authored-budget-exhausted` activity row. A previously opened debug group does not fast-forward its fix when the parent has no retry budget; it settles `retry-unfunded` and leaves the parent branch unchanged.
- The existing draft-ladder supersede path remains: a manual retry accepted before ladder confirmation causes the ladder to step aside. Orca-auto's fold retry remains allowed.
- A per-store fold guard covers asynchronous Git waits even if the debug group is archived in between. A draft ladder may still be superseded; its confirm transaction rechecks the exact source run after asynchronous agent resolution and refuses an obsolete confirmation. A moved source settles as `superseded` and does not alter the parent branch.

## Limits

This prevents new race-induced `empty-result` blocks. It does not retroactively mark the previously blocked dogfood group complete; that historical recovery needs a distinct task-result resolution path.
The fold guard is scoped to one `ControlStore` instance. Orca's panel service lock is the process boundary; a second writer deliberately attached to the same SQLite file would need a durable cross-process lock.
