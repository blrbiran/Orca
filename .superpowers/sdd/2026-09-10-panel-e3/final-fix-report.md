# E3 final fix wave — implementer report

Run `orca-dev-5d5c8055`, 2026-09-16. BASE `952739d`, HEAD `435f0f1`. Branch `main`, local commits only
(no push, branch, merge, worktree, stash, reset or checkout in the main tree). No subagents. Nothing written to
`.decisions/`; nothing under `.superpowers/sdd/**` except this file.

Evidence files (all under the session scratchpad
`/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/5d5c8055-111d-4296-ad0c-e78a5b191f54/scratchpad/ffx/`):
`red_base.txt`, `red_base_web.txt`, `red_detail_revert.txt`, `red_vp_base.txt`, `red_vp_base2.txt` (reds);
`green_panel.txt`, `green_web.txt`, `green_metrics2.txt` (greens); `verify1.txt`, `verify2.txt` (full verify);
`vp_alone.txt`, `census_before.txt`, `census_after.txt`, `lsof_before.txt`, `lsof_after.txt`, `lsof_diff.txt`,
`orca_before.txt`, `orca_after.txt` (standalone verify:panel); `diffstat_final.txt`, `bytescan_committed.txt`.
Red-measurement clone: `.../scratchpad/base-clone` (`git clone --local` at `952739d`, both `node_modules`
symlinked; only test files, `web/src/types.ts`, `scripts/verify-panel.ts`, `src/panel/bindGuard.ts` and a copy of
`web/dist` were ever placed into it, as listed per red below).

## Commits

| sha | finding | paths |
|---|---|---|
| `618d38d` | F-1 | `src/panel/reviewsStore.ts`, `tests/panel/reviewsStore.test.ts`, `tests/panel/todo.test.ts`, spec §4.3.2 hunk only |
| `fc03bfa` | F-2 | `src/panel/api.ts`, `src/panel/rejection.ts`, `tests/panel/correctApi.test.ts` |
| `35e39a8` | F-3 | `web/src/{types,api}.ts`, `web/src/{App,DecisionDetail,Refusal,ErrorPage}.tsx`, `web/tests/{outcome,decisionDetail}.test.tsx`, `tests/panel/webParity.test.ts` |
| `6193738` | F-4 | `src/panel/bindGuard.ts`, `src/panel/server.ts`, `tests/panel/metricsApi.test.ts`, `tests/panel/security.test.ts`, `scripts/verify-panel.ts`, spec §3.3 hunk only |
| `c4f5978` | F-5 | `src/corrections/record.ts` |
| `435f0f1` | F-4 follow-up | `tests/panel/metricsApi.test.ts` (adds the portless `evil.localhost` Host so HG-2 is red whether it matches the parsed hostname or the raw header) |

The spec file carries two errata for two findings; each commit staged only its own hunk (`git apply --cached` of the
split `git diff` hunk), never the whole file.

---

## F-1 — reviews dedupe key includes projectKey (`618d38d`)

**Change.** `key()` is now `[row.projectKey, row.decisionId, row.by, row.action].join(UNIT_SEPARATOR)`. The existing
`UNIT_SEPARATOR` constant line was not touched (no separator written anew). An English ERRATUM comment above `key`
records why and that the class comment's bound becomes 2 x distinct (projectKey, decisionId). Spec §4.3.2 gets the
Chinese ERRATUM block (key, why: §4.2's joint key and E2's measured id repetition across clones, the probe's
measurement, the red re-measured here, the new bound). No existing criterion contradicted the new key; none edited.

**Criteria.**
- `tests/panel/reviewsStore.test.ts` "keys dedupe by projectKey too: the same decision id in two repositories writes
  two rows" — proj-a then proj-b both `written`, `readReviews` length 2; proj-a again `duplicate`, length still 2
  (positive control that dedupe still works).
- `tests/panel/todo.test.ts` "(f) agreeing on two repositories' decisions that share an id takes BOTH off the to-do
  list" — two repos (`makeTargetRepo()` both seeded with `orca-dev-1/1`), positive control that `/api/todo` lists
  both first, then `POST /api/reviews` on each answers 200 `written`, `/api/todo` rows `[]`, 2 `reviewed` rows.

**Measured red (clone at BASE, new tests copied in; `red_base.txt`).** Both red at
`expected 'duplicate' to be 'written'` (reviewsStore.test.ts:114, todo.test.ts:194).

**Mutation prediction — RK-1 (drop projectKey from `key()`).**
1. Red: the reviewsStore "keys dedupe by projectKey too" criterion and todo.test.ts (f) — and only those two.
2. Where: both at the second append/POST returning `duplicate` instead of `written` (the same shape measured at BASE).
3. Stays green: every other reviewsStore criterion (they use one projectKey), decisionsApi's two-repo detail
   criterion (it never inspects `opened` rows), verify:panel (one repository).

## F-2 — error mapping (`fc03bfa`)

**Change (`src/panel/api.ts`, `src/panel/rejection.ts`).**
- `PANEL_BAD_REQUEST = "panel-bad-request"` exported from `rejection.ts`.
- `objectBody(req, res)`: both POST handlers call it first; anything that is not a plain object (undefined, array,
  other) answers `400 { code: "panel-bad-request", message }` before any field is read.
- Error handler: before the 500 arm, an error with a string `type` and a numeric 4xx `status` (express.json's
  http-errors) answers `400 panel-bad-request` with `the request body could not be read: <message>`.
- 500 fallback message: `err instanceof Error ? err.message : String(err)`.
- `CorrectRejection` with code `CORRECTIONS_STORE_BUSY` (imported from `src/corrections/storeLock.ts`) answers 409;
  other `CorrectRejection`s stay 400.

**Judgment call (Rule 1 ladder, reversible, decided here — flagged).** The notes say POST handlers "read
`req.body ?? {}`" AND require "POST /api/reviews with no content-type -> 400". Those two contradict: with no JSON
content-type Express 5 leaves `req.body` undefined, `?? {}` turns it into `{}`, which is a plain object, and the
handler then answers `404 decision-not-found` for decision "" (not 400). The review's I-2 fix sketch carries the same
inconsistency. The criterion is the command-checkable requirement, so it wins: `objectBody` refuses `undefined` as
"no JSON body" instead of coercing it. `?? {}` does not appear. Also: JSON `null`/string/number bodies never reach the
handler — express.json's default strict mode rejects them as parse failures, so they land in the 400 parser arm; only
arrays reach `objectBody`'s non-object branch. Every body-parser 4xx (including 413 too-large) answers 400 as the notes
literally say, not its own status.

**Criteria (`tests/panel/correctApi.test.ts`, new describe "the panel's error mapping for client mistakes"; raw
`node:http` POST helper `rawPost`; each loops over BOTH `/api/reviews` and `/api/corrections` and asserts nothing was
written).**
- no content-type -> 400 + `panel-bad-request` + non-empty message.
- `content-type: application/json`, body `{not json` -> 400 + code.
- JSON array body -> 400 + code.
- corrections store lock held (`acquireStoreLock(dir)`) -> `POST /api/corrections` 409 + `corrections-store-busy`,
  0 rows; positive control after release: the same POST -> 200, 1 row.

**Measured red (clone at BASE; `red_base.txt`).** no content-type `expected 500 to be 400`; malformed JSON
`expected 500 to be 400`; array `expected 404 to be 400`; store-busy `expected 400 to be 409`.

**Mutation predictions.**
- **EB-1 (remove the body-parser error mapping).** 1. Red: "refuses a malformed JSON body" only. 2. At
  `expect(res.status).toBe(400)` receiving 500 (falls to the 500 arm). 3. Green: no-content-type, array and
  store-busy criteria (no parser error on those paths), every existing criterion.
- **EB-2 (remove the non-object refusal).** 1. Red: "no content-type" and "array" — and only those. 2. no
  content-type: 500 (TypeError on `undefined.projectKey`) if the handler goes back to `req.body as Record`, or 404 if
  replaced by `req.body ?? {}`; array: 404 (fields of `[]` are undefined -> ""). Removing it from only one handler is
  still red in both criteria, since each loops over both endpoints. Caveat: if EB-2 is spelled as only dropping the
  `!Array.isArray` test, then only the array criterion reds. 3. Green: malformed JSON (EB-1's arm), store-busy.
- **EB-3 (map store-busy back to 400).** 1. Red: the store-busy criterion only. 2. At
  `expect(res.status).toBe(409)` receiving 400. 3. Green: the existing "unknown kind -> 400 correction-row-invalid"
  and "empty optional field" criteria (non-busy codes still 400).

## F-3 — the page tells the person what happened (`35e39a8`)

**Change.**
- `web/src/types.ts`: `WEB_CORRECTION_KINDS = ["wrong", "not_my_taste", "stale"]` (count measured in
  `src/corrections/schema.ts`: 3), `satisfies readonly CorrectionKind[]`.
- `web/src/api.ts` (JSX-free): `PanelRefusal`, `PostResult<T>` (`{ ok: true, body }` or
  `{ ok: false, status, code, message, retry_field? }`), `refusalFrom`, `PanelRequestError` (thrown by refused GETs,
  carries the refusal), `failureFrom(err)`, `CorrectionForm`, pure `correctionBody(target, form)` (omits a blank —
  empty or whitespace-only — `chose_instead`, keeps a filled one verbatim, sends `because` exactly as given, supplies
  no value of its own). `recordCorrection` / `recordReview` return `PostResult`. Server unchanged.
- `web/src/Refusal.tsx` (pure): code + message; "Record another" button only when `retry_field === "again"`.
- `web/src/ErrorPage.tsx` (pure): status (or "no answer"), code, message.
- `web/src/DecisionDetail.tsx`: correction form (`kind` select over `WEB_CORRECTION_KINDS`, `because` textarea
  `required`, `chose_instead` input optional), submits the boxes as typed to `onCorrect(form)`; ERRATUM appended to
  the file comment.
- `web/src/App.tsx`: every POST awaited through `send`; refusal -> `Refusal` (record another resends the last
  correction body with `again: true`); success -> status line + refetch todo and metrics; load failures ->
  `ErrorPage` with the server's code and message. ERRATUM appended to the file comment.

**Criteria.**
- `tests/panel/webParity.test.ts`: `WEB_CORRECTION_KINDS` same SET as `CORRECTION_KINDS` (runtime), plus
  compile-time mutual assignability of the two `CorrectionKind` types.
- `web/tests/outcome.test.tsx` (new, 7): `correctionBody` omits blank (`""`, `"   "`) and keeps `because`;
  keeps a filled `chose_instead` (`toStrictEqual` of the whole body); `Refusal` renders code and message; "record
  another" present only for `retry_field: "again"` (absent with none and with `"other"`); `ErrorPage` renders the gate
  refusal's code (`unresolved-project-keys`) and message; stubbed `fetch`: a refused GET (`fetchMetrics`) -> 
  `failureFrom` yields status/code/message; a refused POST (`recordCorrection`) resolves to the typed refusal with
  `retry_field`. (The last two go beyond the notes' list: without them the GET/POST mapping in api.ts had no
  criterion.)
- `web/tests/decisionDetail.test.tsx`: the form renders an option per kind, a `required` because textarea, and a
  non-required `chose_instead` input.

**Measured red.**
- Clone at BASE (`red_base.txt`, `red_base_web.txt`): parity `WEB_CORRECTION_KINDS is not iterable`;
  decisionDetail form criterion `WEB_CORRECTION_KINDS is not iterable`; `outcome.test.tsx` fails at module load
  (`Failed to load url ../src/ErrorPage.js`).
- Clone at BASE + only the new `web/src/types.ts` (the DecisionDetail change reverted; `red_detail_revert.txt`): the
  form criterion red at `expected '<article ... <button type="button">Correct</button></article>' to contain
  '<option value="wrong"'`.
- ⚠️ **Honest gap (Rule 9):** for `outcome.test.tsx` the only red measured is the module-load failure at BASE (the
  modules it imports did not exist). No assertion-level red of those 7 criteria was seen; the UI-1..UI-4 reds below
  are predictions only, as the contract requires.

**Mutation predictions.**
- **UI-1 (`correctionBody` sends `chose_instead: ""` for a blank box).** 1. Red: "omits a blank chose_instead box"
  only. 2. At `expect("chose_instead" in body).toBe(false)` for `""`. 3. Green: "keeps a filled chose_instead"; the
  stubbed-POST criterion (its fetch stub ignores the request body).
- **UI-2 (Refusal drops `message`).** 1. Red: "renders the server's code and message" only. 2. At
  `toContain(alreadyRecorded.message)`. 3. Green: record-another criterion (asserts only the button's testid),
  ErrorPage criterion (separate component).
- **UI-3 ("record another" regardless of `retry_field`).** 1. Red: "offers 'record another' only when..." only.
  2. At the first `not.toContain("record-another")` (no retry_field). 3. Green: code/message criterion.
- **UI-4 (error page shows only the status).** 1. Red: the ErrorPage criterion only. 2. At `toContain(gate.code)`.
  3. Green: the stubbed-GET criterion (it goes through `failureFrom`, not `ErrorPage`), App.test (loading text).

## F-4 — Host allowlist against DNS rebinding (`6193738`, `435f0f1`)

**Change.**
- `src/panel/bindGuard.ts`: exported `PANEL_HOST_NOT_ALLOWED = "panel-host-not-allowed"` and pure
  `isHostAllowed(bind, host)`: parses `[v6]:port` and `name:port` (lowercased; anything else, empty, or missing ->
  refused); accepts exactly `127.0.0.1`, `localhost`, `::1`, or the bind address itself. No suffix matching.
- `src/panel/server.ts`: the guard is the FIRST middleware in `createPanelServer`, before `express.json`, hence before
  the static route and the `/api` token check. Refusal: `403 { code, message }`, message names only the accepted
  names, never the token.
- `scripts/verify-panel.ts` step 9: `rawGet` takes optional headers; after the existing positive control, `GET /`
  with `Host: evil.example:<port>` must be 403, carry no token, and name `PANEL_HOST_NOT_ALLOWED` (imported). Folded
  into step 9's PASS line; numbering and the 13 PASS lines unchanged.
- Spec §3.3 ERRATUM (Chinese): rebinding was not registered; the probe's measurement; the fix and its criteria; what
  remains (an allowed name resolving to a hostile address is out of scope for a loopback bind; a hostname bind in
  confirmed external mode can itself be rebound, which falls under the already-registered "external mode is not for
  teams").

**Judgment call (reversible, flagged).** The notes say a loopback bind accepts "only" the three names and an external
bind "also" the bind address. I accept the bind address in both cases. It only differs for a loopback bind other
than `127.0.0.1` (bindGuard allows all of 127.0.0.0/8): without it, `--bind 127.0.0.2` prints a URL the panel then
refuses with 403. An IP literal cannot be rebound, so this admits no rebinding vector. `--bind localhost` / `::1` are
already in the set.

**Criteria.**
- `tests/panel/metricsApi.test.ts`, describe "the Host allowlist" (raw `node:http`, `Host` set by hand, in-process
  server with a redirected store, a repo and a dist fixture, closed in `finally`):
  - foreign Host on `/`: for `evil.example`, `evil.example:<port>`, `evil.localhost`, `evil.localhost:<port>` -> 403,
    code, body without the token.
  - foreign Host `evil.example:<port>` on `/api/metrics` WITH a valid token -> 403, code, no token.
  - positive controls: `127.0.0.1:<port>`, `localhost:<port>`, `[::1]:<port>` -> `/` 200 with the token, and
    `/api/metrics` with token 200.
- `tests/panel/security.test.ts`: pure predicate — TEST-NET-1 bind accepts itself and `localhost`, refuses
  `evil.example`; a `127.0.0.1` bind refuses TEST-NET-1; `::1` bind accepts `[::1]:7777`; `LOCALHOST:7777` accepted;
  `undefined` and `""` refused.
- `scripts/verify-panel.ts` step 9 as above.

**Measured red.**
- Clone at BASE (`red_base.txt`): `/` criterion `evil.example: expected 200 to be 403`; `/api/metrics` criterion
  `expected 200 to be 403`; security predicate `isHostAllowed is not a function`. Positive controls green at BASE, as
  they must be.
- verify:panel, new script against BASE source: first attempt (`red_vp_base.txt`) failed at load — tsx refuses the
  missing `PANEL_HOST_NOT_ALLOWED` export — not a step-9 red. Second attempt with the new `bindGuard.ts` also copied
  into the clone (so the module exists but `server.ts` is BASE and never calls it; `red_vp_base2.txt`): PASS 0..8,
  then `FAIL 9 GET / with Host evil.example answers 403: 403 vs 200`, RC 1, teardown clean, no panel process left.
  ⚠️ That state is the same shape as HG-1, so HG-1's verify:panel half has in effect been observed, not only predicted.
- `evil.localhost` (portless) was added in `435f0f1` after the first commit; the criterion was already red at BASE on
  its first element, and is green at HEAD (`green_metrics2.txt`).

**Mutation predictions.**
- **HG-1 (delete the Host middleware).** 1. Red: metricsApi "refuses a foreign Host on the token-carrying page",
  metricsApi "refuses a foreign Host on the API", and verify:panel step 9. 2. At `expect(res.status).toBe(403)`
  receiving 200 (first element `evil.example`), and `FAIL 9 ... 403 vs 200`. 3. Green: the positive-control
  criterion, the security.test.ts predicate criterion (the function still exists).
- **HG-2 (accept any Host that ends with `localhost`).** 1. Red: metricsApi "refuses a foreign Host on the
  token-carrying page" only. 2. On the `evil.localhost` element (portless if the match is on the raw header; both
  spellings if on the parsed hostname), `expected 200 to be 403`. 3. Green: the `/api/metrics` refusal and
  verify:panel step 9 (both use `evil.example`), the predicate criterion (none of its refused hosts ends with
  `localhost`), the positive controls.

## F-5 — record.ts comment ERRATUM (`c4f5978`)

Appended to the end of `correctionRowFrom`'s comment block, existing lines untouched:
`*** ERRATUM (2026-09-16, run orca-dev-5d5c8055, final review of E3) ***` — "written out twice in the function below"
refers to correct.ts before the seam existed; the function below no longer contains it. Comment-only; no criterion,
no mutation.

---

## Final checks

**Full verify** — `rtk proxy npm run verify > verify2.txt 2>&1; echo VERIFY_RC=$?`, at HEAD `435f0f1`
(`/usr/bin/time -p` around it): **VERIFY_RC=0**, real **42.40 s**.
| tier | BASE baseline (notes) | HEAD |
|---|---|---|
| typecheck | pass | pass |
| npm test | 95 files / 550 tests | **95 / 561** (+11: reviewsStore 1, todo 1, correctApi 4, metricsApi 3, security 1, webParity 1) |
| ledger validate | pass | pass (7 `downgraded to tier 0` lines on `orca-dev-09cc3ea1.jsonl`, exit tolerated by the chain as before) |
| CLAUDE.md lines / hooksPath | ok | `143/200`, `core.hooksPath is scripts/githooks` |
| verify:scheduler | 51 / 167 | 51 / 167 |
| web build | pass | pass (36 modules, `index.js` 231.12 kB) |
| verify:panel | 13 PASS | **13 PASS** (0..12; step 9 line extended) |
| web check | 5 files / 10 tests | **6 / 18** (+outcome.test.tsx 7, +decisionDetail 1) |

An earlier identical-content run at `c4f5978`'s tree before committing (`verify1.txt`, read whole) gave the same
numbers, VERIFY_RC=0, real 42.73 s. ⚠️ Rule 14 disclosure: `verify2.txt` (1392 lines) was read at lines 1-120,
700-760 and 1320-1392 (every tier summary, the ledger block, verify:panel and web check); lines 121-699 and 761-1319
(the middle of the two vitest listings, whose summaries report 0 failures) were not re-read. `verify1.txt` was read
whole.

**Standalone verify:panel** (`rtk proxy npm run verify:panel`, at tree `c4f5978`; `435f0f1` changes only a test file)
— `vp_alone.txt` read whole: PASS 0..12, VP_RC=0, real 7.44 s. Census before/after:
- processes matching `tsx|src/cli.ts|verify-panel|vitest`: 0 before, 0 after (and 0 again after the final verify).
- `lsof -nP -iTCP -sTCP:LISTEN`: 30 lines before, 30 after, `diff` RC 0.
- `$TMPDIR` (`/var/folders/nb/068k_scs4gzgclcp66f9hys40000gn/T`) `orca-*` entries: 12056 before, 12056 after, 0 new,
  0 gone. (The 12056 are pre-existing and unchanged by this run; the first ones listed are `orca-batch-*`; their
  origin was not investigated.)
- `~/.orca`: absent before and after (`ls` RC 1 both times; again RC 1 at the end).

**Repository state.** Before this report was written, `git status --porcelain` listed only ` M .superpowers/sdd/2026-09-10-panel-e3/progress.md` and
`?? .decisions/orca-dev-5d5c8055.jsonl` (neither staged). This report does not appear in porcelain: it is ignored
by `.superpowers/sdd/.gitignore:1` (`*`), so it is left uncommitted. `git diff 952739d HEAD --stat`: 22 files, 859 insertions,
56 deletions, no `Bin` line. Committed blobs of all 22 files plus all six commit messages byte-scanned (bytes < 0x20
other than tab/LF/CR): **0** (`bytescan_committed.txt`, plus the re-scan of `metricsApi.test.ts` and the last message
after `435f0f1`). Every touched working file was scanned after its edits: 0. No NUL-class or U+001F escape was typed;
the existing `UNIT_SEPARATOR` line was left as it was.

## Concerns

1. **F-2 deviation**: `req.body ?? {}` was not used because it makes the notes' own no-content-type -> 400 criterion
   unreachable (it yields 404). Decided under Rule 1 as reversible; the controller may want to confirm.
2. **F-4 deviation**: the bind address is accepted for loopback binds too (matters only for 127.0.0.x != .1).
3. **F-3 red evidence** for `outcome.test.tsx` is a module-load failure only; its assertion-level reds (UI-1..UI-4)
   are unmeasured predictions.
4. **HG-1's verify:panel half was effectively observed** while measuring step 9's red (the only non-load red
   available for that step).
5. Criteria added beyond the notes' lists: the api.ts stubbed-fetch GET/POST criteria, the DecisionDetail form
   criterion, compile-time `CorrectionKind` parity, the security.test.ts predicate criterion, and the `[::1]` Host
   positive control.
6. Not addressed (outside this wave): review Minors M-1..M-7, M-9, M-11 (M-8 and M-10 are covered by F-2 and F-5).
   The class comment in `reviewsStore.ts` still says "two rows per distinct decisionId"; the ERRATUM above `key`
   corrects it rather than editing it in place.
