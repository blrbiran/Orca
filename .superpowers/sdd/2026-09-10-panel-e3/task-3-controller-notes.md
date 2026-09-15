# Task 3 — controller notes (binding; they override the brief where they conflict)

Read after `task-3-brief.md`. The brief is the requirements; these notes are rulings on points where the brief is
ambiguous, stale, self-contradictory, or predicted to break. Every "measure" below means: run it, redirect to a file,
read the file whole. Never pipe or grep a verifying run.

## General

- Repo `/Users/biran/code/skills/loop/Orca`, branch `main`. **BASE is given in your dispatch message.** Commit
  locally only. **Never push, branch, merge, or touch a worktree.**
- Use `/usr/bin/git` for every git command (plain `git` is rewritten through rtk, which prints `ok` for empty output).
- Scratch files in `mktemp -d` or
  `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/5d7759dc-1707-42cc-a35d-094bd09d4127/scratchpad/`.
  The brief's `/tmp/t3.txt` fixed names are NOT to be used.
- `/bin/rm` (local `rm` is aliased to `-i`); guard every variable in a destructive command with `"${VAR:?msg}"`.
- Code, comments, CLI help and commit messages in English.
- **You do NOT run the named mutations.** An independent verifier runs them after review. You DO run the Step 7
  survey grep and paste its output into your report.
- **No subagents. Do not write to `.decisions/`.** Do not touch `.superpowers/sdd/**` except your own report file
  (`progress.md` is the controller's ledger and is dirty on purpose while you work — leave it alone).

## Rulings

- **E1 — the brief's `server.ts` imports two modules that do not exist yet.** Its Step 5 block imports
  `./api.js` (`buildApi`) and `./staticFiles.js` (`loadStaticFiles`); those are built by Task 4 and Task 5.
  Copying it verbatim makes `tsc --noEmit` fail and takes the whole `npm run verify` red at this commit.
  **Ruling: land `server.ts` without those two imports.** Keep everything else from the block verbatim:
  `PanelOptions`, `StartedPanel`, `parsePanelArgs`, `createPanelServer` (guard → token → `new ReviewsWriter(
  opts.correctionsDir)` + `await reviews.load()` → express app with `express.json({ limit: "64kb" })` → `createServer`
  → `listen`), and `startPanelFromArgs`. Where `buildApi(...)` and `loadStaticFiles(...)` would have been, leave a
  one-line comment naming the task that wires each in (Task 5 for the API, Task 4 for the static files) — a comment,
  not a stub module, not an empty function.
  `ReviewsWriter` is real as of Task 2 (`src/panel/reviewsStore.ts`, `constructor(dir: string)`, `load()`,
  `append(row)`) — wire it now, do not defer it.
- **E2 — do NOT `it.skip` anything.** The brief's Step 6 says to skip the real-process criterion until Tasks 4/5
  exist. Under E1 that reason is gone: the criterion drives `orca panel --by amy --bind 192.0.2.1`, and the bind
  guard refuses **before** `listen()`, so it never reaches the API or the static files. Run it and report what you
  measured. If it fails for a reason that is not the guard, report `NEEDS_CONTEXT` with the evidence — do not put it
  to sleep. (A skipped criterion exits 0 in vitest; that is how one sleeps forever.)
- **E3 — the `--by` guard needs a criterion at CLI level (carried ruling R18).** Task 1's stub had a `--by` guard
  that no criterion pinned: the verifier deleted it and every criterion stayed green. Task 3 owns this now, and it
  replaces `server.ts` wholesale, so:
  1. keep the brief's `requires --by even on the loopback interface` criterion (it observes `parsePanelArgs`), AND
  2. add a criterion that runs the **real CLI** — `./node_modules/.bin/tsx src/cli.ts panel` with no `--by` — and
     asserts exit code 1 and `NO_VIEWER_IDENTITY` in stderr, with `ORCA_CORRECTIONS_DIR` redirected exactly as the
     bind criterion does. A CLI-level criterion survives the next rewrite of `server.ts`; a unit-level one does not.
  Name mutation **P-10b** in your report for the verifier: *delete the whole `if (by === undefined || by.length === 0)
  { throw … }` block from `parsePanelArgs`* — distinct from the brief's P-10 (which replaces it with a `"panel"`
  default). Predict which criteria go red for each, and run the survey grep before predicting.
- **E4 — `throwawayStore` is undefined in the brief** (its real-process criterion references it, and the brief
  declares it nowhere; carried ruling R4). Define it inside that criterion: `await mkdtemp(join(tmpdir(),
  "orca-panel-"))`, removed in a `finally`/`afterEach`. The child's env gets `ORCA_CORRECTIONS_DIR` pointing at it.
  The brief's own comment says it: a criterion whose isolation depends on the guard it is testing is not isolated.
- **E5 — `TOKEN_REQUIRED` has exactly one definition** (carried ruling R5): in `src/panel/rejection.ts`, beside
  `NO_VIEWER_IDENTITY`, with a comment naming Task 5's `api.ts` as its consumer. Task 5 imports it; it is not
  defined a second time there. `EXTERNAL_BIND_NOT_CONFIRMED` stays in `src/panel/bindGuard.ts` as the brief has it
  (that is where the criterion imports it from). Yes, `TOKEN_REQUIRED` has no consumer until Task 5 — that one-line
  forward declaration is the price of a single definition, and it is deliberate.
- **E6 — the listener check must not pass vacuously.** The brief's real-process criterion ends with
  `execFileAsync("lsof", …).catch(() => ({ stdout: "" }))` and then asserts the output does not contain the address.
  **If `lsof` is missing or errors, that catch turns the assertion into a tautology** — empty output contains
  nothing. Ruling: do not swallow the failure. Let a failing `lsof` fail the criterion with a message saying the
  observation could not be made. Also assert the command produced a non-empty listing before asserting what is
  absent from it.
  A per-pid filter (registered item R13) is **not** what this criterion needs: `execFileAsync` has already returned,
  so the child is gone and a pid filter would assert against an empty set by construction. Write that reason into
  the comment so the next reader does not "fix" it into a pid filter.
- **E7 — `0.0.0.0` must not appear anywhere** in the criteria, the fixtures, or the mutations you name
  (Global Constraint 6). `192.0.2.1` (RFC 5737 TEST-NET-1) is the address. Before you write any guard criterion,
  answer in your report: *what does this criterion do on the run where the guard is deleted?* For the bind criterion
  the answer must be "tries to bind an address that is on no interface of this machine and fails with
  EADDRNOTAVAIL, publishing nothing".
- **E8 — no criterion may resolve to the real `~/.orca`.** `parsePanelArgs` calls `correctionsDir(env)` at parse
  time, so every criterion that later starts a server, and every child process, passes a redirected
  `ORCA_CORRECTIONS_DIR`. After your run, `ls ~/.orca` must still print "No such file or directory" — measure it and
  put the output in your report.
- **E9 — registered, do not close it here:** the brief notes that the mutation P-2 (`server.address().address`)
  has no criterion in Task 3 and that Task 5 owes one. Leave that registration standing; the parse-level criterion
  asserting the default bind is the literal `127.0.0.1` stays as the brief writes it.
- **E10 — final checks, after the commit:**
  - `rtk proxy npm run verify > <file> 2>&1; echo "VERIFY_RC=$?" >> <file>`, read whole; report the three tiers
    separately (whole repo / `verify:scheduler` / `@orca/web check`). The baseline at your BASE is whole repo
    86 files / 485 tests, scheduler 51/167, web 1/1, VERIFY_RC=0.
  - `/usr/bin/git status --porcelain -z > <file>; wc -c < <file>` — expect it to be non-zero ONLY because of
    `.superpowers/sdd/2026-09-10-panel-e3/progress.md`, the controller's ledger. Nothing under `src/`, `tests/`,
    `web/` or `.decisions/` may be dirty after your commit. List what you saw.
  - `ls ~/.orca` → must still be absent.
  - Stage by explicit path: `/usr/bin/git add src/panel tests/panel`. Nothing else in the commit.
  - Commit trailer: name the model you actually are (an attribution naming a different model is a false statement in
    published text), then:
    `Claude-Session: https://claude.ai/code/session_01FbyaRyTGoLLJHDCuRffuNe`

## Report

Write the full report to
`/Users/biran/code/skills/loop/Orca/.superpowers/sdd/2026-09-10-panel-e3/task-3-report.md`: the Step 2 measured red,
the measured result of the real-process criterion (E2), the E7 answer, the survey grep, your predictions for P-1,
P-10 and P-10b, the three verify tiers, the porcelain listing, the `ls ~/.orca` output, and every deviation with its
reason. Final reply SHORT: status, commit sha, one-line test summary, concerns.
