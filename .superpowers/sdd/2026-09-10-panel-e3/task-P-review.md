# Task P Review — make the correction clock injectable, and give the panel the ONE row constructor

## Spec Compliance
- ✅ Spec compliant
  - `NewCorrectionInput = Omit<CorrectionRow, "at">` and `correctionRowFrom(input, now: () => Date): CorrectionRow` land exactly as specified in `src/corrections/record.ts:9,22` (diff lines), exported, `now` required (no default) — brief's "the entry point owns the clock" honored.
  - Field order in the returned literal matches the brief exactly: `projectKey, decisionId, kind, chose_instead, because, at, by` (`src/corrections/record.ts` new `correctionRowFrom` body).
  - `correct.ts`'s private `correctionRowFrom` is gone; both `record` and `close-new` branches call `correctionRowFrom(newCorrectionInputFrom(parsed, projectKey), now)` — one shared mapping function (`newCorrectionInputFrom`) used by both branches, as required.
  - `correct(argv: string[], opts: { now?: () => Date } = {})`, `const now = opts.now ?? (() => new Date())` — matches the required signature verbatim. No `--at` flag added; `args.ts` untouched (confirmed via `git diff a801200..297a2ce -- src/corrections/args.ts` → empty).
  - The close path's separate ledger `at = new Date().toISOString()` (E16) is untouched — confirmed absent from the diff.
  - Out-of-scope files (`fields.ts`, `store.ts`, `schema.ts`, `args.ts`, `src/ledger/**`, `src/scheduler/**`, `src/cli.ts`) are all untouched — verified with `git diff a801200..297a2ce --stat` against each (empty).
  - Published-comment (ERRATUM) rule followed correctly in both required spots: the moved doc comment in `record.ts` and the `recordSeam.test.ts:132` comment, both keep original words verbatim and append `*** ERRATUM (2026-09-10, human authorisation to inject the correction clock) ***` with no git refs or falsifiable counts.
  - The `grep -rn "inject" src/corrections tests/corrections` survey in the report is complete and accurate — independently re-ran it (`/tmp/inject_grep.txt`) and every hit/disposition matches: only `recordSeam.test.ts:128` needed an ERRATUM, everything else is a different, still-true clock (derive.ts's ledger-row clock, storeLock.ts's lock-timeout clock, close.test.ts's unrelated "fault injection" terminology).
  - `tests/corrections/injectableClock.test.ts` implements all 4 required criteria: direct-constructor stamping, record-mode `at`, close-mode `at`, and same-input/same-clock ⇒ same id + golden literal. `deriveCorrectionId` is not imported/used in the test. Every `it` carries a "why it matters" comment (Rule 9).
  - TDD evidence in the report shows all four criteria red on the `at`/id assertions (not compile/setup errors) against the no-op stub, then green after real wiring — matches the brief's required order.
  - Single commit, subject exactly `feat(corrections): make the correction clock injectable and give the panel the one row constructor`; body covers why (spec §2.3, human authorisation, no `--at`), what, and red→green evidence; ends with the exact attribution lines the brief specified. Verified via `git log -1 --format=%B 297a2ce`.
  - Rule 17: all new-test writes go through `withCorrectionsDir` (temp `ORCA_CORRECTIONS_DIR`); report's final `ls ~/.orca` still errors "No such file or directory".
- ⚠️ Cannot verify from diff alone:
  - Whether `.decisions/orca-dev-6354277a.jsonl` was actually produced by running the real `appendEvent` writer (as the brief mandates, "never by hand") rather than hand-authored to look like it. The diff only shows the resulting file. Corroborating evidence: I read `src/ledger/writer.ts` (`appendEvent`/`appendEvents`) — it writes one `JSON.stringify(event)` line per call, which matches the single-line shape of the new file exactly, and the report's `npm run ledger -- validate .decisions` output (RC=2, only pre-existing lines in a *different* file downgraded, nothing on `orca-dev-6354277a` flagged) is consistent with a validator-accepted real write. I did not re-execute anything to confirm provenance beyond this.
  - The full reported test counts (83/471 whole-repo, 51/167 verify:scheduler, 14/88 tests/corrections) were not independently re-run, per instructions (no doubt raised that would justify re-running).

## Strengths
- The row-construction consolidation is exactly the interface the brief pinned — no redesign, no scope creep (no incidental touch to `projectKey`, no default `now` on the shared constructor, no `--at` flag).
- The mapping from `parsed` to `NewCorrectionInput` was pulled into one named function (`newCorrectionInputFrom`) used by both branches, closing the exact gap (two independently-built rows) the brief was worried about.
- Test file is disciplined about Rule 9: every expected value in criterion 1 is a literal, not a value re-derived from the function under test; criterion 4 explicitly avoids `deriveCorrectionId`, sourcing the golden id as an observed-once literal with a comment explaining why (Task 7 will assert the same literal).
- The comment-fidelity work (verbatim preservation + correctly-scoped ERRATUM, and the full `inject` grep survey with per-hit disposition) is thorough and independently checked out clean.
- Self-flagged, correctly-scoped judgment call about the duplicated `recordArgs`-shaped test helper (Rule 7 disposal, not silently fixed out-of-scope).

## Issues

#### Critical (Must Fix)
None.

#### Important (Should Fix)
None.

#### Minor (Nice to Have)
- The doc comment moved verbatim to `src/corrections/record.ts` still says "before this it was written out twice in the function below" — "below" referred to `correct()` when the comment lived in `correct.ts`; in `record.ts` there is no such function below it any more, so the sentence now reads as a dangling reference. The brief explicitly specified verbatim-move-plus-one-ERRATUM and didn't ask for this to be addressed, so not a defect against the brief, but worth a follow-up ERRATUM or note next time this comment is touched.
- Two structurally similar `recordArgs`(-shaped) test helpers now exist (`tests/corrections/recordSeam.test.ts` and the new `tests/corrections/injectableClock.test.ts`), each locally defined because `harness.ts`'s `closeArgs`/`recordArgs` are shaped for `runCli`, not direct `correct()` calls. Already self-flagged in the report per Rule 7 rather than fixed; reasonable to leave for a later harness task.

## Assessment
**Task quality:** Approved
**Reasoning:** The diff matches every element of the brief's exact interface, respects every stated scope boundary (verified independently against the base commit), correctly follows the ERRATUM rule in both required spots, and the new test file's four criteria are real, non-tautological, and were shown red-then-green per Rule 9/TDD. No Critical or Important defects found; the only open item is a diff-invisible provenance detail (ledger row) that is corroborated, not contradicted, by the writer's source and the reported validation run.
