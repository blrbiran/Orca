# SDD ledger — plan: docs/superpowers/plans/2026-09-20-web-recoverable-control.md

Spec: `docs/superpowers/specs/2026-09-19-web-recoverable-control-design.md`

**This file is the main-tree continuation of that plan's ledger, not a replacement.**
Tasks 1–6 were executed and reviewed in the control development tree
`/Users/biran/.codex/worktrees/control-foundation-0919/Orca` on `codex/control-foundation-0919`, and
their per-task dispatch, review, fix-round and regression lines stay in
`<that tree>/.superpowers/sdd/2026-09-20-web-recoverable-control/progress.md` (plus
`task-N-brief.md` / `task-N-implementer-report.md` / `review-*.diff` in the same directory). That
history is not copied here and not edited -- per the person's standing rule, 历史台账一个字不改.
The dev tree still exists with its `node_modules`; nothing was pushed and no branch or worktree was
deleted.

Person's instruction for the rounds covered here: run the plan task by task; on a problem follow the
controller's own recommendation and report everything at the end for review; after all planned work
update `docs/handoff/handoff.md` in Orca, ccloop and ccmem; deliver an Orca executive summary of at
most 10 lines in chat only, never in a file.

Standing authority, restated because it governed every line below: 开门／合并／删分支或 worktree／push
four separate authorizations; the controller does not push; non-gate merges are `--ff-only`;
verification commands go through `rtk proxy` and remote state is judged only by `git ls-remote`;
costs are reported only as a tool printed them; an implementer may not weaken its own criteria --
changing a criterion needs the person to name the test; the controller does not announce on the
person's behalf; no live model call is authorised for these slices.

## Rulings taken on this plan

Ruling (Task 7 evidence storage): store the durable proof/context records behind a **new schema-3
migration** (`proof_records`, `context_observations`, `context_latches`, dedicated tables with the
spec's one-canonical-record-per-tuple constraints) rather than reusing `outbox` -- reusing a
delivery-queue table (`delivered` flag, `id` primary key) for permanent evidence was rejected —
costs if wrong: the version-gated migration path is touched, so a schema-2 store must migrate before
it can be read again.
Ruling (wake-engine ownership): **Task 7 builds the general multi-kind wake engine** rather than a
minimal focused consumer with the engine deferred to Task 8 — costs if wrong: Task 8's
stop/continuation/shutdown wakes inherit an engine shaped by Task 7's truth table.
Ruling (Task 7 commit): commit with `PATH="/usr/local/bin:$PATH" git commit` so the repo's
`scripts/githooks/pre-commit` really runs against a working node; `--no-verify` was not used and the
hook was not edited.
Ruling (environment): **不修全局，用 PATH 前缀提交** -- the broken homebrew node (missing
`libsimdjson.26.dylib` after the simdjson 26→29 bump) is left alone; every verification and commit
command carries the `/usr/local/bin` prefix — costs if wrong: the machine default node stays broken
and every future command in every repo on this machine needs the same prefix.
Ruling (this round, disclosed for approval): one production change inside Task 10 -- the evidence
download route, committed alone as `92e7df2` so it can be reviewed or reverted apart from the test
commit. §8.1 of `final-report.md` states it; it is not self-approved.

## Task lines (main tree; located by subject, hashes are this session's `git log`)

Tasks 1–6: integrated locally by `88f41a2 merge: temporary Web recoverable control Task 1-6`
(person-authorised temporary local integration; review verdicts and fix rounds in the dev-tree
ledger above).
Task 6 review closure: `195c180 fix(control): close Task 6 settlement review gaps`,
`6370fa6 fix(control): reject noncanonical validated estimates`; recorded closed by
`a16ff06 docs(handoff): record Task 6 review closure`. Final independent复审 verdict for Task 6:
Approved, no Critical/Important/Minor outstanding (handoff §2026-09-20 section).
Task 7: complete -- `811defa feat(control): dispatch recoverable web runs` (durable start,
wake→claim→proof→session admission truth table, proof recovery, context-watermark latch).
Task 8: complete -- `41c9ecc feat(control): orchestrate recoverable web stops` (`stopIntent.ts`,
`continuation.ts` + `webDispatch.ts`, `controlLifecycle.ts`, six new verb routes); handoff
`f38c7af docs(handoff): record Web recoverable control Task 7-8`.
Task 8 follow-up fix: `9431867 fix(control): keep an unspent grant booked on a pre-provider failure`
-- closes the 挂账 item 2 that Task 8 handed forward (a `failed-before-provider` run left
`remaining = zero()` and blocked the group's read path).
Task 9: complete -- `6a8fa6e feat(web): add recoverable task control` (thin browser client,
canonical state, recoverable task views).
Task 10: complete this round -- `92e7df2` (production evidence route) + `5f22a9e test(control):
verify web recoverable control` (5 test files, shared Panel fixture, 2 named scripts, and the whole
evidence tree under this directory).

**Review-seat status, stated plainly:** Tasks 1–6 each had an independent adversarial review seat and
fix rounds, in the dev tree. Tasks 7, 8, 9 and 10 in the main tree did **not**: the controller wrote
their tests and code, and Task 10 is the acceptance evidence for all of them. So the plan's final
checklist item "whole-branch review" is still open, and it is the seat that should judge whether
Task 7's general wake engine and Task 10's single production route were the right calls.

## Minor findings deferred (not fixed, not hidden)

* The evidence manifest's `downloadUrl` was 404 until `92e7df2`; the manifest and the route are now
  consistent, but `web/src/ControlGroupView.tsx:99` and `web/src/RecoveryView.tsx:49` still render
  those links as plain anchors, which cannot carry `x-orca-token` and so answer 401 in a browser.
  Task 9 surface; needs a product decision, not a test change.
* Production `orca panel` still constructs no control runtime, so no `/api/control` route is mounted
  outside the test harness (handoff 2026-09-21 挂账 item 1; unchanged by Task 10 and re-verified this
  round by grepping `src/panel/` for a `deps.control` provider -- there is none).
* No production consumer translates the ledger's `orca-dispatch-envelope-v1` into a ccloop
  `StartEnvelopeV1`, and `createCcloopExecutionPort` exposes no `probeProfileCapabilities`, so a raw
  ccloop port cannot drive Web dispatch. `tests/control/webCcloopSmoke.test.ts` performs that
  translation in-test and says so in its header comment; the chain gate still needs the real loop.
* `tests/control/webFaults.test.ts` and `webCcloopSmoke.test.ts` exercise worker-side seams
  in-process (estimate answer, run disposition), because a browser cannot supply either.
* The `fault-injection/` and `mutation/` directories created under this evidence path stayed empty:
  their content went into `webFaults.test.ts` / `webMutations.test.ts` and §5–§6 of the report
  instead. Git does not track empty directories, so nothing was committed for them.

## Verification this round

`commands/2026-09-21-task-10.md` (every command, exit code and count, including the 9 red runs and
what each revealed), `acceptance-map.md` (spec §9.1/§9.3/§9.4 to `file:line`), `final-report.md`
(artifacts, redacted API fixtures, deviations, findings). `test-logs/` holds the unfiltered logs and
`artifacts/api-fixtures.json` the verbatim Panel answers, regenerable by
`artifacts/api-fixtures-dump.test.ts.txt`.

No live model call occurred in any of it; Codex remained `usageObservation: phase-end` plus
`budgetEnforcement: soft` everywhere, and the strict-mode rows prove only that strict is
unreachable on it.
