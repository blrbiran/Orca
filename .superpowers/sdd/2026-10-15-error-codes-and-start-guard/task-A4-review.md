# Task A4 review (commit 373a3ed2, clone /private/tmp/oec/mut/a4, HEAD 373a3ed2)

## Spec: PASS
- describeError: a peer exit (via peerFailure) is stored as `control-peer-exit:<peerExitText>`, bare `control-peer-exit` when the text is empty; other ControlErrors/Errors unchanged (executionDriver.ts:125-131).
- accept-refused: `accept-refused:${peerExitText(peerFailure(error)!)}`. The `!` is safe: the guard is `code === "control-peer-exit"`, which is exactly peerFailure's non-null condition. With no detail after `2:` the reason is `accept-refused:2`, a harmless trim from `accept-refused:2:`.
- `accept-refused:2:control-config-hash-mismatch` (executionDriver.test.ts:134) unchanged by construction (code, empty detail -> `2:code`); the implementer's green run covers it.
- Only the two listed files touched; test is the brief's verbatim text. Other describeError sites (blockRun at :1012/:1014, cleanupError, publishError) now store the cut form too, which is what §4.4 intends.

## Findings
Critical 0, Important 0, Minor 0.
Note (not a finding): the test's non-peer branch (`control-peer-timeout`) pins the non-peer path unchanged.

## Mutations (baseline: peerReasonCut 2/2 green in clone; runner self-check with bad spec: exit 2, "found 0", restore bytes 0/0)
| name | file | red on | restore bytes (diff / cached) |
|---|---|---|---|
| A4a | src/control/executionDriver.ts | "describeError stores the cut form" (toEqual at peerReasonCut.test.ts:17; whole 2048-x stderr received, no `…`); other test green | 0 / 0 |
| A4b | src/control/executionDriver.ts | "an accept refusal with a 2 KiB stderr..." (toMatchObject at :27; blockedReason holds the whole y-run); other test green | 0 / 0 |
sha-before == sha-restored for both; .mutate says applied 1.

pgrep -fl "fake-ccloop|worker.js|vitest": empty before and after.

## Cannot verify from diff
- executionDriver.test.ts, driverHandoff, skillsE2E green: taken from the implementer's report (not re-run). 4 skillsE2E real-ccloop tests skipped (ORCA_CCLOOP_BIN unset), as the implementer disclosed.
