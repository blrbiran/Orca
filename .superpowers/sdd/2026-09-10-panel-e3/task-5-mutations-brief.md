# Task 5 — independent mutation verification

You did NOT write this code. MEASURE whether each criterion can go red; do not fix anything, and do not improve
anything you dislike. **A fully green mutation is a finding, not a failure — say it plainly.** Task 1 shipped a
`--by` guard that no criterion pinned; the only reason anyone knows that is a verifier who reported a green.

Repo: `/Users/biran/code/skills/loop/Orca`. **The commit under test is named in your dispatch message.**
Read `/Users/biran/code/skills/loop/Orca/CLAUDE.md` Rules 9, 14, 15, 17 first. The implementer's report is
`.superpowers/sdd/2026-09-10-panel-e3/task-5-report.md` — use it to find the exact criterion names, the files they
live in, and the implementer's predictions; trust nothing else in it.

Code under test: `src/panel/api.ts`, `src/panel/coverage.ts`, `src/panel/server.ts`, `tests/panel/noSkips.test.ts`'s
scanner. Criteria: everything under `tests/panel/`.

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
- Teardown: `cmp` the clone's every file under `tests/panel/` against the main
  tree's (identical — proof no mutation leaked into a criterion), then `/bin/rm -rf "$(dirname "${C:?}")"` (local
  `rm` is aliased to `-i`).
- **Baseline first**: unmutated clone, same run, all green expected. If not, stop and report.
- **Process census around every run** (Task 4 repaired a real-process leak; keep checking it stays repaired): before and after each vitest run, record
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

Predictions below are the controller's hypotheses; the implementer's report has its own, and where the two differ
the implementer's report names the criteria more precisely. Where your measurement differs from either, do NOT
declare a false red — investigate with the three questions and report which explains it: (1) does an earlier
assertion in that criterion short-circuit before the named one? (2) who else walks the deleted line? (3) where does
the literal in the named assertion come from — which field, which constant?

In-process servers: every criterion that starts one must close it. After EVERY run, also record
`lsof -nP -iTCP -sTCP:LISTEN > <file>` and report any listener owned by a node/vitest process that was not there
before. Report any "Unhandled Rejection" / "Unhandled error" block vitest prints even when every test passed — vitest
exits non-zero on those, and it is a different finding from a red criterion.

| id | change | controller prediction (measure it) |
|---|---|---|
| G-11 | `api.ts`: compute `currentMetrics(deps.opts)` once when `buildApi` runs and reuse that result on every request | red in the every-request gate criterion only. Report whether a stored rejected promise produces an unhandled-rejection error |
| P-2 | `server.ts` `parsePanelArgs`: default bind `?? "127.0.0.1"` → `?? "192.0.2.1"` (**never** `0.0.0.0`) | red in Task 3's `defaults the bind address to the literal 127.0.0.1` and in this task's bind-by-default criterion — two |
| T-8 | `api.ts`: delete the `/api` token middleware | red in the 401 criterion only |
| S-12b | `api.ts`: delete the whole `app.get(/.*/ …)` static route | red in both HTTP-level static criteria (index at `/`, traversal spellings with their positive control) — two |
| K-1 | `api.ts` `currentMetrics`: stop passing `now` to `collect` | red in the pass-through criterion only |
| E-1 | `api.ts` error handler: answer `MetricsRejection` with status 200 and body `{ report: null, code, message }` | red in the every-request gate criterion and the broken-gate criterion — two |
| C-1 | `coverage.ts`: delete `if (r.action !== "reviewed") continue;` | red in the opened-rows criterion; list every other coverage criterion whose fixture carries an `opened` row and whether it also reddens |
| C-2 | `coverage.ts`: `rate: highTier.size === 0 ? 0 : …` | red in the rate-null criterion only |
| C-3 | `coverage.ts`: count reviewed rows with an array `push` instead of a `Set` | red in the reviewed-twice-counts-once criterion only |
| C-4 | `coverage.ts`: drop the `highTier.has(key)` condition (every reviewed row is added) | red in the low-tier criterion AND the projectKey-mismatch criterion — two |
| C-5 | `coverage.ts`: key both sets by decision id alone (drop projectKey from both keys) | red in the projectKey-mismatch criterion only |
| N-1 | `noSkips` scanner: remove the `.todo` spellings from its pattern | red in the must-catch samples criterion only |
| N-2 | `noSkips` scanner: skip the comment-stripping step | red in the must-not-catch samples criterion; report whether the whole-directory scan ALSO reddens and, if so, which file and which comment line caused it |
| W-1 | `server.ts` `createPanelServer`: pass an empty `StaticFiles` (`get: () => undefined`, `indexHtml: undefined`, `names: []`) into `buildApi` instead of the loaded one | red in both HTTP-level static criteria — two |

If the implementer's report names criteria this table does not cover, say which are unpinned rather than inventing
mutations for them.

## Report

Per mutation: hash before/after, the diff, RC, the vitest summary lines, and for every failing criterion its **full
name** plus the first assertion failure (expected vs received, file:line). Then "matched" / "differs: <what, and which
of the three questions explains it>". Add the listener check and any unhandled-error block.

Write the full report to
`/Users/biran/code/skills/loop/Orca/.superpowers/sdd/2026-09-10-panel-e3/task-5-mutations-report.md`.
No subagents. No edits in the main tree except that file.
Final reply SHORT: one line per mutation (id, RC, failing count, matched/differs, leftover listeners), the two
porcelain readings, and whether `~/.orca` was absent every time.
