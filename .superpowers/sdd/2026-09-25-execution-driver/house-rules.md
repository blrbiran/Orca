# House rules for every seat in this round (read before working)

- Repos: Orca `/Users/biran/code/skills/loop/Orca`, ccloop `/Users/biran/code/skills/loop/ccloop`. Both work directly on local `main` (project convention).
- Code, comments, commit messages: English. Reports and ledgers: Chinese or English, your choice.
- NEVER: push, amend, merge, rebase, delete branches or worktrees, `git reset --hard`, `git checkout -- .`, `git stash` in the main trees; kill any process you did not start; spawn subagents.
- The Tier 0 gate hook blocks some git commands typed in Bash (push, merge into main, branch delete, `git worktree remove`). Do not try to get around it. Code under test may run those git commands itself (that is fine).
- Commit with `git commit -F <message-file>` (never several `-m`), ending with exactly these two trailer lines, no blank line between them:
  `Co-Authored-By: <YOUR OWN model name> <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR`
  Never write "Human authorization" or attribute anything to the human unless you quote the spec header verbatim.
- Existing test criteria may be rewritten in this round ONLY where your brief names them; rewrite the whole test, never weaker, and put above it: `// Execution driver (human ruling 2026-09-25: this round may rewrite criteria; ruling 88 (b)(c)): <the new fact it encodes>`.
- Verification runs: redirect to a file and read the whole file back; never pipe through grep/tail/head (pipes swallow exit codes, rtk filters lie). Use `/usr/bin/git` for git checks. Count/locate with python, not grep (grep silently drops lines here).
- Shell aliases: `rm` and `cp` are `-i` here — use `/bin/rm` and `cat src > dst`. zsh does not word-split unquoted variables. macOS has no `timeout`.
- Env for Orca tests that need ccloop: `source /private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/905e41ce-94af-4c74-b8c8-8c091a60e72b/scratchpad/env.sh` (sets ORCA_CCLOOP_BIN, ORCA_CCLOOP_ADAPTER_CONFIG, ECC_GATEGUARD=off, DISABLE_OMC=1). Your brief says if a newer ccloop build is required.
- Rule 17: any test that writes outside the repo must use a temp dir via env relocation (ORCA_CONTROL_DIR etc.); never touch ~/.orca or real user data. New dirs 0700, new files 0600.
- Known flake (Orca): `tests/panel/controlShutdown.test.ts` "a real SIGTERM to a real panel makes it exit cleanly…" — if red, rerun that file alone. ccloop: known reds are judged by `node scripts/check-known-reds.mjs <vitest-json>` (RC 0 = fine).
- See something wrong outside your task? Report it, do not fix it. Did you fix anything not in your brief? Say so explicitly in the report.
- If your brief's code does not fit the real code, adapt minimally and list every deviation in the report (what, why, evidence). If adapting would change behaviour the spec defines, stop with NEEDS_CONTEXT.
- **Mutations are NEVER applied in the main working trees** (Rule 15). Implementers do not run the brief's mutation table at all — the Task 11 mutation seat runs it in a `git clone --local` copy under the scratchpad. (Added after Task 2's implementer mutated the main tree; its commit was checked clean.)
