# 子系统 C（调度层）开工前的同类系统调研

**归属**：run `orca-dev-894ae173`，2026-09-02。
**状态**：⚠️ **这是调研笔记，不是 spec，不构成任何已生效的决策。** C 的 spec 尚未开写。
**本文不写任何当前哈希**（提交本文这个动作本身就会改 HEAD）。要指代某一笔就引提交主题行。

---

## 0. 本轮最重要的一件事：**一次立场修正**

调研中途，人指出了一条把整个设计主干挪位的事实：

> **你无法禁止 agent 在执行任务时改哪些文件。**

本轮**现测核实了这条为真，而且比预想的更硬**（证据见 §5）：ccloop 的 `evaluatePathPolicy`
是一个**纯事后检测器**，agent 在 worktree 里有完整的文件系统权限，没有任何一处在它动手之前挡住它。

⇒ **两处立场修正，本文后续全部按修正后的读：**

### 修正 A：主干和优化此前是反的

| | 修正前（错） | 修正后 |
|---|---|---|
| 主干 | 写集相交判据 | *** **冲突的检测、分类、解决、验证** *** |
| 优化 | 冲突处理是例外路径 | 写集相交判据 —— 它**降低进入主干的频率**，不保证不进 |

⇒ *** **判据算错时，系统必须仍然正确。这不是容错，这是它的常态。** ***
把「相交⇒串行」当成安全保证是错的：它是一个**基于声明的预测**，而声明既不可强制也常常不准。

### 修正 B：Rule 7 此前被读窄了

先前的立场是「合并冲突 ⇒ 一律升人，不做自动和解」。**那是误用。**
CLAUDE.md Rule 7 的实际分档是：**证据能分出胜负 ⇒ agent 自己判；两边势均力敌 ⇒ 才升人。**

- **文本型冲突**（两边各加一条 import、改了相邻行）：证据能分胜负 ⇒ **不该升人**。
- **语义型冲突**（两边对同一段逻辑做了不相容的有意选择）：势均力敌 ⇒ **升人**。

而「这个冲突属于哪一类」**正是 Rule 5 明确列出该用模型做的事**（`Use me for: classification`）。

⇒ **和解的分工**：

| 谁 | 干什么 |
|---|---|
| **代码** | 检测冲突（`git merge` 退出码）、枚举冲突块、决定合并次序 |
| **模型** | 逐块分类；解掉可解的 |
| **代码** | 验证（跑两边契约 `verification.requiredChecks` 的并集）—— **不过验证就不算解决** |
| **人** | 只处理语义型残余 |

⚠️ **唯一必须保留的约束**（来自 hermes，见 §2 第 4 条）：
*** **解冲突的不能是当事任务本身。** *** 当事方缺对方的意图，会可靠地要么覆盖对方、要么放弃自己。
必须是一个拿到**两边完整意图**（不只是两个 diff）的第三方。

⚠️ 和解时逐块做的每一个判断**都是 agent 替人做的选择** ⇒ **进台账**，Tier 1，
`undo.how` 天然写得出（把集成分支 reset 回 `<ref>`），自动过 spec §1.1 闸门 A。

---

## 1. 读了什么、没读什么（**引用本文前先看这一节**）

**每个仓库都只读了目标问题那几十到几百行，没有一个是通读的。**

| 仓库 | 读了 | 没读 |
|---|---|---|
| `hermes-agent` | `kanban-worker-lanes.md` 全文；`kanban.md` 1171 行里 5 段；`kanban_db.py` **12150 行里约 200 行**（`_claimer_id` / `claim_task` / `_dispatch_tick_lock`）；`git-worktrees.md` 前 120 行 | `docs/hermes-kanban-v1-spec.pdf`（它自称是完整设计）、`dispatch_once` 实现、`kanban_swarm.py` |
| `snakemake` | `dag.py` 三段（790-845 / 1240-1290 / 2005-2045）、`exceptions.py` 305-400 | 其余 |
| `bazel` | `ActionConflictException.java` 96-175 | 其余 |
| `buck2` | `actions/registry.rs` 100-175、`actions.rs` 355-375 | 其余 |
| `airflow` | `airflow-core/src/airflow/utils/state.py` 40-140 | 其余 |
| `zuul` | `doc/source/gating.rst` 1-420 | 代码 |
| `bors-ng` | `batcher/divider.ex` 全文、`batcher.ex` 1-45 | 其余 |
| `nextflow` | `ErrorStrategy.groovy` 全文、`error-strategy.mdx` 全文、`cache-and-resume.mdx` 1-130 | 其余 |
| `pants` | `targets-and-build-files.mdx` 里 dependency inference 相关 5 行 | 其余 |

⚠️ **凡本文讲【机制】的都带文件行号，可现场核；凡讲【它为什么这么选】的，多数是从文档措辞推的，不是其作者说的。**
⚠️ **行号会随上游更新移动，引用前请现测。** 观测时点：2026-09-02。

---

## 2. 十七条借鉴

带 🔁 的是**多个系统独立收敛到同一结论**的，权重更高。

| # | 结论 | 来源 | 备注 |
|---|---|---|---|
| 1 | 🔁 **「任务」与「运行」是两层身份**：taskId 稳定（DAG 节点），run-id 每次尝试新分配（＝ ccloop run 目录名） | hermes `task_runs`；Airflow `TaskInstance` vs `DagRun` | 解掉了 spec §3.0「全局唯一**且**稳定」的内在张力。ccloop 目录结构本就是这形状（run 目录 + `attempts/<n>/`） |
| 2 | 🔁 **失败不是布尔**：ccloop 四个非成功终态各自路由；*** 「等人」不是终态 *** | hermes 六种具名失败；Airflow `AWAITING_INPUT` 属 `IntermediateTIState`；nextflow `FINISH` | 撤回了先前「非 succeeded ⇒ 后代全 blocked」那条粗判 |
| 3 | **认领的那一刻重新校验结构性不变量**，不信任之前的晋升 | hermes `claim_task`（`kanban_db.py:4643` 注释：唯一执行点，不管哪个写者设的 ready，**包括手改 SQL**） | ⇒ 真正 spawn 之前重算写集 |
| 4 | **解冲突的不能是当事任务**；另起中立第三方，拿到**两边的意图**而不只是两个 diff | hermes `kanban.md:954` ＋ `merge-reconciler` skill | 见 §0 修正 B —— 只保留这条约束，不保留「一律升人」 |
| 5 | **hotspot 用代码算，不靠约定** | hermes `kanban.md:967`（它自陈「the mitigation is a comment convention, **not a new primitive**」，因为它拿不到声明的写集） | 我们拿得到 ⇒ Rule 5「代码能答就代码答」 |
| 6 | 单写者锁；**但抢不到要报错退出，不静默降级** | hermes `_dispatch_tick_lock`（`kanban_db.py:1695`），**反着借** | 它在无 `fcntl`/`msvcrt` 的平台退化成 no-op。Rule 12 不允许 |
| 7 | **路径一律绝对，相对路径当场拒** | hermes `kanban.md:55`：相对路径会「对着 dispatcher 恰好所在的 CWD 解析」，既有歧义又是 confused-deputy 逃逸面 | |
| 8 | *** **相交判据 ＝ 目录字典树插入，三种冲突** ***：①同一路径 ②新路径是目录、底下已有别人的叶子 ③新路径要穿过一个已被认领的叶子。冲突时**列出全部**冲突路径 | buck2 `registry.rs:125` `claim_output_path`；bazel `ARTIFACT_PREFIX_CONFLICT` | spec §5.1 只写「相交」，**没定义什么叫相交**。朴素集合求交会把 `src/` 与 `src/a.ts` 判成不相交 —— 正是 §5.1 自己标记为**不安全**的那个方向 |
| 9 | 🔁 **事后核对是双向的**；「声明了却没产出」是它自己的具名失败 | snakemake `MissingOutputException`（消息逐字：*Job {jobid} **completed successfully, but some output files are missing***）；nextflow resume 要过两道（hash 命中 **且** 产物还在 **且** 退出码有效） | ⭐ 这就是本仓库「全绿但是坏的」的生产版本 |
| 10 | **后代未跑是 C 自己的终态**（≠ 失败，≠ ccloop 任何终态） | Airflow `UPSTREAM_FAILED` 属 `TerminalTIState`，与 `FAILED` 并列 | 「它没跑过」和「它跑坏了」读台账时天差地别 |
| 11 | **逐个合并，不批量 ⇒ 归因免费**，不需要二分 | bors-ng `divider.ex`（批次失败 ≥2 个 ⇒ 二分；只剩 1 个 ⇒ 判 blocked） | 代价是汇流串行化，但汇流是秒级、跑任务是分钟到小时级 —— 该串的地方串对了 |
| 12 | 并发预算**自适应**（成功 +1，失败折半，有下限） | Zuul Pipeline Window（明说抄 TCP 流控） | ⚠️ **登记，v1 不做。** 但论证在我们这儿更硬：Zuul 浪费 CPU，**我们浪费真钱** |
| 13 | *** **相交但无天然先后时，选出来的顺序是一次替人做的决策** *** —— 必须进台账，且人能钉死 | snakemake `ruleorder`；bazel/buck2/snakemake/pants **四个系统撞了都让人裁** | 见 §4 第 3 条的反证分析 |
| 14 | *** **绝不能有「有任务失败但整轮 exit 0」的档位** *** | nextflow：`IGNORE` 策略下默认 exit 0，要 `workflow.failOnIgnore: true` 才非 0 | 反面教材。本仓库 Rule 12 直接禁止 |
| 15 | **`orca plan` 式内省命令**：花任何钱之前先打印写集、相交对、DAG 分层、每批并行度 | pants `pants dependencies <target>` | 先让人看见图，再让机器跑图 |
| 16 | **事后核对的地位升一档**：我们**没有推断可用**，它是唯一的漂移检测手段 | pants 靠读 import **推断** `dependencies`，我们不可能在 agent 跑之前知道它将写什么 | pants 能在构建时发现漂移，**我们只能在付完钱之后** |
| 17 | 🔁 **run-id 分配 ＝ 内容导出 id ＋ 撞了就递增，用目录创建的原子性做仲裁** | nextflow：*"includes an incrementing component in the hash generation ... until it finds one that does not match an existing execution directory"*；hermes 用 SQLite CAS ＋ `rowcount != 1` | 两个无关系统收敛到同一原语。我们用 `mkdir` 的原子性（不引入 DB） |

**两条方法论旁注**（不入判据，但值得记）：

- **同一个不变量查两遍。** snakemake 在解析「谁产出这个文件」时查一次（`dag.py:1276`），又在 `check_jobs` 里对全部 job 穷举再查一次，注释写明理由：第一道**有覆盖洞**（`dag.py:2027`）。与本仓库「每新增一个分支点名一条删掉它自己的变异」同源。
- **宣布一条检查失败之前，先排除「观测本身是陈旧的」。** snakemake 的 `--latency-wait`（默认 3 秒，等网络文件系统）；nextflow 的 `lenient` 缓存模式（NFS 时间戳不一致，只用路径＋大小）。

---

## 3. 明确**不借**的

| 不借 | 理由 |
|---|---|
| **用 LLM 工具调用来终结 worker 的生命周期**（hermes `kanban_complete` / `kanban_block`） | 把**路由**放进模型手里，Rule 5 禁止。代价 hermes 自己承担了：一整套 `protocol_violation` ＋ 模型要退出时的「合成推一把」＋ 有上限的重试。**ccloop 的退出码 0／1／2 已是确定性等价物** |
| **常驻 dispatcher ＋ SQLite ＋ REST ＋ 看板 UI** | 那是子系统 E。且 spec §3.7：索引器是只读消费者，永不回写仓库 |
| **重造租约／心跳／崩溃检测** | ccloop 已有整套（租约＋心跳＋owner-transfer 三次 rename＋`unlock --force` 要 sha256）。再做一份就是两个真相源。**C 只看子进程退出码，liveness 归 ccloop** |
| **tenant / 多 board / 通知 / 附件 / `scheduled_at`** | v1 范围外 |
| **构建系统的「撞了就报错」** | 见 §4 第 3 条 —— 我们的场景不同，但它的教训在一处仍然咬人 |

**一条它们自陈的边界值得照抄**：hermes `kanban.md:1165` 写 kanban **单机是故意的**，因为崩溃检测假设 PID 是本机的，跨主机「没有协调原语」。**C v1 也是单机 —— 应当明写，而不是默认。**

---

## 4. 对 A′ spec 的四处实质补充（**A′ 是已发布文本，不就地改；此处登记，由 C 的 spec 具名承接**）

### 1. §5.1 的「写集相交」没有定义

「相交」在路径上不是集合求交。⇒ 按借鉴 8 的三种情况定义（字典树插入）。

⚠️ 附带一个**表达不了的问题**：ccloop 契约里 `targetPaths: z.array(z.string())`，
**`src` 是文件还是目录，契约表达不了**。snakemake 的答案是强制显式标注（`directory()`）**并事后验**
（`not (f.is_directory ^ os.path.isdir(f))`，不符抛 `ImproperOutputException`）。我们没有这个标注
⇒ 只能靠**一律当前缀看**这个偏安全的默认兜住。**过度圈定损失的是并行度，不是正确性**（§5.1 自己的方向性论证）。
**这条代价要写进 spec，不能当没看见。**

### 2. §5.1 的事后核对只写了一半

原文指向的是「写到声明之外」。snakemake 抓的是反方向：「声明了却没产出」。

| 方向 | 含义 | 性质 |
|---|---|---|
| 实际 ⊄ 声明 | 写集判据被绕过，并行判定可能已失效 | 安全 |
| **声明 ⊄ 实际** | **这个任务可能什么也没干，而退出码说它成功了** | **「绿是空的」** |

第二个方向在本仓库历史里是**更常见**的坏法。**两个方向都要。**

### 3. §5.1 没把「顺序选择」当成一次决策

四个独立系统（bazel / buck2 / snakemake / pants）撞了**都报错让人裁**，没有一个自动串行化。
**这条证据不支持我们的「相交⇒串行」。** 分析下来我们**仍然是对的**，但理由必须写出来：

> 构建系统的 output 是**派生物**：两条规则产出同一文件，图本身就是病的，**串行也救不了**（先后不同结果就不同）—— 那是建模 bug。
> Orca 的任务是**编辑**：A 加一个函数、B 加另一个，撞在同一文件上完全正常，串行有良定义的答案（B 在 A 的结果上开工）。**相交在我们这儿隐含的是一条 DAG 边，不是一个矛盾。**

⚠️ **但教训在一处仍然咬人**：两个任务相交、而它们之间**没有天然先后**时，谁先谁后是**任意的**，
而结果依赖于这个任意选择。⇒ **调度器不许静默替人挑这个顺序**：
它是 spec §5.3 所说的 `scheduling` 决策，**必须进台账、带 alternatives、能被推翻**，
并且应当让人能像 snakemake 的 `ruleorder` 那样钉死。

### 4. §5.1 把写集判据当成了安全保证

见 §0 修正 A。它是**基于声明的预测**，既不可强制也常常不准。

---

## 5. 本轮现测的 ccloop 事实（**都带命令，观测时点 2026-09-02**）

口径：`/usr/bin/grep -rn ... src/ --include="*.ts"` ＋ `sed -n` 整份读回，未过滤。

1. *** **ccloop 从不 commit，也从不 apply patch。** *** 全仓 `src/` `scripts/` 没有任何 `git commit` /
   `git apply` / `git cherry-pick`（同名命中全是 `applyOwnerEpochTransfer` / `applyPhaseUsage` 这类函数）。
   一次 attempt：`git worktree add --detach`（`workspace/worktreeManager.ts:25`）→ agent 改 →
   采 `diff.patch` → **`git worktree remove --force`**（`:30`）。
   ⇒ **跑成功之后目标仓库一个字节都没变**，产物只剩 `attempts/<n>/diff.patch` 这一份文本。
   ⇒ *** **A′ spec §5.1 写的「上游向下游的交接物是一个 commit，不是一份文档」——
   按 ccloop 今天的行为，它就是一份文档。那是对 C 的期望，不是已成立的事实。** ***
2. **契约里没有任何字段能指定「从哪个 commit 开工」。** `git worktree add --detach <path>` 不带 commit-ish
   ⇒ 基点恒等于 `context.repoPath` 的当前 HEAD。契约 schema（81 行，`.strict()`）也无 base-ref 字段。
   ⇒ §5.1「每个节点的 worktree 从它所有前驱的合并结果开出来」**在契约层无法表达**；
   C 只能靠**控制 `repoPath` 本身**来定基点。
3. *** **`evaluatePathPolicy` 是纯事后检测器。** *** `src/policy/pathPolicy.ts` 吃的是
   `changedFiles`（已改完的），调用点 `controller/runLoop.ts:1338` 在 execute **之后**，
   命中就把 run 打成 `blocked_waiting_human`。**没有任何一处在 agent 动手之前挡住它。**
   ⇒ 这是 §0 那条修正的直接证据。
4. *** **`targetPaths` 根本没有被 `evaluatePathPolicy` 读。** *** 它只读 `allowlistPaths` /
   `denylistPaths` / `maxFilesTouched`。
   ⇒ 我们的写集 `targetPaths ∪ allowlistPaths`，**一半 ccloop 从来不检查，另一半只事后检查**。
5. `pathPolicy` 的 `matches` **只认三种形式**：`前缀/**`、`**`、以及**完全相等**。**没有通用 glob。**
   `"src/**"` 会被切成 `startsWith("src/")`。
6. **ccloop 装不成 npm 依赖**：`package.json` 是 `private: true`、`version 0.1.0`、
   `bin` 指向 `dist/cli.js`（要先 `npm run build`）。**spec §9.1 写的「npm 依赖锁版本」当前没有可执行形式。**
7. **好消息**：事后核对的数据源已经是真的 —— `scripts/claude-phase-runner.mjs:198` 采
   `git status --porcelain=v1 -z --untracked-files=all`，`runLoop.ts:505` 的
   `observeChangedPathsBestEffort` 同理。**不是模型自报。**

---

## 6. 这些还不是决策

本文**只是调研 ＋ 两处立场修正**。C 的 spec 尚未开写，
`.decisions/orca-dev-894ae173.jsonl` **本轮未创建** —— 上面这些判断要等 spec 落地那一刻
才成为真正生效的决策，届时一并用写入方落盘。**这一点是有意的，不是漏掉的。**
