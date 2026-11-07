# Agent Group Cap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an attended CLI agent lower an editable group's token ceiling without acquiring permission to raise or remove a ceiling.

**Architecture:** Reuse `proposal-edit` and its transaction, adding a narrow `capOnly` form. The existing authorization table permits this exact form on the socket; the service rechecks the current limit and proposal version in the transaction. The CLI creates the full payload from a fresh group read.

**Tech Stack:** TypeScript, Zod, SQLite, Vitest, existing CLI registry.

**Spec:** `docs/superpowers/specs/2026-11-08-agent-group-cap-design.md`

## Global Constraints

- Existing proposal edits and `group set-limit` keep their authorization and bytes when `capOnly` is absent.
- No provider invocation, schema migration, or extra command authority.
- Orca `npm test` selects affected tests and includes typecheck; `npm run verify` remains release-only.

## Review Focus

- A socket agent tries `capOnly` with a token increase: reject; Task 1 tests this.
- A socket agent tries `capOnly` with changed activeMs or extra allocation operations: reject; Task 1 tests both.
- A socket agent tries to clear a finite cap with null: reject; Task 1 tests this.
- An agent races a proposal version change: refuse the stale payload; Task 1 tests this.
- A dispatched run attempts to use `capOnly`: preserve the dispatched-run refusal; Task 1 tests the permission boundary.

---

### Task 1: Narrow server authority

**Files:** Modify `src/control/webProtocol.ts`, `src/control/webService.ts`, `src/control/errors.ts`, `src/panel/humanOnly.ts`; test `tests/control/agentGroupCap.test.ts` and `tests/panel/accessMatrix.test.ts`.

**Interfaces:** Raw `proposalEditPayloadSchema` and `effectiveProposalEditPayloadSchema` gain `capOnly?: true`. `WebControlService.editProposal(command)` checks this shape against the group limit within its existing transaction. The existing `socketTier('proposal-edit', payload)` returns `open` only for this form, with the service as final authority.

- [ ] Write new tests for finite lower, null→finite, higher/null/other-dimension/operation refusal, stale version and permission boundaries. Name the production guard each test would catch.
- [ ] Run the focused tests and observe the new behavior fail before implementation.
- [ ] Add the schema and transaction guard; change socket authorization only for the explicit `capOnly` form, preserving human-only standard edits.
- [ ] Run the focused tests; expect zero failed tests.

### Task 2: Expose the CLI action

**Files:** Modify `src/commands/domains/work.ts` and generated CLI references if required by `gen:cli-docs`; test `tests/commands/agentGroupCap.test.ts`.

**Interfaces:** `orca group cap <group> --tokens <n>` reads the current group view and sends `{baseProposalVersion,operations:[],proposedGroupLimit:{...currentGroupLimit,tokens:n},capOnly:true}` to `groups/<id>/proposal/edit`.

- [ ] Write a fake-panel CLI test for route, payload and error when the group has no editable proposal; observe the failure first.
- [ ] Implement the CLI action, including a plain description that it can only lower a ceiling.
- [ ] Run focused tests, `npm test`, generated CLI docs check, and `git diff --check`; report any skipped or failed tests by name.
- [ ] Inspect the diff and commit this independent feature on its branch.
