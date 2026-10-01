# SDD ledger — plan: docs/superpowers/plans/2026-10-01-retire-legacy-orca-run.md

Controller: Orca session be653b22, 2026-10-01. Spec: docs/superpowers/specs/2026-10-01-retire-legacy-orca-run-design.md (controller rulings C-1..C-4).

## Preflight scan
| Pair / task | Shared | Finding |
|---|---|---|
| T1 (ccloop) / T2 (Orca) | fake-codex frames mode | T1 produces the mode per spec 3.4; T2 consumes it through the ccloop checkout ORCA_CCLOOP_BIN points at. Consistent. |
| T2 self | runCli routing vs deleted orca run | the harness keeps call sites; deleted-surface criteria listed by name. Consistent. |

- Ruling: step 3 Task 1 (ccloop fixture) runs in parallel with step 2 Task 1 (ccloop cli) — disjoint files; agents add paths explicitly and retry on index.lock — costs if wrong: a retried commit.
Task 1: implementer DONE (ccloop 88f175e); red evidence by mutation only (fixture + test written together)
Task 1: review — spec ✅ quality ✅; minor (deferred): the new criteria's schemas lack properties.result so the {result:…} envelope path is untested in fakeCodexFrames.test.ts (it is exercised once Task 2 drives frames through CodexAdapter)
Task 1: complete (ccloop commit 88f175e, review clean)
Task 2: implementer DONE (e3de964); 57 criteria / 29 files migrated, 0 deleted; implementer rulings C-5 (keep mode legacy for the test execution: controlled throws without an approved grant) and C-6 (ccloopRunner no-terminal-status stub exits 2 not 1, because exit 1 now means ccloop refused the --agents run; assertion unchanged)
Task 2: review — spec ✅ quality ✅ (C-5 and C-6 premises verified); minors (deferred to the final fix wave): M-1 run.ts:241 comment names runRound, no ERRATUM; M-2 service.ts:43,54 Omit of keys that no longer exist; M-3 'legacy' test-only by comment only; M-4 loopPlanCli.test.ts ['run'] case + doc comment still name orca run
Task 2: complete (commit e3de964, review clean)
- Ruling: Task 3 (mutations L1–L3) is folded — Task 2's implementer ran L1, L2, L3 plus M4/M5 in clones and saw each red — costs if wrong: none (evidence in task-2-report.md).
Task 3: complete (folded)
