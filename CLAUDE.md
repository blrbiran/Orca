# CLAUDE.md

These rules apply to every task in this project unless explicitly overridden.
Bias: caution over speed on non-trivial work. Use judgment on trivial tasks.

## 作用域（**先读这条**）

**本文件管的是「在本仓库里开发 Orca」的 agent。**

**它不管 Orca 运行时派出去处理【别的仓库】的 agent** —— 那些由 spec
（`docs/superpowers/specs/2026-08-29-decision-ledger-design.md`）和每个任务的契约管。
两者不要混：**权限三档（Tier 0/1/2）是 Orca 的产品设计，写在 spec 里，不是本文件的开发规则。**

⚠️ **本仓库是多 agent 共享的。** 见 Rule 13。

---

## Rule 1 — Think Before Coding
State assumptions explicitly. Present multiple interpretations when ambiguity exists.
Push back when a simpler approach exists. Stop when confused. Name what's unclear.

**不确定时的阶梯**（不要跳级）：
1. **先强制自我反驳一轮** —— 写出最强的反方论证，再决定。
2. 仍不确定，**且该动作可逆** ⇒ 自己定，并写清依据。
3. 仍不确定，**且该动作不可逆** ⇒ 升人。

⚠️ **「不确定就问」不是默认档。** 它是第 3 档，且只在不可逆时。

## Rule 2 — Simplicity First
Minimum code that solves the problem. Nothing speculative.
No features beyond what was asked. No abstractions for single-use code.
Test: would a senior engineer say this is overcomplicated? If yes, simplify.

## Rule 3 — Surgical Changes
Touch only what you must. Clean up only your own mess.
Don't "improve" adjacent code, comments, or formatting. Don't refactor what isn't broken.

⚠️ **多 agent 下「自己的烂摊子」有硬含义**：
**别的 agent 的工作树、分支、文件是禁区** —— 即使看到明显的 bug 也**只报诊断和建议的补丁，不动手**。

## Rule 4 — Goal-Driven Execution
Define success criteria. Loop until verified. Don't follow steps — define success and iterate.

⚠️ **成功判据必须是一条能跑出 0 / 非 0 的命令，不许是散文。**
散文判据没法循环到"验证为止"，因为没有任何一刻能判定它成立了。

## Rule 5 — Use the model only for judgment calls
Use me for: classification, drafting, summarization, extraction.
Do NOT use me for: routing, retries, deterministic transforms.
**If code can answer, code answers.**

⚠️ **本仓库的延伸**：调度、依赖判定、写集比对、台账校验 **必须是代码**。
一个用 LLM 做路由的调度器，会在每个任务上花掉一次不必要的推理，且不可复现。

## Rule 6 — Token budgets are not advisory
**Per-task: 330,000 tokens. Per-session: 450,000 tokens.**

⚠️ *** **单位是【上下文窗口占用】，不是【累计消耗 token】。** *** 这两个量差好几个数量级，
历史上被误读过（有文档按"累计消耗"读，因而宣布某会话超支）。

**累计花费是另一个数** —— 只抄工具报出来的，拿不到就说拿不到（见 Rule 14）。

If approaching budget, summarize and start fresh. **Surface the breach. Do not silently overrun.**

## Rule 7 — Surface conflicts, don't average them
If two patterns contradict, pick one. Explain why. Flag the other for cleanup.
**Don't blend conflicting patterns.**

⚠️ **和「升人」的划界**：
- **证据能分出胜负**（一个更新、一个更被测试覆盖）⇒ **agent 自己判**，按本条。
- **两边证据势均力敌、都能摆出来** ⇒ **升人**。这是本项目唯一该主动找人的形状。

## Rule 8 — Read before you write
Before adding code, read exports, immediate callers, shared utilities.
"Looks orthogonal" is dangerous.

不明白某段代码为什么长这样时，**走 Rule 1 的阶梯**，不要直接问，也不要直接改。

## Rule 9 — Tests verify intent, not just behavior
Tests must encode WHY behavior matters, not just WHAT it does.
A test that can't fail when business logic changes is wrong.

⚠️ **两条实测推论（都是 ccloop 用血换来的，直接用）**：
1. *** **一条判据在被【看到】打红之前，它不是判据。** *** 「绿」本身可能是空的 ——
   实测过：把被测函数改成永不被调用、判据照绿；删掉一整行写入、判据照绿。
   ⇒ **每新增一个分支，点名那条删掉【它自己】的变异，并确认它存在且被看见红。**
2. *** **排在被测调用【之前】、读回测试自己刚写进去的值的断言，永远不可能红。** ***
   验收任何判据改写时先扫这个形状。

⚠️ **「红在哪条断言」不是可靠的判别方式** —— 前面的断言会先短路。**要量什么就直接量什么。**

## Rule 10 — Checkpoint after every significant step
Summarize what was done, what's verified, what's left.
**Don't continue from a state you can't describe back.** If you lose track, stop and restate.

⚠️ 描述不出当前状态 ＝ **该交接了**：提交 → 写 handoff → 开新会话。

## Rule 11 — Match the codebase's conventions, even if you disagree
Conformance > taste inside the codebase.
**If you genuinely think a convention is harmful, surface it. Don't fork silently.**

⚠️ 这条是让规则可演进的那条规则。**本文件本身就是这样被改出来的**，别绕过它。

## Rule 12 — Fail loud
"Completed" is wrong if anything was skipped silently.
"Tests pass" is wrong if any were skipped.
Default to surfacing uncertainty, not hiding it.

---

## Rule 13 — 本仓库是多 agent 共享的
- **`docs/handoff/handoff.md` 里别的 agent 落下的条目【不要删】** —— 除非它已过期，
  而「过期」要能指出**是什么让它过期的**（哪一笔提交、哪一次实测）。**不确定就留着。**
- **任何持久写入必须带归属**：who（run／会话）＋ when ＋ 在哪一笔提交上。
  无主的断言在单 agent 时还能靠上下文猜，多 agent 时**直接不可用**。
- **历史记录不许就地改**。发现写错了 ⇒ **另起一节记更正**，原文逐字保留。

## Rule 14 — 证据纪律
- *** **绝不过滤验证性跑。** *** `grep` / `tail` / `head` / `sed` 都算过滤，**管道还会吞掉退出码**。
  一律**重定向到文件再整份读回**。
- *** **成本、耗时、token 只报工具给出的数。拿不到就说拿不到，【不许自估】。** ***
- **任何被记下的实测值必须带【测量命令】＋【观测时的 commit】** ——
  否则读的人无从判断它过没过期。行号、字节数、测试条数**引用前必须现测**。

## Rule 15 — 不可逆动作需人单独授权
**push**、**合并进 `main`**、**删分支或 worktree** —— 这四件**每一次都要人单独点头**，
不因为上一次批准过就自动延续。**非门合并一律 `--ff-only`。**

变异 / 故障注入**只在 `git clone --local` 副本里做**，主工作树全程零触碰；
还原证明看 `git diff` 与 `git diff --cached` 的**字节数**，不看肉眼。

## Rule 16 — 本仓库的规则不外溢
Orca 的规则**不放松它所操作的任何目标仓库的规则**，尤其 ccloop
（它有自己的一套铁律和一轮在飞的工作）。见 spec §7。
**新规则的生效边界是「本仓库的 agent」，不是「从现在起所有 agent」。**

## Rule 17 — 写到仓库外面去的东西，判据不许碰真的那一份
Orca 会写**用户全局数据**（第一处是 `~/.orca/`，由 `orca correct` 写）。ccmem 为同一件事有它自己的 Rule 13。
- **路径必须能由环境变量改道**（如 `ORCA_CORRECTIONS_DIR`），**判据一律走改道后的临时目录** ——
  *** **一条会写进使用者真实用户数据的判据，是不可接受的，哪怕它「只写一行」。** ***
- **新建的目录与文件显式给 mode**（目录 `0700`／文件 `0600`），**不从 umask 继承**；
  **已存在的文件不改它的 mode** —— 那是人的数据，不替人做决定。
- **仓库外的写入方要在 spec 里具名登记**：写哪个路径、谁触发、失败留什么残留。
