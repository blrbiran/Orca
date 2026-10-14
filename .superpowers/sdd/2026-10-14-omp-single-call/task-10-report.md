# Task 10 report (Orca): criteria 8-10 seen red under their named mutations

- Who: Task 10 implementer subagent, session https://claude.ai/code/session_01NCgRiQLh17ENJdrmuJDcKL
- When: 2026-10-15 00:02-00:04 local
- On: Orca `codex/omp-single-call` @ `f00d6910763956dfbda4fe4bfe268cab28c0a96e` (the worktree HEAD, clean)
- Status: DONE. 9 red / 9 runs (7 distinct mutations; M8 and Mfloor each run against both test files). Every red is an
  AssertionError on the named assertion: no load error, crash or timeout.

## Setup

- Clone: `/usr/bin/git clone -q --local /Users/biran/code/skills/orca/Orca-wt/omp-single-call /private/tmp/osc/mut/t10` (rc=0,
  log `/private/tmp/osc/logs/t10-clone.log`). HEAD f00d6910, branch codex/omp-single-call. Symlinks:
  `node_modules -> /Users/biran/code/skills/orca/Orca/node_modules`, `web/node_modules -> .../Orca/web/node_modules`.
- Tools: `/private/tmp/osc/mut/t10-tools/` (new dir; no other seat's dir touched). `mutate.mjs` is a byte copy (`cat >`) of
  `/private/tmp/osc/mut/t6-tools/mutate.mjs` (refuses unless the anchor occurs exactly once). `mut.sh` is Task 6's adapted copy
  with two changes: paths moved to `t10-tools/`, and vitest always runs with `--testTimeout 60000` (controller: a ccloop gate runs
  concurrently, a 5 s timeout red is not evidence). The `-t` pattern is positional arg 6. Driver: `t10-tools/run-all.sh`.
- `ORCA_CCLOOP_BIN=/private/tmp/osc/ccl-build/dist/cli.js` for every run (ccl-build was present; not rebuilt, not mutated).
  Neither criterion file spawns ccloop as far as the runs show; the variable was set anyway.

## Baseline (GREEN)

Command (in the clone): `ORCA_CCLOOP_BIN=/private/tmp/osc/ccl-build/dist/cli.js ./node_modules/.bin/vitest run tests/control/singleCallOutputCap.test.ts tests/control/requirementOutputBound.test.ts --testTimeout 60000 > /private/tmp/osc/mut/t10-tools/logs/baseline.log 2>&1`
Result: rc=0, `Test Files 2 passed (2)`, `Tests 9 passed (9)`, 0 skipped.

Initial sha256 (`t10-tools/logs/initial.sha`):

| file | sha256 |
|---|---|
| src/control/estimator.ts | f320789dd7f8b51bec3a48c50b02e6b2f6bca8573efbbb3869af3538ba013ca7 |
| src/control/ccloopPort.ts | d73d2dd3313ec90ec9b02b91a255238eb861d10a12e0a9e58e0c038f53a6d437 |
| src/control/singleCallPurposes.ts | 63d3c635f4d994c14e955b3c325284a1494694d675bfa12d197a5aa91f652a69 |
| src/control/requirementCommands.ts | ce66ae17af6a421870732b3f4b484238ba0d5b5e625d8013e38c01120166d99d |

## Mutation table

Command per row: `/private/tmp/osc/mut/t10-tools/mut.sh /private/tmp/osc/mut/t10 <id> <file> t10-tools/specs/<spec>.json <test> [<pattern>]`
(vitest `run <test> --testTimeout 60000 [-t <pattern>]`). Each spec anchor matched exactly once (mutate.mjs would exit 2
otherwise; every `.mutate` reads `applied 1 replacement spec(s)`), and sha-after differs from sha-before in every row.
Every run's vitest rc=1; every sha-restored equals sha-before; every `.restore-bytes` is `0 diff / 0 cached`.

| id | file | spec (from -> to) | test [-t] | sha before -> after (first 12) | red line (AssertionError) | also red / stays green |
|---|---|---|---|---|---|---|
| M8 | estimator.ts | `return Math.max(preflightMaxOutputTokens, resolution?.singleCallOutputCap ?? 0);` -> `return preflightMaxOutputTokens;` | singleCallOutputCap.test.ts | f320789dd7f8 -> 468e4be97872 | "C8: a cap above...": `expected 64000 to be 100000` (line 56) | red: "C8: the single-call envelope..." (64000), "C9..." (`queued`, requiredRequestTokens 67693), "takes the larger..." (last 524288 -> 64000). Green: "C8: no cap...", the 3 C10/frozen tests (4 passed) |
| M8r | estimator.ts | same as M8 | requirementOutputBound.test.ts | f320789dd7f8 -> 468e4be97872 | `expected [ 'cap-high', 64000 ] to deeply equal [ 'cap-high', 100000 ]` (line 26) | - |
| M9 | estimator.ts | `const tooLarge = requiredRequestTokens > ... ESTIMATE_GRANT.tokens;` -> `const tooLarge = inputTokens > observed.contextWindowTokens \|\| inputTokens > ESTIMATE_GRANT.tokens;` | singleCallOutputCap.test.ts -t C9 | f320789dd7f8 -> 5a3ada06ec6e | "C9...": `state: 'queued'` vs `input-too-large`, `reasonCode: null`; requiredRequestTokens 253694 matched (line 92) | 7 skipped by -t |
| M10 | ccloopPort.ts | `singleCallOutputCap:safeInteger.positive().nullable().optional(),` -> `` | singleCallOutputCap.test.ts -t C10 | d73d2dd3313e -> f365a73ca213 | "C10: accepts...": `[ {singleCallOutputCap: 8192}, false ]` vs `true` (line 22) | "C10: refuses..." green (strict schema still refuses the key). The loop stops at the first element, so the null and `{}` cases were not individually observed (Rule 9: earlier assertions short-circuit) |
| M10b | ccloopPort.ts | same anchor -> `singleCallOutputCap:safeInteger.nullable().optional(),` | singleCallOutputCap.test.ts -t C10 | d73d2dd3313e -> aa994c97e859 | "C10: refuses...": `expected [ +0, true ] to deeply equal [ +0, false ]` (line 28) | "C10: accepts..." green |
| Menv | singleCallPurposes.ts | `maxOutputTokens: contract.maxOutputTokens,` -> `maxOutputTokens: 64_000,` | singleCallOutputCap.test.ts | 63d3c635f4d9 -> ac815b71a126 | "C8: the single-call envelope ESTIMATE.prepare sends carries the raised bound": `"maxOutputTokens": 64000` vs `100000` (line 75) | the other 7 green, including "C8: a cap above..." (it reads the persisted contract, not the envelope) |
| Mfloor | estimator.ts | `resolution?.singleCallOutputCap ?? 0);` -> `resolution?.singleCallOutputCap ?? 1_000_000);` | singleCallOutputCap.test.ts | f320789dd7f8 -> fb69445908f5 | "C8: no cap...": `[ undefined, 'input-too-large', 1000000, 1000000 ]` vs `[ undefined, 'queued', 64000, 64000 ]` (line 83) | red: "takes the larger..." (first three 1000000). 6 green |
| Mfloorr | estimator.ts | same as Mfloor | requirementOutputBound.test.ts | f320789dd7f8 -> fb69445908f5 | `expected [ 'cap-null', 1000000 ] to deeply equal [ 'cap-null', 64000 ]` (line 26); cap-high and cap-low passed before it | - |
| Mopen | requirementCommands.ts | `maxOutputTokens: singleCallOutputBound(preflight.maxOutputTokens, slot.observation.resolution),` -> `maxOutputTokens: preflight.maxOutputTokens,` | requirementOutputBound.test.ts | ce66ae17af6a -> 61ba1b671b72 | `expected [ 'cap-high', 64000 ] to deeply equal [ 'cap-high', 100000 ]` (line 26) | - |

Full sha256 values, red logs and restore byte counts: `/private/tmp/osc/mut/t10-tools/logs/<id>.{mutate,sha-before,sha-after,sha-restored,red.log,red.rc,diff,cached,restore-bytes}`.
Driver output: `t10-tools/logs/run-all.log` (each id `mut.sh-exit=0 rc=1`, script rc=0).

### Interpretation recorded (Menv)

The ruling says the envelope takes "the profile's preflight value". `ESTIMATE.prepare` receives only the store and the run row;
the profile's `estimatorPreflight` is not reachable from there. Menv therefore substitutes the literal preflight value of the
fixture profile (`tests/control/fixtures/web.ts:25`, `maxOutputTokens: 64_000`). This is the exact value a "send the preflight
cap, not the contract's bound" bug would produce in this fixture. Reversible; flagged in case the controller meant some other
source for the value.

## Restore proof

- Final sha256 of the four files (`t10-tools/logs/final.sha`) equals initial.sha byte for byte (`diff` rc=0, `final.sha.diff`).
- `/usr/bin/git diff` and `/usr/bin/git diff --cached` of the clone, redirected to files: `/private/tmp/osc/logs/mo-final.bytes`
  reads `0 final.diff`, `0 final.cached`, `0 total`. `git status --short` empty; HEAD still f00d6910.
- After restore, the baseline command run again: rc=0, 2 files / 9 tests passed (`t10-tools/logs/post-green.log`).
- The clone was removed afterwards: `/bin/rm -f` of both node_modules symlinks (the targets under the main Orca checkout were
  checked to still exist), then `/bin/rm -rf /private/tmp/osc/mut/t10`. `t10-tools/` is kept as the evidence.
- The Orca worktree and every other dir under /private/tmp/osc were not written to (except `/private/tmp/osc/logs/t10-*`
  and `mo-final.bytes`).

## Processes (`pgrep -fl "fake-omp|worker.js"`)

- Before (`/private/tmp/osc/logs/t10-pgrep-before.log`): 7541 (fake-omp.mjs under /private/tmp/osc/mut/t6, an earlier
  Task 6 run), 9260, 58085, 60414, 85784 (ccloop worker.js from other worktrees).
- After (`/private/tmp/osc/logs/t10-pgrep-after.log`): 7541, 9260, 58085, 85784. 60414 exited on its own. Nothing new.
  None of these were started by this task; none killed. 7541 is a fake-omp left running by the Task 6 clone; reporting it
  for the controller.

## Concerns

1. Menv value: see the interpretation above.
2. M10: the red is on the first loop element (8192); the brief's "false for null too" was not observed separately because
   the loop short-circuits. The removed-field mutation makes the strict schema refuse every value, so null would also be false.
3. Stale fake-omp pid 7541 from the Task 6 clone is still alive.
