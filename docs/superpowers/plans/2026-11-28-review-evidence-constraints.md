# Review Evidence for Constrained Criteria Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce unsupported `met` verdicts for content and dependency constraints by improving reviewer evidence instructions, without adding deterministic source analysis or new hard rejection rules.

**Architecture:** Keep the existing reviewer schema and controller classification unchanged. Tighten only the `buildReviewPrompt` guidance and pin that guidance with the existing prompt test, including the mismatched-file example shape from #544 and the current evidence-limited `cannot-judge` path.

**Tech Stack:** TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-28-review-evidence-constraints-design.md`

## Global Constraints

- Keep verdicts `met`, `not-met`, and `cannot-judge`; do not change the schema or controller transitions.
- Do not add a static dependency analyzer, vocabulary parser, or automatic rejection rule.
- A path-only or unrelated citation must not be presented in the prompt as proof of a content/dependency relation.
- Be explicit that a reviewer may use the existing `cannot-judge` outcome when the supplied review material does not expose the relation.
- Keep the change limited to review prompt text and its regression criteria.

## Review Focus

- A constraint names module A, but cited evidence is about module B: the prompt must require matching the evidence subject to the criterion; a dedicated prompt test uses the #544 shape (`backoff.js` constrained, `explain.js` shown).
- A criterion says “imports” without specifying direct or transitive dependency: tell the reviewer to use the criterion, original requirement and agreed statement together; if materially different readings remain and change the verdict, use `cannot-judge`; pin this wording in the prompt test.
- The relevant file content is absent or the diff is truncated: use the existing `cannot-judge` path rather than claiming `met`; pin that instruction in the prompt test.
- Ordinary path/content criteria have relevant evidence in the diff: retain the existing evidence instructions and ensure the new wording does not demand static proof; retain the existing ordinary prompt assertions.
- Binary metadata is the only evidence available for a binary file: preserve the current boundary that metadata proves only metadata; retain the existing binary prompt assertions.

---

### Task 1: Tighten reviewer evidence guidance

**Files:**
- Modify: `src/control/requirementReview.ts` in `buildReviewPrompt`
- Test: `tests/control/requirementReview.test.ts`

**Interfaces:**
- Consumes: existing `buildReviewPrompt` input and `classifyReviewOutput` schema.
- Produces: no new interface; only revised prompt text.

- [ ] **Step 1: Add failing prompt assertions**

  Add assertions in a dedicated prompt test built from the #544 mismatch shape: AC1 says `backoff.js` must not import `policy.js`, while the supplied diff only shows `explain.js` importing `policy.js`. Assert the prompt preserves that mismatch, requires matching evidence to the criterion's subject/relation, uses the criterion plus original requirement and agreed statement to interpret direct versus transitive dependency, and says to use `cannot-judge` when material ambiguity would change the verdict or the relation is not shown. Keep existing path-only metadata, binary, and ordinary evidence assertions in their existing tests.

- [ ] **Step 2: Run the prompt test and confirm the new assertions fail**

  Run: `npx vitest run tests/control/requirementReview.test.ts`
  Expected: the new prompt assertions fail because the guidance is not present yet; existing assertions identify no unrelated baseline failure.

- [ ] **Step 3: Update only `buildReviewPrompt` guidance**

  Add concise guidance that ties evidence to the criterion's subject and relation, uses the criterion, original requirement and agreed statement together to resolve direct-versus-transitive wording, and asks for `cannot-judge` only when a material ambiguity changes the verdict or the supplied evidence does not show the relation. Preserve the rule against guessing unshown content. Do not change `outputSchema`, `classifyReviewOutput`, or review state transitions.

- [ ] **Step 4: Run the focused test and typecheck**

  Run: `npx vitest run tests/control/requirementReview.test.ts`
  Expected: PASS.
  Run: `npm run typecheck`
  Expected: exit 0.
  Run: `npm test`
  Expected: changed-part gate exits 0 and reports exactly which files it selected or deferred.

- [ ] **Step 5: Review the diff and record #544 as partially addressed**

  The prompt is still model-mediated, so do not claim a deterministic guarantee. Record #544 as partially addressed in the Orca handoff with the implemented prompt boundary and remaining limitation: model judgments can still be wrong; no static import proof was added. The tester ledger is outside this repository and remains unchanged for the tester to update.
