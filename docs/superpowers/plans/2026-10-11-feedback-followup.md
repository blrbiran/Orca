# Feedback followup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish Results5, then deliver all approved execution/budget/Agent/recovery/interaction changes with independent review and local main integration.

**Architecture:** Preserve finite actual usage and introduce genuine nullable token ceilings with jointly cap-funded allowances. Immutable execution-failure capsules feed a fenced verifier-only successor; primary Agent defaults and durable installation updates remain distinct from frozen task authority. Browser controls consume server facts and preserve unknown outcomes.

**Tech Stack:** TypeScript/Node, SQLite, Zod, React/i18next, Vitest, existing ccloop CLI/control protocol; no new product dependency.

**Spec:** `docs/superpowers/specs/2026-10-11-feedback-followup-design.md` and its three named subproject specs, including final append-only amendments. Results5 additionally uses `2026-10-10-task-results-design.md` §8–8.6 and original Task5 brief.

## Global Constraints

- Owner: Codex controller, 2026-10-11 Asia/Shanghai; execution and intermediate rulings delegated by human, final audit reserved for human. All product work in `/private/tmp/orca-feedback-followup-20261011` and `/private/tmp/ccloop-feedback-followup-20261011`, branch `codex/feedback-followup-20261011`.
- Original Results5 worktree untouched. No remote push/publication/default repin/production migration/service/provider change. Final authorized local merges are fast-forward only.
- Amount usage stays finite safe integers; BudgetAmount.tokens null means unlimited, zero means zero. Preserve finite time/attempt/session/handoff/request constraints and existing soft-enforcement disclosure.
- Existing protocol3 finite responses/hashes remain; independent `features` command negotiates optional tokenPolicy/savedResultRecovery/agentInstallationUpdate. Protocol4 nullable/recovery inputs never reach old peer.
- Source failure, frozen task authority, actual verification and delivery are independent facts. No extra summarizer/formatter/diagnosis model calls, guessed historical acceptance or current-tree reconstruction.
- Read complete raw verification logs; record command/RC/tree identity/skips. Use `rtk proxy` and raw `/usr/bin/git`; commit with one-command empty hooksPath. Never stage node_modules or someone else's artifacts.
- Test HOME/XDG/TMPDIR/CCMEM_DATA_ROOT isolated, CCMEM_CONFIG_PATH absent. Use `/private/tmp/orca-followup-run.py <repo> <unique-name> <command...>`; feature paired CLI explicitly set only when criterion needs it. No CPU load generation.
- Every task has meaningful RED/GREEN and named clone-only deletion mutations for load-bearing branches; fresh implementer + independent spec/quality reviewer, fixes scoped re-reviewed. Full workspace/package verification before task closure; controller final full root/formal gates on final tree. Record any old expectation change by exact name and approved intent, never broaden an assertion into a waiver.

## Review Focus

1. Global cap plus zero project headroom must not strand healthy other-project demand — Task4 joint allocator test.
2. Interrupted verification must never silently reenter executor or repeat unobserved external work — Tasks6/7 durable mode/entry crash tests.
3. Historical field-only estimator override must keep its original installation association — Task8 decision-table tests.
4. Table rename succeeds but Orca receipt is missing — Tasks9/10 cross-process receipt/outbox crash tests.
5. Auth/project/attempt change during saved output download must not reveal foreign/stale results — Task1 actual App lifecycle tests.

## File responsibilities and dependency map

Existing `types/schema/budget` represent authority; create focused policy/allocation modules rather than spreading null arithmetic. ccloop `protocol/accept/worker/runLoop` own execution modes; separate normalizer/capsule/recovery-package helpers. Orca `savedResultRecovery` owns eligibility/admission/package/outbox orchestration, existing driver owns normal booking/landing. ccloop `agents/updates` owns table lock/intents/receipts, Orca `agentUpdates` owns authorized command/outbox/projection. Browser menu/uncertainty modules own interaction only. Avoid unrelated refactors of already-large App/runLoop; extracted new feature units have one responsibility.

Execution order: Task1 Results5 -> Task2 harness -> Tasks3/4 token producer/consumer -> Tasks5/6/7 saved recovery -> Task8 primary Agents -> Tasks9/10 installation updates -> Tasks11/12 browser interaction -> Task13 diagnostics/docs -> Task14 final validation/review/integration/handoff. Only one product implementer at a time, even across repos.

### Task 1: Complete transferred Results5

**Files:** Transfer eight tracked web changes and ten new web files listed in `results5-preflight.md`; modify result components/hooks/App/locales/styles if needed; create `web/tests/resultsApp.test.tsx`; update README and `skills/orca-control/SKILL.md`.
**Interfaces:** Consumes accepted Task4 DTO/routes, source/currentAttempt/snapshotRevision semantics and previous brief. Produces working task/group Results region, inert saved preview, exact saved download, hidden-pane zero reads and real App ownership guard.
- [ ] Step1: Read original brief/spec and preflight; copy ONLY listed web WIP using `/private/tmp/orca-results5-wip-20261011.patch` plus explicit untracked files. Preserve source bytes and inventory; no old docs/ledger/node_modules.
- [ ] Step2: Add RED real App criteria: task Results identity/read path, completed missing default, hidden pane/poll cancellation, auth/project/epoch/attempt stale replies, newer source missing capture, exact saved download bytes and safe binary/large download. Keep actual outcome independent from report availability.
- [ ] Step3: Fix views/hook/output lifecycle using final accepted DTO; original evidence downloads retain permissions. Add documented immutable-source/old-peer meanings; no summary call/backfill/new skin.
- [ ] Step4: Run focused prior five files plus resultsApp and full Web/type/build; inspect known two timeouts by name if still present (Task2 repairs harness, not waiver). Mutants: stale attempt reuse, hidden fetch, HTML inertness, auth late download. Controller performs final real browser geometry in Task14.
- [ ] Step5: Commit `feat(web): finish saved task and group results`; write task1 report with transferred historical RED provenance, new RED/GREEN, native logs and mutation evidence. Independent task review before Task2.

### Task 2: Deterministic preview-backoff clock criteria

**Files:** `web/tests/agentPreviewRefresh.test.tsx`, optional focused test-only clock helper; no product polling/reducer rewrite.
**Interfaces:** Consumes baseline/diagnosis logs; preserves actual 10/20/40/80/160-second retry behavior, five retries, stopped state, manual read and renewed round.
- [ ] Step1: Instrument in independent clone the exact long-advance boundary and unrelated polling count; preserve baseline full-Web two named timeout logs. Establish expected failure/mechanism before helper change, not deadline raise.
- [ ] Step2: Use explicit React act/flush; asynchronous advancement where next retry effect must schedule, synchronous advancement with settled microtasks for stopped/successful long quiescence. Do not run all perpetual timers or stub business preview timers.
- [ ] Step3: Preserve every business assertion; name both rewritten tests in report and their original ruling. Mutate retry delay, bound and manual read in clone; each intended criterion must fail.
- [ ] Step4: Run focused file and full Web unchanged15s deadline/no skips, typecheck. Commit `test(web): advance preview backoff without unrelated async clock churn`, independent review.

### Task 3: ccloop optional token policy and negotiated protocol4

**Files:** ccloop `src/contract/schema.ts`, `src/state/types.ts`, `src/control/{protocol,command,accept,worker}.ts`, `src/controller/{runLoop,resumeLoop}.ts`; create `src/budget/tokenPolicy.ts`; tests controller/control/contract plus new `tests/controller/optionalTokens.test.ts` and `tests/control/protocol4.test.ts`.
**Interfaces:** Produces exported `BudgetAmount` (nullable tokens), finite usage Amount, `remainingBudget(limit:BudgetAmount,used:Amount):BudgetAmount`, `budgetFits(used:Amount,limit:BudgetAmount):boolean`; independent control `features` response optional feature keys. Protocol4 normal starts/nullable contract and grant; protocol3 finite remains exact.
- [ ] Step1: RED controller consumes >3M tokens under null token ceiling without exhausted; finite active/attempt/session caps still exhaust, null usage/Infinity/extra schema rejected. Old v3 input/hash/snapshot tests unchanged; v4 null negotiated.
- [ ] Step2: Implement centralized nullable-ceiling arithmetic and all direct cumulative token checks/state snapshots/control routing; preserve finite observations and legacy contracts/hash verification. Advertise only tokenPolicy at this stage, not unimplemented features.
- [ ] Step3: RED/implement resumable allowance depletion classification distinct from authored token exhaustion and carry inherited non-token consumption without new run replay increment; no synthetic snapshot. Expose typed waiting cause to consumer.
- [ ] Step4: Full ccloop build/type/tests/native control criteria, clone mutations for null check/finite dimension/usage rejection/v3 boundary. Commit `feat(budget): support optional token ceilings in ccloop`; report actual skips/failures.

### Task 4: Orca authored policy, joint funded claims and budget UI

**Files:** `src/control/{types,schema,commands,budget,usage,estimator,planImport,webProtocol,webService,webDispatch,executionDriver,retryGrant,retryTask,continuation,stopIntent,migrations,store,ccloopPort,executionPort}.ts`, panel views; create `tokenPolicy.ts`, `fundedAllowance.ts`; web BudgetEditor/TokenInput/ControlGroupView/locales/controlTypes; focused control/panel/web tests.
**Interfaces:** Consumes Task3 BudgetAmount/protocol4/features. Produces `allocateFundedAllowance(store,groupId,workId,at):FundedAllowance|null` with authored policy, finite/null work grant, finite handoff, binding reasons/inheritedUsage; group schema11 policy and allocation records. Finite usage unaffected.
- [ ] Step1: RED default new task/group null; old finite records/hashes unchanged; estimates advisory, single-call remains finite; explicit null/finite editing/showing correct. Test algebra and finite usage validation.
- [ ] Step2: Implement isolated ceiling helpers and schema11 migration derived records; update strict server/browser mirrors and normal/capability admission. Do not rewrite old immutable snapshots or confirmed group policy.
- [ ] Step3: Implement §6/6.1 joint allocator transactionally across all binders: complete handoff/minima before residual sharing, skip candidates unfit in any binder, real commitments only. RED two concurrent tasks/unequalhandoff/tinyheadroom/other-project-zero-cap/unknown/start-unknown and authored finite demand. Setting finite cap/group over active unbounded run refuses named conflict.
- [ ] Step4: Implement renewable saved allowance waiting/claim with lineage finite counters and cap raise/removal/rollover wake; unknown null-remainder settlement refuses. Tests count1 renewal exhausts next attempt/session, replay0, soft overshoot books deficit/blocks new work; paired feature >3M, old peer finite works/new null refused.
- [ ] Step5: Run full control + affected panels + Web/type/build and paired source lifecycle, clone mutations cap/lineage/negotiation. Commit `feat(control): allocate unlimited task policies within explicit caps`; report exact old tests altered under delegated authority.

### Task 5: Deterministic execute normalization and durable format-failure capsules

**Files:** ccloop `runtime/codex/{protocol,codexAdapter}.ts`, `controller/runLoop.ts`, `control/{worker,protocol,collect,evidence}.ts` ; create `runtime/executionNormalizer.ts`, `controller/executionFormatFailure.ts`; focused runtime/controller/control tests.
**Interfaces:** `normalizeExecutionFinal(final:string):ExecutionNormalization` distinguishes unique validated execution and unavailable typed reason; `ExecutionFormatFailure` preserves eligible process/events/usage facts through PhaseExecutionError. `captureExecutionFormatFailure(input):Promise<ArtifactRef|null>` publishes strict capsule defined by recovery spec plus full snapshot refs. Expose capsule in collected evidence without changing old report bytes when absent.
- [ ] Step1: RED direct/enveloped/decorated valid complete/partial; ambiguous valid+invalid/hidden/lossy-report collisions refuse; plan/verify behavior unchanged. Failed decode retains finite event/model usage.
- [ ] Step2: Reuse bounded scanner semantic candidate identity; preserve original bytes/normalization evidence. No synthesized fields or model repair.
- [ ] Step3: RED capsule actual original attempt/base/contract/final/event/plan hashes, positive verifier-not-entered, full tree/index/bundle/untracked snapshot before cleanup, capture failure never eligible. Implement immutable/fsynced capsule and recursive evidence collection/private refs under owner fence.
- [ ] Step4: Full ccloop tests/build/type; mutations wrapping ambiguity/usage capture/source identity/snapshot before cleanup; commit `feat(recovery): retain strict execution format failure evidence` and independent review.

### Task 6: ccloop verifier-only recovery execution

**Files:** ccloop control protocol/accept/materialize/worker, controller runLoop/resumeLoop/state; create `controller/verifySavedResult.ts`, `control/savedResultRecovery.ts`; tests controller/control recovery.
**Interfaces:** Protocol4 `mode:'verify-saved-result'` with immutable source/package/hash/normalization/recoveryOf; `readSavedResultEligibility(input):Promise<SavedResultEligibility>` strict new capsule/complete legacy archive qualification; runLoop durable recovery mode/verification-entry and candidate fingerprint.
- [ ] Step1: RED complete legacy envelope failure qualifies exact archived attempt only; tampered base/owner/hash/config/contract/partial snapshot/ambiguouscalls/alreadyverify/unsettled usage refuse. New raw-invalidcapsule cannot invent execution. Use genuine snapshot/archive fixtures.
- [ ] Step2: Validate private recovery package before adapter/provider; restore original snapshot/successful plan, no current-tree guess or preverification rebase. Advertise savedResultRecovery only after implementation.
- [ ] Step3: RED zero plan/execute calls, real required commands/verifier1, fresh usage/counts, sourcefailed immutable, approved usualharvest. Check command/verifier modifies candidate -> typed refusal/no landing, declared scratch excluded.
- [ ] Step4: Persist recovery mode/entry in every start/resume path. Crash beforeentry eligible resume; afterentry durable result reuse else reaped/knownorunknownusage parked, zero automatic repeat/executor. Explicit interrupted successor stays linked original with latest predecessor fence. Rejection/timeout no execute retry.
- [ ] Step5: Full ccloop build/type/tests/control, named clone mutants mode/sourcehash/verifier/fingerprint/crashentry; commit `feat(recovery): verify immutable saved execution without rerunning it` and independent review.

### Task 7: Orca saved-result eligibility, admission and browser control

**Files:** create control `savedResultRecovery.ts`, `savedResultRecoveryPackage.ts`; modify executionPort/ccloopPort/webProtocol/webService/driveRecord/executionDriver/retryTask/commandLedger/migrations/src/auth/permissions.ts, panel API/views; web controlApi/controlTypes/TaskDetail/RunReason/results/locales; focused control/panel/web tests.
**Interfaces:** GET `/api/control/runs/:runId/saved-result-eligibility`; `verify-saved-result` task command `{sourceRunId,sourceAttempt,capsuleHash}`, exactrevision. Produces linked new run and protocol4 package through existing fenced start/outbox/booking/landing; readFeatures old peer optional.
- [ ] Step1: RED source=currentfailed task+semantic authority, later/graph/target/contractchange/alreadylanded/racingretry refuse; currenttargettip drift only ordinary reconciliation. Read eligibility creates no model/command writes. User member/Agent permission matches existing retry authority, owner-required evidence edits none.
- [ ] Step2: Persist derived eligibility/capsule archive and command rechecks; fresh claim usual caps/stop/unknownusage/exclusion, not direct old-run success. Interrupted latest recovery exception exact spec§6.1, not rejection/modification.
- [ ] Step3: Browser `验证已保存成果` / `Verify saved results`, cost note, unavailable reason/ordinaryretry; actual new verification lineage/results separate. Readoldpeerunsupported visibly, no provider retries from polling.
- [ ] Step4: Paired real ccloop fakeprovider success/failure/crash lifecycle with zeroexecute and ordinary harvest/usage; full control/panel/Web/type/build and clone mutations identity/exclusion/cap/lineage/originalpreservation. Commit `feat(control): admit saved-result verification as a new linked run` and review.

### Task 8: Primary Agent role inheritance and preparation

**Files:** agentSelection/agentPreferences/agentFreeze/panel controlViews/estimator/planImport/requirementCommands/webProtocol/panel views; create shared `estimatorCompatibility.ts`; web AgentSettings/AgentFields/AgentSelectionEditor/RequirementsPanel/controlTypes/locales; selection/freeze/import/requirements/web tests.
**Interfaces:** existing preference storage; exact amended layer decision table, `group-primary` source, new v2 hash domain onlynewfreeze; `estimatorCompatibility(resolution,mode):{compatible:boolean,reasonCodes:string[]}` reused required single-call actions. UI validation returns typed SelectionFieldError and retains unsupported draft.
- [ ] Step1: RED nooverrideB/B-m, operatorA/model-onlyA-m plus primaryB staysA/A-m, groupmodel-onlyB-x, explicitC, nullmask/switchagent no crossmodel; oldfreeze bytes/hash same.
- [ ] Step2: Implement backend layer/priorities/provenance and capability predicate from actual resolution; no-estimate import/confirm/run without estimator, required estimate/requirement local reason; no alternateAgent probe. No kind==='codex' capability shortcut.
- [ ] Step3: Primary agent/model/context together, collapsed role overrides, actual inherit source/value, missingAgent actionable, supported context options, invalid draft unsaved. Preserve absent perAgent/preferences and explicit roles. Keep historical low-level helper drop contract if existing tests require, block via validated submission.
- [ ] Step4: Full focused root selection/import + Web/type/build, mutants crossAgentfield/compatibility/invaliddraft/freeze; commit `feat(agents): share primary selection with compatible role overrides`, review.

### Task 9: ccloop installation observation and durable apply

**Files:** create agents `updates.ts`, `updateReceipt.ts`; modify agents table/detect/materialize and control command/features; add structured observation/preview/apply CLI paths; tests agents update/detect/control.
**Interfaces:** strict AgentDetectionPreview/ApplyAgentDetection from agent spec, configuredtable-owned preview/intents/receipts and shared table lock; apply(opId,requestDigest,previewId,baseHash,changeIds) returns immutable before/after receipt, replay same result. `features.agentInstallationUpdate='v1'` only after complete.
- [ ] Step1: RED startup/manual observation no provider/table writes, exactcustomaliases/argv/config preserved, unavailable separate, boundedprobe/process-tree cleanup; preview changedversions/newpaths separate approved choices.
- [ ] Step2: Implement no-follow reads, private adjacent updates directory/files/lock, owned previewvalidation, serialized CAS/reprobe, durableintent/rename/receipt, existingmode preservation.
- [ ] Step3: Two-process simultaneous applies one wins/other stale; crashbefore/afterrename/beforereceipt recover same op bybeforeafter hashes, thirdstate conflicts; replaycompleted beforeCAS, altereddigest refuses. No caller tablepaths or shell commands.
- [ ] Step4: Full ccloop tests/build/type and clone mutants lock/CAS/receipt/customsettings/probecleanup; commit `feat(agents): detect and apply installation changes with durable receipts`, review.

### Task 10: Orca installation update authorization/outbox/UI

**Files:** create control `agentUpdates.ts`; modify schema11migration/commandLedger/commandClient/webProtocol/webService/executionPort/ccloopPort/panel controlAssembly/controlApi/auth; web AgentSettings/GlobalSettings/App/controlApi/controlTypes/locales; root/panel/Web tests.
**Interfaces:** owner GET observation/POST preview/readpreview and ledgered `apply-agent-update` operator command, schema11 durable pending operation outbox/revision; consume Task9 sameoperation receipt beforefinalize. Startup read-only observation1, reconcilepending beforeconflictingapply.
- [ ] Step1: RED owner/CSRF/socketAgent boundary, startup0writes, manualpreview0writes, CAS stale, frozenpreferencesunchanged, oldpeer unaffectedordinarysettings; no recurring timer.
- [ ] Step2: Reservecommand/revision synchronously beforeexternalcall, dispatchsameid, finalizeonlyreceipt; crashafterreceiptbeforeSQLite finalize/reload repeats0mutation and yields retainedresult. Add readprojection/versionwarning and explicitapplyacceptedchanges UI.
- [ ] Step3: Refreshinstallation/effectivepreview without routerreassembly or frozenrewrite; operationunknown promptnoauto duplicate. Exactconfiguredpaths only, unavailable notnochange.
- [ ] Step4: Full control/panel/Web/type/build, pairedreceiptrace/crash, mutants owner/outbox/id/CAS/frozen; commit `feat(panel): review installation updates and reconcile their receipts`, review.

### Task 11: Park unresolved orphan commands

**Files:** controlState/controlApi/App/Overview/overviewModel; create web `UncertainOperations.tsx`; locales/tests controlCommandRecovery/overview/App lifecycle.
**Interfaces:** uncertainty entry gains parked/dismissed/reason metadata backwardscompatible; reducer events park/dismiss/check/resolved preserveunknown identity. No POST/replay invented by UI.
- [ ] Step1: RED retainedresult despiteabsentgroup resolves, bothabsent group parks once/no repeatedlookup, dismisshidepreserve acrossreload/epoch, manualonecheck; @scopes never grouppark; transient retriesretain.
- [ ] Step2: Implement exactspec behavior attention ownership and persistedentry upgrades, nocode marking succeeded; avoid stickyunownedpanelerror.
- [ ] Step3: Full Web/type plus rootlookupcriteria, mutants autoquery/dismisssuccess/scopemistake; commit `fix(web): park unverifiable command outcomes without losing their identity`, review.

### Task 12: Execution/preparation/navigation menus

**Files:** ControlGroupView/GroupList/RequirementsPanel/Shell/GlobalSettings/App/sections/locales/styles; create `GroupActionsMenu.tsx`; browser tests controls/menus/requirements/advanced/navigation.
**Interfaces:** existing commandhandlers/currentrevision; moreactions accessible button/contextmenu, exactrequirementnavigation; browser `orca.showAdvanced` preference; no domain mutation semanticchanges.
- [ ] Step1: RED exactChinese/English controls meanings/pendingstops/continuable distinctions, explicitconfirmthenstart, exactsamegroup transition/sourceinspect, clarifyingdirectarchive atcurrentrevision.
- [ ] Step2: Implement visiblemenu keyboard/touch/rightclick sameactions, Escape/focusreturn/no nestedbutton, serverrefusals preserve, no permanentdelete. Renameconfirmation/preparechecks reusingexistingnextactions.
- [ ] Step3: Advancedchains hiddenbydefault/settingspersist/deeplinkaccessible/activerunningbanner+stopaccessible; no instance migration or extraexecutionflag. Keepproject visible/currentstyle.
- [ ] Step4: Full Web/type/build and relevant rootcommandguards; mutants menuowner/revision/autoStart/activehidden; commit `feat(web): simplify execution controls and expose accessible group actions`, review.

### Task 13: Factual failure diagnostics and operator docs

**Files:** RunReason/TaskDetail/results/Refusal/panelactivity/controlViews/CLIread/locales; README/skills/orca-control; focused failureactivity/schema/refusalcoverage/Web tests.
**Interfaces:** typedactualphase/cause/eligibility plus existingauthorizedevidence links; Activity remains strictentriesenvelope, emptyvalidrun [], missing/unavailable errors.
- [ ] Step1: RED isolatedrealCLI/API activity noentry/unknownrun/malformedstate, typeddecode cause no token guess, oldunknownreason honest, rawcode/identity retained, evidenceaccessnotarbitrarypaths.
- [ ] Step2: Implement specificdiagnosticmapping and newnormalizer/capsule errors, actualsavedresultentry; no modeldiagnosis. Preserve backendwindow and chronologicalUI label; refuseinvalidenvelope rather than swallowingnull.
- [ ] Step3: Update docsnewnavigation/defaultpolicy/features oldpinboundary/roles/refresh/verifycost/commands/stopmeanings; no destructiveSQLworkarounds or falsechainsgeneralization. Any operator skill modification uses skill-creator/writing-skills instructions as relevant.
- [ ] Step4: Full affectedroot/API/entry/refusal+Web/type/build, mutations unknowncause/emptyerror/evidenceauthority; commit `docs(panel): explain preparation, failure recovery and saved verification`, review.

### Task 14: Final branch review, native gates, geometry and local integration

**Files:** thisroundledger/reports/evidence, three live docs/handoff/handoff.md; narrowly fix reviewed productfindings only.
**Interfaces:** alltasksreviewed; fullfeatureproducer and fixedoldpin bothidentified; localmainfastforward; sisterOrca rollingsections replaced.
- [ ] Step1: Fresh mostcapable wholebranchcrossrepo review, exactbase/head+diffpackages; onefixdispatch/scopedrereview, rule on residuals. Check Proxyinvariant疑点, regionkeyboard and settingsrevisionwording carried predecessor items; no oldledger rewrite.
- [ ] Step2: Full ccloop type/build/test/nativecontrol/knownred+package fakeworker; Orca rootJSON/type/build/control/scheduler/chain/panel(afterwebbuild)/Web/pin/defaultpackage/leak; sequentialheavygates, realtooltestfixtures isolated whereconfigured. Capture eachskipname/condition; do not omit priorbaselinefailures or newfails.
- [ ] Step3: Real authenticated isolatedpanel+browser desktop/390px/shortheight; task/groupresults/missing/partialpreview/download, menu/keyboard/sidebarfooter/project/roles/newcontrol; screenshots and measured geometry. No provider/realservice/rootdata.
- [ ] Step4: Verify targetmain unchanged/owncloneclean(excludedsymlink/evidence), fetchlocalbranch then fastforward allchanged source mains using onecommandhookspath. Human sessionauthorization coverslocalmerge; ifmechanicalgate truly rejects, preservecompletedbranch and report exactblock. No remote push/repin. Run required mergedmainchecks, no successclaim for unrunchecks.
- [ ] Step5: Roll Orca§4.0 and replace ccloop/ccmem existingOrca rolling sections, retain memory/T13/daemon/backup obligations; no currentHEADassertion. Commit handoffs locally with attributabletopic. Preserve originalResults5WIP, originalrawlogs and newevidence; do not deletebranches/worktrees without applicableauthorization. Finalhuman audit includesrulings/testchanges/verification/deploymentbounds; chat-only executive summary <=10lines.
