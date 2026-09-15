# Task 2 — controller notes (binding; they override the brief where they conflict)

Read after `task-2-brief.md`. The brief is the requirements; these notes are rulings on points where the brief is
ambiguous, stale, self-contradictory, or predicted to break. Every "measure" below means: run it, redirect to a file,
read the file whole. Never pipe or grep a verifying run.

## General

- Repo `/Users/biran/code/skills/loop/Orca`, branch `main`, BASE `f7b11ba`. Commit locally only.
  **Never push, branch, merge, or touch a worktree.**
- Use `/usr/bin/git` for every git command. Plain `git` is rewritten by a hook through rtk, which prints `ok`
  (2 bytes) for empty output — a porcelain check through it is worthless.
- Scratch files go in `mktemp -d` or
  `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/5d7759dc-1707-42cc-a35d-094bd09d4127/scratchpad/`.
  The brief's `/tmp/t2.txt` style fixed names are NOT to be used.
- Local `rm`/`cp` are aliased to `-i`: use `/bin/rm`, and guard every variable in a destructive command with
  `"${VAR:?msg}"`.
- Code, comments, CLI help and commit messages in English. Conversation with the controller in Chinese is fine.
- **You do NOT run the named mutations** (brief Step 7). An independent verifier runs them after review. You DO run the
  two "who else walks this line" greps in Step 7 and paste their output into your report.
- **No subagents.** Review comes from the controller after your report.
- **Do not write anything to `.decisions/`.** The controller appends the ledger row for plan ruling 5 itself.

## Rulings

- **D1 — the directory-mode comment describes code that is not there.** The brief's `reviewsStore.ts` comment (its
  "mkdir tells us which case we are in by returning the created path, or undefined when it was already there") promises
  a chmod decision the code block never makes: there is no `chmod` on the directory anywhere in it.
  **Ruling: keep the code as the brief writes it — `mkdir(this.dir, { recursive: true, mode: REVIEWS_DIR_MODE })`, no
  directory chmod — and rewrite the comment to state what the code actually does.** Two reasons: (a) conformance —
  `src/corrections/storeLock.ts:63` creates the corrections directory exactly this way, with mode on mkdir and no
  chmod (CLAUDE.md Rule 11); (b) a chmod-on-create would make the named mutation R-9b (delete `mode:` from the mkdir
  call) go green, i.e. it would add a redundant guard that no mutation can pin.
  The replacement comment must say: mkdir's `mode` is masked by the umask, which is why the criterion pins the umask
  rather than trusting the developer's; and an already-existing directory keeps whatever mode it has, because a
  recursive mkdir does not touch it — it is a person's directory and changing it is not this program's decision.
  **The file half keeps the brief's `writeFile(…, { flag: "wx", mode })` + `chmod` on the created path, unchanged.**

- **D2 — close the gap the brief registers instead of deferring it to Task 9.** The brief (its ⚠️ note after Step 5)
  says no criterion pins that an ALREADY EXISTING reviews directory keeps its own mode, and registers that as debt.
  It is one `it` block and this is the task that owns the code. **Add it now** to
  `tests/panel/reviewsStore.test.ts`:
  create the directory with mode `0o755` (mkdtemp then `chmod(dir, 0o755)`, with the same pinned umask as the
  neighbouring criteria), run `load()` + `append(row())`, assert `(await stat(dir)).mode & 0o777` is still `0o755`,
  and assert the FILE is `0o600` in the same criterion (the file is new even though the directory is not).
  Comment it with why: an existing directory belongs to the person, not to this program.
  This adds a fifth named mutation, **R-9c** (`add an unconditional `await chmod(this.dir, REVIEWS_DIR_MODE)` right
  after the mkdir`) — you do NOT run it; name it in your report so the verifier picks it up, with your prediction and
  the grep that supports it.

- **D3 — the commit message contains two claims that are not true at this commit.** Fix both before committing:
  1. "it resolves through `correctionsDir`, so `ORCA_CORRECTIONS_DIR` redirects it" — at this commit `ReviewsWriter`
     takes a `dir` argument and nothing in `src/` calls `correctionsDir` for reviews; that wiring is Task 3's.
     Write it as the design it is ("the path comes from the caller, which is the same `correctionsDir(env)` the
     corrections store resolves, so one environment variable redirects both"), not as something already wired.
  2. "Three named mutations, each seen red" — **you have not run them and there are more than three.** Replace that
     paragraph with the names of the mutations this task hands to the independent verifier (R-6, R-7, R-9, R-9b, and
     R-9c from D2), each with the prediction and the grep it rests on, stated as predictions.
  Also drop the closing "Known gap … Task 9 owes it" paragraph if you implemented D2, and say instead that the
  criterion is present.

- **D4 — the lock's first-red step is not optional** (brief Step 4 ⚠️). Write `acquireReviewsLock` with
  `mkdir(lockPath, { recursive: true, mode: REVIEWS_DIR_MODE })` FIRST, run the criteria, and **see
  `refuses by its OWN name when its OWN lock is held` go red** — paste the failure line (expected vs received) into
  your report. Only then change it to `{ mode: REVIEWS_DIR_MODE }` (no `recursive`) and see it green.
  A red that is a crash or a module-resolution error is not this red.

- **D5 — `UNIT_SEPARATOR` is not an empty string.** The literal in the brief is `"\037"` (U+001F); the Read tool does
  not render control characters, and an earlier scan seat misread it as `""`. After you write
  `src/panel/reviewsStore.ts`, run `od -c` on that line and confirm the byte `037` is there. If the byte did not
  survive the copy, write it as the escape `""` instead and say in your report which form you used and why.
  An empty separator would make `["a","bc"]` and `["ab","c"]` the same dedupe key — do not leave it empty.

- **D6 — one definition each.** `REVIEWS_STORE_BUSY` is defined in `src/panel/reviewsLock.ts` and nowhere else;
  `REVIEWS_DIR_MODE` / `REVIEWS_FILE_MODE` / `reviewsFile` / `reviewsLockDir` in `src/panel/paths.ts` and nowhere
  else. `PanelRejection` already exists in `src/panel/rejection.ts` (signature `(code, message, exitCode: 1|4|5 = 1)`)
  — import it, do not redeclare. Do not import `correctionsDir` in this task: an unused import is dead weight and
  Task 3 owns that wiring.

- **D7 — the criteria must not be able to touch a person's real data.** Every criterion writes only under its own
  `mkdtemp` directory (CLAUDE.md Rule 17). After the run, `ls ~/.orca` must still print
  "No such file or directory" — measure it and put the output in your report.

- **D8 — Step 2's expected red.** The brief predicts all criteria red with
  `Cannot find module '../../src/panel/paths.js'`. Paste what you actually measured; if the wording differs, report
  the wording, do not adjust the brief's claim silently.

- **D9 — final checks, after the commit:**
  - `rtk proxy npm run verify > <file> 2>&1; echo "VERIFY_RC=$?" >> <file>` — read it whole, and report the whole-repo
    `Test Files`/`Tests` line, the `verify:scheduler` one, and the `@orca/web check` one **separately** (three tiers;
    the baseline at BASE `f7b11ba` is whole repo 85/477, scheduler 51/167, web 1/1, VERIFY_RC=0).
  - `/usr/bin/git status --porcelain -z > <file>; wc -c < <file>` → must be 0.
  - `ls ~/.orca` → must still be absent.
  - Stage by explicit path: `/usr/bin/git add src/panel tests/panel`. Nothing else may be in the commit.
  - Commit trailer, exactly:
    ```
    Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_01FbyaRyTGoLLJHDCuRffuNe
    ```

## Report

Write the full report to
`/Users/biran/code/skills/loop/Orca/.superpowers/sdd/2026-09-10-panel-e3/task-2-report.md`, including: the D4 first-red
failure lines, the D8 measured red, the two Step 7 greps, the `od -c` output from D5, the three verify tiers, the
porcelain byte count, the `ls ~/.orca` output, and every deviation from the brief with its reason.
Return only: status (DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED), the commit sha, a one-line test summary,
and your concerns.
