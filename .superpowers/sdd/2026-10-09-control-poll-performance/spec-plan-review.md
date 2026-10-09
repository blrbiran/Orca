# M5/M6 performance spec + plan independent review

归属：Codex controller 的 `/root/review_performance_design_plan` 独立审查席，2026-10-09（Asia/Shanghai）。观察工作树 HEAD `2c14e7378684c48ae33b5777ba9a3c430287a586`，命令 `rtk proxy /usr/bin/git rev-parse HEAD`。生产静态核对固定 `c29676d6d0050d46b9cf61f45ffaee583f9dec76`，命令 `rtk proxy /usr/bin/git show c29676d:<path>`；D9/M3 新语义只读其已发布设计 §9.1–9.5，不读在飞实现作为稳定证据。

审查对象：`docs/superpowers/specs/2026-10-09-control-poll-performance-design.md` 与 `docs/superpowers/plans/2026-10-09-control-poll-performance.md`。未读 draft-report，未继承起草通过结论；未运行 suite、benchmark、服务、provider 或真实控制库，未修改产品、测试、spec、plan 或 Git 状态。本文件是唯一持久写入。

## Verdict

- **Spec verdict: Approved with minor implementation notes.** 初次发现的 I1 已由 controller 修正文档并经本席静态复核，无未解决 Critical/Important。
- **Plan verdict: Approved with minor implementation notes.** 三个任务覆盖目标、真实入口计数、拒绝/顺序/缓存新鲜度、独立 clone 变异及规模观测；I1 修正已落到 Task 3。
- **Ready to execute: Yes, after D9/M3 完整收口。** 必须先记录其真实 before commit，并重读最新稳定树；不得与当前唯一 D9/M3 writer 并行写入。这里批准的是执行设计，未宣称运行时收益、计数上界、等价性或测试已经通过。

## Critical

None found.

## Important

### I1 — 原 100 组 incremental 负载可能被 retention 偷换为 reset（已修正）

原 spec §5 / Task 3 Step 1 要求 100 live 组均经真实 `recordActivity` 产生 projection change，但没有明确同一事务与 `resetRequired=false` 判据。固定基线 `src/control/projectionJournal.ts:4` 的 retention 为 64；若每组分别提交一笔事务，100 次 changeSeq 推进会使测量前 cursor 过期。名为 incremental 的负载实际走 reset，before/after 仍能输出等价、非空的 100 组，原规模断言不能发现错误。

本席确认问题后即消息报告 controller。controller 随后修正 spec §5（当前第 72 行）和 plan Task 3 Step 1（当前第 96 行）：先记真实 cursor，在**一次** `store.transaction` 内为 100 live 组各 `recordActivity`，断言 `resetRequired=false`、changed IDs 恰为 100 live 组；empty incremental 明确 false/空组；full/forced/retention reset 独立断言 true/完整结果。

复核依据：`projectionJournal.ts:41–48` 在同事务首次变更时分配 changeSeq，后续组复用该值；各组仍独立更新 projection_seq 并插入 journal 行，retention 按 changeSeq 截断（第 56 行），不是按 journal 行数截断。先取当前 cursor 后批量更新，符合 `readProjectionChanges` 第 84 行的保留窗口语义。修正堵住原假阳性，**I1 resolved**。以上为静态代码结论，无运行结果或性能值。

## Minor

### M1 — 计数 hook 应显式保留 ControlStore 对象身份

Plan Task 1 的 `installControlReadCounters` 返回可供业务入口使用的 store，并要求 native db/statement 方法正确绑定；实施时还须保留传入 store 的**同一对象身份**，不能仅 spread/proxy 成一个新 store 再复用原 `transaction` 闭包。

固定基线 `projectionJournal.ts:7` 的 transaction WeakMap 以 ControlStore 为 key，`store.ts:133,144` 在原 store 对象上 begin/finish transaction。只绑定 native 方法不能弥合新 wrapper identity；否则通过 wrapper 调用的 `recordActivity` / projection writer 会认为没有对应事务。原对象上的 test-only db/statement instrumentation 可以满足此要求；restore 后也应使用同一对象，避免因更换 WeakMap key 漏数或重复 prepare。此项是实施注意，不要求新增产品抽象。

### M2 — 规模 fixture 的业务 hash 输入路径也应确定

Spec/Plan 已固定 clock、group/task IDs，并只允许随机 run ID 规范化。实施规模 fixture 时须同时确定进入 contract/frozen record 的 repository/config 绝对路径，且在 before/after 顺序运行时重建相同 fixture 初态。

固定基线 `tests/control/fixtures/web.ts` 将测试临时 repo 路径放进 contract 的 `context.repoPath`；随机临时 root 会让合法的 original/derived contract 与相关 plan/snapshot hash 不同。不能为过等价性 gate 删除这些业务字段，或把它们作为“随机 run id”规范化。可使用同一独立 fixture 根目录顺序重建，或另一种保证相同业务输入的合法构造。现有 digest gate 会挡住此错误，故非阻塞设计缺陷。

## Static assessment

### M5 数据流、严格性与容错

基线 `controlViews.ts:285–317` 的 category/dependency/current-run JSON 读取与 taskCompletion 的两层 catch 有不同语义；completion 先计 done/completed，category 失败只使该任务不计入类别。设计把 raw JSON decode 与 schema validation 分开、仅在原使用处 lazy decode，并保留 catch/detail/调用顺序，能避免把 summary 容错升级为严格读视图。原工作项必须保留 `done` 与 dependency-only `done` 的区别。

`workBodyOf` 对缺行/坏 JSON 返回 null，供 effectivePlanTask 先作 amendment 判定；替换时仍须保留这一契约，不能让缓存的 SyntaxError 在 amendment 阶段提前逃出。严格 work/run wrapper 的原 detail 和 identity/frozen/accounting/lineage 校验被明确保留，并有真实入口与独立删除变异。

group-scoped map、每次新建 snapshot、rowid-order lineage 与 id-order 显示的分工符合基线。无引用坏行仅 summary 不预 parse；group detail 原本遍历的 run 仍须严格验证。WeakMap 只存 store-bound statement，不存 raw snapshot 或业务解码结果；两 store、连续请求写入、close/reopen 的判据足以检查生命周期要求。

### Latest run activity

基线 readRunActivity 以 run_id 按 seq DESC 取行，entryOf 校验 kind/body；设计一次按 runs.group_id 限定成员、取每 run 最大 seq 的完整原始行，lazy get 时调用 entryOf，保留没有行/retention 后 null，且不额外限制 activity.group_id。这匹配现有读取语义。clock rollback 与 corrupt latest activity 测试/变异可以分别击穿 MAX(at) 和跳过 entryOf；不能 eager entryOf 而改变 run identity 与 activity 的拒绝先后。

### M6 body reuse、过滤与 race

replenish 的 group parse 位于 dispatchable/stopped/stop/blocker/pending/last-start 检查之前；只在原 nextClaimable 的归档检查点传入已读 body，保留 savepoint/stderr/顺序，符合最小替换。

pump filter 放在原 global blocker / missing handler / group blocker 之后、wake parse/handler 之前；三类 wake 合法归档时 deferred、仍 pending。坏 JSON/mark 记 unknown 并走原 handler 路径，符合原 authority 可见性。每次 handler await 完成后（true/false/throw）清空 map，及下一 pump 新建 map，能避免同步段缓存跨 await 失效；命名同 pump 更新场景和变异覆盖了这一点。

原 deliverScheduledStart 在 probe 前与 transaction 内均检查归档；最终 transaction guard 明确保留，并用 probe 期间 archive 的真实 race 击穿删除 guard，不能由入口过滤代替。其它 wake kinds 不增新规则。

### 测量范围与剩余成本

Task 1/2 通过 readControlSummary/readGroupSummary/readControlGroup、replenish、deliverSchedulerWakes/deliverScheduledStart 等真实入口测执行/prepare/rows/target parse；不把 schema 校验误称 JSON.parse、不把目标路径两条 batch SQL 描述为整页 SQL 总数。unused、scope、freshness、rowid、latest seq、entryOf、filter、invalid mark、await invalidation、final transaction guard 与 driver body 参数均有命名验收及独立 clone 删除变异。

规模约束要求同一 store 的 100 live × 50 task 合法 DAG，另 100 archived 组及其三类 pending wake；E/R/wake 数由构造后 manifest 测得，不能手填；live 组有可显示 current run/activity。修正后的 reset/incremental/empty 分支显式断言，不会以非空但错误模式过关。操作负载独立 fixture 或每样本恢复初态、各负载非空/实际 handler-probe-claim 观测及 digest gate，应落实到 harness，避免只剩 consumed wake 或未触达优化的空路径。

before 使用 D9/M3 完整收口后的真实 commit；同机/Node/SQLite、同 harness 与合法初态、10 warmup/30 bounded samples，计数与无 hook timing 分离。耗时为观测、计数为稳定门；拒绝 detail 与业务字段不删。仍存 group/full reset 线性扫描、pending wake 扫描、每组每同步段 archived body parse、stop/frozen/evidence/profile/estimate/契约等其它读取被明示，不以局部优化冒称消除所有 N+1。

## Evidence boundary

本报告只提供静态审查与文档修正复核；执行后的计数、mutation 红、normalized digest、p50/p95 及完整 gate 均尚待实施席真实运行。D9/M3 §9 新 live retry/source、人工 usageSettlement、handoff marker 等 authority 必须在其完整稳定树上重新核对，当前本席没有用在飞源码推断其已经通过。


## 更正采纳复核（2026-10-09，同审查席、同观察 HEAD）

本节为报告首次写入后的补充，原审查文字保留。controller 已将两条 Minor 纳入尚未发布的 spec/plan；本席通过 `rtk proxy python3 -c` 读取两份文档并核对相关文字：

- M1：spec §5 当前第 74 行、plan Task 1 counter 接口当前第 49 行，明确返回原 ControlStore 同一对象，只包 db/statement，不能 proxy/clone store 造成 transaction/projection WeakMap 身份失配。**M1 adopted/resolved**。
- M2：spec §5 当前第 74 行、plan Task 3 Step 2 当前第 97 行，明确 before/after 串行使用同一固定 repo/config/artifact 绝对路径命名空间及同一合法初态库/证据，可快照恢复，禁止各自 mkdtemp 改变业务 hash，禁止删除 hash 强行等价。**M2 adopted/resolved**。

最终结论：**Spec Approved；Plan Approved；Ready to execute: Yes, after D9/M3 完整收口并记录真实 before commit。** 当前无未解决 Critical、Important 或 Minor；运行时验收与收益仍待实施，原报告的证据边界保持。
