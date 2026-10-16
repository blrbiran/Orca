# Task 7 report — acceptance harness for paid estimate runs

Who: Task 7 implementer (subagent of Orca session 4de777f4, model Opus 5.5), 2026-10-17. BASE 9dbbaed2, branch
codex/round-20261017. No paid call was made: every run below is --fake / --fake-omp / --fake-claude.

## What was implemented (scripts/live-driver-acceptance.ts only)

- `--scenario estimate` now accepts `--codex <bin> --model <name>` / `--fake`. It runs in soft estimate mode (the
  harness already passes `--estimate-mode soft`). The profile declares `contextWindowTokens` from `--context-window`
  (default 1000000) for codex as well as omp.
  Finding: a codex `contextWindow` *preference* is refused at import with
  `agent-selection-rejected:estimator:agent-context-unsupported` (seen under --fake). So for codex in the estimate
  scenario the preference does not carry a window, and only the profile declares one (`preferenceWindow`).
- `--instruction-version 1|2` (default `2`) is written into the harness's own profile (`estimatorPreflight.instructionVersion`).
  Any other value is a usage error.
- `--repeat <n>` (default 1) runs n estimates of the same plan. Each one is imported into a fresh group (g, g2, …) once
  the previous group has settled. A value above 1 requires `--scenario estimate --estimate-only`; without it the run is
  a usage error. Ruling: the full chain (confirm/start/work) stays one group.
- Waiting: `settleEstimates` polls until the group's **newest** estimate is no longer queued, running or
  start-unknown, so an automatic retry is driven to its end. `--deadline-ms` applies per group.
- summary.json gains:
  - `estimates`: one row per estimate, retries included. Each row has repeat, groupId, estimateId, estimateVersion,
    state, reasonCode, repairs, origin, retriedAs, retrySkipped, calls, and tokens (booked from ccloop evidence; null
    if unknown).
  - `estimateTally {firstCallReady, readyAfterRepair, readyAfterRetry, failed}`: one outcome per repeat, read from the
    group's newest estimate. `answer-v2-converted` alone still counts as firstCallReady (spec §4.2 step 1: not a defect).
  - `estimateChains`.
- New checks:
  - `estimatesSettled`.
  - `estimateReady`, now only when repeat = 1, and judged on the chain's final estimate.
  - `notTimedOut` in --estimate-only.
  - Fake modes only: `fakeEstimatesExact` (every estimate's state, repairs, origin, retried, retrySkipped and calls)
    and `fakeTallyExact`.
  - `fakeCallsExact`, now also for fake codex.
  - The estimate-run checks (usage booked, the omp single-call evidence checks) now cover every estimate run, not
    exactly one. Group g's ledger match and the estimate role of provider calls cover every estimate run in g.
- The fakes answer in a cycle. Repeat 1 is a clean answer in the instruction's own shape. Repeat 2 is the
  2026-10-15 evidence shape: `a` twice, the second copy with rationale `placeholder`, which gives readyAfterRepair with
  `duplicate-task-dropped:a`. Repeat 3 is a single placeholder entry: it fails, its retry fails too, and there is no
  third call. Under --fake-omp only, repeat 4 fails and its retry gets a clean answer (readyAfterRetry). This works
  because the fake-omp wrapper now moves `<marker>.single-<n>.json` over `single.json` for call n. Fake codex writes
  `<marker>.single.json` `{rows, final}` with a different usage for each call.
- An unknown flag is now a usage error (`VALUE_FLAGS`). Before this change unknown flags were silently ignored (see Step 1).

## Step 1 (RED, before the change)

`HOME=$S/home XDG_*=$S/xdg/... tsx scripts/live-driver-acceptance.ts --ccloop-bin /private/tmp/ccb6-qswQ/ccloop/dist/cli.js --output $S/red1 --fake-omp --scenario estimate --estimate-only --repeat 2 --instruction-version 2`
(S=/private/tmp/acc-xpI0) → **exit 0** with ONE estimate. The brief expected a usage error, but parseArgs silently
accepted the unknown flags and ran a single v1 estimate. That silent acceptance is the defect the flag allowlist fixes.
After the change the same unknown-flag shape exits 1 (`badflag` below).

## Step 3 (GREEN): exact commands, all at the final code (commit below)

The environment for every run was `CCLOOP_CACHE_DIR=$S/cc-cache HOME=$S/home XDG_CONFIG_HOME=$S/xdg/config
XDG_DATA_HOME=$S/xdg/data XDG_CACHE_HOME=$S/xdg/cache XDG_STATE_HOME=$S/xdg/state`, plus
`./node_modules/.bin/tsx scripts/live-driver-acceptance.ts --ccloop-bin /private/tmp/ccb6-qswQ/ccloop/dist/cli.js --output $S/final/<name>`
and the arguments below. The script is `/private/tmp/acc-xpI0/runfinal.sh`; results are in `$S/final/results.txt`,
and each run's log and summary.json are in `$S/final/`.

| name | args | exit | tally (firstCallReady/afterRepair/afterRetry/failed) | failed checks |
|---|---|---|---|---|
| omp2 (brief's command) | --fake-omp --scenario estimate --estimate-only --repeat 2 --instruction-version 2 | 0 | 1/1/0/0 | none (16 checks) |
| omp4 | --fake-omp … --estimate-only --repeat 4 --instruction-version 2 | 0 | 1/1/1/1 | none (16) |
| codex3 | --fake --scenario estimate --estimate-only --repeat 3 | 0 | 1/1/0/1 | none (11) |
| codexfull | --fake --scenario estimate | 0 | 1/0/0/0 | none (26) |
| claude3 | --fake-claude --scenario estimate --estimate-only --repeat 3 | 0 | 1/1/0/1 | none (11) |
| claudefull | --fake-claude --scenario estimate | 0 | 1/0/0/0 | none (27) |
| ompfull | --fake-omp --scenario estimate | 0 | 1/0/0/0 | none (33) |
| omp4v1 | --fake-omp … --estimate-only --repeat 4 --instruction-version 1 | 0 | 1/1/1/1 | none (16) |
| codexsingle (regression) | --fake --scenario single | 0 | — | none |
| ompsingle (regression) | --fake-omp --scenario single | 0 | — | none |
| ompreq (regression) | --fake-omp --scenario requirement | 0 | — | none |
| badflag | --fake-omp --scenario estimate --bogus 1 | 1 | `Error: unknown flag --bogus` | — |
| badrepeat | --fake-omp --scenario estimate --repeat 2 | 1 | `Error: --repeat above 1 needs --scenario estimate --estimate-only` | — |
| badiv | --fake-omp … --estimate-only --instruction-version 3 | 1 | `Error: --instruction-version is 1 or 2` | — |

After the final comment-only edit, omp2 was run again (`$S/final/omp2-post`): exit 0.
omp2 tokens: [124, 244]. omp4 tokens: [124, 244, 364, 364, 484, 604]. In g3 the retry rereads the same fake file, so
both g3 calls report the same usage. omp2's v2 instruction was confirmed in ccloop's evidence: `budget-estimate-answer-v2`
appears in `.../single-call/call-*/system-prompt.md`.

`npx tsc --noEmit -p tsconfig.json` (which includes scripts/): exit 0.

Rule 17:
- The script's own `orcaHomeUntouched` check looks at the redirected HOME.
- The real `~/.orca` was checked separately: `ls -laR ~/.orca` before the first run and after the matrix
  (`$S/orca-before.txt`, `$S/orca-after.txt`). The only difference is the mtime of the `..` entry (the home directory
  itself). Nothing under ~/.orca changed.

## Rule 9 mutations

Each mutation was applied to a `git clone --local` copy, `/private/tmp/mut-SyHf/clone`, which holds this task's file.
Driver: `/private/tmp/mut-SyHf/mut.sh`; results: `results3.txt`. Every mutation was seen red:

| mutation | removes | run | result |
|---|---|---|---|
| M1 | the readyAfterRepair tally branch | omp repeat 2 | exit 1, fakeTallyExact |
| M2 | waiting on the newest estimate (waits on the first only) | omp repeat 4 | exit 1, fakeEstimatesExact, fakeTallyExact, fakeCallsExact |
| M3 | the repeat loop (1 iteration) | omp repeat 2 | exit 1, estimateQueued, estimatesSettled, fakeEstimatesExact |
| M4 | --instruction-version in the profile (literal "1") | omp repeat 2 | exit 1, fakeEstimatesExact, fakeTallyExact, fakeCallsExact |
| M5 | dropping the codex window preference | fake codex | exit 1, estimateQueued, estimateReady, … |
| M6 | the unknown-flag error | --bogus 1 | exit 0 (criterion is exit≠0) → red |
| M7 | the readyAfterRetry tally branch | omp repeat 4 | exit 1, fakeTallyExact |
| M8 | the fake-omp per-call answer queue (wrapper mv) | omp repeat 4 | exit 1, fakeEstimatesExact, fakeTallyExact |
| M9 | the --repeat needs --estimate-only guard | omp repeat 2 full chain | exit 1, providerCalls, ledgerMatchesCcloop, omp* … |

Restore proof: after every mutation, `mut.sh` copied the original back, and `cmp` of the clone's file against the
worktree file reported them identical. The main worktree was never mutated. The first two rounds of mutation runs
(`results.txt`, `results2.txt`) are void: `results2.txt` reused existing output directories, which the harness refused.
Only `results3.txt` counts.

## Concerns

1. **The real ccloop cache was written once.** A preliminary fake codex run (`$S/codex3b`, before I added the
   CCLOOP_CACHE_DIR/HOME redirect) wrote ccloop's agent catalog cache and a codex-home isolation dir for the *fake*
   installation under `~/.cache/ccloop/agent-catalog/`. The 8 new paths are listed in
   `/private/tmp/acc-xpI0/ccloop-cache-new.txt`; they include `codex-home/bf53…/codex-home/{auth.json,config.toml}`.
   This is not ~/.orca. Per the delete-only-with-consent rule I did not delete them; the human can remove them.
   Every final run used the redirect.
2. The readyAfterRetry and retry-of-retry paths are exercised end to end only under --fake-omp, the one fake whose
   answer can be queued per call. Fake codex and fake claude cover first-call, repair and unrepairable.
3. Codex in the estimate scenario carries no contextWindow preference (the agent-context-unsupported finding above).
   A paid `gpt-6-luna` run will therefore resolve the model's window through ccloop/the profile (min). If the real
   catalog's window is smaller than the request needs, the estimate goes blocked-capability, not ready.
4. `summary.estimateUsage` changed shape: it was the events array; it is now `[{runId, events}]`.
5. The default instruction version is now `2` for every scenario's harness profile (the brief asks for default `2`).
   The single and requirement scenarios still pass.

## Files changed

- scripts/live-driver-acceptance.ts
- .superpowers/sdd/2026-10-17-estimate-usable-answer/task-7-report.md (this file)

## Commit

e14425e0 `test(acceptance): estimate scenario for codex, instruction v2 and repeated runs`.
Checked with `git diff FETCH_HEAD -- scripts/live-driver-acceptance.ts` in the mutation clone, after fetching the
commit. The clone's file (the version every mutation was restored to) differs from the commit only in two comment
lines: the reworded "fakeEstimateAnswers" and "in a cycle" (`/private/tmp/mut-SyHf/clone-vs-commit.diff`). There is
no code difference. The final matrix ran on the uncommitted pre-comment-fix code; the brief's command was run again
after the comment fix (omp2-post, exit 0).

## Fix round 1 (review finding: Rule 17, ccloop cache)

Commit: 13d5792b `fix(acceptance): keep ccloop's cache under --output unless the caller set one`.

Change: right after --output is created, `ccloopCacheDir = process.env.CCLOOP_CACHE_DIR || join(root, "ccloop-cache")`.
The value is written back to `process.env`, which happens before the runtime or any ccloop process starts. It is also
passed as `CCLOOP_CACHE_DIR` in the `env` given to the control runtime and to ccloop. This applies to every mode, fake
and real. The header's Rule 17 paragraph now says so.

Test: both runs had CCLOOP_CACHE_DIR and XDG_CACHE_HOME unset (`env -u`) and HOME=/private/tmp/acc-xpI0/fix1/home.
`ccloop-bin` was /private/tmp/ccb6-qswQ/ccloop/dist/cli.js. Evidence is in `/private/tmp/acc-xpI0/fix1/evidence.txt`.
- `--fake-omp --scenario estimate --estimate-only --repeat 2 --instruction-version 2` → exit 0, tally 1/1/0/0, no failed checks.
- `--fake --scenario estimate --estimate-only` (codex) → exit 0, tally 1/0/0/0, no failed checks.
- Afterwards the scratch HOME was empty: `.cache/ccloop` was absent. `<output>/ccloop-cache` existed in both runs; the
  codex run's held a catalog json and `codex-home`.
- The real `~/.cache/ccloop` listing (`ls -laR`, taken before and after into `realcache-{before,after}.txt`) was
  identical by `cmp`.
- `tsc --noEmit -p tsconfig.json`: exit 0.

Mutation, in the clone /private/tmp/mut-SyHf/clone: the default was dropped
(`const ccloopCacheDir = process.env.CCLOOP_CACHE_DIR;`) and the fake codex run repeated with HOME=fix1/mhome. Result
(`fix1/mut-evidence.txt`): the scratch HOME got `.cache/ccloop/agent-catalog` (red), and there was no
`<output>/ccloop-cache`. The file was then restored, and `cmp` with the worktree's file reported identical. The real
~/.cache/ccloop listing was unchanged across the mutation run.

Nothing under the real ~/.cache was deleted. The 8 paths from the earlier unredirected run (concern 1) remain for the
human to remove.
