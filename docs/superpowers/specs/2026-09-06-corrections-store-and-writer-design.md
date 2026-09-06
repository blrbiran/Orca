# 子系统 E 的第一刀：corrections 的存储与写入方

**日期**：2026-09-06　**归属**：run `orca-dev-19c594d2`
**观测锚点**：Orca `60d29c8`（本文所有实测值都在这一点上取，行号与计数引用前请现测）

---

## 0. 本文定什么、不定什么

**定**：让**第一条真的 `overturned` 能落盘**所需要的最小一套东西 ——
一个 `orca correct` 子命令、一个 corrections 存储、以及从 correction 机械派生新 decision 的规则。

**不定**：Web 面板、查询接口、A′ §4.4 修复率的计算与展示、把对照样本真正喂进 ccmem。
那些是 E 的后续与 B 的后续，见 §9。

⚠️ **本文是 `2026-09-05-corrections-overturned-design.md` 的下游。** 那份定了**形状**（`corrections` 的 8 个字段、
`overturned` 的 6 个必填字段），本文定**谁来写、写到哪、按什么顺序写**。**形状本身本文一个字都不改。**

⚠️ **为什么现在做这一刀，而不是先做 D**：`overturned` 的形状已经落成代码，但**至今零真实写入方**
（上游 spec §1.1 明写这一点并说「它在真实使用中是对的，这句话本轮证不出来」）。
台账只追加 ⇒ **第一条真事件落盘之后那个形状就再也改不了**。
现测（§2.4）存量仍是 0 ⇒ *** **现在是唯一还能验证那个形状对不对的窗口。** ***

---

## 1. 六条已裁决的分叉（人 2026-09-06 当面逐条拍板）

| # | 问题 | 裁决 | 被否掉的那条的代价 |
|---|---|---|---|
| **1** | 谁扮演「面板」（上游裁决 5 写死 `overturned` 只能来自面板 correction） | **`orca correct` CLI 子命令** | 最小 HTTP 面板要让 Orca 第一次引入 server／前端依赖（现在只有 `zod`），而本刀的目的是让第一条真 `overturned` 落盘，不是做出面板；只出库函数则等于没有写入方，与目的直接冲突 |
| **2** | corrections 存哪、什么介质 | **用户级单文件 JSONL**，默认 `~/.orca/corrections.jsonl` | 放进目标仓库会推翻 `projectKey` 的存在理由（跨项目聚合），且把一个**可重写**的东西塞进只追加闸门管辖的目录；SQLite 要么引 native 依赖（Orca 至今零 native），要么在 Node 22 上依赖 `--experimental-sqlite` |
| **3** | 闭环时那条新 decision 的内容从哪来 | **从 correction ＋ 原 decision 机械派生** | 让人手写整条会把「推翻一条决策」的成本从填几个字段涨到写两整条，人就会少用它 —— **少用就没有对照样本**，与本刀目的相反。且派生是确定性变换，按 Rule 5 本来就该是代码 |
| **4** | 派生不出来的 `undo` 三个字段 | **`undo.how` 人必填；`cost` / `blast_radius` 继承原条并在文本里标注是继承来的** | 三个全派生会让 Tier 0 降级那道闸门**永远不可能响**：谓词的已知下限是「含一个标识符就算过」，而派生文本必然含 —— 那是「半道闸门静默消失」的原形。三个全由人填则回到裁决 3 被否掉的成本问题 |
| **5** | `projectKey` 怎么防与 ccmem 漂移 | **Orca 自己实现 `normalizeRemoteUrl`，具名登记漂移风险**（§9） | 对拍判据在找不到 ccmem 的机器上只能 skip，而 Rule 12 明令 skipped 不算通过 —— 等于造一条在 CI 上永远不跑的判据；调 ccmem CLI 则把 ccmem 变成 `orca correct` 的硬运行时依赖，ccmem 没装就记不了 correction |
| **6** | 多用户的形态 | **同机多进程／多人。现在就做互斥，不留「单用户」这条假设** | 见 §7。跨机共享文件系统是另一种形态，**mkdir 锁在那上面站不住**，已具名登记 |

### 1.1 裁决 6 是一次前提更正，不是新增需求

本文初稿曾把「`~/.orca/corrections.jsonl` 不加并发锁（单用户终端命令）」写进登记表。
**人当场驳回，理由是后续大概率扩展到多用户。**

⇒ *** **这次驳回抓出的不是锁，是一个更硬的设计错误** ***（§7.1）：
run id 原本只从 correction 内容派生，**两个人对同一条 decision 各自闭环会派生出同一个 run id，
于是两个人写同一个台账文件** —— 直接推翻 A′ §3.1「每个写入方只写自己那个文件、结构上不可能冲突」。
**那条保证正是整套台账不需要合并冲突处理的地基。**

⇒ 记法：*** **「单用户」这类简化假设，代价不在它省掉的那个机制上，而在它悄悄改掉的那条不变式上。** ***

---

## 2. 现测事实（每条带命令，观测于 `60d29c8`）

### 2.1 Orca 至今没有任何存储代码

`grep -rln "sqlite\|better-sqlite3\|Database" src/ package.json` ⇒ **0 命中**（退出码 1）。
`package.json` 的 `dependencies` 只有 **`zod`**。
⇒ **本刀是从零加一层，不是改现有流程。**

### 2.2 CLI 现有四个子命令

`src/cli.ts` 的 `main` 依次匹配 `validate` / `plan` / `run` / `check-append-only`，
兜底写 `USAGE` 并返回 1；直接调用时的异常臂返回 **3**（spec §6.3 的升级码）。
⇒ `correct` 是**第五个**，退出码沿用既有三档。

### 2.3 ccmem 的 `project_key` 算法（读源码，未碰它的库）

`/Users/biran/code/skills/ccmem/scripts/lib/project-key.mjs`：

```js
git config --get remote.origin.url        // 注意不是 git remote get-url
// git@host:path(.git)?  ->  host/path
// 其它                   ->  new URL(u).hostname + pathname.replace(/\.git$/, "")
// 取不到 remote          ->  `path:${sha256(cwd).slice(0,16)}`   ← fallback
```

⇒ 🔴 **它有 fallback，Orca 故意不实现那一支**：上游 spec §4.1 第 3 条明写「非 git 目标拿不到 remote URL
⇒ 整条 correction 写不出来」。两者不冲突（Orca 永远走不到那个分支），
**但 Orca 写出的 key 必须与 ccmem 对同一个仓库算出的 key 逐字相同**，否则跨项目聚合悄悄失效。

### 2.4 `overturned` 与 `superseded` 的存量仍是 0

全部台账逐行 `JSON.parse` 后按 `ev` 计数：**`decision` 103 ＋ `bound` 7**，再无别的事件类型。
⇒ **形状仍可改；写下第一条之后就不可改。** 这是本刀的时间价值所在。

### 2.5 `appendEvent` 对 downgraded 是**抛错**，不是放行

`src/ledger/writer.ts`：`verdict === "rejected"` 抛，`verdict === "downgraded"` **也抛**
（"this decision is not the agent's to make"）。
⇒ *** **派生出的新 decision 若 `undo.how` 过不了可执行谓词，`orca correct` 当场失败。** ***
这是裁决 4 的直接依据 —— 那个字段不是装饰，它是这条命令能不能跑通的闸门。

### 2.6 `replacedBy` 必须**文件内**解析

上游 spec §3：`overturned.id` 目录级、`overturned.replacedBy` **文件内**（与 `bound` 同档）。
⇒ *** **新 decision 与 `overturned` 必须落在同一个文件，且新 decision 必须先写。** ***
`writer.ts` 的预演式校验会自动兑现这个顺序（它拒绝引用尚未落盘的 id）。

### 2.7 `deriveRunId` 已存在

`src/scheduler/run.ts` 用 `deriveRunId("round", round.planBytes, base)` —— 「同输入同名字」的既定做法。
⇒ 本刀的 correction id 与 fix run id 沿用它那套思路，不引入随机 ULID。

---

## 3. `orca correct` 的命令表面

```
orca correct
  --repo <path>              默认 cwd。台账位置与 projectKey 都从它算
  --decision <run-id>/<n>    被纠正的那条 decision
  --kind wrong|not_my_taste|stale
  --because <text>           人的理由
  --by <who>                 默认取 git config user.name
  [--chose-instead <text>]   kind=not_my_taste 时必填（上游 §4）
  [--undo-how <text>]        与 --chose-instead 同时出现 ⇒ 走闭环
  [--close <correctionId>]   给已存在的 correction 补闭环（同时是失败重试路径）
```

⚠️ **`--by` 取不到值 ⇒ 当场拒**（`git config user.name` 未设且未显式给）。
`by` 是 `min(1)`，放着不管的话会在 schema 那一层被拒，**而那条消息说的是「字段缺失」，
不是「你这台机器没配 git 身份」** —— 离原因太远。**自查发现 2。**

⚠️ **`--close` 仍然需要 `--repo` 与 `--undo-how`**：前者定位台账，后者**不在 correction 行里**
（correction 的 8 个字段不含 `undo`），所以补闭环时还得给一次。**自查发现 3。**

**两种模式由参数决定，不由 `kind` 决定**：`--chose-instead` ＋ `--undo-how` 都在 ⇒ 闭环；否则只记 correction。

⚠️ **一条必须登记的推论**：*** **闭环必须有 `chose_instead`，不管 `kind` 是什么。** ***
新 decision 的 `chose` 只能从它来。所以 `wrong` / `stale` 想闭环也得给一个 ——
**只是 schema 不逼它给**（上游裁决：被迫编造的内容不可逆）。
⇒ 这不是矛盾：**schema 管「一条 correction 合不合法」，本条管「够不够闭环」，两个不同的问题。**

**退出码**：**0** 成功 ／ **1** 输入被拒 ／ **3** 未预期异常。与 §2.2 的既有三档一致，不新增。

---

## 4. corrections 存储层

| 项 | 定义 |
|---|---|
| 路径 | `${ORCA_CORRECTIONS_DIR:-~/.orca}/corrections.jsonl` |
| 格式 | 每行一条 `correctionSchema`（`src/corrections/schema.ts`，上游已落地，本文不改） |
| id | `c_` ＋ `sha256(projectKey \| decisionId \| at \| because \| by)` 前 16 位 |
| 写入 | 追加。写前过 schema；文件非空且不以换行结尾时**自己补一个** |
| 查重 | 同 id 已存在 ⇒ 拒（与台账 Check B 同形） |

**`ORCA_CORRECTIONS_DIR` 不是便利，是必需**：没有它，判据会写进使用者真实的用户数据。
⚠️ **Orca 由此第一次写用户全局数据。** ccmem 为同一件事专门有一条 Rule 13；
本仓库的 `CLAUDE.md` 目前没有对应条款 —— **登记为 §9 第 6 项，不在本刀顺手改 `CLAUDE.md`。**

**id 由内容派生而不是随机**：可测、可复现，且**同一个 correction 重试时派生出同一个 id**，
这正是 §6 幂等重试的基础。含 `by` 的理由见 §7.1。

**补尾换行这一条是抄来的，不是想出来的**：A′ 那轮实测过「结尾没有换行的台账有两个独立的坑」，
其中一个就是写入方把新记录粘在上一条后面、报成功、落盘、随后判 not valid JSON。**同一个坑不踩第二次。**

---

## 5. 派生表：新 decision 逐字段

闭环时那个新 run 文件里**只有两行**：`<新run>/1` 是新 decision，第二行是 `overturned`。

| 新 decision 字段 | 来源 |
|---|---|
| `ev` | `"decision"` |
| `id` | `<新 run id>/1` |
| `at` | 与 correction **同一个时刻值**（同一次动作） |
| `run` | 新 run id（§7.1） |
| `question` | **原 decision 的 `question`，逐字** —— 问题没变，变的是答案 |
| `chose` | correction 的 `chose_instead` |
| `alternatives` | 一条：`option` ＝ 原 decision 的 `chose`；`why_not` ＝ 「人在 correction `<id>` 里推翻了它：`<because>`」 |
| `because` | correction 的 `because` |
| `undo.how` | 人给的 `--undo-how`（裁决 4） |
| `undo.cost` / `undo.blast_radius` | 原条继承，**文本里显式标注「继承自 `<原 id>`」** |
| `scope` / `kind` | 原条继承 |
| `evidence` | `["correction <correctionId>", "overturns <原 decision id>"]` |

`overturned` 六个字段按上游 spec §3 填，本文不重复。

⚠️ **`why_not` 不是 `because` 的原样复制**，而是带出处的改写。
两者说的是同一件事的两面，但 `why_not` 多带一个 correction id ——
*** **让读到这条 alternative 的人能查到它的出处，而不是只看到一句无主的理由**（Rule 13：归属）。 ***

⚠️ **继承 `cost` 的已知不准**：反方向的代价未必与原方向对称。
登记在 §9 第 3 项，**不假装它准**。

**原 decision 找不到 ⇒ 当场拒**（在 `<--repo>/.decisions/` 里找），不等 `appendEvent` 的检查 5 去兜底 ——
兜底给出的消息是关于「引用解析不到」的，而真正的原因是「你给的 `--decision` 拼错了」。

---

## 6. 写入顺序与失败残留

| 步 | 动作 |
|---|---|
| 1 | 读原 decision（扫 `<--repo>/.decisions/` 整个目录）；拒：找不到／目标非 git／无 remote |
| 2 | **写 correction 行**（先写可修的那一半） |
| 3 | 闭环：`appendEvent(<新run>, 新 decision)` |
| 4 | 闭环：`appendEvent(<新run>, overturned)` |

**顺序的依据是可逆性**：两个存储之间不可能原子提交，所以**先写能改的那一半**。
`~/.orca/corrections.jsonl` 可重写（上游 §4.1：DB 可迁移正是它严格度低一档的理由），台账不可。

| 失败在 | 残留 | 评价 |
|---|---|---|
| 步 2 | 什么都没写 | 干净 |
| 步 3 | 一条没有 `overturned` 的 correction | *** **合法** *** —— A′ §4.4 眼里就是「未修复」那一档 |
| 步 4 | 文件里一条**孤儿新 decision**，没有 `overturned` 指着它 | 唯一难看的残留；台账只追加，删不掉 |

### 6.1 🔴 `--close` 必须是**幂等续做**，否则重试路径自己是坏的

run id 由**存储里那条 correction 行**派生（§7.1）⇒ **同一个 correction 重试必然派生出同一个 run id
⇒ 落到同一个文件 ⇒ 步 3 会因 `appendEvent` 的 Check B「duplicate decision id」直接抛。**
⚠️ **这个「必然」正是 §7.1 那条更正买来的** —— 若按初稿从命令行参数派生，重试会落进**另一个**文件，
既不会抛，也不会续上，而是**每次重试多留一条孤儿 decision**。

⇒ *** **`--close` 先检查那条新 decision 在不在文件里，在就跳过步 3、直接补步 4。** ***

这把步 4 的残留从「孤儿 decision」变成「**半完成、可续**的闭环」。

⚠️ **这是本设计里唯一一处「不这么做就一定坏」的地方** ——
不是优化，是修一条自己造出来的死路。它会单独进台账。

---

## 7. 并发与多用户

### 7.1 🔴 `by` 必须进 id 与 run id 的派生

🔴 *** **run id 从【存储里那条 correction 行】派生，不从命令行参数派生。** ***
具体做法：**复用既有的 `deriveRunId`**（`src/scheduler/runId.ts`），调用
`deriveRunId("fix", Buffer.from(<correction 行的规范 JSON>), <correction id>)`，
产出 `orca-fix-<hash8>` —— 那正是它现成的形状 `orca-<taskId>-<hash8>`。
*** **不写第二份派生函数** ***：本仓库已经因为「手抄一份跨模块的副本会无声漂移」收敛过一次
（`runId.ts` 自己的注释记着这件事）。

⚠️ **「从存储里那行派生」这个限定是自查抓出来的 Critical，不是措辞讲究**（§12 发现 1）：
初稿写的是从命令行参数派生，而参数里含 `at`。**重试时 `at` 是新的 ⇒ 派生出不同的 run id
⇒ 落进不同的文件 ⇒ §6.1 那条「幂等续做」当场失效**，而它正是失败重试的唯一出路。
⇒ 从存储行派生之后，`--close` 读回同一行、得到同一个 id，**幂等由构造成立，不靠自觉**。

correction id 仍按 §4 从内容派生（它是那一行自己的主键，写下时才第一次存在）。

**理由不是防哈希碰撞，是保住一条不变式**：`by` 不进派生 ⇒ 两个人对同一条 decision 各自闭环
会算出同一个 run id ⇒ **两个人写同一个 `.decisions/<run>.jsonl`**
⇒ 直接推翻 A′ §3.1「每个写入方只写自己那个文件、结构上不可能冲突」。

⇒ 由此得到一条更重要的结论：*** **台账侧不需要锁。** *** 不是因为并发少，
而是因为 `by` 进派生之后，**没有两个写入方会碰同一个文件** —— 与 A′ 原本的机制同源。

### 7.2 锁只加在那一个真正共享的文件上

`${ORCA_CORRECTIONS_DIR}/.corrections-lock`，**机制照抄 `src/scheduler/repoLock.ts`**：
非递归 `mkdir` ＋ EEXIST ＋ 里面写 pid／时间的 `info` 文件。**不发明第二种锁。**

`repoLock.ts` 选 `mkdir` 而非 `flock` 的理由原样适用并抄录在实现的注释里：
*** **`flock` 在没有 `fcntl` 的平台上会静默退化成 no-op，而 Rule 12 不允许静默退化。** ***

### 7.3 但**不与 `repoLock.ts` 合并**，理由是语义真的不同

| | repo lock | store lock |
|---|---|---|
| 覆盖 | 整轮（分钟级） | 一次追加（毫秒级） |
| 拿不到时 | 拒绝整轮，合理 | 应**短暂重试**，而不是让人重打命令 |
| stale 回收 | 明确不做（"deliberately out of scope"） | 若也不做，**一次崩溃就把所有人的 corrections 永久锁死** |

⇒ store lock 的做法：**短退避重试，总上限约 1 秒；超时 ⇒ 具名拒绝 `corrections-store-busy`，
消息里给出锁目录路径与 `info` 的内容（pid、取锁时刻）。**
*** **不做 stale 回收、不猜它死没死** *** —— 立场与 `repoLock.ts` 一致，只是给人一条可执行的出路。

⚠️ **合并两者会把两组不同语义塞进一个函数，再参数化出一堆开关。不合并是有意的，理由在此，不是疏忽。**

### 7.4 已知限制：跨机共享文件系统

*** **`mkdir` 的原子性在 NFS／SMB 上历来不可靠。** ***
「多用户」若落地成**共享存储**而不是同机多进程，**本设计的互斥不成立**，
到那一步必须换底座（SQLite WAL 或服务端），**不是加重试能补的**。
⇒ 登记在 §9 第 5 项。**本文不假装覆盖了这种形态。**

---

## 8. 判据与变异（每个新分支点名一条删掉**它自己**的变异）

| # | 判据钉什么 | 点名变异 | 期望 |
|---|---|---|---|
| **E1a** | `git@host:p.git` ⇒ `host/p` | 删掉 `git@` 分支 | 红 |
| **E1b** | `https://host/p.git` ⇒ `host/p` | 删掉 `.git` 剥离 | 红 |
| **E2** | 无 remote ⇒ **整条拒**，不落 ccmem 的 `path:` fallback | 补上 fallback | 红 |
| **E3** | 闭环要求 `chose_instead` ＋ `undo-how` **同时**在 | 去掉其中一个的必填 | 红 |
| **E4** | 🔴 **写入顺序**：correction 先落盘，台账后写 | 调换步 2 与步 3／4 | 红 |
| **E5a** | 🔴 **`--close` 幂等**：新 decision 已在文件里则跳过步 3 | 删掉那个存在性检查 | 红（`duplicate decision id`） |
| **E5b** | 🔴 **重试补的是【原来那个】文件**：断言步 4 之后，**先前那条孤儿 decision 所在的文件**里出现了 `overturned` | run id 改回从命令行参数派生 | 红（重试落进了另一个文件，原文件仍是孤儿） |
| **E6** | 🔴 **`by` 进 id 与 run id 的派生**：两个 `by` 落进**不同**文件 | 从派生里去掉 `by` | 红 |
| **E7** | 第二个进程拿不到锁 ⇒ 具名拒绝，**不覆盖** | 删掉取锁 | 红 |
| **E8** | 超时 ⇒ `corrections-store-busy` 且消息含锁路径与 pid | 把超时改成静默放行 | 红 |
| **E9** | 无尾换行的 corrections 文件不粘行 | 去掉 separator | 红 |
| **E10** | 重复 correction id ⇒ 拒 | 删掉查重 | 红 |
| **E11** | 原 decision 找不到 ⇒ 当场拒 | 删掉预检 | 红（消息变成检查 5 的措辞） |
| **E12** | `undo.how` 过不了谓词 ⇒ `orca correct` 失败而**不是**写出降级行 | 让派生自己填一个必然过闸的 `undo.how` | 红 |

⚠️ **E6 是本刀最承重的一条** —— 它钉的是 A′ §3.1 的地基，而**它今天差点就是默认行为**（§1.1）。

⚠️ **变异纪律**（本仓库既定，逐条照做）：
每条变异只在 `git clone --local` 副本里做；**未提交的改动必须先 `cat` 进副本并用 `diff` 证明逐字节相同**；
*** **变异前后各取一次目标文件的 `shasum -a 256`，不相等才算「变异落上去了」** ***
（2026-09-06 实测：一条变异因脚本报错根本没落上去，测试照绿，而复合命令把那个失败吞了）；
**红必须红在目标断言上，靠崩溃变红不算证据。**

⚠️ **要复跑但不改的**：`tests/ledger/validateFile.test.ts` 里
「本仓库允许的 downgraded 行的确切集合」那条 —— 本刀**不新增 downgraded 行**，
但改完必须看见它仍然绿，**并确认它不是被绕开才绿的**。

---

## 9. 已知边界与登记项（**本刀明确不做**）

| # | 项 | 归属 | 依据 |
|---|---|---|---|
| 1 | Web 面板、查询接口、A′ §4.4 修复率的计算与展示 | **子系统 E 的后续** | §0 |
| 2 | 把对照样本真正喂进 ccmem | **子系统 B 的后续** | 上游 spec §7 第 5 项 |
| 3 | 🆕 继承来的 `undo.cost` **可能不准**（反方向的代价未必对称） | **已接受，不做** | §5。收紧的做法是让 `--undo-cost` 也可选传入，届时一行参数的事 |
| 4 | 🆕 `projectKey` 与 ccmem **可能漂移**：ccmem 改了 `normalizeRemoteUrl`，Orca 不会知道 | **已接受，具名登记** | §2.3 ／ 裁决 5。可见的后果是跨项目聚合悄悄失效，**不是报错** |
| 5 | 🆕 **跨机共享文件系统上互斥不成立** | **已登记，不做** | §7.4。到那一步换底座，不是加重试 |
| 6 | 🆕 Orca 第一次写用户全局数据，而 `CLAUDE.md` **没有对应条款**（ccmem 为同一件事有 Rule 13） | **登记给人**，本刀不顺手改 `CLAUDE.md` | §4。改规则文件属 Rule 11「不要静默分叉」，要单独提出来 |
| 7 | 🆕 孤儿 `overturned`（`correctionId` 指向已被人手删的 correction） | **不防** | 台账只追加而 corrections 可重写，这个方向的不一致是存储选型的固有代价 |
| 8 | 🆕 两个人各自推翻同一条 decision ⇒ 两条 `overturned` 指向同一个 `id` | **允许，不拦** | 检查 5 只要求 `id` 能解析；语义就是「两个人各自推翻了它」，各自 join 各自的 correction |

---

## 10. 成功判据（Rule 4：一条能跑出 0／非 0 的命令）

```bash
npm run verify        # 期望 exit 0
```

**开工基线（本文写下时现测，观测锚点 `60d29c8`）**：
`npm run verify` **exit 0**，**全仓 60 files / 317 tests**、**scheduler 档 51 / 167**。
⚠️ *** **`verify` 打印两个判据数，别混着比。** ***
**收尾期望**：exit 0，判据数为基线 ＋ 本刀新增（实施时现测，不在此预写死）。

外加 §8 变异表**逐条被看见红**。

**另有一条只在本刀成立的验收**：*** **跑一次真的 `orca correct` 闭环，
让第一条 `overturned` 真的落进某个一次性目标仓库的 `.decisions/`，并用 `orca validate` 判它 ok。** ***
⚠️ **在一次性仓库里做，不在本仓库的 `.decisions/` 里做** —— 那是不可逆的。

---

## 11. 边界声明

本文设计的是 Orca 自己的数据形状与命令。**不放松 ccloop 与 ccmem 的任何铁律**（A′ §7 ／ 本仓库 Rule 16）。
**读 ccmem 的源码是只读行为；本文没有、也不打算让任何代码写 `~/.claude/ccmem/**`。**
**push、合并 main、删分支或 worktree 仍需人每次单独授权；控制器不许 push。**


---

## 12. 自审记录（**同会话，spec 落盘后自我复审；上文已按本节就地修正**）

**合法性**：本 spec 写于本会话，复审时**现测远端为 `31ac9af`，本文未发布**
⇒ 按本仓库注释铁律，属**可就地改**的范围（「本会话自己刚写、从未为真、且未发布」）。
**本节记录改了什么、为什么** —— 为的是让下一位看见**这份 spec 的初稿错在哪**。

| # | 等级 | 发现 | 处置 |
|---|---|---|---|
| **1** | 🔴 **Critical** | §7.1 让 run id 从**命令行参数**派生，而参数里含 `at`。**重试时 `at` 是新的 ⇒ 派生出不同 run id ⇒ 落进不同文件 ⇒ §6.1 那条「幂等续做」当场失效**，而它是失败重试的唯一出路。更坏的是每次重试**多留一条孤儿 decision** | 改成**从存储里那条 correction 行派生**；§6.1 补一句说明这个「必然」是哪来的；**新增变异 E5b 专钉它** |
| **2** | Important | `--by` 取不到值（`git config user.name` 未设）会一路走到 schema 才被拒，而那条消息说的是「字段缺失」，离真正原因太远 | §3 补：**当场拒**，消息说清是身份没配 |
| **3** | Important | `--close` 只说了它是重试路径，没说它**仍然需要 `--repo` 与 `--undo-how`** —— 后者不在 correction 的 8 个字段里 | §3 补明 |
| **4** | Minor | §7.1 打算新写一份 run id 派生 | 改成**复用既有 `deriveRunId`**（`orca-<taskId>-<hash8>` 正是要的形状）。本仓库已因「手抄跨模块副本会无声漂移」收敛过一次 |
| **5** | Minor | 「扫整个 `.decisions/`」没说是哪个仓库的 | 改为 `<--repo>/.decisions/` |

**占位符扫描**：`TBD` / `TODO` / `待定` / `???` **零命中**（`grep` 退出码 1）。

### 12.1 这一轮自审自己的教训

1. *** **「同输入同输出」的派生，必须先问清楚「输入是哪一份」。** *** 发现 1 的根因是
   我把**命令行参数**和**存储里那一行**当成了同一个量 —— 它们在第一次写入时确实相等，
   **只在重试那一刻才分岔**，而重试正是这个派生存在的唯一理由。
   ⇒ **凡是为「重试／幂等」服务的派生，都要拿重试那一刻去验，不能拿首次写入去验。**
2. **一条被否掉的简化假设，值得单独记一节。** §1.1 记的是「不加锁（单用户）」被驳回，
   而驳回真正抓出的是 run id 少了 `by`。
   ⇒ *** **简化假设的代价，往往不在它省掉的那个机制上，而在它悄悄改掉的那条不变式上。** ***
