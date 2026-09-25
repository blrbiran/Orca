# ④ handoff 投递与续跑：让 `handoff-stop` 真的停下、留下检查点、并能接着跑 —— 设计

> **归属**：Orca 控制器会话 `af3dc0d3`（Claude Opus 5.5），2026-09-25。
> **人裁（本会话原话或逐项点选）**：
> - 「第二件先开A再开B」（B ＝ 本片）；
> - 范围「投递＋续跑」（投递人发的 `handoff-stop`、`resume-from-handoff` 之后的 continuation 由驱动环跑、顺手修 m5）；
> - 关闭后「自动接着派活」；
> - 实现「同意方案 1（handoff 是驱动环里的一步），但是你要考虑串行、并行 handoff 文件修改与继承的问题」；
> - 续跑的 base「方案X」（继承前一个 run 的 base）；
> - 「同意，写 spec。但是注意并行不一定只有两个并行。可能是多个」。
>
> **观测锚点**：Orca 主题行 `docs(sdd): record the first real-codex live acceptance of the execution driver` 那一笔；
> ccloop 主题行 `docs(handoff): roll the Orca section: the execution driver now calls control accept; four ccloop commits back it` 那一笔。
> **行号会移动 ⇒ 引用前现测。** 标「**控制器决定**」的是人没逐条点过、按 Rule 1 自决的；标「**Task 0 现量**」的是写 spec 时未量清、计划第一个 Task 必须先量并据实改落点的。
> 上游 spec：`2026-09-25-execution-driver-design.md`（§11、§12 优先于其正文）、`2026-09-19-web-recoverable-control-design.md`（§6.2–§6.4）。

---

## 1. 问题

执行驱动第一片把 Web run 从 `starting` 推到 settle，但 **handoff 请求有生产者、没有消费者**（控制器会话 `af3dc0d3` 现量）：

- 生产者：人的 `handoff-stop`（`applyHandoffStop` → `freezeRun`，`src/control/stopIntent.ts`）、优雅关闭（`shutdownGroup`，`src/panel/controlLifecycle.ts:126`）。它们写 `handoff_requests` 行（`request-pending`）与 `handoff-request` outbox。
- 消费者：`src/` 里调 `port.requestHandoff` 的**只有** `src/control/service.ts:156`（legacy `ControlService.requestHandoff`），而它**只有测试调**。Web 侧的 `deliverHandoffStop`／`beginHandoffAttempt`／`settleHandoffRequest`（`stopIntent.ts:464`／`:521`／`:605`）在 `src/` 里**零调用方**（python 逐行扫）。
- 驱动环只在 A1、B 看 `groupHeld`（`src/control/executionDriver.ts:184`、`:282`）⇒ 人对驱动环在跑的 group 发 `handoff-stop`：已 accept 的 run **照常落地、settle**，请求永远 `request-pending`，group 永远 `handoff-pending`，`resume-from-handoff` 拒（`group-state-invalid`），产品内无解（终审 m7）。
- continuation run 在 A1 被拒：`if (run.continuationIntentId) return refuse("continuation-unsupported")`（`executionDriver.ts:183`，第一片 D21）。
- 优雅关闭：驱动环的 run 已豁免（`controlLifecycle.ts:128`），但**每个 group 仍写 shutdown stop intent 并置 `stopped`** ⇒ 重启后要人发空的 `resume-from-handoff` 才恢复派活（终审 m5）。

**ccloop 侧已经具备的**（现量，ccloop 仓）：
- `control handoff`：落 `<sourceDir>/control/handoff-request.json`，答 `latched`，candidate 已在则答 `complete`（`src/control/handoff.ts`）。
- worker 在 **attempt 之间**停（`runLoop.ts` 的 `stop_requested` 分支，不写终态 `loop-state`），另有计时器在 `deadlineAt` 中止当前阶段（结果记 `partial`）；两种都在 `onRunSettledBeforeLeaseRelease` 里写出带 `stopProof` 的 candidate（`src/control/worker.ts`）。
  ⇒ **handoff 之后 collect 得到「有 candidate、无终态」**（`src/control/collect.ts` 的 `readTerminal` 对非终态返回 null）。
- continuation：envelope 的 `inputCheckpoint`（`predecessorRunId`／`checkpointId`／`checkpointHash`／`bundlePath`，`bundlePath` 必须在新 run 的 `<sourceDir>/input/` 下，`protocol.ts` 的 `validateEnvelopePaths`）⇒ `prepareContinuationContract` 把前任的 `unfinished`／`pendingDecisions`／`awaitingHuman` 写成 `continuation-input.json` 进 `relevantDocs`；
  `materializeFirstWorkspace`（`src/control/materialize.ts`）把 bundle fetch 进 `repoPath`、**在 `snapshot.head` 上**建第一个尝试工作区、逐字节还原工作树与 index 并核验。
  ⇒ *** **continuation 继承的是前任当时的 base ＋ 它的半截改动；这期间别的 run 落到 `orca/<g>` 上的东西，它看不见。** ***
- Orca 侧 `exportResumeBundle`（`src/control/resumeBundle.ts:75`）已存在，今天只被 legacy `service.ts` 用。

**Web spec §6.2 已定、本片照做、不重开的**：`handoffDeadlineAt` 缺省 `acceptedAt + 30 min`；每 run 七态；group 停止态的优先级；「可恢复」的五条硬条件；ccloop 的 `handoffExecution` 是 `mechanical-in-run-v1` ⇒ **handoff 本身零 provider 调用**。

## 2. 范围

**本片做**：① 驱动环投递 `handoff-stop`（第 3 节）；② `resume-from-handoff` 之后的 continuation 由驱动环跑（第 4 节）；③ **N 路并行**下的落地与解冲突（第 5 节）；④ 优雅关闭不再冻住驱动环的 group（m5，第 6 节）；⑤ ccloop 测试夹具 C5（第 8 节）。

**本片不做**（登记，第 10 节）：按上下文阈值触发的 handoff（ccloop 答 `contextObservation:"unavailable"`，`acceptContextObservation` 无调用方）；strict 组；打断解冲突 run；续跑前 rebase 到当前尖端（方案 Y）；⑤ 预算预估链。

**诚实的验收表述**（目标）：在 fake codex、soft 组下，对驱动环在跑的 group 发 `handoff-stop`，每个被冻结的 run 按它所处的步收口，group 到 `handoff-complete`；`resume-from-handoff` 之后，选中的任务由驱动环从各自的检查点续跑、落到 `orca/<g>`，**N 路并行时最终内容含每一路的改动**。**真 codex 下的 handoff 不在本片验收之内。**

## 3. 投递：驱动环里新增的一步 H

驱动环每轮对每个 run 先判「有没有这个 run 的未 settle handoff 请求」（`handoff_requests.run_id`，状态 ∈ `request-pending`／`latched`／`collecting`）。**没有 ⇒ 照常 A–E，行为逐字节同前。有 ⇒ 按 run 所处的步分流：**

| run 所处 | 做什么 | 请求的结局 |
|---|---|---|
| **未 accept**：`starting`／`start-pending`（A1／A2／B 之前，无 `executionId`） | 不调 port；释放本 run 预留；work 回 `ready`；本 run 若已建工作区则按 §3.5（上游）清理 | `settled-restartable` |
| **`unknown`**（B 的结果不明） | 先走既有 B'：`inspect` 判出 `absent` ⇒ 按上一行；`accepted` ⇒ 按下一行；仍 `unknown` ⇒ 等，计数同 B' | 同对应行 |
| **已 accept、C 中无终态** | `request-pending` ⇒ `port.requestHandoff`（请求体取自 `handoff_requests` 行：`requestId`、`reason`、`deadlineAt`）⇒ 答 `latched`／`complete` 即落盘 `collecting`；之后每轮 `collect`：<br>• 拿到**带 `stopProof` 的 candidate、无终态** ⇒ 按 Web spec 五条硬条件判定 ⇒ `settleHandoffRequest`；run 转 `held`（work `held`），**不落地**，记 `checkpointId` 供续跑<br>• 拿到**终态**（stop 生效前自然跑完）⇒ 回到正常 C→D→E | 满足五条 ⇒ `settled-recoverable`；缺证明 ⇒ `settled-unrecoverable`；宽限期后仍无任何结果 ⇒ `outcome-unknown` |
| **已 `collected`／`landed`／`reconciling`** | **不打断**：落地是本地短操作；解冲突 run 是独立 `ccloop run`，control 协议投递不到它。走完 D／R／E | run settle 时一并 settle 请求 ⇒ `settled-recoverable`；它的 work 是 `done`，**不进续跑选择** |

- **一条原则**：*** **一个 run 的改动，要么完整落地，要么完整留在检查点里交给续跑 —— 绝不半截落地。** ***
- **宽限期**（控制器决定）：`deadlineAt` 之后再等 `killGraceMs`（adapter config）＋ 60 s，仍 collect 不到任何 candidate ⇒ `outcome-unknown`。ccloop 在 deadline 自己中止阶段，所以正常路径不会走到这里。
- **C 步的无限等待改掉**：`stepC`（`executionDriver.ts:335`）今天在「无终态或无 stopProof」时只返回、下一轮再来。改为：**有 candidate（带 stopProof）、无终态、且没有本 run 的 handoff 请求** ⇒ `blocked`（`candidate-without-terminal`）。有请求时按上表处理。
- **handoff 与 `groupHeld`**：`handoff-stop` 置 `stopped` ⇒ 补 wake 与 A1／B 已经不为该 group 开新活（既有）；本片不改这一点。
- **崩溃恢复**：新增外部动作（`requestHandoff`、读 candidate、写 resume bundle）一律「先落意图 → 外部动作 → 落结果」。`requestHandoff` 对同一 `requestId` 幂等（ccloop 对同一请求重放答同值，不同请求答 `control-handoff-conflict` —— **Task 0 现量** 重放语义），所以「投递后、落盘前」崩溃重启可以安全重发。
- **Task 0 现量**：`settleHandoffRequest` 对 Web run 要求的输入（checkpoint 行、usage 结算、`unresolvedRequestIds`）是否由驱动环在 C 的 handoff 分支现有写入即可满足；run 转 `held` 的既有落点（`settleHandoffRequestInTransaction`，`stopIntent.ts:622`）是否同步 Web 台账（第一片 D2 同类问题）。

## 4. 续跑：驱动环接着跑 continuation run

`resume-from-handoff`（`applyResumeFromHandoff`，`src/control/continuation.ts:202`，要求 `handoff-complete`、每个选中的前任 `settled-recoverable` 且 work `held`）登记 continuation、臂 `resume` wake；pump 领出带 `continuationIntentId` 的 `starting` run（既有，`webDispatch.ts` 的 `deliverContinuationWake`）。本片改驱动环：

- **A1**：删掉 `continuation-unsupported` 那道门（`executionDriver.ts:183`）。预算从该任务剩余 grant 扣（Web spec 的 continuation 记账，**Task 0 现量** 与 A1 预留的衔接）。
- **A2（方案 X，人裁）**：对 continuation run
  - `base` **继承前任的 `drive.base`**，不现解析 `orca/<g>` 尖端；Orca 工作区建在该 base；
  - 用 `exportResumeBundle(store, { predecessorRunId, newSourceDir })` 在新 run 的 `<sourceDir>/input/` 下生成 bundle，得到 `inputCheckpoint`，写进完整 StartEnvelope（`toStartEnvelope` 今天对 continuation 填什么 —— **Task 0 现量**）。
  - 🔴 *** **不继承 base 就会错**：Orca 记下的 base 与 ccloop 实际起点（`snapshot.head`）不一致 ⇒ C 的越界检查（上游 §5.2）、D 的 `findLanding(base, …)`、`otherSideOfWeb` 的「base 之后落地的 run」全按错的 base 算。 *** 判据 H1 直接断言两者相等。
- **B–E**：与普通 run 完全相同。落地走 merge：继承的 base 是 `orca/<g>` 历史上的祖先，所以 git 有正确的 merge-base；与期间落地的兄弟改动冲突 ⇒ 第 5 节。
- **续跑链**：continuation 又被 handoff ⇒ 它的检查点快照已含前任的全部改动，下一个 continuation 照样继承；**base 始终是最初那个 run 的 base**。
- **前任工作区清理**：前任请求 `settled-recoverable` **且** 续跑的 resume bundle 已生成并通过 `exportResumeBundle` 自身的核验之后，才清前任工作区；否则保留现场（Rule 17 残留清单见第 7 节）。

### 4.1 串行（有依赖）

- A 被 handoff 后是 `held`，不是 `done` ⇒ 依赖 A 的 C 不会被领（既有依赖判定，**无新代码**；判据 H3 钉住）。
- A 的续跑落地后 A 才 `done`，补 wake 才领 C ⇒ *** **C 的 base 一定含 A 的完整改动，不会只含半截。** ***
- 人在 `resume-from-handoff` 时没选 A ⇒ C 一直等（依赖语义本身）。面板是否显示「C 等 A」—— **Task 0 现量**，没有就登记，不在本片加 UI。

## 5. N 路并行（人裁：「并行不一定只有两个，可能是多个」）

`handoff-stop` 冻结 group 内**全部**活动 run。N 个 run 各自按第 3 节收口、各自留检查点；`resume-from-handoff` 的选择是数组，N 个 continuation 各自在**自己前任的 base** 上续跑，续跑本身再次并行。**投递与续跑对 N 没有额外约束**；约束在落地。

### 5.1 现状对 N≥3 的两处缺口（现量）

1. **找冲突对方要求恰好一个**：`otherSideOfWeb`（`src/control/driverLanding.ts:114-134`）收集「本 run 的 base 之后落地、且净改动碰到冲突路径」的任务，`touched.size === 1` 才返回，否则 `escalate`（`blocked`＝`reconcile-other-side:<n>`）。
   `planReconciliation(a, b)`／`synthesizeReconcileContract(a, b, …)`（`src/scheduler/reconcile.ts:215`、`:318`）也只收两方。
   ⇒ 三路以上改同一文件：第三个落地的 run 与前两个都相交 ⇒ **卡死**。继承旧 base（方案 X）让「base 之后落地的」集合更大，这个缺口更容易触发。
2. **落地不按组串行**：一个 run `reconciling` 期间，同组别的 `collected` run 的 D 照常落地、推走尖端；解冲突跑完后 `finishReconcile` 发现尖端已动 ⇒ 清掉 reconcile 重新落地（`driverLanding.ts:322-325`）⇒ 可能再冲突、再起一次解冲突。*** **N 越大，重复的解冲突越多，每一次都是真钱。** ***

### 5.2 本片的做法

- **N1 · 对方是一个集合**（控制器决定）：`otherSideOfWeb` 返回**全部**相交的已落地任务（≥1）；零个 ⇒ 仍 `blocked`（冲突来自非 Orca 落地的提交，例如人手动改了 `orca/<g>`）。
  解冲突 contract 由「本任务 ＋ 全部对方」合成：`requiredChecks` 取**所有方的并集**，并集为空 ⇒ `blocked`（上游 §5.3(3) 同一规则的 N 元推广）；解冲突者**不是任何一方**（上游构造保证不变）。
  *** **只加不改**：新增 N 元的 `planReconciliationOf(sides)`／`synthesizeReconcileContractOf(sides, …)`；既有两元函数与 `orca run` 调度器路径一字不改。 *** 两元是 N 元在 N＝2 时的特例，判据 N-parity 钉「两者对同一对输入产出逐字节相同的 contract」（**Task 0 现量** 能否逐字节一致；不能则登记差异、不强求）。
  落地提交的消息从 `(reconciled with <task>)` 改为按任务 id 排序的逗号列表（N＝1 时字面不变，E1 的正则仍过）。
- **N2 · 每组同一时刻至多一个在「落地中」**（控制器决定）：同组已有 run 处于 `reconciling` ⇒ 其余 `collected` run 本轮不进 D，按 `runId` 序（上游 §5.4 既有顺序）排队。一轮之内的干净落地本就串行（上游 §5.4），推动尖端不会引发连锁，不受此限。
  ⇒ 解冲突期间尖端不会被兄弟推走；**一波 N 个续跑至多 N−1 次解冲突**，没有「尖端移动 ⇒ 重落 ⇒ 再冲突」的连锁。代价：一组内落地串行（执行仍并行）。
  尖端仍可能被**人**移动 ⇒ 既有 I2 处理（重读、只在尖端确实移走时重来）不变。
- **N3 · 预算**：每次解冲突前的可负担性检查不变（上游 §5.3(5)）。N 路续跑需要的解冲突预留 ≈ (N−1) × 解冲突 contract 的 `tokenBudget` —— **组上限不够时第 k 次解冲突被 `reconcile-budget` 阻断**，与第一片 D12 同形；面板照样显示原因。本片不改默认预留。

## 6. 优雅关闭（m5，人裁「自动接着派活」）

- `shutdownGroup`（`controlLifecycle.ts:126`）：若一个 group 的活动 run **全部**是驱动环的 Web work run（`isWebWorkRun`，既有）**且驱动环存在** ⇒ **不写 stop intent、不置 `stopped`**，该 group 条目记 `skipped: "driver-owned"`（**Task 0 现量** 条目 schema 是否封闭）。
- 组内还有任何非驱动环的活动 run（例如在飞的 `budget-estimate`）⇒ 照旧按 Web spec §6.4 全组冻结（行为逐字节同前）。
- 驱动环不存在（port 未配置）⇒ 行为逐字节同前。
- 重启后：驱动环照常 inspect／collect 在跑的 run，补 wake 照常派下一个任务，**无需人操作**。
- 已发布 spec 的更正：`2026-09-19-web-recoverable-control-design.md` 文末追加 `## ERRATUM (handoff delivery, 2026-09-25)`，点名 §6.4 的「shutdown 冻结每个 group、需人 resume」对「只含驱动环 run 的 group」不再成立；原文逐字保留。

## 7. 残留与 Rule 17 登记（在上游 §3.5／§12(a) 之上新增）

写到仓库外的：`<runsRoot>/<continuationRunId>/input/<bundle>`（`exportResumeBundle` 写；随该 run 的 sourceDir 归档）。
被 handoff 的前任：其工作区、`<runsRoot>/<runId>` 在第 4 节的清理条件满足前**保留**；不满足（`settled-unrecoverable`／`outcome-unknown`）⇒ 永久保留现场、路径进 run body、面板可见。
N 路并行的解冲突：每个解冲突过的 run 仍留 `conflict-<runId>`／`reconcile-<runId>` 一对（上游 §12(a) 已登记，无上限），**一波至多 N−1 对**。

## 8. ccloop 侧（守 ccloop 自己的规则；只加不改）

| # | 改什么 | 为什么 |
|---|---|---|
| C5 | `tests/fixtures/fake-codex.mjs` 脚本模式：脚本条目可带 `delayMs: { <phase>: <ms> }`，该阶段在写结果前 sleep；既有模式与无 `delayMs` 的脚本行为一字不改 | 今天 fake codex 每阶段瞬间完成，**造不出「阶段中途被停」**，H1／H2 的 handoff 永远会落在自然结束之后 |

ccloop 判据：`typecheck`、`build` RC 0；vitest json 过 `node scripts/check-known-reds.mjs` RC 0。红线函数与人裁 83 删锁条件不碰。
**Task 0 现量**：解冲突 run 的 fake codex 脚本键（E1 用 `reconcile-a-b`）在 N 元对方下如何命名。

## 9. 判据

### 9.1 成功判据（命令，0／非 0）
Orca：`npm run typecheck`；全量 vitest json ＋ 判定器（失败 ⊆ 已登记 flake：`controlShutdown` 的 SIGTERM 那条、负载下的 `executionDriverE2E`／`driverSettle` 计时红 —— 后两者单文件重跑绿才算；0 pending／todo；新判据全 `passed`）；
`verify:control`、`verify:web-control`、`verify:web-control:consumer`、`verify:scheduler`、`verify:chain`、web build、`verify:panel`、`--ws check`、`check-claude-md-lines`、`check-hooks-path` 逐段 RC 0；ledger validate RC ∈ {0,2}。
env：`ORCA_CCLOOP_BIN` ＝ 含 C1–C5 的 ccloop `clone --local` ＋ build（副本在会话 scratchpad）。

### 9.2 新判据（承重；细目在计划）

| # | 场景 | 防空绿的点 |
|---|---|---|
| H1 | 单任务在 execute 阶段中途（C5 `delayMs`）被 `handoff-stop` ⇒ `settled-recoverable`、run `held`、`orca/<g>` 不动 ⇒ `resume-from-handoff` 选它 ⇒ 续跑落地 | `orca/<g>` 最终内容 ＝ 前任半截改动 ＋ 续跑改动（fake 脚本分两段写）；续跑 run 的 `drive.base` ＝ 前任的 `drive.base`；续跑 envelope 带 `inputCheckpoint`；fake codex `.calls` ＝ 预期序列 |
| H2 | **三路并行**：A、B、D 互不依赖、都写 `shared.txt`（外加各自一个独占文件），全部在 execute 中途被 handoff，全部续跑 | 最终 `shared.txt` 含三路内容（按解冲突脚本）；**解冲突 run 恰好 2 个**；第二个解冲突的对方集合大小 ＝ 2（N1 承重）；**没有任何「尖端移动 ⇒ 清 reconcile 重落」**（N2 承重）：每个解冲突过的 run 的 `reconcile.spawnSeq` ＝ 1，且 `main..orca/<g>` 的 first-parent 提交数 ＝ 3（每个任务恰好一次落地） |
| H3 | 串行：C 依赖 A；A 被 handoff 期间 C 未被领；A 续跑落地后 C 的 `base` 含 A 的落地提交 | `merge-base --is-ancestor <A 续跑的 landedCommit> <C.base>`；A `held` 期间 C 无 run 行 |
| H4 | stop 时 run 还在 A1／A2 ⇒ `settled-restartable`、work `ready` | 该 run 的 provider 调用 0（`.calls` 不增） |
| H5 | stop 时 run 已 `collected` ⇒ 照常落地 ⇒ 请求 settle ⇒ 不出现在续跑可选集 | 分支尖端前进；group 到 `handoff-complete` |
| H6 | 优雅关闭 → 重启 → 无人操作即派下一个任务 | 无 stop intent 行；第二个任务 `settled`；group `stopped=false` |
| H7 | 组内还有非驱动环活动 run 时关闭 ⇒ 照旧冻结（§6.4 不变） | stop intent 存在、`stopped=true` |
| X1 | 无 handoff 请求时 collect 到「有 candidate、无终态」⇒ `blocked`＝`candidate-without-terminal` | 用合成 port；断言原因码与 `blockedAt` |
| N1u | 单元：`otherSideOfWeb` 在两个相交的已落地任务下返回二元集合（今天 `escalate:"2"`）；零相交仍 `blocked` | 直接量返回值 |
| N-parity | 两元与 N 元合成器对同一对输入 | 逐字节比较（或按 Task 0 现量登记差异） |
| R-H | 崩溃注入：`H-after-deliver`（`requestHandoff` 返回、`collecting` 未落盘）、`H-after-candidate`（candidate 已读、settle 未落盘）、`A2-after-bundle`（bundle 已写、envelope 未落盘） | 重启后到达同样终态；provider 调用计数与 ccloop run 目录数**不多于**无崩溃时 |

每个新分支点名一条「删掉它自己」的变异，**在 `git clone --local` 副本里**看见红，记台账（Rule 9、Rule 15）。
既有判据：**本片不授权改写**。`tests/control/executionDriver.test.ts` 里钉 D21 `continuation-unsupported` 的那条、`tests/panel/controlLifecycle.test.ts` 钉「shutdown 留下 `handoff-pending`」的那条、`tests/control/driverRecovery.test.ts` 相关条 —— 若与本片冲突，**计划阶段逐条列出，交人按人裁 88 指名**，不自改。

## 10. 登记（不修）

上下文阈值 handoff（ccloop `unavailable`）；strict 组；解冲突 run 不可被 handoff 打断；续跑不 rebase（方案 Y，人裁不选）；N 路续跑的解冲突无预留、上限不够时第 k 次被 `reconcile-budget` 阻断；
落地按组串行降低同组吞吐；`outcome-unknown` 的宽限期（`killGraceMs` ＋ 60 s）是控制器拍的；真 codex 下的 handoff 未验（deadline 默认 30 min，单 attempt 的 run 实际多半在 deadline 被中止、结果 `partial`）。

---

## 11. 评审后的更正（2026-09-25，控制器会话 `af3dc0d3`）—— **本节与 §12 优先于上文对应段落**

> **归属**：控制器会话 `af3dc0d3`（Claude Opus 5.5）。依据：一席只读独立评审（4C／9I／6M；报告在会话 scratchpad `handoff-spec-review.md`，不入库），观测于 Orca `64a05e1`、ccloop `f9267cb`。
> 控制器逐条复核了承重主张（C1 `stopIntent.ts:651-673`；C2 `resumeBundle.ts:78` 对 `continuation.ts:140`；C3 ccloop `handoff.ts:288` 与 `continuation.ts:145`；C4 `executionDriver.ts:282-294`；I4 ccloop `handoff.ts:151-152`；I6 ccloop `resultRepository.ts:69-77`；I7 `driverLanding.ts:169,225,325`；I8 `webProtocol.ts:1116-1123`；I9 `stopIntent.ts:660-673`），**全部成立，全部接受**。
> 上文逐字保留（本 spec 已发布，Rule 13）。

**(C1) 已完成的 run 的请求不走 `terminaliseRun`。** §3 表「已 `collected`／`landed`／`reconciling`」一行更正为：run 照常 settle（run `settled`、work `done`、承诺按 D2 释放），其请求以**新的一支** settle 为 `settled-recoverable` —— 只改请求行与 stop 状态，**不调 `terminaliseRun`**，不动 run、work、分配。H5 改为断言 `work.status==="done"`、`run.state==="settled"`、`drive.cleanedUp===true`，且之后依赖它的任务被领走。

**(C2) handoff 的收口是一个单事务步骤 H-settle。** §3「`settleHandoffRequest`；run 转 `held`」更正为：驱动环新增 H-settle，**一个事务内**：按 stepE 的方式归档快照（`archiveRun`）→ 提交 `result:"partial"` 的检查点（见 C3）→ 置 `recoverable`／`checkpointId` → 以 **Web 感知的预留规则把剩余承诺挂为 `held`（不释放）** → 请求 `settled-recoverable` → run `settled-recoverable`、work `held`。
不经 `commitCandidate`→`releaseRunReserve` 这条会释放承诺的路（两种顺序都会双计或破坏 `assertPredecessor`，评审 C2 已逐一证明）。
`exportResumeBundle`（`resumeBundle.ts:78`）对 Web 前任接受 `settled-recoverable`（今天只收 `settled`）。
⇒ 给 `2026-09-19-web-recoverable-control-design.md` 追加 `ERRATUM (handoff delivery, 2026-09-25)`，点名其 §11.1「`commitCandidate → settleHandoffRequest → assertPredecessor` 可满足」在第一片 D2 之后不再成立。
H1 加台账守恒断言：resume 前后 group `reserved` 与各分配的数额。

**(C3) ccloop 的 handoff 结果与 Orca 的检查点结果是两个词表。** 映射写死：**有请求、无终态的 candidate ⇒ Orca 检查点 `result:"partial"`**，不论 ccloop 的 `result` 是 `complete`（边界停）还是 `partial`（deadline 中止）；ccloop 的 `result` 只表示「handoff 这个动作干不干净」，照原样存进证据。
deadline 路径的「自己的请求 id 被列为未解决」**修在 ccloop（C6，见 §12(1)）**，Orca 不改写对端观测（执行驱动 spec §8.4 的规矩）。
§10 那句「单 attempt 的 run 多半在 deadline 被中止、结果 `partial`」按 C6 之后的语义读：它是**可恢复**的，不是死路。

**(C4) 「无 `executionId`」不等于「未 accept」。** §3「未 accept」一行拆为两行：
- `starting`，或 `start-pending` 且 `prepared:false` ⇒ 直接 restartable（见 I9）。
- `start-pending` 且 `prepared:true` ⇒ 先 `port.inspect`（同 B′）：`absent` ⇒ restartable；`accepted`／`stopped` ⇒ 按「已 accept」一行；`unknown` ⇒ 等，计数同 B′。
R-H 增加崩溃点：stop 之下的 `B-after-accept`。

**(I1) 补 `blocked` 一行。** 被冻结的 `blocked` run：有 `executionId` ⇒ `requestHandoff` 后按「已 accept」一行收口；无 ⇒ restartable（若从未 prepared）或 unrecoverable。无论哪条，请求**必须**到达已 settle 态或 `outcome-unknown`（后者可由 `recovery-retry` 接手）。新判据 H8：组内一个 blocked run ＋ 一个在跑的 run，stop 后到达终态 stop 状态。

**(I2) stop 之后的冲突落地**：见 §12(2)。

**(I3) 「有未完成请求」的判定用 `ADOPTABLE_STATES`（`stopIntent.ts:54`），含 `outcome-unknown`。** `outcome-unknown` 的 run 继续 collect，迟到的 candidate 照样 H-settle；**`outcome-unknown` 不杀 ccloop 进程**。

**(I4) 投递的请求体要原样重放。** `reason` 不在 `handoff_requests` 行里，取自 outbox 的 origin，映射 `handoff→human`、`shutdown→shutdown`。
投递时与 `collecting` 意图**同一次写入**持久化「实际发出的请求字节（或其哈希与所带 deadline）」，崩溃后一律重放这份字节 —— ccloop 按整个请求的规范哈希判重放（`handoff.ts:151-152`），重建出不同字节会得 `control-handoff-conflict`。
登记：投递之后再被缩短的 deadline（`adoptRequest`、`deliverHandoffStop` 会缩）**到不了 ccloop**。

**(I5) 崩溃窗口补齐。** C1、C2 都是单事务，故「检查点已提交、请求未 settle」的窗口不存在；另加一行兜底：**run `settled` 且请求仍开着 ⇒ 按 C1 那一支 settle 请求**。
`exportResumeBundle` 不幂等（第二次得 `resume-bundle-exists`，`resumeBundle.ts:143`）⇒ A2 遇已存在的 bundle **复用**：对检查点哈希重新核验后据以重建 `InputCheckpointV1`。
R-H 增加：`H-between-commit-and-settle`（防回归）、stop 下的 `B-after-accept`。

**(I6) 方案 X 保证的是「祖先」，不是「相等」。** §4 🔴 那句更正为：`drive.base` 是 `snapshot.head` 的**祖先**（快照 HEAD 可能是前任某次失败 attempt 的提交，ccloop `resultRepository.ts:75-77`）。
H1 改为断言 `merge-base --is-ancestor <前任 drive.base> <snapshot.head>`，且续跑第一个尝试工作区的 HEAD ＝ `snapshot.head`；另加一例「stop 落在一次失败 attempt 之后」。
续跑因此会在失败 attempt 的改动上继续（ccloop 的设计）；越界检查按 `drive.base` 算，会把失败 attempt 的改动一并算进去 —— **控制器决定接受**，登记。

**(I7) H2 的 N2 断言换成不会被重置的计数。** 解冲突 spawn 数取 fake codex `.calls` 里解冲突脚本的条目数、或 `reconcileRunsDirOf` 下的 spawn 目录数 —— 不用 `spawnSeq`（尖端移动那支会清零，`driverLanding.ts:325`）。
**既有 bug（上游代码）登记并在本片修**（控制器决定，因为 N3 的可负担性检查读的就是这个数）：`recordReconcileUsage` 的键 `reconcile-usage:<runId>:spawn-<spawnSeq>` 在重置后撞键，第二次解冲突的 token **不记到 group 上**。改为单调、不随重置清零的 spawn 键。

**(I8) 关闭**：见 §12(3)。

**(I9) restartable 是新代码。** `terminaliseRun` 今天把 restartable 也挂成 `held`（`stopIntent.ts:660-673`），任务会滞留、无出路。新增一支：restartable ⇒ 承诺留给该任务、work 回 `ready`、分配回 ready 态（A1 的「预留」只是 `providerAttemptOrdinal`，没有数额可「释放」—— 上文「释放本 run 预留」作废）。
估算器的 restartable（`tests/control/stopIntent.test.ts` 钉 `active:0` 的那几条）行为不变。
H4 改为断言 `work.status==="ready"`、分配状态，以及之后 resume＋start 为该任务领出一个新 run（不是只断言 `.calls` 不增 —— 那在 held group 里恒成立）。

**Minor**：
- M1：ccloop 不只在 attempt 之间停，每个阶段边界（plan／execute／verify 之后）都会停（`runLoop.ts` 的 `persistHandoffBoundary`）。
- M2：`settled-recoverable` 是 **run** 的 state，`held` 是 **work** 的状态；续跑匹配的是 Orca 自己的 `settle-…` 检查点 id，不是 ccloop ack 里的 `checkpointId`。
- M3：`otherSideOfWeb` 是 `driverLanding.ts:114-133`。
- M4：`toStartEnvelope` 写死 `inputCheckpoint: null`（`startEnvelope.ts:91`）⇒ 要加参数。
- M5：解冲突 contract 的 `objective.taskId` 是 `reconcile-${a}-${b}`（`reconcile.ts:361`）；N 元命名规则：`reconcile-<本任务>-<对方按 id 排序以 - 连接>`，N＝1 时与今天逐字相同（N-parity 依赖它）。
- M6：会红的既有判据以计划阶段现跑为准；评审读出的候选：`tests/control/executionDriver.test.ts:266`（D21，必红）、`tests/control/driverRecovery.test.ts:45-53`（条目形状随 §12(3) 变）；`tests/panel/controlLifecycle.test.ts:150-168` 多半不受影响。

## 12. 本会话的人裁（2026-09-25，逐条原话）—— 优先于上文与 §11

- m5「同意」；C5「同意」；既有判据「同意修改」⇒ **本片授权改写既有判据**，守人裁 88 的 (b)(c)：整条改写不许放宽、改后注释写明编码哪条人裁，逐条记台账；**ccloop 侧的既有判据按 ccloop 人裁 88 由人指名到具体测试**，计划阶段列出清单。§9 末段「本片不授权改写」作废。
- 「在 fake codex 之后再加 fake claude（如果必要可以一起将 claude 作为 agent 也调通）」＋「claude 单独开一片」⇒ **不在本片**。ccloop control 模式今天只接 codex（`accept.ts:91`、`worker.ts:107,153`），claude 走 control 需要 ccloop 另一笔改动，另立 spec。

**(1) deadline 路径（人：「ccloop 和 Orca 目前都未发布，你看怎么做是正确的」）⇒ 控制器决定：修在 ccloop，C6。**
理由：ccloop 的 `unresolvedRequestIds`（`handoff.ts:288,310`）在两个分支里恒等于「`result` 不是 `complete` 就列自己」，与 `result` 冗余，且与事实不符 —— candidate 已写出，**这个请求已被回答**。「被中途打断」由 `result:"partial"` 表达。
Orca 若把它读成「已解决」，就是改写对端观测，违反执行驱动 spec §8.4。

| # | 改什么 | 为什么 |
|---|---|---|
| C6 | ccloop `src/control/handoff.ts`：candidate 所回答的那个请求**不列入** `unresolvedRequestIds`；`result` 语义不变 | deadline 中止的 run 今天永远不可恢复，group 停死在 `handoff-partial` |

钉旧行为的 ccloop 判据按 ccloop 人裁 88 列出、由人指名后整条改写。

**(2) stop 之后的冲突（人：「倾向于起。如果花费未超就起，花费超了上限就不起」）。**
开着请求的 run 在 D 冲突时：可负担性检查（执行驱动 spec §5.3(5)）通过 ⇒ 照起解冲突；不通过 ⇒ `blocked`＝`reconcile-budget`，其请求按 §11(I1) 的 `blocked` 一行收口（有完整成果，按 C1 那一支 settle 为 `settled-recoverable`，run 保持 `blocked` 供人 `recovery-retry`）。
登记：stop 之后最多再起「stop 时 `collected` 的 run 数」次解冲突。

**(3) 关闭（人：「同意，空闲的也跳过」）。**
「驱动环的 group」＝ 有 `planHash`、已 `start` 过（存在 start wake）、且驱动环存在。这样的 group **不论有无活动 run** 都跳过，不写 stop intent、不置 `stopped`；其他 group 照旧（Web spec §6.4 逐字节同前）。
**线上契约变更（人已同意）**：shutdown 条目的 `disposition` 枚举（`webProtocol.ts:1116-1123`）加值 `skipped-driver-owned`，`web/src/controlTypes.ts` 同步；§6 的「`skipped: "driver-owned"` 字段」作废，以本条为准。

**判据增补**（在 §9.2 与 §11 各条之上）：H8（§11 I1）；C6 的 ccloop 判据（deadline 中止的 candidate `unresolvedRequestIds` 为空、`result` 仍为 `partial`，并配一条删掉修复就红的变异）；E2E 一例「deadline 中止 ⇒ 可恢复 ⇒ 续跑落地」（C5 `delayMs` 大于请求的 deadline）；重复解冲突的 token 全部记到 group 上（§11 I7）。
