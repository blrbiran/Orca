# Task 3 report (ccloop): extract omp process handling from the phase runner

- Who: Task 3 implementer subagent, session https://claude.ai/code/session_01NCgRiQLh17ENJdrmuJDcKL
- When: 2026-10-14
- Worktree: /Users/biran/code/skills/orca/ccloop-wt/omp-single-call (branch codex/omp-single-call)
- Base: c3d2759 -> commit d9f7a805c05e46bfd5b54436efc8e5668cf5ab0e
  `refactor(omp): run one omp process from its argv, cwd and time limit` (ends with the two required trailer lines)

## Status: DONE

## What moved where (all in `src/runtime/omp/runOmpPhase.ts`)

Applied by anchor: everything from the unique anchor `export interface OmpPhaseOutcome {` to end of file was
replaced with the brief's Step 2 block verbatim (extracted programmatically from task-3-brief.md; anchor count asserted == 1).

- New `export interface OmpProcessInput { args; prompt; cwd; evidenceDir; timeoutMs; phase; abortSignal?; onProcessRegistered? }`.
- New `export async function runOmpProcess(config, input): Promise<OmpPhaseOutcome>` now owns: creating `events.jsonl`/`stderr.log`,
  `outcome.json` persist, pre-spawn abort / `timeoutMs <= 0` neverStarted paths, env (`OMP_PROFILE`, `PI_CODING_AGENT_DIR`),
  detached spawn with `cwd: input.cwd`, group kill + kill grace, timeout timer, abort listener, 16 MiB output limit on stdout/stderr,
  `ps lstart` identity -> `process.json` -> `onProcessRegistered` before `stdin.end(prompt)`, exit/close/drain handling.
- `runOmpPhase` keeps its signature; it still does skills block, evidence dir (`runDir/omp/<attempt>/<phase>/call-*`), system prompt,
  phase argv, and computes `timeoutMs = min(installation.timeoutMs, budgetSnapshot.timeRemainingMs)`, then delegates.
- Intended differences only (as the brief states): the system prompt is written alone before the `events.jsonl`/`stderr.log`
  `Promise.all` instead of in one `Promise.all`; `context.*` reads became `input.*` (`profile` re-derived inside `runOmpProcess`).
- Callers: only `src/runtime/omp/ompAdapter.ts:17` (unchanged) plus the two omp test files; `grep -rn -e runOmpPhase -e runOmpProcess -e OmpPhaseOutcome src tests --include=*.ts`.

## Verification (commands, RCs, counts)

Same command before and after (cwd = the ccloop worktree):
`./node_modules/.bin/vitest run tests/runtime/omp tests/control/ompEndToEnd.test.ts tests/control/ompSkillsDir.test.ts`

| Run | Log | RC | Files | Tests | Skipped |
|---|---|---|---|---|---|
| Baseline at c3d2759 (pre-edit) | /private/tmp/osc/logs/t3-base-before.log | 0 | 5 passed (5) | 40 passed (40) | 0 |
| After edit | /private/tmp/osc/logs/t3-after.log | 0 | 5 passed (5) | 40 passed (40) | 0 |

Per-file counts identical both runs: phasePrompt 2, ompSkills 12, ompEndToEnd 4, ompSkillsDir 8, ompPhase 14.
vitest `RUN` line pointed at /Users/biran/code/skills/orca/ccloop-wt/omp-single-call in both logs.

- `npm run typecheck` -> /private/tmp/osc/logs/t3-tc.log, rc=0
- `npm run build` -> /private/tmp/osc/logs/t3-build.log, rc=0
- Staged diff: /private/tmp/osc/logs/t3-diff.log, 6497 bytes (`wc -c`), 1 file, 38 insertions / 16 deletions.
- No timeouts, no flakes, no test touched. `git status --short` after commit: only `?? node_modules` (expected).

## Files changed
- src/runtime/omp/runOmpPhase.ts (only)

## Self-review
- Diff read whole: every `context.abortSignal` / `context.onProcessRegistered` / `context.worktreePath` / `phase` / `prompt` use
  inside the process body is now the `input.*` equivalent; the values runOmpPhase passes are exactly the old ones, so behaviour for phases is unchanged.
- Registration order (process.json + onProcessRegistered before stdin write) preserved; covered by the existing
  "registers the process identity before the fake CLI can receive its prompt" test, green.
- Abort is still checked pre-spawn and re-checked after the listener is attached.

## Concerns / notes
- `runOmpProcess` has no direct test yet; by design it is exercised only through `runOmpPhase` until Tasks 4-5 add `singleCall`.
- `runOmpProcess` assumes `input.evidenceDir` already exists (it writes files into it, never creates it). runOmpPhase creates it via
  mkdtemp; the Task 4-5 single-call caller must do the same (mode 0700) or writes fail with an uncaught rejection before any spawn.
- No mutation run was done: this is a no-behaviour-change refactor with no new branch; the existing criteria are the criterion per the brief.
- Log name: the brief's Step 1 says t3-before.log; the dispatch asked for t3-base-*.log, so the baseline is t3-base-before.log.
