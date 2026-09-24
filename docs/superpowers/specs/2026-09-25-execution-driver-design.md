# 执行驱动：让 Web 派活从 `starting` 一路跑到 settle —— 设计（第二版）

> **归属**：Orca 控制器会话 `905e41ce`，2026-09-25。第二版 ＝ 第一版 ＋ 一席独立评审（6C／13I／9M）逐条并入，经过见 §10。
> **人裁（本会话，原话或逐项点选）**：
> - 「执行驱动缺口什么时候开 => 现在开」；第一片范围「①＋②＋③ 一直做到收尾」（启动腿＋恢复＋收尾腿）；
> - `base`「每次 accept 前现解析」；成果落点「每个 group 一条工作分支」；
> - 并发「并行，自动 merge / rebase」；「就算有冲突也可以起单独的agent解决冲突」；方案「A；解冲突计入 group 预算」；第 1–5 节逐节「同意」；
> - 工作区：「run 私有 clone => 这样太占磁盘空间了。尤其是有些非常大的git 仓库。建议默认用 git worktree的形式。
>   备选其他方案（私有clone / 直接修改一个分支等），在web端可以修改。」；ccloop 占盘「这一片一起改 ccloop」；
> - 判据「现在授权你这一轮可以改test判据」（本轮有效；仍守人裁 88 的 (b)(c)：整条改写不许放宽、改后注释写明编码哪条人裁，逐条记台账）；
> - 执行「这一轮执行过程中如果有问题，不要找我判断，先按你的建议执行。执行完在最后阶段报给我审核。」
>
> **观测锚点**：主题行 `docs(spec): design the execution driver that takes a Web run from starting to settle` 那一笔。**行号会移动 ⇒ 引用前现测。**
> 标「**控制器决定**」的都是人没逐条点过、按 Rule 1 自决的，收尾一并报人。标「**Task 0 现量**」的是写 spec 时未能量清、计划第一个 Task 必须先量并据实改落点的。

---

## 1. 问题与范围

Web 派活今天停在 `starting`：wake pump 调 `deliverScheduledStart` 写一条 `starting` run 与 `work-claim` outbox（id `work:<g>:<runId>`），
之后生产里**没有东西**调 `beginProviderAttempt`／`toStartEnvelope`／port `accept`（seam B spec §1.0）。
panel 一重启，`src/control/recovery.ts:28` 对没有 `start:<runId>` 行的 run 一律 `blocked.add` ⇒ `dispatchBlocked=true`，全局推迟所有 wake。
另外，**一次 start wake 只领一个 task**，领完即把 wake 标已投递（`webDispatch.ts:188-194`），全仓 6 处写 wake 的地方没有一处在 run 结束后补 wake ⇒ 即便接上 accept，group 也只会跑第一个 task。

**本片做**：① 启动腿；② Web run 崩溃恢复（逐 run 对账）；③ 收尾腿（collect → 证据／usage → 落进 `orca/<groupId>` → 冲突由单独 agent 解 → settle → **补 wake 推进后续 task**）；
工作区方式（默认 worktree，Web 可切）；ccloop 侧三处改动（§6）；Web spec 的具名更正（§8）。

**本片不做**（都登记，§9）：④ handoff 投递；⑤ 预算预估链 —— ⇒ **配置了 estimator 的 panel，导入后 estimate 停在 `running`，`scheduleStart` 以 `estimate-in-flight` 拒（`webDispatch.ts:102-104`）⇒ 本片的端到端只在「未配置 estimator」下成立**（Task 0 现量无 estimator 时 confirm→start 是否畅通）；
strict 组（Web spec :778 要求每次 provider 调用前有 proof）⇒ 驱动环遇 strict 组的 run 一律 `blocked`（`strict-proof-unimplemented`）；「直接在目标分支上跑、不隔离」的工作区方式（控制器决定，§3.4）。

**诚实的验收表述**：「**在 fake codex、soft 组、未配置 estimator 下**，Web 派活能从 confirm 跑到 settle 并落到 `orca/<groupId>`」。真 codex 活体验收归人；**不许说「Web 派活可用」**。

## 2. 架构

### 2.1 执行驱动环（新模块 `src/control/executionDriver.ts`）

- **持有者**：`src/panel/controlAssembly.ts`，与 wake pump 并列、独立；只在 port `configured` 时构造，`unconfigured` 时不存在（行为与今天逐字节相同）。
- **触发**：自己的定时器（沿用 `--control-wake-ms`，控制器决定不另开 flag）；另在 recovery 之后、每次 pump 一轮之后、每次驱动环推进过 run 之后各踢一次。
- **一次一轮**：与 pump 同形（`inFlight` 重入返回同一 promise）。每一步的**同步写**过 `withAdmission`。
  ⚠️ `withAdmission` 同步释放（`controlLifecycle.ts:81-88`），挡不住已在飞的异步 port 调用 ⇒ 驱动环自己记在飞的 promise；`shutdown()` 顺序：停驱动环定时器 → **等在飞的驱动步结束**（上界＝port 超时）→ 停 pump → `applyPanelShutdown`。
- **一轮做什么**：
  1. **补 wake**（修 CR1）：对每个 `status` 可派活、无未投递 start wake、`nextClaimableTask` 非空、不在 `dispatchBlocked` 的 group，写一条 `start` wake（id `drive:<g>:<n>`，形状照 `webDispatch.ts:108`），并踢 pump。并行度即由此而来：每轮最多为每个 group 补一个 wake，pump 每个 wake 领一个 task。
  2. 对全部非终态、`phase='work'` 的 Web run 按 `runId` 排序**逐个推进一步**；单 run 异常只记到该 run（`blocked`＋`blockedReason`），不中断本轮、不置 `dispatchBlocked`。
- 与装配 spec §2「Nothing here may cause a provider invocation during boot, recovery, or the wake pump」：那是**那一片**的禁令；本片维持 pump 与 recovery 不调 provider，provider 调用只在驱动环。不需更正那份 spec。

### 2.2 run 状态机

run body 的 `state` 扩展新值：`start-pending`、`collected`、`landed`、`reconciling`、`blocked`。

```
starting ─A─▶ start-pending ─B─▶ running ─C─▶ collected ─D─▶ landed ─E─▶ settled
                 │ accept=unknown 或 accept 抛错 ▶ unknown ─B'─▶ running ／ start-pending ／ blocked
                 │ accept=stopped ▶ blocked                     
                 └ 任意一步不可自动恢复 ▶ blocked（blockedReason）
running ─C 终态≠succeeded─▶ blocked（terminal:<status>，不落地、保留现场）
collected ─D 冲突─▶ reconciling ─▶ landed ／ blocked
blocked ─人发 recovery-retry─▶ 回到 blockedAt 记录的那一步
```

| 步 | 做什么 | 幂等性 |
|---|---|---|
| A1 | **事务**：`providerAttemptOrdinal += 1`、从 work 桶预留一次 attempt、写入预定的 `sourceDir`／`workspacePath`／`workspaceMode`、`prepared:false`、`state=start-pending` | 只从 `starting` 进，重启看到 `start-pending` 不会再 +1 |
| A2 | 外部动作：解析 `targetRepo`（§3.1）；确保 `orca/<g>` 存在；`base` ＝ 其尖端 sha；`mkdir sourceDir 0700`；按方式建工作区（已存在且 HEAD＝base 即复用，否则删掉自己路径下的再建）；取已核验 contract、改写 `context.repoPath`；`toStartEnvelope` 得到**完整 StartEnvelope**，写进 canonical record；**事务**：记 `base`、envelope hash、`prepared:true` | `prepared:false` 时整段重做 |
| B | 读回同一份 envelope → port `accept`。`accepted` ⇒ `running`＋`executionId`（核 `configHash` 与 envelope 一致，不一致 ⇒ `blocked`）；`unknown` **或抛错** ⇒ `unknown`；`stopped` ⇒ `blocked` | 发送前若已有 `executionId` 不发 |
| B' | `unknown` 时 `inspect`：`absent` ⇒ 回 `start-pending`（下一轮重发**字节相同**的 envelope）；`accepted` ⇒ `running`；`stopped` ⇒ `blocked`；仍 `unknown` ⇒ 计数，连续 10 轮 ⇒ `blocked`（`inspect-unknown`） | 只读 |
| C | `collect(afterSeq)`：无终态 ⇒ 记 usage、推进 `afterSeq`；有终态 ⇒ 同一进程内 `readEvidence` 全部 ref、写 artifact、记 usage、写 `report` outbox；**终态 `succeeded`** ⇒ 在结果目录生成 attempt 提交（§3.3）、越界检查（§5.2）⇒ `collected`；改动集为空 ⇒ 直接到 E（不落地）；**其他终态** ⇒ `blocked`（`terminal:<status>`） | collect 只读；写入按 artifact 内容寻址 |
| D | 落地（§5）⇒ `landed` 或 `reconciling` | 先查 `merge-base --is-ancestor`（已在 ⇒ 直接 `landed`） |
| E | 写 acceptance 证据（形状照 `confirmLanding`，`schedulerBridge.ts:104-119`）→ `commitCandidate`（它只在 acceptance 已存在时把 work 置 `done`，`checkpoints.ts:67,88`）→ projection → 清理（§3.5） | `commitCandidate` 按 checkpointId 幂等 |

- **旧 legacy 的 `collectControlled`／`disposeControlled`／`savedReport` 不复用**：它们读 `start:<runId>` 行（`dispatch.ts:15-17`），为复用去写这一行会让 recovery 走 legacy 分支、可能调 `port.accept`（provider 调用）。
  复用的是更底层的 `writeArtifact`／`recordUsage`／`archiveRun`／`commitCandidate`；它们内部若调 legacy `readRun` 读不了 Web run body，就写 Web 版读取器（**Task 0 现量**）。
- `commitCandidate` 落盘的状态是 `settled`（并把 group 置 `review`），不是 `settled-*` 三值之一 —— 读模型的 `settled-*` 由视图派生（**Task 0 现量** 派生规则，E1 按实际值断言）。
- ⚠️ 读模型约束：`accepted`/`settled` 且 `providerAttemptOrdinal===0` 被判 `run-state` blocked（`controlViews.ts` 约 :467）⇒ A1 必须先于 B。

### 2.3 人能做什么
`blocked` 的 run 在面板显示 `blockedReason`；人发既有的 run 级 `recovery-retry` 命令（Task 0 现量它今天的语义与 schema）⇒ 驱动环把 run 送回 `blockedAt` 记录的那一步重试。
不新增别的人工命令；放弃一个 run 走既有的 stop／recover 路径。

## 3. 输入与工作区

### 3.1 `targetRepo`
trusted config `repositories` 按 group 的 `repoId` 查，**每次用前重校路径 witness**（与 `resolveTarget` 同一套）。失效 ⇒ `blocked`（`repository-path`）。StartEnvelope 的 `work.targetRepo` 即此路径。

### 3.2 工作区方式（人裁：默认 worktree，Web 可改）

**目录布局**（修 CR5）：`archiveRun` 要求 `basename(sourceDir)===runId`、`repo` 在 `sourceDir` 内、`sourceDir` **不在** `store.stateDir` 内，并把 `sourceDir` 里除 `repo/` 外的一切归档（`archive.ts:163-168`）⇒
- `runsRoot` ＝ control 根下与 `state/` **并列**的 `runs/`（不在 `stateDir` 里），0700，随 `ORCA_CONTROL_DIR` 改道（Rule 17）；`sourceDir = <runsRoot>/<runId>`（只放 ccloop 的 `run/` 与 `repo/`）。
- 工作区另放 `<workspacesRoot>/<runId>`，`workspacesRoot` ＝ 与 `runs/` 并列的 `workspaces/`，**不进归档**。

| 方式 | 建法 | 给 ccloop 的 `repoPath` |
|---|---|---|
| `worktree`（默认） | `git -C <targetRepo> worktree add --detach <workspacesRoot>/<runId> <base>` | 该 worktree |
| `clone` | `git clone --local --no-checkout <targetRepo> <workspacesRoot>/<runId>` ＋ `checkout --detach <base>` | 该 clone |

- **为什么必须改写 `repoPath`**：ccloop 的尝试 worktree 从 `repoPath` 的 HEAD 切（ccloop `runLoop.ts:1302`、`worktreeManager.ts:25`），不是从 `base`；旧调度器同样改写（`ccloopRunner.ts:231-238`）。ccloop 不读 `contractHash` ⇒ 改写不会被拒；冻结的 `derivedContractHash` 不变，改写后的 contract 随完整 envelope 一起存。
- worktree 方式下 ccloop 在其中再建的尝试 worktree 会注册进目标仓库的 `.git/worktrees`（评审席实测嵌套可行）。
- **设置**：store 新表 `repository_settings(repo_id PRIMARY KEY, body)`，body `{workspaceMode:"worktree"|"clone", revision}`；无行 ⇒ `worktree`。
  新 Web 命令 `set-workspace-mode`，target `{kind:"repository", repoId}`，带 `expectedRevision`。⚠️ `RawAuthorityCommandV1` 没有 `repository` 目标、`commandLedger.scope()` 假设 group ⇒ 要一并扩（§7.4 清单）。面板仓库视图加选择控件。只影响之后进 A1 的 run。

### 3.3 attempt 提交从哪来（控制器决定）
不读 `refs/ccloop/run/attempts/<n>`（所有 control run 共名，一个仓库里后来者覆盖前者，顺序执行也会覆盖）。C 步在 `<sourceDir>/repo` 里
`git add -A` ＋ `commit --allow-empty`（固定身份 `Orca <orca@localhost>`，`-c core.hooksPath=/dev/null -c core.fsmonitor=false`）⇒ `attemptSha`；工作区干净且 HEAD≠`base` ⇒ 直接取 HEAD。**只在终态 `succeeded` 时做**（修 CR3）。

### 3.4 不做「直接改分支」（控制器决定）
与并行互斥、会动人的工作区；`workspaceMode` 留两值，将来加值另开。

### 3.5 清理与残留（Rule 17 登记）
写到仓库外的：`<runsRoot>/<runId>`、`<workspacesRoot>/<runId>`、`<workspacesRoot>/landing-<runId>`、`<workspacesRoot>/conflict-<runId>`；
目标仓库里的：`.git/worktrees/*`（本 run 工作区、落地工作区、ccloop 的 `attempt-*`）、`refs/heads/orca/<groupId>`、`refs/orca/incoming/<runId>`、`refs/orca/conflict/<runId>`、ccloop 的 attempt ref（C2 之后按 run 分名）。
**只有已 `settled` 且已落地（或改动为空）的 run** 清理：`git worktree remove --force` 本 run 自己的工作区（路径不在 `workspacesRoot` 下即拒绝）＋删 `refs/orca/incoming/<runId>`。其余保留现场，路径进 run body、面板可见。**`orca/<groupId>` 永不删**。

## 4. 崩溃恢复

- `recoverControl` 在**进入 legacy 逐 run 分支之前**（`recovery.ts:26` 之前）认出 Web run（存在 `work:<g>:<runId>` 行，kind `work-claim`）⇒ 跳过、不计入 `blocked`，交给驱动环；legacy run 行为一字不改。
- 驱动环的续做就是 §2.2 表里那一步：`start-pending` 按 `prepared` 分 A2／B；B 前若已有 `executionId` 不发；`unknown` 走 B'；`running` 再 collect；`collected` 先查已落地；`reconciling` 见 §5.3；`landed` 重做 E。
- **不重复花钱的依据**：B 只在「无 `executionId` 且上一次 inspect 为 `absent`（或从未发过）」时发 accept；ccloop 对同一 envelope 的 accept 语义幂等（Orca 协议夹具测过重放，⚠️ 真 ccloop 的重放 **Task 0 现量**）。
- **panel 优雅关闭**：`applyPanelShutdown` 今天会把 active run 冻成带 handoff 请求的 stop intent，而 ④ 不投递它 ⇒ 重启后这些 group 停住（评审 I2）。
  **控制器决定**：驱动环接手的 run 在 ccloop 那边是独立进程、跨 Orca 重启继续跑 ⇒ 关闭时**不为驱动环的 run 写 stop intent**，重启后照常 inspect／collect。（Task 0 现量 `applyPanelShutdown` 的筛选点，改动落在那里。）
- 只卡自己：`unknown`／`blocked` 只影响该 run；`dispatchBlocked` 只由 legacy 分支与 projection／cleanup 置位。

## 5. 落地

### 5.1 落地工作区（修 I1：不常驻、不占分支）
每次落地建一个**detached** 工作区 `<workspacesRoot>/landing-<runId>`，停在 `orca/<g>` 的当前尖端 `old`；在里面合并得到 `new`；
然后 `git -C <targetRepo> update-ref refs/heads/orca/<g> <new> <old>`（比较后更新）。尖端被别人动过 ⇒ 这一轮不落，下一轮重来。落完删掉该工作区。
崩溃留下的半截落地工作区：下次落地前按路径删掉重建（只删 `workspacesRoot` 下自己命名的）。
分支不存在 ⇒ 从目标仓库当前 `HEAD` 的 commit 建（`git branch orca/<g> <sha>`，不 checkout）。**人的工作区、HEAD、main 一律不碰**；人可以随时 checkout `orca/<g>`。

### 5.2 干净合并
**先**做越界检查（调度器 `harvest`／`netChangeSet`／`disposition` 对 `targetPaths`／`allowlistPaths` 判定；越界 ⇒ `blocked`），**再**合并：
在落地工作区 `git fetch <sourceDir>/repo <attemptSha>:refs/orca/incoming/<runId>`（写进目标仓库的共享 refs）→ `merge --no-ff -m "orca: land <runId>"`（固定身份、hooksPath=/dev/null）。成功 ⇒ CAS ⇒ `landed`，记 `landedCommit`。
⚠️ `landIntoW`（`land.ts:87`）不复用：它要求人的仓库 checkout 在工作分支上、在人的工作区里 merge。

### 5.3 冲突 ⇒ 单独 agent 解（人裁）
1. `merge --abort`，删落地工作区。建冲突副本 `git clone --local --no-checkout <targetRepo> <workspacesRoot>/conflict-<runId>`（修 CR4：`materialiseConflict` 固定 `fetch origin`，`reconcile.ts:119`；clone 的 `origin` 就是目标仓库，而人的 worktree 的 `origin` 是真远端）⇒ `materialiseConflict(copy, old, refs/orca/incoming/<runId>)`、`pinConflictCommit`。
2. **对方是谁**（修 I6）：`otherSideOf` 硬编码 `refs/orca/<runId>` 与单层 base，不复用；写 Web 版：本 group 已落地的 run 中，其 `base..landedCommit` 改动集与冲突路径相交者；恰好一个 ⇒ 对方；零个或多个 ⇒ `blocked`。
3. `planReconciliation`：两边 `requiredChecks` 并集为空 ⇒ `blocked`。
4. `synthesizeReconcileContract` 生成解冲突 contract（构造上保证解冲突者不是当事任务）；它的 `verification.requiredChecks` 就是并集 ⇒ **由 ccloop 自己的 verifier 在解冲突 run 里跑并集**（第一版写的「Orca 另行验证合并提交」不存在，删去）。
5. **预算**（修 I5）：group 没有可扣减的「未分配预留」操作（它是由不变式守的派生余量）。**控制器决定**：派解冲突 run 前做只读的**可负担性检查**（group 剩余 ≥ 解冲突 contract 的 `tokenBudget`，不够 ⇒ `blocked`＝`reconcile-budget`）；跑完把它的 usage 记进 group。**没有预留**这一点登记为已知缺口。
6. **怎么跑**（控制器决定）：解冲突 run 不是 plan 里的 task、没有冻结的 `DispatchEnvelopeV1`；`service.ts:109-123` 的受控解冲突路径拒 Web group ⇒ 用调度器 `runTask`（直接 spawn `ccloop run`）。
   ⚠️ `RunTaskOptions.adapter` 今天不能是 codex（评审 I6）⇒ 扩成可传 `codex`＋adapter config 路径（Task 0 现量 `ccloop run --adapter codex` 是否支持）。
   **崩溃恢复**（修 I7）：spawn 前把 ccloop runs 目录与 pid 写进 run body；重启后：该目录已有终态 `loop-state.json` ⇒ 直接收；pid 仍活 ⇒ 等；否则 ⇒ 丢弃重跑（花费再做一次可负担性检查）。
7. 跑完：`markersRemaining` 非空 ⇒ `blocked`；否则 `rebuildMergeCommit` ⇒ 以它为 `new` 走 §5.1 的 CAS ⇒ `landed`。任何失败 ⇒ `blocked`，冲突提交留在 `refs/orca/conflict/<runId>`。

### 5.4 并发与顺序
落地在一轮内按 `runId` 串行（一进程一轮）；执行并行。依赖者由 §2.1 的补 wake 在前驱 `settled`（work `done`）后被领走，其 `base` 是含前驱的尖端。

## 6. ccloop 侧改动（人裁「这一片一起改 ccloop」；守 ccloop 自己的规则）

| # | 改什么 | 为什么 |
|---|---|---|
| C1 | `src/control/resultRepository.ts` 的 `cloneAt` **去掉 `--no-hardlinks`**（不加 `--local`：显式 `--local` 跨文件系统会直接失败，默认本地 clone 能退回拷贝） | 每 run 一份整对象库拷贝是大仓库占盘大头。引入该 flag 的那一笔没写理由、无判据钉它（评审现查）；动手前再核一次 git log |
| C2 | control 模式的 attempt ref 按 run 区分（不再共用 `refs/ccloop/run/attempts/<n>`；具体以 control run 的唯一标识命名，Task 0 现量 ccloop 手里有哪个） | 共享 refs 空间下后来者覆盖前者；`materializeResultRepository` 在尝试 worktree 已删时按这个 ref 重建结果目录 ⇒ 拿错结果 |
| C3 | `tests/fixtures/fake-codex.mjs` 加脚本化模式：按 prompt 里的 taskId 从 JSON 脚本取「写哪个文件、写什么」；既有模式一字不改 | `integration` 永远写 `answer.txt="42\n"`，造不出、也解不了冲突 |

只改这三处；ccloop 红线函数与人裁 83 删锁条件不碰。ccloop 判据：`check-known-reds.mjs` RC 0。
⚠️ 已知仍占盘（登记不修）：`<sourceDir>/repo` 是一份完整检出；Orca 归档的快照若是 `git bundle --all`（评审 I12 所指，Task 0 现量）则每 run 一份全历史。

## 7. 判据

### 7.1 成功判据（命令，0／非 0）
Orca：`npm run typecheck`；全量 vitest json＋判定器（失败 ⊆ 已登记 flake、0 pending／todo、新判据全 `passed`）；`verify:control`、`verify:web-control`、`verify:web-control:consumer`、`verify:scheduler`、`verify:chain`、web build、`verify:panel`、`--ws check`、`check-claude-md-lines`、`check-hooks-path` 逐段 RC 0；ledger validate RC ∈ {0,2}。
ccloop：`typecheck`、`build` RC 0；vitest json 过 `check-known-reds.mjs` RC 0。
env：`ORCA_CCLOOP_BIN` ＝ 改过 C1–C3 的 ccloop 的 `clone --local`＋build。

### 7.2 新判据（承重的；细目在计划）
| # | 判据 | 防空绿的点 |
|---|---|---|
| E1 | 端到端：`controlAssembly` 装配（port＝真 ccloop build＋脚本化 fake codex，未配置 estimator，soft 组），临时目标仓库、全部路径改道；三个 task：A、B 互不依赖且写同一文件不同内容，C 依赖 A。从 confirm 起只让 pump 与驱动环自己跑 | 断言：`orca/<g>` 上 A、B、C 的**具体内容**；有且仅有一个解冲突 run 且它的结果是冲突提交的解；每个 run 的**落盘状态＝`settled`、work＝`done`**（不接受 blocked／unrecoverable）；`main` 与人的工作区 HEAD、index 逐字节不变；C 的 `base` 是含 A 的提交；fake codex `.calls` 计数＝预期次数（不多花） |
| E2 | worktree 与 clone 两种方式各跑「A 单独」 | 运行中断言 `git worktree list` **含**该工作区（worktree 方式）／clone 目录存在；settle 后断言它已不在 |
| R1 | 崩溃注入点放在**外部动作与其落盘之间**（A2 建完工作区未记 prepared、B accept 返回未落盘、C 终态已读未落盘、D CAS 后未落盘、E acceptance 后未 commitCandidate），重启后到同样终态 | 断言 provider 调用计数（fake codex `.calls` 与 ccloop run 目录数）**不多于**无崩溃时；`dispatchBlocked` 恒假 |
| R2 | 合成 port：`accept` 返回 `unknown`、`inspect` 恒 `unknown` ⇒ 10 轮后该 run `blocked`（`inspect-unknown`），同 group 另一无依赖 run 照常 settle | 断言确实走到 B'（inspect 被调次数） |
| T1 | 终态非 `succeeded`（fake codex 的 `false-answer`／`nonzero`）⇒ `blocked`＝`terminal:<status>`，`orca/<g>` 不动 | 断言分支尖端 sha 不变 |
| W1 | `set-workspace-mode` 后新进 A1 的 run 用新方式；revision 冲突按名拒 | — |
| X1 | 人 checkout 着 `orca/<g>` 时照常落地（CAS 推进分支） | 断言人的工作区文件与 index 不变 |

每个新分支点名一条「删掉它自己」的变异，在 `git clone --local` 副本里看见红，记台账。

### 7.3 需改写的既有判据（本轮已授权）
`tests/control/webFaults.test.ts:266-291`、`tests/panel/controlRecoveryApi.test.ts:162`、`tests/control/webFaults.test.ts:173`、`tests/control/webDispatch.test.ts:112` 的候选，由计划阶段逐条判定是否真与本片冲突（其中编码 Web spec :788「全局 blocker」规则的，随 §8 的更正一起改）。
注释：`// Execution driver (human ruling 2026-09-25: this round may rewrite criteria; ruling 88 (b)(c)): <编码的新事实>`。

### 7.4 封闭 schema／枚举要跟着改的地方（修 I10）
`runViewSchema.state`（`webProtocol.ts`）、`persistedRunSchema`（`controlViews.ts`，strict ⇒ 新增的 run body 字段全部要进）、`displayRunState`、active／terminal 不变式与 `isTerminalRunState`、`runViewSchema` 加 `blockedReason`、`web/src/controlTypes.ts`；
新命令：`RawAuthorityCommandV1` 加 `set-workspace-mode` 与 `repository` 目标、`commandLedger.scope()`、store migration（`repository_settings` 表）。控制类型没有 parity 判据，靠 `tsc`。

## 8. 对已发布 Web spec 的更正

`docs/superpowers/specs/2026-09-19-web-recoverable-control-design.md` 文末追加 `## ERRATUM (execution driver, 2026-09-25)`：
:788 的「全局 blocker」对 Web run 不再成立（逐 run 阻塞）；:772 的「background scheduler」由本 spec 的执行驱动环实现；:778 的 proof 要求本片只对 soft 组兑现、strict 组 `blocked`。原文逐字保留。

## 9. 登记（不修）
真钱（port `configured` 即真调 ccloop；判据一律 fake）；配置 estimator 时走不通（⑤）；strict 组；解冲突无预留、崩溃重跑可能重复花费；`refs/orca/*` 与 `orca/<g>` 留在人的仓库；
两个 panel 挂同一 store 不在范围；`<sourceDir>/repo` 与归档快照的占盘；`inspect` 恒 unknown 的阈值 10 是控制器拍的。

## 10. 评审记录
一席独立评审（只读；报告在会话 scratchpad `driver-spec-review.md`，不入库），6C／13I／9M。控制器现测复核了 CR1（`webDispatch.ts:188-194` 与全仓 6 处 wake 写入）、CR4（`reconcile.ts:119`）、CR5（`archive.ts:163`），均成立。
并入方式：CR1→§2.1 补 wake；CR2→B 抛错改 `unknown`；CR3→C 只对 `succeeded` 落地；CR4→冲突副本用 clone；CR5→目录布局；CR6→不复用 legacy 三函数。
I1→§5.1；I2→§2.1 关闭顺序＋§4 不写 stop intent；I3→§1 限定无 estimator；I4→§2.2 E；I5→§5.3(5)；I6→§5.3(2)(4)(6)；I7→§5.3(6)；I8→§2.3＋B' 阈值；I9→A1／A2 拆分与完整 envelope；I10→§7.4；I11→§1 strict＋§8；I12→C1；I13→§7.2 各「防空绿」列。
Minor 全部就地修进对应段落（M1 行 id、M4 残留清单、M5 `stopped`／`configHash`、M6 跳过点、M7 越界检查先于合并、M8 §1 措辞、M9 由 C3「既有模式一字不改」＋计划点名其判据）。M2（重放证据来自夹具）→ §4 标 Task 0 现量；M3 → §3.3。

## 11. 计划阶段的偏离裁定（2026-09-25，控制器）

计划席在写计划前现量了 §2–§6 标「Task 0 现量」的全部项（结果在计划 `docs/superpowers/plans/2026-09-25-execution-driver.md` §0，带 file:line 与探针），
并列出 21 处本文与代码不符之处（计划 §0.1 的 D1–D21）。**控制器裁定：D1–D21 全部按计划席的建议执行，计划正文即按建议写成；本节优先于上文对应段落。**
理由：每一条都有现量或代码行作证，且都比上文更贴近代码；人的规矩是「执行中遇到问题先按控制器的建议做，最后一次报人」。承重的几条：

- **D1**：未配置 estimator 时 `import-plan` 就被拒（`control-estimator-unconfigured`）⇒ §1 的限定改为「配置一个 `contextWindowTokens:null`、预估得 `blocked-capability` 的 estimator」；诚实的验收表述随之改。
- **D2**：`commitCandidate` 的 `releaseRunReserve` 不同步 Web 台账 ⇒ 每次 settle 后整个 group 视图被判 `run-identity` 阻塞 ⇒ 必须加 Web 分支（本片新增的生产改动）。
- **D3**：`running` 落盘为既有的 `accepted`（视图照旧显示为 running）；新增五态都是非终态。
- **D4**：`stopped` 是 ccloop 对正常结束的 run 的答复 ⇒ B／B' 见 `stopped` 进 collect，不进 `blocked`（推翻 §2.2 那一格）。
- **D7**：recovery 跳过与 shutdown 豁免**只在驱动环存在时**生效 ⇒ **零条既有判据需要改写**（§7.3 的候选全部不改）。
- **D8**：Web spec :788 是 proof-ack 规则，本片不改它 ⇒ §8 的 ERRATUM 改写为只点名 :772／:778 与「全局 blocker」的实际出处。
- **D9**：store 没有 `state/` 子目录 ⇒ `runsRoot`／`workspacesRoot` ＝ `<stateDir>.runs`／`<stateDir>.workspaces`（与 store 目录并列）。
- **D10**：C2 **只加不改**：共享 ref 照写（ccloop `tests/control/endToEnd.test.ts:36` 钉着它），另写按 `claim.runId` 命名的 ref，`materializeResultRepository` 读按 run 的那个。
- **D12**：默认 20% 预留付不起一次解冲突（约 2.48M vs 3M）⇒ E1 先 `set-limit` 抬高上限。
- 其余（D5 exit 2 ⇒ `accept-refused`；D6 A1 不动预算数额；D11 对方＝`base..landedCommit^2`；D13 用 `ORCA_IDENTITY`；D14 空结果 ⇒ work `blocked`；D15 `cleanedUp`；D16 仓库级命令作用域＋GET 路由；D17 `onSpawn`；D18 usage 取 `tokenBudgetRemaining`；D19 冲突 ref 在副本里；D20 每次 provider 调用前查 draining；D21 continuation run ⇒ `blocked`）见计划 §0.1 原表。

## 12. 终审后的更正（2026-09-25，控制器裁定）

> **归属**：控制器会话 `905e41ce` 的终审修复席（Claude Opus 5.5），依据终审报告 `.superpowers/sdd/2026-09-25-execution-driver/final-review.md` 的 I1–I6 与控制器对它们的裁定。上文逐字保留（Rule 13），**本节优先于上文对应段落**。

**(a) §3.5 残留清单补登（Rule 17）**：写到仓库外的还有 `<workspacesRoot>/conflict-<runId>`（冲突副本，§5.3(1) 建）与 `<workspacesRoot>/reconcile-<runId>`（解冲突 run 的 runs 目录：`runTask` 的 clone、ccloop 的 run 目录、以及 I3 之后的 `ccloop.stdout.log`／`ccloop.stderr.log`，0600）；都由驱动环在 D／R 步触发。
**这两者在 run settle 之后也保留**：每个解冲突过的 run 留一对，**无上限**；清理推后（登记，不在本片做）。

**(b) 诚实的验收表述还要加两条限定**：
① 可能冲突的 group，要先把 token 上限抬到够付一次解冲突（D12：默认预留付不起，第一次冲突会被 `reconcile-budget` 阻断）；
② 带 command verifier 的 task，需要 ccloop 在主题行为「fix(control): report zero usage for a verify phase that calls no provider」那一笔或之后（C4），否则 settle 会以 `settle-incomplete` 阻断。

**(c) 终审 I1–I5 各改了什么**：
- **I1**：一次 settle 不再把因超额（breach）而 `blocked` 的 Web 组改回 `review`；驱动环不为 `blocked` 的组补 wake，A1／B 也不在这样的组里开始 provider 调用。
- **I2**：落地的比较后更新失败后再读一次分支：只有尖端确实移到别处才算「被人动过」、下一轮重来；其余失败（例如残留的 `orca/<g>.lock`）一律把 run 阻断在 D／R，原因为 `cas-failed:<ref>: <git 的 stderr>`。
- **I3**：解冲突的 `ccloop run` 以 detached（自成进程组）方式起、stdout／stderr 写进它 runs 目录里的文件、`unref`，面板关闭不连带杀死它；重启后的驱动环按记下的 pid 等它，它活着时不删它的 loop state。`orca run` 的起法不变。
- **I4**：解冲突记录里持久化 `spawnSeq`（每次起之前 +1），花费按 `spawn-<seq>` 记账，不再按 pid；人对阻断在 R 的 run 发 `recovery-retry` 时保留已收的 outcome，于是一个已经收过、被拒的终态 loop state 会被丢弃并重新起（先做可负担性检查），同一次 spawn 永不记两次；**跑到终态的** spawn 各记一次。⚠️ **一个死掉、没写出终态 loop state 的 spawn 不记账**：重新起之前它的 runs 目录会被删掉，花费丢失（控制器会话 `905e41ce` 修复波复审发现，登记，未修）。
- **I5**：面板对带 `blockedReason` 的 `blocked` run 显示「Retry run」按钮，发 run 级 `recovery-retry`（target 为该 run，payload 指名同一个 run）。

**(d) 本片收口时仍登记（不修）**：因超额 breach 而 `blocked` 的组在产品内只能 stop／recover 脱困（`setLimit` 拒收 blocked 组），组内停在 A1 的 run 在面板上只显示 `starting`、不显示原因；
`reconcile-orphan-unknown` 后人发 retry，会在孤儿进程可能仍活着时重起一次解冲突（两次解冲突、删掉活的 loop state）；`spawnSeq` 记账键没有判据钉住（假 ccloop 总会发布 attempt）。
