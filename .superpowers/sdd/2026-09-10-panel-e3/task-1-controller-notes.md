# Task 0 + Task 1 — controller notes (binding; they override the brief where they conflict)

Read after `task-0-brief.md` and `task-1-brief.md`. The briefs are the requirements; these notes are rulings on points where the
brief is ambiguous, stale, or predicted to break. Every "measure" below means: run it, redirect to a file, read the file whole.

## General

- Repo `/Users/biran/code/skills/loop/Orca`, branch `main`, BASE `eab103e`. Commit locally only. Never push, branch, merge, or touch worktrees.
- Use `/usr/bin/git` for every git command (plain `git status` is rewritten by a hook through rtk and prints `ok` for empty output).
- Do not write verifying output to `/tmp/…` fixed names as the brief does; use `mktemp -d` or
  `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/6354277a-65a9-4350-bd38-f099d586198e/scratchpad/`. Never pipe or grep a verifying run.
- Local `rm`/`cp` are aliased to `-i`: use `/bin/rm`. Guard every variable in a destructive command with `"${VAR:?msg}"`.
- Code, comments, CLI help and commit messages in English.
- **Do NOT run mutation W-1 (brief Step 10).** An independent verifier runs it after review. Do run the "who else walks this" grep of
  Step 10 and put its output in your report.

## Task 0

- Run the re-check (adapt paths per General). Record each item as "matches spec" / "changed" with the measured value.
- The brief says any "changed" item must be reported to the human before coding. The human has ruled for this round: **proceed on the
  controller's recommendation and report at the end.** So: a changed item that does not affect Task 1's code -> record it (report + commit
  body) and continue. A changed item that DOES affect what Task 1 builds -> stop and report NEEDS_CONTEXT with the evidence.
- Expected per brief: root deps `zod` only; `command === ` count 6; `STORE_LOCK_TIMEOUT_MS = 1_000`; dedupe key `(projectKey, decisionId, by)` without kind;
  decision count will differ from spec's 137 (not a defect).

## Task 1 rulings

- C1 `package.json`: EDIT the existing file into the brief's target state; do not overwrite blindly. If the real file has fields the brief's block
  omits, keep them and say so in the report. Install with `npm install` (network is authorised for this task). `web/package-lock.json` must not exist;
  if it appears, stop (Global Constraint 8).
- C2 React 19 types have no global `JSX` namespace. If `App(): JSX.Element` fails tsc, use `import type { JSX } from "react"` (keep the explicit return type).
- C3 `web/vite.config.ts` has a `test` key. If tsc rejects it with `defineConfig` from "vite", import `defineConfig` from "vitest/config" instead. Nothing else changes.
- C4 `web`'s `check` runs `vitest run` and web has zero test files in Task 1. Measure whether that exits non-zero ("No test files found").
  If it does: do NOT add `--passWithNoTests` (a gate that passes on nothing is a silent gate). Add ONE real smoke criterion
  `web/tests/App.test.tsx` that renders `<App />` with `renderToStaticMarkup` from `react-dom/server` and asserts the markup contains `orca panel`
  (plan ruling 2: frontend criteria use renderToStaticMarkup, no jsdom). Comment why it exists.
- C5 Root isolation: measure whether root `tsc -p tsconfig.json` or root `vitest run` now picks up anything under `web/`. If either does, exclude
  `web/**` in the ROOT config (web is checked by its own `check`), and say which file you changed and why. If neither does, change nothing.
- C6 spec §3.3 requires the sentence that external mode suits one person across their own machines and not a team to appear in the `--bind`
  help text. The brief's USAGE block carries it, but nothing pins it. Add a criterion to `tests/panel/workspace.test.ts` — or a new
  `tests/panel/usage.test.ts` if the CLI help is better observed from a real process/USAGE export — that asserts the help text printed by the real
  CLI contains `does not suit a team` and `--i-know-this-is-exposed`. Observe it the way existing CLI criteria do (check `tests/cli/cli.test.ts` for how
  usage is captured); do not export new symbols from cli.ts just for the test unless there is no other way, and say which you chose.
- C7 Step 2 predicts "5 red". Red means red on the assertion (e.g. `expected undefined to deeply equal [ 'web' ]`), not a crash. Paste the failure lines.
- C8 The commit message in Step 11 cites `.decisions/orca-dev-ad1e30c6.jsonl entries 1 and 2`. Verify both rows exist and are the React and express
  decisions before using that sentence. Add one paragraph with the Task 0 results. Add a line for any C2–C6 ruling that fired. End with:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_017wXReUvdTXTRSQqnKYSBdY
  ```
  Stage by explicit path (package.json, package-lock.json, web/…, src/panel/…, src/cli.ts, tests/panel/…, and any root config changed under C5).
  The brief's `git add` omits `src/cli.ts` — include it.
- C9 Final checks after commit: `rtk proxy npm run verify > <file> 2>&1; echo "VERIFY_RC=$?" >> <file>`, read whole; report whole-repo Test Files/Tests,
  verify:scheduler Test Files/Tests, and the web check's output separately. `/usr/bin/git status --porcelain -z | wc -c` → 0 (redirect to a file first).
  `ls ~/.orca` must still be absent. `ls web/dist` — say whether a build artifact exists and whether it is gitignored (it must not be committed).
