# Task B5 report — the HTTP route and the web mirror of the plan names

Author: implementer subagent, session `1d7d9aa0` (Opus 5.5), 2026-09-30. Base commit 661273e; result commit 92ef663.
SCRATCH = `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/1d7d9aa0-4a2b-478b-b0ec-d970d3a51afe/scratchpad`.

Status: DONE_WITH_CONCERNS (one departure from the dispatch note; see "Departures").

## What was implemented

- `src/panel/controlApi.ts`: new route entry `POST /api/control/groups/:groupId/tasks/:taskId/loop`, verb
  `set-task-loop`, target `{ kind: "task", groupId, taskId }`, ledger key the group's (right after the
  `set-task-labels` entry). New dispatcher case `case "set-task-loop": service.setTaskLoop(command); break;` after
  `set-task-labels`. `setTaskLoop` is synchronous (webService.ts:572), so there is no `await`, same as `setTaskLabels`.
- `web/src/controlTypes.ts`: appended `WEB_LOOP_PLANS` with the **English** names (R-F5): `Standard`,
  `Bug fix (red first)`, `Safe refactor`, `Design / docs first`, `Investigate only`.
- `tests/panel/taskLoopApi.test.ts` (new): the brief's four criteria, verbatim. `view()` already returns the server
  `GroupViewV1` (tests/panel/fixtures/controlPanel.ts:224), so no cast was needed.

## RED (before implementing)

`./node_modules/.bin/vitest run tests/panel/taskLoopApi.test.ts > $SCRATCH/b5/b5-red.txt 2>&1` → rc=1, 4 of 4 failed:
three route criteria `expected 404 to be 200/422/400` (no route); mirror criterion
`Cannot read properties of undefined (reading 'map')` (`WEB_LOOP_PLANS` not exported). The reasons the brief expects.

## GREEN

- `vitest run tests/panel/taskLoopApi.test.ts tests/panel/taskLabelsApi.test.ts tests/panel/controlApi.test.ts`
  → `$SCRATCH/b5/b5-green.txt`, rc=0, 3 files, 12 passed (4 + 4 + 4).
- `npm run typecheck` → `$SCRATCH/b5/b5-tsc.txt`, rc=0 (only the npm banner lines).
- `(cd web && ../node_modules/.bin/tsc --noEmit -p tsconfig.json)` → `$SCRATCH/b5/b5-web-tsc.txt`, rc=0, 0 bytes.

## Mutations (clone `$SCRATCH/mut-b5`, kept; copy check `$SCRATCH/b5/b5-copy.txt` 0 bytes)

| Name | Edit | Red criterion (taskLoopApi.test.ts) | Evidence | Restore cmp |
|---|---|---|---|---|
| MB5-1 | delete the `/tasks/:taskId/loop` route entry | `changes a loop task over POST …`, `ledgers a refused path shape …` (also `refuses a payload of the wrong shape …`, 404) | `$SCRATCH/b5/b5-MB5-1.txt` rc=1 | rc=0, 0 bytes |
| MB5-2 | delete the `case "set-task-loop"` line | `changes a loop task …`, `ledgers a refused path shape …` (404 route-not-found); shape criterion stays green because the 400 comes from the envelope parse before the switch — as the brief expects | `$SCRATCH/b5/b5-MB5-2.txt` rc=1 | rc=0, 0 bytes |
| MB5-3 | `name: "Safe refactor"` → `name: "Refactor"` | `mirrors every plan's current panel name …` | `$SCRATCH/b5/b5-MB5-3.txt` rc=1 | rc=0, 0 bytes |
| MB5-4 (P3, added) | delete the `investigate` entry from `WEB_LOOP_PLANS` | `mirrors every plan's current panel name …` | `$SCRATCH/b5/b5-MB5-4.txt` rc=1 | rc=0, 0 bytes |

Restore evidence: `$SCRATCH/b5/b5-MB5-{1..4}-restore.txt`, all 0 bytes.

## Files changed

- `src/panel/controlApi.ts` (+10)
- `web/src/controlTypes.ts` (+8)
- `tests/panel/taskLoopApi.test.ts` (new)

## Commits

- 92ef663 feat(panel): serve set-task-loop at POST /tasks/:taskId/loop (trailer checked: `$SCRATCH/b5/b5-msg.txt`, both lines present)

## Departures from the brief

1. `WEB_LOOP_PLANS` names are English per R-F5 (the brief's code block has the Chinese drafts); MB5-3 therefore
   edits `Safe refactor` → `Refactor` instead of `安全重构` → `重构`.
2. **Not done: `web/src/controlApi.ts` wiring** (`ControlAction` member + `controlCommandPath` case for
   `set-task-loop`), which the dispatch note asked for. Reason: the plan's file table (plan l.222) and Task B6's
   Files list (plan l.2990: "Modify `web/src/controlApi.ts` — type import, `ControlAction`, `controlCommandPath`")
   give that edit to B6, and B6's criteria (`web/tests/loopPlanEdit.test.tsx`, which imports `controlCommandPath`)
   are its red check. Doing it in B5 would leave it without a criterion that was seen red here and would make part of
   B6's RED step empty (Rule 9). It is reversible either way; if the controller wants it in B5, it is a two-line add
   (the `ControlAction` member `{ verb: "set-task-loop"; groupId; taskId; expectedRevision; payload: SetTaskLoopPayloadV1 }`
   plus `case "set-task-loop": return \`${group}/tasks/${segment(action.taskId)}/loop\`;`) and B6's brief should then
   drop it.

## Self-review

- The route entry mirrors `set-task-labels` exactly (same target function shape); the ledger key is the group id.
- No existing criterion changed; the neighbouring `taskLabelsApi` and `controlApi` files stay green.
- The mirror criterion compares order and names against `LOOP_PLAN_IDS` + the current registry definition, so both a
  renamed and a missing plan go red (MB5-3, MB5-4).

## Concerns

- Only the web `controlApi.ts` departure above. Nothing else.
