# R3 ledger -- criteria rewritten under the D3 no-automatic-estimate rule

Who: implementer agent, batch R3, controller session 3cfc2e73. When: 2026-11-06.
Branch `feat/no-auto-estimate` (worktree `$S/wtRule`), base `feat/over-grant-no-auto-estimate`; the rule itself is the
cherry-picked commit c7229adf (spec 2026-11-05 §3.3; D23 ledger decision 6). No product code changed in R3.
Human ruling quoted in every rewrite: 「这次批准改写所有必要的判据。」

## Why the criteria were red
A planId import has no token limit (tokenLimit is accepted only with libraryEntry), so under the rule it queues no
estimate: the result says `estimateId: null, estimateState: "none"`; no estimate row, no wake, no ESTIMATE_GRANT reserve.
The same holds for the accept of a requirement with no token limit. Every criterion below imported by planId (or
accepted an unlimited requirement) and then read, claimed, waited for or reserved the import-time estimate.

## Three kinds of rewrite
- **(a) explicit estimate** -- the criterion is about an estimate: after the import it asks for one the way a person
  does, `orca group estimate` (service `createEstimate`, the panel route `POST /api/control/groups/:id/estimates`, or
  the CLI). New helpers: `tests/control/fixtures/web.ts` `requestEstimate(service, groupId = "g")` and
  `tests/panel/fixtures/controlPanel.ts` `requestEstimate(panel, commandId, groupId)`.
- **(b) the new truth** -- the criterion only incidentally saw the import-time estimate: its assertion now states what
  the import gives (`estimateId: null, estimateState: "none"`, no estimate rows, no estimate reserve).
- **(c) in-process preflight** -- the criterion pins the import-time estimate a *limited* group still gets (preflight,
  estimator slot, probe conflicts, atomicity, golden bytes). planId imports cannot be limited, so these pass the existing
  in-process option `importControlPlan(…, { estimate: "preflight" })` (planImport.ts, added by c7229adf for the
  historical fixture). `importControlPlanAsync` forwards its opts unchanged at runtime but types them as `{ origin? }`,
  so the async calls in planImport.test.ts pass it `as never` (see "for the human").

## Rewrites (file:line old -> new, at the parent of the R3 commits; line numbers from `git diff -U0`)
| file:line | kind | old -> new | why |
|---|---|---|---|
| tests/control/fixtures/ccloopWorld.ts:307,310 (startGroup) | b | `estimateState: "blocked-capability"` -> `estimateId: null, estimateState: "none"`; comment | every real-ccloop world (agentUpgradeE2E, decisionsContract, dispatchedRunMarkerE2E, executionDriverE2E, handoffE2E, integrationResolve, loopPlanE2E, ompSkillsE2E, progressE2E, skillsE2E, tokenPolicyRuntime, usageByModelE2E, flow/vaultDriverProbe) asserted the import's blocked estimate and never used it |
| tests/control/agentSelectionE2E.test.ts:66,72 | b | same as above in confirmAgentGroup; doc comment | same |
| tests/control/agentPlanImport.test.ts:99-100 | b | `estimateState: "blocked-capability"`, `estimates[0]` profile null -> `estimateId: null, estimateState: "none"`, `estimates` `[]` | the test is "confirms and starts a draft imported without an estimator profile"; through service.importPlan (planId) there is now no estimate at all, and the confirm/start it pins still pass |
| tests/control/agentPlanImport.test.ts:153 ("degrades the estimate with ccloop's own refusal code"), :174 ("refuses an import whose operator layers changed…") | c | `importControlPlan(deps, importG2(h))` -> `…, { estimate: "preflight" })` | both pin the import-time estimator slot; an unlimited import has none to degrade or to check |
| tests/control/tokenPolicy.test.ts:41-44 | b | `reserved.tokens` `ESTIMATE_GRANT.tokens+GOAL_REVIEW.tokens` -> `GOAL_REVIEW.tokens`; `reserved.activeMs` `21_600_000` -> `21_600_000-ESTIMATE_GRANT.activeMs` | the unlimited import reserves nothing for an estimate it does not queue |
| tests/control/tokenPolicy.test.ts:107 (optional-v1 task ceiling edit) | b | `reserved.tokens` `2_000_000` -> `1_000_000` | same; line 161 (finite fixture) unchanged |
| tests/control/scheduleWithAutoConfirm.test.ts:293 | b | estimates of the fired group `[{ state: "blocked-capability" }]` -> `[]` | the fire's import queues none. **Premise lost, for the human**: "a failed estimate R2 has not tried yet" can no longer arise between a fire and R2 in one pump; what stays pinned is step 9 recording nothing and the fire copying R2's booked attempt |
| tests/control/autoConfirmUnlimited.test.ts:192-208 (C23) | a | `running.estimateId` / `queued.estimateId` (null now) -> `await x.requestEstimate(service)` | C23 is about a running / queued estimate in an unlimited group: now the one a person asks for |
| tests/control/estimateBreachAdvisory.test.ts:24-38,108,125 | a | `claimed()` claims `h.estimateId` -> claims `h.requestEstimate(service)` for optional-v1; `settle()` takes the estimateId | C1b/C1c are about an unlimited group's estimate run |
| tests/control/estimateBreachRepairMigration.test.ts:33 | a | `claimEstimate("g", h.estimateId)` -> explicit estimate when `finite === false` | review I2 builds an unlimited group whose estimate run breached |
| tests/panel/agentCeiling.test.ts:37-38,49 | a | claims the import result's estimateId -> asserts it is null, then claims an explicit `requestEstimate(service, "g2")` | "its finite estimate claim remains capped": the claim is now of the explicit estimate |
| tests/control/estimateE2E.test.ts:30,36-37 (importWithClaudeEstimator) | a | import `estimateState: "queued"`, returns its id -> import `estimateId: null, estimateState: "none"`, then `service.createEstimate` (queued), returns that id | E1-E3 run an estimate end to end against real ccloop |
| tests/control/dirRequirementE2E.test.ts:180,184; dirRequirementOutOfRepo.test.ts:25,117,119; requirementE2E.test.ts:85,89 | a | accept `estimateState: "queued"` and its estimateId -> accept `estimateId: null, estimateState: "none"`, then `service.createEstimate` (queued) and its id | the flows wait for the estimate to be ready (and its spend booked) before confirm; the scripted estimate answer is kept |
| tests/commands/agentWalk.test.ts:124 | a | `requirement accept` queued -> `none`, then `orca group estimate g` (queued) | the CLI walk: the new human step is a CLI step |
| tests/control/scheduledGroupFire.test.ts:10,184 (M-C7g) | a | the fire's own blocked-capability estimate -> asserts the fire queued none, then ana (no agent preference; plan names none) runs `group estimate`, which ends blocked-capability `agent-selection-rejected:estimator:agent-unselected` | keeps the premise "an estimate that ended in failure while R2 cannot try"; the recorded reason string is unchanged |
| tests/panel/controlOverviewFixtures.ts:5,26 (panelFixture) | a | + `await requestEstimate(panel)` after the import | every panelFixture criterion (controlOverview, controlOverviewApi) read the queued estimate |
| tests/panel/controlRecoveryApi.test.ts:20,44 (confirmSoft) | a | + `requestEstimate` before reading the draft | it answers that estimate before the confirm |
| tests/panel/controlApi.test.ts:30,64 | a | after import: + result `estimateId: null, estimateState: "none"`, `estimates` count 0, then `requestEstimate`, then the old "queued" and wake assertions | the walk from import to a continued task |
| tests/panel/controlReadApi.test.ts:141 | c | `importControlPlan(deps, command(…))` -> `…, { estimate: "preflight" })` | confirmGroup readies the import-time estimate by hand |
| tests/control/webFaults.test.ts:84-95 | c | both imports -> `{ estimate: "preflight" }` | pins that estimate + wake commit with the group or not at all |
| tests/control/planImport.test.ts:7,22-30,538 | c | `importControlPlan` / `importControlPlanAsync` imported as `importAnyPlan` / `importAnyPlanAsync`; the file's `importControlPlan` / `importControlPlanAsync` pass `{ estimate: "preflight" }`; the SIGKILL child imports with it too | the whole file pins the import-time estimate (preflight, slot, probe races, replay, golden bytes); the unlimited path is pinned in noAutoEstimate.test.ts |
| tests/control/fixtures/web.ts:156 | helper | + `requestEstimate` | (a) |
| tests/panel/fixtures/controlPanel.ts:251 | helper | + `requestEstimate` | (a) |

## Commits
- 63eca7e5 test(control): criteria about an unlimited group's estimate ask for it with group estimate (D3, R3) -- kind a
- 7fb73d6c test(control): criteria that only saw the import-time estimate state that an unlimited import queues none (D3, R3) -- kind b
- bf8764b7 test(control): criteria of a limited group's import-time estimate ask for it in-process (D3, R3) -- kind c (+ agentPlanImport's one kind-b line)
- (this ledger)

## Runs (vitest `--reporter=json` to a file, read back whole; env as in the brief, CCLOOP_CACHE_DIR=$S/env/ccloop-cache-R3; load 36-77 throughout, a gate of another agent running in parallel)
- Before (rule c7229adf, no rewrites), the 35 listed files: 35 files, 308 tests, 122 failed (34 files red; noAutoEstimate green). `$S/r3/initial.json`.
- After, at bf8764b7 content: batch 1 (agentCeiling, estimateBreachRepairMigration, estimateBreachAdvisory, autoConfirmUnlimited,
  executionDriverE2E, progressE2E) 6 files / 61 tests / 0 failed; batch 2 (planImport, agentPlanImport, tokenPolicy, webFaults,
  scheduledGroupFire, scheduleWithAutoConfirm, controlReadApi, controlApi, controlOverview, controlOverviewApi, controlRecoveryApi)
  11 / 165 / 0; batch 3 (agentWalk, agentSelectionE2E, agentUpgradeE2E, decisionsContract, dirRequirementE2E, dirRequirementOutOfRepo,
  dispatchedRunMarkerE2E, estimateE2E, handoffE2E, integrationResolve, loopPlanE2E, ompSkillsE2E, requirementE2E, skillsE2E,
  tokenPolicyRuntime, usageByModelE2E, flow/vaultDriverProbe) 17 / 77 / 0, 0 skipped. `$S/r3/b{1,2,3}.json`.
- tsc --noEmit -p tsconfig.json: RC 0 (`$S/r3/tsc1.log`).

## Mutations (clone `$S/mutR3` of bf8764b7, `git clone --local`; runner `$S/r3/mutate.sh`, batch `$S/r3/muts.sh`; after each, restored: `git diff` 0 bytes, `git diff --cached` 0 bytes)
| name | mutation | result |
|---|---|---|
| M1-rule-off | planImport.ts `const unlimited = … && opts.estimate !== "preflight"` -> `const unlimited = false` | kind b RED on their own rewritten assertions: tokenPolicy x2 (`expected 2000000 to be 1000000`), agentPlanImport "confirms and starts … without an estimator profile", scheduleWithAutoConfirm (`[blocked-capability]` vs `[]`), controlApi (`estimateId: null`), progressE2E (ccloopWorld startGroup `estimateState: "none"`). Kind c planImport 41/41 GREEN and kind a autoConfirmUnlimited C23 GREEN (a limited/preflight import still estimates; an explicit estimate still works). `$S/r3/mut-M1-rule-off.json` |
| M2-preflight-ignored | same line -> drop `&& opts.estimate !== "preflight"` | kind c RED: planImport 19/41, webFaults 3/10, controlReadApi 16/21, agentPlanImport 10/18. `$S/r3/mut-M2-preflight-ignored.json` |
| M3-no-explicit-estimate | webService.ts createEstimate's apply throws `no-op-command` after prestart | kind a RED: autoConfirmUnlimited C23, estimateBreachAdvisory C1b x2 + C1c, estimateBreachRepairMigration I2, scheduledGroupFire M-C7g, agentCeiling x2, controlOverview 10/11, controlRecoveryApi 4/4. `$S/r3/mut-M3-no-explicit-estimate.json` |

## For the human
1. **Lost premise (kind b):** scheduleWithAutoConfirm "a failed estimate R2 has not tried yet records nothing…" -- a fire's
   import queues no estimate, and nothing can fail between the fire and R2 in one pump, so the premise in its name no longer
   arises; the criterion now pins only step 9 recording nothing and the fire copying R2's attempt. Keep, rename or retire it?
2. **Type of importControlPlanAsync's opts** names only `origin`; it forwards `estimate` at runtime (planImport.ts, last line of
   importControlPlanAsync). planImport.test.ts casts `as never` at that one call site. Widening the type is product code (not done).
3. **Wasted probe (not a rule defect, observation):** an unlimited import via importControlPlanAsync still resolves and probes the
   estimator slot before the import, then defers -- one capability probe per unlimited import that nothing uses; and a plan
   change during that probe is no longer refused (no slot is stored, so nothing is inconsistent). Seen through planImport's
   "refuses an import when the plan primary changes while its estimator probe is in flight", red under the rule before R3.
4. Kind c relies on the in-process `estimate: "preflight"` option beyond the historical fixture it was written for; the
   alternative (libraryEntry + tokenLimit imports in planImport/agentPlanImport/webFaults/controlReadApi) is a larger rewrite.

## Gate (at bf8764b7; `node scripts/test-affected.mjs --base feat/over-grant-no-auto-estimate`, env as above; log `$S/r3/gate.log`)
27 changed paths; 618 root test files selected (0 web). Result: 617 passed, 1 failed; tests 5405 passed, 1 failed, 32 skipped
(memory/correctionExport 1, service/realSmoke 1, control/agentUpdatePaired 3, ccloopDefaultE2E 3, driverSkillsReal 1,
savedResultRecovery.paired 20, savedResultRetryAuthorization.paired 3 -- as the runner names them). Load 34.9 at start, 25.1 at end.
The red: `tests/flow/startForm.test.ts` › "answers the templates and a folder's images…", `fetch failed` / ECONNRESET -- the
shape registered in docs/handoff/known-load-flakes.md (line 161, 178). Rerun alone (load 21.7 -> 18.4): on this branch
(`$S/wtRule`) 9/9 green, on the base branch (`$S/wtD23`, run only) 9/9 green. Not a real red.
