# Hard rules for every seat in this plan (read before any command)

- ccloop work happens ONLY in /Users/biran/code/skills/orca/ccloop-wt/omp-single-call (branch codex/omp-single-call). Orca work ONLY in /Users/biran/code/skills/orca/Orca-wt/omp-single-call. Read that repo's CLAUDE.md first; it overrides anything else.
- `node_modules` (and Orca `web/node_modules`) are symlinks to the main checkouts. NEVER `git add -A` / `git add .`; add explicit paths only. In ccloop `git status` shows `?? node_modules` — that is expected, never add it.
- Use /usr/bin/git for every git command (the rtk hook rewrites `git` and lies). Use /bin/rm, and `cat src > dst` instead of cp/mv (interactive aliases hang).
- Never push, merge, rebase, reset, checkout, switch, stash, restore, clean, amend, or delete branches/worktrees. Never touch another worktree, the main checkouts, ~/.orca, ~/.omp or ~/.claude. Never kill processes you did not start.
- No paid model calls: never run a real `omp`, `codex` or `claude` against a provider. Only the fakes under tests/fixtures.
- Verification runs are redirected to a file under /private/tmp/osc/logs/ and read back WHOLE (never piped through grep/tail/head — pipes swallow exit codes). Record each command and its RC.
- Apply every plan edit by its quoted unique anchor text, never by line number (line numbers shift after an earlier insertion in the same step).
- Existing tests are never rewritten. If an existing test goes red and keeping it green needs a change to it, STOP and report (the human must name each rewrite). A red in a file you did not touch that is a timeout: rerun that file alone 3x and report both runs (see Orca docs/handoff/known-load-flakes.md).
- Mutations only in a `git clone --local` copy under /private/tmp/osc/mut/; never mutate the worktree.
- Commit with `/usr/bin/git commit -F <file>`; English conventional message; it ends, after one blank line, with exactly:
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NCgRiQLh17ENJdrmuJDcKL
- Code, comments, commit messages in English. Do not dispatch subagents. Do not fix anything outside your task — report it.
