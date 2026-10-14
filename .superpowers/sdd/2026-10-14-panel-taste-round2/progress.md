# SDD ledger — plan: docs/superpowers/plans/2026-10-14-panel-taste-round2.md

Session 1f3cceb2 (controller, Opus 5.5), 2026-10-14. Worktree `/Users/biran/code/skills/orca/Orca-wt/ui-taste`,
branch `ui/panel-taste`, start = main merge commit subject `Merge branch 'ui/panel-taste'` (fast-forwarded).
Spec: `docs/superpowers/specs/2026-10-14-panel-taste-round2-design.md`.

## Pre-merge (session 1f3cceb2, before this plan)

- Human ran `git merge --no-ff ui/panel-taste` in the main worktree; conflict in `web/src/UsageSettlement.tsx`
  (main's release label vs this branch's `data-tone="warn"`). Resolved keeping both.
- Merged tree's `--ws check` red: `zhTerms` vs main's zh `"owner 不计量放行"` pinned by
  `web/tests/settleUnknownUsage.test.tsx:105,117`. Human chose zh `所有者不计量放行` + rewrite of those two literals
  (seen red after wording-only change, green after rewrite).
- Verified in scratch clone (merged tree from read-only `git merge-tree`; the gate blocks `git merge` even in a clone):
  typecheck / web build / `verify:panel` RC 0; `--ws check` 123 files / 1058 pass; root vitest 45 red of which 43 =
  missing ccloop sibling, rerun of those 59 files with `ORCA_CCLOOP_BIN` → only `taskResultPaired` ×2 (baseline).
  Main worktree index tree hashed identical to the verified clone tree (`ec076c3`). Human committed and pushed.
- Human rulings: see spec §1 (H1–H7).

## Spec review (independent, read-only subagent, session 1f3cceb2)

0 Critical / 4 Important / 7 Minor. All dispositions in spec §6. Notably:
- Ruling: A7 dropped (spec §6 I1) — a second always-visible primary on Requirements would break DESIGN.md's one-primary rule; R-b withdrawn — cost if wrong: answer round keeps no primary; human approved A7 without this fact, so it is reported.
- Ruling: M-e (refetchRequired info tone still lights the red dot) recorded, not done — not covered by H1 — cost if wrong: one more inconsistency until the human authorises.
- Ruling: golden.json updated under R-a (fixture follows H2) — cost if wrong: one fixture file to revert.
Spec + plan committed: `docs(spec,plan): plan panel taste round 2 — authorised rewrites and the group-A minors`.

## Pre-flight scan

| Pair / task | Shared file or interface | Finding |
|---|---|---|
| T1 × T4 | `web/src/App.tsx` | T1 edits the `controlAlert(...)` call (~1256), T4 the `<Overview>` props (~1352). Disjoint; sequential. |
| T2 × T3 | `web/src/locales/en.ts` | T2 edits `metricsNote` (~30-33); T3 deletes `metrics.*Count` (~1029-1031). Disjoint. |
| T2 × T3 × T8 | `web/tests/metricsLayout.test.tsx` | T2 comment only; T3, T8 append cases. No conflict. |
| T5 × T7 × T8 | `web/src/styles.css` | tokens (:31-70) / new coarse block after :376 / line after :267. Disjoint. |
| T4 × T10 | `Overview` props | T10 renders Overview without `onViewDecisions`; prop optional. OK. |
| T1 × T10 | `App.tsx` tone strings | T10 reads `role="status" data-tone="ok"` / chain banner lines; T1 does not touch them. OK. |
| T1 | self | Step 1 type assertion keeps compiling after the field is removed in Step 3. OK. |
| T2 | self | Steps 2–6 consistent; golden step under R-a. OK. |
| T3 | self | New case needs `en` import + REPORT/COVERAGE (present in file); malformed_lines shape from `web/src/types.ts`. OK. |
| T4 | self | Risk: Overview section may fetch `/api/overview`, which the reviewApp harness rejects. Ruling: implementer may answer that URL in the harness (minimal failure or empty projection) without changing existing cases' behaviour. |
| T5–T8, T10 | self | Consistent. |
| T9 | withdrawn | Not dispatched. |
| T11 | self | Ledger `git add -f`; handoff conclusions only. OK. |
Task 1: implementer DONE (62e8714), review dispatched
Task 1: minor (deferred): REWRITTEN comment on `quiet` sits inside the object literal (harmless).
Task 1: ⚠️ items resolved by controller: red/green/mutation logs read (red 1 failed "is true for each condition", green 44/44, full 1058/1058, mutation red, clone diff 0/0 per report).
Task 1: complete (commits 1b6fdb5..62e8714, review clean)
Task 2: controller evidence — old golden.json with new source: cli.test 'matches the golden byte for byte' red (logs/task-2-oldgolden-controller.log); clone restored 0/0.
Task 2: ⚠️ resolved by controller: commit body carries the golden.json REWRITTEN marker; STALE_BIAS mutation (citation back on compute.ts only) → noteCodes 2 red (byte-equality + new case), logs/task-2-mut-stale-controller.log, clone 0/0.
Task 2: minor (deferred): no blank line before the new `it` in tests/metrics/noteCodes.test.ts:36.
Task 2: complete (commits 62e8714..c6c9cba, review clean)
Task 3: minor (deferred): metricsLayout new case mixes literal titles with en.metrics.futureTitle (plan text); only the unresolved number was mutated.
Task 3: note: scanPanelText lives in web/tests/i18nPseudo.test.tsx (not a root test as handoff_ui §七 said) — correct in handoff.
Task 3: complete (commits c6c9cba..00100d4, review clean)
Task 4: note: implementer saw 1-2 load flakes in full check runs (projectSwitcher, groupRefusal, projectScopeRecovery), green alone and on 3rd full run — recheck in Task 11.
Task 4: minor (deferred): setStatus("unreviewed") reset has no case that can go red (Reviewed status needs /api/decisions the harness does not stub); redundant parens reviewApp.test.tsx:266.
Task 4: complete (commits 00100d4..eb38367, review clean)
Task 5: Ruling: commit 387563c carries a Haiku 5.5 Co-Authored-By trailer (the implementer's own model) — kept, it is accurate; no amend — cost if wrong: one trailer differs from the others.
Task 5: minor (deferred): dark --cat-done branch never seen red (already matched); no guard that darkBlock is the dark block (e.g. contains `color-scheme: dark`).
Task 5: complete (commits eb38367..387563c, review clean)
Task 6: Ruling (plan-sanctioned): ref guard dropped as redundant — disabled alone blocks the second click and its removal turns case 1 red — cost if wrong: a double-dispatch window if React ever skips the re-render between clicks.
Task 6: minor (deferred, final review to triage): single `dismiss()` (AuthGate.tsx ~281) has no try/catch (rejected ack = unhandled rejection, no refusal) and does not set `dismissing` (double click / overlap with Dismiss all can double-ack). Case 2 asserts only region disappearance.
Task 6: complete (commits 387563c..697fafc, review clean)
Task 7: minor (deferred): checkbox/radio line has no named mutation; tests are source checks (browser shot in Task 11); block slice ends at first "\n}".
Task 7: complete (commits 697fafc..ab92b8e, review clean)
Task 8: complete (commits ab92b8e..59a1eb4, review clean)
Task 9: withdrawn (spec §6 I1) — not dispatched.
Task 10: note: full web check under load — 4 App-level files time out (controlPollSettles, controlCommandRecovery, projectScopeRecovery, agentPreviewRefresh), 45/45 alone; untouched by this task — recheck in Task 11 on a clean clone + base comparison.
Task 10: minor (deferred): only refetch/info mutated among ControlPanel lines; App ok/chain-banner lines unmutated; source-read cases would pass on dead code (template.test trade).
Task 10: complete (commits 59a1eb4..4acad3f, review clean)
Ruling: skipped orca-level checkpoint write (it commits into the main worktree another agent uses) — state lives in this ledger + handoff_ui.md — cost if wrong: no .orca/checkpoints record for session 1f3cceb2.
Rule 6: controller context passed T1 (orca level 335,611 / T1 330,000) during Task 11; continuing per human instruction (session 1f3cceb2: 'this session do not consider context size').

## Task 11 (verification, in progress) — controller

- Clean clone of the tip `test(web): pin each notice site's tone…` (scratchpad `final/`), env redirected (HOME + XDG, ORCA_CCLOOP_BIN): typecheck RC 0, web build RC 0, `--ws check` RC 0 (124 files / 1073), `verify:panel` RC 0. Root vitest RC 1: 28 red in 7 files — 18× "Test timed out in 5000ms" + taskResultPaired ×2 (baseline) + ompSkillsE2E ZodError (`selectionsHash` null). Rerun alone ×3: driverRecovery, driverRequirementSplit, integrationKeep, retryTask, settleUnknownUsage all RC 0 ×3 (load flakes; integrationKeep is new to the list). ompSkillsE2E red ×3 on the branch AND on a main-baseline clone (main tip then `chore(checkpoint): orca-dev-b39a5527…`) ⇒ environmental (real ccloop), not this round. Logs: scratchpad `final-logs/`.
- Real browser (redirected panel, fresh control dir, port 7791, no execution port): red nav dot still lit — after settle the only lit condition was the panel refusal `control-port-unconfigured · HTTP 422` from `loadAgents` (GET /api/control/agents). Ruling: added Task 12 (spec §7 H1-b) — H1's intent is unmet in the real no-port panel; fix is local and needs no existing-test rewrite — cost if wrong: one more commit to revert.
- Touch: with has_touch+is_mobile, `pointer: coarse` true, `.kbd-hint` display none, button height 44 (36 without touch). The first batch measurement (device_scale_factor 2, light) reported the hint visible; the direct re-measure says none — recorded as-is, unexplained.
- Spec §7 + plan Task 12 committed: `docs(spec,plan): add round 2 task 12 — the no-port agents refusal found in the real browser`.
Task 12: minor (deferred): nav-dot null assertion never seen red on its own (earlier alert-line assertion fails first); no positive case that another loadAgents code still raises the panel line.
Task 12: complete (commits d9e93c0..f2a355c, review clean)
Task 11: real browser on the Task 12 build (same redirected no-port panel): dot+alerts at 1 s = reset-required + refetch-required (transient), 3 s = reset-required, 6 s and 10 s = no dot, no alert ⇒ H1 met after settle. Finding for the human (pre-existing, out of scope): every load flashes the red "server reset required" alert for ~3–5 s (first summary read is resetRequired by spec §5.2.7 of handoff.md). Screenshots: scratchpad shots/round2/ (desktop dark/light, phone touch ×6 sections; settled-light-tasks.png). ~/.orca listing before/after compared in the final step.
Task 11: real ~/.orca: ls -laR before (10:00) vs after (10:42) differ only in the parent '..' mtime line; ~/.orca contents unchanged (scratchpad orca-diff.txt).

## Final whole-branch review (opus, read-only, session 1f3cceb2)

0 Critical / 3 Important (all docs) / 3 Minor; code ready. Triage table in the reviewer's report: every deferred minor = leave (T6 single dismiss → 已知缺口 in handoff.md; T12 weak preference for one positive case later).
- CORRECTION to the Task 3 note above: `scanPanelText` is the ROOT test `tests/panel/scanPanelText.test.ts` (driven by `scripts/scan-panel-text.mjs`); `web/tests/i18nPseudo.test.tsx:17` only names it as "the scan backstop". The implementer's claim was wrong and the controller copied it unverified. handoff_ui §七's original "根测试" was right.
- Ruling: the final fix wave (handoff.md:290 scanPanelText location, 5.2.6 dot exceptions, T6 gap in 已知缺口, known-load-flakes observation commit, handoff_ui §七 rewrite, ledger commit) is done by the controller, not a fix subagent — it is the session handoff the human asked the controller to write and needs the controller's context; a scoped re-review subagent still checks it — cost if wrong: one unreviewed-by-implementer docs commit.
Task 11: handoff_ui.md status lines + §七 awaitingHuman replaced, new §七.二 (round 2); handoff.md scanPanelText location fixed, 5.2.6 dot exceptions, T6 gap under 已知缺口; known-load-flakes web row names its observation commit. Test panel on 7791 stopped.
Task 11: complete (docs fix wave committed with this ledger; scoped re-review follows)
