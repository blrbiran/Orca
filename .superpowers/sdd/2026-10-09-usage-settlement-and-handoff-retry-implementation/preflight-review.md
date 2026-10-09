# D9/M3 spec + plan static preflight

归属：Codex subagent `/root/review_plan_and_final_spec`，2026-10-09 13:17 Asia/Shanghai。观测 HEAD `a08c7633147939f62c98aaf9b0c0fa206a4a51ca`，分支 `codex/d9-m3-implementation`；产品基线 `c29676d`。审阅的是此 HEAD 上未提交的 spec §9.5 与 implementation plan。文件只新增一次，后续裁定或修订复审须追加。

范围：只做本轮 D9/M3 静态 preflight；读 RTK.md/CLAUDE.md、spec/plan 与必要直接调用者。不重做 issue-fixes，不改产品/spec/plan/git，不运行 suite、服务或真实数据。controller 的基线运行结果由 controller 自己登记，本报告不将其当成本 subagent 的实测。

## 结论

- Critical：无。
- Important：I1 一项，计划遗漏已能具名的必改封闭集合与 entry 文档落点。
- Minor：M1、M2 两项，补强具名验收安排。
- Spec conclusion：PASS，§9.5 与 §9.1–9.4 可以共同实现，静态未发现新的产品设计死路。
- Plan conclusion：NEEDS SMALL REVISION，I1 解决后可执行；无需重新设计四个任务或增加中间人审。
- Ready to execute：No，当前 plan 尚未满足 spec §7 的“封闭集合计数需在 plan 前逐条指名”。controller 可直接补计划并裁定执行。

## Important

### I1：新 route/verb 必然使已知封闭集合失败，Task 1 未登记实际落点

证据：spec §6 要求 CLI/MCP 的 verb 分类与说明；§7 要求封闭集合计数在 plan 前具名。当前 Task 1 Step 5 只具名三条 schema9 修订，将其它封闭集合推迟至实施中发现再裁定。源码已经确定至少以下落点；它们不是未知文件名可跟随直接调用者的普通适应。

1. `tests/entry/skill.test.ts`：
   - `lists exactly the panel's mutation routes, so the table cannot drift`：`routes.size` 当前精确 32，新增 D9 route 后应为 33，保留与文档表集合逐项相等断言。
   - `names the verb of every route as the panel does`：`verbs.size` 当前精确 32，应为 33，保留 route→verb 映射相等断言。
   - `gives every route a payload example that its raw payload schema accepts`：`rows.length` 当前精确 32，应为 33；`schemaByVerb` 增加 D9 payload schema，保留每行示例经原 schema 校验的断言。
2. `skills/orca-control/SKILL.md`：加入 D9 路由、严格 payload 示例、owner-only/agent 403 说明与新拒绝码/恢复顺序。缺该文件落点会让上述文档协议判据失败，也漏掉 spec §6 的说明交付物。
3. `tests/control/archiveGroup.test.ts`：`covers every group-targeted verb the protocol knows, so a new verb cannot slip past` 对 `CALLS` 与 protocol verbs 完整集合比较；必须给 `settle-unknown-usage` 增加 group-targeted service call 与合法 payload，使既有 `refuses %s with group-archived, durably, and changes nothing` 参数化判据覆盖它。不得把新 verb 塞入 `NOT_GROUP` 或降低集合断言。

建议：在 Task 1 Files/Step 4–5 登记这三组路径与精确判据修订，scoped 验证加入 `tests/entry/skill.test.ts tests/control/archiveGroup.test.ts`。这属于本轮新增 verb 引起的必要扩展，保留原业务判据与历史 issue-fixes 证据。`src/control/controlCli.ts` 实际不存在；entry 采用 `src/entry/controlCommand.ts`→`operations.ts`→socket 的通用路径，已有实现不需要新增硬编码 verb 分派，分类权威仍在 `src/panel/humanOnly.ts`。plan 已允许按直接调用者适应此文件名，文件名本身不另报问题。

## Minor

### M1：把 §9.5 的完整顺序判据放到 Task 2 的具名收口

Task 1 的 `settlement before handoff counts as complete usage` 能验证 D9→handoff-complete，但该 task 尚无 M3 新 inactive admission。Task 2 当前具名场景主要写失败→handoff→resume→retry。建议明确在 Task 2 增补或扩展一条 `settlement before handoff retries at the original grant`，完成 active failure+unknown→D9→handoff-stop→complete→empty resume→retry→claim，并验证 held remainder=0、从 reserve 全额预留、真正 accept 的原 grant/head/null checkpoint。这样 Task 1 不必因 Task 2 的依赖而提前实现 M3，也不会把 §9.5 验收缩到中途。

§9.5 的 marker-observed 删除变异仍归 Task 1，可用其 handoff-complete 场景看红；Task 2 再运行完整组合。plan 总体遵循 §9.5，所以此项是明确责任与测试命名的补强，不是产品机制缺失。

### M2：schema10.test 明确区分“旧版拒10”和“新版拒11”

Task 1 已具名 schema9 三条必要修订，且保留 STRICT/FK/index/旧行/字节不变断言，方向正确。将旧测试的 future-version 从 10 改为 11，只证明新 reader 拒未来版本，不能单独证明旧 reader 拒10。建议 `schema10.test.ts` 或 Task 4 evidence 具名登记旧版本 opener 对隔离 schema10 store 的拒绝与字节不变证明，避免两项证据混用。

当前旧 reader 的静态证据充分：`src/control/store.ts` 在建立写连接前仅接受当前 schemaVersion=9 或版本1–8，10 将抛 `control-schema-unsupported`；因此旧版拒10在设计上可实现，无需改旧产品。不得在真实控制库试验。

## §9.5 与接口静态核对

`budget.ts:hasObservedUsage` 当前仅从 seq<=highWater 的 usage_events 收集两桶 non-null cumulative。D9 不伪造 provider event，因此仅清 unknown/remaining 会继续被拒；§9.5 明确要求有效人工 marker 的共享分支，确实命中原死路。

已核对 hasObservedUsage 的直接调用者：`driverHandoff.ts` 的真实 checkpoint 收口、`checkpoints.ts` 的 candidate complete 条件、`schedulerBridge.ts` 的停止恢复条件、`budget.ts:releaseRunReserve`。通过共享 `hasValidUsageSettlement(store, run)` 接入该函数可统一改变“账已结清”的判断；各自 pending、stopProof、artifact、snapshot、unresolved 独立守卫仍保留。不能仅修改 handoff 面板资格或单一 driver 分支。

marker 的 generation/highWater/charged/证据身份、unknown=false、两桶remaining四维零与 pending seq>highWater 检查，足以建立人工结账的语义；异步 proof/artifact 验证应先于事务，事务重验 report引用/highWater/额度快照，plan Task1已要求。同步共享 reader 可以校验持久 marker 与已验证证据身份；不得在它里面再次扣款、推进highWater或启动provider。

两种账变化可实现：committed 分支 used加charged/reserved减charged；released 分支 used加charged/reserved不变，并重算 deficit/reserve。`syncWebBudget` 扫描其它run unknown/pending 的现有逻辑可以复用。人工 request settled-failed 需独立收口，不能加入 provider HandoffDisposition 后复用 terminaliseRun，plan 已明确该边界。

D9→handoff 路径可在完整 checkpoint 守卫下变为 recoverable/held，remaining=0，M3从原 run.grant 全额预留。handoff→D9路径只接受唯一usage-unsettled原因，terminal allocation保持，人工marker/request关联后变settled-failed，M3全额预留且不再release。两路径不会凭marker绕过缺snapshot/artifact或未知执行。

## 四任务依赖、覆盖与验收边界

| Task | 可实施依赖与交付检查 |
|---|---|
| 1 | 先产出 D9 schema/handler/service/route、authenticated principal、marker/request严格reader、RunView预览/结果、schema10与errors/activity/账。authority同步事务与外部证据async preflight现有模式可承接；新verb与持久状态必须同task覆盖reader/closed enum。I1须补实际entry文档与判据。 |
| 2 | 消费Task1 marker/request；三种retry资格和reserve算式区分明确。retryGrant共享reader同时供driver/panel，frozenAllocationShape只放松retrying amount，live source/grant身份仍严格。需按§9.3扫描所有held/continuing/terminal writer并清source，保留no-provider source与最新current，plan已要求，不能只改retryTask。 |
| 3 | 消费Task1预览和Task2资格；四维两桶金额、不可撤销确认、owner入口/member说明、失败理由、empty resume、Continue/retry区别与其它blocker文案有明确落点。controlApi/action recovery等实际文件可依直接调用者适应。客户端只显示服务端费用与资格；命令只提交身份/ack。 |
| 4 | 消费前三task commits/完整logs/mutation证据；fresh verifier/review，固定ccloop pin、隔离HOME/XDG、clone-only变异、真实RC、完整输出及观测commit均明确。最终handoff与人审不要求额外产品行为。 |

§7/§9.4 的守卫与变异契约已被 plan 纳入：当前run/支持范围/stop/归档、proof和checkpoint身份、pending、owner/member/agent、replay/rollback/restart/迟到事件、两桶与其它未知账、released不借其它承诺、手工request防伪与完整frozen集重算、三种retry来源/预算不足/旧lineage/成功与普通中断、consumed continuation精确身份、source漂移、no-start/restartable完整生命周期、真实policy三维clamp及hash/head/checkpoint、总/周/月cap与周期边界。每项最终需要对应删除变异实际断言红；“启动失败红”不可替代。

预算UI与多标签页：server recompute/transaction revalidation在Task1，Revision/command recovery在Task3；过时预览不得变成客户端权威金额。Task3需要让用户仍看见拒绝详情，且不把某run结清声称为整组解锁。Task1已列预算不足仍可记账与其它rununknown，Task2承担后续派发cap，职责不冲突。

## 静态证据与未执行声明

测量命令：`rtk proxy /usr/bin/git rev-parse HEAD`；观测值为本报告首部HEAD。`rtk proxy /usr/bin/git status --short --branch` 观测spec修改与plan未跟踪，产品未改。读码命令为 `rtk proxy cat`、`rtk proxy sed -n`、`rtk proxy rg -n` / `rg --files`，均只读；涉及未知文件名的两次搜索显式返回不存在，其后沿entry直接调用者定位，没有隐藏失败。

未执行任何suite/build/service/provider/变异，本报告不是实测通过证明。只创建本文件；无产品/spec/plan/git写入。先前controller的基线6条RC0由controller证据所有者负责。

## 追加更正与 scoped 复审（2026-10-09，原发现逐字保留）

归属：同一 reviewer `/root/review_plan_and_final_spec`；观测 HEAD 仍为 `a08c7633147939f62c98aaf9b0c0fa206a4a51ca`。controller 在本次审阅中修改未提交 plan 的 Task1 Files/Step5；reviewer 只读回修订，无产品写入或测试运行。

I1 已解决：Task1 现在具名 `skills/orca-control/SKILL.md`、`tests/entry/skill.test.ts` 的三条精确测试名与32→33/schemaByVerb修改、`tests/control/archiveGroup.test.ts` 的完整CALLS与参数化archived拒绝测试，并将两测试文件加入task scoped正常验证。原集合、payload、group-archived及零业务写入断言均保留。entry实现路径改为真实存在的 `src/entry/operations.ts`，其通用transport可复用。

额外核对：Task1补入 `tests/control/schema8.test.ts` 三条精确名称及最终版本9→10修订，分别是 fresh current store、version7 pre-ledger升级、重复7→8无重复pre-ledger；使用 `rtk proxy rg -n 'it\(|toBe\("9"\)|toBe\(9\)' tests/control/schema8.test.ts` 直接核对，三条均有实际9断言。保留旧行、周期、幂等原断言的要求满足版本升级必要修改边界。

最终有效结论（优先于报告首部首次结论）：

- Critical：无；未解决 Important：无。
- I1：Resolved，controller修订已静态核对。
- Spec conclusion：PASS。
- Plan conclusion：PASS。
- Ready to execute：Yes。按用户已授权的controller裁定/subagent-driven进入实施，不需额外中间人工审批。
- M1/M2 为非阻塞验收明确性建议；§9.5完整顺序验收与旧版拒schema10仍属于实施必须兑现的spec契约。本结论仅为静态可执行性，尚不代表任何新增产品行为或变异验收已通过。
