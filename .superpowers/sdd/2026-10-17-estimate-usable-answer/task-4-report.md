# Task 4 report: instruction v2, per-request schema, feedback tail

Author: implementer (Sonnet 5.5), session 4de777f4, 2026-10-17, on top of 0213d16a.

## Changed
- src/control/estimatePrompt.ts: INSTRUCTION_V2 (own constant), ESTIMATE_INSTRUCTIONS gains "2", EstimatePromptOptions,
  buildEstimatePrompt(version, json, options?) (v2 requires taskIds, else `estimate-task-ids-missing`; retryProblems paragraph for both versions),
  estimateTaskIds(request), estimateResponseSchema(version, taskIds) (v2 keyed schema, own-property definition so `__proto__` ids stay keys).
- src/control/singleCallPurposes.ts: ESTIMATE.prepare passes taskIds + contract.retryProblems, uses estimateResponseSchema.
- src/control/estimator.ts: preflight size count uses the same call as prepare (v2 tail included).
- tests/control/estimatePromptV2.test.ts (new, 8 tests). tests/control/estimatePrompt.test.ts: two uses of "2" as the
  unknown version moved to "3" (Ruling comments; "2" is now known, so these could not stay unchanged).

## Evidence
- v1 pin: sha256 of buildEstimatePrompt("1", '{"x":1}') computed from pre-change code (0213d16a) = 86713fb5...417f0, asserted in the test.
- Mutations (clone under /private/tmp/mut-13nc, node_modules symlinked), all seen red on estimatePromptV2 + estimatePrompt tests:
  M1 v2 schema = v1 schema (3 red), M2 drop task line (2), M3 drop feedback paragraph (2), M4 preflight without ids (2),
  M5 prepare drops retryProblems (1), M6 prepare uses v1 schema (2), M7 tasks.required emptied (3), M8 v1 instruction byte drift (2).
  Restore: clone source files cmp-identical to the worktree; worktree untouched by mutations.
- Tests (redirected to files, read whole): `vitest run tests/control/estimate tests/control/singleCall tests/control/web` = 22 files / 216 tests pass
  (ORCA_CCLOOP_BIN set); 11 files referencing buildBudgetEstimateRequest/ESTIMATE_INSTRUCTIONS/instructionVersion/singleCallHandler = 180 pass; `tsc --noEmit` exit 0.
  Observation commit: 0213d16a plus this working tree. Full `tests/control` was started but vitest did not finish within ~25 min here, so it is NOT claimed.
## Concerns
- Plan said estimatePrompt.test.ts stays unchanged; two assertions used "2" as the unknown version, so they moved to "3" (Ruling comments).
- Task ids come from the plan JSON, which is canonically sorted, so "plan order" = sorted order.

## Fix round 1 (no-json-object wording)
- Change: buildEstimatePrompt appends " Your answer may have been cut off: reply with the JSON object only, and keep each rationale to one sentence." to the feedback paragraph when retryProblems includes `no-json-object` (both versions). Test "adds the cut-off sentence ..." added; the generic feedback test now uses `task-invalid:a:work` instead of `no-json-object`.
- Command: vitest run tests/control/estimatePromptV2.test.ts tests/control/estimatePrompt.test.ts -> 2 files / 14 tests pass.
- Mutation (clone): condition replaced by `false` -> the new test red (1 failed | 8 passed); worktree never mutated.
