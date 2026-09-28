# Task 标签 ＋ 内部进度（goal.md N8 ＋ N3）设计

> 会话 `2724716d`，2026-09-28。出处：`docs/handoff/goal.md` §10 的 N8、N3，§10.1 排第 1；人裁 G4、G11（§10.2）。
> 本文的每一条人裁都是人在本会话里逐条拍的，原话见 §1。

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
