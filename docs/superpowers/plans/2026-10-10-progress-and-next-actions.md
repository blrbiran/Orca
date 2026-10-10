# Project Progress and Next Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give people a progress-first home, an honest human-action queue, scoped settings and state-sensitive detail navigation.

**Architecture:** Add a read-only server projection and pure browser model; keep App ownership of caches, drafts and commands. Overview routes to existing owner/region, and settings compose existing controls under their actual scopes. Separate detail regions retain all valid controls and will consume the Results plan's views.

**Tech Stack:** TypeScript, Zod, node:sqlite, Express, React 19, existing i18next/Vitest; no new dependency.

**Spec:** `docs/superpowers/specs/2026-10-10-progress-and-next-actions-design.md` (effective §8 overrides prior wording).

## Global Constraints

- Overview is default for empty/unrecognized hash; valid deep links and reload/current selection survive. Layout B: progress before queue in DOM/mobile, side by side on wide screens.
- Queue navigates only; no ControlAction/POST, automatic confirm/start/retry or new notifications/scheduling.
- Task counts come from plan tasks; group goal review, explanation availability and Git delivery stay separate. Ready alone is not a start prerequisite.
- All/unresolved project settings need a concrete target; Agent defaults are shared panel-operator defaults, not per-login preferences. Existing frozen choices, permission guards and integer budgets remain.
- Todo refresh is independent of metrics/control seq, initial + 5000 ms only while Overview active, with source state and latest-request/auth/epoch/scope rejection.
- No new schema migration, dependencies, UI skin, paid provider or production runtime/data switch. Fixed ab824d1 package/lock and default regression remain.
- Use owned HOME/XDG/TMPDIR/CCMEM_DATA_ROOT, unset CCMEM_CONFIG_PATH, fake agents, absolute fixed-pin build. Web build precedes panel. Raw logs/RCs retained; mutations in clones only with working/cached diff 0.
- Implementer does not spawn agents; exact-path staging, no main merge/push/worktree deletion. Current human authorization replaces interim approval stops; controller records rulings and final audit.

## Review Focus

- Ready state with active or pending dispatch is progress, not human-ready: Task 1 predicate tests.
- Accepted requirement export issue navigates Requirements, its budget/start work navigates Tasks: Tasks 1/2 ownership tests.
- Unavailable metrics/todo, unchanged control revision and stale replies cannot hide or zero owed decisions: Task 2 independent source tests.
- All-project navigation/settings do not borrow another owner's draft/revision or reopen a late detail: Tasks 2/3 tests.
- Detail state changes preserve valid commands and focused region instead of hiding current controls or stealing focus: Task 4 tests.

## Execution order

Results Tasks 1/2 may run first while the unchanged Orca baseline finishes. Then run this plan Tasks 1–4 sequentially, followed by Results Tasks 3–5. Only one implementation agent runs at a time. Review each task before its successor; shared interfaces are fixed below.

### Task 1: Honest read-only overview projection

**Files:** Create `src/panel/controlOverview.ts`; modify `src/control/webProtocol.ts`, `src/panel/controlApi.ts`, `src/panel/controlViews.ts`, `web/src/controlTypes.ts`; tests `tests/panel/controlOverview.test.ts`, `tests/panel/controlOverviewApi.test.ts`, `tests/panel/webParity.test.ts`, `tests/panel/controlPollPerformance.test.ts` (add cases rather than weaken existing checks).

**Interfaces:** Consumes ControlStore, existing group summaries/GroupReadSnapshot, stored proposal/run/wake/integration/recovery facts. Produces `overviewSchema`, `OverviewV1`, `OverviewStepV1`, `OverviewDestinationV1` server/browser mirrors; `readControlOverview(store: ControlStore): OverviewV1`; authenticated read route `GET /api/control/overview`.

DTO is `{schema:'orca-control-overview-v1',epoch,changeSeq,groups:GroupSummaryV1[],steps:OverviewStepV1[],issues:OverviewIssueV1[]}`. Step fields: `key`, `groupId:string|null`, `repoId:string|null`, `taskId:string|null`, `runId:string|null`, `kind`, `reason:string`, `ownerRequired:boolean`, `destination`. Kinds and destination cases are exactly Spec §2; group destination has `region:'preparation'|'dispatch'|'problem'|'integration'|'results'`, taskId/runId nullable; requirement has `groupId` and `region:'answers'|'draft'|'problem'`; recovery has no guessed owner. Issue has group/repo nullable and reason. Stable keys use source identity. No model probes, awaits across read snapshots or per-task/run SQL.

- [ ] **Step 1: Write behavioral RED criteria.** New route is 200/read-only; awaiting-answers with zero questions produces an answer; accepted draft produces no split review; accepted export conflict belongs to requirement; editable proposal with queued/running estimate produces no budget step; idle confirmed ready produces start-review, while active/pending wake/stop/unknown/export-pending excludes it; failed/held/integration/recovery reasons preserve identities; archived omitted; corrupt group produces issue and healthy rows remain. Assert task completion uses plan tasks, not auxiliary rows. Snapshot DB before/after GET is equal; SQL read-counter delta does not grow per task/run; capability mock gets zero calls.

  Required predicate assertions on actual route bodies: `expect(body.steps.some(s => s.kind === 'start-review' && s.groupId === activeReadyId)).toBe(false)`; `expect(body.steps.some(s => s.kind === 'requirement-answer' && s.groupId === zeroQuestionId)).toBe(true)`; `expect(body.groups.find(g => g.groupId === planWithAuxiliaryWorkId)?.completion).toEqual({done:1,total:2})`; `expect(dbAfter).toEqual(dbBefore)`. Reuse and extend actual panel/control fixtures rather than asserting mock response values.
- [ ] **Step 2: Run the tests before implementation, save functional failing assertions.** `python3 /private/tmp/orca-progress-results-20261010/run.py p1-red node_modules/.bin/vitest run tests/panel/controlOverview.test.ts tests/panel/controlOverviewApi.test.ts --maxWorkers=2`. Missing route/predicate assertions must fail; fix test setup errors separately.
- [ ] **Step 3: Implement the named DTO/read projection and route.** Derive synchronous facts from actual stored authorities and existing snapshot decoding. Owner-required is explanatory, not authorization. Keep capability/profile runtime checks in existing commands.
- [ ] **Step 4: Run focused GREEN, root typecheck, parity/read-counter tests, and whole root suite before completion.** Add an independent clone mutation that labels active-ready as start-review and one that omits zero-question answers; both business criteria must go RED, then exact restore. Whole root suite uses fixed pin and redirected roots; failures remain named, no new waivers.
- [ ] **Step 5: Exact-path commit** `feat(panel): project honest progress and human steps` and report source/argv/RCs, TDD and mutation evidence.

### Task 2: Overview, independent sources and owner navigation

**Files:** Create `web/src/Overview.tsx`, `web/src/overviewModel.ts`, `web/src/overviewApi.ts`, `web/src/overviewNavigation.ts`; modify `web/src/App.tsx`, `web/src/sections.ts`, `web/src/Shell.tsx`, locales/styles, required existing detail region props; tests `web/tests/overviewModel.test.ts`, `web/tests/overviewApp.test.tsx`, `web/tests/overviewFreshness.test.tsx`, relevant `shell`/i18n expectations.

**Interfaces:** Consumes Task 1 OverviewV1 and existing todo/recovery/uncertain/project registry sources. Produces `fetchOverview():Promise<OverviewV1>`, `OverviewTarget` discriminated union (requirement/group/decision/global-control navigation), `deriveOverview(input:OverviewInputs):OverviewModel`, `<Overview model={...} onOpen={(target)=>...} onImport={...} onRequirement={...}/>`. `OverviewInputs` includes projection/source freshness, scope, unfiltered todo with independent state, recovery, uncertain commands, roles and registry mappings. App owns `openOverviewTarget(target: OverviewTarget):void`, `overviewFocus` and all callbacks. Region props/ids for downstream: `preparation`, `dispatch`, `problem`, `integration`, `results`; requirement `answers`, `draft`, `problem`. Decision target uses `(projectKey,id)`.

- [ ] **Step 1: Write RED criteria.** Empty hash opens Overview; all valid old hashes remain. DOM order progress before queue; normal running/dependencies absent from human queue. Distinct project+decision identities survive filtering. Todo changes without control seq are displayed within next 5000-ms successful refresh; metrics failure preserves todo/control; todo failure shows unavailable/stale rather than empty/count zero; late replies across epoch/scope/auth ignored; inactive timers stop. Queue navigation GETs the owning group/requirement and focuses requested region, zero POST, preserves All; removed owner gives reread/unavailable; older owner response does not reopen. Unresolved imports/global blockers remain visible. Current summary caches are not treated as full queue sources.
- [ ] **Step 2: Save RED via focused Web Vitest and TypeScript fixture checks.** New behavior assertions fail, not malformed fixture data. Name exact existing shell/hash expectations changed by human Overview decision.
- [ ] **Step 3: Implement pure model/view, bounded active source reads and App-owned navigation.** Current styling, compact progress facts, task/group state distinction. Refactor only the touched source loader/navigation responsibility out of App if needed. No browser-side command creation in Overview; keep all source errors explicit. Shell badge supports unavailable count rather than invented zero.
- [ ] **Step 4: Focused GREEN + full `npm run --workspace web check -- --maxWorkers=2`.** Run project-scope/drafts/recovery/uncertainty/confirm regressions. Clone mutants for decision freshness gating and wrong-owner navigation fail intended assertions; restore exact diff0. Browser real geometry is controller's final gate.
- [ ] **Step 5: Commit** `feat(web): add progress-first overview and owner navigation`, report exact expectation changes, tests and concerns.

### Task 3: Separate global and concrete-project settings

**Files:** Create `web/src/GlobalSettings.tsx`, `web/src/ProjectSettings.tsx`; modify `web/src/AuthGate.tsx`, `App.tsx`, `Shell.tsx`, `ControlPanel.tsx`, sections/locales/styles; tests `web/tests/settingsScopes.test.tsx`, `web/tests/globalSettingsAccounts.test.tsx`, current auth/agent/project-setting regressions.

**Interfaces:** Consumes App-owned theme/language, shared panel operator prefs/drafts, account context/callbacks and repository settings readers. Produces global/project-settings sections and components composed from existing controls. AuthGate owns credential/session transition, exposes an account settings surface/context callback rather than duplicating password/auth logic. ProjectSettings receives an explicit target and scoped workspace/integration values, never implicit previous repo defaults. Existing Controls/command callbacks remain in App.

- [ ] **Step 1: RED criteria.** Global settings show theme/language/account + shared panel Agent defaults; project settings show workspace/integration only for concrete target; All/unresolved requires selection. Global preference POST keeps returned operatorId/revision; project save uses chosen repo/revision; default save does not rewrite frozen group agents/skills/integration. Import remains an operation and project picker visible. Owner/member account controls retain permission; successful password change returns to login under existing all-session invalidation; security notices remain globally visible. Settings are separate navigation entries.
- [ ] **Step 2: Run RED and inspect exact expected failures.** Preserve old auth form/refusal assertions; authorized movement of Menu/theme controls is recorded, not a relaxed permission test.
- [ ] **Step 3: Compose settings with existing actual scopes and handlers.** Preserve shared panel scope, unsigned draft ownership, CSRF, password handling and role guards. Avoid duplicate mounted AddUser/password forms and duplicate notice reads. Do not change backend authorization or setting semantics.
- [ ] **Step 4: GREEN + full Web check and relevant root member/permission/parity criteria.** Clone mutations for implicit-All target and frozen-choice rewrite go RED; restore diff0. Verify account frame remains common viewport and settings text does not overflow.
- [ ] **Step 5: Commit** `feat(web): separate global and project settings`, report scope/permission/credential transition evidence.

### Task 4: State-sensitive detail regions without losing valid controls

**Files:** Create `web/src/GroupDetailRegions.tsx`, `web/src/detailRegion.ts`; modify `ControlGroupView.tsx`, `TaskDetail.tsx`, `RequirementsPanel.tsx`, `App.tsx`, locales/styles; tests `web/tests/detailRegions.test.tsx`, `web/tests/detailNavigation.test.tsx`, existing stop/retry/budget/skills/archive/member criteria.

**Interfaces:** Consumes Task 2 focus target and existing GroupView/task data/eligibility helpers. Produces `DetailRegion` (`progress`,`preparation`,`problem`,`results`,`runs`,`technical`), `<GroupDetailRegions initialRegion focus ...>` and stable region ids; existing `dispatch` maps to problem/preparation subregion based on target, `integration` maps to its retained region. Selected region stays stable during polling. Results region initially renders a labelled missing/not-produced placeholder + existing evidence access, to be replaced by Results Task 5.

- [ ] **Step 1: RED criteria.** Draft defaults preparation, active progress, explicit attention target problem, completed Results even missing. Progress navigation opens progress; queue opens requested owner/task/region. Poll/state changes keep selected region/focus/drafts. A group with active and failed tasks shows both facts. Every currently valid start/pause/handoff/resume/continue/retry/recovery/integration/settlement/archive action remains reachable under current role and guard, with archived read-only behavior unchanged. Technical/log sections are accessible without dominating initial view.
- [ ] **Step 2: Run RED, preserving functional controls in current guard fixtures.** Missing-default/focus assertions fail. No broad state rule substitutes for server/UI eligibility.
- [ ] **Step 3: Implement region composition and small state/default selector.** Move rendering by responsibility, not command logic. Keep all existing callbacks and diagnostic/evidence access. No fabricated percentage, duration or delivered state.
- [ ] **Step 4: GREEN + full Web check and relevant root stop/retry/handoff/permissions gates.** Independent mutants for poll tab reset and archived edit visibility fail criteria, exact restore. Record any human-authorized existing presentation expectation update.
- [ ] **Step 5: Commit** `feat(web): organize detail by state and focused action`, report availability/focus regressions.

## Controller close

After both plans: final source proof, root/full Web/build/typecheck, panel after web build, pin, leak and browser desktop/390px/short-height checks, cross-plan independent whole-branch review and fixes. Preserve raw failures and warnings, commit ledgers/evidence, update three live handoffs and chat-only executive summary. No main merge/push/runtime switch in this round.
