# Task 3 — optional ccloop token ceilings and allowance continuation

Implemented in `/private/tmp/ccloop-feedback-followup-20261011`, commit `91c0a7559b50a35f34a70a33f300e62ee0693dd3`, based on `8ebd1633cfd8929301eb7ff15f4a385e9adb649e`. Exactly 21 source/test files committed; only the pre-existing untracked `node_modules` link remains. No original checkout, pin, remote, provider, migration, or shared ledger was changed.

Nullable cumulative ceilings now flow through contract validation, controller arithmetic, worker grants, persisted snapshots, and protocol4 collection. Usage remains finite safe integers; null remaining alone never means unlimited. Zero time/attempt/session/token allowance blocks before provider launch; unknown legacy usage blocks resume before residual-worktree cleanup. The real fake-Codex worker completes three phases at **4,800,000 observed tokens**, with finite usage and `tokenRemainingStatus:'unlimited'`. Existing adapter soft-enforcement disclosures and request/time bounds remain.

Finite group/cap allowance depletion can park with `waitingCause:'token-allowance'`, `waitingOnHuman:false`, and a genuine retained workspace. Renewal requires the hash-validated snapshot bundle and completed phase artifacts; plan→execute and execute→verify skip paid phases. A completed verifier rejection can renew at plan only if the original retry decision permits it. Saved failure history and inherited attempt/session counts prevent retry resets. New observations stay run-local; inherited usage is never charged/subtracted twice. Interrupted renewed verify does not charge its saved execute result.

## Interfaces for Task 4

- `src/budget/tokenPolicy.ts`: `Amount`, `BudgetAmount`, `amountSchema`, `budgetAmountSchema`, `remainingTokens`, `minTokenCeiling`, `remainingBudget`, `budgetFits`, `tokenRemainingStatus`, `TokenPolicy`, `tokenPolicySchema`.
- Independent `control features`, stdin `{}`, returns exactly `{protocol:1,tokenPolicy:'optional-v1'}`; no other future features advertised. It accepts no `--agents`, or the existing `--agents <absolute-path>` form. Protocol3 starts/finite hashes and core collection/capability shapes remain; internal candidate/state metadata is explicitly projected out.
- Protocol4 loop envelope optional `tokenPolicy:{authoredTokenCeiling:number|null,bindingCauses:('task'|'group'|'spend-cap')[],inheritedUsage:Amount}`. Work tokens may be null; handoff and usage remain finite; work sessions must be positive. Single-call starts remain protocol3/finite.
- Protocol4 terminal snapshot adds `tokenRemainingStatus:'known'|'unlimited'|'unknown'`; allowance terminal adds `waitingCause:'token-allowance'` and `allowanceNextPhase:'plan'|'execute'|'verify'`.
- `HandoffPacketV1` allowance extension: `contractHash`, `acceptedContract:ArtifactRef`, source `tokenPolicy`, and `allowanceContinuation:{nextPhase:'plan'|'execute'|'verify',plan:ArtifactRef|null,execution:ArtifactRef|null,verification:ArtifactRef|null,state:ArtifactRef}`. Plan renewal requires verification and null plan/execution; execute requires plan; verify requires plan/execution. Every selected ref must be in the handoff artifact closure and validated bundle.
- `readAllowanceContinuation(envelope)` in `src/control/materialize.ts` loads only `inputCheckpoint`'s reachable `checkpoint.handoff`, validates predecessor/group/task/graph/target identity, frozen semantic hash, exact saved state/history and source accepted contract. Contract comparison excludes **only** repoPath and runtime tokenBudget/maxAttempts/totalRuntimeBudgetMs. Actual runtime `loop-contract.json` remains separately retained evidence. Orca must supply the next local grant after subtracting lineage usage once, archive complete real snapshots, and retain admission/stop/exclusion checks.

## Authority and compatibility

Implementation follows the approved task brief, token-policy §§6/6.1/6.2, global constraints and controller rulings. The controller explicitly approved the metadata shape, accepted-contract/frozen-hash separation, plan renewal only after genuine retryable verifier rejection, and exact saved state/verification refs. These are delegated controller decisions, not new human rulings.

Only existing criterion rewritten: `tests/control/protocol.test.ts > control protocol v1 > names unsupported protocol versions separately from invalid requests`. With named controller approval, unsupported versions changed `[1,2,4]`→`[1,2,5]`, with explicit protocol4 acceptance and extra-field refusal added; other request/capability assertions remain. `validation/contracts.test.ts > validation scenario rendering > rejects non-positive execution-policy overrides` remains unchanged: its bounded acceptance harness now explicitly retains positive token overrides, while ordinary/v4 contracts accept zero/null.

## Verification and evidence

Final runner source SHA256: `c4388ae4a945e11617ef942650780b65003321fec2ba30ad9939209fc9cc5434`. [Evidence manifest](task-3-evidence.json) records every command, return code, source identity, raw-log hash and mutation result. Its exact-file hashes include `validation/v1/lib/scenarios.ts`, which the generic runner source hash does not cover.

| Gate | Result | Raw evidence |
|---|---|---|
| Full final suite | 139 files, 1,412 passed; 0 failed/skipped | [raw log](/private/tmp/orca-followup-runs/task3-full-v3/output.log), [per-test JSON](/private/tmp/orca-followup-runs/task3-full-v3/results.json) |
| Native `verify:control`, this built CLI and isolated fake-only table | build passed; 63 files, 658 passed; 0 failed/skipped | [raw log](/private/tmp/orca-followup-runs/task3-native-v3/output.log) |
| Typecheck | RC 0 | [raw log](/private/tmp/orca-followup-runs/task3-type-v3/output.log) |
| Final resume/continuation focus | 72 passed | [raw log](/private/tmp/orca-followup-runs/task3-focused-v3/output.log) |
| Nullable worker/protocol/harness focus | 71 passed | [raw log](/private/tmp/orca-followup-runs/task3-focused-v2/output.log) |
| Deletion mutations | 11 killed; every restoration tracked/staged diff **0/0 bytes** | [mutation results](/private/tmp/task3-mutations-v3.json), manifest links to each complete raw log |

Meaningful RED logs cover null execution/parser/feature negotiation, unknown status, all zero grant dimensions, v3 metadata projection, paid-phase renewal, retry/abort handling and early unknown resume. Final mutation branches: null ceiling, finite time, finite session, finite usage, v3 boundary, v3 projection, skipping paid phases, inherited attempts, inherited sessions, retry history, early unknown resume. Mutations ran only in `/private/tmp/ccloop-task3-mutants-20261011`, final baseline `42655b808483a804e873618593728203bc4cae77`; uncommitted implementation files were copied before baseline commits. Full/native/focused/mutation logs were read in full or full-file programmatic audit plus exact failure inspection; all final gates ran with isolated HOME/XDG/TMPDIR/data roots and no real provider.

Earlier failures are retained, not waived. The first sandboxed broad run had 200 failed tests, one setup/build failure, seven consequent skips and 25 unhandled worker/adapter errors, while new RED cases were still being added. [Exact 201 failed-test/setup names and final resolution](/private/tmp/orca-followup-runs/task3-full-initial/classification.json) show every named item subsequently passing on the final OS-enabled tree. Confirmed process-identity/OS refusals are distinguished from assertion failures. The first OS broad run found the existing bounded-renderer zero override plus the two new retry/abort RED cases; those were corrected without relaxing assertions. A later pre-resume-guard full run passed 1,411 tests; final acceptance is the 1,412-test run above. No current failures or skips remain.

Limitations: budget enforcement is still phase-observed/soft; this does not claim a hard token guarantee. Orca claim allocation, settlement, complete-snapshot admission and paired renewal integration remain Task 4 responsibilities. Independent review and final integration are controller-owned.


## Fix round 1 — independent review I1/I2, 2026-10-11

Scoped fix commit `5b0adea413b885a1151259d5eb88d21eedcc2ce0` on submitted `91c0a7559b50a35f34a70a33f300e62ee0693dd3`; six files only. The independent review correctly found two omitted producer refusal paths. No existing assertion was relaxed. The saved bundle fixture now carries the newly required usage evidence; worker capture assertions were strengthened and a separate actual overshoot case added.

**I1:** `readAllowanceContinuation` now also requires the saved handoff's workItemId to equal the new claim's workItemId. The foreign-work-item reproduction went from an admitted saved verification phase to `control-allowance-authority-mismatch`.

**I2 / interface correction:** `allowanceContinuation` now additionally requires **`usage:ArtifactRef`**, reachable in the same handoff and validated bundle. `captureKnownWorkUsageLedger` freezes the exact source `control/usage.json` bytes after phase settlement/parking and **before** repository materialization and mechanical handoff recording. `parseKnownWorkUsageLedger` validates schema, source run/generation, contiguous sequence and packet high-water, all work observations known, and final cumulative matching the ledger's finite work totals. The reader requires each current inherited dimension—tokens, activeMs, attempts and sessions—to cover source inherited plus actual local work, rejecting unsafe sums. It also checks the ledger attempt count against saved state. The controller's phase-reuse/usage-observation logic is unchanged; saved plan/execution token fields are not charged again. An actual fake worker records 1,600,000 local tokens under a 1,500,000-token allowance, preserving overshoot.

The controller approved this exact ledger-backed interface refinement within the review fix scope. V3 core shapes and hashes remain covered by the full/native suites. The previous report's allowance descriptor omitted this newly required usage ref; this append supersedes that descriptor for v4 allowance renewal. Root/Task4 must archive the ref already present in the candidate/handoff artifact list.

Final source SHA256 is `0f4a924fd2f9cc08f7761dac5685064b09acfb5b691d7f709a8012441ae415ae`. [Fix evidence manifest](task-3-fix1-evidence.json) contains exact six-file hashes, every command/RC/tree/log hash and clone restoration results.

| Gate | Result | Raw evidence |
|---|---|---|
| Review reproductions before fixes | Three intended failures; original nine cases passed | [RED](/private/tmp/orca-followup-runs/task3-fix1-review-red/output.log) |
| Local lineage/evidence and worker capture RED | Nine intended lineage/evidence failures; two missing capture-ref failures | [lineage RED](/private/tmp/orca-followup-runs/task3-fix1-local-red/output.log), [capture RED](/private/tmp/orca-followup-runs/task3-fix1-capture-red/output.log) |
| Targeted allowance/controller/v3 boundary | 33 passed | [log](/private/tmp/orca-followup-runs/task3-fix1-targeted/output.log) |
| Full final suite | 139 files, 1,424 passed; zero failed/skipped | [raw log](/private/tmp/orca-followup-runs/task3-fix1-full/output.log), [per-test JSON](/private/tmp/orca-followup-runs/task3-fix1-full/results.json) |
| Native control, exact local build/fake table | Build passed; 63 files, 670 passed; zero failed/skipped | [raw log](/private/tmp/orca-followup-runs/task3-fix1-native/output.log) |
| Typecheck | RC 0 | [log](/private/tmp/orca-followup-runs/task3-fix1-type/output.log) |
| Scoped deletion mutations | Six killed; tracked/staged restoration **0/0 bytes** after each | [results](/private/tmp/task3-fix1-mutations.json) |

Mutants delete work-item binding, token dimension, active-time dimension, local usage contribution, prior usage contribution, and usage artifact closure membership. They ran only in `/private/tmp/ccloop-task3-fix1-mutants-20261011`, baseline `55f099b23df790b645c8bd5f3a18d6cd4d9ed4d4`; all complete logs were read. The earlier preparatory `task3-fix1-red` run had eleven shape failures because the expanded fixture preceded the usage-field schema. It is retained in the manifest, but is not used as proof of I1/I2: the separate three-case RED above reproduced the actual review omissions. The intermediate work-item run passed I1 while leaving the two expected I2 failures. All final gates passed on the same frozen source. No provider calls, original checkout changes, repin, publication or Orca documentation staging occurred. Ready for scoped independent re-review.

Fix-round wording clarification: no **real** provider calls occurred; runtime gates did invoke the isolated fake-provider fixtures described above.
