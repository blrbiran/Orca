

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
