# Queued estimates of a stopped pre-start group are parked, not re-posted — design

- **Author:** Track E implementer, Orca session `9ec98639` (2026-10-21). **Status:** design + as-built in the same round.
- **Ruling:** human, session `308b874c` (ledger `.superpowers/sdd/2026-10-20-session-308b874c/progress.md`, "Rulings,
  late round"): "同意按你的建议，走挂起逻辑" — keep the estimate queued and its grant; mark the wake delivered; re-arm the
  wake on every un-stop path. Session `9ec98639`: "这一轮执行过程中如果有问题，先按你的建议执行" (decisions below).
- **Corrects:** `2026-10-17-estimate-usable-answer-design.md`, last paragraph of its "Correction (session 3d229487)"
  ("A queued estimate of a **stopped** pre-start group … is not withdrawn by this section (not in the ruling)") — such an
  estimate is now parked as below. That spec's text is kept; a pointer is appended there.

## 1. What happens today (measured at Orca main `9d874ed1`, probe test in the implementer's worktree)

- `claimEstimate` (`src/control/webService.ts`), in its transaction, after the withdrawal checks and `prestart`, throws
  `group-stopped` when `group.stopped`. The `budget-estimate` wake handler (`src/control/webDispatch.ts`
  `createWebWakeHandlers`) lets the throw escape, so the pump (`deliverSchedulerWakes`, `src/control/dispatch.ts`) defers
  the wake; it is re-delivered every pump pass, and every pass runs the estimate's capability probe again. Probe:
  pause a group with a queued estimate, pump three times ⇒ `deferred` holds the estimate wake each time, wake
  `delivered=0`, estimate `queued`.
- A pre-start group can be stopped from the panel: `pause-dispatch` and `handoff-stop` are offered on every
  non-archived group (`web/src/ControlGroupView.tsx`), and neither command refuses a pre-start group (only clarifying).

## 2. Un-stop paths today (every place that sets `group.stopped = false` or deletes a stop intent)

| Path | File | Reaches a pre-start group with a queued estimate? | Posts a wake today |
|---|---|---|---|
| `resume-dispatch` (pause → running) | `src/control/stopIntent.ts` `applyResumeDispatch` | yes (pause is offered pre-start) | a `start` wake — but `startSchedulerWake` throws `group-state-invalid` when the proposal is not confirmed, so **a paused pre-start group cannot be resumed at all** (probe: `group-state-invalid`, group stays stopped) |
| `resume-from-handoff` | `src/control/continuation.ts` `applyResumeFromHandoff` | yes, via the API (the panel offers it only with continuable tasks) | a `resume` wake |
| startup heal of an empty-frozen-set shutdown intent | `src/control/recovery.ts` `healEmptyShutdownIntents` | yes (legacy rows) | none |
| requirement `recovery-retry` lifting a completed stop | `src/control/stopIntent.ts` `retryRequirementInTransaction` | **no**: clarifying only, and a clarifying group has no estimate rows (estimates are inserted only by `createEstimate`, `planImport`, `writeEstimateRetry`, none of which run while clarifying) | requirement wakes |
| legacy `setGroupStopped` | `src/control/commands.ts` | **no**: no caller in `src/` | — |

## 3. Design

1. **Park (claim time).** In `claimEstimate`'s transaction, the `group-stopped` throw is replaced: when the group is
   stopped (after the existing archived, withdrawal and `prestart` checks, so a started group's estimate is still
   withdrawn), the estimate is **parked**:
   - state stays `queued`; its grant stays in `committedRemaining` (nothing released, nothing settled);
   - every `budget-estimate` wake row of this estimate is set `delivered=1` **in the same transaction**;
   - an `estimate` spend-cap block of the group, if any, is cleared (the estimate no longer waits on a cap; it is
     gated again when re-armed);
   - the claim returns `null`. The handler sees `queued` and returns false (deferred); the row is already delivered,
     so the next pump does not see it. Marking inside the transaction (not by returning true to the pump) is what keeps
     an un-stop that commits between the claim and the pump's acknowledgement from being overwritten.
2. **Invariant used by re-arming.** An estimate is `queued` only at creation (`webService.ts`, `planImport.ts`,
   `estimateRetry.ts`) and the handler acknowledges a wake only when the estimate is no longer `queued`; so after this
   change a **delivered** `budget-estimate` wake of a **queued** estimate exists only because it was parked.
3. **Re-arm (`rearmParkedEstimates(store, groupId)`, `src/control/estimateParking.ts`).** Sets `delivered=0` on every
   delivered `budget-estimate` wake of the group whose estimate is `queued`. Called in the same transaction as each
   reachable un-stop path of §2: `resume-dispatch`, `resume-from-handoff`, startup heal. The next pump claims the
   estimate as usual (it may then run, be withdrawn — e.g. `group-started` when the un-stop itself left a start/resume
   wake pending — or park again).
4. **`resume-dispatch` of a paused group whose proposal is not confirmed** (decision, reversible): lifts the pause
   (deletes the intent, clears `stopped`), re-arms parked estimates, arms **no** start wake (there is nothing to start
   until confirm), and answers a new result `{ kind: "resumed", operation: "resume-dispatch" }`. A confirmed group keeps
   today's path and result (`scheduled` + start wake). Without this, parking a paused pre-start group's estimate would
   be a dead end (today's refusal leaves the group stopped forever from the panel).

## 4. Decisions (controller's calls, reversible)

- No new estimate state or reason code: a parked estimate shows `queued`; the group's own stop state tells why it
  waits. (A `parked` state would touch the strict view schema and its web mirror for no behavioural gain.)
- Paths not reachable for a pre-start group with estimates (§2 last two rows) get no re-arm call (Rule 2); a test of the
  helper pins the invariant instead.
- The pre-transaction capability probe still runs once for a stopped group's estimate (the first pump pass); after
  parking it does not run again. Not worth a second pre-probe check.

## 5. Tests (red first, each with the mutation that must turn it red)

`tests/control/estimateParking.test.ts`:
1. pause → pump: wake delivered once, estimate queued, grant kept, nothing launched; a second pump does not see the
   wake. Mutations: restore the throw; park without marking the wake; release the grant.
2. pause → park → `resume-dispatch` (unconfirmed): `resumed`, not stopped, wake re-armed, then claimed and run.
   Mutations: drop the re-arm call; restore the refusal for unconfirmed proposals.
3. `handoff-stop` → park → `resume-from-handoff` with no selections: wake re-armed in the command's transaction, then
   the estimate leaves `queued`. Mutation: drop the re-arm call.
4. legacy empty shutdown intent → park → `recoverControl`: re-armed. Mutation: drop the re-arm call.
5. capped estimate then pause → park clears the estimate's cap block. Mutation: drop the clear.
6. helper: a delivered wake of a withdrawn estimate is not re-armed; a delivered wake of a queued one is. Mutation:
   drop the `state='queued'` filter.

## 6. Residuals

- `resume-from-handoff` on a pre-start group leaves a `resume` wake that `deliverScheduledStart` keeps refusing while
  the proposal is unconfirmed; the start guard counts it as execution pending, so the re-armed estimate is withdrawn as
  `group-started`. Pre-existing semantics of that command, not changed here.
- An archived group's queued estimate still re-posts every pass (issue-fixes spec §6.3, unchanged).
