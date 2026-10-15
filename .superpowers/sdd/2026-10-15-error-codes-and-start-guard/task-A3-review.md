# Task A3 review (reviewer, clone /private/tmp/oec/mut/a3 @ 969017f1)

## Spec
Spec: PASS. All six source sites follow the brief and the binding constraints.
- Classification stays on `error.code` (agentFreeze.ts transient check and controlViews.ts rolePreview). Only the stored `code` becomes `peerCode(error)`.
- A non-ControlError in `recoverAgentUpdates` / `observeAgentUpdates` now yields `control-internal-error`, not a false `control-peer-exit`.
- Types widen from `KnownControlErrorCode` to `string`: `ObservedProfile.probeFailureCode`, `EstimatorSlotOutcome` rejected `code`, `rejectedEstimatorRequest(code: string)`, `probeFailureCode(): string`.
- savedResultRecovery.ts uses `peerCode`. webService.ts imports `peerCode` beside `peerFailure`.
- The tests are the brief's tests verbatim. Nothing extra in the diff.
- Commit trailer: controller ruling, not a finding.
- `peerCode` returns `error.code` for any non-`control-peer-exit` ControlError, so every other code is unchanged.

## Findings
Critical 0. Important 1. Minor 0.

- Important: the non-ControlError branch of `recoverAgentUpdates` is not pinned (`src/control/webService.ts:676`). F3 covers the `control-internal-error` fallback only for `observeAgentUpdates`, via mutation A3f. The matching fallback in `recoverAgentUpdates` is a second, separate site that changed from `control-peer-exit` to `control-internal-error`.
  - Mutation A3i (that fallback back to `"control-peer-exit"`) stays green, 3 of 3 tests passed. This is a missing criterion.
  - Fix, test only: in F3, make `applyAgentInstallations` throw a plain `Error("boom")` with a pending operation, call `recoverAgentUpdates()`, and expect `failureCode` to be `control-internal-error`. The test must also make `observeAgentInstallations` succeed, so the reconcile failure is what gets stored.
  - Owning task is A3. The reviewer does not edit the worktree.

## Mutations (clone a3; baseline green, 2 files, 6 tests, rc=0, log /private/tmp/oec/logs/a3-base.log)

Runner self-check with a bad spec: `.mutate` says "found 0" and the file is unchanged. The existing mut.sh does not abort after a failed mutate. It still ran the tests and wrote 0-byte diffs, which is harmless but noted.

| Mutation | File | Red on | Restore bytes (diff / cached) |
|---|---|---|---|
| A3a probe stores `error.code` | profiles.ts | F1, `probeFailureCode` `toBe` (test line 25): got `control-peer-exit` | 0 / 0 |
| A3b preview slot `error.code` | agentFreeze.ts | F2 slots `toEqual` (line 39) | 0 / 0 |
| A3c classify on `peerCode` | agentFreeze.ts | F2 slots `toEqual` (line 39): the `reconcile` slot becomes `rejected` | 0 / 0 |
| A3d rolePreview `error.code` | controlViews.ts | F2 `rolePreviews` `toEqual` (line 44) | 0 / 0 |
| A3e observation `error.code` | webService.ts | F3 first `failureCode` (line 55) | 0 / 0 |
| A3f non-ControlError becomes `control-peer-exit` (observation) | webService.ts | F3 second `failureCode` (line 58) | 0 / 0 |
| A3g reconcile `error.code` | webService.ts | F3 last `failureCode` (line 64) | 0 / 0 |
| A3h saved result `error.code` | savedResultRecovery.ts | the new `it` (`-t`), `toEqual` (line 167) | 0 / 0 |
| A3i (extra) reconcile non-ControlError becomes `control-peer-exit` | webService.ts | GREEN, missing criterion (Important above) | 0 / 0 |

Brief mutations: 8 of 8 red, each on its named assertion and not a crash. With A3i, 8 of 9 red.
For every mutation the sha-before equals sha-restored, and `.mutate` shows the replacement applied once. A3h's "2 skipped" comes from the `-t` filter.

## Cannot verify from diff
- The typecheck and the 9-file green run are the implementer's claims. I ran only the two A3 test files, plus the mutation runs.

## Process check
`pgrep -fl "fake-ccloop|worker.js|vitest"` found no processes before or after the mutations.

## Re-review 1 (de176903, clone /private/tmp/oec/mut/a3r1)
ADDRESSED. Test-only commit adding F4. Baseline: 4 of 4 green, rc=0.
- A3i rerun (recoverAgentUpdates fallback back to `"control-peer-exit"`): red on F4 `toBe("control-internal-error")` (test line 75), got `control-peer-exit`. Restore bytes 0/0, sha restored.
- New breakage: none. The diff is 11 added test lines, no source change. F1-F3 still pass.
