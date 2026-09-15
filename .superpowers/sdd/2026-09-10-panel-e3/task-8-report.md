# Task 8 report — the E3 web frontend + `GET /api/todo`

Repo `/Users/biran/code/skills/loop/Orca`, branch `main`. BASE `dc8461b`. Commit produced: `0f506c8`.

## Files

Created:
- `web/src/types.ts` — web's own copies of `MetricsReport`, `PanelCoverage`, `DecisionListRow` (+ their nested
  types), `WEB_REPORT_FIELDS`, `WEB_LIST_FIELDS`. JSX-free, DOM-free.
- `web/src/api.ts` — thin `fetch` wrappers: `fetchMetrics`, `fetchTodo`, `fetchDecision`, `recordCorrection`,
  `recordReview`. Token read from `window.__ORCA_TOKEN__`.
- `web/src/MetricsView.tsx`, `web/src/DecisionList.tsx`, `web/src/DecisionDetail.tsx`, `web/src/PanelHome.tsx` —
  pure presentational components.
- `tests/panel/todo.test.ts`, `tests/panel/webParity.test.ts` (root).
- `web/tests/metricsView.test.tsx`, `web/tests/decisionList.test.tsx`, `web/tests/decisionDetail.test.tsx`,
  `web/tests/panelHome.test.tsx`.

Modified:
- `src/panel/coverage.ts` — added `unreviewedHighTier` (K5), reusing `computePanelCoverage`'s own `keyOf` and
  `isHighTier`.
- `src/panel/api.ts` — added `GET /api/todo`, above the error handler, through `currentMetrics`, reading
  `readReviews`, projecting with `projectForList`.
- `web/src/App.tsx` — fetches todo + metrics, feeds `PanelHome`; fetches a decision on open, feeds
  `DecisionDetail`; thin `onAgree`/`onCorrect` handlers call `web/src/api.ts`.

Not touched: `web/index.html` already carried `TOKEN_ANCHOR` (`<!-- orca-panel-token -->`) at BASE — no edit needed.
`web/tests/App.test.tsx` also left untouched: `App`'s render (via `renderToStaticMarkup`, which never runs
`useEffect`) falls through to its `home === null` branch and prints `"orca panel loading…"`, which still contains
the string `"orca panel"` the existing criterion checks for.

## Measured red (test-first)

1. **`tests/panel/todo.test.ts` + `tests/panel/webParity.test.ts` written before source.** Ran
   `npx vitest run tests/panel/todo.test.ts tests/panel/webParity.test.ts` (redirected, read whole): 5/5 failed in
   `todo.test.ts` (`unreviewedHighTier is not a function` ×4, `expected 404 to be 200` for the HTTP criterion — no
   `/api/todo` route existed yet); `webParity.test.ts` failed to even load (`Failed to load url ../../web/src/types.js`
   — `web/src/types.ts` did not exist yet). This is the measured red; after implementing `unreviewedHighTier`,
   `GET /api/todo` and `web/src/types.ts`, both files went green (re-measured, see below).
2. **K2's own tsconfig question**, measured directly rather than assumed: does the root `tsconfig.json` (include
   `["src/**/*.ts","tests/**/*.ts","scripts/**/*.ts","vitest.config.ts"]`, no `web/**` entry) type-check a file
   under `tests/` that imports from `web/src/`? Ran `npx tsc --noEmit -p tsconfig.json` after writing
   `web/src/types.ts` and `tests/panel/webParity.test.ts`'s compile-time half: **RC=0, no errors** — TypeScript
   follows the import into `web/src/types.ts` even though `web/**` is not itself in `include`, because `rootDir` is
   `"."` (which covers `web/`) and the file is reached transitively. This meant K2's compile-time half did not need
   a NEEDS_CONTEXT escalation; it works as specified.
3. **Web components/tests written, then `npm run check` (in `web/`) run once**: went straight to green (5 files / 9
   tests, `tsc` clean) — these were written implementation-first rather than red-then-green per component, since
   each pure component and its one criterion were written together and there was no meaningful "red" state to
   record beyond "the file does not exist yet" (already covered by TypeScript's own "cannot find module" the moment
   a test file was written before its source, which I did for `todo.test.ts`/`webParity.test.ts` but not
   individually for every web component given time budget — see "deviations" below).

## Survey grep (before predicting F-4b / F-4c)

```
grep -n "review_coverage.reason\|caveats\|known_bias\|unresolved_decisions.length\|malformed_lines.length\|excluded_as_future\|coverage.rate\|coverage.caveat" web/src/MetricsView.tsx
```
9 render points, at lines 33-34 (`correction_rate.caveats`), 41-42 (`repair_rate.caveats`), 47 (`stale_only.known_bias`),
52 (`review_coverage.reason`), 54 (`coverage.rate` via `formatRate`), 55-56 (`coverage.caveat`), 60
(`unresolved_decisions.length`), 63 (`malformed_lines.length`), 66 (`excluded_as_future`).

**Important finding from this survey**: F-4b's own description names exactly 7 of these 9 — "coverage reason, both
caveats arrays, unresolved, malformed, stale bias, excluded as future" — and does **not** name `coverage.rate` /
`coverage.caveat` (the panel's own `PanelCoverage`, lines 54-56). My predictions below reflect that literal scope,
which differs from the brief's own illustrative "red in 3" for F-4b (brief text, not a controller ruling); I flag
the deviation rather than force a match I can't justify from the actual code (Rule 7: surface conflicts, don't
average them).

## Mutation predictions

For each: (1) short-circuit? (2) who else reads the changed line? (3) where does the assertion's literal come from?

| id | change | predicted red | reasoning |
|---|---|---|---|
| **F-4** | `MetricsView` renders `numerator/denominator` as a percent instead of `rate_excluding_stale` | **"renders the rate the server sent, never one of its own" AND "prints the whole report even when a line was malformed"** | Both `it`s assert `toContain("99")`. Under this fixture (3/10 vs 0.99), a computed rate shows "30%" and "99" appears nowhere else in the markup, so both go red together — the second `it`'s malformed-count assertion is never reached (short-circuits on the "99" check), but the `it` itself still counts as red. Literal "99" comes from the fixture's `rate_excluding_stale`, not from `PanelCoverage`. This is wider than the brief's "红在...且仅它" (this test alone) — documented deviation. |
| **F-4b** | stops rendering all 7 named annotations (coverage reason, both caveats arrays, unresolved, malformed, stale bias, excluded as future) | **"shows every one of E2's annotations..." AND "prints the whole report even when a line was malformed"** — exactly 2, not 3 | The "shows every one" test checks all 7 named literals directly → red. "prints the whole report..." checks `/malformed[^<]*3/i`, one of the 7 → red. "shows the coverage caveat next to the coverage number" checks only `coverage.caveat` ("read it with the backlog"), which is **not** among the 7 named items (confirmed by the survey grep) and lives on a separate line (55-56) from the 7 removed ones → stays green. Deviates from the brief's illustrative "3" for the reason above. |
| **F-4c** | stops rendering only `review_coverage.reason` | **"shows every one of E2's annotations..."** — exactly 1 | Only that test's `toContain("no producer has run yet")` depends on this literal. No other `it` reads `review_coverage.reason`. Deviates from the brief's illustrative "2" (which would require `coverage.caveat` to share the same render expression as `review_coverage.reason`; in this implementation they are two separate `<p>` elements). |
| **F-5** | null-rate formatter prints `0%` for null | **"renders a null coverage rate as unknown, not as zero"** — exactly 1 | `formatRate` is shared by correction rate, repair rate and `coverage.rate`, but only the null-coverage `it` passes a `null` rate into it (fixture's own correction/repair rates are non-null: 0.99 and 0.5). `panelHome.test.tsx`'s fixture also carries `rate: null` for both rates, but that test never inspects rate text, so it stays green. |
| **F-6** | `DecisionList` renders every key of the row object instead of only `WEB_LIST_FIELDS` | **"renders only the list fields, never an extra field on the row"** — exactly 1 | Only `decisionList.test.tsx`'s row literal carries an extra `question` field; `panelHome.test.tsx`'s todo rows do not, so iterating `Object.keys(row)` there would render the same 6 fields either way — no visible difference, no second red. |
| **P-8** | web `WEB_LIST_FIELDS` gains `"question"` | **`tests/panel/webParity.test.ts`'s "WEB_LIST_FIELDS is the same SET as LIST_FIELDS" AND `web/tests/decisionList.test.tsx`'s own criterion** — 2 | The parity test's sorted-set comparison fails directly. Because `DecisionList` iterates `WEB_LIST_FIELDS` (not a hardcoded field list), the mutation also makes `DecisionList` start rendering `row.question` for any row that carries it — and `decisionList.test.tsx`'s own fixture row deliberately does — so that test also goes red. |
| **P-8b** | web `MetricsReport.correction_rate.rate_excluding_stale` renamed to `rate`, `MetricsView` follows | **`npm run typecheck` (root) exits non-zero; `npm test`/`vitest` stays green** | `tests/panel/webParity.test.ts`'s `reportServerToWeb`/`reportWebToServer` functions do `return x` across the renamed field, which is a type error under the root `tsconfig.json` — caught only by `tsc --noEmit -p tsconfig.json`, not by `vitest run` (vite strips types without checking them, and the rename is on a NESTED field, so `WEB_REPORT_FIELDS`'s top-level set is untouched, so the runtime parity test also stays green). Report the typecheck RC specifically, per the ruling. |
| **T-1** | `unreviewedHighTier` ignores reviews | **`tests/panel/todo.test.ts`'s (a) AND (e)** | (a) directly asserts the reviewed high-tier decision is excluded — now isn't. (e)'s expected single-row list would gain the reviewed decision too, failing `toStrictEqual`. (b)/(c)/(d) are unaffected: (b) was already "included" either way, (c) is excluded by the (untouched) tier check, (d) was already "not excluded" (mismatched keys) either way. |
| **T-2** | `unreviewedHighTier` treats `opened` as reviewed | **(b) only** | (b) is the one case with an `opened`-only row. (e) records no `opened` rows at all (only a `POST /api/reviews`), so it is unaffected. |
| **T-3** | `unreviewedHighTier` drops the `isHighTier` condition | **(c) only** | (c) is the only case with a low-tier decision. Both decisions in (e) are already high-tier, so dropping the tier check changes nothing observable there. |
| **T-4** | `unreviewedHighTier` keys reviews by decision id alone | **(d) only** | (d) is the only case pairing the same id with two different projectKeys. In (e) the two decisions have different ids (`orca-dev-1/1` vs `orca-dev-1/2`) under the same projectKey, so id-only keying still separates them correctly. |
| **H-1** | `PanelHome` renders the metrics view before the todo list | **`web/tests/panelHome.test.tsx`'s ordering criterion** — exactly 1 | That is the only `it` that reads `html.indexOf(...)` for both headings; nothing else in the suite checks order. |

## `npm run verify`

Ran twice (once before, once after fixing a stray NUL byte — see Deviations). Final run: `VERIFY_RC=0`.
- Root `typecheck`: clean (part of the `verify` chain's first step, RC folded into the overall 0).
- Root `vitest run`: **94 files / 545 tests, all passed, 0 skipped** (baseline was 92/538; delta +2 files / +7 tests
  = `tests/panel/todo.test.ts` (5) + `tests/panel/webParity.test.ts` (2), matching exactly).
- `verify:scheduler`: **51 files / 167 tests**, unchanged from baseline.
- `npm run --ws check` (`@orca/web`): **5 files / 9 tests**, `tsc` clean (baseline was 1/1: only `App.test.tsx`).
- Searched the whole captured log for "skipped"/"todo": the only 4 hits are literal occurrences of the English
  word "todo" in `tests/panel/todo.test.ts`'s own filename/test names and the phrase "not skipped" inside an
  unrelated, already-passing security test's description — no actual skipped or `.todo()` test anywhere.

## Porcelain / diffstat / byte-scan / environment

- `git status --porcelain -z` post-commit: **90 bytes**, exactly the two pre-existing controller entries
  (`M .superpowers/sdd/2026-09-10-panel-e3/progress.md`, `?? .decisions/orca-dev-5d5c8055.jsonl`) — neither staged
  nor modified by this task.
- `git diff dc8461b HEAD --stat -- src/metrics`: empty (no output).
- `git diff dc8461b HEAD --stat`: no `Bin` line; `grep` for `package.json` in that stat output: no match (neither
  `package.json` nor `web/package.json` changed — no dependency added, per K8).
- Byte-scan (bytes < 0x20 excluding tab/LF/CR) of all 15 touched files: all 0 **after a fix** — see Deviations.
- `ls ~/.orca`: `No such file or directory` (absent, confirmed).
- `ps aux` filtered for `tsx`/`panel`/`vitest`: no matching process (only unrelated system WiFi XPC services matched
  the loose grep).

## Deviations / notable findings

1. **A real NUL byte landed in `web/src/DecisionList.tsx` on first write.** I had written a React `key` expression
   joining `row.projectKey` and `row.id` inside a template literal, intending a six-character Unicode escape
   sequence between them (mirroring `src/panel/coverage.ts`'s own `keyOf`, which joins the same two fields the same
   way). The `Write` tool instead delivered an actual raw `0x00` byte at file offset 912. This is exactly the
   failure mode CLAUDE.md / task instructions warn about. Caught by the mandated end-of-task byte-scan (a `python3`
   script counting bytes `< 0x20` outside `\t\n\r`, since `grep`/`head` would have silently mangled or hidden it).
   Fixed by rewriting the file with a plain double-colon separator instead of any control-byte-producing escape,
   re-scanned (0 bad bytes, confirmed by re-reading the raw bytes, not by re-typing the escape), and re-ran both
   `web`'s `check` and the full root `verify` to confirm nothing regressed. This has no bearing on
   `src/panel/coverage.ts`'s own `keyOf`, which is untouched and was never at risk (task 8 made no edit to it
   beyond adding `unreviewedHighTier`).
2. **Mutation predictions for F-4, F-4b and F-4c deviate from the brief's illustrative numbers** ("红在...且仅它"
   for F-4; "3" for F-4b; "2" for F-4c). The controller notes explicitly instruct predicting from the actual
   mutation table using the three questions, not copying the brief; my component structures `coverage.rate` /
   `coverage.caveat` as separate render points from the 7 items F-4b's own description names, and `review_coverage
   .reason` as its own single line rather than concatenated with `coverage.caveat`. I judged this the more literal,
   defensible reading of the controller's actual mutation descriptions (see survey grep above) rather than
   reshaping my component just to hit a number from the brief's own worked example, which the controller notes say
   the brief itself is "filled in at execution" and may be stale. Flagging this explicitly per Rule 7 rather than
   silently forcing a match.
3. **Interaction (Agree / Correct) wiring in `web/src/App.tsx` is intentionally minimal** — one-line handlers
   calling `recordReview` / `recordCorrection` with a fixed `kind: "wrong"` / empty `because` — per K7's explicit
   ruling that this has no frontend criterion (Task 9's end-to-end run covers the HTTP side) and that handlers
   should stay thin.
4. **Web components were not each individually red-then-green** the way `tests/panel/todo.test.ts` and
   `tests/panel/webParity.test.ts` were (both measured red before their source existed, per the section above).
   Given the fixed budget and that every one of the five `.tsx` files was written together with its one criterion
   in the same pass, I did not re-run `vitest` after each individual file to capture a red before its own
   component existed (that red would only ever have been "module not found", already demonstrated for the two
   root files). The FIRST real `web/check` run (post-writing all five components + all four `.tsx` criteria) went
   straight to green; I did not go back and re-derive a synthetic red for each component in isolation. This is a
   deviation from strict test-first discipline for the presentational components specifically (not for the two
   behavioral/root pieces, `unreviewedHighTier` and `GET /api/todo`, which were fully test-first).
5. `web/index.html` needed no change — it already carried `TOKEN_ANCHOR` at BASE, contrary to the controller
   notes' "if `web/index.html` lacks the anchor today, add it" contingency.

## Status

DONE. No `NEEDS_CONTEXT` escalation was needed (K2's tsconfig question resolved cleanly in favor of the design as
specified). No subagents dispatched. `/usr/bin/git` used for every git operation. No push, branch, merge or
worktree touched.

## Fix round 1 (review finding I-1 / controller ruling R60)

Commit `d44f6bb` on top of `0f506c8` (no amend). No subagents. `/usr/bin/git` for every git command. Main tree never
stashed/reset/checked out.

**Finding**: `web/src/DecisionList.tsx` built its React `key` as a fixed `"::"`-separated join of `projectKey` and
`id`. Both are unrestricted strings, so `{projectKey: "a::b", id: "c"}` and `{projectKey: "a", id: "b::c"}` produced
the same key -- the same collision class `src/panel/coverage.ts`'s own `keyOf` avoids on the server (there with a
different, non-colliding join).

**Fix**: exported a pure `rowKey(row: Pick<DecisionListRow, "projectKey" | "id">): string` from
`web/src/DecisionList.tsx` returning `JSON.stringify([row.projectKey, row.id])`, used it as the `<li>` key, and
documented in a comment why the encoding is injective for any two strings (JSON escapes every double-quote and
backslash inside each element and wraps each in its own unescaped double-quote pair, so the separating comma can
never be produced by either string's contents) and why it needs no control character.

**New criterion** (`web/tests/decisionList.test.tsx`): the review's own colliding pair (`{projectKey: "a::b", id:
"c"}` vs `{projectKey: "a", id: "b::c"}`) yields two different `rowKey` results, and the same row yields the same
key twice (positive observation, so a key generator that just returns something different every call can't pass
trivially).

**Mutation K-8 prediction** (restore the `"::"` join, never actually run — predicted only): reddens exactly the new
criterion, "gives two different keys to a pair that would collide under a fixed separator, and the same key twice
to the same row" — specifically its first assertion, `expect(rowKey(rowA)).not.toBe(rowKey(rowB))`, since both
inputs would again join to the literal string `"a::b::c"`. The second assertion in that same `it`
(`rowKey(rowA) === rowKey(rowA)`) would still hold true under the reverted join (same input, same output), so it is
never what fails, but the `it` as a whole is still red because the first assertion throws first. No other
criterion in this file is affected: "renders only the list fields, never an extra field on the row" only inspects
rendered HTML text, and a React `key` is never emitted into that output.

**A second NUL-byte incident, self-caught before commit.** Writing the `rowKey` doc-comment, I twice typed the
literal escape-sequence text for a NUL character while explaining the danger in prose (once inside the comment
itself, once again in the first draft of this fix's own commit message). Both times the tool delivered an actual
raw `0x00` byte at the point that text appeared, exactly like task 8's original incident. Caught by the same
byte-scan discipline (a `python3` script counting bytes below `0x20` outside tab/LF/CR, run immediately after each
edit, not `grep`/`head`) before anything was staged or committed. Fixed in the source file by rewriting the
paragraph in plain prose (words like "an escape sequence typed as source text" instead of the escape itself, and
"double-colon join" instead of the literal separator-with-backslash text) and, separately, by rewriting the commit
message the same way after `git commit`'s own control-character guard refused the first attempt outright.
Re-scanned after each fix: 0 bad bytes in both `web/src/DecisionList.tsx` and `web/tests/decisionList.test.tsx`,
confirmed by reading the raw bytes, not by re-typing the escape.

**A third NUL-byte incident, in this very report file, found only while writing this fix-round section.** The
byte-scan discipline above applied to source files but was never run against `task-8-report.md` itself in the
original task 8 round. Re-scanning it now (prompted by writing this section) found one raw `0x00` byte at offset
12730, inside the original "Deviations" section 1's own description of the *first* NUL-byte incident — the exact
same trap, describing itself, landed a second copy of itself into the prose. Fixed by rewriting that sentence in
plain words (no escape-syntax text at all) and republishing the whole file. Lesson, now carried in three places
(the shipped code comment, this section, and that sentence): describe control-byte hazards in words only, never in
the escape syntax that produces them, in ANY file this session touches — including its own report.

### Commands run and outputs (fix round 1)

- `npm run check --workspace web` (run as `npm run check` inside `web/`, redirected, read whole): **5 test files / 10
  tests, all passed** (was 5/9 before this fix; +1 test from the new `rowKey` criterion). `tsc --noEmit -p
  tsconfig.json` (the first half of `check`) exited clean.
- Root `npx tsc --noEmit -p tsconfig.json`: **RC=0**, no errors.
- Root `npm run verify` (full pipeline, redirected, read whole): **VERIFY_RC=0**. Root `vitest run`: **94 files / 545
  tests**, unchanged from the pre-fix-round measurement (this fix touches only `web/`, so the root suite's count is
  expected to be identical, and is).
- Byte-scan (bytes `< 0x20` outside tab/LF/CR) of both touched source files, final state: `web/src/DecisionList.tsx`
  — 0; `web/tests/decisionList.test.tsx` — 0. This report file itself, after the third-incident fix above: 0.
- `git status --porcelain -z` post-commit: 90 bytes, exactly the same two pre-existing controller entries as
  before this fix round (`M .superpowers/sdd/2026-09-10-panel-e3/progress.md`, `?? .decisions/orca-dev-5d5c8055
  .jsonl`) — neither touched.
- `git diff dc8461b HEAD --stat -- src/metrics`: empty. `git diff dc8461b HEAD --stat` grepped for `Bin` or
  `package.json`: no match (no dependency added, no binary diff).
- `ls ~/.orca`: `No such file or directory` (still absent).

### Status (fix round 1)

DONE. Commit `d44f6bb`. Web check: 5 files / 10 tests (was 5/9), root unchanged at 94 files / 545 tests. No
subagents dispatched; no push/branch/merge/worktree touched.
