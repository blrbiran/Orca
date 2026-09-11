# Task P report — the correction clock is injectable

## Base

Commit `a801200` on `main`, working tree 0 bytes porcelain at dispatch (measured:
`git status --porcelain -z > f; wc -c f` → `0`; note the first attempt, piped
through `| wc -c`, printed a spurious `2` — Rule 14's warning about pipes
swallowing/altering output is confirmed real here, not just theoretical).

## What changed

- `src/corrections/record.ts`
  - Added `export type NewCorrectionInput = Omit<CorrectionRow, "at">`.
  - Added `export function correctionRowFrom(input: NewCorrectionInput, now: () => Date): CorrectionRow`
    — the one row-literal constructor for new corrections, `at: now().toISOString()`,
    same key order as before (`projectKey, decisionId, kind, chose_instead, because, at, by`).
    Its doc comment is the private `correctionRowFrom` comment from correct.ts, moved
    verbatim, with an ERRATUM appended (2026-09-10) saying it now lives here, is
    exported, and takes the clock as a parameter.

- `src/corrections/correct.ts`
  - `export async function correct(argv: string[], opts: { now?: () => Date } = {}): Promise<number>`,
    `const now = opts.now ?? (() => new Date());`.
  - Removed the private `correctionRowFrom`; added `newCorrectionInputFrom(parsed, projectKey): NewCorrectionInput`
    — the ONE place that maps `parsed` (camelCase `choseInstead`) onto the shared
    constructor's input shape. Both the `record` branch and the `close-new` branch
    call `correctionRowFrom(newCorrectionInputFrom(parsed, projectKey), now)`.
  - Removed the now-unused `import type { CorrectionRow }`.
  - Left untouched: the `const at = new Date().toISOString()` inside the close
    path (used for the two ledger rows via `deriveRows`) — confirmed still present,
    unchanged, at its original spot. `projectKey` is still caller-computed, not
    injected. `src/cli.ts` still calls `correct(args)` with no opts.

- `tests/corrections/recordSeam.test.ts`
  - No assertions changed. Appended an ERRATUM (2026-09-10) to the comment above
    `describe("both CLI modes construct their correction the same way …")` that
    said `at` "is stamped from the wall clock and cannot be injected": it now
    explains that `at` CAN be injected via `correct(argv, { now })`, but this
    file's own `it`s go through `runCli` (which never passes `now`), so every
    assertion in the file is still exercised against the wall clock exactly as
    before — nothing in the file needed to change.

- `tests/corrections/injectableClock.test.ts` (new, additive)
  - 4 `it`s under one `describe`, each with a comment on why it matters:
    1. `correctionRowFrom` stamps `at` from the injected clock — checks all 7
       fields against literals, never against a value the function under test
       produced.
    2. record mode through `correct(argv, { now })` stores `at === INSTANT`
       (`INSTANT = "2026-09-01T12:34:56.000Z"`), read back via `readCorrections(dir)`.
    3. close mode through `correct(argv, { now })` stores `at === INSTANT`,
       using a `closeArgsForCorrect` wrapper (`closeArgs(...).slice(1)` — see
       below on why the slice is needed).
    4. same input + same injected clock ⇒ same stored id, run twice with a
       fresh corrections dir and a fresh target repo each time (same remote
       ⇒ same projectKey); asserts `ids[0] === ids[1]` AND `ids[0] === GOLDEN_ID`.
       `GOLDEN_ID = "c_ed266d26d170dd27"`, observed once (see step-2 evidence
       below) and pasted as a literal — `deriveCorrectionId` is never called in
       this test file.
  - Every write goes through `withCorrectionsDir` (temp `ORCA_CORRECTIONS_DIR`).
  - Note on argv shape: `src/cli.ts`'s `main` destructures `[command, ...rest]`
    and calls `runCorrect(rest)` → `correct(rest)`, so the argv `correct()`
    actually receives never contains the leading `"correct"` token (confirmed:
    `parseCorrectArgs`'s `scanArgv` would throw `unknown-argument` on `"correct"`
    itself, since it isn't a recognised flag). `harness.ts`'s exported `closeArgs`
    is shaped for `runCli` (which takes the *full* argv including `"correct"`),
    so this file defines its own `recordArgs` (no `"correct"` prefix) and wraps
    `closeArgs` with `.slice(1)` before passing to `correct()` directly.

## grep -rn "inject" src/corrections tests/corrections — hits and dispositions

Command: `/usr/bin/grep -rn "inject" src/corrections tests/corrections`

1. `src/corrections/derive.ts:10` — "The real moment this row is being written,
   injected rather than read from a clock in here" (the `at` parameter of
   `DeriveInput`, i.e. the close-path ledger rows' clock). **Not touched, still
   true** — this is the clock this task was explicitly told not to touch
   (the `const at = new Date().toISOString()` in correct.ts's close path,
   piped into `deriveRows`). Unrelated to the correction row's own `at`.
2. `src/corrections/storeLock.ts:38` and `:42` — "injects its own `now`" /
   "the injected clock stopped being consulted", about the store lock's
   timeout-measuring clock (`withStoreLock`'s own seam). **Not touched, still
   true** — a completely different clock (lock timeout vs. correction `at`),
   pre-existing seam unrelated to this task.
3. `tests/corrections/derive.test.ts:90` — "stamps both rows with the injected
   write moment, not the correction's" — tests item 1 above. **Not touched,
   still true.**
4. `tests/corrections/close.test.ts:338` — "(fault injection): a non-executable
   --undo-how …" — "injection" here means mutation/fault-injection testing
   terminology, not a clock. **Not touched, unrelated.**
5. `tests/corrections/storeLock.test.ts:87`, `:93`, `:97` — tests item 2 above
   (the lock-timeout clock seam). **Not touched, still true.**
6. `tests/corrections/recordSeam.test.ts:128` — "`at` is stamped from the wall
   clock and cannot be injected" — **this is the one hit this task makes false.
   ERRATUM appended** (see above); original words kept verbatim.

## Step 1 — red evidence (no-op stub: `correctionRowFrom` ignores `now`, `correct` ignores `opts`)

Command: `./node_modules/.bin/vitest run tests/corrections/injectableClock.test.ts > f 2>&1; echo "RC=$?" >> f`

All 4 failed, every failure on the `at`/id assertion itself (no compile or setup errors):

```
× correctionRowFrom stamps `at` from the injected clock, not the wall clock
  → expected '2026-09-10T15:49:08.652Z' to be '2026-09-01T12:34:56.000Z'
× record mode through correct(argv, { now }) stores at === INSTANT
  → expected '2026-09-10T15:49:08.831Z' to be '2026-09-01T12:34:56.000Z'
× close mode through correct(argv, { now }) stores at === INSTANT
  → expected '2026-09-10T15:49:09.027Z' to be '2026-09-01T12:34:56.000Z'
× the same input with the same injected clock yields the same stored id, matching the golden Task 7 will assert against
  → expected 'c_0d0c4d41cf5754f6' to be 'c_66082862127f3dfc'
    at injectableClock.test.ts:142:20  (expect(ids[0]).toBe(ids[1]) — the "both ids equal" line, exactly as the
    brief predicted, NOT the golden-literal line at 143, which never even gets a chance to be the interesting one)

Test Files  1 failed (1)
     Tests  4 failed (4)
RC=1
```

## Step 2 — real wiring, green

After flipping `correctionRowFrom` to `at: now().toISOString()` and `correct` to
`correctionRowFrom(newCorrectionInputFrom(parsed, projectKey), now)` in both branches:

- Re-run with a placeholder golden: 3/4 green, criterion 4 red only on the
  golden-literal comparison (`expected 'c_ed266d26d170dd27' to be 'c_c17aa02b2f43d1ce'`,
  with `ids[0] === ids[1]` now passing) — confirmed determinism, then pasted
  `c_ed266d26d170dd27` into `GOLDEN_ID`.
- `./node_modules/.bin/vitest run tests/corrections/injectableClock.test.ts` →
  `Test Files  1 passed (1)` / `Tests  4 passed (4)` / `RC=0`.
- `./node_modules/.bin/vitest run tests/corrections` →
  `Test Files  14 passed (14)` / `Tests  88 passed (88)` / `RC=0`
  (includes `close.test.ts`'s E16, still green and unchanged — the close-path
  ledger `at` is confirmed still fresh and distinct from the correction's own `at`).

## Step 3 — whole-repo verify

Command: `rtk proxy npm run verify > f 2>&1; echo "VERIFY_RC=$?" >> f`

- `VERIFY_RC=0`
- Whole-repo `vitest run`: `Test Files  83 passed (83)` / `Tests  471 passed (471)`
  (baseline was 82 files / 467 tests; +1 file / +4 tests, exactly this task's
  new test file — every other file's test count unchanged).
- `verify:scheduler` (`node scripts/verify-scheduler.mjs`): `Test Files  51 passed (51)` /
  `Tests  167 passed (167)` — unchanged from baseline, as expected (scheduler
  untouched).
- The `npm run ledger -- validate .decisions` step inside `verify` ran BEFORE
  the ledger row below was appended; its 7 `downgraded to tier 0` lines
  (`.decisions/orca-dev-09cc3ea1.jsonl` lines 8–14) are pre-existing and
  unrelated to this task.

## Ledger row

Wrote and ran (once, via `npx tsx`) a throwaway script at
`/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/6354277a-65a9-4350-bd38-f099d586198e/scratchpad/append-decision.ts`
(not in the repo) that calls `appendEvent(".decisions", "orca-dev-6354277a", {...})`
with the decision from `task-P-decision.json`. (First attempt hit
`ERR_REQUIRE_ASYNC_MODULE` from top-level `await` under `tsx`'s cjs transform
outside the repo's `package.json` scope; fixed by wrapping in an `async function
main()`.) `RC=0`.

Then: `npm run ledger -- validate .decisions > f 2>&1; echo "RC=$?" >> f` →

```
.decisions/orca-dev-09cc3ea1.jsonl:8: downgraded to tier 0: taskId: Required; runId: Required
.decisions/orca-dev-09cc3ea1.jsonl:9: downgraded to tier 0: taskId: Required; runId: Required
.decisions/orca-dev-09cc3ea1.jsonl:10: downgraded to tier 0: taskId: Required; runId: Required
.decisions/orca-dev-09cc3ea1.jsonl:11: downgraded to tier 0: taskId: Required; runId: Required
.decisions/orca-dev-09cc3ea1.jsonl:12: downgraded to tier 0: taskId: Required; runId: Required
.decisions/orca-dev-09cc3ea1.jsonl:13: downgraded to tier 0: taskId: Required; runId: Required
.decisions/orca-dev-09cc3ea1.jsonl:14: downgraded to tier 0: taskId: Required; runId: Required
RC=2
```

Exit 2 (downgraded), which `verify` accepts. **No line mentions
`orca-dev-6354277a`** — the new decision row validated without rejection or
downgrade; the 7 downgraded lines are all pre-existing, in a different file
(`orca-dev-09cc3ea1.jsonl`), same as the baseline run captured inside
step-3's `verify` output above.

## Commit

`git add` explicit paths: `src/corrections/correct.ts src/corrections/record.ts
tests/corrections/injectableClock.test.ts tests/corrections/recordSeam.test.ts
.decisions/orca-dev-6354277a.jsonl`.

Commit `297a2cec5b78623c64da12e52adae18e08c6fbbd`, subject exactly
`feat(corrections): make the correction clock injectable and give the panel the one row constructor`.
Pre-commit hooks ran (CLAUDE.md line count ok, append-only ok, the same 7
pre-existing downgraded-ledger-line warnings as above) and did not block.

Final: `git status --porcelain -z > f; wc -c f` → **0 bytes**.

## `ls ~/.orca`

`ls: /Users/biran/.orca: No such file or directory` — unchanged from the start
of the task (Rule 17 respected; no criterion, script, or command in this task
touched the real `~/.orca`).

## Concerns

- None found that block. One judgment call worth naming: `harness.ts`'s
  `closeArgs`/`recordArgs`-style helpers are shaped for `runCli` (full argv
  incl. `"correct"`), not for calling `correct()` directly with `{ now }`.
  Rather than editing `harness.ts` (out of scope — the brief lists only the
  two src files, the new test file, and `recordSeam.test.ts` as touchable) I
  defined a local `recordArgs` and a `closeArgsForCorrect = (repo) =>
  closeArgs(repo).slice(1)` inside `injectableClock.test.ts` itself. This is a
  one-file, additive, no-shared-code change, so it doesn't touch anything the
  brief scoped as off-limits, but it does mean there are now two `recordArgs`-
  shaped helpers in `tests/corrections/` (one in `recordSeam.test.ts`, one
  here) that could plausibly be unified later — flagging per Rule 7 rather
  than doing it myself, since it's out of this task's scope.
- The mutation survey beyond step 1 of the TDD order was explicitly not mine
  to run (brief: "an independent verifier will").
