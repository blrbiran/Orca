# Verify-only Work Top-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An authorized `verify-saved-result --work` can fund a new verification run after an exhausted source has spent its authored grant.

**Architecture:** Extend the existing strict command payload, append a `work_grant_top_ups` row bound to the source run in the existing recovery transaction, and reuse retry's principal and cap rules through a shared helper. The funding, reserve, spend cap, evidence, and saved admission gates remain in place.

**Tech Stack:** TypeScript, Zod, node:sqlite, Vitest, generated CLI docs.

**Spec:** `docs/superpowers/specs/2026-11-07-verify-only-work-top-up-design.md`

## Global Constraints

- Absent `work` preserves the current command bytes and behavior.
- `work` has optional nonnegative safe integers `tokens`, `activeMs`, `attempts`, `sessions`; omitted dimensions add zero.
- Append a row with `from_run_id` equal to the source run; its rowid must be strictly earlier than the new run.
- Only optional-policy tasks take top-ups. A dispatched run cannot top up; person authority is unrestricted, otherwise the group-wide agent sum must fit `agentTopUpCap`.
- A refusal leaves no row, run, reservation or activity. Source evidence and funding must still pass.
- Run only affected tests and typecheck for this development round; do not use a paid provider without separate authorization.

## Review Focus

- A duplicate command ID after success returns the original result and writes neither a second grant nor activity (Task 2).
- An invalid source remains refused without a grant row even with `work` supplied (Task 2).
- A Web member with no person authority remains subject to the agent cap (Task 2).
- A finite group without sufficient reserve rolls back the grant row (Task 2).
- The source run's original allowance remains valid after a top-up (Task 2).

---

### Task 1: Strict command and shared authority

**Files:** Modify `src/control/webProtocol.ts`, `src/control/retryTask.ts`, `src/control/errors.ts`, `src/commands/domains/work.ts`, `web/src/locales/{en,zh}.ts`; create `src/control/authorizeWorkTopUp.ts`; test `tests/control/verifyTopUp.test.ts` and CLI criteria.

**Interfaces:** `authorizeWorkTopUp(store: ControlStore, groupId: string, commandId: string, actorId: string, incoming: Amount, prefix: 'retry-top-up'|'saved-result-top-up'): boolean` returns person authority or throws `ControlError` with the matching prefix. `verifySavedResultPayloadSchema` accepts optional `work: retryTopUpWorkSchema`. CLI encodes `--work <json>` only when present.

- [ ] Add command parser and CLI criteria for valid `work`, bad shapes, and absent-field compatibility; run targeted test to see failure.
- [ ] Add a shared authority helper preserving retry's existing order: dispatched, person, absent cap, per-group cap sum. Replace retry's private helper and verify its existing criteria pass.
- [ ] Add strict payload, CLI flag, error codes and English/Chinese messages; run targeted criteria and typecheck.
- [ ] Generate CLI docs with `npm run gen:cli-docs`, check the diff, and commit the tested component.

### Task 2: Transactional saved-result grant

**Files:** Modify `src/control/savedResultRecovery.ts`; create/extend `tests/control/verifyTopUp.test.ts`; extend `tests/control/savedResultRecovery.paired.test.ts` for the real ccloop gate.

**Interfaces:** Parse `command.payload.work` into a full `Amount` only when supplied; use `appendTopUp(store, groupId, taskId, sourceRunId, {amount, commandId, by, personAuthority, at})` before `decideFundedAllowance` in `applyVerifySavedResult`. Emit `saved-result-top-up` activity only after the new run is created.

- [ ] Write tests V1–V9 from spec §4: exhausted source, no work, person/agent/member/dispatched, cap sum per group, empty/no-effect, finite-legacy, insufficient reserve rollback, replay, source allowance and rejected source. Run the targeted file and see the new behavior fail.
- [ ] Implement the minimum admission checks after evidence/identity/closure rehash and before release/funding, append within the command transaction, and record activity on successful start.
- [ ] Run V1–V9 plus existing `retryTopUp`, saved-result tests and root/Web typecheck; address failures and repeat until green.
- [ ] Extend the paired test to exercise exhausted source with person top-up, assert the source outcome stays exhausted and only verify executes; run with the real pinned ccloop binary and the paired test opt-in when available (no paid model).
- [ ] Check `git diff --check`, inspect the full diff and commit this tested component.

## Self-review

Spec §§1–3 map to Task 2; payload and human authorization to Task 1; all V1–V10 to Task 2. The test cases above cover replay, strict ordering, source refusal, insufficient funds, null tokens, finite legacy, principal routing and actual paired verification. The CLI and generated docs share Task 1's interface. No source run grant or group allocation is edited.
