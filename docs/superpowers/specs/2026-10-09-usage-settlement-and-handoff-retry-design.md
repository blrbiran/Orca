# 人工结清未知用量与交接后的失败任务重试

归属：Codex controller，2026-10-09（Asia/Shanghai）。读码基线：Orca `c29676d6d0050d46b9cf61f45ffaee583f9dec76`；ccloop 固定 pin `ab824d16004de2d3c1613a76ec0431520aa16cc9`。本文件是新轮设计草案，等待人工审阅；未实施。

## 1. 人的裁定与验收目标

2026-10-09 人同意：D9 增加只有人能用的「结清未知用量」，把剩余额度全部记为已用；M3 让 `retry-task` 接受失败后经交接停止而结清的运行。issue-fixes 已全部完成并合并，本轮不重开其任务。

结果：模型崩溃且未报用量时，owner 可作一次保守结清，解除该运行造成的未知用量阻塞。任务重试仍受组预算和花费上限约束；结清不是免费重试。交接停止后的失败任务保留原因，并能选择从组分支当前 head 创建新运行。

只有 owner 的 Web 会话可作结清（沿用现有 human-only 权限表）；member、CLI/control socket 与 MCP 的 agent 主体均拒绝。性能 M5/M6 是下一轮，不混入本设计。ccloop 与 ccmem 产品和协议不变；不读取或修改人的实际控制库。

## 2. 方案选择

推荐独立命令结清，然后显式 `retry-task`。结清只改变账，不派发任务；owner 可以看清代价后决定是否提高组额度或重试。直接把结清塞进 retry 会让普通重试承担人工记账权限；自动把未知当零会少记用量，两者都不采用。

M3 推荐保留现有停止边界：停止期间先显示失败原因，使用现有 `resume-from-handoff` 清除完成的停止（不选择失败任务续跑），再显示 Retry task。它接受新的已结清失败状态。另一个选择是在停止期间直接 retry、但只将任务放回 ready；会增加 stopped/ready 的组合和按钮规则，本轮不采用。

## 3. D9 命令与前置条件

新 group-scoped verb `settle-unknown-usage`，路由 `/api/control/groups/:groupId/settle-unknown-usage`。复用 authority command 的 commandId、actorId、expectedRevision；payload 严格为：

```json
{"taskId":"a","runId":"run-a","generation":1,"acknowledge":"charge-remaining-grant"}
```

Web 只对当前失败任务提供此操作，确认文案展示将记入的 work/handoff 剩余额度，以及「这是保守记账，不是模型报告的实际用量；记账后不能撤销」。执行权限以服务端验证过的主体为准，不以 actorId 或 acknowledge 代替权限。

适用范围限定 Web task run：当前任务的 currentRunId、runId、generation、groupId、workItemId 必须相符；任务不是 done/continuing；run 为 active blocked，drive.blockedAt=C，drive.outcome 非 null 且非 succeeded。至少一个 unknown bucket 为 true。不接收估算、澄清、拆分或 legacy run；这些流程留在各自现有恢复路径。

命令要求 step C 保存的终止 report 及其隔离 stopProof：校验 artifact 的内容地址、candidate 身份、executionId/generation 与运行一致，terminal outcome 与 drive 一致，stopProof.isolated=true。不重新启动 provider，也不凭 UI 的失败文字判断进程已停。证据读取可在事务外进行；事务内必须复核运行、report 引用、highWater 和额度快照仍相同，改变则拒绝此次执行。

拒绝归档组、clarifying 组、未终止运行、非当前运行、任何仍为 ADOPTABLE 的 handoff request，以及 highWater 之后尚有 usage_events 的运行。组有 stop intent 时拒绝：先完成/清除停止再结清；本轮不让人工记账代替未完成的停止证明。已结清的新 commandId 拒绝，原 commandId 按台账原响应重放。

成功 result 为 `kind: usage-settled`，带 taskId/runId/generation/charged/at/method（额度由服务端计算），沿用 commandSuccess 的 revision/projectionSeq 与重放响应。新增错误码 `run-usage-not-settleable`（detail 为非当前、未终止、非支持的 task run）、`run-stop-proof-required`（证据缺失/不符）、`run-usage-pending`、`run-usage-settled`、`run-usage-not-unknown`；均有 en/zh 说明。迟到新用量事件也以 run-usage-settled 拒绝。复用既有 archive、stop、revision 和权限拒绝。

RunView 增加可选 `unknownUsageSettlement` 只读块：当前运行有未知用量时包含 generation、highWater、两个 bucket 的完整 remaining 与可操作状态/拒绝原因；结清后包含 usageSettlement 的 method、charged、at 与 principal。它不是客户端自报额度；命令只提交身份和确认，服务端重新计算。旧运行没有字段仍可读取。UI 在该 run 上提示当前未知状态；owner 看到确认入口，member 看到联系 owner 的说明。已完成停止且没有任务可选择续跑时仍提供「不选择任务、恢复派发」入口，避免让 D9/M3 的清 stop 前置条件成为隐藏的出路。

## 4. D9 记账、持久化与重放

「剩余额度全部」定义为该失败 run 的两个 bucket（work 与 handoff）的 remaining，在 tokens/activeMs/attempts/sessions 四个维度全部记入；不是整组的 explicitUnallocatedReserve，也不是仅扣未知 bucket。已知但尚未消耗的剩余额度同样保守记入，确认页逐 bucket 展示。该选择贯彻人的「剩余额度全部记为已用」，需随本文一起审阅。

同一 command transaction 中：

1. `delta[bucket]=run.remaining[bucket]`；`run.cumulative[bucket]+=delta[bucket]`，`run.remaining[bucket]=zero`，unknown 两格置 false。不减少既有 cumulative；既有超额与 breaches 保留。
2. `group.used+=sum(delta)`，`group.reserved-=sum(delta)`；沿用 recordUsage 对 task allocation 的处理，保留该 allocation 的 amount/state（这是冻结额度形状，不是 group.reserved 的数值镜像）；仅更新预算版本、proposal 的 reserve allocation 和 group.ledger。若原 allocation 为 continuing/retrying，也保持其已有额度与状态。其它运行仍未知时，group.ledger.usageUnknown 必须仍 true。
3. 每个非零 token delta 用该 bucket 的现有 usage source 记一行 usage_ledger：quality=unattributed，model/input/output/cache 皆 null，applied_at=结清时间。花费总量和当前日历周期因此计入；不虚构模型分布，也不回写历史日期。
4. run 新增可选 `usageSettlement` 记录：method=remaining-grant、commandId、principal（经过认证的 user 标签）、at、generation、highWater、charged（两个完整 Amount）、证据引用。新建 activity kind `usage-settled`，正文展示同一 charged 和 method。command ledger、run、activity、usage ledger 和预算镜像一起提交或回滚。

为保证旧版不继续处理带人工结清记录的运行，控制库升为 schema 10（单向，v9→v10 无新增表，只更新版本）；v1–v8 先走现有迁移，再进 v10。新 reader 接受没有 usageSettlement 的旧运行，并严格校验出现时的结构。旧版 Orca 必须拒绝 schema 10。

不把人工结清伪装成 provider usage event，不推进 provider highWater。`recordUsage` 在原事件的幂等重放判断之后拒绝带 usageSettlement 的运行上的任何新事件（含迟到报告），防止真实报告将保守记账再算一次或把 unknown 改回来。重启、结清命令丢响应、相同 command 重送，均只记一次。零 token delta 不新增 usage_ledger 行，但仍记录结清方法与活动。

结清后保持 blocked/active，不自动 retry、settle 或 arm wake。它仅解除未知用量；后续 retry-task 以现有失败路径结清旧运行、恢复 task grant。剩余额度已经全记用，新运行必须从组 reserve 重新取得整份任务 grant；不足时给出现有 group-reserve-insufficient 出路，owner 决定是否加额度。

## 5. M3 失败运行的重试

新增可重试状态分支：inactive `settled-recoverable`、任务为 held 且仍指向此 run、drive.outcome 非 null 且非 succeeded。必须有该 run 已结清的 handoff request；不把成功后的 recoverable run、普通中断、旧 lineage、already retried、pending continuation 或 succeeded/out-of-bounds 当失败重试。既有 active blocked-at-C 分支保持原条件。

保留全部停止、归档、未知/待应用用量、组状态和预算守卫。UI 在停止存在时持续显示失败原因，并用现有「不选择任务、恢复派发」路径退出 handoff-complete；停止清除后，为该失败任务显示 Retry task。handoff-partial/unresolved 不承诺现在可重试，不放宽 resume-from-handoff 的完成条件。

inactive 分支采用失败 run 自己的 claim grant 作为新运行 grant。交接停止已经把 work.grant 改为旧 run.remaining，不能直接复用那份缩小的额度。命令在同一事务中释放 held allocation 的 remainder，再从组 reserve 预留 run.grant，把 work.grant 恢复为 run.grant、allocation 状态和 amount 设 retrying/grant、task 改 ready、旧 run 改 settled-failed，currentRunId 仍保留至下一次 claim。短缺为 grant−held remainder−explicit reserve，逐维拒绝，不能扣两次 commitment。

新的 allocation state `retrying` 表示已为重新执行预留额度；不冒充 held、continuing 或最初 confirmed。它进入 allocation schema/视图枚举/本地化，`frozenAllocationShape` 只省略该状态 task 的 amount，其余身份、provenance、bucket 与冻结快照仍严格相等。`work.retryGrantSourceRunId` 持久绑定本次失败 predecessor（同 group/task/workItem、在 lineage 内、已 settled-failed 且 outcome 非成功），两个 allocation.amount、work.grant 必须与该 source 的 run.grant 逐维相等，冻结 reader 与 driver contract reader 均校验；不能仅放松快照比较而不校验 live grant。ready 时 currentRunId 指 source；下一次 normal claim 更新 currentRunId 后仍保留 retrying/source 与相同 grant，直到正常 held/continuing/terminal 转移。随后 active retry 保留已有 allocation state/amount，必要时更新 source 到刚失败的 run；普通 active confirmed 重试保持原行为，不改成 retrying。明确 work.pendingRunId 为 null 才允许 M3 重试。work.continuation 可为空，也可为已经由当前失败 run 消耗的历史注册：后者须注册 pendingRunId 等于当前 runId，已有 run 同 group/task/workItem，continuationIntentId、claimOrdinal 与注册一致，lineage 包含该 run；仅检查 run 存在不够。未消耗或身份不符的注册拒绝。retry transaction 只清除这份已消耗的 work.continuation，原 run/checkpoint/wake 中的历史身份仍保留，不使旧 wake 重新 claim，也不静默丢弃尚未开始的续跑。

旧运行的 cumulative/remaining、失败 outcome/stopReason、checkpoint 和 startedAt/endedAt 保留；原 endedAt 不重写。复用已有 `task-retried` 活动与失败清理路径，不生成第二个 provider 调用。下一轮 normal dispatch 从组分支当前 head 派新 run，不继承失败 checkpoint；原 checkpoint 仍可查看，但该任务改为 ready 后不可再通过 Continue 注册旧 predecessor。

`runReasonText` 以非成功 outcome 作为失败原因的判断依据（state 不再是唯一判断），显示 stopReason，缺失时回退 blockedReason；成功、普通中断不得被错误标为失败。前后端的 Retry 判断覆盖新的 inactive 分支。

停止完成时，在现有批量 Continue 旁明确提供「恢复派发，不续跑任务」（selections=[]）入口，失败原因附近指向此入口和随后 Retry task。批量 Continue 仍允许人选择失败 checkpoint 续跑，不移除旧能力；文案区分「从 checkpoint 继续」和「从组 head 重做」。D9 不修复 already handoff-partial/unresolved 的未知用量运行：其请求/状态不满足本命令条件，界面必须写明先解决未结清停止，不能暗示按钮能解除任何未知状态。本轮原始 D9 的可达路线是失败 blocked 时结清，不先 handoff。

## 6. 文件与接口落点

- 服务端：新 `src/control/settleUnknownUsage.ts`；webProtocol、control service/authority/路由、humanOnly；usage、usageLedger、budget、migrations、activity；retryTask、executionSnapshot 的 live retry allocation 校验、必要的 run/work/read model schema。
- 前端：authority wire types、command/action recovery、runFacts、ControlGroupView/任务详情、activity rendering 与 en/zh 文案。遵循当前 owner/human-only 控件边界。
- 文档：新轮 ledger、CLI/MCP 的 verb 分类与说明、schema 升级说明。CLI/MCP 能识别 verb，但真实 socket 执行仍 403，不能加旁门直接调用 DB。
- 没有新的仓库外写入方；沿用 control store 路径、证据存储和权限。所有测试用隔离 HOME/XDG/控制根，不重启人的面板或 ccmem daemon。

## 7. 可执行判据与变异

新增测试文件：`tests/control/settleUnknownUsage.test.ts`、`tests/control/handoffFailedRetry.test.ts`、`tests/control/schema10.test.ts`、`tests/panel/settleUnknownUsage.test.ts`、`web/tests/settleUnknownUsage.test.tsx`、`web/tests/handoffFailedRetry.test.tsx`。测试实现应覆盖下列可测契约，不靠仅读测试自己写入的初值：

| 契约 | 必须看到的结果 | 在独立 clone 删除的分支 |
|---|---|---|
| unknown codex failure，含既有部分用量 | group/run/allocation/proposal/usage view 一致；新增量恰等 remaining；冻结 allocation 形状保留 | 删除一处扣款、reserve 镜像或 usage ledger 写入 |
| 一个 bucket 已知、另一个未知；其它 run 未知 | 两桶 remainder 全记；整组仍未知直到其它 run 结清 | 仅扣未知桶、直接清 group usageUnknown |
| 隔离证明缺失/identity 错/未停/非当前/请求未结/事件 pending | 拒绝且预算、usage/activity、任务无业务变化 | 各删该条件 |
| owner/member/socket agent | owner 成功；后两者 403，无结清副作用 | 从 humanOnly 分类移除新 verb |
| 命令重放、事务失败、重启后重放、迟到用量 | 只记一次；失败完整回滚；迟到事件拒绝，原事件重放不变 | 删除 marker/重放判断或事务保护 |
| M3 的真实失败→handoff stop→完成→清 stop→retry | 失败原因一直可见，旧 run 结清、新 task grant/commitment 正确，新 run 从组 head 起 | 去掉 inactive 分支、grant 恢复、retrying 来源/额度校验、原因分支 |
| M3 reserve 不足/未知/请求未结/stop/归档/旧 lineage/continue 已注册 | 拒绝；成功、普通中断、已 done 运行不出现失败重试按钮 | 各删该条件 |
| schema 9→10 与旧运行 | 旧数据 preserved、旧版拒绝 10、新 reader 正常 | 删除版本提升或可选字段兼容 |
| 失败 continuation 的 reduced claim grant | 经 M3 后，group view/driver contract 仍通过；下一次 claim、人工结清与第二次重试也通过 | 将 retrying 改 confirmed、删 live grant/source 校验 |
| consumed continuation vs pending/mismatched 注册 | 真实已 claim 失败 continuation 可重试；未 claim 或身份不符拒绝；历史 wake 不再 claim | 把 continuation 非空一律拒绝，或跳过 consumed 身份校验 |

每条新分支的删除变异需在独立 clone 看到相应判据红；未提交产品文件先字节同步入 clone。门的 ccloop clone 与变异 clone 分开。

验证命令（新增文件完成后）：`npm run build --workspace web`，`npm run typecheck`，`node_modules/.bin/vitest run tests/control/settleUnknownUsage.test.ts tests/control/handoffFailedRetry.test.ts tests/control/schema10.test.ts tests/panel/settleUnknownUsage.test.ts`，`npm run --workspace web check`，`npm run verify:control`，`npm run verify:panel`，`npm test`，`node scripts/check-tmp-leak.mjs`。每段保留完整输出、真实退出码与观测 commit；`ORCA_CCLOOP_BIN` 必须是 ab824d1 clone build 的绝对路径。不得把已登记 timeout 当断言失败豁免。

现有判据的必要改写候选（具名，本文审阅包含这些设计提案）：`tests/control/schema9.test.ts` 的 “a fresh store is version 9 with the activity table: STRICT, group-referencing, both indexes” 与 “a populated version-8 store upgrades in place: every existing row kept, the activity table added and empty” 更新最终版本期望为 10，保留 STRICT、FK、索引与旧行不丢等原断言；“refuses a version-10 store and leaves its bytes unchanged” 的 future-version 改为 11，保留字节不变证明。测试文件可保留原名，其旧注释按发布文字规则追加具名更正。command verb/route/activity kind/allocation state 的封闭集合计数需在 plan 前逐条指名。本文批准不自动授权未知名字的测试改写。仍编码有停止就拒绝的既有 retryTask 判据保持不动，新分支用新增判据覆盖。

## 8. 审阅与实施边界

先 subagent 审设计，再由人审阅本文件；批准后才写 implementation plan，并按人指定 subagent-driven 执行。性能轮另开 spec/plan，不挤入本轮。不得推送、合入 main 或再删除未点名分支；已经获授权的旧 worktree 清理在独立记录中结清。

## 9. 独立审查后的更正（2026-10-09，controller，观测提交 59f6c8e）

本节优先于 §3–§8 中与其冲突的文字。原稿保留为历史；依据 `independent-spec-review-3.md` 的 I1–I3 与 controller 源码核对。人随后明确授权：修复设计问题、进行 plan 并以 subagent-driven 完成这一轮，执行中的问题先按 controller 建议处理，最后统一审核。因此本轮在设计/计划 subagent 审查通过后按该授权执行，不另停在中间人审门；功能范围仍是 D9/M3，M5/M6 留作下一独立性能轮。

### 9.1 I1：实际执行策略受当前 claim grant 限制

`executionDriver.ts` step A2 构造真正送给 port.accept 的 task start envelope 时，统一使用 `withinGrant(confirmed.contract.executionPolicy, run.grant.work)`，适用于 normal/continuation claim、active retry、M3 reduced-grant retry 和 no-start 重派。三个上界分别为 min(冻结策略, claim grant)：tokenBudget/tokens、maxAttempts/attempts、totalRuntimeBudgetMs/activeMs。grant 与冻结策略均不改写，derivedContractHash 保持冻结值；普通重做从组 head 起且 inputCheckpoint=null。原额度不小于策略时结果相同。sessions 仍沿用 claim/attempt admission，不能从这里虚构 ccloop policy 字段。

判据必须捕获实际 port.accept envelope，而不止检查 reader/claim：造 reduced-grant 的真实 continuation 失败，经 retry 后正常派发；分别断言上述三个维度已缩小、frozen hash 不变、null checkpoint、base 为组 head。继续覆盖一次 active retry 与一次 invalid-first-attempt 后的重新 claim；删除 A2 的统一 clamp，相关断言必须红。

### 9.2 I2：已交接失败的未知账也有结清出口

保留 active blocked-at-C 的 D9 分支，并增加 **released** 分支：当前 Web task run 为 inactive settled-unrecoverable，work 为 blocked、allocation 两桶均 terminal、work.grant 与 run.grant 相等；非成功 drive.outcome、可验证的终止 report 与隔离证明满足原命令要求；该 run 的 latest handoff request 为 settled-unrecoverable，唯一失败原因为 usage-unsettled。允许组已有 handoff/shutdown stop（不允许 pause）；自己的 request 已结，不是 ADOPTABLE，其他 run 的 open request 不阻止对本 run 结账。归档、pending usage、过时 run、证据不符仍拒绝。

除 report 外，released 分支还验证该 request 关联 checkpoint 的内容地址、group/task/run/generation/highWater、非成功 terminalOutcome、stopProof、所有 artifact、snapshot，以及 missing=[]、unresolvedRequestIds=[]。重新计算原 handoff 的拒绝原因，仅有 usage-unsettled 才接受；不凭 failureCode 字符串认为其它证据成立。缺 snapshot/artifact/隔离证明或未知执行仍拒绝，不能以人工扣款掩盖它们。

两分支共用 charged=旧 run.remaining（两桶四维）的累计用量、unattributed usage ledger、marker、activity 和事件迟到守卫。marker 增加 `reservationDisposition: committed | released`；released 还带 handoffResolution={requestId, previousState, previousFailureCode, checkpointId, checkpointHash}。两种 group 账变化明确不同：

| 结清前的承诺 | group.used | group.reserved | allocation/work.grant |
|---|---|---|---|
| active blocked，remaining 仍占用 | 增加 charged 合计 | 减去 charged 合计 | 保留 |
| 已 settled-unrecoverable，remaining 已释放 | 增加 charged 合计 | 完全不变 | 保留 terminal 和原 grant |

结清必须能如实记入即便组/账户额度已经不足；重新计算 reserve/deficit，不从其它任务 commitment 借扣，不拒绝记账以隐藏超额。其它 run 仍未知时 groupUsageUnknown 仍真；下一次派发仍受 cap。历史 breaches 保留，不伪造 usage eventSeq。

增加 handoff request 的 terminal state **settled-failed**，仅人工 D9 的上述 released 分支能从 settled-unrecoverable 转入。request 保留原 failureCode/evidenceIds/identity，run 同事务变 settled-failed、active=false、recoverable=false，保留原失败理由/checkpoint/endedAt，task 仍 blocked，allocation 仍 terminal，不自动 retry/arm wake。marker 给出这次显式人工处理的证据，不标为 settled-recoverable 或 settled-restartable。

该 request 状态的含义为“已隔离的失败运行，未知账由人保守结清；本次停止已收口，可另行重试任务”，不表示 checkpoint 可续。request reader、wire types、视图和双语文案接受它，并核对与 run.usageSettlement.handoffResolution 的关联；不能凭任意填入该状态解除停止。它是 SETTLED 而非 ADOPTABLE。复用 deriveStopState 的完整 frozen run 集重算：其它 run 未决/不可恢复时仍保持原 blocker；全收口后才 handoff-complete。不直接清 stop、不更改 resume-from-handoff 仅接受 complete 的条件。没有 stop intent 时仅保存结清结果；重放不会重复改 request 或 charge。

这个转换须由 D9 的专用事务完成，**不得再次调用 terminaliseRun/releaseCommitment**。provider-driven HandoffDisposition 不增加这一人工结果，避免普通 settle 接口绕过 owner/marker 或重复释放。已有 handoff report/checkpoint/未知事件和 request outbox 原字节保留；request 最新 body 的人工修正可由 marker 回溯。既有清理机制允许处理新 settled-failed run，但不得补写第二笔用量或重新派发。

UI 对此路径的 owner 显示结清入口和金额；成功后显示“保守结清，失败任务可在恢复派发后重试”，failure 原因持续可见。继续入口不选择该 settled-failed run；组 complete 时可 selections=[] 清 stop，随后 retry-task。若其它 run 挡住 complete，展示其具体 blocker，不声称整组已解锁。

M3 增加第三种来源：当前 inactive settled-failed、work blocked、terminal allocation，且带上述有效 released D9 marker 与 settled-failed request，尚未重试。清 stop 后从 reserve **全额**预留 run.grant（此前已释放且手动记用；held remainder=0），不再释放 remaining；不足逐维拒绝。成功将 work.grant 设 run.grant、allocation 设 retrying/grant、work ready、source=current run，并记录 task-retried；第二次同命令重放幂等、新 commandId 在 ready 状态拒绝。普通 retry 已产生的 settled-failed/ready run 没有这一 admission，不会被重试两次。

### 9.3 I3：retrying/source 覆盖无 provider 的完整生命周期

§5 的“ready 时 currentRunId 指 source”只描述 retry transaction 刚结束的状态，不是所有 ready 的不变量。currentRunId 始终指按现有 run row 顺序确定的最近运行，lineage 保留全部身份；不能改回旧 source。

共享的 live retry reader 校验 source 属于同 group/task/workItem、在 lineage 且按 run row 顺序不晚于 current、已 inactive settled-failed 且 outcome 非成功，work.grant/两个 retrying allocation.amount/source.grant 逐维相等，冻结身份/provenance/hash 原样。若 current 不是 source，它和 source 之后的每次重派均须是同一 task 的 normal claim（continuationIntentId=null）、grant=source.grant，保留现有 agent/target/hash/claim 身份校验。历史中间 run 必须是 inactive failed-before-provider 或 settled-restartable、cumulative 四维皆零、remaining=grant、unknown=false 且无 pending usage；current 则按下表校验。claimOrdinal 可升，不要求 providerAttemptOrdinal=0（invalid proof 本身会增加它）。不能以合法状态名容纳身份/额度漂移。

| task/allocation | current run 与来源 | 承诺与下步 |
|---|---|---|
| ready/retrying，刚 retry | current=source，inactive settled-failed | 已预留 grant；下一次 claim 不再扣 commitment |
| running 或 blocked/retrying | 最新 normal claim，active，状态沿用生产 driver；grant=source.grant | 继续本 run；未知账仍挡后续派发 |
| ready/retrying，invalid first proof 后 | 最新 inactive failed-before-provider、明确未调用 provider、零 cumulative/完整 remaining | 保留 source/grant；既有 no-start wake 重派，不再预留 |
| ready/retrying，provider 前交接后 | 最新 inactive settled-restartable、有效已结 request、零 cumulative/完整 remaining | 保留 source/grant；先 complete→清 stop，再正常 claim，不再预留 |

active retry 再失败时，retry-task 可将 source 更新到该失败 run，预算仅按本次 grant−remaining 预留差额。这些 no-provider 转移不清 source、不改 confirmed、不另发 task-retried 活动。正常转入 held/continuing/terminal 时原预算/快照规则恢复，并在同一事务移除 live work.retryGrantSourceRunId；run/history 不删除。下一次 M3 可以重新绑定新 source。所有 work writer 与 shared reader 都须覆盖这些转移，不能只改 applyRetryTask。

### 9.4 新增落点与验收补充

§6 增加 executionDriver 的 A2 clamp、stopIntent 的人工失败 request 读取/deriveStopState/专用收口事务、controlViews 的 handoff marker 校验、continuation 的 Continue 排除与 live source 清理，以及 webDispatch 的 no-start/read source 校验。新增字段仍受 schema 10 单向版本门保护。§7 的测试文件可复用，下面用新增具名场景补齐，不改原测试来豁免失败：

| 新场景 | 观测与删除变异 |
|---|---|
| reduced retry / active retry / no-start retry 的真实 accept envelope | 三个策略维度均受 claim grant 限制，null checkpoint、组 head、冻结 hash；删除 clamp 见红 |
| failure+unknown→真实 handoff-partial→D9→complete→空选 resume→retry→claim | 没有永久未知账 blocker；released 结账不扣其它任务承诺；旧 checkpoint 不可 Continue；删除 released admission、人工收口或 retry 分支分别见红 |
| 另一 run 仍未知/请求未结 | 本 run 结清成功但组仍被正确阻塞；删除完整 frozen 集重算或 unknown 扫描见红 |
| snapshot 缺失、artifact 不符、未知执行、pending events、伪造人工 request state | 拒绝且业务写入零变化；逐个删除证据/marker 校验见红 |
| released 结清超过 reserve | used 增加、reserved 不变、deficit 如实出现；不给免费的新 retry；删除 reservationDisposition 分支见红 |
| M3→claim→invalid proof→view/重启/再 claim | source 未误判、current 是最新 run、grant 正确、reserved 不再增加；删除 no-start reader 支持见红 |
| M3→claim→pre-provider handoff-stop→complete→空选 resume→view/重启/再 claim | settled-restartable/retrying 保持可达且不重复预留；删除 restartable reader 支持见红 |
| total/week/month cap 与周期边界 | D9 unattributed 计入结清时的日历周期；下一次 retry claim 受各 cap，已超额结账仍可成功；删除 ledger 写入或 claim cap 守卫见红 |

Self-review 责任：确认人工状态只能由 owner 结清事务产生；所有 reader/closed enum 与持久 writer 成对覆盖；未知账从 reserved 已释放的事实由合法 handoff 历史、terminal allocation、request/checkpoint/marker 共同约束。静态审查不等于这些验收已通过；实施后逐条记录实测与变异证据。

### 9.5 复审补充：结清后再交接（controller，2026-10-09，产品基线 c29676d）

有效的人工 usageSettlement 必须在 hasObservedUsage 的所有调用者中被视为“账已结清”，即便 provider 没有为两桶各报一条 non-null usage event。共享校验须严格核对 marker 的 run/generation/highWater/charged/证据身份、unknown=false、remaining 两桶四维为零；pending seq>highWater 仍拒绝，stopProof 与 checkpoint/artifact 守卫照常独立生效。不写伪造 provider event，不推进 highWater，也不再次记用量。

新增判据 active failure+unknown→D9→handoff-stop→handoff-complete→empty resume→retry→claim；结清后已有 report 的 usage 事件重放保持幂等，迟到新事件拒绝。handoff 可按现有完整 checkpoint 规则结为 settled-recoverable（此时 held remainder=0），M3 恢复原 run.grant、从 reserve 全额预留。缺 snapshot/artifact 或未知执行仍不得因此恢复。删除 hasObservedUsage 的有效人工 marker 分支，该顺序判据必须红。
