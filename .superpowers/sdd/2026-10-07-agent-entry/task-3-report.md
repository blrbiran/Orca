# Task 3 report: control socket (bind, serve, close)

Status: DONE. Commit 7279483 `feat(panel): serve the control routes on an owner-only unix socket` (observed with `git log --oneline -1`).

## Implementation
- src/panel/controlApi.ts: `ControlChannel` type; `channel` param (default "web") on registerControlReadRoutes and registerControlMutationRoutes (the latter does `void channel;` for now, Task 4 uses it).
- src/panel/controlSocket.ts: verbatim from brief.
- src/panel/server.ts: `StartedPanel.socketPath`; bind block sits after runControlPanelStartup and BEFORE the pump is armed (per brief); stderr line on failure; socket closed in `closed` handler, onSignal finally, and close(). Deps object has the same fields as the buildApi `control` dep.
- src/cli.ts: stderr "orca-panel: control socket <path>" after the browser line; stdout unchanged.
- tests/panel/fixtures/socketPanel.ts (ruling P2): exports `workspace`, `boot`, `overSocket`, `useSocketPanels()` (installs afterEach cleanup: restoreAllMocks, close tracked panels, rm temp roots), `cleanupSocketPanels`, `trackSocketPanel`, `untrackSocketPanel`.
- tests/panel/controlSocket.test.ts: C1, C2 (stale), C2 (regular file), C3, C4, C5, C15 = 7 tests.

## Decisions
- C2 stale socket: used the SIGKILL child approach (not the `_handle` trick), as a real crash leaves it.
- C4: createPanelServer with a store held by another in-process panel assembles control=null and prints "another process holds this repository's control store"; test asserts that line, second.socketPath null, first's socket still answers, and still answers after the loser closes.

## TDD evidence (scratch: /private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/6cc0c1e9-7313-4a5e-942a-f02129bf4027/scratchpad/n2)
- RED: `npx vitest run tests/panel/controlSocket.test.ts` before controlSocket.ts existed: rc=1, "no tests" (import failure) -> t3red.txt.
- GREEN: same command after implementation: rc=0, 7 passed -> t3green.txt.
- `npx vitest run tests/panel tests/control/web` -> t3panel.txt: rc=0, 60 files, 490 passed | 3 skipped (the 3 skips are the pre-existing webCcloopSmoke skips). No regression. `npx tsc --noEmit -p .` rc=0.
- `npm run verify:panel` -> t3verify.txt: rc=0, all PASS lines (ready line unchanged).

## Mutations (clone mut-t3 under scratch; web/dist and node_modules symlinked; first attempt without web/dist gave invalid all-red, discarded)
Base in clone: 7 passed. After each: `git checkout -- .`, `git diff | wc -c` = 0 and `git diff --cached | wc -c` = 0.
| mut | change | red |
|---|---|---|
| a | delete `if (existing === true) unlinkSync(path);` | C2 stale-socket test red |
| b | delete `chmodSync(path, 0o600);` | C1 red (umask yields non-0600) |
| c | delete only the unlink in close() | SURVIVES (7 pass): server.close() on a unix socket makes libuv unlink the file itself, so the explicit unlink is defense-in-depth, an equivalent mutant |
| c2 | delete server.close(), closeIdleConnections and the unlink in close() | C3 red (and stale C2 red, since the file is left) |
| d | bind unconditionally with `control!` | C4 red |
| e | delete `existing === false` refusal | C2 regular-file test red |

## Files
src/cli.ts, src/panel/controlApi.ts, src/panel/controlSocket.ts, src/panel/server.ts, tests/panel/controlSocket.test.ts, tests/panel/fixtures/socketPanel.ts.

## Concerns
- Mutant c is equivalent (see above); the explicit unlink in close() is not separately pinned by a test. Kept as the brief specifies.
- Bound before the pump is armed, so a slow bind delays pump start slightly; negligible.
- In-process panels share SIGINT/SIGTERM handlers as before; nothing new.

## Fix round 1 (commit 944f502)
Changes: ControlSocketHandle.close() now returns an idempotent Promise resolved on the socket server's 'close' event (unlink after it, guarded with try/catch); server.ts runs control.close() only after BOTH the TCP and socket servers closed (closed handler), the returned close() resolves after `closed`, signal path initiates both; bindControlSocket's lstat/unlink now inside the try (fails soft as control-socket-listen-failed); safety comment at the unlink; C15 also fetches /api/control/config over TCP (200). New C16: a POST held half-open on the socket while panel.close() is called: close stays pending, the request then completes with a 2xx-4xx answer, close resolves.
Evidence (scratch n2): f1.txt controlSocket 8/8 pass; f1all.txt `npx vitest run tests/panel tests/control/web` rc=0, 60 files, 491 passed | 3 skipped; tsc rc=0.
Mutation (clone mut-f1): control.close() immediately and close() not awaiting `closed` -> C16 red (f1mut.txt, 7 pass/1 fail); restored, git diff 0 bytes.
