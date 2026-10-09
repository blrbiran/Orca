# 下一轮 M5/M6：设计方向与验收边界

归属：Codex controller，2026-10-09（Asia/Shanghai）。读码基线 Orca `c29676d6d0050d46b9cf61f45ffaee583f9dec76`；来源 `.superpowers/sdd/2026-10-08-issue-fixes/final-review.md` M5/M6，人本日同意开展。这里是 brainstorming 提案，尚非 approved spec/plan，产品未实施。D9/M3 单独收口后进入本轮。

目标是大规模并行下减少同一轮重复数据库读取和 JSON 解析，同时保留现有 wire 输出、严格读视图拒绝、增量投影和归档/取消归档语义。

三个选择：

| 方案 | 收益 | 代价 |
|---|---|---|
| 推荐：每次请求/驱动轮持有一次局部批量快照 | category/summary/group view 复用 work/run map，避免跨任务 N+1；没有跨请求失效问题 | 仍需读取发生变化组的数据；全量 reset 输出大小仍随组数增长 |
| 按 projectionSeq 持久缓存整组读视图 | 相同版本反复读取更便宜 | 每个 writer 都必须可靠失效；活动仍频繁推进 live 组；缓存容量要管 |
| 维护持久化 summary/归档索引 | 可直接查投影，少解析 body | 写入方、迁移、恢复与漂移校验显著扩大；先有测量才值得做 |

推荐本轮先做第一项。准备好的 SQLite statement 归对应 store/database 生命周期，不跨 store 共用，不缓存可变业务对象。

M5 落点 `src/panel/controlViews.ts`：每组 work_items 与 runs 各批量读取一次，用 map 做任务分类与 dependency 状态判断；summary 的容错（坏 work 不算类别）与 group view 的 fail-loud 严格路径保持不同，不能为提速放松验证。run 的 lastActivityAt 取最大 seq 对应的 at，不能直接 MAX(at)：时钟回拨时二者不同。一次 group 聚合替代 per-run activity 查询。evidence、profile、冻结契约等其它读取若仍有 N+1，按实测单列，不声称本轮删除全部 N+1。

M6 落点 `src/control/executionDriver.ts` replenishStartWakes、`webDispatch.ts` nextClaimableTask 与 `dispatch.ts` deliverSchedulerWakes：已有 body 传给归档判断和选择逻辑，避免重新 SELECT+parse 同组 body；pump 查询在发给 handler 前排除合法归档组的 start/no-start/resume wake，wake 保持 delivered=0，取消归档后再次参与。最终 claim transaction 内仍检查归档，挡住探测过程中 archive 的竞态。不通过提前消费 wake 来省开销。

过滤归档必须保留损坏 mark/JSON 的可见拒绝：`json_extract(...,'$.archived') IS NULL` 会漏掉 archived:null、错误形状及坏 JSON 的差异，不能未经验证照搬。SQL 扫描成本与 handler/解析成本分别测量；只把合法归档 wake 排除，不推导 requirement/estimate/legacy wake 的新规则。

主要可执行判据：

- 新增结果等价测试：多依赖、缺失/损坏 work、跨组 task ID、历史 lineage、归档/取消归档、empty/full/reset/incremental summaries，与现有排序和拒绝相同。
- 测量 task category/completion 路径的 SQL statement/读取次数：每组固定批量查询，不能随 T/E 增加逐任务 get；查询数承诺只针对点名路径。
- lastActivityAt 用可回拨的测试时钟，看到最大 seq 对应的 at；替换成 MAX(at) 的独立变异必须红。
- 多轮 pump 下合法归档 wake 不调用 handler/provider，不反复 parse archived body；取消归档后的第一轮能投递，且 claim 前归档竞态仍拒绝。删除过滤/二次检查各有独立变异。
- 独立隔离 clone 的 100 组×50 任务×2 dependency、再加大量归档组进行短批性能测量，记录 Node/commit/数据构造/负载/命令；对照同一机器同一数据的改前改后。禁止起忙循环制造负载或运行付费 provider。

终审旧表的约 0.13 秒是 lookup 微基准的外推，不作为当前 Orca 实测或硬门槛。性能 spec 中以查询/解析上界为稳定 CI 判据，耗时作为有基线的观测；若批量后其它路径仍占主要时间，再基于测量决定第二个方案。

本轮仍需独立 spec、subagent 审、人工 written-spec 审阅、plan 与 subagent-driven，不能因这份提案存在就跳过流程。
