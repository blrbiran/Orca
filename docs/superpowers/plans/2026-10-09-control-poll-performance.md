# Control Poll Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task; controller 已指定 fresh 审设计/plan 后执行。Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在真实 summary/group/driver 入口减少 M5/M6 重复读/解析，并用等价性、计数和100组规模 before/after 证明收益。

**Architecture:** 每个请求一组一份 work/run raw-row snapshot，懒 JSON 解码保留各调用的容错/严格验证。latest activity 一组一次按 seq 聚合完整行；driver 复用已有 group body，wake pump 同步段内过滤合法归档并在 await 后丢弃判定。

**Tech Stack:** TypeScript、node:sqlite（项目 Node floor 22.13.1）、Zod、Vitest、tsx；不新增依赖或 migration。

**Spec:** `docs/superpowers/specs/2026-10-09-control-poll-performance-design.md`

归属：draft_performance_round 席，2026-10-09；生产调查固定基线 c29676d，草案所在分支 codex/d9-m3-implementation，写作前 HEAD 2c14e7378684c48ae33b5777ba9a3c430287a586。草案无实施/测试完成声明。

## Global Constraints

- D9/M3 完整最新树是实施起点；先记录性能 before commit，再重读下列 exact files/callers，不读取在飞半成品。已有 D9/M3 行为与拒绝原样保留；偏差由 controller 裁定并写新证据。
- 不改旧 spec、旧 sdd ledger、迁移、真实 ~/.orca、ccloop/ccmem 产品；不使用跨请求 mutable business cache，statement 不跨 store。
- 命名计数只承诺被替换的 body/category/completion/latest activity 路径；其它读取单列。
- 变异只在隔离 local clone；验证日志重定向文件后整份读回，不过滤输出或吞 rc；只记录工具实报耗时/计数。
- 用户已有 session 执行授权；不再重问范围。controller 的 fresh 文档审是实施前剩余 gate。push/merge/main/删 worktree 由现有人工 gate 处理，本 plan 不执行。

## Review Focus

1. 懒 parse 是否把坏 unused 行提前拒绝、或把 summary leniency 变为 strict：Task 1 `does_not_parse_unused_rows_and_preserves_summary_refusals`。
2. body map 是否泄漏组或请求、historical/current run 按错误顺序判定：Task 1 `scopes_ids_and_refreshes_between_requests` / `preserves_rowid_lineage_and_strict_authority`。
3. latest seq 是否退化为 MAX(at)、跳过坏 activity 校验：Task 1 `uses_latest_seq_with_clock_rollback` / `rejects_corrupt_latest_activity_after_run_checks`。
4. pump filter 是否隐藏损坏 mark或丢掉 pending wake、同 await 的 unarchive 不可见：Task 2 `invalid_archive_data_reaches_strict_authority` / `unarchive_is_visible_next_pump_and_after_await`。
5. 计数 hook/benchmark 是否只测 helper、或测已消费后的空操作：Task 3 `assertMeasurementCoverage` 与每负载的 before/after digest/操作初态检查。

## Task 1: Batch view work/run snapshots and latest activity

**Files:**
- Create: `src/panel/groupReadSnapshot.ts` — store-bound statements、原始行与 request-local lazy decode。
- Modify: `src/panel/controlViews.ts` — categoryOf/taskCompletion/currentProgress/workViews/runViews/continuableRun、readGroupSummary/readControlSummary/readControlGroup/readRunEvidence。
- Modify: `src/control/activity.ts` — 批 latest seq 查询并复用 entryOf。
- Create: `tests/panel/controlPollPerformance.test.ts`。
- Create: `tests/control/fixtures/controlReadCounters.ts` — test-only SQL/JSON instrumentation。
- Existing regression files run unchanged: `tests/panel/groupSummaryFields.test.ts`, `tests/panel/controlViewOrder.test.ts`, `tests/control/loopPlanViewFields.test.ts`, `tests/panel/runContinuable.test.ts`, `tests/panel/runGitView.test.ts`, `tests/control/activity.test.ts`, `tests/control/activityRuns.test.ts`。

**Interfaces:**
- `StoredWorkRow = Readonly<{ id: string; group_id: string; body: string }>`。
- `StoredRunRow = Readonly<{ id: string; group_id: string; work_item_id: string; generation: number; active: number; body: string }>`。
- `StoredJsonResult = { ok: true; value: unknown } | { ok: false; error: SyntaxError }`。
- `readGroupSnapshot(store: ControlStore, groupId: string): GroupReadSnapshot`；snapshot 的 `groupId`, `workById`, `runById`, `runsByRowid` 为 readonly；`decodeWork(id: string)` / `decodeRun(id: string): StoredJsonResult | undefined` 懒 parse，missing 是 undefined。
- `readLatestRunActivityByGroup(store: ControlStore, groupId: string): LatestRunActivitySnapshot`；`get(runId: string): ActivityEntry | null` 懒 entryOf，与 readRunActivity 对同一 run 最新行等价。
- 私有 `readGroupSummaryFromSnapshot(store, groupId, snapshot)` 供 readControlGroup 嵌入 summary；公开 readGroupSummary/readControlSummary/readControlGroup/readRunEvidence 签名不变。strict schema wrapper 消费 StoredJsonResult 时重用旧 detail；summary 只按旧 catch 位置转 null。
- `ReadCounters = { prepares: readonly { sql: string }[]; executions: readonly { sql: string; method: "get" | "all" | "run"; rows: number }[]; parses: ReadonlyMap<string, number> }`；handler/probe/accept用fake deps自带spies单列，不混进SQL计数。
- `installControlReadCounters(store: ControlStore): { store: ControlStore; reset(): void; snapshot(): ReadCounters; restore(): void }`；透传 bound native db/statement 方法，记录 prepare、实际 get/all/run、返回行数；JSON spy 根据 fixture raw-body 集合分类，finally 恢复。返回store必须为原ControlStore同一对象（不能proxy/clone store导致transaction/projection WeakMap身份失配），只包装db/statement方法；业务调用通过返回的 store，fixture写入/expected查询在 reset 前/after counting 外。

- [ ] **Step 1: Write failing real-entry tests** in controlPollPerformance.test.ts. 10、50任务 fixture 分别调用 readGroupSummary/readControlGroup；assert body batch executions exactly work=1/run=1、target body point gets=0、group latest batch=1/per-run latest=0、summary latest batch=0；每个使用的 raw body parse<=1。输出 counts/completion/work category/progress/current/historical lineage/activity/排序与既有期望逐字段 deepEqual。
- [ ] **Step 2: Add refusal/freshness cases** with named tests from Review Focus. 缺/坏 work summary 不算done/类别；严格 group保留相同ControlError code+detail。bad dependency/currentrun、不被引用坏row、跨组同taskid、amendment/identity/frozen mismatch各pin旧拒绝。调用之后写真实状态/recordActivity，再第二请求必须看到变化；两个store内容不同，第二store不能读第一store。同一instrumented store第一次读取目标statements各prepare=1，reset计数后的第二请求目标prepare=0且SELECT仍各执行1；另store目标prepare各1。close/reopen后的新store重建statement。历史run id lexical顺序与rowid相反；最大seq的at较小；最新activity badkind/badbody拒绝；无行/retention返回null。
- [ ] **Step 3: Observe red** with `rtk proxy npx vitest run tests/panel/controlPollPerformance.test.ts`（整份log、rc）；计数测试必须因真实旧入口的重复get失败，不能只因helper不存在失败。
- [ ] **Step 4: Implement interfaces and wiring**. 两个 group-scoped all statements；rowid-order run 原始集合不丢历史/estimate/handoff。lazy解码结果留请求内，strict wrapper保留原parse/schema detail与调用顺序；有效plan读取也从快照给effectivePlanTask。runViews显示按原id顺序；其它evidence/冻结读取保持。activity SELECT按runs成员join最大seq原始activity完整行并懒entryOf，不MAX(at)。statement WeakMap仅存statement。
- [ ] **Step 5: Run focused verification**: `rtk proxy npx vitest run tests/panel/controlPollPerformance.test.ts tests/panel/groupSummaryFields.test.ts tests/panel/controlViewOrder.test.ts tests/control/loopPlanViewFields.test.ts tests/panel/runContinuable.test.ts tests/panel/runGitView.test.ts tests/control/activity.test.ts tests/control/activityRuns.test.ts` and `rtk proxy npm run typecheck`；全部rc0且无跳过。本任务不改已有tests。
- [ ] **Step 6: Mutations in isolated clone**: 去掉group限定→跨组红；decode result跨请求保留→freshness红；删strictwork schema/authority→strict红；run排序用id代rowid→lineage红；MAX(at)→rollback红；删entryOf→corruptactivity红；还原逐taskbodyget→count红。分别跑对应命名test，记录每个独立nonzero，不共享一次变异掩盖多个guard。clone还原diff/stageddiff字节数0。
- [ ] **Step 7: Record and commit** only owned source/new tests/new report into `.superpowers/sdd/2026-10-09-control-poll-performance/task-1-report.md`，含真实commit/命令/rc/计数/变异，commit message `perf: batch control view work and run reads`。

## Task 2: Reuse driver body and filter archived wakes safely

**Files:**
- Modify: `src/control/executionDriver.ts` — replenishStartWakes 的原nextClaimable位置传group。
- Modify: `src/control/webDispatch.ts` — nextClaimableTask可选body；所有claimarchive checks保留。
- Modify: `src/control/dispatch.ts` — deliverSchedulerWakes局部合法归档filter。
- Create: `tests/control/archivedWakePerformance.test.ts`。
- Consume: `tests/control/fixtures/controlReadCounters.ts`。
- Existing regression files run unchanged: `tests/control/archiveGroup.test.ts`, `tests/control/webDispatch.test.ts`, `tests/control/dispatch.test.ts`, `tests/control/driverRoundIsolation.test.ts`, `tests/control/driverContinuation.test.ts`。

**Interfaces:**
- `nextClaimableTask(store: ControlStore, groupId: string, groupBody?: unknown): ClaimableTask | null`；body only from same group/current synchronous read，undefined保留oldstore read。
- replenishStartWakes与deliverSchedulerWakes公开签名、结果不变；泵内局部filter的状态为合法archived/合法unarchived/unknown（坏row，不优化）。不是新的authority。
- live handlers继续用createWebWakeHandlers；归档filter不能替代deliverScheduledStart交易内isGroupArchived。

- [ ] **Step 1: Write failing entry/count tests**. 已启动可dispatch group、无pendingwake、存在laststart的replenish入口：groupbody parse exactly1，传body的nextClaimable额外groupsbodyget=0，现有arm/noarm输出相同。100合法archivedgroups各3种wake连续置入；连续3pump每次 target handler/probe/accept=0，每组groups lookup/parse=1，全部wake仍delivered=0且deferred按rowid原序；比较before入口返回IDs，不改派发种类。
- [ ] **Step 2: Pin refusal/lifecycle/races**. absent mark的真实handler照常可claim；null/string/array/缺actor/extrafield/坏groupJSON的真实handlers保持原拒绝并pending；直接deliverScheduledStart的code/detail相同，invalid不是filterhit。unarchive命令后第一pump实际投递。混合pump先一livehandler await期间unarchive后面group，下一wake看到当前mark；同样archive时拒绝。fakeprobe期间archive，最终交易拒绝、active runs=0、pending不消费。requirement/estimatekindhandler行为与旧入口同；global blocker/nohandler/groupblocker优先序相同。
- [ ] **Step 3: Observe red**: `rtk proxy npx vitest run tests/control/archivedWakePerformance.test.ts`；旧真实路径应因重复groupread或handlercallcounts失败。
- [ ] **Step 4: Implement minimal changes**. body参数只替换nextClaimable原archive-read；不提前对不dispatchable/stopped坏mark加拒绝。pumpfilter在原blocker判断后、wakeJSON/handler前，用isGroupArchived/archivedMarkOf同一语义；异常仅设置unknown并继续旧handler。await handler完成后清map，含false/throw，保留resultorder与UPDATE位置。用store-boundprepared group lookup，判定不跨pump。
- [ ] **Step 5: Verify**: `rtk proxy npx vitest run tests/control/archivedWakePerformance.test.ts tests/control/archiveGroup.test.ts tests/control/webDispatch.test.ts tests/control/dispatch.test.ts tests/control/driverRoundIsolation.test.ts tests/control/driverContinuation.test.ts` plus `rtk proxy npm run typecheck`；rc0/无skip。
- [ ] **Step 6: Independent clone mutations**. 删入口filter→handler0红；filter把invalid当true→invalidreachesauthority红；跨pump保留map→unarchive红；不在await后清map→samepumpupdate红；删交易archiveguard→probe race红（不能被前置guard挡住）；删driverbody实参→groupcounts红。每个命名testnonzero后还原，clone diff/stageddiff字节数0。
- [ ] **Step 7: Record/commit** new task-2-report.md，`perf: reuse driver group bodies and defer archived wakes early`；明确mixedawait条件下仍读/解析的实际次数，不承诺SQL零parse。

## Task 3: Reproducible real-path before/after benchmark and final evidence

**Files:**
- Create: `tests/control/fixtures/controlPollPerformance.ts` — 有效规模数据与固定clock；仅fakeprofile/router/port，无真实provider。
- Create: `tests/bench/controlPollPerformance.ts` — 可由tsx运行的有界基准，无产品导出/依赖变化。
- Create: `.superpowers/sdd/2026-10-09-control-poll-performance/benchmark-report.md` 及独立 raw logs/manifest/result JSON。
- Create: `.superpowers/sdd/2026-10-09-control-poll-performance/final-review-input.md` — 给controller fresh终审的数据。

**Interfaces:**
- `ControlPollFixture` 明确含 `store: ControlStore`, `wakeDeps: Parameters<typeof createWebWakeHandlers>[0]`, `driverDeps: Pick<ExecutionDriverDeps, "store" | "admissionGate">`, `service: WebControlService`, `liveGroupIds: readonly string[]`, `archivedGroupIds: readonly string[]`, `canonicalRunIds: ReadonlyMap<string,string>`, `manifest(): { liveGroups: number; archivedGroups: number; tasks: number; dependencies: number; runs: number; pendingTargetWakes: number }`, `dispose(): Promise<void>`。
- `buildControlPollFixture(options: { liveGroups: number; archivedGroups: number; tasksPerGroup: number; now: number }): Promise<ControlPollFixture>`，返回store、fake deps、service、稳定group/task映射、`manifest()`、`dispose()`；借现有openTestStore/webFixture同一合法schema/deps构造方式，不靠绕过readvalidator创建廉价伪数据。固定group/taskID与clock，run随机ID按group/task/claimOrdinal规范化。
- `assertMeasurementCoverage(fixture: ControlPollFixture): void`；直接assert实际G=100/liveT=5000、DAG任务依赖规则、E来自sum(dependsOn.length)、每livegroup至少1currentrun、archivedG=100/pending3种wake=300及各负载非空。构造目标task0=[], task1=[task0], i>=2=[i-1,i-2]；把计算出的E写manifest。
- CLI `rtk proxy npx tsx tests/bench/controlPollPerformance.ts --output <absolute-report-dir> --warmup 10 --samples 30`；输出JSON包含全部负载的timing/counters/output/refusaldigest/运行环境/代码commit/dirtydiff，任何结果或count不等价退出nonzero。

- [ ] **Step 1: Build fixture and benchmark**. 真实入口负载固定为full/reset、alllivechanged incremental、empty incremental、onegroup detail、alllive detail、replenish、archived-onlypump、mixedpump；warmup/sample前重新构造或恢复操作负载同一初态，incremental先记真实cursor，再于一次store.transaction内为100livegroups各recordActivity，避免projectionJournalRetention=64裁掉旧cursor；调用前后断言resetRequired=false、changed group IDs恰100livegroups。empty incremental断言resetRequired=false且groups=[]；full/forced/retention reset分开明确断言resetRequired=true和完整结果。freshprojectionchange由真实recordActivity产生。scope manifests用于证明未通过空cursor/consume降低测量工作量。分别测无hook时长与一轮hookcounters；JSON分类统计只计目标rawbody，其它数据另列。
- [ ] **Step 2: Baseline and after in isolated clones**. controller保存的D9/M3完成beforecommit与aftercommit各`git clone --local`，beforeclone只拷同一新benchmark/fixture/counter工具（不拷产品patch），tsx直接imports该clone生产源码。测相同CLI、机器、Node/SQLite、构造/负载参数；串行使用同一固定repo/config/artifact绝对路径命名空间及同一初态库/证据（可快照恢复），不能各mkdtemp改变contract/config业务hash；不删业务hash来强行等价；每组logs整份保留，测量值附命令+commit。随机runid映射只用于digest，不删除refusal/detail/业务字段。若baseline现有API不能运行同一harness，先修harness，不能绕过真实入口。
- [ ] **Step 3: Evaluate gates**. Task1/2 countbounds达成、normalizedoutput/refusaldigest等价、mutation红证据齐全才继续。report填实测p50/p95/min/max与prepare/execute/rows/parse/handler/probe/accept counts，不预填百分比或0.13s外推；mixedpump的remainingOarchivedscan/每同步段parse写明。收益不足或热点转移如evidence重复扫描，报告真实边界不扩大此轮。
- [ ] **Step 4: Final verification and review input**. 重跑本轮全部命名测试、typecheck，并由controller按最新树安排requiredfullgate，验证命令完整重定向/读回，记录每项rc及测试skip；不对历史suite计数作未测引用。列ownedfiles、before/after、D9/M3冲突裁定、所有计数/变异/耗时raw日志、剩余风险供freshwholebranchreview。
- [ ] **Step 5: Commit owned benchmark/evidence** `test: measure control poll and archived wake workloads`。controller统一review与三仓handoff；本轮不自行push/merge/删除worktree，未被测/未通过项必须列明。

## Plan self-review

Spec §3→Task1，§4→Task2，§5规模/等价/计数/变异→Task1/2/3，§6→Task3+controller。接口在Task1定义，Task2/3只消费；unused/invalid/freshness/activity/race各有命名test和独立变异。任务为三个可独立拒绝的交付件；没有已实施或已通过的占位结论。
