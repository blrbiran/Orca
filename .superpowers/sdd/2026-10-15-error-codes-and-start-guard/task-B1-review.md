# Task B1 review

Reviewer: Orca session 026d10e3 task-reviewer subagent, 2026-10-15. Reviewed range 2034af1e..20301d89 (one commit,
20301d89 `refactor(control): share the execution-pending predicate between the group view and start`). Clone
`/private/tmp/oec/mut/b1` (HEAD 20301d89, `/private/tmp/oec/logs/b1-head.log`), web built first (rc=0,
`/private/tmp/oec/logs/b1-webbuild.log`).

## Spec: ✅

- `src/control/executionPending.ts` matches the brief's Step 3 text exactly: `BUSY_WORK` = running, active, starting,
  start-unknown, held, continuing; `EXECUTION_WAKE_KINDS` = start, no-start, resume (no `continuation`); the run disjunct
  is `phase === "work"` only, so estimate (`phase: "estimate"`), clarify/split (`phase: "single-call"`) and handoff
  runs do not count (spec B §3.1).
- Two entry points as required: `groupExecutionPending` over the view's snapshot (a row whose body does not decode gives
  `undefined` via `field` and is skipped, as before) and `groupExecutionPendingInStore`, plain reads on `store.db` that
  run inside whatever transaction the caller holds; it reads `kind: "task"` work items (preamble interpretation).
- `controlViews.ts`: the old `BUSY_WORK` + local `executionPending` replaced by the re-export; import added; the summary
  line calls `groupExecutionPending(..., archived.plan.tasks.map(t => t.taskId), readSnapshot!)`. `controlOverview.ts`
  is untouched (Overview gate unchanged, per the preamble interpretation).
- Test file is the brief's Step 1 verbatim. No extra files, no speculative code.
- Existing criteria: the five #53 criteria in `tests/control/webDispatch.test.ts:277-327` are not in the diff (unchanged
  assertions). The "active run alone" criterion (:316-328) reaches its run through `service.start` + delivered start
  wake, i.e. a real `phase: "work"` claim run, so it still holds under the narrowed predicate and is green. Its SQL
  pre-condition counts `continuation` too; it asserts 0, so dropping that kind from the view does not change its
  meaning. No existing criterion changed meaning.

## Findings

### Critical
None.

### Important
None.

### Minor
1. `src/control/executionPending.ts:53` (the `.filter((result) => field(result, "kind") === "task")` in
   `groupExecutionPendingInStore`) has no criterion: mutation B1x (drop the filter) stays green
   (`/private/tmp/oec/mut/logs/B1x.red.log`, 2/2 passed). Non-task work items do exist (`handoff`, `reconcile`:
   `src/control/budget.ts:122-126`, `:132`), but a busy handoff item implies a held/continuing parent task, so the
   divergence from the view (which reads only plan tasks) looks unreachable today. Not a brief-named mutation; recorded
   as a gap. Fix if wanted: a criterion that writes a `kind: "handoff"` (or `reconcile`) work item with status `running`
   into a group whose tasks are all `ready` and asserts `groupExecutionPendingInStore(h.store, "g")` is `false`.
2. `tests/control/executionPending.test.ts:20` — the "not counted" phase list is `["single-call", "handoff", undefined]`;
   it omits the literal `"estimate"` phase. Covered end-to-end by the second test (a real estimate claim), so no gap in
   red-ability; adding `"estimate"` would make the unit row self-describing. Optional.
3. (Informational, not a finding) The store entry's true direction (wakes, work run, busy status read from the store) has
   no criterion in B1; B2's brief owns it (mutations B2d-B2i on this file). If B2 slips, that becomes a gap.

## Mutations (file `src/control/executionPending.ts`, clone `b1`)

Runner self-check: bad spec → exit 2, `.mutate` "found 0", clone `git diff` 0 bytes. Green baseline in the clone:
executionPending + webDispatch 27/27 passed, 0 skipped (`/private/tmp/oec/logs/b1-rev-baseline.log`). Every mutation:
`.mutate` says applied 1 spec; sha-after ≠ sha-before = sha-restored (8fb32b6f…).

| Name | Change | Test | Red on | Restore bytes (diff / cached) |
|---|---|---|---|---|
| B1a | `activeRunPhases.some(() => true)` | executionPending.test.ts | both tests: `:20` (expected true to be false) and `:31` ([true,true] vs [false,false]) | 0 / 0 |
| B1b | add `continuation` to `EXECUTION_WAKE_KINDS` | executionPending.test.ts | "counts only…" first assertion `:20` only (1 failed, 1 passed) | 0 / 0 |
| B1c | view `activeRunPhases: []` | webDispatch.test.ts -t "active run alone" | "says execution is pending on an active run alone…" `:326` "active run only: expected false to be true" | 0 / 0 |
| B1x (reviewer extra) | drop the `kind === "task"` filter in the store entry | executionPending.test.ts | **green** (Minor 1) | 0 / 0 |
| B1y (reviewer extra) | view maps every active run to `"work"` (ignores phase) | executionPending.test.ts | "an active estimate run alone…" `:31` `[true,false]` vs `[false,false]` — pins the view half independently of the store half | 0 / 0 |

Brief-named mutations 3/3 red on the named assertions; reviewer extras 1/2 red.

Logs: `/private/tmp/oec/mut/logs/B1{a,b,c,x,y}.{mutate,sha-before,sha-after,sha-restored,red.log,red.rc,restore-bytes}`;
specs in `/private/tmp/oec/mut/specs/B1*.json`.

## Re-run of the brief's Step 4 in the clone
6 files, 82 tests passed, 0 skipped (`/private/tmp/oec/logs/b1-rev-green.log`, rc=0); `npm run typecheck` rc=0
(`/private/tmp/oec/logs/b1-rev-typecheck.log`). Clone `git status --porcelain` empty after the runs.

`pgrep -fl "fake-ccloop|worker.js|vitest"`: none before, none after (exit 1 both times).

## ⚠️ Cannot verify from diff
- That no other caller depended on the old local `executionPending` or on `BUSY_WORK` being a mutable `Set` — checked
  by typecheck rc=0 in the clone (the function was module-private), so this is verified, not open.
- Overview gate behaviour (`controlOverview.ts:94-98` still counts any active run and `continuation`) is intentionally
  left divergent per the preamble interpretation; its "unreachable state" argument is not re-proven here.
