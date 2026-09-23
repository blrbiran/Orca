# Orca Handoff

> ⚠️ **这份文档是多 agent 共享的，而且【它不该无限膨胀】。**
> *** **本文允许就地改、允许删、允许整节替换**（Rule 13，2026-09-22 由人放宽）。 ***
> 动别的 agent 落下的条目要**同时**满足三条：(a) 指得出**是什么让它过期的**（提交主题行／哪一次实测）；
> (b) 它承载的**结论**在留下来的段落里活着 —— **删的是过程，不是结论**；(c) 不把已知为假的说法带下去。
> **三条里有一条不确定就留着。**
> ⚠️ **放宽的只有本文。** `.superpowers/sdd/**` 与已发布的 spec／注释**仍然一个字不改**，只能追加具名更正。
> ⚠️ **本文不写任何当前哈希**——提交本文这个动作本身就会改 HEAD，而人也会自己推远端。
> 要指代某一笔就**引提交主题行**，要指代材料就**引路径**。

> 📄 **方向性的问题**（我们到底要造什么、某条诉求能不能做、先后怎么排）去读 `docs/handoff/goal.md`。
> **它不是接手材料，每轮交接【不需要】读它。**

---

## 怎么读这份文档

| 你想知道 | 看 |
|---|---|
| 这是个什么东西 | §一 |
| 开工先跑什么 | §二 |
| 现在是什么状态 | §三 |
| 下一件事 | §四 |
| 哪些不要重开 | §五 |
| 干活时别再踩的坑 | §六、§七 |
| 代码／开发树／协议在哪 | §八 |
| 什么在等人 | §九 |

⚠️ *** **本文于 2026-09-22 由 5330 行压缩到现在这个长度**（会话 `da2f5e9a`，提交主题行见 §十一）。 ***
**删掉的是过程日志，不是结论。** 每一轮的原文都在 git 历史里，取回方式见 **§十一**。

---

## 一、Orca 是什么

**系统层**：决定跑哪些任务、怎么排、并行还是串行；持有决策台账工具、索引器、调度器、Web 面板。

| | 角色 |
|---|---|
| **ccloop**（`/Users/biran/code/skills/loop/ccloop`） | **一个工具** —— 把单个任务跑成循环。Orca 的**依赖**，不是 submodule |
| **Orca**（本仓库） | **系统** —— 工头 ＋ 工地记录 ＋ 看板 |
| **ccmem**（`/Users/biran/code/skills/ccmem`） | **记忆层** —— Claude Code 插件，走 CLI/DB 接口，**一个字都不 vendor** |

⚠️ **最容易搞混的一点**：`.decisions/` 台账**既不住 Orca 也不住 ccmem**，它住在**被干活的那个目标仓库**里。
**Orca 装的是工具，不是台账。** ⇒ 由此得出一条接入约束：
*** **Orca 必须能对任意目标仓库工作，不能假设自己在那个仓库里。** ***

**Orca 调用 ccloop，一个任务一个 ccloop run。ccloop 不知道 Orca 存在，也不需要知道。**

---

## 二、先跑这些，以输出为准

```bash
cd /Users/biran/code/skills/loop/Orca
/usr/bin/git ls-remote origin refs/heads/main    # 开工核一次、收尾【必须】再核一次
/usr/bin/git status --short; git log --oneline -5
ls ~/.orca                                        # Rule 17 的开工核对项
node_modules/.bin/tsx src/cli.ts resume           # 从最近的检查点接手
```

⚠️ **判断远端只能 `ls-remote`**，`git status` 的 `ahead N` 是缓存 ref。
⚠️ *** **所有 git 核对一律用 `/usr/bin/git`** *** —— rtk 会改写 git，且骗法有六种（§七.1）。
⚠️ **验证性跑一律重定向到文件再整份读回**，`npm run verify` 整套约四分钟，Bash 给 600000 ms 或放后台。

---

## 三、当前状态

**Orca 有十个子系统**（行数为 2026-09-22 现测，命令
`for d in …; do cat src/$d/*.ts | wc -l; done`，观测锚点＝主题行
`docs(handoff): roll the entry point onto the six rulings and the order they land in` 那一笔）：

`control` 7280 / `scheduler` 4482 / `panel` 3801 / `corrections` 1529 / `metrics` 1266 /
`chain` 1208 / `ledger` 709 / `gate` 551 / `checkpoint` 523 / `level` 346。

**已经能跑的**：`orca validate`／`plan`／`run`／`correct`／`metrics`／`panel`／`compact-reviews`／
`level`／`checkpoint write`／`resume`／`gate`／`chain`（完整用法 `src/cli.ts` 的 `USAGE`）。
出厂 `orca panel` 会开控制 store、挂 `/api/control`、listen 前跑完 recovery、自带 wake pump、
SIGINT/SIGTERM 每 epoch 恰好写一条 shutdown；`--no-control` 关掉时行为与挂载前逐字节相同。

**还不能跑的**：*** **Web 派活到真 ccloop 打不通。** *** 一次 Web claim 必得
`control-capability-unsupported` —— ccloop 的 `control capabilities` 只答七个字段，
`CapabilityViewV1` 要的 `contextObservation`／`handoffControl`／`handoffExecution`／
`contextWindowTokens`／`requestBoundProof` **一个都没有**（§八.4）。

**现行基线**（2026-09-22 现测，只抄工具报数）：

| 门 | RC | 结果 |
|---|---|---|
| `npm test` | **1** | 180 文件通过 / 1 skip（182）；1611 通过 / **2 失败** / 5 skip（1618） |
| `verify:control` | **1** | 42 文件通过 / 1 失败（43）；430 通过 / **2 失败**（432），0 skipped |
| `verify:web-control:consumer` | **1** | **2 失败** / 2 通过（4），0 skipped |
| `typecheck`／Web 门／`verify:panel` | **0** | Web 门 14 文件 70 测试；panel `PASS 0`–`PASS 14` |

*** **三道红门的失败【全部】是同一对判据** ***：`tests/control/webCcloopSmoke.test.ts` 的两条，
报 `start-envelope-conflict:run:targetVersion`，抛点 `src/control/startEnvelope.ts:65`。**不是回归。**

⚠️ *** **别只看 RC。** *** 这几道门在 `targetVersion` 定型之前**必然 RC1**，RC1 本身不携带信息。
**判别式是「除这两条之外有没有新的红」。** 回绿的定义：
`verify:control` ＝ RC0 / 43 文件 / 432 通过 / 0 skipped；消费者门 ＝ RC0 / 4 通过 / 0 失败。
基线台账与未过滤日志：`.superpowers/sdd/2026-09-22-control-gates-baseline/`。

---

## 四、⛔ 下一件事

1.–4. ✅ **两道门基线／三仓 handoff 更正／压缩本文档／ccloop 的 E1 I-2** —— 都已完成。
   （I-2 的缺陷：非字符串 holder 被 `parsePid` 强转成 pid ⇒ 无法归属的锁被 `ccloop unlock`
   **无凭证删除**。材料在 ccloop 台账 §46 与
   `docs/superpowers/specs/2026-09-23-i2-array-holder-coercion-design.md`。）
5. ✅ *** **ccloop 的【人裁 85（`ls` 也报锁）＋ I-3】也做完了**（2026-09-23，人裁 129–138，
   全程在 ccloop 仓库里）。 *** Orca 本轮只是调度方，**生产改动一行都不在 Orca**。
   做出来的：`ccloop ls` 报锁的全部七态；红线函数把「活性判不了」和「持有者活着」分开报，
   并给前者一个自己的错误类；三处重试闸门各加一支**以保住**那三格今天的重试行为。
   细节在 ccloop 的 `docs/superpowers/specs/2026-09-23-ls-lock-visibility-design.md`（§10／§11
   记着 **18 条被实测推翻的初版结论**）与 `.superpowers/sdd/2026-09-23-ls-lock-visibility/progress.md`。
   ⚠️ **ccloop 的挂账队列到此清空** —— 「不要插队」这条约束**不再适用**。

6. ⛔ *** **下一件事就是 G1 那条线。** ***
   ccloop 侧定契约（capability 词汇表 ＋ `targetVersion` 定型，走 brainstorming → writing-plans）
   → Orca 跟随改 `src/control/webProtocol.ts`／`schema.ts`／`types.ts` 三处
   → 两条红判据回绿
   → **终点判据：Web 派活到真 ccloop 能开出一个 run**。
   ⚠️ *** **动契约后要先重建 `/tmp/ccloop-codex-0919/dist` 再重跑那两道门** *** —— 现在的基线量的是
   Sep 19 21:48 的构建，不重建就是拿旧二进制当证据。
   ⚠️ *** **G1 只定了「由 ccloop 拍」，没定 `targetVersion` 拍成什么。** ***

**明确暂时不碰**：`goal.md` 的 G5（syncskill 补三件）、§3.3 loop 方案层、§3.4 Web UI 扩展 ——
**都依赖第 6 步先通**，现在开等于在打不通的系统上加工作量。


## 五、已经拍板过的事（**不要重开**）

### 5.1 语言与记法（人 2026-09-01／09-02 当面交代）

1. **对话用中文**；2. **handoff 用中文**；3. *** **代码、注释、CLI help、README 用英文** ***；
4. *** **commit message 用英文** ***（只对新提交生效，历史 16 笔中文不改）。
- 照抄计划里的代码块时**注释改英文，逻辑与变异表一字不动**；spec／plan 保持中文，只追加 ERRATUM。
- **handoff 不是给人读的** —— 人读对话里的摘要（人 2026-09-17 原话）。
- **本文不写 HEAD、不写「领先几笔」**；指代某一笔引**提交主题行**。
  *** **唯一例外是【观测锚点】** *** —— 某批实测值的有效期，必须写明它是锚点（Rule 14）。
- 计划里的 `- [ ]` 复选框**照勾**（那是进度）；**改某个 Task 的内容**才要另起具名更正。
- **skill 与 `CLAUDE.md` 冲突 ⇒ `CLAUDE.md` 优先；计划与 spec 冲突 ⇒ spec 优先。**

### 5.2 系统设计

1. **权限模型**：Tier 0 机制禁止／Tier 1 自决留痕／Tier 2 不记录；
   **`undo.how` 说不清 ⇒ 自动降级 Tier 0**。
2. **人裁的触发条件**：不是「agent 不确定」，是「**两个事实打架且能摆出两边**」。
   不确定但无冲突 ⇒ **强制一轮自我反驳** → 自决 → 记台账。
3. **台账存储**：**git 为真相源 ＋ DB 做索引**；每个 agent 只写 `.decisions/<run-id>.jsonl`
   （**结构上不可能冲突**）；**不存 commit hash**，由 `git blame --follow` 反查。
   台账文件按**做决策那轮的 run id** 署名，**新决策不许混进上一轮的文件**。
4. **依赖方式**：ccloop 走 npm 依赖（锁版本），**ccmem 不 vendor**，**都不用 submodule**。
   ⚠️ **「走 npm 依赖」至今没落地** —— 现实是 `ORCA_CCLOOP_BIN` 指本机二进制（§八.2）。**这是缺口，不是决定。**
5. **`CLAUDE.md` 硬预算 ≤ 200 行**（`npm run verify` 会断言）。
6. **并行判据**：写集 ＝ `targetPaths` ∪ `allowlistPaths`，**相交 ⇒ 串行**。
   合并进**集成分支** = Tier 1，合并进 **main / push** = **Tier 0**。
   ⚠️ *** **冲突检测／分类／解决／验证是主干，写集相交判据只是优化 —— 判据算错时系统必须仍正确。** ***
   分工：代码检测 → 模型分类并解 → 代码验证（`requiredChecks` 并集）→ 语义残余升人；
   **解冲突的不能是当事任务本身**；逐块判断进台账 Tier 1。
7. **子系统顺序 A′ → (B ∥ C) → D → E**（已全部落地或在飞）。
8. **E4（DB）不出 spec**，由实测阈值触发（全量扫 144 行 ＝ 2.4ms，还早得很）。
9. **面板后端引 express、前端 React**（人看过「openclaw 115 根依赖 vs 本仓库 1 个」之后仍裁定引，代价具名登记）。
10. **面板只能记，不能闭环**（A′ §4.1）。⚠️ **D-launch 明文推翻了它的一半**：
    **web UI 的开链入口是开放的**，两种绑定模式都开放。
11. *** **`overturned` 不许 agent 写。** *** 它需要 `correctionId`，而 correction 是**人**的日志 ——
    agent 编一条等于伪造 ccmem 对照样本的右半边。
12. **对照样本不由 `overturned` 承载**：由 decision 的 `chose`/`because`/`evidence`/`alternatives`
    ＋ correction 行拼出；`overturned` 是**瘦闭环事件**。correction 的 `because` 是对记忆层最值钱的字段。
13. **`projectKey` ＋ `decisionId` 联合键**归桶（decision id ＝ `<run-id>/<n>`，**不含仓库身份**）。
    ⚠️ Orca 自己抄了一份 `normalizeRemoteUrl`，**ccmem 改算法会静默分叉** —— 改任一侧要双方核对。
14. **Orca 在 ccloop／ccmem 的 handoff 里只保留一节，就地滚动更新，不新增编号章节**（人 2026-09-02 定）。
15. **「需要时允许改 ccloop 和 ccmem」**（人 2026-09-03）—— 用法是**先报再动；守它们自己的规则；
    push 仍每次单独授权**。
16. **D-launch（`orca chain`）**：外部监督进程；退出检查点带 `chain` 字段；`auto` 权限；四条硬上限；
    超时只是保底默认 360 分钟；链记录在仓库内提交；`--goal` 必填；停链＝**当前会话跑完再停**；
    闸门被链内 agent 改动 ⇒ **检测即停**；**拒绝嵌套链**。
17. **方向不重开**（2026-09-19 人的要求）：**Orca 控制 ccloop，agent 适配留在 ccloop；
    Web 是人的主要操作入口（Web > CLI）；ccmem 是决策记忆系统。**
    长期 agent 优先级 Claude Code > Codex CLI > OpenCode > oh-my-pi > pi。
18. **G1–G6**（2026-09-22，全文在 `docs/handoff/goal.md` §8，**引用引那里的编号**）：
    G1 control v1 线上契约归 ccloop；G2 `level`/`checkpoint`/`gate` 留 Orca；
    G3 `orca chain` 是 Orca 自用；G4 完成度 ＝ 已完成 task 数／总数 ＋ `attempt n/max`；
    G5 syncskill 补三件；G6 A2A 只做只读状态外壳。
    ⚠️ *** **G1 只定了「谁有权拍」，没定 `targetVersion` 拍成什么。** ***

### 5.3 边界

- *** **push 需人单独授权。控制器不许 push。** *** 开门／合并进 main／删分支或 worktree 同样各自需要授权。
  **非门合并一律 `--ff-only`。**
- ⚠️ **Tier 0 闸门已在本仓库生效** ⇒ 这四件**人点头了 agent 也做不成**，由人在自己终端做（§八.3）。
- **本仓库的规则不外溢到 ccloop**（spec §7）——否则这套设计会变成一条中途放宽 ccloop 规则的后门。
- **对姊妹仓库只报诊断、不动手**（Rule 3）；它们的 handoff 可整节重写，
  **但不得把已知为假的说法带下去**。
- **Rule 17**：写仓库外（`~/.orca`）的判据必须改道；新建目录 0700、文件 0600 显式给；
  **已存在的文件不改 mode**。

---

## 六、跨轮还活着的教训

> 下面每一条都**真栽过**。出处（哪一轮、哪个会话）见 §十一，原文用 `git log -p` 取回。

### 6.1 「绿」为什么会是空的（**最贵的一类，反复发生**）

*** **一条判据在被【看到】打红之前，它不是判据。** *** 已知七种独立形状 —— **不要合并它们**：

1. **判据本身是空的**：断言 `status >= 400` 而 POST 的根本不是一条路由，回 404 照绿。
2. **守卫冗余**：旁边有第二道守卫，删掉这道照绿。
   ⇒ *** **写变异表先问：这个分支是不是【唯一】挡住它的东西？** *** 钉不住的**登记为冗余守卫，不编假判据**。
3. **从错的地方看它**：按事件名选 schema 的那条路上，literal 不可观测；直接对 schema 断言就红。
   ⇒ *** **有办法看见就不许登记成看不见。** ***
4. **链式依赖证明不了一行路由承重**：要有一个**只有那一行会挡住**的对象。
5. **判据在拿代码和自己对比**：断言 `mode === 常量`、序列化结果 vs 字段常量本身 —— 交换字段照绿。
   ⇒ *** **凡「断言 == 被测代码里某常量」，先问这个常量本身是谁钉的** *** ⇒ 钉字面量。
6. **中间隔着一条永远先炸的断言**：删守卫让整个调用成功 ⇒ 消息断言先红，「什么都没写」从未执行。
   ⇒ 打中它的是**故障注入**（保住抛错，只把它挪到写入之后），不是删除式变异。
7. **期望值由被测函数自己算出来** ⇒ 永远红不了。**期望值一律写字面量。**

**另外四种同族**：
- *** **凡涉及时钟的判据，只断言「跑出来了／拒绝了」一定是空的** *** —— 变异体跑满超时照样「拒绝」。
  要断言**哪个时钟被问了**或**年龄字面值**。
- *** **断言【形状】的那条，在「换成形状合法的固定值」变异下永远绿。** *** 每条形状断言旁要有一条**值**的断言。
- *** **「什么都没发生」没法轮询到完成。** *** 只能观测**有界窗口**，窗口从真实延迟来源算
  （锁预算 1000ms ＋ 落盘 500ms）。立刻读一次「0」的判据对异步写入**8/8 稳定假绿**。
- *** **只断言 verdict、不断言理由的判据看不见整支变异**（104 条全绿）⇒ 加一条钉住拒绝理由的。 ***

⚠️ *** **第八种（2026-09-23 实测，最贵的一次）：一个变量同时承担「被判断」和「被展示」时，
任何一端的规范化都会【静默解除】另一端的守卫。** ***
ccloop 的 I-2 里，spec 第一版把「渲染成 `JSON.stringify`」贴在那个既喂分类、又喂显示的变量上 ——
于是数组先变成字符串，类型守卫在那条路径上**完全不承重**：**删掉它，行为一格不变、全套零红。**
⇒ **修法是把两件事拆成两个变量**；⇒ **判别办法是：删掉你新加的那个守卫，看行为变不变。**

⚠️ *** **「红在哪条断言」不是可靠的判别方式** *** —— 前面的断言会先短路。**要量什么就直接量什么。**
⚠️ *** **排在被测调用【之前】、读回测试自己刚写进去的值的断言，永远不可能红。** *** 验收改写时先扫这个形状。

### 6.2 变异怎么做才算证据

- *** **变异落没落上去，用 `shasum -a 256` 前后比对** *** —— 有一轮 heredoc 里 `os.environ` 没 export，
  KeyError，复合命令吞掉退出码，**变异根本没写进文件，于是全绿**。不相等才算落上去，相等当场停。
- *** **靠崩溃变红不是证据** *** —— `Tests no tests`（模块加载失败）＝所有判据都没跑。
  改成「让条件永不命中」。
- *** **变异只在 `git clone --local` 副本里做**，主工作树全程零触碰 ***；
  还原证明看 `git diff` 与 `git diff --cached` 的**字节数**。
  ⚠️ **副本只克隆【已提交】状态** ⇒ 要测未提交改动，先 `cat` 进副本再 `diff` 证明逐字节相同。
  ⚠️ **副本没有 `node_modules`** ⇒ 软链主树的，走 `./node_modules/.bin/vitest`；删副本前 `/bin/rm -f` 软链本身。
  ⚠️ *** **每组变异都要先跑出一次【绿基线】** *** —— 不报绿基线的电池不算证据（曾在红基线上跑，整组作废）。
  ⚠️ 副本里跑 spawn 场景必须带 `ORCA_CCLOOP_BIN`，否则量的是路径解析。
- *** **表齐 ≠ 覆盖齐；每个 `finally`／失败路径也要点名变异。** *** 29 条条条见红仍漏了 `finally`。
- *** **变异「落上去了」也可能对【产物】毫无作用** *** —— 改构建配置／生成器的变异要**量产物**，不只量源码 hash。
- **每新增一个分支，点名那条删掉【它自己】的变异，并确认它存在且被看见红。**
- *** **落地之前先问「删掉它自己的那条变异，能红吗？」** *** 答不上就去量。
  先问的代价是一次探针，落地了再回头查的代价是一整轮变异。
- **变异表必须带「喂它的场景」一列**，缺了就是缺证据。
- **加判据时回头更新旧预言；改生产代码时回扫旧变异会不会变绿**（上游修根因会让下游守卫冗余）。
- *** **「找不到落点」时先别改变异 —— 先问是不是缺判据。** ***
- ⚠️ **量红只在 clone 里；主工作树不许 `stash`／`reset`／`checkout`。**

### 6.3 预言「红在哪」的三维记法（**三维要一起用**）

1. **防假**：每写一条「期望红在 X」，把变异在脑内跑到底，问「X 之前有没有别的断言先炸」。
   假预言会主动把执行者引向改没坏的代码。
2. **防不全**：问「被删掉的那一行，还有【谁】在走它」。
   *** **写成「红在 X 且仅 X」或「红在 X 与 Y」，不留「至少」。** ***
3. **防同名**：*** **点名那条断言里的【字面量】是从哪个字段来的** *** ——
   两条长得像的字符串来源可能不同。实测 16 条写错 5 条（31%），**普查写成 grep 也没兜住**。

⚠️ *** **知道一条记法不等于会用它** *** —— 刚补进记法的那一问，同一轮自己又漏做。
**普查要写成命令，不许靠脑补。**

### 6.4 spec / 计划 / 评审

- *** **凡是 C 够不着的动作，只能【检测＋降级】，不能声称禁止。** *** 声称禁止就是把不成立的前提写进设计。
- **多子句谓词：每一支必须有一条只有它能接住的独占判据。** 答不上「哪条例子只有这一支能接住」，那一支就是死码。
- *** **「照抄 X」是一条可现测的断言，不是背景说明。** *** 而且「X 做了什么」与「X 的前提我们有没有」是两件事，**两件都要现测**。
- *** **措施对不代表理由对，两者分别验。** ***
- *** **同一轮的两个修法会互相拆台** *** ⇒ 修完一批，每条修法和同批其它每条**对撞一次**；
  **派第二席时必须指名要它做对撞** —— 这是它独有的产出。
- *** **评审要评的不只是原缺陷，还有修法本身** *** —— Minor 的修法造出过两条 Critical。
- *** **评审员给的修法也要现测**；它的顺带论断也要核 *** （主结论对、顺带事实两次错）。
- *** **8 条 Critical 没有一条是设计错 —— 全是判据空／跑不动／落点错。** ***
  spec 层自审够用；**判据层自审在计划阶段根本没法真做**（被测代码还不存在）
  ⇒ **计划评审只买「结构与落点」，「红数」验收放到实施之后。**
- *** **计划正文里的 shell 是自审看不见的那一块。** *** 两问写成可跑命令：
  ① 变量未赋值时展开成什么（护栏 `"${VAR:?msg}"`）；
  ② *** 有没有 `<`／`>` 出现在不是重定向的位置 *** （占位符 `<夹具>` 会造出名叫 `--as-of` 的文件）。
- *** **一个扫描器只在语料上跑不够，必须同时有【必抓】和【必不抓】两组样本。** ***
  「BAD_COUNT = 0」什么都不证明 —— 恒返回 0 的扫描器给同样的输出。
  **扫描器也不许对自己的警告文字报警**（先剥注释再判）。
- **计划里的代码块会 import【未来】** ⇒ 开工扫描机械检查：本 Task 的每个 import 现在存不存在。
- **计划里藏着声明了却没实现的端点** ⇒ 开工扫描逐条比对 Interfaces 的 Produces 与正文实现。
- **「判据要点、执行时写全」实测会漏** ⇒ **每个空 `it` 当成待裁决，不是待照抄。**
- *** **「照 spec 逐字实现」会把 spec 内部矛盾原样实现出来** *** ⇒ 终审要专门找
  「同一概念在不同节里是不是同一个键」。
- *** **写实现与验变异不能是同一个上下文** *** —— 会把「我知道它会红」当成「我看见它红了」。
  `subagent-driven-development` **值这个钱**（整支复审抓到 5 条单任务看不见的 Important），
  **但它是主要开销**（约 40 个 subagent 席位）。
- *** **不要因为每席任务都 Approved 就跳过全分支那一席** *** —— 它找的全在任务之间的缝上。
- *** **一个会「拼装＋运行」计划代码的预检席值这个钱** *** —— 在代码存在之前抓到 4 条变异红不了、9 个未测分支。
- *** **brief 里写了「整份读回」也会被绕开** ***（子代理用脚本筛 verify 输出）⇒ **收货时要查它是怎么读的**；
  变异记录会被照着预言抄，**审查者要复跑**。
- *** **红证可以整条外包给变异席 —— 前提是它肯说「我没看到」。** *** 这是 Rule 12 在 subagent 身上的样子。
- **归属行（Co-Authored-By）要么派发里说死，要么验收时现查** `git log --format='%(trailers)'` ——
  实施席会换成自己的模型。
- **「只在需要时才做」的优化先问「谁会重新触发这个需要」。**
- **一份 spec 里「今天不需要 X」和「X 会拿走什么」不能同时存在。**
- *** **写完 spec，拿每条论断去对 spec 自己的实测表** *** —— 作者自审看不出自相矛盾，要换「挑错席」重读。
  **撤回一个说法要全文 grep。**

### 6.4b 扫描器族的两条新坑（**2026-09-23 实测，都属「扫描器没在做它声称的事」**）

- *** **`grep` 配 `$'\x00\|\x01…'` 在 bash 里会在 NUL 处【截断参数】** *** ⇒ 模式变成空串、
  **命中每一行**。实测报出的数**正好等于文件总行数**，看起来像扫到了一大堆，其实什么都没扫。
  ⇒ **扫控制字节一律用 python 直接读字节。**
  ⚠️ 这条与 §六.4 那条「一个扫描器只在语料上跑不够，必须同时有【必抓】和【必不抓】两组样本」同族 ——
  *** **恒命中全部行的扫描器，和恒返回 0 的扫描器一样没用。** ***
- *** **扫描词从【英文源码注释】机械导出，对【中文活文档】恒零命中。** ***
  实测：全树扫描的**范围覆盖到了**中文 handoff，却一条都没捞到，于是一份活文档带着已知为假的说法过了一整轮。
  ⇒ *** **「扫描器跑了」「范围对了」都不等于「它在做它声称的事」。导出扫描词时要覆盖语料的语言。** ***

### 6.5 文档、发布状态与「写下即过期」

- *** **「本文未发布」是一条会过期的现测，不是文档属性。** *** 机械做法：
  ① 每次就地改之前现跑 `ls-remote` ＋ `merge-base --is-ancestor`，**开工那次不能复用**；
  ② 写「未发布」时把远端 sha 一起写上；③ 收尾的 `ls-remote` 是「本轮有没有改过已发布文本」的唯一检测手段。
  ⚠️ *** **同一会话内远端被人推动 3–4 次是常态，别再当它是偶发。** ***
- *** **一句「现测 X 不存在／没发生」写进文档的那一刻就开始过期，而它不会自己更新。** ***
  引用前去它描述的那个来源**现看一眼**。已兑现 ≥4 次。
- *** **一条「现测 X 为零」的断言，一旦被写进【那件让它不再为零的产物】里，就会永久自证。** ***
- *** **「已就地更正」也是一条预言** *** —— 三处「已在上文就地更正」现测都没落地。
  **引用「已修」之前去被修的那一行看一眼。**
- *** **「顶层找不到」不是「已离开」。** *** 凡是要据缺席**移走／删除**人的数据，都要一条**正向证据**。
- *** **「禁区」判断必须每轮现测重建，不能从上一轮继承。** ***
- **改活文档后把 `git diff` 的 `-` 行单独抽出来通读** —— diffstat／hunk 行号看不出误删别人的条目。
- **markdown 表格中间插内容会切断表** ⇒ 改表后**整份读回看渲染**，不只看 diff。
- *** **「逐字保留已发布注释」≠「注释还挂在它描述的东西上」** ***（JSDoc 被挤到挂错宿主，字节一个没变）。
- **撤回一条规则要改它出现的每一处** —— 残留的旧措辞会被下一个会话逐字执行。
  做法：grep 全文 → 逐处改／删 → 再写撤回。**写下教训不防重犯，机械扫描才防。**
- *** **注释里写「会答 500」之前先量。** *** 读代码推出来的不算。
- *** **一句「今天守得住靠权限弹窗」从来没量过** *** —— 现测才知道闸门当时根本不存在。

### 6.6 派席、成本与上下文

- *** **一席外派稳定在 130k–220k token，连续五轮成立**；席位自陈拿不到自己的 token 数，
  只能由派出方的工具报数填。 ***
- *** **一个 Task 三到五席、30–45 万 token；控制器做完 1–2 个 Task 上下文就逼近 Rule 6 的 450k
  ⇒ 一个会话做 2–3 个 Task 就该交接。** ***（人曾一次性指令覆盖过，那是单次指令。）
- **大动作（多席外派、动 E1、跑 Linux）之前先跟人报预估，且只报工具给出的数。**
- *** **贵的不是读文件，是上下文变大后每次调用重发整份。** ***
  **大规模调研要么单开会话，要么读完立刻落文档并交接。**
- **历轮都在实施中途报过一次预算并让人重新拍板 —— 这是对的做法，照做。**

---

### 6.7 本轮（2026-09-23，调度 ccloop 那一轮）新栽的

- *** **「别人会接住」本身就是一条预言，而预言会错。** *** 本轮**四条**红预言被实测推翻。
  最贵的一条是计划里写的「这两处闸门的变异由另外两个 Task 的判据接住」—— **实测零红**。
  ⇒ *** **跨 Task 的红证必须在两个 Task 都落地之后【真的重跑一次】，不许只在纸上推。** ***
- *** **护栏自己也有盲区，而盲区看起来和「通过」一模一样。** *** ccloop 的零写证明用的快照 helper
  **从来没记录过目录的 mtime**，于是「探测时 touch 了 run 目录」这条变异**跑出全绿**。
  ⇒ **补护栏时先写一条打它盲区的变异。** 同族：只记 mtime 不记 size、不记根目录自身。
- *** **「已知红名单」本身是一条会过期的现测。** *** 判别式（红 ⊆ 名单，按名字核）是对的，
  但名单从 7 条补到了 13 条 —— 多出来的 6 条**一直在 flake，只是没人记名字**，
  于是判别式会把它们**误报成回归**。⇒ **名单要机械判**（ccloop 现在有 `scripts/check-known-reds.mjs`），
  **且引用名单前先确认它是哪一轮测的。**
- *** **erratum 里不许写计数。** *** 本轮实施席写了一条 erratum 说「不再适用于三格中的两格」，
  实测是**三格全部**，而**同一段的下一句自己就说了三格**。**点名，不要计数。**
- ⚠️ *** **在「关闭某类缺陷」的那一波里顺手多修一处，正是新引入该类缺陷的地方。** ***
  上一条就是这么来的：那处修改不在命名的发现清单里，是实施席自作主张多修的。
  ⇒ **收货时要问「你有没有修清单之外的东西」；派发时要写明「看见了就报，不要顺手修」。**
- 🔴 *** **压缩活文档时丢结论 —— 控制器本轮自己犯了两次。** *** Rule 13(b) 写着「删的是过程，不是结论」，
  而两次整节重写都把仍然活着的结论一并删掉了（一次在 ccmem，一次在 ccloop，后者丢了七条，
  其中包括上一轮「最值钱的一条教训」）。**两次都是靠【把 `git diff` 的 `-` 行单独抽出来逐条读】捞回来的。**
  ⇒ *** **这条机械检查不是可选项。写完整节替换，必须逐条过一遍被删的行。** ***
- **一席外派的用量区间本轮实测**：评审席 60k–190k token，实施席 140k–450k token。
  **一个 12 Task 的轮次用掉 18 席。**（只抄工具报数。）


## 七、工具骗法（**每一条都真栽过**）

### 7.1 rtk（**六种**）

1. `git status --porcelain` 空时打印 `ok`；藏在 `| wc -c` 后面更毒：**rtk 报 2，`/usr/bin/git` 报 0**。
2. `git diff | wc -c` 把 **0 字节报成 1 字节**。
3. 长 `grep` 截断成「[+N more]」。
4. 含括号的正则**直接报错**。
5. *** **`rtk proxy git log` 会漏掉 HEAD 那一笔** *** —— 第五种，最危险。
6. *** **目录列表也会骗** *** —— `ls <dir>` 的过滤输出里**没有 `dist/`**，`rtk proxy ls -la` 的整份读回里它在。

⇒ *** **验证性 git 一律裸 `/usr/bin/git`；目录列表也算验证性读，一律 `rtk proxy` ＋ 重定向 ＋ 整份读回。** ***
**派给 subagent 的 brief 里也要写明这条。**

### 7.2 git

- `git checkout -- <未提交新文件>` 报 `pathspec did not match` **不还原**；
  对上一任务已提交的文件则**静默丢掉本任务实现**。它是从**索引**恢复，不是 HEAD。
- *** **`git diff` 看不见未跟踪文件的内容改动** *** ⇒ 零触碰证明用 `shasum -a 256` 前后比。
- *** **`git add <已跟踪> <被 gitignore>`：能加的加进去、同时非 0 退出** *** ⇒ `&&` 跳过 commit，
  下一次 commit 一起扫走。**`.superpowers/sdd/**` 必须【单独】`git add -f`。**
- `git rev-parse --absolute-git-dir` 返回 realpath（`/tmp`→`/private/tmp`）；git 吐的路径只比存不存在，不比字符串。
- `git commit -m … -- <path>` 对**未跟踪**文件报 pathspec 不匹配 ⇒ 先 `git add -- <path>`。
- cherry-pick／merge 进行中 `git commit -- <path>` 得 `fatal: cannot do a partial commit`（exit 128）；
  **`REVERT_HEAD`、rebase-merge、rebase-apply 不拦**（git 2.50.1 实测）。
- `git commit` 带路径时 `--only` **本来就是默认** ⇒ 删它的变异永远绿。
- 仓库没配 git 身份**不足以**让 `git commit` 失败（git 自猜身份带警告成功）；
  真失败条件是 `user.useConfigOnly=true` ＋ 全局／系统配置为空。
- 进程内 git 调用会触发会话可改的 `.git/config` 里的 `core.fsmonitor`
  ⇒ 监督进程的 git 一律 `-c core.hooksPath=/dev/null -c core.fsmonitor=false`。
- *** **`core.hooksPath` 是本地 config** *** ⇒ 门曾以**未武装状态出厂**；现由 `npm prepare` 装、`verify` 断言。

### 7.3 zsh / shell

- *** **zsh 吃掉无引号的 `--include=*.ts`** *** —— `no matches found`，整条复合命令 exit 1、重定向文件为空。
- *** **zsh 对无引号变量不做词分割** *** —— `for f in $FILES` 把三个路径当一个词，
  覆盖静默没执行、verify 照绿（**量的是错的树**）⇒ 字面列表 ＋ 逐个 `diff` 打印 `IDENTICAL`。
- *** **管道吞退出码** *** —— `… | tail -5` 之后读到的 `RC=0` 是 tail 的。
- **shell 复合命令吞掉 heredoc 内 python 的失败退出码。**
- **shell 状态不跨 Bash 调用持久** —— `D=$(mktemp -d)` 在另一个代码块里展开成空，`/bin/rm -rf "$(dirname "$D")"` ＝ `/bin/rm -rf .`。
- *** **本机 `rm` 和 `cp` 都有 `-i` alias** *** —— `rm -rf` 静默挂在确认提示上直到超时，`cp` 静默拒绝覆盖。
  **一律 `/bin/rm -rf` 和 `cat pristine > target`。**
- **macOS 没有 `timeout(1)`。**

### 7.4 测试与构建

- *** **`npm run verify` 打印【多档】判据数**（全仓／scheduler／web）—— 别混着比。 *** 评审席在这里栽过。
- *** **「少跑一条」在 vitest 里是绿的，只在计数里露头** *** ⇒ 必须另加 `.length` 判据。
- vitest `environment: "node"` ＋ `renderToStaticMarkup` 下 **`useEffect` 根本不跑**
  ⇒ 这类 bug **结构上不可能红**。
- vitest 中 fire-and-forget 写约 **500ms** 后落盘，立刻读 store 的判据**稳定假绿**。
- `vi.resetModules()` ＋ 动态 `import` ⇒ 类身份不同，`toBeInstanceOf` 必须用**动态模块实例上的类**。
- 两份 vite 并存（根由 vitest 带入、`web/` 自己一份）⇒ `web/vite.config.ts` 只能从 `vitest/config` 取
  `defineConfig`；变异副本要**同时软链两个 `node_modules`**。React 19 无全局 `JSX` ⇒ `import type { JSX } from "react"`。
- *** **`npm audit` 的文字报告会把 high 和 critical 折叠掉**（列 2 条、汇总写 5）⇒ 分诊一律走 `--json`。 ***
- *** **`fetch` 测不了路径穿越** *** —— WHATWG URL 在客户端折叠 `.`／`..`／`%2e%2e`。
  HTTP 级判据走 `node:http` 发原始 path，并配正向对照。
- 判据不许把颜色押在两个同长定时器谁先回来上；真子进程用 `sleep 3` 拉开。
- *** **判据红了不等于它起的东西没了** *** —— 真进程判据要显式 teardown；
  **「杀掉 tsx」≠「杀掉在监听的进程」**（tsx 在子 node 里跑）⇒ detached spawn ＋ 对**负 pid** 发信号杀整个进程组。
- *** **一条判据可以在真实世界里造成它所测试的危害** *** —— 省略 `bind` ⇒ `listen(port, undefined)` **绑所有网卡**。
  用 `192.0.2.1`（TEST-NET-1）还不够，**必须同时断言是哪一种拒绝**；
  且 192.0.2.1 上 connect 拿不到 `ECONNREFUSED`，「没在监听」只能用 OS 侧观测。
- *** **「空 env」在本仓库等于「真的 `~/.orca`」** *** —— 每个起服务器的判据都显式给改道后的 `ORCA_CORRECTIONS_DIR`。
- **夹具的 schema 违规不会响** —— 宽容读取器判成坏行、悄悄退出计数，还会把临时路径写进 golden。
  **生成 golden 后必须整份读一遍，对着夹具已知条数核。**
- 数判据条数按**行首**匹配；`grep -c 'it("'` 子串计数会多算。

### 7.5 字节、Claude Code 钩子与 transcript

- *** **在工具调用里写 NUL 类转义，落到盘上是【裸字节】** ***（累计五次）。git 把文件判成二进制
  ⇒ 评审包只剩 `Binary files differ`，**评审员看不到文件、却照样出了「通过」**；Bash 工具会以
  「含隐藏控制字符」拒收 heredoc。⇒ 用文字描述或 `String.fromCharCode` 构造；**每次编辑后字节扫描**；
  **收到评审包先看 diffstat 有没有 `Bin`**。
  *** **扫描是护栏，禁令只是提醒 —— 禁令本身一次都没拦住。** ***
- **扫描器也会被字节骗** —— 报「`UNIT_SEPARATOR` 是空串」，`od -c` 现测是 `"\037"`。
  **看起来是空串的字面量先 `od -c`。**
- *** **读人的配置文件只打印明确需要的键，不打印 `env`** *** —— 曾有一把 API key 明文进了 transcript。
- transcript 的 `message.model` **分不出 1M**（只记 `claude-opus-5`）；
  `type=attachment, attachment.type=model` 的 `identity.modelId` 才带 `[1m]`。
- `ls -t … | head -1` 取「最新 transcript」会选中**别的会话** ⇒ 按会话 id 精确取并核对 model attachment。
- *** **子代理工具调用的钩子 stdin 里，`session_id`／`transcript_path`／`cwd` 都是【父会话】的** ***；
  唯一能区分的键是 `agent_id`／`agent_type`。子代理自己的 transcript 在
  `<transcript 目录>/<session_id>/subagents/agent-<agent_id>.jsonl`。
- Claude Code **只记有 stdout 的钩子**；钩子被 10s 超时杀掉时 `||` 兜底来不及打印，对 agent 仍是静默。
- *** **PreToolUse `exit 2` 在默认／auto／bypassPermissions 下对父与子代理都拦；
  钩子自身出错（exit 1）与超时被杀都【放行】。** *** `deny` 在 bypassPermissions 下仍生效、
  **看得穿 `&&`、看不穿 `sh -c`**。
- 只读打开 SQLite（`mode=ro`）**仍会改 `-shm` 的 mtime** —— `mode=ro` 不是零触碰证明。

### 7.6 ccloop 侧

- `scripted` adapter **不产 `diffPatch`**。
- `run`／`resume` 的退出码是 `status==="succeeded" ? 0 : 2` ——
  *** **四个非成功终态被压成同一个 2 ⇒ 必须读 `loop-state.json` 的 `status`。** ***
- `blocked_waiting_human` 是**终态且不可 resume**。
- `readDiffPatch` 有三条**静默空补丁**路（无 `--binary`、`maxBuffer` 10MB、catch 只对 code 1 返回 stdout）。
- `evaluatePathPolicy` 是**纯事后检测器**，`targetPaths` 根本没被它读（只报诊断）。

---

## 八、既定事实与坐标

### 8.1 代码在哪

`src/{chain,checkpoint,control,corrections,gate,ledger,level,metrics,panel,scheduler}/` ＋ `src/cli.ts`；
前端在 `web/`（进根 `workspaces`）。`npm run verify` 串起 typecheck、全量测试、台账校验、
`CLAUDE.md` 行数、`core.hooksPath`、`verify:control`、`verify:scheduler`、`verify:chain`、
web build、`verify:panel`、`--ws check`。**CLI 退出码 0/1/2**，另有 exit 3（plan 级）、
exit 5（提交被钩子拒）、exit 6（metrics 有坏行）。

⚠️ **`.superpowers/sdd/` 整个被 gitignore（内容是 `*`）** ⇒ 留存物必须**单独** `git add -f`。**不删 SDD 工作区。**

### 8.2 开发树、artifact、fixture（**都还在，现测 2026-09-22**）

| 路径 | 是什么 |
|---|---|
| `/tmp/ccloop-codex-0919`（分支 `codex/codex-adapter-0919`） | ccloop 的 Codex 适配开发树，**尚未整合 ccloop 主线** |
| `/tmp/ccloop-codex-0919/dist/cli.js` | 两道控制门要的 `ORCA_CCLOOP_BIN`，**build 时间 Sep 19 21:48** |
| `/tmp/orca-ccloop-d3-task8/fake-codex-config.json` | 两道控制门要的 `ORCA_CCLOOP_ADAPTER_CONFIG` |
| `/Users/biran/.codex/worktrees/control-foundation-0919/Orca`（分支 `codex/control-foundation-0919`） | Orca 控制底座开发树，**尚未整合主线** |

⚠️ 诊断根 `/private/tmp/orca-real-ccloop-MyDo5O` **现测已不存在**（早前文档要求保留它，那句已过期）。
⚠️ **`ORCA_CCLOOP_BIN` 指本机二进制，不是 npm 依赖** —— spec §9.1 拍的「锁版本」至今没有任何机制在做。

### 8.3 子系统 D（水位／检查点）与 Tier 0 闸门

- **水位** ＝ transcript 最近主链消息的 input ＋ cache_read ＋ cache_creation；**T1 330,000／T2 450,000**；
  `.orca/level.json` 登记窗口。`orca level --hook claude-code` 挂 PostToolUse（matcher `*`，10s）。
- `orca checkpoint write` 写 `.orca/checkpoints/<run-id>.json`；`orca resume` **重跑检查点里记录的 shell 命令**。
- *** **子代理调用完全静默，子代理自己的水位不测。** ***
- **Tier 0 闸门已生效**：`.claude/settings.json` 的 PreToolUse `orca gate --hook claude-code`
  ＋ 24 条 `permissions.deny`，拦 push／合并进 main／删分支／删 worktree／`gh` 对外写。
  ⚠️ **已知放行**（spec §7 登记）：写成脚本再执行、`python3 -c`、git alias、`-c core.hooksPath=`、
  `--no-verify`、`ExitWorktree`、`rm -rf` worktree 目录、`git -C <path> push`。
  ⚠️ **已知过度拦**：main 上 `git branch -f`、`merge --abort`、`rebase --continue`。
  ⚠️ **威胁模型是「合作型 agent 的失手」，不是对抗。**

### 8.4 控制协议与**两个缺口**

ccloop `control` v1 的方法集：`capabilities`／`accept`／`inspect`／`handoff`／`collect`／`read-evidence`。
传输是**一次一进程**的 JSON-over-stdio，真实状态全在文件里，所以 Orca 崩溃后可重读恢复。

🔴 **缺口一**：`capabilities` 只答 `protocol`／`durableAccept`／`ownershipIsolation`／`evidenceRetention`／
`usageObservation: "phase-end"`／`budgetEnforcement: "soft"`／`requestBoundEvidence`，
**`CapabilityViewV1` 要的另外五个一个都没有** ⇒ Web 派活必得 `control-capability-unsupported`。
🔴 **缺口二**：`ContextObservationV1` 在 Orca `src/` **无生产者**，缺 ccloop 侧的实时观测 emit，
**Orca 不许自造对端观测**。

⚠️ *** **Codex 只支持 `phase-end` ＋ `soft`。任何地方不许宣称 strict token 封顶。** ***
`orca chain` 的 `--max-budget-usd` 同样是**软上限**（超预算退出 1、`error_max_budget_usd`）。

### 8.5 基线的演进（**每一个都作废前一个；只有最后一行现行**）

`95/561 → 95/566 → 100/606 → 100/608 → 107/663 → 107/664 → 111/810 → 129/1074 →
129/1075 → 172/1516 → 180/1618`。**现行值与三道红门见 §三。**
⚠️ **引用任何基线数前现测。** 历史值只用来判断「一份旧文档有多旧」。

### 8.6 成本量级对照（**只抄工具报数，一个自估都没有**）

| 场景 | 钩子报数 |
|---|---|
| 9 任务 ＋ 21 变异、无外派评审 | $163.54 |
| 15 个任务中的 9 个、每任务独立评审 | $138.24 |
| 单个中等轮次 | $60–75（**存疑，只在一轮里出现过**） |
| 其余各轮 | $87.75 / $98.78 / $117.89 / $123.68 / $124.34 / $277 |
| ccloop：一轮「派评审 → 修复 → 复审」 | 约 $71–128，**大部分花在评审员身上** |

---

## 九、归人的（**agent 做不成，或必须人单独点头**）

- **push 永远归人，控制器不许 push。** *** **本文不记发布状态。** *** 「有没有未推的笔」是一条
  **一秒后就可能变**的现测 —— *** **历轮实测：同一会话内远端被人推动 3–4 次是常态。** ***
  要知道就跑 `/usr/bin/git ls-remote origin refs/heads/main` 与本地比，**三个仓各跑一次**。
- 🔴 *** **本轮发现（2026-09-23）：这台机器上有东西在把提交推到真实的 GitHub 远端，
  而控制器一次 `push` 都没跑过。** *** 三个仓都装着同一个 `.git/hooks/post-commit`
  （`Qoder CN` 的 AI tracker，调一个**混淆过的** Electron 二进制，看不进去）。
  ⚠️ **但时间线不支持「每笔自动推」** —— 一度 ccloop 的 23 笔全在本地，
  远端从早上直接跳到深夜的某一笔，且**停在中间**而不是最新一笔。更像某一刻的**批量推送**。
  ⇒ **控制器没有动任何钩子**（那是人的配置）。**要人自己查 `post-commit`／`post-checkout` 并决定。**
  ⇒ ⚠️ **不论是谁推的：那些提交现在是【已发布文本】，后续更正只能追加具名 ERRATUM。**
- **`orca chain` 的真钱活体验收** —— 要人提交 `.orca/chain.json` 选 model 并点头
  （Orca 内尚不存在该文件 ⇒ 开链被 `chain-config-missing` 拒绝）。**先测 F，副本 T1 > F。**
- **「第二个 panel 不挂控制面」** —— 是**控制器自己做的决定，不是人裁**，可逆，要不要维持仍未决。
- **`targetVersion` 定成非空字符串还是安全整数** —— G1 已裁「由 ccloop 拍」，**拍成什么仍未裁**。
- **裁决甲的 `plan` 那一半** —— 改 `preflightUnreadableRepo` 的判据需人**指名到具体测试**，至今未授权。
- **子系统 B 的后续** —— 人裁「暂缓到 `~/.orca` 存在且有 `not_my_taste` 行」。
  ⚠️ `~/.orca` **存在**（空的 `control/`，0700）但**没有 `not_my_taste` 行** ⇒ 条件仍不满足。
- **Co-Authored-By 写错模型的四笔** —— 未 amend（**不许 amend，由人决定**）。
  ⚠️ **本轮的新情况**：各实施席用了**自己模型**的归属行（多为 Sonnet），这是控制器裁定的 ——
  那些提交的作者确实是它们，写成 Opus 才是假话。**归属行因此不统一，人若不接受要自己决定怎么办。**
- **一把 API key 曾明文进入 transcript**（2026-09-17 那一轮）⇒ **建议轮换，只有人能确认做没做。**
- ccloop 自己的：**人裁 85 与 I-3 已于 2026-09-23 完成**（人裁 129–138）。
  仍挂着的是 **G1**、**`stopProof` 那条稳定红**（根因未查，要人先开口；
  **判别过程**：`git clone --local` 副本单跑 **3/3 红**、主树单跑也红、单跑耗时 **5.37s** ——
  远低于 flake 画像的 25–29s ⇒ **与负载无关**）、**Linux 覆盖**
  （要人自己起 OrbStack daemon），以及本轮登记未修的 **M3／M4**（都要改既有判据，需人按人裁 88 指名）。


## 十、Suggested skills

| skill | 什么时候用 |
|---|---|
| `superpowers:verification-before-completion` | *** **每次要说「做完了／通过了／绿了」之前。** *** 与 Rule 12 同形 |
| `superpowers:brainstorming` | 开任何新子系统／新能力之前。⚠️ architectural 路径的终点只能接 `writing-plans` |
| `superpowers:writing-plans` | 出完 spec 之后。⚠️ **自查三项必跑**，但它**看不见计划正文里的 shell**（§六.4） |
| `superpowers:subagent-driven-development` | 执行计划时。**值这个钱，但它是主要开销**（约 40 席） |
| `superpowers:test-driven-development` | 补新判据时。⚠️ 本仓库的「先红」多数要靠变异证明 |
| `superpowers:requesting-code-review` | 派评审前**先报预估**；brief 里写满已知 flake、写明「整份读回」并在收货时查它怎么读的 |
| `superpowers:receiving-code-review` | ⚠️ **评审员的承重主张必须自己复核**，不许照单全收，也不许照抄它的数字 |
| `superpowers:systematic-debugging` | 出现红／行为不符时**先用它**，别直接改代码 |

⚠️ **skill 与 `CLAUDE.md` 冲突时，`CLAUDE.md` 优先**（Rule 11：conformance > taste）。

---

## 十一、被删掉了什么、怎么取回

**2026-09-22 的压缩**（会话 `da2f5e9a`）把 **33 个 `📌 本轮` 节压成了上面的 §五–§八**。
删掉的是**过程日志**：开工核对表、提交清单、逐条变异表、实测数快照、「本轮没做的」、「成本」、
「姊妹仓库」、以及**已被后节取代的「⛔ 下一件事」**。

*** **取回任何一轮的原文：** ***

```bash
git log --follow -p -- docs/handoff/handoff.md     # 全部历史
git log --oneline -- docs/handoff/handoff.md       # 先挑那一笔
git show <那一笔>:docs/handoff/handoff.md          # 整份取回
```

**结论去哪了 —— 按来源分**：

| 原来的东西 | 现在在 |
|---|---|
| 各轮「🔴 值得带走的」「全绿但是坏的」 | §六.1、§六.2 |
| 各轮「三条工具骗法」「踩过的坑」 | §七 |
| 各轮「人本轮拍的」 | §五.1／§五.2／§五.3 |
| 各轮「实测数」 | §八.5（历史）、§三（现行） |
| 各轮「成本」 | §八.6 |
| 各轮「没做／挂账」 | §九 |
| 各轮「⛔ 下一件事」 | §四（**只有最后一轮的活着**） |
| 各轮「姊妹仓库」 | 已在 ccloop／ccmem 各自的「Orca 那条线」里滚动 |
| 提交清单、变异逐条表、开工核对表 | **只在 git 历史里** —— 它们的**方法论**已抽进 §六 |

⚠️ *** **压缩只动了本文。** *** `.superpowers/sdd/**`、`docs/superpowers/specs/**`、
`docs/superpowers/plans/**` 一个字节都没动 —— **那些才是证据链，本文只是索引。**

⚠️ **本次压缩由四个抽取员分段通读原文后汇总，控制器逐条筛选。**
**如果你发现某条结论在这里找不到、而你记得它存在 —— 先用上面的命令去 git 历史里找，再补回来。**
**补回来不需要授权；那正是本文允许就地改的用途。**
