# Task 7 — independent mutation verification

You did NOT write this code. MEASURE whether each criterion can go red; do not fix anything. **A fully green mutation
is a finding, not a failure — say it plainly** (Task 6's L-3 was one: a fire-and-forget write raced a synchronous read).

Repo: `/Users/biran/code/skills/loop/Orca`. **The commit under test is named in your dispatch message.**
Read `CLAUDE.md` Rules 9, 14, 15, 17. The implementer's report is `.superpowers/sdd/2026-09-10-panel-e3/task-7-report.md`
(criterion names, files, predictions — trust nothing else in it). Controller rulings: `task-7-controller-notes.md`.

Code under test: `src/panel/api.ts` (POST /api/corrections, POST /api/reviews). Criteria: everything under `tests/panel/`
(and `tests/corrections/injectableClock.test.ts` if the implementer exported from it).

## Hard rules

**Exactly the "Hard rules" section of `task-6-mutations-brief.md` in the same directory** — read it and apply every
item: clone per mutation with both node_modules symlinks, exactly-once anchors, sha256 before/after (unchanged = broken
run), print the diff, byte-scan after every edit (0 control bytes; never type NUL-class escapes literally), whole-file
reads of vitest output with the `RUN` line inside the clone, compile/collection error = broken mutation, `cmp` of
`tests/panel/` (and any other criterion file touched) clone vs main tree before teardown, `/bin/rm -rf` of the clone,
baseline first, process + listener census around every run, `ls ~/.orca` before/after every mutation, loopback only.
Porcelain of the main tree may be non-zero because of controller files under `.superpowers/sdd/2026-09-10-panel-e3/`
and `.decisions/orca-dev-5d5c8055.jsonl`; what matters is that nothing under `src/`, `tests/`, `web/` appears and
that the byte count is unchanged before/after your run.

## ⚠️ Safety for C-5

C-5 makes the handler close the loop: it will write into a target repository's `.decisions/` and `git commit` there.
Before running it, print the fixture repo path the criterion uses (from the criterion source: it must come from
`makeTargetRepo()` under `$TMPDIR`) and confirm it is NOT `/Users/biran/code/skills/loop/Orca` or any path inside it.
The mutated code must take the repo path from the fixture's discovered repos, never from `process.cwd()`. If you
cannot make that guarantee from reading the code, do not run C-5 — report why.
After C-5, check `/usr/bin/git -C /Users/biran/code/skills/loop/Orca log -1 --format=%H` and the main tree porcelain
are unchanged.

## Mutations

Where your measurement differs from both predictions, do NOT declare a false red — investigate with the three
questions and report which explains it: (1) an earlier assertion short-circuits; (2) who else walks the changed line;
(3) where the literal in the named assertion comes from.

| id | change | controller prediction (measure it) |
|---|---|---|
| C-5 | after `recordNewCorrection`, close the loop into the fixture repo: `appendEvents` the rows `orca correct`'s closing mode derives (or a minimal `overturned`-shaped decision pair accepted by the writer) into that repo's `.decisions/` and commit that file | red in the does-not-close-the-loop criterion only, at its `.decisions/` snapshot or HEAD assertion |
| C-13 | the corrections handler stores `{ id: deriveCorrectionId(row), ...row }` with `recordCorrection` directly instead of `recordNewCorrection` | red in the seam's-own-named-refusal criterion and the empty-optional-field criterion — two (both refusals become a bare ZodError → 500) |
| K-7 | the correction row is built with `() => new Date()` instead of the panel clock | red in the golden-id criterion; also in the reviewed-row criterion only if that criterion asserts the CORRECTION's `at` (the reviewed row's `at` uses its own clock read) — say which |
| E-7 | the handler drops `chose_instead` when it is `""` | red in the empty-optional-field criterion only |
| C-14 | the already-recorded branch answers `err.message` as `message` | red in the second-correction criterion only |
| M-7 | both POST handlers skip the membership check | red in the 404-for-an-unlisted-decision criterion only |
| V-1 | `POST /api/corrections` does not append `reviewed` after recording | red in the writes-reviewed criterion; the reviews-lock-held corrections criterion expects 409 — with no append it answers 200, so it reddens too — two |
| V-2 | `POST /api/reviews` appends `action: "opened"` | red in the writes-reviewed criterion only |
| V-3 | `POST /api/reviews` catches the append failure and answers 200 | red in the failed-reviewed-write-reaches-the-person criterion only |
| V-4 | `POST /api/corrections` catches the `reviewed` append failure and answers 200 with the stored row | red in the correction-landed-but-reviewed-mark-failed criterion only |
| V-5 | `POST /api/corrections` appends `reviewed` BEFORE calling `recordNewCorrection` | red in the does-NOT-write-reviewed-when-refused criterion and the correction-landed-but-mark-failed criterion (the append fails first, nothing is recorded) — two |

If the implementer's report names criteria this table does not cover, say which are unpinned. If an anchor does not
exist exactly once because the implementation is shaped differently, write the smallest edit with the table's MEANING,
say so, and show the diff.

## Report

Per mutation: hashes, diff, RC, vitest summary lines, every failing criterion's **full name** with its first assertion
failure (expected vs received, file:line), then "matched" / "differs: <what, and which question explains it>". Add
census/listener results, any unhandled-error block, byte-scan counts, and for C-5 the fixture path and the proof this
repository's HEAD and porcelain did not move.

Write it to `/Users/biran/code/skills/loop/Orca/.superpowers/sdd/2026-09-10-panel-e3/task-7-mutations-report.md`.
No subagents. No edits in the main tree except that file. Final reply SHORT: one line per mutation, porcelain before/
after, `~/.orca` readings.
