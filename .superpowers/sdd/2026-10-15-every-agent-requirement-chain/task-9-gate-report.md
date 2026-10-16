# Task 9 Step 1 -- ccloop full gate report

Measured in session a852f96a (gate run by a delegated agent, 2026-10-16 ~10:30-11:19). Measurement only: no repo file edited, no commit.
Branch `codex/every-agent-chain`, tip `efcd5b3aa7e5b679513fbb99f6ffe314a2176547` (`/usr/bin/git -C $CL rev-parse HEAD`, log `ccg-tip.txt`;
the clone's `rev-parse HEAD` printed the same sha). Clone `G=/private/tmp/ccg-cEhq` (`repo/`, `agents.json`); gate `TMPDIR=/private/tmp/cl-Rwsa`;
`CCLOOP_CACHE_DIR=$G/cache`; node v22.13.1 (nvm). All logs under
`LOGS=/private/tmp/claude-501/-Users-biran-code-skills-orca-Orca/a852f96a-f3c8-4721-9df4-b10c19154451/scratchpad/logs` (`ccg-*`).
Script that ran it: `$SCRATCH/ccg-run.sh` (the brief's Step 1 verbatim, plus pgrep/real-cache listings).

## Host condition (matters for the verdict)
`uptime` at gate start: load averages 7.83 10.23 12.01. During the run the load rose to **184.12 182.02 138.93** (10:51) and was 132.68 168.91 137.27
at the end of the script (`ccg-uptime-end.txt`). Another session's Orca sweep (`t10-sweep`, visible in `ccg-pgrep-after.txt`) was running
concurrently. The `verify:control` leg and the tmpleak leg ran in that load.

## Commands, RC, counts (as printed)
| # | command | RC | counts / result |
|---|---|---|---|
| 1 | `npm run typecheck` (`ccg-typecheck.log`) | 0 | `tsc --noEmit` clean |
| 2 | `npm run build` (`ccg-build.log`) | 0 | |
| 3 | `vitest run --reporter=json` (`ccg-vitest.json`, `ccg-vitest.log`) | **1** | JSON: numTotalTests 1817, passed 1810, **failed 7**, pending 0, todo 0; suites 445 total / 439 passed / 6 failed |
| 4 | `check-known-reds.mjs` (`ccg-known-reds.log`) | **1** | "known reds in roster: 6 / failed: 7 / unexpected: 7" -- all 7 UNEXPECTED |
| 5 | `npm run verify:control` (`ccg-verify-control.log`, 1023 lines, read whole) | **1** | "Test Files 11 failed \| 69 passed (80); Tests 32 failed \| 825 passed (857)" |
| 6 | `check-tmp-leak.mjs` (`ccg-tmpleak.log`) | **1** | "vitest exit 1, 1817 tests, 1 entries left in /private/tmp/cl-Rwsa/cl-7PGp9T: ccloop-tmp-cCwrjA" |
| 7 | `ls -la $G/cache` (`ccg-cache-dir.txt`) | 1 | `ls: /private/tmp/ccg-cEhq/cache: No such file or directory` (nothing created the cache dir; every cache-reaching test uses its own relocated dir) |

## The 7 main-run reds (`ccg-vitest-failed.txt`), none on the known list
1. updates.test.ts "replays a matching completed receipt before reading a malformed current table" -- timed out 5000 ms
2. updates.test.ts "still refuses a completed replay with a non-private table-parent" -- timed out 5000 ms
3. updates.test.ts "still refuses a completed replay with a non-private updates-root" -- timed out 5000 ms
4. updates.test.ts "probes a path choice's offered custom argv when the bare binary is unavailable" -- timed out 5000 ms
5. updates.test.ts "observes without writing, then applies only an accepted version change and replays the receipt" -- timed out 20000 ms
6. savedResultRecovery.native "refuses a cleaned terminal with changed-tree publication even when the ref exists" -- ENOTEMPTY rmdir (cleanup race)
7. extractFinalObject "... 16 MiB span of millions of empty objects in under 3 s (plan)" -- 3274 ms > 3000

## The 32 verify:control reds (11 files; all timeout / marker-wait / ENOTEMPTY-cleanup / 3 s perf shapes)
allowanceEvidence (4, 5 s timeouts), phasesCompleted (1, 5 s timeout), taskResultOutcome (3: 5 s timeouts + ENOTEMPTY), endToEnd (1 suite +
"candidate-fsynced" marker timeout + ENOTEMPTY), savedResultRecovery.native (16: marker-did-not-appear, ENOTEMPTY, 30 s timeouts, "worker did not seal and exit"),
worker.test "observes each successful phase exactly once with raw usage" (status exhausted vs succeeded), runLoop.integration "persists phase usage evidence
from the claude agent adapter..." (ENOENT attempts/1/plan.json), verifySavedResult "r1 command interruption modified=false..." (completedWithResult true vs false,
tokenUsage 0 vs null), extractFinalObject (3659 ms > 3000, plan), runCodexPhase ("refuses output-limit output": timeout vs output-limit; "labels truncated
evidence explicitly": reason timeout), skillsController "plan skill cleanup failure across handoff-abort" (fixture marker.closed missing after 5 s).

## Classification: each red's file run alone, 3 times, in the clone (same env incl. ORCA_CCLOOP_BIN / ORCA_AGENTS_TABLE / CCLOOP_CACHE_DIR; fresh TMPDIR each)
Logs `ccg-alone-<file>-<n>.log`, `ccg-alone-summary.txt` (RC and `uptime` before/after each run; load 12-63 during these runs, not idle).
| file | RC run1/2/3 | load (1-min) | classification |
|---|---|---|---|
| tests/agents/updates.test.ts | 0/0/0 | 61->51 | load flake (3/3 green alone) |
| tests/runtime/codex/runCodexPhase.test.ts | 0/0/0 | 49-54 | load flake |
| tests/control/phasesCompleted.test.ts | 0/0/0 | 54-63 | load flake |
| tests/control/worker.test.ts | 0/0/0 | 60-63 | load flake |
| tests/controller/taskResultOutcome.test.ts | 0/0/0 | 55-60 | load flake |
| tests/control/allowanceEvidence.test.ts | 0/0/0 | 28-42 | load flake |
| tests/controller/runLoop.integration.test.ts | 0/0/0 | 28-38 | load flake (the ENOENT attempts/1/plan.json shape did not recur) |
| tests/controller/verifySavedResult.test.ts | 0/0/0 | 20-41 | load flake (the r1 command-interruption red did not recur) |
| tests/control/endToEnd.test.ts | 0/0/0 | 38-60 | load flake |
| tests/control/savedResultRecovery.native.test.ts | 0/0/0 | 12-60 | load flake (16 reds in the gate, 0 alone) |
| tests/runtime/codex/extractFinalObject.test.ts | first batch **0/1/0**, second batch (load 12) 0/0/0 | 48-51; 12-13 | first batch run2: "(execute)" 3085 ms > 3000 at load ~51 (`ccg-alone-extractFinalObject-2.log`); 3/3 green at load 12 (`ccg-alone2-*`) -> load flake (timing threshold) |
| tests/runtime/codex/skillsController.test.ts | first batch **1/0/0**, second batch (load 11-12) 0/0/0 | 55->48; 11-12 | first batch run1: "verify skill cleanup failure across handoff-abort" marker.closed missing (`ccg-alone-skillsController-1.log`) at load ~50; 3/3 green at load 12 -> load flake |

No red was found that reproduced alone at load 12. Nothing classified "real red".
Caveat stated plainly: for extractFinalObject and skillsController the "alone x3" rule was first NOT met (1 red in 3 at load ~50); I re-ran each 3x at load ~12 (3/3 green) and classify on that. The 3 s perf assertion also failed in a different test of the same file (execute vs plan) than in the gate, which fits a load-sensitive timing threshold, not a logic fault.

## The gate itself does NOT pass as run
Strict reading: `check-known-reds` RC 1 (7 unexpected), `verify:control` RC 1 (32 reds), tmpleak RC 1 (it re-runs vitest under the same load; "vitest exit 1" so
its leftover entry is a consequence of failed tests whose cleanup raced, not an independent finding). Every red is classified load flake by the alone rule, so the
**gate must be re-run on a quiet machine to count as passed**: this run was measured at load 50-184, with the concurrent Orca t10 sweep. Recommended: wait for
load < ~10, re-run Step 1 once (about 25 min at idle per the first-leg timings), expect main vitest 1817/1817.

## Leftover processes (`ccg-pgrep-before.txt`, `ccg-pgrep-after.txt`, `ccg-pgrep-final.txt`, `ccg-orphans-ps.txt`)
- before the gate: no match (`RC=1`).
- after the gate and again after the alone runs: **14** `node /private/tmp/ccg-cEhq/repo/dist/src/control/worker.js --source-dir ...` workers, ppid 1, state Ss, 0.0-1.2 % CPU,
  elapsed 28-41 min. They are orphans of this gate's SIGKILL/crash tests (savedResultRecovery.native and endToEnd under load): all of the 14 have `ccg-cEhq` in argv
  (source dirs `/private/tmp/results-task2-*/source` and one `/private/tmp/cl-Rwsa/ccloop-tmp-Fo1fmK/.../source`). The `ccg-pgrep-after.txt` also lists one line
  belonging to the other session's t10 sweep shell (pid 78162), not mine. I did not kill them (not asked). Kill list: the 14 pids in `ccg-orphans-ps.txt`.

## Real cache path
`ls -la $HOME/.cache/ccloop` before (`ccg-realcache-before.txt`) and after the gate (`ccg-realcache-after.txt`), and again after all alone runs:
`ls: /Users/biran/.cache/ccloop: No such file or directory` each time. The real cache path was not written.

## Not done (by instruction)
Step 2 (ledger, handoff) and Step 3 (checkpoint) are the controller's. The clone `/private/tmp/ccg-cEhq` and `TMPDIR` dirs `/private/tmp/cl-*` were left in place.
