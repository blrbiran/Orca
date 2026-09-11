# Task P — independent mutation verification

You did NOT write this code. Your job is to MEASURE whether each criterion can go red, not to predict it and not to fix anything.

Repo: /Users/biran/code/skills/loop/Orca. Commit under test: 297a2ce (`feat(corrections): make the correction clock injectable and give the panel the one row constructor`).
Read `/Users/biran/code/skills/loop/Orca/CLAUDE.md` Rules 9, 14, 15, 17 first.

Files involved: `src/corrections/record.ts` (exports `correctionRowFrom(input, now)`), `src/corrections/correct.ts` (`correct(argv, opts = {})`),
new criteria `tests/corrections/injectableClock.test.ts`. Read them in the CLONE, not in the main tree.

## Hard rules

- The main working tree is never touched: all edits happen in a `git clone --local` copy. Before and after the whole run, record
  `/usr/bin/git -C /Users/biran/code/skills/loop/Orca status --porcelain -z > <file>; wc -c < <file>` (must be 0 both times) and
  `/usr/bin/git -C /Users/biran/code/skills/loop/Orca rev-parse HEAD`. Use `/usr/bin/git`, never plain `git` (a hook rewrites plain
  `git status` through rtk, which prints `ok` for empty output).
- Setup per mutation (fresh clone each time):
  ```
  C=$(mktemp -d)/orca
  /usr/bin/git clone --local --quiet /Users/biran/code/skills/loop/Orca "${C:?}"
  /usr/bin/git -C "${C:?}" checkout --quiet 297a2ce
  ln -s /Users/biran/code/skills/loop/Orca/node_modules "${C:?}/node_modules"
  ```
  Keep all of that in ONE shell invocation together with the edit, the run, and the teardown (shell variables do not survive between calls).
- The edit: whole-line anchor replacement with a script (python or node) that asserts the anchor matches EXACTLY ONCE and exits non-zero otherwise.
  Take `shasum -a 256` of the target file before and after; the mutation counts only if the hashes differ. Print the diff of the file
  (`/usr/bin/git -C "${C:?}" diff`) into the output file.
- Run: `cd "${C:?}" && ./node_modules/.bin/vitest run tests/corrections > <outfile> 2>&1; echo "RC=$?" >> <outfile>`. The whole `tests/corrections`
  directory, not one file. Read the output file WHOLE (never grep/tail/head/pipe a verifying run). Check the `RUN` line points at the clone path.
- Teardown: before deleting, `cmp` the clone's `tests/corrections/injectableClock.test.ts` against the main tree's (must be identical — you only
  mutate src). Then `/bin/rm -rf "$(dirname "${C:?}")"` (plain `rm` is aliased to `-i` and will hang).
- A failure that is a compile/collection/setup error is NOT a red criterion — report it as "broken mutation", not as red.
- Also run the UNMUTATED clone once first (baseline): all green expected; if not, stop and report.

## Mutations (anchors: find the exact line in the clone; if the code differs from the description, report and skip — do not improvise)

| id | file | change | hypothesis (a prediction, may be wrong — measure) |
|---|---|---|---|
| MP-1 | record.ts `correctionRowFrom` | the `at:` property stops using `now` and uses `new Date().toISOString()` | red in injectableClock criteria 1, 2, 3, 4 |
| MP-2 | correct.ts `correct` | the clock taken from `opts` is ignored: `now` becomes the wall clock regardless of `opts.now` | red in criteria 2, 3, 4; criterion 1 stays green |
| MP-3 | correct.ts `correct` | the DEFAULT clock (used when `opts.now` is absent) becomes `() => new Date(0)` | no prediction — measure which existing criterion (if any) notices the CLI stamping a wrong time |
| MP-4 | record.ts `correctionRowFrom` | the `by` property becomes the constant `"panel"` | no prediction — measure every red across tests/corrections |

For each mutation report: hash before/after, the diff hunk, RC, `Test Files`/`Tests` summary lines, and for EVERY failing test its full
name plus the first assertion failure (expected vs received, with file:line). Then one line: "hypothesis matched" / "differs: <how>".
For any mutation that stays fully green, say so plainly — that is a finding, not a failure of your work.

Write everything to `/Users/biran/code/skills/loop/Orca/.superpowers/sdd/2026-09-10-panel-e3/task-P-mutations-report.md`.
Do not dispatch subagents. Do not edit anything in the main tree except that report file.
Final reply: SHORT — per mutation one line (id, RC, number of failing tests, matched/differs), plus the two porcelain byte counts.
