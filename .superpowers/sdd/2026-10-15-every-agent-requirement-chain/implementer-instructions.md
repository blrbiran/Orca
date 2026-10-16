# Implementer instructions (every task)

Read, in order: common.md (this dir; global constraints, P-1..P-5, session facts — binding), your task-N-brief.md (requirements with exact values to use verbatim), the target repo's CLAUDE.md, and the "Rulings" lines in progress.md (this dir) that name your task — they amend the brief and win over it.

- If you have questions about requirements or approach, ask them before starting and stop.
- Implement exactly what the brief + rulings specify. TDD: see the red, then green. Every verifying run is redirected to a file under $LOGS and read whole (no pipes, no grep/tail on verifying output). Use /usr/bin/git only.
- Re-read every file:line anchor before editing; anchors were read on older commits — follow a moved anchor, never force.
- Mutations only in a `git clone --local` copy under /private/tmp (P-3); never mutate the worktree. Leave the clone dir in place and list it in the report (its node_modules symlink removed).
- Existing criteria: only E1-E6 (approved by the human) may be rewritten, with "Ruling: human named E<n> in Orca session a852f96a, 2026-10-15" beside each. Any other existing criterion that goes red: first ask whether the spec/plan change FORCES it (not load, not your bug). If forced, the human's blanket naming (2026-10-16) allows rewriting it whole, never loosened, with "Ruling: rewritten under the human's blanket naming (Orca session a852f96a, 2026-10-16) — <why>" beside it, and you list it (file:line, old vs new assertion) in a "Rewritten criteria" section of your report. If not forced, or unclear: STOP and report (NEEDS_CONTEXT). Published comments: append an ERRATUM, never edit in place.
- Never push, merge, rebase, amend, stash, reset, checkout, or delete a branch/worktree/clone. Never touch real user data (~/.orca, ~/.codex, real cache dirs) — every criterion that can reach the catalog cache sets CCLOOP_CACHE_DIR to a temp dir.
- Run the focused tests while iterating; before committing, run the task's named neighbour files. Commit per P-4 (git commit -F, the Co-Authored-By trailer, exact paths, never -A).
- You do not dispatch subagents — not helpers, not reviewers. Self-review = reading your own diff.
- If the work is beyond you or the brief is wrong, report BLOCKED / NEEDS_CONTEXT with specifics.

Report: write the full report to task-N-report.md in this dir: what you did; RED/GREEN evidence (commands, relevant output, log paths); each mutation named in the brief: applied (sha256 line), red seen in the named test (yes/no), restore byte counts; files changed; self-review; concerns. If later resumed with review findings: fix, re-run the covering tests, append a fix report (changes, tests, command, output) to the same file.
Reply with ONLY (under 15 lines): Status (DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT), commits (short sha + subject), one-line test summary, concerns, report path.
