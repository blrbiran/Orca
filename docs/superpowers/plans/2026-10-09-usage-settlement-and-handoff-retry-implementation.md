# 人工结清未知用量与交接后重试 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** owner 可以保守结清失败任务的未知账，交接前后均有可达的显式恢复/重试路径，实际执行不会超出 claim grant。

**Architecture:** 独立 owner 命令在 authority transaction 内结账，区分 committed 与 released 承诺。人工 handoff request 状态与 marker 绑定；M3 恢复失败 run.grant 并严格校验 retrying/source 生命周期。前端展示金额、失败原因与恢复入口，不直接操作账。

**Tech Stack:** TypeScript、zod、node:sqlite、Express、React、Vitest；沿用既有 control store、command ledger 与 ccloop port。

**Spec:** docs/superpowers/specs/2026-10-09-usage-settlement-and-handoff-retry-design.md；§9（含9.5）优先。归属 controller，2026-10-09，设计观测 a08c763，产品基线 c29676d。

## Global Constraints

- 用户授权 controller 完成设计修正、plan、subagent-driven 实施，问题先按建议处理，最后统一审核；不另暂停中间 artifact approval。
- 只做 D9/M3；issue-fixes 旧任务和旧台账一个字不改；M5/M6 为下一独立轮。
- 结清两桶 work/handoff remaining 的 tokens/activeMs/attempts/sessions 全维度；不是组 reserve。commit/replay/rollback 只计一次。
- 固定 ccloop ab824d16004de2d3c1613a76ec0431520aa16cc9；ORCA_CCLOOP_BIN=/private/tmp/orca-d9-ccloop-ab824d1/dist/cli.js。ccloop/ccmem 产品不修改。
- schema 10 单向门；旧 run/work 无新字段兼容，持久字段出现时必须严格校验。
- owner Web 认证 principal 授权；member/socket/MCP agent 拒绝。actorId/acknowledge 不构成身份。
- git 核对 rtk proxy /usr/bin/git；只 git add 具名路径（SDD 精确 -f），不 add -A；不 push/merge/删分支/worktree。
- tests/panel 前 npm run build --workspace web。所有 shell 经 rtk，验证输出写文件后整份读回，记录真实 RC、观测提交。
- 不碰真实 HOME/XDG/控制库/服务/付费 agent；测试临时根改道；变异只在 no-hardlinks local clone，不能改主工作树。
- 现有历史 spec/SDD 只能追加更正；handoff 可压缩活文档。worker 不派 subagent，controller 提供 task review。

## Review Focus

- 操作顺序：D9→handoff 与 handoff→D9 都能解除仅未知账造成的停止死路（Task 1/2）。
- 多任务组：结清一个失败 run 不会清其它 unknown/request/blocker 或借扣其它任务 commitment（Task 1）。
- 缩小 grant 的连续重试：实际 accept envelope 的三个 policy 上界、hash/head/checkpoint 与账一致（Task 2）。
- no-provider 重派与进程重启：最新 currentRunId/source 均合法、不会重复预留（Task 2）。
- HTTP 认证和两标签页重放：member/agent 403、owner 额度预览过时后服务端重算/拒绝、UI 持续显示失败原因（Task 1/3）。

---

### Task 1: D9 的 owner 命令、持久化和交接收口

**Files:** Create src/control/settleUnknownUsage.ts、src/control/usageSettlement.ts（共享 marker schema/有效性检查）、tests/control/settleUnknownUsage.test.ts、tests/control/schema10.test.ts、tests/panel/settleUnknownUsage.test.ts。Modify src/control/webProtocol.ts、webService.ts、usage.ts、usageLedger.ts、budget.ts、migrations.ts、store.ts、activity.ts、stopIntent.ts、src/panel/controlApi.ts、humanOnly.ts、controlViews.ts、controlErrors.ts、src/entry/operations.ts、skills/orca-control/SKILL.md、tests/entry/skill.test.ts、tests/control/archiveGroup.test.ts（其余 verb 分类跟随直接调用者）、相关 wire type；前端错误词条 en/zh 最小注册，完整UI Task3。

**Interfaces:** Produce exported usageSettlementSchema and hasValidUsageSettlement(store, run): boolean；applySettleUnknownUsage(deps, command) async authority handler，与 WebControlService.settleUnknownUsage(command) async 接口接入现有 command context principal。Route /api/control/groups/:groupId/settle-unknown-usage，payload {taskId,runId,generation,acknowledge:'charge-remaining-grant'}。Marker 包含 spec §4+§9 字段；RunViewV1.unknownUsageSettlement 为可选只读预览/结果，支持 allowed/refusal reason，供Task3消费。

- [ ] Step 1: 新测试先失败：`charges both buckets once and preserves frozen allocations`、`charges a released failed handoff without consuming another task commitment`、`completes only the usage-only stopped failure`、`settlement before handoff counts as complete usage`。采用既有真实 command/driver fixture 生成 report、handoff request/checkpoint，不直接写预设最终状态作为成功证明；检查账/ledger/activity/view 与其它任务承诺。
- [ ] Step 2: rtk proxy env ORCA_CCLOOP_BIN=/private/tmp/orca-d9-ccloop-ab824d1/dist/cli.js node_modules/.bin/vitest run tests/control/settleUnknownUsage.test.ts tests/control/schema10.test.ts，日志全读；应因缺命令/版本/行为失败。
- [ ] Step 3: 实现两个 admission 和记账分支、proof 与事务重验、authenticated principal、重放/迟到事件、严格 marker reader、manual settled-failed request 收口、不重复 terminalise/release。hasObservedUsage 识别有效 marker，仍拒绝 pending/未隔离/不完整checkpoint。
- [ ] Step 4: 增加 owner/member/socket、rollback/restart/replay、其它 run unknown/open request、缺 snapshot/artifact、pending/伪造marker、超额记账、total/week/month cap 当前周期的新增判据；panel 前 build web；版本门证据区分：新reader拒绝schema11；在产品基线c29676d的独立旧clone用真正v9 openControlStore验证拒绝新schema10且库字节不变，不用模拟旧版本常量冒充旧reader。跑新增文件及 tests/control/schema8.test.ts tests/control/schema9.test.ts tests/panel/permissions.test.ts tests/control/webProtocol.test.ts。
- [ ] Step 5: 具名现有判据修订：tests/control/schema8.test.ts 的 `a fresh store is at the current version (9) with the usage, cap and principal surfaces`、`a version-7 store upgrades and books each group's existing usage as one pre-ledger row, in no period`、`an upgrade leaves every existing row as it was, and repeating the 7-to-8 step adds no second pre-ledger row` 的最终版本9→10，保留pre-ledger/周期/旧行/幂等全部断言；tests/control/schema9.test.ts 的 fresh-store version9→10、populated version8 最终9→10、future-version10→11；原 STRICT/FK/index/旧行/字节不变断言保留。追加更正说明，不改历史issue-fixes证据。封闭集合具名同步：tests/entry/skill.test.ts 的 `lists exactly the panel's mutation routes, so the table cannot drift`、`names the verb of every route as the panel does`、`gives every route a payload example that its raw payload schema accepts` 的32改33，加入 settleUnknownUsagePayloadSchema 的 schemaByVerb，保留全集相等与payload验证；skills/orca-control/SKILL.md 增加新route/payload与仅owner Web、agent 403边界（不是教agent绕过Web）；tests/control/archiveGroup.test.ts 的 `covers every group-targeted verb the protocol knows, so a new verb cannot slip past` 与参数化 `refuses %s with group-archived, durably, and changes nothing` 的CALLS加新service调用/payload，不改变预期拒绝。Task1正常跑 tests/entry/skill.test.ts tests/control/archiveGroup.test.ts。若其它封闭枚举测试确需改动，列出精确 test 名/原因在报告，由controller裁定后改；不能降断言。
- [ ] Step 6: no-hardlinks local clone 同步本task代码，删除 committed扣款、released admission/不扣reserved分支、manual收口、marker observed分支、humanOnly分类及proof/pending/replay关键守卫，新增对应测试见红；记录逐变异及还原证明。正常/恢复门绿，按确切路径commit。报告 new-task-1-report.md 含变更、命令/RC/原始日志、变异、self-review、commit。

### Task 2: M3 retrying/source 生命周期与真实执行上界

**Files:** Create src/control/retryGrant.ts（共享 live retry校验）、tests/control/handoffFailedRetry.test.ts。Modify src/control/retryTask.ts、executionSnapshot.ts、webProtocol.ts、stopIntent.ts、continuation.ts、webDispatch.ts、executionDriver.ts、src/panel/controlViews.ts 和必要work/run schema。Consume Task1 marker/request状态与hasValidUsageSettlement。

**Interfaces:** Produce validateRetryGrantSource(store, groupId, work)（无源为旧行为；retrying源缺失/错误抛 recovery-blocked），driver和panel共同调用。沿用 applyRetryTask(deps, command)、withinGrant(policy,grant)；字段 work.retryGrantSourceRunId 可选。所有writer在held/continuing/terminal转移原子清 live源，不删除历史run。

- [ ] Step 1: 新增失败判据 `retries a handoff-settled failed continuation at its claim grant`、`retries released manual settlement without releasing twice`；再新增 `settles unknown usage before handoff then resumes and retries from head`（§9.5）；真实失败→D9→handoff→空选resume→retry→claim和真实失败→handoff→空选resume→retry，断言amount/source/endedAt/原因，真实claim读view/driver并截取port.accept，policy三维min、hash不变、head最新、checkpoint null。
- [ ] Step 2: 先运行新文件看到缺inactive admission/lifecycle/policy错误；禁止改原stop就拒绝的retryTask断言。
- [ ] Step 3: 实现 active、inactive held recoverable、manual released failed 三种retry reservation区别；retrying schema、frozen shape与source完整校验、consumed registration精确身份/清除；普通confirmed active retry原语义保留。A2统一 task policy clamp。
- [ ] Step 4: 新增 `rearms invalid first proof with the newest currentRunId and no second reservation`、`resumes a pre-provider stopped retry without a second reservation`、`active retry after reduced retry remains valid`；真实claim/settleProviderAttempt/handoff命令→view/driver→close/reopen→再claim，校验lineage/grants/零cumulative/source身份。拒绝不足、旧源、漂移、pending continuation、其它未知、stop/archived；Continue旧合法能力保留，新manualfailed不能Continue。
- [ ] Step 5: 运行本task与 tests/control/retryTask.test.ts、continuation/handoff相关直接调用者文件、Task1新判据及typecheck。clone内删除inactive/released admission、grant恢复、source校验、no-start/restartable reader、policyclamp、清consumed关键分支，各匹配判据红；正常恢复绿，按路径commit、写task报告。

### Task 3: owner 结清预览与失败恢复界面

**Files:** Create web/tests/settleUnknownUsage.test.tsx、web/tests/handoffFailedRetry.test.tsx。Modify web/src/controlTypes.ts、authority command wire分类所在文件、runFacts.ts、ControlGroupView.tsx、locales/en.ts、locales/zh.ts、activity rendering直接调用者。Consume Task1 RunViewV1.unknownUsageSettlement、Task2新Retry资格；客户端不得自行宣称proof通过或重算权威费用。

**Interfaces:** POST独立D9命令，仅owner入口，两个bucket四维预览/不可撤销保守说明；member联系owner；显示usageSettlement method/charged/at/principal。已有command action/recovery/Revision机制复用；恢复派发入口发送 resume-from-handoff selections=[]，与checkpoint Continue区分。

- [ ] Step 1: 新test先失败：owner看金额确认、member无授权入口；D9前后failed原因不消失；handoff complete无续跑选择时空选resume→Retry；其它run未决时不可误报整组已恢复；success/普通中断/旧run/pending continuation不出现错误Retry。
- [ ] Step 2: 实现状态/权限/拒绝原因/错误文案、独立确认和request、两桶费用、activity人话、空选resume和M3按钮。中英文完整，不暴露实现细节作为用户决策。
- [ ] Step 3: npm run --workspace web check、root typecheck、panel相关前先web build；跑新tests及 web/tests/driverRetry.test.tsx web/tests/taskActivity.test.tsx web/tests/controlCommandRecovery.test.tsx。clone删owner入口守卫、费用确认、失败原因分支/空选resume、新retry资格，各相关新增判据红，正常恢复绿。
- [ ] Step 4: 按路径commit、self-review与task报告，交controller task spec+quality review。

### Task 4: 全轮验证、终审修复与交接

**Files:** 本轮新增SDD报告、docs/handoff/handoff.md、两 sibling handoff 的 Orca章节；只在review发现需要时修改本轮产品/新增测试。不改其它仓产品。

**Interfaces:** Consume前三task提交与测试/变异证据；produce round-close ledger、review报告、三仓紧凑handoff、给人的10行以内executive summary（不写文件）。

- [ ] Step 1: controller委派fresh verifier，隔离env和固定ccloop clone，先webbuild；顺序运行typecheck/build、新增task测试、web check、verify:control、verify:scheduler、verify:ccloop-pin、verify:panel、npm test、check-tmp-leak。完整输出真实RC带观测commit，不重复无意义全门。
- [ ] Step 2: 登记的负载timeout按名单低负载单文件复验并记uptime；断言失败查根因，不豁免。核对关键变异都实际见红（不是启动失败）；变异只clone，主工作树src/tests零额外漂移。
- [ ] Step 3: controller fresh全分支review spec+quality，读证据与whole-range diff；必要一波fix worker、scoped re-review，无真实付费验收则明说。
- [ ] Step 4: controller按人授权更新Orca/ccloop/ccmem handoff，各Orca段替换为当前结论/必要next，不无限追加，不以本次handoff可变HEAD当定位。保留commit/report语义与固定dependency pin。每仓精确路径本地commit，不push/merge。
- [ ] Step 5: ledger追加Round close、逐task结论和全部Ruling成本；保留本轮历史证据，不删除worktree/branch。最终报告给人审核并直接给10行以内executive summary。
