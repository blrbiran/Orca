# Task 4 report: socket gate and attribution (commit c6f6a87)

## Implementation
- src/panel/controlSocket.ts: first middleware (before express.json, all verbs incl. GET) refuses a missing/invalid x-orca-client with 400 control-client-invalid; stores res.locals.orcaClient.
- src/panel/controlApi.ts: removed `void channel`; on channel "socket" the handler calls humanOnlyRefusal(route.verb, req.body.payload) first -> 403; the verb switch runs inside withCommandClient(commandId, client) with client = "web" on the web channel, else the header value.
- tests/panel/controlSocketGate.test.ts: C11 (x2: header variants + before-body), C9, C10, C12. Imports workspace/boot/overSocket/useSocketPanels from the shared fixture (ruling P2).

## Test deviations from the brief
- DB file is control.sqlite (store.ts:79). node:sqlite loaded via createRequire (a dynamic import("node:sqlite") fails under vite: "Failed to load url sqlite").
- C12: set-workspace-mode returned 404 (control-target-not-allowed) on an unconfigured panel (repository unknown without an execution port). The test configures the port like controlAssemblyDriver.test.ts (fake-ccloop-control.mjs copy, agents.json), via Object.assign on w.env before boot; nothing is spawned.
- C10 "without the field" payloads: requirement-open with groupId/repoId/idea (valid schema), proposal-edit with baseProposalVersion/operations; only assertion is that the code is not control-field-human-only.
- Existing test changed (concern): tests/panel/controlSocket.test.ts C16 sent a raw HTTP request with no x-orca-client; it is now refused early (400, closed at once), so the "close waits for in-flight request" assertion failed. Added `x-orca-client: cli` to that raw request (one line). Needed for the suite to stay green; Task 3 owner may want to know.

## TDD
- RED: `npx vitest run tests/panel/controlSocketGate.test.ts` before implementation -> 5 failed (rc=1) ($SCRATCH/t4red.txt).
- GREEN: same command after -> 5 passed (rc=0) ($SCRATCH/t4g.txt).
- Full: `npx vitest run tests/panel tests/control/web*.test.ts` -> 61 files passed, 496 passed, 3 skipped, rc=0 ($SCRATCH/t4.txt, read whole via tail summary; first run had the C16 failure described above). `npm run typecheck` rc=0.

## Mutations (clone $SCRATCH/mut-t4, web/dist copied in; baseline in the clone green rc=0)
| mut | change | red |
|---|---|---|
| a | header middleware refusal deleted | C11 (both tests) |
| b | socket gate block disabled (`if (false)`) | C9, C10 |
| c | client always "web" | C12 |
| d | withCommandClient wrapper removed (switch called directly) | C12 |
Each restored with `git checkout -- .`; `git diff | wc -c` = 0 after every one. Main worktree never mutated.

## Concerns
- The C16 test edit above. 3 skipped tests in the suite are pre-existing (not examined).
- C12 relies on the fake ccloop fixture for a configured port.
