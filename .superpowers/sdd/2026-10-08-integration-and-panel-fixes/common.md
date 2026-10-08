# Common rules for every implementer/reviewer of this plan

- Work ONLY in `/Users/biran/code/skills/loop/Orca-integration` (branch `feat/integration-schemes`). Never touch `/Users/biran/code/skills/loop/Orca` (main checkout), other worktrees, ccloop or ccmem. Never push, merge, delete branches/worktrees.
- Read `CLAUDE.md` in the worktree; it binds you (Rules 3, 4, 8, 9, 12, 14, 17).
- Spec: `docs/superpowers/specs/2026-10-08-integration-and-panel-fixes-design.md` — the binding authority (rulings R1–R8 in §12). Read the sections your task touches.
- Global constraints: see the "Global Constraints" section at the top of `docs/superpowers/plans/2026-10-08-integration-and-panel-fixes.md` (read only that section and your brief, not the whole plan).
- Shell: use `/bin/cp`, `/bin/rm` (plain cp/rm are aliased interactive and hang); `/usr/bin/git` for read-only checks; redirect every verification run to a file under `$S` and read it back whole (no piping a test run through grep/tail). `$S=/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/eaee0f2c-ea93-4935-a17b-27becfbfbeb4/scratchpad`.
- Tests: `./node_modules/.bin/vitest run <files>` from the worktree root; web tests from `web/` with `../node_modules/.bin/vitest run <files>`. Use `TMPDIR=/private/tmp/claude-501/ou/t` (short, exists). Typecheck: `npm run typecheck`; web: `npm run --ws check`.
- Real-ccloop tests need `ORCA_CCLOOP_BIN=$S/ccloop-new/dist/cli.js` (built clone of the pinned ccloop; do not modify it). Tests that need it skip with `ctx.skip()` when unset.
- Never write to the real `~/.orca`; criteria use temp roots (`ORCA_CONTROL_DIR`, `relocateHome`).
- Mutations (Rule 9): each new branch you add gets one mutation that deletes it, seen RED. Do mutations only in a `git clone --local` of your committed tip under `$S/mut-<task>-<id>` (run `npm ci` there once; for web, also needed in clone), never in the worktree. Prove restore with `git diff | wc -c` and `git diff --cached | wc -c` = 0. Put the mutation table (mutation, test, the assertion seen red, restore bytes) in your report.
- Existing tests: if one must change, it is a rewrite — name it, say why (which spec line), and keep it at least as strict. List rewrites in your report under "Rewrite inventory".
- Known load flakes (a red here: re-run alone, record `uptime`): gateCheck K13, driverRequirementSplit, driverRecovery, controlShutdown 143, agentSelectionE2E C3, driverLanding, driverProgress R2, executionDriverE2E, ccloopPort, web controlCommandRecovery, web agentPreviewRefresh, requirementExport DR21, schedulerBridge "success", requirementCommands DR10, web projectSwitcher C.
- Commit messages: imperative English subject, body explaining why; end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Code/comments in English.
- Do not dispatch subagents. Do not estimate token/cost numbers.

## ⚠️ Added after an incident (Task 3, first attempt)
A scratch `git init`/commit experiment ran in the MAIN checkout because a `mkdir`/`cd` failed and the chain continued with `;`. Rules:
- Every git command uses `git -C <absolute path>`; never rely on the current directory.
- Never chain with `;` after `cd`/`mkdir`; use `&&`, and create scratch dirs in their own step (`mkdir -p <abs path>`), checking rc.
- Scratch git experiments only under `$S/<task>-scratch/...` and only with `git -C <that abs path>`.
- Before any `git init`, `commit`, `checkout`, `reset`, `branch`, assert the target with `git -C <path> rev-parse --show-toplevel` and that it is NOT `/Users/biran/code/skills/loop/Orca`.
