# Task 4 report: Orca port pass-through + published ERRATUM (G1 seam A)

Commit: `67890cf6f459f43e4df7ba0d6950be680d1af795` on `main` (parent `68f8c37`).
Not pushed, not merged, no branches/worktrees touched or deleted.

## Changes

1. `src/control/ccloopPort.ts` -- `probeProfileCapabilities()` rewritten (per the controller's
   ruling): parses the peer's answer with `capabilitiesSchema` (already v2-tagged, Task 2), strips
   `protocol`, and returns the rest unchanged:
   ```ts
   async probeProfileCapabilities(){
    const {protocol:_protocol,...view}=parse(capabilitiesSchema,await raw("capabilities",{})) as Capabilities;
    return view;
   },
   ```
   This removes the dead `stated.budgetEnforcement==="unsupported"?"unavailable":...` translation
   flagged as a stale/wrong comparison in Task 3's report (never a valid enum member, `TS2367`) and
   the four hardcoded `unavailable`/`null` fields the pre-G1 code invented.

2. `src/control/ccloopPort.ts` -- appended an ERRATUM at the end of the existing long JSDoc block
   above `probeProfileCapabilities`, exactly the brief's text, original comment preserved
   byte-for-byte (proof below).

3. `tests/control/fixtures/fake-ccloop-control.mjs` (pulled forward from Task 5 Step 1, per
   controller ruling): the fake ccloop binary's `caps` now defaults to the v2 shape ccloop really
   answers --
   `{protocol:2,usageObservation:"phase-end",budgetEnforcement:"soft",contextObservation:"unavailable",handoffControl:"durable",handoffExecution:"mechanical-in-run-v1",contextWindowTokens:null,requestBoundProof:null}`
   -- and accepts an optional `config.capabilities` (whole object) override.

4. `tests/control/ccloopPort.test.ts` -- three existing criteria rewritten under the 2026-09-24
   human authorization (English comment naming it in each), plus one new criterion added alongside
   the rewrite of ①, per the controller's ruling that the "must not invent" pin needs its own
   `fixture` call to tell pass-through apart from a hardcode:
   - ① `it("states only what ccloop states, and says unavailable for the rest rather than inventing it")`
     -> renamed `it("passes the peer's own v2 answer through, substituting nothing")`, now asserts
     the pass-through of the v2 default (`handoffControl:"durable"`, `handoffExecution:"mechanical-in-run-v1"`
     instead of `"unavailable"`/`null`).
   - New: `it("does not invent a substitute source for a peer's observation -- an overridden field
     passes through unchanged")` -- fixture answers `handoffControl:"phase-end"` via the new
     `config.capabilities` override; asserts the probe returns `"phase-end"`, not `"durable"`. This
     is the criterion that actually distinguishes pass-through from a hardcode that happens to match
     the default (M6b below).
   - ② `it("therefore fails a claim closed on capabilities, which is the accurate answer until
     ccloop grows the probe")` -> renamed `it("therefore, with a peer answering the v2 default,
     keeps handoffControl durable and handoffExecution non-null through intersectCapabilities")`.
     Still an observation of the real port through the fake binary (not a synthetic
     `intersectCapabilities` unit test); now asserts `handoffControl === "durable"` and
     `handoffExecution !== null` instead of `"unavailable"`/`null`.
   - ③ `it("uses direct argv plus stdin JSON and validates successful responses")` -- only the
     `protocol` expectation moved from `1` to `2`; everything else in that test (accept/argv/stdin
     assertions) is untouched.
   - No other existing test in this file was touched.

## ERRATUM byte-preservation proof

Method: captured the file after the Step-3 implementation edit but before the ERRATUM insertion
(`/private/tmp/.../scratchpad/ccloopPort.before.ts`), then compared against the final file with a
Python script (not grep/sed) that:
- extracts the original JSDoc's content lines (47-63 in the "before" snapshot, i.e. everything up
  to but excluding the closing `*/`, since the ERRATUM is inserted before that line),
- confirms that exact byte sequence appears unchanged, at the same starting line (47), in the
  final file,
- confirms the original closing `*/` line still exists in the final file, now after the ERRATUM,
  and occurs exactly once.

Result: `Byte-for-byte present in after file, unchanged: True`, `Starts at after-file line: 47`,
`Closing line ... Occurs in after file: True`, `Occurrence count in after file: 1`.

## RED -> GREEN

Pre-Task-4 state (at commit `68f8c37`, per Task 3's report): the fake binary answered v1-shaped
literals, so `probeProfileCapabilities()`/`capabilities()` both failed to parse against the already
v2 `capabilitiesSchema`, throwing `control-response-invalid` -- `ccloopPort.test.ts` contributed 3
of Task 3's 63 reds for that reason (plus the router-probe test would also have surfaced a non-null
`probeFailureCode`).

Post-Task-4: `tests/control/ccloopPort.test.ts` -- 8/8 green (see full run below). All three
rewritten/renamed criteria and the new criterion pass against the real port and the updated fake
binary.

## M6 / M6b mutation table (clone at commit `67890cf`, `git clone --local`, `node_modules` +
`web/node_modules` symlinked, main tree untouched throughout)

Clone: `/private/tmp/claude-501/.../scratchpad/t4-mut`. Green baseline first:
`node_modules/.bin/vitest run tests/control/ccloopPort.test.ts` -> `Tests 8 passed (8)`, RC=0.

| Mutation | sha256 before | sha256 after | Differ? | Result |
|---|---|---|---|---|
| M6: `return view;` -> `return {...view,handoffControl:"unavailable" as const};` | `2755c01f4e98c492582dd70276c5c74304c4c4797cc2be22e65270504d7bc8f2` | `0ac9e74e9d073b69ffc71b8adb94820914f161f3a7ebfb130301d94d15cca0f4` | yes | `Tests 3 failed \| 5 passed (8)`. Reds: "passes the peer's own v2 answer through, substituting nothing" (expected `"durable"`, got `"unavailable"`), "does not invent a substitute source..." (expected `"phase-end"`, got `"unavailable"`), and the intersectCapabilities observation (expected `"durable"`, got `"unavailable"`). Restored via `cat pristine > target`; sha matches before (`2755c01f...` == pristine, verified equal). |
| M6b: `return view;` -> `return {...view,handoffControl:"durable" as const};` (hardcode matching the v2 default) | `2755c01f4e98c492582dd70276c5c74304c4c4797cc2be22e65270504d7bc8f2` | `3f4fcef9bf8736f6f8bd3496f065fc587e9fa2639e23bdcd8244ca7eb7af4321` | yes | `Tests 1 failed \| 7 passed (8)`. Exactly one red: "does not invent a substitute source for a peer's observation -- an overridden field passes through unchanged" (expected `"phase-end"`, got `"durable"`). The plain pass-through test and the intersectCapabilities observation both stayed green -- this is the criterion that actually tells a pass-through apart from a hardcode coincidentally matching the default. Restored via `cat pristine > target`; sha matches before (verified equal via Python comparison). |

After the final restore, re-ran `tests/control/ccloopPort.test.ts` in the clone: `Tests 8 passed
(8)`, RC=0 (confirms the restore is functionally, not just byte-, correct).

Clone deleted afterward: `/bin/rm -f` the two `node_modules` symlinks, then `/bin/rm -rf` the clone
directory. Main tree zero-touch confirmed before and after the whole mutation sequence:
`/usr/bin/git diff | wc -c` = 0 and `/usr/bin/git diff --cached | wc -c` = 0 (checked immediately
after clone deletion).

## `tests/control` full run (post-implementation, at commit `67890cf`)

Command (per controller ruling, using the same env as Task 3 for comparable skip counts):
```
ORCA_CCLOOP_BIN=/private/tmp/.../scratchpad/ccloop-t1/dist/cli.js \
ORCA_CCLOOP_ADAPTER_CONFIG=/private/tmp/.../scratchpad/fixtures/fake-codex-config.json \
node_modules/.bin/vitest run tests/control > <file> 2>&1; echo "RC=$?" >> <file>
```
Redirected to file, read whole (never piped through grep/tail/head), parsed with Python.

Result: `Test Files 14 failed | 30 passed (44)` / `Tests 59 failed | 376 passed (435)`, RC=1.

59 <= Task 3's baseline of 63 (net -4, all four of them `tests/control/ccloopPort.test.ts` failures
this task fixed). `tests/control/ccloopPort.test.ts` itself: 8/8 green, 0 reds.

### Per-cause tally (parsed with Python; every FAIL header attributed to its error, including
`it.each`/grouped headers that share one printed error banner with the block that follows them --
noted in the brief as a real vitest quirk, confirmed present again here)

| Cause | Count |
|---|---|
| `ControlError: control-capability-unsupported` (peer/fixture still answers v1-shaped `capabilities()`; Task 3's `fakePeer`/`archive.ts`/`candidate.ts`-based tests) | 51 |
| `AssertionError`: test expected a different error code (`start-outcome-unknown`, `group-stopped`) but got `control-capability-unsupported` -- downstream cascade of the same v1-fixture root cause, one hop further (`dispatch.test.ts`, `projectionJournal.test.ts`) | 3 |
| `AssertionError`: `webCcloopSmoke.test.ts`'s own `toEqual({protocol:1,...})` assertion against Codex's real (now v2) answer -- a literal v1-vocabulary consumer, named in Task 3's report as "expected to move in a later task" | 1 |
| `ControlError: start-intent-missing` -- same v1-fixture root cause, downstream (`dispatch.test.ts`) | 2 |
| `ControlError: start-envelope-conflict:run:targetVersion` -- the two named, pre-existing `webCcloopSmoke.test.ts` reds the controller called out in advance, unrelated to capabilities | 2 |
| **Total** | **59** |

Per-file breakdown (all 14 failing files are a strict subset of the 15 files in Task 3's list, minus
`ccloopPort.test.ts` which this task fixed): `archive.test.ts`(2), `checkpointRecoverability.test.ts`(6),
`checkpoints.test.ts`(9), `cleanup.test.ts`(2), `continuation.test.ts`(3), `dispatch.test.ts`(5),
`endToEnd.test.ts`(4), `finalReview.test.ts`(7), `handoff.test.ts`(5), `handoffTransaction.test.ts`(3),
`projectionJournal.test.ts`(2), `resumeBundle.test.ts`(5), `snapshot.test.ts`(3),
`webCcloopSmoke.test.ts`(3). Sums to 59.

Discriminant satisfied: every one of the 59 reds is either (a) one of the two named
`start-envelope-conflict:run:targetVersion` reds, or (b) traceable to a v1-vocabulary consumer
(fixture, fake peer, or literal assertion) not yet updated -- owned by Tasks 5/6. No new file or
cause appears that wasn't already in Task 3's 63-red discriminant. No red falls outside it.

Note: Task 3's baseline reported 3 skipped tests (`... | 3 skipped (434)`); this run shows 0 skipped
(435 total, one more than 434 because this task added one test). Not investigated further -- out of
this task's scope, and not part of the required discriminant (the tally above accounts for all 59
observed failures exactly).

## `npm run typecheck`

`RC=2`, 8 `error TS...` lines (down from Task 3's 9 -- the `ccloopPort.ts:69` stale `"unsupported"`
comparison Task 3 flagged as a concern is gone along with the code it lived in). **`ccloopPort.ts`
has zero typecheck errors**, confirmed by filtering the 8 error lines for the filename (0 matches).

Remaining 8, all pre-existing v1-vocabulary consumers owned by Tasks 5/6:
- `tests/control/planImport.test.ts` (1)
- `tests/control/profiles.test.ts` (4)
- `tests/control/webCcloopSmoke.test.ts` (2)
- `tests/panel/controlReadApi.test.ts` (1)

## Files changed

- `/Users/biran/code/skills/loop/Orca/src/control/ccloopPort.ts`
- `/Users/biran/code/skills/loop/Orca/tests/control/ccloopPort.test.ts`
- `/Users/biran/code/skills/loop/Orca/tests/control/fixtures/fake-ccloop-control.mjs`

## Concerns

- None new. Task 3's flagged concern (the stale `"unsupported"` comparison in `ccloopPort.ts:69`)
  is resolved by this task's rewrite, as anticipated in that report.
- The remaining 59 `tests/control` reds and 8 typecheck errors are exactly the "Tasks 5/6" scope the
  brief described; no file outside `ccloopPort.ts`, `ccloopPort.test.ts`, and
  `fake-ccloop-control.mjs` was touched by this task.
- Per Rule 3, out-of-scope reds were inspected only to classify their cause for the discriminant --
  none were fixed.

## Fix round 1 (code review, Important #1)

Commit: `a6f8365eab2d4bb185026cd2a23447de39fb2af1` on `main` (parent `67890cf`).

**Finding (verbatim):** "`src/control/ccloopPort.ts:66` (inside the appended ERRATUM): the ERRATUM
states the pass-through rule is 'now enforced by a criterion in `tests/control/profiles.test.ts`'
but the actual enforcing tests live in `tests/control/ccloopPort.test.ts` (per the controller's P5
ruling). A future maintainer goes to profiles.test.ts, doesn't find it, and wrongly concludes the
rule is unenforced."

**Why the stale reference wasn't surfaced by me at the time (fail-loud gap):** the ERRATUM text was
copied from the brief verbatim (per Step 4's instruction, "use the brief's text verbatim"), and the
brief's example text was written before the controller's P5 ruling redirected the new criteria from
`profiles.test.ts` (which the brief originally named throughout, e.g. its own Step 1 code sample)
into `ccloopPort.test.ts`. When I applied P5 and wrote the actual tests into `ccloopPort.test.ts`, I
did not re-check the ERRATUM prose -- which I was separately treating as "copy verbatim, do not
edit" -- against that same ruling. That was the miss: "copy verbatim" applied to the brief's
*wording*, not to a *factual claim inside that wording* (which file enforces the rule) that a prior
ruling in the same task had already superseded. Nothing failed loudly because the ERRATUM's prose is
not executable -- there is no test that checks a JSDoc comment's file reference against the actual
test suite -- so a stale pointer here has no mechanism to turn red on its own; it can only be caught
by a reader (or a review pass) cross-checking prose against code, which is exactly what caught it.

**Change:** only the two lines naming the enforcing file, inside the ERRATUM, inside
`src/control/ccloopPort.ts`. Corrected `tests/control/profiles.test.ts` -> `tests/control/ccloopPort.test.ts`,
and added the exact criterion name (`"does not invent a substitute source for a peer's observation
-- an overridden field passes through unchanged"`) so the reference survives a future rename of
neighboring tests without going stale the same way again. All other ERRATUM text, and the entire
original JSDoc block above it, byte-for-byte unchanged.

**Byte-preservation re-proof (against the true pre-Task-4 original, commit `68f8c37`, not just the
prior state):** `/usr/bin/git show 68f8c37:src/control/ccloopPort.ts` extracted to a scratch file;
Python comparison (not grep/sed) of that commit's JSDoc content lines (47-63, i.e. up to but
excluding the closing `*/`) against the current file:
```
Original (68f8c37) content block: lines 47 - 63 = 17 lines
Byte-for-byte present in current file, unchanged: True
Starts at current-file line: 47
Closing line from 68f8c37 (line 64): '   */\n'
Occurs in current file: True
Occurrence count in current file: 1
```

**Test re-run** (same env as the original Step 5/M6 verification):
```
ORCA_CCLOOP_BIN=<scratchpad>/ccloop-t1/dist/cli.js \
ORCA_CCLOOP_ADAPTER_CONFIG=<scratchpad>/fixtures/fake-codex-config.json \
node_modules/.bin/vitest run tests/control/ccloopPort.test.ts > <file> 2>&1; echo "RC=$?" >> <file>
```
Result: `Test Files 1 passed (1)` / `Tests 8 passed (8)`, RC=0. Unchanged from before the fix (the
change is comment-only, no behavioral edit).

**Typecheck re-run:** `npm run typecheck > <file> 2>&1; echo "RC=$?" >> <file>`. Result: RC=2, 8
`error TS...` lines (same 8 as before the fix, parsed with Python), 0 of them in `ccloopPort.ts`.
Unchanged, as expected for a comment-only edit.

**Diff (full, scoped to the two corrected lines):**
```diff
-   * unchanged and is now enforced by a criterion in `tests/control/profiles.test.ts` rather than
-   * by hardcoded `unavailable`s. See docs/superpowers/specs/2026-09-24-g1-control-wire-contract-design.md
-   * in the ccloop repository.
+   * unchanged and is now enforced by a criterion in `tests/control/ccloopPort.test.ts`
+   * ("does not invent a substitute source for a peer's observation -- an overridden field passes
+   * through unchanged") rather than by hardcoded `unavailable`s. See
+   * docs/superpowers/specs/2026-09-24-g1-control-wire-contract-design.md in the ccloop repository.
```

**Files changed:** `/Users/biran/code/skills/loop/Orca/src/control/ccloopPort.ts` (comment only).

**Concerns:** none new.
