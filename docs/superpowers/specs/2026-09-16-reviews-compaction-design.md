# reviews.jsonl 的留存：压实（去重 ＋ 移走孤儿）与面板去重集的文件身份核对

> **归属**：run `orca-dev-5e5985bc`，2026-09-16，观测锚点 **`a0928fe`**（本文所有现测值都观测于这一笔）。
> **前置**：`2026-09-09-panel-design.md`（E3，已实施、已发布）。本文关掉它 §9 第 4 项与 §4.3.2 末尾登记的两件事：
> *** **`reviews.jsonl` 没有留存策略**，以及**多进程重复行没有判据**。 ***
> ⚠️ E3 spec 是已发布文本 ⇒ **不就地改它**；实施时在它 §4.3.2 末尾**追加一条具名 ERRATUM 指向本文**（计划里的一步）。
> ⚠️ 若实施推翻本文前提，**追加具名 ERRATUM，不就地改**。

---

## 0. 本文定什么、不定什么

**定**：一个由人手动触发的子命令 `orca compact-reviews`（默认只试跑，`--apply` 才写）；
行的四分类与孤儿判定；`--apply` 的写入顺序与崩溃语义；与在跑面板的并存；
`ReviewsWriter` 的文件身份核对（修一个由压实引出的真洞）；Rule 17 的具名登记；判据、变异、成功判据。

**不定 ／ 不做**：
- 不碰 `corrections.jsonl`（它是对记忆层最值钱的数据，永不压实）。
- 不自动触发；面板启动时不压实。
- `reviews-archive.jsonl` 自己不压实。
- 不提供「把孤儿恢复回来」的命令 —— 真要恢复，从归档里**手动**挪回行（§8 登记）。
- 不改台账 schema、不改 `src/metrics/**`、不改 `src/corrections/**`。

---

## 1. 现测事实（观测于 `a0928fe`，2026-09-16）

### 1.1 行数的上界跟【决策数】走，不跟【时间】走
`src/panel/reviewsStore.ts`：`ReviewsWriter.load()` 在进程启动时从盘上重建去重集，
去重键 `(projectKey, decisionId, by, action)`（E3 §4.3.2 的 ERRATUM 之后）。
⇒ **重启不增行**；单进程下每个 `(projectKey, decisionId, by)` 至多两行（`opened`、`reviewed`）。
⇒ **只有同时在跑的面板进程数 k > 1 时**，上界按 k 放大。

### 1.2 重复行不改变任何数字
`src/panel/coverage.ts` 的 `computePanelCoverage` 与 `unreviewedHighTier` 都先按 `(projectKey, id)` 装进 Set 再算。
⇒ 重复行**只花字节**。⚠️ 这是今天的代码事实，**今天没有任何判据钉住它**（§6 C16 补上）。

### 1.3 读的代价（探针，只在临时目录里读写，`~/.orca` 前后都不存在）
一行 **171 字节**（一条典型的 `reviewed` 行）。`readReviews` 读整个文件，5 次取中位数：

| 行数 | 字节 | 中位 ms |
|---|---|---|
| 1,000 | 171,000 | 0.8 |
| 10,000 | 1,710,000 | 6.2 |
| 100,000 | 17,100,000 | 60.8 |
| 1,000,000 | 171,000,000 | 642.7 |

`/api/metrics` 与 `/api/todo` **每次请求**都读一遍（`src/panel/api.ts`）。
**测量命令**：临时目录里写 N 份同一行，`tsx` 调 `readReviews` 5 次取中位数（探针脚本未入库）。

### 1.4 今天的体量
本机 `~/.orca` **不存在**（`ls ~/.orca` RC 1）；Orca 自己的台账 20 个文件、163 行（`cat .decisions/*.jsonl | wc -l`）。
⇒ *** **本文不是在救火。** *** 人 2026-09-16 选压实而不是「写明不做 ＋ 阈值触发」，理由是政策要在数据出现之前定下来。

### 1.5 面板只看台账顶层
`src/panel/decisionSource.ts` 与 `src/metrics/collect.ts` 都只扫 `.decisions/*.jsonl` 顶层。
⇒ 决策被 A′ §3.7.1 归档进 `archive/<YYYY>/` 后，它的 reviews 行在面板眼里成了**孤儿**（不影响数字，只占字节）。

### 1.6 为什么「按时间删」不在选项里
删掉一条**仍在顶层**的决策的 `reviewed` 行 ⇒ 它**回到待办**、覆盖率**下降** —— 系统替人撤销了一次审阅。

### 1.7 `collect()` 会整体拒绝的两种情况（压实继承它们）
- 挂钟模式下任何行的 `at` 晚于现在 ⇒ `future-rows-without-as-of`；
- corrections store 里有 `--root`／`--repo` 解析不到的 projectKey ⇒ `unresolved-project-keys`。
⇒ 压实复用 `collect()` 发现仓库，**这两种拒绝原样透传、一个字节不写**。这是保守方向，接受。

---

## 2. 人 2026-09-16 拍的（AskUserQuestion ＋ 逐段确认）

| # | 裁决 |
|---|---|
| **R-A** | 留存方向 ＝ **压实（去重 ＋ 去孤儿）**；否决「写明不做 ＋ 阈值触发」与「跟着决策归档走」 |
| **R-B** | 孤儿 ＝ **移走不删**；**仓库不在场就不动** |
| **R-C** | 安全网 ＝ **默认只试跑 ＋ `--apply` ＋ 一份滚动备份**（每次 apply 覆盖上一份） |
| **R-D** | §5 那个洞（面板内存去重集记着已被移走的键）**现在修**，不是登记 |
| — | §3、§4、§6 三段设计逐段确认 |

---

## 3. 子命令与行的分类

```
orca compact-reviews [--apply] [--root <dir>] [--repo <projectKey>=<path>]...
```

- 仓库发现 **调 `collect()`**，与 `metrics`／`panel` 同一套参数 ⇒ 「哪些仓库在场」只有一个定义。
- store 目录走 `correctionsDir(process.env)` ⇒ **`ORCA_CORRECTIONS_DIR` 改道同时作用于读与写**。

### 3.1 逐行四（五）分类

按文件原顺序逐行判，**判定次序即表格次序**（读不出 → 不判 → 重复 → 孤儿 → 保留）：

| 类 | 条件 | 处置 |
|---|---|---|
| **读不出** | 这一行 `JSON.parse` 失败，或解析出来不是带四个字符串键字段的对象 | **原样留在原位**（不删、不移、不参与去重） |
| **不判** | 它的 projectKey 不在 `collect().repos` 里；**或**该仓库顶层台账有任何 `malformed` 行（含 `torn`） | **原样保留，连去重都不做**（R-B「仓库不在就不动」）；报告写明 projectKey 与原因 |
| **重复** | 不属于「不判」，且键 `(projectKey, decisionId, by, action)` 在**前面某个非「不判」行**上已出现过 | 丢掉；**第一次出现的那行照留** ⇒ 最早的 `at` 不丢 |
| **孤儿** | 仓库在场、台账零坏行，且顶层**任何** `ev: "decision"` 行（**不论校验器判 ok／downgraded／rejected**）的 `id` 都不等于 `decisionId` | 原样追加进 `reviews-archive.jsonl` |
| **保留** | 其余 | 留下，**顺序不变** |

⚠️ **「读不出」与 `readReviews` 的处理方向相反，有意为之**：`readReviews` 读来只为重建去重集，丢一行代价是一行重复；
压实是**改写文件**，一条写到一半的行可能是还没写完的数据 ⇒ **一个字节都不丢**。

⚠️ **孤儿判定为什么不用 `collect().decisions`**：它**剔掉了**校验器判 `rejected` 的决策行。
校验器将来收紧时，一条曾经合法、被审过的决策会变成 `rejected` ⇒ 若按 `decisions` 判，它的 `reviewed` 会被移走；
校验器再放宽时，它回来了、审阅记录却不在活文件里。
⇒ **孤儿判定按原始 `ev: "decision"` 行的 `id` 判**（`readLedgerLeniently` 的 `kind: "decision"`，与 `decisionSource.ts` 同口径）。

⚠️ **判「去重」时孤儿也参与**：两行同键且都是孤儿 ⇒ 第一行进归档，第二行按重复丢掉。

### 3.2 报告（stdout，两个模式都打印）
逐类行数；不判的 projectKey 与原因（`repo-not-discovered` ／ `ledger-has-malformed-lines`）；
`--apply` 写入后末行固定为 `written; a running orca panel picks this up on its next duplicate check, no restart needed`。
⚠️ 这句只在 §5 落地后为真 ⇒ **§5 与本命令在同一轮落地**；若计划把 §5 拆出去，这句**必须**改成要求重启。
（设计讨论第二段曾写「末行提示重启面板」—— 那是 R-D 之前的写法，已被 R-D 取代。）

### 3.3 退出码

| 码 | 何时 |
|---|---|
| 0 | 试跑完成；或 apply 完成（含「无事可做」） |
| 1 | 参数错（`--repo` 不是 `key=path`、未知参数） |
| `collect()` 的拒绝码 | §1.7 两种，原样透传，`rejected: <code>: <message>` |
| 5 | `reviews-store-busy`（拿不到 reviews 锁），与面板同一个拒绝名 |

---

## 4. `--apply` 的写入顺序、崩溃语义、并存

### 4.1 顺序

`collect()` 在锁**外**（它读的是各仓库，不归这把锁管）。其余在 **reviews 锁内**（`.reviews-lock`，与面板同一把，超时 1 s）：

1. 读 `reviews.jsonl` 并分类。🔴 **必须在锁内读** —— 否则「读完 → 拿锁」之间面板追加的行会被第 5 步的 rename 覆盖掉。
2. 若「重复」与「孤儿」都是 0 ⇒ **释放锁返回，一个字节不写**（不生成 `pre-compact`）。
3. 原文件逐字节写进 `reviews.jsonl.pre-compact`（滚动备份）。
4. 孤儿行追加进 `reviews-archive.jsonl`：**先读归档，已有逐字节相同的行就跳过**（幂等）。
5. 保留行写进 `reviews.jsonl.compact-tmp`（锁内打开并截断）→ fsync → **chmod 成原文件 `stat` 出的权限位** → rename 覆盖 `reviews.jsonl`。

### 4.2 为什么是这个顺序：宁可多一行，不可丢一行

| 死在哪 | 留下什么 | 重跑时 |
|---|---|---|
| 第 3 步中 | 半个 `pre-compact`；活文件完好 | 覆盖重写 |
| 第 4 步后、第 5 步 rename 前 | 孤儿**同时**在活文件与归档里 | 第 4 步的幂等检查跳过，不重复追加 |
| 第 5 步 rename 前 | `compact-tmp` 残留；活文件完好 | 锁内截断重用 |
| rename 后、释放锁前 | 活文件已是新的；`.reviews-lock/` 残留 | 面板与压实都报 `reviews-store-busy`，消息已写「手动删除」 |

⚠️ **归档写在 rename 之前是承重的**：反过来（先 rename 再写归档）时，死在两者之间 ⇒ 孤儿只剩 `pre-compact` 里一份，
下次 apply 还会覆盖它 ⇒ **丢数据**。§6 C13 钉这一条。

### 4.3 mode（Rule 17）
rename 让 `reviews.jsonl` 换一个新 inode ⇒ 若照常新建，就是**替人改了已存在文件的 mode**。
⇒ `compact-tmp` 在 rename 前 chmod 成原文件的权限位（原来 `0644` 压完仍 `0644`）。
`pre-compact` 与 `reviews-archive.jsonl`：**只在新建时**显式给 `0600`；已存在的**不改 mode**。

### 4.4 与在跑面板并存
- 面板每次追加都**按路径**打开 ⇒ rename 之后写进新文件，不丢。
- 压实持锁期间面板的写会被挡：`reviewed` ⇒ 409，人看得见；`opened` ⇒ 只记服务端告警 —— 与 E3 §4.3.1 一致。
  ⚠️ 按 §1.3 的读速外推，**百万行量级时持锁可能超过 1 s**（登记，§8）。
- 🔴 面板**内存**去重集与压实后的文件不一致 ⇒ §5。

---

## 5. 🔴 压实引出的真洞，与修法（R-D）

### 5.1 洞
`ReviewsWriter` 的去重集**默认启动时读到的那个文件永远是同一个文件**。压实之后不再成立：
面板启动时读到了 X 的 `reviewed` → 压实把 X 判成孤儿移走（X 的台账文件当时不在顶层）→
人用 `undo.how` 把 X `git mv` 回顶层 → **同一个面板进程**里人点「同意」→ 内存命中 ⇒ 答 `duplicate`、**一行不写** →
活文件里没有 X 的 `reviewed` ⇒ **X 永远留在待办上**，直到面板重启。
*** **这正是 E3 §4.3.1 禁止的「人以为审过了，台账没听说」，而且连一个非 2xx 都没有。** ***
同形的第二种：人手动删掉了 `reviews.jsonl`（面板在跑）。

### 5.2 修法：文件身份，只在「内存判重复」这一条路径上核对
- `load()` **先 stat 再读**，记下身份 `dev:ino:birthtimeMs`；文件不存在 ⇒ 身份记为「无」。
- `append()` 内存命中「重复」时，stat 一次取当前身份：
  - 一致 ⇒ 照旧 `duplicate`；
  - 不一致（被 rename 替换、被删）⇒ **从盘上重新 load**，再判一次；不重复就照常 claim 并写。
- **非重复路径一字不改**（那段「在第一个 `await` 之前同步 claim」的逻辑原样保留）。
  **读路径上零新增 I/O** ⇒ E3 §4.3.1 仍然成立。
- 重新 load **单飞**：同一时刻只跑一次，并发的 append 共享同一个 promise。⚠️ 单飞是否承重**实施时先用探针量**（§6.3 M13）。
- 重新 load 覆盖掉「别的 append 刚 claim、还没写完」的键 ⇒ **最坏多写一行重复**。重复行不改变数字（§1.2，§6 C16 钉住）⇒ **接受，不为它加锁**。

### 5.3 为什么身份里要有 `birthtimeMs`
ext4 会**重用 inode**：连压两次，第二次的 `compact-tmp` 可能拿到面板启动时那个文件的 ino ⇒ 只比 ino 会误判「没变」。
APFS 的 ino 单调递增，本机复现不了。平台不支持 birthtime 时它是 0 ⇒ 退化成只比 `dev:ino`（§8 登记）。

### 5.4 可注入的 seam
`ReviewsWriter` 构造参数加一个可选的 `identityOf(path): Promise<string | undefined>`，默认是真 stat。
与已有的 `now` 注入同一种做法。**理由只有一条**：本机造不出 inode 重用，没有 seam，「身份只比 ino」这条变异**红不了**。

### 5.5 已发布注释
`ReviewsWriter` 的类注释（「Two panel processes still write duplicates…」那一段）是**已发布文本** ⇒
**原文逐字保留**，在注释块末尾**追加**具名 `*** ERRATUM (…, run orca-dev-5e5985bc) ***`，说明去重集现在会在文件身份变化时重建。
⚠️ **追加前现跑 `git ls-remote` ＋ `merge-base --is-ancestor`**，别复用开工那一次。

---

## 6. 判据与变异

### 6.1 纪律
- **一律走 `ORCA_CORRECTIONS_DIR` 改道到 `mkdtemp` 目录**；每个测试文件开头**先断言解析出来的目录在临时目录下**（守卫）。
- 涉及 mode 的判据**显式钉 umask**。
- 「写下来那天就是绿」的守卫判据 **配必抓样本**；只断言形状的断言旁边**配一条值断言**。
- 「什么都没写」的判据：压实是同步完成后才返回的，**不是** fire-and-forget ⇒ 返回后直接量即可，不需要有界窗口；
  但**必须配正向对照**（同夹具加 `--apply` 必须变）。

### 6.2 判据

**压实核心**（纯函数 `classifyReviews` ＋ 执行层）

| # | 判据 | 必抓／必不抓配对 |
|---|---|---|
| C1 | 重复保留**第一次出现**：断言留下那行的**字节**等于第一行，不只数行数 | — |
| C2 | 孤儿逐字节进归档，活文件里不再有它 | — |
| C3 | 仓库不在场 ⇒ 该 projectKey 的行一行不动 | 同一行、仓库在场 ⇒ **必须**判为孤儿 |
| C4 | 仓库台账有坏行 ⇒ 不判 | 同夹具去掉坏行 ⇒ **必须**判为孤儿 |
| C4b | 决策行被校验器判 `rejected` ⇒ **不是**孤儿 | 同夹具去掉那行 ⇒ **必须**判为孤儿 |
| C5 | 读不出的 reviews 行原样留在**原位** | — |
| C6 | 保留行顺序不变 | — |
| C7 | 试跑**一个字节不写**：目录清单与每个文件的 sha256 前后相同；且**锁被占时试跑照常退出 0**（它不拿锁） | 同夹具 `--apply` ⇒ 活文件 sha **必须**变 |
| C8 | 无事可做的 `--apply` 不写、不生成 `pre-compact` | — |
| C9 | `pre-compact` 与原文件逐字节相同 | — |
| C10 | 归档幂等：预置同一行 ⇒ apply 后仍只一行 | 不预置 ⇒ **必须**追加一行 |
| C11 | mode：活文件原 `0644` 压完仍 `0644`；新建的归档与备份 `0600`；已存在的 `0640` 备份不改 | — |
| C12 | 锁被占 ⇒ `reviews-store-busy`、退出 5、活文件 sha 不变、不生成备份与归档 | — |
| C13 | seam 让**归档写入**失败 ⇒ 活文件 sha 不变（崩溃语义 §4.2：没进归档的孤儿不许离开活文件） | — |
| C14 | seam 在「拿锁之后、读文件之前」插入一次面板追加 ⇒ 这一行压实后仍在活文件里 | — |
| C15 | **业务不变量**：夹具仓库全部在场时，压实前后 `computePanelCoverage` 与 `unreviewedHighTier` 逐项深相等 | — |
| C16 | 重复行不改变覆盖率与待办（关掉 E3 §9 第 4 项的「无判据」） | 换一个 projectKey 的行 ⇒ 结果**必须**变 |

**面板修复**

| # | 判据 |
|---|---|
| C17 | 真文件系统：load 之后文件被 rename 替换成不含该键的版本 ⇒ append 同一个键答 `written`，且盘上真的多了这一行 |
| C18 | seam：ino 相同、birthtime 不同 ⇒ 也重新 load，答 `written` |
| C19 | 身份未变 ⇒ `duplicate`、行数不变，**且 `identityOf` 被调用过**（值观测，防「根本没核对」的空绿） |
| C20 | 文件被人手动删掉 ⇒ append 答 `written` |

**CLI**

| # | 判据 |
|---|---|
| C21 | `main(["compact-reviews", …])`：参数错退出 1；报告含各类行数；`--apply` 末行是 §3.2 那句 |

**端到端（Rule 4：一条跑出 0／非 0 的命令）**：`scripts/verify-panel.ts` 插入**一个新步骤**，总数从 PASS 0–12 变成 **PASS 0–13**（位置见下方 🔴，关闭面板那一步仍是最后一步）：
真面板进程在跑 → 对某条决策 X「同意」→ 把 X 所在台账文件移出顶层 → 跑**真的** `orca compact-reviews --apply` 进程 →
把台账文件移回 → 再「同意」X ⇒ 断言答 `written` 且 X 不在待办上。
⚠️ 夹具里「移出顶层」会让同一文件里的**其他**决策一起变孤儿；具体选哪条、先后步骤怎么排，由计划按 `verify-panel.ts` 现有的 PASS 5–8 状态现读后定。
🔴 **一个已知的坑（写 spec 时读 `scripts/verify-panel.ts` 第 715–735 行发现，未跑）**：现有 PASS 8 用 `recordCorrection` 往 store 写了一条
projectKey 为 `verify-panel-unresolvable-project` 的 correction，并断言**下一个请求**答 409 `UNRESOLVED_PROJECT_KEYS`。
那条行此后一直在 store 里 ⇒ *** **PASS 8 之后，压实进程（`collect()` 整体拒绝，§1.7）和面板自己的 `/api/reviews`（同样经 `collect()`）都会被挡** ***。
⇒ 新步骤**不能**简单地插在 PASS 11 之后。计划现读后选一种：插在 PASS 8 **之前**（其后编号顺延），或用独立的 store 目录 ＋ 独立面板进程跑。
**不许靠放宽 §1.7 来绕过。** ⇒ 本节只定**总数变成 PASS 0–13**，**位置由计划定**。

### 6.3 变异（只在 `git clone --local` 副本里跑）

| 变异 | 打向 |
|---|---|
| M1 重复保留**最后**一次出现 | C1 |
| M2 删掉「仓库在场」条件 | C3 |
| M3 删掉「台账零坏行」条件 | C4 |
| M3b 孤儿判定改用 `collect().decisions` | C4b |
| M4 丢掉读不出的行 | C5 |
| M5 删掉 apply 闸门 | C7 |
| M6 删掉「无事可做」提前返回 | C8 |
| M7 删掉归档幂等检查 | C10 |
| M8 `compact-tmp` 不 chmod | C11 |
| M9 先 rename 再写归档 | C13 |
| M10 读文件挪到拿锁之前 | C14 |
| M11 删掉身份核对 | C17 与 verify:panel 的新步骤 |
| M12 身份只比 `dev:ino` | C18 |
| M13 删掉单飞 | **先用探针问「能红吗」**；红不了 ⇒ 单飞不落地（同 R74） |

⚠️ *** **每条「红在 X 且仅 X」的精确预言写在计划里、实施之后验收。** *** 本表只定「打向哪条判据」。
依据：2026-09-10 计划阶段写的红数被两席外审现测错了 31%，而判据层的自审在被测代码还不存在时做不了。
⚠️ 写预言时三问：X 之前有没有别的断言先炸（防假）；被删那行还有谁在走（防不全）；点名断言里的字面量从哪个字段来。

### 6.4 成功判据
```
rtk proxy npm run verify > <log> 2>&1; echo "VERIFY_RC=$?"   # 期望 0
ls ~/.orca                                                    # verify 前后都期望 RC 1
```
期望：npm test 在 **95/566** 之上增加（增量实施后现测，不在此预言）；scheduler **51/167** 不变；
verify:panel **PASS 0–13**；web **8/26** 不变。

---

## 7. Rule 17 具名登记（仓库外写入方）

**触发者**：只有人手动执行 `orca compact-reviews --apply`。面板对这些路径只做两件事：**追加** `reviews.jsonl`、**拿放** `.reviews-lock/`；其余三个路径只有压实写。

| 路径（都在 `correctionsDir(env)` 下） | 写法 | mode | 失败时的残留 |
|---|---|---|---|
| `reviews.jsonl` | rename 替换 | **保持原文件权限位** | 无半写：要么旧文件要么新文件 |
| `reviews.jsonl.pre-compact` | 每次 apply 覆盖 | 新建 `0600`，已存在不改 | 半个备份（此时活文件完好） |
| `reviews-archive.jsonl` | 只追加、逐行幂等 | 新建 `0600`，已存在不改 | 多一行完全相同的行，或残一个半行 |
| `reviews.jsonl.compact-tmp` | 锁内截断重用 | `0600` 后 chmod 为原文件权限位 | 残留文件，下次锁内重用 |
| `.reviews-lock/` | mkdir／rmdir（finally 释放） | `0700` | 被 kill 后残留；拒绝消息已写「手动删除」 |

⚠️ **归档里的半行**：`reviews-archive.jsonl` 不被任何代码读回做数字，只被第 4 步读来做幂等比对 ⇒ 半行只会让一次比对不命中、多追加一行。

---

## 8. 已知边界与登记项（不掩饰）

1. **没有「恢复孤儿」的命令**：决策被移回顶层后，它的审阅记录在 `reviews-archive.jsonl` 里，要人手动挪回。
   §5 修好之后，面板不会因此卡住 —— 最坏是这条决策**重新出现在待办上**，人再点一次。
2. **百万行量级时 apply 持锁可能超过 1 s**，期间面板的 `reviewed` 写答 409（§4.4）。
3. **birthtime 不被支持的平台上**，身份核对退化为 `dev:ino`，ext4 上连续压实可能漏检（§5.3）。
4. **压实继承 `collect()` 的两种整体拒绝**（§1.7）：corrections store 里有一个解析不到的 projectKey，压实就一行不动。
5. **多进程重复行仍会产生**：本文让它有了判据（C16）与清理手段，没有让它停止发生。
6. **本文改 E3 已发布的生产代码** `src/panel/reviewsStore.ts` 与已发布的 `scripts/verify-panel.ts`（PASS 编号顺延）。
