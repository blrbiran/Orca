### Spec Compliance

- ✅ Spec compliant：本次 gate 审查 BASE `c2e81f2cba160546e633ab683c02a23522f0d13c` → HEAD `f9849b29b694f3b2bff9d7c3ae88729044cab19e` 的完整两个 commit/U10 diff，以 design §9（含 §9.5）、global-constraints、Task3 brief、Task2 qualification 表及 controller 两项具名判据迁移裁定为准。Owner `/root/review_settlement_ui_task`；日期 2026-10-09；报告仅新增本文件，未改变产品/tests/index/HEAD/branch，未派 subagent。
- ✅ 真 AccountContext 角色通过 App→Panel→GroupView，D9 必须显式 owner；无账户/member 无入口并有联系 owner 指引，不以 DTO.allowed 充当身份：`web/src/App.tsx:176,968`、`web/src/ControlPanel.tsx:256`、`web/src/UsageSettlement.tsx:29-34`。
- ✅ 独立不可撤销确认读取 DTO.remaining 的 work/handoff tokens/activeMs/attempts/sessions；说明连已知未用额度一起保守记账、非模型实际用量、不可撤销且不自动重启；仅发送 taskId/runId/generation/acknowledge 与既有 command envelope，金额/principal 不入 payload：`web/src/UsageSettlement.tsx:10-15,34-39`、`web/src/controlApi.ts:259,303`、`web/src/locales/en.ts:333-354`、`web/src/locales/zh.ts:232-253`、`web/tests/settleUnknownUsage.test.tsx:14-34`。
- ✅ preview/commandRevision/roles key 改变会重建确认状态；取消及确认也清除 approved；receipt 显示 method/principal/at 与 charged 两桶四维，activity 使用保守记账词语：`web/src/ControlGroupView.tsx:222`、`web/src/UsageSettlement.tsx:19-28,38-39`、`web/src/TaskDetail.tsx:120-130`、`web/tests/settleUnknownUsage.test.tsx:41-65`。
- ✅ 失败原因由非成功 outcome 保留于 handoff/D9 后，原 blocked-only isTerminalFailure 保留；table/detail 共用 current-run Retry 资格。Held 要 work+两桶 held、已结 request、complete snapshot；released 要 work blocked+两桶 terminal、released marker+settled-failed request。两种 inactive 均要求 pendingRunId 显式 null、group ledger usageUnknown=false，历史/current、success/普通中断、open request、stop/clarifying/archive 边界没有混淆：`web/src/runFacts.ts:9-15,28-57`、`web/src/TaskDetail.tsx:263`、`web/tests/handoffFailedRetry.test.tsx:13-51`。
- ✅ 手工 settled-failed 即便 continuable flag 过时为 true 也不能 Continue；已有真实 empty-resume 在 handoff-complete 下独立可达、发送 selections=[]，清 stop 后再显示 Retry；partial 不出现 Resume/Retry，不自行宣布整组恢复。Checkpoint Continue 与 group-head Retry 的双语提示不同：`web/src/ControlGroupView.tsx:40,319-320,336-369`、`web/tests/handoffFailedRetry.test.tsx:25-50`。
- ✅ `controlTypes.ts` 未产生额外 hunk 属于已经具备所需 DTO/payload 的消费；定点读到现有定义 `web/src/controlTypes.ts:221-243`，没有遗漏本任务所需类型。Controller 允许的小 UsageSettlement component 与唯一辅助测试 fixture 属于必要分解。
- ✅ 只有获准旧判据迁移：enum178→181，34家族/所有双语值判据和历史注释保留；archive 指定 fixture 的 failed run 与 workItem 均 task a/current run-a/lineage run-a，原 open2/archived0 Retry 断言不变。commandRecovery 原断言/timeout 没有放宽，仅新增 D9 lost-response criterion：`web/tests/i18nPseudo.test.tsx:335-344`、`web/tests/archiveGroup.test.tsx:30-41`、`web/tests/controlCommandRecovery.test.tsx:168-201`；身份定点核对 `web/tests/fixtures/board.ts:17-23`。
- ⚠️ 无法从此 diff 验证服务器完整 immutable claim、content-addressed checkpoint/artifact/isolation proof、pending seq>highWater、人工 marker 严格身份与 exactly-once 事务、账户 cap，以及 §9.5 的真实 D9→handoff→empty resume→retry→claim 顺序。它们是 Task1/Task2/Task4 gate；UI 使用 canonical DTO 与原命令拒绝机制，不自行宣称这些校验通过。

### Strengths

- ✅ 保守记账 component 只负责展示/确认，命令仍进入已有 App sender；新增 App HTTP criterion 实际穿过 AccountContext/Panel/GroupView，并验证严格 payload 和 lost POST answer 后持有原 commandId：`web/tests/controlCommandRecovery.test.tsx:175-201`。没有另开绕过 revision/recovery 的 fetch 路径。
- ✅ 失败的历史事实与“现在可以重试”分开，pure retryRunOpen 在 table/detail 复用，且未知整组 usage 的 gate 仅加入 new inactive admissions，保留普通 active 路径：`web/src/runFacts.ts:9-15,42-57`、`web/src/ControlGroupView.tsx:228`、`web/src/TaskDetail.tsx:263`。
- ✅ 判据观测真实渲染文本、两桶数值、按钮和点击后的命令，不只验证自写 fixture；12 个 isolated mutations 均是业务失败而不是加载/编译失败。核读 `/private/tmp/od9/task3-mutations.py`、manifest、12份完整日志和 paired RC：owner/member入口、unchecked confirm、amount table双语、failure reason、held detail Retry、released Retry、group unknown、current identity、manual Continue、真实 App role、activity、empty-resume；每项 RC1。恢复日志 `/private/tmp/od9/logs/task3-mut-restored-green.log:7` 为21/21、RC0。
- ✅ 核读完整 web-check/committed-directed/type/build 日志及 paired `.rc`：729/729（90files）为 `/private/tmp/od9/logs/task3-check-final.log:145`，committed84/84（8files）为 `/private/tmp/od9/logs/task3-committed-directed.log:7`，type/build均RC0。命令和观测基线来自 `task-3-report.md:41-54`；full web为BASE+final overlay，committed verification为aa03c91，未误称root full suite已过。Final restore proof 记录 main aa03c91/clone442ffe8、15具名hash相等、产品diff/cache及clone diff/cache全部0。

### Issues

#### Critical (Must Fix)

- 无。

#### Important (Should Fix)

- 无。

#### Minor (Nice to Have)

- `/private/tmp/od9/logs/task3-committed-build.log:14`（`task-3-report.md:54`）：Vite 成功但仍有 >500kB chunk warning，不能称验证输出完全无告警。报告已经如实记录；建议 Task4 汇总时保留这一已知构建限制，后续具名性能轮处理，不为本任务扩 scope 或抑制 warning。

### Focused Checks

- ✅ 风险“UI 不该凭 marker 字符串认定权威 proof 已通过”：定点读 `src/panel/controlViews.ts:742,1056-1061`，canonical reader 校验有效 marker，preview 来自 server settlementAdmission/settlementProof/released checkpoint；`web/src/UsageSettlement.tsx:33-34` 只展示 refusal/allowed。未扩展成服务器实现审查。
- ✅ 风险“现有 active fallback 和 stopped flag 没有完整 DTO”：定点读 `src/control/retryTask.ts:55-98` 与 `web/src/controlTypes.ts:62-82,194-243`，active live/block-at-C/pending事件属于服务器权威，DTO无 stopped 独立字段；stop DTO 是 UI gate，pending events 不在 UI 重算。`src/panel/controlViews.ts:738-748,775-789` 会拒绝失效run/work/active-state身份，UI 无需另复制 frozen identity校验。
- ✅ 风险“diff 在既有 dispatch/request 渲染函数中途截断，empty resume或具体blocker可能不可达”：只补读截断函数 `web/src/ControlGroupView.tsx:83-96,120-138,278-286,318-371`；已有 independent empty-resume 分支可达，partial 停止横幅/frozen IDs和request failureCode仍显示。没有新增清 stop 的捷径。
- ✅ 风险“archive迁移可能掩盖fixture任务身份错误”：只读 `web/tests/fixtures/board.ts:17-23`，两者 default taskId=a/runId=run-a；具名fixture迁移与原两条业务断言保持一致。
- ✅ 本 gate 未重新跑已完成 suite/变异；代码阅读没有产生现有run不能回答的具体单test疑虑。产品评审来自完整 review package，额外读取仅上述具名DTO/既有函数/fixture风险与验证证据。

### Assessment

**Task quality: Approved**

**Reasoning:** Task3 在 DTO 可见信息边界内完成 owner D9确认、失败历史、held/released Retry与empty-resume，必要复用和双语齐全；有真实App路径与12变异红、最终web/定向/类型/构建绿证据。服务器证明/claim/pending及全链路权威留给既定Task1/2/4审查，本任务无阻塞修复项。

### Citation correction (2026-10-09, same reviewer, HEAD f9849b2)

- ✅ 按完整 diff hunk 的最终行号逐行计数（测量命令：`rtk proxy python3` 解析 `review-c2e81f2..f9849b2.diff` 的 `@@ +line`），更正上文少数手算行号，保留原文作为历史：AccountContext 为 `web/src/App.tsx:173`，App roles 为 `App.tsx:975`，Panel roles 为 `ControlPanel.tsx:263`；consent-reset key 为 `ControlGroupView.tsx:221`，table shared Retry 为 `ControlGroupView.tsx:229`，detail shared Retry 为 `TaskDetail.tsx:260`；D9 union 为 `controlApi.ts:260`，route case 为 `controlApi.ts:310`。
- ✅ 英文 settlement 整块从 `web/src/locales/en.ts:340` 开始（warning `:358`）；中文从 `web/src/locales/zh.ts:239` 开始（warning `:257`）。这些更正仅修正证据定位，Spec✅ / Approved 与零Critical/Important结论不变。
