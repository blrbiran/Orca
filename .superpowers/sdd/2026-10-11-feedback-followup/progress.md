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
