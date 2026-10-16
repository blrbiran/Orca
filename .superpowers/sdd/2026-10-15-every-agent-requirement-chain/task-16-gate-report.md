# Task 16 Steps 1-2 -- wording scan and Orca full gate report

Measured in session a852f96a on 2026-10-16 (14:09-15:30). Measurement only: no repo file edited, no commit.
Orca branch `codex/every-agent-chain`, gate tip `e2bfdc0e81d0f68eeea10471d570a0f7acbaeb41` (`/usr/bin/git -C $G/repo rev-parse HEAD` after the clone).
NOTE: at the end, the worktree's HEAD read `88314f5ce1d59da9d16a446779375de79e7c93c2` -- it moved after the clone was taken; this gate covers e2bfdc0e only.
Clone `G=/private/tmp/org-Udn7` (`repo/`, `agents.json`); node_modules and web/node_modules symlinked to the WORKTREE's own. `TMPDIR=/private/tmp/cl-KAcu`,
`CCLOOP_CACHE_DIR=$G/ccache`, `ORCA_CCLOOP_BIN=/private/tmp/ccb3-ezF4/repo/dist/cli.js` (ccloop d9cb32c build, not mutated), `ORCA_AGENTS_TABLE=$G/agents.json`
(fake-only: one codex install, fake-codex.mjs `integration` mode, budgetMode soft). Logs: `/private/tmp/claude-501/-Users-biran-code-skills-orca-Orca/a852f96a-f3c8-4721-9df4-b10c19154451/scratchpad/logs/t16-*`. Scripts: `$SCRATCH/t16-run.sh`, `t16-alone.sh`, `wording.py`.
Load: 7.9 at start, 9-32 during (see `t16-progress.txt`); the machine was shared with other sessions' processes, not idle.

## Step 1 -- wording scan (`t16-wording.log`)
Scanner self-test passed (must-catch both caught, must-not both clear). Roots: web/src, README.md, SKILL.md (SKILL.md does not exist in the worktree: reported MISSING).
**HITS 1, RC 0 -- not the expected HITS 0:**
`web/src/locales/en.ts:824: codexUnsupported: "Codex does not support bounded single-call clarification. Choose Claude, or import a plan in Task control."`
(its zh twin is `web/src/locales/zh.ts:719`, not matched by the English regex). `grep -rn codexUnsupported web/src src` shows only those two definitions: no consumer,
so it is a dead string that now states something false under the spec §6.2 rule. Suggested patch (not applied): delete both keys, or reword. Needs the controller's ruling.

## Step 2 -- gate segments (each with its own RC)
| # | command | RC | counts as printed |
|---|---|---|---|
| 1 | npm run typecheck | 0 | tsc clean |
| 2 | npm run build | 0 | |
| 3 | npm run build --workspace web | 0 | built before tests |
| 4 | npm test -- --reporter=json --outputFile=t16-vitest.json | **1** | JSON: 3889 total, 3842 passed, 14 failed, 33 pending (skipped); suites 1163 / 1147 passed / 16 failed. Log: control-protocol evidence line names the d9cb32c build. |
| 5 | node scripts/check-claude-md-lines.mjs | 0 | "CLAUDE.md is 150/200 lines" |
| 6 | node scripts/check-hooks-path.mjs | **1** | `core.hooksPath is "", expected "scripts/githooks"` -- artifact of the fresh `git clone --local` (the worktree has `scripts/githooks`). Environment red of the clone, not code. |
| 7 | npm run verify:control | **1** | Test Files 2 failed / 192 passed (194); Tests 3 failed / 1978 passed / 30 skipped (2011) |
| 8 | npm run verify:scheduler | 0 | 56 files, 202/202 |
| 9 | npm run verify:chain | **1** | gate-check 13 files 213/213, then full run: Test Files 1 failed / 422 passed (423); Tests 2 failed / 3854 passed / 33 skipped (3889) -- the 2 are taskResultPaired |
| 10 | npm run verify:ccloop-pin | 0 | OLD pin (package.json ccloop 71053e3, installed-dependency E2E): 3/3, "vitest exit 0 {total 3, passed 3, failed 0, skipped 0}". Result for the OLD pin only; Task 15 repin not done. |
| 11 | npm run verify:panel | 0 | PASS 1..14, ~/.orca unchanged check passes |
| 12 | npm run --ws check | 0 | web: 133 files, 1137/1137 |
| 13 | node scripts/check-tmp-leak.mjs | 0 | "vitest exit 1, 3889 tests, 0 entries left" (vitest exit 1 inside it = the taskResultPaired pair; 0 leaked entries) |

Required new files, all **passed, none skipped** in `t16-vitest.json`: codexRequirementOpen 2, ccloopModels 1, webCcloopSmoke 6, estimatorSoftExecution 7,
agentModelsApi 3, singleCallOutputBound 5, declaredNullWindow 2.

## Reds and classification
First full run (segment 4), 14 reds = 12 timeouts/deadlines + taskResultPaired x2:
gateCheck K13; driverReconcileN (deadline); driverRecovery; integrationKeep; retryTask x4; schedulerBridge (30 s); settleUnknownUsage x3 (D9 owner conservative settlement; D9 silent=false; D9 silent=true).
verify:control: settleUnknownUsage silent=false + paired x2. verify:chain full run: paired x2 only.
Each non-paired file run alone 3x in the clone, same env, fresh TMPDIR (`t16-alone-*.log`, `t16-alone-summary.txt`, load 6-18 before/after):
| file | RC x3 | Tests per run | classification |
|---|---|---|---|
| tests/chain/gateCheck.test.ts | 0/0/0 | 19/19 | load flake (registered shape: K13) |
| tests/control/driverReconcileN.test.ts | 0/0/0 | 5/5 | load flake (registered shape) |
| tests/control/driverRecovery.test.ts | 0/0/0 | 8/8 | load flake |
| tests/control/integrationKeep.test.ts | 0/0/0 | 1/1 | load flake |
| tests/control/retryTask.test.ts | 0/0/0 | 15/15 | load flake |
| tests/control/schedulerBridge.test.ts | 0/0/0 | 9/9 | load flake |
| tests/control/settleUnknownUsage.test.ts | 0/0/0 | 36/36 | load flake |
| tests/control/taskResultPaired.test.ts | 1/1/1 | 2 failed each | fixed environment red (hard-coded old paths; handoff 3.4 / known-load-flakes), x2 |
No real red found. segment 6 (hooksPath) is a clone artifact. The one open item is the wording hit above.

## Side-effect checks
- pgrep `fake-omp|fake-codex|worker.js`: before RC=1 (none); after RC=1 (none). `ps | grep ` after: no processes; nothing killed.
- ~/.orca: ls -la + shasum of every file before/after (`t16-orca-before.txt`, `-after.txt`): the 32 file hashes identical (sorted compare, `cmp` SAME), listing identical apart from `find` ordering and the parent-dir mtime. Unchanged.
- Real ~/.cache/ccloop: `ls` before and after: No such file or directory. Clone's `$G/ccache` was never created.
- Left in place: clone `/private/tmp/org-Udn7`, TMPDIR `/private/tmp/cl-KAcu` (+ cl-* alone-run dirs).
