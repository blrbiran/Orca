# Task 5 — controller notes (binding; they override the brief where they conflict)

Read after `task-5-brief.md`. The brief is the requirements; these notes are rulings on points where the brief is
ambiguous, stale, self-contradictory, or predicted to break. Every "measure" below means: run it, redirect to a file,
read the file whole. Never pipe or grep a verifying run.

⚠️ This brief is written as "criterion outlines, filled in at execution" (plan L2799). Several outlines are empty
`it(...)` bodies. **Every `it` you land must assert something that a named mutation below can turn red.** An empty
or assertion-free `it` is a defect, not a placeholder.

## General

- Repo `/Users/biran/code/skills/loop/Orca`, branch `main`. **BASE is given in your dispatch message.** Commit
  locally only. **Never push, branch, merge, or touch a worktree.**
- Use `/usr/bin/git` for every git command (plain `git` is rewritten through rtk, which prints `ok` for empty output).
- Scratch files in `mktemp -d` or
  `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/bad904b1-ce92-4d72-ba96-b4f32d3e0087/scratchpad/`.
  The brief's `/tmp/*.txt` fixed names are NOT to be used.
- `/bin/rm` (local `rm` and `cp` are aliased to `-i`); guard every variable in a destructive command with
  `"${VAR:?msg}"`.
- Code, comments, CLI help and commit messages in English.
- **You do NOT run the named mutations.** An independent verifier runs them after review. You DO run the brief's
  Step 7 survey grep and paste its output into your report, and write a prediction for every mutation listed below.
- **No subagents. Do not write to `.decisions/`** (the plan's ruling 1 row is the controller's job). Do not touch
  `.superpowers/sdd/**` except your own report file.

## Rulings

- **G1 — wire the server now (carried rulings R26, R30).** `src/panel/server.ts` currently has comments where
  `loadStaticFiles` and `buildApi` land. The brief's Files list omits `server.ts`; that is stale. In
  `createPanelServer`, after the token is minted and reviews are loaded and BEFORE `listen()`:
  `const statics = await loadStaticFiles(opts.distDir, token);` then `buildApi(app, { opts, token, reviews,
  statics })` after `express.json`. Replace the two comments; do not leave a comment describing a wiring that now
  exists. Consequence you must account for: every in-process server a criterion starts needs a `distDir` fixture
  (there is no `web/dist` in this repo) — build one in a temp dir with an `index.html` carrying `TOKEN_ANCHOR`.
- **G2 — `TOKEN_REQUIRED` is imported from `./rejection.js`, never redeclared** (carried rulings R5/R29). The brief's
  `api.ts` block declares it again; delete that line. `src/panel/rejection.ts` needs no change for this.
- **G3 — one clock (carried ruling R1; settles plan L2928-2930 decide-point 1 as INJECT).** Add
  `now?: () => Date` to `PanelOptions` (default wall clock; `parsePanelArgs` does not set it). `currentMetrics`
  passes `now: () => (opts.now ?? (() => new Date()))().toISOString()` into `collect` (its `now` is `() => string`).
  The pass-through criterion builds its own expected report with `computeMetrics(await collect({ …same options, now:
  <same fixed clock> }))` and deep-equals the WHOLE `report` — no stripping of `as_of`/`as_of_mode`. Task 7 will
  use the same `opts.now` for correction `at`; do not add a second clock option.
- **G4 — the static route needs HTTP-level criteria (plan mutation table L2747, external review C-2).** The brief's
  Step 1 has none; the plan's correction section says they were added — they were not. Add:
  1. `serves the token-injected index.html at /` — GET `/` with NO token header answers 200, content type
     `text/html; charset=utf-8`, and the body contains `started.token` exactly once.
  2. `answers 404 for every traversal spelling over HTTP` — for at least `/../../etc/passwd`, `/..%2f..%2fetc%2fpasswd`,
     `/%2e%2e/`, `/./index.js`, `/subdir/index.js`, `/linked.txt` (symlink out of the fixture dist) and `/nope.js`:
     status 404.
     🔴 **Do NOT send these with `fetch`.** WHATWG URL parsing collapses `..`, `.` AND `%2e%2e` dot segments on the
     CLIENT, so `fetch` would request `/etc/passwd` or `/index.js` and the criterion would test the URL parser, not
     the server. Use `node:http`'s `request` with a raw `path` string, and assert in the criterion (or a probe you
     report) that the server's `req.url` really was the raw spelling — e.g. one spelling that WOULD resolve if
     normalised (`/./index.js`) must get 404, while `/index.js` gets 200 (positive control in the same criterion).
- **G5 — P-2 reddens TWO criteria, not one** (plan L2733 corrects the brief's table): Task 3's
  `defaults the bind address to the literal 127.0.0.1` and this task's `binds the literal 127.0.0.1 by default`.
  Predict both.
- **G6 — no criterion may resolve to the real `~/.orca` (Rule 17).** The brief's P-2 criterion calls
  `parsePanelArgs([...], {})`: with an empty env, `correctionsDir({})` resolves to the real `~/.orca`, and
  `createPanelServer` then loads reviews from it. **Pass `{ ORCA_CORRECTIONS_DIR: <temp dir> }` as the env.** Same for
  every server a criterion starts. After your run, `ls ~/.orca` must still print "No such file or directory".
- **G7 — the brief's P-2 criterion must stay safe on the run where a guard is deleted.** It goes through
  `parsePanelArgs` (so `bind` is the literal default, never `undefined` → every interface). Keep that; never build the
  options object by hand with `bind` omitted. `0.0.0.0` appears nowhere (Global Constraint 6). Answer in the report:
  *on the run where the bind guard is deleted (P-1) and on the run where the default is TEST-NET-1 (P-2), what does
  this criterion bind, and does it close?*
- **G8 — every in-process server is closed in `finally`.** A thrown assertion must not leave a listener. Report
  `ps`/`lsof` evidence after your final run that no panel listener survived.
- **G9 — the skip gate is a criterion, not a grep (carried ruling R7).** Create `tests/panel/noSkips.test.ts`:
  - It reads every `tests/panel/*.ts` file (and `web/tests/*` if present), **strips comments first**, then asserts
    no `it.skip`, `test.skip`, `describe.skip`, `it.todo`, `test.todo`, `describe.todo`, `xit(`, `xtest(`,
    `xdescribe(`.
  - The scanner is a function the criterion also runs on inline samples: a **must-catch** set (one per spelling, plus
    one with whitespace like `it .skip (`) and a **must-not-catch** set (the spelling inside a `//` comment, inside a
    `/* */` block, and a word like `submit.skipped` or `exit(`).
  - 🔴 **The scanner must not flag its own file.** Its must-catch samples are strings in `noSkips.test.ts`, which is
    itself under `tests/panel/`. Build the sample strings so the file's own text never contains a matching spelling
    (e.g. concatenation), and do NOT solve it by excluding the file from the scan. Say in the report how you avoided
    it and show the scan of its own file came back clean.
  - The brief's Step 5–6 `grep` for `it.skip` is superseded by this criterion; there is no Task 3 `it.skip` to open
    (ruling R27 landed Task 3 without one — measure it).
- **G10 — coverage criteria must each pin one branch of `computePanelCoverage`** (Rule 9). Required, with a pure
  fixture (no server): (a) `reviewed` twice on one high-tier decision counts once; (b) many `opened` rows add zero;
  (c) a `reviewed` row on a LOW-tier decision adds zero to the numerator and the decision is not in the denominator;
  (d) `rate` is `null` (not `0`) with zero high-tier decisions; (e) a `reviewed` row whose `projectKey` differs from
  the decision's (same `decisionId`) adds zero — the projectKey+id join is E2's measured lesson (clones share ids).
  Use `isHighTier` from `src/metrics/highTier.ts` to choose which kinds/scopes are high tier; do not hard-code a
  table.
- **G11 — the gate criteria.** `re-runs … on EVERY request` creates the breaking fixture AFTER the server is up
  (the brief's comment is right; keep it). `answers a broken gate with a first-class error` asserts status 409, body
  `code` equals the imported `UNRESOLVED_PROJECT_KEYS` constant from `src/metrics/discover.ts` (not a retyped
  literal), and `"report" in body === false`. `answers 401 …` asserts 401 and `code === TOKEN_REQUIRED` for no
  header AND for a wrong token, and a 200 for the right one in the same criterion (positive control).
- **G12 — the plan's own ruling 1 (panel coverage alongside E2's, E2's `compute.ts`/`types.ts` untouched)** is a
  ledger row the controller writes. You only confirm in the report that `src/metrics/**` has zero diff.
- **G13 — Express error handler registration order.** Keep the four-argument handler last. State in a comment in
  `buildApi` that Tasks 6/7 add routes before it (the brief says this; make it a code comment, not only prose).

## Mutations the verifier will run (predict each; run the survey greps first)

| id | change |
|---|---|
| G-11 | brief: compute `currentMetrics` once in `buildApi` and reuse it on every request |
| P-2 | brief: `parsePanelArgs` default bind `?? "127.0.0.1"` → `?? "192.0.2.1"` |
| T-8 | brief: delete the `/api` token middleware |
| S-12b | plan L2747: delete the whole `app.get(/.*/ …)` static route |
| K-1 | `currentMetrics` stops passing `now` to `collect` (wall clock) |
| E-1 | error handler answers `MetricsRejection` with status 200 and `{ report: null, code, message }` |
| C-1 | `computePanelCoverage`: delete `if (r.action !== "reviewed") continue;` |
| C-2 | `computePanelCoverage`: `rate: highTier.size === 0 ? 0 : …` |
| C-3 | `computePanelCoverage`: count reviewed rows in an array (`push`) instead of a `Set` |
| C-4 | `computePanelCoverage`: drop the `highTier.has(key)` condition |
| C-5 | `computePanelCoverage`: key reviews by `decisionId` alone (both sets keyed by id only) |
| N-1 | `noSkips` scanner: remove the `.todo` spellings from its pattern |
| N-2 | `noSkips` scanner: skip the comment-stripping step |
| W-1 | `createPanelServer`: pass an empty `StaticFiles` into `buildApi` instead of the loaded one |

For each use "red in X and only X" or "red in X and Y" — never "at least". Before each, answer: (1) does an earlier
assertion short-circuit before the named one? (2) who else walks the deleted line? (3) where does the literal in the
named assertion come from? For every mutation that deletes a guard, also answer: *what does the criterion do on that
run — does anything listen, and does it close?*

## Final checks, after the commit

- `rtk proxy npm run verify > <file> 2>&1; echo "VERIFY_RC=$?" >> <file>`, read whole; report the three tiers
  separately (whole repo / `verify:scheduler` / `@orca/web check`). Baseline at BASE is given in your dispatch.
  Also report whether the vitest summary shows any `skipped` or `todo` count.
- `/usr/bin/git status --porcelain -z > <file>; wc -c < <file>` — non-zero ONLY because of
  `.superpowers/sdd/2026-09-10-panel-e3/progress.md` and your report. List what you saw.
- `/usr/bin/git diff <BASE> HEAD --stat -- src/metrics` → must be empty (G12).
- `ls ~/.orca` → must still be absent; paste the output. `ps` for leftover `tsx`/panel processes; paste.
- Stage by explicit path. Commit trailer names the model you actually are:
  `Co-Authored-By: <model name> <noreply@anthropic.com>`.
- The commit message states facts true at the commit: no mutation "seen red", no "Task 3 skip opened".

## Report

Write the full report to
`/Users/biran/code/skills/loop/Orca/.superpowers/sdd/2026-09-10-panel-e3/task-5-report.md`: the Step 2 measured red,
the G4 raw-path evidence, the G7 answer, the G9 self-scan answer, the survey greps, every mutation prediction with the
three answers, the three verify tiers, the porcelain listing, the `src/metrics` diff, the `ls ~/.orca` output, the
leftover-process check, and every deviation with its reason. If you could not witness something, say
"not witnessed". Final reply SHORT: status, commit sha(s), one-line test summary, concerns.
