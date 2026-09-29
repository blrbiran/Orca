# Task B3 report — a confirmed change: snapshot copy-and-replace, and the change raced against the driver

Implementer: session `1d7d9aa0` (B3 subagent), 2026-09-30, on `main` at base `686e745`. Commit: `6a44547`.
Evidence directory: `SCRATCH/b3/` (SCRATCH = `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/1d7d9aa0-4a2b-478b-b0ec-d970d3a51afe/scratchpad`).
Mutation clone: `SCRATCH/mut-b3` (kept).

## What was implemented

- `src/control/executionSnapshot.ts`: new exported `replaceTaskInSnapshot(snapshot, taskId, derivedContractHash, { work, handoff })`,
  placed after `buildExecutionSnapshot` and written as the brief gives it. It uses `structuredClone` on the old snapshot, replaces only
  that task's `derivedContracts[].derivedContractHash` and its `work`/`handoff` allocation rows, re-parses the result with
  `executionSnapshotSchema`, and returns `{ snapshot, canonicalJson, snapshotHash }`. A missing entry or row raises `recovery-blocked`.
- `src/control/webService.ts`: the two import edits, and the placeholder line in `setTaskLoop`'s confirmed branch is replaced with the
  brief's five lines. They read the frozen snapshot, strip `state` off the live allocation rows, call `replaceTaskInSnapshot`, write the
  new canonical record and set `proposal.executionSnapshotHash`. `saveWebAuthority` (already present) then persists the proposal and the
  group's mirror. Old snapshot records are kept. The indentation follows the surrounding code (10 spaces, P10).
- `tests/control/setTaskLoopConfirmed.test.ts`: the brief's six criteria copied verbatim (brief lines 21–139). I added one P3 criterion,
  "replaceTaskInSnapshot refuses a snapshot it cannot copy", which covers the function's two new refusal branches, plus the two imports
  that criterion needs (`replaceTaskInSnapshot` and `executionSnapshotSchema`).

`proposalVersion` is never touched on the confirmed path. The "leaves every other part … byte-identical" criterion pins that every other
task's entries, `agents`, and the reserve row stay byte-identical.

The carried B1-review criterion ("amend after confirmation, then A2 reads the task and returns the new contract") is the first
criterion. It calls `readConfirmedTaskExecution(h.store, "g", "a")` and asserts `contract.objective.goal === "write a, changed"` and
`tokenBudget === raised.tokens`.

## RED (before implementing)

- `vitest run tests/control/setTaskLoopConfirmed.test.ts` → `b3-red.txt`, rc=1: 5 failed | 1 passed. Every confirmed change was refused
  `recovery-blocked`, from B2's step-8 self-check, because the snapshot still named the old derived contract. Only "a claim before the
  command … task-already-started" passed. This is exactly the RED the brief predicts.
- P3 criterion, `-t replaceTaskInSnapshot` → `b3-red2.txt`, rc=1: `TypeError: replaceTaskInSnapshot is not a function`. Expected, since
  the function did not exist yet.

## GREEN

- `vitest run setTaskLoopConfirmed setTaskLoop executionSnapshot executionDriver driverSettle` → `b3-green.txt`, rc=0: 5 files, 72 passed,
  0 skipped. `uptime` at that run (`uptime-green.txt`): load averages 4.85 5.37 7.34. `driverSettle` did not flake.
- `npm run typecheck` → `b3-tsc.txt`, rc=0, no errors.
- Neighbours, run in addition to the brief's list: `taskAmendments`, `confirmation`, `webMutations`, `panel/controlApi`,
  `panel/webParity` → `b3-neighbours.txt`, rc=0: 5 files, 38 passed.
- Web typecheck: not run, because `web/` was not touched.
- No existing criterion turned red. B2's "the self-check > rolls a confirmed change back when the changed task would not pass A2" is still
  green: it tampers the work item's `configHash`, and A2 still refuses that after the copy.

## Mutations (clone `mut-b3`)

Setup:
- Copy check: `b3-copy.txt` is empty (0 bytes).
- Clone baseline: `b3-clone-baseline.txt`, rc=0, 25/25 passing.
- Driver script: `b3/mutate.py`. Each mutation asserts that its pattern occurs exactly once, applies it, and runs `setTaskLoopConfirmed` +
  `setTaskLoop` (`b3-<M>.txt`) and `npm run typecheck` (`b3-<M>-tsc.txt`).
- Restore: the file is rewritten from REPO (a Python read/write of the REPO file, the same effect as `cat`), then checked with `cmp` into
  `b3-<M>-restore.txt`. Every restore file is empty and every cmp rc=0.
- Results: `b3-mut-summary.txt`; per-mutation index of red tests: `b3-mut-index.txt`.
- MB3-10's first pattern matched twice and was not run. I anchored it on the following line and re-ran it alone.
- Load at the mutation run: `uptime-mut.txt`.

| Name | Edit | Red criterion (evidence) |
|---|---|---|
| MB3-1 (spec: full rebuild) | `replaceTaskInSnapshot({ ...frozen, allocations: proposal.allocations.map(bare) }, …)` | `leaves every other part of the snapshot byte-identical` only (`b3-MB3-1.txt`: the byte-equality assertion is false). A2 compares non-reserve rows only, so the reserve row is caught solely by this criterion, as the brief routes it (F12). |
| MB3-2 (spec: bump proposalVersion) | `proposal.proposalVersion += 1;` as the first statement of the confirmed branch | `raises the budget … keeps proposalVersion …` plus the other 4 change criteria (`b3-MB3-2.txt`) |
| MB3-3 (spec: reserved but not reserve row) | delete the confirmed branch's `setReserve(…)` | `raises …`, `lowers …`, `byte-identical`, `changing one task while another runs` (`b3-MB3-3.txt`) |
| MB3-4 | delete `work.derivedContractHash = …` | `raises …`: `recovery-blocked:work-item-authority:a` from `readControlGroup` (`b3-MB3-4.txt`) |
| MB3-5 | delete `work.grant = { …, work: next }` | `raises …`: grant tokens 3000000, expected 3500000 (`b3-MB3-5.txt`) |
| MB3-6 (spec: bypass effectivePlanTask in A2) | A2 `effectivePlanTask(store, groupId, archived, workBodyOf(…))` → `archived` | `a command before the claim …` plus `raises`, `byte-identical`, `changing one task …`, and B2's draft-path `raises …` (`b3-MB3-6.txt`) |
| MB3-7 (spec: skip the self-check) | delete `readConfirmedTaskExecution(this.store, id, taskId);` | setTaskLoop.test.ts `the self-check > rolls a confirmed change back when the changed task would not pass A2` (`b3-MB3-7.txt`). With B3 the change would otherwise commit, so this deletion is now observable directly. |
| MB3-8 (spec: count only active runs) | runs query `+ AND active=1` | setTaskLoop.test.ts `refuses a task that is running, and one that has any run at all, as task-already-started` (`b3-MB3-8.txt`). The B3 claim-first race stays green under it, because the claimed run is active. |
| MB3-9 (per-line, B2 review) | delete `committedRemaining[d] += …` | `raises`, `lowers`, `byte-identical`, `changing one task …` (`b3-MB3-9.txt`) |
| MB3-10 (per-line) | delete `writeCanonicalRecord(… derived …)` | all 5 change criteria (`b3-MB3-10.txt`) |
| MB3-11 (per-line) | delete the confirmed branch's `UPDATE work_items …` | `raises`, `byte-identical`, `a command before the claim`, `changing one task …` (`b3-MB3-11.txt`) |
| MB3-12 (per-line) | delete `saveWebAuthority(…)` in the confirmed branch | all 5 change criteria (`b3-MB3-12.txt`) |
| MB3-13 (new line) | delete `writeCanonicalRecord(… rebuilt …)` | all 5 change criteria (`b3-MB3-13.txt`) |
| MB3-14 (new line) | delete `proposal.executionSnapshotHash = rebuilt.snapshotHash;` | all 5 change criteria (`b3-MB3-14.txt`) |
| MB3-15 (P3, new branch) | delete `if (!ref) throw …` | P3 criterion (TypeError, not recovery-blocked) **and** typecheck red: TS18048 `'ref' is possibly 'undefined'` (`b3-MB3-15.txt`, `-tsc.txt`) |
| MB3-16 (P3, new branch) | delete `if (index < 0) throw …` | P3 criterion: a ZodError `missing-task-allocation`, not `recovery-blocked` (`b3-MB3-16.txt`) |
| MB3-17 (per-line) | delete the `deriveContract(…)` line | typecheck red (TS2304 `derived`) and 6 criteria red at runtime (`b3-MB3-17.txt`) |

Every mutation went red: 17 run, 17 red, 0 green.

## Files changed

- `src/control/executionSnapshot.ts` (+23)
- `src/control/webService.ts` (+9 −3)
- `tests/control/setTaskLoopConfirmed.test.ts` (new, 139 lines)

## Commits

- `6a44547` feat(control): let set-task-loop change a confirmed task by copying its snapshot. The trailer was checked in `b3-msg.txt`
  and both lines are present.

## Self-review / concerns

1. **MB3-16 is red only by error type.** Without the `index < 0` guard, the schema's own `missing-task-allocation` refinement still
   rejects the snapshot, so the guard's observable job is to turn a ZodError into `recovery-blocked`. The guard is also unreachable from
   `setTaskLoop`: a missing allocation row is already refused at step 1 or by B2's `!allocation || !handoff` check. The P3 criterion
   pins the error code.
2. **Non-ControlError failures.** A malformed stored snapshot would throw a ZodError out of `executionSnapshotSchema.parse` in the
   inserted block, not `recovery-blocked`. The whole transaction still rolls back. This matches the brief's code as written, and I did
   not change it.
3. **The group mirror's snapshot hash is not asserted separately.** No criterion checks that the group's mirror (`group.proposal`)
   follows the new hash. It is covered only through `saveWebAuthority` as a whole (MB3-12), because A2 reads the proposal row.

## Departures from the brief

- Added one P3 criterion (7 tests instead of 6) and its two imports. Reason: P3 requires the new branches in `replaceTaskInSnapshot` to
  have a deletion mutation seen red, and nothing in the brief's criteria reaches them.
- Ran 11 mutations beyond MB3-1..6: the spec's "skip self-check" and "only active runs", the carried per-line deletions of the confirmed
  branch, the new lines, and the P3 branches.
- The restore step uses a Python read/write of the REPO file instead of `cat`. The effect is the same, and it is proven by `cmp`.
