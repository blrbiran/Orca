# Task 2, fix round 1 — independent mutation verification of R-11

You did NOT write this code. MEASURE whether the new criterion can go red. Do not fix anything. A green mutation is a
finding, not a failure — state it plainly.

Repo: `/Users/biran/code/skills/loop/Orca`. **The commit under test is named in your dispatch message** (the fix-round
commit on top of `4bcaa9e`). Read `/Users/biran/code/skills/loop/Orca/CLAUDE.md` Rules 9, 14, 15, 17 first.

## What was fixed

`ReviewsWriter.append` (`src/panel/reviewsStore.ts`) used to check `this.seen.has(key(row))`, then `await` the lock and
the write, and only then `this.seen.add(key(row))`. Two concurrent `append` calls on the same instance with the same key
both passed the check before either added, so both wrote. The fix claims the key **synchronously**, before the first
`await`, and removes it again if the write throws.

The criterion added for it is a new `it` block in `tests/panel/reviewsStore.test.ts` that fires two `append` calls
concurrently and asserts exactly one "written", one "duplicate", and one row on disk. **Find its exact name in the
test file and in `.superpowers/sdd/2026-09-10-panel-e3/task-2-report.md` (Fix round 1 section); trust nothing else in
that report.**

## Procedure — identical to the first Task 2 mutation run

- Main tree never touched. Before and after: `/usr/bin/git -C /Users/biran/code/skills/loop/Orca status --porcelain -z
  > <file>; wc -c < <file>` and `/usr/bin/git -C … rev-parse HEAD`, always `/usr/bin/git`.
  ⚠️ Porcelain is expected to be non-zero because `.superpowers/sdd/2026-09-10-panel-e3/progress.md` (the controller's
  ledger) is being written while you work. What matters: **nothing under `src/`, `tests/`, `web/` or `.decisions/`
  appears in it**, and the list is otherwise the same before and after.
- One shell invocation containing setup, edit, run, teardown:
  ```
  C=$(mktemp -d)/orca
  /usr/bin/git clone --local --quiet /Users/biran/code/skills/loop/Orca "${C:?}"
  /usr/bin/git -C "${C:?}" checkout --quiet <commit from the dispatch message>
  ln -s /Users/biran/code/skills/loop/Orca/node_modules "${C:?}/node_modules"
  ln -s /Users/biran/code/skills/loop/Orca/web/node_modules "${C:?}/web/node_modules"
  ```
- Baseline first: unmutated clone, `cd "${C:?}" && ./node_modules/.bin/vitest run tests/panel/reviewsStore.test.ts
  > <out> 2>&1; echo "RC=$?" >> <out>`, reading the output WHOLE. All criteria green expected (there are 9 now: the
  original 8 plus the concurrency one). If not, stop and report.
- Edit by a python/node script with an **exactly-once anchor assertion**; `shasum -a 256` before/after must differ —
  an unchanged hash means the mutation never landed, which is a broken run, not a green.
- A compile/collection error is a broken mutation, not a red.
- Teardown: `cmp` the clone's `tests/panel/reviewsStore.test.ts` against the main tree's (identical), then
  `/bin/rm -rf "$(dirname "${C:?}")"` (local `rm` is aliased to `-i`).

## The mutation

| id | change | prediction (measure it) |
|---|---|---|
| R-11 | in `src/panel/reviewsStore.ts`, move the synchronous `this.seen.add(key(row))` back to AFTER the write completes (i.e. restore the pre-fix ordering: check, await lock, await write, then add) | red in the new concurrency criterion. Whether the two pre-existing dedupe criteria (`skips a row it already wrote in this process…`, `picks up rows an earlier process wrote…`) also go red is **open — measure it**: they await each append in sequence, so the ordering change may well leave them green. Report exactly which criteria failed |

Also report, from the mutated run, whether any criterion failed for a reason OTHER than the dedupe assertion (e.g. a
leftover key after a thrown write) — that would mean the fix's rollback path is what the criterion is really pinning.

If your measurement differs from the prediction, do NOT declare a false red. Investigate with the three questions and
say which explains it: (1) does an earlier assertion short-circuit? (2) who else walks the changed line? (3) where does
the literal in the named assertion come from?

## Report

Hash before/after, the diff, RC, the vitest summary lines, and for every failing criterion its full name plus the first
assertion failure (expected vs received, file:line). Append it to
`/Users/biran/code/skills/loop/Orca/.superpowers/sdd/2026-09-10-panel-e3/task-2-mutations-report.md` as a
"Fix round 1 — R-11" section (do not rewrite what is already in that file).
No subagents. No other edits in the main tree.
Final reply SHORT: R-11's RC, the failing criteria count and names, matched/differs, and the two porcelain readings.
