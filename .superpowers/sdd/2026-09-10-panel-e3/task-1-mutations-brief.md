# Task 1 — independent mutation verification

You did NOT write this code. MEASURE whether each criterion can go red; do not fix anything.

Repo: /Users/biran/code/skills/loop/Orca. Commit under test: 29c0de4 (`feat(panel): register the web workspace and reserve the seventh subcommand`).
Read `/Users/biran/code/skills/loop/Orca/CLAUDE.md` Rules 9, 14, 15, 17 first. The implementer's report is
`.superpowers/sdd/2026-09-10-panel-e3/task-1-report.md` (use it only to find which test files and criteria were added; trust nothing else in it).

## Hard rules (same procedure as the Task P verifier — follow exactly)

- Main tree never touched. Before and after the whole run record `/usr/bin/git -C /Users/biran/code/skills/loop/Orca status --porcelain -z > <file>; wc -c < <file>`
  (0 both times) and `/usr/bin/git -C … rev-parse HEAD`. Always `/usr/bin/git`, never plain `git` (a hook rewrites it through rtk).
- One shell invocation per mutation containing: setup, edit, run, teardown.
  ```
  C=$(mktemp -d)/orca
  /usr/bin/git clone --local --quiet /Users/biran/code/skills/loop/Orca "${C:?}"
  /usr/bin/git -C "${C:?}" checkout --quiet 29c0de4
  ln -s /Users/biran/code/skills/loop/Orca/node_modules "${C:?}/node_modules"
  ln -s /Users/biran/code/skills/loop/Orca/web/node_modules "${C:?}/web/node_modules"
  ```
  (web/ has its own node_modules with vite/esbuild; both symlinks are needed.)
- Edits by a python/node script with an exactly-once anchor assertion (exit non-zero otherwise); `shasum -a 256` before/after (must differ, or for a
  file-creation mutation, show the file did not exist before and does after); print `/usr/bin/git -C "${C:?}" status --porcelain` and `diff` into the output.
- Root run: `cd "${C:?}" && ./node_modules/.bin/vitest run tests/panel tests/cli > <out> 2>&1; echo "RC=$?" >> <out>`.
  Web run (only where the table says so): `cd "${C:?}/web" && ../node_modules/.bin/tsc --noEmit -p tsconfig.json > <out2> 2>&1; echo "TSC_RC=$?" >> <out2>; ./node_modules/.bin/vitest run >> <out2> 2>&1; echo "VITEST_RC=$?" >> <out2>`
  (if a binary is not where stated, locate it inside the clone's symlinked node_modules and say which path you used).
  Read outputs WHOLE; check the vitest `RUN` line points into the clone.
- A compile/collection/setup error is "broken mutation", not red.
- Teardown: `cmp` the clone's tests/panel and web/tests files against the main tree's (identical), then `/bin/rm -rf "$(dirname "${C:?}")"`.
- Baseline first: unmutated clone, root run AND web run, all green expected; if not, stop and report.

## Mutations (find the anchor in the clone; if the code differs from the description, report and skip)

| id | change | hypothesis (prediction — measure) |
|---|---|---|
| W-1 | root package.json `scripts.verify`: remove ` && npm run --ws check` | red in `runs the workspace check as part of verify` and only it |
| W-2 | create `web/package-lock.json` containing `{}` | red in `gives web/ no lockfile of its own` (this criterion was green before Task 1 existed — this mutation is what proves it can go red) |
| W-3 | root package.json: move `express` from dependencies to devDependencies | red in `declares express as a runtime dependency` |
| W-4 | src/cli.ts USAGE: delete the words `does not suit a team` | no prediction — measure which criterion (if any) pins the spec §3.3 help sentence |
| W-5 | src/cli.ts USAGE: delete `--i-know-this-is-exposed` from the panel usage block | no prediction — measure |
| W-6 | src/panel/server.ts `startPanelFromArgs`: delete the `--by` guard (the `if (by === undefined …) { throw … }` block) | no prediction — measure (Task 3 owns the full guard criteria; a green here is information, not a defect) |
| W-7 | web/src/App.tsx: change the rendered text `orca panel` to `orca` | web run: red in the web smoke criterion; root run unaffected |
| W-8 | root package.json: `workspaces` becomes `["client"]` | no prediction — measure (root run only) |

Per mutation report: hash/creation evidence, diff, RC(s), summary lines, every failing test's full name + first assertion failure (expected vs received, file:line),
then "hypothesis matched" / "differs: …" / "measured". A fully green mutation is a finding — say it plainly.

Write to `/Users/biran/code/skills/loop/Orca/.superpowers/sdd/2026-09-10-panel-e3/task-1-mutations-report.md`. No subagents. No edits in the main tree except that file.
Final reply SHORT: one line per mutation (id, RCs, failing count, matched/differs/measured) + the two porcelain byte counts.
