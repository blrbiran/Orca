# Task 4 report — freezing skills into the execution snapshot at confirm

Author: implementer subagent of session `08b1007d` (Claude Opus 5.5), 2026-10-03. Base: HEAD `60a0eb0`.
Commit: `114b20d feat(confirm): freeze each task's skill set into the execution snapshot` (local, not pushed). This
report is not in the commit, because `.superpowers/sdd/<plan>/` is gitignored except `progress.md`, and earlier task
reports are untracked too.

## Golden capture (before any code change)

- Clone of `60a0eb0` at scratchpad `t4/clone`, unmodified source. A temporary test added to the clone's
  `tests/control/executionSnapshot.test.ts` printed `prepareExecutionSnapshot(input()).snapshotHash`, then the file was
  restored with `git checkout`.
- Command: `npx vitest run tests/control/executionSnapshot.test.ts -t GOLDEN` (exit 0), output in `t4/golden.out`.
- Value: `ca87b1d91a714999ebec5b3bbd5344f841d8cac8bc7d94ffa83f0819d36297a2`, pinned as `GOLDEN_SNAPSHOT_HASH`.
- Why this golden and not a confirm-level one: `webFixture` puts a temp-dir `repoPath` into each contract, so a
  confirmed group's snapshot hash differs on every run. The confirm-level check is instead "no `skills` key and no spawn".

## TDD

- Process deviation (stated, not hidden): the source was written before the tests. RED was shown afterwards by running the
  new tests against the unmodified `60a0eb0` source in the clone.
- RED (clone, HEAD source + new tests): `npx vitest run tests/control/confirmSkills.test.ts tests/control/executionSnapshot.test.ts`
  gave exit 1, **20 failed | 16 passed** (`t4/red.out`). Every new skills test failed with the expected reason (no
  `skills` in the snapshot or the read, no refusal, `deps.syncskill` undefined, the schema not refusing). The golden test
  and the precedence test passed at HEAD, which is correct: both protect behaviour that already existed.
- GREEN (main tree): the same two files gave exit 0, 36 passed (`t4/green.out`).
- Final check in the main tree: `tsc --noEmit` exit 0. confirmSkills, executionSnapshot, panel/refusalCoverage and
  setTaskLoopConfirmed gave exit 0, **46 passed** (`t4/main-final.out`).

## Wide run (clone `t4/clone`, byte-identical to the main tree: `cmp` on all 9 files)

- `tsc --noEmit` exit 0.
- `npx vitest run tests/control tests/skills tests/panel` gave exit 1, 21 failed | 1560 passed | 47 skipped
  (`t4/wide.out`, load avg 10.66 at the end). Breakdown:
  - `panel/refusalCoverage`: **a real failure caused by this task.** The new codes had no Chinese entry. Fixed by adding
    9 entries to `web/src/locales/zh.ts`.
  - `control/schedulerBridge` (4): the ccloop sibling was missing in the clone layout. `controlMount` (12),
    `controlShutdown` (1) and `readyHint` (1): `web/dist` was missing in the clone. These are environment failures.
  - `control/driverRequirementSplit` (1): a 5 s timeout under load.
- Rerun with `ORCA_CCLOOP_BIN` pointed at the sibling ccloop build and `web/dist` symlinked from the main tree:
  schedulerBridge, controlMount, controlShutdown, readyHint and refusalCoverage gave exit 0, 32 passed. The timeout file
  passed 3 times when run alone (exit 0 each, 8 passed; uptime load 6.60 / 6.15 / 6.62). All in `t4/rerun.out`.
- `web/tests/i18nKeys.test.ts` and `web/tests/refusalText.test.tsx` gave exit 0, 9 passed (`t4/web.out`).

## Mutations (scratch clone `t4/mut`, candidate committed there; script `t4/mutate.py`, table `t4/mutations.tsv`)

Every mutation was seen red (vitest exit 1). Filters: confirmSkills -t C3/C4/C16/ORCA_SYNCSKILL_BIN; executionSnapshot -t skills.

| id | mutation | result |
|---|---|---|
| M1 | freeze the profile name without its members | 2 failed |
| M2 | no normalisation (profileMembers keeps the raw order and duplicates) | 2 failed |
| M3 | drop the lookup-failure refusal | 3 failed |
| M4 | drop skills-unsupported-agent | 1 failed |
| M5 | drop the `syncskill-failed:<X>` mapping | 1 failed |
| M6 | drop skills-profile-empty from the mapped refusals | 1 failed |
| M7 | drop the whole tamper check | 5 failed |
| M7a | drop the "entry exists exactly when declared" check | 2 failed |
| M7b | drop the names comparison | 1 failed |
| M7c | drop "a names entry has a null profile" | 1 failed |
| M7d | drop the profile comparison | 1 failed |
| M8 | schema: drop sorted/unique by taskId | 1 failed |
| M9 | schema: drop "taskId among derivedContracts" | 1 failed |
| M10 | schema: entry names may be empty | 1 failed |
| M11 | schema: the list may be empty | 1 failed |
| M12 | prepare writes `skills: []` instead of omitting the key | 1 failed (the golden) |
| M13 | lookup failure decided before the existing checks | 1 failed (the precedence test) |
| M14 | env: an empty ORCA_SYNCSKILL_BIN is kept | 1 failed |
| M15 | assembly does not pass syncskill | 3 failed |
| M16 | a lookup per task instead of per distinct profile | 2 failed |
| M17 | readConfirmedTaskExecution never returns the entry | 2 failed |

Restore proof (in `t4/mut` after the run): `git diff` 0 bytes, `git diff --cached` 0 bytes. The main tree was never mutated.

## Files changed

- `src/control/errors.ts`: 9 durable codes, all 422.
- `src/control/webProtocol.ts`: optional `skills` field and the superRefine checks.
- `src/control/executionSnapshot.ts`: `ConfirmedProposal.skills?` (sorted, omitted when empty); `readConfirmedTaskExecution`
  check and `skills` return.
- `src/control/webService.ts`: `WebServiceDeps.syncskill?`; `lookupSkillProfiles` / `syncskillRefusal`; freeze and
  refusals inside `confirm`.
- `src/skills/syncskill.ts`: `syncskillOptionsFromEnv(env)`, the single ORCA_SYNCSKILL_BIN read for Task 6 to reuse.
- `src/panel/controlAssembly.ts`: passes `syncskill: syncskillOptionsFromEnv(env)` to WebControlService.
- `web/src/locales/zh.ts`: Chinese entries for the 9 codes (required by `tests/panel/refusalCoverage.test.ts`).
- Tests: new `tests/control/confirmSkills.test.ts` (17). `tests/control/executionSnapshot.test.ts` gains 5 cases.
  **The one existing line modified:** its import line now also imports `executionSnapshotSchema`. No other existing test
  was touched.

## Decisions

1. **HTTP status: all 9 codes are durable 422.** The durable catalogue only has 400/404/409/422/423, and there is no
   ccmem code in `errors.ts`. The neighbours are `control-port-unconfigured` and `control-estimator-unconfigured` (422,
   "understood, but the environment cannot carry it out") and `agent-installation-missing` (422). I did not use a
   non-durable transient class for timeouts. The panel issues a fresh commandId per click, so a retry is not blocked by
   the frozen outcome.
2. **`skills-shape` is registered too.** profileMembers throws it when a profile member breaks the name rule. The
   controller's 1:1 mapping needs it to be a known code.
3. **A SyncskillError code outside the known list** is rethrown raw, so it escapes as an internal error rather than being
   cast to an unregistered ControlError.
4. **`deps.syncskill` is optional, and absent means unconfigured** (`{ bin: null, env: {} }`). The brief said required.
   Required would have forced edits to about 40 existing test files that build WebControlService, against "do not modify
   existing tests". It fails closed, and production assembly always passes it.
5. **Refusal position.** The lookup failure and `skills-unsupported-agent` are thrown inside `apply` after the
   agent-selection checks and the `handoff-grant-insufficient` check, just before `prepareExecutionSnapshot`. The checks
   inside `prepareExecutionSnapshot` (execution-policy-unrepresentable, group-budget-unavailable, and others) now come
   after the skills refusals, because the skills have to be passed into it. This is the brief's placement.
6. **Lookup failure takes precedence over the agent refusal.** A codex task with a profile and an unset bin is refused
   `syncskill-unconfigured` (the brief's order). Tasks with `names` never spawn.
7. **Agent check.** The check is `agent.agent === "claude"` (installation id), as the controller and plan state.
8. **Stricter than asked, each mutation-proven.** The schema also refuses an empty `skills` list (one representation for
   "no skills"; M11). `readConfirmedTaskExecution` also refuses a names-recipe entry whose profile is not null (M7c).
   Names are compared with `sha256Canonical`, not `join`.
9. **Errors carry no detail**, per the controller's `new ControlError(code)`, except `syncskill-failed:<X>` and
   `skills-unsupported-agent:<taskId>`.
10. **A non-SyncskillError while reading recipes before the transaction** (for example a missing group) yields "no
    lookups". The transaction's own checks then name the real problem.

## Concerns

- **One defensive branch is not mutation-tested:** `recovery-blocked` with detail `skills-lookup-missing:<taskId>` in
  `confirm`. It fires if a task's profile is absent from the lookup map. This is unreachable through the API, because a
  recipe change before the transaction reopens the proposal, which is refused first as `proposal-version-conflict`.
- **Installation id vs agent kind:** an installation whose id is not `claude` but whose kind is claude would be refused
  at confirm. That is the safe direction. Task 7's ccloop accept check is by kind.
- **Timeouts are frozen as durable outcomes** for that commandId (see decision 1). Flagging this in case the controller
  prefers a transient class for `syncskill-timeout`.
- `replaceTaskInSnapshot` is unchanged. Its `structuredClone` plus schema parse keeps the `skills` key, and
  setTaskLoopConfirmed stayed green (Task 5 updates the entries).

## Fix round 1 (controller findings F1, F2 and review Minor 5), 2026-10-03, same session `08b1007d`, on top of `114b20d`

### Changes

- **F1:** the confirm-time `skills-unsupported-agent` check is removed. `selection.agent` is an installation id, not an
  agent kind. Where the check was, a one-line comment now names ccloop's acceptStart as the authority. Nothing else used
  the code, so it is also removed from `errors.ts` and `zh.ts`; `en.ts` never had it. Its test is deleted.
  `confirmedPair`'s task `a` (names) now runs on the fixture's default agent, codex. This shows confirm no longer
  refuses a codex task that has skills.
- **F2:** `lookupSkillProfiles` now records whether any task declares skills, names or a profile. If one does and
  `syncskill.bin === null`, it returns `failure: syncskill-unconfigured`. That failure is decided inside the transaction
  like the others. New test: a task that only names its skills, with bin null and with no syncskill deps, is refused
  `syncskill-unconfigured` and the group stays unconfirmed.
- **Minor 5:** the bare `toThrow()` is gone. "an entry for a task with no derived contract" now asserts
  `toThrow("skills-task-unknown")`. "an entry with no names" now asserts the issue paths equal exactly `["skills.0.names"]`.

### Verification

- Main tree: `tsc --noEmit` exit 0. confirmSkills, executionSnapshot and panel/refusalCoverage gave exit 0, 38 passed
  (`t4/f1-main.out`).
- Clone `t4/clone`, with the 5 changed files copied in: `tsc` exit 0 (`t4/f1-clone-tsc.out`). Script `t4/f1-run.sh`,
  with the file list in `t4/f1-files.txt`, ran confirm*, executionSnapshot*, setTaskLoop*, snapshot*, dispatch*,
  tests/skills and the 15 panel files that build a WebControlService. It gave exit 1: 1 failed | 202 passed | 1 skipped
  (`t4/f1-clone.out`, uptime load 6.00).
  - The one failure was `panel/controlShutdown`: "a real SIGTERM" saw exit code 143. The file was rerun alone 3 times:
    exit 0 each time, 6 passed (`t4/f1-shutdown.out`; loads 10.40, 10.40, 21.02). It also passed in the first round's
    rerun.

### Mutations

Run in `t4/mut`, which holds this round's candidate as a scratch commit; table in `t4/mutations-F2-M9-M10-M3-M13.tsv`.

| id | mutation | result |
|---|---|---|
| F2 | drop the "any declared skills need syncskill" check | exit 1, 1 failed (the new names-only test) |
| M3 | drop the lookup-failure refusal | exit 1, 4 failed |
| M9 | schema: drop taskId among derivedContracts | exit 1, 1 failed ("expected [Function] to throw") |
| M10 | schema: entry names may be empty | exit 1, 1 failed ("expected [] to deeply equal ['skills.0.names']") |
| M13 | failure decided before the existing checks | exit 1, 1 failed |

Restore: `git diff` 0 bytes, `git diff --cached` 0 bytes.

Round-1 mutation M4 ("drop skills-unsupported-agent") no longer applies, because the check itself is gone.
