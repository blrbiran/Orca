# 子系统 B 的入口条件：`corrections` 与 `overturned` 的字段形状

**归属**：run `orca-dev-c1c3c2ec`，2026-09-05。
**观测锚点**：本文所有实测值均观测于 Orca 本地 `7fe3ca8`（ccloop `cb43654`、ccmem `0de437e`），
每条都带测量命令。⚠️ **行号与计数引用前必须现测** —— 它们会移动。

---

## 0. 本文定什么、不定什么

**定**：两个数据形状 —— 台账事件 `overturned`，以及 DB 侧记录 `corrections`。
**不定**：ccmem 的写入路径、面板（子系统 E）、索引器、DB 本身。

⚠️ **为什么这是 B 的第一件事而不是写代码**：B 要吃的是 `corrections` 里 `kind = not_my_taste` 的对照样本
（A′ §8）。**那个样本的形状至今没有定义。** 而 `overturned` 住在只追加的台账里 ——
*** **格式错过就永远补不上。** *** P1 为 `bound` 付过一次这个代价（打红 12 条既有判据、
两条承重判据要人指名改写、A′ §3.3 的逐字示例被判 downgraded）。

---

## 1. 五条已裁决的分叉（人 2026-09-05 当面逐条拍板）

> ⚠️ **本节只有设计阶段那五条。** 复审阶段人另裁了三条（解析域必填、`chose_instead` 只对
> `not_my_taste` 必填、授权改写一条既有判据）—— *** **它们在 §11，不在本表。** ***

| # | 问题 | 裁决 | 被否掉的那条的代价 |
|---|---|---|---|
| **1** | `corrections` 住哪 | **只住 DB**，照 A′ §4.1 原文。台账侧只动 `overturned` | 「双写进台账」要推翻 A′ §4.1 已经权衡过的那条不对称，且引入一份会与 DB 漂移的副本 |
| **2** | 本轮交付边界 | **两个都定，但严格度分两档**：`overturned` 进 `src/ledger/`，必填 ＋ 逐字段变异；`corrections` 只出 zod schema，明写「DB 侧、可迁移、本轮不承诺终局」 | 只定 `overturned` 会把 `correctionId` 指向一个形状未知的东西 |
| **3** | `overturned` 要不要抄「人改成了什么」进 git | **不抄（瘦事件）** | 抄了就是在只追加的文件里种第二份副本，**永远改不回来**。P2 刚专门开过一格做「三处副本收敛」 |
| **4** | 检查 5 挡住了 `overturned` 的唯一真实用例 | **按事件类型分档**：`bound` 文件内，`superseded`/`overturned` **目录级** | 让 fix agent 写回原 run 的文件会**直接推翻 A′ §3.7 的无冲突保证**（每个 agent 只写自己那个文件） |
| **5** | `overturned` 的合法来源 | **只有面板 correction 一种，`correctionId` 必填** | 加 `source` 判别字段会**当场污染 A′ §4.4 的修复率口径**（分母是 DB 的 corrections，分子会多出没有对应 correction 的行） |

### 1.1 第 5 条的代价，不粉饰

**本轮定的 `overturned` 形状，在子系统 E（面板）落地之前没有任何真实写入方。**
能给的保证只有三条：**零存量**（实测 0 条，见 §2.1）＋ **构造样本判据** ＋ **每条必填字段一条点名变异**。
*** **「它在真实使用中是对的」这句话，本轮证不出来。** *** 人已知悉并选择接受。

### 1.2 非 git 工作目录：裁决甲，逃生门乙

人 2026-09-05 当面裁决：**默认走甲（非 git 目标 ⇒ 具名拒绝）；只有在有人强需求时才走乙。**

| | 内容 |
|---|---|
| **甲（默认，本轮登记给 C）** | 加一条具名检查码 `target-not-a-git-repo`，让它成为**一条独立的、被点名的拒绝**，而不是三条既有检查各自的副作用 |
| **乙（逃生门，未实现）** | 允许非 git 目标，但**必须整套一起做**：① 强制串行 ② **强制每条决策降级 Tier 0**（A′ §1.1.1：`undo.how` 不可执行 ⇒ 降级）③ 报告里明示「只追加闸门缺失、无回滚、无冲突检测」 |

⚠️ *** **乙若被做成半个版本（只加串行、不做 Tier 0 降级），是三条路里最坏的一条** *** ——
它把风险藏起来，而不是消除或披露风险。**这句话是本节存在的唯一理由。**

**为什么「改成串行」本身不够**（六条，每条都有出处）：

| # | 没了 git 就没了什么 | 串行救得了吗 |
|---|---|---|
| 1 | **隔离**：`ccloopRunner.ts` 靠 `git clone --local` 给每个任务开副本 | 只救一半 —— 救不了「上一个任务写坏了回不去」 |
| 2 | **落地与冲突检测**：`land.ts` 靠 `git merge --ff-only` | 否 |
| 3 | **回滚**：`undoExecutable.ts` 认的就是 `git checkout <sha> -- path` 这个形状 | 否 ⇒ 每条决策都该降 Tier 0，那已不是「串行跑」而是「不该自动跑」 |
| 4 | **只追加闸门**：检查 6 吃 `git diff` 文本、跑在 pre-commit 上 | 否 ⇒ 只追加从**机制**退回**自觉**，正是 A′ §1 诊断的失败模式 |
| 5 | **归属第三项**：A′ §3.7 定了不存 commit hash，由 `git blame --follow` 反查 | 否，永久缺失 |
| 6 | **`project_key`**：A′ §4.3 实测它就是 git remote URL | 否 ⇒ 对照样本无法归属到项目，**直接打在 B 身上** |

---

## 2. 现测事实（每条带命令，观测于 Orca `7fe3ca8`）

### 2.1 台账存量

```
cat .decisions/*.jsonl | python3 -c "…collections.Counter(json.loads(l)['ev'])…"
```
⇒ *** **`decision: 87`、`bound: 7`、`superseded: 0`、`overturned: 0`。** ***

⇒ **本轮定的是一个零存量的形状**，不需要兼容任何历史行。
⇒ **推论（承重）**：`validateLine.ts` 里 `issuesAreOnlyMissingAttribution` 那条降级
**必须保持 `bound` 专属**。它存在的理由是保护「写在字段存在之前」的 7 行历史 `bound`；
`overturned` 没有这种行，把降级泛化过去只会**让畸形记录从「拒绝」变成「警告」，而且永远改不回来**。

### 2.2 decision id 的实际形状

```
python3 …（逐文件打印 decision id）
```
⇒ 形状是 **`<run-id>/<n>`**（如 `orca-dev-09cc3ea1/3`），**全局唯一且自带出处**。
⇒ 「必须在同一文件」从来不是这个 id 的语义要求，只是检查 5 写下时手上只有单文件这一个视角。**这是裁决 4 的依据。**

### 2.3 run id 里没有仓库标识

```
cat src/scheduler/runId.ts
```
⇒ `deriveRunId` 产出 `orca-<taskId>-<hash8>`，hash8 = `sha256(契约字节 ‖ 0x00 ‖ baseCommit)`。
⇒ *** **一个 decision id 说不出它的台账住在哪个仓库。** ***
⇒ **这是 `corrections.projectKey` 必填的依据** —— 中心化的 corrections 表必须自带仓库标识。

### 2.4 那 7 条 `bound` 全部与被引用的 decision 同文件

⇒ **检查 5 至今从未被真正考验过。** `bound` 维持文件内是安全的（它天然与自己的 decision 同 run）。

### 2.5 校验入口今天是逐文件独立验

```
sed -n '1,120p' src/cli.ts
```
⇒ `runValidate` 对每个文件各调一次 `validateFile(text.split("\n"))`，**目录级 id 集合根本不存在**，需新建。

### 2.6 pre-commit 钩子验的是整个目录

```
cat scripts/githooks/pre-commit
```
⇒ 它跑 `validate .decisions`（整个目录），**不是逐个暂存文件**。
⇒ **把解析域定义为「本次扫到的全部文件」在正常路径上永远是完整的**，不会卡住提交。

### 2.7 非 git 目标的今日行为（裁决甲的依据）

| 入口 | 实测 |
|---|---|
| `orca plan` | **exit 1**，三条 `[fail]` 各自明写 `(is it a git repository?)`。**正确** |
| `orca run` | 🔴 **exit 1，但报的是 `ENOENT: … mkdir '<target>/.git/orca-lock'`** |

根因：`run.ts:630` 先 `acquireRepoLock`（锁在 `<targetRepo>/.git/orca-lock`），`run.ts:643` 才跑 preflight。
⇒ *** **上一轮为 `plan` 修掉的「原始 node 错误直达用户」这个形状，在 `run` 上原样还在。** ***
**登记给 C（§7），本轮不修。**

---

## 3. `overturned` 事件（台账侧 —— 不可逆，本轮最严格的一半）

```json
{
  "ev": "overturned",
  "id": "orca-dev-09cc3ea1/3",
  "correctionId": "c_01J9X…",
  "replacedBy": "orca-fix-a1b2c3d4/2",
  "at": "2026-09-05T18:04:11Z",
  "run": "orca-fix-a1b2c3d4"
}
```

**六个字段，全部必填，一个可选都没有。**
依据：只追加的文件里，*** **可选字段 ＝ 永远拿不到的字段。** ***

| 字段 | 是什么 | 谁检查、怎么检查 |
|---|---|---|
| `ev` | 字面量 `"overturned"` | zod `z.literal("overturned")` —— **必须在 extend 里显式覆盖**（见 §5 与 §11 复审 4） |
| `id` | **被推翻的**那条 decision | 检查 5，**目录级** |
| `correctionId` | DB 里那条 correction 的主键 | **只判非空字符串** —— 跨库，存在性判不了 |
| `replacedBy` | fix agent **自己新写的**那条 decision | 检查 5，**文件内**（与 `bound` 同档）—— 它必然是同一个 run 写的 |
| `at` | 落笔时刻 | 非空字符串，与 `decision.at` 同口径 |
| `run` | 写它的那个 run | 非空 ＋ `appendEvent` 的 Check A 扩到它：`run` 必须等于文件名那个 run-id |

**保持 `.passthrough()`**（与 `bound` 同档）—— 实测 7 条 `bound` 全部带 `note` 字段，那是既有约定。

### 3.1 两条被机制保证、不靠自觉的性质

1. **闭环在 git 内可遍历。** `replacedBy` 走文件内检查 5 ⇒ 每条 `overturned` 必然指着一条**真实存在的**新 decision。
   ⇒ 「修一条被推翻的决策，本身也是一次要留痕的决策」从纪律变成**写不出来就报错**。
2. **归属完整**（本仓库 Rule 13：who／when／在哪一笔）。`run` ＋ `at` 给 who/when；
   「在哪一笔提交上」按 A′ §3.7 既定做法由 `git blame --follow` 反查，**不存 commit hash**。

### 3.2 三条点名的取舍

- **不带 `kind`**（裁决 3 的直接后果）。A′ §4.4 的「修复率按 kind 切分」由 DB 侧一次 join 完成。
- **不带 `taskId`**（`bound` 有）。理由是 **`run` 里已经含着它**：run id 的构造就是 `orca-<taskId>-<hash8>`（§2.3），
  需要时从 `overturned.run` 还原即可。
  ⚠️ *** **本条的理由在复审中被换过一次（§11 复审 5）。** *** 原文写的是「走 `replacedBy` → 新 decision →
  它自己的 `bound` 就能拿到 task」——**那条链不成立**：实测 87 条 decision 只有 7 条有 `bound`。
  **措施没变（仍然不带 `taskId`），换掉的是理由。**
- 🔴 **`replacedBy` 必填 ⇒ 强制「先写新 decision，再写 `overturned`」的顺序。**
  `writer.ts` 的预演式校验会自动兑现它（它拒绝引用尚未落盘的 id）。
  *** **这是一条真实的顺序约束，实施时必须写进 `appendEvent` 的注释，否则 fix agent 一定踩。** ***

---

## 4. `corrections`（DB 侧 —— 可迁移，严格度低一档）

```json
{
  "id": "c_01J9X…",
  "projectKey": "github.com/blrbiran/ccloop",
  "decisionId": "orca-dev-09cc3ea1/3",
  "kind": "not_my_taste",
  "chose_instead": "把检查 5 提升到目录级",
  "because": "同一文件这个约束是写检查 5 时只有单文件视角，不是 id 的语义要求",
  "at": "2026-09-05T18:04:11Z",
  "by": "biran"
}
```

| 字段 | 必填 | 为什么是这个形状 |
|---|---|---|
| `id` | ✔ | DB 主键。`overturned.correctionId` 指的就是它 |
| `projectKey` | ✔ | git remote URL（A′ §4.3 实测的 ccmem 聚合键）。**必需，依据是 §2.3** |
| `decisionId` | ✔ | `<run-id>/<n>`，人纠正的是哪一条 |
| `kind` | ✔ | `wrong` / `not_my_taste` / `stale`（A′ §4.2）。**B 只吃 `not_my_taste`** |
| `chose_instead` | **只在 `kind = not_my_taste` 时必填** | 规则收敛成一句话：*** **只有「人要另一个」这一类，才必须说出那个「另一个」。** *** `wrong`（事实错）与 `stale`（当时对现在不对）**都可能指不出替代项** —— 逼它们必填，拿到的会是「重做」「不对」这类被迫编造的内容，而**那种污染回填不掉**（人裁，§11 复审 7） |
| `because` | ✔ | 人的理由。**对 B 来说这是全表最值钱的字段** —— A′ §4.3：对照样本的价值正在于「带着被拒绝的那一支**和拒绝它的语境**」 |
| `at` | ✔ | when |
| `by` | ✔ | who（Rule 13） |

### 4.1 三条点名的取舍

1. **这里允许判别联合（`chose_instead` 按 kind 分档），§3 不允许。**
   这不是双标：裁决 5 里反对判别联合的**唯一理由**是「只追加台账里将来补不上」。
   **DB 可迁移，那条理由在这里不成立。** *** **严格度跟着可逆性走，不跟着话题范围走。** ***
   ⇒ 同一条原则决定了分档往**松**的方向定：*** **放宽可逆（一次 migration ＋ 回填），
   被迫编造的内容不可逆（事后无法区分「人当时真这么想」和「人被迫填了个字」）。** ***
   ⚠️ **本条最弱的一环，点名登记**：面板将来若想为 `wrong` 做「对照训练验证」，会发现右半边可能是空的。
   那是**子系统 E ／ B 后续**的题，届时收紧的成本很低。
2. **不加 `status` / `fixed` 字段。** A′ §4.4 的修复率靠 `overturned.correctionId` join 得出。
   存一份状态就是裁决 3 否掉的那个形状，而且这次漂移的是**指标本身**。
3. **`projectKey` 是身份，不是路径。** 本地 checkout 路径随机器变，读取时再解析。
   ⇒ 非 git 目标拿不到 remote URL ⇒ **整条 correction 写不出来**，与裁决甲同一个立场：
   **不在 B 这边偷偷开一个 git 之外的口子。**

### 4.2 本轮的交付边界（重申，防超范围）

只出 `src/corrections/schema.ts`（zod）＋ 判据。*** **没有 DB、没有写入方、没有 CLI 子命令。** ***

---

## 5. 校验器与 CLI 的改动

| 文件 | 改什么 |
|---|---|
| `src/ledger/schema.ts` | 新增 `overturnedEventSchema = referenceEventSchema.extend({ ev: z.literal("overturned"), correctionId, replacedBy, at, run })`。🔴 **`ev` 必须显式覆盖成 literal** —— `referenceEventSchema.ev` 是三个名字的 `z.enum`，不覆盖的话 §3 那张表就宣称了 schema 没做的检查（§11 复审 4）。⚠️ `bound` 的同款松弛是**既有**的，本轮**不动**（Rule 3）。**并把「事件名 → schema」做成穷尽映射 `Record<ReferenceEventName, …>`**，不再往三元里加分支 |
| `src/ledger/validateLine.ts` | 路由改吃那张映射表。🔴 `issuesAreOnlyMissingAttribution` 的降级**保持 `bound` 专属**（依据 §2.1） |
| `src/ledger/validateFile.ts` | 检查 5 分档：`bound.id` 与 `overturned.replacedBy` **文件内**；`overturned.id` / `superseded.id` **解析域内**。🔴 **新增的「外部 decision id 集合」参数是【必填】，不是可选**（人裁，§11 复审 6）—— 文件内作用域的调用方显式传空集合 |
| `src/cli.ts` | `runValidate` 改两趟：先扫全部收集到的文件收 decision id，再带着集合逐文件验（依据 §2.5、§2.6） |
| `src/ledger/writer.ts` | `appendEvent` 已经拿着 `decisionsDir` ⇒ *** **一律扫目录建解析域，与本次追加的是什么事件无关。** *** Check A 扩到 `overturned` |
| **新** `src/corrections/schema.ts` | §4 那张表的 zod 版 |

### 5.1 三条设计决定

- 🔴 *** **`appendEvent` 一律建解析域，不做「只在写 `overturned` 时才建」的优化。** ***
  **那个优化是错的，复审时抓到（§11 复审 1）。** `writer.ts:110` 的预演校验是
  `validateFile((existingText + payload).split("\n"))` —— **每次追加都重验整份文件**。于是：
  写完一条跨文件的 `overturned` 之后，**再追加任何一条别的事件**都会因为「它不是 `overturned`」而不建域，
  重验时把那条已经落盘的 `overturned` 判成不可解析，**整个 append 抛错**。
  ⇒ *** **解析域的需要由「文件里有没有跨文件引用」决定，不由「这次追加的是什么」决定。** ***

- **穷尽映射 `Record<ReferenceEventName, ZodSchema>`**：将来加第 4 个引用类事件名，**TypeScript 直接报错**，
  不可能忘。这是本仓库「按码名索引而不是按位置解构」那条教训的第二次应用。
- **解析不到时仍然是 `rejected`，不新增第四个 verdict 状态。**
  加一个状态会波及 CLI 的 0/1/2 三档退出码与 pre-commit 对 exit 2 的容忍。
  理由写进消息里（「本次扫了 N 个文件；用整个 `.decisions/` 目录来验」）——**信息不丢，机器状态不涨。**

---

## 6. 判据与变异（每个新分支点名一条删掉**它自己**的变异）

| # | 判据钉什么 | 点名变异 | 期望 |
|---|---|---|---|
| M1×6 | `overturned` 六个必填字段逐个缺失 ⇒ rejected | 逐个改成 `.optional()` | 红 |
| M3 | `overturned.id` **可**跨文件解析 | 解析域换回文件内集合 | 红 |
| M4 | `overturned.replacedBy` **不可**跨文件 | 把它也换成解析域集合 | 红 |
| M5 | 解析不到 ⇒ rejected（不是静默通过） | 删掉那条 push | 红 |
| M6 | Check A 覆盖 `overturned`（`run` ≠ 文件名 ⇒ 抛） | 条件改回只判 `decision` | 红 |
| **M7** | 事件名→schema 映射**穷尽** | 删掉映射里 `overturned` 那一项 | **typecheck 非 0**（编译期） |
| **M10** 🆕 | 🔴 `appendEvent` **一律**建解析域：写完跨文件 `overturned` 后**再追加一条 decision** 仍然成功 | 把建域改成「只在事件是 `overturned`/`superseded` 时」 | 红（**这条直接钉 §5.1 第一点**） |
| M8 | corrections：`not_my_taste` 缺 `chose_instead` ⇒ 拒；`wrong` / `stale` 缺 ⇒ **过** | 分档去掉，改成一律可选 | 红 |
| M9×7 | corrections **另外七个**字段逐个缺失 ⇒ 拒（`chose_instead` **不在其中**，由 M8 独管） | 逐个 `.optional()` | 红 |

*** **M2 已被撤销 —— 它是一条空判据。** *** 编号不复用，见 §6.1。

⚠️ **M7 是编译期红，不是测试红。** 按本仓库「要量什么就直接量什么」，
它的观测命令是 `npm run typecheck` 的**退出码**，不是测试颜色。

⚠️ **要复跑但不改的一条**：`tests/ledger/validateFile.test.ts` 里那条
**「本仓库允许的 downgraded 行的确切集合」**判据 —— pre-commit 与 `verify` 都靠它把对 exit 2 的容忍收窄。
本轮不新增 downgraded 行，**但改完必须看见它仍然绿，并确认它不是被绕开才绿的**。

⚠️ **变异纪律**（本仓库既定）：每条变异只在 `git clone --local` 副本里做，
主工作树用 `shasum -a 256` 证明零触碰；**红必须红在目标断言上，靠崩溃变红不算证据。**

### 6.1 🔴 一处**故意的、不可被单条变异钉住**的冗余守卫（登记，不假装有判据）

`validateLine.ts` 里那条「只有缺归属字段才降级」有**两道彼此独立的守卫**：

1. `ev === "bound"`；
2. `ATTRIBUTION_FIELDS = { "taskId", "runId" }`。

而 `overturned` 的字段是 `correctionId` / `replacedBy` / `at` / `run` —— **一个都不在那个集合里**。
⇒ 即使把守卫 1 放宽成 `isReferenceEventName(ev)`，一条缺 `correctionId` 的 `overturned`
产生的 issue 路径是 `["correctionId"]`，**仍然不满足降级条件，仍然被拒**。

⇒ *** **「放宽守卫 1」这条变异必然是绿的。本 spec 初稿曾把它写成判据 M2 —— 那是一条空判据，已撤销。** ***

⚠️ **冗余守卫按构造就不可能被「删掉它自己」的变异钉住** —— 删掉任何一道，另一道仍然拦得住。
按 ccmem 交接里那条方法：*** **「没有判据能看见它」和「不该修它」是两件事，要分开记。** ***

⇒ **处置**：实施时在 `validateLine.ts` 那条降级上方写一段注释，**明说它有两道守卫、
且任何单道守卫的失效都不会被判据看见**。**不为它编一条能红的判据。**
（畸形 `overturned` 被拒这件事本身由 **M1×6** 覆盖，那六条都是真能红的。）

---

### 6.2 🔴 一条既有判据必须改写 —— **人已指名授权**（2026-09-05）

`tests/ledger/validateFile.test.ts` 里这一条（**引用前现测行号**，写本节时为 `:51-54`）：

```js
it("rejects when an overturned references an id that does not exist", () => {
  const result = validateFile([JSON.stringify({ ev: "overturned", id: "run-7c/9" })]);
  expect(result.verdict).toBe("rejected");   // ← 只断文件级判词，不断【理由】
});
```

**给 `overturned` 加上五个必填字段之后，这个字面量会先被 schema 拒（缺 `correctionId` 等），
根本走不到检查 5。** 判据仍然绿，名字仍然写着 "references an id that does not exist" ——
*** **绿在错误的原因上，静默停止度量检查 5。** ***

⇒ **改写方式**：把字面量补成**五个字段齐全、唯独 `id` 不可解析**的 `overturned`，
并**加断言钉住拒绝的【理由】**，而不是只断文件级判词。
⇒ **这是收紧，不是放宽**（人裁 88 条件 b）。**改后要在判据里写明它编码的是本轮哪条裁决**（条件 c）。

⚠️ **`:46-49` 的 `superseded` 版不受影响** —— 它保持宽 schema（`referenceEventSchema`），
仍然是被检查 5 拒的。**不要顺手一起改。**

⚠️ 另有 **12 处**纯机械补参（解析域改必填所致），**度量的东西一字未变** ——
属 P1 那轮「8 条夹具」同一类别，不需要另外指名。
**实施时若发现其中任何一处的【含义】发生变化，必须停下来找人指名，不许自己改。**

---

## 7. 已知边界与登记项（**本轮明确不做**）

| # | 项 | 归属 | 依据 |
|---|---|---|---|
| 1 | 具名检查码 `target-not-a-git-repo`（裁决甲） | **子系统 C** | §1.2 |
| 2 | 逃生门乙（非 git 降级模式）**若将来有人强需求** —— 三件必须一起做 | **子系统 C** | §1.2，**尤其那条「半个版本最坏」** |
| 3 | 🔴 `orca run` 的取锁顺序（`acquireRepoLock` 早于 `preflight`，非 git 目标报原始 ENOENT） | **子系统 C** | §2.7 |
| 4 | corrections 的 DB、写入方、CLI、面板 | **子系统 E** | §4.2 |
| 5 | ccmem 的实际写入（把对照样本喂进去） | **子系统 B 的后续任务** | 本文只定形状 |
| 6 | 跨**仓库**的 `overturned`（推翻另一个仓库台账里的 decision） | **未登记为任务** | 目录级解析只在同一目标仓库内成立；该形状今天不存在（A′ §9.2） |
| 7 | 🆕 **已接受的代价**：单独校验**一个文件**（而非整个 `.decisions/`）时，一条跨文件的 `overturned` 会被判 rejected | **已接受，不做** | §5.1。正常路径不受影响：pre-commit 与 `verify` 都验整个目录（§2.6）。理由写在拒绝消息里，**信息不丢** |
| 8 | 🆕 面板将来若要为 `kind = wrong` 做「对照训练验证」，会发现 `chose_instead` 可能为空 | **子系统 E ／ B 后续** | §4.1 第 1 条。届时收紧只需一次 migration ＋ 回填 |

---

## 8. 对 A′ spec 的两条具名 ERRATUM

A′ spec（`docs/superpowers/specs/2026-08-29-decision-ledger-design.md`）是**已发布文本**
⇒ **原文逐字保留，在该文件末尾追加两条具名 ERRATUM**，内容见那份文件。分别更正：

1. **A′ §4.1**「fix agent … 写 `overturned`（**引用 correction id**）」—— 字面为假。
   ⚠️ 注意与**本文** §4.1（corrections 的三条取舍）区分：两者不是同一节。
2. **A′ §3.8 检查 5**「`bound` / `superseded` / `overturned` 引用的 `id` 在**本文件**中存在」—— 对后两者提升到目录级。

---

## 9. 成功判据（Rule 4：一条能跑出 0／非 0 的命令）

```bash
npm run verify        # 期望 exit 0
```

开工基线（本轮现测）：**exit 0，`50 files / 165 tests`**。
收尾期望：**exit 0**，判据数为 `165 + 本轮新增条数`（实施时现测，不在此预写死）。

外加 §6 变异表**逐条被看见红**（M7 看 typecheck 退出码）。

---

## 10. 边界声明

本文设计的是 Orca 自己的数据形状。**不放松 ccloop 与 ccmem 的任何铁律**（A′ §7 ／ 本仓库 Rule 16）。
**push、合并 main、删分支或 worktree 仍需人每次单独授权；控制器不许 push。**

---

## 11. 复审记录（**同会话，spec 落盘后自我复审；上文已按本节就地修正**）

**合法性**：本 spec 写于本会话，**复审时现测远端仍为 `668bfd2`，本文未发布**
⇒ 按本仓库注释铁律，属**可就地改**的范围（「本会话自己刚写、从未为真、且未发布」）。
**本节记录改了什么、为什么** —— 不是为了合规，是为了让下一位看见**这份 spec 的初稿错在哪**。

| # | 等级 | 发现 | 处置 |
|---|---|---|---|
| **1** | 🔴 **Critical** | §5 让 `appendEvent`「只在写 `overturned`/`superseded` 时才建解析域」。**这会坏**：`writer.ts:110` 每次追加都重验整份文件 ⇒ 写完跨文件 `overturned` 后再追加**任何**事件都会把它判成不可解析，**整个 append 抛错** | 改成**一律建域**；§5.1 新增第一条讲清；**新增变异 M10 专钉它** |
| **2** | 🔴 **Critical** | §6 的 **M2 是空判据**：那条降级有**两道独立守卫**（`ev === "bound"` ／ `ATTRIBUTION_FIELDS`），而 `overturned` 的字段一个都不在后者里 ⇒ **放宽守卫 1 的变异必然是绿的** | **撤销 M2**（编号不复用）；改为 §6.1 **登记为「故意的、不可被单条变异钉住的冗余守卫」**，实施时写注释明说，**不编一条能红的判据** |
| **3** | Important | §6 **M9×8 与 M8 自相矛盾**：M9 说八个字段逐个缺失都拒，M8 说 `stale` 缺 `chose_instead` 要过 | M9 改 **×7**，`chose_instead` 由 M8 独管 |
| **4** | Important | §3 表宣称 `ev` 是**字面量**，但 §5 的 `referenceEventSchema.extend(…)` 继承的是三个名字的 `z.enum` ⇒ **表宣称了 schema 没做的检查** | extend 里显式 `ev: z.literal("overturned")`。`bound` 的同款松弛是既有的，**本轮不动**（Rule 3） |
| **5** | Important | §3.2 用「走 `replacedBy` → 新 decision → 它自己的 `bound` 就能拿到 task」论证不带 `taskId`。**那条链不成立** —— 实测 **87 条 decision 只有 7 条有 `bound`** | **措施不变**（仍不带 `taskId`），**换掉理由**：run id 的构造 `orca-<taskId>-<hash8>` 本身就含 taskId（§2.3），且那是**实测过的** |
| **6** | 人裁 | 解析域参数：可选 ⇒ **必填** | 依据 A′ §1「能改成【做不到】的，就不要留成【必须自觉】」；发现 1 正是「可选参数的默认值是危险的那个」的实例。实测代价：**15 个调用点**（生产 2、判据 13） |
| **7** | 人裁 | `chose_instead` **只对 `not_my_taste` 必填**（原为 `not_my_taste` ＋ `wrong`） | *** **放宽可逆，被迫编造的内容不可逆。** *** 与本 spec 主线（严格度跟着可逆性走）同源 |
| **8** | Minor | 「单文件校验一条跨文件 `overturned` 会被拒」只藏在 §5.1，未登记 | 进 §7 登记表第 7 行 |
| **9** | 人裁 | `tests/ledger/validateFile.test.ts`（写本节时 `:51-54`）**会静默停止度量检查 5** | **人已指名授权改写**，方式见 §6.2。**这是收紧不是放宽** |

### 11.1 这一轮复审自己的教训（**下一轮直接用**）

1. *** **「只在需要时才做」这类优化，要先问「谁会重新触发这个需要」。** *** 发现 1 的根因是
   我按「本次追加的是什么」建域，而校验器按「整份文件里有什么」判 —— **两个不同的量，我把它们当成了一个。**
2. *** **一条守卫的旁边可能还有第二道，于是删掉它照样绿。** *** 发现 2 是本仓库
   「变异是绿的 ⇒ 判据是空的」那条教训的**新变体**：这次不是判据写错了，是**被测目标本身是冗余的**。
   ⇒ **写变异表时，先问一句「这个分支是不是唯一挡住它的东西」。**
3. *** **在 spec 里给一条措施配错理由，比不配理由更坏** *** —— 发现 5 的那条链读起来完全成立，
   而它只是没人去数。**措施对不代表理由对，两者要分别验。**
