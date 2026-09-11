# SDD ledger — plan: docs/superpowers/plans/2026-09-10-panel-e3.md

Owner: run `orca-dev-6354277a` (session 6354277a), started 2026-09-10 22:38 +0800 on main @ a801200.

## Start-of-session measurements (commands redirected to files, read back whole)

- `git ls-remote origin refs/heads/main` -> 2aadb33 (`docs(handoff): correct the registration that said the sister repos were left alone`); local main 4 commits ahead (b71093a, 400035c, fac3043, a801200). Handoff said 6; measured 4.
- `rtk proxy npm run verify` -> VERIFY_RC=0; whole repo 82 files / 467 tests; verify:scheduler 51 / 167.
- `git status --porcelain -z` -> 0 bytes; one worktree.
- `ls ~/.orca`, `ls src/panel`, `ls -d web` -> all "No such file or directory".

## Deviations from the skill (CLAUDE.md wins, Rule 11)

- No isolated worktree: CLAUDE.md Rule 15 makes deleting a worktree need human sign-off; every prior round landed local commits on main. Human asked for this execution on 2026-09-10.
- Workspace is NOT deleted at the end: this repo keeps `.superpowers/sdd/**` evidence via `git add -f`.
- Mutations are run by a separate verifier subagent after review, not only by the implementer (handoff item 9: red-count acceptance moves to after implementation).

## Human rulings this session (2026-09-10, AskUserQuestion)

- H1: AUTHORISED by name — change existing production code `src/corrections/correct.ts` + `src/corrections/record.ts`: move `correctionRowFrom` into a shared single construction point, `at` injectable as a function parameter; no `--at` CLI flag.
- H2: spec §3.1 gets NO ERRATUM. Controller re-measured: spec line 145 says schema.ts *declines* to force chose_instead for wrong/stale, which `src/corrections/schema.ts` does (superRefine forces only not_my_taste; its comment carries the same "widening is a migration, coerced content is permanent" rationale). Plan registration item 2 misparsed the sentence. Only the plan gets an appended correction.

## Controller findings before execution

- F1: plan Task 7 handler (plan lines 2374-2389) builds its own CorrectionRow literal while its comment (2392-2394) says it does not -> violates spec §2.3 "one construction point". Fixed by H1 + Task P; Task 7 must call the shared constructor.
- F2 (to check in Task 7 review): Task 7 derives projectKey from browser-supplied `body.repo` -> the request picks a filesystem path the server runs git in.

## Preflight scan (table: preflight-scan.md, sonnet seat, 192,274 tokens / 27 tool uses per dispatcher)

Controller re-verified every load-bearing row (commands -> scratchpad/scan-verify.txt):
- scan §3-4 "UNIT_SEPARATOR is an empty string" (plan L839): FALSE POSITIVE. `od -c` shows the literal is `"\037"` (U+001F); the Read tool does not render it.
- scan "throwawayStore undefined" (plan L1114): CONFIRMED, single occurrence. (It fails when the test body runs and in tsc, not at collection as the scan said.)
- scan "POST /api/reviews declared, never implemented" (plan L2269): CONFIRMED, single occurrence. Spec §4.2 table row `reviewed` requires an explicit agree/no-change click.
- scan "Task 8 uses `overall`" (plan L2588 vs its own L2482 comment): CONFIRMED.
- scan "Task 4 body still cites subdir/index.js" (plan L1665, L1669, L1700 vs L2746): CONFIRMED; disposition 9 said fixed in place, it was not.
- scan "Task 5 noSkips gate not landed" (plan L1991 still grep vs disposition 5 L2933): CONFIRMED.
- scan "TOKEN_REQUIRED produced by Task 3 Interfaces (L1030) and defined in Task 5 api.ts (L1903)": CONFIRMED.
- scan "Task 6 Files table omits src/panel/decisionSource.ts" (L2235): CONFIRMED by grep (single mention).

## Preflight rulings

- Ruling R1: Task 7 builds the row with `correctionRowFrom(input, now)` from src/corrections/record.ts; the panel has ONE clock `PanelOptions.now?: () => Date` (default wall clock), used both for correction `at` and for E2's `as_of` (this settles Task 5 decide-point 1: inject, not strip-and-compare). C-13's original landing (panel id == CLI id for the same input and clock) is restored against Task P's golden id; the named-refusal criterion stays as an extra. — why: H1 granted; spec §2.3 is binding. — cost if wrong: one extra option field on PanelOptions.
- Ruling R2: plan disposition "登记而不修" item 2 (spec §3.1 ERRATUM) is withdrawn (H2). — cost if wrong: spec keeps an ambiguous bare `schema.ts`.
- Ruling R3: Task 7 must also implement `POST /api/reviews` (action `reviewed`, explicit agree), write failure surfaced to the person (spec §4.3.1), with a criterion and a named mutation. — why: spec §4.2 names it as one of the two producers of the coverage numerator. — cost if wrong: one extra endpoint.
- Ruling R4: Task 3 `security.test.ts` defines `throwawayStore` as a mkdtemp dir owned by that test and removed after it; the child env points ORCA_CORRECTIONS_DIR there. — why: Global Constraint 2 / Rule 17; the plan's own comment says isolation must not depend on the guard. — cost if wrong: none beyond a temp dir.
- Ruling R5: `TOKEN_REQUIRED` has one definition, in `src/panel/rejection.ts` (Task 3); Task 5 api.ts imports it. — why: disposition 9's own diagnosis (two definitions = fields.ts's shape). — cost if wrong: an import path.
- Ruling R6: Task 4's prose about `subdir/index.js` (L1665, L1669, L1700) is superseded by mutation table L2746; not carried as a prediction or into the commit message.
- Ruling R7: Task 5's skip gate becomes the criterion `tests/panel/noSkips.test.ts` (disposition 5), covering it/test/describe .skip and .todo plus xit/xtest/xdescribe; comments stripped before matching; it carries must-catch AND must-not-catch samples. — why: vitest exits 0 on skipped/todo; a scanner without negative samples proves nothing. — cost if wrong: one test file.
- Ruling R8: Task 6 Files table gains Create `src/panel/decisionSource.ts`.
- Ruling R9: Task 8 MetricsView reads the real field from src/metrics/types.ts (`rate_excluding_stale` per the plan's own L2482 note; re-measure at Task 8), never `overall`.
- Ruling R10 (default for Task 8 decide-point 2, may be revised with evidence at Task 8): web keeps its own field list with its own golden, AND a root-side criterion imports both lists and asserts equality, so one mutation to either side goes red. — why: web tsconfig cannot import src; a parity test is the smallest single landing point. — cost if wrong: a second definition held together by a test instead of an import.
- Ruling R11: Task 9 edits the verify string Task 1 wrote into the target state (replace, not append).
- Ruling R12: `detailUrl` lives in `src/panel/listProjection.ts`; how verify-panel.mjs imports it is decided at Task 9 with evidence (preference: run it through tsx so there is one definition).
- Ruling R13: registered items 6 (two spec requirements without criteria: §4.2 unreviewed-high-tier todo list -> Task 8; §3.3 --bind help sentence -> Task 1), 7 (lsof filtered by pid -> Task 3), 8 (C-5 positive observation is readdir(decisionsDir), not git status -> Task 7) are carried into those tasks' dispatches.
- Ruling R14: red counts in the plan are hypotheses. After each task's review, a separate verifier subagent runs the named mutations in clones and reports measured reds; a mismatch is investigated with the three questions (earlier assertion short-circuits / who else walks the deleted line / which field a literal comes from), never auto-declared a false red.

## Tasks

- Task P (pre-slice, H1): implemented 297a2ce (BASE a801200); implementer reports whole repo 83/471, scheduler 51/167, VERIFY_RC=0. Review + mutation verification dispatched in parallel.
- Task P mutations (task-P-mutations-report.md, sonnet verifier, 98,158 tokens / 19 tool uses per dispatcher; controller read the report whole): baseline 14/88 green. MP-1 (at ignores now) red 4, matched. MP-2 (correct ignores opts.now) red 3, matched (criterion 1 green as it must be). MP-3 (default clock -> epoch) red 3, all in pre-existing record.test.ts ×2 + close.test.ts E21 — the default branch is pinned by existing criteria, not by the new file. MP-4 (by -> "panel") red 4 across injectableClock 1 & 4, record.test.ts, recordSeam.test.ts. Every red is an assertion failure with expected/received; main tree porcelain 0 bytes before and after.
- Note for Task 7: Task P golden id is `c_ed266d26d170dd27` (per MP-4 report, injectableClock.test.ts:143) — re-read it from the test file at Task 7, do not copy from here.
- Task P review (task-P-review.md, sonnet, 97,347 tokens / 13 tool uses per dispatcher): Spec ✅, quality Approved, 0 Critical / 0 Important.
- Task P: minor (deferred): record.ts moved doc comment still says "written out twice in the function below" (dangling after the move; ERRATUM present).
- Task P: minor (deferred): injectableClock.test.ts has its own recordArgs-shaped helpers next to harness.ts's runCli-shaped ones.
- Task P ⚠️ resolved by controller: ledger line 1 of .decisions/orca-dev-6354277a.jsonl is byte-identical to JSON.stringify({ev,id,at,run,...task-P-decision.json}) (scratchpad/ledger-check.mjs), committed in 297a2ce.
- Task P: complete (commits a801200..297a2ce, review clean)
- Controller docs commit eab103e: plan gains "📌 执行轮开工更正" (H1/H2 + preflight rulings R1–R14 in Chinese); ledger row orca-dev-6354277a/2 (H2) appended via appendEvent (scratchpad/append-2.mts). Porcelain 0 bytes after (/usr/bin/git).
- Checkpoint 1 (2026-09-11): stopped before Task 0/1 to report cost to the human (hook reported session ~$63.73) — CLAUDE.md/handoff practice of re-confirming budget mid-implementation overrides the skill's continuous-execution default.
- Next: Task 0 + Task 1 in one dispatch (Task 0 is measurement only and feeds Task 1's commit message).
- Checkpoint 1 answered by human (2026-09-11): continue Task 0/1; on problems follow controller recommendation; report at the end; then update the three handoffs.
- Task 0+1: dispatched one implementer (sonnet), BASE eab103e, controller rulings in task-1-controller-notes.md (C1–C9: edit-not-overwrite package.json; React 19 JSX import; vitest/config defineConfig; zero-test web check -> real smoke test not passWithNoTests; root tsc/vitest isolation from web/; §3.3 help-sentence criterion (R13); W-1 left to the verifier; commit-message fact check; final checks).
- Ruling R15: Task 0 "changed" items no longer stop for the human mid-round (human ruling 2026-09-11); only a change that affects what Task 1 builds stops the implementer. — cost if wrong: a spec drift reaches the end-of-round report instead of the start.
- Context note: hook reported ~328k context before this dispatch (Rule 6 session cap 450k) -> this session ends after Task 1's review + mutations, then handoff.
- Task 0+1 implemented 29c0de4 (BASE eab103e), DONE_WITH_CONCERNS (implementer 191,609 tokens / 100 tool uses per dispatcher): whole repo 85/477, scheduler 51/167, web check 1/1, VERIFY_RC=0; porcelain 0 bytes (/usr/bin/git); ~/.orca absent; web/dist absent (root .gitignore `dist/` will cover it); web/node_modules exists separately (vite, esbuild).
- Ruling R16: keep 29c0de4's commit trailer as written (implementer used a Sonnet attribution instead of the controller-given one) — no amend (global rule prefers new commits; the trailer names the model that wrote it). — cost if wrong: one commit's attribution line differs from the session's other commits.
- Ruling R17: `npm install` reported 5 vulnerabilities (3 moderate / 1 high / 1 critical per implementer), not triaged this round; registered for the handoff. — cost if wrong: a known-vulnerable dependency ships in the panel before someone audits.
- Task 1 review (sonnet) and mutation verifier (sonnet, W-1..W-8, task-1-mutations-brief.md) dispatched in parallel on 29c0de4.
- Task 1 review (task-1-review.md, sonnet, 104,934 tokens / 26 tool uses per dispatcher): Spec ✅, quality Approved, 0 Critical / 0 Important. ⚠️ runtime numbers not re-run (covered by implementer's verify + verifier).
- Task 1: minor (deferred): tests/panel/workspace.test.ts:46-52 lockfile-absence criterion is green before Task 1 (brief-prescribed); W-2 mutation measures whether it can go red.
- Task 1: minor (deferred): web `check` criterion asserts only that the script is a string (brief-prescribed).
- Task 1: finding for handoff: two vite copies — root node_modules/vite 5.4.21 (via vitest 2.0.5) and web/node_modules/vite 6.4.3; this is why web/vite.config.ts had to import defineConfig from vitest/config (C3).
- Task 1 mutations (task-1-mutations-report.md, sonnet, 118,529 tokens / 42 tool uses per dispatcher; controller spot-checked RC/summary lines): baseline root 3/20 + web 1/1 green. W-1, W-2 (proves the lockfile criterion can go red), W-3, W-7 matched; W-4/W-5 red in tests/panel/usage.test.ts; W-8 red on the literal ["web"]; W-6 (delete the stub's --by guard) FULLY GREEN. Main tree porcelain 0 before/after.
- Task 1: parked — W-6: the `--by` guard in the Task 1 stub src/panel/server.ts has no criterion. Ruling R18: real, deferred to Task 3, which replaces server.ts wholesale and owns the --by criteria; Task 3's dispatch MUST carry a named mutation that deletes the --by guard and must see it red (CLI level, so it survives later rewrites). — cost if wrong: the guard is unpinned between 29c0de4 and Task 3's commit (no user of the stub exists).
- Task 0: complete (measured table in task-1-report.md; decisions 148 vs spec's 137 — expected drift; nothing else changed)
- Task 1: complete (commits eab103e..29c0de4, review clean, 1 parked)
- End of session (2026-09-11 10:11): ls-remote -> eab103e (human pushed mid-session: Task P and the plan correction are now published); final verify VERIFY_RC=0, whole 85/477, scheduler 51/167, web 1/1; porcelain 0; ~/.orca absent. Controller read only summary/failure lines of the 1343-line final verify (context budget).
- Handoffs updated: ccloop Orca section and ccmem §15 in place (no new numbered items; head sha unchanged), Orca handoff appended section for session 6354277a.
- NEXT: resume at Task 2. Carry R18 (--by guard mutation) into Task 3; R4/R5 into Task 3; R6 into Task 4; R1/R5/R7 into Task 5; R8/R12 into Task 6; R1/R3/R13(C-5) and F2 into Task 7; R9/R10/R13(todo list) into Task 8; R11/R12 into Task 9. Plan's own five rulings go to the ledger at their tasks.
