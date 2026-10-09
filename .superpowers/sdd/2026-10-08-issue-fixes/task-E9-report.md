# Task E9 report
Commit f7e61b4 feat(web): draw the work-items graph always, filled by category, with live node text.

Implemented per brief: DependencyGraph (always drawn, category class, legend, nodeLines/runNumber, slow pulse), ControlGroupView passes runs+now, CSS tokens --cat-* in dark and both light blocks, en/zh locales, tests.

Deviations:
1. Pre-flight amendment 3: runNumber delegates to new runFacts.lineageRunNumber, which D6's taskRunNumber now also uses (one rule, not two).
2. E8 follow-up: the four *-subtle tokens (ok/warn/danger/info) are now also defined in both light blocks (light --ok/--warn/--danger/--info colours at 0.08).

Tests: focused 3 files 24/24 (scratchpad orca/E9/e9.txt); web check 86 files, 682 tests green (e9-web.txt); root typecheck rc=0. tests/panel not run green: web/dist absent (panel-dist-missing, environment; web-only change).

TDD RED: first run (e9-red.txt) red on styles (2) and contrast (1) for missing tokens. dependencyGraph.test.tsx failed to transform on my own test-splice syntax slip (fixed before implementing), so its expected-reason red was not observed separately; the mutations below show each new case can go red.

Mutations (in a git clone --local, all RED; outputs mut-m*.txt): m1 return null when no edges -> "draws every task..." red; m2 class "dep-node" -> class tests red; m3 >= STALL_MS -> stall test red; m4 n>2 -> step/attempt test red; m5 drop failed-before-provider filter -> runNumber expectation red; m6 delete reduced-motion rule -> pulse test red; m7 delete --cat-done from the light block -> token test red. Worktree diff and diff --cached: 0 bytes after. Clone left in scratchpad orca/E9/clone (rm -rf was denied).

Concern: contrast test pins the dark tokens only (existing harness reads the dark block); light category fills are unpinned.

## Fix round 1 (review D/task-E9-review.md) -- commit bc2db85
- New token `--stall` per theme block (dark #fbbf24; both light blocks #92400e); `.dep-node text.dep-stall` uses it instead of `--warn`.
- contrast.test.ts: the single dark-only node-text test is replaced by one looping over the dark and both light blocks (each block's own card and tokens), pinning text, text-strong and stall >= 4.5 on all five category fills (Minor 1 included).
- Verification: contrast + styles 12/12; web check 86 files green (fix1-web.txt).
- Mutations (clone after commit, old values): light stall #b45309 -> RED (4.29 on idle in data-theme=light); both light blocks old -> RED; dark stall #f59e0b -> RED (4.43 on waiting). Worktree untouched. Clone2 left in scratchpad (rm -rf denied earlier). Not separately mutated: the prefers-color-scheme media block alone.
- Note: the reviewer's 4.05 (running fill, light) was with --warn #b45309; the old value also fails on idle at 4.29 in the test's calculation.
