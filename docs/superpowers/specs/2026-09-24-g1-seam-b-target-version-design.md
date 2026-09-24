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

---

## 1. 问题

Web 派活到真 ccloop 时，`tests/control/webCcloopSmoke.test.ts` 的两条判据
（`the frozen dispatch envelope reaches a real process (task 10 step 4)` 下）报
`start-envelope-conflict:run:targetVersion`，拒点是 `src/control/startEnvelope.ts` 的 `startEnvelopeSourceSchema`
（`targetVersion: safeInteger`）。

### 1.1 根因（现测）

Orca 里有**两个同名的 `targetVersion`**，被 `planImport` 接成了一根线：

| | plan 里的 | 控制面里的 |
|---|---|---|
| 定义 | Web spec `2026-09-19-web-recoverable-control-design.md` §ControlPlanV1：「source plan 的**不透明**非空版本字符串，**不做数值转换**」，进 `planHash` | work item 的修订号：`src/control/commands.ts:61` 的 `(old?.targetVersion ?? 0) + 1`；`claimWork`／continuation／checkpoint 用它判 `target-version-conflict` |
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
1. 控制面里它是计数器，要 `+1`、要比新旧；字符串做不了。附带一处潜伏的坑：`"v1" + 1` 在 JS 里是 `"v11"`，不抛。
2. 线上已是整数且已定（§1.2）；统一成字符串要改 ccloop 线上契约并升版本。
3. 字符串那条路唯一的端到端消费（Web 派活）从未跑通 —— 那正是缝 B；存储列本来就是整数。
4. 人写 `targetVersion: 1` 的负担可忽略。

**最强的反方论证与回应**：Web spec 明文定为「不透明字符串、不做数值转换」，像是刻意留给人写 `"2026-q3"` 这类标签。
回应：spec 没写理由；全仓没有任何消费方用到它的「标签」含义（只哈希、比较、透传）；
真要标签应当**另开字段**，不该与冲突检测用的计数器同名 —— 同名正是缝 B 的根源。

### 2.2 语义：乙 —— plan 为权威，store 与之恒等

- plan 文件里的值是**≥ 1 的安全整数**，由人写；导入时**原样**落进 work item 的列与 body。
- **改修订号的唯一途径是人改 plan 并重新导入。**
- 前提（现测）：**Web 路径不 re-put。** `src/` 里写 `work_items` 的只有
  `planImport.ts:214`（INSERT）、`budget.ts:99`（reconcile 登记，写 `1`）、`commands.ts:62`（`putWork`）、
  `queries.ts:47`（`saveWork`，只改 body）、`webService.ts:209,417`（只改 `status`／`grant`／`derivedContractHash` 等，**不碰 `targetVersion`**）；
  **`putWork` 在 `src/` 里零调用方**（只在 `tests/` 与 foundation 旧路径上）。
- `putWork` 的 `+1` **不动、不接进 Web 路径**。

⚠️ 下界取 1 而线上 `safeInteger` 允许 0：plan 侧**更严**是有意的（store 计数从 1 起），线上不收紧。

---

## 3. 改动面（全在 Orca）

| 位置 | 现在 | 改成 |
|---|---|---|
| `src/scheduler/planFile.ts` `PlanTask.targetVersion`、`SchedulerControlPlanSource.tasks[].targetVersion` | `string` | `number` |
| `src/scheduler/planFile.ts` `planTaskSchema.targetVersion` | `z.string().min(1).optional()` | 正安全整数（≥1，≤`MAX_SAFE_INTEGER`），仍 `optional()` |
| `src/control/webProtocol.ts` ControlPlanV1 的 `tasks[].targetVersion` | `nonemptyString` | 正安全整数 |
| `src/control/webProtocol.ts` `workItemViewSchema.targetVersion` | `nonemptyString` | 正安全整数 |
| `src/control/planImport.ts:214` | 列写死 `1` | 列写 `task.targetVersion` |
| `src/panel/controlViews.ts:61,112` | `z.union([z.string().min(1), safeInteger])` | 只收安全整数 |
| `src/panel/controlViews.ts:388,488` | `String(a) !== String(b)` | `a !== b` |
| `web/src/controlTypes.ts:78` | `targetVersion: string` | `targetVersion: number` |
| Web spec（已发布） | 「nonempty opaque version string … not numerically coerced」、`WorkItemViewV1.targetVersion: string` | **原文不动，文末追加具名更正**（指向本文） |

**不改**：ccloop 任何文件；`commands.ts` 的 `putWork`；`budget.ts:99`；`startEnvelope.ts`（它已是 `safeInteger`，本来就对）；
`web/src/**/*.tsx`（现测不展示 `targetVersion`）。

⚠️ 正安全整数的 schema **优先复用** `src/control/schema.ts` 的 `safeInteger` 加 `.positive()`；
`planFile.ts` 在 `src/scheduler/` —— 它能不能 import `src/control/schema.ts` 而不造成运行期 ESM 环，**计划阶段现测**
（G1 缝 A 在 `webProtocol.ts`↔`schema.ts` 上栽过 TDZ，`typecheck` 看不出）。

### 3.1 副作用

- **同一份 plan 的 `planHash` 会变**（规范化 JSON 里 `"v1"` → `1`）。
  存量：`~/.orca/control` 现测为空目录 ⇒ 本机无需迁移。**目标仓库里的 plan 无法从这里枚举**，写了字符串的会被拒收（§3.2），**不静默转换**。
- 拒收的名字**沿用现有路径，不新造**：
  - `loadPlan` → `code: "malformed"`，`message` 以 `tasks.<i>.targetVersion:` 开头；
  - 控制面导入（`readSchedulerControlPlanSource`）→ `ControlError("control-plan-rejected", "malformed")`
    —— ⚠️ **这条路径上 detail 只有码、没有字段名**（`planFile.ts:229` 只 join `code`）。这是既有行为，**本轮不改**，登记为已知的诊断粒度缺口。

---

## 4. 判据

### 4.1 成功判据（命令，0／非 0）

env ＝ Orca handoff §8.2（`ORCA_CCLOOP_BIN` ＝ ccloop main 的 `clone --local` ＋ build；`ORCA_CCLOOP_ADAPTER_CONFIG` 指向 fake codex，`/private/tmp/…`，0600）。

1. `npm run typecheck` ⇒ RC 0。
2. `npm run verify:control` ⇒ **RC 0，0 skipped，`webCcloopSmoke` 5/5 通过**。
   handoff §三 预定的「44 文件／436 通过」是**改动前**的计数；新增判据会让两个数都变大，
   ⇒ 判据**不含**具体条数，条数与文件数按实测报（应 ≥ 44／≥ 436）。
3. `./node_modules/.bin/vitest run --reporter=json` 的失败集合 ⊆ { 已登记 flake `controlShutdown … a real SIGTERM to a real panel …` }。
4. 其余门（scheduler／chain／web build／panel／ws／claude-md-lines／hooks-path）RC 0；ledger validate RC ∈ {0,2}。
   **逐段单跑**（`npm run verify` 的 `&&` 链会停）。

### 4.2 新增判据（只加不改）

| # | 判据 | 喂它的场景 | 点名的变异（必须**看见红**） |
|---|---|---|---|
| N1 | plan 里 `targetVersion: "v1"` ⇒ `loadPlan` 拒，`malformed`，message 以 `tasks.0.targetVersion:` 开头 | 单任务 plan | V1：`planTaskSchema.targetVersion` 改回 `z.string().min(1)` |
| N2 | plan 里 `targetVersion: 0` ⇒ 拒；`1.5` ⇒ 拒 | 同上 | V2：去掉 `.positive()`（只剩 nonnegative）；V2b：去掉 `.int()` |
| N3 | plan 写 `targetVersion: 3` 导入后，`work_items.target_version` 列 **与** body 都等于 `3` | 用 **3**（≠1），专打「列写死 1」 | V3：`planImport.ts:214` 列改回字面量 `1` |
| N4 | N3 的导入物走到 Web 派活，start envelope 的 `claim.targetVersion === 3` | 同 N3，经 `webDispatch` | V4：`webDispatch.ts:281` 的 `work.targetVersion` 换成字面量 `1` |
| N5 | work body 里 `targetVersion` 为字符串 ⇒ panel 视图 `blocked("work-item-invalid:…")` | 直接改库里的 body | V5：`controlViews.ts:61` 恢复 union |
| N6 | work body 的 `targetVersion` 与 plan 不等（整数 2 vs 3）⇒ `blocked("work-item-authority:…")` | 直接改库里的 body | V6：删掉 `:388` 的 `targetVersion` 子句 |
| N7 | `ControlPlanV1` 与 `WorkItemViewV1` 对字符串 `targetVersion` 拒收 | 直接对 schema 断言 | V7／V7b：两处 schema 各改回 `nonemptyString` |

⚠️ **每一条「红在 N_k」都是预言，不是证据**（handoff §六.3）。实施后逐条在 `git clone --local` 副本里打，
**先跑出绿基线**，变异落上去用 `shasum -a 256` 前后比，写成「红在 X 且仅 X」或「红在 X 与 Y」，不留「至少」。
⚠️ **V6 可能被遮蔽**：若别的子句（如 body schema、`configHash`）先拦，N6 就不是 `:388` 那一子句的独占判据 —— 实施时量，量不出就补独占场景或登记为冗余守卫，**不编假判据**。
⚠️ `:488`（run 与 work 比）是否需要独占判据：**计划阶段现测**有没有场景只有它能拦。

### 4.3 需人按人裁 88 指名改写的既有判据

下列位置写着字符串 `targetVersion`，统一后**必然**过不了 schema，要**整条改写成整数**（不许放宽）：

| 文件 | 行 | 形状 |
|---|---|---|
| `tests/control/fixtures/web.ts` | 22、48 | 夹具类型 `targetVersion?: string`、默认 `"v1"` —— **被多个测试文件共享** |
| `tests/panel/fixtures/controlPanel.ts` | 97 | 夹具 plan `"v1"` |
| `tests/control/planImport.test.ts` | 68、69 | helper 内 `"v2"`／`"v1"` |
| `tests/control/executionSnapshot.test.ts` | 27 | helper 内 `"v1"` |
| `tests/control/webProtocol.test.ts` | 116、124（`validates normalized plans and rejects unsorted or duplicate sets`）、396（`enforces canonical group allocation ownership and command revision nullability`） | 字面 `"v1"` |
| `tests/panel/controlReadApi.test.ts` | 88、89 | helper 内 `"v2"`／`"v1"` |

⚠️ 本表由 python 逐行扫得；helper 被哪些 `it` 消费，**计划阶段给出逐条 `it` 清单**供人逐条指名（本轮用正则定位 helper 不准，未采信）。
⚠️ 两个夹具是共享的：改它们会改变**所有**消费者喂进去的值（`"v1"` → `1`）。计划阶段列出消费者文件清单。

---

## 5. 不做的（本轮范围外）

- 生产 execution profile 快照、`ContextObservationV1` 生产者、`capabilities` 计算化 —— 都排在缝 B 之后，另开。
- 控制面导入拒收 detail 不带字段名（§3.1）—— 登记，不修。
- `putWork` 的 `+1` 与 Web 路径的关系 —— 今天不可达（§2.2），不设计。
- `controlShutdown` 偶发红 —— 已登记在 handoff §三，根因未查。

## 6. 发布面与更正

- Web spec（已发布）：**文末追加**一节具名更正（「ERRATUM (G1 seam B, 2026-09-24)」），点名被推翻的两句，指向本文；**原文逐字保留**。
- ccloop G1 spec §9「缝 B 与 `planFile.ts` 是同一件事，要么一起做、要么一起不做」—— **本设计与之一致**（一起做），**不需要更正**。
- Orca handoff §4.2／§4.3 在实施收口时滚动更新。
