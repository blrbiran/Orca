# Task E7 report
Commit dd06449 feat(web): place each group in a list category (web/src/groupCategory.ts, web/tests/groupCategory.test.ts), brief code verbatim.
TDD: test first -> rc=1 (module missing); after implementing -> rc=0, 9/9. `npm run typecheck` rc=0; `npm run --workspace web check` rc=0.
Mutations (local clone, worktree untouched): swap archived/attention lines -> "takes the first match" red; drop `|| state === "review"` -> rule 4 red; readGroupFilter body without guard -> "answers All..." red.
Deviation: new files needed `git add` before the pathspec commit (first commit attempt failed with pathspec error, nothing committed).
Uses GroupSummaryV1 as E2 left it (counts?, archived?, completion? optional; handled with ?? defaults).

## Fix round 1
Commit: fix(web): tolerate a summary without stopState, counts or completion. stopState != null; new test with counts/completion/stopState deleted -> not-started. Mutations red: removing ?. / ?? 0; reverting != to !==. Typecheck rc=0. Exports unchanged.
