# E3 final fix wave — independent mutation verification

You did NOT write this code. MEASURE whether each new criterion can go red; do not fix anything. **A fully green
mutation is a finding — say it plainly.**

Repo `/Users/biran/code/skills/loop/Orca`. **The commit under test is named in your dispatch message.** Read `CLAUDE.md`
Rules 9, 14, 15, 17. The implementer's report is `.superpowers/sdd/2026-09-10-panel-e3/final-fix-report.md` (criterion
names, files, predictions — trust nothing else). Requirements: `final-fix-notes.md`.

## Hard rules

**Exactly the "Hard rules" section of `task-6-mutations-brief.md`** in the same directory, applied in full (clone per
mutation, both node_modules symlinks, exactly-once anchors, sha256 before/after, diff, byte-scan after every edit and
never type NUL-class or U+001F escapes literally, whole-file reads with the `RUN` line inside the clone,
compile/collection error = broken mutation, `cmp` of every criterion file clone vs main tree, `/bin/rm -rf` of the
clone, baseline first, process + listener census, `ls ~/.orca` before/after, loopback only). Never `git stash` or
write in the main tree; its porcelain may show only the controller's two files and must be byte-identical before and
after.

Runners (each redirected, read whole): root `./node_modules/.bin/vitest run tests/panel`; web
`cd "${C:?}/web" && ../node_modules/.bin/vitest run`; for HG-1 also `npm run build --workspace web && npm run
verify:panel` with the ps/lsof/$TMPDIR census around it.

## Mutations

Where your measurement differs from the implementer's prediction, investigate with the three questions: (1) an
earlier assertion short-circuits; (2) who else walks the changed line; (3) where the compared literal comes from.

| id | change |
|---|---|
| RK-1 | reviews dedupe `key()` drops `projectKey` again |
| EB-1 | remove the body-parser error mapping (parse failures fall to the 500 fallback) |
| EB-2 | remove the non-object body refusal |
| EB-3 | map the corrections store-busy `CorrectRejection` back to 400 |
| UI-1 | `correctionBody` sends `chose_instead: ""` for a blank box |
| UI-2 | the refusal view drops `message` |
| UI-3 | the "record another" control renders regardless of `retry_field` |
| UI-4 | the error page shows only the status |
| HG-1 | delete the Host allowlist middleware (run the root criteria AND verify:panel) |
| HG-2 | the Host check accepts any hostname that ends with `localhost` |

For HG-1 and HG-2: the criteria send a hostile Host header to a loopback server — confirm from the criterion source
that nothing but loopback is ever bound before running.

## Report

Per mutation: hashes, diff, RCs, summary lines, each failing criterion's full name with its first assertion failure
(expected vs received, file:line), "matched" / "differs: <what, which question>". Census, `~/.orca` readings,
byte-scan counts.

Write it to `/Users/biran/code/skills/loop/Orca/.superpowers/sdd/2026-09-10-panel-e3/final-fix-mutations-report.md`.
No subagents. Final reply SHORT: one line per mutation, porcelain before/after, `~/.orca` readings, leftovers.
