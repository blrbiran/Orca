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

### *** 跑 `superpowers:writing-plans`，把 A′ 的 spec 变成实施计划。人已授权。 ***

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
| **`superpowers:writing-plans`** | *** **下一件事就是它。** *** ⚠️ 写完**必须跑它自带的自查三项**（spec 覆盖／占位符扫描／类型一致） |
| `superpowers:brainstorming` | 开 B／C／D／E 任何一个子系统的设计之前。⚠️ architectural 路径的终点只能接 `writing-plans` |
| `superpowers:verification-before-completion` | *** 每次要说「做完了／通过了／绿了」之前。 *** 本仓库 Rule 12 与它同形 |
| `superpowers:test-driven-development` | 写校验器（spec §3.8）时。⚠️ 本仓库 Rule 9 要求**每个分支配一条点名删掉它自己的变异** |
| `superpowers:systematic-debugging` | 出现红／行为不符时**先用它**，别直接改代码 |
| `superpowers:requesting-code-review` | 派评审时。⚠️ 派之前先报预估：ccloop 实测「派评审→修复→复审」一轮是**几十美元**量级 |

⚠️ **skill 与本仓库 `CLAUDE.md` 冲突时，`CLAUDE.md` 优先**（Rule 11：conformance > taste）。
