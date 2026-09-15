# Task 9 report — verify:panel (CLAUDE.md Rule 4's success criterion)

Repo `/Users/biran/code/skills/loop/Orca`, branch `main`. BASE `d44f6bb`. Commit produced: `1a95e7d`.

## Files touched

- Created: `scripts/verify-panel.ts` (774 lines), `tests/panel/endToEnd.test.ts` (47 lines)
- Modified: `package.json` (+3/-1: `verify` string, `verify:panel` script entry)
- NOT modified: `tests/panel/reviewsStore.test.ts` (see L1 below)

Controller files under `.superpowers/sdd/2026-09-10-panel-e3/progress.md` and `.decisions/orca-dev-5d5c8055.jsonl`
were never staged or edited (confirmed in the post-commit porcelain below).

## L1 — Step 1 (Task 2's registered gap)

Measured (`node -e` mkdtemp+stat, umask pinned to 0o022 as the existing test does):
`mkdtemp mode octal = 700`.

`tests/panel/reviewsStore.test.ts`'s existing criterion `"leaves an already-existing directory's
mode alone, even when it is looser than 0700"` (line 64 at BASE) does:
```
await chmod(dir, 0o755);   // BEFORE writer.load()/append()
...
await writer.append(row());
expect((await stat(dir)).mode & 0o777).toBe(0o755);
```
Since a fresh `mkdtemp` directory is 0700, this criterion's `chmod(dir, 0o755)` genuinely moves the
directory away from what `ReviewsWriter` would otherwise produce, so it is **not** self-consistently
green — it pins real behavior. Under mutation R-9b (`ReviewsWriter.append` chmods an existing
reviews directory to `0o700` after `mkdir`), this criterion's expectation (`0o755`) would no longer
match the actual mode (`0o700`), so it **can go red**.

**Conclusion: the criterion is already adequate. No edit was made to `tests/panel/reviewsStore.test.ts`.**
R-9b's prediction (below) points at this exact test.

## L5 fixture measurements

- Throwaway target repo: `git init`, `origin` remote `https://github.com/biran/orca.git`, one commit,
  then two decisions seeded via `appendEvents` and committed.
- `--repo` key used: the value `projectKeyOf(repoPath)` measures for that remote. `normalizeRemoteUrl`
  (src/corrections/projectKey.ts) turns `https://github.com/biran/orca.git` into `github.com/biran/orca`
  — the same literal `tests/panel/correctApi.test.ts`'s GOLDEN_ID fixture already documents for this
  exact remote. `--repo` itself never checks the key against the remote (src/metrics/discover.ts
  `discoverRepos`: explicit `--repo` entries are keyed by whatever string is given), so this choice is
  for realism/consistency with real `orca correct` usage, not a requirement.
- Both seeded decisions are high tier: `scope`/`kind` chosen by calling `isHighTier` over
  `DECISION_SCOPES × DECISION_KINDS` (never a hard-coded table), mirroring `tests/panel/todo.test.ts`'s
  `findScopeKind`.
- Pre-check dist listing (`web/dist` after `npm run build --workspace web`): exactly `index.html` (335
  bytes) and `index.js` (228522 bytes), no subdirectories, `index.html` contains `TOKEN_ANCHOR`.

## Every mutation prediction

| id | change | prediction |
|---|---|---|
| E-1 | `GET /api/decisions` also appends `opened` for every listed decision | **Step 2** reds: the bounded-absence check (`opened`/`reviewed` == 0 for both decisions, window = `REVIEWS_LOCK_TIMEOUT_MS`+1000ms) catches the fire-and-forget write the listing itself triggers. |
| E-2 | `ReviewsWriter.append` skips its dedupe check (always writes) | **Step 4** reds: re-opening the same decision's detail a second time writes a second `opened` row; the bounded-absence check (`opened(A) == 1`) sees it exceed 1 within the window. Step 3 stays green (first open still lands exactly one row). |
| E-3 | `POST /api/reviews` appends `opened` instead of `reviewed` | **Step 5** reds: `reviewedCount(B)` stays 0 after "agreeing", so the exact-count check fails immediately (synchronous write, no window needed to observe it). |
| E-4 | `POST /api/corrections` also closes the loop in the target repo | **Step 6** reds: the before/after `.decisions/` snapshot (sorted names + sha256) and/or `git rev-parse HEAD` differ, and `git status --porcelain` may be non-empty depending on whether the close commits cleanly. |
| E-5 | the already-recorded branch answers the CLI's `err.message` | **Step 7** reds: the CLI's message ("...Pass --again to record another one on purpose.") contains the literal `--again`, failing the "message never mentions --again" check. |
| E-6 | `currentMetrics` is computed once in `buildApi` and reused | **Step 8 only** reds: decisions A/B are seeded on disk before the panel even starts, so the memoized snapshot from server startup still lists them correctly for steps 1-7. Only step 8's injected unresolvable correction (written to the store *after* startup) needs a fresh `collect()` call to be noticed — the memoized value never re-fires the gate, so `/api/metrics` keeps answering 200 instead of 409. |
| E-7 | the static route is deleted | **Step 9** reds specifically on its positive control: the raw traversal request still answers 404 (no route matches at all), but `GET /` no longer answers 200 with the token in the body. Without that control this mutation would leave step 9 green for the wrong reason — exactly the trap ruling L5 names. |
| E-8 | the `/api` token middleware is deleted | **Step 10** reds: a request with no token now succeeds (200) instead of 401 `TOKEN_REQUIRED`. |
| E-9 | `assertBindAllowed` call is deleted from `createPanelServer` | **Step 11** reds. What the second process does on that run: `192.0.2.1` is on no interface of this machine (confirmed by `tests/panel/security.test.ts`'s own comment, same address), so it does **not** manage to bind or publish anything — `listen()` fails with `EADDRNOTAVAIL`, which is an unhandled rejection at `createPanelServer`'s `listening` promise, propagating out of `startPanelFromArgs`/`runPanel` uncaught by `PanelRejection`'s branch, so `cli.ts`'s top-level catch answers exit 3 with a raw Node stack in stderr. Step 11's check for exit-code-non-zero still passes (3 ≠ 0), but the `stderr.includes(EXTERNAL_BIND_NOT_CONFIRMED)` check fails (that code never appears — the message is a raw `Error: listen EADDRNOTAVAIL 192.0.2.1` stack instead). The lsof-by-pid check would still show nothing (it never actually listened), so that half stays green; the named-refusal check is what catches this mutation. |
| E-10 | `web/vite.config.ts`'s `assetsDir: "."` → `"assets"` | Reds at the **pre-check** (step "0"), before step 1 ever runs: the build now emits a subdirectory (`web/dist/assets/`), failing "web/dist has no subdirectory". |
| E-11 | `parseReadyLine` accepts a line with no `token=` (returns an empty token) | Reds in **`tests/panel/endToEnd.test.ts`**, specifically the must-catch sample for a token=-less line (it no longer throws `ReadyLineParseError`). This is the script's own parser under test directly — the real CLI never emits a token=-less line, so `verify-panel.ts`'s own run would not observe this mutation in practice; the unit test is what pins it. |
| R-9b | `ReviewsWriter.append` chmods an existing reviews directory to `0o700` after `mkdir` | Reds in **`tests/panel/reviewsStore.test.ts`**'s `"leaves an already-existing directory's mode alone..."` criterion (see L1): expected `0o755`, actual becomes `0o700`. |

## Verify tiers and timing

Commands actually run (not filtered/piped; each redirected to a file and read whole, per Rule 14):

- `npm run typecheck` → RC=0.
- `npm test` (whole repo, standalone run before the full chain) → **95 files / 550 tests passed**
  (BASE was 94/545; +1 file `tests/panel/endToEnd.test.ts`, +5 tests, 0 skipped/todo anywhere in the
  output — scanned the whole log for "skip"/"todo"; the only matches were test *names*
  `"...not skipped"` / `noSkips.test.ts`, not an actual skip tally).
- `rtk proxy npm run verify` (full chain) → **VERIFY_RC=0**, wall time **45s** (measured with
  `date +%s` immediately bracketing the command, not vitest's own internal "Duration" field, which
  reports per-worker cumulative time, not wall clock).
  - `npm test` tier inside the chain: 95/95 files, 550/550 tests passed.
  - `npm run ledger -- validate .decisions`: exit 2 (downgraded lines only, no rejected) — accepted by
    the `|| [ $? -eq 2 ]` guard, unchanged from BASE's behavior.
  - `check-claude-md-lines.mjs`: "ok: CLAUDE.md is 143/200 lines". `check-hooks-path.mjs`: ok.
  - `npm run verify:scheduler`: **51/51 files, 167/167 tests** passed (matches BASE's 51/167 exactly).
  - `npm run build --workspace web`: succeeded, emitted flat `dist/index.html` + `dist/index.js`.
  - `npm run verify:panel`: **exit 0**, all 13 PASS lines (steps 0 through 12), 0 FAIL lines.
  - `npm run --ws check` (`@orca/web`): **5 files / 10 tests** passed (matches BASE exactly).

## verify:panel — the 12 steps, this run's PASS lines

```
PASS 0 web/dist exists, is flat, and carries the token anchor
PASS 1 orca panel is up at http://127.0.0.1:<port>, ready line parsed
PASS 2 listing records nothing (opened/reviewed stay 0 for both decisions)
PASS 3 opening a decision's detail records exactly one 'opened' row and no 'reviewed' row
PASS 4 re-opening the same decision's detail does not duplicate the 'opened' row
PASS 5 agreeing records 'reviewed', moves the coverage numerator to 1, and updates the to-do list
PASS 6 recording a correction records it and 'reviewed', and never closes the loop
PASS 7 a second correction on the same decision is refused by name, with the panel's own message
PASS 8 a correction with an unresolvable projectKey makes the next request answer 409 by name
PASS 9 a raw traversal path 404s, and GET / still serves the token-injected index.html
PASS 10 a request with no token is refused by name (401 TOKEN_REQUIRED)
PASS 11 an unconfirmed external bind is refused by name, and the process never listens
PASS 12 panel closed; ~/.orca is unchanged (absent before and after)
```
(Step "0" is the pre-check the controller notes require before step 1 — not one of the brief's twelve,
labelled 0 for clarity; documented as a deviation below.)

## Repeat run — repeatability and residue

Ran `npm run verify:panel` a second time, standalone, with before/after census:

- `ps -axo pid,ppid,pgid,command` filtered to `src/cli.ts`: empty before AND after — `diff` reports no
  difference (rc=0).
- `lsof -nP -iTCP -sTCP:LISTEN`: byte-identical before and after (`diff` rc=0) — no listener left behind.
- `ls -a "$TMPDIR" | sort`: byte-identical before and after (`diff` rc=0) — every `mkdtemp` directory
  the script created (`orca-panel-verify-store-*`, `orca-panel-verify-target-*`) was removed.
- Result: exit 0, 13 PASS lines, 0 FAIL lines, both times.

**A real bug was found and fixed during this repeatability check**, not one of the named mutations:
the first working version's teardown backstop called a `waitForExit(child)` that re-attached a fresh
`child.once("exit", ...)` listener *after* step 12 had already killed and awaited that same child.
Node's `"exit"` event fires exactly once, and a process killed by `SIGKILL` leaves `child.exitCode`
`null` forever (it sets `signalCode` instead, per Node's docs) — so the naive `exitCode !== null`
fast-path never triggered either. The result: the backstop cleanup call hung forever, doing nothing
visibly wrong (no thrown error, no message), while `main()`'s `finally` loop sat there awaiting it —
except it doesn't actually hang the *process* exit, because nothing was still keeping the event loop
alive on the child's side, so npm/tsx returned early and left every mkdtemp directory behind with no
error printed anywhere. Confirmed with a debug trace (`DEBUG entering finally, cleanups.length=3`
printed once, `DEBUG cleanup ok` never printed). Fixed by capturing one `exit`-event promise at spawn
time (`watchExit`, cached as `exited`) and reusing that same promise everywhere a caller needs to know
the child is gone, instead of ever attaching a second listener after the fact. Verified fixed: the
three residue checks above are now all identical before/after.

## Final structural checks (post-commit)

- `git status --porcelain -z | wc -c` → 90 bytes, containing **only**:
  `M .superpowers/sdd/2026-09-10-panel-e3/progress.md` and `?? .decisions/orca-dev-5d5c8055.jsonl`
  (both pre-existing controller files, neither staged nor touched by this task).
- `web/dist` does **not** appear in `git status` (confirmed via `git check-ignore -v web/dist` →
  `.gitignore:22:dist/`).
- `git diff d44f6bb HEAD --stat`:
  ```
  package.json                 |   3 +-
  scripts/verify-panel.ts      | 774 +++++++++++++++++++++++++++++++++++++++++++
  tests/panel/endToEnd.test.ts |  47 +++
  3 files changed, 823 insertions(+), 1 deletion(-)
  ```
  No `Bin` line.
- Byte-scan (bytes < 0x20 other than tab/LF/CR) of every touched file, run after every edit and again
  post-commit: `package.json` 0, `scripts/verify-panel.ts` 0, `tests/panel/endToEnd.test.ts` 0.
- `ls ~/.orca` → `ls: /Users/biran/.orca: No such file or directory` (exit 1) — absent before this
  task, absent after; `verify-panel.ts`'s own step 12 makes the same before/after comparison inside
  the script on every run (ruling R56), so this is not a one-off manual check.

## Deviations from the brief/notes, with reasons

1. **A "step 0" pre-check exists** (dist presence/flatness/anchor), printed as `PASS 0 ...` /
   `FAIL 0 ...`, in addition to the twelve numbered steps. The controller notes require this check to
   run "before starting" but do not assign it a step number; giving it 0 keeps the PASS/FAIL contract
   uniform (one line per checkpoint) without renumbering the brief's canonical 1-12.
2. **`WINDOW_MS` (`REVIEWS_LOCK_TIMEOUT_MS`+1000ms) is reused for the positive-wait in step 3**, not
   only the absence checks the ruling names explicitly. Waiting up to the same budget for the
   fire-and-forget `opened` write to land is the same order-of-magnitude reasoning R59 already uses
   (measured ~500ms in task 6), and reusing one constant is simpler than inventing a second.
3. Every step's PASS line was originally going to be printed twice for steps 2-4 (once from a shared
   `assertStaysAt` helper, once from the step's own summary) — this was a bug caught by manually
   reading the first successful run's output (13→more lines), fixed before the final measured runs
   above by making `assertStaysAt` never print and having exactly one `pass()` call per step.
4. No dependency was added to either `package.json`; `verify-panel.ts` imports only Node builtins and
   this repo's own `src/` modules.

## Registered gap (unchanged, carried per ruling L6)

`reviews.jsonl` has no retention policy, and multi-process duplicate rows are accepted without a
criterion (`src/panel/reviewsStore.ts`'s own comment already documents this as accepted-on-purpose).
Not this task's to fix; re-registered per the controller notes' instruction.

---

## Fix round 1 (review Important I-1 / ruling R61, ruling R62)

Commit `952739d` on top of `1a95e7d` (BASE still `d44f6bb`), new commit, not an amend.

### What changed

1. **`scripts/verify-panel.ts` teardown (ruling R61).** `cleanups` is now
   `Array<{ what: string; run: () => Promise<void> | void }>` instead of a bare array of functions.
   The `finally` loop still runs every item regardless of an earlier failure, but a thrown cleanup now
   prints `FAIL teardown: <what>: <message>` and sets `exitCode = 1` (previously: `console.error`'d a
   "teardown warning" and left `exitCode` untouched, so a run where every step passed but teardown
   silently failed still reported success). A step failure's own `FAIL <n>` line is unaffected — it is
   still printed in the `catch` block, which runs to completion before `finally` ever starts, so
   ordering (step failure first, teardown failures after) falls out of the existing control flow with
   no extra bookkeeping needed.
   - Added `guardedRmRecursive(path, expectedPrefix)`: refuses to `rm(..., {recursive:true,force:true})`
     an empty path or one that does not contain the exact `mkdtemp` prefix this script minted it with.
     Wired into both the fixture-repo cleanup and the `ORCA_CORRECTIONS_DIR` cleanup.
   - Added `withTimeout(promise, ms, message)`: the panel child's teardown ("kill the panel child's
     process group and confirm it exited") now bounds its wait for the cached `exited` promise to
     5000ms, so "a child cannot be confirmed dead" surfaces as a named, timed-out `FAIL teardown` line
     instead of `main()` hanging forever inside the `finally` loop.
2. **`tests/panel/endToEnd.test.ts` (ruling R62).** The must-catch `url=` sample using the literal
   `0.0.0.0` was replaced with `http://198.51.100.1:54321` (RFC 5737 TEST-NET-2) — distinct from the
   file's other non-loopback sample (`192.0.2.1`, TEST-NET-1) so the two must-catch cases stay
   genuinely different. `git grep -n "0\.0\.0\.0"` over the whole tracked tree shows the literal now
   appears only inside comments explaining why it must not be used (this file's own new comment, plus
   pre-existing ones in `tests/panel/security.test.ts` and various `docs/`/`.superpowers/` prose) —
   never as a value a parser sample, fixture, or mutation actually exercises.

### Commands run and outputs

- `npx vitest run tests/panel/endToEnd.test.ts` (redirected, read whole): **5/5 tests passed**, RC=0.
- `npx tsc --noEmit -p tsconfig.json` (root typecheck, run twice — once after each fix): RC=0 both times.
- `npm run verify:panel`, twice in a row, each with a full before/after census:
  - Run 1: 13 PASS lines (steps 0-12), 0 FAIL, RC=0. `lsof -nP -iTCP -sTCP:LISTEN` before/after:
    byte-identical (`diff` rc=0). `ls -a "$TMPDIR" | sort` before/after: byte-identical (`diff` rc=0).
    `ps -axo pid,ppid,pgid,command` filtered to `src/cli.ts` before/after: both empty, `diff` rc=0.
  - Run 2: same — 13 PASS, 0 FAIL, RC=0, all three census diffs rc=0.

### Demonstrating fix 1 without editing the committed code (throwaway `git clone --local`)

1. `/usr/bin/git clone --local /Users/biran/code/skills/loop/Orca <scratchpad>/clone-fix1-demo` →
   cloned at `952739d` (confirmed via `git log --oneline -1` inside the clone).
2. Symlinked `node_modules` at both the clone root and `web/` to the main tree's (`ln -s`), then ran
   `npm run build --workspace web` inside the clone — succeeded, flat `web/dist/{index.html,index.js}`.
3. Edited **only the clone's copy** of `scripts/verify-panel.ts`: the `"remove the throwaway
   ORCA_CORRECTIONS_DIR"` cleanup's `run` was replaced with a function that unconditionally
   `throw new Error("INJECTED DEMO FAULT: pretend the removal failed")`, instead of calling
   `guardedRmRecursive`. Confirmed the main tree was untouched throughout:
   `git diff -- scripts/verify-panel.ts | wc -c` → 0, `git diff --cached -- scripts/verify-panel.ts | wc -c` → 0.
4. Ran `npm run verify:panel` inside the clone. Output: all 13 PASS lines (steps 0-12, every real
   assertion still holds), then:
   ```
   FAIL teardown: remove the throwaway ORCA_CORRECTIONS_DIR: INJECTED DEMO FAULT: pretend the removal failed
   ```
   followed by **RC=1**.
5. Confirmed the OTHER teardown items still ran despite the injected failure:
   - `ps -axo pid,ppid,pgid,command` filtered to `src/cli.ts`, before vs after the clone run: `diff` rc=0
     (no leftover panel process — the process-group kill + exit confirmation cleanup ran fine).
   - `lsof -nP -iTCP -sTCP:LISTEN`, before vs after: `diff` rc=0 (no leftover listener).
   - `$TMPDIR` listing after the run: only `orca-panel-verify-store-88lDhW` (the ONE item whose
     removal was forced to throw) remained; the fixture target repo directory
     (`orca-panel-verify-target-*`) was already gone — the "remove the throwaway target repo" cleanup
     ran and succeeded normally, proving one failing item does not skip the rest.
6. Removed the leftover injected-fault directory (`/bin/rm -rf` on the one named, measured path) and
   then the whole clone (`/bin/rm -rf "${CLONE:?missing CLONE path}"`, guarded per the user's global
   destructive-command rule). Confirmed: `ls "$TMPDIR" | grep -i orca-panel-verify` → no residue;
   the clone directory no longer exists.

### Final structural checks (post fix-round-1 commit)

- `git status --porcelain` → exactly the two pre-existing controller files
  (`.superpowers/sdd/2026-09-10-panel-e3/progress.md` modified, `.decisions/orca-dev-5d5c8055.jsonl`
  untracked) — nothing else, before or after the clone demonstration (the clone was entirely outside
  the main tree).
- `git diff d44f6bb HEAD --stat`:
  ```
  package.json                 |   3 +-
  scripts/verify-panel.ts      | 830 +++++++++++++++++++++++++++++++++++++++++++
  tests/panel/endToEnd.test.ts |  50 +++
  3 files changed, 882 insertions(+), 1 deletion(-)
  ```
  No `Bin` line.
- Byte-scan (bytes < 0x20 other than tab/LF/CR) of both touched files, run after every edit and again
  after the commit: `scripts/verify-panel.ts` 0, `tests/panel/endToEnd.test.ts` 0.
- `ls ~/.orca` → `ls: /Users/biran/.orca: No such file or directory` (exit 1) — unchanged: absent
  before this fix round, absent after, including after the clone demonstration (the clone's injected
  fault only touched its own `ORCA_CORRECTIONS_DIR`, never `~/.orca`).

Commit sha for this round: **`952739d`**.
