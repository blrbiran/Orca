# G1 缝 B：`targetVersion` 统一为安全整数 —— 设计

> **归属**：Orca 控制器会话 `ae4061a5`，2026-09-24。
> **人裁（本会话，原话或逐节点头）**：
> - 「开缝 B」；
> - 「同意 主方向是统一成整数」；
> - 语义取**乙**（plan 为权威，store 与之恒等）、改动面、判据三节「都同意」。
>
> **观测锚点**：本文所有行号与现测均在主题行
> `docs(handoff): register the controlShutdown SIGTERM flake, mark the push done, open seam B` 那一笔上量得。
> **行号会移动 ⇒ 引用前现测。**
>
> **评审**：同会话派一席独立评审（只读，工具报数 207,573 token／61 次工具调用），报告在会话 scratchpad `seamb-review.md`（**不入库**）。
> 它的 1 Critical／6 Important／7 Minor **由控制器逐条现测复核后**并入本文；transcript 已扫，除写报告外零写入、零进程操作。

---

## 1. 问题

`tests/control/webCcloopSmoke.test.ts` 的两条判据
（`the frozen dispatch envelope reaches a real process (task 10 step 4)` 下）报
`start-envelope-conflict:run:targetVersion`，拒点是 `src/control/startEnvelope.ts` 的 `toStartEnvelope` 里的
`startEnvelopeSourceSchema`（`targetVersion: safeInteger`）。
⚠️ 精确路径：这两条的 worker 是 fake（`tests/control/fixtures/fake-ccloop-control.mjs`），**在 `toStartEnvelope` 里就被拒、没起进程**；
冻结的 `DispatchEnvelopeV1` 里**没有** `targetVersion`，字符串是从 **run 行**（`webDispatch.ts:281` 由 work body 抄来）进来的。

### 1.0 🔴 缝 B 是必要条件，不是充分条件（现测）

生产代码里**没有任何一处**把 Web 派活推到 ccloop 的 `accept`：

| 函数 | `src/`＋`scripts/` 里的调用方 | `tests/` 里的调用行 |
|---|---|---|
| `createStartingRun`（写 `starting` run ＋ `work-claim` outbox） | `webDispatch.ts:193,227,252` | 0 |
| `beginProviderAttempt`（申领一次执行尝试，读 `work-claim`） | **0**（`:358` 是定义） | 5 |
| `toStartEnvelope`（造发给 ccloop 的 start envelope） | **0**（`startEnvelope.ts:53` 是定义） | 9 |

（python 逐行扫 `\bname\(`。）⇒ **本设计做完，`webCcloopSmoke` 会绿（测试自己手调 `toStartEnvelope`），
但生产里 run 停在 `starting` 之后仍无东西驱动 `accept`。** 这条「执行驱动缺口」**不在本设计范围内**（§5），
**任何地方不许把缝 B 的回绿表述成「Web 派活能跑到 ccloop」。**

### 1.1 根因（现测）

Orca 里有**两个同名的 `targetVersion`**，被 `planImport` 接成了一根线：

| | plan 里的 | 控制面里的 |
|---|---|---|
| 定义 | Web spec `2026-09-19-web-recoverable-control-design.md` §4.2 Atomic plan import 的 `ControlPlanV1` 定义：「source plan 的**不透明**非空版本字符串，**不做数值转换**」，进 `planHash` | work item 的修订号：`src/control/commands.ts:61` 的 `(old?.targetVersion ?? 0) + 1`；`claimWork`（`budget.ts:103`）与 continuation（`continuation.ts:35`）用它判 `target-version-conflict`；checkpoint 用它做身份比对（`checkpoints.ts:22,124`） |
| 类型 | `string`（夹具里是 `"v1"`／`"v2"`） | 整数（`work_items.target_version INTEGER NOT NULL`） |

`src/control/planImport.ts:214` 写 work item 时，**列**写死 `1`，**body** 的 `targetVersion` 写 plan 的字符串。
Web 派活（`src/control/webDispatch.ts:281`）从 body 取 ⇒ `"v1"` 进 envelope ⇒ 被拒。
`src/panel/controlViews.ts:61,112` 的 `z.union([string, safeInteger])` 与 `:388,488` 的 `String()` 比较是这条裂缝上的胶布
（G1 spec §9 已如此定性）。

### 1.2 已定、不重开的

- **线上 `targetVersion` ＝ 安全整数。** ccloop `src/control/protocol.ts`／`handoff.ts`／`command.ts` 全是 `safeInteger`／`number`
  （Orca handoff §4.3）。⇒ **本设计 ccloop 零改动，control protocol 不升版本。**

---

## 2. 决定

### 2.1 统一成一个概念，类型是安全整数

`targetVersion` 在 Orca 全链路是**同一个值**：**该任务的修订号，安全整数**。
plan 文件 → `ControlPlanV1` → work item（列与 body）→ `WorkItemViewV1` → claim／run → start envelope → ccloop。

**为什么是整数不是字符串**（按分量排）：
1. **线上已是整数且已定**（§1.2）；统一成字符串要改 ccloop 线上契约并升版本。
2. 控制面里读它的地方（`budget.ts`、`continuation.ts`、`checkpoints.ts`、`service.ts`）**全部按整数类型写**；
   ⚠️ 但它们对它**只做 `===`／`!==`，没有任何大小比较**（现测），唯一的 `+1` 在 `putWork`（生产零调用方）。
   ⇒ 「它是要做算术的计数器」**不是**今天的事实，**不作为理由**。附带的坑仍在：`"v1" + 1` 在 JS 里是 `"v11"`，不抛。
3. 字符串那条路唯一的端到端消费（Web 派活）从未跑通 —— 那正是缝 B；存储列本来就是整数。
4. 人写 `targetVersion: 1` 的负担可忽略。

**最强的反方论证与回应**：Web spec 明文定为「不透明字符串、不做数值转换」，像是刻意留给人写 `"2026-q3"` 这类标签。
回应：spec 没写理由；全仓没有任何消费方用到它的「标签」含义（只哈希、比较、透传）；
真要标签应当**另开字段**，不该与冲突检测用的计数器同名 —— 同名正是缝 B 的根源。

### 2.2 语义：乙 —— plan 为权威，store 与之恒等

- plan 文件里的值是**≥ 1 的安全整数**，由人写；导入时**原样**落进 work item 的列与 body。
- **`targetVersion` 在一个 group 的生命期内是常量。** 重新导入**永远新建 group**：Web spec §4.2 原文
  「V1 re-import always uses `import-plan` with a new caller-supplied `groupId`; it never mutates the snapshot of an existing group」；
  UI 每次生成新 `groupId`；导入用 `expectedRevision: 0`。
  ⇒ 要换修订号 ＝ 人改 plan、**以新 `groupId` 导入一个新 group**。**不存在「就地改修订号」这条路**，本设计也不造。
  ⚠️ 用**同一个** `groupId` 重导：评审席读码称会在 `commandLedger.ts:251` 得 `revision-conflict` 或在 `planImport.ts:203` 撞主键（SQLite 原生错误，无具名拒收）——
  **控制器未复核、HTTP 层表现未追**；与本设计无关，登记于 §5。
- 前提（现测）：**Web 路径不 re-put。** `src/` 里写 `work_items` 的只有
  `planImport.ts:214`（INSERT）、`budget.ts:99`（reconcile 登记，写 `1`）、`commands.ts:62`（`putWork`）、
  `queries.ts:47`（`saveWork`，只改 body）、`webService.ts:209,417`（只改 `status`／`grant`／`derivedContractHash` 等，**不碰 `targetVersion`**）；
  **`putWork` 在 `src/` 里零调用方**（只有 `tests/` 调它）。
- `putWork` 的 `+1` **不动、不接进 Web 路径**。

⚠️ 下界取 1 而线上 `safeInteger` 允许 0：plan 侧**更严**是有意的（store 计数从 1 起），线上不收紧。

---

## 3. 改动面（全在 Orca）

| 位置 | 现在 | 改成 |
|---|---|---|
| `src/scheduler/planFile.ts` `PlanTask.targetVersion`、`SchedulerControlPlanSource.tasks[].targetVersion` | `string` | `number` |
| `src/scheduler/planFile.ts` `planTaskSchema.targetVersion` | `z.string().min(1).optional()` | 正安全整数（≥1，≤`MAX_SAFE_INTEGER`），仍 `optional()` |
| `src/control/webProtocol.ts` ControlPlanV1 的 `tasks[].targetVersion` | `nonemptyString` | 本文件已有的 `positiveSafeInteger`（`:6`，＝`safeInteger.positive()`） |
| `src/control/webProtocol.ts` `workItemViewSchema.targetVersion` | `nonemptyString` | `positiveSafeInteger` |
| `src/control/planImport.ts:214` | 列写死 `1` | 列写 `task.targetVersion` |
| `src/panel/controlViews.ts:61,112` | `z.union([z.string().min(1), safeInteger])` | 只收安全整数 |
| `src/panel/controlViews.ts:388,488` | `String(a) !== String(b)` | `a !== b` |
| `web/src/controlTypes.ts:78` | `targetVersion: string` | `targetVersion: number` |
| Web spec（已发布） | 三处：`:499` `WorkItemViewV1.targetVersion: string`、`:621` `ControlPlanV1.tasks[].targetVersion: string`、`:629`「nonempty opaque version string … not numerically coerced」 | **原文不动，文末追加具名更正**（指向本文） |

**不改**：ccloop 任何文件；`commands.ts` 的 `putWork`；`budget.ts:99`；`startEnvelope.ts`（它已是 `safeInteger`，本来就对）；
`web/src/**/*.tsx`（现测不展示 `targetVersion`）。

⚠️ `planFile.ts` 侧的 schema **复用** `src/control/schema.ts` 的 `safeInteger` 加 `.positive()`（不 import `webProtocol.ts`，那里的 `positiveSafeInteger` 同义）。
**不会造成 ESM 环（现测）**：`schema.ts` 的 import 只有 `zod`；`planFile.ts` 本来就 import `../control/canonicalJson.js` 与 `../control/errors.js`。
（G1 缝 A 栽过的 TDZ 是 `webProtocol.ts`↔`schema.ts` 互引，此处没有反向边。）

**读同一个 body 字段、本来就按整数写的消费者 —— 不改，统一后自动一致**：
`budget.ts:90`（`safeInteger.parse(targetVersion)`）与 `:103`、`continuation.ts:35`、`checkpoints.ts:22,124`、
`service.ts:98,99,151,172`（旧 `ControlService`；`:151` 在 `requestHandoff` 里）、`schedulerBridge.ts:25,29`、`ownership.ts:9`、
`controlViews.ts:411`（视图从 plan 取值）、`handoff.ts:10,13`、`webService.ts:290`（estimate 用自己的 `estimateVersion`）。

### 3.1 副作用

- **同一份 plan 的 `planHash` 会变**（规范化 JSON 里 `"v1"` → `1`）。
  存量：`~/.orca/control` 现测为空目录 ⇒ 本机无需迁移。**目标仓库里的 plan 无法从这里枚举**，写了字符串的会被拒收（§3.2），**不静默转换**。
- 🔴 **调度路径也会被波及**：`loadPlan` 还被 `src/scheduler/run.ts:158`（`orca run`）调用，而那条路**从不读** `targetVersion`。
  今天写了字符串 `targetVersion` 的 plan 在 `orca run` 下能跑，改完**会被 `malformed` 拒**。`tests/scheduler/**` 里没有任何 `targetVersion`
  ⇒ **没有既有判据会暴露这个变化**；N1 在 `loadPlan` 这一层钉住它（两条路共用）。
- `work_items.target_version` **列只写不读**（全仓 python 扫：只有 `migrations.ts:6` 建表、`planImport.ts:214`／`commands.ts:62` 写）。
  ⇒ 改它是为了**列与 body 不再说两个值**，**没有行为消费者**；N3 守的是数据一致性，不是行为。
- 拒收的名字**沿用现有路径，不新造**：
  - `loadPlan` → `code: "malformed"`，`message` 以 `tasks.<i>.targetVersion:` 开头；
  - 控制面导入（`readSchedulerControlPlanSource`）→ `ControlError("control-plan-rejected", "malformed")`
    —— ⚠️ **这条路径上 detail 只有码、没有字段名**（`planFile.ts:229` 只 join `code`）。这是既有行为，**本轮不改**，登记为已知的诊断粒度缺口。

---

## 4. 判据

### 4.1 成功判据（命令，0／非 0）

env ＝ Orca handoff §8.2（`ORCA_CCLOOP_BIN` ＝ ccloop main 的 `clone --local` ＋ build；`ORCA_CCLOOP_ADAPTER_CONFIG` 指向 fake codex，`/private/tmp/…`，0600）。

1. `npm run typecheck` ⇒ RC 0。
2. `npm run verify:control` ⇒ RC 0。
3. **机械判定器**（计划阶段写，放会话 scratchpad，**不入库**）：`./node_modules/.bin/vitest run --reporter=json --outputFile=<json>` 后，
   python 读 `<json>`，**全部满足才退 0**：`numPendingTests == 0` 且 `numTodoTests == 0`；
   `tests/control/webCcloopSmoke.test.ts` 的断言结果 **5 条全 `passed`**；失败断言的 `fullName` 集合 ⊆ { 已登记 flake
   `a real SIGTERM to a real panel makes it exit cleanly, having written one shutdown row for its epoch` }。
   ⚠️ **判定器本身要先被看见红**：在**改动前**的树上跑它必须退非 0（那时 smoke 有 2 条红）。
   handoff §三 的「44 文件／436 通过」是改动前计数，新增判据会让它变大 ⇒ **判据不含条数**，条数按实测报。
4. 其余门（scheduler／chain／web build／panel／ws／claude-md-lines／hooks-path）RC 0；ledger validate RC ∈ {0,2}。
   **逐段单跑**（`npm run verify` 的 `&&` 链会停）。

### 4.2 新增判据（只加不改）

| # | 判据 | 喂它的场景 | 点名的变异（必须**看见红**） |
|---|---|---|---|
| N1 | plan 里 `targetVersion: "v1"` ⇒ `loadPlan` 拒，`malformed`，message 以 `tasks.0.targetVersion:` 开头 | 单任务 plan | V1：`planTaskSchema.targetVersion` 改回 `z.string().min(1)` |
| N2 | plan 里 `targetVersion: 0` ⇒ 拒；`1.5` ⇒ 拒 | 同上 | V2：去掉 `.positive()`（只剩 nonnegative）；V2b：plan 侧 schema 就地换成 `z.number().positive()`（丢 `.int()`）—— ⚠️ **不许去改共享的 `schema.ts` 的 `safeInteger`**，那会同时打到全仓消费者，红了也不是 N2 的独占证据 |
| N3 | plan 写 `targetVersion: 3` 导入后，`work_items.target_version` 列 **与** body 都等于 `3` | 用 **3**（≠1），专打「列写死 1」 | V3：`planImport.ts:214` 列改回字面量 `1` |
| N4 | N3 的导入物经 `deliverScheduledStart`→`createStartingRun` 落成 run 行，run 行 `targetVersion === 3`，再**直接调** `toStartEnvelope`（生产零调用方，§1.0）得 `claim.targetVersion === 3`；**不读群视图** | 同 N3，走 `webFixture` 的 confirm→start 路径 | V4：`webDispatch.ts:281` 的 `work.targetVersion` 换成字面量 `1` |
| N5 | work body 里 `targetVersion` 为字符串 ⇒ panel 视图抛 `ControlError("recovery-blocked")`，detail 以 `work-item-invalid:<taskId>:` 开头（`controlViews.ts` 的 `parseStored`→`blocked`） | 直接改库里的 body | V5：`controlViews.ts:61` 恢复 union |
| N6 | work body 的 `targetVersion` 与 plan 不等（整数 2 vs 3）⇒ 抛 `ControlError("recovery-blocked")`，detail ＝ `work-item-authority:<taskId>` | 直接改库里的 body | V6：删掉 `:388` 的 `targetVersion` 子句 |
| N7 | `ControlPlanV1` 与 `WorkItemViewV1` 对字符串 `targetVersion` 拒收 | 直接对 schema 断言 | V7／V7b：两处 schema 各改回 `nonemptyString` |

⚠️ **每一条「红在 N_k」都是预言，不是证据**（handoff §六.3）。实施后逐条在 `git clone --local` 副本里打，
**先跑出绿基线**，变异落上去用 `shasum -a 256` 前后比，写成「红在 X 且仅 X」或「红在 X 与 Y」，不留「至少」。
| N8 | run body 里 `targetVersion` 为字符串 ⇒ 抛 `ControlError("recovery-blocked")`，detail 以 `run-invalid:<runId>:` 开头（`controlViews.ts:457`） | 直接改库里的 run body | V8：`controlViews.ts:112` 恢复 union |
| N9 | 已派活的 group，work body `3`、run body `2` ⇒ 抛 `ControlError("recovery-blocked")`，detail ＝ `run-work-identity:<runId>` | 直接改库里的 run body | V9：删掉 `:488` 的 `targetVersion` 子句 |

⚠️ **N5 必须断言 detail 前缀 `work-item-invalid:`，不许只断言 code** —— 只断言 `recovery-blocked` 时，V5（恢复 union）后
`:388` 会以 `work-item-authority` 照样拦下，N5 **空绿**（评审席读码预言，实施时量）。
⚠️ **N9 的独占性**（评审席读码）：`workViews` 先于 `runViews`，`:459-461`／`:465-468` 不看 `targetVersion` ⇒ 只有 `:488` 能拦。实施时量。
⚠️ **N7 的守卫在导入路径上被 `planTaskSchema` 挡在前面**；`ControlPlanV1` schema 真正承重的地方是读回存档 plan 的 `readArchivedPlan`（`queries.ts:107`）
⇒ N7 **直接对 schema 断言**是对的，别改成走导入路径。
⚠️ **V6 可能被遮蔽**：若别的子句（如 body schema、`configHash`）先拦，N6 就不是 `:388` 那一子句的独占判据 —— 实施时量，量不出就补独占场景或登记为冗余守卫，**不编假判据**。

### 4.3 需人按人裁 88 指名改写的既有判据

下列位置写着字符串 `targetVersion`，统一后**会过不了 schema／typecheck，或变成空绿**，要**整条改写成整数**（不许放宽）：

| 文件 | 行 | 形状 |
|---|---|---|
| `tests/control/fixtures/web.ts` | 22、48 | 夹具类型 `targetVersion?: string`、默认 `"v1"` —— **被多个测试文件共享** |
| `tests/panel/fixtures/controlPanel.ts` | 97 | 夹具 plan `"v1"` |
| `tests/control/planImport.test.ts` | 68、69 | helper 内 `"v2"`／`"v1"` |
| `tests/control/executionSnapshot.test.ts` | 27 | helper 内 `"v1"` |
| `tests/control/webProtocol.test.ts` | 116、124（`validates normalized plans and rejects unsorted or duplicate sets`）、396（`enforces canonical group allocation ownership and command revision nullability`） | 字面 `"v1"` |
| `tests/panel/controlReadApi.test.ts` | 88、89 | helper 内 `"v2"`／`"v1"` |
| `web/tests/controlPanel.test.tsx` | 48、49 | `GroupViewV1` 夹具里 `targetVersion: "1"` —— **ws 门的 `tsc --noEmit` 会报错**（`web/tsconfig.json` 含 `tests/**/*.tsx`） |
| `web/tests/evidenceLink.test.tsx` | 54 | 同上 |
| `web/tests/controlCommandRecovery.test.tsx` | 62 | 同上 |

⚠️ 本表由 python 逐行扫得；helper 被哪些 `it` 消费，**计划阶段给出逐条 `it` 清单**供人逐条指名（本轮用正则定位 helper 不准，未采信）。
🔴 **本表第一版漏了 `web/tests/**` 三个文件**（扫描范围只到 `tests/**`＋`web/src/**`，模式 `"v\d"` 也匹配不到 `"1"`）——评审席 C1。
现为**全仓扫描**（python，排除 `node_modules`／`.git`／`.superpowers`／`docs`／`dist`／`.orca`，扩展名 `.ts .tsx .mjs .js .json`，
模式 `targetVersion"?\s*:\s*["'`]` 或 `targetVersion?:\s*string`）：命中即上表全部加 `src/scheduler/planFile.ts:13,35`、`web/src/controlTypes.ts:78`，**无其他**。
（`tests/control/fixtures/web.ts:48` 的 `?? "v1"` 不在该模式内，已单列。）
🔴 **不会红、只会空绿的**（评审席 I3，控制器现读确认形状）：`tests/control/planImport.test.ts:330-345`（`it.each`：
`rejects %s and leaves the group completely absent` 三格）与 `:347-355`（`rejects a contract outside the closed ccloop V1 schema`）
只断言「有 error」／`control-plan-rejected`。helper 若保留 `"v1"`，`loadPlan` 会先以 `malformed` 拒，**这 4 条照绿但已不在测它们声称的东西**。
⇒ **不能靠「改完看哪些红」找改写点**；helper 必须改，且这 4 条要在改后被**看见**以各自的理由拒收（实施时量）。
⚠️ `.superpowers/sdd/2026-09-19-web-recoverable-control/artifacts/api-fixtures.json` 含 `"targetVersion": "v1"`，**无引用、Rule 13 不改**。
⚠️ 反向扫过（行里有 `"v<数字>"` 但没有 `targetVersion` 一词）：`tests/**` 与 `web/src/**` 只命中 4 处 `base: "v1"`（`startEnvelope.test.ts:44,60`、`webCcloopSmoke.test.ts:79,205`），那是 git base ref，**与本设计无关，不改**。
⚠️ 两个夹具是共享的：改它们会改变**所有**消费者喂进去的值（`"v1"` → `1`）。计划阶段列出消费者文件清单。

---

## 5. 不做的（本轮范围外）

- 🔴 **执行驱动缺口（§1.0）**：生产里没有东西调 `beginProviderAttempt`／`toStartEnvelope` 去驱动 ccloop `accept`。**要人决定何时开。**
- 生产 execution profile 快照、`ContextObservationV1` 生产者、`capabilities` 计算化 —— 都排在缝 B 之后，另开。
- 同 `groupId` 重导的错误形状（§2.2，评审席读码、控制器未复核）—— 登记，不修。
- 控制面导入拒收 detail 不带字段名（§3.1）—— 登记，不修。
- `putWork` 的 `+1` 与 Web 路径的关系 —— 今天不可达（§2.2），不设计。
- `controlShutdown` 偶发红 —— 已登记在 handoff §三，根因未查。

## 6. 发布面与更正

- Web spec（已发布）：**文末追加**一节具名更正（「ERRATUM (G1 seam B, 2026-09-24)」），点名被推翻的两句，指向本文；**原文逐字保留**。
- ccloop G1 spec §9「缝 B 与 `planFile.ts` 是同一件事，要么一起做、要么一起不做」—— **本设计与之一致**（一起做），**不需要更正**。
- Orca handoff §4.2／§4.3 在实施收口时滚动更新。
