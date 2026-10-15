# Implementer contract (every task)

Worktree: /Users/biran/code/skills/orca/Orca-wt/error-codes-start-guard (branch feat/error-codes-start-guard). Work only there.
Read first, in order: (1) common-preamble.md in this directory (Global Constraints, controller rulings R1-R5, spec corrections
K1-K8, interpretations, setup); (2) your task brief task-<ID>-brief.md — it is your requirements, with the exact values to
use verbatim; (3) the spec sections the brief cites (docs/superpowers/specs/2026-10-15-*.md, including their appended
"Corrections found while planning" pointer).

Rules:
- Line numbers in the brief are anchors measured before earlier tasks of this plan landed: locate edits by the quoted text.
  If quoted text is not found exactly once, stop and report NEEDS_CONTEXT with what you found.
- TDD: write the failing test, run it and see it fail on the named assertion, implement, see it pass.
- Run only the targeted test files named in the brief (root: `./node_modules/.bin/vitest run <file>`; web:
  `cd web && ../node_modules/.bin/vitest run tests/<file>`), plus `npm run typecheck` (and `npm run build --workspace web`
  if you touched web/src and a root tests/panel test reads the built panel). Redirect every run to a file under
  /private/tmp/oec/logs/ and read it back whole. PATH must start with /Users/biran/.nvm/versions/node/v22.13.1/bin.
- Do NOT run mutations (the reviewer does). Do NOT run the full suite (Task G does).
- Never rewrite or delete an existing assertion unless the brief names it as a rewrite; if any other existing test goes red,
  stop and report it (status DONE_WITH_CONCERNS or BLOCKED), do not edit it.
- Git: /usr/bin/git only; stage exact paths (never -A / .); commit with `/usr/bin/git commit -F <file>`; message in English,
  subject as the brief says, then a blank line and `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
  No amend, no push, no merge, no branch/worktree deletion, no stash/reset/checkout of other files.
- Never dispatch subagents (no helpers, no reviewers). Never kill processes you did not start. No real provider calls.
- Report: write the full report to the report path given in your dispatch (what changed with file:line, every command run
  with its exit code and the pass/fail counts read from its log, the commit sha(s), deviations from the brief and why,
  concerns). Your final message is ONLY: status (DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED), commit sha(s),
  one-line test summary, one-line concerns.
- Added after Task A7 (controller): if you touched anything under web/src, also run the FULL web suite once before
  committing (`cd web && ../node_modules/.bin/vitest run`, log to /private/tmp/oec/logs/, report the counts). Any red file
  outside your brief's list is reported, not edited.
