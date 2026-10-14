# Brief: feedback #59 (Runs table sorted by UUID) + #61 (attempt count unclear)

Repository: Orca, worktree /Users/biran/code/skills/orca/Orca-wt/web-start-running, branch fix/web-start-group-running. Read /Users/biran/code/skills/orca/Orca-wt/omp-single-call/.superpowers/sdd/2026-10-14-omp-single-call/hard-rules.md (use THIS worktree), CLAUDE.md, web/DESIGN.md first. Re-read every location (Rule 8); line numbers are approximate.

## #59
- Triage: src/panel/controlViews.ts ~826 sorts the group's runs with `compareText(left.id, …)` (UUID order ⇒ random to a human). `snapshot.runsByRowid` is already insertion order; `startedAt` is exposed on the run view.
- Do: order runs by insertion (rowid) order — the order they were created — or by startedAt then rowid; pick whichever the existing data guarantees (a run may lack startedAt before it starts: rowid is total). State the choice and why. Newest-first vs oldest-first: follow what the Runs table's UI expects today (read web/src for any reversal) and say which you kept.
- Constraint (handoff §5.2.7): read views sort with `compareText`, never `localeCompare`; sorts that are persisted or feed a hash must not change — check that this run list is NOT hashed/persisted/compared by any criterion (grep for its consumers, including projection hashes and golden fixtures) before changing it. If it is, STOP and report.
- Criterion: a group with ≥3 runs whose ids sort differently from creation order; assert the view returns creation order. See it red first.

## #61
- Triage: the per-run attempt counter is deliberately per ccloop run (controlViews.ts ~630 comment "never mixed with Orca's grant"). Do NOT change the field's meaning.
- Do: change the visible label so it says it is the attempt within this run (en and zh, via t(); e.g. "Attempt n in this run" / "本 run 内第 n 次"), and add a column (or cell text) with the task's run number (`taskRunNumber`, which TaskDetail already shows — reuse its source; do not recompute differently).
- Strings: existing tests may pin the old label text. If any existing test asserts the old label, STOP and report it (human names rewrites) instead of editing it. Run root tests/panel/scanPanelText.test.ts and tests/metrics.
- Criterion: DOM test (`// @vitest-environment jsdom`) that the Runs table shows the new label and the task run number for a task with 2 runs; red first; also assert the zh text in full and run a "put the English back" mutation.

## Both
- Mutations in a `git clone --local` copy under /private/tmp/osc/mut/w5961: revert the sort; revert the label; drop the run-number cell — each red on its named assertion; restore via cat, sha256, git diff/--cached 0 bytes.
- Gates: root typecheck; web tsc (`cd web && npx tsc --noEmit -p tsconfig.json`); `npm run build --workspace web`; web full tests; root tests/panel tests/metrics and tests/control/controlViews*-type files you touched. Redirect to /private/tmp/osc/logs/w5961-*.log, read whole, RC. Known web load flakes (each 3/3 alone): reviewApp, controlCommandRecovery, loopPlanDraft, projectSwitcher — rerun a red file alone 3x before calling it a flake.
- Commit(s) `git commit -F`: fix(panel)/fix(web) prefixes; trailers per hard-rules.

## Report
You cannot write report files. Final message: choices and why, consumers checked for the run order (file:line), RED/GREEN, mutation table (sha256, red line), gates with RC, commits. Then the short status contract.
