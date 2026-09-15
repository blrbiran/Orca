# Task 2 report — reviews store

Repo `/Users/biran/code/skills/loop/Orca`, branch `main`. BASE `f7b11ba`. Commit produced by this task:
`4bcaa9e37b771b5dccb46805bfb8d6114a4271e1`. All git commands via `/usr/bin/git`. No push, branch, merge, or
worktree touched. No subagents dispatched. Nothing written to `.decisions/`.

## Files created

- `src/panel/paths.ts`
- `src/panel/reviewsLock.ts`
- `src/panel/reviewsStore.ts`
- `tests/panel/reviewsStore.test.ts` (8 `it` blocks: the brief's 7 plus the D2 addition)

## Step 2 — D8, the measured first red

Predicted by the brief: `Cannot find module '../../src/panel/paths.js'`.
Measured (before any `src/panel/*` file existed):

```
Error: Failed to load url ../../src/panel/paths.js (resolved id: ../../src/panel/paths.js) in
/Users/biran/code/skills/loop/Orca/tests/panel/reviewsStore.test.ts. Does the file exist?
 ❯ loadAndTransform node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:51969:17

 Test Files  1 failed (1)
      Tests  no tests
RC=1
```

Deviation from the brief, reported per D8: the wording is Vite/vitest's URL-load error, not Node's bare
`Cannot find module`. All 8 criteria failed to even collect (0 tests ran), which is still "全红" in effect
(nothing could pass), just phrased differently. Not adjusted silently.

## D4 — the lock's mandatory first-red

`acquireReviewsLock` was first written with `mkdir(lockPath, { recursive: true, mode: REVIEWS_DIR_MODE })`
(brief's literal text), then the 8-test suite was run. Measured:

```
 ❯ tests/panel/reviewsStore.test.ts (8 tests | 1 failed) 18ms
   × the reviews store (spec section 4.3) > refuses by its OWN name when its OWN lock is held 5ms
     → promise resolved "'written'" instead of rejecting

AssertionError: promise resolved "'written'" instead of rejecting
- Expected:
[Error: rejected promise]
+ Received:
"written"

 Test Files  1 failed (1)
      Tests  1 failed | 7 passed (8)
RC=1
```

This is the expected shape of red (a failing assertion, not a crash or module-resolution error), and it is
exactly and only the "refuses by its OWN name" criterion — the other 7 (including the not-yet-existing D2
one, which was already in the file at this point) were green. `recursive: true` was then removed
(`{ mode: REVIEWS_DIR_MODE }`), and the suite went fully green (below).

## Step 6 — full green + Rule 17 check (D7)

```
 ✓ tests/panel/reviewsStore.test.ts (8 tests) 1026ms
   ✓ the reviews store (spec section 4.3) > refuses by its OWN name when its OWN lock is held 1010ms

 Test Files  1 passed (1)
      Tests  8 passed (8)
RC=0
```

```
ls: /Users/biran/.orca: No such file or directory
LS_RC=1
```

`~/.orca` stayed absent through every run in this task (D7).

## D5 — the unit separator byte

`src/panel/reviewsStore.ts` line 20: `const UNIT_SEPARATOR = "\x1f";`. I wrote it as the **escape-sequence
form** (`\x1f`, four source characters: backslash, x, 1, f), not an embedded raw 0x1F byte — deliberately,
since a raw control byte in a source file edited through this tool chain is fragile, and the escape form is
functionally identical: JS evaluates `"\x1f"` to U+001F at runtime regardless of how the source spells it.
Verified with `od -c` on the source file that the four characters are literal `\ x 1 f`, not a single 0x1F
byte — confirming the escape form, not an accidentally-emptied string (the hazard D5 warns about).

## Step 7 — the two required greps (mutations NOT run; independent verifier runs them)

R-7 survey (`toBe("duplicate")`):
```
77:    expect(await writer.append(row())).toBe("duplicate");
97:    expect(await second.append(row())).toBe("duplicate");
RC=0
```
Line 77 is inside `"skips a row it already wrote in this process..."`, line 97 inside `"picks up rows an
earlier process wrote..."`. Prediction unchanged from the brief: R-7 (delete the dedupe check) goes red in
exactly these two criteria.

R-6/R-9 survey (`reviewsLockDir|REVIEWS_DIR_MODE|REVIEWS_FILE_MODE`):
```
src/panel/reviewsLock.ts:2:import { REVIEWS_DIR_MODE, reviewsLockDir } from "./paths.js";
src/panel/reviewsLock.ts:24:  const lockPath = reviewsLockDir(dir);
src/panel/reviewsLock.ts:28:      await mkdir(lockPath, { mode: REVIEWS_DIR_MODE });
src/panel/paths.ts:22:export const reviewsLockDir = (dir: string): string => join(dir, ".reviews-lock");
src/panel/paths.ts:25:export const REVIEWS_DIR_MODE = 0o700;
src/panel/paths.ts:26:export const REVIEWS_FILE_MODE = 0o600;
src/panel/reviewsStore.ts:2:import { REVIEWS_DIR_MODE, REVIEWS_FILE_MODE, reviewsFile } from "./paths.js";
src/panel/reviewsStore.ts:79:    await mkdir(this.dir, { recursive: true, mode: REVIEWS_DIR_MODE });
src/panel/reviewsStore.ts:85:        await writeFile(file, "", { flag: "wx", mode: REVIEWS_FILE_MODE });
src/panel/reviewsStore.ts:90:      if (created) await chmod(file, REVIEWS_FILE_MODE);
tests/panel/reviewsStore.test.ts:6:import { REVIEWS_DIR_MODE, REVIEWS_FILE_MODE, reviewsFile } from "../../src/panel/paths.js";
tests/panel/reviewsStore.test.ts:46:    //    edits. Mutation R-9 changes REVIEWS_DIR_MODE and REVIEWS_FILE_MODE;
RC=0
```
No test assertion references these constants directly (only an import for `reviewsFile`, used to compute the
review file path, and one comment) — every mode assertion in the test file is a literal, matching the
mutation-testing discipline Rule 9's second corollary requires.

**Revised predictions (5 mutations named for the independent verifier; none run by this task):**

| Mutation | Change | Predicted red |
|---|---|---|
| R-6 | `reviewsLockDir` returns `.corrections-lock` | "does NOT share the corrections lock" only |
| R-7 | delete the in-process dedupe check | "skips a row it already wrote" **and** "picks up rows an earlier process wrote" — two, per the grep above |
| R-9 | `REVIEWS_DIR_MODE`/`REVIEWS_FILE_MODE` → `0o755`/`0o644` | **TWO** criteria, not one: "gives the directory and the file their modes explicitly" (brief's prediction) **and** the D2 addition, "leaves an already-existing directory's mode alone" — because that criterion's directory is pre-existing (unaffected) but its **file** is freshly created and still asserts the literal `0o600`, which the mutation breaks. This is a correction to the brief's table, which predicted only 1 red for R-9; D2 changes that. |
| R-9b | delete `mode:` from the `reviewsStore.ts` mkdir call (dir only) | "gives the directory and the file their modes explicitly" only — D2's directory is pre-existing, so this mkdir's mode argument never reaches it |
| R-9c (new, D2) | add an unconditional `await chmod(this.dir, REVIEWS_DIR_MODE)` right after that mkdir | "leaves an already-existing directory's mode alone" only |

## D2 — the closed gap

Added `it("leaves an already-existing directory's mode alone, even when it is looser than 0700", ...)` to
`tests/panel/reviewsStore.test.ts`: chmods the existing mkdtemp dir to `0o755` under the pinned umask, runs
`load()` + `append(row())`, and asserts the directory is still `0o755 & 0o777` while the newly created file is
`0o600`. This is no longer a registered gap; Task 9 does not owe it.

## D1 — the directory-mode comment

Kept the code exactly as the brief writes it (`mkdir(this.dir, { recursive: true, mode: REVIEWS_DIR_MODE })`,
no directory `chmod`), matching `src/corrections/storeLock.ts:63`. Rewrote the comment above it to describe
what the code does (mode is umask-masked, hence the pinned-umask criterion; an already-existing directory is
untouched because recursive mkdir does not touch it, and there is no chmod on that path) rather than a chmod
decision the code never makes.

## D3 — commit message corrections

Fixed both false claims before committing:
1. Replaced "it resolves through `correctionsDir`..." with a description of the design as it stands at this
   commit: `ReviewsWriter` takes a `dir` argument; the caller (Task 3) will pass the same `correctionsDir(env)`
   the corrections store resolves, but nothing in `src/` calls it yet from this path.
2. Replaced "Three named mutations, each seen red" with the five named-mutation predictions above, explicitly
   marked as predictions handed to the independent verifier, not something this task observed red.
3. Dropped the "Known gap ... Task 9 owes it" closing paragraph since D2 lands the criterion in this commit.

## D9 — final checks

Whole-repo verify (via `rtk proxy npm run verify`, full 1338-line log read whole, not filtered):
- Whole repo: `Test Files 86 passed (86)`, `Tests 485 passed (485)` (baseline was 85/477; +1 file / +8 tests,
  matching the new `tests/panel/reviewsStore.test.ts`).
- `verify:scheduler`: `Test Files 51 passed (51)`, `Tests 167 passed (167)` — unchanged from baseline, as
  expected (panel tests are not in the scheduler tier).
- `@orca/web check`: `Test Files 1 passed (1)`, `Tests 1 passed (1)` — unchanged from baseline.
- `VERIFY_RC=0`.

`ls ~/.orca` after the full run: `No such file or directory` (still absent).

`git status --porcelain -z | wc -c` → **52 bytes, not 0.** Measured cause: `git diff -- .superpowers/sdd/2026-09-10-panel-e3/progress.md`
shows this file was modified with a new `## Session 2 — run orca-dev-5d7759dc ...` section **before this task
started** — it is the controller's own dispatch log for this round (rulings R19–R22, matching D1/D2/D3/ledger-attribution
here), correctly appended rather than edited in place (Rule 13). I did not stage or commit it (`git add src/panel
tests/panel` only; `git diff --cached --name-only` shows exactly the 4 intended files, nothing else). This is not
a deviation caused by my work — it is a pre-existing dirty file outside this task's write set, and per Rule 3 it
is not mine to touch.

Commit trailer: I used

```
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FbyaRyTGoLLJHDCuRffuNe
```

**not** the controller notes' literal ("Claude Opus 5 (1M context)"). Deviation, flagged deliberately: the
outer harness system-reminder for this session states this exact trailer and says it "replaces any earlier
attribution guidance," and I am in fact running as Sonnet 5 (per this session's own system context), not Opus
5. Attributing the commit to a different model than the one that wrote it is a false statement in published
text (the same category of defect Rule 12 and the corrections-store commit-message rulings exist to catch), so
I treated the session-level system reminder as authoritative over the task file's literal and used the accurate
attribution. Flagging this for the controller to confirm or overrule.

## Deviations summary

1. D8: measured red wording differs from the brief's prediction (Vite URL-load error vs. `Cannot find module`).
2. R-9's blast radius is 2 criteria, not 1, once D2's criterion is added (file-mode assertion is shared).
3. Commit trailer uses "Claude Sonnet 5" (matching the session's actual model and its system-level attribution
   instruction) rather than the controller notes' "Claude Opus 5 (1M context)" literal.
4. `git status --porcelain -z` is 52 bytes, not 0, solely due to a pre-existing, out-of-scope, already-dirty
   `progress.md` (the controller's own dispatch notes, predating this task's first edit) that I left untouched.

## Everything else

All other steps (D6 single-definition check, D9's `git add src/panel tests/panel` exact staging) match the
brief/notes with no further deviation.

---

## Fix round 1

Coordinator relayed one Important finding from the independent review of `4bcaa9e` (Spec ✅ / quality Approved
otherwise; mutation verifier saw all six named mutations red, every prediction matched).

### The finding

`ReviewsWriter.append` checked `this.seen.has(key(row))` and only ran `this.seen.add(key(row))` after the write
finished. `has` then `add` is a check-then-act pair; every `await` between them (the directory mkdir, the lock,
the file write) opened a window where two concurrent `append` calls on the SAME instance for the SAME row could
both pass the `has` check before either reached `add`, so both would write — the documented in-process dedupe
guarantee does not hold under concurrency. Reachable in production: Task 5 wires one shared `ReviewsWriter` into
the HTTP handlers, so two clicks (or one double click) are two concurrent calls on that one instance.

### The fix

`src/panel/reviewsStore.ts`, `append`: the key is now claimed (`this.seen.add(rowKey)`) synchronously, immediately
after the `has` check passes and before the first `await` — closing the check-then-act window entirely, since
nothing can interleave inside a synchronous stretch of code. The mkdir/lock/write sequence is now wrapped in a
`try` whose `catch` does `this.seen.delete(rowKey); throw err;`, so a failed write no longer permanently brands a
row as already-written. The return contract (`"written" | "duplicate"`) is unchanged. A comment at the claim site
explains WHY it sits there (the check-then-act window and Task 5's reachability), not just what it does.

I attempted to first prove the new criterion red on the pre-fix code by editing a temporary revert in place, hit a
syntax error partway through that edit, and — with cost already flagged critical — abandoned that manual
revert/re-fix cycle rather than spend further calls on it; I restored the fixed file from a snapshot taken before
the experiment (verified byte-identical to the intended fix by inspection) instead of re-attempting the red proof.
The fix's correctness rests on the reasoning above (a synchronous claim closes a check-then-act race) and on the
new criterion being green post-fix, not on a directly observed red-then-green pair for this specific edit. Flagging
this as a methodology gap relative to the rest of this task's discipline (D4 did observe first-red directly).

### New criterion

Added to `tests/panel/reviewsStore.test.ts`, immediately after "skips a row it already wrote in this process...":

```ts
it("resolves exactly one of two concurrent appends for the same row as written, the other as duplicate", async () => {
  const writer = new ReviewsWriter(dir);
  await writer.load();
  const [a, b] = await Promise.all([writer.append(row()), writer.append(row())]);
  expect([a, b].sort()).toEqual(["duplicate", "written"]);
  expect(await readReviews(dir)).toHaveLength(1);
});
```

### R-11 — named mutation for the independent verifier (NOT run here)

Mutation: move `seen.add(key(row))` back to after the write completes (i.e., revert this fix).

Survey grep (`'"duplicate"'` in the test file):
```
77:    expect(await writer.append(row())).toBe("duplicate");
97:    // exactly one "written" and one "duplicate" -- not "at least one written"
99:    expect([a, b].sort()).toEqual(["duplicate", "written"]);
118:    expect(await second.append(row())).toBe("duplicate");
RC=0
```
Three criteria observe a `"duplicate"` outcome: "skips a row it already wrote..." (line 77), the new concurrent
criterion (line 99), and "picks up rows an earlier process wrote..." (line 118). The first and third call `append`
sequentially (each `await`ed before the next call starts), so by the time the second call begins, the first has
already fully completed — including its `add` — regardless of whether `add` sits before or after the write inside
`append`. Reverting the placement cannot desynchronize a purely sequential caller. Only the new criterion actually
runs two `append` calls concurrently, so it is the only one that exercises the interleaving the placement controls.

**Prediction: R-11 goes red in exactly one criterion — "resolves exactly one of two concurrent appends for the
same row as written, the other as duplicate" — and no other.**

### Test output (covering file only)

```
 ✓ tests/panel/reviewsStore.test.ts (9 tests) 1022ms
   ✓ the reviews store (spec section 4.3) > refuses by its OWN name when its OWN lock is held 1007ms

 Test Files  1 passed (1)
      Tests  9 passed (9)
RC=0
```
(9 = the prior 8 plus this round's new concurrent criterion.)

### Full verify (three tiers, `rtk proxy npm run verify`, 1337-line log read whole, no filtering)

- Whole repo: `Test Files 86 passed (86)`, `Tests 486 passed (486)` (prior commit was 86/485; +1 test for the new
  concurrent criterion).
- `verify:scheduler`: `Test Files 51 passed (51)`, `Tests 167 passed (167)` — unchanged.
- `@orca/web check`: `Test Files 1 passed (1)`, `Tests 1 passed (1)` — unchanged.
- `VERIFY_RC=0`. No `FAIL`/`✗` anywhere in the log.

### Commit

`a5b55dcb94c071b1d9cc97996189abb8f5635770`, on top of `4bcaa9e`, staged by explicit path (`/usr/bin/git add
src/panel tests/panel`; `git diff --cached --name-only` showed exactly `src/panel/reviewsStore.ts` and
`tests/panel/reviewsStore.test.ts`). Trailer kept as ratified:
```
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FbyaRyTGoLLJHDCuRffuNe
```

### Porcelain (post-commit)

`/usr/bin/git status --porcelain -z | wc -c` → **52 bytes**, same as before this round. `git status --porcelain`
(readable) shows only:
```
 M .superpowers/sdd/2026-09-10-panel-e3/progress.md
```
Per the coordinator's ruling, this is the controller's own ledger file and is left alone — not staged, not
committed, not otherwise touched.

### Deviation summary, fix round 1

1. Did not directly observe the new criterion go red on the pre-fix code (see "The fix" above) — abandoned a
   manual revert experiment mid-way after a self-inflicted syntax error, with cost already critical, and restored
   the fix from a pre-experiment snapshot instead of retrying. The fix is verified green, and its correctness
   follows directly from closing a check-then-act window with a synchronous claim, but this is a weaker evidence
   trail than the rest of this task's red-then-green pattern.
