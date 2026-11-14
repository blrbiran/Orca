# Tester follow-up L — progress ledger (Orca session 6b727312, 2026-11-14)

Controller: Orca session `6b727312` (Claude Opus 5.5). Start: Orca main = origin/main = the K-round handoff commit
(`docs(handoff): tester follow-up K -- …`); ccloop, ccmem main = origin/main (verified with /usr/bin/git ls-remote).
Tester ledger `orca_archived_files/issue-20261023.md` unchanged since round K's triage (mtime 2026-11-13 19:50 local).

## Human, verbatim
- Opening: K-round reversible decisions 「同意」; push 「允许」; cleanup 「给我命令」; tester ledger: analyse, stop, choose.
- 「allow-push 这一轮的session中允许你在必要时push Orca / ccloop / ccmem 仓库到 origin main」 (message starts with allow-push)
- 「同意你的顺序，现在开始」「这一轮先不做需要 brainstorm 或写 spec 的工作」「g-28d9b560 我的建议 => 按你的建议走」
  (controller's suggestion: raise the group limit by about 1M tokens, then review-fix)
- 「/handoff 这个session中，尽量将这些要做的task都完整做完…这次批准改写所有必要的判据。这一轮允许必要的付费真跑。…
  如果遇到卡住必须等人的事情，请继续做不必等人的部分…先按你的建议执行。执行完在最后阶段报给我审核。…更新到
  Orca / ccloop / ccmem … handoff.md…ccloop 和 ccmem 的handoff文档注意关于 Orca 的章节不能无限增加下去…」

## Plan (agreed order)
0. Merge K1 → K2 → K3 (rebase, tc + web tc, --ff-only); one gate on main with the pin build; K1's 12 load files 3×
   solo; build, web build, install 7777; push.
1. Small items: #173 history baseline at confirm; `formatWithUnestimated` duplicate landing-watch lines; #195 mark the
   inactive threshold; K2 Web fallback kinds; K3 tests (multi-dir edit E2E, hash race); `usagePause.ts:119` comment;
   ccloop `savedResultRecovery.ts` loose `indexOf`.
2. g-28d9b560: raise limit ~1M, review-fix (paid).
No brainstorm/spec items this round (human).

## Log
- K1 rebased onto main (clean), tc 0, web tc 0, merged --ff-only.
- K2 rebased (no textual conflicts; codex note wording consistent: "only after the whole phase"), tc 0, web tc 0, merged.
- K3 rebased (clean), tc 0, web tc 0, merged. Gate started on main (base d2a014b8, ORCA_CCLOOP_BIN = pin 9c83b38 build).
- Branch `l-small` (worktree .claude/worktrees/l-small, base = main after K3): `fix(cli): group show prints each landing
  regression once` (criterion red before fix: 2 lines, expected 1; green after); `docs(usage): correct the pause-line
  comment…` (named correction appended, original line kept).
- #195: already labelled "not active" in proposal show (`contextHandoffLines`) and Web BudgetEditor (`context-handoff-
  inactive` note); the real fix (feed phase context observations) is design work ⇒ not this round.
- ccloop `savedResultRecovery.ts:359-361` loose `indexOf`: a missing flag compares args[0], a duplicated flag checks only
  its first occurrence; forging needs write access to the run dir already. Not worth a ccloop commit + repin this round;
  left registered.
- g-28d9b560: `group set-limit` needs a person token; `orca auth status` shows a stored token (biran, expires
  2026-11-27). Human approved the raise + review-fix. Deferred until after the 7777 install so a panel restart does not
  interrupt the paid fix run.
- Seats launched (worktree isolation): L173 (#173/#224/#266 history baseline at confirm), LK3T (K3's missing criteria).
- LK3T reported: branch `worktree-agent-a6c19a4fdd25d2f03`, one test-only commit `test(requirement): a multi-directory
  draft edit through the verb, re-validated, and the in-transaction re-check (tester follow-up L)`; 3 criteria on the real
  verb with multiHarness; mutations M1–M3 red (clone /tmp/orca-l-k3t-mut, logs /tmp/orca-l-logs/), restore 0 bytes;
  file 7/7, tc 0. No product change. Findings for the human (not fixed):
  A. multi-dir draftHash (`requirementCalls.ts:451`, expanded plan = primary loops only) does not cover writes outside
     each task's primary dir, while accept rebuilds contracts from `draft.output` (`requirementCommands.ts:545`) and checks
     only `sha256Canonical(draft.plan)` (`:503`). draftNo is also checked ⇒ low exposure; fixing changes every multi-dir
     draft hash ⇒ human decision. Predates round K.
  B. an implied path whose writer's dir precedes the task's primary dir in registered order adds a `checks: []` write
     that becomes primary (`orderWrites`) ⇒ refused `checks-primary:<task>`; refused safely, but that Web button can
     never succeed. Code-read only. Controller: registered, not fixed this round (rare; a clear refusal or hiding the
     button is the fix).
- Gate on main after K3 (`TMPDIR=/tmp ORCA_CCLOOP_BIN=/private/tmp/orca-j1113/ccloop-pin2/dist/cli.js node
  scripts/test-affected.mjs --base=d2a014b8`, log scratchpad gate-main.log, rc 1): root 812 files, Test Files 2 failed |
  810 passed; Tests 2 failed | 6496 passed | 39 skipped; web 247/247 (2009). Reds: orchestration "admits a debug group…"
  (`task-run-moved:ladder-source-superseded`, the registered known red) and workerLostE2E "a worker that died after
  writing a successful candidate…" (timeout; registered in known-load-flakes.md). Both re-run solo below.
- Merged into main (--ff-only): l-small (2), LK3T (1, rebased clean). Targeted: groupShowLandingWatch +
  requirementDraftEdit 10/10, tc 0.
- L173 reported (branch `worktree-agent-ae5d8fc32021c2728`, 4 commits; `src/control/estimateHistory.ts`; group view
  optional `estimateHistory {medianTokens, sampleCount, minimumSample, tasks[{taskId, estimateTokens, ratio}]}` only while
  the proposal is editable; CLI proposal show / group confirm `history:` lines and `--json` field; Web BudgetEditor note
  `budget.history.*` en+zh; 15 criteria, 21 mutations red in /tmp/orca-l173-mut, restore 0 bytes). Seat decisions for the
  human: archived groups count; all runs (failed attempts) count; raw estimate not the 1M floor; ratio = estimate/median;
  min sample 3; computed only while editable; per-task lines only; neutral tone.
  Controller review: one bad row in another group would throw out of readControlGroup ⇒ added
  `fix(control): the repository history skips another group's unreadable row…` with a criterion (red with the hardening
  stashed, green with it). Rebased onto main: tc 0, web tc 0; root targeted 7 files/33, web 5 files/20, then the history
  file 8/8. Merged --ff-only.
- Solo reruns (load 29–41): the 14 load-sensitive files (K1's 12 + workerLostE2E + schedulerBridge) each 3/3 green
  (42/42; scratchpad solo-summary.txt).
- Gate for L commits (`--base=40df70ef`, same env, log scratchpad gate-l.log, rc 1): 1056 files selected (809 root, 247
  web); root Test Files 3 failed | 806 passed, Tests 3 failed | 6489 passed | 39 skipped; web 1 failed | 246 passed (2002
  /2003). Reds: orchestration (known), workerLostE2E (known flake), executionDriverE2E R-F (`task-not-retryable:run-state:
  settled-failed`), web memoryLayout scroll (registered in known-load-flakes). R-F and memoryLayout solo 3/3 green each
  (load 21–30) ⇒ load.

- Install: `npm run build` 0, `npm run build --workspace web` 0, `launchctl kickstart -k gui/$(id -u)/dev.orca.panel`
  (no group running; schema unchanged 24). After: `orca status` all ok, launchd pid 85791 → 53754; the bundle the panel
  serves at /index.js is byte-identical to the fresh web/dist/index.js and carries the K2 codex note and the L history
  strings.
- g-28d9b560: `orca group set-limit g-28d9b560 --limit '{"tokens":5600000,…unchanged}' --as-person` rc 0 (commandId
  cli-1e59b46a-…, revision 15; was 4,600,000, used 4,474,567). `orca group review-fix … --path src/notes.js --path
  src/store.js --path test/tags.test.js` refused `recovery-blocked:review-fix` (commandId cli-22f74918-…).
  Diagnosis on a `.backup` copy of control.sqlite in the session scratchpad (identity row repointed on the copy only):
  `openFixTask` → `appendConfirmedTaskInTransaction` → `deriveContract` throws `execution-policy-unrepresentable`
  because the sibling task's work grant has tokens null (expectation model) and `requirementReview.ts` passed
  `tokens ?? 0`; openFixTask swallowed the code. ⇒ every expectation-model group (all new groups) could never open a
  fix task, automatic or by hand. Real defect (since follow-up G's `4db13ca9`).
- Fix on branch `l-fix`: `fix(control): a review fix task opens in an expectation-model group, and a refused one names
  the cause` — grant passed as is (BudgetAmount), append commits `finiteCommitment(work)`, refusal message
  `recovery-blocked:review-fix:<code>[:<detail>]`. Criteria: requirementReviewFix "opens the fix task in an
  expectation-model group…" (red before the fix: not-passed, autoFixRounds 0 — the field symptom), requirementReviewCommands
  "review-fix that cannot append its task names the cause". Mutations M1 (`?? 0` back), M2 (detail dropped), M3 (no
  finiteCommitment) each red in a `git clone --local` copy; restore 0/0 bytes. Both files 7/7 + new, tc 0.

- Gate for l-fix (`--base=387f4be2`, pin build, rc 1): 729 root files selected, 0 web; Test Files 3 failed | 726 passed;
  Tests 3 failed | 5929 passed | 39 skipped. Reds: orchestration (known), workerLostE2E (known flake), criteriaBaseRun
  "a restart while the re-run is in flight…" `index.lock File exists` (registered shape in known-load-flakes.md). Solo
  criteriaBaseRun at load 36–40: 1 red (same index.lock shape) then 2/2 green; the change does not reach the debug-repro
  checkout path ⇒ load. Merged l-fix --ff-only; `npm run build` 0; kickstart; `orca status` all ok (pid 73067).
- g-28d9b560 `review-fix` (same goal/paths) rc 0: `review-fix-opened`, task `review-fix-3`, commandId cli-8ba70a0c-…,
  revision 16. Paid codex run under way; watch log in the session scratchpad.
- Fix run run-c152e746-… (codex gpt-6-sol; plan 83,596 + execute 231,676 tokens) blocked `terminal:blocked_waiting_human`,
  stopReason `allowlist miss: test/tags.test.js`. Second real defect: `fixTaskContract` set the fix task's allowlist to
  the other tasks' union only, never its own targetPaths (the `--path` a person gives "a file the fix task may write").
  Unblocked with the run's own suggestion `orca task retry g-28d9b560 review-fix-3 --allow-observed-paths` (rc 0); run
  run-3c258882-… landed. Review round 4 (codex single call): `cannot-judge` — AC1, AC2, AC3, AC6 met (the targeted tag
  rules now pass); AC4 not-met (new: "each standalone CLI invocation creates a fresh store"; round 3 had judged AC4 met);
  AC5 cannot-judge (no whole-suite `npm test` result: the group has no full-suite command, ruling ①). Ledger 5,176,876 /
  5,600,000. Controller stopped paid runs here: the reviewer flipped AC4 between rounds and the remaining gap is a product
  call (the requirement leaves load replace/merge open) ⇒ human: review-accept, or adopt a full-suite command / say what
  AC4 means and review-fix again (needs more limit).
- Fix on branch `l-fix2`: `fix(control): a review fix task's allowlist admits its own write set` — exported
  `fixTaskAllowlist`: empty union stays [] (every path allowed), non-empty union ∪ targetPaths (debugPlan.ts rule).
  Criterion in requirementReviewCommands (unit both sides + the contract through review-fix keeps an empty allowlist);
  mutations N1/N2/N3 red in a local clone; restore 0/0. First run of the file: all 9 tests passed but the file-level real
  `~/.orca` guard fired — the live paid run was writing `~/.orca/control/panel.runs/run-3c258882-…` at the same time.
- Gate for l-fix2 (`--base=2ffb29bb`, pin build, panel idle): 729 root files; 36 files / 142 tests red — nearly all
  `panel-dist-missing` (the l-fix2 worktree had no `web/dist` symlink: environment). Symlinked web/dist, reran the 36
  files: 35 passed, 1 red = orchestration (known). Merged --ff-only; `npm run build` 0; kickstart; `orca status` all ok
  (pid 11456). l-small, l-fix, l-fix2 worktrees removed (no force) and branches deleted (-d).
- Pushed Orca main mid-round (remote had moved to the #173 hardening commit by the human; push 387f4be2..2ffb29bb).
- Left for the human: force-remove the five agent worktrees (all clean, tips in main) then `branch -d` their branches;
  /tmp/orca-k*, /tmp/orca-l*, /private/tmp/orca-j1113; g-28d9b560 decision.

## Human, verbatim (review)
「等你审 => 同意」「现在继续」 — covers: L173's 8 seat decisions; LK3T findings A (multi-dir draftHash) and B (implied path
before the primary dir) stay registered, not fixed; the registered leftovers (ccloop indexOf, #195 wiring, #170, #229).
