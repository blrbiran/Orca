# Session e2ad4802 (2026-11-05) — progress ledger

Who: Claude Code (Opus 5.5), Orca session e2ad4802. Human away for most of the session: 「尽量将这些要做的task都完整做完…这次批准改写所有必要的判据。这一轮允许必要的付费真跑。这次在必要时临时允许你push ccloop到 origin main…如果有问题，先按你的建议执行。执行完在最后阶段报给我审核。」

## Human rulings at session start (原话)

- ccloop push: 「都已push」 (ccloop a885241 on origin). Panel: 「这次新的session中你可以重启」. Cleanup: 「允许删除无用的branch和worktree」.
- A4 (two setup loops): 「按你的建议抽公共函数」. Attribution: 「同意」 (trailer = the actual model, or none). 2 s drain: 「同意按你的建议做」.
- Failover D1–D6: 「其他同意」, amendment 「如果是provider额度用完，且有备用provider，可以改provider并重试。」 Paid runs: 「这个session中，需要的情况下都同意」 (none were needed).

## Done (Orca main, ff-only)

1. Part A installed in 7777 (build, web build, kickstart; pid changed, HTTP 200).
2. C0 repin to ccloop a885241 (`chore(deps): repin ccloop to a885241 for task setup commands`; pin-ccloop.mjs E2E 12/12, typecheck, npm ci).
3. Part C merged (rebased onto the repin; npm test 575 files: 573 green, startForm registered flake and ccloopProtocol — the latter red because this session first pointed ORCA_AGENTS_TABLE at a real table; with the fake-codex `integration` table the 30 table-reading files were 252/252, 3 skipped by design). Installed in 7777 again.
4. A4: `refactor(control): one runner for every command Orca runs as a check, setup included` (checkCommand.ts; 4 mutations red).
5. Friction: `fix(control): set-orchestration-settings keeps the global flow settings and their locks` (found by the failover map; criterion red on the old code) and `feat(cli): orca agent preferences …` (F7, F9, F10, F12).
6. Spec §8 appended to the failover spec (rulings + amendment).

## ccloop main (local, NOT on origin)

`fix(setup): the verdict is taken at the shell's exit, and a cut drain is marked in the log` + plan follow-up. Criterion red before the fix; mutations M1–M4 red; full gate 2494: 2493 pass, 1 known red (runLoop phase usage evidence), check-known-reds RC 0. **Push refused by the Tier 0 gate hook (not retried).** Orca stays pinned to a885241 (does not need this fix to work).

## Failover (branch feat/quota-failover → see the plan's As built)

Plan/as-built: `docs/superpowers/plans/2026-11-05-quota-failover.md`. Rulings by the controller (to review):
- Ruling: no new ccloop cause; ccloop's existing `quota` + `detail` text is read by Orca — why: the cause exists and a contract change would need a push/repin this session could not do — cost if wrong: claude's reset text and other shapes fall back to the default rest.
- Ruling: rests derived from stored runs, no table — why: nothing to keep in step, no schema bump — cost if wrong: a scan per pass with candidates.
- Ruling: the order lives in the orchestration settings (`failoverOrder`), not the agent preferences — why: those are per operator and orca-auto has none — cost if wrong: one global order instead of one per operator.
- Ruling: an installation in `quotaWait` is not switched away from — why: the quota wait is "wait instead of switching" (spec 2026-10-21 §5), and the gate showed failover pre-empting it — cost if wrong: a person who set wait and also wants failover gets wait.
- Ruling: a plan-named agent (task-plan / group-plan) counts as hand-picked (D2) — why: the plan author chose it — cost if wrong: plan-pinned tasks wait instead of switching.
- Ruling: retry-task stays `any` actor with the new `agent` field — why: unchanged authority surface; flagged by the review — cost if wrong: an agent token can pick a task's installation.
Independent review (ecc:code-reviewer): Important 1–3 fixed (epoch stamp; pass hardening; history cleared on reopen/confirm).

## Not done (why)

- F5 (transcripts over CLI/socket): reverses live-transcript ruling 3 ("v1 has no CLI reader") and criteria T5/T13 — needs the human.
- F6 (`orca login` without a TTY): CLI v2 spec §15.3 reads the password at a terminal by design — needs the human.
- F8 (USD spend cap), F11 (`orca status` mixing the service line with a redirected panel): not started.
- soft-mode loop-run settlement principal: not started (needs a joint Orca/ccloop design).
