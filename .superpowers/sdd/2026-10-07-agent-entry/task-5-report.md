# Task 5 report: client library (src/entry/)

Status: DONE. Commit 8efb01a "feat(entry): discover the panel socket and speak to it with one response envelope" (explicit paths: src/entry/*.ts x4, tests/entry/*.test.ts x2).

## Implementation
Brief code used verbatim: envelope.ts, discovery.ts, socketClient.ts, operations.ts. No config change: vitest include is `tests/**/*.test.ts`, so tests/entry is picked up.
Test deviation (as instructed): in the bad-argument test the three controlSend refusals are collected, their codes asserted together, and `expect(out.commandId).toBeDefined()` added for each (spec §4.4).
Extra local code kept from the brief: `control-cli-response-invalid`. Full local codes in this lib: control-projects-file-invalid, control-socket-path-too-long, control-socket-timeout, panel-not-running, control-cli-response-invalid, control-cli-path-invalid, control-cli-binary-route, control-cli-argument-invalid.

## TDD evidence (scratch: $SCRATCH = .../scratchpad/n2)
- RED: impl files moved aside, `npx vitest run tests/entry` -> rc=1, both files "Failed to load url ../../src/entry/envelope.js" (t5-red.txt).
- GREEN: `npx vitest run tests/entry` -> rc=0, 2 files, 8 tests passed (t5-green.txt). `npx tsc --noEmit` rc=0.

## Mutations (clone $SCRATCH/mut-t5, node_modules symlinked; outputs m5-{a..e}.txt)
| # | change | red test | restore |
|---|---|---|---|
| a | discovery: projects file path replaced by nonexistent path | discovery: "prefers the flag..." and C20 | git diff bytes 0 |
| b | discovery: removed the `invalid` throw line | C20 | 0 |
| c | controlSend catch: `localError(error)` without commandId | "refuses bad paths..." (new commandId assertion) | 0 |
| d | exitCodeFor returns 0 always | C8 | 0 |
| e | ENOENT/ECONNREFUSED mapped to retryable=false | C14-lib | 0 |

## Concerns
- None blocking. Mutation (c) is only caught by the added assertion, as intended.
- Full-suite run not performed (only tests/entry + tsc).
