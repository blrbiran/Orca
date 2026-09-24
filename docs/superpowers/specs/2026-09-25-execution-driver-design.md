# 执行驱动：让 Web 派活从 `starting` 一路跑到 settle —— 设计

> **归属**：Orca 控制器会话 `905e41ce`，2026-09-25。
> **人裁（本会话，原话或逐项点选）**：
> - 「执行驱动缺口什么时候开 => 现在开」；
> - 第一片范围：「①＋②＋③ 一直做到收尾」（启动腿＋恢复＋收尾腿）；
> - `base`：「每次 accept 前现解析」；成果落点：「每个 group 一条工作分支」；
> - 并发：「并行，自动 merge / rebase」；「就算有冲突也可以起单独的agent解决冲突」；
> - 方案：「A；解冲突计入 group 预算」；第 1–5 节逐节「同意」；
> - 工作区：「run 私有 clone => 这样太占磁盘空间了。尤其是有些非常大的git 仓库。建议默认用 git worktree的形式。
>   备选其他方案（私有clone / 直接修改一个分支等），在web端可以修改。」
> - ccloop 占盘：「这一片一起改 ccloop」；
> - 判据：「现在授权你这一轮可以改test判据」（本轮有效；仍按人裁 88 的 (b)(c)：整条改写不许放宽、改后注释写明编码哪条人裁，逐条清单记台账）；
> - 执行规矩：「这一轮执行过程中如果有问题，不要找我判断，先按你的建议执行。执行完在最后阶段报给我审核。」
>
> **观测锚点**：本文行号与现测均在主题行 `docs(plan): tick the seam B plan's steps as done` 那一笔之上量得。**行号会移动 ⇒ 引用前现测。**
> **本文里「控制器决定」标注的，都是人没有逐条点过、由控制器按 Rule 1 自决的，收尾时一并报人审核。**

---

## 1. 问题与范围

Web 派活今天停在 `starting`：wake pump 调 `deliverScheduledStart` 写一条 `starting` run 和一条 `work-claim` outbox，
之后生产里**没有任何东西**调 `beginProviderAttempt`／`toStartEnvelope`／port 的 `accept`（seam B spec §1.0，python 逐行扫零调用方）。
而且 **panel 一重启**，`src/control/recovery.ts:28` 对没有 `start:<runId>` 行的 run 一律 `blocked.add`，
`dispatchBlocked = true` ⇒ 所有 wake 被推迟、没有东西能解开（`tests/control/webFaults.test.ts:266-291` 把它当预期断言）。

**本片做**：① 启动腿（`starting` → ccloop `accept`）；② Web run 的崩溃恢复（逐 run 对账，不全局卡死）；
③ 收尾腿（collect → 证据／usage → 落进 group 工作分支 → 冲突由单独 agent 解 → settle → 推进依赖）；
外加两件为此必须做的：**工作区方式**（默认 worktree，可在 Web 切换）与 **ccloop 侧三处改动**（§6）。

**本片不做**：④ handoff 投递（`deliverHandoffStop`／`beginHandoffAttempt` 仍未接线；运行中 context 越界由 `beginProviderAttempt` 既有的 latch 挡住，挡住即 `blocked`）；
⑤ 预算预估链（`claimEstimate` → accept → `completeEstimate`）；strict 模式的 proof-ack；「直接在目标分支上跑、不隔离」这种工作区方式（与并行天然冲突，控制器决定不做，§3.4）。

**诚实的验收表述**：本片做完能说的是「**在 fake codex 下**，Web 派活能从 confirm 跑到 settle 并落到 `orca/<groupId>`」。
真 codex 下是否能跑，要人另外点头做一次花真钱的活体验收；在那之前**不许说「Web 派活可用」**。

## 2. 架构

### 2.1 执行驱动环（新模块 `src/control/executionDriver.ts`）

- **持有者**：`src/panel/controlAssembly.ts`，与 wake pump 并列、**独立**。只在 execution port 为 `configured` 时构造；
  `unconfigured` 时不存在，行为与今天逐字节相同。
- **触发**：自己的定时器（沿用 `--control-wake-ms` 的值，控制器决定：不另开 flag），外加三处踢一次：recovery 之后、每次 wake pump 一轮结束之后、
  每次驱动环自己推进了至少一个 run 之后（让多步状态机不必等满一个周期）。
- **一次一轮**：与 pump 同形（`inFlight` 重入即返回同一个 promise）；每一轮 `withAdmission` 过 admission gate ⇒ panel draining 时不开新的 provider 调用。
  `shutdown()` 先停驱动环定时器、再停 pump 定时器，再进 `applyPanelShutdown`。
- **一轮做什么**：`SELECT` 全部非终态的 Web run（`phase='work'`），**按 run 逐个推进一步**；单个 run 的异常只记到该 run
  （进 `blocked`，理由写进 run body 的 `blockedReason`），**不中断这一轮、不置 `dispatchBlocked`**。
- 与装配 spec（`2026-09-22-panel-control-assembly-design.md`）§2「Nothing here may cause a provider invocation during boot, recovery, or the wake pump」的关系：
  那条是**那一片**的禁令（原文 "No live model call is authorized by this slice"）。本片**维持** pump 与 recovery 不调 provider；
  provider 调用只发生在驱动环里。**不需要更正**那份 spec，本节即为说明。

### 2.2 run 状态机

run body 的 `state` 扩展（`src/control/webProtocol.ts` `runViewSchema.state`、`src/panel/controlViews.ts` 的持久化 schema、
`web/src/controlTypes.ts` 同步）。新增值：`start-pending`、`collected`、`landed`、`reconciling`、`blocked`。

```
starting ─(A)─▶ start-pending ─(B)─▶ running ─(C)─▶ collected ─(D)─▶ landed ─(E)─▶ settled-*
                     │  accept=unknown ▶ unknown ─(B')─▶ running / start-pending
                     │  accept 抛错 ▶ failed-before-provider（沿用 settleProviderAttempt）
                     └  任意一步不可自动恢复 ▶ blocked（带 blockedReason）
collected ─(D) 冲突─▶ reconciling ─▶ landed ／ blocked
```

**每一步先落盘、再做外部动作，外部动作的结果再落盘**；重启后按落盘的状态续做（§4）。

| 步 | 做什么 | 落盘 |
|---|---|---|
| A | 解析 `targetRepo`（§3.1）；确保工作分支 `orca/<groupId>` 存在；`base` ＝ 该分支尖端的 sha；按工作区方式建 run 工作区（§3.2）；取已核验 contract 并把 `context.repoPath` 改写成 run 工作区；**同一事务里**：`providerAttemptOrdinal += 1`、从 work 桶预留一次 attempt、写 `base`／`sourceDir`／`workspace`／改写后的 contract hash、`state = start-pending` | 事务 |
| B | `toStartEnvelope` → port `accept` | `accepted` ⇒ `running`＋`executionId`；`unknown` ⇒ `unknown`；抛 `ControlError` ⇒ `failed-before-provider` |
| B' | `unknown` 时 port `inspect`：`absent` ⇒ 回 `start-pending`（下一轮重发**同一个** envelope）；`accepted` ⇒ `running`；仍 `unknown` ⇒ 不动，退避 | — |
| C | port `collect(afterSeq)`；无终态 ⇒ 记 usage 事件、推进 `afterSeq`、不动；有终态 ⇒ 同一进程内 `readEvidence` 全部 ref、写 artifact、记 usage、写 `report` outbox、在结果目录生成 attempt 提交（§3.3），`state = collected` | 事务（artifact 先写） |
| D | 落地（§5）：干净合并 ⇒ `landed`；冲突 ⇒ `reconciling` | 事务 |
| E | settle：`commitCandidate`、acceptance、projection、work item 置完成、为依赖它的 task 布 wake；清理工作区（§3.5） | 事务 |

⚠️ `beginProviderAttempt` 今天不幂等（每调一次 +1）且不预留预算（Web spec :778 要求预留）。本片把「+1＋预留」挪进 A 的事务；
`beginProviderAttempt` 的既有 suppress 语义（context latch／handoff latched）保留，**suppress ⇒ `blocked`**（④ 不在本片）。
⚠️ 读模型约束（`controlViews.ts` 现测约 :467）：`accepted`/`settled` 且 `providerAttemptOrdinal===0` 会被判 `run-state` blocked ⇒ A 必须先于 B。

## 3. 输入与工作区

### 3.1 `targetRepo`
trusted config 的 `repositories` 按 group 的 `repoId` 查，**每次用前重新校验路径 witness**（与 `resolveTarget` 同一套 `revalidatePath`）。
路径失效 ⇒ 该 run `blocked`（`blockedReason: "repository-path"`）。

### 3.2 工作区方式（**人裁：默认 worktree，Web 可改**）

| 方式 | 建法 | 给 ccloop 的 `repoPath` | 磁盘 |
|---|---|---|---|
| `worktree`（默认） | `git -C <targetRepo> worktree add --detach <runsRoot>/<runId>/worktree <base>` | 该 worktree | 只多一份工作区文件，对象库共享 |
| `clone` | `git clone --local --no-checkout <targetRepo> <runsRoot>/<runId>/clone` ＋ `checkout --detach <base>` | 该 clone | 对象硬链接（同一文件系统）＋一份工作区 |

- **为什么必须建工作区并改写 `repoPath`**（现测）：ccloop 的尝试 worktree 从 `repoPath` 的 **HEAD** 切（`ccloop src/controller/runLoop.ts:1302`
  调 `createAttemptWorkspace` 无起点；`src/workspace/worktreeManager.ts:25` 是 `git worktree add --detach <path>`），**不是**从 `base`。
  旧调度器同样改写（`src/scheduler/ccloopRunner.ts:231-238`）。ccloop 不校验 `contractHash`（ccloop `src/` 除 schema 外零消费，现测）⇒ 改写 contract 不会被拒；
  改写后的 contract hash 另记在 run body，**冻结的 `derivedContractHash` 不变**。
- **设置存哪**：控制 store 新表 `repository_settings(repo_id PRIMARY KEY, body)`，body ＝ `{ workspaceMode: "worktree" | "clone", revision }`；无行 ⇒ `worktree`。
- **怎么改**：新 Web 命令动词 `set-workspace-mode`（`RawAuthorityCommandV1` 扩一支，target `{kind:"repository", repoId}`，带 `expectedRevision`）；
  面板在仓库视图加一个选择控件。**只影响之后进入 A 步的 run**，已建工作区的 run 不迁移。
- ⚠️ `runsRoot`：trusted config 新增的根，`<control 状态目录>/runs`，0700，与 archive／export／evidence 并列、同样由 `ORCA_CONTROL_DIR` 改道（Rule 17）。

### 3.3 attempt 提交从哪来（控制器决定）
- ccloop 终态后，结果在 `<sourceDir>/repo`（ccloop `materializeResultRepository`）：可能是带未提交改动的工作区副本。
- **不读** `refs/ccloop/run/attempts/<n>`：control 模式下所有 run 用同一个名字（`runDir = <sourceDir>/run`，ccloop `src/control/worker.ts:147`），worktree 模式下它们住在同一个仓库里会互相覆盖。
- ⇒ C 步在 `<sourceDir>/repo` 里 `git add -A` ＋ `commit --allow-empty`（固定身份 `Orca <orca@localhost>`，`-c core.hooksPath=/dev/null -c core.fsmonitor=false`，§7.2 的监督进程纪律），`rev-parse HEAD` ⇒ `attemptSha`，写进 run body。
  工作区干净且 HEAD 已不是 `base` ⇒ 直接取 HEAD，不空提交。

### 3.4 不做「直接改分支」方式（控制器决定）
人提到的备选「直接修改一个分支」＝ 不隔离、在目标仓库某分支的工作区里跑。它与「并行」互斥（两个 run 同时写一个工作区），且会动人的工作区。
本片不实现；`workspaceMode` 的枚举留成两值，将来加值是扩封闭 schema，另开。

### 3.5 清理与残留（Rule 17 登记）
- 写到仓库外的：`<runsRoot>/<runId>/{worktree|clone, sourceDir 内容}`、目标仓库的 `.git/worktrees/<name>`（worktree 方式）、
  目标仓库的 `refs/heads/orca/<groupId>` 与 `refs/orca/incoming/<runId>`、ccloop 在目标仓库留下的 `refs/ccloop/<runId>/attempts/*`（§6 C2 之后按 run 分名）。
- **只有 `settled-*` 且结果已落地的 run** 才清理：`git worktree remove --force` 自己建的那一个（按记录的路径，路径不在 `runsRoot` 下即拒绝）＋删 `refs/orca/incoming/<runId>`。
  其余一律保留现场，路径写进 run body，面板可见。**工作分支 `orca/<groupId>` 永不删除**（合进 main 与删分支归人）。

## 4. 崩溃恢复

- `recoverControl`（`src/control/recovery.ts`）遍历 run 时，**认得出是 Web run**（有 `work-claim:<g>:<runId>` 行，或 run body 带 Web 的 `phase` 字段）⇒
  **跳过 legacy 分支、不计入 `blocked`**，交给驱动环；legacy run 行为一字不改。
- 驱动环对每个状态的续做就是 §2.2 表里那一步本身：
  `starting`／`start-pending` 可以重做（A 在事务里、B 前先看 `inspect`：见下）；`unknown` 走 B'；`running` 再 collect（只读）；
  `collected` 先查 `merge-base --is-ancestor <attemptSha> orca/<groupId>`，在 ⇒ 直接 `landed`；`reconciling` 见 §5.3；`landed` 重做 E（`commitCandidate` 按 checkpointId 幂等）。
- **B 的重入**：`start-pending` 重启后先 `inspect`：`absent` ⇒ 发 accept；`accepted` ⇒ `running`；`unknown` ⇒ `unknown`。
  ccloop 对同一 envelope 的 accept 重放幂等（`webCcloopSmoke` 判据测过重放）。
- **只卡自己**：`unknown`、`blocked` 只影响该 run（及其依赖者自然不就绪）。`dispatchBlocked` 只由 legacy 分支与 projection／cleanup 置位。
- 读模型：`blocked` 与 `unknown` 在面板上显示理由（`blockedReason`／最后一次 inspect 结果）。

## 5. 落地

### 5.1 落地 worktree
- Orca 独占一个检出 `orca/<groupId>` 的 worktree：`<runsRoot>/landing/<groupId>`。分支不存在 ⇒ 从目标仓库当前 `HEAD` 的 commit 建（`git branch orca/<g> <sha>`，不 checkout 人的工作区）。
- 人若在别处 checkout 了 `orca/<groupId>`，`git worktree add` 会拒绝 ⇒ 该 run `blocked`（`blockedReason: "work-branch-checked-out-elsewhere"`）。
- **人的工作区、HEAD、main 一律不碰。**

### 5.2 干净合并
在落地 worktree 里：`git fetch <sourceDir>/repo <attemptSha>:refs/orca/incoming/<runId>`（从结果目录取对象）→
`merge --no-ff -m "orca: land <runId>" refs/orca/incoming/<runId>`（固定身份，hooksPath=/dev/null）。成功 ⇒ `landed`，记 `landedCommit`。
- **改动集越界检查**：沿用调度器 `harvest`／`netChangeSet`／`disposition`（`src/scheduler/harvest.ts`）对 contract 的 `targetPaths`／`allowlistPaths` 判定；越界 ⇒ `blocked`，不落。
- ⚠️ `landIntoW`（`src/scheduler/land.ts:87`）**不直接复用**：它要求目标仓库当前 checkout 的就是工作分支，并在人的工作区里 merge。本片复用的是它**之后**那一串（冲突物化与解冲突）。

### 5.3 冲突 ⇒ 单独 agent 解（**人裁**）
1. `merge --abort`；在一个**独立的 detached worktree**（`<runsRoot>/<runId>/conflict`）里用 `materialiseConflict`（`src/scheduler/reconcile.ts:114`）把冲突提交出来并 `pinConflictCommit`。
2. 对方是谁：`otherSideOf`（`src/scheduler/run.ts:348`）按已落地的 run 的改动集找；找不到或找到多个 ⇒ `blocked`。
3. `planReconciliation`：两边 `requiredChecks` 并集为空 ⇒ `blocked`（调度器既有规则，升人）。
4. `synthesizeReconcileContract` 生成解冲突 contract（构造上保证解冲突的不是当事任务）；**预算**：从 group 的**显式未分配预留**扣（控制器决定），不够 ⇒ `blocked`（`blockedReason: "reconcile-budget"`）。
5. **怎么跑**（控制器决定）：解冲突 run 不是 plan 里的 task，没有冻结的 `DispatchEnvelopeV1`，走不了 control 协议的 accept ⇒
   沿用调度器现成的 `runTask`（`src/scheduler/ccloopRunner.ts:205`，直接 spawn `ccloop run`）。它的 usage 记到 group。
   崩溃恢复：`reconciling` 重启 ⇒ 丢弃上次的解冲突工作目录、**重跑一次**（花费再扣一次，受预算约束）。
6. 跑完：`markersRemaining` 非空 ⇒ `blocked`；`rebuildMergeCommit` 得到合并提交；用两边 `requiredChecks` 并集在该提交上验证（调度器既有流程）；
   通过 ⇒ 落地 worktree `merge --ff-only` 到它 ⇒ `landed`。任何一步失败 ⇒ `blocked`，冲突提交留在 `refs/orca/conflict/<runId>`。

### 5.4 并发与顺序
驱动环一轮内按 `runId` 排序逐个落地 ⇒ 同一 group 的落地天然串行（一个进程、一次一轮），不需要锁；**执行**（ccloop 在跑）是并行的。
C 依赖 A ⇒ C 的 A 步在 A `settled` 之后才会发生（依赖就绪由既有 `deliverScheduledStart` 判定），它的 `base` 是含 A 的尖端。

## 6. ccloop 侧改动（**人裁「这一片一起改 ccloop」**；守 ccloop 自己的规则，改既有判据按本轮授权＋人裁 88 (b)(c)）

| # | 改什么 | 为什么 |
|---|---|---|
| C1 | `src/control/resultRepository.ts` 的 `cloneAt`：`clone --no-hardlinks` → 硬链接的本地 clone（`--local`） | 每个 run 一份整对象库拷贝是大仓库占盘的大头。⚠️ **动手前先读清 `--no-hardlinks` 为什么被选**（Rule 8；git log／spec）；若有承重理由，改成 `git worktree` 或登记为不可改，报人 |
| C2 | control 模式的 attempt ref 按 run 区分：不再是所有 run 共用的 `refs/ccloop/run/attempts/<n>` | worktree 方式下多个 run 共享一个 refs 空间；ccloop 在尝试 worktree 已删时按这个 ref 重建结果目录（`materializeResultRepository` 的 `rev-parse ref`），被别的 run 覆盖 ⇒ **拿错结果** |
| C3 | `tests/fixtures/fake-codex.mjs` 加一个脚本化模式：按 prompt 里的 taskId 从 JSON 脚本取「写哪个文件、写什么」 | 现有 `integration` 永远写 `answer.txt="42\n"`，造不出冲突、也解不了冲突，端到端判据没法覆盖冲突主干 |

⚠️ C1／C2 是 ccloop 生产代码；**只改这两处**，ccloop 的红线函数与人裁 83 的删锁条件不碰。改完跑 ccloop 的 `check-known-reds.mjs`，RC 0 才算过。

## 7. 判据

### 7.1 成功判据（命令，0／非 0）
env：Orca handoff §8.2（`ORCA_CCLOOP_BIN` ＝ **改过 C1–C3 的** ccloop 的 `clone --local`＋build）。
1. Orca：`npm run typecheck`；全量 vitest json ＋机械判定器（失败 ⊆ 已登记 flake、0 pending／todo、新 e2e 判据全 `passed`）；
   `verify:control`、`verify:web-control`、`verify:web-control:consumer`、`verify:scheduler`、`verify:chain`、web build、`verify:panel`、`--ws check`、
   `check-claude-md-lines`、`check-hooks-path` 逐段 RC 0；ledger validate RC ∈ {0,2}。
2. ccloop：`npm run typecheck`、`npm run build` RC 0；vitest json 过 `node scripts/check-known-reds.mjs` RC 0。

### 7.2 新判据（只列承重的；细目在计划里）
| # | 判据 | 场景 |
|---|---|---|
| E1 | **端到端**：`controlAssembly` 装出的进程内组件（port＝真 ccloop build＋脚本化 fake codex），临时目标 git 仓库、全部路径经 `ORCA_CONTROL_DIR` 改道；group 三个 task：A、B 互不依赖、写同一文件的不同内容，C 依赖 A。从 confirm 起**只让 pump 与驱动环自己跑**（测试不手调内部函数），断言：`orca/<g>` 上 A、B、C 的改动都在；冲突由一个解冲突 run 解掉；每个 run 进 `settled-*`；**`main` 与人的工作区 HEAD 逐字节不变**；C 的 `base` 含 A 的提交 | 同左 |
| E2 | worktree 方式与 clone 方式各跑一遍 E1 的「A 单独」子集；worktree 方式下目标仓库 `git worktree list` 在 settle 后不再含该 run 的 worktree | 同上 |
| R1 | 在 A／B／C／D／E 每个落盘点之后注入崩溃（沿用 `webFaults` 的做法），重启（recovery＋驱动环）后到达同样终态；**`dispatchBlocked` 不被 Web run 置真** | 每点一格 |
| R2 | `unknown` 只卡自己：一个 run 的 port `inspect` 恒 `unknown`，同 group 另一个无依赖 run 照常 settle | 合成 port |
| W1 | `set-workspace-mode` 改设置后，新进入 A 步的 run 用新方式，已有 run 不变；revision 冲突按名拒 | — |
| X1 | 落地 worktree 被人占用（分支已在别处 checkout）⇒ `blocked` 且理由为 `work-branch-checked-out-elsewhere` | — |

每新增一个分支，点名一条「删掉它自己」的变异，在 `git clone --local` 副本里看见红，记台账（缝 B 同格式）。

### 7.3 需改写的既有判据（本轮已授权，逐条记台账）
- `tests/control/webFaults.test.ts:266-291`「recovers an open run before anything listens, so the first request already sees a blocked store」—— 编码的正是被本片推翻的「Web run 全局卡死」。
- 其余由计划阶段 AST 扫出（已知候选：`tests/panel/controlRecoveryApi.test.ts:162`、`tests/control/webFaults.test.ts:173`、`tests/control/webDispatch.test.ts:112`、
  `tests/panel/webParity.test.ts` 的状态并集）。**每条改写：整条改写不许放宽；注释写 `// Execution driver (human ruling 2026-09-25: this round may rewrite criteria; ruling 88 (b)(c)): <编码的新事实>`。**

## 8. 已知风险与登记

- **真钱**：驱动环在 port `configured` 时会真的调 ccloop，ccloop 会真的调模型。判据一律 fake codex；真 codex 的活体验收归人。
- 解冲突 run 走 `ccloop run` 直调，崩溃即重跑，花费可能重复（受预算约束）。
- `refs/orca/*` 与 `orca/<groupId>` 留在人的目标仓库里（§3.5）。
- 同 group 同一时刻只一个驱动环进程：panel 单进程前提；**两个 panel 挂同一个 control store** 不在本片范围（既有 store 锁的行为不变）。
