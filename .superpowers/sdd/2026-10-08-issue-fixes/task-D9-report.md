# Task D9 report — real-ccloop E2E: retry-task after a ccloop failure, run 2 lands

Implementer: D9 (session e34dc963), 2026-10-09. Status: DONE_WITH_CONCERNS.
Commit: 34142f9 `test(control): retry a task after a real ccloop failure and land its second run` (one file,
tests/control/executionDriverE2E.test.ts, +39 lines, additive; pathspec commit).

## Implemented
New `it` "R-F: retry-task after a ccloop failure settles the run as settled-failed, and run 2 lands" after T1, before the
R1 `it.each`; imports `mkdtemp, rm, writeFile` (node:fs/promises), `tmpdir` (node:os), `taskRunNumber` (web/src/runFacts.js).
All brief assertions are kept verbatim (Part D ruling 8: outcome != succeeded and a stopReason string on run 1; view
state/stopReason/outcome; retry result; immediate settled-failed view; run 2 lands; run states map; taskRunNumber 2;
orca/g:a.txt = "A"; empty workspaces root; clean shutdown). No production change.

## Deviation from the brief (measured) — the failure scenario
The brief failed run 1 by giving fake codex no script entry (exit 3 at execute). Against real ccloop c82b212 that cannot
pass, by design:
- Run 1 blocks with outcome `failed`, stopReason `Error: codex-exit-error: <evidence path>`, but usage event seq 2 has
  `cumulative: null`, so the run carries `unknown.work: true` (probe1.txt).
- retry-task refuses: `task-not-retryable:usage-unknown` (d9-green1.txt) — spec §4.2(2) requires this refusal.
- Probe with that guard removed in a scratch clone (probe-noguard.txt, probe-stall.txt): run 1 becomes settled-failed and
  is cleaned (D7 works), the task is `ready`, but no run 2 is ever claimed — `webDispatch.ts:215` blocks dispatch on the
  group's `ledger.usageUnknown`, and `requirementCalls.ts:77` notes v1 has no command that clears unknown usage.
Ruling taken (Rule 1, reversible, test-only): run 1 instead fails at a command check `test -e <flag>` (flag file in a
mkdtemp dir outside the workspace, removed in `finally`), verifierType command, script entry present. Real ccloop ends it
outcome `failed`, stopReason `"verifier rejection with no safe retry path"`, usage known; the test creates the flag, then
retry-task. The deviation is explained in a comment above the `it`.

## Environment
- Worktree /Users/biran/code/skills/loop/Orca-issues; ECC_GATEGUARD=off DISABLE_OMC=1.
- ORCA_CCLOOP_BIN=<scratch>/orca/D9/ccloop-c82b212/dist/cli.js (absolute, no `..`): `git clone --local` of
  /Users/biran/code/skills/loop/ccloop, checkout c82b21261cf45c8a615a75ef2e724c1173176920, node_modules symlinked from the
  original, `npm run build` rc 0. The clone was never mutated.
- ORCA_AGENTS_TABLE=<scratch>/orca/D9/agents.json: codex installation = that clone's fake-codex.mjs in `integration` mode
  (gate parity per handoff §3; the E2E world writes and passes its own `script`-mode table to the runtime).
- HOME/XDG relocation is the file's own `relocateHome` (Rule 17); its afterEach empty-home check passed.

## Results (binary set; uptime load 5–20 throughout)
- RED before (brief scenario, worktree): rc 1, `task-not-retryable:usage-unknown` (d9-green1.txt).
- GREEN after: `-t "R-F"` rc 0, 1 passed / 9 skipped (d9-green.txt, 40.8 s); whole file rc 0, **10/10 passed**
  (d9-file.txt, 171 s); `npm run typecheck` rc 0 (tc.txt).

## Mutations (clone `git clone --local` of the worktree at 34142f9, made after the commit; run with the binary set)
1. Retry-task call + its result assertion removed → red: view runs `["blocked"]` ≠ `["settled-failed"]` (mut-1-no-retry.txt).
1b. Same plus the immediate view assertion removed → red: timeout "run 2 to land and both runs to be cleaned"
   (mut-1b-no-retry-no-view.txt) — the flag alone does not land run 2.
2. D2 `...stopReason` dropped in stepC's blockRun → red at `typeof first.body.drive.stopReason` ('undefined')
   (mut-2-stopreason.txt).
3. D7 settled-failed clause removed from `driverRunIds` → red: timeout at the land wait, line 174
   (mut-3-driverrunids.txt). The first attempt at this mutation was syntactically broken (the comment swallowed the
   closing paren; transform error) and is not counted; the redo removes the clause and its comment and was seen red.
Worktree proof: my file's `git diff` and `git diff --cached` both 0 bytes before and after; the clone was discarded. The
worktree's other uncommitted files belong to concurrent implementers (E5/E8) and were not touched.

## Concerns
1. **Product gap (for the controller):** the most common real failure — codex crashing at execute without reporting
   usage — leaves unknown usage, so retry-task refuses it and the whole group's dispatch stays blocked forever (no v1
   command clears unknown usage). Issue 16's "retry a failed task" therefore does not cover that shape. Spec §4.2(2)
   mandates the refusal; changing it needs a spec decision (e.g. treat a failed phase's null usage as known-zero, or a
   command to settle unknown usage).
2. stopReason for a codex exit is `Error: codex-exit-error: …`; check `codex-exit-error` has an en/zh explanation entry
   (spec §4.2(1) list does not name it).
3. The flag file lives in a mkdtemp under the file's scoped tmpdir and is removed in `finally`.
