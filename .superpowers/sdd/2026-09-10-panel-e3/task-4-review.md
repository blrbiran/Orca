# Task 4 review — static-file loader (Part A) + two Task 3 test debts (Part B)

Reviewed diff: `review-e4e2ad6..def1204.diff` (commits `de25a8b`, `def1204`). Read once, in full, plus the
brief, controller notes, implementer report, and spec §2.2/§3. Verified two things outside the diff for a
named risk: the full commit-message bodies (F2/commit-honesty check, via `git log -1 --format='%B'`) and
current `git status --porcelain` (Rule 17 / porcelain-listing claim). No tests or mutations re-run.

## Spec Compliance

✅ **Spec compliant.**

- **Part A (`src/panel/staticFiles.ts`, `tests/panel/staticFiles.test.ts`)** — matches spec §2.2 and the
  brief's Step 3 verbatim: `web/dist` is read once via `readdir(dir, { withFileTypes: true })`, only
  `entry.isFile()` entries are loaded into a `Map`, and `get(name)` is `assets.get(name)` with **no
  `join()` in the request path** (`src/panel/staticFiles.ts:212` in the brief / diff hunk at
  `staticFiles.ts` new-file lines "get: (name) => assets.get(name)"). Global constraint 5 ("static serving
  does no path joining... even with express present") is satisfied exactly.
- **F1** — `src/panel/server.ts` diff hunk touches only the comment block (10 lines changed, 3 files total
  in commit `de25a8b` per `git show --stat`); `loadStaticFiles` is not wired into `createPanelServer`, and
  the new comment correctly states Task 5/`buildApi` as the consumer. Matches the ruling exactly.
- **F2** — checked the full commit body of `de25a8b` (not just the subject line in the diff's commit list).
  The "Honest note" paragraph states predictions ("PREDICTED to flip", "An independent verifier measures
  this by actually running the mutation; this commit does not") and explicitly corrects the brief's
  `subdir/index.js` claim rather than repeating it. No "seen red" language for anything not witnessed.
  Commit `def1204`'s body does the same for P-10b ("Predicted (not run here...)"). Both satisfy Rule 12 and
  the F2 ruling.
- **F3** — all three required criteria are present in `tests/panel/staticFiles.test.ts`: F3.1
  (`panel-token-anchor-missing`), F3.2 (non-ENOENT `readdir` failure asserts the measured `ENOTDIR`, not
  `panel-dist-missing`), F3.3 (`notes.txt` → `application/octet-stream`, fixture scoped to that one `it()`
  per the stated choice, leaving the sorted-names/traversal criteria's expected lists untouched).
- **F4** — answered with real probes (errno, `path.join`, `readFileSync` trailing-slash) rather than
  assertion; correctly identifies `subdir/index.js` as a non-catcher (no `subdir/` exists on disk) and
  `./index.js` / `linked.txt` as predicted catchers for S-12.
- **F5** — `runPanelProcess` (new, `tests/panel/security.test.ts`) replaces `execFileAsync` for both
  real-process criteria; the lsof observation still uses `execFileAsync`, unchanged, as required. Mechanism
  review below.
- **F6** — two new criteria added at the `parsePanelArgs` level (not real-process), each supplies `--by
  "amy"` on every call, each passes `{}` as `env` (never `process.env`), and each has a positive control
  (`65535`, `k=/some/path`) so a guard that rejects everything cannot pass vacuously. Comment states the
  parse-level rationale (real-process would start a real server and hang) in the file itself, not only the
  report.
- **Commit split** — verified via `git show --stat`: commit `de25a8b` touches exactly `src/panel/server.ts`,
  `src/panel/staticFiles.ts`, `tests/panel/staticFiles.test.ts` (3 files, matches the ruling's list exactly);
  commit `def1204` touches exactly `tests/panel/security.test.ts` (1 file). No stray files in either commit.
- **Global constraints 1, 3, 6, 10** — English-only code/comments/commits (confirmed in both full commit
  bodies); `--by` supplied everywhere it's needed (F6, and the untouched existing real-process criteria);
  `0.0.0.0` does not appear anywhere in this diff (bind-guard mutation table is Task 3's, untouched here);
  the report's verifying runs (vitest, `npm run verify`) are described as redirected-and-read-whole, and
  the Step 5 survey `grep` the controller notes explicitly required as a survey (not a verifying run) is
  the only piped command, which is allowed.
- **Rule 17** — no new writes to a person's real `~/.orca` anywhere in this diff: Part A does no writes at
  all (read-only loader); Part B's F6 criteria pass `{}` as env, and the pre-existing `throwawayStore`
  redirect (`ORCA_CORRECTIONS_DIR`) is unchanged context, not new code from this diff. Independently
  reran `git status --porcelain -z` myself: exactly one line, ` M .superpowers/sdd/.../progress.md`,
  matching the report's claim (the report file itself is gitignored via `.superpowers/sdd/.gitignore`, so
  its absence from porcelain is correct, not a discrepancy).

⚠️ **Cannot verify from the diff alone**: the actual mutation outcomes (S-12…S-18, M-1, M-2, T-1) and the
P-10b re-run — by design, the implementer did not run them and an independent verifier does. The report's
predictions are internally consistent with the diff's code (spot-checked S-12, S-13, S-16, S-17 by tracing
the mutated code path against the fixture by hand), but "consistent reasoning" is not "measured" — the
controller should treat the verifier's actual mutation run as the authority, not this report's table.

## Strengths

- The F2 correction is real, not cosmetic: both commit messages state the S-12/traversal-list reasoning as
  a prediction an independent verifier will measure, and explicitly retract the brief's own wrong claim
  about `subdir/index.js` rather than silently keeping quiet about it. This is exactly the "honest note"
  discipline Rule 12 asks for.
- `runPanelProcess` (`tests/panel/security.test.ts`) correctly reasons through the `tsx` re-exec problem:
  killing only the immediate `tsx` pid would orphan the grandchild node process that actually calls
  `listen()`; `detached: true` + negated-pid `SIGKILL` reaches the whole process group, and the deadline
  always *rejects* on timeout (never resolves), so a hang cannot read as a pass under any of the three
  code paths (deadline fires, `exit` fires, `error` fires).
- F3.3's fixture-scoping choice (writing `notes.txt` inside that one `it()`, not the shared `beforeEach`) is
  exactly right and is called out explicitly in both the test file's comment and the report — it keeps the
  sorted-names and traversal criteria's expected lists untouched, which a shared-fixture edit would have
  broken silently.
- The existing exit-code / stderr / lsof assertions in the two real-process criteria are byte-for-byte
  unchanged in what they assert; only their wording (e.g. "execFileAsync has already returned" →
  "the child has already exited") was updated to stay true to the new code path. Nothing was weakened.

## Issues

### Critical (Must Fix)

None found.

### Important (Should Fix)

None found.

### Minor (Nice to Have)

- `tests/panel/security.test.ts` (F6, "rejects --port by name for a non-integer, for -1, and for 65536"):
  the loop's `expect(...).toThrowError(...)` on the first bad value (`"abc"`) throws an `AssertionError`
  and aborts the `it()` if it fails, so `"-1"` and `"65536"` are only exercised when `"abc"` already threw
  correctly — under the one listed mutation (M-1: delete the whole check) this is harmless since any one
  entry failing already proves the check is gone, but it means the criterion cannot distinguish "the whole
  guard is gone" from "the guard rejects non-integers but forgot the range check." The implementer's own
  report names this masking explicitly (mutation-prediction table, M-1 row), so it's disclosed, not hidden
  — flagging only because a future narrower mutation on the range check specifically would need its own
  criterion. Same shape applies to the `--repo` criterion one line below.
- `src/panel/staticFiles.ts`'s single `readdir(dir, { withFileTypes: true })` call only sees the top level
  of `web/dist`; a real Vite build that nests assets under a subdirectory (e.g. `web/dist/assets/*`) would
  have those files silently absent from the Map with no error. This is not a defect in this task — the
  implementation is the brief's Step 3 verbatim, and the flat, single-`readdir` design is explicitly the
  spec's "no path joining, no traversal" mechanism — but it is a design point Task 5 (wiring `staticFiles`
  into `buildApi`) or a controller review of the `web/` build output should confirm against the actual
  `web/package.json` build config before shipping, since nothing in Task 4's tests would catch a nested
  build output going dark.

## Assessment

**Task quality:** Approved.

**Reasoning:** Part A implements spec §2.2's exact-filename-Map requirement with no path joining anywhere
in the request path, and Part B's `runPanelProcess` genuinely closes the Task 3 leftover-process hazard
(whole-process-group kill on its own deadline, backstopped by `afterEach`, never reading a hang as a pass)
without weakening any pre-existing assertion. Every controller ruling (F1–F6) was implemented as specified,
commit messages state only what was actually measured or explicitly labeled as prediction, and the commit
split matches the required file lists exactly. The two Minor notes are disclosure/robustness observations,
not blockers.
