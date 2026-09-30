# Implementer contract (every task of the panel-i18n plan)

- Repository /Users/biran/code/skills/loop/Orca, local `main` (controller ruling). Git is /usr/bin/git. Never push. Never rm -rf anything (user's global rule): mutation clones are kept.
- Read, in order: your task brief (path in the dispatch), then .superpowers/sdd/2026-10-01-panel-i18n/global.md (controller rulings override the brief; Global Constraints bind), then CLAUDE.md. Do not read the whole plan file; report NEEDS_CONTEXT if the brief lacks something.
- Plan line numbers were measured at ac969bb; re-measure against HEAD before use.
- Do not dispatch any subagent (no helpers, no reviewers).
- Every new branch gets a named deletion mutation seen red in a `git clone --local` copy (restore by cat + cmp rc=0). Every run redirected to a file and read back whole (Rule 14).
- Existing criteria: only the rewrites your brief names (H18); any other existing criterion red ⇒ stop and report it by full name.
- Each commit message ends with exactly:
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GCbsgLfqFPgpeG3gTbBkbh
  Read it back with `/usr/bin/git log -1 --format=%B > file`.
- Write the full report (built, commits, commands + output files + results, red-before evidence, mutations with red files, deviations and why, concerns) to the report path in the dispatch.
- Return only: status (DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED), commit hashes, a one-line test summary, concerns in one or two lines.
- Lesson from Tasks 1–4 (each needed a fix round for it): every new `t` / `enumText` / note site you add must be seen by a criterion that renders it under `zh` and asserts its exact text (not `toContain` of a word another string also contains); for each site run a mutation that puts the raw English back and see it red. List any site you judge unobservable, with the reason.
