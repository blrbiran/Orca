# E3 final fix wave — scoped re-review

Re-reviewer, run orca-dev-5d5c8055 session, 2026-09-16. Fix base `952739d`, head `435f0f1`. Read: rereviewer-instructions.md,
final-fix-notes.md, final-fix-report.md, final-review.md (I-1..I-4, M-8, M-10, deferred line 16), and the whole diff file
`review-952739d..435f0f1.diff` (1849 lines, two passes: 1-1100, 1101-1849). Read-only on the main tree; no mutation, no
verify:panel, no test suite run.

Checks run (outputs redirected to files and read whole, Rule 14):
- `npx tsx scratchpad/rr-host.mts > scratchpad/rr-host.txt` (imports `src/panel/bindGuard.ts` at HEAD, evaluates
  `isHostAllowed` on 24 edge cases), RC 0. Results quoted below.
- `/usr/bin/git show 435f0f1:<f>` for all 22 changed files, counting bytes < 0x20 other than tab/LF/CR: 0 in every file;
  `/usr/bin/git diff --stat 952739d 435f0f1 | grep -c Bin` = 0 (`scratchpad/rr-bytes.txt`).

## Finding Verdicts

- **I-1 reviews dedupe key lacks projectKey** — ADDRESSED. `src/panel/reviewsStore.ts:30` key is
  `[row.projectKey, row.decisionId, row.by, row.action].join(UNIT_SEPARATOR)`; the `UNIT_SEPARATOR` line (`:20`) is
  unchanged (context line in the diff, 0 control bytes in the committed blob, still the `\x1f` escape). `ReviewRow`
  and the stored row format are untouched — only the in-memory key changed, so rows written before the fix (which
  already carry `projectKey`) load into the new key set correctly. Criteria: `tests/panel/reviewsStore.test.ts`
  "keys dedupe by projectKey too" (two projectKeys -> 2 rows, same projectKey -> `duplicate` positive control) and
  `tests/panel/todo.test.ts` (f) at HTTP level; report cites BASE red `expected 'duplicate' to be 'written'` on both.
  Spec §4.3.2 ERRATUM appended after that subsection's last line, before `### 4.4`, pure `+` lines, names the key,
  why (§4.2 joint key, E2 id repetition), the probe measurement with its commit, and the clone re-measurement.
- **I-2 malformed/absent bodies answer 500** — ADDRESSED. `src/panel/api.ts` `objectBody` (both POST handlers call it
  first, `:325-326`, `:376-377` in the diff) refuses undefined/array with 400 `panel-bad-request`; the four-argument
  handler maps body-parser http-errors (string `type` + 4xx `status`) to 400 `panel-bad-request` before the 500 arm.
  Criteria in `tests/panel/correctApi.test.ts` via raw `node:http` over both endpoints, each asserting 0 rows written;
  report cites BASE reds (500/500/404 vs 400).
  Judgment call (undefined body -> 400, not `?? {}`): accepted on the merits. `?? {}` turns a no-content-type POST
  into `404 decision-not-found` for decision "", which is a false statement about the request and contradicts the
  notes' own command-checkable criterion; refusing it by name is the honest answer.
- **I-3 page voids every POST / Correct can never succeed / error page drops code+message** — ADDRESSED.
  `web/src/api.ts` POSTs return `PostResult`, refused GETs throw `PanelRequestError` carrying code/message;
  `web/src/App.tsx` awaits through `send`, renders `Refusal` or a status line, refetches via `loadHome` after success;
  `ErrorPage` renders status, code and message. `DecisionDetail.tsx` has a form (kind select over
  `WEB_CORRECTION_KINDS`, `because` required, `chose_instead` optional), so `because: ""` is no longer posted.
  `correctionBody` omits a blank (empty or whitespace-only) `chose_instead`, keeps a filled one, adds no field of its
  own (`again` is never set there). `again: true` is added only in `onRecordAnother` (App.tsx, the Refusal callback),
  and the button renders only when `retry_field === "again"`. Refetch does not loop: `loadHome` sets only `home`/
  `error`; the effects depend on `[]` and `[selected]`, neither of which `loadHome` changes. Kind parity added to
  `tests/panel/webParity.test.ts` both at runtime (set equality) and compile time.
- **I-4 no Host check / DNS rebinding reaches the token** — ADDRESSED. `src/panel/server.ts` registers the Host guard
  as the first `app.use`, before `express.json` and `buildApi` (so before the static route, the `/api` token check,
  every route and the error handler); `createServer(app)` is the only request path (`grep -rn "express()" src` -> one
  hit, server.ts:100). Refusal body is a constant `{code, message}` with no token. Criteria in
  `tests/panel/metricsApi.test.ts` (foreign Host on `/` including portless and ported `evil.localhost`; on
  `/api/metrics` with a valid token; positive controls `127.0.0.1`, `localhost`, `[::1]`), predicate criterion in
  `tests/panel/security.test.ts`, and `scripts/verify-panel.ts` step 9 (PASS line extended, numbering unchanged).
  Predicate edge cases measured (`rr-host.txt`, bind 127.0.0.1 unless noted): `127.0.0.1.evil.example` false,
  `localhost.evil.example` false, `evil.localhost` false, `localhost@evil.example` false, `user@localhost:1` false,
  `localhost.` (trailing dot) false, `LOCALHOST:1` true, `[::1]:1` true, `[::1]` true, unbracketed `::1` false,
  `[::ffff:127.0.0.1]:1` false, `0x7f000001` / `2130706433` / `127.1` false, `localhost:` false, `localhost:1:2` false,
  undefined false; bind `127.0.0.2` accepts `127.0.0.2:1`. Every refusal is fail-closed; no attacker-controllable
  hostname passed. Spec §3.3 ERRATUM appended after the registered list, before `---`, pure `+` lines, states the
  probe measurement with commit, the fix, the criteria, and what remains.
  Judgment call (loopback bind also accepts its own bind address): accepted on the merits. It only changes behaviour
  for `--bind 127.0.0.x` (x != 1), where the panel would otherwise refuse its own printed URL; an IP literal cannot be
  rebound, and a hostname bind other than `localhost` requires `--i-know-this-is-exposed` (isLoopback), which the
  ERRATUM registers.
- **Deferred line 1 / M-10 record.ts dangling comment** — ADDRESSED. `src/corrections/record.ts` gains an appended
  `*** ERRATUM (2026-09-16, ...) ***` at the end of the `correctionRowFrom` comment block; existing lines untouched
  (diff is `+` only).
- **Deferred line 16 the 500 fallback's String(err)** — ADDRESSED. `src/panel/api.ts` fallback message is
  `err instanceof Error ? err.message : String(err)`.
- **M-8 store-busy -> 400** — ADDRESSED. `src/panel/api.ts:315` maps `CorrectRejection` with
  `CORRECTIONS_STORE_BUSY` (thrown as a `CorrectRejection` by `src/corrections/storeLock.ts:80-84`) to 409, others
  stay 400; already-recorded keeps its own 409 arm above it. Criterion holds the lock -> 409 + code + 0 rows, positive
  control after release -> 200 + 1 row.

Error-mapping order (focus c): `MetricsRejection`/`PanelRejection` are still tested first in the four-argument handler
and answer 409; the body-parser arm comes second, the 500 arm last. A body-parser 413 (or 415 charset) now answers 400
`panel-bad-request` with message `the request body could not be read: request entity too large` — the code and
message are honest, the status is coarsened from 413 to 400 exactly as the notes literally required (see Minor N-3).

## New Breakage in the Fix Diff

No Critical. No Important.

- **N-1 (Minor)** `web/src/App.tsx` (the `[selected]` effect, and `DecisionDetail` rendered without a `key`): when the
  person opens a second row, `decision` is not cleared before `fetchDecision` resolves, so during that window the
  pane still shows the previous decision while `onCorrect`/`onAgree` post against the NEW `selected`; and the form is
  uncontrolled with no `key`, so text typed in `because`/`chose_instead` for decision A stays in the boxes when
  decision B opens. The stale-display window pre-dates this wave (Agree had it), but it now reaches a Correct that can
  succeed. Fix if touched: `setDecision(null)` before the fetch and `key={`${selected.projectKey}/${selected.id}`}` on
  `DecisionDetail`.
- **N-2 (Minor, Rule 9 process)** `web/tests/outcome.test.tsx`: its only measured red is the module-load failure at
  BASE; no assertion-level red for UI-1..UI-4 was observed (the implementer flags this honestly). Until the mutation
  verifier sees those four red, the criteria are predicted, not proven.
- **N-3 (Minor)** `src/panel/api.ts` `isBodyParserError` arm answers every body-parser 4xx as 400 (413 too large, 415
  unsupported charset); the message names the real cause, the status does not. Per the notes; register or pass
  `err.status` through if the distinction is ever wanted.
- **N-4 (Minor, cosmetic)** `src/panel/bindGuard.ts` `hostnameOf`: the bracketed branch accepts any content, so
  `[localhost]:1` is accepted (`rr-host.txt` line 23). Not an attack path (a browser never sends a bracketed
  non-IPv6 Host, and the name inside must still be an exact allowlist match).

## Out-of-Scope Observations

- `express.json` runs before the `/api` token middleware (pre-existing order, `server.ts`), so a tokenless malformed
  body now gets `400 panel-bad-request` rather than `401 token-required` (it was 500 before). No data exposure; worth a
  line if the error surface is ever audited.
- `src/panel/reviewsStore.ts:57` class comment still says "two rows per distinct decisionId"; corrected by the ERRATUM
  above `key`, not edited in place (per Rule 13), as the report notes.

## Verdict

**Fix round:** All findings addressed, no new Critical/Important breakage. Four Minors (N-1..N-4) for the ledger.
