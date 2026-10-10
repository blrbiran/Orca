# SDD ledger — plan: docs/superpowers/plans/2026-10-11-feedback-followup.md

Owner: Codex controller, 2026-10-11 Asia/Shanghai. Human authorizes spec/self-review/extra independent review, plan, Results5 first, subagent-driven feature implementation and all local main integration; controller rules reversibly and final human audit. No remote push/repin/publication/production switch.

## State
Four specs committed by topic `docs(spec): define approved feedback followup and runtime boundaries`. Self-review in spec-self-review.md, two independent reviews running. Results5 preflight read-only running; old worktree untouched. Writable isolated no-hardlink clones have node_modules symlinks only, never stage those. Empty native managed worktree exists because sandbox refused its writes; retain until own cleanup authorized, old WIP never delete. Baseline full Web check running under isolated runner at /private/tmp/orca-followup-runs/baseline-web.

## Rulings
- Ruling: Human explicit session instruction overrides intermediate spec/plan stop prompts and local-main merge gate; preserve staged review workflow without waiting for another approval. Cost if wrong: reversible local source/docs rework, no deployment side effect.
- Ruling: Saved-result recovery is a new linked attempt with genuine verification; no mutation of old failed attempt, no extra model formatter. Cost: complete capture/new protocol, unavailable old records may require ordinary retry.
- Ruling: Unlimited token defaults require nullable policy distinct from finite usage and funded allowances. Old pinned package remains unchanged; paired feature binary proves runtime, old peer explicitly refuses unsupported unlimited/recovery/refresh. Cost: default installed old peer cannot run new capabilities until separate repin.

## Queue
Spec review closure -> plan/self-review/preflight -> Results5 transfer/completion/review -> feature tasks each implementation/review -> final cross-repo review/verification/browser -> authorized local main integration -> sister rolling handoff updates -> chat-only <=10-line executive handoff.

## Spec independent review wave
Both reviews found five overlapping must-fix fences. Appended named corrections (original spec text preserved) in topic `docs(spec): resolve independent review fences before planning`; scoped re-reviews running. Sources: spec-review.md, extra-spec-review.md.

## Baseline Web
Command `python3 /private/tmp/orca-followup-run.py <clone> baseline-web npm run --ws check` on spec-only35199d5: TypeScript passed; full100files837passed2failed, both exactly historical agentPreviewRefresh backoff tests at15s. Complete raw log in /private/tmp/orca-followup-runs/baseline-web/output.log; no product changes. Focused13/13 passed per diagnostic worker evidence, not a whole-Web pass. Mechanism under investigation is fake clock long-window execution of unrelated App polling. Add a deterministic harness repair task rather than timeout increase or flake waiver; test names and preserved business assertions must be recorded.

## Plan pre-flight scan — controller

Skill helper created same plan-owned workspace. Plan self-review in plan-self-review.md; committed topic docs(plan): sequence Results5 and reviewed feedback implementation. Specs self + two independent reviews approved; final amendments in82f484b.

|Task|Self consistency|Disposition|
|---|---|---|
|1|Tests match producing/consuming interfaces and owned files; exclusions consistent.|Proceed; step-specific native evidence required.|
|2|Tests match producing/consuming interfaces and owned files; exclusions consistent.|Proceed; step-specific native evidence required.|
|3|Tests match producing/consuming interfaces and owned files; exclusions consistent.|Proceed; step-specific native evidence required.|
|4|Tests match producing/consuming interfaces and owned files; exclusions consistent.|Proceed; step-specific native evidence required.|
|5|Tests match producing/consuming interfaces and owned files; exclusions consistent.|Proceed; step-specific native evidence required.|
|6|Tests match producing/consuming interfaces and owned files; exclusions consistent.|Proceed; step-specific native evidence required.|
|7|Tests match producing/consuming interfaces and owned files; exclusions consistent.|Proceed; step-specific native evidence required.|
|8|Tests match producing/consuming interfaces and owned files; exclusions consistent.|Proceed; step-specific native evidence required.|
|9|Tests match producing/consuming interfaces and owned files; exclusions consistent.|Proceed; step-specific native evidence required.|
|10|Tests match producing/consuming interfaces and owned files; exclusions consistent.|Proceed; step-specific native evidence required.|
|11|Tests match producing/consuming interfaces and owned files; exclusions consistent.|Proceed; step-specific native evidence required.|
|12|Tests match producing/consuming interfaces and owned files; exclusions consistent.|Proceed; step-specific native evidence required.|
|13|Tests match producing/consuming interfaces and owned files; exclusions consistent.|Proceed; step-specific native evidence required.|
|14|Tests match producing/consuming interfaces and owned files; exclusions consistent.|Proceed; step-specific native evidence required.|

|Task pair|Shared file/interface|Compatibility ruling|
|---|---|---|
|1/4|App, locales|Sequential writes; source spec and earlier task exported interface authoritative; retain old immutable/finite DTO shape. No duplicate authority.|
|1/7|App, Results, locales|Sequential writes; source spec and earlier task exported interface authoritative; retain old immutable/finite DTO shape. No duplicate authority.|
|1/8|App, locales|Sequential writes; source spec and earlier task exported interface authoritative; retain old immutable/finite DTO shape. No duplicate authority.|
|1/10|App, locales|Sequential writes; source spec and earlier task exported interface authoritative; retain old immutable/finite DTO shape. No duplicate authority.|
|1/11|App, locales|Sequential writes; source spec and earlier task exported interface authoritative; retain old immutable/finite DTO shape. No duplicate authority.|
|1/12|App, docs, locales|Sequential writes; source spec and earlier task exported interface authoritative; retain old immutable/finite DTO shape. No duplicate authority.|
|1/13|Results, docs, locales|Sequential writes; source spec and earlier task exported interface authoritative; retain old immutable/finite DTO shape. No duplicate authority.|
|1/14|docs|Sequential writes; source spec and earlier task exported interface authoritative; retain old immutable/finite DTO shape. No duplicate authority.|
|3/4|BudgetAmount|Sequential writes; source spec and earlier task exported interface authoritative; retain old immutable/finite DTO shape. No duplicate authority.|
|3/5|ccloopProtocol, ccloopRunLoop|Sequential writes; source spec and earlier task exported interface authoritative; retain old immutable/finite DTO shape. No duplicate authority.|
|3/6|ccloopProtocol, ccloopRunLoop|Sequential writes; source spec and earlier task exported interface authoritative; retain old immutable/finite DTO shape. No duplicate authority.|
|3/9|ccloopProtocol|Sequential writes; source spec and earlier task exported interface authoritative; retain old immutable/finite DTO shape. No duplicate authority.|
|4/7|App, OrcaDriver, OrcaProtocol, locales, schema11|Sequential writes; source spec and earlier task exported interface authoritative; retain old immutable/finite DTO shape. No duplicate authority.|
|4/8|App, OrcaProtocol, locales|Sequential writes; source spec and earlier task exported interface authoritative; retain old immutable/finite DTO shape. No duplicate authority.|
|4/10|App, OrcaProtocol, locales, schema11|Sequential writes; source spec and earlier task exported interface authoritative; retain old immutable/finite DTO shape. No duplicate authority.|
|4/11|App, locales|Sequential writes; source spec and earlier task exported interface authoritative; retain old immutable/finite DTO shape. No duplicate authority.|
|4/12|App, locales|Sequential writes; source spec and earlier task exported interface authoritative; retain old immutable/finite DTO shape. No duplicate authority.|
|4/13|OrcaProtocol, locales|Sequential writes; source spec and earlier task exported interface authoritative; retain old immutable/finite DTO shape. No duplicate authority.|
|5/6|capsule, ccloopProtocol, ccloopRunLoop|Sequential writes; source spec and earlier task exported interface authoritative; retain old immutable/finite DTO shape. No duplicate authority.|
|5/9|ccloopProtocol|Sequential writes; source spec and earlier task exported interface authoritative; retain old immutable/finite DTO shape. No duplicate authority.|
|6/7|recoveryInput|Sequential writes; source spec and earlier task exported interface authoritative; retain old immutable/finite DTO shape. No duplicate authority.|
|6/9|ccloopProtocol|Sequential writes; source spec and earlier task exported interface authoritative; retain old immutable/finite DTO shape. No duplicate authority.|
|7/8|App, OrcaProtocol, locales|Sequential writes; source spec and earlier task exported interface authoritative; retain old immutable/finite DTO shape. No duplicate authority.|
|7/10|App, OrcaProtocol, locales, schema11|Sequential writes; source spec and earlier task exported interface authoritative; retain old immutable/finite DTO shape. No duplicate authority.|
|7/11|App, locales|Sequential writes; source spec and earlier task exported interface authoritative; retain old immutable/finite DTO shape. No duplicate authority.|
|7/12|App, locales|Sequential writes; source spec and earlier task exported interface authoritative; retain old immutable/finite DTO shape. No duplicate authority.|
|7/13|OrcaProtocol, Results, locales|Sequential writes; source spec and earlier task exported interface authoritative; retain old immutable/finite DTO shape. No duplicate authority.|
|8/10|App, OrcaProtocol, locales, selection|Sequential writes; source spec and earlier task exported interface authoritative; retain old immutable/finite DTO shape. No duplicate authority.|
|8/11|App, locales|Sequential writes; source spec and earlier task exported interface authoritative; retain old immutable/finite DTO shape. No duplicate authority.|
|8/12|App, locales, selection|Sequential writes; source spec and earlier task exported interface authoritative; retain old immutable/finite DTO shape. No duplicate authority.|
|8/13|OrcaProtocol, locales|Sequential writes; source spec and earlier task exported interface authoritative; retain old immutable/finite DTO shape. No duplicate authority.|
|9/10|agentsUpdates|Sequential writes; source spec and earlier task exported interface authoritative; retain old immutable/finite DTO shape. No duplicate authority.|
|10/11|App, locales|Sequential writes; source spec and earlier task exported interface authoritative; retain old immutable/finite DTO shape. No duplicate authority.|
|10/12|App, locales, selection|Sequential writes; source spec and earlier task exported interface authoritative; retain old immutable/finite DTO shape. No duplicate authority.|
|10/13|OrcaProtocol, locales|Sequential writes; source spec and earlier task exported interface authoritative; retain old immutable/finite DTO shape. No duplicate authority.|
|11/12|App, locales|Sequential writes; source spec and earlier task exported interface authoritative; retain old immutable/finite DTO shape. No duplicate authority.|
|11/13|locales|Sequential writes; source spec and earlier task exported interface authoritative; retain old immutable/finite DTO shape. No duplicate authority.|
|12/13|docs, locales|Sequential writes; source spec and earlier task exported interface authoritative; retain old immutable/finite DTO shape. No duplicate authority.|
|12/14|docs|Sequential writes; source spec and earlier task exported interface authoritative; retain old immutable/finite DTO shape. No duplicate authority.|
|13/14|docs|Sequential writes; source spec and earlier task exported interface authoritative; retain old immutable/finite DTO shape. No duplicate authority.|

Task1 BASE c31d86b plan-only; prior WIP transfer belongs to this task. No product implementation before this stage. Baseline fullWeb remains two timeout failures assignedTask2, not waived.

## Execution started
Task1 BASE9965162; implementer /root/results5_impl; only Results5 allowed. Additional read-only plan review /root/plan_review. Full baselineWeb exact2 timeouts assignedTask2; no acceptancewaiver. Sourcebaseline ccloopbuildRC0, OrcatypeRC0, WebbuildRC0 (largechunkwarning recorded). OriginalResults5read-only inventory intact.

## Independent plan review closure
plan-review.md findings accepted; append-only amendment records separate capsule RPC/v3 projection, production importprimary coverage, actualdead-lockowner replay, combinedschema11 and capsetterowners. Source doc amendments are controller-owned, notTask1; commit after Task1 productcommit to keep review attribution clear. Alllaterworkers read implementation-rulings.md plus ownbrief.

BrowserQA capability: cua_repl selected CodexIAB browser id2 (qaBrowser binding); viewport capability documented set({width,height})/reset. No tab/navigation/viewport mutation yet. Native supported CUA will be used because standalone playwright-interactive asks for danger-full-access unavailable in this sandbox; no config/sandbox change. QAinventory alreadywritten.

Task1 fullWeb firstobserved886pass2fail(labelSourceFallback en/zh sourceparagraph ordering), no originalbackofftimeouts in that run. Worker fixing sourceorder, not assertions, plus pseudo actualstatus translations; finalaffected/fullWeb mustrerun. Preserve original failurelogs. This is not gateclosure or baselineflake waiver.

Task1 worker latestpreclosure fullWeb104files893testsRC0/0skipped, 12namedclone deletionmutants RC1 intendedcriterion, restoredworking/cacheddiff0; one finalApppredecessorhistorycriterion pending. Do notmarkTask1completeuntilreportcommit+independentreview. Parent-owned plan/spec amendments stilluncommittedseparatefromTask1.

Task1 sourcecommit71d19b5. Reviewpackage review-9965162..71d19b5.diff generated exactly1taskcommit. Controller append-only protocol/plan/unknown-usage rulings separatelycommitted10b02df, notTask1diff. Task1report pending; no nextimplementation untilindependenttaskreview.

Task1 reviewrequested BASE9965162 HEAD554d77e includesproduct71d19b5+closingtest554d77e; controller-only10b02dfplan/spec amendment explicitlyexcludedfromTask1scope. reporttask-1-report.md and source/mutantmanifests available. ParentreadcompleteclosingWeb/type logs:104files894passed0skippedRC0; stillawait independentverdict.

Task1 review❌/Needsfixes oneImportant(task-1-review.md): actualsamecapture2→null→1 helperwitnessRC1 proves priornullerasesknownattemptauthority. Rootreadfullreview+actualcode+rawfailure and acceptedfix. Ruling: retain perowner/run highwater independently, null remainsunknown/historynoncurrent; rejectlateolder andresetonlyownerboundary. Fixround1 resumed/root/results5_impl atBASE554d77e, no nexttaskdispatch untilscopedreviewcloses.

Task1 fixround1 commit115830d; only4ownedfiles. ParentreadcompletefreshWeb902passed0skipRC0/typeRC0/buildRC0 (existingchunkwarning). Fiveclone deletionwitnesses andrestored117criteria perreport. Scopedpackage review-554d77e..115830d.diff sentoriginalreviewer; verdictpending. Trueownerkeyscope/account+epoch+group/task; perrun/generation highwater survivechangeSeq/capture/hide, nullDTOunknown, allresponseadmittedbeforeauthorityupdate.

Task 1: complete
Product71d19b5/test554d77e/fix115830d; task-1-review initiallyoneImportant, task-1-r1-review ✅spec/qualityApproved closesR1. ParentcheckedVCS/reportcompleteclosing902Web/type/build/117focus/5fixmutants, original14mutants. Originalworktreeunchanged. Finalroot/browserstillTask14, notclaimedcomplete.

Task2 BASE115830d; nextfreshimplementer ownonlypreviewtimerharness, no productoptimization/timeoutwaiver.

Task2 code d2a8ec0/report1ef45ea; freshreport/fullnative902defaultWebRC0+roottypeRC0 read. Reviewrequest BASE115830d HEAD1ef45ea independent/root/timer_review. No nextimplementationuntilverdict. SourcegroundedrulingwithinGrant/frozenhash vsruntimeJSON appendedtoimplementation-rulings/spec/plan; controllerdocsowneduncommitted, unrelatedTask2scope.

Task 2: complete
Code d2a8ec0/report1ef45ea; task-2-review ✅spec/qualityApproved with nofindings. DefaultfullWeb902/typeRC0 and3correctdeletionmutants read/verified. Oldbaseline2timeouts remainhistoricalred, newharnessfullgate passedwithout15schange.

Task3 ccloopBASE8ebd163 (sourceunchangedsinceclone), Orca authoritydocs latestcontroller semantic/runtime distinction committedseparately. Next freshimplementer ccloopBudgetAmount/protocol4/runtime.

## Task3 live recovery state
Active implementer /root/token_producer_impl, ccloopcloneBASE8ebd163; source21files frozen c4388ae4... manifest /private/tmp/orca-followup-runs/task3-final-file-manifest.json (includesvalidationrendereroutsidegenericrunnerhash). Focused72/72, type/diffcheckgreen,11deletionmutants killed/restored0/0 perworker; full/native running, notcomplete. Source originalrepos unchanged. Metadata/interface/testrewrite/OSescalation decisions persisted implementation-rulings.md (Task3 section). No nextimplementationuntilindependentreview.

Recoveryaftercompaction: Task1 andTask2 complete(reviewapproved); do notredispatch. Task3 worker owns cloopsource, pendingnativegates/report/commit→freshreview→Task4. Specs/plan inOrcaclone, producerreport alwaysOrcaledger task-3-report.md. Controller docTask3rulings amendments currentlyuncommitted, do notincludeinworkercommit. RemainingTasks4–14 notstarted. FinalauthorizedlocalFF mergesbothsource mains, no remote/pin/production switch; threehandoffsrollingsections andchat<=10lineexecutive afteralltasks.

Task3 sourcecommit91c0a75, 21sourcefiles exactmanifestverifiedbycontroller. Reporttask-3-report.md/evidenceJSON; finalfull139files1412pass0skipRC0/native63files658pass0skipRC0/typebuildRC0; parentcheckedactualper-testJSON/counts/RC/source file hashes. NewRuntimeBudgetKind helperhashc4388ae4... genericrunnerexcludesvalidation/v1/lib/scenarios.ts butexact21filemanifestcoversit. Ready freshreview BASE8ebd163 HEAD91c0a75; source cloopmain untouched. Initial201namedfailures resolvedinfinalJSON, classificationretained; noactualpaidProvider.

Task3 independent review Needs fixes (task-3-review.md): Important I1 same-work-item authority missing; I2 complete inherited tokens/activeMs source consumption missing. Controller read full review, raw three failing refusal assertions and materialize authority code; accepted findings. Fix round1 resumed original /root/token_producer_impl at91c0a75. Task3 remains incomplete; no Task4 dispatch until scoped re-review. Complete local source work Amount must bind through validated handoff, current inherited >= prior inherited+local across all four dimensions including overshoot; replay remains zero extra usage.

Task3 fixround1 commit5b0adea, sixownedfiles; full1424/0fail/0skip/native670/0fail/0skip/typebuildRC0; controllercheckedallsource/loghashes and fullpertestJSON. Sixmutants killed/restored0/0. Scopedreviewpackage review-task3-r1.diff sent original /root/token_producer_review; verdictpending. Task4 brief prepared but implementationnotstarted.

Task 3: fix round 1/5 (2 addressed, 0 open — workItem identity, complete Amount lineage; commits91c0a75..5b0adea)
Task 3: complete (commits8ebd163..5b0adea, scoped spec/quality review clean). Source producer protocol4 optionaltokens/phasecontinuation interfaces authoritative; exactusage ref required. Finalcrossrepo gates stillTask14.

Task4 nextfreshimplementer Orca policy/jointfunding/schema11/pair runtime. Source BASE82f795b plus reviewclosure docs; oldfinite/v3 and pinneddefault remain.

Task4 dispatched /root/token_consumer_impl (gpt-6-astra high per SDD architectural task), BASEc2a1f42. Soleimplementation Orca clone, no ccloop edits. Brieftask-4-brief/globalconstraints/implementationrulings+tokenpolicy amendments supplied. Reporttask-4-report.md; no nexttaskuntilreview. Parent retaining originalcheckout/WIP and no externalruntimechanges.

Task4 checkpoint report append-only; focused newpolicy/backend/browser/requirements passed. First freeze c059188e... type/build/WebbuildRC0/fullWeb104files905pass0skip. Fullroot discovered real legacyderivedpolicy identity bug after legalfinite-limitraise; worker testing in clone, original source remains frozen until rootfinishes. Accept correction: legacyfinite body authority, optional-v1 identity remainsstrict; retain exactrootfailures/no waiver, fresh finalsourcegates afterfix. Task4 incomplete/reviewnotdispatched.

Task4 initialfullroot liveness checkpoint observed10:29/log327237bytes/3712lines, 3ownedVitestworkers pending; workerdiagnoses syntheticSQLite/process states readonly. Independentclone legacyfix57handoff/reconcilecriteriaRC0. Controllerauthorized boundedowned-run termination onlyif noforwardprogress by~15min exploratorygate, preserve rawRC/pendingnames, no mutatedgateDB/timeoutraise/waiver. Actualfinitegrant proofpredicate andinternalwork/handoffroles approved; transactionrecheck afterawait mustcatch capinstallrace, oldfinite/singlecall predicates preserved, mechanicalhandoff no modeltokenrequest. Generalstrictdriverunsupported remains. Newsource fullgates pending.

Task4 initialroot abortedownedSIGINT RC130 after915.894s; raw329531bytes,92reportedfailedassertions/382reportedfiles; no finalJSON. Exactnames classification-input.json; incomplete handoffE2E/agentSelectionE2E only (executionDriverE2Ereportednearabort), noleftoverownedchildren. Additional confirmedmechanisms inheritedfiniteusage incorrectlyforce4, oldfinite startGroup fixturelost3Mbase whennewimportnull. Source fixes+explicitfiniteE2E fixtures nowauthorized, preserve genuine4allowancerenewal. FinalfullrootJSON mustresolveclassification; no testcasewaiver.

Task4 latest capabilityscope25green inclgrant/race/unchangedstrictguard; finiteassisted-handoff role + crossperiodstartunknown added. NativeSocketdiagnosis113bytepathlistenEINVAL/no socket vs60bytepathlistenOK; shortprivateTMPDIR diagnostic89/89 includesbothsocketcases and exactnativeerrno, oldpeer/historicalreceipts21/21. Newowner clear-limit transition bugs found/fixing, finalfreeze/fullgates stillpending.

Task4 aftercheckpoint: paired finite-authored5M/cap1.9M→remove revealed actual plannerreplay(plan,plan,execute) RED; needsTokenPolicy nowkeeps4 when allowancePredecessorRunId present, paired3/3GREEN. Fresh transactionclaimAt capsrollover/owner-null tests51/51GREEN. ActualrequirementE2E timeoutdiagnosed readonlyDB: firsttasklanded3/settled, seconddependencyready, groupstatusreview (normaldispatchable). Newallocator omittedreview; fixingnamedreview-group readiness RED/GREEN withoutstop/unknown/recoveryguardrelaxation. This isnewconsumerdefect, notproducer. Finalfullgates stillpending.

Task4 secondfreeze401ad977 type/buildRC0/fullrootrunning; one newmixedowner test wronglysettledfake run beforebeginProviderAttempt; strictreaderproperrefusal, fixturecorrectionpending afterrootsettles. Additional actualjointmixedlegacy full-minimum/groupcredit defectselfreview fixingclone; finalsourcechanges/gates/mutantsstillpending. Initial401mutants treatedexploratory ifsourcechanges; finalsame-source manifestrequired.

Task4 root401 completednormally RC1/599.174s:385files3666pass8fail7skip; exact7existing5stimeouts plusone newfake-settled-providerOrdinal0, nounfinished. Raw333505bytes SHA95b28339a49f2afa87c6a6631ba3bae139b84a8a8dfcb111e406d60120386e6a, fullJSONretained. Clone5filefixedlegacy/ownerfixture appliedaftergate. Finalfreeze6aa31b916020bf7b446b37ee33982b669861cf230f62005f3a1e3fb351854f82 focused107/107 incl unchanged7prior5scases0.7–1.5s; nowaiver. Sequentialfinalqueue type/build/Webbuild/Webcheck→rootmax4JSON→nativecontrol→paired3+requirement→panel→pin→same-source mutants. Per-gate shortprivateTMPDIR/hash/nonzerosource checks. No sourcechangesplanned; taskreviewpending.

Task4 freeze6aa rootcomplete RC0/686.230s:385files3679pass0fail7explicitoptinskip, fullpertestJSONcheckedbycontroller. Exact7names task-4-root-opt-in-audit.json:3defaultpackage,1ccmemReal,2syncskillreal,1relocatedrealLaunchd. Formalcontrol/paired/panel/pin andfinalmutantsrunningsequential; tasknotyetreviewed. Previous92reportedinitialfailuresmappedtofinalpass byworker. FinalTask14 mustauditfreshsource; no realLaunchd/service operation currentlyauthorized, separateother6safeisolatedcriteria planned.

Task4 sourcecommitd72f05e (111source/testfiles), final9gate+22intendedmutant proofs read/checks; reviewer/root/token_consumer_review full8427linepackage/111files found2Important, spec❌qualityNeedsfixes task-4-review.md. I1 actualhandoffStop beforeA1 knownzero settledrestartable preservesoptional numericreservation thennewclaim doubles3.15M→5.05M (cap1.9M); I2 finiteoptional authoredtask99k/group1.5M reserve250k owner1M serveraccepted/UI falselyshort651k. Parentreadfullreport/3rawlogs; fixesaccepted. Fixround1 resumesoriginal /root/token_consumer_impl atd72; token-onlyrelease/transfer keepsnonToken/predecessor/unknown/legacy; authoritativepertask accounting modeUI/renderedsubmit. Finalsourcecovering/root/Web/type/build +scopedmutants thenoriginalreviewer scopedrereview. Task4 incomplete, Task5 notdispatched.

Task4 fixround1 freezef11d0534000f75afd50d60a8c54677148286cefd7eab04c57291b56d14443b8a/922files; source10files incl2newtests; type/build/WebbuildRC0/fullWeb104files908passRC0. Rootmax4alone/paired4queued then8scopedsame-source mutants. Targeted74/65/25alreadyGREEN, no oldassertionchanges; taskclosure/scopedreview stillpending. Parentdocs8d08b03 interleaved source unchangedat6aa; fixer excludesdocs fromcodecommit.

Task4 fix1 frozen root f11d completed RC1/681.325s:387files3686pass1fail7explicitoptins/3694total; raw284153bytes SHA328b13532895b1f4a8396d7e5284de816ec307ce220932e106f02f9ec3f2289b, fullJSON audited bycontroller. Solefailure controlShutdown realSIGTERM line126 exit143 vs0 (1869ms, no deadline); criterion spawns tsx wrapper and double immediate SIGTERM, server intentional second-observed-signal forces1. Worker diagnosing concrete wrapper/panel identity/order before ruling; no waiver/source edits during fullgate. Task4 incomplete; Task5 remains undispatched. Samef11d types/build/Webbuild/fullWeb908 RC0 rawlogs readcompletely; advisory640.47kB retained.

## Task4 fix1 gate discovery — SIGTERM fixture ruling, controller 2026-10-11
Ruling: correct the historical real-SIGTERM fixture to signal the actual panel Node process (process.execPath with --import tsx), separate first-signal clean shutdown from second-observed-signal forced interruption, and preserve one durable shutdown identity in both — the old tsx-wrapper plus two immediate signals judges nondeterministic forwarding/coalescence rather than its declared clean-shutdown behavior — if wrong, the direct-process criterion could miss a launcher-specific regression; keep the failing root and six staged trace witnesses, and retain this limitation for final audit.
Exact old criterion `tests/panel/controlShutdown.test.ts > a real SIGTERM to a real panel > makes it exit cleanly, having written one shutdown row for its epoch` must continue to demand exit0 and exactly one persisted row, now sending one actual signal. Add a distinct real second-signal criterion requiring exit1, exact documented second-signal diagnostic and exactly one row. Hold a real accepted incomplete HTTP request (Expect100-continue) while first shutdown is persisted to deterministically deliver second signal during drain; no production switch, instrumented product or timer/deadline extension. Existing five control-plane idempotency criteria remain unchanged. Do not accept143 or arbitrary exit codes. This is a named fixture correction discovered by full fix gate, not an I1/I2 production expansion.
Evidence read completely: `/private/tmp/orca-followup-runs/task4-fix1-signal-order/output.log`/result.json RC0; three delayed-wrapper-second traces produce143 after listener removal, three during-drain traces produce intentional panel exit1 plus documented stderr; each has exactly one shutdown row. Instrumentation is diagnostic only and must not enter the final product criterion. Freeze the corrected test source, run focused criterion repeatedly with same identity, then sequential full root/paired/scoped mutations; add signal-handler/second-signal/shutdown-identity clone mutants. Preserve initial root RC1 and raw hash; no waiver.

Controller final-audit preflight: current ledger has5explicitRuling lines; companion implementation-rulings.md has13, including duplicatedSIGTERMfixturedecision. FinalTask14 mustcollectboth/deduplicatewithoutomitting, then addfuturedecisions. Cost addendum for historical Task1 perowner/run highwater ruling: if wrong, valid Results entries could be held as stale until owner refresh, or old attempt facts could leak into current output; remedy is reversible source/UI admission rework, not historical record rewriting. PriorTask1reviewapprovedfix remainscomplete; noredispatch.

Task4 fix1 correctedfreeze64d74abc8c14c9c2e00a4ebfabd1562d0d4a2f69725580e0ac736ebd5a6724e8 differsfromf11 ONLY signaltest. FreshcorrectedtypeRC0; rootRC0/676.173s:387files3688pass0fail7namedoptins/3695total, raw282366bytes SHAd57ae12c431fd2660245ac7c55daa07d5f7625546d282125202c6880b863753b. Controller scannedall3302rawlines/fullpertestJSON/noFAILsections; onlynormalizedSQLitewarning. All7shutdowncriteria pass incloriginalclean0/newforced1. Pairedsource4/4RC0/39.993s complete rawlogread. NativeWeb908/build evidence f11 reusableonlybyteidenticalproduction/Web relationship, exactmanifest pendingreviewer.11scopedmutants underway incleanverifiedclone830a9dc source64d/922files; no taskclosure untilcommit/report/scopedreview.

## Task4 signal observer contention — controller 2026-10-11
Ruling: retry only the native SQLite observer BUSY/LOCKED error (ERR_SQLITE_ERROR with numeric errcode5/6) inside the existing5s first-shutdown-row deadline, preserve all other failures, and keep deterministic real SQLite exclusive-lock contention in the signal fixture — the actual clone baseline failed its readonly SELECT while the product shutdown transaction held DELETE-journal locking, not the exit/identity assertion — if wrong, fixture-side retry could hide a persistent lock until its existing deadline; preserve precise failure and contention RED/GREEN plus a retry-deletion mutant to expose that risk.
Read complete `task4-fix1-clone-signal-baseline/output.log`/result.json RC1:6pass/1native database-is-locked fail at149, source64d/922files. Independent actual two-connection probe returned ERR_SQLITE_ERROR/errcode5. A temporary separate owned connection may hold BEGIN EXCLUSIVE without changing data, release after100ms, and exercise the real reader during first shutdown/held HTTP drain. No production switch, timeout increase, zero guess, arbitrary error swallowing or CPU load generation; cleanup rolls back/closes owned connection even on failure. Preserve first exit0, second during-drain exit1/exactstderr, exact one row.
Evidence relation: previously completed fullroot64d RC0/3688pass/7namedopts remains attributed to64d, NOT the latest fixture. The new final source differs ONLY in controlShutdown.test.ts; unchanged production/Web/other tests have exact manifest equality. Require fresh corrected types, deterministic contention RED/GREEN, repeated final7/7 and valid signal mutants including retry deletion on final clone. Reuse the previous fullroot for byte-identical production/other criteria and prior8fix mutants by the explicit per-file relation; do not label them latest-source whole-suite runs. No third exploratory whole-root run unless focused evidence leaves real uncertainty; finalTask14 executes fresh fullbranch gates. This does not claim whole-round acceptance.

Task 4: fix round 1/5 (I1/I2 addressed, no open findings; product d72f05e..96059d0).
Task 4: complete
Original independent reviewer task-4-r1-review.md: scoped spec Compliant / quality Approved, no new Critical/Important breakage. Controller read complete review/report, verified23raw gate hashes+12validmutation hashes/blocks, exact two Git single-test-file relationships and922file final source+restoredclone equality. Full root source64d passed3688/7explicitoptins, production/Web sourcef11 passed908, finala348 types+controlledsignals7x4; named fixture reuse approved/fully independent verified, not mislabeled latest-source root. FinalTask14 freshwholebranch gates/browser/crossrepo remain required. No out-of-scope product defect parked; launcher-forwarding limitation disclosed.
Task5 next: fresh ccloop implementer, source BASE5b0adea413b885a1151259d5eb88d21eedcc2ce0; read task-5-brief/controller-context/globalconstraints/recovery spec. Task1–4 not redispatched.

Task5 dispatched /root/execution_evidence_impl (gpt-6-astra high, architectural capture/identity task), ccloop BASE5b0adea413b885a1151259d5eb88d21eedcc2ce0. Sole product owner ccloop isolated clone. Brief/controller bridge/recovery spec/global constraints supplied; no child subagents. Report task-5-report.md; fresh independent review required after report/commit, no Task6 implementation before closure. Controller Orca docs closure4becc41 retains Task4 evidence/review and Task5 handoff.

## Task5 provider evidence boundary — controller 2026-10-11
Ruling: implement new live strict normalization and authoritative format-failure capture on the Codex path named by Task5; keep current Claude execution behavior intact and report its saved-result evidence unavailable when the required original authority is absent — source inspection shows Claude runner silently drops invalid stream rows, keeps only the last result/fallback envelope, strips provider fields and bounds taskResult before adapter output, so current archives cannot prove unique intact original stream or original opaque metadata — if wrong, Claude format-failure recovery remains unavailable until a separately designed complete raw-evidence producer is added; ordinary Claude execution/selection remains supported.
Grounded reads: runtime/claude/claudeAgentAdapter.ts238–305 and scripts/claude-phase-runner.mjs535–558/634–656. Do not retrofit a new Claude raw-stream/process proof architecture as a guess inside Task5. The shared normalizer is provider-neutral over validated raw execution bytes; supported capsule decoder/provenance is explicit. Tasks6/7 qualify by complete authoritative evidence and supported decoder, never infer eligibility from an Agent kind or capability advertisement alone. Missing/unsupported provider evidence returns a precise unavailable reason and ordinary retry, no automatic fallback Agent or synthesized final/events. Preserve existing Claude plan/execute/verify acceptance and failed usage behavior. Include a negative missing-original-evidence criterion and disclose provider boundary in Task5 report/final handoff; savedResultRecovery negotiation denotes implemented engine support, not universal historical eligibility.
