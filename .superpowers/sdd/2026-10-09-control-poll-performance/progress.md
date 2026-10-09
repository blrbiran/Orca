# SDD ledger — plan: docs/superpowers/plans/2026-10-09-control-poll-performance.md

Owner: controller, 2026-10-09 Asia/Shanghai. Draft production readbase c29676d, draft branch codex/d9-m3-implementation. Implementation must wait for D9/M3 complete and record that exact before commit; no product work in this performance ledger yet.

Fresh isolated design+plan review: Approved / Ready to execute Yes, zero unresolved Critical/Important/Minor. Report spec-plan-review.md retains original one Important and two Minor plus verified corrections.

Preflight self-review shared pairs: Task1→Task2/3 produces same-store db/statement counters; Task2→Task3 preserves deferred/delivered order and restores action initial states; Task1/2→Task3 covers true read/dispatch entry output and bounded counts. All task internal interfaces/tests match; raw rowid run ordering and lazy strict activity entryOf remain specified. Actual latest D9/M3 interfaces will be checked before Task1 dispatch.

Ruling: M6 uses request-local entry filtering with existing strict archivedMarkOf rather than speculative SQL JSON predicates. Keep transaction archive guards and clear local map after every await. Cost if wrong: remaining linear archived row scan/one parse per group per synchronous segment may limit speedup; benchmark reports that boundary rather than claiming zero scanning.

Ruling: True all-live-changed incremental benchmark records100groups via recordActivity in one store.transaction, then asserts resetRequired=false and exactly100changedgroupIDs. Otherwise retention64 could turn this into reset and conceal the intended measurement. Cost if wrong: invalid benchmark conclusion; explicit workload assertions detect it.

Counter wrappers preserve original ControlStore identity. Before/after serially share fixed repo/config/artifact paths and identical valid initial store/evidence snapshot; business hashes are preserved in digest. DAG task0=[] task1=[task0] others=[previous two], actual E computed by code. No benchmark/provider/suite run yet.

- Task 1: pending until D9/M3 close.
- Task 2: pending.
- Task 3: pending.

## D9/M3 prerequisite complete — controller, 2026-10-09

D9/M3 finalwholebranchSpecPASS/QualityApproved/ReadyYes,0Critical/0Important; actuallatestproductcc50570, subsequentdocs/evidenceonly. Performancebeforecommit will be nextsavedclosecheckpoint, not draftc29676d. Current controlViews includes strictusageSettlement preview/historicalmarker and retryGrantSource validation; snapshot wiring must preservethese consumers, with proof/claim queries separatelycounted as agreed. PerformanceTask1 solewriter startsafterthischeckpoint; noD9M3productchange withoutnewreview/ruling.
