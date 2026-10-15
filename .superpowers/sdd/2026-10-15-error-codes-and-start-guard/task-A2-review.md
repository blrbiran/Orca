# Task A2 review (commit b76fe1f3, clone /private/tmp/oec/mut/a2, web built rc=0)

## Spec: PASS
- sendMappedControlError: peerFailure branch -> 424 `ccloop-failed`, message from ccloopFailedMessage (forms `ccloop-failed:<code|unknown>[: detail]` pinned by literals), retryable true; ControlHttpStatus +424; panel-only catalog `"ccloop-failed": 424`. Peer timeout and plain Error stay 500 (pinned).
- K2: webService.applyAgentUpdate rethrows a peer exit that left the outbox row pending as a plain Error -> 500 control-internal-error; test asserts 500 and `state: pending` (literal).
- en/zh error-table entries added; named rewrite of agentSelectionApi.test.ts:258-263 with the explanatory comment; 2 appended rows; web pin test added.
- Web treats 424 as answered (pin test, green by design, red under A2c).
- Nothing extra. Trailer naming Sonnet 5.5: controller ruling, not a finding.

## Findings
- Critical: 0
- Important: 1
  - I1 (missing criterion): the `&& hasPendingAgentUpdate(this.store, command.actorId)` half of the K2 condition in src/control/webService.ts (the applyAgentUpdate catch) is not pinned. Mutation A2e (drop that conjunct, so every peer exit becomes the plain Error) stays green (2 passed). The only test reaches the catch with a row pending. Fix: add a criterion where the peer exit happens with no pending row (e.g. port throws on the preview/before-reserve path, or the row is settled) and expect 424; or document the branch as unreachable and drop the conjunct.
- Minor: 0 (observations only: the K2 test calls `mapped(failure)` rather than going through the route, so the route wiring of the plain Error is assumed from sendMappedControlError's fallthrough; acceptable.)

## Mutations (all named assertion, not crash/load error)
Baseline: root 3 files 21 passed, web 1 passed, rc=0, 0 skipped. Runner self-check with bad spec: .mutate "found 0", restore-bytes 0/0.
| name | file | red on | restore bytes (diff/cached) |
|---|---|---|---|
| A2a | src/panel/controlErrors.ts (ccloopFailedMapping) | "maps a peer exit to 424..." expected {status:500} to deeply equal {status:424} | 0/0 |
| A2a2 | same (agentSelectionApi) | rewritten "previews a slot whose installation fails transiently..." and both "answers a confirm whose ccloop..." rows: expected 500 to be 424 | 0/0 |
| A2b | src/control/webService.ts | "keeps an apply-agent-update...": expected 424 to be 500 | 0/0 |
| A2c | web/src/controlApi.ts | "is an answered refusal, not an uncertain outcome": got kind refusal instead of answered | 0/0 |
| A2d | web/src/locales/zh.ts | refusalCoverage "has a zh entry for every catalog code..." (['ccloop-failed']) and "keeps the two tables over the same codes" | 0/0 |
| A2e (extra) | src/control/webService.ts, drop the hasPendingAgentUpdate conjunct | STAYS GREEN (2 passed) -> I1 | 0/0 |
Hashes: after != before and restored == before for every run.

## Processes
pgrep before: 9 vitest processes (pids 13650-13662, another session). After: 9 vitest processes with different pids (34856-34871), i.e. another session's run; none started by me remain. No fake-ccloop/worker.js. Not killed.

## Cannot verify from diff
- That the route handler for apply-agent-update passes thrown errors to sendMappedControlError (test emulates it).
