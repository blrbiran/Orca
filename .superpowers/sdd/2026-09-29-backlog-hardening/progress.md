# SDD ledger — plan: docs/superpowers/plans/2026-09-29-backlog-hardening.md
Task 1: wrong trailer on ccloop 4af7245 (Co-Authored-By: Claude Sonnet 5) — amend forbidden; left as is, reported to the human; rules file tightened.
Task 1: complete (ccloop d542386..4af7245, review clean)
Task 2: Ruling: commit trailers follow the harness attribution instruction (exact `Co-Authored-By: Claude Opus 5.5 (1M context) …`, no Claude-Session line after the reminder changed) over the plan's "归属行照实写执行席自己的模型" — why: the harness instruction is the governing attribution rule this session and names the exact line — cost if wrong: trailers name the controller's model rather than each sub-agent's; ccloop 4af7245 carries a Sonnet trailer (the other form).
Task 2: complete (ccloop 4af7245..ae3f0df, review clean on code; trailer ruled above)
Task 3: complete (ccloop ae3f0df..a0f3836, review clean; M3-2 red on the exit-code assertion as the brief predicted)
Task 4: wrong trailer on ccloop bb21a91 (Co-Authored-By: Claude Sonnet 5) — amend forbidden; reported to the human.
Task 4: complete (ccloop a0f3836..bb21a91, review clean)
Task 4: minor (deferred): parent_tool_use_id pairing proven only with synthetic events; real claude subagent interleaving unmeasured (needs a paid run or a fixture that emits it).
Task 5: complete (ccloop bb21a91..1a72028, review clean; trailer verified by controller)
Task 5: minor (deferred): test casts AttemptContext for buildExecutorPrompt (brief-mandated).
Task 6: complete (ccloop 1a72028..1a2fc1f, review clean)
Task 6: minor (deferred): report prose miscounted the diffstat (+7/-2, +63) vs actual (+10/-2, +58) — evidence numbers in reports must be measured.
Task 7: Ruling: SKIP #13(a) — why: existing ccloop criterion tests/agents/registry.test.ts:56-61 "accepts opaque models it cannot interpret, including aliases with a [1m] suffix and 200 characters" asserts validateSelection({model:"sonnet[1m]"}) does not throw, the exact opposite; changing it needs the human to name it (ccloop Rule 15(a)); the round's authorization for existing-criterion changes covered only #14; and the test encodes a deliberate "opaque models are accepted" decision — cost if wrong: the [1m] context-tier bypass stays open until the human decides. For the human: authorize dropping "sonnet[1m]" from that test's array, then Task 7 runs as briefed.
Task 7: skipped (no commits)
Task 10: complete (Orca ce2d25c..381dc55, review clean)
Task 10: minor (deferred → final fix wave candidate): replenish per-group catch keeps looping after SQLite auto-rolls back the transaction on SQLITE_FULL/IOERR/NOMEM, so later groups write in autocommit; fix: rethrow when !store.db.isTransaction.
Task 10: minor (deferred): panel-draining during recording returns without naming the original step error (plan-mandated); only the JSON.parse arm of the group failure is tested.
Task 8: Ruling: drop OwnerTransferLockBusyError from the re-read dedupe guard (plan-mandated) — why: the Busy event carries no String(error) and no `ccloop unlock`, so deduping after it hides the only way out; the brief's own ruling assumed the kept event carries it — cost if wrong: on transfer→Busy→unattributable a second contended event is recorded (the pre-existing shape).
Task 8: minor (deferred): dedupe is cross-class (Unattributable then LivenessUndetermined) — the more specific re-read reason is lost, way out kept.
Task 8: fix round 1/5 (1 addressed, 0 open — Busy dropped from dedupe guard, new criterion pins the way out; ccloop 789c026..799b0c6)
Task 8: complete (ccloop 1a2fc1f..799b0c6, review clean after 1 fix round; red-line function sha256 d4b11e22…ee0c, 7751 bytes, unchanged)
Task 8: minor (deferred): the new tests' status/loop-state assertions never seen red on their own (earlier assertion short-circuits; containment covered by existing criteria).
Task 11: complete (Orca 381dc55..141b7ae, review clean)
Task 11: minor (deferred): the accept-never-called assertion (dispatchAgentSnapshot.test.ts:35) never independently seen red.
Task 9: complete (ccloop 799b0c6..2190b89, review clean; trailer verified by controller). Rewritten existing criteria (human-authorized #14), all in ccloop tests/registry/zeroWrite.test.ts: the snapshotTree helper plus the four named tests (see task-9-report.md "For the ledger" for verbatim names).
Task 12: complete (Orca 141b7ae..7c6d3fa, review clean)
Task 13: complete (Orca 7c6d3fa..0f68801, review clean)
Task 14: D12 (reconcile-budget one token short in --fake conflict) re-observed with new defaults — known gap from 2026-09-25 execution-driver spec §5.3(5); registered, not fixed.
Task 14: complete (Orca e1f90ea, review clean). Tasks 1–14 done (Task 7 skipped by ruling). Task 15 (gates) merged with plan C's gates after plan C; plan-B final whole-branch review pending.
Final review (plan B): ready with one fix — Task 10 group catch must use per-group SAVEPOINTs; the ledger's own isTransaction suggestion was wrong (property does not exist on node v22.13.1, would undo Task 10) — CORRECTION of the Task 10 deferred-minor line above. Fix wave dispatched.
Deferred (left): BudgetEditor note broader than probeBlocksDispatch (unbound profiles); broken group row repeats on stderr every round; completed vs aborted phases may count subagent tokens differently (unmeasured; joins Task 4's deferred entry).
Final fix wave (plan B): commit f306a1d — per-group SAVEPOINT in replenishStartWakes; on savepoint failure rethrow the original error.
Ruling: accept the fix wave's change to src/control/store.ts transaction catch (a ROLLBACK that throws is ignored and the ORIGINAL error rethrown) — why: without it the SQLITE_FULL cause is always masked by "cannot rollback - no transaction is active", which defeats fail-loud; behaviour differs only when ROLLBACK itself throws — cost if wrong: every store.transaction caller now surfaces the first error instead of the rollback error in that edge.
Final fix wave: minor (deferred): "no wake row" assertion never seen red alone (single-group harness); partial-group undo and RELEASE-in-finally unobservable today.
Final fix wave: re-review clean (addressed). PLAN B COMPLETE: Orca 381dc55,141b7ae,7c6d3fa,0f68801,e1f90ea,f306a1d; ccloop 4af7245..2190b89. Task 7 skipped (human), m6 out of scope.
Deferred (registered): store.ts:138 swallows every ROLLBACK error (tighter: only "no transaction is active" or attach as cause); same masking pattern in commandLedger.ts:186-187 invokeWithSavepoint and store.ts:104,110 schema init/migration catches; driverRoundIsolation.test.ts:60 not seen red alone (needs a second group).
