# Task 2 — independent mutation verification

You did NOT write this code. MEASURE whether each criterion can go red; do not fix anything, and do not improve
anything you dislike. A fully green mutation is a finding, not a failure — say it plainly.

Repo: `/Users/biran/code/skills/loop/Orca`. Commit under test: `4bcaa9e`
(`feat(panel): give reviews their own store, their own lock and their own modes`).
Read `/Users/biran/code/skills/loop/Orca/CLAUDE.md` Rules 9, 14, 15, 17 first. The implementer's report is
`.superpowers/sdd/2026-09-10-panel-e3/task-2-report.md` — use it only to find which criteria exist; trust nothing
else in it.

The code under test: `src/panel/paths.ts`, `src/panel/reviewsLock.ts`, `src/panel/reviewsStore.ts`.
The criteria: `tests/panel/reviewsStore.test.ts` (8 `it` blocks).

## Hard rules (same procedure as the Task 1 verifier — follow exactly)

- **The main tree is never touched.** Before and after the whole run record
  `/usr/bin/git -C /Users/biran/code/skills/loop/Orca status --porcelain -z > <file>; wc -c < <file>` and
  `/usr/bin/git -C /Users/biran/code/skills/loop/Orca rev-parse HEAD`. Always `/usr/bin/git`, never plain `git`
  (a hook rewrites it through rtk, which prints `ok` for empty output).
  ⚠️ **Expected porcelain here is NOT 0.** `.superpowers/sdd/2026-09-10-panel-e3/progress.md` is dirty on purpose —
  it is the controller's ledger, being written while you work. Record the byte count and the file list; what matters
  is that **no file under `src/`, `tests/`, `web/` or `.decisions/` ever appears in it**, and that the two lists are
  otherwise the same before and after.
- One shell invocation per mutation containing setup, edit, run, teardown:
  ```
  C=$(mktemp -d)/orca
  /usr/bin/git clone --local --quiet /Users/biran/code/skills/loop/Orca "${C:?}"
  /usr/bin/git -C "${C:?}" checkout --quiet 4bcaa9e
  ln -s /Users/biran/code/skills/loop/Orca/node_modules "${C:?}/node_modules"
  ln -s /Users/biran/code/skills/loop/Orca/web/node_modules "${C:?}/web/node_modules"
  ```
  (both symlinks: `web/` has its own node_modules with vite/esbuild. This task's criteria are root-side only, but the
  clone must still resolve.)
- Edits by a python/node script with an **exactly-once anchor assertion** (exit non-zero if the anchor matches 0 or
  ≥2 times); `shasum -a 256` before/after (must differ); print `/usr/bin/git -C "${C:?}" status --porcelain` and the
  `diff` into your output. A mutation whose hash did not change did not land — that is not a green, it is a broken run.
- Run: `cd "${C:?}" && ./node_modules/.bin/vitest run tests/panel/reviewsStore.test.ts > <out> 2>&1; echo "RC=$?" >> <out>`.
  Read outputs WHOLE (never pipe/grep/tail a verifying run). Check the vitest `RUN` line points **into the clone**,
  not into the main tree.
- A compile/collection/module-resolution error is a **broken mutation**, not a red. Say so and fix the mutation, not
  the code.
- Teardown: `cmp` the clone's `tests/panel/reviewsStore.test.ts` against the main tree's (must be identical — proof the
  mutation never leaked into a criterion), then `/bin/rm -rf "$(dirname "${C:?}")"`. Local `rm` is aliased to `-i`;
  use `/bin/rm`.
- **Baseline first**: unmutated clone, same run, all 8 green expected. If not, stop and report.

## Mutations

Predictions come from the implementer and from the controller. **They are hypotheses.** Where what you measure differs,
do NOT declare a false red — investigate with the three questions and report which one explains it:
(1) does an earlier assertion in that criterion short-circuit before the named one?
(2) who else walks the deleted line — is the same line the shared closing of more than one path?
(3) where does the literal in the named assertion come from — which field, which constant?

| id | change | prediction (measure it) |
|---|---|---|
| R-6 | `src/panel/paths.ts`: `reviewsLockDir` returns `join(dir, ".corrections-lock")` | red in `does NOT share the corrections lock: holding that one must not block a review` and only it |
| R-7 | `src/panel/reviewsStore.ts`: delete the line `if (this.seen.has(key(row))) return "duplicate";` from `append` | red in `skips a row it already wrote in this process, keyed by decision, person and action` **and** `picks up rows an earlier process wrote, so dedupe survives a restart` — **two, not one** (the implementer's grep found `toBe("duplicate")` in exactly those two criteria) |
| R-9 | `src/panel/paths.ts`: `REVIEWS_DIR_MODE` → `0o755` and `REVIEWS_FILE_MODE` → `0o644` | **two** criteria: `gives the directory and the file their modes explicitly, not from the umask` **and** the existing-directory criterion (`leaves an already-existing directory's mode alone…`), because that one also asserts the freshly created file is `0o600`. The plan's table said one; the implementer corrected it to two. Measure which it is |
| R-9b | `src/panel/reviewsStore.ts`: delete `mode: REVIEWS_DIR_MODE` from the `mkdir(this.dir, …)` call (leave `recursive: true`) | red in `gives the directory and the file their modes explicitly` and only it — the existing-directory criterion's directory is pre-existing, so that mkdir's mode never reaches it |
| R-9c | `src/panel/reviewsStore.ts`: add an unconditional `await chmod(this.dir, REVIEWS_DIR_MODE);` immediately after that `mkdir` (import `chmod` is already there) | red in `leaves an already-existing directory's mode alone, even when it is looser than 0700` and only it. ⚠️ This is the one that decides whether the criterion added this round is load-bearing at all — if it is green, say so loudly |
| R-10 | `src/panel/reviewsLock.ts`: put `recursive: true` back into the `mkdir(lockPath, …)` call | red in `refuses by its OWN name when its OWN lock is held` and only it. The implementer says it saw this red before removing `recursive`; you are measuring it independently on the committed code |

## Per-mutation report

Hash before/after, the diff, RC, the vitest summary lines, and for every failing criterion its **full name** plus the
first assertion failure (expected vs received, file:line). Then one of: "matched", "differs: <what and which of the
three questions explains it>", or "measured (no prediction)".

Write the full report to
`/Users/biran/code/skills/loop/Orca/.superpowers/sdd/2026-09-10-panel-e3/task-2-mutations-report.md`.
No subagents. No edits anywhere in the main tree except that one report file.
Final reply SHORT: one line per mutation (id, RC, failing count, matched/differs/measured) plus the two porcelain
readings.
