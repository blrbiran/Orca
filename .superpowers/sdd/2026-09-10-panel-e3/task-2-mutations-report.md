# Task 2 — independent mutation verification report

Commit under test: `4bcaa9e37b771b5dccb46805bfb8d6114a4271e1`
(`feat(panel): give reviews their own store, their own lock and their own modes`) — confirmed to be repo HEAD
throughout this run (`/usr/bin/git rev-parse HEAD` before and after: identical).

Code under test: `src/panel/paths.ts`, `src/panel/reviewsLock.ts`, `src/panel/reviewsStore.ts`.
Criteria: `tests/panel/reviewsStore.test.ts` (8 `it` blocks).

I did not write this code and did not fix or improve anything. Every mutation below was made, run, and reverted in
its own throwaway `git clone --local` (see procedure in the brief); the main tree was never edited.

## Main-tree integrity (Rule 15 / Rule 17 discipline)

| | command | result |
|---|---|---|
| before | `/usr/bin/git status --porcelain -z \| wc -c` | 52 bytes |
| before | `/usr/bin/git rev-parse HEAD` | `4bcaa9e37b771b5dccb46805bfb8d6114a4271e1` |
| after | `/usr/bin/git status --porcelain -z \| wc -c` | 52 bytes |
| after | `/usr/bin/git rev-parse HEAD` | `4bcaa9e37b771b5dccb46805bfb8d6114a4271e1` |

Both readings list exactly one dirty entry, `.superpowers/sdd/2026-09-10-panel-e3/progress.md` (the controller's
ledger, expected to be dirty per the brief). Byte-for-byte `diff` of the two porcelain captures: identical. No file
under `src/`, `tests/`, `web/` or `.decisions/` ever appeared. This report is the only file this run wrote inside the
main tree.

## Baseline (unmutated clone)

`RUN v2.1.9 <tmp clone path>/orca` — confirms vitest ran against the clone, not the main tree.

```
Test Files  1 passed (1)
     Tests  8 passed (8)
RC=0
```

All 8 green as required. Proceeding to mutations.

## Per-mutation results

### R-6 — `reviewsLockDir` returns `join(dir, ".corrections-lock")`

- File: `src/panel/paths.ts`. Anchor matched exactly once.
- sha256 before: `c412a53d...25fc0e` → after: `01f7ccf6...900afdae` (changed — mutation landed).
- Diff:
  ```
  22c22
  < export const reviewsLockDir = (dir: string): string => join(dir, ".reviews-lock");
  ---
  > export const reviewsLockDir = (dir: string): string => join(dir, ".corrections-lock");
  ```
- RC=1. Vitest: `1 failed | 7 passed (8)`.
- Failing criterion: **`does NOT share the corrections lock: holding that one must not block a review`**
  - First failure: `tests/panel/reviewsStore.test.ts:109:40` —
    `promise rejected "PanelRejection: another orca panel is wri…" instead of resolving`, cause:
    `Serialized Error: { code: 'reviews-store-busy', exitCode: 5 }` at `src/panel/reviewsLock.ts:33`.
- Prediction: red in that one criterion, and only it. **Matched.**

### R-7 — delete `if (this.seen.has(key(row))) return "duplicate";` from `append`

- File: `src/panel/reviewsStore.ts`. Anchor (with its own indentation, `    if (this.seen.has(key(row))) return "duplicate";\n`) matched exactly once.
- sha256 before: `2a09cfb9...c8a5b0d5` → after: `8738db5d...11f7ecbb` (changed).
- Diff:
  ```
  70d69
  <     if (this.seen.has(key(row))) return "duplicate";
  ```
- RC=1. Vitest: `2 failed | 6 passed (8)`.
- Failing criteria (both, as predicted):
  1. **`skips a row it already wrote in this process, keyed by decision, person and action`**
     — `tests/panel/reviewsStore.test.ts:77:40`, `expected 'written' to be 'duplicate'`.
  2. **`picks up rows an earlier process wrote, so dedupe survives a restart`**
     — `tests/panel/reviewsStore.test.ts:97:40`, `expected 'written' to be 'duplicate'`.
- Prediction: red in exactly those two, not one. **Matched.**

### R-9 — `REVIEWS_DIR_MODE` → `0o755`, `REVIEWS_FILE_MODE` → `0o644`

- File: `src/panel/paths.ts`. Both anchors matched exactly once each.
- sha256 before: `c412a53d...25fc0e` → after: `e7cbd1b7...0560528519ccc3a` (changed).
- Diff:
  ```
  25,26c25,26
  < export const REVIEWS_DIR_MODE = 0o700;
  < export const REVIEWS_FILE_MODE = 0o600;
  ---
  > export const REVIEWS_DIR_MODE = 0o755;
  > export const REVIEWS_FILE_MODE = 0o644;
  ```
- RC=1. Vitest: `2 failed | 6 passed (8)`.
- Failing criteria (both):
  1. **`gives the directory and the file their modes explicitly, not from the umask`**
     — `tests/panel/reviewsStore.test.ts:53:44`, `expected 493 to be 448` (dir-mode assertion; the
     earlier of the two assertions in this `it`, so it short-circuits before the file-mode line is ever reached).
  2. **`leaves an already-existing directory's mode alone, even when it is looser than 0700`**
     — `tests/panel/reviewsStore.test.ts:70:57`, `expected 420 to be 384` (the *file*-mode assertion on
     line 70; the dir-mode assertion on line 69 stays green here because the directory pre-exists at `0o755` and
     the mutated `REVIEWS_DIR_MODE` never reaches an existing directory).
- Prediction: the implementer's corrected count of **two** criteria, and specifically that the second criterion
  fails on its *file*-mode half. **Matched exactly**, including which assertion inside each `it` trips first
  (answers question 1 of the brief's three: yes, an earlier assertion in the first criterion masks nothing extra
  here — the dir-mode assertion is itself the named failure — but the *second* criterion's dir assertion does
  legitimately stay green because it targets a different, pre-existing directory).

### R-9b — delete `mode: REVIEWS_DIR_MODE` from the `mkdir(this.dir, …)` call

- File: `src/panel/reviewsStore.ts`. Anchor matched exactly once.
- sha256 before: `2a09cfb9...c8a5b0d5` → after: `524e8a4a...34a827ffe392` (changed).
- Diff:
  ```
  79c79
  <     await mkdir(this.dir, { recursive: true, mode: REVIEWS_DIR_MODE });
  ---
  >     await mkdir(this.dir, { recursive: true });
  ```
- RC=1. Vitest: `1 failed | 7 passed (8)`.
- Failing criterion: **`gives the directory and the file their modes explicitly, not from the umask`**
  — `tests/panel/reviewsStore.test.ts:53:44`, `expected 493 to be 448` (dir-mode assertion; masked by umask 0o022
  applied to Node's default 0o777, giving 0o755 = 493 decimal instead of the expected 0o700 = 448).
- Prediction: red in that one criterion, and only it — the existing-directory criterion's directory is
  pre-existing so this `mkdir`'s mode never reaches it. **Matched.**

### R-9c — add unconditional `await chmod(this.dir, REVIEWS_DIR_MODE);` right after that `mkdir`

- File: `src/panel/reviewsStore.ts`. Anchor (the full `mkdir` line, matched exactly once) used as an insertion
  point; inserted the `chmod` line immediately after it.
- sha256 before: `2a09cfb9...c8a5b0d5` → after: `029ee8e2...93ca1acebbb0723ab5095b5d4ff9dd` (changed).
- Diff:
  ```
  79a80
  >     await chmod(this.dir, REVIEWS_DIR_MODE);
  ```
- RC=1. Vitest: `1 failed | 7 passed (8)`.
- Failing criterion: **`leaves an already-existing directory's mode alone, even when it is looser than 0700`**
  — `tests/panel/reviewsStore.test.ts:69:44`, `expected 448 to be 493` (the directory, pre-chmod'd to `0o755` by
  the test, gets forcibly reset to `0o700` by the unconditional chmod, so the dir-mode assertion — the first one in
  the `it`, so no short-circuit question applies — fails; received `448` (0o700) where `493` (0o755) was expected).
- Prediction: red in that one criterion, and only it. **Matched.** The brief flagged this as the mutation that
  decides whether this round's new criterion is load-bearing at all, with instructions to say plainly if it came
  back green. It did **not** come back green — it is red, exactly as predicted, and only for the named criterion.
  **Finding, stated plainly: this criterion is load-bearing.** It catches an unconditional-chmod regression that
  the other seven criteria in this file do not catch (none of the other seven put a non-default mode on the
  directory before calling `append`).

### R-10 — put `recursive: true` back into the `mkdir(lockPath, …)` call in `reviewsLock.ts`

- File: `src/panel/reviewsLock.ts`. Anchor matched exactly once.
- sha256 before: `2830149d...7883c112ea9cda` → after: `b5a50b77...9a34a5e2cb7e64` (changed).
- Diff:
  ```
  28c28
  <       await mkdir(lockPath, { mode: REVIEWS_DIR_MODE });
  ---
  >       await mkdir(lockPath, { recursive: true, mode: REVIEWS_DIR_MODE });
  ```
- RC=1. Vitest: `1 failed | 7 passed (8)`. Whole-file run duration dropped to 269ms (vs. baseline's ~1.3s) because
  this mutation removes the EEXIST signal the lock depends on: `mkdir` with `recursive: true` succeeds silently
  against an already-existing directory instead of throwing, so `acquireReviewsLock` never detects the held lock
  and never has to wait out `REVIEWS_LOCK_TIMEOUT_MS` (1s) before rejecting — it just returns immediately as if it
  had acquired the lock.
- Failing criterion: **`refuses by its OWN name when its OWN lock is held`**
  — `tests/panel/reviewsStore.test.ts:119:40`, `promise resolved "'written'" instead of rejecting`.
- Prediction: red in that one criterion, and only it. **Matched.** (The implementer's claim of having seen this
  red before removing `recursive` is corroborated independently here, on the committed code, in a clean clone.)

## Summary

All six mutations landed (every `shasum` changed), every teardown `cmp` confirmed
`tests/panel/reviewsStore.test.ts` was byte-identical to the main tree's copy (no leakage into the criteria file),
and every vitest `RUN` line pointed into the throwaway clone's temp path, never into the main tree. All six
predictions matched exactly — failing-criterion count, names, and (where checked) which assertion inside a
multi-assertion `it` actually trips. No compile/collection/module-resolution errors occurred (no broken
mutations). No false reds were declared; none were needed — every observed result agreed with the brief's
hypothesis on inspection, so the three investigative questions did not need to be invoked to explain a
discrepancy.

## Fix round 1 — R-11

Commit under test: `a5b55dcb94c071b1d9cc97996189abb8f5635770`
(`fix(panel): claim the review dedupe key before the write, not after`), on top of `4bcaa9e`. Confirmed to be repo
HEAD throughout this run (`/usr/bin/git rev-parse HEAD` before and after: identical).

This section is independent of everything above it: dispatched separately, working in its own throwaway clone,
never touching the main tree. It measures the ONE new criterion the fix round added — the concurrency criterion —
which the implementer never witnessed red on the pre-fix code (its own repro attempt hit a syntax error and it
restored from a snapshot rather than retrying). This run is that criterion's only red-proof.

**Main-tree integrity**

| | command | result |
|---|---|---|
| before | `/usr/bin/git status --porcelain -z > f; wc -c < f` | 52 bytes — ` M .superpowers/sdd/2026-09-10-panel-e3/progress.md` (the controller's ledger; nothing under `src/`, `tests/`, `web/` or `.decisions/`) |
| before | `/usr/bin/git rev-parse HEAD` | `a5b55dcb94c071b1d9cc97996189abb8f5635770` |
| after | `/usr/bin/git status --porcelain -z > f; wc -c < f` | 52 bytes — identical single line |
| after | `/usr/bin/git rev-parse HEAD` | `a5b55dcb94c071b1d9cc97996189abb8f5635770` |

**Baseline** (unmutated clone, before any edit): `./node_modules/.bin/vitest run tests/panel/reviewsStore.test.ts`
→ `Test Files 1 passed (1)`, `Tests 9 passed (9)`, `RC=0`. All 9 criteria green (the original 8 plus the new
concurrency one), as expected.

**R-11 — move `this.seen.add(rowKey)` from before the try (synchronous claim) to after the write completes,
right before `return "written"`**

- File: `src/panel/reviewsStore.ts`.
- First attempt at the anchor script was a broken run, reported for the record rather than hidden (Rule 12): my
  own anchor string dropped one line of the source comment (`// umask explicitly rather than trusting the
  developer's. An`), so the exactly-once anchor assertion found 0 occurrences, the script exited non-zero, and the
  file was never touched — `shasum` before/after that attempt were identical, which is exactly the "unmutated ≠
  green" signal the brief calls out. Fixed the anchor and re-ran on the same clone before doing anything else.
- Corrected attempt: anchor matched exactly once.
- sha256 before: `47bf4c6c288aa474c3eec9899e9383f305316622d08249ddec6090e2e1ac2a1a` → after:
  `8963dcbc7c565ec3b8146ddc8fac6223467b1604ff179f6a1c94a9f6896ab5c5` (changed — mutation landed).
- Diff (`/usr/bin/git -C "$C" diff -- src/panel/reviewsStore.ts`):
  ```diff
  @@ -80,7 +80,6 @@ export class ReviewsWriter {
       // production, not just in theory. Removed again in the `catch` below if
       // the write itself fails, so a failed write does not permanently brand a
       // row as already-written.
  -    this.seen.add(rowKey);
       try {
         // `mode` here is masked by the umask, which is why the criterion pins the
         // umask explicitly rather than trusting the developer's. An
  @@ -109,6 +108,7 @@ export class ReviewsWriter {
         this.seen.delete(rowKey);
         throw err;
       }
  +    this.seen.add(rowKey);
       return "written";
     }
   }
  ```
  This is a minimal, single-line move — it does not restructure the surrounding try/catch (unlike the actual
  pre-fix commit `4bcaa9e`, which had no outer try/catch/rollback around the write at all; that wrapper is new in
  the fix and orthogonal to R-11 as specified in the brief). One side effect worth naming per the brief's ask: the
  `catch (err) { this.seen.delete(rowKey); ... }` block is now dead code on this path — it deletes a key that was
  never added yet, since `add` no longer runs until after the try/catch completes without throwing. That block
  neither fires nor matters for this mutation's outcome.
- RC=1. Vitest: `Test Files 1 failed (1)`, `Tests 1 failed | 8 passed (9)`.
- Failing criterion (exactly one): **`the reviews store (spec section 4.3) > resolves exactly one of two
  concurrent appends for the same row as written, the other as duplicate`**
  — `tests/panel/reviewsStore.test.ts:99:27`, `AssertionError: expected [ 'written', 'written' ] to deeply equal
  [ 'duplicate', 'written' ]` (received `["written","written"]`, expected `["duplicate","written"]`).
  This is the dedupe assertion itself (`expect([a, b].sort()).toEqual(["duplicate", "written"])`), not the
  row-count assertion on the next line, and not any assertion in another `it` — no leftover-key-after-thrown-write
  failure occurred, because no write throws in this test at all. So this mutation pins the dedupe race directly;
  it does not (in this run) exercise the rollback/`catch` path.
- The two pre-existing dedupe criteria named in the brief —
  `skips a row it already wrote in this process, keyed by decision, person and action` and
  `picks up rows an earlier process wrote, so dedupe survives a restart` — **stayed green**. Both `await` each
  `append` call in sequence rather than firing them concurrently, so the check-then-act window this mutation
  reopens is never entered in either of those tests; there is no race for them to observe.
- Prediction: red in the new concurrency criterion, and only it; whether the two sequential dedupe criteria also
  go red was left open to measure. **Matched**: exactly one criterion failed (the concurrency one), the two
  sequential dedupe criteria stayed green, and no criterion failed for a reason other than the dedupe assertion.
  No false red to investigate — the three questions (short-circuit / other callers of the changed line / where the
  literal comes from) were not needed.
- **Finding, stated plainly, per the brief's framing**: this is NOT a green mutation. R-11 reproduces the
  concurrent-double-write bug and the new criterion catches it, on the very commit that fixes it, in a clean
  throwaway clone. Since the implementer never got this criterion red on the pre-fix code, this run is that
  criterion's only independent red-proof — and it holds: the criterion is load-bearing, not empty, and the fix is
  pinned.
- Teardown: `cmp` of the clone's `tests/panel/reviewsStore.test.ts` against the main tree's copy — identical
  (`CMP_RC=0`); clone removed with `/bin/rm -rf "$(dirname "$C")"` (local `rm` aliased to `-i`, not overridden).
