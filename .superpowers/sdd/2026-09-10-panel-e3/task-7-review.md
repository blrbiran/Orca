# Task 7 review — POST /api/corrections and POST /api/reviews

Base `248f03a`, head `dc8461b`. Diff: `src/panel/api.ts` (+171/-7 within its hunks), `tests/panel/correctApi.test.ts` (new, 536 lines, 11 `it`s). Reviewed the diff file whole plus targeted reads of `src/corrections/record.ts`, `src/corrections/store.ts`, `src/corrections/projectKey.ts`, `src/panel/reviewsStore.ts`, `src/panel/reviewsLock.ts`, `tests/corrections/injectableClock.test.ts`, `tests/corrections/harness.ts`, and the full (non-diff-truncated) `src/panel/api.ts` — one pass, diff small enough not to need splitting.

## Named-risk checks (one focused check each)

**(a) browser never names a filesystem path.** `POST /api/corrections`/`/api/reviews` read `body.projectKey`/`body.decisionId` only (api.ts:203-204, 236-237), gate through `currentMetrics(deps.opts)` + `isListedDecision` (api.ts:206-209, 239-242), same shape as `/api/decision`. `grep -rn "projectKeyOf" src/panel` (report, and I re-derived it by reading the file): zero hits. Confirmed.

**(b) no row literal / `new Date()` for correction `at`.** `row = correctionRowFrom(input, panelClock(deps.opts))` (api.ts:222) is the only place a `CorrectionRow`-shaped value is built for a correction; `input` (api.ts:210-221) omits `at` entirely (`NewCorrectionInput = Omit<CorrectionRow, "at">`, record.ts:9). The file's only `new Date()` literal is `panelClock`'s default fallback (api.ts:59), inherited unchanged from Task 6's `nowIso`. Confirmed — one construction point, one clock.

**(c) panelClock/nowIso refactor preserves Task 6 behaviour.** Old: `(opts.now ?? (() => new Date()))().toISOString()`. New: `panelClock(opts)().toISOString()` where `panelClock` returns exactly `opts.now ?? (() => new Date())`. Semantically identical — same expression, only named. `isListedDecision` extraction (api.ts:74-80) is the same `.some(...)` body moved verbatim out of the `/api/decision` handler (api.ts:151→165 diff hunk), not rewritten. I verified this by inspection rather than re-running the suite (no doubt raised); report claims 35/35 across `correctApi`/`decisionsApi`/`metricsApi`/`injectableClock` together, consistent with a behaviour-preserving refactor.

**(d) error-path shapes.** Traced against `record.ts`/`store.ts` source, not just the report:
- `CorrectRejection` with `CORRECTION_ROW_INVALID` (schema `safeParse` failure, e.g. unknown `kind`, or `chose_instead: ""` since `correctionSchema` refuses rather than coerces) → 400, `{code, message}` (api.ts:236-239). Verified `record.ts`'s refusal message includes the field name (`sentEmpty` advice, record.ts:105-112), satisfying T2's `message.toContain("chose_instead")`.
- `CorrectRejection` with `CORRECTION_ALREADY_RECORDED` (store.ts:90-96, key is `(projectKey, decisionId, by)`, confirmed no `kind`) → 409, panel's own sentence, no `--again` substring, `retry_field: "again"` (api.ts:224-232). Correct per spec §4.4.
- `reviewed`-append failure after a successful correction → 409 with `{code, message, correction: stored}`, message states both halves (api.ts:257-266). Never 200 on this path — confirmed, `res.json({correction: stored})` is unreachable once the catch fires (`return` after the 409).
- Non-`PanelRejection` append error → falls back to `code: "panel-internal-error"` but keeps the real `err.message`/`String(err)` in the body text rather than fabricating one — not misleading, just generically coded.

**(e) "nothing happened" criteria have a positive observation; loop-closing criterion snapshots names+hashes+HEAD.** `records and does NOT close the loop` (correctApi.test.ts:431-473): positive (`res.status`==200, `readCorrections` length 1) precedes the negative checks; negative checks are `git status --porcelain === ""`, `git rev-parse HEAD === beforeHead`, and `snapshotDecisionsDir` (sorted `readdir` names **and** sha256 of every file's contents, correctApi.test.ts:345-350) equal to a pre-POST snapshot — covers both "new run file" and "append to existing file" close-the-loop shapes. `does NOT write reviewed when refused` and `answers 404 ... records nothing` both assert the refusal status/code before the empty-store assertions. I independently confirmed `makeTargetRepo()`'s fixture lives under `mkdtemp(join(tmpdir(), "orca-target-"))` (harness.ts:72), never this repository, so a C-5-style mutation could only ever dirty a `$TMPDIR` throwaway.

**(f) routes above the error handler; non-object JSON body doesn't crash.** Full-file read confirms both `app.post(...)` blocks (api.ts:195, 285) are registered before the terminal `app.use((err, ...) => ...)` (api.ts:326). For a non-object body: `express.json({limit:"64kb"})` is mounted with default `strict: true` (server.ts:101) — top-level JSON scalars/`null` are rejected by body-parser itself (never reach the handler) and top-level JSON arrays are accepted but `array.projectKey` etc. is simply `undefined` (no throw), falling through to the 404 membership-refusal path. No crash in either case; this is pre-existing `server.ts` configuration, not something this diff introduced or needed to change.

## Cross-checked independently of the report

- `GOLDEN_ID`/`GOLDEN_INSTANT` duplication (correctApi.test.ts:303-304) matches `tests/corrections/injectableClock.test.ts:16,40` verbatim, and I confirmed `normalizeRemoteUrl("https://github.com/biran/orca.git")` → `"github.com/biran/orca"` (projectKey.ts:21-32) equals the literal `--repo` label the panel test passes (`github.com/biran/orca=<path>`), and that `--repo <projectKey>=<path>` sets `projectKey` to the label verbatim rather than deriving it from the remote (server.ts:57-68) — so the GOLDEN_ID HTTP round-trip genuinely exercises the same `projectKey` the CLI path would derive, restoring §2.3's actual claim rather than a coincidental match.
- Dedupe key and `--again` message text read from `store.ts` directly, confirming the mutation predictions in the report (C-14, T4) are grounded in the real refusal text, not assumed.

## Spec Compliance

- ✅ Spec compliant. Brief's file list (Modify `src/panel/api.ts`, Test `tests/panel/correctApi.test.ts`) fully covered; both endpoints produced. Controller notes J1–J8 all implemented and traceable to specific lines (membership J1, one construction point + one clock J2, differentiated T1/T3 per J3, positive+negative loop snapshot J4, own message + retry_field J5, `reviewed` semantics and the four-way split J6, per-`it` isolation J7, route ordering J8).
- ⚠️ Cannot verify from diff alone: the claimed 92/92 file, 538/538 test `npm test` run and the two other verify tiers are reported but not re-run by me (per reviewer instructions, no re-run without a specific doubt — none arose). The controller's own final-checks list (porcelain, `ls ~/.orca`, process check, byte scan) is likewise taken from the report; nothing in the diff or dependent source contradicts any of it.

## Strengths

- The membership check (`isListedDecision`) is genuinely one definition shared by three handlers (api.ts:74-80), not three near-copies — exactly what J1 asked for, and it retroactively simplified `/api/decision`'s own handler too.
- `panelClock`/`nowIso` factoring correctly makes `correctionRowFrom`'s clock, the `opened`/`reviewed` timestamps, and `currentMetrics`'s clock all read one shared expression, with a clear doc comment explaining why (api.ts:51-57), and the refactor was verified not to disturb Task 6's own passing suites.
- The GOLDEN_ID criterion is a real restoration of §2.3's claim (cross-process id agreement) rather than the brief's originally-unmutatable "same id" wording — the implementer's own report explains why the brief's version could never go red, and the controller notes independently confirm this; both align.
- Error handling distinguishes three genuinely different shapes (row-invalid 400, already-recorded 409 with a rewritten message, reviewed-append-failed 409 with the correction still surfaced) exactly as spec §4.3.1/§4.4 require, and the asymmetry between `/api/reviews`' failed append (propagates to the shared 409 handler) and `/api/corrections`' failed append (must report the already-landed correction) is handled with different code paths for a principled reason, not accidentally.
- Test isolation (own server, own `ORCA_CORRECTIONS_DIR`, own target repo, own dist fixture, `finally`-blocks) is consistent across all 11 criteria.
- `chose_instead` passthrough is genuinely exact (spread only when `!== undefined`), matching the one place record.ts's comment says an empty-string coercion would be silently harmful.

## Issues

#### Critical (Must Fix)
None.

#### Important (Should Fix)
None.

#### Minor (Nice to Have)

- correctApi.test.ts:514-542 ("records another one when the page asks for it on purpose") relies on the two POSTs' wall-clock `at` values differing (no injected clock in this one test) to get two distinct correction ids; an extremely fast back-to-back pair of `new Date().toISOString()` reads at the same millisecond would make `deriveCorrectionId` collide and the second POST would 400 (`DUPLICATE_CORRECTION_ID`) instead of 200. In practice an awaited HTTP round-trip makes this vanishingly unlikely, and no other test in this file shares the risk (all others inject a fixed clock), but it is the one test that doesn't pin its own timing. Not worth blocking on; flagging only per Rule 9's spirit of naming what could make a green run vacuous under sufficiently pathological timing.
- The sanity assertion in the GOLDEN_ID test (correctApi.test.ts:758-768) pins `sanityRow.at` against `GOLDEN_INSTANT` but does not independently recompute `GOLDEN_ID` from `deriveCorrectionId` inside this file — the id equality is only checked once, at the HTTP layer. This is an acceptable trade-off (recomputing here would just re-import the same pure function under test) and is explicitly discussed in the file's own comment; noting only that if `deriveCorrectionId`'s hash algorithm ever changes, this test and `injectableClock.test.ts`'s own `GOLDEN_ID` assertion would both need updating together, which is already true of any duplicated-literal pinning.

## Assessment

**Task quality:** Approved

**Reasoning:** All eight binding rulings (J1–J8) are implemented at the precise lines the notes specified, the six named risks in my dispatch all check out against the actual dependency source (not just the implementer's narrative), and the mutation predictions in the report are independently corroborated by reading `store.ts`/`record.ts`/`reviewsLock.ts` directly rather than trusted at face value. No behavior-affecting or maintainability defects found; the two Minor notes are timing-risk and belt-and-suspenders observations, not blockers.
