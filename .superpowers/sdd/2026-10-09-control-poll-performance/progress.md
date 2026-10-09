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
