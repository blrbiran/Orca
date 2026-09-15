# Task 4 — controller notes (binding; they override the brief where they conflict)

Read after `task-4-brief.md`. The brief is the requirements; these notes are rulings on points where the brief is
ambiguous, stale, self-contradictory, or predicted to break. Every "measure" below means: run it, redirect to a file,
read the file whole. Never pipe or grep a verifying run.

## General

- Repo `/Users/biran/code/skills/loop/Orca`, branch `main`. **BASE is given in your dispatch message.** Commit
  locally only. **Never push, branch, merge, or touch a worktree.**
- Use `/usr/bin/git` for every git command (plain `git` is rewritten through rtk, which prints `ok` for empty output).
- Scratch files in `mktemp -d` or
  `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/bad904b1-ce92-4d72-ba96-b4f32d3e0087/scratchpad/`.
  The brief's `/tmp/t4.txt` and `/tmp/whoS.txt` fixed names are NOT to be used.
- `/bin/rm` (local `rm` and `cp` are aliased to `-i`); guard every variable in a destructive command with
  `"${VAR:?msg}"`.
- Code, comments, CLI help and commit messages in English.
- **You do NOT run the named mutations.** An independent verifier runs them after review. You DO run the brief's
  Step 5 survey grep and paste its output into your report, and you write a prediction for every mutation listed
  under "Mutations the verifier will run" below.
- **No subagents. Do not write to `.decisions/`.** Do not touch `.superpowers/sdd/**` except your own report file
  (`progress.md` is the controller's ledger and is dirty on purpose while you work — leave it alone).

## Part A — the brief (static files)

- **F1 — do NOT wire `loadStaticFiles` into `createPanelServer` in this task.** `src/panel/server.ts:93-95` carries a
  comment saying Task 4 wires it in. Measured: the only consumer of the loaded files is the static route inside
  `buildApi` (Task 5, plan's `ApiDeps.statics`). Wiring it now would load a value nothing reads, and would make every
  `orca panel` start fail with `panel-dist-missing` (there is no `web/dist` in this repo) — changing what Task 3's
  real-process mutations observe, for no consumer. **Ruling: land `staticFiles.ts` and its criteria only; change
  that one comment in `server.ts` so it is true at this commit** (the module exists as of Task 4; Task 5 loads it and
  hands it to `buildApi`). One comment edit, nothing else in `server.ts` for Part A.
- **F2 — the brief's S-12 rationale is wrong and must not reach the commit message** (carried ruling R6). The fixture
  never creates `subdir/`, so `subdir/index.js` cannot be what reddens under S-12. Keep `"subdir/index.js"` in the
  traversal list (it is a legitimate spelling to pin as absent), but do not cite it as the catching entry anywhere —
  not in comments, not in the commit message. Also do not claim `../../etc/passwd` or `/etc/passwd` reaches a real
  file. Rewrite the commit message's "Honest note" paragraph to say which entries you PREDICT catch S-12 and that an
  independent verifier measures it — never "go red" as if seen.
- **F3 — every branch in `staticFiles.ts` needs a criterion that only it can fail (CLAUDE.md Rule 9).** The brief
  pins four of them. Add these three criteria to `tests/panel/staticFiles.test.ts` (same `describe`, same fixture
  style, redirected temp dirs only):
  1. **token anchor missing** → `loadStaticFiles` rejects with `code: "panel-token-anchor-missing"` when `index.html`
     exists without `TOKEN_ANCHOR`. (The brief implements this refusal and pins nothing on it.)
  2. **non-ENOENT readdir failure is not relabelled** → point `distDir` at a regular FILE; it must reject, and the
     rejection must NOT have `code: "panel-dist-missing"` (assert the actual errno code you measure, e.g.
     `ENOTDIR`). Without this, deleting the `!== "ENOENT"` rethrow turns every disk error into "run the build first".
  3. **unknown extension is never guessed** → a file with an extension absent from `CONTENT_TYPES` (e.g. `notes.txt`)
     is served with exactly `application/octet-stream`. Put it in the fixture of that criterion only, or update the
     sorted-names criterion's expected list consistently — your choice, state which in the report.
- **F4 — the Map criterion and the symlink.** Keep the brief's comments. Answer in the report: under S-12, which
  entries of the traversal list do you predict resolve, and why `index.js/` does or does not (measure what
  `readFileSync` does with a trailing slash on this machine in a scratch dir if you are unsure — that is a probe,
  not a mutation).

## Part B — two debts carried from Task 3 (separate commit)

- **F5 — the real-process criteria owe a teardown.** Measured by Session 2's verifier: under mutations P-10 and
  P-10b, `tests/panel/security.test.ts`'s CLI-level criteria wait out vitest's 20s timeout while the `tsx src/cli.ts
  panel` child keeps listening on loopback; vitest fails the criterion but never kills the child. `tsx` 4.23.13 runs
  the script in a CHILD node process (so killing only the `tsx` pid can orphan the process that actually listens).
  Required behaviour, not a prescribed implementation:
  - each real-process run has its own deadline shorter than the vitest timeout, and on that deadline the WHOLE
    process tree it started is killed (e.g. spawn `detached: true` and signal the negative pid — your call, justify
    it);
  - an `afterEach` kills anything still alive from that criterion, so a thrown assertion cannot skip the kill;
  - the criterion still fails, with a message that says the child did not exit by itself within the deadline
    (a hang must never read as a pass);
  - the existing assertions (exit code 1, the refusal code in stderr, the lsof block with its E6 comment) keep
    their meaning. Do not weaken any of them.
  - Answer in the report: *on the run where the `--by` guard is deleted (P-10b), what does this criterion now do,
    and what is left running when vitest exits?* The verifier re-runs P-10 and P-10b against your commit and counts
    processes before and after.
- **F6 — `malformed-port` and `malformed-repo-argument` have no criterion anywhere** (Task 3 deferred minor). Add
  criteria at the **`parsePanelArgs` level** (not the real process) in `security.test.ts`:
  - `--port` rejects by name for a non-integer (`abc`), for `-1`, and for `65536`; and accepts `65535` (negative
    control, otherwise a guard refusing every port passes);
  - `--repo` rejects by name for a value with no `=` and for one starting with `=` (`=path`); and accepts
    `k=/some/path` yielding `{ projectKey: "k", path: "/some/path" }`.
  - Supply `--by` in every one of them, or the identity refusal fires first and the criterion observes the wrong
    guard (the exact shape external review C2 caught for the bind guard).
  - Why parse level, answered in advance so you do not "upgrade" it: on the run where the `--repo` check is deleted,
    a real-process criterion would START A SERVER on loopback and hang — the very hazard F5 is repairing. Write that
    reason into the comment.
- The parse-level criteria in F6 pass `{}` or a redirected env; none may resolve to the real `~/.orca`.

## Mutations the verifier will run (write a prediction for each; run the survey greps first)

| id | change | owner |
|---|---|---|
| S-12 | brief Step 5: `get` reads `join(dir, name)` from disk instead of the Map | brief |
| S-13 | delete `if (!entry.isFile()) continue;` | F3/brief |
| S-14 | index.html stored without the replace (anchor left in, no token) | brief |
| S-15 | delete the `panel-token-anchor-missing` throw (fall through with the anchor-less html) | F3.1 |
| S-16 | ENOENT branch returns an empty `StaticFiles` instead of throwing `panel-dist-missing` | brief |
| S-17 | delete the `if (code !== "ENOENT") throw err;` line | F3.2 |
| S-18 | `contentTypeOf` fallback becomes `"text/html; charset=utf-8"` | F3.3 |
| M-1 | delete the `malformed-port` check | F6 |
| M-2 | delete the `malformed-repo-argument` check | F6 |
| T-1 | re-run Session 2's P-10b (delete the `--by` guard) against your commit; count leftover processes | F5 |

For each prediction use the form "red in X and only X" or "red in X and Y" — never "at least". Before each, answer:
(1) does an earlier assertion in that criterion short-circuit before the named one? (2) who else walks the deleted
line? (3) where does the literal in the named assertion come from?

## Final checks, after the commits

- `rtk proxy npm run verify > <file> 2>&1; echo "VERIFY_RC=$?" >> <file>`, read whole; report the three tiers
  separately (whole repo / `verify:scheduler` / `@orca/web check`). Baseline at BASE: whole repo 87 files /
  493 tests, scheduler 51/167, web 1/1, VERIFY_RC=0.
- `/usr/bin/git status --porcelain -z > <file>; wc -c < <file>` — non-zero ONLY because of
  `.superpowers/sdd/2026-09-10-panel-e3/progress.md` and your report. Nothing under `src/`, `tests/`, `web/` or
  `.decisions/` may be dirty. List what you saw.
- `ls ~/.orca` → must still be absent; paste the output.
- `ps` for leftover `tsx`/`src/cli.ts panel` processes after your final verify; paste what you saw.
- Two commits, staged by explicit path:
  1. `feat(panel): …` — `src/panel/staticFiles.ts`, `tests/panel/staticFiles.test.ts`, `src/panel/server.ts`
     (the F1 comment only).
  2. `test(panel): …` — `tests/panel/security.test.ts` (F5 + F6).
- Commit trailer: name the model you actually are, as `Co-Authored-By: <model name> <noreply@anthropic.com>`.
  A trailer naming a model that did not write the commit is a false statement in published text.

## Report

Write the full report to
`/Users/biran/code/skills/loop/Orca/.superpowers/sdd/2026-09-10-panel-e3/task-4-report.md`: the Step 2 measured red
(what the collection error actually says), the F4 answer, the F5 answer and the mechanism you chose with its reason,
the survey greps, every mutation prediction with the three answers, the three verify tiers, the porcelain listing,
the `ls ~/.orca` output, the leftover-process check, and every deviation with its reason. If you could not witness
something (a red, a kill), say "not witnessed" — do not substitute reasoning for an observation.
Final reply SHORT: status, commit shas, one-line test summary, concerns.
