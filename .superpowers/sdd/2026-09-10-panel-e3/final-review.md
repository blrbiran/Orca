# Final whole-branch review — E3 web panel (`orca panel`)

Base `a801200`, Head `952739d`. Diff read from
`.superpowers/sdd/2026-09-10-panel-e3/final-review-code.diff` (6021 lines, whole file, four passes by
offset). Authorities: spec `docs/superpowers/specs/2026-09-09-panel-design.md` (whole), plan Global
Constraints (`docs/superpowers/plans/2026-09-10-panel-e3.md:33-59`), ledger rulings consulted by name
(R1, R13, R25, R28, R47-R63) before any deviation was called a defect. Template:
superpowers `requesting-code-review/code-reviewer.md`. Reviewer: fable, single seat, no subagents.

Read-only on the checkout. One focused probe was run to settle three doubts by measurement rather than
by reading: `scratchpad/probe.mts` (ReviewsWriter in a scratchpad `mkdtemp` dir; one in-process
`createPanelServer` on `127.0.0.1:0` with `ORCA_CORRECTIONS_DIR` redirected into the same scratchpad
dir; removed in `finally`, `$TMPDIR` residue count 0 afterwards). Its whole output is quoted under I-1,
I-2 and I-4 below. `npm run verify` / `verify:panel` / mutations were NOT run here (the ledger holds those
numbers: verify RC 0, 95 files / 550 tests, `verify:panel` 13 PASS, at `952739d`).

Per-task reviews and mutation runs already covered each task's own contract; this review is the
cross-task view: the whole served surface, one-clock, the (projectKey, id) joint key, route order and
error mapping, web parity, `scripts/verify-panel.ts` as a thing every future `npm run verify` executes,
and test hygiene across `tests/panel`. Every deferred ledger line is triaged in §Deferred.

---

## Strengths

- **Static serving is constructive, not defensive.** `src/panel/staticFiles.ts:54-105` reads `web/dist`
  once into a Map keyed by exact filename, skips anything that is not `isFile()` (symlinks out), refuses
  a missing dist and a missing token anchor by name, and `src/panel/api.ts:99-110` answers only exact
  keys with `req.path` never joined to anything. `tests/panel/metricsApi.test.ts` drives the traversal
  spellings through raw `node:http` so the client's URL parser cannot collapse them first, with a
  positive control in the same criterion. Spec §2.2 held exactly as written, express notwithstanding.
- **Authorisation and identity are really separate.** 32 CSPRNG bytes, constant-time compare with the
  length check outside `timingSafeEqual` (`src/panel/token.ts:22-25`); `--by` required with no default
  (`src/panel/server.ts:47-55`), pinned at CLI level by a real child process
  (`tests/panel/security.test.ts:193-215`); bind guard runs before `listen()` so the criterion can tell
  "guard refused" from "kernel refused" (`src/panel/bindGuard.ts:27-38`), and `0.0.0.0` appears nowhere.
- **The browser never selects a path.** Both POSTs and the detail route resolve `(projectKey, decisionId)`
  against THIS request's own discovery (`src/panel/api.ts:79-87`, `:177-180`, `:232`, `:328`); the repo
  path handed to `loadDecisionRow` is one `collect()` discovered, never one built from input. F2 from
  the preflight is closed.
- **All writes go through the two sanctioned writers.** Corrections: `correctionRowFrom` +
  `recordNewCorrection` (the seam, `src/panel/api.ts:249-262`), golden-id criterion proving panel and
  CLI derive the same id (`tests/panel/correctApi.test.ts:471-536`). Reviews: `ReviewsWriter.append`
  only. No repo lock, no `.decisions/` write, no `git` in any target repo — pinned by a positive
  snapshot (names + sha256 + HEAD) in `correctApi.test.ts` and `verify-panel.ts` step 6.
- **`opened` is off the read path; `reviewed` is on it, on purpose** (`src/panel/api.ts:191-211`,
  `:279-301`, `:333-338`), both pinned with the lock held. The check-then-act race in the dedupe set was
  found in review and closed with a mutation seen red (R25/R-11).
- **One clock.** `panelClock`/`nowIso` (`src/panel/api.ts:64-70`) feed `collect()`'s `now`, both review
  timestamps and the correction row; `correct(argv, { now })` threads the same shape through both CLI
  modes. Verified by reading every `at` in `src/panel` — none reads `new Date()` directly.
- **The list projection is frozen, and its criterion is not a tautology** (`LIST_FIELDS` with
  `satisfies`, expected rows built from the constant, `toStrictEqual`; R57).
- **`scripts/verify-panel.ts` handles processes carefully**: detached process group, one exit promise
  captured at spawn (the "second listener never fires" bug was found and explained in-file), bounded
  teardown, guarded recursive removal, teardown failures forcing a non-zero exit (R61), `~/.orca` compared
  before/after rather than required absent (R56). Every `rm` target is a `mkdtemp` this script minted.
- **Rule 17 discipline is uniform**: every criterion passes an explicit `{ ORCA_CORRECTIONS_DIR }` env or
  a throwaway store; `security.test.ts` redirects even for the `--by` criterion that never reaches the
  store; `verify-panel.ts` reads `~/.orca` only to prove it did not change.
- **Web parity is enforced twice** (`tests/panel/webParity.test.ts`: runtime set equality plus
  compile-time mutual assignability in the root `tsc` program), and the lying fixture in
  `web/tests/metricsView.test.tsx` is the right shape for "the frontend computes nothing".

---

## Issues

### Critical (Must Fix)

None. Nothing reachable without the token except the token-carrying HTML (by design), no path
construction from input, no write outside the two writers, no closing of the loop.

### Important (Should Fix)

#### I-1. The reviews dedupe key omits `projectKey`, so a second repository's `reviewed` on a same-id decision is silently dropped — the one place the (projectKey, id) joint key is not used

- File: `src/panel/reviewsStore.ts:20-22` — `key = [decisionId, by, action]`.
- Measured (probe, DOUBT1): `reviewed proj-a: written | reviewed proj-b (same id): duplicate | rows on
  disk: 1`.
- Why it matters: everything downstream joins on `(projectKey, id)` — `computePanelCoverage` and
  `unreviewedHighTier` (`src/panel/coverage.ts:18`), detail membership (`api.ts:79-87`), the corrections
  store's own key `(projectKey, decisionId, by)`, and the criterion "returns each repository's own row
  when two repositories share a decision id" (`decisionsApi.test.ts:309`). With two repos that share an
  id (clones and forks — the case the codebase names four times), the panel's `by` is constant per
  process, so: agreeing on repo B's decision answers 200 `{ result: "duplicate" }` and writes nothing;
  B's row never leaves `/api/todo`, never enters the coverage numerator; on `POST /api/corrections` the
  correction lands (its key has projectKey) but the `reviewed` mark for it is dropped — exactly the
  "person believes they reviewed something the ledger never heard about" §4.3.1 forbids, without even a
  non-2xx. The `opened` row for repo B is dropped the same way.
- Root cause is in the spec: §4.3.2 literally says the key is `(decisionId, by, action)`, and the code
  followed it. §4.2's coverage definition and E2's measured lesson say the identity is `(projectKey, id)`.
  Rule 7: the evidence is one-sided (compute.ts, coverage.ts, store.ts and a criterion all use the joint
  key; only the §4.3.2 sentence does not), so this is decided here, not escalated.
- Fix: add `row.projectKey` to `key()`; one criterion in `tests/panel/reviewsStore.test.ts` (same
  decisionId/by/action under two projectKeys → two rows, and `readReviews` length 2); an appended
  ERRATUM on spec §4.3.2 (never an in-place edit) naming the join. The existing sequential and concurrent
  dedupe criteria stay green. The spec's 2 × distinct-decision bound becomes 2 × distinct
  (projectKey, id), still independent of run time.

#### I-2. Two refusals are answered as 500 by accident: a POST without a JSON content-type, and a malformed JSON body

- Files: `src/panel/api.ts:223`, `:323` (`req.body as Record<...>` on an `undefined` body);
  `src/panel/server.ts:101` (`express.json`) + `src/panel/api.ts:350-356` (the four-argument handler
  maps only `MetricsRejection` / `PanelRejection` to 409 and everything else to 500).
- Measured (probe, DOUBT2a/2b): `POST /api/reviews` with no content-type →
  `500 {"code":"panel-internal-error","message":"TypeError: Cannot read properties of undefined (reading
  'projectKey')"}`; with `content-type: application/json` and body `{not json` →
  `500 {"code":"panel-internal-error","message":"SyntaxError: Expected property name ..."}`.
- Why it matters: Express 5 leaves `req.body` `undefined` when no parser ran, and body-parser errors
  carry `status: 400` / `type: "entity.parse.failed"` which this handler ignores. Both are client
  mistakes, not panel faults, and both currently print an internal error message. The shipped web client
  always sends JSON, so this is not reachable from the page today; it is reachable from anything else
  that holds the token, and it is the shape the task's risk (4) asked about.
- Fix (small, one file each): `const body = (req.body ?? {}) as Record<string, unknown>` in both POST
  handlers; in the error handler, before the 500 fallback, map an error carrying a numeric `status` in
  400-499 to that status with a named code (e.g. `"malformed-request"`), and while there use
  `err instanceof Error ? err.message : String(err)` for the fallback message (deferred line 16). One
  criterion per branch in `correctApi.test.ts` (raw `node:http` POST, no content-type → 400; bad JSON →
  400), each seen red first.

#### I-3. The web client discards every POST outcome: `Agree` never shows success or failure, `Correct` as shipped can never succeed, and the error page drops the server's named refusal

- Files: `web/src/App.tsx:66-76` (`void recordReview(...)`, `void recordCorrection({ ..., because: "" })`);
  `web/src/api.ts:25`, `:36` (throws `answered ${res.status}` after parsing a body it then discards).
- Why it matters:
  - Spec §4.3.1: a failed `reviewed` write "must reach the person". The server does its half (409,
    R50), but the page `void`s the promise: a 409 becomes an unhandled rejection in the console and the
    UI changes nothing. The spec's requirement is met at the HTTP layer only, and the person is the one
    §4.3.1 names.
  - `Correct` posts `because: ""`; `correctionSchema` has `because: z.string().min(1)`
    (`src/corrections/schema.ts:54`), so the seam refuses it by name every time (400
    `correction-row-invalid`) and the page shows nothing. The button cannot record a correction. The
    Task 8 brief scoped the buttons as thin handlers with no frontend criterion (K7), which explains
    the shape, but a control that always fails silently is worse than no control.
  - After a successful `Agree`, the todo list and coverage are not refetched, so the row a person just
    reviewed stays on the "unreviewed" list until reload — the mitigation §4.2 is built on.
  - On any non-2xx, `getJson`/`postJson` throw `answered 409` and drop `body.code` / `body.message`.
    For the E2 gate this matters most: §5 asks for "a first-class error page"; "GET /api/metrics
    answered 409" without `unresolved-project-keys` and the keys it names is a page that says something
    went wrong and nothing about what.
  - Risk (5) checked: after a 409 the page renders ONLY the error branch (`App.tsx:57-58`), never stale
    or partial data. That part is correct.
- Fix (minimal, no new dependency): include `body.code` and `body.message` in the thrown Error;
  `onAgree`/`onCorrect` `await` and `setError` on rejection, refetch todo + metrics on success; `Correct`
  either collects `because` (a one-line `window.prompt` is enough for this cut) or is not rendered until
  a form exists. A `renderToStaticMarkup` criterion cannot pin click behaviour (plan ruling 2), so pin
  the API layer instead: `web/tests` can call `getJson` against a stubbed `fetch` and assert the thrown
  message contains the server's `code`.

#### I-4. No `Host` check: a DNS-rebinding page can read the token-carrying HTML and then use the whole API — a gap in the spec's §3.3 list, not only in the code

- File: `src/panel/api.ts:99-110` serves `index.html` (token injected, `staticFiles.ts:91-97`) to any
  request with any `Host`.
- Measured (probe, DOUBT3): `GET /` with `Host: evil.example:80` → `200`, token present in body.
- Why it matters: loopback binding stops other machines; it does not stop a web page in the same
  person's browser. Cross-origin, the token is safe (no CORS headers, so a foreign origin cannot read the
  HTML and the custom header forces a blocked preflight). DNS rebinding removes the "foreign origin":
  the page's own hostname resolves to 127.0.0.1 on the second lookup, the fetch is same-origin, the HTML
  comes back with the token, and every endpoint is open to that page — read every configured
  repository's decision reasoning, and write `~/.orca/corrections.jsonl` / `reviews.jsonl` under the
  person's `--by`. A fixed `--port` makes it trivial; `--port 0` makes it a scan. This is the class Vite
  and webpack-dev-server patched under advisories, and it is not among §3.3's registered unresolved
  items (no TLS / token in HTML / no revocation / no multi-user).
- Fix (about ten lines): in the `/api` middleware and the static route, when `opts.bind` is loopback,
  refuse any request whose `Host` header is not `127.0.0.1:<port>`, `localhost:<port>` or
  `[::1]:<port>` (403, named); pin with a raw `node:http` request carrying a foreign `Host` (positive
  control: the same request with the real `Host` answers 200). If the human prefers to register rather
  than fix, it must be appended to spec §3.3/§9 by ERRATUM and to the `--bind` help sentence — but the
  fix is cheaper than the sentence.

### Minor (Nice to Have)

- **M-1. `verify-panel.ts` step 11's per-pid `lsof` is vacuous by construction, and `lsof` is now a hard
  dependency of `npm run verify`.** `scripts/verify-panel.ts:779-783` runs `lsof -p <pid>` after
  `runToExit` has already awaited the pid's exit, so the listing is empty whatever the guard did (the
  same shape R28 refused for `security.test.ts`). The guard IS pinned — by the non-zero exit, the
  refusal code in stderr, and the deadline that turns "server started" into a named failure — so this
  is a decorative line, not an empty criterion. But it makes `lsof` load-bearing for every future
  agent's `verify` (`security.test.ts:242` too, where the system-wide listing is not vacuous). Minimal
  Debian/Alpine images do not ship `lsof`. Either drop the vacuous call or register the dependency in the
  script header and the plan's Global Constraints.
- **M-2. `orca panel` has no `--as-of`.** `currentMetrics` always runs `collect()` in wall-clock mode
  (`src/panel/api.ts:46-53`), so one row dated ahead of this machine's clock (a correction recorded by
  `orca correct` on a machine a minute fast) makes every request answer 409
  `future-rows-without-as-of` with no escape hatch but editing the store. Correct per E2; worth a
  registered line in §9, and eventually a `--as-of` on the panel that the metrics CLI already has.
- **M-3. Argument parsing.** `--dist` is undocumented in USAGE (`src/cli.ts`) though `server.ts:87`
  honours it; `flag()` (`server.ts:42-45`) takes the next token blindly, so `--by --port 0` yields
  `by = "--port"` and a port of 0. Local operator input only; still worth a `startsWith("--")` check.
- **M-4. Response hardening headers.** `Cache-Control: no-store` on the token-carrying `index.html`
  (the token is per-process, so a cached copy outlives it harmlessly but pointlessly),
  `X-Content-Type-Options: nosniff` (content types are explicit, but the octet-stream fallback is the one
  place a browser might sniff), and `app.disable("x-powered-by")` (express's default 404 for a POST to
  an unknown path still advertises it). Three lines in `server.ts`.
- **M-5. Three encodings of "the same (projectKey, id) pair".** `coverage.ts:18` joins with `\x00`,
  `reviewsStore.ts:20` with `\x1f`, `web/src/DecisionList.tsx` with `JSON.stringify`. Each is correct in
  isolation; after I-1 the server side has two keys for one identity. One `pairKey` in `coverage.ts`
  (JSON form, per R60's reasoning about control bytes) would remove the drift risk the plan itself
  documented three times.
- **M-6. In-flight `opened` writes outlive `close()`.** `api.ts:200-211` is fire-and-forget, and
  `StartedPanel.close()` (`server.ts:121-124`) closes the listener without draining them. Two criteria
  open a detail and tear down without waiting (`decisionsApi.test.ts:252`, `:309`); if the append lands
  after `withCorrectionsDir` removes the dir, `mkdir({ recursive })` recreates it and leaves an
  `orca-corrections-*` directory in `$TMPDIR`. The ledger measured landings up to ~500 ms under load,
  and every verifier census reported zero residue, so the window is narrow — but it is a real window.
  Track in-flight appends in `ReviewsWriter` and have `close()` await them; `verify-panel.ts` is not
  affected (it polls to the row before moving on).
- **M-7. Test helper duplication.** `makeDistFixture`, `get`, `post` are copied into four files
  (`correctApi.test.ts:40-56`, `decisionsApi.test.ts:24-40`, `metricsApi.test.ts:22-73`,
  `todo.test.ts:27-41`), `GOLDEN_ID`/`GOLDEN_INSTANT` twice. Sanctioned per task (H7, J2, J7) to keep
  each task's diff isolated; now that the branch is whole, a `tests/panel/harness.ts` is the obvious next
  cut. No behaviour risk today (all copies are byte-identical in effect).
- **M-8. `CorrectRejection` codes other than already-recorded answer 400** (`api.ts:276-279`),
  including `corrections-store-busy` — a transient conflict, not a client error. The code is named, so
  a client can tell; 409 would be the honest status.
- **M-9. The throwaway git fixture inherits the person's global git config.** `verify-panel.ts:194`
  sets identity but not `commit.gpgsign=false` or `core.hooksPath`; a global `commit.gpgsign=true` or a
  global hooks path makes `npm run verify` fail or hang for a reason unrelated to the panel.
  `tests/corrections/harness.ts:12` has the same shape (pre-existing), so fix both or neither.
- **M-10. Dangling comment in `src/corrections/record.ts:13-14`** — "written out twice in the function
  below" describes `correct.ts` before the move; there is no such function in `record.ts`. Deferred
  line 1; one-line edit.
- **M-11. `isLoopback` trusts the name `localhost`** (`bindGuard.ts:14`) and `url` is printed as
  `http://localhost:<port>` in that case (`server.ts:118`), which `parseReadyLine` rejects. Only bites
  if someone runs `verify:panel` with `--bind localhost`; today nothing does.

---

## Named cross-cutting risks — what was checked

1. **Served surface.** Routes without token: only `GET`/`HEAD` of static keys (`api.ts:99-110`), by
   design the token carrier. Paths from input: none (see Strengths). Writes: `ReviewsWriter.append` ×3
   and `recordNewCorrection` ×1; no other `writeFile`/`appendFile`/`git` in `src/panel`. Gap: I-4.
2. **One clock.** `nowIso`/`panelClock` are the only clock reads in `src/panel` (`api.ts:64-70`); the
   correction row takes `panelClock(deps.opts)`; `collect()` takes `nowIso`. Held.
3. **Joint key.** Coverage, todo, detail, corrections store: joint. Reviews dedupe: not (I-1).
4. **Route order / error mapping.** `express.json` → static catch-all (GET only, `/api/` passes
   through) → token middleware on `/api` → routes → four-argument handler last. Mapping:
   `MetricsRejection`, `PanelRejection` → 409; `CorrectRejection` → 409 (already-recorded, own message)
   or 400, inside the corrections handler only; body-parser errors and `undefined` body → 500 (I-2).
5. **Web parity / 409 rendering.** Parity enforced both ways; after a 409 the page shows only the error
   branch — no stale or partial data — but the branch drops the server's code and message (I-3).
6. **`verify-panel.ts` safety.** Real data: `~/.orca` read-only, snapshot-compared; `ORCA_CORRECTIONS_DIR`
   always a script-minted `mkdtemp`. Network: `127.0.0.1:0`, and `192.0.2.1` only behind a guard whose
   deletion yields `EADDRNOTAVAIL` (measured E-9). Processes: group-killed on every path, exit confirmed
   with a 5 s bound, teardown failures force RC 1 (R61, TD-1 seen red). Residue: guarded `rm` of two
   `mkdtemp` roots; `web/dist` is gitignored (`dist/`). Remaining notes: M-1 (`lsof`), M-9 (git config).
7. **Test hygiene.** Every `it` owns its store, server and repo(s); `reviewsStore.test.ts` pins and
   restores the umask; no shared mutable state between files. Date dependence: all fixed clocks
   (`2026-09-10`) and fixture dates (`2026-09-01`, `2026-09-05`) are in the past and stay so, so the
   wall-clock criteria are stable going forward. The date-dependent red COUNT the ledger recorded
   (Task 7, mutation K-7) is a property of that mutation's report, not of any criterion: under K-7 the
   panel stamps a wall-clock `at` later than the criterion's fixed clock and E2's future-rows gate fires
   on every later request in that `it`. Nothing to fix; worth one sentence in the mutation brief
   template so the next verifier does not chase it. Only hygiene gap found: M-6.

---

## Deferred findings — triage (all 31 lines of `final-review-deferred.txt`)

| # | Ledger line | Verdict | Where / why |
|---|---|---|---|
| 1 | P: record.ts comment "written out twice in the function below" | **fix-before-merge** | `src/corrections/record.ts:13-14`; one line, misleading to the next reader (M-10). Fold into the fix wave. |
| 2 | P: injectableClock has its own recordArgs helpers | fine-to-leave | Mirrors `main`'s stripped argv on purpose; the comment says why. |
| 3 | 1: lockfile-absence criterion green before Task 1 | fine-to-leave | `tests/panel/workspace.test.ts:26-32` can go red (create `web/package-lock.json`); it pins a structural rule, not a change. |
| 4 | 1: web `check` asserted only as a string | fine-to-leave | `npm run --ws check` in `verify` is what runs it; the string check is a wiring guard. |
| 5 | 1 parked W-6: `--by` guard unpinned | **already-fixed** | `tests/panel/security.test.ts:193-215` drives the real process; ledger records the mutation seen red (Task 3). |
| 6 | 2: 1356-line log not read whole | fine-to-leave | Process note, registered as required. |
| 7 | 3: malformed-port / malformed-repo-argument no criterion | **already-fixed** | `tests/panel/security.test.ts:257-292` (F6), each with a negative control. |
| 8 | 3: throwawayStore as describe-level before/afterEach | fine-to-leave | `security.test.ts:180-189`; per-run mkdtemp, isolation preserved. |
| 9 | 3: real-process criterion leaves a tsx child alive | **already-fixed** | `security.test.ts:41-96` (`runPanelProcess`: detached group, deadline, SIGKILL to `-pid`) + `:188` afterEach backstop; ledger: witnessed. |
| 10 | 3 Registered: P-10/P-10b leave a child alive | **already-fixed** | Same as 9. |
| 11 | 3: log indexed with python | fine-to-leave | Process note. |
| 12 | 4: F6 loops short-circuit on the first bad value | fine-to-leave | Each loop pins the guard plus a negative control; per-value criteria would triple the count for one `if`. |
| 13 | 4: `loadStaticFiles` reads only the top level | **already-fixed** | `scripts/verify-panel.ts:533-537` pre-check; E-10b seen red at that line (ledger, Task 9 fix round 1). |
| 14 | 4 Registered: merged pid quote in a report | fine-to-leave | Cosmetic, in an evidence file. |
| 15 | 5: `now` fallback expression hard to read | **already-fixed** | `src/panel/api.ts:64-70` (`panelClock` / `nowIso`, Task 7 refactor). |
| 16 | 5: 500 fallback's `String(err)` | **fix-before-merge** | `src/panel/api.ts:355`; fold into I-2's error-handler change. |
| 17 | 5: "final whole-branch review" instruction line | fine-to-leave | This document is that line's discharge. |
| 18 | 5 Registered: verify log indexed, not read whole | fine-to-leave | Process note. |
| 19 | 6: `get`/`makeDistFixture` duplicated | fine-to-leave | Sanctioned (H7); M-7 recommends a harness in the next cut. |
| 20 | 6: `loadDecisionRow` returns `unknown` | fine-to-leave | The row is served raw on purpose; a narrower type would be a second schema. |
| 21 | 7 Registered: `git stash` in the main tree | fine-to-leave | Process; controller re-measured no loss; later briefs say "clone, never stash". |
| 22 | 7: two wall-clock corrections rely on distinct `at` | fine-to-leave | Two full HTTP round trips each taking the store lock inside one millisecond is not a realistic collision, and a collision fails loudly (`toHaveLength(2)`), never silently. An advancing injected clock would make it exact if the file is touched. |
| 23 | 7: GOLDEN_ID sanity pins `at` only | fine-to-leave | The id equality is the HTTP assertion two lines later; the sanity line only guards the literal duplicate. |
| 24 | 8: `body.decision as Decision` unvalidated | fine-to-leave | Same-process server, raw ledger row; a schema here would be a third copy. |
| 25 | 8: presentational components not red-then-green | fine-to-leave | Mutation verifier measured F-4/F-4b/F-4c/P-8/T-1..T-4/H-1 red. |
| 26 | 9: step 11 forced-kill path rejects without awaiting exit | fine-to-leave | SIGKILL to the whole group; the rejection already fails the run. A 5 s bounded wait (as the panel child has) is the polish if touched. |
| 27 | 9: 774 lines in one file | fine-to-leave | Sections are labelled; splitting buys nothing until a second script shares them. |
| 28 | 9: unnumbered step 0 | fine-to-leave | Self-documented; it prints its own PASS line. |
| 29 | 9 Ruling R63 / E-10 green | **already-fixed** | E-10b measured red at `scripts/verify-panel.ts:536` (ledger, Task 9 fix round 1 mutations). |
| 30 | 9: `guardedRmRecursive` uses `includes` | fine-to-leave | Both call sites pass a `mkdtemp` root; tighten to `startsWith(join(tmpdir(), prefix))` if a third caller appears. |
| 31 | Final review dispatch line | fine-to-leave | This document. |

Counts: **fix-before-merge 2** (lines 1, 16), **already-fixed 7** (lines 5, 7, 9, 10, 13, 15, 29),
**fine-to-leave 22**.

---

## Recommendations

- Fix wave (one round, all small): I-1 (key + criterion + spec ERRATUM), I-2 (body fallback + status
  mapping + two criteria), I-3 (surface POST outcomes, carry `code`/`message`, make `Correct` collect
  `because` or hide it), I-4 (loopback `Host` allowlist + criterion), plus deferred lines 1 and 16. Every
  new branch gets its named mutation seen red, per Rule 9 — I-1's is "remove `projectKey` from `key`",
  I-4's is "delete the Host check".
- Register M-1 (`lsof`) and M-2 (no `--as-of`) in the plan/spec by appended lines; decide M-6 (drain
  in-flight `opened` on `close()`) now while the code is fresh — it is ten lines and removes the only
  residue path left in the suite.
- Next cut: `tests/panel/harness.ts` (M-7), one `pairKey` (M-5), and a real correction form; the
  panel's UI is a scaffold today and the ledger says so honestly.

## Assessment

**Ready to merge? With fixes.**

**Reasoning:** The security boundary the spec cares most about — no path from browser input to the
filesystem, no closing of the loop, exact-key statics, token-gated API, one clock, one construction
point — holds and is mutation-backed. The four Important findings are each a contained change: one is a
real correctness bug in multi-repo use that the spec's own §4.3.2 sentence caused (I-1), one is error
mapping (I-2), one is the web client not finishing the job the server does (I-3), and one is a
threat-model gap the spec did not register (I-4). None requires a redesign; all four should land before
this branch is merged into `main`.
