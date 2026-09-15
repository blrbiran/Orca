# Task 7 — controller notes (binding; they override the brief where they conflict)

Read after `task-7-brief.md`. The brief is the requirements; these notes are rulings on points where the brief is
ambiguous, stale, self-contradictory, or predicted to break. Every "measure" below means: run it, redirect to a file,
read the file whole. Never pipe or grep a verifying run.

⚠️ The brief is "criterion outlines, filled in at execution". Three outlines are empty `it(...)` bodies and two
outlines send the SAME request. **Every `it` you land must assert something that a named mutation below can turn
red.** An empty or assertion-free `it` is a defect, not a placeholder.

## General

- Repo `/Users/biran/code/skills/loop/Orca`, branch `main`. **BASE is given in your dispatch message.** Commit
  locally only. **Never push, branch, merge, or touch a worktree.**
- Use `/usr/bin/git` for every git command (plain `git` is rewritten through rtk, which prints `ok` for empty output).
- Scratch files in `mktemp -d` or
  `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/5d5c8055-111d-4296-ad0c-e78a5b191f54/scratchpad/`.
  The brief's `/tmp/who7.txt` fixed name is NOT to be used.
- `/bin/rm` (local `rm` and `cp` are aliased to `-i`); guard every variable in a destructive command with
  `"${VAR:?msg}"`.
- Code, comments and commit messages in English.
- **You do NOT run the named mutations.** An independent verifier runs them after review. You DO run the brief's
  survey grep (redirected to a scratch file), paste its output into your report, and write a prediction for every
  mutation listed below.
- **No subagents. Do not write to `.decisions/`** of this repo. Do not touch `.superpowers/sdd/**` except your own
  report file.
- 🔴 **Control bytes.** Never type a NUL-class escape sequence literally into a Write/Edit/heredoc — the tool has
  delivered such escapes as RAW bytes, which made git classify a source file as binary so the reviewer could not read
  it. Build control characters with `String.fromCharCode(...)` if ever needed. After your last edit, byte-scan every
  file you touched (count bytes < 0x20 other than tab/LF/CR) and report the counts — all must be 0.
- Task 6 (already committed at BASE) added `GET /api/decisions`, `GET /api/decision`, `src/panel/listProjection.ts`,
  `src/panel/decisionSource.ts`, and test helpers. **Read them first** and reuse Task 6's clock helper and membership
  logic rather than writing second copies.

## Rulings

- **J1 — the browser never names a filesystem path (carried finding F2; ruling R47).** The brief's handler calls
  `projectKeyOf(String(body.repo))`, which runs git in whatever directory the browser sends. Instead the body carries
  `projectKey` and `decisionId`; both endpoints (`POST /api/corrections`, `POST /api/reviews`) first call
  `currentMetrics(deps.opts)` (a broken gate answers 409 like every other endpoint) and accept the request only if
  `observations.decisions` holds an entry with that exact `(projectKey, id)` pair — the same membership rule Task 6's
  detail endpoint uses (reuse it; one definition). Otherwise answer 404 with Task 6's not-found code and record
  nothing. `projectKeyOf` is not imported by `src/panel/**`. Why it matters beyond F2: a correction stored with a
  projectKey the gate cannot resolve makes E2's gate refuse EVERY later metrics request for everyone.
- **J2 — one construction point and one clock (carried rulings R1/R36/H1; ruling R48).** Build the row with
  `correctionRowFrom(input, clock)` from `src/corrections/record.ts`, where `clock` is the panel's one clock
  (`deps.opts.now`, default wall clock — Task 6's helper), then store it with `recordNewCorrection`. No row literal with
  `at: new Date()` anywhere in `src/panel/**`. `by` is `deps.opts.by`, never the body. `chose_instead` passes through
  exactly as sent (brief's spread), `again` is `body.again === true`.
  Criterion `derives the same correction id the CLI derives for the same input and clock` (R1 restores C-13's original
  landing): post the input that `tests/corrections/injectableClock.test.ts` uses for its `GOLDEN_ID` (line 40 at
  BASE — re-read the file, including which clock value and which `by`), with `opts.now` set to that same clock and
  `--by` set to that same `by`, and assert the stored correction's `id` equals `GOLDEN_ID`. If `GOLDEN_ID` and its
  input are not exported, export them from that test file (smallest edit; the file's own criteria must stay green) or
  duplicate the literal with a comment naming the file and line — say which in the report. If the golden input's
  `projectKey`/`decisionId` cannot be made a discovered decision in a fixture repo, report NEEDS_CONTEXT rather than
  weakening the criterion.
- **J3 — the brief's first and third criteria send the identical request (ruling R49).** Differentiate them:
  - `answers a row the seam would refuse with the seam's OWN named refusal`: a listed decision, `kind: "bogus"`,
    no empty strings → 400, `code` equals the imported `CORRECTION_ROW_INVALID`; `readCorrections` is empty.
  - `refuses an empty optional field by name instead of dumping Zod at the person`: `kind: "wrong"`,
    `chose_instead: ""` → 400, `code` equals `CORRECTION_ROW_INVALID`, `message` contains `chose_instead`;
    `readCorrections` is empty.
- **J4 — `records and does NOT close the loop` (carried R13; C-5).** Positive observation first: 200 and
  `readCorrections` has 1 row. Then the "nothing happened" half, measured against a snapshot taken before the POST:
  the sorted names AND the sha256 of every file in the fixture repo's `.decisions/` (a close-the-loop write may append
  to a NEW run file or to an existing one), `git rev-parse HEAD` unchanged, and `git status --porcelain` empty. Not
  git status alone: the closing path commits, which leaves status clean.
- **J5 — second correction (C-14).** Keep the brief's two criteria. The 409 body's `code` equals the imported
  `CORRECTION_ALREADY_RECORDED`, `message` does not contain `--again`, `retry_field === "again"`. The negative control
  posts with `again: true` → 200 and 2 rows.
- **J6 — `reviewed`, and `POST /api/reviews` (carried ruling R3; ruling R50).**
  - `POST /api/reviews` body `{ projectKey, decisionId }` → membership (J1) → `await deps.reviews.append({ action:
    "reviewed", by: deps.opts.by, at: <panel clock>, projectKey, decisionId })` → 200 `{ result }` (`"written"` or
    `"duplicate"`). A failed append propagates to the error handler (a `PanelRejection` becomes 409).
  - `POST /api/corrections`: after `recordNewCorrection` succeeds, `await` the same `reviewed` append. If THAT append
    fails, the person must be told both halves: answer 409 with the append error's `code`, a message stating the
    correction WAS recorded and the review mark was not, and `correction: <stored row>`. Never 200 on that path.
  - Refused corrections (400, 409) write no `reviewed`.
  - Criteria (replace the three empty outlines):
    1. `does NOT write reviewed when the correction was refused`: a 400 refusal (J3's bogus kind) on a listed
       decision; positive: status 400 and store empty; then `readReviews` has no `reviewed` row for that decision.
    2. `writes reviewed when the correction lands, and when the person clicks agreed`: correction on decision A →
       one `reviewed` row for A with `by` and `at` (fixed clock) asserted; `POST /api/reviews` on decision B → 200 and
       one `reviewed` row for B. The fixture needs two listed decisions.
    3. `lets a failed reviewed write reach the person, unlike opened` (plan's outline): hold `acquireReviewsLock`
       for the whole criterion; `POST /api/reviews` → status is not 2xx (assert 409 and the reviews-busy code
       constant from `src/panel/reviewsLock.ts`); no `reviewed` row. Release in `finally`.
    4. `tells the person the correction landed even when the reviewed mark could not be written`: hold the reviews
       lock; post a valid correction → 409, `body.correction.id` present, `readCorrections` has 1 row, no `reviewed`
       row. Release in `finally`.
  - Also: `answers 404 for a decision the panel does not list, and records nothing` covering BOTH endpoints (an
    unconfigured projectKey with a real decision id): 404 each, `readCorrections` empty, `readReviews` empty.
- **J7 — isolation (carried R38/R45).** Every `it` starts its own server via `parsePanelArgs` with its own
  `withCorrectionsDir` dir passed as `{ ORCA_CORRECTIONS_DIR: dir }`, its own dist fixture and its own target repo(s);
  closed in `finally`. Reuse Task 6's helpers (shared harness if Task 6 made one). `0.0.0.0` appears nowhere. After
  your final run `ls ~/.orca` must print "No such file or directory". A POST needs the token header and a JSON body.
- **J8 — routes go ABOVE the four-argument error handler.**

## Mutations the verifier will run (predict each; run the survey grep first)

| id | change |
|---|---|
| C-5 | after `recordNewCorrection`, close the loop into the fixture repo: append the overturned rows to its `.decisions/` and commit (the path `orca correct`'s closing mode uses) |
| C-13 | handler bypasses `recordNewCorrection`: `{ id: deriveCorrectionId(row), ...row }` stored with `recordCorrection` directly (row still built by `correctionRowFrom`) |
| K-7 | the correction row is built with `() => new Date()` instead of the panel clock |
| E-7 | handler normalises `chose_instead: ""` to absent before building the row |
| C-14 | the already-recorded branch answers `err.message` (the CLI's words) as `message` |
| M-7 | both POST handlers skip the membership check (accept any `projectKey`/`decisionId`) |
| V-1 | `POST /api/corrections` does not append `reviewed` after recording |
| V-2 | `POST /api/reviews` appends `action: "opened"` instead of `"reviewed"` |
| V-3 | `POST /api/reviews` catches the append failure and answers 200 |
| V-4 | `POST /api/corrections` catches the `reviewed` append failure and answers 200 with the stored row |
| V-5 | `POST /api/corrections` appends `reviewed` BEFORE calling `recordNewCorrection` |

For each use "red in X and only X" or "red in X and Y" — never "at least". Before each, answer: (1) does an earlier
assertion short-circuit before the named one? (2) who else walks the changed line? (3) where does the literal in the
named assertion come from? For C-5, answer: on the mutation run, what does the criterion dirty — it must be only a
throwaway fixture repo under `$TMPDIR`, never this repository.

## Final checks, after the commit

- `rtk proxy npm run verify > <file> 2>&1; echo "VERIFY_RC=$?" >> <file>`, read whole; report the three tiers
  separately. The baseline at BASE is in your dispatch. Report any `skipped` or `todo` count.
- `/usr/bin/git status --porcelain -z > <file>; wc -c < <file>` — non-zero ONLY because of controller files under
  `.superpowers/sdd/2026-09-10-panel-e3/` and your report. List what you saw.
- `/usr/bin/git diff <BASE> HEAD --stat -- src/metrics src/corrections` → report it (expected empty; if you exported
  from a test file, that is under tests/). `/usr/bin/git diff <BASE> HEAD --stat` whole — no `Bin` line.
- `grep -rn "projectKeyOf" src/panel` redirected to a file → expected no hits; report.
- Byte scan of every touched file → all 0.
- `ls ~/.orca` → absent; paste. `ps` for leftover `tsx`/panel processes; paste.
- Stage by explicit path. Commit trailer names the model you actually are.
- The commit message states facts true at the commit: mutation reds are predictions.

## Report

Write the full report to
`/Users/biran/code/skills/loop/Orca/.superpowers/sdd/2026-09-10-panel-e3/task-7-report.md`: measured red before
implementation, the survey grep, every mutation prediction with the three answers, the three verify tiers, porcelain,
diffstats, byte-scan counts, `ls ~/.orca`, the process check, and every deviation with its reason. If you could not
witness something, say "not witnessed". Final reply SHORT: status, commit sha(s), one-line test summary, concerns.
