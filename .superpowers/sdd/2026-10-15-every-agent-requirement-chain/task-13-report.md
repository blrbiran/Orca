# Task 13 report: the model list API (Orca, part C server, spec §5)

Implementer: Orca session a852f96a (subagent), 2026-10-16. Worktree /Users/biran/code/skills/orca/Orca-wt/every-agent-chain, base 36e00586.
Status: DONE_WITH_CONCERNS (see Concerns: three small departures from the brief's text, each argued below).

## Commit
- `3b811679 feat(panel): serve an installation's models from ccloop` (7 files, +153/-3; exact paths staged, node_modules not staged).

## ccloop side confirmed before writing Orca's schema
Read on ccloop worktree tip d9cb32c: `src/agents/models.ts` (`AgentModelsV1`, `listAgentModels`: missing id throws `AgentError("agent-installation-missing", id)`; claude gives `source: "none"`, `models: []`; sorted by model in code-unit order), `src/control/command.ts:105-110` (`modelsSchema`, strict, `observedAt` datetime nullable), `src/control/protocol.ts:139,301` (request `{installation: idSchema, refresh: boolean}` strict). Orca's `agentModelsSchema` matches field for field.

## ORCA_CCLOOP_BIN
`/private/tmp/ccb3-ezF4/repo/dist/cli.js`: a `git clone --local` of the ccloop worktree at d9cb32c, with node_modules symlinked from the main ccloop checkout, built with `npm run build` (RC=0, log `$LOGS/t13-ccloop-build.log`). The clone was never mutated. Note: I ran `git checkout -q d9cb32c` inside this fresh clone of mine, and it was a no-op because the clone's HEAD was already d9cb32c. It did not touch any branch, worktree or repository other than that throwaway clone.
`$LOGS` = /private/tmp/claude-501/-Users-biran-code-skills-orca-Orca/a852f96a-f3c8-4721-9df4-b10c19154451/scratchpad/logs

## What was done
- `src/control/executionPort.ts`: `AgentModelsView` added next to `AgentsView`; added optional `ExecutionPort.listModels?(installation, refresh)`.
- `src/control/ccloopPort.ts`: strict `agentModelsSchema` (ccloop-models-v1) and `listModels`, which calls `raw("models", {installation, refresh})` and passes failures through `named()`. The response's `schema` field is stripped.
- `src/control/webProtocol.ts`: `agentModelsViewSchema` (`orca-agent-models-v1`) after `agentsViewSchema`, plus the `AgentModelsViewV1` type.
- `src/panel/controlApi.ts`: `port` Pick gains `"listModels"`. The route `GET /api/control/agents/:installation/models` is placed inside `if (deps.port)` exactly as the brief has it.
- Fixture, **listed for the human**: `tests/panel/fixtures/controlPanel.ts`, which gains `BootOptions.listModels?: ExecutionPort["listModels"]` and the conditional spread into the port literal (+3 lines).
- Tests: `tests/control/ccloopModels.test.ts` (real ccloop, `it.skipIf(!ORCA_CCLOOP_BIN)` as in webCcloopSmoke) and `tests/panel/agentModelsApi.test.ts` (3 its).

## Status mapping (RF5 and the 424 convention)
- A ccloop process failure (`control-peer-exit`) answers **424 `ccloop-failed`**, message `ccloop-failed:<code>: <detail>`. This follows handoff §3.3d and is unchanged.
- The installation is missing from the table: `named()` turns ccloop's peer exit into `ControlError("agent-installation-missing")`, which is a durable code. It answers **422 `agent-installation-missing`**, which is determinate (<500), as the `/api/control/agents` and preview routes already do. The brief and the handoff do not conflict here: 424 is for anonymous peer exits, and a named refusal keeps its own code. The new criterion pins `[422, "agent-installation-missing"]` and M13.4 shows that without `named()` the refusal would be anonymous.
- `query-invalid` gives 400 (readErrorStatuses). `control-protocol-unavailable` gives **422** (durable catalog), not the 503 the brief guessed at. That is the existing mapping, used unchanged.

## RED / GREEN evidence
- RED: `$LOGS/t13-red.log`, RC=1, all 3 tests failed. `port.listModels is not a function`; the panel got 404 `route-not-found` for both its tests.
- GREEN (after implementing): `$LOGS/t13-green.log`, RC=0, 3 passed, 0 skipped. The RUN root is the worktree.
- Final, with the extra criteria: `$LOGS/t13-final.log`, RC=0, 2 files, **4 passed** (0 skipped, so the real-ccloop test ran). Typecheck `$LOGS/t13-tsc3.log` RC=0.
- Neighbours: `$LOGS/t13-neighbours.log`, RC=0, **14 files, 102 passed**. Files: ccloopModels, agentModelsApi, agentSelectionApi, controlApi, permissions, ccloopFailedMapping, webParity, controlReadApi, humanOnly (panel); webProtocol, webCcloopSmoke, ccloopPort, capabilitySchema, agentSelectionE2E (control).
- CCLOOP_CACHE_DIR: every test file gets its own temp cache dir from the existing setup `tests/setup/relocateCcloopCache.ts`, which is how the second read inside the file answers `source: "cache"`. No real user data was touched.

## Mutations
Clone `/private/tmp/mut-3tNn/repo` (its node_modules symlink is removed; the dir is left for the human). The working state was committed locally in the clone only, so every restore compares against HEAD. Baseline green: `$LOGS/t13-mut-baseline.log`. All logs are concatenated and read whole in `$LOGS/t13-mut-all.txt` and `$LOGS/t13-x-all.txt`.

| # | Mutation | sha256 before -> after | Red in named test | Restore bytes (diff + diff --cached) |
|---|---|---|---|---|
| M13.1 | drop `if (refresh && !owner(res)) return;` | aa8b0eb2… -> da56e67e… | yes: member refresh gets no 403 error body (agentModelsApi.test.ts:35) | 0 |
| M13.2 | drop `\|\| (refreshText !== undefined && refreshText !== "1")` | aa8b0eb2… -> 82e8c02d… | yes: `refresh=yes` gives 200, expected 400 | 0 |
| M13.3 | `listModels(installation, refresh)` -> `(installation, false)` | aa8b0eb2… -> 5716291c… | yes: `seen` shows `["codex", false]` where `true` was expected | 0 |
| M13.4 | `throw named(error)` -> `throw error` (ccloopPort listModels) | 1e430268… -> 157189f2… | yes: ccloopModels.test.ts:40 got `control-peer-exit` | 0 |
| M13.5 (extra) | drop `!idSchema.safeParse(installation).success \|\|` | aa8b0eb2… -> 5bc999c6… | yes: `/agents/-codex/models` gives 500, expected 400 | 0 |
| M13.6 (extra) | drop the `port.listModels === undefined` branch | aa8b0eb2… -> 25ebae63… | yes: gives `[500, control-internal-error]`, expected `[422, control-protocol-unavailable]` | 0 |

After all mutations the run was green again: `$LOGS/t13-mut-after.log` and `$LOGS/t13-x-after.log`. pgrep for fake-omp|fake-codex|worker.js was empty before, after and at the end (`$LOGS/pgrep-t13-*.txt`).

## Files changed
src/control/executionPort.ts, src/control/ccloopPort.ts, src/control/webProtocol.ts, src/panel/controlApi.ts, tests/panel/fixtures/controlPanel.ts (fixture), tests/control/ccloopModels.test.ts (new), tests/panel/agentModelsApi.test.ts (new).

## Rewritten criteria
None. No existing criterion went red.

## Self-review (read the whole diff, `$LOGS/t13-diff.txt`)
- The code matches the brief's snippets verbatim except for formatting of the webProtocol schema (multi-line, to match its neighbours).
- No Orca-side cache: every read goes to the port. M13.3 and the `seen` assertion pin that the refresh flag passes through.
- `observedAt` is a datetime string on the ccloop side (the port enforces it) and a plain nullable string on the web side, as the brief has it.

## Concerns (departures from the brief text)
1. **The brief's panel test read `.code` at the top level of the response body, but the panel's error body is `{error:{code,message,...}}`** (controlErrors.ts `controlErrorBody`). The test reads `.error` through an `errorOf()` helper. The assertions are otherwise as the brief wrote them, so this is a test-shape fix and not a requirement change.
2. **Two criteria the brief did not ask for:** the RF5 assertion is pinned with its status (`[422, "agent-installation-missing"]`, not only the code), and a third `it` plus one assertion cover the `listModels === undefined` branch and the id check. Under Rule 9, those two branches had no criterion until M13.5 and M13.6 showed them red. These are stricter, not looser.
3. **`control-protocol-unavailable` maps to 422, not 503 as the brief guessed.** I used the existing catalog unchanged.
