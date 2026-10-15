# Task A6 report — a human group retry recomputes the requirement's output bound

Implementer: subagent of Orca session 026d10e3, 2026-10-15. Branch feat/error-codes-start-guard, on top of a72f3e22.
Commit: f84aee56 `feat(control): recompute a requirement's output bound on a human group retry`.

## Status
DONE

## What changed (line numbers measured at f84aee56)
- `src/control/stopIntent.ts:440` `applyRecoveryRetry(..., outputBound: number | null = null)`; `:455` passes it to `retryGroup`;
  `:509`/`:514` `retryGroup` takes and forwards it; `:525` `retryRequirementInTransaction(..., outputBound)`;
  `:557-559` comment + `if (requeue && outputBound !== null) group.requirement.maxOutputTokens = outputBound;` before the
  existing re-queue line (verbatim from the brief).
- `src/control/webService.ts`: imports — `describeError` added to the `./executionDriver.js` import (line 2, not line 1 as
  the brief said; line 1 is `./ccloopPort.js`), `singleCallOutputBound` to `./estimator.js` (line 14),
  `type ExecutionProfileRouter` to the existing `./profiles.js` import (line 20; it was not in scope), and
  `hasRequirementBlock, latestDraft, latestRound, readRequirementGroup` to `./requirementRecords.js` (line 54).
  `recoveryRetry` (`:580-584`) now preflights the replay, computes the bound for a group target, and passes it;
  new `private async retryOutputBound` (`:585-606`) verbatim from the brief (probes `agentSlot.selection`, K5).
- `tests/control/fixtures/requirementHarness.ts`: `import type { AgentResolution, PartialSelection }` (`:6`),
  `resolveOverride` (`:44`), port `resolveAgent` closure (`:46`), return adds `baseResolveAgent`/`setResolveAgent` (`:83`).
  Default-preserving (override null by default).
- `tests/control/requirementRetryBound.test.ts` (new): the two criteria verbatim from the brief.

## Commands (PATH starts with /Users/biran/.nvm/versions/node/v22.13.1/bin)
- Red: `./node_modules/.bin/vitest run tests/control/requirementRetryBound.test.ts` > `/private/tmp/oec/logs/a6-red.log`:
  rc=1, 2 failed / 2. Test 1 red at `maxOutputTokens` (expected 100000, received 64000, line 20); test 2 red at the log
  line (`[]` received, line 36) — its first two assertions passed, as the brief predicted.
- Green 1: the named files plus extra requirement/recovery files (see deviations) > `a6-green.log`: rc=1, 156 passed,
  1 failed — `tests/control/driverRecovery.test.ts` › "drives a retried run on from where it was blocked, to settled"
  timed out at 5005ms (5000ms limit) under 9 parallel files.
- `driverRecovery.test.ts` alone > `a6-driverRecovery-alone.log`: rc=0, 8/8 passed.
- Green 2 (same 9 files re-run) > `a6-green2.log`: rc=0, 9 files, 157 passed, 0 failed, 0 skipped.
- `npm run typecheck` > `a6-typecheck.log`: rc=0.

## Deviations
- `tests/control/requirementRecovery.test.ts` does not exist; dropped as the brief allows. In its place I added the other
  existing files that exercise recovery-retry on requirements or the retry path: `requirementCommands.test.ts`,
  `requirementExport.test.ts`, `driverRecovery.test.ts`, `retryTask.test.ts`.
- Import anchor for `describeError`: line 2 (`executionDriver.js`), not line 1.

## Concerns
- One timeout of `driverRecovery.test.ts` "drives a retried run on..." (5005ms vs 5000ms) under parallel load in the first
  green run; green alone and in the identical re-run. That test uses a non-requirement group, where `retryOutputBound`
  returns null after one SELECT, so I read it as load flake, not this change — flagged for Task G's full gate.
- Mutations A6a-A6c not run (reviewer's job).

## Fix round 1 (review I1; same implementer subagent, 2026-10-15)
- New criterion in `tests/control/requirementRetryBound.test.ts` ("when the requirement's profile no longer resolves …"):
  after round 1 fails, the stored group body's `requirement.profile.profileHash` is rewritten to `"0".repeat(64)` via
  `x.store.db`, so `profileRouter.resolve` throws `ControlError("profile-changed")` (no detail), and `describeError` gives
  `profile-changed`. Asserts the retry answers `{ kind: "recovery-observed", resolved: true }`,
  `[maxOutputTokens, round(1).state]` = `[64_000, "drafting"]`, and the filtered stderr lines =
  `["orca-control: recovery-retry r: output bound kept at 64000: profile-changed\n"]`. Test-only; no source change.
- `./node_modules/.bin/vitest run tests/control/requirementRetryBound.test.ts` > `/private/tmp/oec/logs/a6-fix1-green.log`:
  rc=0, 3 passed / 3, 0 skipped. `npm run typecheck` > `a6-fix1-typecheck.log`: rc=0.
- Commit: see `git log` — `test(control): pin the retry fallback when the requirement's profile no longer resolves`.
- Mutation A6d not run by me (reviewer's job); it is expected red on the new test's log-line/result assertion.
