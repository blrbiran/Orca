# OMP Malformed Final Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify and land proven work from an OMP execute with an invalid final message, only for tasks that expressly declare their command checks sufficient.

**Architecture:** An opted-in ccloop producer captures a full failed-format stream, known usage, unchanged execute HEAD, no tool violation, no verifier entry, and a Git snapshot under the worker lease. It binds the actual published ref/sha/tree/parent before cleanup. A separate, discriminated verification-only source/recovery shape keeps the missing answer/hash absent; Orca mirrors and funds it, and ccloop runs declared command checks over Git-observed paths without a model verifier.

**Tech Stack:** TypeScript, Zod, Git, SQLite control store, Vitest; ccloop and Orca repositories with separate gate rules.

**Spec:** `docs/superpowers/specs/2026-11-08-omp-verdict-recovery-and-noop-undo-design.md` Corrections 1–2.

## Global Constraints

- Existing strict execute decoder and old source refusal remain unchanged.
- One repository, no setup, no reported decisions/agent judgment, known usage and nonempty decisive command checks; opt-in absent by default.
- Original normal-answer recovery and historical run accounting remain unchanged; do not synthesize `ExecutionResult`, hash, taskResult, decisions, or answer usage.
- Tests in each repository follow that repository's CLAUDE.md, with mutation in isolated local clone only.

## Review Focus

- Invalid final after tool-rule violation, nonzero process exit or incomplete stream never yields source: Task 2.
- Changed execute HEAD or fake published ref/tree/parent never yields source: Tasks 2–3.
- Unknown usage, setup/multi-repo and no explicit decisive-check opt-in remain unavailable: Tasks 1–3.
- Admission top-up cannot overwrite historical funding nor allow unverified candidates: Task 4.
- Failed or interrupted check cannot be accepted; restart cannot rerun a check already recorded as complete: Tasks 3–5.

---

### Task 1: Explicit contract declaration in both repositories

**Files:** ccloop `src/contract/schema.ts`, Orca `src/scheduler/planFile.ts`, `src/control/loopPlans.ts`, `src/control/executionSnapshot.ts`; corresponding contract/round-trip tests.

**Interfaces:** Optional absent-by-default `verification.commandChecksDecideGoal: true` only with command verifier, nonempty requiredChecks and no reported-decision obligation; frozen original contract hash retains it. A command verifier's mandatory `rejectOn` does not itself satisfy declaration.

- [ ] Add failing tests for declaration absent, valid round trip and incompatible agent-verifier/extra repo/setup/decision contracts.
- [ ] Implement the minimum contract shape and frozen propagation; verify focused tests in each repository.

### Task 2: ccloop captures and binds malformed-final proof

**Files:** ccloop `src/runtime/omp/{ompProtocol,ompAdapter}.ts`, `src/controller/{runLoop,executionFormatFailure,exhaustedCompletion}.ts`, `src/control/worker.ts`, `src/control/savedResultEvidence.ts`; OMP format failure and source evidence tests.

**Interfaces:** Preserve diagnostic `execute-format-failure.json`. New candidate and derived capsule are distinct from Codex format failure and exhausted success; capture while lease owns worktree, finalize highWater/handoff, bind actual `publishAttemptCommit` result before removal.

- [ ] Add a real failed-format OMP test with opt-in and published attempt; observe source missing. Add negative stream/usage/HEAD/tool-rule cases that fail when guard removed.
- [ ] Implement candidate capture, publication binding and fail-closed derivation. Run focused tests and ccloop typecheck/build.

### Task 3: ccloop discriminated verification-only consumer

**Files:** ccloop `src/control/savedResultRecovery.ts`, `src/control/savedResultEvidence.ts`, `src/controller/{runLoop,verifySavedResult}.ts` and recovery tests.

**Interfaces:** A discriminated `recoveryOf` carries source run/attempt/capsule/snapshot hashes but no `normalizedExecutionHash` in verification-only branch. Git-observed paths derive from verified bundle. Retain admission/funding/fence checks; no execution answer or provider verify.

- [ ] Write failing tests for eligible source and no-answer verification, plus fake ref and check failure; observe old refusal.
- [ ] Implement new branch and verify-only checks/restart path, leaving old `execution-format-failure-v1` refusal intact. Run focused recovery files and typecheck/build.

### Task 4: Orca mirrors, admits and funds the new source

**Files:** Orca `src/control/{savedResultProtocol,savedResultRecoveryPackage,savedResultRecovery,executionDriver,executionPort}.ts`, paired fixture and recovery tests.

**Interfaces:** Mirror ccloop's exact discriminator and proof schema, retain owner, original grant, fresh top-up, reservation and settlement checks. `collectInto` copies full closure and records source kind.

- [ ] Add a paired fixture asserting opt-in collect/source eligibility, lack of answer/hash, zero funding refusal and a properly funded admission; observe refusal before implementing.
- [ ] Implement mirrored schemas and branch through existing gates. Run focused tests and typecheck.

### Task 5: Prove verification-only landing and acceptance

**Files:** Orca `src/control/{executionDriver,checkpoints}.ts` only where verification-only marker/acceptance requires it; ccloop and Orca paired E2E tests.

- [ ] Write a failing end-to-end test from malformed final to a funded new run with zero plan/execute calls, exactly one check sequence and settled accepted work; a failing check stays unaccepted.
- [ ] Implement explicit verification-only marker and acceptance. Verify both repos' targeted tests/typecheck/build and Orca affected `npm test`; review cross-repo protocol diffs independently.
