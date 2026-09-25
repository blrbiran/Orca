# 变异电池台账 — handoff delivery（Task 1–10）

来源：每条从对应 task-N-report.md 逐条抄录（task 归属、变异内容、命中判据／等价理由）。
本文件是 Task 10 新建，`git add -f` 单独入库；不改 `progress.md`。

## Task 1（ccloop，commit a5dc529..3d0fc5c）

| ID | 文件 | 变异 | 实测红（且仅） | 判定 |
|---|---|---|---|---|
| T1-M1 | fake-codex.mjs | 删 delayMs 睡眠等三处 | sleeps delayMs…／writes no script file…／chooses the #continuation entry…（3 条） | 符合预言 |
| T1-M2 | fake-codex.mjs | 删 continuation 选键 | chooses the #continuation entry…（1 条） | 符合预言 |
| T1-M3 | fake-codex.mjs | 删 continuation 回退 | chooses the #continuation entry…／falls back to the plain entry…（2 条） | 符合预言 |
| T1-M4 | handoff.ts（packet unresolvedRequestIds） | 恒为空数组的逻辑删除 | allows request:null…／answers its request…（2 条） | 符合预言 |
| T1-M5 | handoff.ts（candidate unresolvedRequestIds） | 同上 | 同 T1-M4（2 条） | 符合预言 |
| T1-M6 | handoff.ts（删 execute_started→entered） | still lists an entered phase whose file is absent…（1 条） | 符合预言 |
| T1-M7 | handoff.ts（删 execution_finished→entered） | 同 T1-M6（1 条） | 符合预言 |
| T1-M8 | handoff.ts（删终态守卫） | keeps requiring all three phase files for terminal runs…／derives blocked facts and explicit logs without an LLM call（2 条） | 符合预言 |
| T1-M9 | handoff.ts（删 attempt 号过滤） | counts only the current attempt's events as entered（1 条） | 符合预言 |
| T1-M10 | handoff.ts（删 entered 过滤跳过） | does not list the execute and verify files…／does not list the verify file…／still lists an entered phase…／counts only the current attempt's events…／answers its request…（5 条） | 符合预言 |

10 条全部实测红集与预言逐条一致；还原 sha256 前后一致，`git diff`／`git diff --cached` 该文件 0 字节。

## Task 2（ccloop，commit 3d0fc5c..8a76c98，fix round → acc9b4b）

| ID | 文件 | 变异 | 实测红（且仅） | 判定 |
|---|---|---|---|---|
| T2-M1 | runCodexPhase.ts | 删 observedTokens 填值 | returns the observed tokens…／carries the observation…／books the observed tokens…（3 条） | 符合预言 |
| T2-M2 | protocol.ts | 删 `\|\| input+output===0` | reads the last well-formed turn.completed usage…（1 条） | 符合预言 |
| T2-M3 | codexAdapter.ts | 删 CodexPhaseAborted 抛出 | carries the observation…／books the observed tokens…（2 条） | 符合预言 |
| T2-M4 | codexAdapter.ts | execute catch 还原旧版 | carries the observation…／books the observed tokens…（2 条） | 符合预言 |
| T2-M5 | runLoop.ts | settlePhase 不带 tokenUsage | books the observed tokens…（1 条） | 符合预言 |
| T2-M6 | types.ts | observedTokensOf 恒返回 null | books the observed tokens…（1 条） | 符合预言 |
| T2-M7 | fake-codex.mjs | usageBeforeDelay 恒 false | returns the observed tokens…／carries the observation…／books the observed tokens…（3 条） | 符合预言 |
| T2-M8（本 Task 新增，D-C7′(α)） | handoff.ts | 删 handoff_interrupted 分支 | does not list an entered phase's file as missing when a handoff deadline interrupted it (D-C7' (α))（1 条） | 符合预言 |

8 条全部实测红集与预言一致；sha256 还原一致；副本已跟踪文件 `git diff`／`git diff --cached` 0 字节。

## Task 3（Orca，commit 29fe36d..09aac91）

| ID | 文件 | 变异 | 实测红 | 判定 |
|---|---|---|---|---|
| T3-M1 | stopIntent.ts | 删整个 settled-restartable 分支 | handoffStop 判据 1（work_items 仍 held） | 符合预言 |
| T3-M2 | stopIntent.ts | 非续跑支也置 allocation held | handoffStop 判据 1（allocation state） | 符合预言 |
| T3-M3 | stopIntent.ts | 删续跑子支（等价处理） | Task 3 范围内 71/71 全绿，**不红**——T5 才有承重判据 | **登记，不算缺口**（T5-M13 表已用 T3-M3 复测，见红：C-6 那条 status 非 held） |
| T3-M4 | stopIntent.ts | settleCompletedRunRequestInTransaction 误调 terminaliseRun | handoffStop 判据 2 | 符合预言 |
| T3-M5 | stopIntent.ts | deadlineAt 取自请求行而非 outbox | handoffStop 判据 3 前半 | 符合预言 |
| T3-M6 | stopIntent.ts | reason 恒 "human" | handoffStop 判据 3 后半 | 符合预言 |
| T3-M7 | stopIntent.ts | freezeRun 还原旧拒绝 | handoffStop 判据 5 ＋ 改写版 stopIntent 判据 | 符合预言 |
| T3-M8 | checkpoints.ts | persistCanonicalCheckpoint 恢复 JSON.stringify | handoffStop 判据 6（checkpoints.test.ts 9/9 仍绿，证明 persistImmutableCheckpoint 未被波及） | 符合预言 |
| T3-M9 | checkpoints.ts | same() 去掉字节比较 | handoffStop 判据 7 | 符合预言 |
| T3-M10 | resumeBundle.ts | 删 settled-recoverable 分支 | Task 3 范围内 91/91 全绑，不红 | **登记，不算缺口**（T4 报告用 Controller-M10 复测该函数邻近逻辑见红；T4-M19/M20/M21 覆盖 D-VIEW／D-SNAP 侧；本条本身在 T4 报告以「Controller M10」条目复测 persistCanonicalCheckpoint，settled-recoverable 分支专属判据留在 T4 criterion 2「resume-from-handoff 被拒绝」——已用 T3-M10（deferred from Task 3）行确认：criterion 2 红 `ControlError: resume-predecessor-unrecoverable`） |
| T3-M11 | resumeBundle.ts | readExistingResumeBundle 删 manifest 校验 | Task 3 范围内不红，无调用方 | **登记，不算缺口**（T5 报告 T5-M5 用「continuationBundle 不接 resume-bundle-exists」复测同一函数族，见红：A2-after-bundle 两条） |

## Task 4（Orca，commit 09aac91..38180fc，fix round → a70ce4e）

主表（22 条 + Controller M10 + T3-M10 + N1/N2/N3/N3b）：

| ID | 变异 | 结果 |
|---|---|---|
| T4-M1 | round 恒调 advance | 17/19 红（除两条 X1 外全超时） |
| T4-M2 | visitOrder 换回 driverRunIds | 6 红（两条 H5、accept-refused、两条 H8、"lands a run that finished before…"） |
| T4-M3 | 删 X1 分支 | X1 "is blocked by name at C…" 超时 |
| T4-M4 | X1 少判 openRequestOf===null | **红**（新判据 (a)，预言不红，本轮补判据后见红） |
| T4-M5 | settled 分支返回 false | 3 红（两条 H5、"lands a run that finished…"） |
| T4-M6 | start-pending 恒 restart | "restarts a prepared run ccloop never saw"／"does not restart…"两条 |
| T4-M7 | absent 当 unknown | "restarts a prepared run ccloop never saw…"超时 |
| T4-M8 | restartRun 删工作区清理 | 同上（workspace 仍在） |
| T4-M9 | 请求体从行重建而非 outbox | criterion 1 |
| T4-M10 | 删投递后落 collecting | 10 红（含重投判据） |
| T4-M11 | 删「终态回 stepC」 | **红**（新判据 (b) D-LANDED，预言不红，补判据后见红） |
| T4-M12 | settleIfPastGrace 恒 false | grace 判据超时 |
| T4-M13 | grace 只比 deadline | **红**（收紧后的 grace 判据，预言不红，本轮收紧后见红） |
| T4-M14 | C-5 支改 restartRun | 两条 H8 超时 |
| T4-M15 | 删 accept-refused 检查 | **红**（收紧后的 accept-refused 判据，预言不红，本轮收紧后见红） |
| T4-M16 | result 取 raw.result | criterion 1／2／C-5 park |
| T4-M17 | H-settle 走 commitCandidate | 7 红 |
| T4-M18 | 删 usage-unsettled 原因 | **红**（新判据 (a) usage-unsettled，预言不红，补判据后见红） |
| T4-M19 | frozenAllocationShape 恒返回 allocation | criterion 1 |
| T4-M20 | 读模型不用 settledShape | criterion 1 |
| T4-M21 | D-VIEW claimed 恒用 run.grant | criterion 1 |
| T4-M22 | D-VIEW 删 `current &&` | **不红（86/86）** — 需要续跑领取后的非当前 run，Task 4 范围不存在 |
| Controller M10（C-1 canonical bytes） | persistCanonicalCheckpoint 写 JSON.stringify | criterion 1／2（resume-from-handoff 拒绝） |
| T3-M10（deferred from Task 3） | resumeBundle 删 settled-recoverable 分支 | criterion 2：`ControlError: resume-predecessor-unrecoverable` |
| N1（ruling） | deriveStopState active-run 行删 | stopIntent 新判据 |
| N2（D-LANDED） | `landedCommit !== null` 守卫删 | D-LANDED 判据 |
| N3（D-STOPINSPECT） | outcome-unknown settle 删 | D-STOPINSPECT 判据超时 |
| N3b（D-STOPINSPECT） | unknown under stop 走 advance | D-STOPINSPECT 判据（11 vs 10） |

除 T4-M22 外全部见红；M4/M11/M13/M15/M18 五条 brief 预言不红的，均由本轮新增或收紧的判据钉红（Rule 9）。**T4-M22 顺延到 Task 5**，T5 报告确认红（见下 Task 5 表）。

Task 4 Fix round 1（11 条，commit a70ce4e）：

| ID | 变异 | 结果 |
|---|---|---|
| F1-probe | closeBlocked 删探测行 | 3 红：D／R／探测失败三条 |
| F1-R | 条件去掉 `at === "R"` | 1 红：R 那条 |
| F1-D | 条件去掉 `at === "D"` | 2 红：D、探测失败 |
| F1-catch | catch 改 `return false` | 1 红：探测失败那条 |
| F2-unresolved | 删 unresolved-requests 行 | 1 红 |
| F2-missing | 删 missing 行 | 1 红 |
| F2-snapshot | 删 snapshot-missing 行 | 1 红 |
| F2-pending | usage-unsettled 少判 pending gap | 1 红 |
| F2-unknown-handoff | usage-unsettled 少判 unknown.handoff | 1 红 |
| F2-ack | 删 ack.requestId 守卫 | 1 红：`expected 1 to be greater than 1` |
| F2-stopped | stopped 分支插入错误早退 | 1 红：`expected 10 to be 1` |

11 条全部见红。

**Task 4 顺延到 T10 的四处（本文件下方「T10 变异」一节实测）**：`checkpoint-id-conflict`、`checkpoint-usage-high-water`、`deliverAndCollect` 的 draining 早退、`restartRun` 的 `cleanupError`。

## Task 5（Orca，commit fe56e3d..98e9976，fix round → 6da37e0）

| ID | 变异 | 结果 |
|---|---|---|
| T5-M1 | A2 base 恒取 ensureWorkBranch（方案 Y） | 红：criterion 1（base 不等）；criterion 2（链）不红，方案 X 的证据只落在 criterion 1 |
| T5-M2 | 第五参数传 null | 红：criterion 1、C-6、A2-after-bundle 复用（3 条） |
| T5-M3 | 删 withinGrant 应用 | 红：criterion 1 |
| T5-M4 | tokenBudget 不取 min | 红：criterion 1、withinGrant 判据 |
| T5-M4b | maxAttempts 不取 min | 红：withinGrant 判据（补判据前 criterion 1 不红） |
| T5-M4c | totalRuntimeBudgetMs 不取 min | 红：withinGrant 判据 |
| T5-M5 | continuationBundle 不接 resume-bundle-exists | 红：A2-after-bundle 两条 |
| T5-M6 | 删 cleanupPredecessor 调用 | 红：criterion 1（前任工作区仍在） |
| T5-M7 | continuationOf 不核 continuationIntentId | 起初不红（改写版 D21 走 registered===null 支），补新增 2 后红 |
| T5-M7b | 删 registered===null 分支 | 红：改写版 D21（TypeError） |
| T5-M8 | 恢复 A1 continuation-unsupported 门 | 红：8 条（driverContinuation 7 条＋改写版 D21） |
| T5-M9 | startEnvelope 忽略第五参数 | 红：criterion 1、C-6、复用（3 条） |
| T5-M10 | 删 A2 continuation-registration 阻断 | 红：新增 2、改写版 D21 |
| T5-M11 | cleanupPredecessor 删 cleanedUp 早退 | **不红，登记为等价**（cleanupRunWorkspace 对已删除路径幂等） |
| T5-M12 | continuationOf 删 base===null 检查 | 起初不红，补新增 3 后红 |
| T5-M13（守恒） | 续跑认领二次预留 | 红：守恒判据（新增 1） |
| **T4-M22（顺延）** | D-VIEW `:503` 删 `current &&` | **红**：criterion 1，`recovery-blocked:run-work-identity:<run>` |
| T4-M22b（自加变体） | D-VIEW `:500` `claimed` 删 `current &&` | **不红，登记为等价**（`claimed` 只在 `current && …` 之下被读） |
| **T3-M3（顺延）** | terminaliseRun 删续跑子支 | **红**：C-6 那条（status 非 held） |

Task 5 Fix round 1（commit 6da37e0）：

| ID | 变异 | 结果 |
|---|---|---|
| T5-F1 | cleanupPredecessor 删 catch，清理失败直接抛出 | 红：新判据（续跑被 block，未到 accept） |
| T5-F1b | catch 接住但写回 cleanupError:null | 红：新判据（前任 drive 不匹配 cleanupError） |

## Task 6（Orca，commit 6da37e0..0551961）

| ID | 变异 | 实红（且仅） | 判定 |
|---|---|---|---|
| M1 | 删 N 元折叠行 | three sides | 符 |
| M2 | 删空并集升级 | empty union | 符 |
| M3 | `two = true` | three sides | 符 |
| M4 | 删哈希兜底 | 200-character ceiling | 符 |
| M5 | 集合换回「恰好一个」 | N1u、三路 | 符 |
| M6 | 删 `.sort()` | N1u（三路这遍没红，brief 预言约 ½） | 符 |
| M7 | 删零个分支 | N1u、既有 "blocks a conflict that no landed run of the group explains" | 符 |
| M8 | N2 守卫 return false→continue | 三路、N2 | 符 |
| M9 | spawnSeq→0 | I7、新增 D-SPAWNKEY | 符（外加新判据） |
| M10 | 删 D-STALE 的 rm | I7 | 符 |
| M11 | 删 otherTaskIds: others | 三路 | 符 |
| M12 | 落地消息换回单 id | 三路 | 符 |
| M13 | 删 schema 字段 | typecheck RC 2（TS2561／TS2551） | 符 |
| M14 | MAX→COUNT(*)+0*?（D-SPAWNKEY） | 仅新增 D-SPAWNKEY 判据 | 新判据使之红 |
| M15 | N2 查询去掉 `AND active=1` | 不红 | **登记为等价**（今天没有「reconciling 且 active=0」的写方组合） |

## Task 7（Orca，commit 0551961..5ed2b04）

| ID | 变异 | 命中判据 | 判定 |
|---|---|---|---|
| T7-M1 | 跳过条件删 `exemptDriverRuns && ` | "freezes a started group exactly as before…"（1 条） | 与预言一致，被杀 |
| T7-M2 | 删 `intent === null && ` | 0 红，29/29 绿 | **登记为等价**（走到这里的非空 intent 只剩 pause，已被 active.length===0 排除） |
| T7-M3 | 删 `active.length === 0 && ` | H7 那条（1 条） | 与预言一致，被杀 |
| T7-M4 | 删 `&& driverOwnedGroup(...)` | 2 条（never started／无 planHash） | 与预言一致，被杀 |
| T7-M5 | driverOwnedGroup 判断削弱 | "…无 planHash…"（1 条） | 与预言一致，被杀 |
| T7-M6 | 删 scheduler_wakes 检查 | "never started even when a driver exists…"（1 条） | 与预言一致，被杀 |
| T7-M7a | 跳过块整体挪位置，条件不动 | 0 红，29/29 绿 | **登记为等价**（intent===null 使之与位置无关） |
| T7-M7b | 挪位置＋删 intent===null | 2 条（preserves an existing pause…、controlLifecycle `:236`） | 与预言一致，证明该组合可被判据抓到 |
| T7-M8 | webProtocol.ts 删枚举值 | 2 条（commits the new disposition…、driverRecovery "freezes no driver-owned run…"） | 与预言一致，被杀 |

## Task 8（Orca，commit 5ed2b04..946a840）

| ID | 变异 | 期望红（且仅） | 实测 |
|---|---|---|---|
| T8-M1 | continuableRun 删 result==="partial" 检查 | "…is false for a handoff-settled run whose checkpoint says the task completed" | 命中，仅此 1 条 |
| T8-M2 | 删 state!=="settled-recoverable" 守卫 | "…is false for a handoff-settled run that is not recoverable…" | 命中，仅此 1 条 |
| T8-M3（preflight I5 新增） | 删剩余 grant 维度守卫 | "…is false for a handoff-settled run with a partial checkpoint whose remaining work grant has an exhausted dimension" | 命中，仅此 1 条 |
| T8-M4 | continuableRuns 判据换回旧 state 检查 | controlPanel 判据、handoffResume 两条（3 条） | 命中，恰好这 3 条 |
| T8-M5 | Resume 按钮删 continuable.length===0 | handoffResume "offers only the handed-off task…" | 命中，仅此 1 条 |
| T8-M6 | Resume 按钮删 stopState===handoff-complete | handoffResume "offers no resume at all while the handoff has not completed" | 命中，仅此 1 条 |

## Task 9（Orca+ccloop，commit 946a840..0614dd5，fix round → 3351438）

| ID | 变异 | 跑的 | 实测红 | 判定 |
|---|---|---|---|---|
| T9-M1 | 删 handoffGraceMs 接线 | G | G：早 4.87 s | 符 |
| T9-M2 | handoffGraceMsOf 恒返回 HANDOFF_EXTRA_GRACE_MS | 单元＋G | 单元（60000 vs 65000）＋G | 符 |
| T9-M3 | 删类型/整数/非负校验 | 单元 | 单元（NaN vs 60000） | 符 |
| T9-M8（本席新增） | catch 分支改为 throw | 单元 | 单元（SyntaxError） | 符 |
| T9-M4 | ccloop fake codex 去掉 #continuation 选键 | 整个 E2E 文件 | H1／H3／H2／H5／R-H 四条／deadline 红；H6／G／H-between 绿 | 符（同源一族） |
| T9-M5 | N2 同组已有 reconciling 时空块 | H2 | 3 次都红（3 组各多 1 行解冲突） | 符 |
| T9-M6 | visitOrder 改回 driverRunIds | H5、H-between | 两条超时 | 符 |
| T9-M7 | frozenAllocationShape 原样返回 | H1 | H1：`recovery-blocked:execution-snapshot-identity` | 符 |

Task 9 Fix round 1（commit 3351438，只改 handoffE2E.test.ts 判据本身）：

| ID | 变异 | 结果 |
|---|---|---|
| Mutation A（D-C7′） | 删 enteredPhaseFiles 里 handoff_interrupted 整段 | 红：deadline 判据（missing 多了 execution.json） |
| Mutation B（C-3） | 删 usageBeforeDelay:true | 红：新用量断言（unknown.work 变 true）；对照旧断言在「一个事件都不报」形状下也会红，评审指出的空绿场景在新断言下同样会红 |

---

## Task 10 新跑的变异（六处顺延项，`git clone --local` 副本 `scratchpad/t10/mut/orca`，clone 自 Orca HEAD 3351438）

跑法：clone 建好后先跑目标测试文件基线（`tests/control/{stopIntent,handoffStop,driverHandoff,driverHandoffSnapshot,driverContinuation}.test.ts`，86/86 绿，`scratchpad/t10/mut/baseline.json`）；随后逐条对副本做锚点字符串替换（`mutate.py`，命中数先核 `==1`），跑该条点名的测试文件集，记红集，立即用原字节还原，`shasum -a 256` 核对还原后与变异前相同。全部六条跑完后，副本 `git diff` 与 `git diff --cached` 均 **0 字节**（`scratchpad/t10/mut/final-diff.txt`、`final-diff-cached.txt`），随后 `/bin/rm -f` 删软链、`/bin/rm -rf` 删副本。

### open gaps（no criterion catches it）— 控制器裁定：本任务不加判据，留给 T10b

以下六条是 Task 3／Task 4 的控制器裁定（progress.md `[T4-I2]`）里明确顺延到本任务的项。本任务按裁定**只测量、不补判据**——六条全部跑完，六条全部**未见红**，逐条记录锚点、跑的测试文件、实测 RC 与红集合（均为空）：

| ID | 文件:行 | 删掉的锚点（原文） | 跑的测试文件 | 实测 | 判定 |
|---|---|---|---|---|---|
| T3-DEFER-1 | `src/control/stopIntent.ts:680` | `terminaliseRun` 里续跑分支的身份不符拒绝：`if (registered === null \|\| registered.continuationIntentId !== continuationIntentId) return blocked(...)` | `driverContinuation.test.ts`、`stopIntent.test.ts`、`handoffStop.test.ts`（57 条） | applied=True, restored=True, RC=0, red=[] | **open gap** |
| T3-DEFER-2 | `src/control/stopIntent.ts:770` | `settleCompletedRunRequestInTransaction` 的 C1 幂等守卫：`if (!ADOPTABLE_STATES.includes(request.state)) return;` | `handoffStop.test.ts`、`stopIntent.test.ts`、`driverHandoff.test.ts`（75 条） | applied=True, restored=True, RC=0, red=[] | **open gap** |
| T4-DEFER-1 | `src/control/driverHandoff.ts:258` | H-settle 的 `checkpoint-id-conflict` 守卫：`if (previous !== undefined && String(previous.hash) !== persisted.hash) throw new ControlError("checkpoint-id-conflict");` | `driverHandoff.test.ts`、`driverHandoffSnapshot.test.ts`（29 条） | applied=True, restored=True, RC=0, red=[] | **open gap** |
| T4-DEFER-2 | `src/control/driverHandoff.ts:261` | H-settle 的 `checkpoint-usage-high-water` 守卫：`if (candidate.usageHighWater !== current.highWater) throw new ControlError("checkpoint-usage-high-water");` | `driverHandoff.test.ts`、`driverHandoffSnapshot.test.ts`（29 条） | applied=True, restored=True, RC=0, red=[] | **open gap** |
| T4-DEFER-3 | `src/control/driverHandoff.ts:154` | `deliverAndCollect` 的 draining 早退：`if (deps.admissionGate?.draining) return false;` | `driverHandoff.test.ts`、`driverHandoffSnapshot.test.ts`（29 条） | applied=True, restored=True, RC=0, red=[] | **open gap** |
| T4-DEFER-4 | `src/control/driverHandoff.ts:97` | `restartRun` 的 cleanupError 记录：`catch (error) { cleanupError = describeError(error); }` | `driverHandoff.test.ts`、`driverHandoffSnapshot.test.ts`（29 条） | applied=True, restored=True, RC=0, red=[] | **open gap** |

结构性原因（供 T10b 参考，本任务不据此新增判据）：
- T3-DEFER-1／T3-DEFER-2：两者都是"数据已经自洽"前提下的防御性再校验（同一 accept 事务写入的 registration 与 continuationIntentId 理应总是匹配；已关闭的请求理应不会被再次 settle）。要让它们红需要构造数据损坏或双重调用的场景，现有夹具（`driverContinuation`／`handoffHarness`）都不产生这种输入。
- T4-DEFER-1／T4-DEFER-2：`checkpointId` 已经把 `hashPayload(candidate)` 的前 16 字符纳入 id 本身，制造"同 id 不同 hash"或"usageHighWater 竞态"需要人为伪造两次不同的 candidate 写同一 id，或在读—写之间插入一次 usage 事件；现有测试夹具没有能插入这种竞态的钩子。
- T4-DEFER-3：需要一个 `admissionGate.draining===true` 的假 port 在 H 步投递时刻生效；`driverPort.ts` 的 fixture 目前没有为 H 步单独造这种 gate 状态（draining 在现有测试里只用于 A 步准入）。
- T4-DEFER-4：`restartRun` 自己的 `cleanupError` 分支和 T5 fix round 1 给 `executionDriver.ts` 的 `cleanupPredecessor` 新增的 `cleanupError` 判据是两处**不同函数**里结构相同但物理独立的代码；T5-F1／F1b 钉住的是 `cleanupPredecessor`，不覆盖 `restartRun` 自己的这段。要让它红需要让 `cleanupRunWorkspace` 在"run 从未开始"这条路径上抛错（例如给 `workspacePath` 一个 `cleanupRunWorkspace` 会拒绝的名字），现有测试没有为这一路径构造过这个条件。

### 已见红的顺延项（非 open gap，供对照）

- T4-M4、T4-M11、T4-M13、T4-M15、T4-M18：**均已由本轮新增/收紧的判据钉红**（见上 Task 4 表），不再是缺口。
- T4-M22：不红于 Task 4 范围，**顺延到 Task 5**，T5 报告确认红（见上）。
- T3-M3、T3-M10、T3-M11：不红于 Task 3 范围，均已在 Task 4／Task 5 报告里用同一变异复测并见红（见上标注「顺延」的行）。
- T5-M11、T4-M22b、T6-M15、T7-M2、T7-M7a：登记为等价变异（理由见对应行），非缺口。
