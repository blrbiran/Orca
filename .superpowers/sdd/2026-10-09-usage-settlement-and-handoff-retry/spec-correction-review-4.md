# Usage settlement / handoff retry：§9 独立设计审查 4

归属：Codex subagent `/root/review_design_correction`；2026-10-09（Asia/Shanghai）。受 controller 派发进行静态独立审查；未继承旧审查结论，未读取旧审查报告。

审查对象：`docs/superpowers/specs/2026-10-09-usage-settlement-and-handoff-retry-design.md` 整份原稿与追加 §9（§9 优先）。产品基线 `c29676d6d0050d46b9cf61f45ffaee583f9dec76`，初始派发 HEAD `59f6c8e0bd02cd86a11855963d419230233286ab`。审查中 `rtk proxy /usr/bin/git rev-parse HEAD` 观测到 `a08c7633147939f62c98aaf9b0c0fa206a4a51ca`；`rtk proxy /usr/bin/git diff 59f6c8e0bd02cd86a11855963d419230233286ab HEAD --stat` 显示仅 design §9 与 progress 文档提交，controller 确认产品未改。ccloop pin `ab824d16004de2d3c1613a76ec0431520aa16cc9`。

方法：先读 `/Users/biran/.codex/RTK.md`、`CLAUDE.md`；全部 shell 经过 `rtk proxy`，git 使用 `/usr/bin/git`。通过 `rg` 与逐行源码读取核对 immediate callers、持久 writer、严格 reader 和冻结身份。行号由 `rtk proxy python3` 读取当前文件并枚举得到，观测提交为上列 `a08c763`。未运行 suite、模型、服务或真实控制库；未改产品、测试、spec、已有台账、索引、HEAD 或分支。本报告是唯一新增文件。

## 结论

**Ready for plan：No（按本次读到的 §9）**。Critical：0；Important：1；Minor：0。§9.1、§9.2 的 released 记账以及 §9.3 的 source/no-provider 设计均可在现有结构内实施，未发现另外的设计阻断。仍须补齐 active D9 结清之后再 handoff/shutdown 的用量结清判断，避免重新生成不可退出的 partial；该更正落入 spec 并审查后可以进入 plan。

controller 在收到本发现后表示将追加 §9.5，使有效 manual marker 能通过所有相应的 usage-settled 判断。本报告保留对已读 §9 的发现；未将尚未读到的未来更正计作已通过。

## Important I1 — active D9 后再交接，会被 provider-only 的 observed-usage 条件重新锁进 partial

**设计位置**：spec §3 行 29、33（至少一桶 unknown；已结清的新 commandId 拒绝）、§4 行 45、52、54（清 unknown，保留 active blocked，不生成 provider usage event）、§9.2 行 118、131、139（released admission；只有 released D9 能产生人工 settled-failed；M3 第三种 admission 必须有 released marker）。§9.4 行 163 的新路径仅覆盖“先 handoff，后 D9”，没有覆盖相反顺序。

**源码位置**：`src/control/budget.ts:156–161` 的 `hasObservedUsage` 仅扫描 `seq<=highWater` 的真实 `usage_events`，要求 work/handoff 都曾有非 null cumulative。`src/control/driverHandoff.ts:271–279` 在失败 blocked run 上复用保存的 report，进入 `settleHandoffCheckpoint`；后者在行 338–348 使用 `!hasObservedUsage` 生成 `usage-unsettled` 并选择 settled-unrecoverable。`src/control/stopIntent.ts:780–784` 随后将 task 设 blocked、allocation 设 terminal，并释放 remaining；行 247–258 从该 request 得到 handoff-partial。`src/control/continuation.ts:216` 只允许 complete 清 stop；`src/control/retryTask.ts:48` 保持有 stop 就拒绝的守卫。

**可达反例（只靠本轮已授权操作）**：

1. 一个 Web task 的 provider 失败，step C 保存 terminal report 与隔离证明；至少一桶只有 null cumulative 事件，另一桶可有已知部分用量。它是本设计支持的 active blocked-at-C D9 输入，artifact/snapshot 完整、无 pending events。
2. owner 成功执行 active D9：remaining 两桶归零，cumulative 增加原 remainder，unknown 两桶 false，marker 的 reservationDisposition=committed；真实 usage_events/highWater 原样保留。至少一桶仍没有非 null provider cumulative，因此 hasObservedUsage 依然 false。
3. 在显式 retry 前，owner 发起 handoff-stop，或者 panel 发起 shutdown stop。D9 刻意不自动 settle，因此该 active run 会被 freeze。closeBlocked 从原 report 建 checkpoint；即使所有其它证据成立，也仍因 hasObservedUsage=false 判 usage-unsettled，转 inactive settled-unrecoverable，组变 handoff-partial。
4. 此时无法再走 released D9：unknown 已 false 且人工结清已存在，新 commandId 要拒绝；原 commandId 重放只返回首次结清响应，不收口新 request。M3 的 active、recoverable、released settled-failed 三种来源均不接受这个状态；有 stop 也拒绝 retry；resume-from-handoff 又要求 complete。因此原本已经解决的未知账重新形成无正常出口的停止 blocker。

同一反例也适用于已进入 retrying 的 active run 在 D9 后交接。remaining 为零使再次 releaseCommitment 数值为零，并不能消除状态死路。

**自反驳结果**：如果两桶在更早的事件中都曾有非 null cumulative，hasObservedUsage 会 true，反例不成立；但 spec 明确支持未报告用量/至少一桶未知，这个较窄输入完全可达。§9.2 对“先 handoff 后 D9”增加了出口，并未改变 provider-only 结清条件或处理 committed marker 已存在的反向顺序。不能将“marker 严格 reader 校验”解释为 hasObservedUsage 已自动支持它；调用者现在是具名的硬守卫，设计需明确其新语义。

**所需更正**：定义供失败 run 用量结清判断共享的 predicate，接受经过完整身份/结构验证的 manual settlement marker，并保留 unknown=false、当前 generation/highWater、无 pending usage、terminal report 与 isolation proof 等独立条件。可以保留 hasObservedUsage 的 provider-only 含义，另增加 accounted/settled predicate；也可以具名更改其语义，但必须清楚区分人工保守结清与 provider observation。active marker 后的正常 handoff 应能收口，且不能再次 charge、生成虚假 usage event、推进 highWater 或绕过 checkpoint 证据。落点至少核对 `driverHandoff.ts:340`、`budget.ts:168`、`checkpoints.ts:85` 的 usage settlement 判断；明确适用范围，避免给 estimate/requirement/legacy 旁门。

新增真实链路判据：“失败 + 一桶从未观测非 null 用量 → active D9 → handoff/shutdown → complete → selections=[] 清 stop → M3 retry → normal claim”。观测费用恰好结清一次、provider highWater 不变、没有新 usage event、proof/pending 守卫仍生效、source/grant/新 accept envelope 正确。删除 manual marker 的共享结清 admission 必须使此链路红。另覆盖 marker 身份不符、仍有 pending event 与缺隔离证明不能被该 predicate 放行。

## 其余独立核对结果

### 实际 accept 策略

`executionDriver.ts:304–310` 负责真正的 start envelope，`stepB` 行 449 将已存 envelope 送 port.accept；现有 clamp 仅在 continuation 时开启。§9.1 改为 task A2 统一 clamp，恰好覆盖 M3 normal retry、active retry 与 no-start 重派，保留冻结 derivedContractHash，并与 `startEnvelope.ts` 的 contractHash 传递规则相容。安装的 ccloop 编译产物 `dist/src/controller/runLoop.js:180–182` 从实际 contract.executionPolicy 初始化 attempts/time/token 三个预算，证实验收必须观察 accept envelope。sessions 没有新增 policy 字段的要求合理。正常 claim 的 checkpoint=null/组 head 与 continuation 的 predecessor base 区分可由当前 A2 构造路径保持。

### released 记账与人工 request 收口

`stopIntent.ts:780–784` 确实已释放 settled-unrecoverable 的 remaining，因此 §9.2 的 group.used += charged、reserved 不变是正确账务分支；再次调用 terminaliseRun/releaseCommitment 会重复释放，禁止它必要。`budgetBalance` 支持 reserve=0/deficit>0，`syncWebBudget` 能重算其它 run 的 unknown，因而“已超额仍如实结账”可实现。严格 revalidate checkpoint/report/proof/snapshot/artifacts 与仅 usage-unsettled 的理由，能防止把其它失败伪装为人工可结清。

人工 request settled-failed 与 provider-driven HandoffDisposition 分开，避免 ordinary settle 路径重复扣款/释放。reader 与 deriveStopState 校验 marker 关联，再按完整 frozenRunIds 推导 complete，能保留其它 run 的 blocker。`continuation.ts:141–148` 的 predecessor 只接 settled-recoverable/held，新的人工失败 run 明确不能 Continue。released M3 全额预留 run.grant、不再释放 remaining，与已释放账一致。I1 不否定这条“先 handoff 后 D9”路线。

### retrying/source 与 no-provider 生命周期

当前 `controlViews.ts:632–638` 用 rowid 校验 current 是最近 run，§9.3 保留这个不变量，未回指老 source。`webDispatch.ts:370` 的 normal claim、行 386–413 的 invalid first proof，以及 `stopIntent.ts:761–778` 的 normal pre-provider restartable，会分别形成所列最新 active/failed-before-provider/settled-restartable 状态。中间 run 的 normal claim、同 grant、零 cumulative、完整 remainder、无 unknown/pending 约束足以区分本轮重派历史与已经消费额度的失败历史；providerAttemptOrdinal 可增长的例外符合现有 writer。

进入 held/continuing/terminal 时去掉 live source，恢复既有 amount 比较规则；下一次 M3 再绑定新的 failure source，能处理 continuation 失败后的 reduced claim grant。§5 对 consumed continuation 的 pendingRunId/runId/intent/ordinal/lineage 约束，与 `createStartingRun` 把 work.pendingRunId 清 null 而留下历史 registration 的实际 writer 相符。清注册但保存 run/checkpoint/wake 历史，不会使旧 wake 重新 claim。plan 必须逐个落实这些具名 writer 和共享 reader；此处未把设计要求当作已实现。

### 权限与持久身份

`controlApi.ts:440–452` 在业务解析/执行前使用 authenticated principal 做 permissionRefusal，并将 `principalLabel` 放入 command context；`permissions.ts` 的 owner/member/agent 表和 `humanOnly.ts` 的封闭 verb 表适合新命令。actorId 与 acknowledge 不成为权限证据。控制 socket 永远走 agent 主体，owner Web 是唯一已有授权入口。现有 command ledger 和 store transaction 可容纳一次性 marker、费用、activity 与 request 修正，schema 10 单向门能阻止旧 reader 继续处理新字段。封闭 enum/route/verb/activity/state 判据的具名清单仍须按 spec §7 在 plan 前完成；本报告不授权改写未指名的旧测试。

本次只作静态可实现性与可达性审查；没有实测/变异通过声明。
