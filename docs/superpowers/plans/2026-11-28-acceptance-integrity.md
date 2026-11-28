# Acceptance Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent test-scope reductions from receiving a false acceptance pass, recognize safe full-suite commands consistently, and expose failure-comparison reasons.

**Architecture:** Reuse one bounded full-suite recognizer in split validation and requirement-delivery hints. Extend the acceptance test-change scan to check-defining paths, cache one suite-count observation per exact base/command/setup/reporter identity, and use per-invocation TAP evidence for relative-failure and shortfall decisions. Preserve the same behavior in delivered acceptance and render reasons in CLI and Web views.

**Tech Stack:** TypeScript, Node.js `node:sqlite`, Vitest, existing Orca control-store migrations and React Web views.

**Spec:** `docs/superpowers/specs/2026-11-28-acceptance-integrity-design.md`

## Global Constraints

- The count cache key is exactly `(repo_id, base, command, setup_digest, reporter)`; the initial reporter is `node-test-tap-v1`.
- A shortfall is `tipTests * 2 < baselineTests`; use the minimum count across all observed tip suite invocations.
- Cache a completed unavailable count, but do not cache infrastructure failures that prevented a completed base run.
- A red or ambiguous retry branch cannot be hidden by a later green branch.
- Do not accept pipelines, unconditional-success tails, test selectors, file arguments, excludes, or arbitrary shell wrappers as final-suite proof.
- Test-definition scan failure remains fail-closed; group and D3 scans use the same check/setup inputs.
- Migrate all still-supported schema versions to 27; old acceptance rows remain readable without inferred evidence.

## Review Focus

1. A zero-test TAP run (`# tests 0`) against a positive base count must be a measured shortfall; a missing count must be shown as unavailable, not converted to zero.
2. A test-discovery config added at tip must trigger disposition; a newly added ordinary test file or package script alone remains additive.
3. A red retry branch followed by a green branch must remain visible; unsupported or malformed red output must fail non-comparably.
4. Symlinked cwd and TAP `location:` paths resolving to the same real directory must yield the same repository-relative identity.
5. D3 must retain its own shortfall evidence; a tip command waiver cannot clear a delivered-tree shortfall.

---

### Task 1: Shared full-suite command recognition

**Files:**
- Create: `src/control/fullSuiteRecognition.ts`
- Modify: `src/control/requirementSplit.ts`
- Modify: `src/control/requirementDelivery.ts`
- Test: `tests/control/fullSuiteRecognition.test.ts`
- Test: `tests/control/splitDeliveryGraph.test.ts`
- Test: `tests/control/requirementDelivery.test.ts`

**Interfaces:**
- Produce `recognizeFullSuiteCommand(command: string): FullSuiteCommand | null` for the accepted direct runner forms and output-only options in the spec.
- `deliveryProblems` and `deliveryGraphProblems` use the same recognizer. `finalVerification` rejects `||` retry wrappers with an actionable explanation to use the direct suite command; Orca owns the red-suite retry.

- [x] **Step 1: Add failing table-driven command-shape tests.** Accept direct suite forms, `npx vitest run`, `pytest -q`, `npm test -- --reporter=dot`, `npm test --silent`, and `npm test && true`. Reject selectors, file arguments, `npm test || true`, `npm test; exit 0`, pipelines, arbitrary wrappers, unrelated `&&` commands, and quoted mentions.
- [x] **Step 2: Run the focused tests and confirm the new accepted forms fail under the current implementation.**
- [x] **Step 3: Implement the bounded recognizer and wire both validators to it.** Keep requirement hints and final-verification gating on the same definition.
- [x] **Step 4: Use the recorded pre-change test failures as the old-regex baseline; run the focused tests after the shared recognizer passes.** Run `vitest run tests/control/fullSuiteRecognition.test.ts tests/control/splitDeliveryGraph.test.ts tests/control/requirementDelivery.test.ts` and confirm pass.

### Task 2: Test-definition change scan

**Files:**
- Modify: `src/control/criteriaProtection.ts`
- Modify: `src/control/acceptanceTestChanges.ts`
- Modify: `src/control/groupAcceptance.ts`
- Modify: `src/control/deliveredAcceptance.ts`
- Test: `tests/control/acceptanceTestChanges.test.ts`
- Test: `tests/control/groupAcceptance.test.ts`
- Test: `tests/control/deliveredAcceptance.test.ts`

**Interfaces:**
- Extend `existingTestChanges(repo, base, tip, checkInputs)` with the actual required checks and setup commands.
- Reuse `checkPaths()` and `definesChecks()`; add the named test-discovery configuration predicate beside `isTestFilePath()`.

- [x] **Step 1: Add failing scanner tests.** A changed existing `scripts.test` or other existing package script key, workflow modification/deletion, and added/changed/deleted known discovery config must enter `paths`; a new ordinary test file and a newly added package script alone remain additive.
- [x] **Step 2: Run `vitest run tests/control/acceptanceTestChanges.test.ts` and confirm the new cases fail.**
- [x] **Step 3: Extend `definesChecks()` and make the acceptance scan compare relevant package script keys, workflow paths, and test configs. Pass the current setup/check set from both group and delivered acceptance.
- [x] **Step 4: Add end-to-end coverage showing that changing `scripts.test` to a pattern that runs no real tests produces `test-change-pending` in group acceptance.** Run `vitest run tests/control/acceptanceTestChanges.test.ts tests/control/groupAcceptance.test.ts tests/control/deliveredAcceptance.test.ts` and confirm pass.

### Task 3: Schema 27 suite-count cache

**Files:**
- Create: `src/control/acceptanceSuiteBaseline.ts`
- Modify: `src/control/migrations.ts`
- Modify: `tests/control/schema26.test.ts` or create `tests/control/schema27.test.ts`
- Test: `tests/control/acceptanceSuiteBaseline.test.ts`

**Interfaces:**
- Define `SuiteCountBaselineKey` with `repoId`, `base`, `command`, `setupDigest`, and reporter literal `node-test-tap-v1`.
- Implement `readSuiteCountBaseline(store, key)` and `recordSuiteCountBaseline(store, observation)`; preserve status, nullable count, exit, provenance, and timestamp.
- Reuse legacy identity-row counts only when all rows under the exact key agree on one non-null count and one exit. New table observations remain the canonical cache.

- [x] **Step 1: Add failing schema tests for a fresh schema-27 store and migration from schema 26 and representative pre-26 stores.** Confirm existing rows remain intact.
- [x] **Step 2: Add failing store tests for exact-key reads, counted/unavailable rows, stable same-key observation, and distinct rows for command/setup/base changes.**
- [x] **Step 3: Add `schema26To27`, update every supported migration path, and implement the exact-key store helper.** If one matching base run yields both count and complete red identities, write both from that output.
- [x] **Step 4: Run the schema and store tests and confirm pass.**

### Task 4: Counted acceptance attempts and shortfall classification

**Files:**
- Modify: `src/control/groupAcceptance.ts`
- Modify: `src/control/groupAcceptanceRecord.ts`
- Modify: `src/control/webProtocol.ts`
- Modify: `src/control/deliveredAcceptance.ts`
- Test: `tests/control/groupAcceptanceFullSuite.test.ts`
- Test: `tests/control/deliveredAcceptance.test.ts`

**Interfaces:**
- Record per-invocation suite test counts and baseline-count status in `AcceptanceEvidence`/`FullSuiteRecord`.
- Change `acceptanceResultOf()` to fail on any measured shortfall regardless of whether tip checks exited zero or red.
- Add a per-key in-process promise map around a count-baseline miss so concurrent acceptance checks share the same base execution.

- [x] **Step 1: Add failing green-tip shortfall tests for 79/552, 0/552, and the exact half boundary 276/552.**
- [x] **Step 2: Add failing tests proving a cache miss runs the exact base command after tip, stores one count, a second acceptance reuses it, and a different setup/base/command gets a new count.
- [x] **Step 3: Add tests for base output without a supported count, completed unavailable caching, and infrastructure failure retryability.
- [x] **Step 4: Implement the base count collection after tip execution, minimum-count aggregation across every tip invocation, shortfall classification, and visible count status.** Preserve existing relative-identity behavior and do not rerun the base suite on a cache hit.
- [x] **Step 5: Add D3 coverage for a delivered-tree-only shortfall and confirm a tip waiver cannot override it.** Run `vitest run tests/control/groupAcceptanceFullSuite.test.ts tests/control/deliveredAcceptance.test.ts` and confirm pass.

### Task 5: Multi-section TAP identity and alias normalization

**Files:**
- Modify: `src/control/acceptanceFailureIdentity.ts`
- Modify: `src/control/checkCommand.ts`
- Modify: `src/control/groupAcceptance.ts`
- Modify: `src/control/groupAcceptanceRecord.ts`
- Test: `tests/control/acceptanceFailureIdentity.test.ts`
- Test: `tests/control/groupAcceptanceFullSuite.test.ts`

**Interfaces:**
- Extend `FailureIdentityParse` with `reportedFailures` and block count; keep the current reporter literal.
- Extend each recorded identity attempt with per-branch exits and observed-failure count/status.
- Add `sameSuiteRetryBranches(command: string): [string, string] | null` in `fullSuiteRecognition.ts` for exact identical direct suite branches only; split validation still rejects these shell wrappers.
- `runCheckRecorded()` executes only the exact parsed same-suite retry form as separate branches under one shared deadline; all other commands retain their existing spawn path.

- [x] **Step 1: Add failing parser tests for two red TAP blocks, red then green, duplicate identities across blocks, malformed second block, symlinked cwd/location, and a path that cannot be resolved.**
- [x] **Step 2: Add failing runner/classification tests proving a red branch cannot be hidden by a later green branch and a red branch with unsupported identity output fails non-comparably.
- [x] **Step 3: Implement per-block TAP validation and identity-key de-duplication across blocks; resolve cwd and absolute locations with realpath while preserving fail-closed handling.
- [x] **Step 4: Implement same-suite retry interception with one total timeout budget and record both branch outcomes.**
- [x] **Step 5: Update comparison logic to use observed red branches as well as the final shell exit; ensure all new identities remain failures.** Run the focused parser and acceptance files and confirm pass.

### Task 6: CLI, Board, Web, and delivered-acceptance diagnostics

**Files:**
- Modify: `src/commands/domains/verbs.ts`
- Modify: `src/control/groupAcceptanceRecord.ts`
- Modify: `web/src/controlTypes.ts`
- Modify: `web/src/GroupAcceptanceProblem.tsx`
- Modify: `web/src/BoardView.tsx`
- Modify: `web/src/locales/en.ts`
- Modify: `web/src/locales/zh.ts`
- Modify: `src/control/deliveredAcceptance.ts`
- Test: `tests/commands/groupShowAcceptance.test.ts`
- Test: `tests/commands/groupBrief.test.ts`
- Test: `tests/panel/groupProblemVisible.test.ts`
- Test: `web/src/GroupAcceptanceProblem.test.tsx` and the existing Board acceptance test

- [x] **Step 1: Add failing text and Web tests for each comparison reason, red retry branch exits, count-unavailable status, and shortfall counts.
- [x] **Step 2: Implement reason rendering in group show/brief, Board, and Web. Keep the existing waiver/recheck controls limited to actual command failure.
- [x] **Step 3: Persist delivered acceptance count evidence and shortfall reason; prevent D3 command waiver from clearing a measured shortfall.
- [x] **Step 4: Run the focused CLI, panel, and Web tests and confirm pass.

### Task 7: Integrated verification and review

**Files:**
- Review all modified files; update only the new spec with any as-built correction.

- [x] **Step 1: Run `npm test` with the normal affected-file selector; capture output and confirm zero skipped selected files.**
- [x] **Step 2: Run `npm run typecheck` and `npm run build`; capture complete outputs and confirm exit code 0.
- [x] **Step 3: Run the required test-selection/mutation checks for the new gates and confirm each new behavior is observed red when its guard is removed.
- [x] **Step 4: Review the integrated diff, including schema compatibility, direct test path coverage, retry exit preservation, and D3 waiver boundaries.
- [x] **Step 5: Update the Orca handoff after the final code commit with the behavior, verification evidence, and residual unsupported reporter boundary.
