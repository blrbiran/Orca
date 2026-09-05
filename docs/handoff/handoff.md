# Orca Handoff

> ⚠️ **这份文档是多 agent 共享的。** 别的 agent 落下来的条目**不要删**——除非它已经过期，
> 而"过期"要能指出**是什么让它过期的**（哪一笔提交、哪一次实测）。**不确定就留着。**
> ⚠️ **本文不写任何当前哈希**——提交本文这个动作本身就会改 HEAD，而人也会自己推远端。
> 要指代某一笔就**引提交主题行**，要指代材料就**引路径**。

---

## Orca 是什么

**系统层**：决定跑哪些任务、怎么排、并行还是串行；持有决策台账工具、索引器、调度器、Web 面板。

三个仓库的分工（**详见 spec §9**）：

| | 角色 |
|---|---|
| **ccloop**（`/Users/biran/code/skills/loop/ccloop`） | **一个工具**——把单个任务跑成循环。Orca 的**依赖**，不是 submodule |
| **Orca**（本仓库） | **系统**——工头 ＋ 工地记录 ＋ 看板 |
| **ccmem**（`/Users/biran/code/skills/ccmem`） | **记忆层**——Claude Code 插件，走 CLI/DB 接口，**一个字都不 vendor** |

⚠️ **最容易搞混的一点**：`.decisions/` 台账**既不住 Orca 也不住 ccmem**，它住在**被干活的那个目标仓库**里。
**Orca 装的是工具，不是台账。**

---

## 先跑这些，以输出为准

```bash
cd /Users/biran/code/skills/loop/Orca
git ls-remote origin refs/heads/main    # ⚠️ 开工核一次、收尾再核一次——人会自己推远端
git status --short; git log --oneline -5
```

⚠️ **判断远端只能 `git ls-remote`**，`git status` 的 `ahead N` 是缓存 ref。
⚠️ **验证性命令一律走 `rtk proxy`**：rtk 的过滤层会骗你（空 porcelain 打印 `ok`、0 字节报成 1 字节、
长 grep 截断、**含括号的正则直接报错**）。整份读回一律 `rtk proxy … > 文件` 再 `cat`。

---

## 当前状态（2026-08-29）

**仓库状态**：本轮之前只有 `LICENSE` ＋ 一笔 `Initial commit`，远端与本地同点。

**已完成**：
1. **子系统 A′ 的设计（spec）已写完并通过一轮评审 ＋ 修复**（六条发现全修）。
2. **`CLAUDE.md` 已建**（135 行；人拍板继承 ccloop 那套，并已逐条审过：5 条原样、7 条改、4 条新增）。

| 材料 | 路径 |
|---|---|
| **A′ 决策台账设计（spec）** | `docs/superpowers/specs/2026-08-29-decision-ledger-design.md` |
| **本仓库开发规则** | `CLAUDE.md` |

⚠️ *** **`CLAUDE.md` 的作用域**：它只管「在本仓库里开发 Orca」的 agent，
**不管 Orca 运行时派出去处理【别的仓库】的 agent** —— 后者由 spec 与每个任务的契约管。
权限三档（Tier 0/1/2）是**产品设计，写在 spec 里**，不在 `CLAUDE.md` 里。 ***

**尚无任何代码。** `package.json`、目录骨架都还没有——**建之前要先出实施计划并另拿授权**。

---

## ⛔ 下一件事

> ⚠️ *** **本节已被本文档末尾的「本轮（2026-08-29，会话 09cc3ea1）」一节取代 —— 以那一节为准。** ***
> **让它过期的是提交主题行 `docs(plan): 把 A′ 的 spec 变成 8 个任务，并让 Orca 自食其果`。**
> 原文按 Rule 13 逐字保留在下面。

### ~~跑 `superpowers:writing-plans`，把 A′ 的 spec 变成实施计划。人已授权。~~ ⇒ **已做完**

**开工前按顺序读**：
1. `CLAUDE.md`（本仓库规则，**注意开头的作用域声明**）
2. `docs/superpowers/specs/2026-08-29-decision-ledger-design.md`（**尤其 §9：三仓库关系**）
3. 本文档

⚠️ **`writing-plans` 写完必须跑它自带的自查三项**（spec 覆盖／占位符扫描／类型一致）。
ccloop 实测：那三项抓出过硬错（一处「期望方向写反」、一处「spec 的前提没有任何一步去量它」）。**别跳过。**

⚠️ **计划的第一个可执行件应该是 spec §3.8 的校验器** —— 它是 spec 里唯一明确要求必须实现的东西，
且它给之后每一条台账记录提供「合不合法」的机械判据。**没有它，别的都无从验收。**

### 已经不再未决

~~Orca 是否继承 ccloop 的 `CLAUDE.md`~~ ⇒ *** **人已拍板：继承，且已逐条审过。** ***
⚠️ spec §9.3 仍写着这条"未决"，**那一节现在已过时** —— 以本节为准（spec 是已提交文本，不就地改）。

### 五个子系统的顺序（人已认可）

**A′ → (B ∥ C) → D → E**

| | 子系统 | 状态 |
|---|---|---|
| **A′** | 决策台账（分层／所有权／失效） | *** **spec 已过审，下一步出实施计划** *** |
| **B** | ccmem 倾向 track | 未开工。吃 A′ 的 `corrections` 里 `kind = not_my_taste` 的对照样本 |
| **C** | 调度层（queue over ccloop） | 未开工。与 A′ 解耦，可与 B 并行 |
| **D** | 检查点交接（上下文水位触发） | 未开工，依赖 C |
| **E** | Web 面板 | 未开工，依赖 A′、B |

---

## 已经拍板过的事（**不要重开**）

1. **权限模型**：Tier 0 机制禁止／Tier 1 自决留痕／Tier 2 不记录；
   **`undo.how` 说不清 ⇒ 自动降级 Tier 0**。
2. **人裁的触发条件**：不是「agent 不确定」，是「**两个事实打架且能摆出两边**」。
   不确定但无冲突 ⇒ **强制一轮自我反驳** → 自决 → 记台账。
3. **台账存储**：**git 为真相源 ＋ DB 做索引**；每个 agent 只写 `.decisions/<run-id>.jsonl`
   （**结构上不可能冲突**）；**不存 commit hash**，由 `git blame --follow` 反查。
4. **依赖方式**：ccloop 走 npm 依赖（锁版本），**ccmem 不 vendor**，**都不用 submodule**。
5. **`CLAUDE.md` 硬预算 ≤ 200 行**（人拍的；一份草稿写的 80 行太严）。
6. **并行判据**：写集 ＝ `targetPaths` ∪ `allowlistPaths`，**相交 ⇒ 串行**。
   合并进**集成分支** = Tier 1，合并进 **main / push** = **Tier 0**。

---

## 方法论（从 ccloop 带过来的，**直接用**）

1. *** **一条变异在被【看到】打红之前，它不是证明。** *** ccloop 实测栽过五次「绿是空的」——
   红线函数改成永不被调用、判据照绿；删掉一整行写入、判据照绿。
   ⇒ **每新增一个分支，点名那条删掉【它自己】的变异，并确认它存在且被看见红。**
2. **「红在哪条断言」不是可靠的判别方式**——前面的断言会先短路。**要量什么就直接量什么。**
3. **改代码/注释按【整行锚点 ＋ 命中数 ==1 否则退出】**，子串替换会在句子中间切开段落。
   （本轮六条修复就是这么做的。）
4. **spec／plan 的自查真能抓东西**：本轮自查抓出「引用了不存在的 §3.8」这个悬空引用。**别跳过自查。**
5. *** **绝不过滤验证性跑** ***（`grep`/`tail`/`head`/`sed` 都算，管道还会吞退出码）。
6. *** **成本只报工具给出的数，拿不到就说拿不到，不许自估。** ***
7. **本机 `rm` 和 `cp` 都有 `-i` alias** —— 一律用 `/bin/rm -rf` 和 `cat pristine > target`。

---

## 边界

- **push 需人单独授权。控制器不许 push。**
- **本仓库的规则不外溢到 ccloop**：ccloop 包 2 那一轮（E1 的 I-2、人裁 85）仍完整跑在它自己的铁律下。
  见 spec §7 —— 这条边界必须守住，否则这套设计会变成一条中途放宽 ccloop 规则的后门。

---

## 姊妹仓库的同批改动（**已完成；仅供知情，不是本仓库的任务**）

| 仓库 | 改了什么 |
|---|---|
| **ccloop** | 铁律从 `docs/handoff/handoff.md` **迁入 `CLAUDE.md`（Rule 13–18）** —— 承重规则不该住在允许整篇重写、且多 agent 共享的活文档里。handoff 原文**未删**（那一轮还在飞），已声明以 `CLAUDE.md` 为准，属**已知的临时重复**。 |
| **ccmem** | 补 **Rule 13 用户数据** —— 它是三个仓库里**唯一会写 `~/.claude/` 下用户数据**的（`global.db` 实测 150MB+、近万条），而此前 12 条规则一条都没提到。 |
| **三者** | **Rule 6 写明单位是【上下文窗口占用】**，不是累计消耗；每会话额度**统一为 450,000**（此前 ccloop 400,000 / ccmem 450,000 —— 两文件只差这一个数字，属复制漂移，实测 `diff` 只有一行）。 |

⚠️ *** **ccloop 与 ccmem 的改动只在本地提交，未 push（控制器不许 push）。** ***
⚠️ *** **本仓库【已被人自己推过一次】** *** —— `.git/logs/refs/remotes/origin/main` 里有一条
`update by push`，推的人是 `biran`，推上去的是**主题行为 `docs(spec): land the A' decision-ledger design …`**
的那一笔。**这不是控制器干的，控制器一次都没 push。**
⚠️ **本文不写死任何 SHA** —— 提交本文这个动作本身就会改 HEAD，而人还会继续自己推。
⇒ *** **spec 从那一刻起是【已发布文本】：只能追加具名 ERRATUM，不许就地改。** ***
⇒ *** **判断某一笔发没发布，只能现跑 `git ls-remote` ＋ `git merge-base --is-ancestor`，不许查本文。** ***

---

## Suggested skills

| skill | 什么时候用 |
|---|---|
| ~~**`superpowers:writing-plans`**~~ | ~~下一件事就是它~~ ⇒ **已跑完，计划已落地**。⚠️ 它自带的自查三项（spec 覆盖／占位符扫描／类型一致）**本轮各抓到一处**，别跳过 |
| **`superpowers:subagent-driven-development`** | *** **下一件事就是它**（若人选执行方式 1）。*** 每 Task 一个新 subagent，任务间过审 |
| **`superpowers:executing-plans`** | 若人选执行方式 2（本会话内批量跑，设检查点） |
| `superpowers:brainstorming` | 开 B／C／D／E 任何一个子系统的设计之前。⚠️ architectural 路径的终点只能接 `writing-plans` |
| `superpowers:verification-before-completion` | *** 每次要说「做完了／通过了／绿了」之前。 *** 本仓库 Rule 12 与它同形 |
| `superpowers:test-driven-development` | 写校验器（spec §3.8）时。⚠️ 本仓库 Rule 9 要求**每个分支配一条点名删掉它自己的变异** |
| `superpowers:systematic-debugging` | 出现红／行为不符时**先用它**，别直接改代码 |
| `superpowers:requesting-code-review` | 派评审时。⚠️ 派之前先报预估：ccloop 实测「派评审→修复→复审」一轮是**几十美元**量级 |

⚠️ **skill 与本仓库 `CLAUDE.md` 冲突时，`CLAUDE.md` 优先**（Rule 11：conformance > taste）。

---

# 📌 本轮（2026-08-29，会话 `09cc3ea1`）—— A′ 的实施计划已落地并已发布

**归属**：run `orca-dev-09cc3ea1`。要指代本轮那一笔，引主题行
`docs(plan): 把 A′ 的 spec 变成 8 个任务，并让 Orca 自食其果`。**本节同样不写任何 SHA。**

## 做完了什么

1. `superpowers:writing-plans` 跑完，产出 **`docs/superpowers/plans/2026-08-29-decision-ledger-validator.md`**（8 个任务）。
2. 它自带的**自查三项各抓到一处并已修**（内容在计划文末 Self-Review 一节，**不在此重复**）。
3. **人手动把这一笔推上了远端** ⇒ 计划现在也是**已发布文本**。

## 没做什么

*** **仍然零产品代码。** *** `package.json`、`src/**`、`tests/**`、`.decisions/**` **都还不存在** ——
它们是计划里 Task 1–8 要造的东西。上面「当前状态」一节说的"尚无任何代码"**至今为真**。

## ⚠️ 三条会改变你怎么干活的事实（**都是本轮现测，不是转述**）

### 1. `CLAUDE.md`、本文档、以及那份计划，现在**都已发布**

本轮**开工时**远端只到 spec 那一笔，**收尾时**已经到计划那一笔 ——
*** **人在会话中途手动推了两次。控制器一次都没 push。** ***

⇒ **别信任何文档写的发布状态**，一律现跑：

```bash
git ls-remote origin refs/heads/main
git merge-base --is-ancestor <要查的提交> <上面查到的远端 tip> && echo 已发布 || echo 未发布
```

⇒ 但 *** **计划里的 `- [ ]` 复选框照勾。** *** 勾选是**进度状态**，不是改写论断。
**改某个 Task 的内容**才需要另起一节写具名更正 —— 这条界线要守住，否则计划没法执行。

### 2. *** `rtk proxy git log` 会漏笔 —— 这是第五种骗法，且最危险 ***

本轮实测：`rtk proxy git log --oneline -8` 的输出**以第二新的那笔开头**，
**HEAD 那一笔（主题行 `update .gitignore`）整个不见了**；裸 `git log --oneline -3` 能看到。
是 `git rev-list --count` 报出的笔数对不上，才把它揪出来的。

本文档此前只记了 rtk 的四种骗法（空 porcelain 打印 `ok`、0 字节报成 1 字节、长 grep 截断、含括号正则报错）。
**漏笔是第五种，也是最危险的一种** —— 前四种会让你怀疑，这一种让你**以为自己知道 HEAD 是什么**。

⇒ *** **验证性 git 命令一律走裸 `git`，不走 rtk。** ***

### 3. zsh 会吃掉不加引号的 `--include=*.ts`

报 `no matches found: --include=*.ts`，**且整条 `{ ...; }` 复合命令连带 exit 1、重定向出来的文件是空的** ——
读起来完全像"命令没跑"。加引号 `--include="*.ts"` 即可。

## ⛔ 下一件事：**执行那份计划**

**执行方式人尚未选定。** 两个选项都写在计划文末：

| | 方式 | 代价 |
|---|---|---|
| **1（本轮推荐）** | `superpowers:subagent-driven-development` —— 每 Task 一个新 subagent，任务间过审 | 贵，但那 **18 条点名变异**有独立复核 |
| **2** | `superpowers:executing-plans` —— 本会话内批量跑，设检查点 | 便宜，但写实现与验变异是**同一个上下文** |

⚠️ **推荐 1 的理由不是口味**：写实现的人与验变异的人若是同一个上下文，
极容易把**「我知道它会红」当成「我看见它红了」** —— 那正是 ccloop 栽过五次的形状
（见上面「方法论」第 1 条）。

## 计划里已经替 spec 判掉的 7 处（**别重开**）

都落在 spec 的**留白**或 spec **内部打架**的地方，逐条带 `alternatives` ＋ 可执行的 `undo.how` ＋
引到 spec 具体行的 `evidence`。**清单在计划的「本计划自己做的 7 条决策」一节，不在此重复。**

这里只留一条要点：*** **这 7 条同时就是 `.decisions/orca-dev-09cc3ea1.jsonl` 的头 7 行。** ***
Task 1 手写它们（那时写入方还不存在）→ Task 7 用写入方复现并**比字节** →
Task 8 把「校验它全绿」接进 `npm run verify` 与 pre-commit。
**这就是 dogfood 的闭环，别当装饰拆掉。**

## 一条在**起草阶段**就抓到的硬错（**记住这个形状**）

`undo.how` 的「可执行形式」谓词，spec §1.1.1 只给了 3 正 3 反共 6 个例子。
本轮把谓词单独跑了一遍（`node`，9/9 判对），顺带发现：

> *** **spec 自己给的前两个合法例，被谓词的两个子句【同时】接住** ***
> （`git branch -f int/a <ref>` 的 `int/a`、`rm -rf .decisions/…` 的路径，都含 `/`）。

⇒ 只拿那 6 个例子当判据的话，**把整条「命令形」子句删掉，测试照样全绿** —— **半道闸门会静默消失。**
计划因此给两个子句**各补了一条只有它能接住的独占判据**，并配 M3-a／M3-b 两条点名变异。

**这是「一条判据在被看到打红之前不是判据」在【写计划阶段】就兑现了一次**，而不是写完代码之后。
⇒ **下一轮遇到任何"多子句谓词"，先问：哪条例子只有这一支能接住？** 答不上来，那一支就是死码。

## 姊妹仓库本轮的同批动作（**已完成；知情，不是本仓库的任务**）

给 `ccloop` 与 `ccmem` 的 `docs/handoff/handoff.md` **各追加了一节**（**都只追加，上文一字未动**），
内容是 Orca 这条线的进度更新，以及**一处对它们各自 handoff 的具名更正**：
两边都写着「只在本地提交，没有 push」，而现测两边本地与远端同点 ⇒
*** **那两份 `CLAUDE.md` 现在也都是已发布文本。** ***
对那两个仓库**均不产生任务**；ccloop 那节另外点名了一件事 ——
**契约的 `targetPaths` ／ `allowlistPaths` 两个字段现在多了一个下游消费者（Orca 的并行判据）。**

---

# 📌 本轮（2026-09-01，会话 `cd28ef61`）—— 开工核对 ＋ 三条语言约定

**归属**：run `orca-dev-cd28ef61`。本节**只追加**，上面一字未动。
本节写下时的仓库位置：**远端与本地 `main` 同点，tip 的主题行是 `update handoff docs`**
（口径：`git ls-remote origin refs/heads/main` ＋ 裸 `git log --oneline -6`，本会话现测）。
**本节同样不写任何 SHA。**

## 🔴 三条语言约定（人 2026-09-01 当面交代，**从本轮起对所有后续会话生效**）

| 写什么 | 用哪种语言 |
|---|---|
| **与人的对话** | **中文** |
| **`docs/handoff/handoff.md`** | **中文** |
| **代码、代码注释、CLI help 文本、README ＋同类产品文档** | *** **英文** *** |

⚠️ **这条会直接改变计划的执行**：
`docs/superpowers/plans/2026-08-29-decision-ledger-validator.md` 里的代码块**带中文注释**
（例如 Task 1 冒烟判据里那两行"这条判据存在的唯一理由…"）。
⇒ *** **照抄代码块时，把其中的注释与字符串改写成英文；逻辑、断言、变异表一字不动。** ***
计划本身是**已发布文本，不就地改** —— 本节即为该差异的具名登记。

⚠️ **spec 与 plan 保持现有的中文**，理由同上：它们是已发布文本，改动只能追加具名 ERRATUM。

## 开工核对的实测结果（**都带命令，都是本轮现测**）

| 量 | 值 | 测量命令 |
|---|---|---|
| 远端 tip 与本地 | **同点** | `git ls-remote origin refs/heads/main` ＋ `git log --oneline -6` |
| 工作树 | **干净** | `git status --short`（空输出） |
| worktree | **只有主工作树一个** | `git worktree list` |
| 被跟踪文件 | **6 个**：`.gitignore` / `CLAUDE.md` / `LICENSE` ＋ handoff ＋ spec ＋ plan | `git ls-files` |
| node / npm | **v22.13.1** / **10.9.2** | `node -v`；`npm -v` |

⇒ *** **「Orca 至今零产品代码」在本轮开工时仍然为真**，`package.json`、`src/**`、`tests/**`、
`.decisions/**` 一个都不存在。 ***
⇒ node 22 满足计划 Tech Stack 要求的 **Node ≥ 20**。

## 一处需要人拍板才动的地方（**已识别，未自作主张**）

计划把台账文件写死成 `.decisions/orca-dev-09cc3ea1.jsonl`（**上一会话的 id**），
而本轮的 run 是 `orca-dev-cd28ef61`。
*** **按计划逐字照做是对的** *** —— 那 7 条决策确实是 09cc3ea1 那一轮做的，署它的名才是真的归属。
**本轮如果自己新做了决策，要另开 `.decisions/orca-dev-cd28ef61.jsonl`，不许混进上一轮的文件。**

## 姊妹仓库本轮状态（**只读，未触碰**）

- **ccloop**：下一件事仍是 E1 的 I-2 ＋ 人裁 85，与本轮无关。
- **ccmem**：下一件事仍是 P0#2 源码核查 → W1 → W2 → W3，与本轮无关。
- *** **本轮对这两个仓库【一个字节都没写】。** ***

---

# 📌 本轮（2026-09-01／02，会话 `cd28ef61`）—— A′ 的校验器已全部落地，Orca 有产品代码了

**归属**：run `orca-dev-cd28ef61`。本节**只追加**，上面一字未动。
⚠️ **本节同样不写任何当前哈希** —— 提交本文这个动作本身就会改 HEAD。要指代某一笔就**引提交主题行**。

## 一句话状态

*** **「Orca 至今零产品代码」这句话到本轮为止不再为真。** *** 那份 8 任务的计划
（`docs/superpowers/plans/2026-08-29-decision-ledger-validator.md`）**已全部执行完毕**，
外加一轮整支复审的修复。**一次都没有 push、没有建分支、没有合并、没有删任何 worktree。**

## 30 秒核对现状（**以输出为准，别信本文**）

```bash
cd /Users/biran/code/skills/loop/Orca
git ls-remote origin refs/heads/main    # ⚠️ 人会自己推，开工核一次收尾再核一次
git status --short; git log --oneline -14
npm run verify                          # 期望 exit 0，且最后三行是下面这三条
```

`npm run verify` 期望输出的末三行（**都是本轮现测**）：

```
ok: 1 ledger file(s)          ← 会随台账文件数变，本轮结束时是 2
ok: CLAUDE.md is 135/200 lines
ok: core.hooksPath is scripts/githooks
```

⚠️ **验证性 git 命令走裸 `git`，不走 rtk**（rtk 会漏掉 HEAD 那一笔，见上一节第 2 条）。

## 造出来的东西

| 路径 | 是什么 |
|---|---|
| `src/ledger/{types,schema,undoExecutable,validateLine,validateFile,appendOnly,writer}.ts` | spec §3.8 六项检查 ＋ fail-closed 写入方 |
| `src/cli.ts` | `validate` / `check-append-only`，退出码 **0／1／2** |
| `scripts/githooks/pre-commit`、`scripts/check-claude-md-lines.mjs`、`scripts/check-hooks-path.mjs` | 提交闸门 ＋ `CLAUDE.md ≤ 200 行`预算 ＋ hook 装没装上的断言 |
| `.decisions/orca-dev-09cc3ea1.jsonl` | 上一轮 7 条决策 ＋ 7 条 `bound`（计划自己做的判断） |
| `.decisions/orca-dev-cd28ef61.jsonl` | **本轮 13 条裁决**，全部经 `appendEvent` 落盘，无一手写 |
| `.superpowers/sdd/2026-08-29-decision-ledger-validator/progress.md` ＋ 9 份 `*-report.md` | 16 条裁决全文、每个任务的评审结论、**18＋条点名变异「看见红」的原始输出** |

⚠️ *** **`.superpowers/sdd/` 整个被 gitignore（该目录的 `.gitignore` 内容是 `*`），上面那批是 `git add -f` 进去的。
在该目录下新增任何要留存的东西，都必须 `-f`。** *** `review-*.diff` 与 `task-*-brief.md` **故意没入库** ——
前者 `git diff` 可重生成，后者由 `scripts/task-brief` 从计划里机械抽取。

## 🔴 四条「全绿但是坏的」——本轮最贵的知识，**下一轮直接用**

这四条**没有一条**能被单个任务的判据抓到，全都是跨任务或跨层才显形的。

1. *** **schema 的 `.strict()` 拒绝了本仓库自己台账里 7 条真决策中的全部 7 条**（缺 `evidence` 字段），
   而当时 34 条判据全绿。 *** 根因是**所有判据用的都是手搓 fixture，没有一条拿真数据跑过**。
   ⇒ 修复里补了一条**直接读仓库自己的 `.decisions/*.jsonl` 断言每行都 ok** 的回归判据。
   **这条判据是承重的，别删。** 它把 dogfood 闭环从 Task 8 提前到了 Task 2。
2. *** **写入方从来没跑过检查 5。** *** 写一条引用不存在 id 的 `bound`，写入方照收、`validateFile` 随即判 rejected ——
   而台账只追加，**唯一的修法是手改文件，也就是这套系统存在的理由所要禁止的动作**。
3. *** **结尾没有换行的台账有两个独立的坑。** *** ①检查 6 会把纯追加判成非追加，且**每次都会**，文件从此锁死；
   ②写入方会把新记录**粘在上一条后面**，报成功、落盘、`validateFile` 判 not valid JSON。
   两条都实测复现过，都已修并配判据。
4. *** **这道门曾经以未武装状态出厂。** *** `core.hooksPath` 是**本地 git config，不是版本库内容** ——
   新 clone 根本没有 hook，而没有任何东西会发现。现在由 npm `prepare` 装完即武装，`verify` 再断言一次。

## 🔴 三条工具骗法（**都是本轮实测，此前没记过**）

1. *** **`git checkout -- <本任务刚创建、尚未提交的文件>` 报 `pathspec did not match` 且什么都不还原。** ***
   计划里每个任务 Step 5 的变异还原命令都是它 ⇒ **5 个任务会失败，Task 3 更糟——它变异的文件是上一个任务提交过的，
   `checkout` 会成功并静默丢掉本任务自己的实现。** ⇒ 变异一律在 `git clone --local` 副本里做（这本来就是 CLAUDE.md Rule 15）。
2. *** **`git diff` 对未跟踪文件的内容改动完全看不见。** *** 覆写一个未跟踪文件，前后都是 0 字节，
   `git status` 打印同一行 `??`。⇒ **「主树零触碰」的证明用 `shasum -a 256` 前后比对，不用 `git diff | wc -c`。**
3. **`git checkout -- <path>` 是从【索引】恢复，不是从 HEAD。** 文件已暂存时，它会把暂存的（坏的）内容写回工作树。
   本轮的一个探针就栽在这上面，把「门挡住了」误读成「门不放行合法追加」。

## ⚠️ 发布状态（**只能现跑 `ls-remote` 判，不许查本文**）

本轮**开工时**远端只到上一节那一笔，**中途人自己又推了一次**（推到了 Task 2 那一笔）。
⇒ **同一会话里远端被推动过两次以上是常态。** 每次要判某笔发没发布，现跑：

```bash
git ls-remote origin refs/heads/main
git merge-base --is-ancestor <要查的提交> <上面查到的远端 tip> && echo 已发布 || echo 未发布
```

## ⛔ 下一件事（**人尚未选定**）

计划里的 A′ 已经做完，**下一步是选 B 还是 C**（顺序 A′ → (B ∥ C) → D → E，人已认可）：

| | 子系统 | 现在的入口条件 |
|---|---|---|
| **C（调度层）** | queue over ccloop | 与 A′ 解耦，**可以直接开 brainstorming**。写集判据（`targetPaths` ∪ `allowlistPaths`）与 run-id 分配规则都已在 spec 里登记 |
| **B（ccmem 倾向 track）** | 吃 `corrections` 里 `kind = not_my_taste` 的对照样本 | ⚠️ **`corrections` 与 `overturned` 的完整字段形状至今没有定**（本轮的决策 `orca-dev-09cc3ea1/5` 只钉了 `ev` ＋ `id`）。B 开工前要先补这个 |

## 已知没做的（**登记，不掩饰**）

计划自己的「已知缺口」7 条**全部仍然成立**（见计划文末，不在此重复）。本轮另加：

- **run-id 分配规则仍属 C** —— 两个 agent 各自挑到同一个 run-id 时，spec §3.1「结构上不可能冲突」的保证失效。
- **`validateLine.ts` 里有第四份引用事件清单**（一条 OR 链）。它是路由条件不是白名单，当前无行为依赖它同步；**加第五种事件类型时会咬人**。
- **`appendEvent` 不校验事件的 `run` 字段与文件名是否一致**，也**不拒绝重复的 decision id** —— 两者都超出 spec §3.8 的六项检查，属 spec 问题不是实现 bug，但**面板（E）会需要 id 唯一**，而台账只追加。
- **退出码 2（降级）目前没有任何消费者**：`set -e` 与 `&&` 都把 1 和 2 一样地当成停。它是为面板准备的，不是死码，**但别把那几条判据读成「已经有人在用它」**。
- ⚠️ *** **两份台账里 `decision` 的 `at` 都是【批量回填】的同一个时刻** ***（上一轮 7 条同为一个值，本轮 13 条同为另一个值）。
  **别把 `at` 读成「这条决策是那一刻做出的」。** 本轮的决策 `orca-dev-cd28ef61/13` 记的就是这件事本身。

## Suggested skills

| skill | 什么时候用 |
|---|---|
| `superpowers:brainstorming` | *** **开 B 或 C 之前的第一件事。** *** ⚠️ architectural 路径的终点只能接 `writing-plans` |
| `superpowers:writing-plans` | brainstorming 出 spec 之后。⚠️ 自带的自查三项**本轮又各抓到一处**，别跳过 |
| `superpowers:subagent-driven-development` | 执行计划时。⚠️ **本轮实测它值这个钱**：18 条变异有独立复核，且整支复审抓到 5 条没有任何单任务评审能看见的 Important |
| `superpowers:verification-before-completion` | *** 每次要说「做完了／绿了」之前。 *** |
| `superpowers:test-driven-development` | 补新判据时。⚠️ Rule 9 要求每个分支配一条点名删掉它自己的变异 |
| `superpowers:systematic-debugging` | 出现红／行为不符时**先用它** |

⚠️ **skill 与 `CLAUDE.md` 冲突时，`CLAUDE.md` 优先**（Rule 11）。
⚠️ **计划与 spec 冲突时，spec 优先** —— 本轮有 4 次是这么判的，逐条记在本轮台账里。

---

# 📌 本轮（2026-09-02，会话 `894ae173`）—— C 已选定并完成同类系统调研；**尚未写 spec、未动任何代码**

**归属**：run `orca-dev-894ae173`。本节**只追加**，上面一字未动。
⚠️ **本节同样不写任何当前哈希** —— 提交本文这个动作本身就会改 HEAD。要指代某一笔就**引提交主题行**。

## 🔴 一、语言约定新增第四条（人 2026-09-02 当面交代）

上一节记的三条（对话中文／handoff 中文／代码与 README 英文）**全部继续有效**，新增：

| 写什么 | 用哪种语言 |
|---|---|
| *** **git commit message** *** | *** **英文，不许用中文** *** |

⚠️ **生效边界**：**只对新提交生效。**
本仓库**已有的 16 笔提交 message 全是中文**（例如 `docs(handoff): 记下 A′ 校验器已全部落地`），
且**都已推上远端 ⇒ 是已发布历史，不改**。
要连历史一起改写属 `filter-branch` / `rebase` 级的不可逆动作，**需人单独授权**，本轮未做也未提议。

## 🔴 二、一处具名更正：「Orca 一次都没 push」现在为假

上一节（2026-09-01／02）写着「**Orca 那边一次都没 push**」，**原文逐字保留，此处即为具名更正**。

本轮开工现测：`git ls-remote origin refs/heads/main` 与本地 `main` **同点**，
远端 tip 就是含全部 16 笔的那一笔（主题行 `docs(handoff): 记下 A′ 校验器已全部落地…`）。
*** **推的人是人类，手动推的。控制器仍然一次都没 push。** ***

⇒ *** **A′ 校验器的全部产品代码、两份台账、`.superpowers/sdd/` 那批证据，现在都是【已发布文本】。** ***

⚠️ **同样的话在姊妹仓库的 handoff 里也各有一句已经为假**（ccloop 的「📌 Orca 那条线：A′ 的校验器已全部落地」一节、
ccmem 的 §16），都写着「Orca 那边一次都没 push」。
*** **本轮【没有】去改那两个仓库的任何文件** *** —— 它们各自有在飞的工作，按 Rule 3 是禁区。
**此处只登记，供那两个仓库的下一轮自行决定是否追加更正。**

## 三、开工核对（**都带命令，本轮现测**）

| 量 | 值 | 测量命令 |
|---|---|---|
| 远端与本地 `main` | **同点** | `git ls-remote origin refs/heads/main` ＋ 裸 `git log --oneline -16` |
| 工作树 | **干净**（空输出） | `git status --short` |
| worktree | **只有主工作树一个** | `git worktree list` |
| `npm run verify` | *** **exit 0** ***，`7 files / 100 tests` 全绿 | `npm run verify > 文件 2>&1; echo $?` |
| verify 末三行 | `ok: 2 ledger file(s)` ／ `ok: CLAUDE.md is 135/200 lines` ／ `ok: core.hooksPath is scripts/githooks` | 同上 |

## 四、人本轮拍的三件事

1. **下一件事是 C（调度层）**，不是 B。（B 的入口条件仍不满足 —— `corrections` / `overturned` 字段形状至今未定。）
2. **C 的 v1 打在一次性沙盒仓上** —— 不是本仓库、不是 ccloop。⇒ 可全程用 `scripted` adapter，**不花 claude 的钱**。
3. **C v1 负责整合**：每任务一个 `git clone --local` 副本当 `repoPath`，跑完 `git apply` ＋ commit，
   再 fetch 回主仓合进集成分支。（备选的「每任务一个 worktree」被否，因为 N 个并行任务
   ＋ ccloop 自己的 attempt worktree 会在同一个 `.git` 上争 worktree 列表锁。）

## 五、⭐ 本轮的主要产出：一份调研文档

*** **`docs/superpowers/research/2026-09-02-scheduler-prior-art.md`（新目录 `research/`）** ***

读了 9 个同类系统（hermes-agent／snakemake／bazel／buck2／airflow／zuul／bors-ng／nextflow／pants），
出 **17 条借鉴 ＋ 4 处对 A′ spec 的实质补充 ＋ 7 条 ccloop 现测事实**。
*** **每一条都带文件行号，可现场核；本节不复述，读那份文档。** ***

⚠️ 该文档 §1 逐仓库列了**读了什么、没读什么** —— **引用它任何一条之前先看那一节**，
每个仓库都只读了目标问题那几十到几百行，没有一个是通读的。

### 🔴 其中两条是**立场修正**，会改变 C 怎么设计（详见该文档 §0）

**修正 A —— 主干和优化此前是反的。** 人指出：*** **你无法禁止 agent 在执行任务时改哪些文件。** ***
本轮现测核实为真（ccloop 的 `evaluatePathPolicy` 是**纯事后检测器**，见该文档 §5 第 3 条）。
⇒ *** **冲突的检测／分类／解决／验证是主干；写集相交判据是一个降低进入主干频率的优化。
判据算错时系统必须仍然正确 —— 这不是容错，是它的常态。** ***

**修正 B —— Rule 7 此前被读窄了。** 先前立场是「合并冲突一律升人，不做自动和解」。
Rule 7 的实际分档是**证据能分胜负 ⇒ agent 自己判**；而多数 git 冲突是**文本型**的，证据能分胜负。
且「这个冲突属于哪一类」正是 Rule 5 明确列出**该用模型做**的事（classification）。
⇒ 分工改为：**代码检测并枚举 → 模型分类并解 → 代码验证（跑两边 `requiredChecks` 的并集）→ 只有语义型残余升人**。
⚠️ **唯一保留的约束：解冲突的不能是当事任务本身**（缺对方意图，会可靠地覆盖对方或放弃自己）。
⚠️ **和解时逐块做的每个判断都进台账**，Tier 1，`undo.how` 天然写得出（reset 集成分支）。

## 六、⛔ 下一件事：**写 C 的 spec**

`superpowers:brainstorming` 的 architectural 路径已走到「探上下文 ＋ 问清楚 ＋ 定方案」，
**分节设计与 spec 尚未开始**。下一步：

1. 按修订后的方案走**分节设计**（架构／组件边界／数据流／冲突处理与四态路由／判据），每节过人；
2. 写 `docs/superpowers/specs/2026-09-02-scheduler-design.md`；
3. 跑 spec 自查四项 → 人审 → 接 `superpowers:writing-plans`。

⚠️ **强烈建议开新会话做这件事。** 本会话上下文里塞满了 9 个参考仓库的源码片段，
写 spec 用不上它们，却要为它们付每一次调用的钱 —— 本轮成本就是这么上去的（见下）。
**那份调研文档就是为这次交接写的，接手时读它，不要重读那 9 个仓库。**

## 七、本轮**没有**做的（登记，不掩饰）

- *** **一行产品代码都没写**，`src/**`、`tests/**` 一个字节未动。 ***
- *** **`.decisions/orca-dev-894ae173.jsonl` 本轮未创建。** *** 本轮的判断都还是**提案**，
  要等 C 的 spec 落地那一刻才生效，届时一并用写入方落盘。**这是有意的，不是漏掉的。**
- **未 push、未建分支、未合并、未删任何 worktree。**
- **对 ccloop 与 ccmem 两个仓库一个字节都没写**（只读了它们的源码与 handoff）。

## 八、成本

**只抄工具报数**（Rule 14）：本会话钩子报出的总额从 **$20.60 → $25.32 → $69.72 → $77.56** 一路上行。

⚠️ *** **贵的不是读文件本身，是上下文变大之后每一次调用都在重发整份。** ***
⇒ **教训：大规模调研要么单开会话，要么读完立刻落文档并交接。** 本轮是读完才落，晚了。

## 九、姊妹仓库本轮的同批动作（**已完成；知情，不是本仓库的任务**）

人 2026-09-02 指出：**Orca 的章节不能在姊妹仓库里无限增加下去**。此前 ccloop 有 **3 节**、
ccmem 有 **2 节**各自独立的 Orca 章节，每来一次就加一节。

⇒ 本轮把它们**各自合并成一节，并声明今后就地更新、不再新增编号章节**：

| 仓库 | 动作 | 合法性依据 |
|---|---|---|
| **ccloop** | 3 节 → 1 节「📌 Orca 那条线（单节滚动更新）」。**它自己的两节（铁律迁入 `CLAUDE.md`、README）一字未动** | 其 `CLAUDE.md:74` 与其 handoff 铁律 4 都明写 `docs/handoff/**` 是**允许整篇重写**的活文档，只是「不得把已知为假的说法带下去」 |
| **ccmem** | §15＋§16 → 单个 §15。**§1–§14 一字未动** | 其 `CLAUDE.md` 无 handoff 相关条款；按 ccloop 同款活文档惯例处理，并在节内写明合并授权来自人 |

⚠️ **两处删除都不是丢失** —— 原文可由 `git log -- docs/handoff/handoff.md` 取回，两节都写明了这一点。
⚠️ **两边都只在本地提交，没有 push**（push 需人单独授权）。**`src/**`、`tests/**`、
`scripts/**`、`hooks/**`、`.superpowers/**` 与任何在飞的 worktree 一个字节都没碰。**

**顺带给 ccloop 报了两条关于它自己的诊断**（按 Rule 3 只报诊断、不动手）：
`evaluatePathPolicy` 是纯事后检测器而非闸门；`targetPaths` 根本没被它读。
**两条都明确写成「不是任务，要不要补由本仓库自己决定」。**

---

# 📌 本轮（2026-09-03，会话 `8d4c6ba3`）—— C 的 spec 已落地；**ccloop 多了一条硬前置**

**归属**：run `orca-dev-8d4c6ba3`。本节**只追加**，上面一字未动。
⚠️ **本节同样不写任何当前哈希** —— 提交本文这个动作本身就会改 HEAD。要指代某一笔就**引提交主题行**。

## 一、开工核对（都带命令，本轮现测）

| 量 | 值 | 命令 |
|---|---|---|
| 远端 `main` tip | 主题行 `docs(handoff): 记下 A′ 校验器已全部落地…` | `git ls-remote origin refs/heads/main` |
| 本地 `main` | *** **领先远端两笔** *** | 裸 `git log --oneline -5` |
| 工作树 | 干净（空输出） | `git status --short` |
| worktree | 只有主工作树一个 | `git worktree list` |
| `npm run verify` | **exit 0**，`7 files / 100 tests` | `npm run verify > 文件 2>&1; echo $?` |

🔴 *** **一条具名更正**：上一节（2026-09-02，会话 `894ae173`）写着「远端与本地同点」——
**本轮开工时已经不是了**。领先的两笔是 `docs(research): survey nine schedulers before designing subsystem C`
与 `docs(handoff): record the sister-repo consolidation`。 ***
⇒ **那份调研文档和上一节 handoff 本身【尚未发布】**（写下本节的这一刻仍然如此）。
⇒ 老结论再确认一次：**发布状态只能现跑 `ls-remote` 判，任何文档里写的都只在写下那秒为真。**

## 二、🔴 人本轮扩大了一处授权

> **人 2026-09-03 原话：「如果需要 ccloop 和 ccmem 一起改动的话，允许你改动。」**

本轮据此定的用法（已进台账，`orca-dev-8d4c6ba3/1`）：
**先报「要改什么、为什么非改不可」再动手；动手时守它们【自己】的规则；push 仍每次单独找人。**
⚠️ **授权扩大的是「能不能碰」，不是「碰的时候守谁的规矩」**（Rule 16 ／ A′ §7）。
⚠️ *** **本轮实际上对 ccloop 与 ccmem 一个字节都没写** *** —— 只读了它们的源码。

## 三、做完了什么

| 产物 | 路径 |
|---|---|
| **C（调度层）的 spec** | `docs/superpowers/specs/2026-09-03-scheduler-design.md`（十一节） |
| **本轮 20 条决策** | `.decisions/orca-dev-8d4c6ba3.jsonl`，**全部经 `appendEvent` 落盘，无一手写** |

提交主题行：`docs(spec): design subsystem C, the scheduler over ccloop`。

⚠️ **文件名与上一节的预告不一致**：上一节预告的是 `2026-09-02-scheduler-design.md`，
实际写于 09-03 ⇒ 按实际日期命名。*** **那个名字下没有文件，不要去找。** ***

## 四、🔴 四条现测，**每一条都改变了设计**（都带命令与观测时的 commit）

**观测时点 2026-09-03，ccloop HEAD `0f7fc28e8bdc573ba22840d3c7e00e25d8927b17`**，
口径一律 `sed -n` / `/usr/bin/grep -n` 重定向到文件再整份读回。

1. *** **`scripted` adapter 根本不产 `diffPatch`。** *** `diffPatch` 是 adapter 结果的**可选**字段
   （`src/runtime/types.ts:42`），落盘处有守卫（`fileStore.ts:1738`）；
   grep `diffPatch|changedFiles|artifacts` 在 `src/runtime/scriptedAdapter.ts` **零命中**。
   ⇒ **「v1 先用 patch 兜底」这条路没有输入** ⇒ 见第五节。
2. *** **`run`/`resume` 的退出码是 `status === "succeeded" ? 0 : 2`** ***（`src/cli.ts` 两处一模一样，catch 里 1）。
   ⇒ **四个非成功终态被压成同一个 2** ⇒ **C 必须读 `loop-state.json` 的 `status`，只看退出码不够。**
3. *** **`blocked_waiting_human` 是终态（`legalTransitions` 里是 `[]`）且不可 resume** ***
   （`resumeLoop.ts:98`：`RESUMABLE_STATUSES = ["planning","executing","verifying"]`）。
   ⇒ 调研文档借鉴 2 写的「等人不是终态」是**从 Airflow 借的应然，不是 ccloop 的实然**。
4. **`readDiffPatch`（`scripts/claude-phase-runner.mjs:232`）有三条通向静默空补丁的路**：
   两处 `git diff` **都没有 `--binary`**（二进制 `git apply` 应用不了）；`maxBuffer` 10MB 超了抛错；
   而 `readGitDiff` 的 catch **只对 `code === 1` 返回 stdout，其余一律返回 `""`**。
   ⚠️ **未跟踪文件是被收进来的**（逐个合成 `/dev/null` diff）—— 这点 ccloop 做对了，别误报。

## 五、⛔ 下一件事：**接 `writing-plans`，但要出三份计划**

spec 自查的**范围**一项**没有通过**（如实登记在 spec §10.7）。本文要求的东西横跨**两个仓库、三个块**：

| 块 | 内容 | 说明 |
|---|---|---|
| **P0** | *** **ccloop 在移除 worktree 前 commit ＋ 写 `refs/ccloop/<run-id>/attempts/<n>` ＋ 报 sha** *** | **C v1 的硬前置**（不是建议）。**在 ccloop 仓库、按它自己的流程做**。纯追加，满足它铁律 2 |
| **P1** | A′ 台账三处扩展：新 kind `reconcile`、写入方补两条检查、`bound` 加 `taskId`/`runId` | ⚠️ **先做「白名单在代码里有几份副本」的普查**（handoff 已警告 `validateLine.ts` 里有第四份） |
| **P2** | C 本体：spec §2–§9 ＋ §10.2 的 **19 个场景** ＋ §10.3 的 **12 条点名变异** | 依赖 P0、P1 |

🔴 **P1 里有一条不能延后**：`bound` 加 `taskId`/`runId` 是**写入侧**的 ——
*** **台账只追加，格式错过就永远补不上。** *** 它必须在 C 写下第一条 `bound` 之前落地。

**执行方式建议 `superpowers:subagent-driven-development`**（handoff 实测「值这个钱」）。

## 六、设计上最值钱的一条（**下一轮直接用**）

> *** **凡是 C 够不着的动作，只能【检测 ＋ 降级】，不能声称禁止。声称禁止就是把一条不成立的前提写进设计。** ***

同一个形状在本轮出现了**三次**：禁不了 agent 改哪些文件 ⇒ 冲突处理是主干；
禁不了写集判据算错 ⇒ 判据错时系统必须仍正确；**禁不了人在合 PR 时 squash ⇒ 台账必须在归属被销毁后仍可用**。
第三条是人本轮当面指出来的，spec 已立成 §0.1。

## 七、本轮**没有**做的（登记，不掩饰）

- *** **一行产品代码都没写**，`src/**`、`tests/**` 一个字节未动。 ***
- **未 push、未建分支、未合并、未删任何 worktree。**
- **对 ccloop 与 ccmem 一个字节都没写**（虽然人已授权可以改）。
- **spec 尚未经人审阅** —— 下一步是人审 → 接 `writing-plans`。

## 八、成本

**只抄工具报数**（Rule 14）：本会话钩子最后报出的是 **~$37.45**（在写 spec 之前那一刻）。
**写 spec 与本节之后的数没有再被工具报出，因此不写** —— 不许自估。

### 九、⚠️ 对本节第一节的一处具名更正（**同会话，收尾时现测**）

本节开头写着「那份调研文档和上一节 handoff **尚未发布**（写下本节的这一刻仍然如此）」——
*** **收尾核对时这句话已经为假。** ***

**现测**（`git ls-remote origin refs/heads/main`，本会话收尾）：远端 tip 已经推进到主题行
`docs(handoff): record the sister-repo consolidation` 那一笔 ⇒
*** **调研文档与上一节 handoff 现在【都是已发布文本】。** ***

*** **推的人是人类，在本会话进行中手动推的。控制器仍然一次都没 push。** ***
⇒ 本轮自己的两笔（`docs(spec): design subsystem C…` 与 `docs(handoff): record subsystem C's spec…`）
**仍只在本地。**

⚠️ **原文逐字保留，此处即为更正**（按注释铁律：那句话写下时为真，不属「从未为真」的笔误，不许就地改）。
⚠️ **这条本身就是第一节那个结论的第三次兑现**：
*** **同一会话里远端被推动是常态。要判某笔发没发布，现跑 `ls-remote`，连本节都不要信。** ***

### 十、本节写下之后又做的三件事（**同会话续写，上面一字未动**）

1. **给 spec 做了一轮评审并修掉 8 条**（提交主题行 `docs(spec): fix eight defects a review pass found in the scheduler design`）。
   ⚠️ **这是控制器自己的评审，不是外派评审员。** 要不要再派独立评审，人尚未决定
   （handoff 实测一轮「派评审→修复→复审」是**几十美元**量级）。
2. **写了 P0 的一页提案** → `docs/superpowers/proposals/2026-09-03-ccloop-p0-publish-attempt-commit.md`（**新目录 `proposals/`**）。
3. **在 ccloop 的「📌 Orca 那条线」那一节里加了指针**（**就地更新，没新增章节**，人单独授权）。

### 十一、🔴 评审抓到的三条硬的（**下一轮直接用，别重新发现**）

细节在 spec，此处只留形状：

1. *** **C 会 `git checkout` 目标仓的工作树，而 spec 从头到尾没说。** *** 合并进 W 必须先在 W 上。
   §1.2 那把锁挡的是**另一个 orca**，**挡不住人自己开着仓库在干活** ⇒ 新增 §4.2.1：工作树不干净当场拒。
2. *** **退出码有个真空**：`blocked_waiting_human` 写着「升人但不算失败」，**却既不在 2 也不在 3**；
   且「同时有失败又有升人」未定义。 *** ⇒ 钉死 **3 > 2 > 1 > 0**。
3. *** **三条变异没有任何场景喂它们**（`M-LOCK` / `M-BOUND` / `M-TREE`）。 ***
   这正是 ccloop 栽过的「**没跑过的那条变异**」形状 ⇒ 变异表加了「喂它的场景」一列。
   **今后写变异表就带这一列**，缺了就是缺证据。

⚠️ 还有一条**机械教训**：**同一张 markdown 表格中间插内容会把表切断**，
本轮 S14–S17 一度渲染成散文而没人发现。**改表之后要整份读回看渲染，不只看 diff。**

### 十二、🔴 「别把 HEAD 写死」这条本轮兑现了一次

人 2026-09-03 指出：**handoff 这篇文档的提交本身就会改 HEAD**。
本轮确实踩了 —— 在 ccloop 那节写了「写入时本仓库 HEAD 为 `0f7fc28…`」，
*** **提交那一节的动作当场就让它过期。** *** 已改成引主题行（提交主题行
`docs(handoff): stop pinning a hard HEAD in the Orca section`）。

⇒ **划界**（两者不要混）：
- **「当前状态」里的 HEAD** ⇒ **不许写**，引主题行。
- **「Rule 14 的观测时 commit」** ⇒ *** **必须写** *** —— 那是实测值的有效期锚点，不是当前状态。
  spec 与提案里的 `0f7fc28…` 属**后者，是对的，别去掉。**

### 十三、收尾状态（**以现跑为准**）

| 仓库 | 本地领先远端 | 本轮改了什么 |
|---|---|---|
| **Orca** | **若干笔，未 push** | spec ／ 20 条决策台账 ／ 提案 ／ 本文 |
| **ccloop** | **三笔，未 push** | *** **只有 `docs/handoff/handoff.md` 一个文件** ***；`src/**`、`tests/**`、`scripts/**`、`.superpowers/**` 零触碰 |
| **ccmem** | — | *** **一个字节都没碰**（人交代：它正被另一个 agent 更新） *** |

`npm run verify` **exit 0**（Orca 侧）。**两个仓库都没 push。**

### 十四、⛔ 下一件事：**接 `writing-plans`，出三份计划**

见 spec §10.7。顺序 **P0（ccloop 交 commit）→ P1（A′ 台账三处扩展）→ P2（C 本体）**。
🔴 **P1 里 `bound` 加 `taskId`/`runId` 那条不能延后** —— 台账只追加，**格式错过就永远补不上**。

⚠️ **强烈建议开新会话**：本会话上下文里塞满了 ccloop 的源码片段，写计划用不上，
却要为它们付每一次调用的钱。**本会话钩子最后报出 ~$90.82**（Rule 14：只抄工具报数）。

---

# 📌 本轮（2026-09-03，会话 `10762e47`）—— 三份计划已落地；ccloop 的「下一件事」被人改了

**归属**：run `orca-dev-10762e47`。本节**只追加**，上面一字未动。
⚠️ **本节不写任何当前哈希** —— 提交本文这个动作本身就会改 HEAD。要指代某一笔就**引提交主题行**。

## 一、开工核对（都带命令，本轮现测）

| 量 | 值 | 命令 |
|---|---|---|
| Orca 远端／本地 `main` | **同点**，tip 主题行 `docs(handoff): continue this round's section with the review and the proposal` | `/usr/bin/git ls-remote origin refs/heads/main` ＋ 裸 `git log --oneline -8` |
| Orca 工作树 ／ worktree | 干净 ／ 只有主工作树 | `git status --short`；`git worktree list` |
| `npm run verify` | *** **exit 0** ***，`7 files / 100 tests`，末三行 `ok: 3 ledger file(s)` ／ `ok: CLAUDE.md is 135/200 lines` ／ `ok: core.hooksPath is scripts/githooks` | `npm run verify > 文件 2>&1; echo $?` |
| ccloop 远端／本地 `main` | **同点**，tip `7caa4cb`（主题行 `docs(handoff): stop pinning a hard HEAD in the Orca section`），工作树干净 | `git -C …/ccloop ls-remote` ＋ `log` |
| ccloop `0f7fc28..7caa4cb` 对 `src`／`scripts`／`tests` 的改动 | *** **空输出 ⇒ 零触碰** *** | `git -C …/ccloop diff --stat 0f7fc28 7caa4cb -- src scripts tests` |

### 🔴 一处具名更正：上一节第十三节的「本地领先远端、两个仓库都没 push」现在为假

上一节（会话 `8d4c6ba3`）第十三节的表写着 **Orca 本地领先若干笔、ccloop 领先三笔、两个仓库都没 push**。
*** **本轮开工现测：两边都与各自远端同点。推的人是人类，手动推的；控制器仍然一次都没 push。** ***
⇒ *** **C 的 spec、那 20 条决策台账、P0 提案、ccloop 那三笔文档，现在全是【已发布文本】** ***，
只能追加具名 ERRATUM。**原文逐字保留，此处即为更正。**

⚠️ **ccloop 侧的推论**：spec 与提案里标注的 ccloop 实测（观测时 commit `0f7fc28…`）**仍然有效** ——
`0f7fc28..7caa4cb` 之间只有 `docs/handoff/handoff.md` 一个文件被改过。**但行号引用前仍请现测。**

## 二、🔴 人本轮拍了五件事（**逐条援引，不要重开**）

| # | 问的什么 | 裁决 |
|---|---|---|
| **1** | P0 把 sha 报进 `attempts/<n>/` 的产物文件，还是让 ref 本身当产物 | **ref 本身当产物**（`fileStore.ts` 零触碰） |
| **2** | 要不要**现在**动 ccloop | 🔴 *** **现在就动。** *** 原话：「现在就动 ccloop，先做 Orca 这部分工作，**E1 的 I-2 ＋ 人裁 85 顺延**，**人裁 121 仍有效**。」 |
| **3** | P1 要不要改写两条既有的承重判据 | **改写成新的真事实，不删** |
| **4** | 历史 `bound` 让 verify 变红怎么收 | **选 (a)**：报 downgraded（退出码 2）；**(b) 移进 `archive/` 已被否** |
| **5** | 要不要改掉 spec §8.2 建议的任务顺序 | **改序，并追加具名 ERRATUM** |

### 🔴 裁决 2 改变的是 **ccloop 自己的「下一件事」**，读它的三层意思，一层都不要多读

1. **P0 现在排在 E1 的 I-2 ＋ 人裁 85 【前面】** —— 那一轮**顺延，不是取消**。
2. *** **人裁 121 仍然有效** *** —— 它当初授权的是「开工设计 E1 的 I-2 与人裁 85」，顺延**不撤销它**。
3. ⚠️ *** **E1 仍在授权面外。** *** ccloop handoff 明写「E1 出完设计、动生产代码之前必须**另拿一次具名授权**」——
   **本次裁决没有碰这一条。**

⚠️ *** **push 仍需单独授权，裁决 2 不含 push。** ***
⚠️ **本轮对 ccloop 与 ccmem 仍然【一个字节都没写】** —— 只读了 ccloop 的源码。
**上面这条裁决要写回 ccloop 的 handoff，那是【下一轮的第一件事之一】，本轮没做。**

## 三、做完了什么

| 产物 | 路径 | 行数 |
|---|---|---|
| **P0 计划**（在 ccloop 执行） | `docs/superpowers/plans/2026-09-03-p0-ccloop-publish-attempt-commit.md` | 963 |
| **P1 计划**（A′ 台账三处扩展） | `docs/superpowers/plans/2026-09-03-p1-ledger-extensions-for-c.md` | 1043 |
| **P2 计划**（C 本体） | `docs/superpowers/plans/2026-09-03-p2-scheduler-c.md` | 1403 |
| **本轮 16 条决策** | `.decisions/orca-dev-10762e47.jsonl`，**全部经 `appendEvent` 落盘，无一手写** | 16 |

`npm run verify` **exit 0**，末三行 `ok: 4 ledger file(s)` ／ `ok: CLAUDE.md is 135/200 lines` ／ `ok: core.hooksPath is scripts/githooks`。

## 四、🔴 五条现测，**每一条都改变了计划的形状**（下一轮直接用，别重新发现）

### 1. ccloop 的 cleanup 有 **12 个调用点，但只有 2 个收敛点**

`cleanupAttemptWorkspace` 本体只有一行（`worktreeManager.ts:29`）。**11 个**走
`cleanupAttemptWorkspaceWithStatus`（`runLoop.ts:331`），*** **第 12 个是 `runLoop.ts:1494` 的裸调用** ***
（verification rejected 之后的重试路径，且它要求移除失败仍然致命）。
⇒ 逐点改 ＝ 12 次漏掉一次的机会，而 ccloop 自己的教训是「**半改比不改坏**」。
**口径**：`/usr/bin/grep -rn cleanupAttemptWorkspace src/`，观测时 ccloop `7caa4cb`。

### 2. 提案原文的第 4 步会把手伸进 `fileStore.ts` 的地盘

`attempts/<n>/` 由 `fileStore.ts:1726` 写，**而红线函数 `tryRecoverStaleOwnerTransferLock` 就在那个文件里**。
⇒ 改用 **ref 本身当产物**，P0 的改动收敛到 `worktreeManager.ts` ＋ `runLoop.ts` 两个文件。

### 3. 🔴 spec §5.5 把两件事接错了（已立 ERRATUM，写在 P1 计划的 Task 5）

它担心「加 `reconcile` 时第四份清单会咬人」——
*** **第四份清单是【引用事件】的（`validateLine.ts:45` 的 OR 链），不是【决策 kind】的。** ***
kind 在 `src/` 里只有一份（`types.ts`），加 `reconcile` 是**一行改动**。
那条 OR 链**真正咬人的时刻是 `bound` 需要自己的 schema 那一刻**（§8.4②）。

### 4. kind 的**第二份副本在判据里**（`tests/ledger/validateLine.test.ts:84` 硬编码 6 个名字的循环）

加第 7 个 kind **不会红，只会静默不覆盖**。
⇒ *** **「少跑一条」在 vitest 里是绿的，不是红的。** *** 必须另加一条 `.length` 判据才看得见。
⚠️ **P1 如实登记了一条【不可观测的变异】**（`M1-12`：把循环改回硬编码）——
它的防线是代码评审，不是判据。**登记它比假装它红过有用。**

### 5. 🔴🔴 **「schema 可选 ＋ 写入方必需」这个直觉上安全的方案，并不安全**

`tests/ledger/writer.test.ts:173` 那条判据把 `orca-dev-09cc3ea1.jsonl` 的 **14 行逐条喂进 `appendEvent` 重放并比字节**，
而那 7 条历史 `bound` **7/7 缺 `taskId`/`runId`**（本轮逐行数过）。
⇒ **无论要求放 schema 还是放写入方，那条既有的承重判据都会红**；且 `verify` 里含 `orca validate .decisions`，
历史文件会让整支 verify 变 exit 1。**这是裁决 3、4 存在的原因。**

## 五、🔴 本轮闸门自己抓到的一件事（**最好的一次 dogfood**）

写台账时，`appendEvent` **当场拦下第 3 条决策**：

```
refusing to append: downgraded to tier 0, this decision is not the agent's to make:
undo.how is not executable: "去掉 --allow-empty 这一个参数"
```

随后把剩余 14 条一次性喂进谓词审计：*** **10 条不合格。** ***
⇒ 全部改写成**指名具体文件路径**的形式再落盘。

⚠️ **两条推论**：
1. *** **散文式的 `undo.how` 是默认产物，不是偶发。** *** 不带闸门写台账，十条里有七条是废的。
2. **台账只追加 ⇒ 前两条已经落盘，重跑必须从第 3 条续写**，脚本里加了 `START` 而不是重跑全量。
   （`appendEvent` 目前**不拒绝重复 decision id** —— 那正是 P1 Task 3 要补的检查之一。）

## 六、⛔ 下一件事（**按依赖排，人已授权全部三块**）

| 顺序 | 做什么 | 在哪 |
|---|---|---|
| **0** | 🔴 **把裁决 2 写回 ccloop 的 handoff「📌 Orca 那条线」一节**（就地更新，不新增章节）—— 它改了那个仓库自己的「下一件事」，**不写回去等于让下一个 agent 照着旧顺序开工** | ccloop |
| **1** | 执行 **P0**（`git worktree remove` 之前 commit ＋ 写 ref） | ccloop |
| **2** | 执行 **P1**（`bound` 字段那条**不能延后**） | Orca |
| **3** | 执行 **P2**（22 场景 / 14 变异） | Orca |

⚠️ **P0 ∥ P1 之间没有依赖**，依赖只有「两者都在 P2 之前」。
**执行方式建议 `superpowers:subagent-driven-development`**（handoff 实测「值这个钱」）。

⚠️ **三份计划各自末尾都有一节写「执行前的裁决」与「Self-Review」** —— **开工前逐条读，不要跳。**
P1 与 P2 各自登记了缺口（P1 三处、P2 三处），**都是有意划界，不是遗漏**。

## 七、本轮**没有**做的（登记，不掩饰）

- *** **一行产品代码都没写**，`src/**`、`tests/**` 一个字节未动。 ***
- **未 push、未建分支、未合并、未删任何 worktree。**
- *** **对 ccloop 与 ccmem 一个字节都没写** *** —— 虽然人已授权，且裁决 2 明确要动 ccloop。
  **那是执行阶段的事，本轮只出计划。**
- **spec 的 ERRATUM 尚未写进 spec** —— 它是 P1 Task 5 的一个步骤，**随 P1 执行时落地**。
- **没有派外派评审。** 三份计划都只过了控制器自己的 Self-Review 三项。
  要不要派，人尚未决定（handoff 实测一轮「派评审→修复→复审」是**几十美元**量级）。

## 八、ccmem 侧（**只读，本轮零触碰**）

最新是 **ⅩⅩⅥ（W2 已合入 `main`）**，下一件事是 **W3**（设计与 11 任务的计划都已落盘），
**6 条禁令一条都没解**（含不许 push、`config-value-parity` 不合并、7 个死键不删）。
⚠️ 它的 **§15「Orca 那条线」停在 2026-09-02**，还写着「C 的设计尚未开写」——
*** **已知陈旧，本轮不改**（人交代 ccmem 是禁区，另一个 agent 在跑 W3）。 ***

## 九、成本

**只抄工具报数**（Rule 14）：本会话钩子报出的总额从 **$8.49 → $44.29** 一路上行。
**此后的数没有再被工具报出，因此不写 —— 不许自估。**

### 十、本节写下之后又做的三件事（**同会话续写，上面一字未动；本节即为对第七节的具名更正**）

第七节写着「*** **对 ccloop 与 ccmem 一个字节都没写** ***」。
*** **对 ccloop 这句话现在为假**（对 ccmem 仍然为真）。原文逐字保留，此处即为更正。 ***

#### 1. 🔴 ccloop 的 handoff 已更新 —— **它自己的「下一件事」被改了**

提交主题行 `docs(handoff): record the ruling that puts P0 ahead of E1's I-2 and ruling 85`。
*** **只改了 `docs/handoff/handoff.md` 一个文件**；`src/**`、`tests/**`、`scripts/**`、
`.superpowers/**` 零触碰。未 push。 ***

改了三处（都在那一个文件里）：

| 改哪 | 为什么 |
|---|---|
| **顶部标题行** | 它写着「下一件事是 E1 的 I-2 与人裁 85」——**已知为假**，而 ccloop 铁律 4 明写活文档「不得把已知为假的说法带下去」 |
| **「⛔ 下一件事」新增第 0 条** | 记下人的裁决与它的三层边界；**原有的 1／2／3 条一字未动** |
| **「📌 Orca 那条线」整节就地重写** | 人 2026-09-02 定的规矩：Orca 的更新只能就地更新那一节，**不新增编号章节** |

#### 2. ⛔ ccmem **没有动，而且【现在不能动】**

**现测**（`git -C …/ccmem branch -vv` ＋ `worktree list` ＋ `diff --stat main HEAD -- docs/handoff/handoff.md`）：

| 量 | 值 |
|---|---|
| ccmem 主工作树所在分支 | *** **`w3-threat-scan-bypass-suite`，不是 `main`** *** |
| 该分支 tip 主题行 | `docs(handoff): record round XXVII — W3 built and reviewed, merge and version bump left to a human` |
| 该分支相对 `main` 在 handoff 上的差异 | **+148 / −1 行**（ⅩⅩⅦ 整节**尚未合进 main**） |
| 另有 worktree | **2 个** |

⇒ *** **此刻对它 `docs/handoff/handoff.md` 的任何写入，都会落进另一个 agent 尚未合并的分支里。** ***
按 `CLAUDE.md` Rule 3（**别的 agent 的分支是禁区，只报诊断和建议的补丁，不动手**）⇒ **不动手。**
且 W3 自己写明「合并与 bump 版本号等人裁决」，往那条分支上追加会把无关改动卷进那次裁决。

⇒ **替换文本已备好，整节替换 §15，不新增编号章节**，落在
`<本会话 scratchpad>/ccmem-section-15-replacement.md`。
⚠️ **scratchpad 是会话级临时目录，会被清理** ⇒ **要留就尽快转存**，
或直接照本节记的三条要点重写（§15 要更新的实质只有三条：C 的三份计划已写完、
`bound` 即将加 `taskId`/`runId` 且**只能变这一次**、B 的入口条件仍不满足）。
**建议的应用时机：等 W3 合进 `main` 之后，或由跑 W3 的那条线顺手带上。**

#### 3. 本轮那两笔提交被**重建过一次**（补归属尾注）

最初提交时漏了系统要求的 `Co-Authored-By` ＋ `Claude-Session` 尾注。两笔**都未 push** ⇒
重建并补上，**并用【树哈希前后逐字相同】＋ `git diff <旧 HEAD> HEAD --stat` 空输出证明内容一个字节没变**。
旧提交仍在 reflog 里。

⚠️ *** **这条是给下一轮的方法论**：本仓库的全局规则是「宁可新提交，不要 amend」，
而补尾注属于**必须改写提交信息**的情形。**改写未 push 的提交本身不在 Rule 15 的四件事里**
（push／合并 main／删分支／删 worktree），**但证明必须是树哈希，不是肉眼看 diff**。 ***

#### 4. 收尾状态（**以现跑为准，本节不写哈希**）

| 仓库 | 本轮改了什么 | 状态 |
|---|---|---|
| **Orca** | 三份计划 ＋ 16 条决策台账 ＋ 本文 | 本地领先远端，**未 push**；`npm run verify` **exit 0** |
| **ccloop** | *** **只有 `docs/handoff/handoff.md` 一个文件** *** | 本地领先远端一笔，**未 push**；工作树干净 |
| **ccmem** | *** **一个字节都没碰** *** | 主工作树在别人的分支上，**禁区** |

---

# 📌 本轮（2026-09-03／04，会话 `213d1395`）—— **P1 与 P0 都已执行完毕**；ccloop 第一次有了本轮线写的产品代码

**归属**：run `orca-dev-213d1395`。本节**只追加**，上面一字未动。
⚠️ **本节不写任何当前哈希** —— 提交本文这个动作本身就会改 HEAD。要指代某一笔就**引提交主题行**。
（例外同上一节第十二条：**实测值的观测锚点 commit 必须写**，那是有效期，不是当前状态。）

## 一、开工核对（都带命令，本轮现测）

| 量 | 值 | 命令 |
|---|---|---|
| Orca 远端 `main` | tip 主题行 `docs(handoff): continue this round's section with the review and the proposal` | `/usr/bin/git ls-remote origin refs/heads/main` |
| Orca 本地 `main` | **领先远端三笔**（三份计划 ＋ 两笔 handoff） | 裸 `git log --oneline -6` |
| Orca `npm run verify` | **exit 0**，`7 files / 100 tests`，末三行 `ok: 4 ledger file(s)` ／ `ok: CLAUDE.md is 135/200 lines` ／ `ok: core.hooksPath is scripts/githooks` | `npm run verify > 文件 2>&1; echo $?` |
| ccloop 远端／本地 | 远端 `7caa4cb`，本地 `7b44220` **领先一笔**，工作树干净，只有主工作树 | `/usr/bin/git -C …/ccloop ls-remote` ＋ `log` ＋ `status` ＋ `worktree list` |
| ccloop 基线 | *** **`35 files / 614 tests`，零 skipped，TEST／TYPECHECK／BUILD 三个 RC 全 0，17.00s** *** | `export ECC_GATEGUARD=off DISABLE_OMC=1; npm test -- --run > 文件 2>&1` |
| ccmem | 主工作树在 `w3-threat-scan-bypass-suite`（别人未合并的分支），W3 未合并、版本号未 bump | **只读，本轮零触碰** |

## 二、🔴 人本轮拍的三件事（**逐条援引，不要重开**）

| # | 问的什么 | 裁决 |
|---|---|---|
| **1** | P1 与 P0 谁先做 | *** **P1 先，P0 后。** *** 理由：`bound` 的 `taskId`/`runId` 是写入侧格式、台账只追加，是整个队列里**唯一不可逆**的东西；先落地，P0 的 bound 才能用最终格式写 |
| **2** | 执行方式 | **本会话内直接执行**，每个 Task 之间设检查点（不派 subagent） |
| **3** | P0 Task 2 的成功事件打红 17 条既有判据怎么收 | 🔴 *** **撤掉成功事件，只保留 `attempt_commit_publish_failed`。** *** 依据是人裁「ref 本身就是产物」—— 成功事件与 ref 重复，失败事件不重复 |

⚠️ **裁决 3 是 ccloop 铁律 2 强制升人的那个形状**（不许实施者自改既有判据）。**不是我自己判的。**

## 三、做完了什么

### P1（本仓库，5 个任务，5 笔提交）

按提交主题行找：`refactor(ledger): derive the reference-event router from its single source` →
`feat(ledger): require taskId and runId on bound events` →
`feat(ledger): reject a mismatched run field and a duplicate decision id at the writer` →
`feat(ledger): add the reconcile decision kind` →
`docs(spec): record two errata the P1 execution turned up, and land P1's own decisions`。

**收尾实测**：`npm run verify` **exit 0**，`7 files / 119 tests`（基线 100 → 119）。
**14 条点名变异，13 条被看见红**；`M1-12` 如实登记为**不可观测**。

### P0（在 ccloop，4 个任务，4 笔提交）

按提交主题行找：`feat(worktree): publish each attempt as a commit reachable through a ref` →
`feat(runLoop): publish the attempt commit before the worktree is removed` →
`feat(runLoop): publish on the retry path too, the twelfth cleanup call site` →
`docs(readme): document the attempt commit refs and what they cost`。

**收尾实测**：*** **`35 files / 624 tests`（基线 614 + 10，与计划预期一致），零 skipped，三个 RC 全 0，23.92s。** ***
`git diff --stat 7b44220 HEAD -- scripts/` 与 `-- src/persistence/` **均为空输出**
⇒ *** **`fileStore.ts` 与 `claude-phase-runner.mjs` 零触碰，`diff.patch` 采集路径一个字节没变。** ***
**M0-1 ～ M0-7 七条变异全部被看见红。**

### 台账与更正

- `.decisions/orca-dev-213d1395.jsonl`：**14 条决策，全部经 `appendEvent` 落盘，无一手写**。
- C 的 spec 追加了 **ERRATUM 1／ERRATUM 2**（正文一字未动）。
- P0 计划追加了 **ERRATUM 1**（五节，正文一字未动）。

## 四、🔴 六条现测，**每一条都推翻了计划写的东西**（下一轮直接用，别重新发现）

### 1. P1 打红的既有判据是 **12 条**，不是计划普查结论四说的 2 条

分类：**8 条**是顺带拿 `bound` 当第二个事件的夹具（补两个字段，度量的东西一字未变）；
**1 条**是 Task 1 自己新加的最小记录判据；**2 条**是人裁 1 授权改写的承重判据；
*** **第 12 条是 spec §3.3 那个逐字 `bound` 示例 —— 它从本轮起被判 `downgraded`。** ***
理由与那 7 行历史 `bound` 完全同构：**写在字段存在之前**。已立 ERRATUM 2。

### 2. 🔴 **pre-commit 闸门是退出码 2 的第二个消费者，计划只改了第一个**

计划的 D6 只把 `package.json` 的 verify 串改成容忍 2。`scripts/githooks/pre-commit` 第 6 行是 `set -e`，
第 26 行是 `validate .decisions` ⇒ *** **每一笔提交都被挡住。** ***
**这条不是预测出来的，是第一次提交真的返回 `COMMIT_RC=1` 才暴露的。**
⇒ **教训**：*** **「让一个退出码被接受」这件事要先普查【有几个消费者】，一个一个数出来。** ***

### 3. 🔴 变异 `M1-3` 的失效**整支 104 条判据没有一条能看见**

不是「某条判据没红」，是**整支全绿**。根因：`referenceEventSchema` 自己的 `z.enum` 也会拒掉游离名字，
而既有那条 `rejects unknown ev` **只断言 verdict、不断言理由**。
⇒ **只加一条钉住拒绝理由的判据**（不改任何既有判据）之后才看见红。

### 4. 🔴 变异 `M0-4` 第一次跑是**绿的** —— 判据是空的

「仓库里没配 git 身份」**不足以让 `git commit` 失败**：git 会从 OS 用户名与主机名自己猜一个身份，
带警告提交成功。探针四场景实测在 P0 计划的 ERRATUM 1 第 2 节。
真正会失败的条件是 **`user.useConfigOnly=true` ＋ 全局／系统配置为空**（CI 容器的形状）。
⇒ *** **计划决策 D4 的【措施】正确，但它写的【理由】不准。** ***

### 5. **「少跑一条」在 vitest 里是绿的**，而且连计数都要另外配

`M1-12`（把 kind 循环改回硬编码六个名字）实测 **exit 0、全绿，只是该文件从 50 条掉到 49 条**。
⇒ **少跑的那一条只在计数里露头，不会红。** 登记为不可观测变异，防线是代码评审。

### 6. `undoExecutable` 谓词有**假阴性**（此前只登记过假阳性）

实测：`git checkout <sha> -- README.md` **被判不可执行**。
命令形子句要求**相邻两 token 的第二个像参数**，而 `git checkout` 的第二个 token 是子命令；
`README.md` 不含斜杠、不是驼峰，命名目标那一支也接不住。
⇒ **本轮没有放宽谓词**（决策 `/14`）：闸门本轮已两次拦下真正的散文，放宽换来的是更多散文溜过去；
假阴性的代价只是多写一个路径。

## 五、闸门本轮又抓到两次（**dogfood 仍然有效**）

1. 写台账时 `appendEvent` **当场拦下第 1 条决策**（`undo.how` 是散文）。
   ⇒ **这次没有逐条试**，而是**先把全部 8 条 `undo.how` 机械审一遍**再改 —— 只有 1 条不合格，
   但另有 3 条是靠「散文里恰好含一个路径」过闸的，一并改成真命令。
2. 写 P0 那批决策时**又拦下一条**（上面第四节第 6 条那个假阴性）。

## 六、三条工具坑（**都是本轮实测，此前没记过**）

1. 🔴 *** **zsh 对无引号变量不做词分割。** *** `FILES="a b c"; for f in $FILES` 会把三个路径当成**一个词**，
   于是「把工作树文件覆盖进 clone 副本」那一步**静默没执行**，而后续的 `npm run verify` 照样 exit 0 ——
   **量的是错的树**。⇒ **副本覆盖一律用字面列表，并逐个 `diff` 打印 `IDENTICAL`。**
2. *** **`throw` 挪进 `try` 会被它自己的 `catch` 吞掉，而判据可能照绿。** *** `M1-10` 实测复现。
3. `git clone --local` 的副本里**软链主树的 `node_modules` 就够跑测试**，不必 `npm ci`
   （本轮 Orca 与 ccloop 两边各用了多次）。⚠️ 删副本前先 `/bin/rm -f <副本>/node_modules` 删软链本身。

## 七、本轮**没有**做的（登记，不掩饰）

- *** **P2 一行都没写。** *** 它有 15 个任务 / 22 场景 / 14 变异，硬依赖 P0 ＋ P1，**建议单开会话**。
- *** **未 push、未建分支、未合并、未删任何分支或 worktree。** *** 两个仓库都有未 push 的提交。
- **对 ccmem 一个字节都没碰** —— 它的主工作树仍在别人未合并的 W3 分支上。
  ⚠️ 上一节第十节留下的 §15 替换文本在**上一会话的 scratchpad** 里，**那个目录已经不可用** ——
  要更新 ccmem 的 §15，按上一节记的三条要点重写即可（C 的三份计划已写完、`bound` 已经加上
  `taskId`/`runId`【本轮已落地，不再是「即将」】、B 的入口条件仍不满足）。
- **没有派外派评审。** 九笔实现只过了控制器自己的变异表与整支验证。
- **ccloop 的 E1 的 I-2 ＋ 人裁 85 一个字节没碰**（人裁 121 仍然有效，那一轮仍在授权面外）。

## 八、⛔ 下一件事

> ⚠️ *** **本节已被本文档末尾「本轮（2026-09-04，会话 `c2fd0c3b`）」一节取代 —— 以那一节为准。** ***
> **让它过期的是：P2 的 15 个任务全部执行完毕并过审**（提交主题行
> `docs(sdd): preserve subsystem C's execution record …` 是本轮最后一笔）。
> 第 2 条（ccloop 回到 E1 的 I-2 ＋ 人裁 85）与第 3 条（ccmem §15）**仍然有效**，只是第 1 条已完成。
> 原文按 Rule 13 逐字保留在下面。

| 顺序 | 做什么 | 在哪 |
|---|---|---|
| **1** | 🔴 **执行 P2**（`docs/superpowers/plans/2026-09-03-p2-scheduler-c.md`，15 个任务） | Orca。**开工前先读 P0／P1 两份计划末尾的 ERRATUM** |
| **2** | ccloop 回到 **E1 的 I-2 ＋ 人裁 85**（人裁 121 仍有效；**E1 动生产代码前仍需另拿一次具名授权**） | ccloop |
| **3** | ccmem §15 的更新（**等 W3 合进 main 之后**，或由跑 W3 的那条线顺手带上） | ccmem |

⚠️ **两个仓库的未 push 提交都等人单独授权。控制器不许 push。**

## 九、成本

**只抄工具报数**（Rule 14）：**本会话的钩子在写下本节之前没有报出过任何金额，因此不写 —— 不许自估。**

### 十、本节写下之后又做的两件事（**同会话续写，上面一字未动**）

第三节写「P0（在 ccloop，4 个任务，4 笔提交）」—— 那说的是**四个任务**的四笔。
收尾又在 ccloop 落了**第五笔文档提交**，此处登记：

#### 1. ccloop 的 handoff 已更新（**只改了 `docs/handoff/handoff.md` 一个文件**）

提交主题行 `docs(handoff): record that P0 is done and move the baseline to 624`。
*** **`src/**`、`tests/**`、`scripts/**`、`.superpowers/**` 零触碰。未 push。** ***

改了五处，**全部是「活文档不得把已知为假的说法带下去」（ccloop 铁律 4）**：

| 改哪 | 为什么 |
|---|---|
| 顶部标题行 | 它写着「下一件事是 P0」——**已知为假** |
| 「先跑这些」里的 `期望 35 files / 614 tests` | 现行基线是 **624** |
| 判据基线那一条 | 同上；**并在该行逐字注明了原文与更正理由**，2026-08-28 那一段其余内容原样保留 |
| 那一段的小标题「最近一次会话（2026-08-28）」 | 它已经**不是最近一次**了 |
| 「⛔ 下一件事」第 0 条 | P0 已完成 ⇒ 本仓库的下一件事**回到 E1 的 I-2 ＋ 人裁 85**；**人裁 121 仍有效、E1 仍在授权面外**两句原样保留 |
| 「📌 Orca 那条线」整节 | **就地更新，不新增编号章节**（人 2026-09-02 定的规矩） |

#### 2. 收尾状态（**以现跑为准，本节不写哈希**）

| 仓库 | 本轮改了什么 | 状态 |
|---|---|---|
| **Orca** | `src/ledger/**` 五个文件 ／ `tests/ledger/**` 四个文件 ／ `package.json` ／ `scripts/githooks/pre-commit` ／ spec 的两条 ERRATUM ／ P0 计划的一条 ERRATUM ／ 14 条台账 ／ 本文 | 本地领先远端，**未 push**；`npm run verify` **exit 0**，`7 files / 119 tests` |
| **ccloop** | 四笔实现＋文档 ＋ 一笔 handoff | 本地领先远端**五笔**，**未 push**；`35 files / 624 tests`，三个 RC 全 0 |
| **ccmem** | *** **一个字节都没碰** *** | 主工作树仍在别人未合并的 `w3-threat-scan-bypass-suite` 上，**禁区** |

### 十一、🔴 对本节自己的一处具名更正：**ccmem 已经不是禁区了**

本节第七节与第十节的表都写着「**ccmem 主工作树仍在别人未合并的 `w3-threat-scan-bypass-suite` 上，禁区**」。
*** **原文逐字保留，此处即为更正：那句话在写下时就已经为假。** ***

**它是照抄上一轮 handoff 的，不是现测** —— 正是本项目反复警告的那个错误
（「别信文档写的状态，一律现跑」）。**收尾时补测才发现。**

**现测**（2026-09-04，口径 `/usr/bin/git -C …/ccmem branch --show-current` ＋ `status --short`
＋ `worktree list` ＋ `branch -vv` ＋ `branch --merged main` ＋ `log --oneline -4`）：

| 量 | 值 |
|---|---|
| 主工作树所在分支 | *** **`main`，工作树干净** *** |
| W3 | *** **已合进 `main`** ***（合并笔主题行 `merge: threat-scan bypass corpus, report and hardening (W3)`） |
| 该轮记录 | 主题行 `docs(handoff): record round XXVIII -- W3 merged, version bump decided against, and the symlink finding` ⇒ **ⅩⅩⅧ 已落盘，版本号裁决为【不 bump】** |
| `w3-threat-scan-bypass-suite` 分支 | **已不在 `branch -vv` 列表里** |
| 仍在的 worktree | **两个**：`.worktrees/ccmem-v012-finalization`、`.worktrees/raise-openai-timeout` —— **仍是别人的地盘，不碰** |

⚠️ *** **本轮对 ccmem 仍然一个字节都没写** *** —— 只跑了上面这些只读命令。

⇒ **两条推论**：
1. **第八节「下一件事」第 3 条的前置条件（等 W3 合进 main）现在已经满足。**
   ccmem 的 §15 目前仍写着「C 的设计尚未开写」，且它还会写「`bound` 即将加 `taskId`/`runId`」——
   *** **两句都已为假**（C 的 spec ＋ 三份计划都写完了，`bound` 那两个字段本轮已经落地）。 ***
   按同一条活文档纪律，它该就地更新那一节。**但要不要现在动，等人点头**（人此前的用法是「先报再改」）。
2. *** **「禁区」这个判断必须每轮现测重建，不能从上一轮继承。** *** 本轮差点把一条过期的禁令带进下一轮。

### 十二、对第九节「成本」的具名更正：**钩子后来报数了**

第九节写着「**本会话的钩子在写下本节之前没有报出过任何金额，因此不写**」——
*** **那句话在写下时为真，收尾时已经为假。原文逐字保留，此处即为更正。** ***

**只抄工具报数**（Rule 14）：钩子在本轮收尾写交接文档时报出 *** **约 $163.54** ***。
**这是钩子打印的数，不是估算**；本会话此前一直没报过，所以这是**唯一一次**拿到的值。

⚠️ **给下一轮的量级参考（不是估算，是对照）**：这 $163.54 买到的是
**P1 五个任务 ＋ P0 四个任务 ＋ 21 条点名变异 ＋ 两个仓库的收尾文档**，且**没有派任何外派评审**。
⇒ *** **P2 是 15 个任务 / 22 场景 / 14 变异，规模比本轮大一倍多；若再叠加外派评审
（历轮实测一轮「派评审→修复→复审」是几十美元量级，大头在评审员身上），量级会明显更高。** ***
⇒ **动 P2 之前先跟人报一次预估，并且只报工具给出的数。**

---

# 📌 本轮（2026-09-04，会话 `c2fd0c3b`）—— **P2 执行完毕：子系统 C 存在了**

**归属**：run `orca-dev-c2fd0c3b`。本节**只追加**，上面一字未动。
⚠️ **本节不写任何当前哈希** —— 提交本文这个动作本身就会改 HEAD。要指代某一笔就**引提交主题行**。
（例外同前：**实测值的观测锚点 commit 必须写**，那是有效期，不是当前状态。）

## 一句话状态

*** **`docs/superpowers/plans/2026-09-03-p2-scheduler-c.md` 的 15 个任务全部执行完毕并逐个过审，
外加一次整支复审与一轮修复波。`orca plan` 与 `orca run` 现在是真的。** ***
**一次都没 push、没建分支、没合并、没删任何 worktree。**

## 一、开工核对（都带命令，本轮现测）

| 量 | 值 | 命令 |
|---|---|---|
| Orca 远端 `main` | `a0d5e52`（**整轮未变**，收尾又核了一次） | `/usr/bin/git ls-remote origin refs/heads/main` |
| Orca 本地 | 开工时领先一笔；**收尾领先 37 笔** | 裸 `git log`、`git rev-list --count` |
| Orca 开工基线 | `npm run verify` **exit 0**，`7 files / 119 tests` | `npm run verify > 文件 2>&1; echo $?` |
| ccloop | 远端 `7caa4cb`，本地 `7f2c5f6` 领先五笔，工作树干净 | 裸 git |
| ccloop 套件 | **exit 0**，`35 files / 624 tests`，零 skipped，27.32s | `ECC_GATEGUARD=off DISABLE_OMC=1 npm test -- --run` |
| ccmem | 开工时在 `main` 但**工作树脏**（别人在改 v0.14 文档）⇒ 当时是禁区 | 裸 git |

🔴 **一处具名更正**：上一节（会话 `213d1395`）结尾写着「两个仓库都有未 push 的提交」。
**对 Orca 已经为假** —— 人把 P1 的五笔实现、spec 两条 ERRATUM、三笔 handoff 全推上去了，
开工时本地只领先一笔。**P1 的全部产物从那时起就是已发布文本。** 原文逐字保留，此处即为更正。

## 二、收尾实测（**只抄工具打印出来的数**，观测时点 2026-09-04，收尾提交之后）

| 量 | 值 |
|---|---|
| `npm run verify` | *** **exit 0** ***，**47 files / 161 tests**（scheduler 档），全仓 49 档 |
| 判据增长 | `7 files / 119 tests` → **`47 / 161`**（scheduler 档由 0 → 161） |
| 提交笔数 | **37 笔**领先远端 |
| 改动规模 | 整支 `e60c2a2..` 收尾前为 65 文件 / +8876 行；修复波后判据再 +20 |
| 变异 | 计划点名 14 条 ＋ 控制器补 2 条，**Task 15 全部复跑并各自看见红**；修复波再跑 24 次，**全部红在断言上，无一靠崩溃** |
| ccloop | *** **一个跟踪字节未动** *** —— 全程 `git status --short` 空、HEAD 恒为 `7f2c5f6` |

## 三、造出来的东西

三层，下层不知道上层存在：

| 层 | 文件 |
|---|---|
| **① 纯函数，零 I/O** | `planFile.ts`（plan 文件 ＋ **七**条当场拒）、`writeSet.ts`（归一化／写集／`requiredChecksUnion`）、`pathTrie.ts`（按**路径包含**判相交，不是字符串前缀）、`graph.ts`（显式 ∪ 隐式边、环检测、**批量 Kahn 分层**）、`planReport.ts` |
| **② 执行** | `repoLock.ts`（`mkdir` 原子性）、`preflight.ts`、`runId.ts`、`ccloopRunner.ts`（clone ＋ spawn ＋ 读 `loop-state.json`）、`harvest.ts`（§7 双向核对）、`land.ts`、`pool.ts`（固定并发上限） |
| **③ 冲突主干与编排** | `reconcile.ts`、`ledgerWiring.ts`、`exitCode.ts`（3>2>1>0）、`run.ts` |

`src/cli.ts` 增 `plan` / `run` 两个子命令（既有 `validate` / `check-append-only` 一字未动）。
新增 `README.md`（此前本仓库**从来没有**）。本轮决策落 `.decisions/orca-dev-c2fd0c3b.jsonl`，全部经 `appendEvent`。

## 四、🔴 全部 38 条裁决在台账里，**不在这里复述**

*** **`.superpowers/sdd/2026-09-03-p2-scheduler-c/progress.md`（本轮已 `git add -f` 入库）** ***
是唯一完整记录：每条裁决带**理由**和**判错了要付什么代价**，另有 15 份 `task-N-report.md` 与
`final-fix-report.md` 的全部变异证据。**要复核我替人做的判断，读那个文件，不要读本节。**
（review diff 与 brief 故意没入库 —— 前者 `git diff` 可重生成，后者 `scripts/task-brief` 可重抽，沿用 A′ 轮先例。）

## 五、🔴 六条会改变下一轮怎么干活的实测（**别重新发现一遍**）

1. *** **计划亲手给出的「完整代码」里有洞。** *** Task 3 那段被要求逐字照抄的 `pathTrie` 代码，
   会把 `./src/**` 和 `src/a.ts` 判成**不相交** —— 而 spec §3.1 恰好把这个方向列为**不安全**。
   ⇒ **「计划给了完整代码」不等于「这段代码是对的」。**
2. *** **一条判据的注释会宣称它没做的测量。** *** Task 12 的 parents 判据，四条断言全被它自己的
   筛选条件蕴含，而注释写着「parent 0 是落地起点的 W tip」。把第一个 parent 换掉，四条照绿。
3. *** **「绿的变异」是抓空判据的唯一可靠手段。** *** 本轮**七个任务**各自 ship 过一条不可能红的断言；
   每一条被早期抓到的，都是靠**跑变异看见它是绿的**，没有一条是靠读代码看出来的。
4. *** **靠崩溃变红不是证据。** *** 出现三次。`M-FIRSTPARENT` 在断言跑到之前就把 `git merge --ff-only`
   撞崩了；正确做法是另造一条**让运行仍然成功**的变异（`M-EXTRAPARENT`），它才精确红在目标断言上。
5. *** **评审员的顺带论断要核。** *** 两次经不起复测：一次说 `S5.test.ts:55` 的行号错了（实测没错），
   一次说 S3 断言 `rc === 0`（实测是 `toBe(2)`）。**主结论都对，顺带的事实都错。**
6. 🆕 *** **`undoHowIsExecutable` 那条「假阴性」是假的。** *** 上一节（会话 `213d1395`）第四节第 6 条记着
   `git checkout <sha> -- README.md` 被判不可执行。**现测返回 `true`**；`git checkout abc1234 -- README.md`、
   `git checkout -- README.md`、`rm -rf .decisions/orca-dev-x.jsonl` 同样 `true`，中文散文仍 `false`。
   `/usr/bin/git log -- src/ledger/undoExecutable.ts` 只有一笔提交 ⇒ **谓词没变过，是那条记录当时就写错了。**
   *** **原文逐字保留，此处即为具名更正。** ***

## 六、本轮**没有**做的（登记，不掩饰）

- **未 push、未建分支、未合并、未删任何分支或 worktree。** 本地领先远端 37 笔。
- **对 ccloop 一个跟踪字节都没写** —— 只 spawn 它、读它的源码，并在它 gitignore 的 `dist/` 里跑过一次 build。
- **spec 的三条已知缺口没关**：`ledgerMode: out-of-repo` 只到 schema（认得但当场拒）、
  squash 检测与索引器降级归子系统 E、真默认分支的解析登记为后续。
- **五条残留发现按 skill 规矩没有第二轮修复波**，逐条带裁决停在台账里（见第七节）。

## 七、⛔ 下一件事（**按优先级，前两条是同一形状**）

| 顺序 | 做什么 | 为什么现在做 |
|---|---|---|
| **1** 🔴 | **`preflight.ts` 的 `refIsKnown` 会伪造一个 `[pass]`** —— 目标仓不是 git 仓时，它吞掉错误，报告里于是打印 `[pass] work-branch-already-exists` 挨着两条真失败 | 这正是整支复审 B6 那条发现的形状：**人据以批准的报告里出现假绿**。先于一切 |
| **2** | `PLAN_LEVEL_CHECKS` 用**位置解构**消费，重排数组会静默把码名绑到错的消息上，而防漂移判据比的是**集合**，看不见置换 | 换成按码名索引的记录即可 |
| **3** | 池子引入了「已排队未启动」这个此前不存在的状态，`cancelled` 拦不住它 | 实际近乎不可达，但不变式已经**可表达而未强制** |
| **4** | 收敛剩下的 `git()` / `ORCA_IDENTITY` / 终态名副本 | 已登记，专开一轮只做收敛 |
| **5** | 子系统 **B** 或 **D** | C 已落地；B 的入口条件（`corrections` / `overturned` 字段形状）**仍未定** |

⚠️ **两个仓库的未 push 提交都等人单独授权。控制器不许 push。**

## 八、成本

**只抄工具报数**（Rule 14）：本会话钩子最后报出的是 *** **约 $138.24** ***（在 Task 9 前后那一刻）。
**此后钩子没有再报过数，因此不写 —— 不许自估。**

⚠️ **给下一轮的量级对照（不是估算）**：上一轮 $163.54 买到 9 个任务 ＋ 21 条变异、**无外派评审**。
本轮在 $138.24 那一刻已完成 9 个任务，而全程是 **15 个任务 ＋ 每个任务一次独立评审 ＋ 多数任务一次修复轮
＋ 一次整支复审 ＋ 一次修复波复审**，合计约 **40 个 subagent 席位**。
⇒ *** **「每任务派评审」确实值钱 —— 它抓到的东西里有多条是单任务视角看不见的 —— 但它是本轮的主要开销。** ***

---

# 📌 本轮（2026-09-05，会话 `99004516`）—— **C 的四条 follow-up 全部收掉**；一条 parked 裁决被实测推翻

**归属**：run `orca-dev-99004516`。本节**只追加**，上面一字未动。
⚠️ **本节不写任何当前哈希** —— 提交本文这个动作本身就会改 HEAD。要指代某一笔就**引提交主题行**。
（例外同前：**实测值的观测锚点 commit 必须写** —— 那是有效期，不是当前状态。）

## 一句话状态

上一节「⛔ 下一件事」表里的 **1／2／3／4 四条全部做完**，各一笔提交，外加一笔台账 ＋ README 更正。
**第 5 条（子系统 B 或 D）没动。一次都没 push、没建分支、没合并、没删任何 worktree。**

## 一、🔴 开工核对推翻了交接给我的两个事实（**都是现测**）

| 交接里怎么说的 | 现测 | 命令 |
|---|---|---|
| 「Orca 领先远端 37 笔，**未 push**」 | *** **为假：远端与本地【同点】** *** ⇒ **P2 的全部产品代码、161 条判据、progress.md、两份 ERRATUM 现在都是【已发布文本】** | `/usr/bin/git ls-remote origin refs/heads/main` ＋ 裸 `git log` |
| 「ccloop **HEAD 恒为 `7f2c5f6`**」 | **为假**：HEAD 是 `2a4381e`（多一笔 `docs(handoff): record that subsystem C now really consumes the attempt refs`），远端同点 | 裸 `git -C …/ccloop log/ls-remote` |

⚠️ 第二条**不影响任何结论** —— `git -C …/ccloop diff --stat 7f2c5f6 2a4381e -- src tests scripts` **空输出**，
那一笔只动了 handoff。**但引用它当锚点的实测值要按 `2a4381e` 重新写有效期。**
⇒ 老结论第 N 次兑现：*** **别信任何文档写的发布状态与 HEAD，一律现跑。** ***

开工基线：`npm run verify` **exit 0，47 files / 161 tests**（与上一节记的一致）。

## 二、做完了什么（按提交主题行找，**别数笔数**）

| 顺序 | 提交主题行 | 判据 |
|---|---|---|
| 1 | `fix(scheduler): stop preflight fabricating a [pass] for a check it never ran` | 47/161 → 48/162 |
| 2 | `refactor(scheduler): key the check-code constants instead of positioning them` | 不变 |
| 3 | `fix(scheduler): stop the pool launching tasks a cancelled round already ended` | 48/162 → **50/165** |
| 4 | `refactor(scheduler): converge the git wrapper, the commit identity and the five terminal names` | 不变 |
| 5 | `docs(scheduler): land this round's ledger and correct the README's reason for limitation 7` | 不变 |

**收尾实测**：`npm run verify` **exit 0，50 files / 165 tests**；
`orca validate .decisions` 仍只报 `orca-dev-09cc3ea1.jsonl` 第 8–14 行那七条历史 `bound` 的 downgraded（人裁 4 之后的既定状态），**没有新的**。

## 三、🔴 四条会改变下一轮怎么干活的实测（**别重新发现**）

### 1. *** parked 裁决「`PLAN_LEVEL_CHECKS` 的置换会【静默】重绑码名」——「静默」这半句为假 ***

**实测**（`git clone --local` 副本，观测时 Orca `7ffa590` 之上、修复之前）：
对调前两项 ⇒ **打红 4 条既有判据**；对调后两项 ⇒ **同样打红 4 条**。
根因：`planFile.test.ts` 里**每个码名各有一条断言字面量的单项判据**，它们直接观测绑定。
*** **看不见置换的只是那一条「防漂移」判据（它比的是排序后的集合），不是整支。** ***

⇒ **两条推论**：
1. **那条裁决的措施（改键控记录）仍然对，理由不对。** 已按本仓库惯例在提交信息里具名更正，不就地改 progress.md。
2. *** **我为它写好的那条新判据被撤掉了** *** —— 它度量的东西已经被四条既有判据度量（Rule 2）。
   **撤掉之前先让它在同一条变异下红过**，所以「它确实承重」与「它冗余」两件事都是量出来的，不是猜的。

### 2. *** 「T1 取消 ＋ T2 依赖 T1」这个判据形状是空的 ***

第一版 `cancelledRound.test.ts` 在 `M-ROUTE-CANCEL`（**整段删掉 `routeOutcome` 里 `cancelled` 那一行**）之下 **是绿的**。
根因：通用行的 `countsAsFailure`（非 blocked 即 true）与 `descendantsOf(T1) = [T2]` 对两任务链**产生完全相同的输出**。
⇒ 加了一个**不是 T1 后代**的 T3 ＋ `--serial`（把它排进后面的层）之后才红，且红在 `T3: upstream_not_run` 这条断言上。
⇒ **形状教训**：**要证明「某一行路由是承重的」，必须有一个只有那一行会挡住的对象。** 链式依赖证明不了它。

### 3. *** `cancelled` 端到端是跑得出来的 —— Task 8 登记的那个缺口可以关了 ***

Task 8 写「`cancelled` 没有实测，要么 `stopOn` ∩ `stopSignals`（需 `verifierType: "agent"`），要么给进程组发信号」。
**前一条路本轮实测走通了**：`runLoop.ts:1508`（观测时 ccloop `2a4381e`）在 `evaluateStopDecision` **之前**匹配
`verification.stopSignals` ∩ `contract.escalationAndExit.stopOn`，所以**一个 scripted frame ＋ `verifierType: "agent"` 就能跑出真的 `cancelled`**，
**一次模型都不用跑，不花钱**。sandbox 因此多了 `ContractSpec.stopOn` 与 `ScriptedFrameSpec.stopSignals` 两个夹具字段。
⇒ 本仓库现在有**两条**端到端 `cancelled` 判据（`cancelledRound` 与 `poolStopsLaunching`）。

### 4. *** 一层之内的任务是【按 taskId 排序】跑的，不是按计划里的顺序 ***

第一版 `poolStopsLaunching.test.ts` 把取消者命名为 `T1`、排队者命名为 `QUEUED`，结果 **`QUEUED` 先跑**（Q < T），
取消者自己成了队尾那个 —— 判据当场失去意义。改名 `a1` / `b1..b3` / `z1` 才成立。
⇒ **任何依赖「谁先跑」的场景，名字是承重的，必须在判据里写明这一点。**

## 四、方法论（本轮兑现的，直接用）

1. *** **靠崩溃变红不是证据 —— 本轮又栽一次。** *** `M-ROUTE-CANCEL` 第一次跑红在
   「ccloop bin not found」上：`git clone --local` 的副本不在 ccloop 的同级目录，而 `resolveCcloopBin()` 按同级找。
   ⇒ *** **在副本里跑任何 spawn 场景，必须带 `ORCA_CCLOOP_BIN=/绝对路径/ccloop/dist/cli.js`**，否则你量的是路径解析。 ***
2. **判据不许把颜色押在两个同长定时器谁先回来上。** `pool.test.ts` 那条最初两个 `tick(5)`，改成 `1ms` vs `40ms`，
   并在注释里写明为什么。同理 `poolStopsLaunching` 用 `sleep 3` 拉开真子进程的时间差。
3. **「成功的任务没有 run 目录」不能当控制组** —— §4.5 会 dispose 成功任务的副本。
   要证明「它跑了」，量它的产物**落没落到 W**。（本轮的控制断言第一版就栽在这。）
4. **台账闸门本轮一次都没拦下我** —— 七条 `undo.how` 全部一次通过。
   前两轮各被拦一次，都是散文式 undo。⇒ *** **「写成路径 ＋ 具体改什么」已经变成习惯，这是可复制的。** ***

## 五、本轮**没有**做的（登记，不掩饰）

- **未 push、未建分支、未合并、未删任何分支或 worktree。** 本地领先远端五笔。
- *** **对 ccloop 与 ccmem 一个跟踪字节都没写。** *** ccloop 只被 spawn（判据跑它的 `dist/cli.js`），
  收尾现测 `git status --short` 空、HEAD 未变；ccmem 现测在 `main`、工作树干净、只有主工作树，**全程只读**。
- **没有派外派评审**（人本轮当面裁决：不派，控制器自审）。
- *** **spec 与 plan 本轮【没有】追加 ERRATUM。** *** 本轮推翻的两条（parked 裁决的「静默」半句、README 限制 7 的理由）
  分别记在**提交信息**与 **README 那一条本身**里；progress.md 是 `.superpowers/sdd/**`，**一个字没改**。
- **子系统 B 的入口条件仍不满足** —— `corrections` / `overturned` 字段形状至今未定。

## 六、⛔ 下一件事

| 顺序 | 做什么 | 说明 |
|---|---|---|
| **1** | **子系统 B 或 D，人来选** | C 的四条 follow-up 已清空。⚠️ **B 的第一步仍是定 `corrections` / `overturned` 的字段形状**，那是设计工作，先 `superpowers:brainstorming` |
| **2** | ccloop 回到 **E1 的 I-2 ＋ 人裁 85** | 人裁 121 仍有效；**E1 动生产代码前仍需另拿一次具名授权**。本轮没碰 |
| **3** | ccmem §15 的更新 | 前置（W3 合进 main）**早已满足**；它那节仍写着「C 的设计尚未开写」等已为假的话。**要不要动等人点头**（人此前的用法是「先报再改」） |
| **4** | *** **五笔未 push 的提交等人单独授权。控制器不许 push。** *** | |

## 七、成本

**只抄工具报数**（Rule 14）：**本会话的钩子到写下本节为止一次都没有报出过金额，因此不写 —— 不许自估。**
量级对照（不是估算）：本轮是 **4 处修复 ＋ 3 条新判据 ＋ 7 条点名变异 ＋ 0 个外派评审席位**，
比上一轮（15 任务、约 40 个 subagent 席位、钩子报 ~$138.24）小一个量级以上。

### 八、本节写下之后的两件事（**同会话续写，上面一字未动；本节即为对第六节与第七节的具名更正**）

#### 1. 🔴 人已经拍板：**下一件事是子系统 B**

第六节的表写着「**子系统 B 或 D，人来选**」。**人已选定 B**（2026-09-05 当面）。
⇒ *** **下一轮的第一件事是 B，不是 D，也不再需要重新拿授权来开这个题。** ***
**B 的入口条件仍然没变，而且它就是 B 的第一个任务**：
*** **`corrections` 与 `overturned` 的完整字段形状至今未定** *** ——
校验器对引用类事件只钉 `ev` ＋ `id`（`src/ledger/validateLine.ts`），
只有 `bound` 在 P1 那一轮被加上必填的 `taskId` / `runId`。
⇒ **B 开工不是先写代码，是先 `superpowers:brainstorming` 把这两个事件的字段形状定下来。**
⚠️ *** **台账只追加 ⇒ 字段形状这一类东西「格式错过就永远补不上」** *** ——
P1 那一轮为 `bound` 付过一次这个代价（12 条既有判据被打红、两条承重判据要人指名改写、
一条 spec 逐字示例被判 downgraded）。**`corrections` / `overturned` 这次要一次定对。**

#### 2. 🔴 对第五节「未 push、本地领先远端五笔」的具名更正

第五节与第六节都写着**本地领先远端、未 push**。*** **写下时为真，现在为假。** ***
**现测**（`/usr/bin/git ls-remote origin refs/heads/main`，本会话收尾）：
**远端 tip 就是本轮最后那笔 `docs(handoff): record the round that closed subsystem C's four follow-ups`，与本地同点。**
*** **推的人是人类，在本会话进行中手动推的。控制器仍然一次都没 push。** ***

⇒ *** **本轮那五笔实现 ＋ 台账 ＋ README 更正 ＋ 上面第一到第七节，现在全部是【已发布文本】** ***
—— 只能追加具名 ERRATUM，不许就地改。**本小节自己就是按这条规矩写的。**
⇒ 老结论第 N+1 次兑现：**同一会话里远端被推动是常态；要判某笔发没发布，现跑 `ls-remote`，连本节都不要信。**

#### 3. 成本（对第七节的更正：钩子后来报数了）

第七节写着「本会话的钩子到写下本节为止一次都没有报出过金额」——**写下时为真，之后为假**。
**只抄工具报数**（Rule 14）：钩子在收尾写交接文档时报出 *** **约 $98.78** ***。
⚠️ **量级对照（不是估算）**：这 $98.78 买到的是 **4 处修复 ＋ 3 条新判据 ＋ 7 条点名变异 ＋ 7 条台账 ＋ 三个仓库的收尾文档，且没有派任何外派评审**。
上一轮（15 个任务、约 40 个 subagent 席位）钩子报的是 ~$138.24。

---

# 📌 本轮（2026-09-05，会话 `c1c3c2ec`）—— **子系统 B 的入口条件已定死：`corrections` 与 `overturned` 的字段形状**

**归属**：run `orca-dev-c1c3c2ec`。本节**只追加**，上面一字未动。
⚠️ **本节不写任何当前哈希** —— 提交本文这个动作本身就会改 HEAD。要指代某一笔就**引提交主题行**。
（例外同前：**实测值的观测锚点 commit 必须写** —— 那是有效期，不是当前状态。）

## 一句话状态

*** **B 的第一件事做完了：两个事件的完整字段形状已定、已过一轮对抗性自审、13 条裁决已入台账。** ***
**产品代码一行未写** —— 那是下一轮 `writing-plans` ＋ 执行的事。
**一次都没 push、没建分支、没合并、没删任何 worktree。**

## 一、开工核对（都带命令，本轮现测）

| 量 | 值 | 命令 |
|---|---|---|
| Orca 远端 `main` | `668bfd2`（**整轮未变**，收尾又核了一次） | `/usr/bin/git ls-remote origin refs/heads/main` |
| Orca 开工 HEAD | `7fe3ca8`，领先一笔 | 裸 `git log` |
| Orca 开工基线 | `npm run verify` **exit 0，50 files / 165 tests** | `npm run verify > 文件 2>&1; echo $?` |
| ccloop | 远端 `2a4381e`，本地 `cb43654` 领先一笔（只是 handoff），工作树干净 | 裸 git |
| ccmem | 远端 `473a0bc`，本地 `0de437e` 领先一笔（只是 handoff），工作树干净 | 裸 git |

## 二、做完了什么（按提交主题行找，**别数笔数**）

| 顺序 | 提交主题行 |
|---|---|
| 1 | `docs(spec): pin the field shapes of corrections and overturned, and correct two claims in the A' spec` |
| 2 | `docs(spec): fix what an adversarial re-read of this spec's own first draft got wrong` |
| 3 | `docs(ledger): record subsystem B's thirteen design and review decisions` |

**产物**：
- **新 spec** `docs/superpowers/specs/2026-09-05-corrections-overturned-design.md`（11 节）。
- **A′ spec 追加两条具名 ERRATUM**（`51 insertions / 0 deletions`，原文逐字保留）：
  §4.1「`overturned` 引用 correction id」字面为假（**是两个 id，不是一个**）；
  §3.8 检查 5 的**作用域**对 `superseded`/`overturned` 提升到目录级（**判罚不变**）。
- **台账 `.decisions/orca-dev-c1c3c2ec.jsonl` 13 条**，全部经 `appendEvent`。

**收尾实测**：`npm run verify` **exit 0，50 files / 165 tests**；
`orca validate .decisions` 仍只报 `orca-dev-09cc3ea1.jsonl` 第 8–14 行那七条历史 `bound` 的降级，**没有新的**。

## 三、🔴 六条会改变下一轮怎么干活的实测（**别重新发现一遍**）

**观测锚点：Orca `7fe3ca8`（收尾前）**，每条都带测量命令，见 spec §2。

1. *** **`overturned` 与 `superseded` 的存量都是 0。** *** 全部台账 `decision: 87`、`bound: 7`。
   ⇒ 本轮定的是**零存量形状**，不需要兼容任何历史行 —— 这是唯一让「一次定对」可能做到的条件。
2. *** **decision id 是 `<run-id>/<n>`，全局唯一且自带出处；而 run id 里【没有仓库标识】。** ***
   （`orca-<taskId>-<hash8>`，hash 只吃契约字节 ＋ base commit。）
   ⇒ 前半句是「检查 5 提升到目录级」的依据；后半句是「corrections 必须自带 `projectKey`」的依据。
3. 🔴 *** **`orca run` 对非 git 目标报的是原始 `ENOENT: … mkdir '<target>/.git/orca-lock'`。** ***
   根因：`run.ts:630` 先 `acquireRepoLock`，`run.ts:643` 才跑 preflight。
   ⇒ **上一轮为 `plan` 修掉的「原始 node 错误直达用户」这个形状，在 `run` 上原样还在。**
   **已登记给 C（spec §7 第 3 行），本轮没修。**
4. 🔴 *** **一条守卫的旁边可能还有第二道，于是删掉它照样绿 —— 这是「空判据」的新变体。** ***
   本轮起草时写了一条变异「把 `ev === "bound"` 放宽成 `isReferenceEventName(ev)`」，
   自审时发现它**必然是绿的**：`ATTRIBUTION_FIELDS = {taskId, runId}` 是第二道独立守卫，
   而 `overturned` 的字段一个都不在里面。
   ⇒ **这次不是判据写错了，是【被测目标本身是冗余的】。**
   ⇒ *** **写变异表时先问一句：这个分支是不是【唯一】挡住它的东西？** ***
   ⇒ 处置见 spec §6.1：**登记为不可被单条变异钉住的冗余守卫，不编一条假判据。**
5. 🔴 *** **「只在需要时才做」这类优化，要先问「谁会重新触发这个需要」。** ***
   初稿让 `appendEvent` 只在追加 `overturned`/`superseded` 时才建跨文件解析域。**那会坏**：
   `writer.ts:110` 的预演校验**每次追加都重验整份文件** ⇒ 写完一条跨文件 `overturned` 之后，
   **再追加任何一条别的事件**都会把它判成不可解析、整个 append 抛错。
   ⇒ 根因是我按「本次追加的是什么」建域，而校验器按「整份文件里有什么」判 ——
   **两个不同的量被当成了一个。**
6. *** **87 条 decision 里只有 7 条有 `bound`。** *** ⇒ 任何「靠 `bound` 反查某条 decision 属于哪个任务」
   的链条**都不可靠**。初稿曾用它论证「`overturned` 不需要 `taskId`」，**措施对、理由错**，已换成实测过的
   那条（run id 本身含 taskId）。
   ⇒ *** **措施对不代表理由对，两者要分别验。** ***

## 四、方法论（本轮兑现的）

1. **spec 自审真能抓东西，而且抓的是硬的。** 本轮自审出 **9 条**，其中 **2 条是 Critical**
   （上面第 4、5 条），**都会原样进实施计划**。第一次自查还抓出一处悬空歧义（§8 裸写 `§4.1`
   会被读成本文自己的 §4.1）。**别跳过自查。**
2. **台账闸门本轮又一次没拦下我** —— 13 条 `undo.how` 全部一次通过。
   ⚠️ **但「闸门放行」不等于「写得好」**：那个谓词的已知下限是「含一个 camelCase 标识符或路径就算过」。
3. **改 spec 用整行锚点 ＋ 唯一命中**（`Edit` 工具自带唯一性检查），本轮 9 处修正无一切错段落。

## 五、本轮**没有**做的（登记，不掩饰）

- **未 push、未建分支、未合并、未删任何分支或 worktree。** 本地领先远端**四笔**（现测口径见下）。
- *** **产品代码一行未写。** *** `src/ledger/**`、`src/corrections/**`、`tests/**` **零改动**
  （收尾现测 `git status --porcelain -- src tests scripts` 为空）。
- *** **对 ccloop 与 ccmem 一个跟踪字节都没写**（除本轮收尾更新它们各自的 Orca 章节）。 ***
  两个仓库全程只读，现测都在 `main`、工作树干净、只有主工作树。
- **没有派外派评审**（本轮是控制器自审）。
- **没跑 `writing-plans`** —— 人当轮裁决：**本会话写完台账就交接，计划另开新会话**，
  理由是上下文水位（钩子报约 254k/450k）而计划是本题最重的一步。

## 六、⛔ 下一件事

| 顺序 | 做什么 | 说明 |
|---|---|---|
| **1** | *** **`superpowers:writing-plans`，把新 spec 变成实施计划** *** | **开新会话做。**⚠️ **它自带的自查三项一项都不许跳**（spec 覆盖／占位符扫描／类型一致）—— 历轮每轮都抓到硬错 |
| **2** | 执行计划 | 6 个文件（5 改 1 新）＋ 变异表 M1×6／M3–M7／M10／M8／M9×7 |
| **3** | ccloop 回到 **E1 的 I-2 ＋ 人裁 85** | 人裁 121 仍有效；**E1 动生产代码前仍需另拿一次具名授权**。本轮没碰 |
| **4** | *** **四笔未 push 的提交等人单独授权。控制器不许 push。** *** | |

### 6.1 下一轮开工必读（**不读会重做已经做过的判断**）

1. `docs/superpowers/specs/2026-09-05-corrections-overturned-design.md` —— **尤其 §6.1、§6.2、§11**。
   §11 记的是**这份 spec 的初稿错在哪**；§6.1 是一处**故意不配判据**的地方，别去给它补判据；
   §6.2 是**人已指名授权**的那条既有判据改写（Rule 2 的授权门已经过了，不用再要一次）。
2. `.decisions/orca-dev-c1c3c2ec.jsonl` —— 13 条裁决**各带理由与「判错了要付什么代价」**。
   **要复核我替人做的判断，读它，不要读本节。**
3. A′ spec 末尾**两条新 ERRATUM**。

## 七、成本

**只抄工具报数**（Rule 14）：钩子在写本节前最后报出的是 *** **约 $87.75** ***。
**此后没有再报过数，因此不写 —— 不许自估。**
⚠️ **量级对照（不是估算）**：这一轮是 **0 行产品代码 ＋ 0 条变异 ＋ 0 个外派评审席位**，
产出是一份 spec ＋ 两条 ERRATUM ＋ 13 条台账。
上一轮（4 处修复 ＋ 3 条新判据 ＋ 7 条变异）钩子报 ~$98.78；再上一轮（15 任务、约 40 个 subagent 席位）~$138.24。
⇒ *** **纯设计轮并不便宜 —— 它的开销在【反复现测】和【对抗性自审】上，而那正是本轮唯一的产出质量来源。** ***

### 八、本节写下之后的两件事（**同会话续写，上面一字未动；本节即为对第五节的具名更正**）

#### 1. 🔴 对第五节的具名更正：**ccmem 的 Orca 章节【没有】更新，ccloop 的更新了**

第五节写着「对 ccloop 与 ccmem 一个跟踪字节都没写（**除本轮收尾更新它们各自的 Orca 章节**）」。
*** **括号里那半句对 ccmem 为假 —— 它没被更新，而且是故意不更新的。** ***

**现测（2026-09-05 20:52，收尾）**：

| 仓库 | 状态 | 处置 |
|---|---|---|
| **ccloop** | 工作树干净、在 `main`、只有主工作树 | ✅ **已更新并提交**，主题行 `docs(handoff): update the Orca section in place -- subsystem B's field shapes are now pinned` |
| **ccmem** | 🔴 *** **工作树脏（`M docs/handoff/handoff.md`），且该文件 78 秒前刚被改过** *** | ⛔ **没动，一个字节都没写** |

**ccmem 那边正在有另一个 agent 干活**：本会话开工时它在 `0de437e`，20:47 现测干净；
中途它多了一笔 `docs(handoff): record round XXX -- summarize_pending timeout root-caused, two remedies refuted`
（作者会话 `session_01XXAJDeB3ZgM6zyLUGJEiNj`，**不是本轮线**），`handoff.md` 从 5054 行涨到 5212 行，
到 20:52 仍在被写。⇒ **CLAUDE.md Rule 3：别的 agent 的工作树是禁区，只报诊断不动手。**

⚠️ *** **顺带兑现的一条**：同一份文档在四分钟内从「干净」变成「脏」。
**写之前必须【再核一次】，开工时核过不算。** *** 本轮就是靠收尾前那一次复核才没有和别人抢同一个文件。

#### 2. ⛔ 欠 ccmem 的那次更新 —— **补丁原文留在这里，别重新推导**

**它那一节现在带着一句【已知为假】的话**（§15「对本仓库最要紧的一条」）：

> *** **`corrections` 与 `overturned` 的完整字段形状至今【仍然】没有定。** ***

**该改成什么**（等 ccmem 工作树干净、且人点头之后，由下一轮就地更新它的 §15；**别新增编号章节**，
那是人 2026-09-02 定的规矩）：

- 形状**已经定了**（2026-09-05，run `orca-dev-c1c3c2ec`），spec 在
  `…/Orca/docs/superpowers/specs/2026-09-05-corrections-overturned-design.md`。
- 🔴 **对 ccmem 最要紧的三条**：
  1. *** **对照样本【不由 `overturned` 承载】。** *** 它是「DB 里的 correction ＋ 台账里的那条 decision」拼出来的：
     左半边（agent 选了什么、理由、证据）全在 `decision` 的 `chose` / `because` / `evidence` / `alternatives`；
     右半边（人改成了什么、为什么）在 correction 行。**`overturned` 是瘦事件，只做闭环标记。**
  2. *** **correction 的 `because` 是全表对记忆层最值钱的字段** *** —— 它带的正是「拒绝它的语境」。
  3. *** **`projectKey` 取 git remote URL，与 ccmem 的 `project_key` 同口径**，跨项目聚合不需要新键。 ***
- ⚠️ **时间窗口的准确说法**：那句「要在 Orca 定形状的那一轮之前说」**已经过期一半** ——
  设计定了，**但产品代码一行没写、那几笔也没 push**。
  ⇒ *** **在 Orca 落地实现之前，仍有最后一次说话的机会；落地之后台账只追加，就真的改不了了。** ***

⚠️ **本节不替 ccmem 做这次更新** —— 它的工作树是别人的。**这只是一份现成的补丁文本。**
