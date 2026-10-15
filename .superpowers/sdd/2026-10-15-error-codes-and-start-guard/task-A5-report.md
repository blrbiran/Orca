# Task A5 report (implementer, Orca session 026d10e3 subagent, 2026-10-15)

Status: DONE. Commit: `a72f3e22d7de511ff7e4bb13bec1c20790fa7790` on `feat/error-codes-start-guard` (parent `373a3ed2`).
Subject: `feat(control): carry a single call's errorCode into its estimate, call record and block reason`.

## What changed (lines as of a72f3e22)

- `src/control/executionDriver.ts:656-664` — `export function normalizeSingleCallErrorCode` (verbatim from the brief), after `singleCallRecordSchema`.
  `:709-711` — `failure` computed in `stepCSingleCall` (`outcome === "complete"` ⇒ null, else normalised code) and passed to `handler.evaluate`;
  `:720` `}, failure);` on `handler.complete`; `:722` usage-unknown block reason `failure === null ? handler.usageUnknownReason : \`${...}:${failure}\``.
- `src/control/singleCallPurposes.ts` — `evaluate?` and `complete` interface signatures gain `failure?: string | null`; `ESTIMATE.complete` takes `failure: string | null = null` and passes it to `completeEstimateInStore` as the 7th argument.
- `src/control/webService.ts` — `completeEstimateInStore` gains `callFailure: string | null = null` (with the brief's comment) after `classify`; `reasonCode` becomes `estimate-call-failed:<code>` only when the classifier answered `estimate-call-failed` and a code is given.
- `src/control/requirementCalls.ts:23-24` — `export const PRE_SPAWN_REFUSALS`; `recordClarify` (`:194`, `:199`, `:203`) and `recordSplit` (`:296`, `:299`, `:302`) gain `failure`, record `callOf(run, "failed", failure)` when non-null, and skip the re-queue for a pre-spawn refusal; `CLARIFY_HANDLER.complete` / `SPLIT_HANDLER.complete` take `failure = null` and pass it on.
- Fixtures (default-preserving, listed for the human): `tests/control/fixtures/estimateHarness.ts` (`SingleCallOptions.errorCode?`, record `errorCode`), `tests/control/fixtures/requirementHarness.ts` (`QueuedAnswer.errorCode?`, record `errorCode`). Absent ⇒ `"single-call-output-invalid"` for a failed call, as before.
- Named rewrites (titles kept, comment added): `tests/control/driverEstimate.test.ts` `:86` → now `:88` (`estimate-usage-unknown:single-call-output-invalid`), `:136` → now `:139` (`estimate-call-failed:single-call-output-invalid`); `tests/control/driverRequirementSplit.test.ts:57` → now `:59` (`calls: [{ outcome: "failed", reason: "single-call-output-invalid" }]`).
  Note: the old `:86` text also occurs at `:71` (the aborted-call test, `errorCode: null`); I located the rewrite by the surrounding `outcome: "failed", tokens: null` harness line, so `:71` is untouched and green.
- New: `tests/control/singleCallErrorCode.test.ts` (verbatim from the brief, 6 tests).

## Commands (PATH starts with node v22.13.1 bin)

| Command | Log | rc | Result |
|---|---|---|---|
| vitest run singleCallErrorCode + driverEstimate + driverRequirementSplit (red) | /private/tmp/oec/logs/a5-red.log | 1 | 9 failed / 16 passed (25). Red: normaliser (`undefined is not a function`), all 5 "where a failed call is stored" tests on their named assertions, driverEstimate `:86`-test and the `a call that failed` row, driverRequirementSplit `:57`-test. `driverEstimate.test.ts:27` green (K3). |
| vitest run the 7 files of Step 5 (green) | /private/tmp/oec/logs/a5-green.log | 0 | 7 files passed, 81 passed (81), 0 skipped |
| npm run typecheck | /private/tmp/oec/logs/a5-typecheck.log | 0 | clean |
| git commit | /private/tmp/oec/logs/a5-commit.log | 0 | a72f3e22, 9 files, worktree clean after |

## Deviations

None in behaviour or values. The only locating judgement is the duplicated `:86` text noted above.

## Concerns

None. Mutations A5a-A5g are left for the reviewer (not run, per contract).
