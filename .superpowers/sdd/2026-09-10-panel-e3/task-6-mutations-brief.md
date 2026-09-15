# Task 6 — independent mutation verification

You did NOT write this code. MEASURE whether each criterion can go red; do not fix anything, and do not improve
anything you dislike. **A fully green mutation is a finding, not a failure — say it plainly.**

Repo: `/Users/biran/code/skills/loop/Orca`. **The commit under test is named in your dispatch message.**
Read `/Users/biran/code/skills/loop/Orca/CLAUDE.md` Rules 9, 14, 15, 17 first. The implementer's report is
`.superpowers/sdd/2026-09-10-panel-e3/task-6-report.md` — use it to find the exact criterion names, the files they
live in, and the implementer's predictions; trust nothing else in it. The controller's rulings are in
`task-6-controller-notes.md` (same directory).

Code under test: `src/panel/api.ts`, `src/panel/listProjection.ts`, `src/panel/decisionSource.ts`.
Criteria: everything under `tests/panel/`.

## Hard rules

- **The main tree is never touched.** Before and after the whole run:
  `/usr/bin/git -C /Users/biran/code/skills/loop/Orca status --porcelain -z > <file>; wc -c < <file>` and
  `/usr/bin/git -C … rev-parse HEAD`. Always `/usr/bin/git`.
  ⚠️ Porcelain may be non-zero: files under `.superpowers/sdd/2026-09-10-panel-e3/` are the controller's and may be
  written while you work. What matters is that **nothing under `src/`, `tests/`, `web/` or `.decisions/` appears in it**.
- One shell invocation per mutation — setup, edit, run, teardown:
  ```
  C=$(mktemp -d)/orca
  /usr/bin/git clone --local --quiet /Users/biran/code/skills/loop/Orca "${C:?}"
  /usr/bin/git -C "${C:?}" checkout --quiet <commit from the dispatch message>
  ln -s /Users/biran/code/skills/loop/Orca/node_modules "${C:?}/node_modules"
  ln -s /Users/biran/code/skills/loop/Orca/web/node_modules "${C:?}/web/node_modules"
  ```
- Edits by a python/node script with an **exactly-once anchor assertion** (exit non-zero on 0 or ≥2 matches);
  `shasum -a 256` before/after must differ. **An unchanged hash is a broken run, not a green.** Print the `diff`.
- 🔴 **Never type a NUL-class escape sequence literally** in a script, heredoc or Write (the tool has delivered such
  escapes as raw bytes). After every edit, byte-scan the edited file (count bytes < 0x20 other than tab/LF/CR) and
  report the count; it must be 0.
- Run: `cd "${C:?}" && ./node_modules/.bin/vitest run tests/panel > <out> 2>&1; echo "RC=$?" >> <out>`.
  Read outputs WHOLE; never pipe, grep, tail or sed a verifying run. Confirm the vitest `RUN` line points **into the
  clone**.
- A compile/collection error is a **broken mutation**, not a red. (vitest does not typecheck; a mutation that only
  breaks types still runs.)
- Teardown: `cmp` the clone's every file under `tests/panel/` against the main tree's (identical — proof no mutation
  leaked into a criterion), then `/bin/rm -rf "$(dirname "${C:?}")"` (local `rm` is aliased to `-i`).
- **Baseline first**: unmutated clone, same run, all green expected. If not, stop and report.
- **Process census around every run**: before and after each vitest run, `ps -axo pid,ppid,pgid,command > <file>`;
  report every process whose command contains `src/cli.ts` or `tsx` that exists after but not before. Also
  `lsof -nP -iTCP -sTCP:LISTEN > <file>` after every run; report any node/vitest listener not there before. Report
  any "Unhandled Rejection" / "Unhandled error" block vitest prints even when every test passed.
- `ls ~/.orca` before and after EVERY mutation; report each reading — it must be absent every time.
- No address other than loopback is ever introduced. If you find yourself about to use `0.0.0.0` or a real
  interface address, stop and report.

## Mutations

Predictions are the controller's hypotheses; the implementer's report has its own, and where they differ the
implementer names criteria more precisely. Where your measurement differs from either, do NOT declare a false red —
investigate with the three questions and report which explains it: (1) does an earlier assertion in that criterion
short-circuit before the named one? (2) who else walks the deleted/changed line? (3) where does the literal in the
named assertion come from — which field, which constant?

| id | change | controller prediction (measure it) |
|---|---|---|
| L-3 | list handler also appends an `opened` row (panel clock, `--by`) for every listed decision | red in the list-records-nothing criterion only |
| L-3b | `projectForList` returns `{ ...decision, summary: decision.id.slice(0, 8) }` | red in the frozen-projection criterion only |
| W-6b | detail: the `opened` append becomes `await`ed and moves BEFORE `res.json` | red in the reviews-lock-held criterion only (status: the append waits 1000 ms, throws `PanelRejection`, the error handler answers 409) |
| O-1 | detail: the `opened` append's `.catch` body becomes `() => undefined` | red in the reviews-lock-held criterion only, at its stderr-warning assertion; report whether any unhandled-rejection block appears |
| K-6 | detail: `opened.at` uses `new Date().toISOString()` instead of the panel clock | red in the records-exactly-one-opened criterion only |
| R-6b | detail handler wraps its whole body in `withStoreLock(deps.opts.correctionsDir, …)` from `src/corrections/storeLock.ts` | red in the corrections-lock-held criterion only; report the status it got |
| D-1 | detail: the not-found branch answers 200 `{ decision: null }` | red in the 404 criterion only |
| D-2 | detail: membership and the repo lookup match on decision id alone (projectKey ignored, first match wins) | red in the two-repos-share-an-id criterion AND the 404 criterion (its known-id-under-unconfigured-key request) — two |
| D-3 | detail: skip `currentMetrics`; find the repo with `discoverRepos(deps.opts)` (src/metrics/discover.ts) directly and read from it | red in the broken-gate detail criterion only |

If the implementer's report names criteria this table does not cover, say which are unpinned rather than inventing
mutations for them. If an anchor for a mutation does not exist exactly once because the implementation is shaped
differently, write the smallest edit that has the table's MEANING, say so, and show the diff.

## Report

Per mutation: hash before/after, the diff, RC, the vitest summary lines, and for every failing criterion its **full
name** plus the first assertion failure (expected vs received, file:line). Then "matched" / "differs: <what, and which
of the three questions explains it>". Add the census/listener check, any unhandled-error block, and the byte-scan
count.

Write the full report to
`/Users/biran/code/skills/loop/Orca/.superpowers/sdd/2026-09-10-panel-e3/task-6-mutations-report.md`.
No subagents. No edits in the main tree except that file.
Final reply SHORT: one line per mutation (id, RC, failing count, matched/differs, leftover listeners), the two
porcelain readings, and whether `~/.orca` was absent every time.
