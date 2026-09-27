# SDD ledger — plan: docs/superpowers/plans/2026-09-27-panel-ui-redesign.md

Session a50f4d80, 2026-09-27, branch ui/panel-redesign (worktree in session scratchpad). Spec: docs/superpowers/specs/2026-09-27-panel-ui-redesign-design.md.

## Pre-flight (shared interfaces)
- T1→T4: DecisionListRow.question (string|null) produced by T1 (server+web types), consumed by DecisionList/DecisionsView — consistent.
- T2→T3: ThemePref/THEME_PREFS produced by T2, consumed by Shell — consistent.
- T2→T4/T5: CSS class names listed in T2 Produces; T3/T4 use .shell/.section-pane/.decision-row/.row-question/.split/... — all present in T2 stylesheet.
- T3→T5: Shell/SectionPane/controlAlert/sectionFromHash/DEFAULT_SECTION — consistent.
- T4→T5: DecisionsView/NO_FILTER/DecisionFilter — T4 Step 7 already switches App off PanelHome; T5 builds on that. Consistent.
- T5 field names (executionPort, resetRequired, recovery.blockers, control.refusal) verified against ControlPanel.tsx/App.tsx while writing the plan.
- Task 0: Ruling: node_modules/web/node_modules symlinks show as untracked (.gitignore 'node_modules/' matches dirs only) — do not touch ignore files (info/exclude is shared with main); every git add is path-scoped, symlinks never staged — cost if wrong: a stray symlink commit, caught by diff --cached review
- Task 1: Ruling: DecisionListRow.question is `question?: string | null` on BOTH sides, not required as the plan says — required broke web tsc on literal rows in appSelection.test.tsx / selection.test.tsx (not authorised to edit), and web-only optional would break webParity's web→server assignability check (also not authorised) — cost if wrong: the type is looser than the server's behaviour; presence is pinned at runtime by the two rewritten toStrictEqual criteria.
- Task 0: baseline (clean clone of 02594fc, env = $S/testenv.sh: ORCA_CCLOOP_BIN=ccloop clone fee7f2a dist, ORCA_AGENTS_TABLE fixture, HOME+4 XDG redirected; cmd `vitest run --reporter=json`): 220 files / 2003 tests, 1999 passed, 4 failed, 0 skipped. Reds: gateCheck K12, gateCheck K13, driverRecovery "drives a retried run…", controlShutdown "a real SIGTERM…". typecheck/web build/--ws check RC 0. First baseline in the worktree itself was void (run concurrently with Task 1 edits, no ccloop bin).
- Task 1: full suite (worktree, testenv.sh, json reporter): 221 files / 2007 tests, 2005 passed, 2 failed: gateCheck K13 (baseline red), driverLanding X1 (known load flake; re-run alone: X1 green, sibling "leaves the branch alone…" timed out at 5002ms — the red moves, code path untouched by this task). The two authorised criteria were seen red under the new behaviour before rewriting (t1-oldcriteria.log), all 12 others in those files green.
- Task 1: mutations (clone of abf18dc, testenv.sh): M1-a drop question type check → 2 red (maps…, does not borrow…); M1-b drop seen.add → 2 red (first line wins…, does not borrow…); M1-c OrEmpty rethrows → 1 red (answers an empty map…); M1-d listRows passes null → both rewritten criteria red. Clone reverted clean (status = only the two symlinks), deleted.
Task 1: complete (commits 02594fc..abf18dc, tests: ./node_modules/.bin/vitest run tests/panel →    Duration  20.25s (transform 1.95s, setup 388ms, collect 9.34s, tests 74.06s, environment 4ms, prepare 2.27s))

## Hand-off (session a50f4d80 stops here: context near the Rule 6 per-session limit)
- Done: Task 0, Task 1 (branch tip = the commit that adds this ledger, on top of abf18dc). Next: Task 2, from its Step 1. An unrun draft of web/tests/theme.test.ts was deleted, not committed — write it from the plan.
- Worktree + branch: this directory, branch ui/panel-redesign. Its commits live in the main repo's object store; the directory itself is under a session scratchpad in /private/tmp — if it is gone, `git worktree prune` is NOT yours to run (Rule 15): recreate with `git worktree add <new path> ui/panel-redesign` from the main repo and report it.
- node_modules / web/node_modules are symlinks to the main tree; they show as untracked — never stage them (Task 0 ruling).
- Test env for full runs: this session's scratchpad `testenv.sh` (ccloop clone at fee7f2a built into ccloop-clone/dist, agents fixture table 0600 in a 0700 dir, HOME + 4 XDG redirected). A new session has a different scratchpad: rebuild the same three things there (recipe: docs/handoff/handoff.md §一 on main, and ccloop's handoff "Orca 那条线").
- Compare every full run against the Task 0 baseline red set: gateCheck K12, gateCheck K13 (HOME-redirect related), driverRecovery and driverLanding/controlShutdown (known load flakes; re-run the file alone).
- Never touch main or /Users/biran/code/skills/loop/Orca's worktree: another agent works there.
