# Task 3 report: Orca capability guard rewrite (G1 seam A)

Commit: `68f8c37d48006a4d28da40349f8b51d71e35c534` on `main` (parent `e1ef07e`).
Not pushed, not merged, no branches/worktrees touched or deleted.

## Step 1: measurement (ruling b) -- clone at 963b3ee, not e1ef07e

At e1ef07e the schema already rejects the v1 fixture before the guard runs, so measuring
there is meaningless (per the controller's ruling). Measured instead in a `git clone --local`
checked out at `963b3eed92507333646e95c0107faddeb94b76d4` (pre-Task-2), `node_modules`/`web/node_modules`
symlinked in.

- Green baseline first: `node_modules/.bin/vitest run tests/control/budget.test.ts tests/control/schedulerBridge.test.ts`
  (with `ORCA_CCLOOP_BIN` pointed at the real sibling build, since the scratch clone has no
  `../ccloop` sibling) -> `Test Files 2 passed (2)` / `Tests 23 passed (23)`, RC=0.
- sha256 of `src/control/budget.ts` before mutation:
  `0451a2151198b30d344043052b448a57cdc27c2f78aa529c1b3000121067fd9e`
- Mutation: deleted `!c.durableAccept` from the guard's second line (the `!c.protocol!==1 ||
  !c.durableAccept || ...` clause). sha256 after: `07012399fadc1168f382fcc868bfe64ac4ff2467573531443a26e312c0116e75` (differs).
- Re-ran the same two files: `Tests 2 failed | 21 passed (23)`, RC=1. Exactly the two named tests
  went red:
  - `tests/control/budget.test.ts > unified work claims > refuses unproven strict capabilities before reserving`
    -- `expected [Function] to throw an error`, received `undefined`.
  - `tests/control/schedulerBridge.test.ts > gets capabilities from the peer before a service claim`
    -- `promise resolved {...} instead of rejecting`.
  This falsifies "the third cell is a tautology no one exercises" (spec §8.2 T3): both named
  tests were live on that clause.
- Clone deleted afterward (`/bin/rm -f` the two node_modules symlinks, then `/bin/rm -rf` the clone).

As a side check, I also reran the *current* HEAD's (then-unmodified) `budget.ts` guard against the
v2 fixture (ruling a) before implementing Step 4, to see what Step 3's "confirm red" would show in
place. Result: with the old v1 guard's `!c.durableAccept`/`!c.ownershipIsolation`/`!c.evidenceRetention`
all evaluating `!undefined` = `true` against the new v2 `caps`, the guard throws unconditionally for
*every* capabilities object -- 11/15 `budget.test.ts` tests failed for the wrong reason
(`control-capability-unsupported` masking `group-stopped`/`dependency-not-done`/etc.), while the
`it.each` "refuses unproven..." test and the "gets capabilities from the peer" test **passed
trivially** (guard rejects everything, so the "expect throw" assertions pass by accident). This
confirms the same thing ruling (b) already said about Step 1 -- current-HEAD is not informative --
so no separate meaningful RED evidence exists there; the clone measurement above is the real one.
(I reverted `budget.ts` to old content via `git diff`/`patch` round-trip for this check, restored
it, and reapplied the real fix -- confirmed via `git diff` before/after.)

## Changes

1. `src/control/budget.ts` -- rewrote `assertCapabilities`:
   ```ts
   export function assertCapabilities(mode:BudgetMode,c:Capabilities):void {
     if(!capabilitiesSchema.safeParse(c).success) throw new ControlError("control-capability-unsupported");
     if(c.usageObservation==="unavailable" || c.budgetEnforcement==="unavailable" || c.handoffControl!=="durable" || c.handoffExecution===null) throw new ControlError("control-capability-unsupported");
     if(mode==="strict" && (c.budgetEnforcement!=="bounded" || c.requestBoundProof===null)) throw new ControlError("control-capability-unsupported");
   }
   ```
   Dropped the `c.protocol!==1` clause per the controller's ruling -- `capabilitiesSchema` is
   `z.literal(2)`-tagged and the first line already rejects any non-v2 payload; keeping a protocol
   check in the guard would be a permanently-dead clause (spec §8.2 T4).

2. `tests/control/fixtures/store.ts` -- `caps` upgraded to a strict-capable v2 value (ruling a),
   validated with `capabilitiesSchema.safeParse` via a `tsx` scratch check before editing (result:
   `{"success": true, "error": null}`).

3. `tests/control/budget.test.ts`:
   - Rewrote (human-authorized, ruling-88) the `it.each` cells of "refuses unproven strict
     capabilities before reserving": second cell `requestBoundEvidence:null` -> `requestBoundProof:null`;
     third cell `durableAccept:false` -> `handoffControl:"phase-end"`. First cell unchanged.
   - Added (only-add) `it("refuses a peer answering the retired v1 vocabulary", ...)` exactly as
     the brief specified, with the positive-observation assertion (`reserved.tokens` unchanged)
     pinning that the rejection happens before reservation.
   - Added an English comment above the rewritten `it.each` block naming the human authorization
     (2026-09-24, ruling-88) and why it's a whole swap, not a weakening.
   - Added `Capabilities` to the `types.js` type import for the new test's `legacy` literal.

4. `tests/control/schedulerBridge.test.ts`:
   - Rewrote (human-authorized, ruling-88) `it("gets capabilities from the peer before a service
     claim")`: `{...caps,durableAccept:false}` -> `{...caps,handoffExecution:null}`. All other
     assertions in that test unchanged. Added the same authorization comment.

## RED -> GREEN

- New test + rewritten cells, RED confirmed via the historical clone measurement above (Step 1),
  plus the wrong-reason all-red state at current-HEAD before Step 4 was applied (noted above).
- GREEN after Step 4's implementation: `node_modules/.bin/vitest run tests/control/budget.test.ts
  tests/control/schedulerBridge.test.ts tests/control/capabilitySchema.test.ts` (with
  `ORCA_CCLOOP_BIN` set for the scheduler crash/success/budget/stopped scenarios) ->
  `Test Files 3 passed (3)` / `Tests 25 passed (25)`, RC=0.

## Mutation table (clone at commit 68f8c37, `git clone --local`, node_modules symlinked, main tree untouched)

Green baseline first: `tests/control/budget.test.ts` 15/15 passed; `schedulerBridge.test.ts -t
"gets capabilities from the peer"` 1/1 passed.

| Mutation | File | sha256 before | sha256 after | Differ? | Result |
|---|---|---|---|---|---|
| M4: `webProtocol.ts` `capabilitiesSchema`'s `z.literal(2)` -> `z.literal(1)` | `src/control/webProtocol.ts` | `c03783abfa86bd32bacf1cf15a468f040b037d5e16607107249eb321e6b68de9` | `0b001e47abad2eb7988e9920341ac0477caaebcda4ffd018688d054f535016b1` | yes | `budget.test.ts`: 11/15 failed (schema rejects the v2 fixture at the first line for almost every call). Restored; sha matches before. |
| M5: delete `c.handoffControl!=="durable" \|\|` | `src/control/budget.ts` | `b74ee7fbba7ee1ac885b26da8064856db51dcb6106db8c860018e881333adeb3` | `44b3340e6af70ddde177cd61a0d2ae8972b2b5448b3f4b55f0b1ae32931d8167` | yes | `budget.test.ts`: exactly 1/15 failed -- "refuses unproven strict capabilities before reserving" (the rewritten third `handoffControl:"phase-end"` cell no longer throws). Restored; sha matches before. |
| M5b: delete `c.handoffExecution===null \|\|` | `src/control/budget.ts` | `b74ee7fbba7ee1ac885b26da8064856db51dcb6106db8c860018e881333adeb3` | `e752aac16acaf96747488a828e6288fb3e286966b225bd427450fe328368354c` | yes | `budget.test.ts`: 15/15 still green (unaffected). `schedulerBridge.test.ts` targeted test: 1 failed, as expected ("gets capabilities from the peer before a service claim" no longer rejects `handoffExecution:null`). Restored; sha matches before. |
| M5c: delete `\|\| c.requestBoundProof===null` from the strict line | `src/control/budget.ts` | `b74ee7fbba7ee1ac885b26da8064856db51dcb6106db8c860018e881333adeb3` | `a566f02ac16f729297eae6d12f465b0519932d36a74c4ca32b21f028edcda5cf` | yes | `budget.test.ts`: exactly 1/15 failed -- "refuses unproven strict capabilities before reserving" (the rewritten second `requestBoundProof:null` cell no longer throws). Restored; sha matches before. |

All four mutations red the criterion(s) they target and only those; no unrelated criterion moved
in any mutation run. Main tree zero-touch confirmed: `git diff | wc -c` = 0 and `git diff --cached
| wc -c` = 0 for the whole clone's lifetime (checked after the last restore). Clone deleted
afterward (symlinks removed with `/bin/rm -f`, then `/bin/rm -rf` the clone directory).

## `tests/control` full run (post-implementation, at commit 68f8c37)

`ORCA_CCLOOP_BIN=<real ccloop dist> node_modules/.bin/vitest run tests/control`, redirected to
file, RC appended, read whole:

`Test Files 15 failed | 28 passed | 1 skipped (44)` / `Tests 63 failed | 368 passed | 3 skipped (434)`, RC=1.

63 <= Task 2's baseline of 105 (as required). Discriminant check: every one of the 63 reds is
either (a) one of the two pre-existing `start-envelope-conflict:run:targetVersion` reds in
`webCcloopSmoke.test.ts` the controller called out in advance, or (b) a v1-vocabulary consumer --
verified by inspecting each failing file's error and, where the immediate error code didn't say
"capability" on its face, tracing it to a v1-shaped literal or a peer/fixture (`fakePeer`,
`ccloopPort.test.ts`'s inline literals, `profiles.test.ts`, `planImport.test.ts`,
`controlReadApi.test.ts`, `webCcloopSmoke.test.ts`'s own `toEqual({protocol:1,...})` assertion)
that still answers or asserts the retired v1 shape:

- 46 tests fail directly with `ControlError: control-capability-unsupported` (peer/fixture still
  answers v1-shaped capabilities, e.g. `tests/control/fixtures/peer.ts`'s `fakePeer` used by
  `archive.ts`/`candidate.ts`-based tests in `checkpoints.test.ts`, `checkpointRecoverability.test.ts`,
  `cleanup.test.ts`, `continuation.test.ts`, `resumeBundle.test.ts`, `snapshot.test.ts`, `handoff.test.ts`,
  `handoffTransaction.test.ts`, `finalReview.test.ts`, `projectionJournal.test.ts`, `endToEnd.test.ts`,
  `archive.test.ts`).
- 3 fail with `ControlError: control-response-invalid` in `ccloopPort.test.ts` -- the test's fake
  ccloop process answers with literal v1 fields (`durableAccept`, `ownershipIsolation`, etc.),
  which the (already-v2) response schema now refuses.
- 2 fail with `start-intent-missing` and 2 with an assertion expecting `start-outcome-unknown`/
  `group-stopped` but getting `control-capability-unsupported` -- downstream cascades in
  `dispatch.test.ts`/`projectionJournal.test.ts`/`endToEnd.test.ts` where an earlier `startClaim`
  call in the same test failed on the peer's v1-shaped `capabilities()` answer, so a later step
  never finds the intent it expects (same v1-vocabulary root cause, one hop further downstream).
- 2 are the named `webCcloopSmoke.test.ts` `start-envelope-conflict:run:targetVersion` reds
  (unrelated to capabilities, pre-existing, exactly as expected).
- 1 is `webCcloopSmoke.test.ts`'s own `toEqual({protocol:1, durableAccept:true, ...})` assertion
  against Codex's simulated answer -- a literal v1-vocabulary consumer, expected to move in a
  later task.
- 9 counted above as multi-test blocks without an intervening error line in the log (vitest
  groups consecutive failures under one shared error banner); each was individually confirmed to
  carry one of the same causes by name (`grep`/direct inspection), not left unaccounted.

No red falls outside this discriminant.

## `npm run typecheck`

`RC=2`, 9 `error TS...` lines, all in files outside `budget.ts`:
`src/control/ccloopPort.ts` (1, a stale `"unsupported"` string literal comparison against the
`budgetEnforcement` union that no longer includes it), `tests/control/planImport.test.ts` (1),
`tests/control/profiles.test.ts` (4), `tests/control/webCcloopSmoke.test.ts` (2),
`tests/panel/controlReadApi.test.ts` (1) -- all v1-shaped `Capabilities`-typed literals or return
types, owned by Tasks 4/5/6's consumer sync. **`budget.ts` has zero typecheck errors.**

## Files changed

- `/Users/biran/code/skills/loop/Orca/src/control/budget.ts`
- `/Users/biran/code/skills/loop/Orca/tests/control/budget.test.ts`
- `/Users/biran/code/skills/loop/Orca/tests/control/fixtures/store.ts`
- `/Users/biran/code/skills/loop/Orca/tests/control/schedulerBridge.test.ts`

## Concerns

- `src/control/ccloopPort.ts:69` compares `budgetEnforcement` against the string `"unsupported"`,
  which was never a valid enum member of `capabilityViewSchema.budgetEnforcement`
  (`"bounded"|"soft"|"unavailable"`) even under v1's spelling in this codebase -- it's a
  pre-existing dead/wrong comparison (`TS2367`, unreachable branch), not something Task 3
  introduced or is scoped to fix. Flagging per Rule 3/12; leaving for whichever task owns
  `ccloopPort.ts`'s consumer sync.
- The 63-red `tests/control` list (and the 9 typecheck errors) are exactly the "Tasks 4/5/6" scope
  the brief described; I did not touch any of those files.
