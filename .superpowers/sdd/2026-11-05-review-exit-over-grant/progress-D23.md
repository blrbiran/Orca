# D23 ledger -- D2 and D3 of spec 2026-11-05 (rev 2)

Who: implementer agent, batch D23, controller session 3cfc2e73. When: 2026-11-05/06.
Branch `feat/over-grant-no-auto-estimate` (worktree `$S/wtD23`), base `feat/review-exit-over-grant` @ 7266bd81.
Side branch `feat/no-auto-estimate-rule` = one commit (e316c179) on 35bd5e1a: the D3 import rule (not mergeable as is, below).
Human ruling quoted in every rewrite: 「这次批准改写所有必要的判据。」

## Commits (feat/over-grant-no-auto-estimate)
- 21449014 fix(control): an unlimited group's over-grant is recorded, not blocking; set-limit and retry lift a limited group's block (D2)
- 32e0ab90 fix(control): schema 21 -> 22 repairs an unlimited group left blocked by an over-grant (D2)
- 5d0758d2 feat(cli): confirm, group show and proposal show name a task's unestimated default tokens (D3)
- 35bd5e1a test(control): the future-schema refusals name version 23 (D2)
- e4d3b24d docs(spec): corrections for D2/D3 as built
- (this ledger)

## Criteria (spec §4) -> file / test name
| # | where | status |
|---|---|---|
| 10 | tests/control/overGrantExit.test.ts "an unlimited group's work-run breach leaves it dispatchable and shows overGrant"; "an activeMs breach in an unlimited group does not block"; "a limited group's work-run breach still blocks, and its summary carries no overGrant chip" (existing estimateBreachAdvisory C2 already pins the limited case and is kept unchanged: its fixture is limited) | built |
| 11 | overGrantExit "set-limit on an over-grant-blocked limited group lifts it by rule, and dispatch resumes after the retry"; "set-limit is refused when a block reason is not an over-grant"; "the retry of a fixed-grant task lifts its over-grant block by rule (#161)" | built; the `work`-grant retry is NOT built (decision 1) |
| 12 | overGrantExit "the migration repairs an unlimited over-grant-blocked group and leaves a limited one blocked"; "an unlimited blocked group with no over-grant run is left as it is" | built |
| 13 | overGrantExit "in an unlimited group the breached task's retry is refused authored-budget-exhausted and the group stays unblocked" (behaviour stated in decision 1) | built |
| 14 | tests/control/noAutoEstimate.test.ts "importing into an unlimited group queues no estimate and the result parses with estimateId null, estimateState none"; "a limited group still gets one" | side branch only |
| 15 | noAutoEstimate "a schedule-fired unlimited import queues none; a limited one does" (the fire's call: importControlPlanAsync with origin); "an unlimited requirement's accept queues none"; "a limited requirement's accept still queues one" | side branch only |
| 16 | tests/commands/unestimatedDefault.test.ts "confirm's and group show's human output name the unestimated default and the path"; "proposal show names it too"; "JSON output is unchanged, and a person's own unlimited tokens are not called a default" | built |
| UI | web/tests/overGrantUnblocked.test.tsx (status line; Board chip) | built |

## Criterion rewrites (file:line old -> new)
- tests/control/planImport.test.ts:129,141,160,180,234,587,610 `…estimateId` -> `…estimateId!` (type only: result schema now nullable).
- Schema pins `toBe("21")`/`{ value: "21" }` -> `"22"`: flowFeedbackMigration.test.ts:65,66,108,175; requirementRecords.test.ts:29;
  roundsRekeyMigration.test.ts:45,46; agentUpdates.test.ts:258; tokenPolicyMigration.test.ts:11,24; schema10.test.ts:13,14,29,42,59;
  schema8.test.ts:45,60,111; checkStateMigration.test.ts:49,50,64; shutdownHealing.test.ts:131; schema9.test.ts:34,35,62;
  socketUsageSettlement.test.ts:29,30; commandClient.test.ts:46,64; estimateBreachRepairMigration.test.ts:67,226. Red on M10.
- Future-version pins `'22'` -> `'23'`: schema9.test.ts:70,74; schema10.test.ts:64,68. Red on M19b (and seen red with '22' in the gate run).
- tests/control/fixtures/web.ts: `estimateId: imported.result.estimateId` -> `… as string` (type only). Side branch also: the
  historical finite path imports with `{ estimate: "preflight" }`.
Measured by: `git diff 7266bd81..e4d3b24d -- tests` at e4d3b24d.

## Mutations (clone `$S/mutD23`, each restored, `git diff` and `git diff --cached` 0 bytes after every one)
Runner `$S/d23-mutate.py`; outputs `$S/d23-mut-<name>.txt`. All RED on the named test's own assertion unless said:
M1 usage.ts restore block for unlimited -> C10 a/b and C13 red ('blocked' not to be 'blocked').
M2 exemption for all groups -> "limited … still blocks" red. M3 exempt only a token breach -> activeMs case red.
M4 drop summary overGrant -> C10a red. M5 set-limit keeps refusing blocked -> C11a red. M6 set-limit drops the reason check -> C11b red.
M7 retry does not lift -> C11c red. M8 migration drops the limit.tokens===null filter -> C12 red. M9 migration rule always review -> C12 red.
M10 schemaVersion stays "21" -> schema10 pins red. M11 retry drops the exhausted check -> C13 red. M12 CLI drops the line -> C16 a/b red.
M13 CLI calls a person's null tokens a default -> C16c red. M14 web drops the status line -> red. M15 web drops the chip -> red.
M16 import rule dropped -> C14a + schedule case red. M17 rule for every group -> C14b + schedule case red. M18 rule only in planImport -> requirement case red.
M19 store accepts '23' -> GREEN (migrateSchema refuses it a second time); replaced by M19b schemaVersion "23" -> both future-version tests red.

## Decisions (Rule 1 rung 2 unless "for the human"; also in the spec's §7)
1. **retry-task `work` grant not built -- for the human.** A started task's authored work grant is part of every earlier run's
   funded-allowance identity (fundedAllowance.ts readFundedAllowance: funded-authored-policy, funded-grant-authority) and the
   group view reads every run through it; seen: the view failed recovery-blocked:funded-grant-authority right after such a retry
   in a built criterion. Needs an identity change (record the ceiling a run was funded from). Consequence (criterion 13): in an
   unlimited group a non-token breach exhausts that dimension of the task's ceiling; its retry is refused authored-budget-exhausted
   and it has no exit until this is decided. Error catalog / CLI flags therefore unchanged.
2. Block reasons = a run with a breach that is not an estimate or a clarify/split call (overGrantBlock.ts); none -> set-limit refuses.
3. D1's done rule is passed into retryTask from webService (import-cycle note from the controller); overGrantBlock.ts is a leaf.
4. Migration rule: running / review (no ControlStore for prerequisiteDone); D1's done pass finishes it.
5. Summary `overGrant` optional, present only when true.
6. **D3 import rule on a side branch -- for the human.** planId imports are always unlimited (tokenLimit only with libraryEntry), so
   the rule turns red every criterion that imports by planId and then uses the import-time estimate. Gate on the rule commit alone
   (`node scripts/test-affected.mjs --base <main branch>` in the clone, at e316c179): 588 files, 44 failed / 160 tests; minus base
   reds (multiDir* x9 fixed in d69ec6c5, taskResultPaired env-red, startForm red on base too) the D3 reds are:
   commands/agentWalk; control/{agentPlanImport, agentSelectionE2E, agentUpgradeE2E, autoConfirmUnlimited, decisionsContract,
   dirRequirementE2E, dirRequirementOutOfRepo, dispatchedRunMarkerE2E, estimateBreachAdvisory, estimateBreachRepairMigration,
   estimateE2E, executionDriverE2E, handoffE2E, integrationResolve, loopPlanE2E, ompSkillsE2E, planImport, progressE2E,
   requirementE2E, scheduledGroupFire, scheduleWithAutoConfirm, skillsE2E, tokenPolicy, tokenPolicyRuntime, usageByModelE2E,
   webFaults}; flow/vaultDriverProbe; panel/{agentCeiling, controlApi, controlOverview, controlOverviewApi, controlReadApi,
   controlRecoveryApi}. Each needs either an explicit `group estimate` after the import (the new human flow) or a limited
   import; a dedicated rewrite batch. Some may be load-shaped (not individually rerun).
7. CLI line keys on tokens null + provenance complex-1m-default; reopen step named as a proposal edit.

## Gate (main branch content)
`node scripts/test-affected.mjs --base feat/review-exit-over-grant` at the D2+CLI state (rule disabled; = 5d0758d2 + schema pin
fix pending): root 632 files, 18 failed / 45 tests; web 176/176 green. Reds: noAutoEstimate x3 (rule absent, expected), schema9/10
future pins (fixed in 35bd5e1a), multiDir* (known base regression, d69ec6c5), and load-shaped files rerun singly at load ~28:
ccloopProtocol.integration, driftLock, driverReconcileDecisions, driverReconcileN, handoffE2E, schedulerBridge, chainsApi,
controlReadApi, schema9, schema10 -> 10/11 files green; startForm red alone and red on base 7266bd81 too (ECONNRESET).
taskResultPaired: env-red per docs/handoff/known-load-flakes.md. tsc root + web: 0 at e4d3b24d. The affected base in the run listed
69 paths because feat/review-exit-over-grant was rebased after this branch was cut.
