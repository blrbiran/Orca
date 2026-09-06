# 外派评审报告 —— `2026-09-06-corrections-store-and-writer-design.md`

**评审席位**：1 席（general-purpose subagent，Opus）
**评审范围**：`60d29c8..193c5fc`（两笔：spec 落盘 ＋ 第二轮自审的修复）
**派出方**：run `orca-dev-19c594d2`，2026-09-06
**评审员自陈用量**：133,275 token，20 次工具调用，耗时 475,609 ms（**工具报数，未自估**）

⚠️ **本文是评审员的原文归档，逐字保留。** 控制器对它的复核结论、以及哪些被接受／被驳回，
记在文末「控制器复核」一节与 `docs/handoff/handoff.md` 本轮那一节，**不在此就地改动原文**。

⚠️ `.superpowers/sdd/.gitignore` 内容是 `*` ⇒ **本文件是 `git add -f` 进来的**。

---

## 评审员给的 brief 要点（控制器写的，供复现）

- 明确这是**尚未实施的设计**，不是代码；重点是「哪些错在第一条 `overturned` 落盘之后就永远修不掉」
- 把 spec 的 §12／§13 两节共十条**划为已知**，要求它判「这些修法本身对不对、有没有换来新问题」，而不是原样退回
- 点明它是来补盲点的：两轮自审出自写文档的同一个上下文 ⇒ **要求它攻击框架**
  （存储选型、派生而不是问人、「那个残留是合法的」、「台账侧不需要锁」）
- 只读；不许再派子 agent；不许跑测试

---

## 原文

### Strengths

- **§1.1 / §7.1 是真东西。** 抓到「run id 不含 `by` ⇒ 两个人写同一个 `.decisions/<run>.jsonl`，
  直接推翻 A′ §3.1」是一次真正的不变式挽救，而且「简化假设的代价不是它省掉的机制，是它悄悄改掉的不变式」
  这句写法正确且可复用。
- **§6.1 正确且不显然。** 从存储行派生 fix run id 让 `--close` 落进**同一个**文件，
  于是 `appendEvent` 的 Check B（`writer.ts:79-95`）把重试变成一次响亮的 duplicate 而不是第二条静默孤儿。
  已核 Check B：它只管 decision，且确实抛。推理成立。
- **§2.6 是对着代码核过的，不是假设的。** `validateFile.ts:112-119` 确实把 `overturned.replacedBy`
  限定在 `fileDecisionIds`，`writer.ts:145` 确实重验 `existingText + payload`。
- **§7.3 拒绝与 `repoLock.ts` 合并，论证扎实。** 那张三行表是真实的语义差异，
  `repoLock.ts:41-43` 佐证了被对照的那个 "deliberately out of scope" 立场。
- **§4.1「为什么不干脆把 `at` 拿掉」的直觉是对的**：fail loud ＋ 显式覆盖，好过结构上禁掉一件未必错的事。
- **§10 的第二条验收** —— 在**一次性仓库**里跑真闭环、绝不在本仓库的 `.decisions/` 里 —— 是对不可逆性的正确处理，
  而且是一条带退出码的命令。

### Critical（实施前必修）

**C1 — §6.1：`--close` 只对第 3 步幂等。对一条【已经闭环成功】的 correction 再跑一次，会永久追加第二条 `overturned`。**

§6.1 原话是「先检查那条新 decision 在不在文件里，在就跳过步 3、直接补步 4」。
字面执行：已完成的 correction ⇒ decision 在 ⇒ 跳过步 3 ⇒ **再执行一次步 4**。逐个查过能拦它的闸门：

- `writer.ts:79` —— Check B 被 `if (evName === "decision")` 守着，**完全不看引用类事件**；
- `validateFile.ts:103-119` —— 检查 5 只要求 `id` 与 `replacedBy` 能解析，重复的那条两个都能解析；
- `validateLine.ts:75-105` —— 只做 schema，第二条一模一样的 `overturned` 解析得过。

于是两条逐字节相同的 `overturned` 落进只追加文件，**永远删不掉**。
A′ §4.4 的修复率分子按 `overturned.correctionId` join；上游 §9 第 8 项已经允许同一个 `id` 有多条 `overturned`，
所以**没有任何校验器会标记它**。这与 §13 发现 1 判为 Critical 的是**同一个缺陷类**
（一次重复调用静默污染修复率）—— 在可修的 DB 侧抓到了，在不可修的台账侧漏了。
而 `--close` 正是对外宣传的重试路径，跑两次是**预期交互，不是边角情况**。

*修法*：`--close` 在 `<run>.jsonl` 里已存在带该 `correctionId` 的 `overturned` 时，**空操作并 exit 0**。
配判据，变异为「删掉那个 overturned 存在性检查」，期望：出现重复行 ⇒ 红。

**C2 — §8：没有任何一条判据覆盖 §5 的派生表。十一个字段，零条变异，其中一个永远无法被任何校验器检验。**

§8 的十五条覆盖了 projectKey 规范化、模式分档、顺序、幂等、锁、换行、查重、预检、`undo.how`。
**没有一条触及被写出去那一行的内容。** 具体说：一个把 `chose` 与 `alternatives[0].option` 对调的派生 ——
也就是**把人的选择记反** —— 能通过 E1–E12 全部、通过 `decisionEventSchema`（两者都是 `min(1)` 字符串）、
通过检查 5，然后永久落盘。

最糟的是 `correctionId`。上游 §3 明写它「只判非空字符串 —— 跨库，存在性判不了」。
**它是唯一没有任何机器能校验的字段**，是 A′ §4.4 整个指标赖以 join 的键，
而 §8 没有一条判据断言写出去的值等于那条 correction 行的真实 id。
一个把 `decisionId` 写进那个位置的变异会**处处绿**。

注意这是一次回退：上游 spec 是逐字段钉的（M1×6、M9×7）。
本 spec **恰好在字段从假设变成落盘的那一刻放弃了这个做法。**

*修法*：对 §5 那张表加逐字段判据（`question` 逐字；`chose` ← `chose_instead`；
`alternatives[0].option` ← 原 `chose`；`correctionId` ← 存储行的 id；`replacedBy` ← 派生出的 decision id；
继承的 `scope`/`kind`/`cost`/`blast_radius`），每条配一个改**该字段来源**的变异。

**C3 — §7：「台账侧不需要锁」只考虑了 `correct` 对 `correct`。`orca correct` 会写目标仓库的工作树，却不取 `orca run` 依赖的任何锁，而且从不提交。**

§6 四个步骤里没有一步是提交。`orca run` 通过 `commitLedgerOnW`（`land.ts:170-173`）提交它的台账。
因此 `orca correct` 会在目标仓库工作树里留下**未跟踪的** `.decisions/orca-fix-<hash8>.jsonl`。
两个可复现的具体后果：

1. `preflight.ts` 的 S22 用 `git status --porcelain` 判净，`porcelain.output.length > 0` 即拒
   （`preflight.ts:212-219`）。未跟踪文件会出现在 porcelain 里。
   ⇒ **只要在某个仓库上跑过 `orca correct`，下一次 `orca run` 就会被 `DIRTY_WORKTREE` 挡住**，
   直到人手工提交那个文件 —— 而设计里从没告诉他这件事。
2. 若此时正有一轮在飞，`commitLedgerOnW` 会跑 `git add -- .decisions`（`land.ts:171`），
   把人的 correction 扫进 C 在分支 W 上的记账提交。
   **那一行正上方的注释解释了为什么按路径暂存而不是 `add -A`：就是为了防止杂物被扫进记账提交** ——
   这个新写入方把杂物放进了被暂存的那条路径里，正好击穿那条理由。

`run.ts:643-652` 在任何读写目标状态之前取 `acquireRepoLock`，注释写着
「此后的一切 —— 包括那道清洁度 preflight —— 只在没有第二个 orca 能在底下移动 W 时才有意义」。
**`orca correct` 就是那个在移动目标工作树的第二个 orca**，而 §7 用一个只覆盖
「两次 `correct` 之间文件级写冲突」的论证（run-id 分离）给了它豁免。**框架太窄。**

*修法*：定下来并写清楚 (a) `orca correct` 取不取 repo 锁（**应该取，它写目标工作树**），
(b) 谁在哪个分支上提交那个 fix 文件。**登记成 non-goal 这条路不可用**：S22 会把它变成对下一轮的硬阻断。

**C4 — §3：`--close` 无法提供 `chose_instead`，于是「补闭环」对最需要它的那些 correction 恰恰做不到。这是 §13-4 的修法造出来的。**

§3 同时声明了三件不能同时成立的事：
- `--close` 是用来「给已存在的 correction 补闭环」的；
- `--close` 与 `--chose-instead` 互斥（「给了 `--close` 又给它们 ⇒ 当场拒」）；
- 「闭环必须有 `chose_instead`，不管 `kind` 是什么…… `wrong` / `stale` 想闭环也得给一个」。

`correctionSchema`（`src/corrections/schema.ts`）让 `chose_instead` 除 `not_my_taste` 外可选。
所以任何以「只记」模式记下的 `wrong` 或 `stale` correction，行里都没有 `chose_instead`，
而 `--close` 又禁掉了唯一的提供渠道。§5 从它派生 `chose`，`decisionEventSchema.chose` 是 `z.string().min(1)`。
命令会深埋在 schema 校验里失败，报 `chose: String must contain at least 1 character(s)` ——
**正是 §12 发现 2 为 `--by` 修掉的那个「消息离原因太远」的缺陷，被 §13 发现 4 重新引入。**

*修法*：当且仅当存储行里没有 `chose_instead` 时，允许 `--chose-instead` 与 `--close` 同时出现；
行里已有则仍然拒绝，并说明理由。为「存储行没有 `chose_instead` 且没有提供 ⇒ 在任何写入之前具名拒绝」加一条判据。

**C5 — §5：回填 `at` 与上游 §3 对该字段的定义冲突，而且是在唯一一类永远无法修订的事件上。**

上游 §3 的字段表把 `overturned.at` 定义为「落笔时刻」——写下的那一刻——「与 `decision.at` 同口径」。
§5 把派生出的 `decision.at` 与 `overturned.at` 都设成 **correction 的** `at`，
走 `--close` 时那是一个过去的时间戳，并宣称这是有意的。两个问题：

1. 这是一份下游文档**在一个只追加字段上悄悄推翻上游裁决**。§0 说「形状本身本文一个字都不改」——
   形状没变，但一个字段的**含义**变了，而那正是无法迁移的那一半。
2. 它什么也没买到。correction 的 `at` 本来就能通过 `correctionId` join 到 —— 那正是这个 join 的意义。
   被毁掉的是**台账行究竟何时被写下**这个唯一记录，而且经由 `--close` 写入的行
   与直接写入的行**再也无法区分**。A′ §3.1 的归属（「`run` ＋ `at` 给 who/when」）
   对一个无标记的子集**永久失真**。

*修法*：两个 `at` 都写真实的写入时刻，人的时间戳由 correction 行承载。
若确实想要回填，**那需要一条上游裁决，而不是 §5 的一个脚注**。

### Important（实施前应修）

**I1 — §4：语义查重的键漏了 `projectKey`，而这个存储的全部理由就是跨项目。**

查重是「同 `decisionId` ＋ 同 `by`」。decision id 不带仓库标识 —— 那是上游 §2.3 的实测发现，
也是 `projectKey` 存在的理由。更糟的是它们是**派生的**：`run.ts:686` 是
`deriveRunId("round", round.planBytes, base)`，所以同一份 plan 在同一个 base 上得到同一个 round id，
于是同样的 `<run>/<n>` decision id 会出现在任何 clone 或 fork 里。
一个人在两个仓库里纠正同一个 decision id 会得到一次假的「已经纠正过」，被推去用 `--again`，
**而那会把整道守卫关掉**。键应为 `(projectKey, decisionId, by)`。

**I2 — §4／§7.2：查重的读与追加必须明写在同一次持锁内。**

§7.2 说锁覆盖「一次追加」。若查重扫描发生在取锁之前，两个进程会都读到「没有已存在的 correction」、
依次取锁、各自追加 —— **§13-1 的修法恰好在裁决 6 引入锁所针对的多用户场景下失效**。
E10a 按现在的写法（「再记一条 ⇒ 拒」）在单进程下会过，永远看不见这个。
应明写 取锁 → 读 → 判 → 追加 → 释放 是一个临界区，并把 E10a 的变异改成「把判断移到锁外」，或加一条并发变体。

**I3 — §7.2：逐字照抄 `repoLock.ts` 会复现提交 `087c7da` 刚刚偿清的那个原始 ENOENT 缺陷。**

`repoLock.ts:31` 是非递归 `mkdir`，而它的父目录（`<repo>/.git`）保证存在。
`${ORCA_CORRECTIONS_DIR}/.corrections-lock` 的父目录不保证：新机器上 `~/.orca` 不存在，
于是**第一次跑 `orca correct` 就会得到 `ENOENT: no such file or directory, mkdir '/Users/x/.orca/.corrections-lock'`**
—— 一个用户从没问过的内部路径，**正是 087c7da 的提交信息里描述为 `orca run` 修掉的那个形状**，
也正是上游 §7 第 3 项登记的那个。§7.2 的「机制照抄」必须先对父目录做一次
`mkdir(dir, { recursive: true })`（且仅此一处；锁目录本身保持非递归，那是承重的部分）。

**I4 — §6 步 1′：码对了，函数错了。** `unlockableTargetRejection`（`preflight.ts:121-137`）发出的消息是
「……没地方放**它取的那把 repo 锁**（`<target>/.git`）」。`orca correct` 不取 repo 锁（依 §7.1），
所以那条消息描述的是这个命令没有的机制。它还只在 `<repo>/.git` 是**目录**时才返回 `undefined`，
于是会拒绝 linked worktree —— 对 `correct` 无关紧要，它真正的要求是一个能解析的 `remote.origin.url`。
应复用**码** `TARGET_NOT_A_GIT_REPO`（§13-3 对的是这一半），配一条讲 `projectKey` 而不是讲锁的消息。

**I5 — §8 的 E4 按现在的写法结构上不可能变红。** 「写入顺序：correction 先落盘，台账后写；
变异：调换步 2 与步 3/4 ⇒ 红」。**在成功路径上两种顺序产生逐字节相同的终态**，没有任何东西能观测到差别。
E4 只有在让台账写入失败（故障注入）时才成立为一条判据。应明说 ——
并注意调换顺序后的残留是一条 `correctionId` 指向空的 `overturned`，
而 §9 第 7 项把它登记为「不防」，**于是这条判据守的是一个 non-goal 表说敞着的洞**。

**I6 — §8 的 E6（「本刀最承重的一条」）除非夹具把 `at` 钉死，否则是绿的。**
run id 从整条 correction 行派生，而行里含精确到毫秒的 `at`。两个人纠正同一条 decision，
无论 `by` 如何 `at` 都会不同，所以变异「从派生里去掉 `by`」**仍然得到两个不同的 run id、两个不同的文件**。
这条判据只有在两条夹具 correction 带**逐字节相同的 `at`** 时才会红。两个后果：
(a) 判据必须写明这个约束，否则它不可证伪；
(b) §7.1 那条不变式**实际上是 `at` 在扛，不是 `by`** —— spec 把理由归给了错的字段，
而这要紧，因为下一轮会建立在那个句子上，不是建立在哈希上。

**I7 — §6 把步 3 的残留称作「合法」是低估了。** 一条没有 `overturned` 的 correction 在**形状上**合法，是的。
但它与真正的「人纠正了、没人修」**无法区分**，于是每一次失败的闭环尝试都在**静默地把 A′ §4.4 的修复率往下压**。
那正是本 spec 在 §13 发现 1 里判为 **Critical** 的同一种指标污染。
要么在 §9 里登记为「已接受」并点名这个后果，要么记录失败的尝试使两者可区分。

**I8 — §9 第 7 项是承重的，不是免费的 non-goal。** §6.1 的幂等续做**从存储里那条 correction 行**派生 fix run id。
那个存储是可重写的、用户全局的、无闸门的那一半。若那一行被编辑、轮转或丢失，
同一条 `--close` 会派生出不同的 run id、落进不同的文件，**而步 4 失败留下的那条孤儿 decision 就永久不可续** ——
正是 §12 发现 1 修掉的那个失败，从另一扇门到达。
§9 第 7 项把「台账只追加而 corrections 可重写」登记为一个已接受的不一致**方向**，
却没注意到**不可逆那一侧唯一的修复路径要穿过可变的那一侧**。

**I9 — §6：那条孤儿 decision 不只是「难看」。** 它是一条成形的 `decision` 行，
断言 `chose = <人的替代方案>`、`evidence: ["overturns <原 id>"]` —— **一个「原条已被推翻」的主张，
而台账里没有任何东西为它背书**。它计入 decision 总数，会被子系统 B 读到，
若重试始终没发生，它就是一条**永久的假陈述**。「难看但可续」只在 I8 成立的条件下为真。

### Minor

**M1 — E11 的点名变异靠崩溃取胜。** 「删掉预检 ⇒ 红（消息变成检查 5 的措辞）」。
没有原 decision，就无从派生 `question`、`scope`、`kind` 或继承的 `undo.cost`，
所以命令会在到达 `appendEvent` 之前抛出 —— exit 3，而不是检查 5 的措辞。
§8 自己的纪律里写着「靠崩溃变红不算证据」。应把变异改述为
「把具名拒绝换成放行，让 `appendEvent` 去拒」，并断言消息。

**M2 — E3 必须钉理由，不是钉退出码。** 去掉那个必填要求之后，只给 `--undo-how` 仍然会失败
（`chose` 为空 ⇒ schema 拒）。变异前后都非零退出，**只有对拒绝消息的断言能区分它们**。
这就是上游 §6.2「绿在错误的原因上」的原样重演。

**M3 — §2.2／§3 的「既有三档」不准确，而且混同了两种不同的失败。**
`cli.ts` 的 `runValidate` 对 downgraded 返回 **2**，pre-commit 钩子就吃这个码
（`npx tsx src/cli.ts validate .decisions || [ $? -eq 2 ]`）。**在用的是四个码。**
另外，§7.3 的 `corrections-store-busy` 是一个**瞬态**条件，却与「你的输入不对」共用 exit 1，
于是没有任何包装脚本能区分「一秒后重试」和「永远不可能成功」。

**M4 — §2.4 的计数在它标注的锚点上重现不出来。**
在 `60d29c8` 实测（`git ls-tree -r --name-only 60d29c8 -- .decisions`，每个 blob 过一遍按 `ev` 的计数器）：
**108 `decision` ＋ 7 `bound`**，不是 103 ＋ 7。差额恰好是 `orca-dev-19c594d2.jsonl` 里的 5 条，
即**本轮自己那个文件** —— 这个数是在本轮早些时候量的，却贴了一个更晚的 commit。
承重的那条主张（`overturned` ＝ 0、`superseded` ＝ 0）确实重现得出来。
按 Rule 14，应更正锚点，而不是留下一个在它所标注的 commit 上重现不出来的值。

**M5 — §7.1 复用 `deriveRunId` 在语义上是「标签外用法」，而且丢掉了碰撞处理。**
参数名叫 `contractBytes` 与 `baseCommit`，文档注释（`runId.ts:19-32`）也是按那个口径解释哈希的；
传一条 correction 行和一个 correction id 无害，但会让该函数自己的文档对这一个调用方**变成假的**。
更实质的是，`orca correct` 绕过了 `allocateRunId`，所以 `EEXIST → -2, -3` 的递进不适用；
两条不同的 correction 在 8 位十六进制（32 位）上碰撞，会把两条 `<run>/1` decision 放进同一个文件。
Check B 会响亮地抓住它，这没问题 —— **但 spec 应该写明那就是预期的处置方式。**

**M6 — 用户全局存储没有说明权限。** `because` 与 `chose_instead` 承载着关于（可能是私有的）仓库的人类推理，
被写进 `~/.orca/corrections.jsonl`。§9 第 6 项登记了 `CLAUDE.md` 没有关于用户全局写入的规则；
**文件与目录的 mode 是一个值得现在就做的一行决定**，而不是从 umask 继承。

### 对两节自审的判决

**§12（第一轮）**

| # | 判决 |
|---|---|
| 1（Critical，run id 从存储行派生） | **方向对，不完整。** 它修了步 3 的幂等，仅此而已 —— 步 4 没有等价守卫（C1）—— 而且它让可变存储的耐久性成为唯一修复路径的前提，而 §9 第 7 项把那一点登记为不设防（I8）。 |
| 2（`--by` 快速失败） | 正确且完整。 |
| 3（`--close` 需要 `--repo` 与 `--undo-how`） | **不完整。** 它列了 `--close` 需要的三样里的两样，漏了 `chose_instead`，而 §13-4 的互斥规则随后把它变得拿不到（C4）。 |
| 4（复用 `deriveRunId`） | 正确；Minor 的定级合适。残留见 M5。 |
| 5（`<--repo>/.decisions/`） | 正确且完整。 |

**§13（第二轮）**

| # | 判决 |
|---|---|
| 1（Critical，语义查重 ＋ `--again`） | **DB 侧对，而且这正是本该被推广的那条发现。** 同一个「重复调用」缺陷在只追加侧同样存在，而没有人去找它（C1）。修法本身有两个缺口：键漏了 `projectKey`（I1），判-读-写没有写成原子（I2）。 |
| 2（把不变式收窄成「没有两个**不同的** `by`」） | **诚实且正确，「被兜住的东西不能拿来当前提」是全文最好的一句。** 但作用域仍不完整：它从「两个写入方」收窄到「两个 `by`」，却始终没有走出 `correct` 对 `correct` 的框架 —— 而 C3 就住在那外面。 |
| 3（复用 `target-not-a-git-repo`） | **结论对，工具错。** 复用码是对的；复用 `unlockableTargetRejection` 会引入一条讲 repo 锁的消息，而这个命令不取那把锁（I4）。 |
| 4（`--close` 互斥 ＋ 回填 `at`） | **定级错了，而且修法比缺陷更坏。** 定为 Minor；互斥造出了 C4（一条被堵死的路，消息离原因很远），`at` 的裁定造出了 C5（与上游字段定义的永久冲突）。「读到这里觉得像 bug 的人，看的是这一句」**先发制人地压住了反对意见，却没有与上游 §3 对账。** |
| 5（`os.homedir()`） | 正确且完整。 |

两轮都停在文档自己的框架里。三个 brief 点名的框架，一个都没被质疑：
台账侧是否需要锁（**需要 —— C3**）、那个「合法」的残留是否真的合法（I7）、
以及判据是否覆盖了真正会变成永久的那个东西（**没有 —— C2**）。

### Assessment

**Ready to implement?** **No.**

**Reasoning:** 五条 Critical 里的两条（C1 重复 `--close` 追加重复 `overturned`；
C2 没有任何判据覆盖那十一个派生字段，包括那个永远无法被校验的字段）
让**第一次成功运行就有能力写下一条永久错误的行，而代码库里没有任何东西会注意到**；
C3 表明「台账侧不需要锁」这个框架从未考虑 `orca correct` 跑在一个 `orca run` 正在使用的仓库上。
C4 另外意味着 `--close` 这条路对大多数 correction 类型按现在的规格根本走不完。

---

## 控制器复核（**2026-09-06，run `orca-dev-19c594d2`；本节是控制器写的，不是评审员的话**）

按本仓库既定纪律，**评审员的承重主张必须自己复核**。逐条现测结果：

| 主张 | 复核方式 | 结论 |
|---|---|---|
| C3：`land.ts` 会 `git add -- .decisions` | 现测 `grep -n "add" src/scheduler/land.ts` ⇒ **171 行确实是 `["add", "--", ".decisions"]`**，且 166–167 行注释写明「按路径暂存而不是 `add -A`，就是为了防止任务留下的杂物被扫进记账提交」 | **成立**，且比评审员说的更讽刺：新写入方把杂物放进了那条被暂存的路径 |
| M4：§2.4 的计数在 `60d29c8` 上重现不出来 | 现测：`git ls-tree -r --name-only 60d29c8 -- .decisions` 得 9 个文件，逐 blob 按 `ev` 计数 ⇒ **`{"decision":108,"bound":7}`** | **成立。103 是本轮早些时候（提交自己那 5 条台账之前）量的，却贴了之后的锚点 —— 这是控制器自己的 Rule 14 违规** |
| C1：Check B 只管 decision | 本会话早些时候已读过 `writer.ts:79` 的 `if (evName === "decision")` | **成立** |
| M3：`runValidate` 返回 2 | 本会话早些时候实测 `npm run ledger -- validate .decisions` **exit 2**，且 `package.json` 的 `verify` 里有 `|| [ $? -eq 2 ]` | **成立** |
| I3：`~/.orca` 不存在 ⇒ 非递归 mkdir 报 ENOENT | 已读 `repoLock.ts:31` 为 `await mkdir(lockDir)`（非递归） | **成立** |

**五条 Critical 控制器全部接受，无一条驳回。**

**唯一部分驳回的是 I6(b)**：评审员说「§7.1 那条不变式实际上是 `at` 在扛，不是 `by`」。
*** **一半对。** *** `at` 精确到毫秒确实让两个人天然落进不同文件 —— **但那是靠竞态侥幸，不是不变式**；
`by` 才是有原则的分隔。I6(a)（判据不钉死夹具的 `at` 就永远红不了）**完全成立**，
而且恰恰因为如此，判据必须钉死 `at` **才能观测到 `by` 这个真正的机制**。
⇒ 处置：**(a) 全收；(b) 改写措辞，不接受「不变式由 `at` 承载」这个说法。**

**评审员没有攻到的**（诚实登记，不算它的失职 —— brief 让它攻三个框架，它攻下了一个）：
*** **JSONL vs SQLite 的存储选型、以及「机械派生而不是问人」这两个决定，至今没有被任何独立视角检验过。** ***
**不要把「评审员没提」读成「它们被检验通过了」。**
