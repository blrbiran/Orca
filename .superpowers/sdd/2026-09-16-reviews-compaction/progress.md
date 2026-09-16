# SDD ledger — plan: docs/superpowers/plans/2026-09-16-reviews-compaction.md

Attribution: run `orca-dev-5e5985bc`, 2026-09-16, controller Opus 5 (1M). Execution on `main`, local commits only — human chose this via AskUserQuestion (2026-09-16). Nothing is pushed by the controller.
Spec: docs/superpowers/specs/2026-09-16-reviews-compaction-design.md (reachable). Plan commit: `docs(plan): task-by-task implementation of reviews compaction…`.

## Start-of-session measurements (before planning; commands and results)
- `/usr/bin/git ls-remote origin refs/heads/main` + `merge-base --is-ancestor`: Orca 3 ahead / ccloop 1 ahead / ccmem 1 ahead, none behind (at session start).
- `rtk proxy npm run verify > log 2>&1`: VERIFY_RC=0; npm test 95/566; verify:scheduler 51/167; verify:panel PASS 0-12; web 8/26. Log (1397 lines) read by summary extraction, NOT line by line — registered.
- `ls ~/.orca`: RC 1 (absent), before and after verify.

## Pre-flight scan (controller, before Task 1)

| Pair / task | Produces vs consumes | Found |
|---|---|---|
| T1 → T2 | `LedgerView`, `classifyReviews` | consistent names and shapes |
| T1 → T3 | `Classification`, `LineKind`, `classifyReviews` | consistent |
| T2 → T4 | `buildLedgerViews(repos, wanted)`, `wantedDecisions(dir)` | consistent |
| T3 → T4 | `applyCompaction`, `dryRunCompaction`, `renderCompactionReport`, `APPLIED_LAST_LINE` | consistent; T4's expected report lines checked against `padEnd(11)` by script: all 5 match |
| T3 ↔ T5 | T3's C14 uses `ReviewsWriter` (pre-T5 API: `new ReviewsWriter(dir)`) | compatible before and after T5 (second ctor arg optional) |
| T5 → T6 | PASS 13 depends on the identity check | T6 cannot be red first; its teeth are M11 in T8 (plan says so) |
| T2 ↔ existing | `ledgerFiles` export in `decisionSource.ts` | one-word change; existing consumer `decisionsApi.test.ts` re-run in T2 |
| T7 | two anchors in E3 spec | each counted exactly 1 (script) |
| T8 → T1–T6 | test titles named in the mutation table | titles match the plan's `it(...)` strings |
| T1 self | tests vs code | C15 counts (dup 1 + orphan 1 = 2) agree with the fixture |
| T2 self | C4d path arithmetic | `archive/2026/../../../outside.jsonl` = `<repo>/outside.jsonl`, not top-level |
| T3 self | stub red expectations vs tests | agree; C8/C8b/C10 green at stub, teeth M6/M26/M7 |
| T4 self | stub `return 1` vs tests | first test reds on the stderr assertion, not the exit code |
| T5 self | C20 / C19b | both already corrected in the plan's own self-review before commit |
| T6 self | `runCliToExit` vs existing `runToExit` | **verbatim duplication of a ~30-line logic block** — the review rubric calls this a defect |

- Ruling: T6 does NOT add `runCliToExit`; it parameterises the existing `runToExit(args, env, deadlineMs, hangMeans = <the existing bind-guard sentence>, label = "orca panel")` so step 11's message stays byte-for-byte the same by default and step 13 passes its own sentence — why: the plan text mandates a verbatim duplicate the rubric rejects, and the spec says nothing about the helper; the existing doc comment ("Step 11's second process…") stays verbatim and a one-line addition notes step 13 also uses it — cost if wrong: one extra review round on T6, and a published function's signature grows two defaulted params.

Task 0: census — all 16 names present (`$TMPDIR/names.txt`, run at HEAD `6b771b9`).
- Ruling: the Task 0 baseline is the session-start verify (at `a0928fe`) rather than a fresh run — why: every commit since is docs-only (spec x4, plan x1), no test or source byte changed — cost if wrong: a stale baseline number would be caught by Task 8's full verify anyway.
Task 0: complete (no commits)
Task 1: dispatched (BASE 6b771b9)
Task 1: implementer DONE_WITH_CONCERNS (commits 1008e47, db9b565)
- Ruling: the plan's Task 1 Step 3 prediction was wrong — "C5 keeps a torn last line…" is GREEN at the stub (the stub returns the input as liveText, and this fixture drops nothing), not red; the test stands unchanged and its teeth are M4 and M15 in Task 8 — why: the implementer measured it and the stub's liveText = text makes it structurally true; changing the test to redden a stub would add nothing — cost if wrong: none beyond the C5-torn criterion depending on Task 8's mutations for its proof.
- Ruling: accept the implementer's extra commit db9b565 (removes the "STUB" header comment that became false after Step 4) — why: a comment left saying the file is a stub is a false statement in fresh, unpublished code — cost if wrong: one trivial commit.
Task 1: review — spec ✅, quality Approved, 0 Critical / 0 Important.
- ⚠️ resolved by controller: "repo-not-discovered" and "ledger-has-malformed-lines" branches untested in Task 1 — covered by Task 2's C3 and C4 (plan text), not a gap.
Task 1: minor (deferred): `compactClassify.ts` parseRow ends in a double cast `as unknown as RowKeyFields` after a manual narrowing loop; a type predicate would let tsc check it.
Task 1: complete (commits 6b771b9..db9b565, review clean)
Task 2: dispatched (BASE db9b565)
Task 2: implementer DONE (commit 61b551b)
Task 2: review — spec ✅, quality Approved, 0 Critical / 0 Important.
- ⚠️ resolved by controller: commit trailer present (`git log -1 --format=%B 61b551b`); `wantedDecisions` is exercised end to end by Task 4's CLI tests (the orphan in the dry-run report is only found through the archive lookup `wanted` drives).
Task 2: minor (deferred): `ledgerViews.ts` reads archive files through `readLedgerLeniently` (real fs), so only `listYearDirs`/`statFile` of the injected `ArchiveIo` are used — plan-mandated.
Task 2: minor (deferred): top-level malformed scan does not short-circuit once malformed is found — plan-mandated, harmless.
Task 2: complete (commits db9b565..61b551b, review clean)
Task 3: dispatched (BASE 61b551b)
Task 3: implementer DONE (commit fd40a8e)
Task 3: review (opus) — spec ✅, quality Approved, 0 Critical / 0 Important, 5 Minor.
- ⚠️ resolved by controller: mutations are Task 8's; report text is pinned by Task 4's CLI test; directory fsync not required by spec; exit code 5 wiring is Task 4's.
- Ruling: Task 8 gains two mutations the reviewer showed are missing — M26b replace the `stat(dir)` guard with `await mkdir(dir, { recursive: true })` (predict: C8b red at `stat(absent)` and only C8b), and M27 move `await lock.release()` out of `finally` to just before `return { classification, wrote: true }` and the no-op return (predict: C13 red at `stat(reviewsLockDir(dir))` and only C13; also C12? no — C12 rejects inside acquire, before the try) — why: without them C8b's named property and C13's lock-release assertion have never been seen red (CLAUDE.md Rule 9) — cost if wrong: two extra clone runs.
Task 3: minor (deferred): C14 pins "the read is not before the beforeLock seam", not "the read is inside the lock"; a read moved between the hook and acquire would stay green — plan-mandated.
Task 3: minor (deferred): `reviewsLock.ts`'s busy message says "another orca panel is writing" even when `orca compact-reviews` holds the lock — pre-existing text, now inaccurate in one case.
Task 3: complete (commits 61b551b..fd40a8e, review clean)
Task 4: dispatched (BASE fd40a8e)
Task 4: implementer DONE (commit 1e5da77)
Task 4: review — spec ✅, quality Approved, 0 Critical / 0 Important.
- ⚠️ resolved by controller: re-ran `rtk proxy npm run typecheck` (RC 0) and a byte scan over src/cli.ts, src/panel/*.ts, tests/panel/*.test.ts (0 control bytes) at HEAD 1e5da77.
Task 4: minor (deferred): `--repo key=path` parsing in runCompactReviews repeats runMetrics' block with a different prefix — existing per-subcommand convention, plan-mandated.
Task 4: complete (commits fd40a8e..1e5da77, review clean)
Task 5: dispatched (BASE 1e5da77)
Task 5: implementer DONE (commit 9d89f12)
Task 5: review (opus) — spec ❌ (plan-mandated comment placement), quality Needs fixes: 2 Important (both plan-mandated), 3 Minor.
- Ruling: I-1 fix — `load()` must assign identity and set together after the read succeeds; add criterion C17b (reload fails with EISDIR, retry must write) — why: the reviewer's probe reproduced the spec 5.1 hole after one transient read error, and the plan's code created it — cost if wrong: one extra criterion and a four-line reorder.
- Ruling: I-2 fix — move the three new exports above the published class doc comment so JSDoc attaches it to ReviewsWriter again; no byte of the comment changes — why: "keep the published comment" means keeping what it documents, not only its bytes; the plan's "insert before export class" instruction caused it — cost if wrong: none.
- Ruling: Task 8 gains M28 — in `load()` move `this.identity = identity;` back above the read (predict: C17b red and only C17b) — why: C17b must be seen red against its own mutation — cost if wrong: one clone run.
Task 5: minor (deferred): overlapping reloads can pair a newer identity with an older set (load A reads X, rename, load B stats/reads Y and assigns, A assigns last) — narrow window, not registered in spec §8; candidate fix is a load generation counter. Final review to triage.
Task 5: minor (deferred): no criterion covers "write fails, then reload" (inFlight removed only on success would leak into later rebuilds).
Task 5: minor (deferred): C17 relies on the real filesystem giving the replacement a new inode (true on APFS).
Task 5: fix round 1/5 (2 addressed, 0 open — identity/set assigned together + C17b; class comment back on the class; commits 9d89f12..29edcc4)
Task 5: complete (commits 1e5da77..29edcc4, review clean after 1 fix round)
- Note: the expected end total moves from 602 to 603 tests (C17b added).
Task 6: dispatched (BASE 29edcc4) with the pre-flight ruling on runToExit carried in the dispatch
Task 6: implementer DONE (commit ec27de6; runToExit parameterised per pre-flight ruling)
Task 6: review — spec ✅, quality Approved, 1 Important (inherited from the brief), 1 Minor.
- Ruling: I (fixture ledger not moved back when PASS 13 fails between the two `git mv`s) — NOT fixed — why: PASS 13 is the last step, any `fail(13, …)` aborts every remaining step, and `fixture.cleanup` (registered before PASS 1) removes the whole fixture directory in `finally` on every exit, so no step, run or person can observe the half-moved ledger; a compensating `git mv` teardown could itself fail on the path it is restoring and turn a clean failure report into a teardown failure — cost if wrong: if someone later appends a step after PASS 13 that reads the fixture, a PASS 13 failure would already have aborted it, so the cost stays zero unless the abort-on-first-failure contract changes.
- Correction (controller's own text): the pre-flight ruling line above writes the new parameters as `hangMeans = …, label = …`; the Task 6 dispatch and the landed code use `label`, then `hangMeans`. The code and the dispatch are the intended order; the ledger line is the slip. Original line kept verbatim.
- ⚠️ resolved: verify:panel PASS 0-13 RC 0 is the implementer's run; Task 8 re-runs the full verify on the final tree.
Task 6: minor (deferred): `runToExit`'s two new parameters are documented only by one `//` line.
Task 6: complete (commits 29edcc4..ec27de6, review clean)
Task 7: dispatched (BASE ec27de6)
Task 7: implementer DONE (commit e97a000)
Task 7: review — spec ✅, quality Approved, 0 issues.
Task 7: complete (commits ec27de6..e97a000, review clean)
- Ruling: Task 8 Step 6 (commit the SDD ledger) is done by the controller, not the Task 8 implementer; the implementer writes its mutation evidence to `task-8-mutations.md` in this workspace — why: this progress.md IS the controller's live ledger, and two writers on it would race — cost if wrong: none.
- Ruling: at the end the workspace is NOT deleted (the skill's Finish step says `rm -rf <workspace>`); `progress.md` is committed with `git add -f` as every earlier Orca round did (e.g. `.superpowers/sdd/2026-09-10-panel-e3/progress.md`) — why: CLAUDE.md Rule 11 (repo convention over the skill) and the user's global rule against `rm -rf` without confirmation — cost if wrong: a few gitignored scratch files stay on disk.
Task 8: dispatched (BASE e97a000)
Task 8: implementer DONE_WITH_CONCERNS (no commits by design). Evidence: task-8-mutations.md, task-8-report.md (controller read the mutation file whole).
- Measured: 29 mutations run (M13 void), every one landed (sha before != after, mutated line read back), every one seen red; 27 predictions exact, 2 incomplete; clone baseline 17 files / 132 tests green; M11's verify:panel half: PASS 0-12 then `FAIL 13 … "written" vs "duplicate"`, RC 1, no leftover `src/cli.ts panel` process; seven criterion files byte-identical clone vs main before the clone was destroyed; ~/.orca absent at all four checkpoints.
- Full verify on the main tree at e97a000: VERIFY_RC=0; npm test 100 files / 603 tests; verify:scheduler 51/167; verify:panel PASS 0-13; web 8/26; `git status --porcelain` 0 bytes. ⚠️ The implementer says the 1407-line verify log was "read back in full (two Read calls, offset 0 and 500...)" — whether lines past ~1000 were read is not established; registered, not claimed.
- Ruling: M1's extra red (C7) is a TRUE red, the plan's prediction was incomplete — C7's dry-run assertion `resolves.toMatchObject({ liveText: KEPT })` compares the surviving bytes, which keep-the-last changes; the controller missed it when writing the table (the "where does the literal come from" question) — cost if wrong: none; code and tests stand.
- Ruling: M11's extra red (C17b) is a TRUE red, the controller's addendum was incomplete — C17b was added in Task 5's fix round after the M11 prediction was written, and its final `append` goes through exactly the identity check M11 deletes; the addendum updated test counts but not M11's red set — cost if wrong: none.
- Ruling: accept the implementer's correction to M27's mechanics (removed the `try` keyword along with `finally`, releasing before each return) — the addendum's literal edit did not compile; the corrected mutation matches the addendum's stated intent and reddened exactly C13 at the named assertion — cost if wrong: M27 proves "no release on the throw path" rather than any other shape of lock leak.
- Ruling: Task 8 gets no separate task reviewer — it produced no diff (review-package would be empty); the controller audited the evidence file line by line and the final whole-branch review receives it — cost if wrong: a mis-recorded mutation row would only be caught by the final reviewer.
Task 8: complete (no commits; evidence audited by controller)
Final review: dispatched (MERGE_BASE a0928fe, HEAD e97a000)
Final review (opus): Ready to merge "With fixes" — 0 Critical, 1 Important, 6 Minor; audited every mutation row, found none mis-recorded; M1/M11 extra reds confirmed true.
- Correction (controller's own ledger text): the Task 5 deferred minor "overlapping reloads can pair a newer identity with an older set" described an interleaving that cannot happen — each load pairs its own identity (taken before its own read) with its own set, so the last assignment is always self-consistent and the next duplicate hit reloads again. The final reviewer showed this. The original ledger line is kept verbatim above.
- Ruling: fix Important #1 (criterion C19c + mutation M29, no production change) — why: the reviewer measured that a regression of the inFlight finally stays green and reopens the spec 5.1 hole — cost if wrong: one test that takes ~1 s.
- Ruling: also fix Minors #2 (odd rows crash the command instead of counting as unreadable), #3 (refuse a symlinked reviews.jsonl by name rather than silently turning it into a regular file), #4 (list orphan ids in the report + register branch-local evidence and the views-outside-the-lock window in spec §8), #5 (inaccurate doc comment) in the ONE fix wave — why: #2 contradicts spec 3.1's own "unreadable" rule, #3 decides a person's file layout for them (Rule 17's spirit), #4 gives the dry run the information the branch-switch case needs, #5 is a false statement in unpublished code; all are small and all are in this round's own unpublished code — cost if wrong: four small behaviours and four more mutations beyond what the plan specified.
- Ruling: #3 is a refusal (new code `reviews-store-is-symlink`, exit 1), not a follow-the-link rewrite — why: writing through the link would still need tmp+rename on the target's filesystem and a decision about which directory the backup/archive belong in; refusing names the situation and changes nothing — cost if wrong: a person who deliberately symlinks reviews.jsonl must point ORCA_CORRECTIONS_DIR at the real directory to compact.
- Ruling: #4 derives orphan ids in the renderer by parsing the orphan line, and extends this round's own CLI dry-run expectation — why: changing `LineClass` would ripple into five this-round criteria for no behavioural gain; the CLI test was written this round and the edit only adds expected lines — cost if wrong: the renderer re-parses lines the classifier already parsed.
- Ruling: Minor #6 (the explicit chmod in `ensureFile` cannot go red under a normal umask) NOT fixed and no mutation added — why: making it red needs an artificial umask like 0o277; the chmod is belt-and-braces for a hostile umask the tests would have to invent — cost if wrong: a deleted chmod would go unnoticed on machines with a permissive umask that sets group/other bits beyond 0o600… which a mask cannot do; effectively none.
- Ruling: Minor #7 (M2 only changes the label) accepted as is — informational.
- Registered: the panel's own `ReviewsWriter.load()` crashes on a `null` line (pre-existing, not this round's) — goes to spec §8 item 11, not fixed.
Final fix wave: dispatched (FIX_BASE e97a000), requirements in final-fix-brief.md
- Correction (to the Minor #6 ruling line just above, whose cost clause is muddled): a umask can only REMOVE bits, so `mode: 0o600` never yields more than 0600; the explicit chmod only matters under a umask that removes OWNER bits (e.g. 0o277 → 0400), where it restores 0600. Cost if wrong, stated correctly: on such a machine a deleted chmod would leave new archive/backup files 0400 and no criterion would notice. The ruling (not fixed) stands.
Final fix wave: implementer DONE (commits 81efe44, dc7f1fb; 4/4 mutations matched; verify 100/606, PASS 0-13)
Final fix wave: re-review — F1–F5 and spec amendments all ADDRESSED; no new Critical/Important; 1 new Minor: spec §3.3 row 1 said "`MetricsRejection` 与 `PanelRejection` 的退出码都恒为 1" as a class-level claim, false (`PanelRejection` is 1|4|5; busy is 5 in the next row).
- Ruling: the controller corrects that one sentence in place (spec unpublished, measured `merge-base --is-ancestor dc7f1fb <remote>` RC 1), scoping it to the three causes in the row, and commits it together with the handoff update — why: there is no second fix wave, and a known-false sentence may not be carried forward; it is a one-sentence documentation scope fix with no code or criterion behind it — cost if wrong: an unreviewed doc sentence; the exact before/after is reported to the human.
Final review: complete (final fix wave e97a000..dc7f1fb, 1 residual Minor corrected by controller)

## Close-out (controller, 2026-09-17)
- Final state measured: `git status --porcelain` 0 bytes after the spec correction commit; final full verify (fix-wave implementer, main tree, HEAD `dc7f1fb`): VERIFY_RC=0, npm test 100 files / 606 tests, verify:scheduler 51/167, verify:panel PASS 0-13, web 8/26; ~/.orca absent before and after. The spec correction after it (`docs(spec): scope the exit-code-1 sentence…`) is docs-only.
- Mutations: 29 in Task 8 (27 exact, 2 incomplete-but-true: M1+C7, M11+C17b) + 4 in the fix wave (4 exact). Every mutation landed and was seen red.
- Subagents: 19 dispatches; task-notification `subagent_tokens` sum to 2,282,003 (for the Task 5 implementer the post-resume figure 132,106 was used; whether it is cumulative with its first 103,557 is not stated by the tool). Session cost: the last hook report seen by the controller was ~$81.28, before Task 1 was dispatched; no later hook figure was observed — not estimated.
- Workspace kept (ruling above); this ledger committed with `git add -f`.
- Not pushed. Nothing merged. No branch or worktree created or deleted.
