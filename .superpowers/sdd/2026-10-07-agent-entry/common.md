# Common rules for every N2 task (read with your brief)

Repo: /Users/biran/code/skills/loop/Orca, branch main. Spec: docs/superpowers/specs/2026-10-07-agent-entry-design.md. You implement only your task.

Hard rules (CLAUDE.md of this repo):
- Never touch the real ~/.orca, never run a paid model (no real claude/codex), never push, never merge, never delete branches.
- Every test relocates ORCA_CONTROL_DIR, ORCA_CORRECTIONS_DIR, ORCA_PROJECTS_FILE (when relevant) and HOME into temp dirs. New dirs 0700, new files 0600.
- Use /usr/bin/git, /bin/rm, /bin/cp (cp/rm have interactive aliases). The shell is zsh: quote globs; do not echo "====".
- Rule 14: never filter verification runs. Redirect output to a file in your scratch dir and read the file back whole (Read tool). Append `echo rc=$?`.
- Scratch dir for outputs and mutation clones: /private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/6cc0c1e9-7313-4a5e-942a-f02129bf4027/scratchpad/n2 (create subdirs as needed; keep paths short).
- Rule 9 mutations: do them ONLY in a `git clone --local /Users/biran/code/skills/loop/Orca <scratch>/mut-tN` copy (then `npm ci` or symlink node_modules: `ln -s /Users/biran/code/skills/loop/Orca/node_modules <clone>/node_modules`, and for web workspace if needed). Apply each mutation, run the named test, confirm it goes RED, restore (`git checkout -- .`), confirm `git diff | wc -c` is 0. Record each mutation: what you changed, which test/assertion went red, restore proof. The main worktree is never mutated.
- Code, comments, commit messages in English; match surrounding style (comments cite spec sections like the existing code does). Commit messages end with a blank line then:
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
- Commit only your task's files (git add explicit paths). Show nothing interactive.
- Changing an existing test is allowed only where your brief says so; otherwise report it as a concern.
- Known load flakes (not yours): driverRecovery, driverRequirementSplit, controlShutdown — if one fails, re-run it alone and report.
- You never dispatch subagents.

Ruling P2 (controller): shared socket-panel test helpers live in tests/panel/fixtures/socketPanel.ts (created in Task 3; later tasks import workspace/boot/overSocket from it instead of copying).
