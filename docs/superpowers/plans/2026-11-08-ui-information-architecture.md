# UI Information Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make workspace scope, plan import, task filters, transcripts and evidence easy to find without pushing work off screen.

**Architecture:** Reuse the current App project state and control commands. Put a single switcher in the sidebar, a dialog for import, a compact progress toolbar with an optional task table, and a full-width expanded region per run. Preserve URL navigation and the existing evidence read/download routes.

**Tech Stack:** React, TypeScript, current Radix Select/Dialog, Vitest + Testing Library; no new component dependency unless existing primitives cannot meet keyboard/phone needs.

**Spec:** `docs/superpowers/specs/2026-11-08-ui-information-architecture-design.md` §7.

## Global Constraints

- The project's existing i18n for English, Chinese and pseudo-locale must remain complete.
- Do not change control routes, project state, import payload or refusal semantics.
- Existing tests with changed intended UI have a named `Ruling:` explanation beside the changed assertion.
- Test changed UI in a real browser after the affected test run.

## Review Focus

- All projects has no specific Settings identity: Task 1 test.
- Keyboard and narrow viewport access to switcher and its actions: Task 1 test and browser pass.
- Opening import from the Overview anchor and a failed import remains discoverable: Task 2 test.
- Running group's collapsed task list still exposes blocked tasks and filtering: Task 3 test.
- Transcript expand keeps columns fixed while evidence access remains visible within expanded run: Task 4 test and browser pass.

---

### Task 1: One workspace switcher

**Files:** Modify `web/src/ProjectControl.tsx`, `web/src/SettingsPage.tsx`, `web/src/App.tsx`, `web/src/Shell.tsx` only where focus/navigation requires; Test existing `web/tests/project*`, `web/tests/settings*` and a focused switcher test.

**Interfaces:** Preserve `chooseProject`, `chooseAll`, and project action props. `ProjectControl` exposes a stable focusable trigger id for Settings' link.

- [ ] Add a test: switching scope in the sidebar updates Settings; Settings link focuses the trigger; All projects shows an explanatory identity state; Add/Rename/Multi remain usable. Observe the new behavior fail.
- [ ] Turn the sidebar card into a labeled switcher and remove Settings' second select; show current project name/kind/root in Settings. Keep keyboard interaction and existing actions.
- [ ] Run focused Web tests and typecheck, recording full output.

### Task 2: Import on demand

**Files:** Modify `web/src/ControlPanel.tsx` and localized copy; Test `web/tests/*import*` and Overview navigation tests.

- [ ] Add failing tests for closed initial dialog, opening via button and Overview entry, preserving failed-form context, and submitting both library and in-repo plan.
- [ ] Put existing `ImportForm` in a dialog and make the Tasks header button its entry. Preserve current `#overview-control-import` focus route.
- [ ] Run focused tests and typecheck.

### Task 3: Progress toolbar and task list

**Files:** Modify `web/src/ControlGroupView.tsx` and localized copy; Test current progress filter and list tests.

- [ ] Add failing tests for visible graph, labeled filter control with selected count and clear action, and expandable task list even in a running group.
- [ ] Move the existing label checkbox state into a compact toolbar, collapse the task table by default only while running, and retain blocked-task discovery.
- [ ] Run focused tests and typecheck.

### Task 4: Full-width run details

**Files:** Modify `web/src/ControlGroupView.tsx`, `web/src/AgentTranscript.tsx`, localized copy, and affected face tests (`runsTableOrder`, `taskDetailTranscript`, `evidenceLink`, transcript window).

- [ ] Add failing tests showing one click opens latest recorded call, an expanded row spans all six columns, and evidence manifest/IDs remain accessible inside that row; preserve direct run anchors and inactive-region behavior.
- [ ] Move transcript and evidence into the expanded row; remove the evidence column and keep a stable table width and keyboard-operated disclosure.
- [ ] Run Web typecheck, affected Web tests, then a phone/desktop browser pass for all four tasks. Run `npm test` for affected root/Web scope and review changes.
