# SDD ledger — plan: docs/superpowers/plans/2026-10-08-issue-fixes.md

Controller: Orca development session e34dc963 (Claude), 2026-10-08. Branch fix/issues-20261008, worktree
/Users/biran/code/skills/loop/Orca-issues. Spec: docs/superpowers/specs/2026-10-08-issue-fixes-design.md.
Human authorization (2026-10-08): execute the whole round subagent-driven in this session, rule on problems without
asking, report rulings at the end.

## Plan-writing rulings
Ruling: Orca checkpoint writes (`orca checkpoint write`) are skipped this session — the main checkout holds the human's
untracked docs/handoff/issue-20261008.md, which the human said must not enter git, and the tool refuses a dirty worktree;
progress lives in this ledger and git log — cost if wrong: the level hook keeps asking; no state is lost.
Ruling (Part A flag 1): items may contain newlines (zod keys, paths) — escape `\n`/`\r` inside an item as `\\n`/`\\r` — cost if wrong: a rare path shows escaped.
Ruling (Part A flag 2): stage 2 also collects loop-plan-invalid and file-read refusals, and reads contracts even when targetRepo mismatches (plan file is allowlisted) — cost if wrong: one extra file read on a doomed import.
Ruling (Part A flag 4): non-group non-import refusals go to the panel line; a lookup answering command-result-not-found goes to its group — cost if wrong: a refusal shown in the less specific place.
Ruling (Part A flag 5): en entries use {{detail}} so the code is not shown twice; zh keeps {{message}} except command-result-not-found — cost if wrong: wording only.
Ruling (Part A flag 6, binds C/D/E): en and zh error key sets must be equal and an en entry may not contain its own code — every new code gets both entries in the task that adds it.
Ruling (Part A flag 9): web tests run with `cd web && ../node_modules/.bin/vitest run <file>`; whole web suite `npm run --workspace web check` — cost if wrong: none.
Ruling (Part A flag 10): the split criterion mocks schedulerControlPlanSourceOf in its own file, since validateSplitDraft catches other import problems earlier — cost if wrong: weaker end-to-end coverage of a two-item split reason.
Ruling (Part B flag 1): activity DDL uses IF NOT EXISTS (downgrade tests need it); AUTOINCREMENT kept — cost if wrong: an extra sqlite_sequence table.
Ruling (Part B flag 2): shutdown writes per-group `stop {mode:"shutdown"}` rows only for groups whose intent was created or strengthened — these are group-scoped intent rows, not rows for the global command — cost if wrong: extra feed rows.
Ruling (Part B flag 3): only createStartingRun writes run-claimed; estimate/single-call/legacy claims write none — they are not task runs — cost if wrong: estimate runs absent from the feed.
Ruling (Part B flags 4/5, binds Part D): run-settled rows and endedAt come only from Part B's noteRunWrite choke point; Part D adds "settled-failed" to RUN_ENDED_STATES and must not write run-settled or endedAt itself — cost if wrong: duplicated rows.
Ruling (Part B flag 6): phase.step is ccloop's raw status — cost if wrong: the feed shows raw words; the UI may map them.
Ruling (Part B flag 7): run-activity route = id format + run exists in this store (404 run-not-found otherwise); the evidence route's integrity validation is not copied — cost if wrong: a read of a run whose read model is inconsistent still returns its activity.
Ruling (Part B flag 8): run-started records a projection change in beginProviderAttempt — needed for the open view to refresh — cost if wrong: one extra changeSeq per attempt.
Ruling (Part B flag 10): the two unpinned guards (integration transient writes nothing; retryRun `if (resumedDriverRun)`) get pinning tests in their tasks (Rule 9: a branch not seen red is not a criterion) — cost if wrong: two small tests.
Ruling (Part B flag 12): mutations run on a clone made after the task's commit; an unseen-red mutation is fixed by a follow-up commit, never an amend — matches Rule 15 and the prefer-new-commits rule.
Ruling (Part E flag 1): four archive guard codes added (archive-run-active, archive-stop-pending, archive-integration-resolving, archive-call-in-flight, all 409) and listed in the plan's Global Constraints — spec §6.3 "each with its own code".
Ruling (Part E flag 2): claimEstimate and requirement-export wakes ALSO skip archived groups (E5 extended) — spec §6.3 "an archived group refuses new work" outranks the plan's skip list; a queued estimate must not run on an archived group — cost if wrong: one extra check.
Ruling (Part E flag 3): no duplicate checks in replenishStartWakes/deliverContinuationWake (covered via nextClaimableTask and their caller) — a duplicate guard could never be seen red — cost if wrong: none while those paths keep their single caller.
Ruling (Part E flag 4): a confirmed never-started group with dependency edges lists as Running (waiting task) — literal spec §6.4 rule 4 — cost if wrong: one filter bucket.
Ruling (Part E flag 5): legacy applyCommand (CLI ControlService) is not gated — unreachable from Web/socket — cost if wrong: a CLI-only path can mutate an archived group.
Ruling (Part E flag 6): where E assumed names from B/D (RunActivityViewV1/ActivityEntryV1 etc.), the executor uses the names Part B/D actually produced (Part B: activityEntrySchema, runActivitySchema, RunActivityV1, fetchRunActivity).
Ruling (Part D vs B conflict): applyRetryTask must not set endedAt or write run-settled; Part B's choke point does both once "settled-failed" is in RUN_ENDED_STATES; amendment block written at the top of part-D.md — cost if wrong: none (single source of truth).
Ruling (Part D flag 1): reasonCode strips one leading "Error: " before explainRunReason — ccloop sends String(error) — cost if wrong: a reason shown raw.
Ruling (Part D flag 2): the run view gains optional `outcome` (needed for the button rule §4.2(5)); Part E may use it — cost if wrong: one extra wire field.
Ruling (Part D flag 3): retry releases the failed run's remainder then reserves the full grant (net = grant − remainder), the spec's intended arithmetic — cost if wrong: reserve off by the remainder, caught by the pinned number.
Ruling (Part D flag 4): clarifying group refused with group-state-invalid:clarifying per spec, not requirement-not-split — cost if wrong: a different code for an edge case.
Ruling (Part D flags 5/6): `drive.cleanedUp=false` and STOPPED_STATES' settled-failed entry cannot be seen red (no observable effect) — recorded as unpinnable, kept for the reader-completeness requirement — cost if wrong: two unpinned lines.
Ruling (Part D flag 7): codex-timeout explanation added though ccloop does not emit it today (spec lists it) — harmless.
Ruling (Part D flag 8): the real-ccloop E2E asserts outcome ≠ succeeded and a stopReason string; the exact codex-result-invalid criterion runs on the synthetic port — cost if wrong: weaker real-binary assertion.
Ruling (Part C flag 1): four extra existing tests rewritten by C1 (controlLifecycle "waits for a writer admitted…", "records an inconsistent frozen set…", "leaves nothing behind…"; shutdownDriverGroup "freezes a started group whose body carries no planHash…") — spec §3.4 list was incomplete; human approved necessary rewrites.
Ruling (Part C flag 2): per-task "Continue task" buttons render only when the group has no stop intent (the server refuses continue-task under any stop intent, so at handoff-complete they were dead buttons — the issue-16 anti-pattern); the affected web tests (handoffResume, controlI18n, controlPanel) are rewritten in C3 — cost if wrong: a person must resume before continuing a single task.
Ruling (Part C flag 3): handoff-partial / handoff-unresolved banner says "Retry recovery when it is offered" — no spec'd exit exists — cost if wrong: wording.
Ruling (Part C flag 5): shutdownGroup writes no activity rows; Part B writes per-group `stop` rows in applyPanelShutdown for created/strengthened intents — consistent with Part B ruling.
Ruling (Part C flag 6): C2 keeps the explicit recordProjectionChange though recordActivity also records it (equivalent mutant stated) — spec §3.2(2) requires the projection change independently of the activity row.

## Pre-flight scan (preflight-scan.md beside this ledger; 2 blocking, 18 minor)
Ruling: B9 test claims a run before shutdown; C1 runs activityRuns.test.ts — blocking conflict resolved in plan index "Pre-flight amendments" 1.
Ruling: D3 owns the RUN_ENDED_STATES edit in activity.ts and its git add — blocking conflict resolved, amendment 2.
Ruling: no duplicate helpers across parts (fetchRunActivity, taskRunNumber, reasonCode) — amendment 3.
Ruling: E11 test data uses raw ccloop statuses — amendment 4.
Ruling: tasks that would commit a knowingly-red test move that test change into the task that makes it pass — every commit green — amendment 6.
Ruling: E10 archived banner with the alerts before the graph (spec §6.5) — amendment 7.

## Execution
Task A1: implemented c03d4e3 (base c786e84). Concerns: requirementSplit `import:control-metadata` rewrite moved into A1 (amendment 6) — A2 must not redo it; driverProgress P3/R1 5 s timeout in tests/control at load 17-21, 7/7 alone (load flake).
Ruling: the non-ASCII Review-Focus-3 case goes through an `unreadable-source:<path>` / `malformed:` item, not a task id — loadPlan refuses non-RUN_ID task ids at stage 1 (measured RED run); A4's decode test uses the same path — cost if wrong: none.
Ruling: verification git uses /usr/bin/git (rtk reports a 0-byte diff as 1) — added to common-implementer.md; worktree diff measured 0/0 bytes after A1.
Task A1: minor (deferred): no `\r` escape test (branch unpinned); originalOrItem falls back to error.code without detail.
Task A1: complete (commits c786e84..c03d4e3, review clean)
Task A2: minor (deferred): importReasons maps an empty-string detail to "import:" (`??` vs `||`).
Task A2: complete (commits c03d4e3..6c19224, review clean)
Ruling (A3): web/tests/authGate.test.tsx "keeps the login form and shows the refusal when the login is refused" and web/tests/outcome.test.tsx "Refusal > renders the server's code and message" are rewritten to assert the English entry (they pinned the verbatim-English behaviour spec §2.2(a) replaces) — human approved necessary rewrites — cost if wrong: two tests assert wording.
Ruling: session context passed the Rule 6 per-session limit (hook: level 450926 of T2 450000) during A3/A4 — continuing because the human said on 2026-10-08 "这个session暂时不要考虑context大小"; surfaced here and in the final report; the checkpoint tool still refuses the dirty main checkout, so the ledger + git log are the recovery map — cost if wrong: a later compaction; recovery is from this ledger.
Task A3: review 1 — Needs fixes. Important: en/zh skills-unsupported-agent says only claude loads skills (code accepts claude or codex); en/zh checkpoint-usage-high-water states "<" for an inequality. Minor: control-internal-error double period; dangling ": " when a `…: {{detail}}` code is thrown bare (recovery-blocked etc.); work-already-active wrong at the continue-task throw site; spend-cap-repository-unknown / identity-space-exhausted / work-already-active drop a useful detail; stale "124" comment; command-result-not-found redundancy outside UsagePanel.
Ruling: the A3 fix round waits until A4 commits (both edit en.ts/zh.ts; no concurrent writers on one file); the fix round also takes Minors 1-5 (cheap, user-visible) — cost if wrong: a few extra lines.
Task A4: implemented c60b5a5. Process deviation: implementation written before the first test run (no red-first); the three mutations were each seen red, so the tests can fail — Ruling: accepted, recorded — cost if wrong: none observable. Brief cast failed TS2352; replaced by an itemLine helper.
Task A4: minor (deferred): no test pins "an escaped \n inside an item stays one entry" (a split on /\\n|\n/ would pass); escaped items shown with literal \n; malformed split at first ": "; explainRunReason("terminal") with no colon.
Task A4: complete (commits 640cb39..c60b5a5, review clean)
Ruling (A3 fix round 1): the A4 assertion "The plan was not imported: " is rewritten to "The plan was not imported." — it pinned the dangling colon the ruled fix removes; a this-round test — cost if wrong: none.
Task A3: fix round 1/5 (5 addressed, 1 trivial open — stale "124" comment remains in zh.ts:737; commits c60b5a5..f7daa8a)
Task A3: minor (deferred): stale "124 at ac969bb" comment in zh.ts:737; zh entries use {{message}} (full "code:detail"), so a bare zh refusal prints the code instead of a dangling colon — pre-existing convention; zh command-result-not-found uses {{detail}} unlike neighbours.
Task A3: complete (commits 6c19224..f7daa8a, 1 fix round)
Ruling (A5): A5 and A6 are merged — A5 alone leaves 5 web tests red (refusal not rendered until A6); the same implementer does A6 on top and commits with the suite green; verified green together in a scratch clone (630/630) — cost if wrong: one larger review.
Task A7: minor (deferred): docs/cli.md says a schema mismatch is refused with malformed lines alone — stage 1 also returns its other up-front rejections alone; README omits a pointer to those.
Task A7: complete (commit eb6269c, review clean)
Task A5+A6: review 1 — Needs fixes: refused/uncertain import leaves a hidden group-not-found refusal that keeps the Tasks badge lit (reproduced by probe); Minor: badge expression unpinned; uncertain notice not cleared on found-success; failed reads stay until a command (brief-mandated); §6.5 comment unverified. Fix round 1 dispatched with Important + Minors 1-2.
Ruling: implementers in one worktree commit with an explicit pathspec (`git commit -- <paths>`) so a concurrent implementer's staged files cannot leak into another commit — added to common-implementer.md.
Task B1: minor (deferred): driverHarness storeNow pass-through not independently pinned (reached only after the web leg); temp dir leak if the second openTestStore throws.
Task B1: complete (commits fd3e6fc..775374a, review clean)
Task B2: implemented 0ed9d2f. Panel reds (50) were panel-dist-missing; controller built web/dist in the worktree (ignored output) and re-ran tests/panel: rc 0 (load 13-17). driverRecovery "drives a retried run on…" 5 s timeout = registered load flake, green alone. Rule: web/dist now exists in the worktree; implementers rebuild it (`npm run build --workspace web`) after web changes before running tests/panel.
Task A5+A6: fix round 1/5 (3 addressed, 0 open; commits cb90f26, 76e8382; web check 636/636)
Task A5+A6: minor (deferred): a lookup that finds the command was REFUSED leaves the "outcome unknown" notice (not replaced by the real refusal); command-succeeded import-place branch untested; agentPreviewRefresh 15 s timeout at load 22-32 (green alone, also on baseline — load flake).
Task A5+A6: complete (commits eb6269c..76e8382 web-only: fd3e6fc, cb90f26, 76e8382; 1 fix round)
Part A: complete.
Task B2: minor (deferred): no fresh-vs-migrated sqlite_master comparison for a multi-step chain; REFERENCES rejection of an unknown group_id unpinned (B3 territory).
Task B2: complete (commits 775374a..0ed9d2f, review clean)
Task B3: minor (deferred): recordActivity for a missing group surfaces a raw SQLite FOREIGN KEY error (rolls back; unpinned); an invalid stored row makes the whole read recovery-blocked (deliberate fail-loud).
Task B3: complete (commits 76e8382..3c50309, review clean)
Task B4: minor (deferred): run-blocked body reads blockedAt/reason from the body being written (current blockers set both first); landed→settled writes two run-settled rows (endedAt on the body is the single end time — Part E must read it, not the rows); releaseRunReserve settle path shares saveRun but has no dedicated test; full npm test replaced by control+panel (+ reviewer ran entry+scheduler rc 0).
Task B4: complete (commits 3c50309..3f43813, review clean)
Task B5: minor (deferred): no test for run-started on estimate/single-call runs (taskId null).
Task B5: complete (commits 3f43813..5ec4389, review clean)
Task B6: minor (deferred): planning → null → planning writes a second phase row (literal "differs from stored"); a redundant cast in collectInto.
Task B6: complete (commits 5ec4389..c405c3e, review clean)
Task B7: minor (deferred): command rows' task/run target mapping (taskId/runId) unpinned; "global commands write nothing" structural only; appendActivity→recordActivity is an equivalent mutant (journal dedups).
Task B7: complete (commit 5406b0f, review clean)
Task B10: minor (deferred): conflict/discarded settle outcomes not exercised in the test (shared path).
Ruling (B10 scope gap): the `resolving` transition (integrationResolve.ts:183, approval) and resolving→conflict failure (integrationResolve.ts:323) write no `integration` row — out of the plan's settle-only scope; queued for the final whole-branch fix wave (add recordActivity at both saves) — cost if wrong: two missing feed rows until fixed.
Task B10: complete (commit aa3f9dc, review clean)
Task B8: note — 7aca55c alone is red on the expected command row (B7 5406b0f landed right after); green at HEAD — Ruling: accepted (concurrent ordering), recorded.
Task B8/B9: minor (deferred): 7aca55c alone red on the B7 command-row expectation (bisect only); B4's "driver run gets endedAt…" and driverRecovery "drives a retried run…" time out at 5 s under load 9-11, green alone and with --testTimeout=30000 — B4's new test is a load-flake candidate.
Task B8: complete (commit 7aca55c, review clean)
Task B9: complete (commit fb08b7d, review clean)
Ruling: C1 waits for B11 (both edit webProtocol.ts and web/src/controlTypes.ts); C2 (recovery.ts) runs now in parallel.
Task C2: review 1 — Needs fixes: heal-before-wakes ordering untested (no case passes wakes; move-after mutant stays green). Minor: test 3 swallows dispose errors. Fix round 1 dispatched.
Task B11: review 1 — Needs fixes: run view startedAt/endedAt not positively tested (constant-null or row-derived endedAt stays green). Minor: SKILL.md readable routes miss runs/<id>/activity; lastActivityAt is one query per run (N+1, accepted). Fix round 1 dispatched.
Task C2: fix round 1/5 (1 addressed, 0 open; commit 7c12667; m7 reproduced red by the re-reviewer)
Task C2: minor (deferred): test 3 swallows dispose errors; "runs grew" is a lower bound.
Task C2: complete (commits f9f730b, 7c12667)
Task B11: fix round 1/5 (2 addressed, 0 open; commit 181d4ea)
Task B11: complete (commits 0c361cd, 181d4ea)
Part B: complete.
Task C4: implemented 7835728 (append-only, 0 deletions, two hunks at old file ends). Ruling: C4 review deferred until C1 and C3 commit — its errata cite their commit subjects and web/tests/stopBanner.test.tsx, which must exist (verify subjects with git log --grep) — cost if wrong: an erratum naming a commit that does not exist.
Task C1: minor (deferred): "all-done group" test has no settled runs (passes for the same reason as the idle case); no test for a never-started draft group with an estimate in flight (structurally frozen; H7 covers the path); handoffE2E skips all 12 in this environment (also on base).
Task C1: complete (commit a715716, review clean)
Ruling (C3 concern 1): "Resume (no continuation)" is also offered at handoff-complete when tasks are continuable — with per-task Continue buttons hidden under a stop intent, otherwise a person cannot continue only one of several held tasks; the related web test rewrite is approved — cost if wrong: one extra button.
Task D1: implemented 6edcd81. Ruling: D2 waits for the C3 ruling follow-up to commit (both edit web types/locales).
Task D1: minor (deferred): codex-skills- check now runs on the bounded string (theoretical); astral straddle at unit 500 untested.
Task D1: complete (commit 6edcd81, review clean)
Ruling: uncommitted duplicate `stop` recordActivity lines (x2 each in applyPauseDispatch/applyHandoffStop/applyPanelShutdown, plus two duplicate imports) found in the worktree after B8/B9 — an agent edit leaked into the worktree (no process still writing); diff saved to scratchpad orca/ctl/leaked-duplicates.diff, the two files restored to HEAD (C3's in-progress web files untouched) — cost if wrong: none, the lines were never committed or reviewed.
Note: the TS2300 duplicate recordActivity typecheck red C3 saw came from the leaked duplicate lines, already restored to HEAD by the controller (not D1).
Task C3: minor (deferred): controlPanel "completed" not.toContain("Continue task a") now satisfied by the stop gate (intent kept by handoffResume's no-stop test); banner says "the resume button" (two may render); zh banner "重试恢复" vs button label.
Task C3: complete (commits b9cf916, 6a88636, review clean)
Task C4: minor (deferred): plan erratum says the dialog shows "X or Y"; both can now show together (append-only, not false).
Task C4: complete (commit 7835728, review clean; every citation verified)
Part C: complete.
Ruling (D2): web/tests/i18nPseudo.test.tsx "reads every family" count 164→165 for runState "settled-failed" — the count is a deliberate add-a-value tripwire, rewritten before as a named rewrite — cost if wrong: none.
Task D2: minor (deferred): after recovery-retry a later reasonless non-succeeded terminal keeps the earlier stopReason (blockRun merges; unlikely with real ccloop); third retryTask test's first assertion reads state the test wrote (other mutations cover).
Task D2: complete (commit ebe9882, review clean; reader sweep found no missed run-state reader)
Task D3: minor (deferred): D3 alone is unguarded (D4 closes — must ship together, same branch); handoff half of both() equivalent in this fixture; doc-comment placement and parity line formatting cosmetic.
Task D3: complete (commits 6a90702, 707bb40, review clean)
Ruling (D5): B8's activityRuns "run-resumed …" test is rewritten to use a transiently blocked run (it used an exhausted run, which D5 now deliberately refuses) — a this-round test; prefer a real transient block over poking outcome — cost if wrong: none. D5 skipped red-first; mutations required as the failing proof.
Task D4: review 1 — Needs fixes (plan-mandated): zh group-reserve-insufficient does not name the budget editor (spec §4.2(2)). Minor: stale outcome after recovery-retry then a different C block (D5 closes for new runs; residual for existing stores); inactive-but-blocked detail names the wrong cause (inconsistent store only); stop guard halves and handoff half of the reserve check unpinned; zh task-not-retryable uses {{detail}}.
Ruling: the D4 fix round (zh text + stop-guard and handoff-reserve pins) runs after D5 commits (both edit zh.ts).
Task D5: implemented c57493f (activityRuns run-resumed test rewritten per ruling: outcome cleared after the block). Equivalent mutant: moving the throw after the blocker clearing stays green — the refusal rolls back the command transaction, so ordering is unobservable from state; the blockers-untouched assertion documents it.
Ruling (D5 review minor 1): a terminally failed run that retry-task also refuses (reserve short, usage unknown/pending, open handoff request, not current) gets refusals from both buttons — accepted: retry-task's refusal names the actionable cause (budget editor, wait for usage, etc.) — cost if wrong: one extra click to read the second refusal.
Task D5: minor (deferred): run-terminal-failed entries unindented / out of alphabetical order in en.ts and zh.ts; blockers-untouched assertion is documentation only (equivalent mutant).
Task D5: complete (commit c57493f, review clean)
Task D6: implemented b96e608. Ruling: isTerminalFailure uses state blocked + outcome set ≠ succeeded (the run view has no blockedAt; only step C sets outcome, and the server re-checks and names any refusal) — cost if wrong: a Retry-task button the server then refuses with a stated reason. runReasonText returns the raw reason; explanation happens at render (D8 RunReason).
Task D6: minor (deferred): empty-string stopReason not falling through (`??`); no isTerminalFailure case for a non-blocked run with a failed outcome; taskRunNumber trusts lineage ids.
Task D6: complete (commit b96e608, review clean)
Task D4: fix round 1/5 (3 addressed, 0 open; commit bda8baf)
Task D4: minor (deferred): no test pins the zh budget-pointer wording.
Task D4: complete (commits 54f76a2, bda8baf)
Task D10: implemented 7769202 (append-only, one hunk). Ruling: D10 review deferred until D7 lands — its sentence on driver archive/cleanup of settled-failed runs must match D7 as landed (the branch is unpublished, so a mismatch is fixed on the branch before merge).
Task E1: minor (deferred): done-before-blocked precedence unpinned; zh recovery-blocked uses {{message}} (Part A convention).
Task E1: complete (commit 9f137ff, review clean). Note sent to E2: currentRunBlocked only for state "blocked" (a settled-failed current run after retry-task is not blocked).
Task E2: minor (deferred): summary query cost ~3x per task (N+1 over deps; batch per group later — performance item for the final review); unreadable work-item leniency untested; one corrupt archived mark fails the whole summary list (matches existing strict body handling); no dependenciesDone mutation recorded.
Task E2: complete (commit f6db4fd, review clean)
Task D7: implemented 585fb72. Ruling: the three new driver tests get a 30 s timeout (driverSettle precedent; 0.5–2.4 s alone, 5 s timeouts only under load) — cost if wrong: a slow test masks a hang for 30 s. Note: "flag 11" was in Part D's plan-writer report, not the ledger — it is the integration-pass-before-runs ordering the implementer checked (runs first). executionDriverE2E skips without a real ccloop (environment) — covered by F2's gate with ORCA_CCLOOP_BIN.
Task D7: minor (deferred): "never blocks the new run" shown structurally only (repository restored before run 2); a revisit after partial failure may write a second archive outbox row with a different manifest; in-write re-check unpinned.
Task D7: complete (commit 585fb72, review clean)
Task D10: minor (deferred): erratum's commit list omits 585fb72 (written before D7 landed; append-only).
Task D10: complete (commit 7769202, review clean)
Task E3: implemented bcf5584. Ruling: E6's route-table half (two SKILL.md rows, schemaByVerb entries, counts 30→32) moved into E3 (amendment 6); E6 keeps only the Notes sentence and phrase-list additions. Ruling: the stop guard uses the derived stop state (readStopIntent + deriveStopState, same source as groupStopState) rather than the intent body's stored state — cost if wrong: none (derived is the truth the view shows). Equivalent mutant: removing the pause exemption stays green (a pause freezes an empty set ⇒ handoff-complete).
Task E3: complete (commit bcf5584, review clean).
Ruling (E3 review minor 1): archive is allowed at `handoff-partial` too (terminal, nothing in motion; otherwise the explanation's "once it reaches handoff-complete" never comes true) — done in E4 with a test and en/zh wording adjusted — cost if wrong: an archived group with an unrecoverable frozen run, still visible under the Archived filter.
Ruling (E3 review minor 3): E4's gate refuses archive-group on an already-archived group with group-archived.
Task E3: minor (deferred): a queued estimate does not block archive while a drafting requirement round does (conservative, brief-mandated; E5 makes the estimate claim skip archived groups).
Ruling (D8): web/tests/workspaceMode.test.tsx "shows the reason next to the blocked state" rewritten to the explained reason + raw code (spec §4.2(5)/§2.2(a)); the 12 codex-* stop reasons added to refusalCoverage VIEW_REASONS so their en+zh coverage is enforced — cost if wrong: none.
Task D8: implemented 759930c. agentPreviewRefresh "re-reads a preview whose slot was unavailable five times…" 15 s timeout at load 19-22 in 3 full web runs, green alone and on a clean HEAD clone (7.7 s) — load-flake candidate (wall-clock backoff), not D8.
Task D8: review 1 — Needs fixes: Retry task shown under a stop intent / clarifying where the server always refuses (stop-mode-conflict); Minor: a terminal failure with taskId null falls back to Retry run (server refuses). Fix round 1 dispatched; archived-state hiding belongs to E10.
Task E4: complete (commits dd82218, 87c16c3, review clean).
Queued for the final fix wave (E4 minors): (1) refuse archived groups in preflightWebCommand (booked durably like revision-conflict) so group-archived precedes pre-transaction probes and no probe runs; (2) en/zh archive-stop-pending: add "if it is unresolved, retry recovery first"; (3) test: a command accepted before archiving replays its stored result afterwards; (4) walk test asserts NOT_GROUP verbs' target kind is not group/task.
Task D8: fix round 1/5 (3 addressed, 0 open; commit b95c88a)
Task D8: complete (commits 759930c, b95c88a). Note for E10: hide Retry task (and other actions) on an archived group (summary.archived).
Network drop (2026-10-09 ~08:10): E5, D9, E8 implementers terminated with ECONNRESET; worktree inspected — D9 had committed 34142f9; E5's server edits and E8's tests were uncommitted and intact; all three resumed from their transcripts.
Task E6: review 1 — Needs fixes (plan-mandated, stale after the E3 ruling): SKILL.md says handoff-partial blocks archive. E7: Approved; minors (stopState != null; no test without counts) folded into the same fix round.
Task D9: complete (commit 34142f9; real ccloop c82b212 clone build: whole file 10/10; mutations 1, 1b, 2, 3 red). Deviation: run 1 fails at a command check (usage stays known) instead of a codex exit — a codex crash without reported usage leaves usage unknown, which retry-task refuses (spec) and which blocks the group's dispatch.
Ruling (D9 concern 1): NOT implemented this round — a run whose usage is unknown (codex crashed without a usage report) can never be retried and blocks its group's dispatch; no v1 command clears unknown usage. This is a budget-accounting decision for the human. Recommendation: a human-only "settle unknown usage" that books the run's whole remaining grant as spent (conservative), clearing usageUnknown so retry-task and dispatch can proceed — cost if wrong: the gap stays as it is today (pre-existing).
Queued for the final fix wave (D9 concern 2): ensure en+zh explanations exist for codex-exit-error (ccloop sends `Error: codex-exit-error: …`).
Task E6: fix round 1/5 (1 addressed; commit 670bd4e). Task E6: complete (commits 0b33417, 670bd4e).
Task E7: fix round 1/5 (2 addressed; commit 7d9aaeb). Task E7: complete (commits dd06449, 7d9aaeb).
Task E5: implemented f66998b (claims, wakes, integration, estimate claim and requirement export skip archived groups). Minor: the estimator is probed once before the in-transaction refusal; archived groups' pending wakes are re-offered each round (one read; delivered on unarchive).
Task E8: implemented 80043fc (deviation: aria-labelledby built with [...ids].join(" ") so scanPanelText does not read it as visible text). Minor: duplicate selected-card CSS; chips shown above "list unavailable"; three *-subtle tokens defined only in the dark block (semi-transparent, work in light) — E9 owns per-theme category tokens.
Task E5: review 1 — Needs fixes: archived groups still trigger a ccloop probe child per pump pass (probe before the in-transaction check) in deliverScheduledStart and claimEstimate; Minor: RF4 test kinds; requirement-call reliance comment; export/integration check once before async work (low harm, comment). Fix round 1 dispatched.
Task E8: minor (deferred): "updated just now" clamp and missing-updatedAt branches untested; no bare legacy-summary GroupList case; clarifying <a> card untested and without aria-current; raw minutes ("4320 min ago"); useClock untested; duplicate selected CSS; chips above "list unavailable"; *-subtle tokens only in the dark block (E9).
Task E8: complete (commit 80043fc, review clean)
Task E5: fix round 1/5 (3 addressed, 0 open; commit 04d2876). controlShutdown SIGTERM 143 once under load, green alone (known flake).
Task E5: complete (commits f66998b, 04d2876)

## Handoff (2026-10-09, session e34dc963)
Stopped here by the human's request to hand off. Done: Parts A–D; E1–E8. Next: E9, E10 (also hide actions incl. Retry task on an archived group), E11, E12; then the final fix wave (every "Queued for the final fix wave" line above, plus D9's codex-exit-error explanation); then Part F (F2 gate, F3 final whole-branch review + ledger close + handoff; F1 re-pin after the human pushes ccloop). Briefs for E9–E12/F1–F3 are already extracted in this directory.
