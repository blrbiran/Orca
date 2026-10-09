# Task E6 report
Commit 0b33417 docs(skill): teach the agent what archive does to other commands and its guard codes.
Scope per E3 ruling: only the SKILL.md Notes sentence + phrase-list additions (route rows, schemaByVerb, counts 32 were already in bcf5584).
TDD: added 3 phrases -> `vitest run tests/entry/skill.test.ts` rc=1 (teaches-the-rules red: missing phrase). Appended Notes sentence -> rc=0, 6/6.
Mutation (local clone): deleting the archive-group row -> 3 tests red (routes/verbs/payload); deleting the Notes sentence -> "teaches the rules" red.
Files: skills/orca-control/SKILL.md, tests/entry/skill.test.ts. Output files under scratchpad/orca/E6/.
Note: the worktree has other implementers' uncommitted changes, so a whole-tree `git diff` is not 0 bytes; my paths were clean after the mutation (clone only).

## Fix round 1
Commit: fix(skill): state exactly when archive-stop-pending applies. Notes now say pending/unresolved block, complete/partial allow, pause never blocks; new phrase pins it (mutation dropping "a pause never blocks" -> skill test red). Tests rc=0.
