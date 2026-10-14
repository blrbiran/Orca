# Task 4 report (ccloop): single call's spawn-time check, argv, overlay, system prompt (criteria 3, 4)

- Who: Task 4 implementer subagent, session https://claude.ai/code/session_01NCgRiQLh17ENJdrmuJDcKL
- When: 2026-10-14
- Worktree: /Users/biran/code/skills/orca/ccloop-wt/omp-single-call, branch codex/omp-single-call
- BASE d9f7a80 -> commit **281c4e1** `feat(omp): check the catalog cap at spawn and run one call with tools and retries off`

## Status: DONE_WITH_CONCERNS (concern = a load flake already present at BASE, see below)

## What changed (5 files, +189/-0, `git diff --cached --stat` before commit; full diff in /private/tmp/osc/logs/t4-diff.log)
- `src/runtime/omp/ompSingleCall.ts` (new): `OMP_SINGLE_CALL_OVERLAY` (byte-identical to the spec §7 confirmed object), `OmpSingleCallRefused` (`neverStarted = true`, code cap-exceeded | unavailable), `runOmpSingleCall`, all verbatim from the brief. The single call creates its own evidence directory (`mkdir` root mode 0700, then `mkdtemp` `call-*`, which is 0700) before calling `runOmpProcess`, per the controller ruling.
- `src/runtime/omp/phasePrompt.ts`: appended `singleCallSystemPrompt` (verbatim).
- `src/runtime/omp/runOmpPhase.ts`: one doc-comment line only (controller ruling): "Precondition: evidenceDir must already exist; runOmpProcess never creates it (each caller mkdtemps its own, mode 0700)." No code change.
- `tests/fixtures/fake-omp.mjs`: single-call branch inserted after the `const system = ...` anchor (verbatim, fixture not criterion; ruling m6: fixtures touched = this file).
- `tests/runtime/omp/ompSingleCall.test.ts` (new): the brief's 4 tests verbatim, plus these deviations:
  1. `ompWorld` also returns `binary`.
  2. **Added test (Review Focus 2, controller ruling):** "refuses as unavailable, never started, when the catalog probe exits non-zero or prints bad JSON". It replaces the world's binary with a sh wrapper that intercepts `models` (`exit 3`, or `printf 'not json'; exit 0`) and otherwise execs the fake. It asserts code `omp-single-call-unavailable`, `neverStarted`, `observedTokensOf = 0`, and that **no model process ran**: neither `<marker>.calls` nor `<marker>.argv` exists. The brief's own "unavailable" test already covers no row cap, model gone from the catalog, and bad shape (`models: "not rows"`), and also proves no spawn through `.calls`.
  3. The two multi-world loop tests (brief's "unavailable" test and the added one) get a `20_000` ms timeout. Under the combined suite they took 7.9 s / 4.5 s and timed out at vitest's 5 s default (first combined run, t4-suite.log). Alone they take 1.5 s / 0.8 s. Precedent: ccloop commit 1cefda2. This is a new file, so no existing test was edited.
- Cap-exceeded (`row.maxTokens > request.maxOutputTokens` ⇒ refused, neverStarted, no spawn) is covered by the brief's C3 test (`.calls` absent).

## Verification (all logs under /private/tmp/osc/logs/, each read whole)
| Command | Log | RC |
|---|---|---|
| vitest run tests/runtime/omp/ompSingleCall.test.ts (before impl) | t4-red.log | 1. RED: "Failed to load url ../../../src/runtime/omp/ompSingleCall.js" (expected module-load red) |
| same, after impl | t4-green.log | 0 (5/5) |
| npm run typecheck | t4-tc.log, t4-tc2.log (final tree) | 0, 0 |
| npm run build | t4-build.log, t4-build2.log (final tree) | 0, 0 |
| vitest run ompSingleCall + phasePrompt (final tree) | t4-green2.log | 0 (7/7) |
| vitest run tests/runtime/omp tests/agents tests/control/ompEndToEnd.test.ts tests/control/ompSkillsDir.test.ts (before timeout fix) | t4-suite.log | 1: 2 timeouts in the new file + 1 in ompPhase.test.ts |
| same command, final tree | t4-suite2.log | 1: 179/181 pass, 0 skipped. Both reds are in **tests/runtime/omp/ompPhase.test.ts** (untouched file): "keeps a stopped phase's completed-message tokens diagnostic" (`expect.poll` 1000 ms timeout) and "reaps a TERM-ignoring grandchild" (ENOENT grandchild.pid after a 1 s plan timeout), plus an unhandled ENOENT outcome.json rejection from the same file |
| ompPhase.test.ts alone x3 | t4-ompPhase-alone-{1,2,3}.log | 0, 0, 0 (14/14 each) |
| Baseline: same combined command at BASE d9f7a80 in `git clone --local` /private/tmp/osc/mut/t4-base, x2 | t4-base-suite-{1,2}.log | 1, 1: the **same** ompPhase "stopped phase" test reds in both runs ⇒ already flaky under load before this task. (detectIsolation also reds there only because the clone has no dist/ build: ERR_MODULE_NOT_FOUND dist/src/runtime/taskResult.js. That is a clone artifact; it passes in the worktree.) |

Seen-red mutation (clone only, worktree untouched; my files copied in with `cat`): I removed the try/catch around `readOmpCatalog`. Both "unavailable" tests went red (raw `omp-model-catalog-invalid` / `omp-model-catalog-unavailable` instead of the refusal) and the other 3 stayed green. Log: t4-mut-catch.log. Task 6 owns the criteria's mutation set.

## Concerns
1. **tests/runtime/omp/ompPhase.test.ts load flake (existing, untouched):** red under the combined command at both BASE and HEAD, green alone 3/3. These tests use 1 s timing windows. Not fixed (out of scope; existing test). Candidate entry for Orca docs/handoff/known-load-flakes.md.
2. Added a 20 s timeout to two tests in the new file (deviation from brief text; reason above).
3. Process-only: the mutation/baseline clone /private/tmp/osc/mut/t4-base is left in place (not deleted).

## awaitingHuman
- None for this task (no push/merge).
