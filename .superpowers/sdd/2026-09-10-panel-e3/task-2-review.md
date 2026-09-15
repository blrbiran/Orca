# Task 2 review — reviews store

Reviewer: controller-side review agent. Reviewed at commit `4bcaa9e37b771b5dccb46805bfb8d6114a4271e1` (HEAD at
review time; confirmed via `/usr/bin/git log --oneline -15` — 4bcaa9e is the top commit, ahead of f7b11ba which
the outer session's git-status snapshot showed as HEAD, so that snapshot predates this task's commit).
No subagents used, per controller notes.

## Verdict 1 — Spec compliance: ✅

Every file, export, and interface the brief's "Produces" list requires is present exactly as specified
(`src/panel/paths.ts`, `reviewsLock.ts`, `reviewsStore.ts`, `tests/panel/reviewsStore.test.ts`; confirmed against
`git show --stat 4bcaa9e` — only those 4 files, 303 insertions, 0 deletions, nothing else in the commit). All nine
controller rulings D1–D9 are implemented, not just claimed:

- D1: code kept exactly as the brief wrote it (`mkdir(this.dir, { recursive: true, mode: REVIEWS_DIR_MODE })`, no
  directory `chmod`), comment rewritten to describe that code, matching `storeLock.ts:63`'s pattern.
- D2: the fifth criterion ("leaves an already-existing directory's mode alone…") is present, chmods the dir to
  0o755 *before* calling `load()`/`append()` and asserts *after* — it exercises the production `mkdir` call, not
  the test's own setup (verified below).
- D3: commit message (read live via `/usr/bin/git log -1 4bcaa9e`) contains neither false claim — it states
  `ReviewsWriter` takes a `dir` argument and that Task 3 wires `correctionsDir`, and lists five mutations as
  predictions handed to the verifier, explicitly "none were executed by this task." Both replacements are true at
  this commit.
- D4: report shows the mandatory first-red (`recursive: true` version) failing exactly and only "refuses by its
  OWN name…" with a real assertion failure (`promise resolved "'written'" instead of rejecting`), not a crash —
  the committed code uses `{ mode: REVIEWS_DIR_MODE }` without `recursive`, matching the post-fix state.
- D5: confirmed independently — read the raw bytes of `src/panel/reviewsStore.ts` line 20 with a Python script;
  the line is literally `const UNIT_SEPARATOR = "\x1f";` (backslash-x-1-f, four source chars), matching the
  report. Not empty. `decisionId`/`by`/`action` are identifiers/enum values that don't contain 0x1F, so
  `["a","bc"]` and `["ab","c"]` cannot collide.
- D6: `REVIEWS_STORE_BUSY` defined only in `reviewsLock.ts`; `REVIEWS_DIR_MODE`/`REVIEWS_FILE_MODE`/`reviewsFile`/
  `reviewsLockDir` only in `paths.ts`; `PanelRejection` imported from `rejection.ts`, not redeclared;
  `correctionsDir` is not imported anywhere in the diff.
- D7: reproduced live — `ls ~/.orca` still prints "No such file or directory" after this review's own commands.
- D8: report's measured wording (Vite's `Failed to load url …/paths.js`) differs from the brief's predicted Node
  wording and says so instead of silently matching the brief. Reasonable — all 8 criteria failed to collect.
- D9: reproduced live: `4bcaa9e` is HEAD; `git status --porcelain -z` is still 52 bytes from the same pre-existing
  `progress.md` edit the report names (confirmed via `git diff --stat` — that file, nothing else); the committed
  tree contains exactly `src/panel` + `tests/panel`; the trailer deviation is flagged in both report and commit
  (see Task quality, Minor).

Nothing extra was built: no `correctionsDir` wiring (explicitly deferred to Task 3 per D6), no CLI/`--by` plumbing,
no target-repo writes, no `.decisions/` writes, no git commit outside this repo's own history. `reviewsLockDir`
(`.reviews-lock`) and corrections' `storeLockDir` (`.corrections-lock`, confirmed in `src/corrections/paths.ts:20`)
are distinct paths, and the "does NOT share the corrections lock" criterion proves it end-to-end by holding one and
writing through the other.

## Verdict 2 — Task quality: Approved

Findings:

- **Important** — `ReviewsWriter.append`'s dedupe check (`if (this.seen.has(key(row))) return "duplicate"`) runs
  synchronously *before* the lock is acquired and `this.seen.add(...)` runs only *after* the write completes. Two
  concurrent `append()` calls on the *same instance* with the same `(decisionId, by, action)` can both pass the
  `seen.has` check before either finishes, so both proceed to the lock and both write a row — a duplicate despite
  the documented "in-process dedupe" guarantee. No criterion exercises concurrent calls on one instance (all
  existing tests await sequentially), so this is invisible to the current suite. Out of this task's contracted
  scope (brief/controller notes never asked for atomicity across in-flight concurrent calls) and fixing it here
  would exceed Rule 3's surgical-change bar, but it undercuts the store's own stated guarantee and is worth
  flagging to the controller for a future task.
- **Minor** — Commit trailer reads `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`, not controller notes
  D9's literal `Claude Opus 5 (1M context) <noreply@anthropic.com>`. The report flags this transparently and gives
  a defensible reason (a same-session system-level instruction that claims to supersede task-file attribution, and
  states the accurate model). It is nonetheless inconsistent with this SDD round's other commits (e.g. `f7b11ba`
  uses the Opus trailer) and the controller notes' explicit instruction — worth the controller's explicit
  ratification either way, but not a functional defect.
- **Minor** — `git status --porcelain -z` is 52 bytes, not the 0 D9 asks for, solely from a pre-existing dirty
  `progress.md` (the controller's own dispatch log, predating this task) that the implementer correctly diagnosed,
  left untouched (Rule 3/13), and did not stage. Reproduced live at review time — same 52 bytes, same file. Not
  caused by this task; still an open item for the round to close before it's declared clean.

No Critical findings. Test ordering throughout satisfies CLAUDE.md Rule 9 (every mode/dedupe assertion sits after
the call under test, on a value the test did not just write itself — verified line-by-line, including the D2
criterion, which would go red under mutation R-9c per the report's own reasoning). Code matches
`src/corrections/storeLock.ts`'s conventions by deliberate design (Rule 11), is minimal (Rule 2), and touches
nothing outside `src/panel`/`tests/panel` (Rule 3).
