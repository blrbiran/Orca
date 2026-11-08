# No Change Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve truthful no-change decisions and complete ordinary work whose declared checks prove that no repository change was needed.

**Architecture:** A discriminated, verified no-change proof binds the run's original base and published attempt trees before the ledger-only commit. Accept the proof only in trusted Orca landing and its independently verifiable ledger reader; free-text undo remains subject to the existing executable check. A successful empty ordinary result receives acceptance only for an explicit contract where its checks fully decide the goal, using the same declaration as #158.

**Tech Stack:** TypeScript, SQLite control store, Git worktrees, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-08-omp-verdict-recovery-and-noop-undo-design.md` Correction 1 and 2; earlier decision-ledger spec remains immutable.

## Global Constraints

- Git base/attempt tree equality proves only no net tracked change; never claim no intermediate, ignored or external writes.
- Bind evidence before `.decisions/` changes; do not accept a free-text literal or unverified third-party ledger row.
- Existing decision lines, normal executable undo, rejected decisions and old acceptance behavior remain valid.
- D14 empty-result remains blocked when no decisive-check declaration/proof exists.

## Review Focus

- Forged no-change proof containing matching strings but an unreachable or different Git tree must be rejected: Task 1.
- A task changing tracked code while declining a separate change must not earn no-change undo: Task 1.
- A tree equal after intermediate tracked edits makes only the narrow net-change claim: Task 1.
- A no-change run with model-judged checks or without explicit contract opt-in must stay blocked: Task 2.
- Criteria-review verdict may settle independently of a pending decision: Task 2 crossing test.

---

### Task 1: Verified ledger no-change undo

**Files:** Modify `src/ledger/{schema,validateLine}.ts`, `src/control/{runLedger,driverLanding,decisionCommands}.ts` only where proof binding and validation need it; add a focused test to `tests/control/runLedger.test.ts` and ledger validator tests.

**Interfaces:** Consume a published `attemptSha`, its original base from the run's frozen drive record, and verified Git tree IDs. Produce a discriminated no-change undo with repository identity, immutable base/attempt commit+tree proof, and a verifier requiring actual Git evidence. Keep current `undo:{how,cost,blast_radius}` compatible for old records.

- [ ] Write a failing test for a no-change decision accepted only when the actual base and attempt trees match, and a forged proof or changed tree rejected; include third-party ledger read without trusted Git context.
- [ ] Run the new test and confirm the intended assertion fails.
- [ ] Implement proof capture/validation without treating a reserved `undo.how` phrase as evidence. Ensure the normal pending-decision approval still supports a person's executable undo.
- [ ] Rerun focused tests; mutate the new proof check in an isolated clone and watch the targeted test fail.

### Task 2: Decisive empty result acceptance

**Files:** Modify `src/control/{executionDriver,driverLanding}.ts` and the acceptance/checkpoint owner, plus `tests/control/executionDriver.test.ts` or an end-to-end empty-result test.

**Interfaces:** Consume the explicit 'command checks fully decide goal' contract declaration defined with #158, a succeeded run's unmodified Git proof, and completed required-check evidence. Produce an acceptance whose kind clearly marks no-change verification, leaving rejected/ordinary cases unchanged.

- [ ] Write failing end-to-end tests: opted-in command-only task with truly empty Git tree diff completes; otherwise empty task remains blocked; pending decision and criteria-review verdict settle independently.
- [ ] Run to see the success test fail on blocked work status.
- [ ] Add the narrow acceptance path and expose its scope; preserve ordinary acceptance for landed changes.
- [ ] Run focused tests, root typecheck and affected `npm test`; review the new acceptance path independently before integrating.
