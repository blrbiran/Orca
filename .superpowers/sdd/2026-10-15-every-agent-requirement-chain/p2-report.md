# P2 -- one real omp requirement chain, cold then warm ccloop catalog cache

Who: P2 acceptance agent dispatched by Orca session a852f96a. When: 2026-10-16, 13:37-13:41 local (epoch 1792129049-1792129293).
Human authorization: P2 and its re-runs for this round (relayed by session a852f96a). No re-run was made.
Code under test: Orca `git clone --local` of `Orca-wt/every-agent-chain` at `727fbdc6` (`fix(control): refuse a models
answer that does not echo the requested installation`), node_modules symlinked to the worktree's; no web build (panel
not needed). ccloop: `/private/tmp/ccb3-ezF4/repo/dist/cli.js` at `d9cb32c` (not modified). omp 18.10.1
(`/Users/biran/.bun/bin/omp`). Model: `local-litellm/ep-20261012204110-nvhqw` (LiteLLM `/health/liveliness` 200 before the runs).
Harness: `scripts/live-driver-acceptance.ts` of that clone, unmodified.

## Isolation (Rule 17)

- Root `P=/private/tmp/p2-4bPF` (0700): private `HOME`, `XDG_{CONFIG,CACHE,DATA,STATE}_HOME`, `TMPDIR`, each run's
  `--output` (Orca control dir, corrections dir), `PI_CODING_AGENT_DIR=$P/omp-config` = `--omp-config-dir`
  (copies of `~/.omp/agent/{config.yml,models.yaml}`, 0600 in a 0700 dir; **holds credentials, not printed, left for
  the human to delete**). Wrapper `$P/iso.sh <cache dir> <cmd>`. The harness writes its own profile.
- `CCLOOP_CACHE_DIR`: run A `$P/cache` (absent before = cold); runs B and C `$P/cache-est` (absent before B = cold; warm for C).
  Using a second cache dir for the estimate was my choice, so that the estimate step has its own cold and warm measurement.
  Otherwise B would already have been warm from run A, and the requested warm repeat would have measured nothing new.
- Probe evidence: the installation's command is a pass-through shim `$P/bin/omp` that appends `<epoch.ms> <first 6 args>
  pid=` to `$P/logs/omp-invocations.log` and `exec`s the real omp. The real omp answers every call. ccloop's
  `materialize` path logs no miss lines (it passes no `log`), so the shim is the only per-spawn record. The worker's
  `ccloop-agent-catalog: miss` line was never printed (`grep -r` of all run dirs: none).
- `~/.orca`: `ls -laR` plus `shasum -a 256` of every file, before and after (`$P/logs/orca-home-{before,after}.txt`).
  The only difference is the mtime of `..` (the home directory itself). Every `~/.orca` entry and hash is identical.
  `~/.cache/ccloop` does not exist before or after. The harness's own `orcaHomeUntouched` check looks at the relocated
  HOME, so it is not evidence for the real one. The before/after diff is.

## Commands

```
P=/private/tmp/p2-4bPF; cd $P/orca
A: $P/iso.sh $P/cache     ./node_modules/.bin/tsx scripts/live-driver-acceptance.ts --ccloop-bin /private/tmp/ccb3-ezF4/repo/dist/cli.js --output $P/runA --omp $P/bin/omp --model local-litellm/ep-20261012204110-nvhqw --omp-config-dir $P/omp-config --scenario requirement
B: $P/iso.sh $P/cache-est ... --output $P/runB ... --scenario estimate --estimate-only
C: $P/iso.sh $P/cache-est ... --output $P/runC ... --scenario estimate --estimate-only
D: $P/iso.sh $P/cache-est node /private/tmp/ccb3-ezF4/repo/dist/cli.js agents models --agents $P/runC/agents.json --installation omp
```
Outputs: `$P/logs/run{A,B,C}.{out,err,exit}`, `$P/run{A,B,C}/summary.json`, `$P/logs/steps.txt` (activity rows, usage
ledger, per-call usage from the summaries), `$P/logs/omp-invocations.log`, `$P/logs/models-warm.*`.

## Per step (times are epoch seconds - 1792129000; activity `at` from each control.sqlite; spawns from the shim log)

| run / step | cache | omp spawns in the step | wall time | outcome |
|---|---|---|---|---|
| A startup (`recover`) | cold | `--version` 51.922. Uncached by design: Orca's startup `agent-installation-observe` -> ccloop `observeAgentInstallations` (`updates.ts:88`, plain `probeVersion`). Not a catalog probe. | -- | -- |
| A open (with set-agent-preferences) | cold, miss | `--version` 52.650 and `models --json` 53.346, the one catalog probe. Entry `ff168a64...json` written (mtime 56). | about 4.9 s (51.9 -> open recorded 56.796). The probe accounts for about 3.4 s of it (52.65 -> entry written by 56.x). | accepted |
| A clarify round 1 | warm (hit) | none, only the single call 57.463 | 9.955 s (run 57.032 -> 66.987) | accepted: 1 message, `stop`, tools off, overlay present, booked = ccloop = 2425. Recommended answers given, then consensus. |
| A split draft 1 | warm (hit) | none, only the single call 67.774 | 10.799 s (67.266 -> 78.065) | accepted: draft `awaiting-review`, 1 message, `stop`, booked = ccloop = 2649 |
| A total | | 1 catalog probe, 2 version probes from ccloop (+1 from the harness's own `versionOf`) | 29 s script (summary 26.6 s) | exit 0, all 14 checks true |
| B startup | cold | `--version` 221.874 (startup observation, as above) | -- | -- |
| B import-plan | cold, miss | `--version` 222.790 and `models --json` 223.409, the one catalog probe. Entry written (mtime 225). | about 3.4 s (221.9 -> import recorded 225.306) | accepted (estimate queued) |
| B estimate (command, claim, accept, worker) | warm (hit) | none, only the single call 226.110 | 15.456 s (225.716 -> 241.172) | **accepted: `ready`**. 1 message, `stop`, tools off, overlay present, booked = ccloop = 3946. One task row. |
| B total | | 1 catalog probe | 21 s | exit 0, all 12 checks true |
| C startup | warm | `--version` 250.593 (startup observation) | -- | -- |
| C import-plan | warm (hit) | **none** | about 0.7 s (250.6 -> 251.312) | accepted |
| C estimate | warm (hit) | **none**, only the single call 252.006 | 10.013 s (251.674 -> 261.687) | **judged invalid: `estimate-output-invalid`**. The model listed task `a` twice; the copy has zero budgets, `rationale: "placeholder"`, `assumptions: ["x"]`. Transport passed: 1 message, `stop`, tools off, overlay present, booked = ccloop = 3205. |
| C total | | **0 catalog probes**. Cache entry not rewritten (mtime still 225). | 13 s | exit 1, only `estimateReady` false |
| D `agents models` | warm | none | 0.14 s | `source: "cache"`, `observedAt` 05:40:25.290Z (B's probe). One row: window 128000, maxOutputTokens 16384, `singleCallExecution: "v1"`. |

Against spec §2.2 (before the cache), the same steps would have spawned: open 1 + clarify 2 + split 2 + import 1 +
estimate 4 = 10 catalog and 10 version probes. Measured here: one catalog probe per cold cache (at open or import), zero
when warm. The one ccloop `--version` per runtime start is the startup installation observation, which does not use the
cache. I note it only; it is not a defect claim, since version caching is plan issue 8.

## Model quality (recorded, not transport)

The duplicate-task estimate recurred in C. That makes 3 of the 4 real omp estimates on this alias with the same shape
(Task 13, the ec9ce319 re-run, and C), with B the first one `ready`. Both B and C ran the same instruction and schema
version. Not re-run: the transport and cache questions are answered, and a re-run would only re-sample the model's quality.

## Paid calls and tokens (tool-reported only)

| call | input | output | total (omp `totalTokens` = ccloop usage.json = Orca booked) |
|---|---|---|---|
| A clarify | 1597 | 828 | 2425 |
| A split | 1755 | 894 | 2649 |
| B estimate | 2361 | 1585 | 3946 |
| C estimate | 2362 | 843 | 3205 |
| **sum** | 8075 | 4150 | **14225** |

4 paid calls, none retried. omp's per-call `cost.total` is 0 for every call: the LiteLLM alias reports no price, so no
dollar figure is available. `cacheRead`/`cacheWrite` are 0. Non-paid spawns: `omp --version` x9 (1 shim self-test, 3 harness
`versionOf`, 3 startup observations, 2 cache misses), `omp models --json` x2 (the 2 misses).

## Left for the human

`$P=/private/tmp/p2-4bPF` is kept, not deleted. `$P/omp-config` holds credential copies, and `$P/home/.omp` holds
omp's private state from these runs.
