# Orca 目标对齐（goal.md）

> **这份文件不是 handoff。** 每轮交接**不需要**读它。
> 它回答的是「我们到底要造什么、每条要求能不能做、先后怎么排」，
> 供**定期对齐**或**方向有变**时拿出来过一遍。
> 「当前状态」「下一件事」「实测数」一律在 `docs/handoff/handoff.md`，**本文不复述，也不与之竞争**。

**归属**（Rule 13）：会话 `da2f5e9a`（Claude Code 交互会话，不是 orca run）；2026-09-22；
观测锚点 ＝ 主题行 `docs(handoff): roll the entry point onto the implemented assembly` 那一笔。
**本文不写当前 HEAD、不写 ahead 数、不写发布状态**——那些一秒后就可能为假。

**失效条件**（Rule 14）：本文引用的每个实测值都带测量命令；**引用前请现测**。
本文的「可行性判定」是**在观测锚点那一刻**的判定，被后续提交推翻时，
按 Rule 13 **另起一节记更正，不就地改**。

---

## 0. 怎么用这份文件

| 想知道 | 看哪节 |
|---|---|
| 我们的北极星是什么 | §1 |
| 一共有几件事、各自什么状态 | §2 的总览表 |
| 某一条具体怎么落、能不能做 | §3 对应小节 |
| 先做哪个 | §4 |
| 哪些等人拍板 | §5（编号 G1–G6，**引用时引编号**） |
| 哪些明确不做 | §6 |

**可行性判定的四档词汇**（全文统一）：

- 🟢 **现在就能做** —— 有现成接口或已有代码，只差接线
- 🟡 **需要前置** —— 点名前置是什么
- 🟠 **需要人裁** —— 点名分歧的两边，两边都摆得出证据（Rule 7）
- 🔴 **现在不建议** —— 点名理由

---

## 1. 北极星

> **让「一堆要做的事」自动变成「一串可审计的 agent 会话」，
> 并且人随时能看懂它在干什么、随时能把它掰回来。**

三个词拆开：
- **自动**：调度、依赖判定、写集比对、台账校验**全是代码**（Rule 5），模型只做判断题。
- **可审计**：每个选择都在台账里，人能翻案（`orca correct`），翻案会回流成记忆（ccmem）。
- **掰得回来**：人在任何时刻能看见、能改、能停；不可逆动作永远需要人（Tier 0）。

---

## 2. 目标树总览

| # | 能力域 | 你原话里的诉求 | 落在哪 | 判定 |
|---|---|---|---|---|
| **3.1** | **仓库职责与协议归属** | 「重新考虑整体架构，哪些放 Orca、哪些放 ccloop」 | 三仓 ＋ 一个新的契约面 | 🟠 **头号，待裁 G1/G2/G3** |
| 3.2 | 给 AI agent 的接口 | 「web 接口或 mcp 接口，让 agent 分析规划、看进度、插修复任务」 | Orca | 🟡 前置＝3.1 的协议面 |
| 3.3 | loop 方案层 | 「task ⇒ loop 方案 ⇒ agent session；先给几种常用方案」 | Orca | 🟡 **全新概念，现在零代码** |
| 3.4 | Web UI 看板 | 「未完成/已完成 task、关系、session 历史、需关注项、耗时与完成度、git 方案」 | Orca | 🟢/🟠（完成度口径待裁 G4） |
| 3.5 | 模型开箱即用 ＋ litellm | 「搭配 litellm proxy 多模型混用」 | ccloop（执行端）＋ Orca（记账） | 🟢 |
| 3.6 | skill 管控（syncskill） | 「Orca 用 syncskill 管控各 agent 的 skill」 | syncskill ＋ Orca | ✅ G5 选 (i)；syncskill 三件（会话 `16ab00f2`）与 Orca 接入（会话 `08b1007d`）都做完，等人审；codex 留下一轮（见 §11 中期 9） |
| 3.7 | 外部 client 协议接入 | 「参考 openclaw / hermes-agent 的 client 协议」「ccloop 支持 A2A」 | ccloop（A2A）／Orca（client） | 🟠 **A2A 只能做只读，待裁 G6** |
| 3.8 | 跨机分布式 | 「后期支持跨机器多 agent 协调」 | 全系统 | ⏸ **本轮明确推迟**（人已拍） |
| 3.9 | 多语言／多仓／submodule | 「不同组件用最适合的语言，可拆仓，可 submodule」 | —— | ⏸ **保持 TS，写触发条件**（人已拍） |

---

## 3. 逐条

### 3.1 仓库职责与协议归属（**头号**）

#### 现状（实测）

四个子系统的规模，测量命令
`for d in …; do cat src/$d/*.ts | wc -l; done`，观测锚点见文首：
`control` 7280 行 / `scheduler` 4482 / `panel` 3801 / `corrections` 1529 / `metrics` 1266 /
`chain` 1208 / `ledger` 709 / `gate` 551 / `checkpoint` 523 / `level` 346。

**两条与设计的漂移，都是现测**：

1. **ccloop 不是 npm 依赖。** spec §9.1 拍的是「用 npm 依赖引入，理由是锁版本」，
   而现实是 Orca 通过环境变量 `ORCA_CCLOOP_BIN` 指向一个**本机二进制路径**
   （`src/panel/controlAssembly.ts`、`src/panel/controlOptions.ts`、`src/control/unconfiguredPort.ts`；
   `package.json` 的 `dependencies` 只有 `express` 与 `zod`）。
   ⇒ **「锁住一个已知为绿的 ccloop 版本」这件事目前没有任何机制在做。**
2. **协议没有单一真相源。** `targetVersion` 在 `src/control/webProtocol.ts` 是非空字符串、
   在 `src/control/schema.ts` 是安全整数、在 `src/control/types.ts` 是 `number`；
   ccloop 那侧另有一份。今天卡住的两条红判据就是这条缝。
   同一个根因还生出第二个症状：`CapabilityViewV1` 要七个字段，
   ccloop 的 `capabilities` 只答七个**别的**字段，缺的五个
   （`contextObservation`／`handoffControl`／`handoffExecution`／`contextWindowTokens`／`requestBoundProof`）
   得 ccloop 侧补。

> 🔴 **要点**：这两个「当前阻塞」不是两件独立的 bug，**是同一个结构缺陷的两个出口** ——
> **协议由消费方（Orca）单方面定义，生产方（ccloop）靠人肉追平。**
> 修掉那两条红线只是止痛；不动结构，下一次扩协议还会出现同样形状的两条红线。

#### 三种切法

| | 做法 | 代价 | 收益 |
|---|---|---|---|
| **(a)** | 维持现状：Orca 定义，ccloop 跟随 | 每次扩协议都是一次跨仓竞态；今天这两条红判据就是账单 | 零改动 |
| **(b)** | **抽出一个 contract-only 的协议面**（无运行时代码：schema ＋ 类型 ＋ 版本常量 ＋ 一致性判据），两仓都消费它 | 要建一个包／一次性迁移；两仓都要改 import | 分歧变成**编译期可判**；capability 词汇表有了主人；日后 A2A/MCP/openclaw 都只是它的翻译层 |
| **(c)** | 把 ccloop 并进 Orca | 与 spec §9 直接冲突；ccloop 有自己的铁律与在飞的一轮工作（E1 的 I-2 ＋ 人裁 85） | —— |

**我的倾向：(b)。** 理由是它把「今天的两个阻塞」和「明天的四种协议接入」用同一笔投入解决了。
⚠️ **但这是我的判断，不是裁决** ⇒ **G1**。（包放哪也归 G1：Orca 内的 workspace 子包，还是第四个仓。
按 §3.9 已拍的「保持 TS、不轻易拆仓」，**子包的默认值更合身**。）

#### 职责线（建议，非裁决）

| 关注点 | 建议归属 | 为什么 |
|---|---|---|
| 单任务循环（plan→execute→verify）、worktree 隔离、租约与所有权、崩溃恢复、adapter、**agent session 生命周期** | **ccloop** | 它已经做到了，且证据链（stopProof、accepted.json、pid 身份）都在它那 |
| 任务图、写集冲突与并行判据、落地分支、决策台账、人的纠正、指标、面板、控制面 work item、证据归档 | **Orca** | 工头的活 |
| control 方法集、capability 词汇表、start envelope、usage／evidence 的形状与版本 | **契约面（新）** | 见上 |
| 上下文水位 `level`／`checkpoint`／Tier 0 `gate` | **🟠 待裁 G2** | 它们的形态是**装进目标仓库的 Claude Code hook**，服务的是「那一个 agent 会话」，不是工头。现在住在 Orca 只是因为 Orca 先长出了它们 |
| `orca chain`（无人值守串会话） | **🟠 待裁 G3** | 「把一件事跑成循环」正是 ccloop 的岗位描述。两个仓各有一个 loop runner，要么是重复，要么 chain 该被声明成「Orca 自用的开发循环，不是产品能力」 |

#### 不变的边界（**不因重划分而松动**）

- 台账 `.decisions/` 住在**被干活的那个目标仓库**里，不住 Orca、不住 ccmem（spec §9.2）。
- ccmem **一个字都不 vendor**，走 CLI/DB 接口（spec §9.1）。
- Orca 的规则不外溢到目标仓库（CLAUDE.md Rule 16 / spec §7）。
- **ccloop 不需要知道 Orca 存在。** 契约面若建成，它消费的是协议，不是 Orca。

---

### 3.2 给 AI agent 的接口（Web / MCP）

**诉求**：让外部 AI agent 去分析任务规划是否合理、看整体进度、插入修复任务。

**判定：🟡 需要前置**（前置 ＝ §3.1 的协议面，否则等于再抄一份类型）。

**建议形态（待 G1 定了之后落）**：

1. **HTTP 优先，MCP 是薄壳。** Orca 已有 zod 定义的命令与查询 schema，
   且命令模型自带幂等键与版本冲突检测（`orca-raw-command-v1` 的 `commandId` ＋ `expectedRevision`，
   见 `src/control/webProtocol.ts`、`src/control/commands.ts`）。
   **这套语义是资产，不能在翻译中丢掉。**
2. **MCP 工具只做两类**：
   - **读快照**（同步、幂等）：读规划、读进度、读某个 session 的状态；
   - **投递命令**（返回 `commandId`）：插入修复任务、改优先级。
   ⚠️ **不要把一个 run 建模成 MCP Task。** 调研查到：Tasks 是**扩展**（`io.modelcontextprotocol/tasks`），
   宿主支持参差、要两端显式 opt-in，服务端「MAY discard a task once its TTL elapses」，
   取消是协作式，且中间层普遍有超时。而 Orca 的一个 run 可能跑几小时。
   ⇒ **run 的真相留在台账里，MCP 只给它开一扇只读窗 ＋ 一个投递口。**
3. **插任务有一条语义 MCP 只能靠错误文本传达**：有活跃 run 时改任务图会被
   `graph-change-needs-handoff` 拒绝（`src/control/commands.ts`）。翻译层必须原样透出这个错误码，不许吞。

---

### 3.3 loop 方案层（task ⇒ loop 方案 ⇒ agent session）

**诉求**：Orca 要能显示并修改 loop 方案；先提供几种不同类型 task 的常用方案。

**判定：🟡 全新概念 —— 现在零代码。**

**现状（实测）**：任务契约 schema 在 `src/scheduler/planFile.ts`，
已经有 `executionPolicy.maxAttempts` / `perAttemptTimeoutMs` / `tokenBudget`、
`verification.verifierType|requiredChecks|rejectOn`、`safetyPolicy.allowlistPaths` 等旋钮，
但 `autonomyLevel` 是 `z.literal("L2")` —— **只有一档，说明「方案」这个维度目前被写死了**。
循环的**形状**（plan→execute→verify）由 ccloop 固定，Orca 只能调参数。

**建议**：`loop 方案` ＝ 一个**命名的契约模板**，展开后产出上面那份契约。它至少要钉住：

| 维度 | 例子 |
|---|---|
| 循环形状与终止条件 | 最多几次 attempt、什么算通过、什么算放弃 |
| 验收判据 | 一条能跑出 0/非 0 的命令（CLAUDE.md Rule 4：**散文判据不许用**） |
| 安全面 | allowlist／denylist、maxFilesTouched、哪些动作要人 |
| **git 工作区方案** | worktree？clone？直接在主树？落哪个分支？commit 粒度？push 归谁 |
| **skill 集** | 这类任务的 agent 该带哪些 skill（接 §3.6） |
| 预算 | token／时长／金额上界 |

**常用方案的候选**（先给三到四种就够，YAGNI）：
`bugfix-tdd`（先红后绿 ＋ 变异证明）、`spec-then-plan`（设计类，终点是文档不是代码）、
`refactor-guarded`（零行为变更，判据是既有判据全绿 ＋ 写集受限）、`investigate-only`（只读，产出报告）。

⚠️ **两条硬约束**：
1. **「方案 → 契约」的展开必须是纯代码**（Rule 5）。用模型去选方案可以，用模型去**展开**方案不行 —— 不可复现。
2. **方案是给目标仓库的 agent 用的，受那个仓库的规则管**，不受 Orca 的 CLAUDE.md 管（Rule 16）。

---

### 3.4 Web UI：任务、session、进度、git 方案

**诉求**：未完成／已完成的 task、task 之间的关系、历史与在跑的 session、标出需要关注的、
记录执行情况（耗时、预计完成度）、明确显示 git 工作区／coding／commit／push 方案。

**判定：🟢 大部分能做**（数据已经在台账与控制面里），**一处 🟠 待裁**。

- 🟢 **任务关系图**：`src/scheduler/graph.ts` 已经算依赖与写集冲突，面板只是没画。
- 🟢 **session 历史与状态**：控制面已有 work item、checkpoint、recovery、证据归档。
- 🟢 **耗时**：run 目录与事件流里有真实时间戳。
- 🟠 **「预计完成度」的口径 —— G4。** 候选：已完成 task 数／总数；attempt 数对上界的比值；
  `successConditions` 命中条数。⚠️ **无论选哪个，必须是代码算的**；
  **让模型"估个百分比"直接违反 Rule 14**（成本、耗时、token 只报工具给出的数）。
  粗糙可以，**自估不行**。
- 🟢 **git 工作区方案的显示**：它是 §3.3 那份 loop 方案的一个字段，UI 照着显示即可。
  ⚠️ **push 与合并进 main 是 Tier 0** —— UI 可以**显示**方案，但那两个动作在本仓库的 agent 会话里
  被闸门机械拦下（CLAUDE.md Rule 15），**UI 上必须显示成「等人」，不能显示成「已排队」**。
- 🟢 **需要关注的标记**：判据用现成的 —— `awaitingHuman` 非空、判据红、预算逼近上界、
  recovery 里有孤儿、有 correction 未闭环。**全是代码能判的**，不要用模型打分。

---

### 3.5 模型开箱即用 ＋ litellm 多模型

**判定：🟢 可行**，且与本项目的成本纪律**天然对得上**。

**现测（源码级）**：
- 调用面是 OpenAI 兼容的 `/v1/chat/completions` 等，外加 Anthropic 格式 `/v1/messages`
  （`litellm/proxy/proxy_server.py`、`litellm/proxy/anthropic_endpoints/endpoints.py`）。
- **逐次成本**：响应头 `x-litellm-response-cost`，另有 `-input`／`-output`／`-cache-read`／
  `-cache-creation`／`-reasoning`／`-tool-usage` 分项，以及 `x-litellm-call-id`／`x-litellm-model-id`
  （`litellm/proxy/common_request_processing.py:1516` 起，**本人现读确认**）。流式会强制 `include_usage`。
- **路由／回退／预算**内建：`router_settings` 的 `fallbacks`／`context_window_fallbacks`，
  key/team/user 级 `max_budget`／`budget_duration`。

> 🔴 **一条必须写死的接线纪律**：litellm **算不出价时返回 `None`，spend log 记 0**，
> 它**不猜**。⇒ **Orca 必须把 `None` 与 0 都当成「拿不到」，不许当成「花了 0 块」**。
> 这正是 CLAUDE.md Rule 14 的那句「拿不到就说拿不到，不许自估」在代码里的落点。

⚠️ **同时不许宣称的事**：ccloop 当前的 `capabilities` 答的是
`usageObservation: "phase-end"` ＋ `budgetEnforcement: "soft"`。
**任何地方都不许把它说成 strict token 封顶**，接了 litellm 也不会自动变 strict ——
litellm 的预算在 key/team 级，**不是单次 run 级**。

**归属**：**调用 litellm 的是 ccloop**（它持有 adapter 与模型策略）；
**Orca 只负责把每次 run 的成本归组计费并写进台账**。

---

### 3.6 skill 管控（syncskill）

**判定：🟡 现成接口能覆盖一半，缺三件。**

**现成可用**（均为源码级现测）：
- `link set <skill> <agents...>` ＋ `link build -y --json --no-interactive` —— 声明并实现 agent→skill 的 symlink；
  幂等（已正确则不动，非 symlink 目标拒绝覆盖）。
- `install <url|path> --path <dir> -y`、`source update --all`、`status`、`diff`、`doctor`（exit 3 可当门禁）。
- 全局 `--json`（JSONL）／`--plan`／`--apply`／退出码 0–8 有定义。
- ~~**`--sync-dir` / `SYNCSKILL_DIR` 可改道**~~ **更正（会话 `16ab00f2`，2026-10-03，读 syncskill `src/config/config.ts` 的 `getSyncDir` 与 `src/index.ts` 的 `createProgram`）：这两个都只是被解析，没有任何地方读它们；所有路径都由 HOME 算出。** 判据仍能满足 CLAUDE.md Rule 17，但做法是**改 HOME**（syncskill 自己的测试一直这么做）。

**缺的三件（都是"没有"，不是"不好用"）**：
1. **没有 profile／清单／组** —— 只有「skill → agent 产品」的**全局矩阵**，
   而且那个 "agent" 是产品（claude／codex），**不是某一次 run 的实例**。
   ⇒ 「按任务类型下发 skill 子集」现在做不到。
2. **没有项目级／worktree 级注入** —— agent 的 skill 目录固定在 `~` 下。
   ⇒ 两个并行 run 想带不同 skill 集，**会互相踩**。
3. **没有版本概念** —— 只有目录 MD5，源只记 branch、**不记 commit**。
   ⇒ 「这次 run 用的是哪个 skill 版本」答不出来，**而这正是台账要求的可复现性**。

另：**没有库 API**（`package.json` 只有 `bin`），只能 spawn CLI；版本号 `0.1.0` 与 tag `v2.9.9` 不一致，**未见 npm 发布证据**。

**两条路 —— G5**：
- **(i)** syncskill 补这三件（profile／按 run 注入／版本记录），Orca 直接用；
- **(ii)** Orca 只用 syncskill 做**机器级 skill 基线**（装什么、同步到哪台机器），
  per-run 的 skill 子集由 §3.3 的 loop 方案自己管，不经 syncskill。
  代价是「skill 从哪来」与「这次用了哪些」由两个系统各管一半。

---

### 3.7 外部 client 协议接入（openclaw / hermes-agent / A2A）

#### A2A —— **🟠 结论比诉求窄：状态可以，控制不行**

**诉求原话**：「考虑让 ccloop 支持 A2A 协议，用于收取 agent 状态以及控制 agent。需要看下这个方案是否可行。」

**调研结果（v1.0.0，Linux Foundation；传输 JSON-RPC 2.0 / gRPC / HTTP+JSON，流式走 SSE；TS SDK `@a2a-js/sdk`）**：

| ccloop control v1 的语义 | A2A 有没有对应物 |
|---|---|
| `accept` / `inspect` / `collect` | ✅ `SendMessage` / `GetTask` / `SubscribeToTask`（规范要求重订时回放当前 Task） |
| **严格幂等**（envelope canonical hash 冲突检测） | ❌ A2A 只说 `SendMessage` **MAY** 幂等，task id 由服务端生成 |
| **崩溃恢复**（accepted.json ＋ pid 身份 ＋ stopProof） | ❌ 未规定任务持久化与保留期（「MAY implement cleanup policies」） |
| **usage / 成本上报**（eventSeq 游标 ＋ 累计金额 ＋ 证据 hash） | ❌ Task／Artifact 无 usage、无 cost、无 hash 字段 |
| `handoff`（按 `deadlineAt` 强制 abort） | ⚠️ 只有 `CancelTask`，规范明说**可能不被执行**（协作式） |

> ⇒ **判定：A2A 可以做一层"只读状态外壳"**——把 ccloop 的 run 映射成 A2A Task 暴露出去，
> 让外部 agent 生态能看见它。**它替代不了 control v1 做控制**，因为 Orca 的台账校验、
> 幂等重放、崩溃恢复、成本归组**全都建立在 A2A 没有的那几样东西上**。
> 硬塞进 `metadata` 等于把承重语义藏进一个规范不保证的口袋里。**⇒ G6。**

#### openclaw / hermes-agent —— **借"多终端"，不借"协议"**

- **openclaw**：多终端（Telegram/Discord/iMessage…）是**进程内的 channel plugin**，不是网络客户端；
  真正的服务端↔客户端协议是 **Gateway WS**（文本帧 JSON，首帧必须 `connect`，
  三种帧 `req`／`res`／`event`，role `operator`|`node` ＋ scopes ＋ Ed25519 设备配对）。
  第三方作 client 的最小面：role `operator` ＋ scopes `operator.read/write`，
  方法 `chat.send`／`chat.history`／`sessions.list|subscribe`，事件 `chat`（`deltaText` 增量）。
  ⚠️ **npm 包 `@openclaw/gateway-protocol` 文档自陈「初期 npm 可能返回 E404，直到第一个带包的 release」**
  （本人现读 `docs/gateway/protocol.md` 确认）⇒ **接入前先验它装不装得上，别把它写进计划的前置里。**
- **hermes-agent**：多终端同样是进程内 Python adapter；对外有三套协议
  （OpenAI 兼容 HTTP、TUI 的换行分隔 JSON-RPC、实验性 relay）。**OpenAI 兼容那套最省事。**
- 🔴 **真正值得借的是 opencode 的形状，不是这两家的协议**：
  `opencode serve` 把 agent 做成一个 HTTP server，所有 client 都是外部进程；
  REST ＋ 一个全局 SSE 事件流 ＋ session id，**多终端接同一个 session 完全不需要插件机制**
  （它的 Slack bot 就是这么写的）。
  ⇒ **这条直接支持 §3.2 选 HTTP＋事件流，也直接服务 §3.8 的跨机。**

**判定**：openclaw／hermes 的**接入**是 🔴 **远期**（收益是"多终端通知与遥控"，
而我们眼下连 Web 派活都没打通）；**但它们的形状现在就该影响设计** —— 见 §3.8 约束 7。

---

### 3.8 跨机器多 agent 分布式 —— **本轮明确推迟**

人已拍：**现在不做，但写下「别做死」的约束清单。** 理由是它会改变控制面的存储与身份模型，
而眼下的优先级是把单机的 Web 派活打通。

**约束清单（每一条都是"现在少做一点，以后省很多"）**：

| # | 现在的事实 | 约束 |
|---|---|---|
| 1 | control store 是**单写者**、住 `~/.orca/control/<repo key>` | **别把本地路径当身份。** `controlRepoKey()` 已经在做「可读片段 ＋ 原 key 的 sha256 前八位」——**保持这个方向**，不要再新增靠路径拼出来的身份 |
| 2 | 同一仓库的第二个 panel 不挂控制面（当前是**控制器自己做的决定，可逆**） | 别在这条上建产品语义；跨机时它会被真正的租约取代 |
| 3 | panel 的 token 只在 HTML 里、不可撤销、一个进程一个身份 | **别在这上面建权限模型。** 需要鉴权时是新造，不是扩展 |
| 4 | 执行端点是 `ORCA_CCLOOP_BIN` 指的本机二进制 | **执行端点必须始终是一个可替换的 port**（现在已经是 `executionPort`）——**保持**，别让本机路径漏进 port 之外的地方 |
| 5 | 证据与 run 目录是**本地路径** | 跨机要靠**内容寻址**。`read-evidence` 已经带 hash 校验 —— **保持**，新增证据引用一律带 hash |
| 6 | `collect(afterSeq)` 用 `eventSeq` 游标增量拉 | **保持。别引入依赖本机墙钟的排序** |
| 7 | 台账是 **git 为真相源、DB 为索引** | **这条天然跨机友好，别退回「DB 为真相源」。** 配合 §3.7 的 opencode 形状：状态靠**事件流**分发，不靠共享文件系统 |

---

### 3.9 多语言 / 多仓 / submodule —— **保持 TS**

人已拍：**保持 TypeScript，除非量到瓶颈。** 语言选型写成**触发条件**，不写成计划。

**触发条件（量到才动）**：
1. 调度器在 N 个并行任务下 wall-clock 成为瓶颈，**且 profile 明确指向 Node 运行时**；
2. hook 的启动延迟成为体感问题 —— `gate` / `level` 是**每个 prompt 新起一个进程**的形状，
   ccmem 实测过冷/热进程差（~220ms 量级来自 TLS 握手）。
   ⇒ **若要换，这两个小而热的二进制是第一候选，不是调度器。**

**submodule：🔴 明确不做。** spec §9.1 已拍「ccloop 走 npm 依赖、ccmem 不 vendor、都不用 submodule」，
理由是 submodule 进来 ccmem 也不会运行（它是 Claude Code 插件，装进 `~/.claude/`）——
**付真代价，换零收益**。选 submodule 等于推翻那条裁决，**要推翻就走 Rule 11，别绕过**。

⚠️ 但 §3.1 现测的那条漂移要记住：**「ccloop 走 npm 依赖锁版本」至今没落地**，
现在是环境变量指本机二进制。**这是一个已知的缺口，不是一个已完成的决定。**

---

## 4. 分期

> **排期只排"先后"，不排日期。** 每一期的终点都是一条能跑出 0／非 0 的判据（Rule 4）。

### 近期 —— 把现有阻塞打通，顺手把协议面立起来

1. **人裁 `targetVersion` 那条缝**（改 Web 协议，还是改上线信封）。
2. **ccloop 补 `capabilities` 的五个 V1 探针字段。**
3. **⇒ 在做 1、2 的同时决定 G1。** 这两件都是协议问题；
   **如果要建契约面，这是它成本最低的出生时机** —— 否则就是先手改两处、以后再改第三次。
4. 终点判据：**Web 派活到真 ccloop 能开出一个 run**（现在必得 `control-capability-unsupported`）。

### 中期 —— 让它变成"能看、能改、能被 agent 用"的系统

5. **§3.3 loop 方案层**（先三到四种模板，展开器是纯代码）。
6. **§3.4 Web UI 看板扩展**（关系图、session 历史、需关注标记、git 方案显示）＋ **G4 的完成度口径**。
7. **§3.2 AI agent 接口**：HTTP 先行，MCP 薄壳跟上。
8. **§3.5 litellm 接线**（含那条「None/0 ＝ 拿不到」的纪律）。
9. **§3.6 syncskill**：按 G5 的裁决选 (i) 或 (ii)。

### 远期

10. **§3.7 A2A 只读状态外壳**（若 G6 通过）。
11. **§3.7 openclaw client 接入**（先验 npm 包装不装得上）。
12. **§3.8 跨机分布式**（约束清单已在，届时按它审一遍现状）。

---

## 5. 待人裁清单（引用引编号）

> ✅ **G1–G6 已于 2026-09-22 全部裁决 —— 见 §8。**
> 下表**原文保留**，因为它记的是两边的证据，那部分仍然有效；**但「待裁」这个状态已经过期。**

| # | 要裁什么 | 两边的证据 |
|---|---|---|
| **G1** | **要不要建 contract-only 的协议面？建在哪（Orca 子包／第四个仓）** | 建：今天两个阻塞同根同源，且四种外部协议都要靠它当翻译源／不建：一次性迁移成本，两仓都要改 import |
| **G2** | `level`／`checkpoint`／`gate` 长期归谁 | 留 Orca：现在就在这、能跑／移出：它们是装进目标仓库的 hook，服务的是 agent 会话不是工头 |
| **G3** | `orca chain` 是产品能力还是 Orca 自用的开发循环 | 产品：它已经能跑无人值守串会话／自用：与 ccloop 的岗位描述重叠，两个 loop runner |
| **G4** | 「预计完成度」用哪个口径 | 候选三种（见 §3.4）。**共同约束：必须代码算，不许模型估** |
| **G5** | syncskill 补三件，还是 Orca 只用它做机器级基线 | 补：一个系统管到底／不补：缺口在 syncskill 侧、改它也要成本，而 loop 方案本来就要管 skill 集 |
| **G6** | 接受「A2A 只做只读状态外壳、不做控制」这条定位吗 | 接受：幂等／恢复／usage／证据 hash A2A 全无／不接受：那就要把承重语义塞 metadata，且失去规范保证 |

**另有已在 handoff 里挂着、不属于本文的**：`~/.orca` 的残留清理、push、
「第二个 panel 不挂控制面」那条控制器自决要不要维持。**那三件看 handoff，不在这里重复。**

---

## 6. 明确不做（YAGNI）

1. **用 submodule 聚合四个仓**（§3.9；推翻 spec §9.1 才能做）。
2. **自建多模型网关** —— 用 litellm（§3.5）。
3. **自建多终端插件体系** —— openclaw／hermes 都是进程内 adapter，
   而 opencode 证明了「HTTP server ＋ 事件流 ＋ session id」就够（§3.7）。
4. **把一个 run 建模成 MCP Task**（§3.2，理由：TTL 可被丢弃、取消是协作式、宿主支持参差）。
5. **用 LLM 做调度、依赖判定、写集比对、台账校验、进度估算**（CLAUDE.md Rule 5 / Rule 14）。
6. **现在就按分布式重写控制面**（§3.8，人已拍推迟）。

---

## 7. 证据出处

| 主张 | 怎么核 |
|---|---|
| Orca 各子系统行数 | `for d in chain checkpoint control corrections gate ledger level metrics panel scheduler; do cat src/$d/*.ts \| wc -l; done`，观测锚点见文首 |
| ccloop 靠 `ORCA_CCLOOP_BIN` 而非 npm 依赖 | `grep -rn ORCA_CCLOOP_BIN src/` ＋ `package.json` 的 `dependencies` |
| `targetVersion` 三处分歧 | `src/control/webProtocol.ts`／`src/control/schema.ts`／`src/control/types.ts` |
| ccloop `capabilities` 只答七个字段、缺五个 | ccloop `src/control/command.ts` 的 `method === "capabilities"` 分支 ＋ Orca `src/control/webProtocol.ts` 的 `capabilityViewSchema` |
| `orca-raw-command-v1` 的 `commandId`／`expectedRevision`、`graph-change-needs-handoff` | `src/control/webProtocol.ts:638-646`、`src/control/commands.ts:66,72`、`src/control/errors.ts:91`（**本会话现读**） |
| 任务契约的旋钮与 `autonomyLevel: "L2"` 字面量 | `src/scheduler/planFile.ts` 的 `taskContractSchema` |
| litellm 逐次成本头 | `litellm/proxy/common_request_processing.py:1516` 起（**本会话现读**） |
| litellm 算不出价返回 None、spend 记 0 | `litellm/litellm_core_utils/litellm_logging.py`、`spend_tracking_utils.py`（subagent 调研，**未由本会话逐行复核**） |
| openclaw Gateway WS 协议与 npm E404 警告 | `/Users/biran/code/skills/agent/openclaw/docs/gateway/protocol.md`（**本会话现读**） |
| A2A v1.0.0 的方法集／状态机／能力字段 | https://a2a-protocol.org/latest/specification/ ；https://github.com/a2aproject/A2A（subagent 调研） |
| MCP Tasks 是扩展、TTL 可丢弃 | https://blog.modelcontextprotocol.io/posts/2026-07-28/ ；https://modelcontextprotocol.io/extensions/tasks/overview（subagent 调研） |
| syncskill 的命令面与三个缺口 | `/Users/biran/code/skills/syncskill` 的 `src/index.ts`、`src/config/config.ts`、`src/core/manifest.ts`（subagent 调研） |
| opencode 的 server＋SSE＋session id 形状 | `/Users/biran/code/skills/agent/opencode` 的 `packages/protocol/src/groups/session.ts`、`packages/server/src/handlers/event.ts`（subagent 调研） |

⚠️ 标了「subagent 调研」的条目**本会话没有逐行复核**（Rule 14：只报拿得到的）。
**在它们成为某个设计的承重前提之前，先自己现读一遍。**


---

## 8. 人裁记录（2026-09-22，会话 `da2f5e9a`，在主题行 `docs(goal): write down what we are building, and point the handoff at it` 那一笔之上）

> 本节**取代 §5 的「待裁」状态**。§5 的表格原文逐字保留。
> ⚠️ **以后引用这六件事，引本节的裁决编号，不要再引 §5 的「待裁」。**

### G1 —— control v1 的线上契约**归 ccloop（生产方）**

Orca 作为消费方引入；**Orca 自己的 Web 协议留在 Orca**。

⇒ **推翻本文 §3.1 的一句话**：那里写的是「按 §3.9 已拍的『保持 TS、不轻易拆仓』，**子包的默认值更合身**」。
**那句现在为假。** 让它为假的理由是子包会让 **ccloop 反向依赖 Orca**，与 spec §9
「ccloop 不需要知道 Orca 存在」直接冲突；而归 ccloop 时依赖方向与 spec §9.1 一致，
**且根因（消费方单方面定义协议、生产方人肉追平）就此消失**。

⚠️ **边界必须写死，否则这条裁决会被扩大解释**：
**只搬 ccloop↔Orca 的线上契约**（control 方法集、capability 词汇表、start envelope、usage／evidence 的形状与版本）。
`work item`／`group`／`orca-raw-command-v1`／`expectedRevision` **一律不搬** —— 那是 Orca Panel ↔ Orca Web 的内部契约。

⇒ **对近期那两件事的影响（这条是本裁决最实际的后果）**：
- 那五个缺失的 capability 字段**不再是「ccloop 追平 Orca 的清单」**，而是
  **ccloop 在自己的契约里定义、Orca 跟随**。派活之前要先在 ccloop 侧把词汇表定下来。
- `targetVersion` 属于线上契约 ⇒ **由 ccloop 定型**，Orca 那三处（`webProtocol.ts`／`schema.ts`／`types.ts`）跟随。
  **这同时就是 handoff 里挂着的那条「改哪一侧」的答案的前提** —— 但具体定成字符串还是安全整数，
  **仍要在 ccloop 侧单独拍一次**，本裁决只定了「谁有权拍」。

### G2 —— `level`／`checkpoint`／`gate` **留在 Orca**

§3.1 职责表里那行「🟠 待裁 G2」就此读作 **Orca**。理由：它们消费 Orca 的 checkpoint 格式与台账，
搬家是真成本，而「它们服务的是 agent 会话」目前只是概念上的不适，**没有量到实际代价**。
⚠️ 若将来量到了（例如 §3.9 那条 hook 启动延迟的触发条件被触发），**重开这条时引 G2 本身**。

### G3 —— `orca chain` 是 **Orca 自用的开发循环，不是产品能力**

不进 §3.3 的 loop 方案层，不对外做承诺。「把一件事跑成循环」这个岗位**完整留给 ccloop**。
⇒ §3.1 职责表里那行「🟠 待裁 G3」就此读作**自用**。

### G4 —— 完成度口径 ＝ **已完成 task 数／总 task 数，＋ 在跑任务的 `attempt n/maxAttempts`**

主口径从任务图直接数（零歧义、零新数据）；在跑的任务另给一条 attempt 进度。
**UI 上必须明写「不反映难度差异」。** §3.4 的三个候选就此收敛，**G4 那一行的 🟠 变 🟢**。
⚠️ **共同约束不变**：代码算，不许模型估（Rule 14）。

### G5 —— **syncskill 补三件**（profile／清单、按 run 注入、版本记录）

⇒ **§3.6 的 (ii)「Orca 只用它做机器级基线」作废。**
⚠️ *** **这条裁决新增了一笔此前不在任何路线上的跨仓成本：syncskill 要开一轮实施。** ***
落在 §4 中期第 9 项。开工前请注意两条现测事实：
它的源**只记 branch、不记 commit**（`src/config/types.ts` 的 `SourceConfig`），
且**没有库 API**（`package.json` 只有 `bin`）—— 版本记录要从零定义，注入只能 spawn CLI。

### G6 —— A2A **只做只读状态外壳**

把 ccloop 的 run 映射成 A2A Task 暴露出去，**控制仍走 control v1**。
§4 远期第 10 项的条件（「若 G6 通过」）**就此满足**，该项由候选转为已定方向。

---

### 这六条裁决之后，§4 分期的两处更新

| §4 原文 | 更新为 |
|---|---|
| 近期第 3 项「在做 1、2 的同时决定 G1」 | **G1 已定** ⇒ 近期的形状变成：**先在 ccloop 侧立契约（含 capability 词汇表与 `targetVersion` 定型），Orca 再跟随**。顺序反过来做会白改一次 |
| 中期第 9 项「按 G5 的裁决选 (i) 或 (ii)」 | **选 (i)** ⇒ 中期多一项：**syncskill 的三件实施**，它是本轮唯一新增的跨仓工作量 |

**§6「明确不做」不受这六条影响，一条未变。**

---

## 9. 对齐：做了什么、离本文多远（2026-09-28，会话 `292277d5`）

> **归属**：会话 `292277d5`（Claude Code 交互会话）；2026-09-28；观测锚点＝主题行
> `docs(handoff): record the review preparation, the numbered checklist the human answers against, and two lessons` 那一笔。
> 下表每一格都用 python 扫过 `src/`、`web/src/`、`scripts/` 现测，**引用前请再测**。本节不改上文。

### 9.1 本文 §4 分期的现状

| 本文条目 | 现状 | 差距 |
|---|---|---|
| 近期 1：`targetVersion` 那条缝 | ✅ G1 缝 B 做完（2026-09-25）：正安全整数，ccloop 定型 | — |
| 近期 2：ccloop 补 capability 字段 | ✅ 缝 A 做完（v2 八字段），之后协议又升到 3，加了 `singleCallExecution` | — |
| 近期 4 的终点：「Web 派活到真 ccloop 能开出一个 run」 | 🟡 **部分**：真 codex、真 claude 的单任务主链各跑通过一次（n＝1），但走的是服务层，**没经过 HTTP** | 面板 HTTP 这条路没在真 agent 下跑过 |
| §3.9 的「ccloop 走 npm 依赖锁版本」 | ❌ 没变。`package.json` 的 `dependencies` 仍然只有 `express`、`zod`，执行端仍然靠 `ORCA_CCLOOP_BIN` | 仍然是已知缺口 |
| 中期 5：§3.3 loop 方案层 | ❌ **零代码**。`planFile.ts:159` 仍是 `autonomyLevel: z.literal("L2")` | 整层没开 |
| 中期 6：§3.4 看板 | 🟡 面板重做完了（`web/src/sections.ts`：decisions／chains／tasks／metrics），tasks 有「needs attention」红点 | **G4 完成度（完成数／总数，外加 attempt n/max）没做**；依赖关系图没画；git 方案没显示 |
| 中期 7：§3.2 给 agent 的接口（HTTP／MCP） | ❌ 零代码。面板有 `/api/control`，但那是面板自用的，不是面向 agent 的接口 | 整条没开 |
| 中期 8：§3.5 litellm | ❌ 零代码（全树 0 命中） | — |
| 中期 9：§3.6 syncskill（G5 选了 (i)） | ❌ 零代码，syncskill 那一轮也没开 | — |
| 远期 10：§3.7 A2A 只读状态外壳（G6） | ❌ 零代码 | — |

### 9.2 做了、但本文没写的（都来自 spec `2026-09-19-web-recoverable-control-design.md` 这条线）

执行驱动；④ handoff 投递、续跑、N 路并行；agent 选择（claude／codex，分层偏好）；claude 中止前观测用量；⑤ 预算预估链（single-call 估算和「应用建议」）。
它们都属于北极星里「**掰得回来**」和「成本只报工具给出的数」这两条。**本文目标树里没有这个能力域，§10 N0 补上。**

### 9.3 一句话结论

**过去一周的投入几乎都花在控制面的可靠性上**（能停、能续、能记账、能估算）。本文目标树的中期能力一项都还没开。
而人新提的使用方式（§10 N1）要求的「需求 → 拆分」这一段，**目前完全没有**：Orca 今天吃的是人手写的 plan 文件（`src/scheduler/planFile.ts`），自己只做依赖和写集的校验。

---

## 10. 新诉求（2026-09-28 人提出，同日人裁，裁决见 §10.2）

> **归属**同 §9。每条格式：人原话要点 → 控制器的建议 → 判定（四档词汇同 §0）→ 待人裁的点（编号 G7 起）。
> 人对 N1、N3 的补充意见已并入正文；G7–G11 的裁决见 §10.2。**以后引用时引 §10.2 的编号。**

### N0 目标树补一个能力域：控制面（停、续、记账、预估）

把 §9.2 那五件归进来，写成 3.10。**判定：🟢 已大部分落地**，剩下的是 A 线（真 claude 下的依赖、handoff、混 kind、n＞1）和 §9.0e 的挂账。

### N1 主要使用方式：提想法 → Orca 确认需求 → 拆成串联／并联的 task → 实现（**人已同意**）

- **分工**（Rule 5）：
  - **模型做判断题**：追问、澄清需求，起草拆分方案（task 列表、每个 task 的验收判据、写集的声明）。
  - **代码做校验**：拆分方案必须能展开成今天的 plan 文件（`planFile.ts` 的 schema），然后照常走 `graph.ts` 的依赖判定和写集冲突判定。串联还是并联**由代码从依赖和写集算出来**，不由模型宣布。
  - **人确认**：拆分方案出来后停一次，等人确认。确认沿用已有的 confirm 路径。
- 概念映射：**一个需求 ＝ 今天的一个 group**。「需求 → plan」是新增的一段，plan 之后的链路一律复用。
- **追问怎么做**（人要求参考 mattpocock-skills 的 `productivity/grilling`、`productivity/grill-me`、`engineering/grill-with-docs`，路径在 `/Users/biran/code/skills/mattpocock-skills/skills/`）。借它们的四条思想：
  1. **把需求当设计树，按轮次推进。** 每轮只问「前沿」上的问题，即前提已经定下来的问题。每题编号，并附上推荐答案。依赖本轮其他未答问题的，留到下一轮再问。
  2. **事实自己查，决策交给人。** 能从目标仓库的代码、文档、台账里查到的，由 Orca 自己去查（派子代理），不问人。只有真正的决策才交给人。
  3. **前沿问空才算结束**：设计树的每个分支都走过，没有被默认掉的假设。**人明确确认「已达成共识」之前，不进入拆分。**
  4. **边问边落文档**（grill-with-docs ＝ grilling ＋ domain-modeling）：
     - 术语一旦定下来，就写进需求文档的术语表。术语表只放术语，不放实现。
     - 只有同时满足「难以逆转」「没有上下文会让人意外」「是真实的权衡」三条时，才写一条决策记录（ADR）。
- **落到 Orca 的形状**：
  - 每一轮问答是一条持久化的记录，走现有的命令模型（`commandId`、`expectedRevision`），可以断点续答；
  - Web UI 按轮渲染「问题 ＋ 推荐答案 ＋ 人的回答」，别的 agent 走 N2 的 CLI 答；
  - 前沿怎么算是模型的判断，但「这一轮问了什么、人答了什么、人确认过共识没有」**全部由代码记录和判定**。
- **产物（G7 已裁：要）**：一份单独的需求文档，内容是需求陈述、术语表、问答记录（按轮次）、决策记录、验收判据。**拆分方案引用它**，每个 task 都能追溯到文档里的某一条。
  - 放哪里：按 §3.1「Orca 能对任意目标仓库工作」和台账住在目标仓库的原则，**建议放在目标仓库**，与 `.decisions/` 相邻。具体路径与格式在 N1 的 spec 里定。这一点可逆，由控制器先定，写进 spec 时报人。
- 参考：deepseek-harness 的 `packages/experimental/agent-team/src/types.ts:74` `TeamTaskSnapshot`（`blockedBy` 无环依赖、`writeScopes` 前缀、`revision` CAS）和 Orca 的任务图几乎同构，可以拿来对照查漏。它的 `dsh-workflow` 让模型现写脚本决定串并，**违反 Rule 5，不借**。
- **判定：🟡 需要前置**：前置是 §3.3（验收判据要有模板可套）和 N8（标签决定用哪个模板）。

### N2 控制入口：人用 Web UI；别的 agent 用 MCP，或 skill＋CLI

- 和 §3.2 一致，这里只补一个顺序建议：
  1. **CLI 加 `--json`**，复用同一套命令模型（`commandId`、`expectedRevision`，错误码原样透出）；
  2. **skill** 包一层 CLI，这是最便宜的 agent 入口，今天的 claude 和 codex 都能用；
  3. **MCP 薄壳**：只做读快照和投递命令（§3.2 的约束不变，run 不建模成 MCP Task）。
- **判定：🟡**，前置是 G1 已定的契约面，这条已经满足。实际上**现在就能开**。

### N3 进度：Web UI 和别的 agent 都能看到「这个 task 到哪了」「这个需求整体到哪了」，有百分比，能点进去看细节

- **百分比的口径沿用 G4，并且必须由代码算**：
  - 需求级 ＝ 已完成 task 数／总数；
  - task 级**不给一个假的百分比**，给**阶段**：plan → execute → verify，加上 attempt n/max 和已用预算占 grant 的比例（用量只取工具报的数）；
  - 点进去看细节：session 历史、阶段事件、evidence。
- **人问：HTTP ＋ SSE 有没有必要做，能不能先延后？控制器的结论：没有必要，延后。** 依据（2026-09-28 现读）：
  - 面板已经每 2 秒按 `changeSeq` 增量拉取控制面投影（`web/src/App.tsx:106`、`:233`、`:412`），缺口时会自动整份重读（`refetchRequired`）。对 Web UI 来说，这已经相当于一条增量事件流，SSE 只是把 2 秒的延迟压下来。
  - 阶段数据的来源本来就是 ccloop：Orca 用 `collect(afterSeq)` 按游标拉 ccloop 的事件。agent 的 headless 输出（claude `stream-json`）由 ccloop 的 runner 读取，并作为 attempt 日志和 evidence 保存下来，**点进去看细节时直接读这些现有的 evidence 就够了**，不用另开一条流。
  - ⚠️ headless 输出**只能覆盖「一个 agent 会话内部」**：需求级的进度仍然要由 Orca 的任务图算。codex 的输出格式和 claude 不一样，细节视图要分别处理。
  - ⇒ **现在要做的只有**：G4 完成度的计算、task 级阶段视图、从 evidence 读出细节。**SSE 和 A2A 投影都延后**，等到出现一个真正需要推送的外部消费方（N7 的 A2A server）再做。
- **A2A 能不能承载**（2026-09-28 调研，A2A v1.0.1，https://a2a-protocol.org/latest/specification/ ）：
  - 有 `TaskStatusUpdateEvent` 和 SSE，每个对象都带自由的 `metadata`；
  - **没有标准的百分比字段**，扩展索引里也没有官方的进度扩展（这是「没找到」，不是「spec 明说没有」）；
  - 惯用做法是自己定义一个 extension URI，把进度放进 `metadata`；需求级的汇总要用 `contextId` 分组后自己算；
  - `TaskArtifactUpdateEvent` 的 `append`／`lastChunk` 是产物分片，不是进度。
- **判定**：内部进度 🟢；SSE 与 A2A 投影 ⏸ 延后。

### N4 Slogan

原意：「leave it to orca，put your every idea to real」。「put … to real」不是地道的英文，候选：
- **Leave it to Orca — every idea, made real.**（推荐：保留原句的两段结构，最短）
- Leave it to Orca. Turn every idea into shipped work.
- Hand it to Orca — from idea to done.
- **G8**：选哪句。

### N5 Memory：Web UI 加一个 memory tab，第一版只接 ccmem，以后能接别的 memory 插件

- **建议的 adapter 层**（接口草案，名字待定）：
  - `MemoryAdapter { id; capabilities(); health(); search(query, { projectKey, limit }); get(ref); }`；
  - 写入口**只有一个**：`recordCorrection(sample)`，复用 `orca correct` 已有的样本形状（ccmem handoff §15 里「对照样本」的语义）。
- **约束**：
  - ccmem 一个字都不 vendor，走 CLI／DB 接口（spec §9.1）；
  - `projectKey` 沿用 `src/corrections/projectKey.ts`，**改算法要两边核对**（ccmem handoff 已登记这个风险）；
  - adapter 缺省路径必须从传入的 env 推，判据走改道后的目录（Rule 17）；
  - UI 第一版**只读**（搜索、查看、这条记忆由哪次 correction 产生）。
- **判定：🟡**，前置是 ccmem 的 CLI 能不能输出 JSON、支不支持按 `projectKey` 查，**没核过**，下一步要读 ccmem 源码。
- **G9**：memory tab 第一版要不要能写（人在 UI 上手动加或删记忆）？建议不要，写入只走 correction。

### N6 可以利用或借鉴的外部实现

| 来源 | 借 | 不借 |
|---|---|---|
| deepseek-harness（`/Users/biran/code/skills/harness/deepseek-harness`） | ① `agent-team` 的任务图形状与无环校验、CAS（见 N1）；② `subagent-claude-code`／`subagent-codex` 的失败分类和「原生配置为准、绝不 fallback」的纪律，可以拿来对照 ccloop 的 adapter 查漏；③ `workflow/phase`、`workflow/log` 的事件命名，作为 N3 事件流的词汇参考 | `dsh-workflow` 由模型写调度脚本（违反 Rule 5）；`token-meter` 的启发式 token 估算（违反 Rule 14）；整个 Cordis 插件框架（迁移代价远大于收益） |
| claude-code mods（`~/code/skills/agent/claude-code/mods/`） | ① 「一个 noun 一份契约类型、消费方引用不复制」的纪律；② 用每个 worktree 里的 `CLAUDE.md`／`AGENTS.md` 注入任务专属指令，这是 stock CLI 就有的行为，用不上 mod，可以接 §3.3 loop 方案 | mod 本身：`register(on)` 函数钩子是 early access（`mods/README.md:114`），`telemetry` 只服务 builtin tier，`sec-default` 用 `--plugin-dir` 加载时形同虚设。Orca 驱动的是 **stock CLI**，吃不到这些钩子 |

以上各条来自子代理读源码。其中 `agent-team/src/types.ts:74-82` 已由控制器现读核实，其余在成为某个设计的承重前提之前，要先自己读一遍。

### N7 A2A：Orca 要不要能控制别的 agent？Orca 要不要作为一个能被 A2A 控制的 agent？

- **Orca 作为 A2A server**（外部 agent 把需求交给 Orca，然后跟进度）：**建议做，排在远期**。
  - 映射：一个需求对应一个 `contextId`；「等人确认拆分」对应 `input-required`；进度照 N3 走 extension metadata。
  - A2A 不保证幂等（`SendMessage` 只是 MAY）、不保证断线重放、不保证任务保留期、取消只是协作式 ⇒ **Orca 内部仍然以自己的命令模型为真相**，A2A 只是一个入口。这和 G6 的精神一致：承重语义不塞进 `metadata`。
- **Orca 作为 A2A client 去控制别的 agent 当 worker**：**建议现在不做（🔴）**。
  - Orca 对 worker 的要求（幂等 accept、崩溃恢复、按 deadline 强制中止、usage 上报、证据 hash）A2A 一条都保证不了。这正是 G6 当初的理由。
  - 真要接 A2A agent，得在 ccloop 里给它写一个 adapter，并如实答 capabilities（多半是 `unavailable`）。
- TS SDK：`@a2a-js/sdk`，client 和 server 都有，已过 1.0。**版本号来自搜索摘要，接入前先 `npm view @a2a-js/sdk time` 现测**。
- **G10**：G6 当初只管 ccloop 对外暴露 A2A。现在的问题换了：(a) Orca 要不要作为 A2A server？(b) Orca 要不要作为 A2A client？建议是 (a) 做、(b) 不做。

### N8 Task 标签：可以带 bug、task、doc 等，一个 task 可以同时带多个

- **建议的初始词表**（闭集，改词表要走 schema 版本）：`feature`、`bug`、`refactor`、`test`、`doc`、`design`（spec／方案）、`investigate`（只读调研）、`perf`、`security`、`chore`（构建、依赖、CI）。
  人原话里的 `task` 太泛，建议不进词表：没打标签的 task 就是普通 task。
- **标签的用处**，都由代码消费：
  - ① 看板筛选；
  - ② 选默认的 loop 方案（§3.3），例如 `bug` → `bugfix-tdd`，`investigate` → `investigate-only`，`refactor` → `refactor-guarded`，`design`／`doc` → `spec-then-plan`。一个 task 有多个标签时，**按固定优先级表选**，不由模型选；
  - ③ 指标按标签切分。
- schema：plan 文件的 task 加一个 `labels: string[]`（默认空，**只增不改**，旧 plan 照样能读）。
- **判定：🟢**，是加法式改动；但接 loop 方案的那部分要等 §3.3。
- **G11**：词表就用上面这些，还是你要增删？

### 10.1 建议的先后（只排先后，不排日期）

1. **N8 标签**，加 **N3 内部进度**（G4 完成度、task 级阶段视图、从 evidence 读细节；**不做 SSE**）：数据都在，最便宜，马上让 UI 有用。
2. **§3.3 loop 方案层**：N1 和 N8 都依赖它。
3. **N1 需求 → 拆分**：真正改变使用方式的一步。
4. **N2 CLI `--json` → skill → MCP**。
5. **N5 memory tab**（只读，ccmem）。
6. 远期：**N7 (a)** Orca 作为 A2A server；§3.7 其余。

### 10.2 人裁记录（2026-09-28，会话 `292277d5`）

| 编号 | 问题 | 人裁 |
|---|---|---|
| **N1** | 需求 → 拆分的方案 | 同意。追问部分参考 grilling、grill-me、grill-with-docs 的思想（已并入 N1 正文） |
| **N3** | 要不要先做 HTTP ＋ SSE | 人：「你看有没有必要，如果没必要可以先延后」⇒ 控制器判定没有必要，延后（依据在 N3 正文） |
| **G7** | 需求澄清的结果要不要落成一份单独的需求文档 | **要** |
| **G8** | slogan | **先用 "Leave it to Orca — every idea, made real."** |
| **G9** | memory tab 第一版只读，写入只走 correction | **同意** |
| **G10** | A2A：Orca 做 server、不做 client | **同意，排在远期** |
| **G11** | 标签词表 `feature`、`bug`、`refactor`、`test`、`doc`、`design`、`investigate`、`perf`、`security`、`chore` | **同意** |

N0、N2、N5、N6 人没有提异议，按正文的建议执行。§10.1 的先后照旧。


---

## 11. 对齐：做了什么、离本文多远（2026-10-03，会话 `6a4dd7f3`）

> **归属**：会话 `6a4dd7f3`（Claude Code 交互会话）；2026-10-03；观测锚点＝主题行
> `feat(board): draw the dependency graph and show the git scheme from the drive records` 那一笔。
> 本节**取代 §9.1 的「现状」列**；§9.1 原文保留。每格都是现测：python 扫 `src/`、`web/src/`、`scripts/` 的关键字命中数，
> 加 `package.json` 的 `dependencies`。**引用前请再测。**

| 本文条目 | 现状 | 还差什么 |
|---|---|---|
| 近期 1、2（`targetVersion`、capability 字段） | ✅ 早已做完（见 §9.1） | — |
| 近期 4 终点：「Web 派活到真 ccloop 能开出一个 run」 | ✅ **会话 `16ab00f2`（2026-10-03）补上**：`scripts/live-panel-http-acceptance.ts` 起真 `orca panel`，全程经 HTTP（一次性 token）import→confirm→start，真 claude 下一个任务落地，21/21 检查绿，claude 自报 $0.545137，n＝1；台账 `.superpowers/sdd/2026-10-03-panel-http-live/progress.md` | 没覆盖：真浏览器、真 codex、经 HTTP 的预估与 handoff、多任务 |
| §3.9「ccloop 走 npm 依赖锁版本」 | ✅ `package.json` 的 `dependencies` 里有 `ccloop: github:blrbiran/ccloop#<SHA>`；重钉由 agent 做（人先推 ccloop） | — |
| 中期 5：§3.3 loop 方案层 | ✅ 两部分都做完（`src/control/loopPlans.ts`，五种方案，展开是纯代码）。`planFile.ts` 的 `autonomyLevel` 仍是 `z.literal("L2")`，方案层是在它外面套的 | git 方案这个维度契约表达不了，卡片上显示固定值（git 一行现在随工作区方式变，见下一行）；skill 集已由会话 `08b1007d` 接上（见中期 9） |
| 中期 6：§3.4 看板 | ✅ **本会话补完**：G4 完成度（`done/total` ＋ attempt n/max）和「需要处理」红点早已做完；本会话画了依赖关系图（`web/src/DependencyGraph.tsx`），加了 Git 区（工作分支 `orca/<组>`、每个 run 的工作区方式／起点／落地提交，合并进 main 与 push 显示为「等人」），loop 方案卡片的 git 一行改为随仓库的工作区方式变 | 登记未做：图上不画写集冲突；`orca/<组>` 是否已并入 main 或已 push 不显示；每个 run 的耗时（缺开始时间戳）。spec `docs/superpowers/specs/2026-10-03-board-graph-and-git-design.md` §5 |
| 中期 7：§3.2／N2 给 agent 的接口 | ❌ 零代码。CLI 的 `--json` 只有 `orca metrics` 一处；控制面命令没有 CLI 入口；MCP 0 命中 | 整条没开（顺序仍是 CLI `--json` → skill → MCP 薄壳） |
| 中期 8：§3.5 litellm | ❌ 零代码（`litellm` 全树 0 命中） | — |
| 中期 9：§3.6 syncskill（G5 选 (i)） | 🟡 **syncskill 侧做完（会话 `16ab00f2`，2026-10-03）**：`profile set\|ls\|rm`、`inject --profile\|--skills --target`（快照＋`syncskill-lock.json`）、git 源记 `resolved_commit`；spec 在 syncskill 仓 `docs/superpowers/specs/2026-10-03-profile-inject-version-design.md` | ✅ **Orca 侧接入做完（会话 `08b1007d`，2026-10-03，等人审）**：loop 方案可声明 `skills`（名单或 profile），确认时冻结进执行快照；每个 run 在 A2 调 `syncskill inject` 到 `<workspacesRoot>/skills-<runId>`（git 工作区之外、做成 claude plugin、只读），锁信息记在 drive 记录里、不进落地提交；ccloop 给这种 run 的 claude 加 `--plugin-dir`、去掉 `--disable-slash-commands`。spec `docs/superpowers/specs/2026-10-03-syncskill-integration-design.md`（§10、§11 优先）。只在 fake claude 与离线探针下验过，**没在真 claude 付费跑过**；codex 不支持（下一轮） |
| 远期 10：§3.7 A2A 只读外壳（G6）／N7(a) Orca 作 A2A server | ❌ 零代码（`a2a` 0 命中） | — |
| N8 标签 | ✅ `src/control/labels.ts`，闭集词表按 G11 | — |
| N3 内部进度 | ✅ 需求级 `done/total`、task 级阶段＋attempt＋token 占比、点进去看 evidence；SSE 与 A2A 投影按裁决延后 | — |
| N1 需求 → 拆分 | ✅ 第一版（`src/control/requirement*.ts`，面板「需求」分区） | 第二版（handoff 里挂着） |
| N5 记忆区 | ✅ 第一版只读，接 ccmem（`src/memory/`，面板「记忆」分区），三条搁置的小项也做完了 | — |

**一句话**：§10.1 排的前五项里，除第 4 项 N2 以外都做完了（N8＋N3、§3.3、N1、N5），§3.4 看板本会话补完；**剩下的大件是 N2（agent 入口）、
§3.5 litellm、§3.6 syncskill、A2A，以及「面板 HTTP 这条路在真 agent 下跑一次」这条近期验收**。
（会话 `16ab00f2` 补记）面板 HTTP 真 agent 验收已跑通一次；syncskill 补三件已在 syncskill 侧做完。（会话 `08b1007d` 补记）Orca 侧接入也做完了，等人审；codex 的 skill 支持留到下一轮。
