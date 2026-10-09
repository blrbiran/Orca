# Pre-flight consistency scan — plan 2026-10-08 issue fixes

Written by a read-only scan subagent of Orca session e34dc963, 2026-10-08, on branch `fix/issues-20261008` at commit
`29f4f47` (`docs(plan): task-by-task plan for the 2026-10-08 issue fixes, in six parts`). Inputs: the plan index, parts
A–F (Controller amendments read as binding), the spec, and `progress.md` rulings. Repository facts below were measured at
`29f4f47` with the command named beside each.

Repository facts used:

- `tests/control/fixtures/driverHarness.ts` (`sed -n 1,80p`): `driverHarness` confirms the group and does **not** start or
  claim; a claim happens only through `t.claim()`.
- `tests/entry/skill.test.ts` (`grep -n -E "toBe\(29\)|routes.size|verbs.size|rows.length"`): lines 45, 51, 63 are `29`;
  routes are counted by the regex `path: "/api/control/..."` (so Part B's `app.get(...)` activity route is not counted).
  The comment at line 41 says "29 routes carry the 30 verbs".
- `commandVerbSchema` (`sed -n '/export const commandVerbSchema/,/\]);/p' src/control/webProtocol.ts`): 30 verbs; 7
  non-group (`shutdown`, `set-workspace-mode`, `set-agent-preferences`, `set-spend-cap`, `clear-spend-cap`,
  `set-usage-calendar`, `set-integration-scheme`) — E4's `NOT_GROUP` matches; after D and E the group verbs number 25.
- `web/src/ControlGroupView.tsx` lines 101-146: `h2`, claim-blocked, spend-cap line, plan line, old stop `<p>`,
  BudgetEditor, AgentSelectionEditor, `h3 Work items`, `DependencyGraph` (its only caller).
- `src/panel/controlViews.ts:493` `STEP_OF` maps ccloop's raw `status` (`executing`) to the panel step (`execute`);
  `web/src/i18n.ts:89` `enumText` falls back to the raw value for an unknown key.
- `tests/control/fixtures/driverPort.ts:80` `const variant = input.behaviour(...)` exists (D2's replacement compiles).
- `src/control/stopIntent.ts:146,154` export `commandSuccess` and `readGroupBody`.
- No top-level `refusal` key exists in `web/src/locales/en.ts` (A4's new subtree does not collide).

## 1. Cross-task pairs (same file or interface)

| # | Producer → consumer | File / symbol | Produced | Consumed | Agree? |
|---|---|---|---|---|---|
| 1 | B3 → C2, D3, E3 | `src/control/activity.ts` `recordActivity`, `readGroupActivity`, `readRunActivity`, `latestGroupActivityAt`, kinds | 13 kinds incl. `stop-cleared`, `task-retried`, `archived`, `unarchived`; must run in a transaction | C2 (inside `store.transaction`), D3 (inside `applyWebCommand`), E3 (inside `applyWebCommand`) | yes |
| 2 | B4 → D3 (amendment) | `RUN_ENDED_STATES`, `noteRunWrite` in `saveRunBody` | `run-settled {state,outcome,stopReason?}` + `endedAt` on state change | D3 test expects exactly that row and `endedAt`; amendment says D adds `"settled-failed"` | shape yes; **no D task lists `activity.ts`** → conflict 2 |
| 3 | B9 → C1 | `applyPanelShutdown` stop rows / `shutdownGroup` dispositions | B9 test shuts down an **idle** harness group and expects one `shutdown` row | C1 makes an idle group `unchanged-idle` (no intent, so no row) | **no** → conflict 1 |
| 4 | B9 ↔ C1 | B9 row condition `created \|\| strengthened-pause` | — | C1 adds `unchanged-idle` | yes (writes none for it) |
| 5 | B7 → D3, E3, E4 | `command` row in `applyWebCommand` (success, group scope) | group-target rows have `runId` null | D3 reads run activity (not polluted); E3 uses `toContain`; E4 refusals book no row | yes |
| 6 | B11 → D2 | `runViewSchema` / web `RunViewV1` | `startedAt/endedAt/lastActivityAt` after `skills` | D2 adds `stopReason/outcome` after `blockedReason` | yes (disjoint anchors) |
| 7 | B11 → E9 | `RunViewV1.startedAt`, `lastActivityAt` | optional, nullable | E9 `nodeLines` uses `!= null` | yes |
| 8 | B11 → E11 | route + web `RunActivityV1`, `ActivityEntryV1`, `fetchRunActivity` | B11 already adds `fetchRunActivity` and type `RunActivityV1` | E11 Step 3 adds `fetchRunActivity` again with type `RunActivityViewV1` | **no** (amendment renames; text still duplicates) → conflict 6 |
| 9 | B6 → E11 | `phase` row body `step` | raw ccloop status (`executing`; ruling B6) | E11 test feeds `execute` and renders via `enumText("progressStep")` | **no** → conflict 7 |
| 10 | B11 → E11 | `ActivityKindV1` | 13 kinds | E11 `enums.activityKind satisfies Record<ActivityEntryV1["kind"], string>` | yes |
| 11 | B1/B2 → C2 (amendment) | v8 store + migration | `schema8To9` `IF NOT EXISTS`, allowlist accepts `"8"` | C2 v8 criterion builds a v8 store and opens it normally | yes (build it as B2's `version8Store`: drop `activity`, meta `8`) |
| 12 | A3 → C/D/E | `enErrors`/`zhErrors` key-set equality, en text never contains its code, no `{{message}}` in en | — | D4 `task-not-retryable`, D5 `run-terminal-failed`, D8 codex reasons, E3 five archive codes: all added to both locales, use `{{detail}}`, none contains its code | yes |
| 13 | A3 → D8 | `"terminal"` entry | A3 writes it verbatim (en + zh) | D8 lists `"terminal"` again, guarded by "keep Part A's if present" | yes if the guard is honoured (else TS1117 duplicate key) — conflict 11 |
| 14 | A3 → D8 | coverage list `VIEW_REASONS` ("Part D adds ccloop's stop reasons here") | — | D8 puts them in a new `web/tests/failureReasons.test.ts` instead | **partial** → conflict 10 |
| 15 | A4 → D8, E11 | `explainRunReason(reason)` (no `Error: ` stripping) | — | D8 `explainRunReason(reasonCode(raw))` (ruling D1); E11 `explainRunReason(body.reason)` without `reasonCode` | D8 yes; **E11 no** → conflict 8 |
| 16 | A5 → A6, D8, E10 | `ControlClientState.refusals/importRefusal/panelRefusal`; `place` per verb | `import-plan` → import, every other verb → group | `retry-task`, `archive-group`, `unarchive-group` go through `sendControl` → group | yes |
| 17 | A6 / C3 / D8 / E9 / E10 | `web/src/ControlGroupView.tsx` | A6: `RefusalNotice` after claim-blocked. C3: stop banner after A6's notice; deletes old stop `<p>`; Start only with no stop. D8: runs-table buttons. E9: graph gets `runs`, `now`. E10: archived banner above graph, graph above `h3`, Budget/Agents moved before `GitScheme`, dispatch wrapped in `!archived` | A6 test: notice precedes Pause and Budget (still true after E10). C3 test: `h2.nextElementSibling === banner` (true: claim-blocked and notice render null in its fixtures). E10 test: graph < Work items < Runs < Budget | no reordering conflict; **E10 archived banner sits after spend-cap and plan line, not with the alerts** (spec §6.5) and E10's anchor "directly after the stop line" is stale after C3 → conflict 13 |
| 18 | A6 / E8 | `web/src/ControlPanel.tsx` | A6 edits `ImportForm`, the `ControlGroupView` element | E8 replaces the `<nav>` block and adds `now` | yes (disjoint); A6's `openGroup` finds `^g1 · ` — E8's card keeps that accessible name |
| 19 | D3 → E4 | verb `retry-task` / `WebControlService.retryTask` | group target, payload `{taskId}` | E4 `CALLS["retry-task"]` | yes |
| 20 | D3 → E6 | `tests/entry/skill.test.ts` counts | 29→30, comment "30 routes carry the 31 verbs" | E6 30→32 | counts yes; **E6 leaves the comment's numbers at 30/31** → conflict 14 |
| 21 | C1 / D2 / D3 / E3 | `src/control/webProtocol.ts` enums | `unchanged-idle`; `settled-failed`; verb `retry-task` + result `task-retried`; verbs `archive-group`/`unarchive-group` + results | parity via `tests/panel/webParity.test.ts` compile-time half and web `controlTypes.ts` mirrors | yes |
| 22 | B11 / D3 / E2 | `tests/panel/webParity.test.ts` | B11 run-activity pair; D3 retry-task pair; E2 runtime `WEB_WORK_ITEM_CATEGORIES` case | — | yes (additive) |
| 23 | D3 / E3 | `src/panel/controlApi.ts` routes + switch, `src/panel/humanOnly.ts` | `retry-task` `any`; `archive-group`/`unarchive-group` `any` | E3 permissions assertion | yes |
| 24 | D8 / E10 | `web/src/controlApi.ts` `ControlAction`, `controlCommandPath` | `retry-task` → `groups/<g>/retry-task` | `archive-group`/`unarchive-group` → `/archive`, `/unarchive` | yes |
| 25 | D6 → E9 | run number rule | `taskRunNumber(view, taskId)` in `web/src/runFacts.ts` | E9 writes its own `runNumber(item, runs)` with the same rule | **duplicate logic** → conflict 9 |
| 26 | D8 → E11 | `web/src/TaskDetail.tsx` runs block | `<h5>runsOf</h5>` kept, run-number `<p>`, `RunReason`, Retry task | E11 inserts `RunActivity` before the `<h5>` anchor | yes |
| 27 | D2/D3 → E1/E2 | run state `settled-failed`, work `ready` with `currentRunId` on it | — | `categoryOf`: run not `blocked` ⇒ `idle`/`waiting` | yes |
| 28 | E2 → E3/E4/E5 | `src/control/archivedMark.ts` | `archivedMarkOf`, `isGroupArchived` | ledger gate, dispatch, integration pass | yes |
| 29 | C3 (amendment) → existing web tests | `Continue task` buttons only with no stop intent | — | C3 text still says `handoffResume`/`controlI18n`/`controlPanel` "stay green" | **text vs amendment** → conflict 12 |
| 30 | B (ruling flag 10) → B8, B10 | pinning tests for `if (resumedDriverRun)` and the `transient` guard | ruling: "get pinning tests in their tasks" | B8/B10 Step 5 still say "record as unpinned", no test code | **no** → conflict 4 |
| 31 | E amendment / ruling E2 → E5 | `claimEstimate` and `requirement-export` wake skip archived | amendment: tests + code | E5 text, Files and `git add` omit them; flagged point 2 says "Not changed" | **no** → conflict 5 |
| 32 | A amendment → A1, A3, A4 | non-ASCII task id; English fallback criterion | amendment | A1/A4 test code still uses `a`; A3 fallback test checks message only, not "next to the raw code" | text vs amendment (planFile `taskId` is `z.string().min(1)`, so `任务a` reaches stage 2: feasible) → conflict 15 |

## 2. Per-task self-consistency

| Task | Tests vs code / files | Verdict |
|---|---|---|
| A1 | Test and code agree. Step 4 leaves `requirementSplit.test.ts` knowingly red until A2 commits | minor (conflict 16) |
| A2 | agrees | ok |
| A3 | agrees; Files list complete | ok |
| A4 | agrees | ok |
| A5 | agrees; every `type: "refusal"` site gets `place` (compile-enforced) | ok |
| A6 | agrees | ok |
| A7 | agrees (throwaway script in scratchpad) | ok |
| B1 | agrees | ok |
| B2 | test 3 "refuses a version-10 store" passes before and no Step 5 mutation turns it red | minor (conflict 17) |
| B3 | agrees; 4 mutations each named | ok |
| B4 | agrees | ok |
| B5 | agrees | ok |
| B6 | agrees (raw `step`, per ruling) | ok |
| B7 | agrees | ok |
| B8 | agrees with itself; contradicts ruling flag 10 | conflict 4 |
| B9 | agrees with itself; its shutdown test is broken by C1 | conflict 1 |
| B10 | agrees with itself; contradicts ruling flag 10 | conflict 4 |
| B11 | agrees | ok |
| C1 | agrees; its Step 4 run list omits `tests/control/activityRuns.test.ts` (B9) | conflict 1 |
| C2 | agrees; amendment adds the v8 criterion with no code given | conflict 3 |
| C3 | text says the three web tests "stay green"; amendment requires rewriting them | conflict 12 |
| C4 | agrees | ok |
| D1, D2 | agree | ok |
| D3 | code block still sets `endedAt` and writes `run-settled` (amendment deletes both); mutations (e)/(f) replaced by amendment; the `RUN_ENDED_STATES` edit has no file entry, no `git add` path | conflict 2 |
| D4, D5, D6, D7 | agree | ok |
| D8 | agrees; `"terminal"` duplicate guarded | conflict 11 (minor) |
| D9, D10 | agree | ok |
| E1, E2 | agree | ok |
| E3 | agrees; leaves `skill.test.ts` red until E6 (stated) | conflict 16 |
| E4 | agrees; prose "27 refusal cases" — the `it.each` has 25 cases (+2 other tests = 27 tests) | minor (conflict 18) |
| E5 | agrees with itself; lacks the amendment's two paths | conflict 5 |
| E6 | comment numbers not updated | conflict 14 |
| E7, E8 | agree | ok |
| E9 | agrees; duplicates D6's rule | conflict 9 |
| E10 | agrees; stale anchor; banner position | conflict 13 |
| E11 | duplicate `fetchRunActivity`; raw `step` mismatch; no `reasonCode` | conflicts 6, 7, 8 |
| F1–F3 | agree; F1 waits on the human | ok |

## 3. What a reviewer would call a defect

| Where | Shape | Note |
|---|---|---|
| D3, D4, D7 `expect(netOf(...).tokens).toBe(10)`; D4 `expect(before.explicitUnallocatedReserve.tokens).toBe(0)`; D7 `expect(existsSync(workspacePath)).toBe(true)`; E3 `expect(groupStopState(...)).toBe("handoff-complete")`; E5 `expect(wakes).toHaveLength(1)` | assertion placed before the call under test, reading back the state the test itself just set up (Rule 9 inference 2) | harmless as preconditions; must not be counted as criteria (conflict 19) |
| B2 test 3 | criterion never seen red | conflict 17 |
| E9 `runNumber` vs D6 `taskRunNumber` | duplicated logic | conflict 9 |
| E3 `success()` and `groupBody()` | duplicate `commandSuccess` / `readGroupBody` already exported by `src/control/stopIntent.ts` (D3 imports both) | conflict 20 |
| A1→A2, E3→E6 | commits that land a knowingly red test | conflict 16 |
| C2 explicit `recordProjectionChange` | equivalent mutant | stated in C2 and ruled (Part C flag 6) — no action |
| D2 `STOPPED_STATES`, D3 `cleanedUp=false` | unpinnable lines | ruled (Part D flags 5/6) — no action |

## 4. Conflicts

Severity: **blocking** = executing the text as written leaves a red test or an uncommitted/missing change; **minor** =
wording, duplication, or a gap an executor would most likely resolve, but should be told.

1. **[blocking] B9 ↔ C1 — `tests/control/activityRuns.test.ts` "a shutdown that creates a group's intent writes a
   shutdown row; one that preserves it writes none".** B9 shuts down a `driverHarness` group that was never claimed
   (the harness only confirms), expecting `[[9000, {mode:"shutdown"}]]`. C1 makes such an idle group `unchanged-idle`
   (spec §3.2(1), invariant S1), so no intent and no row: the test goes red at C1, and C1's Step 4 run list does not
   include that file. **Resolution (smallest, spec-true):** in B9's test, `await t.claim();` before the first shutdown
   (a group with an active run is frozen `created`, the second shutdown `preserved-shutdown`) — correct both before and
   after C1. Add `tests/control/activityRuns.test.ts` to C1's Step 4 run list.

2. **[blocking] D3 (amendment) — `src/control/activity.ts` `RUN_ENDED_STATES`.** The amendment moves `endedAt` and the
   `run-settled` row to Part B's choke point and says Part D adds `"settled-failed"` to `RUN_ENDED_STATES`, but no D task
   names `src/control/activity.ts` in Files or in its `git add` list. D's mutation protocol clones committed state, so
   an uncommitted edit makes the D3 assertions (`endedAt`, `run-settled`) red in every clone and in the gate.
   **Resolution:** D3 adds the one-word edit to `RUN_ENDED_STATES` (with an issue-fixes comment), lists
   `src/control/activity.ts` under Files and in its `git add`; delete `endedAt: store.now(),` and the `run-settled`
   `recordActivity` from the D3 code block in the text so the amendment and the code agree.

3. **[minor] C amendment (1) — the v8 upgrade criterion has no code.** C2's text gives no test for Review Focus 1.
   **Resolution:** add it to `tests/control/shutdownHealing.test.ts`, building the v8 store exactly as B2's
   `version8Store` does (open, `DROP TABLE activity`, seed the empty-frozen-set shutdown row and a run body without
   `startedAt`, set meta to `8`), then `openControlStore` → `recoverControl` → `readControlGroup` (run `startedAt: null`)
   → `start` accepted; name its mutation (drop the `healEmptyShutdownIntents` call ⇒ red at `start`).

4. **[minor] Ruling Part B flag 10 vs B8/B10 Step 5.** The ruling says the `if (resumedDriverRun)` guard (B8) and the
   `outcome.kind !== "transient"` guard (B10) get pinning tests; the task text still says "record as unpinned" and gives
   no test. **Resolution:** B8 adds a criterion where `retryRun` resumes nothing (a group-scope `recovery-retry` with no
   blocked driver run) and asserts no `run-resumed` row; B10 adds a criterion that makes one pass answer `transient`
   (e.g. the resolver throws a transient git error) and asserts no `integration` row. Each named with its mutation.

5. **[minor] Amendment / ruling Part E flag 2 vs E5.** `claimEstimate` (`src/control/webService.ts`) and the
   `requirement-export` wake must skip an archived group, with a queue-archive-deliver test each; E5's Files, tests and
   `git add` omit them and its flagged point 2 says "Not changed". **Resolution:** extend E5 per the amendment (two
   guards, two tests, files added to `git add`); strike flagged point 2.

6. **[minor] B11 ↔ E11 — `web/src/controlApi.ts` `fetchRunActivity`.** B11 already exports it (typed `RunActivityV1`);
   E11 Step 3 adds a second export typed `RunActivityViewV1` (a duplicate-export compile error if followed literally).
   **Resolution:** E11 drops that step, imports B11's `fetchRunActivity`, and uses `RunActivityV1`/`ActivityEntryV1`;
   remove `web/src/controlApi.ts` from E11's `git add` if nothing else changes there.

7. **[minor] B6 ↔ E11 — `phase` row `body.step` vocabulary.** B6 stores ccloop's raw status (`executing`; ruling Part B
   flag 6); E11's test feeds `execute` and renders with `enumText("progressStep", …)`, so real rows show
   `phase · executing · attempt 2` while the test pins a body Part B never writes. **Resolution (ruling says the UI
   maps):** E11 maps raw status to the panel step with a web copy of `STEP_OF` (or exports the server table through
   `controlTypes.ts`), and its test feeds `{ step: "executing", attempt: 2 }` expecting `phase · execute · attempt 2`.

8. **[minor] Ruling Part D flag 1 ↔ E11 — `activityText` for `run-blocked`.** E11 calls `explainRunReason(body.reason)`
   without `reasonCode`, so `Error: codex-skills-…` reasons stay unexplained. **Resolution:** use
   `explainRunReason(reasonCode(body.reason))` (import from `web/src/runFacts.ts`).

9. **[minor] D6 ↔ E9 — run number rule duplicated.** E9's `runNumber(item, runs)` re-implements D6's
   `taskRunNumber(view, taskId)` (spec §4.2(2)). **Resolution:** E9's `nodeLines` calls `taskRunNumber` (pass the view, or
   add a `(lineage, runs)` overload in `runFacts.ts`); drop E9's `runNumber` export and point its test at `taskRunNumber`.

10. **[minor] A3 ↔ D8 — where ccloop reasons are covered.** Spec §2.2(a) puts run failure reasons in the existing
    `tests/panel/refusalCoverage.test.ts` coverage set and A3 says "Part D adds ccloop's stop reasons here"; D8 instead
    creates `web/tests/failureReasons.test.ts`. **Resolution:** D8 appends its 12 `codex-*` codes to `VIEW_REASONS`
    in `refusalCoverage.test.ts`; keep `failureReasons.test.ts` only for its second `it` (the `Error: ` prefix path).

11. **[minor] A3 ↔ D8 — `"terminal"` entry.** A3 writes it verbatim (en is pinned by A4's test); D8's block lists it
    again. D8's grep guard prevents a duplicate key; state plainly in D8: "do not add `terminal` — Part A owns it".

12. **[minor] C3 text vs C amendment (2).** C3 Step 4 says `handoffResume`, `controlI18n`, `controlPanel` stay green; the
    amendment hides per-task "Continue task" buttons under any stop intent and requires rewriting them. **Resolution:**
    C3 adds the render condition `stopMode === null` to those buttons, names the rewritten tests with
    "Rewritten for issue-fixes spec §3.2(4)" comments, and records them in the ledger.

13. **[minor] C3 ↔ E10 — alert order and a stale anchor in `web/src/ControlGroupView.tsx`.** Spec §6.5 groups the
    archived banner with the alerts (claim-blocked, refusal, stop banner, archived banner) before the graph; E10 puts it
    after the spend-cap line and plan line. E10 also says Budget/Agents are "directly after the stop line", which C3
    deletes. **Resolution:** E10 inserts the archived banner directly after C3's stop banner (the C3 test's
    `h2.nextElementSibling` still holds: its fixtures are not archived); re-anchor the Budget/Agents cut on the
    `<BudgetEditor` element itself.

14. **[minor] D3 ↔ E6 — `tests/entry/skill.test.ts` comment.** D3 rewrites it to "30 routes carry the 31 verbs"; E6
    only appends a sentence, leaving 30/31 above an assertion of 32. **Resolution:** E6 rewrites it to "32 routes carry
    the 33 verbs".

15. **[minor] A amendment vs A1/A3/A4 text.** The amendment (non-ASCII id `任务a` in A1's five-problem test and A4's
    decode test; A3 English-fallback criterion asserting the server message beside the raw code) is not in the test
    code. Feasible: `planFile.ts` `taskId` is `z.string().min(1)`. **Resolution:** executor edits the three tests per the
    amendment; A3's new assertion reads the `<code>` element next to `refusal-message`.

16. **[minor] Known-red windows between commits.** A1 lands with `requirementSplit.test.ts` red until A2; E3, E4, E5
    land with `skill.test.ts` red until E6. **Resolution:** move A2's one-line rewrite of
    `requirementSplit.test.ts` into A1; move E6's `SKILL.md` rows and `skill.test.ts` edits into E3 (E6 keeps only the
    Notes paragraph and phrase list, or merges entirely).

17. **[minor] B2 test 3 never seen red.** "refuses a version-10 store and leaves its bytes unchanged" passes before the
    change and no Step 5 mutation turns it red (Rule 9 inference 1). **Resolution:** add mutation (d): accept `"10"` in
    the store allowlist (or make `migrateSchema` fall through for `"10"`) ⇒ that test red.

18. **[minor] E4 Step 4 prose.** "27 refusal cases plus the two others": the `it.each` has 25 cases (23 existing group
    verbs + `retry-task` + `archive-group`); 27 is the test total. Fix the sentence.

19. **[minor] Preconditions placed before the call under test** (D3/D4/D7 `netOf(...)`, D4 reserve `0`, D7 workspace
    exists, E3 stop state, E5 wake count). They read back the test's own setup (Rule 9 inference 2) and cannot pin the
    change. Keep them as setup guards but do not list them as criteria in the ledger; no mutation is credited to them.

20. **[minor] E3 duplicate helpers.** `success()` and `groupBody()` re-implement `commandSuccess` and `readGroupBody`
    (`src/control/stopIntent.ts:146,154`). **Resolution:** import both (`archiveGroup.ts` already imports
    `commandLedger.ts`; importing `stopIntent.ts` adds no cycle with `archivedMark.ts`, which stays a leaf).

Informational (no change needed): mutation clones link `node_modules` from the worktree (A, B) or from the main checkout
(D); equivalent until F1 replaces the worktree's symlink with a real tree, which happens after every mutation step.
Test-output variable names differ by part (`$S`, `$SCRATCH`, `<S>`); cosmetic.

## Totals

Blocking: 2 (conflicts 1, 2). Minor: 18 (conflicts 3–20).
