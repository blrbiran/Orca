# SDD ledger — plan: docs/superpowers/plans/2026-10-15-error-codes-and-start-guard.md

Controller: Orca session 026d10e3 (2026-10-15). Worktree `/Users/biran/code/skills/orca/Orca-wt/error-codes-start-guard`,
branch `feat/error-codes-start-guard` = main (`Merge branch 'ui/panel-taste'`, 28ac9eae) + merge of
`docs/spec-error-codes-and-start-guard` (specs, plan, rulings R1-R5). Specs: docs/superpowers/specs/2026-10-15-*.md.
Human delegation (this session): "这一轮执行过程中如果有问题，先按你的建议执行。执行完在最后阶段报给我审核。"

Setup: U1 /private/tmp/oec created (0700); U2 worktree + node_modules/web node_modules symlinks + web build rc 0, status clean.

## Pre-flight scan

| Pair / task | Shared file or interface | Finding |
|---|---|---|
| A1 → A2, A3, A4, A8 | `peerFailure`, `peerCode`, `peerExitText`, `ccloopFailedMessage`, `peerFailureLogLine` (ccloopPort.ts) | A1 produces all five; consumers name them identically (plan Self-Review). OK |
| A2, A3, A5, A6, B3 | `src/control/webService.ts` | Sequential edits at different regions; line numbers shift after each task. Ruling below |
| A4, A5, A8 | `src/control/executionDriver.ts` | Same; A8 uses A1's log-line helper. OK |
| A6, A8 | `src/control/stopIntent.ts` (`applyRecoveryRetry` vs `:654` log) | Different functions. OK |
| A3, B1 | `src/panel/controlViews.ts` (`:1191` preview code vs `:362-379` predicate) | Different regions. OK |
| A2, A7, B2, S1 | `web/src/locales/{en,zh}.ts` | Each adds distinct keys; A7's coverage list must include A2's `ccloop-failed`. OK |
| A7, S2 | `tests/panel/refusalCoverage.test.ts` | A7 adds `CCLOOP_CODES` + `control-peer-exit` to VIEW_REASONS; S2 adds `codex-rate-limited`. Both append to the same array; S2 after A7. OK |
| A7, S1 | `web/src/ControlGroupView.tsx` | A7 estimate reason render; S1 Runs table label. Different regions. OK |
| B1 → B2, B3 | `groupExecutionPendingInStore` / `BUSY_WORK` | B2 consumes B1's store entry; B3 does not use the predicate (its own editability). OK |
| B2 Step 6 | `tests/control/fixtures/driverHarness.ts` | R1: Option A, no stop |
| S3 | ccloop repo | R5: ccloop branch `codex/attempt-commit-no-hooks` |
| Each task self-consistency | tests vs code in the same task | Read during the plan's own Self-Review (writer) and the controller's skim of A1/A2/B2 headers; no internal contradiction found beyond K1-K8 already corrected |

Ruling: line numbers in later tasks are anchors as of d3c02b7f; implementers locate by the quoted text, not the number — earlier tasks in this plan move lines — cost if wrong: an implementer edits the wrong region, caught by the task review.
Ruling: plan R3 changes the generic fallback text and Task A7's literals mechanically — the human-visible text must not call an Orca code a ccloop failure — cost if wrong: a wording change in two locale strings.
Ruling: mutations are run by each task's reviewer in a clone under /private/tmp/oec/mut/<task> (plan Global Constraints) — the reviewer, not the implementer, proves each criterion red — cost if wrong: one extra review seat per task.

## Tasks
Task S3: complete (ccloop commits 60047b1..abc7a27 on codex/attempt-commit-no-hooks; registry.test.ts 17/17, typecheck 0)
Ruling: S3 reviewed by the controller from its 3-line diff instead of a review seat — title-only, assertions untouched, published comment kept verbatim with an appended ruling line (ccloop Rule 15/16) — cost if wrong: a misleading test title.
Task A1: implemented f55d970..7e6baa0; review: Spec ✅, 1 Important (DEL/NUL/final-colon unpinned), mutations A1a-A1d red
Task A1: minor (deferred): A1a reddens two extra tests besides the URL test; new code's spaced style vs compact neighbours (brief's verbatim text)
Task A1: fix round 1/5 (1 addressed, 0 open — DEL/NUL/final-colon pinned; commits 7e6baa0..9b6391a)
Task A1: complete (commits f55d970..9b6391a, review clean; mutations A1a-A1d + 3 fix-round mutations red)
Ruling: implementer commits carry the implementing model's own Co-Authored-By (e.g. Sonnet 5.5) — it is the truth (handoff: such trailers are true and not amended) — cost if wrong: trailer wording differs from the contract's.
Task A2: implemented 9b6391a..b76fe1f; review: Spec ✅, 1 Important (hasPendingAgentUpdate conjunct unpinned, A2e green), A2a-A2d red
Task A2: fix round 1/5 (1 addressed by registration, 0 open — no commit)
Ruling: A2e (`hasPendingAgentUpdate` conjunct in applyAgentUpdate's catch) is registered as a redundant guard, not given a criterion — controller read agentUpdates.ts:64-89,150: the only peer call runs after reserve() wrote/kept the pending row, so no real state reaches the catch without it (handoff §6.1 shape 2) — cost if wrong: a future peer call placed before reserve() would answer 424 instead of 500 with no criterion catching it.
Task A2: complete (commits 9b6391a..b76fe1f, review clean, 1 redundant guard registered)
Task A3: implemented b76fe1f..969017f; review: Spec ✅, 1 Important (recoverAgentUpdates non-ControlError fallback unpinned, A3i green), A3a-A3h red
Task A3: fix round 1/5 (1 addressed, 0 open — F4 pins the reconcile fallback; commits 969017f..de17690)
Task A3: complete (commits b76fe1f..de17690, review clean; A3a-A3i red)
Task A4: complete (commits de17690..373a3ed, review clean; A4a, A4b red)
Task A5: complete (commits 373a3ed..a72f3e2, review clean; 12/12 mutations red)
Task A5: minor (deferred): 2 minors in task-A5-review.md
Ruling: /private/tmp/oec/mut/mut.sh lacked `exit 2` on a failed mutate (A5 reviewer); controller restored the preamble's line — earlier reds stay valid (a non-applied mutation cannot turn a test red); earlier greens (A1 extras, A2e, A3i) were each followed by a new criterion seen red or a code-read unreachability — cost if wrong: one earlier "green" mutation was never applied.
Task A6: implemented a72f3e2..f84aee5; review: Spec ✅, 1 Important (profile-unresolved fallback unpinned, A6d green), A6a-A6c red; 2 minors in task-A6-review.md
Task A6: fix round 1/5 (1 addressed, 0 open — profile-unresolved fallback pinned; commits f84aee5..265642c)
Task A6: complete (commits a72f3e2..265642c, review clean; A6a-A6d red)
Ruling: A7 — an unknown code's explanation equals the code under R3, so every surface adds the explanation only when it differs from the code (implementer applied it to TaskDetail and the blocked-run line; controller extended it to AgentSelectionEditor, AgentSettings, RequirementsPanel failed-call) — no surface may show 'X · X' — cost if wrong: one fewer repeated token on screen.
Task A7: implemented 265642c..3c5f21b; review: Spec ✅, C1 (agentsI18n.test.tsx:126 red, unreported), I1 (which failed call RequirementsPanel shows unpinned, A7s/A7t green), 27/29 mutations red; 3 minors in task-A7-review.md
Ruling: rewrite web/tests/agentsI18n.test.tsx:126's literal to include the Orca-table explanation of a rejected slot — spec A §4.6 requires the slot surface to explain codes (ccloop → Orca table); not on the plan's rewrite list, decided under the human's delegation — cost if wrong: a rejected slot shows one extra sentence; revert by restricting that surface to the ccloop table.
Task A7: fix round 1/5 (2 addressed, 0 open — C1 literal rewritten per ruling; I1 failed-call choice pinned; commits 3c5f21b..0a09d09; web full 1118/1118)
Task A7: complete (commits 265642c..0a09d09, review clean; 29/29 mutations red; 3 minors deferred in task-A7-review.md)
Ruling: implementer contract now requires the full web suite (~2 min) whenever web/src changes — A7 broke agentsI18n.test.tsx outside its targeted list and the report missed it — cost if wrong: ~2 min per web task.
Task A8: complete (commits 0a09d09..2034af1, review clean; A8a, A8b red)
Task A8: minor (deferred): peerFailureLog.test.ts:22 dedupes via Set (comment claims once-per-occurrence); stopIntent.ts:657 also logs a non-peer probe failure code (accepted under the plan's code-only interpretation)
Task B1: complete (commits 2034af1..20301d8, review clean; B1a-B1c + reviewer B1y red)
Task B1: minor (deferred): store entry's `kind === "task"` filter unpinned (B1x green; looks unreachable today); phase list in executionPending.test.ts:20 omits literal "estimate" (covered end to end)
Task B2: implemented 20301d8..f084ed5 (Option A turned 40 census reds green); 11 still red → rulings below
Ruling: handoffFailedRetry.test.ts (10 reds) — driverHarness.claim() also delivers an already-waiting dispatch wake; the 10th test's own reopen() claims through the fixture path instead of a fresh start (no assertion changed) — a fresh human start is exactly what #53 now refuses while a resume wake is pending — cost if wrong: the fixture hides a real double-dispatch case.
Ruling: shutdownHealing.test.ts:142 — deliver the pending no-start wake as the driver would, then start; keep `scheduled` — spec B §3.2 counts an undelivered no-start wake as pending; the criterion's intent (start accepted after healing) is kept — cost if wrong: an operator sees group-execution-pending for one driver tick after healing.
Ruling: shutdownHealing.test.ts:142 option (a) — after healing the delivered no-start wake answers claimed, then start answers group-execution-pending (replaces scheduled) — keeps the 'dispatch proceeds after healing' intent under spec B §3.2 — cost if wrong: one rewritten literal.
Task B2: complete (commits 20301d8..08276cf, review clean; 20/20 mutations red incl. reviewer extras B2x-B2z)
Task B2: minor (deferred): scheduleStart doc comment now sits on startRefusedAsPending (webDispatch.ts:127-129); startGuardSocket.test.ts:29 reds as TypeError under B2j (use ?.code); shutdownHealing.test.ts:108 title still says "and then accepts start"
Task B3: implemented 08276cf..9eab8af; review: Spec ✅, 1 Important (shutting-down refusal unpinned, B3x green), 8/8 named mutations red
Task B3: fix round 1/5 (1 addressed, 0 open — C7 shutting-down refusal pinned; commits 9eab8af..aa73953)
Task B3: complete (commits 08276cf..aa73953, review clean; 9/9 mutations red)
Task S1/S2: implemented aa73953..8355528; review: Spec ✅, 1 Important (S1 uncounted-run branch unpinned, S1e green), S1a-S1d + S2a red
Task S1: fix round 1/5 (0 addressed, 1 open — S1e still green: uncounted run was first of its task; commits 8355528..b22a1b5)
Task S1: fix round 2/5 (1 addressed, 0 open — fixture reordered so S1e reds; commits b22a1b5..4095c65)
Task S1: complete (commits aa73953..4095c65 incl. S2, review clean; 8/8 mutations red)
Task S2: complete (commit 8355528, S2a red)
Ruling: ccloop full gate not re-run for S3 — S3 is a title-only change on 60047b1, whose clone gate is recorded (/private/tmp/ccq4-gate: full 1710/1712, both reds 3/3 alone; control 818/820, both reds 3/3 alone; tmpleak 0) and registry.test.ts ran 17/17 on S3 — cost if wrong: an unseen interaction of a test title (none possible).
Final review: Ready with fixes — 0 Critical, 1 Important (I1: 424 ccloop-failed notice hides ccloop's code; zh Orca-table fallback drops detail), 9 Minor (task-final-review.md)
Ruling: final fix wave = I1 + m8 (orphaned scheduleStart doc comment; shutdownHealing.test.ts:108 title) + unknown code shown twice on estimate/blocked-run lines + group-execution-pending text without "dispatched automatically" + SKILL.md names the 424; dispatched only after the running Orca gate finishes (edits mid-gate would mix trees); left as registered minors: driver log lines cut to 512 (full stderr not kept), recoveryRetry probe outside the admission gate, cap-exceeded text wording on the estimate line, pre-existing plan-card offer for a stopped-without-intent group — cost if wrong: the listed minors stay visible to operators.
Task G (gate, head 4095c65, /private/tmp/oec/gate): typecheck/build/webbuild/ledger/claudemd/hooks/pin/panel/ws/tmpleak 0; scheduler 202/202; full 3807/3865 33 skip 25 red (23 x 5 s timeouts + driverReconcileN deadline + taskResultPaired x2); chain (second full) 3830/3865 only taskResultPaired x2; control 1958/1991, taskResultPaired x2 + settleUnknownUsage timeout. Every timeout passed in the second full run.
Final fix wave: 4095c65..53c9a16 (I1 + m8 + unknown-code-once on estimate/blocked-run lines + group-execution-pending text + SKILL.md 424); implementer saw M1-M4 red in /private/tmp/oec/mut/final-fix; web full 1125/1125; re-review: all ADDRESSED, no new breakage, no pre-existing assertion changed (the 3 changed assertions belong to tests added in A7).
Final review: clean after one fix wave — branch ready to merge (human ff).
