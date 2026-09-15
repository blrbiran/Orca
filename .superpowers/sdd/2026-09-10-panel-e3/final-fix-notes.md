# E3 final fix wave — controller notes (binding)

The final whole-branch review of E3 (`final-review.md` in this directory — read it whole first; it cites file:line
and the measurements behind each finding) returned **ready with fixes**. This is the ONE fix wave for it. The
controller's rulings on each finding are in `progress.md` (search "Ruling R64" … "Ruling R68"); they are restated
here as requirements.

## General (same contract as every task this plan)

- Repo `/Users/biran/code/skills/loop/Orca`, branch `main`, BASE `952739d`. Commit locally only, one commit per
  finding group is fine (explicit paths, no amend). **Never push, branch, merge, touch a worktree, or `git stash` /
  reset / checkout in the main tree** (the controller's uncommitted `.superpowers/sdd/2026-09-10-panel-e3/progress.md`
  and `.decisions/orca-dev-5d5c8055.jsonl` live there). `/usr/bin/git` for every git command. Measure any red against
  BASE in a throwaway `git clone --local` copy (symlink both node_modules).
- Read `CLAUDE.md` Rules 9, 12, 14, 17 first. Every new or changed branch gets a criterion that a named mutation can
  turn red, and you predict that mutation ("red in X and only X" / "red in X and Y").
- Every server a criterion starts: `parsePanelArgs` with a redirected `ORCA_CORRECTIONS_DIR`, a dist fixture, closed
  in `finally`. Loopback only; the only non-loopback address allowed is `192.0.2.1`/`198.51.100.1` in refusal
  criteria. Raw-path or raw-header HTTP goes through `node:http`, never `fetch`.
- 🔴 **Control bytes.** A raw NUL has landed in this plan's files five times. Never type a NUL-class or U+001F escape
  sequence in a Write/Edit/heredoc/commit message; build such a character with `String.fromCharCode(...)`. Byte-scan
  every touched file after EVERY edit (count bytes < 0x20 other than tab/LF/CR; must be 0), and scan the committed
  blobs at the end.
- Code, comments and commit messages in English. Spec ERRATA are appended in Chinese (the spec's own language), as a
  new `***ERRATUM (2026-09-16, run orca-dev-5d5c8055, final review of E3)***` block at the END of the section they
  correct — never edit the existing spec text in place (it is published).
- No subagents. Do not write to `.decisions/`. Do not touch `.superpowers/sdd/**` except your report.

## Findings and what "fixed" means

### F-1 (review I-1, ruling R64) — reviews dedupe key lacks projectKey
- `src/panel/reviewsStore.ts` `key()` includes `projectKey` alongside `decisionId`, `by`, `action`; keep the existing
  separator character, and if you have to write it anew, construct it with `String.fromCharCode(0x1f)`.
- Criterion (tests/panel/reviewsStore.test.ts, added, existing ones untouched unless one contradicts the new key —
  say which if so): the same `decisionId`/`by`/`action` under two different projectKeys writes TWO rows; the same
  projectKey still dedupes (positive control). Plus an HTTP-level criterion (reuse todo.test.ts shapes): two repos
  sharing a decision id, `POST /api/reviews` on both → both leave `/api/todo`.
- Append the spec ERRATUM to `docs/superpowers/specs/2026-09-09-panel-design.md` §4.3.2 (after that subsection's
  last line): the key is (projectKey, decisionId, by, action); why (§4.2's joint key; decision ids repeat across
  clones — E2 measured); what was measured (the final review's probe).
- Mutation to predict: RK-1 drop projectKey from `key()` again.

### F-2 (review I-2, deferred line 16, review Minor "store-busy → 400"; ruling R65) — error mapping
- A body-parser failure (express.json's error carries `status`/`type`, e.g. `entity.parse.failed`) answers 400 with
  `code: "panel-bad-request"` (export the constant) and a message; never 500.
- POST handlers read `req.body ?? {}` and refuse a body that is not a plain object (array, string, number, null)
  with 400 and the same code, by name, before touching any field.
- The 500 fallback message is `err instanceof Error ? err.message : String(err)`.
- A `CorrectRejection` whose code is the corrections store-busy code (read `src/corrections/storeLock.ts`) answers
  409, not 400.
- Criteria via `node:http` raw requests: POST /api/reviews with no content-type → 400 + code; malformed JSON → 400 +
  code; a JSON array body → 400 + code; the corrections store lock held during POST /api/corrections → 409 + the
  store-busy code (positive control: without the lock, the same POST → 200).
- Mutations to predict: EB-1 remove the body-parser error mapping; EB-2 remove the non-object refusal; EB-3 map
  store-busy back to 400.

### F-3 (review I-3, ruling R66) — the page must tell the person what happened
- `web/src/DecisionDetail.tsx` gets a correction form: `kind` select (every correction kind — count them in
  `src/corrections/schema.ts` and mirror them in `web/src/types.ts`, adding the list to the runtime parity criterion
  in `tests/panel/webParity.test.ts`), `because` textarea (required), `chose_instead` input (optional).
- A pure `correctionBody(form)` in a JSX-free web module builds the POST body: it OMITS `chose_instead` when the box
  is blank (the person said nothing), keeps it when filled, never sends `because` it did not get. The server is
  unchanged: it still passes through whatever arrives.
- Every POST in `web/src/api.ts` returns a typed result (`{ ok: true, body }` or `{ ok: false, status, code,
  message, retry_field? }`) instead of being `void`ed; `App.tsx` shows a refusal with the server's `code` and
  `message` (a pure `Refusal` component), offers "record another" (resending with `again: true`) when
  `retry_field === "again"`, and refetches the todo list and metrics after a successful Agree or Correct.
- The error page (metrics/list load failure) shows the server's `code` and `message` (the E2 gate refusal must be
  readable by the person), not only the status.
- Web criteria (renderToStaticMarkup / pure functions): `correctionBody` omits a blank `chose_instead` and keeps a
  filled one and keeps `because`; the refusal view renders code and message; the refusal view renders a "record
  another" control only when `retry_field === "again"`; the error page renders the gate refusal's code and message.
- Mutations to predict: UI-1 `correctionBody` sends `chose_instead: ""` for a blank box; UI-2 the refusal view drops
  `message`; UI-3 "record another" rendered regardless of `retry_field`; UI-4 the error page shows only the status.

### F-4 (review I-4, ruling R67) — Host allowlist against DNS rebinding
- A middleware in `buildApi` (or `createPanelServer`) registered BEFORE the static route: parse the `Host` header's
  hostname (handle `[::1]:port`); when the bind address is loopback (`127.0.0.1`, `::1`, or `localhost` as parsed),
  accept only hostnames `127.0.0.1`, `localhost`, `::1`; when bound externally with confirmation, also accept the
  bind address itself. Anything else, or a missing Host, answers 403 `code: "panel-host-not-allowed"` (exported) with
  no token anywhere in the body.
- Criteria via `node:http` with a raw `Host` header: `evil.example` → 403, the code, and the body does not contain the
  token; `evil.example` on `/api/metrics` with a valid token header → 403 (the guard is before the API too);
  `127.0.0.1:<port>` → 200 (positive control); `localhost:<port>` → 200.
- `scripts/verify-panel.ts` step 9 or a new sub-step asserts the `evil.example` Host → 403 (import the code) — the
  success criterion covers it end to end. Keep the step numbering stable; add it as `9b` or inside step 9's PASS line.
- Append the spec ERRATUM to §3.3 (after its registered list): DNS rebinding was not registered; measured by the final
  review; closed by the Host allowlist; what remains (an allowed hostname resolved to a hostile address is out of
  scope for a loopback bind).
- Mutations to predict: HG-1 delete the Host middleware; HG-2 accept any Host that ends with `localhost`.

### F-5 (deferred line 1, ruling R68) — dangling comment in record.ts
- `src/corrections/record.ts`: append an ERRATUM line at the end of the `correctionRowFrom` comment block saying the
  earlier "written out twice in the function below" refers to `correct.ts` before the seam existed, and that the
  function below no longer contains it. Do not edit the existing lines.

## Final checks

- `rtk proxy npm run verify > <file> 2>&1; echo "VERIFY_RC=$?" >> <file>`, read whole. Report every tier (typecheck,
  npm test files/tests, ledger validate, scheduler, web build, verify:panel PASS lines, web check files/tests) and the
  wall time. Baseline at BASE: 95/550, 51/167, verify:panel 13 PASS, web 5/10.
- `npm run verify:panel` once more on its own with the ps/lsof/$TMPDIR census before/after.
- Porcelain lists only the controller's two files; `git diff 952739d HEAD --stat` has no `Bin`; committed blobs
  scan 0 control bytes; `ls ~/.orca` absent; no leftover process.

## Report

Write the full report to `.superpowers/sdd/2026-09-10-panel-e3/final-fix-report.md`: per finding the change, the
criteria, the measured red (in a clone at BASE or with the change reverted in a clone), the mutation predictions with
the three answers, then the final checks. Final reply SHORT: status, commit shas, one-line verify summary, concerns.
