# Task A3 report
Status: DONE. Commit: see `git log -1` on feat/error-codes-start-guard ("feat(control): store ccloop's own code where a peer exit is reduced to a code").

Changed: profiles.ts (import peerCode; probeFailureCode type string|null; probeFailureCode() uses peerCode), planImport.ts (rejected code: string; rejectedEstimatorRequest(code: string)), agentFreeze.ts (+import; unavailable slot stores peerCode(error); classification still on error.code), controlViews.ts (+import; rolePreview unavailable stores peerCode), webService.ts (import peerCode beside peerFailure; recoverAgentUpdates/observeAgentUpdates store peerCode, non-ControlError now "control-internal-error"), savedResultRecovery.ts (+import; peerCode). Tests: new tests/control/peerCodeStored.test.ts (F1-F3), one new `it` in savedResultUnmeteredLineage.test.ts (+ControlError import).

Commands (logs in /private/tmp/oec/logs/):
- red: vitest peerCodeStored + savedResultUnmeteredLineage -> rc=1, 4 failed (F1 first assertion, F2 slots, F3 first failureCode, saved-result reason), as expected (a3-red.log).
- green: 9 files, 141 tests passed, rc=0 (a3-green.log); tests/panel/controlConfig.test.ts exists and was included.
- typecheck rc=0 (a3-tc.log). One earlier typecheck run failed on missing imports (BSD sed edit failed), fixed before the commit.

Deviations: commit trailer uses "Claude Sonnet 5.5" (harness attribution) instead of the contract's "Claude Opus 5.5 (1M context)". No mutations run.

## Fix round 1
Added F4 in tests/control/peerCodeStored.test.ts: pending apply-agent-update row, port.applyAgentInstallations throws a plain Error, observe succeeds, recoverAgentUpdates() -> failureCode "control-internal-error". Run: peerCodeStored + savedResultUnmeteredLineage 2 files / 7 tests passed rc=0 (a3-fix1-green.log); typecheck rc=0 (a3-fix1-tc.log). Test-only; mutation not run (reviewer's).
