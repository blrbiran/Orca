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

## As built (session 86352010, 2026-11-06)

Commits on `fix/dogfood-frictions` (base main a5d892f2): 02855e30 (F14/F15), adcf5681 (F13), 4d20f77c (F20), 76d13efd (F22),
1c1fff57 (F23), 2e685282 (#144(d)); this section is the next commit.

### Reproduced on main first
- F20 and #144(d): the new criteria went red against main's code before the fix (orchestration.test.ts `:266`
  `expected { started: [] } to deeply equal { started: ['g'] }`; estimateLines.test.ts all 3 red, no `estimate:` line).
- F22: the new criterion red on main's message `The command body does not match the closed V1 schema.`
- F14/F15/F13/F23: read in code (bare `new ControlError(code)` with no detail; the fixed stderr line; the fixed hint text),
  and seen live in the run (`boot/notes.md`, `boot/out/confirm-human.txt`).

### Decisions (Rule 1 rung 2, reversible; for the human's review)
1. **F13 is not a refusal.** Agent entry spec §3 (line 57: "the panel still starts and serves the Web UI … The line is the
   loud failure"), C15, and plan risk 1 ("a long default TMPDIR … the socket fails soft") decide it. The ready line is a
   contract (spec D1). Built: the stderr line also says `The orca CLI and MCP cannot reach this panel; only the Web UI is
   served`, and for a too-long path `use a --control-state-dir whose control.sock path is at most 103 bytes` (107 on Linux).
   Refusing to start (or not printing ready) is **for the human**: it overrides a published spec.
2. **F14/F15 keep the refusal** (deliberate: `agentsTablePath` comment, wave-2 review I-1, mirrors ccloop's
   assertAgentsTablePath; `privateDirectory`'s "not user-provided state redirections"). The detail now names the path, the
   reason, and the real path. Three sites: `ccloopPort.ts agentsTablePath`, `paths.ts privateDirectory`, `controlConfig.ts
   checkedPath` (state dir, roots, repositories, plans). `archive.ts`'s own symlink refusals are left as they were.
3. **F20 is fixed, in the slot query only.** §3.1's human words ("没有在跑、也没有能派的任务时 … 不占槽位") and its
   "regained work (… continue, resume-from-handoff …) waits for a slot" both say a held group holds none; the spec's
   mechanical clause (a) "a task in `BUSY_WORK`" counted `held` because BUSY_WORK carries it for the start gate. Evidence
   decides it (Rule 7), so no escalation. `BUSY_WORK` is unchanged; `runningGroupIds` filters `held` out. Published spec not
   edited; this paragraph is the correction record.
4. **F22**: the message lists the first three zod issues as `path: message`, then `and N more`. zod's enum messages
   echo the caller's own value back to that caller; nothing else is added.
5. **F23**: the line and hint follow state. Ready-not-applied = the newest estimate is `ready` for the current planHash
   (`adviceOf`, read with the proposal treated as editable so a confirmed one still names it). Editable proposal ⇒ no
   reopen step; confirm's own lines (read before the confirm they report) and a confirmed proposal ⇒ reopen first.
   `proposal show`'s document has no estimates, so its lines are computed in compose from the group view (the confirm row's
   module-note pattern); every JSON output is unchanged. The D3 spec's literal text "not estimated" no longer prints when a
   ready estimate exists. That is a deliberate departure, recorded here.
6. **#144(d)**: `estimate: <state>` / `reason: <code|none>`. The import result's field is `estimateReasonCode` and the
   estimate result's is `reasonCode` (webProtocol.ts `estimate-created`). The brief named only the first. Each row reads its own.

### Criteria and mutations (clone `scratchpad/mutFR` of 2e685282; restored, `git diff` 0 bytes, `--cached` 0 bytes)
| id | mutation | red at |
|---|---|---|
| M1 | agentsTablePath ControlError without detail | ccloopPort.test.ts:154 |
| M2 | privateDirectory without detail | store.test.ts:63 |
| M3 | checkedPath without detail | controlConfig.test.ts:131 |
| M4 | the old bare stderr line | controlSocket.test.ts:104 |
| M5 | `held` counted again in runningGroupIds | orchestration.test.ts:266 |
| M6 | the old fixed ZodError message | agentSelectionApi.test.ts:119 |
| M7a | editable branch dropped (always reopen) | unestimatedDefault.test.ts:71 |
| M7b | confirm without afterConfirm | unestimatedDefault.test.ts:74 |
| M7c | task line always "not estimated" | unestimatedDefault.test.ts:83 |
| M7d | path always "to estimate" | unestimatedDefault.test.ts:86 |
| M7e | proposal show lines from the estimate-less document | unestimatedDefault.test.ts:83 (proposal show) |
| M8a | import row reads `reasonCode` | estimateLines.test.ts:28 |
| M8b | estimate row reads `estimateReasonCode` | estimateLines.test.ts:40 |
| M8c | appended lines dropped | estimateLines.test.ts:28 |

Rewrite: `tests/commands/unestimatedDefault.test.ts` PATH constant drops its leading "then". Ruling (session 86352010):
「这次批准改写所有必要的判据。」

### Gate (commit 2e685282)
- `npx tsc --noEmit -p tsconfig.json`: exit 0. `npm run gen:cli-docs`: `0 file(s) changed` (help text unchanged).
- `node scripts/test-affected.mjs --base main`: 636 files, 8 failed / 5513 passed / 32 skipped (the skips are the paired
  and real-agent files the script names). Load at the end was 28/38/61. Red files: `flow/startForm` (20 s timeout),
  `control/driverReconcile` ×2 and `driverReconcileN` (ENOTEMPTY rmdir in workspace cleanup), `handoffE2E` H2 (`until`
  timeout) and H5 (`['collected','collected']`, the registered candidate shape), `schedulerBridge` success (30 s,
  registered), `panel/chainsApi` C1 (500). Each was run alone on the branch and then in a fresh `git clone --local` of main
  a5d892f2, alternately: all green on both sides (load 13–69). Classified as load, not this branch.
- `skills/orca-control/SKILL.md` and its references do not quote any changed text; no change needed.

### Open items (for the human)
- F13: should a foreground panel refuse to start (or hold back its ready line) when the control socket cannot be bound?
  That needs agent-entry spec §3 changed.
