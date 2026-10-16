# Task 4 report — one reader for every catalog and version read (ccloop, spec §4.1, R4/R6/R8; criterion 1)

Implementer: Claude Opus 5.5 subagent of Orca session a852f96a, 2026-10-16 (Asia/Shanghai). Worktree
`/Users/biran/code/skills/orca/ccloop-wt/every-agent-chain`, branch `codex/every-agent-chain`, base da714cd.
TMPDIR=/private/tmp/cl-ILCp. LOGS = `/private/tmp/claude-501/-Users-biran-code-skills-orca-Orca/a852f96a-f3c8-4721-9df4-b10c19154451/scratchpad/logs`.

**Status: NEEDS_CONTEXT.** No commit. Two existing criteria (not E1-E6) go red deterministically because of this
task's change, so I stopped as the rulings require: I did not edit them, did not run mutations and did not commit. The
implementation is in the worktree, uncommitted (`git status`: M materialize.ts, updates.ts, ompSingleCall.ts,
vitest.config.ts; new agentCatalog.ts, versionProbe.ts, tests/agents/agentCatalog.test.ts, tests/setup/relocateCatalogCache.ts).

## The two reds (each fails alone too: `t4-reds-alone.log`, RC=1)

### R-A `tests/agents/ompUpdates.test.ts` "refuses Apply if the model vanishes after preview and preserves the table bytes"
- Cause: the fixture's omp is a node script that reads its catalog from `state.json`, which is not an argv element, so
  the cache key cannot see it. Preview's `ompUnavailable` warms the cache; the test then empties the catalog; Apply's
  `recheck` → `ompUnavailable` is a cache **hit** → the model still looks present → Apply writes the table.
- This is a behaviour change, not only a fixture artefact: Apply's re-check exists to catch exactly "vanished after
  preview", and with the cache it misses a remote/provider-side vanish for up to 30 minutes.
- Proposed fix (code only, criterion untouched): Apply's `recheck` reads with `refresh: true`; preview keeps the cache.
  Tried in clone `/private/tmp/mut-IT3D/repo` (diff `t4-trialfix-updates.diff`, 3 lines: `ompUnavailable(installation,
  refresh = false)` → `readAgentCatalog(installation, { refresh })`; `recheck` passes `true`): ompUpdates 5/5,
  updates 15/15, updateRecovery 11/11, RC=0 (`t4-trialfix.log`). Not applied to the worktree (needs your nod: it departs
  from the brief's one-line updates.ts change).

### R-B `tests/runtime/omp/ompSingleCall.test.ts` "stops the call at the request's time limit when it is below the installation's"
- The criterion runs a cold single call with `timeoutMs: 300` and expects `omp-timeout:` (and observed tokens `null`).
- Cause: the brief (and spec §4.3 "the spawn-time re-check passes the single call's own deadline") gives the re-check
  the call's deadline. On a cold key the `--version` probe uses up the 300 ms, the catalog probe then gets 0 ms, and the
  call is refused before spawning: `omp-single-call-unavailable: catalog omp-model-catalog-unavailable: timeout 0ms ·
  stage timeout · elapsedMs 0` (neverStarted, books 0).
- Options (your call; I took neither):
  (1) The human names this criterion (Rule 15) and its rewrite warms the cache first (`await readAgentCatalog(w.config.installation)`)
      so it keeps testing the call's own time limit; a new criterion pins the cold case (re-check past the call's deadline ⇒
      `omp-single-call-unavailable`, neverStarted, books 0). In production the accept-time resolution warms the same key,
      so the re-check is normally a hit.
  (2) The re-check does not take the call's deadline (keeps the criterion green; contradicts spec §4.3 / R6).

### Third red, unrelated: load flake
`tests/controller/verifySavedResult.test.ts` "r1 command interruption modified=false ..." red in the parallel run
(`completedWithResult true / tokenUsage 0` vs `false / null`); green alone (`t4-vsr-alone.log`, 2 passed, RC=0). Touches no
agent/catalog code. New load-flake candidate.

## What was done
- `src/agents/versionProbe.ts` (new, P12): `probeVersion` + its three constants moved verbatim (leaf: imports only
  node:child_process). `materialize.ts` imports it and re-exports it (`export { probeVersion };`), so
  `tests/agents/catalogProbe.test.ts`, `agentsFixture.ts`, updates.ts, detect.ts, command.ts keep importing it unchanged.
- `src/agents/agentCatalog.ts` (new): as the brief, plus (a) `wellFormed(entry)`: an entry whose `rows` elements are not
  `{selector: string, provider: string, contextWindow: number|null, maxTokens: number|null, listed?: boolean}` or whose
  `codexFeatures` elements are not strings is a miss (logged as a miss) and is overwritten by the probe (Task 2 deferred
  item); (b) deviation: the version timeout is `min(10_000, probeTimeoutMs(deadline))` on the real clock, not
  `probeTimeoutMs(deadline, now())` — the catalog probes measure the same deadline on `Date.now()`, so the injected `now`
  only bases the default deadline and dates/ages the entry; mixing clocks would give the two probes different budgets.
- `materialize.ts` `resolveAgent`: `deps.deadline` / `deps.signal`; without injected probes the version and the catalog
  come from `readAgentCatalog` (one deadline, plan issue 4); omp throws `new Error(catalog.catalogError)` on failure; a
  codex catalog failure is ignored here (plan issue 5: degrade; codex rows reach resolution in Task 6); injected probes
  keep the old uncached path (written as an `if` chain).
- `updates.ts:139-147`: `ompUnavailable` reads through `readAgentCatalog` (brief). The `readOmpModels` import is now unused
  but `tsc` does not flag it (no noUnusedLocals), so per the brief it stays.
- `ompSingleCall.ts`: re-check via `readAgentCatalog(..., { deadline: now + min(request.timeoutMs, installation.timeoutMs),
  signal, log })`, `log` writes the line to `process.stderr` (worker ruling); ERRATUM appended to the published comment
  (original text untouched).
- `tests/setup/relocateCatalogCache.ts` + `vitest.config.ts` setupFiles (after scopeTmpdir.ts), verbatim.
- `tests/agents/agentCatalog.test.ts`: the brief's 6 tests verbatim + 11 for the rulings: malformed rows/features ×4
  (it.each), RF4 future-dated / key-mismatch ×2, RF3 (relative CCLOOP_CACHE_DIR, no HOME: probes twice, cwd stays empty),
  shared deadline (plan issue 4: `now` shifted so "30 s from now" is 1 s away, wrapper `--version` sleeps 3 s ⇒ version null,
  catalog `stage timeout`, < 2.9 s; and `resolveAgent(..., { deadline: now+1000 })` rejects "Could not observe the version"),
  codex degrade / omp refuse (plan issue 5), `control` stderr is "" cold and is the failure alone when failing
  (plan issue 3), worker re-check logs `miss` and `probe-failed` lines (plan issue 3).

## RED / GREEN evidence
- RED 1 `t4-red.log`: RC=1, load failure (module absent). RED 2 `t4-red2.log` (stub that throws): RC=1, 16 failed / 1 passed
  — the one green is RF3 (true before the change too: nothing wrote a cache); it is a guard, and its mutation was not run (stopped).
- GREEN focused `t4-focus.log`: RUN root = worktree, 17/17 passed, RC=0. Criterion 1's `[2, 4]` measured as predicted.
- P12 / TDZ `t4-p12.log` (`tests/runtime/omp tests/agents/registry.test.ts tests/agents/catalogProbe.test.ts`): no
  "before initialization"/TDZ error; registry 17/17, catalogProbe 14/14; the only failure is R-B.
- Whole dirs `t4-green.log` (`vitest run tests/agents tests/control tests/runtime`; the `tests/control` filter also matches
  `tests/controller`): 130 files, 1291 passed, 3 failed (R-A, R-B, the verifySavedResult flake), RC=1.
- `npm run build` RC=0 (`t4-build.log`); `tsc --noEmit` RC=0 (`t4-tsc1.log`).
- `pgrep -fl "fake-omp|fake-codex|worker.js"` after the runs: empty (`pgrep-t4.txt`).

## Mutations
Not run (stopped before Step 6). Clone left for the trial fix only: `/private/tmp/mut-IT3D/repo` (node_modules symlink removed;
its updates.ts carries the trial fix — the human removes the dir).

## Concerns
1. R-A and R-B above need a decision before commit.
2. Worker log visibility: `launchWorker` (src/control/workerLauncher.ts:58-62) spawns the worker with `stdio: "ignore"`, so
   in production the `ccloop-agent-catalog:` lines the worker writes to stderr go nowhere; the ruling's "whose stderr goes
   to its own log" does not hold today. The criterion proves the line is written (stderr spy, in-process). If the line must
   be readable, it needs a file (e.g. in the call's evidence dir) — a scope change I did not make.
3. Production stderr noise in tests: in-process runs now print `ccloop-agent-catalog: miss ...` into vitest output (seen in
   the logs). Harmless; no criterion asserts the test runner's stderr.
4. `readCodexCatalog` (Task 3) builds its env from `process.env`, not `readAgentCatalog`'s `env` option, so `env` only
   redirects the cache dir and the key (as the brief's code does).

---

## Resumption after the controller's answers (2026-10-16, same implementer) — Status: DONE_WITH_CONCERNS

Commit **573ecfa** `feat(agents): read every catalog and version through the file cache` (base da714cd; 9 files, +432/-60,
`t4-staged.txt`). Clone `/private/tmp/mut-xOIi/repo` left (node_modules symlink removed); the earlier trial clone
`/private/tmp/mut-IT3D/repo` is also left. The human removes both.

### Changes since the NEEDS_CONTEXT stop
1. updates.ts: `ompUnavailable(installation, refresh = false)`; Apply's `recheck` passes `true` (preview keeps the cache),
   with a comment naming the ruling. The unused `readOmpModels` import is gone. New criterion in agentCatalog.test.ts:
   "Apply re-probes the omp catalog that preview cached" (catalog-calls before Apply + 1).
2. ompSingleCall.test.ts "stops the call at the request's time limit when it is below the installation's": rewritten whole
   with the ruling comment beside it. It warms the cache first (`readAgentCatalog` → `catalogError` null), keeps every old
   assertion (`omp-timeout`, < 10 s, observed tokens null), and adds `.calls === "single-call\n"` (the call itself was spawned and
   stopped). This makes it tighter, not looser. The `it` had no published comment, so no ERRATUM was needed there.
   NEW criterion next to it: "refuses before spawning, naming stage and elapsed time, when a cold re-check outlives the call's
   deadline". Cold key, catalog sleeps 10 s, call timeoutMs 1000. It expects `{code: omp-single-call-unavailable, neverStarted: true}`, the
   message `…: catalog omp-model-catalog-unavailable: timeout Nms · stage timeout · elapsedMs N`, < 5 s, books 0, and no `.calls`.
   It has an explicit 20 s test timeout, so the mutation reddens an assertion rather than vitest's 5 s timeout (first M4.12 run: timeout-red only;
   after the change: red on `toMatchObject`, `t4m-M4.12.log`).
3. Worker log: unchanged. **No production sink yet:** workerLauncher.ts:58-62 spawns the worker with `stdio: "ignore"`,
   so the line is invisible in production. Registered for the handoff, not fixed here.

### Verification
- Build RC=0 (`t4b-build.log`); `tsc --noEmit` RC=0 (`t4b-tsc.log`, and again `t4c-tsc.log` after the last test edit).
- Focused (agentCatalog, ompSingleCall, ompUpdates, registry, catalogProbe) `t4c-final.log`: 5 files, 81 passed, RC=0, RUN root =
  worktree.
- Neighbour dirs `t4b-green.log` (`tests/agents tests/control tests/runtime`; ran before the 20 s timeout was added to the new
  criterion): 1293 passed, 3 failed, RC=1. All 3 failures are load flakes. Each is green alone (`t4b-flakes-alone.log` RC=0, `t4b-vsr-alone.log` RC=0) and none
  touches catalog code:
  - extractFinalObject perf (3059 ms > 3000).
  - ompPhase "keeps a stopped phase's completed-message tokens…" (poll 1000 ms for the fake's ready file). It also left one unhandled
    ENOENT on outcome.json from the same test's teardown.
  - verifySavedResult "r1 command interruption modified=false" (known candidate).
- Evidence-discipline breach (Rule 14), stated plainly: I summarised the neighbour log once with `sed`, and I read the mutation logs
  through `grep -v` that dropped the `ccloop-agent-catalog:` lines and the passing `✓` lines. The full files are in LOGS, unaltered.
- pgrep for fake-omp|fake-codex|worker.js after all runs: empty (`pgrep-t4b.txt`).

### Mutations (clone `/private/tmp/mut-xOIi/repo` = da714cd + the uncommitted files; baseline `t4m-base.log` 50/50 RC=0;
script `scratchpad/t4-mutate.py`, summary `t4m-summary.txt`; every restore sha256-identical)
| # | mutation | sha256 (12) | red in named test |
|---|---|---|---|
| M4.1 | hit return → `if (false)` | f1f830cc5a64→cd5bbf7a5316 | yes: both criterion-1 tests ([6,10]≠[2,4]; 4≠2), plus refresh, R8, shape |
| M4.2 | `options.refresh !== true` → `true` | →918e974aa4ae | yes: "refresh skips the read" (also "Apply re-probes") |
| M4.3 | drop `&& catalogError === null` | →61c903e549cb | yes: "does not write an entry when a probe failed" |
| M4.4 | re-check → old `readOmpCatalog` | d029be9a506d→0f842800638a | yes: "reads the omp spawn-time re-check through the cache (R8)" (+ worker-log test) |
| M4.5 | resolveAgent catalog → `null` | 66368d0910ab→0f5056debc5c | yes: both criterion-1 tests ([2,2]; 4≠2), plus plan issues 4 and 5 |
| M4.6 | drop the setup file from vitest.config.ts, HOME=$M/fakehome | 5a095634…→396b3698… | yes: 7 entries appeared under `$M/fakehome/.cache/ccloop/agent-catalog` (`t4m-M4.6-ls.txt`); restored by cat, fakehome removed |
| M4.7 | Apply `ompUnavailable(selected, true)` → no refresh | 23de4cb90c94→14a8d4731102 | yes: ompUpdates "refuses Apply if the model vanishes…" and "Apply re-probes…" |
| M4.8 | drop `wellFormed(hit)` | f1f830cc5a64→d22b41777209 | yes: all 4 wrong-shape tests |
| M4.9 | `options.deadline ?? now() + PROBE_CAP_MS` → `options.deadline` | →701c3f5f475a | yes: plan issue 4 (version '18.10.1' ≠ null) |
| M4.10 | drop the worker `log` option | d029be9a506d→47a782471c73 | yes: worker-line test |
| M4.11 | resolveAgent drops `deadline: deps.deadline` | 66368d0910ab→17d3dc6c0622 | yes: plan issue 4 (resolveAgent half) |
| M4.12 | re-check drops the call's deadline | d029be9a506d→df2613a2a1a0 | yes: new cold-deadline criterion (`toMatchObject` on null) |
Restore: clone `git diff`+`git diff --cached` = 16138 bytes = the worktree's own pre-commit diff, `cmp` SAME-AS-WORKTREE
(`t4m-clone-diff.txt` vs `t4m-wt-diff.txt`). The untracked files were compared with `cmp` and are identical.

### Remaining concerns
- The worker log line has no production sink (see 3 above).
- `readCodexCatalog` takes its env from `process.env`. `readAgentCatalog`'s `env` option only moves the cache dir and changes the key.
- Version timeout uses the real clock (`probeTimeoutMs(deadline)`), not the injected `now` (deviation from the brief, reasoned above).
- RF3 was green before the change (a guard). No mutation of mine reddens it; catalogCache's own RF3 criteria (Task 2) pin
  `catalogCacheDir`.

---

## Fix round 1 (2026-10-16, same implementer) — commit **b4bf908** `fix(omp): the spawn-time re-check and the single call share one deadline`

### Changes
1. `src/runtime/omp/ompSingleCall.ts`: before this fix the re-check got `now + min(request, installation)` and the spawn then got that full limit
   a second time. Now `deadline` is computed once, before the re-check. `readAgentCatalog` takes that deadline, and the spawn gets
   `Math.max(1, deadline - Date.now())` (spec R6).
2. `tests/runtime/omp/ompSingleCall.test.ts`:
   - NEW criterion "stops a call after a slow cold re-check at the original deadline, not a fresh full limit". Setup: cold key,
     catalog sleepMs 2000, call limit 6000, `{hang:true}`. It asserts `omp-timeout`, observed tokens null, the call was spawned,
     5900 ≤ elapsed < 7500, and exactly one `miss` line.
   - A file-level stderr spy (`beforeEach`/`afterEach`) captures `ccloop-agent-catalog:` writes into `catalogLines` and
     passes every other write through. The cold-deadline criterion now asserts its `miss` + `probe-failed … stage timeout` lines.
   - The production line is unchanged.
   - Timing note: a first try with a 2.5 s sleep inside a 3 s limit went red for a real reason (`t4f-osc.log`). The version probe took about 0.5 s, so the
     catalog probe itself ran out of the deadline. The window was widened to 2 s inside 6 s.
3. Noise scan: each candidate suite was run alone (`t4n-scan.txt`, with per-file logs in `logs/t4n/`). Only
   `tests/runtime/omp/ompSingleCall.test.ts` printed lines (21). Every other suite printed 0: agentCatalog.test.ts already spied, and
   ompSingleCallWorker hits a cache that resolveAgent warmed.

### Verification
- tsc RC=0 (`t4f-tsc.log`, `t4f-tsc2.log`); build RC=0 (`t4f-build.log`).
- Affected files (ompSingleCall + agentCatalog) `t4f-affected.log`: 46/46, RC=0, read whole. The log contains no `ccloop-agent-catalog:`
  line.
- Neighbour dirs `t4f-green.log` (`tests/agents tests/control tests/runtime`): **130 files, 1297 passed, RC=0**, read
  whole in three parts. No catalog lines, no unhandled errors. The earlier load flakes did not recur in this run.
- Mutation (fresh clone `/private/tmp/mut-S6UT/repo`; baseline `t4f-mbase.log` 28/28 RC=0): spawn `timeoutMs` set back to
  `Math.min(request.timeoutMs, config.installation.timeoutMs)` (sha256 a3e36aa8…→cdebedd9…). It turned the new criterion red
  (`t4f-M1.log`: "expected 8571 to be less than 7500"). Restore: clone `git diff`+`--cached` = 5713 bytes, identical to the worktree's
  pre-commit diff (`cmp` SAME-AS-WORKTREE). node_modules symlink removed; the clone dir is left for the human.
- pgrep after the runs: empty (`pgrep-t4f.txt`).
- Rule 14 note: in this round every verifying log was read whole. `grep -c` was used only to count catalog lines per log, and
  the logs were not filtered for pass/fail.
