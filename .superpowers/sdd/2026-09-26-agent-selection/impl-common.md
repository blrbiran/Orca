# Common rules for every implementer and reviewer of this plan (agent selection, Orca controller session 75ec878e)

Read, in this order, before your task brief:
1. `plan-rulings.md` (same directory): Global Constraints, shared interfaces, §0 execution order + rulings R1–R8, **§0.2 plan-review corrections P1–P23 (these override the task brief text)**.
2. The measure section of the plan part your task came from (`measure-W<n>.md`, same directory) — what the plan writer measured; re-verify anchors against the real tree.
3. Your task brief.

## The tree is the truth
The plan was written in parallel; a brief's "before" anchors may describe code as it was before an earlier task landed. Earlier tasks' symbols, files and criteria are ALREADY in the tree: modify them incrementally, never re-create, overwrite wholesale, or re-declare them. When the brief and the tree disagree, keep what earlier tasks landed, follow §0/§0.2, and say what you adapted in your report.

## Hard prohibitions (violating any is an incident)
- Main working trees (`/Users/biran/code/skills/loop/ccloop`, `/Users/biran/code/skills/loop/Orca`): no `git stash`, `checkout`, `reset`, `restore`, `clean`, no temporarily moving/reverting files to obtain RED. RED comes from writing the test first; mutations happen only in a `git clone --local` copy under `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/75ec878e-a6d3-4299-9a4b-b76dd574b77a/scratchpad/impl/` using literal paths (`/usr/bin/git -C "<copy>" …`), never a `$C` carried across commands.
- No `git push`, `merge`, branch or worktree deletion. Commit locally on `main` only. `git add` file by file (never `-A`/`.`), after reading `git status --porcelain` redirected to a file.
- ccloop main tree: do NOT run `npm run build` or `npm run verify:control` (it would swap the wire protocol in the main tree's `dist/`); do builds in a clone.
- Never write to the real user's HOME (`~/.orca`, `~/.claude`, `~/.codex`, XDG dirs). Tests redirect HOME / `ORCA_AGENTS_TABLE` to temp dirs. Real `claude`/`codex` binaries must never be invoked by tests (inject probes or point PATH at an empty dir). No paid model calls.
- Do not run full test suites (a production daemon runs on this machine); run the focused files your task touches plus their direct neighbours. The controller runs full gates at T17.
- Verification output: redirect to a file and read it whole; no pipes into grep/head/tail/wc for verification. `rm`/`cp` have `-i` aliases: use `/bin/rm -rf`, `cat src > dst`. Use `/usr/bin/git` for git inspection.
- Do not dispatch subagents. Do not claim human authorization. Do not estimate costs.

## Conventions
- Code, comments, error messages, CLI help, commit messages: English. Commit trailer lines:
  `Co-Authored-By: <your model name> <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR`.
- Env for ccloop tests: `ECC_GATEGUARD=off DISABLE_OMC=1`; run vitest as `./node_modules/.bin/vitest run <files>`.
- Existing criteria may be rewritten (human, 2026-09-26: "同意修改几个仓库的现有test") but only as a WHOLE rewrite that does not loosen; annotate next to it: `// Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): <what it now encodes>`. List every rewrite in your report as one line `- REWRITTEN: <file> > <describe> > <it> — <why>`, and every new criteria file as `- NEW-CRITERIA: <file> <count>`.
- A new criterion that is green at RED time: run a mutation deleting the branch under test (in a clone) and show it red. Every new branch gets a named mutation you actually ran; record each as `- MUTATION: <id> <what was deleted> -> <red test name>` in your report.
