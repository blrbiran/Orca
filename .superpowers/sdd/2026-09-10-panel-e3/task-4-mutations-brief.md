# Task 4 — independent mutation verification

You did NOT write this code. MEASURE whether each criterion can go red; do not fix anything, and do not improve
anything you dislike. **A fully green mutation is a finding, not a failure — say it plainly.** Task 1 shipped a
`--by` guard that no criterion pinned; the only reason anyone knows that is a verifier who reported a green.

Repo: `/Users/biran/code/skills/loop/Orca`. **The commit under test is named in your dispatch message.**
Read `/Users/biran/code/skills/loop/Orca/CLAUDE.md` Rules 9, 14, 15, 17 first. The implementer's report is
`.superpowers/sdd/2026-09-10-panel-e3/task-4-report.md` — use it to find the exact criterion names, the files they
live in, and the implementer's predictions; trust nothing else in it.

Code under test: `src/panel/staticFiles.ts`, `src/panel/server.ts` (`parsePanelArgs`).
Criteria: `tests/panel/staticFiles.test.ts`, `tests/panel/security.test.ts`.

## Hard rules

- **The main tree is never touched.** Before and after the whole run:
  `/usr/bin/git -C /Users/biran/code/skills/loop/Orca status --porcelain -z > <file>; wc -c < <file>` and
  `/usr/bin/git -C … rev-parse HEAD`. Always `/usr/bin/git` (a hook rewrites plain `git` through rtk, which prints
  `ok` for empty output).
  ⚠️ Porcelain may be non-zero: `.superpowers/sdd/2026-09-10-panel-e3/progress.md` is the controller's ledger and may
  be written while you work. What matters is that **nothing under `src/`, `tests/`, `web/` or `.decisions/` appears in
  it**.
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
- Teardown: `cmp` the clone's `tests/panel/staticFiles.test.ts` and `tests/panel/security.test.ts` against the main
  tree's (identical — proof no mutation leaked into a criterion), then `/bin/rm -rf "$(dirname "${C:?}")"` (local
  `rm` is aliased to `-i`).
- **Baseline first**: unmutated clone, same run, all green expected. If not, stop and report.
- **Process census around every run** (this round repairs a leak): before and after each vitest run, record
  `ps -axo pid,ppid,pgid,command > <file>` and report every process whose command contains `src/cli.ts` or `tsx`
  that exists after the run but not before. Kill a leftover only after recording it, and say you did.

## ⚠️ Safety, and it is not a formality

One criterion drives a real `orca panel` process against `192.0.2.1` (RFC 5737 TEST-NET-1), an address that is on no
interface of this machine. That is deliberate: on the run where the bind guard is deleted, the process tries to bind
it and fails with `EADDRNOTAVAIL`, publishing nothing. **If you ever find yourself about to substitute `0.0.0.0` or
any real address for it — stop and report instead.** Do not add such a mutation, and do not "fix" a criterion in that
direction.

Every child process the criteria spawn must carry a redirected `ORCA_CORRECTIONS_DIR`. Check `ls ~/.orca` before
and after EVERY mutation and report each reading — it must be absent every time.

## Mutations

Predictions below are the controller's hypotheses; the implementer's report has its own. Where your measurement
differs from either, do NOT declare a false red — investigate with the three questions and report which explains it:
(1) does an earlier assertion in that criterion short-circuit before the named one? (2) who else walks the deleted
line? (3) where does the literal in the named assertion come from — which field, which constant?

| id | change | controller prediction (measure it) |
|---|---|---|
| S-12 | `staticFiles.ts`: `get` reads `readFileSync(join(dir, name))` from disk (returning `{ bytes, contentType: contentTypeOf(name) }`, `undefined` on any throw) instead of `assets.get(name)` | red in the traversal-spelling criterion and the flat-names criterion (its `linked.txt` half) — two. Report WHICH spellings resolved (instrument with a probe in the clone if the assertion message does not show it). The plan's table claims `index.js/` resolves; the controller doubts it (ENOTDIR) — measure |
| S-13 | `staticFiles.ts`: delete `if (!entry.isFile()) continue;` | red in the flat-names criterion only |
| S-14 | `staticFiles.ts`: store index.html unchanged (no `replace`, anchor left in) | red in the token-injection criterion only |
| S-15 | `staticFiles.ts`: delete the `panel-token-anchor-missing` throw | red in the anchor-missing criterion only |
| S-16 | `staticFiles.ts`: in the ENOENT branch return an empty `StaticFiles` (`get: () => undefined`, `indexHtml: undefined`, `names: []`) instead of throwing `panel-dist-missing` | red in the dist-missing criterion only |
| S-17 | `staticFiles.ts`: delete the `if (… !== "ENOENT") throw err;` line | red in the non-ENOENT criterion only |
| S-18 | `staticFiles.ts`: `contentTypeOf`'s fallback becomes `"text/html; charset=utf-8"` | red in the unknown-extension criterion only |
| M-1 | `server.ts` `parsePanelArgs`: delete the `malformed-port` check | red in the `--port` refusal criterion only |
| M-2 | `server.ts` `parsePanelArgs`: delete the `malformed-repo-argument` check | red in the `--repo` refusal criterion only |
| P-10b | `server.ts` `parsePanelArgs`: delete the entire missing-`by` refusal block (no default, no throw) — Session 2's mutation, re-run against the new teardown | red in the parse-level `--by` criterion and the CLI-level `--by` criterion — two. **The point of this row is the census**: report how long the CLI-level criterion took, what its failure message says, and whether ANY `tsx`/`src/cli.ts` process survived the run |
| P-10 | `server.ts` `parsePanelArgs`: replace the missing-`by` refusal with a default `by = "panel"` | same two criteria; same census |

If the implementer's report names criteria this table does not cover, say which are unpinned rather than inventing
mutations for them.

## Report

Per mutation: hash before/after, the diff, RC, the vitest summary lines, and for every failing criterion its **full
name** plus the first assertion failure (expected vs received, file:line). Then "matched" / "differs: <what, and which
of the three questions explains it>". For P-10/P-10b add the census rows.

Write the full report to
`/Users/biran/code/skills/loop/Orca/.superpowers/sdd/2026-09-10-panel-e3/task-4-mutations-report.md`.
No subagents. No edits in the main tree except that file.
Final reply SHORT: one line per mutation (id, RC, failing count, matched/differs, leftover processes), the two
porcelain readings, and whether `~/.orca` was absent every time.
