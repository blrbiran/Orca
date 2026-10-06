# SDD ledger — plan: docs/superpowers/plans/2026-10-06-panel-project-filtering.md

Owner: Orca session 32306496 (Claude controller), 2026-10-06. Branch: main (human-approved: "在当前main分支上用subagent的方式实现").
Plan commit subject: `docs(plan): implement project filtering and the all-projects view`. Spec: docs/superpowers/specs/2026-10-06-panel-project-filtering-design.md (human-approved 2026-10-06).
Uncommitted `docs/handoff/handoff.md` belongs to session 01a10aca — never staged by this round.

## Preflight scan

| Pair / task | Produces → consumes | Finding |
|---|---|---|
| T1 ↔ T2 | server `GroupSummaryV1.repoId` → web type | `tests/panel/webParity.test.ts` is red between T1 and T2 (server required, web absent). |
| T2 → T3..T9 | web `repoId` → all scoping | ok |
| T3 → T4..T9 | `projectScope.ts`, `twoProjects.ts` fixture | ok; fixture extended by later tasks as needed |
| T4 ↔ T8 | NewRequirement target (T4) → per-target drafts (T8) | sequential, same file; ok |
| T4 ↔ T6 ↔ T7 | ControlPanel props added in each | sequential; each keeps prior props |
| T5 ↔ T9 | DecisionsView/App decision wiring | sequential; ok |
| T8 ↔ T9 | correction draft store (T8) → clear on success (T9) | T8 text says R2 late-success covers corrections, but the clear lives in T9 |
| T10 | handoff.md edit | file carries another session's uncommitted edit |
| T1 self | test sketch vs harness | test bodies are comments to be filled from harness API — implementer must read harness |
| T2 self | fixture list | candidate list must be re-derived live |
| T3 self | criteria 5/6 need group/requirement/decision opening | uses twoProjects fake; ok |
| T4 self | allowed edit (b) | ok, bounded by Global Constraints |
| T5..T9 self | ok | |
| SDD skill vs project | skill deletes workspace at end; project keeps ledgers in `.superpowers/sdd/**` (git add -f, history immutable) | conflict |

Ruling: T1 verifies with root tests excluding webParity; parity must be green at T2 step 3 — the server/web parity criterion is the gate for the pair, red between them costs nothing because no commit ships alone — if wrong, one intermediate commit has a red parity test.
Ruling: T8 stores correction drafts and keeps them across closure; clearing a correction draft on success is wired in T9 (where request records exist); T8's late-success criterion covers requirement forms — spec R2 is satisfied at T9 end — if wrong, a correction draft lingers after success between T8 and T9 only.
Ruling: T10 does not edit docs/handoff/handoff.md while another session's uncommitted edit is in it; handoff text goes into this ledger and is reported — Rule 3/13 forbid touching another agent's work — cost: human pastes/merges the handoff paragraph.
Ruling: this workspace is NOT deleted at the end; progress.md is committed with `git add -f` (project convention, Rule 13); briefs/reports/review packages stay as untracked scratch — cost: some scratch files remain on disk.

## Tasks
Task 1: dispatched (BASE e759ab5, sonnet)
Ruling (supersedes the T10 handoff ruling above, 2026-10-06): the human explicitly asked this session to update Orca/ccloop/ccmem docs/handoff/handoff.md after all plan work; the uncommitted §4.0 edit in Orca's handoff (session 01a10aca) is carried forward and merged, its conclusions kept, then committed with this round's update — cost if wrong: that session's wording is reshaped, but its conclusions stay.
Task 1: ⚠️ resolved by controller — blocked() throws (tests pass with toThrow, RC0 per report); clarifying-without-requirement-block is unreachable by construction (pre-existing assumption in requirementSummaryOf path).
Task 1: minor (deferred): readRequirementGroup read twice on clarifying group (controlViews.ts readGroupSummary).
Task 1: minor (deferred): partial-summary test shares readGroupSummary path with complete one.
Task 1: complete (commits e759ab5..b332299, review clean)
Task 2: dispatched (BASE b332299, sonnet)
Task 2: ⚠️ completeness resolved by controller — field is required; web tsc RC0 and `npm run check` RC0 (66 files/414 passed) per report prove no literal summary lacks it.
Task 2: complete (commits b332299..ac72d25, review clean)
Task 3: dispatched (BASE ac72d25, sonnet)
Task 3: implementer concern (per-section selectors leave All mode) — resolved: spec §3 'Changes from existing per-section project controls choose a concrete project and return to project mode'.
Task 3: review — Needs fixes: I1 first-run guard untestable claim (test6 comment), I2 project===null guard untested.
Task 3: minor (deferred): normalisation setProjectView unobservable except storage; bogus-storage half weak; JSON.parse unguarded in fake; per-section return-to-project untested.
Ruling: fixture gap "config fixed / memory status from constant" (Minor 3) is folded into fix round 1 — Task 4 criterion 3 (label fallback) needs a configurable config — cost if wrong: a few extra fixture lines.
Task 3: fix round 1/5 (2 addressed, 0 open; commits 8fa6379..dcec378)
Task 3: minor (deferred): fix-round RED evidence given as prose without exact command (re-verified in Task 10 mutations).
Task 3: complete (commits ac72d25..dcec378, review clean)
Task 4: dispatched (BASE dcec378, opus)
Task 4: BLOCKED — existing criterion web/tests/projectSwitcher.test.tsx "F: behaves as before when the project list cannot be read" (switcher spec D2: import into first repository when /api/projects fails) contradicts the approved filtering spec §3/§8 + plan P1 (unresolved scope: note, no import).
Ruling: rewrite criterion F as a whole (not weakened) to encode spec §3/§8: with /api/projects 500, Import plan button absent, the project-list-unavailable note shown inside the Import region, zero import POSTs, no Project combobox; add a comment naming the 2026-10-06 filtering spec §8 and this ledger ruling — the newer human-approved spec explicitly supersedes D2's fallback for scoped actions (Rule 7, evidence: newer + approved) — cost if wrong: one criterion text to revert and P1 to revisit; the change is reported to the human for review at the end.
Task 4: minor (deferred): M1 stale all-mode target survives project-list change (ControlPanel ImportForm / RequirementsPanel NewRequirement resolve target against full config, not choices).
Ruling: M1 is spec §8 "revalidate targets" — carried into Task 8's dispatch (Task 8 reworks NewRequirement targets) for both forms — cost if wrong: small extra scope in Task 8.
Task 4: minor (deferred): M2 project-mode NewRequirement falls back to first repo when scope.repoId not in config (pre-existing D4).
Task 4: minor (deferred): M3 all-mode Import lacks summary line / no-plan note.
Task 4: minor (deferred): M4 rewritten F has `imports` toEqual([]) that cannot fail on its own.
Task 4: minor (deferred): M5 stale header comment in projectFiltering.test.tsx ("Task 3 filters no list yet").
Task 4: complete (commits dcec378..27ef895, review clean)
Task 5: dispatched (BASE 27ef895, sonnet)
Task 5: minor (deferred): test 5 lacks a dedicated mutation (drop projectKey from decision read) — add to Task 10 mutation table.
Task 5: minor (deferred): header comment grammar in projectFiltering.test.tsx; kind/scope filter value may be absent from new project's options (pre-existing property).
Task 5: complete (commits 27ef895..e1e3256, review clean)
Task 6: dispatched (BASE e1e3256, sonnet)
Task 6: minor (deferred): no named mutation for deleting the panel-repo workspace read effect — add to Task 10 table.
Task 6: minor (deferred): readWorkspace not in effect deps (safe); ControlGroupView fallback to props.workspace relies on repoId guard; fixed 450ms sleeps in late-reply criteria (flake risk).
Task 6: complete (commits e1e3256..310a2ab, review clean)
Task 7: dispatched (BASE 310a2ab, opus)
Checkpoint: orca checkpoint write rejected (dirty-worktree: docs/handoff/handoff.md, session 01a10aca's uncommitted edit). Committing that edit alone was denied by the permission classifier — left for the human; checkpoint not written. Context level at that point (hook): 334438/1000000 (past T1 330000, below T2 450000).
Task 7: review — Needs fixes: I1 repo-label branch unpinned; I2 App does not keep blockers visible-but-non-actionable across an epoch change (reduceRecovery purges and drops the new-epoch recovery).
Ruling (I2): reduceRecovery on an epoch change keeps the purge (groups/canonical voided, refetchRequired true) but stores the arriving recovery view (it IS the new epoch's truth), so blockers render and stay non-actionable until the complete refetch lands — spec §11 R1 "remain visible but non-actionable" — cost if wrong: one reducer line; stop if an existing controlState criterion asserts recovery null after an epoch change.
Ruling: minors 3 (fallback send path unpinned) and 4 (Re-read only when disabled) folded into fix round 1 — cheap criteria; minor 5 (redundant epoch===null clause, isolating recovery-epoch test) deferred.
Task 7: minor (deferred): redundant `state.epoch === null` clause; no isolating test for recovery.epoch≠target.epoch; weak "no POST" timing in criterion 4; RED read via grep (Rule 14) — Task 10 re-runs mutations with whole read-back.
Task 7: fix round 1/5 (4 addressed, 0 open; commits cdf0546..bd7e209)
Task 7: minor (deferred): an OLD-epoch recovery read arriving after a newer summary is now stored (pre-existing purged() epoch-regression shape; refetchRequired keeps Retry disabled); no reducer test for it; dispatchBlocked taken from that view — for final review triage.
Task 7: complete (commits 310a2ab..bd7e209, review clean)
Task 8: dispatched (BASE bd7e209, opus) — carries Task 4 M1 ruling
Task 8: review — Needs fixes: I1 unowned-draft adoption guards (setUnowned(null); target-has-no-draft check) unpinned; deleting setUnowned(null) copies Alpha's adopted text into Beta.
Ruling: accept implementer deviation 1 (inputs enabled with no all-mode target; unowned text adopted on explicit choice) — forced by existing Task 4 criterion 7 and not a cross-project carry — cost if wrong: one UX nuance.
Ruling: fold Minor 1 (re-listed target silently re-chosen — reset form-local target once seen unheld, keep the derived guard too, show both red), Minor 2 (drop unowned text on any explicit target choice; never resurfaces later), Minor 3 (show submit guard mutation red) into fix round 1 — spec §6 "disables submission until the person chooses a valid target" — cost if wrong: small extra state.
Task 8: minor (deferred): standalone DecisionDetail own state survives decision prop change (test-only path, pre-existing shape).
Ruling: two unobservable redundant guards kept (NewRequirement per-render held check; ImportForm setPlanId(null) in reset) — both are covered by the reset effect / select handler, so no criterion can isolate them (Rule 9 tension recorded, not hidden) — cost if wrong: two lines of dead-in-practice defensive code for the final review to triage.
Task 8: fix round 1/5 (4 addressed, 0 open; commits c66120d..7f5d5f8)
Task 8: minor (deferred): selecting the placeholder with unowned text may store a draft under key "" (pre-existing shape).
Task 8: complete (commits bd7e209..7f5d5f8, review clean)
Task 9: dispatched (BASE 7f5d5f8, opus)
Task 9: review — Needs fixes: I1 open owner's older non-active refusal hidden (notice excludes whole owner); I2 eviction can drop a pending record.
Ruling (I1): notice excludes only the record shown inline, not the whole owner — departs from brief's noticeRequests wording, spec §8 visibility wins — cost if wrong: a duplicate-looking line for the open decision.
Ruling: fold Minor 3 (Rule 9 gaps: pending-no-Dismiss, dismissed-not-inline, notice retry needs again), Minor 4 (aria-live polite on notice), Minor 5 (header map) into fix round 1; Minor 6 (App.tsx header ERRATUM prose) and i18nPseudo coverage of DecisionOperations go to Task 10.
Ruling (Task 10 scope): each task already ran its own named deletion mutations in clones with 0-byte restore proofs (reports task-1..9). Task 10 does NOT re-run all of them; it runs the full isolated gates once on the final tree, runs the mutations deferred by reviews (Task 5 test 5: drop projectKey from decision read; Task 6: delete panel-repo workspace read effect), aggregates every task's mutation table into the ledger, and appends spec §12 — cost if wrong: a mutation that went red at task time but stopped biting after a later task is not re-detected (final review is told).
Ruling: DecisionOperations i18nPseudo coverage would edit an existing criterion — not done; recorded as follow-up. App.tsx header ERRATUM prose about the single `outcome` gets an appended named ERRATUM in Task 10 (comment only).
Task 9: fix round 1/5 (5 addressed, 0 open; commits 04ef7ab..de90805)
Task 9: minor (deferred): garbled sentence in projectScopeDecisionRequests.test.tsx header; dismissRequest does not guard pending; F5 red via queryByRole throwing on multiples.
Task 9: complete (commits 7f5d5f8..de90805, review clean)
Task 10: dispatched (BASE de90805, sonnet)
Task 10: gates + deferred mutations done (details below); spec §12 and App.tsx ERRATUM written.

## Final gates (Orca session 32306496, 2026-10-06)

Tree tested: `git clone --local` of main at de90805 `fix(web): keep every unseen decision result in the notice and never evict a pending one` (clone `$SCRATCH/orca-pf-final`; `npm ci --offline` failed ENOTCACHED for the ccloop git dependency, so a normal `npm ci` with the real HOME's npm cache installed, RC 0). Gates ran with HOME and the four XDG roots under `$SCRATCH/pfhome`, `ECC_GATEGUARD=off DISABLE_OMC=1`. Raw output: `$SCRATCH`=`/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/32306496-f454-4168-9a99-fb0d94a31ff6/scratchpad`, under `g/`.

Environment corrections found while gating (recorded, not hidden):
- First pass used TMPDIR=`$SCRATCH/t` (about 150 chars) and no ORCA_CCLOOP_BIN/ORCA_AGENTS_TABLE: verify:control RC 1 (`verify:control requires ORCA_CCLOOP_BIN and ORCA_AGENTS_TABLE`, `g/vcontrol.txt`), verify:panel RC 1 (tsx IPC pipe path too long for a unix socket, reported as EADDRINUSE, `g/vpanel.txt`, `g/vpanel2-longtmpdir.txt`), full `npm test` 53 failed / 2696 passed / 58 skipped (`g/fulltest.txt`: ccloop bin not found). Those runs measure the environment, not the tree, and are superseded.
- Second pass pointed ORCA_CCLOOP_BIN at the installed package (no tests/ directory): 93 failed (`g/run1/fulltest2.txt`, `g/run1/vcontrol2.txt`: fake-codex.mjs not found). Superseded.
- Final pass: TMPDIR=`/private/tmp/claude-501/pf32/t` (short, real), ORCA_CCLOOP_BIN=`$SCRATCH/ccloop-pf/dist/cli.js` (clone of ccloop at the pinned c3af4d6, `npm ci` + `npm run build`), ORCA_AGENTS_TABLE=`$SCRATCH/tbl/agents.json` (one codex installation: node + fake-codex.mjs `integration`, mode 0600 in a 0700 dir).

| Gate | Command | RC | Counts | Output |
|---|---|---|---|---|
| typecheck | `npm run typecheck` | 0 | clean | g/typecheck.txt |
| ws check | `npm run --ws check` | 0 | web 70 files, 486 tests passed | g/wscheck.txt |
| web build | `npm run build --workspace web` | 0 | | g/build.txt |
| root focused | vitest projectGroupScope, webProtocol, webParity | 0 | 3 files, 20 tests | g/rootfocus.txt |
| web focused | vitest 9 named files (projectFiltering, projectSwitcher, projectRegistry, controlPollSettles, decisionsView, decisionDetail, projectScopeRecovery, projectScopeDrafts, projectScopeDecisionRequests) | 0 | 9 files, 103 tests | g/webfocus.txt |
| verify:panel | `npm run verify:panel` | 0 | PASS 0-14, no FAIL | g/vpanel3.txt |
| verify:control | `npm run verify:control` | 0 | 127 files, 1315 passed, 4 skipped | g/vcontrol3.txt |
| full test | `npm test` | 1 | 305 files: 302 passed, 3 failed; 2807 tests: 2798 passed, 3 failed, 6 skipped | g/fulltest3.txt |

Full-run failures (3), all already registered in handoff §4.0 as load-type flakes (load at the run's start about 16, 1-minute load peaking above 30 mid-run; `uptime` in `g/rc3.txt`):
- `tests/control/driverRecovery.test.ts` "drives a retried run on from where it was blocked, to settled" (registered: driverRecovery)
- `tests/control/driverRequirementSplit.test.ts` "fails the third consecutive invalid draft as split-validation-exhausted, and a schema-invalid one as split-output-invalid" (registered flake)
- `tests/panel/controlShutdown.test.ts` "makes it exit cleanly, having written one shutdown row for its epoch" (registered: exit 143)
Single-file re-runs after load fell (`uptime` 12:32 load 2.98, then 3.13; `g/rerun.txt`): driverRecovery 8/8, driverRequirementSplit 8/8, controlShutdown 6/6, all RC 0. Known is not closed: they are flakes under load, not shown fixed. No gateCheck K13 and no ccmemAdapter ENOEXEC failure occurred in this run. Not in the registered list: none.

Skips by name (6 in full run; the same two files plus none other in verify:control's 4): `tests/control/ccloopDefaultE2E.test.ts` (3, formal only), `tests/control/driverSkillsReal.test.ts` (1), `tests/skills/syncskillReal.test.ts` (1), `tests/memory/ccmemReal.test.ts` (1). verify:control skips: ccloopDefaultE2E (3) + driverSkillsReal (1). Those real-binary files are skipped because no real syncskill/ccmem/ccloop-default binary env is set here; they are not claimed green.

Not re-run on the final pass (they passed on the first pass, before env corrections, and do not depend on it): typecheck, ws check, web build, root focused, web focused. All of them ran on the same tree (de90805; the only later edits are the App.tsx comment and docs).

## Deferred mutations (run in a fresh `git clone --local` at de90805, `$SCRATCH/orca-pf-mut`, node_modules symlinked; baseline projectFiltering 30/30 RC 0, `g/mut/base.txt`)

| Mutation | Criterion that went red | Result | Output |
|---|---|---|---|
| Task 5 deferred: `fetchDecision(selected.projectKey, selected.id)` -> `fetchDecision("", selected.id)` in App.tsx (decision read without its project) | "decision identity and count > 5: opening alpha/d1 reads alpha's decision, not beta's, though both are d1" (also selection lifecycle 5, 6, 7 and decision identity 2) | RED, RC 1, 5 failed / 25 passed | g/mut/m5.txt |
| Task 6 deferred: delete the panel-level workspace read effect call `void readWorkspace(panelRepoId);` | "group workspace > 1", "> 2b", "> 3" | RED, RC 1, 3 failed / 27 passed | g/mut/m6.txt |

Both restored with `git checkout -- web/src/App.tsx`; `git diff | wc -c` = 0 and `git diff --cached | wc -c` = 0 after each. No new criterion was needed. The mutation clones and the gate clones are deleted after this round.

## Aggregated mutation table (copied from the task reports; each marked "as reported by task N"; not re-run in Task 10 except the two above, per the ruling "Task 10 scope")

| Task | Mutation | Criterion made red | Status |
|---|---|---|---|
| 1 | none run ("Mutations not run (Task 10)") | | not run at task time and not re-run; gap, see below |
| 2 | none (type-only change; RED was the 38 TS2741 errors across 33 files) | tsc | as reported by task 2 |
| 3 | drop `previous === null ||` in the close effect | projectFiltering criterion 7 | red, as reported by task 3 (fix round 1) |
| 3 | drop `if (project === null) return;` | criteria 7 and 8 | red, as reported by task 3 |
| 4 | M1 control list filter | 1, 4, 5, 8 | red, as reported by task 4 |
| 4 | M2 control unresolved note | 5 | red |
| 4 | M3 All label | 2, 3, 8 | red |
| 4 | M4 uncertain-command line lists every command | 9 | red |
| 4 | M5 owner label | 9 | red |
| 4 | M6 import unresolved branch | 5 | red |
| 4 | M7 import All branch | 6 | red |
| 4 | M8 import disabled until a target is chosen | 6 | red |
| 4 | M9 import targets filter | 6 | red |
| 4 | M10 requirements filter | 1, 4, 5 | red |
| 4 | M11 requirements label | 2 | red |
| 4 | M12 requirements unresolved note | 5 | red |
| 4 | M13 NewRequirement unresolved | 5 | red |
| 4 | M14 null-repo note | 4 | red |
| 4 | M15 All target | 7 | red |
| 4 | M16 submit needs a target | 7 | red |
| 4 | M17 choice stays local | 7 | red |
| 4 | M18 target reset on mode change | 7 | red |
| 4 | M19 NewRequirement targets filter | 7 | red |
| 4 | M20 requirement-open scope guard | 10 | red |
| 4 | M21 repoLabel project join | 2, 6, 7, 8, 9 | red |
| 4 | M22 repoLabel config fallback | 3 | red |
| 4 | M23/M24 App passes scope | many | red |
| 4 | F: delete ImportForm's unresolved branch | projectSwitcher "F: offers no import while the project list cannot be read" | red, as reported by task 4 |
| 5 | M1 rows unrestricted | decision identity 1 (+4) | red, as reported by task 5 |
| 5 | M2 filter not forced | 8 | red |
| 5 | M3 always scope | 7 (+ lifecycle 7/8, lists 5) | red |
| 5 | M4 no chooseAll onChange | 4 | red |
| 5 | M5 no All option | 4 | red |
| 5 | M6 value ignores all | 4 | red |
| 5 | M7 unforced onFilter | none | GREEN: dead code, removed |
| 5 | deferred: decision read without projectKey | decision identity 5 | red in Task 10 (above) |
| 6 | M1 detail ignores workspaceFor | group workspace 1, 2 | red, as reported by task 6 |
| 6 | M2 seq guard removed | 2b | red |
| 6 | M3 open-group read removed | 1, 2 | red |
| 6 | M4 panel selector shown in All mode | 3 | red |
| 6 | deferred: delete panel-repo workspace read effect | group workspace 1, 2b, 3 | red in Task 10 (above) |
| 7 | M1 selected-group revision | projectScopeRecovery App 1, 2, 3 | red, as reported by task 7 |
| 7 | M2 first summary | App 4; unit "no summary" | red |
| 7 | M3a omit target check: empty groupId | unit "empty (global) groupId" | red |
| 7 | M3b omit target check: missing summary | App 4; unit "no summary" | red |
| 7 | M4 omit epoch check | 5; unit "epoch not the one rendered from" | red |
| 7 | M5 omit refetch check | unit "complete re-read is pending" | red |
| 7 | M6 allow a vanished blocker | unit "no longer lists" (recovery, group view) | red |
| 7 | M7 clarifying through the normal group view | App 2 | red |
| 7 (fix 1) | N1 reduceRecovery drops the arriving recovery | 7 | red |
| 7 (fix 1) | N2 repo() returns "" | 1 | red |
| 7 (fix 1) | N3 label borrowed from the first summary | 4 | red |
| 7 (fix 1) | N4 fallback press never calls onCommand | 8 | red |
| 7 (fix 1) | N5 Re-read on an enabled row | 1 | red |
| 8 | M1a answer draft solely in RoundForm useState | projectScopeDrafts 1 | red, as reported by task 8 |
| 8 | M1b feedback solely in DraftReview useState | 1 (and 3) | red |
| 8 | M1c limit solely in RaiseLimit useState | 1 | red |
| 8 | M1d correction solely in DecisionDetail | 1 | red |
| 8 | M1e new requirement in one form-local draft | 4 | red |
| 8 | M2a answerKey without owner | 1; unit injectivity | red |
| 8 | M2b feedbackKey without owner | 1; unit injectivity | red |
| 8 | M2c limitKey without owner | 1; unit injectivity | red |
| 8 | M2d correctionKey without owner | 1; unit injectivity | red |
| 8 | M3 reuse previous owner's inputs | 4 | red |
| 8 | M4a drop current-id payload check | 1 | red |
| 8 | M4b drop editable-state check | 2 | red |
| 8 | M5 unconditional clear on delayed success | 3 | red |
| 8 | M6a NewRequirement target from full config | 5 | red |
| 8 | M6b ImportForm target from full config | 5 | red |
| 8 | M7 clearIfUnchanged ignores equality | 3; unit | red |
| 8 (fix 1) | A delete setUnowned(null) | 4b | red |
| 8 (fix 1) | B delete the draft-less guard | 4b | red |
| 8 (fix 1) | C drop the unowned text only when taken | 4b | red |
| 8 (fix 1) | D delete NewRequirement reset effect | 5 | red |
| 8 (fix 1) | E delete ImportForm reset effect | 5 | red |
| 8 (fix 1) | F delete NewRequirement derived guard | none | GREEN: redundant with the reset effect (recorded Rule 9 tension, ruling in this ledger) |
| 8 (fix 1) | G delete ImportForm derived guard | 5 | red |
| 8 (fix 1) | H delete the submit guard | 5 | red |
| 8 (fix 1) | I delete setPlanId(null) in the ImportForm reset | none | GREEN: redundant (recorded) |
| 9 | M1 unconditional inline outcome | projectScopeDecisionRequests 1 | red, as reported by task 9 |
| 9 | M2 owner but not request identity | 3; pure startRequest/settleRequest/inlineRequest | red |
| 9 | M3 retry reads the current form | 2 | red |
| 9 | M4 remove old-owner global notice | 1, 2, 3, 4, 5 | red |
| 9 | M5 discard records on scope change | 1, 2, 3, 4, 5 | red |
| 9 | M6 clear correction draft unconditionally | 6 | red |
| 9 | M7 Agree refusal keeps retry_field inline | 5 | red |
| 9 (fix 1) | F1 notice excludes the whole open owner | 8; pure noticeRequests | red |
| 9 (fix 1) | F2 evict index -1 to 0 | pure "never evicts a pending record" | red |
| 9 (fix 1) | F3 Dismiss on pending lines | 4 | red |
| 9 (fix 1) | F4 dismissed record shown inline | 4 | red |
| 9 (fix 1) | F5 notice Record another without retry_field === "again" | 9 (via testing-library multiple-elements error) | red |
| 9 (fix 1) | F6 notice Record another for an Agree | 5 | red |

Named mutations from the Task 10 brief that no task report lists as run: Task 1 server rows (omit repoId, first repository instead, clarifying via plan, remove required repoId schema check, omit plan restriction) and several Task 3 rows (label from selected project, remove selection reset, remove workspace seq guard, scope recovery list, selected-only waiting list, drop mode storage try/catch, drop one-project normalisation, filter reducer inputs, reset on scope change) are covered, if at all, only by the Task 4/6/7 rows above under different names (M1 control filter, M6 seq guard, M21 repoLabel join, Task 3's two guards). Per the controller ruling these were not re-run: a mutation that was red at task time and stopped biting after a later task is not re-detected; Tasks 1's five server rows have no run at all in any report (cost recorded for the final review).

## Documents written in Task 10
- Spec §12 appended to `docs/superpowers/specs/2026-10-06-panel-project-filtering-design.md`: `git diff --numstat` shows 33 added, 0 removed; §§1-11 byte-for-byte unchanged.
- `web/src/App.tsx`: named ERRATUM (2026-10-06, session 32306496, spec §11 R3) appended at the end of the header comment; comment only, existing text verbatim (`git diff --numstat`: 6 added, 0 removed).
- Fixture-edit list for the round: allowed edit (a) Task 1/2 literal group summaries (tests/control/webProtocol.test.ts and the 33 web fixture files per task 2 report); allowed edit (b) Task 4 nine App-rendering fixture files (route /api/projects), listed in the Task 4 commit body; the projectSwitcher criterion F rewrite (Task 4 ruling above). No other existing assertion was edited.
- handoff.md: not touched or staged by Task 10 (the controller merges the handoff).
Task 10: complete (commits de90805..528fe8a) — gates per Final gates section; full suite 3 registered load flakes (driverRecovery, driverRequirementSplit, controlShutdown), each green alone.
Ruling: Task 10's diff (spec §12 append, App.tsx comment ERRATUM, ledger) is reviewed inside the final whole-branch review instead of a separate task review — docs/comment only — cost if wrong: one less review seat on docs.
Ruling: Task 1's five server mutations (omit repoId; first repository; misroute clarifying; drop required schema; drop mismatch check) were never run — run now by a dedicated subagent before the final review (spec §9 requires them) — cost: one small dispatch.

## Task 1 server mutations (run after Task 10)

Orca session 32306496, clone of main at 528fe8a, command `vitest run tests/panel/projectGroupScope.test.ts tests/control/webProtocol.test.ts`. Baseline green (RC=0, 16 tests): /private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/32306496-f454-4168-9a99-fb0d94a31ff6/scratchpad/t1mut-base.txt. Every mutation was restored with `git checkout -- <file>`; `git diff | wc -c` and `git diff --cached | wc -c` were both 0 after each.

| # | Mutation | Red test(s) (all in projectGroupScope.test.ts) | Raw output |
|---|----------|------------------------------------------------|------------|
| M1 | omit `repoId` from the summary object (controlViews.ts) | 4 red: names the archived plan's repository; names the requirement's repository on a clarifying group; same repoId in a sinceChangeSeq summary; refuses to guess when plan and requirement disagree | /private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/32306496-f454-4168-9a99-fb0d94a31ff6/scratchpad/t1mut-M1.txt |
| M2 | `repoId` replaced by the constant "first-repo" (fixtures are single-repo, so a literal other repo stands in for "first repository") | same 4 red | /private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/32306496-f454-4168-9a99-fb0d94a31ff6/scratchpad/t1mut-M2.txt |
| M3 | clarifying branch uses "repo-other" instead of the requirement's repoId | 1 red: names the requirement's repository on a clarifying group | /private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/32306496-f454-4168-9a99-fb0d94a31ff6/scratchpad/t1mut-M3.txt |
| M4 | `groupSummarySchema.repoId` made `.optional()` (webProtocol.ts) | 1 red: rejects a summary without repoId and one with an invalid repoId | /private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/32306496-f454-4168-9a99-fb0d94a31ff6/scratchpad/t1mut-M4.txt |
| M5 | delete the repository-mismatch check (controlViews.ts) | 1 red: refuses to guess when an accepted requirement group's plan and requirement disagree | /private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/32306496-f454-4168-9a99-fb0d94a31ff6/scratchpad/t1mut-M5.txt |

No mutation stayed green, so no test was added. Restore byte counts: diff=0 cached=0 for M1-M5.
Final review: ready with fixes — I1 unrun spec §9 mutations (ledger gap list); I2 all-mode Import hides its plan (Task 4 M3); I3 handoff stale (handled by the controller's handoff step). Minors folded into the single fix wave: M1 project-mode NewRequirement first-repo fallback → note; M3 §12 R2 wording → appended correction line; M5 Import note wording. Other minors triaged "can stay" per final review.
Final fix wave: dispatched (BASE 82b5d76, sonnet)

## Final fix wave (Orca session 32306496, 2026-10-06)

Fixes: f5a5d6d (B: All-mode Import summary and `control.import.noPlan`; C: project-mode NewRequirement `requirements.repositoryNotConfigured` instead of `repositories[0]`; criteria 11-13 in projectFiltering), 342f48b (E: appended correction line in spec §12), 4298767 (new criterion 9, "selection lifecycle"). D (own key for the Import unresolved note) is NOT done: projectSwitcher F asserts the exact old text "The project list is unavailable; groups are not shown until it is read." with `toBe` in the Import region, and the brief forbids editing its assertions; reported to the controller.

Mutations run in a fresh `git clone --local` (`$SCRATCH/fw/clone`, `npm ci`, HOME + 4 XDG under `$SCRATCH/fwhome`, TMPDIR `/private/tmp/claude-501/pf32/t`), at 342f48b. Baseline green first: 6 files (projectFiltering, projectScopeRecovery, projectScopeDrafts, projectScopeDecisionRequests, projectSwitcher, controlPollSettles), 85 tests, RC 0 (`fw/base2.txt`). One mutation at a time, each restored with `git checkout -- <file>`; `git diff | wc -c` = 0 and `git diff --cached | wc -c` = 0 after every one. Raw output `fw/mut-<name>.txt`.

| Mutation | Red criteria (file > test) | Diff/cached after restore |
|---|---|---|
| M1 label joined with the selected project | projectFiltering two-project lists 2, 3, 6, 7, 8, 9; projectScopeRecovery App 1 | 0 / 0 |
| M2a drop setSelectedGroup(null) | projectFiltering selection lifecycle 5, 6 | 0 / 0 |
| M2b drop setSelectedRequirement(null) | selection lifecycle 6; projectScopeDrafts 1 | 0 / 0 |
| M2c drop setSelected(null) (decision) | selection lifecycle 5, 6; projectScopeDecisionRequests 1, 2, 3, 4, 5, 9; projectScopeDrafts 1 | 0 / 0 |
| M3a clear detail drafts on switch | projectScopeDrafts 1, 4, 4b | 0 / 0 |
| M3b clear control (task) drafts on switch | none (GREEN, 85/85) -> added criterion; with it: projectFiltering selection lifecycle 9 red (86 tests, 1 failed) | 0 / 0 |
| M4 import plans unrestricted | projectFiltering two-project lists 6, 11, 12; projectSwitcher A | 0 / 0 |
| M5a recovery list scoped to the selected project | projectScopeRecovery App 1, 2, 3, 4, 6; epoch-change 7 | 0 / 0 |
| M5b waiting (uncertain) list scoped to listed groups | projectFiltering two-project lists 5, 9 | 0 / 0 |
| M6 drop the mode storage read | projectFiltering persistence 2, 3; decision identity 5; projectScopeDrafts 4, 4b, 5 | 0 / 0 |
| M7 drop its try/catch | projectFiltering persistence 4; projectSwitcher D2 | 0 / 0 |
| M8 drop one-project normalisation | projectFiltering persistence 3 | 0 / 0 |
| M9 filter reducer inputs by scope | projectFiltering workspace 1, 2; lifecycle 5; lists 1, 2, 3, 8, 9; projectScopeDrafts 1; projectScopeRecovery App 1, 2, 3, 7 | 0 / 0 |
| M10 reset/refetch on scope change | projectFiltering (workspace 1, 2, 2b; lifecycle 5; lists 1, 2, 3, 4, 6, 7, 8, 10, 11, 12), projectScopeDrafts 1, 4, 4b, projectSwitcher A, A2, C | 0 / 0 |

13 of 14 mutations were red at once; M3b was green and now has criterion 9 (red on that mutation in the clone, green on main). New criteria 11-13 were shown red in the clone with `git checkout 82b5d76 -- web/src` (3 failed, 30 passed; restored to HEAD, diff/cached 0/0; `fw/newred.txt`).

Gates (clone at 4298767, raw output under `$SCRATCH/fw/`): `cd web && npm run check` RC 0, 70 files / 490 tests (`g-check.txt`); root `npm run typecheck` RC 0 (`g-typecheck.txt`); focused projectFiltering, projectSwitcher, requirements, requirementsApp, i18nKeys RC 0, 5 files / 71 tests (`g-focus.txt`). Not re-run: full root `npm test`, verify:control, verify:panel (no change under src/ outside web).
Ruling: final-review Minor 5 (Import unresolved note wording) parked — fixing it requires editing the ruled rewrite of projectSwitcher F again; wording is cosmetic — cost if wrong: one slightly off note sentence remains.
Final fix wave: re-review — A, B, C, E ADDRESSED; no existing assertion edited; no new breakage; D parked by ruling (commits 82b5d76..aee8bb2).
Round status: all 10 tasks complete; final review findings fixed or parked with rulings. Workspace kept (project convention). Gates not re-run after the fix wave for root `npm test`/verify:control/verify:panel (fix wave ran web check 490/490, typecheck, focused) — next agent may re-run the full isolated gate once.

## Post-fix-wave gate (Orca session 6cc0c1e9, 2026-10-06)

Closes the gap noted in the handoff: after the final fix wave only web check and typecheck had run. Tree tested: `git clone --local` of main at 0d0d9ff `chore(checkpoint): orca-dev-32306496, level 429360 of 1000000 (T1 330000, T2 450000, band 1)` (no product change after aee8bb2). `npm ci` RC 0. HOME and the four XDG roots under the session scratchpad `home/`; TMPDIR=`/private/tmp/claude-501/og6/t` (short, real); `ECC_GATEGUARD=off DISABLE_OMC=1`; ORCA_CCLOOP_BIN = a fresh clone of ccloop checked out at the pinned c3af4d6, `npm ci` + `npm run build` (RC 0, has tests/fixtures); ORCA_AGENTS_TABLE = one codex installation, node + that clone's fake-codex.mjs `integration`, file 0600 in a 0700 dir. Raw output: `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/6cc0c1e9-7313-4a5e-942a-f02129bf4027/scratchpad/g/` (session scratchpad; gone when the session ends — the conclusions are here).

| Gate | Command | RC | Counts | Load (1/5/15 at start → end) |
|---|---|---|---|---|
| web build | `npm run build --workspace web` | 0 | | 2.02 2.38 2.93 |
| typecheck | `npm run typecheck` | 0 | clean | 2.02 → 2.42 |
| full test | `npm test` | 1 | 305 files: 304 passed, 1 failed; 2807 tests: 2800 passed, 1 failed, 6 skipped | 2.42 2.46 2.96 → 4.09 6.54 5.31 |
| verify:control | `npm run verify:control` | 0 | 127 files, 1315 passed, 4 skipped | 4.09 → 8.15 7.18 6.01 |
| verify:panel | `npm run verify:panel` | 0 | PASS 0-14, no FAIL | 8.15 → 7.21 |
| tmp leak | `node scripts/check-tmp-leak.mjs` | 0 | its own suite run: vitest exit 1, 2807 tests, 0 entries left | 7.21 → 5.35 8.28 7.07 |

Full-run failure (1), registered load flake: `tests/control/driverRequirementSplit.test.ts` "fails the third consecutive invalid draft as split-validation-exhausted, and a schema-invalid one as split-output-invalid" — `Test timed out in 5000ms`. Single-file re-run three times right after (load 4.24 → 3.89): 8/8 each, RC 0 (`g/rerun.txt`). driverRecovery and controlShutdown did not go red this time; that does not close them.

Not known: which test failed inside the tmp-leak script's second suite run — the script discards its JSON report and only counts leftovers; it is the leak guard, not a test gate. Skips (6) are the same real-binary files as the Final gates section; not claimed green.
