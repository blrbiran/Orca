# 独立设计审查 3

作者：Codex 独立审查 subagent `/root/fresh_independent_design_review`。日期：2026-10-09，Asia/Shanghai。
产品基线：`c29676d6d0050d46b9cf61f45ffaee583f9dec76`。被审草案提交：`79b7495edb07f003d472c80e41854ecb5c924619`。草案：`docs/superpowers/specs/2026-10-09-usage-settlement-and-handoff-retry-design.md`。ccloop 证据固定于 `ab824d16004de2d3c1613a76ec0431520aa16cc9`。

本审查未读取前轮审查报告或讨论，也未预设结论。按 RTK.md、CLAUDE.md 作静态源码与直接调用者审查；未执行测试、模型、真实控制库或服务，未改产品、测试、索引、HEAD、分支或草案。唯一新增文件为本报告。

**Ready for human spec review：With fixes。** 这不是 ready to merge。核心方案能实现，但有两处实质行为缺口和一处新状态生命周期契约需要先明确。

## Critical

无。

## Important

### I1 — reduced grant 的普通重试必须同时缩小实际派发的 executionPolicy

草案 §5（第 62–66 行）让失败 continuation 经 M3 后按其较小的 claim grant 重做，并走 normal dispatch、不继承 checkpoint。账与 reader 相等尚不足以约束实际执行：生产 [executionDriver.ts:269](/Users/biran/code/skills/loop/Orca/src/control/executionDriver.ts:269) 只把有 continuationIntentId 的 run 当 continuation，[第 304–306 行](/Users/biran/code/skills/loop/Orca/src/control/executionDriver.ts:304) 只在 `continued !== null` 时调用 withinGrant。normal claim 将 continuationIntentId 设 null（[webDispatch.ts:361](/Users/biran/code/skills/loop/Orca/src/control/webDispatch.ts:361)），因此这个新重试拿到的是原冻结契约中较大的 tokenBudget/maxAttempts/totalRuntimeBudgetMs。生产代码自己的 [withinGrant 注释及实现，第 380–387 行](/Users/biran/code/skills/loop/Orca/src/control/executionDriver.ts:380) 明确说明 ccloop 按 contract 花费；固定 pin 的 `ccloop/src/control/worker.ts:233–239` 直接把 envelope.work.contract 交给 runLoop。

结果：小 grant 的新重试可按原始较大策略执行，突破所重新预留的承诺与 cap 计算依据。草案 §7 reduced-grant 行只要求 view/driver contract reader/claim/后续结清通过，现有 fake 若不检查 envelope policy 会全部通过。

**修订要求：** 规定普通 retry 的执行策略也受该 run 的实际 grant 限制，适用于 reduced-grant、再次 active retry 和 no-start 后重派；保留原冻结合同/derivedContractHash、组 head 与 null checkpoint 的语义。具名登记 executionDriver 的派发落点，并增加读取真正送到 port.accept 的 envelope 的判据，同时检查三个策略维度。删除该 retry 限制的变异必须红。此要求补齐本轮新派发分支，不要求重做已完成的 issue-fixes。

### I2 — D9 的 post-handoff 排除会留下已有失败运行的永久未知用量阻塞

草案第 29、33、70 行明确排除 inactive、有 stop intent、handoff-partial/unresolved，要求“先解决未结清停止”。这不是所有已失败 run 都能走的前置步骤。具体可达反例：一个终止且有隔离 proof 的 Codex failure 用量未知，owner 先执行 handoff-stop；[closeBlocked，第 278–279 行](/Users/biran/code/skills/loop/Orca/src/control/driverHandoff.ts:278) 用已有 report 结交接；[第 338–348 行](/Users/biran/code/skills/loop/Orca/src/control/driverHandoff.ts:338) 因 usage-unsettled 把 run/request 结为 settled-unrecoverable。[stopIntent.ts:780](/Users/biran/code/skills/loop/Orca/src/control/stopIntent.ts:780) 将 task 置 blocked、allocation 置 terminal并释放 remaining，而 [deriveStopState:256](/Users/biran/code/skills/loop/Orca/src/control/stopIntent.ts:256) 使组停在 handoff-partial。

此时 resume-from-handoff 即使 selections=[] 也只接受 handoff-complete（[continuation.ts:214–216](/Users/biran/code/skills/loop/Orca/src/control/continuation.ts:214)）；recovery-retry 只会重开 outcome-unknown 请求，不会重开 settled-unrecoverable（[stopIntent.ts:483–495](/Users/biran/code/skills/loop/Orca/src/control/stopIntent.ts:483)）；recordUsage 拒绝这个 terminal run 的新事件（[usage.ts:22](/Users/biran/code/skills/loop/Orca/src/control/usage.ts:22)）。组未知标记又检查所有历史 run（[budget.ts:87](/Users/biran/code/skills/loop/Orca/src/control/budget.ts:87)），继续拦下普通派发（[webDispatch.ts:221–222](/Users/biran/code/skills/loop/Orca/src/control/webDispatch.ts:221)）。新增 D9/M3 均拒绝它。因此“先解决停止”不是现有恢复路线，未来同样可能发生，且只因操作顺序不同便失去 D9 出口。

**修订要求：** 为已证实隔离、终止失败、未知用量导致不可恢复的现有 handoff run 定义保守结账与停止出路，或取得人明确接受此 D9 功能限制的裁定；不能把范围排除本身当成已经满足人的“解除失败 run 未知用量 blocker”。不要直接把 active 分支公式搬过来：这类 run 的 remaining 已释放，再扣 group.reserved 会扣其他承诺或下溢。账、request/stop 的修复规则应区分“缺用量”与缺 snapshot/artifact/隔离证明，不能凭结账将后者变成 recoverable。新增真实 failure→unknown→handoff-partial 的可达性判据；无停止证明仍应拒绝。

### I3 — retrying/source 的 ready 契约遗漏现有 no-provider 重派和 restartable 转移

草案第 64 行同时规定 ready 的 currentRunId 指向 settled-failed source，并规定下一次 normal claim 后继续保留 retrying/source，直到 held/continuing/terminal allocation 转移。这两条需要覆盖既有合法 rearm：一次 M3 后正常 claim 若 first-attempt proof invalid，[webDispatch.ts:385–397](/Users/biran/code/skills/loop/Orca/src/control/webDispatch.ts:385) 把新 run 置 failed-before-provider、task 置 ready，currentRunId 保持新 run，并在 [第 403–406 行](/Users/biran/code/skills/loop/Orca/src/control/webDispatch.ts:403) 自动 rearm。allocation 不变，source 仍是旧 settled-failed run。另一条合法路径是新 retry run 在 provider 前被 handoff-stop，restartRun→settled-restartable 令 task ready，同样保留新的 currentRunId（[stopIntent.ts:761–778](/Users/biran/code/skills/loop/Orca/src/control/stopIntent.ts:761)）。

若新冻结 reader 将草案 ready/source 同一条件实现为通用不变量，这两条合法路径会 recovery-blocked。不能把 currentRunId 改回旧 source 来满足它，因为 [controlViews.ts:632–635](/Users/biran/code/skills/loop/Orca/src/panel/controlViews.ts:632) 必须指最新 run；不能对 reduced grant 简单改回 confirmed，因为 [executionSnapshot.ts:313–333](/Users/biran/code/skills/loop/Orca/src/control/executionSnapshot.ts:313) 会重新比较原冻结 amount。

**修订要求：** 写清“刚完成 retry transaction 时 currentRunId=source”与“后来合法 no-provider run 的 currentRunId”之别；定义 retrying/source 在 failed-before-provider、settled-restartable 的持久状态和 reader 校验，不放松 grant 相等、lineage 或冻结身份。用真实命令/claim/settleProviderAttempt，以及 claim→pre-provider handoff-stop→清 stop 的新增判据，验证 view、driver read、重启、再 claim 均可达且不再扣 commitment。该问题属于新增 retrying 状态的完整生命周期，不要求修改旧 no-start 语义。

## Minor

无独立 Minor 阻断项。测试实现阶段应明确把 D9 后的 total/week/month cap headroom、跨周期记账和新 retry 的 cap 拒绝纳入断言；仅看 group budget 或 usage 行存在不能代替 cap 消费路径的校验。

## 已检查并明确暂不作为新发现的行为

- **Owner 边界：** human-only 表与认证 principal 的选择符合生产权限表；[permissions.ts:17–34](/Users/biran/code/skills/loop/Orca/src/panel/permissions.ts:17) 只允许 owner，member 和 socket agent 拒绝。草案要求不信 actorId/acknowledge，并要求 route/socket 判据，边界可实现。M3 沿用 any 权限符合当前 retry-task，不把人工记账权限传递给 retry。
- **保守账与模型实际报告：** 两桶所有四维 remaining 都记入是显式提案，确认页有区别和不可撤销提示；不在本报告虚构额外人的裁定。既有 cumulative/breaches 保留，非零 token 作 unattributed、当前 applied_at 可被现有 usage/cap 路径计入；零 token 不插行也能保留结账 marker。
- **并发、重放、迟到事件：** proof 在事务外读、事务内复核 report/highWater/额度，配合 command ledger 的事务重放（[commandLedger.ts:284–295](/Users/biran/code/skills/loop/Orca/src/control/commandLedger.ts:284)）可保证一次收费。原 event 幂等判断先于 settlement 拒绝，新事件后拒绝，能避免真实用量重复计账。并发其他 run 变化必须用事务内最新 group 重算，而不是写回证据预读阶段的 group。§7 已要求相关拒绝/回滚变异。
- **M3 主路径与多轮：** held remainder 释放后再预留失败 run 自己的 grant、保留失败理由与首次 endedAt、清除仅已 consumed continuation registration、普通 claim 不继承 checkpoint，均能与目前代码相接。pending/身份不符 registration 拒绝合理；历史 wake 的原 pending run 已存在，不会因清 work.continuation 再 claim。重复 active retry 更新 source 的提案可实现。I1/I3 是这些主路径之外必须补足的执行与生命周期规则。
- **冻结快照与 read schema：** retrying 专用状态加 source/grant 逐维校验，比单独省略 amount 有明确约束；其余 frozen 字段必须保持原比较。正常继续/terminal 后不能仅为过 reader 重写旧 grant/checkpoint。本审查未把任意多字段人为篡改 DB 当本轮产品需求；I3 只使用合法生产转移。
- **Schema 10：** 可选 settlement 字段与旧 run 兼容，单向版本门能隔离旧 reader；现有 [store.ts:84–90](/Users/biran/code/skills/loop/Orca/src/control/store.ts:84) 确实拒绝未知版本。需同步现有升级白名单与最终版本断言，草案已经登记这一设计责任，不能以“无新增表”省略它。
- **真正未停止/证据损坏、未知执行、pending 事件、归档组：** 保持拒绝合理；manual charging 不证明进程隔离，也不修复日志 gap。I2 仅挑战已有有效终止隔离证据的未知账死路，不要求无证据解锁。
- **成功/普通中断/旧 predecessor：** M3 应依据非成功 terminal outcome 与当前 held run/已结清 request 排除它们；普通 handoff 的 drive.outcome 通常未赋值，不应仅按显示 state 当 failure。现有 Continue 能力保留，empty selections 入口对 handoff-complete 合理。
- **估算、clarify/split、legacy 和性能：** 人本轮要求落在失败 Codex task run 与 handoff retry；这些额外流程不作扩大实施要求，也不重新打开已结清 issue-fixes。post-handoff 的失败 task run 则在同一 D9 用户意图内，故不能按同一理由排除。

## 证据与验证范围

观察提交为 `79b7495edb07f003d472c80e41854ecb5c924619`。命令均经 `rtk proxy`：`/usr/bin/git rev-parse HEAD`、`/usr/bin/git status --short`、`/usr/bin/git diff c29676d6d0050d46b9cf61f45ffaee583f9dec76 79b7495edb07f003d472c80e41854ecb5c924619 --stat`；源码行号用 Python 读取文件并逐行编号；ccloop 用 `/usr/bin/git -C /Users/biran/code/skills/loop/ccloop show ab824d16004de2d3c1613a76ec0431520aa16cc9:src/control/worker.ts` 固定读取。没有把静态推导写成测试通过。本轮判据为新报告独占创建成功，并验证产品/测试 diff 为零、HEAD 仍为被审提交；不运行测试套件。

最终只读检查（同一观测提交）：`/usr/bin/git diff --exit-code -- src web tests` 与 `/usr/bin/git diff --cached --exit-code` 均退出 0、无输出；`/usr/bin/git rev-parse HEAD` 仍为被审草案提交；`/usr/bin/git status --short` 退出 0、无输出（SDD 目录被忽略，报告存在性与结论由独立 Python 断言确认，退出 0）。
