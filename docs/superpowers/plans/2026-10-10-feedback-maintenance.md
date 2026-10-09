# Feedback Maintenance Implementation Plan

> Execute inline under superpowers:executing-plans. Human authorized continuous execution and final review only; no brainstorming in this round.

**Goal:** Fix narrow existing-panel usability defects and explain the current operating contract from the October 8 feedback.
**Architecture:** Preserve server authority, schema 10, agent capabilities, admission and confirmation. Reuse existing archive commands and evidence downloads. No provider calls or runtime deployment.
**Spec:** Human requests in this session; existing issue-fixes design sections 3, 6 and N1 requirement views. New behavior needing brainstorming is deferred.
**Tech Stack:** React, TypeScript, i18next, Vitest.

## Constraints and Review Focus
- Fixed ccloop ab824d1 clone build; isolated HOME/XDG/ccmem/config; panel tests after web build.
- Existing historical specs/SDD evidence append-only. No automatic budget confirmation, SQL repairs, force start, deletion or push.
- Unknown installation kinds/defaults must remain server-resolved; only explicit codex selection is blocked ahead of unsupported single-call.
- Archive availability cannot promise success while calls/stops are pending; archived requirement controls must be read-only and reversible by unarchive.
- Activity uses sequence chronology on the latest returned window, not earliest historical LIMIT rows; do not mutate response arrays.
- Compact display must preserve exact counts and diagnostics on demand and all commands/revisions.
- Sidebar must fit below variable-height account content and remain usable on short/narrow screens.

### Task 1: Sidebar viewport fix (issue 20)
Files: web/src/styles.css, web/src/AuthGate.tsx if necessary; web/tests/styles.test.ts.
- [x] Reproduce overflow with account bar plus sidebar viewport height; write criterion, observe RED.
- [x] Use a viewport-height authenticated flex frame and internal scroll; no fixed header-height assumption.
- [x] Verify focused tests and attempt real browser geometry, including short/mobile viewport; if policy blocks it, record the visual acceptance limitation without a workaround.

### Task 2: Requirement capability and archive affordances (issues 4, 17; 33 documentation)
Files: web/src/RequirementsPanel.tsx, web/src/locales/en.ts, zh.ts; web/tests/feedbackRequirements.test.tsx.
- [x] Test explicit custom-id codex refusal before command, claude allow, unknown/default allow.
- [x] Test idle failed requirement archive command at current revision, pending call/stop suppression, archived read-only detail and unarchive.
- [x] Observe RED, implement existing commands and bilingual explanation, verify all requirement tests.

### Task 3: Runs/activity readability (issues 25, 36, 37)
Files: web/src/TaskDetail.tsx, ControlGroupView.tsx, TokenInput.tsx, locales; tests/taskActivity.test.tsx, feedbackReadability.test.tsx.
- [x] Test chronology, compact units in both languages, exact title values, diagnostic detail disclosure, evidence action retention.
- [x] Observe RED, reverse only the displayed newest window, compact read amounts, keep exact editable values and evidence API unchanged.
- [x] Verify focused and full web suites; named existing chronology assertions revised with explicit ruling.

### Task 4: Terminology and operating guides (issues 2, 5/21, 9, 11–14, 23)
Files: web/src/locales/zh.ts, README.md, skills/orca-control/SKILL.md.
- [x] Explain CLI-version refresh via draft review/backups, default versus group slots, Codex single-call limits, confirm then start, stop/resume and failed-task retry, evidence inspection.
- [x] Replace ambiguous Chinese epoch/projection/dispatch/Git wording with precise language. Preserve symbols and reason codes.
- [x] Use skill-creator for skill editing, preserve all route/authority rules; verify documentation examples against actual schemas and full locale tests.

### Task 5: Review, verification and handoff
- [x] Build root/web, typecheck, web suite, root suite, pin/panel/control and scoped leak checks. Preserve every raw failure and honest limitations.
- [x] Independent final branch review; address important findings, prove guard deletions RED in a separate local clone; record no changed dependency pin.
- [x] Update Orca current entry and replace sibling Orca rolling sections in place. Record explicit ccmem integration authorization without inferring runtime migration.
- [x] Commit exact files on feature branch; no main merge or push. Supply <=10-line executive summary in chat only.

## Deferred
19/30 overview restructure; 24 new result-summary/report mechanism; 6/27–29 settings aggregation; 18 context menu; 26 cross-group autonomy/Chains redesign; 31 broader state layouts; 32 new notifications; 34 wizard; 35 visual redesign; automatic drift probing. Existing 1/3/7/8/10/16 and D9/M3/M5/M6 are closed.
