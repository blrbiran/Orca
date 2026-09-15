# Task 9 — independent mutation verification of the success criterion

You did NOT write this code. MEASURE whether the success criterion (`npm run verify:panel`) and the new criteria can go
red; do not fix anything. **A mutation under which `verify:panel` still exits 0 is a finding, not a failure — say it
plainly.**

Repo: `/Users/biran/code/skills/loop/Orca`. **The commit under test is named in your dispatch message.**
Read `CLAUDE.md` Rules 4, 9, 14, 15, 17. The implementer's report is `.superpowers/sdd/2026-09-10-panel-e3/task-9-report.md`
(step names, predictions — trust nothing else). Controller rulings: `task-9-controller-notes.md`.

## Hard rules

**Exactly the "Hard rules" section of `task-6-mutations-brief.md` in the same directory** — apply every item (clone
per mutation with both node_modules symlinks, exactly-once anchors, sha256 before/after, diff, byte-scan after every
edit and never type NUL-class escapes literally, whole-file reads, compile/collection error = broken mutation, `cmp`
of every criterion file clone vs main tree, `/bin/rm -rf` of the clone, baseline first, process + listener census,
`ls ~/.orca` before/after, loopback only). Porcelain of the main tree may be non-zero only because of controller
files under `.superpowers/sdd/2026-09-10-panel-e3/` and `.decisions/orca-dev-5d5c8055.jsonl`; the byte count must be
the same before and after. Never `git stash` or write in the main tree.

**Runners, per mutation, in the clone** (each redirected to its own file, read whole):
1. `cd "${C:?}" && npm run build --workspace web > <f> 2>&1; echo RC=$? >> <f>` — once per clone, BEFORE applying a
   mutation unless the mutation is E-10 (which changes the build config, so build after applying it).
2. `cd "${C:?}" && npm run verify:panel > <f> 2>&1; echo RC=$? >> <f>` — the success criterion. Report its RC, every
   `PASS`/`FAIL` line, and the first `FAIL`.
3. For E-11 and R-9b only: `./node_modules/.bin/vitest run tests/panel > <f> 2>&1`.
Around runner 2, the census is mandatory: `ps -axo pid,ppid,pgid,command` and `lsof -nP -iTCP -sTCP:LISTEN` before and
after, plus a listing of the `$TMPDIR` entries whose names the script uses (read the script for its `mkdtemp` prefixes)
before and after — the script must remove its own. A leftover is a finding even when the mutation reddened.

## ⚠️ Safety

- E-9 deletes the external-bind guard. Before running it, read the script's step 11 and confirm the address it
  passes is `192.0.2.1` (TEST-NET-1, on no interface of this machine; `ifconfig -a > <f>` and read it to confirm).
  If the script would pass any other non-loopback address, do not run E-9 — report why.
- E-4 makes the panel close the loop into the script's throwaway target repo. Confirm from the script source that the
  repo lives under `$TMPDIR` before running it; afterwards confirm this repository's HEAD and porcelain did not move.
- If any run leaves a listening process, kill it only after recording it, and say so.

## Mutations

Where your measurement differs from both predictions, investigate with the three questions before concluding: (1) an
earlier step fails first; (2) who else walks the changed line; (3) where the compared value comes from.

| id | change | controller prediction (measure it) |
|---|---|---|
| E-1 | `GET /api/decisions` also appends `opened` (panel clock, `--by`) for every listed decision, fire-and-forget | FAIL at step 2 (opened must stay 0 over the window) |
| E-2 | `ReviewsWriter.append` skips its dedupe check (always writes) | FAIL at step 4 (a second `opened` row for the same decision) |
| E-3 | `POST /api/reviews` appends `action: "opened"` instead of `"reviewed"` | FAIL at step 5 |
| E-4 | `POST /api/corrections` also closes the loop into the target repo (append the closing rows to its `.decisions/` and commit) | FAIL at step 6 (the `.decisions/` snapshot or HEAD) |
| E-5 | the already-recorded branch answers the CLI's `err.message` | FAIL at step 7 |
| E-6 | `currentMetrics` computed once in `buildApi` and reused | FAIL at step 8 (the gate is not re-evaluated) — or earlier if a stale report breaks step 5's coverage check; say which |
| E-7 | the static route is deleted | FAIL at the step 9 positive control (`GET /` → 200) |
| E-8 | the `/api` token middleware is deleted | FAIL at step 10 |
| E-9 | the `assertBindAllowed` call is deleted from `createPanelServer` | FAIL at step 11 (the second process fails with EADDRNOTAVAIL instead of the named bind refusal); nothing listens |
| E-10 | `web/vite.config.ts` `assetsDir: "."` → `"assets"` | FAIL at the pre-start flat-dist check |
| E-11 | `parseReadyLine` accepts a line with no `token=` (returns an empty token) | red in the endToEnd.test.ts missing-token must-catch criterion; `verify:panel` itself stays green (the real CLI line has a token) |
| R-9b | `ReviewsWriter.append` chmods an existing reviews directory to `0o700` after `mkdir` | red in reviewsStore.test.ts's already-existing-directory-mode criterion only |

If the implementer's report names steps or criteria this table does not cover, say which are unpinned.

## Report

Per mutation: hashes, diff, build RC (when run), `verify:panel` RC with its PASS/FAIL lines, vitest summary for
E-11/R-9b, "matched" / "differs: <what, which question explains it>", the census before/after, `ls ~/.orca` readings,
byte-scan counts. For E-9, the `ifconfig` confirmation and the listener census. For E-4, the fixture path and this
repository's unchanged HEAD/porcelain.

Write it to `/Users/biran/code/skills/loop/Orca/.superpowers/sdd/2026-09-10-panel-e3/task-9-mutations-report.md`.
No subagents. No edits in the main tree except that file. Final reply SHORT: one line per mutation, porcelain before/
after, `~/.orca` readings, leftovers.
