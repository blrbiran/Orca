# Task 8 report: MCP bridge (orca mcp serve)

Commits: 25670c7 (feature, dependency, USAGE, usage test), 05a1e70 (extra malformed-payload test case).

## Implementation
- src/entry/mcp.ts per brief (low-level Server, JSON Schema inputs, tools orca_read/orca_send, client header mcp[:name], commandId prefix mcp-). stdout carries only protocol frames; usage error goes to stderr.
- src/cli.ts: dispatch block for `mcp` and the USAGE entry only. tests/panel/usage.test.ts extended (asserts "orca mcp serve" and "orca_read and orca_send").
- Round-trip test uses boot(w, [], { port: true }) and imports from tests/panel/fixtures/socketPanel.ts.

## Dependency
- @modelcontextprotocol/sdk 1.32.1 (npm ls), added 24 packages. npm audit reports 8 vulnerabilities (not examined; not caused by this task's source).
- zod: before 3.25.76 (root, ccloop deduped); after 3.25.76 (root; sdk and zod-to-json-schema deduped). Unchanged. Files in scratchpad n2: t8zod-before.txt, t8zod-after.txt, t8npm.txt.

## Tests (observed commit 05a1e70)
- `vitest run tests/entry tests/panel/usage.test.ts`: 7 files, 24 tests pass (t8green2.txt). `tsc --noEmit` rc=0 (t8tsc2.txt).
- TDD RED (t8red.txt): before implementation `orca mcp serve` printed usage and exited, all 3 mcp tests failed with "MCP error -32000: Connection closed". GREEN: t8green.txt.

## Mutations (clone scratchpad/n2/mut-t8; web/dist and node_modules symlinked; baseline green in clone)
| # | Change | Result | Restore |
|---|---|---|---|
| a | isError always false | RED: "expected false to be true" (refusal assertion; also C14 test) | git diff 0 bytes |
| b | drop commandIdPrefix "mcp" | RED: toMatchObject commandId ^mcp- | 0 bytes |
| c | drop `typeof expectedRevision !== "number"` check | NOT red: equivalent mutant, controlSend's isSafeInteger check yields the same code control-cli-argument-invalid | 0 bytes |
| c2 | drop `typeof payload !== "object"` check (after adding a payload:"nope" case to the malformed-args test) | RED: got panel-not-running instead of control-cli-argument-invalid | 0 bytes |

Mutation c showed the brief's malformed test (expectedRevision:"zero") cannot see the bridge's own check because operations.ts re-validates; I added the payload:"nope" case (commit 05a1e70) so a bridge-level check is observed. The bridge's expectedRevision type check is defence in depth, not independently tested.

## Files
package.json, package-lock.json, src/entry/mcp.ts, src/cli.ts, tests/entry/mcp.test.ts, tests/panel/usage.test.ts.

## Concerns
- Mutation c equivalent mutant (above).
- Commit trailer uses "Claude Sonnet 5.5" per the system attribution reminder, not common.md's Opus line.
- Mutation clone needed a web/dist symlink for the panel fixture.
- Not covered: routes/fields other than the brief's; a stdin-EOF shutdown is exercised only implicitly by client.close().
