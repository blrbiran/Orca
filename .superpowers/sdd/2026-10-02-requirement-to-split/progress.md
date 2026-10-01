# SDD ledger — plan: docs/superpowers/plans/2026-10-02-requirement-to-split.md
Spec: docs/superpowers/specs/2026-10-02-requirement-to-split-design.md (section 15 = corrections from planning)
Controller: Orca session b5e8d368. Human (2026-10-02): "写完计划使用 subagent driven 的方式实现。这一轮执行过程中如果有问题，先按你的建议执行（不要再找我）。执行完在最后阶段报给我审核。" and "这个session暂时不要考虑context大小".
- Ruling: work lands as local commits on main, as every earlier round in this repo did — a worktree branch would need a human-authorized merge into main and worktree deletion (Rule 15) — costs if wrong: the human rebases or reverts local commits before pushing.
- Ruling: DR5 accepted — control store schema v6 with the two existing "5" assertions rewritten (named in the plan) — a new migration step is how this store adds tables; additive tables without a bump would let an older build open a store it cannot read — costs if wrong: two assertions reverted and the migration folded differently.
- Ruling: the 28 drafter rulings DR1–DR28 are adopted as written; spec section 15 records the corrections they force — costs if wrong: per-ruling rework, each named in the plan.
Task 0: dispatched (sonnet; measurements only, no commits)
- Ruling: the preflight scan is delegated to an opus reviewer writing preflight-scan.md, and Task 0 (scratch-only) runs in parallel with it — the plan is 313 KB and reading it whole in the controller would cost its coordination context; Task 0 touches no repository file — costs if wrong: a scan miss surfaces in a task review instead.
Task 0: complete (no commits; controller spot-checked a3/a5/a7/a9/a10/b1: ast-grep 0.45.3, ancestor sgconfig fatal without -c (rc 79), -c clean, 0-byte before/after cmp, keys [items,language,path], path "./src/a.ts", no queue mode in fake claude; survey lines unmoved at f05b6d4)
- Preflight scan: preflight-scan.md (2 blocking, 10 important, 20 minor). Ruling: PR-B1..PR-I10 in preflight-rulings.md, appended to the plan as a named section — each fixes the task text it names; minors applied by the owning implementer — costs if wrong: per-row rework in the named task.
Task 1: dispatched (opus; BASE 8f3dc49)
Task 1: implementer DONE (9fde6b7; agent ad04a8eba0c872f4f); 224/224 on the Step 9 list, typecheck 0; mutations M1.1-M1.4 red at named criteria, restore 0/0. Review dispatched (opus).
- Ruling: Task 1 Important (plan-mandated DR2 duplicates) — keep both old names per DR2 but as one-line delegations to the new functions — spec §5.1 "written once" binds over the plan; DR2 only asked that the names survive — costs if wrong: none (names and behaviour unchanged).
Task 1: minor (deferred): an unknown purpose now also throws during stop settlement (no such run can be stored in phase 1)
Task 1: minor (deferred): estimate-only branches remain at stopIntent.ts:603, panel/controlViews.ts:649, startEnvelope.ts:92,118 — phase 2 tasks own them (S26, S20)
Task 1: fix round 1/5 (2 addressed, 0 open; commits 9fde6b7..0d5e0b4)
Task 1: complete (commits 8f3dc49..0d5e0b4, review clean)
Task 2: dispatched (sonnet; gate at 0d5e0b4)
Task 2: complete (gate1 at 0d5e0b4, ccloop 99054f2: Orca 2372/2368 passed, 1 failed = known flake controlShutdown, single file 3/3 green at load1 5.26; 3 pending ccloopDefaultE2E; ccloop 1045/1044, stopProof only, known-reds 0; web 318/318; verify:panel and verify:ccloop-pin 0; tmp-leak 0 both; ~/.orca stat+sha identical; controller re-read rc.txt, or.json counts and rerun logs)
Task 3: dispatched (sonnet; BASE 0d5e0b4; agent ad1aa700c0b801d2a)
Task 3: implementer DONE_WITH_CONCERNS (3c4ffdb); 35/35, typecheck 0, M3.1-M3.3 red, restore 0; named rewrites (DR5/PR-I8): agentPreferences.test.ts > migrates a version 4 store by adding the preferences table; workspaceSettings.test.ts > migrates a version 3 store by adding the settings table
- Ruling: schema5To6 uses CREATE TABLE IF NOT EXISTS — the two named old criteria downgrade a current store by dropping one table only, and the migration is idempotent by design — costs if wrong: a half-migrated store is not detected by the CREATE itself.
- Note for Tasks 4/6/10: PR-I5 helpers are clarifyingLedger(limit) and hasRequirementBlock(group) in src/control/requirementRecords.ts. Note for Tasks 4/12 (F17): group-state enums at web/src/controlTypes.ts:46, src/panel/controlViews.ts:49, webProtocol.ts:894 lack "clarifying".
- Note: checkpoint commit 580e99f (controller, .orca/checkpoints only) sits inside Task 3 range 0d5e0b4..3c4ffdb.
Task 3: complete (commits 0d5e0b4..3c4ffdb, review clean)
Task 3: minor (deferred): CREATE TABLE IF NOT EXISTS would accept a pre-existing wrong-shape table
Task 3: minor (deferred): requirementRecords readers/writers (readRounds, readDrafts, latestDraft, refuseClarifying, saveRequirementGroup, queueRequirementCall, parsedDraft state-mismatch) have no criterion yet — the tasks that use them (4, 6, 9) must pin them
Task 3: minor (deferred): saveRequirementGroup UPDATE on a missing id is a silent no-op that still records a projection change
Task 4: dispatched (opus; BASE 3c4ffdb; agent a4714bde7903903a2; carries PR-B1, PR-I5, F17 enums)
- Ruling: Task 4 BLOCKED on web/tests/i18nPseudo.test.tsx > every enum value has its words in both languages (spec §3.5) > reads every family (ENUM_VALUES.length 146) — authorised as a named rewrite to the new count (147), and the same for any later task that adds enum values with both languages, each named in its report — the number counts the catalogue mechanically; the criterion that both languages carry the words stays untouched — costs if wrong: one number reverted.
Task 4: implementer DONE_WITH_CONCERNS (81b114c); Step 7 157/157, web 34/34, typechecks 0; mutations 20/21 red (M4.13a green by design); named rewrite i18nPseudo count 146->147
Task 4: complete (commits 3c4ffdb..81b114c, review clean)
Task 4: carry -> Tasks 6/9/10: after handoff-stop a clarifying group is stopped with a handoff-complete intent and resume-from-handoff is refused; recovery-retry or the requirement-call path must clear both
Task 4: carry -> Task 6: settlement of a requirement call must not go through releaseRunReserve legacy branch (S28)
Task 4: carry -> Task 10: criterion for the summary of an imported group that still carries a requirement block
Task 4: minor (deferred): clarifying set-limit decrease allowed while usage unknown; requeue fires on any limit change; setRequirementLimit and summary pick the waiting call by different rules (+4 more in task-4-review.md)
Task 5: dispatched (opus; BASE 81b114c; agent a402756c3378a516d; carries PR-I3, PR-I6, Task 0 facts, @ast-grep/cli 0.45.3 dependency approved)
Task 5: implementer DONE_WITH_CONCERNS (a7ca7b5); 15/15, typecheck 0, 13 mutations red, restore 0/0
- Ruling: Task 5 concern m10 — only an ok structure result is cached; timeout/failed/unavailable/skipped are rebuilt next call (file list and documents stay cached) — a cached timeout or a pre-install unavailable would otherwise stick for the commit forever — costs if wrong: repeated 30 s attempts on a repository that always times out.
Task 5: minor (deferred): startup sweep of tmp-* would delete a concurrent build's dir; safe while the driver builds overviews serially (executionDriver.ts:810-814)
Task 5: note: npm reports 5 audit vulnerabilities — the same count the repin install reported before this task
- Ruling: Task 5 Important (git archive runs the target repository smudge filters, unbounded) — export blobs with git cat-file --batch from the ls-tree listing instead of git archive (raw blobs: no filters, no attributes), timeouts on every git/tar child, a criterion whose smudge filter would write a marker — spec §6 says git archive; that wording gets a section-15 correction — costs if wrong: a slower export path for very large trees.
Task 5: minor (deferred): every kill reported as timeout; symlinks in the export; real-binary criterion skipped silently under --ignore-scripts
Task 5: fix round 1/5 (3 addressed, 0 open; commits a7ca7b5..20eb9a6)
Task 5: complete (commits 81b114c..20eb9a6, review clean)
Task 5: minor (deferred): structureTimeoutMs 1 criterion could be racy; maxBuffer kill reported as timeout
Task 6: dispatched (opus; BASE 792beca; agent a60bc656db34411eb; carries PR-I4, PR-I5, PR-I9, Task 4 carries (stop/interrupt, no legacy release), serial overview builds)
Task 6: implementer DONE_WITH_CONCERNS (0eaab2b); new 16/16, step-9 126/127 (controlShutdown flake, 6/6 idle at head and base), estimate+neighbours 152/152, typecheck 0; M6.1-M6.10 red; shared helper src/control/singleCallLedger.ts (PR-I4)
- Ruling: Task 6 ⚠️ — a provider failure with no output counts as an invalid output and uses one of the two automatic retries — H7 bounds any automatic retry at two; a call with no output is the same class of failure as an invalid one — costs if wrong: up to two extra paid calls on an outage.
- Task 6 ⚠️ resolved by the controller: astGrepBin is forwarded on the real path (controlAssembly.ts:247 resolveAstGrepBin(env) -> driver deps -> requirementCalls.ts:116).
Task 6: minor (deferred): agentCapabilities is the slot's own, not intersected with the profile (views only); repository-path catch wider than its comment
Task 6: fix round 1/5 (3 addressed, 0 open; commits 0eaab2b..aed2f27); controller confirmed requirementOverview.ts never touches the admission gate (grep rc 1)
Task 6: complete (commits 792beca..aed2f27, review clean)
Task 6: minor (deferred): receipt replay and the store-fault path outside the catch have no criterion; as EstimateRun cast stays
Task 7: dispatched (sonnet; BASE aed2f27; agent ac29d3fc798477a01; carries PR-I2)
Task 7: implementer DONE (4fa411d); 4/4, typecheck 0, M7.1-M7.4 red, restore 0
Task 7: complete (commits aed2f27..4fa411d, review clean)
Task 7: minor (deferred, MUST-FIX in the final fix wave): accepted-ADR rendering has no criterion (Rule 9; the spec requires accepted ADRs in the document)
Task 7: minor (deferred): openQuestions, (not answered), null consensus, zero rounds, null-slug fallback unexercised; newlines in free-text answers break list indentation; table cells not pipe-escaped
Task 8: dispatched (opus; BASE 4fa411d; agent a75c7cad3482a1302; carries PR-B2, PR-I4, PR-I5, Task 6 rulings, DR9, DR12)
Task 8: implementer DONE_WITH_CONCERNS (c4b07f5, f13a2da); 263/263 over 18 files, typecheck 0, M8.1-M8.20 red, restore 0
Task 8: complete (commits 4fa411d..f13a2da, review clean; the five self-decided deviations judged sound)
Task 8: carry -> Task 9: a failed draft leaves the group clarifying with nothing re-queuing it; recovery-retry (DR15) must re-queue a failed or interrupted round or draft
Task 8: minor (deferred): overviewPathExists treats every git error as absent (a vanished commit burns retries on path reasons); throw in evaluate blocks at C unnamed; classify: validateSplitDraft name misleading; prompt omits custom: labels; requirementCalls.ts ~300 lines
Task 9: dispatched (opus; BASE f13a2da; agent a170725214833a036; carries PR-I1, PR-B1, PR-I5, stop-lift + failed re-queue via recovery-retry, DR10)
Task 9: implementer DONE_WITH_CONCERNS (9af2e44, c85823f); 150/150 over 13 files, typechecks 0, M9.1-M9.38 red, restore 0
Task 9: complete (commits f13a2da..c85823f, review clean; implementer deviations judged sound)
Task 9: minor (deferred, final wave): comment naming the invariant at requirementCommands.ts:151 (in-flight guard unreachable by design, kept); test line 837 writes interrupted state directly; recovery-retry re-queues while a partial stop stays (held claim keeps it unclaimed) unpinned; web payload parity waits for Task 12
Task 10: dispatched (opus; BASE c85823f; agent a535c21b25cc5002f; carries summary-with-requirement criterion, exact carry-over, accept route)
Task 10: implementer DONE_WITH_CONCERNS (c945749, 0e8c2a4); 96/96 over 7 files, typecheck 0, M10.1-M10.22 red, restore 0
- Ruling: Task 10 concern 2 — accept is refused while the clarifying ledger has usageUnknown (fail closed, as the Web path refuses on unknown usage) — carrying false would erase an unknown — costs if wrong: a person must resolve unknown usage before accepting.
- Ruling: Task 10 concern 3 — accept is refused on a stopped clarifying group with the existing group-stopped refusal; recovery-retry lifts the stop first — accepting would leave stopped:false beside a live stop-intent row — costs if wrong: one extra retry click.
Task 10: carry -> Task 12: readControlGroup throws run-invalid for an accepted requirement (single-call runs) — M12.3
Task 10: fix round 1/5 (3 addressed, 0 open; commits 0e8c2a4..b1264ca; M10.27 green by design)
Task 10: complete (commits c85823f..b1264ca, review clean)
Task 10: minor (deferred): unchecked draft.plan cast; budgetVersion key; test fabricates reserved=0 on a plan group
Task 11: dispatched (opus; BASE b1264ca; agent a106a852de54b2037; carries PR-B2, PR-I6, no filters/hooks + timeouts)
Task 11: implementer DONE_WITH_CONCERNS (5cb803f, 6d057cf, 508b4f1); 60/60, typecheck 0, 17/18 mutations red (M11.9 green: commit-tree ignores commit.gpgSign; flag removed)
- Ruling: Task 11 concern 1 — build the export tree with git mktree from HEAD's trees (no temporary index), feed the document to hash-object --stdin --no-filters and the message to commit-tree on stdin (no scratch files), git children under the target's own umask — umask 077 wrote the person's .git objects 0400 and a fan-out dir 0700, which Rule 17 forbids (never decide modes of the person's data); PR-I6 governs only Orca's own files and this removes them — spec §9.2 (temporary index), §13 rows and §15 item 5 get a correction — costs if wrong: more code to rebuild nested trees.
- Ruling: Task 11 F8 — keep --no-filters on hash-object --stdin with a comment quoting git's doc (stdin implies no filters unless --path is given); the mutation cannot be red by design — defence if --path is ever added — costs if wrong: one redundant flag.
Task 11: fix round 1/5 (3 addressed, 1 new Important open — ls-tree names decoded as UTF-8 before mktree; commits 508b4f1..9ce4dcd)
- Ruling: Task 11 non-directory .orca / .orca/requirements in HEAD — recorded as a durable blocked export with a named reason (shown in the panel, wake delivered), and recovery-retry re-arms it like a conflict — today it is retried every driver round with no visible reason and recovery-retry does nothing — costs if wrong: none (the person fixes HEAD and retries).
- Ruling: Task 11 — a path-blocked export reuses the conflict state, told apart by reasonCode (requirement-export-path-blocked) — recovery-retry and the wire enum stay unchanged — costs if wrong: a later distinct state touches the enum and web types.
Task 11: fix round 2/5 (2 addressed, 0 open; commits 9ce4dcd..a73d87b)
Task 11: complete (commits b1264ca..a73d87b, review clean); spec section 15 item 11 written by the controller (1ba9a90)
Task 11: minor (deferred): tipOf narrowing, diff-filter=A one-parent check, inherited GIT_* environment for git children; non-UTF-8 fixture commit has no core.hooksPath override (machine hook blocks it)
Task 12: dispatched (opus; BASE 1ba9a90; agent a678b25447f8b3efb; carries PR-B1, PR-I7, M12.3 group view, payload parity, export reasonCode, F17)
Task 12: implementer DONE_WITH_CONCERNS (bc2036a); 30/30 + web 27/27, typechecks 0, clone regression 93/93; mutations red (M12.4 re-aimed); named rewrites webParity (PR-I7) and i18nPseudo 147->148
- Ruling: Task C1 (ccloop fixture only) runs while Task 12 is under review — disjoint repository, no shared file — costs if wrong: none.
Task C1: dispatched (sonnet; ccloop BASE 99054f2)
Task 12: complete (commits 1ba9a90..bc2036a, review clean); controller spot-read mut-t12-3 (red at the named criterion, run-profile-missing) and mut-t12-4 (re-aimed, red) / 4b (green by design)
Task 12: plan correction (to append at finish): M12.3 is red at run-profile-missing (proposal not confirmed), not run-task-identity; M12.4 targets ordering against the /api/control catch-all, not /:groupId
Task 12: minor (deferred): purpose not cross-checked against workItemId prefix (controlViews.ts:261); requirement re-read per run (:260); blocked reason without path (:327); parity blind to extra optional fields
Task 13: dispatched (opus; BASE bc2036a; parallel with C1 in ccloop — disjoint)
Task C1: implementer DONE_WITH_CONCERNS (ccloop 8f3b998, local); F5 red then green, 17/17, MC1.1-MC1.3 red; full suite check-known-reds RC 1 with two unexpected reds (agentsControl "reads the table only for capabilities and accept...", evidence "finalize-review CLI stores diagnosis null...") — controller reran both files 3x in the same clone: 43/43 each, load1 12.8-14.5 => load flakes; roster not edited (human-owned), names to be registered in the ccloop handoff
Task C1: fix round 1/5 (1 addressed, 0 open; ccloop commits 8f3b998..57548c3)
Task C1: complete (ccloop commits 99054f2..57548c3, review clean; local, push is the human's)
Task C1: minor (deferred): used-index read-then-append not atomic; Array.isArray guard has no own mutation
Task 13: implementer DONE_WITH_CONCERNS (0157e10, 666723d, 60aa755); named files 110/110, clone web 343/343, root parity/scan/refusalCoverage 9/9, typechecks 0, 27 mutations red; named rewrite i18nPseudo FAMILIES 30->33, ENUM_VALUES 148->164
Task 13: note: refusalCoverage was already red at bc2036a (requirement-export-pending, requirement-not-split lacked zh entries; Tasks 9/11 never ran that file) — fixed here; the final gate is the net
Task 13: complete (commits bc2036a..60aa755, review clean; extras kept); controller confirmed the summary keeps the requirement block after accept (controlViews.ts:320; requirementAccept.test.ts:81)
Task 13: minor (deferred): requirementRefusal goes stale across resolveUncertain / switching requirement; consensus button shown when latest round is not answered (plan-mandated, server refuses); poll test on real 2 s timers
Task 13: for the human: export label "conflict"/"冲突" shown as "blocked"/"受阻" (catalogue wording review)
Task 14: dispatched (opus; BASE 60aa755)
Task 14: implementer DONE_WITH_CONCERNS (05a8f38); requirementE2E 1/1 against a ccloop clone at 57548c3, 27 s, load1 ~7; typecheck 0; M14.1-M14.4 red; ~/.orca unchanged
Task 14: note: the runner left /private/tmp/t14h-* and t14t-* dirs (its own scratch, not a repository); not deleted
Task 14: complete (commits 60aa755..05a8f38, review clean)
Task 14: carry -> Task 15: the gate must set ORCA_CCLOOP_BIN to a ccloop clone with C1 and show requirementE2E 1 passed / 0 skipped
Task 14: minor (deferred): round 1 answer result not asserted; draft-2 wait catches every error; :86 guard never seen red (mutation: planId in requirementCommands.ts:216)
- Ruling: the whole-branch final review and its fix wave run BEFORE Task 15 gate — the gate must cover the final code, including the fix wave — costs if wrong: none.
Final review: dispatched (opus) over 8f3dc49..HEAD
Final review: merge only with fixes — 2 Critical (restart after a retried round blocks every group; path traversal in the structure export), 5 Important (call claimed while usage unknown; blocked requirement run invisible/unretryable while clarifying; stop with no call in flight wedges the round + commands accepted while stopped; accepted-ADR criterion; clarifying limit lowered while usage unknown), 7 Minor; triage in final-review.md
- Ruling: one fix wave carries all 7 Critical/Important plus the triage must-fix-before-paid-run items (document newlines and pipes; git children inherited GIT_* env; one-parent check) and the requirementCommands invariant comment — the final review is binding on these — costs if wrong: none.
Fix wave: DONE_WITH_CONCERNS (05a8f38..2f2e1ed, 9 commits); server+estimate 270 passed / 3 skipped (estimateE2E without ccloop), with ORCA_CCLOOP_BIN: requirementE2E 1/0 skipped, estimateE2E 3/3; web 72/72; typechecks 0; 29/30 mutations red (M2c green by design: the component check always fires first)
Fix wave: registered: unknown usage on a requirement cannot be cleared (same as a plan group in v1); recovery-retry re-queues and it waits again with requirement-usage-unknown
Fix wave: note: E2E left /private/tmp/fwh-Va7c and fwt-08ms (runner scratch)
Fix wave: re-review — all 7 findings and 4 triage items ADDRESSED; probes rerun in a new clone of 2f2e1ed (rr-probe.txt rc 0); no new Critical/Important
Fix wave: minor (deferred): claim rows stored under the old per-work-item key are not recognised after upgrade (no released N1 store exists)
Task 15: dispatched (sonnet; gate at 2f2e1ed, ccloop local HEAD 57548c3 with C1)
Task 15: complete (gate2 at Orca 461fca3 / ccloop 57548c3; controller re-read rc.txt and or.json): Orca 2539 / 2533 passed / 3 failed / 3 pending (ccloopDefaultE2E; 3/3 under verify:ccloop-pin); reds driverRecovery, controlShutdown (known) and driverRequirementSplit "fails the third consecutive invalid draft..." (NEW load flake: 5 s timeout at load1 88, reruns 8/8 x3) — each single-file green at load 6-15; requirementE2E 1 passed / 0 skipped; real-ast-grep and ".." overview criteria ran and passed; estimateE2E E1-E3 passed; ccloop 1047 / 1046, stopProof only, known-reds 0; web 347/347; verify:panel and verify:ccloop-pin 0; tmp-leak 0 both; ~/.orca stat+sha identical; no leftover processes
- Ruling: the paid real-claude run (spec 12.5) is not run — every paid run needs the human's own nod and this round's instruction was not to ask mid-run; listed for the human — costs if wrong: the human asks for it next session.
- Ruling: this SDD workspace is kept and progress.md committed with git add -f, not deleted as the skill says — CLAUDE.md Rule 13 makes .superpowers/sdd the evidence chain — costs if wrong: none.
FINISH: all tasks 0-15 and C1 complete; final review fix wave landed and re-reviewed; gate green except named load flakes.
