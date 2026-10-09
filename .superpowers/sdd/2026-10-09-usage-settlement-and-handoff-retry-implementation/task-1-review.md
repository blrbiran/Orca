# Task 1 fresh review

## Spec Compliance

- ✅ Task 1 spec compliant。本次为 D9 task gate；优先按 spec §9.2、§9.4、§9.5 审查。未发现 Task 1 缺项、越界功能或误解需求的阻断问题。
- 归属：Codex review_settlement_task；2026-10-09（Asia/Shanghai）。固定审查 BASE `2c14e7378684c48ae33b5777ba9a3c430287a586`、HEAD `405f6b62ae08b546269fcb054e28b75a9cdb7c17`。后续 controller 文档提交不在审查范围。
- ✅ 命令、payload、service、真实 HTTP route、human-only 分类、activity/error/wire/locales 与 schema10 均有对应 hunk：`src/control/webProtocol.ts:674`、`src/control/webService.ts:648`、`src/panel/controlApi.ts:429`、`src/panel/humanOnly.ts:23`、`src/control/migrations.ts:3`。brief 具名的现有判据只同步版本/封闭集合，保留旧断言；entry skill 和 archived-group 调用表已追加新 verb（`tests/entry/skill.test.ts:24`、`tests/control/archiveGroup.test.ts:182`）。
- ⚠️ Task 2 的 M3 完整 retry→claim、Task 3 的确认 UI/活动渲染及整轮集成门不由此 diff 证明；它们是明确的后续任务，不计为 Task 1 缺失。新面板权限测试在 listener 已认证 principal 的边界注入身份，未重新执行登录/JWT 测试（`tests/panel/settleUnknownUsage.test.ts:10`）。

## Strengths

- **实际授权边界完整。** 路由先从 listener 的 `res.locals.orcaPrincipal` 取身份，经 `permissionRefusal` 判 owner，再解析请求、构造 authority command 和设置异步 command context（`src/panel/controlApi.ts:441`、`:447`、`:453`）。权限表只给 owner humanOnly（`src/panel/permissions.ts:17`）；socket 必须是 agent，handler 另拒绝无 Web/user context（`src/control/settleUnknownUsage.ts:44`）。测试用真实 TCP/Unix socket 与真实 driver evidence 检查 200/403、receipt principal 及拒绝时零账变更（`tests/panel/settleUnknownUsage.test.ts:17`）。未发现 actorId/acknowledge 的身份旁路。
- **账和承诺区分准确。** 两桶四维 remaining 一并计用；committed 才扣 reserved，released 保留其它任务承诺，task allocation/work grant 没有被重写。累计、unknown、ledger、预算镜像、marker、request 与 activity 均位于同一 authority transaction（`src/control/settleUnknownUsage.ts:56`、`:72`、`:73`、`:74`、`:83`）。零 token 不写 ledger，非零量按人工时刻记 unattributed（`src/control/usageLedger.ts:84`）。对应实测断言在 `tests/control/settleUnknownUsage.test.ts:29`、`:62`、`:196`、`:224`、`:264`。
- **marker 是证据链。** 严格 schema 限定 disposition/resolution；reader 对照身份、highWater、两桶 remaining/unknown、provider cumulative、内容寻址 report/proof、已提交 Web user receipt 和 released request/checkpoint（`src/control/usageSettlement.ts:12`、`:48`、`:63`、`:69`、`:88`）。released 重新检查 missing、unresolved、snapshot 和各 artifact（`:79`、`:82`），不只信 failureCode。事务再次核对整个 run 和证据（`src/control/settleUnknownUsage.ts:62`）；读视图拒绝非法 marker（`src/panel/controlViews.ts:732`）。
- **停止收口没有重复释放。** released 只改 run/request 到 settled-failed，保留 endedAt 和原 failureCode；专用转换没有调用 terminaliseRun/releaseCommitment，也没有第二笔 run-settled。完整 frozenRunIds 被重新推导，只有本次尚未落 receipt 的已验证 request 被临时替代（`src/control/settleUnknownUsage.ts:79`、`src/control/stopIntent.ts:255`、`:907`）。测试保留其它未知/open request blocker（`tests/control/settleUnknownUsage.test.ts:206`）；committed marker 冒充人工 request 的读路径被拒绝（`:280`）。
- **§9.5 顺序真实可达。** `hasObservedUsage` 在 marker 存在时调用共享有效性校验，独立 checkpoint 守卫仍保留（`src/control/budget.ts:158`、`src/control/driverHandoff.ts:326`、`:338`）。fixture 的成功证据来自实际 claim/driver/report/H-step，未预写成功状态（`tests/control/fixtures/unknownFailure.ts:10`、`:33`、`:44`）。从未报 work non-null 的结清→handoff 测试验证 recoverable/complete；缺失证据仍 partial（`tests/control/settleUnknownUsage.test.ts:82`、`:252`）。
- **重放与持久化测试有作用。** 原 usage event hash 重放先返回，marker 之后的新 event 才拒绝（`src/control/usage.ts:17`、`:22`）。rollback/reopen/replay 覆盖 command、账、activity 和 request（`tests/control/settleUnknownUsage.test.ts:149`）；schema10/11 测试保持旧行与拒绝后的字节（`tests/control/schema10.test.ts:20`、`:33`）。真正旧 reader 证据脚本导入旧 clone 的 openControlStore/schemaVersion 后断言拒绝10且库字节相等（`/private/tmp/orca-task1-clones/old-v9/old-reader-check.ts:5`、`:9`）。

## Issues

### Critical

- 无。

### Important

- 无。

### Minor

- **验证输出有非业务警告。** `/private/tmp/od9/logs/task1-target-final.log:4` 含 Node SQLite ExperimentalWarning（多个 worker 重复）；`/private/tmp/orca-task1-web-build.log:14` 含大于 500 kB 的 bundle 提示。均未掩盖失败、skip 或异常，且不是本次 D9 功能错误；后续统一验证环境/前端体积工作应显式处理，不能把本次输出称作无警告。不要求在 Task 1 扩围修复。

## Evidence checks

- 审查未跑测试、未改产品/测试、未执行 git 命令、未改 index/HEAD/branch、未派子 agent。唯一新写入为本报告。完整 diff 工具输出首次截断，随后按未显示的文件/hunk补齐；没有重新生成 diff，也没有把当前后续文档改动纳入。
- 具名跨文件风险核对：权限信任链检查 `permissions.ts` / `commandClient.ts` 与 route 被 diff 截断的函数中段；共享 marker 对旧调用者影响检查 `budget.ts`、`driverHandoff.ts:308`、`checkpoints.ts:26`、`executionDriver.ts:119` 与现有 `retryTask.ts:35`；unknown 来源检查 Web claim 初始化与 usage writer，确认支持范围内未知标记来自 null provider event。未因此扩成全库终审。
- 完整读取实施者原始 target/typecheck/build/old-reader、21 个有效 mutation 和最终恢复日志。`task1-target-final.rc=0`，原始日志为 9 文件 122 tests passed；`task1-typecheck-final.rc=0`。恢复日志 3 文件 42 tests passed、无 skip。命令和观测基线沿用 report 中的原始记录；本次只审其证据，不宣称重新运行。
- 只读 Python AST 提取 `/private/tmp/task1-mutate.py` 的删除锚点，并对当前未变产品逐项定位；21 个有效锚点均唯一。最终 mutation clone 与交付29路径逐字节比较，仅 `tests/control/fixtures/unknownFailure.ts` 末尾多一个空白，rstrip 后相同；其它28路径完全相同。比对命令为 `rtk proxy python3`（AST解析变异脚本、Path.read_bytes比较）；本次固定审查 HEAD如上，controller已说明当前额外提交仅文档。
- `/private/tmp/orca-task1-mutation-final.log` 记录各次 unstaged/cached diff 均0字节；`/private/tmp/orca-task1-zero-final-run.log` 记录精确零token变异 RC1 和最终恢复 RC0/两份diff均0字节。最初误删其它函数同名 guard 的 zero-token-ledger RC0 **未计入**有效21项，已由 zero-token-final 替代。

### 21 项最终代码与实际断言对应

以下原始日志全部位于 `/private/tmp/orca-task1-clones/logs/<名称>.log`；每项有效执行 RC1，均为下列被测调用之后的业务断言失败，非启动/import错误。control 测试行号指 `tests/control/settleUnknownUsage.test.ts`；只有 human-only 指 panel 同名测试。

| 名称 | 最终删除点 | 原始断言位置/结果 |
|---|---|---|
| committed-reserved | settleUnknownUsage.ts:73 | control:31，reserved未减 |
| released-admission | settleUnknownUsage.ts:39 | control:60，合法released被拒 |
| released-reserved | settleUnknownUsage.ts:73 | control:62，其它承诺被扣 |
| manual-close | settleUnknownUsage.ts:86 | control:76，partial未complete |
| marker-observed | budget.ts:158 | control:87，误成unrecoverable |
| human-only | panel/humanOnly.ts:23 | panel:36，member200/socket500而非403 |
| proof-content | usageSettlement.ts:66 | control:119，未隔离证据获准 |
| pending | settleUnknownUsage.ts:28 | control:119，pending获准 |
| settled-replay | settleUnknownUsage.ts:21 | control:42，refusal变not-unknown |
| late-event | usage.ts:22 | control:47，迟到事件不抛错 |
| checkpoint-missing | usageSettlement.ts:80 | control:142，missing获准 |
| checkpoint-unresolved | usageSettlement.ts:80 | control:142，unresolved获准 |
| transaction-recheck | settleUnknownUsage.ts:62 | control:169，变动remaining获准 |
| ledger | settleUnknownUsage.ts:76 | control:36，缺两笔账 |
| other-unknown | budget.ts:81 | control:214，组unknown误清 |
| marker-receipt | usageSettlement.ts:109 | control:187，假receipt被认valid |
| manual-provenance | stopIntent.ts:203 | control:287，伪造人工request未拒 |
| group-used | settleUnknownUsage.ts:72 | control:30，used未增 |
| zero-token-final | usageLedger.ts:85 | control:264，多两行0token |
| claim-cap | webDispatch.ts:230（既有守卫） | control:243，total/week/month均误claimed |
| checkpoint-artifacts | usageSettlement.ts:82 | control:142，缺snapshot/handoff均获准 |

## Assessment

**Task quality: Approved.**

Task 1 的 owner 权限、两种承诺账、证据与事务一致性、人工请求收口及§9.5顺序均有实现和能被对应删除变异击中的真实流程判据。仅保留验证噪声 Minor；本结论不替代 Task 2/3 或最终分支集成审查。

## 引用行号更正（同 reviewer，2026-10-09，审查 HEAD 405f6b6）

- 最后用 `rtk rg -n` 按实际符号测得：payload schema 在 `src/control/webProtocol.ts:677`（上文674）；service方法在 `src/control/webService.ts:655`（上文648）；skill schemaByVerb条目在 `tests/entry/skill.test.ts:22`（上文24）；archived-group CALLS条目在 `tests/control/archiveGroup.test.ts:189`（上文182）；视图marker拒绝行在 `src/panel/controlViews.ts:739`（上文732）；完整frozen集合派生函数在 `src/control/stopIntent.ts:256`（上文255）。更正这些引用定位；对应代码判断和 Approved 结论不变。历史正文依仓库规则保留。
