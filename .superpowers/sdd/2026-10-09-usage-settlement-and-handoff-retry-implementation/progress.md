# SDD ledger — plan: docs/superpowers/plans/2026-10-09-usage-settlement-and-handoff-retry-implementation.md

Owner: controller, 2026-10-09 Asia/Shanghai. Product base c29676d; design branch inherited a08c763. Execution workspace is Codex-managed `/Users/biran/.codex/worktrees/usage-settlement-handoff-retry/Orca`, branch `codex/d9-m3-implementation`. Source spec §9 including9.5 has priority; previous design history is in the sibling new-round ledger, old issue-fixes remains closed.

Ruling: Human explicitly delegated design/plan/runtime decisions and requested full subagent-driven completion with final review. No intermediate human approval wait; no push/merge/deletion authorized here. Cost if wrong: reversible feature-branch rework.

Ruling: Use the managed worktree and reuse already pinned installed node_modules by a dependency symlink; no duplicate npm install. All product writes stay in this workspace; ccloop gate clone is detached ab824d1 at /private/tmp/orca-d9-ccloop-ab824d1/dist/cli.js. Cost if wrong: dependency artifacts could be shared; suite paths and mutation builds stay separate clones, never commit dependencies.

## Preflight self-review table — controller, 2026-10-09

| Pair/task | Producer→consumer / internal check | Result |
|---|---|---|
| 1↔2 | settled-failed request/marker/schema10→released retry admission; shared observed predicate→handoff | Names/states agree; Task2 waits for Task1 review |
| 1↔3 | unknownUsageSettlement preview/result and verb→owner UI | Task3 consumes server authority, cannot replace proof |
| 1↔4 | settlement tests/schema rewrites/logs/clone mutations→gates | Full gates after integration, precise schema9 changes listed |
| 2↔3 | inactive/released retry eligibility and failure outcome→runFacts/button | No-stop boundary and empty-selection resume retained |
| 2↔4 | live source/policy tests/mutations→final review | Captured actual accept envelope; no-provider restart assertions |
| 3↔4 | web/localization/action tests→web and panel gates | web build before panel; actual role/refusal checks |
| Task1 | active/released accounting and observed/manual proof tests vs handler | Correct distinct reserve formula, schema/test filenames agree |
| Task2 | three admissions and no-provider lifecycle vs reader/writer | frozen hash and latest lineage preserved |
| Task3 | authority preview, owner command and stop boundary vs UI tests | no standalone local bookkeeping |
| Task4 | gates/final fix/review/docs vs constraints | no publishing, no deletion, no real provider validation claim |

- Task 1: pending.
- Task 2: pending.
- Task 3: pending.
- Task 4: pending.

Spec review4 found one Important (D9→handoff observed predicate); appended9.5 corrects it. Fresh spec/plan preflight is in flight. No product implementation yet. User requires persistent three-repository handoff and an in-chat executive summary under10lines at completion.

## Ready to execute — controller, 2026-10-09, base a08c763

Independent preflight review: Spec PASS, Plan PASS, Ready to execute Yes, no Critical or unresolved Important. Initial missing route/entry/archive全集 finding fixed in unpublished plan; report retains finding and correction. Adopted both Minor suggestions: Task2 full D9→handoff→resume→retry→claim criterion and actual old-reader-v9 rejects10 vs new-reader-v10 rejects11 evidence.

Baseline at a08c763 in managed worktree: `npm run build --workspace web`, `npm run typecheck`, `env ORCA_CCLOOP_BIN=/private/tmp/orca-d9-ccloop-ab824d1/dist/cli.js node_modules/.bin/vitest run tests/control/schema9.test.ts tests/panel/permissions.test.ts` all RC0; focused2files/6tests passed. Full raw logs `/private/tmp/orca-d9-baseline-{web-build,typecheck,tests}.log`. Not a rerun of old issue-fixes gates.

## Scope sequencing — controller, 2026-10-09, implementation base 2c14e73

Ruling: The human approved M5/M6 and requested completing the tasks this session. Prepare its independent spec/plan while D9/M3 executes, but never run parallel product writers; start performance implementation only after D9/M3 task gates/close. Cost if wrong: additional review time; separation keeps reversible scopes auditable. Performance draft uses fixed c29676d code, and must consume completed D9/M3 interfaces at execution time.

Task1 initial RED observed: `/private/tmp/orca-task1-red4.log` full output read, RC1; schema10 fresh-store assertion sees9, four real driver/handoff settlement criteria fail because WebControlService.settleUnknownUsage is absent. These are expected product failures, not a passing implementation claim. Worker is implementing shared marker/proof/accounting paths; no subsequent product task dispatched.

Whole-round gate environment prepared at `/private/tmp/od9/env.json`, runner `/private/tmp/od9/run.py`; fake codex installation uses pinned clone fixture in integration mode. HOME/fourXDG/TMPDIR/CCMEM_DATA_ROOT/corrections all temporary, inherited real CCMEM_CONFIG_PATH absent. No suite run against this environment yet.

## Task 1 implementation checkpoint — controller, 2026-10-09

Worker implement_settlement DONE, product43b0f16 + report405f6b6. Task-specific fresh reviewer is in flight; task not yet marked complete. Report task-1-report.md and diff package review-2c14e73..405f6b6.diff cover full2commit range, BASE2c14e73.

Observed final isolated logs task1-target-final/typecheck-final: RC0, 9files122tests, no skipped; webbuild/actual oldv9 reader rejects10 proof in report. Worker records21 independent valid guard deletions red and clone restored42tests/zero unstaged+staged bytes; first wrong-target zero-token mutation excluded then exact branch independently red. Whole round integrated gate remains Task4.

Ruling: Over-limit settlement test uses a real provider overage followed by unknown, rather than lowering group limit after unknown (existing set-limit correctly refuses then). No product set-limit guard relaxation. Cost if wrong: fixture would miss a real overage path; actual post-command used/reserved/deficit assertions and mutation remain required.

## Task 1 gate complete — controller, 2026-10-09

Task1: complete (commits2c14e73..405f6b6, fresh task review clean). Review task-1-review.md: Spec compliant, quality Approved,0Critical/0Important. Reviewer cross-checked all21mutations against final delivered code and business assertion logs; restored clone differs only fixture trailing whitespace. Minor validation noise: Node22 SQLite experimental warnings and existing Vite bundle size hint, not hidden/skipped tests.

Task2 next: consume hasValidUsageSettlement(store,run), RunViewV1.unknownUsageSettlement and marker reservationDisposition/handoffResolution; completed released D9 leaves work blocked/terminal and current source inactive settled-failed, no automatic retry. Controller performance docs committed independently; performance still not implemented.

## Task 2 in progress — controller, 2026-10-09, base d3b9d6a

Initial fixture missed await on asyncsettle, producing invalid D9→resume diagnostics; worker corrected this without Task1 product change. Only corrected business RED counts as TDD evidence. First9new real-flow/identity criteria green; task remains in progress.

Ruling: New inactive held/released M3 admissions check all group historical unknown/pending usage inside retry transaction before releasing/reserving. Reuse budget groupUsageUnknown semantics via narrow helper if needed, not a stale UI predicate. Existing ordinary active admission and claim/start guards retain old semantics. Cost if wrong: M3 cannot pre-arm ready while another historical unknown remains; this implements the explicitly named new-admission refusal criterion and preserves actual claim safety. Task3 must present that eligibility honestly.

## Gate runner scope clarification — controller, 2026-10-09

Ruling: Task4 full npm test runs once on its integrated tree; the separate check-tmp-leak guard may take the three new backend/panel runtime test paths as its documented extra vitest args, so it verifies their temporary roots without repeating the entire unchanged suite. The raw inner vitest exit must be checked (outer0 alone does not prove test success). Cost if wrong: leak evidence narrower than fullsuite; fullsuite still runs all cases, and new D9/M3 runtime cleanup receives explicit zero-entry guard. Later performance changes justify their own new-code gate.

Ruling: Sibling handoff documentation commits will use one-off /private/tmp/od9/{ccloop,ccmem}-handoff-hooks preserving any plain validation hooks, omitting their existing Qoder external tracker hooks. Repository hook config/files unchanged; no push/third-party tracker invocation is authorized by this task. Current inspection found only post-checkout/post-commit tracker hooks. Cost if wrong: this local doc commit lacks tracker telemetry; Git audit history and exact path verification remain.

## Task 2 implementation checkpoint — controller, 2026-10-09

Worker implement_handoff_retry DONE, ce4de4b + a78d5eb product and2c7a531report; fresh task review in flight on d3b9d6a..2c7a531, package review-d3b9d6a..2c7a531.diff. Shared retryGrant source validation/clearing, three admissions, actual A2 policy clamp and both D9 orders implemented. Not yet a passed task gate.

Commit-level directed15files202tests/typecheck RC0 at a78d5eb; actual raw files task2-final-directed-limited.log/task2-final-type-a78.log full-read. Worker reports16final independent deletion mutations red, restore18/18green and source byte hashes/main+clone diff/staged zeros. Initial default-worker run had one unchanged retryTask5s timeout while clone tests concurrent; no assertion/timeout changed, final complete15files with maxWorkers2 all202passed. Failure remains in task-2-report.md.

Task3 consume qualification table in task-2-report.md, including common exact lineage/claim identity and newheld/released group-unknown guard. Full UI and integrated suite remain pending.

## Task 2 gate complete — controller, 2026-10-09

Task2: complete (commitsd3b9d6a..2c7a531, fresh task review clean). task-2-review.md: Spec compliant, quality Approved,0Critical/0Important,16mutations verified with final202/202/typecheck and exact15file restore hashes. First active continuing→retrying is interpreted as initial source binding, whereas §5 subsequent-active state preservation applies after M3retrying exists; ordinary confirmed protected. Reviewer Minor: direct initial active-continuation path lacks its own criterion; logs contain located fixture/SQLite noise, not undisclosed failed/skipped cases.

Ruling: Fold the direct active-continuation coverage Minor into Task4's already planned final test/verification deliverable, adding `directly retries an active failed continuation from head` to the new handoffFailedRetry test file without weakening existing cases; exercise actual retry/claim/accept/source/consumed removal/reservation and a matching clone deletion if a distinct branch is measured. This is not an extra Task2 fix-loop or parallel writer. Cost if wrong: a coverage addition could miss its target; require business assertions against the actual port/reader and fresh final review.

Task3 next: server RunView.unknownUsageSettlement preview/result plus qualification table in task-2-report.md; owner-only confirmation, member contact, persistent failure outcome, empty-selection stop resume, inactive/released Retry UI and groupunknown guard.

## Task 3 decomposition — controller, 2026-10-09, base c2e81f2

Ruling: Add web/src/UsageSettlement.tsx as a focused server-preview/refusal + local-confirmation component instead of expanding the existing GroupView. GroupView retains actual command submission/recovery callback; AccountContext→App→ControlPanel→GroupView passes real roles, absent roles grant no new owner action. Cost if wrong: an extra component boundary; no new authority or permission fallback. Reuse any already-existing empty-selection resume entry after proving it works for failed held/manualsettled states rather than duplicating the button.

Task3 sole writer, TDD/typed UI/locales and clone mutations in progress. Performance product remains unstarted; final Task4 covers integrated gates and direct activecontinuation criterion.

## Task 3 named existing-criterion rulings — controller, 2026-10-09

Ruling: web/tests/i18nPseudo.test.tsx — describe `every enum value has its words in both languages (spec §3.5)` / test `reads every family`: ENUM_VALUES length178→181 names the three new protocol values (usage-settled activity, settled-failed request, retrying allocation), keeps everyfamily/bothlanguage assertions and historical comment plus dated correction. Cost if wrong: hardcount could miss an actual enum; exhaustivefamily equality/locale coverage and review remain.

Ruling: web/tests/archiveGroup.test.tsx — describe `archiving from the group view (spec §6.3)` / test `offers no retry on an archived group, because the server refuses every command but Unarchive (group-archived)`: add currentRunId=failed.runId and lineageRunIds=[failed.runId] to the testedwork fixture; preserve old unarchived2Retry/archived0 assertions byte-for-byte. Cost if wrong: another fixture identity inconsistency could mask the intended archive test; freshreview must inspect it. No old commandRecovery assertion/timeout relaxation authorized.

Worker reports fullweb90files729tests RC0, targeted6files66green/typecheck/webbuildgreen; twelve UI deletion mutants businessRED, restored3files21green, main/clone15path hashes equal and main unstaged diff byte-identical before/after mutation. Exact productcommit/report pending.

## Task 3 implementation checkpoint — controller, 2026-10-09

Worker implement_settlement_ui DONE, productaa03c91/reportf9849b2; task3freshreview in flight on c2e81f2..f9849b2, complete2commitpackage review-c2e81f2..f9849b2.diff. Finalfullweb90files729tests RC0 on identical product bytes; committed8files84/typecheck/webbuild RC0. TwelveUIguard/confirmation/identity/amount/recovery/role/Continue/activity mutants businessRED; restored21tests green and named15paths main/clone hashes equal. No whole root suite claim yet.

First fullweb run had enum/fixture/oldisTerminalFailure semantics/unchanged retained-result timing failures; exactly the two named migrations above were authorized, oldisTerminalFailure preserved via newhasFailureOutcome and originalrecoveryassertion/timeout unchanged. Completefinalweb and committedtarget both passed; original failure log retained without inventing a newflake.

## Task 3 gate complete — controller, 2026-10-09

Task3: complete (commitsc2e81f2..f9849b2, freshtaskreview clean). Spec compliant/qualityApproved,0Critical/0Important. Reviewer verified actualrolechain, consentreset, two-bucket amounts, strictpayload/recovery, held/released currenteligibility, preservedfailurehistory, manualContinueexclusion and truecompleteemptyresume;12mutants/729fullweb/84committed evidence. MinorVite>500kB warning retained. No serverproof completion inferred fromUI tests.

Task4 starts with the named directactive-continuation coverage, then isolated integratedgates and freshwholeD9/M3review. Siblinghandoff updates and finalexecutivesummary remain controller-owned AFTER performance implementation and allfinalreviews, perhumanrequest. This does not pauseD9/M3gate/close.

## Task 4 named schema migration correction — controller, 2026-10-09

Control wrapper on e7df5df found four genuine assertion failures (not timeout): finalschema10 vs historical9 expectations. Ruling: migrate only finalversion9→10/titlecurrent9→10 in exact tests: shutdownHealing.test.ts `a stranded v8 store migrates, heals, renders a run with startedAt null, and then accepts start`; requirementRecords.test.ts `migrates a version-5 store by adding the two tables, leaving every existing row byte-identical`; commandClient.test.ts `a fresh store has commands.client and is at the current version (9)` and `a version-6 store upgrades, and a row written before keeps client null`. Preserve every other business assertion, oldpublishedcomments and appenddatedD9correction. Cost if wrong: migrationproof could be weakened; exactdiff/finalreview must verify oldrows, nullclient/times, healing/start retained. New schema10 requires allolderversions target10; not reopening any oldissuefix task.

Ruling: The originally failing verify:control wrapper needs samefinaltreeRC0 after those corrections; this is justified failure-fix verification, not needless broadrepeat. Otheralreadygreen gates need no repeat withoutnewcode. Fullroot npmtest runs once on finalcorrectedtree. Originalfailurelog remains and cannot be relabelledRC0. Cost if wrong: additional suite runtime; finalgate result is reviewable and unequivocal.

LedgerCLI RC2 diagnostics seven missingtaskId/runId tier0downgrades are recorded as legacydata, package.verify allows2; baselineblob comparison requested, no repair of .decisions. Directcontinuingcoverage commit e7df5df,19/19green plus exactarm cloneRED/restored19green/main+clone diff+cached0, no productfix.

## Optional real-CLI verification boundary — controller, 2026-10-09

Ruling: Use actual local syncskill built /Users/biran/code/skills/syncskill/dist/index.js and ccmem /Users/biran/code/skills/ccmem/bin/ccmem only through threeexisting isolatedfixture tests (driverSkillsReal, skills/syncskillReal, memory/ccmemReal). Their operations use own HOME/SYNCSKILL_DIR/CCMEM_DATA_ROOT, localprofile/inject/import/export, no model/daemon invocation; runner drops realCCMEM_CONFIG_PATH/APIkeys. Cost if wrong: an unexpected localCLI sideeffect would violate isolation, so stop/report rather than expand scope; never claim actualuserHOME process attribution from the outerisolatedHOME guard.

Finalformalcontrol oncc50570 was alreadyinflight withoutREAL_BIN vars; don't repeat it solely to removeconditionalskip. Its真实RC/skips remain, subsequent named/fullroot tests with percommandREAL_BIN vars prove actualoptionalCLI behavior; defaultccloop3cases executed byspecificpin gate. No liveenvfile or installedCLI product change.

## Formal-control timeout adjudication — controller, 2026-10-09

Finaloriginalwrapper oncc50570 RC1:1704pass/1timeout/4conditional skip. Schema migrations allgreen; unchangedrequirementOverview `reaches structure status failed and still gives an overview` hit5005ms/5000ms, noassertionfailure. Name notknown-load list, notregistered/exempted. Unmodifiedwholefile maxWorkers1 passed22/22 in10.00s at19:26load8.90/8.78/7.33, not low-loadproof. Systematic-debugging skill applied: rawerror/source+change review, unchangedfixture singlefile diagnosis; no timeout/code edit based on guesses.

Ruling: Completefinalroot with ORCA_CONTROL_VERIFY=1, bothREAL_BIN vars andmaxWorkers2, retaining everyformalcontrol criterion while limiting schedulingparallelism. Originalwrapper onlyaddsformalflag/selectscontrol/fixes4workers; fullroot contains those samecontrolfiles. Useactualresult for equivalentformalcoverage, not claim original4workerwrapperRC0. Iffullroot still fails investigateprecisely; no blanketflakeexemption. Cost if wrong: high-concurrency wrapper's stability remains unproven; originalfailure and differential evidence remain explicit for finalhumanreview. Pin's3defaultcases and actualoptionalCLI executions reportedseparately.

## Formal-flag ruling refinement — controller, 2026-10-09

Fullroot had started19:28 before the priorformalflagmessage arrived, withmaxWorkers2/bothREAL_BIN but noORCA_CONTROL_VERIFY. Read-onlyexactrg acrosssrc/tests/scripts found onlyccloopProtocol.integration:25–26 consumer: flagonlythrows ifbinary/tablemissing; actualconfigured variable/criterioneligibility depend onbinary&&table directly. Bothinheritedvars valid. Fixedcloneflagconsumersearch requested too.

Ruling: Preserveinflightfullroot; useactualthreeccloopProtocolcriteriaexecution to prove identicalformalbusinesscoverage, without falsely statingflagset orwrapperRC0. Noabort/restart/secondfullrun solelyforsemanticallyinactiveflag. This refinespreviousruling on verifiedconsumersemantics. Cost if wrong: missingformal-only assertions could be hidden; exactconsumersearch andactualcasecounts are required beforecompleteclaim. Original4workerwrappertimeout remains and isnotdeclaredknownflake.

## Task 4 delivered; whole branch review in flight — controller, 2026-10-09

Verifier DONE_WITH_CONCERNS, coveragee7df5df/migrationcc50570/reports ea7ce0d+3a433c2. Fullreport task-4-verification-report.md and compactproofjson persist actualcounts/environment/restore. Task4scopequality and wholeD9/M3quality assigned together to freshmostcapable final_usage_retry_review on c29676d..3a433c2 (separateTask4diff ace2209..3a433c2). Nofinalreviewpassclaim yet.

FullrootRC0 atcc50570:368files3462tests,3458pass/0fail/4skip (defaultccloop3 verified bypin3/3, unapprovedreallaunchd1 notrun). All153controlfiles1709cases included,1706pass/3defaultskip; actualprotocol3 andrealSyncskilldriver/CLI/ccmem3 passed. Scheduler202passed/pin3/15panelsteps allRC0; scopedleak outer0,inner0,58cases/0entries. Web729samecode reused. Formal4workerwrapperRC1 unregisteredoverview5s timeout persists; lowconcurrencyfullroot exactcase730.233ms, notlabelledknownflake. Ledger2 isallowed historical7downgrades with baseline11172bytehashmatch. Noactualuserservice/data/model invocation.

Durableevidence at evidence/2026-10-09-gates-and-mutations.tar.gz +manifest.json:310selectedlog/RC/proof/scriptfiles,457030archivebytes,SHA256 d7dcbcf5293207afc15f55e5c6b6f7d633391b41927eac0bfbdba0b98d773b1e. Measurementcommand rtk proxy python3 (tarfile/hashlib with everymember SHA verification), observed HEAD3a433c2. This archive preserves diagnostics aswellasfinalsuccess; noDB/Gitobjects/userdata included. Fullmember checks allvalid; executionreports retain originalobservedcommits.

Ruling: Keep this plan's trackedSDDhistory/evidence afterfinalreview rather than skillworkspace-deletion guidance, because repositoryRule13 forbids changing historicalSDD and userrequires reliablehandoff. Cost ifwrong: extra repositoryevidence size; no irreversibleloss of audit trail. Performance implementation still waits for D9/M3finalreview/close and realbeforecommit.

## Round close — controller, 2026-10-09

D9/M3 implementation plan Tasks1–4 complete. Fresh wholefinalreview on c29676d..3a433c2: SpecPASS/QualityApproved/ReadyYes; Task4separateSpecPASS/QualityApproved;0Critical/0Important. final-review.md retainsMinor fourworkerwrapperRC1; nofixwave needed. Product observationlatestcc50570; later commits reports/archives/controllerhistoryonly. User-authorized finalhumanreview remains afterperformance/handoff; nopush/merge/deletion/realruntimeupgrade.

Outcome: ownerWeb explicitconservative two-bucket/fourdimension unknowncharge; strictproof/receipt/unattributedcurrentperiodledger/replay; activeandpost-handoffunknownexit; M3held/released/current grant/source/consumed identity/frozen snapshot/no-provider/restartable, actualclaimpolicyclamp and persistentfailure UI/emptyresume. Schema10 one-way, actualv9rejects10 andnewv10rejects11; oldwork/runoptionalcompatibility. Actualcontrolstore/service notchanged.

Evidence: newbackend/panel/UIcells plus50independentguarddeletionreds (21+16+12+1directactivearm), exactclone-restorationproofs,202directed+729web reused/newdirectcriterion19; integrated368files3462tests3458pass/4skip, scheduler202/pin3/panel15/leak58inner0zeroentries. ThreeactualCLIisolatedcriteria andallthreeprotocol executed. Exactcommand/commit/results/rawreadcoverage inTaskreports/verificationproof;310rawevidencefiles durablearchive. Defaultccloop3skipcoveredbypin;reallaunchd1notauthorized. LegacyledgerRC2allowedandbaselineidentical; fourworkerunregisteredoverviewtimeoutnotexempted/notmadeknownflake, max2samerootallcontrols passed. Noall-warning-free/no-production-readiness claim.

Oldissue-fixes123paths/oldRoundclosebytes unchanged. Newmanagedworktreebranchcodex/d9-m3-implementation retainsnode_modulesuntrackeddependencylink;onlyexactnamedpaths staged. D9/M3 scopeclosed, not re-dispatched. Nextapprovedperformanceplan starts fromthisfullcodebaselineafterrecordedclosecommit, separatelytracked. Threehandoffs/executivesummary finalcontroller deliverable afterallperformancework.
