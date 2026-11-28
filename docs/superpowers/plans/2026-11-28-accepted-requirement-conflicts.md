# Accepted Requirement Conflicts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Preserve and surface accepted requirement conflicts and human text answers through the frozen document, group views, and final review.

**Architecture:** Copy conflicts from the accepted draft into an optional requirement-block record in the accept transaction. Project the record into the frozen document, requirement summary, and CLI brief. Extend the final review input with this record and active-chain text answers. No DB migration is required.

**Tech Stack:** TypeScript, Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-28-accepted-requirement-conflicts-design.md`

## Global Constraints

- Keep conflict fields optional; old requirement blocks and conflict-free drafts retain their existing shape.
- Persist the conflict snapshot in the same transaction as acceptance; do not derive it later from whichever draft is newest.
- Mark an acceptance criterion provisional only when a conflict's `criterion` exactly equals its id.
- Do not add a deterministic prose analyzer, new review verdict, or automatic acceptance/rejection behavior.
- Do not mutate task contracts, funding or the accepted plan.

## Review Focus

- A conflict names a quoted requirement sentence instead of `ACn`: preserve it in the conflict list, but do not annotate an unrelated criterion as provisional.
- An old group has no `acceptedConflicts`: all summary and review paths must remain valid and omit the field.
- The active clarification chain contains superseded rounds: only text answers from active rounds reach final review.
- A conflict-free accepted draft: no new conflict record, document section, or warning line appears.
- An accepted conflict is redelivered/re-read after restart: the exact saved record is used, not recomputed from draft history.

---

### Task 1: Persist and surface accepted requirement conflicts

**Files:**
- Modify: `src/control/requirementRecords.ts`
- Modify: `src/control/requirementCommands.ts`
- Modify: `src/control/requirementDocument.ts`
- Modify: `src/control/requirementReview.ts`
- Modify: `src/control/webProtocol.ts`
- Modify: `src/panel/controlViews.ts`
- Modify: `src/commands/domains/reads.ts`
- Modify: `web/src/controlTypes.ts`
- Test: `tests/control/requirementAccept.test.ts`
- Test: `tests/control/requirementDocument.test.ts`
- Test: `tests/commands/groupBrief.test.ts`
- Test: `tests/control/requirementReview.test.ts`


**Interfaces:**
- Consumes: existing `draft.output.requirementConflicts` and `RoundBody.answers`.
- Produces: optional `RequirementBlock.acceptedConflicts = {draftNo, acceptedAt, acceptedBy, entries}`; optional `RequirementSummaryV1.acceptedConflicts`; `reviewInputsOf` gains `acceptedConflicts` and active-chain `humanAnswers`.

- [ ] **Step 1: Add failing tests**

  In the accept fixture, accept a draft carrying two conflicts and assert the requirement block stores the exact immutable snapshot. Assert a conflict-free accept does not add the field. Assert the frozen document marks an exact `AC1` match provisional, lists conflict details, and retains text answers. Assert group brief warns with count and criterion ids. Assert final review prompt receives saved conflicts and active-chain text answers, including the question/recommendation.

- [ ] **Step 2: Run focused tests and observe failures**

  Run: `npx vitest run tests/control/requirementAccept.test.ts tests/control/requirementDocument.test.ts tests/commands/groupBrief.test.ts tests/control/requirementReview.test.ts`
  Expected: new persistence, document, brief and review-context assertions fail on missing behavior; existing assertions remain green.

- [ ] **Step 3: Persist the accepted conflict snapshot**

  Add an optional strict `acceptedConflicts` member to `requirementBlockSchema`. In `applyRequirementDraftAccept`, copy the accepted draft's conflict entries with `draftNo`, `now.toISOString()` and `command.actorId` before freezing the document. Keep this inside the existing acceptance transaction.

- [ ] **Step 4: Render the document and group summary**

  Add an accepted-conflicts section to `renderRequirementDocument`; append a provisional marker only to an AC with an exact id match. Project the saved record through `RequirementSummaryV1`, and add a human-readable group brief warning naming the count and criterion ids. Keep quoted conflicts visible without guessing an id.

- [ ] **Step 5: Carry conflict history and free-text answers into review**

  Extend `reviewInputsOf` to read the accepted record and collect text answers from the active clarification chain only, with round/question id, question text, answer and recommended answer. Add a prompt section labeling them as human decisions and the accepted conflicts as known history; keep verdict classification unchanged.

- [ ] **Step 6: Run focused tests, typecheck and affected gate**

  Run: `npx vitest run tests/control/requirementAccept.test.ts tests/control/requirementDocument.test.ts tests/commands/groupBrief.test.ts tests/control/requirementReview.test.ts`
  Expected: PASS.
  Run: `npm run typecheck`
  Expected: exit 0.
  Run: `npm test`
  Expected: affected gate exits 0 and prints selected/deferred files.

- [ ] **Step 7: Record the remaining #542 boundary**

  In the Orca handoff, state that text answers now reach review and accepted conflicts are persistent, but no post-acceptance AC amendment command was added. Keep that as a separate design task rather than silently changing the frozen requirement.
