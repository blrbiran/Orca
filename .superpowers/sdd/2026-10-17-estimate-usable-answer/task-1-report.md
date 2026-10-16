# Task 1 report: estimate repair module

Implemented `src/control/estimateRepair.ts` (PLACEHOLDER_RATIONALES, RepairContext, RepairResult, repairEstimateOutput, problemsFromRefusal, capProblems) and extracted `budgetEstimateTaskSchema` in `src/control/webProtocol.ts` (no behavior change). Tests: `tests/control/estimateRepair.test.ts` (22 tests).

Decisions: v2 conversion also sets schema to v1 and copies planHash (a v2 answer has none), so `answer-v2-converted` is the only code for a clean v2 answer. v2 keys not in the plan are appended as entries so step 5 reports `unknown-task-dropped`. Top-level problems are `field-invalid:<key or path>` (extra keys named by key). Problems sorted, then capped.

TDD: RED (module moved away) `vitest run tests/control/estimateRepair.test.ts`: exit 1, "Cannot find module '../../src/control/estimateRepair.js'", no tests. GREEN: 22 passed (22). `npm run typecheck` exit 0. Also estimateE2E.test.ts passes alongside.

Mutations (git clone --local in /private/tmp/mut-13nc/c, node_modules symlinked, baseline 22/22 green there):
1. step 6 `parsed.success && !isPlaceholder(...)` -> `parsed.success`: 2 red (placeholder-first duplicate keeps real one; missing+placeholder sorted problems). Restore: git diff 0 bytes, git diff --cached 0 bytes.
2. `Object.hasOwn(keyed, id)` -> `id in keyed`: 1 red (prototype-name `constructor` / all-digit ids test). Restore: 0 / 0 bytes.
(First mutation attempt was run against a mis-staged clone and discarded; the numbers above are from the clean rerun, baseline verified green first.)

Files: src/control/estimateRepair.ts (new), src/control/webProtocol.ts, tests/control/estimateRepair.test.ts (new).
Concerns: none blocking. The "no entry attributable" case reports `field-invalid:tasks.<i>.taskId`. Repair on a non-plain-object `tasks` under contract "2" (e.g. array) is treated as v1.
