# Task D4 report: retry-task's preconditions and refusals

Implementer: D4 (session e34dc963 subagent), 2026-10-09. Base 707bb40. Commit:
- 54f76a2 feat(control): refuse retry-task unless the task's current run ended in a ccloop failure the reserve can retry

Status: DONE_WITH_CONCERNS (one wording concern; see the end of this report)

## What was implemented
- `src/control/errors.ts`: `"task-not-retryable": 409` in the 409 block, placed after `task-loop-version-conflict`, with the spec comment.
- `src/control/retryTask.ts`: the brief's guards, in the spec's order. These are: clarifying → `group-state-invalid:clarifying`;
  `group.stopped` or a stop intent → `stop-mode-conflict`; no current run → `task-not-retryable:no-run`; inactive run or
  state ≠ blocked → `run-state:<s>`; drive missing or blockedAt ≠ C → `blocked-at:<step|none>`; outcome null or succeeded →
  `outcome:<o|none>`; latest handoff request in ADOPTABLE_STATES → `handoff-request-open:<id>`; unknown.work/handoff →
  `usage-unknown`; a usage event above highWater → `usage-pending`. After those guards, a per-dimension reserve loop refuses
  with `group-reserve-insufficient:<dim>:<shortfall>` when grant − remainder − unallocated reserve > 0. Every guard throws
  before the first write. The command ledger then rolls the transaction back, and the tests confirm that the run stays
  blocked and active, that no task-retried row is written, and that the ledger is equal to its earlier value. No archived
  check was added (Part E).
- `web/src/locales/en.ts` / `zh.ts`: the brief's `task-not-retryable` entries. The en entry uses `{{detail}}` and does not
  contain its own code.
- `tests/control/retryTask.test.ts`: the brief's `writeHandoffRequest` import, the `poke`, `refusal` and `unchanged` helpers,
  and the "retry-task refusals" describe (5 `it`s). They are written as in the brief.

## TDD
- RED: `vitest run tests/control/retryTask.test.ts` → rc=1. 5 failed and 4 passed. The 5 failures are the 5 new `it`s:
  no-run gave `run-not-found`, and the other four were accepted (`code: 'accepted'`). Output: scratchpad `orca/D4/d4-red.txt`.
- GREEN: the same command → rc=0, 9/9 (`d4.txt`). `npm run typecheck` → rc=0 (`tc.txt`).
- Suites, after `npm run build --workspace web`:
  - `vitest run tests/control tests/panel tests/entry` → rc=0. 211 files passed and 8 were skipped. 2052 tests passed and
    54 were skipped (`suite.txt`). Load was 3.98 at the start and 8.45 at the end. refusalCoverage.test.ts is included.
  - `npm run --workspace web check` → rc=0: 82 files and 645 tests (`webcheck.txt`).

## Mutations
The clone was a `git clone --local` made at 54f76a2. Each mutation deleted one guard line, or the en or zh entry, and the
named test was run on it. Script: `orca/D4/mutate.py`. Outputs: `orca/D4/mut-<name>.txt`. All 12 runs gave rc=1, and each
went red at the named expectation:
- no-run → "refuses a task with no run…" :149 (got `run-not-found`)
- run-state → same `it` :152 (got `blocked-at:none`)
- outcome → "refuses a run blocked for any other reason…" :162 (`outcome:succeeded`, accepted)
- blocked-at → same `it` :171 (`blocked-at:E`, accepted)
- handoff → "refuses while a handoff request is open…" :180; usage-unknown → :183; usage-pending → :186 (all accepted)
- stop → "refuses a stopped group…" :196 (accepted)
- clarifying → same `it` :202. It got `requirement-not-split`, so without this guard a clarifying group would still be
  refused, but under the wrong code.
- reserve loop → "refuses when the reserve cannot cover…" :217 (accepted)
- en entry removed, then zh entry removed → refusalCoverage.test.ts went red in two tests each time: "has a <lang> entry for
  every catalog code…" and "keeps the two tables over the same codes".

Worktree `git diff` and `git diff --cached` (/usr/bin/git) were 0 and 0 bytes both before and after. The clone is still
at scratchpad `orca/D4/clone`. I left it in place rather than deleting it recursively.

## Deviations
1. zh entry placement: the brief says to put it after `task-already-started`. I put it after `task-loop-version-conflict`
   instead, in both locales, so the alphabetical key order of the tables is kept ("keep its key order").
2. `group-reserve-insufficient`: I made no change. The brief's condition is whether Part A's en entry names the budget
   editor, and it already does ("…in the budget editor, then try again.").

## Concerns
- The zh `group-reserve-insufficient` entry is still `"组余量不够：{{message}}"`, which does not point at the budget editor
  (spec §4.2(2)). The brief only made a change conditional on the en entry, so I left zh as it is. A follow-up could adopt
  the brief's zh text, or keep the zh `{{message}}` convention (Part A ruling 5) and add "请在预算编辑里调高组上限后再试".
- The stop test asserts only `.code` for `stop-mode-conflict`, as the brief wrote it. The message carries no detail.

## Fix round 1 (review findings; base c57493f, commit bda8baf)
Commit: bda8baf fix(control): point the zh reserve refusal at the budget editor and pin each half of retry-task's stop and reserve checks

- **Important:** the zh entry for `group-reserve-insufficient` is now
  `"组余量不够：{{message}}。请在「预算提案」里调高「组上限」或调低别的分配，然后再试。"`.
  - It keeps the zh `{{message}}` convention.
  - The names are the labels the UI shows in zh: the budget region is `budget.region` "预算提案", and its limit field is
    `budget.groupLimit` "组上限".
  - It mirrors the en text: "raise the group limit or lower another allocation in the budget editor".
  - No test pins this wording. refusalCoverage only checks that the key exists, so a later edit could drop the pointer
    without any test failing.
- **Minor, stop guard:** a new test, "refuses on either half of the stop guard alone…", covers each half separately.
  - Case 1: `stopped=true` is set by json_set, and the test asserts 0 stop_intents rows.
  - Case 2: pause-dispatch creates the intent, `stopped=false` is then set by json_set, and the test asserts 1 stop_intents row.
  - Both cases expect `stop-mode-conflict` and `unchanged`. I made this a separate `it` rather than extending the existing
    one: 4 harnesses in one `it` timed out at 5 s under load 7.6.
- **Minor, handoff half of the reserve check:** a new test, "counts the handoff bucket in the net reservation…", covers it.
  - set-limit leaves exactly the work net (10 tokens) unallocated.
  - The run's handoff bucket is then poked to show 5 spent tokens (`remaining.handoff.tokens -= 5`, cumulative +5), which
    makes the net 15.
  - The test expects `group-reserve-insufficient:tokens:5`, an unchanged ledger, and `unchanged`.
  - The poke comes after set-limit because, the other way round, the ledger audit refuses set-limit with `recovery-blocked`
    (measured).
  - The fake port gives a failed run no handoff usage, so the handoff spend is written directly.

### Verification
All outputs are in scratchpad `orca/D4/`.
- retryTask + refusalCoverage: rc=0, 16/16 (`f1.txt`), and rc=0 again after the split.
- Those two files together with activityRuns and driverRequirementSplit: rc=0, 37/37 (`f1-alone.txt`).
- typecheck: rc=0.
- web check: rc=0, 83 files and 649 tests (`f1-web.txt`).
- tests/control, first run (`f1-control.txt`, load 2.09 → 7.65): rc=1, with 4 timeouts at 5 s.
  - The 4 were activityRuns "a driver run gets endedAt…", driverRequirementSplit "fails the third consecutive…", and two
    retryTask refusal `it`s.
  - All of them passed when run alone, and I split the heavy `it` (see the stop-guard item above).
- tests/control, second run (`f1-control2.txt`, load 5.63 → 8.92): rc=1, 1529 passed. The only failure was a 5 s timeout
  in driverRecovery "drives a retried run on…", a registered load flake. That file run alone gives rc=0, 8/8 (`f1-recovery.txt`).

### Mutations
The clone `orca/D4/clone-f1` was made at bda8baf. The script is `mutate-f1.py`, and each output is in `mut-f1-<name>.txt`.
- Drop `group.stopped ||`: red at :212 (the stopped-only case, accepted).
- Drop `|| readStopIntent(...) !== null`: red at :221 (the intent-only case, accepted).
- Make the reserve loop count only the work bucket (`work.grant.work[d] - run.remaining.work[d]`): red at :256 in the
  handoff test (accepted).

The worktree `git diff` and `git diff --cached` were 0 and 0 bytes both before and after.
