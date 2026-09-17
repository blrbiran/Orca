# D 检查点交接 —— 让交接本身不需要人

**状态**：**设计草稿**，**尚无实现计划**。人在会话里**明确同意过**的：§1 对象、§3 分层、§6 的三刀范围与「拉起下一个会话」的排序。
**已提出、未单独确认**：§4 触发规则的修订版、§5 交接链 —— 二者与排序问题同在一条消息里提出，人的回复针对的是排序。§7 是未决项。下一会话从这里继续对齐。
**归属**：run `orca-dev-bd5f202b`（2026-09-17）。上游：主 spec `2026-08-29-decision-ledger-design.md` §2.2、§2.3、§8。
**观测锚点**：凡本文实测值，除另注外均在 Orca `64cae37` 上测得；外部运行时的锚点逐条写在 §2。

**明确不做**：
- 不改 ccloop（主 spec §7；调度 spec `2026-09-03-scheduler-design.md`:395「先报『要改什么、为什么非改不可』」；E1 仍在授权面外）。ccloop 阶段 agent 的交接见 §1.2 的重开条件。
- 不写实现计划、不动 `src/**`。
- 不迁移现有 `docs/handoff/handoff.md` 的存量（属 D3，§6）。

---

## 0. 问题

**人 2026-09-17 原话**：「使用 orca 的主要目的是尽量减少每次对人的打扰（将人从任务工作／循环的当下现场摘出来）」。

历史上的交接**都由人完成**（本轮以 grep 普查 spec、`.superpowers/sdd/**`、handoff、`.decisions/**`，**未发现例外**；普查不是穷举）：
agent 写 handoff 并建议新开会话 → **人**开新会话、贴开工 brief → **人**在两轮之间推提交 → 有时**人**决定在哪一刻切
（handoff.md:1502-1503「本会话写完台账就交接……理由是上下文水位（钩子报约 254k/450k）」；
handoff.md:3488 的 H6「把剩下的所有 task 跑完再停」使 R46 接受越过 450k）。
brief 本身也会过期（handoff.md:3951）。水位读数**时有时无**：有一轮由钩子报过（上引 :1503），另一轮写着「没有工具报数」（:3574）——
**一直没有一个稳定、Orca 能读、失败时会出声的读数**。

⇒ *** **打扰不在「agent 没察觉水位」，在「交接的每一步都要人亲手做」。** ***
D 的目标：**水位由代码判、检查点由 agent 写、开工核对由代码做、下一个会话由代码拉起；人只在已有裁决要求人的地方出现，且不阻塞链条。**

---

## 1. 对象

### 1.1 先服务「开发会话」

指像本会话这样、在某个仓库里连续工作、会涨满上下文的 agent 会话。理由：
1. 痛点是量出来的，就在这里（§0）；`.decisions/` 下已有 20 份 `orca-dev-<会话>.jsonl` ⇒ 开发会话**早已被当作 Orca 的 run 记账**，D 服务它与台账／面板／指标同口径。
2. **handoff 的读者是下一个 agent，不是人**（人 2026-09-17：「handoff 本来也不是给人读的」）。见 §6 与主 spec ERRATUM 6。

### 1.2 ccloop 阶段 agent：暂不做，登记重开条件

现测（Orca `64cae37`，ccloop 源码只读）：
- Orca `ccloopRunner.ts` spawn ccloop 后只缓冲输出，**退出后**才读 `loop-state.json` 的 `status` 与 attempt ref。
- ccloop `scripts/claude-phase-runner.mjs:381-396` 每个阶段起一个新的 `claude -p --output-format json`；ccloop 的 src／scripts／tests 里 `stream-json`、`--resume`、`--session-id`、`cache_read_input_tokens` **零命中**（grep RC=1）。
- ccloop 记的 token 是 input+output，**不含 cache**（`scripts/claude-phase-runner.mjs:94`）。

⇒ 没有长寿的会话可交接；阶段间状态已在 run 目录。**重开条件**：实测到某个阶段的单次 `claude -p` 接近 §4 的阈值。

---

## 2. 可行性实测：运行中会话的窗口占用能被代码读出

### 2.1 Claude Code（**已对照验证**）

transcript `~/.claude/projects/<cwd 编码>/<session>.jsonl` 中，最近一条主链 assistant 消息的
`usage.input_tokens + cache_read_input_tokens + cache_creation_input_tokens`：

| 时刻 (UTC) | 来源 | 读数 |
|---|---|---|
| 2026-09-16T18:25:33Z | transcript 最后一条主链消息 | **201,451** |
| 紧接其后 | 人执行 `/context`（不发起 API 调用） | **201.5k / 1m** |

测量命令：scratchpad 下一次性探针 `probe_transcript.py <transcript>`（按行 `json.loads`，取 `type=assistant` 且 `usage` 非空的行，只打印数字）。
性质：**同一个 msg id 占多行**（每个内容块一行）；**滞后一次调用**（本会话单轮实测涨过 20,693）。

statusline 的 stdin 也带 `context_window`（本机已装插件代码引用了 `context_window_size`／`current_usage`／`used_percentage`／`remaining_percentage`），
但**只送给唯一一个配置的 statusline 命令**；本机配的是 `omc-hud`，ecc bridge 里 `context_remaining_pct` 现测为 `null`。走这条路要改人的全局配置 ⇒ 不选。

**本机已有同类实现（先例 ＋ 反例）**：ecc 插件 `scripts/hooks/suggest-compact.js`（本机 ecc 2.0.0）挂在工具调用钩子上，
从钩子 stdin 的 `input.transcript_path`（:212）取 transcript，读最近一条 `usage`（:171），按窗口比例定阈值，
本会话里实际触发过（「[StrategicCompact] Context ~290k tokens (29% of 1M window)」、「~319k (32%)」）。
- **先例**：它间接证明 Claude Code 钩子的 stdin 带 `transcript_path`（否则它按自己的注释会静默不触发）。**未直接看过 stdin 内容**，见 §7 第 4 项。
- **反例**：其注释（:166）写明「any transcript or state-file failure **silently disables** the suggestion」—— 正是 §4 禁止的坏法：格式一变，它就永远不响，且无人知道。

### 2.2 其余四个运行时（只读 spike，关键引用已抽查）

| 运行时 | 锚点 | 记录 | 当前占用 | 含 output | 外部认会话 | 可注入上下文的手段 |
|---|---|---|---|---|---|---|
| Codex | 装 0.149.1；源码 `6478a751fd`；本机记录最新出自 0.145.0 | JSONL，逐条 flush | `event_msg/token_count` 的 `last_token_usage.total_tokens`（cached 含在 input 内；`tui/src/token_usage.rs:37-41`） | **含** | `CODEX_THREAD_ID`／`CODEX_SESSION_ID`（`protocol/src/shell_environment.rs:6-7`）；钩子 stdin 有 `transcript_path` | PostToolUse 等钩子返回 `additionalContext`（钩子须被信任） |
| opencode | 装 1.18.3；源码 `dc4449df0d`（1.18.25） | **SQLite（WAL）** | `tokens.input + cache.read + cache.write`（`acp/usage.ts:86-88`）；step-finish 时覆盖写（`session/processor.ts`） | 不含 | 无内置变量，须插件经 `shell.env` 导出 | 插件 `tool.execute.after` |
| pi | **未安装**；源码 `853a80d26` | JSONL，同步追加 | 自身口径 `totalTokens ‖ input+output+cacheRead+cacheWrite`（`core/compaction/compaction.ts`）；分项齐全 | 自身口径**含** | `PI_SESSION_ID`／`PI_SESSION_FILE`（`core/tools/bash.ts:185,187`） | 扩展 `sendMessage`（steer） |
| oh-my-pi | 装 17.2.10；源码 `33cc6b9a04`（18.0.10） | JSONL，可能原地整份重写 | `contextSnapshot.promptTokens − historyRewriteTokensRemoved`（本机 1 份记录实测 191+49408=49599） | 不含 | 终端 breadcrumb（同终端多实例失效） | 扩展 `sendMessage`／钩子 |

⚠️ **版本错配**：源码 commit 与本机安装版本不一致的四处，结论只到「源码如此」。

⚠️ **spike 的一个副作用（如实登记）**：opencode 那一席第一次以 `?mode=ro` 只读打开数据库时，
`~/.config/opencode/opencode.db-shm` 的 **mtime 被改动**（WAL 模式即使只读也映射该文件；内容未写）。此后改用 `immutable=1`。
⇒ *** **只读打开 SQLite 不等于零触碰；而 `immutable=1` 可能看不到尚在 WAL 里的新行。** *** 见 §7。

---

## 3. 分层

| 层 | 职责 | 与运行时 |
|---|---|---|
| **核心** | 读数形状、阈值判定、检查点格式、开工核对、队列 | 无关；全部是文件 ＋ `orca` CLI |
| **读数适配器** | 从该运行时的会话记录算出一次读数 | 每运行时一个 |
| **送达垫片** | 在该运行时的钩子／插件里调用核心命令，把返回文字**原样**注入会话 | 每运行时一个，**不含判断逻辑**（Rule 5） |
| **启动适配器** | 以无头方式拉起下一个会话并交给它检查点 | 每运行时一个；**硬依赖 §6 的 Tier 0 闸门** |

### 3.1 读数形状

```
Reading   = { runtime, sessionRef, promptTokens, outputTokens, windowTokens, compactionReserveTokens?, observedAt }
level     = promptTokens + outputTokens      // 保守估计：下一次调用可能要带上的量
NoReading = { runtime, sessionRef, reason }  // 绝不以 0 代替
```

- 统一取「上一次调用的 prompt ＋ output」：五家都能从分项算出，且比只取 prompt 少滞后一个 output。
  ⚠️ **是保守估计，不是下界**：reasoning／thinking 输出未必被带进下一次调用（opencode 的 `output` 本就不含 reasoning，`session/session.ts:371`），`level` 可能高估。偏高只会让提醒早到，方向是安全的；是否需要扣除，归 §7 第 7 项判据去量。
  ⚠️ **口径注意**：§2.1 与 `/context` 对照的 201,451、§8 的 279,813 都是**只算 prompt** 的读数；按本节定义的 `level` 会再高出该次调用的 output。
  「`level` 与运行时自报数一致」这件事**未被对照过**，属 §7 第 7 项判据的范围。
- **需要窗口大小**（早稿写的「不需要」是错的，与 §2.2 自己的数据矛盾）：Codex 记录里现测 `model_context_window` = **258,400**（同一会话中途也出现过 353,400），
  **小于** 330K 阈值 ⇒ 阈值永不触发，运行时先自行压缩。opencode 同样按可用上限自行压缩（`session/overflow.ts:10-33`）。
  ⇒ `Reading` 增加 `windowTokens`（与 `compactionReserveTokens`，拿不到则缺省）；生效阈值见 §4。**窗口拿不到 ⇒ `NoReading`，不许默认当 1M。**
- **哪些记录不是读数由适配器负责**，核心只收 `Reading | NoReading`。已知清单：压缩后的估算值（Codex、opencode 摘要消息、omp 历史改写）、报错时全 0 的 usage（omp）、子 agent／侧链、同一文件混多个会话（Codex resume）、分支树（pi／omp 要从叶子回溯）、同 msg id 多行（Claude Code）。

---

## 4. 触发规则

| 水位 | 注入给 agent | 性质 |
|---|---|---|
记 `usable = windowTokens − (compactionReserveTokens ?? 0)`，生效阈值 `T1 = min(330,000, usable)`、`T2 = min(450,000, usable)`
（当 `usable` 压低了阈值、使 T1 与 T2 重合时，按 T2 处理；T1 与 T2 的间距如何保留，归 §7 第 8 项）。

| 水位 | 注入给 agent | 性质 |
|---|---|---|
| < T1 | 不注入 | |
| ≥ T1，且**没有覆盖当前水位的检查点** | 「**现在就写检查点**」，附实时读数 | 提醒 |
| ≥ T1，且已有覆盖当前水位的检查点 | 不重复要求写；只附实时读数与该检查点的位置 | 知会 |
| ≥ T2 | 「已越过会话上限：立刻写检查点并交接；本次越界会记入检查点」，附实时读数 | 越界，如实记录（Rule 6「Surface the breach」） |
| `NoReading` | 「水位读不到：<reason>」 | 每次都报，不静默 |

- **阈值数值**取自 Rule 6（单位是上下文窗口占用），放仓库配置、默认即此二值；改切分节奏 ＝ 改配置，留痕，不临场裁。
  ⚠️ 把 Rule 6 的「Per-task 330K」用作「写检查点」线，是本文的**设计选择**，不是 Rule 6 字面；主 spec §8 已记人给的经验区间 300K–450K 与之重合。
- **电平触发**：每次工具调用后判一次。「是否已有覆盖当前水位的检查点」**从检查点文件本身判**，不另开去抖状态文件 ——
  早稿只有「越线后每次都注入『写检查点』」，而本轮不做自动拉起，agent 写完检查点后很可能继续工作（H6 那种情形），
  同一句要求会无限重复直到被学会忽略。
- **330K 就写**而不是「做完这一步再写」：人不在场，没人替它判「这一步」多大；留 12 万余量是为了在上下文宽裕时写，而不是被逼成摘要（Rule 14）。
- **越过 450K 不强制中断（v1）**：拦截工具会连写检查点、提交、现测一并拦住。先记录并统计「agent 未遵从提醒」的频率，量到需要再加强制（与 E4「由实测阈值触发」同法）。
- **滞后与余量**：读数滞后一次调用，而单次调用的增量**没有已知上限**（20,693 只是本会话**一次**观测，读大文件、收子 agent 报告都可能远超它）。
  ⇒ 在 T1 越线一次调用的量**无害**（其后果只是提醒晚一次）；在 T2 越线的那一次调用**如实记为越界**，不声称能避免。
  **不另设余量**的理由仅此，早稿「两阈值之间 12 万远大于单轮增量」的论证不成立，已删。

---

## 5. 交接链与人的边界

| 步 | 谁 | 内容 |
|---|---|---|
| 1 判水位 | 代码 | §3、§4 |
| 2 写检查点 | agent | 只写判断部分（下一件事、未决项）；实测值存 `{命令, 值, commit}`（主 spec §2.2） |
| 3 拉起下一个会话 | 代码 | 启动适配器（§6 排序后实施） |
| 4 开工核对 | 代码 | 重跑实测、判过期、现测发布状态 —— 替代人贴 brief |
| 5 需要人的东西 | 进**异步队列**，不阻塞 | 见下 |

**只在已有裁决要求人的地方碰人，本文不新增：**
- **四件不可逆动作**（Rule 15）：链条永不代做，也不延续任何批准；检查点只列出「未推的提交、待点头的事」进队列。
- **势均力敌的证据**（Rule 7／主 spec §1.1 闸门 B）：记下进队列，链条转去做其它可逆工作。
- **改既有生产代码或承重判据之前的具名授权**（handoff.md:2519「correction seam 是改既有生产代码，需人另拿一次具名授权」；
  :2852 控制器拒绝把一句泛泛的「同意」当成它；台账 `orca-dev-c1c3c2ec/13`、`/15`）：拿到之前，链条不得开工该项；列进队列并注明「待具名授权」。
  ⚠️ **早稿漏了这一类**：只列 Rule 15 与 Rule 7，链条会把它当作可自决的普通工作做下去。
- **改 ccloop**（调度 spec :395）：同上，先报「要改什么、为什么非改不可」，进队列。

**链条何时停**：目标完成，或剩余每件事都卡在人 ⇒ **此时通知人一次**。
**「最后阶段报给我审核」的边界**：历史上该授权只管「这一轮」且不延续 ⇒ **一条链 ＝ 一轮**：人在链开始时授权一次，链结束时统审一次。

---

## 6. 分刀与顺序

| 刀 | 内容 | 本轮 | 对人的打扰 |
|---|---|---|---|
| **D1 水位** | 核心读数与判定、Claude Code 读数适配器与送达垫片 | **计划并实施** | agent 自己知道该交接 |
| **D2 检查点与开工** | 检查点格式；一条开工命令完成核对 | **计划并实施** | 每次交接降到「敲一条命令」 |
| **前置：Tier 0 闸门** | 无人值守会话在机制层拦住 push、合并 main、删分支／worktree，每运行时各一份 | 下一轮 | —— |
| **D-launch 拉起下一个会话** | 启动适配器 | 前置落地后 | 每条链一次 |
| **D3 交接职责迁移** | 把手写 handoff 的职责迁到检查点（**检查点本身就是 handoff**，不再生成「人读版」） | 后续 | —— |

**为什么 Tier 0 闸门必须在 D-launch 之前**（现测）：`core.hooksPath` 为 `scripts/githooks`，其下只有 `pre-commit`（台账只追加、CLAUDE.md 行数）；
`scripts`／`src` 里 `pre-push`／`git push` **零命中**，本仓库**没有** `.claude/` 目录。
全局 `~/.claude/settings.json` 的 `permissions.deny` 现测只有 `git clean -fd*`、`git reset --hard*`、`git checkout -- .`、`git restore .`，**无任何 push／merge／分支删除规则**；
同文件配置了 `autoMode`，且 `skipDangerousModePermissionPrompt: true`，本会话即运行在 auto mode 下。
⇒ *** **机械闸门不是「无头时才缺」，而是【今天就不存在】。** *** 交互会话里 push 会不会被拦，取决于 auto mode 的判定 —— **未现测**。
四件不可逆动作今天实际靠的是「agent 遵守 Rule 15 ＋ 人在场」。无头拉起会拿掉后者，只剩前者，正是主 spec §0 所诊断的失效。
（早稿写的「今天守得住靠交互会话的权限弹窗」没有证据，已删。）
⚠️ **仅加 git `pre-push` 钩子不算闸门**（`--no-verify` 可绕过）；须在运行时的权限层（如 Claude Code 权限 deny、Codex 沙箱）拦。

---

## 7. 未决（下一会话继续对齐）

1. **检查点的格式与住处**：仓库内（随提交走、多 agent 按 run id 单写者）还是仓库外（须按 Rule 17 改道并登记）；与 `.decisions/` 的关系。
2. **异步队列住哪**：复用面板「未审高位决策」待办，还是另起；SDD 的 `Ruling:` 行如何进入。
3. **开工命令的行为细节**：重跑哪些实测、过期如何呈现、发布状态怎么报。
4. **Claude Code 钩子 stdin 是否带 transcript 路径**：**间接证据支持**（§2.1 的 ecc `suggest-compact.js` 读 `input.transcript_path` 且在本会话触发过）；**直接现测仍欠**（亲眼看一次 stdin 的键）。
5. **SQLite 读法**（opencode）：`mode=ro` 会动 `-shm` 的 mtime，`immutable=1` 可能漏 WAL 中的新行 ⇒ 二选一的代价需人或实测定。
6. **v1 只实现 Claude Code 的适配器**，接口按 §2.2 五家定；第二个实现何时补。
7. **判据（Rule 4）**：读数适配器的判据以真实 transcript 的脱敏夹具为输入（只保留 usage 数字与结构键），每个「不是读数」的类别各配一条必抓样本；「读不到」路径与每个 `finally` 各点名一条删掉它自己的变异。具体清单随计划定。
   另需对照一次：`level`（含 output）与运行时自报数的差，以决定 reasoning／thinking 输出是否扣除（§3.1）。
8. **窗口压低阈值时的形状**：`usable` 小于 450K 时（如 Codex 258,400），T1 与 T2 的间距怎么留（按比例？固定差？）；运行时压缩余量各家取哪个值。
9. **Claude Code 的 `windowTokens` 从哪来**：transcript 不记窗口大小；候选是按模型标识解析（ecc 的 `resolveContextWindowTokens` 是先例）或 statusline 的 `context_window_size`（后者要改全局配置，§2.1 已不选）。
10. **「覆盖当前水位的检查点」的判定**（§4）：检查点里记下写入时的水位与会话标识，还是按提交；与第 1 项一起定。

---

## 8. 本文写作时的开工现测（run `orca-dev-bd5f202b`）

| 项 | 值 | 命令 |
|---|---|---|
| npm test | 100 / 608 | `rtk proxy npm run verify > 文件 2>&1`，整份读回（1410 行），`VERIFY_RC=0` |
| verify:scheduler／verify:panel／web | 51 / 167、PASS 0–13、8 / 26 | 同上 |
| `ls ~/.orca` | 不存在（verify 前后） | |
| 本会话写本文前的水位（只算 prompt，见 §3.1 口径注意） | 279,813 | `probe_transcript.py`（§2.1） |
