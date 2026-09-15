# Task 8 — independent mutation verification

You did NOT write this code. MEASURE whether each criterion can go red; do not fix anything. **A fully green mutation
is a finding, not a failure — say it plainly.**

Repo: `/Users/biran/code/skills/loop/Orca`. **The commit under test is named in your dispatch message.**
Read `CLAUDE.md` Rules 9, 14, 15, 17. The implementer's report is `.superpowers/sdd/2026-09-10-panel-e3/task-8-report.md`
(criterion names, files, predictions — trust nothing else). Controller rulings: `task-8-controller-notes.md`.

Code under test: `web/src/**` (MetricsView, DecisionList, DecisionDetail, PanelHome, the web types module),
`src/panel/coverage.ts` (`unreviewedHighTier`), `src/panel/api.ts` (`GET /api/todo`).
Criteria: `web/tests/**`, `tests/panel/**` (including the parity and todo criteria).

## Hard rules

**Exactly the "Hard rules" section of `task-6-mutations-brief.md` in the same directory** — read it and apply every
item (clone per mutation with both node_modules symlinks, exactly-once anchors, sha256 before/after, diff, byte-scan
after every edit and never type NUL-class escapes literally, whole-file reads, `RUN` line inside the clone,
compile/collection error = broken mutation, `cmp` of every criterion file clone vs main tree before teardown,
`/bin/rm -rf` of the clone, baseline first, process + listener census, `ls ~/.orca` before/after, loopback only).
Porcelain of the main tree may be non-zero because of controller files under `.superpowers/sdd/2026-09-10-panel-e3/`
and `.decisions/orca-dev-5d5c8055.jsonl`; nothing under `src/`, `tests/`, `web/` may appear, and the byte count must be
the same before and after. Never `git stash` or write in the main tree.

**Three runners in this task** — for every mutation run all three in the clone, each redirected to its own file and
read whole:
1. root criteria: `./node_modules/.bin/vitest run tests/panel`
2. web criteria: `cd "${C:?}/web" && ../node_modules/.bin/vitest run` (confirm from the output that it used
   `web/vite.config.ts` and that its `RUN` line points into the clone's `web/`; if that invocation does not work, use
   whatever `npm run check --workspace web` runs and say so)
3. root typecheck: `cd "${C:?}" && ./node_modules/.bin/tsc --noEmit -p tsconfig.json` and web typecheck
   `cd "${C:?}/web" && ../node_modules/.bin/tsc --noEmit -p tsconfig.json` (report each RC; a typecheck red is only
   the landing for P-8b — for every other mutation report a typecheck red as a broken mutation unless the table says
   otherwise)

## Mutations

Where your measurement differs from both predictions, do NOT declare a false red — investigate with the three
questions and report which explains it: (1) an earlier assertion short-circuits; (2) who else walks the changed line
(the annotations share one view — say which criteria read each rendered string); (3) where the literal in the named
assertion comes from — E2's report or the panel's own `PanelCoverage`.

| id | change | controller prediction (measure it) |
|---|---|---|
| F-4 | `MetricsView` renders `numerator_corrections_excluding_stale / denominator_decisions` as a percent instead of `rate_excluding_stale` | red in the renders-the-rate-the-server-sent criterion; also in any other criterion asserting the `99` text — name them |
| F-4b | `MetricsView` stops rendering all of E2's annotations (coverage reason, both caveats arrays, unresolved, malformed, stale bias, excluded as future) | red in the five-annotations criterion and the prints-the-whole-report-even-when-malformed criterion — two; the panel coverage caveat criterion stays green (its string is `PanelCoverage.caveat`, not E2's) |
| F-4c | `MetricsView` stops rendering only `review_coverage.reason` | red in the five-annotations criterion only |
| F-5 | the null-rate formatter prints `0%` for null | red in the null-coverage criterion only |
| F-6 | `DecisionList` renders every key of the row object | red in the list-renders-only-list-fields criterion only |
| P-8 | web `WEB_LIST_FIELDS` gains `"question"` | red in the root runtime parity criterion for the list fields only; report both typechecks (the constant may be typed against the web row type) |
| P-8b | rename `rate_excluding_stale` → `rate` inside the web `CorrectionRate` type and follow it in the view and the web fixture | root typecheck RC≠0 naming the parity file; web typecheck and both vitest runs green |
| T-1 | `unreviewedHighTier` ignores reviews | red in the reviewed-high-tier-excluded pure criterion and the HTTP todo criterion — two |
| T-2 | `unreviewedHighTier` treats `opened` as reviewed | red in the opened-only-still-listed criterion only |
| T-3 | `unreviewedHighTier` drops the tier condition | red in the low-tier-excluded criterion only (check whether the HTTP fixture has a low-tier decision) |
| T-4 | `unreviewedHighTier` keys reviews by decision id alone | red in the other-projectKey criterion only |
| H-1 | `PanelHome` renders the metrics view before the todo list | red in the todo-first criterion only |

If the implementer's report names criteria this table does not cover, say which are unpinned. If an anchor does not
exist exactly once because the implementation is shaped differently, write the smallest edit with the table's MEANING,
say so, and show the diff.

## Report

Per mutation: hashes, diff, the RCs of all runners, summary lines, every failing criterion's **full name** with its
first assertion failure (expected vs received, file:line), then "matched" / "differs: <what, and which question
explains it>". Add census/listener results, any unhandled-error block, byte-scan counts.

Write it to `/Users/biran/code/skills/loop/Orca/.superpowers/sdd/2026-09-10-panel-e3/task-8-mutations-report.md`.
No subagents. No edits in the main tree except that file. Final reply SHORT: one line per mutation, porcelain before/
after, `~/.orca` readings.
