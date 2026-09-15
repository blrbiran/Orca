# Task 3 — independent mutation verification

You did NOT write this code. MEASURE whether each criterion can go red; do not fix anything, and do not improve
anything you dislike. **A fully green mutation is a finding, not a failure — say it plainly.** Task 1 shipped a
`--by` guard that no criterion pinned; the only reason anyone knows that is a verifier who reported a green.

Repo: `/Users/biran/code/skills/loop/Orca`. **The commit under test is named in your dispatch message.**
Read `/Users/biran/code/skills/loop/Orca/CLAUDE.md` Rules 9, 14, 15, 17 first. The implementer's report is
`.superpowers/sdd/2026-09-10-panel-e3/task-3-report.md` — use it to find the exact criterion names and which files
they live in; trust nothing else in it.

Code under test: `src/panel/token.ts`, `src/panel/bindGuard.ts`, `src/panel/server.ts`, `src/panel/rejection.ts`.
Criteria: `tests/panel/security.test.ts` (plus anything else the report names).

## Hard rules

- **The main tree is never touched.** Before and after the whole run:
  `/usr/bin/git -C /Users/biran/code/skills/loop/Orca status --porcelain -z > <file>; wc -c < <file>` and
  `/usr/bin/git -C … rev-parse HEAD`. Always `/usr/bin/git` (a hook rewrites plain `git` through rtk, which prints
  `ok` for empty output).
  ⚠️ Porcelain is expected to be non-zero: `.superpowers/sdd/2026-09-10-panel-e3/progress.md` is the controller's
  ledger and is being written while you work. What matters is that **nothing under `src/`, `tests/`, `web/` or
  `.decisions/` appears in it**, and that the list is otherwise identical before and after.
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
- Run: `cd "${C:?}" && ./node_modules/.bin/vitest run tests/panel > <out> 2>&1; echo "RC=$?" >> <out>`.
  Read outputs WHOLE; never pipe, grep, tail or sed a verifying run. Confirm the vitest `RUN` line points **into the
  clone**.
- A compile/collection error is a **broken mutation**, not a red.
- Teardown: `cmp` the clone's `tests/panel/security.test.ts` against the main tree's (identical — proof no mutation
  leaked into a criterion), then `/bin/rm -rf "$(dirname "${C:?}")"` (local `rm` is aliased to `-i`).
- **Baseline first**: unmutated clone, same run, all green expected. If not, stop and report.

## ⚠️ Safety, and it is not a formality

One criterion drives a real `orca panel` process against `192.0.2.1` (RFC 5737 TEST-NET-1), an address that is on no
interface of this machine. That is deliberate: on the run where the bind guard is deleted, the process tries to bind
it and fails with `EADDRNOTAVAIL`, publishing nothing. **If you ever find yourself about to substitute `0.0.0.0` or
any real address for it — stop and report instead.** That substitution would really publish a service that reads a
person's global data on every interface. Do not add such a mutation, and do not "fix" a criterion in that direction.

Also: every child process the criteria spawn must carry a redirected `ORCA_CORRECTIONS_DIR`. If you see a run touch
`~/.orca`, that is a finding — check `ls ~/.orca` before and after your whole run and report both.

## Mutations

Predictions are hypotheses written by other people. Where your measurement differs, do NOT declare a false red —
investigate with the three questions and report which explains it: (1) does an earlier assertion in that criterion
short-circuit before the named one? (2) who else walks the deleted line? (3) where does the literal in the named
assertion come from — which field, which constant?

| id | change | prediction (measure it) |
|---|---|---|
| P-1 | `src/panel/bindGuard.ts`: replace the whole body of `assertBindAllowed` with `return;` | red in the unit criterion that refuses a non-loopback bind by name **and** in the real-process criterion — two. Measure whether the real-process one reddens on the refusal code or on something else |
| P-10 | `src/panel/server.ts`: in `parsePanelArgs`, replace the missing-`by` refusal with a default `by = "panel"` | red in the criterion requiring `--by` on loopback, **and** in the CLI-level `--by` criterion the implementer added under ruling E3 — measure both |
| P-10b | `src/panel/server.ts`: delete the entire `if (by === undefined \|\| by.length === 0) { throw … }` block (no default, no throw) | **This is the carried ruling R18 mutation and the reason this seat exists.** Task 1's identical guard was deleted and every criterion stayed green. Predict red in the same two criteria as P-10; if anything stays green, say so loudly |
| P-11 | `src/panel/token.ts`: `tokenMatches` returns `true` unconditionally | red in the token criterion and only it |
| P-12 | `src/panel/token.ts`: `mintToken` returns a fixed 64-character hex literal instead of `randomBytes(32).toString("hex")` | red in the token criterion (the two mints must differ) and only it. ⚠️ note whether the `/^[0-9a-f]{64}$/` assertion still passes — a fixed value that matches the shape is exactly the guess this criterion must catch |
| P-13 | `src/panel/bindGuard.ts`: make `assertBindAllowed` throw unconditionally (delete the early `return` for the allowed case) | red in the negative-control criterion that lets a CONFIRMED external bind through, and only it. Without that control, a guard refusing everything would pass the refusal criterion |

If the implementer's report names criteria this table does not cover, say which are unpinned rather than inventing
mutations for them.

## Report

Per mutation: hash before/after, the diff, RC, the vitest summary lines, and for every failing criterion its **full
name** plus the first assertion failure (expected vs received, file:line). Then "matched" / "differs: <what, and which
of the three questions explains it>" / "measured (no prediction)".

Write the full report to
`/Users/biran/code/skills/loop/Orca/.superpowers/sdd/2026-09-10-panel-e3/task-3-mutations-report.md`.
No subagents. No edits in the main tree except that file.
Final reply SHORT: one line per mutation (id, RC, failing count, matched/differs), the two porcelain readings, and the
two `ls ~/.orca` readings.
