# Task 标签 ＋ 内部进度（goal.md N8 ＋ N3）设计

> 会话 `2724716d`，2026-09-28。出处：`docs/handoff/goal.md` §10 的 N8、N3，§10.1 排第 1；人裁 G4、G11（§10.2）。
> 本文的每一条人裁都是人在本会话里逐条拍的，原话见 §1。
> ⚠️ **§8「审查后的修订」优先于上文**：同一会话派子代理拿本文逐条核了真实代码，§8 记下 19 条发现的处置。上文与 §8 冲突时以 §8 为准。

## 0. 要做成什么

- **标签**：plan 里每个 task 可以带多个标签，人在面板上随时可以改。用途：看板筛选；以后 §3.3 按标签选 loop 方案、指标按标签切分（这一轮只把数据备好）。
- **进度**：需求（组）级给「已完成 task 数／总数」；task 级不给假百分比，给阶段（plan／execute／verify）、第几次尝试、token 已用占比；点开一个 task 能看到标签、进度、历次 run 与各自的 evidence 清单。
- 数字都由代码算，用量只取工具报的数，拿不到就显示「未知」（Rule 14）。

## 1. 本会话的人裁

| 编号 | 问题 | 人裁 |
|---|---|---|
| **L-1** | 标签从哪来 | **B**：plan 文件里写，面板上也能改（走命令模型） |
| **L-2** | 已确认／运行中的组能不能改标签 | **A**：任何状态都能改。以后 §3.3 在 claim 时冻结当时的标签，之后再改只影响下一次 claim |
| **L-3** | 阶段信息怎么到 Orca | **A**：ccloop 的 `collect` 增加 `progress` 字段（契约归 ccloop，G1） |
| **L-4** | task 详情做到什么程度 | **A**：只用现有数据源；阶段只显示最新一份，不留历史 |
| **L-5** | 总体做法 | **方案 1**：plan 存档保留原始标签，面板的修改作为 work item 上的覆盖层 |
| **L-6** | 词表的兼容性 | **A**：词表只在输入口校验，存储层只校验格式；另开放 `custom:` 前缀的自定义标签。⚠️ 这是对 G11「闭集」的**补充**：系统标签仍是 G11 那 10 个词的闭集，自定义标签是新增的一类，代码不消费它 |

## 2. 数据模型

### 2.1 标签的两类与词表

新文件 `src/control/labels.ts`（CLI 与 Web 共用这一个定义）：

- **系统标签**：不带前缀，必须在词表里。词表＝G11：`feature`、`bug`、`refactor`、`test`、`doc`、`design`、`investigate`、`perf`、`security`、`chore`。**只有这一类会被代码消费**（以后的 §3.3、指标）。
- **自定义标签**：`custom:` 前缀＋1–32 个字符，允许中文，不允许空白与控制字符，存储前做 NFC 规范化。只用于展示与筛选。
- 每个 task 最多 16 个标签。
- 导出两个校验：
  - `inputLabelsSchema`（输入口）：逐项按上面的规则校验，词表外的裸词报错并点名；结果排序、去重。
  - `storedLabelsSchema`（存储层）：只校验格式——非空字符串、长度上限、有序、无重复、个数上限。**不查词表。**
- ⇒ 以后增词、删词、改名，旧组照样能读；只有新输入按当时的词表来。
- 以后新增的系统词永远不会和自定义标签撞名（前缀不同）。
- 系统词**改名**这一轮不兼容：真要改名时由那一轮加一张别名表。

### 2.2 plan 文件（`src/scheduler/planFile.ts`）

- `planTaskSchema` 增加可选 `labels`：数组，逐项过 `inputLabelsSchema` 的规则，**允许乱序与重复**，由解析器排序去重。
- 词表外的裸词让整份 plan 被拒，错误码沿用 `malformed`，消息点名那个词。
- `readSchedulerControlPlanSource` 按显式字段列表复制——`labels` 要加进这个列表，否则被静默丢掉。
- `orca plan` 的报告（`planReport.ts`）在每个 task 那一行后面显示它的标签。

### 2.3 存档 plan（`controlPlanSchema`，`orca-control-plan-v1`）

- task 增加 `labels`：可选，`storedLabelsSchema`，且至少一个元素。
- `normalizeControlPlan` **只在标签非空时写这个键**，与现有 `agent` 的写法一样；不写 `labels: undefined`（`canonicalBytes` 会抛错）。
- ⇒ 没有标签的 plan，存档字节与 `planHash` 逐字节不变；已导入的旧组不受影响。
- ⚠️ **不许**写成 `.default([])`：存档每次读取都重解析并要求规范化字节逐字节还原（`queries.ts`、`executionSnapshot.ts`、`estimator.ts`），一个默认值会让所有旧组变成 `recovery-blocked`。
- 已知副作用：估算请求内嵌整份存档 plan，带标签的 plan 会让估算 prompt 多几个 token。标签不进入 ccloop 的 start envelope。

### 2.4 work item（`work_items.body`，JSON）

- 新增 `labelsOverride`（`null`，或一个数组：元素规则同 `storedLabelsSchema`，但**允许空数组**，表示人明确清空）与 `labelsVersion`（非负整数）。
- 旧记录没有这两个键，读作 `null` 与 `0`；导入新 plan 时**也不写**这两个键，第一次被命令改时才写。
- 不做 SQL 迁移。

### 2.5 实际生效的标签（只在一处算）

- `labelsOverride !== null` ⇒ 用它，来源 `operator`；否则用存档 plan 里该 task 的 `labels`（没有就是 `[]`），来源 `plan`。
- 覆盖成 `[]` 合法，表示人明确清空，和「没有覆盖」不同。

### 2.6 run 的进度

- run 的 body 新增 `progress`：`{ status, currentAttempt, attemptsUsed, attemptsRemaining, lastTransitionAt }`，原样取自 ccloop 的应答；没收到过时为 `null`。
- 每次 collect 用最新一份覆盖，不留历史（L-4）。

## 3. 协议

### 3.1 新命令 `set-task-labels`（Orca web 命令）

- 形状沿用现有命令：`commandId`、`actorId`、`target`（组），`payload`：`{ taskId, labels, baseLabelsVersion }`，或 `{ taskId, revert: true, baseLabelsVersion }`（撤掉覆盖、回到 plan 原始标签）。
- 服务端依次：
  1. work item 存在且 `kind === "task"`，否则 `work-not-found`；
  2. `baseLabelsVersion` 等于当前值，否则 `labels-version-conflict`；
  3. `labels` 过 `inputLabelsSchema`（排序、去重、NFC），否则 `labels-invalid`（点名那一项）；
  4. 结果与当前的覆盖状态相同 ⇒ `no-op-command`（设成与当前生效值相同的集合，也算 no-op；revert 时本来就没有覆盖，也算 no-op）。
- 写入：`labelsOverride`（revert 时为 `null`）与 `labelsVersion + 1`。
- **不检查组的状态**（L-2），**不碰预算提案、不改 `proposalVersion`**，组不需要重新确认。
- 重放：走 `applyWebCommand`，同一个 `commandId` 返回存下来的结果。
- Web 端 `controlTypes.ts` 同步加命令与新字段，`tests/panel/webParity.test.ts` 双向比对。

### 3.2 ccloop `collect` 的 `progress`

- ccloop `CollectionV1` 增加 `progress`：run 目录下有 `run/loop-state.json` 就取其中的 `{ status, currentAttempt, attemptsUsed, budgetSnapshot.attemptsRemaining → attemptsRemaining, lastTransitionAt }`，没有（`ENOENT`）就是 `null`；**非终态和终态都填**。JSON 坏了按现有 `readTerminal` 的口径报 `control-terminal-invalid`。
- ccloop 自己的 strict 响应 schema 同步加字段（否则 ccloop 先拒掉自己的应答）。
- Orca 的 `collectionSchema`（`ccloopPort.ts`）把 `progress` 写成**可选**，`ExecutionReport` 增加 `progress`（缺失读作 `null`）。其余 `ExecutionPort` 实现（未配置 port、判据里的假 port、内嵌 fake ccloop）补 `progress: null` 或按夹具给值。

### 3.3 落地与推送顺序

- 先落 Orca（接受可选 `progress`，此时 ccloop 不发，行为不变），再落 ccloop（开始发）。
- ⚠️ **推送顺序和平时相反：这一轮先推 Orca，再推 ccloop。** 反过来，旧 Orca 会以 `control-response-invalid` 拒收带 `progress` 的应答。写进 handoff 的 awaitingHuman。

### 3.4 Orca 怎么存

- `collectInto` 拿到 `progress` 后，与 run 记录里现有那份做规范化字节比较，**变了才写**（写入推进 `changeSeq`，面板轮询就能看到），没变不写。
- 存 ccloop 的原值；阶段映射放在投影层。

## 4. 投影与 UI

### 4.1 服务端投影（`readControlGroup` → `groupViewSchema`，strict）

- **组级** `completion: { done, total }`：`done`＝work item 状态为 `completed`（存储里是 `done`）的 task 数；`blocked`／`held`／`continuing` 都不算。摘要 `GroupSummaryV1` 也加同一个字段。
- **每个 work item**：
  - `labels`、`labelsProvenance`（`plan`｜`operator`）、`labelsVersion`；
  - `progress`：取「当前 run」＝`currentRunId`，否则 `lineageRunIds` 的最后一个，否则 `null`：
    - `phase`：ccloop `status` 映射——`planning`→`plan`、`executing`→`execute`、`verifying`→`verify`，终态照原名（`succeeded`／`blocked_waiting_human`／`exhausted`／`cancelled`／`failed`），`queued`→`queued`；
    - `attempt`：`{ current: currentAttempt, max: attemptsUsed + attemptsRemaining }`，**两数取自 ccloop 同一份快照**，不与 Orca 的 grant 混算；
    - `tokens`：该 run 现有的 `used` / (`used` + `remaining`)；用量未知（`usageUnknown`）或该 run 已超支时为 `null`，UI 显示「未知」——**绝不给 0 或估算比例**；
    - `lastTransitionAt`。
- 不新增 HTTP 接口；evidence 沿用 `GET /api/control/runs/:runId/evidence`（清单）与 `…/evidence/:artifactId`（单件下载）。

### 4.2 Web UI

- **组视图 task 表**：
  - 标签列：系统标签与 `custom:` 标签用不同样式；
  - 进度列：阶段 · 第 n/max 次尝试 · token 已用百分比（未知时显示「未知」）；
  - 表头上方的标签筛选：多选、any-of；状态只在页面内存里。
- **导航栏**：每个组显示 `done/total`。
- **task 详情面板**（点表格一行展开）：
  - 标签编辑器：系统词用下拉，自定义标签用输入框（自动补 `custom:`），外加「恢复 plan 原始标签」按钮；提交带 `labelsVersion`；被拒时原样显示错误码（`Refusal`）；**编辑草稿只在命令成功后才清**（这是人手里的数据，被拒时不能丢）。
  - 进度区：同上三项，加 `lastTransitionAt`。
  - run 列表：该 task 历次的 run，每个可展开它的 evidence 清单，逐件下载。
- 轮询不变（2 秒、`changeSeq` 增量）。

## 5. 判据（每个新分支点名一条删掉它自己的变异，看见红才算）

### 5.1 标签（Orca）

- **L1** 带标签的 plan 导入后，存档里是排序去重后的结果；**没有标签的固定夹具，存档字节与 `planHash` 等于改动前硬编码的值**。变异：总写 `labels: []` ⇒ 红。
- **L2** 改动前生成的旧存档（固定字节）照样能读，不出现 `recovery-blocked`。变异：存储层按词表校验，且从词表删掉旧组用过的词 ⇒ 红。
- **L3** 输入口：词表外裸词被拒并点名；`custom:` 接受中文并做 NFC；第 17 个被拒；plan 导入与命令两个入口各一遍。变异：去掉任一条校验 ⇒ 对应格红。
- **L4** `set-task-labels`：版本冲突被拒；no-op；`[]` 与 revert 是两种结果；**在已确认与运行中的组上都能执行，且 `proposalVersion` 不变**；同一 `commandId` 重放同结果。变异：加上 `prestart` ⇒「运行中」格红；推进 proposal ⇒「不需要重新确认」格红。
- **L5** 生效标签：覆盖优先、`[]` 覆盖与无覆盖区分、来源正确。
- **L6** `orca plan` 报告显示标签。

### 5.2 进度（两仓）

- **P1**（ccloop）运行中返回 `progress`，终态也返回；没有 `loop-state.json` 时为 `null`。变异：只在终态填 ⇒「运行中」格红。
- **P2**（Orca）带与不带 `progress` 的应答都接受；字段类型错时整份拒收。
- **P3**（Orca）progress 没变不写，变了写并推进 `changeSeq`。变异：去掉比较 ⇒ 写入计数的判据红。
- **P4**（Orca 投影）当前 run 的选择；阶段映射；尝试数取同一份快照；**用量未知时 `tokens` 为 `null` 而不是 0**。变异：未知时返回 0 ⇒ 红。
- **P5** 完成度：`completed` 计入，`blocked`／`held`／`continuing` 不计入；摘要与组视图一致。
- **E2E** 在现有「fake claude ＋ 真 ccloop build」的端到端判据上加断言：跑的过程中至少观测到一次非终态阶段；结束后 `completion` 为 1/1。

### 5.3 Web（jsdom）

- 标签列显示；筛选 any-of；编辑器提交带 `labelsVersion`；被拒草稿保留、成功草稿清掉；进度列在未知时显示「未知」；详情面板列出 evidence 清单；`webParity` 覆盖所有新字段。

### 5.4 收尾的门（成功判据）

两仓全新 clone，HOME 与四个 XDG 根改道，`TMPDIR` 用短路径真目录，json reporter，结果重定向到文件再读回：

- ccloop：build／typecheck RC 0，`node scripts/check-known-reds.mjs` 退 0，`node scripts/check-tmp-leak.mjs` 退 0；
- Orca：web build／typecheck RC 0，全量除已登记 flake 外全过，web check 退 0，`verify:panel` 退 0，`node scripts/check-tmp-leak.mjs` 退 0；真 `~/.orca` 前后 `stat` 相同。

## 6. 这一轮不做

阶段变化的历史；SSE；页面内直接显示 ccloop 的产物；指标按标签切分；§3.3 在 claim 时冻结标签；系统词改名的别名表；CLI 的 `--json` 与 agent 入口（N2）。

## 7. 既有判据会不会被动到（Rule 15(a) 预先登记）

预计要改的既有判据（实施时按实际逐条列给人，未经人指名不改）：

- `tests/panel/webParity.test.ts`：只要双向比对是按字段表写的，就要加新字段；
- 断言 `groupViewSchema`／`workItemViewSchema`／`GroupSummaryV1` 整体形状（`toEqual` 整个对象）的判据；
- 断言 ccloop `collect` 应答整体形状的判据（两仓）；
- 内嵌 fake ccloop 的夹具要多答 `progress`。

能只加不改的一律只加。

## 8. 审查后的修订（同一会话，子代理对照代码审查后；优先于上文）

每条标了严重度与出处（代码行号是审查时的现测，引用前要现测）。「控制器定」的都是可逆选择（Rule 1 第 2 档）。

### 8.1 blocker

- **R1 run 视图的 schema 是 strict 的**（`src/panel/controlViews.ts` `persistedRunSchema`，解析失败 ⇒ `run-invalid` ⇒ 组 recovery-blocked）。⇒ §2.6 补：`persistedRunSchema` 加 `progress: progressSchema.nullable().optional()`，缺键读作 `null`；旧 run 不补写。**新判据**：没有 `progress` 键的旧 run body 照样能读出组视图。
- **R2 `collectInto` 手里的 run 是旧的**，它在返回前已经通过 `recordUsage` 改写了 run 的 `cumulative`／`remaining`／`unknown`／`breaches`／`highWater`。拿参数里的 run 加上 progress 存回去会把这些回滚，下一次按旧 cumulative 算增量 ⇒ `group.used` 重复计入。⇒ §3.4 改为：**在用量循环之后**，`write(deps, () => { const current = readDriverRun(store, runId); current.progress = …; saveDriverRun(store, current); })`，**绝不从参数里的 run 写**。**新判据**：同一次 collect 里同时有 progress 和用量事件时，`cumulative` 与 `group.used` 等于只有用量事件时的值。

### 8.2 important

- **R3 P3 的变异打不红**：`saveRun`（`budget.ts`）本来就是 `UPDATE … WHERE body<>?`，只在变了时 `recordProjectionChange`。⇒ §3.4 删掉「另做规范化比较」，改为「经 `saveDriverRun` 写，它已经只在变了时写」。P3 的变异换成：① 用裸 `UPDATE` ＋ `recordProjectionChange` 写 ⇒ progress 没变 `changeSeq` 也推进 ⇒ 红；② 不存 progress ⇒「变了就推进」那格红。
- **R4 Orca 的 port 逐字段复制 collect 应答**（`ccloopPort.ts` `collect` 的返回对象），不加就被静默丢掉。⇒ §3.2 点名：返回对象加 `progress: response.progress ?? null`；**新判据**经真 port ＋ `tests/control/fixtures/fake-ccloop-control.mjs` 走一遍。
- **R5 假 port 不改**：`ExecutionReport.progress` 定为**可选**（`progress?: Progress | null`），`collectionSchema.progress` `.optional()`。既有的二十多处假 port 与 fake 二进制**一处都不改**。§3.2「其余实现补 `progress: null`」与 §7 最后一条作废。
- **R6 命令必须带 `expectedRevision`，成功会推进组的 `commandRevision` 与 `changeSeq`**（`webProtocol.ts` `rawCommandFields`、`commandLedger.ts`）。⇒ §3.1 的形状加 `expectedRevision`。后果照写：
  - 带着旧 `baseLabelsVersion` 的请求，通常先撞上 `revision-conflict`；L4 的「版本冲突」格要发**新** `expectedRevision` ＋ **旧** `baseLabelsVersion` 才量得到 `labels-version-conflict`。
  - 改一次标签会让同一组其他在飞命令（confirm、set-limit 等）的 `expectedRevision` 过期。这是所有命令的既有行为，UI 按现有方式重读后重试。
- **R7 新动词要改的地方**（§3.1 补全）：
  - 服务端：`webProtocol.ts` 的 `commandVerbSchema`、raw／effective 两个 union、`commandResultSchema`（新结果 `{ kind: "task-labels-set", taskId, labelsVersion }`）；`WebControlService` 新方法（照 `proposalSetAgent` 的写法）；`src/panel/controlApi.ts` 的路由表与分派。
  - 新错误码（`labels-version-conflict`、`labels-invalid`）要在 `errors.ts` 的 `durableCommandErrorStatuses` 里分类（那里有编译期的封闭性检查）。
  - Web：`web/src/controlApi.ts` 的 `ControlAction` 与 `controlCommandPath`、`web/src/controlTypes.ts`。
- **R8 词表校验放在 `apply` 里，不放在 payload 的 zod schema 里**：payload schema 解析失败会变成 `400 control-non-json-payload`，没有台账记录、也点不了名。⇒ raw payload 只查形状（`labels: z.array(z.string()).max(16)` 或 `null`）；词表、前缀、NFC 在 `apply` 里查，抛 `labels-invalid:<那一项>`。**target 用现有的 `{ kind: "task", groupId, taskId }`**（continue-task 在用），`payload` 里不再带 `taskId`。
- **R9 §4.1「不新增 HTTP 接口」与 §3.1 矛盾**：每个动词都有自己的 POST 路由。⇒ 改为「不新增 GET 接口；新增一个 POST `/api/control/groups/:groupId/tasks/:taskId/labels`」。
- **R10 「lineage 里最后一个」兜底是错的**：`lineageRunIds` 存储与视图都按字典序排（run id 是 `run-<uuid>`），最后一个不是最新的；而视图本来就要求有 run 时 `currentRunId` 非空且等于按 rowid 最新的那个。⇒ 「当前 run ＝ `currentRunId`，没有就是 `null`」，删掉兜底。
- **R11 `tokens` 的「未知」口径**（控制器定）：按 run 判，不按组判。`bucket = run.phase === "handoff" ? "handoff" : "work"`；`tokens = null` 当且仅当 `run.unknown[bucket]` 或 `run.breaches.length > 0`；否则是 `cumulative[bucket].tokens` / `grant[bucket].tokens`（grant ＝ used ＋ remaining）。**收到第一条用量事件之前是 0／grant**：这是 ccloop 在阶段结束才上报造成的，是真实的「尚未上报」，UI 在数字旁注明「阶段结束时上报」，不改成「未知」。
- **R12 web 导入时词会丢**：`readSchedulerControlPlanSource` 只拼接错误码，消息丢了。⇒ 控制器定：把 `malformed` 的消息带进 `control-plan-rejected` 的 detail（`control-plan-rejected:malformed:<消息>`），L3 两个入口都断言点名。若实施时发现这会改到既有判据的断言，退回「只在 `orca plan` 点名、导入只断言 `control-plan-rejected:malformed`」，并在台账记一行。
- **R13 E2E 要点名、不许被静默跳过**：真 ccloop 的 E2E 都是 `describe.skipIf(!process.env.ORCA_CCLOOP_BIN)`。⇒ 用 `tests/control/ccloopWorld.ts` 的世界，**单 task**，`delayMs.execute` 设成几拍驱动环以上，轮询 `readControlGroup` 直到看到 `step === "execute"`；结束后 `completion` 为 1/1。文件由计划定（优先加在 `executionDriverE2E.test.ts` 旁的新文件里，只加不改）。§5.4 的门补上：`ORCA_CCLOOP_BIN`／`ORCA_AGENTS_TABLE` 照 §三 的夹具设好、`npm run verify:control` 退 0，并从 json reporter 断言这条 E2E 的状态是 `passed` 而不是 `skipped`。

### 8.3 minor

- **R14 完成度**：`done` 数的是**视图映射后**状态为 `completed` 的 task（存储里是 `done`）；`total` 是存档 plan 的 `tasks` 数，**不是** `work_items` 行数（那里还有 `kind: "handoff"` 的行）。
- **R15 标签格式钉死**：长度按 **NFC 之后的 code point** 数，**不含** `custom:` 前缀；排序用 **code unit 序**（`a < b`，即 JS 默认 `.sort()`），不用 `localeCompare`；拒绝孤立代理（`canonicalBytes` 会抛）；系统词**区分大小写**（`Feature` 不是词表里的词，被拒）；前缀只认小写 `custom:`；16 个的上限在**去重之后**数。
- **R16 revert 与空集合**：revert 写成 `labels: null`（不再用另一种对象形状）。L4 的「`[]` 与 revert 是两种结果」格要用**plan 里有标签**的 task：plan 没有标签时，设 `[]` 等于当前生效值，按 §3.1 第 4 步是 no-op。
- **R17 ccloop 读 `loop-state.json` 要校验形状**：现在是 `JSON.parse(...) as RunState`。⇒ 形状不对（例如缺 `budgetSnapshot`）也报 `control-terminal-invalid`；`progress.status` 的枚举要含 `queued`／`planning`／`executing`／`verifying` 和五个终态（ccloop 现有 `terminalSchema` 只有终态五个）。
- **R18 字段名**：run 视图里已经有 `phase`（`estimate|work|handoff`）。⇒ 进度里的阶段改名为 **`step`**（`plan|execute|verify|queued|<终态>`）。`queued` 时尝试数显示 0/max（`currentAttempt` 从 0 起），UI 照实显示。
- **R19 §7 的具名清单与「必填还是可选」**（控制器定）：视图里的新字段（`completion`、`labels`／`labelsProvenance`／`labelsVersion`、`progress`）在线上 schema 里写成**可选**，服务端**总是给出**，另加一条新判据断言服务端总是给出。这样既有判据只加不改：
  - 不改：Orca `tests/control/webProtocol.test.ts`（整对象 `toEqual`）、`tests/panel/controlReadApi.test.ts`、`tests/control/webContinuation.test.ts`、web/tests 里 11 个带视图夹具的文件。
  - **仍然要人指名的**：ccloop `tests/control/agentsControl.test.ts` 两处 `toEqual({ events: [], candidate: null, terminal: null })`——ccloop 这边 `progress` 总是给出，这两条必然要改（加 `progress: null`）。实施前按 Rule 15(a) 报人。
  - `webParity` 若是按字段表逐项比对，加字段属于「加」，实施时现读确认。
