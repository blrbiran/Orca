# Final whole-branch review: issue-fixes round (F3 step 1)

Reviewer: read-only subagent spawned by controller session 3156185d, 2026-10-09. Branch fix/issues-20261009 at 11027ab;
package c786e84..HEAD (`scratchpad/orca/review/final.diff`), with source files read directly in the worktree. The spec
(docs/superpowers/specs/2026-10-08-issue-fixes-design.md), the plan index and its pre-flight amendments, the ledger
(progress.md) and CLAUDE.md Rules 9/12/14/17 were the bar. Probes ran only in a `git clone --local` under
`scratchpad/orca/review/probe-clone`. The worktree was not touched apart from this file.

## Verdict: Ready with fixes

No Critical or Important finding. The cross-part contracts hold:
- Run-state writers and activity rows meet at one choke point (noteRunWrite).
- retry-task, archive and the stop intents refuse one another consistently on the server.
- The v9 migration is one-way and runs in a transaction.
- Every new code has en and zh text.
- No test writes the real `~/.orca`.

"With fixes" means two cheap UI minors (M1, M2) that bear directly on the round's goal of "no dead buttons, explained
states". The deferred minor A5+A6-1 should also be fixed before this panel is used for real. None of the three makes
the branch untrustworthy.

## Evidence run by this review

| What | Command (cwd = probe clone at 11027ab) | Result |
|---|---|---|
| A group whose only task ccloop ended failed, then Archive | ad-hoc vitest probe `tests/control/zzProbeArchiveFailed.test.ts` (clone only); log `scratchpad/orca/review/final-probe-log.txt` | archive before the stop: `archive-run-active`. After handoff-stop and driver rounds the stop state is `handoff-complete`, the run is `settled-recoverable`, and archive succeeds. So the exit the explanation names does exist. |
| What a ccloop-failed run becomes under a handoff stop | probe `tests/control/zzProbeFailedHandoff.test.ts`; log `final-probe-handoff-log.txt` | run view: `{state:"settled-recoverable", outcome:"failed", stopReason:"Error: codex-result-invalid: /x", continuable:true}`, task `held`/`blocked` (see M3) |
| en/zh coverage and wire parity | `vitest run tests/panel/refusalCoverage.test.ts tests/panel/webParity.test.ts` → `final-refusal-parity.txt` | rc 0, 2 files, 10 tests passed |
| node:sqlite cost per lookup | `node bench-prepare.mjs` (200×50 rows, 800-byte bodies) → `final-bench-prepare.txt` | node v22.13.1: 6.74 µs prepare+get+JSON.parse; 2.70 µs with a reused statement |

## Cross-part checks (focus list)

1. **Activity rows and run states.**
   - Every run-body writer goes through `noteRunWrite`: `saveRun` (budget.ts:31), `saveRunBody` (stopIntent.ts:175) and
     `saveDispatchRun` (webDispatch.ts:51).
   - The writers that bypass it change no state into blocked or ended:
     - `resumeBlockedDriverRun` moves blocked to a resume state. Its row comes from the caller, `retryRun`.
     - `storeOverview` changes only `overview`.
     - The legacy `claimContinuation` insert is CLI-only.
   - `settled-failed` is in `RUN_ENDED_STATES`. retry-task writes exactly one `run-settled` and one `task-retried`
     (pinned, retryTask.test.ts:118).
2. **retry-task vs archive vs stop intents.**
   - retry-task refuses any stop intent or `stopped`. The panel hides it under `view.stop !== null`. stopView blocks a
     stopped group that has no intent, so the two agree.
   - The ledger gate refuses retry-task on an archived group, and the panel hides it there too.
   - Archive refuses while a run is active, a terminally failed run included. The handoff-stop exit works (probe above).
   - Group-scope recovery-retry never reaches `retryRun`, so `run-terminal-failed` cannot veto a whole group's retry.
3. **Schema 9 migration.**
   - `migrateSchema` runs inside `BEGIN IMMEDIATE` (store.ts:110).
   - From 8 it only adds the table. From 1–7 it chains through `migrate7To8`.
   - The DDL is `IF NOT EXISTS`. The allowlist accepts 8 and 9, and an older build refuses 9 (schema9.test.ts:70 covers
     version 10).
   - No code deletes `groups`, so `REFERENCES groups(id)` under `foreign_keys=ON` cannot strand rows.
   - README states the one-way step.
4. **en+zh text.**
   - Present for `group-archived`, the four `archive-*` codes, `task-not-retryable`, `run-terminal-failed`,
     `codex-exit-error` and the other 12 codex reasons.
   - The coverage test enforces equal key sets and runs green.
5. **Tests that read back their own input before the call.**
   - I sampled retryTask, archiveGroup (control and web), activity, shutdownHealing and groupSummaryFields.
   - Pre-call assertions read fixture-derived state, for example the failed run's `netOf` and `groupStopState` after a
     real settle. They do not read values the test itself wrote.
   - The one known instance is the D2 deferred minor (third retryTask refusal test). Other mutations cover it.
6. **No real `~/.orca`.** The diff adds no `homedir`/`HOME`/`.orca` reference. Stores come from the fixtures' temp roots,
   and the global setup (`tests/setup/relocateUserData.ts`) relocates user data.
7. **UI buttons vs the server.**
   - Retry task, Retry run, Start, editors on an archived group and the per-task Continue all match the server's
     refusals, except the ones the D5 ruling accepted.
   - Exceptions: M1 (Archive) and M4 (the explanation names a hidden button).
8. **Performance.** See "Per-pass costs" below.

## Findings

### Critical
None.

### Important
None.

### Minor (new in this review)

**M1: the Archive button is offered where the server always refuses it.** `web/src/ControlGroupView.tsx:374`
- The button renders on every non-archived group. That includes a group with an active run, a handoff or shutdown stop
  still settling, an integration in `resolving`, or an estimate or requirement call in flight. Each of those draws a
  409 `archive-*`.
- Every one of those states is in the view the panel already holds:
  - `view.runs` (an active state);
  - `view.stop.state`;
  - the group integration state;
  - estimates in `running`/`start-unknown`;
  - the requirement block.
- This is the same pattern D8's fix round removed for Retry task: a button the server refuses in the current state.
- The refusal does explain itself, so this is Minor.
- Fix: a pure `archiveOpen(view)` in `runFacts.ts` that mirrors `refuseArchive`'s order, and the button shown only when
  it is true. One web test per guard. Mutation: drop one condition and the test goes red.

**M2: the handoff-partial and handoff-unresolved banners promise a button that may never appear.**
`web/src/locales/en.ts:62-63` and `zh.ts:160-161`
- The banners say "press Retry recovery under Dispatch when it is offered". That button renders only with
  `view.recoveryBlockers.length > 0` (ControlGroupView.tsx:358).
- A `handoff-partial` stop has no recovery blocker (a run settled unrecoverable), and C3's ruling records that no
  spec'd exit exists.
- Since E4's ruling, archive is accepted at `handoff-partial`, so Archive is the actual way out.
- Fix: the partial banner names Archive ("…or archive the group"), en and zh. The unresolved text can stay.

**M3: a handoff stop turns a ccloop-failed run into a continuable `settled-recoverable` run, and its reason disappears.**
`web/src/runFacts.ts:23` and `src/control/retryTask.ts:576`
- Measured by the probe above.
- After it, `runReasonText` returns null because the state is neither blocked nor settled-failed. The run looks like
  an ordinary recoverable stop.
- retry-task refuses it (`run-state:settled-recoverable`). The only way forward is continue-task from the failed run's
  checkpoint, not a fresh run from the group head (H3).
- The archive-run-active explanation steers people to exactly this path.
- Panel shutdown does not trigger it in driver mode: `shutdownGroup` drops Web work runs from `active` under
  `exemptDriverRuns`, so a failed run is not frozen.
- Fix (display, cheap): `runReasonText` shows `stopReason` for any run whose `outcome` is set and not `succeeded`.
- Design question for the human: should retry-task also accept a task whose last run settled from a failed outcome?
  This is reversible, so the reviewer recommends no change to the server this round.

**M4: archive-run-active tells a paused person to use Handoff stop, which is hidden under a pause.**
`web/src/locales/en.ts:856`, `zh.ts:794`; `ControlGroupView.tsx:317`
- The panel renders Handoff stop only when `stopMode !== "pause"`, although the server accepts strengthening a pause.
- Fix: append "(resume a paused group first)" to both texts, or render Handoff stop under a pause that has an active
  run.

**M5: per-request view cost grows with tasks and dependencies (the E2 N+1).** `src/panel/controlViews.ts:285`, `:302`,
`:658`, `:812`
- `categoryOf` costs 1 run lookup plus 1 lookup per dependency, each a fresh `prepare` and a full body `JSON.parse`.
  `taskCompletion` adds 1 work lookup per task.
- So a summarised group costs about 2T+E lookups where it cost T before. The group view repeats the same work and adds
  one `readRunActivity` per run for `lastActivityAt`.
- The summary is incremental (`readProjectionChanges`), so a poll recomputes only changed groups. But every activity row
  now records a projection change, so a group with a live run changes on almost every poll.
- The figure below combines the measured 6.74 µs per lookup with arithmetic. It is an extrapolation, not a measurement
  of Orca:

  | Scale | Lookups per poll | Synchronous event-loop time per poll, per open tab |
  |---|---|---|
  | 100 active groups × 50 tasks × 2 dependencies | ≈ 100 × (50 + 50 + 100) = 20 000 | ≈ 0.13 s |

  A full reset recomputes every group, archived ones included, and archived groups only accumulate.
- Fix:
  - read a group's work items and its tasks' current runs once each, in two `SELECT … WHERE group_id=?` queries, and
    categorise in memory;
  - hoist the prepared statements;
  - `lastActivityAt` from one `SELECT run_id, MAX(seq)… GROUP BY run_id` per group.

**M6: driver-round cost per archived group.** `src/control/webDispatch.ts:307` reached from
`src/control/executionDriver.ts:790`; `deliverScheduledStart` webDispatch.ts:195/216
- `replenishStartWakes` already holds each group's `body` but calls `nextClaimableTask`. That calls `isGroupArchived`,
  which re-selects and re-parses the same body, every round for every group.
- An archived group's pending start or resume wake is re-offered each pump pass (E5 noted this). Each pass costs a wake
  read, a stop check and a body parse.
- Both are O(archived groups) per round, and archived groups never leave.
- Fix: test the mark on the body already in hand (`archivedMarkOf(JSON.parse(row.body))`). Exclude archived groups in
  SQL, for example `json_extract(body,'$.archived') IS NULL`, where the wake queries select groups.

**M7: two errata on main are inaccurate, and main is now published.**
- `docs/superpowers/specs/2026-09-25-execution-driver-design.md`: the erratum's commit list omits 585fb72 (D10 deferred).
- `docs/superpowers/plans/2026-09-25-handoff-delivery.md`: the erratum says the dialog shows "X or Y", but both can
  show (C4 deferred).
- The human merged and pushed fix/issues-20261008, so these are published text. Rule 13 forbids editing them.
- Fix: append a short dated correction section after each erratum, leaving the original verbatim.

**M8: archive-stop-pending shows machine text inside its explanation.** `web/src/locales/en.ts:857`, `zh.ts:795`
- The `{{detail}}` is `<mode>:<state>` (for example `(shutdown:handoff-pending)`) in an English or Chinese sentence.
- Fix: map the detail through `enumText("stopMode")`/`enumText("stopState")`, or drop it, since the raw code already
  shows beside it.

### Per-pass costs that grow with groups or tasks (summary)

| Path | Cost per pass | Grows with |
|---|---|---|
| Summary poll, per changed group (M5) | 2T+E lookups + 1 `latestGroupActivityAt` | tasks, dependencies, active groups |
| Summary reset (first load, retention reset) | the above over every group, archived ones included | all groups ever created |
| Group view (on each projection change of the open group) | T+E for categories + R `lastActivityAt` queries + 50-row activity read | tasks, dependencies, runs |
| Driver `replenishStartWakes` (M6) | one extra body read+parse per group | all groups |
| Driver wake delivery (M6) | wake read + stop check + body parse per archived group with a pending wake | archived groups |
| `noteRunWrite` | one `json_extract` SELECT per run-body write (every usage booking) | run writes, constant per write |
| `appendActivity` retention | one `DELETE … OFFSET 500` index walk per row | constant (≤ 500 index steps) |

None of these is a correctness risk at the scale tested so far. M5 and M6 are the first to fix before scaling past about
100 concurrently active groups.

## Triage of the ledger's 37 "minor (deferred)" lines and queued items

All "Queued for the final fix wave" items landed:
- B10's two integration rows (e428e99);
- E4's minors 1–4 (d2c950a, b6c943c, 0750df7);
- D9's codex-exit-error text (b6c943c);
- E9's stall-token pin (b6c943c);
- E11's RunActivity reset (b6c943c, 6b90629);
- E12's 30 s timeout (587193b).

**Should be fixed before real use (1):**
- **A5+A6-1: a lost-response lookup that finds the command was refused leaves "outcome unknown" in place.**
  - Where: `web/src/App.tsx:358-367` dispatches a refusal only for `absent`. A `found` lookup with
    `originalStatus >= 400` dispatches nothing, so the stale unknown-outcome notice stays.
  - Why it matters: for an import, the import form never shows the plan's problem list. That is the exact failure §2
    (issues 1 and 10) set out to remove, on the one path where a person is already confused.
  - Cost: cheap. Dispatch a refusal built from the lookup's stored code and message at `place`, with a web test.

**Fix soon, not blocking:**
- E2's N+1: see M5.
- D10/C4 errata: see M7.
- E8: raw "4320 min ago". Use hours or days past 120 minutes.
- (D2's stale `stopReason` after recovery-retry is now reachable only through a store written before D5, because D5
  refuses recovery-retry on a terminally failed run. Leave it.)

**Leave as recorded:** every other deferred minor. They are unpinned-but-equivalent branches, cosmetic ordering or
indentation, test-hygiene items (swallowed dispose errors, lower bounds, a test satisfied by a second guard), or
deliberate fail-loud strictness: one corrupt archive mark failing the summary list matches the existing `blocked(...)`
convention. None changes what a person sees in a way that misleads.

**Still open, a human decision:** D9 concern 1, a run whose usage is unknown. retry-task refuses it and it blocks
dispatch; no v1 command clears unknown usage. The ledger's recommendation, a human-only "settle unknown usage" booking
the whole remaining grant, stands. It is not in this round's scope.

## Counts

Critical 0 · Important 0 · Minor (new) 8 (M1–M8) · deferred minors triaged 37 (1 should-fix-before-use, 3 fix-soon,
the rest leave).
