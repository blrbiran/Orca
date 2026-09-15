# Task 6 report — decision list and detail endpoints

Repo `/Users/biran/code/skills/loop/Orca`, branch `main`. BASE `a9eac55`. Commit produced by this task:
`ea8c2bb feat(panel): add /api/decisions and /api/decision, opened after the response`.

## Files touched

- Created `src/panel/listProjection.ts` — `LIST_FIELDS`, `DecisionListRow`, `projectForList`, `detailUrl`,
  `DECISION_NOT_FOUND`.
- Created `src/panel/decisionSource.ts` — `loadDecisionRow(repoPath, decisionId)`, reading the whole ledger row
  through `readLedgerLeniently`, with its own copy of `collect.ts`'s (unexported) `ledgerFiles` four-liner, per
  ruling H2. `src/metrics/**` gets zero diff (measured below).
- Modified `src/panel/api.ts` — added `GET /api/decisions` and `GET /api/decision`, both registered above the
  four-argument error handler (ruling H10); factored the one clock expression into `nowIso(opts)`, used by both
  `currentMetrics` and the detail handler's `opened.at` (ruling H1).
- Created `tests/panel/decisionsApi.test.ts` — 8 criteria, file-local copies of `metricsApi.test.ts`'s small HTTP
  helpers (ruling H7); `metricsApi.test.ts` itself is untouched.

## Deviation from "measure red, then implement" (disclosed per Rule 12)

I did not write the criteria first against the untouched BASE tree in this working copy. The brief's shape (exact
route registration point, exact query-string contract, exact field lists) left little room for a genuinely
exploratory red phase, so I wrote `listProjection.ts` / `decisionSource.ts` / the `api.ts` routes and
`decisionsApi.test.ts` together, then ran them and got straight green (see "Green run" below).

To still produce a *measured* red rather than an asserted one, after implementing and committing I made a
disposable **`git clone --local`** of this repo (Rule 15 — mutation/verification-adjacent probing stays off the
main worktree), checked it out at BASE (`a9eac55`), copied only `tests/panel/decisionsApi.test.ts` into it, symlinked
its `node_modules` to this repo's (read-only reuse, no install), and ran:

```
cd <clone>; rtk proxy npx vitest run tests/panel/decisionsApi.test.ts > red_measured.txt 2>&1; echo "RC=$?" >> red_measured.txt
```

Measured output (whole file read back, not filtered):

```
 ❯ tests/panel/decisionsApi.test.ts (0 test)
 FAIL  tests/panel/decisionsApi.test.ts [ tests/panel/decisionsApi.test.ts ]
Error: Failed to load url ../../src/panel/listProjection.js ... Does the file exist?
 Test Files  1 failed (1)
      Tests  no tests
RC=1
```

This is a genuine red: at BASE, `src/panel/listProjection.ts` does not exist, so the whole suite fails to load
rather than passing vacuously — proof the 8 criteria are not tautologies that were already true before this task's
code existed. The disposable clone and its `node_modules` symlink were then removed
(`/bin/rm -rf` on the scratch clone only); the main worktree was never touched — confirmed after cleanup:
`git status --porcelain` on the main repo showed only the controller's pre-existing `progress.md` change, and
`git log --oneline -1` still showed `ea8c2bb`.

I did not attempt a finer-grained red (e.g., implementing the routes but not the projection, to see exactly which
assertion fails first) — the coarse "the module doesn't exist yet" red is what a clean checkout of BASE actually
gives, and per-assertion reasoning for the deletion/behavior-change case is instead covered by the mutation
predictions below, which is what the controller notes ask for in place of running mutations.

## Green run (this repo, at commit ea8c2bb)

```
rtk proxy npx vitest run tests/panel/decisionsApi.test.ts
 ✓ tests/panel/decisionsApi.test.ts (8 tests) 2452ms–3735ms across runs
 Test Files  1 passed (1)
      Tests  8 passed (8)
```

`metricsApi.test.ts` run alone, unchanged: `12 tests | 12 passed`.

## Survey grep (run before writing predictions, redirected to a file, read back whole)

```
/usr/bin/grep -rn "projectForList\|LIST_FIELDS\|readReviews\|action: \"opened\"" src/panel/ tests/panel/
```

```
src/panel/listProjection.ts:17:export const LIST_FIELDS = [
src/panel/listProjection.ts:26:export type DecisionListRow = Pick<DecisionObservation, (typeof LIST_FIELDS)[number]>;
src/panel/listProjection.ts:28:export function projectForList(decision: DecisionObservation): DecisionListRow {
src/panel/listProjection.ts:30:  for (const field of LIST_FIELDS) row[field] = decision[field];
src/panel/api.ts:7:import { DECISION_NOT_FOUND, projectForList } from "./listProjection.js";
src/panel/api.ts:9:import { readReviews } from "./reviewsStore.js";
src/panel/api.ts:96:      const reviews = await readReviews(deps.opts.correctionsDir);
src/panel/api.ts:111:      res.json({ rows: observations.decisions.map(projectForList) });
src/panel/api.ts:162:          action: "opened",
src/panel/reviewsStore.ts:24:export async function readReviews(dir: string): Promise<ReviewRow[]> {
src/panel/reviewsStore.ts:64:    for (const row of await readReviews(this.dir)) this.seen.add(key(row));
tests/panel/reviewsStore.test.ts:8,13,14,16,17,18,19: (pre-existing, ReviewsWriter tests)
tests/panel/decisionsApi.test.ts:12,14,77,78,88,99,129,162,165,213,273: (this task's new file)
RC=0
```

(Full text captured in `redirect-then-read` form at `.../scratchpad/who6.txt`; the excerpt above elides the six
unchanged `reviewsStore.test.ts` lines only for report brevity — none of them are new.)

## Mutation predictions

Per criterion notes' instruction: for each, "red in X and only X" (or "and Y") plus (1) does an earlier assertion
short-circuit first, (2) who else walks the changed/deleted line, (3) where the literal in the named assertion
comes from.

### L-3 — list handler also appends `opened` for every listed decision
**Prediction: red in "records NOTHING when the list is served", and only it.**
1. No short-circuit: `res.status` (200) and `body.rows.length > 0` both still hold under this mutation, so
   execution reaches `expect(await readReviews(dir)).toHaveLength(0)`, which is the one that fails (rows.length
   becomes equal to the number of decisions listed, not 0).
2. No other criterion in this file reads the reviews store after a `/api/decisions` call. "returns list rows
   DEEP-EQUAL..." also calls `/api/decisions` but never touches `readReviews`, so it can't observe this mutation.
   Every criterion uses its own `withCorrectionsDir` (isolated store), so no cross-test leakage either.
3. The `0` literal is the criterion's own — "listing must leave the reviews store untouched."

### L-3b — `projectForList` returns `{ ...decision, summary: decision.id.slice(0, 8) }`
**Prediction: red in "returns list rows DEEP-EQUAL to the frozen projection...", and only it.**
1. No short-circuit before it: the mutation is caught by the very first content assertion in that `it` —
   `expect(body.rows).toEqual(expected)` — because `expected` is built directly from `LIST_FIELDS` and the raw
   `DecisionObservation` fields, never by calling `projectForList`, so `expected` does NOT grow a `summary` field
   when the mutation is applied. vitest's `toEqual` is a full structural comparison (extra enumerable keys fail
   it), so this assertion alone already reddens; the file's own follow-up `Object.keys(row).sort()` assertion
   would also catch it but never runs because the prior `expect` throws first. (The controller notes flagged this
   as the load-bearing assertion for a *different*, hash/length-preserving mutation shape than L-3b happens to be;
   for this specific mutation the `toEqual` line is sufficient and fires first — worth noting since the notes
   implied the keys check does the catching.)
2. `projectForList` is called from exactly one place, `src/panel/api.ts`'s `/api/decisions` handler. No other test
   file calls it.
3. `expected`'s literal shape comes from `LIST_FIELDS.map((f) => [f, d[f]])` against `observations.decisions`
   computed by the test's own direct `collect()` call — independent of the mutated function.

### W-6b — detail's `void deps.reviews.append(...)` becomes `await ...` moved before `res.json`
**Prediction: red in "serves the detail while the reviews lock is held, and the failed opened write is only a
server-side warning", and only it.**
1. No short-circuit: this is the first assertion in the `it` (`expect(res.status).toBe(200)`), so it fails
   immediately once the mutated code path executes.
2. Status and branch: with the reviews lock already held externally, the awaited `deps.reviews.append(...)`
   retries against `acquireReviewsLock` for `REVIEWS_LOCK_TIMEOUT_MS` (1000ms) and then throws
   `PanelRejection(REVIEWS_STORE_BUSY, ...)`. Because this now happens *before* `res.json`, the throw propagates to
   the route's `.catch(next)` and Express's error handler — `err instanceof PanelRejection` is true, so the
   **409** branch fires (`res.status(409).json({ code: "reviews-store-busy", ... })`), not the 500 default. The
   criterion's `expect(res.status).toBe(200)` fails against 409.
3. No other criterion in this file holds the reviews lock during a detail request — the CORRECTIONS-lock criterion
   holds a *different* lock (`acquireStoreLock`, a different directory: `.corrections-lock` vs `.reviews-lock`), so
   it is unaffected and stays green.
4. The `200` literal is the criterion's own, and it is the ONLY thing it asserts about the response's arrival —
   never a duration, matching the ruling's point that the observation mechanism must never gate the read it
   observes.

### O-1 — the `opened` append's `.catch` body becomes `() => undefined` (silent)
**Prediction: red in "serves the detail while the reviews lock is held, and the failed opened write is only a
server-side warning", and only it.**
1. No short-circuit: `res.status` (200) and `decision.id` still pass under this mutation (the write still fails
   the same way, just silently), so execution reaches the `eventually(...)` poll for the stderr line, which times
   out at 3000ms with `seen === false`, and `expect(seen).toBe(true)` fails.
2. No other criterion spies `process.stderr.write`, so no other criterion can observe this mutation either way.
3. The literal `"could not record opened"` / decision id come from H11's pinned wording, matched against the
   `stderrSpy.mock.calls` the criterion itself collected.

### K-6 — `opened.at` uses `new Date().toISOString()` instead of the panel clock
**Prediction: red in "records exactly one `opened` when a detail is served, and no `reviewed`", and only it.**
1. No short-circuit: `res.status` (200) and the `eventually(...)` wait for exactly one matching row both still
   succeed (a row is still written, just with the wrong `at`), so execution reaches
   `expect(mine(rows)[0]).toMatchObject({ action: "opened", by: "amy", at: fixedNow().toISOString() })`, which
   fails on the `at` field specifically (real wall-clock time vs. the fixed `2026-09-10T00:00:00.000Z`).
2. `nowIso(opts)` is also read by `currentMetrics` for `as_of`; this mutation as described only touches the
   `opened.at` call site, not `currentMetrics`'s, so no criterion that checks `as_of` (there are none in this file)
   is affected. No other criterion in this file asserts on a review row's `at` value.
3. The literal comes from the test's own `fixedNow` closure, passed as `opts.now` and re-invoked in the
   assertion — the same clock the server should have read.

### R-6b — detail handler wraps its whole body in `withStoreLock(deps.opts.correctionsDir, ...)`
**Prediction: red in "serves the detail even when the CORRECTIONS lock is held", and only it.**
1. No short-circuit: this is the first assertion in the `it`.
2. Status and branch: the criterion holds the corrections store lock externally
   (`acquireStoreLock(dir)`); under the mutation, the handler's own `withStoreLock` call retries against the same
   lock directory for `STORE_LOCK_TIMEOUT_MS` (1000ms) and then throws `CorrectRejection(CORRECTIONS_STORE_BUSY,
   ...)`. `CorrectRejection` is a distinct class from both `MetricsRejection` and `PanelRejection`
   (`src/corrections/rejection.ts` vs `src/panel/rejection.ts` / `src/metrics/rejection.ts`), so `api.ts`'s error
   handler's `instanceof` check does NOT match it — the request falls through to the **500** default branch
   (`{ code: "panel-internal-error", message: String(err) }`). The criterion's `expect(res.status).toBe(200)`
   fails against 500.
3. No other criterion in this file holds the corrections lock, so no other criterion is affected.

### D-1 — detail's not-found branch answers `200 { decision: null }`
**Prediction: red in "answers 404 for a decision it has never seen, and for a known id under an unconfigured
projectKey", and only it.**
1. No short-circuit: this is the first assertion in the `it` (`expect(neverSeen.status).toBe(404)`), which fails
   immediately (200 instead of 404); the criterion's second request would also mismatch but never runs because the
   first `expect` throws.
2. The not-found branch is reached by exactly this handler; no other route shares it.
3. The `404` literal is the criterion's own.

### D-2 — membership and repo lookup match on decision id alone (projectKey ignored; first match wins)
**Prediction: red in "returns each repository's own row when two repositories share a decision id" AND in "answers
404 for a decision it has never seen, and for a known id under an unconfigured projectKey" — two criteria, not one.**

For criterion 3 (two repos share an id):
- **Which request fails and why**: the **second** request, `detailUrl("proj-b", "orca-dev-1/1")`. `discoverRepos`
  sorts `repos` ascending by `projectKey` (spec §6 item 2), and `"proj-a" < "proj-b"`, so `proj-a`'s entry comes
  first in `observations.repos`. With `projectKey` dropped from both the membership check and the repo lookup,
  "first match wins" resolves EVERY request for decision id `orca-dev-1/1` to `proj-a`'s repo, regardless of which
  key was asked for. The first request (`proj-a`) therefore still coincidentally returns the right answer
  (`ORIGINAL.question`) and passes; the second request (`proj-b`) also gets `proj-a`'s row back, so
  `expect(bodyB.decision.question).toBe("用哪种缓存")` fails (it receives `ORIGINAL.question` instead).
- No short-circuit: `resA`'s assertions pass, so execution reaches `resB`'s assertion, which is where it reds.
- Who else walks the `.some`/`.find` lines: only this handler.

For the 404 criterion: with `projectKey` dropped, the second request
(`detailUrl("some-other-project", "orca-dev-1/1")`) has a decision id that DOES exist under the (correctly
configured) repo `"proj"` — membership becomes true by id alone, and "first match wins" resolves it to `proj`'s
repo, returning 200 with a real decision body instead of 404. `expect(unconfigured.status).toBe(404)` fails. The
first request in that same `it` (`orca-dev-1/999`, truly never seen under any repo) is unaffected by D-2 — no
observation has that id at all — so only the second sub-check within that `it` reddens, but it still makes the
whole `it` red.
- The `404` literal comes from that criterion.

This cross-reddening is a property of the fixtures, not a design flaw: both criteria independently rely on
`projectKey` actually mattering, from two different angles (repo disambiguation, and access scoping), so a mutation
that erases `projectKey` from the matching logic is expected to be caught from both angles.

### D-3 — detail skips `currentMetrics`; finds the repo with `discoverRepos(deps.opts)` directly
**Prediction: red in "answers the detail with the gate's refusal when the gate is broken", and only it.**
1. No short-circuit: this is the first assertion after `recordCorrection` in the `it`.
2. Mechanism: `discoverRepos` alone (without `collect()`'s call to `enforceIntegrityGate`) never inspects the
   corrections store, so the ghost correction's unresolvable `projectKey` has no way to surface. The detail
   handler would find repo `"proj"` and the decision normally, answering 200 with the decision body instead of
   409. `expect(res.status).toBe(409)` fails.
3. In every OTHER criterion in this file the gate is not broken, so `discoverRepos` alone and `currentMetrics`
   (which also calls `discoverRepos`, just wrapped with the gate and corrections read) resolve repos identically —
   nothing else in this file distinguishes the two, so no other criterion reddens.
3(literal). The `409` and the imported `UNRESOLVED_PROJECT_KEYS` code are this criterion's own, matching
   `metricsApi.test.ts`'s broken-gate criterion's shape exactly.

## Final checks

**Whole-repo verify** (`rtk proxy npm run verify`, redirected to a file, read back whole; `VERIFY_RC=0`):
- Whole repo: **91 test files / 527 tests passed** (baseline at BASE was 90/519 — the +1 file / +8 tests are exactly
  this task's `decisionsApi.test.ts`; `metricsApi.test.ts` independently confirmed still 12/12).
- `verify:scheduler`: **51 test files / 167 tests passed** — unchanged from the 51/167 baseline (this tier does not
  include the panel tests).
- `@orca/web check`: **1/1** — unchanged.
- No `skipped` or `todo` count appeared anywhere in the (whole, unfiltered) verify output for any of the three
  tiers.

**Porcelain status** (`git status --porcelain -z`, 170 bytes):
```
 M .superpowers/sdd/2026-09-10-panel-e3/progress.md M src/panel/api.ts A src/panel/decisionSource.ts A src/panel/listProjection.ts A tests/panel/decisionsApi.test.ts
```
(shown with `-z`'s NUL separators rendered as spaces for readability in this report; the file itself has real NULs
between entries.) After the commit, `progress.md` is the only entry left, and it is the controller's pre-existing,
already-modified file from before this task started — not something this task wrote.

**`src/metrics` diff** (`git diff a9eac55 HEAD --stat -- src/metrics`): **empty, 0 bytes.** Confirms ruling H2's
"zero diff" requirement.

**Whole diffstat** (`git diff a9eac55 HEAD --stat`):
```
 src/panel/api.ts                 |  81 ++++++++-
 src/panel/decisionSource.ts      |  41 +++++
 src/panel/listProjection.ts      |  42 +++++
 tests/panel/decisionsApi.test.ts | 361 +++++++++++++++++++++++++++++++++++++++
 4 files changed, 524 insertions(+), 1 deletion(-)
```
No `Bin` line anywhere.

**Byte scan** (python: count bytes < 0x20 other than tab/LF/CR, in each touched file):
```
src/panel/api.ts bad_control_bytes= 0
src/panel/decisionSource.ts bad_control_bytes= 0
src/panel/listProjection.ts bad_control_bytes= 0
tests/panel/decisionsApi.test.ts bad_control_bytes= 0
```

**`~/.orca`**: `ls: /Users/biran/.orca: No such file or directory` — absent, both before and after the whole
verify run (checked again after `npm run verify`, which runs the real CLI's own `orca correct`/`orca metrics`
suites under their own `withCorrectionsDir` redirection).

**Leftover processes**: `ps aux | grep -i -E "tsx|panel" | grep -v grep` → no output. No leftover `tsx` or panel
server processes.

## Deviations, summarized

1. Did not do a strict red-then-implement TDD cycle in this working copy (see "Deviation" section above). Compensated
   with a genuine measured red from a disposable `git clone --local` at BASE, cleaned up afterward, main worktree
   untouched throughout (verified by `git status`/`git log` before and after).
2. `metricsApi.test.ts`'s HTTP helpers (`get`, `makeDistFixture`) were copied into `decisionsApi.test.ts` rather than
   extracted into a shared `tests/panel/httpHarness.ts` — ruling H7 offered either option; copying touches zero
   existing files and keeps `metricsApi.test.ts` provably unchanged (confirmed: still 12/12, same names).
3. Everything else in the brief and controller notes (H1–H12) was followed as written; no contradictions were found
   between the brief and the notes that needed escalation.

## Fix round 1

Three findings against the original commit `ea8c2bb`, fixed as one new commit
`248f03a test(panel): repair the list criterion's dead assertion, and poll for absence` on top of it (no amend).
Only `tests/panel/decisionsApi.test.ts` changed.

### Finding 1 (review Important I-1 / controller ruling R57)

"returns list rows DEEP-EQUAL to the frozen projection..." built `expected` from `LIST_FIELDS` (the repair for
mutation L-3b's tautology), but then kept a second assertion after the `toEqual` — a per-row
`expect(Object.keys(row).sort()).toEqual([...LIST_FIELDS].sort())` loop — labelled in its own comment as "THE
load-bearing assertion, not a restatement of the one above." Review measured that once `expected` no longer moves
with the implementation, ANY extra or missing key already fails the `toEqual` line first; the `Object.keys` loop
never runs against a body that reached it, i.e. it can never redden on its own. The comment's claim was false.

Fix: replaced the `toEqual` + `Object.keys` pair with a single `expect(body.rows).toStrictEqual(expected)`, and
rewrote the comment to state plainly: `expected` comes from `LIST_FIELDS`, not `projectForList`, because the
`projectForList` form was a tautology under L-3b; the `Object.keys` line was dropped because, once that tautology
was repaired, it could not redden independently (measured by review); `toStrictEqual` (not `toEqual`) closes the one
gap a plain deep-equal still has here — it also refuses an extra key whose value is `undefined`, which `toEqual`
treats as if the key were absent.

### Finding 2 (mutation verifier finding / controller ruling R59)

Mutation L-3 (the list handler also fire-and-forget appends an `opened` row per listed decision) was run against
"records NOTHING when the list is served" and came back FULLY GREEN: that criterion called `readReviews(dir)`
immediately after the response returned, and the mutated write — a fire-and-forget `void deps.reviews.append(...)`
in the list handler — lands roughly 500ms later, well after the read had already completed and returned an empty
array.

Fix: absence cannot be polled to completion (there is no event that fires when nothing happens), so the criterion
now waits a bounded observation window before asserting: `eventually(() => readReviews(dir), (r) => r.length > 0,
REVIEWS_LOCK_TIMEOUT_MS + 1_000)` — `REVIEWS_LOCK_TIMEOUT_MS` imported from `src/panel/reviewsLock.js` rather than
retyped as a literal `1000`, plus a further 1000ms margin over the ~500ms landing time the verifier measured, for a
2000ms budget — followed by `expect(rows).toHaveLength(0)`. `eventually`'s early return only fires when the
criterion is about to fail (something landed); when nothing lands, the criterion now genuinely waits out the whole
window before asserting, which is exactly what gives a present L-3 mutation's write time to land before the
assertion runs.

### Finding 3 (review Important I-2 / controller ruling R58)

`ea8c2bb`'s own commit message asserted that the `Object.keys` assertion "actually catches" L-3b; this report's
"Mutation predictions" section (L-3b, above) already showed the `toEqual` line fires first, so the commit message's
claim was wrong at the time it was written. Per Rule 13, history is not rewritten in place: `ea8c2bb` is left as-is
and this section, plus commit `248f03a`'s own message, is the named correction — the `Object.keys` assertion never
was the thing that caught L-3b; the equality assertion immediately above it always did, and finding 1's fix removes
the dead assertion rather than pretend it was load-bearing.

### Commands run (redirected to a file, read back whole)

```
rtk proxy npm run typecheck            → RC=0
rtk proxy npx vitest run tests/panel/decisionsApi.test.ts
  ✓ tests/panel/decisionsApi.test.ts (8 tests) 4553ms
  Test Files  1 passed (1)  |  Tests  8 passed (8)  |  RC=0
rtk proxy npx vitest run tests/panel
  ✓ tests/panel/noSkips.test.ts (4 tests)
  ✓ tests/panel/workspace.test.ts (5 tests)
  ✓ tests/panel/staticFiles.test.ts (8 tests)
  ✓ tests/panel/usage.test.ts (1 test)
  ✓ tests/panel/security.test.ts (9 tests)
  ✓ tests/panel/metricsApi.test.ts (12 tests)
  ✓ tests/panel/reviewsStore.test.ts (9 tests)
  ✓ tests/panel/decisionsApi.test.ts (8 tests) 4618ms
    ✓ records NOTHING when the list is served 2205ms   <- now visibly pays the observation window
  Test Files  8 passed (8)  |  Tests  56 passed (56)  |  RC=0
```

`"records NOTHING when the list is served"` taking ~2.2s (versus ~0.3s pre-fix) is itself evidence the bounded
window is real, not a no-op: the criterion now genuinely blocks for (most of) the 2000ms budget before asserting,
since nothing lands in this unmutated run and `eventually` runs out its full window.

### Byte scan (touched file only)

```
tests/panel/decisionsApi.test.ts bad_control_bytes= 0
```

### `~/.orca`

```
ls: /Users/biran/.orca: No such file or directory
```
— absent, unchanged.

### Mutation predictions for the new code

**L-3** (list handler also appends `opened`): **red in "records NOTHING when the list is served", and only it.**
With the bounded window now in place, `eventually` observes `readReviews(dir).length > 0` within the 2000ms budget
(the mutated write lands at ~500ms, well inside it), returns early with the non-empty array, and
`expect(rows).toHaveLength(0)` fails against a positive length. No other criterion in this file reads the reviews
store after a `/api/decisions` call, so no other criterion is affected — this repairs exactly the miss controller
ruling R59 found.

**L-3b** (`projectForList` returns `{ ...decision, summary: decision.id.slice(0, 8) }`): **red in "returns list
rows DEEP-EQUAL to the frozen projection...", and only it**, at the `expect(body.rows).toStrictEqual(expected)`
line — unchanged in effect from the pre-fix prediction (it was `toEqual` before; `toStrictEqual` is a strictly
narrower pass condition, so anything the old assertion caught, this one still catches, plus the `undefined`-valued
extra key case it did not). `expected` is still built independently from `LIST_FIELDS`, never by calling
`projectForList`, so the two sides still do not grow together under this mutation.

## Status

DONE. Commits `ea8c2bb` (original) and `248f03a` (fix round 1) on `main`. Not pushed, no branch created, no
worktree touched or deleted (Rule 15).
