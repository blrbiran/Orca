# New round — usage settlement and handoff-failed retry

Owner: Codex controller, 2026-10-09 Asia/Shanghai. Observation base: Orca c29676d6d0050d46b9cf61f45ffaee583f9dec76.

- [x] Read handoff entries in Orca/ccloop/ccmem and issue-fixes Round close; no old task reopened.
- [x] Confirm remote main with ls-remote and issue-fixes ancestry with /usr/bin/git merge-base --is-ancestor (exit 0).
- [x] Installed ccloop hidden lock resolved ab824d16004de2d3c1613a76ec0431520aa16cc9, matching package-lock.
- [x] Record the human's D9, M3, four F2 timeout, M5/M6 and post-merge cleanup rulings (2026-10-09 user message).
- [x] Read-only design exploration; compare separate settlement vs combined retry and preserve completed-stop resume boundary.
- [x] Draft spec: docs/superpowers/specs/2026-10-09-usage-settlement-and-handoff-retry-design.md.
- [ ] Spec self-review and independent subagent review.
- [ ] Human review of written spec.
- [ ] writing-plans, named existing-test rewrites, plan review.
- [ ] subagent-driven implementation and gates.

Ruling (human, 2026-10-09): D9 human-only remaining-grant settlement accepted; M3 retry after handoff-failed settlement accepted. M5/M6 performance accepted as a following round. Approval of feature scope is not approval of this draft's exact interfaces/accounting/state design.

Ruling (human, 2026-10-09): register the four F2 5 s timeouts. Historical evidence remains in the old issue-fixes ledger F2, not re-tested here. Registered names and interpretation: docs/handoff/known-load-flakes.md.

Cleanup outcome: docs/handoff/2026-10-09-post-merge-cleanup.md; reviewer diffs archived with SHA256 manifest before removal. No push, merge or remote-branch deletion in this session; no product code, tests or user data modified during design preparation.

## Design checkpoint — controller, 2026-10-09, observed base c29676d

Self-review completed: placeholders, scope, amount invariants, schema/read compatibility and consumed-continuation identity checked. Independent reports spec-review-1.md and spec-review-2.md retain all observations; latest review-2 correction: Ready for human spec review, no Critical/Important.

Verified reviewer claims against executionSnapshot.frozenAllocationShape, controlViews.validateExecutionSnapshot, recordUsage, createStartingRun, continuationAlreadyClaimed and terminaliseRun. Corrected NEW unpublished draft: preserve D9 task allocations; M3 introduces validated retrying/live-grant source; consumed continuation is distinguished from pending registration. Added both-bucket settlement preview and explicit empty-selection resume while preserving checkpoint Continue.

Latest checklist state: exploration/draft/self-review/subagent review complete. Human written-spec review, plan and implementation pending. No old task rerun; no product/tests changed or product suite run.

Documentation verification at the observed base: git diff --check RC0; Python assertions confirmed old issue-fixes ledger bytes unchanged, five worktree paths and their local branches absent, no prunable registrations, archive 43/43 member SHA256 matches, both ccloop lock resolutions ab824d1, tracked modifications docs-only, no TBD/TODO in draft. Git operations used rtk proxy /usr/bin/git. Performance follow-on brainstorming: docs/handoff/2026-10-09-performance-next-round.md.

Awaiting human: review docs/superpowers/specs/2026-10-09-usage-settlement-and-handoff-retry-design.md, including both-bucket/four-dimension conservative charge, owner boundary, schema10, retrying/reduced grant lifecycle and completed-stop resume requirement. Feature scope approval was already given; this checkpoint asks only for written-design review.

## Independent review correction — controller, 2026-10-09, reviewed draft 79b7495

Human explicitly requested an independent subagent review. Fresh reviewer `/root/fresh_independent_design_review` received isolated context, read the draft and production callers without the previous reports, and wrote `independent-spec-review-3.md`. Verdict: With fixes, 0 Critical and 3 Important. This supersedes the earlier checkpoint's readiness conclusion; historical reports and draft remain unchanged.

Controller verified the three findings against production code: I1 normal retries with reduced grants currently dispatch the larger frozen executionPolicy (executionDriver A2 clamps only continuation runs; pinned ccloop executes envelope.work.contract). I2 an isolated failed run with unknown usage can become settled-unrecoverable/handoff-partial after handoff; remaining was released, resume requires handoff-complete, and the old unknown run still blocks dispatch. I3 legal failed-before-provider and settled-restartable transitions retain the newest currentRunId while rearming ready, contradicting a blanket ready=current source invariant for retrying.

Next: append a dated design correction or prepare a new revision covering actual port.accept policy limits, post-handoff conservative accounting and a valid stop exit, and the full retrying/source no-provider lifecycle; add the corresponding executable acceptance and deletion-mutation proposals, then obtain another independent review. Human feature approval remains valid; written-spec review, plan and implementation remain pending. No request for human acceptance of an unresolved blocker is made at this checkpoint.

Review scope: static source inspection only, no test suite or real provider/control-store operation. Product files, tests and the old issue-fixes ledger were not changed. Review evidence and exact source locations are retained in the independent report.

## Execution authorization and design correction — controller, 2026-10-09, base 59f6c8e

Ruling: The human's latest `/handoff` message explicitly authorizes fixing the design, writing the plan and subagent-driven implementation, with controller decisions during execution and final human review. This overrides intermediate artifact approval waits in skills; it does not authorize pushing, merging or unrelated deletion. Wrong design decisions remain reviewable/reversible on the feature branch.

Appended spec §9 addresses I1–I3 without changing historical text: actual A2 policy clamp; committed vs released manual settlement; a marker-validated manual settled-failed request that completes a usage-only failed handoff without claiming checkpoint recoverability; exact retry reservation distinctions; valid no-provider/restartable source lifecycles. Fresh isolated subagent review is in flight before plan execution.

Prepared a separate no-hardlinks local ccloop clone in `/private/tmp/orca-d9-ccloop-ab824d1`, detached at the pinned ab824d1. Existing ccloop dependency directory is linked read-only for build use; clone's `npm run build` exited 0. Verification binary: `/private/tmp/orca-d9-ccloop-ab824d1/dist/cli.js`. Logs: `/private/tmp/orca-d9-ccloop-{clone,checkout,build}.log`; observations belong to this checkpoint, not a new upstream change.
