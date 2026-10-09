# Task E11 report

Implemented: RunActivity section in web/src/TaskDetail.tsx (before "Runs of"), shown when item.currentRunId is set, refetching on changeSeq; read-only so it stays on archived groups (E10 gating untouched). Uses Part B's existing fetchRunActivity / RunActivityV1 / ActivityEntryV1 (no second fetch added; brief's RunActivityViewV1 name not used). Run reasons explained via reasonCode + explainRunReason (D6/A). Phase rows carry ccloop raw words (planning/executing/verifying, amendment 4), mapped to the panel's plan/execute/verify for display. Locales: control.activity and enums.activityKind (en+zh).

Commits: 2d3e401 feat(web): show the current run's recent activity in the task detail; second commit adds the changeSeq refetch test.

Tests: web check 88 files / 697 tests green (before the added test; taskActivity alone 7/7 after), root typecheck rc=0, scanPanelText + refusalCoverage rc=0.
Deviations: rewrote two existing tests the new feature turned red (not named in the brief): tests/i18nPseudo.test.tsx family/value counts 33->34, 165->178 (new enum family, same named-rewrite pattern); tests/controlI18n.test.tsx line 177 heading query now names "a 的运行" (a second h5 exists). taskLabels rewrite as briefed.
Mutations (clone, discarded): delete RunActivity line, true&&, remove phase branch, drop explainRunReason, drop CCLOOP_STEP map, drop changeSeq dep: all red (the last after adding the refetch test, which was green before).
Concerns: codex-exit-error has no en/zh explanation yet (already queued for the final wave), so a blocked row with it shows raw. Worktree diff is non-zero only from the controller's progress.md edit.
