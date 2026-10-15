# Task A8 review (commit 2034af1e, clone /private/tmp/oec/mut/a8)

Spec: PASS. Quality: Approved. Critical 0, Important 0, Minor 2. Mutations 2/2 red.

## Spec compliance
- All 8 sites carry the write; each keeps its control flow and only gains `catch (error)` plus one line (read by hand against the diff):
  - executionDriver stepB: after the exit-2 `blockRun`/`return true` branch, before `status = unknown`. The refusal path writes nothing, which is correct (it is not an unknown).
  - executionDriver stepBPrime: `catch` -> `catch (error)`, then the line, then `status = unknown`.
  - executionDriver saved-result evidence catch: `runId` is in scope (used in the try body); the `savedSourceUnavailable` write is unchanged.
  - driverHandoff `inspectUnderStop` and `deliverAndCollect`: `run.runId`; `status = unknown` and `delivered = false` are unchanged.
  - dispatch `send`: `input.claim.runId`. The inner `catch(error)` in the same block now shadows the new `error`. It is the pre-existing rethrow, its behaviour is unchanged and the shadowing is harmless.
  - dispatch `reconcileStart`: `runId` is a parameter.
  - stopIntent probe: `run.runId`, line `orca-driver: <runId>: ccloop <probeFailureCode>\n`, inserted before the unchanged capability `if`. The code only, as the plan interprets it.
- `peerFailureLogLine` (A1, ccloopPort.ts:111) returns `null` for a non-peer error, so non-peer errors write nothing and nothing throws. The format is `orca-driver: <runId>: ccloop <code|unknown>[: <detail>]\n`, as in §4.9.
- Imports are added in driverHandoff.ts and dispatch.ts. executionDriver.ts extends its existing import. No web/src change.
- Nothing extra. The second `inspect` inside the saved-recovery branch of stepBPrime (settleDeadSavedRecovery path) is not wrapped in a catch, so it has no new line. Control flow there is unchanged.

## Findings
- Minor 1, tests/control/peerFailureLog.test.ts:22: the criterion dedupes the lines through a `Set`, so it pins the text of each line but not "once per occurrence" (the comment at the top claims it). Deleting a duplicate write would stay green. Fix: drop the `Set` and assert the exact sequence, or reword the comment.
- Minor 2, stopIntent.ts:657: `probeFailureCode` is also `control-capability-probe-failed` or the code of a non-peer ControlError (profiles.ts:136-139 `peerCode`). The line then reads `ccloop control-capability-probe-failed`, which names ccloop for a failure that did not come from a peer exit. The plan interpretation records "code only", so this is accepted as is. Optional: write the line only when the code came from a peer.
- Not raised, by ruling R4: the six sites without a criterion.

## Mutations (test tests/control/peerFailureLog.test.ts)
| name | file | red on | restore bytes (diff / cached) |
|---|---|---|---|
| bad-spec self-check | executionDriver.ts | exit 2, .mutate "found 0" | 0 / 0 (checked by hand; the runner exits before writing .restore-bytes) |
| baseline | - | 1 test passed | - |
| A8a stepB silent | src/control/executionDriver.ts | final toEqual, line 22: expected accept line missing, inspect line present | 0 / 0 |
| A8b stepB' silent | src/control/executionDriver.ts | final toEqual, line 22: expected inspect line missing, accept line present | 0 / 0 |

For both, sha-restored equals sha-before and sha-after differs. The earlier assertion (`blockedReason: inspect-unknown`) passes, so the red is on the named assertion and is not a crash.
Extra green run in the clone: peerFailureLog, executionDriver, driverHandoff, dispatch, handoffGuards: 5 files, 67 tests passed, rc=0 (/private/tmp/oec/logs/a8-rev-green.log).
pgrep for fake-ccloop|worker.js|vitest: nothing before or after.

## Cannot verify from diff
- The `typecheck rc=0` claim: not re-run (vitest transpiles without type checking).
