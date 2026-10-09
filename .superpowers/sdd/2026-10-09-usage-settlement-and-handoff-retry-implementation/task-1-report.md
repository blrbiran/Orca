# Task1 D9 实施报告

归属：Codex implement_settlement；日期：2026-10-09（Asia/Shanghai）。工作树 `/Users/biran/.codex/worktrees/usage-settlement-handoff-retry/Orca`，分支 `codex/d9-m3-implementation`，观测 BASE `2c14e7378684c48ae33b5777ba9a3c430287a586`。
产品提交：`43b0f165fb151934cfac9e47de85e9f727aecf77`（feat(control): settle unknown usage through owner authority）。报告以独立具名提交保存；未 push/merge。

## 交付

- `applySettleUnknownUsage` / `WebControlService.settleUnknownUsage` / owner-only group HTTP route 和严格 payload 已接通。认证 `principal` 由既有 listener permission gate + command context 传入；member 和 socket/MCP agent 均 403，actorId/acknowledge 不构成授权。直接无认证调用拒绝。
- committed：两桶四维 remaining 加入 cumulative/group.used，扣同一份 reserved；released：只加 used，reserved/其它任务 commitment 完全不动。allocation amount/state 与 work grant 保留，reserve/proposal/ledger/budgetVersion 同事务同步。超额照实形成 deficit，已有 breaches 保留。
- 每桶非零 token 结清量写 unattributed usage_ledger，applied_at 为人工结清时间；0token 不写行。marker、usage activity、command receipt、run/request/预算写入全事务回滚。旧事件按原 hash 重放，迟到新事件拒绝，不伪造 provider event、不推进 highWater。
- 共享 `usageSettlementSchema` / `hasValidUsageSettlement` 严格核对 run identity/generation/highWater、两桶零 remainder/known、charged 与最后 provider cumulative、内容地址 report/隔离 stop proof、已提交 Web user receipt；released 还验证原 checkpoint 全部 artifacts/snapshot/missing/unresolved 和手动 request 关联。出现未知字段/非法 marker 不降级为旧 reader。
- released 的 usage-only handoff failure 专用收口到 request/run settled-failed；保留原 failureCode/evidence/checkpoint/endedAt；不重复 terminaliseRun/releaseCommitment、不新增第二笔 run-settled、不清 stop、不启动 provider。使用完整 frozen 集重算 stop；其它未知或 open request 继续阻塞。
- 两个真实操作顺序均可达：失败→unknown→人工结清→handoff complete→空选 resume；失败→unknown→handoff partial→人工结清→complete→空选 resume。前者即使 provider 从未为 work 报 non-null，也由有效 marker 证明账已结清，独立的 checkpoint 缺失守卫仍有效。
- schema10 单向门、schema9 旧行保留、schema11 新 reader 拒绝、真正旧版本 v9 reader 拒绝10已验证；wire/read preview/activity/request states 与 en/zh 最小错误/枚举已注册。Task3 的确认UI/完整活动渲染未混入本task。

## 精确范围与旧判据

- `skills/orca-control/SKILL.md`
- `src/control/activity.ts`
- `src/control/budget.ts`
- `src/control/errors.ts`
- `src/control/migrations.ts`
- `src/control/stopIntent.ts`
- `src/control/store.ts`
- `src/control/usage.ts`
- `src/control/usageLedger.ts`
- `src/control/webProtocol.ts`
- `src/control/webService.ts`
- `src/entry/operations.ts`
- `src/panel/controlApi.ts`
- `src/panel/controlErrors.ts`
- `src/panel/controlViews.ts`
- `src/panel/humanOnly.ts`
- `tests/control/archiveGroup.test.ts`
- `tests/control/schema8.test.ts`
- `tests/control/schema9.test.ts`
- `tests/entry/skill.test.ts`
- `web/src/controlTypes.ts`
- `web/src/locales/en.ts`
- `web/src/locales/zh.ts`
- `src/control/settleUnknownUsage.ts`
- `src/control/usageSettlement.ts`
- `tests/control/fixtures/unknownFailure.ts`
- `tests/control/schema10.test.ts`
- `tests/control/settleUnknownUsage.test.ts`
- `tests/panel/settleUnknownUsage.test.ts`

以上29个产品/测试/文档路径按名称stage。未stage controller progress、性能spec/plan、node_modules软链；未修改主要工作区产品或索引。

既有判据仅按 brief 授权具名同步：schema8 三项最终9→10；schema9 fresh/populated 最终10、future11，STRICT/FK/index/pre-ledger/旧行/幂等/字节不变断言全保留；entry skill 三项封闭全集32→33与新 payload schema；archiveGroup CALLS 追加新service/payload并保留group-archived拒绝。未修改其它封闭枚举旧判据、旧 issue-fixes 证据或发布spec历史。历史注释保留，追加D9更正。

## 验证命令与原始证据

所有测量命令 cwd 为上述工作树，Shell 入口均用 rtk；定向判据固定 `ORCA_CCLOOP_BIN=/private/tmp/orca-d9-ccloop-ab824d1/dist/cli.js`。最终门用 controller `/private/tmp/od9/run.py` 的隔离 HOME/XDG/TMPDIR/CCMEM_DATA_ROOT 环境。日志重定向后完整整读，没有 grep/tail/head/sed 验证过滤。所有产品测量在 BASE2c14e73+Task1未提交diff观测；产品commit只增加fixture末尾空白整理，逻辑与验收相同。

| 命令 | RC / 结果 | 完整原始日志 |
|---|---|---|
| `rtk proxy env ORCA_CCLOOP_BIN=... node_modules/.bin/vitest run tests/control/settleUnknownUsage.test.ts tests/control/schema10.test.ts` RED | 1；四个真实操作判据因缺 command method 失败，schemaVersion9≠10 | `/private/tmp/orca-task1-red4.log` |
| `rtk proxy npm run build --workspace web`（panel判据前） | 0；bundle构建；已有chunk-size提示 | `/private/tmp/orca-task1-web-build.log` |
| `rtk proxy python3 /private/tmp/od9/run.py task1-typecheck-final npm run typecheck` | 0 | `/private/tmp/od9/logs/task1-typecheck-final.log`、`.rc` |
| `rtk proxy python3 /private/tmp/od9/run.py task1-target-final node_modules/.bin/vitest run tests/control/settleUnknownUsage.test.ts tests/control/schema10.test.ts tests/panel/settleUnknownUsage.test.ts tests/panel/permissions.test.ts tests/control/schema8.test.ts tests/control/schema9.test.ts tests/control/webProtocol.test.ts tests/entry/skill.test.ts tests/control/archiveGroup.test.ts` | 0；9文件122条，全运行无skip | `/private/tmp/od9/logs/task1-target-final.log`、`.rc` |
| `rtk proxy node_modules/.bin/tsx /private/tmp/orca-task1-clones/make-schema10.ts` | 0；专用新schema10库 | `/private/tmp/orca-task1-new-reader2.log` |
| old-v9 cwd：`rtk proxy node_modules/.bin/tsx old-reader-check.ts` | 0；真正 c29676d 的 schemaVersion9/openControlStore 拒绝10；数据库字节不变 sha256=`63692ddcde53f9a28cd113bde1d19f4a9767266125fdf1d69a32460baeb33426` | `/private/tmp/orca-task1-old-reader.log` |
| `rtk proxy /usr/bin/git diff --cached --check`（fixture EOF修正后） | 0 | 本地工具记录；产品commit hook `/private/tmp/orca-task1-product-commit-final.log` |

中间调试完整日志 `/private/tmp/orca-task1-*.log` 保留。最初 sandbox 的 ps EPERM 不算业务RED；RED2/3发现 router 冻结port methods，fixture重新绑定真实unknown collect后RED4满足要求。超额fixture首次试图在unknown后set-limit，被既有recovery guard正常拒绝；controller裁定改为真实provider先超额再unknown，未放宽set-limit。临时tsx脚本首次CJS top-level await错误修正后新/旧reader验证才计入证据。原始第一次EOF检查发现新fixture额外空行，整理后diff-check/hook通过。

## 删除变异

专用 `/private/tmp/orca-task1-clones/mutation` 和 `/private/tmp/orca-task1-clones/old-v9` 均由 `rtk proxy /usr/bin/git clone --local --no-hardlinks` 建立，未触主工作树；脚本 `/private/tmp/task1-prepare-clones.py` 逐字同步29个Task1路径。

有效变异主要 clone BASE `2d6d2c70aece3d629c92c30f15dc0840d9035470`；精确零token修正与最终还原 BASE `925a21385b37d674e5046e775de58fe4a4daa144`。clone内部具名提交仅作变异基线，不向产品分支合入。每次 mutate→真实测试→恢复后 `git diff` 与 `git diff --cached` 实测均0字节。脚本 `/private/tmp/task1-mutate.py`、`/private/tmp/task1-zero-final.py`；运行记录 `/private/tmp/orca-task1-mutation-final.log`、`/private/tmp/orca-task1-zero-final-run.log`。

每条命令为 clone cwd `rtk proxy <clone>/node_modules/.bin/vitest run <test> -t <pattern> --reporter=dot`。-t是点名变异判据的定向执行，其它测试被runner标skip；正常/还原门不使用-t。以下21项全部在被测调用后的具体业务断言见红（非启动/import异常）。

| 删除点 | 点名判据/模式 | 看到的断言红 | RC | 原始日志 |
|---|---|---|---|---|
| `src/control/settleUnknownUsage.ts` / committed-reserved | `charges both buckets`（`tests/control/settleUnknownUsage.test.ts`） | reserved 没有扣去 charged，四维承诺断言失败 | 1 | `/private/tmp/orca-task1-clones/logs/committed-reserved.log` |
| `src/control/settleUnknownUsage.ts` / released-admission | `charges a released failed handoff`（`tests/control/settleUnknownUsage.test.ts`） | 合法 released 分支被拒绝，usage-settled 成功断言失败 | 1 | `/private/tmp/orca-task1-clones/logs/released-admission.log` |
| `src/control/settleUnknownUsage.ts` / released-reserved | `charges a released failed handoff`（`tests/control/settleUnknownUsage.test.ts`） | 另一个任务承诺被错误扣去，committedRemaining 相等断言失败 | 1 | `/private/tmp/orca-task1-clones/logs/released-reserved.log` |
| `src/control/settleUnknownUsage.ts` / manual-close | `completes only`（`tests/control/settleUnknownUsage.test.ts`） | hand-off partial 未收口 complete，停止状态断言失败 | 1 | `/private/tmp/orca-task1-clones/logs/manual-close.log` |
| `src/control/budget.ts` / marker-observed | `settlement before handoff counts`（`tests/control/settleUnknownUsage.test.ts`） | 从未报 work non-null 的失败被错误结为 unrecoverable，request recoverable 断言失败 | 1 | `/private/tmp/orca-task1-clones/logs/marker-observed.log` |
| `src/panel/humanOnly.ts` / human-only | `authenticated principal`（`tests/panel/settleUnknownUsage.test.ts`） | member 200 / socket 500 而非 403，HTTP 权限断言失败；member 实际结账 | 1 | `/private/tmp/orca-task1-clones/logs/human-only.log` |
| `src/control/usageSettlement.ts` / proof-content | `refuses isolation`（`tests/control/settleUnknownUsage.test.ts`） | 内容地址合法但 isolated=false 的原始证明被接受，拒绝码断言失败 | 1 | `/private/tmp/orca-task1-clones/logs/proof-content.log` |
| `src/control/settleUnknownUsage.ts` / pending | `refuses pending`（`tests/control/settleUnknownUsage.test.ts`） | 有 highWater 之后事件仍结账，run-usage-pending 断言失败 | 1 | `/private/tmp/orca-task1-clones/logs/pending.log` |
| `src/control/settleUnknownUsage.ts` / settled-replay | `charges both buckets`（`tests/control/settleUnknownUsage.test.ts`） | 结清后的只读/新命令原因变 not-unknown，run-usage-settled 断言失败 | 1 | `/private/tmp/orca-task1-clones/logs/settled-replay.log` |
| `src/control/usage.ts` / late-event | `charges both buckets`（`tests/control/settleUnknownUsage.test.ts`） | 迟到新事件未抛 run-usage-settled，拒绝断言失败 | 1 | `/private/tmp/orca-task1-clones/logs/late-event.log` |
| `src/control/usageSettlement.ts` / checkpoint-missing | `a missing defect`（`tests/control/settleUnknownUsage.test.ts`） | missing 非空 checkpoint 被接受，拒绝码断言失败 | 1 | `/private/tmp/orca-task1-clones/logs/checkpoint-missing.log` |
| `src/control/usageSettlement.ts` / checkpoint-unresolved | `a unresolved defect`（`tests/control/settleUnknownUsage.test.ts`） | unresolvedRequestIds 非空 checkpoint 被接受，拒绝码断言失败 | 1 | `/private/tmp/orca-task1-clones/logs/checkpoint-unresolved.log` |
| `src/control/settleUnknownUsage.ts` / transaction-recheck | `rechecks changed remaining`（`tests/control/settleUnknownUsage.test.ts`） | 证据读取后 remaining/cumulative 变动仍结账，事务拒绝断言失败 | 1 | `/private/tmp/orca-task1-clones/logs/transaction-recheck.log` |
| `src/control/settleUnknownUsage.ts` / ledger | `charges both buckets`（`tests/control/settleUnknownUsage.test.ts`） | 缺两笔 unattributed bucket rows，usage_ledger rows 断言失败 | 1 | `/private/tmp/orca-task1-clones/logs/ledger.log` |
| `src/control/budget.ts` / other-unknown | `unknown/open request blocker`（`tests/control/settleUnknownUsage.test.ts`） | 另一 run 仍 unknown 却清 group usageUnknown，boolean 断言失败 | 1 | `/private/tmp/orca-task1-clones/logs/other-unknown.log` |
| `src/control/usageSettlement.ts` / marker-receipt | `fake receipt marker`（`tests/control/settleUnknownUsage.test.ts`） | 不存在 authority receipt 的 marker 被视为 valid，boolean 断言失败 | 1 | `/private/tmp/orca-task1-clones/logs/marker-receipt.log` |
| `src/control/stopIntent.ts` / manual-provenance | `backed only by a committed settlement marker`（`tests/control/settleUnknownUsage.test.ts`） | committed marker 冒充人工失败 request，stop reader 未抛拒绝，断言失败 | 1 | `/private/tmp/orca-task1-clones/logs/manual-provenance.log` |
| `src/control/settleUnknownUsage.ts` / group-used | `charges both buckets`（`tests/control/settleUnknownUsage.test.ts`） | used 未加 charged，四维 used 断言失败 | 1 | `/private/tmp/orca-task1-clones/logs/group-used.log` |
| `src/control/usageLedger.ts` / zero-token-ledger | `no zero-token ledger rows`（`tests/control/settleUnknownUsage.test.ts`） | 精确 D9 分支删除后新增两行0token，ledger 全行相等断言失败 | 1 | `/private/tmp/orca-task1-clones/logs/zero-token-final.log` |
| `src/control/webDispatch.ts` / claim-cap | `gates the next retry claim`（`tests/control/settleUnknownUsage.test.ts`） | 真实下一次 retry claim 变 claimed，total/week/month 三条 cap 拒绝断言失败 | 1 | `/private/tmp/orca-task1-clones/logs/claim-cap.log` |
| `src/control/usageSettlement.ts` / checkpoint-artifacts | `a snapshot defect|a artifact defect`（`tests/control/settleUnknownUsage.test.ts`） | 缺 snapshot/handoff bytes 的 checkpoint 被接受，两条拒绝码断言失败 | 1 | `/private/tmp/orca-task1-clones/logs/checkpoint-artifacts.log` |

零token变异首次脚本误删同名 bookReconcileUsage guard，RC0，日志 `zero-token-ledger.log`；它没有删除D9自身，因此不算有效变异。精确定位 bookSettledUsage 自身守卫后 `zero-token-final.log` RC1，额外两行0token断言明确红。生产不因此增加任何代码。

最终恢复命令：clone cwd `rtk proxy <clone>/node_modules/.bin/vitest run tests/control/settleUnknownUsage.test.ts tests/control/schema10.test.ts tests/panel/settleUnknownUsage.test.ts --reporter=dot`；RC0，3文件42条无skip，完整日志 `/private/tmp/orca-task1-clones/logs/restored-final.log`；随后 unstaged/cached diff 都0字节。cap变异只删除clone里的既有claim guard；主产品的webDispatch未改变。

## Self-review 与交接

自审逐一核对 owner/listener permission gate→context→receipt；人工marker与真实provider event分离；两个 reservationDisposition 分支；run/request/account/activity/command事务与重放；released不重复释放/结束记录；frozen全运行stop重算；reader不接受伪造manual request。自审发现“仅有效committed marker也可能被任意request settled-failed冒用”，已经补严格released disposition +对应requestId关联，真实伪造场景和删除该关联均验证。

新增共享fixture是为了生成真正driver terminal report与H-step archive/checkpoint/request，不预写最终成功状态。缺证据/错误身份/marker篡改仅用于失败注入，且断言测量被测调用后的业务结果。§9.5 的成功判据使用从未为work报non-null的合法报告，删除marker observed分支明确变成unrecoverable；已有两桶报告的场景不冒充该证据。

供Task2：共享 `hasValidUsageSettlement(store, run)` 接受不同持久run类型；released marker有 `reservationDisposition` / `handoffResolution`；request的新settled-failed属于SETTLED且非ADOPTABLE。D9 released之后work仍blocked/allocation terminal，M3 retry来源由Task2实现。供Task3：`RunViewV1.unknownUsageSettlement={generation,highWater,remaining:{work,handoff},allowed,refusalReason,settlement?}`，其中allowed仅表示服务器业务资格；owner控件仍按认证角色决定，settlement带method/charged/at/principal。

剩余按任务分工交给Task2/Task3/Task4：M3真实retry/next claim整条链、完整UI和全套 integrated gates；本task未宣称整轮完成。无新增未裁定方案冲突，无真实用户数据/服务/付费模型访问，无subagent、push、merge、删除worktree/branch。

自动权限审查曾对python包装精确git-stage超时（不等同不安全）；按工具允许重试一次，直接具名git add已成功。未因此要求用户重复确认。金额/时钟/测试结果均取实际输出；累计token/费用工具未提供，未估算。
