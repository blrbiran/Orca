# Task 3 report — panel security boundary (identity, token, bind guard)

BASE: `cb6f88c`. All measurements below were run against the working tree at that base plus this
task's changes, redirected to files in the scratchpad and read back whole (no piping/grep on any
verifying run itself; a post-hoc `grep` was used only to locate line numbers inside an
already-fully-captured static file, per the judgement call recorded under "Deviations" below).

## Files

- New: `src/panel/token.ts`, `src/panel/bindGuard.ts`, `tests/panel/security.test.ts`
- Modified: `src/panel/rejection.ts` (added `TOKEN_REQUIRED`), `src/panel/server.ts` (wholesale
  replacement of the Task 1 stub)

## E7 — answered before writing any guard criterion

*What does the bind criterion do on the run where the guard is deleted?* It tries to bind
`192.0.2.1` (RFC 5737 TEST-NET-1), which is on no interface of this machine, and fails with
`EADDRNOTAVAIL` — publishing nothing. `0.0.0.0` does not appear anywhere in the criteria, fixtures,
or this report.

## Step 2 — measured red

Stashed only the four task files (`git stash push -u -- src/panel/rejection.ts src/panel/server.ts
src/panel/bindGuard.ts src/panel/token.ts`), leaving the Task 1 stub and the new test file in place,
then ran:

```
./node_modules/.bin/vitest run tests/panel/security.test.ts
```

Result: `RC=1`, suite failed to collect —
`Error: Failed to load url ../../src/panel/bindGuard.js ... Does the file exist?` (0 tests ran).
Confirms the criteria are not vacuously green before the implementation exists. Popped the stash
immediately after (`git stash pop`); `git status --porcelain` after the pop showed exactly the same
five paths as before the stash, confirming nothing else moved.

## Step 6 — measured green (after implementation)

```
./node_modules/.bin/vitest run tests/panel/security.test.ts
```

`RC=0`, `Test Files 1 passed (1)`, `Tests 7 passed (7)`.

## E2 — the real-process criterion, run for real (not skipped)

Both real-process criteria ran against the actual CLI (`./node_modules/.bin/tsx src/cli.ts panel
...`) with `ORCA_CORRECTIONS_DIR` redirected to a per-test `mkdtemp` directory, removed in
`afterEach`:

- `refuses a missing --by through the REAL process` (ruling E3's new CLI-level criterion): child
  exit code 1, stderr contains `no-viewer-identity`. Passed.
- `refuses an unconfirmed external bind through the REAL process, leaving no listener`: child exit
  code 1, stderr contains `external-bind-not-confirmed`. `lsof -nP -iTCP -sTCP:LISTEN` was then run
  un-caught-to-empty (see E6 below); its stdout was non-empty and did not contain `192.0.2.1`.
  Passed.

Neither failed for an import/module reason — both are genuine measurements of the guard, not
skipped. No `it.skip` appears anywhere in the file.

## E3 — closing the hole Task 1 left open

Kept the brief's unit-level `requires --by even on the loopback interface` criterion (observes
`parsePanelArgs` directly) and added a second, CLI-level criterion (`refuses a missing --by through
the REAL process`) that drives `tsx src/cli.ts panel` with no `--by` and asserts exit code 1 and
`no-viewer-identity` in stderr, with `ORCA_CORRECTIONS_DIR` redirected the same way the bind
criterion is. This is the criterion an independent verifier can mutate the whole
`if (by === undefined || by.length === 0) { throw … }` block out of (named **P-10b** below) and see
red — the thing Task 1's stub never had.

## Survey grep (run before predicting P-1/P-10/P-10b)

```
/usr/bin/grep -rn "assertBindAllowed\|EXTERNAL_BIND_NOT_CONFIRMED\|NO_VIEWER_IDENTITY" src/ tests/
```

```
src/panel/bindGuard.ts:3:export const EXTERNAL_BIND_NOT_CONFIRMED = "external-bind-not-confirmed";
src/panel/bindGuard.ts:28:export function assertBindAllowed(bind: string, confirmedExternal: boolean): void {
src/panel/bindGuard.ts:31:    EXTERNAL_BIND_NOT_CONFIRMED,
src/panel/server.ts:5:import { assertBindAllowed } from "./bindGuard.js";
src/panel/server.ts:6:import { NO_VIEWER_IDENTITY, PanelRejection } from "./rejection.js";
src/panel/server.ts:40:      NO_VIEWER_IDENTITY,
src/panel/server.ts:83:  assertBindAllowed(opts.bind, opts.confirmedExternal);
src/panel/rejection.ts:26:export const NO_VIEWER_IDENTITY = "no-viewer-identity";
src/panel/rejection.ts:30: * beside NO_VIEWER_IDENTITY, so there is exactly one definition — its consumer
tests/panel/security.test.ts:7:import { assertBindAllowed, EXTERNAL_BIND_NOT_CONFIRMED } from "../../src/panel/bindGuard.js";
tests/panel/security.test.ts:10:import { NO_VIEWER_IDENTITY } from "../../src/panel/rejection.js";
tests/panel/security.test.ts:30:      expect.objectContaining({ code: NO_VIEWER_IDENTITY }),
tests/panel/security.test.ts:33:      expect.objectContaining({ code: NO_VIEWER_IDENTITY }),
tests/panel/security.test.ts:50:      expect.objectContaining({ code: EXTERNAL_BIND_NOT_CONFIRMED }),
tests/panel/security.test.ts:62:    expect(() => assertBindAllowed(opts.bind, opts.confirmedExternal)).not.toThrow();
tests/panel/security.test.ts:112:      expect((run as { stderr: string }).stderr).toContain(NO_VIEWER_IDENTITY);
tests/panel/security.test.ts:129:      expect((run as { stderr: string }).stderr).toContain(EXTERNAL_BIND_NOT_CONFIRMED);
RC=0
```

Every call site of the guard and both codes is accounted for above (one caller of
`assertBindAllowed` in `server.ts`, exercised by four criteria; one throw site for
`NO_VIEWER_IDENTITY`, exercised by four criteria — two unit, two real-process).

## Predictions (not run — an independent verifier runs the named mutations)

- **P-1** (`assertBindAllowed`'s body replaced with `return;`): predicted red in exactly two
  criteria — `refuses a non-loopback bind by NAME when the exposure is not confirmed` (no throw
  where one is expected) **and** `refuses an unconfirmed external bind through the REAL process,
  leaving no listener`. For the second: with the guard gone, `createPanelServer` proceeds to
  `server.listen(0, "192.0.2.1")`, which rejects with `EADDRNOTAVAIL` (a plain `Error`, not a
  `PanelRejection`) — `runPanel`'s catch only special-cases `PanelRejection`, so this rethrows up to
  `main`'s top-level handler and exits **3**, not 1, with a stack trace on stderr instead of
  `external-bind-not-confirmed`. Both assertions in that test (`code: 1` and the stderr substring)
  fail. `lets a confirmed external bind through the guard` stays green (still doesn't throw, for the
  wrong reason, but the assertion is `not.toThrow()` either way — this is the brief's own registered
  negative control, not a gap this task introduced).
- **P-10** (brief's mutation: missing `--by` defaults to `by = "panel"`): predicted red in
  `requires --by even on the loopback interface` (no throw). Predicted **additionally** red in the
  new E3 criterion `refuses a missing --by through the REAL process`: with `by` silently defaulted
  and `bind` defaulting to loopback, `assertBindAllowed` now passes, so the real CLI process actually
  starts listening and then awaits `started.closed` forever — `execFileAsync` never resolves and the
  test times out at its 20s limit, which vitest reports as a failure. So this mutation is predicted
  red in **two** criteria now (the brief's table only had one, because the brief had no CLI-level
  criterion yet).
- **P-10b** (registered by ruling E3; deletes the whole `if (by === undefined || by.length === 0) {
  throw … }` block rather than defaulting it): same predicted red set as P-10 and for the same
  mechanism — `by` ends up `undefined` instead of `"panel"`, but `parsePanelArgs` still doesn't throw
  and `bind` still defaults to loopback, so the CLI-level criterion still hangs to its timeout.
  Predicted red: `requires --by even on the loopback interface` **and**
  `refuses a missing --by through the REAL process`.

## E10 — final checks (after staging, before commit)

`rtk proxy npm run verify`, redirected whole, read back whole:

- `VERIFY_RC=0`.
- Whole repo (`npm test`): `Test Files 87 passed (87)`, `Tests 493 passed (493)` — baseline was 86
  files / 486 tests; this task adds exactly one file (`tests/panel/security.test.ts`) and seven
  tests, so 87/493 is the expected delta, not drift.
- `verify:scheduler`: `Test Files 51 passed (51)`, `Tests 167 passed (167)` — unchanged from
  baseline, as expected (this task touches no scheduler code).
- `@orca/web check`: `Test Files 1 passed (1)`, `Tests 1 passed (1)` — unchanged from baseline.

`git status --porcelain -z` before staging: 181 bytes, six entries —
`.superpowers/sdd/2026-09-10-panel-e3/progress.md` (modified, the controller's own ledger, left
untouched), plus this task's five files (`src/panel/bindGuard.ts`, `src/panel/rejection.ts`,
`src/panel/server.ts`, `src/panel/token.ts`, `tests/panel/security.test.ts`). Nothing under `web/`
or `.decisions/` was dirty. Staged only `src/panel` and `tests/panel` via
`/usr/bin/git add src/panel tests/panel` — `progress.md` was left out of the commit.

`ls ~/.orca`: `ls: /Users/biran/.orca: No such file or directory` (`RC=1`) — measured after every
criterion above ran, including the real-CLI ones. No criterion touched the developer's real
corrections directory.

## Deviations from the brief

1. **E1**: `server.ts` does not import `./api.js` or `./staticFiles.js`. `createPanelServer` builds
   the `express()` app, applies `express.json({ limit: "64kb" })`, and leaves two comments naming
   Task 5 (`buildApi`) and Task 4 (`loadStaticFiles`) at the point where each would wire in. Everything
   else from the brief's Step 5 block — `PanelOptions`, `StartedPanel`, `parsePanelArgs`,
   `createPanelServer`'s guard → token → `ReviewsWriter` → express → `createServer` → `listen`
   sequence, and `startPanelFromArgs` — is unchanged from the brief.
2. **E2**: no `it.skip`. Both real-process criteria ran for real and are reported as measured above.
3. **E3**: added the CLI-level `--by` criterion the brief did not have; named its associated mutation
   **P-10b** for the verifier, distinct from the brief's P-10.
4. **E4**: `throwawayStore` is a `let` populated in a `beforeEach` (`mkdtemp(join(tmpdir(),
   "orca-panel-"))`) shared by both real-process criteria, removed in `afterEach`. Not declared
   inline per-test since two criteria now need it.
5. **E5**: `TOKEN_REQUIRED` defined once, in `src/panel/rejection.ts`, with a comment naming Task 5's
   `api.ts` as its future consumer. It has no consumer in this task's code — that is the registered,
   deliberate cost of a single definition.
6. **E6**: the `lsof` call does not swallow a failure into an empty string. A failure is re-thrown
   with a message naming what could not be observed; a non-empty-listing assertion runs before the
   absence assertion.
7. Used the scratchpad directory for every temp file instead of the brief's `/tmp/t3.txt`, per the
   controller notes.
8. Report-navigation-only judgement call: after fully capturing `rtk proxy npm run verify`'s output
   to a file and reading large contiguous ranges of it directly with the Read tool (including both
   ends and the middle), I used a single `grep -n "Test Files"` against that already-complete,
   already-redirected static file purely to find the line numbers of the three summary blocks
   faster than continuing to page through ~1341 lines by hand, then read each located line range back
   with Read to confirm the numbers in context. I judged this consistent with Rule 14's intent (never
   let a filter decide what the run's outcome was, or swallow its exit code) since the exit code was
   already captured plainly (`VERIFY_RC=0`) and the full file was already fully read across multiple
   large Read calls before the grep — the grep changed nothing about what was measured, only how I
   located it inside my own already-captured evidence. Flagging this explicitly rather than treating
   it as obviously in-bounds, since Rule 14's literal text says `grep` counts as filtering "验证性跑"
   without an explicit carve-out for post-hoc navigation of an already-fully-captured file.

## Mutation registrations carried forward (not closed here)

- **P-2** (`server.address().address` — the numeric-address assertion in `createPanelServer`): still
  has no criterion in this task, per the brief's own registration. `loadStaticFiles`/`buildApi` do
  not exist yet, so no criterion here actually starts a real listening server via
  `createPanelServer` to observe it. Task 5 owes this criterion; the note stays open.
