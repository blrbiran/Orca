# SDD ledger — plan: docs/superpowers/plans/2026-09-30-loop-plans.md

> Session `1d7d9aa0` (controller), started 2026-09-30 on Orca main at `65e64a3` (plan commit). Append-only; corrections in a new line.
> Human standing instruction (D10): decide problems by the controller's recommendation, report at the end.

Ruling: work on local `main`, not a branch — the recent rounds (backlog hardening, pin script, #13) landed as local commits on main and the human pushes; a branch would add a human merge step (Rule 15) for no isolation gain, since no other agent is working in this tree (git worktree list shows only old, unrelated worktrees) — cost if wrong: the human has to review 14 tasks' commits on main instead of one branch; nothing is pushed.
Ruling: implementers get model sonnet for tasks whose plan text carries complete code, opus for B1/B2/B3/B6 (multi-file integration with the control store and snapshot) — cost if wrong: more fix rounds on a sonnet task.
Preflight scan: .superpowers/sdd/2026-09-30-loop-plans/preflight.md (10 findings). Rulings P1–P10 in rulings.md, summarised:
Ruling: P1 English for the six strings the R-F5 table missed, singular forms for 1 — the panel is English and "1 check commands" is wrong — cost if wrong: string churn only.
Ruling: P2 investigate-max-files after path-shape and investigate-target; A1 + A3 criteria — refusal order is deterministic and tested — cost if wrong: a different refusal name for a doubly bad input.
Ruling: P3 every new branch gets its own deletion mutation even where the plan's list omits it — Rule 9 — cost: more mutation runs.
Ruling: P4 B7's criterion raises work.tokens itself — so the full-rebuild mutation is seen red on the shipped criterion — cost: none known.
Ruling: P5 no duplicated production logic; extract editProposal's reserve-and-reopen sequence into one helper if B2 needs it — duplicated conservation code would drift — cost: a behavior-preserving refactor inside B2, guarded by existing criteria.
Ruling: P6 duplicated test scaffolding accepted — test-only, single rounds — cost: later cleanup.
Ruling: P7 drop assertions that cannot fail (A4 planHash self-equality, A2 self-equality) — Rule 9 corollary 2 — cost: none.
Ruling: P8 every implementer on Opus 5.5 so the mandated Opus trailer is true — the human asked for that exact trailer; a Sonnet agent signing as Opus would be false attribution — cost: higher spend per task.
Ruling: P9 a bad file cap gets its own message — accuracy — cost: none.
Ruling: P10 superseded plan lines are named in rulings.md instead of editing the plan — one source for implementers without rewriting a 3.5k-line plan — cost: an implementer who skips rulings.md follows stale text (the reviewer gets rulings.md too).
Task A1: dispatched (BASE 65e64a3, implementer opus)
Task A1: implementer DONE_WITH_CONCERNS, commit 2ce72e2 (85 criteria, 32 mutations, 28 red; equivalent mutants MX-4/MX-20b/MX-20c green; MX-2 red under typecheck only). Review dispatched (sonnet).
Ruling: implementers run criteria without ECC_GATEGUARD/DISABLE_OMC (the harness classifier refused them) — they only silence local hooks, not test behavior; the gate clone sets them — cost if wrong: noisier hook output in task runs.
Task A1: minor (deferred): loopPlans.ts startsWith("/") is dead (empty-segment check covers it) — MX-4 equivalent.
Task A1: minor (deferred): newest-version selection untestable with one version per plan (MX-20b/c); the first v2 must add a "current is highest" criterion.
Task A1: minor (deferred): R-F15 sub-conditions covered by cases, only the whole-statement mutation was run.
Task A1: complete (commits 65e64a3..2ce72e2, review clean)
Task A2: dispatched (BASE 2ce72e2, implementer opus)
Task A2: implementer DONE_WITH_CONCERNS, commit d40eed2 (11 criteria, 7 mutations red; concern: no multi-path separator criterion)
Task A2: minor (deferred): the ", " path joiner is unpinned (all fixtures have one path).
Task A2: minor (deferred): describeLoopPlan does not validate inputs (callers pass expanded recipes).
Task A2: complete (commits 2ce72e2..d40eed2, review clean)
Task A3: dispatched (BASE d40eed2, implementer opus)
Task A3: implementer DONE_WITH_CONCERNS, commit b97e88a (109 tests; MA3-11 filter never red — type narrowing only; MA3-10 typecheck-only; orca run exit code not discriminating, stderr is)
Task A3: minor (deferred): run.ts `!isLoopPlanTask` filter after the refusal is a runtime no-op (type narrowing only; MA3-11 cannot go red) — comment it or use a cast.
Task A3: minor (deferred): the `orca run` criterion's result===1 assertion is not discriminating (stderr assertion is); "contract task beside it still checked" half unmutated; safe `loop!` assertion.
Task A3: complete (commits d40eed2..b97e88a, review clean)
Task A4: dispatched (BASE b97e88a, implementer opus)
Task A4: implementer DONE, commit 1fc5271 (74 tests, 4 mutations red)
Task A4: minor (deferred): Ruling: P7 was wrong for A4 — the dropped `sha256Canonical(plan) === planHash` was a real check (it recomputes, it does not read back its own input); restore it in the final fix wave — cost if not restored: a weaker but still red-capable criterion.
Task A4: complete (commits b97e88a..1fc5271, review clean)
Task A5: dispatched (BASE 1fc5271, implementer opus)
Task A5: implementer DONE_WITH_CONCERNS, commit 8df7fd3 (144 tests; 19 mutations: 13 red, 4 typecheck-only, MA5-4b/5b/10 + equivalent MA5-1c green; P5 helper recipeExpandsTo in src/control/loopRecipeCheck.ts). Carry to B1: call recipeExpandsTo, expect English "Goal: …"; re-run amended/loopVersion mutants after B1/B2.
Task A5: review: spec ✅, quality changes needed (1 Important: amended/loopVersion branches untested — MA5-4b/5b not equivalent). Fix round 1 sent to the implementer (also: original-contract-invalid criterion if reachable).
Task A5: minor (deferred): MA5-10 — webParity checks mutual assignability only, cannot see a missing optional field (same as labels?/progress?); needs a compile-time key-set check (follow-up).
Task A5: minor (deferred): the test's inputs/summary expectations reuse the production recipe and function (wiring, not content).
Task A5: minor (deferred): B1 must switch the view's objective to the effective contract (carry to B1).
Task A5: fix round 1 implementer done, commit 4bec875 (MA5-4b/5b now red; original-contract-invalid unreachable through readControlGroup — readArchivedPlan blocks first).
Ruling: criteria written in this round and not yet pushed are this round's own work, not "existing criteria" needing the human's naming — B1 rewrites A5's "reports a work item's amendment and loop version" to write a real amendment record — cost if wrong: the human sees a same-round criterion changed without being named.
Task A5: fix round 1/5 (1 addressed, 0 open — amended/loopVersion criterion; commits ab4f2c9..4bec875; controller checked a5-MA5-4b-fix1.txt / a5-MA5-5b-fix1.txt red)
Task A5: complete (commits 1fc5271..4bec875, review clean after fix round 1; ab4f2c9 in the range is a controller checkpoint)
Task A6: dispatched (BASE 4bec875, implementer opus)
Task A6: implementer DONE, commit a2010f0 (9 criteria, 15 mutations red; concern: no direct criterion for no chip on a hand-written task)
Task A6: minor (deferred): no criterion asserts no chip for a hand-written task (loopPlan: null) — the null arm of ControlGroupView.tsx guard unpinned (+3 more minors in task-A6-review.md).
Task A6: complete (commits 4bec875..a2010f0, review clean)
Task A7: Part A gate started (gate2.sh GATE_NAME=partA, fresh clones)
Task B1: dispatched (BASE a2010f0, implementer opus), in parallel with the Part A gate (clones taken before)
Task B1: implementer DONE_WITH_CONCERNS, commit 3a75bd7 (121 tests, 27 mutations: 24 red, 3 no-behavior green; driverRecovery 'retried run' 5 s timeout also on a2010f0 without B1 under gate load — recheck after gate)
Task A7: Part A gate (content a2010f0; ccloop 6ece875) — ccloop 1087/1086, only stopProof, check-known-reds RC 0, tmp-leak RC 0; Orca 2286 tests, 2280 passed, 3 failed, 3 pending (ccloopDefaultE2E, gated off in the full run); typecheck/web build/web check/verify:panel/verify:ccloop-pin RC 0; tmp-leak RC 0; ~/.orca unchanged. Reds: driverLanding X1 + "leaves the branch alone…", driverRecovery "drives a retried run on…" — 1-min load 43.16 during the run (B1 running concurrently); solo reruns 3/3 each passed at load ~5–6 (gate-partA/rerun-*). Registered flakes, not regressions.
Task A7: complete
Task B1: minor (deferred): taskAmendments.ts:87 catch rethrow dead (MB1-P3e equivalent); :57 `row === undefined` equivalent (MB1-P3f); writer-validation test uses bare .toThrow().
Task B1: complete (commits a2010f0..3a75bd7, review clean). Carry to B3: a criterion "amend after confirm, then A2 reads the task" (A2 re-derives through effectivePlanTask).
Task B2: dispatched (BASE 3a75bd7, implementer opus)
Task B2: implementer DONE_WITH_CONCERNS, commit 686e745 (19 criteria red-first; 23 mutations: 18 red, MB2-15 typecheck-only, MB2-12 masked, MB2-19 red only in combination (MB2-19b); helper resetDraftReserve shared by editProposal/proposalSetAgent/setTaskLoop).
Ruling: B2 does not call prestart — prestart answers grant-amendment-unsupported for running/review/done, while spec §5.2 step 1 requires group-state-invalid; the spec binds — cost if wrong: one inline status check parallel to prestart.
Carry to B3: the confirmed branch's per-line mutations can only be seen red once B3 lands (self-check rolls every confirmed change back until then).
Task B2: minor (deferred): work.status half of task-already-started unkillable by mutation (MB2-12; reachable only with a hand-built state); MB2-15 typecheck-only; expectUntouched checks task a only; helper cannot tell refused-before-write from rolled-back; SQLite ExperimentalWarning noise (pre-existing).
Task B2: complete (commits 3a75bd7..686e745, review clean)
Task B3: dispatched (BASE 686e745, implementer opus)
Task B3: implementer DONE_WITH_CONCERNS, commit 6a44547 (72+38 tests; 17 mutations all red; MB3-16 red by error type only; group mirror hash not checked alone)
Task B3: minor (deferred): no criterion builds a re-amounted held/continuing/terminal task, so a full rebuild of such a task is uncaught (U8/R-F12). Correction of the reviewer: B7 (P4) also sees the full rebuild only through the reserve row; U8 stays unmeasured and registered.
Task B3: minor (deferred): start-wake bodies keep the old executionSnapshotHash (nothing reads it); malformed stored snapshot throws ZodError/SyntaxError not recovery-blocked (rolls back); no criterion that the old snapshot stays readable; MB3-16 red by error type only; mirror hash covered only via saveWebAuthority + readBudgetProposal's mismatch refusal.
Task B3: complete (commits 686e745..6a44547, review clean)
Task B4: dispatched (BASE 6a44547, implementer opus)
Task B4: implementer DONE_WITH_CONCERNS, commit 661273e (38 root + 33 web criteria; 10 mutations, 8 red; MB4-9/10 redundant hint-condition parts survive)
Task B4: review: spec ✅, Approved, 0/0/3 (reviewer read-only; verdict recorded here, no review file).
Task B4: minor (deferred, fix in final wave): MB4-9/10 are observable — a task row of another bucket or a non-task row whose ownerId equals a loop task id would wrongly show the hint; add one criterion seen red under MB4-9/10 (Rule 9); keep both guards.
Task B4: minor (deferred): hint repeated in 4 dimension cells with a leading space; loopTasks read from the archived plan (fine while hand-written tasks cannot gain a loop plan).
Task B4: complete (commits 6a44547..661273e, review clean)
Task B5: dispatched (BASE 661273e, implementer opus)
Task B5: implementer DONE_WITH_CONCERNS, commit 92ef663 (4 criteria red-first; MB5-1..4 red).
Ruling: web/src/controlApi.ts wiring stays in B6 as the plan assigns it (my B5 dispatch note was wrong) — B6's criteria are the ones that should see it red first — cost if wrong: none; B6 carries it.
Task B5: minor (deferred): taskLoopApi.test.ts:137 names "before the ledger" but never asserts absence from the ledger; runtime const in controlTypes.ts (brief-mandated).
Task B5: complete (commits 661273e..92ef663, review clean)
Task B6: dispatched (BASE 92ef663, implementer opus)
Task B6: implementer DONE_WITH_CONCERNS, commit d49c7af (web 186/186 in clone; 20 mutations red; App criterion scoped to the card; 4 criteria written after implementation (red via mutations); two buttons named 'Discard draft')
Ruling: amend P1 — the plan form's discard button is "Discard plan draft" (the label editor keeps "Discard draft") — two enabled buttons with one accessible name, each deleting typed text with no undo, cannot be told apart by a screen reader — cost if wrong: one string. Fixed in the final wave.
Task B6: minor (deferred, fix in final wave): rename the plan-form discard button (above); the editor is offered while the group is running/stopped where the server always refuses group-state-invalid — hide "Change plan" there; three new branches without a named mutation (first-dimension-only shortfall, blank-line filtering in lines(), goal/success trimming).
Task B6: minor (deferred): shortfall alert not linked by aria-describedby and a negative "left" figure on the disabled button; dense "; " joiner with two changed dimensions; unused `config` in loopPlanEdit.test.tsx.
Task B6: complete (commits 92ef663..d49c7af, review clean)
Task B7: dispatched (BASE d49c7af, implementer opus)
Task B7: implementer DONE_WITH_CONCERNS, commit 4117725 (real ccloop + fake codex: 1 passed; unset: 1 skipped, no temp leak; MB7-1..3 red).
Ruling: B7's loop tasks list "answer.txt" in targetPaths — ccloop's fake codex always reports answer.txt changed, and a loop plan's allowlist is targetPaths, so ccloop stopped the task (allowlist miss) as designed; keeping both tasks loop tasks keeps the criterion about loop plans, and ccloop's fixture is off limits (Rule 16) — cost if wrong: none to production; any future loop-task E2E with this fake must do the same.
Task B7: minor (deferred): tasks a and b share answer.txt in their write sets — add a comment that the overlap is deliberate; other ccloopWorld users not run with the fixture change (covered by the Part B gate).
Task B7: complete (commits d49c7af..4117725, review clean)
Final review: dispatched (range 65e64a3..HEAD, model fable)
Final review: ready after fixes (final-review.md). Important: A4 planHash equality (F1); Part B gate not yet run. Must-fix F1–F4, recommended F5–F11 in final-fix-findings.md.
Task A5: closed — "B1 must switch the view's objective to the effective contract" is done (readControlGroup maps through effectivePlanTask; taskAmendments.test.ts asserts it).
Registered (not fixed): chosenByLabel recomputed from the live label table (fix with the first v2 of the table); a budget-only change writes an amendment with identical contract bytes and the card says "changed" (wording); ccloopWorld Task.targetPaths required and ignored for loop tasks.
Final fix wave: dispatched (BASE 4117725, implementer opus)
Final fix wave: implementer DONE_WITH_CONCERNS, commits 704da81 deea8f9 a9af9c2 07240ff (48 root + 29 web criteria; loop E2E vs real ccloop passed; 30 mutation runs, 27 red, 3 explained).
Ruling: F4's frozen line is "The group is not open for changes; the plan is frozen" — "Started; …" would be false for a task that has not started — cost if wrong: one string.
Ruling: the this-round criterion loopPlanDraft's fixture group moves from running to ready — the old fixture described a state the server always refuses — cost: none (same-round criterion).
Task B8: Part B gate started (gate2.sh GATE_NAME=partB, content = final fix wave head)
Final fix wave: re-review — F1–F11 all ADDRESSED, no new Critical/Important (final-rereview.md).
Registered (not fixed): a raw task with both contract and loop now also gets loop-plan-cli-unsupported beside malformed (fits "all at once"); the card checks summary.stopMode while the server checks group.stopped — not traced whether they can disagree (server decides).
Task B8: Part B gate (Orca content 07240ff; ccloop 6ece875; env as gate2.sh: fresh clones, HOME + four XDG roots relocated, short TMPDIR, fake codex integration table, ORCA_CCLOOP_BIN = the ccloop clone's build) — ccloop: build/typecheck RC 0, 1087 tests / 1086 passed / 1 failed (stopProof), check-known-reds RC 0, check-tmp-leak RC 0. Orca: web build/typecheck RC 0; 2331 tests / 2327 passed / 1 failed / 3 pending (ccloopDefaultE2E gated off in the full run); web check 37 files / 193 tests RC 0; verify:panel RC 0 (15 PASS); verify:ccloop-pin RC 0 (3/3); check-tmp-leak RC 0; ~/.orca stat identical. The red: driverLanding "X1: lands while the person has orca/<group> checked out…" — 1-min load 48.03 during the run; solo reruns in the gate clone 3/3 passed at load ~6 (gate-partB/rerun-*). Registered flake.
Task B8: complete
Ruling: keep this SDD workspace and commit its ledger and review records (git add -f) instead of deleting it — CLAUDE.md Rule 13 treats .superpowers/sdd/** as the evidence chain, and deleting data needs the human — cost if wrong: a few hundred KB of markdown in git.
Final: all tasks A1–A7, B1–B8 complete; final review ready-after-fixes → fix wave F1–F11 addressed; gates A and B pass.
