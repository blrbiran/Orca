# Tester Blockers and UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make existing work stoppages recoverable and make the panel describe its actual state accurately.

**Architecture:** Keep server-side eligibility and the existing strict wire schemas authoritative. Change the producers of incorrect state first, then the Web projections and presentation. Preserve previously accepted work and per-project draft ownership.

**Tech Stack:** TypeScript, Node.js, Express, React, Vitest.

**Spec:** `orca_archived_files/issue-20261023.md` issues #201, #205, #209, #211, #216–#221; Orca `docs/handoff/goal.md` P2/P4/P6. The user selected these confirmed blockers/UI issues for this session.

## Global Constraints

- GitHub ccloop dependency must pin pushed main; use `ORCA_CCLOOP_BIN=/Users/biran/code/skills/orca/ccloop/dist/cli.js` for Orca paired tests after ccloop build, without rebuilding it during those tests.
- Orca daily gate is `npm test` and its typecheck; `npm run verify` is release only. Run focused tests red then green before the daily gate.
- Use relocated temp roots for any panel test; leave `~/.orca` untouched. No paid provider invocation without an explicit bounded scenario and existing session authorization.
- Existing published specs and `.superpowers/sdd/**` are immutable; add named corrections where relevant.

## Review Focus

- A missing project alongside a valid project must not disable the valid one; an unavailable project must never become an executable target.
- A closed run after top-up must retry only with verified settlement and no double release.
- A group-level unknown usage warning must remain visible if no active unknown run explains it.
- A paused group with a real blocker must still demand attention even when a plain manual pause becomes neutral.
- Section changes must not submit hidden controls or lose an unsent requirement draft.

---

### Task 1: Repin the released runner

**Files:** `package.json`, `package-lock.json`.

**Interfaces:** Existing `scripts/pin-ccloop.mjs` performs six checks; no new API.

- [x] Confirm pushed ccloop HEAD and clean Orca branch; run `node scripts/pin-ccloop.mjs <pushed-full-sha>` and inspect full check log.
- [ ] Run `npm ci`, then run the paired saved-result and zero-usage controls with the built ccloop checkout; inspect test counts and skip reasons.

### Task 2: Keep the panel running with stale project paths (#201)

**Files:** `src/panel/controlAssembly.ts`, existing panel startup/registry tests.

**Interfaces:** Unavailable registry entries remain identifiable in project listing, but `TrustedControlConfig` only accepts currently valid paths. Do not broaden its trusted path validation.

- [ ] Add a startup test with one valid and one missing project: panel serves the valid project and refuses the missing project as a target; also cover a missing plan path and a restored path on restart.
- [ ] Run the targeted test and observe the current startup exception.
- [ ] Exclude only unavailable paths at the registry-to-trusted-config boundary, surface an explicit diagnostic, then rerun targeted tests.

### Task 3: Reject a requirement that cannot make its first call (#211)

**Files:** `src/control/requirementCommands.ts`, `tests/control/driverRequirementClarify.test.ts`, requirement open route/CLI tests.

**Interfaces:** Keep `REQUIREMENT_CALL_GRANT` as the single-call minimum; reject a newly opened limit with any dimension below that grant before inserting a group. Retain the claim-time guard for a previously funded group that later runs short.

- [ ] Test a 600k token open is rejected with an actionable minimum and leaves no group; test exact minimum is accepted; keep a separate claim-time exhaustion case.
- [ ] Run the focused test to see the incorrect successful open, implement validation, rerun.

### Task 4: Retry a closed topped-up run (#205)

**Files:** `src/control/retryTask.ts`, `tests/control/retryTopUp.test.ts`, `tests/control/terminalRunClosure.test.ts`.

**Interfaces:** Use verified terminal closure and the actual funded run to decide retry eligibility; the optional-policy branch already derives inherited use and top-ups. Do not relax finite-legacy or unknown-use checks.

- [ ] Add a lineage test with initial run, top-up, second funded run, closure and another retry; assert correct remaining grant and no double accounting; add a forged-closure rejection.
- [ ] Verify the existing `run-state:settled-failed` failure, fix the closed-run admission predicate, rerun.

### Task 5: Name unavailable worker models (#209)

**Files:** `src/control/agentFreeze.ts`/`agentSelection.ts`, appropriate agent-selection tests.

**Interfaces:** Reuse the catalog observation already used for estimator compatibility; reject an unavailable worker model before dispatch with a catalog-specific reason. Do not infer that a provider 429 always means an invalid model.

- [ ] Test a missing worker default model and a valid explicit model with one controlled catalog; see the invalid default reach dispatch before changing code.
- [ ] Add the narrow catalog check, rerun both and the existing estimator selection tests.

### Task 6: Match Overview and Tasks recovery meaning (#216)

**Files:** `src/panel/controlOverview.ts`, `web/src/overviewModel.ts`, `web/src/Overview.tsx`, `web/src/RecoveryView.tsx`, corresponding panel/Web tests.

**Interfaces:** An active run's unknown usage owns the actionable row. Retain a group-only unknown if no active run explains it; distinguish recovery blockers from usage/settlement issues instead of claiming the two sets are equal.

- [ ] Add producer-shaped group+run fixture and verify duplicate and contradictory empty states; test group-only fallback and two distinct runs.
- [ ] Run red; fix producer/labels/navigation while preserving distinct real blockers; run green.

### Task 7: Make Board and list status truthful (#217/#218)

**Files:** `web/src/BoardView.tsx`, `web/src/groupCategory.ts`, `web/src/GroupList.tsx`, `web/src/locales/{en,zh}.ts`, Board/group-category tests.

**Interfaces:** Escalation result is separate from the originating failure cause. A plain pause is neutral; blocked tasks, recovery blockers, persistent refusals, and in-progress stop still demand attention.

- [ ] Add tests for provider rate-limit plus failed debug and for paused-only versus paused-with-blocker; observe wrong labels/column.
- [ ] Make text and category changes; rerun Web tests including drag/resume behavior.

### Task 8: Remove hidden-page controls from the DOM (#219)

**Files:** `web/src/App.tsx`, `web/src/Shell.tsx`, `web/src/SettingsPage.tsx` as needed, App navigation/draft tests.

**Interfaces:** App retains unsent drafts by owner while only the current pane and settings category render controls.

- [ ] Test navigation from Requirements to Overview and Settings: hidden forms and duplicate idea text disappear, returning restores draft and focus; check existing routes.
- [ ] Run red; conditionally render page contents while keeping required route containers/focus targets; rerun.

### Task 9: Choose the model where a requirement starts (#220/#221)

**Files:** `web/src/RequirementsPanel.tsx`, `web/src/detailDrafts.ts`, `web/src/AgentSettings.tsx`, related Web tests and localizations.

**Interfaces:** Reuse the existing partial agent selection wire and model catalog; an explicit choice is sent only for the chosen installation. Agent settings initially reveal model controls, while still honoring an explicit saved collapse.

- [ ] Test model selection and missing-default repair in the requirement form; test first-open Agent settings and persisted collapse. Observe the original failure.
- [ ] Implement the UI against the current catalog and selection fields, then rerun targeted tests and daily `TMPDIR=/tmp ORCA_CCLOOP_BIN=<built checkout> npm test`.

### Task 10: Verify and integrate

**Files:** Rolling `docs/handoff/handoff.md`; only code/test paths actually affected.

- [ ] Run `npm test` and typecheck on the branch, inspect the entire redirected result and classify every failure/skip. Run any authorized focused paid scenario only after deterministic paired checks are green, with an explicit run count and spend evidence.
- [ ] Independent TypeScript/React review; fix verified findings and rerun affected checks.
- [ ] Show diff; commit coherent changes on branch; fast-forward merge to local main if clean, then re-check local and remote with `ls-remote`. Do not push.
