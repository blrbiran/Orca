# Task B1 report

Implementer: Orca session 026d10e3 subagent, 2026-10-15. Base: 2034af1e. Commit: 20301d89
(`refactor(control): share the execution-pending predicate between the group view and start`).

Status: DONE

## What changed
- Created `src/control/executionPending.ts` (verbatim from the brief, Step 3): `BUSY_WORK`, `EXECUTION_WAKE_KINDS`
  (`start`, `no-start`, `resume`; no `continuation`), `ExecutionFacts`, `executionPendingFrom` (counts only active runs
  with `phase === "work"`), `ExecutionSnapshot`, `groupExecutionPending` (view entry over the snapshot),
  `groupExecutionPendingInStore` (store entry; reads `kind: "task"` work items).
- `src/panel/controlViews.ts`:
  - :13 added `import { groupExecutionPending } from "../control/executionPending.js";` (after the `peerCode` import).
  - :364 the old `BUSY_WORK` doc+const, the #53 doc comment and the local `executionPending` function (was :363-380)
    replaced by `export { BUSY_WORK } from "../control/executionPending.js";` (so `controlOverview.ts:8` untouched).
  - :440 (brief anchor :455; actual pre-edit :456) now calls
    `groupExecutionPending(store, groupId, archived.plan.tasks.map((task) => task.taskId), readSnapshot!)`.
  - Each quoted anchor was found exactly once.
- Created `tests/control/executionPending.test.ts` (verbatim from the brief, Step 1).

## Commands (PATH prefixed with /Users/biran/.nvm/versions/node/v22.13.1/bin; logs read back whole)
- RED: `vitest run tests/control/executionPending.test.ts` -> /private/tmp/oec/logs/b1-red.log, rc=1,
  "Cannot find module '../../src/control/executionPending.js'" (load error, as the brief expects at RED).
- GREEN: `vitest run tests/control/executionPending.test.ts tests/control/webDispatch.test.ts tests/panel/controlOverview.test.ts
  tests/panel/controlOverviewApi.test.ts tests/panel/groupSummaryFields.test.ts tests/panel/controlPollPerformance.test.ts`
  -> /private/tmp/oec/logs/b1-green.log, rc=0, 6 files passed, 82 tests passed, 0 skipped/failed.
- Verbose re-run of webDispatch + executionPending -> /private/tmp/oec/logs/b1-green-verbose.log, rc=0, 27/27 passed;
  confirms the five #53 criteria (webDispatch :277-327) are green, including "says execution is pending on an active run
  alone, with no busy work status and no undelivered wake" (the :316 fixture's real work run).
- `npm run typecheck` -> /private/tmp/oec/logs/b1-typecheck.log, rc=0.
- No web/src touched, so no web build / web suite run. No mutations run (reviewer's Step 6).

## Deviations
None. Line anchor :455 was :456 in the tree (earlier tasks shifted it); located by quoted text.

## Concerns
None. `BUSY_WORK` is now typed `ReadonlySet<string>` (was `Set<string>`); typecheck confirms `controlOverview.ts:97` still compiles.
