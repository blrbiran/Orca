# Exhausted Attempt Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development task by task. Each task follows test → observed RED → smallest code → GREEN → review. This plan belongs to Orca session 03bb48b6 on 2026-11-07, based on Orca `7ee0f384` and ccloop `4cdc1ab`; recheck both before editing.

**Goal:** Reverify completed, strictly decoded work from a terminal exhausted attempt without running its execute phase again; retain original failure and reject unsupported evidence.

**Architecture:** ccloop captures a budget-gate decision and published attempt tree while the worker still owns its workspace, then finalizes a content-addressed source only after the worker's report and sealed stop proof exist. Its recovery reader validates this new authority separately from the existing failed legacy path. Orca stores the closure and uses its existing membership, accounting, funding and verify-only admission gates, with a new outcome-specific source check.

**Tech Stack:** TypeScript, Zod, Git, node:sqlite, Vitest; existing ccloop control protocol and Orca execution port.

**Spec:** `docs/superpowers/specs/2026-11-07-exhausted-attempt-recovery-design.md`, including Correction 1.

## Global Constraints

- ccloop and Orca existing criteria remain untouched; add new tests. Mutations run only in local clones and each new guard must be seen RED.
- Existing Codex legacy failed-source and malformed OMP final refusals remain intact. A ref, display manifest or diff alone grants no recovery.
- Capture only a single normally completed Codex or OMP execute with a complete strict result at the post-execute budget gate, before verifier entry; no partial result, setup, multi-repo, handoff or allowance parking.
- A source with unknown raw execute usage needs a valid `approximate-floor` settlement receipt. Never convert corrupt positive usage to unknown.
- Orca retains original `exhausted` and funds a separate verify-only run; do not repin before ccloop is published by the human.
- Verification commands write complete logs and preserve exit codes. Orca uses `npm test` plus typecheck; ccloop uses typecheck, build and Vitest/known-red check.

## Review Focus

- A provider times out after writing files without a valid result: no final capsule and no recovery; Task 1 and Task 3 tests.
- The commit is published but cleanup or worker sealing fails: no final capsule; Task 1 and Task 2 tests.
- Another attempt or retry supersedes the source: Orca membership rejects the old run; Task 4 tests.
- The original usage is unknown or receipt belongs to another principal: unavailable until correct settlement; Task 3 and Task 4 tests.
- A successful final from OMP is valid but lacks Codex's wire schema file: the OMP process/stream proof is checked in its own format; Task 1 and Task 3 tests.

---

### Task 1: Capture the post-execute candidate

**Files:** ccloop `src/controller/runLoop.ts`, `src/workspace/worktreeManager.ts` (only if an existing commit return value is insufficient), new `src/controller/exhaustedEvidence.ts`, new `tests/controller/exhaustedEvidence.test.ts`.

**Interfaces:** Producer gets the accepted loop envelope, actual config, attempt/base/head, decoded `ExecutionResult`, settled usage and lease callback. The cleanup wrapper receives an optional `onPublished(commit: AttemptCommit): Promise<void>` called exactly once after the existing `publishAttemptCommit` and before removal. Candidate writer persists an immutable pre-closure ref containing a budget-gate decision and verifier-not-entered proof, provider process and stream refs, and snapshot of the *published* commit.

- [ ] Add a test whose completed execute exhausts the budget before verifier entry, retains one published ref and a readable candidate with the exact result/tree; a Codex and an OMP fixture must each go RED on their own assertion. Include refusal for timed-out execute, partial result, duplicate final, nonzero process, tool violation and allowance parked.
- [ ] Run those tests and record the failure at the new assertion.
- [ ] Implement the optional post-publish callback and capture, with failure creating only a named unavailable diagnostic, never changing the original run outcome or cleanup. Assert commit parent/base and captured tree consistency. Do not call `publishAttemptCommit` a second time.
- [ ] Run targeted tests and typecheck/build. Commit the ccloop task on its feature branch.

### Task 2: Bind sealed report and stop proof

**Files:** ccloop `src/control/savedResultEvidence.ts`, `src/control/collect.ts` or a separate leaf module `src/control/exhaustedSource.ts`, new `tests/control/exhaustedSource.test.ts`.

**Interfaces:** The finalizer consumes only a valid Task 1 candidate plus the original terminal report and `proveStopped` result; it deterministically derives a content-addressed `ccloop-execution-complete-before-verification-v1` source ref without writing after the worker lease ended. `collectSavedResultEvidence` advertises that ref only after the complete closure is validated, and `readSavedResultEvidence` recomputes and serves only its declared immutable refs.

- [ ] Add positive closure tests and negatives for a missing/wrong report, mismatched attempt/ref/tree, unsealed worker, changed usage high water, nonbudget outcome, duplicate capture and incomplete closure. Each refusal leaves `capsule:null` with a named reason.
- [ ] Observe RED for both positive capture and an independently disabled seal guard (mutation only in a clone).
- [ ] Finalize on the read side after stopped proof becomes available; derive the same canonical closure bytes and hash on every read, with no post-lease write. Recheck identity/bytes on subsequent reads. Ensure orphaned candidate bytes are never advertised.
- [ ] Run targeted tests and typecheck/build. Commit the ccloop task.

### Task 3: Validate new ccloop source and verify only

**Files:** ccloop `src/control/savedResultRecovery.ts`, `src/control/savedResultEvidence.ts`, `src/controller/verifySavedResult.ts` only if shared guard requires it; new `tests/control/exhaustedSavedResult.test.ts`, new native integration test alongside `tests/control/savedResultRecovery.native.test.ts`.

**Interfaces:** Extend the existing `authorityKind` union with `execution-complete-before-verification-v1`. A distinct `validateSavedSource` branch verifies original exhausted state specifically caused by the recorded post-execute budget gate, strict decoder identity, one completed process, sealed source, source report and published commit/base/tree, then returns the existing `LoadedSavedResult` fields. All existing admission/funding/verifier fences remain common.

- [ ] Add a native producer→consumer test: new run makes zero plan/execute calls, runs the required checks and verifier exactly once, original run stays exhausted. Add refusals for OMP bad final and every Review Focus condition owned here.
- [ ] Observe RED in the native test and targeted mutation of each new gate: unique decode, budget decision, process completion, report identity, funded grant and verifier entry.
- [ ] Implement the new branch without relaxing `state.status==='failed'` or decode-error constraints in the legacy branch. For missing raw usage require the existing verified approximate settlement; no fresh work execution in recovery.
- [ ] Run targeted tests, typecheck/build and the ccloop all-test known-red gate. Commit the ccloop task.

### Task 4: Admit the new source in Orca

**Files:** Orca `src/control/savedResultProtocol.ts`, `src/control/savedResultRecoveryPackage.ts`, `src/control/executionDriver.ts`, `src/control/savedResultRecovery.ts`; add tests in `tests/control/savedResultRecovery.test.ts` and `tests/control/savedResultRecovery.paired.test.ts`.

**Interfaces:** Mirror ccloop's strict new source schema/authority enum; collect and persist every declared ref. `currentSavedResultSource` accepts exhausted only if the new source is present and the current task, contract, report, usage and original sealed stop proof match. `readSavedResultEligibility` reports `saved-result-exhausted` for no producer evidence, as implemented in the first diagnostic change.

- [ ] Add paired tests for an exhausted source with a genuine new capsule and funded verify-only run; stale task membership, forged capsule or closure, wrong receipt and wrong outcome refuse by name. Existing failed-source tests remain unchanged.
- [ ] Observe RED for eligible exhausted and each new guard in a clone; preserve the earlier diagnostic RED observation.
- [ ] Extend strict mirror, collection and admission; keep original exhausted run and use the existing verify-only funding path. Do not infer authority from `drive.attemptSha`, task result or archive alone.
- [ ] Run Orca `npm test`, typecheck and ccloop pin pairing against the local built ccloop via test override; do not edit the formal npm pin yet. Commit Orca on its feature branch.

### Task 5: Integrate and document honest boundaries

**Files:** Orca `docs/handoff/handoff.md` (replace the current rolling status), ccloop `docs/handoff/handoff.md` (replace only its Orca section), CLI/help or skill references only when behavior actually changes.

- [ ] Review the whole diff independently, fix verified findings and rerun their targeted mutation tests.
- [ ] Run each repository's prescribed gates on the exact observed commits; compare remote tips at start and finish, and record skips and load flakes by name.
- [ ] Fast-forward merge clean branches only when their code and tests are complete. Keep the formal Orca ccloop pin unchanged until its commit exists on the remote; do not push from an agent session.
- [ ] State explicitly that historical OMP malformed finals and already-recorded exhausted runs without a capsule remain unavailable; explain the separate human decision needed for any new result-forming action.

## As built (2026-11-07)

Implemented in ccloop (local main, theme line `feat(recovery): a successful execute the budget gate stopped keeps a verified completion source`) and mirrored in Orca's working tree. Deviations from the tasks above, all recorded here rather than edited in place:

- **Task 1** lives in `src/controller/exhaustedCompletion.ts`; it reuses `captureWorktreeSnapshot` (exported from `executionFormatFailure.ts`) and adds the tree `git add -A` would commit, computed through a temporary `GIT_INDEX_FILE` so the attempt's own index is untouched. A failure writes `exhausted-candidate-unavailable.json` and an event, never changing the run's outcome.
- **Task 2** binds the published commit in the existing cleanup wrapper (`bindExhaustedCandidate` right after `publishAttemptCommit`, before removal) instead of a second publish. The read-side finalizer derives the capsule on every call and writes nothing after the lease; the capsule carries a stable `stop:{executionId,generation,isolated}` instead of the `proveStopped` artifact ref, whose `probedAt` made the derived bytes non-deterministic. `proveStopped` must still pass at derivation.
- **Task 3** adds `execution-complete-before-verification-v1` beside the two existing authority kinds and projects the execution snapshot into the legacy snapshot shape the materializer expects. `rawExecutionTokens` is the execute call's own tokens (as the legacy reader defines it).
- **Task 4** mirrors the strict schema in Orca, records the real authority kind at collect, traverses it in `recoveryClosure`, and opens the exhausted gate in `currentSavedResultSource` only when the run carries that kind; every other exhausted run still answers `saved-result-exhausted`.

Not done: OMP against a real provider, the paired "zero plan/execute, one verify" end-to-end, and the full refusal matrix (only the tree/commit forgery, malformed-final and partial/timeout refusals have criteria so far).
