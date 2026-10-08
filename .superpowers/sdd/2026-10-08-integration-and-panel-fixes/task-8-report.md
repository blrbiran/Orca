# Task 8 report: Decisions status filter

Commits (branch feat/integration-schemes): 1b4080b feat(panel): browse reviewed decisions and correct them; f9ac4d9 test(web): pin the status filter's own empty text.
Scratch evidence in $S: t8-red-api.txt, t8-red-web.txt (RED), t8-green-api.txt, t8-green-web.txt, t8-tc.txt, t8-wscheck.txt, t8-panel.txt, t8-mut-*.txt.

## What changed
- src/panel/coverage.ts: exported `reviewedKeys(reviews)` and `reviewFlags(d, reviewed)`; `unreviewedHighTier` now uses `reviewedKeys` (one key, one tier rule, no duplicate).
- src/panel/api.ts: `/api/decisions` rows = list row + `reviewed` + `highTier`. `/api/todo` code path untouched (still `listRows`).
- web: `fetchDecisions` (api.ts), `DecisionStatusRow` (types.ts), `rowsForStatus` + status select `filter-status` in DecisionsView, App state `status`/`allRows`, en+zh keys (filterStatus, status.*, nothingInStatus).
- Design choice: Unreviewed keeps reading /api/todo (home.todo). Why: it is exactly today's list, the sidebar badge (`home.todo.length`) and every existing criterion over that list keep their meaning and mocks; /api/decisions is read only when Reviewed/All is chosen (and re-read when home is re-read after a recorded review). `rowsForStatus(..., "unreviewed")` implements the same rule client-side (spec's wording) and is pinned by a unit test, but the page does not use it for the default.
- Empty-list text for Reviewed/All is its own sentence (the "every high-tier decision has been reviewed" text would be false there).

## RED evidence
t8-red-api.txt: 2 failed (strict-equal missing highTier/reviewed; flags undefined). t8-red-web.txt: 5 failed (rowsForStatus not a function; no filter-status select).

## Results (observed at f9ac4d9 tree)
- `npm run typecheck` rc=0. `npm run --ws check` rc=0 (76 files, 564 tests, before the extra empty-text test; web file alone rc=0 with it, 6 tests). `vitest run tests/panel` rc=0 (64 files, 488 tests). Load average at the time ~11 (uptime), no flake seen.

## Rewrite inventory
- tests/panel/decisionsApi.test.ts, "returns list rows DEEP-EQUAL ..." `toStrictEqual` (~:109): spec §9.2(1) adds two fields. Expected rows now add `reviewed: false, highTier: true`; still toStrictEqual, still hand-built from LIST_FIELDS. No other existing test changed.

## New criteria
- tests/panel/decisionsApi.test.ts: flags on three decisions (high+reviewed, low+reviewed, high+unreviewed); `/api/todo` body byte-compared (`toBe(JSON.stringify(...))`) against the hand-built pre-change shape.
- web/tests/decisionsStatusFilter.test.tsx: rowsForStatus unit; default = todo rows and /api/decisions not requested; Reviewed = 2 rows (any tier); All = 4; opening a reviewed decision shows the form and a second correction (mock 409 correction-already-recorded) shows the refusal message, code and the record-another button; empty Reviewed text.

## Mutations (clone under $S/mut-t8-a, mut-t8-b; node_modules symlinked)
| id | mutation | test | red assertion | restore bytes (diff/cached) |
|---|---|---|---|---|
| M1 | Reviewed = `highTier && reviewed` | decisionsStatusFilter | `['run/2'] to deeply equal ['run/2','run/3']` (+2 page tests) | 0/0 |
| M2 | Unreviewed drops `!reviewed` | decisionsStatusFilter | `['run/1','run/2'] to deeply equal ['run/1']` | 0/0 |
| M3 | All branch removed | decisionsStatusFilter | `['run/1'] to deeply equal [4 ids]`; length 4 vs 1 | 0/0 |
| M4 | server `reviewed` always false | decisionsApi | strictEqual of rows/flags | 0/0 |
| M5 | server `highTier` always true | decisionsApi | strictEqual of rows/flags | 0/0 |
| M6 | /api/todo uses the status-row builder | decisionsApi | byte compare `'{"rows":[...' to be ...` | 0/0 |
| M7 | reviewedKeys ignores `action` | todo.test.ts (b) opened-only row | `(b) keeps a high-tier decision whose only row is opened` red | 0/0 |
| M8 | App never fetches /api/decisions | decisionsStatusFilter | `[] to have a length of 2` | 0/0 |
| M9 | empty text branch removed | decisionsStatusFilter (added after it survived) | "says so, in the status' own words" red | 0/0 |
M9 first survived (rc=0): the new empty-text branch had no test; the test was added in f9ac4d9 and M9 re-run red.

## Notes
- Commit trailer uses the one the session's attribution reminder gives (Claude Sonnet 5.5), not common.md's Opus line.
- The Tier-0 gate blocked two of my compound commands (a `git -C $VAR` form and a subshell); nothing ran from them; redone as plain steps.
- progress.md not edited (it shows modified in the worktree from earlier, not by me).
