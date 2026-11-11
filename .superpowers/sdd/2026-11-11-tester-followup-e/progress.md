# Tester follow-up E — progress ledger

Controller: the Orca session started 2026-11-11 after commit
`docs(handoff): tester follow-up D round -- browser login, estimate as expectation, accept-attempt, the issue batch, what waits for the human`
(scratchpad id at start `4361b629`). Design: `docs/superpowers/specs/2026-11-11-tester-followup-e-design.md`.
This ledger is append-only (Rule 13): corrections go in new sections.

## Start state (2026-11-11, `/usr/bin/git ls-remote` vs local main)

Orca, ccloop, ccmem and syncskill: local main equals `origin/main` (the human pushed round D before this session).
Orca pins ccloop `095dbdf` (the #225 commit).

## Human rulings (verbatim)

Opening message:
- On round D's two design answers: 「同意」. On accept-attempt's §8 deviations: 「同意」.
- #125 (a): 「你看下 Orca 和 ccloop 整体如何调整最优，先不要顾虑之前裁定的部分，之前裁定时不一定有考虑好。」
- Items needing a ruling: 「具体列出你的建议和原因」. Browser review: 「告诉我具体要看哪些」. Cleanup: 「帮我清理」.
- Tester issues: analyse against current code, user's point of view, earlier rulings may be revisited; stop after the
  analysis to choose this session's scope.

Second message (after the controller's recommendations):
- 「#200 lilac 主题。 => 加」
- 「待裁事项 => 其他都按你的建议走」 — #125: split call-failed reasonCode, `lastInvalidReason` unchanged;
  #101/#104/#116: agents may settle with charge-remaining-grant / release-known-zero; #168: docs-only suite validator;
  D21: `orca project add`, human only, Web POST owner-only; attempts: explicit retry in an unlimited group gets fresh
  default attempts; #84: overlay and collapsible motion.
- 「真浏览器要看什么 => 暂时不看，我之后发现问题会再找你」
- 「#243 => 这一轮先不做，下一轮我们讨论一下」 — the composer and the Live note box are deferred; the controller
  reads the transcript font unification as part of #244 (same root cause: the transcript sat inside a table cell).
- 「要你点头才做的 => 其他都同意」 — #241 group acceptance check and #251 `--finish` approved.
- 「我建议本 session 做的 => 同意」 — scope: P0 #249 + activity-kind gap; P1 #242, #245; P2 transcript batch;
  P3 #250/#251/#246, #256/#258/#257; the rulings above; #241. The plan named the `i18nPseudo` count rewrite (#245) and
  the `singleCallErrorCode` rewrites (#125) as needing authorization; read as authorized by this 「同意」.
- 「清理脚本已执行」 — the round-D temp directories (handoff §八 12) are gone.

## Triage (read-only, three sub-agents, against main at the start commit)

- #242 reproduces (explicit `--group` skips the membership check; server has no group+run endpoint).
- #246 by design (agent-selection spec: no layer names an agent ⇒ `agent-unselected`); the tester's hint claim is
  wrong (the hint says `--agent` / `defaultAgent`, unchanged since 905dac97).
- #250 partly: `--slot worker` already sets every slot (tester-round2 spec: "the group worker slot is the batch set"),
  but the refusal never says so; `plan save --requirement` does not seed the estimator agent.
- #251 reproduces; spec'd rule (answer queues the next round while the frontier is open).
- #245 confirmed: pass, not-needed and stopped are silent. Side finding: Web `activityKinds` lacks
  `saved-result-top-up` (any topped-up run's activity is unreadable on the Web) — verified by the controller.
- #241 tail: group done runs no checks; only each task's own required checks ever run.
- #249 confirmed in ccloop: a mid-stream `error` row poisons `CodexUsageFold`; `decodePhase` rethrows without
  `observedTokens`. Orca side (`floorTokens:null` booked 0 and shown "unknown, at least 0") is spec'd.
- #243–#258 Web: all reproduce; #252 also makes Live follow plan instead of the running execute; #257's default view
  is spec'd.
- #247/#248/#259/#260: defects in the tester's target repository's generated code, not Orca.

## Workstreams

| id | scope | repo | branch / worktree | state |
|---|---|---|---|---|
| W1 | §1 #249 | ccloop | (filled by the implementer) | dispatched |
| W2 | §2 activity kinds, §3 #242, §4 #245, §5 #241 | Orca | | dispatched |
| W3 | §6 transcript | Orca | | dispatched |
| W4 | §7 #125 #250 #251 #246 | Orca | | dispatched |
| W5 | §8 settlement, attempts | Orca | | dispatched |
| W6 | §9 D21, #168 | Orca | | dispatched |
| W7 | §10 #256 #258 #257 #84 #200 | Orca | | dispatched |

Logs: `/private/tmp/orca-e1111/<workstream>/` (fixed path; scratchpads are replaced between turns).

## Dispatch (2026-11-11)

Correction to the workstream table above: §3 (#242) went to W4, not W2, to keep W2 to the landing path.
Seven implementers dispatched in parallel: W1 in its own ccloop worktree (branch `e/codex-usage-after-error-row`),
W2–W7 each in an isolated Orca worktree off `docs(spec): tester follow-up E -- …`. Shared rules for them:
`/private/tmp/orca-e1111/implementer-rules.md` (fixed path; not in the repo). No implementer merges or pushes;
the controller merges with `--ff-only` after rebasing and regenerating CLI docs.

## Human authorization for the rest of the round (2026-11-11, verbatim)

「这个session中，尽量将这些要做的task都完整做完」「这次批准改写所有必要的判据。」「这一轮允许必要的付费真跑。」
「这一轮session如果需要repin ccloop，这个session临时允许你push ccloop到origin main。」
「这一轮session，Orca仓库repin完成后临时允许你push Orca 到origin main。」
「这一轮如果遇到卡住必须等人的事情，请继续做不必等人的部分。」「这一轮执行过程中如果有问题，先按你的建议执行。执行完在最后阶段报给我审核。」
Consequence: commits marked `Ruling: pending (tester follow-up E)` are covered by the blanket criteria ruling and may
merge; they are still listed in the round's summary for the human's review.

## W1 landed in ccloop (2026-11-11)

- ccloop commit `fix(codex): a phase that fails on a mid-stream error row carries its completed turn's usage (#249)`
  (branch `e/codex-usage-after-error-row`) fast-forwarded into ccloop main. 5 new criteria
  (`tests/runtime/codex/usageAfterErrorRow.test.ts`), no existing criterion changed; mutations M0–M3 in
  `/private/tmp/orca-e1111/w1-ccloop/mutations.md`. Gate: typecheck/build 0; full suite 2,585 pass / 15 fail /
  7 pending under load 34–52, one known red, the 14 others (timeouts, ENOTEMPTY, perf) all green rerun alone (7 files).
- Differences from the design: the call's own `outcome.json` keeps `observedTokens:null` (written before decoding;
  null for every completed call by design) — the fix shows in `failure-cause.json` `usageObserved:true`, the thrown
  error's observed tokens and the run's booked phase usage. The plan/verify catch also covers later failures after a
  completed turn (booked rather than null). `savedResultRecovery.ts` still refuses this stream shape (unchanged).
- The implementer declined the relayed blanket criteria ruling for ccloop (ccloop Rule 15 wants the human to name
  each criterion); it needed none.
- `git push origin main` for ccloop was refused by the Tier 0 gate (chat authorization does not lift it). The push
  and the Orca repin to that commit wait for the human. ccloop's `dist/` is not rebuilt yet: Orca implementers use it
  as `ORCA_CCLOOP_BIN`, and a rebuild during their gates gives false reds.

## W3 merged (2026-11-11)

- Branch `worktree-agent-aeabfebf8f5133e9e` (3 commits: server listing order + codex result counts; Web wrap / tool join /
  result counts / paging; criteria rewrites) rebased onto main (only docs commits in between) and fast-forwarded.
- Rewrites (blanket ruling): `web/tests/agentTranscript.test.tsx:33`, `taskDetailTranscript.test.tsx:58,62,157`,
  `liveRegion.test.tsx:131`, `runsTableOrder.test.tsx:47-56` — "call N" label and run detail moved below the table.
- Differences: the paging range counts loaded events ("rows a–b of n loaded"; the API's offsets are bytes); running
  tool rows are toned `info`; `leading-[1.55]` is an arbitrary Tailwind value. #244's 390px claim is pinned on structure
  only (no browser measurement).
- Gate (before rebase, 716 files): Web 207/207; root 6 reds = known `orchestration`, `executionDriverE2E` R-F and
  `schedulerBridge` green alone, `startForm` and `allowanceHeldSettlement` also red on an unchanged main clone (load).
  22 mutations all red (`/private/tmp/orca-e1111/w3-transcript/mutations.md`).

## W7 merged (2026-11-11)

- Branch `worktree-agent-a70119822c74c82c0` (8 commits: #256 Completed block, #258 memory offset paging + spec §12,
  #257 count of major decisions outside the high tier, #84 overlay motion + DESIGN.md correction, #200 lilac theme)
  rebased onto main after W3 (clean) and fast-forwarded.
- Difference: #257 needed a small server change — `/api/todo` also answers `majorOutsideHighTier: {projectKey: n}`
  (the default view reads only `/api/todo`); a fourth status "Major, outside the high tier" reads `/api/decisions`.
  lilac's accent is `#5a4ee0` (same hue as `#847aff`, which is 3.4:1 on white).
- Rewrites (blanket ruling): `web/tests/memoryView.test.tsx` truncation text and fake wire shape;
  `tests/panel/decisionsApi.test.ts` `/api/todo` exact bytes; `themes.test.ts` THEME_PREFS order; `i18nPseudo` 207→208.
- Gate: implementer's affected run (454 files) — every red green alone; 40 mutations all red
  (`/private/tmp/orca-e1111/w7-web/mutations.md`). After the rebase onto W3: root and web typecheck 0, full Web suite
  222/222 files, 1,991/1,991 tests (`/private/tmp/orca-e1111/w7-web/post-rebase-web.log`).

## W6, W5, W4 merged; W2 rebased (2026-11-11, late)

Each branch was rebased onto the then-current main, `npm run gen:cli-docs` rerun (no change each time), root and web
typecheck 0, and the workstream's own criteria (plus accessMatrix / skill / refusalCoverage where touched) rerun on the
rebased tree before `merge --ff-only`:
- W6 (`orca project add`, owner-only Web add; #168 `check-docs-only-suite`): 5 files 46/46. No existing criterion
  changed. Gate code read by the controller (the safety classifier had timed out on this agent): socket route refuses
  dispatched runs, no-token and member tokens; the Web route skips the gate only when no principal is set (buildApi's
  authMiddleware always sets one; only bare-mounted criteria have none). Real `~/.orca/projects.json` untouched (mtime
  2026-10-17). The Web form is not hidden from members (they get `owner-required`).
- W5 (agent settlement: charge-remaining-grant / proved known-zero open, release-unmetered person-only, booked to
  `agent:<client>`; recovery-retry acknowledge open; fresh attempts/active time on an explicit retry in an unlimited
  group via a `fresh-start` row in `work_grant_top_ups`, capped by the group's own attempts/activeMs room, else
  `authored-budget-exhausted`; finite groups pinned by a golden captured first): 13 files 108/108. Rewrites in own
  commits: settleUnknownUsage, singleCallUsageSettle, testerStuckStates, accessMatrix, overGrantExit 13, retryTopUp
  T1–T4/T7/T15 (moved to a finite group), tokenPolicyStop.
- W4 (#242, #246 hint, #250 refusal line + draft save seeds the estimator agent, #125 `clarify-call-failed` /
  `split-call-failed`, #251 `answer --finish`): 12 root files 184/184, web requirements 27/27. Only rewrite:
  `singleCallErrorCode` two assertions (§12). Two mutations stay green and are registered, not given invented criteria
  (M4b unreachable condition, M11c redundant RETRYABLE entry). Open for the human: the Web "Answer and finish
  clarifying" button does not ask the second confirmation Consensus asks when branches are open.
- W2 (§2 activity kinds parity, §4 post-merge record, §5 group acceptance + `group recheck` / `group waive-acceptance`):
  its worktree path is redacted in tool output, so the controller rebased its final commit in a new worktree
  `.claude/worktrees/e-w2-acceptance` (branch `e/w2-group-acceptance`). Conflicts resolved by the controller:
  `web/src/ControlGroupView.tsx` (the post-merge line moved into W3's run detail below the runs table);
  `web/tests/i18nPseudo.test.tsx` (lilac + post-merge-check + group-acceptance ⇒ 210); `src/panel/humanOnly.ts`
  (W2's `waive-acceptance: token` beside W5's `recovery-retry.acknowledge: open`). Typecheck 0 both.
  Deviations W2 reports: no record ⇒ accepted when ≤1 task landed or a multi/dir group (a strict gate turned 28 red);
  the record lives on the group body (`acceptance`, keyed by tip; no migration); not a recovery blocker (would block
  the dispatch that fixes it); driverHarness now stops drivers at teardown (fixture rewrite).
- Round gate on the combined tree: `test-affected --base=<round-D handoff commit>`, log
  `/private/tmp/orca-e1111/round-gate.log`.

## W2 merged; round gate; install (2026-11-11, late)

- Round gate on the combined tree (W2 rebased on W3–W7; `test-affected --base=<round-D handoff commit>`, log
  `/private/tmp/orca-e1111/round-gate.log`): 944 files (727 root, 217 web), typecheck 0; root 6,477 pass / 40 skipped /
  2 red = known `orchestration` "admits a debug group…" + `criteriaBaseRun` "a restart while the re-run is in flight…"
  (git `index.lock`; 18/18 alone, `/private/tmp/orca-e1111/round-rerun-criteriaBaseRun.log`); Web 1,915/1,915.
- `e/w2-group-acceptance` fast-forwarded into main. Built (`npm run build`, web build), 7777 restarted with
  `launchctl kickstart -k`; `orca status` all ok, ccloop pin still `095dbdf`.
- ccloop main-tree `dist/` rebuilt with #249 after the Orca gates finished.
- Not done, waits for the human: push ccloop (Tier 0 gate refused the agent's push), then repin Orca and push Orca and
  ccmem. No paid run was needed this round.

## Repin (2026-11-12)

- The human pushed ccloop main with #249 (and Orca main up to W4) mid-session. Repin in worktree
  `.claude/worktrees/e-repin` (real `npm ci`, npm 10.9.9): `node scripts/pin-ccloop.mjs 2af2fb79…` — seven checks ok
  (default-resolution E2E 12/12). Commit `chore(deps): pin ccloop to the codex usage kept after a mid-stream error row (#249)`.
- Repin gate (`test-affected --base=main`, `ORCA_CCLOOP_BIN` = ccloop main-tree dist, log
  `/private/tmp/orca-e1111/repin-gate.log`): 458 files; root 3,897 pass / 35 skipped / 1 red = known `orchestration`;
  web 8/8. Fast-forwarded into main; main-tree `npm ci`, build, web build, 7777 kickstarted; `orca status` all ok,
  ccloop `2af2fb7` pinned and installed.
- Still waits for the human: push whatever `ls-remote` shows unpushed on the three mains.
