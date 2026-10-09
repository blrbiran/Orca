### Task E12: Part E closing check

- [ ] **Step 1:** `npm run typecheck > <S>/e12-tc.txt 2>&1; echo rc=$?` → `rc=0`.
- [ ] **Step 2:** `npm run build --workspace web > <S>/e12-build.txt 2>&1; echo rc=$?` → `rc=0`.
- [ ] **Step 3:** `npm run --ws check > <S>/e12-ws.txt 2>&1; echo rc=$?` → `rc=0`.
- [ ] **Step 4:** `./node_modules/.bin/vitest run tests/control tests/panel tests/entry > <S>/e12-server.txt 2>&1; echo rc=$?`
  → `rc=0`, or only reds from the registered load-flake list (handoff §3); re-run those files alone and record `uptime`.
- [ ] **Step 5:** record in the ledger: the rewritten tests (table at the top of this part), every mutation seen red with
  the clone path and the commit, and the flagged points below. No commit (evidence only).

### Points flagged for the controller (the design is not changed here)

1. **Archive guard codes.** Spec §6.3 asks for "its own code and explanation" per guard; this part adds four durable 409
   codes (`archive-run-active`, `archive-stop-pending`, `archive-integration-resolving`, `archive-call-in-flight`) beside
   `group-archived`. The plan index's "New error codes" list names only `group-archived` and should gain them.
2. **"Estimate in flight"** is read as `running`/`start-unknown`, the states `scheduleStart`'s `estimate-in-flight`
   already uses. A *queued* estimate (every imported group has one until the estimator runs) does not refuse archive, and
   `claimEstimate` (`webService.ts:461`) is not among the paths §6.3 tells to skip an archived group, so a queued estimate
   wake on an archived group is still claimed. Likewise `requirement-export` wakes are not gated. Not changed.
3. **`replenishStartWakes` and `deliverContinuationWake`** get no check of their own: they are covered through
   `nextClaimableTask` and `deliverScheduledStart` (their only caller), and a duplicate check could never be seen red.
4. **Group-list rule 4** (`counts.running + counts.waiting > 0` ⇒ Running): a confirmed group that was never started but
   has any dependency edge has a `waiting` task, so it lists as Running, not Not started.
5. **Legacy `applyCommand`** (`src/control/commands.ts`, the CLI `ControlService`/`claimWork` path) books its own command
   rows and is not gated by E4's ledger gate; it is not reachable from a Web or socket route (same standing as spend caps'
   D19 gap).
6. **Part B / Part D names assumed:** the web type `RunActivityViewV1`/`ActivityEntryV1`, run view `startedAt` and
   `lastActivityAt`, the route's response shape, `enums.activityKind` (E11 adds it unless Part B did), and
   `WebControlService.retryTask` with a group target. If those parts chose other names, E4/E9/E11 use theirs.
7. **`src/control/archivedMark.ts`** is a second new server file beside `archiveGroup.ts`: the archive-mark reader is
   needed by `commandLedger.ts`, which `archiveGroup.ts` itself imports, so it lives in a leaf module.
