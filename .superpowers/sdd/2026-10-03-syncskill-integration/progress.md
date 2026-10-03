# Progress — syncskill integration (per-run skill snapshots)

Controller: Orca session 08b1007d, 2026-10-03. Spec: docs/superpowers/specs/2026-10-03-syncskill-integration-design.md (§10 overrides §1–§9).
Plan: docs/superpowers/plans/2026-10-03-syncskill-integration.md. Human (2026-10-03): execute subagent-driven; decide problems by the controller's recommendation without asking; report everything at the end.
Base: Orca main at the plan commit; ccloop main 85a9564 (pushed, = origin at start).

## Rulings
Ruling: skills apply to plan, execute and verify alike (spec §10.7) — human agreed 2026-10-03.
Ruling: the injected snapshot is made read-only (spec §10.6) — human agreed 2026-10-03.

## Tasks
SDD ledger — plan: docs/superpowers/plans/2026-10-03-syncskill-integration.md

## Pre-flight scan (controller)
| Pair / task | Produces → consumes | Finding |
|---|---|---|
| T2 → T3 | `isSafeSkillName`, `PROFILE_NAME_PATTERN` (src/skills/syncskill.ts) → loopSkillsSchema | consistent |
| T2 → T4/T5 | `profileMembers`, `SyncskillError` codes → confirm / set-task-loop refusals | consistent (`skills-shape`, `skills-profile-empty`, `syncskill-failed:<E>`) |
| T2 → T6 | `injectSkills` → A2; block reason `skills-inject-failed:<SyncskillError.code>` | consistent with C10 text |
| T3 → T4/T5 | recipe `skills` → snapshot freeze, kept/no-op | consistent |
| T4 → T5 | `replaceTaskInSnapshot` gains a skills argument (T5); `readConfirmedTaskExecution().skills` (T4) | T5 must update the existing caller in setTaskLoop only — consistent |
| T4 → T6 | `readConfirmedTaskExecution().skills` → stepA2 | consistent |
| T1 → T6 | ccloop envelope `work.skillPluginDir` → Orca schema.ts copy + toStartEnvelope | consistent; Orca gate needs ORCA_CCLOOP_BIN = Task 1 build |
| T5 ↔ T7 | both edit web/src/LoopPlanCard.tsx (payload vs display) | sequential, no conflict |
| T4, T5, T6 | all add codes to src/control/errors.ts | additive; later tasks reuse existing codes |
| T1 self | validateEnvelopePaths(envelope) has no method argument today | needs the method passed from parseControlRequest — in scope |
| T6 self | A2 `removeOwnPath(dir)` on a leftover dir made read-only by a crashed earlier A2 cannot empty it | see ruling below |
| T2–T7 self | tests named match the code each task specifies | no further finding |

Ruling: work directly on Orca and ccloop `main` with local commits, no worktree branch — every previous Orca round did so, the human asked for this round to run unattended, and Rule 15 makes a merge into main a human act — cost if wrong: commits sit on local main instead of a branch (still unpushed, revertible).
Ruling: one helper removes a skills dir by first restoring owner write permission recursively, used by both A2's leftover removal and cleanupRunWorkspace — a read-only tree cannot be emptied otherwise — cost if wrong: none beyond the helper.
Ruling: Task 1 (ccloop tree) and Task 2 (Orca tree) run concurrently — different repositories, no shared file, and the one-implementer-per-tree rule still holds — cost if wrong: none (no shared state).
Task 1: dispatched (ccloop base 85a9564)
Task 2: dispatched (Orca base d017cb0)
Task 1: implemented (commits 5f58806..af26a22), DONE_WITH_CONCERNS: worker re-validates skillPluginDir as accept on relaunch => dir must live until collected; ENOTEMPTY cleanup flake in new accept test fixed by retries
Task 2: implemented (commit 847a7a6), DONE: concerns — real test cannot show --no-refresh matters (seeded dir unchanged either way; argv assertion is the proof); restore proof by staged-diff bytes
Task 2: review — spec ✅, quality Approved, 0 Critical/Important; 6 Minor (see task-2-review.md), e.g.:
Task 2: minor (deferred): STDERR_EXCERPT_BYTES slices characters, not bytes (syncskill.ts).
Task 2: minor (deferred): --no-refresh is guarded only by the fake-argv test; the real-bin test cannot turn it red (seeded dir unchanged either way).
Task 2: minor (deferred): an inject failure test uses target "/x".
Task 2: ⚠️ errors.ts registration of syncskill-failed:* and skills-shape is Task 4's — carried into Task 4 dispatch.
Task 2: complete (commit 847a7a6, review clean)
Task 1: review — spec ✅, quality Approved, 0 Critical/Important; 5 Minor (task-1-review.md), e.g.:
Task 1: minor (deferred): the envelope-hash golden at protocol.test.ts:384 never passes through the schema, so it cannot go red.
Task 1: minor (deferred): the M4 per-method check sits in one `it`; `collect` alone was never seen red.
Task 1: minor (deferred): a replayed `accept` after skillPluginDir is removed answers control-request-invalid ⇒ Orca must keep skills-<runId> until the run is collected (carried into Task 6).
Task 1: complete (ccloop commits 5f58806..af26a22, review clean)
Task 3: implemented (commit 60a0eb0), DONE; note: both-keys/empty/bad-profile refused by zod at plan parse, name-rule as loop-plan-invalid:<task>:skills-shape
Task 3: review — spec ✅, quality Approved, 0 Critical/Important; 3 Minor (task-3-review.md).
Ruling: C2's both-keys / empty-names / bad-profile cases are refused by the plan-file zod schema (`malformed: tasks.N.loop.skills: Invalid input`), not as `skills-shape`; only name-rule violations answer `loop-plan-invalid:<task>:skills-shape` — every other malformed plan field is refused the same way and it fails closed — cost if wrong: a person sees a less specific error for those three shapes.
Task 3: minor (deferred): loopRecipeSchema does not apply the name rule; only expansion validates names.
Task 3: minor (deferred): the "contract has no skills" test passes trivially (guard only).
Task 3: complete (commit 60a0eb0, review clean)
Task 4: dispatched (Orca base 60a0eb0, opus)
Task 4: implemented (commit 114b20d), DONE with deviations: deps.syncskill optional (absent = unconfigured); all 9 codes durable 422; zh locale entries added; agent check compares the installation id to "claude".
Ruling: the plan's confirm-time `skills-unsupported-agent` check is wrong — `selection.agent` is an agents-table installation id (ccloop materialize.ts resolveAgent: kind = table.installations[id].kind) and Orca never reads the table nor freezes the kind. Remove the Orca-side agent check and rely on ccloop's acceptStart refusal (Task 1: nothing persisted; Orca blocks `accept-refused:skills-unsupported-agent`) — cost if wrong: a codex task with skills is refused at run start instead of at confirm.
Task 4: review — spec ✅, quality Approved, 0 Critical/Important; 7 Minor (task-4-review.md). Controller-confirmed gaps entering the fix loop: F1 agent check by installation id (ruling above); F2 names-only task with syncskill unset must refuse confirm `syncskill-unconfigured`.
Task 4: minor (deferred): skills refusals precede prepareExecutionSnapshot's own checks (brief placement vs spec "after every existing check").
Task 4: minor (deferred): a syncskill lookup is spawned even when confirm will refuse no-op/stale.
Task 4: minor (deferred): a broad catch while reading recipes before the transaction.
Task 4: minor (deferred): syncskill-timeout is recorded as a durable outcome for that command id.
Task 4: minor (deferred): fake-syncskill path in a test depends on cwd.
Task 4: fix round 1 dispatched (F1, F2, bare toThrow)
Task 4: fix round 1/5 implemented (commit 7ab2fa2): F1 agent check removed with skills-unsupported-agent unregistered in Orca; F2 names-only + unset bin refused; named error in test. Scoped re-review dispatched.
Ruling: spec §10.5's set-task-loop `skills-unsupported-agent` refusal is dropped for the same reason as F1 (installation id, not kind) — ccloop acceptStart is the only agent-kind authority — cost if wrong: a codex task given skills after confirm is refused at run start, not at set-task-loop.
Task 4: fix round 1/5 (3 addressed, 0 open; commits 114b20d..7ab2fa2)
Task 4: complete (commits 60a0eb0..7ab2fa2, review clean)
Ruling: a set-task-loop payload without `skills` removes the task's skills (the payload is the full desired state, like `inputs`); a profile is looked up before the transaction whether the task is draft or confirmed, the result used only on the confirmed branch — cost if wrong: a draft set-task-loop with a profile fails when syncskill is unavailable, though confirm would fail anyway.
Task 5: dispatched (Orca base 7ab2fa2, opus)
Task 5: implemented (commit edf59e3), DONE; 7 existing test files got `await` (49 calls), setTaskLoopConfirmed passes null to replaceTaskInSnapshot; BudgetEditor's estimate-suggestion path also re-sends skills.
Task 5: controller-confirmed gap (H3): a budget-only set-task-loop on a confirmed task re-resolves its profile and can change the frozen names or be refused when syncskill is unset. Fix: when the payload's skills equal the current recipe's skills, keep the frozen snapshot entry and spawn nothing; look up only a changed declaration.
Task 5: review — spec ❌ (H3), quality Needs fixes; Important I1 (budget-only edit re-resolves a frozen profile); 3 Minor.
Ruling: an unchanged skills declaration on a confirmed task keeps its frozen snapshot entry with no lookup; draft tasks never look up (confirm freezes them); a confirm race is refused as a state conflict — H3 says later profile edits do not reach a confirmed task — cost if wrong: none beyond H3.
Task 5: minor (deferred): a skills-only change never sets planChanged (H12 is about the contract; skills are not in it).
Task 5: fix round 1 dispatched (I1, draft lookup, re-indent)
Task 5: fix round 1/5 implemented (commit dc70658): I1 unchanged declaration keeps frozen entry, drafts never look up, race refused proposal-version-conflict, re-indent; redundant unset-bin check removed (profileMembers already refuses). Scoped re-review next.
Task 5: fix round 1/5 (3 addressed, 0 open; commits edf59e3..dc70658)
Task 5: complete (commits 7ab2fa2..dc70658, review clean)
Task 6: dispatched (Orca base 5f2639c, opus; ccloop af26a22 build in scratchpad/t6)
Task 6: implemented (commit 01b74bc), DONE; concerns: C5 with fake syncskill only; recorded dir is realpath; fake lock shape guessed; read-only residue possible in TMPDIR on test failure
Task 6: review — spec ❌ (C5 not run with real syncskill), quality Needs fixes; Important: C5 real; 3 branches without a red mutation (symlink skip in makeReadOnly / restoreOwnerWrite, describeError block reason); 5 Minor.
Task 6: spec §7 row "skills-inject-failed:E_SKILL_NOT_FOUND" is stale vs the code's `skills-inject-failed:syncskill-failed:E_SKILL_NOT_FOUND` — controller appends a spec correction section at the end.
Task 6: fix round 1 dispatched (real-syncskill A2 test; symlink-skip and describeError mutations)
Task 6: fix round 1/5 (2 addressed, 0 open; commits 01b74bc..2ea3271)
Task 6: minor (deferred): driverSkills.test.ts:35 relies on chmod 0500 producing EACCES (would not fail as root).
Task 6: complete (commits 5f2639c..2ea3271, review clean)
Task 7: implemented (commit bacb9d7), DONE_WITH_CONCERNS: 3 existing assertions changed (old 'not supported yet' string); run view profile not rendered; scheduler files red in clone without ccloop bin (env)
Task 7: review — spec ✅, quality Approved, 0 Critical/Important; 5 Minor (task-7-review.md). Controller resolved the ⚠️: controlViews reads snapshot.skills[].names by taskId, matching the schema `{taskId, profile, names}`.
Task 7: minor (deferred): run view sends profile/source the UI does not render; commit truncated to 12 chars; no test parses a view through the new webProtocol schemas; SkillsGiven taskId filter has no named mutation.
Task 7: complete (commit bacb9d7, review clean)
Final review: ready with fixes (final-review.md). Important I1 (codex task with skills is stuck after accept refusal), I2 (spec §9 points unmeasured; no probe under scripts/). Must-fix Minors: T1, N1, N4, N5, N6.
Ruling: I1 option (b) — keep ccloop acceptStart as the only agent-kind authority, add a codex-variant E2E pinning the named block, and record the real cost (the task cannot be changed or re-dispatched; only stopping the group ends it) in spec §11 and the handoffs; next round's codex skill support (H6) removes the path — cost if wrong: a person who pairs codex with skills before then must stop the group.
Ruling: I2 — commit an offline recorder probe (no model call, H5 not engaged) and record what claude 2.1.288 does with the lock file, plugin skill names and a read-only plugin dir in spec §11 — cost if wrong: none.
Ruling: N1 — on a confirmed task a CHANGED skills declaration (names or profile) with ORCA_SYNCSKILL_BIN unset is refused `syncskill-unconfigured`, matching confirm; unchanged declarations stay accepted — cost if wrong: a names change after confirm needs syncskill configured.
Final fix wave dispatched (one fixer: T1 ccloop, N1, codex E2E, probe script). N4/N5/N6 are the controller's (gate + spec §11).
Final fix wave: implemented (ccloop 01d1684; Orca 848055b, d6e56cf, 3e1366d). Probe: claude 2.1.288 sees the skill as orca-run-skills:<name>, lock file absent from requests, read-only plugin dir loads. I1 block reason exactly accept-refused:2:skills-unsupported-agent. One existing C15 assertion changed (it pinned names accepted with bin unset, which N1 forbids).
Final fix wave: re-review — T1, N1, I1, I2 ADDRESSED; no new breakage (final-rereview.md).

## Controller gate (clones under scratchpad/gate; HOME + 4 XDG roots redirected; TMPDIR mktemp -d /private/tmp/og-XXXX)
ccloop at `test(control): hash the schema's output in the skillPluginDir envelope-hash golden`: build 0, typecheck 0, vitest 1140 tests only stopProof red, check-known-reds 0, check-tmp-leak 0.
syncskill clone at its main (`docs(sdd): record the --sync-dir follow-up …`) built for the real tests.
Orca at `chore(scripts): add the offline claude probe for an A2 skill plugin dir` (ORCA_CCLOOP_BIN = that ccloop build):
- npm test 2724: 2713 passed, 9 skipped, 2 failed = registered 5 s flakes gateCheck K13, driverRequirementSplit; each alone 3/3 green (load 4–6). `verify` stopped there (&& chain), so the rest ran separately:
- ledger 0, claude-md 0, hooks-path 0, verify:scheduler 0 (194), verify:ccloop-pin 0 (3), verify:panel 0 (395), web build 0, --ws check 0; verify:control 0 (1294 passed, 4 skipped; ORCA_AGENTS_TABLE = fake codex `integration`); verify:chain's full run 3 red = registered flakes (K13, driverRequirementSplit, controlShutdown 143).
- real binaries (ORCA_SYNCSKILL_REAL_BIN = syncskill clone dist, ORCA_CCMEM_REAL_BIN = ccmem bin): syncskillReal, driverSkillsReal, ccmemReal 3/3 ran and passed (not skipped).
- check-tmp-leak: 1 root left in each of two HEAD runs (empty except the two setup dirs); the same check at the pre-round commit d017cb0 left 0 ⇒ treated as a regression of this round, under investigation (instrumented run).
- real ~/.syncskill entries and ~/.orca mtimes identical before/after the gates (only HOME's own mtime moved).
Leak investigation (systematic, instrumented clone copy of tests/setup/scopeTmpdir.ts writing `.pid` at load and `.file` in beforeAll): the leaked root had `.pid` and no `.file` ⇒ a file whose hooks never ran. The one fully skipped file is the pre-existing tests/control/ccloopProtocol.integration.test.ts (`describe.skipIf(!binary || !agentsTablePath)`, L33). Alone: without ORCA_AGENTS_TABLE it leaves 1 root, with it 0. The HEAD leak runs had no table; the pre-round comparison ran after gate3 exported one ⇒ NOT a regression of this round; the file violates the scopeTmpdir ERRATUM (collection-time skip). Registered, not fixed (out of scope, Rule 3): fix = gate with ctx.skip() in beforeEach.
N5 capacity (spec §11.5): inject 214–293 ms, 8 KiB per one-file skill; profile ls 206–210 ms (load 4.1).
Final: all tasks complete, final review fixes addressed and re-reviewed, gate as above.
