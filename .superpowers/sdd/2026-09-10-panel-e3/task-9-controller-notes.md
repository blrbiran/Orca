# Task 9 — controller notes (binding; they override the brief where they conflict)

Read after `task-9-brief.md` — but only its first section (`## Task 9…` through the `verify` wiring, roughly lines
1-91). The rest of that file is the plan's mutation master table, self-review and review dispositions, which you need
only where these notes point at them. Every "measure" means: run it, redirect to a file, read the file whole. Never pipe
or grep a verifying run.

## General

- Repo `/Users/biran/code/skills/loop/Orca`, branch `main`. **BASE is given in your dispatch message.** Commit
  locally only. **Never push, branch, merge, or touch a worktree.** `/usr/bin/git` for every git command.
- Scratch in `mktemp -d` or
  `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/5d5c8055-111d-4296-ad0c-e78a5b191f54/scratchpad/`.
  The brief's `/tmp/verify.txt`, `/tmp/o.txt` fixed names are NOT to be used.
- `/bin/rm` (local `rm`/`cp` are aliased to `-i`); guard variables in destructive commands with `"${VAR:?msg}"`.
- Code, comments, script output and commit messages in English.
- **You do NOT run the named mutations** (an independent verifier does). Predict each one below.
- **Never `git stash`, reset or checkout in the main tree** (it holds the controller's uncommitted ledger and `.decisions/orca-dev-5d5c8055.jsonl`). To measure a red against BASE, use a throwaway `git clone --local` copy.
- **No subagents. Do not write to this repo's `.decisions/`.** Do not touch `.superpowers/sdd/**` except your report.
- 🔴 **Control bytes.** Never type a NUL-class escape sequence literally into a Write/Edit/heredoc (the tool has delivered
  such escapes as RAW bytes). Byte-scan every touched file at the end (bytes < 0x20 other than tab/LF/CR) — all 0.
- 🔴 **Safety of the script itself.** `verify:panel` becomes part of `npm run verify`, which every future agent runs.
  It must never touch the person's real data, never bind anything but loopback, and never leave a process behind:
  - `ORCA_CORRECTIONS_DIR` for every child is a `mkdtemp` directory the script owns and removes.
  - The target repo is a throwaway `mkdtemp` git repo with an `origin` remote; the script removes it.
  - Every `orca panel` child is spawned `detached` and killed as a whole process group (negative pid) in `finally`,
    with a per-step deadline shorter than any outer timeout — the same teardown as `runPanelProcess` in
    `tests/panel/security.test.ts` (tsx runs the script in a CHILD node process; killing the tsx pid alone orphans the
    listener — measured in an earlier session). Read that helper and mirror it.
  - The only non-loopback address anywhere is `192.0.2.1` (RFC 5737 TEST-NET-1, on no interface) in step 11, sent
    WITHOUT the external-bind confirmation. `0.0.0.0` appears nowhere.

## Rulings

- **L1 — Step 1 is already landed; do not add a duplicate (ruling R53).** `tests/panel/reviewsStore.test.ts` already
  has `leaves an already-existing directory's mode alone, even when it is looser than 0700` (line 64 at the time of
  writing — re-read). The controller measured a fresh `mkdtemp` directory's mode on this machine: `700`. Read the
  existing criterion and say in the report whether it sets a looser mode BEFORE `append` and asserts it survives
  (i.e. whether it can go red). If it can, leave it; the verifier's mutation R-9b measures it. If it cannot, fix THAT
  criterion (smallest edit) and say so.
- **L2 — the script is TypeScript run through tsx, so `detailUrl` has one definition (carried ruling R12; ruling
  R54).** Create `scripts/verify-panel.ts` (not `.mjs`); `"verify:panel": "tsx scripts/verify-panel.ts"`. It imports
  `detailUrl` from `../src/panel/listProjection.js` and any constants it compares against (error codes such as
  `TOKEN_REQUIRED`, `UNRESOLVED_PROJECT_KEYS`, `CORRECTION_ALREADY_RECORDED`, the bind refusal code) from their
  modules — never retyped literals. The root tsconfig already includes `scripts/**/*.ts`, so `npm run typecheck`
  covers it. The script's `main` runs only when executed directly; its pure helpers are exported.
- **L3 — `tests/panel/endToEnd.test.ts` pins the script's own parser (ruling R55).** The brief names the file but
  gives it no content. It holds criteria for the exported pure helpers, at least `parseReadyLine(stdout)` — which
  reads the CLI's ONE machine-readable line (`src/cli.ts` prints `orca-panel ready url=<url> token=<token>`; re-read
  it) and returns `{ url, token }` or throws a named error. Must-catch samples (no line; a line missing `token=`; a
  `url=` that is not `http://127.0.0.1:<port>`; a token that is not 64 lowercase hex) and must-not-catch samples (the
  real shape, with other log lines before and after). Plus a value assertion: the parsed token equals the sample's
  token (a shape check alone is blind to a fixed well-shaped value).
- **L4 — the verify string is REPLACED, not appended (carried ruling R11).** The target is exactly:
  `npm run typecheck && npm test && (npm run ledger -- validate .decisions || [ $? -eq 2 ]) && node scripts/check-claude-md-lines.mjs && node scripts/check-hooks-path.mjs && npm run verify:scheduler && npm run build --workspace web && npm run verify:panel && npm run --ws check`
  (read the current string first; if it differs from the Task 1 form in anything other than these two inserted
  steps, report NEEDS_CONTEXT). The `build --workspace web` step is external review seat 2's Critical 1 — keep it.
- **L5 — the steps (brief Step 2, all twelve, none dropped), with these corrections:**
  - Fixture: the throwaway repo holds at least two decisions, at least two of them high tier (choose kinds/scopes by
    calling `isHighTier`, not a table), committed. `orca panel --by tester --port 0 --bind 127.0.0.1 --repo
    <key>=<repo>` — the key is what `discoverRepos` requires for that repo's remote (measure it; the corrections
    harness fixture remote is `https://github.com/biran/orca.git`).
  - Before starting: assert `web/dist` exists and holds NO subdirectory (Task 4 deferred minor: `loadStaticFiles`
    reads the top level only, so a nested build output would be dropped silently), and that its `index.html` contains
    `TOKEN_ANCHOR` (imported).
  - Step 1: parse with `parseReadyLine`; a parse failure is a named non-zero exit.
  - Step 2 onward: counts of `opened`/`reviewed` are PER DECISION (filter by projectKey and decisionId), read with
    the store's own reader, polled with an `eventually`-style helper (no fixed sleep).
    🔴 **Absence checks ("still 0", "still only 1") use a bounded observation window, not an immediate read** (ruling
    R59, measured in Task 6: a fire-and-forget write landed ~500 ms after the response, and an immediate read of "0"
    stayed green under the mutation). Poll until the count EXCEEDS the expected value or the window (reviews lock
    budget `REVIEWS_LOCK_TIMEOUT_MS` + 1000 ms, imported) runs out, then assert the expected value.
  - Step 5: "coverage numerator becomes 1" is `panel_review_coverage.reviewed_high_tier === 1` from `/api/metrics`,
    AND the agreed decision leaves `/api/todo` (Task 8's endpoint) while the other high-tier one stays.
  - Step 6: the "closed nothing" half compares a before/after snapshot of the repo's `.decisions/` (sorted names AND
    sha256 of each file), `git rev-parse HEAD`, and `git status --porcelain` (0 bytes) — not status alone, because a
    closing write commits.
  - Step 7: 409, `code` equals `CORRECTION_ALREADY_RECORDED`, `message` lacks `--again`, `retry_field === "again"`.
  - Step 8: record a correction with an unresolvable projectKey into the redirected store AFTER the panel is up
    (through `recordCorrection`), then `/api/metrics` answers 409 with `code === UNRESOLVED_PROJECT_KEYS`.
  - Step 9: `/../../etc/passwd` sent through `node:http` with a RAW path (never `fetch` — WHATWG URL parsing collapses
    dot segments on the client) → 404; plus a positive control in the same step: `GET /` → 200 and the body contains
    the token. Without the control, deleting the static route leaves step 9 green.
  - Step 10: no token → 401 with `code === TOKEN_REQUIRED`.
  - Step 11: second process with `--bind 192.0.2.1` and no confirmation → non-zero exit carrying the bind refusal's
    code (imported), and `lsof -nP -a -p <pid> -iTCP -sTCP:LISTEN` shows nothing for that pid (carried R13 item 7:
    filter by pid).
  - **Step 12 — `~/.orca` (ruling R56).** The brief says "`ls ~/.orca` still absent". That makes `npm run verify`
    fail forever for any person who has ever run `orca correct` for real — the check would punish the product being
    used. Instead: snapshot `~/.orca` before step 1 (exists? if so, sorted names, sizes and mtimes of every entry,
    recursively) and assert the after-snapshot is identical. On this machine today it is absent, so the check is
    "absent before, absent after". Print which case applied.
  - Every step prints one `PASS <n> <what>` line; the first failure prints `FAIL <n> <what>: <expected> vs <got>` and
    the script exits 1 after teardown. Teardown always runs.
- **L6 — the registered gap.** The commit message registers again (plan Self-Review): `reviews.jsonl` has no
  retention policy and the multi-process duplicate rows are accepted without a criterion.
- **L7 — plan ruling 3 (verify ordering)** is a ledger row the controller writes.

## Mutations the verifier will run (predict each: which STEP fails, and which endToEnd criterion)

| id | change |
|---|---|
| E-1 | `GET /api/decisions` also appends `opened` for every listed decision |
| E-2 | `ReviewsWriter.append` skips its dedupe check (always writes) |
| E-3 | `POST /api/reviews` appends `opened` instead of `reviewed` |
| E-4 | `POST /api/corrections` also closes the loop in the target repo (append overturned rows to its `.decisions/` and commit) |
| E-5 | the already-recorded branch answers the CLI's `err.message` |
| E-6 | `currentMetrics` is computed once in `buildApi` and reused |
| E-7 | the static route is deleted |
| E-8 | the `/api` token middleware is deleted |
| E-9 | `assertBindAllowed` call is deleted from `createPanelServer` |
| E-10 | `web/vite.config.ts` `assetsDir: "."` → `"assets"` |
| E-11 | `parseReadyLine` accepts a line with no `token=` (returns an empty token) |
| R-9b | `ReviewsWriter.append` chmods an existing reviews directory to `0o700` after `mkdir` |

For each: name the step (and message) that fails first and whether any later step would also fail if reached, or
the criterion that reddens. For E-9 answer: what does the second process do on that run — it must fail to bind
(EADDRNOTAVAIL) and publish nothing; if it could bind anything, stop and report instead of predicting.

## Final checks, after the commit

- `rtk proxy npm run verify > <file> 2>&1; echo "VERIFY_RC=$?" >> <file>`, read whole. Report: whole repo
  files/tests, scheduler files/tests, the web build result, `verify:panel` exit and its PASS lines, web check
  files/tests. Report any `skipped`/`todo` count. Report the wall time of the whole verify (from the shell, e.g.
  `date +%s` before/after) — it now includes a frontend build.
- Run `npm run verify:panel` a SECOND time on its own (redirected, read whole) to show it is repeatable and leaves no
  residue: before/after `ps -axo pid,ppid,pgid,command`, `lsof -nP -iTCP -sTCP:LISTEN`, and a listing of
  `$TMPDIR` entries the script creates (it must remove its own).
- `/usr/bin/git status --porcelain -z > <file>; wc -c < <file>` — non-zero only because of controller files under
  `.superpowers/sdd/2026-09-10-panel-e3/`. `web/dist` must be ignored (root `.gitignore` has `dist/`) — confirm it does
  not appear.
- `/usr/bin/git diff <BASE> HEAD --stat` → no `Bin` line. Byte scan of touched files → all 0. `ls ~/.orca` → absent.
- Stage by explicit path. Commit trailer names the model you actually are. Mutation reds in the message are predictions.

## Report

Write the full report to
`/Users/biran/code/skills/loop/Orca/.superpowers/sdd/2026-09-10-panel-e3/task-9-report.md`: the L1 answer, the L5
measurements (repo key, dist listing), every mutation prediction, the verify tiers and timing, the repeat run with its
census, porcelain, diffstat, byte-scan counts, `ls ~/.orca`, and every deviation with its reason. Final reply SHORT:
status, commit sha(s), one-line summary, concerns.
