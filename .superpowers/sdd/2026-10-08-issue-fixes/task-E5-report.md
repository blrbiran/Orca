# Task E5 report — an archived group gets no claims, wakes or integration (spec §6.3)

Implementer: E5 (session e34dc963 subagent), 2026-10-09. Commit: f66998b `feat(control): claim, wake and integrate nothing for an archived group` (on top of 34142f9).

## What was implemented
- `src/control/webDispatch.ts`: inside the `deliverScheduledStart` transaction, just after `if (!still) ...`: an archived group returns `{ kind: "blocked", reason: "group-archived" }`. A `blocked` answer leaves the wake pending. Only code past this check can reach `deliverContinuationWake`. Also, `nextClaimableTask` now returns null for an archived group as its first statement, so `replenishStartWakes` arms no wake for it.
- `src/control/integrationPass.ts`: the per-group loop parses the body once, reads the integration record and `archivedMarkOf`, then skips (`continue`) an archived group. This happens before any git child and before conflict-copy cleanup, so an archived group's copies are kept as records. If the mark does not parse, the existing catch logs it and goes on to the next group.
- **Controller amendment (Part E ruling 2):**
  - `src/control/webService.ts` `claimEstimate`: inside the transaction, after the existing-run return, an archived group returns null. The estimate stays `queued`. The budget-estimate handler then answers false, so the wake stays pending.
  - `src/control/requirementExport.ts` `exportPendingRequirements`: an archived group's export wake is skipped. It stays undelivered, the export stays pending and no branch is written.
- Per ruling 3, no duplicate checks were added in `replenishStartWakes` or `deliverContinuationWake`.

## Tests (appended)
- `tests/control/archiveGroup.test.ts`, describe "no claim and no wake for an archived group (spec §6.3)":
  - the brief's two tests;
  - plus "leaves a queued estimate queued and its wake pending: no estimate run is claimed until it is unarchived". It uses the real `createWebWakeHandlers` with `deliverSchedulerWakes`, then unarchives and shows the estimate is claimed.
- `tests/control/webContinuation.test.ts`: Review Focus 4. A queued continuation plus a start wake on an archived group: both deliveries answer blocked, no run, both wakes pending. After unarchive the delivery claims.
- `tests/control/integrationGit.test.ts`: real git. While archived the pass returns false and the remote has no `orca/g`. After unarchive the pass pushes the landed tip.
- `tests/control/requirementExport.test.ts` (amendment): accepted draft, archive, then `exportPendingRequirements`. It answers false, the wake stays undelivered, the export stays pending and no `orca/r` ref exists. After unarchive the document is exported.

## TDD evidence (scratchpad orca/E5/)
- RED: `vitest run archiveGroup webContinuation integrationGit requirementExport > e5-red.txt` gave rc=1 with 6 failed and 111 passed. Each failure was for the expected reason:
  - delivery answered `claimed`;
  - `nextClaimableTask` answered `{ workItemId: "a" }`;
  - the estimate wake was delivered;
  - the integration pass answered true;
  - the export answered true;
  - the continuation was claimed.
- GREEN: the same command `> e5-green.txt` gave rc=0, 117/117. `npm run typecheck > tc.txt` gave rc=0.
- Wide: `npm run build --workspace web` rc=0, then `vitest run tests/control tests/panel tests/entry > wide.txt` gave rc=0.
  - Files: 214 passed, 8 skipped. Tests: 2117 passed, 55 skipped.
  - The skipped ones are the real-binary E2E files, which are gated off in this environment, as on base.
  - Load averages were 17.72 / 14.22 / 12.61.

## Mutation evidence
Run in a `git clone --local` made after the commit (clone HEAD 7d9aaeb, which contains f66998b). Each mutation was reverted before the next.

| Mutation | Result | Test(s) that went red | Output file |
|---|---|---|---|
| m1: delete the `deliverScheduledStart` check | rc=1 | "leaves a pending start wake pending" (got `idle`) and the Review Focus 4 continuation test (got `claimed`) | m1.txt |
| m2: delete the `nextClaimableTask` check | rc=1 | "offers no claimable task" | m2.txt |
| m3: delete `if (archived) continue;` | rc=1 | the integration test | m3.txt |
| m4: delete the `claimEstimate` check | rc=1 | the estimate test | m4.txt |
| m5: delete the export check | rc=1 | the export test | m5.txt |

The clone was then deleted. Worktree byte counts for `git diff -- src/control tests/control` and `git diff --cached` were 0/0 before and 0/0 after (wt-proof.txt). Other implementers' uncommitted web files were not touched.

## Deviations
- Added the estimate and export checks, each with its own test, as the binding amendment requires. They are not in the brief.
- The export test went into `tests/control/requirementExport.test.ts`, a file not listed in the brief, because that file has the accepted-draft fixture.

## Self-review and concerns
- The `claimEstimate` check is inside the transaction, so the estimator probe still runs once for an archived group before the check refuses. A second check before the probe could never be seen red (Rule 9).
- An archived group with an integration conflict on record keeps its conflict copies.
- The wake pump keeps re-offering the pending wakes of an archived group each round. This costs only a cheap read and is intended: the wakes are delivered on unarchive.

## Fix round 1 (commit 04d2876 `fix(control): probe no agent for an archived group's wakes`)
Review finding addressed. The finding (Important): every pump pass probed the agent (a ccloop child) for each archived group with a pending start/resume wake or a queued estimate. Probing happened before the in-transaction refusal.

### Changes
- `src/control/webDispatch.ts`: `deliverScheduledStart` now checks for an archived group right after `stopIsPending` and before the snapshot read and probe. It answers `blocked group-archived`.
- `src/control/webService.ts`: `claimEstimate` checks before its probe. A queued estimate of an archived group answers null.
- Both in-transaction checks are kept, for a group archived while its probe ran.
- `src/control/archiveGroup.ts`: added a comment above the requirement-call guard. It says this guard, together with the ledger gate, keeps requirement calls off an archived group.

### Tests (`tests/control/archiveGroup.test.ts`, new describe "an archived group costs no agent probe per pump pass")
The tests use a spread copy of the fixture router that counts `probe` calls. `vi.spyOn` cannot be used because the router is frozen.

| Test | What it shows |
|---|---|
| Start delivery while archived | 0 probes |
| Archive during the start probe | Answers `blocked group-archived`; the wake stays pending and no run is active. This pins the in-transaction check. |
| Estimate wake delivered through the pump's own handlers while archived | 0 probes; the estimate stays queued |
| Archive during the estimator probe | `claimEstimate` answers null after exactly 1 probe; the estimate stays queued and there is no run. This pins the in-transaction check. |

### Review Focus 4 test rewrite (`tests/control/webContinuation.test.ts`)
- It now asserts the pending start/resume wakes by kind, exactly `["resume", "start"]`.
- It dropped the extra `armOrdinaryClaim`. That call added a second start wake; the start wake that `recoverablePredecessor` armed is the queued start.
- It delivers through `createWebWakeHandlers` + `deliverSchedulerWakes`. Neither wake is acknowledged and there are no active runs. A direct `deliverScheduledStart` also answers blocked.
- After unarchive, a pump pass delivers both wakes and creates runs.

### Results
- Focused: `vitest run archiveGroup webContinuation > f1.txt` gave rc=0, 64/64. `npm run typecheck > tc2.txt` gave rc=0.
- Wide: web/dist rebuilt, then `vitest run tests/control tests/panel tests/entry > wide2.txt` gave rc=1.
  - 1 failed, 2120 passed, 55 skipped (the environment-gated E2E files).
  - Load averages were 9.42 / 6.77 / 5.78.
  - The red test is `tests/panel/controlShutdown.test.ts` "a real SIGTERM to a real panel > makes it exit cleanly…": the exit code was 143, not 0.
  - Re-run alone (`> shut.txt`) it gave rc=0, 6/6. It is a real-process signal timing test, and this round touches nothing on the panel shutdown path.
  - I propose it as a load-flake candidate.

### Mutations
Run in a post-commit `git clone --local` that contains 04d2876. Each mutation went red on exactly its own test:

| Mutation | Red test | What it saw | Output file |
|---|---|---|---|
| f1m1: delete the early `deliverScheduledStart` check | "without probing the agent" | 2 probes, not 0 | f1m1.txt |
| f1m2: delete the in-transaction `deliverScheduledStart` check | "archived while its start probe ran" | answered `idle`, not blocked | f1m2.txt |
| f1m3: delete the early `claimEstimate` check | "without probing the estimator" | 1 probe | f1m3.txt |
| f1m4: delete the in-transaction `claimEstimate` check | "archived while the estimator probe ran" | an estimate run was claimed | f1m4.txt |

The clone was deleted afterwards. Worktree diff (`src/control`, `tests/control`) and cached diff were 0/0 bytes before and after (wt-proof.txt).

### Note
With the early check in place, round 0's mutation m1 (delete the in-transaction start check) no longer turns "leaves a pending start wake pending" red, because the early check answers first. The in-transaction check is now pinned by the archive-during-probe test (f1m2).
