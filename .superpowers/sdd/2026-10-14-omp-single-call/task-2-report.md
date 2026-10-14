# Task 2 report (ccloop): the resolution decides; capabilities and accept use it (criteria 1, 2)

Who: Task 2 implementer subagent, session https://claude.ai/code/session_01NCgRiQLh17ENJdrmuJDcKL. When: 2026-10-14.
Where: /Users/biran/code/skills/orca/ccloop-wt/omp-single-call (branch codex/omp-single-call), BASE 8c98b6b.
Commit: **c3d2759** feat(omp): decide the window, single-call answer and cap from the catalog row

## Status: DONE

## What was implemented
Every edit was applied by its quoted anchor text (ruling m2), through a Python script that asserted each anchor occurs exactly once. No line numbers were used.
- `tests/fixtures/fake-omp.mjs`: when `<marker>.catalog.json` exists, its contents are the catalog rows. Otherwise the default row is used as before. This is a fixture change, not a criterion (ruling m6).
- `src/agents/types.ts`: `AgentResolutionV1` gains `singleCallExecution: "v1" | null` and `singleCallOutputCap: number | null`.
- `src/agents/registry.ts`: imports `CatalogRowV1`. `capabilities(config, row?)` and `singleCallExecution(config, row?)` now take the row, and there is a new `singleCallOutputCap(config, row?)`. Per ruling m7, an ERRATUM was **appended** to the `singleCallExecution` doc comment and the original text is kept verbatim. The ERRATUM says that for omp the answer is now decided per selected catalog row (at resolution), not per kind, and that claude and codex still answer per kind.
- `src/agents/claude.ts` and `src/agents/codex.ts`: `singleCallOutputCap()` returns null for both.
- `src/agents/omp.ts`: `contextWindowTokens` is now `row?.contextWindow ?? null`. `singleCallExecution` delegates to `ompSingleCallExecution(row)`. `singleCallOutputCap` returns `row?.maxTokens ?? null`.
- `src/agents/materialize.ts`: `resolveAgent` accepts a new `deps.probeCatalog`. For omp it reads the rows in this order: `probeCatalog`, then `probeModels` (each selector becomes a row with null numbers), then the real `readOmpCatalog`. It finds the selected row (or throws `agent-selection-invalid`) and passes it to all three descriptor methods.
- `src/control/command.ts`: the schema gains `singleCallOutputCap` as an optional, nullable, positive safe integer. The handler now returns `{ protocol: 3, ...resolution }`. The `getDescriptor` import stays because line 235 still uses it.
- `src/control/accept.ts`: the `getDescriptor` import is removed (it had no other use). The refusal now checks `resolution.singleCallExecution === null`.
- New tests, copied verbatim from the brief: `tests/agents/ompSingleCallResolution.test.ts` and `tests/control/ompSingleCallAccept.test.ts`.
- `tests/agents/registry.test.ts` was not edited, as instructed. No existing test was edited.

## RED (before implementation, after the fixture and test files were written)
Command: `./node_modules/.bin/vitest run tests/agents/ompSingleCallResolution.test.ts tests/control/ompSingleCallAccept.test.ts > /private/tmp/osc/logs/t2-red.log 2>&1` → **rc=1**, 8 failed / 8.
What I observed matches the corrected expectation in ruling m1:
- C1 (cap row), C1 (no-cap row), C1 (openrouter): each rejects with `Error: omp-model-catalog-unavailable` (src/agents/ompModels.ts:42). `resolveAgent` ignored `probeCatalog` and spawned `/opt/omp`.
- "still refuses a model the catalog does not list": RED with an uncoded error: `expected Error: omp-model-catalog-unavailable to match object { code: 'agent-selection-invalid' }`.
- claude/codex cap: `TypeError: claudeDescriptor.singleCallOutputCap is not a function`.
- wire test: received `contextWindowTokens: null`, `singleCallExecution: null`, and no `singleCallOutputCap`.
- C2 refusal: `expected undefined to be null` at `expect(resolution.singleCallExecution).toBeNull()` (ompSingleCallAccept.test.ts:53).
- C2 admission: `expected undefined to be 'v1'` at `.toBe("v1")` (ompSingleCallAccept.test.ts:63).

## GREEN (after implementation), measured at the tree committed as c3d2759
| Log | Command | RC | Result |
|---|---|---|---|
| t2-tc.log | `npm run typecheck` | 0 | tsc clean (tsconfig includes tests/) |
| t2-build.log | `npm run build` | 0 | built |
| t2-green.log | vitest on the brief's 11 files (ompSingleCallResolution, ompSingleCallAccept, ompCatalog, ompSelection, registry, materialize, singleCallCapability, requestBoundDimensions, control/command, agentsControl, ompSkillsDir) | 0 | 11 files, 89 passed, 0 failed, 0 skipped |
| t2-wide.log | vitest `tests/agents/` + singleCallCapability + requestBoundDimensions + ompSkillsDir + ompEndToEnd | 0 | 18 files, 153 passed, 0 failed, 0 skipped |

Every log is under /private/tmp/osc/logs/ and I read each one back whole. `RUN` points to /Users/biran/code/skills/orca/ccloop-wt/omp-single-call in every vitest log. The staged diff is in /private/tmp/osc/logs/t2-diff.log (git diff --cached, rc=0). Stat: 11 files, +209/−17.

## Files changed (in c3d2759)
src/agents/{types,registry,omp,claude,codex,materialize}.ts, src/control/{command,accept}.ts, tests/fixtures/fake-omp.mjs, tests/agents/ompSingleCallResolution.test.ts (new), tests/control/ompSingleCallAccept.test.ts (new). All paths were added explicitly, and node_modules was not added.

## Self-review
- The capabilities answer and accept's refusal now read the same value (`resolution.singleCallExecution`), so they can no longer disagree.
- The `probeModels` fallback builds rows with null numbers. Older criteria that inject `probeModels` therefore still resolve, now with omp answering window null, execution null and cap null. This is the same as before for window and execution. Those suites stay green.
- `provider` in the fallback is `selector.slice(0, indexOf("/"))`. `validateSelection` already requires `provider/…`, and only the selected row's provider matters here.
- `singleCallOutputCap` is optional in the control schema (as the brief says), so a handler stand-in that omits it still parses. The real handler always emits it.
- No mutations were run in this task. The brief says the reds of the C2 refusal and "still refuses…" come from the Task 6 mutations.

## Concerns / observations (not acted on)
1. `src/runtime/types.ts:230` still has the comment "only a kind whose descriptor answers singleCallExecution "v1" has it". It describes the answer per kind, so it is now stale for omp. It is outside this task's file list, so I did not touch it. A later task, or an appended ERRATUM, may want to address it (ccloop Rule 16).
2. The worktree's `git status` showed about 230 ` D .superpowers/sdd/...` deletions (older plan directories plus top-level `.superpowers/sdd/*.md`) **before I made any edit**. They were already there in my first status read. I did not touch, stage or restore them. They are not in c3d2759. The human or controller should find out where they came from.
3. The fake-omp fixture was edited (ruling m6). Its default output is unchanged when no `<marker>.catalog.json` exists.
