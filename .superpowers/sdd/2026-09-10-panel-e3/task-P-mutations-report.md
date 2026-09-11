# Task P — independent mutation verification report

Independent verifier, did not write the code under test. Repo:
`/Users/biran/code/skills/loop/Orca`. Commit under test: `297a2ce`
(`feat(corrections): make the correction clock injectable and give the panel
the one row constructor`).

Measuring commands (run at the start and end of this session):

```
/usr/bin/git -C /Users/biran/code/skills/loop/Orca status --porcelain -z > <file>; wc -c < <file>
/usr/bin/git -C /Users/biran/code/skills/loop/Orca rev-parse HEAD
```

- Pre-run: porcelain byte count = 0; `HEAD` = `297a2cec5b78623c64da12e52adae18e08c6fbbd`.
- Post-run: porcelain byte count = 0; `HEAD` unchanged = `297a2cec5b78623c64da12e52adae18e08c6fbbd`.

The main working tree was never edited. All edits happened in fresh
`git clone --local` copies, one per mutation, under `mktemp -d`, each torn
down with `/bin/rm -rf` after use. Each clone linked `node_modules` from the
main tree via `ln -s`. Each run was `./node_modules/.bin/vitest run
tests/corrections` (the whole directory), output redirected to a file and
read back whole (never piped/grepped), with `RC=$?` appended.

## Baseline (unmutated clone, checked out at 297a2ce)

`vitest run tests/corrections`: `RUN` pointed at the clone's tmp path.

```
Test Files  14 passed (14)
     Tests  88 passed (88)
RC=0
```

All green as expected. Teardown check: clone's
`tests/corrections/injectableClock.test.ts` was byte-identical to the main
tree's copy (`cmp`, no output, exit 0).

## MP-1 — `record.ts` `correctionRowFrom`: `at:` uses `new Date().toISOString()` instead of `now()`

- Hash before: `3752a12c22030d7460f15db7303a2bedb8b747d17e0288b40e5fd91dbc89b2c8`
- Hash after: `4767df73d735613de2890052b4ba02aee7605708f4091a0375aa6ae142addd5c` (differ)
- Diff:
  ```diff
  -    at: now().toISOString(),
  +    at: new Date().toISOString(),
  ```
- `RC=1`
- `Test Files  1 failed | 13 passed (14)`
- `Tests  4 failed | 84 passed (88)`
- Failing tests, full name + first assertion failure:
  1. `the correction clock is injectable (Task P, E3 spec §2.3) > correctionRowFrom stamps \`at\` from the injected clock, not the wall clock` — `injectableClock.test.ts:62` — expected `2026-09-01T12:34:56.000Z`, received `2026-09-10T15:56:29.921Z`.
  2. `the correction clock is injectable (Task P, E3 spec §2.3) > record mode through correct(argv, { now }) stores at === INSTANT` — `injectableClock.test.ts:86` — expected `2026-09-01T12:34:56.000Z`, received `2026-09-10T15:56:30.247Z`.
  3. `the correction clock is injectable (Task P, E3 spec §2.3) > close mode through correct(argv, { now }) stores at === INSTANT` — `injectableClock.test.ts:108` — expected `2026-09-01T12:34:56.000Z`, received `2026-09-10T15:56:30.580Z`.
  4. `the correction clock is injectable (Task P, E3 spec §2.3) > the same input with the same injected clock yields the same stored id, matching the golden Task 7 will assert against` — `injectableClock.test.ts:142` — expected `'c_bec537d2ffc3cd89'` (`ids[1]`, taken from the run's own second iteration), received `'c_9236db51de133b5a'` (`ids[0]`); the assertion two lines below it (against `GOLDEN_ID`) was never reached because this one short-circuited.

**hypothesis matched** — red in injectableClock criteria 1, 2, 3, 4; all other test files stayed green.

Teardown check: clone's `injectableClock.test.ts` byte-identical to main tree's.

## MP-2 — `correct.ts` `correct`: injected clock ignored, `now` becomes wall clock regardless of `opts.now`

- Hash before: `ca48334720f0851a15b5746c9dee7d3e772b727131073d204908db7295a9721f`
- Hash after: `da1d0302d08ec579dc75fc6dc7f26bd03563922bf1bd96ead54a611a3a351935` (differ)
- Diff:
  ```diff
  -  const now = opts.now ?? (() => new Date());
  +  const now = () => new Date();
  ```
- `RC=1`
- `Test Files  1 failed | 13 passed (14)`
- `Tests  3 failed | 85 passed (88)`
- Failing tests, full name + first assertion failure:
  1. `the correction clock is injectable (Task P, E3 spec §2.3) > record mode through correct(argv, { now }) stores at === INSTANT` — `injectableClock.test.ts:86` — expected `2026-09-01T12:34:56.000Z`, received `2026-09-10T15:56:53.639Z`.
  2. `the correction clock is injectable (Task P, E3 spec §2.3) > close mode through correct(argv, { now }) stores at === INSTANT` — `injectableClock.test.ts:108` — expected `2026-09-01T12:34:56.000Z`, received `2026-09-10T15:56:53.953Z`.
  3. `the correction clock is injectable (Task P, E3 spec §2.3) > the same input with the same injected clock yields the same stored id, matching the golden Task 7 will assert against` — `injectableClock.test.ts:142` — expected `'c_ce01722d155c8d4b'` (`ids[1]`), received `'c_f859a1285314e84d'` (`ids[0]`).
- Criterion 1 (`correctionRowFrom stamps \`at\`...`, which calls `correctionRowFrom` directly, bypassing `correct()`) stayed green, as it must — the mutation is inside `correct`, not `correctionRowFrom`.

**hypothesis matched** — red in criteria 2, 3, 4; criterion 1 green.

Teardown check: clone's `injectableClock.test.ts` byte-identical to main tree's.

## MP-3 — `correct.ts` `correct`: default clock (used when `opts.now` is absent) becomes `() => new Date(0)`

- Hash before: `ca48334720f0851a15b5746c9dee7d3e772b727131073d204908db7295a9721f`
- Hash after: `cf8c52b474b82bc1d5a32633ca5cdf9c8329231fbc79f77c4e7b614406219c5c` (differ)
- Diff:
  ```diff
  -  const now = opts.now ?? (() => new Date());
  +  const now = opts.now ?? (() => new Date(0));
  ```
- `RC=1`
- `Test Files  2 failed | 12 passed (14)`
- `Tests  3 failed | 85 passed (88)`
- Failing tests, full name + first assertion failure:
  1. `orca correct — record only (spec §14.3 记-1…记-3) > writes one row keyed by the repository's remote, stamped now` — `record.test.ts:29` — `expect(rows[0].at >= before && rows[0].at <= after).toBe(true)` — expected `true`, received `false` (row stamped at the Unix epoch, outside the `[before, after]` window).
  2. `orca correct — record only (spec §14.3 记-1…记-3) > refuses a second correction on the same decision by the same person, and takes --again` — `record.test.ts:88` — expected stderr to contain `'rejected: correction-already-recorded:'`, received `'rejected: duplicate-correction-id: a correction with id c_33a0d10932f77a50 is already in the store — this exact row has already been recorded'` (a different, id-derived collision path fires first because the constant `at` collapses distinct corrections onto the same id).
  3. `orca correct --close / closing new — guards, lock, order, single write (§14.3 闭-1…闭-8) > E21: --undo-cost overrides the inherited cost; without it, the cost names what it inherited from` — `close.test.ts:175` — `expect(withoutCost.result).toBe(0)` — expected `0`, received `1`.
  - **`injectableClock.test.ts` stayed fully green (4/4 passed)** — every one of its criteria passes an explicit `{ now: () => new Date(INSTANT) }`, so the mutated default branch is never exercised by that file.

**Measured (no prediction to match/differ against): the default-clock corruption is caught, but not by any `injectableClock` criterion — by `record.test.ts`'s epoch-timestamp-in-window check, `record.test.ts`'s duplicate-vs-already-recorded rejection-code check, and `close.test.ts`'s E21 exit-code check, all of which call `correct()` without passing `opts.now`.**

Teardown check: clone's `injectableClock.test.ts` byte-identical to main tree's.

## MP-4 — `record.ts` `correctionRowFrom`: `by` becomes the constant `"panel"`

- Hash before: `3752a12c22030d7460f15db7303a2bedb8b747d17e0288b40e5fd91dbc89b2c8`
- Hash after: `e97788e41fb14b8e8574ac34c66e0e269195587bae3a3c1a246fa185da62c1ee` (differ)
- Diff:
  ```diff
  -    by: input.by,
  +    by: "panel",
  ```
- `RC=1`
- `Test Files  3 failed | 11 passed (14)`
- `Tests  4 failed | 84 passed (88)`
- Failing tests, full name + first assertion failure:
  1. `the correction clock is injectable (Task P, E3 spec §2.3) > correctionRowFrom stamps \`at\` from the injected clock, not the wall clock` — `injectableClock.test.ts:68` — expected `'amy'`, received `'panel'`.
  2. `the correction clock is injectable (Task P, E3 spec §2.3) > the same input with the same injected clock yields the same stored id, matching the golden Task 7 will assert against` — `injectableClock.test.ts:143` — expected `GOLDEN_ID` `'c_ed266d26d170dd27'`, received `'c_62b2ee0cd3ded912'` (the `ids[0] === ids[1]` check one line above it passed, since both runs now derive from the same constant `by`; the golden-literal check is what caught it).
  3. `orca correct — record only (spec §14.3 记-1…记-3) > writes one row keyed by the repository's remote, stamped now` — `record.test.ts:28` — expected `'amy'`, received `'panel'`.
  4. `both CLI modes construct their correction the same way (E3 spec §2.3) > close mode stores the row the person described, not just a self-consistent one` — `recordSeam.test.ts:180` — expected `'amy'`, received `'panel'`.
  - Within `injectableClock.test.ts`, criteria 2 and 3 (record mode / close mode "stores at === INSTANT") stayed green — they only assert on `.at`, never on `.by`, so a `by` corruption is invisible to them.

**Measured (no prediction): red in 2 of the 4 injectableClock criteria (1 and 4, both of which assert on `by` or on the golden id that folds `by` in) plus one criterion each in `record.test.ts` and `recordSeam.test.ts`; injectableClock criteria 2 and 3 stayed green because they never inspect `by`.**

Teardown check: clone's `injectableClock.test.ts` byte-identical to main tree's.
