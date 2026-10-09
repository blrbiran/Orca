# Feedback maintenance independent final review

Owner: `/root/feedback_final_review`, delegated final reviewer. Date: 2026-10-10 (Asia/Shanghai).
Requested base observation: `be2a26f`. Observed HEAD: `09d01ddc53bd831655055af4b594706784b3b760`, measured with `rtk proxy /usr/bin/git rev-parse HEAD`. Review target: the uncommitted feedback-maintenance diff supplied at `/private/tmp/orca-feedback-20261010/review.diff` and the named new files. This first-pass report is immutable; any re-review is appended below.

## Verdict

**Not ready on the reviewed snapshot. Critical: 0. Important: 2. Minor: 1.** The narrow scope and reuse of backend authority are appropriate. Resolve the two archive integration defects before completion. Full-suite results remain the implementing agent's responsibility; this review does not claim they passed.

## Findings

### Important F1 — Route requirement archive commands through the requirement result path

Location: `web/src/RequirementsPanel.tsx:277-280` (new command emitters), with immediate caller `web/src/App.tsx:384`, result handling at `418-427`.

`archive-group` and `unarchive-group` are absent from `requirementVerb`. Clicking these new controls on a clarifying group consequently does not set `requirementRefusal` for a refused or uncertain result and does not immediately reread its requirement view. Instead it invokes the task-group detail read. The requirement screen can keep the old revision and old action until polling, while a rejected archive appears to do nothing. The component tests only spy on the emitted action, so cannot detect this integration defect.

Minimal fix: classify these shared verbs as requirement commands when their target is a clarifying group, preserve the normal task-group behavior otherwise, and refresh the correct detail after success. Include uncertain-command reconciliation so a recovered result is surfaced in the same requirement panel without resending the mutation.

Meaningful tests: through App, archive and unarchive success update the requirement detail/revision without fetching a task-group detail; a 409 archive refusal is visible in Requirements; a lost response followed by command lookup refreshes the requirement view or shows its recovered refusal. None should require real provider or user-store access.

### Important F2 — Archived requirements remain in the default requirement list

Location: `web/src/RequirementsPanel.tsx:351` and list rendering at `360-367`.

The list predicate checks only requirement presence and project scope. The new Archive action leaves archived failed requirements listed identically to active requirements, with no archived filter or marker. That defeats removing finished/failed requirements from the working list and conflicts with the existing archive contract (issue-fixes design H4 and section 6.3: hidden by default, retrievable via an Archived filter).

Minimal fix: exclude archived requirements from the default list and add a small existing-terminology archive toggle/filter so archived detail and Unarchive remain reachable. Preserve project scope and retain an already-open archived detail long enough to see the result.

Meaningful tests: a mixed active/archived fixture hides archived entries by default; choosing archived exposes them, permits selection and unarchive, and continues to exclude other projects. Assert actual rendered navigation rather than only an array predicate.

### Minor F3 — Retry reference omits the released settlement path

Location: `skills/orca-control/SKILL.md:161`.

The edited authoritative Notes says retryable current runs are terminally `blocked` or eligible held `settled-recoverable`, followed by “any other task is refused.” `src/control/retryTask.ts:78-82` also admits an eligible inactive `settled-failed` run with a valid released usage settlement and matching terminal allocations. The reference therefore tells operators that the supported retry after conservative settlement is impossible.

Minimal fix: include the eligible released `settled-failed` path, retaining the live identity, settlement, pending-event, stop and budget preconditions. This is a wording correction to reflect already-closed M3 behavior, not new retry behavior.

## Checked without further findings

- Explicit Codex blocking uses installation `kind`, including custom installation IDs; default/unavailable kinds remain server-resolved. The submit guard and disabled button both protect the form.
- Archive applicability follows the current latest round/draft state and suppresses pending calls, blocked requirement runs and unresolved stops. `pendingRequirementCall` in `src/control/requirementCalls.ts:42-51` uses the same latest-step rule; `archiveGroup.ts` remains the authoritative race guard.
- Archived detail suppresses answer, consensus, draft-feedback/accept, retry, limit and stop mutations while exposing Unarchive. Tests should additionally cover archived draft-review and failed/budget-exhausted variants; the initial new test covers only awaiting answers.
- Activity reverses a copied returned array. The backend remains `ORDER BY seq DESC LIMIT ?` in `src/control/activity.ts:66,71`, preserving the newest-N window.
- Compact run amounts keep exact grouped values in titles. Full profile hashes and evidence IDs remain in disclosures, and the evidence action remains present. Raw run IDs remain in the anonymous-run disclosure and evidence paths.
- AuthGate's frame and the CSS account/menu/notices selectors match the rendered sibling structure. Mobile overrides exist. Actual geometry has not been established by this review.
- English and Chinese additions have matching keys and parameters. Root sources, dependency pins and backend permissions were not changed by the reviewed diff.

## Verification and limitations

Read-only review commands: `rtk proxy /usr/bin/git diff -- ...`, `rtk proxy /usr/bin/git status --short`, `rtk proxy rg -n ...`, `rtk proxy cat ...`, and targeted `rtk proxy sed -n ...` source reads. Line references above were measured in this working-tree observation using `rg -n`, not inferred from the base commit. No source edits, provider calls, service actions, user-store writes, commits, merges or pushes were performed by the reviewer.

The parent reported focused-web success and full suites in progress; the reviewer has not independently rerun those suites. The parent also reported that browser file-URL policy denied geometry QA. No workaround was attempted or requested. String assertions in styles tests establish declarations, not actual desktop/mobile scrolling or short-viewport geometry; disclose that limitation in the final handoff rather than claiming visual verification.


## Scoped re-review 1 — 2026-10-10

Owner: `/root/feedback_final_review`. Observed HEAD remains `09d01ddc53bd831655055af4b594706784b3b760` (`rtk proxy /usr/bin/git rev-parse HEAD`). Reviewed `/private/tmp/orca-feedback-20261010/fix-review.diff` and the current working files, including the optional summary-owner annotation in App.

**Verdict: not ready yet. Remaining Critical: 0; Important: 1 (residual F1); Minor: 0.** F2 and F3 are closed. F1 is fixed for clarifying targets but still has an accepted-requirement path below.

### F1 residual — Unarchive an accepted requirement from its Requirements detail

Current location: `web/src/App.tsx:398-399` gates the shared archive verbs on `state === "clarifying"`; `web/src/RequirementsPanel.tsx:277-279` offers Unarchive for any archived requirement detail, and `351-354` retains every requirement-bearing group regardless of state. Backend `src/panel/controlViews.ts:412` preserves requirement summaries on accepted groups as well.

Reproduction from supported states: accept a requirement split; archive that resulting task group in Task control; open Requirements, enable Show archived requirements, select that archived accepted requirement, and press Unarchive. Its group state is draft/ready/etc., so the new result classifier is false. A refusal stays outside the Requirements refusal channel, and success refreshes only Task control while its open requirement detail remains stale until polling. The new App tests only exercise clarifying archive and lookup, so cannot detect this case.

Minimal correction: carry the originating requirement channel for commands from this panel, or recognize requirement-bearing archive/unarchive targets and refresh both applicable views. Preserve ordinary task-group routing. The recovered-outcome path should use the same ownership rule. Add App assertions for accepted archived requirement unarchive success/refusal and for clarifying unarchive.

### Closed findings and checked evidence

- F2: default list filtering now excludes archived entries, the bilingual checkbox restores reachability, and selected archived detail remains readable. The filter still conjunctively applies project scope. The new rendered-navigation test fails when its archive filter is deleted.
- F3: the skill reference now includes eligible released `settled-failed` failures with a valid usage settlement.
- The startup command-lookup fallback now reads summary ownership before discarding the original command ID; a summary read error leaves that ID retained. No resend was introduced.
- New archived review/failed tests check that Unarchive is the only detail action. The authenticated-frame test verifies the actual account bar and shell share the wrapper.

Evidence inspected via raw `rtk proxy cat` reads: `lookup-green-2.command.json`, `.rc`, `.log` report the recorded Vitest command passed 13 tests in 2 files; `clone-restored-green.command.json`, `.rc`, `.log` report the recorded restored-clone command passed 57 tests in 6 files. Those are parent-run artifacts, not new reviewer executions. `qualified-mutations.json` reports 17 deletion runs returning 1 with restoration diff sizes zero; selected native failure logs for archive App routing, recovered lookup/startup owner, and archive filtering show the intended assertions failing. The reviewer does not claim to have independently executed all mutations or inspected every log in full.

No additional concrete breakage was identified in the reviewed fixes. Full-suite completion is still pending parent verification. Actual desktop/mobile/short-viewport geometry remains unverified because the browser file-URL check was denied; no workaround was attempted or requested.


## Scoped re-review 2 — 2026-10-10 — final code-review verdict

Owner: `/root/feedback_final_review`. Observed HEAD: `09d01ddc53bd831655055af4b594706784b3b760`, measured again with `rtk proxy /usr/bin/git rev-parse HEAD`. Current App source and tests were authoritative because the supplied final-fix diff preceded the accepted-requirement correction.

**Ready from code review. Remaining Critical: 0; Important: 0; Minor: 0. F1, F2 and F3 are closed.** Final task completion still depends on the implementing agent recording its remaining root-suite result; this verdict does not claim that pending run completed.

The residual F1 is corrected: direct archive/unarchive commands recognize requirement-bearing summaries regardless of lifecycle state. They show refusals and reread the requirement, with an additional task-group refresh for accepted requirements. Recovered outcomes apply the same requirement ownership rule, preserve the existing group channel, refresh both applicable views, and do not create a new POST. Startup owner-summary read failures retain the original uncertain command ID.

The actual App tests now exercise unarchive for both clarifying and accepted (`draft`) states and recovered lost-response refusals for both states, including presence/absence of the task-group read and no mutation resend. Inspection found no further concrete defect in this correction. F2's default archive filtering and F3's released-settlement wording remain intact.

Evidence read from the parent-run artifacts with `rtk proxy cat`:

- `accepted-unarchive-green-2.command.json`, `.rc`, `.log`: command `node_modules/.bin/vitest run --root web tests/requirementsApp.test.tsx tests/controlCommandRecovery.test.tsx tests/feedbackRequirements.test.tsx --maxWorkers=2`; exit 0, 27 tests passed in 3 files.
- `final-web-6.command.json`, `.rc`, and the complete `.log`: command `npm run --workspace web check -- --maxWorkers=2`; exit 0, TypeScript followed by 751 passing tests in 92 files, no failed tests reported.
- `final-mutations.json` records 20 independent deletion runs, each exit 1 with restored working/cached diff sizes of zero. The clone base recorded in `final-mutation-clone-base.txt` is `d2a9f316b21c0f332b3943755225e105ab000160`. Native logs for accepted routing, accepted group refresh, accepted lookup refresh, archive App routing, lookup and startup-owner show failures in the intended App behavior assertions, rather than a compile or startup failure. These are inspected parent-run artifacts; the reviewer did not rerun the mutation campaign.

No source files were edited by this reviewer. Earlier findings and verdicts above are preserved as historical observations.

**Remaining verification limitation:** real desktop/mobile/short-viewport geometry is unverified because browser file-URL policy denied that check. DOM wrapper and stylesheet assertions passed, but they do not establish actual scrolling geometry. No workaround was attempted or requested; retain this explicit limitation in the handoff.
