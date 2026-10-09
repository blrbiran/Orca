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
