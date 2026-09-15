# Task 6 review — decision list and detail endpoints

Reviewed diff: `.superpowers/sdd/2026-09-10-panel-e3/review-a9eac55..ea8c2bb.diff` (BASE `a9eac55`, HEAD `ea8c2bb`).
Read once, whole. No changed file needed a separate read to resolve a cut-off hunk. I also read, outside the diff,
the four risk-adjacent facts named below (each tied to a named risk, not a codebase crawl): `src/metrics/collect.ts`'s
private `ledgerFiles`, `src/panel/reviewsLock.ts` and `src/corrections/storeLock.ts`'s timeout constants, and the
repo for `scripts/verify-panel.mjs` (does not exist yet — a later task, not a Task 6 gap). I did not run the suite or
any mutation; the report's TDD evidence is accepted per the instructions, except where noted below.

## Named-risk checks

- **(a) every route above the four-arg error handler** — Confirmed. Both `app.get("/api/decisions", ...)` (diff
  line 113) and `app.get("/api/decision", ...)` (diff line 124) are registered before `app.use((err: unknown, ...))`
  (diff line 187). Matches ruling H10.
- **(b) detail membership requires BOTH projectKey and id from `currentMetrics`' observations** — Confirmed.
  `src/panel/api.ts` diff lines 142-148: `known = observations.decisions.some((d) => d.projectKey === projectKey &&
  d.id === decisionId)`, and the repo lookup (`observations.repos.find((r) => r.projectKey === projectKey)`, diff
  line 148) only runs `if (known)`. A browser-supplied `projectKey` can therefore only select among repos
  `currentMetrics`/`discoverRepos` already enumerated — never build a filesystem path from request input. Matches
  ruling H2.
- **(c) second clock read on the opened path** — None. `nowIso(opts)` (diff lines 58-60) is the single place `new
  Date()` appears in `api.ts`; both `currentMetrics`'s `now` callback (diff line 48) and the `opened` write's `at`
  (diff line 173) call through it. No independent `new Date()` on the detail route.
- **(d) every criterion closes its server/fixtures in `finally` and redirects `ORCA_CORRECTIONS_DIR`** — Confirmed
  for all 8 `it`s: each opens with `await withCorrectionsDir(async (dir) => {...})`, passes `{ ORCA_CORRECTIONS_DIR:
  dir }` into `parsePanelArgs`, and closes `started`/lock-holders/dist/repo fixtures in `finally` blocks (e.g.
  diff lines 331-337, 471-483 for the reviews-lock criterion, 505-509 for the corrections-lock criterion).
- **(e) H4/H5/H6/H8/H9 exist with real, non-empty assertions** — Confirmed all five ruling-mandated criteria are
  present with substantive assertions (not empty `it(...)` bodies): the two H4 criteria (diff lines 488-543), the two
  H5 criteria (diff lines 545-621), H6's renamed reviews-lock criterion with ordered assertions (diff lines 441-486),
  H8's two list assertions (diff lines 348-361, 383-390), and H9's decisionId-filtered single-`opened` criterion
  (diff lines 401-439).

## Spec Compliance

✅ Spec compliant against the brief and controller notes H1–H3, H5, H7, H9–H12, plus global constraints 1–6 and
9–12 (language, Rule 17 scope, `--by`, no repo-lock/no `.decisions` writes, no static path concat, no `0.0.0.0`,
mutation-clone discipline, unfiltered verification, bare-git, no push/branch/merge).

❌ Two issues found, detailed under Important below:
- H4/H8 assertion the code comment calls "load-bearing" is provably not independently load-bearing given how
  `expected` is built (tests/panel/decisionsApi.test.ts, diff lines 354-361) — a defect in the exact form the
  controller notes mandated keeping (H8: "keep the brief's two assertions exactly"), so it is plan-mandated per the
  calibration rule, not an implementer choice.
- The commit message's stated mechanism for why L-3b reddens contradicts the implementer's own more careful
  analysis in the report (task-6-report.md:111-121 vs. the `ea8c2bb` commit body's L-3b bullet) — a factual
  inaccuracy in an unamendable record, which the controller notes explicitly required to state only "facts true at
  the commit."

⚠️ Cannot verify from diff alone:
- Whether the report's shell commands actually invoked `/usr/bin/git`/`/usr/bin/grep` (as the controller notes and
  global constraint 11 require) rather than bare `git`/`grep` — the report's prose elides the path prefix for
  readability in several places (e.g. "`git status --porcelain -z`", "`git diff a9eac55 HEAD --stat`"). Content and
  results are internally consistent with a correct run either way; this is a documentation-precision gap, not
  evidence of a wrong command.
- The final procedural checks (`ls ~/.orca` absence, no leftover `tsx`/panel processes, byte-scan all-zero) are
  claimed in the report but not independently re-run by this review, per the reviewer instructions not to re-run
  verification the implementer already ran. Nothing in the diff contradicts them.

## Strengths

- Query-string detail contract (`detailUrl` in `src/panel/listProjection.ts`, diff lines 247-249) correctly sidesteps
  the 5-segment `projectKey`-with-slashes problem the brief flagged as external review's Critical 4, and is the one
  place the URL is spelled, matching H3.
- `nowIso(opts)` (diff lines 53-60) cleanly satisfies H1: one clock expression, shared by `currentMetrics` and the
  `opened` write, replacing what would otherwise be two copies of the same ternary.
- `decisionSource.ts`'s `ledgerFiles` (diff lines 177-184) is a byte-for-byte copy of `src/metrics/collect.ts`'s
  private helper (verified directly against `collect.ts:226-233`) — `src/metrics/**` genuinely gets zero diff, as
  required by H2, rather than exporting from E2 or reimplementing loosely.
- The reviews-lock criterion (diff lines 441-486) asserts response status and stderr content in the correct order,
  never elapsed time, and its 3000ms polling budget is consistent with the real `REVIEWS_LOCK_TIMEOUT_MS = 1_000`
  (verified in `src/panel/reviewsLock.ts:8`) — the "value that matters is the status, not the speed" point from the
  brief is genuinely enforced, not just asserted in a comment.
- All 8 criteria are properly isolated (own `withCorrectionsDir`, own dist fixture, own target repo(s), own server),
  and `metricsApi.test.ts` is untouched (confirmed: not present in the diff).
- The nine mutation predictions in the report are unusually rigorous — each answers short-circuit, "who else walks
  the line," and "where does the literal come from," and D-2's two-criteria cross-reddening analysis in particular
  is correct and non-obvious.
- The report discloses, rather than hides, its deviation from a strict red-then-green TDD cycle (Rule 12), and
  substitutes a genuine measured red (disposable `git clone --local` at BASE, main worktree untouched) rather than
  an asserted one.

## Issues

### Critical (Must Fix)

None.

### Important (Should Fix)

1. **tests/panel/decisionsApi.test.ts, diff lines 354-361 (plan-mandated by ruling H8) — the "load-bearing"
   `Object.keys(row).sort()` loop can never independently redden.** Because `expected` (diff lines 348-350) is built
   directly from `LIST_FIELDS` and the raw `DecisionObservation` fields — independently of `projectForList` — any
   mutation that changes `body.rows`' key set or any field's value will already fail
   `expect(body.rows).toEqual(expected)` (diff line 351) first, since `toEqual` is a full deep-equality check that
   requires an exact matching key set. The keys loop at diff lines 359-361 can therefore only run when `toEqual`
   already passed, at which point the key sets are already known to be identical — it is structurally redundant with
   the assertion above it, not an independent check. The comment ("THIS is the load-bearing assertion, not a
   restatement of the one above") is false for the current test design; it was true only under the brief's original,
   flawed form where `expected` was built by calling `projectForList` (making `toEqual` tautological). This is
   exactly the class of defect Rule 9 calls out: an assertion that, given the surrounding code, cannot be the one
   observed red for any mutation the design intends it to catch. The report's own L-3b analysis (task-6-report.md:
   111-121) independently reaches the same conclusion but doesn't correct the in-file comment or flag it as a
   controller-notes-conflicting finding. **Fix**: either delete the redundant loop and its comment, or replace the
   comment with an honest one (e.g., "kept as a readable second check; `toEqual` above already implies this"), and
   flag to the controller that H8's brief text asserted something about test independence that is no longer true
   after the C1 repair.

2. **Commit `ea8c2bb` message vs. task-6-report.md:111-121 — contradictory claims about which assertion catches
   L-3b.** The commit body states: "the per-row `Object.keys(...).sort()` assertion in the SAME `it` is the one that
   actually catches it." The report's own more careful analysis (task-6-report.md:111-121) concludes the opposite:
   "this assertion alone already reddens [`toEqual`]... the file's own follow-up `Object.keys(row).sort()` assertion
   would also catch it but never runs because the prior expect throws first." I independently verified the report is
   correct (see Important #1): under the L-3b mutation (`projectForList` returning `{ ...decision, summary: ... }`),
   `toEqual` fails first because the mutated row carries extra keys `toEqual` does not tolerate. The final prediction
   ("red in X and only it") is the same in both places, so no verifier will be misled about *which test* goes red —
   but the commit message misstates *why*, and per Rule 13 this repo's commit history cannot be edited in place.
   Controller notes' final-checks section explicitly required "the commit message states facts true at the commit."
   **Fix**: a follow-up commit or handoff note correcting the record (not an amend), per Rule 13's "another section
   records the correction, original text stays verbatim."

### Minor (Nice to Have)

1. `get`/`makeDistFixture` are duplicated between `metricsApi.test.ts` and `tests/panel/decisionsApi.test.ts`
   (diff lines 285-299) rather than extracted to a shared `tests/panel/httpHarness.ts`. Ruling H7 explicitly offered
   either option and the implementer's stated reason (zero touch to `metricsApi.test.ts`, provably still 12/12) is
   reasonable — flagging only as a future drift risk if a third panel test file needs the same helpers.
2. `loadDecisionRow`'s return type is `Promise<unknown | undefined>` (src/panel/decisionSource.ts diff line 197).
   Reasonable given it returns an untyped raw ledger row and the brief doesn't ask for a stronger type, but a
   `Record<string, unknown> | undefined` would give callers slightly more to work with without inventing a new
   parser or type.

## Assessment

**Task quality:** Needs fixes

**Reasoning:** The implementation is spec-compliant on every functional requirement and both routing/security risks
((a) and (b)) checked out clean, with unusually thorough mutation-prediction reasoning. The two Important findings
are both about test/commit-record integrity rather than production behavior — a dead-but-labeled-"load-bearing"
assertion that ruling H8 required be kept verbatim, and a factual inconsistency between the commit message and the
implementer's own report about *why* (not *whether*) a mutation reddens — but this repo's own rules (9, 13, 14) treat
exactly this class of defect as blocking, so I'm calibrating accordingly rather than waving it through as cosmetic.
