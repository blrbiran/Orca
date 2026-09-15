# Task 3 — independent mutation verification report

Commit under test: `eaedd86e182e6d69374957791f1cbd4b2c152476` (this was already `HEAD` of the main
tree at the start of this run; the main tree was never touched — see "Main-tree integrity" below).

Method: for each mutation, `git clone --local --quiet` the main tree into a fresh `mktemp -d`,
`checkout --quiet` the commit under test, symlink `node_modules` and `web/node_modules` in from the
main tree, apply the mutation with a Node script (`mutate.mjs`) that requires an **exactly-once**
literal-anchor match (fatal otherwise), record `shasum -a 256` before/after, `git diff`, run
`./node_modules/.bin/vitest run tests/panel` redirected whole to a file and read back in full (never
piped/grepped/tailed), `cmp` the clone's `tests/panel/security.test.ts` against the main tree's, then
delete the clone. One shell invocation per mutation.

## Baseline (unmutated clone)

`RC=0`. `Test Files 4 passed (4)`, `Tests 22 passed (22)`. The `RUN` line pointed into the clone
(`/private/var/folders/.../tmp.dpCLwtjQ2x/orca`), confirming the run was against the clone, not the
main tree.

## Mutations

### P-1 — `assertBindAllowed`'s whole body replaced with `return;`

- Hash before: `7b92ee1e48f1cd83...33893d52bae3e256`; after: `fe0c0476a36b8f4f...c38400abd54b5320`. Differ — mutation landed.
- Diff: removed the `if (isLoopback...) return;` / `throw new PanelRejection(...)` body, replaced
  with `return;`.
- `RC=1`. `Test Files 1 failed | 3 passed (4)`. `Tests 2 failed | 20 passed (22)`.
- Failing criterion 1: **`panel security (spec sections 3.1 and 3.2) > refuses a non-loopback bind by
  NAME when the exposure is not confirmed`** (`tests/panel/security.test.ts:50`) —
  `AssertionError: expected function to throw an error, but it didn't`.
- Failing criterion 2: **`panel security via the real CLI process (controller ruling E2/E3: not
  skipped) > refuses an unconfirmed external bind through the REAL process, leaving no listener`**
  (`tests/panel/security.test.ts:128`) — expected `{ code: 1 }`, received an `Error` object with
  `code: 3` (5 other properties omitted). This confirms the report's mechanism prediction exactly:
  with the guard gone, `server.listen(0, "192.0.2.1")` rejects with a plain `Error`
  (`EADDRNOTAVAIL`), which is not a `PanelRejection`, so it rethrows past `runPanel`'s catch to the
  top-level handler and the process exits **3**, not 1 — the criterion reddens on "something else"
  (a crash exit code), not on the refusal code, exactly as predicted.
- `lets a confirmed external bind through the guard` stayed green, as predicted (its own registered
  negative control — `not.toThrow()` is true either way when the guard never throws).
- **matched** the implementer's report prediction in full, including which mechanism the
  real-process criterion reddens on.

### P-10 — missing `--by` defaults to `by = "panel"`

- Hash before: `8c957942d0fa0d06...834aea27f7a05537` (server.ts); after:
  `6032692154ccfce7...c3060fc2c8a21bc2`. Differ — mutation landed.
- Diff: removed the `if (by === undefined || by.length === 0) { throw ... }` block; `const by =
  flag("--by") ?? "panel";`.
- `RC=1`. `Test Files 1 failed | 3 passed (4)`. `Tests 2 failed | 20 passed (22)`. Suite duration
  20.73s (one test hit its 20s timeout).
- Failing criterion 1: **`panel security (spec sections 3.1 and 3.2) > requires --by even on the
  loopback interface`** (`tests/panel/security.test.ts:29`) — `expected function to throw an error,
  but it didn't`.
- Failing criterion 2: **`panel security via the real CLI process (controller ruling E2/E3: not
  skipped) > refuses a missing --by through the REAL process (ruling E3: the hole Task 1's stub left
  open)`** — `Error: Test timed out in 20000ms.` With `by` silently defaulted and `bind` defaulting
  to loopback, `assertBindAllowed` passes, the real child process starts listening and
  `execFileAsync` never resolves; vitest's own 20s test timeout is what turns this into a failure.
  Confirmed a real orphaned child process (`tsx src/cli.ts panel`, PIDs 13124/13134) was left running
  after the test timed out; it was found via `ps` and killed by hand before deleting the clone (see
  "Housekeeping" below) — it never bound anything but loopback, and this is a mechanical consequence
  of the timeout mechanism, not part of the criterion's measurement.
- **matched** the implementer's report prediction (which itself corrected the brief's table: two red
  criteria, not the one the brief's original table named, because the brief predates the CLI-level
  criterion).

### P-10b — the whole `if (by === undefined || by.length === 0) { throw ... }` block deleted (no default, no throw) — the R18 carried mutation

**This is the reason this seat exists.** Task 1 shipped the identical guard with no criterion pinning
it, and the only reason anyone found out was a verifier who deleted it and reported everything
stayed green.

- Hash before: `8c957942d0fa0d06...834aea27f7a05537` (server.ts, same starting file as P-10); after:
  `7dac190f54fab33f...daf1a5df620196f8`. Differ — mutation landed.
- Diff: only the `if` block removed; `const by = flag("--by");` left bare (no default assigned).
- `RC=1`. `Test Files 1 failed | 3 passed (4)`. `Tests 2 failed | 20 passed (22)`. Suite duration
  20.71s.
- Failing criterion 1: **`panel security (spec sections 3.1 and 3.2) > requires --by even on the
  loopback interface`** (`tests/panel/security.test.ts:29`) — `expected function to throw an error,
  but it didn't`.
- Failing criterion 2: **`panel security via the real CLI process (controller ruling E2/E3: not
  skipped) > refuses a missing --by through the REAL process (ruling E3: the hole Task 1's stub left
  open)`** — `Error: Test timed out in 20000ms.` Same mechanism as P-10: `by` ends up `undefined`
  rather than defaulted, `parsePanelArgs` still doesn't throw, `bind` defaults to loopback, the real
  child process starts and hangs, and the criterion times out. A second orphaned `tsx src/cli.ts
  panel` process pair (PIDs 16338/16340) was found and killed before deleting the clone.

**Finding, stated plainly: this mutation does NOT stay green.** Both criteria the implementer's
report predicted go red, and they go red for the reasons predicted (unit-level: no throw;
CLI-level: the process hangs and the vitest timeout fires). Unlike Task 1 — where the identical
guard had zero criteria pinning it and an identical deletion left every criterion green — this
task's added CLI-level criterion (`refuses a missing --by through the REAL process`, added under
ruling E3 and not present in the brief's original table) is what catches it. The hole Task 1 left is
closed here.

- **matched** the implementer's own prediction (P-10b section of the report), which is identical to
  its P-10 prediction for this mutation.

### P-11 — `tokenMatches` returns `true` unconditionally

- Hash before: `100155648677b125...783f16d407ae637c` (token.ts); after:
  `842f2a6cdef7fc68...a34ff94ae187341a`. Differ — mutation landed.
- Diff: whole function body replaced with `return true;`.
- `RC=1`. `Test Files 1 failed | 3 passed (4)`. `Tests 1 failed | 21 passed (22)`.
- Failing criterion: **`panel security (spec sections 3.1 and 3.2) > mints a token that is not
  guessable and compares it in constant time`** (`tests/panel/security.test.ts:71`) —
  `expect(tokenMatches(a, b)).toBe(false)` — expected `false`, received `true`.
- No other criterion failed.
- **matched** the implementer's report prediction: red in the token criterion and only it.

### P-12 — `mintToken` returns a fixed 64-hex-char literal

- Hash before: `100155648677b125...783f16d407ae637c` (token.ts, same starting file as P-11); after:
  `41322da48c01b92b...843d0dfa9de38697`. Differ — mutation landed.
- Diff: `randomBytes(32).toString("hex")` replaced with the literal
  `"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"` (64 lowercase-hex characters).
- `RC=1`. `Test Files 1 failed | 3 passed (4)`. `Tests 1 failed | 21 passed (22)`.
- Failing criterion: **`panel security (spec sections 3.1 and 3.2) > mints a token that is not
  guessable and compares it in constant time`** (`tests/panel/security.test.ts:69`) —
  `expect(a).not.toBe(b)` — `AssertionError: expected 'aaaa...' not to be 'aaaa...'`.
- Confirmed the report's own flagged risk: the shape assertion at line 68
  (`expect(a).toMatch(/^[0-9a-f]{64}$/)`) **passed** — a 64-char literal of lowercase hex satisfies
  the regex. Only the inequality check at line 69 (which runs after and is the one that actually
  reddens) catches the fixed value. If that line were removed or reordered after a short-circuiting
  earlier failure, this mutation would go undetected by the shape assertion alone — exactly the guess
  the criterion is built to catch, and it does.
- No other criterion failed.
- **matched** the implementer's report prediction, including the specific note about the shape
  assertion staying green.

### P-13 — `assertBindAllowed` throws unconditionally (early `return` for the allowed case deleted)

- Hash before: `7b92ee1e48f1cd83...33893d52bae3e256` (bindGuard.ts, same starting file as P-1); after:
  `7744ebd38cee357c...46d4f97898cfc538`. Differ — mutation landed.
- Diff: only the line `if (isLoopback(bind) || confirmedExternal) return;` removed; the `throw` is
  now unconditional.
- `RC=1`. `Test Files 1 failed | 3 passed (4)`. `Tests 1 failed | 21 passed (22)`.
- Failing criterion: **`panel security (spec sections 3.1 and 3.2) > lets a confirmed external bind
  through the guard`** (`tests/panel/security.test.ts:62`) — `expected [Function] to not throw an
  error but 'PanelRejection: --bind 192.0.2.1 would...' was thrown`.
- No other criterion failed — in particular, the two real-process criteria and the loopback-bind
  criterion stayed green because they never call `assertBindAllowed` with a case that needs the
  early return to pass (the loopback-default test never calls the guard at all; the "refuses a
  missing --by" real-process test fails identity parsing first; the "refuses an unconfirmed external
  bind" real-process test wants a throw anyway, which this mutation still produces for that input).
- **matched** the implementer's report prediction: red in the negative-control criterion and only
  it. Confirms the brief's point directly — without this negative control, a guard that refuses
  everything would have passed the refusal criterion undetected.

## Unpinned criteria named in the report

The implementer's report names **P-2** (`server.address().address`, the numeric-address assertion in
`createPanelServer`) as a mutation registration carried forward, explicitly still unpinned by any
criterion in this task, because `createPanelServer` never actually reaches a real listening server
via `buildApi`/`loadStaticFiles` (Task 5/Task 4 work, not yet landed). This matches the brief's
instruction: "say which are unpinned rather than inventing mutations for them." No criterion in
`tests/panel/security.test.ts` exercises that line; it is out of scope for this seat's six mutations
and is correctly flagged as open by the implementer, not something this report treats as a gap in
Task 3 itself.

## Housekeeping: orphaned child processes

Two of the six mutations (P-10, P-10b) drive a real `tsx src/cli.ts panel` child process that, under
the mutation, starts listening on loopback and never returns — the criterion's own 20s vitest timeout
is what turns this into a failure, but it does not kill the child. In both cases, `ps -eo
pid,ppid,command` (run after the vitest process had already exited and its output fully captured and
read) found the orphaned `tsx`/node pair still running, bound to loopback only, and it was killed by
hand (`kill <pid>`) before the clone directory was deleted. This is a side effect of vitest's test
timeout mechanism interacting with an unawaited child process, not a defect in the guard being
measured, and it was never exposed on anything but loopback.

## Main-tree integrity

- `HEAD` before and after the entire run: `eaedd86e182e6d69374957791f1cbd4b2c152476` (unchanged).
- `git status --porcelain -z` before: 52 bytes — ` M .superpowers/sdd/2026-09-10-panel-e3/progress.md`
  (the controller's own ledger, expected to be dirty per the brief).
- `git status --porcelain -z` after: 52 bytes — byte-identical to before (`cmp` confirmed).
- Nothing under `src/`, `tests/`, `web/`, or `.decisions/` appeared in either porcelain reading.
- For every mutation, `cmp` of the clone's `tests/panel/security.test.ts` against the main tree's
  copy reported identical (`CMP_OK`) — no mutation ever touched a criterion file, in the clone or
  otherwise.
- `ls ~/.orca`: `No such file or directory` both before the whole run and after every mutation
  (checked after each of the six runs individually, not just once at the end) — no criterion, and no
  orphaned child process, ever touched the real corrections directory. `ORCA_CORRECTIONS_DIR` was
  redirected to a per-test `mkdtemp` in every real-process run, per the test file's own `beforeEach`.

## Summary table

| id | RC | failing criteria | verdict |
|---|---|---|---|
| P-1 | 1 | 2 | matched |
| P-10 | 1 | 2 | matched |
| P-10b | 1 | 2 | matched — **red, as this task intended; the Task 1 hole is closed** |
| P-11 | 1 | 1 | matched |
| P-12 | 1 | 1 | matched |
| P-13 | 1 | 1 | matched |
