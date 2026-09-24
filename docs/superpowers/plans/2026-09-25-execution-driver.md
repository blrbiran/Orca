# 执行驱动：让 Web 派活从 `starting` 一路跑到 settle —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 fake codex、soft 组下，让 Web 派活从 confirm 一路跑到 settle，落到 `orca/<groupId>`；冲突由单独的解冲突 run 解；崩溃后逐 run 续做；settle 后补 wake 推进后续 task。

**Architecture:** ccloop 侧三处（C1 去 `--no-hardlinks`、C2 attempt ref 按 run 另钉一份、C3 fake codex 脚本化模式）。Orca 侧新增执行驱动环 `src/control/executionDriver.ts`（A1/A2/B/B'/C/E ＋补 wake）、落地与解冲突 `src/control/driverLanding.ts`（D/R）、工作区 `src/control/workspace.ts`、run body 的 `drive` 记录 `src/control/driveRecord.ts`、仓库设置 `src/control/workspaceSettings.ts`；封闭 schema／枚举、store migration、`set-workspace-mode` 命令、recovery 跳过、shutdown 豁免、`recovery-retry` 接线、装配、面板 UI。驱动环**只在 port `configured` 时存在**；`unconfigured` 下行为与今天逐字节相同（spec §2.1）。

**Tech Stack:** TypeScript、zod、vitest、node:sqlite（ControlStore）、git CLI（`execFile`）、React（`web/`）。

**Spec:** `docs/superpowers/specs/2026-09-25-execution-driver-design.md`（第二版；**先读它**；本计划与 spec 冲突时 spec 优先 —— 本计划查出的 spec 与代码不符之处全部列在 §0.1，**由控制器裁定，不许静默偏离**）。

**归属**：Orca 控制器会话 `905e41ce` 的计划席，2026-09-25。观测锚点＝主题行
`docs(spec): fold the independent review into the execution driver spec (second edition)`（Orca）与
`docs(handoff): roll the Orca section: seam B is done on the Orca side, nothing changed here`（ccloop）；**行号引用前现测**。

---

## §0 现量结果（Task 0，计划席在写计划前自己量的；锚点同上）

探针全部只在 `scratchpad/planner/` 下：Orca 的 `git clone --local` 副本 `orca-probe/`（软链 `node_modules`，探针判据文件 `tests/control/zzPlannerProbe.test.ts`，**只在副本里**，日志 `probe1.log`／`probe2.log`）、ccloop 副本 `ccloop-probe/`（`npm run build` 后跑判据，日志 `cc-e2e.log`）、git 探针脚本 `gitprobe.sh`／`gitprobe2.sh`（日志同名 `.log`）。代码位置用 python 逐行读取定位（`scratchpad/g.py`）。

| # | 问题 | 现量结论 | 证据（file:line ＋ 命令／探针） |
|---|---|---|---|
| (a) | 未配置 estimator 时 confirm → start 是否畅通 | **不畅通，而且卡在更早一步：`import-plan` 就被拒**，`control-estimator-unconfigured`（durable 422）。能走通的形状是：**配置 estimator**（`--estimator-profile`＋`--estimate-mode soft`），而该 profile 的 `contextWindowTokens:null`（真 ccloop 就是这么答的）⇒ 导入时预估直接 `blocked-capability`、**不写 estimate wake** ⇒ confirm(soft, `handoffAtContextTokens:null`) → start → claim 全部畅通 | `src/control/planImport.ts:267`（`deps.defaults()` 无条件调用）、`src/panel/controlAssembly.ts:197-199`；`src/control/estimator.ts:71`（`contextWindowTokens===null ⇒ blocked`）。探针 `probe1.log`：`a_noEstimator.result.error.code="control-estimator-unconfigured"`；`a_nullWindow`：`estimate.state="blocked-capability"`、`wakesAfterImport=[]`、confirm/start `"ok"`、claim `{"kind":"claimed"}` |
| (b) | `writeArtifact`/`recordUsage`/`archiveRun`/`commitCandidate` 内部的 legacy `readRun` 能否读 Web run body | **能读**（`readRun` 只是 `JSON.parse`）。**但 `commitCandidate` 里的 `releaseRunReserve` 对 Web run 的记账是错的**：它把 `run.remaining` 清零、只改 `group.reserved` 不同步 ledger ⇒ 读模型 `run-identity:<runId>` 拦下整组视图，`readWebGroup` 报 `recovery-blocked`（ledger mirror 不等）。给 `releaseRunReserve` 加 Web 分支（`remaining` 保持 `grant-cumulative`、allocation 置 `terminal`、`releaseCommitment` 同步 ledger）后，同一探针视图可读、run 显示 `settled-recoverable`、work `completed` | `src/control/budget.ts:20-23`（readRun）、`:143-152`（releaseRunReserve）、`src/panel/controlViews.ts:434-441,461`（validAccounting）、`src/control/webService.ts:67-75`（readWebGroup）、`src/control/stopIntent.ts:648-730`（Web 原生结算：`terminaliseRun`／`setAllocationStates`／`releaseCommitment`）。探针 `probe1.log` 的 `bc.view.detail="run-identity:run-…"`、`bc.webGroup="ControlError: recovery-blocked"`、`reservedVsLedger` 1,250,000 vs 4,549,990；打补丁后 `probe2.log`：`view.runs=["settled-recoverable"]`、`work=["completed"]`、`webGroup="ok"` |
| (c) | 读模型怎样从落盘 `settled` 派生 `settled-*` | `displayRunState`：`settled` ⇒ `recoverable ? "settled-recoverable" : "settled-unrecoverable"`；`recoverable = settled && missing.length===0 && !!snapshot`。落盘值是 `settled`，E1 断言**落盘 `settled` 且显示 `settled-recoverable`** | `src/panel/controlViews.ts:443-451`、`src/control/checkpoints.ts:85-87`；`probe2.log`（`state:"settled"`、`recoverable:true`、视图 `settled-recoverable`） |
| (d) | 既有 run 级 `recovery-retry` 的语义与 schema | verb 已存在；target `{kind:"run",groupId,runId}`，payload `{scope:"run",runId}`，refine 要求两者同 run；`retryRun` 只做三件事：删该 run 的 `recovery_blockers`、重武装 failed-before-provider 的 continuation、把 `outcome-unknown` 的 handoff 请求改回 `request-pending`；结果 `recovery-observed{resolved,…}`。HTTP 路由 `POST /api/control/recovery/retry` 从 run 反查 group | `src/control/webProtocol.ts:529,564-567,670,714-722`；`src/control/stopIntent.ts:395-420,437-456`；`src/panel/controlApi.ts:200-211,232` |
| (e) | 真 ccloop 对同一 envelope 的 accept 重放是否幂等 | **幂等**：已有 `accepted.json` 时核 `canonicalHash(input)` 相同 ⇒ 返回同一 `executionId`（worker 未 claim 或已死 ⇒ `unknown`）；envelope 不同 ⇒ `control-envelope-conflict`（exit 2）。ccloop 自己的判据在干净 main build 上 13/13 绿 | ccloop `src/control/accept.ts:62-72,85-89,125-127`；`scratchpad/planner/cc-e2e.log`：`tests/control/accept.test.ts` 7/7、`tests/control/endToEnd.test.ts` 6/6（含 `keeps one execution identity across dropped/duplicate accept…`、`recovers the synchronized SIGKILL boundary: accepted-fsynced`） |
| (f) | `applyPanelShutdown` 如何选 active run，豁免点在哪 | `shutdownGroup` 第一行后 `const active = frozenRunIds(store, groupId)` ＝ 该组所有 `active=1` 的 run（任何 phase）；对每个 run `freezeRun` 写 handoff 请求＋outbox。**豁免点就是 `:122` 这一行**：过滤掉驱动环拥有的 Web work run（`work:<g>:<runId>` claim 行）。另：组内**没有** active run 时也会建 shutdown intent 并 `stopped=true`（既有行为，判据 `gives a ready group an empty frozen set…` 钉着） | `src/panel/controlLifecycle.ts:120-148`（`:122`）、`:167`；`src/control/stopIntent.ts:255-258` |
| (g) | `ccloop run --adapter codex` 与 `RunTaskOptions` | ccloop `run` **接受** `codex`；Orca `RunTaskOptions.adapter` 类型是 `"scripted" \| "claude"`，要扩；`runTask` 自己 spawn、不暴露 pid；`latestAttemptSha` 未导出 | ccloop `src/cli.ts:186`；Orca `src/scheduler/ccloopRunner.ts:47-61,108-122,165,205-258` |
| (h) | ccloop control 手里有什么唯一标识；attempt ref 在哪命名 | 手里有 `envelope.claim.runId`（Orca runId）与 `accepted.json` 的 `executionId`。ref 名由路径推：`attemptRefName` 取 `basename(dirname(dirname(worktreePath)))`，control worker 的 runDir 固定是 `<sourceDir>/run` ⇒ **所有 control run 都叫 `refs/ccloop/run/attempts/<n>`**；`materializeResultRepository` 在尝试 worktree 已删时按这个名字 `rev-parse` | ccloop `src/control/worker.ts:147`、`src/workspace/worktreeManager.ts:53-61,75-94`、`src/control/resultRepository.ts:69-79`、`src/control/protocol.ts:27-39` |
| (i) | Orca 归档快照是不是 `git bundle --all` | **是** | `src/control/snapshot.ts:45`（`bundle create <path> --all HEAD`） |
| (j) | ccloop 为什么加 `--no-hardlinks` | 由 `b010788 2026-09-19 feat(control): verify cross-repo recovery protocol` 连同整个文件一起引入，提交正文只有主题行，**无理由**；ccloop `src/`／`tests/`／`docs/`／`scripts/` 里 `hardlink`／`nlink` 只命中本行与 `materialize.ts:51,55`（那是 resume bundle 文件的 nlink 检查，无关）| `/usr/bin/git log -S'--no-hardlinks' -- src/control/resultRepository.ts`（`scratchpad/planner/nh.txt`）、`git show b010788 --format=%B -s`（`nh-body.txt`）、python 扫描（`nh-grep.txt`） |
| (k) | 可负担性检查读哪里 | group 剩余 ＝ `budgetBalance(group.limit, group.used, group.reserved).reserve`（与 `ledger.explicitUnallocatedReserve` 同值，不变式在 `webService.ts:99-100`）；解冲突 contract 的 `executionPolicy.tokenBudget` ＝ 两边 `tokenBudget` 的 max | `src/control/budget.ts:51-61`、`src/control/webService.ts:99-100`、`src/scheduler/reconcile.ts:389` |
| (l) | `nextClaimableTask` 签名与允许派活的 group status | `function nextClaimableTask(store, groupId): {workItemId}\|null`，**未导出**；`deliverScheduledStart` **不看** group status；`scheduleStart` 只收 `ready`；`commitCandidate` 每次把 group 置 `review`；`recordUsage` 超 grant 置 `blocked` | `src/control/webDispatch.ts:236-250,97,154-198`、`src/control/checkpoints.ts:90`、`src/control/usage.ts:36` |
| (m) | 哪些 ccloop 判据钉着 fake codex 模式 | `integration`：`tests/control/endToEnd.test.ts`、`tests/controller/codex.integration.test.ts`、`tests/runtime/codex/fixture.ts`、`tests/validation/codexAdapter.test.ts`；`no-usage`/`partial`/`write-hang`：`codex.integration.test.ts`；`nonzero`/`partial`：`tests/runtime/codex/adapter.test.ts`；`child-holds-pipe`/`hang`/`ignore-term`/`missing-final`/`output-limit`/`symlink`/`split-utf8`/`nonzero`：`tests/runtime/codex/runCodexPhase.test.ts`；`envelope-extra`/`partial`：`transport.test.ts`；`bad-json`/`quota`/`false-answer`/`ignore-term`/`integration`：`tests/validation/codexAdapter.test.ts`；`high-usage`：`codexSoftBudget.test.ts`；`ignore-term`：`codexWatchdog.test.ts`；`success`：`tests/control/accept.test.ts`。**C3 只加新模式 `script`，这些模式的分支一字不改** | python 扫描（`scratchpad/planner/fcmodes2.txt`） |

**另量的三件（写计划时发现需要）**：
- 落地机制可行（`gitprobe.log`）：目标仓库的**分离**工作区里 `fetch <clone> +<sha>:refs/orca/incoming/<id>` → `merge --no-ff` → `update-ref refs/heads/orca/g <new> <old>` RC 0；**同一 old 再做一次 CAS 被拒 RC 128**；人同时 checkout 着 `orca/g` 不受影响，人的工作区文件仍是 `base`、index 未变（`git status` 显示 `M` 是因为 HEAD 前移了，文件与 index 没被碰）；`FETCH_HEAD` 不写进主仓库 `.git/`（per-worktree）；落地 merge 的 `^2` 就是 attempt sha。
- `update-ref <ref> <new> ""` 是「仅在不存在时创建」（第二次 RC 128 `reference already exists`）；从冲突副本 fetch 一个被 `refs/orca/merged/*` 指着的**裸 sha** 可行；`git clone --local` 出来的副本 `origin` 就是目标仓库（`gitprobe2.log`）。
- 🔴 *** **Tier 0 闸门会拦下 Bash 里任何 `git worktree remove`，连 scratchpad 里的临时仓库也拦**（探针第一版被拦，hook 原文「remove a worktree is Tier 0」）。*** 驱动代码里经 `execFile` 调的不受影响（闸门只看 Bash 工具的命令行），但**实施席手工探针不许写 `git worktree remove`**，清理用 `/bin/rm -rf` 临时目录。

---

## §0.1 与 spec 的偏离（**控制器裁定**；计划正文按「建议」一栏写，裁定不同就改对应 Task）

| # | spec 原文／位置 | 实测事实 | 建议 |
|---|---|---|---|
| D1 | §1「本片的端到端只在『未配置 estimator』下成立」、§7.2 E1「未配置 estimator」 | (a)：未配置 estimator ⇒ `import-plan` 就被拒，confirm 根本到不了 | E1 配置 estimator（同一个 profile，`--estimate-mode soft`），靠 `contextWindowTokens:null` 让预估恒为 `blocked-capability`。**诚实的验收表述改成**：「在 fake codex、soft 组、estimator 已配置但其预估因 `contextWindowTokens:null` 为 `blocked-capability` 下，Web 派活能从 confirm 跑到 settle 并落到 `orca/<groupId>`」 |
| D2 | §2.2 E「→ `commitCandidate` …」（按原样复用） | (b)：原样复用会让读模型整组报 `run-identity` | T7 给 `releaseRunReserve` 加 Web 分支（`"planHash" in group` 是既有的 Web 判别式，`claimWork`／`syncWebBudget`／`recordUsage` 都这么判）。探针已证可行 |
| D3 | §2.2 状态图的 `running` | spec 列的新值只有五个（start-pending/collected/landed/reconciling/blocked）；`running` 在读模型里是既有 `accepted` 的显示值 | 驱动环把 `running` 落盘为既有的 `accepted`（显示 `running`），保住 `controlViews.ts:467` 的「`accepted` 且 ordinal 0 ⇒ 拦」守卫。五个新值全部非终态、`active=1`；`isTerminalRunState` 与视图的 terminal 列表**不改** |
| D4 | §2.2 B／B'「`stopped` ⇒ `blocked`」 | ccloop `inspect` 走 `inspectExecution`：执行正常结束、已有 candidate 且能证明停止时答 `stopped`（`collect.ts:48-56`、`command.ts:158-160`）⇒ 按 spec 会把**每个正常跑完的 run** 在 B' 里拦下 | `stopped` ⇒ 记 `executionId=proof.executionId`、落 `accepted`，下一步 C 照常 collect；只有 `proof.generation≠run.generation` 才 `blocked` |
| D5 | §2.2 B「抛错 ⇒ `unknown`」 | ccloop 在写 `accepted.json` **之前**的确定性拒绝（`control-config-hash-mismatch`、`control-envelope-conflict`、`control-request-invalid`）都是 `ControlProtocolError` ⇒ 进程 exit 2 ⇒ port 抛 `control-peer-exit` 且 detail 以 `2:` 开头。按 spec 走 `unknown`→inspect `absent`→重发，会无限循环（不花钱，但永不结束、也不报人） | `control-peer-exit` 且 detail 以 `2:` 开头 ⇒ `blocked`（`accept-refused:<detail>`）；其余抛错照 spec ⇒ `unknown` |
| D6 | §2.2 A1「从 work 桶预留一次 attempt」 | 既有 `beginProviderAttempt` 只把 ordinal ＋1，**不动任何金额**；读模型要求 `remaining == max(grant-cumulative,0)`（`controlViews.ts:434-441`），改金额会拦视图 | A1 ＝ `beginProviderAttempt` 的事务体（抽成 `reserveProviderAttemptInTransaction`）＋ drive 字段，同一事务；不动金额 |
| D7 | §7.3 四条候选改写 | recovery 跳过与 shutdown 豁免都**以「驱动环存在」为条件**（参数，由装配在 port configured 时传）。四条候选在不传参数时行为不变：`webFaults.test.ts` 的 `recovers an open run before anything listens…`（现 `:266`）与 `controlLifecycle.test.ts` 的 `strengthens a pause only when an active run must be stopped…`（`:151`，spec 未列、计划席扫出）都直接调函数不带参数；`controlRecoveryApi.test.ts:162` 的 boot 不跑 recovery（`dispatchBlocked` 来自 `store.ts:119` 开库时的 active 检查）；`webFaults.test.ts:173` 与 `webDispatch.test.ts:112` 钉的是 `recoverAttempt`（strict proof 路径），本片不碰 | **本轮零条既有判据改写**；新行为全部由新判据钉（T8 的 G1/G2 同时钉「带参数」与「不带参数」两侧）。这同时兑现 spec §2.1「unconfigured 行为逐字节相同」 |
| D8 | §8 更正「:788 的『全局 blocker』对 Web run 不再成立」 | Web spec :788 讲的是 **proof 应答丢失**（strict 路径，`recoverAttempt`，`webDispatch.ts:408-422`），本片不改它；本片改的是 `recovery.ts:28` 那条 legacy「无 `start:` 行即拦」规则，它不在 :788 | ERRATUM 改成：:788 对 proof 路径照旧；驱动环拥有的 Web run 不受 startup recovery 的 legacy 走查拦；:772 的 background scheduler 由驱动环实现；:778 的 proof 要求本片只以「strict ⇒ blocked」兑现。全文在 T8 |
| D9 | §3.2「`runsRoot` ＝ control 根下与 `state/` 并列的 `runs/`」 | 没有 `state/` 目录：store 目录就是 `<ORCA_CONTROL_DIR>/<repoKey>`（或 `--control-state-dir`），`archive/`／`export/`／`evidence/` 都在它**里面** | `runsRoot = <stateDir>.runs`、`workspacesRoot = <stateDir>.workspaces`（store 目录的兄弟，随它一起改道；0700；只在 port configured 时创建） |
| D10 | §6 C2「attempt ref 按 run 区分（不再共用 `refs/ccloop/run/attempts/<n>`）」 | ccloop `tests/control/endToEnd.test.ts:36` 断言 `refs/ccloop/run/attempts/1` 存在；ccloop Rule 15 要求改既有判据须人**指名到具体测试**，本轮人裁没点它 | C2 做成**只加不改**：共享名照写（该判据不动），control worker 另钉 `refs/ccloop/<claim.runId>/attempts/<n>`，`materializeResultRepository` 读后者。共享名仍会被覆盖，但已没有读者 |
| D11 | §5.3(2)「对方＝本 group 已落地的 run 中，其 `base..landedCommit` 改动集与冲突路径相交者」 | `base..landedCommit` 含该 run 落地前别人落的改动 | 改动集用 `netChangeSet(target, run.base, landedCommit^2)`（`^2` 就是它的 attempt，reconciled 落地也是）；候选只取 `landedCommit` **不是**本 run `base` 祖先的那些 |
| D12 | §5.3(5) 可负担性 | 默认预算下 reserve（base 的 20%，3 task 时 2,480,000 tokens）< 单个派生 contract 的 `tokenBudget`（3,000,000）；而 B 冲突时 A 往往已 `landed` 未 `settled`（一轮一步）⇒ **默认配置下第一个冲突必然 `reconcile-budget`** | 规则照 spec 实现；E1 在 start 前用既有 `set-limit` 把 tokens 上限加 10,000,000（判据里写明为什么）。登记为已知后果，报人 |
| D13 | §3.3 固定身份 `Orca <orca@localhost>` | 仓库已有常量 `ORCA_IDENTITY = orca <orca@invalid>`（`src/scheduler/gitExec.ts:47`） | 用既有常量（Rule 11） |
| D14 | §2.2 C「改动集为空 ⇒ 直接到 E」未说 work 状态 | legacy 把 `succeeded_but_empty` 判失败（`harvest.ts:188-190`） | 空改动 ⇒ `landed` 且 `landedCommit=null` ⇒ E **不写 acceptance** ⇒ `commitCandidate` 把 work 置 `blocked`（依赖者不跑）；run 照常 settle、清理 |
| D15 | §2.1「对全部非终态 … run 逐个推进」 | E 的「acceptance 后、commitCandidate 前」崩溃点之外，还有「settle 后、清理前」这一窗：run 已终态，按 spec 不会再被访问 ⇒ 工作区永远留着 | drive 加 `cleanedUp`；驱动环也访问 `settled && drive && !cleanedUp` 的 run，只做清理 |
| D16 | §3.2「set-workspace-mode 带 `expectedRevision`」 | 命令账本的 scope 只有 group／global，global 的 revision 恒 0（`commandLedger.ts:40-43,95-97,236-242`）；`commandSuccessSchema` 要求非 shutdown 的 `projectionSeq` 非 null（`webProtocol.ts:1136-1144`） | scope 加第三种 `repository`（key `@repository:<repoId>`，revision 取 `repository_settings.body.revision`）；refine 放行 `set-workspace-mode` 的 `projectionSeq:null`。设置的读取走新路由 `GET /api/control/repositories/:repoId/workspace`，**不改** config 视图（否则要改写 `controlApi.test.ts:51` 与四个 web 夹具） |
| D17 | §5.3(6)「用调度器 `runTask`」＋「spawn 前把 runs 目录与 pid 写进 run body」 | `runTask` 自己 spawn 且阻塞到 ccloop 退出；pid 只在 spawn 之后才有 | `RunTaskOptions` 加 `adapter:"codex"` 与 `onSpawn(pid)`；解冲突 run **不在一轮里 await**（进程内 `Map<runId,Promise>`，每轮看 loop-state）；spawn 前事务写 `spawning:true`，`onSpawn` 事务写 pid。重启后：终态 loop-state ⇒ 收；pid 活 ⇒ 等；`spawning && pid===null` ⇒ `blocked`（`reconcile-orphan-unknown`，可能有无主的 ccloop 在跑，不敢重跑）；其余 ⇒ 丢弃重跑（先再做可负担性检查） |
| D18 | §5.3(5)「跑完把它的 usage 记进 group」 | `ccloop run` 不向 Orca 报 usage 事件 | 读 loop-state 的 `budgetSnapshot.tokenBudgetRemaining`，记 `tokens = tokenBudget - remaining`（`attempts:1,sessions:1,activeMs:0`），走 `syncWebBudget` 保 ledger 镜像；按 `reconcile-usage:<runId>:<attemptSha>` 幂等 |
| D19 | §3.5 残留「`refs/orca/conflict/<runId>`」在目标仓库 | `pinConflictCommit` 写进**冲突副本**（`reconcile.ts:438-441`），不进目标仓库；本片另在副本里写 `refs/orca/reconciled/<runId>`、`refs/orca/merged/<runId>` | 残留清单据实：目标仓库只多 `refs/heads/orca/<g>`、`refs/orca/incoming/<runId>`（settle 后删）、`.git/worktrees/*` 注册 |
| D20 | §2.1「每一步的同步写过 `withAdmission`」 | `withAdmission` 同步释放，挡不住在飞的 port 调用（spec 自己也写了） | 同步写一律 `write()`（gate.enter ＋ 事务）；**每次 provider 调用（accept、解冲突 spawn）前查 `admissionGate.draining`**，为真就本轮不发；`panel-draining` 抛出时整轮静默结束，不把 run 标 blocked |
| D21 | §2.2 A1 前提 | continuation run（`continuationIntentId` 非空）要带 `inputCheckpoint`，本片的 `toStartEnvelope` 恒 `inputCheckpoint:null`（`startEnvelope.ts:88`） | continuation run 在 A1 `blocked`（`continuation-unsupported`），登记为缺口 |

---

## Global Constraints

- **范围只到 spec §1 的 ①②③**；④ handoff 投递、⑤ 预估链、strict proof、「直接改分支」工作区方式都不做（spec §1、§3.4、§9）。
- 驱动环只在 port `configured` 时构造；`unconfigured` 下**不建目录、不跳过 recovery、不豁免 shutdown**（spec §2.1；D7）。
- 常量（spec 原值）：B' 连续 `unknown` 阈值 **10**（`INSPECT_UNKNOWN_LIMIT`）；驱动环定时器沿用 `--control-wake-ms`（默认 `5000`，`DEFAULT_CONTROL_WAKE_MS`）；port 超时 `PORT_TIMEOUT_MS = 60_000`（`controlAssembly.ts:37`，不改）；工作区方式两值 `worktree`（默认）／`clone`。
- 目录（D9）：`runsRoot = <stateDir>.runs`、`workspacesRoot = <stateDir>.workspaces`，0700；`sourceDir = <runsRoot>/<runId>`；工作区 `<workspacesRoot>/<runId>`、落地 `landing-<runId>`、冲突副本 `conflict-<runId>`、解冲突 runs 目录 `reconcile-<runId>`。**只删 `workspacesRoot` 下自己命名的路径**。
- git：每一条进目标仓库或副本的命令都带 `-c core.hooksPath=/dev/null -c core.fsmonitor=false`（常量 `QUIET_GIT`）；提交带 `ORCA_IDENTITY`（D13）；**人的工作区、HEAD、index、`main` 一律不碰；`refs/heads/orca/<groupId>` 永不删**。
- Rule 17：所有判据 `ORCA_CONTROL_DIR` 改道到临时目录（vitest 的 `tests/setup/relocateUserData.ts` 已强制）；新建目录 0700、文件 0600；已存在的不改 mode。
- env（handoff §8.2）：`ORCA_CCLOOP_BIN` ＝ **含 T1 的** ccloop 的 `clone --local`＋`npm run build` 后的 `dist/cli.js`；`ORCA_CCLOOP_ADAPTER_CONFIG` ＝ `/private/tmp/…` 下 0600 的 fake-codex 配置（`integration` 模式，给既有判据用）。E1 等新判据**自己造**自己的 adapter config。重建方法见 T9 Step 1。
- 诚实的验收表述（D1 改后）：「在 fake codex、soft 组、estimator 已配置但其预估因 `contextWindowTokens:null` 为 `blocked-capability` 下，Web 派活能从 confirm 跑到 settle 并落到 `orca/<groupId>`」。真 codex 活体验收归人；**不许说「Web 派活可用」**。
- 既有判据改写：本轮人已授权（spec 抬头），**但计划席按 D7 判定零条需要改**。若实施中发现某条既有判据红了，**先停下报控制器**，不许自改；控制器裁定改写时整条改写、不许放宽，改写点上方加一行：
  `// Execution driver (human ruling 2026-09-25: this round may rewrite criteria; ruling 88 (b)(c)): <the new fact it encodes>`
- ccloop：守它自己的 `CLAUDE.md` 铁律（Rule 15 不改既有判据、Rule 16 只追加、Rule 17 变异只在副本）；红线函数 `tryRecoverStaleOwnerTransferLock` 与人裁 83 删锁条件不碰；判据 `scripts/check-known-reds.mjs` RC 0。
- 代码、注释、commit message 英文；本计划与台账中文。
- 每笔提交用 `git commit -F <file>`（**不许**多个 `-m`），消息结尾两行归属，**写实施席自己的模型**：
  `Co-Authored-By: <implementer's own model> <noreply@anthropic.com>` 与 `Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR`（两行之间**不空行**）。
- **禁令（子代理同样适用）**：不许 push／amend／merge 进 main／删分支或 worktree（Tier 0）；不许 kill 非己进程；清单外的问题**只报不修**；验证性跑一律**重定向到文件再整份读回**（不许 `| tail`、`| grep`）；计数用 python；git 核对用 `/usr/bin/git`；`rm`／`cp` 有 `-i` alias，用 `/bin/rm -rf`、`cat a > b`。
- 变异**只在 `git clone --local` 副本**里由单独的变异席做；每组先跑绿基线；落没落上去用 `shasum -a 256` 比；还原证明看副本 `git diff`／`git diff --cached` 字节数为 0。

---

## File Structure

| 路径 | 动作 | 职责 | Task |
|---|---|---|---|
| ccloop `src/control/resultRepository.ts` | 改 | C1 去 `--no-hardlinks`；C2 读 `refs/ccloop/<runId>/attempts/<n>` | T1 |
| ccloop `src/workspace/worktreeManager.ts` | 改 | C2 `registerAttemptRefNamespace`、`namespacedAttemptRefName`，publish 另钉一份 | T1 |
| ccloop `src/control/worker.ts` | 改 | C2 为自己的 runDir 登记 `claim.runId` | T1 |
| ccloop `tests/fixtures/fake-codex.mjs` | 改 | C3 `script` 模式 | T1 |
| ccloop `tests/control/resultRepository.test.ts`、`tests/workspace/attemptRefNamespace.test.ts`、`tests/runtime/codex/fakeCodexScript.test.ts` | 新 | C1/C2/C3 判据 | T1 |
| `src/control/driveRecord.ts` | 新 | run body 的 `drive` schema、`DriveStep`、`resumeBlockedDriverRun` | T2 |
| `src/control/workspaceSettings.ts` | 新 | `repository_settings` 读取、`applySetWorkspaceMode` | T2 |
| `src/control/migrations.ts`、`src/control/store.ts` | 改 | schema v4（`repository_settings`） | T2 |
| `src/control/webProtocol.ts` | 改 | runView 新状态＋`blockedReason`、`set-workspace-mode`、`repository` target、结果 kind、`repositoryWorkspaceSchema` | T2 |
| `src/control/commandLedger.ts` | 改 | `repository` scope 与其 revision | T2 |
| `src/control/stopIntent.ts`、`src/control/webService.ts` | 改 | target 收窄；`setWorkspaceMode`、`repositoryKnown`；（T8）`retryRun` 接线 | T2、T8 |
| `src/panel/controlViews.ts` | 改 | `persistedRunSchema`（新状态＋`drive`）、`displayRunState`、`blockedReason` | T2 |
| `src/panel/controlApi.ts`、`src/panel/controlConfig.ts` | 改 | 新路由；`resolveRepository` | T2 |
| `web/src/controlTypes.ts` | 改 | 同步类型 | T2 |
| `src/control/workspace.ts` | 新 | 目录根、工作区建／复用／删、work 分支、attempt 提交、清理 | T3 |
| `src/control/webDispatch.ts` | 改 | 抽 `reserveProviderAttemptInTransaction`；导出 `nextClaimableTask`／`readWorkClaimEnvelope`；新 `isWebWorkRun` | T4 |
| `src/control/executionDriver.ts` | 新 | 驱动环、A1/A2/B/B'/C（T4）、E＋补 wake（T7） | T4、T5、T6、T7 |
| `src/control/driverLanding.ts` | 新 | D 落地（T5）、解冲突 R（T6） | T5、T6 |
| `src/scheduler/ccloopRunner.ts` | 改 | `adapter:"codex"`、`onSpawn`、导出 `latestAttemptSha` | T6 |
| `src/control/budget.ts` | 改 | `releaseRunReserve` 的 Web 分支（D2） | T7 |
| `src/control/recovery.ts`、`src/panel/controlLifecycle.ts` | 改 | recovery 跳过、shutdown 豁免（带参数） | T8 |
| `docs/superpowers/specs/2026-09-19-web-recoverable-control-design.md` | 文末追加 | ERRATUM | T8 |
| `src/panel/controlAssembly.ts` | 改 | 装配驱动环、关闭顺序、recover 参数 | T9 |
| `tests/control/fixtures/web.ts` | 改（只加可选字段） | `WebFixtureTask.targetPaths?` | T4 |
| `tests/control/fixtures/driverPort.ts`、`driverHarness.ts`、`fake-ccloop-run.mjs` | 新 | 合成 port、驱动环夹具、假的 `ccloop run` | T4、T6 |
| `tests/control/*.test.ts`（见各 Task） | 新 | 判据 | 各 Task |
| `web/src/WorkspaceModeSelector.tsx`、`web/src/controlApi.ts`、`web/src/ControlPanel.tsx`、`web/src/ControlGroupView.tsx`、`web/src/App.tsx`、`web/tests/workspaceMode.test.tsx` | 新／改 | 面板 UI | T10 |
| `.superpowers/sdd/2026-09-25-execution-driver/progress.md` | 新（`git add -f` 单独） | 变异台账 | T11 |

**依赖顺序**：T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9（需 T1 的 ccloop build）→ T10 → T11。T10 只依赖 T2，可与 T3–T9 并行，但**同一工作树里一次只一席**（Rule 13）。

---

## Task 1：ccloop C1＋C2＋C3（仓库 `/Users/biran/code/skills/loop/ccloop`，守它自己的铁律）

**Files:**
- Modify: `src/control/resultRepository.ts`（`:5` import、`:24` cloneAt、`:75` ref 名）
- Modify: `src/workspace/worktreeManager.ts`（`:3` import、`attemptRefName` 之后加两个导出、`publishAttemptCommit` 末尾）
- Modify: `src/control/worker.ts`（import 区、`:147` runDir 那一行之后）
- Modify: `tests/fixtures/fake-codex.mjs`（`appendFileSync(marker+".calls",…)` 那一行之后）
- Create: `tests/control/resultRepository.test.ts`、`tests/workspace/attemptRefNamespace.test.ts`、`tests/runtime/codex/fakeCodexScript.test.ts`

**Interfaces:**
- Consumes: `materializeResultRepository(envelope: StartEnvelopeV1, runDir: string, currentAttempt: number): Promise<string>`（`resultRepository.ts:52`）；`createAttemptWorkspace(repoPath, runDir, attempt, startPoint?)`、`publishAttemptCommit(worktreePath): Promise<AttemptCommit>`（`worktreeManager.ts:17,75`）；`runControlWorker`（`worker.ts:88`）。
- Produces:
  - `registerAttemptRefNamespace(runDir: string, namespace: string): void`
  - `namespacedAttemptRefName(worktreePath: string, namespace: string): string` ⇒ `refs/ccloop/<namespace>/attempts/<n>`
  - fake codex 新模式：`command = [node, fake-codex.mjs, "script", <marker>, <scriptPath>]`，脚本 JSON `{ "<taskId>": { "files": { "<relative path>": "<content>" } } }`；execute 阶段按 prompt 里 `Execute one isolated attempt for task <taskId>.` 取条目写文件；无条目 ⇒ stderr 报名、exit 3、不写 `-o`。
- ccloop 侧 C2 **只加不改**（D10）：`refs/ccloop/run/attempts/<n>` 照旧写。

- [ ] **Step 1：开工核对**（结果写进本席的交付报告）

```bash
cd /Users/biran/code/skills/loop/ccloop
S="${SCRATCH:?set SCRATCH to the session scratchpad}"
/usr/bin/git status --short > "$S/t1-start.txt" 2>&1; /usr/bin/git log --oneline -3 >> "$S/t1-start.txt" 2>&1
/usr/bin/git log -S'--no-hardlinks' --format='%h %ad %s' --date=short -- src/control/resultRepository.ts >> "$S/t1-start.txt" 2>&1
cat "$S/t1-start.txt"
```

期望：工作树干净；`--no-hardlinks` 只有 `b010788` 一笔（§0 (j)）。不是 ⇒ 停下报告。

- [ ] **Step 2：写三份新判据**

`tests/control/resultRepository.test.ts`：

```ts
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { materializeResultRepository } from "../../src/control/resultRepository.js";
import type { StartEnvelopeV1 } from "../../src/control/protocol.js";

// Orca execution driver (2026-09-25), ccloop changes C1 and C2. Additive criteria only (Rule 15):
// the existing `refs/ccloop/run/attempts/1` assertion in tests/control/endToEnd.test.ts is untouched.
const exec = promisify(execFile);
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await exec("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args], { cwd })).stdout.trim();
}

/** A repository with two sibling commits, as two control runs sharing one target repository leave them. */
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "ccloop-result-repo-")));
  roots.push(root);
  const repo = join(root, "repo");
  await mkdir(repo);
  await git(repo, "init", "-q");
  await writeFile(join(repo, "answer.txt"), "0\n");
  await git(repo, "add", "answer.txt");
  await git(repo, "commit", "-qm", "base");
  const base = await git(repo, "rev-parse", "HEAD");
  await writeFile(join(repo, "answer.txt"), "mine\n");
  await git(repo, "commit", "-qam", "mine");
  const mine = await git(repo, "rev-parse", "HEAD");
  await git(repo, "checkout", "-q", "--detach", base);
  await writeFile(join(repo, "answer.txt"), "theirs\n");
  await git(repo, "commit", "-qam", "theirs");
  const theirs = await git(repo, "rev-parse", "HEAD");
  await git(repo, "checkout", "-q", "--detach", base);
  const sourceDir = join(root, "source");
  await mkdir(sourceDir, { mode: 0o700 });
  // Only the fields materializeResultRepository reads on the attempt>0, worktree-gone path.
  const envelope = {
    protocol: 1, claim: { runId: "run-mine" }, contractHash: "0".repeat(64), inputCheckpoint: null,
    work: { contract: { context: { repoPath: repo } }, targetRepo: repo, base, sourceDir },
  } as unknown as StartEnvelopeV1;
  return { repo, mine, theirs, sourceDir, envelope, runDir: join(sourceDir, "run") };
}

describe("the result repository a control run materializes (Orca execution driver C1/C2)", () => {
  it("C2 reads its own run's attempt ref, not the shared path-derived one a later run overwrote", async () => {
    const f = await fixture();
    await git(f.repo, "update-ref", "refs/ccloop/run-mine/attempts/1", f.mine);
    // Another control run in the same target repository published last under the shared name.
    await git(f.repo, "update-ref", "refs/ccloop/run/attempts/1", f.theirs);
    const destination = await materializeResultRepository(f.envelope, f.runDir, 1);
    expect(await git(destination, "rev-parse", "HEAD")).toBe(f.mine);
    expect((await exec("cat", [join(destination, "answer.txt")])).stdout).toBe("mine\n");
  });

  it("C1 shares the object store by hard links instead of copying it", async () => {
    const f = await fixture();
    await git(f.repo, "update-ref", "refs/ccloop/run-mine/attempts/1", f.mine);
    const destination = await materializeResultRepository(f.envelope, f.runDir, 1);
    // The commit object is loose in the source (nothing ran gc); a hard-linked clone gives the same
    // inode a second name, a copying clone gives it exactly one.
    const object = join(".git", "objects", f.mine.slice(0, 2), f.mine.slice(2));
    expect((await stat(join(destination, object))).nlink).toBeGreaterThanOrEqual(2);
    expect((await stat(join(destination, object))).ino).toBe((await stat(join(f.repo, object))).ino);
  });
});
```

`tests/workspace/attemptRefNamespace.test.ts`：

```ts
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createAttemptWorkspace, namespacedAttemptRefName, publishAttemptCommit, registerAttemptRefNamespace } from "../../src/workspace/worktreeManager.js";

// Orca execution driver (2026-09-25), ccloop change C2, additive: the shared path-derived ref is still
// published exactly as before; a registered run directory ALSO pins its attempt under its own name.
const exec = promisify(execFile);
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const git = async (cwd: string, ...args: string[]) =>
  (await exec("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args], { cwd })).stdout.trim();

async function repository(): Promise<{ root: string; repo: string }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "ccloop-ref-ns-")));
  roots.push(root);
  const repo = join(root, "repo");
  await mkdir(repo);
  await git(repo, "init", "-q");
  await writeFile(join(repo, "a.txt"), "a\n");
  await git(repo, "add", "a.txt");
  await git(repo, "commit", "-qm", "base");
  return { root, repo };
}

describe("attempt refs under a registered control run (Orca execution driver C2)", () => {
  it("names the namespaced ref after the attempt leaf", () => {
    expect(namespacedAttemptRefName("/x/source/run/worktrees/attempt-3", "run-orca-7")).toBe("refs/ccloop/run-orca-7/attempts/3");
    expect(() => namespacedAttemptRefName("/x/source/run/worktrees/scratch", "run-orca-7")).toThrow(/not an attempt worktree path/);
  });

  it("publishes the shared ref and, once registered, the run's own ref at the same commit", async () => {
    const { root, repo } = await repository();
    const runDir = join(root, "control-source", "run");
    const { worktreePath } = await createAttemptWorkspace(repo, runDir, 1);
    await writeFile(join(worktreePath, "a.txt"), "changed\n");
    registerAttemptRefNamespace(runDir, "run-orca-1");
    const published = await publishAttemptCommit(worktreePath);
    expect(await git(repo, "rev-parse", "refs/ccloop/run/attempts/1")).toBe(published.sha);
    expect(await git(repo, "rev-parse", "refs/ccloop/run-orca-1/attempts/1")).toBe(published.sha);
  });

  it("publishes only the shared ref for a run directory nobody registered", async () => {
    const { root, repo } = await repository();
    const runDir = join(root, "other-source", "run");
    const { worktreePath } = await createAttemptWorkspace(repo, runDir, 1);
    await publishAttemptCommit(worktreePath);
    expect((await git(repo, "for-each-ref", "--format=%(refname)", "refs/ccloop/")).split("\n")).toEqual(["refs/ccloop/run/attempts/1"]);
  });
});
```

`tests/runtime/codex/fakeCodexScript.test.ts`：

```ts
import { spawn } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// Orca execution driver (2026-09-25), ccloop change C3: a scripted fake-codex mode. Every existing mode
// keeps its own branch unchanged and stays pinned by the criteria that already use it.
const fake = fileURLToPath(new URL("../../fixtures/fake-codex.mjs", import.meta.url));
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function run(prompt: string, script: Record<string, unknown>): Promise<{ code: number | null; stderr: string; cwd: string }> {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), "fake-codex-script-")));
  roots.push(cwd);
  const scriptPath = join(cwd, "script.json"), schemaPath = join(cwd, "schema.json");
  await writeFile(scriptPath, JSON.stringify(script));
  // An `anyOf` schema is how the fixture recognises the execute phase.
  await writeFile(schemaPath, JSON.stringify({ anyOf: [{}] }));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fake, "script", join(cwd, "marker.json"), scriptPath, "exec", "-o", join(cwd, "final.json"), "--output-schema", schemaPath], { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr, cwd }));
    child.stdin.end(prompt);
  });
}

describe("fake codex script mode (Orca execution driver C3)", () => {
  it("writes the files the script names for the task in the prompt, and nothing for other tasks", async () => {
    const result = await run("Return JSON only.\nExecute one isolated attempt for task b.\nGoal: x\n", {
      a: { files: { "shared.txt": "A\n" } }, b: { files: { "shared.txt": "B\n", "b.txt": "only b\n" } },
    });
    expect(result.code).toBe(0);
    expect(await readFile(join(result.cwd, "shared.txt"), "utf8")).toBe("B\n");
    expect(await readFile(join(result.cwd, "b.txt"), "utf8")).toBe("only b\n");
    expect(await readFile(join(result.cwd, "marker.json.calls"), "utf8")).toBe("execute\n");
  });

  it("refuses by name, writes nothing and no final answer, when the script has no entry for the task", async () => {
    const result = await run("Execute one isolated attempt for task c.\n", { a: { files: { "shared.txt": "A\n" } } });
    expect(result.code).toBe(3);
    expect(result.stderr).toContain("fake-codex script has no entry for task c");
    await expect(readFile(join(result.cwd, "shared.txt"), "utf8")).rejects.toThrow();
    await expect(readFile(join(result.cwd, "final.json"), "utf8")).rejects.toThrow();
  });
});
```

- [ ] **Step 3：跑三份新判据，看见红**

```bash
cd /Users/biran/code/skills/loop/ccloop
./node_modules/.bin/vitest run tests/control/resultRepository.test.ts tests/workspace/attemptRefNamespace.test.ts tests/runtime/codex/fakeCodexScript.test.ts > "${SCRATCH:?}/t1-red.log" 2>&1; echo "RC=$?" >> "${SCRATCH:?}/t1-red.log"; cat "${SCRATCH:?}/t1-red.log"
```

预言（改动前）：`attemptRefNamespace` 整文件红在 import（`namespacedAttemptRefName`／`registerAttemptRefNamespace` 不存在，模块加载失败 ⇒ **这不是判据红证**，只证明文件接上了）；`resultRepository` 两条红：C2 读到 `theirs`（`expected … to be <mine sha>`），C1 `nlink` 为 1；`fakeCodexScript` 两条红：`script` 模式不认识 ⇒ 走默认分支写 `answer.txt`、不写 `shared.txt`，第二条 exit code 为 0。**实际与预言逐条比，不一致就停下报告。**

- [ ] **Step 4：实现**

`src/control/resultRepository.ts`：`:5` 改为

```ts
import { namespacedAttemptRefName } from "../workspace/worktreeManager.js";
```

`cloneAt` 里（`:24`）：

```ts
  await exec("git", ["clone", "--no-checkout", source, destination], {
```

（**不加 `--local`**：显式 `--local` 跨文件系统时硬链接失败即报错，默认本地 clone 会退回拷贝 —— spec §6 C1。）

`:75`：

```ts
    const ref = namespacedAttemptRefName(attempt, envelope.claim.runId);
```

`src/workspace/worktreeManager.ts`：`:3` 改为

```ts
import { basename, dirname, join, resolve } from "node:path";
```

在 `attemptRefName` 函数（`:53-61`）之后加：

```ts
/**
 * Orca execution driver (2026-09-25), change C2. Every control run's run directory is
 * `<sourceDir>/run`, so attemptRefName above names every control run's attempt
 * `refs/ccloop/run/attempts/<n>`, and a later run in the same target repository overwrites an
 * earlier one's. The control worker registers its claim's run id for its run directory here, and
 * publishAttemptCommit then ALSO pins the attempt under that name. The shared, path-derived ref is
 * still published unchanged for every existing reader.
 */
const attemptRefNamespaces = new Map<string, string>();

export function registerAttemptRefNamespace(runDir: string, namespace: string): void {
  attemptRefNamespaces.set(resolve(runDir), namespace);
}

export function namespacedAttemptRefName(worktreePath: string, namespace: string): string {
  const match = /^attempt-(.+)$/.exec(basename(worktreePath));
  if (match === null) {
    throw new Error(`not an attempt worktree path: ${worktreePath}`);
  }
  return `refs/ccloop/${namespace}/attempts/${match[1]}`;
}
```

`publishAttemptCommit` 里，`await execFileAsync("git", ["update-ref", ref, sha], { cwd: worktreePath });` 之后、`return` 之前加：

```ts
  const namespace = attemptRefNamespaces.get(resolve(dirname(dirname(worktreePath))));
  if (namespace !== undefined) {
    await execFileAsync("git", ["update-ref", namespacedAttemptRefName(worktreePath, namespace), sha], { cwd: worktreePath });
  }
```

`src/control/worker.ts`：import 区加

```ts
import { registerAttemptRefNamespace } from "../workspace/worktreeManager.js";
```

`:147` `const runDir = join(sourceDir, "run");` 之后加一行：

```ts
    registerAttemptRefNamespace(runDir, envelope.claim.runId);
```

`tests/fixtures/fake-codex.mjs`：在 `appendFileSync(marker+".calls",phase+"\n");` 这一行之后插入（**整行锚点、断言命中 == 1**；其余行一字不动）：

```js
  if(mode==="script" && phase==="execute") {
    const task=/^Execute one isolated attempt for task (.+)\.$/m.exec(prompt)?.[1];
    const entry=task===undefined?undefined:JSON.parse(readFileSync(process.argv[4],"utf8"))[task];
    if(entry===undefined) {process.stderr.write(`fake-codex script has no entry for task ${task}\n`);process.exitCode=3;return;}
    for(const [path,content] of Object.entries(entry.files)) writeFileSync(path,content);
  }
```

- [ ] **Step 5：跑新判据看见绿，再跑 ccloop 全套门**

```bash
cd /Users/biran/code/skills/loop/ccloop
S="${SCRATCH:?}"
./node_modules/.bin/vitest run tests/control/resultRepository.test.ts tests/workspace/attemptRefNamespace.test.ts tests/runtime/codex/fakeCodexScript.test.ts > "$S/t1-green.log" 2>&1; echo "RC=$?" >> "$S/t1-green.log"
npm run typecheck > "$S/t1-typecheck.log" 2>&1; echo "RC=$?" >> "$S/t1-typecheck.log"
npm run build > "$S/t1-build.log" 2>&1; echo "RC=$?" >> "$S/t1-build.log"
./node_modules/.bin/vitest run --reporter=json --outputFile="$S/t1-ccloop.json" > "$S/t1-ccloop.log" 2>&1; echo "RC=$?" >> "$S/t1-ccloop.log"
node scripts/check-known-reds.mjs "$S/t1-ccloop.json" > "$S/t1-known-reds.log" 2>&1; echo "RC=$?" >> "$S/t1-known-reds.log"
cat "$S/t1-green.log" "$S/t1-typecheck.log" "$S/t1-build.log" "$S/t1-known-reds.log"
```

Expected：新判据 7/7 绿；typecheck、build RC 0；`check-known-reds.mjs` RC 0（全套 json 的 RC 可以非 0，只要失败 ⊆ 已知红名单）。`tests/control/endToEnd.test.ts` 必须照绿（C2 只加不改的证据）。

- [ ] **Step 6：提交（ccloop）**

```bash
cd /Users/biran/code/skills/loop/ccloop
/usr/bin/git add src/control/resultRepository.ts src/workspace/worktreeManager.ts src/control/worker.ts tests/fixtures/fake-codex.mjs tests/control/resultRepository.test.ts tests/workspace/attemptRefNamespace.test.ts tests/runtime/codex/fakeCodexScript.test.ts
/usr/bin/git diff --cached --stat > "${SCRATCH:?}/t1-cached.txt"; cat "${SCRATCH:?}/t1-cached.txt"
/usr/bin/git commit -F "${SCRATCH:?}/t1-msg.txt"
```

`t1-msg.txt`：

```
feat(control): pin control attempts per run, share objects, script fake codex

For Orca's execution driver. C1: the result repository clone no longer passes
--no-hardlinks, so each control run stops copying the whole object store (the flag
came in with b010788 without a stated reason and no criterion pins it). C2: the
control worker registers its claim's run id for its run directory; publishing an
attempt also pins refs/ccloop/<runId>/attempts/<n>, and the result repository reads
that ref, so two control runs in one target repository no longer read each other's
attempt. The shared path-derived ref is still written unchanged. C3: fake-codex gets
a `script` mode that writes per-task files from a JSON script; existing modes are
untouched.

Co-Authored-By: <implementer's own model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR
```

**变异（变异席在 ccloop 的 `clone --local` 副本里做；每条：前后 sha256、跑「期望红」列）**

| V | 文件 | 变异 | 喂它的场景 | 期望红（且仅） |
|---|---|---|---|---|
| C1-M1 | `src/control/resultRepository.ts` | `["clone", "--no-checkout", source, destination]` → 加回 `"--no-hardlinks",` | 物化结果仓库 | `C1 shares the object store by hard links…` |
| C2-M1 | 同上 | `namespacedAttemptRefName(attempt, envelope.claim.runId)` → `attemptRefName(attempt)`（并改回 import） | 共享 ref 被别的 run 覆盖 | `C2 reads its own run's attempt ref…` |
| C2-M2 | `src/workspace/worktreeManager.ts` | 删掉 publish 末尾 `if (namespace !== undefined) {…}` 整块 | 登记过的 runDir 发布 | `publishes the shared ref and, once registered, …` 与 `tests/control/endToEnd.test.ts` 的 `keeps one execution identity…`（物化读不到按 run 的 ref） |
| C2-M3 | `src/control/worker.ts` | 删掉 `registerAttemptRefNamespace(runDir, envelope.claim.runId);` | 真 control 跑一遍 | `tests/control/endToEnd.test.ts > … keeps one execution identity …`（物化 `rev-parse` 失败） |
| C3-M1 | `tests/fixtures/fake-codex.mjs` | `if(entry===undefined) {…;return;}` → 删掉 `return;` | 脚本无该 task | `refuses by name, writes nothing …`（`final.json` 被写） |
| C3-M2 | 同上 | `for(const [path,content] of Object.entries(entry.files)) writeFileSync(path,content);` → 删 | 脚本有该 task | `writes the files the script names …` |

---

## Task 2：封闭 schema／枚举／store 扩展（run 状态、`drive`、`blockedReason`、`repository_settings`、`set-workspace-mode`）

**Files:**
- Create: `src/control/driveRecord.ts`、`src/control/workspaceSettings.ts`
- Modify: `src/control/migrations.ts:3,60-67`；`src/control/store.ts:86`
- Modify: `src/control/webProtocol.ts`（`:517` 动词、`:533` target、`:636` 之后 payload、`:671`／`:704` 两个 union、`:831` runView、`:1076` 之后结果、`:1136-1144` refine、文末类型）
- Modify: `src/control/commandLedger.ts:40-43,95-100,236-242,304-306`
- Modify: `src/control/stopIntent.ts:131-134,404`；`src/control/webService.ts:29,146-149`＋两个新方法
- Modify: `src/panel/controlViews.ts:104-139,443-451,503-509`
- Modify: `src/panel/controlConfig.ts:45-49`＋实现；`src/panel/controlApi.ts`（`:119` 之后 GET、`:191` 之后路由、`:232` 之后 case）
- Modify: `web/src/controlTypes.ts:86-101,178-182,225`＋结果 union＋新类型
- Modify（只加一行）: `tests/panel/fixtures/controlPanel.ts`（`deps` 里加 `knownRepository`）
- Create: `tests/control/driveRecord.test.ts`、`tests/control/workspaceSettings.test.ts`、`tests/panel/workspaceModeApi.test.ts`

**Interfaces:**
- Produces（`src/control/driveRecord.ts`）：
  - `DRIVER_RUN_STATES = ["start-pending","collected","landed","reconciling","blocked"] as const`
  - `driveStepSchema = z.enum(["A1","A2","B","B'","C","D","R","E"])`，`type DriveStep`
  - `reconcileRecordSchema`／`type ReconcileRecord`：`{copyPath, old, conflictCommit, conflictedPaths, otherTaskId, reconcileRunId, runsDir, contractPath, tokenBudget, spawning, pid, outcome, attemptSha}`
  - `driveRecordSchema`／`type DriveRecord`：`{workspaceMode, sourceDir, workspacePath, targetRepo, prepared, base, envelopeHash, inspectUnknown, outcome, attemptSha, landedCommit, reconcile, blockedAt, blockedReason, cleanedUp}`
  - `RESUME_STATE: Record<DriveStep, string>`；`resumeBlockedDriverRun(store: ControlStore, runId: string): boolean`
- Produces（`src/control/workspaceSettings.ts`）：`type WorkspaceMode = "worktree" | "clone"`；`interface WorkspaceSetting { workspaceMode: WorkspaceMode; revision: number }`；`readWorkspaceSetting(store, repoId): WorkspaceSetting`；`type SetWorkspaceModeCommand`；`applySetWorkspaceMode(deps: { store: ControlStore; admissionGate?: AdmissionGate; knownRepository(repoId: string): boolean }, command: SetWorkspaceModeCommand): CommandSuccessV1 | CommandErrorBodyV1`
- Produces（wire）：verb `set-workspace-mode`；target `{kind:"repository", repoId}`；payload `{workspaceMode}`；结果 `{kind:"workspace-mode-set", repoId, workspaceMode}`；`repositoryWorkspaceSchema`（`{schema:"orca-repository-workspace-v1", repoId, workspaceMode, revision}`）；`runViewSchema` 新增 state `collected|landed|reconciling|blocked` 与字段 `blockedReason: string|null`。
- Produces（服务／配置）：`WebServiceDeps.knownRepository?: (repoId: string) => boolean`；`WebControlService.setWorkspaceMode(command)`、`WebControlService.repositoryKnown(repoId): boolean`；`TrustedControlConfig.resolveRepository(repoId: string): string`（每次调用重校 witness）。
- Produces（HTTP）：`GET /api/control/repositories/:repoId/workspace`；`POST /api/control/repositories/:repoId/workspace-mode`。

- [ ] **Step 1：写判据**

`tests/control/driveRecord.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { WebControlService } from "../../src/control/webService.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { runViewSchema } from "../../src/control/webProtocol.js";
import { RESUME_STATE, resumeBlockedDriverRun, type DriveStep } from "../../src/control/driveRecord.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { ControlError } from "../../src/control/errors.js";
import type { ControlStore } from "../../src/control/store.js";
import { webFixture } from "./fixtures/web.js";

// Execution driver spec §7.4: the run body's new states and its `drive` record are closed schema.

const drive = (over: Record<string, unknown> = {}) => ({
  workspaceMode: "worktree", sourceDir: "/x/state.runs/r", workspacePath: "/x/state.workspaces/r", targetRepo: null,
  prepared: false, base: null, envelopeHash: null, inspectUnknown: 0, outcome: null, attemptSha: null, landedCommit: null,
  reconcile: null, blockedAt: null, blockedReason: null, cleanedUp: false, ...over,
});

async function claimedSoft() {
  const h = await webFixture();
  const service = new WebControlService(h.deps);
  service.confirm(h.command("confirm", { ...h.confirmPayload(), budgetMode: "soft" }));
  await service.start(h.command("start", {}));
  const claim = await deliverScheduledStart({ store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate }, "g");
  if (claim.kind !== "claimed") throw new Error(`claim refused: ${JSON.stringify(claim)}`);
  return { h, runId: claim.runId };
}

function patchRun(store: ControlStore, runId: string, patch: Record<string, unknown>): void {
  const row = store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!;
  store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({ ...JSON.parse(String(row.body)), ...patch }), runId);
}

function thrown(run: () => unknown): ControlError {
  try { run(); } catch (error) { if (error instanceof ControlError) return error; throw error; }
  throw new Error("expected a ControlError, the call returned");
}

describe("driver run states in the read model (execution driver §7.4)", () => {
  it("shows a blocked driver run under its own state with its reason, and the group still reads", async () => {
    const { h, runId } = await claimedSoft(); try {
      patchRun(h.store, runId, { state: "blocked", providerAttemptOrdinal: 1, drive: drive({ blockedAt: "B'", blockedReason: "inspect-unknown" }) });
      const run = readControlGroup(h.store, "epoch-test", "g").runs.find((entry) => entry.runId === runId)!;
      expect(run.state).toBe("blocked");
      expect(run.blockedReason).toBe("inspect-unknown");
      expect(runViewSchema.safeParse(run).success).toBe(true);
    } finally { await h.dispose(); }
  });

  it.each([["start-pending", "starting"], ["collected", "collected"], ["landed", "landed"], ["reconciling", "reconciling"]])(
    "shows the persisted state %s as %s, with no blocked reason", async (persisted, shown) => {
      const { h, runId } = await claimedSoft(); try {
        patchRun(h.store, runId, { state: persisted, providerAttemptOrdinal: 1, drive: drive() });
        const run = readControlGroup(h.store, "epoch-test", "g").runs.find((entry) => entry.runId === runId)!;
        expect(run.state).toBe(shown);
        expect(run.blockedReason).toBe(null);
      } finally { await h.dispose(); }
    });

  it("refuses a drive record carrying a field the closed schema does not know", async () => {
    const { h, runId } = await claimedSoft(); try {
      patchRun(h.store, runId, { state: "start-pending", providerAttemptOrdinal: 1, drive: { ...drive(), stray: true } });
      const error = thrown(() => readControlGroup(h.store, "epoch-test", "g"));
      expect(error.code).toBe("recovery-blocked");
      expect(error.detail?.startsWith(`run-invalid:${runId}:`)).toBe(true);
    } finally { await h.dispose(); }
  });
});

describe("recovery-retry on a blocked driver run (execution driver §2.3)", () => {
  // Literal table, not RESUME_STATE itself: the expectation must not be computed by the code under test.
  const expected: Array<[DriveStep, string]> = [["A1", "starting"], ["A2", "start-pending"], ["B", "start-pending"], ["B'", "unknown"], ["C", "accepted"], ["D", "collected"], ["R", "reconciling"], ["E", "landed"]];

  it.each(expected)("resumes a run blocked at %s in %s, reason cleared and the unknown count reset", async (step, state) => {
    const { h, runId } = await claimedSoft(); try {
      patchRun(h.store, runId, { state: "blocked", providerAttemptOrdinal: 1, drive: drive({ prepared: true, inspectUnknown: 10, blockedAt: step, blockedReason: "why" }) });
      expect(resumeBlockedDriverRun(h.store, runId)).toBe(true);
      const body = JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body));
      expect(body.state).toBe(state);
      expect(body.drive).toMatchObject({ blockedAt: null, blockedReason: null, inspectUnknown: 0, prepared: step !== "A2" });
      expect(RESUME_STATE[step]).toBe(state);
    } finally { await h.dispose(); }
  });

  it("leaves a run that is not blocked exactly as it was", async () => {
    const { h, runId } = await claimedSoft(); try {
      const before = String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body);
      expect(resumeBlockedDriverRun(h.store, runId)).toBe(false);
      expect(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body)).toBe(before);
    } finally { await h.dispose(); }
  });
});
```

`tests/control/workspaceSettings.test.ts`：

```ts
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openControlStore } from "../../src/control/store.js";
import { applySetWorkspaceMode, readWorkspaceSetting, type SetWorkspaceModeCommand } from "../../src/control/workspaceSettings.js";
import { createAdmissionGate } from "../../src/control/admissionGate.js";
import { openTestStore } from "./fixtures/store.js";

// Execution driver spec §3.2 / criterion W1 (store half): a per-repository workspace mode under its
// own revision; no row means worktree.
const command = (commandId: string, expectedRevision: number, workspaceMode: "worktree" | "clone", repoId = "repo"): SetWorkspaceModeCommand => ({
  schema: "orca-raw-command-v1", commandId, expectedRevision, actorId: "human", verb: "set-workspace-mode",
  target: { kind: "repository", repoId }, payload: { workspaceMode },
});
const known = (repoId: string) => repoId === "repo";

describe("repository workspace mode (execution driver §3.2)", () => {
  it("reads worktree at revision 0 when nothing was ever set", async () => {
    const h = await openTestStore(); try {
      expect(readWorkspaceSetting(h.store, "repo")).toEqual({ workspaceMode: "worktree", revision: 0 });
    } finally { await h.dispose(); }
  });

  it("sets clone under the setting's own revision, with no projection, in the repository's ledger scope", async () => {
    const h = await openTestStore(); try {
      const result = applySetWorkspaceMode({ store: h.store, admissionGate: createAdmissionGate(), knownRepository: known }, command("mode-1", 0, "clone"));
      expect(result).toMatchObject({ schema: "orca-command-success-v1", verb: "set-workspace-mode", commandRevision: 1, projectionSeq: null, result: { kind: "workspace-mode-set", repoId: "repo", workspaceMode: "clone" } });
      expect(readWorkspaceSetting(h.store, "repo")).toEqual({ workspaceMode: "clone", revision: 1 });
      expect(h.store.db.prepare("SELECT group_id,scope_kind,scope_id FROM commands WHERE id='mode-1'").get()).toEqual({ group_id: "@repository:repo", scope_kind: "repository", scope_id: "repo" });
    } finally { await h.dispose(); }
  });

  it("refuses a stale revision by name and leaves the setting alone", async () => {
    const h = await openTestStore(); try {
      const deps = { store: h.store, knownRepository: known };
      applySetWorkspaceMode(deps, command("mode-1", 0, "clone"));
      const stale = applySetWorkspaceMode(deps, command("mode-2", 0, "worktree"));
      expect(stale).toEqual({ error: { code: "revision-conflict", message: "The command revision is stale.", commandRevision: 1, evidenceIds: [], retryable: false } });
      expect(readWorkspaceSetting(h.store, "repo")).toEqual({ workspaceMode: "clone", revision: 1 });
    } finally { await h.dispose(); }
  });

  it("refuses a repository this panel was not configured with, and writes no setting", async () => {
    const h = await openTestStore(); try {
      const refused = applySetWorkspaceMode({ store: h.store, knownRepository: known }, command("mode-x", 0, "clone", "elsewhere"));
      expect("error" in refused ? refused.error.code : "applied").toBe("control-target-not-allowed");
      expect(h.store.db.prepare("SELECT COUNT(*) AS n FROM repository_settings").get()!.n).toBe(0);
    } finally { await h.dispose(); }
  });

  it("refuses setting the mode a repository already has", async () => {
    const h = await openTestStore(); try {
      const refused = applySetWorkspaceMode({ store: h.store, knownRepository: known }, command("mode-same", 0, "worktree"));
      expect("error" in refused ? refused.error.code : "applied").toBe("no-op-command");
      expect(readWorkspaceSetting(h.store, "repo")).toEqual({ workspaceMode: "worktree", revision: 0 });
    } finally { await h.dispose(); }
  });

  it("replays a repeated command id without a second write", async () => {
    const h = await openTestStore(); try {
      const deps = { store: h.store, knownRepository: known };
      const first = applySetWorkspaceMode(deps, command("mode-1", 0, "clone"));
      expect(applySetWorkspaceMode(deps, command("mode-1", 0, "clone"))).toEqual(first);
      expect(readWorkspaceSetting(h.store, "repo")).toEqual({ workspaceMode: "clone", revision: 1 });
    } finally { await h.dispose(); }
  });

  it("migrates a version 3 store by adding the settings table", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "orca-migrate-4-")));
    try {
      const first = await openControlStore({ stateDir: join(root, "state") });
      first.db.exec("DROP TABLE repository_settings");
      first.db.prepare("UPDATE meta SET value='3' WHERE key='schemaVersion'").run();
      first.close();
      const second = await openControlStore({ stateDir: join(root, "state") });
      expect(second.db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()!.value).toBe("4");
      expect(readWorkspaceSetting(second, "repo")).toEqual({ workspaceMode: "worktree", revision: 0 });
      second.close();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
```

`tests/panel/workspaceModeApi.test.ts`：

```ts
import { afterAll, describe, expect, it } from "vitest";
import { commandSuccessSchema, repositoryWorkspaceSchema } from "../../src/control/webProtocol.js";
import { command, createHarness, get, json } from "./fixtures/controlPanel.js";

// Execution driver spec §3.2 / criterion W1 (HTTP half).
const h = createHarness();
afterAll(async () => { await h.dispose(); });

describe("the repository workspace mode over HTTP (execution driver §3.2)", () => {
  it("reads the default, sets clone under the setting's own revision, reads it back, and refuses a stale revision by name", async () => {
    const panel = await h.boot("epoch-ws-mode", await h.workspace());
    expect(repositoryWorkspaceSchema.parse(await json(await get(panel, "/api/control/repositories/repo/workspace"))))
      .toEqual({ schema: "orca-repository-workspace-v1", repoId: "repo", workspaceMode: "worktree", revision: 0 });
    const set = await command(panel, "/api/control/repositories/repo/workspace-mode", { commandId: "ws-1", expectedRevision: 0, payload: { workspaceMode: "clone" } });
    expect(set.status).toBe(200);
    expect(commandSuccessSchema.parse(await json(set))).toMatchObject({
      verb: "set-workspace-mode", target: { kind: "repository", repoId: "repo" }, commandRevision: 1, projectionSeq: null,
      result: { kind: "workspace-mode-set", repoId: "repo", workspaceMode: "clone" },
    });
    expect(await json(await get(panel, "/api/control/repositories/repo/workspace"))).toMatchObject({ workspaceMode: "clone", revision: 1 });
    const stale = await command(panel, "/api/control/repositories/repo/workspace-mode", { commandId: "ws-2", expectedRevision: 0, payload: { workspaceMode: "worktree" } });
    expect(stale.status).toBe(409);
    expect((await json(stale)).error).toMatchObject({ code: "revision-conflict", commandRevision: 1 });
    await panel.close();
  });

  it("refuses a repository the panel was not configured with, on read and on write", async () => {
    const panel = await h.boot("epoch-ws-unknown", await h.workspace());
    const read = await get(panel, "/api/control/repositories/elsewhere/workspace");
    expect(read.status).toBe(404);
    expect((await json(read)).error.code).toBe("control-target-not-allowed");
    const write = await command(panel, "/api/control/repositories/elsewhere/workspace-mode", { commandId: "ws-x", expectedRevision: 0, payload: { workspaceMode: "clone" } });
    expect(write.status).toBe(404);
    expect((await json(write)).error.code).toBe("control-target-not-allowed");
    await panel.close();
  });
});
```

⚠️ 开工扫描：`command`／`get`／`json`／`createHarness`／`h.workspace()`／`h.boot()` 以 `tests/panel/fixtures/controlPanel.ts` 现有导出为准（`controlRecoveryApi.test.ts:12-22` 就这么用）；`json()` 对一个 Response 只调一次。

- [ ] **Step 2：跑，看见红**

```bash
cd /Users/biran/code/skills/loop/Orca
./node_modules/.bin/vitest run tests/control/driveRecord.test.ts tests/control/workspaceSettings.test.ts tests/panel/workspaceModeApi.test.ts > "${SCRATCH:?}/t2-red.log" 2>&1; echo "RC=$?" >> "${SCRATCH:?}/t2-red.log"; cat "${SCRATCH:?}/t2-red.log"
```

预言：三个文件都红在 import（`driveRecord.js`／`workspaceSettings.js` 不存在；`repositoryWorkspaceSchema` 未导出）—— 只证明接上了，不是判据红证；判据红证由本 Task 末尾的变异表给。

- [ ] **Step 3：`src/control/driveRecord.ts`（新）**

```ts
import { z } from "zod";
import { idSchema, safeInteger } from "./schema.js";
import { recordProjectionChange } from "./projectionJournal.js";
import type { ControlStore } from "./store.js";

/**
 * Execution driver spec §2.2. The five run states only the driver writes. Its `running` is the
 * existing `accepted` (displayed "running"), so the read model's "accepted with no provider attempt"
 * guard keeps applying. None of the five is terminal: each still owns its work item (`active=1`).
 */
export const DRIVER_RUN_STATES = ["start-pending", "collected", "landed", "reconciling", "blocked"] as const;

/** The step a blocked run was at, so a retry can send it back there (spec §2.3). */
export const driveStepSchema = z.enum(["A1", "A2", "B", "B'", "C", "D", "R", "E"]);
export type DriveStep = z.infer<typeof driveStepSchema>;

const commitSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);

/** spec §5.3: one conflict's reconciliation, recorded before and while it runs so a restart can find it. */
export const reconcileRecordSchema = z.object({
  copyPath: z.string().min(1),
  old: commitSchema,
  conflictCommit: commitSchema,
  conflictedPaths: z.array(z.string().min(1)),
  otherTaskId: idSchema,
  reconcileRunId: z.string().min(1),
  runsDir: z.string().min(1),
  contractPath: z.string().min(1),
  tokenBudget: safeInteger.positive(),
  spawning: z.boolean(),
  pid: safeInteger.positive().nullable(),
  outcome: z.string().min(1).nullable(),
  attemptSha: commitSchema.nullable(),
}).strict();
export type ReconcileRecord = z.infer<typeof reconcileRecordSchema>;

/** Everything the driver writes into a run body, in one closed record (spec §7.4). */
export const driveRecordSchema = z.object({
  workspaceMode: z.enum(["worktree", "clone"]),
  sourceDir: z.string().min(1),
  workspacePath: z.string().min(1),
  targetRepo: z.string().min(1).nullable(),
  prepared: z.boolean(),
  base: commitSchema.nullable(),
  envelopeHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  inspectUnknown: safeInteger,
  outcome: z.string().min(1).nullable(),
  attemptSha: commitSchema.nullable(),
  landedCommit: commitSchema.nullable(),
  reconcile: reconcileRecordSchema.nullable(),
  blockedAt: driveStepSchema.nullable(),
  blockedReason: z.string().min(1).nullable(),
  cleanedUp: z.boolean(),
}).strict();
export type DriveRecord = z.infer<typeof driveRecordSchema>;

/** Where a run blocked at each step resumes (spec §2.3); `running` is persisted as `accepted`. */
export const RESUME_STATE: Record<DriveStep, string> = {
  A1: "starting", A2: "start-pending", B: "start-pending", "B'": "unknown", C: "accepted", D: "collected", R: "reconciling", E: "landed",
};

/**
 * `recovery-retry` on a blocked driver run: back to the step it was blocked at, reason cleared.
 * Blocked at A2 means the workspace was never recorded as prepared, so A2 runs again; blocked at R
 * forgets the dead reconciliation process so the next round decides afresh. Answers whether it
 * changed anything, which is what `recovery-observed.resolved` reports.
 */
export function resumeBlockedDriverRun(store: ControlStore, runId: string): boolean {
  const row = store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId);
  if (!row) return false;
  const run = JSON.parse(String(row.body)) as { groupId: string; state: string; drive?: DriveRecord };
  if (run.state !== "blocked" || run.drive === undefined || run.drive.blockedAt === null) return false;
  const step = run.drive.blockedAt;
  run.state = RESUME_STATE[step];
  run.drive = {
    ...run.drive, blockedAt: null, blockedReason: null, inspectUnknown: 0,
    prepared: step === "A2" ? false : run.drive.prepared,
    reconcile: step === "R" && run.drive.reconcile !== null ? { ...run.drive.reconcile, spawning: false, pid: null, outcome: null, attemptSha: null } : run.drive.reconcile,
  };
  store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(run), runId);
  recordProjectionChange(store, [run.groupId]);
  return true;
}
```

- [ ] **Step 4：`src/control/migrations.ts` 与 `src/control/store.ts`**

`migrations.ts`：`:3` → `export const schemaVersion = "4";`；在 `schema2To3` 定义之后加

```ts
// Execution driver spec §3.2: the per-repository workspace mode. No row means "worktree".
export const schema3To4 = `CREATE TABLE repository_settings(repo_id TEXT PRIMARY KEY, body TEXT NOT NULL) STRICT;
`;
```

`:60` → `export const initialSchema = legacySchema + schema1To2 + schema2To3 + schema3To4;`；`migrateSchema` 三个分支：

```ts
  if (fromVersion === "1") store.exec(schema1To2 + schema2To3 + schema3To4);
  else if (fromVersion === "2") store.exec(schema2To3 + schema3To4);
  else if (fromVersion === "3") store.exec(schema3To4);
  else throw new Error("control-schema-unsupported");
```

`store.ts:86`：

```ts
        if (version !== schemaVersion && version !== "1" && version !== "2" && version !== "3") throw new ControlError("control-schema-unsupported");
```

- [ ] **Step 5：`src/control/webProtocol.ts`**

`:517` 的 `commandVerbSchema` 枚举末尾（`"shutdown",` 之后）加 `"set-workspace-mode",`。

`:533` 之前加，并把它加进 `commandTargetSchema` 的 union 末尾（`global` 之后）：

```ts
const repositoryCommandTargetSchema = z.object({ kind: z.literal("repository"), repoId: idSchema }).strict();
```

```ts
  repositoryCommandTargetSchema,
```

`:636` 的 `shutdownPayloadSchema` 之后加：

```ts
export const workspaceModeSchema = z.enum(["worktree", "clone"]);
export const setWorkspaceModePayloadSchema = z.object({ workspaceMode: workspaceModeSchema }).strict();
```

raw union（`:671` shutdown 那一行之后）与 effective union（`:704` 之后）各加一个变体：

```ts
  z.object({ ...rawCommandFields, verb: z.literal("set-workspace-mode"), target: repositoryCommandTargetSchema, payload: setWorkspaceModePayloadSchema }).strict(),
```

```ts
  z.object({ ...effectiveCommandFields, verb: z.literal("set-workspace-mode"), target: repositoryCommandTargetSchema, payload: setWorkspaceModePayloadSchema }).strict(),
```

`runViewSchema`（`:831`）：state 枚举在 `"settled-unrecoverable",` 之后加 `"collected", "landed", "reconciling", "blocked",`；在 `failureCode: nonemptyString.nullable(),` 之后加 `blockedReason: nonemptyString.nullable(),`。

结果 union（`:1076` `limit-set` 之后）：

```ts
  z.object({ kind: z.literal("workspace-mode-set"), repoId: idSchema, workspaceMode: workspaceModeSchema }).strict(),
```

`commandSuccessSchema` 的 superRefine（`:1136-1144`）整段换成：

```ts
  .superRefine((value, ctx) => {
    const isShutdown = value.verb === "shutdown";
    // Execution driver spec §3.2: a repository-scoped command has its setting's revision and no group
    // projection.
    const projectionless = isShutdown || value.verb === "set-workspace-mode";
    if (isShutdown ? value.commandRevision !== null : value.commandRevision === null) {
      issue(ctx, ["commandRevision"], "command-revision-nullability-mismatch");
    }
    if (projectionless ? value.projectionSeq !== null : value.projectionSeq === null) {
      issue(ctx, ["projectionSeq"], "command-revision-nullability-mismatch");
    }
  });
```

文末类型区加：

```ts
export const repositoryWorkspaceSchema = z
  .object({ schema: z.literal("orca-repository-workspace-v1"), repoId: idSchema, workspaceMode: workspaceModeSchema, revision: safeInteger })
  .strict();
export type RepositoryWorkspaceV1 = z.infer<typeof repositoryWorkspaceSchema>;
export type SetWorkspaceModePayload = z.infer<typeof setWorkspaceModePayloadSchema>;
```

⚠️ `repositoryWorkspaceSchema` 引用 `workspaceModeSchema`，必须放在它之后（放文末即可）；`webProtocol.ts` 不许 import `driveRecord.ts`（handoff §4.1 的 ESM 环教训：`webProtocol.ts` 被太多模块顶层 import）。

- [ ] **Step 6：`src/control/commandLedger.ts`（`repository` scope，D16）**

`:40-43` 的 `scope` 换成：

```ts
type CommandScope = { key: string; kind: "group" | "global" | "repository"; id: string; groupId: string | null; repoId: string | null };

function scope(command: RawAuthorityCommandV1): CommandScope {
  if (command.target.kind === "global") return { key: "@global", kind: "global", id: "global", groupId: null, repoId: null };
  if (command.target.kind === "repository") {
    return { key: `@repository:${command.target.repoId}`, kind: "repository", id: command.target.repoId, groupId: null, repoId: command.target.repoId };
  }
  return { key: command.target.groupId, kind: "group", id: command.target.groupId, groupId: command.target.groupId, repoId: null };
}

/**
 * Execution driver spec §3.2: a repository-scoped command is checked against its setting's own
 * revision (0 while no row exists), not against any group's.
 */
function repositoryRevision(store: ControlStore, repoId: string): number {
  const row = store.db.prepare("SELECT body FROM repository_settings WHERE repo_id=?").get(repoId);
  if (!row) return 0;
  const revision = (JSON.parse(String(row.body)) as { revision?: unknown }).revision;
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision <= 0) throw new ControlError("recovery-blocked", "repository-settings-invalid");
  return revision;
}
```

`preflightWebCommand` 里（`:95-100`）三行换成：

```ts
    const groupRow = commandScope.groupId === null ? undefined : store.db.prepare("SELECT revision,projection_seq FROM groups WHERE id=?").get(commandScope.groupId);
    const currentCommandRevision = commandScope.repoId !== null ? repositoryRevision(store, commandScope.repoId)
      : commandScope.groupId === null ? 0 : Number(groupRow?.revision ?? 0);
    if (rawCommand.expectedRevision === currentCommandRevision) return null;

    const commandRevision = commandScope.repoId !== null ? currentCommandRevision : commandScope.groupId === null ? null : currentCommandRevision;
```

`applyWebCommand` 里（`:236-238`）：

```ts
    const groupRow = commandScope.groupId === null ? undefined : store.db.prepare("SELECT revision,projection_seq FROM groups WHERE id=?").get(commandScope.groupId);
    const currentCommandRevision = commandScope.repoId !== null ? repositoryRevision(store, commandScope.repoId)
      : commandScope.groupId === null ? 0 : Number(groupRow?.revision ?? 0);
    const resultCommandRevision = commandScope.repoId !== null ? currentCommandRevision : commandScope.groupId === null ? null : currentCommandRevision;
```

（`currentProjectionSeq`／`nextProjectionSeq` 两行不改：repository scope 的 `groupId` 为 null ⇒ 两者都是 null。）

`:304-306` 的 `commandRevision`：

```ts
    const commandRevision = commandScope.repoId !== null ? repositoryRevision(store, commandScope.repoId)
      : commandScope.groupId === null ? null : Number(finalGroup?.revision ?? currentCommandRevision);
```

- [ ] **Step 7：target 收窄（TypeScript 会点出这三处；逐处改、不许 `as` 绕过）**

`src/control/stopIntent.ts:132`：`if (command.target.kind === "global" || command.target.kind === "repository") throw new ControlError("control-target-not-allowed");`
`src/control/stopIntent.ts:404`：`if (target.kind === "global" || target.kind === "repository") throw new ControlError("control-target-not-allowed");`
`src/control/webService.ts:147`：`if (command.target.kind === "global" || command.target.kind === "repository") throw new ControlError("group-not-found");`
然后 `npm run typecheck`，若还有别处报 `repository` 变体缺字段，**停下报告**（不在本计划清单里）。

- [ ] **Step 8：`src/control/workspaceSettings.ts`（新）**

```ts
import { z } from "zod";
import { applyWebCommand } from "./commandLedger.js";
import { canonicalBytes } from "./canonicalJson.js";
import { ControlError } from "./errors.js";
import { safeInteger } from "./schema.js";
import type { AdmissionGate } from "./admissionGate.js";
import type { ControlStore } from "./store.js";
import type { CommandErrorBodyV1, CommandSuccessV1, RawAuthorityCommandV1 } from "./webProtocol.js";

export type WorkspaceMode = "worktree" | "clone";
export interface WorkspaceSetting { workspaceMode: WorkspaceMode; revision: number }
export type SetWorkspaceModeCommand = Extract<RawAuthorityCommandV1, { verb: "set-workspace-mode" }>;

const settingSchema = z.object({ workspaceMode: z.enum(["worktree", "clone"]), revision: safeInteger.positive() }).strict();

/** Execution driver spec §3.2: no row is the default, `worktree` at revision 0. */
export function readWorkspaceSetting(store: ControlStore, repoId: string): WorkspaceSetting {
  const row = store.db.prepare("SELECT body FROM repository_settings WHERE repo_id=?").get(repoId);
  if (!row) return { workspaceMode: "worktree", revision: 0 };
  const parsed = settingSchema.safeParse(JSON.parse(String(row.body)));
  if (!parsed.success) throw new ControlError("recovery-blocked", "repository-settings-invalid");
  return parsed.data;
}

/**
 * spec §3.2: changes the mode only for runs that enter A1 afterwards. A repository the panel was not
 * started with is refused by name; so is setting the mode it already has.
 */
export function applySetWorkspaceMode(
  deps: { store: ControlStore; admissionGate?: AdmissionGate; knownRepository(repoId: string): boolean },
  command: SetWorkspaceModeCommand,
): CommandSuccessV1 | CommandErrorBodyV1 {
  const release = deps.admissionGate?.enter();
  try {
    return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, {
      rawCommand: command,
      expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
      // The setting carries its own revision; no group revision or projection moves.
      authorityChanged: false,
      projectionGroupIds: [],
      apply: (context) => {
        const target = context.rawCommand.target;
        if (target.kind !== "repository" || !deps.knownRepository(target.repoId)) throw new ControlError("control-target-not-allowed");
        const payload = context.effectiveCommand.payload as { workspaceMode: WorkspaceMode };
        if (readWorkspaceSetting(deps.store, target.repoId).workspaceMode === payload.workspaceMode) throw new ControlError("no-op-command");
        const next: WorkspaceSetting = { workspaceMode: payload.workspaceMode, revision: context.nextCommandRevision };
        deps.store.db.prepare("INSERT INTO repository_settings(repo_id,body) VALUES (?,?) ON CONFLICT(repo_id) DO UPDATE SET body=excluded.body")
          .run(target.repoId, canonicalBytes(next).toString("utf8"));
        return { status: 200, body: {
          schema: "orca-command-success-v1", commandId: context.rawCommand.commandId, actorId: context.rawCommand.actorId,
          verb: context.rawCommand.verb, target: context.rawCommand.target, commandRevision: context.nextCommandRevision, projectionSeq: null,
          effectivePayloadHash: context.effectivePayloadHash, authorityCommandHash: context.authorityCommandHash,
          result: { kind: "workspace-mode-set", repoId: target.repoId, workspaceMode: next.workspaceMode },
        } };
      },
    }).body;
  } finally { release?.(); }
}
```

- [ ] **Step 9：`src/panel/controlViews.ts`**

import 区加 `import { driveRecordSchema } from "../control/driveRecord.js";`。
`persistedRunSchema`（`:104-139`）：state 枚举在 `"settled-recoverable", "settled-restartable", "settled-unrecoverable",`（`:123`）之后加一行
`"start-pending", "collected", "landed", "reconciling", "blocked",`；在 `failureCode: z.string().min(1).nullable(),` 之后加 `drive: driveRecordSchema.optional(),`。
`displayRunState`（`:443-451`）在 `case "settled": …` 之前加：

```ts
    case "start-pending": return "starting";
    case "collected": case "landed": case "reconciling": case "blocked": return run.state;
```

`runViews` 返回对象（`:507` 那一行 `failureCode: run.failureCode,` 之后）加 `blockedReason: run.drive?.blockedReason ?? null,`。

- [ ] **Step 10：服务、配置、路由**

`src/control/webService.ts`：import 区加 `import { applySetWorkspaceMode, type SetWorkspaceModeCommand } from "./workspaceSettings.js";`；`:29` 改为

```ts
export interface WebServiceDeps extends AsyncImportDeps { admissionGate?: AdmissionGate; now?: () => Date; knownRepository?: (repoId: string) => boolean }
```

`recoveryRetry` 方法之后加：

```ts
  /** Execution driver spec §3.2. A panel started without the repository refuses it by name. */
  async setWorkspaceMode(command: SetWorkspaceModeCommand): Promise<WebCommandResult> {
    return applySetWorkspaceMode({ store: this.store, admissionGate: this.deps.admissionGate, knownRepository: this.deps.knownRepository ?? (() => false) }, command) as WebCommandResult;
  }
  repositoryKnown(repoId: string): boolean { return this.deps.knownRepository?.(repoId) ?? false; }
```

`src/panel/controlConfig.ts`：`TrustedControlConfig`（`:45-49`）加 `resolveRepository(repoId: string): string;`；`createTrustedControlConfig` 返回对象在 `resolveTarget` 之后加：

```ts
    /** Execution driver spec §3.1: the trusted path by repoId, its witness re-validated on every use. */
    resolveRepository(repoId: string): string {
      const repository = repositories.get(repoId);
      if (!repository) throw new ControlError("control-target-not-allowed");
      return revalidatePath(repository.witness);
    },
```

`src/panel/controlApi.ts`：import 区把 `webProtocol.js` 那一行加上 `repositoryWorkspaceSchema`，并加 `import { readWorkspaceSetting } from "../control/workspaceSettings.js";`。`:119-121`（`/api/control/recovery`）之后加：

```ts
  app.get("/api/control/repositories/:repoId/workspace", (req, res) => {
    const repoId = String(req.params.repoId);
    if (!idSchema.safeParse(repoId).success || !deps.service?.repositoryKnown(repoId)) {
      sendControlError(res, 404, "control-target-not-allowed", "No trusted repository has this id.");
      return;
    }
    res.json(repositoryWorkspaceSchema.parse({ schema: "orca-repository-workspace-v1", repoId, ...readWorkspaceSetting(deps.store, repoId) }));
  });
```

路由表（`:191` `resume-from-handoff` 之后）加：

```ts
    {
      path: "/api/control/repositories/:repoId/workspace-mode",
      verb: "set-workspace-mode",
      // The ledger key is the repository scope's, so the retained result is looked up under it.
      target: (params) => {
        const repoId = idSchema.parse(params.repoId);
        return { groupId: `@repository:${repoId}`, target: { kind: "repository", repoId } };
      },
    },
```

switch（`:232` 之后）加 `case "set-workspace-mode": await service.setWorkspaceMode(command); break;`。

`tests/panel/fixtures/controlPanel.ts`：`const deps = {` 对象里加一行（只加，不改别的）：

```ts
        knownRepository: (repoId: string) => repoId === "repo",
```

- [ ] **Step 11：`web/src/controlTypes.ts`**

`RunViewV1.state`（`:91`）末尾加 `| "collected" | "landed" | "reconciling" | "blocked"`；`failureCode: string | null;` 之后加
`blockedReason?: string | null;`（可选：web 既有三个夹具 `controlCommandRecovery`／`controlPanel`／`evidenceLink` 构造 run 字面量，必填会让 `--ws check` 红 —— D7 的零改写原则）。
`CommandTargetV1`（`:178-182`）加 `| { kind: "repository"; repoId: string }`；`CommandSuccessV1.verb`（`:225`）末尾加 `| "set-workspace-mode"`；result union 在 `limit-set` 之后加
`| { kind: "workspace-mode-set"; repoId: string; workspaceMode: "worktree" | "clone" }`；文件末尾加：

```ts
export type RepositoryWorkspaceV1 = { schema: "orca-repository-workspace-v1"; repoId: string; workspaceMode: "worktree" | "clone"; revision: number };
```

- [ ] **Step 12：看见绿**

```bash
cd /Users/biran/code/skills/loop/Orca
S="${SCRATCH:?}"
npm run typecheck > "$S/t2-tsc.log" 2>&1; echo "RC=$?" >> "$S/t2-tsc.log"
./node_modules/.bin/vitest run tests/control/driveRecord.test.ts tests/control/workspaceSettings.test.ts tests/panel/workspaceModeApi.test.ts > "$S/t2-green.log" 2>&1; echo "RC=$?" >> "$S/t2-green.log"
./node_modules/.bin/vitest run tests/control tests/panel --reporter=json --outputFile="$S/t2-suite.json" > "$S/t2-suite.log" 2>&1; echo "RC=$?" >> "$S/t2-suite.log"
npm run --ws check > "$S/t2-ws.log" 2>&1; echo "RC=$?" >> "$S/t2-ws.log"
cat "$S/t2-tsc.log" "$S/t2-green.log" "$S/t2-suite.log" "$S/t2-ws.log"
```

Expected：typecheck、ws check RC 0；新判据 24/24（driveRecord 15、workspaceSettings 7、workspaceModeApi 2）；`tests/control`＋`tests/panel` 全绿（允许的红只有 handoff §三那条 SIGTERM flake，见红先单文件重跑）。

- [ ] **Step 13：提交**

```bash
cd /Users/biran/code/skills/loop/Orca
/usr/bin/git add src/control/driveRecord.ts src/control/workspaceSettings.ts src/control/migrations.ts src/control/store.ts src/control/webProtocol.ts src/control/commandLedger.ts src/control/stopIntent.ts src/control/webService.ts src/panel/controlViews.ts src/panel/controlConfig.ts src/panel/controlApi.ts web/src/controlTypes.ts tests/panel/fixtures/controlPanel.ts tests/control/driveRecord.test.ts tests/control/workspaceSettings.test.ts tests/panel/workspaceModeApi.test.ts
/usr/bin/git commit -F "${SCRATCH:?}/t2-msg.txt"
```

`t2-msg.txt`：

```
feat(control): close the schemas the execution driver writes

Run bodies gain the driver's five states and one strict `drive` record; the read
model shows them (start-pending as starting) with a blockedReason. A per-repository
workspace mode lives in a new repository_settings table (schema v4) behind a
set-workspace-mode command whose ledger scope is the repository and whose revision
is the setting's own. The trusted config resolves a repository path by id with its
witness re-validated. No existing criterion is changed.

Co-Authored-By: <implementer's own model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR
```

**变异**

| V | 文件 | 变异 | 喂它的场景 | 期望红（且仅） |
|---|---|---|---|---|
| T2-M1 | `src/panel/controlViews.ts` | `displayRunState` 里删 `case "start-pending": return "starting";` | 显示 start-pending | `shows the persisted state start-pending as starting …`（显示 undefined ⇒ `group-view` 拦，`readControlGroup` 抛） |
| T2-M2 | 同上 | 删 `blockedReason: run.drive?.blockedReason ?? null,` | 任何带 run 的组视图 | 本文件 5 条（`shows a blocked driver run …`、`shows the persisted state …` 四格）**与**所有读带 run 的组视图的既有判据（`runViewSchema` 的 `blockedReason` 必填 ⇒ `group-view` 拦），例：`tests/control/webDispatch.test.ts` > `renders a web-started group through the panel read path`。**变异席逐条记名**，这条变异不独占 |
| T2-M3 | `src/control/driveRecord.ts` | `driveRecordSchema` 的 `.strict()` → `.passthrough()` | 多一个字段 | `refuses a drive record carrying a field …` |
| T2-M4 | 同上 | `RESUME_STATE` 的 `"B'": "unknown"` → `"B'": "start-pending"` | 在 B' 被拦的 run 重试 | `resumes a run blocked at B' in unknown …` |
| T2-M5 | 同上 | 删 `prepared: step === "A2" ? false : run.drive.prepared,`（整行换成 `prepared: run.drive.prepared,`） | 在 A2 被拦 | `resumes a run blocked at A2 …`（prepared 仍 true） |
| T2-M6 | `src/control/commandLedger.ts` | `repositoryRevision` 恒 `return 0;` | 第二次设置 | `refuses a stale revision by name …`（不再 409）与 HTTP 第一条的 `commandRevision: 1` 之后那段 |
| T2-M7 | `src/control/workspaceSettings.ts` | 删 `|| !deps.knownRepository(target.repoId)` | 未知仓库 | `refuses a repository this panel was not configured with …`（store 与 HTTP 两条） |
| T2-M8 | 同上 | 删 no-op 那一行 | 设成现值 | `refuses setting the mode a repository already has` |
| T2-M9 | `src/control/migrations.ts` | `else if (fromVersion === "3") store.exec(schema3To4);` → 删 | v3 库 | `migrates a version 3 store …`（`control-schema-unsupported`） |
| T2-M10 | `src/control/webProtocol.ts` | refine 里 `projectionless` 退回 `isShutdown` | 设置成功的回包 | `sets clone under the setting's own revision …` 与 HTTP 第一条（成功体被 `validatedOutcome` 拒 ⇒ `control-command-result-invalid`） |

---

## Task 3：工作区模块（目录根、work 分支、工作区建／复用／删、attempt 提交、清理）

**Files:**
- Create: `src/control/workspace.ts`
- Create: `tests/control/workspace.test.ts`

**Interfaces:**
- Consumes: `git(repo: string, args: string[]): Promise<string>`、`ORCA_IDENTITY`（`src/scheduler/gitExec.ts:26,47`）；`within(root, path): boolean`（`src/control/archive.ts:24`）；`privateDirectory(input): string`（`src/control/paths.ts:5`，逐级 mkdir 0700、拒符号链接、返回 realpath）。
- Produces（`src/control/workspace.ts`）：
  - `QUIET_GIT: string[]` ＝ `["-c","core.hooksPath=/dev/null","-c","core.fsmonitor=false"]`
  - `interface WorkspaceRoots { runsRoot: string; workspacesRoot: string }`；`controlWorkspaceRoots(stateDir: string): WorkspaceRoots`
  - `sourceDirOf(roots, runId)`、`workspacePathOf(roots, runId)`、`landingPathOf(roots, runId)`、`conflictPathOf(roots, runId)`、`reconcileRunsDirOf(roots, runId)`：`string`
  - `workBranchRef(groupId): string` ⇒ `refs/heads/orca/<groupId>`；`incomingRefOf(runId): string` ⇒ `refs/orca/incoming/<runId>`
  - `revParse(repo, rev): Promise<string>`；`ensureWorkBranch(targetRepo, groupId): Promise<string>`（返回尖端 sha）
  - `removeOwnPath(targetRepo, roots, path): Promise<void>`；`ensureWorkspace(targetRepo, mode: WorkspaceMode, path, base, roots): Promise<void>`
  - `commitAttempt(resultRepo): Promise<string>`；`cleanupRunWorkspace(targetRepo, roots, runId, workspacePath): Promise<void>`
  - `compareAndSwap(repo, ref, next, old): Promise<boolean>`

- [ ] **Step 1：写判据 `tests/control/workspace.test.ts`**

```ts
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupRunWorkspace, commitAttempt, compareAndSwap, controlWorkspaceRoots, ensureWorkBranch, ensureWorkspace,
  incomingRefOf, removeOwnPath, workspacePathOf,
} from "../../src/control/workspace.js";
import { within } from "../../src/control/archive.js";

// Execution driver spec §3 / §5.1: workspaces are the driver's own, the person's checkout is never touched.
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const g = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args], { cwd, encoding: "utf8" }).trim();
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

async function target() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-workspace-")));
  roots.push(root);
  const repo = join(root, "target");
  await mkdir(repo);
  g(repo, "init", "-q", "-b", "main");
  await writeFile(join(repo, "shared.txt"), "base\n");
  g(repo, "add", "shared.txt");
  g(repo, "commit", "-qm", "base");
  const state = join(root, "state");
  await mkdir(state, { mode: 0o700 });
  return { root, repo, state, roots: controlWorkspaceRoots(state), head: g(repo, "rev-parse", "HEAD") };
}

describe("workspace roots (execution driver §3.2, deviation D9)", () => {
  it("puts runs and workspaces beside the store directory, never inside it, at 0700", async () => {
    const t = await target();
    expect(t.roots).toEqual({ runsRoot: `${t.state}.runs`, workspacesRoot: `${t.state}.workspaces` });
    expect(within(t.state, t.roots.runsRoot)).toBe(false);
    expect(within(t.state, t.roots.workspacesRoot)).toBe(false);
    expect(statSync(t.roots.runsRoot).mode & 0o777).toBe(0o700);
    expect(statSync(t.roots.workspacesRoot).mode & 0o777).toBe(0o700);
  });
});

describe("the work branch (execution driver §5.1)", () => {
  it("creates orca/<group> at the current HEAD commit without moving HEAD or touching the index", async () => {
    const t = await target();
    const index = sha256(join(t.repo, ".git", "index"));
    expect(await ensureWorkBranch(t.repo, "g")).toBe(t.head);
    expect(g(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(t.head);
    expect(g(t.repo, "symbolic-ref", "HEAD")).toBe("refs/heads/main");
    expect(sha256(join(t.repo, ".git", "index"))).toBe(index);
  });

  it("leaves an existing branch where it is", async () => {
    const t = await target();
    await ensureWorkBranch(t.repo, "g");
    await writeFile(join(t.repo, "shared.txt"), "moved\n");
    g(t.repo, "commit", "-qam", "moved");
    expect(await ensureWorkBranch(t.repo, "g")).toBe(t.head);
  });
});

describe("the run workspace (execution driver §3.2)", () => {
  it("adds a detached worktree at base, registered in the target, and reuses it while HEAD is still base", async () => {
    const t = await target();
    const path = workspacePathOf(t.roots, "run-1");
    await ensureWorkspace(t.repo, "worktree", path, t.head, t.roots);
    expect(g(t.repo, "worktree", "list", "--porcelain").split("\n")).toContain(`worktree ${path}`);
    expect(g(path, "rev-parse", "HEAD")).toBe(t.head);
    await writeFile(join(path, "marker.txt"), "kept\n");
    await ensureWorkspace(t.repo, "worktree", path, t.head, t.roots);
    expect(await readFile(join(path, "marker.txt"), "utf8")).toBe("kept\n");
  });

  it("rebuilds a workspace whose HEAD is not base", async () => {
    const t = await target();
    const path = workspacePathOf(t.roots, "run-1");
    await ensureWorkspace(t.repo, "worktree", path, t.head, t.roots);
    await writeFile(join(path, "marker.txt"), "stale\n");
    await writeFile(join(t.repo, "shared.txt"), "next\n");
    g(t.repo, "commit", "-qam", "next");
    const next = g(t.repo, "rev-parse", "HEAD");
    await ensureWorkspace(t.repo, "worktree", path, next, t.roots);
    expect(g(path, "rev-parse", "HEAD")).toBe(next);
    expect(existsSync(join(path, "marker.txt"))).toBe(false);
  });

  it("clones in clone mode: its own .git directory, detached at base, not registered in the target", async () => {
    const t = await target();
    const path = workspacePathOf(t.roots, "run-2");
    await ensureWorkspace(t.repo, "clone", path, t.head, t.roots);
    expect(statSync(join(path, ".git")).isDirectory()).toBe(true);
    expect(g(path, "rev-parse", "HEAD")).toBe(t.head);
    expect(g(t.repo, "worktree", "list", "--porcelain").split("\n")).not.toContain(`worktree ${path}`);
  });

  it("refuses to touch a path it did not name, and removes nothing", async () => {
    const t = await target();
    const foreign = join(t.root, "foreign");
    await mkdir(foreign);
    await writeFile(join(foreign, "keep.txt"), "mine\n");
    await expect(removeOwnPath(t.repo, t.roots, foreign)).rejects.toThrow(/not a workspace this driver named/);
    await expect(ensureWorkspace(t.repo, "worktree", foreign, t.head, t.roots)).rejects.toThrow(/not a workspace this driver named/);
    expect(await readFile(join(foreign, "keep.txt"), "utf8")).toBe("mine\n");
  });
});

describe("the attempt commit (execution driver §3.3)", () => {
  it("commits a dirty result repository on top of its HEAD and returns the new commit", async () => {
    const t = await target();
    const before = g(t.repo, "rev-parse", "HEAD");
    await writeFile(join(t.repo, "shared.txt"), "attempt\n");
    await writeFile(join(t.repo, "new.txt"), "untracked\n");
    const sha = await commitAttempt(t.repo);
    expect(g(t.repo, "rev-parse", `${sha}^`)).toBe(before);
    expect(g(t.repo, "show", `${sha}:new.txt`)).toBe("untracked");
    expect(g(t.repo, "log", "-1", "--format=%an <%ae>", sha)).toBe("orca <orca@invalid>");
  });

  it("returns HEAD unchanged for a clean result repository", async () => {
    const t = await target();
    expect(await commitAttempt(t.repo)).toBe(t.head);
    expect(g(t.repo, "rev-parse", "HEAD")).toBe(t.head);
  });
});

describe("compare-and-swap and cleanup (execution driver §5.1, §3.5)", () => {
  it("moves the branch only from the tip it was read at", async () => {
    const t = await target();
    await ensureWorkBranch(t.repo, "g");
    await writeFile(join(t.repo, "shared.txt"), "next\n");
    g(t.repo, "commit", "-qam", "next");
    const next = g(t.repo, "rev-parse", "HEAD");
    expect(await compareAndSwap(t.repo, "refs/heads/orca/g", next, next)).toBe(false);
    expect(g(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(t.head);
    expect(await compareAndSwap(t.repo, "refs/heads/orca/g", next, t.head)).toBe(true);
    expect(g(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(next);
  });

  it("removes the run's worktree registration and its incoming ref, and nothing named orca/<group>", async () => {
    const t = await target();
    await ensureWorkBranch(t.repo, "g");
    const path = workspacePathOf(t.roots, "run-3");
    await ensureWorkspace(t.repo, "worktree", path, t.head, t.roots);
    g(t.repo, "update-ref", incomingRefOf("run-3"), t.head);
    await cleanupRunWorkspace(t.repo, t.roots, "run-3", path);
    expect(existsSync(path)).toBe(false);
    expect(g(t.repo, "worktree", "list", "--porcelain").split("\n")).not.toContain(`worktree ${path}`);
    expect(g(t.repo, "for-each-ref", "--format=%(refname)", "refs/orca/")).toBe("");
    expect(g(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(t.head);
  });
});
```

（计数：本文件 11 条。）

- [ ] **Step 2：跑，看见红** —— 预言：整文件红在 import（`workspace.js` 不存在），只证明接上。

```bash
cd /Users/biran/code/skills/loop/Orca
./node_modules/.bin/vitest run tests/control/workspace.test.ts > "${SCRATCH:?}/t3-red.log" 2>&1; echo "RC=$?" >> "${SCRATCH:?}/t3-red.log"; cat "${SCRATCH:?}/t3-red.log"
```

- [ ] **Step 3：实现 `src/control/workspace.ts`**

```ts
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { ORCA_IDENTITY, git } from "../scheduler/gitExec.js";
import { within } from "./archive.js";
import { privateDirectory } from "./paths.js";
import type { WorkspaceMode } from "./workspaceSettings.js";

/**
 * Execution driver spec §3 and §5. Every git command the driver runs in a repository a person owns,
 * or in a copy of one, carries these: a hook or an fsmonitor configured there must not run on the
 * driver's behalf (handoff §7.2).
 */
export const QUIET_GIT = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false"];

export interface WorkspaceRoots { runsRoot: string; workspacesRoot: string }

/**
 * spec §3.2, deviation D9. `archiveRun` requires a source directory outside the store directory, and
 * the store directory is `<control root>/<repoKey>` itself, so the roots are its siblings: they move
 * with ORCA_CONTROL_DIR and --control-state-dir, and they are created 0700 (an existing one keeps its mode).
 */
export function controlWorkspaceRoots(stateDir: string): WorkspaceRoots {
  return { runsRoot: privateDirectory(`${stateDir}.runs`), workspacesRoot: privateDirectory(`${stateDir}.workspaces`) };
}

export const sourceDirOf = (roots: WorkspaceRoots, runId: string): string => join(roots.runsRoot, runId);
export const workspacePathOf = (roots: WorkspaceRoots, runId: string): string => join(roots.workspacesRoot, runId);
export const landingPathOf = (roots: WorkspaceRoots, runId: string): string => join(roots.workspacesRoot, `landing-${runId}`);
export const conflictPathOf = (roots: WorkspaceRoots, runId: string): string => join(roots.workspacesRoot, `conflict-${runId}`);
export const reconcileRunsDirOf = (roots: WorkspaceRoots, runId: string): string => join(roots.workspacesRoot, `reconcile-${runId}`);
export const workBranchRef = (groupId: string): string => `refs/heads/orca/${groupId}`;
export const incomingRefOf = (runId: string): string => `refs/orca/incoming/${runId}`;

/** Only a direct child of `workspacesRoot` is the driver's to create or delete (spec §3.5). */
function assertOwnPath(roots: WorkspaceRoots, path: string): void {
  if (dirname(path) !== roots.workspacesRoot || !within(roots.workspacesRoot, path)) {
    throw new Error(`orca: refusing to touch ${path}, which is not a workspace this driver named`);
  }
}

export async function revParse(repo: string, rev: string): Promise<string> {
  return (await git(repo, [...QUIET_GIT, "rev-parse", "--verify", `${rev}^{commit}`])).trim();
}

/**
 * spec §5.1: `orca/<groupId>` is created from the target repository's current HEAD commit and is never
 * checked out. Create-only (`update-ref <ref> <new> ""`), so a concurrent creator wins and this reads
 * whatever it created. Never deleted.
 */
export async function ensureWorkBranch(targetRepo: string, groupId: string): Promise<string> {
  const ref = workBranchRef(groupId);
  try { return await revParse(targetRepo, ref); } catch { /* absent: create it below */ }
  const head = await revParse(targetRepo, "HEAD");
  try { await git(targetRepo, [...QUIET_GIT, "update-ref", ref, head, ""]); } catch { /* created concurrently */ }
  return revParse(targetRepo, ref);
}

async function registeredWorktree(targetRepo: string, path: string): Promise<boolean> {
  const list = await git(targetRepo, [...QUIET_GIT, "worktree", "list", "--porcelain"]);
  return list.split("\n").some((line) => line === `worktree ${path}`);
}

/** A path the driver named: a registered worktree goes through git, anything else is deleted from disk. */
export async function removeOwnPath(targetRepo: string, roots: WorkspaceRoots, path: string): Promise<void> {
  assertOwnPath(roots, path);
  if (await registeredWorktree(targetRepo, path)) await git(targetRepo, [...QUIET_GIT, "worktree", "remove", "--force", path]);
  await rm(path, { recursive: true, force: true });
}

/** A checkout rooted exactly at `path` whose HEAD is `base`; a parent repository answering for it does not count. */
async function checkedOutAt(path: string, base: string): Promise<boolean> {
  try {
    if ((await git(path, [...QUIET_GIT, "rev-parse", "--show-toplevel"])).trim() !== path) return false;
    return await revParse(path, "HEAD") === base;
  } catch { return false; }
}

/** spec §3.2 / step A2: reuse a workspace already at `base`, otherwise delete this driver's own path and rebuild it. */
export async function ensureWorkspace(targetRepo: string, mode: WorkspaceMode, path: string, base: string, roots: WorkspaceRoots): Promise<void> {
  assertOwnPath(roots, path);
  if (existsSync(path)) {
    if (await checkedOutAt(path, base)) return;
    await removeOwnPath(targetRepo, roots, path);
  }
  if (mode === "worktree") {
    await git(targetRepo, [...QUIET_GIT, "worktree", "add", "--detach", path, base]);
    return;
  }
  await git(roots.workspacesRoot, [...QUIET_GIT, "clone", "--local", "--no-checkout", targetRepo, path]);
  await git(path, [...QUIET_GIT, "checkout", "--detach", base]);
}

/**
 * spec §3.3: the attempt commit is made from the result repository ccloop materialised
 * (`<sourceDir>/repo`), never read from `refs/ccloop/run/attempts/<n>`. A dirty tree is committed on
 * top of its HEAD; a clean one is taken as it is.
 */
export async function commitAttempt(resultRepo: string): Promise<string> {
  const status = await git(resultRepo, [...QUIET_GIT, "status", "--porcelain", "--untracked-files=all"]);
  if (status.trim().length > 0) {
    await git(resultRepo, [...QUIET_GIT, "add", "-A"]);
    await git(resultRepo, [...QUIET_GIT, ...ORCA_IDENTITY, "commit", "--allow-empty", "-m", "orca: attempt result"]);
  }
  return revParse(resultRepo, "HEAD");
}

/** spec §5.1: move `ref` to `next` only if it is still at `old`. False means someone moved it. */
export async function compareAndSwap(repo: string, ref: string, next: string, old: string): Promise<boolean> {
  try {
    await git(repo, [...QUIET_GIT, "update-ref", ref, next, old]);
    return true;
  } catch { return false; }
}

/** spec §3.5: a settled run's own workspace and its incoming ref. `orca/<groupId>` is never touched. */
export async function cleanupRunWorkspace(targetRepo: string, roots: WorkspaceRoots, runId: string, workspacePath: string): Promise<void> {
  if (basename(workspacePath) !== runId) throw new Error(`orca: refusing to clean ${workspacePath}, which is not named after ${runId}`);
  await removeOwnPath(targetRepo, roots, workspacePath);
  await git(targetRepo, [...QUIET_GIT, "update-ref", "-d", incomingRefOf(runId)]).catch(() => undefined);
}
```

⚠️ `git()` 在 `execFile` 里跑，不经 shell，也不经 Bash 工具 ⇒ `worktree remove` 不被 Tier 0 闸门看见（§0 另量第三条）。**实施席自己的手工探针不许在 Bash 里写 `git worktree remove`。**

- [ ] **Step 4：看见绿**

```bash
cd /Users/biran/code/skills/loop/Orca
npm run typecheck > "${SCRATCH:?}/t3-tsc.log" 2>&1; echo "RC=$?" >> "${SCRATCH:?}/t3-tsc.log"
./node_modules/.bin/vitest run tests/control/workspace.test.ts > "${SCRATCH:?}/t3-green.log" 2>&1; echo "RC=$?" >> "${SCRATCH:?}/t3-green.log"
cat "${SCRATCH:?}/t3-tsc.log" "${SCRATCH:?}/t3-green.log"
```

Expected：RC 0；11/11。

- [ ] **Step 5：提交**

```bash
cd /Users/biran/code/skills/loop/Orca
/usr/bin/git add src/control/workspace.ts tests/control/workspace.test.ts
/usr/bin/git commit -F "${SCRATCH:?}/t3-msg.txt"
```

`t3-msg.txt`：

```
feat(control): give the execution driver its own workspaces

Runs and workspaces live beside the store directory, never inside it. The work
branch orca/<group> is created from the target's HEAD commit without a checkout;
a run's workspace is a detached worktree or a local clone at base, reused only
while it is still at base; only paths the driver named under its own root are
ever removed. The attempt commit is made from ccloop's result repository, and
the branch moves only by compare-and-swap.

Co-Authored-By: <implementer's own model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR
```

**变异**

| V | 变异 | 喂它的场景 | 期望红（且仅） |
|---|---|---|---|
| T3-M1 | `controlWorkspaceRoots` 改成 `join(stateDir, "runs")`／`join(stateDir, "workspaces")` | 取根 | `puts runs and workspaces beside the store directory …` |
| T3-M2 | `ensureWorkBranch` 里 `update-ref` 那一行的参数换成 `[...QUIET_GIT, "checkout", "-q", "-B", \`orca/${groupId}\`, head]`（会切走人的 HEAD） | 建分支 | `creates orca/<group> at the current HEAD commit without moving HEAD …`（symbolic-ref 变了） |
| T3-M3 | `ensureWorkspace` 删掉 `if (await checkedOutAt(path, base)) return;` | 同 base 再调一次 | `adds a detached worktree at base … and reuses it …`（marker 没了） |
| T3-M4 | `checkedOutAt` 恒 `return true` | base 变了 | `rebuilds a workspace whose HEAD is not base` |
| T3-M5 | `assertOwnPath` 函数体清空 | 外来路径 | `refuses to touch a path it did not name …` |
| T3-M6 | `commitAttempt` 删掉 `"--untracked-files=all"` 与 `add -A` 改成 `add -u` | 有未跟踪文件 | `commits a dirty result repository …`（`new.txt` 不在提交里） |
| T3-M7 | `compareAndSwap` 去掉 `old` 参数（`update-ref ref next`） | 旧尖端 | `moves the branch only from the tip it was read at` |
| T3-M8 | `cleanupRunWorkspace` 删掉 `update-ref -d` 那一行 | 清理 | `removes the run's worktree registration and its incoming ref …` |

---

## Task 4：驱动环核心 A1／A2／B／B'／C（合成 port；判据 R2、合成版 T1、D4、D5）

**Files:**
- Modify: `src/control/webDispatch.ts`（`:236` 导出 `nextClaimableTask`、`:342` 导出 `readWorkClaimEnvelope`、`:358-376` 抽出 `reserveProviderAttemptInTransaction`、文件末尾加 `isWebWorkRun`）
- Create: `src/control/executionDriver.ts`
- Modify（只加可选字段，默认行为不变）: `tests/control/fixtures/web.ts`（`WebFixtureTask.targetPaths?`）
- Create: `tests/control/fixtures/driverPort.ts`、`tests/control/fixtures/driverHarness.ts`、`tests/control/executionDriver.test.ts`

**Interfaces:**
- Consumes: T2 的 `DriveRecord`／`DriveStep`（`driveRecord.ts`）、`readWorkspaceSetting`、`applySetWorkspaceMode`；T3 的 `controlWorkspaceRoots`、`sourceDirOf`、`workspacePathOf`、`ensureWorkBranch`、`ensureWorkspace`、`commitAttempt`；既有：`toStartEnvelope(envelope, run, {sourceDir,targetRepo,base}, contract)`（`startEnvelope.ts:53`）、`readConfirmedTaskExecution(store, groupId, taskId)`（`executionSnapshot.ts:259`，返回 `{contract,…}`）、`writeCanonicalRecord`／`readCanonicalRecord`（`snapshot.ts:83,98`）、`writeArtifact(store,id,bytes,deps)`（`archive.ts:103`）、`recordUsage(store,event)`（`usage.ts:10`）、`saveRun`（`budget.ts:24`）、`readBudgetProposal`／`readGroup`（`queries.ts`）、`harvest(run: TaskRun, base, declared)`（`harvest.ts:124`）、`writeSetOf(contract)`（`writeSet.ts:63`）、`hashPayload`（`commands.ts:18`）、`privateDirectory`（`paths.ts:5`）。
- Produces（`src/control/webDispatch.ts`）：
  - `export function reserveProviderAttemptInTransaction(store: ControlStore, runId: string, phase: Phase): AttemptReservation`（`beginProviderAttempt` 的事务体；`beginProviderAttempt` 改为调它，行为不变）
  - `export function nextClaimableTask(store: ControlStore, groupId: string): ClaimableTask | null`、`export function readWorkClaimEnvelope(store, groupId, runId): DispatchEnvelopeV1`（只加 `export`）
  - `export function isWebWorkRun(store: ControlStore, runId: string): boolean`
- Produces（`src/control/executionDriver.ts`）：
  - `type CrashPoint = "A2-after-workspace" | "B-after-accept" | "C-after-terminal" | "D-after-cas" | "E-after-acceptance"`；`class DriverCrash extends Error { readonly point: CrashPoint }`；`INSPECT_UNKNOWN_LIMIT = 10`
  - `interface ExecutionDriverDeps { store; router; admissionGate?; roots: WorkspaceRoots; resolveRepository(repoId): string; ccloopBin: string; adapterConfigPath: string; kickPump?(): void; crash?(point: CrashPoint): void; beforeCas?(): Promise<void> }`
  - `interface DriverRun`（run body 的驱动视角）；`interface DriverContext { reconciling: Map<string, Promise<void>>; stopped: boolean }`
  - `interface ExecutionDriver { round(): Promise<boolean>; kick(): void; start(intervalMs: number): boolean; stop(): Promise<void>; readonly crashed: CrashPoint | null }`；`createExecutionDriver(deps): ExecutionDriver`
  - 步骤与工具（T5–T7 复用）：`readDriverRun`、`saveDriverRun`、`admitted`、`admittedAsync`、`archiveAdmission`、`write`、`blockRun(deps, runId, step, reason, patch?)`、`groupRepoId`、`groupStopped`、`portFor`、`readStartEnvelope`、`stepA1`、`stepA2`、`stepB`、`stepBPrime`、`stepC`、`advance(deps, runId, context)`、`stepOf(run)`、`driverRunIds(store)`、`describeError(error)`
- Produces（夹具）：`fakeCcloopPort({capabilities, behaviour, files, delayAccept?})` ⇒ `{ port, calls: { accept: StartEnvelope[]; inspect: number; collect: number } }`，`FakeBehaviour = "succeed" | "unknown" | "forget-first-accept" | "lost-accept" | "refuse" | "wrong-config" | "exhausted"`；`driverHarness(tasks, options)`、`FAKE_CCLOOP_RUN`（T6 才创建该文件）。

- [ ] **Step 1：夹具**

`tests/control/fixtures/web.ts`（只加，不改默认）：`WebFixtureTask` 加 `targetPaths?: string[]`（在 `configHash?: string` 之后），contract 里 `targetPaths: [task.taskId]` → `targetPaths: task.targetPaths ?? [task.taskId]`。**两处都按整行锚点改、断言命中 == 1**；改完 `git diff tests/control/fixtures/web.ts` 只应有这两行。

`tests/control/fixtures/driverPort.ts`：

```ts
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ControlError } from "../../../src/control/errors.js";
import type { ExecutionPort, ExecutionReport, StartEnvelope } from "../../../src/control/executionPort.js";
import type { ArtifactRef, Candidate, UsageEvent } from "../../../src/control/types.js";
import type { CapabilityViewV1 } from "../../../src/control/webProtocol.js";

/**
 * A synthetic ccloop for the execution driver's unit criteria. It does what the real control protocol
 * does at the level the driver can observe: `accept` is idempotent per run, `collect` materialises
 * `<sourceDir>/repo` from the rewritten contract's repoPath at its HEAD, writes the task's files there
 * uncommitted, and reports two usage events (work, handoff), a candidate with a stop proof and a
 * terminal. Evidence bytes are served back by reference.
 */
export type FakeBehaviour = "succeed" | "unknown" | "forget-first-accept" | "lost-accept" | "refuse" | "wrong-config" | "exhausted";

export interface FakeCcloop {
  port: ExecutionPort;
  calls: { accept: StartEnvelope[]; inspect: number; collect: number };
}

const sha = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

export function fakeCcloopPort(input: {
  capabilities: CapabilityViewV1;
  behaviour(workItemId: string): FakeBehaviour;
  files(workItemId: string): Record<string, string>;
  delayAccept?: () => Promise<void>;
}): FakeCcloop {
  const calls = { accept: [] as StartEnvelope[], inspect: 0, collect: 0 };
  const executions = new Map<string, string>();
  const forgotten = new Set<string>();
  const evidence = new Map<string, Buffer>();
  const reports = new Map<string, ExecutionReport>();
  const put = (artifactId: string, bytes: Buffer): ArtifactRef => {
    const ref = { artifactId, hash: sha(bytes) };
    evidence.set(`${ref.artifactId}:${ref.hash}`, bytes);
    return ref;
  };
  const stopSource = (runId: string, executionId: string, generation: number) =>
    put(`stop-${runId}`, Buffer.from(JSON.stringify({ isolated: true, executionId, generation })));

  const execute = (envelope: StartEnvelope, executionId: string): ExecutionReport => {
    const { claim, work } = envelope;
    const workspace = (work.contract as { context: { repoPath: string } }).context.repoPath;
    const repo = join(work.sourceDir, "repo");
    const head = execFileSync("git", ["-C", workspace, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    execFileSync("git", ["clone", "-q", "--no-checkout", workspace, repo]);
    execFileSync("git", ["-C", repo, "checkout", "-q", "--detach", head]);
    for (const [path, content] of Object.entries(input.files(claim.workItemId))) {
      mkdirSync(dirname(join(repo, path)), { recursive: true });
      writeFileSync(join(repo, path), content);
    }
    const events: UsageEvent[] = [
      { runId: claim.runId, generation: claim.generation, eventSeq: 1, bucket: "work", cumulative: { tokens: 10, activeMs: 5, attempts: 1, sessions: 1 }, source: put(`usage-${claim.runId}-1`, Buffer.from(`work usage ${claim.runId}`)) },
      { runId: claim.runId, generation: claim.generation, eventSeq: 2, bucket: "handoff", cumulative: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 }, source: put(`usage-${claim.runId}-2`, Buffer.from(`handoff usage ${claim.runId}`)) },
    ];
    const outcome = input.behaviour(claim.workItemId) === "exhausted" ? "exhausted" : "succeeded";
    const candidate: Candidate = {
      groupId: claim.groupId, workItemId: claim.workItemId, taskId: claim.taskId, runId: claim.runId, generation: claim.generation,
      graphVersion: claim.graphVersion, targetVersion: claim.targetVersion, checkpointId: `candidate-${claim.runId}`, usageHighWater: 2,
      result: outcome === "succeeded" ? "complete" : "partial", artifacts: [], snapshot: null, missing: [], unresolvedRequestIds: [],
      stopProof: { executionId, generation: claim.generation, isolated: true, source: stopSource(claim.runId, executionId, claim.generation) },
      terminalOutcome: outcome, handoff: put(`handoff-${claim.runId}`, Buffer.from(JSON.stringify({ runId: claim.runId }))),
    };
    return { events, candidate, terminal: { outcome, attemptSha: null, sourceDir: work.sourceDir, repoDir: repo } };
  };

  const port: ExecutionPort = {
    probeProfileCapabilities: async () => input.capabilities,
    capabilities: async () => ({ protocol: 2 as const, ...input.capabilities }),
    async accept(envelope) {
      calls.accept.push(structuredClone(envelope));
      await input.delayAccept?.();
      const { runId, workItemId, configHash } = envelope.claim;
      const behaviour = input.behaviour(workItemId);
      if (behaviour === "refuse") throw new ControlError("control-peer-exit", "2:control-config-hash-mismatch");
      if (behaviour === "unknown") return { kind: "unknown" };
      if (behaviour === "forget-first-accept" && !forgotten.has(runId)) { forgotten.add(runId); return { kind: "unknown" }; }
      const executionId = executions.get(runId) ?? `execution-${runId}`;
      executions.set(runId, executionId);
      if (behaviour === "lost-accept") return { kind: "unknown" };
      return { kind: "accepted", executionId, configHash: behaviour === "wrong-config" ? "f".repeat(64) : configHash };
    },
    async inspect(envelope) {
      calls.inspect += 1;
      const { runId, workItemId, configHash, generation } = envelope.claim;
      const behaviour = input.behaviour(workItemId);
      if (behaviour === "unknown") return { kind: "unknown" };
      const executionId = executions.get(runId);
      if (executionId === undefined) return { kind: "absent" };
      if (behaviour === "lost-accept") return { kind: "stopped", proof: { executionId, generation, isolated: true, source: stopSource(runId, executionId, generation) } };
      return { kind: "accepted", executionId, configHash };
    },
    async collect(envelope, afterSeq) {
      calls.collect += 1;
      const executionId = executions.get(envelope.claim.runId);
      if (executionId === undefined) return { events: [], candidate: null, terminal: null };
      let report = reports.get(envelope.claim.runId);
      if (report === undefined) { report = execute(envelope, executionId); reports.set(envelope.claim.runId, report); }
      return { ...report, events: report.events.filter((event) => event.eventSeq > afterSeq) };
    },
    async readEvidence(ref) {
      const bytes = evidence.get(`${ref.artifactId}:${ref.hash}`);
      if (bytes === undefined) throw new ControlError("control-evidence-context-missing");
      return bytes;
    },
    requestHandoff: async (_input, request) => ({ kind: "unknown", requestId: request.requestId }),
  };
  return { port, calls };
}
```

`tests/control/fixtures/driverHarness.ts`：

```ts
import { execFileSync } from "node:child_process";
import { writeFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createExecutionProfileRouter, resolveProfile } from "../../../src/control/profiles.js";
import { WebControlService } from "../../../src/control/webService.js";
import { deliverScheduledStart } from "../../../src/control/webDispatch.js";
import { controlWorkspaceRoots } from "../../../src/control/workspace.js";
import { createExecutionDriver, type ExecutionDriver, type ExecutionDriverDeps } from "../../../src/control/executionDriver.js";
import { fakeCcloopPort, type FakeBehaviour } from "./driverPort.js";
import { profileSnapshot, webFixture, type WebFixtureTask } from "./web.js";

/** A `ccloop run` stand-in for reconciliation criteria (created in Task 6). */
export const FAKE_CCLOOP_RUN = resolve("tests/control/fixtures/fake-ccloop-run.mjs");

export const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args], { cwd, encoding: "utf8" }).trim();

export interface HarnessOptions {
  budgetMode?: "soft" | "strict";
  behaviour?: (workItemId: string) => FakeBehaviour;
  files?: (workItemId: string) => Record<string, string>;
  delayAccept?: () => Promise<void>;
}

/**
 * A confirmed Web group whose repository is a real git repository on `main`, driven through a
 * synthetic ccloop. Task `x` writes `x` = "x\n" unless `files` says otherwise.
 */
export async function driverHarness(tasks: readonly WebFixtureTask[], options: HarnessOptions = {}) {
  const snapshot = profileSnapshot();
  const h = await webFixture(snapshot, tasks);
  const repo = await realpath(join(h.root, "repo"));
  git(repo, "init", "-q", "-b", "main");
  await writeFile(join(repo, "base.txt"), "base\n");
  git(repo, "add", "base.txt");
  git(repo, "commit", "-qm", "base");
  const service = new WebControlService({ ...h.deps, knownRepository: (repoId: string) => repoId === "repo" });
  const confirmed = service.confirm(h.command("confirm", { ...h.confirmPayload(), budgetMode: options.budgetMode ?? "soft" }));
  if ("error" in confirmed) throw new Error(`confirm refused: ${JSON.stringify(confirmed.error)}`);
  const fake = fakeCcloopPort({
    capabilities: snapshot.profile.capabilities, behaviour: options.behaviour ?? (() => "succeed"),
    files: options.files ?? ((id) => ({ [id]: `${id}\n` })), delayAccept: options.delayAccept,
  });
  const deps: ExecutionDriverDeps = {
    store: h.store, router: createExecutionProfileRouter([resolveProfile(snapshot, fake.port)]), admissionGate: h.deps.admissionGate,
    roots: controlWorkspaceRoots(h.store.stateDir), resolveRepository: () => repo,
    ccloopBin: FAKE_CCLOOP_RUN, adapterConfigPath: join(h.root, "reconcile-adapter.json"),
  };
  const dispatch = { store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate };
  /** A fresh start command and its delivery: one more claimed run. */
  const claim = async (): Promise<string> => {
    const started = await service.start(h.command("start", {}));
    if ("error" in started) throw new Error(`start refused: ${JSON.stringify(started.error)}`);
    const delivered = await deliverScheduledStart(dispatch, "g");
    if (delivered.kind !== "claimed") throw new Error(`claim refused: ${JSON.stringify(delivered)}`);
    return delivered.runId;
  };
  const body = (runId: string) => JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body));
  const until = async (driver: ExecutionDriver, predicate: () => boolean, rounds = 60): Promise<void> => {
    for (let i = 0; i < rounds && !predicate(); i += 1) await driver.round();
    if (!predicate()) throw new Error("the driver did not reach the expected state");
  };
  return { h, repo, service, fake, deps, dispatch, claim, body, until, driver: () => createExecutionDriver(deps) };
}
```

- [ ] **Step 2：判据 `tests/control/executionDriver.test.ts`**

```ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCanonicalRecord } from "../../src/control/snapshot.js";
import { stepA1, type CrashPoint, DriverCrash, createExecutionDriver } from "../../src/control/executionDriver.js";
import { applySetWorkspaceMode } from "../../src/control/workspaceSettings.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";

// Execution driver spec §2.2, steps A1 to C, against a synthetic ccloop. Criteria R2 and a synthetic T1
// live here; the real-ccloop T1 is in executionDriverE2E.test.ts.
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

describe("A1: one provider attempt, reserved once (spec §2.2)", () => {
  it("reserves exactly one attempt and records where the run will live, even when asked twice", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      expect(stepA1(t.deps, runId)).toBe(true);
      expect(stepA1(t.deps, runId)).toBe(false);
      const run = t.body(runId);
      expect(run.providerAttemptOrdinal).toBe(1);
      expect(run.state).toBe("start-pending");
      expect(run.drive).toMatchObject({ workspaceMode: "worktree", sourceDir: `${t.h.store.stateDir}.runs/${runId}`, workspacePath: `${t.h.store.stateDir}.workspaces/${runId}`, prepared: false });
    } finally { await t.h.dispose(); }
  });

  it("blocks a strict group's run before any provider attempt", async () => {
    const t = await driverHarness([{ taskId: "a" }], { budgetMode: "strict" }); try {
      const runId = await t.claim();
      const driver = t.driver();
      await driver.round(); await driver.round();
      expect(t.body(runId)).toMatchObject({ state: "blocked", providerAttemptOrdinal: 0, drive: { blockedAt: "A1", blockedReason: "strict-proof-unimplemented" } });
      expect(t.fake.calls.accept).toHaveLength(0);
    } finally { await t.h.dispose(); }
  });

  it("takes the repository's workspace mode as it is when A1 runs (W1)", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      applySetWorkspaceMode({ store: t.h.store, knownRepository: () => true }, { schema: "orca-raw-command-v1", commandId: "mode", expectedRevision: 0, actorId: "human", verb: "set-workspace-mode", target: { kind: "repository", repoId: "repo" }, payload: { workspaceMode: "clone" } });
      stepA1(t.deps, runId);
      expect(t.body(runId).drive.workspaceMode).toBe("clone");
    } finally { await t.h.dispose(); }
  });
});

describe("A2: the workspace and the whole start envelope (spec §2.2, §3)", () => {
  it("builds the workspace at orca/<group>'s tip and stores the rewritten envelope, leaving the person's checkout alone", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const head = git(t.repo, "rev-parse", "HEAD");
      const index = sha256(join(t.repo, ".git", "index"));
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).drive?.prepared === true);
      const drive = t.body(runId).drive;
      expect(drive.base).toBe(head);
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(head);
      expect(git(t.repo, "worktree", "list", "--porcelain").split("\n")).toContain(`worktree ${drive.workspacePath}`);
      const envelope = JSON.parse(readCanonicalRecord(t.h.store, drive.envelopeHash));
      expect(envelope.work).toMatchObject({ targetRepo: t.repo, base: head, sourceDir: drive.sourceDir });
      expect(envelope.work.contract.context.repoPath).toBe(drive.workspacePath);
      expect(git(t.repo, "symbolic-ref", "HEAD")).toBe("refs/heads/main");
      expect(git(t.repo, "rev-parse", "HEAD")).toBe(head);
      expect(sha256(join(t.repo, ".git", "index"))).toBe(index);
    } finally { await t.h.dispose(); }
  });

  it("ends the driver like a death when a crash hook fires, and a new driver finishes A2 on the same workspace", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      const point: CrashPoint = "A2-after-workspace";
      const crashing = createExecutionDriver({ ...t.deps, crash: (at) => { if (at === point) throw new DriverCrash(at); } });
      await crashing.round(); await crashing.round();
      expect(crashing.crashed).toBe(point);
      expect(await crashing.round()).toBe(false);
      expect(t.body(runId)).toMatchObject({ state: "start-pending", drive: { prepared: false } });
      await t.until(t.driver(), () => t.body(runId).drive?.prepared === true);
      expect(t.body(runId).state).toBe("start-pending");
    } finally { await t.h.dispose(); }
  });
});

describe("B and B': the frozen bytes, and every answer the port can give (spec §2.2)", () => {
  it("sends the stored envelope and records the execution", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "accepted");
      const drive = t.body(runId).drive;
      expect(t.fake.calls.accept).toHaveLength(1);
      expect(t.fake.calls.accept[0]).toEqual(JSON.parse(readCanonicalRecord(t.h.store, drive.envelopeHash)));
      expect(t.body(runId).executionId).toBe(`execution-${runId}`);
    } finally { await t.h.dispose(); }
  });

  it("R2: blocks the run after ten unknown inspections, spending one accept and leaving dispatch open", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "unknown" }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      expect(t.body(runId).drive).toMatchObject({ blockedAt: "B'", blockedReason: "inspect-unknown", inspectUnknown: 10 });
      expect(t.fake.calls.inspect).toBe(10);
      expect(t.fake.calls.accept).toHaveLength(1);
      expect(t.h.store.dispatchBlocked).toBe(false);
    } finally { await t.h.dispose(); }
  });

  it("re-sends the same bytes when an inspection finds nothing was accepted", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "forget-first-accept" }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "accepted");
      expect(t.fake.calls.accept).toHaveLength(2);
      expect(JSON.stringify(t.fake.calls.accept[1])).toBe(JSON.stringify(t.fake.calls.accept[0]));
      expect(t.fake.calls.inspect).toBe(1);
    } finally { await t.h.dispose(); }
  });

  it("D4: moves on to collection when an inspection proves the execution stopped", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "lost-accept" }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => ["collected", "blocked"].includes(t.body(runId).state));
      expect(t.body(runId)).toMatchObject({ state: "collected", executionId: `execution-${runId}` });
      expect(t.fake.calls.accept).toHaveLength(1);
    } finally { await t.h.dispose(); }
  });

  it("D5: blocks a deterministic refusal by name instead of re-sending it", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "refuse" }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      expect(t.body(runId).drive).toMatchObject({ blockedAt: "B", blockedReason: "accept-refused:2:control-config-hash-mismatch" });
      expect(t.fake.calls.accept).toHaveLength(1);
      expect(t.fake.calls.inspect).toBe(0);
    } finally { await t.h.dispose(); }
  });

  it("blocks an execution whose config hash is not the claim's", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "wrong-config" }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      expect(t.body(runId)).toMatchObject({ executionId: null, drive: { blockedAt: "B", blockedReason: "config-hash-mismatch" } });
    } finally { await t.h.dispose(); }
  });

  it("stops the round without blocking anyone while the admission gate drains", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      t.h.deps.admissionGate.beginDrain();
      expect(await t.driver().round()).toBe(false);
      expect(t.body(runId)).toMatchObject({ state: "starting", providerAttemptOrdinal: 0 });
    } finally { await t.h.dispose(); }
  });

  it("stop() waits for a provider call in flight before it resolves", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const t = await driverHarness([{ taskId: "a" }], { delayAccept: () => held }); try {
      const runId = await t.claim();
      const driver = t.driver();
      await driver.round(); await driver.round();
      const inFlight = driver.round();
      let stopped = false;
      const stopping = driver.stop().then(() => { stopped = true; });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(stopped).toBe(false);
      release();
      await Promise.all([inFlight, stopping]);
      expect(stopped).toBe(true);
      expect(t.body(runId).state).toBe("accepted");
    } finally { await t.h.dispose(); }
  });
});

describe("C: collect, then decide from the terminal (spec §2.2, §3.3, §5.2)", () => {
  it("T1 (synthetic): blocks a terminal other than succeeded and leaves orca/<group> where it was", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "exhausted" }); try {
      const head = git(t.repo, "rev-parse", "HEAD");
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      expect(t.body(runId).drive).toMatchObject({ blockedAt: "C", blockedReason: "terminal:exhausted", outcome: "exhausted" });
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(head);
      expect(git(t.repo, "for-each-ref", "--format=%(refname)", "refs/orca/")).toBe("");
    } finally { await t.h.dispose(); }
  });

  it("turns a succeeded result into an attempt commit on top of base and holds it as collected", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "collected");
      const drive = t.body(runId).drive;
      const result = join(drive.sourceDir, "repo");
      expect(git(result, "rev-parse", `${drive.attemptSha}^`)).toBe(drive.base);
      expect(git(result, "show", `${drive.attemptSha}:a`)).toBe("a");
      expect(drive.outcome).toBe("succeeded");
      expect(t.body(runId)).toMatchObject({ highWater: 2, cumulative: { work: { tokens: 10 } } });
    } finally { await t.h.dispose(); }
  });

  it("skips landing for a result that changed nothing", async () => {
    const t = await driverHarness([{ taskId: "a" }], { files: () => ({}) }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => ["landed", "blocked"].includes(t.body(runId).state));
      const drive = t.body(runId).drive;
      expect(t.body(runId).state).toBe("landed");
      expect(drive.landedCommit).toBe(null);
      expect(drive.attemptSha).toBe(drive.base);
    } finally { await t.h.dispose(); }
  });

  it("blocks a result that wrote outside the task's paths, by the path", async () => {
    const t = await driverHarness([{ taskId: "a" }], { files: () => ({ "elsewhere.txt": "x\n" }) }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      expect(t.body(runId).drive).toMatchObject({ blockedAt: "C", blockedReason: "out-of-bounds:elsewhere.txt" });
    } finally { await t.h.dispose(); }
  });
});
```

（计数：本文件 17 条。）

- [ ] **Step 3：跑，看见红** —— 预言：整文件红在 import（`executionDriver.js` 不存在）。

```bash
cd /Users/biran/code/skills/loop/Orca
./node_modules/.bin/vitest run tests/control/executionDriver.test.ts > "${SCRATCH:?}/t4-red.log" 2>&1; echo "RC=$?" >> "${SCRATCH:?}/t4-red.log"; cat "${SCRATCH:?}/t4-red.log"
```

- [ ] **Step 4：`src/control/webDispatch.ts`**

`:236` `function nextClaimableTask` → `export function nextClaimableTask`；`:342` `function readWorkClaimEnvelope` → `export function readWorkClaimEnvelope`。`beginProviderAttempt`（`:358-376`）整段换成：

```ts
/**
 * The transaction body of `beginProviderAttempt`, for a caller that must reserve the attempt in the
 * same transaction as its own writes (execution driver step A1). It moves no amount: the read model
 * requires `remaining == max(grant - cumulative, 0)` on every run.
 */
export function reserveProviderAttemptInTransaction(store: ControlStore, runId: string, phase: Phase): AttemptReservation {
  const run = readDispatchRun(store, runId);
  if (phase === "work") {
    const latch = store.db.prepare("SELECT request_id FROM context_latches WHERE run_id=? AND generation=?").get(runId, run.generation);
    if (latch) return { kind: "suppressed", requestId: latch.request_id == null ? null : String(latch.request_id) };
    const held = store.db.prepare("SELECT id FROM handoff_requests WHERE run_id=? AND state IN ('latched','collecting') ORDER BY rowid")
      .get(runId);
    if (held) return { kind: "suppressed", requestId: String(held.id) };
  }
  run.providerAttemptOrdinal += 1;
  saveDispatchRun(store, run);
  return { kind: "reserved", providerAttemptOrdinal: run.providerAttemptOrdinal, envelope: readWorkClaimEnvelope(store, run.groupId, runId) };
}

/**
 * Reserve exactly one provider attempt for one invocation. A run whose context
 * watermark is latched, or whose handoff stop is being collected, can no longer
 * reserve a work-phase attempt at all.
 */
export function beginProviderAttempt(deps: WebDispatchDeps, runId: string, phase: Phase): AttemptReservation {
  const { store, admissionGate } = deps;
  const release = admissionGate?.enter();
  try {
    return store.transaction(() => reserveProviderAttemptInTransaction(store, runId, phase));
  } finally { release?.(); }
}
```

文件末尾加：

```ts
/**
 * Execution driver spec §4: a run the Web ledger claimed for work carries the `work:<group>:<run>`
 * claim row. Legacy runs carry a `start:<run>` row instead and are never this.
 */
export function isWebWorkRun(store: ControlStore, runId: string): boolean {
  const row = store.db.prepare("SELECT group_id FROM runs WHERE id=?").get(runId);
  if (!row) return false;
  return store.db.prepare("SELECT id FROM outbox WHERE id=? AND kind='work-claim'").get(`work:${String(row.group_id)}:${runId}`) !== undefined;
}
```

- [ ] **Step 5：`src/control/executionDriver.ts`（新）**

```ts
import { createHash } from "node:crypto";
import { join } from "node:path";
import { writeArtifact } from "./archive.js";
import { saveRun } from "./budget.js";
import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { hashPayload } from "./commands.js";
import { ControlError } from "./errors.js";
import { readConfirmedTaskExecution } from "./executionSnapshot.js";
import { privateDirectory } from "./paths.js";
import { readBudgetProposal, readGroup } from "./queries.js";
import { readCanonicalRecord, writeCanonicalRecord } from "./snapshot.js";
import { toStartEnvelope } from "./startEnvelope.js";
import { recordUsage } from "./usage.js";
import { isWebWorkRun, readWorkClaimEnvelope, reserveProviderAttemptInTransaction } from "./webDispatch.js";
import { readWorkspaceSetting, type WorkspaceMode } from "./workspaceSettings.js";
import { commitAttempt, ensureWorkBranch, ensureWorkspace, sourceDirOf, workspacePathOf, type WorkspaceRoots } from "./workspace.js";
import { harvest } from "../scheduler/harvest.js";
import { writeSetOf } from "../scheduler/writeSet.js";
import type { AdmissionGate } from "./admissionGate.js";
import type { DriveRecord, DriveStep } from "./driveRecord.js";
import type { ExecutionPort, ExecutionStatus, StartEnvelope } from "./executionPort.js";
import type { ExecutionProfileRouter } from "./profiles.js";
import type { ControlStore } from "./store.js";

/**
 * Execution driver spec §2. Owned by the panel's control assembly next to the wake pump, and only
 * when an execution port is configured. It is the only place a provider is invoked for a Web run:
 * recovery and the pump never do (spec §2.1).
 */

export type CrashPoint = "A2-after-workspace" | "B-after-accept" | "C-after-terminal" | "D-after-cas" | "E-after-acceptance";

/** Test-only fault injection (spec §7.2 R1): thrown from `crash`, it ends the driver as a process death would. */
export class DriverCrash extends Error {
  constructor(readonly point: CrashPoint) { super(`driver-crash:${point}`); this.name = "DriverCrash"; }
}

/** spec §2.2 B': consecutive unknown inspections before the run is blocked. A controller choice (spec §9). */
export const INSPECT_UNKNOWN_LIMIT = 10;

export interface ExecutionDriverDeps {
  store: ControlStore;
  router: ExecutionProfileRouter;
  admissionGate?: AdmissionGate;
  roots: WorkspaceRoots;
  /** spec §3.1: the trusted path for a repoId, its witness re-validated on every call. */
  resolveRepository(repoId: string): string;
  /** spec §5.3(6): the binary and codex adapter config a reconciliation `ccloop run` is spawned with. */
  ccloopBin: string;
  adapterConfigPath: string;
  kickPump?: () => void;
  crash?: (point: CrashPoint) => void;
  /** Test seam (spec §5.1): runs between a landing's merge and its compare-and-swap. */
  beforeCas?: () => Promise<void>;
}

export interface DriverRun {
  runId: string; groupId: string; workItemId: string; taskId: string | null;
  generation: number; graphVersion: number; targetVersion: number;
  state: string; phase: string; configHash: string; executionId: string | null;
  highWater: number; providerAttemptOrdinal: number; continuationIntentId?: string | null;
  executionProfile: { profileId: string; profileHash: string };
  drive?: DriveRecord;
  [key: string]: unknown;
}

/** Per-driver process state: reconciliation runs in flight (spec §5.3(6)), and whether the driver was stopped. */
export interface DriverContext { reconciling: Map<string, Promise<void>>; stopped: boolean }

export interface ExecutionDriver {
  /** One pass over every run the driver owns; a re-entrant call joins the pass in flight. Answers whether any run moved. */
  round(): Promise<boolean>;
  /** A round now, and another straight after for as long as runs keep moving. */
  kick(): void;
  start(intervalMs: number): boolean;
  /** Stops the timer and waits for the round in flight (spec §2.1 shutdown order). */
  stop(): Promise<void>;
  readonly crashed: CrashPoint | null;
}

export function describeError(error: unknown): string {
  if (error instanceof ControlError) return error.detail ? `${error.code}:${error.detail}` : error.code;
  return error instanceof Error && error.message.length > 0 ? error.message : String(error);
}

export function readDriverRun(store: ControlStore, runId: string): DriverRun {
  const row = store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId);
  if (!row) throw new ControlError("run-not-found");
  return JSON.parse(String(row.body)) as DriverRun;
}

export function saveDriverRun(store: ControlStore, run: DriverRun): void {
  saveRun(store, run as never);
}

export function admitted<T>(deps: Pick<ExecutionDriverDeps, "admissionGate">, action: () => T): T {
  const release = deps.admissionGate?.enter();
  try { return action(); } finally { release?.(); }
}

export async function admittedAsync<T>(deps: Pick<ExecutionDriverDeps, "admissionGate">, action: () => Promise<T>): Promise<T> {
  const release = deps.admissionGate?.enter();
  try { return await action(); } finally { release?.(); }
}

export const archiveAdmission = (deps: Pick<ExecutionDriverDeps, "admissionGate">) =>
  ({ admit: <T>(operation: () => Promise<T>): Promise<T> => admittedAsync(deps, operation) });

/** Every synchronous write the driver makes: admitted, then one transaction (spec §2.1). */
export function write<T>(deps: Pick<ExecutionDriverDeps, "store" | "admissionGate">, action: () => T): T {
  return admitted(deps, () => deps.store.transaction(action));
}

/** spec §2.2: a run that cannot move on its own is blocked alone, with the step and the reason. */
export function blockRun(deps: Pick<ExecutionDriverDeps, "store" | "admissionGate">, runId: string, step: DriveStep, reason: string, patch: Partial<DriveRecord> = {}): void {
  write(deps, () => {
    const run = readDriverRun(deps.store, runId);
    if (run.drive === undefined) throw new ControlError("recovery-blocked", `drive-missing:${runId}`);
    run.state = "blocked";
    run.drive = { ...run.drive, ...patch, blockedAt: step, blockedReason: reason };
    saveDriverRun(deps.store, run);
  });
}

export function groupRepoId(store: ControlStore, groupId: string): string {
  return (readGroup(store, groupId) as unknown as { plan: { repoId: string } }).plan.repoId;
}

export function groupStopped(store: ControlStore, groupId: string): boolean {
  return readGroup(store, groupId).stopped || store.db.prepare("SELECT group_id FROM stop_intents WHERE group_id=?").get(groupId) !== undefined;
}

/** The frozen worker profile's port: the one the run was claimed against. */
export function portFor(deps: Pick<ExecutionDriverDeps, "router">, run: DriverRun): ExecutionPort {
  return deps.router.resolve("task", run.executionProfile.profileId, run.executionProfile.profileHash).port;
}

export function readStartEnvelope(store: ControlStore, run: DriverRun): StartEnvelope {
  if (run.drive?.envelopeHash == null) throw new ControlError("recovery-blocked", `envelope-missing:${run.runId}`);
  return JSON.parse(readCanonicalRecord(store, run.drive.envelopeHash)) as StartEnvelope;
}

function newDrive(roots: WorkspaceRoots, runId: string, workspaceMode: WorkspaceMode): DriveRecord {
  return {
    workspaceMode, sourceDir: sourceDirOf(roots, runId), workspacePath: workspacePathOf(roots, runId), targetRepo: null,
    prepared: false, base: null, envelopeHash: null, inspectUnknown: 0, outcome: null, attemptSha: null, landedCommit: null,
    reconcile: null, blockedAt: null, blockedReason: null, cleanedUp: false,
  };
}

/**
 * A1 (spec §2.2): one transaction reserves the provider attempt and records where the run will live.
 * Only a `starting` run enters, so a restart that finds `start-pending` never reserves a second one.
 * A strict group is refused before any attempt (spec §1, §8); so is a continuation (deviation D21).
 */
export function stepA1(deps: ExecutionDriverDeps, runId: string): boolean {
  const { store } = deps;
  return write(deps, () => {
    const run = readDriverRun(store, runId);
    if (run.state !== "starting") return false;
    const drive = newDrive(deps.roots, runId, readWorkspaceSetting(store, groupRepoId(store, run.groupId)).workspaceMode);
    const refuse = (reason: string): boolean => {
      const current = readDriverRun(store, runId);
      current.state = "blocked";
      current.drive = { ...drive, blockedAt: "A1", blockedReason: reason };
      saveDriverRun(store, current);
      return true;
    };
    if (readBudgetProposal(store, run.groupId).budgetMode === "strict") return refuse("strict-proof-unimplemented");
    if (run.continuationIntentId) return refuse("continuation-unsupported");
    if (store.dispatchBlocked || groupStopped(store, run.groupId)) return false;
    const reservation = reserveProviderAttemptInTransaction(store, runId, "work");
    if (reservation.kind === "suppressed") return refuse(`attempt-suppressed:${reservation.requestId ?? "unknown"}`);
    const reserved = readDriverRun(store, runId);
    reserved.state = "start-pending";
    reserved.drive = drive;
    saveDriverRun(store, reserved);
    return true;
  });
}

/**
 * A2 (spec §2.2, §3): the external half. Everything here is redone whole while `prepared` is false;
 * the workspace is reused only if it is already at `base`.
 */
export async function stepA2(deps: ExecutionDriverDeps, runId: string): Promise<boolean> {
  const { store } = deps;
  const run = readDriverRun(store, runId);
  if (run.state !== "start-pending" || run.drive === undefined || run.drive.prepared || run.taskId === null) return false;
  const drive = run.drive;
  let targetRepo: string;
  try { targetRepo = deps.resolveRepository(groupRepoId(store, run.groupId)); }
  catch { blockRun(deps, runId, "A2", "repository-path"); return true; }
  const base = await ensureWorkBranch(targetRepo, run.groupId);
  privateDirectory(drive.sourceDir);
  await ensureWorkspace(targetRepo, drive.workspaceMode, drive.workspacePath, base, deps.roots);
  deps.crash?.("A2-after-workspace");
  const confirmed = readConfirmedTaskExecution(store, run.groupId, run.taskId);
  // ccloop opens its attempt worktrees from repoPath's HEAD, not from `base` (spec §3.2), so the
  // contract points at this run's own workspace. The frozen derivedContractHash is unchanged.
  const contract = { ...confirmed.contract, context: { ...confirmed.contract.context, repoPath: drive.workspacePath } };
  const envelope = toStartEnvelope(readWorkClaimEnvelope(store, run.groupId, runId), run, { sourceDir: drive.sourceDir, targetRepo, base }, contract);
  const envelopeHash = sha256Canonical(envelope);
  return write(deps, () => {
    writeCanonicalRecord(store, run.groupId, envelopeHash, canonicalBytes(envelope).toString("utf8"));
    const current = readDriverRun(store, runId);
    if (current.state !== "start-pending" || current.drive === undefined || current.drive.prepared) return false;
    current.drive = { ...current.drive, targetRepo, base, envelopeHash, prepared: true };
    saveDriverRun(store, current);
    return true;
  });
}

/** spec §2.2 B and B': one place turns a port answer into a run state. Answers whether the state changed. */
function persistStatus(deps: ExecutionDriverDeps, runId: string, status: ExecutionStatus, step: "B" | "B'"): boolean {
  const { store } = deps;
  return write(deps, () => {
    const run = readDriverRun(store, runId);
    const drive = run.drive!;
    const block = (reason: string, patch: Partial<DriveRecord> = {}): boolean => {
      run.state = "blocked";
      run.drive = { ...drive, ...patch, blockedAt: step, blockedReason: reason };
      saveDriverRun(store, run);
      return true;
    };
    if (status.kind === "accepted") {
      if (status.configHash !== run.configHash) return block("config-hash-mismatch");
      run.executionId = status.executionId;
      run.state = "accepted";
      run.drive = { ...drive, inspectUnknown: 0 };
    } else if (status.kind === "stopped") {
      // Deviation D4: ccloop answers `stopped` for an execution that ran to its end with a proved stop;
      // what is left is to collect it.
      if (status.proof.generation !== run.generation) return block("stop-proof-generation");
      run.executionId = status.proof.executionId;
      run.state = "accepted";
      run.drive = { ...drive, inspectUnknown: 0 };
    } else if (status.kind === "absent") {
      run.state = "start-pending";
      run.drive = { ...drive, inspectUnknown: 0 };
    } else if (step === "B") {
      run.state = "unknown";
    } else {
      const inspectUnknown = drive.inspectUnknown + 1;
      if (inspectUnknown >= INSPECT_UNKNOWN_LIMIT) return block("inspect-unknown", { inspectUnknown });
      run.drive = { ...drive, inspectUnknown };
      saveDriverRun(store, run);
      return false;
    }
    saveDriverRun(store, run);
    return true;
  });
}

/**
 * B (spec §2.2): send the stored envelope, byte for byte, unless an execution is already recorded.
 * A thrown answer is `unknown` (it may have started), except a deterministic refusal ccloop makes
 * before it writes anything (exit 2), which is blocked by name (deviation D5).
 */
export async function stepB(deps: ExecutionDriverDeps, runId: string): Promise<boolean> {
  const { store } = deps;
  const run = readDriverRun(store, runId);
  if (run.state !== "start-pending" || run.drive?.prepared !== true) return false;
  if (run.executionId !== null) {
    return write(deps, () => { const current = readDriverRun(store, runId); current.state = "accepted"; saveDriverRun(store, current); return true; });
  }
  if (store.dispatchBlocked || groupStopped(store, run.groupId) || deps.admissionGate?.draining) return false;
  let status: ExecutionStatus;
  try {
    status = await portFor(deps, run).accept(readStartEnvelope(store, run));
  } catch (error) {
    if (error instanceof ControlError && error.code === "control-peer-exit" && (error.detail ?? "").startsWith("2:")) {
      blockRun(deps, runId, "B", `accept-refused:${error.detail}`);
      return true;
    }
    status = { kind: "unknown" };
  }
  deps.crash?.("B-after-accept");
  return persistStatus(deps, runId, status, "B");
}

/** B' (spec §2.2): read-only. `absent` re-arms B; ten unknowns in a row block the run. */
export async function stepBPrime(deps: ExecutionDriverDeps, runId: string): Promise<boolean> {
  const run = readDriverRun(deps.store, runId);
  if (run.state !== "unknown" || run.drive === undefined) return false;
  let status: ExecutionStatus;
  try { status = await portFor(deps, run).inspect(readStartEnvelope(deps.store, run)); }
  catch { status = { kind: "unknown" }; }
  return persistStatus(deps, runId, status, "B'");
}

/**
 * C (spec §2.2): collect, book usage and evidence, and only once the stop is proved act on the
 * terminal: succeeded becomes an attempt commit (§3.3) checked against the task's paths (§5.2);
 * anything else is blocked where it stands and nothing is landed.
 */
export async function stepC(deps: ExecutionDriverDeps, runId: string): Promise<boolean> {
  const { store } = deps;
  const run = readDriverRun(store, runId);
  if (run.state !== "accepted" || run.drive === undefined || run.taskId === null) return false;
  const drive = run.drive;
  const port = portFor(deps, run);
  const report = await port.collect(readStartEnvelope(store, run), run.highWater);
  const refs = [...report.events.map((event) => event.source), ...(report.candidate?.artifacts ?? [])];
  if (report.candidate) refs.push(report.candidate.handoff);
  if (report.candidate?.stopProof) refs.push(report.candidate.stopProof.source);
  for (const ref of refs) {
    const bytes = await port.readEvidence(ref);
    if (createHash("sha256").update(bytes).digest("hex") !== ref.hash) throw new ControlError("artifact-hash-mismatch");
    await writeArtifact(store, ref.artifactId, bytes, archiveAdmission(deps));
  }
  for (const event of report.events) {
    if (event.runId !== runId || event.generation !== run.generation) throw new ControlError("report-identity-conflict");
    admitted(deps, () => recordUsage(store, event));
  }
  const candidate = report.candidate;
  if (candidate && (candidate.runId !== runId || candidate.generation !== run.generation || candidate.workItemId !== run.workItemId)) {
    throw new ControlError("report-identity-conflict");
  }
  if (!report.terminal || !candidate?.stopProof) return report.events.length > 0;
  if (report.terminal.sourceDir !== drive.sourceDir) throw new ControlError("report-path-conflict");
  const source = await writeArtifact(store, `report-${runId}-${hashPayload(report)}`, Buffer.from(JSON.stringify(report)), archiveAdmission(deps));
  write(deps, () => store.db.prepare("INSERT INTO outbox VALUES (?, 'report', ?, 0) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(`report:${runId}`, JSON.stringify({ source })));
  deps.crash?.("C-after-terminal");
  const outcome = report.terminal.outcome;
  if (outcome !== "succeeded") {
    blockRun(deps, runId, "C", `terminal:${outcome}`, { outcome });
    return true;
  }
  const attemptSha = await commitAttempt(join(drive.sourceDir, "repo"));
  const contract = readConfirmedTaskExecution(store, run.groupId, run.taskId).contract;
  const measured = await harvest({ runId, workdir: drive.sourceDir, outcome: "succeeded", attemptSha }, drive.base!, writeSetOf(contract));
  if (measured.outOfBounds.length > 0) {
    blockRun(deps, runId, "C", `out-of-bounds:${measured.outOfBounds.join(",")}`, { outcome, attemptSha });
    return true;
  }
  return write(deps, () => {
    const current = readDriverRun(store, runId);
    if (current.state !== "accepted") return false;
    // Deviation D14: an empty result is not landed; `landedCommit` stays null and E writes no acceptance.
    current.state = measured.empty ? "landed" : "collected";
    current.drive = { ...current.drive!, outcome, attemptSha, landedCommit: null };
    saveDriverRun(store, current);
    return true;
  });
}

const DRIVEN = new Set(["starting", "start-pending", "accepted", "unknown", "collected", "landed", "reconciling"]);

/** spec §2.1: every Web work run the driver can still move, by runId; plus settled runs not yet cleaned (deviation D15). */
export function driverRunIds(store: ControlStore): string[] {
  const ids: string[] = [];
  for (const row of store.db.prepare("SELECT id,body FROM runs ORDER BY id").all()) {
    const runId = String(row.id);
    const run = JSON.parse(String(row.body)) as DriverRun;
    if (run.phase !== "work" || !isWebWorkRun(store, runId)) continue;
    if (DRIVEN.has(run.state) || (run.state === "settled" && run.drive !== undefined && !run.drive.cleanedUp)) ids.push(runId);
  }
  return ids;
}

/** The step a run is at, for blocking it where it failed. `running` is persisted `accepted` (deviation D3). */
export function stepOf(run: DriverRun): DriveStep {
  switch (run.state) {
    case "starting": return "A1";
    case "start-pending": return run.drive?.prepared ? "B" : "A2";
    case "unknown": return "B'";
    case "accepted": return "C";
    case "collected": return "D";
    case "reconciling": return "R";
    default: return "E";
  }
}

/** One step for one run (spec §2.2 table). Later tasks add D, R and E here. */
export async function advance(deps: ExecutionDriverDeps, runId: string, context: DriverContext): Promise<boolean> {
  void context;
  const run = readDriverRun(deps.store, runId);
  switch (run.state) {
    case "starting": return stepA1(deps, runId);
    case "start-pending": return run.drive?.prepared ? stepB(deps, runId) : stepA2(deps, runId);
    case "unknown": return stepBPrime(deps, runId);
    case "accepted": return stepC(deps, runId);
    default: return false;
  }
}

export function createExecutionDriver(deps: ExecutionDriverDeps): ExecutionDriver {
  const context: DriverContext = { reconciling: new Map(), stopped: false };
  let inFlight: Promise<boolean> | null = null;
  let timer: NodeJS.Timeout | null = null;
  let crashed: CrashPoint | null = null;
  const stopTimer = (): void => { if (timer !== null) { clearInterval(timer); timer = null; } };

  const pass = async (): Promise<boolean> => {
    let progressed = false;
    for (const runId of driverRunIds(deps.store)) {
      if (context.stopped) break;
      try {
        if (await advance(deps, runId, context)) progressed = true;
      } catch (error) {
        if (error instanceof DriverCrash) throw error;
        // A draining panel refuses every write; the round ends and no run is blamed for it.
        if (error instanceof ControlError && error.code === "panel-draining") return progressed;
        const run = readDriverRun(deps.store, runId);
        if (run.drive === undefined) { process.stderr.write(`orca-driver: ${runId}: ${describeError(error)}\n`); continue; }
        blockRun(deps, runId, stepOf(run), describeError(error));
        progressed = true;
      }
    }
    return progressed;
  };

  const round = (): Promise<boolean> => {
    if (context.stopped || crashed !== null) return Promise.resolve(false);
    if (inFlight !== null) return inFlight;
    const current = pass()
      .catch((error: unknown) => {
        if (error instanceof DriverCrash) { crashed = error.point; stopTimer(); return false; }
        if (!context.stopped) process.stderr.write(`orca-driver: round failed: ${describeError(error)}\n`);
        return false;
      })
      .finally(() => { inFlight = null; });
    inFlight = current;
    return current;
  };

  const kick = (): void => {
    void round().then((progressed) => { if (progressed && !context.stopped && crashed === null) setImmediate(kick); });
  };

  return {
    round,
    kick,
    start(intervalMs: number): boolean {
      if (timer !== null || context.stopped) return false;
      timer = setInterval(kick, intervalMs);
      timer.unref();
      return true;
    },
    async stop(): Promise<void> {
      context.stopped = true;
      stopTimer();
      if (inFlight !== null) await inFlight;
    },
    get crashed() { return crashed; },
  };
}
```

⚠️ `ControlError` 的构造签名与 `.detail` 字段以 `src/control/errors.ts` 现有定义为准（`targetVersion.test.ts` 读 `error.detail`）；`"control-peer-exit"`／`"control-evidence-context-missing"`／`"artifact-hash-mismatch"`／`"report-identity-conflict"`／`"report-path-conflict"`／`"recovery-blocked"` 都是已登记的码（`ccloopPort.ts`、`errors.ts` 可查）。**开工扫描逐个核 import 是否存在**（handoff §6.4）。

- [ ] **Step 6：看见绿**

```bash
cd /Users/biran/code/skills/loop/Orca
S="${SCRATCH:?}"
npm run typecheck > "$S/t4-tsc.log" 2>&1; echo "RC=$?" >> "$S/t4-tsc.log"
./node_modules/.bin/vitest run tests/control/executionDriver.test.ts > "$S/t4-green.log" 2>&1; echo "RC=$?" >> "$S/t4-green.log"
./node_modules/.bin/vitest run tests/control/webDispatch.test.ts tests/control/webFaults.test.ts tests/control/contextControl.test.ts tests/control/webCcloopSmoke.test.ts > "$S/t4-regress.log" 2>&1; echo "RC=$?" >> "$S/t4-regress.log"
cat "$S/t4-tsc.log" "$S/t4-green.log" "$S/t4-regress.log"
```

Expected：RC 0；17/17；`beginProviderAttempt` 的既有判据照绿（抽事务体不改行为）。

- [ ] **Step 7：提交**

```bash
cd /Users/biran/code/skills/loop/Orca
/usr/bin/git add src/control/webDispatch.ts src/control/executionDriver.ts tests/control/fixtures/web.ts tests/control/fixtures/driverPort.ts tests/control/fixtures/driverHarness.ts tests/control/executionDriver.test.ts
/usr/bin/git commit -F "${SCRATCH:?}/t4-msg.txt"
```

`t4-msg.txt`：

```
feat(control): drive a Web run from starting to collected

The execution driver reserves one provider attempt and records the run's
workspace in one transaction (A1), builds the workspace at the work branch's tip
and stores the whole start envelope (A2), sends those bytes and turns every port
answer into a run state (B, B'; ten unknown inspections block the run, a proved
stop moves on, a deterministic refusal is blocked by name), and collects: usage
and evidence first, then an attempt commit checked against the task's paths, or
a named block for any terminal but succeeded. A run it cannot move is blocked
alone; dispatch stays open. Strict groups are refused before any attempt.

Co-Authored-By: <implementer's own model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR
```

**变异**

| V | 变异 | 喂它的场景 | 期望红（且仅） |
|---|---|---|---|
| T4-M1 | `stepA1` 删 `if (run.state !== "starting") return false;` | A1 调两次 | `reserves exactly one attempt …`（ordinal 2 —— 注：第二次调用在 start-pending 上会把 drive 重写成同值，ordinal 是唯一可见差） |
| T4-M2 | `stepA1` 删 strict 那一行 | strict 组 | `blocks a strict group's run before any provider attempt` |
| T4-M3 | `newDrive` 调用处把 `readWorkspaceSetting(…).workspaceMode` 换成 `"worktree"` | 设成 clone 后 A1 | `takes the repository's workspace mode …` |
| T4-M4 | `stepA2` 里 `repoPath: drive.workspacePath` → `repoPath: targetRepo` | A2 | `builds the workspace at orca/<group>'s tip …`（`repoPath` 断言） |
| T4-M5 | `persistStatus` 删 `if (inspectUnknown >= INSPECT_UNKNOWN_LIMIT) return block(…)` | 恒 unknown | `R2: blocks the run after ten unknown inspections …`（`until` 超 60 轮抛） |
| T4-M6 | `INSPECT_UNKNOWN_LIMIT = 10` → `3` | 同上 | `R2 …`（`inspect` 计数 3 ≠ 10、`inspectUnknown` 3） |
| T4-M7 | `persistStatus` 的 `stopped` 分支整段换成 `return block("stopped")`（spec 原文行为） | lost-accept | `D4: moves on to collection …` |
| T4-M8 | `stepB` 删掉 `control-peer-exit`／`2:` 那个 `if` 块 | refuse | `D5: blocks a deterministic refusal …`（走 unknown→inspect，`inspect` 计数 ≠ 0、原因不同） |
| T4-M9 | `persistStatus` 删 `if (status.configHash !== run.configHash) return block("config-hash-mismatch");` | wrong-config | `blocks an execution whose config hash …` |
| T4-M10 | `stepC` 里 `if (outcome !== "succeeded") {…}` 条件改成 `if (false)` | exhausted | `T1 (synthetic) …`（它会被落成 collected） |
| T4-M11 | `stepC` 删 `if (measured.outOfBounds.length > 0) {…}` | 越界写 | `blocks a result that wrote outside the task's paths …` |
| T4-M12 | `stepC` 里 `measured.empty ? "landed" : "collected"` → `"collected"` | 空结果 | `skips landing for a result that changed nothing` |
| T4-M13 | `stepC` 删 `if (!report.terminal \|\| !candidate?.stopProof) return …;` 里的 `\|\| !candidate?.stopProof` | 无 | **登记为冗余守卫候选**：合成 port 总给 stopProof；由 T9 E1（真 ccloop，candidate 早于 proof 的窗口）承担。变异席实测记录 |
| T4-M14 | `createExecutionDriver.pass` 里删 `if (error instanceof ControlError && error.code === "panel-draining") return progressed;` | 排空中 | `stops the round without blocking anyone …`（A1 的 write 抛 panel-draining ⇒ 无 drive ⇒ 只写 stderr、状态仍 starting —— **预言：这条变异可能不红**，因为 A1 失败时 run 还没有 drive、不会被 block。变异席实测；若不红，登记为「A1 阶段该守卫冗余」，并在 T9 以后的 B 阶段排空判据补 —— 见 T8 的 G5） |
| T4-M15 | `stop()` 删 `if (inFlight !== null) await inFlight;` | 在飞的 accept | `stop() waits for a provider call in flight …` |
| T4-M16 | `round()` 的 catch 里删 `crashed = error.point;` | 崩溃钩子 | `ends the driver like a death …` |

---

## Task 5：落地 D（越界检查已在 C；分离落地工作区、merge、CAS；判据 X1）

**Files:**
- Create: `src/control/driverLanding.ts`
- Modify: `src/control/executionDriver.ts`（import `stepD`；`advance` 加一个 case）
- Create: `tests/control/driverLanding.test.ts`

**Interfaces:**
- Consumes: T4 的 `readDriverRun`、`saveDriverRun`、`write`、`blockRun`、`groupRepoId`、`ExecutionDriverDeps`（含 `beforeCas`、`crash`）；T3 的 `QUIET_GIT`、`landingPathOf`、`removeOwnPath`、`revParse`、`compareAndSwap`、`workBranchRef`、`incomingRefOf`；`git`、`ORCA_IDENTITY`（`gitExec.ts`）。
- Produces（`src/control/driverLanding.ts`）：
  - `findLanding(targetRepo: string, base: string, tip: string, attemptSha: string): Promise<string | null>`
  - `markLanded(deps, runId, landedCommit: string): void`
  - `stepD(deps: ExecutionDriverDeps, runId: string): Promise<boolean>`
- ⚠️ `executionDriver.ts` ↔ `driverLanding.ts` 互相 import：只在函数体里用对方的导出，**顶层不许用**（运行期 ESM 环的 TDZ，typecheck 看不出 —— handoff §4.1）。本 Task 的判据跑起来就是这条的检测。
- 冲突在本 Task 暂时 `blocked`（`merge-conflict`）；T6 把这一分支换成解冲突。**本 Task 不写冲突判据**（T6 写，免得写了再改）。

- [ ] **Step 1：判据 `tests/control/driverLanding.test.ts`**

```ts
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createExecutionDriver } from "../../src/control/executionDriver.js";
import { landingPathOf } from "../../src/control/workspace.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";

// Execution driver spec §5.1-§5.2 and criterion X1: land by merging in a detached worktree of the
// driver's own and moving orca/<group> by compare-and-swap; the person's checkout is never touched.
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

describe("D: landing on orca/<group> (spec §5.1-§5.2)", () => {
  it("X1: lands while the person has orca/<group> checked out, leaving their files and index alone", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "collected");
      const old = git(t.repo, "rev-parse", "refs/heads/orca/g");
      git(t.repo, "checkout", "-q", "orca/g");
      const index = sha256(join(t.repo, ".git", "index"));
      await t.until(driver, () => t.body(runId).state === "landed");
      const drive = t.body(runId).drive;
      const tip = git(t.repo, "rev-parse", "refs/heads/orca/g");
      expect(drive.landedCommit).toBe(tip);
      expect(git(t.repo, "rev-parse", `${tip}^1`)).toBe(old);
      expect(git(t.repo, "rev-parse", `${tip}^2`)).toBe(drive.attemptSha);
      expect(git(t.repo, "log", "-1", "--format=%s", tip)).toBe(`orca: land ${runId}`);
      expect(git(t.repo, "show", `${tip}:a`)).toBe("a");
      expect(git(t.repo, "symbolic-ref", "HEAD")).toBe("refs/heads/orca/g");
      expect(sha256(join(t.repo, ".git", "index"))).toBe(index);
      expect(existsSync(join(t.repo, "a"))).toBe(false);
      const landing = landingPathOf(t.deps.roots, runId);
      expect(existsSync(landing)).toBe(false);
      expect(git(t.repo, "worktree", "list", "--porcelain").split("\n")).not.toContain(`worktree ${landing}`);
    } finally { await t.h.dispose(); }
  });

  it("leaves the branch alone when it moved between the merge and the swap, and lands on the new tip next round", async () => {
    let moved: string | null = null;
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      const driver = createExecutionDriver({ ...t.deps, beforeCas: async () => {
        if (moved !== null) return;
        const old = git(t.repo, "rev-parse", "refs/heads/orca/g");
        moved = git(t.repo, "commit-tree", `${old}^{tree}`, "-p", old, "-m", "someone else");
        git(t.repo, "update-ref", "refs/heads/orca/g", moved, old);
      } });
      await t.until(driver, () => moved !== null);
      expect(t.body(runId).state).toBe("collected");
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(moved);
      expect(existsSync(landingPathOf(t.deps.roots, runId))).toBe(false);
      await t.until(driver, () => t.body(runId).state === "landed");
      expect(git(t.repo, "rev-parse", `${t.body(runId).drive.landedCommit}^1`)).toBe(moved);
    } finally { await t.h.dispose(); }
  });

  it("recognises a landing it already made and does not merge twice (a death after the swap)", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "landed");
      const landed = t.body(runId).drive.landedCommit;
      const commits = git(t.repo, "rev-list", "--count", "refs/heads/orca/g");
      const row = t.h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!;
      const body = JSON.parse(String(row.body));
      t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({ ...body, state: "collected", drive: { ...body.drive, landedCommit: null } }), runId);
      await t.until(driver, () => t.body(runId).state === "landed");
      expect(t.body(runId).drive.landedCommit).toBe(landed);
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(landed);
      expect(git(t.repo, "rev-list", "--count", "refs/heads/orca/g")).toBe(commits);
    } finally { await t.h.dispose(); }
  });

  it("blocks the run by name when the repository path no longer resolves", async () => {
    let resolvable = true;
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      const driver = createExecutionDriver({ ...t.deps, resolveRepository: (repoId) => {
        if (!resolvable) throw new Error("control-path-escape");
        return t.deps.resolveRepository(repoId);
      } });
      await t.until(driver, () => t.body(runId).state === "collected");
      resolvable = false;
      await t.until(driver, () => t.body(runId).state === "blocked");
      expect(t.body(runId).drive).toMatchObject({ blockedAt: "D", blockedReason: "repository-path" });
    } finally { await t.h.dispose(); }
  });
});
```

（计数：4 条。）

- [ ] **Step 2：跑，看见红** —— 预言：四条都红在 `until` 抛「did not reach the expected state」（`advance` 对 `collected` 还返回 false，永远到不了 `landed`；第二条红在 `moved` 永远是 null；第四条红在永远到不了 `blocked`）。

```bash
cd /Users/biran/code/skills/loop/Orca
./node_modules/.bin/vitest run tests/control/driverLanding.test.ts > "${SCRATCH:?}/t5-red.log" 2>&1; echo "RC=$?" >> "${SCRATCH:?}/t5-red.log"; cat "${SCRATCH:?}/t5-red.log"
```

- [ ] **Step 3：`src/control/driverLanding.ts`（新）**

```ts
import { join } from "node:path";
import { ControlError } from "./errors.js";
import { ORCA_IDENTITY, git } from "../scheduler/gitExec.js";
import { blockRun, groupRepoId, readDriverRun, saveDriverRun, write, type ExecutionDriverDeps } from "./executionDriver.js";
import { QUIET_GIT, compareAndSwap, incomingRefOf, landingPathOf, removeOwnPath, revParse, workBranchRef } from "./workspace.js";

/**
 * Execution driver spec §5. Nothing here runs in the person's checkout: every merge happens in a
 * detached worktree the driver names under its own root, and the work branch moves only by
 * compare-and-swap from the tip it was read at.
 */

/**
 * spec §2.2 D's idempotence: a landing the driver already made (it died after the swap, before it
 * recorded it) is found, not repeated. The landing is the first-parent commit whose second parent is
 * this run's attempt; an attempt reachable some other way is not a landing this driver can name.
 */
export async function findLanding(targetRepo: string, base: string, tip: string, attemptSha: string): Promise<string | null> {
  try { await git(targetRepo, [...QUIET_GIT, "merge-base", "--is-ancestor", attemptSha, tip]); }
  catch { return null; }
  const lines = (await git(targetRepo, [...QUIET_GIT, "rev-list", "--first-parent", "--parents", `${base}..${tip}`])).trim().split("\n").filter(Boolean);
  const hit = lines.map((line) => line.split(" ")).find((parts) => parts[2] === attemptSha);
  if (hit === undefined) throw new ControlError("recovery-blocked", "landing-outcome-unknown");
  return hit[0]!;
}

export function markLanded(deps: ExecutionDriverDeps, runId: string, landedCommit: string): void {
  write(deps, () => {
    const run = readDriverRun(deps.store, runId);
    if (run.state !== "collected" && run.state !== "reconciling") return;
    run.state = "landed";
    run.drive = { ...run.drive!, landedCommit };
    saveDriverRun(deps.store, run);
  });
}

/**
 * D (spec §5.1-§5.2). The out-of-bounds check already ran in C. Here: merge the attempt into the
 * current tip in a fresh detached worktree, then swap the branch from that tip. A moved tip is not an
 * error -- the next round lands on the new one. The landing worktree is removed whatever happens.
 */
export async function stepD(deps: ExecutionDriverDeps, runId: string): Promise<boolean> {
  const { store } = deps;
  const run = readDriverRun(store, runId);
  if (run.state !== "collected" || run.drive?.attemptSha == null || run.drive.base === null) return false;
  const drive = run.drive;
  let targetRepo: string;
  try { targetRepo = deps.resolveRepository(groupRepoId(store, run.groupId)); }
  catch { blockRun(deps, runId, "D", "repository-path"); return true; }
  const branch = workBranchRef(run.groupId);
  const old = await revParse(targetRepo, branch);
  const already = await findLanding(targetRepo, drive.base!, old, drive.attemptSha!);
  if (already !== null) { markLanded(deps, runId, already); return true; }
  const landing = landingPathOf(deps.roots, runId);
  await removeOwnPath(targetRepo, deps.roots, landing);
  await git(targetRepo, [...QUIET_GIT, "worktree", "add", "--detach", landing, old]);
  try {
    // Into the target's shared refs: the incoming ref is how the attempt stays reachable until settle.
    await git(landing, [...QUIET_GIT, "fetch", "--no-tags", join(drive.sourceDir, "repo"), `+${drive.attemptSha}:${incomingRefOf(runId)}`]);
    try {
      await git(landing, [...QUIET_GIT, ...ORCA_IDENTITY, "merge", "--no-ff", "-m", `orca: land ${runId}`, incomingRefOf(runId)]);
    } catch {
      await git(landing, [...QUIET_GIT, "merge", "--abort"]).catch(() => undefined);
      blockRun(deps, runId, "D", "merge-conflict");
      return true;
    }
    const next = await revParse(landing, "HEAD");
    await deps.beforeCas?.();
    if (!await compareAndSwap(targetRepo, branch, next, old)) return false;
    deps.crash?.("D-after-cas");
    markLanded(deps, runId, next);
    return true;
  } finally {
    await removeOwnPath(targetRepo, deps.roots, landing);
  }
}
```

- [ ] **Step 4：接进 `advance`**（`src/control/executionDriver.ts`）

import 区加 `import { stepD } from "./driverLanding.js";`；`advance` 的 switch 在 `case "accepted"` 之后加：

```ts
    case "collected": return stepD(deps, runId);
```

- [ ] **Step 5：看见绿，回归 T4**

```bash
cd /Users/biran/code/skills/loop/Orca
S="${SCRATCH:?}"
npm run typecheck > "$S/t5-tsc.log" 2>&1; echo "RC=$?" >> "$S/t5-tsc.log"
./node_modules/.bin/vitest run tests/control/driverLanding.test.ts tests/control/executionDriver.test.ts > "$S/t5-green.log" 2>&1; echo "RC=$?" >> "$S/t5-green.log"
cat "$S/t5-tsc.log" "$S/t5-green.log"
```

Expected：RC 0；4 ＋ 17 条全绿。

- [ ] **Step 6：提交**

```bash
cd /Users/biran/code/skills/loop/Orca
/usr/bin/git add src/control/driverLanding.ts src/control/executionDriver.ts tests/control/driverLanding.test.ts
/usr/bin/git commit -F "${SCRATCH:?}/t5-msg.txt"
```

`t5-msg.txt`：

```
feat(control): land a collected run on orca/<group> by compare-and-swap

The merge happens in a detached worktree the driver names under its own root,
from the branch tip it read; the branch moves only if it is still at that tip,
so a person may keep orca/<group> checked out and their files and index are not
touched. A landing the driver already made is found through the attempt's
merge and never repeated. The landing worktree is removed on every path.

Co-Authored-By: <implementer's own model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR
```

**变异**

| V | 变异 | 喂它的场景 | 期望红（且仅） |
|---|---|---|---|
| T5-M1 | `stepD` 里 `if (!await compareAndSwap(targetRepo, branch, next, old)) return false;` 换成 `await git(targetRepo, [...QUIET_GIT, "update-ref", branch, next]);`（无比较地覆盖） | 分支在 merge 与 swap 之间被挪 | `leaves the branch alone when it moved …`（被覆盖成本 run 的 merge） |
| T5-M2 | 删掉 `if (already !== null) { markLanded(…); return true; }` | 落地后死、重来 | `recognises a landing it already made …`（多一个 merge，count 变） |
| T5-M3 | `finally` 里的 `removeOwnPath(…landing)` 删掉 | 任一次落地 | `X1 …`（landing 仍在）与 `leaves the branch alone …`（landing 仍在） |
| T5-M4 | `worktree add --detach landing old` → 在人的仓库里 merge：`landing` 换成 `targetRepo`（并删掉 add 那一行） | 人 checkout 着 orca/g | `X1 …`（index 变了、`a` 出现在人的工作区） |
| T5-M5 | `stepD` 删 `resolveRepository` 的 try/catch（改成直接调用） | 路径失效 | `blocks the run by name when the repository path no longer resolves`（原因变成 `control-path-escape`，由驱动环 catch 兜底 —— 原因字面量不同 ⇒ 红） |

---

## Task 6：冲突路径 R（冲突副本、`materialiseConflict`、Web 版对方、`planReconciliation`、合成 contract、可负担性、`runTask`＋codex、spawn 的崩溃恢复、`markersRemaining`、`rebuildMergeCommit`）

**Files:**
- Modify: `src/scheduler/ccloopRunner.ts`（`:47-61` `RunTaskOptions`、`:108-122` `spawnCcloop`、`:165` 导出 `latestAttemptSha`、`:243-253` 传 `onSpawn`）
- Modify: `src/control/driverLanding.ts`（冲突分支换成 `beginReconcile`；新增解冲突函数）
- Modify: `src/control/executionDriver.ts`（`advance` 加 `reconciling`）
- Create: `tests/control/fixtures/fake-ccloop-run.mjs`、`tests/control/driverReconcile.test.ts`

**Interfaces:**
- Consumes: `materialiseConflict(copy, wTip, incomingRef): Promise<MaterialisedConflict>`、`pinConflictCommit(copy, runId, commit)`、`synthesizeReconcileContract(a: PlanTask, b: PlanTask, contracts: Map<string, unknown>, runsDir, conflict, approvedBudget?)`（内部已调 `planReconciliation`，并集为空即 `escalate`）、`markersRemaining(copy, commit, paths)`、`rebuildMergeCommit(copy, wTip, incomingRef, tree, message)`（`src/scheduler/reconcile.ts:114,215,318,438,450,476`）；`runTask(plan: PlanFile, task: PlanTask, base, runId, options)`、`cloneDirOf`、`loopDirOf`、`TERMINAL_OUTCOMES`（`ccloopRunner.ts`）；`netChangeSet(clone, base, attemptSha)`（`harvest.ts:111`）；`budgetBalance`、`add`、`readRun`、`syncWebBudget`（`budget.ts`）；`readGroup`、`saveGroup`（`queries.ts`）。
- Produces（`ccloopRunner.ts`）：`RunTaskOptions { adapter: "scripted" | "claude" | "codex"; adapterConfig: string; onSpawn?: (pid: number) => void }`；`export async function latestAttemptSha(clone, runId)`。
- Produces（`driverLanding.ts`）：
  - `stepD`（T5）继续导出，判据直接调用它
  - `otherSideOfWeb(store, targetRepo, run: DriverRun, conflictedPaths): Promise<{taskId: string} | {escalate: string}>`
  - `reconcileAffordable(store, groupId, tokenBudget): boolean`
  - `type ReconcileAction = "collect" | "wait" | "orphan" | "spawn"`；`reconcileNextAction({loopStatus, spawning, pid, alive}): ReconcileAction`
  - `recordReconcileUsage(deps, groupId, runId, attemptSha, tokens): void`
  - `stepR(deps, runId, context: DriverContext): Promise<boolean>`
- blocked 原因（字面量，判据按它断言）：`reconcile-other-side:<n>`、`reconcile-contract:<why>`、`reconcile-budget`（在 D 或 R）、`reconcile-orphan-unknown`、`reconcile-spawn:<why>`、`reconcile-terminal:<status>`、`markers-remaining:<paths>`、`repository-path`。

- [ ] **Step 1：`tests/control/fixtures/fake-ccloop-run.mjs`（新）**

```js
// A `ccloop run` stand-in for the execution driver's reconciliation criteria (Orca execution driver
// spec §5.3). It does exactly what runTask observes of the real one: it commits the scripted files in
// the contract's repoPath (runTask's clone of the conflict copy), publishes
// refs/ccloop/<basename of --run-dir>/attempts/1 there, and writes <run-dir>/loop-state.json.
// Each invocation appends "<run id> <pid>" to <adapter config>.runs, so a criterion can count spawns.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const argv = process.argv.slice(2);
const flag = (name) => argv[argv.indexOf(name) + 1];
const configPath = flag("--adapter-config");
const contract = JSON.parse(readFileSync(flag("--contract"), "utf8"));
const config = JSON.parse(readFileSync(configPath, "utf8"));
const runDir = flag("--run-dir");
appendFileSync(`${configPath}.runs`, `${basename(runDir)} ${process.pid}\n`);

function finish() {
  const repo = contract.context.repoPath;
  const git = (...args) => execFileSync("git", ["-c", "user.name=fake", "-c", "user.email=fake@invalid", "-c", "core.hooksPath=/dev/null", "-C", repo, ...args], { encoding: "utf8" }).trim();
  for (const [path, content] of Object.entries(config.files)) writeFileSync(join(repo, path), content);
  git("add", "-A");
  git("commit", "-q", "--allow-empty", "-m", "fake reconciliation");
  git("update-ref", `refs/ccloop/${basename(runDir)}/attempts/1`, git("rev-parse", "HEAD"));
  writeFileSync(join(runDir, "loop-state.json"), JSON.stringify({
    status: config.status,
    budgetSnapshot: { attemptsRemaining: 0, timeRemainingMs: 0, tokenBudgetRemaining: contract.executionPolicy.tokenBudget - config.spent },
  }));
}

if (config.holdMs > 0) setTimeout(finish, config.holdMs); else finish();
```

- [ ] **Step 2：判据 `tests/control/driverReconcile.test.ts`**

```ts
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createExecutionDriver } from "../../src/control/executionDriver.js";
import { reconcileNextAction, stepD } from "../../src/control/driverLanding.js";
import { readWebGroup } from "../../src/control/webService.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";

// Execution driver spec §5.3: a conflicting landing is reconciled by a separate run (human ruling),
// charged to the group, and lands as an ordinary merge of the tip and the run's own attempt.
const conflicting = [{ taskId: "a", targetPaths: ["shared.txt"] }, { taskId: "b", targetPaths: ["shared.txt"] }];
const files = (id: string) => ({ "shared.txt": id === "a" ? "A\n" : "B\n" });
// Landed or, once Task 7 exists, already settled: both keep drive.landedCommit.
const LANDED = ["landed", "settled"];

async function twoConflicting(reconcile: { files: Record<string, string>; status?: string; spent?: number; holdMs?: number }, affordable = true) {
  const t = await driverHarness(conflicting, { files });
  await writeFile(t.deps.adapterConfigPath, JSON.stringify({ status: "succeeded", spent: 7, holdMs: 0, ...reconcile }));
  if (affordable) {
    // Deviation D12: by default the group's reserve (20% of base) is smaller than one task's token
    // budget, so a reconciliation is refused until another run settles. Raise the ceiling explicitly.
    const limit = readControlGroup(t.h.store, "epoch-test", "g").ledger.groupLimit;
    const raised = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, tokens: limit.tokens + 10_000_000 } }));
    if ("error" in raised) throw new Error(`set-limit refused: ${JSON.stringify(raised.error)}`);
  }
  const ids = [await t.claim(), await t.claim()];
  const spawns = () => existsSync(`${t.deps.adapterConfigPath}.runs`) ? readFileSync(`${t.deps.adapterConfigPath}.runs`, "utf8").trim().split("\n") : [];
  return { ...t, ids, spawns };
}

describe("reconciling a conflict (spec §5.3)", () => {
  it("RC1: a separate run resolves the conflict and it lands as a merge of the tip and the run's own attempt", async () => {
    const t = await twoConflicting({ files: { "shared.txt": "A\nB\n" } }); try {
      const driver = t.driver();
      await t.until(driver, () => t.ids.every((id) => [...LANDED, "blocked"].includes(t.body(id).state)), 120);
      const [first, second] = [...t.ids].sort((x, y) => (t.body(x).drive.reconcile === null ? -1 : 1) - (t.body(y).drive.reconcile === null ? -1 : 1));
      expect(t.ids.every((id) => LANDED.includes(t.body(id).state))).toBe(true);
      const reconciled = t.body(second).drive;
      expect(reconciled.reconcile).toMatchObject({ outcome: "succeeded", otherTaskId: t.body(first).taskId });
      expect(git(t.repo, "show", "refs/heads/orca/g:shared.txt")).toBe("A\nB");
      expect(git(t.repo, "rev-parse", `${reconciled.landedCommit}^1`)).toBe(t.body(first).drive.landedCommit);
      expect(git(t.repo, "rev-parse", `${reconciled.landedCommit}^2`)).toBe(reconciled.attemptSha);
      expect(git(t.repo, "log", "-1", "--format=%s", reconciled.landedCommit)).toBe(`orca: land ${second} (reconciled with ${t.body(first).taskId})`);
      expect(t.spawns()).toHaveLength(1);
      expect(git(reconciled.reconcile.copyPath, "rev-parse", `refs/orca/conflict/${second}`)).toBe(reconciled.reconcile.conflictCommit);
      expect(git(t.repo, "for-each-ref", "--format=%(refname)", "refs/orca/conflict/")).toBe("");
    } finally { await t.h.dispose(); }
  });

  it("books the reconciliation's spend on the group once, and the ledger still conserves", async () => {
    const t = await twoConflicting({ files: { "shared.txt": "A\nB\n" }, spent: 7 }); try {
      const driver = t.driver();
      await t.until(driver, () => t.ids.every((id) => [...LANDED, "blocked"].includes(t.body(id).state)), 120);
      await driver.round(); await driver.round();
      // Each synthetic task reports 10 tokens of work; the reconciliation reports 7.
      expect(readWebGroup(t.h.store, "g").used.tokens).toBe(27);
      expect(t.h.store.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE kind='reconcile-usage'").get()!.n).toBe(1);
      expect(() => readControlGroup(t.h.store, "epoch-test", "g")).not.toThrow();
    } finally { await t.h.dispose(); }
  });

  it("blocks the conflict before any reconciliation run when the group cannot afford it", async () => {
    const t = await twoConflicting({ files: { "shared.txt": "A\nB\n" } }, false); try {
      // Both runs are collected in the same round; D is then stepped by hand so that no settle (Task 7)
      // can release the first run's commitment before the second one's affordability check.
      await t.until(t.driver(), () => t.ids.every((id) => t.body(id).state === "collected"));
      const [landed, blocked] = [...t.ids].sort();
      await stepD(t.deps, landed!);
      await stepD(t.deps, blocked!);
      expect(t.body(blocked).drive).toMatchObject({ blockedAt: "D", blockedReason: "reconcile-budget", reconcile: null });
      expect(t.spawns()).toHaveLength(0);
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(t.body(landed).drive.landedCommit);
    } finally { await t.h.dispose(); }
  });

  it("blocks a reconciliation that leaves conflict markers, and orca/<group> keeps only the first landing", async () => {
    const t = await twoConflicting({ files: { "shared.txt": "<<<<<<< ours\nA\n=======\nB\n>>>>>>> theirs\n" } }); try {
      const driver = t.driver();
      await t.until(driver, () => t.ids.some((id) => t.body(id).state === "blocked"), 120);
      const blocked = t.ids.find((id) => t.body(id).state === "blocked")!;
      const landed = t.ids.find((id) => id !== blocked)!;
      expect(t.body(blocked).drive).toMatchObject({ blockedAt: "R", blockedReason: "markers-remaining:shared.txt" });
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(t.body(landed).drive.landedCommit);
    } finally { await t.h.dispose(); }
  });

  it("blocks a conflict that no landed run of the group explains", async () => {
    const t = await driverHarness([{ taskId: "a", targetPaths: ["shared.txt"] }], { files: () => ({ "shared.txt": "A\n" }) }); try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "collected");
      git(t.repo, "checkout", "-q", "orca/g");
      await writeFile(`${t.repo}/shared.txt`, "a person's own\n");
      git(t.repo, "add", "shared.txt");
      git(t.repo, "commit", "-qm", "by hand");
      await t.until(driver, () => t.body(runId).state === "blocked");
      expect(t.body(runId).drive).toMatchObject({ blockedAt: "D", blockedReason: "reconcile-other-side:0" });
    } finally { await t.h.dispose(); }
  });

  it("waits for a reconciliation still running, and collects it once it ends, with one spawn", async () => {
    const t = await twoConflicting({ files: { "shared.txt": "A\nB\n" }, holdMs: 800 }); try {
      const driver = t.driver();
      await t.until(driver, () => t.ids.some((id) => t.body(id).drive?.reconcile?.pid != null), 120);
      await driver.round();
      expect(t.ids.some((id) => t.body(id).state === "reconciling")).toBe(true);
      for (let i = 0; i < 100 && !t.ids.every((id) => LANDED.includes(t.body(id).state)); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        await driver.round();
      }
      expect(t.ids.every((id) => LANDED.includes(t.body(id).state))).toBe(true);
      expect(t.spawns()).toHaveLength(1);
    } finally { await t.h.dispose(); }
  });

  it("after a restart, waits on a recorded live reconciliation process instead of spawning a second one", async () => {
    const t = await twoConflicting({ files: { "shared.txt": "A\nB\n" }, holdMs: 1500 }); try {
      await t.until(t.driver(), () => t.ids.some((id) => t.body(id).drive?.reconcile?.pid != null), 120);
      const restarted = createExecutionDriver(t.deps);
      for (let i = 0; i < 100 && !t.ids.every((id) => LANDED.includes(t.body(id).state)); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        await restarted.round();
      }
      expect(t.ids.every((id) => LANDED.includes(t.body(id).state))).toBe(true);
      expect(t.spawns()).toHaveLength(1);
    } finally { await t.h.dispose(); }
  });

  it("after a restart with a spawn recorded but no process id, blocks instead of running a second reconciliation", async () => {
    const t = await twoConflicting({ files: { "shared.txt": "A\nB\n" } }); try {
      await t.until(t.driver(), () => t.ids.some((id) => t.body(id).state === "reconciling"), 120);
      const runId = t.ids.find((id) => t.body(id).state === "reconciling")!;
      const body = t.body(runId);
      t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({ ...body, drive: { ...body.drive, reconcile: { ...body.drive.reconcile, spawning: true, pid: null } } }), runId);
      await createExecutionDriver(t.deps).round();
      expect(t.body(runId).drive).toMatchObject({ blockedAt: "R", blockedReason: "reconcile-orphan-unknown" });
      expect(t.spawns()).toHaveLength(0);
    } finally { await t.h.dispose(); }
  });
});

describe("what a restarted driver does with a reconciliation it finds (spec §5.3(6), deviation D17)", () => {
  it.each([
    [{ loopStatus: "succeeded", spawning: true, pid: 5, alive: true }, "collect"],
    [{ loopStatus: "exhausted", spawning: true, pid: null, alive: false }, "collect"],
    [{ loopStatus: null, spawning: true, pid: 5, alive: true }, "wait"],
    [{ loopStatus: null, spawning: true, pid: null, alive: false }, "orphan"],
    [{ loopStatus: null, spawning: true, pid: 5, alive: false }, "spawn"],
    [{ loopStatus: "planning", spawning: false, pid: null, alive: false }, "spawn"],
  ] as const)("%o ⇒ %s", (input, action) => {
    expect(reconcileNextAction(input)).toBe(action);
  });
});
```

（计数：场景 8 条 ＋ 表 6 条 ＝ 14。）

⚠️ `until` 的轮数上限第三参数用 120：两轮 claim ＋ 各自 A1/A2/B/C ＋ D ＋ R 的 spawn／collect；不够就是真卡住了，不许调大迁就。

- [ ] **Step 3：跑，看见红** —— 预言：`reconcileNextAction` 不存在 ⇒ 整文件红在 import。

```bash
cd /Users/biran/code/skills/loop/Orca
./node_modules/.bin/vitest run tests/control/driverReconcile.test.ts > "${SCRATCH:?}/t6-red.log" 2>&1; echo "RC=$?" >> "${SCRATCH:?}/t6-red.log"; cat "${SCRATCH:?}/t6-red.log"
```

- [ ] **Step 4：`src/scheduler/ccloopRunner.ts`**

`RunTaskOptions`（`:47-61`）的 `adapter` 那一行改为 `adapter: "scripted" | "claude" | "codex";`，并在 `adapterConfig: string;` 之后加：

```ts
  /**
   * Execution driver spec §5.3(6): called with the ccloop process id as soon as it is spawned, so a
   * caller can record it durably and, after its own restart, tell a live reconciliation from a dead one.
   */
  onSpawn?: (pid: number) => void;
```

`spawnCcloop`（`:108`）签名改为 `function spawnCcloop(bin: string, args: string[], onSpawn?: (pid: number) => void): Promise<SpawnResult>`，在 `const child = spawn(…);` 之后加一行：

```ts
    if (child.pid !== undefined) onSpawn?.(child.pid);
```

`:165` `async function latestAttemptSha` → `export async function latestAttemptSha`。`:243-253` 的 `spawnCcloop(plan.ccloopBin, [ … ])` 调用在参数数组的 `]` 之后加第三个实参 `, options.onSpawn`。

- [ ] **Step 5：`src/control/driverLanding.ts`**

import 区换成：

```ts
import { existsSync, readFileSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { add, budgetBalance, readRun, syncWebBudget } from "./budget.js";
import { canonicalBytes } from "./canonicalJson.js";
import { ControlError } from "./errors.js";
import { readConfirmedTaskExecution } from "./executionSnapshot.js";
import { privateDirectory } from "./paths.js";
import { readGroup, saveGroup } from "./queries.js";
import { ORCA_IDENTITY, git } from "../scheduler/gitExec.js";
import { TERMINAL_OUTCOMES, cloneDirOf, latestAttemptSha, loopDirOf, runTask } from "../scheduler/ccloopRunner.js";
import { netChangeSet } from "../scheduler/harvest.js";
import { markersRemaining, materialiseConflict, pinConflictCommit, rebuildMergeCommit, synthesizeReconcileContract } from "../scheduler/reconcile.js";
import { blockRun, describeError, groupRepoId, readDriverRun, saveDriverRun, write, type DriverContext, type DriverRun, type ExecutionDriverDeps } from "./executionDriver.js";
import { QUIET_GIT, compareAndSwap, conflictPathOf, incomingRefOf, landingPathOf, reconcileRunsDirOf, removeOwnPath, revParse, workBranchRef } from "./workspace.js";
import type { ReconcileRecord } from "./driveRecord.js";
import type { ControlStore } from "./store.js";
import type { PlanFile, PlanTask } from "../scheduler/planFile.js";
```

`stepD` 的 merge 失败分支（T5 的 `blockRun(deps, runId, "D", "merge-conflict"); return true;` 两句）换成：

```ts
      await removeOwnPath(targetRepo, deps.roots, landing);
      return beginReconcile(deps, runId, targetRepo, old);
```

文件末尾加：

```ts
/**
 * spec §5.3(2), deviation D11: the other side is a run of this group that landed after this run's
 * base and whose own change (base..its attempt, the landing's second parent) touches a conflicted
 * path. Exactly one, or the reconciliation would carry a side this driver picked.
 */
export async function otherSideOfWeb(store: ControlStore, targetRepo: string, run: DriverRun, conflictedPaths: readonly string[]): Promise<{ taskId: string } | { escalate: string }> {
  const conflicted = new Set(conflictedPaths);
  const touched = new Set<string>();
  for (const row of store.db.prepare("SELECT body FROM runs WHERE group_id=? ORDER BY id").all(run.groupId)) {
    const other = JSON.parse(String(row.body)) as DriverRun;
    const landed = other.drive?.landedCommit;
    if (other.runId === run.runId || other.taskId === null || landed == null || other.drive?.base == null) continue;
    try {
      await git(targetRepo, [...QUIET_GIT, "merge-base", "--is-ancestor", landed, run.drive!.base!]);
      continue;
    } catch { /* landed after this run's base: a candidate */ }
    const changed = await netChangeSet(targetRepo, other.drive.base, `${landed}^2`);
    if (changed.some((path) => conflicted.has(path))) touched.add(other.taskId);
  }
  return touched.size === 1 ? { taskId: [...touched][0]! } : { escalate: String(touched.size) };
}

/** spec §5.3(5), deviation D12: a read-only check, not a reservation (registered as a known gap). */
export function reconcileAffordable(store: ControlStore, groupId: string, tokenBudget: number): boolean {
  const group = readGroup(store, groupId);
  return budgetBalance(group.limit, group.used, group.reserved).reserve.tokens >= tokenBudget;
}

/**
 * spec §5.3(1)-(5): re-create the conflict in a clone of the target (its `origin` is the target, which
 * `materialiseConflict` fetches from), name the other side, synthesize a contract carrying both sides,
 * and check the group can afford it -- all before anything is spent.
 */
async function beginReconcile(deps: ExecutionDriverDeps, runId: string, targetRepo: string, old: string): Promise<boolean> {
  const { store, roots } = deps;
  const run = readDriverRun(store, runId);
  const copy = conflictPathOf(roots, runId);
  await removeOwnPath(targetRepo, roots, copy);
  await git(roots.workspacesRoot, [...QUIET_GIT, "clone", "--local", "--no-checkout", targetRepo, copy]);
  const conflict = await materialiseConflict(copy, old, incomingRefOf(runId));
  await pinConflictCommit(copy, runId, conflict.conflictCommit);
  const other = await otherSideOfWeb(store, targetRepo, run, conflict.conflictedPaths);
  if ("escalate" in other) { blockRun(deps, runId, "D", `reconcile-other-side:${other.escalate}`); return true; }
  const contracts = new Map<string, unknown>([
    [run.taskId!, readConfirmedTaskExecution(store, run.groupId, run.taskId!).contract],
    [other.taskId, readConfirmedTaskExecution(store, run.groupId, other.taskId).contract],
  ]);
  const runsDir = privateDirectory(reconcileRunsDirOf(roots, runId));
  const side = (taskId: string): PlanTask => ({ taskId, contract: "", dependsOn: [] });
  const synthesized = await synthesizeReconcileContract(side(run.taskId!), side(other.taskId), contracts, runsDir, conflict);
  if ("escalate" in synthesized) { blockRun(deps, runId, "D", `reconcile-contract:${synthesized.escalate}`); return true; }
  const tokenBudget = (JSON.parse(await readFile(synthesized.path, "utf8")) as { executionPolicy: { tokenBudget: number } }).executionPolicy.tokenBudget;
  if (!reconcileAffordable(store, run.groupId, tokenBudget)) { blockRun(deps, runId, "D", "reconcile-budget"); return true; }
  const record: ReconcileRecord = {
    copyPath: copy, old, conflictCommit: conflict.conflictCommit, conflictedPaths: conflict.conflictedPaths, otherTaskId: other.taskId,
    reconcileRunId: `reconcile-${runId}`, runsDir, contractPath: synthesized.path, tokenBudget, spawning: false, pid: null, outcome: null, attemptSha: null,
  };
  return write(deps, () => {
    const current = readDriverRun(store, runId);
    if (current.state !== "collected") return false;
    current.state = "reconciling";
    current.drive = { ...current.drive!, reconcile: record };
    saveDriverRun(store, current);
    return true;
  });
}

export type ReconcileAction = "collect" | "wait" | "orphan" | "spawn";

/**
 * spec §5.3(6), deviation D17. A terminal loop state is collected; a recorded live process is waited
 * on; a spawn that was begun but whose process id never got recorded may still be running somewhere,
 * so it is blocked rather than run twice; anything else is (re)spawned.
 */
export function reconcileNextAction(input: { loopStatus: string | null; spawning: boolean; pid: number | null; alive: boolean }): ReconcileAction {
  if (input.loopStatus !== null && TERMINAL_OUTCOMES.includes(input.loopStatus)) return "collect";
  if (input.pid !== null && input.alive) return "wait";
  if (input.spawning && input.pid === null) return "orphan";
  return "spawn";
}

function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

function readLoopState(loopDir: string): { status: string | null; tokenBudgetRemaining: number | null } {
  const path = join(loopDir, "loop-state.json");
  if (!existsSync(path)) return { status: null, tokenBudgetRemaining: null };
  try {
    const state = JSON.parse(readFileSync(path, "utf8")) as { status?: unknown; budgetSnapshot?: { tokenBudgetRemaining?: unknown } };
    const remaining = state.budgetSnapshot?.tokenBudgetRemaining;
    return { status: typeof state.status === "string" ? state.status : null, tokenBudgetRemaining: typeof remaining === "number" ? remaining : null };
  } catch { return { status: null, tokenBudgetRemaining: null }; }
}

/**
 * spec §5.3(5), deviation D18: `ccloop run` reports no usage events, so the reconciliation's token
 * spend is read off its loop state and booked on the group once per reconciled attempt, keeping the
 * Web ledger mirror in step.
 */
export function recordReconcileUsage(deps: ExecutionDriverDeps, groupId: string, runId: string, attemptSha: string, tokens: number): void {
  write(deps, () => {
    const id = `reconcile-usage:${runId}:${attemptSha}`;
    if (deps.store.db.prepare("SELECT id FROM outbox WHERE id=?").get(id)) return;
    const group = readGroup(deps.store, groupId);
    group.used = add(group.used, { tokens, activeMs: 0, attempts: 1, sessions: 1 });
    syncWebBudget(deps.store, group, readRun(deps.store, runId));
    group.budgetVersion += 1;
    saveGroup(deps.store, group);
    deps.store.db.prepare("INSERT INTO outbox(id,kind,body,delivered) VALUES (?,'reconcile-usage',?,1)")
      .run(id, canonicalBytes({ groupId, runId, attemptSha, tokens }).toString("utf8"));
  });
}

/**
 * R (spec §5.3(6)-(7)). The reconciliation `ccloop run` is never awaited inside a round: it runs in
 * the background and every round looks at its loop state. Its process id is recorded as soon as it
 * exists, so a restarted driver waits on it instead of starting a second one.
 */
export async function stepR(deps: ExecutionDriverDeps, runId: string, context: DriverContext): Promise<boolean> {
  const { store } = deps;
  if (context.reconciling.has(runId)) return false;
  const run = readDriverRun(store, runId);
  const record = run.drive?.reconcile;
  if (run.state !== "reconciling" || record == null) return false;
  const workdir = join(record.runsDir, record.reconcileRunId);
  const loop = readLoopState(loopDirOf(workdir, record.reconcileRunId));
  const action = reconcileNextAction({ loopStatus: loop.status, spawning: record.spawning, pid: record.pid, alive: record.pid !== null && processAlive(record.pid) });
  if (action === "wait") return false;
  if (action === "orphan") { blockRun(deps, runId, "R", "reconcile-orphan-unknown"); return true; }
  if (action === "collect") return finishReconcile(deps, runId, record, loop, await latestAttemptSha(cloneDirOf(workdir), record.reconcileRunId));
  if (context.stopped || deps.admissionGate?.draining) return false;
  if (!reconcileAffordable(store, run.groupId, record.tokenBudget)) { blockRun(deps, runId, "R", "reconcile-budget"); return true; }
  await rm(workdir, { recursive: true, force: true });
  const setRecord = (patch: Partial<ReconcileRecord>): void => write(deps, () => {
    const current = readDriverRun(store, runId);
    current.drive = { ...current.drive!, reconcile: { ...current.drive!.reconcile!, ...patch } };
    saveDriverRun(store, current);
  });
  setRecord({ spawning: true, pid: null });
  const plan: PlanFile = { targetRepo: record.copyPath, ccloopBin: deps.ccloopBin, runsDir: record.runsDir, workBranch: `orca/${run.groupId}`, policy: "local-merge", ledgerMode: "out-of-repo", tasks: [] };
  const task: PlanTask = { taskId: record.reconcileRunId, contract: record.contractPath, dependsOn: [] };
  const running = runTask(plan, task, record.conflictCommit, record.reconcileRunId, {
    adapter: "codex", adapterConfig: deps.adapterConfigPath,
    onSpawn: (pid) => { if (!context.stopped) setRecord({ pid }); },
  }).then(
    () => undefined,
    (error: unknown) => { if (!context.stopped) blockRun(deps, runId, "R", `reconcile-spawn:${describeError(error)}`); },
  ).catch(() => undefined).finally(() => { context.reconciling.delete(runId); });
  context.reconciling.set(runId, running);
  return true;
}

/** spec §5.3(7): markers are refused by code; the reconciled tree becomes an ordinary merge, landed by CAS. */
async function finishReconcile(
  deps: ExecutionDriverDeps, runId: string, record: ReconcileRecord,
  loop: { status: string | null; tokenBudgetRemaining: number | null }, attemptSha: string | null,
): Promise<boolean> {
  const { store } = deps;
  const run = readDriverRun(store, runId);
  const outcomePatch = { reconcile: { ...record, outcome: loop.status } };
  if (loop.status !== "succeeded" || attemptSha === null) { blockRun(deps, runId, "R", `reconcile-terminal:${loop.status}`, outcomePatch); return true; }
  const workdir = join(record.runsDir, record.reconcileRunId);
  await git(record.copyPath, [...QUIET_GIT, "fetch", "--no-tags", cloneDirOf(workdir), `+${attemptSha}:refs/orca/reconciled/${runId}`]);
  const remaining = await markersRemaining(record.copyPath, attemptSha, record.conflictedPaths);
  if (remaining.length > 0) { blockRun(deps, runId, "R", `markers-remaining:${remaining.join(",")}`, outcomePatch); return true; }
  recordReconcileUsage(deps, run.groupId, runId, attemptSha, Math.max(0, record.tokenBudget - (loop.tokenBudgetRemaining ?? record.tokenBudget)));
  let targetRepo: string;
  try { targetRepo = deps.resolveRepository(groupRepoId(store, run.groupId)); }
  catch { blockRun(deps, runId, "R", "repository-path"); return true; }
  const tree = (await git(record.copyPath, [...QUIET_GIT, "rev-parse", `${attemptSha}^{tree}`])).trim();
  const merged = await rebuildMergeCommit(record.copyPath, record.old, incomingRefOf(runId), tree, `orca: land ${runId} (reconciled with ${record.otherTaskId})`);
  await git(record.copyPath, [...QUIET_GIT, "update-ref", `refs/orca/merged/${runId}`, merged]);
  const landing = landingPathOf(deps.roots, runId);
  await removeOwnPath(targetRepo, deps.roots, landing);
  await git(targetRepo, [...QUIET_GIT, "worktree", "add", "--detach", landing, record.old]);
  let swapped = false;
  try {
    // A bare sha is fetchable because refs/orca/merged/<runId> advertises it in the copy.
    await git(landing, [...QUIET_GIT, "fetch", "--no-tags", record.copyPath, merged]);
    await deps.beforeCas?.();
    swapped = await compareAndSwap(targetRepo, workBranchRef(run.groupId), merged, record.old);
  } finally {
    await removeOwnPath(targetRepo, deps.roots, landing);
  }
  return write(deps, () => {
    const current = readDriverRun(store, runId);
    if (current.state !== "reconciling") return false;
    if (!swapped) {
      // The tip moved while the reconciliation ran, so its merge has a stale first parent: land again.
      current.state = "collected";
      current.drive = { ...current.drive!, reconcile: null };
    } else {
      current.state = "landed";
      current.drive = { ...current.drive!, landedCommit: merged, reconcile: { ...current.drive!.reconcile!, outcome: loop.status, attemptSha } };
    }
    saveDriverRun(store, current);
    return true;
  });
}
```

⚠️ `ORCA_IDENTITY` 与 `revParse`、`ControlError` 仍被 T5 的 `stepD`／`findLanding` 用着，保留 import；`typecheck` 会报出没用到的 import（`noUnusedLocals` 若开着），按实际删。

- [ ] **Step 6：接进 `advance`**（`src/control/executionDriver.ts`）

import `stepD` 那一行改为 `import { stepD, stepR } from "./driverLanding.js";`；`advance` 去掉 `void context;`，switch 在 `case "collected"` 之后加：

```ts
    case "reconciling": return stepR(deps, runId, context);
```

- [ ] **Step 7：看见绿，回归**

```bash
cd /Users/biran/code/skills/loop/Orca
S="${SCRATCH:?}"
npm run typecheck > "$S/t6-tsc.log" 2>&1; echo "RC=$?" >> "$S/t6-tsc.log"
./node_modules/.bin/vitest run tests/control/driverReconcile.test.ts tests/control/driverLanding.test.ts tests/control/executionDriver.test.ts tests/scheduler/ccloopRunner.test.ts tests/scheduler/reconcile.test.ts > "$S/t6-green.log" 2>&1; echo "RC=$?" >> "$S/t6-green.log"
cat "$S/t6-tsc.log" "$S/t6-green.log"
```

Expected：RC 0；本 Task 14 条 ＋ T4/T5 21 条全绿；调度器既有判据照绿（`RunTaskOptions` 只加）。

- [ ] **Step 8：提交**

```bash
cd /Users/biran/code/skills/loop/Orca
/usr/bin/git add src/scheduler/ccloopRunner.ts src/control/driverLanding.ts src/control/executionDriver.ts tests/control/fixtures/fake-ccloop-run.mjs tests/control/driverReconcile.test.ts
/usr/bin/git commit -F "${SCRATCH:?}/t6-msg.txt"
```

`t6-msg.txt`：

```
feat(control): reconcile a conflicting landing with a separate run

A conflict is re-created in a clone of the target, its other side named from
the group's own landings after the run's base, and a contract carrying both
sides synthesized; a group that cannot afford its token budget is blocked
before anything is spent. The reconciliation is a `ccloop run --adapter codex`
spawned in the background, its pid recorded, so a restarted driver waits on a
live one, collects a finished one and refuses to guess about one it cannot
see. Markers are refused by code; the reconciled tree lands as a merge of the
tip and the run's own attempt by compare-and-swap, and its spend is booked on
the group.

Co-Authored-By: <implementer's own model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR
```

**变异**

| V | 变异 | 喂它的场景 | 期望红（且仅） |
|---|---|---|---|
| T6-M1 | `beginReconcile` 删 `if (!reconcileAffordable(…)) {…}` | 默认预算 | `blocks the conflict before any reconciliation run when the group cannot afford it` |
| T6-M2 | `otherSideOfWeb` 删「landed before this run's base ⇒ continue」那个 try 块 | 手工提交造成的冲突 | **预言不红**：只有一个 run、无别的 landed run，这支守卫在本文件场景里没有独占判据 ⇒ 变异席实测；不红就登记「本支无独占判据」并报控制器（补判据需要三 task 场景，归 T11 之后） |
| T6-M3 | `otherSideOfWeb` 返回改成 `touched.size >= 1 ? { taskId: [...touched][0]! } : …` | 同上 | 不红（同上原因，登记） |
| T6-M4 | `otherSideOfWeb` 的 `touched.size === 1` → `touched.size <= 1`（0 也算） | 手工提交造成的冲突 | `blocks a conflict that no landed run of the group explains`（`[...touched][0]` 为 undefined ⇒ 读 contract 抛 ⇒ 原因不同） |
| T6-M5 | `finishReconcile` 删 `if (remaining.length > 0) {…}` | 带标记的解 | `blocks a reconciliation that leaves conflict markers …` |
| T6-M6 | `recordReconcileUsage` 删「已记过就 return」那一行 | 解冲突后多跑两轮 | **预言不红**：同一 attempt 只会进一次 `finishReconcile`（落定后状态是 landed）。登记为防重入冗余；R1（T9）若覆盖到「CAS 后未落盘」的解冲突路径再核 |
| T6-M7 | `recordReconcileUsage` 删 `syncWebBudget(…)` | 解冲突 | `books the reconciliation's spend …`（`readControlGroup` 以 `live-ledger-conservation` 拦） |
| T6-M8 | `reconcileNextAction` 删 orphan 那一行 | 表第 4 行、`after a restart with a spawn recorded but no process id …` | 表 `⇒ orphan` 一格 ＋ 场景那条（多一次 spawn） |
| T6-M9 | `reconcileNextAction` 删 wait 那一行 | 表第 3 行、`after a restart, waits on a recorded live …` | 表 `⇒ wait` 一格 ＋ 场景那条（spawn 计数 2） |
| T6-M10 | `stepR` 删 `if (context.reconciling.has(runId)) return false;` | 同一驱动环里等待中 | `waits for a reconciliation still running …`（loop-state 未出前 pid 活 ⇒ wait 兜住 —— **预言可能不红**：pid 已记下时第二道守卫 `wait` 接住。变异席实测，不红则登记为冗余守卫） |
| T6-M11 | `ccloopRunner.ts` 删 `if (child.pid !== undefined) onSpawn?.(child.pid);` | 任一解冲突 | `waits for a reconciliation still running …`（`until` 等 pid 永不出现）与 `after a restart, waits on …`（同） |
| T6-M12 | `finishReconcile` 的 `compareAndSwap(…, merged, record.old)` 换成直接 `update-ref <branch> merged`（无 old） | 无 | 本文件无独占判据（尖端不会被挪）。登记；由 T5 的同类判据覆盖机制，本支冗余风险报控制器 |

---

## Task 7：settle E（acceptance → `commitCandidate` → projection → 清理）与补 wake（CR1）

**Files:**
- Modify: `src/control/budget.ts:143-152`（`releaseRunReserve` 的 Web 分支，D2）
- Modify: `src/control/executionDriver.ts`（`stepE`、`replenishStartWakes`、`advance` 两个 case、`pass` 开头补 wake）
- Create: `tests/control/driverSettle.test.ts`

**Interfaces:**
- Consumes: `archiveRun(store, {runId, sourceDir, repoDir, stopProof}, deps)`（`archive.ts:159`）；`commitCandidate(store, candidate, deps)`（`checkpoints.ts:64`）；`publishPending(store, deps)`（`projection.ts:16`）；`readArtifact`、`writeArtifact`（`archive.ts`）；`readRun`（`budget.ts:20`）；`setAllocationStates(store, groupId, ownerId, state, amounts?)`、`releaseCommitment(store, groupId, released)`（`stopIntent.ts:686,705`）；`nextClaimableTask`（T4 导出）；`cleanupRunWorkspace`（T3）；`canonicalBytes`（`canonicalJson.ts`）；`Candidate`（`types.ts`）；`ExecutionReport`（`executionPort.ts`）。
- Produces（`src/control/executionDriver.ts`）：
  - `stepE(deps, runId): Promise<boolean>`（`landed` ⇒ settle；`settled && !cleanedUp` ⇒ 只清理）
  - `DISPATCHABLE_GROUP_STATES = new Set(["ready", "running", "review"])`
  - `replenishStartWakes(deps): string[]`（返回新写的 wake id，形如 `drive:<groupId>:<n>`）
- Produces（`src/control/budget.ts`）：`releaseRunReserve` 对 `"planHash" in group` 的组：`state="settled"`、`active=0`、`remaining` **不动**、该 work 的 allocation 置 `terminal`、`releaseCommitment` 同步 ledger 镜像。legacy 分支一字不改。
- acceptance 证据的 `checksPassed:true` 含义（D2 附注）：ccloop 的 verifier 在该 run 里跑过 `requiredChecks` 且终态 `succeeded`；Orca 本片不另跑检查。

- [ ] **Step 1：判据 `tests/control/driverSettle.test.ts`**

```ts
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readArtifact } from "../../src/control/archive.js";
import { deliverSchedulerWakes } from "../../src/control/dispatch.js";
import { createExecutionDriver, DriverCrash } from "../../src/control/executionDriver.js";
import { createWebWakeHandlers } from "../../src/control/webDispatch.js";
import { readWebGroup } from "../../src/control/webService.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";

// Execution driver spec §2.2 E and §2.1 (CR1): a landed run settles through the ledger's own
// checkpoint path, its workspace is cleaned, and the group keeps going without another start command.

describe("E: settle a landed run (spec §2.2, deviation D2)", () => {
  it("persists settled with the work done, acceptance naming the landing, and every ledger view still reading", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "landed");
      const before = readWebGroup(t.h.store, "g").ledger.committedRemaining.tokens;
      const remaining = t.body(runId).remaining;
      await t.until(driver, () => t.body(runId).drive?.cleanedUp === true);
      const run = t.body(runId);
      expect(run).toMatchObject({ state: "settled", recoverable: true });
      expect(t.h.store.db.prepare("SELECT active FROM runs WHERE id=?").get(runId)).toEqual({ active: 0 });
      expect(JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body)).status).toBe("done");
      const view = readControlGroup(t.h.store, "epoch-test", "g");
      expect(view.runs.find((entry) => entry.runId === runId)!.state).toBe("settled-recoverable");
      expect(view.workItems.find((entry) => entry.taskId === "a")!.status).toBe("completed");
      expect(readWebGroup(t.h.store, "g").ledger.committedRemaining.tokens).toBe(before - remaining.work.tokens - remaining.handoff.tokens);
      const acceptance = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM outbox WHERE id=? AND kind='acceptance'").get(`acceptance:${runId}`)!.body));
      expect(JSON.parse((await readArtifact(t.h.store, acceptance.source)).toString())).toMatchObject({ runId, checksPassed: true, landing: "landed", commit: run.drive.landedCommit });
    } finally { await t.h.dispose(); }
  });

  it("cleans only the run's own workspace and incoming ref, keeps its source directory, and never touches orca/<group>", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).drive?.cleanedUp === true);
      const drive = t.body(runId).drive;
      expect(existsSync(drive.workspacePath)).toBe(false);
      expect(git(t.repo, "worktree", "list", "--porcelain").split("\n")).not.toContain(`worktree ${drive.workspacePath}`);
      expect(git(t.repo, "for-each-ref", "--format=%(refname)", "refs/orca/")).toBe("");
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(drive.landedCommit);
      expect(existsSync(drive.sourceDir)).toBe(true);
    } finally { await t.h.dispose(); }
  });

  it("settles an empty result without acceptance, so its work is blocked (deviation D14)", async () => {
    const t = await driverHarness([{ taskId: "a" }], { files: () => ({}) }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).drive?.cleanedUp === true);
      expect(t.body(runId).state).toBe("settled");
      expect(t.h.store.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE kind='acceptance'").get()!.n).toBe(0);
      expect(JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body)).status).toBe("blocked");
    } finally { await t.h.dispose(); }
  });

  it("commits the checkpoint exactly once across a death after the acceptance", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      const crashing = createExecutionDriver({ ...t.deps, crash: (point) => { if (point === "E-after-acceptance") throw new DriverCrash(point); } });
      await t.until(crashing, () => crashing.crashed !== null);
      expect(t.body(runId).state).toBe("landed");
      await t.until(t.driver(), () => t.body(runId).drive?.cleanedUp === true);
      expect(t.h.store.db.prepare("SELECT COUNT(*) AS n FROM checkpoints WHERE run_id=?").get(runId)).toEqual({ n: 1 });
      expect(t.h.store.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE kind='acceptance'").get()).toEqual({ n: 1 });
    } finally { await t.h.dispose(); }
  });

  it("R2b: an independent run settles while its sibling is blocked at B'", async () => {
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }], { behaviour: (id) => (id === "a" ? "unknown" : "succeed") }); try {
      const a = await t.claim();
      const b = await t.claim();
      await t.until(t.driver(), () => t.body(a).state === "blocked" && t.body(b).drive?.cleanedUp === true);
      expect(t.body(a).drive.blockedReason).toBe("inspect-unknown");
      expect(t.body(b).state).toBe("settled");
      expect(t.fake.calls.inspect).toBe(10);
    } finally { await t.h.dispose(); }
  });
});

describe("CR1: the group keeps going after one start command (spec §2.1)", () => {
  it("runs independent tasks side by side and a dependent task on top of its dependency", async () => {
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }, { taskId: "c", dependsOn: ["a"] }]); try {
      await t.claim();
      const driver = t.driver();
      const { start } = createWebWakeHandlers({ ...t.dispatch, service: t.service });
      const workStatus = (id: string) => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(id)!.body)).status;
      const runOf = (task: string) => t.h.store.db.prepare("SELECT id FROM runs WHERE group_id='g' AND work_item_id=?").get(task);
      let sideBySide = false;
      for (let i = 0; i < 200 && !["a", "b", "c"].every((id) => workStatus(id) === "done"); i += 1) {
        await deliverSchedulerWakes(t.h.store, { start });
        await driver.round();
        const a = runOf("a"), b = runOf("b");
        if (a && b && t.body(String(a.id)).state !== "settled" && t.body(String(b.id)).state !== "settled") sideBySide = true;
      }
      expect(["a", "b", "c"].map(workStatus)).toEqual(["done", "done", "done"]);
      expect(sideBySide).toBe(true);
      const aLanded = t.body(String(runOf("a")!.id)).drive.landedCommit;
      const cBase = t.body(String(runOf("c")!.id)).drive.base;
      expect(() => git(t.repo, "merge-base", "--is-ancestor", aLanded, cBase)).not.toThrow();
      expect(git(t.repo, "show", "refs/heads/orca/g:c")).toBe("c");
      expect(Number(t.h.store.db.prepare("SELECT COUNT(*) AS n FROM scheduler_wakes WHERE id LIKE 'drive:g:%'").get()!.n)).toBeGreaterThanOrEqual(2);
    } finally { await t.h.dispose(); }
  });

  it("arms nothing for a group nobody started", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      await t.driver().round();
      expect(t.h.store.db.prepare("SELECT COUNT(*) AS n FROM scheduler_wakes WHERE kind='start'").get()).toEqual({ n: 0 });
    } finally { await t.h.dispose(); }
  });
});
```

（计数：7 条。`createWebWakeHandlers` 需要 `service.claimEstimate`；只把 `start` 交给 `deliverSchedulerWakes`，夹具导入时排队的 `budget-estimate` wake 没有 handler ⇒ 按 `dispatch.ts:105` 保持待办、不被投递。）

- [ ] **Step 2：跑，看见红** —— 预言：前五条红在 `until` 等不到 `cleanedUp`（`advance` 对 `landed` 返回 false）；「commits … exactly once」红在同处；CR1 红在循环结束时 b、c 不是 done（只有一个 start wake，b 永远领不到）；「arms nothing」**改动前就是绿的**（没有补 wake 代码）—— 它的红证只能来自变异 T7-M6。

```bash
cd /Users/biran/code/skills/loop/Orca
./node_modules/.bin/vitest run tests/control/driverSettle.test.ts > "${SCRATCH:?}/t7-red.log" 2>&1; echo "RC=$?" >> "${SCRATCH:?}/t7-red.log"; cat "${SCRATCH:?}/t7-red.log"
```

- [ ] **Step 3：`src/control/budget.ts`（D2）**

import 区加 `import { releaseCommitment, setAllocationStates } from "./stopIntent.js";`（`stopIntent.ts` 顶层只用 zod 与 `schema.js`，不在模块求值期调用 `budget.ts` 的导出 ⇒ 这个环只在函数调用期生效；计划席在副本里实测过，见 §0 (b)）。`releaseRunReserve` 里 `const group=readGroup(store,run.groupId);` 之后插入：

```ts
  if("planHash" in group){
    // Execution driver deviation D2 (measured): a Web run keeps `remaining == max(grant-cumulative,0)`,
    // which the read model checks on every run, so its unspent grant is released through the Web
    // ledger's own path -- allocation terminal, reserve given back with every mirror in step -- the
    // same one `terminaliseRun` (stopIntent.ts) uses.
    run.state="settled";saveRun(store,run);store.db.prepare("UPDATE runs SET active=0 WHERE id=?").run(id);
    setAllocationStates(store,run.groupId,run.workItemId,"terminal");
    releaseCommitment(store,run.groupId,add(run.remaining.work,run.remaining.handoff));
    return;
  }
```

- [ ] **Step 4：`src/control/executionDriver.ts`**

import 区加：

```ts
import { archiveRun, readArtifact } from "./archive.js";
import { commitCandidate } from "./checkpoints.js";
import { publishPending } from "./projection.js";
import { nextClaimableTask } from "./webDispatch.js";
import { cleanupRunWorkspace } from "./workspace.js";
import { readRun } from "./budget.js";
import type { Candidate } from "./types.js";
import type { ExecutionReport } from "./executionPort.js";
```

（`writeArtifact` 已在；`isWebWorkRun` 等已在的 import 合并进同一行，不重复。）文件里加：

```ts
async function savedReport(store: ControlStore, runId: string): Promise<ExecutionReport> {
  const row = store.db.prepare("SELECT body FROM outbox WHERE id=? AND kind='report'").get(`report:${runId}`);
  if (!row) throw new ControlError("control-terminal-pending");
  return JSON.parse((await readArtifact(store, JSON.parse(String(row.body)).source)).toString()) as ExecutionReport;
}

/**
 * E (spec §2.2): acceptance first -- `commitCandidate` marks the work done only when acceptance already
 * exists (checkpoints.ts) -- then the checkpoint, the projection, and only then the cleanup. A run that
 * settled before it was cleaned (a death in between) is visited again for the cleanup alone (D15).
 */
export async function stepE(deps: ExecutionDriverDeps, runId: string): Promise<boolean> {
  const { store } = deps;
  const run = readDriverRun(store, runId);
  if (run.drive === undefined) return false;
  const drive = run.drive;
  if (run.state === "landed") {
    const report = await savedReport(store, runId);
    const raw = report.candidate;
    if (raw === null || report.terminal === null) throw new ControlError("control-terminal-pending");
    const archive = await archiveRun(store, { runId, sourceDir: drive.sourceDir, repoDir: join(drive.sourceDir, "repo"), stopProof: raw.stopProof }, archiveAdmission(deps));
    if (drive.landedCommit !== null) {
      // Same evidence shape `confirmLanding` writes (schedulerBridge.ts). checksPassed: ccloop's verifier
      // ran the contract's requiredChecks in this run and it ended `succeeded`.
      const source = await writeArtifact(store, `acceptance-${runId}`, Buffer.from(JSON.stringify({ runId, checksPassed: true, landing: "landed", commit: drive.landedCommit, intent: `drive:${runId}` })), archiveAdmission(deps));
      write(deps, () => store.db.prepare("INSERT INTO outbox VALUES (?, 'acceptance', ?, 1) ON CONFLICT(id) DO NOTHING").run(`acceptance:${runId}`, JSON.stringify({ runId, accepted: true, source })));
    }
    deps.crash?.("E-after-acceptance");
    const record = readRun(store, runId);
    const missing = [...archive.missing, ...raw.missing];
    const candidate: Candidate = {
      groupId: record.groupId, workItemId: record.workItemId, taskId: record.taskId, runId, generation: record.generation,
      graphVersion: record.graphVersion, targetVersion: record.targetVersion, checkpointId: `settle-${runId}`, usageHighWater: raw.usageHighWater,
      result: missing.length === 0 && raw.result === "complete" ? "complete" : "partial",
      artifacts: [...archive.artifacts, ...raw.artifacts, raw.handoff], snapshot: archive.snapshot, missing,
      unresolvedRequestIds: raw.unresolvedRequestIds, stopProof: raw.stopProof, terminalOutcome: report.terminal.outcome, handoff: raw.handoff,
    };
    candidate.checkpointId = `settle-${runId}-${hashPayload(candidate).slice(0, 16)}`;
    await commitCandidate(store, candidate, archiveAdmission(deps));
    if (readDriverRun(store, runId).state !== "settled") { blockRun(deps, runId, "E", "settle-incomplete"); return true; }
    await publishPending(store, archiveAdmission(deps));
  }
  const settled = readDriverRun(store, runId);
  if (settled.state !== "settled" || settled.drive === undefined || settled.drive.cleanedUp) return run.state === "landed";
  await cleanupRunWorkspace(deps.resolveRepository(groupRepoId(store, settled.groupId)), deps.roots, runId, settled.drive.workspacePath);
  write(deps, () => {
    const current = readDriverRun(store, runId);
    current.drive = { ...current.drive!, cleanedUp: true };
    saveDriverRun(store, current);
  });
  return true;
}

/** Group states the driver re-arms dispatch for; `commitCandidate` moves a group to `review` (checkpoints.ts). */
export const DISPATCHABLE_GROUP_STATES = new Set(["ready", "running", "review"]);

/**
 * CR1 (spec §2.1): a start wake claims one task, and nothing else ever arms another. For each started,
 * dispatchable group with ready work and no wake pending, arm one `start` wake under the group's last
 * start revision; the pump claims one task per wake, so parallelism grows by one per round. A group
 * nobody started has no start wake to copy and gets nothing.
 */
export function replenishStartWakes(deps: Pick<ExecutionDriverDeps, "store" | "admissionGate">): string[] {
  const { store } = deps;
  if (store.dispatchBlocked) return [];
  return write(deps, () => {
    const armed: string[] = [];
    for (const row of store.db.prepare("SELECT id,body FROM groups ORDER BY id").all()) {
      const groupId = String(row.id);
      const group = JSON.parse(String(row.body)) as { planHash?: string; status: string; stopped: boolean };
      if (group.planHash === undefined || group.stopped || !DISPATCHABLE_GROUP_STATES.has(group.status)) continue;
      if (store.db.prepare("SELECT group_id FROM stop_intents WHERE group_id=?").get(groupId)) continue;
      if (store.db.prepare("SELECT id FROM recovery_blockers WHERE group_id=? AND scope='group'").get(groupId)) continue;
      if (store.db.prepare("SELECT id FROM scheduler_wakes WHERE group_id=? AND kind IN ('start','no-start','resume') AND delivered=0").get(groupId)) continue;
      const last = store.db.prepare("SELECT body FROM scheduler_wakes WHERE group_id=? AND kind='start' ORDER BY rowid DESC LIMIT 1").get(groupId);
      if (!last || nextClaimableTask(store, groupId) === null) continue;
      const body = JSON.parse(String(last.body)) as { startRevision: number; executionSnapshotHash?: string };
      const ordinal = Number(store.db.prepare("SELECT COUNT(*) AS n FROM scheduler_wakes WHERE group_id=? AND id LIKE ?").get(groupId, `drive:${groupId}:%`)!.n) + 1;
      const wakeId = `drive:${groupId}:${ordinal}`;
      store.db.prepare("INSERT INTO scheduler_wakes(id,group_id,kind,body,delivered) VALUES (?,?,'start',?,0)").run(wakeId, groupId, canonicalBytes({
        groupId, startRevision: body.startRevision, ...(body.executionSnapshotHash === undefined ? {} : { executionSnapshotHash: body.executionSnapshotHash }),
      }).toString("utf8"));
      armed.push(wakeId);
    }
    return armed;
  });
}
```

`advance` 的 switch 在 `case "reconciling"` 之后加：

```ts
    case "landed": case "settled": return stepE(deps, runId);
```

`createExecutionDriver` 的 `pass` 开头（`let progressed = false;` 之后、`for` 之前）加：

```ts
    try {
      if (replenishStartWakes(deps).length > 0) { progressed = true; deps.kickPump?.(); }
    } catch (error) {
      if (error instanceof ControlError && error.code === "panel-draining") return false;
      throw error;
    }
```

⚠️ `ControlError("control-terminal-pending")` 是既有码（`schedulerBridge.ts:66`）。

- [ ] **Step 5：看见绿，回归 T4–T6 与 checkpoint 既有判据**

```bash
cd /Users/biran/code/skills/loop/Orca
S="${SCRATCH:?}"
npm run typecheck > "$S/t7-tsc.log" 2>&1; echo "RC=$?" >> "$S/t7-tsc.log"
./node_modules/.bin/vitest run tests/control/driverSettle.test.ts tests/control/driverReconcile.test.ts tests/control/driverLanding.test.ts tests/control/executionDriver.test.ts tests/control/checkpoints.test.ts tests/control/budget.test.ts tests/control/schedulerBridge.test.ts tests/control/endToEnd.test.ts > "$S/t7-green.log" 2>&1; echo "RC=$?" >> "$S/t7-green.log"
cat "$S/t7-tsc.log" "$S/t7-green.log"
```

Expected：RC 0；7 ＋ 14 ＋ 4 ＋ 17 条全绿；legacy 的 checkpoint／budget／bridge／endToEnd 照绿（Web 分支只对带 `planHash` 的组）。

- [ ] **Step 6：提交**

```bash
cd /Users/biran/code/skills/loop/Orca
/usr/bin/git add src/control/budget.ts src/control/executionDriver.ts tests/control/driverSettle.test.ts
/usr/bin/git commit -F "${SCRATCH:?}/t7-msg.txt"
```

`t7-msg.txt`：

```
feat(control): settle landed Web runs and keep their groups dispatching

A landed run writes its acceptance, then commits its checkpoint, publishes
its projection and cleans only its own workspace and incoming ref; a death
between the settle and the cleanup is resumed. Settling a Web run now goes
through the Web ledger's own release (allocation terminal, reserve given back,
remaining left at grant minus usage), because the legacy release broke the
read model for every Web group. A started group with ready work and no wake
pending gets one start wake per round, so independent tasks run side by side
and a dependent one follows its dependency.

Co-Authored-By: <implementer's own model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR
```

**变异**

| V | 变异 | 喂它的场景 | 期望红（且仅） |
|---|---|---|---|
| T7-M1 | `budget.ts` 删整个 `if("planHash" in group){…}` 块 | 任一 Web settle | 本文件第 1 条（`readControlGroup` 以 `run-identity` 拦、`readWebGroup` 以 mirror 拦）、第 5 条之外的所有经过 settle 后读视图的判据 —— **变异席逐条记名**（预期：第 1 条；第 2、3、4、5、6 条走到 settle 但不读视图，可能照绿） |
| T7-M2 | `stepE` 里把 acceptance 块挪到 `commitCandidate` 之后 | 非空结果 | 第 1 条（work 成了 `blocked`） |
| T7-M3 | `stepE` 删 `if (drive.landedCommit !== null)` 的条件（恒写 acceptance） | 空结果 | `settles an empty result without acceptance …` |
| T7-M4 | `stepE` 删整段清理（`cleanupRunWorkspace` 调用与 `cleanedUp` 写入） | 任一 settle | 第 1–5 条全部红在 `until` 等不到 `cleanedUp`（**不独占**；独占红由 T7-M5 给） |
| T7-M5 | `stepE` 删 `cleanupRunWorkspace(…)` 这一行（保留 `cleanedUp: true`） | 任一 settle | `cleans only the run's own workspace …`（工作区仍在） |
| T7-M6 | `replenishStartWakes` 删 `if (!last \|\| …) continue;` 里的 `!last \|\|` | 没人 start 的组 | `arms nothing for a group nobody started`（`last` 为 undefined ⇒ `JSON.parse` 抛 ⇒ 整轮报错 —— 预言：判据以「start wake 计数 0」断言，抛错时 round 被 catch 吞掉、计数仍 0 ⇒ **可能不红**。变异席实测；不红则改用变异 T7-M6b：`last` 为空时写一个 `startRevision:1` 的 wake —— 该变异必红） |
| T7-M7 | `replenishStartWakes` 整个函数体换成 `return [];` | 一次 start | `runs independent tasks side by side …` |
| T7-M8 | `DISPATCHABLE_GROUP_STATES` 去掉 `"review"` | 第一个 settle 后组进 review | `runs independent tasks side by side …`（c 永远领不到） |
| T7-M9 | `stepE` 删 `if (readDriverRun(store, runId).state !== "settled") {…}` | 无 | **预言不红**（合成 port 总给 stopProof 与两桶 usage ⇒ 总能 settle）。登记为防御分支；由 T9 E1 在真 ccloop 下观察 |

---

## Task 8：recovery 跳过 Web run、shutdown 不为驱动环的 run 写 stop、`recovery-retry` 接线、Web spec ERRATUM

**Files:**
- Modify: `src/control/recovery.ts:13,23-24`（第四参数、跳过点在 `:26` 之前）
- Modify: `src/panel/controlLifecycle.ts:31-39,120-122,167`（`exemptDriverRuns`）
- Modify: `src/control/stopIntent.ts`（`retryRun` 的 `resolved` 那一行）
- Modify（文末追加）: `docs/superpowers/specs/2026-09-19-web-recoverable-control-design.md`
- Create: `tests/control/driverRecovery.test.ts`

**Interfaces:**
- Consumes: `isWebWorkRun`（T4）；`resumeBlockedDriverRun`（T2）；既有 `recoverControl`、`applyPanelShutdown`、`applyRecoveryRetry`／`WebControlService.recoveryRetry`、`webFixture().runCommand`（`tests/control/fixtures/web.ts`）。
- Produces：
  - `recoverControl(store, port, wakes?, options: { driverOwnsWebRuns?: boolean } = {})` —— 为真时，Web work run 在进入 legacy 逐 run 分支**之前**跳过，不进 `blocked`、不写 `recovery-error`
  - `PanelShutdownDeps.exemptDriverRuns?: boolean`；`shutdownGroup(store, groupId, window, shutdownId, exemptDriverRuns = false)` —— 为真时 Web work run 不进 frozen 集合、不写 handoff 请求
  - `retryRun`：先无条件调 `resumeBlockedDriverRun(store, runId)`，再 `resolved = blockers.resolved || rearm !== null || resumedDriverRun`（见 Step 5 的求值顺序说明）
- **两个开关都默认关**：不传参数的调用（既有判据全部如此）行为逐字节不变（D7）。

- [ ] **Step 1：判据 `tests/control/driverRecovery.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { recoverControl } from "../../src/control/recovery.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { WebControlService } from "../../src/control/webService.js";
import { applyPanelShutdown } from "../../src/panel/controlLifecycle.js";
import type { FakeBehaviour } from "./fixtures/driverPort.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { webFixture } from "./fixtures/web.js";

// Execution driver spec §4 and §2.3. Each switch is judged on both sides: on (a driver exists) and off
// (today's behaviour, byte for byte -- deviation D7).

async function claimedSoft() {
  const h = await webFixture();
  const service = new WebControlService(h.deps);
  service.confirm(h.command("confirm", { ...h.confirmPayload(), budgetMode: "soft" }));
  await service.start(h.command("start", {}));
  const claim = await deliverScheduledStart({ store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate }, "g");
  if (claim.kind !== "claimed") throw new Error(`claim refused: ${JSON.stringify(claim)}`);
  return { h, service, runId: claim.runId };
}

const count = (h: Awaited<ReturnType<typeof webFixture>>, sql: string, ...args: unknown[]) => Number(h.store.db.prepare(sql).get(...args)!.n);

describe("startup recovery and driver-owned runs (spec §4)", () => {
  it("leaves a Web work run to the driver when the driver exists: not blocked, no recovery error, dispatch open", async () => {
    const { h, runId } = await claimedSoft(); try {
      const result = await recoverControl(h.store, {} as never, undefined, { driverOwnsWebRuns: true });
      expect(result.blockedRunIds).toEqual([]);
      expect(h.store.dispatchBlocked).toBe(false);
      expect(count(h, "SELECT COUNT(*) AS n FROM outbox WHERE id=?", `recovery-error:${runId}`)).toBe(0);
    } finally { await h.dispose(); }
  });

  it("blocks it exactly as before when no driver exists", async () => {
    const { h, runId } = await claimedSoft(); try {
      const result = await recoverControl(h.store, {} as never);
      expect(result.blockedRunIds).toEqual([runId]);
      expect(h.store.dispatchBlocked).toBe(true);
    } finally { await h.dispose(); }
  });
});

describe("panel shutdown and driver-owned runs (spec §4)", () => {
  const window = { epoch: "epoch-driver", now: () => new Date("2026-09-25T00:00:00.000Z"), shutdownGraceMs: 1_000 };

  it("freezes no driver-owned run and writes no handoff request for it when the driver exists", async () => {
    const { h, runId } = await claimedSoft(); try {
      const result = await applyPanelShutdown({ store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate, ...window, exemptDriverRuns: true });
      const entry = (result.result as { kind: "shutdown"; groups: Array<{ groupId: string; frozenRunIds: string[] }> }).groups.find((group) => group.groupId === "g")!;
      expect(entry.frozenRunIds).toEqual([]);
      expect(count(h, "SELECT COUNT(*) AS n FROM handoff_requests WHERE run_id=?", runId)).toBe(0);
      expect(count(h, "SELECT COUNT(*) AS n FROM outbox WHERE kind='handoff-request'")).toBe(0);
    } finally { await h.dispose(); }
  });

  it("freezes it exactly as before when no driver exists", async () => {
    const { h, runId } = await claimedSoft(); try {
      const result = await applyPanelShutdown({ store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate, ...window });
      const entry = (result.result as { kind: "shutdown"; groups: Array<{ groupId: string; frozenRunIds: string[] }> }).groups.find((group) => group.groupId === "g")!;
      expect(entry.frozenRunIds).toEqual([runId]);
      expect(count(h, "SELECT COUNT(*) AS n FROM handoff_requests WHERE run_id=?", runId)).toBe(1);
    } finally { await h.dispose(); }
  });
});

describe("a person's recovery-retry on a blocked driver run (spec §2.3)", () => {
  it("sends the run back to the step it was blocked at and reports it resolved", async () => {
    const { h, service, runId } = await claimedSoft(); try {
      const row = h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!;
      const body = JSON.parse(String(row.body));
      h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({ ...body, state: "blocked", providerAttemptOrdinal: 1, drive: {
        workspaceMode: "worktree", sourceDir: "/x/s", workspacePath: "/x/w", targetRepo: null, prepared: true, base: null, envelopeHash: null, inspectUnknown: 10,
        outcome: null, attemptSha: null, landedCommit: null, reconcile: null, blockedAt: "B'", blockedReason: "inspect-unknown", cleanedUp: false,
      } }), runId);
      const retried = await service.recoveryRetry(h.runCommand("recovery-retry", runId, { scope: "run", runId }));
      expect(retried).toMatchObject({ result: { kind: "recovery-observed", resolved: true } });
      expect(JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body))).toMatchObject({ state: "unknown", drive: { blockedAt: null, blockedReason: null, inspectUnknown: 0 } });
    } finally { await h.dispose(); }
  });

  it("reports nothing resolved, and changes nothing, for a run that is not blocked", async () => {
    const { h, service, runId } = await claimedSoft(); try {
      const before = String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body);
      const retried = await service.recoveryRetry(h.runCommand("recovery-retry", runId, { scope: "run", runId }));
      expect(retried).toMatchObject({ result: { kind: "recovery-observed", resolved: false } });
      expect(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body)).toBe(before);
    } finally { await h.dispose(); }
  });

  it("drives a retried run on from where it was blocked, to settled", async () => {
    let mode: FakeBehaviour = "unknown";
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => mode }); try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "blocked");
      mode = "succeed";
      const retried = await t.service.recoveryRetry(t.h.runCommand("recovery-retry", runId, { scope: "run", runId }));
      expect(retried).toMatchObject({ result: { kind: "recovery-observed", resolved: true } });
      await t.until(driver, () => t.body(runId).drive?.cleanedUp === true);
      expect(t.body(runId).state).toBe("settled");
      expect(t.fake.calls.accept).toHaveLength(2);
    } finally { await t.h.dispose(); }
  });
});
```

（计数：7 条。「drives a retried run on」：重试后 `unknown` ⇒ inspect 答 `absent`（合成 port 在 `unknown` 模式下从未记下 execution）⇒ 回 `start-pending` ⇒ 同一份 envelope 再发一次 ⇒ accept 计数恰好 2。）

- [ ] **Step 2：跑，看见红** —— 预言：recovery「driver exists」红（`blockedRunIds` 为 `[runId]`）；shutdown「driver exists」红（frozen 为 `[runId]`）；retry 第一条红（`resolved:false`、状态仍 blocked）；第三条红在 `until` 等不到 `cleanedUp`；两条「exactly as before」与「not blocked」**改动前就是绿的**（它们钉的是不变的一侧，红证来自变异 T8-M3/M4/M6）。

```bash
cd /Users/biran/code/skills/loop/Orca
./node_modules/.bin/vitest run tests/control/driverRecovery.test.ts > "${SCRATCH:?}/t8-red.log" 2>&1; echo "RC=$?" >> "${SCRATCH:?}/t8-red.log"; cat "${SCRATCH:?}/t8-red.log"
```

- [ ] **Step 3：`src/control/recovery.ts`**（本文件是紧凑风格，照它的风格写）

import 区加 `import { isWebWorkRun } from "./webDispatch.js";`。`:13` 签名改为：

```ts
export async function recoverControl(store:ControlStore,port:ExecutionPort,wakes?:{handlers:WakeHandlers},options:{driverOwnsWebRuns?:boolean}={}):Promise<{blockedRunIds:string[];replayedProjectionIds:string[];pendingWakeIds:string[]}> {
```

`:24` `const runId=String(row.id);let run=readRun(store,runId);` 这一行拆成两行，中间插入跳过：

```ts
  const runId=String(row.id);
  // Execution driver spec §4: with a driver present, a Web work run is the driver's to reconcile, run by run.
  if(options.driverOwnsWebRuns && isWebWorkRun(store,runId)) continue;
  let run=readRun(store,runId);
```

- [ ] **Step 4：`src/panel/controlLifecycle.ts`**

import 区加 `import { isWebWorkRun } from "../control/webDispatch.js";`。`PanelShutdownDeps`（`:31-39`）在 `beforeCommit?` 之后加：

```ts
  /**
   * Execution driver spec §4: a run the driver owns keeps running in ccloop across an Orca restart and is
   * collected afterwards, so no stop is frozen for it. Off unless a driver exists.
   */
  exemptDriverRuns?: boolean;
```

`shutdownGroup` 签名（`:120`）加第五参数 `exemptDriverRuns = false`，`:122` 改为：

```ts
  const active = frozenRunIds(store, groupId).filter((runId) => !(exemptDriverRuns && isWebWorkRun(store, runId)));
```

`:167` 改为 `const groups = groupIds.map(groupId => shutdownGroup(store, groupId, window, command.commandId, deps.exemptDriverRuns === true));`。

- [ ] **Step 5：`src/control/stopIntent.ts` 的 `retryRun`**

import 区加 `import { resumeBlockedDriverRun } from "./driveRecord.js";`。`retryRun` 里这一行（先现读确认原文是 `const resolved = blockers.resolved || rearm !== null;`，不是就停下报告）：

```ts
  const resolved = blockers.resolved || rearm !== null || resumeBlockedDriverRun(store, runId);
```

⚠️ 保持求值顺序：`resumeBlockedDriverRun` 有写副作用，放在 `||` 最后意味着前两项为真时它**不执行**。这不对 —— 一个同时带 run 级 blocker 的 blocked 驱动 run 也要被送回。所以写成两行：

```ts
  const resumedDriverRun = resumeBlockedDriverRun(store, runId);
  const resolved = blockers.resolved || rearm !== null || resumedDriverRun;
```

- [ ] **Step 6：Web spec 文末追加 ERRATUM**（原文逐字不动；追加前后用 `git show HEAD:<path>` 做前缀比对，证明正文逐字节等于提交前 —— handoff §6.10）

```markdown

## ERRATUM (execution driver, 2026-09-25)

The statements below are superseded by `docs/superpowers/specs/2026-09-25-execution-driver-design.md` for the runs the execution driver owns: Web runs claimed for work (they carry a `work:<groupId>:<runId>` claim row) on a panel whose execution port is configured. The original text above is kept verbatim.

- The background scheduler named at line 772 is the execution driver loop (`src/control/executionDriver.ts`). After a start wake is delivered it reserves the provider attempt, sends the frozen start envelope, collects, lands the result on `orca/<groupId>`, settles the run, and arms another start wake while ready work remains.
- The request-bound proof line 778 requires before a strict provider call is honoured in this slice only by refusal: a strict group's run is blocked with `strict-proof-unimplemented` before any provider attempt; soft groups are driven without a proof.
- Line 788 (a lost proof acknowledgement sets a global recovery blocker) is unchanged for the proof path (`recoverAttempt`). What no longer applies to driver-owned runs is startup recovery's rule that a run without a `start:<runId>` row blocks dispatch for every group: recovery leaves those runs to the driver, and a run the driver cannot advance is blocked on its own, with a named `blockedReason`, without setting `dispatchBlocked`.
```

- [ ] **Step 7：看见绿，回归既有 recovery／shutdown／stop 判据**

```bash
cd /Users/biran/code/skills/loop/Orca
S="${SCRATCH:?}"
npm run typecheck > "$S/t8-tsc.log" 2>&1; echo "RC=$?" >> "$S/t8-tsc.log"
./node_modules/.bin/vitest run tests/control/driverRecovery.test.ts tests/control/recovery.test.ts tests/control/webFaults.test.ts tests/control/webDispatch.test.ts tests/control/stopIntent.test.ts tests/panel/controlLifecycle.test.ts tests/panel/controlRecoveryApi.test.ts tests/panel/controlShutdown.test.ts > "$S/t8-green.log" 2>&1; echo "RC=$?" >> "$S/t8-green.log"
python3 - > "$S/t8-erratum.log" 2>&1 <<'EOF'
import subprocess
p='docs/superpowers/specs/2026-09-19-web-recoverable-control-design.md'
old=subprocess.run(['/usr/bin/git','show','HEAD:'+p],capture_output=True).stdout
new=open(p,'rb').read()
print('PREFIX_IDENTICAL', new.startswith(old), 'APPENDED_BYTES', len(new)-len(old))
EOF
cat "$S/t8-tsc.log" "$S/t8-green.log" "$S/t8-erratum.log"
```

Expected：RC 0；7 条新判据绿；列出的既有判据**一条不改、全绿**（`controlShutdown` 那条 SIGTERM flake 若红，先单文件重跑）；`PREFIX_IDENTICAL True`。

- [ ] **Step 8：提交（两笔：代码一笔、ERRATUM 一笔）**

```bash
cd /Users/biran/code/skills/loop/Orca
/usr/bin/git add src/control/recovery.ts src/panel/controlLifecycle.ts src/control/stopIntent.ts tests/control/driverRecovery.test.ts
/usr/bin/git commit -F "${SCRATCH:?}/t8-msg.txt"
/usr/bin/git add docs/superpowers/specs/2026-09-19-web-recoverable-control-design.md
/usr/bin/git commit -F "${SCRATCH:?}/t8-erratum-msg.txt"
```

`t8-msg.txt`：

```
feat(control): leave driver-owned Web runs to the driver on restart and shutdown

With a driver present, startup recovery skips Web work runs instead of
blocking all dispatch for them, and a panel shutdown freezes no stop for them:
they keep running in ccloop and are collected afterwards. Without a driver,
both behave exactly as before. A person's run-scoped recovery-retry sends a
blocked driver run back to the step it was blocked at.

Co-Authored-By: <implementer's own model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR
```

`t8-erratum-msg.txt`：

```
docs(spec): append the execution driver erratum to the Web control spec

Co-Authored-By: <implementer's own model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR
```

**变异**

| V | 变异 | 喂它的场景 | 期望红（且仅） |
|---|---|---|---|
| T8-M1 | `recovery.ts` 删跳过那一行 | driver exists | `leaves a Web work run to the driver …` |
| T8-M2 | 跳过条件去掉 `options.driverOwnsWebRuns &&` | 无 driver | `blocks it exactly as before …` **与**既有 `tests/control/webFaults.test.ts` > `recovers an open run before anything listens, so the first request already sees a blocked store`（这正是 D7 要保的那一侧） |
| T8-M3 | `controlLifecycle.ts` 的 filter 删掉 | driver exists | `freezes no driver-owned run …` |
| T8-M4 | filter 条件去掉 `exemptDriverRuns &&` | 无 driver | `freezes it exactly as before …` 与既有 `tests/panel/controlLifecycle.test.ts` > `strengthens a pause only when an active run must be stopped, and freezes that run` |
| T8-M5 | `retryRun` 删 `resumeBlockedDriverRun(store, runId)` 调用（`resumedDriverRun = false`） | blocked 驱动 run 重试 | `sends the run back …` 与 `drives a retried run on …` |
| T8-M6 | `resumeBlockedDriverRun` 删 `run.state !== "blocked" \|\|` | 未 blocked 的 run 重试 | **预言不红**：该 run 无 drive（`drive === undefined` 那一项先拦）⇒ 登记为冗余守卫；T2 的 `leaves a run that is not blocked exactly as it was` 同样由 `drive` 缺失先拦 |

---

## Task 9：装配（`controlAssembly`）＋ E1／E2／W1／真 ccloop 的 T1 ＋ R1 崩溃电池

**Files:**
- Modify: `src/panel/controlAssembly.ts`（import、`ControlRuntime`、`ControlAssemblyInput`、service deps、pump、驱动环构造、`recover`、`shutdown`、`startPump`、`close`）
- Create: `tests/panel/controlAssemblyDriver.test.ts`（不需要真 ccloop）
- Create: `tests/control/executionDriverE2E.test.ts`（`it.skipIf(!ORCA_CCLOOP_BIN)`；门里一律带 env 跑，**0 skipped 才算过** —— T11 判定器查）

**Interfaces:**
- Consumes: T4–T8 全部；`createCcloopExecutionPort`（已由 `choosePort` 调）；`controlRepoKey`；`resolveControlOptions`。
- Produces（`src/panel/controlAssembly.ts`）：
  - `ControlRuntime.driver: ExecutionDriver | null`（port `configured` 才非 null）
  - `ControlAssemblyInput.driverCrash?: (point: CrashPoint) => void`（**只给判据用**的故障注入，R1）
  - 关闭顺序（spec §2.1）：停 pump 定时器 → `driver.stop()`（停驱动环定时器并等在飞的步）→ 等在飞的 pump → `applyPanelShutdown({ …, exemptDriverRuns: driver !== null })`
  - `recover()`：`recoverControl(store, port, { handlers }, { driverOwnsWebRuns: driver !== null })` 后 `driver?.kick()`
  - `startPump(ms)` 同时 `driver?.start(ms)`（沿用 `--control-wake-ms`，spec §2.1 控制器决定）；pump 一轮投递过任何 wake 就 `driver?.kick()`；驱动环补过 wake 就 `kickPump()`
  - WebControlService 的 `knownRepository` ＝ 本 panel 的 `--repo` 集合（`controlRepoKey`）

- [ ] **Step 1：造含 T1 的 ccloop build（新目录，不许在旧副本里 pull —— handoff §8.2）**

```bash
S="${SCRATCH:?}"
DEST="$S/ccloop-driver-$(date +%Y%m%d%H%M%S)"
/usr/bin/git clone --local /Users/biran/code/skills/loop/ccloop "$DEST" > "$S/t9-ccloop-clone.log" 2>&1; echo "RC=$?" >> "$S/t9-ccloop-clone.log"
ln -s /Users/biran/code/skills/loop/ccloop/node_modules "$DEST/node_modules"
( cd "$DEST" && npm run build ) > "$S/t9-ccloop-build.log" 2>&1; echo "RC=$?" >> "$S/t9-ccloop-build.log"
/usr/bin/git -C "$DEST" log --oneline -1 > "$S/t9-ccloop-head.txt"
python3 -c "import sys;t=open('$DEST/tests/fixtures/fake-codex.mjs').read();print('SCRIPT_MODE', 'mode===\"script\"' in t)" >> "$S/t9-ccloop-head.txt"
cat "$S/t9-ccloop-clone.log" "$S/t9-ccloop-build.log" "$S/t9-ccloop-head.txt"
echo "export ORCA_CCLOOP_BIN=$DEST/dist/cli.js" > "$S/t9-env.sh"
```

Expected：两个 RC 0；head 是 T1 那一笔（主题行 `feat(control): pin control attempts per run, share objects, script fake codex`）；`SCRIPT_MODE True`。`ORCA_CCLOOP_ADAPTER_CONFIG` 沿用 handoff §8.2 的 fake-codex 配置，但其 `command[1]` 要改指**这个新目录**的 `tests/fixtures/fake-codex.mjs`（新建一份 0600 配置到 `/private/tmp/…`，不改旧的），并写进 `t9-env.sh`。

- [ ] **Step 2：判据 `tests/panel/controlAssemblyDriver.test.ts`（不需要真 ccloop）**

```ts
import { copyFile, chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assembleControlRuntime } from "../../src/panel/controlAssembly.js";
import { resolveControlOptions } from "../../src/panel/controlOptions.js";

// Execution driver spec §2.1: the driver exists only with a configured port; without one the panel is
// byte-for-byte what it was, which includes creating no run or workspace directories.
const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });

async function assembled(configured: boolean) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-assembly-driver-")));
  roots.push(root);
  const repo = join(root, "repo");
  await mkdir(repo);
  const env: NodeJS.ProcessEnv = { ORCA_CONTROL_DIR: join(root, "control") };
  if (configured) {
    // Any executable file and any regular config satisfy the port's construction; nothing is spawned here.
    const binary = join(root, "ccloop");
    await copyFile(resolve("tests/control/fixtures/fake-ccloop-control.mjs"), binary);
    await chmod(binary, 0o700);
    const config = join(root, "adapter.json");
    await writeFile(config, "{}", { mode: 0o600 });
    Object.assign(env, { ORCA_CCLOOP_BIN: binary, ORCA_CCLOOP_ADAPTER_CONFIG: config });
  }
  const { rejection, ...control } = resolveControlOptions([], env, [{ projectKey: "proj", path: repo }]);
  expect(rejection).toBe(null);
  const runtime = await assembleControlRuntime({ control, repos: [{ projectKey: "proj", path: repo }], epoch: "epoch-driver", env });
  if (runtime === null) throw new Error("no runtime");
  return runtime;
}

describe("the execution driver in the panel's assembly (spec §2.1)", () => {
  it("is absent without an execution port, and no run or workspace directory is created", async () => {
    const runtime = await assembled(false); try {
      expect(runtime.driver).toBe(null);
      expect(existsSync(`${runtime.store.stateDir}.runs`)).toBe(false);
      expect(existsSync(`${runtime.store.stateDir}.workspaces`)).toBe(false);
    } finally { runtime.close(); }
  });

  it("is present with a configured port, with its roots created 0700 beside the store directory, and shuts down cleanly", async () => {
    const runtime = await assembled(true);
    expect(runtime.driver).not.toBe(null);
    expect(statSync(`${runtime.store.stateDir}.runs`).mode & 0o777).toBe(0o700);
    expect(statSync(`${runtime.store.stateDir}.workspaces`).mode & 0o777).toBe(0o700);
    expect(runtime.startPump(1_000)).toBe(true);
    expect(await runtime.shutdown()).toBe(true);
    expect(await runtime.shutdown()).toBe(false);
    runtime.close();
  });
});
```

- [ ] **Step 3：判据 `tests/control/executionDriverE2E.test.ts`**

```ts
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { canonicalBytes } from "../../src/control/canonicalJson.js";
import { DriverCrash, type CrashPoint } from "../../src/control/executionDriver.js";
import { readArchivedPlan, readBudgetProposal } from "../../src/control/queries.js";
import { assembleControlRuntime, type ControlRuntime } from "../../src/panel/controlAssembly.js";
import { controlRepoKey, resolveControlOptions } from "../../src/panel/controlOptions.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { profileSnapshot } from "./fixtures/web.js";

/**
 * Execution driver spec §7.2 E1, E2, W1, T1 and R1 against the real ccloop build (ORCA_CCLOOP_BIN, which
 * must contain ccloop changes C1-C3) and its scripted fake codex. Everything is relocated under a
 * temporary root. The honest claim these support (deviation D1): with fake codex, a soft group, and an
 * estimator whose estimate is blocked-capability because contextWindowTokens is null, Web dispatch runs
 * from confirm to settle and lands on orca/<groupId>. Not "Web dispatch works".
 */
const realBinary = process.env.ORCA_CCLOOP_BIN;
const roots: string[] = [];
afterAll(async () => { for (const root of roots) await rm(root, { recursive: true, force: true }); });

const g = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args], { cwd, encoding: "utf8" }).trim();
const sha256 = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

/** ccloop's canonicalHash (ccloop src/control/protocol.ts:172-192): keys sorted by localeCompare, JSON, sha256. */
function ccloopHash(value: unknown): string {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical)
    : item !== null && typeof item === "object"
      ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => [key, canonical(nested)]))
      : item;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

/** What the shipped ccloop answers (pinned in webCcloopSmoke.test.ts); a null window blocks the estimate (D1). */
const CCLOOP_CAPABILITIES = {
  usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable",
  handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null,
} as const;

interface Task { taskId: string; dependsOn?: string[]; targetPaths: string[]; requiredChecks?: string[] }

async function world(tasks: Task[], script: Record<string, { files: Record<string, string> }>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-driver-e2e-")));
  roots.push(root);
  const repo = join(root, "target");
  await mkdir(repo);
  g(repo, "init", "-q", "-b", "main");
  await writeFile(join(repo, "shared.txt"), "base\n");
  g(repo, "add", "shared.txt");
  g(repo, "commit", "-qm", "base");
  const marker = join(root, "codex-marker.json");
  const scriptPath = join(root, "codex-script.json");
  await writeFile(scriptPath, JSON.stringify(script));
  const fakeCodex = resolve(dirname(realBinary!), "..", "tests", "fixtures", "fake-codex.mjs");
  const adapter = { command: [process.execPath, fakeCodex, "script", marker, scriptPath], model: "fixture-model", budgetMode: "soft", sandbox: "workspace-write", timeoutMs: 120_000, killGraceMs: 5_000 };
  const adapterPath = join(root, "adapter.json");
  await writeFile(adapterPath, JSON.stringify(adapter), { mode: 0o600 });
  const contracts = join(root, "contracts");
  await mkdir(contracts);
  const planTasks = [];
  for (const task of tasks) {
    const checks = task.requiredChecks ?? ["true"];
    const contract = {
      objective: { taskId: task.taskId, goal: `write ${task.targetPaths.join(", ")}`, successCondition: "the files hold the scripted text", nonGoals: [] },
      context: { repoPath: repo, targetPaths: task.targetPaths, relevantDocs: [], buildTestCommands: checks, constraints: [] },
      executionPolicy: { autonomyLevel: "L2", maxAttempts: 1, perAttemptTimeoutMs: 120_000, totalRuntimeBudgetMs: 240_000, tokenBudget: 100_000, worktreeRequired: true, partialOutcomeRecoveryWindowMs: 1_000 },
      safetyPolicy: { allowlistPaths: [], denylistPaths: [], maxFilesTouched: 2, humanGateConditions: [] },
      verification: { verifierType: "command", requiredChecks: checks, rejectOn: ["failure"], evidenceRequired: [] },
      escalationAndExit: { escalationTargets: [], pauseOn: [], stopOn: [], terminalStates: ["succeeded", "blocked_waiting_human", "exhausted", "cancelled", "failed"] },
    };
    const path = join(contracts, `${task.taskId}.json`);
    await writeFile(path, canonicalBytes(contract));
    planTasks.push({ taskId: task.taskId, contract: path, dependsOn: task.dependsOn ?? [], targetVersion: 1, configHash: ccloopHash(adapter) });
  }
  const planPath = join(repo, "plan.json");
  await writeFile(planPath, JSON.stringify({ targetRepo: repo, ccloopBin: realBinary, runsDir: join(root, "unused-runs"), workBranch: "orca/unused", policy: "local-merge", ledgerMode: "out-of-repo", goal: "ship", successConditions: ["the files hold the scripted text"], tasks: planTasks }));
  const snapshot = profileSnapshot();
  snapshot.profile.capabilities = { ...CCLOOP_CAPABILITIES };
  const profilePath = join(root, "profile.json");
  await writeFile(profilePath, JSON.stringify(snapshot));
  const repoId = controlRepoKey("e2e");
  const repos = [{ projectKey: "e2e", path: repo }];
  const env: NodeJS.ProcessEnv = { ORCA_CONTROL_DIR: join(root, "control"), ORCA_CCLOOP_BIN: realBinary!, ORCA_CCLOOP_ADAPTER_CONFIG: adapterPath };
  const { rejection, ...control } = resolveControlOptions(["--plan", `plan=${repoId}=${planPath}`, "--profile", profilePath, "--estimator-profile", "all", "--estimate-mode", "soft", "--control-wake-ms", "50"], env, repos);
  if (rejection !== null) throw new Error(rejection);
  let epoch = 0;
  const boot = async (driverCrash?: (point: CrashPoint) => void): Promise<ControlRuntime> => {
    const runtime = await assembleControlRuntime({ control, repos, epoch: `epoch-e2e-${++epoch}`, env, driverCrash });
    if (runtime === null) throw new Error("the control plane did not assemble");
    await runtime.recover();
    return runtime;
  };
  const calls = (): string[] => existsSync(`${marker}.calls`) ? readFileSync(`${marker}.calls`, "utf8").trim().split("\n") : [];
  const human = () => ({ symbolic: g(repo, "symbolic-ref", "HEAD"), head: g(repo, "rev-parse", "HEAD"), index: sha256(join(repo, ".git", "index")), file: readFileSync(join(repo, "shared.txt"), "utf8"), status: g(repo, "status", "--porcelain") });
  return { root, repo, repoId, boot, calls, human };
}

const raw = (runtime: ControlRuntime, commandId: string, verb: string, payload: unknown, target: unknown = { kind: "group", groupId: "g" }) => ({
  schema: "orca-raw-command-v1", commandId, actorId: "human", verb, target, payload,
  // A new group, and a repository setting nobody has set yet, are both at revision 0.
  expectedRevision: verb === "import-plan" || verb === "set-workspace-mode" ? 0 : Number(runtime.store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision),
}) as never;

/** Import, confirm soft, optionally widen the token ceiling, start -- through the assembled service. */
async function startGroup(runtime: ControlRuntime, repoId: string, raiseTokens = 0): Promise<void> {
  const imported = await runtime.service.importPlan(raw(runtime, "import", "import-plan", { groupId: "g", repoId, planId: "plan" }));
  expect(imported).toMatchObject({ result: { kind: "imported", estimateState: "blocked-capability" } });
  const hash = runtime.router.list()[0]!.profileHash;
  const confirmed = runtime.service.confirm(raw(runtime, "confirm", "confirm", {
    planHash: readArchivedPlan(runtime.store, "g").planHash, proposalVersion: readBudgetProposal(runtime.store, "g").proposalVersion, budgetMode: "soft",
    profileIds: { estimator: "all", worker: "all", handoff: "all", goalReview: "all" }, profileHashes: { estimator: hash, worker: hash, handoff: hash, goalReview: hash },
    contextPolicy: { handoffAtContextTokens: null },
  }));
  expect("error" in confirmed ? confirmed.error : "confirmed").toBe("confirmed");
  if (raiseTokens > 0) {
    const limit = readControlGroup(runtime.store, runtime.epoch, "g").ledger.groupLimit;
    const raised = runtime.service.setLimit(raw(runtime, "raise", "set-limit", { limit: { ...limit, tokens: limit.tokens + raiseTokens } }));
    expect("error" in raised ? raised.error : "raised").toBe("raised");
  }
  const started = await runtime.service.start(raw(runtime, "start", "start", {}));
  expect("error" in started ? started.error : "started").toBe("started");
}

interface RunRow { runId: string; task: string; body: Record<string, any> }
const workRuns = (runtime: ControlRuntime): RunRow[] => runtime.store.db.prepare("SELECT id,work_item_id,body FROM runs WHERE group_id='g' ORDER BY id").all()
  .map((row) => ({ runId: String(row.id), task: String(row.work_item_id), body: JSON.parse(String(row.body)) }))
  .filter((row) => row.body.phase === "work");
const workStatus = (runtime: ControlRuntime, taskId: string): string =>
  JSON.parse(String(runtime.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body)).status;

async function until(predicate: () => boolean, ms: number, what: string, poll = 100): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, poll));
  }
}

/** A run that stopped moving on its own is a failure to report by its reason, not a timeout to wait out. */
function noBlocked(runtime: ControlRuntime): void {
  const blocked = workRuns(runtime).filter((run) => run.body.state === "blocked");
  if (blocked.length > 0) throw new Error(`blocked: ${blocked.map((run) => `${run.task}=${run.body.drive?.blockedReason}`).join(", ")}`);
}

describe.skipIf(!realBinary)("the execution driver against real ccloop (spec §7.2)", { timeout: 420_000 }, () => {
  it("E1: three tasks, two in conflict and one dependent, from confirm to settle on orca/<group>, spending no more than planned", async () => {
    const w = await world([
      { taskId: "a", targetPaths: ["shared.txt"] }, { taskId: "b", targetPaths: ["shared.txt"] }, { taskId: "c", dependsOn: ["a"], targetPaths: ["c.txt"] },
    ], {
      a: { files: { "shared.txt": "A\n" } }, b: { files: { "shared.txt": "B\n" } }, c: { files: { "c.txt": "C\n" } },
      "reconcile-a-b": { files: { "shared.txt": "A\nB\n" } }, "reconcile-b-a": { files: { "shared.txt": "A\nB\n" } },
    });
    const before = w.human();
    const runtime = await w.boot();
    // Deviation D12: the default reserve cannot afford a reconciliation until another run settles.
    await startGroup(runtime, w.repoId, 10_000_000);
    runtime.startPump(50);
    await until(() => { noBlocked(runtime); return ["a", "b", "c"].every((id) => workStatus(runtime, id) === "done") && workRuns(runtime).every((run) => run.body.drive?.cleanedUp === true); }, 360_000, "every task to settle");
    const runs = workRuns(runtime);
    expect(runs.map((run) => run.body.state)).toEqual(["settled", "settled", "settled"]);
    expect(readControlGroup(runtime.store, runtime.epoch, "g").runs.map((run) => run.state)).toEqual(["settled-recoverable", "settled-recoverable", "settled-recoverable"]);
    expect(g(w.repo, "show", "refs/heads/orca/g:shared.txt")).toBe("A\nB");
    expect(g(w.repo, "show", "refs/heads/orca/g:c.txt")).toBe("C");
    const reconciled = runs.filter((run) => run.body.drive.reconcile !== null);
    expect(reconciled).toHaveLength(1);
    expect(readdirSync(`${runtime.store.stateDir}.workspaces`).filter((name) => name.startsWith("reconcile-"))).toHaveLength(1);
    expect(g(w.repo, "log", "-1", "--format=%s", reconciled[0]!.body.drive.landedCommit)).toMatch(/^orca: land run-.* \(reconciled with [ab]\)$/);
    const a = runs.find((run) => run.task === "a")!, c = runs.find((run) => run.task === "c")!;
    expect(() => g(w.repo, "merge-base", "--is-ancestor", a.body.drive.landedCommit, c.body.drive.base)).not.toThrow();
    // Four ccloop runs (three tasks, one reconciliation), each plan/execute/verify once.
    expect(w.calls()).toHaveLength(12);
    expect(w.human()).toEqual(before);
    expect(runtime.store.dispatchBlocked).toBe(false);
    expect(await runtime.shutdown()).toBe(true);
    runtime.close();
  });

  it.each(["worktree", "clone"] as const)("E2/W1: in %s mode the run's workspace exists while it runs and is gone once it settles", async (mode) => {
    const w = await world([{ taskId: "a", targetPaths: ["shared.txt"] }], { a: { files: { "shared.txt": "A\n" } } });
    const runtime = await w.boot();
    if (mode === "clone") {
      const set = await runtime.service.setWorkspaceMode(raw(runtime, "mode", "set-workspace-mode", { workspaceMode: "clone" }, { kind: "repository", repoId: w.repoId }));
      expect(set).toMatchObject({ result: { kind: "workspace-mode-set", workspaceMode: "clone" } });
    }
    await startGroup(runtime, w.repoId);
    runtime.startPump(50);
    let seen = false;
    await until(() => {
      noBlocked(runtime);
      const run = workRuns(runtime)[0];
      const drive = run?.body.drive;
      if (drive?.prepared === true && run!.body.state !== "settled") {
        expect(drive.workspaceMode).toBe(mode);
        if (mode === "worktree") expect(g(w.repo, "worktree", "list", "--porcelain").split("\n")).toContain(`worktree ${drive.workspacePath}`);
        else expect(statSync(join(drive.workspacePath, ".git")).isDirectory()).toBe(true);
        seen = true;
      }
      return seen && drive?.cleanedUp === true;
    }, 240_000, "the run to settle", 20);
    const drive = workRuns(runtime)[0]!.body.drive;
    expect(existsSync(drive.workspacePath)).toBe(false);
    const registered = g(w.repo, "worktree", "list", "--porcelain").split("\n").filter((line) => line.startsWith("worktree "));
    expect(registered).toEqual([`worktree ${w.repo}`]);
    expect(await runtime.shutdown()).toBe(true);
    runtime.close();
  });

  it("T1: a run whose checks fail ends blocked by its terminal, and orca/<group> does not move", async () => {
    const w = await world([{ taskId: "a", targetPaths: ["shared.txt"], requiredChecks: ["false"] }], { a: { files: { "shared.txt": "A\n" } } });
    const runtime = await w.boot();
    await startGroup(runtime, w.repoId);
    runtime.startPump(50);
    await until(() => workRuns(runtime)[0]?.body.state === "blocked", 240_000, "the run to block");
    const drive = workRuns(runtime)[0]!.body.drive;
    expect(drive.blockedAt).toBe("C");
    expect(drive.blockedReason).toMatch(/^terminal:(failed|exhausted|blocked_waiting_human|cancelled)$/);
    expect(g(w.repo, "rev-parse", "refs/heads/orca/g")).toBe(g(w.repo, "rev-parse", "main"));
    expect(await runtime.shutdown()).toBe(true);
    runtime.close();
  });

  it.each(["A2-after-workspace", "B-after-accept", "C-after-terminal", "D-after-cas", "E-after-acceptance"] as const)(
    "R1 %s: a death between an external action and its record ends where a clean run ends, spending no more", async (point) => {
      const w = await world([{ taskId: "a", targetPaths: ["shared.txt"] }], { a: { files: { "shared.txt": "A\n" } } });
      const first = await w.boot((at) => { if (at === point) throw new DriverCrash(at); });
      await startGroup(first, w.repoId);
      first.startPump(50);
      await until(() => first.driver?.crashed === point, 240_000, `the crash at ${point}`);
      first.close();
      const second = await w.boot();
      expect(second.store.dispatchBlocked).toBe(false);
      second.startPump(50);
      await until(() => { noBlocked(second); return workStatus(second, "a") === "done" && workRuns(second)[0]?.body.drive?.cleanedUp === true; }, 240_000, "the run to settle after the restart");
      expect(w.calls()).toEqual(["plan", "execute", "verify"]);
      expect(readdirSync(`${second.store.stateDir}.runs`)).toHaveLength(1);
      expect(g(w.repo, "show", "refs/heads/orca/g:shared.txt")).toBe("A");
      expect(second.store.dispatchBlocked).toBe(false);
      expect(await second.shutdown()).toBe(true);
      second.close();
    });
});
```

（计数：E1 1 ＋ E2/W1 2 ＋ T1 1 ＋ R1 5 ＝ 9；`controlAssemblyDriver` 2。）

⚠️ 若 T1 的真实终态不在正则四值里（例如 worker 自己报错、永远不给 candidate），**停下报告实测**，不许改正则迁就；在台账里记下真实字面量。
⚠️ E2 的「运行中看见工作区」用 20ms 轮询；ccloop 一次 control run 起 worker＋三阶段 fake codex，实测应在秒级。若仍抓不到（`seen` 恒 false ⇒ 超时），报告实测时长，**不许把断言删掉**。

- [ ] **Step 4：跑，看见红**（带 env）

```bash
cd /Users/biran/code/skills/loop/Orca
S="${SCRATCH:?}"; source "$S/t9-env.sh"
./node_modules/.bin/vitest run tests/panel/controlAssemblyDriver.test.ts tests/control/executionDriverE2E.test.ts > "$S/t9-red.log" 2>&1; echo "RC=$?" >> "$S/t9-red.log"; cat "$S/t9-red.log"
```

预言：`controlAssemblyDriver` 两条红（`runtime.driver` 是 undefined；第一条 `toBe(null)` 红）；E2E 九条红（无驱动环 ⇒ run 停在 `starting` ⇒ `until` 超时；R1 红在 `crashed` 读 undefined）。**E2E 若显示 skipped，说明 env 没带上 —— 停下，不许当红证。**

- [ ] **Step 5：`src/panel/controlAssembly.ts`**

import 区加：

```ts
import { createExecutionDriver, type CrashPoint, type ExecutionDriver } from "../control/executionDriver.js";
import { controlWorkspaceRoots } from "../control/workspace.js";
```

`ControlRuntime`（`:70-95`）在 `epoch: string;` 之后加：

```ts
  /** Execution driver spec §2.1: present only when an execution port is configured. */
  driver: ExecutionDriver | null;
```

`ControlAssemblyInput`（`:97-102`）加：

```ts
  /** Test-only fault injection for the execution driver (spec §7.2 R1). Never set by the CLI. */
  driverCrash?: (point: CrashPoint) => void;
```

`new WebControlService({…})`（`:189`）的参数对象里，`trustedConfig: config,` 之后加：

```ts
    knownRepository: (repoId: string) => repos.some((repo) => controlRepoKey(repo.projectKey) === repoId),
```

pump（`:208-218`）换成（在它之前先声明 `let driver: ExecutionDriver | null = null;`）：

```ts
  let driver: ExecutionDriver | null = null;
  let inFlight: Promise<void> | null = null;
  const pump = (): Promise<void> => {
    if (inFlight !== null) return inFlight;
    // Through the admission gate like every other write, so a pass cannot slip a claim past a
    // shutdown that has already begun draining.
    const pass = withAdmission({ admissionGate }, () => deliverSchedulerWakes(store, wakeHandlers))
      // A delivered wake is a claimed run the driver can now start (spec §2.1).
      .then((delivery) => { if (delivery.delivered.length > 0) driver?.kick(); }, () => undefined)
      .finally(() => { inFlight = null; });
    inFlight = pass;
    return pass;
  };

  // Execution driver spec §2.1: only with a configured port. Unconfigured, nothing here runs and no
  // directory is created, so the panel is what it was before this slice.
  if (control.executionPort === "configured") {
    driver = createExecutionDriver({
      store, router, admissionGate, roots: controlWorkspaceRoots(store.stateDir),
      resolveRepository: (repoId) => config.resolveRepository(repoId),
      ccloopBin: env.ORCA_CCLOOP_BIN!, adapterConfigPath: env.ORCA_CCLOOP_ADAPTER_CONFIG!,
      kickPump: () => { void pump(); }, crash: input.driverCrash,
    });
  }
```

（原注释块 `// spec §6. One pass at a time…` 保留在 `let inFlight` 之上，逐字不动。）

返回对象（`:228-250`）：`store, config, …, epoch,` 之后加 `driver,`；`recover` 换成：

```ts
    recover: async () => {
      await recoverControl(store, port, { handlers: wakeHandlers }, { driverOwnsWebRuns: driver !== null });
      driver?.kick();
    },
```

`shutdown()` 里 `stopTimer();` 之后、`shutdownRun = …` 那一句换成：

```ts
      // Execution driver spec §2.1: the driver's timer stops and its step in flight finishes first, then
      // the pump's pass, then the shutdown is written -- freezing no run the driver owns (spec §4).
      shutdownRun = (async () => {
        await driver?.stop();
        await inFlight;
        await applyPanelShutdown({ store, profileRouter: router, admissionGate, epoch, shutdownGraceMs: config.shutdownGraceMs, exemptDriverRuns: driver !== null });
        return true;
      })();
```

`startPump` 里 `timer.unref();` 之后加 `driver?.start(intervalMs);`；`close` 换成 `close: () => { stopTimer(); void driver?.stop(); store.close(); },`。

- [ ] **Step 6：看见绿，回归装配／关闭既有判据**

```bash
cd /Users/biran/code/skills/loop/Orca
S="${SCRATCH:?}"; source "$S/t9-env.sh"
npm run typecheck > "$S/t9-tsc.log" 2>&1; echo "RC=$?" >> "$S/t9-tsc.log"
./node_modules/.bin/vitest run tests/panel/controlAssemblyDriver.test.ts tests/control/executionDriverE2E.test.ts --reporter=json --outputFile="$S/t9-green.json" > "$S/t9-green.log" 2>&1; echo "RC=$?" >> "$S/t9-green.log"
./node_modules/.bin/vitest run tests/panel/controlStartup.test.ts tests/panel/controlShutdown.test.ts tests/panel/controlMount.test.ts tests/panel/controlConfigPort.test.ts > "$S/t9-regress.log" 2>&1; echo "RC=$?" >> "$S/t9-regress.log"
python3 -c "import json;d=json.load(open('$S/t9-green.json'));print('pending',d['numPendingTests'],'failed',d['numFailedTests'],'passed',d['numPassedTests'])" >> "$S/t9-green.log"
cat "$S/t9-tsc.log" "$S/t9-green.log" "$S/t9-regress.log"
```

Expected：RC 0；`pending 0 failed 0 passed 11`；装配与关闭的既有判据照绿（SIGTERM 那条 flake 先单文件重跑）。

- [ ] **Step 7：提交**

```bash
cd /Users/biran/code/skills/loop/Orca
/usr/bin/git add src/panel/controlAssembly.ts tests/panel/controlAssemblyDriver.test.ts tests/control/executionDriverE2E.test.ts
/usr/bin/git commit -F "${SCRATCH:?}/t9-msg.txt"
```

`t9-msg.txt`：

```
feat(panel): run the execution driver beside the wake pump

A panel with a configured execution port now owns an execution driver on the
same wake interval: recovery leaves Web work runs to it, a delivered wake
kicks it, a re-armed wake kicks the pump, and a shutdown stops it and waits for
its step in flight before freezing any stop, freezing none for its runs. An
unconfigured panel is unchanged. Against the real ccloop build with scripted
fake codex, three tasks (two in conflict, one dependent) run from confirm to
settle on orca/<group>, in worktree and clone modes, and survive a death at
each of five external-action boundaries without spending more.

Co-Authored-By: <implementer's own model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR
```

**变异**（变异席的副本要带 `ORCA_CCLOOP_BIN`；E2E 慢，每条只跑它点名的那几条，`-t` 过滤写全名）

| V | 变异 | 喂它的场景 | 期望红（且仅） |
|---|---|---|---|
| T9-M1 | `if (control.executionPort === "configured")` → `if (false)` | 装配 | `is present with a configured port …` ＋ E2E 全部 9 条 |
| T9-M2 | 条件改成恒 `true`（unconfigured 也建） | 无 port | `is absent without an execution port …`（目录被建 —— 注：unconfigured 的 `env.ORCA_CCLOOP_BIN!` 为 undefined，`controlWorkspaceRoots` 仍会建目录） |
| T9-M3 | `recover` 里 `{ driverOwnsWebRuns: driver !== null }` → `{}` | R1 重启 | R1 五条（第二次 boot 后 `dispatchBlocked` 为 true） |
| T9-M4 | `shutdown` 里 `exemptDriverRuns: driver !== null` → 删 | 无 | **预言不红**：本 Task 的判据 shutdown 时 run 都已 settled（`active=0`），没有可冻结的 run。登记；该开关的承重判据是 T8 的 `freezes no driver-owned run …`（直调） |
| T9-M5 | `shutdown` 里删 `await driver?.stop();` | 无 | **预言不红**（同上：shutdown 时无在飞步）。登记为「本 Task 无独占判据」；T4 的 `stop() waits …` 钉的是 `stop` 本身，不是装配顺序 —— 报控制器 |
| T9-M6 | `startPump` 删 `driver?.start(intervalMs);` | 任何 E2E | E2E 9 条（驱动环只在 recover 时踢一次，之后不动 ⇒ 超时）—— 不独占于某一条 |
| T9-M7 | pump 的 `.then` 删 `driver?.kick()` | 任何 E2E | **预言不红**：驱动环自己有定时器兜底，只是慢一个间隔。登记为性能而非正确性分支 |
| T9-M8 | `knownRepository` 恒 `() => false` | clone 模式 | `E2/W1: in clone mode …`（`set-workspace-mode` 被拒） |

---

## Task 10：面板 UI —— 工作区方式选择、blocked 原因显示（`web/`）

**Files:**
- Create: `web/src/WorkspaceModeSelector.tsx`、`web/tests/workspaceMode.test.tsx`
- Modify: `web/src/controlApi.ts`（两个导出）、`web/src/ControlPanel.tsx`（两个可选 prop ＋ 渲染）、`web/src/ControlGroupView.tsx:93`（原因）、`web/src/App.tsx`（状态、读取、发送）

**Interfaces:**
- Consumes: T2 的 `RepositoryWorkspaceV1`（`web/src/controlTypes.ts`）与 `RunViewV1.blockedReason?`；HTTP `GET /api/control/repositories/:repoId/workspace`、`POST …/workspace-mode`；既有 `controlGet`（`controlApi.ts:64`，模块内）、`sendControlCommand`、`refusalFromAnswer`、`nextCommandId`。
- Produces：`fetchRepositoryWorkspace(repoId): Promise<RepositoryWorkspaceV1>`、`workspaceModePath(repoId): string`；`WorkspaceModeSelector(props: { workspace: RepositoryWorkspaceV1; onChange(mode, expectedRevision): void })`；`ControlPanelProps.workspace?: RepositoryWorkspaceV1 | null`、`ControlPanelProps.onWorkspaceMode?: (mode, expectedRevision) => void`（可选：既有 web 判据的 `panelProps` 不用改）。
- ⚠️ vitest `environment: "node"` ＋ `renderToStaticMarkup` 下 `useEffect` 不跑（handoff §7.4）⇒ 判据只量静态渲染；`App.tsx` 的读取／发送接线**没有**判据能量，登记为「只由 ws check 的 tsc 与人工看」。

- [ ] **Step 1：判据 `web/tests/workspaceMode.test.tsx`**

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceModeSelector } from "../src/WorkspaceModeSelector.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import type { Amount, ControlConfigV1, GroupViewV1, RunViewV1 } from "../src/controlTypes.js";

// Execution driver spec §3.2 (the mode is changeable on the Web) and §2.3 (a blocked run shows why).
const amount = (tokens: number): Amount => ({ tokens, activeMs: tokens * 10, attempts: 1, sessions: 1 });
const capability = { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null } as const;
const config: ControlConfigV1 = {
  schema: "orca-control-config-v1", epoch: "epoch-a", repositories: [{ repoId: "orca", displayName: "Orca" }],
  plans: [{ planId: "plan-demo", repoId: "orca", displayName: "Demo plan" }],
  profiles: [{ profileId: "all", profileHash: "b".repeat(64), allowedWorkKinds: ["task", "budget-estimate", "handoff", "goal-review"], contextTokenizer: null, workMaxOutputTokens: 1000, declared: capability, observed: capability, observedAt: "2026-09-25T00:00:00.000Z", probeFailureCode: null }],
  defaults: { estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" }, executionPort: "configured", errorCatalog: [],
};
const run = (over: Partial<RunViewV1>): RunViewV1 => ({
  runId: "run-a", taskId: "a", estimateId: null, generation: 1, state: "running", phase: "work", claimOrdinal: 1, providerAttemptOrdinal: 1,
  profile: { profileId: "all", profileHash: "b".repeat(64) }, used: amount(10), remaining: amount(90), failureCode: null, evidenceIds: [], ...over,
});
const view = (runs: RunViewV1[]): GroupViewV1 => ({
  schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 4,
  summary: { groupId: "g", state: "ready", commandRevision: 6, projectionSeq: 4, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 },
  graphVersion: 1, plan: { repoId: "orca", planId: "plan-demo", planHash: "a".repeat(64), goal: "Ship", successConditions: ["done"] },
  proposal: { state: "confirmed", proposalVersion: 2, planHash: "a".repeat(64), budgetMode: "soft", contextPolicy: { handoffAtContextTokens: null }, profiles: {
    estimator: { profileId: "all", profileHash: "b".repeat(64) }, worker: { profileId: "all", profileHash: "b".repeat(64) },
    handoff: { profileId: "all", profileHash: "b".repeat(64) }, goalReview: { profileId: "all", profileHash: "b".repeat(64) } }, executionSnapshotHash: "c".repeat(64) },
  ledger: { groupLimit: amount(9_000_000), used: amount(10), committedRemaining: amount(3_000_000), explicitUnallocatedReserve: amount(5_999_990), budgetDeficit: amount(0), usageUnknown: false },
  allocations: [], workItems: [], estimates: [], runs, checkpoints: [], handoffRequests: [], stop: null, recoveryBlockers: [], recentCommandIds: [],
});
const renderGroup = (runs: RunViewV1[]) => renderToStaticMarkup(
  <ControlGroupView view={view(runs)} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />,
);

describe("workspace mode selector (execution driver §3.2)", () => {
  it("offers both modes with the current one checked, and says the change only reaches runs that start later", () => {
    const html = renderToStaticMarkup(<WorkspaceModeSelector workspace={{ schema: "orca-repository-workspace-v1", repoId: "orca", workspaceMode: "clone", revision: 3 }} onChange={vi.fn()} />);
    expect(html).toMatch(/<input[^>]*value="clone"[^>]*checked=""/);
    expect(html).not.toMatch(/<input[^>]*value="worktree"[^>]*checked=""/);
    expect(html).toContain("setting revision 3");
    expect(html).toContain("Runs already started keep theirs.");
  });
});

describe("a blocked run in the group view (execution driver §2.3)", () => {
  it("shows the reason next to the blocked state", () => {
    const html = renderGroup([run({ state: "blocked", blockedReason: "inspect-unknown" })]);
    expect(html).toContain("blocked — inspect-unknown");
  });

  it("shows no reason for a run that is not blocked, even from a view that omits the field", () => {
    const html = renderGroup([run({ state: "running" })]);
    expect(html).not.toContain("— undefined");
    expect(html).not.toContain("— null");
    expect(html).toContain("running");
  });
});
```

（计数：3 条。）

- [ ] **Step 2：跑，看见红** —— 预言：整文件红在 import（`WorkspaceModeSelector.js` 不存在）。

```bash
cd /Users/biran/code/skills/loop/Orca/web
../node_modules/.bin/vitest run tests/workspaceMode.test.tsx > "${SCRATCH:?}/t10-red.log" 2>&1; echo "RC=$?" >> "${SCRATCH:?}/t10-red.log"; cat "${SCRATCH:?}/t10-red.log"
```

（`web/` 的 vitest 入口以 `web/package.json` 的 test 脚本为准；若它不是 `../node_modules/.bin/vitest`，照 `npm run --ws check` 用的那一条跑，并在报告里写明用的是哪条。）

- [ ] **Step 3：实现**

`web/src/WorkspaceModeSelector.tsx`（新）：

```tsx
import type { JSX } from "react";
import type { RepositoryWorkspaceV1 } from "./controlTypes.js";

/**
 * Execution driver spec §3.2: how a repository's runs get their workspace. The server holds the value
 * and its revision; this only names the choice and the revision it was read at, and the change reaches
 * only runs that start afterwards.
 */
export function WorkspaceModeSelector(props: { workspace: RepositoryWorkspaceV1; onChange: (mode: "worktree" | "clone", expectedRevision: number) => void }): JSX.Element {
  const { workspace } = props;
  return (
    <section aria-label="Workspace mode">
      <h3>Workspace mode</h3>
      <p>
        New runs in {workspace.repoId} use {workspace.workspaceMode === "worktree" ? "a git worktree" : "a private clone"} (setting
        revision {workspace.revision}). Runs already started keep theirs.
      </p>
      {(["worktree", "clone"] as const).map((mode) => (
        <label key={mode}>
          <input
            type="radio"
            name={`workspace-mode-${workspace.repoId}`}
            value={mode}
            checked={workspace.workspaceMode === mode}
            onChange={() => props.onChange(mode, workspace.revision)}
          />
          {mode === "worktree" ? "git worktree (default)" : "private clone"}
        </label>
      ))}
    </section>
  );
}
```

⚠️ JSX 里 `setting` 与 `revision {workspace.revision}` 之间的换行在 SSR 输出里是一个空格 —— 判据断言的是 `setting revision 3`。写完先跑判据，若空白不对，把这两段写在同一行，**不改判据**。

`web/src/controlApi.ts`：import 类型区加 `RepositoryWorkspaceV1`；`fetchRunEvidence` 之后加：

```ts
/** Execution driver spec §3.2: a trusted repository's workspace mode and the revision it is at. */
export const fetchRepositoryWorkspace = (repoId: string): Promise<RepositoryWorkspaceV1> =>
  controlGet<RepositoryWorkspaceV1>(`/api/control/repositories/${segment(repoId)}/workspace`);

export const workspaceModePath = (repoId: string): string => `/api/control/repositories/${segment(repoId)}/workspace-mode`;
```

`web/src/ControlPanel.tsx`：import 加 `import { WorkspaceModeSelector } from "./WorkspaceModeSelector.js";`，类型 import 加 `RepositoryWorkspaceV1`；`ControlPanelProps` 末尾加：

```ts
  /** Execution driver spec §3.2: the first trusted repository's workspace mode, once read. */
  workspace?: RepositoryWorkspaceV1 | null;
  onWorkspaceMode?: (mode: "worktree" | "clone", expectedRevision: number) => void;
```

`<ImportForm … />` 之后加：

```tsx
      {props.workspace && props.onWorkspaceMode && <WorkspaceModeSelector workspace={props.workspace} onChange={props.onWorkspaceMode} />}
```

`web/src/ControlGroupView.tsx:93` 那一行之后加一行：

```tsx
                {run.blockedReason ? ` — ${run.blockedReason}` : ""}
```

`web/src/App.tsx`：`./controlApi.js` 的 import 列表加 `fetchRepositoryWorkspace,` 与 `workspaceModePath,`；类型 import 行改为 `import type { ControlConfigV1, RepositoryWorkspaceV1 } from "./controlTypes.js";`；`const [controlConfig, …]` 之后加：

```tsx
  /** Execution driver spec §3.2: the first trusted repository's workspace mode, null until read. */
  const [workspace, setWorkspace] = useState<RepositoryWorkspaceV1 | null>(null);
```

`sendControl` 之后加：

```tsx
  /** Name the choice under the revision it was read at; whatever the server says is read back, not assumed. */
  const sendWorkspaceMode = async (mode: "worktree" | "clone", expectedRevision: number): Promise<void> => {
    if (workspace === null) return;
    const scope = `@repository:${workspace.repoId}`;
    const answer = await sendControlCommand(workspaceModePath(workspace.repoId), { commandId: nextCommandId(), expectedRevision, payload: { workspaceMode: mode } });
    if (answer.kind === "uncertain") dispatchControl({ type: "refusal", groupId: scope, value: answer.refusal });
    else if (answer.status >= 400) dispatchControl({ type: "refusal", groupId: scope, value: refusalFromAnswer(answer) });
    try { setWorkspace(await fetchRepositoryWorkspace(workspace.repoId)); } catch { /* the refusal above already says why */ }
  };
```

`useEffect(() => { if (controlConfig === null) return; …`（`[controlConfig]` 那个）里，`void readControlTick();` 之前加：

```tsx
    const repoId = controlConfig.repositories[0]?.repoId;
    if (repoId !== undefined) void fetchRepositoryWorkspace(repoId).then(setWorkspace, () => setWorkspace(null));
```

`<ControlPanel` 的 props 里 `onCommand={…}` 之后加：

```tsx
          workspace={workspace}
          onWorkspaceMode={(mode, revision) => { void sendWorkspaceMode(mode, revision); }}
```

⚠️ `dispatchControl({ type: "refusal", groupId, value })` 的 action 形状以 `web/src/controlState.ts` 的 reducer 为准（`sendControl` 里就这么用）；若 `groupId` 被 reducer 用来索引某个组而 `@repository:*` 会出错，**停下报告**，不许改 reducer。

- [ ] **Step 4：看见绿，跑 web 门**

```bash
cd /Users/biran/code/skills/loop/Orca
S="${SCRATCH:?}"
( cd web && ../node_modules/.bin/vitest run ) > "$S/t10-web.log" 2>&1; echo "RC=$?" >> "$S/t10-web.log"
npm run build --workspace web > "$S/t10-build.log" 2>&1; echo "RC=$?" >> "$S/t10-build.log"
npm run --ws check > "$S/t10-ws.log" 2>&1; echo "RC=$?" >> "$S/t10-ws.log"
cat "$S/t10-web.log" "$S/t10-build.log" "$S/t10-ws.log"
```

Expected：三个 RC 0；web 全套含新 3 条全绿；既有 web 判据一条不改。

- [ ] **Step 5：提交**

```bash
cd /Users/biran/code/skills/loop/Orca
/usr/bin/git add web/src/WorkspaceModeSelector.tsx web/src/controlApi.ts web/src/ControlPanel.tsx web/src/ControlGroupView.tsx web/src/App.tsx web/tests/workspaceMode.test.tsx
/usr/bin/git commit -F "${SCRATCH:?}/t10-msg.txt"
```

`t10-msg.txt`：

```
feat(web): choose a repository's workspace mode and see why a run is blocked

The control panel reads the first trusted repository's workspace mode and
offers worktree or clone under the revision it read, saying the change only
reaches runs that start afterwards; a blocked run shows its reason next to its
state.

Co-Authored-By: <implementer's own model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR
```

**变异**

| V | 变异 | 喂它的场景 | 期望红（且仅） |
|---|---|---|---|
| T10-M1 | `checked={workspace.workspaceMode === mode}` → `checked={mode === "worktree"}` | 当前是 clone | `offers both modes with the current one checked …` |
| T10-M2 | `ControlGroupView.tsx` 删新加的那一行 | blocked run | `shows the reason next to the blocked state` |
| T10-M3 | 那一行改成 `{` — ${run.blockedReason}`}`（无条件） | 非 blocked run | `shows no reason for a run that is not blocked …` |

---

## Task 11：收口 —— 变异台账、全套门、判定器

**Files:**
- Create（`git add -f` **单独**加）: `.superpowers/sdd/2026-09-25-execution-driver/progress.md`
- Create（scratchpad，**不入库**）: `check-driver.py`、`gates-driver.sh`

- [ ] **Step 1：判定器 `check-driver.py`**（放 scratchpad；形状照缝 B 的 `check-seamb.py`）

```python
# check-driver.py <vitest-json>  -- execution driver round (spec docs/superpowers/specs/2026-09-25-execution-driver-design.md)
import json, sys
d = json.load(open(sys.argv[1]))
FLAKE = {"a real SIGTERM to a real panel makes it exit cleanly, having written one shutdown row for its epoch"}
# Every new criterion file of this round, with the exact number of criteria it must report, all passed.
EXPECTED = {
    "tests/control/driveRecord.test.ts": 15,
    "tests/control/workspaceSettings.test.ts": 7,
    "tests/panel/workspaceModeApi.test.ts": 2,
    "tests/control/workspace.test.ts": 11,
    "tests/control/executionDriver.test.ts": 17,
    "tests/control/driverLanding.test.ts": 4,
    "tests/control/driverReconcile.test.ts": 14,
    "tests/control/driverSettle.test.ts": 7,
    "tests/control/driverRecovery.test.ts": 7,
    "tests/panel/controlAssemblyDriver.test.ts": 2,
    "tests/control/executionDriverE2E.test.ts": 9,
}
problems = []
if d["numPendingTests"] or d["numTodoTests"]:
    problems.append(f"pending={d['numPendingTests']} todo={d['numTodoTests']}")
for suffix, count in EXPECTED.items():
    rows = [a for f in d["testResults"] if f["name"].endswith(suffix) for a in f["assertionResults"]]
    if len(rows) != count or any(a["status"] != "passed" for a in rows):
        problems.append(f"{suffix}: expected {count} passed, got {[a['status'] for a in rows]}")
failed = {a["fullName"] for f in d["testResults"] for a in f["assertionResults"] if a["status"] == "failed"}
if not failed <= FLAKE:
    problems.append(f"unexpected failures={sorted(failed - FLAKE)}")
print("OK" if not problems else "\n".join(problems))
sys.exit(1 if problems else 0)
```

红证（**必须先看见它退 1**）：拿本会话开头那份改动前的全套 json（`scratchpad/gates/test.json`，缝 B 收尾时的全绿 json）喂它 —— 新文件全缺 ⇒ 十一行 `expected N passed, got []` ⇒ RC 1。再造一份把其中一条新判据改成 `"failed"` 的 json 喂它 ⇒ RC 1（`unexpected failures` 与该文件那一行）。两次 RC 与输出整份记进台账。

- [ ] **Step 2：全套门**（逐段单跑，每段各取 RC，全部重定向到文件再整份读回；**不许**用 `npm run verify` 的 `&&` 链 —— handoff §6.9）

`gates-driver.sh`（照 scratchpad 的 `gates.sh` 形状）：

```bash
#!/bin/bash
S="${SCRATCH:?set SCRATCH to the session scratchpad}"
source "$S/t9-env.sh"
cd /Users/biran/code/skills/loop/Orca
G="$S/gates/driver"; mkdir -p "$G"
run() { name=$1; shift; "$@" > "$G/$name.log" 2>&1; echo "$name RC=$?" >> "$G/summary.txt"; }
: > "$G/summary.txt"
run typecheck npm run typecheck
run test ./node_modules/.bin/vitest run --reporter=json --outputFile="$G/test.json"
run check-driver python3 "$S/check-driver.py" "$G/test.json"
run verify-control npm run verify:control
run web-control npm run verify:web-control
run web-control-consumer npm run verify:web-control:consumer
run scheduler npm run verify:scheduler
run chain npm run verify:chain
run web-build npm run build --workspace web
run panel npm run verify:panel
run ws-check npm run --ws check
run claude-md node scripts/check-claude-md-lines.mjs
run hooks-path node scripts/check-hooks-path.mjs
run ledger npm run ledger -- validate .decisions
C=/Users/biran/code/skills/loop/ccloop
( cd "$C" && npm run typecheck ) > "$G/ccloop-typecheck.log" 2>&1; echo "ccloop-typecheck RC=$?" >> "$G/summary.txt"
( cd "$C" && npm run build ) > "$G/ccloop-build.log" 2>&1; echo "ccloop-build RC=$?" >> "$G/summary.txt"
( cd "$C" && ./node_modules/.bin/vitest run --reporter=json --outputFile="$G/ccloop.json" ) > "$G/ccloop-test.log" 2>&1; echo "ccloop-test RC=$?" >> "$G/summary.txt"
( cd "$C" && node scripts/check-known-reds.mjs "$G/ccloop.json" ) > "$G/ccloop-known-reds.log" 2>&1; echo "ccloop-known-reds RC=$?" >> "$G/summary.txt"
echo DONE >> "$G/summary.txt"
```

判定（spec §7.1）：`typecheck`、`check-driver`、`verify-control`、`web-control`、`web-control-consumer`、`scheduler`、`chain`、`web-build`、`panel`、`ws-check`、`claude-md`、`hooks-path` 逐段 RC 0；`ledger` RC ∈ {0,2}；`test` 的 RC 允许非 0 **仅当** `check-driver` 为 0（失败 ⊆ 那条 SIGTERM flake；见红先单文件重跑 `tests/panel/controlShutdown.test.ts`，绿了就记为 flake）；ccloop：`typecheck`、`build` RC 0，`known-reds` RC 0。`summary.txt` 与每段日志**整份读回**，结果（只抄工具报数：文件数、条数、RC）写进台账。
⚠️ `verify:control` 会跑 `tests/control` 全部，含 E2E（慢）；Bash 给 600000 ms 或放后台，**RC 写进日志文件再读回，不读后台通知的退出码**（handoff §6.8）。

- [ ] **Step 3：变异电池**（**单独的变异席**，不是写实现的那一席 —— handoff §6.4）

在 Orca 与 ccloop 各一个 `git clone --local` 副本里（软链 `node_modules`，Orca 副本另软链 `web/node_modules`；E2E 相关变异要 `source t9-env.sh`），逐条跑 T1–T10 各自的变异表：
1. 每组先跑一次**绿基线**（该组判据文件），RC 0 才往下；
2. 每条：`shasum -a 256` 记前值 → python 整行锚点替换、断言命中 == 1 → 记后值（**相等当场停**）→ 跑「期望红」列的文件（E2E 用 `-t` 全名过滤）→ 记红在哪几条 → `cat` 原文件还原 → `shasum` 等于前值；
3. 实测与预言不一致 ⇒ **记实测，不改判据迁就**；表里标「预言不红／登记」的，实测不红就登记为「该分支无独占判据」并列入报控制器清单；
4. 跨 Task 的红证（例如 T8-M2 让既有 `webFaults` 那条红）**真的重跑一次**，不许纸上推（handoff §6.7）；
5. 还原证明：副本 `/usr/bin/git diff | wc -c` 与 `/usr/bin/git diff --cached | wc -c` 都是 0；删副本前 `/bin/rm -f` 软链本身，再 `/bin/rm -rf` 副本。

- [ ] **Step 4：台账 `.superpowers/sdd/2026-09-25-execution-driver/progress.md`**

内容：本轮归属（会话 `905e41ce`、各席模型）；§0 现量结果的复核记录（实施中若推翻了哪条，另起一节写更正，原文不动）；§0.1 偏离的控制器裁定（逐条：采纳／改法）；每条变异的「前后 sha256 全 64 位、红集合、RC、是否与预言一致」；判定器红证两次；Step 2 的门表（只抄工具报数）；T9 Step 1 的 ccloop build 头提交主题行；登记为「无独占判据」的分支清单。

```bash
cd /Users/biran/code/skills/loop/Orca
/usr/bin/git add -f .superpowers/sdd/2026-09-25-execution-driver/progress.md
/usr/bin/git commit -F "${SCRATCH:?}/t11-msg.txt"
```

`t11-msg.txt`：

```
docs(sdd): record the execution driver mutation battery and gates

Co-Authored-By: <implementer's own model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR
```

（`.superpowers/sdd/**` 被 gitignore，**必须单独** `git add -f`，不和别的路径同一条 add —— handoff §7.2。）

- [ ] **Step 5：交回控制器的清单**（写进本席报告，不写进仓库）：三仓 `ls-remote` 与本地 main 的比对（开工一次、收尾一次）；§0.1 各条的实际处理；所有「预言不红／登记」的变异实测结果；T9 T1 的真实终态字面量；E1 的实测耗时（只抄工具报数）；**`push`、合并进 main、删分支或 worktree 一律没做，列进 `awaitingHuman`**。

---

## 自审（写计划席按 superpowers:writing-plans 做的，结果如下）

**spec 覆盖**

| spec 节 | 落在 |
|---|---|
| §1 范围、诚实的验收表述 | Global Constraints（按 D1 改后）；T9 E2E 文件头注释 |
| §2.1 驱动环（持有者、触发、一次一轮、同步写、关闭顺序、补 wake） | T4（`createExecutionDriver`、`write`）、T7（`replenishStartWakes`）、T9（装配、踢、关闭顺序）；D20 |
| §2.2 状态机与 A1/A2/B/B'/C/D/E 表 | T4（A1–C）、T5（D）、T6（R）、T7（E）；D3、D4、D5、D6、D14、D15 |
| §2.2「不复用 legacy 三函数」「A1 先于 B」 | T4（C 自己 collect／写证据；不读 `start:` 行）；T4 A1 判据 |
| §2.3 人能做什么（`blockedReason`、`recovery-retry`） | T2（视图字段、`resumeBlockedDriverRun`）、T8（`retryRun` 接线）、T10（显示） |
| §3.1 `targetRepo` 每次重校 | T2（`resolveRepository`）、T4/T5/T6/T7 每次调用 |
| §3.2 目录布局、两种方式、改写 `repoPath`、设置表与命令 | T2（表、命令、ledger scope、路由）、T3（布局、建法）、T4（A2 改写）、T9（E2/W1）；D9、D16 |
| §3.3 attempt 提交 | T3（`commitAttempt`）、T4（C） |
| §3.4 不做直接改分支 | Global Constraints；`workspaceModeSchema` 只两值 |
| §3.5 清理与残留 | T3（`cleanupRunWorkspace`）、T7（E 清理）；D19 |
| §4 崩溃恢复（recovery 跳过、续做、不重复花钱、关闭不写 stop、只卡自己） | T8（跳过、豁免）、T4–T7（逐步幂等）、T9（R1）；D7 |
| §5.1 落地工作区、CAS、分支创建 | T3（`ensureWorkBranch`、`compareAndSwap`）、T5 |
| §5.2 越界先于合并 | T4（C 里 `harvest`）、T5 |
| §5.3 冲突（副本、对方、requiredChecks 并集、合成 contract、预算、runTask、崩溃恢复、markers、rebuild） | T6；D11、D12、D17、D18 |
| §5.4 并发与顺序 | T4（按 runId 串行一轮）、T7（CR1 判据） |
| §6 C1/C2/C3 | T1；D10 |
| §7.1 成功判据 | T11 Step 2 |
| §7.2 E1/E2/R1/R2/T1/W1/X1 | E1、E2、R1、真 T1：T9；R2：T4（前半）＋T7（R2b）；合成 T1：T4；W1：T2＋T4＋T9；X1：T5 |
| §7.3 既有判据改写 | D7：判定零条需要改；T8 变异 T8-M2/M4 钉住「不带参数」一侧 |
| §7.4 封闭 schema／枚举 | T2（全部）；D3 说明 `isTerminalRunState` 不改 |
| §8 Web spec 更正 | T8 Step 6（按 D8 改写的全文） |
| §9 登记 | Global Constraints；T11 Step 5 报人 |

**占位扫描**：计划正文用 python 扫 `TBD`、`TODO`、`待定`、`similar to Task`、`handle errors`、`<…>` 形占位（排除提交归属行里的 `<implementer's own model>` —— 那是**指示实施席填自己的模型**，与缝 B 计划同样写法）；结果写在本席报告里。
**类型／名字一致性**：`DriveRecord` 字段名在 T2 定义、T4–T8 使用处逐一对过（`inspectUnknown`、`landedCommit`、`reconcile.spawning`、`cleanedUp`）；`CrashPoint` 五值在 T4 定义、T5/T7/T9 使用处逐一对过；`ExecutionDriverDeps` 的 `beforeCas`／`crash` 在 T4 定义、T5/T6/T9 使用；`stepD`／`stepR`／`stepE` 的签名与 `advance` 的调用一致；判定器 `EXPECTED` 的条数与各 Task 写明的计数一致（15/7/2/11/17/4/14/7/7/2/9）。
