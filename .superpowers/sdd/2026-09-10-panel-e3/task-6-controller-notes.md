# Task 6 — controller notes (binding; they override the brief where they conflict)

Read after `task-6-brief.md`. The brief is the requirements; these notes are rulings on points where the brief is
ambiguous, stale, self-contradictory, or predicted to break. Every "measure" below means: run it, redirect to a file,
read the file whole. Never pipe or grep a verifying run.

⚠️ The brief is written as "criterion outlines, filled in at execution". Two outlines are empty `it(...)` bodies.
**Every `it` you land must assert something that a named mutation below can turn red.** An empty or assertion-free
`it` is a defect, not a placeholder.

## General

- Repo `/Users/biran/code/skills/loop/Orca`, branch `main`. **BASE is given in your dispatch message.** Commit
  locally only. **Never push, branch, merge, or touch a worktree.**
- Use `/usr/bin/git` for every git command (plain `git` is rewritten through rtk, which prints `ok` for empty output).
- Scratch files in `mktemp -d` or
  `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/5d5c8055-111d-4296-ad0c-e78a5b191f54/scratchpad/`.
  The brief's `/tmp/who6.txt` fixed name is NOT to be used.
- `/bin/rm` (local `rm` and `cp` are aliased to `-i`); guard every variable in a destructive command with
  `"${VAR:?msg}"`.
- Code, comments and commit messages in English.
- **You do NOT run the named mutations.** An independent verifier runs them after review. You DO run the brief's
  survey grep (redirected to a scratch file) and paste its output into your report, and write a prediction for every
  mutation listed below.
- **No subagents. Do not write to `.decisions/`** (the plan's ruling 4 row is the controller's job). Do not touch
  `.superpowers/sdd/**` except your own report file.
- 🔴 **Control bytes.** Never type a NUL-class escape sequence (backslash-zero, backslash-x-zero-zero, backslash-u-zero…)
  literally into a Write/Edit/heredoc — the tool has delivered such escapes as RAW bytes, which made git classify a
  source file as binary so the reviewer could not read it. If you need a control character, build it with
  `String.fromCharCode(...)`. After your last edit, byte-scan every file you touched (python: count bytes < 0x20
  other than tab/LF/CR) and report the counts — they must all be 0.

## Rulings

- **H1 — one clock (carried rulings R1/R36; ruling R41).** The brief's detail handler writes
  `at: new Date().toISOString()`. Replace with the panel's one clock: `(deps.opts.now ?? (() => new Date()))().toISOString()`
  (or a small shared helper in `api.ts` that `currentMetrics` also uses — one expression, not two copies). The
  `records exactly one opened` criterion sets `opts.now` to a fixed `Date` on the parsed options and asserts the row's
  `at` equals that ISO string.
- **H2 — detail membership goes through the gate (ruling R42).** `GET /api/decision` first calls
  `currentMetrics(deps.opts)` (so a broken gate answers 409 exactly like `/api/metrics`), then answers only if
  `observations.decisions` contains an entry with BOTH `projectKey === q.projectKey` AND `id === q.decisionId`. The repo
  path comes from `observations.repos` (the entry whose `projectKey` matches). `src/panel/decisionSource.ts`
  (carried ruling R8) exports the function that, given that repo path and the decision id, reads the top-level
  `.decisions/*.jsonl` files (same file set and order as `src/metrics/collect.ts`'s `ledgerFiles` — top level only,
  `.jsonl`, sorted) through `readLedgerLeniently` and returns the whole parsed decision object (`row.value`) whose `id`
  matches, else `undefined`. Do not write a new parser. A browser-supplied `projectKey` therefore only selects among
  discovered repos, never a filesystem path. `src/metrics/**` gets zero diff; if `ledgerFiles` is not exported, copy
  its four lines with a comment naming where the original lives rather than editing E2.
- **H3 — `detailUrl` lives in `src/panel/listProjection.ts`** (carried ruling R12) and every criterion builds detail
  URLs through it — never a hand-spelled query string.
- **H4 — the two empty `it`s, written in full (ruling R43).**
  1. `serves the detail even when the CORRECTIONS lock is held`: acquire the corrections store lock
     (`acquireStoreLock` from `src/corrections/storeLock.ts`, on the redirected corrections dir) BEFORE the request,
     GET the detail, assert 200 and `decision.id`, release in `finally`. Positive observation: the decision body.
  2. `answers 404 for a decision it has never seen, and for a known id under an unconfigured projectKey`: both
     requests answer 404 with body `code === "decision-not-found"`; after both, `readReviews` on the store returns 0
     rows (a 404 records nothing). Export the code as a constant from `listProjection.ts` or `api.ts` and import it in
     the criterion — do not retype the literal.
- **H5 — two criteria the brief lacks (ruling R43).**
  3. `returns each repository's own row when two repositories share a decision id`: two target repos with DIFFERENT
     remotes, both configured with `--repo <key>=<path>`, each holding a decision with id `orca-dev-1/1` but a
     different `question` (seed one with `makeTargetRepo()`, the other with `makeTargetRepo({ remote: <other>,
     seedDecision: false })` plus `appendEvent` of a copy of `ORIGINAL` with another question, committed like the
     harness does — measure what `discoverRepos` requires of a `--repo` key before choosing the keys). Request BOTH
     keys and assert each answer's `question` is that repo's own.
  4. `answers the detail with the gate's refusal when the gate is broken`: same fixture shape as metricsApi.test.ts's
     broken-gate criterion (a correction whose projectKey is unresolvable, recorded AFTER the server is up); GET a
     detail that exists → 409, `body.code` equals the imported `UNRESOLVED_PROJECT_KEYS`, and `"decision" in body`
     is false.
- **H6 — the reviews-lock criterion also pins the write-failure branch (ruling R44).** Rename it
  `serves the detail while the reviews lock is held, and the failed opened write is only a server-side warning`.
  Hold `acquireReviewsLock(store)` for the whole criterion. Spy `process.stderr.write` (vitest `vi.spyOn`, restored in
  `finally`). Assert, in this order: status 200; `decision.id`; then `eventually` (budget 3000 ms — the lock budget is
  1000 ms) until the spy has seen a line containing `could not record opened` and the decision id; then
  `readReviews` has no row for that decision id. Release the lock and restore the spy in `finally`. Keep the plan's
  point: the status is the value that matters, never elapsed time.
- **H7 — isolation (ruling R45, carried R38).** Every `it` starts its own server via `parsePanelArgs` (never a
  hand-built options object with `bind` omitted) with its own `withCorrectionsDir` temp dir passed as
  `{ ORCA_CORRECTIONS_DIR: dir }`, its own dist fixture and its own target repo(s); every server and fixture is closed
  in `finally`. `metricsApi.test.ts`'s `get`/`makeDistFixture` are file-local: either copy the small helpers into
  `decisionsApi.test.ts` or move them into a shared `tests/panel/httpHarness.ts` and import them from BOTH files. If you
  move them, metricsApi.test.ts must stay 12/12 and its criteria must keep their names (the verifier's earlier reports
  cite them). `0.0.0.0` appears nowhere. After your final run `ls ~/.orca` must print "No such file or directory".
- **H8 — list criterion.** Keep the brief's two assertions exactly (expected rows built from `LIST_FIELDS`, not by
  calling `projectForList`; and the per-row `Object.keys` equality). The fixture must hold at least two decisions so
  the deep equality is over a real list. `records NOTHING when the list is served` needs a positive observation that
  the request succeeded (status 200 and `rows.length` > 0) before asserting 0 review rows — "nothing happened" without
  proof the request happened is empty.
- **H9 — `records exactly one opened when a detail is served, and no reviewed`**: filter by decisionId (the brief's
  form), use `eventually`, and assert `action`, `by` (from `--by`) AND `at` (H1).
- **H10 — routes go ABOVE the four-argument error handler** in `buildApi` (the comment there says so).
- **H11 — the `opened` warning.** Keep the brief's stderr line shape `orca panel: could not record opened for <id>: ...`.
- **H12 — `DecisionListRow` / `LIST_FIELDS` / `projectForList` exactly as the brief's Step 1.**

## Mutations the verifier will run (predict each; run the survey grep first)

| id | change |
|---|---|
| L-3 | list handler also appends an `opened` row for every listed decision |
| L-3b | brief: `projectForList` returns `{ ...decision, summary: decision.id.slice(0, 8) }` |
| W-6b | brief: detail `void deps.reviews.append(...)` becomes `await deps.reviews.append(...)` moved BEFORE `res.json` |
| O-1 | detail: the `opened` append's `.catch` body becomes `() => undefined` (silent) |
| K-6 | detail: `opened.at` uses `new Date().toISOString()` instead of the panel clock |
| R-6b | detail handler wraps its whole body in the corrections store lock (`withStoreLock(deps.opts.correctionsDir, …)`) |
| D-1 | detail: the not-found branch answers 200 `{ decision: null }` |
| D-2 | detail: membership and repo lookup match on decision id alone (projectKey ignored; first match wins) |
| D-3 | detail: skip `currentMetrics`; find the repo with `discoverRepos(deps.opts)` directly |

For each use "red in X and only X" or "red in X and Y" — never "at least". Before each, answer: (1) does an earlier
assertion short-circuit before the named one? (2) who else walks the deleted/changed line? (3) where does the literal
in the named assertion come from? For D-2, say which request of criterion 3 fails and why "first match wins" makes it
fail; for W-6b and R-6b, say what status the request gets and through which branch of the error handler.

## Final checks, after the commit

- `rtk proxy npm run verify > <file> 2>&1; echo "VERIFY_RC=$?" >> <file>`, read whole; report the three tiers
  separately (whole repo / `verify:scheduler` / `@orca/web check`). Baseline at BASE: 90/519, 51/167, 1/1. Report
  whether any `skipped` or `todo` count appears.
- `/usr/bin/git status --porcelain -z > <file>; wc -c < <file>` — non-zero ONLY because of the controller's
  `.superpowers/sdd/2026-09-10-panel-e3/` files (ledger, notes, brief) and your report. List what you saw.
- `/usr/bin/git diff <BASE> HEAD --stat -- src/metrics` → must be empty. Also `/usr/bin/git diff <BASE> HEAD --stat`
  whole — it must contain no `Bin` line.
- Byte scan of every touched file (see General) → all 0.
- `ls ~/.orca` → must still be absent; paste the output. `ps` for leftover `tsx`/panel processes; paste.
- Stage by explicit path. Commit trailer names the model you actually are:
  `Co-Authored-By: <model name> <noreply@anthropic.com>`.
- The commit message states facts true at the commit: mutation reds are predictions, not "seen red"; say L-3b's
  expected rows are built from `LIST_FIELDS` (external review C1's repair) and that W-6b's criterion asserts a status,
  not a duration.

## Report

Write the full report to
`/Users/biran/code/skills/loop/Orca/.superpowers/sdd/2026-09-10-panel-e3/task-6-report.md`: the measured red before
implementation (if you ran the criteria first), the survey grep, every mutation prediction with the three answers,
the three verify tiers, the porcelain listing, the `src/metrics` diff, the diffstat, the byte-scan counts, the
`ls ~/.orca` output, the leftover-process check, and every deviation with its reason. If you could not witness
something, say "not witnessed". Final reply SHORT: status, commit sha(s), one-line test summary, concerns.
