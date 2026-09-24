# Task 5 report: real ccloop answer feeds the router directly (G1 seam A)

Commit: `287b502` on `main` (parent `a6f8365`). Not pushed, not merged, no branches/worktrees
touched or deleted.

## Changes

`tests/control/webCcloopSmoke.test.ts` only:

1. Deleted `codexProbe(...)` entirely, including the comment "Only the three fields the adapter
   answers come from the subprocess...", which described behavior that no longer exists.
2. Both call sites (`strict`/`soft` branches of the "claims phase-end usage and soft enforcement..."
   test) now pass `await port.probeProfileCapabilities!()` -- the real-binary port already
   constructed earlier in the same test -- straight into `confirmedByAdapter(...)`. This is the same
   production strip-`protocol` code path (`ccloopPort.ts`'s `probeProfileCapabilities`, done in
   Task 4) that a real deployment uses; nothing here borrows from `profileSnapshot().profile.capabilities`
   any more.
3. The `expect(capabilities).toEqual({...})` literal (raw `port.capabilities()`, not the probe)
   moved from the v1 seven-field shape (`protocol:1, durableAccept, ownershipIsolation,
   evidenceRetention, usageObservation, budgetEnforcement, requestBoundEvidence`) to the v2
   eight-field shape ccloop main (f9727a1) actually answers: `protocol:2, usageObservation:
   "phase-end", budgetEnforcement:"soft", contextObservation:"unavailable", handoffControl:
   "durable", handoffExecution:"mechanical-in-run-v1", contextWindowTokens:null,
   requestBoundProof:null`.
4. Both edited spots carry an English comment naming "Human authorization 2026-09-24, G1 seam A
   Task 5". No other test in the file was touched.

`tests/control/fixtures/fake-ccloop-control.mjs`: unchanged this task (Task 5 Step 1 was already
done in Task 4, per the controller's instruction to skip it).

## Gate results (Step 3)

Env for both runs: `ORCA_CCLOOP_BIN=<scratchpad>/ccloop-t1/dist/cli.js`,
`ORCA_CCLOOP_ADAPTER_CONFIG=<scratchpad>/fixtures/fake-codex-config.json`. Redirected to file,
`RC=$?` appended, read whole.

**`npm run verify:web-control:consumer`**: `Tests 2 failed | 2 passed (4)`, RC=1. The 2 reds are
exactly the two named `start-envelope-conflict:run:targetVersion` failures in "the frozen dispatch
envelope reaches a real process" (seam B, seeded before this task, explicitly required to stay red).
Both tests in "the shipped consumer answers for its own capabilities" -- including the terminal
`claims phase-end usage and soft enforcement...` test -- are green. Discriminant satisfied: no red
outside the two named ones.

**`npm run verify:control`**: `Test Files 14 failed | 30 passed (44)` / `Tests 58 failed | 377
passed (435)`, RC=1. 58 <= Task 4's baseline of 59 (net -1: the one `AssertionError` on the old
`toEqual({protocol:1,...})` literal that Task 4's report flagged as "expected to move in a later
task" is now fixed).

Per-cause tally (Python, parsing the `×`/`→` summary-line pairs vitest prints for every failing
test -- reliable across `it.each`/grouped headers, unlike the bottom "Failed Tests" blocks which
vitest sometimes prints as one shared banner for several `×` lines; verified 58 `×` lines all
paired with a `→` cause, 0 unmatched):

| Cause | Count |
|---|---|
| `ControlError: control-capability-unsupported` (peer/fixture still answers v1-shaped `capabilities()`, or the declared-profile-derived observed capabilities in other fixtures -- pre-existing v1-vocabulary consumers owned by Task 6) | 51 |
| `AssertionError`: test expected `start-outcome-unknown` but got `control-capability-unsupported` (downstream cascade, `dispatch.test.ts`) | 2 |
| `AssertionError`: test expected `group-stopped` but got `control-capability-unsupported` (downstream cascade, `dispatch.test.ts`/`projectionJournal.test.ts`) | 1 |
| `ControlError: start-intent-missing` (same v1-fixture root cause, downstream, `dispatch.test.ts`) | 2 |
| `ControlError: start-envelope-conflict:run:targetVersion` (the two named, pre-existing `webCcloopSmoke.test.ts` reds; seam B, unrelated to capabilities) | 2 |
| **Total** | **58** |

Discriminant satisfied: every one of the 58 reds is either (a) one of the two named
`start-envelope-conflict:run:targetVersion` reds, or (b) a v1-vocabulary consumer not yet updated,
owned by Task 6. This tally is a strict subset of Task 4's 59-cause discriminant (same five causes,
minus the one `toEqual` literal this task fixed). No new file or cause appears.

`npm run typecheck`: RC=2, 6 `error TS...` lines (down from Task 4's 8 -- the two
`webCcloopSmoke.test.ts` errors Task 4 flagged as owned by this task are gone). Remaining 6, all
pre-existing v1-vocabulary consumers owned by Task 6: `tests/control/planImport.test.ts` (1),
`tests/control/profiles.test.ts` (4), `tests/panel/controlReadApi.test.ts` (1). `webCcloopSmoke.test.ts`
itself: 0 typecheck errors.

## Terminal assertion evidence (Step 4)

`expect((await deliverScheduledStart(soft.deps, "g")).kind).toBe("claimed")` executed (not skipped
-- `realBinary` was set to the scratch ccloop-t1 build) and green, in both the Step 3 run above and
every M7/M8 baseline/restore run below. This is the plan's stated terminus: the real ccloop v2
answer flows through `probeProfileCapabilities()` unmodified, past `confirmedByAdapter`'s `confirm`
and `start`, to a claimed run.

## M7 / M8 mutation table

Clone: `/usr/bin/git clone --local /Users/biran/code/skills/loop/ccloop <scratchpad>/t5-ccloop-mut`,
HEAD verified `f9727a18cd4bc77ed9999068fefe2f81ab059295` (= f9727a1) immediately after clone.
`node_modules` symlinked from the main ccloop tree. Build RC=0 throughout (baseline, M7, restore,
M8, restore).

Green baseline first: `ORCA_CCLOOP_BIN=<clone>/dist/cli.js npm run verify:web-control:consumer` ->
same result as Step 3 (2 failed / 2 passed, the two named targetVersion reds only; terminal `claimed`
test green).

| Mutation | File | sha256 before | sha256 after | Product probe (`control capabilities` CLI) | Consumer gate after mutation | Which assertion reds |
|---|---|---|---|---|---|---|
| M7: `handoffControl: "durable"` -> `"phase-end"` | `src/control/command.ts` (defaultHandler's capabilities answer) | `cde02f6d12ecf909c5d6447ac3dc4542c75e54ddc1c753cfaceccb64923af123` | `e07a8cad163d490c396534fb0fa90c4bc564b5d45f665e1c05802ef84116434f` | `{"protocol":2,...,"handoffControl":"phase-end","handoffExecution":"mechanical-in-run-v1",...}` -- confirms the built product, not just the source, answers the mutated value | `3 failed | 1 passed (4)`. New red: "claims phase-end usage and soft enforcement..." -> `AssertionError: expected {...} to deeply equal {...}` at line 136 (the raw `capabilities()` literal: `- "handoffControl": "durable"` / `+ "handoffControl": "phase-end"`). Same two targetVersion reds as baseline, unchanged. | The raw literal assertion (line 136), **not** the terminal `claimed` assertion -- see isolation below. |
| M8: `handoffExecution: "mechanical-in-run-v1"` -> `null` | `src/control/command.ts` (same spot) | `cde02f6d12ecf909c5d6447ac3dc4542c75e54ddc1c753cfaceccb64923af123` | `9b31e05e9a6de6d5987efccbb39629021e2a353de89043b41c61b8cff5f05cf7` | `{"protocol":2,...,"handoffControl":"durable","handoffExecution":null,...}` | `3 failed | 1 passed (4)`. New red: same test, same assertion, `- "handoffExecution": "mechanical-in-run-v1"` / `+ "handoffExecution": null`. Same two targetVersion reds unchanged. | The raw literal assertion (line 136), **not** the terminal `claimed` assertion -- see isolation below. |

Restore (both mutations): `cat pristine > target`; sha matched pristine
(`cde02f6d12ecf909c5d6447ac3dc4542c75e54ddc1c753cfaceccb64923af123`) exactly both times; rebuild
RC=0; re-probe confirmed `handoffControl:"durable"`/`handoffExecution:"mechanical-in-run-v1"`
restored in the product. Green baseline re-run after the final (M8) restore: `2 failed | 2 passed
(4)`, identical to the original baseline (functional restore confirmed, not just byte-restore).

### Which assertion actually reds -- isolation (both mutations short-circuit before the terminus)

For **both** M7 and M8, the red in the real test is the raw `expect(capabilities).toEqual({...})`
literal at line 136 -- one assertion *before* `confirmedByAdapter`/`probeProfileCapabilities` are
even called. That assertion alone does not tell us whether the terminal `claimed` assertion is
load-bearing, since the test never reaches it.

To isolate this, I wrote a scratch diagnostic (`tests/control/scratch-t5-m7-isolate.test.ts`,
created only for this measurement, never committed, deleted immediately after use -- confirmed by
`git status --short` showing no trace of it afterward) that reproduces `confirmedByAdapter("soft",
await port.probeProfileCapabilities!())` -> `service.start(...)` -> `deliverScheduledStart(...)`,
with the raw-literal check removed and each step's result printed, so the mutation's effect could be
observed independent of that literal. I did not add this to the shipped suite: the human
authorization for this task scopes edits to `codexProbe` and its call sites plus the one literal, and
says "do not change any other test," so a new permanent criterion was out of scope. This diagnostic
is evidence-gathering only, run outside the committed file, not a proposed criterion.

Result for **both** M7 and M8: `service.start(...)` returns `{"error":{"code":
"control-capability-unsupported", ...}}` immediately -- caught by `profiledCapabilities` in
`src/control/service.ts:89`, which checks `observed.handoffControl!=="durable"||
observed.handoffExecution===null` **unconditionally** (not gated on strict vs. soft budget mode).
`deliverScheduledStart` is never called at all under either mutation.

**Conclusion: for M7 and M8 as posed, the terminal `expect(... .kind).toBe("claimed")` assertion is
not the assertion that catches the mutation, and is not exercised at all once the mutation is
present** -- two earlier gates catch it first: (1) in the real test, the raw `capabilities()` literal
at line 136; (2) even bypassing that (per the scratch harness), the `service.start()` capability gate
at `service.ts:89`, one call before `deliverScheduledStart`. The terminal assertion's load-bearing-ness
for *these two specific fields* is therefore not established by M7/M8 alone: it is `service.ts:89`
(already covered by other criteria, e.g. `webMutations.test.ts`/`estimator.test.ts`'s
`handoffControl`/`handoffExecution` tests referenced in the grep) and the raw literal that are doing
the catching. What M7/M8 *do* establish, which is still meaningful for this task's actual claim: the
mutated ccloop answer really does propagate, unaltered, all the way to the raw `capabilities()` call
and into `probeProfileCapabilities()`'s return value (the scratch probe printed
`"handoffControl":"phase-end"`/`"handoffExecution":null` verbatim) -- i.e., the pass-through this task
built is real, not a hardcode; it is a different, earlier judgment (`service.ts:89`) that happens to
also fail closed on the same mutation before dispatch, which is arguably correct defense-in-depth
but means the terminal criterion's *specific* load-bearing-ness for `handoffControl`/`handoffExecution`
remains unproven by this task's authorized scope. Flagging this as a concern below rather than
silently claiming the terminus is proven.

Main trees zero-touch throughout mutation work, confirmed after clone deletion:
`/usr/bin/git diff | wc -c` = 0 and `/usr/bin/git diff --cached | wc -c` = 0 for
`/Users/biran/code/skills/loop/ccloop`; `git status --short` there is empty. Orca's main tree shows
only the intended Step 2 diff (`tests/control/webCcloopSmoke.test.ts`, since committed) throughout;
the scratch isolation file was created and deleted entirely within `tests/control/` on the Orca main
tree (never staged, never committed) -- `git status --short` confirmed clean of it before the final
commit.

Clone deleted: `/bin/rm -f <clone>/node_modules` (symlink), then `/bin/rm -rf <clone>`. Confirmed
gone via directory listing.

## Files changed

- `/Users/biran/code/skills/loop/Orca/tests/control/webCcloopSmoke.test.ts`

## Concerns

- **M7/M8 do not prove the terminal `claimed` assertion is load-bearing for `handoffControl`/
  `handoffExecution`** -- see the isolation section above. Both mutations are caught by an earlier
  gate (`service.ts:89`, inside `service.start()`) before `deliverScheduledStart` is ever invoked, and
  in the actual shipped test, an even earlier raw-literal assertion catches it first. If a future task
  wants a mutation that specifically isolates the terminal `claimed` assertion, it would need either
  (a) a capability field the terminal assertion's gate cares about but `service.start()`'s
  `profiledCapabilities` check does not, or (b) a restructuring of the test (out of this task's
  authorized scope) that calls `deliverScheduledStart` without going through `service.start()`'s own
  capability gate. Not fixed here per Rule 3 and the narrow human authorization; surfaced for the
  controller.
- The 58 `tests/control` reds and 6 typecheck errors are exactly the Task 6 scope described in
  Task 4's report, now one smaller after this task's fix. No file outside
  `tests/control/webCcloopSmoke.test.ts` was touched by this task's committed change.
- Per Rule 3, out-of-scope reds were inspected only to classify their cause for the discriminant --
  none were fixed.

## Fix round 1 (code review)

Commit: `b8a1b71` on `main` (parent `287b502`).

**Correction note on Important #1 (does not rewrite the "Which assertion actually reds" section
above -- that section stays as originally written; this is an added correction, per the controller's
recorded ledger entry and Rule 13's "add a section, keep the original verbatim" discipline):** the
"Which assertion actually reds" section above attributes M7/M8's early catch to
`src/control/service.ts:89` (`profiledCapabilities`). That attribution is **wrong**. `service.ts`'s
`profiledCapabilities`/`ClaimWithCapabilities` path is not on `WebControlService.start()`'s call
path at all -- `WebControlService.start()` (`src/control/webService.ts:357-358`) calls
`scheduleStart()` in `src/control/webDispatch.ts` directly, never `service.ts`. The real mechanism,
confirmed by the code reviewer's X2 measurement (deleting `service.ts:89`'s clause changes nothing
for this path) and by reading `webDispatch.ts` myself in this fix round: `probeBlocksDispatch`
(`webDispatch.ts:52-60`) is called **twice** on the same underlying observation --
once inside `scheduleStart` (webDispatch.ts:86, sets `degraded`, enforced at webDispatch.ts:106 as
`control-capability-unsupported` when `WebControlService.start()` applies the command) and again
inside `deliverScheduledStart` (webDispatch.ts:166, sets `blocked`, enforced at webDispatch.ts:178-181
as `{kind:"blocked", reason:"claim-capability-unavailable"}`). Because M7/M8 degrade the same field
in the one observation both calls see, the first call (`scheduleStart`, i.e. `service.start()`)
always catches it first -- which is exactly the mechanism, not `service.ts:89` (a different, unrelated
capability gate on a different code path that this task's mutations never reached). Everywhere else
above (M7/M8 table, sha values, product probes, restore proof) is unaffected by this correction and
is left as originally written.

**Correction note on Important #2:** confirmed independently, matching the code reviewer's X1
measurement: the terminal `claimed` assertion (line 154 at the time of the original report, now
shifted by the new criterion below) was previously proven only in the positive direction --
no criterion isolated the delivery-time reject path with the real ccloop answer. Fixed by the new
criterion below.

### New only-add criterion

Added one `it.skipIf(!realBinary)` test to `tests/control/webCcloopSmoke.test.ts`, inside the
existing `describe("the shipped consumer answers for its own capabilities (task 10 step 4)", ...)`
block, right after the existing "claims phase-end usage..." test. No existing test in the file was
changed (confirmed: `git diff --stat` before commit showed `27 insertions(+)`, `0 deletions(-)`).

Before writing it, checked whether `setObserved` (called on the fixture after `confirm()`) actually
changes what `profileRouter.probe()` returns at delivery time, per the controller's instruction to
check `tests/control/fixtures/web.ts` first: `webFixture()`'s internal `port.probeProfileCapabilities`
is `async () => observed`, a closure over a `let observed` variable that `setObserved` reassigns
(`tests/control/fixtures/web.ts:26,28,68`), and `profiles.ts`'s `probe()` (`src/control/profiles.ts:147-158`)
calls `port.probeProfileCapabilities()` fresh on every invocation with no caching, then intersects
the fresh answer with the *declared* profile capabilities (`intersectCapabilities`, taking the
minimum per field). So yes -- `setObserved` after `confirm()` does change the next probe's answer,
including the delivery-time one; no fixture-side change was needed.

The new criterion: build a soft group via `confirmedByAdapter("soft", await
port.probeProfileCapabilities!())` from a freshly constructed real-binary port; assert
`soft.service.start(...)` succeeds (schedules cleanly on the real, undegraded answer -- exercises
the *first* `probeBlocksDispatch` call and confirms it does not block); then call
`soft.f.setObserved({ ...realProbe, handoffControl: "phase-end" })` to degrade only what the fixture's
port answers on its *next* probe; then call `deliverScheduledStart(soft.deps, "g")` and assert both
(a) the exact result value, measured first (see below) then pinned as a literal, and (b) a positive
observation that no run was created: `SELECT COUNT(*) AS n FROM runs WHERE group_id='g'` = 0.

Measured (not guessed) before pinning: ran the new test once against the real `ccloop-t1` binary
before touching `deliverScheduledStart` at all -- it passed on the first try, printing/asserting
`delivered` equal to `{ kind: "blocked", reason: "claim-capability-unavailable" }`. That is the
literal now pinned in the criterion.

### Gate re-run (Step 3 equivalent)

`npm run verify:web-control:consumer` (same env as before): `Tests 2 failed | 3 passed (5)`, RC=1.
The 2 reds are exactly the two named `start-envelope-conflict:run:targetVersion` failures,
unchanged. All 3 green tests include the new criterion. Matches the controller's stated expectation
exactly ("2 targetVersion reds, 3 green now").

`npm run typecheck`: RC=2, still 6 `error TS...` lines, 0 of them referencing `webCcloopSmoke.test.ts`
(confirmed by grepping the log for the filename: no matches) -- the new criterion introduced no new
typecheck error.

### X3 mutation (clone at commit `b8a1b71`, `git clone --local`, `node_modules` symlinked, main
tree untouched throughout)

Clone: `/private/tmp/.../scratchpad/x3-orca-mut`, HEAD verified `b8a1b71...` immediately after
clone. Green baseline first: `ORCA_CCLOOP_BIN=<ccloop-t1>/dist/cli.js
node_modules/.bin/vitest run tests/control/webCcloopSmoke.test.ts` (via `npx vitest`) -> `Tests 2
failed | 3 passed (5)`, RC=1 -- identical to main.

Mutation: in `src/control/webDispatch.ts`, `deliverScheduledStart`, right after
`blocked = observations.some((observation) => probeBlocksDispatch(observation, snapshot.budgetMode));`
(line 166), inserted `blocked = false;` -- making `deliverScheduledStart` ignore
`probeBlocksDispatch` entirely regardless of what the second probe call observes.

sha256 before: `644d6c6f9dbfd9c09a1b734ff018d3a2795216c84d29dd89bb16b52cbf853e4b`.
sha256 after: `9f350d0b1205a3ebddb18d3e5ea0537519fb27af582b877357228e0b63224654`. Differ: yes.

Consumer-file result after mutation: `Tests 3 failed | 2 passed (5)`, RC=1. The new criterion
("blocks only at delivery when the observation degrades after a clean schedule") is the one that
reds; the two named targetVersion reds are unchanged and still red. **Exact failing assertion:**
`expect(delivered).toEqual({ kind: "blocked", reason: "claim-capability-unavailable" })` (the
terminal, second assertion in the new criterion) --

```
- Expected
+ Received
  Object {
-   "kind": "blocked",
-   "reason": "claim-capability-unavailable",
+   "kind": "claimed",
+   "runId": "run-49f83563-7887-489d-a0fb-9d41893611dd",
  }
```

i.e. under X3 the delivery actually claims and creates a run, which the new criterion's terminal
assertion catches directly -- this time the terminal-type assertion in the new test is the one that
reds, not an earlier one (there is no earlier capability-check assertion in this criterion to
short-circuit ahead of it; the only earlier assertion, `expect("error" in await soft.service.start(...)).toBe(false)`,
passes under X3 exactly as it does at baseline, since X3 only touches `deliverScheduledStart`, not
`scheduleStart`).

**Whole-`tests/control` run under X3**, to see whether the delivery-time guard had any prior
criterion: ran `tests/control` at baseline (pristine, in the same clone) and again under the X3
mutation, then diffed the sets of failing test names in Python (not grep). Baseline: `58 failed | 378
passed (436)`. Mutated: `61 failed | 375 passed (436)`. Exactly 3 new reds, 0 baseline reds fixed by
the mutation:

- `the shipped consumer answers for its own capabilities (task 10 step 4) > blocks only at delivery
  when the observation degrades after a clean schedule` -- the new criterion (this fix round).
- `continuation claim, lineage, and re-arm > leaves the registered pending run id and ordinal
  untouched when the pre-claim probe fails` (`tests/control/webContinuation.test.ts:438`) --
  pre-existing criterion.
- `inverted invariants (task 10 step 3) > gates a strict claim on proof the profile cannot produce,
  while soft mode keeps claiming` (`tests/control/webMutations.test.ts:110`) -- pre-existing
  criterion.

So the delivery-time guard was **not** entirely uncovered before this fix round -- two pre-existing
tests already exercised `deliverScheduledStart`'s own `probeBlocksDispatch` call (one via a probe
failure, one via synthetic/mock capabilities). What was missing, and what this fix round adds, is a
criterion that isolates that same guard using the **real ccloop binary's own answer**, degraded
between a real schedule and a real delivery -- consistent with this task's overall point (feed the
real answer through, don't borrow/synthesize).

Restore: `cat pristine > target`; sha matched pristine (`644d6c6f9dbfd9c09a1b734ff018d3a2795216c84d29dd89bb16b52cbf853e4b`)
exactly. Clone deleted: `/bin/rm -f <clone>/node_modules` (symlink) then `/bin/rm -rf <clone>`.
Confirmed gone via directory listing.

Main tree (Orca) zero-touch throughout: `/usr/bin/git diff | wc -c` = 0 and
`/usr/bin/git diff --cached | wc -c` = 0, checked immediately before and after the clone's mutation
work and again after clone deletion; `git status --short` empty throughout except for the
intentional, already-committed new-criterion change.

### M7 after-sha re-verification

Re-checked the M7 "sha256 after" value already recorded in the mutation table above
(`e07a8cad163d490c396534fb0fa90c4bc564b5d45f665e1c05802ef84116434f`) against the controller's stated
correct value, character-for-character (Python `==` comparison, both 64 hex characters): they are
identical. No change was needed in the table; recording this verification here per the controller's
instruction, without editing the original table (Rule 13).

### Final re-run

`npm run verify:web-control:consumer` on the main tree (post-commit, post-clone-deletion): `Tests 2
failed | 3 passed (5)`, RC=1 -- same as the gate re-run above, confirming the committed state matches
what was measured.

### Files changed (this fix round)

- `/Users/biran/code/skills/loop/Orca/tests/control/webCcloopSmoke.test.ts` (one new `it`, no
  existing test changed)

### Concerns (this fix round)

- None new beyond the corrections above. The M7/M8 concern from the original report (that those two
  mutations alone do not isolate the terminal `claimed` assertion) is now addressed by the new
  criterion, which does isolate the delivery-time guard specifically -- but M7/M8 themselves remain
  mutations of the *schedule-time* path (`scheduleStart`, via `service.start()`), and are correctly
  described that way now that the `service.ts:89` misattribution is corrected.

## Fix round 2 (code review)

Commit: `2040f77` on `main` (parent `b8a1b71`).

**Finding:** the new only-add criterion's comment (added in Fix round 1) opened with "Human
authorization 2026-09-24, G1 seam A Task 5 fix round 1...". That attribution was false: the human
never saw or approved this test. It was added under a **controller ruling** ("add ONE only-add
criterion...", relayed in Fix round 1's instructions), and an only-add criterion -- unlike the
rewrites of `codexProbe`/its call sites/the one literal in Task 5's original scope, which genuinely
did carry human sign-off -- needs no human authorization at all. Claiming human authority for
something the human never saw is exactly what this repo's attribution discipline forbids.

**Change:** comment-only, one line, in `tests/control/webCcloopSmoke.test.ts`. Replaced:
```
- // Human authorization 2026-09-24, G1 seam A Task 5 fix round 1 (only-add, no existing criterion
+ // Controller ruling (G1 seam A Task 5 fix round 1, 2026-09-24; only-add, no existing criterion
```
Rest of the comment (the `probeBlocksDispatch` explanation) is byte-for-byte unchanged. Confirmed via
`git diff`: `1 file changed, 1 insertion(+), 1 deletion(-)`, and confirmed no other occurrence of the
old text remains in the file.

**Re-run** (same env as before, `ORCA_CCLOOP_BIN=<scratchpad>/ccloop-t1/dist/cli.js`,
`ORCA_CCLOOP_ADAPTER_CONFIG=<scratchpad>/fixtures/fake-codex-config.json`, redirected to file, `RC=$?`
appended, read whole): `npm run verify:web-control:consumer` -> `Tests 2 failed | 3 passed (5)`,
RC=1. Identical to the Fix round 1 result (the two named `targetVersion` reds only; the new criterion
still green) -- expected, since this was a comment-only change.

No mutations run this round (the controller is re-running X3 independently, per instruction).

### Files changed (this fix round)

- `/Users/biran/code/skills/loop/Orca/tests/control/webCcloopSmoke.test.ts` (comment text only)

### Concerns (this fix round)

- None new.
