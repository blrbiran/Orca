# ⑤ 预算预估链：经 ccloop 单次调用执行估算 设计

- 作者：Orca 控制器会话 `f341f05f`（Claude Opus 5.5），2026-09-27
- 观测锚点：ccloop 主题行 `docs(handoff): the stream-usage round is reviewed; nothing here is waiting on the human but the push`；Orca 主题行 `Merge branch 'ui/panel-contrast'`
- 进度源：`.superpowers/sdd/2026-09-27-single-call-estimate/progress.md`（计划落地时新建）
- 路径：architectural（跨 ccloop／Orca，改 start envelope 线协议与 capabilities 应答，驱动环加一个 workKind）
- 人在对话里逐节认可了 §3–§8 的设计（2026-09-27，每节「同意，继续」），人裁见 §2。

## 1. 要解决的问题

Web spec（`2026-09-19-web-recoverable-control-design.md`）§2.1 目标 4、§5.3–§5.5 要求：导入 plan 后，模型预估经**同一条记过账的 ccloop 执行路径**跑一次，结果作为「建议」由人按字段／按任务／整体应用。今天这条链只落了一半（本节全部为 2026-09-27 现读，行号引用前须现测）：

- 导入（`src/control/planImport.ts`）与重估（`WebControlService.createEstimate`）会建估算记录；探测到的 `contextWindowTokens` 非 null 时进 `queued`，由 wake 调 `claimEstimate`（`src/control/webService.ts`）建一个 `phase:"estimate"` 的 run、写 `estimate-claim` outbox、把估算置 `running`。
- ⚠️ **`src/` 里没有任何代码执行这个 run，也没有任何代码调用 `completeEstimate`**（只有 `tests/control/estimator.test.ts` 手改 run 状态后调它）。`driverRunIds`（`src/control/executionDriver.ts`）只收 `phase === "work"`。
- ⇒ 估算永远停在 `running`，`scheduleStart`（`src/control/webDispatch.ts`）以 `estimate-in-flight` 拒 start。
- 今天能走到这里的形状：ccloop 给 claude 1M 答 `contextWindowTokens: 1000000`（ccloop `src/agents/claude.ts`）；codex 恒 `null` ⇒ 恒 `blocked-capability`，不卡。**claude 1M 的 estimator 槽 ⇒ 导入后组卡死**（推断，未实测，§8 Task 0 不量它，E1 的反面就是它）。
- 附带两处卡死（静态读出，未跑判据）：
  1. 冻结（handoff-stop／shutdown）时估算 run 的 handoff 请求没有消费方（`handoffRunIds` 只收 work run）⇒ 组永停 `handoff-pending`。
  2. 启动恢复（`src/control/recovery.ts`）在 `driverOwnsWebRuns` 下只跳过 `isWebWorkRun`；估算 run 没有 `start:` outbox ⇒ 进 `blocked` ⇒ **整个 store** `dispatchBlocked`（推断，§8 Task 0 实测）。
- ccloop 侧：`src/` 与 `docs/` 里没有任何估算路径（grep "estimat" 只命中两处「usage 不许估」的注释）。start envelope `protocol: 2`、`work = {contract: LoopContract, targetRepo, base, sourceDir}`、`.strict()`；worker 写死 `runLoop`；`RuntimeAdapter` 写死 plan/execute/verify，每阶段 schema 写死。

## 2. 人裁（2026-09-27，本会话）

| | 原话 | 含义 |
|---|---|---|
| S1 | 「A. 更多真 claude 形状 + B. ⑤ 预算预估链」「先做 B，再做 A」 | 本 spec 是 B；A 另起 |
| S2 | 「1，完整 ⑤」 | 不止血，做完整执行链 |
| S3 | 「2. 连应用建议一起做」 | 面板「应用建议」在范围内（§7） |
| S4 | 「同意方案一」 | 估算作为第二种活，走 control 生命周期（§3 方案比较） |
| S5 | 「允许改判据」（针对 §6.4 的 `reasonCode`） | 实测没有既有判据钉它，**授权未用上**（§6.4） |
| S6 | 「这个session 中如果有需要的话，我授权你改。」（针对改既有判据） | 本会话内需要时可改既有判据；每用一次：台账指名、整条改写不放宽、判据旁注释写明编码的是 S6 |
| S7 | 「ccloop 现在没有发布，暂时不用考虑兼容性」 | ccloop 只认 `protocol: 3`（§4.1） |

控制器替人定的、人在分节时认可的：通用名 `single-call`（§4 开头）；完成的估算 run 终态记 `settled-restartable`（§6.3）；JSON Schema 手写常量（§6.2）；冻结下已完成的调用仍记 `interrupted`（§6.5）；三个 `reasonCode`（§6.4）。

## 3. 方案比较（S4 选一）

1. **（选中）估算作为第二种活，走现成的 control 生命周期**：accept／inspect／collect／handoff／停机证明／恢复／记账与普通任务同一条路，正合 Web spec §5.3。代价：ccloop 要为非 `runLoop` 的活重建停机证明依赖的文件。
2. 把估算伪装成 LoopContract 走 `runLoop`：要 worktree、要跑三段，prompt 由 ccloop 从契约重拼，违反 Web spec §5.4「请求字节原样交出、不许重建」。否决。
3. ccloop 加同步命令 `control estimate`：没有持久 accept、inspect、handoff、停机证明，崩溃恢复与冻结都要开例外，冻结卡死仍在。否决。

## 4. 线协议

**通用名**：ccloop 不认识 Orca 的任何类型（「ccloop 不知道 Orca 存在」，Orca handoff §一）。ccloop 提供的是通用能力「按给定 prompt 与 JSON Schema 做一次只读结构化调用，并记账」，叫 **`single-call`**。估算的语义（请求、指令、`budget-estimate-v1`）全部留在 Orca。

### 4.1 start envelope `protocol: 3`

```ts
{ protocol: 3, claim, contractHash, inputCheckpoint, work }
work:
  | { kind: "loop", contract: LoopContract, targetRepo, base, sourceDir }   // 今天的四个字段 + kind
  | { kind: "single-call", prompt: string, responseSchema: object, maxOutputTokens: number, sourceDir }
```

- 两种 kind 都 `.strict()`。`responseSchema` 顶层必须 `type: "object"`（claude API 的要求，ccloop runner 注释已记），否则拒。`maxOutputTokens` 正安全整数。
- `single-call` 的 `inputCheckpoint` 必须是 `null`（不续跑，§6.5）。
- `claim` 不变（`agent`、`grant`、`configHash`…）；估算的 grant 即 Orca 的 `ESTIMATE_GRANT`（250,000 token／900,000 ms／1 attempt／1 session）。`contractHash` 照旧由 Orca 给、ccloop 只携带不校验（今天就是这样）。
- 🔴 **S7：ccloop 只认 3**。收到 2 ⇒ `control-protocol-unsupported`（exit 2）。已知后果（人已接受）：升级前已 accept、仍在飞的 run，Orca 存的是 protocol 2 的 envelope，升级后 inspect／collect 被拒、run 记 blocked。Orca 新建的 run 一律发 3，`loop` 的 envelope 由 `toStartEnvelope` 加 `kind: "loop"`。

### 4.2 prompt 由 Orca 拼好，ccloop 原样交出

- prompt ＝ 指令正文（按 `instructionVersion` 存在 Orca 的常量里）＋ `"\n\n"` ＋ 估算请求的 canonical 字节。Web spec §5.4 的「原样交出」落在这里：ccloop 不拼、不改。
- 今天 profile 里只有版本号 `"1"`，没有正文 ⇒ 本轮写出 v1 正文：读 plan 快照，按 `budget-estimate-v1` 给每个任务的 `work`／`handoff`（四维）、`complexity`、`confidence`、`rationale`、`assumptions`（排序去重），以及 `goalReviewReserve`、`groupRationale`；`planHash` 原样回显；`tasks` 与 plan 快照同序。
- profile 的 `instructionVersion` 不是 Orca 认得的版本 ⇒ 预检退回 `blocked-capability`（`estimate-blocked-capability`，现有 reasonCode）。
- **输入 token 的诚实性**：今天 `inputTokens` ＝ 请求字节按 tokenizer 比例取上界 ＋ `framingTokenOverhead`，没有指令正文。本轮把指令正文与分隔符的字节也按同一比例取上界加进去；超窗或超 grant 照旧 `input-too-large`。钉 `inputTokens` 具体数值的既有判据若因此变 ⇒ 按 S6 改写。
- ccloop 在调用记录里记 prompt 与 `responseSchema` 的 sha256；Orca 结算时比对（§6.3）。

### 4.3 收取结果不改 schema

`collect` 的 `candidate` 形状不变。结构化输出作为一个 evidence artifact 放进 `candidate.artifacts`；`candidate.handoff` 指向调用记录（§5.2）；Orca 用 `read-evidence` 按哈希取回。`terminal` 为 `null`（不写 `loop-state.json`；该字段本就 nullable）。

### 4.4 能力位 `singleCallExecution`

- capabilities 应答（七键 `capabilityViewSchema`，两边 strict）加第八键 `singleCallExecution: "v1" | null`，两边同时改。
- Orca 估算预检（`buildBudgetEstimateRequest`、`estimateCapabilityDegraded`）多一条：`singleCallExecution === null` ⇒ `blocked-capability`（`estimate-blocked-capability`）／claim 时退化（`estimate-capability-degraded`）。今天的 `handoffControl`／`handoffExecution` 两条保留不动。
- 某个 kind 的 descriptor 只有在「输出上限」与「关工具／只读」两件都能做到时才答 `"v1"`（§8 Task 0 量），否则 `null`。

## 5. ccloop 侧

### 5.1 accept

幂等、`resolveAgent`、`configHash` 比对、写 `envelope.json`、拉 worker —— 同今天。`single-call` 跳过所有 repo／契约校验。agent 的 `singleCallExecution` 为 `null` ⇒ 拒以 `single-call-unsupported`（exit 2）：Orca 预检漏了也挡得住。

### 5.2 worker 的 single-call 分支

在 `registerAttemptRefNamespace` 之前按 kind 分叉。不碰 git：不建 worktree、不物化结果仓库、不写 attempt ref。

1. 在 `sourceDir/run/` 下建空私有目录（`0700`）作 cwd。
2. 调 adapter 的 `singleCall({ prompt, responseSchema, maxOutputTokens, cwd, signal, onProcessRegistered })`。进程组、「先注册再写 prompt」、超时（安装记录的 `timeoutMs` 与 grant 的 `activeMs` 取小）复用阶段调用的机制。
3. 成功：`recordCompletedPhase`；写一条 `work` usage event，`cumulative` ＝ `{ tokens: tokenUsage, activeMs: 实测, attempts: 1, sessions: 1 }`，`tokenUsage` 为 null 则 `cumulative: null`。
4. 中止（handoff-stop 或请求 deadline）：有观测用量报观测值（stream-usage 一轮的 `observedTokens`）；没有 ⇒ `cumulative: null`。**从不当 0。**
5. evidence：成功时写结构化输出的 canonical JSON；总是写调用记录 `ccloop-single-call-record-v1`：`{ promptSha256, responseSchemaSha256, outcome: "complete"|"aborted"|"failed", outputRef, errorCode }`。
6. candidate：`handoff` ＝ 调用记录；`artifacts` ＝ [输出]（有时）；`result` ＝ `complete`／`partial`（中止）／`failed`；`terminalOutcome` ＝ `single-call-complete`／`single-call-aborted`／`single-call-failed`。
7. 写已释放的 owner-record（`leaseAffirmedAt: null`），seal ⇒ `proveStopped` 的四个条件都能成立。
8. 输出不合 `responseSchema`（adapter 解析失败）⇒ `outcome: "failed"`、无输出 artifact，用量照报。

### 5.3 handoff

worker 已有的轮询发现请求 ⇒ abort 这次调用 ⇒ 走 §5.2 第 4 步 ⇒ 回 `complete` ack。不做续跑。

### 5.4 adapter

`RuntimeAdapter` 加**可选**方法 `singleCall`；plan/execute/verify 一行不动。

- claude：runner 收到 `request.schema` 时用它代替写死的阶段 schema；输出上限与关工具按 Task 0 量出的办法。
- codex：把请求的 schema 写进 `schema.json`，强制 `--sandbox read-only`，输出上限按 Task 0。
- fake claude CLI、fake codex 加 single-call 模式：按请求 schema 回脚本给定的结构化输出；支持延迟；支持「先吐一条闭合消息再睡」（中止有观测用量）。

## 6. Orca 驱动环

### 6.1 纳入驱动

新增 `isEstimateRun(store, runId)`：`phase === "estimate"` 且有 `estimate-claim` outbox（与 `isWebWorkRun` 对称）。`driverRunIds` 多收它；`advance` 按 phase 分流，work 链一行不动。

### 6.2 estimate 链

| 步 | 做什么 |
|---|---|
| A1 | 同一函数：预留 provider attempt、记 `sourceDir`；strict 组照样拒。`estimate-claim` 与 `work-claim` 都是 `attemptReservation: 0`，形状相同 |
| A2e | 建私有 `sourceDir`；拼 prompt（§4.2）；`responseSchema` ＝ `budget-estimate-v1` 的**手写 JSON Schema 常量**；写 `protocol: 3`、`kind: "single-call"` 的 envelope；`prepared = true`。不建工作区、不建分支、不读目标仓库 |
| B／B′ | `accept`／`inspect` 原样；exit 2 ⇒ blocked |
| Ce | `collectInto` 原样（验哈希、归档、`recordUsage`）；见停机证明后结算（§6.3） |

JSON Schema 常量表达不了 `requireSortedUnique`，由 `validateEstimateOutput` 事后兜。常量与 zod 的一致性用「必收／必拒」两组样本的判据钉。

### 6.3 Ce 的结算

1. 读 `candidate.handoff` 的调用记录，`promptSha256`／`responseSchemaSha256` 必须等于 A2e 算出的值，否则 `blockRun("Ce", "single-call-prompt-mismatch")`，不结算。
2. `outcome === "complete"` ⇒ `rawOutput` ＝ 输出 artifact 的 JSON；否则 `rawOutput = null`。
3. `completeEstimate(groupId, estimateId, rawOutput, commitTerminal)`，`commitTerminal` 在同一事务里把 run 置 `settled-restartable`（`estimator.test.ts` 用的形状；「可重启」无实际后果，结算时 `active` 置 0）。合法 ⇒ `ready`，否则 `failed`（§6.4）。
4. 调用中止且无观测用量 ⇒ `unknown.work` 为真 ⇒ `completeEstimate` 抛 `run-stop-unconfirmed`、事务回滚（`commitTerminal` 一并撤销）⇒ Ce 接住它并 `blockRun("Ce", "estimate-usage-unknown")`，不在每轮重试里空转；估算停 `running`、组 `usageUnknown` 置真。这是 Web spec 对用量未知的既定处理（`tests/control/stopIntent.test.ts` 钉着），估算与普通任务一样。claude 的中止路径有观测用量，通常到不了这里。`completeEstimate` 抛的其他错误照 C 步今天的处理（异常冒出、本轮不推进）。

### 6.4 `failed` 的 `reasonCode`

今天 `validateEstimateOutput` 一律抛 `plan-version-conflict`，`completeEstimate` 把它写成 `reasonCode`。改为三个（`validateEstimateOutput` 返回原因，不再借用 `plan-version-conflict`）：

| 情况 | reasonCode |
|---|---|
| `rawOutput === null`（调用失败或中止） | `estimate-call-failed` |
| 不合 `budget-estimate-v1` schema | `estimate-output-invalid` |
| schema 合法，`planHash` 或 taskId 顺序与归档 plan 不一致 | `estimate-output-plan-mismatch` |

2026-09-27 现测（`grep -rn "plan-version-conflict" tests web/tests src`）：**没有既有判据钉估算的这个 `reasonCode`**（`estimator.test.ts` 只断言 `state`／`output`／`outputHash`；其余命中都是 executionSnapshot／planImport／webDispatch 各自同名的错误码）⇒ 只加新判据，S5 未用上。估算读回不变式（`readEstimateRecord`）对 `failed` 的 `reasonCode` 无约束，不改。

### 6.5 冻结、关机、恢复

1. **冻结**：`handoffRunIds` 多收有未结请求的估算 run，交给 `stepH`：`starting`／未 prepared 的 `start-pending` ⇒ 现有 `restartRun`；已 prepared 或 `unknown` ⇒ `inspectUnderStop`；`accepted` ⇒ 投请求给 ccloop、`collectInto` 取观测用量与停机证明。估算 run 的请求**一律以 `settled-restartable` 结算** ⇒ 现有 `terminaliseRun` → `interruptEstimate` 记 `interrupted` 并退回未用承诺。**停机到达时调用恰好已完成、输出也在 ⇒ 仍记 `interrupted`**，输出只作 evidence 留存（Web spec §6；避免 `completeEstimate` 与 handoff 结算抢同一个 run）；人可 Re-estimate。
2. **关机**：不改。含在飞估算的组照 §6.4 冻结（`tests/panel/shutdownDriverGroup.test.ts` 的 H7 钉着），冻结后由第 1 条接住。
3. **恢复**：`recoverControl` 在 `driverOwnsWebRuns` 下对估算 run 与 work run 一样跳过，交驱动环逐个对账。Task 0 先量「在飞估算 ⇒ 全局 `dispatchBlocked`」是否为真：真 ⇒ 这条改动有依据；假 ⇒ 只加防回归判据。钉着现行为的既有判据 ⇒ 按 S6 改写。

## 7. 面板「应用建议」

服务端不改：`proposal-edit` 已收 `provenance: "model"` ＋ `estimateId`，`verifyModelField` 逐字段核（估算 `ready`、`planHash` 一致、值等于建议）；组视图已下发估算 `output`。只改 `web/`。

- **显示条件**（缺一条则与今天逐字相同）：proposal `editable`；最新估算 `ready`；`output.planHash === view.plan.planHash`。
- **三种粒度**（Web spec §5.5）：格子下的「use N」（该字段）；每行「Apply row」（该行值不同的字段）；表下「Apply all suggestions」（全部值不同的字段）。都发**一条** `proposal-edit`，每个操作带 `provenance: "model"` 与 `estimateId`；值相同不发；无可发则不显示按钮。
- 只读的判断依据：每任务的 `complexity`／`confidence`／`rationale`／`assumptions` 与 `groupRationale`，放表下折叠区。
- 形状：仿 `editedOperations` 的纯函数 `suggestedOperations(view, scope)`（`scope`：field／row／all），只有它决定发哪些操作；组件只渲染与调用。应用不经 drafts；成功后来源显示为 `model est-…`（`provenanceText` 已有）。
- ⚠️ UI 线的两轮约束仍然有效（handoff §4.0.a）：四个分区始终挂载、非当前区只靠 `styles.css` 隐藏；`orca panel` 的 ready 行一字节不改。新增控件照深浅两套主题的 token 写。

## 8. 判据、变异与验收

### 8.1 Task 0（先量，每项一条命令，结果进台账）

1. claude／codex 各自「输出 token 上限」与「关工具／只读」的办法：先 `--help`，再用 fake 读 argv 核；要跑真 CLI 另问人。任一做不到 ⇒ 该 kind 答 `singleCallExecution: null`。
2. 在飞估算 ⇒ 重启时整个 store `dispatchBlocked`：真假。
3. `provenance: "model"` 的 `proposal-edit` 今天有没有真 store 判据。

### 8.2 ccloop 判据

- 协议：3 的两种 kind 可解析；2 被拒；多一个字段被拒；`responseSchema` 顶层非 object 被拒；`single-call` 带非 null `inputCheckpoint` 被拒。
- accept：`singleCallExecution: null` 的 agent 收 `single-call` ⇒ `single-call-unsupported`（exit 2）。
- worker 分支（都经 `collect` 读回）：成功（输出 artifact、调用记录、usage event、停机证明俱在）；输出不合 schema ⇒ `failed`；handoff 中止有观测 ⇒ `cumulative` 等于观测值；中止无观测 ⇒ `cumulative: null`；零写：不碰任何 git 仓库、不写 attempt ref。
- adapter：直接读 runner 实际传给 CLI 的 argv／env（stream-usage 一轮 N7 的做法），确认 schema 来自请求、输出上限与关工具生效。
- capabilities：八键应答 `toEqual` 钉死（改写既有的 `command.test.ts` 那条 ⇒ S6）。

### 8.3 Orca 判据

- 真 ccloop clone ＋ fake claude 的端到端（照 `tests/control/agentSelectionE2E.test.ts`）：
  - **E1** 导入 ⇒ 估算自动跑完 `ready` ⇒ start 不被 `estimate-in-flight` 拒 ⇒ 应用一条建议 ⇒ confirm ⇒ start。
  - **E2** 估算在飞时 handoff-stop ⇒ 估算 `interrupted`、未用承诺退回 ⇒ 组到 `handoff-complete`。
  - **E3** 估算在飞时重启 ⇒ 不全局 `dispatchBlocked` ⇒ 驱动环对账完。
- 单元：三个 `reasonCode`；prompt 哈希不一致 ⇒ block；JSON Schema 常量 vs zod 的必收／必拒样本；`singleCallExecution` 预检与退化；`inputTokens` 含指令正文；`protocol: 3` 的 `loop` envelope；§7 的 `suggestedOperations`（三粒度；值相同不产出；`planHash` 不一致整体不产出）与组件（显示条件、每种按钮发出的命令字面量）。

### 8.4 变异

每新增一个分支点名一条删掉**它自己**的变异，并**亲眼看到红**。表在计划里按 Task 列全；至少含：`single-call` 分叉、`singleCallExecution` 闸（accept 与 Orca 预检各一）、调用记录哈希比对、三个 `reasonCode` 各一、`handoffRunIds` 收估算、恢复跳过估算、`inputTokens` 加指令、`suggestedOperations` 的「值相同不发」与 `planHash` 守卫。变异只在单独的 `git clone --local` 里做，**不在被当作 `ORCA_CCLOOP_BIN` 的那份 clone 里做**。

### 8.5 门（只抄工具报数）

- ccloop：干净 clone，HOME 与四个 XDG 根改道，全量 ＋ `check-known-reds.mjs` RC 0，typecheck／build RC 0。
- Orca：全新 clone，先 `npm run build --workspace web`，夹具表 fake codex `integration` 模式；全量、web 套件、`verify:panel`；真 `~/.orca` 前后 `stat`。判 flake 记 `uptime`。

### 8.6 验收脚本

`scripts/live-driver-acceptance.ts` 加 `--scenario estimate`：profile 带 `estimatorPreflight`、claude 选 1M（估算才会 `queued`），检查估算 `ready`、start 放行、用量入账。先 `--fake-claude` 跑绿；真 claude 付费跑归 A 线，每次问人。

## 9. 不做（登记）

- 估算的续跑（被打断就是 `interrupted`，人 Re-estimate）。
- codex 的 `contextWindowTokens`（今天恒 null ⇒ codex 估算恒 `blocked-capability`，本轮不改）。
- 自动应用建议（Web spec §4.3：完成永不改 proposal）。
- strict 组（A1 照拒）。
- goal-review 等其他 single-call 用途（线协议留了口子，本轮不接）。
- `recovery.ts` 对非驱动环路径（`driverOwnsWebRuns` 为假）的估算 run 处理。

## 10. 挂账

- S7 的已知后果：升级前在飞的 run 升级后被拒（§4.1）。
- 冻结下已完成的调用被记 `interrupted`，那次花费白花（§6.5）。
- 中止且无观测用量 ⇒ 估算停 `running`、组 `usageUnknown`（§6.3 第 4 步，既定语义）。
