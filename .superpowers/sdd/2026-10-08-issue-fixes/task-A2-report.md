# Task A2 report
Status: DONE. Commit 6c19224 "fix(requirements): hand back one split reason per Web import item".
Implemented: exported `importReasons(error)` in src/control/requirementSplit.ts (split detail on "\n", prefix "import:"; no detail -> code); validateSplitDraft's import refusal uses it; doc comment updated. New tests/control/requirementSplitItems.test.ts (verbatim from brief).
Not redone: the requirementSplit.test.ts rewrite and comment (A1 already landed both; verified present).
TDD RED: vitest run requirementSplitItems + requirementSplit -> rc=1; one reason "import:missing-goal\nmissing-success-conditions", and importReasons is not a function; requirementSplit.test.ts passed. GREEN: tests/control/requirement*.test.ts rc=0 (11 files, 138 passed, 1 skipped); npm run typecheck rc=0.
Mutation (clone, after commit): line reverted to single `import:${detail ?? code}` -> "hands back one import reason per item" RED. Worktree diff/diff --cached 0/0 bytes before and after.
Deviations: none. Concern: an earlier aborted clone dir (clone/) remains in scratchpad; harmless.
