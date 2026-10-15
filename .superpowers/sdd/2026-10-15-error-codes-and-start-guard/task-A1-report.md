# Task A1 report

Status: DONE. Commit 7e6baa08 `feat(control): read ccloop's code and cut detail out of a peer exit`.

Changes
- src/control/ccloopPort.ts:51-59 (old peerErrorCode block) replaced by PEER_DETAIL_MAX, PeerFailure, peerFailure, peerErrorCode (now delegating), peerCode, peerExitText, ccloopFailedMessage, peerFailureLogLine, verbatim from the brief. The file's old block had 1-space indent and `[:detail]` in the comment; located by position (lines 51-59 verified), not by quoted text.
- tests/control/peerFailure.test.ts created verbatim from the brief.

Commands (logs in /private/tmp/oec/logs/)
- red (a1-red.log): rc=1, 7/7 failed, "peerFailure is not a function" / "peerCode is not a function".
- bytes (a1-bytes.log): `0 1` as expected (no NUL bytes, escape text present).
- green (a1-green.log): peerFailure, ccloopPort, agentFreeze, taskResultCollector test files: rc=0, 4 files, 86 tests passed, 0 skipped.
- typecheck (a1-tc.log): rc=0.
- staged diff: only the two paths.

Deviations: none. Mutations A1a-A1d not run (reviewer's).
Concerns: none. Trailer follows the contract (Claude Opus 5.5 (1M context)), not the harness reminder.

## Fix round 1
Added three assertions to tests/control/peerFailure.test.ts (src untouched): final-colon code (`2:agent-version-drift:` -> code agent-version-drift, empty detail), NUL replaced by a space, DEL (\u007f) kept. All use \u escapes; byte check a1f1-bytes.log shows no raw control bytes.
Commands (/private/tmp/oec/logs/): peerFailure.test.ts rc=0, 7/7 passed (a1f1-green.log); typecheck rc=0 (a1f1-tc.log). Commit 9b6391aa.
Mutations (reviewer re-runs): class start \u0001, class widened to \u007f, dropping `|:$` should now be red.
