# Task 7 report — POST /api/corrections and POST /api/reviews

Repo `/Users/biran/code/skills/loop/Orca`, branch `main`. BASE `248f03a`. Commit produced: `dc8461b`.

## Files touched

- `src/panel/api.ts` — added `POST /api/corrections`, `POST /api/reviews`, the shared `isListedDecision`
  membership helper, and `panelClock` (a Date-returning factoring of task 6's `nowIso`, so
  `correctionRowFrom`, `nowIso` and `currentMetrics` all read the same one clock expression, per ruling J2).
- `tests/panel/correctApi.test.ts` — new, 11 criteria.
- `tests/corrections/injectableClock.test.ts` — **0 diff**. I initially exported `GOLDEN_ID`/`INSTANT` from it,
  then reverted: importing a `*.test.ts` file directly re-registers its `describe` blocks a second time inside
  the importing file's own vitest run (measured below). Went with ruling J2's other option instead: duplicated
  the two literals in `correctApi.test.ts` as `GOLDEN_INSTANT`/`GOLDEN_ID`, with a comment naming the exact
  file and lines (`tests/corrections/injectableClock.test.ts:16` for `INSTANT`, `:40` for `GOLDEN_ID`, `:24-27`
  for `recordArgs`, all read at BASE `248f03a`), plus an in-test sanity check that `correctionRowFrom` on the
  duplicated input under the duplicated clock reproduces the same `at`, so the duplicate is pinned against
  drift.

## Survey grep (before writing anything)

```
$ /usr/bin/grep -rn "recordNewCorrection\|CORRECTION_ALREADY_RECORDED\|again" src/panel/ tests/panel/
```
Output (BASE, before this task's edits): no hits. `src/panel/**` had never referenced any of these three names;
`tests/panel/**` likewise. Confirms Task 6 left this seam untouched, matching the dispatch.

## Measured red before implementation

Ran the finished `tests/panel/correctApi.test.ts` against BASE's `src/panel/api.ts` (temporarily
`git stash push -- src/panel/api.ts`, ran, then `git stash pop`). All 11 criteria failed, every one an
**assertion-level** red (not a module-load failure):

- 9 of 11: `AssertionError: expected 404 to be <200|400|409>` — POST routes don't exist at BASE, so Express's
  static-fallback handler answers 404 for everything under `/api/*` that isn't GET.
- 1 of 11 (`answers 404 for a decision the panel does not list...`): the first assertion (`corrRes.status` ===
  404) happened to already hold by coincidence (no route exists), but the very next line
  (`corrRes.json()`) threw `SyntaxError: Unexpected token '<', "<!DOCTYPE "...` because the 404 body is the
  static handler's `text/plain "not found"`/HTML fallback, not JSON — still a genuine, specific failure, not a
  vacuous pass.
- 1 of 11 (GOLDEN_ID): `expected 404 to be 200`.

Full transcript captured at
`/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/5d5c8055-111d-4296-ad0c-e78a5b191f54/scratchpad/measured_red.txt`
(11 failed / 11 total, exit code 1).

After restoring the implementation, re-ran `correctApi.test.ts` + `injectableClock.test.ts` +
`decisionsApi.test.ts` + `metricsApi.test.ts` together: 4 files, 35/35 passed (11+4+11? — actually 11 + 4 + 8 +
12 = 35), confirming no regression in Task 5/6's sibling suites.

## Mutation predictions

For each: (1) does an earlier assertion short-circuit before the named one, (2) who else walks the changed
line, (3) where the literal comes from, (4) predicted red set, stated as "red in X [and Y] and only that."

Test names abbreviated: T1 = "answers a row the seam would refuse..." (bogus kind), T2 = "refuses an empty
optional field..." (chose_instead ""), T3 = "records and does NOT close the loop", T4 = "writes its OWN
message for a second correction...", T5 = "records another one when the page asks for it on purpose", T6 =
"derives the same correction id..." (GOLDEN_ID), T7 = "does NOT write reviewed when the correction was
refused", T8 = "writes reviewed when the correction lands, and when the person clicks agreed", T9 = "lets a
failed reviewed write reach the person on POST /api/reviews...", T10 = "tells the person the correction landed
even when the reviewed mark could not be written", T11 = "answers 404 for a decision the panel does not
list...".

**C-5** — after `recordNewCorrection`, close the loop into the fixture repo (append overturned rows + commit).
1) No earlier assertion in T3 short-circuits before its own git/hash checks — the positive checks
   (`res.status`, `readCorrections` length) come first and still pass under this mutation, so control reaches
   the git/hash lines. 2) Every test whose correction succeeds (T3, T4, T5, T6, T8, T10) walks the mutated
   line, but only T3 reads `git status`, `git rev-parse HEAD`, or the `.decisions/` snapshot afterward. 3) The
   literals (`beforeHead`, `beforeFiles`, `""` for clean status) are captured by the test itself before the
   POST, from the SAME fixture repo the mutation would dirty. **Predicted: red in T3 and only T3.** What it
   dirties: `makeTargetRepo()`'s throwaway directory under `$TMPDIR` (confirmed by reading
   `tests/corrections/harness.ts`'s `mkdtemp(join(tmpdir(), "orca-target-"))`) — never this repository.

**C-13** — handler bypasses `recordNewCorrection`: `{ id: deriveCorrectionId(row), ...row }` stored with
`recordCorrection` directly (row still built by `correctionRowFrom`). 1) No short-circuit: T1/T2 both reach
their status/code assertions directly. 2) `appendCorrectionLocked` (called by `recordCorrection` regardless of
who calls it) does its own `correctionSchema.parse(row)` — a bare `.parse`, not `.safeParse` — so an invalid
row now throws an uncoded `ZodError` instead of `recordNewCorrection`'s `CorrectRejection(CORRECTION_ROW_INVALID,
...)`. The handler's catch only translates `CorrectRejection` to 400; anything else falls to `next(err)` → the
shared 500 `panel-internal-error` handler. 3) T1/T2's literal expectations (`400`, `CORRECTION_ROW_INVALID`)
come from `record.ts`'s named refusal, which this bypass skips entirely for invalid rows. Valid rows (T4, T5,
T6, T8, T10) are unaffected because `deriveCorrectionId` is pure — same row, same hash, same id, whether
computed inside `recordNewCorrection` or by the mutation directly (this is exactly why the brief's original
"same id" criterion is unmutatable by this bypass, per the brief's own superseding note). The semantic dedupe
check (T4/T5) lives in `recordCorrection` itself, called either way, so it still fires. **Predicted: red in T1
and T2, and only those two** (not "only T1" — the brief's stale single-criterion framing no longer applies
since T1 and T3 are now two different, non-identical criteria per ruling J3).

**K-7** — the correction row is built with `() => new Date()` instead of the panel clock. 1) No short-circuit.
2) Only the `correctionRowFrom(input, panelClock(deps.opts))` call site is touched; `nowIso` (used for
`reviewed`/`opened` timestamps) is untouched. 3) T6's literal `GOLDEN_ID` was hashed against a row whose `at`
is the fixed `GOLDEN_INSTANT`; the real wall clock will never equal that instant, so the hash — and therefore
the id — differs. No other test asserts on the correction row's own `at` or its derived `id`. **Predicted: red
in T6 and only T6.**

**E-7** — handler normalises `chose_instead: ""` to absent before building the row. 1) No short-circuit: T2's
first assertion is the one this breaks. 2) Only T2 sends `chose_instead: ""`; T1/T3/T4/T5/T7/T8/T10/T11 never
set that field, T6 never sets it either (kind "wrong", omitted). 3) T2's `body.code`/`body.message` literals
come from `record.ts`'s refusal, unreachable once "" is normalised to absent (the row becomes legal with
`chose_instead` omitted, since `kind: "wrong"` makes it optional). **Predicted: red in T2 and only T2.**

**C-14** — the already-recorded branch answers `err.message` (the CLI's words) as `message`. 1) No
short-circuit: T4 checks `status` first (still 409, unaffected), then `body.message`, which is where this
lands. 2) Only T4 asserts `message` does not contain `--again`; T5 (the negative control) never inspects the
409 body's message, only the retried request's success. 3) The literal `"--again"` substring check in T4 comes
directly from `store.ts`'s `CorrectRejection` message ("Pass --again to record another one on purpose"), which
this mutation would pipe straight through. **Predicted: red in T4 and only T4.**

**M-7** — both POST handlers skip the membership check. 1) No short-circuit: T11's first assertion (404) is
exactly what this mutation removes. 2) Every other test already uses a listed decision, so skipping the check
is a no-op for them — they'd still succeed the same way. 3) T11's literal `DECISION_NOT_FOUND` and the empty
store/reviews assertions all depend on the request never reaching `recordNewCorrection`/`reviews.append`;
under the mutation it would, and `readCorrections`/`readReviews` would be non-empty instead. **Predicted: red
in T11 and only T11.**

**V-1** — `POST /api/corrections` does not append `reviewed` after recording. 1) No short-circuit in T8: its
correction-success assertion passes, then the `rowsA` check (expects length 1) fails. 2) T10 also calls
`POST /api/corrections` successfully while holding the reviews lock and expects **409** specifically because
the `reviewed` append is attempted and fails against the held lock; under V-1 the append is never attempted, so
the handler always reaches `res.json({correction: stored})` (200), and T10's `expect(res.status).toBe(409)`
fails too. 3) T8's literal `rowsA`/`rowsB` come from `readReviews(dir)` filtered by decisionId+action; T10's
literal `409`/`REVIEWS_STORE_BUSY` come from `acquireReviewsLock`'s own `PanelRejection`, reachable only if the
append is attempted. **Predicted: red in T8 and T10** (not "only T8" — I initially mis-scoped this to T8 alone
before tracing T10's dependency on the append actually running; corrected here).

**V-2** — `POST /api/reviews` appends `action: "opened"` instead of `"reviewed"`. 1) No short-circuit: T8's
first half (the correction) is unaffected since that half uses the corrections handler, not `/api/reviews`;
its second half (`rowsB`, filtered by `action === "reviewed"`) is what breaks. 2) T9 also calls
`POST /api/reviews`, but under a held lock — the append never completes (lock contention throws before any row
is written), so the action-name change is unreachable in T9. 3) T8's literal filter `action === "reviewed"`
comes from `reviewsStore.ts`'s `ReviewAction` union and is exactly what the mutation would violate.
**Predicted: red in T8 and only T8.**

**V-3** — `POST /api/reviews` catches the append failure and answers 200. 1) No short-circuit: T9's first
assertion (`status === 409`) is exactly what this flips to 200. 2) No other test holds the reviews lock while
calling `/api/reviews`. 3) T9's literal `409`/`REVIEWS_STORE_BUSY` depend on the error propagating to the
shared error handler, which this mutation intercepts. **Predicted: red in T9 and only T9.**

**V-4** — `POST /api/corrections` catches the reviewed-append failure and answers 200 with the stored row. 1)
No short-circuit: T10's `status === 409` is exactly what flips to 200. 2) T8 also hits the corrections handler
but never holds the lock, so its append always succeeds and this catch branch is never entered for T8. 3)
T10's literal `409`/`REVIEWS_STORE_BUSY`/`body.correction.id` depend on the catch block's own response shape,
which the mutation would replace with `res.json({correction: stored})`. **Predicted: red in T10 and only
T10.**

**V-5** — `POST /api/corrections` appends `reviewed` BEFORE calling `recordNewCorrection`. 1) No
short-circuit: T7's first assertions (400, empty store) still hold since they check the correction path, not
reviews; the `reviewed` filter check is what breaks. 2) T1/T2/T3/T4/T5/T6/T8/T10/T11 do not assert "no reviewed
row after a refusal" — only T7 does. For the success-path tests, reordering two awaited calls that both
succeed produces the same final state, so they are unaffected. 3) T7's literal filter
(`decisionId === "orca-dev-1/1" && action === "reviewed"`, expected length 0) is violated because the mutation
writes that exact row before the (subsequently refused) `recordNewCorrection` call ever throws. **Predicted:
red in T7 and only T7.**

## Verify (three tiers), read whole, redirected to a file

Full transcript:
`/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/5d5c8055-111d-4296-ad0c-e78a5b191f54/scratchpad/verify_full.txt`,
`VERIFY_RC=0`.

- `npm test` (vitest, whole repo): **Test Files 92 passed (92)**, **Tests 538 passed (538)**. BASE was 91
  files / 527 tests; this task adds exactly one file (`tests/panel/correctApi.test.ts`, 11 tests):
  91+1=92, 527+11=538 — exact, no other file's count moved.
- `npm run verify:scheduler`: **Test Files 51 passed (51)**, **Tests 167 passed (167)** — unchanged from BASE
  (51/167).
- `npm run --ws check` (`@orca/web`): **Test Files 1 passed (1)**, **Tests 1 passed (1)** — unchanged from
  BASE (1/1).
- No `skipped` or `todo` count anywhere in the transcript (grepped for both words; zero matches tied to test
  results).
- `npm run typecheck`, `npm run ledger -- validate .decisions`, `check-claude-md-lines.mjs`,
  `check-hooks-path.mjs` all passed within the same `&&` chain (VERIFY_RC=0 for the whole chain).

## Porcelain, diffstat, membership grep (after commit `dc8461b`)

- `git status --porcelain -z` (144 bytes before commit; after commit, only):
  ```
   M .superpowers/sdd/2026-09-10-panel-e3/progress.md
  ?? .decisions/orca-dev-5d5c8055.jsonl
  ```
  Both are the controller's own pre-existing uncommitted files (present in the dispatch's stated porcelain
  snapshot) — neither touched, staged, nor committed by me.
- `git diff 248f03a HEAD --stat -- src/metrics src/corrections`: **empty** (no output) — confirms
  `src/metrics/**` and `src/corrections/**` have zero diff from this task, including the
  originally-considered `injectableClock.test.ts` export (reverted to 0 diff, superseded by duplication —
  see above). `tests/corrections/**` is outside this filter and correctly untouched anyway.
- `git diff 248f03a HEAD --stat` (whole): only
  ```
   src/panel/api.ts               | 171 ++++++++++++-
   tests/panel/correctApi.test.ts | 536 +++++++++++++++++++++++++++++++++++++++++
   2 files changed, 700 insertions(+), 7 deletions(-)
  ```
  No `Bin` line.
- `grep -rn "projectKeyOf" src/panel`: **no hits** (exit code 1 / empty) — confirms ruling J1 (`projectKeyOf`
  is not imported by `src/panel/**`).

## Byte scan (control bytes < 0x20 other than tab/LF/CR)

- `src/panel/api.ts`: 0 bad bytes / 15409 total bytes.
- `tests/panel/correctApi.test.ts`: 0 bad bytes / 23734 total bytes.

## Process / user-data checks

- `ls ~/.orca` → `ls: /Users/biran/.orca: No such file or directory` (confirmed absent, as required).
- `ps aux | grep -iE "tsx|orca.*panel"` (excluding the unrelated macOS `openAndSavePanelService` XPC
  processes) → no output: no leftover `tsx`/panel processes from any of this task's test runs.

## Deviations from the brief / notes, with reasons

1. **Brief's step-1 criteria text is superseded, per the controller notes' own framing** (ruling J3): the
   brief's first and third `it` bodies were identical; I wrote two genuinely different criteria (unknown
   `kind` vs. empty `chose_instead`) per J3's exact split.
2. **GOLDEN_ID/INSTANT duplicated, not exported** (ruling J2's second option): exporting them caused a
   measured side effect — importing a `.test.ts` file re-registers its `describe` blocks inside the importer's
   own vitest run (measured: `correctApi.test.ts` alone reported 15 tests instead of 11 when it imported
   `injectableClock.test.ts`). Reverted the export edit entirely (file now has 0 diff from BASE) and duplicated
   the two literals with a comment citing the exact source lines, plus an in-test sanity assertion tying the
   duplicate to `correctionRowFrom`'s real output.
3. **panelClock/nowIso refactor** (ruling J2): factored task 6's inline `(opts.now ?? (() => new Date()))()`
   into a named `panelClock` returning the Date-form, with `nowIso` as a thin wrapper over it, so
   `correctionRowFrom`'s clock argument and the `opened`/`reviewed`/`currentMetrics` timestamps all read one
   shared expression rather than two independently-written copies. This is a small edit to Task 6's code,
   justified by J2's explicit instruction to reuse "the panel's one clock" for the correction row too; task 6's
   own criteria (`decisionsApi.test.ts`, `metricsApi.test.ts`) were re-run and remain green (35/35 across all
   four panel test files together, including these two).
4. My own V-1 mutation prediction changed mid-analysis from "red in T8 only" to "red in T8 and T10" once I
   traced that T10 depends on the `reviewed` append actually being attempted (surfaced in this report rather
   than silently corrected).

## Not witnessed

Nothing. Every check listed above (measured red, all verify tiers, diffstats, grep, byte scan, `ls ~/.orca`,
process check) was actually run and its output read in full.
