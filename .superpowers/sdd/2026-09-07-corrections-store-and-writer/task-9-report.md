# Task 9 report — BLOCKED at Step 0

**Status: BLOCKED.** Step 0's measurement contradicts the guard design sketched in the
brief (Step 4's sample `gitState.ts`), in a way that is broader and more surprising than
the single example the brief warned about. I did not write `gitState.ts`, `originalDecision.ts`,
`correct.ts`'s closing path, or `tests/corrections/close.test.ts` beyond this investigation —
per the brief's own instruction ("STOP AND REPORT IT before writing the guard... I will rule
on it"), I stopped before committing to a guard list that my own measurement says is wrong.

No code was changed. No test was run against the real repository. Nothing touched
`~/.orca`: this report covers only Step 0, which is pure measurement in throwaway
repositories under the scratch directory; `withCorrectionsDir` was never invoked because no
implementation or test code was written.

---

## Step 0 — full measured table

Environment: `git version 2.50.1 (Apple Git-155)`, measured 2026-09-08, on this machine.
All repos are throwaway, built fresh under
`/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/0382dc91-a6ed-45b0-892e-34c2fbbc7a4a/scratchpad/task9/{guard,guard2,guard3,guard4}`,
never inside the Orca working tree. Measurement scripts (kept for inspection, not part of
the diff): `measure.sh`, `measure2.sh`, `measure3.sh`, `measure4.sh` in that same directory,
with raw output in the sibling `measured*.txt` files. Every "partial commit" cell below is
the literal result of `git commit -m "partial test" -- README.md` — i.e. a commit limited by
pathspec to the exact file the conflict/change touched, matching what the design brief
describes `orca correct --close` doing against `.decisions/<run>.jsonl`.

Setup for every scenario except the detached-HEAD-alone one: `init` → commit A ("init",
touches `README.md` + `other.md`) → commit B ("main change", touches `README.md`, on
`main`) → branch `feature` from A → commit C ("feature change", touches `README.md`
differently, on `feature`) → checkout back to `main`. So `main` and `feature` always
conflict on `README.md`, which is also the pathspec used for the partial commit.

| # | State constructed | `MERGE_HEAD` | `CHERRY_PICK_HEAD` | `REVERT_HEAD` | `rebase-merge` | `rebase-apply` | detached HEAD | unmerged | Partial commit (`git commit -m … -- README.md`) |
|---|---|---|---|---|---|---|---|---|---|
| (f) | clean control (no operation in progress) | absent | absent | absent | absent | absent | no | 0 | exit 1, "nothing to commit, working tree clean" (trivially allowed — no rejection) |
| (a) | `cherry-pick feature` conflicts; resolve via `git add README.md`; **do not** `--continue` | absent | **EXISTS** | absent | absent | absent | no | 0 | **exit 128**: `fatal: cannot do a partial commit during a cherry-pick.` |
| (b) | `cherry-pick -n feature`, **clean apply** (cherry-picked a commit that never touches `README.md`, so no conflict at all) | absent | absent | absent | absent | absent | no | 0 | exit 1, "nothing to commit" for `README.md` (trivial — the cherry-picked change was staged under a different path; no refusal) |
| (b′) | `cherry-pick -n feature` where `feature` **does** conflict with `README.md` (re-run to see whether `-n` ever sets `CHERRY_PICK_HEAD` even under conflict) | absent | **absent** | absent | absent | absent | no | 1 | **exit 0**, committed — i.e. allowed even with live conflict markers on disk, because `-n` never wrote `CHERRY_PICK_HEAD` in the first place |
| (c) | `revert -n HEAD`, **clean apply** (reverts the tip commit, no conflict) | absent | absent | **EXISTS** | absent | absent | no | 0 | **exit 0**, committed. `git status` confirms: "You are currently reverting commit …" is shown, yet the partial commit is accepted |
| (d) | `merge --squash feature` (conflicts on `README.md`) | absent | absent | absent | absent | absent | no | 1 | exit 0, committed (squash merge never sets `MERGE_HEAD` — it only leaves `SQUASH_MSG`, which the five tracked files don't cover, so this state trips none of the candidate guard's markers either way) |
| (e) | `revert --no-commit HEAD~1` conflicts; resolve via `git add README.md`; **do not** `--continue` | absent | absent | **EXISTS** | absent | absent | no | 0 | **exit 0**, committed. Same as (c): `REVERT_HEAD` present, partial commit still accepted |
| (extra) | plain conflicting `merge feature` (no `--squash`), resolved via `git add`, **not** committed | **EXISTS** | absent | absent | absent | absent | no | 0 | **exit 128**: `fatal: cannot do a partial commit during a merge.` — added to confirm `MERGE_HEAD` genuinely blocks, the way the brief assumes |
| (extra) | `rebase main feature` (ort/merge backend, git's current default) conflicts on `README.md`; resolve via `git add`; **do not** `--continue` | absent | absent | absent | **EXISTS** | absent | **YES** (rebase always detaches HEAD) | 0 | **exit 0**, committed as `[detached HEAD …] partial test` — i.e. allowed, despite `rebase-merge` present AND HEAD detached |
| (extra) | `rebase --apply main feature` (legacy am-based backend) conflicts on `README.md`; resolve via `git add`; **do not** `--continue` | absent | absent | absent | absent | **EXISTS** | **YES** | 0 | **exit 0**, committed — same result via the other rebase backend |
| (extra) | detached HEAD **alone**, no operation in progress (`git checkout --detach HEAD`) | absent | absent | absent | absent | absent | **YES** | 0 | exit 1, "nothing to commit" (trivial — `README.md` wasn't touched; no evidence detachment alone would ever cause git's own refusal) |

Exact refusal text, verbatim, from the tool output (both are the only two refusals observed anywhere in this measurement):

```
fatal: cannot do a partial commit during a merge.
```
```
fatal: cannot do a partial commit during a cherry-pick.
```

No other state — `REVERT_HEAD`, `rebase-merge`, `rebase-apply`, or a bare detached HEAD —
produced a refusal in any configuration tried (clean apply or conflict resolved-but-not-continued).

## The contradiction

The task brief's own framing (paraphrased in the task prompt, not just the sample code) says:

> The design says (a) is refused … while (b)–(e) are ALLOWED.

My measurement of (a)–(f) is fully **consistent** with that framing — nothing here
contradicts the six named scenarios' allowed/refused verdicts.

The contradiction is with the *guard's construction*, as sketched in the brief's Step 4
sample `gitState.ts` (and implicit in "the obvious three" language quoted in its own
docstring: merge / rebase / detached, plus cherry-pick added on top). That sample rejects
whenever **any** of `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `rebase-merge`,
`rebase-apply`, or a detached HEAD is present. But:

- **`REVERT_HEAD` is left behind by `revert -n` even on a clean, non-conflicting apply**, and by a
  resolved-but-not-continued revert conflict — and in **neither** case does git refuse the
  partial commit. Scenarios (c) and (e), which the brief says must be ALLOWED, are exactly
  the ones that leave this marker. A guard that rejects on `REVERT_HEAD` presence would
  refuse `orca correct --close` in precisely the states the design says must go through.
- **`rebase-merge` and `rebase-apply` behave the same way**: present after a
  resolved-but-not-continued rebase conflict (tested on both the modern ort/merge backend and
  the legacy apply/am backend), and in both cases git accepts the partial commit anyway. This
  state is not even one of the six named scenarios (a)–(f) — it is only in the guard's sample
  code — so there is no scenario in the brief's own table telling us it should be allowed; I
  am inferring "should probably be allowed" solely from git's observed behaviour, which is
  exactly the kind of design call the brief says is not mine to make silently.
- **A bare detached HEAD, with no operation in progress, never causes git to refuse anything.**
  It only appears in the naive guard's list, apparently, as a catch-all for "we're mid-rebase"
  (rebase always detaches HEAD) — but rebase itself doesn't block partial commits either, so
  detached-HEAD-as-signal is doing no correctness work I can find, only risk of unrelated
  false positives (e.g. someone legitimately checking out a specific commit to inspect
  something, with the target repo otherwise completely idle).

So, measured on this machine and this git version, only **two** of the five signals the
sample code checks (`MERGE_HEAD`, `CHERRY_PICK_HEAD`) correspond to an actual git-level
refusal of a partial commit. The other three (`REVERT_HEAD`, `rebase-merge`/`rebase-apply`,
detached HEAD) do not — including them would make the guard **over-reject**: it would refuse
to close a loop in a target repo that is mid-revert or mid-rebase, even though the exact
write `orca correct --close` needs to make (`git commit -m … -- .decisions/<run>.jsonl`)
would have gone through cleanly.

This is the same *shape* of problem the brief warned about with `cherry-pick -n`, just found
in the opposite direction and on different state files: instead of a state under-reported by
the naive guard (missing cherry-pick), I found three states over-reported by it (revert,
rebase×2, detached-alone) that would make the guard refuse in cases the design's own
allowed/refused table says must go through.

## What I am not deciding for you

Per the brief: "Which states to reject is a design judgement, not an implementation detail."
Two shapes of ruling seem live, and I don't think it's mine to pick between them silently:

1. **Guard on git's actual partial-commit-refusal behaviour only**: reject on `MERGE_HEAD` or
   `CHERRY_PICK_HEAD` alone. This is the narrowest guard that matches every measurement above,
   and it is also the guard `midOperationRejection`'s own docstring in the brief argues for in
   spirit (the whole point of Step 0 is "which state files predict a genuine `git commit`
   refusal" — the answer, measured, is just these two).
2. **Guard on "any git operation visibly in progress", even where the write would technically
   succeed** — i.e. keep `REVERT_HEAD` / `rebase-merge` / `rebase-apply` (and maybe detached
   HEAD) in the reject list anyway, as a product-level caution independent of whether git's
   commit machinery would allow it: writing two permanent, append-only ledger rows into a
   repository the human is visibly still in the middle of resolving something in feels like a
   bad idea even where git's own guard rail is silent, and per Rule 12 ("fail loud") an early,
   named refusal ("finish or abort your rebase first") is arguably kinder than an append that
   works but lands in a stale state.

I lean towards (1) reading the brief's Step 0 intent literally ("the thing that actually
matters — whether a PARTIAL commit is accepted or refused" is stated as the measurement's
whole point, and the guard's own message currently says "git refuses a partial commit in this
state" — which would be **false** to print for `REVERT_HEAD` or rebase, since git does not
refuse there). But (2) is a defensible product stance the brief's prose ("orca correct commits
the ledger by path") doesn't rule out, and getting it wrong here is irreversible in production
per this task's own framing — so I am stopping rather than picking.

## What I did NOT do, and why

- Did not write `src/corrections/gitState.ts` — its entire content is the guard whose
  membership is in question.
- Did not write `src/corrections/originalDecision.ts` — this piece is independent of the
  guard-list question and I could have implemented it, but the brief's Step 5 wiring threads
  `midOperationRejection` in as the very first check before *anything* else runs, so I judged
  it not worth writing and testing the rest of the closing path against a guard I expect to
  have to change, and then re-testing after a ruling — that would mean re-running (and
  re-reporting) the whole TDD/mutation cycle twice for no reason.
- Did not touch `src/corrections/correct.ts` or `tests/corrections/close.test.ts`.
- Did not touch `tests/corrections/harness.ts` (Ruling 1's `closeArgs` helper is still
  pending for the same reason — it's cheap to add once I'm unblocked, no need to land it
  separately).

## Files touched

None inside the repository. Scratch-only:
- `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/0382dc91-a6ed-45b0-892e-34c2fbbc7a4a/scratchpad/task9/measure.sh`, `measure2.sh`, `measure3.sh`, `measure4.sh`
- `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/0382dc91-a6ed-45b0-892e-34c2fbbc7a4a/scratchpad/task9/measured.txt`, `measured2.txt`, `measured3.txt`, `measured4.txt`
- Throwaway git repos under `.../scratchpad/task9/guard/`, `guard2/`, `guard3/`, `guard4/`

`git status` in the real working tree is unchanged (verified: no files under
`/Users/biran/code/skills/loop/Orca` other than this report itself were created or modified).

## Data-safety note (CLAUDE.md Rule 17 / harness Rule 14)

Every repo constructed for this measurement lives under the scratch directory named in the
task. No `ORCA_CORRECTIONS_DIR` was ever set and no code under `src/corrections/` was
executed, so there is no way this investigation could have touched `~/.orca`. Verified by
inspection: the only commands run were `git`, `mkdir`, `echo`, `cat`, and shell control flow
against paths under `/private/tmp/.../scratchpad/task9/`.

## Requested ruling

Please pick (1), (2), or a third shape (e.g. (1) plus a *separate*, differently-worded
warning for revert/rebase that isn't a hard rejection), and, if it isn't (1), tell me whether
the guard's message should keep claiming "git refuses a partial commit in this state" for
states where that sentence would be false. Once I have that, I can write `gitState.ts`,
`originalDecision.ts`, wire `correct.ts`, add `closeArgs` to the harness, and run the full
TDD + mutation cycle for Task 9 in one pass.

---

# Addendum — ruling received, Task 9 completed

**Status: DONE.** The coordinator ruled on the Step 0 contradiction above. This section
covers everything from the ruling onward: what was implemented, TDD evidence, every
mutation, files changed, self-review, and the data-safety check. The BLOCKED section above
is left verbatim (CLAUDE.md Rule 13) — it is not wrong, it is the record of why the ruling
was needed.

## The ruling

> `midOperationRejection` rejects THREE states, each for its own reason:
> 1. `MERGE_HEAD` — git refuses the partial commit.
> 2. `CHERRY_PICK_HEAD` — git refuses the partial commit.
> 3. HEAD detached — not because git refuses, but because the ledger commit would be
>    unreachable by any ref, which breaks Task 10's `git log --all -S<correctionId>`
>    idempotence check. This covers an in-progress rebase (which always detaches HEAD) by
>    construction, with no separate rebase check.
>
> DROPPED: `REVERT_HEAD`, `rebase-merge`, `rebase-apply` — measured allowed, so rejecting
> them is over-rejection. Keep the rebase markers for the MESSAGE only, never the verdict.

One line recording exactly what changed and why, as requested: the ruling drops
`REVERT_HEAD`, `rebase-merge`, and `rebase-apply` from the guard's **verdict** — measured (see
the table above and the "extra" rows added for merge/rebase/detached) as states where a
partial commit is NOT refused, and where two of them (`REVERT_HEAD`, `rebase-merge`/
`rebase-apply` on their own) leave HEAD attached — so rejecting them would refuse `--close` in
a target repo where the exact write it needs to make would succeed. `rebase-merge`/
`rebase-apply` are still read, but only to choose the wording of the detached-HEAD message
("a rebase is in progress" vs. "a detached HEAD"), never to decide whether to reject —
deliberately, so no mutation on that message-only branch could ever masquerade as covering
a control-flow path no criterion actually exercises (see the doc comment in `gitState.ts`
and the cross-reference to `src/ledger/validateLine.ts`'s two-guards-one-kill-switch lesson).

## What was implemented

- `src/corrections/originalDecision.ts` — `readOriginalDecision` / `DECISION_NOT_FOUND`,
  exactly as the brief's Step 3 sample (no changes needed from the ruling).
- `src/corrections/gitState.ts` — `midOperationRejection` / `TARGET_MID_OPERATION`,
  rewritten per the ruling: three states in the verdict (`MERGE_HEAD`, `CHERRY_PICK_HEAD`,
  detached HEAD), with `rebase-merge`/`rebase-apply` read only to word the detached-HEAD
  message. Full reasoning and the measured table are in the module's own doc comment.
- `src/corrections/correct.ts` — the closing path wired in, in the exact order the brief's
  Step 5 specifies: read-only guard → (non-`--close` only) original-decision read → repo
  lock → `try { store critical section → chose_instead check → single appendEvents } finally
  { repoLock.release() }`. `REPO_LOCKED` and `MISSING_CHOSE_INSTEAD` declared here (Ruling 2).
  `CLOSE_ARG_CONFLICT` imported from `args.ts`, not redeclared (Ruling 3).
- `tests/corrections/harness.ts` — `closeArgs` added and exported (Ruling 1).
- `tests/corrections/close.test.ts` — 15 criteria: the 11 from the brief's table (positive
  path, E16, E21, E11(a), E11(b), E8b, E19, E15, E4′, E3b, the `--close` conditional conflict,
  E6) plus 4 from the ruling (merge-in-progress rejection, detached-HEAD rejection, and the
  negative control for `revert -n`; E15 itself is unchanged in shape but is now explicitly
  one of exactly three guarded states rather than one item in a five-item list).
- A small follow-up commit fixed the detached-HEAD guard message, which originally read "is
  in the middle of a detached HEAD" (a category error — a detached HEAD is a state, not an
  activity) — now "has a detached HEAD". No logic change; caught in self-review.

## TDD evidence

RED (implementation removed, test file and harness left in place — `correct.ts` reverted to
its pre-Task-9 `throw new Error("unreachable until task 9")`, `gitState.ts` and
`originalDecision.ts` deleted):

```
$ ./node_modules/.bin/vitest run tests/corrections/close.test.ts
 Test Files  1 failed (1)
      Tests  15 failed (15)
```
Full output redirected to and read back from
`.../scratchpad/task9/close-RED.txt` — commit measured at: working tree at that moment (mid
Task 9, before the Task 9 commit existed). All 15 failures are `Error: unreachable until
task 9` except E4′, which fails on `expected [] to have a length of 1 but got +0` (its own
early assertion, since `readCorrections` naturally returns nothing when `correct()` never
ran).

GREEN (implementation restored):
```
$ ./node_modules/.bin/vitest run tests/corrections/close.test.ts
 Test Files  1 passed (1)
      Tests  15 passed (15)
```
Full output in `.../scratchpad/task9/close-GREEN.txt`.

`npm run verify` (measured at commit `0e294d7`, before the message-polish commit):
exit 0. Whole-repo tier: **69 files / 386 tests** (was 68/371; +1 file, +15 tests — exact
match). Scheduler tier: **51 files / 167 tests** (unchanged — `close.test.ts` is not in that
tier). Full output in `.../scratchpad/task9/verify1.txt`. Re-run after the message-polish
commit (`1b73f92`): same counts, exit 0, output in `.../scratchpad/task9/verify2.txt`.

## Mutations

All mutations were made in `git clone --local` copies under the scratch directory, never in
the working tree (`.../scratchpad/task9/mutclone`, `node_modules` symlinked from the real
repo, run via `./node_modules/.bin/vitest`, never `npx vitest`). Each mutation: apply →
shasum → run the targeted criterion → observe → `git checkout --` the one file → shasum
again to confirm restoration. All mutations were run against commit `0e294d7` (the
implementation commit, before the message-only polish in `1b73f92`, which changes no logic
and needed no re-mutation).

🔴 Note on the shasums below: full 64-hex-char sha256 digests, copied verbatim from the
`shasum -a 256` tool output for each step (never truncated, to avoid the transcription error
an earlier draft of this table had — caught and fixed before this report was finalized).

| # | Mutation | File | Before sha256 | After sha256 |
|---|---|---|---|---|
| 1 | E11(a): swap `DECISION_NOT_FOUND` message for check-5's wording | `originalDecision.ts` | `397759a08995c16a1bd767d33644b649b69e3ea79afecc0c966bbea6e877a0d5` | `347dc0768cd0d3d282f253c977301cac38427717541980e75eb7a3b74c9a0e12` |
| 2 | E11(b): move `readOriginalDecision` (close-new) to AFTER `recordCorrection` | `correct.ts` | `bc8856b2cb1a51deb62a5951df3f4708048908f4eaa5e6e08beb678f4650c3ec` | `492e662e7edb2d4c91c4a10adf93f504b87325807256a3b814f1b687e233a7cd` |
| 3 | Delete the `MERGE_HEAD` check | `gitState.ts` | `72ee2f4d4da57fc8db35721e3cbd64a3673db4dc5e108434a8d10f293932f4f5` | `043271bb6d85aef74028fbf7d86a4fef6fd7b9b9a73b4c92fa8a8c09efd23e15` |
| 4 | Delete the `CHERRY_PICK_HEAD` check (E15) | `gitState.ts` | `72ee2f4d4da57fc8db35721e3cbd64a3673db4dc5e108434a8d10f293932f4f5` | `9f118fa14e14801082f5e2b8ccd46060636102c9827a3afd5637a4a3e325ad0e` |
| 5 | Delete the detached-HEAD branch | `gitState.ts` | `72ee2f4d4da57fc8db35721e3cbd64a3673db4dc5e108434a8d10f293932f4f5` | `5cef8bcc50b0d40a0c572129237255f25a133baf3be5a47439e44b6968f5a04f` |
| 6 | Delete the whole take-lock section (E8b) | `correct.ts` | `bc8856b2cb1a51deb62a5951df3f4708048908f4eaa5e6e08beb678f4650c3ec` | `7d89cd308e24912ca9e00b166138c41e5da9cb9ff0db384516a62d46b441a0a2` |
| 7 | Move `repoLock.release()` from `finally` to just before `return 0` (E19) | `correct.ts` | `bc8856b2cb1a51deb62a5951df3f4708048908f4eaa5e6e08beb678f4650c3ec` | `604f5e003841d953235770280f5288976b152aa1e0fa2b49c10e6d373e0b05ed` |
| 8 | Swap order: `appendEvents` before `recordCorrection` (E4′) | `correct.ts` | `bc8856b2cb1a51deb62a5951df3f4708048908f4eaa5e6e08beb678f4650c3ec` | `f934a4e1c2615a5098dc558bad499f4716b8c56e6c15eeb3c339421defe0f17f` |
| 9 | Delete the `choseInstead === undefined` rejection (E3b) | `correct.ts` | `bc8856b2cb1a51deb62a5951df3f4708048908f4eaa5e6e08beb678f4650c3ec` | `3c6b457d00d7d3630b542cd71ab240b8701072aa361531d86c57305e6931b2a3` |
| 10 | Reuse `row.at` instead of a fresh clock read (E16) | `correct.ts` | `bc8856b2cb1a51deb62a5951df3f4708048908f4eaa5e6e08beb678f4650c3ec` | `56d0ee4f799e587ddd869017b7d0421ce2ed59bb7360cb8f2e7f160fd213caba` |
| 11 | Delete `"by"` from `CORRECTION_FIELDS` (E6, rerun at command level) | `fields.ts` | `a13f6efbf75897dae62dbb7a8f5bdc33bbec29a1c926227a2387882584f6f0a7` | `f3ba3defbee58602201c26a436d6aa05838d37f5f67e25ad36723ca3e0562acb` |

Every before/after pair above differs (confirmed by direct string comparison of the tool
output, not by eye), and every mutation was restored to its exact `Before` digest via
`git checkout --` before the next mutation began.

Predicted vs. actual red, one row per mutation:

| # | Predicted red | Actual red | Match? |
|---|---|---|---|
| 1 | E11(a) message assertion | **E11(a)** `expect(stderr).not.toContain("references unknown decision id")` — red, message now contains it | ✅ exact |
| 2 | E11(b) "corrections file absent" | **E11(b)** `expect(existsSync(...corrections.jsonl)).toBe(false)` — red, file now exists | ✅ exact |
| 3 | merge criterion, "nothing written" | **merge criterion**, but the **message assertion** (`toContain("rejected: target-mid-git-operation:")`), which is earlier in the test, went red first — see note below | ⚠️ killed, different assertion (expected per Rule 9) |
| 4 | E15 message assertion (brief's own prediction) | **E15** message assertion — red | ✅ exact |
| 5 | detached criterion, "nothing written" | **detached criterion**, message assertion went red first (same short-circuit as #3) | ⚠️ killed, different assertion (expected per Rule 9) |
| 6 | E8b `rejected: repo-locked:` message | **E8b** message assertion — red | ✅ exact |
| 7 | E19 "`orca-lock` absent" (the load-bearing assertion) | **E19** `expect(existsSync(.../orca-lock)).toBe(false)` — red | ✅ exact |
| 8 | E4′ "correction row on disk" (`rows` length 1) | **E4′** `expect(rows).toHaveLength(1)` — red (got 0) | ✅ exact |
| 9 | E3b message assertion | **Uncaught exception**: `refusing to append: rejected: chose: Required` from `appendEvents`' own schema check, four layers past where E3b expected to stop it — the test failed via a thrown error rather than a normal `expect` failure, since `captureStreams` has no `.rejects` guard | ⚠️ killed, but via an uncaught error, not the predicted assertion — see note |
| 10 | E16 "distinct from correction's own `at`" | **E16** `expect(at).not.toBe(correctionAt)` — red | ✅ exact |
| 11 | brief's own prediction: idempotence machinery (not yet built — that's Task 10) reports "already closed", exit 0, red on "two files" | **Uncaught exception**: `refusing to append: duplicate decision id "orca-fix-.../1"` — both corrections collide to the same id, `loadCorrection` returns the SAME (first) row for both `--close` calls, so both derive the same run id and the second call's `appendEvents` hits ledger writer Check B (duplicate decision id within a file) and throws. Still a genuine red (promise rejects), but NOT the brief's predicted mechanism | ⚠️ killed, but via a different (and more severe) mechanism than predicted — see note |

Every one of the 11 mutations was confirmed restored (`git checkout --`, shasum matched the
pre-mutation baseline) before moving to the next. Final confirmation: `diff -q` between every
touched file in the mutation clone and the corresponding file in the real working tree
reported no differences, and `close.test.ts` was green (15/15) in the clone at the end of the
round.

### Notes on the three "different assertion / mechanism than predicted" mutations (Rule 9 / Rule 12)

- **#3 and #5** (merge, detached): the ruling's prose predicted red on the "nothing was
  written" assertion. In practice the **message assertion, which the test puts first on
  purpose** (per this task's own instruction that message assertions must precede exit-code
  and write assertions so an earlier check can't hide a later one), goes red first, because
  removing the guard means the call never rejects at all — no "rejected:" text is ever
  printed. This is exactly the shape CLAUDE.md Rule 9 warns about ("「红在哪条断言」不是可靠的
  判别方式"): the mutation is still killed, just by whichever `expect` happens to sit first,
  not by the one whose *name* best matches the defect. I am reporting this rather than
  reordering the assertions to make the "written" one fire first, because doing so would
  violate the task's own ordering rule (message before exit code/writes) for a cosmetic match
  to a prediction.
- **#9** (E3b): the mutation is killed by an **uncaught exception** propagating out of
  `runCli`'s promise rather than a normal `expect(...)` failure inside the test body. This
  is a real, if unplanned, gap: with `MISSING_CHOSE_INSTEAD`'s guard removed, `choseInstead`
  stays `undefined` and reaches `deriveRows` → the ledger writer's own zod schema
  (`chose: z.string().min(1)`), which rejects it four layers past where the design intends
  the refusal to happen — the exact "message four layers from the cause" shape §12 finding 2
  and the guard's own docstring exist to prevent, just for a different field. The criterion
  still fails (vitest reports it as a failed test), so nothing is silently green — but it
  fails as an unhandled rejection with node's own stack trace, not as a named, exit-code-1
  `CorrectRejection`. I am not "fixing" this by adding error-shape assertions the brief never
  asked for; I am reporting it because it is a real defect surface, not a test-design defect:
  if a future change ever weakened this specific guard, a production `orca correct --close`
  would crash with a raw ledger-writer stack trace instead of a clean, actionable refusal.
- **#11** (E6): the brief's own predicted mechanism ("hits Task 10's not-yet-written
  idempotence check, reports 'already closed', exits 0") cannot fire in Task 9, because that
  machinery does not exist yet — Task 10 adds it. What actually happens in Task 9's code as
  it stands: both corrections collide to the same id, so `loadCorrection` for BOTH `--close`
  calls resolves to the FIRST stored row (Array.prototype.find on an id that is no longer
  unique), both close calls derive the identical run id, and the second call's `appendEvents`
  hits the ledger writer's own Check B (`duplicate decision id ... within a file`) and
  throws. The criterion is still killed (test fails), so it remains a valid, falsifiable
  criterion — but per this task's explicit instruction ("do NOT adjust the criterion —
  report it"), I am flagging that the brief's own narrative for this mutation assumed code
  that will only exist after Task 10 lands, and the actual failure today is an uncaught
  duplicate-id error rather than a graceful idempotent no-op. Task 10's author should be
  aware that until its idempotence check lands, two colliding corrections crash the second
  `--close` rather than politely refusing it — this may be exactly what Task 10 fixes, in
  which case this note is simply the "before" half of that story, not a new problem to solve
  in Task 9's scope (adding idempotence logic here would be doing Task 10's job under Task
  9's brief, which Rule 2/YAGNI rules out).

## Files changed

- `src/corrections/originalDecision.ts` (new)
- `src/corrections/gitState.ts` (new; message wording touched once more in `1b73f92`)
- `src/corrections/correct.ts` (modified: closing path wired in)
- `tests/corrections/harness.ts` (modified: `closeArgs` added)
- `tests/corrections/close.test.ts` (new: 15 criteria)

Commits: `0e294d7` (implementation) and `1b73f92` (message-wording self-review fix, no logic
change). Both on `main`, both local — no push, no branch, no worktree, no merge, per the
task's constraints.

## Self-review

- **Completeness**: every interface the brief's "Produces" list names
  (`DECISION_NOT_FOUND`/`readOriginalDecision`, `TARGET_MID_OPERATION`/
  `midOperationRejection`, `REPO_LOCKED`, `MISSING_CHOSE_INSTEAD`) exists with the exact
  string values specified. Step order matches the brief's Step 5 exactly except for the
  guard's internal state list, which the ruling explicitly changed.
- **Naming**: `REPO_LOCKED`/`MISSING_CHOSE_INSTEAD` live in `correct.ts` (Ruling 2, verified
  by `grep`), `CLOSE_ARG_CONFLICT` is imported from `args.ts` and not redeclared (Ruling 3).
- **YAGNI**: no retry logic, no stale-lock cleanup, no `--force`, no fourth guard branch for
  rebase (deliberately folded into the detached-HEAD verdict per the ruling's own
  "no redundant guard" instruction). `midOperationRejection`'s rebase-marker read exists
  solely to word the message, confirmed by the fact that deleting the detached-HEAD branch
  (mutation #5) — not a hypothetical separate rebase branch, because there isn't one —
  is what kills the detached/rebase criteria.
- **Could each criterion actually fail?**: yes for all 15 — proven twice, once by the global
  RED run (Step 2 style: whole implementation absent, all 15 failed) and again per-criterion
  by the 11 targeted mutations above, each confirmed to move that specific criterion (and
  only that one, via `-t` filters) from green to red.
- **Two shortcomings I would flag to a reviewer rather than silently accept**: (a) the E3b
  and E6 mutations surface that guard-removal failure modes downstream of `correct.ts`'s own
  checks are uncaught exceptions with raw stack traces, not clean `CorrectRejection`s — see
  the notes above; this is pre-existing behavior in `appendEvents`'s own error handling
  (a plain `Error`, never a `CorrectRejection`), not something Task 9 introduced, but Task 9's
  guards are the last line of defense against reaching that state, so it's worth naming.
  (b) The message-wording bug found and fixed in `1b73f92` ("is in the middle of a detached
  HEAD") shipped in the first commit and was only caught by re-reading my own diff — a
  reminder that "self-review" has to mean actually reading the text a human will see, not
  just confirming the tests pass.

## Data safety (CLAUDE.md Rule 17)

Every criterion in `close.test.ts` runs inside `withCorrectionsDir` (checked: every `it`
block's body is wrapped in `await withCorrectionsDir(async (dir) => { ... })` or
`await withCorrectionsDir(async () => { ... })` — confirmed by reading the whole file back,
not by grep alone, since a missing wrapper would not necessarily contain the string
`withCorrectionsDir` at the point of the omission). No test, fixture, or mutation run in this
session set `ORCA_CORRECTIONS_DIR` directly or touched `~/.orca` — the only writer of that
directory is `recordCorrection`/`appendCorrectionLocked` in `src/corrections/store.ts`, gated
by `correctionsDir()`, which every call in this task's tests reaches only through
`withCorrectionsDir`'s environment-variable override. Mutation testing ran in
`git clone --local` copies under the scratch directory, touching only files inside that
clone; the real working tree's `git status --porcelain` was empty before, during (verified
after each mutation was reverted), and after this task's work, apart from the two commits
listed above.

## Concerns for the reviewer

1. The E3b and E6 mutation notes above (uncaught exceptions reaching a person as raw stack
   traces rather than named refusals) are real, pre-existing gaps one layer below Task 9's
   own guards — not blocking for this task, but worth a follow-up ticket.
2. Task 10 should be aware that, until its idempotence check lands, two colliding
   correction ids crash the second `--close` (per mutation #11's actual observed behavior)
   rather than reporting "already closed" — if Task 10's own criteria assume a clean
   idempotent path today, they may need this task's E6 mutation finding as context.

---

# Fix round 1 — evidence only, no code change

Task review came back Approved, no Critical findings. The coordinator ruled on two mutation-
precision points raised by the reviewer:

1. **E3b / E6 uncaught-exception mutations — ACCEPTED, NO ACTION.** Registered as a known
   residual: the crash IS the failure mode each guard prevents, wrapping `appendEvents`'s
   errors as named refusals would be the wrong direction (an unexpected schema failure is
   what exit code 3 is for), and in real CLI use this already lands there via `cli.ts`'s
   top-level arm — the escape is visible only because tests call `main()` directly. No code
   changed for this point.

2. **The one thing run: a fault-injection mutation for the merge-in-progress and
   detached-HEAD criteria's "nothing was written" assertions.** The reviewer's concern: no
   existing mutation makes those two assertions go red on their own — every guard-deletion
   mutation trips the earlier message assertion first, so (per CLAUDE.md Rule 9) the
   "nothing written" checks had never been *seen* to fail and were, by that rule, not yet
   real criteria.

## The injection

Per the coordinator's exact specification: the guard's check, throw, and message are left
byte-for-byte unchanged; only its call site moves — from before the repo lock (its correct
position, 闭-3) to inside the `try`, immediately after the store's critical section (right
after `recordCorrection` has appended the row for the close-new path, before the
`choseInstead` check). This injects a write between "the guard would have refused" and "the
guard refuses."

Done in a fresh `git clone --local` copy at the current `HEAD` (`1b73f92`,
`.../scratchpad/task9/mutclone2`, `node_modules` symlinked, run via
`./node_modules/.bin/vitest`), never in the working tree.

**Shasums of `src/corrections/correct.ts`** (the only file touched):
- Before: `bc8856b2cb1a51deb62a5951df3f4708048908f4eaa5e6e08beb678f4650c3ec`
- After: `ce2c6a882e7ebbf79f002114991781d6ba4fbdbed25726316a205e4a641d8caf`

They differ, confirmed by direct string comparison. `npx tsc --noEmit` on the mutated copy
exits 0 (the relocation compiles cleanly — `decisionsDir`, `row`, and every other value the
relocated call needs are still in scope at its new position).

## Result: exactly as predicted

```
$ ./node_modules/.bin/vitest run tests/corrections/close.test.ts -t "merge|detached"

 ❯ tests/corrections/close.test.ts (15 tests | 2 failed | 13 skipped) 639ms
   × guard: refuses while a merge is unresolved, naming it, before reading or writing anything
     → expected true to be false // Object.is equality
   × guard: refuses a detached HEAD — not because git refuses the commit, but because it would be unreachable
     → expected true to be false // Object.is equality

 FAIL … > guard: refuses while a merge is unresolved …
AssertionError: expected true to be false // Object.is equality
 ❯ tests/corrections/close.test.ts:271:60
    269|         expect(stderr).toContain("a merge");
    270|         expect(rc).toBe(1);
    271|         expect(existsSync(join(dir, "corrections.jsonl"))).toBe(false);
       |                                                            ^

 FAIL … > guard: refuses a detached HEAD …
AssertionError: expected true to be false // Object.is equality
 ❯ tests/corrections/close.test.ts:307:60
    305|         expect(stderr).toContain("detached HEAD");
    306|         expect(rc).toBe(1);
    307|         expect(existsSync(join(dir, "corrections.jsonl"))).toBe(false);
       |                                                            ^

 Test Files  1 failed (1)
      Tests  2 failed | 13 skipped (15)
```
Full output: `.../scratchpad/task9/fr1-injection.txt`. Baseline run (same `-t` filter,
unmutated code) immediately before this, for contrast: both tests pass, output in
`.../scratchpad/task9/fr1-baseline.txt`.

**Which assertions passed, which went red, for both criteria:**
- `expect(stderr).toContain("rejected: target-mid-git-operation:")` — **passed** (the guard
  still fires, same code).
- `expect(stderr).toContain("a merge")` / `expect(stderr).toContain("detached HEAD")` —
  **passed** (same message, unchanged wording — the fault injection did not touch the
  guard's own code, only where it is called from).
- `expect(rc).toBe(1)` — **passed** (still a `CorrectRejection` with the default exit code).
- `expect(existsSync(join(dir, "corrections.jsonl"))).toBe(false)` — **RED**, for the first
  time, on both criteria. `existsSync` now returns `true`: the correction row was written by
  `recordCorrection` before the relocated guard call ever ran.
- The final `expect(await ledgerFiles(target.decisionsDir)).toEqual(before)` line was never
  reached (short-circuited by the assertion above it), consistent with Rule 9's "the earlier
  assertion fires first" and not itself evidence of anything.

This is exactly the outcome the coordinator predicted: the message and exit-code assertions
pass unchanged, and the "nothing was written" assertion — specifically the
`corrections.jsonl`-absence check — is now the one observed to fail, because it is the one
these two criteria's ordering actually protects. The `ledgerFiles` equality check one line
below it remains logically necessary (it is the ONLY assertion in these two criteria that
would catch a leak on the `.decisions/` side rather than the corrections-store side) but was
not itself independently exercised by this particular injection, since the corrections-store
write happens first in program order and its check comes first in the assertion order.

## Restoration

```
$ git checkout -- src/corrections/correct.ts
$ shasum -a 256 src/corrections/correct.ts
bc8856b2cb1a51deb62a5951df3f4708048908f4eaa5e6e08beb678f4650c3ec   # matches the pre-mutation baseline exactly
```
`diff tests/corrections/close.test.ts <working-tree's tests/corrections/close.test.ts>` —
empty (the test file was not touched by this round; only the guard's call site in
`correct.ts` was moved, and only inside the throwaway clone). `git status --porcelain` in the
real working tree was empty before, during, and after this round. The clone was deleted with
`/bin/rm -rf` after this evidence was collected.

## Outcome

No code change needed in the working tree — the injection produced exactly the result
predicted, so the "nothing was written" assertions in both the merge-in-progress and
detached-HEAD criteria are now confirmed to be real, falsifiable criteria per Rule 9, not
decorative ones. No commit made for this round.
