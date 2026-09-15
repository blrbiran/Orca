# E3 final fix wave — independent mutation verification report

Repo `/Users/biran/code/skills/loop/Orca`. Commit under test: `435f0f1d3a640127edb6fc5d67978cd254464bc0`.
Independent verifier, no coordination with any parallel re-reviewer. No subagents.

Method: exactly the "Hard rules" section of `task-6-mutations-brief.md`, applied per mutation — one shell
invocation each: `git clone --local` into a fresh `mktemp -d`, `git checkout --quiet 435f0f1`, both `node_modules`
symlinked, `git`/`cmp`/`rm` always via full paths, `/usr/bin/git` for status/rev-parse, edits by a Python script with
an exactly-once anchor assertion (non-zero exit on 0 or ≥2 matches), `shasum -a 256` before/after, `diff` printed,
byte-scan (bytes < 0x20 excluding tab/LF/CR) after every edit, whole-file reads of every run's output (never piped),
`cmp` of every file under `tests/panel/` (clone vs main tree) before teardown, `/bin/rm -rf` of the clone's parent.
Runners: root `./node_modules/.bin/vitest run tests/panel`; web `cd "${C}/web" && ../node_modules/.bin/vitest run`;
HG-1 additionally `npm run build --workspace web && npm run verify:panel` with process/lsof/`$TMPDIR` census.

## Baseline (unmutated clone at 435f0f1)

Root: `Test Files 12 passed (12)`, `Tests 90 passed (90)`, RC=0.
Web: `Test Files 6 passed (6)`, `Tests 18 passed (18)`, RC=0.
`tests/panel/` file list and every file byte-identical to the main tree (`cmp`, all OK). All-green baseline confirmed
— proceeded to mutations.

---

## RK-1 — reviews dedupe `key()` drops `projectKey`

File: `src/panel/reviewsStore.ts`. Anchor (exactly once):
`[row.projectKey, row.decisionId, row.by, row.action].join(UNIT_SEPARATOR)` → replaced with
`[row.decisionId, row.by, row.action].join(UNIT_SEPARATOR)`.

- sha256 before `820961954952adb85457d1e33851029daeb23935711db53fa7f6d078be0c7e62`, after
  `352cf092589c4213c4e3d24337adfa22e0fa0442365edc79e5b30020ba691f50` — differ.
- diff: single line, `row.projectKey, ` removed from the `.join` array.
- Byte-scan: 0 bad bytes.
- Run (root): RC=1. `Test Files 2 failed | 10 passed (12)`, `Tests 2 failed | 88 passed (90)`.
  - FAIL `tests/panel/reviewsStore.test.ts > the reviews store (spec section 4.3) > keys dedupe by projectKey too:
    the same decision id in two repositories writes two rows` — `expected 'duplicate' to be 'written'`
    (reviewsStore.test.ts:114).
  - FAIL `tests/panel/todo.test.ts > GET /api/todo (task 8 ruling K5, HTTP) > (f) agreeing on two repositories'
    decisions that share an id takes BOTH off the to-do list` — `expected 'duplicate' to be 'written'`
    (todo.test.ts:194).
  - Everything else green, including `webParity`, `decisionsApi`'s two-repo detail criterion, `security.test.ts`.
- `tests/panel/` cmp: identical to main tree.
- **matched** the implementer's prediction exactly (both criteria, same failure shape, nothing else red).

## EB-1 — remove the body-parser error mapping

File: `src/panel/api.ts`. Anchor (exactly once): the `if (isBodyParserError(err)) { ... }` block in the error
handler — deleted entirely (parse failures now fall through to the 500 arm).

- sha256 differs (before/after captured; diff shows the 4-line block removed).
- Byte-scan: 0 bad bytes.
- Run (root): RC=1. `Test Files 1 failed | 11 passed (12)`, `Tests 1 failed | 89 passed (90)`.
  - FAIL `tests/panel/correctApi.test.ts > the panel's error mapping for client mistakes (final review I-2) >
    refuses a malformed JSON body as a bad request (the body parser's own error)` — `expected 500 to be 400`
    (correctApi.test.ts:602, via :619/:587).
  - Green: no-content-type, array, store-busy criteria; everything else.
- `tests/panel/` cmp: identical to main tree.
- **matched** the implementer's prediction exactly.

## EB-2 — remove the non-object body refusal

File: `src/panel/api.ts`. Anchor (exactly once):
`if (typeof body === "object" && body !== null && !Array.isArray(body)) {` → replaced with `if (true) {` (the
refusal branch becomes dead code; `objectBody` now always returns `body as Record<string, unknown>` verbatim,
whatever `body` actually is).

- sha256 differs. Byte-scan: 0 bad bytes.
- Run (root): RC=1. `Test Files 1 failed | 11 passed (12)`, `Tests 2 failed | 88 passed (90)`.
  - FAIL `tests/panel/correctApi.test.ts > ... > refuses a POST with no content-type as a bad request (Express
    leaves the body undefined)` — **not** 500 or 404 as predicted: **`Test timed out in 5000ms`**, no assertion
    ever ran.
  - FAIL `tests/panel/correctApi.test.ts > ... > refuses a JSON body that is not an object (an array) as a bad
    request, before reading any field` — `expected 404 to be 400` (correctApi.test.ts:602, via :629/:587) — this
    part matches the implementer's stated alternative ("404 if replaced by `req.body ?? {}`"), though for a
    different mechanism (see below).
  - Green: malformed-JSON (EB-1's arm), store-busy.
- `tests/panel/` cmp: identical to main tree.
- **differs from the implementer's prediction, investigated (questions 2 and 3):**
  For the no-content-type case, `req.body` is runtime `undefined`. With the mutation, `objectBody` hits
  `if (true)` and does `return body as Record<string, unknown>` — a type assertion, not a conversion — so it
  literally returns the value `undefined`, merely re-labelled by the compiler as `Record<string, unknown>`. The
  **caller** (`api.ts`: `const body = objectBody(req, res); if (body === undefined) return;`) was never touched by
  this mutation and still treats `body === undefined` as "objectBody already replied, stop here" — that sentinel
  predates the refusal and used to be true only when `objectBody` had already called `res.status(400).json(...)`.
  After the mutation the sentinel fires on the real absent-body case too, but `objectBody` no longer sends any
  response before returning it — so the handler returns silently, no header is ever written, and the raw-HTTP
  client hangs until vitest's own 5000ms test timeout fires. Question 2 (who else walks the changed line) is the
  answer: the caller's pre-existing `undefined` check, not anything in the mutated function itself, is what turns
  "no refusal" into "no response at all" rather than into the 500/404 the implementer expected. For the array case,
  `body` is a real array (not `=== undefined`), so the check passes it through; `body.projectKey`/`body.decisionId`
  read as `undefined` on an array, coerce to `""`, and `isListedDecision` refuses decision `""` with 404 — the same
  final status the implementer named for a `?? {}`-style fix, arrived at by array-index-returns-undefined rather
  than nullish coalescing (question 3: the `404` comes from `DECISION_NOT_FOUND` in the not-found branch, not from
  a parse-failure arm).

## EB-3 — map the corrections store-busy `CorrectRejection` back to 400

File: `src/panel/api.ts`. Anchor (exactly once):
`const status = err.code === CORRECTIONS_STORE_BUSY ? 409 : 400;` → replaced with `const status = 400;`.

- sha256 differs. Byte-scan: 0 bad bytes.
- Run (root): RC=1. `Test Files 1 failed | 11 passed (12)`, `Tests 1 failed | 89 passed (90)`.
  - FAIL `tests/panel/correctApi.test.ts > ... > answers a busy corrections store with 409 by name, not 400 (a
    transient conflict, not a client error)` — `expected 400 to be 409` (correctApi.test.ts:641).
  - Green: "unknown kind" and "empty optional field" criteria (non-busy codes still 400); everything else.
- `tests/panel/` cmp: identical to main tree.
- **matched** the implementer's prediction exactly.

## UI-1 — `correctionBody` sends `chose_instead: ""` for a blank box

File: `web/src/api.ts`. Anchor (exactly once):
`...(form.chose_instead.trim() === "" ? {} : { chose_instead: form.chose_instead }),` → replaced with
`chose_instead: form.chose_instead,` (always sent, blank included).

- sha256 differs. Byte-scan: 0 bad bytes.
- Run (web): RC=1. `Test Files 1 failed | 5 passed (6)`, `Tests 1 failed | 17 passed (18)`.
  - FAIL `tests/outcome.test.tsx > correctionBody > omits a blank chose_instead box (the person said nothing), and
    keeps because as written` — `expect("chose_instead" in body).toBe(false)` received `true` for `""`
    (outcome.test.tsx:27).
  - Green: "keeps a filled chose_instead", the stubbed-POST criterion, everything else.
- **matched** the implementer's prediction exactly.

## UI-2 — the refusal view drops `message`

File: `web/src/Refusal.tsx`. Anchor (exactly once):
`      <p data-testid="refusal-message">{refusal.message}</p>\n` → deleted.

- sha256 differs. Byte-scan: 0 bad bytes.
- Run (web): RC=1. `Test Files 1 failed | 5 passed (6)`, `Tests 1 failed | 17 passed (18)`.
  - FAIL `tests/outcome.test.tsx > Refusal > renders the server's code and message` —
    `toContain(alreadyRecorded.message)` received markup without the message paragraph (outcome.test.tsx:55).
  - Green: record-another criterion, ErrorPage criterion, everything else.
- **matched** the implementer's prediction exactly.

## UI-3 — the "record another" control renders regardless of `retry_field`

File: `web/src/Refusal.tsx`. Anchor (exactly once): `refusal.retry_field === "again" && (` → replaced with
`true && (`.

- sha256 differs. Byte-scan: 0 bad bytes.
- Run (web): RC=1. `Test Files 1 failed | 5 passed (6)`, `Tests 1 failed | 17 passed (18)`.
  - FAIL `tests/outcome.test.tsx > Refusal > offers 'record another' only when the server names \`again\` as the
    retry field` — first `not.toContain("record-another")` (no `retry_field`) received the button present
    (outcome.test.tsx:61).
  - Green: code/message criterion, everything else.
- **matched** the implementer's prediction exactly.

## UI-4 — the error page shows only the status

File: `web/src/ErrorPage.tsx`. Anchor (exactly once): the two-paragraph block
`<p><code data-testid="error-code">{failure.code}</code></p>\n<p data-testid="error-message">{failure.message}</p>`
— deleted (page now renders only `error-status`).

- sha256 differs. Byte-scan: 0 bad bytes.
- Run (web): RC=1. `Test Files 1 failed | 5 passed (6)`, `Tests 1 failed | 17 passed (18)`.
  - FAIL `tests/outcome.test.tsx > ErrorPage > renders the E2 gate refusal's code and message, not only the
    status` — `toContain(gate.code)` received markup with only `error-status` (outcome.test.tsx:76).
  - Green: the stubbed-GET criterion (goes through `failureFrom`, not `ErrorPage`), App.test, everything else.
- **matched** the implementer's prediction exactly.

## HG-1 — delete the Host allowlist middleware

File: `src/panel/server.ts`. Anchor (exactly once): the 10-line
`app.use((req, res, next) => { if (isHostAllowed(...)) {...} res.status(403).json({...}); });` block — deleted
entirely. (`isHostAllowed`/`PANEL_HOST_NOT_ALLOWED` imports become unused; vitest/tsx do not typecheck, so this
does not block either run.)

- sha256 before `cc624add3d311f48bc47cd18d9324fee8995355bc0b02f63bf85ca62974b123e`, after
  `cee34a4d6c79435cfda0c17dff163c7d850eb3ae2f5aff2d7469a03fef0b8869` — differ. Byte-scan: 0 bad bytes.
- Root run: RC=1. `Test Files 1 failed | 11 passed (12)`, `Tests 2 failed | 88 passed (90)`.
  - FAIL `tests/panel/metricsApi.test.ts > the Host allowlist (final review I-4, DNS rebinding) > refuses a foreign
    Host on the token-carrying page with 403 by name, and the body carries no token` — `evil.example: expected 200
    to be 403` (metricsApi.test.ts:367).
  - FAIL `tests/panel/metricsApi.test.ts > ... > refuses a foreign Host on the API even with a valid token (the
    guard sits in front of /api too)` — `expected 200 to be 403` (metricsApi.test.ts:380).
  - Green: positive-control criterion, `security.test.ts`'s predicate criterion (10/10, the function itself is
    untouched), everything else.
  - `tests/panel/` cmp: identical to main tree.
- verify:panel (`npm run build --workspace web && npm run verify:panel`): build RC=0 (36 modules, `index.js`
  231.12 kB). Verify: `PASS 0`..`PASS 8`, then `FAIL 9 GET / with Host evil.example answers 403: 403 vs 200`,
  RC=1.
- Census: `ps -axo pid,ppid,pgid,command` before/after both the root vitest run and the build+verify:panel run —
  no line containing `src/cli.ts` or `tsx` present after that was absent before, for either run (`diff` empty).
  `lsof -nP -iTCP -sTCP:LISTEN` before/after the verify:panel step: `diff` RC=0, no new listener.
  `$TMPDIR` `orca-*` entry count: 12139 before, 12139 after (0 new, 0 gone).
  No "Unhandled Rejection"/"Unhandled error" block in any output file (grepped all captured outputs).
- `~/.orca`: absent before root run, absent before verify:panel, absent after verify:panel, absent after final
  clone teardown (`ls` RC=1 every time).
- **matched** the implementer's prediction exactly, for both the root criteria and verify:panel; the implementer's
  own note that "HG-1's verify:panel half was effectively observed" while measuring HG-2's red baseline is now a
  full, independent, on-mutation confirmation rather than an inference.

## HG-2 — the Host check accepts any hostname that ends with `localhost`

File: `src/panel/bindGuard.ts`. Anchor (exactly once):
`return LOOPBACK_HOSTNAMES.has(hostname) || hostname === bind.toLowerCase();` → replaced with
`return LOOPBACK_HOSTNAMES.has(hostname) || hostname === bind.toLowerCase() || hostname.endsWith("localhost");`.

- sha256 differs. Byte-scan: 0 bad bytes.
- Run (root): RC=1. `Test Files 1 failed | 11 passed (12)`, `Tests 1 failed | 89 passed (90)`.
  - FAIL `tests/panel/metricsApi.test.ts > the Host allowlist (final review I-4, DNS rebinding) > refuses a foreign
    Host on the token-carrying page with 403 by name, and the body carries no token` — `evil.localhost: expected
    200 to be 403` (metricsApi.test.ts:367) — the loop's third element (`evil.example`, `evil.example:<port>` still
    403 first; `evil.localhost` is the one that now passes, matching `hostname.endsWith("localhost")`; the
    assertion throws there and the loop's remaining `evil.localhost:<port>` element is never reached — an earlier
    assertion inside the SAME criterion short-circuits the rest of that criterion's own loop, not a masking of a
    different criterion).
  - Green: the `/api/metrics` refusal criterion and (not run for this mutation per the brief) verify:panel — both
    use `evil.example`, which does not end in `localhost`; `security.test.ts`'s predicate criterion (none of its
    refused hosts end in `localhost`); the positive controls.
  - `tests/panel/` cmp: identical to main tree.
- **matched** the implementer's prediction exactly (one failing element inside the one predicted criterion, nothing
  else red).

---

## Cross-cutting checks

- No "Unhandled Rejection" / "Unhandled error" block appeared in any of the 10 mutation runs' captured output, nor
  in the baseline.
- No process whose command contains `src/cli.ts` or `tsx` survived any run that did not exist before it (root runs
  and HG-1's build+verify:panel run all checked; vitest workers exit with the runner).
- No TCP listener present after any run that was not present before (`lsof -nP -iTCP -sTCP:LISTEN`, checked for
  baseline and HG-1's verify:panel step).
- `ls ~/.orca` was run before and after every mutation that touched the panel/server path and stood absent (`RC=1`)
  every single time, including immediately after HG-1's `verify:panel`.
- Every clone's `tests/panel/` tree was `cmp`-verified byte-identical to the main tree's before teardown — no
  mutation ever leaked into a criterion file.
- Every clone was removed with `/bin/rm -rf "$(dirname "${C}")"` after its run.
- Main tree: `git -C .../Orca status --porcelain -z` before and after the whole verification run is byte-identical
  (90 bytes both times — ` M .superpowers/sdd/2026-09-10-panel-e3/progress.md` + the pre-existing
  `?? .decisions/orca-dev-5d5c8055.jsonl`, both already present before this run started and neither touched by it).
  `git rev-parse HEAD` unchanged at `435f0f1d3a640127edb6fc5d67978cd254464bc0` throughout.
  `git diff HEAD -- src/ tests/ web/ .decisions/` is empty — nothing under those paths was ever touched in the
  main tree.

## Summary

| id | RC | failing | shape |
|---|---|---|---|
| RK-1 | 1 | 2 | matched |
| EB-1 | 1 | 1 | matched |
| EB-2 | 1 | 2 | **differs** — no-content-type hangs to a 5000ms test timeout, not 500/404 (caller's pre-existing `body === undefined` sentinel now fires on the real absent body, silently short-circuiting the response); array element still lands on 404 as predicted, via array-index-undefined rather than `?? {}` |
| EB-3 | 1 | 1 | matched |
| UI-1 | 1 | 1 | matched |
| UI-2 | 1 | 1 | matched |
| UI-3 | 1 | 1 | matched |
| UI-4 | 1 | 1 | matched |
| HG-1 | 1 (root) / 1 (verify:panel) | 2 (root) / step 9 | matched |
| HG-2 | 1 | 1 | matched |

9 of 10 mutations went red exactly as the implementer's report predicted, in the exact criterion(s) named and
nowhere else. One (EB-2) went red in the predicted criteria but by a different, more severe mechanism than
predicted — investigated and explained above, not a false red.

No fully-green mutation was found — every mutation broke at least one criterion.
