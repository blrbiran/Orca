# SDD ledger — plan: docs/superpowers/plans/2026-09-29-labels-and-progress.md
Task 0: complete (controller; L1 baseline re-measured equal)
Task 1: complete (commits 3539a22..64c97d1, review clean)
Task 1: minor (deferred): extra export SystemLabel type alias, not in brief
Lesson: the Write tool NFC-normalized an NFD literal in a test (café); byte-precise rewrite needed — M1b caught it
Task 2: complete (commits 64c97d1..12a2432, review clean)
Task 2: minor (deferred): labels spread idiom duplicated in planImport.ts and planFile.ts (mirrors existing agent idiom)
Task 3: complete (commits 1569388..066c588, review clean)
Task 3: minor (deferred): taskCompletion issues one SQL query per plan task (N+1; plan-prescribed)
Task 4: Ruling: the brief's L4 test assumed a Web group reads "running" after claim; it never does (only the work item moves). Test writes group status "running" by hand like tests/control/proposal.test.ts:34 and keeps the assertion — why: L-2 requires the command not to check group state, and a hand-set state is the only way to put a running group in front of it — cost if wrong: the "running" cell is synthetic; if Web groups can never run, it pins a state no one reaches (open question for the human).
Task 4: minor (deferred): M4f/M4g/M4h also redden sibling its; reports should name the red line, not only the it.
Task 4: fix round 1/5 (3 addressed, 0 open — M4b and M4h now red on their own assertions; labels-version-conflict lookup added; commits 603d977..bd02590)
Task 4: minor (deferred): the new R7 lookup assertion (taskLabelsApi.test.ts:61) not individually seen red — only an applyWebCommand-ledger mutation would; not this task's code.
Task 4: complete (commits 066c588..bd02590, review clean after 1 fix round)
Task 5: Ruling: test harness wraps t.deps.router.resolve instead of replacing t.fake.port.collect — why: the router binds port methods at build time (profiles.ts ownPort), so the brief's replacement was never called and R2/P3 could not go red (empty green) — cost if wrong: none to production; the harness couples to router.resolve.
Task 5: complete (commits bd02590..bd08fd3, review clean)
Task 5: minor (deferred): currentProgress `if (!row)` branch unreachable (workViews already enforces currentRunId==newest); `report.progress !== undefined` guard has no observable effect (saveRun skips unchanged); progress stored before the candidate identity check (same as usage events).
Task 7: ⚠️ resolved by controller: webParity assigns GroupViewV1 both ways (tests/panel/webParity.test.ts:139,151), which reaches workItems[].progress.step.
Task 7: minor (deferred): baseLabelsVersion read at save time, not at draft start — a concurrent edit mid-draft is a lost update the server cannot catch (same convention as BudgetEditor baseProposalVersion; test title overclaims).
Task 7: minor (deferred): progressText grant===0 branch untested and unnamed.
Task 7: minor (deferred): TaskDetail system/custom input state carries across tasks (fix: key={taskId}).
Task 7: minor (deferred): malformed stored draft ignored but not cleared.
Task 7: Ruling: refusals shown through the existing control refusal channel rather than mounting Refusal.tsx — why: mounting both would show the same refusal twice; the code is shown as-is and tested — cost if wrong: a visual difference from spec §4.2's wording.
Task 7: fix round 1/5 (1 addressed, 0 open — stale label filter; commits 7ff6cae..be2de91)
Task 7: complete (commits bd08fd3..be2de91, review clean after 1 fix round)
Task 6: Ruling: fix the plan-mandated duplication (readProgress vs readTerminal) with one shared read of loop-state.json per collect — why: two reads can give terminal and progress from different moments, and the helper is small — cost if wrong: a slightly larger diff in ccloop collect.ts than the plan named.
Task 6: fix round 1/5 (1 addressed, 0 open — one shared loop-state read; ccloop commits 2ee1a8c..d542386)
Task 6: complete (ccloop commits b1c383e..d542386, review clean after 1 fix round; $SCRATCH/ccbin-lp built at d542386)
Task 6: minor (deferred): collect now validates loop-state.json on every call, so a malformed state fails collect for a still-running run (R17 by design; file is written atomically). No test pins terminal/progress from the same read (structural only).
Task 8: M8a red :29, M8b red :29 (replacement adjusted to `return null as unknown as ProgressV1` because the fixed progressOf is typed non-null), M8c red :37; restores 0/0.
Task 8: Ruling: Task 8's task review is folded into the plan-A final whole-branch review — why: its diff is one new E2E test file and its evidence is gates plus M8a–M8c — cost if wrong: one less independent seat on that file.
Task 8: complete (commits be2de91..d2ce41a; reviewed in the final review)
Final review (plan A): ready with fixes — Important 1 lost update on baseLabelsVersion + discard draft; Minor keys on ControlGroupView/TaskDetail → one fix wave dispatched. Important 2: stale push-order awaitingHuman (see below). Deferred minors left: R12 detail unbounded/unsanitized (planFile.ts:247), readTaskLabelState blocker detail lacks task id, T1–T6 minors, grant===0 untested.
Observed 2026-09-29 (ls-remote, this session never pushed): Orca origin/main = d2ce41a, ccloop origin/main = d542386, ccmem origin/main = e4e8309 — pushed by the human or the post-commit hook; Orca and ccloop landed together, so the push-order hazard did not occur. Comments in those commits are now published text (ERRATA only).
Declined by final reviewer, for the human: can a Web group ever reach "running"? CLI putWork (src/control/commands.ts:61) rebuilds a work body and would drop labelsOverride/labelsVersion — unverified whether it can reach a plan-imported Web group.
Final fix wave: commits d2ce41a..ce2d25c (draft carries its base labelsVersion, shows server moved, Discard; keys on ControlGroupView/TaskDetail).
NEW FINDING (pre-existing since 6a8fa6e, 2026-09-21; not this round's; registered, not fixed): web/src/controlState.ts:102 refetchRequired turns true on the first summary and never resets; App.tsx:481-486 depends on control.canonical, so the open group is re-read every 5–30 ms — a GET loop against a real panel.
Possible new flake (registered): web/tests/controlCommandRecovery.test.tsx "drops the id when the lookup returns the command's retained result" failed once in full npm run check, 3/3 alone. (Already listed as a load flake in Orca handoff §三.)
Ruling (fix wave): "restore plan labels" sends the current server labelsVersion, not a draft base — why: revert discards the draft by intent — cost if wrong: a concurrent edit between poll and revert is overwritten.
Final fix wave: re-review clean (2 addressed). PLAN A COMPLETE: Orca 3539a22..ce2d25c, ccloop b1c383e..d542386. Full two-repo gates re-run in plan B Task 15.
