# Tester Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make split checks executable within task scope, remove stale next steps after completed reviews, and guide operators through common states and failures.

**Architecture:** Advance only the split prompt for check ownership; leave the validator's executable boundary as-is. Use existing group summary and navigation for CLI/Web review guidance. Add a handwritten workflow reference beside generated CLI command references.

**Tech Stack:** TypeScript, Vitest, React, Markdown skill.

**Spec:** `docs/superpowers/specs/2026-11-08-tester-followup-design.md`

## Global Constraints

- No migration or protocol key; do not change ordinary empty-result acceptance.
- Keep historical in-flight split envelopes frozen; new split instructions are version 5.
- Targeted tests must fail on old code for the intended behavior and pass on the change; then run `TMPDIR=/tmp npm test` per Orca Rule 18.
- No paid calls or release-only `npm run verify`.

## Review Focus

- A document-only task with a baseline-red repository test outside its writable scope: split guidance must assign the suite to a different capable task.
- A document-only task whose repository suite is already green: guidance must still permit keeping it green.
- A completed criteria review with default unlimited tokens: CLI may name the default but must not suggest estimate, confirm or reopen.
- A draft with a ready estimate: CLI still suggests apply/confirm.
- A failed or debugging criteria review in a parent group: Web must retain a path to the review group's evidence.

---

### Task 1: Split check ownership (#168)

**Files:** Modify `src/control/requirementSplit.ts`; add `tests/control/splitCheckOwnership.test.ts`; update version-only assertions in `tests/control/{requirementSplit,multiDirOverview,splitPromptV3,splitPromptRules130135,splitPromptRule136}.test.ts` and `tests/control/fixtures/requirementHarness.ts`.

**Interfaces:** Produces version-5 single/multi split prompts through existing `buildSplitPrompt`; no schema changes.

- [ ] Write a test that extracts both actual prompts, checks they direct document-only tasks away from baseline-red unrelated suite failures, permit a green repository suite, and bind checks to writable targets or completed dependencies. Its removal mutation is deleting the new rule from each prompt.
- [ ] Run `./node_modules/.bin/vitest run tests/control/splitCheckOwnership.test.ts` with output redirected, confirm the named rule assertion fails on current code.
- [ ] Add one shared rule in both prompt arrays; advance both version headers and live version-only assertions/fixture. Keep earlier v3/v4 comments as historical.
- [ ] Run targeted prompt and requirement tests, confirm passed and no skipped tests in the targeted files.

### Task 2: CLI completed-group next step (#179)

**Files:** Modify `src/commands/domains/verbs.ts` and (if needed) `src/commands/domains/reads.ts`; add cases to `tests/commands/unestimatedDefault.test.ts`.

**Interfaces:** Preserve `unestimatedLines(groupId, source, opts)` for callers; add summary state to the source and to `proposalDocument` only if needed by the proposal view formatter.

- [ ] Add a test with a completed judge view and a completed ordinary view asserting the default line remains but no pre-start action is printed by `group show` or `proposal show`; editable and confirmed-but-not-started cases remain unchanged.
- [ ] Run the test, confirm the currently printed `to estimate:` instruction makes it fail.
- [ ] Suppress the action on terminal summary state, carrying that state through proposal presentation when necessary.
- [ ] Run the CLI test file and affected group-show tests, verify green.

### Task 3: Parent review link (#179)

**Files:** Modify `web/src/ControlGroupView.tsx`, the existing group selection callback in `web/src/App.tsx` if needed, `web/src/locales/{en,zh}.ts`; add a focused component test in `web/tests/`.

**Interfaces:** Consume existing `summary.criteriaReviews` (taskId, debugGroupId, state, reason); invoke existing group navigation by id. No new server field.

- [ ] Add a component test rendering a parent with a failed/debugging criteria review, asserting state/reason visible and a click opens its review group; also assert an empty list gives no link.
- [ ] Run the component test and observe failure for the missing parent entry.
- [ ] Add a compact list in parent group detail and wire its button through the existing navigator; add en/zh copy.
- [ ] Run the focused component test and Web typecheck, verify green.

### Task 4: Guided operations (#157)

**Files:** Create `skills/orca-control/references/workflow.md`; modify `skills/orca-control/SKILL.md`; add narrow navigation assertions in `tests/entry/skill.test.ts` only where the tests catch a broken reference, not prose wording.

**Interfaces:** Link from SKILL.md to the handwritten workflow; generated `references/*.md` remain untouched.

- [ ] Add a failing entrypoint test for the workflow link that resolves to a real file and names the two entry paths; observe it fail on missing link.
- [ ] Write the short state/read/action and error/evidence/action tables, linking existing references and respecting optional estimate and human-only boundaries; link the file from SKILL.md while keeping its line limit.
- [ ] Run the skill tests and generated-doc drift check, verify green.

### Final gate

- [ ] Run `TMPDIR=/tmp npm test` and report its affected-file selection, skipped files, all failures by name, and typecheck; do not claim full release gate.
- [ ] Review the full diff independently and address verified serious findings with a failing regression test.
- [ ] Update the rolling handoff with current evidence; leave push to the human.
