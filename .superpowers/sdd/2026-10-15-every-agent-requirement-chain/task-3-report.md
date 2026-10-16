# Task 3 report — bounded catalog probe with stage and elapsed time (ccloop, spec §4.3, R6; criterion 2)

Implementer: Claude Opus 5.5 subagent of Orca session a852f96a, 2026-10-16 (Asia/Shanghai). Worktree
`/Users/biran/code/skills/orca/ccloop-wt/every-agent-chain`, branch `codex/every-agent-chain`, base 3204a47.
Status: DONE_WITH_CONCERNS (concerns at the end). Commit: **da714cd** `feat(agents): catalog probes honour the caller's deadline and abort and name their stage`.
LOGS = `/private/tmp/claude-501/-Users-biran-code-skills-orca-Orca/a852f96a-f3c8-4721-9df4-b10c19154451/scratchpad/logs`. TMPDIR=/private/tmp/cl-UKuB.

## What was done
- `src/agents/catalogProbe.ts` (new): `OUTPUT_LIMIT`, `STDERR_KEEP`, `STDERR_TAIL_BYTES`, `stderrTail` moved verbatim from
  ompModels.ts (with the #58 doc comment; `stderrTail` is now exported); `PROBE_CAP_MS`, `ProbeStage`, `CatalogProbeError`,
  `probeTimeoutMs`, `probeFailure`, `runProbe` as in the brief. The close comment keeps the original #58 sentence and adds
  one line about stage/elapsed. `PROBE_TIMEOUT_MS = 10_000` is gone.
- `src/agents/ompModels.ts`: `runOmpJson` → `runProbe` (code `omp-model-catalog-unavailable`; JSON failure still
  `omp-model-catalog-invalid`); `readOmpCatalog(installation, { timeoutMs?, deadline?, signal? })`;
  `readOmpConfiguredDefault` passes `{ timeoutMs: PROBE_CAP_MS }`.
- `src/agents/codexCatalog.ts` (new): `CODEX_SINGLE_CALL_FEATURES`, `readCodexCatalog` as in the brief, plus an exported
  `codexFeatureNames(listed)` (see deviations). No import of registry.ts/materialize.ts from either new module.
- `src/agents/materialize.ts`: `probeVersion(command, { timeoutMs?, signal? })`: listener added after the timer, removed in
  `finish`, plus `if (options.signal?.aborted) abortTree();` for an already-aborted signal. Doc comment: one sentence
  appended (original text untouched).
- `tests/agents/catalogProbe.test.ts` (new): the brief's 9 tests (two adjusted, see deviations) + 5 added: pre-aborted
  signal, stage spawn, output > 1 MiB = stage decode, probeVersion abort (during and before), two-word stage parsing.

## Deviations from the brief (each reasoned; reversible)
1. **Deadline test**: the brief's omp `{hang:true}` fake at `deadline: started+600` was flaky — `.models.pid` was missing
   (ENOENT) in `t3-focus.log`, `t3-focus2.log`, `t3-green.log`, `t3-green-1/2.log`: the fake had not started by the deadline.
   Measured: a freshly written executable's first exec is slow under load (the warm `spawnSync` itself took ~1.5 s in the
   loaded run `t3-green-w3.log`: test 2721 ms vs ~1010 ms alone). Rewritten: the `omp` binary is a shell script
   `sleep 30 & echo $! > pid; wait`, run once with `warm` before the timed probe; deadline 1 000 ms, elapsed ≥ 900, timeout 20 s.
   Gain: the hanging process is a **background child** (not exec'd), so M3.2 is now discriminating (brief predicted it might
   be green because the wrapper execs).
2. **Abort test**: aborts when the fake has written its pid (`pidWritten`, ≤10 s) instead of a fixed 300 ms (same race).
3. **"Without spawning"**: M3.4 survived the brief's test (`t3-m3.4.log`, 14/14 green: a 0 ms kill lands before the fake
   writes `catalog-calls`). Added `vi.mock("node:child_process")` that counts `spawn` calls; both "refuses without spawning"
   tests assert the count is unchanged. The brief's `catalog-calls` ENOENT check stays.
4. **features list parsing**: per controller decision, not the brief's regex: `codexFeatureNames` takes the first word of a
   line with ≥3 words ending in `true`/`false` (real 0.160.0 prints two-word stages, e.g. "under development").
5. `codexHome` fallback uses `env.CODEX_HOME || ...` (and `env.HOME ?`) instead of `??`, so an empty inherited
   `CODEX_HOME` never reads `config.toml` from the working directory (same class as Task 2 Minor 3). No test pins it.

## RED / GREEN evidence
- RED 1 `t3-red.log`: RC=1, load failure `Failed to load url ../../src/agents/codexCatalog.js`.
- RED 2 `t3-red2.log` (stubs): RC=1, 11/11 failed (each test listed). Note: the version-abort test was red for a wrong
  reason (`node -e ... --version` printed node's own version); fixed to a script file before implementing.
- GREEN `t3-green-final2.log`: `vitest run tests/agents/catalogProbe.test.ts tests/agents/ompCatalogDiagnostics.test.ts
  tests/agents/ompCatalog.test.ts tests/runtime/omp tests/agents/materialize.test.ts` → RUN root = the worktree,
  8 files, 92 passed, RC=0. Also `t3-green-w1..3.log` RC=0 ×3 and `t3-green-final.log` RC=0 (before the last comment edit).
- C58a-c pass **unchanged**: `git diff --stat -- tests/agents/ompCatalogDiagnostics.test.ts` → 0 bytes (`t3-c58-diff.txt`).
- `tsc --noEmit -p tsconfig.json` (includes tests) RC=0 (`t3-tsc2.log`).

## Mutations (clone `/private/tmp/mut-sYUN/repo`, `git clone --local` of 3204a47 + the 5 uncommitted files copied in)
Baseline green in clone: `t3-mbase2.log` (14/14, RC=0). Final run on the final files: `t3-final-mutations.txt` (all 12
logs concatenated, `t3-f3.N.log` each). Every restore: `cmp` identical (`restored-identical`); after all, clone
`git diff`+`git diff --cached` = 8209 bytes = byte-identical to the worktree's own uncommitted diff (`cmp` SAME-AS-WORKTREE,
`t3-mut-diff.txt` vs `t3-wt-diff.txt`; untracked files `cmp`-identical, `t3-clone-restore.txt` empty).

| # | mutation | sha256 before -> after | red in named test |
|---|---|---|---|
| M3.1 | `onAbort` → `undefined` | 8d660cdb… -> 4b8ea969… | yes: "kills it when the caller aborts" (20 s timeout) |
| M3.2 | `process.kill(-pid,SIGKILL)` → `child.kill("SIGTERM")` | 8d660cdb… -> 6ab33df4… | yes: deadline test (20 s timeout: the background child keeps the pipe open, the probe never closes) |
| M3.3 | `Math.min(deadline-now, CAP)` → `CAP` | 8d660cdb… -> cb24f670… | yes: "caps the timeout…" (+ deadline, already-passed, codex timeout tests) |
| M3.4 | delete `timeoutMs <= 0` guard | 8d660cdb… -> 6d33d3a6… | yes (after deviation 3): "refuses without spawning when the deadline has already passed" `expected 3 to be 2`; **survived the brief's original test** (`t3-m3.4.log`) |
| M3.5 | `if (window !== null)` → `if (false)` | 3c702017… -> 68bf396b… | yes: "lets config.toml's … win" |
| M3.6 | `.filter(names.has)` → `[...CODEX_SINGLE_CALL_FEATURES]` | 3c702017… -> 1a4abce8… | **no (survives, as the brief predicted)**: the fake lists every flag; registered for Task 8's C8.4 (unknown flag) |
| M3.7 | probeVersion: delete `addEventListener` | 6203a9d1… -> 39fcb1f5… | yes: "stops the version probe when the caller aborts…" |
| M3.8 | probeVersion: delete `if (signal.aborted) abortTree()` | 6203a9d1… -> 3e84f82c… | yes: same test (pre-aborted half) |
| M3.9 | features: `≥3 words && ends true/false` → `words[0] !== ""` | 3c702017… -> 86ec1d24… | yes: "takes each flag's name…" (`WARNING:` admitted) |
| M3.10 | delete pre-spawn `signal.aborted` guard | 8d660cdb… -> 9ff758b7… | yes: "refuses without spawning when the caller has already aborted" |
| M3.11 | output-limit stage `decode` → `exit` | 8d660cdb… -> 3e7e7b45… | yes: "stops output past 1 MiB as stage decode" |
| M3.12 | spawn stage `spawn` → `exit` | 8d660cdb… -> ab0de8f6… | yes: "names a binary that cannot be started as stage spawn" |

## Files changed (da714cd)
src/agents/catalogProbe.ts (new, 69), src/agents/codexCatalog.ts (new, 56), src/agents/ompModels.ts, src/agents/materialize.ts,
tests/agents/catalogProbe.test.ts (new, 165) — 302 insertions, 69 deletions (`t3-staged.txt`).

## Self-review
- Message shape `<code>: <reason> · stage <s> · elapsedMs <n>[ · stderr: <tail>]` — stage/elapsed sit before ` · stderr: `,
  so C58c's `indexOf(" · stderr: ")` slicing still sees only the tail; C58a/b prefixes unchanged.
- `readOmpCatalog()` with no options now waits up to 30 s instead of 10 s (spec §4.3). Callers today: ompSingleCall.ts:38,
  materialize.ts:127, readOmpModels — none passes a deadline yet (Task 4 wires it).
- readCodexCatalog uses one deadline for both probes; `startedAt` for a decode failure is the start of the whole read.
- `stopped`/`spawnError` closure narrowing compiles (tsc RC=0).

## Concerns / for the controller
1. **Leftover processes (need the human to kill; I did not):** `pgrep -fl "fake-omp|fake-codex|sleep 30"`:
   - 88279 `fake-omp.mjs …/ccloop-tmp-NtX3tj/…` — from my RED-2 stub run (old 10 s code; vitest timed out at 5 s and exited
     before the old probe's timer fired). `$LOGS/pgrep-t3-red.txt`.
   - 32926, 48141 `/private/tmp/mut-sYUN/repo/tests/fixtures/fake-omp.mjs …` — from M3.1 runs (abort is a no-op ⇒ the hanging
     fake is never killed). `$LOGS/pgrep-t3-after.txt`. All three are `{hang:true}` fakes; `kill -9 88279 32926 48141`.
2. Clone left for the human to remove: `/private/tmp/mut-sYUN` (node_modules symlink already removed).
3. Task 4: the new test imports `probeVersion` from `../../src/agents/materialize.js`; when Task 4 moves it to a leaf module,
   keep a re-export or update this import.
4. M3.6 survives by construction (fake lists all flags) → needs Task 8 C8.4 re-run.
5. Load-sensitivity: the fake-omp start under a loaded parallel run took >1 s; other suites with sub-second deadlines on
   freshly written wrapper scripts may be flaky for the same reason (not investigated beyond this file).
6. Scratch debug script `$SCRATCH/dbg.mts` left in the scratchpad (no repo effect).
