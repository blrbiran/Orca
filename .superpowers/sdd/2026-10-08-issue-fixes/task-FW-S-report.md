# Task FW-S report (server half of the final fix wave)

Status: DONE. Commits (base 6b90629): d2c950a S1+S2+S3, e428e99 S4, 587193b S5. Evidence outputs: scratchpad orca/FW-S/.

## Implemented
- S1: `preflightWebCommand` (src/control/commandLedger.ts) books `group-archived` durably via persistCommandOutcome after the stale-revision check
  (stale wins, as in applyWebCommand), skipping `unarchive-group`. The in-transaction gate is untouched. A start on an archived group no longer probes.
- S2: test pins that a command accepted before archiving replays its stored result afterwards; command rows, activity seq and revision unchanged.
- S3: test asserts every NOT_GROUP verb's raw schema rejects both a group and a task target (issue path under `target`). Done by schema behaviour, not introspection.
- S4: approval save is in src/control/integrationCommands.ts (`applyResolveIntegrationConflict`), not integrationResolve.ts as the brief said; it writes
  `integration` {state:"resolving",reason:null}. `failResolution` (integrationResolve.ts) writes {state:"conflict",reason}. Both via `recordActivity`.
- S5: activityRuns "a driver run gets endedAt…" timeout 30000.

## Tests
- RED before S1 fix (stash of src): "books group-archived for a start before the frozen profiles are probed" failed `expected 2 to be +0` (probe count). The test has a control run proving start probes when not archived. (First draft used `estimate`, which never probes on a confirmed group; switched to `start`.)
- S2/S3/S4 tests are pins of new behaviour/tests: S4 verified RED by mutation; S2, S3 by mutation below.
- GREEN: archiveGroup, commandLedger, integrationResolve, activityRuns, integrationGit = 161 passed | 2 skipped, rc=0; `npm run typecheck` rc=0.
- Wider: vitest tests/control tests/entry rc=1, 1 failed (driverRecovery "drives a retried run on from where it was blocked", 5333 ms, load 10.8) / 1625 passed; alone with tests/panel: 66 files, 508 passed, rc=0 (load 11.7). Known load flake class.
- Mutations (clone made after commit, all RED, clone discarded; worktree diff 6623 bytes before and after = FW-W's uncommitted web files, cached 0):
  1. preflight archived branch disabled -> S1 test red. 2. unarchive exemption dropped in preflight -> "lets unarchive-group … through preflight" red.
  3. NOT_GROUP gains `start` -> walk coverage test and the new NOT_GROUP test red. 4. approval row removed -> S4 test red. 5. failure row removed -> S4 test red.
  Not mutated: S2 (a pin of existing replay-first behaviour; replay precedes both gates by construction) and S5.

## Concerns
- S2 passes before and after the S1 change by design (replay precedes the gate in preflight and apply); it guards future reordering only.
- S4 brief named integrationResolve.ts for the approval; the code lives in integrationCommands.ts (deviation).

## Fix round 1 (commit 0750df7)
- Important: added "replays a start accepted before the archive through preflight, probing nothing and booking nothing new" (start goes through
  preflightWebCommand; accepted, archive, re-sent with same command id: equal stored result, command rows and activity seq unchanged, probe count 0).
- Minor: the NOT_GROUP test now also rejects a `run` target.
- Mutation B (archive gate placed ahead of replay inside preflightWebCommand, clone made after 0750df7): output in scratchpad orca/FW-S/mB.txt; result below in the reply. Clone discarded.
- Re-run: archiveGroup + commandLedger 87 passed rc=0; typecheck rc=0.
