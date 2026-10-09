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
