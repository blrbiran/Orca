# Acceptance Baselines and Test Changes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent known flaky checks and edits to existing tests from being mistaken for an unqualified acceptance pass, while preserving task landing and explicit human recovery paths.

**Architecture:** Add a durable, setup-scoped store of parsed failing-test identities; compare all acceptance command attempts against those identities at the frozen group base. Independently diff the checked tip against that base, and require a tip-bound person disposition for changes to existing tests. Thread these facts through group and delivered acceptance records, command handling, and the group views.

**Tech Stack:** TypeScript, Node.js, SQLite control-store migrations, Vitest, Express control API.

**Spec:** `docs/superpowers/specs/2026-11-26-acceptance-baselines-and-test-changes-design.md`

## Global Constraints

- Failure identity comparisons require exact repository, base commit, command, setup digest, and parser version.
- A later green base run does not erase an earlier red identity for the same frozen key.
- Run every union check after a check-level red; setup failure stops the union.
- Every red tip attempt contributes failure identities; a later green cannot erase a new identity.
- Only parsed failure identities can produce `passed-relative`; unsupported or ambiguous output fails closed.
- Any modified or deleted test file present at the group's base needs a person disposition; landing remains allowed.
- A test-change disposition is person-only, bound to the checked tip and path digest, and separate from `waive-acceptance`.
- Keep existing acceptance JSON readable. Do not infer new evidence or disposition for historical records.
- Run changed tests with Orca's `npm test` affected-file gate; do not run `test:full` unless the user requests it or prepares a release.
- Follow Rule 14: redirect validation output to files and read complete logs; report command and observed commit.

## Review Focus

- A flaky base check can fail and later pass; retain only identities observed red for the exact setup key, and prove a green does not erase the red identity.
- A flaky tip can fail with a new identity once and pass on retry; the new identity must keep acceptance failed.
- Setup commands or shell wrappers can change what a command tests; a different digest or exact command must never reuse the old baseline.
- TAP output can repeat names, nest failures, or fail before a test starts; ambiguous identities must fail closed and not become an empty pass.
- The branch may have no configured suite, a single landing, a delivered tree, or a moved tip; the test-change gate must still bind to the exact tree whose acceptance is shown.

---

### Task 1: Parse and persist acceptance failure identities

**Files:**
- Create: `src/control/acceptanceFailureIdentity.ts`
- Modify: `src/control/migrations.ts`
- Modify: `src/control/baseCheck.ts`
- Modify: `src/control/checkCommand.ts`
- Test: `tests/control/acceptanceFailureIdentity.test.ts`
- Test: `tests/control/schema26.test.ts`
- Test: `tests/control/baseCheck.test.ts`

**Interfaces:**
- Produce `acceptanceSetupDigest(setup: readonly string[]): string`.
- Produce `failureIdentitiesOf(output: string, reporter: "node-test-tap-v1"): { identities: string[]; parseStatus: "complete" | "unsupported" | "ambiguous" }`.
- Produce `recordAcceptanceFailureIdentities(store, {repoId,base,command,setupDigest,reporter,identities,source,groupId,runId,at})` and `readAcceptanceFailureIdentities(store, key)`; identities accumulate only from complete, red base output.
- Add a strict table keyed by repository, base, exact command, setup digest, reporter, and identity. Keep source group/run and first/last-seen timestamps. Do not alter the existing `base_check_results` primary key.
- Extend `CheckFailure` with optional parsed identities/status from the full captured process output; continue storing only the existing bounded tail in command records.

- [ ] **Step 1: Add parser RED criteria.** In `acceptanceFailureIdentity.test.ts`, cover a nested TAP test name with its repository-relative file and stable diagnostic identity; ordinals/durations/absolute worktree prefixes do not affect identity; two same-named tests under different parents remain distinct; child failures do not double-count a parent suite; file-level failure has a path-bound identity; duplicate/ambiguous structure and malformed TAP return non-comparable status; non-TAP output is unsupported.
- [ ] **Step 2: Run the parser test and confirm it fails.** Run `./node_modules/.bin/vitest run tests/control/acceptanceFailureIdentity.test.ts --reporter=verbose > /tmp/orca-acceptance-parser-red.log 2>&1; echo $?` and read the complete log. Expected: non-zero because the module/API is missing.
- [ ] **Step 3: Implement parser and digest.** Read the full process output before truncation in `runCheckRecorded`; parse only `node:test` TAP v1. Normalize unstable paths, ordinal numbers, stack positions, and timings; hash diagnostic values instead of persisting raw diagnostic text. Return unsupported/ambiguous rather than an empty set if any failed test cannot be assigned a stable identity.
- [ ] **Step 4: Add schema 25→26.** Create the identity table and indexes in `migrations.ts`; update `schemaVersion`, supported source versions, fresh schema, and every migration chain. Add idempotent migration coverage from schema 25 and an empty store.
- [ ] **Step 5: Implement baseline read/write.** Upsert each complete identity independently; red observations accumulate, green observations do not delete. Record exact setup digest and parser version. Reject a baseline lookup with any mismatched key component.
- [ ] **Step 6: Record task base evidence.** When `baseCheck.ts` runs the confirmed required check at base, persist the parsed identities using that task's setup digest. Do not treat legacy `base_check_results` tails as parseable baseline evidence.
- [ ] **Step 7: Run focused criteria.** Run `./node_modules/.bin/vitest run tests/control/acceptanceFailureIdentity.test.ts tests/control/schema26.test.ts tests/control/baseCheck.test.ts --reporter=verbose > /tmp/orca-acceptance-baseline-store.log 2>&1; echo $?` and read the full log. Expected: all selected tests pass.

### Task 2: Apply identity comparison to every group acceptance command

**Files:**
- Modify: `src/control/groupAcceptance.ts`
- Modify: `src/control/groupAcceptanceRecord.ts`
- Modify: `src/control/checkCommand.ts`
- Test: `tests/control/groupAcceptance.test.ts`
- Test: `tests/control/groupAcceptanceFullSuite.test.ts`
- Test: `tests/control/groupAcceptanceGate.test.ts`

**Interfaces:**
- Extend `AcceptanceOutcome` and `GroupAcceptance` with per-command attempts, baseline key/source, parsed tip/base identity sets, and a named non-comparable/new-failure reason.
- Add a local acceptance runner that executes all checks after a check-level red; setup failure stops checks. Do not change `runCheckSequence` semantics for unrelated callers.
- Baseline lookup uses Task 1's exact-key API; absent baseline after a red tip runs the exact command at the group's base with the same setup union and timeout.

- [ ] **Step 1: Add runner RED criteria.** Cover: all union checks run after one check fails; setup failure stops the union; exact command+setup baseline reuses identities; wrapper or setup mismatch does not reuse; no baseline causes one exact base run after tip red; matching identities become `passed-relative`; a new identity fails; unsupported identity parsing fails; red-new then green retry remains failed; matching red then green remains relative with both exits; red at tip/green at base fails.
- [ ] **Step 2: Run focused tests and confirm failures.** Run `./node_modules/.bin/vitest run tests/control/groupAcceptance.test.ts tests/control/groupAcceptanceFullSuite.test.ts --reporter=verbose > /tmp/orca-acceptance-runner-red.log 2>&1; echo $?` and read the complete log. Expected: new criteria fail against current exit-only behavior.
- [ ] **Step 3: Implement all-command execution.** Run setup first and stop on setup failure. Run every union check and preserve each command, exit, duration, bounded tail, parse status, and identities. If the configured suite exactly matches a union command, reuse it as its first suite attempt; preserve the existing confirmation rule when task history reported it red.
- [ ] **Step 4: Implement relative classification.** On any red tip attempt, consult/collect the exact baseline. Persist complete red base identities. Compare the union of failure identities from every tip attempt against the accumulated base set. Any unparsed failure or new identity means `failed`; a later green never erases it.
- [ ] **Step 5: Add direct classification criteria.** Independently assert the tip identity set and base identity set on the comparison result, not only a later summary field, so no earlier assertion can short-circuit the behavior being measured.
- [ ] **Step 6: Run acceptance criteria.** Run `./node_modules/.bin/vitest run tests/control/groupAcceptance.test.ts tests/control/groupAcceptanceFullSuite.test.ts tests/control/groupAcceptanceGate.test.ts --reporter=verbose > /tmp/orca-acceptance-runner-green.log 2>&1; echo $?` and read the complete log. Expected: all selected tests pass.

### Task 3: Gate changes to existing tests with a tip-bound human disposition

**Files:**
- Create: `src/control/acceptanceTestChanges.ts`
- Modify: `src/control/groupAcceptance.ts`
- Modify: `src/control/groupAcceptanceRecord.ts`
- Modify: `src/control/groupAcceptanceCommands.ts`
- Modify: `src/control/webProtocol.ts`
- Modify: `src/control/webService.ts`
- Modify: `src/panel/controlApi.ts`
- Modify: `src/panel/humanOnly.ts`
- Modify: `src/commands/domains/work.ts`
- Test: `tests/control/acceptanceTestChanges.test.ts`
- Test: `tests/control/groupAcceptanceCommands.test.ts`
- Test: `tests/control/groupAcceptanceGate.test.ts`
- Test: `tests/panel/accessMatrix.test.ts`
- Test: `tests/commands/groupShowAcceptance.test.ts`

**Interfaces:**
- `existingTestChanges(repo, base, tip): Promise<{paths:string[]; weakeningSignals:string[]; digest:string}>` compares only the checked tree to frozen base. It classifies any changed/deleted pre-existing test as pending disposition; new files are scanned for `.only`, `.skip`, `.todo`, `xit`, `t.skip`, and equivalent current signals before additive treatment.
- Add person-only `group accept-test-changes <group> --note <why>`. Persist the disposition with exact tip, sorted paths digest, actor, note, and timestamp. It cannot alter command failure results or be invoked by an agent.
- Add acceptance result `test-change-pending`; keep it unsatisfied in `acceptanceSatisfied` and the delivered acceptance gate. A changed tip/path digest invalidates prior disposition.

- [ ] **Step 1: Add diff criteria RED.** Cover changed/deleted existing test, path-independent behavior despite `targetPaths`, additive-only modification, new test with `.only`, new test without weakening, and deletion of a test declaration with unchanged assertion count.
- [ ] **Step 2: Run the detector test and confirm failure.** Run `./node_modules/.bin/vitest run tests/control/acceptanceTestChanges.test.ts --reporter=verbose > /tmp/orca-test-change-red.log 2>&1; echo $?` and read the complete log. Expected: missing detector/API or missing assertions.
- [ ] **Step 3: Implement the exact-tip diff classifier.** Use NUL-delimited Git paths and base-to-tip content; sort paths before hashing. Include stable weakening signals in the result. Do not use task target paths, criteria flag state, or model review verdict as its input.
- [ ] **Step 4: Add the acceptance state and decision gate.** Run the test diff even when no suite is configured and on the single-landing shortcut. A pending disposition prevents group completion. Human disposition matches exact tip and digest; unrelated command waiver cannot clear it.
- [ ] **Step 5: Add command/protocol/access criteria RED.** Verify the person-only command stores actor/note/tip/digest; agent and member authorization are refused; stale tip/digest is refused; command waiver leaves disposition pending.
- [ ] **Step 6: Implement the person-only command.** Wire the strict command schema, web control route, service handler, socket authorization matrix, and CLI verb. Refusal names the changed tip or digest and suggests a fresh acceptance check.
- [ ] **Step 7: Run focused detector/command/access criteria.** Run `./node_modules/.bin/vitest run tests/control/acceptanceTestChanges.test.ts tests/control/groupAcceptanceCommands.test.ts tests/control/groupAcceptanceGate.test.ts tests/panel/accessMatrix.test.ts --reporter=verbose > /tmp/orca-test-change-green.log 2>&1; echo $?` and read the complete log. Expected: all selected tests pass.

### Task 4: Carry the gate through review, delivery, and user-facing views

**Files:**
- Modify: `src/control/deliveredAcceptance.ts`
- Modify: `src/control/requirementReview.ts`
- Modify: `src/control/groupProblemAnswers.ts`
- Modify: `src/panel/controlViews.ts`
- Modify: `src/commands/domains/verbs.ts`
- Modify: `src/commands/domains/reads.ts`
- Modify: `src/control/webProtocol.ts`
- Test: `tests/control/deliveredAcceptance.test.ts`
- Test: `tests/control/requirementReviewFix.test.ts`
- Test: `tests/panel/groupProblemVisible.test.ts`
- Test: `tests/commands/groupShowAcceptance.test.ts`
- Test: `tests/commands/groupBrief.test.ts`

**Interfaces:**
- D3 applies the same baseline and existing-test gate to the actual delivered commit. A tip result cannot be copied to a different delivery tree.
- Group summary exposes changed paths, disposition, tip, baseline evidence, and an explicit next command.
- When acceptance is satisfied and requirement review is not passed, group views say they are independent and preserve the requirement-review action.

- [ ] **Step 1: Add D3 RED criteria.** A delivery tree with one new failing test identity or changed existing test cannot inherit the tip's acceptance. An identical checked tree may reuse its exact result.
- [ ] **Step 2: Add review-action RED criteria.** A test-change-only not-met review offers restore-and-recheck and person disposition; unrelated not-met requirements still offer their existing actions. Command failure waiver does not ratify a test change.
- [ ] **Step 3: Add view RED criteria.** CLI and `group brief` show `test-change-pending`, affected paths, the tip-bound disposition command, and a clear explanation when acceptance passed but requirement review remains not-passed.
- [ ] **Step 4: Implement delivery/review integration.** Use the shared acceptance classifier for D3; maintain separate results for command failure, test-change disposition, and requirement-review findings.
- [ ] **Step 5: Implement view rendering.** Update strict wire schemas and CLI output to preserve old records and omit new fields when absent.
- [ ] **Step 6: Run focused integration/view criteria.** Run `./node_modules/.bin/vitest run tests/control/deliveredAcceptance.test.ts tests/control/requirementReviewFix.test.ts tests/panel/groupProblemVisible.test.ts tests/commands/groupShowAcceptance.test.ts tests/commands/groupBrief.test.ts --reporter=verbose > /tmp/orca-acceptance-views.log 2>&1; echo $?` and read the complete log. Expected: all selected tests pass.

### Task 5: Cross-path regression review and affected gate

**Files:**
- Modify only files required by review findings from Tasks 1–4.
- Test: the affected files selected by `scripts/test-affected.mjs`.
- Test: `tests/control/acceptanceTestChangesE2E.test.ts`

- [ ] **Step 1: Add end-to-end case RED.** Build a driver test where `review-fix` changes a pre-existing test under `targetPaths`, checks pass, a criteria-review flag is auto-ratified, but group acceptance remains `test-change-pending` until the person disposition. Include one new failure identity case and one exact known-flake relative pass.
- [ ] **Step 2: Run the end-to-end case and confirm failure.** Run `./node_modules/.bin/vitest run tests/control/acceptanceTestChangesE2E.test.ts --reporter=verbose > /tmp/orca-acceptance-e2e-red.log 2>&1; echo $?` and read the complete log. Expected: current code reaches plain `passed` or accepts a new failure.
- [ ] **Step 3: Implement the minimal integration fix.** Keep all landing and reviewer behavior outside the acceptance/disposition boundaries unchanged.
- [ ] **Step 4: Run the focused regression set.** Run all new and directly affected acceptance, baseline, criteria, D3, view, and access tests, redirect to `/tmp/orca-acceptance-focused.log`, and read the complete file. Expected: RC 0.
- [ ] **Step 5: Run Orca's changed-part gate.** Run `TMPDIR=/tmp npm test > /tmp/orca-acceptance-affected.log 2>&1; echo $?` and read the entire log, including selected/skipped-file summaries and typecheck. Expected: RC 0, with the exact selected/deferred counts recorded.
- [ ] **Step 6: Review the final diff and migration.** Confirm the 25→26 migration is reversible only by the repository's documented backup/restore process; confirm no user data or real `~/.orca` database was touched; run `git diff --check` and a TypeScript reviewer pass.
- [ ] **Step 7: Commit the Orca implementation after focused review.** Keep spec, plan, tests, and implementation grouped by coherent task; use actual model attribution and repository commit conventions.
