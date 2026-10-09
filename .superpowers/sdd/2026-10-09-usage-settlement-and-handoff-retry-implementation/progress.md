# SDD ledger — plan: docs/superpowers/plans/2026-10-09-usage-settlement-and-handoff-retry-implementation.md

Owner: controller, 2026-10-09 Asia/Shanghai. Product base c29676d; design branch inherited a08c763. Execution workspace is Codex-managed `/Users/biran/.codex/worktrees/usage-settlement-handoff-retry/Orca`, branch `codex/d9-m3-implementation`. Source spec §9 including9.5 has priority; previous design history is in the sibling new-round ledger, old issue-fixes remains closed.

Ruling: Human explicitly delegated design/plan/runtime decisions and requested full subagent-driven completion with final review. No intermediate human approval wait; no push/merge/deletion authorized here. Cost if wrong: reversible feature-branch rework.

Ruling: Use the managed worktree and reuse already pinned installed node_modules by a dependency symlink; no duplicate npm install. All product writes stay in this workspace; ccloop gate clone is detached ab824d1 at /private/tmp/orca-d9-ccloop-ab824d1/dist/cli.js. Cost if wrong: dependency artifacts could be shared; suite paths and mutation builds stay separate clones, never commit dependencies.

## Preflight self-review table — controller, 2026-10-09

| Pair/task | Producer→consumer / internal check | Result |
|---|---|---|
| 1↔2 | settled-failed request/marker/schema10→released retry admission; shared observed predicate→handoff | Names/states agree; Task2 waits for Task1 review |
| 1↔3 | unknownUsageSettlement preview/result and verb→owner UI | Task3 consumes server authority, cannot replace proof |
| 1↔4 | settlement tests/schema rewrites/logs/clone mutations→gates | Full gates after integration, precise schema9 changes listed |
| 2↔3 | inactive/released retry eligibility and failure outcome→runFacts/button | No-stop boundary and empty-selection resume retained |
| 2↔4 | live source/policy tests/mutations→final review | Captured actual accept envelope; no-provider restart assertions |
| 3↔4 | web/localization/action tests→web and panel gates | web build before panel; actual role/refusal checks |
| Task1 | active/released accounting and observed/manual proof tests vs handler | Correct distinct reserve formula, schema/test filenames agree |
| Task2 | three admissions and no-provider lifecycle vs reader/writer | frozen hash and latest lineage preserved |
| Task3 | authority preview, owner command and stop boundary vs UI tests | no standalone local bookkeeping |
| Task4 | gates/final fix/review/docs vs constraints | no publishing, no deletion, no real provider validation claim |

- Task 1: pending.
- Task 2: pending.
- Task 3: pending.
- Task 4: pending.

Spec review4 found one Important (D9→handoff observed predicate); appended9.5 corrects it. Fresh spec/plan preflight is in flight. No product implementation yet. User requires persistent three-repository handoff and an in-chat executive summary under10lines at completion.

## Ready to execute — controller, 2026-10-09, base a08c763

Independent preflight review: Spec PASS, Plan PASS, Ready to execute Yes, no Critical or unresolved Important. Initial missing route/entry/archive全集 finding fixed in unpublished plan; report retains finding and correction. Adopted both Minor suggestions: Task2 full D9→handoff→resume→retry→claim criterion and actual old-reader-v9 rejects10 vs new-reader-v10 rejects11 evidence.

Baseline at a08c763 in managed worktree: `npm run build --workspace web`, `npm run typecheck`, `env ORCA_CCLOOP_BIN=/private/tmp/orca-d9-ccloop-ab824d1/dist/cli.js node_modules/.bin/vitest run tests/control/schema9.test.ts tests/panel/permissions.test.ts` all RC0; focused2files/6tests passed. Full raw logs `/private/tmp/orca-d9-baseline-{web-build,typecheck,tests}.log`. Not a rerun of old issue-fixes gates.

## Scope sequencing — controller, 2026-10-09, implementation base 2c14e73

Ruling: The human approved M5/M6 and requested completing the tasks this session. Prepare its independent spec/plan while D9/M3 executes, but never run parallel product writers; start performance implementation only after D9/M3 task gates/close. Cost if wrong: additional review time; separation keeps reversible scopes auditable. Performance draft uses fixed c29676d code, and must consume completed D9/M3 interfaces at execution time.

Task1 initial RED observed: `/private/tmp/orca-task1-red4.log` full output read, RC1; schema10 fresh-store assertion sees9, four real driver/handoff settlement criteria fail because WebControlService.settleUnknownUsage is absent. These are expected product failures, not a passing implementation claim. Worker is implementing shared marker/proof/accounting paths; no subsequent product task dispatched.

Whole-round gate environment prepared at `/private/tmp/od9/env.json`, runner `/private/tmp/od9/run.py`; fake codex installation uses pinned clone fixture in integration mode. HOME/fourXDG/TMPDIR/CCMEM_DATA_ROOT/corrections all temporary, inherited real CCMEM_CONFIG_PATH absent. No suite run against this environment yet.

## Task 1 implementation checkpoint — controller, 2026-10-09

Worker implement_settlement DONE, product43b0f16 + report405f6b6. Task-specific fresh reviewer is in flight; task not yet marked complete. Report task-1-report.md and diff package review-2c14e73..405f6b6.diff cover full2commit range, BASE2c14e73.

Observed final isolated logs task1-target-final/typecheck-final: RC0, 9files122tests, no skipped; webbuild/actual oldv9 reader rejects10 proof in report. Worker records21 independent valid guard deletions red and clone restored42tests/zero unstaged+staged bytes; first wrong-target zero-token mutation excluded then exact branch independently red. Whole round integrated gate remains Task4.

Ruling: Over-limit settlement test uses a real provider overage followed by unknown, rather than lowering group limit after unknown (existing set-limit correctly refuses then). No product set-limit guard relaxation. Cost if wrong: fixture would miss a real overage path; actual post-command used/reserved/deficit assertions and mutation remain required.

## Task 1 gate complete — controller, 2026-10-09

Task1: complete (commits2c14e73..405f6b6, fresh task review clean). Review task-1-review.md: Spec compliant, quality Approved,0Critical/0Important. Reviewer cross-checked all21mutations against final delivered code and business assertion logs; restored clone differs only fixture trailing whitespace. Minor validation noise: Node22 SQLite experimental warnings and existing Vite bundle size hint, not hidden/skipped tests.

Task2 next: consume hasValidUsageSettlement(store,run), RunViewV1.unknownUsageSettlement and marker reservationDisposition/handoffResolution; completed released D9 leaves work blocked/terminal and current source inactive settled-failed, no automatic retry. Controller performance docs committed independently; performance still not implemented.
