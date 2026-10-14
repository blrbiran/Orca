# Brief: feedback #53 — a Web-started group shows Start while its first run is executing

Repository: Orca, worktree /Users/biran/code/skills/orca/Orca-wt/web-start-running, branch fix/web-start-group-running (from Orca main). node_modules and web/node_modules are symlinks to the main checkout: NEVER `git add -A`/`git add .`; add explicit paths only.

## Problem (controller-verified, 2026-10-14)
- `start` (src/control/webDispatch.ts ~163-166) only inserts a `scheduler_wakes` row and answers 202.
- On claim, `createStartingRun` (same file ~368-425) sets only the WORK ITEM `status = "running"`; the GROUP state is not touched.
- So a Web-started group stays `ready` through its whole first run, and web/src/ControlGroupView.tsx (~156) shows Start (`view.summary.state === "ready" && stopMode === null`). A second Start while ready is accepted and queues another wake.
- Same root makes pause / handoff-stop land in the "prepare" region (web/src/detailRegion.ts) — feedback #47 half.
- Overview already avoids it: src/panel/controlOverview.ts ~95-100 uses `pendingWake` (undelivered scheduler_wakes) and `executionBusy` (BUSY_WORK work statuses or an active run).

## What to do (TDD, Orca CLAUDE.md Rules 4, 8, 9)
1. Read first (Rule 8): webDispatch.ts claim path, where group `state` is stored/derived and every writer of it (grep the control store and the group summary builder), checkpoints.ts (~103 sets review), controlOverview.ts, detailRegion.ts, ControlGroupView.tsx, and the existing tests that cover Web start/claim (find them under tests/control and web/tests).
2. Write ONE failing criterion first, at the layer the bug is observable: after a Web `start` has been claimed (a run is starting/active, fake ccloop — reuse the existing harness/fixtures that already drive a Web start), the group must no longer read as startable (the group summary state is not `ready`, OR whatever single predicate the Start button uses says not startable). Run it on unchanged code and SEE it red, with the red on the assertion you named (record the command and output).
   Also cover the window between `start` accepted and claim (undelivered start wake): Start must not be offered then either (Overview already treats pendingWake as not startable).
3. Fix. Choose the smallest change that makes the server's view the single truth for both the Start button and detailRegion:
   - Preferred: if the group summary state is DERIVED in a read view, derive `running` while executionBusy / an active Web run exists (no persisted-state change, no schema change).
   - Else, if group state is persisted and other paths already write `running` at claim/dispatch, make the Web claim do the same in the same transaction.
   - Else (neither is clean), make the UI's Start gate use the same predicate as Overview (server must expose it; no client-side recomputation from partial data).
   Whatever you pick, state why in the report, list every persisted-state writer you checked, and confirm no existing criterion is rewritten. If an existing criterion would have to change to keep green, STOP and report it instead (the human must name each rewrite).
   Do not change the `orca panel` ready line, the section-pane mounting rule, colors/tones (web/DESIGN.md).
4. Mutation evidence (Rule 9; Rule 15 — only in a `git clone --local` copy, never in this worktree): `/usr/bin/git clone --local /Users/biran/code/skills/orca/Orca-wt/web-start-running /private/tmp/osc/mut/w53` AFTER committing; symlink node_modules + web/node_modules into it; revert your fix line(s) there (by `cat orig > file` style restore, sha256 before/after), run your criterion, see red; restore; show `git diff` and `git diff --cached` byte counts are 0 (redirect to files, read whole). Remove the clone's node_modules symlinks with `/bin/rm -f` before `/bin/rm -rf` of the clone.
5. Run the touched test files plus `npm run typecheck` (root), and if web changed `npm run build --workspace web` and the web tests you touched, plus root `tests/panel/scanPanelText.test.ts` and `tests/metrics` if any web string changed. Redirect every verification run to a file under /private/tmp/osc/logs/w53-* and read it whole (never pipe through grep/tail/head — it swallows exit codes). If a test that you did not touch times out, rerun that file alone 3x before calling it a flake (see docs/handoff/known-load-flakes.md).
6. Commit with `git commit -F <file>`; English message, conventional prefix (fix(control): ... or fix(web): ...), ending with exactly these two lines after a blank line:
   Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
   Claude-Session: https://claude.ai/code/session_01NCgRiQLh17ENJdrmuJDcKL

## Hard rules
- Use /usr/bin/git for every git command (rtk rewrites git output). Use `/bin/rm`, and `cat src > dst` instead of cp (aliases prompt).
- Never push, merge, reset, checkout, stash, restore, clean, amend, or delete branches/worktrees. Never touch other worktrees or ~/.orca. Do not kill processes you did not start.
- No paid model calls of any kind.
- Do not dispatch subagents. Do not fix anything outside this issue — report it instead.
- Code, comments and commit message in English.

## Report
Write the full report to /Users/biran/code/skills/orca/Orca-wt/web-start-running/.superpowers/sdd/2026-10-14-web-start-running/report.md: the fix chosen and why, persisted-state writers checked, the red run (command + output excerpt) before the fix, green after, the mutation (sha256s, red output, restore byte counts), every test/typecheck command with RC, commits. Return only: status (DONE / DONE_WITH_CONCERNS / BLOCKED / NEEDS_CONTEXT), commit list, one-line test summary, concerns.
