# Task 11 report (implementer, Orca session a852f96a, 2026-10-16)

Status: DONE_WITH_CONCERNS (concerns are notes, none blocking). Commit `8b6b4fc9` on Orca branch `codex/every-agent-chain`
(parent `dfd76de5`). Subject: `feat(control): accept codex's soft single call in soft estimate mode only`.
LOGS = /private/tmp/claude-501/-Users-biran-code-skills-orca-Orca/a852f96a-f3c8-4721-9df4-b10c19154451/scratchpad/logs

## Setup
- ccloop binary: a fresh `git clone --local -b codex/every-agent-chain` of `/Users/biran/code/skills/orca/ccloop-wt/every-agent-chain`
  at `/private/tmp/ccb2-TBiQ/repo`, HEAD `60bcc6c`. Its node_modules is a symlink to `/Users/biran/code/skills/orca/ccloop/node_modules`.
  `npm run build` RC=0 (`t11-ccb2-build.log`). Never mutated. `ORCA_CCLOOP_BIN=/private/tmp/ccb2-TBiQ/repo/dist/cli.js`.
  The ccb2 node_modules symlink is still in place: the controller may reuse this build for later tasks.
- Node v22.13.1. Every run used a fresh `TMPDIR=$(mktemp -d /private/tmp/cl-XXXX)`.

## What changed (4 files, +62/-3)
- `src/control/estimatorCompatibility.ts:16-18`: the brief's split, verbatim (with its comment). Strict mode requires `"v1"`. Soft mode also accepts `"v1-soft"`.
- Per ruling P17, the `ccloopPort.ts`/`agentSelection.ts` enum and type were NOT touched again. They were already present from 06f15c53, comment line included.
- `tests/control/estimatorSoftExecution.test.ts` (new): the brief's text, verbatim.
- `tests/control/codexRequirementOpen.test.ts` (new): the brief's text, verbatim. The strict assertion uses `expect.stringContaining("single-call-unavailable")` (plan issue 16).
- **Fixture change for the human:** `tests/control/fixtures/ccloopWorld.ts`
  - `WorldOptions` gains `/** Spec 2026-10-15 criterion 4: the panel's estimate mode (soft when absent). */ estimateMode?: "strict" | "soft"`.
  - `resolveControlOptions` passes `worldOptions.estimateMode ?? "soft"` in place of the literal `"soft"`. The default behaviour is unchanged.

## RED / GREEN
- RED `t11-red.log` / `t11-red.json`: RC=1. 9 tests, 7 passed, 2 failed, **numPendingTests 0**.
  - `v1-soft in soft mode`: `['single-call-unavailable']` vs `[]`.
  - `opens in soft mode`: got `agent-selection-rejected:estimator:single-call-unavailable`.
- GREEN `t11-green.log` / `t11-green.json`: RC=0. **9 passed, 0 failed, 0 pending** (the ruling's 9, not the plan's 8). Both real-ccloop tests ran and were not skipped.
- typecheck `t11-tsc.log` (`tsc --noEmit -p .`): RC=0.

## Mutations
- Clone: `/private/tmp/mut-x7p7/repo`, `git clone --local` of $OR at dfd76de5. The 4 uncommitted files were copied in with `cat`. Runner: `$SCRATCH/t11-mut.sh`.
- Restore proof (the files under test were uncommitted when the mutations ran, so the clone's diff is not 0 bytes):
  - The baseline `git diff` + `git diff --cached` of the copied-in files is **3526 bytes** (`t11-mut-base.txt`).
  - After each restore it was again **3526 bytes**, and `cmp` against the worktree file was identical (`restored-identical` in each log).
- Baseline `t11-base.log`: RC=0, 9/9.
- M11.1 `(mode === "soft" && execution === "v1-soft")` -> `execution === "v1-soft"`.
  - sha256 `d2c7fe92...4186f -> 637972001...58e6`. `t11-m11-1.log` RC=1.
  - **Red: `v1-soft in strict mode` and `codexRequirementOpen` strict, yes.** The strict message became `...:budget-unavailable,request-bound-unavailable`.
- M11.2 the same expression -> `false`.
  - sha256 `d2c7fe92...4186f -> d6d4b7f3...0c37`. `t11-m11-2.log` RC=1.
  - **Red: `v1-soft in soft mode` and `opens in soft mode`, yes.**
- M11.3 port enum `["v1","v1-soft"]` -> `["v1"]`.
  - sha256 `fcb2566b...4823 -> ab4d2289...1d01`. `t11-m11-3.log` RC=1.
  - **Red: the schema test and `opens in soft mode`, yes.** The strict test went red too.
  - Note: the observed reason is `agent-selection-rejected:estimator:control-response-invalid`, not the `selection-unavailable` the brief predicted. The red is the same; only the name of the refusal differs.
- After the mutations: the clone's node_modules symlink was removed. The clone dir is left for the human. `pgrep-t11-before.txt` and `pgrep-t11-after.txt` were recorded; their processes belong to the concurrent ccloop gate (ccg2 worker.js), and I killed nothing.

## Neighbour run (after edits, before commit)
- Wait: I polled `pgrep -f ccg2-` every 2 min from 12:01:41 (`t11-wait.log`). It printed nothing by 12:39:42, inside the 40-minute cap, so the run was not under the gate's load (load average at the end: 8.08).
- Files: 42 (`t11-neigh-files.txt`). These are every test that imports `estimatorCompatibility` or `ccloopWorld`, plus all `estimat*` and `requirement*` tests in tests/control.
- `t11-neigh.log` / `.json` (read whole): RC=1. **334 passed, 2 failed, 3 skipped.**
  - The 2 failures are `taskResultPaired.test.ts`, at the precondition `expect([fixed, feature]).toContain(realBinary)`. The file hard-codes two other ccloop build paths. This is the known environment red (handoff §6, also recorded in the Task 10 report) and is independent of this change.
  - The 3 skips are `ccloopDefaultE2E`, which skips by design when ORCA_CCLOOP_BIN is set (pre-existing).
  - All P-5 "predicted unchanged" files in this set were green: estimateSingleCallGate 3/3, estimatePrompt 5/5, agentSelectionE2E 6/6, agentUpgradeE2E 2/2, executionDriverE2E 10/10, estimateE2E 3/3, handoffE2E 12/12.

## Rewritten criteria
None. No existing criterion went red because of this change.

## Self-review (diff read)
- The production change is 3 lines and matches the brief exactly.
- `mode` was already a parameter of `estimatorCompatibility`, and every caller passes the panel's mode, so no caller changed.
- The fixture default keeps every other world on `"soft"`.
- No ERRATUM was needed. The ccloopWorld.ts:82 prose ("null otherwise, so the estimate stays blocked-capability") is about the import-time estimate, and it already carries Task 10's ERRATUM. This task did not disprove anything further.

## Concerns / notes
1. Before the fixture change, the RED run showed the strict real-ccloop test **passing**. The world always booted in soft mode, which then still refused v1-soft. So that test's first sighting of red is M11.1 (and M11.3), not the RED run. Under M11.1 it was seen red.
2. M11.3's reason is `control-response-invalid`, not `selection-unavailable` (see above).
3. The taskResultPaired environment red persists with any fresh build path. Task 16's gate needs whatever environment that file expects.
4. For the human to remove: the mutation clone `/private/tmp/mut-x7p7` and the build clone `/private/tmp/ccb2-TBiQ` (keep the build if later tasks reuse it).
