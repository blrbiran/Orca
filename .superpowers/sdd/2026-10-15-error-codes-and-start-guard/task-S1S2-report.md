# Report S1 + S2 (branch feat/error-codes-start-guard)

## S1 — commit 781f9cee
- Red (/private/tmp/oec/logs/s1-red.log, rc=1): runAttemptLabel 2/2 red; controlI18n 2 red (the two human-named criteria, old text).
- Implemented per brief verbatim (runFacts.runNumberOf, ControlGroupView, en/zh attempt + taskRun). Rewrites in controlI18n.test.tsx carry the #61 comment; only the two named criteria edited.
- Green targeted (s1-green.log): 7 files, 52 tests, rc=0.
- FULL web suite (s1-fullweb.log): 130 files, 1120 tests passed, rc=0.
- web build rc=0; root scanPanelText + tests/metrics: 10 files, 68 tests, rc=0; root typecheck rc=0; web tsc rc=0.
- No mutations run (reviewer's).

## S2 — commit 8355528b
- Added "codex-rate-limited" (with the brief's comment) after "codex-exit-error," in VIEW_REASONS. refusalCoverage.test.ts: 6/6 green (s2-green.log); typecheck rc=0.

## Fix round 1 (S1, review Important finding)
- Test only: runAttemptLabel.test.tsx gains a describe with a failed-before-provider run and a taskId-null estimate run (literal "attempt N in this run", no "of this task" / "这个任务的第") plus a counted run showing "run 1 of this task" (en and zh). 4/4 green (s1-fix1-file.log). Not yet seen red under S1e: reviewer to re-run it.
- Full web suite and web tsc: see s1-fix1-fullweb.log / s1-fix1-webtsc.log.

## Fix round 2 (S1e still green after round 1)
- Fixture reordered: task b = counted (created 1), failed-before-provider (2), counted (3), plus the taskId-null estimate run (4). Expect run 1 / no number / run 2 (en and zh literals).
- Own S1e proof in scratch clone /private/tmp/oec/mut/s1fix2 (detached copy of b22a1b57 + the new test file; S1e = replace the guard line in web/src/runFacts.ts with `lineageRunNumber(lineage, createdUpTo);`): `vitest run tests/runAttemptLabel.test.tsx` rc=1, 2 failed (en and zh), on `expect(failed).not.toContain("of this task")` / `"这个任务的第"` (received "... run 1 of this task"). Log s1-fix2-s1e.log. Clone's runFacts.ts then restored from the worktree (git diff on web/src 0 bytes).
- Worktree: file 4/4, full web 130 files / 1122 tests, web tsc rc=0 (s1-fix2-*.log).
