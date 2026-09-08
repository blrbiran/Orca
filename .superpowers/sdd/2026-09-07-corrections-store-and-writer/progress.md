# SDD ledger — plan: docs/superpowers/plans/2026-09-07-corrections-store-and-writer.md

Controller: run `orca-dev-0382dc91`, 2026-09-07. Spec:
docs/superpowers/specs/2026-09-06-corrections-store-and-writer-design.md (read in the
prescribed order: §14.0 overturn table → §14 → only the §1–§13 parts §14 did not overturn).

Ruling: NO isolated worktree — work lands directly on `main` as local commits.
  Why: this repo's CLAUDE.md Rule 15 makes creating/deleting a worktree or branch a
  human-authorised act, and every prior round here landed local commits on main.
  User instructions outrank skill defaults (superpowers:using-superpowers says so).
  Cost if wrong: the working tree is shared with whatever else touches this repo;
  mitigated by every task running `git status --porcelain` before and after.
Ruling: NO push, no branch, no merge, no worktree deletion in any task.
  Cost if wrong: none — this is the repo's Rule 15, not a judgement call.

Baseline measured 2026-09-07 at e2f081b (before any task):
  `npm run verify` exit 0 — whole repo 60 files / 317 tests, scheduler tier 51 / 167.
  `git status --porcelain` 0 bytes. Remote refs/heads/main = e2f081b.
  Plan + ledger commits: 791e7bc, a66b9f1 (local, unpushed).

## Pre-flight conflict scan (run before Task 1)

Per-task self-agreement (does the task's own text agree with itself: tests vs code,
files created vs files later touched):

| Task | Self-agreement | Found |
|---|---|---|
| 1 appendEvents | tests import `appendEvents` from writer.ts; code exports it | clean |
| 2 projectKey | tests import CorrectRejection + projectKey; both created in this task | clean |
| 3 paths/storeLock | tests import CORRECTIONS_DIR_MODE, storeLockDir, acquireStoreLock | clean |
| 4 fields | tests import CORRECTION_FIELDS/canonical/derive*; runId.ts append is comment-only | clean |
| 5 store | tests import withStoreLock (T3), deriveCorrectionId (T4), Correction type | clean |
| 6 derive | tests import appendEvents (T1) for E12 | clean |
| 7 args | tests call parseCorrectArgs directly, never the CLI | 🔴 see F2 |
| 8 record | harness.ts created here; correct.ts created here | clean |
| 9 close | close.test.ts defines `closeArgs`; correct.ts gains the closing line | 🔴 see F1, F3 |
| 10 commit | commit.test.ts uses `closeArgs` and `readCorrections` | 🔴 see F1 |
| 11 acceptance | manual run + README + verify + ledger + handoffs | clean |

Cross-task pairs that share a file or an interface:

| A → B | A produces | B consumes | Found |
|---|---|---|---|
| 1 → 6, 9 | `appendEvents(dir, runId, events[])` | E12 test; 闭-7 | clean |
| 2 → 3,5,7,8,9,10 | `CorrectRejection(code, message, exitCode=1)` | thrown everywhere | clean |
| 2 → 8 | `projectKeyOf(repo)`, TARGET_HAS_NO_REMOTE | sharedPreflight | clean |
| 3 → 5 | `withStoreLock`, `correctionsFile`, CORRECTIONS_FILE_MODE | critical section, append | clean |
| 3 → 8 | `correctionsDir(env)` | correct() | clean |
| 4 → 5,8,9,10 | `deriveCorrectionId`, `deriveFixRunId(row, id)`, CorrectionRow | fixtures, record, run id, E5a mutation | clean |
| 5 → 8,9,10 | `recordCorrection`, `loadCorrection`, `readCorrections` | record mode, 闭-6, assertions | clean |
| 6 → 9 | `deriveRows(input)` | 闭-7 | clean |
| 7 → 8,9 | `parseCorrectArgs`, ParsedCorrect, CLOSE_ARG_CONFLICT | correct() | clean |
| 8 → 9,10 | `correct(argv)`, `sharedPreflight`, harness.ts | both later tasks modify correct.ts | clean |
| 9 → 10 | `midOperationRejection`, gitState.ts, close.test.ts helpers | commit + idempotence | 🔴 F1 |

Findings and rulings (ruled before Task 1 was dispatched):

F1. `closeArgs(...)` is defined inside Task 9's `close.test.ts`, and Task 10's
    `commit.test.ts` uses it — a test helper cannot be imported across two test files
    the way the plan is written.
    Ruling: Task 9 puts `closeArgs` in `tests/corrections/harness.ts` and exports it;
    Task 10 imports it from there. Why: harness.ts already exists (Task 8) and is where
    every other shared fixture lives. Cost if wrong: a one-line import move.

F2. Task 7 wires `correct` into `src/cli.ts` and calls `correct(args)` — but
    `src/corrections/correct.ts` is not created until Task 8, so Task 7's own commit
    would not typecheck.
    Ruling: Task 7 is `src/corrections/args.ts` + its tests ONLY. The `cli.ts` wiring,
    the USAGE block and `runCorrect`'s exit-code mapping move into Task 8, where
    correct.ts is born. Why: the plan's Global Constraint 1 requires `npm run verify`
    (which runs typecheck) to be green at every commit. Cost if wrong: the CLI surface
    lands one task later than the plan drew it; no behaviour changes.

F3. `REPO_LOCKED` and `MISSING_CHOSE_INSTEAD` appear in Task 9's Interfaces block with
    no stated home.
    Ruling: both are defined in `src/corrections/correct.ts` next to the code that
    throws them — they are command-level refusals, not store or git-state ones.
    Cost if wrong: a two-line move.

F4. Note, not a conflict: no task adds a file under `tests/scheduler/`, so the scheduler
    tier stays 51/167 for the whole plan while the whole-repo tier grows. The plan's
    Global Constraint 1 already warns not to mix the two counts.

Open question carried to Task 7 (asked of the human, NOT ruled by me):
  §14.24 implemented literally means `kind=not_my_taste` can no longer be recorded
  without closing the loop. Controller's recommendation on the table: implement §14.24
  literally AND add an explicit `--record-only` escape hatch named in the
  MISSING_CLOSING_HALF rejection message, with its own criterion (E3c). Tasks 1–6 do
  not depend on the answer.

## Tasks
Task 1: dispatched (implementer, sonnet) at BASE a66b9f1 — brief task-1-brief.md, report task-1-report.md
Task 1: implementer returned DONE_WITH_CONCERNS (commit 3226148). Existing criteria
  unchanged before/after: writer.test.ts 25/25, validateFile.test.ts 15/15. New
  appendEvents.test.ts 5/5. `npm run verify` RC=0, whole repo 61 files/322 tests,
  scheduler tier 51/167.
Task 1: Ruling: the implementer's concern is CORRECT and it is a defect in MY plan text,
  not in its work. E18's criterion throws inside the prospective validateFile check, which
  runs BEFORE any write — so a mutation confined to the final `appendFile` statement can
  never reach it, and the plan's Step 7 warning ("only replace the last statement") made
  that worse. Spec §14.18 E18's mutation reads "让 appendEvents 改成每个事件一次
  appendFile", which means a full per-event append (validate THEN write, per event) — the
  two-appends behaviour §14.1 exists to replace. That mutation leaves the decision row on
  disk and the overturned rejected, which is exactly the orphan state E18 pins.
  ⇒ Plan Task 1 Step 7 row 2 is overridden: the mutation is "make appendEvents loop the
  WHOLE single-event path per event", and it must be seen red on E18's own assertion.
  Cost if wrong: E18 — the central claim of §14.1 — would stay unfalsifiable, which is the
  exact defect three review seats already caught twice in this spec. Not parkable.
  Also: the implementer's substitute mutation (drop the separator) duplicates mutation 4,
  so E18 currently has NO killing mutation at all. Fix round 1 opens on this.
Task 1: fix round 1/5 (1 addressed, 0 open — E18's mutation corrected to a full per-event
  append; red confirmed on E18's own existsSync assertion, in clones only; no commits, no
  source or test change was needed)
Task 1: task reviewer dispatched (sonnet) over a66b9f1..3226148, package
  review-a66b9f1..3226148.diff (15511 bytes)
Task 1: review clean — spec ✅, quality Approved, 0 Critical / 0 Important.
Task 1: ⚠️ item resolved by the controller myself: `rtk proxy npm run verify` re-run on
  3226148 → RC=0, whole repo 61 files/322 tests, scheduler tier 51/167, porcelain 0 bytes.
  (Baseline was 60/317 and 51/167 — the scheduler tier is unchanged as predicted by F4.)
Task 1: minor (deferred): the fix-round mutation is described in prose in the report, not
  shown as a byte-exact patch — reproducible from the shasums + red output, but a future
  reader cannot re-derive the exact edit.
Task 1: minor (deferred): writer.ts's `id as string` casts in the two-scope Check B are a
  pre-existing style pattern carried over, no behavioural effect.
Task 1: complete (commits a66b9f1..3226148, review clean)
Task 2: dispatched (implementer, sonnet) at BASE 3226148 — brief task-2-brief.md, report task-2-report.md
Task 2: implementer returned DONE (commit 9e2608c). 5/5 new tests; whole repo 62 files/327
  tests, scheduler tier 51/167; `npm run verify` RC=0 (implementer's numbers, controller
  re-checks at task close).
Task 2: task reviewer dispatched (sonnet) over 3226148..9e2608c, package
  review-3226148..9e2608c.diff (7353 bytes). Reviewer told to diff the two regexes against
  ccmem's project-key.mjs character for character and to check the tests for the two
  never-red shapes (assert-before-call, and `.catch(e => e)`).
Task 2: review clean — spec ✅, quality Approved, 0 Critical / 0 Important. Reviewer
  independently read ccmem's project-key.mjs and confirmed both regexes are character-for-
  character identical and the path: fallback is absent; also confirmed the no-remote
  criterion uses .then(onFulfilled, onRejected), not .catch(e => e).
Task 2: minor (deferred): projectKey.ts's `.catch(() => "")` collapses every execFile
  failure (git missing, unreadable repo) into the same "has no remote" message. Mirrors
  ccmem's own behaviour; a later task that trips it should widen the message.
Task 2: complete (commits 3226148..9e2608c, review clean)
Task 2: controller re-check on 9e2608c — `rtk proxy npm run verify` RC=0, whole repo
  62 files/327 tests, scheduler tier 51/167, porcelain 0 bytes.
Task 3: dispatched (implementer, sonnet) at BASE 9e2608c — brief task-3-brief.md, report task-3-report.md

## Standing instruction from the human (2026-09-07, mid-round — binds the rest of this round)

"这一轮执行过程中如果有问题，先按你的建议执行。执行完在最后阶段报给我审核。"
⇒ Ruling: the open §14.24 question is hereby settled by that standing authorisation, in the
  form the controller recommended and put in front of the human:
  Task 7 implements §14.24 LITERALLY (either closing argument expresses closing intent;
  the missing half is a named refusal) AND adds an explicit `--record-only` escape hatch,
  NAMED INSIDE the MISSING_CLOSING_HALF rejection message so nobody has to remember it.
  Why: implementing §14.24 alone makes a kind=not_my_taste correction impossible to record
  without closing, which forces the person to invent an `undo.how` on the spot — and that
  invented text lands in the APPEND-ONLY ledger. Upstream's own ruling refuses to coerce
  content for exactly this reason ("被迫编造的内容不可逆"), and §14.4 uses the same argument
  when it refuses to buy convenience on the irreversible side.
  §14.23 lesson 8 therefore applies: a new user-visible input gets its own criterion in the
  same round ⇒ E3c: `--chose-instead` + `--record-only` records only and exits 0; mutation
  "make --record-only a no-op" must be seen red.
  Cost if wrong: one flag in the CLI surface, fully reversible — the CLI is not append-only.

## End-of-round obligations (do NOT do these until every task is complete)

1. Update `docs/handoff/handoff.md` in all three repos.
   - Orca: APPEND a new section (never edit earlier ones in place).
   - ccloop and ccmem: REWRITE THE "Orca" SECTION IN PLACE — the human ruled 2026-09-02, and
     again on 09-05/09-06/09-07, that the Orca sections must NOT grow without bound. No new
     numbered chapters. Prove non-interference the way prior rounds did: sha256 of the
     content outside that section, before and after.
   - ⚠️ ccmem: another agent has been working in it. Check with the human before writing,
     and re-measure its worktree state at the moment of writing.
2. ⚠️ Do NOT write hard git HEADs into any handoff: committing the handoff itself moves HEAD,
   and the human pushes the remote mid-session. Refer to commits by their SUBJECT LINE; say
   "run `git ls-remote` yourself" for publication state. Measured values may be written, but
   only with the observation anchor they were measured at.
3. Write a fuller handoff doc to the OS temp directory (the /handoff skill's own output), and
   give the human a SHORT executive summary (≤10 lines) in chat, NOT in a file.
4. Report the round for the human's review before considering it closed.
Task 3: implementer returned DONE (commit 7ce7dbf). whole repo 63 files/332 tests,
  scheduler tier 51/167, RC=0; all 4 mutations red as predicted (implementer's numbers).
Task 3: controller's own Rule 17 check, run on 7ce7dbf: `ls ~/.orca` → "No such file or
  directory". The real user store does not exist, so no criterion in this task (or any
  earlier one) wrote into it.
Task 3: task reviewer dispatched (sonnet) over 9e2608c..7ce7dbf, package
  review-9e2608c..7ce7dbf.diff (9697 bytes). Told to check both lock asymmetries
  (recursive parent / non-recursive lock dir), the umask pin-and-restore, absence of stale
  recovery, and whether any timing criterion is probabilistic.
Task 3: review — spec ❌, quality Needs fixes. 0 Critical, 1 Important (plan-mandated), 3 Minor.
Task 3: Ruling: the Important finding is REAL and it is my plan text's defect, not the
  implementer's. `mkdir(lockDir)` at storeLock.ts:44 has no mode, so `.corrections-lock` is
  0755 under a 0022 umask. CLAUDE.md Rule 17 and spec §14.17 both say "新建的目录与文件显式
  给 mode（目录 0700／文件 0600），不从 umask 继承" with NO qualifier, and this directory is
  created inside the user's global data. The parent being 0700 mitigates but does not
  satisfy the rule — and it stops mitigating the moment ORCA_CORRECTIONS_DIR points
  somewhere looser. ⇒ Fix, one line, plus an assertion so the fix is pinned.
  Cost if wrong: a world-readable empty lock directory; low, but the rule is unqualified.
Task 3: Ruling: reviewer's Minor 2 is UPGRADED to Important and enters the same fix round.
  It reports that "releasing twice is not an error" passes even if the `released` guard is
  deleted (rm --force tolerates a missing directory). In THIS repository a criterion that
  cannot go red is a defect by CLAUDE.md Rule 9's first corollary — and the vacuous shape
  was mandated by my plan's Step 1 test code, so the plan does not get to grade itself.
  The guard's real purpose is pinnable: release → let a SECOND holder acquire → call the
  first holder's release() again → the second holder's lock directory must still exist.
  Cost if wrong: a slightly larger criterion; none.
Task 3: minor (deferred): storeLock.ts's `readFile(...).catch(() => "(no info file)")`
  swallows non-ENOENT errors into the diagnostic string (Rule 12 shape, message-only path).
Task 3: minor (deferred): repoLock.ts/storeLock.ts share a mkdir/info/rm shape; not
  extractable without a parameterised abstraction over two genuinely different behaviours.
Task 3: fix round 1/5 opened — 2 findings sent to the original implementer.
Task 3: fix round 1/5 — implementer returned DONE (commit 0543550, "fix(corrections): pin
  the lock directory's mode, and make the release-guard test able to fail"). Focused file
  5/5, `npm run verify` RC=0, counts unchanged (63/332, 51/167). Scoped re-review dispatched
  (sonnet) over 7ce7dbf..0543550, package review-7ce7dbf..0543550.diff (5270 bytes).
Task 3: the first scoped re-review seat FAILED (harness stall: no progress for 600s, stream
  watchdog did not recover). Not a verdict — no findings were judged. Re-dispatched a fresh
  seat with identical inputs.
Task 3: the SECOND scoped re-review seat also failed the same way (600s stall, no verdict).
  Inputs measured: brief 10.4K, report 16.5K, fix diff 5.1K — 33K total, so size is not the
  cause; the harness flaked twice on identical small inputs.
Task 3: Ruling: the controller verified fix round 1 himself instead of dispatching a third
  seat. Why: two seats had already burned ~20 minutes producing no verdict, the fix diff is
  109 lines, and both findings are single concrete assertions — a third seat was a coin flip
  with the same inputs. What was verified, first-hand, in a `git clone --local` copy (both
  shasums differed, the copy's test file diffed byte-identical to the working tree's before
  deletion, and the copy was removed afterwards):
    - Finding 1 ADDRESSED: `mkdir(lockDir, { mode: CORRECTIONS_DIR_MODE })`, still
      NON-recursive, EEXIST branch untouched. Mutation "drop the mode argument" → red at
      storeLock.test.ts:98, `expected 493 to be 448` (0o755 vs 0o700) — on the LOCK-directory
      assertion, while line 97's store-directory assertion stayed GREEN, which is what proves
      the newly added assertion is the one holding this line.
    - Finding 2 ADDRESSED: criterion rewritten to acquire → release → second acquires →
      stale first.release() → lock dir must still exist. Mutation "delete the `released`
      guard" → red at storeLock.test.ts:78, `expected false to be true`. AssertionError, not
      a crash; 1 failed / 4 passed both times.
  ⚠️ A trap worth keeping: the first attempt ran `npx vitest` inside the clone, which has no
  node_modules — npx fetched vitest@5 and died on a config import. RC=1, and NONE of it was
  the criterion going red. Symlink the main repo's node_modules into the clone and run
  ./node_modules/.bin/vitest. A startup error is not a mutation kill.
  Cost if wrong: one fix round went without an independent seat; the whole-branch review at
  the end still sees this diff.
Task 3: controller re-check on 0543550 — `rtk proxy npm run verify` RC=0, whole repo
  63 files/332 tests, scheduler tier 51/167, porcelain 0 bytes, `ls ~/.orca` still absent.
Task 3: fix round 1/5 (2 addressed, 0 open; commits 7ce7dbf..0543550)
Task 3: complete (commits 9e2608c..0543550, review clean after fix round 1)
Task 4: dispatched (implementer, sonnet) at BASE 0543550 — brief task-4-brief.md, report task-4-report.md
Task 4: implementer returned DONE_WITH_CONCERNS (commit 5add041). whole repo 64 files/336
  tests, scheduler tier 51/167, RC=0, runId.test.ts still green. Mutation 1 (delete "by")
  killed BOTH assertions, measured directly rather than inferred from short-circuited
  output — the task's central purpose is met. Mutation 3 red as predicted.
Task 4: Ruling: the implementer's second concern is CORRECT and is another defect in my
  plan's test code. The criterion "serialises the fields in the declared order" cannot
  discriminate its own mutation (`JSON.stringify(row)`, i.e. the object's own key order),
  because my fixture literal happens to list its keys in exactly CORRECTION_FIELDS order —
  so both spellings produce identical bytes. Same class as Task 3's finding 2: a criterion
  that cannot go red is not a criterion (CLAUDE.md Rule 9, first corollary), and the shape
  was mandated by my plan text, which does not get to grade itself.
  ⇒ Fix round 1: scramble the fixture's key order so it differs from CORRECTION_FIELDS, and
  re-run mutation 2 to see it red. The ids are unaffected — canonicalCorrectionJson reads
  the constant, not the object, which is exactly what the criterion is meant to prove.
  Cost if wrong: one reordered fixture literal; none.
Task 4: fix round 1/5 (1 addressed, 0 open; commits 5add041..227f91a). The completion
  notification warned that the safety classifier was unavailable while reviewing that
  subagent's work, so the controller verified the load-bearing claims FIRST-HAND in a
  `git clone --local` copy (both shasums differed each time; the copy's test file diffed
  byte-identical to the working tree's before deletion; copy removed):
    - Mutation 1 (delete "by" from CORRECTION_FIELDS): the criterion goes red at
      fields.test.ts:47 — but line 47 SHORT-CIRCUITS line 48, so "红在哪条断言" proves
      nothing about the run-id half on its own. Measured it directly with a probe instead:
      under the mutation, correctionId amy == bob == c_5cef6c5437b4de02 AND runId amy ==
      bob == orca-fix-1c1a95fb. Positive control on the unmutated copy: both differ
      (c_e6e1034795c9f7f3 vs c_043758299f697c8d, orca-fix-437585d8 vs orca-fix-b8c6b1c0).
      ⇒ `by` genuinely reaches BOTH derivations through the one constant. The invariant
      A' §3.1 rests on now has a mutation with a single landing point — which is the entire
      purpose of this task, and it is the thing three review seats could not get to hold.
    - Mutation 2 (canonicalCorrectionJson → JSON.stringify(row)): now red at
      fields.test.ts:57 on the toEqual, showing the fixture's scrambled key order. Before
      the fix it was green.
Task 4: task reviewer dispatched (sonnet) over 0543550..227f91a.
Task 4: review — spec ✅, quality Approved, 0 Critical / 0 Important, 2 Minor. Reviewer
  independently confirmed there is no second field-sequence list anywhere in src/, and that
  runId.ts's diff is additions-only with every pre-existing line byte-identical.
Task 4: Ruling: reviewer's Minor 1 is taken into a fix round anyway (a Minor would normally
  be deferred). `CORRECTION_FIELDS` is not constrained to `keyof CorrectionRow`, so a typo
  in it resolves to undefined and is silently dropped from BOTH derivations — with no
  compiler error and nothing red except for `by`, the one field a criterion covers. This
  constant is the single source of truth the whole task exists to create, and the fix is one
  `satisfies` clause with zero runtime effect that turns a silent degradation into a compile
  error. Cost if wrong: one line; none.
Task 4: minor (deferred): criterion 3's two assertions can short-circuit, so one vitest run
  cannot show both routes broke together. Plan-mandated. Detection power is unaffected (if
  only the run-id route broke, assertion 1 passes and assertion 2 still fires), and the
  controller's own probe already measured both routes collapsing under the `by` mutation.
Task 4: fix round 2/5 opened — 1 finding (the satisfies constraint).
Task 4: fix round 2/5 (1 addressed, 0 open; commit 3f9a1ae). `as const satisfies readonly
  (keyof CorrectionRow)[]` — implementer showed TS2820 naming the bad literal when a typo is
  introduced in a clone, so the compile-time guard has been SEEN to reject.
Task 4: Ruling: no separate re-review seat for fix round 2. It is a one-line type-level
  constraint with no runtime effect; the controller verified it directly (read the constant
  on HEAD, `npm run verify` RC=0, tuple type unchanged since the field-order criterion still
  passes unmodified). Two scoped re-review seats had already stalled in this session with no
  verdict, so the seat was not worth its odds here. Cost if wrong: the whole-branch review at
  the end still sees this diff.
Task 4: controller re-check on 3f9a1ae — `rtk proxy npm run verify` RC=0, whole repo
  64 files/336 tests, scheduler tier 51/167, porcelain 0 bytes.
Task 4: complete (commits 0543550..3f9a1ae, review clean after 2 fix rounds)
Task 5: dispatched (implementer, sonnet) at BASE 3f9a1ae — brief task-5-brief.md, report task-5-report.md
Task 5: the implementer was cut off mid-run by a transport error
  (UNKNOWN_CERTIFICATE_VERIFICATION_ERROR), just before mutation testing. Controller
  measured the state: HEAD still 3f9a1ae (nothing committed), porcelain lists exactly two
  untracked files (src/corrections/store.ts, tests/corrections/store.test.ts), no earlier
  task's files disturbed. Resumed the same agent from its intact context rather than
  re-dispatching, and warned it that `git clone --local` carries only COMMITTED state — so
  with the work uncommitted it must `cat` both files into each copy and prove them
  byte-identical before mutating, or it would be mutating a copy that does not contain the
  code under test.

## Amendment to the end-of-round obligations (human, 2026-09-08 — supersedes item 1's ccmem clause)

*** ccmem's handoff is NOT to be updated this round *** — another agent is working in it.
Update ONLY:
  - Orca `docs/handoff/handoff.md`: APPEND a new section, never edit earlier ones.
  - ccloop `docs/handoff/handoff.md`: REWRITE THE ORCA SECTION IN PLACE. No new numbered
    chapters — the human has now ruled this four times (2026-09-02, 09-05, 09-06, 09-08).
    Prove non-interference: sha256 of the content outside that section, before and after.
Everything else in the original obligations still stands: no hard git HEADs anywhere (refer
to commits by SUBJECT LINE; publication state is "run `git ls-remote` yourself"); measured
values only with the anchor they were measured at; a fuller handoff doc goes to the OS temp
directory; a SHORT executive summary (≤10 lines) goes to the human in chat, not in a file;
report the round for review before considering it closed.
Task 5: implementer returned DONE (commit a182a4c) after two transport interruptions and
  two resumes. 8/8 new criteria; whole repo 65 files/344 tests, scheduler tier 51/167,
  RC=0; all 7 mutations killed the predicted criterion with no crash-reds (implementer's
  claims — the reviewer and the controller check them).
Task 5: review clean — spec ✅, quality Approved, 0 Critical / 0 Important. Reviewer traced
  the critical section against storeLock.ts's actual guarantee, confirmed the semantic key
  is (projectKey, decisionId, by), confirmed no criterion can reach the real ~/.orca, and
  confirmed all seven mutations land on the predicted assertion with differing shasums.
Task 5: minor (deferred): the concurrency criterion's margin (P1 sleeps 200ms vs a sub-ms
  local read) is generous but not formally guaranteed — under extreme contention a false
  PASS on defective code is theoretically possible. No flakiness observed. Named here so a
  future reader does not mistake it for a proof.
Task 5: minor (deferred): appendCorrectionLocked re-parses the row with correctionSchema
  even though recordCorrection cannot construct an invalid one — guards a future caller of
  the exported primitive; specified verbatim in the brief.
Task 5: ⚠️ item resolved by the controller — `rtk proxy npm run verify` on a182a4c: RC=0,
  whole repo 65 files/344 tests, scheduler tier 51/167, porcelain 0 bytes, `ls ~/.orca`
  still "No such file or directory" (five tasks in, the real user store has never existed).
Task 5: complete (commits 3f9a1ae..a182a4c, review clean)
Task 6: dispatched (implementer, sonnet) at BASE a182a4c — brief task-6-brief.md, report task-6-report.md
Task 6: implementer returned DONE_WITH_CONCERNS (commit 263f9b2). whole repo 66 files/348
  tests (+1 file/+4 criteria), scheduler tier 51/167, RC=0. All ten mutations killed,
  including mutation 5 after the fixture's scope/kind were changed in the COPY to task/
  boundary so the hard-coding mutation actually differs from the fixture.
Task 6: Ruling: the implementer's E12 concern is CORRECT and is a fourth defect in my plan's
  test code. E12 claims "fail the append rather than write a downgraded row", but its fixture
  never puts the original decision in the temp dir — so the overturned row's reference is
  unresolvable and the batch could not have succeeded under ANY implementation. Under the
  mutation the criterion still goes red, but only because one rejection replaced another;
  it never observes the thing it is named for, which is that the write does NOT happen.
  ⇒ Fix round 1: seed the original decision into the temp dir first (its own run file, so
  check 5 resolves through the sibling scan), leaving the non-executable undo.how as the ONLY
  obstacle. Then under the mutation the append SUCCEEDS and the criterion goes red on the
  promise resolving — plus an explicit assertion that the ledger file does not exist.
  Cost if wrong: a slightly larger fixture; none. Not parkable: an assertion that can only
  ever see "some rejection" is the weak shape three review seats already hunted in this spec.
Task 6: fix round 1/5 opened — 1 finding.
Task 6: fix round 1/5 (1 addressed, 0 open; commit 6aa20df). Mutation 10 re-run with the
  original decision seeded: the append now SUCCEEDS under the mutation and the criterion
  reds on "promise resolved instead of rejecting" — the sharp observation E12 was named for,
  instead of one rejection replacing another.
Task 6: task reviewer dispatched (sonnet) over a182a4c..6aa20df.
Task 6: review clean — spec ✅, quality Approved, 0 Critical / 0 Important. Reviewer traced
  the writer's actual check ORDER to confirm the fix genuinely isolates undo.how as the sole
  failure path, and confirmed mutation 5's report shows the discriminating fixture change
  plus a sanity run of unmutated code against it.
Task 6: minor (deferred): the added existsSync assertion adds little independent power —
  appendEvents does not create the file until after all validation, so the preceding
  rejects.toThrow would fail first. Harmless.
Task 6: controller re-check — `rtk proxy npm run verify` RC=0, whole repo 66 files/348
  tests, scheduler tier 51/167, porcelain 0 bytes.
Task 6: complete (commits a182a4c..6aa20df, review clean after fix round 1)
Task 7: dispatched (implementer, sonnet) at BASE 6aa20df — brief task-7-brief.md, report
  task-7-report.md. Dispatch carries TWO overrides of the brief, both already ruled and
  ledgered: (F2) cli.ts wiring moves to Task 8 so this task's own commit typechecks; and the
  `--record-only` escape hatch with criterion E3c and its "make the flag a no-op" mutation,
  named inside the MISSING_CLOSING_HALF message so nobody has to remember it exists. Also
  told it to replace the brief's `--no-git-identity-for-test` PLACEHOLDER with an injected
  resolver seam rather than a real flag.
Task 7: implementer returned DONE (commit f487039). whole repo 67 files/359 tests (+11),
  scheduler tier 51/167, RC=0; all 5 mutations killed their predicted criteria. It added two
  rejection codes the brief did not name — UNKNOWN_ARGUMENT and MISSING_REQUIRED_ARGUMENT —
  and flagged them itself. ⇒ Task 8's dispatch must carry the fact that the code list is now
  five, not three.
Task 7: task reviewer dispatched (sonnet) over 6aa20df..f487039.
Task 7: review — spec ❌, quality Needs fixes. 1 Critical, 2 Important, 3 Minor. The reviewer
  reproduced the Critical directly in its own clone (working tree confirmed untouched
  afterwards) and also RETRACTED one of its own suspicions after a targeted mutation run —
  both are the behaviour this process wants from a seat.
Task 7: Ruling: all three of Critical + the two Importants go into one fix round.
  1. CRITICAL, real: `flagValue` reads argv[index+1], and `findUnknownToken` skips the value
     slot without checking it exists. A trailing value-flag therefore reads as "not given":
     `--close` at the end of argv silently becomes a RECORD run that exits 0. That is the
     same silent mode-flip (E3 / spec §14.24) this entire task exists to eliminate, arriving
     through a different door. Fix: a value-flag whose value slot is ABSENT, or whose value
     slot is EXACTLY a recognised flag name, is a named refusal.
     ⚠️ Boundary I am fixing deliberately: refuse only on an exact match against the known
     flag list, NOT on any token starting with "--". `--because "--foo"` must stay legal; a
     value that is exactly `--kind` is vanishingly rare and refusing it loudly beats
     consuming it silently.
  2. IMPORTANT: MISSING_REQUIRED_ARGUMENT has zero criteria. The same standard this round
     applied to --record-only applies to it — a rejection path with no criterion is as good
     as absent.
  3. IMPORTANT: a repeated value-flag silently resolves first-wins (`--kind wrong --kind
     stale` keeps `wrong`). Not mandated by the brief, but it is the same
     silently-reinterpret-malformed-input family, at a front door where refusing costs one
     clear sentence. Rule 12 says fail loud.
  New code: MALFORMED_ARGUMENT = "malformed-argument" covers both 1 and 3, with the message
  naming the offending flag. Code list becomes six; Task 8 must carry that.
  Cost if wrong: one more word in the CLI's refusal vocabulary, fully reversible.
Task 7: fix round 1/5 opened — 3 findings.
Task 7: fix round 1/5 (3 addressed, 0 open; commit 5e0ce09). Scoped re-review verdict: all
  three addressed, no new breakage, and specifically NO over-broad refusal — the exact-match
  design refuses only a value that is literally one of the known flag strings, so
  `--because "--not a flag, a reason"` still parses (negative control at
  args.test.ts:164-170 is a real discriminator). The re-reviewer independently reproduced
  two mutations in its own clone and recomputed the pre-mutation sha256 from a fresh clone
  of HEAD to check the report's hashes. All 8 new criteria put the message assertion first.
Task 7: minor (deferred): a human's --because text that is EXACTLY a flag name (e.g. the
  literal string "--again") is now refused. Named tradeoff from the ruling, not a defect.
Task 7: minor (deferred): the --close + --record-only criterion asserts only the code, not
  that the message names both flags (the implementation does name both).
Task 7: complete (commits 6aa20df..5e0ce09, review clean after fix round 1)
Task 8: implementer returned DONE (commit 679a019). whole repo 68 files/371 tests,
  scheduler tier 51/167, RC=0. It flagged that two mutations each killed one EXTRA criterion
  as a side effect, with an explanation for each. Reviewer told to judge whether the
  PREDICTED assertion still went red in each case — a mutation killing more than predicted
  is fine; a mutation killing only something else is not.
Task 8: task reviewer dispatched (sonnet) over 5e0ce09..679a019.
Task 8: review clean — spec ✅, quality Approved, 0 Critical / 0 Important. Reviewer read
  preflight.ts in full to confirm the existing message is untouched and that
  runOnNonGitTarget.test.ts still pins it; confirmed withCorrectionsDir restores the env var
  even when the body throws; and confirmed for all THREE mutations that the PREDICTED
  assertion itself went red (two also killed a second criterion, each explained).
Task 8: minor (deferred): no correct.ts-level criterion for `--record-only` combined with
  `--chose-instead` (parsing is covered in args.test.ts). Implementer flagged it itself.
Task 8: complete (commits 5e0ce09..679a019, review clean)
Task 9: implementer returned BLOCKED at Step 0, exactly as instructed. No code written, no
  commits, working tree clean. Its measurement (git 2.50.1, Apple Git-155) CONTRADICTS spec
  §14.3's guard list: only MERGE_HEAD and CHERRY_PICK_HEAD make git refuse a partial commit
  (`fatal: cannot do a partial commit during a merge/cherry-pick.`, exit 128). REVERT_HEAD
  (both `revert -n` and a resolved-not-continued revert) and rebase-merge/rebase-apply
  (both backends) do NOT block a partial commit — git accepts it, exit 0.
Task 9: 🔴 Ruling (mine, on a design question the implementer correctly refused to decide):
  the guard rejects THREE states, each for its own measurable reason:
    1. MERGE_HEAD present — measured: git refuses the partial commit.
    2. CHERRY_PICK_HEAD present — measured: git refuses the partial commit.
    3. HEAD detached — NOT because git refuses (it does not), but because the ledger commit
       would not be reachable from any branch. Task 10's idempotence check is
       `git log --all -S<correctionId>`, which cannot see a commit no ref points at ⇒ the
       next `--close` would report "not yet closed" and write the rows a SECOND time. This
       also covers an in-progress rebase, which always detaches HEAD.
  REVERT_HEAD and the two rebase markers are DROPPED from the decision. They inform the
  MESSAGE only (so a person mid-rebase is told "rebase in progress", not the bare "detached
  HEAD"), never the verdict.
  Why this overrides spec §14.3's five-signal list: that same section states the governing
  principle — 守卫只拦真正拦得住的那几种，不做过度拒绝 — and its list was derived from a
  measurement taken on another day and another machine. The principle survives; the list does
  not. This is §14.8's own lesson landing on the section that wrote it: when you copy a
  mechanism, re-check its PREMISE, not just its shape.
  Also deliberate: no redundant guard. Rebase always detaches, so a separate rebase-marker
  VERDICT could not be killed by a mutation that deletes only itself — this repo has been
  bitten by exactly that shape (see validateLine.ts's comment about a doubly-guarded
  downgrade nobody can pin).
  Cost if wrong: `orca correct --close` stays usable mid-revert and mid-`-n` cherry-pick,
  where the commit genuinely succeeds and lands on a branch. If a state exists that git
  refuses and I have not named, the failure is loud and recoverable — the next task wraps a
  refused commit as `ledger-commit-refused` with exit 5, and re-running the same --close
  finishes it. That recovery path is why this is the safe direction to be wrong in.
  ⚠️ FOR THE HANDOFF: spec §14.3's guard list is now known to be partly wrong. Record the
  measured table and this ruling; the spec is published text and cannot be edited in place.
Task 9: implementer returned DONE (commits 0e294d7, 1b73f92) after the guard ruling. 15
  criteria (11 from the brief + 3 guard states + the revert negative control the ruling
  required); whole repo 69 files/386 tests, scheduler tier 51/167, RC=0. 11 mutations, of
  which 8 killed as predicted; 2 were caught by the message assertion instead of the
  "nothing written" one (short-circuit, acceptable); and E3b/E6 reddened via an UNCAUGHT
  EXCEPTION from a downstream layer rather than a named refusal — flagged for the reviewer,
  because "靠崩溃变红不算证据" is a standing rule here.
Task 9: carried forward to Task 10's dispatch: until the idempotence check lands, two
  colliding correction ids CRASH the second `--close` instead of reporting "already closed".
Task 9: task reviewer dispatched (sonnet) over 679a019..1b73f92.
Task 9: review — spec ✅, quality Approved, 0 Critical, 2 Important (both about mutation
  PRECISION, neither a production defect), 3 Minor. The reviewer verified the step order,
  the finally-covers-every-rejection property and the guard membership by reading the code
  rather than trusting the report, and confirmed the negative control exists.
Task 9: Ruling on Important 1 (E3b/E6 kill via an uncaught exception rather than their own
  assertions): ACCEPT AND REGISTER, do not "fix". The crash IS the failure mode each guard
  prevents, so the evidence is real — it just proves a slightly different proposition
  ("the guard prevents a downstream crash") than the criterion's name suggests. Wrapping
  appendEvents' errors as named refusals would be the wrong direction: an unexpected schema
  failure is exactly what exit 3 exists for, and in real CLI use it already lands there via
  cli.ts's top-level arm. The escape only happens because tests call main() directly.
  Cost if wrong: two criteria carry weaker evidence than their names imply; registered.
Task 9: Ruling on Important 2 (the "nothing written" assertions in the merge/detached guard
  criteria have NO mutation that can make them red on their own — the message assertion
  always fails first): NOT parkable. CLAUDE.md Rule 9's first corollary says an assertion
  nobody has SEEN go red is not yet a criterion. The reviewer named the mutation that
  discriminates them: keep the guard's throw and its message, but move the guard to AFTER
  the correction row is written. That needs no code change — only one evidence run.
  Cost if wrong: one extra mutation run on the most safety-critical task in the plan.
Task 9: minor (deferred): the --close argument-conflict criterion does not assert "nothing
  written" as its eight siblings do.
Task 9: minor (deferred): correct.ts casts `original as DecisionEvent` instead of narrowing.
Task 9: minor (deferred): originalDecision.ts hand-rolls the same ".decisions scan" that
  writer.ts (twice), validateFile.ts and cli.ts each hand-roll — pre-existing convention.
Task 9: fix round 1/5 opened — evidence only, 1 mutation, no code change expected.
Task 9: fix round 1/5 — evidence only, no commit. The fault injection (guard's check, throw
  and message left byte-identical; the call relocated to AFTER recordCorrection) behaved
  exactly as predicted: the message and exit-code assertions PASSED unchanged, and the
  `existsSync(corrections.jsonl)` "nothing was written" assertion went RED for the first
  time in both the merge-in-progress and detached-HEAD criteria. Those two assertions are
  now criteria rather than decoration. Shasums differed and were restored; the copy's test
  file diffed identical to the working tree's before deletion.
Task 9: Ruling: no scoped re-review seat for this round — it produced no diff at all (zero
  commits, evidence only), so there is nothing for a re-reviewer to read. The whole-branch
  review at the end still covers the task's code.
Task 9: complete (commits 679a019..1b73f92, review clean; 1 evidence-only fix round)
Task 10: implementer returned DONE (commit 56a3f77). 5 new criteria; whole repo 70 files/391
  tests, scheduler tier 51/167, RC=0; all 5 mutations killed the predicted criterion, one of
  them landing on an earlier assertion in the same `it` because of short-circuiting — flagged
  rather than silently adjusted.
Task 10: task reviewer dispatched (sonnet) over 1b73f92..56a3f77.
Task 10: review clean — spec ✅, quality Approved, 0 Critical / 0 Important. Reviewer
  confirmed the two-halves commit shape, ORCA_IDENTITY/git reuse, no --no-verify and no
  git reset, exit-5 semantics, and that alreadyCommitted's doc comment explicitly ties its
  --all scope to the previous task's detached-HEAD guard. It also empirically checked, in a
  disposable repo, that `git log --all -S<id> -- <path>` in a repo with zero commits exits 0
  with empty output rather than throwing. On the M4 short-circuit it reasoned the assertion
  that fired is causally entailed by the same defect, and that a narrower mutation would
  reach the porcelain/file-set assertions — so the criterion keeps reachable evidence.
Task 10: minor (deferred): `alreadyWritten` uses `.catch(() => false)`, so a permissions or
  I/O error on an existing file routes into a duplicate-write attempt instead of surfacing;
  narrowing to ENOENT would be more precise.
Task 10: minor (deferred): `git add -- relPath` is outside the try/catch, so a failure there
  surfaces untyped rather than as a CorrectRejection. Matches the brief's sketch verbatim.
Task 10: complete (commits 1b73f92..56a3f77, review clean)
Task 11: DONE (commit 26bb020). 🔴 THE ACCEPTANCE PASSED: in a throwaway repo a real closed
  loop produced the project's FIRST real `overturned` row (.decisions/orca-fix-db2d5280.jsonl),
  `orca validate` accepted it (exit 0, "ok: 2 ledger file(s)"), porcelain empty afterwards,
  HEAD's commit contained exactly the one ledger file. A second identical invocation was
  refused as `correction-already-recorded` (exit 1) rather than writing a duplicate — correct:
  a fresh `at` gives a different correction id, so it is the SEMANTIC check that catches it,
  which is precisely why §4.1 added that check.
Task 11: cross-reference scan re-run after eleven tasks of edits: zero dangling §14.x refs.
Task 11: controller re-check — verify RC=0, whole repo 70 files/391 tests (baseline 60/317,
  so +10 files / +74 criteria), scheduler tier 51/167 unchanged, porcelain 0 bytes,
  `ls ~/.orca` still absent after all eleven tasks.
Task 11: complete (commit 56a3f77..26bb020; steps 5-8 — ledger, handoffs, remote check,
  cost — are the controller's and are done after the final review)
FINAL: whole-branch reviewer dispatched (opus, the most capable model available) over
  e2f081b..26bb020, code-only package final-code-review.diff (148KB; the plan document,
  the decision ledger and README were excluded on purpose — they are not what it judges).
  Given the 16 deferred minors to triage and the two accepted residual risks to agree or
  disagree with.
FINAL REVIEW verdict: Fixes needed before merge. 1 Critical, 4 Important, 5 Minor, and it
  AGREED with both accepted residuals (the three-vs-five guard ruling, and the crash-killed
  mutations — it separately measured that the mid-operation guards actually die through
  their own message assertions, so that escape is narrower than the per-task seats thought).
  It triaged all 16 deferred minors: leave all but one, which it promoted.
  Everything it found, it found by MEASURING in a throwaway clone, then deleted the clone
  and proved this checkout byte-identical to 26bb020.
FINAL: Ruling — one fix wave, six items (the Critical, the four Importants, and one Minor
  whose consequence is unrecoverable):
  1. CRITICAL gitState.ts: LEDGER_COMMIT_REFUSED's message says "re-run the same --close",
     which is FALSE on the close-new path. Measured: run 1 exit 5; run 2 (same command) exit
     1 telling the person to use --again; run 3 with --again commits a SECOND
     decision+overturned for the same decision while orphaning the first pair, leaving two
     correction rows, two overturned for one decision, and a permanently dirty worktree.
     Nothing downstream stops it — writer.ts dedups decision ids only, validateFile never
     checks that a decision is overturned at most once. The working recovery is
     `--close <correctionId> --undo-how …`; the message must name it.
  2. IMPORTANT gitState.ts: `git add` outside the try. Measured trigger: a target repo that
     gitignores `.decisions/` → exit 3 with a raw stack AFTER both rows are irreversibly on
     disk, porcelain empty so nothing signals the leftover, every retry repeats it.
  3. IMPORTANT projectKey.ts: `new URL(remote)` throws for path-style and colon-less
     remotes. Measured — and this is the origin `git clone --local` produces, which is how
     every mutation copy in this whole round was made.
  4. IMPORTANT fields.test.ts: swapping two entries of CORRECTION_FIELDS leaves 209/209
     GREEN, because the criterion compares the output against CORRECTION_FIELDS itself. The
     consequence is not taste: a correction recorded by version N and closed by N+1 derives
     a different runId, alreadyCommitted looks in a file that does not exist, and a second
     decision+overturned is appended — the duplication §14.1 exists to prevent, reached by
     an ordinary refactor rather than a race.
  5. IMPORTANT paths.ts modes: setting them to 0o755/0o644 leaves 209/209 GREEN, because
     both criteria assert `mode & 0o777 === THE CONSTANT UNDER TEST`. A person's ~/.orca
     would go world-readable with every criterion green. Rule 17 is currently unpinned.
  6. MINOR-but-unrecoverable storeLock.ts: if `writeFile(info)` throws after `mkdir(lockDir)`
     succeeds, the throw escapes before a releaser exists, nothing removes the directory, and
     stale recovery is deliberately absent ⇒ that user's store is locked forever. Fix in
     storeLock.ts only; repoLock.ts has the identical shape but is pre-existing and
     src/scheduler/** has been off-limits all round — register it instead.
  Cost if wrong: items 4 and 5 are test-only; 1 is text; 2, 3 and 6 are small and each turns
  a crash or a permanent lock into a named refusal.
FINAL: fix wave dispatched (one agent, all six).
FINAL: fix wave returned DONE (commits f608fe5, eddfd46, fb3ca8f). whole repo 73 files/397
  tests, scheduler tier 51/167, RC=0. Nothing failed to reproduce.
  🔴 Worth keeping: the implementer's FIRST draft of the Critical's criterion did not kill
  its own mutation — the correction id leaked into stderr through git's echoed commit
  message, so the assertion passed with the old wording too. It found that by running the
  mutation rather than by reading, and fixed it in eddfd46. That is the sixth time this
  round that a criterion looked right and was not, and the first time one was caught by the
  author rather than by a reviewer.
FINAL: scoped re-review dispatched (sonnet) over 26bb020..fb3ca8f — the single re-review the
  process allows after a fix wave. Told to verify specifically that the repaired criterion
  now fails for the right reason and cannot pass through some other channel, and that
  normalizeRemoteUrl's regexes are still byte-identical to ccmem's.
FINAL: scoped re-review verdict — all six ADDRESSED, no new Critical/Important. It
  independently reproduced four of the six mutations with matching shasums, and confirmed
  normalizeRemoteUrl's two regexes are still byte-identical to ccmem's (no drift). It found
  ONE new Minor: now that `add` and `commit` share a catch, the refusal message claims the
  rows are "written and staged" on BOTH branches — but on the add-failure branch nothing was
  staged, which is why add refused. No criterion checks the message body there.
FINAL: Ruling — close that Minor rather than parking it, and stop there. The process allows
  one fix wave; this is a one-line message correction plus one assertion, not a second wave's
  worth of work, and it is the SAME shape as the Critical this wave existed to fix (an error
  message asserting something false about what is on disk). Leaving it would be inconsistent
  with the reason we did the wave at all. The human's standing instruction for this round is
  to act on my own recommendation for problems found during execution.
  Cost if wrong: one sentence and one assertion.
CCLOOP BASELINE (measured before writing anything there, 2026-09-08):
  HEAD is the commit whose subject is `docs(handoff): rewrite the Orca section in place --
  orca correct's shape is settled, and one git fact worth keeping`; `git ls-remote` equals
  it, so ccloop is published and clean; porcelain 0 bytes.
  Its handoff is 410 lines; the Orca section starts at line 314 (`# 📌 Orca 那条线`) and runs
  to EOF. Content OUTSIDE that section = lines 1-313,
  sha256 = 9497ef691e16d6c16cf8916b9b5cac95fbf9036d9c80400f94ad1acb2ca122de
  ⇒ that hash must be identical after the in-place rewrite. That is the non-interference
  proof this repo's rounds have used every time.
