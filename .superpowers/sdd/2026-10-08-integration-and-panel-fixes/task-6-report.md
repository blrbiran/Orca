# Task 6 report: integration conflicts and agent resolution (spec §7)

Implementer: a subagent of session eaee0f2c, 2026-10-08. Branch `feat/integration-schemes`, base `d87e906`.
Every git command used `git -C <abs path>`. The main checkout `/Users/biran/code/skills/loop/Orca` was not touched.
`progress.md` was not edited or staged.

Commits:
- `46e6a3e` feat(control): resolve an integration conflict with an agent once an owner approves
- `f2cf667` test(control): pin every branch of the integration conflict resolution

## What was implemented

### `src/control/integrationResolve.ts` (new)

**`materialiseIntegrationConflict(deps {roots, repo}, g, base, tip, method, attempt, lastIntegrated)`**

1. The previous copy `<workspacesRoot>/integration-conflict-<g>-<attempt>` is removed with `removeOwnPath`.
2. `refs/orca/integration/<g>/work` is set to the tip in the target repository.
3. The target repository is cloned with `clone --local --no-checkout`.
4. The conflict is re-created in the copy:
   - `merge` uses `materialiseConflict(copy, base, workRef)`.
   - `squash` runs the same three-way merge §6.2 ran: `merge-tree --write-tree` with `--merge-base=lastIntegrated` (falling back to the fork point) and `merge.conflictStyle=merge`. Its tree, markers included, is committed with `commit-tree -p base -p tip`.
5. `pinConflictCommit(copy, key, commit, ref)` pins it under `refs/orca/integration-conflict/<g>/<attempt>`. That ref is fetched back into the target repository, so it outlives the copy.

Any failure to reproduce returns `null`, and the copy is removed. That covers a clean merge, a merge-tree exit other than 1, and the other `materialiseConflict` throws.

**`integrationContractOf` / `synthesizeIntegrationContract`**

- `objective.taskId` is the key `integrate-<g>-<n>`. That is the fake codex's script key.
- The goal carries the spec §7 wording.
- `targetPaths` are the conflicted paths.
- The checks are the union of the group's confirmed task contracts' `requiredChecks`, with blank checks dropped.
- The budget is the landing's rule: the largest of the contracts' `tokenBudget`, `perAttemptTimeoutMs` and `totalRuntimeBudgetMs`, with `maxAttempts` 1.
- The verifier is `command`.
- The contract is written to `<workspacesRoot>/reconcile-integrate-<g>-<n>/contract-<key>.json`.

**`prepareResolution` / `approveResolution`**

- `prepareResolution` runs before the transaction. It reads the waiting attempt's copy and checks that it exists, and reads the pinned commit with git. It returns null otherwise.
- `approveResolution` runs inside the transaction. It refuses in this order:
  - `integration-not-blocked`, unless the state is `conflict` and the prepared attempt equals the record's attempt;
  - `integration-no-checks`;
  - `reconcile-budget` (`reconcileAffordable`).
- Otherwise it sets state `resolving` and writes a `ReconcileRecord`-shaped `resolution`:
  - `spawning: true`, `spawnSeq: 0`;
  - `old` = base;
  - `otherTaskId`/`otherTaskIds` = the group's task ids.

**`recordIntegrationUsage(deps, g, key, tokens)`**

- One write, idempotent by outbox `integration-usage:<key>` (kind `integration-usage`, delivered 1).
- It adds to `group.used` and calls `bookReconcileUsage` with `runId: null`, which books no row for 0 tokens. Then it runs `syncWebBudget(store, group, null)` and bumps `budgetVersion`.
- It never reads a run.

**`advanceIntegrationResolution(deps, g)`** applies `reconcileNextAction` and `readLoopState`/`processAlive` (now exported from `driverLanding.ts`), keyed by the key:
- `wait`: does nothing.
- `collect`:
  1. Books the spend: budget minus `tokenBudgetRemaining`, or the whole budget when that is absent.
  2. A status other than `succeeded`, or no attempt sha, ends as `integration-resolution-terminal:<status>`.
  3. Fetches the attempt into `refs/orca/integration/<g>/resolved`.
  4. `markersRemaining` ends as `integration-markers-remaining:<paths>`.
  5. Otherwise it calls `finishResolvedIntegration` with the attempt's tree.
- `spawn`/`orphan`:
  1. Checks `reconcileAffordable` again (`reconcile-budget`).
  2. Reads `readConfirmedReconcileSlot`; a failure ends as `reconcile-agent-unfrozen`.
  3. Writes the contract.
  4. Records `spawning`/`spawnSeq+1`.
  5. Calls `runTask` exactly as `stepR` does: the copy is the target, the start commit is the pinned commit, `detachedLogDir`, and `onSpawn` records the pid.
  6. Tracks the run in the driver's `context.reconciling` map. A rejection ends as `integration-resolution-spawn:<message>`.

**`failResolution`**

- State goes back to `conflict` with the named reason and `resolution: null`.
- The next attempt's conflict (attempt+1, a new copy and ref) is materialised, so another approval can start it.
- If that cannot be done, the record still counts attempt+1 without a copy, so approval is refused and a person must Retry.

### `src/control/integrationPass.ts`

- `IntegrationDeps.resolution?` holds `{ccloopBin, agentsTablePath, reconciling, runTask}`. `integrationDepsOf` in `executionDriver.ts` fills it from the driver.
- The pass first advances every group whose integration state is `resolving` (spec §5). Errors are logged and retried next round; `Crashed` is rethrown.
- On a `local`/`push-target` conflict, `materialiseIntegrationConflict(attempt = prev+1)` runs. Settle names the reason `integration-conflict`, or `integration-conflict-unreproducible` when the result is null.
- Refactor: a `Delivery` ({`readBase`, `publish`}) for `local` and `push-target`, plus `writeAheadAndPublish` (§6.1 steps 3-4). Both `computeAndPublish` and the new exported `finishResolvedIntegration` use them. Behaviour is unchanged for existing paths; the existing integration suites are green.
- `finishResolvedIntegration`:
  1. Reads the base again. If it differs from the conflict's base, the outcome `discarded` sets state `idle` and clears `resolution`. A write-ahead record is kept.
  2. Otherwise `merge` makes `commit-tree <tree> -p base -p tip`, and `squash` makes `commit-tree <tree> -p base` with the usual "(n landings)" message.
  3. Then write-ahead and publish. A publish answered `moved` is discarded.
  4. Failures go through the same `failureOutcome` naming.
- A `done` outcome now also clears `conflict` and `resolution`.
- Copy cleanup: each pass reads the workspaces root once. For a group with no conflict on record (succeeded, a changed scheme, or `keep`), it removes that group's `integration-conflict-<g>-<n>` copies with `removeOwnPath`. Names are parsed as `^integration-conflict-(.+)-(\d+)$`, so group `g-x`'s copies are never group `g`'s.
- `conflictedNames` moved to `integrationGit.ts`, where it is shared.

### Other files

- `reconcile.ts`: `pinConflictCommit(copy, runId, commit, ref = conflictRefOf(runId))`. Existing callers are unchanged.
- `usageLedger.ts`: the row and `bookReconcileUsage` take `runId: string | null`.
- `budget.ts`: `syncWebBudget` and `groupUsageUnknown` accept `currentRun: null`.
- Verb `resolve-integration-conflict`:
  - `webProtocol.ts`: the verb, the raw and effective union entries (group target, empty payload), and the result `integration-resolution-started`.
  - `controlApi.ts`: the route `POST /api/control/groups/:groupId/integration/resolve`.
  - `humanOnly.ts`: `human-only`.
  - `integrationCommands.ts`: `applyResolveIntegrationConflict`.
  - `webService.ts`: `resolveIntegrationConflict`, whose git read runs before the gate.
  - Also: the SKILL.md row and owner-only line, and the web `controlTypes.ts`.
- New error code `reconcile-budget` (409, durable) plus its zh text.
- `tests/control/fixtures/web.ts`: an additive option `requiredChecks`.

## TDD evidence (redirected files under `$S`)

- RED: `$S/t6-red1.txt`, rc=1. Tests written first; the suite fails with `Cannot find module '../../src/control/integrationResolve.js'`.
- `$S/t6-g1.txt`: rc=1, 4 failed. Three failures were test expectations (the confirmed contract's budget is the derived 3 000 000, not the hand-written 99 000). The fourth was a test design error: a merge→squash change recomputed and re-created the copy; the test now switches to `keep`.
- `$S/t6-g2.txt`: rc=0. `$S/t6-e1.txt`, real ccloop scenarios: rc=0, 2 passed.
- `$S/t6-g3.txt`, with ORCA_CCLOOP_BIN: integration* + integrationApi + skill + `driverReconcile` + `executionDriverE2E`: rc=0, 10 files, 191 tests. The landing reconciliation is unchanged.
- At `f2cf667`:
  - `$S/t6-g4.txt`: resolve file rc=0, 18 passed and 2 skipped (no ccloop).
  - `$S/t6-g5.txt`: integration* + integrationApi with ccloop, rc=0, 7 files, 150 tests.
- Typecheck rc=0: `$S/t6-tc3.txt` at `46e6a3e`, `$S/t6-tc4.txt` before `f2cf667`. `npm run --ws check` rc=0 (`$S/t6-web.txt`).
- Broad `tests/control tests/panel tests/entry` rc=0 both times (the skips are the real-ccloop criteria):
  - at `46e6a3e`: `$S/t6-broad.txt`, 205 files passed / 8 skipped, 1967 tests passed / 54 skipped, load 7.81;
  - at `f2cf667`: `$S/t6-broad2.txt`, 1973 tests passed / 54 skipped, load 3.43.

## Criteria (`tests/control/integrationResolve.test.ts`, 20 tests)

**Real git with a stand-in `runTask` (18 tests):**
- merge and squash materialisation: the copy exists, the pinned ref in the target holds markers, its parents are (main, tip), and nothing is dispatched;
- squash uses `lastIntegrated` as merge base: a person's revert of integrated work survives in the conflict;
- unreproducible, triggered by a merge driver set only in the target's config and info/attributes: the reason is named, there is no copy, approval is refused, and Retry gives attempt 2;
- approval refusals:
  - not-blocked when idle;
  - not-blocked when the copy was removed;
  - reconcile-budget with the default reserve;
  - then `resolving` with the full record;
  - `integration-busy` and retry/resolve refused while resolving;
- a stale prepared read is re-judged in the transaction;
- no-checks (blank checks);
- the spawn:
  - one call, with the plan, base and contract asserted;
  - a stopped driver spawns nothing;
  - the pid is recorded, and the run is waited on;
- unaffordable at spawn; agent unfrozen; spawn rejected; terminal `failed` books the spend;
- terminal with no budget snapshot books the whole budget;
- a failed collection is retried, and its spend is booked once;
- a crash after the resolved integration's write-ahead record (parents main, tip);
- the target branch gone ⇒ `integration-target-missing`;
- `recordIntegrationUsage` is idempotent, has no run id, and books no row for 0;
- a scheme change removes the group's own copies only.

**Real ccloop (2 tests):**
- merge:
  - nothing runs before approval;
  - script `integrate-g-1` leaves markers ⇒ `integration-markers-remaining:shared.txt`, attempt 2, and ref `g/2` holds markers;
  - script `integrate-g-2` resolves ⇒ `main` is a new commit with parents (old main, tip) and content `M\nA`;
  - two `run_id NULL` unattributed rows, both outboxes delivered, ledger sum = `used.tokens`, copies removed.
- squash: `main` is moved right after approval ⇒ the resolution is discarded and the next round conflicts against the moved main (attempt 2); a second approval gives one commit whose only parent is the moved main.

The member and agent refusal of the route is in `tests/panel/integrationApi.test.ts`.

## Mutation table

Mutations ran in a clone at `f2cf667` (`$S/mut-t6`, node_modules symlinked). The baseline `$S/mut-t6-baseline.txt` is rc=0 with 20 passed. The runner is `$S/mut-t6-run.py`. Results are in `$S/mut-t6-summary.txt` and `$S/mut-t6-progress2.txt`; each mutation's output is in `$S/mut-t6-<id>.txt`. Every restore measured 0/0 bytes (`git diff` / `git diff --cached`). All 39 mutations went red. "cc" marks a real-ccloop test.

| id | mutation | test | seen red |
|---|---|---|---|
| M6-1 | (brief) auto-approve, and so dispatch, on conflict | cc merge | `expected {…} to match object { Object (reason, conflict) }`: the state was already resolving at the conflict check, before the "no ccloop call" line |
| M6-2 | (brief) squash rebuilt with two parents | cc squash | `expected [ …(2) ] to deeply equal [ Array(1) ]` |
| M6-3 | (brief) usage booked with a run id | once per key | `[{applied_at:5…}] to deeply equal [{applied_at:5…}]` (run_id) |
| M6-4 | (brief) markersRemaining skipped | cc merge | `timed out waiting for the first resolution to be refused` |
| M6-5 | squash materialised as a plain merge | lastIntegrated merge base | `'<<<<<<< HEAD\nPERSON…' to match …` |
| M6-6 | unreproducible named integration-conflict | does not reproduce | `to match object { state: 'conflict', …(2) }` |
| M6-7 | unreproducible copy kept | does not reproduce | `expected true to be false` |
| M6-8 | pinned ref not fetched into target | merge materialised | `Command failed: git … rev-parse refs/orca/integration-conflict/g/1` |
| M6-9 | work ref not set before clone | merge materialised | `to match object { state: 'conflict', …(3) }` |
| M6-10 | conflict not materialised by the pass | merge materialised | `expected false to be true` |
| M6-11 | copy-exists check removed | approval refusals | `'reconcile-budget' to be 'integration-not-blocked'` |
| M6-12 | attempt check removed | re-judged in transaction | `'applied' to be 'integration-not-blocked'` |
| M6-13 | state check removed | re-judged in transaction | `'applied' to be 'integration-not-blocked'` |
| M6-14 | blank checks counted | no-checks | `'applied' to be 'integration-no-checks'` |
| M6-15 | approval budget check removed | approval refusals | `'applied' to be 'reconcile-budget'` |
| M6-16 | `wait` removed | spawns once | `expected true to be false` |
| M6-17 | spawn-time affordability removed | unaffordable at spawn | `expected [ { plan… } ] to deeply equal []` |
| M6-18 | slot refusal rethrown | agent unfrozen | `expected false to be true` |
| M6-19 | spawn rejection ignored | cannot be spawned | `to match object { state: 'conflict', …(3) }` |
| M6-20 | status check removed | ended other than succeeded | `expected false to be true` |
| M6-21 | base-moved discard removed | cc squash | `timed out waiting for the discarded resolution to conflict again` |
| M6-22 | merge without tip parent | crash after write-ahead | `expected [ Array(1) ] to deeply equal [ …(2) ]` |
| M6-23 | done keeps conflict/resolution | cc merge | `to match object { state: 'idle', reason: null, …(4) }` |
| M6-24 | copy cleanup skipped | scheme change | `expected true to be false` |
| M6-25 | copy owner parsed lazily | scheme change | `expected false to be true` (the stranger's copy removed) |
| M6-26 | resolving loop not advanced | spawns once | `expected false to be true` |
| M6-27 | resolving loop ignores stop | spawns once | `expected true to be false` |
| M6-28 | resolving loop errors rethrown | collection fails | `Error: spawn git ENOENT` (escapes the pass) |
| M6-29 | Crashed swallowed in resolving loop | crash after write-ahead | `promise resolved "false" instead of rejecting` |
| M6-30 | usage idempotency removed | once per key | `UNIQUE constraint failed: outbox.id` |
| M6-31 | unknown spend booked as 0 | no budget snapshot | `expected [] to deeply equal [ { tokens: 3000000 } ]` |
| M6-32 | next attempt not materialised on failure | unaffordable at spawn | `expected false to be true` |
| M6-33 | pid not recorded | spawns once | `to match object { state: 'resolving', …(1) }` |
| M6-34 | spawning/spawnSeq not recorded | spawns once | `to match object { state: 'resolving', …(1) }` |
| M6-35 | finish failures not named | target gone | `expected false to be true` |
| M6-36 | goal wording changed | spawns once | `… to contain 'resolve the conflict between the targ…'` |
| M6-37 | attempt always 1 | approval refusals | `to match object { attempt: 2, key: 'integrate-g-2' }` |
| M6-38 | `syncWebBudget` null guard removed | cc merge (first run against "once per key" survived: that world has no runs) | `timed out waiting for the first resolution to be refused` |
| M6-39 | discard does not return to idle | cc squash | `timed out waiting for the discarded resolution to conflict again` |

## Rewrite inventory

- `tests/entry/skill.test.ts`: route, verb and row counts go 28→29. `schemaByVerb` gains `resolve-integration-conflict` with `emptyPayloadSchema` (spec §3.4/§7). The counts are still exact.
- `tests/control/fixtures/web.ts`: an additive option only; the default is unchanged.

## Deviations and decisions (for the ledger)

1. **Integration-no-checks is reachable only through blank checks.** Confirmed contracts pass `taskContractSchema`, where `requiredChecks` has at least 1 entry, so the union over confirmed contracts is never empty. The union therefore drops blank strings ("a blank check is no check"). The criterion uses `requiredChecks: ["  "]`. Cost if wrong: an approval that would have run `" "` as its only check is refused.
2. **Interface differences from the brief.**
   - `materialiseIntegrationConflict` also takes `lastIntegrated`, for the squash merge base.
   - `synthesizeIntegrationContract` takes `runsDir`, `conflictCommit` and `copy`, and computes the budget itself; there is no `budget` input. The approval and the pass share that computation through `integrationContractOf`.
   - The approval is split into `prepareResolution` (git, before the gate) and `approveResolution` (in the transaction), as the setters do. The record needs the pinned commit's sha, and reading it needs git.
3. **A failed resolution materialises the next attempt (new copy and ref) when it fails.** That way "another approval starts attempt + 1" works without a Retry. Copies of earlier attempts stay until success or a scheme change.
4. **A success (`done`) clears `conflict`.** The copies are then removed, and later conflicts start at attempt 1 again. The target-repository refs `refs/orca/integration-conflict/<g>/<n>` are overwritten in place.
5. **A `discarded` resolution keeps any write-ahead `pending`.** A crash after publish is then finished by the next round's re-entry. This crash-then-discard path is not criterion-tested; only the after-pending crash is.
6. **The `orphan` action re-spawns after an affordability check, as spec §7 says; the landing blocks instead.** A ccloop that keeps dying without a loop state would be re-spawned every round.
7. **A collection error (git, a missing clone) leaves the group `resolving` and is retried next round.** Nothing records it. The spec's "error ⇒ conflict" is applied to the run's own failures: a spawn rejection, a terminal non-success, or markers.
8. **The resolving advance honours neither `retryAfter` nor a person's stop or pause of the group.** Like `stepR`, it collects regardless. A transient failure while publishing a resolved integration is retried every round, and a resolution finishing on a paused group publishes. (The driver's own stop is honoured.)
9. **Reason codes.** `integration-conflict-unreproducible`, `integration-markers-remaining:<paths>`, `integration-resolution-terminal:<status>` and `integration-resolution-spawn:<message>` are new. `reconcile-budget` and `reconcile-agent-unfrozen` reuse the landing's codes. The `AgentsRunRefused` code is carried inside the spawn message (no separate branch). No web locale strings were added for record reasons; that is Task 7's UI.
10. **Untested equivalent guard.** `prepareResolution`'s `conflict === null` check: without it, the destructuring throws inside its own catch and returns the same null. `prepareResolution`'s catch-all also maps git failures to null, so the command refuses `integration-not-blocked`.
11. **Leftover runs directories.** The resolution runs directories `reconcile-integrate-<g>-<n>` (contract and ccloop loop state) are kept as the scene, as the landing's are. Only the copies are removed, which is all spec §7 names. They accumulate per attempt.
12. **The usage outbox is one entry per key, as directed.** A re-spawn under the same key (an orphan) is therefore not booked a second time.

## Concerns

- Rule 6: the harness's StrategicCompact hook reported about 436k tokens of context (44% of 1M) when the test file was written. That is over the 330k per-task figure. This is the tool-reported number; I have no other measure.
- M6-1 (dispatch without approval) went red at the conflict-record assertion. That assertion comes before the "no `integrate-*` script key" line, so the latter was not itself seen red under this mutation (Rule 9's short-circuit caveat).
- Two ccloop mutations (M6-4, M6-38) went red only through the test's 300 s `until` timeout. A wrong resolution shows up as never reaching the awaited state.

## Files

New: `src/control/integrationResolve.ts`, `tests/control/integrationResolve.test.ts`.
Modified:
- `src/control/integrationPass.ts`, `integrationGit.ts`, `integrationCommands.ts`, `webService.ts`, `webProtocol.ts`, `executionDriver.ts`, `driverLanding.ts` (exports only), `usageLedger.ts`, `budget.ts`, `errors.ts`;
- `src/scheduler/reconcile.ts`, `src/panel/controlApi.ts`, `src/panel/humanOnly.ts`;
- `web/src/controlTypes.ts`, `web/src/locales/zh.ts`, `skills/orca-control/SKILL.md`;
- `tests/control/fixtures/web.ts`, `tests/entry/skill.test.ts`, `tests/panel/integrationApi.test.ts`.

---

# Fix round 1 (review F1, F2, F3)

Implementer: same subagent, 2026-10-08. Commit `fab1764` fix(control): drop a blocked resolution's record and leave a
stopping driver's run resolving.

## Changes

- **F1:** in `integrationPass.ts`, the `blocked` settle clears `resolution` again.
  - `discarded` already cleared it, and `done` clears it.
  - I did not add a clear to the `conflict` settle. A `conflict` settle never sees a non-null `resolution`: a resolution leaves `resolving` only through `done`, `blocked` or `discarded` (each now clears it) or through `failResolution`, which writes `resolution: null` itself. A clear there would be a branch no criterion can see. I added it, then dropped it before the commit.
- **F2:** in `integrationResolve.ts`, the `runTask` rejection handler again has the `!deps.stopped()` guard that `stepR` keeps (driverLanding.ts:319). A run that ends while the driver stops is left `resolving`, to be collected or re-spawned after restart.
- **F3:** the real-ccloop "nothing runs before approval" check now also asserts `state: "conflict"` and `resolution: null` after the 1 s wait.

## Covering tests (`tests/control/integrationResolve.test.ts`)

- "a resolved integration whose target branch is gone blocks by name" now asserts `resolution: null` (F1).
- New: "a resolution run that ends while the driver stops is left resolving, for after the restart" (F2). The stand-in `runTask` flips `stopped()` to true and rejects. Afterwards the state is still `resolving`, the conflict is still attempt 1 with its resolution record, and no `integration-conflict-g-2` copy exists.

## Commands and output (redirected under `$S`)

- `npm run typecheck`: rc=0 (`$S/t6f-tc.txt`; `$S/t6f-tc2.txt` after the conflict-settle clear was dropped).
- With `ORCA_CCLOOP_BIN=$S/ccloop-new/dist/cli.js`, `vitest run tests/control/integration*.test.ts tests/control/driverReconcile.test.ts tests/control/executionDriverE2E.test.ts` (this includes `integrationResolve` and its real-ccloop tests): rc=0, 8 files, 183 tests (`$S/t6f-g1.txt`).
- After dropping the conflict-settle clear, `vitest run tests/control/integration*.test.ts` (no ccloop): rc=0, 139 passed, 2 skipped (`$S/t6f-g2.txt`).

## Mutation rows

- **Clone:** a fresh `git clone --local` at `fab1764` in `$S/mut-t6f`, node_modules symlinked.
- **Why a new clone:** the Tier 0 gate refused updating the old clone `$S/mut-t6` with a `pull` ("cannot resolve the directory of -C $M"). I did not retry or rephrase that command.
- **Files:** runner `$S/mut-t6-run.py`, now pointed at `mut-t6f`; output in `$S/mut-t6f-progress.txt` and `$S/mut-t6-<id>.txt`. Each restore measured 0/0 bytes.

| id | mutation | test | seen red |
|---|---|---|---|
| F1-1 | `blocked` settle keeps `resolution` | target branch is gone | `expected {…} to match object { state: 'blocked', …(2) }` (the resolution field) |
| F2-1 | `!deps.stopped()` guard removed | ends while the driver stops | `expected {…} to match object { state: 'resolving', …(3) }` |

F3 is an added assertion, not a new branch, so it has no mutation row.
