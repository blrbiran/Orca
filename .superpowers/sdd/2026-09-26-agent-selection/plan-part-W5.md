# 计划分片 W5 —— T8／T9／T10／T11（Orca：分层解析纯函数、偏好表与命令、plan 文件与导入、异步确认与冻结）

> **归属**：Orca 控制器会话 `75ec878e` 派出的计划写作席 W5（Claude Opus 5.5），2026-09-26。
> **观测锚点**：Orca 主题行 `chore(checkpoint): orca-dev-75ec878e, level 335434 of 1000000 (T1 330000, T2 450000, band 1)`（写作时 HEAD，`/usr/bin/git log -1 --format='%h %s'` 现测 `545f452`）。**行号会移动 ⇒ 实施席引用前现测**；本分片所有 file:line 都在该提交上量过（命令见 §W5.0 表）。
> **本分片只写计划，不改任何仓库文件。** 探测只在 `git clone --local` 副本 `scratchpad/W5/orca-w5`（`node_modules` 软链主树）里做过 `vitest list`（只收集、不执行）。
> **「将变红的既有判据」是静态预测**（按调用关系逐行映射，映射脚本见 §W5.0 末），不是实跑结果；每个 Task 都有一步「改前在副本里跑这几个文件、看见红」，以实跑为准（Rule 9、Rule 12）。

变量约定（每个 Task 的命令都用它）：

```bash
S=/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/75ec878e-a6d3-4299-9a4b-b76dd574b77a/scratchpad/impl
mkdir -p $S
ORCA=/Users/biran/code/skills/loop/Orca
```

---

## W5.0 现量

### 量了什么（本分片的步骤依赖这些）

| # | 事实 | 位置（HEAD `545f452`） | 命令 |
|---|---|---|---|
| 1 | canonical JSON 与哈希：`canonicalBytes`／`sha256Canonical`；对象值为 `undefined`、非安全整数一律 `control-non-canonical-json` | `src/control/canonicalJson.ts:22-80` | `cat -n src/control/canonicalJson.ts` |
| 2 | `CapabilityViewV1` 是 `webProtocol.ts` 的 `capabilityViewSchema` 推出的类型（7 字段，无 `protocol`）；`capabilitiesSchema` 是它 `+protocol:2` | `src/control/webProtocol.ts:76-96`、`:1199` | `Read webProtocol.ts 1-420` |
| 3 | 迁移：`schemaVersion = "4"`；链 `1→2→3→4`；**`store.ts` 另有一处硬编码可接受版本表** `version !== schemaVersion && version !== "1" && version !== "2" && version !== "3"` | `src/control/migrations.ts:3,60-72`；`src/control/store.ts:86` | `cat -n migrations.ts store.ts` |
| 4 | 命令台账 scope 只有 `group`／`global`／`repository` 三种；revision 三处取法（preflight、apply 前、apply 后）都写成 `repoId !== null ? repositoryRevision(...) : groupId === null ? 0 : …` | `src/control/commandLedger.ts:40-48`（scope）、`:54-60`（`repositoryRevision`）、`:113-117`、`:255-257`、`:324-325` | `Read commandLedger.ts` |
| 5 | `set-workspace-mode` 是「设置型命令」的现成形状：`authorityChanged:false`、`projectionGroupIds:[]`、`projectionSeq:null`、`commandRevision` 取设置自己的 revision | `src/control/workspaceSettings.ts:29-58`；`webProtocol.ts:1153-1164`（`projectionless`） | 同上 |
| 6 | 动词、目标、raw／effective 两套 variants、结果 kind 都是封闭枚举 | `webProtocol.ts:517-532`（verbs）、`:534-542`（targets）、`:662-713`（variants）、`:715-731`（`refineCommandIdentity`）、`:1047-1137`（results） | 同上 |
| 7 | 错误码是封闭目录：`ControlError` 的 `code` 类型是 `KnownControlErrorCode`；新码必须进 `durableCommandErrorStatuses` 或 `nonDurableControlErrorClassifications` 之一（`errorClassification.test.ts` 核两边不重叠） | `src/control/errors.ts:8-123,129-193,251-260` | `sed -n 1,260p errors.ts` |
| 8 | plan 文件 schema：任务 `configHash` 可选、`.strict()`；控制导入要求 `targetVersion` 与 `configHash` 都在（`task-control-metadata`） | `src/scheduler/planFile.ts:10-16,30-42,102-128,221-258`（`:240`） | `cat -n planFile.ts` |
| 9 | `ControlPlanV1.tasks[].configHash: hashSchema`（进 `planHash`） | `webProtocol.ts:371-392`（`:384`） | — |
| 10 | 导入：同步 `importControlPlan` 在 `apply` 里读源、写 work item（`configHash: task.configHash`）；异步 `importControlPlanAsync` 先 `preflightWebCommand`，再 `profileRouter.probe(profile)`，把观测注入同步版 | `src/control/planImport.ts:24-40,154-242,258-286`（`:210`、`:274`） | `cat -n planImport.ts` |
| 11 | 估算 run 的 `configHash: estimate.profile.profileHash`（`configHash` 的第二种意思） | `src/control/webService.ts:291-292` | `sed -n 200,452p webService.ts` |
| 12 | `confirm` 是**同步**的（`applyWebCommand` 一次事务），面板路由 `case "confirm": service.confirm(command)` 不 await | `webService.ts:387-433`；`src/panel/controlApi.ts:243` | `sed -n 165,264p controlApi.ts` |
| 13 | 面板操作者身份：`meta.panelOperatorId`＝`operator-<uuid>`，就是面板发出的每条命令的 `actorId` | `controlApi.ts:175-184,238` | 同上 |
| 14 | 估算预检：`buildBudgetEstimateRequest` 以 `intersectCapabilities(declared, observation.observed)` 判 `blocked-capability` | `src/control/estimator.ts:62-94` | `sed -n 40,121p estimator.ts` |
| 15 | 执行快照 schema 在 **`webProtocol.ts`**（不在 `executionSnapshot.ts`）：`schema: "orca-execution-snapshot-v1"`；`prepareExecutionSnapshot`／`readConfirmedTaskExecution` 在 `executionSnapshot.ts` | `webProtocol.ts:420-480`；`src/control/executionSnapshot.ts:28-47,215-252,275-299` | `cat -n executionSnapshot.ts` |
| 16 | `readConfirmedTaskExecution` 的消费者：`executionDriver.ts:231,435`、`driverLanding.ts:167`、`schedulerBridge.ts:146` | — | `grep -rn readConfirmedTaskExecution src` |
| 17 | 面板读模型：`workBodySchema.configHash: hashSchema`、`persistedRunSchema` 是 `.strict()`（新 run 字段不加进去就整组 `blocked`）；`workViews` 用 `body.configHash !== task.configHash` 核身份；`runViews` 用 `work.configHash !== run.configHash` | `src/panel/controlViews.ts:56-71,107-144,288-354,378-425,525-534` | `sed -n` 各段 |
| 18 | profile 快照 v1 的 adapter 身份字段与「codex 必须 phase-end／soft」约束 | `webProtocol.ts:98-168`（`:108-110`、`:128-132`、`:143-150`） | — |
| 19 | 路由器探测：`router.probe(profile)` 调 `port.probeProfileCapabilities()` 并与声明求交；失败折成 `probeFailureCode` | `src/control/profiles.ts:14-31,88-106,147-167` | `cat -n profiles.ts` |
| 20 | **能力闸门的全部调用点**（`grep -rnE "\.probe\(|probeProfileCapabilities|\.capabilities\(\)|assertCapabilities|handoffGraceMsOf|intersectCapabilities" src web/src scripts`，结果写 `scratchpad/W5/grep1.txt` 整份读回）：`webDispatch.ts:85,165`；`dispatch.ts:52,77`；`service.ts:77-78,83-90,125-127(schedulerBridge)`；`stopIntent.ts:562`；`webService.ts:228,266`；`planImport.ts:274`；`controlConfig.ts:206`；`budget.ts:84-88,105` | 见左 | 见左 |
| 21 | `handoffGraceMsOf(adapterConfigPath)` 读 adapter 配置文件的 `killGraceMs`；装配把结果作为 `handoffGraceMs` 传给驱动环；驱动环缺省 `HANDOFF_EXTRA_GRACE_MS` | `src/panel/controlAssembly.ts:111-124,257`；`src/control/driverHandoff.ts:30,179-189`；`src/control/executionDriver.ts:66-67` | `grep -rn handoffGraceMs src` |
| 22 | web 端有一份**编译期互相可赋值**的镜像：`tests/panel/webParity.test.ts` 让 `CommandSuccessV1`、`ConfirmPayload`、`GroupViewV1` 等在 `src/` 与 `web/src/controlTypes.ts` 之间双向赋值（`npm run typecheck` 检查该测试文件）；`web/src/controlTypes.ts:74-79`（`WorkItemViewV1.configHash: string`）、`:201`（`ConfirmPayloadV1`）、`:228`（verb 联合） | 见左 | `sed -n 40,140p tests/panel/webParity.test.ts` |
| 23 | web 的确认按钮在 `web/src/BudgetEditor.tsx:106-146` 拼 confirm payload | 见左 | `sed -n 95,150p BudgetEditor.tsx` |
| 24 | 测试夹具：`tests/control/fixtures/web.ts`（`webFixture`：写 plan 带 `configHash: sha256Canonical({})`、profile v1、同步 `importControlPlan` 注入 `estimatorObservation`、同步 `confirmPayload()`）被 `driverHarness.ts`、`ccloopWorld.ts`（间接）及 20 余个测试文件用；`tests/panel/fixtures/controlPanel.ts:98`（plan 带 `configHash`）、`:117-136` | 见左 | `cat -n tests/control/fixtures/web.ts` |
| 25 | `service.confirm(` 的调用点：36 处（`src/panel/controlApi.ts:243` ＋ 测试 35 处，列表 `scratchpad/W5/confirm-calls.txt`） | — | `grep -rn "\.confirm(" tests src web/src` |
| 26 | vitest 判据全名：`./node_modules/.bin/vitest list <50 个文件>`（副本里跑，只收集），523 条，存 `scratchpad/W5/list-all.txt` | — | 见左 |

映射脚本（把「改动行」映射到它所在的 `it` 或顶层 helper，再把 helper 的调用点映射到 `it`）：`scratchpad/W5/enclose.mjs`；结果文件 `confirm-map.txt`、`helper-map.txt`、`profile-its.txt`、`redsT9.txt`、`redsT10.txt`、`redsT11-confirm.txt`、`redsT11-other.txt`（同目录）。**`it.each` 的标题脚本匹配不上，已按 `list-all.txt` 手工补齐。**

### 与 spec／骨架不符之处（**控制器裁定**；本分片正文按「建议」一栏写，裁定不同就改对应 Task）

| # | 不符 | 建议 |
|---|---|---|
| **W5-M1** | 骨架把 `PartialSelection`／`AgentResolution`／`AgentsView` 等类型放在 T8 的 `src/control/agentSelection.ts`，而 T7（波 2）的 `ExecutionPort.resolveAgent(partial): Promise<AgentResolution>` 要用它们；T8 排在波 3。 | **T8 先于 T7 落地**（T8 无依赖、纯函数、不碰线上形状）。或 T7 只建该文件的类型部分、T8 补函数——两席写同一文件，不推荐。 |
| **W5-M2** | 骨架写「`probeProfileCapabilities` 与无选择的 `capabilities()` 被**删除**」，删除在 T7；但它们的调用点（`router.probe`、`dispatch.ts:52,77`、`service.ts`、`stopIntent.ts:562`、`webDispatch.ts:85,165`、`webService.ts:228,266`、`controlConfig.ts:206`）按分工在 T11 才换成冻结选择 ⇒ **T7 与 T11 之间树编译不过**。 | 二选一：(a) T7 同时把 `router.probe` 改成 `probe(profile, selection?)`（可选参）并把所有调用点临时写成 `probe(profile)`（其内部行为由 T7 定），T10 用上可选参、T11 改成必填并逐点换冻结选择——**本分片按 (a) 写**；(b) 把「路由器签名＋全部闸门调用点」整体并入 T7。T11 的每处改动都以「改后代码」给出，T7 若已改过同一行，以 T11 的改后代码为终态。 |
| **W5-M3**（**已裁 W6-8**） | 骨架 `set-agent-preferences` 的 payload 是 `{expectedRevision, preferences}`，与命令信封顶层的 `expectedRevision`（台账 CAS 用的那一个）重复。 | 控制器裁定 W6-8：payload 只有 `{preferences}`，信封的 `expectedRevision` 对 `agent_preferences.revision` 核。本分片按此写（T9）。 |
| **W5-M4**（**已裁 W6-20**） | 骨架没给「plan 层」与「面板任务层」的存放位置。spec §6.2「同一层 plan 与面板逐字段合并」、`partial:null` 清除该层。 | 控制器裁定 W6-20：本轮**不拆** plan 层与面板层（登记 §11）。存放：组记录 `agentOverrides: GroupAgentOverrides`（导入时由 plan 顶层 `agent`／`estimatorAgent`／`reconcileAgent` 初始化，`proposal-set-agent` 整层替换或清除）；work item `agentOverride: PartialSelection \| null`（导入时由 plan 任务 `agent` 初始化，同上）；`ControlPlanV1` 带可选的这四个字段（进 `planHash`，导入的来源）；估算记录 `estimatorSlot: FrozenSlot \| null`。面板层写入是**整层替换**，不与 plan 值逐字段合并——这是对 spec §6.2「逐字段」的已登记偏离。 |
| **W5-M5** | T10 删 plan 的 `configHash` ⇒ 草稿 work item `configHash:null`；但写入冻结 `configHash` 的是 T11 的 confirm ⇒ **T10 提交后、T11 提交前，所有「确认之后」的判据都红**（run 行 `configHash:null` 过不了 `persistedRunSchema`、`startEnvelopeSchema`、`ownership`）。 | 把「删 plan／`ControlPlanV1` 的 `configHash`、草稿 `configHash:null`、读模型随之改」**移进 T11**（与冻结同一提交）；T10 只**加** `agent` 等字段、导入时冻结 estimator、估算 run 的 `configHash`、`proposal-set-agent`，并**继续接受** plan 的 `configHash`。本分片按此写（T11 Step 11.3）。 |
| **W5-M6** | 执行快照 v2 的 schema 在 `webProtocol.ts`，不在骨架写的 `executionSnapshot.ts`；骨架的 schema 名清单里没有执行快照 v2 的名字。 | schema 名用 `orca-execution-snapshot-v2`（沿用 v1 命名）；schema 改在 `webProtocol.ts`，构造与读取改在 `executionSnapshot.ts`。 |
| **W5-M7**（**已裁 W6-1／W6-2／W6-3／W6-7**） | 本分片需要骨架之外的导出。 | 按裁定：`src/control/agentFreeze.ts` 的 `SlotResolution`／`GroupSelectionResolution`／`resolveGroupSelections(deps:{store; port: Pick<ExecutionPort,"resolveAgent">}, groupId, operatorId)`（confirm 在事务外调、事务内重核；T14 预览只调它）；槽位键 `task:<taskId>`、`reconcile`（estimator 不进 `selectionsHash`）；`readAgentPreferences(store, operatorId): {revision; preferences}`；`webProtocol.ts` 一次性定义 `contextWindowSchema`、`agentSelectionSchema`、`partialSelectionSchema`、`provenanceSourceSchema`、`selectionProvenanceSchema`、`operatorPreferencesSchema`、`groupAgentOverridesSchema`、`frozenSlotSchema`、`setAgentPreferencesPayloadSchema`、`proposalSetAgentPayloadSchema` 与类型 `SetAgentPreferencesPayload`、`ProposalSetAgentPayload`。本分片另有（未经裁定、请补进骨架）：`applySetAgentPreferences`（T9，`src/control/agentPreferences.ts`）；`estimatorSlotFor`／`prepareEstimatorSlot`／`EstimatorSlotOutcome`（T10，`planImport.ts`）；`readConfirmedReconcileSlot`（T11，`executionSnapshot.ts`，**T12 用**）；`ObservedProfile.resolution`、`router.probe(profile, selection)`（T10 可选／T11 必填）；`handoffGraceMsOf(run)` 移到 `driverHandoff.ts`；`WebServiceDeps.port`（W6-19）。 |
| **W5-M8**（**已裁 W6-11／W6-12**） | 错误码归属与拒绝后缀。 | 端口把 ccloop 的具名拒绝抛成 `ControlError(<ccloop 码>)`（W6-11），`resolveGroupSelections` 把 `error.code` 放进 `outcome.code`，Orca 自己的 `agent-unselected` 同样；`agent-selection-changed`（409）与 `agent-selection-rejected`（422）由 T11 注册（W6-12）；`agent-unselected`、`agent-selection-invalid` 由 T8 注册。每个加码步骤写成「若已存在则跳过」。T10 导入时 estimator 选择在事务内复核不一致，用已有的 `plan-version-conflict`（detail `estimator-selection-changed`），不提前注册 `agent-selection-changed`。 |
| **W5-M9** | `tests/panel/webParity.test.ts` 让 web 镜像与服务端类型编译期双向可赋值 ⇒ T9／T10 加动词、目标、结果 kind，T11 加 `ConfirmPayload.selectionsHash` 与 W6-9 的 work item 视图字段，**当笔**就得改 `web/src/controlTypes.ts`；而 web 的确认按钮（`BudgetEditor.tsx`）要等 T14 的预览 API 才拿得到 `selectionsHash`。 | 本分片在当笔改镜像类型；W6-9 的 `agent`／`agentProvenance` 在 web 侧**可选**，`webParity.test.ts` 的 `controlGroupWebToServer` 归一化为 `null`（沿用 `blockedReason`／`continuable` 的先例，web 端的视图字面量夹具不用改）。T11 给 `BudgetEditor` 加可选 prop `selectionsHash?: string \| null`，**缺省时确认被拒（fail closed）**，T15 接上预览。控制器若要让面板在 T11 与 T15 之间仍能确认，就得把 T14 的预览路由前移。 |
| **W5-M10** | spec §6.3 reconcile 层序写「组{agent}」，§6.1 写「组 worker（`agent`）」。 | 取「组 worker 层的整个 `PartialSelection`（plan 顶层 `agent` ⊕ 面板组级 worker）」，层名 `group`；不是只取其 `agent` 字段。依据：§6.3 worker 层序里同一写法「组{plan 顶层 agent ⊕ 面板组级}」明确是整层。 |
| **W5-M11** | 旧路径（`service.ts`、`continuation.ts:35-41`、`budget.ts:128`）的闸门要用「该 run／work 冻结的 `agent`」，前提是 T7 给 `workSchema`／`WorkInput`／`Claim` 加了 `agent: AgentSelection`（envelope v2 的 `claim.agent` 从这里来）。 | 本分片假定 T7 已加；T11 只在这些点把 `work.agent`／`run.agent` 传给 `resolveAgent`／`probe`。 |
| **W5-M12** | 闸门粒度：spec 说「用该 run 冻结的 agent」；但 `scheduleStart`／`deliverScheduledStart` 在选出任务**之前**探测（事务外异步）。 | 探测组内所有任务 work item 的**去重冻结选择**，任一降级 ⇒ 整组阻塞（与今天「一个 profile 降级整组阻塞」同粒度、fail closed）。不做「只阻塞被选中的那个任务」。 |
| **W5-M13** | spec §6.4「reestimate 按当时的层 0–2 重新解析并冻结给那一次预估 run」没说冻结在哪。 | 冻结在该估算记录的 `estimatorSlot` 上；估算 run 从它拷字段。组记录的 `estimatorSlot` 只记导入时那一次。 |
| **W5-M14** | 面板 profile 展示（`controlConfig.ts` 的 `readView`）要「对操作者默认选择求」，但 `createTrustedControlConfig` 手里没有 store 与操作者。 | `readView(selection: PartialSelection)`；`controlApi.ts` 的 `GET /api/control/config` 从 `meta.panelOperatorId` 读偏好、解析 worker 槽（组层与任务层为空）得到 `partial`；未选 agent ⇒ 传 `{}`（端口会拒，展示为 `probeFailureCode`）。 |
| **W5-M15** | confirm 里「上下文阈值不能超过窗口」仍用 worker profile **声明**的 `contextWindowTokens`（`webService.ts:398-399`），没按逐任务冻结能力求。spec 没说。 | 本轮不改，登记（与 spec §11「profile 分词器与模型身份脱钩」同类）。 |
| **W5-M17** | T10 的测试夹具（`fixtures/web.ts`、`panel/fixtures/controlPanel.ts`）在 T10 与 T11 之间仍要让「不带选择」的闸门探测有答（W5-M2 的临时态）。 | T10 的夹具端口**同时**带 `resolveAgent`／`listAgents` 与 HEAD 的 `probeProfileCapabilities`／`capabilities`（注明临时），T11 Step 11.6／11.15 删后两者。若 T7 已把无选择探测改成别的机制，T10 夹具照 T7 的机制保留那一支。 |
| **W5-M16**（**需人裁**：会放宽一条既有判据） | 导入的 estimator 槽要用 plan 文件的 `agent`／`estimatorAgent`（spec §6.3 estimator 层序第 3 层）⇒ 异步导入必须在**能力 I/O 之前**读 plan 源文件。既有判据 `planImport.test.ts > immutable plan import > rechecks revision after a successful in-flight probe before source I/O` 断言「赛跑输掉的导入从不读源」——新流程下它读一次（只读、不落任何行）。改写这条就是**放宽**。 | 选项 A（本分片按 A 写）：接受「输掉赛跑的导入会只读一次源、但不写任何行」，把判据改写为「……且源里的任何东西都不落盘」，并在台账标明这是**放宽**、报人。选项 B：导入时 estimator 只解析操作者层（不读 plan 的 `agent`／`estimatorAgent`），plan 层只在 reestimate 生效——守住原判据，但偏离 spec §6.3。控制器／人选。 |


---

### Task 8: `agentSelection.ts` —— 分层解析纯函数（spec §6.3 形式定义，裁定 (a)–(e) 各一判据）

**Files:**
- Create: `src/control/agentSelection.ts`
- Modify: `src/control/errors.ts`（`:68` 注释行 `// Valid commands that cannot be represented or performed in current state.` 之后加两个码；若 T7 已加则跳过该码）
- Create: `tests/control/agentSelection.test.ts`

**Interfaces:**
- Consumes：`sha256Canonical`（`canonicalJson.ts:78`）、`ControlError`（`errors.ts:254`）、`type CapabilityViewV1`（`webProtocol.ts:1199`，**只做类型导入**，不形成运行时环）。
- Produces（骨架原名，一字不改）：`ContextWindow`、`AgentSelection`、`PartialSelection`、`LayerName`、`ProvenanceSource`、`SelectionLayer`、`OperatorPreferences`、`GroupAgentOverrides`、`Slot`、`slotLayers`、`resolveSelection`、`descriptorProvenance`、`AgentResolution`、`FrozenSlot`、`selectionsHash`。

**为什么是纯函数**：Rule 5 —— 分层合并是确定性变换，代码答；它不补描述默认值（spec §3 I3：物化规则只住在 ccloop），`"descriptor"` 来源只能事后由 ccloop 的应答与 `partial` 逐字段比出来（spec §4.6 原样回显，M5）。

- [ ] **Step 8.1：写失败的判据 `tests/control/agentSelection.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  descriptorProvenance, resolveSelection, selectionsHash, slotLayers,
  type FrozenSlot, type OperatorPreferences, type SelectionLayer,
} from "../../src/control/agentSelection.js";
import { unavailableCapabilities } from "../../src/control/profiles.js";

// Agent selection spec §6.3 (formal definition) and the §12 I8 rulings (a)-(e). Each `it` pins one ruling;
// the operator/group/task literals are the spec's own example agents (claude, codex) and default models.

const layer = (name: SelectionLayer["name"], partial: SelectionLayer["partial"]): SelectionLayer => ({ name, partial });
const prefs = (patch: Partial<OperatorPreferences> = {}): OperatorPreferences => ({ perAgent: {}, ...patch });

describe("resolveSelection follows the spec §6.3 formal definition", () => {
  it("(a) a task that repeats the upper layer's agent keeps the model the upper layer set for that agent", () => {
    const result = resolveSelection([
      layer("operator", { agent: "claude" }),
      layer("group", { agent: "claude", model: "claude-group-model" }),
      layer("task", { agent: "claude" }),
    ], {});
    expect(result.partial).toEqual({ agent: "claude", model: "claude-group-model" });
    expect(result.provenance).toEqual({ agent: "task", model: "group", contextWindow: null });
  });

  it("switching agent drops the model another agent was given, falling back to that agent's own operator default", () => {
    // The spec's reason for eff(l_i) === A: operator default claude, task switched to codex must not resolve
    // to codex + claude-opus-5-5.
    const result = resolveSelection([
      layer("operator", { agent: "claude" }),
      layer("group", { agent: "claude", model: "claude-opus-5-5" }),
      layer("task", { agent: "codex" }),
    ], { codex: { model: "gpt-6-sol" } });
    expect(result.partial).toEqual({ agent: "codex", model: "gpt-6-sol" });
    expect(result.provenance).toEqual({ agent: "task", model: "operator-agent", contextWindow: null });
  });

  it("(b) the context window follows the same rule as the model", () => {
    const upper = [layer("operator", { agent: "claude" }), layer("group", { agent: "claude", contextWindow: 1_000_000 })];
    expect(resolveSelection([...upper, layer("task", { agent: "claude" })], {}).partial)
      .toEqual({ agent: "claude", contextWindow: 1_000_000 });
    const switched = resolveSelection([...upper, layer("task", { agent: "codex" })], { claude: { contextWindow: 1_000_000 } });
    expect(switched.partial).toEqual({ agent: "codex" });
    expect(switched.provenance).toEqual({ agent: "task", model: null, contextWindow: null });
  });

  it("(c) each slot has the spec's layer order, lowest priority first", () => {
    const operator = prefs({ defaultAgent: "claude", estimator: { model: "e" }, reconcile: { model: "r" } });
    const group = { worker: { model: "w" }, estimator: { model: "ge" }, reconcile: { model: "gr" } };
    expect(slotLayers("worker", operator, group, { model: "t" })).toEqual([
      layer("operator", { agent: "claude" }), layer("group", { model: "w" }), layer("task", { model: "t" }),
    ]);
    expect(slotLayers("estimator", operator, group)).toEqual([
      layer("operator", { agent: "claude" }), layer("operator-estimator", { model: "e" }), layer("group-estimator", { model: "ge" }),
    ]);
    expect(slotLayers("reconcile", operator, group)).toEqual([
      layer("operator", { agent: "claude" }), layer("operator-reconcile", { model: "r" }), layer("group", { model: "w" }), layer("group-reconcile", { model: "gr" }),
    ]);
    // An operator with no default agent contributes an empty layer, not an `agent: undefined` key.
    expect(slotLayers("worker", prefs(), {})[0]).toEqual(layer("operator", {}));
  });

  it("(d) a group-level value always beats an operator-level one, and any layer beats the per-agent default", () => {
    const operator = prefs({ defaultAgent: "claude", perAgent: { claude: { model: "per-agent" } }, estimator: { model: "operator-estimator" } });
    const estimator = resolveSelection(slotLayers("estimator", operator, { estimator: { model: "group-estimator" } }), operator.perAgent);
    expect(estimator.partial).toEqual({ agent: "claude", model: "group-estimator" });
    expect(estimator.provenance.model).toBe("group-estimator");
    const worker = resolveSelection(slotLayers("worker", operator, { worker: { model: "group-worker" } }), operator.perAgent);
    expect(worker.partial.model).toBe("group-worker");
    const defaulted = resolveSelection(slotLayers("worker", operator, {}), operator.perAgent);
    expect(defaulted.partial).toEqual({ agent: "claude", model: "per-agent" });
    expect(defaulted.provenance).toEqual({ agent: "operator", model: "operator-agent", contextWindow: null });
  });

  it("(e) no layer naming an agent is agent-unselected, even when models are given", () => {
    expect(() => resolveSelection([layer("operator", {}), layer("group", { model: "m" }), layer("task", {})], { claude: { model: "x" } }))
      .toThrow("agent-unselected");
  });

  it("reads per-agent defaults only as own keys, never through the prototype", () => {
    const perAgent = Object.create({ inherited: { model: "leaked" } }) as OperatorPreferences["perAgent"];
    expect(resolveSelection([layer("operator", { agent: "inherited" })], perAgent).partial).toEqual({ agent: "inherited" });
  });
});

describe("descriptorProvenance: what ccloop filled in is the descriptor's", () => {
  it("labels every field the partial left empty as descriptor and keeps the layer for the rest", () => {
    const { partial, provenance } = resolveSelection([layer("operator", { agent: "claude" }), layer("task", { contextWindow: 1_000_000 })], {});
    expect(descriptorProvenance(partial, { agent: "claude", model: "claude-opus-5-5", contextWindow: 1_000_000 }, provenance))
      .toEqual({ agent: "operator", model: "descriptor", contextWindow: "task" });
  });

  it("refuses an answer that did not echo a requested field verbatim (spec §4.6, M5)", () => {
    const { partial, provenance } = resolveSelection([layer("operator", { agent: "claude", model: "opus" })], {});
    expect(() => descriptorProvenance(partial, { agent: "claude", model: "claude-opus-5-5", contextWindow: "agent-default" }, provenance))
      .toThrow("agent-selection-invalid");
  });
});

describe("selectionsHash binds exactly what the operator saw (spec §6.4 step 3)", () => {
  const slot = (configHash: string, model = "m"): FrozenSlot => ({
    partial: { agent: "claude" }, provenance: { agent: "operator", model: "descriptor", contextWindow: "descriptor" },
    selection: { agent: "claude", model, contextWindow: "agent-default" }, configHash, timeoutMs: 1_800_000, killGraceMs: 5_000,
    capabilities: unavailableCapabilities,
  });

  it("is independent of key order and changes with any slot's partial, selection or configHash", () => {
    const base = selectionsHash({ "task:a": slot("a".repeat(64)), reconcile: slot("b".repeat(64)) });
    expect(selectionsHash({ reconcile: slot("b".repeat(64)), "task:a": slot("a".repeat(64)) })).toBe(base);
    expect(selectionsHash({ "task:a": slot("c".repeat(64)), reconcile: slot("b".repeat(64)) })).not.toBe(base);
    expect(selectionsHash({ "task:a": slot("a".repeat(64), "other"), reconcile: slot("b".repeat(64)) })).not.toBe(base);
    expect(selectionsHash({ "task:a": { ...slot("a".repeat(64)), partial: { agent: "claude", model: "m" } }, reconcile: slot("b".repeat(64)) })).not.toBe(base);
  });

  it("covers only partial, selection and configHash: provenance and limits are derived, not chosen", () => {
    const base = selectionsHash({ "task:a": slot("a".repeat(64)) });
    expect(selectionsHash({ "task:a": { ...slot("a".repeat(64)), provenance: { agent: "task", model: "task", contextWindow: "task" }, timeoutMs: 1, killGraceMs: 0 } })).toBe(base);
  });
});
```

- [ ] **Step 8.2：跑，确认红**

```bash
cd $ORCA && ./node_modules/.bin/vitest run tests/control/agentSelection.test.ts > $S/t8-red.log 2>&1; echo rc=$?
```
Expected：`rc=1`；`$S/t8-red.log` 整份读回，失败原因是 `Failed to load url ../../src/control/agentSelection.js`（模块不存在），不是别的。

- [ ] **Step 8.3：`errors.ts` 加两个码（在 `:68` 注释行之后插入；已存在的键跳过）**

before（`src/control/errors.ts:68-69`）：
```ts
  // Valid commands that cannot be represented or performed in current state.
  "cleanup-not-recoverable": 422,
```
after：
```ts
  // Valid commands that cannot be represented or performed in current state.
  // Agent selection spec §6.3 (e) and §4.6 (M5): no layer chose an agent; an answer did not echo a requested field.
  "agent-unselected": 422,
  "agent-selection-invalid": 422,
  "cleanup-not-recoverable": 422,
```

- [ ] **Step 8.4：写 `src/control/agentSelection.ts`**

```ts
import { sha256Canonical } from "./canonicalJson.js";
import { ControlError } from "./errors.js";
import type { CapabilityViewV1 } from "./webProtocol.js";

/**
 * Agent selection spec §6.3. Pure layered resolution: which agent, and which model and context window the
 * layers chose for THAT agent. It never fills descriptor defaults (spec §3 I3: materialisation lives only in
 * ccloop); a field no layer chose is left out and ccloop fills it, which `descriptorProvenance` then labels.
 */
export type ContextWindow = "agent-default" | number;
export interface AgentSelection { agent: string; model: string; contextWindow: ContextWindow }
export interface PartialSelection { agent?: string; model?: string; contextWindow?: ContextWindow }
export type LayerName = "operator" | "operator-estimator" | "operator-reconcile" | "group" | "group-estimator" | "group-reconcile" | "task";
export type ProvenanceSource = LayerName | "operator-agent" | "descriptor";
export interface SelectionLayer { name: LayerName; partial: PartialSelection }
export interface OperatorPreferences {
  defaultAgent?: string;
  perAgent: Record<string, { model?: string; contextWindow?: ContextWindow }>;
  estimator?: PartialSelection;
  reconcile?: PartialSelection;
}
export interface GroupAgentOverrides { worker?: PartialSelection; estimator?: PartialSelection; reconcile?: PartialSelection }
export type Slot = "worker" | "estimator" | "reconcile";
type Field = "agent" | "model" | "contextWindow";
type Provenance = Record<Field, ProvenanceSource | null>;

export interface AgentResolution { selection: AgentSelection; configHash: string; timeoutMs: number; killGraceMs: number; capabilities: CapabilityViewV1 }
export interface FrozenSlot extends AgentResolution { partial: PartialSelection; provenance: Record<Field, ProvenanceSource> }

/** Spec §6.3 layer order per slot, lowest priority first. `task` is read for the worker slot only. */
export function slotLayers(slot: Slot, prefs: OperatorPreferences, group: GroupAgentOverrides, task?: PartialSelection): SelectionLayer[] {
  const operator: SelectionLayer = { name: "operator", partial: prefs.defaultAgent === undefined ? {} : { agent: prefs.defaultAgent } };
  if (slot === "worker") return [operator, { name: "group", partial: group.worker ?? {} }, { name: "task", partial: task ?? {} }];
  if (slot === "estimator") {
    return [operator, { name: "operator-estimator", partial: prefs.estimator ?? {} }, { name: "group-estimator", partial: group.estimator ?? {} }];
  }
  return [
    operator, { name: "operator-reconcile", partial: prefs.reconcile ?? {} },
    { name: "group", partial: group.worker ?? {} }, { name: "group-reconcile", partial: group.reconcile ?? {} },
  ];
}

/**
 * eff(l_i) = l_i.agent ?? eff(l_{i-1}); A = eff(l_n) (undefined ⇒ agent-unselected); for model and
 * contextWindow, the highest-priority layer whose effective agent is A and that gives the field, else
 * perAgent[A], else left for ccloop. Switching agent therefore drops what was chosen for another agent.
 */
export function resolveSelection(layers: SelectionLayer[], perAgent: OperatorPreferences["perAgent"]): { partial: PartialSelection; provenance: Provenance } {
  const effective: Array<string | undefined> = [];
  let running: string | undefined;
  let agentSource: LayerName | null = null;
  for (const layer of layers) {
    if (layer.partial.agent !== undefined) { running = layer.partial.agent; agentSource = layer.name; }
    effective.push(running);
  }
  if (running === undefined) throw new ControlError("agent-unselected");
  const agent = running;
  const partial: PartialSelection = { agent };
  const provenance: Provenance = { agent: agentSource, model: null, contextWindow: null };
  const own = Object.hasOwn(perAgent, agent) ? perAgent[agent] : undefined;
  for (const field of ["model", "contextWindow"] as const) {
    let value: string | ContextWindow | undefined;
    for (let index = layers.length - 1; index >= 0; index -= 1) {
      const candidate = layers[index]!.partial[field];
      if (effective[index] === agent && candidate !== undefined) { value = candidate; provenance[field] = layers[index]!.name; break; }
    }
    if (value === undefined && own?.[field] !== undefined) { value = own[field]; provenance[field] = "operator-agent"; }
    if (value === undefined) continue;
    if (field === "model") partial.model = value as string;
    else partial.contextWindow = value as ContextWindow;
  }
  return { partial, provenance };
}

/**
 * Spec §6.3 / §4.6 (M5): ccloop echoes every requested field verbatim, so a field the partial left out and
 * the answer filled is the descriptor's. A requested field answered differently is refused, not relabelled.
 */
export function descriptorProvenance(partial: PartialSelection, resolved: AgentSelection, provenance: Provenance): Record<Field, ProvenanceSource> {
  const labelled = {} as Record<Field, ProvenanceSource>;
  for (const field of ["agent", "model", "contextWindow"] as const) {
    const requested = partial[field];
    if (requested === undefined) { labelled[field] = "descriptor"; continue; }
    if (requested !== resolved[field]) throw new ControlError("agent-selection-invalid", `echo:${field}`);
    const source = provenance[field];
    if (source === null) throw new ControlError("agent-selection-invalid", `provenance:${field}`);
    labelled[field] = source;
  }
  return labelled;
}

/** Spec §6.4 step 3: per slot key, the canonical hash of exactly {partial, selection, configHash}. */
export function selectionsHash(slots: Record<string, FrozenSlot>): string {
  const bound: Record<string, { partial: PartialSelection; selection: AgentSelection; configHash: string }> = {};
  for (const key of Object.keys(slots)) {
    const slot = slots[key]!;
    bound[key] = { partial: slot.partial, selection: slot.selection, configHash: slot.configHash };
  }
  return sha256Canonical(bound);
}
```

- [ ] **Step 8.5：跑，确认绿**

```bash
cd $ORCA && ./node_modules/.bin/vitest run tests/control/agentSelection.test.ts > $S/t8-green.log 2>&1; echo rc=$?
./node_modules/.bin/vitest run tests/control/errorClassification.test.ts > $S/t8-errors.log 2>&1; echo rc=$?
./node_modules/.bin/tsc --noEmit -p tsconfig.json > $S/t8-tsc.log 2>&1; echo rc=$?
```
Expected：三个都 `rc=0`；日志整份读回，`agentSelection.test.ts` 11 passed、0 skipped。

- [ ] **Step 8.6：命名变异（在 Step 8.7 提交**之后**做：副本从提交克隆，主树零触碰；每条看见红，写进 `mutations.md`）**

```bash
C=$S/mut-t8 && /bin/rm -rf $C && /usr/bin/git clone -q --local $ORCA $C && ln -s $ORCA/node_modules $C/node_modules
```
逐条（每条改完跑 `cd $C && ./node_modules/.bin/vitest run tests/control/agentSelection.test.ts > $S/t8-mut-N.log 2>&1; echo rc=$?`，期望 `rc=1`，然后 `cd $C && /usr/bin/git checkout -- src` 复原、复核 `/usr/bin/git diff | wc -c` 为 `0`）：

| 名 | 改动（副本 `src/control/agentSelection.ts`） | 期望红的判据 |
|---|---|---|
| **T8-M1（spec §9 判据 7 点名）** | `if (effective[index] === agent && candidate !== undefined)` → `if (candidate !== undefined)` | 「switching agent drops the model another agent was given…」（得到 `claude-opus-5-5`）、「(b) the context window follows…」 |
| T8-M2 | 内层循环改为从低到高（`for (let index = 0; index < layers.length; index += 1)`） | 「(d) a group-level value always beats…」 |
| T8-M3 | 删 `if (value === undefined && own?.[field] !== undefined) {…}` 整行 | 「switching agent drops…」、「(d)…」第三组断言 |
| T8-M4 | 删 `if (running === undefined) throw new ControlError("agent-unselected");` | 「(e) no layer naming an agent…」 |
| T8-M5 | `descriptorProvenance` 里删 `if (requested !== resolved[field]) throw …` | 「refuses an answer that did not echo…」 |
| T8-M6 | `selectionsHash` 里 `bound[key] = slot`（把 provenance、limits 也算进去） | 「covers only partial, selection and configHash…」 |
| T8-M7 | `own` 改成 `perAgent[agent]`（去掉 `Object.hasOwn`） | 「reads per-agent defaults only as own keys…」（原型上的 `inherited.model = "leaked"` 漏进 `partial` ⇒ `toEqual` 红） |

- [ ] **Step 8.7：提交**

```bash
cd $ORCA && /usr/bin/git add src/control/agentSelection.ts src/control/errors.ts tests/control/agentSelection.test.ts && /usr/bin/git diff --cached --stat > $S/t8-stat.log && /usr/bin/git commit -q -F - <<'EOF'
feat(control): add the pure layered agent selection resolver

Spec §6.3: eff(l_i) per layer, the effective agent's own model and context
window from the highest layer, then the operator's per-agent default;
agent-unselected when no layer names an agent. Descriptor provenance is
derived from ccloop's verbatim echo, and selectionsHash binds only
{partial, selection, configHash} per slot key.

Co-Authored-By: <实施席自己的模型> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR
EOF
```

**既有判据将变红的**：无（只新增文件与两个错误码；`errorClassification.test.ts` 核的是「每个码恰在一个目录」，新增码满足）。


---

### Task 9: `agent_preferences` 表、命令台账 `operator` scope、动词 `set-agent-preferences`

**Files:**
- Modify: `src/control/migrations.ts`（`:3` 版本号；`:60-62` 之后加 `schema4To5`；`:64` `initialSchema`；`:66-72` `migrateSchema`）
- Modify: `src/control/store.ts`（`:86` 可接受旧版本表加 `"4"`）
- Modify: `src/control/webProtocol.ts`（`:46` 之后加选择 schema；`:517-532` 动词；`:534-542` 目标；`:644` 之后加 payload；`:662-713` 两套 variants；`:1090-1091` 结果 kind；`:1153-1164` `projectionless`；文末导出类型）
- Modify: `src/control/commandLedger.ts`（`:40-48` scope；`:54-60` 之后加 `operatorRevision`／`settingRevision`；`:113-117`、`:255-257`、`:324-325` 三处 revision 取法）
- Create: `src/control/agentPreferences.ts`
- Modify: `src/control/webService.ts`（`:17` import；`:377-380` 之后加方法 `setAgentPreferences`）
- Modify: `web/src/controlTypes.ts`（`:180-185` 目标加 operator；`:228` 动词联合；`:243-244` 结果 kind）—— `tests/panel/webParity.test.ts` 的编译期双向赋值要求同笔改
- Modify（**既有判据整条改写**）: `tests/control/workspaceSettings.test.ts:69-81`
- Create: `tests/control/agentPreferences.test.ts`

**Interfaces:**
- Consumes：T8 的 `OperatorPreferences`、`PartialSelection`、`ContextWindow`；`applyWebCommand`（`commandLedger.ts:241`）；`canonicalBytes`。
- Produces：
  - zod（`webProtocol.ts`）：`contextWindowSchema`、`partialSelectionSchema`、`agentSelectionSchema`、`operatorPreferencesSchema`、`setAgentPreferencesPayloadSchema`；类型 `SetAgentPreferencesPayload`。
  - 目标 `{kind: "operator", operatorId}`（`operatorId` 用 `nonemptyString`，与 `actorId` 同型：面板的 `actorId` 是 `operator-<uuid>`，测试里是 `human`）。
  - 结果 `{kind: "agent-preferences-set", operatorId, revision}`。
  - `src/control/agentPreferences.ts`：`readAgentPreferences(store, operatorId): { preferences: OperatorPreferences; revision: number }`（无行 ⇒ `{perAgent:{}}`、revision 0）；`applySetAgentPreferences(deps: {store; admissionGate?}, command)`；`type SetAgentPreferencesCommand`。
  - `WebControlService.setAgentPreferences(command): Promise<WebCommandResult>`（面板路由归 T14）。

- [ ] **Step 9.1：写失败的判据 `tests/control/agentPreferences.test.ts`**

```ts
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applySetAgentPreferences, readAgentPreferences, type SetAgentPreferencesCommand } from "../../src/control/agentPreferences.js";
import type { OperatorPreferences } from "../../src/control/agentSelection.js";
import { lookupCommandResult } from "../../src/control/commandLedger.js";
import { readProjectionState } from "../../src/control/projectionJournal.js";
import { openControlStore } from "../../src/control/store.js";
import { rawAuthorityCommandSchema } from "../../src/control/webProtocol.js";
import { openTestStore } from "./fixtures/store.js";

// Agent selection spec §6.2 layer 1 and §12 I10: operator preferences are a setting with their own revision
// in the ledger's `operator` scope, keyed by operatorId, and never move a group's revision or projection.

const preferences: OperatorPreferences = { defaultAgent: "claude", perAgent: { claude: { model: "claude-opus-5-5", contextWindow: 1_000_000 }, codex: { model: "gpt-6-sol" } }, reconcile: { agent: "codex" } };
const command = (commandId: string, expectedRevision: number, value: OperatorPreferences = preferences, operatorId = "human", actorId = "human"): SetAgentPreferencesCommand => ({
  schema: "orca-raw-command-v1", commandId, expectedRevision, actorId, verb: "set-agent-preferences",
  target: { kind: "operator", operatorId }, payload: { preferences: value },
});

describe("operator agent preferences (spec §6.2 layer 1)", () => {
  it("reads an empty preference document at revision 0 when nothing was ever set", async () => {
    const h = await openTestStore(); try {
      expect(readAgentPreferences(h.store, "human")).toEqual({ preferences: { perAgent: {} }, revision: 0 });
    } finally { await h.dispose(); }
  });

  it("sets under the operator's own revision, in the operator ledger scope, with no group revision or projection", async () => {
    const h = await openTestStore(); try {
      const changeSeq = readProjectionState(h.store).changeSeq;
      const result = applySetAgentPreferences({ store: h.store }, command("prefs-1", 0));
      expect(result).toMatchObject({ schema: "orca-command-success-v1", verb: "set-agent-preferences", commandRevision: 1, projectionSeq: null,
        result: { kind: "agent-preferences-set", operatorId: "human", revision: 1 } });
      expect(readAgentPreferences(h.store, "human")).toEqual({ preferences, revision: 1 });
      expect(h.store.db.prepare("SELECT group_id,scope_kind,scope_id FROM commands WHERE id='prefs-1'").get())
        .toEqual({ group_id: "@operator:human", scope_kind: "operator", scope_id: "human" });
      expect(lookupCommandResult(h.store, "@operator:human", "prefs-1")).toMatchObject({ originalStatus: 200, body: result });
      expect(readProjectionState(h.store).changeSeq).toBe(changeSeq);
      // The stored document is the canonical bytes of what was sent: a reader can recompute its identity.
      expect(String(h.store.db.prepare("SELECT doc_json FROM agent_preferences WHERE operator_id='human'").get()!.doc_json))
        .toBe(JSON.stringify({ defaultAgent: "claude", perAgent: { claude: { contextWindow: 1_000_000, model: "claude-opus-5-5" }, codex: { model: "gpt-6-sol" } }, reconcile: { agent: "codex" } }));
    } finally { await h.dispose(); }
  });

  it("advances by the preference revision and refuses a stale one without touching the stored document", async () => {
    const h = await openTestStore(); try {
      applySetAgentPreferences({ store: h.store }, command("prefs-1", 0));
      const second = { ...preferences, defaultAgent: "codex" };
      expect(applySetAgentPreferences({ store: h.store }, command("prefs-2", 1, second))).toMatchObject({ commandRevision: 2, result: { revision: 2 } });
      const stale = applySetAgentPreferences({ store: h.store }, command("prefs-3", 1, preferences));
      expect(stale).toMatchObject({ error: { code: "revision-conflict", commandRevision: 2, retryable: false } });
      expect(readAgentPreferences(h.store, "human")).toEqual({ preferences: second, revision: 2 });
    } finally { await h.dispose(); }
  });

  it("replays a repeated command id and refuses setting the document it already holds", async () => {
    const h = await openTestStore(); try {
      const first = applySetAgentPreferences({ store: h.store }, command("prefs-1", 0));
      expect(applySetAgentPreferences({ store: h.store }, command("prefs-1", 0))).toEqual(first);
      expect(applySetAgentPreferences({ store: h.store }, command("prefs-2", 1))).toMatchObject({ error: { code: "no-op-command" } });
      expect(readAgentPreferences(h.store, "human").revision).toBe(1);
    } finally { await h.dispose(); }
  });

  it("lets an actor set only its own preferences (identity is an interface for now, spec §2)", async () => {
    const h = await openTestStore(); try {
      expect(applySetAgentPreferences({ store: h.store }, command("prefs-1", 0, preferences, "someone-else", "human")))
        .toMatchObject({ error: { code: "control-target-not-allowed" } });
      expect(h.store.db.prepare("SELECT count(*) AS n FROM agent_preferences").get()!.n).toBe(0);
    } finally { await h.dispose(); }
  });

  it("carries the revision only on the envelope (controller ruling W6-8) and refuses unknown fields and a zero window", () => {
    const valid = command("prefs-1", 0);
    expect(rawAuthorityCommandSchema.safeParse(valid).success).toBe(true);
    expect(rawAuthorityCommandSchema.safeParse({ ...valid, payload: { ...valid.payload, expectedRevision: 0 } }).success).toBe(false);
    expect(rawAuthorityCommandSchema.safeParse({ ...valid, payload: { ...valid.payload, preferences: { ...preferences, secret: "x" } } }).success).toBe(false);
    expect(rawAuthorityCommandSchema.safeParse({ ...valid, payload: { ...valid.payload, preferences: { perAgent: { claude: { contextWindow: 0 } } } } }).success).toBe(false);
  });

  it("migrates a version 4 store by adding the preferences table", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "orca-migrate-5-")));
    try {
      const first = await openControlStore({ stateDir: join(root, "state") });
      first.db.exec("DROP TABLE agent_preferences");
      first.db.prepare("UPDATE meta SET value='4' WHERE key='schemaVersion'").run();
      first.close();
      const second = await openControlStore({ stateDir: join(root, "state") });
      expect(second.db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()!.value).toBe("5");
      expect(readAgentPreferences(second, "human")).toEqual({ preferences: { perAgent: {} }, revision: 0 });
      second.close();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
```

- [ ] **Step 9.2：跑，确认红**

```bash
cd $ORCA && ./node_modules/.bin/vitest run tests/control/agentPreferences.test.ts > $S/t9-red.log 2>&1; echo rc=$?
```
Expected：`rc=1`，`agentPreferences.js` 无法加载。

- [ ] **Step 9.3：迁移与版本**

`src/control/migrations.ts` —— before `:3`：
```ts
export const schemaVersion = "4";
```
after：
```ts
export const schemaVersion = "5";
```
before `:60-72`：
```ts
// Execution driver spec §3.2: the per-repository workspace mode. No row means "worktree".
export const schema3To4 = `CREATE TABLE repository_settings(repo_id TEXT PRIMARY KEY, body TEXT NOT NULL) STRICT;
`;

export const initialSchema = legacySchema + schema1To2 + schema2To3 + schema3To4;

export function migrateSchema(store: DatabaseSync, fromVersion: string): void {
  if (fromVersion === "1") store.exec(schema1To2 + schema2To3 + schema3To4);
  else if (fromVersion === "2") store.exec(schema2To3 + schema3To4);
  else if (fromVersion === "3") store.exec(schema3To4);
  else throw new Error("control-schema-unsupported");
```
after：
```ts
// Execution driver spec §3.2: the per-repository workspace mode. No row means "worktree".
export const schema3To4 = `CREATE TABLE repository_settings(repo_id TEXT PRIMARY KEY, body TEXT NOT NULL) STRICT;
`;

// Agent selection spec §6.2 layer 1: one preference document per operator, under its own revision.
export const schema4To5 = `CREATE TABLE agent_preferences(operator_id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision > 0 AND revision <= 9007199254740991), doc_json TEXT NOT NULL) STRICT;
`;

export const initialSchema = legacySchema + schema1To2 + schema2To3 + schema3To4 + schema4To5;

export function migrateSchema(store: DatabaseSync, fromVersion: string): void {
  if (fromVersion === "1") store.exec(schema1To2 + schema2To3 + schema3To4 + schema4To5);
  else if (fromVersion === "2") store.exec(schema2To3 + schema3To4 + schema4To5);
  else if (fromVersion === "3") store.exec(schema3To4 + schema4To5);
  else if (fromVersion === "4") store.exec(schema4To5);
  else throw new Error("control-schema-unsupported");
```

`src/control/store.ts:86` —— before：
```ts
        if (version !== schemaVersion && version !== "1" && version !== "2" && version !== "3") throw new ControlError("control-schema-unsupported");
```
after：
```ts
        if (version !== schemaVersion && version !== "1" && version !== "2" && version !== "3" && version !== "4") throw new ControlError("control-schema-unsupported");
```

- [ ] **Step 9.4：`webProtocol.ts` —— 选择与偏好的 schema（`:46` `orderedUniqueStringsSchema` 那一行之后插入）**

```ts
// Agent selection spec §3 (§12 I6): a context window is "agent-default" or a positive safe integer, never null.
export const contextWindowSchema = z.union([z.literal("agent-default"), positiveSafeInteger]);
// Spec §3 I2: model is opaque to Orca; only ccloop's validateSelection judges it (§4.1). Orca bounds length only.
const modelSchema = z.string().min(1).max(200);
export const partialSelectionSchema = z
  .object({ agent: idSchema.optional(), model: modelSchema.optional(), contextWindow: contextWindowSchema.optional() })
  .strict();
export const agentSelectionSchema = z.object({ agent: idSchema, model: modelSchema, contextWindow: contextWindowSchema }).strict();
export const operatorPreferencesSchema = z
  .object({
    defaultAgent: idSchema.optional(),
    perAgent: z.record(idSchema, z.object({ model: modelSchema.optional(), contextWindow: contextWindowSchema.optional() }).strict()),
    estimator: partialSelectionSchema.optional(),
    reconcile: partialSelectionSchema.optional(),
  })
  .strict();
```

动词（`:517-532`）—— before 末两行：
```ts
  "shutdown",
  "set-workspace-mode",
]);
```
after：
```ts
  "shutdown",
  "set-workspace-mode",
  "set-agent-preferences",
]);
```

目标（`:534-542`）—— before：
```ts
const repositoryCommandTargetSchema = z.object({ kind: z.literal("repository"), repoId: idSchema }).strict();

export const commandTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("group"), groupId: idSchema }).strict(),
  z.object({ kind: z.literal("task"), groupId: idSchema, taskId: idSchema }).strict(),
  z.object({ kind: z.literal("run"), groupId: idSchema, runId: idSchema }).strict(),
  z.object({ kind: z.literal("global"), epoch: nonemptyString }).strict(),
  repositoryCommandTargetSchema,
]);
```
after：
```ts
const repositoryCommandTargetSchema = z.object({ kind: z.literal("repository"), repoId: idSchema }).strict();
// Agent selection spec §6.2 / §12 I10: an operator-scoped setting, keyed like the actor that sets it.
const operatorCommandTargetSchema = z.object({ kind: z.literal("operator"), operatorId: nonemptyString }).strict();

export const commandTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("group"), groupId: idSchema }).strict(),
  z.object({ kind: z.literal("task"), groupId: idSchema, taskId: idSchema }).strict(),
  z.object({ kind: z.literal("run"), groupId: idSchema, runId: idSchema }).strict(),
  z.object({ kind: z.literal("global"), epoch: nonemptyString }).strict(),
  repositoryCommandTargetSchema,
  operatorCommandTargetSchema,
]);
```

payload（`:644` `setWorkspaceModePayloadSchema` 那一行之后插入）：
```ts
// Controller ruling W6-8: the envelope's expectedRevision (checked against agent_preferences.revision) is the only one.
export const setAgentPreferencesPayloadSchema = z.object({ preferences: operatorPreferencesSchema }).strict();
```

两套 variants：raw（`:678` `set-workspace-mode` 那一行之后）插入：
```ts
  z.object({ ...rawCommandFields, verb: z.literal("set-agent-preferences"), target: operatorCommandTargetSchema, payload: setAgentPreferencesPayloadSchema }).strict(),
```
effective（`:712` `set-workspace-mode` 那一行之后）插入：
```ts
  z.object({ ...effectiveCommandFields, verb: z.literal("set-agent-preferences"), target: operatorCommandTargetSchema, payload: setAgentPreferencesPayloadSchema }).strict(),
```

结果 kind（`:1091` `workspace-mode-set` 那一行之后）插入：
```ts
  z.object({ kind: z.literal("agent-preferences-set"), operatorId: nonemptyString, revision: positiveSafeInteger }).strict(),
```

`commandSuccessSchema` 的 superRefine —— before `:1157`：
```ts
    const projectionless = isShutdown || value.verb === "set-workspace-mode";
```
after：
```ts
    const projectionless = isShutdown || value.verb === "set-workspace-mode" || value.verb === "set-agent-preferences";
```

文末（`:1223` 之后）追加：
```ts
export type SetAgentPreferencesPayload = z.infer<typeof setAgentPreferencesPayloadSchema>;
```

- [ ] **Step 9.5：`commandLedger.ts` —— `operator` scope 与它自己的 revision**

before `:40-48`：
```ts
type CommandScope = { key: string; kind: "group" | "global" | "repository"; id: string; groupId: string | null; repoId: string | null };

function scope(command: RawAuthorityCommandV1): CommandScope {
  if (command.target.kind === "global") return { key: "@global", kind: "global", id: "global", groupId: null, repoId: null };
  if (command.target.kind === "repository") {
    return { key: `@repository:${command.target.repoId}`, kind: "repository", id: command.target.repoId, groupId: null, repoId: command.target.repoId };
  }
  return { key: command.target.groupId, kind: "group", id: command.target.groupId, groupId: command.target.groupId, repoId: null };
}
```
after：
```ts
type CommandScope = {
  key: string; kind: "group" | "global" | "repository" | "operator"; id: string;
  groupId: string | null; repoId: string | null; operatorId: string | null;
};

function scope(command: RawAuthorityCommandV1): CommandScope {
  if (command.target.kind === "global") return { key: "@global", kind: "global", id: "global", groupId: null, repoId: null, operatorId: null };
  if (command.target.kind === "repository") {
    return { key: `@repository:${command.target.repoId}`, kind: "repository", id: command.target.repoId, groupId: null, repoId: command.target.repoId, operatorId: null };
  }
  if (command.target.kind === "operator") {
    return { key: `@operator:${command.target.operatorId}`, kind: "operator", id: command.target.operatorId, groupId: null, repoId: null, operatorId: command.target.operatorId };
  }
  return { key: command.target.groupId, kind: "group", id: command.target.groupId, groupId: command.target.groupId, repoId: null, operatorId: null };
}
```

在 `repositoryRevision`（`:54-60`）之后插入：
```ts
/** Agent selection spec §12 I10: an operator-scoped command is checked against agent_preferences.revision (0 with no row). */
function operatorRevision(store: ControlStore, operatorId: string): number {
  const row = store.db.prepare("SELECT revision FROM agent_preferences WHERE operator_id=?").get(operatorId);
  if (!row) return 0;
  const revision = Number(row.revision);
  if (!Number.isSafeInteger(revision) || revision <= 0) throw new ControlError("recovery-blocked", "agent-preferences-invalid");
  return revision;
}

/** A settings scope carries its own revision; null means the scope is a group or global one. */
function settingRevision(store: ControlStore, commandScope: CommandScope): number | null {
  if (commandScope.repoId !== null) return repositoryRevision(store, commandScope.repoId);
  if (commandScope.operatorId !== null) return operatorRevision(store, commandScope.operatorId);
  return null;
}
```

preflight —— before `:113-117`：
```ts
    const currentCommandRevision = commandScope.repoId !== null ? repositoryRevision(store, commandScope.repoId)
      : commandScope.groupId === null ? 0 : Number(groupRow?.revision ?? 0);
    if (rawCommand.expectedRevision === currentCommandRevision) return null;

    const commandRevision = commandScope.repoId !== null ? currentCommandRevision : commandScope.groupId === null ? null : currentCommandRevision;
```
after：
```ts
    const setting = settingRevision(store, commandScope);
    const currentCommandRevision = setting !== null ? setting
      : commandScope.groupId === null ? 0 : Number(groupRow?.revision ?? 0);
    if (rawCommand.expectedRevision === currentCommandRevision) return null;

    const commandRevision = setting !== null ? currentCommandRevision : commandScope.groupId === null ? null : currentCommandRevision;
```

apply 前 —— before `:255-257`：
```ts
    const currentCommandRevision = commandScope.repoId !== null ? repositoryRevision(store, commandScope.repoId)
      : commandScope.groupId === null ? 0 : Number(groupRow?.revision ?? 0);
    const resultCommandRevision = commandScope.repoId !== null ? currentCommandRevision : commandScope.groupId === null ? null : currentCommandRevision;
```
after：
```ts
    const setting = settingRevision(store, commandScope);
    const currentCommandRevision = setting !== null ? setting
      : commandScope.groupId === null ? 0 : Number(groupRow?.revision ?? 0);
    const resultCommandRevision = setting !== null ? currentCommandRevision : commandScope.groupId === null ? null : currentCommandRevision;
```

apply 后 —— before `:324-325`：
```ts
    const commandRevision = commandScope.repoId !== null ? repositoryRevision(store, commandScope.repoId)
      : commandScope.groupId === null ? null : Number(finalGroup?.revision ?? currentCommandRevision);
```
after：
```ts
    const commandRevision = settingRevision(store, commandScope)
      ?? (commandScope.groupId === null ? null : Number(finalGroup?.revision ?? currentCommandRevision));
```

- [ ] **Step 9.6：写 `src/control/agentPreferences.ts`**

```ts
import { applyWebCommand } from "./commandLedger.js";
import { canonicalBytes } from "./canonicalJson.js";
import { ControlError } from "./errors.js";
import type { AdmissionGate } from "./admissionGate.js";
import type { OperatorPreferences } from "./agentSelection.js";
import type { ControlStore } from "./store.js";
import { operatorPreferencesSchema, type CommandErrorBodyV1, type CommandSuccessV1, type RawAuthorityCommandV1 } from "./webProtocol.js";

export type SetAgentPreferencesCommand = Extract<RawAuthorityCommandV1, { verb: "set-agent-preferences" }>;
export interface StoredAgentPreferences { preferences: OperatorPreferences; revision: number }

/** Agent selection spec §6.2 layer 1: no row is the empty document at revision 0. A row that is not canonical is refused. */
export function readAgentPreferences(store: ControlStore, operatorId: string): StoredAgentPreferences {
  const row = store.db.prepare("SELECT revision,doc_json FROM agent_preferences WHERE operator_id=?").get(operatorId);
  if (!row) return { preferences: { perAgent: {} }, revision: 0 };
  const text = String(row.doc_json);
  let parsed: ReturnType<typeof operatorPreferencesSchema.safeParse>;
  try { parsed = operatorPreferencesSchema.safeParse(JSON.parse(text)); }
  catch { throw new ControlError("recovery-blocked", "agent-preferences-invalid"); }
  const revision = Number(row.revision);
  if (!parsed.success || canonicalBytes(parsed.data).toString("utf8") !== text || !Number.isSafeInteger(revision) || revision <= 0) {
    throw new ControlError("recovery-blocked", "agent-preferences-invalid");
  }
  return { preferences: parsed.data as OperatorPreferences, revision };
}

/**
 * Spec §6.2 / §12 I10: the operator's own setting, under its own revision (the ledger's `operator` scope).
 * It moves no group revision and no projection; identity is an interface for now (spec §2), so an actor may
 * set only the preferences keyed by its own id.
 */
export function applySetAgentPreferences(
  deps: { store: ControlStore; admissionGate?: AdmissionGate },
  command: SetAgentPreferencesCommand,
): CommandSuccessV1 | CommandErrorBodyV1 {
  const release = deps.admissionGate?.enter();
  try {
    return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, {
      rawCommand: command,
      expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
      authorityChanged: false,
      projectionGroupIds: [],
      apply: (context) => {
        const target = context.rawCommand.target;
        if (target.kind !== "operator" || target.operatorId !== context.rawCommand.actorId) throw new ControlError("control-target-not-allowed");
        const payload = context.effectiveCommand.payload as { preferences: OperatorPreferences };
        const docJson = canonicalBytes(payload.preferences).toString("utf8");
        if (canonicalBytes(readAgentPreferences(deps.store, target.operatorId).preferences).toString("utf8") === docJson) throw new ControlError("no-op-command");
        deps.store.db.prepare("INSERT INTO agent_preferences(operator_id,revision,doc_json) VALUES (?,?,?) ON CONFLICT(operator_id) DO UPDATE SET revision=excluded.revision,doc_json=excluded.doc_json")
          .run(target.operatorId, context.nextCommandRevision, docJson);
        return { status: 200, body: {
          schema: "orca-command-success-v1", commandId: context.rawCommand.commandId, actorId: context.rawCommand.actorId,
          verb: context.rawCommand.verb, target: context.rawCommand.target, commandRevision: context.nextCommandRevision, projectionSeq: null,
          effectivePayloadHash: context.effectivePayloadHash, authorityCommandHash: context.authorityCommandHash,
          result: { kind: "agent-preferences-set", operatorId: target.operatorId, revision: context.nextCommandRevision },
        } };
      },
    }).body;
  } finally { release?.(); }
}
```

`src/control/webService.ts` —— `:17` 之后加 import：
```ts
import { applySetAgentPreferences, type SetAgentPreferencesCommand } from "./agentPreferences.js";
```
`:380`（`repositoryKnown` 那一行）之后插入：
```ts
  /** Agent selection spec §6.2 layer 1: the operator's defaults, under their own revision. */
  async setAgentPreferences(command: SetAgentPreferencesCommand): Promise<WebCommandResult> {
    return applySetAgentPreferences({ store: this.store, admissionGate: this.deps.admissionGate }, command) as WebCommandResult;
  }
```

- [ ] **Step 9.7：web 镜像（`web/src/controlTypes.ts`）**

`:185` —— before：
```ts
  | { kind: "repository"; repoId: string };
```
after：
```ts
  | { kind: "repository"; repoId: string }
  | { kind: "operator"; operatorId: string };
```
`:228` 动词联合末尾 `| "set-workspace-mode";` → `| "set-workspace-mode" | "set-agent-preferences";`
`:244` 之后插入：
```ts
    | { kind: "agent-preferences-set"; operatorId: string; revision: number }
```

- [ ] **Step 9.8：改写既有判据 `tests/control/workspaceSettings.test.ts > repository workspace mode (execution driver §3.2) > migrates a version 3 store by adding the settings table`**

为什么红：`schemaVersion` 升到 `"5"`，断言 `.toBe("4")` 失败；且全新 store 已含 `agent_preferences`，把版本改回 3 再迁移会对已存在的表执行 `CREATE TABLE agent_preferences` ⇒ `openControlStore` 抛错。
改写（整条替换 `:69-81`，不放宽：仍证明 3→当前 的迁移补回 `repository_settings`，并**加**证明它也补上 `agent_preferences`）：
```ts
  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): a version 3 store
  // migrates through 4 to 5, gaining both the workspace settings table and the operator preferences table.
  it("migrates a version 3 store by adding the settings table", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "orca-migrate-4-")));
    try {
      const first = await openControlStore({ stateDir: join(root, "state") });
      first.db.exec("DROP TABLE repository_settings");
      first.db.exec("DROP TABLE agent_preferences");
      first.db.prepare("UPDATE meta SET value='3' WHERE key='schemaVersion'").run();
      first.close();
      const second = await openControlStore({ stateDir: join(root, "state") });
      expect(second.db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()!.value).toBe("5");
      expect(readWorkspaceSetting(second, "repo")).toEqual({ workspaceMode: "worktree", revision: 0 });
      expect(second.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_preferences'").get()).toEqual({ name: "agent_preferences" });
      second.close();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
```

- [ ] **Step 9.9：跑，确认绿（新判据、改写的判据、编译期镜像、受 scope 改动影响的台账判据）**

```bash
cd $ORCA
./node_modules/.bin/vitest run tests/control/agentPreferences.test.ts > $S/t9-green.log 2>&1; echo rc=$?
./node_modules/.bin/vitest run tests/control/workspaceSettings.test.ts tests/control/commandLedger.test.ts tests/control/webProtocol.test.ts tests/control/store.test.ts tests/panel/workspaceModeApi.test.ts > $S/t9-neighbours.log 2>&1; echo rc=$?
./node_modules/.bin/tsc --noEmit -p tsconfig.json > $S/t9-tsc.log 2>&1; echo rc=$?
```
Expected：三个 `rc=0`；`agentPreferences.test.ts` 7 passed。

- [ ] **Step 9.10：提交**

```bash
cd $ORCA && /usr/bin/git add src/control/migrations.ts src/control/store.ts src/control/webProtocol.ts src/control/commandLedger.ts src/control/agentPreferences.ts src/control/webService.ts web/src/controlTypes.ts tests/control/agentPreferences.test.ts tests/control/workspaceSettings.test.ts && /usr/bin/git commit -q -F - <<'EOF'
feat(control): store operator agent preferences under their own revision

Spec §6.2 layer 1 and §12 I10: schema 5 adds agent_preferences; the
command ledger gains an operator scope whose revision is the preference
row's; set-agent-preferences moves no group revision and no projection,
and an actor may set only its own preferences. The web mirror follows.

Co-Authored-By: <实施席自己的模型> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR
EOF
```

- [ ] **Step 9.11：命名变异（提交之后，副本 `C=$S/mut-t9`，同 Step 8.6 的建法；每条跑 `tests/control/agentPreferences.test.ts`，期望 `rc=1`，复原后 `git diff | wc -c` 为 0）**

| 名 | 改动（副本） | 期望红的判据 |
|---|---|---|
| T9-M1 | `settingRevision` 里删 `if (commandScope.operatorId !== null) return operatorRevision(…)` | 「advances by the preference revision…」（第二次以 `expectedRevision:1` 被判 stale） |
| T9-M2 | `applySetAgentPreferences` 里删 `|| target.operatorId !== context.rawCommand.actorId` | 「lets an actor set only its own preferences…」 |
| T9-M3 | `migrateSchema` 删 `else if (fromVersion === "4") …` 一行 | 「migrates a version 4 store…」（`control-schema-unsupported`） |
| T9-M4 | `store.ts:86` 删 `&& version !== "4"` | 「migrates a version 4 store…」 |
| T9-M5 | `setAgentPreferencesPayloadSchema` 去掉 `.strict()` | 「carries the revision only on the envelope…」（带 `expectedRevision` 的 payload 被接受） |
| T9-M6 | 删 `no-op-command` 那一行 | 「replays a repeated command id and refuses setting the document it already holds」 |
| T9-M7 | `commandSuccessSchema` 的 `projectionless` 去掉 `set-agent-preferences` | 「sets under the operator's own revision…」（结果被判 `control-command-result-invalid`） |

**既有判据将变红的（1 条）：**
- `tests/control/workspaceSettings.test.ts > repository workspace mode (execution driver §3.2) > migrates a version 3 store by adding the settings table` —— 原因与改写见 Step 9.8。


---

### Task 10: plan 文件的 agent 层、导入时冻结 estimator、估算 run 的 `configHash`、动词 `proposal-set-agent`

> **范围按 W5-M5 调整**：本 Task **加** plan 的 `agent`／`estimatorAgent`／`reconcileAgent`，**不删** `configHash`（删除移到 T11 Step 11.3，与冻结同一提交，保证每一笔提交都绿）。按裁定 W6-20，plan 层与面板层不拆：导入时用 plan 值初始化组的 `agentOverrides` 与每个 work item 的 `agentOverride`，`proposal-set-agent` 整层替换或清除。

**Files:**
- Modify: `src/scheduler/planFile.ts`（`:1-8` import；`:10-16` `PlanTask`；`:18-28` `PlanFile`；`:30-42` `SchedulerControlPlanSource`；`:102-110` `planTaskSchema`；`:116-128` `planFileSchema`；`:242-257` 返回值）
- Modify: `src/control/webProtocol.ts`（`:371-392` `controlPlanSchema`；T9 加的选择 schema 之后加 `provenanceSourceSchema`／`selectionProvenanceSchema`／`groupAgentOverridesSchema`／`frozenSlotSchema`；`:517-533` 动词；`:599` 之前加 `proposalSetAgentPayloadSchema`；两套 variants；文末类型）
- Modify: `src/control/profiles.ts`（`:20-31` `ObservedProfile`／`ExecutionProfileRouter.probe`；`:147-167` `probe`）
- Modify: `src/control/planImport.ts`（`:1-18` import；`:24-40` deps；`:73-121` `normalizeControlPlan`；`:154-242` `importControlPlan`；`:258-286` `importControlPlanAsync`；新导出 `planGroupLayer`、`rejectedEstimatorRequest`、`estimatorSlotFor`、`prepareEstimatorSlot`、`EstimatorSlotOutcome`、`PreparedEstimatorSlot`）
- Modify: `src/control/queries.ts`（`:208-228` 估算记录 schema 与接口）
- Modify: `src/control/webService.ts`（`:25-30` 类型；`:171-216` `editProposal` 抽出 `reopenProposal`；`:217-258` `createEstimate`；`:260-306` `claimEstimate`；新方法 `proposalSetAgent`）
- Modify: `src/panel/controlViews.ts`（`:107-144` `persistedRunSchema` 加可选的冻结字段；`:512-519` 估算 run 身份核对）
- Modify: `src/control/errors.ts`（若 T7 未加：`"agent-installation-missing": 422`）
- Modify: `web/src/controlTypes.ts:228`（动词联合加 `"proposal-set-agent"`）
- Create: `tests/control/fixtures/agents.ts`（ccloop capabilities v3 替身与偏好种子，供夹具与判据共用）
- Modify（夹具，整体替换）: `tests/control/fixtures/web.ts`；Modify（夹具）: `tests/panel/fixtures/controlPanel.ts:104-140`
- Modify（**既有判据整条改写**）: `tests/control/planImport.test.ts`、`tests/panel/controlReadApi.test.ts`、`tests/control/executionSnapshot.test.ts`（见本 Task 末）
- Create: `tests/control/agentPlanImport.test.ts`

**Interfaces:**
- Consumes：T8 `slotLayers`／`resolveSelection`／`descriptorProvenance`／`FrozenSlot`／`GroupAgentOverrides`／`PartialSelection`；T9 `readAgentPreferences`、`partialSelectionSchema`、`agentSelectionSchema`、`contextWindowSchema`；T7 的 `ExecutionPort.resolveAgent`、`listAgents`（夹具实现它们）。
- Produces：
  - `webProtocol.ts`：`provenanceSourceSchema`（`z.enum`，9 个值）、`selectionProvenanceSchema`、`groupAgentOverridesSchema`、`frozenSlotSchema`、`proposalSetAgentPayloadSchema`、类型 `ProposalSetAgentPayload`；`ControlPlanV1` 可选 `agent`／`estimatorAgent`／`reconcileAgent`、任务可选 `agent`。
  - `profiles.ts`：`ObservedProfile.resolution: AgentResolution | null`；`ExecutionProfileRouter.probe(profile, selection?: PartialSelection)`（带选择 ⇒ `port.resolveAgent(selection)` 求交；不带 ⇒ T7 留下的行为、`resolution: null`；T11 改必填）。
  - `planImport.ts`：`type EstimatorSlotOutcome = {kind:"frozen"; partial; slot: FrozenSlot} | {kind:"rejected"; partial: PartialSelection | null; code: KnownControlErrorCode}`；`PreparedEstimatorSlot = {outcome; observation: ObservedProfile}`；`estimatorSlotFor(deps:{store; profileRouter}, operatorId, group, profile)`；`prepareEstimatorSlot(deps:{store; trustedConfig; profileRouter}, command, profile)`；`planGroupLayer(plan)`；`rejectedEstimatorRequest(reasonCode)`；`ImportDeps.estimatorSlot: EstimatorSlotOutcome`（必填）。
  - 组记录：`agentOverrides: GroupAgentOverrides`、`estimatorSlot: FrozenSlot | null`、`reconcileSlot: null`（T11 写）；work item：`agentOverride: PartialSelection | null`；估算记录：`estimatorSlot: FrozenSlot | null`；估算 run：`configHash`＝`estimatorSlot.configHash`，另带 `agent`／`agentProvenance`／`timeoutMs`／`killGraceMs`／`agentCapabilities`。
  - `WebControlService.proposalSetAgent(command): Promise<WebCommandResult>`（W6-5），结果 `{kind:"proposal-edited", proposalVersion}`（W6-6）。

- [ ] **Step 10.1：共用替身 `tests/control/fixtures/agents.ts`（新文件）**

```ts
import { vi } from "vitest";
import { applySetAgentPreferences } from "../../../src/control/agentPreferences.js";
import type { AgentResolution, AgentSelection, OperatorPreferences, PartialSelection } from "../../../src/control/agentSelection.js";
import { sha256Canonical } from "../../../src/control/canonicalJson.js";
import { ControlError } from "../../../src/control/errors.js";
import type { ControlStore } from "../../../src/control/store.js";
import type { CapabilityViewV1 } from "../../../src/control/webProtocol.js";

// Agent selection spec §4.6: a stand-in for `ccloop control capabilities {agent: <partial>}` (protocol 3) --
// descriptor defaults fill what was not requested, requested fields are echoed verbatim (M5), and configHash
// is a hash of the materialised selection, so changing any field changes it.
export const FIXTURE_AGENT = "fixture-agent";
export const FIXTURE_OTHER_AGENT = "fixture-other";
export const FIXTURE_DEFAULT_MODEL = "fixture-default-model";
export const FIXTURE_TIMEOUT_MS = 1_800_000;
export const FIXTURE_KILL_GRACE_MS = 5_000;

export function fixtureResolveAgent(capabilities: () => CapabilityViewV1) {
  return vi.fn(async (partial: PartialSelection): Promise<AgentResolution> => {
    if (partial.agent !== FIXTURE_AGENT && partial.agent !== FIXTURE_OTHER_AGENT) throw new ControlError("agent-installation-missing");
    const selection: AgentSelection = { agent: partial.agent, model: partial.model ?? FIXTURE_DEFAULT_MODEL, contextWindow: partial.contextWindow ?? "agent-default" };
    return { selection, configHash: sha256Canonical({ fixture: "orca-agent-fixture", selection }), timeoutMs: FIXTURE_TIMEOUT_MS, killGraceMs: FIXTURE_KILL_GRACE_MS, capabilities: structuredClone(capabilities()) };
  });
}

export async function fixtureListAgents() {
  return { installations: [FIXTURE_AGENT, FIXTURE_OTHER_AGENT].map((id) => ({
    id, kind: "fixture", defaults: { model: FIXTURE_DEFAULT_MODEL, contextWindow: "agent-default" as const }, contextOptions: ["agent-default" as const], version: "0.0.0",
  })) };
}

/** Sets `operatorId`'s preferences through the real command, so a criterion never writes the table by hand. */
export function seedPreferences(store: ControlStore, operatorId: string, preferences: OperatorPreferences, expectedRevision = 0): void {
  const result = applySetAgentPreferences({ store }, {
    schema: "orca-raw-command-v1", commandId: `seed-preferences-${expectedRevision}`, expectedRevision, actorId: operatorId,
    verb: "set-agent-preferences", target: { kind: "operator", operatorId }, payload: { preferences },
  });
  if ("error" in result) throw new Error(`preferences refused: ${JSON.stringify(result.error)}`);
}
```

- [ ] **Step 10.2：写失败的判据 `tests/control/agentPlanImport.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { canonicalBytes } from "../../src/control/canonicalJson.js";
import { ControlError } from "../../src/control/errors.js";
import { estimatorSlotFor, importControlPlan } from "../../src/control/planImport.js";
import { createExecutionProfileRouter, resolveProfile } from "../../src/control/profiles.js";
import { readEstimateRecord } from "../../src/control/queries.js";
import { WebControlService } from "../../src/control/webService.js";
import { loadPlan } from "../../src/scheduler/planFile.js";
import { FIXTURE_AGENT, FIXTURE_DEFAULT_MODEL, FIXTURE_OTHER_AGENT, seedPreferences } from "./fixtures/agents.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";

// Agent selection spec §6.2 (plan layers), §6.4 (the estimator slot is frozen at import only, and a failure
// degrades the estimate rather than refusing the import), §12 C5 (the estimate run's configHash is the frozen
// estimator selection's, never the profile hash), W6-20 (a panel write replaces the layer).

const group = (h: Awaited<ReturnType<typeof webFixture>>, id = "g") => JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id=?").get(id)!.body));
const work = (h: Awaited<ReturnType<typeof webFixture>>, taskId: string) => JSON.parse(String(h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body));
const planBase = { targetRepo: "/abs/repo", ccloopBin: "/abs/ccloop", runsDir: "/abs/runs", workBranch: "orca/w", policy: "local-merge", ledgerMode: "out-of-repo" };

describe("the plan file carries agent layers (spec §6.2)", () => {
  it("accepts group and task selections and refuses an unknown selection field", () => {
    const accepted = loadPlan({ ...planBase, agent: { agent: "claude" }, estimatorAgent: { model: "m" }, reconcileAgent: { contextWindow: 1_000_000 },
      tasks: [{ taskId: "a", contract: "/abs/a.json", dependsOn: [], agent: { agent: "codex", model: "gpt-6-sol" } }] }, "main");
    expect(accepted).toMatchObject({ plan: { agent: { agent: "claude" }, tasks: [{ agent: { agent: "codex", model: "gpt-6-sol" } }] } });
    const refused = loadPlan({ ...planBase, tasks: [{ taskId: "a", contract: "/abs/a.json", dependsOn: [], agent: { agent: "codex", sandbox: "x" } }] }, "main");
    expect(refused).toMatchObject({ rejections: [{ code: "malformed" }] });
  });
});

describe("import freezes the estimator slot (spec §6.4, §12 I9)", () => {
  it("resolves operator default < operator estimator < plan estimatorAgent and freezes what ccloop answered", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a", agent: { agent: FIXTURE_OTHER_AGENT } }], {
      preferences: { defaultAgent: FIXTURE_AGENT, perAgent: { [FIXTURE_AGENT]: { model: "per-agent-model" } }, estimator: { contextWindow: "agent-default" } },
      planAgents: { agent: { model: "group-worker-model" }, estimatorAgent: { model: "plan-estimator-model" } },
    }); try {
      expect(h.resolveAgent).toHaveBeenCalledWith({ agent: FIXTURE_AGENT, model: "plan-estimator-model", contextWindow: "agent-default" });
      const answered = await h.resolveAgent.mock.results[0]!.value;
      const expected = { ...answered, partial: { agent: FIXTURE_AGENT, model: "plan-estimator-model", contextWindow: "agent-default" },
        provenance: { agent: "operator", model: "group-estimator", contextWindow: "operator-estimator" } };
      expect(group(h).estimatorSlot).toEqual(expected);
      expect(readEstimateRecord(h.store, "g", h.estimateId)).toMatchObject({ state: "queued", estimatorSlot: expected });
      // The plan's layers become the group's and the task's override layers.
      expect(group(h).agentOverrides).toEqual({ worker: { model: "group-worker-model" }, estimator: { model: "plan-estimator-model" } });
      expect(work(h, "a").agentOverride).toEqual({ agent: FIXTURE_OTHER_AGENT });
    } finally { await h.dispose(); }
  });

  it("still imports when no layer names an agent, degrading the estimate by name", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }], { preferences: null }); try {
      expect(h.imported.result).toMatchObject({ kind: "imported", estimateState: "blocked-capability", estimateReasonCode: "agent-selection-rejected:estimator:agent-unselected" });
      expect(h.resolveAgent).not.toHaveBeenCalled();
      expect(group(h).estimatorSlot).toBeNull();
      expect(h.store.db.prepare("SELECT id FROM scheduler_wakes WHERE group_id='g'").get()).toBeUndefined();
    } finally { await h.dispose(); }
  });

  it("degrades the estimate with ccloop's own refusal code", async () => {
    const h = await webFixture(); try {
      const refusing = resolveProfile(profileSnapshot(), { resolveAgent: async () => { throw new ControlError("agent-installation-missing"); } } as never);
      const prepared = await estimatorSlotFor({ store: h.store, profileRouter: createExecutionProfileRouter([refusing]) }, "human", {}, refusing);
      expect(prepared.outcome).toEqual({ kind: "rejected", partial: { agent: FIXTURE_AGENT }, code: "agent-installation-missing" });
      const second = importControlPlan({ ...h.deps, estimatorSlot: prepared.outcome, estimatorObservation: () => prepared.observation },
        h.rawCommand("import-g2", 0, "import-plan", { kind: "group", groupId: "g2" }, { groupId: "g2", repoId: "repo", planId: "plan" }) as never);
      expect(second).toMatchObject({ result: { estimateState: "blocked-capability", estimateReasonCode: "agent-selection-rejected:estimator:agent-installation-missing" } });
    } finally { await h.dispose(); }
  });

  it("refuses an import whose operator default changed after the estimator was resolved", async () => {
    const h = await webFixture(); try {
      seedPreferences(h.store, "human", { defaultAgent: FIXTURE_OTHER_AGENT, perAgent: {} }, 1);
      const stale = importControlPlan({ ...h.deps, estimatorObservation: () => ({ profile: h.frozen, observed: h.frozen.snapshot.profile.capabilities, probeFailureCode: null }) },
        h.rawCommand("import-g2", 0, "import-plan", { kind: "group", groupId: "g2" }, { groupId: "g2", repoId: "repo", planId: "plan" }) as never);
      expect(stale).toMatchObject({ error: { code: "plan-version-conflict" } });
      expect(h.store.db.prepare("SELECT id FROM groups WHERE id='g2'").get()).toBeUndefined();
    } finally { await h.dispose(); }
  });

  it("gives the estimate run the frozen estimator configHash and selection, never the profile hash (spec §12 C5)", async () => {
    const h = await webFixture(); try {
      const answered = await h.resolveAgent.mock.results[0]!.value;
      const run = await new WebControlService(h.deps).claimEstimate("g", h.estimateId);
      expect(run).toMatchObject({ configHash: answered.configHash, agent: answered.selection, killGraceMs: answered.killGraceMs, timeoutMs: answered.timeoutMs });
      expect(run!.configHash).not.toBe(h.frozen.profileHash);
    } finally { await h.dispose(); }
  });

  it("re-estimates with the group's estimator layer as it is now (spec §6.4)", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }], { preferences: null }); try {
      const service = new WebControlService(h.deps);
      seedPreferences(h.store, "human", { defaultAgent: FIXTURE_AGENT, perAgent: {} });
      const set = await service.proposalSetAgent(h.command("proposal-set-agent", { baseProposalVersion: 1, scope: { kind: "group", slot: "estimator" }, partial: { model: "panel-estimator" } }));
      expect(set).toMatchObject({ result: { kind: "proposal-edited", proposalVersion: 2 } });
      const created = await service.createEstimate(h.command("estimate", { proposalVersion: 2, estimatorProfileId: "all", estimatorProfileHash: h.frozen.profileHash, estimateMode: "soft" }));
      if ("error" in created || created.result.kind !== "estimate-created") throw new Error(JSON.stringify(created));
      expect(readEstimateRecord(h.store, "g", created.result.estimateId).estimatorSlot).toMatchObject({
        selection: { agent: FIXTURE_AGENT, model: "panel-estimator" }, provenance: { agent: "operator", model: "group-estimator", contextWindow: "descriptor" },
      });
    } finally { await h.dispose(); }
  });
});

describe("proposal-set-agent (spec §6.2, W6-20)", () => {
  it("replaces a group or task layer, advances the proposal version, and reopens nothing it need not", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a", agent: { model: "plan-task-model" } }]); try {
      const service = new WebControlService(h.deps);
      expect(await service.proposalSetAgent(h.command("proposal-set-agent", { baseProposalVersion: 1, scope: { kind: "group", slot: "worker" }, partial: { agent: FIXTURE_OTHER_AGENT } })))
        .toMatchObject({ result: { kind: "proposal-edited", proposalVersion: 2 } });
      expect(group(h).agentOverrides).toEqual({ worker: { agent: FIXTURE_OTHER_AGENT } });
      expect(await service.proposalSetAgent(h.command("proposal-set-agent", { baseProposalVersion: 2, scope: { kind: "task", taskId: "a" }, partial: { model: "panel-task-model" } })))
        .toMatchObject({ result: { proposalVersion: 3 } });
      // W6-20: the panel's value replaces the plan's whole task layer; it is not merged field by field.
      expect(work(h, "a").agentOverride).toEqual({ model: "panel-task-model" });
      expect(JSON.parse(String(h.store.db.prepare("SELECT body FROM budget_proposals WHERE group_id='g'").get()!.body))).toMatchObject({ proposalVersion: 3, state: "editable" });
    } finally { await h.dispose(); }
  });

  it("clears a layer with null, and refuses a stale base, an unknown task and a no-op", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a", agent: { model: "plan-task-model" } }], { planAgents: { reconcileAgent: { agent: FIXTURE_OTHER_AGENT } } }); try {
      const service = new WebControlService(h.deps);
      await service.proposalSetAgent(h.command("proposal-set-agent", { baseProposalVersion: 1, scope: { kind: "group", slot: "reconcile" }, partial: null }));
      expect(group(h).agentOverrides).toEqual({});
      await service.proposalSetAgent(h.command("proposal-set-agent", { baseProposalVersion: 2, scope: { kind: "task", taskId: "a" }, partial: null }));
      expect(work(h, "a").agentOverride).toBeNull();
      expect(await service.proposalSetAgent(h.command("proposal-set-agent", { baseProposalVersion: 1, scope: { kind: "task", taskId: "a" }, partial: { model: "x" } })))
        .toMatchObject({ error: { code: "proposal-version-conflict" } });
      expect(await service.proposalSetAgent(h.command("proposal-set-agent", { baseProposalVersion: 3, scope: { kind: "task", taskId: "missing" }, partial: { model: "x" } })))
        .toMatchObject({ error: { code: "work-not-found" } });
      expect(await service.proposalSetAgent(h.command("proposal-set-agent", { baseProposalVersion: 3, scope: { kind: "task", taskId: "a" }, partial: null })))
        .toMatchObject({ error: { code: "no-op-command" } });
      expect(canonicalBytes(work(h, "a").agentOverride).toString("utf8")).toBe("null");
    } finally { await h.dispose(); }
  });
});

describe("a model the plan names is opaque to Orca (spec §3 I2)", () => {
  it("passes a plan's model and default model through unchanged", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }], { planAgents: { estimatorAgent: { agent: FIXTURE_AGENT } } }); try {
      expect(group(h).estimatorSlot.selection).toEqual({ agent: FIXTURE_AGENT, model: FIXTURE_DEFAULT_MODEL, contextWindow: "agent-default" });
      expect(group(h).estimatorSlot.provenance).toEqual({ agent: "group-estimator", model: "descriptor", contextWindow: "descriptor" });
    } finally { await h.dispose(); }
  });
});
```

- [ ] **Step 10.3：跑，确认红**

```bash
cd $ORCA && ./node_modules/.bin/vitest run tests/control/agentPlanImport.test.ts > $S/t10-red.log 2>&1; echo rc=$?
```
Expected：`rc=1`；首个失败是 `fixtures/web.js` 的 `webFixture` 不接受第三参（`resolveAgent` 未定义）或 `estimatorSlotFor` 未导出；整份读回确认没有别的原因。

- [ ] **Step 10.4：`webProtocol.ts` —— 快照与覆盖层的 schema（紧接 T9 加的 `operatorPreferencesSchema` 之后）**

```ts
// Agent selection spec §6.3: where each resolved field came from.
export const provenanceSourceSchema = z.enum([
  "operator", "operator-estimator", "operator-reconcile", "group", "group-estimator", "group-reconcile", "task", "operator-agent", "descriptor",
]);
export const selectionProvenanceSchema = z
  .object({ agent: provenanceSourceSchema, model: provenanceSourceSchema, contextWindow: provenanceSourceSchema })
  .strict();
export const groupAgentOverridesSchema = z
  .object({ worker: partialSelectionSchema.optional(), estimator: partialSelectionSchema.optional(), reconcile: partialSelectionSchema.optional() })
  .strict();
// Spec §6.4 / §12 I5: one frozen slot -- what was asked, where each field came from, and ccloop's capabilities-v3 answer.
export const frozenSlotSchema = z
  .object({
    partial: partialSelectionSchema,
    provenance: selectionProvenanceSchema,
    selection: agentSelectionSchema,
    configHash: hashSchema,
    timeoutMs: positiveSafeInteger.max(2_147_483_647),
    killGraceMs: safeInteger.max(60_000),
    capabilities: capabilityViewSchema,
  })
  .strict();
```
⚠️ `capabilityViewSchema` 定义在 `:76`，`hashSchema` 在 `:5`：把上面这段放在 `capabilityViewSchema` **之后**（即 `:86` 之后）；T9 的选择 schema 若放在 `:46` 之后，这一段另起放在 `:86` 之后即可（zod 常量需先定义后使用）。

`controlPlanSchema`（`:371-392`）—— before：
```ts
export const controlPlanSchema = z
  .object({
    schema: z.literal("orca-control-plan-v1"),
    repoId: idSchema,
    planId: idSchema,
    goal: nonemptyString,
    successConditions: orderedUniqueNonemptyStringsSchema,
    tasks: z.array(
      z
        .object({
          taskId: idSchema,
          dependencyTaskIds: sortedIdArraySchema,
          targetVersion: positiveSafeInteger,
          configHash: hashSchema,
          originalContractHash: hashSchema,
          originalContractCanonicalJson: nonemptyString,
        })
        .strict(),
    ),
  })
```
after：
```ts
export const controlPlanSchema = z
  .object({
    schema: z.literal("orca-control-plan-v1"),
    repoId: idSchema,
    planId: idSchema,
    goal: nonemptyString,
    successConditions: orderedUniqueNonemptyStringsSchema,
    // Agent selection spec §6.2: the plan's group layers (worker, estimator, reconcile); absent keys stay absent.
    agent: partialSelectionSchema.optional(),
    estimatorAgent: partialSelectionSchema.optional(),
    reconcileAgent: partialSelectionSchema.optional(),
    tasks: z.array(
      z
        .object({
          taskId: idSchema,
          dependencyTaskIds: sortedIdArraySchema,
          targetVersion: positiveSafeInteger,
          configHash: hashSchema,
          agent: partialSelectionSchema.optional(),
          originalContractHash: hashSchema,
          originalContractCanonicalJson: nonemptyString,
        })
        .strict(),
    ),
  })
```

动词：在 T9 加的 `"set-agent-preferences",` 之后加 `"proposal-set-agent",`。

payload（`:599` `confirmPayloadSchema` 之前插入）：
```ts
// Agent selection spec §6.2 (W6-20): replace one layer of the proposal's selection, or clear it with null.
export const proposalSetAgentPayloadSchema = z
  .object({
    baseProposalVersion: positiveSafeInteger,
    scope: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("group"), slot: z.enum(["worker", "estimator", "reconcile"]) }).strict(),
      z.object({ kind: z.literal("task"), taskId: idSchema }).strict(),
    ]),
    partial: partialSelectionSchema.nullable(),
  })
  .strict();
```
raw variants（`proposal-edit` 那一行之后）：
```ts
  z.object({ ...rawCommandFields, verb: z.literal("proposal-set-agent"), target: groupCommandTargetSchema, payload: proposalSetAgentPayloadSchema }).strict(),
```
effective variants（`proposal-edit` 那一项之后）：
```ts
  z.object({ ...effectiveCommandFields, verb: z.literal("proposal-set-agent"), target: groupCommandTargetSchema, payload: proposalSetAgentPayloadSchema }).strict(),
```
文末追加：
```ts
export type ProposalSetAgentPayload = z.infer<typeof proposalSetAgentPayloadSchema>;
```

- [ ] **Step 10.5：plan 文件（`src/scheduler/planFile.ts`）**

`:7` 之后加：
```ts
import type { PartialSelection } from "../control/agentSelection.js";
import { partialSelectionSchema } from "../control/webProtocol.js";
```
`PlanTask`（`:10-16`）加字段 `agent?: PartialSelection;`（`configHash?: string;` 之后）。
`PlanFile`（`:18-28`）在 `successConditions?: string[];` 之后加：
```ts
  agent?: PartialSelection;
  estimatorAgent?: PartialSelection;
  reconcileAgent?: PartialSelection;
```
`SchedulerControlPlanSource`（`:30-42`）在 `successConditions: string[];` 之后加同样三行，任务里在 `configHash: string;` 之后加 `agent?: PartialSelection;`。
`planTaskSchema`（`:102-110`）在 `configHash: …optional(),` 之后加 `agent: partialSelectionSchema.optional(),`。
`planFileSchema`（`:116-128`）在 `successConditions: …optional(),` 之后加：
```ts
    agent: partialSelectionSchema.optional(),
    estimatorAgent: partialSelectionSchema.optional(),
    reconcileAgent: partialSelectionSchema.optional(),
```
返回值（`:242-257`）—— before：
```ts
  return {
    goal: plan.goal,
    successConditions: [...plan.successConditions],
    tasks: plan.tasks.map(task => {
      const original = parseContract(task.contract, task.taskId);
      return {
        taskId: task.taskId,
        dependencyTaskIds: [...task.dependsOn],
        targetVersion: task.targetVersion!,
        configHash: task.configHash!,
```
after：
```ts
  return {
    goal: plan.goal,
    successConditions: [...plan.successConditions],
    ...(plan.agent ? { agent: plan.agent } : {}),
    ...(plan.estimatorAgent ? { estimatorAgent: plan.estimatorAgent } : {}),
    ...(plan.reconcileAgent ? { reconcileAgent: plan.reconcileAgent } : {}),
    tasks: plan.tasks.map(task => {
      const original = parseContract(task.contract, task.taskId);
      return {
        taskId: task.taskId,
        dependencyTaskIds: [...task.dependsOn],
        targetVersion: task.targetVersion!,
        configHash: task.configHash!,
        ...(task.agent ? { agent: task.agent } : {}),
```

- [ ] **Step 10.6：路由器探测带选择（`src/control/profiles.ts`）**

`:1-10` import 之后加：
```ts
import type { AgentResolution, PartialSelection } from "./agentSelection.js";
import { partialSelectionSchema } from "./webProtocol.js";
```
`ObservedProfile`（`:20-25`）—— before：
```ts
export interface ObservedProfile {
  readonly profile: FrozenProfile;
  readonly observed: CapabilityViewV1;
  readonly observedAt: string;
  readonly probeFailureCode: KnownControlErrorCode | null;
}
```
after：
```ts
export interface ObservedProfile {
  readonly profile: FrozenProfile;
  readonly observed: CapabilityViewV1;
  readonly observedAt: string;
  readonly probeFailureCode: KnownControlErrorCode | null;
  /** Agent selection spec §4.6: ccloop's answer for the probed selection; null when none was asked or it failed. */
  readonly resolution: AgentResolution | null;
}
```
`ExecutionProfileRouter.probe`（`:29`）→ `probe(profile: FrozenProfile, selection?: PartialSelection): Promise<ObservedProfile>;`
`probe` 实现（`:147-167`）改为（**不带选择的分支保持 T7 留下的行为不变**，下面以 HEAD 版本书写；若 T7 已改那一支，保留 T7 的那一支、只加 `resolution: null`）：
```ts
    async probe(profile: FrozenProfile, selection?: PartialSelection): Promise<ObservedProfile> {
      if (byId.get(profile.snapshot.profile.profileId) !== profile) throw new ControlError("profile-changed");
      try {
        if (selection !== undefined) {
          // Agent selection spec §6.4 last paragraph: a gate probes a selection, never the port's own default.
          const partial = partialSelectionSchema.safeParse(selection);
          if (!partial.success) throw new ControlError("control-capability-unsupported", "selection-invalid");
          const resolution = await profile.port.resolveAgent(partial.data);
          const view = capabilityViewSchema.safeParse(resolution.capabilities);
          if (!view.success) throw new ControlError("control-capability-probe-failed");
          return Object.freeze({
            profile,
            observed: deepFreeze(intersectCapabilities(profile.snapshot.profile.capabilities, view.data)),
            observedAt: now().toISOString(),
            probeFailureCode: null,
            resolution: deepFreeze(structuredClone(resolution)),
          });
        }
        if (!profile.port.probeProfileCapabilities) throw new ControlError("control-capability-probe-failed");
        const result = capabilityViewSchema.safeParse(await profile.port.probeProfileCapabilities());
        if (!result.success) throw new ControlError("control-capability-probe-failed");
        return Object.freeze({
          profile,
          observed: deepFreeze(intersectCapabilities(profile.snapshot.profile.capabilities, result.data)),
          observedAt: now().toISOString(),
          probeFailureCode: null,
          resolution: null,
        });
      } catch (error) {
        return Object.freeze({
          profile,
          observed: unavailableCapabilities,
          observedAt: now().toISOString(),
          probeFailureCode: probeFailureCode(error),
          resolution: null,
        });
      }
    },
```

- [ ] **Step 10.7：导入（`src/control/planImport.ts`）**

import 区（`:1-18`）加：
```ts
import { readAgentPreferences } from "./agentPreferences.js";
import { descriptorProvenance, resolveSelection, slotLayers, type FrozenSlot, type GroupAgentOverrides, type PartialSelection } from "./agentSelection.js";
import type { KnownControlErrorCode } from "./errors.js";
import { unavailableCapabilities } from "./profiles.js";
```
并把 `:5` 的 `import type { ExecutionProfileRouter, FrozenProfile, ObservedProfile } from "./profiles.js";` 保留（类型）。

`ImportDeps`／`AsyncImportDeps`（`:30-40`）—— before：
```ts
export interface ImportDeps {
  store: ControlStore;
  trustedConfig: Pick<TrustedControlConfig, "resolveTarget">;
  profileRouter: ExecutionProfileRouter;
  defaults: () => ImportDefaults;
  estimatorObservation: (profile: FrozenProfile) => Pick<ObservedProfile, "profile" | "observed" | "probeFailureCode">;
  exactTokenCount?: (profile: FrozenProfile, canonicalRequestBytes: Buffer) => number;
  beforeCommit?: () => void;
}

export type AsyncImportDeps = Omit<ImportDeps, "estimatorObservation">;
```
after：
```ts
/** Agent selection spec §6.4 (§12 I9): the estimator slot, resolved before the import's transaction. */
export type EstimatorSlotOutcome =
  | { kind: "frozen"; partial: PartialSelection; slot: FrozenSlot }
  | { kind: "rejected"; partial: PartialSelection | null; code: KnownControlErrorCode };
export interface PreparedEstimatorSlot { outcome: EstimatorSlotOutcome; observation: ObservedProfile }

export interface ImportDeps {
  store: ControlStore;
  trustedConfig: Pick<TrustedControlConfig, "resolveTarget">;
  profileRouter: ExecutionProfileRouter;
  defaults: () => ImportDefaults;
  estimatorObservation: (profile: FrozenProfile) => Pick<ObservedProfile, "profile" | "observed" | "probeFailureCode">;
  estimatorSlot: EstimatorSlotOutcome;
  exactTokenCount?: (profile: FrozenProfile, canonicalRequestBytes: Buffer) => number;
  beforeCommit?: () => void;
}

export type AsyncImportDeps = Omit<ImportDeps, "estimatorObservation" | "estimatorSlot">;
```

`normalizeControlPlan` 的 `candidate`（`:103-117`）—— before：
```ts
  const candidate = {
    schema: "orca-control-plan-v1" as const,
    repoId: source.repoId,
    planId: source.planId,
    goal: source.goal,
    successConditions: [...source.successConditions],
    tasks: source.tasks.map(task => ({
      taskId: task.taskId,
      dependencyTaskIds: [...task.dependencyTaskIds].sort(compare),
      targetVersion: task.targetVersion,
      configHash: task.configHash,
      originalContractHash: task.originalContractHash,
```
after：
```ts
  const candidate = {
    schema: "orca-control-plan-v1" as const,
    repoId: source.repoId,
    planId: source.planId,
    goal: source.goal,
    successConditions: [...source.successConditions],
    ...(source.agent ? { agent: source.agent } : {}),
    ...(source.estimatorAgent ? { estimatorAgent: source.estimatorAgent } : {}),
    ...(source.reconcileAgent ? { reconcileAgent: source.reconcileAgent } : {}),
    tasks: source.tasks.map(task => ({
      taskId: task.taskId,
      dependencyTaskIds: [...task.dependencyTaskIds].sort(compare),
      targetVersion: task.targetVersion,
      configHash: task.configHash,
      ...(task.agent ? { agent: task.agent } : {}),
      originalContractHash: task.originalContractHash,
```

在 `normalizeControlPlan` 之后插入：
```ts
/** The plan's group layers, as the group's initial agentOverrides (W6-20: one layer, no plan/panel split). */
export function planGroupLayer(plan: ControlPlanV1): GroupAgentOverrides {
  return {
    ...(plan.agent ? { worker: plan.agent } : {}),
    ...(plan.estimatorAgent ? { estimator: plan.estimatorAgent } : {}),
    ...(plan.reconcileAgent ? { reconcile: plan.reconcileAgent } : {}),
  };
}

/** Spec §6.4 / §7: an estimator selection that failed is a blocked estimate named after the failure. */
export function rejectedEstimatorRequest(reasonCode: string): FrozenEstimateRequest {
  return { state: "blocked-capability", reasonCode, requestHash: null, request: null, contract: null, contractHash: null, inputTokens: null, requiredRequestTokens: null };
}

function currentEstimatorPartial(store: ControlStore, operatorId: string, group: GroupAgentOverrides): PartialSelection | null {
  const prefs = readAgentPreferences(store, operatorId).preferences;
  try { return resolveSelection(slotLayers("estimator", prefs, group), prefs.perAgent).partial; }
  catch (error) {
    if (error instanceof ControlError && error.code === "agent-unselected") return null;
    throw error;
  }
}

/**
 * Spec §6.3 estimator layers, then ccloop's answer through the router (spec §6.4 last paragraph: the probe is of
 * the selection). Every failure is an outcome, not a throw: the import degrades the estimate instead (§12 I9).
 */
export async function estimatorSlotFor(
  deps: { store: ControlStore; profileRouter: ExecutionProfileRouter },
  operatorId: string,
  group: GroupAgentOverrides,
  profile: FrozenProfile,
): Promise<PreparedEstimatorSlot> {
  const prefs = readAgentPreferences(deps.store, operatorId).preferences;
  let resolved: ReturnType<typeof resolveSelection>;
  try { resolved = resolveSelection(slotLayers("estimator", prefs, group), prefs.perAgent); }
  catch (error) {
    if (!(error instanceof ControlError) || error.code !== "agent-unselected") throw error;
    return {
      outcome: { kind: "rejected", partial: null, code: "agent-unselected" },
      observation: { profile, observed: unavailableCapabilities, observedAt: new Date().toISOString(), probeFailureCode: "agent-unselected", resolution: null },
    };
  }
  const observation = await deps.profileRouter.probe(profile, resolved.partial);
  if (observation.probeFailureCode !== null || observation.resolution === null) {
    return { outcome: { kind: "rejected", partial: resolved.partial, code: observation.probeFailureCode ?? "control-capability-probe-failed" }, observation };
  }
  try {
    const provenance = descriptorProvenance(resolved.partial, observation.resolution.selection, resolved.provenance);
    return { outcome: { kind: "frozen", partial: resolved.partial, slot: { ...structuredClone(observation.resolution), partial: resolved.partial, provenance } }, observation };
  } catch (error) {
    if (!(error instanceof ControlError)) throw error;
    return { outcome: { kind: "rejected", partial: resolved.partial, code: error.code }, observation: { ...observation, observed: unavailableCapabilities, probeFailureCode: error.code, resolution: null } };
  }
}

/** The async importer's preparation: the plan's own layers need the source (W5-M16), read through the trusted resolver. */
export async function prepareEstimatorSlot(
  deps: { store: ControlStore; trustedConfig: Pick<TrustedControlConfig, "resolveTarget">; profileRouter: ExecutionProfileRouter },
  command: ImportCommand,
  profile: FrozenProfile,
): Promise<PreparedEstimatorSlot> {
  const { repoId, planId } = command.payload;
  const plan = normalizeControlPlan({ ...readSchedulerControlPlanSource(deps.trustedConfig.resolveTarget({ repoId, planId })), repoId, planId });
  return estimatorSlotFor(deps, command.actorId, planGroupLayer(plan), profile);
}
```

`importControlPlan` 的 `apply`：before（`:172-174`）：
```ts
      const planHash = sha256Canonical(plan);
      const estimatorProfile = deps.profileRouter.resolve("budget-estimate", payload.estimatorProfileId, payload.estimatorProfileHash);
      const preflight = preflightEstimate(deps, planHash, planCanonicalJson, estimatorProfile, payload.estimateMode);
```
after：
```ts
      const planHash = sha256Canonical(plan);
      const estimatorProfile = deps.profileRouter.resolve("budget-estimate", payload.estimatorProfileId, payload.estimatorProfileHash);
      const groupLayer = planGroupLayer(plan);
      // The layers the estimator slot was resolved from must still be the layers now (spec §6.4: frozen = seen).
      const partialNow = currentEstimatorPartial(deps.store, context.rawCommand.actorId, groupLayer);
      if (canonicalBytes(partialNow).compare(canonicalBytes(deps.estimatorSlot.partial)) !== 0) {
        throw new ControlError("plan-version-conflict", "estimator-selection-changed");
      }
      const estimatorSlot = deps.estimatorSlot.kind === "frozen" ? deps.estimatorSlot.slot : null;
      const preflight = deps.estimatorSlot.kind === "rejected"
        ? rejectedEstimatorRequest(`agent-selection-rejected:estimator:${deps.estimatorSlot.code}`)
        : preflightEstimate(deps, planHash, planCanonicalJson, estimatorProfile, payload.estimateMode);
```
组记录（`:193-202`）在 `importDefaults: {…},` 之后加：
```ts
        agentOverrides: groupLayer, estimatorSlot, reconcileSlot: null,
```
work item（`:208-213`）在 `derivedContractHash: null,` 之后加：
```ts
          agentOverride: task.agent ?? null,
```
估算记录（`:223-228`）在 `grant: cloneAmount(ESTIMATE_GRANT),` 之后加：
```ts
        estimatorSlot,
```

`importControlPlanAsync`（`:258-286`）—— before：
```ts
  let frozenDefaults: ImportDefaults;
  let profile: FrozenProfile;
  let observation: ObservedProfile;
  try {
    const raw = command.payload;
    const currentDefaults = deps.defaults();
    frozenDefaults = {
      estimatorProfileId: raw.estimatorProfileId ?? currentDefaults.estimatorProfileId,
      estimatorProfileHash: raw.estimatorProfileHash ?? currentDefaults.estimatorProfileHash,
      estimateMode: raw.estimateMode ?? currentDefaults.estimateMode,
    };
    profile = deps.profileRouter.resolve("budget-estimate", frozenDefaults.estimatorProfileId, frozenDefaults.estimatorProfileHash);
    observation = await deps.profileRouter.probe(profile);
  } catch (error) {
    return persistAsyncPreparationFailure(deps.store, command, error);
  }
  return importControlPlan({
    ...deps,
    defaults: () => frozenDefaults,
    estimatorObservation: selected => {
      if (selected !== profile) throw new ControlError("profile-changed");
      return observation;
    },
  }, command);
```
after：
```ts
  let frozenDefaults: ImportDefaults;
  let profile: FrozenProfile;
  let prepared: PreparedEstimatorSlot;
  try {
    const raw = command.payload;
    const currentDefaults = deps.defaults();
    frozenDefaults = {
      estimatorProfileId: raw.estimatorProfileId ?? currentDefaults.estimatorProfileId,
      estimatorProfileHash: raw.estimatorProfileHash ?? currentDefaults.estimatorProfileHash,
      estimateMode: raw.estimateMode ?? currentDefaults.estimateMode,
    };
    profile = deps.profileRouter.resolve("budget-estimate", frozenDefaults.estimatorProfileId, frozenDefaults.estimatorProfileHash);
    prepared = await prepareEstimatorSlot(deps, command, profile);
  } catch (error) {
    return persistAsyncPreparationFailure(deps.store, command, error);
  }
  return importControlPlan({
    ...deps,
    defaults: () => frozenDefaults,
    estimatorSlot: prepared.outcome,
    estimatorObservation: selected => {
      if (selected !== profile) throw new ControlError("profile-changed");
      return prepared.observation;
    },
  }, command);
```

- [ ] **Step 10.8：估算记录（`src/control/queries.ts`）**

`:1-20` 的 import 从 `./webProtocol.js` 加 `frozenSlotSchema`；`import type { FrozenSlot } from "./agentSelection.js";`。
`estimateRecordSchema`（`:208-213`）在 `reasonCode: z.string().min(1).nullable(), grant: amountSchema,` 之后加 `estimatorSlot: frozenSlotSchema.nullable(),`。
`EstimateRecord`（`:223-228`）在 `grant: Amount;` 之后加 `estimatorSlot: FrozenSlot | null;`。

- [ ] **Step 10.9：`webService.ts` —— `reopenProposal`、`proposalSetAgent`、reestimate 与估算 run**

import：`:7` 加 `rejectedEstimatorRequest`、`estimatorSlotFor` 从 `./planImport.js`（与 `importControlPlanAsync` 同一行）；`:13` 从 `./webProtocol.js` 加 `groupAgentOverridesSchema`；另加：
```ts
import { intersectCapabilities } from "./profiles.js";
import type { FrozenSlot } from "./agentSelection.js";
```
`:28` 之后加：
```ts
export type ProposalSetAgentCommand = Extract<RawAuthorityCommandV1, { verb: "proposal-set-agent" }>;
```

`reopenProposal`：把 `editProposal` 的 `:200-212` 抽成模块级函数（放在 `class WebControlService` 之前）：
```ts
/** Any proposal change returns it to editable: the version advances and every confirmation-time fact is dropped. */
function reopenProposal(store: ControlStore, id: string, group: Group, proposal: BudgetProposalRecord, commitments: Amount): void {
  proposal.proposalVersion = safeNumber(BigInt(proposal.proposalVersion) + 1n);
  proposal.state = "editable"; proposal.budgetMode = null; proposal.profiles = null; proposal.executionSnapshotHash = null;
  proposal.contextPolicy = { handoffAtContextTokens: null };
  proposal.allocations.forEach(a => { a.state = "draft-encumbered"; });
  group.status = "draft"; group.ledger.committedRemaining = commitments;
  for (const row of store.db.prepare("SELECT id,body FROM work_items WHERE group_id=?").all(id)) {
    const work = JSON.parse(String(row.body));
    if (work.kind !== "task") continue;
    work.status = "draft"; work.derivedContractHash = null;
    work.grant = { work: proposal.allocations.find(a => a.ownerId === row.id && a.bucket === "work")!.amount, handoff: proposal.allocations.find(a => a.ownerId === row.id && a.bucket === "handoff")!.amount };
    store.db.prepare("UPDATE work_items SET body=? WHERE group_id=? AND id=?").run(JSON.stringify(work), id, row.id);
  }
  saveWebAuthority(store, group, proposal);
}
```
`editProposal` 的 `:200-212` —— before：
```ts
        proposal.proposalVersion = safeNumber(BigInt(proposal.proposalVersion) + 1n);
        proposal.state = "editable"; proposal.budgetMode = null; proposal.profiles = null; proposal.executionSnapshotHash = null;
        proposal.contextPolicy = { handoffAtContextTokens: null };
        proposal.allocations.forEach(a => { a.state = "draft-encumbered"; });
        group.status = "draft"; group.ledger.committedRemaining = commitments;
        for (const row of this.store.db.prepare("SELECT id,body FROM work_items WHERE group_id=?").all(id)) {
          const work = JSON.parse(String(row.body));
          if (work.kind !== "task") continue;
          work.status = "draft"; work.derivedContractHash = null;
          work.grant = { work: proposal.allocations.find(a => a.ownerId === row.id && a.bucket === "work")!.amount, handoff: proposal.allocations.find(a => a.ownerId === row.id && a.bucket === "handoff")!.amount };
          this.store.db.prepare("UPDATE work_items SET body=? WHERE group_id=? AND id=?").run(JSON.stringify(work), id, row.id);
        }
        saveWebAuthority(this.store, group, proposal);
```
after：
```ts
        reopenProposal(this.store, id, group, proposal, commitments);
```

在 `editProposal` 方法之后加：
```ts
  /** Agent selection spec §6.2 (W6-20): replace or clear one selection layer; a proposal change like any other. */
  async proposalSetAgent(command: ProposalSetAgentCommand): Promise<WebCommandResult> {
    return this.mutate(() => applyWebCommand(this.store, {
      rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
      apply: context => {
        const id = groupId(command), group = readWebGroup(this.store, id), proposal = readBudgetProposal(this.store, id);
        const payload = command.payload;
        if (proposal.proposalVersion !== payload.baseProposalVersion) throw new ControlError("proposal-version-conflict");
        prestart(group);
        assertKnownConservation(this.store, group, proposal);
        if (payload.scope.kind === "group") {
          const overrides = groupAgentOverridesSchema.parse((group as { agentOverrides?: unknown }).agentOverrides ?? {});
          const before = canonicalBytes(overrides);
          if (payload.partial === null) delete overrides[payload.scope.slot];
          else overrides[payload.scope.slot] = payload.partial;
          if (before.equals(canonicalBytes(overrides))) throw new ControlError("no-op-command");
          (group as Record<string, unknown>).agentOverrides = overrides;
        } else {
          const row = this.store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id=?").get(id, payload.scope.taskId);
          const work = row ? JSON.parse(String(row.body)) : null;
          if (!work || work.kind !== "task") throw new ControlError("work-not-found");
          if (canonicalBytes(work.agentOverride ?? null).equals(canonicalBytes(payload.partial))) throw new ControlError("no-op-command");
          work.agentOverride = payload.partial;
          this.store.db.prepare("UPDATE work_items SET body=? WHERE group_id=? AND id=?").run(JSON.stringify(work), id, payload.scope.taskId);
        }
        const commitments = sumAmounts([...proposal.allocations.filter(a => a.ownerKind !== "reserve").map(a => a.amount), ...estimateCommitments(this.store, id).map(a => a.amount)]);
        setReserve(proposal, residual(proposal.groupLimit, group.used, commitments));
        reopenProposal(this.store, id, group, proposal, commitments);
        return success(context, { kind: "proposal-edited", proposalVersion: proposal.proposalVersion });
      },
    }).body);
  }
```

`createEstimate`（`:221-229`）—— before：
```ts
      let prepared: ReturnType<typeof buildBudgetEstimateRequest>;
      try {
        const id = groupId(command), group = readWebGroup(this.store, id);
        const plan = readArchivedPlan(this.store, id), proposal = readBudgetProposal(this.store, id);
        if (proposal.proposalVersion !== command.payload.proposalVersion) throw new ControlError("proposal-version-conflict");
        prestart(group);
        const profile = this.deps.profileRouter.resolve("budget-estimate", command.payload.estimatorProfileId, command.payload.estimatorProfileHash);
        const observation = await this.deps.profileRouter.probe(profile);
        prepared = buildBudgetEstimateRequest({ planHash: plan.planHash, planCanonicalJson: plan.canonicalJson, profile, observation, mode: command.payload.estimateMode, exactTokenCount: this.deps.exactTokenCount });
```
after：
```ts
      let prepared: ReturnType<typeof buildBudgetEstimateRequest>;
      let estimatorSlot: FrozenSlot | null;
      try {
        const id = groupId(command), group = readWebGroup(this.store, id);
        const plan = readArchivedPlan(this.store, id), proposal = readBudgetProposal(this.store, id);
        if (proposal.proposalVersion !== command.payload.proposalVersion) throw new ControlError("proposal-version-conflict");
        prestart(group);
        const profile = this.deps.profileRouter.resolve("budget-estimate", command.payload.estimatorProfileId, command.payload.estimatorProfileHash);
        // Spec §6.4: a re-estimate resolves the estimator layers as they are now and freezes them for this run only.
        const overrides = groupAgentOverridesSchema.parse((group as { agentOverrides?: unknown }).agentOverrides ?? {});
        const slot = await estimatorSlotFor({ store: this.store, profileRouter: this.deps.profileRouter }, command.actorId, overrides, profile);
        estimatorSlot = slot.outcome.kind === "frozen" ? slot.outcome.slot : null;
        prepared = slot.outcome.kind === "rejected"
          ? rejectedEstimatorRequest(`agent-selection-rejected:estimator:${slot.outcome.code}`)
          : buildBudgetEstimateRequest({ planHash: plan.planHash, planCanonicalJson: plan.canonicalJson, profile, observation: slot.observation, mode: command.payload.estimateMode, exactTokenCount: this.deps.exactTokenCount });
```
估算记录（`:247-248`）的对象字面量末尾 `reasonCode: prepared.reasonCode, grant: ESTIMATE_GRANT };` → `reasonCode: prepared.reasonCode, grant: ESTIMATE_GRANT, estimatorSlot };`

`claimEstimate`（`:290-294`）—— before：
```ts
        const plan = readArchivedPlan(this.store, id), runId = `run-${randomUUID()}`, ownerToken = randomUUID(), grant = { work: estimate.grant, handoff: zero() };
        const run: EstimateRun = { runId, groupId: id, workItemId: estimateId, taskId: null, estimateId, generation: 1, graphVersion: plan.graphVersion, targetVersion: estimate.estimateVersion,
          commandId: estimateId, configHash: estimate.profile.profileHash, grant, ownerToken, executionProfile: { workKind: "budget-estimate", ...estimate.profile }, handoffProfile: null,
```
after：
```ts
        // Spec §12 C5: the estimate run's configHash is the frozen estimator selection's, never the profile hash.
        const slot = estimate.estimatorSlot;
        if (!slot) throw new ControlError("recovery-blocked", "estimator-slot-missing");
        const plan = readArchivedPlan(this.store, id), runId = `run-${randomUUID()}`, ownerToken = randomUUID(), grant = { work: estimate.grant, handoff: zero() };
        const run: EstimateRun = { runId, groupId: id, workItemId: estimateId, taskId: null, estimateId, generation: 1, graphVersion: plan.graphVersion, targetVersion: estimate.estimateVersion,
          commandId: estimateId, configHash: slot.configHash, agent: slot.selection, agentProvenance: slot.provenance, timeoutMs: slot.timeoutMs, killGraceMs: slot.killGraceMs,
          agentCapabilities: intersectCapabilities(profile.snapshot.profile.capabilities, slot.capabilities),
          grant, ownerToken, executionProfile: { workKind: "budget-estimate", ...estimate.profile }, handoffProfile: null,
```
（`profile` 是 `:265` 已有的 `const profile = …resolve(…)`。）

同一方法的闸门（`:266`）—— before：
```ts
      const observation = await this.deps.profileRouter.probe(profile);
```
after（spec §6.4 末段：估算用冻结的 estimator 选择；没有冻结槽的估算不会是 `queued`，传 `{}` 让端口拒、按降级处理）：
```ts
      const observation = await this.deps.profileRouter.probe(profile, initial.estimatorSlot?.selection ?? {});
```

- [ ] **Step 10.10：面板读模型接受并核对估算 run 的冻结字段（`src/panel/controlViews.ts`）**

import（`:14-35` 的 webProtocol 导入）加 `agentSelectionSchema`、`capabilityViewSchema`、`selectionProvenanceSchema`。
`persistedRunSchema`（`:143` `drive: driveRecordSchema.optional(),` 之后）加：
```ts
  // Agent selection spec §6.4: the frozen selection a run was claimed with (estimate runs from T10, task runs from T11).
  agent: agentSelectionSchema.optional(),
  agentProvenance: selectionProvenanceSchema.optional(),
  timeoutMs: safeInteger.positive().optional(),
  killGraceMs: safeInteger.optional(),
  agentCapabilities: capabilityViewSchema.optional(),
```
估算 run 核对（`:516-519`）—— before：
```ts
      if (!sameBinding(run.executionProfile, estimate.profile, "budget-estimate")
        || canonicalBytes(run.grant.work).compare(canonicalBytes(estimate.grant)) !== 0
        || canonicalBytes(run.grant.handoff).compare(canonicalBytes(zero)) !== 0) return blocked(`run-estimate-profile:${runId}`);
```
after：
```ts
      if (!sameBinding(run.executionProfile, estimate.profile, "budget-estimate")
        || canonicalBytes(run.grant.work).compare(canonicalBytes(estimate.grant)) !== 0
        || canonicalBytes(run.grant.handoff).compare(canonicalBytes(zero)) !== 0) return blocked(`run-estimate-profile:${runId}`);
      // Spec §12 C5: an estimate run carries its estimate's frozen estimator selection and nothing else.
      if (!estimate.estimatorSlot || run.configHash !== estimate.estimatorSlot.configHash
        || canonicalBytes(run.agent ?? null).compare(canonicalBytes(estimate.estimatorSlot.selection)) !== 0) return blocked(`run-estimate-agent:${runId}`);
```

- [ ] **Step 10.11：错误码与 web 镜像**

`errors.ts`：若 `agent-installation-missing` 尚不存在（T7 应已加，W6-11），在 T8 加的两行之后加 `"agent-installation-missing": 422,`。
`web/src/controlTypes.ts:228`：动词联合在 `"set-agent-preferences"` 之后加 `| "proposal-set-agent"`。

- [ ] **Step 10.12：夹具 `tests/control/fixtures/web.ts`（整体替换；这是全部 Web 判据的共用夹具）**

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { vi } from "vitest";
import { openTestStore } from "./store.js";
import { FIXTURE_AGENT, fixtureListAgents, fixtureResolveAgent, seedPreferences } from "./agents.js";
import { createAdmissionGate } from "../../../src/control/admissionGate.js";
import type { OperatorPreferences, PartialSelection } from "../../../src/control/agentSelection.js";
import { resolveProfile, createExecutionProfileRouter } from "../../../src/control/profiles.js";
import { importControlPlan, prepareEstimatorSlot, type ImportCommand } from "../../../src/control/planImport.js";
import { canonicalBytes, sha256Canonical } from "../../../src/control/canonicalJson.js";
import { readArchivedPlan, readBudgetProposal } from "../../../src/control/queries.js";
import type { ExecutionPort } from "../../../src/control/executionPort.js";
import type { CapabilityViewV1, ExecutionProfileSnapshotV1, RawAuthorityCommandV1, ConfirmPayload } from "../../../src/control/webProtocol.js";

export const profileSnapshot = (): ExecutionProfileSnapshotV1 => ({
  schema: "orca-execution-profile-snapshot-v1",
  profile: { profileId: "all", allowedWorkKinds: ["budget-estimate", "goal-review", "handoff", "task"], adapter: "test", adapterConfigRef: "adapter", modelPolicyRef: "policy", contextTokenizer: null, workMaxOutputTokens: 1000,
    capabilities: { usageObservation: "realtime", budgetEnforcement: "bounded", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: 1_000_000,
      requestBoundProof: { scheme: "adapter-request-bound-v1", version: "1", workDimensions: ["tokens"], handoffDimensions: [], evidenceKind: "proof" } },
    estimatorPreflight: { instructionVersion: "1", schemaVersion: "budget-estimate-v1", maxOutputTokens: 64_000, framingTokenOverhead: 17, tokenizer: { kind: "utf8-upper-bound", numerator: 2, denominator: 3, proofRef: "proof" } } },
  resolved: { adapterConfigContentHash: "a".repeat(64), modelPolicyContentHash: "b".repeat(64), proofDocumentContentHashes: ["c".repeat(64)], adapterImplementationHash: "d".repeat(64), adapterProtocolVersion: "1", tokenizerArtifactHashes: [], secretValueHashes: [] },
});

// Seam B (human ruling 2026-09-24, named under ruling 88): targetVersion is one positive safe integer from plan to wire.
export interface WebFixtureTask { taskId: string; dependsOn?: string[]; targetVersion?: number; configHash?: string; targetPaths?: string[]; agent?: PartialSelection }
// Agent selection (2026-09-26): the importing operator's preferences (null leaves them unset) and the plan's group layers.
export interface WebFixtureOptions {
  preferences?: OperatorPreferences | null;
  planAgents?: { agent?: PartialSelection; estimatorAgent?: PartialSelection; reconcileAgent?: PartialSelection };
}

export async function webFixture(snapshot = profileSnapshot(), tasks: readonly WebFixtureTask[] = [{ taskId: "a" }], options: WebFixtureOptions = {}) {
  const h = await openTestStore();
  let observed: CapabilityViewV1 = structuredClone(snapshot.profile.capabilities);
  const accept = vi.fn(async () => ({ kind: "unknown" as const }));
  // Agent selection spec §4.6: ccloop's capabilities-v3 answer, carrying the fixture's current `observed` view,
  // so `setObserved` still degrades whatever a gate probes.
  const resolveAgent = fixtureResolveAgent(() => observed);
  // Interim until T11 Step 11.2 moves every gate to a frozen selection: the selection-less probe the gates still
  // make (W5-M2) keeps answering from `observed`. T11 deletes these two lines.
  const port = { accept, resolveAgent, listAgents: fixtureListAgents,
    probeProfileCapabilities: async () => observed, capabilities: async () => ({ protocol: 2 as const, ...snapshot.profile.capabilities }),
    readEvidence: async () => Buffer.alloc(0), inspect: async () => ({ kind: "unknown" }), requestHandoff: async () => ({ kind: "unknown" }), collect: async () => ({ events: [], candidate: null, terminal: null }) } as unknown as ExecutionPort;
  const supplied = resolveProfile(snapshot, port), router = createExecutionProfileRouter([supplied]);
  const frozen = router.resolve("budget-estimate", "all", supplied.profileHash);
  const repo = join(h.root, "repo"); await mkdir(repo);
  const planPath = join(repo, "plan.json");
  const planTasks = [];
  for (const task of tasks) {
    const contract = { objective: { taskId: task.taskId, goal: "ship", successCondition: "passes", nonGoals: [] },
      context: { repoPath: repo, targetPaths: task.targetPaths ?? [task.taskId], relevantDocs: [], buildTestCommands: ["true"], constraints: [] },
      executionPolicy: { autonomyLevel: "L2", maxAttempts: 9, perAttemptTimeoutMs: 60_000, totalRuntimeBudgetMs: 90_000, tokenBudget: 99_000, worktreeRequired: true, partialOutcomeRecoveryWindowMs: 30_000 },
      safetyPolicy: { allowlistPaths: [], denylistPaths: [], maxFilesTouched: 1, humanGateConditions: [] },
      verification: { verifierType: "command", requiredChecks: ["true"], rejectOn: ["failure"], evidenceRequired: [] },
      escalationAndExit: { escalationTargets: [], pauseOn: [], stopOn: [], terminalStates: ["succeeded", "blocked_waiting_human", "exhausted", "cancelled", "failed"] } };
    const contractPath = join(h.root, `contract-${task.taskId}.json`);
    await writeFile(contractPath, canonicalBytes(contract));
    // Seam B (human ruling 2026-09-24, named under ruling 88): targetVersion is one positive safe integer from plan to wire.
    planTasks.push({ taskId: task.taskId, contract: contractPath, dependsOn: task.dependsOn ?? [], targetVersion: task.targetVersion ?? 1, configHash: task.configHash ?? sha256Canonical({}), ...(task.agent ? { agent: task.agent } : {}) });
  }
  await writeFile(planPath, JSON.stringify({ targetRepo: repo, ccloopBin: "/bin/true", runsDir: h.root, workBranch: "orca/work", policy: "local-merge", ledgerMode: "out-of-repo", goal: "ship", successConditions: ["passes"], ...options.planAgents, tasks: planTasks }));
  const preferences = options.preferences === undefined ? { defaultAgent: FIXTURE_AGENT, perAgent: {} } : options.preferences;
  if (preferences !== null) seedPreferences(h.store, "human", preferences);
  const trustedConfig = { resolveTarget: () => ({ repositoryPath: repo, planPath, validatePlanDescriptor() {} }) };
  const importCommand: ImportCommand = { schema: "orca-raw-command-v1", commandId: "import", expectedRevision: 0, actorId: "human", verb: "import-plan", target: { kind: "group", groupId: "g" }, payload: { groupId: "g", repoId: "repo", planId: "plan" } };
  const prepared = await prepareEstimatorSlot({ store: h.store, trustedConfig, profileRouter: router }, importCommand, frozen);
  const deps = { store: h.store, admissionGate: createAdmissionGate(), profileRouter: router, trustedConfig,
    defaults: () => ({ estimatorProfileId: "all", estimatorProfileHash: frozen.profileHash, estimateMode: "soft" as const }), estimatorSlot: prepared.outcome };
  const imported = importControlPlan({ ...deps, estimatorObservation: () => ({ profile: frozen, observed, probeFailureCode: null }) }, importCommand);
  if ("error" in imported || imported.result.kind !== "imported") throw new Error(JSON.stringify(imported));
  let sequence = 0;
  const raw = (commandId: string, expectedRevision: number, verb: RawAuthorityCommandV1["verb"], target: RawAuthorityCommandV1["target"], payload: unknown) => ({
    schema: "orca-raw-command-v1", commandId, actorId: "human", expectedRevision, verb, target, payload,
  });
  const currentRevision = () => Number(h.store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision);
  const command = <V extends RawAuthorityCommandV1["verb"]>(verb: V, payload: Extract<RawAuthorityCommandV1, { verb: V }>["payload"], commandId = `command-${++sequence}`): Extract<RawAuthorityCommandV1, { verb: V }> =>
    raw(commandId, currentRevision(), verb, { kind: "group", groupId: "g" }, payload) as Extract<RawAuthorityCommandV1, { verb: V }>;
  /** A task-scoped command under the current group revision, for the per-task `continue` path. */
  const taskCommand = <V extends RawAuthorityCommandV1["verb"]>(verb: V, taskId: string, payload: Extract<RawAuthorityCommandV1, { verb: V }>["payload"]): Extract<RawAuthorityCommandV1, { verb: V }> =>
    raw(`command-${++sequence}`, currentRevision(), verb, { kind: "task", groupId: "g", taskId }, payload) as Extract<RawAuthorityCommandV1, { verb: V }>;
  /** A run-scoped command; run-scope `recovery-retry` requires its target to name the same run as its payload. */
  const runCommand = <V extends RawAuthorityCommandV1["verb"]>(verb: V, runId: string, payload: Extract<RawAuthorityCommandV1, { verb: V }>["payload"]): Extract<RawAuthorityCommandV1, { verb: V }> =>
    raw(`command-${++sequence}`, currentRevision(), verb, { kind: "run", groupId: "g", runId }, payload) as Extract<RawAuthorityCommandV1, { verb: V }>;
  const confirmPayload = (): ConfirmPayload => ({ planHash: readArchivedPlan(h.store, "g").planHash, proposalVersion: readBudgetProposal(h.store, "g").proposalVersion, budgetMode: "strict",
    profileIds: { estimator: "all", worker: "all", handoff: "all", goalReview: "all" }, profileHashes: { estimator: frozen.profileHash, worker: frozen.profileHash, handoff: frozen.profileHash, goalReview: frozen.profileHash }, contextPolicy: { handoffAtContextTokens: 800_000 } });
  return { ...h, deps, frozen, accept, resolveAgent, imported, command, taskCommand, runCommand, rawCommand: raw, confirmPayload, estimateId: imported.result.estimateId, setObserved: (value: typeof observed) => { observed = value; } };
}
```

- [ ] **Step 10.13：面板夹具 `tests/panel/fixtures/controlPanel.ts`（`:104-140`）**

import 区加：
```ts
import { readAgentPreferences } from "../../../src/control/agentPreferences.js";
import { FIXTURE_AGENT, fixtureListAgents, fixtureResolveAgent, seedPreferences } from "../../control/fixtures/agents.js";
```
文件顶部常量区加：
```ts
/** The panel operator every mutation route acts as (controlApi.ts: meta.panelOperatorId), fixed so preferences can be seeded. */
export const PANEL_OPERATOR = "operator-00000000-0000-4000-8000-000000000000";
```
`boot` 里 `const store = await openControlStore(…);` 之后插入：
```ts
      // Agent selection spec §6.2 layer 1: the panel's operator prefers the fixture agent, so imports resolve an estimator.
      store.db.prepare("INSERT INTO meta(key,value) VALUES ('panelOperatorId',?) ON CONFLICT(key) DO NOTHING").run(PANEL_OPERATOR);
      if (readAgentPreferences(store, PANEL_OPERATOR).revision === 0) seedPreferences(store, PANEL_OPERATOR, { defaultAgent: FIXTURE_AGENT, perAgent: {} });
```
端口（`:116-122`）—— 在 `const port = {` 之后插入两行（`probeProfileCapabilities`／`capabilities` 两行**保留到 T11 Step 11.2**，理由同 web 夹具）：
```ts
        resolveAgent: fixtureResolveAgent(() => capabilities() as never),
        listAgents: fixtureListAgents,
```

- [ ] **Step 10.14：改写既有判据（**逐文件**；每处改写旁加注释 `// Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): <它现在编码什么>`）**

(1) `tests/control/planImport.test.ts`（全文件 28 条都经 `setup()`；原因：`ImportDeps.estimatorSlot` 必填、导入会读操作者偏好、异步导入的能力 I/O 改为「带选择的 probe」）：
- import 区加：`import { prepareEstimatorSlot } from "../../src/control/planImport.js";`（并入 `:7` 那一行）、`import { fixtureListAgents, fixtureResolveAgent, seedPreferences, FIXTURE_AGENT } from "./fixtures/agents.js";`
- `setup()`（`:50-96`）：`port` 对象（`:79-85`）加两项 `resolveAgent: fixtureResolveAgent(() => profile().profile.capabilities), listAgents: fixtureListAgents,`；`const router = …` 之后加 `seedPreferences(h.store, "operator", { defaultAgent: FIXTURE_AGENT, perAgent: {} });`；`let defaults = …` 之后加：
  ```ts
  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the importing operator
  // ("operator") prefers the fixture agent, so the estimator slot resolves and the baseline estimate stays queued.
  const prepared = await prepareEstimatorSlot({ store: h.store, trustedConfig, profileRouter: router }, command(), frozen);
  const observed = () => ({ ...prepared.observation, observedAt: new Date(0).toISOString() });
  ```
  返回的 `deps` 加 `estimatorSlot: prepared.outcome`；返回对象加 `observed, port`。
- 所有以 `{ ...h.deps.estimatorObservation(h.frozen), observedAt: new Date(0).toISOString() }` 构造的 fake probe 结果（`:162`、`:190-200`、`:207-211` 的 `release(...)` 实参）替换为 `h.observed()`（它带 `resolution`）；`:162` 那一行改为 `const probe = vi.fn(async () => h.observed());`。
- `rechecks revision after a successful in-flight probe before source I/O`（`:186-202`）——**W5-M16，放宽，需人裁**：`expect(resolveTarget).not.toHaveBeenCalled();` 改为
  ```ts
      // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"; W5-M16 pending ruling):
      // the estimator's plan layers are read once before the probe; a race-losing import writes nothing from them.
      expect(resolveTarget).toHaveBeenCalledTimes(1);
      expect(h.store.db.prepare("SELECT count(*) AS n FROM work_items WHERE group_id='g'").get()?.n).toBe(2);
  ```
  （`2` 是赢家 `import-winner` 写的两条；输家不多写一条。）判据标题不改。
- `turns a real probe failure into a terminal import without optimistic capability`（`:304-311`）整条替换为（加强：点名失败码）：
  ```ts
  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): a real ccloop refusal of the
  // estimator selection is a terminal blocked estimate named after it, never an optimistic capability.
  it("turns a real probe failure into a terminal import without optimistic capability", async () => {
    const h = await setup();
    try {
      const refusing = resolveProfile(profile(), { ...h.port, resolveAgent: async () => { throw new ControlError("agent-installation-missing"); } });
      const router = createExecutionProfileRouter([refusing]);
      const result = await importControlPlanAsync({ ...h.deps, profileRouter: router }, command());
      expect(result).toMatchObject({ result: { kind: "imported", estimateState: "blocked-capability", estimateReasonCode: "agent-selection-rejected:estimator:agent-installation-missing" } });
      expect(h.store.db.prepare("SELECT id FROM scheduler_wakes WHERE group_id='g'").get()).toBeUndefined();
    } finally { await h.dispose(); }
  });
  ```
  （`refusing` 与 `h.frozen` 的快照相同 ⇒ `profileHash` 相同，`h.deps.defaults()` 仍解析得到它。）
- 其余 24 条只经 `setup()` 变红，**判据本体不改**。

(2) `tests/panel/controlReadApi.test.ts`（17 条都经 `beforeEach → setup()`；原因同上）：`setup()` 的 `port`（`:97-102`）加 `resolveAgent: fixtureResolveAgent(() => snapshot.profile.capabilities), listAgents: fixtureListAgents,`；`deps`（`:113-117`）之前加
```ts
  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the importing operator prefers
  // the fixture agent; both groups import with the estimator slot resolved from the same plan and preferences.
  seedPreferences(h.store, "operator", { defaultAgent: FIXTURE_AGENT, perAgent: {} });
  const prepared = await prepareEstimatorSlot({ store: h.store, trustedConfig, profileRouter: router }, command("group-b", "prepare"), frozen);
```
`deps` 加 `estimatorSlot: prepared.outcome,`。import 区加 `prepareEstimatorSlot` 与 `./../control/fixtures/agents.js` 的三个名字。判据本体不改。

(3) `tests/control/executionSnapshot.test.ts`（13 条都经 `beforeEach`；原因：估算记录 schema 新增必填 `estimatorSlot`，直接写库的 `estimate` 字面量缺它 ⇒ `readEstimateRecord` 判 `recovery-blocked`）：`beforeEach` 的 `estimate`（`:70-75`）在 `reasonCode: null, grant: amount(10, 10, 1, 1),` 之后加 `estimatorSlot: null,`，旁加注释 `// Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): an estimate row records its frozen estimator slot (none here).`。判据本体不改。

- [ ] **Step 10.15：跑，确认绿**

```bash
cd $ORCA
./node_modules/.bin/vitest run tests/control/agentPlanImport.test.ts > $S/t10-green.log 2>&1; echo rc=$?
./node_modules/.bin/vitest run tests/control/planImport.test.ts tests/panel/controlReadApi.test.ts tests/control/executionSnapshot.test.ts > $S/t10-rewritten.log 2>&1; echo rc=$?
./node_modules/.bin/vitest run tests/control/estimator.test.ts tests/control/proposal.test.ts tests/control/webFaults.test.ts tests/panel/controlLifecycle.test.ts tests/panel/controlApi.test.ts tests/panel/controlRecoveryApi.test.ts tests/control/webMutations.test.ts tests/control/stopIntent.test.ts > $S/t10-neighbours.log 2>&1; echo rc=$?
./node_modules/.bin/tsc --noEmit -p tsconfig.json > $S/t10-tsc.log 2>&1; echo rc=$?
```
Expected：四个 `rc=0`；`agentPlanImport.test.ts` 10 passed。第三行是「只经夹具」的邻居：它们不该需要改；若红，先查夹具，不许改判据本体。

- [ ] **Step 10.16：提交**

```bash
cd $ORCA && /usr/bin/git add -A src/scheduler/planFile.ts src/control web/src/controlTypes.ts src/panel/controlViews.ts tests/control/fixtures/agents.ts tests/control/fixtures/web.ts tests/panel/fixtures/controlPanel.ts tests/control/agentPlanImport.test.ts tests/control/planImport.test.ts tests/panel/controlReadApi.test.ts tests/control/executionSnapshot.test.ts && /usr/bin/git diff --cached --stat > $S/t10-stat.log && /usr/bin/git commit -q -F - <<'EOF'
feat(control): freeze the estimator selection at import and add proposal-set-agent

Spec §6.2 and §6.4: plan files carry agent, estimatorAgent and
reconcileAgent layers; import resolves the estimator slot through the
router's selection probe and freezes ccloop's answer on the group and the
estimate, degrading to a named blocked-capability when it fails. The
estimate run's configHash is the frozen selection's, not the profile
hash (§12 C5). proposal-set-agent replaces or clears one layer (W6-20).

Co-Authored-By: <实施席自己的模型> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR
EOF
```

- [ ] **Step 10.17：命名变异（提交之后，副本 `$S/mut-t10`；每条跑 `tests/control/agentPlanImport.test.ts`，期望 `rc=1`）**

| 名 | 改动（副本） | 期望红的判据 |
|---|---|---|
| T10-M1 | `importControlPlan` 删「`partialNow` 不等 ⇒ `plan-version-conflict`」两行 | 「refuses an import whose operator default changed…」 |
| T10-M2 | `claimEstimate` 的 `configHash: slot.configHash` 改回 `estimate.profile.profileHash` | 「gives the estimate run the frozen estimator configHash…」 |
| T10-M3 | `prepareEstimatorSlot` 传 `{}` 代替 `planGroupLayer(plan)` | 「resolves operator default < operator estimator < plan estimatorAgent…」、「passes a plan's model…」 |
| T10-M4 | `rejectedEstimatorRequest(...)` 的实参换成常量 `"estimate-blocked-capability"` | 「still imports when no layer names an agent…」、「degrades the estimate with ccloop's own refusal code」 |
| T10-M5 | `proposalSetAgent` 删 `reopenProposal(...)` 一行（版本不推进） | 「replaces a group or task layer, advances the proposal version…」 |
| T10-M6 | `proposalSetAgent` 组层分支里 `delete overrides[...]` 改为 `overrides[...] = {}` | 「clears a layer with null…」 |
| T10-M7 | `createEstimate` 的 `overrides` 改为 `{}` | 「re-estimates with the group's estimator layer as it is now」 |
| T10-M8 | `controlViews` 删 `run-estimate-agent` 那一条核对，再在副本判据里把估算 run 的 `agent` 改掉读组视图 | 在副本临时加一条：`readControlGroup` 对被改的估算 run 必须 `blocked`——此变异验证的是读模型核对存在；写进 `mutations.md` 并注明是临时判据 |

**既有判据将变红的（静态预测 58 条，`scratchpad/W5/redsT10.txt`；实施前在副本跑这三个文件确认）：**
- `tests/control/planImport.test.ts` 全部 28 条（经 `setup()`；2 条改本体，见 Step 10.14(1)，其中一条**放宽待裁 W5-M16**）：
  `immutable plan import > normalizes sets, archives contracts, and keeps imported authority unchanged after source edits`；`… > replays the original result without rereading a changed source or changed server defaults`；`… > replays asynchronously before capability I/O and cannot hang on a lost-response retry`；`… > returns a same-id raw conflict before capability I/O`；`… > durably rejects an initially stale import before any defaults, profile, probe, or source callbacks`；`… > rechecks revision after a successful in-flight probe before source I/O`；`… > rechecks command identity after an in-flight probe and creates no duplicate effects`；`… > persists and replays a durable missing profile rejection across a later config change`；`… > persists and replays a durable changed profile rejection across a later config change`；`… > lets a concurrent same-id commit win when an in-flight probe rejects durably`；`… > persists revision conflict before a failing in-flight probe and replays it before changed defaults`；`… > does not persist an unexpected asynchronous preparation failure`；`… > does not persist an transient asynchronous preparation failure`；`… > turns a real probe failure into a terminal import without optimistic capability`；`… > persists a terminal blocked-capability preflight without a scheduler wake`；`… > persists a terminal input-too-large preflight without a scheduler wake`；`… > rejects duplicate task and leaves the group completely absent`；`… > rejects duplicate dependency and leaves the group completely absent`；`… > rejects dangling dependency and leaves the group completely absent`；`… > rejects a contract outside the closed ccloop V1 schema`；`… > rolls back every import row when interrupted before commit`；`… > rejects a plan inode swap between trusted resolution and descriptor validation`；`… > is absent or fully replayable after real SIGKILL before-commit`；`… > is absent or fully replayable after real SIGKILL after-commit`；`… > fails closed when an archived content-addressed plan is missing or damaged`；`… > fails closed on structurally valid but malformed proposal and estimate authority`；`… > fails closed on noncanonical proposal bytes and an estimate request hash mismatch`；`… > persists non-allowlisted source rejection without creating a group`（全名前缀均为 `tests/control/planImport.test.ts > immutable plan import > `；以 `scratchpad/W5/redsT10.txt` 为准）。
- `tests/panel/controlReadApi.test.ts > canonical control read API > *` 全部 17 条（经 `beforeEach → setup()`，本体不改）。
- `tests/control/executionSnapshot.test.ts > execution snapshot preparation > *` 全部 13 条（经 `beforeEach`，本体不改）。


---

### Task 11: 异步确认＋`selectionsHash`＋冻结、执行快照 v2、读模型以快照为权威、profile v2、闸门逐调用点用冻结选择、`handoffGraceMsOf` 读冻结值（含从 T10 移来的「删 `configHash`」，W5-M5）

**Files:**
- Create: `src/control/agentFreeze.ts`（W6-1 的 `resolveGroupSelections` 等）
- Modify: `src/control/webProtocol.ts`（`:98-168` profile v2；`:371-392` 删任务 `configHash`；`:420-480` 执行快照 v2；`:599-608` confirm 加 `selectionsHash`；`:824-837` work item 视图；新增 `frozenTaskAgentSchema`）
- Modify: `src/control/errors.ts`（加 `agent-selection-changed: 409`、`agent-selection-rejected: 422`，已存在则跳过）
- Modify: `src/control/profiles.ts`（`probe(profile, selection)` 必填、删无选择分支）
- Modify: `src/scheduler/planFile.ts`（删 `configHash`：`:15`、`:37`、`:108`、`:240`、`:251`）
- Modify: `src/control/planImport.ts`（删 `configHash`：`normalizeControlPlan` 与 work item 写 `configHash: null`）
- Modify: `src/control/executionSnapshot.ts`（`ConfirmedProposal.agents`；`prepareExecutionSnapshot`；`readConfirmedTaskExecution` 核冻结字段；新增 `readConfirmedReconcileSlot`）
- Modify: `src/control/webService.ts`（`WebServiceDeps.port`；`confirm` 异步；`reopenProposal` 清冻结字段）
- Modify: `src/control/webDispatch.ts`（`:75-115` `scheduleStart`、`:154-198` `deliverScheduledStart` 的闸门；`:279-288` `createStartingRun` 拷冻结字段）
- Modify: `src/control/dispatch.ts:52,77`；`src/control/service.ts`（闸门方法）；`src/control/schedulerBridge.ts:125-127`；`src/control/stopIntent.ts:97-110,562`
- Modify: `src/panel/controlConfig.ts:48,205-206`（`readView(selection)`）；`src/panel/controlApi.ts:77,243`
- Modify: `src/control/driverHandoff.ts:179-183`（`handoffGraceMsOf(run)`）；`src/control/executionDriver.ts:66-67`（注释）；`src/panel/controlAssembly.ts:11,111-124,211-229,257`
- Modify: `src/panel/controlViews.ts`（`workBodySchema`、`persistedRunSchema` 必填化、`validateExecutionSnapshot`、`workViews`、`runViews`）
- Modify: `web/src/controlTypes.ts`（`WorkItemViewV1`、`ConfirmPayloadV1`）；`web/src/BudgetEditor.tsx:85-91,106,124-145`；`tests/panel/webParity.test.ts`（编译期归一化，见 Step 11.15）
- Modify（夹具）: `tests/control/fixtures/web.ts`、`tests/panel/fixtures/controlPanel.ts`、`tests/control/fixtures/driverHarness.ts:40`、`tests/control/fixtures/ccloopWorld.ts`（`raw`、`startGroup`、plan 写入）；`scripts/live-driver-acceptance.ts:118-127`
- Modify（**既有判据整条改写**）：见本 Task 末两张清单
- Create: `tests/control/agentFreeze.test.ts`

**Interfaces:**
- Consumes：T8 全部；T9 `readAgentPreferences`、选择 schema；T10 `frozenSlotSchema`、`selectionProvenanceSchema`、`groupAgentOverridesSchema`、`ObservedProfile.resolution`、组 `agentOverrides`、work `agentOverride`、组 `reconcileSlot` 位；T7 `ExecutionPort.resolveAgent`、`Claim.agent`／`WorkInput.agent`（W5-M11）、`assertCapabilities` 接受不带 `protocol` 的能力视图（若 T7 保留了 `protocol`，本 Task 的 `assertCapabilities(mode, resolution.capabilities)` 处按 T7 的类型补 `protocol` 字段）。
- Produces（W6-1／W6-2／W6-9／W6-12／W6-16／W6-19 原名）：
  - `src/control/agentFreeze.ts`：`SlotResolution`、`GroupSelectionResolution`、`resolveGroupSelections(deps:{store; port: Pick<ExecutionPort,"resolveAgent">}, groupId, operatorId)`；另 `taskSlotKey(taskId)`、`RECONCILE_SLOT_KEY`、`groupSelectionPartials(store, groupId, operatorId)`（同步半边，confirm 事务内复核用）、`frozenWorkAgent(record)`、`type FrozenWorkAgent`。
  - `webProtocol.ts`：`frozenTaskAgentSchema`；`executionSnapshotSchema`＝`orca-execution-snapshot-v2`（加 `agents: {tasks, reconcile}`）；`confirmPayloadSchema.selectionsHash`；`workItemViewSchema` 加 `agent`、`agentProvenance`、`configHash` 可空；`executionProfileSnapshotSchema`＝`orca-execution-profile-snapshot-v2`。
  - `executionSnapshot.ts`：`readConfirmedTaskExecution(...)` 返回值加 `agent: FrozenWorkAgent`；`readConfirmedReconcileSlot(store, groupId): FrozenSlot`（**T12 用**）。
  - `WebServiceDeps.port`、`WebControlService.confirm(command): Promise<WebCommandResult>`。
  - `handoffGraceMsOf(run: { killGraceMs?: unknown }): number`（`driverHandoff.ts`）。
  - `ExecutionProfileRouter.probe(profile, selection: PartialSelection)`（必填）；`TrustedControlConfig.readView(selection: PartialSelection)`。

- [ ] **Step 11.1：写失败的判据 `tests/control/agentFreeze.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { resolveGroupSelections } from "../../src/control/agentFreeze.js";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import { handoffGraceMsOf, HANDOFF_EXTRA_GRACE_MS } from "../../src/control/driverHandoff.js";
import { readConfirmedReconcileSlot, readConfirmedTaskExecution } from "../../src/control/executionSnapshot.js";
import { createExecutionProfileRouter, resolveProfile } from "../../src/control/profiles.js";
import { readArchivedPlan, readBudgetProposal } from "../../src/control/queries.js";
import { readCanonicalRecord } from "../../src/control/snapshot.js";
import { deliverScheduledStart, scheduleStart } from "../../src/control/webDispatch.js";
import { executionProfileSnapshotSchema, executionSnapshotSchema } from "../../src/control/webProtocol.js";
import { WebControlService } from "../../src/control/webService.js";
import { loadPlan } from "../../src/scheduler/planFile.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { FIXTURE_AGENT, FIXTURE_OTHER_AGENT, fixtureResolveAgent, seedPreferences } from "./fixtures/agents.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";

// Agent selection spec §6.4 (confirm freezes; §12 C4 selectionsHash; §12 C3 gates use the frozen selection),
// §6.5 (profile v2, capabilities per (profile, selection)), §6.6 (grace from the frozen killGraceMs), §6.2
// (plan configHash removed), W6-1/W6-2/W6-9/W6-16. §12 I13: a criterion that proves "the frozen value was used"
// compares what the port RECEIVED with what ccloop ANSWERED before confirmation -- never a value read back from
// the store the code under test also wrote.

type Fixture = Awaited<ReturnType<typeof webFixture>>;
const work = (h: Fixture, taskId: string) => JSON.parse(String(h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body));
const groupBody = (h: Fixture) => JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
const resolved = (resolution: Awaited<ReturnType<typeof resolveGroupSelections>>, key: string) => {
  const slot = resolution.slots.find((entry) => entry.key === key)!;
  if (slot.outcome.kind !== "resolved") throw new Error(`${key} rejected: ${slot.outcome.code}`);
  return slot.outcome.frozen;
};

describe("resolveGroupSelections (W6-1, spec §6.3/§6.4 step 1)", () => {
  it("resolves every task's worker slot and the group's reconcile slot, sorted by key, asking ccloop once per distinct partial", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }, { taskId: "b", agent: { agent: FIXTURE_OTHER_AGENT } }]); try {
      h.resolveAgent.mockClear();
      const resolution = await resolveGroupSelections({ store: h.store, port: { resolveAgent: h.resolveAgent } }, "g", "human");
      expect(resolution.slots.map((slot) => [slot.key, slot.slot, slot.taskId])).toEqual([["reconcile", "reconcile", null], ["task:a", "worker", "a"], ["task:b", "worker", "b"]]);
      // task a and the reconcile slot resolve to the same partial: one call answers both.
      expect(h.resolveAgent.mock.calls.map(([partial]) => partial)).toEqual([{ agent: FIXTURE_AGENT }, { agent: FIXTURE_OTHER_AGENT }]);
      expect(resolved(resolution, "task:b").provenance).toEqual({ agent: "task", model: "descriptor", contextWindow: "descriptor" });
      expect(resolution.taskOverrides).toEqual({ a: null, b: { agent: FIXTURE_OTHER_AGENT } });
      expect(resolution.selectionsHash).toBe(sha256Canonical(Object.fromEntries(resolution.slots.map((slot) => {
        const frozen = resolved(resolution, slot.key);
        return [slot.key, { partial: frozen.partial, selection: frozen.selection, configHash: frozen.configHash }];
      }))));
    } finally { await h.dispose(); }
  });

  it("reports a refused slot by ccloop's code and has no selectionsHash then (W6-11)", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }, { taskId: "b", agent: { agent: "no-such-agent" } }]); try {
      const resolution = await resolveGroupSelections({ store: h.store, port: { resolveAgent: h.resolveAgent } }, "g", "human");
      expect(resolution.slots.find((slot) => slot.key === "task:b")!.outcome).toEqual({ kind: "rejected", code: "agent-installation-missing" });
      expect(resolution.selectionsHash).toBeNull();
    } finally { await h.dispose(); }
  });
});

describe("confirm freezes the selection the operator saw (spec §6.4, §12 C4)", () => {
  it("rejects the whole confirmation when any slot fails, naming the task and ccloop's code, and freezes nothing", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }, { taskId: "b", agent: { agent: "no-such-agent" } }]); try {
      const result = await new WebControlService(h.deps).confirm(h.command("confirm", { ...(await h.confirmPayload()), selectionsHash: "0".repeat(64) }));
      expect(result).toMatchObject({ error: { code: "agent-selection-rejected", message: "agent-selection-rejected:b:agent-installation-missing" } });
      expect([work(h, "a").configHash, work(h, "b").configHash, work(h, "a").agent]).toEqual([null, null, undefined]);
      expect(readBudgetProposal(h.store, "g").state).toBe("editable");
    } finally { await h.dispose(); }
  });

  it("refuses a confirmation whose previewed selectionsHash no longer matches (preferences changed after the preview)", async () => {
    const h = await webFixture(); try {
      const payload = await h.confirmPayload();
      seedPreferences(h.store, "human", { defaultAgent: FIXTURE_AGENT, perAgent: { [FIXTURE_AGENT]: { model: "changed" } } }, 1);
      expect(await new WebControlService(h.deps).confirm(h.command("confirm", payload))).toMatchObject({ error: { code: "agent-selection-changed" } });
      expect(work(h, "a").configHash).toBeNull();
    } finally { await h.dispose(); }
  });

  it("re-checks the layers inside the transaction: a change while ccloop answers is refused even with a fresh hash", async () => {
    const h = await webFixture(); try {
      const payload = await h.confirmPayload();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const answer = h.resolveAgent.getMockImplementation()!;
      h.resolveAgent.mockImplementation(async (partial) => { await gate; return answer(partial); });
      const pending = new WebControlService(h.deps).confirm(h.command("confirm", payload));
      seedPreferences(h.store, "human", { defaultAgent: FIXTURE_OTHER_AGENT, perAgent: {} }, 1);
      release();
      expect(await pending).toMatchObject({ error: { code: "agent-selection-changed" } });
    } finally { await h.dispose(); }
  });

  it("freezes ccloop's answer onto every work item, the group's reconcile slot and execution snapshot v2", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }, { taskId: "b", agent: { agent: FIXTURE_OTHER_AGENT, model: "b-model" } }]); try {
      const preview = await resolveGroupSelections({ store: h.store, port: { resolveAgent: h.resolveAgent } }, "g", "human");
      const confirmed = await new WebControlService(h.deps).confirm(h.command("confirm", await h.confirmPayload()));
      if ("error" in confirmed || confirmed.result.kind !== "confirmed") throw new Error(JSON.stringify(confirmed));
      const b = resolved(preview, "task:b");
      const expectedB = { agent: b.selection, agentProvenance: b.provenance, configHash: b.configHash, timeoutMs: b.timeoutMs, killGraceMs: b.killGraceMs, agentCapabilities: profileSnapshot().profile.capabilities };
      expect(work(h, "b")).toMatchObject(expectedB);
      expect(groupBody(h).reconcileSlot).toEqual(resolved(preview, "reconcile"));
      const snapshot = executionSnapshotSchema.parse(JSON.parse(readCanonicalRecord(h.store, confirmed.result.executionSnapshotHash)));
      expect(snapshot.schema).toBe("orca-execution-snapshot-v2");
      expect(snapshot.agents.tasks.find((task) => task.taskId === "b")).toEqual({ taskId: "b", ...expectedB });
      expect(readConfirmedTaskExecution(h.store, "g", "b").agent).toEqual(expectedB);
      expect(readConfirmedReconcileSlot(h.store, "g")).toEqual(resolved(preview, "reconcile"));
      expect(readControlGroup(h.store, "epoch-test", "g").workItems.find((item) => item.taskId === "b"))
        .toMatchObject({ configHash: b.configHash, agent: b.selection, agentProvenance: b.provenance });
    } finally { await h.dispose(); }
  });

  it("treats the snapshot as authority: a frozen field edited after confirmation is refused by execution and the read model", async () => {
    const h = await webFixture(); try {
      await new WebControlService(h.deps).confirm(h.command("confirm", await h.confirmPayload()));
      const edited = { ...work(h, "a"), agent: { agent: FIXTURE_OTHER_AGENT, model: "x", contextWindow: "agent-default" } };
      h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='a'").run(JSON.stringify(edited));
      expect(() => readConfirmedTaskExecution(h.store, "g", "a")).toThrow("recovery-blocked");
      expect(() => readControlGroup(h.store, "epoch-test", "g")).toThrow("work-item-agent:a");
    } finally { await h.dispose(); }
  });

  it("shows a draft work item with no configHash and no selection (spec §6.2, §12 I3)", async () => {
    const h = await webFixture(); try {
      expect(readControlGroup(h.store, "epoch-test", "g").workItems[0]).toMatchObject({ configHash: null, agent: null, agentProvenance: null });
      expect(readArchivedPlan(h.store, "g").plan.tasks[0]).not.toHaveProperty("configHash");
    } finally { await h.dispose(); }
  });
});

describe("after confirmation the frozen selection is the one used (spec §9 criterion 8, §12 C3/I13)", () => {
  it("probes and claims with the frozen selection even after the operator switches default agent", async () => {
    const h = await webFixture(); try {
      const preview = await resolveGroupSelections({ store: h.store, port: { resolveAgent: h.resolveAgent } }, "g", "human");
      const frozen = resolved(preview, "task:a");
      const service = new WebControlService(h.deps);
      await service.confirm(h.command("confirm", await h.confirmPayload()));
      seedPreferences(h.store, "human", { defaultAgent: FIXTURE_OTHER_AGENT, perAgent: {} }, 1);
      h.resolveAgent.mockClear();
      const deps = { store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate };
      expect(await scheduleStart(deps, h.command("start", {}))).toMatchObject({ result: { kind: "scheduled" } });
      const delivered = await deliverScheduledStart(deps, "g");
      if (delivered.kind !== "claimed") throw new Error(JSON.stringify(delivered));
      expect(h.resolveAgent.mock.calls.length).toBeGreaterThan(0);
      for (const [partial] of h.resolveAgent.mock.calls) expect(partial).toEqual(frozen.selection);
      const run = JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(delivered.runId)!.body));
      expect({ agent: run.agent, configHash: run.configHash, killGraceMs: run.killGraceMs }).toEqual({ agent: frozen.selection, configHash: frozen.configHash, killGraceMs: frozen.killGraceMs });
    } finally { await h.dispose(); }
  });
});

describe("profile v2 (spec §6.5)", () => {
  it("refuses a v1 snapshot and any adapter identity field", () => {
    const v2 = profileSnapshot();
    expect(executionProfileSnapshotSchema.safeParse(v2).success).toBe(true);
    expect(executionProfileSnapshotSchema.safeParse({ ...v2, schema: "orca-execution-profile-snapshot-v1" }).success).toBe(false);
    expect(executionProfileSnapshotSchema.safeParse({ ...v2, profile: { ...v2.profile, adapter: "codex" } }).success).toBe(false);
    expect(executionProfileSnapshotSchema.safeParse({ ...v2, resolved: { ...v2.resolved, adapterImplementationHash: "d".repeat(64) } }).success).toBe(false);
  });

  it("intersects the declared capabilities with the answer for the probed selection, per selection", async () => {
    const declared = profileSnapshot().profile.capabilities;
    const resolveAgent = fixtureResolveAgent(() => declared);
    const answer = resolveAgent.getMockImplementation()!;
    resolveAgent.mockImplementation(async (partial) => {
      const base = await answer(partial);
      return partial.agent === FIXTURE_OTHER_AGENT ? { ...base, capabilities: { ...base.capabilities, handoffControl: "phase-end" as const } } : base;
    });
    const profile = resolveProfile(profileSnapshot(), { resolveAgent } as never);
    const router = createExecutionProfileRouter([profile]);
    expect((await router.probe(profile, { agent: FIXTURE_AGENT })).observed.handoffControl).toBe("durable");
    expect((await router.probe(profile, { agent: FIXTURE_OTHER_AGENT })).observed.handoffControl).toBe("phase-end");
  });
});

describe("plan files and grace (spec §6.2, §6.6)", () => {
  it("refuses a plan task that still carries configHash", () => {
    const base = { targetRepo: "/abs/repo", ccloopBin: "/abs/ccloop", runsDir: "/abs/runs", workBranch: "orca/w", policy: "local-merge", ledgerMode: "out-of-repo" };
    expect(loadPlan({ ...base, tasks: [{ taskId: "a", contract: "/abs/a.json", dependsOn: [], targetVersion: 1 }] }, "main")).toHaveProperty("plan");
    expect(loadPlan({ ...base, tasks: [{ taskId: "a", contract: "/abs/a.json", dependsOn: [], targetVersion: 1, configHash: "a".repeat(64) }] }, "main"))
      .toMatchObject({ rejections: [{ code: "malformed" }] });
  });

  it("judges a handoff's grace by the run's frozen killGraceMs plus the fixed extra", () => {
    expect(handoffGraceMsOf({ killGraceMs: 7_000 })).toBe(7_000 + HANDOFF_EXTRA_GRACE_MS);
    for (const killGraceMs of [undefined, -1, 1.5, "5000", null]) expect(handoffGraceMsOf({ killGraceMs })).toBe(HANDOFF_EXTRA_GRACE_MS);
  });

  it("keeps the canonical identity of what it froze (the snapshot hash is over canonical bytes)", async () => {
    const h = await webFixture(); try {
      const confirmed = await new WebControlService(h.deps).confirm(h.command("confirm", await h.confirmPayload()));
      if ("error" in confirmed || confirmed.result.kind !== "confirmed") throw new Error(JSON.stringify(confirmed));
      const record = readCanonicalRecord(h.store, confirmed.result.executionSnapshotHash);
      expect(canonicalBytes(JSON.parse(record)).toString("utf8")).toBe(record);
    } finally { await h.dispose(); }
  });
});
```

- [ ] **Step 11.2：跑，确认红**

```bash
cd $ORCA && ./node_modules/.bin/vitest run tests/control/agentFreeze.test.ts > $S/t11-red.log 2>&1; echo rc=$?
```
Expected：`rc=1`，`agentFreeze.js` 无法加载。

- [ ] **Step 11.3：`webProtocol.ts`**

(a) profile v2（`:98-168` 整段替换为）：
```ts
// Agent selection spec §6.5 (human ruling "同意删"): the adapter identity fields are gone -- which agent and which
// model are now the frozen selection's, and capabilities come from ccloop's answer for that selection (spec §3 I3).
export const executionProfileSnapshotSchema = z
  .object({
    schema: z.literal("orca-execution-profile-snapshot-v2"),
    profile: z
      .object({
        profileId: idSchema,
        allowedWorkKinds: z
          .array(webWorkKindSchema)
          .min(1)
          .superRefine((values, ctx) => requireSortedUnique(values, String, ctx, [])),
        contextTokenizer: z.object({ tokenizerId: nonemptyString, tokenizerVersion: nonemptyString }).strict().nullable(),
        workMaxOutputTokens: positiveSafeInteger.nullable(),
        capabilities: declaredCapabilitiesSchema,
        estimatorPreflight: z
          .object({
            instructionVersion: nonemptyString,
            schemaVersion: z.literal("budget-estimate-v1"),
            maxOutputTokens: positiveSafeInteger,
            framingTokenOverhead: safeInteger,
            tokenizer: tokenizerSchema,
          })
          .strict()
          .nullable(),
      })
      .strict(),
    resolved: z
      .object({
        proofDocumentContentHashes: sortedHashArraySchema,
        tokenizerArtifactHashes: z.array(
          z.object({ purpose: z.enum(["context", "estimator"]), contentHash: hashSchema }).strict(),
        ),
        secretValueHashes: z.array(z.object({ name: nonemptyString, valueHash: hashSchema }).strict()),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const { profile, resolved } = value;
    const observesContext = profile.capabilities.contextObservation !== "unavailable";
    if (observesContext !== (profile.contextTokenizer !== null)) {
      issue(ctx, ["profile", "contextTokenizer"], "context-tokenizer-capability-mismatch");
    }
    const doesTaskWork = profile.allowedWorkKinds.includes("task");
    if (doesTaskWork !== (profile.workMaxOutputTokens !== null)) {
      issue(ctx, ["profile", "workMaxOutputTokens"], "work-output-limit-kind-mismatch");
    }
    requireSortedUnique(resolved.tokenizerArtifactHashes, (entry) => entry.purpose, ctx, ["resolved", "tokenizerArtifactHashes"]);
    requireSortedUnique(resolved.secretValueHashes, (entry) => entry.name, ctx, ["resolved", "secretValueHashes"]);
    const expectedPurposes: string[] = [];
    if (profile.contextTokenizer !== null) expectedPurposes.push("context");
    if (profile.estimatorPreflight?.tokenizer.kind === "exact") expectedPurposes.push("estimator");
    const actualPurposes = resolved.tokenizerArtifactHashes.map((entry) => entry.purpose);
    if (expectedPurposes.join("\0") !== actualPurposes.join("\0")) {
      issue(ctx, ["resolved", "tokenizerArtifactHashes"], "tokenizer-artifact-set-mismatch");
    }
  });
```
（类型名 `ExecutionProfileSnapshotV1` 保留，避免全仓改名；其 schema 字面量是 v2。）

(b) `controlPlanSchema` 任务里删 `configHash: hashSchema,` 一行（T10 加的 `agent` 保留）。

(c) 在 `frozenSlotSchema`（T10）之后加：
```ts
// Agent selection spec §6.4 step 4: what confirmation froze onto one task's work item, and what its runs carry.
export const frozenTaskAgentSchema = z
  .object({
    taskId: idSchema,
    agent: agentSelectionSchema,
    agentProvenance: selectionProvenanceSchema,
    configHash: hashSchema,
    timeoutMs: positiveSafeInteger.max(2_147_483_647),
    killGraceMs: safeInteger.max(60_000),
    agentCapabilities: capabilityViewSchema,
  })
  .strict();
```

(d) 执行快照 v2（`:420-480`）：`schema: z.literal("orca-execution-snapshot-v1"),` → `schema: z.literal("orca-execution-snapshot-v2"),`；`derivedContracts: …,` 之后加：
```ts
    // Spec §6.4 step 4 (§12 I3): each task's frozen selection and the group's reconcile slot.
    agents: z.object({ tasks: z.array(frozenTaskAgentSchema), reconcile: frozenSlotSchema }).strict(),
```
superRefine 开头（`requireSortedUnique(value.derivedContracts, …)` 之后）加：
```ts
    requireSortedUnique(value.agents.tasks, (task) => task.taskId, ctx, ["agents", "tasks"]);
    if (value.agents.tasks.map((task) => task.taskId).join("\0") !== value.derivedContracts.map((contract) => contract.taskId).join("\0")) {
      issue(ctx, ["agents", "tasks"], "agent-task-set-mismatch");
    }
```
⚠️ `frozenTaskAgentSchema`／`frozenSlotSchema` 必须定义在 `executionSnapshotSchema` 之前（`:420` 之前）。

(e) `confirmPayloadSchema`（`:599-608`）在 `contextPolicy: …,` 之后加：
```ts
    // Spec §6.4 step 3 (§12 C4): the hash of the selections the operator saw; refused as agent-selection-changed otherwise.
    selectionsHash: hashSchema,
```

(f) `workItemViewSchema`（`:824-837`）—— before：
```ts
    targetVersion: positiveSafeInteger,
    configHash: hashSchema,
    originalContractHash: hashSchema,
```
after（W6-9）：
```ts
    targetVersion: positiveSafeInteger,
    // Agent selection spec §6.2 / §12 I3: null until confirmation freezes a selection onto the work item.
    configHash: hashSchema.nullable(),
    agent: agentSelectionSchema.nullable(),
    agentProvenance: selectionProvenanceSchema.nullable(),
    originalContractHash: hashSchema,
```

- [ ] **Step 11.4：错误码（`errors.ts`，已存在则跳过）**

在 T8 加的 `"agent-selection-invalid": 422,` 之后加：
```ts
  // Spec §6.4 steps 2-3 (W6-12): a slot ccloop refused (suffix :<taskId|reconcile>:<code>), and a confirmation whose
  // selections are no longer the ones the operator saw.
  "agent-selection-rejected": 422,
```
在 409 组（`"graph-version-conflict": 409,` 之前，按字母序）加：
```ts
  "agent-selection-changed": 409,
```

- [ ] **Step 11.5：写 `src/control/agentFreeze.ts`**

```ts
import { readAgentPreferences } from "./agentPreferences.js";
import { descriptorProvenance, resolveSelection, selectionsHash, slotLayers, type AgentResolution, type FrozenSlot, type GroupAgentOverrides, type PartialSelection } from "./agentSelection.js";
import { canonicalBytes } from "./canonicalJson.js";
import { ControlError, nonDurableControlErrorClassifications } from "./errors.js";
import type { ExecutionPort } from "./executionPort.js";
import { readArchivedPlan, readBudgetProposal } from "./queries.js";
import type { ControlStore } from "./store.js";
import { frozenTaskAgentSchema, groupAgentOverridesSchema, partialSelectionSchema } from "./webProtocol.js";

export const RECONCILE_SLOT_KEY = "reconcile";
export const taskSlotKey = (taskId: string): string => `task:${taskId}`;

export interface SlotResolution {
  key: string; slot: "worker" | "reconcile"; taskId: string | null;
  outcome: { kind: "resolved"; frozen: FrozenSlot } | { kind: "rejected"; code: string };
}
export interface GroupSelectionResolution {
  proposalVersion: number;
  groupOverrides: GroupAgentOverrides;
  taskOverrides: Record<string, PartialSelection | null>;
  slots: SlotResolution[];            // sorted by key
  selectionsHash: string | null;      // null iff any slot was rejected
}

type SlotPartial = { key: string; slot: "worker" | "reconcile"; taskId: string | null }
  & ({ resolved: ReturnType<typeof resolveSelection> } | { code: "agent-unselected" });

function invalid(detail: string): never { throw new ControlError("recovery-blocked", detail); }

/**
 * The synchronous half of spec §6.4 step 1: each slot's partial from the layers as stored now (W6-16: the
 * command actor's preferences). confirm runs it again inside its transaction to prove nothing moved.
 */
export function groupSelectionPartials(store: ControlStore, groupId: string, operatorId: string): {
  proposalVersion: number; groupOverrides: GroupAgentOverrides; taskOverrides: Record<string, PartialSelection | null>; slots: SlotPartial[];
} {
  const prefs = readAgentPreferences(store, operatorId).preferences;
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
  if (!row) throw new ControlError("group-not-found");
  const overrides = groupAgentOverridesSchema.safeParse((JSON.parse(String(row.body)) as { agentOverrides?: unknown }).agentOverrides ?? {});
  if (!overrides.success) invalid("agent-overrides-invalid");
  const groupOverrides = overrides.data as GroupAgentOverrides;
  const plan = readArchivedPlan(store, groupId).plan;
  const proposalVersion = readBudgetProposal(store, groupId).proposalVersion;
  const attempt = (resolve: () => ReturnType<typeof resolveSelection>): { resolved: ReturnType<typeof resolveSelection> } | { code: "agent-unselected" } => {
    try { return { resolved: resolve() }; }
    catch (error) {
      if (error instanceof ControlError && error.code === "agent-unselected") return { code: "agent-unselected" };
      throw error;
    }
  };
  const taskOverrides: Record<string, PartialSelection | null> = {};
  const slots: SlotPartial[] = [];
  for (const task of plan.tasks) {
    const workRow = store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id=?").get(groupId, task.taskId);
    if (!workRow) invalid(`work-item-missing:${task.taskId}`);
    const raw = (JSON.parse(String(workRow.body)) as { agentOverride?: unknown }).agentOverride ?? null;
    const override = raw === null ? null : partialSelectionSchema.safeParse(raw);
    if (override !== null && !override.success) invalid(`agent-override-invalid:${task.taskId}`);
    const partial = override === null ? null : override.data as PartialSelection;
    taskOverrides[task.taskId] = partial;
    slots.push({ key: taskSlotKey(task.taskId), slot: "worker", taskId: task.taskId,
      ...attempt(() => resolveSelection(slotLayers("worker", prefs, groupOverrides, partial ?? undefined), prefs.perAgent)) });
  }
  slots.push({ key: RECONCILE_SLOT_KEY, slot: "reconcile", taskId: null, ...attempt(() => resolveSelection(slotLayers("reconcile", prefs, groupOverrides), prefs.perAgent)) });
  slots.sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
  return { proposalVersion, groupOverrides, taskOverrides, slots };
}

/**
 * Spec §6.4 steps 1-3 (W6-1): resolve every slot through ccloop, once per distinct partial. A named refusal is the
 * slot's outcome (W6-11); a transient port failure is thrown so it is retried rather than frozen as a rejection.
 */
export async function resolveGroupSelections(
  deps: { store: ControlStore; port: Pick<ExecutionPort, "resolveAgent"> },
  groupId: string,
  operatorId: string,
): Promise<GroupSelectionResolution> {
  const base = groupSelectionPartials(deps.store, groupId, operatorId);
  const answers = new Map<string, Promise<AgentResolution>>();
  const slots: SlotResolution[] = [];
  for (const entry of base.slots) {
    const identity = { key: entry.key, slot: entry.slot, taskId: entry.taskId };
    if ("code" in entry) { slots.push({ ...identity, outcome: { kind: "rejected", code: entry.code } }); continue; }
    const { partial, provenance } = entry.resolved;
    const id = canonicalBytes(partial).toString("utf8");
    if (!answers.has(id)) answers.set(id, deps.port.resolveAgent(partial));
    try {
      const resolution = await answers.get(id)!;
      const frozen: FrozenSlot = { ...structuredClone(resolution), partial, provenance: descriptorProvenance(partial, resolution.selection, provenance) };
      slots.push({ ...identity, outcome: { kind: "resolved", frozen } });
    } catch (error) {
      if (!(error instanceof ControlError)) throw error;
      if ((nonDurableControlErrorClassifications as Record<string, string>)[error.code] === "transient") throw error;
      slots.push({ ...identity, outcome: { kind: "rejected", code: error.code } });
    }
  }
  const frozen: Record<string, FrozenSlot> = {};
  for (const slot of slots) if (slot.outcome.kind === "resolved") frozen[slot.key] = slot.outcome.frozen;
  return {
    proposalVersion: base.proposalVersion, groupOverrides: base.groupOverrides, taskOverrides: base.taskOverrides, slots,
    selectionsHash: Object.keys(frozen).length === slots.length ? selectionsHash(frozen) : null,
  };
}

/** The partial each slot answered with, keyed by slot, to compare a resolution with the layers as they are now. */
export function answeredPartials(resolution: GroupSelectionResolution): Array<[string, PartialSelection | string]> {
  return resolution.slots.map((slot) => [slot.key, slot.outcome.kind === "resolved" ? slot.outcome.frozen.partial : slot.outcome.code]);
}
export function currentPartials(store: ControlStore, groupId: string, operatorId: string): Array<[string, PartialSelection | string]> {
  return groupSelectionPartials(store, groupId, operatorId).slots.map((slot) => [slot.key, "code" in slot ? slot.code : slot.resolved.partial]);
}

const frozenWorkAgentSchema = frozenTaskAgentSchema.omit({ taskId: true });
export type FrozenWorkAgent = ReturnType<typeof frozenWorkAgentSchema.parse>;

/** The six frozen fields of a work item or run (spec §6.4 step 4); anything else about the record is ignored. */
export function frozenWorkAgent(record: unknown): FrozenWorkAgent {
  const source = (record ?? {}) as Record<string, unknown>;
  const parsed = frozenWorkAgentSchema.safeParse({
    agent: source.agent, agentProvenance: source.agentProvenance, configHash: source.configHash,
    timeoutMs: source.timeoutMs, killGraceMs: source.killGraceMs, agentCapabilities: source.agentCapabilities,
  });
  if (!parsed.success) invalid("frozen-agent-invalid");
  return parsed.data;
}
```

- [ ] **Step 11.6：路由器探测必须带选择（`src/control/profiles.ts`）**

`ExecutionProfileRouter.probe` → `probe(profile: FrozenProfile, selection: PartialSelection): Promise<ObservedProfile>;`。`probe` 实现删掉 T10 保留的「不带选择」那一支（`if (selection !== undefined) { … }` 去掉条件、保留块体；删 `probeProfileCapabilities` 那四行与其 `return`），签名改必填。若 T7 仍在 `ownPort`／`unboundPort` 留着 `probeProfileCapabilities`／`capabilities`，一并删（W5-M2 的临时态到此结束）。

- [ ] **Step 11.7：删 plan 的 `configHash`（W5-M5，从 T10 移来）**

`src/scheduler/planFile.ts`：删 `:15` `configHash?: string;`、`:37` `configHash: string;`、`:108` `configHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),`、`:251` `configHash: task.configHash!,`；`:240` —— before：
```ts
    if (task.targetVersion === undefined || task.configHash === undefined) return sourceRejected(`task-control-metadata:${task.taskId}`);
```
after：
```ts
    if (task.targetVersion === undefined) return sourceRejected(`task-control-metadata:${task.taskId}`);
```
`src/control/planImport.ts`：`normalizeControlPlan` 的任务映射删 `configHash: task.configHash,`；work item（`:208-213`）`configHash: task.configHash,` → `configHash: null,`（旁注 `// Spec §6.2 / §12 I3: a draft has no configHash; confirmation freezes one.`）。

- [ ] **Step 11.8：执行快照（`src/control/executionSnapshot.ts`）**

import 加：
```ts
import { frozenWorkAgent, type FrozenWorkAgent } from "./agentFreeze.js";
import type { FrozenSlot } from "./agentSelection.js";
```
并把 `:15` 改为 `import { readArchivedPlan, readBudgetProposal, readEstimateRecord, readWork } from "./queries.js";`。
`ConfirmedProposal`（`:28-47`）在 `tasks: …;` 之后加：
```ts
  /** Spec §6.4 step 4: each task's frozen selection and the group's reconcile slot. */
  agents: ExecutionSnapshotV1["agents"];
```
`prepareExecutionSnapshot`：`executionSnapshotSchema.parse({` 之前加：
```ts
  const agentTasks = [...input.agents.tasks].sort((left, right) => compare(left.taskId, right.taskId));
  if (agentTasks.map(task => task.taskId).join("\0") !== derivedContracts.map(contract => contract.taskId).join("\0")) throw new ControlError("plan-version-conflict");
```
`schema: "orca-execution-snapshot-v1",` → `schema: "orca-execution-snapshot-v2",`；`derivedContracts: …,` 之后加 `agents: { tasks: agentTasks, reconcile: input.agents.reconcile },`。
`readConfirmedTaskExecution`（`:286-294`）—— before：
```ts
    const expected = deriveContract({ ...task, work: work.amount, handoff: handoff.amount }, proposal.proposalVersion);
    const canonicalJson = readCanonicalRecord(store, ref.derivedContractHash);
    if (canonicalJson !== expected.canonicalJson || ref.derivedContractHash !== expected.derivedContractHash) throw new ControlError("recovery-blocked");
    return { derivedContractHash: ref.derivedContractHash, contractCanonicalJson: expected.contractCanonicalJson,
      contract: taskContractSchema.parse(JSON.parse(expected.contractCanonicalJson)), grant: { work: work.amount, handoff: handoff.amount } };
```
after：
```ts
    const expected = deriveContract({ ...task, work: work.amount, handoff: handoff.amount }, proposal.proposalVersion);
    const canonicalJson = readCanonicalRecord(store, ref.derivedContractHash);
    if (canonicalJson !== expected.canonicalJson || ref.derivedContractHash !== expected.derivedContractHash) throw new ControlError("recovery-blocked");
    // Spec §6.4 step 4 (§12 I3): the snapshot is the authority for the frozen selection; the work item must agree.
    const entry = snapshot.agents.tasks.find(t => t.taskId === taskId);
    if (!entry) throw new ControlError("recovery-blocked");
    const { taskId: _taskId, ...frozen } = entry;
    const agent: FrozenWorkAgent = frozen;
    if (sha256Canonical(frozenWorkAgent(readWork(store, groupId, taskId))) !== sha256Canonical(agent)) throw new ControlError("recovery-blocked");
    return { derivedContractHash: ref.derivedContractHash, contractCanonicalJson: expected.contractCanonicalJson,
      contract: taskContractSchema.parse(JSON.parse(expected.contractCanonicalJson)), grant: { work: work.amount, handoff: handoff.amount }, agent };
```
文末加：
```ts
/** Spec §6.1 / §6.4 step 4: the group's frozen reconcile slot, as the confirmed snapshot records it (T12's resolution run uses it). */
export function readConfirmedReconcileSlot(store: ControlStore, groupId: string): FrozenSlot {
  const proposal = readBudgetProposal(store, groupId);
  if (proposal.state !== "confirmed" || !proposal.executionSnapshotHash) throw new ControlError("group-state-invalid");
  try {
    const snapshot = executionSnapshotSchema.parse(JSON.parse(readCanonicalRecord(store, proposal.executionSnapshotHash)));
    const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
    const stored = row ? (JSON.parse(String(row.body)) as { reconcileSlot?: unknown }).reconcileSlot : undefined;
    if (sha256Canonical(stored ?? null) !== sha256Canonical(snapshot.agents.reconcile)) throw new ControlError("recovery-blocked");
    return snapshot.agents.reconcile as FrozenSlot;
  } catch (error) {
    if (error instanceof ControlError) throw error;
    throw new ControlError("recovery-blocked");
  }
}
```

- [ ] **Step 11.9：异步确认（`src/control/webService.ts`）**

import 加：
```ts
import { answeredPartials, currentPartials, RECONCILE_SLOT_KEY, resolveGroupSelections, taskSlotKey, type GroupSelectionResolution } from "./agentFreeze.js";
import type { ExecutionPort } from "./executionPort.js";
```
`WebServiceDeps`（`:30`）—— before：
```ts
export interface WebServiceDeps extends AsyncImportDeps { admissionGate?: AdmissionGate; now?: () => Date; knownRepository?: (repoId: string) => boolean }
```
after（W6-19）：
```ts
export interface WebServiceDeps extends AsyncImportDeps {
  admissionGate?: AdmissionGate; now?: () => Date; knownRepository?: (repoId: string) => boolean;
  /** Agent selection spec §6.4 (W6-19): the same port the panel uses; confirm resolves selections through it. */
  port: Pick<ExecutionPort, "resolveAgent">;
}
```
`reopenProposal`（T10 抽出的函数）的 work item 循环里，`work.status = "draft"; work.derivedContractHash = null;` 之后加：
```ts
    // Spec §6.4: a reopened proposal has no frozen selection; the next confirmation freezes one.
    work.configHash = null;
    for (const key of ["agent", "agentProvenance", "timeoutMs", "killGraceMs", "agentCapabilities"]) delete work[key];
```
并在 `saveWebAuthority(store, group, proposal);` 之前加 `(group as Record<string, unknown>).reconcileSlot = null;`。

`confirm`（`:387-433`）整段替换为：
```ts
  /** Spec §6.4 (§12 C4): resolve every slot outside the transaction, then freeze only if nothing moved since. */
  async confirm(command: ConfirmCommand): Promise<WebCommandResult> {
    const release = this.deps.admissionGate?.enter();
    try {
      const replay = preflightWebCommand<WebCommandResult>(this.store, command); if (replay) return replay.body;
      // A failure here is decided inside the transaction, after every existing check, so error precedence is unchanged.
      const prepared: GroupSelectionResolution | { failure: unknown } = await resolveGroupSelections({ store: this.store, port: this.deps.port }, groupId(command), command.actorId)
        .catch((failure: unknown) => ({ failure }));
      return applyWebCommand(this.store, {
        rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
        apply: context => {
          const id = groupId(command), group = readWebGroup(this.store, id), plan = readArchivedPlan(this.store, id), proposal = readBudgetProposal(this.store, id), payload = command.payload;
          if (payload.planHash !== plan.planHash) throw new ControlError("plan-version-conflict");
          if (payload.proposalVersion !== proposal.proposalVersion) throw new ControlError("proposal-version-conflict");
          prestart(group);
          if (proposal.state === "confirmed") throw new ControlError("no-op-command");
          assertKnownConservation(this.store, group, proposal);
          const selected = { estimator: this.deps.profileRouter.resolve("budget-estimate", payload.profileIds.estimator, payload.profileHashes.estimator), worker: this.deps.profileRouter.resolve("task", payload.profileIds.worker, payload.profileHashes.worker), handoff: this.deps.profileRouter.resolve("handoff", payload.profileIds.handoff, payload.profileHashes.handoff), goalReview: this.deps.profileRouter.resolve("goal-review", payload.profileIds.goalReview, payload.profileHashes.goalReview) };
          const window = selected.worker.snapshot.profile.capabilities.contextWindowTokens, threshold = payload.contextPolicy.handoffAtContextTokens;
          if (window === null ? threshold !== null : threshold === null || threshold > window) throw new ControlError("execution-policy-unrepresentable");
          const profiles = Object.fromEntries(Object.entries(selected).map(([slot, p]) => [slot, { profileId: p.snapshot.profile.profileId, profileHash: p.profileHash }])) as Record<keyof typeof selected, ProfileBindingV1>;
          for (const row of proposal.allocations) for (const d of dimensions) {
            const source = row.fieldProvenance[d];
            if (source.provenance !== "model") continue;
            if (row.ownerKind === "reserve") throw new ControlError("proposal-version-conflict");
            const target = row.ownerKind === "goal-review" ? { scope: "goal-review" as const, dimension: d } : { scope: "task" as const, taskId: row.ownerId, allocation: row.bucket as "work" | "handoff", dimension: d };
            verifyModelField(this.store, id, proposal, target, row.amount[d], source.estimateId!);
          }
          // Spec §6.4 step 2: any failed slot rejects the whole confirmation, named after the first one by key.
          if ("failure" in prepared) throw prepared.failure;
          const resolution: GroupSelectionResolution = prepared;
          const rejected = resolution.slots.find(slot => slot.outcome.kind === "rejected");
          if (rejected && rejected.outcome.kind === "rejected") throw new ControlError("agent-selection-rejected", `${rejected.taskId ?? RECONCILE_SLOT_KEY}:${rejected.outcome.code}`);
          // Step 3: what was resolved is what the operator saw, and the layers have not moved since (inside the transaction).
          if (payload.selectionsHash !== resolution.selectionsHash || resolution.proposalVersion !== proposal.proposalVersion
            || !canonicalBytes(answeredPartials(resolution)).equals(canonicalBytes(currentPartials(this.store, id, command.actorId)))) throw new ControlError("agent-selection-changed");
          const frozenOf = (key: string) => {
            const slot = resolution.slots.find(entry => entry.key === key);
            if (!slot || slot.outcome.kind !== "resolved") throw new ControlError("recovery-blocked", `slot-missing:${key}`);
            return slot.outcome.frozen;
          };
          const workerDeclared = selected.worker.snapshot.profile.capabilities;
          const agentTasks = plan.plan.tasks.map(task => {
            const frozen = frozenOf(taskSlotKey(task.taskId));
            return { taskId: task.taskId, agent: frozen.selection, agentProvenance: frozen.provenance, configHash: frozen.configHash,
              timeoutMs: frozen.timeoutMs, killGraceMs: frozen.killGraceMs, agentCapabilities: intersectCapabilities(workerDeclared, frozen.capabilities) };
          });
          const reconcileSlot = frozenOf(RECONCILE_SLOT_KEY);
          const tasks = plan.plan.tasks.map(task => {
            const work = proposal.allocations.find(a => a.ownerId === task.taskId && a.bucket === "work")!.amount;
            const handoff = proposal.allocations.find(a => a.ownerId === task.taskId && a.bucket === "handoff")!.amount;
            if (selected.handoff.snapshot.profile.capabilities.handoffExecution === "model-assisted-v1" && dimensions.some(d => handoff[d] < 1)) throw new ControlError("handoff-grant-insufficient");
            return { ...task, work, handoff };
          });
          const built = prepareExecutionSnapshot({ store: this.store, groupId: id, planHash: plan.planHash, graphVersion: plan.graphVersion, proposalVersion: proposal.proposalVersion,
            proposalIdentity: { groupId: id, planHash: plan.planHash, proposalVersion: proposal.proposalVersion }, groupLimit: proposal.groupLimit, budgetMode: payload.budgetMode, contextPolicy: payload.contextPolicy, profiles,
            allocations: [...proposal.allocations.map(({ state: _state, ...a }) => a), ...estimateCommitments(this.store, id)], tasks, agents: { tasks: agentTasks, reconcile: reconcileSlot } });
          for (const derived of built.derivedContracts) {
            writeCanonicalRecord(this.store, id, derived.derivedContractHash, derived.canonicalJson);
            const workRow = this.store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id=?").get(id, derived.taskId);
            if (!workRow) throw new ControlError("recovery-blocked");
            const work = JSON.parse(String(workRow.body));
            const { taskId: _taskId, ...frozen } = agentTasks.find(entry => entry.taskId === derived.taskId)!;
            Object.assign(work, frozen);
            work.derivedContractHash = derived.derivedContractHash; work.status = "ready"; work.claimOrdinal = 0; work.currentRunId = null; work.pendingRunId = null; work.lineageRunIds = [];
            this.store.db.prepare("UPDATE work_items SET body=? WHERE group_id=? AND id=?").run(JSON.stringify(work), id, derived.taskId);
          }
          writeCanonicalRecord(this.store, id, built.snapshotHash, built.canonicalJson);
          (group as Record<string, unknown>).reconcileSlot = reconcileSlot;
          proposal.state = "confirmed"; proposal.budgetMode = payload.budgetMode; proposal.contextPolicy = payload.contextPolicy; proposal.profiles = profiles; proposal.executionSnapshotHash = built.snapshotHash;
          proposal.allocations.forEach(a => { a.state = "confirmed"; }); group.status = "ready"; group.budgetMode = payload.budgetMode;
          saveWebAuthority(this.store, group, proposal);
          this.deps.beforeCommit?.();
          return success(context, { kind: "confirmed", executionSnapshotHash: built.snapshotHash });
        },
      }).body;
    } finally { release?.(); }
  }
```
（与原 confirm 相比只多了：事务外 `resolveGroupSelections`；三行拒绝／复核；`agentTasks`／`reconcileSlot`；work item 的 `Object.assign(work, frozen)`；组的 `reconcileSlot`；快照的 `agents`。其余逐字保留，原先的检查顺序不变——选择的拒绝排在所有既有检查之后，既有判据断言的错误码优先级不受影响。）

- [ ] **Step 11.10：派活闸门与 run 行（`src/control/webDispatch.ts`）**

import 加：
```ts
import { frozenWorkAgent } from "./agentFreeze.js";
import type { AgentSelection } from "./agentSelection.js";
```
在 `resolveBindings`（`:62-64`）之后加：
```ts
/**
 * Agent selection spec §6.4 last paragraph (W5-M12): the gate probes each distinct selection the group's tasks were
 * frozen with -- never the operator's current default. Any degraded one blocks the group, as a degraded profile did.
 */
function frozenTaskSelections(store: ControlStore, groupId: string): AgentSelection[] {
  const seen = new Map<string, AgentSelection>();
  for (const row of store.db.prepare("SELECT body FROM work_items WHERE group_id=? ORDER BY id").all(groupId)) {
    const work = JSON.parse(String(row.body)) as { kind: string };
    if (work.kind !== "task") continue;
    const { agent } = frozenWorkAgent(work);
    seen.set(canonicalBytes(agent).toString("utf8"), agent);
  }
  return [...seen.values()];
}

function probeFrozen(router: ExecutionProfileRouter, bindings: { worker: FrozenProfile; handoff: FrozenProfile }, selections: AgentSelection[]): Promise<ObservedProfile[]> {
  return Promise.all(selections.flatMap((selection) => [router.probe(bindings.worker, selection), router.probe(bindings.handoff, selection)]));
}
```
`scheduleStart` `:85` —— before：
```ts
      const observations = await Promise.all([profileRouter.probe(bindings.worker), profileRouter.probe(bindings.handoff)]);
```
after：
```ts
      const observations = await probeFrozen(profileRouter, bindings, frozenTaskSelections(store, groupTarget(command)));
```
`deliverScheduledStart` `:165` —— before：
```ts
      const observations = await Promise.all([profileRouter.probe(bindings.worker), profileRouter.probe(bindings.handoff)]);
```
after：
```ts
      const observations = await probeFrozen(profileRouter, bindings, frozenTaskSelections(store, groupId));
```
`createStartingRun`：`:260` `const work = readWork(…);` 之后加 `const frozen = frozenWorkAgent(work);`；`:283` —— before：
```ts
    configHash: work.configHash, grant, ownerToken, executionId: null, state: "starting", checkpointId: null, recoverable: false,
```
after：
```ts
    // Spec §6.4 / §3 I1: a run (and a continuation of it) carries the work item's frozen selection unchanged.
    configHash: frozen.configHash, agent: frozen.agent, agentProvenance: frozen.agentProvenance, timeoutMs: frozen.timeoutMs,
    killGraceMs: frozen.killGraceMs, agentCapabilities: frozen.agentCapabilities,
    grant, ownerToken, executionId: null, state: "starting", checkpointId: null, recoverable: false,
```

- [ ] **Step 11.11：其余闸门调用点**

`src/control/dispatch.ts` —— `:52` before：
```ts
 assertCapabilities(group.budgetMode??"strict",await port.capabilities());
```
after：
```ts
 // Agent selection spec §6.4 last paragraph: the run's frozen selection, carried on the claim (envelope v2).
 assertCapabilities(group.budgetMode??"strict",(await port.resolveAgent(input.claim.agent)).capabilities);
```
`:77` before：
```ts
   assertCapabilities(group.budgetMode??"strict",await port.capabilities());
```
after：
```ts
   assertCapabilities(group.budgetMode??"strict",(await port.resolveAgent(input.claim.agent)).capabilities);
```

`src/control/service.ts`（W5-M11：`work.agent`／`run.agent` 由 T7 加）：import 加 `import type { AgentSelection, PartialSelection } from "./agentSelection.js";`、`import { canonicalBytes } from "./canonicalJson.js";`、`import { agentSelectionSchema, type CapabilityViewV1 } from "./webProtocol.js";`（与现有 `WebWorkKindV1` 类型导入合并）。
- `run()`（`:42`）`await this.legacyCapabilities(groupId);` → `for (const agent of this.groupAgents(groupId)) await this.legacyCapabilities(groupId, agent);`
- `:76-81`（`legacyCapabilities` 与 `capabilities`）整段替换为：
```ts
  /** Agent selection spec §6.4 last paragraph: a legacy gate checks the selection the work was frozen with. */
  async legacyCapabilities(groupId: string, selection: PartialSelection):Promise<CapabilityViewV1> {
    const caps = (await this.legacyExecutionPort().resolveAgent(selection)).capabilities;
    assertCapabilities(readGroup(this.store,groupId).budgetMode ?? "strict",caps);
    return caps;
  }
  capabilities(groupId:string,selection:PartialSelection):Promise<CapabilityViewV1> { return this.legacyCapabilities(groupId,selection); }
  /** One work item's frozen selection. */
  workAgent(groupId:string,workItemId:string):AgentSelection {
    const agent=agentSelectionSchema.safeParse((readWork(this.store,groupId,workItemId) as {agent?:unknown}).agent);
    if(!agent.success)throw new ControlError("recovery-blocked","work-agent-missing");
    return agent.data;
  }
  /** The distinct frozen selections of a group's task work, for gates that run before a task is chosen. */
  groupAgents(groupId:string):AgentSelection[] {
    const seen=new Map<string,AgentSelection>();
    for(const work of allWork(this.store,groupId)) if(work.kind==="task"){const agent=this.workAgent(groupId,work.workItemId);seen.set(canonicalBytes(agent).toString("utf8"),agent);}
    return [...seen.values()];
  }
  /** A task's frozen selection, for the reconcile work item it spawns on the legacy path. */
  taskAgent(groupId:string,taskId:string):AgentSelection {
    const parent=allWork(this.store,groupId).find(item=>item.taskId===taskId&&item.kind==="task");
    if(!parent)throw new ControlError("work-not-found");
    return this.workAgent(groupId,parent.workItemId);
  }
```
- `profiledCapabilities`（`:82-91`）整段替换为：
```ts
  async profiledCapabilities(groupId:string,selection:ExecutionProfileSelection,agent:PartialSelection):Promise<{profile:FrozenProfile;capabilities:CapabilityViewV1}> {
    const profile=this.executionProfile(selection),observation=await this.options.profileRouter!.probe(profile,agent);
    const observed=observation.observed,mode=readGroup(this.store,groupId).budgetMode??"strict";
    // Ruling R5: the router turns every probe throw into a failure code, which is right for a
    // genuine probe failure and wrong for "there is no port at all" -- those need different fixes,
    // so the named one is re-raised rather than folded into the capability answer.
    if(observation.probeFailureCode==="control-port-unconfigured")throw new ControlError("control-port-unconfigured");
    if(observation.probeFailureCode!==null||observation.resolution===null||observed.usageObservation==="unavailable"||observed.budgetEnforcement==="unavailable"||observed.handoffControl!=="durable"||observed.handoffExecution===null||(mode==="strict"&&(observed.budgetEnforcement!=="bounded"||observed.requestBoundProof===null||!observed.requestBoundProof.workDimensions.includes("tokens"))))throw new ControlError("control-capability-unsupported");
    const capabilities=observation.resolution.capabilities;assertCapabilities(mode,capabilities);return {profile,capabilities};
  }
```
- `claimWithCapabilities` 的第三参类型 `Capabilities` → `CapabilityViewV1`（`reconcileWithCapabilities` 同）。
- `:104` `claimLegacy` → `async claimLegacy(groupId:string,workItemId:string):Promise<Claim>{return this.claimWithCapabilities(groupId,workItemId,await this.legacyCapabilities(groupId,this.workAgent(groupId,workItemId)));}`
- `:106-110` `claimProfiled` 的 `Promise.all([...])` → `const agent=this.workAgent(groupId,workItemId);const [{capabilities}]=await Promise.all([this.profiledCapabilities(groupId,selection,agent),this.profiledCapabilities(groupId,handoffSelection,agent)]);`
- `:127` `reconcileBudgetLegacy` → `…this.reconcileWithCapabilities(groupId,taskId,await this.legacyCapabilities(groupId,this.taskAgent(groupId,taskId)));`
- `:129-133` `reconcileBudgetProfiled` 的 `Promise.all` → `const agent=this.taskAgent(groupId,taskId);const [{capabilities}]=await Promise.all([this.profiledCapabilities(groupId,selection,agent),this.profiledCapabilities(groupId,handoffSelection,agent)]);`
- `:134` `startProfiled` 里 `await this.profiledCapabilities(input.claim.groupId,selection)` → `await this.profiledCapabilities(input.claim.groupId,selection,input.claim.agent)`
- `:136-141` `reconcileStartForRun` 里 `await this.profiledCapabilities(run.groupId,run.executionProfile)` → `await this.profiledCapabilities(run.groupId,run.executionProfile,run.agent)`
- `:148` `requestHandoff` 里 `const selected=binding ? await this.profiledCapabilities(groupId,binding) : {profile:undefined,capabilities:await this.legacyCapabilities(groupId)};` → `const selected=binding ? await this.profiledCapabilities(groupId,binding,run.agent) : {profile:undefined,capabilities:await this.legacyCapabilities(groupId,run.agent)};`
- `:165-169` `continueTask`：`this.profiledCapabilities(groupId,binding)` → `this.profiledCapabilities(groupId,binding,predecessor.agent)`；`this.legacyCapabilities(groupId)` → `this.legacyCapabilities(groupId,predecessor.agent)`；`await this.profiledCapabilities(groupId,handoffBinding);` → `await this.profiledCapabilities(groupId,handoffBinding,predecessor.agent);`

`src/control/schedulerBridge.ts:125-127` —— before：
```ts
   const port=selection?(await service.profiledCapabilities(groupId,selection)).profile.port:service.legacyExecutionPort();
   if(handoffSelection)await service.profiledCapabilities(groupId,handoffSelection);
   if(!selection)await service.legacyCapabilities(groupId);
```
after：
```ts
   // Agent selection spec §6.4 last paragraph: every frozen selection of the group, before any task is chosen.
   const agents=service.groupAgents(groupId);
   if(agents.length===0)throw new ControlError("group-graph-conflict");
   const port=selection?(await service.profiledCapabilities(groupId,selection,agents[0]!)).profile.port:service.legacyExecutionPort();
   for(const agent of agents){
    if(selection)await service.profiledCapabilities(groupId,selection,agent);
    if(handoffSelection)await service.profiledCapabilities(groupId,handoffSelection,agent);
    if(!selection)await service.legacyCapabilities(groupId,agent);
   }
```

`src/control/stopIntent.ts`：`RunBody`（`:97` 起）加字段 `agent?: AgentSelection;`（import `type AgentSelection` from `./agentSelection.js`）；`:562` —— before：
```ts
      const observed = await profileRouter.probe(profile);
```
after（spec §6.4 末段：handoff 无槽位，探测被 handoff 的那个 run 的选择；缺选择的旧行按 `{}` 探测、被端口拒 ⇒ `capability-unavailable`）：
```ts
      const observed = await profileRouter.probe(profile, run.agent ?? {});
```

`src/panel/controlConfig.ts`：`:48` `readView(): Promise<ControlConfigV1>;` → `readView(selection: PartialSelection): Promise<ControlConfigV1>;`；`:205-206` —— before：
```ts
    async readView(): Promise<ControlConfigV1> {
      const observations = await Promise.all(profiles.map((profile) => router.probe(profile)));
```
after（spec §6.4 末段：只有面板的 profile 展示用操作者默认，W5-M14）：
```ts
    async readView(selection: PartialSelection): Promise<ControlConfigV1> {
      const observations = await Promise.all(profiles.map((profile) => router.probe(profile, selection)));
```
（import `type PartialSelection`。）

`src/panel/controlApi.ts`：import 加
```ts
import { readAgentPreferences } from "../control/agentPreferences.js";
import { resolveSelection, slotLayers, type PartialSelection } from "../control/agentSelection.js";
```
在 `registerControlReadRoutes` 之前加：
```ts
/** W5-M14: the panel's profile display probes the panel operator's default worker selection (no group or task layer). */
function operatorDefaultSelection(store: ControlStore): PartialSelection {
  const row = store.db.prepare("SELECT value FROM meta WHERE key='panelOperatorId'").get();
  if (!row) return {};
  const prefs = readAgentPreferences(store, String(row.value)).preferences;
  try { return resolveSelection(slotLayers("worker", prefs, {}), prefs.perAgent).partial; }
  catch (error) {
    if (error instanceof ControlError && error.code === "agent-unselected") return {};
    throw error;
  }
}
```
`:77` `const base = await deps.config.readView();` → `const base = await deps.config.readView(operatorDefaultSelection(deps.store));`
`:243` `case "confirm": service.confirm(command); break;` → `case "confirm": await service.confirm(command); break;`

- [ ] **Step 11.12：`handoffGraceMsOf` 读冻结值**

`src/control/driverHandoff.ts`：`:30` `HANDOFF_EXTRA_GRACE_MS` 之后加：
```ts
/**
 * Handoff delivery spec §3 + agent selection spec §6.6 (§12 I5): a delivered request that yields nothing turns
 * outcome-unknown only past its deadline plus the run's frozen killGraceMs (ccloop's capabilities-v3 answer)
 * plus the fixed extra. Orca never reads the installation table; an unusable value counts 0.
 */
export function handoffGraceMsOf(run: { killGraceMs?: unknown }): number {
  const value = run.killGraceMs;
  const killGraceMs = typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
  return killGraceMs + HANDOFF_EXTRA_GRACE_MS;
}
```
`:182` `(deps.handoffGraceMs ?? HANDOFF_EXTRA_GRACE_MS)` → `(deps.handoffGraceMs ?? handoffGraceMsOf(run))`。
`src/control/executionDriver.ts:66` 注释改为 `/** Test seam only: overrides handoffGraceMsOf(run) (agent selection spec §6.6: the run's frozen killGraceMs + 60 s). */`。
`src/panel/controlAssembly.ts`：删 `:11` 的 `HANDOFF_EXTRA_GRACE_MS` import、删 `:111-124` 整个 `handoffGraceMsOf` 函数及其注释、删 `:257` `handoffGraceMs: handoffGraceMsOf(env.ORCA_CCLOOP_ADAPTER_CONFIG!),` 一行；`:211-229` `new WebControlService({` 的对象里 `store,` 之后加 `port,`（W6-19；`port` 是 `:164` 的 `const port = choosePort(control, env);`）。

- [ ] **Step 11.13：面板读模型（`src/panel/controlViews.ts`）**

import 加 `import { frozenWorkAgent } from "../control/agentFreeze.js";`。
`workBodySchema`（`:56-71`）`configHash: hashSchema,` → `configHash: hashSchema.nullable(),`。
`persistedRunSchema`：T10 加的五个 `.optional()` 去掉 `.optional()`（Web 的每个 run 自 T11 起都带冻结选择）。
`validateExecutionSnapshot`（`:303-311` 的大条件之后、`// Limits and residual reserve…` 之前）加：
```ts
  // Spec §6.4 step 4: the group's reconcile slot is the snapshot's.
  const storedReconcile = (groupBody(store, groupId) as { reconcileSlot?: unknown }).reconcileSlot ?? null;
  if (canonicalBytes(storedReconcile).compare(canonicalBytes(parsed.data.agents.reconcile)) !== 0) return blocked("execution-snapshot-agents");
```
`workViews`（`:393-398`）—— before：
```ts
    if (body.workItemId !== task.taskId || body.taskId !== task.taskId
      || body.configHash !== task.configHash || body.targetVersion !== task.targetVersion
```
after：
```ts
    // Spec §6.4 step 4 (§12 I3): a draft has no configHash; a confirmed work item carries exactly the snapshot's selection.
    const frozenEntry = snapshot?.agents.tasks.find(entry => entry.taskId === task.taskId) ?? null;
    if (snapshot === null ? body.configHash !== null : frozenEntry === null || !sameFrozen(body, frozenEntry)) return blocked(`work-item-agent:${task.taskId}`);
    if (body.workItemId !== task.taskId || body.taskId !== task.taskId
      || body.targetVersion !== task.targetVersion
```
返回对象（`:418-423`）—— before：
```ts
      configHash: task.configHash, originalContractHash: task.originalContractHash,
```
after：
```ts
      configHash: body.configHash, agent: frozenEntry?.agent ?? null, agentProvenance: frozenEntry?.agentProvenance ?? null,
      originalContractHash: task.originalContractHash,
```
在 `workViews` 之前加：
```ts
function sameFrozen(record: unknown, entry: { taskId: string } & Record<string, unknown>): boolean {
  const { taskId: _taskId, ...expected } = entry;
  try { return canonicalBytes(frozenWorkAgent(record)).equals(canonicalBytes(expected)); }
  catch { return false; }
}
```
`runViews` 任务 run 核对（`:529-534`）：`|| !sameBinding(run.handoffProfile, proposal.profiles.handoff, "handoff")) return blocked(`run-work-identity:${runId}`);` 之前加一项 `|| !sameFrozen(run, { taskId: run.taskId, ...frozenWorkAgent(work) })`（run 与它的 work item 冻结字段逐字节相同）。

- [ ] **Step 11.14：web 镜像与确认按钮**

`web/src/controlTypes.ts`：
- `WorkItemViewV1`（`:74-86`）`configHash: string;` → 
```ts
  configHash: string | null;
  // Agent selection (W6-9): optional on the Web side only, like `blockedReason`, so literal fixtures need no edit;
  // webParity.test.ts normalises an absent value to null in the web-to-server direction.
  agent?: { agent: string; model: string; contextWindow: "agent-default" | number } | null;
  agentProvenance?: { agent: string; model: string; contextWindow: string } | null;
```
⚠️ `agentProvenance` 的服务端类型是 9 值枚举；web 侧写成 `string` 会让 server→web 可赋值、web→server 不可赋值——所以 web→server 的归一化函数里要 `as` 回服务端类型（见下）。更稳：web 侧照抄 9 值联合：`type ProvenanceSourceV1 = "operator" | "operator-estimator" | "operator-reconcile" | "group" | "group-estimator" | "group-reconcile" | "task" | "operator-agent" | "descriptor";`，`agentProvenance?: { agent: ProvenanceSourceV1; model: ProvenanceSourceV1; contextWindow: ProvenanceSourceV1 } | null;` —— **按这个写**。
- `ConfirmPayloadV1`（`:201-208`）在 `contextPolicy` 之后加 `selectionsHash: string;`。

`tests/panel/webParity.test.ts` 的 `controlGroupWebToServer`（`:119-121`）—— before：
```ts
function controlGroupWebToServer(x: WebGroupViewV1): ServerGroupViewV1 {
  return { ...x, runs: x.runs.map((run) => ({ ...run, blockedReason: run.blockedReason ?? null, continuable: run.continuable ?? false })) };
}
```
after：
```ts
// Agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"; W6-9): a work item's `agent` and
// `agentProvenance` are optional on the Web side for the same reason, and an absent value reads as null.
function controlGroupWebToServer(x: WebGroupViewV1): ServerGroupViewV1 {
  return { ...x,
    runs: x.runs.map((run) => ({ ...run, blockedReason: run.blockedReason ?? null, continuable: run.continuable ?? false })),
    workItems: x.workItems.map((item) => ({ ...item, agent: item.agent ?? null, agentProvenance: item.agentProvenance ?? null })) };
}
```
（这是编译期函数，不是 `it`；它守的「双向可赋值」不放宽：服务端新字段在 web 侧有同型镜像。）

`web/src/BudgetEditor.tsx`：`BudgetEditorProps`（`:85-91`）加
```ts
  /** Agent selection spec §6.4 step 3: the hash of the selections the operator sees; confirming needs it (W5-M9). */
  selectionsHash?: string | null;
```
`:106` —— before：
```ts
  const confirmBlocked = defaults === null && (view.proposal.profiles === null || view.proposal.budgetMode === null);
```
after：
```ts
  // W5-M9: without a previewed selectionsHash (T15 wires the preview) confirming is refused here, never sent unbound.
  const confirmBlocked = (defaults === null && (view.proposal.profiles === null || view.proposal.budgetMode === null)) || !props.selectionsHash;
```
payload（`:144` `contextPolicy: …,` 之后）加 `selectionsHash: props.selectionsHash!,`。（若 `props` 在函数体里已解构，按解构名取；`:93` 是 `BudgetEditor(props: BudgetEditorProps)`。）

- [ ] **Step 11.15：夹具与脚本**

`tests/control/fixtures/web.ts`（在 T10 版本上）：
1. `profileSnapshot` 改为 v2：
```ts
export const profileSnapshot = (): ExecutionProfileSnapshotV1 => ({
  schema: "orca-execution-profile-snapshot-v2",
  profile: { profileId: "all", allowedWorkKinds: ["budget-estimate", "goal-review", "handoff", "task"], contextTokenizer: null, workMaxOutputTokens: 1000,
    capabilities: { usageObservation: "realtime", budgetEnforcement: "bounded", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: 1_000_000,
      requestBoundProof: { scheme: "adapter-request-bound-v1", version: "1", workDimensions: ["tokens"], handoffDimensions: [], evidenceKind: "proof" } },
    estimatorPreflight: { instructionVersion: "1", schemaVersion: "budget-estimate-v1", maxOutputTokens: 64_000, framingTokenOverhead: 17, tokenizer: { kind: "utf8-upper-bound", numerator: 2, denominator: 3, proofRef: "proof" } } },
  resolved: { proofDocumentContentHashes: ["c".repeat(64)], tokenizerArtifactHashes: [], secretValueHashes: [] },
});
```
2. 删端口里 T10 的临时两行（`probeProfileCapabilities`、`capabilities` 及其注释）。
3. `WebFixtureTask` 删 `configHash?: string;`；`planTasks.push` 删 `configHash: task.configHash ?? sha256Canonical({}),`（`sha256Canonical` import 若不再使用则删）。
4. `deps` 加 `port,`。
5. `confirmPayload` 改为异步、带 `selectionsHash`：
```ts
  // Agent selection spec §6.4 step 3: the payload carries the hash of what the operator would see now.
  const confirmPayload = async (): Promise<ConfirmPayload> => ({ planHash: readArchivedPlan(h.store, "g").planHash, proposalVersion: readBudgetProposal(h.store, "g").proposalVersion, budgetMode: "strict",
    profileIds: { estimator: "all", worker: "all", handoff: "all", goalReview: "all" }, profileHashes: { estimator: frozen.profileHash, worker: frozen.profileHash, handoff: frozen.profileHash, goalReview: frozen.profileHash }, contextPolicy: { handoffAtContextTokens: 800_000 },
    selectionsHash: (await resolveGroupSelections({ store: h.store, port }, "g", "human")).selectionsHash ?? "0".repeat(64) });
```
（`?? "0".repeat(64)`：有被拒的槽时哈希为 null，confirm 会以 `agent-selection-rejected` 拒——判据看的是拒绝码，不是哈希。import `resolveGroupSelections`。）

`tests/panel/fixtures/controlPanel.ts`：删端口里 T10 保留的 `probeProfileCapabilities`／`capabilities` 两行；`deps`（`:131-138`）加 `port,`；plan 的任务（`:98`）删 `configHash: "c".repeat(64)`。

`tests/control/fixtures/driverHarness.ts:40` —— before：
```ts
  const confirmed = service.confirm(h.command("confirm", { ...h.confirmPayload(), budgetMode: options.budgetMode ?? "soft" }));
```
after：
```ts
  const confirmed = await service.confirm(h.command("confirm", { ...(await h.confirmPayload()), budgetMode: options.budgetMode ?? "soft" }));
```

`tests/control/fixtures/ccloopWorld.ts`（T7 也改这个文件：表＋CLI 层 fake；本 Task 只动下面三处；`WORLD_AGENT` 是 T7 的世界表里 fake codex 那条安装记录的 id——T7 若叫别的名字，用 T7 的）：
- plan 写入处删任务的 `configHash`（与 spec §12 C2「`ccloopWorld` 不再自己重算 `configHash`」同一处）。
- `raw`：`expectedRevision: verb === "import-plan" || verb === "set-workspace-mode" ? 0 : …` → `expectedRevision: verb === "import-plan" || verb === "set-workspace-mode" || verb === "set-agent-preferences" ? 0 : …`
- `startGroup`：`expect(imported)…` 之后插入（偏好放在导入**之后**：导入时 estimator 仍按原样降级为 `blocked-capability`，`startGroup` 断言它）：
```ts
  // Agent selection spec §6.2 layer 1: the operator's default worker is the world's installation.
  const preferences = await runtime.service.setAgentPreferences(raw(runtime, "preferences", "set-agent-preferences", { preferences: { defaultAgent: WORLD_AGENT, perAgent: {} } }, { kind: "operator", operatorId: "human" }));
  expect("error" in preferences ? preferences.error : "set").toBe("set");
  const selections = await resolveGroupSelections({ store: runtime.store, port: runtime.port }, "g", "human");
```
  confirm 那一段 —— before：
```ts
  const confirmed = runtime.service.confirm(raw(runtime, "confirm", "confirm", {
```
  after：
```ts
  const confirmed = await runtime.service.confirm(raw(runtime, "confirm", "confirm", {
```
  其 payload 的 `contextPolicy: { handoffAtContextTokens: null },` 之后加 `selectionsHash: selections.selectionsHash,`。

`scripts/live-driver-acceptance.ts`：`:118` plan 任务删 `configHash: ccloopHash(adapter)`（`ccloopHash` 若不再使用则删其定义与 import）；`:123-127` profile 字面量按 v2 删 `adapter`／`adapterConfigRef`／`modelPolicyRef`／`adapterConfigContentHash`／`modelPolicyContentHash`／`adapterImplementationHash`／`adapterProtocolVersion`、`schema` 改 `orca-execution-profile-snapshot-v2`。（该脚本的其余迁移——`ORCA_AGENTS_TABLE`、确认带 `selectionsHash`——归 T7／T16；本 Task 只保证它过 `tsc`。）

- [ ] **Step 11.16：改写既有判据**（每处旁加 `// Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): <它现在编码什么>`；**全部在判据本体里改，不改被测代码去迁就**）

**(A) 确认变异步＋带 `selectionsHash`（机械规则，逐行套用；行号为 HEAD `545f452` 现测，清单 `scratchpad/W5/confirm-calls.txt`）：**
规则：`service.confirm(X)` → `await service.confirm(X)`；`h.confirmPayload()`／`f.confirmPayload()` → `(await h.confirmPayload())`（在展开里写 `{ ...(await h.confirmPayload()), … }`）；`expect(service.confirm(X))` → `expect(await service.confirm(X))`；`expect(() => s.confirm(X)).toThrow(m)` → `await expect(s.confirm(X)).rejects.toThrow(m)`；所在函数若非 `async` 改为 `async`（以下各处现测均已是 `async`）。注释统一写 `…: confirmation resolves agent selections through ccloop first, so it is awaited and carries the previewed selectionsHash.`
逐行：`tests/panel/runContinuable.test.ts:28`；`tests/panel/shutdownDriverGroup.test.ts:30`；`tests/panel/controlLifecycle.test.ts:51,52`（`:52` 另一组 `h` 的 payload 来自同一 `h.confirmPayload()`：两组偏好相同、计划相同 ⇒ 哈希相同，照规则改即可）；`tests/control/webDispatch.test.ts:20`；`tests/control/contextControl.test.ts:21`；`tests/control/driveRecord.test.ts:22`；`tests/control/targetVersion.test.ts:42`；`tests/control/webContinuationAccounting.test.ts:98`；`tests/control/webCcloopSmoke.test.ts:54,114`（已有 `await`，只改 payload）；`tests/control/webMutations.test.ts:36`；`tests/control/estimator.test.ts:202,204`；`tests/control/confirmation.test.ts:19-20,29,39,53,65,81,88,101,104,108`（`:108` 用 `rejects.toThrow("interrupted")`）；`tests/control/driverRecovery.test.ts:16`；`tests/control/webContinuation.test.ts:130`；`tests/control/proposal.test.ts:38,53,75`；`tests/control/stopIntent.test.ts:37,735`；`tests/control/webFaults.test.ts:65,142-151`（`:144` 用 `rejects.toThrow("fault-before-commit")`）。
另：`tests/control/proposal.test.ts > proposal commands > serves closed mutation envelopes with exact durable statuses and replay lookup` 经 HTTP 以面板操作者（`operator-<uuid>`）确认：`registerControlReadRoutes(...)` 之后加
```ts
      // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the panel operator
      // has the same preferences as the fixture's operator, so the previewed selectionsHash is the same.
      seedPreferences(h.store, String(h.store.db.prepare("SELECT value FROM meta WHERE key='panelOperatorId'").get()!.value), { defaultAgent: FIXTURE_AGENT, perAgent: {} });
```
并把 `:75` 的 `payload: h.confirmPayload()` 改为 `payload: await h.confirmPayload()`。

**(B) profile v2（机械规则）：** 每个 profile 快照字面量删 `adapter`、`adapterConfigRef`、`modelPolicyRef`（profile 内）与 `adapterConfigContentHash`、`modelPolicyContentHash`、`adapterImplementationHash`、`adapterProtocolVersion`（resolved 内），`schema` 改 `"orca-execution-profile-snapshot-v2"`。凡为了得到**不同 profileHash**而改 `resolved.adapterImplementationHash = X` 的，改为 `resolved.proofDocumentContentHashes = [X]`（`profiles.test.ts:86,87,106,174` 的 `snapshot({ adapterImplementationHash: … })` → `snapshot({ proofDocumentContentHashes: [ … ] })`；`profiledService.test.ts:45`；`stopIntent.test.ts:592`）。涉及文件与行：`tests/control/profiles.test.ts:13-55`；`tests/control/profiledService.test.ts:16-45`；`tests/control/planImport.test.ts:28-43`；`tests/panel/controlReadApi.test.ts:42-56`；`tests/panel/controlConfig.test.ts:28-46`；`tests/panel/controlConfigPort.test.ts:22-36`；`tests/control/unconfiguredPort.test.ts:17-36`；`tests/control/ccloopPort.test.ts:24-33`；`tests/control/stopIntent.test.ts:592`。
- `tests/control/webProtocol.test.ts > Web control protocol > accepts an explicit Codex phase-end plus soft profile snapshot` 整条替换为（编码：v2 不再有 codex 专属约束，形状约束仍在）：
```ts
  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): profile v2 carries no adapter
  // identity, so the codex-only phase-end/soft rule is gone (capabilities come from the selection); the shape rules stay.
  it("accepts an explicit Codex phase-end plus soft profile snapshot", () => {
    const snapshot = {
      schema: "orca-execution-profile-snapshot-v2",
      profile: {
        profileId: "codex-worker", allowedWorkKinds: ["task"],
        contextTokenizer: { tokenizerId: "tok", tokenizerVersion: "1" }, workMaxOutputTokens: 4096,
        capabilities: { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "phase-end", handoffControl: "durable",
          handoffExecution: "mechanical-in-run-v1", contextWindowTokens: 200_000, requestBoundProof: null },
        estimatorPreflight: null,
      },
      resolved: { proofDocumentContentHashes: [], tokenizerArtifactHashes: [{ purpose: "context", contentHash: hash }], secretValueHashes: [] },
    };
    expect(executionProfileSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(executionProfileSnapshotSchema.safeParse({ ...snapshot, profile: { ...snapshot.profile, estimatorPreflight: undefined } }).success).toBe(false);
    expect(executionProfileSnapshotSchema.safeParse({ ...snapshot, profile: { ...snapshot.profile, allowedWorkKinds: ["task", "task"] } }).success).toBe(false);
    expect(executionProfileSnapshotSchema.safeParse({ ...snapshot, schema: "orca-execution-profile-snapshot-v1" }).success).toBe(false);
    expect(executionProfileSnapshotSchema.safeParse({ ...snapshot, profile: { ...snapshot.profile, adapter: "codex" } }).success).toBe(false);
    expect(executionProfileSnapshotSchema.safeParse({ ...snapshot, profile: { ...snapshot.profile, contextTokenizer: null } }).success).toBe(false);
  });
```
- `router.probe(profile)` → `router.probe(profile, <选择>)`：`tests/control/profiles.test.ts:108,120,180,184`、`tests/control/estimator.test.ts:27`、`tests/control/planImport.test.ts:239`、`tests/control/ccloopPort.test.ts:42`、`tests/control/unconfiguredPort.test.ts:75` 一律传 `{ agent: FIXTURE_AGENT }`；这些测试里的端口 mock 的 `probeProfileCapabilities: X` 改为 `resolveAgent: fixtureResolveAgent(<返回 X 的函数>)`（`profiles.test.ts:57-80` 的 `port(probe)` helper：`resolveAgent: async (partial) => ({ …(await fixtureResolveAgent(() => unavailableCapabilities)(partial)), capabilities: await result() })`）；`unconfiguredPort.test.ts:46,57,73` 列举的方法名清单把 `probeProfileCapabilities`／`capabilities` 换成 `listAgents`／`resolveAgent`（若 T7 已换，跳过）。
- `readView()` → `readView({ agent: FIXTURE_AGENT })`：`tests/panel/controlConfigPort.test.ts:78,84,94,104`、`tests/panel/controlConfig.test.ts:78`。

**(C) 其余：**
- `tests/control/webProtocol.test.ts > Web control protocol > validates normalized plans and rejects unsorted or duplicate sets`：两个任务字面量删 `configHash: hash,`；再加一条断言编码删除：`expect(controlPlanSchema.safeParse({ ...plan, tasks: [{ ...plan.tasks[0], configHash: hash }, plan.tasks[1]] }).success).toBe(false);`。
- `… > validates a complete, canonically ordered execution snapshot`：`schema` 改 `"orca-execution-snapshot-v2"`；加
```ts
      agents: {
        tasks: [{ taskId: "a", agent: { agent: "claude", model: "claude-opus-5-5", contextWindow: "agent-default" },
          agentProvenance: { agent: "operator", model: "descriptor", contextWindow: "descriptor" }, configHash: hash, timeoutMs: 1_800_000, killGraceMs: 5_000,
          agentCapabilities: { usageObservation: "realtime", budgetEnforcement: "bounded", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null } }],
        reconcile: { partial: { agent: "claude" }, provenance: { agent: "operator", model: "descriptor", contextWindow: "descriptor" },
          selection: { agent: "claude", model: "claude-opus-5-5", contextWindow: "agent-default" }, configHash: hash, timeoutMs: 1_800_000, killGraceMs: 5_000,
          capabilities: { usageObservation: "realtime", budgetEnforcement: "bounded", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null } },
      },
```
  并加一条：`expect(executionSnapshotSchema.safeParse({ ...snapshot, agents: { ...snapshot.agents, tasks: [] } }).success).toBe(false);`（任务集与派生合同集不一致被拒）。
- `… > enforces canonical group allocation ownership and command revision nullability`（`:393-405` 的 work item 视图字面量）：加 `agent: null, agentProvenance: null,`（W6-9），`configHash: hash` 保留（可空不等于必空）。
- `tests/control/targetVersion.test.ts`：`:19` `planWith` 删 `, configHash: "a".repeat(64)`（影响 `plan file targetVersion (seam B) > N0…`、`N1…`、三条 `N2…`）；`:149` 任务字面量删 `configHash: "c".repeat(64), `（影响 `wire schemas refuse a string targetVersion (seam B) > N7 ControlPlanV1 takes 3 and refuses "3"`）。
- `tests/control/planImport.test.ts:69-70`、`tests/panel/controlReadApi.test.ts:89-90`：plan 任务删 `configHash: hash(…)`；`tests/control/executionSnapshot.test.ts:28` `authority()` 的任务删 `configHash: hash("f"),`，`input()`（`:81-96`）返回对象加
```ts
    agents: {
      tasks: [{ taskId: "a", agent: { agent: "fixture-agent", model: "m", contextWindow: "agent-default" }, agentProvenance: { agent: "operator", model: "descriptor", contextWindow: "descriptor" },
        configHash: hash("9"), timeoutMs: 1_800_000, killGraceMs: 5_000,
        agentCapabilities: { usageObservation: "realtime", budgetEnforcement: "bounded", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null } }],
      reconcile: { partial: { agent: "fixture-agent" }, provenance: { agent: "operator", model: "descriptor", contextWindow: "descriptor" },
        selection: { agent: "fixture-agent", model: "m", contextWindow: "agent-default" }, configHash: hash("9"), timeoutMs: 1_800_000, killGraceMs: 5_000,
        capabilities: { usageObservation: "realtime", budgetEnforcement: "bounded", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null } },
    },
```
  `it.each([... "extra" ...])("rejects an %s task relative to archived plan authority")` 的 `extra` 分支仍期望 `plan-version-conflict`（任务集先于 agents 集核）——不改。
- `tests/control/driverHandoff.test.ts > nothing arrives (spec §3 grace, §11 I3) > turns the request outcome-unknown past deadline + grace, keeps collecting without killing, and H-settles a late candidate`：grace 现在含 run 冻结的 `killGraceMs`（夹具 5 000）。`:258-262` —— before：
```ts
      now = deadline + HANDOFF_EXTRA_GRACE_MS;
      await driver.round();
      expect(requestState(t, requestId!)).toBe("collecting");
      now = deadline + HANDOFF_EXTRA_GRACE_MS + 1;
```
  after：
```ts
      // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the bound is the run's
      // frozen killGraceMs (ccloop's answer at confirmation) plus the extra minute, not the extra minute alone.
      const killGraceMs = t.body(runId).killGraceMs as number;
      expect(killGraceMs).toBeGreaterThan(0);
      now = deadline + killGraceMs + HANDOFF_EXTRA_GRACE_MS;
      await driver.round();
      expect(requestState(t, requestId!)).toBe("collecting");
      now = deadline + killGraceMs + HANDOFF_EXTRA_GRACE_MS + 1;
```
- `tests/panel/assemblyHandoffGrace.test.ts > the handoff grace the assembly hands the driver (spec §3) > is the adapter's killGraceMs plus the fixed extra, and only the fixed extra when killGraceMs is unusable`：整文件替换为（标题不改；编码：同一条「kill grace＋固定额」规则，来源从 adapter 配置文件变成 run 的冻结值）：
```ts
import { describe, expect, it } from "vitest";
import { HANDOFF_EXTRA_GRACE_MS, handoffGraceMsOf } from "../../src/control/driverHandoff.js";

// Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): spec §6.6 (§12 I5) -- the
// grace is the run's frozen killGraceMs (ccloop's capabilities-v3 answer) plus 60 s; Orca reads no adapter file.
describe("the handoff grace the assembly hands the driver (spec §3)", () => {
  it("is the adapter's killGraceMs plus the fixed extra, and only the fixed extra when killGraceMs is unusable", () => {
    expect(HANDOFF_EXTRA_GRACE_MS).toBe(60_000);
    expect(handoffGraceMsOf({ killGraceMs: 5_000 })).toBe(65_000);
    expect(handoffGraceMsOf({ killGraceMs: 0 })).toBe(60_000);
    for (const killGraceMs of [undefined, -1, 1.5, "5000", null]) expect(handoffGraceMsOf({ killGraceMs })).toBe(60_000);
  });
});
```
- `tests/control/stopIntent.test.ts > model-assisted handoff attempts > settles the request unrecoverably when the frozen handoff profile disappears`：`:592` `foreign.resolved.adapterImplementationHash = "e".repeat(64);` → `foreign.resolved.proofDocumentContentHashes = ["e".repeat(64)];`（仍是「另一个 profileHash」）。
- `tests/control/handoffE2E.test.ts > … > G: …`：**行为不变、只改注释**（`:337` 的 “The grace the assembly read from this world's adapter config (killGraceMs 5 s)” → “The grace is the run's frozen killGraceMs (the world's installation table answers 5 s)”）；不计入变红清单。

- [ ] **Step 11.17：跑，确认绿（逐文件，禁止全量并发）**

```bash
cd $ORCA
./node_modules/.bin/vitest run tests/control/agentFreeze.test.ts > $S/t11-green.log 2>&1; echo rc=$?
for f in $(cat $S/w5-t11-files.txt); do ./node_modules/.bin/vitest run $f > $S/t11-$(basename $f).log 2>&1; echo "$f rc=$?"; done > $S/t11-rewritten.log
./node_modules/.bin/tsc --noEmit -p tsconfig.json > $S/t11-tsc.log 2>&1; echo rc=$?
npm run build --workspace web > $S/t11-web-build.log 2>&1; echo rc=$?
(cd web && ../node_modules/.bin/tsc --noEmit -p tsconfig.json) > $S/t11-web-tsc.log 2>&1; echo rc=$?
```
`w5-t11-files.txt` ＝ 本 Task 末两张清单涉及的**文件**（去重），外加只经夹具的邻居：`tests/control/driverSettle.test.ts tests/control/driverContinuation.test.ts tests/control/driverReconcile.test.ts tests/control/driverReconcileN.test.ts tests/control/driverLanding.test.ts tests/control/executionDriver.test.ts tests/control/handoffStop.test.ts tests/control/handoffGuards.test.ts tests/control/blockedStaysPut.test.ts tests/panel/controlApi.test.ts tests/panel/controlRecoveryApi.test.ts tests/panel/workspaceModeApi.test.ts tests/panel/controlAssemblyDriver.test.ts tests/panel/webParity.test.ts tests/control/agentPlanImport.test.ts tests/control/agentPreferences.test.ts`（实施席先把这份清单写进 `$S/w5-t11-files.txt`，整份读回）。
Expected：全部 `rc=0`；`agentFreeze.test.ts` 14 passed；`t11-rewritten.log` 里每行 `rc=0`。只经夹具的邻居若红，**先查夹具**，不改判据本体。

- [ ] **Step 11.18：提交**

```bash
cd $ORCA && /usr/bin/git add -A src web/src tests scripts/live-driver-acceptance.ts && /usr/bin/git diff --cached --stat > $S/t11-stat.log && /usr/bin/git commit -q -F - <<'EOF'
feat(control): freeze agent selections at an asynchronous confirmation

Spec §6.4: confirm resolves every task's worker slot and the group's
reconcile slot through ccloop outside the transaction, refuses the whole
confirmation on any refusal (agent-selection-rejected:<task>:<code>) or
when the previewed selectionsHash or the layers moved
(agent-selection-changed), and freezes the answers onto work items, runs
and execution snapshot v2. Gates probe the frozen selection, profile v2
drops the adapter identity, plan configHash is gone, and the handoff
grace reads the run's frozen killGraceMs.

Co-Authored-By: <实施席自己的模型> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR
EOF
```

- [ ] **Step 11.19：命名变异（提交之后，副本 `$S/mut-t11`；每条跑 `tests/control/agentFreeze.test.ts`，期望 `rc=1`）**

| 名 | 改动（副本） | 期望红的判据 |
|---|---|---|
| T11-M1 | `confirm` 删 `payload.selectionsHash !== prepared.selectionsHash \|\|` | 「refuses a confirmation whose previewed selectionsHash no longer matches…」 |
| T11-M2 | `confirm` 删 `\|\| !canonicalBytes(answeredPartials(...)).equals(...)` | 「re-checks the layers inside the transaction…」 |
| T11-M3 | `scheduleStart`／`deliverScheduledStart` 的 `frozenTaskSelections(...)` 换成「按操作者当前偏好解析 worker 槽」 | 「probes and claims with the frozen selection even after the operator switches default agent」 |
| T11-M4 | `createStartingRun` 删 `agent: frozen.agent,` | 同上（`run.agent` 缺） |
| T11-M5 | `readConfirmedTaskExecution` 删 `frozenWorkAgent(readWork(...))` 那一行比较 | 「treats the snapshot as authority…」 |
| T11-M6 | `workViews` 删 `work-item-agent` 那一行 | 「treats the snapshot as authority…」（读模型不再拒） |
| T11-M7 | profile schema `z.literal("orca-execution-profile-snapshot-v2")` → `z.enum([...v1, v2])` | 「refuses a v1 snapshot and any adapter identity field」 |
| T11-M8 | `handoffGraceMsOf` 忽略 `run.killGraceMs`（恒 `HANDOFF_EXTRA_GRACE_MS`） | 「judges a handoff's grace by the run's frozen killGraceMs…」，以及改写后的 `driverHandoff.test.ts > nothing arrives …` |
| T11-M9 | `resolveGroupSelections` 去掉 `answers` 去重（每槽一调） | 「resolves every task's worker slot… asking ccloop once per distinct partial」 |
| T11-M10 | `confirm` 删「`rejected` ⇒ `agent-selection-rejected`」那两行 | 「rejects the whole confirmation when any slot fails…」 |
| T11-M11 | `probe` 里把 `resolution.capabilities` 换成声明值（不求交） | 「intersects the declared capabilities with the answer… per selection」 |
| T11-M12 | `planTaskSchema` 恢复 `configHash: …optional()` | 「refuses a plan task that still carries configHash」 |

**既有判据将变红的（静态预测；实施前在副本对 `w5-t11-files.txt` 逐文件跑、确认红在预测处）**

(A) 确认变异步＋`selectionsHash`（143 条；全名清单 ＝ `scratchpad/W5/redsT11-confirm.txt`，原样抄在下面；多数经文件内 helper 变红，改的是 helper 那一行）：

- tests/control/confirmation.test.ts > atomic confirmation > confirms against remaining active estimate commitment after accounted usage
- tests/control/confirmation.test.ts > atomic confirmation > freezes every profile and derived grant and invalidates confirmation on prestart edit
- tests/control/confirmation.test.ts > atomic confirmation > reads only archived derived execution authority after the original source changes
- tests/control/confirmation.test.ts > atomic confirmation > rejects model-assisted handoff without all required grant dimensions
- tests/control/confirmation.test.ts > atomic confirmation > rolls back confirmation for unknown usage, invalid context and publication failure
- tests/control/confirmation.test.ts > atomic confirmation > set-limit changes only live ceiling/reserve and preserves readable frozen authority
- tests/control/confirmation.test.ts > atomic confirmation > updates the reserved goal-review grant and rejects understated live commitments
- tests/control/contextControl.test.ts > context-watermark control > accepts the first realtime observation below threshold without a handoff request
- tests/control/contextControl.test.ts > context-watermark control > creates one context handoff request and suppresses the imminent work attempt on first crossing
- tests/control/contextControl.test.ts > context-watermark control > enforces the hard context fit independent of the threshold
- tests/control/contextControl.test.ts > context-watermark control > joins an already-open handoff request instead of creating a second
- tests/control/contextControl.test.ts > context-watermark control > keeps the crossing latch permanent so a later drop creates no second request
- tests/control/contextControl.test.ts > context-watermark control > latches a gap immediately with reason context-observation-gap
- tests/control/contextControl.test.ts > context-watermark control > records context-observation-invalid on a divergent duplicate
- tests/control/contextControl.test.ts > context-watermark control > records context-observation-invalid on a sequence gap
- tests/control/contextControl.test.ts > context-watermark control > records phase-end crossing as advisory only, accepting exactly one observation
- tests/control/contextControl.test.ts > context-watermark control > refuses to reserve a work attempt once the context crossing is latched
- tests/control/contextControl.test.ts > context-watermark control > rejects a session ordinal other than one
- tests/control/contextControl.test.ts > context-watermark control > rejects an observation from a stale generation without altering current state
- tests/control/contextControl.test.ts > context-watermark control > replays a byte-identical duplicate observation idempotently
- tests/control/contextControl.test.ts > context-watermark control > replays the same request identity for a duplicate crossing observation
- tests/control/driveRecord.test.ts > driver run states in the read model (execution driver §7.4) > refuses a drive record carrying a field the closed schema does not know
- tests/control/driveRecord.test.ts > driver run states in the read model (execution driver §7.4) > shows a blocked driver run under its own state with its reason, and the group still reads
- tests/control/driveRecord.test.ts > recovery-retry on a blocked driver run (execution driver §2.3) > leaves a run that is not blocked exactly as it was
- tests/control/driveRecord.test.ts > recovery-retry on a blocked driver run (execution driver §2.3) > resumes a run blocked at A1 in starting, reason cleared and the unknown count reset
- tests/control/driveRecord.test.ts > recovery-retry on a blocked driver run (execution driver §2.3) > resumes a run blocked at A2 in start-pending, reason cleared and the unknown count reset
- tests/control/driveRecord.test.ts > recovery-retry on a blocked driver run (execution driver §2.3) > resumes a run blocked at B in start-pending, reason cleared and the unknown count reset
- tests/control/driveRecord.test.ts > recovery-retry on a blocked driver run (execution driver §2.3) > resumes a run blocked at B' in unknown, reason cleared and the unknown count reset
- tests/control/driveRecord.test.ts > recovery-retry on a blocked driver run (execution driver §2.3) > resumes a run blocked at C in accepted, reason cleared and the unknown count reset
- tests/control/driveRecord.test.ts > recovery-retry on a blocked driver run (execution driver §2.3) > resumes a run blocked at D in collected, reason cleared and the unknown count reset
- tests/control/driveRecord.test.ts > recovery-retry on a blocked driver run (execution driver §2.3) > resumes a run blocked at E in landed, reason cleared and the unknown count reset
- tests/control/driveRecord.test.ts > recovery-retry on a blocked driver run (execution driver §2.3) > resumes a run blocked at R in reconciling, reason cleared and the unknown count reset
- tests/control/driverRecovery.test.ts > a person's recovery-retry on a blocked driver run (spec §2.3) > reports nothing resolved, and changes nothing, for a run that is not blocked
- tests/control/driverRecovery.test.ts > a person's recovery-retry on a blocked driver run (spec §2.3) > resumes a driver run to its blocked step even when a run-level blocker was already resolved (evaluation order, ruling P1)
- tests/control/driverRecovery.test.ts > a person's recovery-retry on a blocked driver run (spec §2.3) > sends the run back to the step it was blocked at and reports it resolved
- tests/control/driverRecovery.test.ts > panel shutdown and driver-owned runs (spec §4) > freezes it exactly as before when no driver exists
- tests/control/driverRecovery.test.ts > panel shutdown and driver-owned runs (spec §4) > freezes no driver-owned run and writes no handoff request for it when the driver exists
- tests/control/driverRecovery.test.ts > startup recovery and driver-owned runs (spec §4) > blocks it exactly as before when no driver exists
- tests/control/driverRecovery.test.ts > startup recovery and driver-owned runs (spec §4) > leaves a Web work run to the driver when the driver exists: not blocked, no recovery error, dispatch open
- tests/control/estimator.test.ts > frozen estimator > holds gaps/unknown usage and refunds only settled remainder after confirmed usage
- tests/control/proposal.test.ts > proposal commands > checks proposal version before domain state and applies allocation plus limit atomically
- tests/control/proposal.test.ts > proposal commands > serves closed mutation envelopes with exact durable statuses and replay lookup
- tests/control/proposal.test.ts > proposal commands > validates explicit model field provenance again at confirmation
- tests/control/stopIntent.test.ts > frozen-set resolution > always includes a start-unknown estimate so the frozen set cannot be vacuously complete
- tests/control/stopIntent.test.ts > frozen-set resolution > reaches handoff-complete vacuously when the frozen set is empty
- tests/control/stopIntent.test.ts > group stop state derivation > derives handoff-complete only when every frozen run settled recoverably or restartably
- tests/control/stopIntent.test.ts > group stop state derivation > holds the reserve and never renders an unknown stop as a successful handoff
- tests/control/stopIntent.test.ts > handoff stop delivery > leaves an estimator with unknown usage unresolved with its reserve held
- tests/control/stopIntent.test.ts > handoff stop delivery > settles an interrupted estimator as restartable and returns only its known unused commitment
- tests/control/stopIntent.test.ts > model-assisted handoff attempts > charges only the attempt once a prior handoff provider marker exists
- tests/control/stopIntent.test.ts > model-assisted handoff attempts > makes a lost proof acknowledgement outcome-unknown and closed to a further attempt
- tests/control/stopIntent.test.ts > model-assisted handoff attempts > makes a pre-attempt capability failure retryable with no attempt, session, or ordinal change
- tests/control/stopIntent.test.ts > model-assisted handoff attempts > requeues the same deterministic request under run-scoped recovery and increments the next ordinal
- tests/control/stopIntent.test.ts > model-assisted handoff attempts > reserves one attempt plus one handoff session under the request attempt identity
- tests/control/stopIntent.test.ts > model-assisted handoff attempts > settles the request unrecoverably when the frozen handoff profile disappears
- tests/control/stopIntent.test.ts > model-assisted handoff attempts > settles unrecoverable with identity-space-exhausted when the phase ordinal overflows
- tests/control/stopIntent.test.ts > stop command composition > clears only a pause with resume-dispatch and rejects a handoff intent
- tests/control/stopIntent.test.ts > stop command composition > records a typed pause intent that blocks a pending start claim without touching the wake
- tests/control/stopIntent.test.ts > stop command composition > replays an identical pause command from the ledger without a second mutation
- tests/control/stopIntent.test.ts > stop command composition > returns stop-already-active for a new pause command id instead of an implicit no-op
- tests/control/targetVersion.test.ts > imported targetVersion reaches the column, the body and the wire (seam B) > N3 writes the plan's value into the column and the body alike
- tests/control/targetVersion.test.ts > imported targetVersion reaches the column, the body and the wire (seam B) > N4 carries it onto the run row and into the start envelope's claim
- tests/control/targetVersion.test.ts > the panel refuses a targetVersion that is not the plan's integer (seam B) > N0b the unmodified group reads, so N5/N6/N8/N9 are refusals of the edit and not of the fixture
- tests/control/targetVersion.test.ts > the panel refuses a targetVersion that is not the plan's integer (seam B) > N5 refuses a string in the work body as invalid, not as an authority mismatch
- tests/control/targetVersion.test.ts > the panel refuses a targetVersion that is not the plan's integer (seam B) > N6 refuses a work body whose integer differs from the plan
- tests/control/targetVersion.test.ts > the panel refuses a targetVersion that is not the plan's integer (seam B) > N8 refuses a string in the run body as invalid
- tests/control/targetVersion.test.ts > the panel refuses a targetVersion that is not the plan's integer (seam B) > N9 refuses a run whose integer differs from its work item
- tests/control/targetVersion.test.ts > wire schemas refuse a string targetVersion (seam B) > N7b WorkItemViewV1 takes the view the panel built and refuses it with a string
- tests/control/webCcloopSmoke.test.ts > the frozen dispatch envelope reaches a real process (task 10 step 4) > carries the ledger's claim identity byte-for-byte and is durably accepted once
- tests/control/webCcloopSmoke.test.ts > the frozen dispatch envelope reaches a real process (task 10 step 4) > latches the stop under the ledger's request identity and returns evidence the store re-hashes
- tests/control/webContinuation.test.ts > batch resume from handoff > clears a completed stop with an empty selection when the frozen set was empty
- tests/control/webContinuation.test.ts > batch resume from handoff > holds an unselected recoverable task out of both the continuation batch and ordinary dispatch
- tests/control/webContinuation.test.ts > batch resume from handoff > refuses a selection whose held commitment no longer equals the inherited grant
- tests/control/webContinuation.test.ts > batch resume from handoff > refuses a selection whose predecessor run is not the task's canonical settled history
- tests/control/webContinuation.test.ts > batch resume from handoff > refuses a soft-overrun predecessor that leaves no representable subtraction and rolls back
- tests/control/webContinuation.test.ts > batch resume from handoff > refuses a stopped handoff whose group state is not complete
- tests/control/webContinuation.test.ts > batch resume from handoff > refuses to resume a partial handoff and never clears a pause with resume-from-handoff
- tests/control/webContinuation.test.ts > batch resume from handoff > registers every selection in one transaction and clears the completed handoff stop
- tests/control/webContinuation.test.ts > batch resume from handoff > rejects the whole batch when one selection is not the canonical recoverable predecessor
- tests/control/webContinuation.test.ts > batch resume from handoff > replays the persisted result after response loss without a second claim registration
- tests/control/webContinuation.test.ts > continuation claim, lineage, and re-arm > blocks as identity-space-exhausted when the continuation claim ordinal cannot advance
- tests/control/webContinuation.test.ts > continuation claim, lineage, and re-arm > consumes the registered pending run id once and appends it to the task lineage
- tests/control/webContinuation.test.ts > continuation claim, lineage, and re-arm > leaves the registered pending run id and ordinal untouched when the pre-claim probe fails
- tests/control/webContinuation.test.ts > continuation claim, lineage, and re-arm > re-arms a continuing intent after a failed-before-provider run with a new ordinal and run id
- tests/control/webContinuation.test.ts > continuation claim, lineage, and re-arm > redelivers a lost continuation wake without registering or claiming a second run
- tests/control/webContinuation.test.ts > dependency eligibility > keeps a dependent ineligible while its predecessor is only continuing
- tests/control/webContinuation.test.ts > direct per-task continue > continues one held task while the group is dispatch-enabled
- tests/control/webContinuation.test.ts > direct per-task continue > refuses a direct continue that would bypass a group stop intent
- tests/control/webContinuation.test.ts > direct per-task continue > refuses to continue a task whose commitment is not held and mutates nothing
- tests/control/webContinuationAccounting.test.ts > recoverable handoff settlement and continuation grants > leaves a wake with unknown usage undelivered instead of claiming on an unknowable budget
- tests/control/webDispatch.test.ts > durable start and proof recovery > applies deterministic start precedence over the first failure encountered
- tests/control/webDispatch.test.ts > durable start and proof recovery > commits a durable start wake without touching the provider
- tests/control/webDispatch.test.ts > durable start and proof recovery > does not call the provider when an invalid proof is synchronously proved no-start
- tests/control/webDispatch.test.ts > durable start and proof recovery > keeps a start-unknown estimator in a draft group without a coarse blocked transition
- tests/control/webDispatch.test.ts > durable start and proof recovery > makes a claim either create a starting run or record a group-local blocker, never both
- tests/control/webDispatch.test.ts > durable start and proof recovery > never allocates a second run for a replayed identical claim identity
- tests/control/webDispatch.test.ts > durable start and proof recovery > records proof acknowledgement exactly once and never double-charges a replay
- tests/control/webDispatch.test.ts > durable start and proof recovery > reserves one provider attempt per beginProviderAttempt invocation
- tests/control/webDispatch.test.ts > durable start and proof recovery > returns control-capability-unsupported and writes no wake when the probe degrades
- tests/control/webDispatch.test.ts > durable start and proof recovery > treats a contradictory start marker and no-start proof as globally dispatch-blocked unknown
- tests/control/webDispatch.test.ts > scheduler wake delivery > defers wakes behind a group-local blocker and a missing handler
- tests/control/webDispatch.test.ts > scheduler wake delivery > delivers the real web start handler into a starting run
- tests/control/webDispatch.test.ts > scheduler wake delivery > drains pending wakes during startup recovery before anything else runs
- tests/control/webDispatch.test.ts > scheduler wake delivery > keeps a failed-before-provider run booked at its unspent grant so the panel read path stays open
- tests/control/webDispatch.test.ts > scheduler wake delivery > keeps a wake pending when its handler refuses or loses the claim
- tests/control/webDispatch.test.ts > scheduler wake delivery > re-arms the claim from a no-start wake under the original start revision
- tests/control/webDispatch.test.ts > scheduler wake delivery > renders a web-started group through the panel read path
- tests/control/webDispatch.test.ts > scheduler wake delivery > retains every wake while dispatch is globally blocked and never invokes a handler
- tests/control/webDispatch.test.ts > scheduler wake delivery > routes a pending start wake to its kind handler and acknowledges it once
- tests/control/webFaults.test.ts > commit boundaries (task 10 step 3) > applies a cross-group shutdown to every group or to none, and an epoch replays it once
- tests/control/webFaults.test.ts > commit boundaries (task 10 step 3) > dies before the confirmation commit with an editable proposal, and the retry confirms once
- tests/control/webFaults.test.ts > commit boundaries (task 10 step 3) > dies before the handoff-stop commit with no stop row, no request and no outbox entry
- tests/control/webFaults.test.ts > commit boundaries (task 10 step 3) > keeps a start intent durable until it is delivered, and one delivery claims one run
- tests/control/webFaults.test.ts > commit boundaries (task 10 step 3) > latches a context gap once, keeps the gap observation out of the ledger, and suppresses the provider
- tests/control/webFaults.test.ts > commit boundaries (task 10 step 3) > reads an attempt with no proof either way as unknown and blocked, never as a clean no-start
- tests/control/webFaults.test.ts > commit boundaries (task 10 step 3) > recovers an open run before anything listens, so the first request already sees a blocked store
- tests/control/webMutations.test.ts > inverted invariants (task 10 step 3) > gates a strict claim on proof the profile cannot produce, while soft mode keeps claiming
- tests/control/webMutations.test.ts > inverted invariants (task 10 step 3) > holds exactly one context latch per run generation, whatever reason a writer claims
- tests/control/webMutations.test.ts > inverted invariants (task 10 step 3) > keeps a run whose usage went unknown booked to its reserve rather than quietly releasing it
- tests/control/webMutations.test.ts > inverted invariants (task 10 step 3) > registers a continuation for all of a batch or none of it
- tests/control/webMutations.test.ts > inverted invariants (task 10 step 3) > strengthens a stop intent but never weakens it, whichever order the tabs click in
- tests/panel/controlLifecycle.test.ts > panel shutdown transaction > commits one global command and leaves unchanged groups out of the command ledger and projection
- tests/panel/controlLifecycle.test.ts > panel shutdown transaction > gives a ready group an empty frozen set that completes, so restart can resume and start
- tests/panel/controlLifecycle.test.ts > panel shutdown transaction > leaves nothing behind when the commit is lost and replays the closed result once it succeeds
- tests/panel/controlLifecycle.test.ts > panel shutdown transaction > never extends an equal-strength shutdown intent from an earlier epoch
- tests/panel/controlLifecycle.test.ts > panel shutdown transaction > preserves a stronger human handoff-stop byte-for-byte
- tests/panel/controlLifecycle.test.ts > panel shutdown transaction > records an inconsistent frozen set as a blocker while still committing the other groups
- tests/panel/controlLifecycle.test.ts > panel shutdown transaction > refuses a writer that arrives after draining begins
- tests/panel/controlLifecycle.test.ts > panel shutdown transaction > strengthens a pause only when an active run must be stopped, and freezes that run
- tests/panel/controlLifecycle.test.ts > panel shutdown transaction > waits for a writer admitted before the gate and then commits every group at once
- tests/panel/controlLifecycle.test.ts > shutdown exemption and a persisted frozen set (review round 1, Important 2) > does not flag shutdown-frozen-set-inconsistent for a Web work run frozen before a driver existed, once a later shutdown exempts it
- tests/panel/runContinuable.test.ts > RunViewV1.continuable (handoff delivery C-4) > is false for a handoff-settled run that is not recoverable, although its checkpoint is partial
- tests/panel/runContinuable.test.ts > RunViewV1.continuable (handoff delivery C-4) > is false for a handoff-settled run whose checkpoint says the task completed
- tests/panel/runContinuable.test.ts > RunViewV1.continuable (handoff delivery C-4) > is false for a handoff-settled run with a partial checkpoint whose remaining work grant has an exhausted dimension
- tests/panel/runContinuable.test.ts > RunViewV1.continuable (handoff delivery C-4) > is true for a run a handoff settled recoverably with a partial checkpoint
- tests/panel/shutdownDriverGroup.test.ts > graceful shutdown and driver-owned groups (handoff delivery m5) > commits the new disposition under the global command and replays it through the ledger schema
- tests/panel/shutdownDriverGroup.test.ts > graceful shutdown and driver-owned groups (handoff delivery m5) > freezes a group that was never started even when a driver exists: it is not the driver's yet
- tests/panel/shutdownDriverGroup.test.ts > graceful shutdown and driver-owned groups (handoff delivery m5) > freezes a started group exactly as before when no driver exists, idle or running
- tests/panel/shutdownDriverGroup.test.ts > graceful shutdown and driver-owned groups (handoff delivery m5) > freezes a started group whose body carries no planHash: the planHash is part of the definition
- tests/panel/shutdownDriverGroup.test.ts > graceful shutdown and driver-owned groups (handoff delivery m5) > H7: freezes a driver-owned group as before while a non-driver run (an estimate) is active in it
- tests/panel/shutdownDriverGroup.test.ts > graceful shutdown and driver-owned groups (handoff delivery m5) > preserves an existing pause on an idle driver-owned group: the skip never pre-empts an earlier intent
- tests/panel/shutdownDriverGroup.test.ts > graceful shutdown and driver-owned groups (handoff delivery m5) > skips a started driver-owned group that is idle, with no active run at all
- tests/panel/shutdownDriverGroup.test.ts > graceful shutdown and driver-owned groups (handoff delivery m5) > skips a started group whose only active run is the driver's Web work run: no stop intent, not stopped, no request

(B) profile v2、`probe`／`readView` 签名、执行快照 v2、work item 视图、plan `configHash` 删除、grace（108 条；`scratchpad/W5/redsT11-other.txt`，另加 W6-9 引入的 1 条）：

- tests/control/ccloopPort.test.ts > production ccloop execution port > answers a profile probe through the router instead of being reported as a failed probe
- tests/control/ccloopPort.test.ts > production ccloop execution port > therefore, with a peer answering the v2 default, keeps handoffControl durable and handoffExecution non-null through intersectCapabilities
- tests/control/driverHandoff.test.ts > nothing arrives (spec §3 grace, §11 I3) > turns the request outcome-unknown past deadline + grace, keeps collecting without killing, and H-settles a late candidate
- tests/control/estimator.test.ts > frozen estimator > freezes exact input formula, contract constants, and checks later degradation
- tests/control/executionSnapshot.test.ts > execution snapshot preparation > derives deterministic immutable contracts and sorted snapshot authority
- tests/control/executionSnapshot.test.ts > execution snapshot preparation > rejects an duplicate estimate allocation relative to persisted authority
- tests/control/executionSnapshot.test.ts > execution snapshot preparation > rejects an extra task relative to archived plan authority
- tests/control/executionSnapshot.test.ts > execution snapshot preparation > rejects an omitted estimate allocation relative to persisted authority
- tests/control/executionSnapshot.test.ts > execution snapshot preparation > rejects an omitted task relative to archived plan authority
- tests/control/executionSnapshot.test.ts > execution snapshot preparation > rejects an substituted estimate allocation relative to persisted authority
- tests/control/executionSnapshot.test.ts > execution snapshot preparation > rejects an understated estimate allocation relative to persisted authority
- tests/control/executionSnapshot.test.ts > execution snapshot preparation > rejects an wrong-ID estimate allocation relative to persisted authority
- tests/control/executionSnapshot.test.ts > execution snapshot preparation > rejects component over-limit and safe-integer sum overflow
- tests/control/executionSnapshot.test.ts > execution snapshot preparation > rejects mismatched group identity
- tests/control/executionSnapshot.test.ts > execution snapshot preparation > rejects mismatched plan identity
- tests/control/executionSnapshot.test.ts > execution snapshot preparation > rejects mismatched proposal identity
- tests/control/executionSnapshot.test.ts > execution snapshot preparation > rejects missing task buckets and unrepresentable original policies
- tests/control/planImport.test.ts > immutable plan import > does not persist an transient asynchronous preparation failure
- tests/control/planImport.test.ts > immutable plan import > does not persist an unexpected asynchronous preparation failure
- tests/control/planImport.test.ts > immutable plan import > durably rejects an initially stale import before any defaults, profile, probe, or source callbacks
- tests/control/planImport.test.ts > immutable plan import > fails closed on noncanonical proposal bytes and an estimate request hash mismatch
- tests/control/planImport.test.ts > immutable plan import > fails closed on structurally valid but malformed proposal and estimate authority
- tests/control/planImport.test.ts > immutable plan import > fails closed when an archived content-addressed plan is missing or damaged
- tests/control/planImport.test.ts > immutable plan import > is absent or fully replayable after real SIGKILL after-commit
- tests/control/planImport.test.ts > immutable plan import > is absent or fully replayable after real SIGKILL before-commit
- tests/control/planImport.test.ts > immutable plan import > lets a concurrent same-id commit win when an in-flight probe rejects durably
- tests/control/planImport.test.ts > immutable plan import > normalizes sets, archives contracts, and keeps imported authority unchanged after source edits
- tests/control/planImport.test.ts > immutable plan import > persists a terminal blocked-capability preflight without a scheduler wake
- tests/control/planImport.test.ts > immutable plan import > persists a terminal input-too-large preflight without a scheduler wake
- tests/control/planImport.test.ts > immutable plan import > persists and replays a durable changed profile rejection across a later config change
- tests/control/planImport.test.ts > immutable plan import > persists and replays a durable missing profile rejection across a later config change
- tests/control/planImport.test.ts > immutable plan import > persists non-allowlisted source rejection without creating a group
- tests/control/planImport.test.ts > immutable plan import > persists revision conflict before a failing in-flight probe and replays it before changed defaults
- tests/control/planImport.test.ts > immutable plan import > rechecks command identity after an in-flight probe and creates no duplicate effects
- tests/control/planImport.test.ts > immutable plan import > rechecks revision after a successful in-flight probe before source I/O
- tests/control/planImport.test.ts > immutable plan import > rejects a contract outside the closed ccloop V1 schema
- tests/control/planImport.test.ts > immutable plan import > rejects a plan inode swap between trusted resolution and descriptor validation
- tests/control/planImport.test.ts > immutable plan import > rejects dangling dependency and leaves the group completely absent
- tests/control/planImport.test.ts > immutable plan import > rejects duplicate dependency and leaves the group completely absent
- tests/control/planImport.test.ts > immutable plan import > rejects duplicate task and leaves the group completely absent
- tests/control/planImport.test.ts > immutable plan import > replays asynchronously before capability I/O and cannot hang on a lost-response retry
- tests/control/planImport.test.ts > immutable plan import > replays the original result without rereading a changed source or changed server defaults
- tests/control/planImport.test.ts > immutable plan import > returns a same-id raw conflict before capability I/O
- tests/control/planImport.test.ts > immutable plan import > rolls back every import row when interrupted before commit
- tests/control/planImport.test.ts > immutable plan import > turns a real probe failure into a terminal import without optimistic capability
- tests/control/profiledService.test.ts > profiled service execution > freshly rejects stale, missing, and unavailable profiles at start without invoking a provider
- tests/control/profiledService.test.ts > profiled service execution > freshly validates the persisted profile before reconciling an unknown start
- tests/control/profiledService.test.ts > profiled service execution > lets drain pass a hanging claim probe, then rejects its writer
- tests/control/profiledService.test.ts > profiled service execution > lets drain pass a hanging handoff call and rejects its later evidence writer
- tests/control/profiledService.test.ts > profiled service execution > lets drain pass a hanging reconcile probe, then rejects its writer
- tests/control/profiledService.test.ts > profiled service execution > lets drain pass a hanging start call and forbids its post-I/O status write
- tests/control/profiledService.test.ts > profiled service execution > lets drain pass hanging evidence I/O and rejects every later evidence writer
- tests/control/profiledService.test.ts > profiled service execution > persists the binding and starts only through the selected profile port
- tests/control/profiledService.test.ts > profiled service execution > rejects a task-only profile where a separate handoff profile is required
- tests/control/profiledService.test.ts > profiled service execution > rejects stale, missing, and unavailable profiles before claim state or provider invocation
- tests/control/profiledService.test.ts > profiled service execution > rejects strict profiles whose matching proof omits the tokens work dimension
- tests/control/profiledService.test.ts > profiled service execution > releases admission after reconcile and claim exceptions
- tests/control/profiles.test.ts > trusted execution profiles > changes profileHash when any resolved execution byte changes
- tests/control/profiles.test.ts > trusted execution profiles > degrades a failed or malformed capability probe to wholly unavailable
- tests/control/profiles.test.ts > trusted execution profiles > intersects every ordered capability and keeps proof only on exact descriptor equality
- tests/control/profiles.test.ts > trusted execution profiles > keeps Codex phase-end and soft
- tests/control/profiles.test.ts > trusted execution profiles > owns immutable snapshot and port method bindings after construction
- tests/control/profiles.test.ts > trusted execution profiles > preserves the original receiver for captured port methods
- tests/control/profiles.test.ts > trusted execution profiles > rejects forged router entries and refuses to probe a profile from another router
- tests/control/profiles.test.ts > trusted execution profiles > rejects profiles whose context tokenizer or task output limit does not match the declaration
- tests/control/profiles.test.ts > trusted execution profiles > routes only an allowlisted work kind with the exact frozen hash
- tests/control/stopIntent.test.ts > model-assisted handoff attempts > settles the request unrecoverably when the frozen handoff profile disappears
- tests/control/targetVersion.test.ts > plan file targetVersion (seam B) > N0 accepts a positive integer, so the refusals below are about the value and not the fixture
- tests/control/targetVersion.test.ts > plan file targetVersion (seam B) > N1 refuses a string by name, at the field
- tests/control/targetVersion.test.ts > plan file targetVersion (seam B) > N2 refuses a fraction
- tests/control/targetVersion.test.ts > plan file targetVersion (seam B) > N2 refuses an unsafe integer
- tests/control/targetVersion.test.ts > plan file targetVersion (seam B) > N2 refuses zero
- tests/control/targetVersion.test.ts > wire schemas refuse a string targetVersion (seam B) > N7 ControlPlanV1 takes 3 and refuses "3"
- tests/control/unconfiguredPort.test.ts > a claim against an unconfigured port > refuses by the port's own name and writes no run, rather than blaming the adapter's capabilities
- tests/control/unconfiguredPort.test.ts > the unconfigured execution port > exposes the optional probe, so a missing port is never reported as a missing capability
- tests/control/webProtocol.test.ts > Web control protocol > accepts an explicit Codex phase-end plus soft profile snapshot
- tests/control/webProtocol.test.ts > Web control protocol > validates a complete, canonically ordered execution snapshot
- tests/control/webProtocol.test.ts > Web control protocol > validates normalized plans and rejects unsorted or duplicate sets
- tests/panel/assemblyHandoffGrace.test.ts > the handoff grace the assembly hands the driver (spec §3) > is the adapter's killGraceMs plus the fixed extra, and only the fixed extra when killGraceMs is unusable
- tests/panel/controlConfig.test.ts > trusted panel control config > rejects a plan or ancestor swapped to a symlink after startup
- tests/panel/controlConfig.test.ts > trusted panel control config > rejects allowlisted plan escapes and symlinked path components at startup
- tests/panel/controlConfig.test.ts > trusted panel control config > rejects duplicate IDs and invalid trusted executable paths before serving config
- tests/panel/controlConfig.test.ts > trusted panel control config > resolves only stable repository and plan IDs and never exposes trusted paths
- tests/panel/controlConfigPort.test.ts > the served config states whether an estimator was chosen > serves null defaults rather than refusing to build
- tests/panel/controlConfigPort.test.ts > the served config states whether an estimator was chosen > still refuses an estimator that was named and does not resolve
- tests/panel/controlConfigPort.test.ts > the served config states whether an execution port is configured > does not answer the port question from a profile's probe failure
- tests/panel/controlConfigPort.test.ts > the served config states whether an execution port is configured > serves "configured" when it was
- tests/panel/controlConfigPort.test.ts > the served config states whether an execution port is configured > serves "unconfigured" when the panel was started without one
- tests/panel/controlConfigPort.test.ts > the two pairs cannot disagree > refuses a configured port with no adapter config
- tests/panel/controlConfigPort.test.ts > the two pairs cannot disagree > refuses an unconfigured port that still carries one, which is the other direction
- tests/panel/controlConfigPort.test.ts > the two pairs cannot disagree > refuses half an estimator in both directions
- tests/panel/controlReadApi.test.ts > canonical control read API > accepts a globally deduplicated derived contract when each group snapshot independently proves its authority
- tests/panel/controlReadApi.test.ts > canonical control read API > authenticates reads, enforces canonical sinceChangeSeq spelling, and keeps immediate kill absent
- tests/panel/controlReadApi.test.ts > canonical control read API > blocks a 'checkpoint' evidence collection containing a 'invalid' element
- tests/panel/controlReadApi.test.ts > canonical control read API > blocks a 'checkpoint' evidence collection containing a 'null' element
- tests/panel/controlReadApi.test.ts > canonical control read API > blocks a 'handoff' evidence collection containing a 'invalid' element
- tests/panel/controlReadApi.test.ts > canonical control read API > blocks a 'handoff' evidence collection containing a 'null' element
- tests/panel/controlReadApi.test.ts > canonical control read API > blocks a 'outbox' evidence collection containing a 'invalid' element
- tests/panel/controlReadApi.test.ts > canonical control read API > blocks a 'outbox' evidence collection containing a 'null' element
- tests/panel/controlReadApi.test.ts > canonical control read API > blocks a 'recovery' evidence collection containing a 'invalid' element
- tests/panel/controlReadApi.test.ts > canonical control read API > blocks a 'recovery' evidence collection containing a 'null' element
- tests/panel/controlReadApi.test.ts > canonical control read API > fails closed when confirmed allocation or derived-contract authority is missing, forged, or belongs to another task
- tests/panel/controlReadApi.test.ts > canonical control read API > rejects budget and graph legacy stopped flags without canonical stop intents
- tests/panel/controlReadApi.test.ts > canonical control read API > rejects malformed or cross-record-inconsistent persisted run authority instead of synthesizing display values
- tests/panel/controlReadApi.test.ts > canonical control read API > reloads confirmed profiles, snapshot hashes, estimate output, and paused state without exposing trusted paths
- tests/panel/controlReadApi.test.ts > canonical control read API > requires canonical stop authority and preserves revision and blocker evidence on group read failures
- tests/panel/controlReadApi.test.ts > canonical control read API > returns persisted command results, sorted recovery, verified evidence manifests, and exact typed misses
- tests/panel/controlReadApi.test.ts > canonical control read API > returns sorted complete, incremental, ahead, and retained-gap summaries
- tests/control/webProtocol.test.ts > Web control protocol > enforces canonical group allocation ownership and command revision nullability


---

## W5 自审（按 superpowers:writing-plans 的三项）

1. **覆盖**：brief 点名的每一项都有落点 —— T8 形式定义与 (a)–(e) 各一判据＋点名变异 T8-M1（删 `eff(l_i) === A`）；T9 表与迁移（含 `store.ts:86` 的第二处版本表）、`operator` scope（`@operator:<id>`，revision 取自 `agent_preferences.revision`，三处取法都改）、动词经 raw／effective 两套 schema；T10 plan 字段、`ControlPlanV1`、导入冻结 estimator 且失败退化 `blocked-capability`、估算 `configHash` 不再是 `profileHash`、`proposal-set-agent` 推进 `proposalVersion`（「删 `configHash`」按 W5-M5 移入 T11）；T11 异步 confirm（仿 `importControlPlanAsync`：preflight → 事务外解析 → `applyWebCommand` 内复核）、冻结六字段进 work item 与 run、组 `reconcileSlot`、执行快照 v2、`readConfirmedTaskExecution` 与 `controlViews` 以快照为权威、profile v2、闸门逐调用点（`webDispatch.ts` 两处、`dispatch.ts` 两处、续跑（经 `createStartingRun` 从 work item 拷）、`budget.ts`（`claimWork` 用调用方传入的能力，调用方已换成冻结选择，本身不改）、`service.ts`、`stopIntent.ts`、`webService` 估算两处（T10）、`planImport` 预检（T10）、`controlConfig.readView`）、`handoffGraceMsOf` 读冻结 `killGraceMs`。
2. **占位扫描**：正文没有 TBD／「类似 Task N」。两处 `<<…>>` 标记只存在于中间稿，最终文件已替换为清单全文。唯一「按规则逐行套用」的地方是 (A) 类 143 条确认调用点——每一行的 file:line 都列了，规则是确定的字面替换。
3. **类型一致**：`FrozenSlot`、`PartialSelection`、`GroupAgentOverrides` 等全用骨架原名；W6 裁定的名字（`resolveGroupSelections`、`SlotResolution`、`GroupSelectionResolution`、`frozenSlotSchema`、`selectionProvenanceSchema`、`groupAgentOverridesSchema`、`proposalSetAgentPayloadSchema`、`setAgentPreferencesPayloadSchema`、`readAgentPreferences` 返回 `{revision, preferences}`、槽位键 `task:<taskId>`／`reconcile`、payload 只有 `{preferences}`）逐一对过。骨架外新增的名字全部列在 W5-M7，等控制器补进骨架。

**实施席必须先知道的三件事**：(1) W5-M16 是一条**放宽**，未经人裁不许落 T10 Step 10.14(1) 的那一处改写；(2) W5-M2／W5-M17 依赖 T7 在 T7→T11 之间给「不带选择的探测」留一个能答的临时态；(3) 变红清单是静态预测，每个 Task 在改判据前先在副本里把涉及文件跑一遍，以实跑为准（Rule 12）。
