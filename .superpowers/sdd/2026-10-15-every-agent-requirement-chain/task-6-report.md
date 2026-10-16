# Task 6 report — codex resolves "v1-soft" with its catalog window (ccloop part D, spec §6.1)

Implementer: subagent of Orca session a852f96a (Claude Opus 5.5), 2026-10-16.
Worktree: /Users/biran/code/skills/orca/ccloop-wt/every-agent-chain, branch codex/every-agent-chain.
Base 0085309 -> commit **0d57625** `feat(agents): codex resolves a soft single call and its catalog window`.
LOGS = /private/tmp/claude-501/-Users-biran-code-skills-orca-Orca/a852f96a-f3c8-4721-9df4-b10c19154451/scratchpad/logs
TMPDIR for all runs: /private/tmp/cl-ZpL5.

## What was done
- `src/agents/codex.ts`: `capabilities(_config, row)` -> `contextWindowTokens: row?.contextWindow ?? null`;
  `singleCallExecution(_config, row)` -> `row !== undefined ? "v1-soft" : null`; `singleCallOutputCap` unchanged (null).
  The two published comments (d85776b, c3d2759) are kept verbatim with ERRATUM lines appended.
  Publication check: `git ls-remote origin refs/heads/main` -> 1e05627 (LOGS/t6-lsremote.txt);
  `merge-base --is-ancestor` d85776b and c3d2759 vs 1e05627: RC=0 both (published).
- `src/agents/materialize.ts`: after the omp block, a codex row is looked up in `catalog.rows` (any visibility -> hidden rows are
  valid selections, plan issue 6); catalog null (injected probes) or rows null (catalog failure) leaves `row` undefined.
- `src/agents/registry.ts`: return type `"v1" | "v1-soft" | null`; ERRATUM appended to the doc comment (brief text, plus one
  sentence: "Codex now also answers per selected catalog row ..." — the earlier erratum said codex answers per kind).
- `src/agents/types.ts`: `AgentResolutionV1.singleCallExecution: "v1" | "v1-soft" | null`.
- `src/control/command.ts`: capabilities answer schema `z.enum(["v1", "v1-soft"]).nullable()`.
- Tests:
  - NEW `tests/agents/codexResolution.test.ts` (6 tests): listed row; hidden row (gpt-reserve); no row; **unreadable catalog in its
    own `it` with a fresh table and its own `CCLOOP_CACHE_DIR` (vi.stubEnv, ruling P11)**; **config.toml `model_context_window =
    400000` in the installation's configDir wins over the catalog's 272000 (Task 5 carry)** — the config.toml also has a
    `[features]` table after the key; wire enum through `control capabilities`.
  - `tests/agents/agentCatalog.test.ts` (only-add): "accept for codex probes nothing on a warm key".
  - `tests/control/singleCallCapability.test.ts`: E1 (codex half), E2, E3 rewritten; C3b added (only-add).

## Rewritten criteria (E1-E3, named by the human, Orca session a852f96a, 2026-10-15)
Each has "Ruling: human named E<n> in Orca session a852f96a, 2026-10-15" beside it plus the brief's "Rewritten for ..." comment.
| # | file:line (new) | old | new |
|---|---|---|---|
| E2 | singleCallCapability.test.ts:50 (title; comment :48-49) | "C1: answers singleCallExecution beside an unchanged seven-key view: v1 for claude, null for codex" | "C1: answers singleCallExecution beside the seven-key view: v1 for claude, v1-soft for codex" |
| E1 | :64 | `expect(codexResolution.capabilities).toEqual(SEVEN)` | `toEqual({ ...SEVEN, contextWindowTokens: 272000 })` (claude half / SEVEN untouched — Task 7) |
| E2 | :66 | `...codexResolution, singleCallExecution: null` | `...codexResolution, singleCallExecution: "v1-soft"` |
| E3 | :79 (title), :83 | C3 resolves `{ agent: "codex" }` | resolves `{ agent: "codex", model: "fixture" }`; title per brief; assertion (code 2, `single-call-unsupported`, nothing persisted) unchanged |
No other existing criterion went red; the blanket naming was not used.

## RED / GREEN evidence
- RED: `vitest run tests/agents/codexResolution.test.ts` -> LOGS/t6-red.log: RC=1, 4 failed (listed row, hidden row, config.toml,
  wire) / 2 passed (the two null-null guards, green by construction before the change — they are reddened by M6.6 below).
- After source change, before rewrites: `vitest run tests/agents/codexResolution.test.ts tests/control tests/agents` ->
  LOGS/t6-green.log: RC=1, 77 files, 800 passed / 2 failed = exactly C1 (E1 at :59, E2 behind it) and C3 (E3: accept now answered
  code 0 `{"kind":"unknown"}`). (The `tests/control` filter also matches `tests/controller`.)
- Focused after rewrites: LOGS/t6-green-focused.log: RC=0, 3 files, 30 passed.
- Final neighbour run: same command -> LOGS/t6-green2.log: **RC=0, 77 files, 804 passed**, none failed/skipped.
- `tsc --noEmit -p .`: LOGS/t6-tsc.log, t6-tsc2.log, t6-tsc3.log (after the comment refinement) all RC=0.

## Mutations (clone /private/tmp/mut-F2cM/repo, built with `npm run build`; uncommitted files copied in; baseline LOGS/t6m-baseline.log RC=0, 30 passed)
Runner: $SCRATCH/t6-mut.sh; each runs codexResolution + singleCallCapability + agentCatalog. Restore = `cat` from the worktree;
pre-mutation and post-restore `git diff`+`git diff --cached` both 11913 bytes and byte-identical (cmp) for every mutation
(nonzero because the clone carries the uncommitted change; codexCatalog.ts, committed, diff 0 bytes after M6.5).
| M | change | sha256 before -> after | red in (log) |
|---|---|---|---|
| M6.1 | codex.ts `return row !== undefined ? "v1-soft" : null;` -> `return null;` | 3f5add94…a62c -> 2c23f5fa…6973 | yes: tests 1, 2, config.toml, 6 (wire); C1; C3b; agentCatalog codex accept (`single-call-unsupported`) — t6m-M6.1.log |
| M6.2 | codex.ts `contextWindowTokens: row?.contextWindow ?? null,` -> `null,` | 3f5add94…a62c -> 7fe3d8d6…3fc0 | yes: test 1, config.toml, wire; C1 (E1) — t6m-M6.2.log |
| M6.3 | command.ts `z.enum(["v1", "v1-soft"])` -> `z.enum(["v1"])` | 9e815053…6aea -> 5d6b162d…3330 | yes: wire test (`control-response-invalid`), C1, agentCatalog capabilities warm test — t6m-M6.3.log |
| M6.4 | materialize.ts delete the codex `row = ...` line | 09fcb300…78a5e4 -> eac09397…efb02 | yes: tests 1, 2, config.toml, wire; C1; C3b; codex accept — t6m-M6.4.log |
| M6.5 (carry) | codexCatalog.ts delete `if (window !== null) rows = rows.map(...)` | 3c702017…6d89 -> d3e13044…6f6f | yes: only the config.toml criterion (272000 instead of 400000) — t6m-M6.5.log |
| M6.6 (added) | codex.ts `return row !== undefined ? "v1-soft" : null;` -> `return "v1-soft";` | 3f5add94…a62c -> dfeed4c9…77e8 | yes: no-row test, unreadable-catalog test, C3 (E3), agentCatalog "codex catalog that cannot be read degrades" — t6m-M6.6.log |
pgrep before/after (LOGS/pgrep-t6-before.txt, pgrep-t6-after.txt): no fake-omp/fake-codex/worker.js processes (RC=1, empty).
Clone left for the human: /private/tmp/mut-F2cM/repo (node_modules symlink removed).

## Files changed (commit 0d57625)
src/agents/codex.ts, src/agents/materialize.ts, src/agents/registry.ts, src/agents/types.ts, src/control/command.ts,
tests/agents/codexResolution.test.ts (new), tests/agents/agentCatalog.test.ts, tests/control/singleCallCapability.test.ts.

## Self-review (diff read)
- Codex row lookup only when `catalog.rows !== null`; a failed codex catalog keeps window/singleCall null (degrade), omp path untouched.
- Injected-probe callers (catalog === null) keep the old codex answer null/null — e.g. materialize.test.ts stays green as P-5 predicted.
- C3b keeps a precondition `expect(resolution.singleCallExecution).toBe("v1-soft")` before acceptStart; under M6.1/M6.4 C3b reds on that
  precondition, while the accept gate itself is measured directly by agentCatalog "accept for codex ..." (red with
  `single-call-unsupported`).

## Concerns
1. The spawn-count assertion of the new "accept for codex probes nothing on a warm key" was not separately seen red by a mutation in
   this task (it mirrors Task 4's omp case, whose cache-read mutations are Task 4's); its accept half is seen red under M6.1/M6.4.
2. My first neighbour run (before rewriting E3) let the old C3 accept a codex single call through `runControlCommand` (which launches
   the default worker). pgrep afterwards showed no leftover process.
3. The brief's comment text uses "⇒"; codex.ts uses "=>" (ASCII) — cosmetic.

## Fix round 1 (coordinator, 2026-10-16) — mutation evidence only; no code changed, no commit
Fresh clone `git clone --local` of HEAD 0d57625: /private/tmp/mut-iFqH/repo (built with `npm run build`, RC=0; node_modules
symlink removed afterwards; clone left for the human). Runner $SCRATCH/t6f-mut.sh (applies via mutate.py, runs the named test file,
restores by `cat` of the saved original, then `cmp` plus `git diff` and `git diff --cached` byte count).
Baseline: `vitest run tests/agents/agentCatalog.test.ts tests/control/singleCallCapability.test.ts` -> LOGS/t6f-baseline.log RC=0, 24 passed.

| M | change | sha256 before -> after | result (log read whole) | restore |
|---|---|---|---|---|
| F1 | src/agents/agentCatalog.ts:39 `if (dir !== null && options.refresh !== true) {` -> `... && installation.kind !== "codex") {` | f1f830cc…1600 -> da0f7fc5…fdff | **red** in "accept for codex probes nothing on a warm key" on the spawn count: `expected 7 to be 4` at agentCatalog.test.ts:76 (before + 3 = version + debug-models + features-list). Also red: "capabilities for omp and codex probe once" ([2,10] vs [2,4]) and both "a codex entry … wrong shape" cases ('probe' vs 'cache'). LOGS/t6f-F1.log RC=1 | cmp identical; diff bytes 0 |
| F2 | src/control/accept.ts:88 `resolution.singleCallExecution === null) {` -> `!== "v1") {` | bfb0edde…4e10 -> afb2bf68…dc76 | **red** in C3b only: `ControlProtocolError: single-call-unsupported` thrown by acceptStart (accept.ts:89), surfacing at singleCallCapability.test.ts:98. The `status.kind` assertion is never reached because the refusing gate throws (acceptStart refuses by throwing, not by returning a status). C1, C3 and C4 stay green. LOGS/t6f-F2.log RC=1 | cmp identical; diff bytes 0 |

The Concern 1 above (spawn-count half never seen red) is now closed: F1 makes that assertion red. pgrep after: none (LOGS/pgrep-t6f-after.txt).
