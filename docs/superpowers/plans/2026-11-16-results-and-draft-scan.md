# Results and Draft Scanning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the current split and real delivery status first while preserving past run evidence.

**Architecture:** Sort only presentation copies of drafts and use native details disclosures around existing content. Move the existing integration region before group result details and fold long per-run listings; no server schema or persistence change.

**Tech Stack:** React, TypeScript, i18next, Vitest/jsdom.

**Spec:** `docs/superpowers/specs/2026-11-16-results-and-draft-scan-design.md`.

## Global Constraints

- Follow `web/DESIGN.md`: existing colors/fonts/type scale and one primary action per view.
- Do not alter persisted draft order, hash, integration trigger, or run evidence.
- A single draft, one task or one run stays open; keep failures and the integration action visible.
- Use existing Web component tests and Web typecheck/build, then the Orca daily affected-test gate. `npm run verify` is for a tagged release only.

## Review Focus

- Old accepted drafts remain inspectable and carry their accepted state (Task 1).
- Polling the same drafts does not close a person-opened disclosure (Task 1).
- A blocked integration still shows Retry/Resolve before long task details (Task 2).
- A single task/run keeps the current visible evidence; multi-task evidence is still keyboard accessible (Task 2).
- Missing workspace path and absent per-event timestamps are not fabricated (Task 2).

---

### Task 1: Latest split draft first (#324)

**Files:** `web/src/RequirementsPanel.tsx`, `web/src/locales/{en,zh}.ts` if task-count copy is needed; test `web/tests/requirementsReadability.test.tsx`.

**Interfaces:** `DraftReview` accepts a presentation-only `current:boolean`; the view keeps its original `drafts` array.

- [x] Add two-draft and one-draft UI criteria; check newest order, default disclosure state, historic task table after expansion and accepted state. Saw ascending-order and missing-disclosure behavior RED.
- [x] Render a descending copy of drafts with older details closed and accessible summaries; `requirementsReadability` 24/24 and Web typecheck GREEN.

### Task 2: Delivery before evidence (#319)

**Files:** `web/src/ControlGroupView.tsx`, `web/src/GitScheme.tsx`, `web/src/GroupResults.tsx` and needed locale keys; tests `web/tests/groupResults.test.tsx` and `web/tests/gitScheme.test.tsx`.

**Interfaces:** The existing integration `overviewRegionId` remains in Results, now before the group results. Only presentation disclosure state changes.

- [x] Add DOM-order and multi-run/multi-task disclosure criteria; each went RED on the old layout. Kept keep/conflict actions.
- [x] Move the integration region to the front and fold long evidence; reviewer found a hidden later failed verification, its test went RED then GREEN with failed evidence expanded. Neighboring 7 Web files 147/147, Web typecheck/build RC0.

### Task 3: Integration and honesty

- [x] Run Orca's daily affected-test gate with `node scripts/test-affected.mjs --base=origin/main` on the final tree: 166 root files / 1,116 tests passed, 247 Web files / 2,025 tests passed, 0 skipped, RC0; both typechecks RC0. This is relative to the published core commit.
- [x] Independent React/TypeScript review; fixed both Important findings with named RED→GREEN criteria.
- [ ] Update the bounded handoff sections after integration.
