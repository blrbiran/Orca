# Task 7 report — run-id allocation (S15)

Commit: `4fe2ba1` — `feat(scheduler): allocate run ids with mkdir's atomicity, no database`

## What was implemented

`src/scheduler/runId.ts`, split per Ruling R5:

- `deriveRunId(taskId, contractBytes, baseCommit): string` — pure, no I/O.
  Shape `orca-<taskId>-<hash8>` (spec §2.1), where `hash8` is the first 8 hex
  chars of `sha256(contractBytes ‖ 0x00 ‖ baseCommit)`. The `0x00` separator
  keeps the two inputs from being hash-ambiguous with each other. Same three
  inputs always produce the same string; nothing else does.
- `allocateRunId(runsDir, taskId, contractBytes, baseCommit): Promise<string>`
  — calls `deriveRunId`, then claims `<runsDir>/<id>` with a non-recursive
  `mkdir`. On `EEXIST` it retries with `-2`, `-3`, ... appended to the base id.

No `.claims/` sidecar, lock file, or database, per the brief's warning and
spec §2.2.1's measurement that ccloop's own `ensureFreshRunDir` is a
recursive `mkdir` that does not reject an existing empty directory.

## Task-id / ledger-validator decision

`src/ledger/writer.ts`'s `appendEvent` validates run ids against
`/^[A-Za-z0-9][A-Za-z0-9._-]*$/` and throws on anything else. A `taskId` from
a plan file is only constrained to be a non-empty string, so one containing
a slash, a space, or a leading dot would otherwise produce a run id that
allocates fine here and only fails later, far away, on the run's first
`appendEvent` call.

**Decision: reject loudly at allocation time, do not sanitise.** `deriveRunId`
checks `taskId` against the identical character class the ledger writer uses
(duplicated as a local `TASK_ID_SAFE` constant — not imported, since this
task must not touch `src/ledger/**`) and throws
`orca: task id "..." would produce a run id the ledger writer rejects (must
match ...)` before doing any hashing or I/O. Because the constructed id is
always `orca-` + taskId + `-` + hex digits, and `orca-` and the hex suffix are
themselves always legal under that character class, a taskId that passes this
check guarantees the whole run id is legal too — this was checked by
construction, not asserted separately. Sanitising instead (e.g. stripping
illegal characters) was rejected: CLAUDE.md's context note explicitly warns
against letting an id silently diverge from the taskId it names without
saying so in the returned value or an error, and a mangled id would also
break the "same inputs ⇒ same id" determinism guarantee if two different
illegal taskIds sanitised to the same string.

## TDD evidence

**RED** — before `src/scheduler/runId.ts` existed:

```
$ npx vitest run tests/scheduler/runId.test.ts tests/scheduler/scenarios/S15.test.ts
...
FAIL  tests/scheduler/runId.test.ts [ tests/scheduler/runId.test.ts ]
Error: Failed to load url ../../src/scheduler/runId.js (resolved id: ../../src/scheduler/runId.js) in
  /Users/biran/code/skills/loop/Orca/tests/scheduler/runId.test.ts. Does the file exist?
FAIL  tests/scheduler/scenarios/S15.test.ts [ tests/scheduler/scenarios/S15.test.ts ]
Error: Failed to load url ../../../src/scheduler/runId.js ...
Test Files  2 failed (2)
     Tests  no tests
```

Expected: both suites fail to even collect, because the module under test
does not exist yet. Real output confirms it — this was seen, not assumed.

**GREEN** — after implementing `runId.ts`:

```
$ npx vitest run tests/scheduler/runId.test.ts tests/scheduler/scenarios/S15.test.ts
 ✓ tests/scheduler/runId.test.ts (4 tests) 3ms
 ✓ tests/scheduler/scenarios/S15.test.ts (2 tests) 165ms
Test Files  2 passed (2)
     Tests  6 passed (6)
```

**Full verify**, commit `4fe2ba1`:

```
$ npm run verify
...
Test Files  24 passed (24)
     Tests  187 passed (187)
...
.decisions/orca-dev-09cc3ea1.jsonl:8-14: downgraded to tier 0: taskId: Required; runId: Required
  (seven lines — the documented, by-design historical-record downgrade)
...
$ npm run verify:scheduler
Test Files  17 passed (17)
     Tests  68 passed (68)
```
Exit code: 0. Every earlier task's scenario (S17, S18, S19, S21, S22, the
plan/preflight wiring tests, sandbox.test.ts, all pure-layer tests) still
passes alongside the six new tests.

## Mutation M-ID

Target: delete the `EEXIST` increment in `allocateRunId`'s catch block, fed
by S15 (per the brief's Step 5).

Procedure, per CLAUDE.md Rule 15: mutation only in a `git clone --local`
copy of the just-committed state, main worktree never touched.

1. Committed the three new files first (`4fe2ba1`) so the clone would carry
   them.
2. Recorded pre-mutation hashes of the main worktree's three files:
   ```
   $ shasum -a 256 src/scheduler/runId.ts tests/scheduler/runId.test.ts tests/scheduler/scenarios/S15.test.ts
   7a96a1fe238ff2777c6a4aac5366f7654f8e3a60c7f4dc8523c5b691489a6e3f  src/scheduler/runId.ts
   44df43dff5d9fd2fce70001df079b023ee835479294b11e1c8c3667deea086af  tests/scheduler/runId.test.ts
   09629e4ae214d75e407f86e45cd76330a2a2b05aba9d6e1d0e93d14b88fe706e  tests/scheduler/scenarios/S15.test.ts
   ```
3. `git clone --local /Users/biran/code/skills/loop/Orca <scratchpad>/orca-mutate-runid`,
   symlinked its `node_modules` to the main tree's.
4. Applied the mutation in the clone. Literal patch:
   ```diff
   diff --git a/src/scheduler/runId.ts b/src/scheduler/runId.ts
   index ba21820..a373a11 100644
   --- a/src/scheduler/runId.ts
   +++ b/src/scheduler/runId.ts
   @@ -82,7 +82,6 @@ export async function allocateRunId(
          await mkdir(join(runsDir, candidate));
          return candidate;
        } catch (err) {
   -      if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
          throw err;
        }
      }
   ```
5. Ran S15 against the mutated clone:
   ```
   $ npx vitest run tests/scheduler/scenarios/S15.test.ts
   ❯ tests/scheduler/scenarios/S15.test.ts (2 tests | 2 failed) 156ms
     × S15: running the same plan twice allocates a fresh id instead of colliding
       → EEXIST: file already exists, mkdir '.../runs/orca-T1-b8742204'
     × steps past a directory left behind by a crashed earlier run
       → EEXIST: file already exists, mkdir '.../runs/orca-T1-b8742204'
   Test Files  1 failed (1)
        Tests  2 failed (2)
   ```
   Both S15 criteria go red, and go red for the mutated reason (the raw
   `EEXIST` from `mkdir` now propagates instead of being retried) — this was
   seen, not assumed.
6. Removed the symlink (`/bin/rm -f`), then deleted the clone
   (`/bin/rm -rf <scratchpad>/orca-mutate-runid`).
7. Re-hashed the main worktree's three files — identical to step 2:
   ```
   $ shasum -a 256 src/scheduler/runId.ts tests/scheduler/runId.test.ts tests/scheduler/scenarios/S15.test.ts
   7a96a1fe238ff2777c6a4aac5366f7654f8e3a60c7f4dc8523c5b691489a6e3f  src/scheduler/runId.ts
   44df43dff5d9fd2fce70001df079b023ee835479294b11e1c8c3667deea086af  tests/scheduler/runId.test.ts
   09629e4ae214d75e407f86e45cd76330a2a2b05aba9d6e1d0e93d14b88fe706e  tests/scheduler/scenarios/S15.test.ts
   $ diff pre-mutation-runid.sha256 post-mutation-runid.sha256   # exit 0, no output
   ```
   The main worktree was never touched by the mutation.

## Files changed

- `src/scheduler/runId.ts` (new) — `deriveRunId`, `allocateRunId`.
- `tests/scheduler/runId.test.ts` (new) — the determinism criterion, plus
  two extra sanity checks (contract-bytes-changes, base-commit-changes both
  change the id) and the task-id-rejection criterion.
- `tests/scheduler/scenarios/S15.test.ts` (new) — the S15 collision scenario
  and the crashed-run-directory scenario.
- No changes to `sandbox.ts` — this task needed no new test helper; the
  existing `makeSandbox()` already provides a bare `runsDir` with no git
  repo required for these tests.
- No changes to `src/ledger/**`, `scripts/githooks/**`, `.decisions/**`, or
  any existing CLI subcommand.

## Self-review findings

- Checked for the "assertion before the call it means to test" shape: none
  present. In the crashed-run test, the pre-existing directory + file are
  test *setup* simulating a crash (written before the call, as they must be
  to simulate a pre-existing state) — the assertion itself is `expect(await
  allocateRunId(...)).not.toBe(expectedId)`, strictly after the call under
  test.
- Checked that no test leaves a directory another test could step past:
  every test uses a fresh `makeSandbox()` per test with `s.cleanup()` in a
  `finally`, so nothing persists across test boundaries or execution order.
- Checked each criterion's stated purpose against what it actually measures:
  the determinism test measures `deriveRunId` purity directly (same call,
  same inputs, compared outputs) without going through `allocateRunId` or
  disk state; S15 and the crash test both call `allocateRunId` and assert on
  its return value, matching their stated purpose.
- Verified the `taskId` guarantee "any taskId that passes the check produces
  a legal run id" by construction (the character class is closed under the
  `orca-`/`-hex` concatenation), rather than adding a second regex check on
  the final string — simpler, and avoids a second place this invariant could
  drift out of sync.

## Concerns

None. All three brief criteria pass, `npm run verify` exits 0 with the
expected seven `downgraded to tier 0` lines, the M-ID mutation was seen red
for the correct reason, and the main worktree was proven byte-identical
after the mutation exercise.

---

# Fix round 1

Commit: `50e2b8a` — `fix(scheduler): share the run-id character class with the ledger writer, cap the allocate retry`

The coordinator's ruling on the review's Important finding: export `RUN_ID`
from `src/ledger/writer.ts` and import it in `runId.ts` instead of the
hand-copied regex — rejecting the reviewer's proposed source-text-comparison
test as detecting drift rather than preventing it. Folded in, same round,
the Minor finding on the unbounded retry loop.

## Change 1 — shared, not mirrored, character class

`src/ledger/writer.ts`: added `export` to the existing `RUN_ID` const,
nothing else — additive, no behaviour change, cannot break any existing
ledger criterion. Comment above it now explains why it is exported (so
subsystem C's allocator can check against the same constraint instead of
duplicating the pattern).

`src/scheduler/runId.ts`: imports `RUN_ID` from `../ledger/writer.js`,
deleted the local hand-copied regex literal. Kept the local name
`TASK_ID_SAFE` as an alias (`const TASK_ID_SAFE = RUN_ID;`) so the call site
inside `deriveRunId` still reads as "is this taskId safe" rather than
re-deriving that meaning from the ledger's own name at every use. Rewrote
the comment above it to say the constraint is shared, not mirrored, and to
name the fix-round finding it responds to.

## Change 2 — a new, load-bearing criterion

With the duplication gone, the taskId input check no longer proves anything
about the *id actually produced* — the `orca-` prefix, the `-<hash8>` suffix,
and (on collision) the `-<n>` increment are all characters the template adds
after the check has already passed. Added two assertions, per the ruling's
instruction to test what these functions produce rather than what they
accept:

- `tests/scheduler/runId.test.ts`, new test: `deriveRunId("t.1-a", ...)` — a
  taskId containing both a dot and a hyphen, the two separator characters the
  id template itself also uses — asserted with `expect(id).toMatch(RUN_ID)`.
- `tests/scheduler/scenarios/S15.test.ts`: added `expect(b).toMatch(RUN_ID)`
  to the existing S15 test, on `b`, the `-2` incremented id `allocateRunId`
  returns on collision.

Both import `RUN_ID` from `../../src/ledger/writer.js` (and
`../../../src/ledger/writer.js` for the scenario file) rather than
re-typing the pattern in test code either.

## Change 3 — capped retry loop

`allocateRunId`'s `for (let attempt = 1; ; attempt++)` became
`for (let attempt = 1; attempt <= MAX_ALLOCATE_ATTEMPTS; attempt++)` with
`MAX_ALLOCATE_ATTEMPTS = 1000`. On exhaustion it throws a named error citing
`runsDir` and the last candidate tried, rather than returning `undefined` or
looping forever. Per the ruling, no criterion was added for the cap itself —
a test that provokes 1000 real `mkdir` collisions would only be testing its
own fixture, not a property of the code.

## Re-run evidence

Covering tests (`runId.test.ts`, `S15.test.ts`, and the ledger's own
`writer.test.ts`, since `writer.ts` was touched):

```
$ npx vitest run tests/scheduler/runId.test.ts tests/scheduler/scenarios/S15.test.ts tests/ledger/writer.test.ts
 ✓ tests/scheduler/runId.test.ts (5 tests) 3ms
 ✓ tests/ledger/writer.test.ts (22 tests) 28ms
 ✓ tests/scheduler/scenarios/S15.test.ts (2 tests) 164ms
Test Files  3 passed (3)
     Tests  29 passed (29)
```
All 22 pre-existing `writer.test.ts` criteria stayed green — the export is
additive and changed no runtime behaviour.

Full verify:

```
$ npm run verify
...
Test Files  24 passed (24)
     Tests  188 passed (188)          # was 187 before this round; +1 new criterion
...
.decisions/orca-dev-09cc3ea1.jsonl:8-14: downgraded to tier 0 (seven lines, unchanged)
...
$ npm run verify:scheduler
Test Files  17 passed (17)
     Tests  69 passed (69)            # was 68 before this round; +1 new criterion
```
Exit code: 0.

## M-ID mutation, re-run against the fixed module

Same procedure as the original round: committed the fix (`50e2b8a`) first,
recorded pre-mutation hashes of the four touched files in the main
worktree, `git clone --local` into a fresh scratchpad directory, symlinked
`node_modules`.

Literal patch (identical shape to the first round — same line deleted, at
its new line number):

```diff
diff --git a/src/scheduler/runId.ts b/src/scheduler/runId.ts
index ab15666..082bd86 100644
--- a/src/scheduler/runId.ts
+++ b/src/scheduler/runId.ts
@@ -95,7 +95,6 @@ export async function allocateRunId(
       await mkdir(join(runsDir, candidate));
       return candidate;
     } catch (err) {
-      if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
       throw err;
     }
   }
```

Result:

```
$ npx vitest run tests/scheduler/scenarios/S15.test.ts
❯ tests/scheduler/scenarios/S15.test.ts (2 tests | 2 failed) 159ms
  × S15: running the same plan twice allocates a fresh id instead of colliding
    → EEXIST: file already exists, mkdir '.../runs/orca-T1-b8742204'
  × steps past a directory left behind by a crashed earlier run
    → EEXIST: file already exists, mkdir '.../runs/orca-T1-b8742204'
Test Files  1 failed (1)
     Tests  2 failed (2)
```

Both S15 criteria still redden, for the same reason as the first round (the
raw `EEXIST` propagates instead of being retried). Removed the symlink
(`/bin/rm -f`), deleted the clone (`/bin/rm -rf`).

Restoration proof — hashes of the four touched files in the main worktree,
before the clone was made and after the clone was deleted:

```
$ shasum -a 256 src/scheduler/runId.ts src/ledger/writer.ts tests/scheduler/runId.test.ts tests/scheduler/scenarios/S15.test.ts
555efe05a9ad398abe5cb3887058af75ebf28477658e3acd49f03e9fff3b95a5  src/scheduler/runId.ts
12d355bd5672deb87a6b3bc6a93ded01044ff656f58e9b1221471f0a0206d5bc  src/ledger/writer.ts
2ed03bc3767bbf628b28535ec16e1f886dee6b8c8c648516f753532b6d5a1979  tests/scheduler/runId.test.ts
09f853515cf4c7c3c5133fdb0e3bb028ba25e1f867b75671af6687adb1d95c23  tests/scheduler/scenarios/S15.test.ts
```
Identical before and after (`diff` exit 0, no output). The main worktree was
never touched by this round's mutation either.

## Files changed, this round

- `src/ledger/writer.ts` — `RUN_ID` const now exported; comment updated.
- `src/scheduler/runId.ts` — imports `RUN_ID` instead of duplicating it;
  `allocateRunId`'s retry loop capped at 1000 attempts with a named error on
  exhaustion.
- `tests/scheduler/runId.test.ts` — new criterion asserting `deriveRunId`'s
  output matches `RUN_ID` for a taskId with a dot and a hyphen.
- `tests/scheduler/scenarios/S15.test.ts` — added an assertion that the `-2`
  incremented id also matches `RUN_ID`.

## Concerns

None. The duplication the review flagged is gone, replaced by a single
shared source of truth; the new criterion is load-bearing in the sense the
ruling asked for (it measures the produced id, not the input check, and
would have failed if the id template's own separators were ever illegal
characters); the retry cap converts a theoretical silent-hang into a named,
thrown error without adding a criterion that would only test its own
fixture; and both the new tests and all pre-existing ones (scheduler and
ledger) are green.
