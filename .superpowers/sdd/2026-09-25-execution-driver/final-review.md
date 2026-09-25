# 执行驱动一轮 —— 最终全分支评审

- 评审席：Claude Opus 5.5（只读；受控制器会话 `905e41ce` 派出），2026-09-25
- 范围：Orca `e1f2bc9..73d23c7`（16 笔，观测时 HEAD `73d23c71659b730456b3195abd2f759c7abba483`）；ccloop `3f66e81..9a91d2b`（观测时 HEAD `9a91d2b33fd7e7016b748aeace6be87ad50d4084`）
- 依据：spec `docs/superpowers/specs/2026-09-25-execution-driver-design.md`（§11 优先）、计划 §0／§0.1／Global Constraints、`progress.md` 台账、`house-rules.md`、Orca `CLAUDE.md`
- 方法：读 HEAD 上的源码（`executionDriver.ts`、`driverLanding.ts`、`workspace.ts`、`driveRecord.ts`、`workspaceSettings.ts` 全文；`budget.ts`／`recovery.ts`／`stopIntent.ts`／`controlLifecycle.ts`／`controlAssembly.ts`／`webDispatch.ts`／`checkpoints.ts`／`usage.ts`／`projection.ts`／`ccloopRunner.ts` 的相关段）、E2E 判据全文、ccloop 源码 diff。
  **本席没有跑任何测试、没有做变异**（变异席在另一处并行）。下面每条结论都是**读代码得出的**；标「未实测」的是推理链上有一环没量。行号是本席在上述 HEAD 上用 python 逐行定位的。

结论：**Critical 0／Important 6／Minor 13**。判定：**With fixes**（见文末）。

---

## 做得好的地方

- 状态机的每一步都是「外部动作 → 事务落盘」，且重入点按落盘字段判定（`prepared`、`executionId`、`findLanding`、`cleanedUp`），R1 五个崩溃点在真 ccloop 上逐个验到「与无崩溃同终态、`.calls` 不多」—— 主任务路径上没有找到会重复花钱的崩溃窗口。
- 与遗留路径的隔离做得干净：recovery 跳过、shutdown 豁免都以「驱动环存在」为参数（D7），未配置时 `driver===null`、目录不建、`knownRepository` 也被门住（73d23c7）。
- 落地只在自建的分离工作区里 merge、只靠 `update-ref new old` 前进分支；E1 逐字节断言人的 HEAD／index／文件不变。
- E1 断言的是**具体内容**（`A\nB`、`C`）、调用次数（10）、发布行 `delivered=1`、C 的 base 含 A —— 不是空绿。
- ccloop 侧 C2 按 D10「只加不改」，C4 的零用量只放在两处确实不调 provider 的分支，改动面很小。

---

## Critical

无。

---

## Important

### I1 一次 settle 就会抹掉 Web 组的超额（breach）阻断，驱动环随即继续派活
- 证据：`src/control/usage.ts:36` —— run 用量超 grant 时，Web 组只靠 `group.status="blocked"` 阻断（遗留组用 `stopped=true`）。
  `src/control/checkpoints.ts:90` —— `commitCandidate` **无条件** `group.status="review"`。
  `src/control/executionDriver.ts:441,457` —— `DISPATCHABLE_GROUP_STATES` 含 `review`，`replenishStartWakes` 据此补 wake。
- 后果：超额 run 自己在 C 步记 usage 置 `blocked`，同一个 run 到 E 步 `commitCandidate` 就改回 `review`，下一轮补 wake、领下一个 task。并行时任何别的 run settle 也会抹掉它。
  本片之前没有 Web run 能走到 `commitCandidate`（都卡在 `starting`），所以这是**本片新打开的暴露面**（D2 让这条路活了）。soft 模式下 ccloop 不硬性截断，这个阻断是组级唯一的刹车；下一步就是人用真 codex 做活体验收。
- 修法（任选其一，小）：`commitCandidate` 对 `"planHash" in group && group.status==="blocked"` 保持 `blocked`；或 `replenishStartWakes` 另查本组是否有 `breaches.length>0` 且未被人处理的 run。补一条判据：合成 port 报超 grant 的 usage ⇒ settle 后组仍 `blocked`、不再补 wake（变异：删掉守卫 ⇒ 红）。
- 未实测（读码推出，推理链每一环都有行号）。

### I2 CAS 的任何失败都被当成「尖端被人动过」—— 陈旧的 ref 锁会让整组落地静默空转，并反复花钱重跑解冲突
- 证据：`src/control/workspace.ts:109-114` `compareAndSwap` 吞掉 `update-ref` 的**所有**错误返回 `false`；`src/control/driverLanding.ts:68,102` 把 `false` 当 `moved`、本轮 `return false`（不 block、不记原因）；`driverLanding.ts:307-310` 解冲突落地时 `!swapped` ⇒ 回 `collected`、清掉 `reconcile`。
- 后果：`refs/heads/orca/<g>.lock` 残留（例如 Orca 在 `update-ref` 途中被杀 —— 正是崩溃场景）⇒ 该组每一轮都重建落地工作区、fetch、merge、然后 CAS 失败，永远没有 `blockedReason`，组内之后所有落地一起卡住。
  若这个 run 是解冲突过来的：`collected` → 再次冲突 → `beginReconcile` → **再派一次解冲突（花钱）** → 再 CAS 失败……只被 `reconcileAffordable` 截住，即把组的余量烧完为止。
- 修法：CAS 失败后再 `rev-parse` 一次分支；仍等于 `old` ⇒ 这是错误不是被抢，抛出（进 generic handler ⇒ `blocked`，原因带 git 的 stderr）；不等于 `old` 才是 `moved`。补判据：在目标仓库放一个 `orca/g.lock` ⇒ run `blocked` 且原因含 `lock`；变异：还原成吞错 ⇒ 红。
- 未实测。

### I3 解冲突的 `ccloop run` 不是 detached、stdio 接管道：面板正常关闭／Ctrl-C 很可能连带杀死它，其花费不入账、重启后再花一次
- 证据：`src/scheduler/ccloopRunner.ts:115` `spawn(..., { stdio: ["ignore","pipe","pipe"] })`，无 `detached`；对照 ccloop 自己的 control worker 是 `detached: true`（ccloop `src/control/workerLauncher.ts:60`）。
  `driverLanding.ts:186-190`：loop-state 非终态、pid 已死 ⇒ `spawn`；`driverLanding.ts:247` 先 `rm(workdir)`（连同那次的 `loop-state.json` 预算快照一起删）再重派。`driverLanding.ts:286` 只在**终态**时记账。
  同一进程内子进程非终态退出 ⇒ `runTask` reject ⇒ `driverLanding.ts:268` `reconcile-spawn:` 阻断，同样不记账；人 retry 后走上面的重派。
- 后果：spec §4 的前提「驱动环的 run 在 ccloop 那边是独立进程、跨 Orca 重启继续跑」对解冲突 run 不成立。终端里 Ctrl-C 会把 SIGINT 发给整个前台进程组；面板退出后管道关闭，子进程下一次写 stdout 会 EPIPE。于是一次**正常关闭**（不是崩溃）就会：①已花的解冲突 token 永不入组账（账面少记真钱）；②重启后整次重花。spec §9 只登记了「崩溃重跑可能重复花费」，没登记「不入账」，也没登记「正常关闭即触发」。台账 Task 9 的 register「background reconciliation outlives driver stop()」说反了方向：进程更可能**活不过**面板。
- 修法：`runTask` 给解冲突这条路加 `detached:true`＋stdio 写到 `reconcile-<runId>/` 下的 0600 日志文件＋`child.unref()`（与 ccloop worker 同形）；另外在 `spawn` 分支里，若 `record.pid!==null`（上一次确实起过）且 loop-state 非终态，先按 `tokenBudget` 全额记一笔 `pid-<pid>`（与 m4「拿不到剩余就记全额」同一规矩）再 `rm`。判据：起解冲突后 `shutdown()`＋`close()`，断言子进程仍活／或断言重派前那一笔已入账。
- 未实测（Ctrl-C／EPIPE 杀死子进程这一环没量；「不入账」与「rm 掉证据」是读码确定的）。

### I4 对「解冲突」阻断发 `recovery-retry` 是空操作，且会把一次失败的花费再记一遍
- 证据：`src/control/driveRecord.ts:86` retry 到 R 时把 `reconcile` 的 `pid` 清成 `null`、`spawning:false`，注释说「让下一轮重新决定」；但 `driverLanding.ts:187` `reconcileNextAction` 先看 loop-state：上一次的 `loop-state.json` 还在（只有 spawn 分支才 `rm`），终态 ⇒ 永远 `collect`，从不重派。
  `driverLanding.ts:286` 记账键是 `attemptSha ?? pid-${record.pid ?? "unrecorded"}`：第一次失败（无 attempt）按 `pid-<n>` 记，retry 后 pid 被清空 ⇒ 按 `pid-unrecorded` **再记一次**。
- 后果：`reconcile-terminal:*`／`markers-remaining:*` 这两类阻断，spec §2.3 承诺的唯一人工手段（run 级 retry）只会原样再 block 一次；无 attempt 的那类还多记一笔组账（台账 Task 6 minor「pid-unrecorded shared key」是同一个键的另一面）。`driveRecord.test.ts` 只钉了 `RESUME_STATE` 映射表，没有 retry-到-R 的行为判据。
- 修法：retry 到 R 时把 `reconcile.outcome`／终态记下的 spawn 键保留（不要清 pid），并把旧 `reconcile-<runId>/<reconcileRunId>` 目录改名归档（不删证据），使下一轮走 `spawn`（先做可负担性检查）；记账键改为不依赖可被清空的字段（例如 spawn 序号写进 record）。判据：终态 failed ⇒ retry ⇒ 断言重新 spawn 一次、组 `used` 只多一笔。

### I5 面板没有给「驱动环阻断的 run」任何 retry 按钮 —— spec §2.3 唯一的人工恢复手段在 UI 上够不着
- 证据：`web/src/ControlGroupView.tsx:93` 只把 `blockedReason` 拼进文字；run 级「Retry recovery」按钮只在 `recovery_blockers` 行上渲染（`web/src/RecoveryView.tsx:39,51`），组级按钮只在 `view.recoveryBlockers.length>0` 时出现（`ControlGroupView.tsx:180-186`）。驱动环 `blockRun` 只写 run body，**不写** `recovery_blockers`（`executionDriver.ts:120-128`）。
- 后果：面板上看得见「blocked — terminal:failed」，但点不到任何东西；人只能手搓带 token 的 HTTP 请求。
- 修法：`ControlGroupView` 对 `run.state==="blocked"` 渲染一个 `recovery-retry`（`{scope:"run", runId}`，target `{kind:"run"}`）按钮；`web/tests/workspaceMode.test.tsx` 旁加一条 SSR 判据断言按钮存在且 payload 形状正确。

### I6 Rule 17：`reconcile-<runId>` 这个仓库外写入点没在 spec 里具名登记；`conflict-<runId>`／`reconcile-<runId>` 在 run 成功 settle 后也永不清理
- 证据：spec §3.5（`2026-09-25-execution-driver-design.md:107-110`）残留清单只有 `<runId>`、`landing-`、`conflict-`，没有 `reconcile-<runId>`（它只出现在计划 Global Constraints）；`workspace.ts:31` 建它，`driverLanding.ts:159` 建为 0700。E1 `tests/control/executionDriverE2E.test.ts:221` 直接把「两者都留着」写成了断言。
  `conflict-<runId>` 是 `clone --local` 之后被 `materialiseConflict` 检出的完整工作树；`reconcile-<runId>` 里是 `runTask` 的又一份 clone＋ccloop 的 run 目录。
- 后果：CLAUDE.md Rule 17 第 3 条要求「仓库外的写入方要在 spec 里具名登记：写哪个路径、谁触发、失败留什么残留」—— 目前不满足。另外，人裁里明说过「私有 clone 太占磁盘，尤其非常大的仓库」；每发生一次冲突就永久多出至少两份完整检出，即使该 run 已成功落地、settle，也没有「现场」需要保留。
- 修法：**合并前必须**：在 spec 文末另起一节更正（原文逐字保留，Rule 13），登记 `reconcile-<runId>` 与两者的保留策略。**可推后**：settle＋`cleanedUp` 时一并 `removeOwnPath` 这两个路径（它们都在 `workspacesRoot` 下、由本驱动命名），E1 断言随之改成「已不在」。

---

## Minor

| # | 位置 | 问题 | 建议 |
|---|---|---|---|
| m1 | 计划 L4757-4769 `check-driver.py` 的 `EXPECTED` | 与现有判据数对不上：按 `it(`／`it.each` 数，`controlAssemblyDriver` 现 5 条（表里 2）、`executionDriver` 21（17）、`driverSettle` 9（7）、`driverRecovery` 8（7）；`web/tests/workspaceMode.test.tsx`（P8）不在表里 | 收口前按一次真跑的 vitest json **现量**重填（Rule 14：条数引用前现测），并确认 E2E 9 条在带 `ORCA_CCLOOP_BIN` 的环境下不是 skipped |
| m2 | `controlAssembly.ts:266-267` | 未配置时 `shutdown()` 现在先 `await inFlight`（泵的在飞一轮）再 `applyPanelShutdown`，时序不再与改前逐字节相同；另外 store schema 升到 v4、`GET /api/control/repositories/:id/workspace` 在未配置时答 404 `control-target-not-allowed` 而不是原来的无路由 | 行为上是变安全了；在 handoff 里把「逐字节相同」的表述收窄为「无驱动、无目录、无 recovery 跳过、无 shutdown 豁免」 |
| m3 | `executionDriver.ts:327` | C 步「有进展」判据是 `report.events.length>0`，不是 `highWater` 是否前进；若 ccloop 事件序号出现空洞，`recordUsage` 推不动 `highWater`，每轮拿回同一批事件 ⇒ `kick` 用 `setImmediate` 热循环、不停起 ccloop collect 进程 | 改为比较前后 `highWater` |
| m4 | `executionDriver.ts:562` | A1 里任何抛错（`readWorkspaceSetting` 的 `repository-settings-invalid`、plan 缺 `repoId` 等）落到 generic handler 时 `drive===undefined` ⇒ 只写 stderr，run 永远停在 `starting`、面板上没有原因（台账 Task 4「taskId===null 静默停」同形） | A1 失败时也建一个最小 drive 并 `blockedAt:"A1"` |
| m5 | `controlLifecycle.ts:144,149` | 豁免只作用于 run；正常关闭照旧给**每个组**写 `shutdown` 意图并 `stopped=true`（既有行为，计划 §0(f) 已量）。重启后 `starting`／未 accept 的 run 不动、不补 wake，直到人发 `resume-from-handoff`（`selections:[]` 合法）。没有判据走过「正常关闭 → 重启」 | 写进 handoff 与面板提示；补一条 E2E：shutdown → 重启 → 已 accept 的照常 settle、新派活需 resume |
| m6 | `recovery.ts:46,53` ＋ `projection.ts` `drainPending` | 一个 Web run 的发布若持续失败（`publishError`），重启时 recovery 的 `publishPending` 抛错 ⇒ `dispatchBlocked=true` 全库、直到下次重启。spec §4 明文允许 projection 置位，ERRATUM 的「不置 `dispatchBlocked`」对这条不成立 | 登记；或 recovery 对驱动环拥有的 run 的发布失败只记 `publishError` |
| m7 | `stopIntent.ts` `applyHandoffStop` | 人对有驱动 run 的组发 handoff-stop：run 被冻出 handoff 请求（④不投递）⇒ 停止状态永远 `handoff-pending`，`resume-from-handoff` 要求 `handoff-complete` ⇒ 组无法恢复；而驱动环照常把 run 落地、settle | 登记为 ④ 缺口的具体后果；面板上 handoff-stop 对这类组应提示只用 pause |
| m8 | spec §1／§11 D1 的诚实验收表述 | 缺两个限定：①默认预算下第一次冲突必然 `reconcile-budget`（D12，E1 靠 `set-limit` 加 10M）；②command verifier 的 task 需要 ccloop ≥ `9a91d2b`（C4），否则 `settle-incomplete` | 报人时把两条写进表述 |
| m9 | `executionDriver.ts:400-401` | `settle-incomplete` 阻断 retry 回 E 后，`commitCandidate` 以同一 `checkpointId` 命中已存在的 checkpoint 早退，run 仍非 settled ⇒ 再次阻断；retry 对它无效 | 登记；这类只能走 stop／recover |
| m10 | ccloop `src/control/resultRepository.ts` | C2 只读按 run 命名的 ref、无回退：升级窗口里由 C2 之前的 worker 跑、由之后的 ccloop collect 的执行，`rev-parse` 失败 | 登记（或回退到路径派生名并核 sha） |
| m11 | `web/src/App.tsx`（`controlConfig.repositories[0]`） | 工作区方式只对第一个受信仓库可见可改 | 多仓库面板按仓库渲染 |
| m12 | spec §5.1「人可以随时 checkout `orca/<g>`」 | 人 checkout 着 `orca/<g>` 时 CAS 前移分支，人的工作区看到的是「反向」改动；人若随后 `commit -a` 会把已落地的工作撤掉 | 在 handoff／面板里写明 |
| m13 | `workspace.ts:87,90`、`driverLanding.ts:150` | git 自建的 worktree／clone 目录是 umask 权限（通常 0755），不是 Rule 17 要求的显式 0700；外层 `workspacesRoot` 是 0700，实际不可达 | 登记即可（台账 Task 3 同条） |

---

## 台账「minor (deferred)」与「register」逐条分诊

| 台账条目 | 分诊 | 理由 |
|---|---|---|
| T1 `attemptRefNamespaces` Map 无淘汰 | 可推后 | 每个 control worker 进程只登记一个 runDir |
| T1 变异 C1-M1、C2-M1..3、C3-M1..2 未跑 | **合并前必须** | Rule 9 推论 1：没被看见红之前不是判据；变异席正在跑 |
| T2 `webParity.test.ts` 注释缺引用格式 | 可推后 | 只改了编译用 helper，没有改断言 |
| T2 提交信息称「No existing criterion is changed」 | 可推后（handoff 记更正） | 不许 amend；在 handoff 里记一句即可 |
| T2 `repositoryRevision` 重复校验且不查 `workspaceMode` | 可推后 | 读路径 `readWorkspaceSetting` 用 strict schema 全量校验 |
| T3 Rule 17「文件 0600」不适用 | 可推后 | 见 m13 |
| T3 `assertOwnPath` 保证的是「workspacesRoot 的直接子项」 | 可推后 | 名字都由 `runId` 派生，`runId` 为 `run-<uuid>` |
| T3 无带 `/`／`..` 的 runId 端到端判据 | 可推后 | 同上，runId 由 `randomUUID` 生成 |
| T4 accept 发出后、落盘前崩溃 ⇒ 不 inspect 直接重发 | 可推后 | ccloop 重放幂等已现量（计划 §0(e)，13/13），R1 `B-after-accept` 在真 ccloop 上 `.calls` 不多 |
| T4 `persistStatus`／`blockRun` await 后写入不复查状态 | 可推后 | 能改这些状态的外部写只有 retry，且只作用于 `blocked` |
| T4 `portFor`／`readStartEnvelope` 失败被记成 provider `unknown` | 可推后 | 10 轮后仍会 `inspect-unknown` 阻断，只是原因不准 |
| T4 `taskId===null` 的 run 在 A2／C 静默停住 | 可推后 | Web work run 的 `taskId` 来自 work item，恒非空；与 m4 一并处理更好 |
| T4 generic handler 里 `blockRun` 抛错会中止整轮 | 可推后（登记） | 需要 run body 损坏或写库失败才触发；但它是「一个 run 卡住全库驱动」的形状，登记 |
| T4 C 不核对 terminal outcome 与 candidate 的 `terminalOutcome` | 可推后 | E 用的是 `report.terminal.outcome`，两者同源于一次 collect |
| T5 D-after-cas 只用重建状态测过 | 已关闭 | T9 的 R1 `D-after-cas` 已经过真崩溃钩子，并独立数了 landing 数＝1 |
| T6 尖端移动会丢掉已付费的解冲突结果并重来 | 可推后（登记），但其「ref 锁」变体见 **I2 必修** | 正常竞争下以可负担性为界；无界的是 I2 |
| T6 `processAlive` 可能等到复用的 pid | 可推后（登记） | 概率低；后果是该 run 静默等待 |
| T6 CAS 与最终写之间崩溃丢 reconcile 记录 | 可推后 | 经 `collected`→`findLanding` 收敛到正确 `landedCommit`；只丢了 `reconcile` 字段 |
| T6 孤儿场景 `spawns()===0` 断言不会红 | 可推后 | 同一判据另有 `blockedReason` 断言承重 |
| T6 尖端移动分支无判据 | 随 I2 一并补 | I2 的修法会动这一支 |
| T6 `beginReconcile` 写输了留下副本与 runs 目录 | 可推后 | 下一次 `removeOwnPath` 重建 |
| T6 pid-unrecorded 共享键可能少记两次无 pid 的 spawn | **合并前必须**（并入 I4） | 同一个键在 retry 路径上会多记，I4 要改键 |
| T6 缺 `tokenBudgetRemaining` 分支无判据 | 可推后 | 分支本身是保守方向（记全额） |
| T7 `replenishStartWakes` 抛错中止全部组的一轮 | 可推后（登记） | 需要某组数据损坏；修法廉价（逐组 try/catch），建议顺手做 |
| T7 drive wake id 的 `LIKE` 未转义 | 可推后 | 只会多数，计数单调，不会撞 id |
| T7 P7 判据注释依赖旧夹具的轮次切分 | 可推后 | 注释问题 |
| T8 无驱动时冻住的 run 在之后启用驱动后仍冻着 | 可推后（登记进 handoff） | 升级后第一次启动的一次性状态；人可 retry |
| T9 后台解冲突活过 `stop()` | **合并前必须**（并入 I3） | 实际更可能是**活不过**面板，且不入账 |
| T9 SQLite ExperimentalWarning | 可推后 | 全仓既有 |
| T9 `conflict-`／`reconcile-` 目录无界保留、`reconcile-` 不在 spec §3.5 | **spec 登记合并前必须**；清理可推后 | Rule 17，见 I6 |
| T10 `sendWorkspaceMode` 不登记 command-uncertain | 可推后 | 有 `expectedRevision` CAS＋回读 |
| T10 发送路径无单元覆盖 | 可推后 | 建议抽纯函数，I5 的按钮可一并测 |

---

## 对 §1「诚实的验收表述」的核对

「在 fake codex、soft 组、estimator 已配置但其预估因 `contextWindowTokens:null` 为 `blocked-capability` 下，Web 派活能从 confirm 跑到 settle 并落到 `orca/<groupId>`」：
- E1／E2 在真 ccloop build＋脚本化 fake codex 上支持这句话，前提是 `ORCA_CCLOOP_BIN` 指向含 C1–C4 的 build（E2E 用 `describe.skipIf(!realBinary)`；门里必须确认它不是 skipped，见 m1）。
- 表述缺两个限定（m8）：有冲突时要先抬 token 上限（D12）；command verifier 需要 C4。
- 没有判据覆盖「正常关闭 → 重启」（m5），也没有覆盖 budget breach（I1）；这两条都不在表述里声称，表述本身不因此失真，但报人时应说明。

## 未实测、需要人或变异席确认的点
- I1、I2、I4 的完整链条是读码推出的（每一环有行号），没有造场景跑。
- I3 里「Ctrl-C／EPIPE 会杀死不 detached 的子进程」这一环没量；「非终态不入账」「重派前 `rm` 掉证据」是读码确定的。

---

## 合并就绪判定

**With fixes。** 主任务路径的状态机、崩溃恢复与落地 CAS 是扎实的，也有真 ccloop 端到端判据撑着；但有六个跨 Task 缝上的问题：
I1（超额阻断被 settle 抹掉）与 I3（解冲突花费不入账、正常关闭就会重花）直接关系真钱，而下一步就是人用真 codex 验收；
I2（陈旧锁让组静默空转、并能循环花钱解冲突）与 I4（retry 对解冲突阻断无效、还多记账）让「只卡自己、人可重试」这条承诺在某些路径上不成立；
I5 让这条承诺在面板上够不着；I6 是 Rule 17 的硬性登记缺口（只动文档即可）。
六条的修法都小且局部；另外合并前还要让变异席跑完 T1 的 ccloop 变异，并按现量重填 `check-driver.py` 的 `EXPECTED`（m1）。
