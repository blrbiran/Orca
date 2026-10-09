# Control poll / driver performance design (M5/M6)

归属：Codex controller 的 draft_performance_round 席，2026-10-09（Asia/Shanghai）。文档所在分支 `codex/d9-m3-implementation`，写作前观察 HEAD `2c14e7378684c48ae33b5777ba9a3c430287a586`；全部生产读码固定于 `c29676d6d0050d46b9cf61f45ffaee583f9dec76`，命令 `rtk proxy /usr/bin/git show c29676d:<path>`。来源是旧轮 final-review M5/M6 与 `docs/handoff/2026-10-09-performance-next-round.md`；旧 progress 只读 Round close，不重开旧轮。

状态：可审阅草案，不代表已经实施。人已同意独立性能轮，并授权 controller 裁定执行问题、在本 session 尽量完成及统一终审/三仓交接；controller 指定先 fresh 审设计和 plan 后执行。实现前必须读 D9/M3 已完整收口后的最新树，记录性能轮的真实 before commit；不能把本设计固定读码基线当作那个 commit，也不能覆盖在飞改动。此轮为既有跨模块读接口调整，按 architectural 文档路径整理。

## 1. 目标与边界

降低 changed-group summary、group detail 与 archived wake pump 的重复 SQL 执行、prepare、JSON.parse。成功依赖真实入口的结果等价、明确查询/解析上界和同机同数据 before/after 观测。所有 wire 字段、排序、projection reset/incremental、严格拒绝及取消归档可恢复性保持；summary 故意容错的 work 分类不得变成严格读视图。

不引入跨请求业务缓存、按 projectionSeq 持久缓存、summary/归档索引迁移、provider/调度策略变更、activity writer/retention 改动、依赖算法重构、evidence/profile 读取优化或 D9/M3 产品行为变化。statement 可复用，归对应 store/db 生命周期；不得跨 store 使用，也不得持有跨请求可变业务对象。产品新持久化 writer 为零。

## 2. 三方案与选择

| 方案 | 精确收益 | 成本及本轮结论 |
| --- | --- | --- |
| 每请求/同步驱动段局部快照（选择） | 一组 work/run body 各一次批读，按 id 查 map；同 pump 无 await 的连续归档 wake 一组只判定/解析一次 | 无失效协议；全量 reset 和 driver 仍线性扫描组；现有严格验证保留 |
| projectionSeq 持久读视图缓存 | 不变组可能不重读 | 每 writer 失效、活动频繁推进、对象生命周期/容量扩大；本轮不做 |
| 持久 summary/归档索引 | 直接读取可投影字段 | migration、恢复、漂移校验与写入面扩大；本轮不做 |

M6 内另有两种过滤办法：SQL 可先排除 archived wake，减少行传输与 JS 解析，但必须完整匹配 `archivedMarkSchema`、根对象/重复 JSON key、`archived:null`、额外字段、数字/string 等差异，并保障坏 JSON 不被 SQL 误排除或让整个 pump 失败。简单 `json_extract(...,'$.archived') IS NULL` 不正确。本轮选择入口局部过滤，复用现有 `archivedMarkOf`，减少 handler/stop/probe 等后续工作。它仍读取并解析合法归档组一次/同步段，仍扫描 pending wake，不声称归档 SQL 扫描或 JSON 解析归零。若实际收益不够，在终审报告剩余热点，再提出下一轮，不能用 microbenchmark 外推冒充真实收益。

## 3. M5：每请求 group work/run 快照

新增 `src/panel/groupReadSnapshot.ts`，只负责 group-scoped 原始行批读、顺序与懒 JSON 解码。`readGroupSnapshot(store, groupId)` 以 `WHERE group_id=?` 读取 work_items 和 runs 各一次；run 的 rowid 顺序用于 current lineage，显示仍按既有 id 排序。snapshot 包含原始行 map、rowid-order run 数组与每行解码结果。解码只在旧调用原本会使用那行时发生，记录成功或原始 SyntaxError；不为 unused/handoff 行提前添加新拒绝。

`src/panel/controlViews.ts` 的 categoryOf、taskCompletion、workViews、currentProgress、runViews、continuableRun 及本文件 effectivePlanTask 的 workBody 读取共享它。readControlGroup 只创建一个，嵌入 summary 也共享；独立 readGroupSummary 为非 clarifying 组创建一个；readControlSummary 每个实际 recompute 的非 clarifying 组各创建一个，unchanged/empty incremental 不创建。readRunEvidence 仍经 runViews 校验，使用同一批读方式。requirement 的产品读路径不扩张。

原始 JSON 解码与 schema 验证分开。严格调用沿用其 `work-item-invalid:*`、`run-work-invalid:*`、`run-invalid:*` 等 detail 和 identity/frozen/amendment/accounting/lineage 检查。summary 缺行或坏 work 不算 done，也不进入任一类别；被引用坏 dependency/current run 仍使该任务不进入类别；无引用坏行不使 summary 整体拒绝。跨组相同 task id 不能补上缺失 dependency/current run。旧 `done`/`completed` 区别、currentRunId 与历史 lineage 的语义原样保留。

准备的批读 statement 用模块内 `WeakMap<ControlStore, ...StatementSync>` 绑定 store；snapshot/decoded object 不放入该 WeakMap。任何调用均新建 snapshot，跨 store、close 后重新 open 都不会复用旧连接 statement。调用者只能读 request-local 解码结果，不能修改它们。

### 最新 run activity

`src/control/activity.ts` 新增 `readLatestRunActivityByGroup(store, groupId): LatestRunActivitySnapshot`，`LatestRunActivitySnapshot.get(runId): ActivityEntry | null`。一次查询选出该组 runs 的每个 run 的最大 seq 所对应完整 activity 行，不能 `MAX(at)`，不能把 group 的最新 at 赋给所有 run。保留原 readRunActivity 的 run-id 语义：按 runs.group_id 限定 run 集合，不额外以 activity.group_id 过滤而改变已有结果。

完整列包括 kind/body；get 时调用原 entryOf 校验，懒解码保留 runViews 原先身份检查先于 activity 拒绝的顺序。不存在 latest 行返回 null，保留 retention 已清走旧 run feed 的行为。group view 的现有 50-row group feed、summary.updatedAt 与 readControlRunActivity 的独立查询不合并。

### 稳定计数判据

命名承诺仅针对 snapshot 覆盖的 work/run body 与 latest run activity 路径：

- 每个非 clarifying summary/group request，work body batch SELECT 执行 1、run body batch SELECT 执行 1；这两个来源的逐 task/dependency/current/history body `.get` 执行 0。
- group view 的 latest-run activity batch SELECT 执行 1，逐 run latest activity SELECT 执行 0；summary-only 不引入这个 activity batch。
- 每个被使用的 snapshot work/run body JSON 解码至多 1；unused 行不提前 parse；schema 校验次数不冒称 JSON.parse 次数。
- 同 store 第二个请求不重新 prepare 本轮复用的 statement，但重新执行 SELECT、读取新数据；另一 store 各自 prepare。

stop frozen-run identity、artifactIds/evidence、estimate/profile/冻结契约等其它查询仍保留。报告必须把这些剩余读取列为 separate counters，不能称“整页只剩两条 SQL”或“消除了全部 N+1”。

## 4. M6：已有 body 复用与入口过滤

`nextClaimableTask(store, groupId, groupBody?: unknown): ClaimableTask | null` 添加可选局部 body。给了 body 则在原归档检查位置调用 `archivedMarkOf(body)`；未给则沿用 isGroupArchived。只允许同同步段、已读取本 group 的 body 传入。replenishStartWakes 将它刚 JSON.parse 的 group 传入，删除这个调用造成的重复 groups SELECT+parse；原 savepoint、stop/blocker/dispatchable 检查顺序与失败 stderr 仍保留，不提前校验坏 mark 引出新拒绝。

`deliverSchedulerWakes` 在原 global blocker / missing handler / group blocker 判断之后，在 `JSON.parse(wake.body)` 及 handler 之前，只为 start/no-start/resume 检查合法归档。按 group 在局部 map 记录判定；所有属于该合法归档组的这三类 wake 进入 deferred，保持 delivered=0，既不调用 handler，也不 probe/provider。其它 wake kind 不增加归档规则。保留 oldest-first 的 delivered/deferred 顺序、空结果及错误隔离。

过滤不能把坏 group JSON 或坏 mark解释成“已归档”。局部读取/解析/archivedMarkOf 抛错时，把该组记为“不作优化过滤”，继续走既有 handler 路径，让原严格 authority 拒绝可见；不能 catch 成合法 archived，也不能吞进过滤的成功计数。真实 handler 的拒绝仍保持 pending；直接 deliverScheduledStart 与 nextClaimableTask 继续按原 error/refusal 路径拒绝。

map 不跨 pump；每次 `await handler(...)` 完成（成功、false 或 throw）后清空归档判定，后续 wake 重新读当前 group。因为别的命令或 handler 可在 await 内 unarchive/archive，不能携带旧判定跨 await。纯合法归档批次无 handler await，所以每组每 pump 恰一次 group lookup/parse；混合批次的上界是每组每同步段一次，并须测实际次数。

最终 claim transaction 内 isGroupArchived 检查必须保留，不能用 pump 或 probe 前 body 替代；archive 在 probe 等待过程中发生仍不 claim、仍不 consume wake。unarchive 后第一轮可投递；同 pump 内前一个 handler 取消归档，后面的 wake 也能看到。

## 5. 回归、变异与规模观测

在真实 readControlSummary/readGroupSummary/readControlGroup、replenishStartWakes、deliverSchedulerWakes/deliverScheduledStart 入口验证。新测试覆盖多 dependency、缺/坏 work、坏被引用 run/dependency、同名跨组、历史 rowid 顺序、amendment/frozen 严格拒绝、empty/full/reset/incremental、retention/null/activity 内容损坏与时钟回拨。使用两个 store 与连续请求写入测试击穿错误缓存。

归档测试涵盖三类 wake 多轮 pump、unarchive 下一轮、同 pump await 后更新、archive-during-probe，以及 absent mark、null/string/array/缺 actor/多字段/坏 JSON。真实 handlers 保持可见拒绝；不为 requirement/estimate/legacy invent 新规则。

每个新增分支必须在隔离 `git clone --local` 副本中删除其自身 guard 或数据替换，跑命名测试见红：依赖 group scope、strict work 校验、快照新鲜度、current rowid 顺序、最新 seq→MAX(at)、最新 activity entryOf、入口归档过滤、unarchive 新鲜度、最终 transaction 归档检查、非法 mark“不优化过滤”、driver body 传递。变异不得动共享实现树，报告原始日志与退出码；还原证明是 clone `git diff` 和 `git diff --cached` 字节数为 0。

规模 fixture 为 100 live 组×50计划任务；task0 无依赖，task1 依赖 task0，其余各依赖前两 task。构造代码计算 E（不能把目标“两依赖”误报成人工观测的100边）；另加 100 archived 组，每组各一个 start/no-start/resume pending wake，采用真实 gate 合法构造。live 组至少有可显示 current run 和可回拨 activity，另一个小型正确性 fixture 覆盖历史 lineage。固定 clock、固定 task/group IDs；provider 使用现有 fake router/port，不开启真服务、忙循环或付费模型。

基准各测 full/reset summary、全部 live 组均有真实 projection change 的 incremental summary（先记cursor，再在一次store.transaction内对100组各recordActivity；断言resetRequired=false且changed IDs恰100组，避免retention=64把它误测成reset）、empty incremental（断言resetRequired=false且changed groups=[]）、单组 detail、全部 live detail、replenish、archived-only pump 与 live/archived mixed pump。每负载 10 次 warmup、30 次有界采样；分开无 instrumentation 耗时与带 SQL/JSON/handler counters 的一次观测，避免计数 hook 扭曲耗时。操作性 pump/claim 用独立 fixture 或每样本恢复同一初态，不能先 consume 再测空壳。

before/after 共用同一个由benchmark持有的固定artifact/repo/config绝对路径命名空间（串行恢复初态），并复制同一合法初态控制库/证据；这些路径及agent command会进入contract/config hash，不能各自mkdtemp后把业务hash从digest删掉。counter只原地包裹db/statement并返回同一ControlStore身份，避免transaction/projection WeakMap失联。

before 是 D9/M3 完整最新树、性能改动之前；after 是本轮实现提交。同机、同 Node、同构造脚本，记录 commit/dirty diff、Node/SQLite、实际 G/T/E/R/归档wake数、命令、warmup/sample、p50/p95/min/max、SQL prepare/执行/返回行数、目标 body JSON 次数、handler/probe/accept 次数。通过现有真实入口校验 normalized output/refusal digest 等价；仅生成随机 run id 可按 group/task/claimOrdinal 对应规范化，禁止删除业务字段/错误 detail。固定 clock 避免把时间漂移当业务差异。计数上界是 CI 判据，耗时是观测，无0.13s或百分比硬门槛。

## 6. 执行与交接

两到三个可独立验收任务；controller 用已指定 fresh 审/执行方法统一记录。实现完整后跑本轮命名回归、typecheck 和必要完整 gate；任何 suite/service/provider 运行由执行阶段授权范围及当前树决定，本起草席不跑。before/after 或 refusal 等价不成立即不能宣布性能轮完成。终审记录收益、仍存 N+1、D9/M3 合并后偏差、三仓当前 commit/pin及 awaitingHuman；Orca 专属性能轮不自行改 ccloop/ccmem 产品。
