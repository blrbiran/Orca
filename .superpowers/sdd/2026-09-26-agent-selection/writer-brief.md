# Plan writer brief — agent selection (Orca controller session 75ec878e, 2026-09-26)

You are a PLAN WRITER. You expand a subset of tasks of an implementation plan into full, bite-sized, TDD steps. You do NOT implement anything in the real repos.

## Read first (in this order)
1. Spec: `/Users/biran/code/skills/loop/Orca/docs/superpowers/specs/2026-09-26-agent-selection-design.md` — **§12 wins over the body** (the body was already edited per §12).
2. Plan skeleton (header, Global Constraints, **shared interfaces — you MUST use exactly these names/types**, task table): `/Users/biran/code/skills/loop/Orca/.superpowers/sdd/2026-09-26-agent-selection/plan-skeleton.md`.
3. The real code you touch, in `/Users/biran/code/skills/loop/ccloop` and/or `/Users/biran/code/skills/loop/Orca`. Read exports, callers and existing tests before writing any step (Rule 8). Every file:line you cite must be measured by you now.
4. Style reference for a plan in this project: `/Users/biran/code/skills/loop/Orca/docs/superpowers/plans/2026-09-25-handoff-delivery.md` (skim §0 and one task).

## What to produce
Write your part to the file named in your dispatch. Language: Chinese prose; code, identifiers, test names, commit messages in English. Structure:

1. `## <你的编号> 现量` — a table of what you measured that the steps depend on (file:line + the command you used), and every place the spec/skeleton does not match the code (**do not silently deviate**: list it with a suggested resolution; if a shared interface in the skeleton is wrong or insufficient, say exactly what you need changed — the controller decides).
2. For each of your tasks, the writing-plans task format:
   - `### Task N: <name>`; **Files** (Create/Modify with measured line ranges/Test); **Interfaces** (Consumes / Produces, using skeleton names).
   - Checkbox steps, each one action: write failing test (**full test code**), run it and state expected failure (exact command, output redirected to a file, e.g. `./node_modules/.bin/vitest run tests/x.test.ts > $S/tN-red.log 2>&1; echo rc=$?`), minimal implementation (**full code or exact edit with before/after anchors**), run to pass, **named mutation** for every new branch (what to delete, in a `git clone --local` copy, expected red), commit (English message + the two trailer lines from Global Constraints).
   - **Existing criteria that will go red**: list each by full name (file > describe > it), why, and the whole-rewrite (not loosening) you prescribe, with the required annotation comment.
3. No placeholders: no "TBD", "add error handling", "similar to Task N", "write tests for the above". Repeat code rather than referencing another task.

## Hard prohibitions
- Never modify, create or delete files in the real repos' working trees except your own output file under `.superpowers/sdd/2026-09-26-agent-selection/`. Never `git stash`/`checkout`/`reset`/`restore`/`commit`/`merge`/`push` in the real repos; never temporarily move/revert a file.
- If you want to probe behaviour, do it only in a `git clone --local` copy under `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/75ec878e-a6d3-4299-9a4b-b76dd574b77a/scratchpad/<your-id>/` (symlink `node_modules` from the real repo; for ccloop run `npm run build` in the copy before any E2E). Run only targeted single test files — **no full suites** (a production daemon runs on this machine; other writers run in parallel).
- Redirect every verification run to a file and read it back whole; do not pipe into grep/tail/head for verification.
- Do not claim human authorization. Do not estimate costs.

## Return
A ≤200-word summary: tasks written, number of spec/skeleton mismatches you found (titles), existing criteria that will go red (count), and anything the controller must decide.
