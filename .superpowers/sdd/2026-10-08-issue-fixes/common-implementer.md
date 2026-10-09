# Common rules for every Orca implementer (session e34dc963, plan docs/superpowers/plans/2026-10-08-issue-fixes.md)

Read before starting: /Users/biran/code/skills/loop/Orca-issues/CLAUDE.md; your task brief (task-<ID>-brief.md here);
your part's preamble (part-<P>-preamble.md here — it may contain a binding "Controller amendment");
global.md here (Global Constraints, Review Focus, Shared interfaces, **Pre-flight amendments — binding**);
the ledger progress.md here (rulings that bind you). Spec: docs/superpowers/specs/2026-10-08-issue-fixes-design.md.
When the brief disagrees with an amendment or a ruling, the amendment/ruling wins; when the brief disagrees with the
CURRENT code (earlier tasks landed and moved lines or chose names), follow the current code and the interface names that
earlier tasks actually produced, and say so in your report. Search by the brief's anchor text, not its line numbers.

Workspace: /Users/biran/code/skills/loop/Orca-issues (branch fix/issues-20261008). Rules:
- Verification git commands (diff byte counts, status, log) use `/usr/bin/git` — the rtk wrapper rewrites `git` and
  reports a 0-byte diff as 1 byte. Ordinary commits may use either.
- git: `git -C /Users/biran/code/skills/loop/Orca-issues …`; `git add` explicit paths only (node_modules and
  web/node_modules are untracked symlinks — never `-A`/`.`); never amend; never push/merge/branch-delete.
- Other implementers may work in the same worktree concurrently: commit ONLY your paths with
  `git -C <worktree> commit -m "…" -- <path> <path> …` (pathspec commit; never a bare `git commit` that takes the whole
  index); if `index.lock` exists, wait a few seconds and retry; never stage or revert files you did not change.
- After a `cd`, never chain with `;` (use `&&`). Use /bin/rm and /bin/cp.
- Verification: redirect every test/typecheck run to a file under
  /private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/e34dc963-cc97-4bb3-b662-27fd62c9d359/scratchpad/orca/<ID>/
  and read the whole file (no grep/tail/head filtering). Record `uptime` with any red.
- Commands: server tests `./node_modules/.bin/vitest run <files>`; web tests `cd web && ../node_modules/.bin/vitest run <files>`;
  `npm run typecheck`; web suite `npm run --workspace web check`.
- tests/panel needs web/dist: run `npm run build --workspace web` (output is git-ignored) before tests/panel when web
  changed or dist is missing; a `panel-dist-missing` red is environment, not regression.
- Env for tests: ECC_GATEGUARD=off DISABLE_OMC=1. No test may touch the real ~/.orca (Rule 17).
- Known load flakes (re-run the file alone before calling a red a regression): see docs/handoff/handoff.md §3 list plus
  driverReconcileN "lands all three…".
- TDD: write the failing test, run it and see it fail for the expected reason, implement, see it pass.
- Before committing: focused tests + the suites of every file you touched + typecheck (+ web check if web changed).
  Every commit leaves those green (Pre-flight amendment 6).
- Mutation step: run ONLY in a `git clone --local /Users/biran/code/skills/loop/Orca-issues <scratch>/orca/<ID>/clone`
  made AFTER your commit (link node_modules and web/node_modules into it; `npm run build --workspace web` first when web
  tests are involved); apply the mutation there, run the named test, confirm RED, discard the clone. Prove the worktree
  untouched: `git -C <worktree> diff | wc -c` and `git -C <worktree> diff --cached | wc -c` both 0 before and after.
  A mutation not seen red is a finding: fix the test in a follow-up commit and re-run.
- Existing tests: rewrite only those the brief/amendments name; if another existing test goes red, STOP and report
  BLOCKED with its name and the failure.
- New error codes: en AND zh entries in the same task; en text never contains its own code.
- Commit messages: English, conventional, last line `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Do not dispatch subagents. If unclear, report NEEDS_CONTEXT with the question.

Report: write the full report to task-<ID>-report.md here (implemented; tests + results; TDD RED/GREEN commands and
output excerpts; mutation evidence; files changed; deviations from the brief and why; self-review; concerns). Reply with
ONLY (<15 lines): Status (DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT), commits (short SHA + subject), one-line
test summary, concerns, report path.
