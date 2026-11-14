# Review Fix Source (#296) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A requirement review fix inherits its agent, grant and contract policy from the task responsible for its unmet criteria, rather than the alphabetically first task.

**Architecture:** The accepted requirement draft retains authored task order and `traces` linking criteria to tasks. Select the task tracing the most unmet criteria; ties use the accepted draft's order. When no matching trace is available, use a dependency root, falling back to the first archived task for older fixture groups without a draft. Use the same selected task for `agentFrom`, work grant and contract template. Keep the fix's group-wide checks, write-set and allowlist union.

**Tech Stack:** TypeScript, SQLite-backed Orca control, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-12-tester-followup-g-design.md` (§3 review fix); tester #296 in the archived issue table, with the current Web-only fix in `web/tests/workItemsOrder.test.tsx`.

## Global Constraints

- Do not change archived plan canonicalization, schema or existing task order.
- Existing published specs and `.superpowers/sdd/**` remain append-only.
- Everyday gate is `npm test` with `TMPDIR=/tmp` and typecheck; full release gate only for a tag.
- Mutations run only in a local clone, never in the working tree.

## Review Focus

- A non-alphabetical criterion owner must supply the fix's agent and contract policy: regression in Task 1.
- A review with multiple unmet criteria should select the task covering the most, with a stable tie break: Task 1.
- A fixture or older group with no accepted draft must still open a fix: Task 1.
- A reviewer with no `not-met` criterion can be hand-fixed using an explicit goal: Task 1.
- Group-wide required checks and union allowlist must stay intact: existing `requirementReviewFix` and `requirementReviewCommands` criteria.

---

### Task 1: Select the review fix's source task

**Files:**
- Modify: `src/control/requirementReview.ts` (`fixTaskContract`, `openFixTask`)
- Test: `tests/control/requirementReviewFix.test.ts`

**Interfaces:**
- Consumes: `readDraft(store, groupId, acceptedDraftNo)`, archived plan tasks, `ReviewRound.criteria`.
- Produces: a shared task id used by `fixTaskContract` to choose its contract and by `openFixTask` to choose agent and grant.

- [ ] **Step 1: Write a failing criterion** with task `a-integration` dependent on `z-core`, accepted draft traces AC1 to `z-core`; assert the opened fix inherits `z-core`'s distinctive agent/contract policy and its grant, while checks and write set remain group-wide. Cover a tie, and a group without an accepted draft.
- [ ] **Step 2: Run the named file** with Vitest; observe a failure that shows the alphabetical source was chosen.
- [ ] **Step 3: Implement one source selector** using the accepted draft's trace matches, dependency-root fallback and stable order, then pass that selected id to contract and append call.
- [ ] **Step 4: Run focused tests, typecheck, and `TMPDIR=/tmp npm test`; inspect printed selected and skipped files and failure details.**
- [ ] **Step 5: Review diff and commit this self-contained correction; ff-merge to main only after checks.**
