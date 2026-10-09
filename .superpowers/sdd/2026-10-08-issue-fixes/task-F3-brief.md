### Task F3: Close the round

- [ ] **Step 1: Final whole-branch review** by a fresh reviewer subagent (brief: both specs, this plan, the ledger, the
  known flakes list, the list of rewritten tests), then fix waves as needed with mutation proof for each fix.
- [ ] **Step 2: Ledger.** `.superpowers/sdd/2026-10-08-issue-fixes/progress.md` (force-added: `.superpowers/sdd` is
  git-ignored) gets the closing section: what landed per part, rewritten tests by name, rulings made during execution,
  awaitingHuman.
- [ ] **Step 3: Handoff (Chinese).** Replace `docs/handoff/handoff.md` §4.0 with this round's state; compress the
  previous §4.0 into a `4.0.v` conclusions entry (Rule 13 three conditions); no current hashes. Update the "Orca 那条线"
  section of ccloop's `docs/handoff/handoff.md` in the ccloop worktree branch the same way.
- [ ] **Step 4: awaitingHuman** (agent never does these): merge `fix/codex-planner-output` into ccloop main and push;
  after F1, `--ff-only` merge `fix/issues-20261008` into Orca main and push; delete the two worktrees
  `Orca-issues` and `ccloop-planner`; note that the control store becomes schema 9 (older Orca cannot open it).
