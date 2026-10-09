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

## Performance execution baseline — controller, 2026-10-09

ActualD9/M3beforecommit=1fd19a3d49778d0809f96af49a7ef51647a6c0fe (`docs: close usage settlement and handoff retry round`). Independentno-hardlinks clone at /private/tmp/od9/performance-before hasexactthatHEAD; dependencyonlylink toverifiedinstallednode_modules. Commands rtk proxy /usr/bin/git clone --local --no-hardlinks andrev-parseHEAD, cloneRC0. This is the beforeproduct tree, not draftc29676d. Do notcopyafterproduct intoit; later benchmark-onlyfixture/counters/harness additions mustbe named/dirtydiff recorded. Beforetimingnotrunyet.

Task1 preflight actualsharedinterfaces checked: latestcontrolViews includes marker validation, settlementpreview and retryGrantSource; activity includes usage-settled entries. Sharedsnapshot mustnot mask/skip these strictchecks; theirproof/claim reads remainseparate measuredcost. Allownlateststrict/source/legacyDTO regression tests remain unchanged. Task1 begins fromsavedbeforebaseline; nootherproductwriter.

## Task 1 latest-interface adaptation — controller, 2026-10-09, before1fd19a3

Ruling: Add an optional core-defined requestlocal readcontext to validateRetryGrantSource in src/control/retryGrant.ts, with defaultDB path unchanged. Panel supplies same-store/group raw rowid runs and snapshotdecode callback so source/current/intermediate parsing reuses requestrows. No core→panel import, no guard skipping/crossrequestcache; preserve claim/proof/lineage/agent/pending/frozen checks and refusalorder. Cost ifwrong: widened sharedhelper could drift scope/order/strict validation; explicitretryingreal-entrycount/invalidsource+marker tests, D9M3regression/mutation/taskreview controlit. Ownedextra file isretryGrant.ts.

## Task1 settled-preview read adaptation — controller, 2026-10-09

Ruling: settlementAdmission in src/control/settleUnknownUsage.ts may takeoptional requestlocal rawwork reader context forpanel-onlysame-store/group snapshot reuse. DefaultD9writer path stays directDB+transactionrevalidation; rawobjectnotZod-stripped/modified, originalreadWork/marker/refusal/archiveorder andproofguards preserved. Independentcore type canbe shared withretry context, no reversepanelimport. Cost ifwrong: another sharedreadinterface could missnewdata/strictfailure; addrealreleasedmarker count+corruptmarker/source rejection, D9regression andspecificcontext/guardmutations. Existingwork/run rows arecoveredonce; receipt/artifact/proof queries remainseparate costs. Ownedextra path settleUnknownUsage.ts. Fixtureexpectations followbeforeactualentry rather thanafterimplementation; oldtestchanges neednames.

## Task1 instrumentation boundary — controller, 2026-10-09

Ruling: Multiplefixture rows withidenticalrawJSON shareoneobservationalbytesbucket; a realJSON.parse call incrementsit once, not once peralias. That bucket cannotclaim perrowattribution. Perrow<=1cases requirevaliduniquecontract/bodybytes orisolatedgrouprequests, withcollision/alias multiplicity explicit. Do notinjectillegalextraJSONfields/removebusinesshashes tofakeuniqueness. Counter mustinstall beforefirstactualview/preparedstmt creation; cachedstmt executions stillcount onsecondrequest. Invisiblepreexistingstmt afterlatehook ismeasurementgap, not0query. Cost ifwrong: countgates couldbe falselygreen; aliasvalidation/initorder/cacheexecution assertions andfinalbenchmarkreview bear thisrule.

Worker currentfirstnormal16new+96regression=10files112cases/typecheckRC0; finalcloneguardmatrix being tightened/rerun againstsamecode. Preliminary10tasksummary total33SQL/target2, groupview244total/target3; canonical/proposal/proofremaining queries stayseparatereported, notwholepage2/3claim. Benchmarkactualbefore/afterpendingTask3.

## Task1 converted-requirement late self-review — controller, 2026-10-09

Ruling: IncontrolViews only, addprivate optional snapshot use to requirementSummary/blockedRequirementRun calledfromnonclarifying readGroupSummaryFromSnapshot. Existingpublictwoarg requirementSummaryOf/defaultDB/clarifying behavior remains; selectactive=1 originalrowid order andlazydecodeatoldreadposition. Preservebadactivebodythrow/refusalclass/detail/order, notsilentlyno-blocker/notearlyunusedparse. Cost ifwrong: convertedrequirement branchcoulddrift strict/lenientmeaning; realconversion→confirmedtaskgroup+activework entrycount/refusal andclarifyingregression, deletewiringRED andfreshreview required. e4db472sourcecommit exists, correction goesnewcommit/appendreport, nothistoryrewrite.

Currentreported17newgreen/24guarddeletions red andrestorezero; finalcorrection/revalidationnotyetdone. Sourcebudget/canonicalremaining stillseparatecosts, notexpandedthisruling.

## Task1 gate complete — controller, 2026-10-09

Task1: complete (commits1fd19a3..deaae38, freshspeccompliant/qualityApproved,0Critical/0Important). Latestproduct9092f6b, reportlateappend supersedesinitialprematureconverted-completion. Final18newtests/types,112and127overlappingregressions,27latestindependentguardRED/restore0bytes matched5source+2testbytes. Actualqueries/parses/aliaslimits/canonical2856of3044detailremaining are disclosed, noactualtimingbenefit yet.

Ruling: Task3counter/benchmark ownership includes test-onlymovingfirstinstrumentedentry/read/expect incontrolPollPerformance.test.ts:73 intoexistingtry/finally afterhookinstall, preservingallassertions; thisclosesreviewMinorrestorationrisk, noTask1productfixloop. Cost ifwrong: failedinitialassert couldleaveglobalhooks; type/focusedtest+finalreview requirefinallycoverage. WarningnoiseMinor remains documented. Cross-versionbefore/afterDTO/refusal equality stillTask3, notsameimplementationrepeat equivalenceproof.

Task2 startsfromnextsavedcheckpoint, consumingcontrolReadCounters originalstore/beforefirstview/rawbytesaliasprotocol. Nootherwriter; Task3realbefore1fd19a3 preservedcloneunchangedproduct.

## Task 2 gate complete — controller, 2026-10-09, reviewed 5f0f5ee

Task 2: complete (commits 63d9e9b..5f0f5ee, fresh Spec compliant / Quality Approved, 0 Critical / 0 Important). task-2-review.md independently checked strict invalid data/refusal order, segment invalidation after true/false/throw, same-store statement identity and final transaction archive guard. 116 named tests/typecheck RC0, 12 isolated deletion mutants RED with zero-byte restored diffs. SQLite/bundle diagnostics Minor retained. Round-wide equivalence/timing remains Task3, not inferred from this task gate.

Controller builds at product5f0f5ee: perf-final-build and perf-final-web-build RC0, raw logs in /private/tmp/od9/logs; web warning589.71kB bundle disclosed. Scheduler/panel commands same product tree have RC0; complete raw read/manifest pending before final evidence claim. Task3 sole writer begins at next saved gate checkpoint, before clone1fd19a3 remains immutable product baseline.

## Task3 operational scope clarification — controller, 2026-10-09, base4fd2b26

Ruling: Replenish benchmark must have a nonempty genuinely armed result, and mixed pump must enter real handlers/probe/accept where eligible. Preserve exact100live/100archived scope and visible current runs by completing at leastone live t00 via real fixture lifecycle/proof, leaving t01 legally claimable; alternatively restore a separate valid operational initial snapshot of the same scope. No fabricated done/raw invalid row or bypassed validator. Cost if wrong: fixture complexity/runtime; measurementcoverage/output/count equivalence and fresh review detect invalid or empty operational work.

## Task3 instrumentation lifetime — controller, 2026-10-09, base4fd2b26

Ruling: Counter restore bookkeeping may use WeakRef for ephemeral prepared statements, storing unbound original methods rather than bound closures retaining statements; restore all still-live cached statements, retain original ControlStore identity and every execution/alias observation. Same counter tool bytes before/after, unchanged named counter/cache/restoration tests plus fresh review are required. Existing all-live detail has roughly300k other canonical reads, so instrumentation must not artificially retain every statement. Cost if wrong: missed live restoration or measurement counts; explicit restored/cached execution tests and instrumentation-free timing expose the boundary. This is test helper ownership only, no product cache/authority change.

Fixture restore must include sqlite_sequence, not just activity rows: harness RED observed next real seq23 instead of22. Valid archived one-task imports add100 archived workrows; report live5000/archived100/total5100 separately, liveE computed9700. These preserve rather than relax brief scope.

## Task3 shared counter scope correction — controller, 2026-10-09, product5f0f5ee

Ruling: Task1 bounds()/observed() and parse-only empty/alias totals in tests/panel/controlPollPerformance.test.ts must explicitly select work_items/runs raw-body buckets, matching spec§3. Task2 added groups buckets for its own measurements; treating them as M5 <=1 targets causes14 newTask1 failures without a product regression. Preserve every original SQL bound, target<=1, alias multiplicity, business DTO/refusal/freshness assertion and unused work/run membership check; report groups separately, add dated scope correction. No historical business assertion/timeout relaxation. Cost if wrong: overbroad bucket exclusion could hide duplicate target parsing; named tests, targeted decode/cache/alias/count mutations and fresh task review must verify target coverage.

Controller fullroot is currently in flight at fixedproduct5f0f5ee while Task3 changes test-only helper/assertion scope; final report must identify test-overlay limitations and preserve actual originalRC. Current namedTask3RC1 has14M5 scope failures/24M6pass; corrected namedgate required. No product guard is relaxed to make it green.

## Task3 automatic-review rejection and safer counter API — controller, 2026-10-09, product5f0f5ee

Automatic approval review rejected the proposed Task1assertion scope edit before execution, describing existingassertion relaxation and lacking trusted specificauthorization. That action is abandoned; no rejected edit executed.

Ruling: Preserve originalM5parse assertions byte-for-byte (only earlier finally placement repair remains); restore ReadCounters.parses original work_items/runs category and expose separate groupParses for Task2newgroup measurements. M6newtests consume groupParses with exactexistinggroupcounts/order/businesschecks preserved. Benchmark reports both categories/alias ambiguity, never sums overlapping rawbytes as distinct actualcalls. This supersedes the preceding scope-edit ruling without rewriting history. Cost if wrong: category API/collision accounting may drift; unchangedM5tests, exactM6groupbounds, instrumentation integrity/mutations and fresh review must prove coverage. No product authority or timeout changes; rejection is not retried or bypassed.

## Integrated root failure and corrected-tree gate scheduling — controller, 2026-10-09, product5f0f5ee

Original perf-final-root RC1: physical370files (368pass/2fail),3504cases3485pass/15fail/4skip. Fourteen M5scope failures precede accepted separated-counter fix; remaining service/systemd namedstate/logs/uninstall case5stimeout is unexpected, notregistered/exempted. Exactonecase isolateddiagnostic RC0,1890ms,1pass/12selectionskips,uptime2.63/4.01/4.70. service/source/fakeTools bytes unchangedvsbefore; thissinglepass isnot stableflakeproof. Fresh auditor fullyread327968bytes/rootSHA andallgates, reportcontroller-gates-report.md.

Ruling: After Task3 measurement finishes, run one corrected latest-tree fullroot gate with formalflag1/REAL_BINs/maxWorkers2; actual fourteen assertion failures and correctedsharedtesthelper justify this failure-fix broadverification. Do not run heavy gates concurrently with before/after timing or relabel originalRC1. Preserve any remaining timeout and investigate withoutblanketflake exemption. Cost ifwrong: additional suite runtime; finalwhole-tree result and initialfailure remain explicit and reviewable.

Valid cached-restore mutation initiallysurvived because Task3newintegritycriterion installedinstrumentationafterfirstgroupview and cachedstatementswereinvisible. Fix only newcriterion hookorder, see realRED and unchangedlatestGREEN before timing. Firstsyntaxfailureisnonqualifying; prematurelystarted no-timed-sample attempt must remain aborted evidence, not count as finalmeasurement. Benchmark reopenedfixture usesdirectSQLcoverage beforefirstview; verify targetexecution visibility rather than assert0queriesfromlatehooks.
