# Dogfood frictions F13-F23 and #144(d) (session 86352010, branch `fix/dogfood-frictions`)

Who: Claude Code subagent (Opus 5.5), session 86352010, 2026-11-06, base `main` a5d892f2.
Source: the self-bootstrap acceptance run 3 write-up (session scratchpad `boot/RESULT.md`, "Frictions"). Each item is
reproduced against main first; one commit per item; every new branch has a criterion seen red on its named mutation
(mutations in a `git clone --local` copy only).

## Tasks

| # | friction | decision | files | criterion → mutation |
|---|---|---|---|---|
| 1 | F14/F15: agents table / control dir behind a symlink refused with a bare code | keep the refusal (deliberate: ccloopPort.ts `agentsTablePath` comment, wave-2 review I-1; paths.ts `privateDirectory`); the detail names the path, the reason and the real path to pass | `src/control/ccloopPort.ts`, `src/control/paths.ts`, `src/panel/controlConfig.ts` | ccloopPort.test.ts / store.test.ts / controlConfig.test.ts: message names the link and the real path → drop the detail |
| 2 | F13: socket path too long, panel says ready with no socket | **not** made a refusal: agent-entry spec §3 (line 57) and C15 decide the foreground panel starts without the socket, the service exits 78. Built instead: the stderr line names the consequence and the fix | `src/panel/server.ts`, `src/panel/controlSocketPath.ts` | controlSocket.test.ts C15: the line names "cannot reach" and the byte limit → restore the old line |
| 3 | F20: a group whose task is `held` after a handoff holds a slot | D1 (§3.1 human words, and "regained work ... continue, resume-from-handoff ... waits for a slot") says a group waiting for a person holds none; `held` is in `BUSY_WORK` (the start gate's set), so slot clause (a) counted it. `runningGroupIds` leaves `held` out; `BUSY_WORK` itself unchanged | `src/control/orchestration.ts` | orchestration.test.ts: a ready group whose only task is held after a handoff stop does not stop another's auto-start → count held again |
| 4 | F22: a wrongly shaped command body names no field | the 400's message lists each zod issue's path and message | `src/panel/controlApi.ts` | agentSelectionApi.test.ts: `estimator: "codex"` answers a message naming `payload.preferences.estimator` → the old message |
| 5 | F23: confirm/show say "not estimated" with a ready estimate, and "reopen" on an editable proposal | the line and the hint follow the state: ready-not-applied names the estimate and points at `apply-estimate`; reopen only for a confirmed proposal | `src/commands/domains/verbs.ts`, `src/commands/domains/work.ts` | unestimatedDefault.test.ts: per state → each branch dropped |
| 6 | #144(d)/#140: import/estimate human output loses the estimate state and reason behind the 160-char cut | both rows print `estimate: <state>` and `reason: <code>` on their own lines; JSON unchanged. The import result names it `estimateReasonCode`, the estimate result `reasonCode` | `src/commands/domains/work.ts` | tests/commands/estimateLines.test.ts → read the wrong field / drop the lines |

Gate: `npx tsc --noEmit -p tsconfig.json`, `npm run gen:cli-docs` (idempotent), `node scripts/test-affected.mjs --base main`.
