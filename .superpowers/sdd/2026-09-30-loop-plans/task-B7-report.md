# Task B7 report: a loop task changed after confirmation, run through the real ccloop build (spec §6 criterion 10)

Implementer session 1d7d9aa0 (B7 subagent), 2026-09-30. Base commit d49c7af. Commit **4117725**.
SCRATCH = `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/1d7d9aa0-4a2b-478b-b0ec-d970d3a51afe/scratchpad`. All evidence files are under `SCRATCH/b7/`.

## Status: DONE_WITH_CONCERNS (one departure from the brief, see below)

## What was implemented
- `tests/control/fixtures/ccloopWorld.ts` (additive): `Task` gains `loop?: Record<string, unknown>` with the brief's comment. The interface moved from one line to four so the comment could sit on the field. The `for (const task of tasks)` loop now starts with the brief's `if (task.loop !== undefined) { planTasks.push({... loop ...}); continue; }` block.
- `tests/control/loopPlanE2E.test.ts`: the brief's file, with two changes:
  1. **P4**: the change raises `work.tokens + 500_000`, with a comment explaining why.
  2. **Departure**: `loopFor` builds `targetPaths: [path, "answer.txt"]` instead of `[path]`. Details are in the Departures section.
- The file is gated at run time with `beforeEach((ctx) => { if (!realBinary) ctx.skip(); })`. It never uses `describe.skipIf`.

## Environment (Rule 17)
- `ORCA_CCLOOP_BIN=SCRATCH/gate-partA/cc/dist/cli.js`, `ORCA_AGENTS_TABLE=SCRATCH/agents/agents.json`.
- HOME and the four XDG roots pointed at a fresh `mktemp -d /private/tmp/cl-h-XXXX`, and each run got `TMPDIR=$(mktemp -d /private/tmp/cl-XXXX)`. The list is in `b7/env.txt`.
- `~/.orca` was unchanged: `stat -f '%m %z'` returned `1790516258 128` before and after (`b7/orca-stat-before.txt`, `b7/orca-stat-after.txt`).
- The criterion's world writes its own agents table (fake codex, script mode), which is what it actually uses.
- No paid calls were made. Only fake codex ran.

## RED / GREEN evidence
- **First E2E run, brief text plus P4 (`b7/b7-e2e.txt` from the first run, since overwritten; a debug copy of the same result is `b7/dbg-run.txt`):** rc=1, `blocked: a=terminal:blocked_waiting_human`.
  - Diagnosis came from the copied world `b7/dbg.json.root`. ccloop's `run/events.jsonl` records `loop_blocked_waiting_human … allowlist miss: answer.txt`.
  - Cause: ccloop's `tests/fixtures/fake-codex.mjs:27` reports `changedFiles:["answer.txt"]` on every execute. `evaluatePathPolicy` in ccloop `src/controller/runLoop.ts:1583` checks those reported files against `safetyPolicy.allowlistPaths`.
  - A loop plan sets `allowlistPaths` to `targetPaths`, which was `["shared.txt"]`. Hand-written contracts in this fixture have `allowlistPaths: []`, so they never hit this check.
  - The same run also showed that `run/loop-contract.json` already carried the goal `write shared.txt, changed after confirmation` and `tokenBudget 3500000`. So the change did reach ccloop.
- **GREEN after the fix:** `b7/b7-e2e.txt`, rc=0, 1 passed (13.9 s). The TMPDIR was empty afterwards.
- **Without `ORCA_CCLOOP_BIN`:** `b7/b7-skip.txt`, rc=0, 1 skipped. `b7/b7-skip2-tmp.txt` shows the TMPDIR was empty after the skipped run, so the skip does not leak a temp root.
- **Typecheck:** `npm run typecheck` gave rc=0 (`b7/b7-tsc.txt`). `web/` was not touched.

## Mutations
All in the clone `SCRATCH/mut-b7` (`git clone --local`, `b7/b7-clone.txt`; `b7/b7-copy.txt` is empty). The ccloop binary in use, `gate-partA/cc`, was not touched.
- Driver script: `b7/mutrun.sh`. It makes one exact replacement, runs the criterion with the real binary, restores with `cat`, and checks with `cmp`.
- Each diff is in `b7/b7-<name>-diff.txt`.

| Name | Edit | Red criterion / reason | Evidence | Restore |
|---|---|---|---|---|
| MB7-1 | `executionSnapshot.ts` A2: `effectivePlanTask(store, groupId, archived, workBodyOf(…))` → `archived` | `… > runs the newly expanded contract to settle, and leaves the rest of the snapshot byte-identical`. `setTaskLoop` is refused with `recovery-blocked` by the self-check. | `b7/b7-MB7-1.txt` | cmp rc=0, `b7-MB7-1-restore.txt` 0 bytes |
| MB7-2 | `webService.ts`: `replaceTaskInSnapshot(frozen, …)` → `replaceTaskInSnapshot({ ...frozen, allocations: proposal.allocations.map(bare) }, …)`, with the P4 budget raise in the shipped criterion | Same test. The byte-identity assertion fails (line 65, `expected false to be true`). The run otherwise settled, which isolates this assertion as the one that catches it. | `b7/b7-MB7-2.txt` | cmp rc=0, 0 bytes |
| MB7-3 (P3, new fixture branch) | delete the whole `if (task.loop !== undefined) {…}` block in `ccloopWorld.ts` | Same test: `TypeError: Cannot read properties of null (reading 'loopVersion')`. The tasks import as hand-written, so `loopPlan` is null. | `b7/b7-MB7-3.txt` | cmp rc=0, 0 bytes |

The test file adds no production branches. Its only branch is the `ctx.skip()` gate, and both of its outcomes are shown above (skipped and ran).

## Files changed
- `tests/control/fixtures/ccloopWorld.ts` (+10 −1)
- `tests/control/loopPlanE2E.test.ts` (new)

## Commits
- `4117725 test(control): run a loop task changed after confirmation through real ccloop`. I read the trailer back from `b7/b7-msg.txt`: exactly the two lines.

## Departures from the brief and why
1. **`targetPaths: [path, "answer.txt"]` in `loopFor`.**
   - The brief's criterion cannot go green against the shipped fake codex, because the fake always reports `answer.txt` as changed, as measured above.
   - Alternatives considered:
     - Make task b hand-written. That changes the scenario more.
     - Change the fake codex. That is ccloop's repository and is off limits (Rule 16).
     - Drop the allowlist. That is a product rule of spec §3.
   - I judged the edit reversible and test-only, so I decided it myself (Rule 1, step 2). A code comment gives the reason.
   - Side effect: tasks a and b now share `answer.txt` in their write sets. Both still settled and landed, and both `show` assertions pass. The fake never actually writes `answer.txt` in script mode.
   - Please confirm, or tell me which alternative you prefer.
2. `Task` was reformatted onto four lines so the brief's comment sits on the new field. The change is otherwise additive.

## Self-review / concerns
- **The shared-`answer.txt` write set may serialize a and b or add an ordering the brief did not plan for.** I did not check whether Orca's scheduler serialized them. The criterion measures neither order nor parallelism.
- **Any future E2E criterion that runs a loop task against this fake codex will hit the same allowlist miss** unless its targetPaths include `answer.txt`. The gate should know this. So should anyone writing B8.
- **I did not run the other ccloopWorld users** (executionDriverE2E, handoffE2E, ccloopDefaultE2E) with the fixture change. The change is additive and only runs when `loop` is set, and typecheck passes. The controller's gate covers the full suite.
- The clone `SCRATCH/mut-b7` is kept (deleting it needs the human).
- Debug copies of a world are in `SCRATCH/b7/dbg.json.root` and `SCRATCH/b7/dbg.json`. They came from a temporary debug edit in the clone's test file, which was restored afterwards: `cmp` confirmed all four touched files matched the main tree before the mutations ran.
