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
