# 第二席外派评审报告 —— `2026-09-06-corrections-store-and-writer-design.md` 的 §14

**评审席位**：1 席（general-purpose subagent，Opus）
**评审范围**：`cd614a2..7c15bdc`（两笔：§14 落盘 ＋ 本轮台账）
**派出方**：run `orca-dev-d5eb8fa6`，2026-09-06
**评审员自陈用量**：**164,453 token，25 次工具调用，786,099 ms**（工具报数）
**结论**：`Ready to implement? No` —— **4 Critical ／ 11 Important ／ 6 Minor**

⚠️ **本文是评审员的原文归档，逐字保留。** 控制器的复核结论与处置记在文末「控制器复核」一节
与 spec 的 §14.20／§14.22／§14.23，**不在此就地改动原文**。

⚠️ `.superpowers/sdd/.gitignore` 内容是 `*` ⇒ **本文件是 `git add -f` 进来的**。

⚠️ **它审的不是原始设计，是【第一席那 20 条发现的处置】本身。** brief 点名要它做的正是这件事，
外加攻两个从没被独立视角检验过的框架（JSONL vs SQLite、机械派生 vs 问人）。

---

## 原文

### Strengths

- **§14.1 的中心动作是对的，而且验证得住。** 我对着 `src/ledger/writer.ts` 逐行核过它的批量契约：`validateFile` 的 `fileDecisionIds` 是从**整份预期文本**重建的（`validateFile.ts:55-65`），所以批内 `overturned.replacedBy` 指向批内 decision 确实解得开（`validateFile.ts:112-118` 要求它落在 `fileDecisionIds`）；`overturned.id` 指向别的文件里那条原 decision，由 `writer.ts:124-143` 扫兄弟文件建出的 `externalDecisionIds` 解开（`validateFile.ts:67-68`）。**「检查 5 自然解得开」这句成立，不是假设。**
- **C1 交给 Check B 这条也成立。** `writer.ts:79-95` 的 Check B 只守 `evName === "decision"`，而批里恰好有一条 decision，且它抛在 `appendFile`（`writer.ts:154`）**之前**。第二次 `--close` 撞的是 `refusing to append: duplicate decision id`。
- **「这不是原子写入」那段诚实登记**（§14.1）是全节最有价值的一句：它拒绝把一个结构性收益说成一个它买不到的保证。
- **`appendEvent` 变单元素包装这个重构，实测是安全的。** 现测 `tests/ledger/writer.test.ts` 的断言全是宽正则（`/rejected/`、`/downgraded/`、`/duplicate/`、`/run/`、`/taskId/`，唯一一条精确串是 `:338` 的 `/does not match the ledger file/`），逐字节复现那条（`:185`）在单元素批下产生**完全相同的 payload**（separator 只在最前加一次 ⇒ 与今天的 `writer.ts:110-111` 逐字节一致）。§14.1 担心的「既有判据变红」在现测下不会发生。
- **§14.21 发现 1 是这一轮最贵的一条**：控制器在自己的草稿里抓到了第四种坏判据形状，并把它拆成 E5a／E5b。这正是这个席位该做的事。
- **§14.9 抽出的记法**（「一条评审发现可以被随后的人裁变废，处置时必须逐条对着人裁重过一遍」）是真的可复用。
- **§14.5（C5）判得对且 E16 构造得好** —— 「夹具让 correction 的 `at` 是过去 ＋ 断言落盘 `at` 落在两次时钟读数之间且不等于它」是一条真能红、且红在正确断言上的判据。
- **§14.14 拒绝复用 exit 2 是现测支撑的**：`package.json` 的 `verify` 确实含 `(npm run ledger -- validate .decisions || [ $? -eq 2 ])`。

### Critical（实施前必修）

**C-A —— 【§14 引入的修法】§14.3 步 5 的 `git commit` 会把人已经暂存的一切一起提交进 orca 的记账提交。**

*在哪*：§14.3 步骤表步 5：`git add -- .decisions/<新 run id>.jsonl`，再 `git <ORCA_IDENTITY> commit -m …`。

`git commit -m` 提交的是**整个索引**，不是刚 `add` 的那条路径。而 `orca correct` 的步 2 预检里**没有任何清洁度／索引检查** —— §14.3 明写它只检查 `.git` 是目录、`remote.origin.url` 能解析、非 detached、非 merge/rebase。

*具体场景*：人执行 `git add -A` 暂存了一整轮重构，尚未提交；随后想起要纠正一条决策，跑 `orca correct --repo . --close c_xxx --undo-how "…"`。步 5 把**那整轮重构**连同 `.decisions/<run>.jsonl` 一起提进一笔作者是 `user.name=orca` 的提交，提交信息说的是记账。人的工作被冒名提交，且 `git blame` 归到 orca。

这正是 §14.3 引用 `land.ts:166-167` 那条注释想防的形状 —— 但 `land.ts` 有 S22 兜底（`orca run` 在 `preflight.ts:205-219` 先判 `git status --porcelain` 为空），**`orca correct` 把这条前提丢了却继承了 `add -- <path>` 的写法**。按路径暂存只在索引本来是空的时候才等于按路径提交。

*修法*：用**路径提交**绕开索引 —— `git <ORCA_IDENTITY> commit -m … -- .decisions/<run>.jsonl`（`git commit <pathspec>` 不动索引也不提交索引里别的东西），或在步 2 加一条守卫：`git diff --cached --name-only` 非空 ⇒ 具名拒绝。判据要断言「索引里预先有别的暂存文件时，HEAD 那一笔仍只含 `.decisions/<run>.jsonl`」——**E14 现在的夹具（干净仓库）永远走不到这个门**。

**C-B —— 【§14 引入的修法】repo 锁没有规定 `finally` 释放，而 `orca correct` 的每一条预期拒绝路径都在取锁之后；`repoLock.ts` 按设计不做 stale 回收 ⇒ 一次失败就能把目标仓库对所有 `orca run` 永久锁死。**

*在哪*：§14.3 步骤表（步 1 取锁、步 6 释放）＋ §14.18 的 E8b。

现测 `repoLock.ts:39-43` 的注释明写 stale 回收 **"deliberately out of scope"**；`run.ts:1179-1180` 把 `lock.release()` 放在 `finally` 里，正是因为知道这一点。§14.3 的表把释放写成**步 6** —— 一条 happy-path 的末步 —— 而它前面躺着的全是**预期会发生**的拒绝：步 2 的四种预检拒绝、步 3 的语义查重拒绝（要人加 `--again`）、步 4 的 Check B 拒绝、步 5 的钩子拒绝（§14.19 第 10 项自己登记了它会发生）。

*具体场景*：人跑 `orca correct`，语义查重拒了他（「你已经纠正过这条」）。若实现照表写成顺序六步，进程带着 `<repo>/.git/orca-lock` 退出。此后该仓库上**每一次 `orca run` 都得到 exit 1 `another orca process already holds the repo lock`**，直到有人手工 `rm -rf .git/orca-lock` —— 而 orca 从不告诉他这条出路，`repoLock.ts` 也拒绝猜。

⚠️ §7.3 那张对照表里，控制器**自己写过**这句：「stale 回收若也不做，一次崩溃就把所有人的 corrections 永久锁死」。它把这条道理用在了 store 锁上，却在把 repo 锁交给一条**预期会失败的命令**时没有回头套用。

*修法*：步骤表明写「取锁之后的一切在 `try/finally` 内，`finally` 里 `release()`」，并加一条判据：**让步 3 的查重拒绝触发，断言 `<repo>/.git/orca-lock` 不存在**；变异「把 release 移出 finally」⇒ 红。E8b 现在只钉「拿不到锁时不写字节」，**没有任何一条判据能因为锁没被释放而红**。

**C-C —— 【§14 引入的修法，未闭合 C2】E13 只 deep-equal decision 那一行；`overturned` 的六个字段（含 `correctionId`）仍然零覆盖，而 `overturnedEventSchema` 是 `.passthrough()`。**

*在哪*：§14.2「断言**整条落盘的 decision 行** deep-equal 一个夹具期望对象」＋ §14.18 E13。

现测 `src/ledger/schema.ts:87-94`：`overturnedEventSchema = referenceEventSchema.extend({...})`，而 `referenceEventSchema`（`:53-58`）是 `.passthrough()` —— 所以 overturned 行**多写一个拼错的字段不会被拒**。而 `correctionId` 就住在这一行上：§5 明写「`overturned` 六个字段按上游 spec §3 填，本文不重复」，§14.2 现测的 12 行**全部是 decision 的字段**。

*具体场景*：把构造 `overturned.correctionId` 的那行代码写成 `decisionId`（这正是 §14.2 表里点名的第二条变异）。decision 那一行**一个字节都没变**（它的 `evidence[0]` 是另一处代码算出来的），E13 的 deep-equal 全绿；E16 只看 `at`；E5a 只数 `overturned` 的**条数**；E14 只看提交。**没有任何一条判据会红**，而 A′ §4.4 修复率整个 join 的键就此永久写错在只追加文件里 —— 这**逐字就是 C2 的原文**：「它是唯一没有任何机器能校验的字段」。

*修法*：E13 的 deep-equal 必须覆盖**落盘的两行**（decision 与 overturned），overturned 侧另加一条断言「除这六个字段外无多余键」（因为 schema 是 passthrough，只有判据能守这一格）。§14.2 那五条变异里的 `correctionId ← decisionId` 必须点名它作用在 **overturned 行**上。

**C-D —— 【§14 引入的修法互相打架】步 5 失败之后，文档给的重试路径（再跑一次 `--close`）会 exit 0 说「已经闭环」，而仓库仍然脏、`orca run` 仍然被挡。**

*在哪*：§14.1 的「友好处置」（步 4 之前先看该文件里有没有带这个 `correctionId` 的 `overturned` ⇒ 具名消息 ＋ **exit 0**）× §14.3 的步 5 残留（§14.19 第 10 项）。

*具体场景*：目标仓库的 pre-commit 钩子拒了步 5（对 Orca 自己就是 `npm run verify` 非 0）。此刻盘上：`.decisions/<run>.jsonl` 两行已写、已 `git add`、未提交。人修好钩子，按文档「`--close` 同时是失败重试路径」（§3）再跑一次 —— 友好处置扫到那条 `overturned` 就在文件里 ⇒ **打印「这条 correction 已经闭环」并 exit 0**。步 5 **永远不会被重跑**。人得到一个成功的退出码，而他的仓库仍然对 `orca run` 关着门（`preflight.ts:212-219` 的 `DIRTY_WORKTREE`）。

⚠️ 这条不是「§14 没修 C3」，是「§14.1 的友好处置和 §14.3 的步 5 各自都对，合起来把唯一的恢复路径堵死了」—— *** **正是上一轮那个「Minor 修法造出两条 Critical」教训的同形复发。** ***

*修法*：友好处置的空操作**不能只看台账文件**，它必须继续走步 5（提交是幂等的：若已提交，`git status --porcelain` 为空 ⇒ 无事可做 ⇒ exit 0；若未提交 ⇒ 补提交）。或者把友好处置的 exit 0 收窄成「台账两行在 **且** 已提交」，否则走非 0 ＋ 具名消息。配判据：变异「让友好处置在未提交时也返回 0」⇒ 红在退出码上。

### Important

**I-A —— 【§14 引入的修法】§14.3 把 repo 锁放在步 1、把「`.git` 是不是目录」放在步 2，正好把 `orca run` 刚偿清的那个 ENOENT 缺陷倒着装回来。**

现测 `src/scheduler/run.ts:637-641` 先跑 `unlockableTargetRejection`，`:649` 才 `acquireRepoLock`，并且 `:623-634` 的注释逐字解释了为什么必须这个次序：`acquireRepoLock` 是 `<targetRepo>/.git/orca-lock` 的非递归 `mkdir`，目标没有 `.git` 目录时会以 node 自己的 errno 结束一轮。§14.3 的表把两者对调了。

*具体场景*：`orca correct --repo /tmp/not-a-repo --decision … ` ⇒ `ENOENT: no such file or directory, mkdir '/tmp/not-a-repo/.git/orca-lock'`。**这与 §14.8 用整整一节表扬自己在 store 锁那侧避开的，是同一个形状、同一条记法**（「机制照抄时必须把它的前提一起抄过来核一遍」）—— 只是这次前提在 §14.3 里被丢在了锁的后面。

*修法*：步骤表调成 步 0 解析参数 → **步 1 `unlockableTargetRejection`** → 步 2 取 repo 锁 → 步 3 其余预检。判据：目标不是 git 仓库 ⇒ 断言消息是 `TARGET_NOT_A_GIT_REPO` 的措辞，**不是 node 的 errno**；变异「把这条检查移到取锁之后」⇒ 红在消息上。

**I-B —— 【§14 引入的修法】E10d（I2 的并发判据）结构上不可能红：§14.3 的 repo 锁（外层）已经把同一仓库上的两个 `orca correct` 串行化了。**

E10d 钉的是「查重的读必须在 store 锁内」，夹具是「两个进程」。但语义查重的键是 `(projectKey, decisionId, by)` ⇒ 两条要被判重的 correction **必须同一个 projectKey**。若夹具用同一个 `--repo`，两个进程在**步 1 的 repo 锁**上就分出先后了，第二个直接 exit 4，**永远走不到 store 锁那一格**。变异「把判断移到取锁之前」⇒ 两条仍然不会同时落盘 ⇒ **绿**。

*修法*：E10d 的夹具必须是**同一个 remote 的两个本地 clone**（同 `projectKey`、不同 `<repo>/.git/orca-lock`），并且需要一个可注入的同步点（读之后、取锁之前的 barrier）——否则即使夹具对了，红也是概率性的：没有 barrier 时进程 A 可能整条跑完 B 才开始读，于是变异下照绿。§14.7 只写了「并发夹具，两个进程」，这两件都没写。E7、E8 有同一个问题（同仓两个 `correct` 撞不上 store 锁），夹具得手工预建锁目录或同样用两个 clone。

**I-C —— 【§14 引入的修法】E18(a) 不可能红。**

E18(a)：「批内 `overturned` 引用批内 decision 必须过检查 5」，变异「把批量拆回两次单条追加」。

现测 `tests/ledger/writer.test.ts:110` 已经有一条判据叫 **"passes once the referenced decision has actually been appended first"** —— 也就是说，**先 `appendEvent(decision)` 再 `appendEvent(overturned)` 在成功路径上本来就通过，并产生逐字节相同的文件**。所以 E18(a) 的变异不改变任何可观测的东西。

⚠️ 这**逐字就是 I5／§14.10 刚刚从 E4 里删掉的那个形状**（「成功路径上两种顺序产生逐字节相同的终态」），在同一张替换表里的新判据上复发了。

*修法*：E18(a) 要么删掉（它钉的性质由 E4′ 的故障注入覆盖），要么改成钉**真正只有批量才成立**的那件事：`appendEvents(dir, run, [overturned, decision])`（顺序颠倒的批）**必须成功**，而两次单条追加在这个顺序下必然抛（`writer.ts:124` 的判据就叫这个名字）。那才是批量入口买来的、单条路径没有的能力。

**I-D —— 【§14 引入的修法，未闭合 I6】E6（§8 自称「本刀最承重的一条」）没有可点名的「删掉它自己」的变异。**

§14.11 只处置了夹具 `at` 那一半。但 §7.1 定的是 run id ＝ `deriveRunId("fix", <correction 行的规范 JSON>, <correction id>)` —— **`by` 是那一行的一个字段，没有任何一处代码是「把 `by` 放进派生」**。于是变异「从派生里去掉 `by`」没有落点：

- 若作用在 correction id 的派生上（§4：`sha256(projectKey|decisionId|at|because|by)`），因为 §14.11 要求两条夹具的 `at` **逐字节相同**、其余字段也相同、只有 `by` 不同 ⇒ 去掉 `by` 后**两条 correction 得到同一个 id** ⇒ id 查重（E10c）拒掉第二条 ⇒ 夹具根本造不出两行，测试**红在崩溃上**。§8 自己的纪律：「靠崩溃变红不算证据」。
- 若作用在那一行的规范 JSON 上（人为剔除 `by` 字段再哈希），那不是一条自然的代码变异，是为了让判据能红而专门造的开关。

⚠️ 顺带修正 §14.11(b) 的措辞。人裁驳回了「`at` 在扛」是对的，但**「`by` 才是有原则的分隔」同样不准**：在行级派生下，**扛这条不变式的是「整条 correction 行」**，`by` 只是恰好在里面。按 §14.21 发现 2 自己的教训（「一条没有理由撑着的机制下一轮会被删掉」），这句必须写准：*** **run id 是整条 correction 行的函数，因此两条不同的 correction 行结构上不共文件；`by` 是使两个人的行必然不同的那个字段。** ***

*修法*：E6 改成钉可观测的结论而不是钉一个不存在的代码位置 —— 「两条只有 `by` 不同的 correction ⇒ 两个不同的 run id ⇒ 两个不同文件」，变异改为「把 `by` 从**规范 JSON 的字段序列**里排除」，并在实现里让那个字段序列是一处具名常量（这样变异才有落点）。

**I-E —— 【§14 引入的修法】§14.3 的六步表没有「只记」模式的分支，于是 record-only 也要取目标仓库的 repo 锁、也会被 detached HEAD 拒、步 5 还要提交一个从没写过的文件。**

六步全是无条件的。但「只记」模式（不给 `--chose-instead`／`--undo-how`）**一个字节都不写进目标仓库**。后果：

1. 一轮 `orca run` 在飞（repo 锁按 `run.ts:1179-1180` 持有到整轮结束，可能几十分钟）⇒ 人想记一条「这个决策是错的」，得到 **exit 4 `repo-locked`**，且 §7.3 明写 repo 锁「拿不到时拒绝整轮，合理」—— 没有退避重试。**人在最想记 correction 的那一刻（看着一轮跑歪）恰恰记不了。** 这直接顶撞 §1 裁决 3 的立论（「成本高人就会少用，少用就没有对照样本」）。
2. 跑过一轮的仓库停在 W 上是正常态，但若人为了看历史 `git checkout <sha>` 进了 detached HEAD，连「只记」都被步 2 拒。
3. 步 5 会对一个不存在的 `.decisions/<新 run id>.jsonl` 跑 `git add`。

*修法*：步骤表分两条线。「只记」模式：不取 repo 锁，只做「`remote.origin.url` 能解析」这一项预检（它只读 `git config`），跳过步 4／5。「闭环」模式：走现在这六步。§14.19 要为「闭环模式在一轮在飞时不可用」单独登记一项。

**I-F —— 【§14 未修】§14.3 整表替换掉了 §6，但新表里没有 `--close` 的读取路径，而 §14.1 又把 §6.1 大部分作废了 ⇒ `--close` 现在在整份 spec 里没有一条完整的步骤序列。**

新表步 2 要求「读原 decision（扫 `<--repo>/.decisions/`），找不到 ⇒ 拒」。可是 `--close <correctionId>` 的命令行上**没有 `--decision`**（§3 明写互斥，§14.4 保留）——**被纠正的那条 decision 的 id 只存在于 corrections 存储里那一行上，而那一行要到步 3 才被读。** 步 2 照表执行是不可能的。同时步 3 无条件写着「追加 correction 行」，而 `--close` 不该追加任何 correction 行（§14.4 明确「不回写」）。

*修法*：把步 3 拆成 3a「取 store 锁 → 读全文」与 3b「（仅记录模式）查重 → 追加 → 释放」／3b′「（`--close`）按 id 找到那一行 → 释放」，并把步 2 里依赖 `decisionId` 的那半移到 3 之后。E11（原 decision 找不到）现在也要说明它测的是哪一种模式。

**I-G —— 【§14 引入的修法，未闭合 M1】§14.13 对 E11 变异的改述仍然靠崩溃变红。**

改述是「把具名拒绝换成放行，让 `appendEvents` 去拒」。但 M1 的原始理由是：**没有原 decision，就派生不出 `question`／`scope`／`kind`／继承的 `undo.cost`**（§5 那 12 行里有 5 行的来源是原 decision）。「放行」之后 `origDecision` 是 `undefined`，代码在**构造 decision 对象时**就 TypeError，根本到不了 `appendEvents`。E11 断言的消息拿到的是一个 TypeError 的 stack，exit 3。红了，但红在崩溃上 —— *** **M1 指出的病一个字没变，只是换了描述。** ***

*修法*：变异要么是「把具名拒绝的**消息**换成检查 5 的措辞」（纯消息变异，能红在断言上、不崩溃），要么在放行分支里给那五个字段填占位值再让 `appendEvents` 的检查 5 去拒 —— 后者是一次改写而不是删除，必须在判据里写明。

**I-H —— 【§14 未修】E2 是 M2 那个病（钉退出码而不是钉理由）的漏网。**

§14.13 把 E3 和 E11 改成断言消息，**却没回头看 E2**。E2 的点名变异是「补上 fallback」（一次加代码的变异，不是删掉守卫自己）。**删掉它自己**的那条变异是：删掉「无 remote ⇒ 整条拒」这道守卫。删掉之后 `projectKey` 为 undefined，`correctionSchema` 的 `projectKey: z.string().min(1)`（`src/corrections/schema.ts:30`）照样拒 ⇒ **仍然非 0 退出** ⇒ E2 若只断言退出码就是绿的。

*修法*：E2 补一条断言拒绝消息说的是「这个目标没有 remote」，并把点名变异改成删掉那道守卫。

**I-I —— 【§14 引入的修法】E10c 现在是一道冗余守卫。**

correction id 派生自 `projectKey|decisionId|at|because|by`（§4）⇒ **任何 id 重复的行必然也是 `(projectKey, decisionId, by)` 语义重复的行**。变异「删掉 id 查重」之后，语义查重（14.6）照样拒 ⇒ E10c **绿**。它只在夹具带 `--again`（语义查重被显式关掉）时才有独立的守护面。§14.18 保留了 E10c 并再次标注「它在现实中几乎撞不上」，但没注意到它现在连**变异**都撞不上。

*修法*：E10c 的夹具必须带 `--again`，并在判据文字里写明「本条只在 `--again` 之后才是唯一一道闸门」；否则删掉它。

**I-J —— 【§14 引入的修法】E5a 的点名变异有两种读法，一种读法下它是绿的。**

E5a 的变异是「run id 改回从命令行参数派生」。`--close <correctionId>` 的命令行上只有 `--repo`、`--close`、`--undo-how` —— **两次 `--close` 的 argv 逐字节相同** ⇒ 按字面「从命令行参数派生」，两次仍得到**同一个** run id ⇒ 同一个文件 ⇒ Check B 照抛 ⇒ `overturned` 总条数仍为 1 ⇒ **E5a 绿**。只有把变异读成「派生输入里含一个新鲜的 `now()`」（§12 发现 1 描述初稿时的那个含义）才会红。

*修法*：E5a 把变异写死成一句可执行的话，例如「把 `deriveRunId` 的第二个入参从 correction 行的规范 JSON 换成 `Buffer.from(new Date().toISOString())`」。⚠️ 这条还与 §14.5 交互：C5 现在往 decision 里放了一个新鲜的 `at`，实施者若顺手用「即将写出的 decision 对象」当派生输入，C1 的修法就静默失效 —— 判据必须能抓住这一种。

**I-K —— 【§14 引入的修法】§14.4 说的「可逆」比它实际的要弱。**

§14.4 判 `--close` 补给的 `chose_instead` 不回写 correction 行，理由是「将来子系统 B 若真要，能按 `correctionId` 从台账回填」。但台账**按仓库分散**，而这个存储做成用户全局的**全部理由**就是跨项目聚合（§1 裁决 2、`schema.ts:20-29`）。回填要求当时那 N 个仓库的 clone 都还在本机、且分支上有那笔提交。

*具体场景*：人在 5 个仓库里各闭环过一条 `wrong` correction；半年后删了其中两个 clone。那两条的 `chose_instead` —— 对照样本里最值钱的那半（`corrections/schema.ts:34-38` 的注释就这么说的）—— **不可恢复**。

*修法*：§14.19 第 9 项把这条从「可逆」改写成「**条件可逆：仅当那个仓库的 clone 与该提交仍可达**」，或者把 `chose_instead` 一并写进 `overturned` 的 passthrough 字段（它是 passthrough，能承载），让 join 之后总能拿回来。

### Minor

- **M-a —— 退出码不一致，§14.14 没对账。** 现测 `run.ts:646-651`：`orca run` 拿不到 repo 锁返回 **exit 1**（注释明写「Failing to acquire is exit 1」）。§14.14 给 `orca correct` 的同一个条件定 **exit 4 = 瞬态**。同一把锁、同一种瞬态，两个码。任何按「4 就重试」写的包装脚本对 `orca run` 会**永不重试**。要么把 `run` 也改到 4（那是改既有 CLI 契约，得单独裁），要么在 §14.14 里点名这个不一致。
- **M-b —— `appendEvents(dir, run, [])` 的契约未定。** 按 §14.1 的写法，空批的 payload 就是 separator 本身 ⇒ 对一个无尾换行的既有文件会追加一个孤立的 `\n`（文件变了、没写任何事件）。单元素包装路径永远走不到，但公开导出的批量入口能。写明「空批抛错」。
- **M-c —— §14.9 保留的「I4 仍成立的那一半」现在是错的。** 它说「`unlockableTargetRejection` 只在 `.git` 是目录时放行 ⇒ 会拒 linked worktree」是残留缺陷。但人裁 C3 之后 `orca correct` **要在 `<repo>/.git/orca-lock` 建锁目录**，linked worktree 的 `.git` 是文件 ⇒ **拒绝它是正确行为，不是残留缺陷**。这半条该跟另半条一起作废，只保留「另加一条 remote 缺失的具名拒绝」。
- **M-d —— E17 在 `umask 077` 的机器上会绿在自己的变异下。** 去掉 mode 参数后，`mkdir` 得 `0777 & ~umask`、`appendFile` 得 `0666 & ~umask`；umask 为 `077` 时正好是 `0700`／`0600` ⇒ 断言通过。判据里要显式 `process.umask(0o022)`。
- **M-e —— §14.3 「提在当前 HEAD」有一个未登记的后果。** 现测 `land.ts:53-55` 的注释：base 是目标仓库**当前检出的分支**，而 §4.5 说 W 永不删除、跑完不还原。若人跑完一轮后自己切回 `main` 再跑 `orca correct`，那笔 correction 提交落在 `main`；若他还停在 W 上，就落在 W 上，而下一轮从 `main` 切新 W2 时 **W 上那条永远到不了主线** —— 全仓库第一条真 `overturned` 可能就此留在一条没人合并的工作分支上。§14.19 该登记这一条。
- **M-f —— repo 锁会跨越目标仓库的整个 pre-commit 钩子。** 步 5 不加 `--no-verify`（这个决定本身是对的），但对 Orca 自己这类仓库，钩子会跑 `npm run verify`（现测 `package.json`）—— 分钟级，全程占着 repo 锁挡住 `orca run`。写进 §14.19 的代价点名即可。

### The two unexamined frameworks

#### JSONL vs SQLite（§1 裁决 2）

**裁决本身我不推翻，但它记下来的理由撑不住它现在要撑的重量。**

§1 裁决 2 那一格里被否掉的代价写了两条：(a) 放进目标仓库会推翻 `projectKey` 的存在理由、把可重写的东西塞进只追加闸门；(b) SQLite 要么引 native 依赖，要么依赖 `--experimental-sqlite`。*** **(a) 论的是【放在哪】，与【什么格式】无关 —— 它不能计入 JSONL 对 SQLite 的这一票。** *** 真正的论据只有 (b) 一条。

而从 §7 到 §14 这一路，选了平文件之后陆续长出来的东西是：mkdir store 锁 ＋ 退避重试 ＋ 超时（§7.2/§7.3）、一个具名瞬态错误 ＋ 一个新的 CLI 退出码（§14.14）、读全文的临界区 ＋ 一条我在 I-B 里判为不可能红的并发判据（§14.7/E10d）、补尾换行（§4/E9）、文件权限 0600/0700（§14.17）、以及 §14.4 那条「不做就地改行」的裁决及其永久不对称。**一个事务能一次买下其中的前三样。** 更直白的是 §7.4 自己：「多用户若落地成共享存储，本设计的互斥不成立，到那一步必须换底座（SQLite WAL 或服务端）」—— 设计已经写明了被否掉的那个选项就是终点。

**结论：裁决活得下来，但活在一条 spec 没写的理由上。** 那条理由是本仓库自己的原则（`corrections/schema.ts:7-12`）：*** **严格度跟着可逆性走。** *** corrections 存储是这套东西里**可迁移的那一半**，格式选错了是一次迁移；台账是选错就永远修不掉的那一半。所以把评审预算压在存储格式上本来就是投错了地方。建议 §14 补一句把理由换成这一条，并把 (a) 从那一格里划掉 —— 它不是这个分叉的论据。

#### 机械派生 vs 问人（§1 裁决 3）

**12 行里 10 行活得下来，2 行活不下来 —— 而那 2 行 spec 自己已经知道。**

活得下来的部分：`question` 逐字复制、`chose` ← `chose_instead`、`because`、`evidence`、`id`/`run`/`ev` —— 这些是确定性变换，按 Rule 5 本来就该是代码，而「让人手写两整条会把成本涨到没人用」这个论证是真的，也是本刀存在的目的所在。

**活不下来的是继承来的 `undo.cost` 与 `undo.blast_radius`。** §9 第 3 项自己登记了「反方向的代价未必与原方向对称」并写着「收紧的做法是让 `--undo-cost` 也可选传入，届时一行参数的事」。可是**台账只追加**：「届时」对**已经写下的行**永远不成立。裁决 4 已经为 `undo.how` 走过一模一样的推理（三个全派生会让 Tier 0 那道闸门永远不响），**同一条推理逐字适用于另外两个字段** —— 差别只是 `how` 有一个能观测的闸门（`undoExecutable.ts` 的谓词），而 `cost`/`blast_radius` 没有闸门，所以错了没人会发现，这让它更糟不是更好。

*具体场景*：一条 `scope: "cross-repo"` 的原 decision，`undo.cost` 写的是「要回滚三个仓库的 W 分支」。人把它推翻，改选一个只动一个文件的方案。派生出的新 decision 继承那句话，**永久声称撤销这个只动一个文件的选择要回滚三个仓库**。子系统 B 读到的就是这句。台账里改不掉。

**建议（不是推翻裁决，是把裁决 4 的边界画到该画的地方）**：现在就把 `--undo-cost` / `--undo-blast-radius` 做成**可选覆盖**（缺省仍然继承并标注「继承自 `<原 id>`」）。这是一行参数的事、可逆、且**只有在第一条真 `overturned` 落盘之前做才免费**。

另一处小的：`alternatives[0].why_not` 是模板生成的散文，落在一个按 A′ §4.3 本该承载人的语境的字段里。它带了 correction id 出处（§5 的注释论证得对），可以接受 —— 但值得在 §14.19 登记一句：**全仓第一条 `overturned` 的 `why_not` 永久是一句模板。**

### Assessment

**Ready to implement?** **No.**

**Reasoning:** §14.1 那个中心动作（闭环改成一次批量落盘）是对的，我对着 `writer.ts` 核过它的三条承重主张全部成立；但四条 Critical 里有三条是**这一轮的修法自己买来的**：步 5 的 `git commit` 会把人已暂存的工作吞进 orca 的记账提交（C-A）、repo 锁没有规定 `finally` 释放而它前面全是预期拒绝路径（C-B，`repoLock.ts` 按设计不做 stale 回收 ⇒ 一次失败永久锁死目标仓库）、以及 §14.1 的友好 exit 0 把 §14.3 步 5 失败后唯一的恢复路径堵死并报成功（C-D）。第四条是 C2 没被闭合：E13 只 deep-equal decision 那一行，而 `correctionId` 住在 passthrough 的 overturned 行上，把它写成 `decisionId` 处处绿（C-C）。判据侧另有三条**结构上不可能红**（E18(a)、E10d、E10c），其中 E18(a) 是 §14.10 刚从 E4 删掉的那个形状在同一张替换表里的复发 —— 按本仓库自己的纪律，一条不可能红的判据不是判据。

**用量**：我的 harness 没有给出 token／工具调用的计数接口，**拿不到就不报，不自估**（Rule 14）。本次为只读评审，未修改工作树、索引、HEAD 或任何分支，未跑测试。

---

## 控制器复核（**2026-09-06，run `orca-dev-d5eb8fa6`；本节是控制器写的，不是评审员的话**）

⚠️ **评审员在末尾说它拿不到用量数**，但**派出方这一侧的工具报数拿得到**：
*** **164,453 token ／ 25 次工具调用 ／ 786,099 ms。** *** 本文顶部登记的就是这个数。

按本仓库既定纪律，**评审员的承重主张必须自己复核**。逐条现测结果：

| 主张 | 复核方式 | 结论 |
|---|---|---|
| **C-A**：`git add -- <path>` ＋ `git commit -m` 会提交整个索引 | *** **一次性仓库实测**（非本仓库）：人 `git add mine.txt`，orca `git add -- .decisions/run.jsonl` 再 `commit -m` ⇒ 那一笔的文件列表是 `.decisions/run.jsonl` ＋ `mine.txt`，作者 `orca` *** | **成立** |
| **C-A 的修法** | 同一实测：**单用** `git commit -m … -- <pathspec>` ⇒ `error: pathspec '.decisions/run.jsonl' did not match any file(s) known to git`（台账文件是未跟踪的）。改成 `git add -- <path>` ＋ `git commit -m … -- <path>` ⇒ 那一笔**只含** `.decisions/run.jsonl`，且 `mine.txt` **仍在索引里** | 🔴 *** **方向成立，修法不完整。spec §14.3 用的是实测过的那个写法，不是评审员给的那一句。** *** |
| **C-B**：`run.ts` 把 `release()` 放在 `finally` 里；stale 回收明确不做 | 现测 `run.ts` 末尾确为 `} finally { await lock.release(); }`；`repoLock.ts` 注释含 "deliberately out of scope" | **成立** |
| **C-C**：`overturnedEventSchema` 建在 `.passthrough()` 上 | 现测 `src/ledger/schema.ts`：`referenceEventSchema` 以 `.passthrough()` 结尾，`overturnedEventSchema = referenceEventSchema.extend({…})` | **成立** |
| **I-A**：`run.ts` 是**先**预检**后**取锁 | 现测该段注释逐字为 "⚠️ The fix is NOT to move preflight above the lock… What moves ahead of it is strictly narrower: whether the lock can be placed at all"，且 `unlockableTargetRejection` 确在 `acquireRepoLock` 之前 | **成立 —— §14 初稿把次序写反了** |
| **M-a**：`orca run` 拿不到锁是 exit 1 | 现测该处注释逐字为 "Failing to acquire is exit 1" | **成立** |
| **I-C**：那条既有判据存在 | 现测 `tests/ledger/writer.test.ts:110` 名为 `passes once the referenced decision has actually been appended first` | **成立** |
| **I-I**：id 派生是语义键的超集 | 逐字对照 §4 的 id 派生（`projectKey\|decisionId\|at\|because\|by`）与 14.6 的语义键（`projectKey, decisionId, by`） | **成立** |
| **I-D**：`by` 在派生里没有独立落点 | 逐字对照 §7.1：`deriveRunId("fix", <整条 correction 行的规范 JSON>, <correction id>)` | **成立** |

**四条 Critical、十一条 Important 控制器全部接受**，处置逐条记在 spec 的 §14.20 第二张表里。

**唯一不采纳的是 I-K 的第二条备选修法**（把 `chose_instead` 塞进 `overturned` 的 passthrough 字段）：
那要给第一条真 `overturned` 加一个**上游没定义的第七个字段**，而 §0 明写「形状本身本文一个字都不改」，
且 `overturned` 是**不可逆的那一侧**。⇒ **采纳它的第一条**（把「可逆」改写成「条件可逆」）。
理由：*** **用不可逆的一侧去买可逆一侧的方便，方向反了。** ***

**两个框架的处置**（详见 spec §14.22）：JSONL vs SQLite —— **裁决保留，理由换成「严格度跟着可逆性走」，
并把 §1 裁决 2 里论「放在哪」的那半条从这个分叉的论据里划掉**；机械派生 —— **收**，
`--undo-cost` / `--undo-blast-radius` 改为可选覆盖，缺省才继承。
