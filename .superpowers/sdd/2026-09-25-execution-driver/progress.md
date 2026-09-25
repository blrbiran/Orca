# SDD ledger — plan: docs/superpowers/plans/2026-09-25-execution-driver.md

Controller: Orca session 905e41ce (Claude Opus 5.5), 2026-09-25. Spec: docs/superpowers/specs/2026-09-25-execution-driver-design.md (second edition + §11).
Workspace: local commits on main (project convention; worktree deletion is Tier 0 — CLAUDE.md over skill).
Human rule for this round: decide problems myself, report all rulings at the end. Test criteria may be rewritten this round (ruling 88 (b)(c) still apply).

## Preflight (table: preflight.md, 51 rows; scanner spawned 5 forks against the house norm — output re-verified by it; noted)
Ruling: P1 Task 8 retryRun — use the corrected two-line form (plan 3924-3926), never line 3918 — the first form short-circuits resumeBlockedDriverRun — cost if wrong: blocked driver runs never retry.
Ruling: P2 Task 2 duplicated groupRow/currentCommandRevision block — implementer may extract one local helper — minor quality.
Ruling: P3 Task 5/6 duplicated landing sequence — Task 6 extracts one shared landing helper used by stepD and finishReconcile, and removes the double removeOwnPath on the conflict path — cost: duplicated git sequence drifts.
Ruling: P4 Task 4 comment vs code (empty result) — code stands (state=landed so stepE applies D14: no acceptance, work blocked); fix the comment — cost: misleading comment only.
Ruling: P5 trivial duplicate reset — implementer may merge.
Ruling: P6 criteria green before code — accepted; the mutation seat must see T7-M6/T8-M2/M4/M6 red or record "no exclusive criterion".
Ruling: P7 cleanup failure on a settled run must NOT block the run — stay settled, cleanedUp=false, record cleanupError, retry next round; Task 4's generic handler must not blockRun a run whose state is settled — cost if wrong: one cleanup error blocks the whole group's read view (controlViews run-state guard).
Ruling: P8 Task 11 EXPECTED gets web/tests/workspaceMode.test.tsx with its 3 criteria.
Ruling: P9 Task 9 prose/code mismatch — code (describe.skipIf(!realBinary)) stands.
Ruling: P10 Task 9 close() — driver.stop() must be idempotent and close() must not start a second un-awaited stop after shutdown.
Ruling: P11 Task 10 non-group groupId in reducer — ignore (no-op), implementer confirms against code.
Ruling: P12 ccloop gate — ccloop vitest RC may be 1 because of known reds; the gate is check-known-reds.mjs RC 0 plus typecheck/build RC 0.
Task 1: dispatched (sonnet), ccloop BASE 3f66e81
Task 1: implementer DONE_WITH_CONCERNS (5c05ed3); concerns: RED text deviations (report), mutations deferred to mutation seat (by design)
Note: two stray subagent scratch files (scratch_out1*.txt) found in Orca root before Task 2; moved to scratchpad/stray
Task 1: review — spec ✅, quality Approved (task-1-review.md)
Task 1: minor (deferred): worktreeManager.ts attemptRefNamespaces Map has no eviction (bounded by per-run worker process today)
Task 1: minor (deferred): mutations C1-M1, C2-M1..3, C3-M1..2 not yet run — scheduled for the Task 11 mutation seat
Task 1: complete (ccloop commits 3f66e81..5c05ed3, review clean)
Env: scratchpad/env-t1.sh = ccloop 5c05ed3 build (ccloop-t1) + codex-config-t1.json (0600); use from Task 9 on
Task 2: implementer DONE (cf6ee14); deviation: ran its 10 mutations in the MAIN tree (Rule 15 violation — house rules did not say it explicitly; controller's omission). Controller checked 7 mutation sites in HEAD: no residue; tree clean. House rules amended.
Ruling: Task 2 main-tree mutations — accept the commit (no residue found, tree clean) and still rerun its table in the Task 11 clone — cost if wrong: an undetected residue ships until the mutation seat's green baseline catches it.
Task 3: dispatched (sonnet), BASE cf6ee14 (concurrent with Task 2 review — review is read-only)
Task 2: review — spec ✅, quality Approved; 1 Important (process: main-tree mutations) — Ruling: no code change can fix a past process breach; already ruled above, house rule amended, commit verified clean — cost if wrong: none to the code.
Task 2: minor (deferred): webParity.test.ts comment lacks the house citation format (no assertion changed)
Task 2: minor (deferred): commit message says "No existing criterion is changed" though a compile-only helper in webParity.test.ts changed
Task 2: minor (deferred): commandLedger.repositoryRevision duplicates workspaceSettings validation without checking workspaceMode (import direction)
Task 2: complete (commits e1f2bc9..cf6ee14, review clean, 1 process finding ruled)
Task 3: implementer DONE (6c9a35c), no deviations
Task 4: dispatched (sonnet), BASE 6c9a35c; carries rulings P4, P5, P7
Task 3: review — spec ✅, quality Approved, 0 C / 0 I
Task 3: minor (deferred): Rule 17 "files 0600" not literally applicable (module writes no files; git writes checkouts)
Task 3: minor (deferred): assertOwnPath guarantees "direct child of workspacesRoot", slightly broader than "created by this code"
Task 3: minor (deferred): no end-to-end test with a slash/.. runId (hand-traced safe)
Task 3: complete (commits cf6ee14..6c9a35c, review clean)
Task 4: implementer DONE (96c7447); rulings P4/P5/P7 applied; P7 guard red-proved by a pre-commit deletion of its own new line in the main tree (minor process note)
Task 5: dispatched (sonnet), BASE 96c7447 (concurrent with Task 4 review)
Task 4: review (opus) — spec ✅ (3 ⚠️ cannot-verify), quality Needs fixes: 1 Important (D20 draining-before-accept has no criterion that can go red) + process breach (already recorded)
Task 4: ⚠️ resolved by controller: ccloop accept replay idempotence — measured by planner §0(e) (accept.ts:85-89, same executionId or unknown) and Task 0 probe 13/13; commitAttempt idempotence on redo — covered in Task 3 (clean HEAD≠base ⇒ take HEAD, no empty commit); exit-2 meaning — ccloopPort.ts:39 maps refusal; accepted as measured.
Ruling: Task 4 fix round 1 is deferred until Task 5 commits (Task 5 has uncommitted edits in executionDriver.ts; a concurrent fix would mix trees) — cost: minutes of wall clock.
Ruling: fix round 1 also adds criteria for D21 continuation-unsupported and attempt-suppressed (two minors that are "delete and still green") since they live in the same test file — cost: small scope growth.
Task 4: minor (deferred): crash between accept send and its save resends accept without inspect (relies on ccloop replay idempotence, measured)
Task 4: minor (deferred): persistStatus/blockRun write after await without re-checking state (watch in Task 7)
Task 4: minor (deferred): portFor/readStartEnvelope failures inside the provider try are recorded as provider unknown
Task 4: minor (deferred): taskId===null runs stall silently in A2/C
Task 4: minor (deferred): blockRun throwing inside the generic handler aborts the round
Task 4: minor (deferred): C does not cross-check terminal outcome vs candidate terminalOutcome
Task 5: implementer DONE (b4246f0), no deviations
Task 4: fix round 1 dispatched (resume implementer; test-only: D20 draining-before-accept, D21, attempt-suppressed)
Task 5: review dispatched (sonnet)
Budget: controller context passed T2 (451,107 of 1M at this point, per orca level hook). Human said for this session "暂时不要考虑context大小" — continuing by that explicit instruction; breach surfaced here and to be written into the next checkpoint (checkpoint write needs a clean tree).
Task 4: fix round 1 implementer DONE (094a88c, test-only, 21/21)
Task 5: review — spec ✅, quality Approved
Task 5: minor (deferred): D-after-cas crash window is covered by a reconstructed-state test, not driven through the crash hook
Task 5: complete (commits 96c7447..b4246f0, review clean)
Checkpoint c1aa88f written (band 2, past T2) — records the overrun.
Task 6: dispatched (opus), BASE c1aa88f; carries ruling P3 (shared landing helper, no double removeOwnPath)
Task 4: fix round 1/5 (3 addressed, 0 open — D20 draining, D21, attempt-suppressed; commits b4246f0..094a88c)
Task 4: complete (commits 6c9a35c..96c7447 + 094a88c, review clean after 1 fix round)
Task 6: implementer DONE_WITH_CONCERNS (feec694, opus); P3 landOnTip shared, P7 applied; concerns: failed/marker-leaving reconcile spend not booked; CAS race re-reconciles (second spend); stop() does not await background reconcile
Task 7: dispatched (sonnet), BASE feec694 (concurrent with Task 6 review); carries P7 (settled run: cleanup failure ⇒ cleanupError, stay settled)
Task 6: review (opus) — spec ❌ (1, brief-mandated), quality Needs fixes: I1 failed/marker-leaving reconcile spend never booked (spec §5.3(5) says book on finish regardless of outcome)
Ruling: I1 is brief-mandated but conflicts with the spec — spec wins: book the spend on any terminal loop state before blocking, keyed per spawn — cost if wrong: double-booking a spawn (keyed to avoid).
Ruling: fix round 1 also takes cheap minors: wall-clock deadline in the new tests instead of 20 ms pacing (flake risk); missing tokenBudgetRemaining ⇒ book full tokenBudget; merge-base: only exit 1 means "not ancestor"; stop(): catch the pid write instead of guarding it; criteria for reconcile-terminal:* and R-side reconcile-budget — cost: slightly larger fix diff.
Task 6: minor (deferred): a moved tip discards a paid resolution and re-reconciles (bounded by affordability; merge-tree rebuild would save it)
Task 6: minor (deferred): processAlive can wait on a reused pid (record start time)
Task 6: minor (deferred): crash between CAS and the final reconcile write loses the reconcile record (recovers via findLanding); no R-after-cas crash point
Task 6: minor (deferred): orphan scenario's spawns()===0 assertion cannot go red (Rule 9)
Task 6: minor (deferred): no criterion for the moved-tip branch
Task 6: minor (deferred): beginReconcile losing its write leaves copy and runs dir behind
Task 6: fix round 1 deferred until Task 7 commits (same module)
Task 7: implementer DONE (fd385ab); deviations: cleanupError added to driveRecordSchema (.default(null)) for P7; 30 s timeout on CR1 test; found: fake port handoff artifact fails packetSchema ⇒ publishPending throws on every settle, swallowed by the P7 catch
Task 6: fix round 1 dispatched (resume implementer), FIX_BASE fd385ab
Task 7: review (opus) — spec ✅ (1 ⚠️), quality Needs fixes: I1 publish failure after settle swallowed/erased/never retried ⇒ drainPending stalls all groups, restart sets dispatchBlocked (measured in clone t7rev); I2 no criterion checks publication (delete publishPending ⇒ green); I3 process: implementer mutated the main tree again (recorded; no code impact)
Ruling: Task 7 fix round 1 owns tests/control/fixtures/driverPort.ts (Task 4's fixture) for the valid protocol:1 handoff packet — cost: cross-task fixture edit; Task 4/5/6 criteria must stay green.
Ruling: publish failure gets its own publishError field (not cleanupError), publish retried every round on settled-not-cleaned runs, and a successful cleanup never clears publishError — cost if wrong: a stuck publication stays visible instead of silently lost (safe direction).
Ruling: Task 9 E1 must assert projection/task-handoff/group-handoff outbox rows reach delivered=1 after a real settle (covers the ⚠️ real-ccloop packetSchema question).
Task 7: minor (deferred): replenishStartWakes throwing aborts the whole round for all groups
Task 7: minor (deferred): drive wake id count uses unescaped LIKE on group id (can only over-count; no collision)
Task 7: minor (deferred): P7 test comment relies on the bad fixture's round split (still passes when fixed)
Task 7: fix round 1 deferred until Task 6 fix round 1 commits (both may touch executionDriver.ts)
Task 6: fix round 1 implementer DONE (3d0de56), 49/49; reds measured in a clone; items 3-5 without criteria; R-budget test tolerates the fixture's zod error (Task 7 fix removes the cause)
Task 7: fix round 1 dispatched (resume implementer), FIX_BASE 3d0de56
Task 6: fix round 1/5 (6 addressed, 0 open — spend booked on any terminal, wall-clock test loops, full-budget fallback, merge-base exit code, pid after stop, two criteria; commits fd385ab..3d0de56)
Task 6: minor (deferred): pid-unrecorded shared key can under-book two pidless spawns
Task 6: minor (deferred): missing-tokenBudgetRemaining branch has no criterion (fake ccloop always sets it)
Task 6: complete (commits c1aa88f..feec694 + 3d0de56, review clean after 1 fix round)
Task 7: fix round 1 implementer DONE (015ccf5), 1715 pass; no mutations
Task 8: dispatched (sonnet), BASE 015ccf5; carries ruling P1 (use the corrected two-line retryRun form)
Task 7: fix round 1/5 (2 addressed + fixture, 0 open — publishError retried separately from cleanup, delivered=1 criteria, valid fixture packet; commits 3d0de56..015ccf5)
Task 7: complete (commits feec694..fd385ab + 015ccf5, review clean after 1 fix round)
Task 8: implementer DONE (56120d3, 592ab9c); zero existing criteria rewritten (D7 held); ERRATUM prefix-identical (+1368 bytes)
Task 9: dispatched (opus), BASE 592ab9c; env-t1; carries P9, P10, and "E1 asserts publication rows delivered=1"
Task 8: review — spec ✅, quality Approved with 2 Important: (1) no criterion distinguishes the P1 two-line order from a short-circuited one-liner; (2) frozenSetIsInconsistent may flag a run frozen under exemptDriverRuns=false then re-evaluated with true
Ruling: Task 8 fix round 1 runs concurrently with Task 9 (disjoint files: controlLifecycle.ts/stopIntent.ts + tests vs controlAssembly.ts); the fixer commits only its own paths — cost: possible test-load flake during both seats' full runs.
Task 8: fix round 1 dispatched (resume implementer)
Task 8: fix round 1 implementer DONE (fa36f80, test-only); finding 2 did not reproduce (freeze always writes a handoff_requests row) — no source change
Task 8: minor (deferred / register in handoff): a run frozen by a shutdown without a driver stays frozen when the driver is later enabled (exemption is not retroactive)
Task 8: fix round 1/5 (2 addressed, 0 open — P1 order criterion; frozen-set sequence criterion, no source change needed; commits 592ab9c..fa36f80)
Task 8: complete (commits 015ccf5..592ab9c + fa36f80, review clean after 1 fix round)
Task 9: implementer DONE_WITH_CONCERNS (5e5130f, opus); 1742/1742 with env-t1; concerns: (1) command-verifier tasks never settle vs real ccloop (verify phase usage null ⇒ unknown ⇒ settle-incomplete) — tests switched to agent verifier; (2) E1 makes 11 provider calls (reconcile contract hard-codes command verifier); (3) knownRepository wired even when unconfigured; (4) test cleanup retries temp-root delete
Ruling: concern (1) is fixed in ccloop, not Orca — Orca must not fabricate a peer observation (handoff §8.4); ccloop knows a phase made no provider call and must report zero usage for it (C4, ccloop production change; human's standing "allowed to change ccloop when needed, report first" + this slice's "change ccloop too") — cost if wrong: one more ccloop commit to revisit.
Ruling: concern (3) must be gated on a configured port (spec: unconfigured ⇒ byte-identical) — goes into Task 9 fix round.
C4: measured (verify command branch + required-check failure lack tokenUsage ⇒ null ⇒ Orca unknown.work ⇒ settle-incomplete); dispatched in ccloop (sonnet), BASE 5c05ed3
Task 9: review (opus) — spec ❌ (ungated knownRepository, already ruled), quality Needs fixes: I1 gate knownRepository + red criterion; I2 E1 command-verifier task after C4 (red with settle-incomplete before C4)
Ruling: Task 9 fix round 1 waits for C4 and a new ccloop build (ccloop-t2/env-t2), then covers: gate, command-verifier E1 task, R1 independent end-state checks (worktree list, workspaces dir, human unchanged, orca/g commit count), try/finally shutdown in scenarios, decide whether the leftover reconcile-* copy is intended (if a leak: clean it and assert gone), and Rule 17: prove the real ccloop child writes nothing under the real $HOME (relocate HOME for the child or snapshot) — cost: one larger fix round.
Task 9: minor (register in handoff): background reconciliation outlives driver stop() — a product leak, not a test artefact
Task 9: minor (deferred): SQLite ExperimentalWarning in logs (repo-wide, pre-existing)
Task 10: dispatched (sonnet), HEAD 5e5130f; carries P11; runs concurrently with C4 (other repo)
Task 10: implementer DONE (088529f); P11 confirmed no-op; deviation: attribute order in SSR regex (React 19 emits checked before value); App.tsx wiring has no runtime coverage (useEffect under SSR)
C4: implementer DONE (ccloop 9a91d2b); built ccloop-t2 + env-t2.sh (codex-config-t2.json 0600); use env-t2 from now on
Task 9: fix round 1 dispatched (resume implementer, env-t2): gate, command-verifier c, R1 independent checks, try/finally, reconcile-copy decision, Rule 17 HOME proof. C4: review dispatched.
C4: review — spec ✅, quality Approved, no findings (no other provider-free phase exists today)
C4: complete (ccloop commits 5c05ed3..9a91d2b, review clean)
Task 10: review — spec ✅, quality Approved
Task 10: minor (deferred): sendWorkspaceMode does not register a command-uncertain entry like sendControl (mitigated by CAS expectedRevision + refetch; plan-mandated)
Task 10: minor (deferred): send path has no unit coverage — factor the envelope builder into a pure function
Task 10: complete (commits 5e5130f..088529f, review clean)
Task 9: fix round 1 implementer DONE (73d23c7), 1744/1744 env-t2; E1 red on env-t1 (c=settle-incomplete) green on env-t2; HOME+XDG relocated with a proven-red probe; reconcile-/conflict- dirs kept per §3.5 (register)
Task 9: fix round 1/5 (6 addressed, 0 open — gate, command-verifier E1 (red on env-t1, green on env-t2), R1 independent checks, try/finally, conflict-/reconcile- kept per §3.5, HOME+XDG relocated with red probe; commits 088529f..73d23c7)
Task 9: register in handoff: conflict-<runId> and reconcile-<runId> dirs retained per reconciled run, unbounded; reconcile-<runId> not named in spec §3.5
Task 9: complete (commits fa36f80..5e5130f + 73d23c7, review clean after 1 fix round)
Task 11: mutation seat dispatched (sonnet); controller runs the gates after it finishes
Final whole-branch review dispatched (opus), Orca e1f2bc9..73d23c7 + ccloop 3f66e81..9a91d2b; runs concurrently with the mutation seat (both read-only on main trees)
Final review (opus): 0 C / 6 I / 13 m, verdict "With fixes" (final-review.md)
Ruling: final fix wave (one seat, opus) fixes I1 (settle must not clear an over-budget block; driver must not dispatch a blocked group), I2 (only a moved tip retries; other CAS failures block with a named reason), I3 (reconcile ccloop run spawned detached with stdio to files; restart waits on a live pid, never deletes live loop state), I4 (retry of a failed/marker-leaving reconcile discards the old terminal state and re-runs; booking key is a persisted per-spawn sequence, not the pid), I5 (panel retry button for driver-blocked runs sending run-scope recovery-retry), I6 (spec §12 appended: register conflict-/reconcile- retention, and the honest statement's two missing limits: D12 limit raise, C4 ccloop ≥ 9a91d2b) — cost: a large fix diff after the mutation baseline (affected mutations to be rerun).
Ruling: m5 (graceful shutdown still writes group stop intents; restart needs human resume) and m6 (one never-publishing run makes restart set store-wide dispatchBlocked) are registered in the handoff, not fixed this round — cost: operational friction after restarts.
Ruling: m1 — controller recounts check-driver EXPECTED from a real vitest run before gating.
Close: T5 D-after-cas minor (covered by R1).
Final fix wave: dispatched (opus), BASE 73d23c7
Task 11 mutation seat: interim — ccloop 8, T2 10, T3 8, T4 19, T5 5 done, all restored by sha256. Not red: C2-M2, C2-M3 (per-run ref publish path not exclusively pinned; e2e rebuilds from the live worktree), C4-M1 (predicted; requiredChecks-failure zero usage unpinned), T4-M13/M14 (predicted redundant), T4-D20 (stepB draining guard shadowed by replenishStartWakes' gate entering first — redundant guard), T5-M2 (already-landed short-circuit indistinguishable: merge --no-ff is a no-op). T6–T10 and T9 E2E chain still running in the seat's background.
Ruling: register C2-M2/M3, C4-M1, T4-D20, T5-M2 as "no exclusive criterion / redundant guard" (handoff §六.1: do not invent a criterion) unless the final review or mutation notes show a real hole — cost: those lines can regress silently.
Final fix wave: DONE (fe36530 I1, 06e5945 I2, 000bea1 I3, 62e5310 I4, bf4dbb2 I5, 850d8a1 I6); 1756/1756 env-t2; concerns: breach-blocked group has no exit but stop/recover (setLimit refuses blocked); a pre-block pending wake is still claimed (held at A1); a dead unfinished reconcile is not booked before respawn
Final fix wave re-review (opus): I1–I6 ADDRESSED, 0 new Critical; 1 new Important (spec §12 I4 line overstated booking) — Ruling: corrected in place (unpublished text written this round) + §12(d) registers residuals (breach-blocked group exit, orphan+retry double reconcile, spawnSeq key unpinned) — controller doc commit; cost if wrong: none to code.
Final fix wave: minor (register): a detached child may outlive a test's temp root (HOME relocated; harmless); pre-upgrade collected record retried once books again under spawn-0; a transient lock now blocks instead of retrying.
Task 11 mutation seat: 9/10 groups done. New: T6-M10 predicted redundant but red on 6 criteria (the reconciling-in-flight guard is load-bearing; prevents double spawn). Seat fixed its own scoping errors (T7-M6/7/8 → driverSettle; T8-M3/4 → driverRecovery) and reran: red as predicted. Seat kill -9'd one vitest child of its own battery (its own process, misjudged as orphan) — T9-M1 row unreliable, to be rerun standalone.
Gates (HEAD e5ad932, env-t2, concurrent with the mutation seat): typecheck 0; npm test 1 red (driverSettle "commits the checkpoint exactly once across a death after the acceptance": Test timed out in 5000ms); check-driver 1 (same test); verify:control 0 (54 files/562, 0 skipped); verify:web-control 0 (18/197); consumer 0 (5/5); scheduler 0 (51/167); chain 0 (second segment 195 files/1756 all passed); web build 0; panel 15/15; ws 16/75; claude-md 0; hooks-path 0; ledger 2.
Ruling: the red is a timeout budget, not behaviour — alone it takes 1.97 s and passes 5/5; give the real-git settle criteria an explicit 30 s timeout (same form as the file's existing CR1 test) — dispatched to a cheap seat; rerun the full suite after. Cost if wrong: a real slowness regression is masked up to 30 s.
Task 11 mutation seat: COMPLETE — 124 mutations (73d23c7 + e5ad932 rerun of T3/T5/T6 + I1–I5 delete-the-fix), 99 red as predicted, 25 not red (19 predicted, 6 mismatches: C2-M2, C2-M3, T4-D20, T5-M2 root-caused; T6-M10 opposite direction = load-bearing), I4-delete red (controller's own "not red" prediction was wrong: spawnSeq key is load-bearing). Seat reports executionDriverE2E flaky under sandbox load (unmutated baselines 9/9 and 5/9, R1 sub-cases). Ledger: mutations.md. Clones removed; main trees clean.
Ruling: C2-M2/M3, C4-M1, T4-D20, T5-M2 and the other no-exclusive-criterion rows are registered, not given invented criteria (handoff §六.1) — cost: those lines can regress silently.
Controller: rerunning executionDriverE2E alone 3x with no concurrent load, then the final full suite + judge.
Timeout fix: ea751b4 (test-only, 11 × 30 s timeouts in driverSettle.test.ts; controller verified no assertion changed)
FINAL (HEAD after ea751b4, env-t2 = ccloop 9a91d2b build, no concurrent load): executionDriverE2E alone 3/3 runs × 9/9; full vitest 1756/1756, 0 failed, 0 pending/todo; check-driver RC 0 (12 new/changed criterion files all passed). Earlier gate pass (e5ad932, under load): verify:control 54 files/562, verify:web-control 18/197, consumer 5/5, scheduler 51/167, chain second segment 195/1756, web build 0, panel 15/15, ws 16/75, claude-md 0, hooks-path 0, ledger 2.
Register: executionDriverE2E is flaky only under heavy concurrent load (mutation seat saw 5/9 with two clones running); unloaded 3/3 green — judge a red there by rerunning the file alone.
