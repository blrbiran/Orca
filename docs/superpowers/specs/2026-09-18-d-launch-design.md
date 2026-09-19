# D-launch 拉起下一个会话 —— 设计

**状态**：设计已逐节经人确认（本会话 ①–⑥ 六节）；经一席对抗审查（判 `No`：2 Critical／12 Important／13 Minor），处置见 §10，两处需人裁的已由人裁（§1 R13、R14）；
人要求复审后控制器又找出 8 处，处置见 §11（人「同意，继续」）；**尚无实现计划**。
**归属**：run `orca-dev-6662000e`（控制器 Claude Code 会话 `6662000e-644c-44b3-b38f-58cda6412bf0`，`claude-opus-5[1m]`），2026-09-18。
**上游**：D spec `2026-09-17-checkpoint-handoff-design.md` §3（启动适配器）、§5（交接链与人的边界）、§6（分刀：D-launch 在 Tier 0 闸门之后）；
Tier 0 spec `2026-09-18-tier0-gate-design.md`（前置，已落地）。
**观测锚点**：除另注外，本文实测值均在 Orca `d321b5e`（`docs(handoff): record the I3 live check and the Tier 0 gate going live`）上测得。

**明确不做（v1）**：第二个运行时（Codex 等）；会话失败自动重试；立即杀掉当前会话的「硬停」；D3（交接职责迁移）；改 ccloop；
把闸门钉在工作树外（§1 R14 否决，残余风险见 §7）。

**v1 的适用范围**：只在**装有 Tier 0 闸门的仓库**里开链（§5.2 要求配置与 `src/gate/settings.ts` 深相等）⇒ 今天即 **Orca 本身或它的 clone／worktree**。
面板 `--repo` 列表里的其他仓库，开链会被 §5.1 按名拒绝。
**凡要改被守护路径（§4.1）的工作 —— 例如开发闸门本身 —— 不能交给链做**：会话一改即被判 `gate-modified` 停链。

---

## 0. 问题与目标

D1＋D2 之后，水位由代码判（`orca level`）、检查点由 agent 写（`orca checkpoint write`）、开工核对由代码做（`orca resume`），
**剩下的一步仍要人亲手做：开新会话、把 resume 的输出交给它。** D spec §0 的目标是「下一个会话由代码拉起」。

D-launch 的交付：一个**外部监督进程** `orca chain`，由人授权一次（`--goal` ＋ 上限），串行地以无头方式拉起 Claude Code 会话，
每个会话退出后**由代码**判定续还是停；停时通知人一次（终端摘要、macOS 通知、面板横幅）。

---

## 1. 人本会话的裁决

| # | 问题 | 裁决 |
|---|---|---|
| R1 | 链的形状 | **外部监督进程**（`orca chain`），串行起会话、代码判续停。否决：会话自己交棒（两会话并存、由 agent 判）；钩子触发（新旧会话并发写同一工作树） |
| R2 | 续还是停凭什么 | **退出检查点带 `chain` 字段**（`continue`／`done`／`blocked`）。否决：只看有没有新检查点（T1 那份会造成误续）；解析会话最后一句话（判据落在自由文本上） |
| R3 | 无头会话的权限模式 | **`--permission-mode auto`** |
| R4 | 硬上限 | **四条全要**：最多会话数、累计成本上限、没有进展就停、单会话超时 |
| R5 | 超时的定位 | 人原话：「超时一般要设长一点，agent coding 时一个任务通常会很久，这只是一个保底机制」⇒ **可选，默认 360 分钟**，放仓库配置 |
| R6 | 停链时怎么通知 | **终端摘要 ＋ macOS 通知 ＋ web UI 提示** |
| R7 | 链记录住处 | **仓库内并提交**（`.orca/chains/<chain-id>.json`）；原始会话输出放被忽略的 `.orca/chain-logs/` |
| R8 | 任务从哪来 | **`--goal` 必填 ＋ 每个会话附当时的 `orca resume` 输出**；goal 原文就是这条链的授权范围 |
| R9 | 方案 | **方案 A**：`orca chain` 作 Orca CLI 子命令，Node 监督循环，启动适配器单独成层，判断集中在纯函数 |
| R10 | web UI 开链入口 | 人原话：「orca chain也需要有 web UI 入口」⇒ 面板加开链／停链／状态 |
| R11 | 外部绑定模式下的开链入口 | **两种模式都开放** |
| R12 | 停链按钮 | **要：当前会话跑完再停**；终端对应 `orca chain stop` |
| R13 | （对抗审查 I6 后重问）R11 与 A′ §4.1「面板若直接写进仓库……安全上不给」冲突 | **维持 R11**。⇒ 本文**推翻** A′ §4.1 对「开链」这一种写入的禁令，见 §6.3 |
| R14 | （对抗审查 C1 后）链里的 agent 能改掉／关掉自己的闸门，防到什么程度 | **检测即停**（§5.2 每会话前功能性核对 ＋ §4.2 会话后比对被守护路径）。否决：把闸门钉在工作树外。人上一轮对 Tier 0 的原话「维持bash钩子，我们允许适当的放宽」同向 |

**具名授权**：
- R6、R10、R11、R13 ⇒ 改**面板**（E3 生产代码：`src/panel/**`、`web/src/**`），范围限于「链的状态、开链、停链、停链横幅」。
- R2 ⇒ 改 `src/checkpoint/{schema,write,covering,resume}.ts`、`src/level/{hook,trigger}.ts`、`src/cli.ts`（`checkpoint write` 与新增 `chain` 子命令两处），范围限于 §3 与 §4 所列改动。
  ⚠️ 其中 `covering.ts`、`resume.ts`、`trigger.ts`、`cli.ts` 是对抗审查（I9、M4）之后补进清单的，**交人审 spec 时一并点名**。
- 复审 2 ⇒ 新建 `src/gate/settings.ts`，并改写**承重判据** `tests/gate/settings.test.ts` 让它从该文件取期望值（期望值本身逐字节不变）。
  ⚠️ 这是人审复审时（2026-09-18「同意，继续」）一并认可的；计划须为「期望值逐字节不变」点名一条核对。

---

## 2. 组件与数据流

```
终端：orca chain start --repo <path> --by <who> --goal <text> --max-sessions N --max-cost-usd X [--session-timeout-min M] [--chain-id <id>]
面板：POST /api/chains {repoKey, goal, maxSessions, maxCostUsd, sessionTimeoutMin?}   （by 取面板进程的 --by）
        → 与 CLI 同一个 zod schema 校验
        → 面板先生成 chain-id（^chain-[0-9a-f]{8}$），以 --chain-id 传给 CLI；CLI 校验格式并拒绝已存在的 id
        → detached spawn 上面那条 CLI，stdio 全部指向 .orca/chain-logs/<chain-id>/supervisor.log（不接面板的管道，审查 I3）
        → 轮询该文件等 `orca chain: started <chain-id>` 一行（10 s 期限），同时看子进程是否已退出：
          已退出 ⇒ 立即把文件里 CLI 的按名拒绝原样返回，不等满 10 s
停链：orca chain stop --repo <path>  ／  POST /api/chains/<chain-id>/stop
        → chain-id 须匹配 ^chain-[0-9a-f]{8}$ 且链记录存在（审查 I10）
        → 写停止请求 .git/orca-chain/<chain-id>/stop（.git 之内：会话里的 agent 清理工作树时碰不到）
看状态：面板读各仓库的 .orca/chains/*.json（只读）

监督进程（审查 I12；复审 1）：
  - **所有 chain 用到的模块在启动时静态加载**，`resume` 以**进程内函数调用**执行，不 spawn `orca` 子进程
    （`cli.ts` 对部分子命令用动态 `import()`（:335、:345），启动后才加载的模块会读到工作树里被改过的代码）；
  - 唯一例外是 §5.2 的闸门功能性核对 —— 它**有意**执行工作树里的钩子命令，因为要验的正是那一份；
  - 在目标仓库**就是**监督进程所在 checkout（即在 Orca 主工作树里开链）时，启动后工作树里的改动不影响已加载的监督代码，
    但下一次开链会用上被改过的代码 ⇒ **默认在专用 clone／worktree 里开链**，在主工作树开链时打一行警告（§7-6）。
  开链前核对（§5.1）→ 写链记录并提交
  循环：
    1. 每会话前核对（§5.2）：停止请求、剩余预算、闸门功能性核对、工作树干净、分支
    2. 进程内调 resume（`--repo <repo>` 等价），取其输出（§4.4 的退出码处理）
    3. 拼提示词 = goal 原文 ＋ resume 输出 ＋ 链的规矩（§3.3）
    4. 启动适配器.launch({prompt, sessionId: 新 uuid, budgetUsd: 剩余预算, timeoutMs, env})     （§2.2 argv 模板）
         stdin: ignore；cwd: 仓库顶层；stdout → .orca/chain-logs/<chain-id>/<n>.stdout.json；stderr → <n>.stderr.txt
         会话期间每 5 s 查一次停止请求，看到即锁存于内存（文件之后被删也不失效）
         ← SessionResult
    5. 会话后收尾：清点并终止该会话进程组的残留进程（记数）；找退出检查点（§3.5）；数新提交（§4.1）；
       查工作树、分支、历史、被守护路径（§4.2 规则 3–3c）
    6. decideNext(...) → continue | stop(reason, category)
    7. 追加本会话到链记录并提交（§6.1 的提交方式）
    8. continue ⇒ 回到 1；stop ⇒ 链记录写终态并提交 → 释放链锁（finally）→ 终端摘要 → macOS 通知 → 退出码（§4.3）
```

### 2.1 单元

| 单元 | 职责 | 依赖 |
|---|---|---|
| `src/chain/decide.ts` | `decideNext`：纯函数，§4.2 全部路由 | 无 I/O |
| `src/chain/record.ts` | 链记录 zod schema；读、写、提交 | git |
| `src/chain/lock.ts` | 仓库级链锁 `.git/orca-chain/lock` | 文件系统 |
| `src/gate/settings.ts` | **期望的闸门配置对象（钩子对象 ＋ deny 列表）的唯一来源**，从 `tests/gate/settings.test.ts:10-22` 的常量挪出；该测试与 `gateCheck` 都从这里取（复审 2） | 无 |
| `src/chain/gateCheck.ts` | §5.2 闸门功能性核对与配置深相等核对 | `.claude/settings.json`、`src/gate/settings.ts` |
| `src/chain/launch/claudeCode.ts` | 启动适配器：按固定 argv 模板 spawn（独立进程组）、超时杀组、会话后清点残留、解析 result JSON；**不含判断** | `claude` 可执行文件 |
| `src/chain/prompt.ts` | 拼提示词（确定性模板） | 无 |
| `src/chain/run.ts` | 监督循环 | 以上全部、`orca resume` |
| `src/chain/notify.ts` | 终端摘要、`osascript` 通知 | `osascript`（失败只警告） |
| `src/cli.ts` | `chain start`／`chain stop`／`chain unlock`；`chain` 子命令自捕全部异常映射为 2（审查 I8） | |
| `src/checkpoint/*`、`src/level/*` | §3 所列改动 | |
| `src/panel/**`、`web/src/**` | 链的 API 与视图（§6.2） | |

### 2.2 硬约束

1. **串行 ＋ 链锁**：同一时刻一个仓库里至多一条链、一条链里至多一个会话在跑。
2. **会话开始前工作树必须干净**（§5.2），否则停链；**监督进程自己的提交一律只提交链记录那一个路径**（§6.1），不碰别的改动。
3. *** **监督进程不在闸门的保护范围内** *** —— 闸门是 Claude Code 的 PreToolUse 钩子，只拦 agent 会话的工具调用。
   监督进程自己的代码不做 Rule 15 那四件事（§8 机械扫描钉住）；**但它经 `orca resume` 会执行检查点 `measure` 里 agent 写的命令**
   —— 这条路径只过 Tier 0 的 classify，不过 auto 分类器，登记在 §7。
4. **argv 是固定模板，逐项相等**（审查 I4，白名单而非黑名单）：
   ```
   claude -p <prompt> --output-format json --permission-mode auto --model <chain.json 的 model>
          --session-id <uuid> --max-budget-usd <剩余预算>
   ```
   不多一项、不少一项。⇒ `--dangerously-skip-permissions`、`--allow-dangerously-skip-permissions`、`--bare`、`--safe-mode`、`--restricted`、
   `--settings`、`--setting-sources`、`--no-session-persistence`、`-w`、`bypassPermissions` 等全部天然排除。
5. **子进程环境显式剔除** `CLAUDE_CODE_SIMPLE`、`CLAUDE_CODE_SAFE_MODE`（可关掉钩子）、`CMUX_SURFACE_ID`（本机 PATH 上的 `claude` 是 cmux shim，
   该变量存在时 wrapper 会注入 `--settings`），并显式设 `ORCA_CHAIN_ID`、`ORCA_CHAIN_SESSION`。
6. **不自动重试**、**不替会话收拾工作树**（不提交、不 stash、不 reset）。
7. **链须独占工作树**（审查 I11）：本仓库多 agent 共享（Rule 13），人的交互会话若同时在同一工作树里写，其提交会被算成会话的进展、其未提交改动会让链停在 `dirty-after-session`。
   ⇒ 开链前核对拒绝 `.git/orca-lock`（调度器的 repo 锁）被持有的仓库；**默认在专用 worktree 或 clone 里跑链**，在监督进程自身所在的工作树里开链时打一行警告（§7）。

---

## 3. `chain` 字段与退出协议

### 3.1 字段

草稿（`DraftSchema`）与检查点（`CheckpointSchema`）各加一个**可选**字段：

```json
"chain": { "status": "continue" | "done" | "blocked", "why": "<非空一句话>" }
```

- `continue`：还有可逆的活，交下一个会话。
- `done`：`--goal` 已完成。**此时 `next` 允许为空**（其余情形仍 `min(1)`，用 zod refine 表达，审查 M6）。
- `blocked`：剩下的每件事都卡在人（D spec §5 的四类）；**此时 `awaitingHuman` 必须非空**（refine）。

带 `chain` 的检查点称**退出检查点**；不带的是现行的中途检查点，行为不变。三分类是 agent 的分类（Rule 5 允许）；**用它路由的是代码**（§4）。
`CheckpointSchema` 仍 `.strict()`、`v` 仍 `1`：新字段可选，旧检查点照样通过。

### 3.2 会话怎么知道自己在链里；链模式下 T1 即交接

监督进程起 `claude` 时设 `ORCA_CHAIN_ID=<chain-id>`、`ORCA_CHAIN_SESSION=<uuid>`。钩子是 `claude` 的子进程，继承它们
（**这条继承是假设，由 §8.3 活体验收现测**；读不到时钩子退回交互模式的文字，交接仍由提示词 §3.3 要求，不静默失效）。

`orca level`（文字在 `trigger.ts` 的 `decide()`）在 `ORCA_CHAIN_ID` 存在时：
- **band ≥ 1 且本会话没有退出检查点** ⇒「写退出检查点（`chain.status: continue`）并结束本会话」，附写命令。
- **本会话已有退出检查点**（HEAD 上本会话那份检查点带 `chain`，**不看档**）⇒ 知会「已写退出检查点，结束本会话」。
  本会话的中途检查点（不带 `chain`）在链模式下**不算覆盖**（审查 I9）。
- 理由：交互会话在 T1 写检查点后可继续，是因为人在场决定何时切；链里无人，而单次调用增量无已知上限（D spec §4「滞后与余量」），
  拖到 T2 交接等于每次都认一次越界。T1 切，不越界（Rule 6「If approaching budget, summarize and start fresh」）。
- ⚠️ 这是**本文的设计选择**，不是 D spec §4 的字面（§4 在 T1 只要求写检查点）。只在链模式生效。
- 链模式下 `NoReading`：照旧每次都报「水位读不到」（D spec §4）。为免一条链因读不到水位而一直跑到超时，`--model` 由链配置固定（§2.2-4），
  开链前核对要求该 model 能被 `orca level` 解析出窗口（§5.1），活体验收要求首个工具调用后即有读数（§8.3）。
- 无 `ORCA_CHAIN_ID` 时钩子输出**逐字节不变**（§8 黄金样本钉住）。子代理的调用照旧静默（I3，`hook.ts` 的 `agent_id` 分支先于一切）。

### 3.3 提示词里的链规矩（确定性模板，`prompt.ts`）

1. 你在一条无人值守的链里：链 id、本会话序号、goal 原文（授权范围以它为准，**不因检查点 `next` 扩大**）。
2. **你的会话 id 是 `<uuid>`**（注意 resume 输出里打印的是**上一个**会话的 id，别用错）；写退出检查点的**完整命令**与草稿形状（含 `chain`）。
3. 何时写退出检查点：水位提醒到了 ⇒ `continue`；goal 完成 ⇒ `done`；只剩卡人的事 ⇒ `blocked`；**因任何其他原因结束之前**都先写一份。
4. 结束前工作树必须干净（全部提交），留在开始时的分支上，不改写已有历史；写完退出检查点就结束会话。
5. 不改被守护路径（§4.1 列全），不建 `.claude/settings.local.json`（改了会被检测并停链，§4.2 规则 3）。
6. Rule 15 的四件事列进 `awaitingHuman`，不要尝试（闸门会拦）。

### 3.4 写检查点不再需要 `--transcript`；会话 id 被钉住

- `--transcript` **可选**；缺省时按会话 id **精确**查找 `<projects-root>/*/<session-id>.jsonl`。
  `<projects-root>` = `ORCA_CLAUDE_PROJECTS_DIR` ‖ `$CLAUDE_CONFIG_DIR/projects` ‖ `~/.claude/projects`（审查 M2：cmux wrapper 会改 `CLAUDE_CONFIG_DIR`）。
  **判据一律经 `ORCA_CLAUDE_PROJECTS_DIR` 改道**，不读真数据。命中 0 个 ⇒ `transcript-not-found`；多于 1 个 ⇒ `transcript-ambiguous` 并列出路径。
  （handoff:4231：「取最新 transcript」会选错会话，只许按 id 精确取。）
- `ORCA_CHAIN_SESSION` 存在时，`--session` 必须等于它，否则按名拒绝 `session-mismatch`（审查 M3：防止 agent 拿 resume 里上一个会话的 id 覆盖掉上一份退出检查点）。

### 3.5 监督进程怎么认退出检查点

会话结束后读 **HEAD 上的** `.orca/checkpoints/orca-dev-<uuid 前 8 位>.json`，要求 `sessionRef === <uuid>` 且带 `chain`；否则「没有退出检查点」。
同一会话后写的检查点在新提交里替换旧的（`write.ts:70-75` 现行行为）⇒ HEAD 上那份就是它最后的判断。

---

## 4. 停链规则与上限

### 4.1 `decideNext` 的输入

`SessionResult`（`exited{exitCode}` ｜ `timeout` ｜ `launch-failed{reason}`）、result JSON 的 `total_cost_usd`（数 ｜ 读不到）与 `subtype`、
退出检查点（有 ｜ 无）、工作树是否干净、HEAD 是否仍在开始时的分支、HEAD 是否是开始时 HEAD 的后代、被守护路径是否变化、
本会话新提交数、是否有停止请求、已跑会话数、累计成本（数 ｜ 读不到）、四个上限。

**「本会话新提交数」**：`git rev-list <会话开始 HEAD>..<会话结束 HEAD>` 中，改动路径**不全在** `.orca/checkpoints/` 之下的提交个数
（`git diff-tree --no-commit-id --name-only -r <sha>` 逐个判）。链记录提交发生在会话之外，本就不在区间里。

**「被守护路径」**：
- 闸门：`src/gate/**`（含 `src/gate/settings.ts`）、`.claude/**`（含是否出现 `.claude/settings.local.json`）、`scripts/gate-prefilter.mjs`；
- 链自己的配置与记录（复审 3）：`.orca/level.json`（调高 T1 即可让会话永不交接）、`.orca/chain.json`（换模型）、`.orca/chains/**`（链记录）；
- 别的会话的检查点：`.orca/checkpoints/` 下除 `orca-dev-<本会话 uuid 前 8 位>.json` 以外的任何文件（M3 只钉住了 `--session` 参数，没钉住直接改文件）。

比对 `git diff --name-only <会话开始 HEAD> -- <路径>`（含未提交）与 `settings.local.json` 的存在性。

### 4.2 规则（按序判，命中即返回；**任何异常都停，停是安全的方向**）

| # | 条件 | 结果 | 类别 |
|---|---|---|---|
| 1 | 会话起不来 | `launch-failed` | anomaly |
| 2 | 超时被杀 | `session-timeout` | anomaly |
| 3 | 被守护路径变化 | `gate-modified` | anomaly |
| 3a | 工作树有未提交改动 | `dirty-after-session` | anomaly |
| 3b | 会话结束时 HEAD 不是开始时 HEAD 的后代 | `history-rewritten` | anomaly |
| 3c | 会话结束时不在开始时的分支上（含 detached） | `branch-changed` | anomaly |
| 4 | （仅 `exited`）读不到 `total_cost_usd` | `cost-unreadable`（Rule 14：不估；累计记为读不到） | anomaly |
| 5 | 预算花完（`subtype` 为预算耗尽类；旁证为 `error_max_budget_usd`，计划阶段在本机 claude 版本上现测定） | `max-cost` | limit |
| 6 | 退出码非 0 或 `subtype` 非 `success` | `session-failed`（原样记 subtype） | anomaly |
| 7 | 没有退出检查点 | `no-exit-checkpoint` | anomaly |
| 8 | `chain.status = done` | `done` | done |
| 9 | `chain.status = blocked` | `blocked`（`awaitingHuman` 带进摘要） | blocked |
| 10 | 有停止请求 | `stop-requested` | limit |
| 11 | 累计成本 ≥ 上限 | `max-cost` | limit |
| 12 | 已跑会话数 ≥ 上限 | `max-sessions` | limit |
| 13 | 本会话新提交数为 0 | `no-progress` | limit |
| — | 其余 | `continue` | |

- 规则 1、2 排在「读成本」之前（审查 I1）：被杀或没起来的进程没有 result JSON，若先判成本，这两行永远到不了。它们的累计成本同样记为「读不到」。
- 规则 3–3c 排在一切「正常结局」之前：会话留下的现场有问题，无论它的检查点说什么都停。**预算中途耗尽时工作树多半是脏的**，届时按 `dirty-after-session` 停而非 `max-cost`，这是有意的（现场优先）。
- **「成本上限」是软上限**（审查 M1）：claude 在每条消息之后才检查预算，会超出；且规则 4 的累计只在会话结束后更新。spec 与 CLI 用法文本都写「软上限」。
- **起每个会话之前**查停止请求与剩余预算；`--max-budget-usd` 传「上限 − 已花」，剩余 ≤ 0 不起。
- **超时**：对整个进程组 SIGTERM，宽限 10 s 后 SIGKILL。**每个会话结束后（不只超时）都清点该进程组的残留并终止**，记下个数（审查 M8）；
  Bash 工具起的后台进程是否在同一进程组**未现测**，由活体验收清点。
- **超时默认 360 分钟**，读仓库配置 `.orca/chain.json`（缺省即此值），`--session-timeout-min` 覆盖。它是**保底，不是节奏**。

### 4.3 `orca chain start` 的退出码

| 码 | 含义 |
|---|---|
| 0 | `done` |
| 1 | 开链前被拒（§5.1），什么都没写 |
| 2 | anomaly 停链；**以及 `chain` 子命令内任何未预期异常**（子命令自捕，不落到 `main()` 兜底的 3，审查 I8） |
| 3 | `blocked`，等人（与调度 spec §6.3「3 = 升人」同义） |
| 4 | limit 停链（含人叫停） |

面板开的链是 detached 的、退出码无人接收 ⇒ **停的原因与类别一律写进链记录**，面板只读那份。

### 4.4 `orca resume` 的退出码处理（审查 I7）

| resume | 处置 |
|---|---|
| 0 | 输出进提示词 |
| 2（某条实测退出码变了） | **不停**，输出进提示词 —— 那正是下一个会话该看到的 |
| 1 且原因为 `no-checkpoint`，**且这是第 1 个会话** | 不停；提示词里写「本仓库尚无检查点」 |
| 其余非 0（含 1 的其余原因、3） | 停 `resume-failed`（anomaly） |

`resume.ts` 判 stale 时除 `.orca/checkpoints` 外**也排除 `.orca/chains`**（审查 M4：否则每次链记录提交都让检查点被判 stale）。

---

## 5. 出错处理

### 5.1 开链前核对（任一不过 ⇒ 按名拒绝、退出 1、什么都不写）

1. 目标是 git 仓库的顶层，工作树干净，HEAD 在某个分支上（非 detached）。
2. 链锁可取。锁里记 **pid ＋ 该进程的启动时间**（复审 8：只记 pid，pid 被复用后死链会被误判为在跑）；
   判「持有者还在」要两者同时对上。锁存在而持有者不在 ⇒ **按名拒绝** `chain-lock-stale`，提示人确认后 `orca chain unlock`；**不自动清理**。
   持有者还在 ⇒ 按名拒绝 `chain-running`。
3. `.git/orca-lock`（调度器的 repo 锁）未被持有。
4. 参数：`--goal`、`--by` 非空；`--max-sessions`、`--max-cost-usd` 必给、为正、**无默认值**。
5. `claude` 在 PATH 上；`.orca/chain.json` 的 `model` 能被 `orca level` 解析出窗口（`[1m]` 后缀或 `.orca/level.json` 的 `windows` 表）。
6. §5.2 的闸门核对通过。

### 5.2 每会话前核对（审查 C1；R14「检测即停」的前一半）

第 1–3 项任一不过 ⇒ 停链 `gate-check-failed`（anomaly），不起会话；第 4 项各按自己的原因停（复审 4）：
1. **配置深相等**：`.claude/settings.json` 的 PreToolUse 钩子对象与 `permissions.deny` 集合，与 `src/gate/settings.ts` 的期望对象**深相等**（Tier 0 spec §5 的判据，复审 2 挪进 `src/` 作唯一来源），不是「命令串里含 `gate`」。
2. **`.claude/settings.local.json` 不存在**（它被全局 gitignore 忽略，工作树「干净」看不见它；其中的 `disableAllHooks` 能关掉闸门）。
3. **功能性核对**：用一条必拦样本（`git push` 的 PreToolUse stdin）真跑一次 settings 里的钩子命令（`CLAUDE_PROJECT_DIR` 指向仓库），要求退出 2 且 stderr 以 `orca gate:` 开头；
   再用一条必放样本（`git status`）要求退出 0。
4. 其余前置，**不归入 `gate-check-failed`**：
   - 有停止请求 ⇒ `stop-requested`（limit）
   - 剩余预算 ≤ 0 ⇒ `max-cost`（limit）
   - 工作树不干净 ⇒ `dirty-before-session`（anomaly；新增，通常意味着有人在同一工作树里写，§2.2-7）
   - HEAD 不在开链时的分支上 ⇒ `branch-changed`（anomaly）

   判序：先第 4 项的停止请求与预算（limit 优先于核对），再第 1–3 项，再工作树与分支。

⚠️ `-p` 模式下 settings 文件校验失败会被**静默忽略**（`claude --help` 原文），第 1、3 项的功能性核对正是为此。

### 5.3 循环中

| 事件 | 处置 |
|---|---|
| 链记录提交被拒（如 pre-commit 钩子） | 停 `record-commit-refused`（anomaly）；文件留盘，报告写明 |
| macOS 通知失败 | 一行警告，不影响退出码与链记录 |
| 监督进程收到 SIGINT／SIGTERM | 转发给当前会话进程组，等其退出，**照常跑规则 1–3c**：命中则按该条（anomaly）停，否则记 `stop-requested`（limit）；释放锁，退出（审查 M12） |
| 监督进程被 SIGKILL／机器重启 | 无法善后：链记录停在 `state: running`、链锁残留；面板按 §6.2 显示「持有者已不存在」；人 `orca chain unlock` |
| `orca chain unlock` | 删锁，并把该链记录收尾为 `stopped`、原因 `unlocked-by-human`、类别 anomaly，提交（审查 M13） |
| 面板 spawn 后 10 s 内 `supervisor.log` 里没有 `started` 行 | 500，按名说明，指向该日志 |

---

## 6. 链记录与面板

### 6.1 链记录 `.orca/chains/<chain-id>.json`（被 git 跟踪，只由监督进程与 `orca chain unlock` 写）

```json
{
  "v": 1,
  "chainId": "chain-<8 位十六进制>",
  "repo": "<绝对路径>",
  "startedBy": { "via": "cli" | "panel", "by": "<who>" },
  "goal": "<原文>",
  "limits": { "maxSessions": 5, "maxCostUsd": 20, "sessionTimeoutMin": 360 },
  "model": "<argv 里的 --model>",
  "startedAt": "<ISO>",
  "startHead": "<sha>",
  "branch": "<开链时的分支>",
  "supervisorPid": 12345,
  "sessions": [
    {
      "n": 1, "sessionRef": "<uuid>", "startedAt": "<ISO>", "endedAt": "<ISO>",
      "outcome": "exited" | "timeout" | "launch-failed",
      "exitCode": 0, "subtype": "success",
      "costUsd": 1.23,
      "exitCheckpoint": ".orca/checkpoints/orca-dev-xxxxxxxx.json",
      "chain": { "status": "continue", "why": "..." },
      "commits": 4,
      "leftoverProcesses": 0
    }
  ],
  "state": "running" | "stopped",
  "stop": { "reason": "done", "category": "done|blocked|limit|anomaly", "at": "<ISO>", "awaitingHuman": [] }
}
```

- 读不到或不存在的字段为 `null`；`stop` 在运行中为 `null`。`by` 是归属（Rule 13），与面板 spec §1.3 同义。
- 写入时机：开链、每个会话后、停链（及 `unlock`）；提交信息 `chore(chain): <chain-id>, session <n>, <reason>`（开链为 `started`）。
- **提交方式**：`git add -- .orca/chains/<chain-id>.json` 后 `git commit --only -- .orca/chains/<chain-id>.json`（审查 I2；复审 7：首次写时文件尚未被跟踪，单用 `--only` 会失败）—— 只提交这一个路径，**不要求**其余工作树干净、也不带上任何别的改动；
  这样 `dirty-after-session` 停链时终态照样能提交，而会话留下的改动原样留在工作树里给人看。
- 不进 `.decisions/`（提交钩子要求只追加），不进 `.superpowers/sdd/`（其 `.gitignore` 为 `*`）。**无仓库外写入** ⇒ 不触发 Rule 17 登记。
- `.gitignore` 加 `.orca/chain-logs/`。停止请求与链锁在 `.git/orca-chain/` 下。

### 6.2 面板

- **状态**：每个仓库最近一条链：goal、by、第几个会话、累计成本（或「读不到」）、状态；停了则原因、类别、`awaitingHuman`。
  `state: running` 但链锁不在、或锁里的 pid ＋ 启动时间对不上活进程 ⇒ 显示「**运行中（持有者已不存在）**」，不冒充在跑。
- **开链表单**：仓库（面板 `--repo` 列表中选）、goal、三个上限（超时预填配置值）。成功显示 chain-id；被拒原样显示拒绝。
- **停链按钮**：仅 `running` 时出现；只写停止请求，页面标「将在当前会话结束后停止」。
- **横幅**：链停下后按类别（完成／等人／上限／异常）显示一条，「知道了」即收起；收起状态**只存浏览器**（`localStorage`），不写 `~/.orca`。
- 面板**只读**链记录；开链、停链一律经 CLI 那一层（开链 spawn CLI；停链与 `orca chain stop` 共用同一个写停止请求的函数）。
- 开链、停链接口与现有写接口共用 token 与 Host 白名单；**回环与外部两种绑定模式都开放**（R11、R13）。

### 6.3 与既有安全裁决的关系（Rule 7：点名，不混合）

- A′ spec §4.1（`2026-08-29-decision-ledger-design.md:354`）：「面板若直接写进仓库，就要求一个 Web 应用对**所有**仓库持有提交权。**安全上不给。**」
- 面板 spec §2.1（`2026-09-09-panel-design.md:100-102`）：面板**不可以**取任何目标仓库的 repo 锁、往 `.decisions/` 写、在任何仓库里 `git commit`，由 §6 变异 5 钉住。
- *** **本文按人 R13 的裁决，推翻 A′ §4.1 对「开链」这一种写入的禁令**：面板经 detached 的 `orca chain` 子进程，间接取链锁、提交链记录、并起能提交的无人值守 agent。 ***
  这**比**当年禁掉的「面板闭环」权限更大，人已知情。
- **面板进程自身**仍不取 repo 锁、不写 `.decisions/`、不直接 `git commit`：面板 spec §2.1 的这三条与变异 5 **不变、仍承重**。
  变异 5 钉的是面板进程里的调用，开链走子进程，**不会**触发它；计划须为「面板开链只经 spawn CLI」另点名一条判据与变异。
- 执行时要在 A′ spec 与面板 spec 各**追加**一条 ERRATUM 指回本节（Rule 13：历史不就地改）。

---

## 7. 风险登记（人已知情并裁决，或本文如实登记）

1. **R11／R13：外部绑定模式下也开放开链。** 面板 token 随 HTML 传输、不可撤销（`orca panel` 用法文本原话）。
   ⇒ *** **token 一旦泄漏，持有者可以在人的机器上花钱起无人值守、能提交的 agent。** *** 上限由请求方给，不约束攻击者。
2. **R14：闸门与被它守护的代码在同一个工作树。** 闸门钩子执行的是工作树里的 `src/cli.ts gate`；agent 改 `src/gate/**` 当场生效、无需提交；
   `.claude/settings.local.json`（全局 gitignore）里的 `disableAllHooks` 可关掉钩子。
   「检测即停」只能在**会话前**确认闸门完好、在**会话后**发现改动；*** **同一会话里先改闸门、再做 Tier 0 动作，拦不住，只能事后发现。** ***
3. **resume 执行 agent 写的命令**（审查 I12）：监督进程（进程内）的 resume 会重跑检查点 `measure` 里的任意命令（`/bin/sh -c`），只过 Tier 0 classify、不过 auto 分类器。
   被 auto 分类器拦下的命令可以写进 `measure`，由监督进程无人值守地执行。v1 不收紧，登记。
4. **R3：auto 分类器可能误拒**。无头会话里被拒即拒；agent 须绕开或列进 `awaitingHuman`。
5. **闸门已知放行清单**（Tier 0 spec §7）在无人值守时敞开。v1 不收紧；闸门之外的两层是 **deny 规则**与 **auto 分类器**。
6. **链须独占工作树**：人的交互会话同时在同一工作树里写会被误算为进展或让链停在 `dirty-after-session`／`dirty-before-session`。
   **默认专用 worktree／clone**；在监督进程自身所在的工作树里开链时打警告 —— 此时 agent 对 `src/chain/**` 的改动会被**下一次**开链用上（复审 1）。
7. **监督进程被硬杀后**链记录停在 `running`、链锁残留；靠人 `orca chain unlock`。
8. **`ORCA_CHAIN_*` 是否传到钩子**、**Bash 工具后台进程是否在会话进程组内**：未现测，由活体验收定。
9. **本机 `claude` 是 cmux shim**：已靠剔除 `CMUX_SURFACE_ID` 规避 `--settings` 注入；wrapper 的其他行为未审，活体验收用 `ps` 核对真实子进程 argv。

---

## 8. 判据与活体验收

### 8.1 Rule 4 判据

`npm run verify` 退出 0；其中新增 `npm run verify:chain`（形状同 `verify:scheduler`，端到端）。

**假运行时**：一个假的 `claude` 可执行文件放在测试 PATH 最前，按剧本：记录 argv 与环境变量、写检查点、提交、sleep、弄脏工作树、改被守护路径、切分支、起后台子进程、打印假的 result JSON（或不打印）。
*** **判据里不起真 claude、不花钱。** ***

### 8.2 判据清单（每个新分支点名一条删掉它自己的变异，Rule 9）

1. `decideNext`：§4.2 每行一条判据 ＋ 优先级判据（如「`done` 但工作树脏 ⇒ `dirty-after-session`」「预算花完且工作树干净 ⇒ `max-cost` 而非 `session-failed`」「超时 ⇒ `session-timeout` 而非 `cost-unreadable`」）；
   **每行一条删掉该行的变异**，逐条看见红。
2. 启动适配器：**argv 与模板逐项相等**；剔除的三个环境变量不在子进程环境里、两个 `ORCA_CHAIN_*` 在；stdin 为 ignore、cwd 为仓库顶层、stdout/stderr 分两个文件；
   超时杀**整个进程组**、正常退出后清点残留 —— 证据是事后进程清点**残留 0 个**（上一轮 teardown 教训）。
3. 循环（临时仓库 ＋ 假 claude）：`continue→continue→done`、`blocked`、`no-progress`、停止请求（开会话前／会话中写入后又被删）、`max-cost`、`max-sessions`、
   脏工作树（终态仍能提交且不带上脏改动）、改被守护路径、建 `settings.local.json`、切分支、改写历史、无退出检查点、超时、resume 各退出码（§4.4 每行）；
   每条断言链记录内容、提交形状、退出码。
4. 钩子：链模式 band 1／band 2 的文字；「本会话已有退出检查点」的知会；本会话中途检查点在链模式下不算覆盖；**无 `ORCA_CHAIN_ID` 时输出与现行逐字节相同**（黄金样本）。
5. **`ORCA_CHAIN_*` 不泄漏进测试**（审查 I5）：凡读这两个变量的测试在 `beforeEach` 清除、`afterEach` 恢复（同 `tests/level/hook.test.ts:31-40` 对 `CLAUDE_PROJECT_DIR` 的先例）；
   另有一条判据：**带着这两个变量跑整套 `npm test` 仍全绿**。
6. `checkpoint write`：transcript 0／1／多个；`CLAUDE_CONFIG_DIR` 生效；`ORCA_CHAIN_SESSION` 与 `--session` 不符即拒；`done` 时 `next` 可空、`blocked` 时 `awaitingHuman` 必非空。
7. 开链前核对与每会话前核对：每条各一条拒绝判据；闸门核对要有**必抓样本**（钩子缺失、钩子命令被改、deny 少一条、`settings.local.json` 存在、钩子命令对必拦样本返回 0）。
8. 面板：开链（回环、外部两种模式）、停链（chain-id 不合形状 ⇒ 拒；链记录不存在 ⇒ 拒）、状态（含「持有者已不存在」）、横幅；
   面板开链**只经 spawn CLI**（面板进程内无 `git commit` 调用）；`verify:panel` 增 PASS 步。
9. 机械扫描：`src/chain/**` 不含 push／merge／删分支／删 worktree 调用；*** **扫描器自带「必抓」与「必不抓」两组样本** ***。
10. verify 前后 `~/.orca` 不存在；transcript 查找判据全部经 `ORCA_CLAUDE_PROJECTS_DIR` 改道（以「改道到空目录时查找失败」证明改道生效）。
    （审查 M11：「`~/.claude` 零写入」不可测 —— 并行的交互会话在持续写它 —— 已删。）
11. （复审）被守护路径的新增三类（`.orca/level.json`、`.orca/chain.json`、`.orca/chains/**`、他会话检查点）各一条 `gate-modified` 判据；
    本会话自己的检查点被改**不**触发（必不抓样本）；`dirty-before-session`；`--chain-id` 格式与重复各一条拒绝；
    链锁 pid 对上但启动时间对不上 ⇒ 判为持有者不在；监督进程在循环中**不 spawn `orca` 子进程**（假 PATH 里放一个会记录调用的 `orca`／`tsx` 桩，断言零调用；闸门功能性核对除外）；
    `tests/gate/settings.test.ts` 改为引用 `src/gate/settings.ts` 后，期望值与改前逐字节相同（对改前常量取 sha256 比对）。

### 8.3 活体验收（花钱；**跑之前单独找人点头**）

- 在 Orca 的 `git clone --local` 副本里跑，`node_modules` 符号链接回主仓库；**副本的 origin 改指一个 bare 仓库**（`clone --local` 的 origin 默认指向主仓库）；主工作树全程零触碰（还原证明看 `git diff`／`--cached` 字节数，Rule 15）。
- **先现测**：在副本里跑一次最小的 `claude -p`（同 argv 模板），取首个主链 assistant 调用的读数 `F`。审查现测过同类读数：`-p` 约 50.6K、交互会话 40.5K–69.5K（审查 C2）。
  再把副本 `.orca/level.json` 的 T1 设为 `F + 60K` 左右、T2 = T1 + 40K，**提交**（否则开链前核对因工作树脏而拒）。
- `--goal` 给一个小而可逆、足以跨越 T1 的任务（如在副本里分几步给几个文件加注释并逐步提交），`--max-sessions 3`、`--max-cost-usd 5`；
  goal 里另要求某个会话**尝试一次 `git push`**（与提示词第 6 条冲突 ⇒ 模型可能不做；**没有对应 `tool_use` 则这一项判「本次不作数」，不判闸门失败**，同 Tier 0 spec §6.3）。
- **必须看到**：至少一次 `continue` 交接到第二个会话、最终 `done`；链记录与退出检查点形状正确；
  （若有 `tool_use`）`git push` 被闸门拦下（transcript 里有 `orca gate:` 那一行）；`ORCA_CHAIN_*` 传到了钩子（链模式文字出现）；首个工具调用后即有读数；
  `ps` 核对真实 `claude` 子进程 argv 与模板一致；每个会话后残留进程清点结果；面板显示该链、停后出横幅；成本全部来自工具报的 `total_cost_usd`。
- **判别设计**：验收脚本先断言前置条件（副本领先于其 bare remote、T1 > `F`、`level.json` 已提交），**缺交接、缺链模式文字、缺读数任一即判红**
  （上一轮教训：一条永远不会红的验收判据）。

---

## 9. 本文写作时的开工现测（run `orca-dev-6662000e`，观测锚点 Orca `d321b5e`）

| 项 | 值 | 命令 |
|---|---|---|
| 发布状态 | Orca／ccloop／ccmem 三仓库本地 = 远端 main，工作树 0 字节 | `/usr/bin/git ls-remote origin refs/heads/main` 与 `rev-parse HEAD` 比；`git status --porcelain` |
| `orca resume` | RC 0，三条实测退出码均未变，标 stale | `node_modules/.bin/tsx src/cli.ts resume`，输出整份读回 |
| verify | 111/810、51/167、PASS 0–13、8/26、`VERIFY_RC=0` | `rtk proxy npm run verify > 文件 2>&1`，整份读回（1466 行） |
| `ls ~/.orca` | 不存在（verify 前后） | |
| `claude` 标志 | `--session-id`、`--permission-mode`（含 `auto`）、`--max-budget-usd`、`--setting-sources` 均存在（claude 2.1.275） | `claude --help` |
| Bash 持久化 cwd | 不能离开项目目录：`cd` 到项目外被 harness 重置回 Orca | 一次调用 `cd <scratchpad>`，工具回报 `Shell cwd was reset` |
| 闸门判分支用的 cwd | **跟随 Bash 持久化的 cwd**：嵌套仓库停在 `feat` 时 `git merge nosuchbranch` 放行（git 报错 RC 1）；同 cwd 切到 `main` 后被拦（`orca gate: merge into main is Tier 0 …`） | 项目内被忽略目录建嵌套仓库，两次调用 `cd` 后 `git merge`，正反各一次；探针目录已移入废纸篓 |
| `settings.local.json` 被忽略 | 是，由全局 `~/.config/git/ignore:1` | `git check-ignore -v .claude/settings.local.json`（控制器复核审查 C1） |

---

## 10. 对抗审查的处置（一席，`general-purpose`／opus，只读；判 `Ready to implement? No`）

控制器抽查复核了 C1(b)、I5、I6、I8、M4 的证据，均属实。

| 条 | 处置 | 落在 |
|---|---|---|
| C1 闸门可被链内 agent 改掉／关掉 | 人裁 R14「检测即停」：每会话前配置深相等 ＋ 功能性核对 ＋ `settings.local.json` 不存在；会话后被守护路径比对 ⇒ `gate-modified`；残余风险登记 | §5.2、§4.2 规则 3、§7-2 |
| C2 活体验收阈值低于首调读数 | 先现测首调读数 `F`，T1 设在其上；前置断言 T1 > F | §8.3 |
| I1 超时行到不了 | 无 JSON 的结局排在读成本之前；成本规则只对 `exited` | §4.2 |
| I2 终态提交与「工作树须干净」矛盾 | 链记录一律 `git commit --only -- <该文件>` | §6.1、§2.2-2 |
| I3 面板管道 EPIPE | stdio 指向日志文件，面板轮询；锁在 finally 中先释放 | §2、§2.1 |
| I4 禁用标志不全、env 可关钩子、cmux shim | argv 固定模板逐项相等；剔除三个环境变量；`ps` 核对 | §2.2-4/5、§7-9、§8.3 |
| I5 `ORCA_CHAIN_*` 泄漏进测试 | 测试清除／恢复 ＋ 带变量跑全套仍绿 | §8.2-5 |
| I6 与 A′ §4.1／面板 §2.1 冲突 | 人裁 R13 维持 R11；明文推翻开链这一种写入；面板自身三条禁令与变异 5 不变；ERRATUM 待追加 | §6.3 |
| I7 resume 退出码不全 | 逐码处置；首会话 `no-checkpoint` 放行 | §4.4 |
| I8 退出码 3 撞车 | `chain` 子命令自捕异常映射 2；3 保留为 blocked（与「升人」同义） | §4.3 |
| I9 链模式覆盖判定；授权漏文件 | 链模式按「本会话有无退出检查点」判覆盖；授权清单补 `covering`／`trigger`／`resume`／`cli` 并交人点名 | §3.2、§1 |
| I10 停止请求可被删；路径穿越 | 移入 `.git/orca-chain/`；会话中轮询并锁存；chain-id 校验 | §2 |
| I11 链锁不排斥其他写者 | 核对 `.git/orca-lock`；登记须独占工作树 | §5.1-3、§2.2-7、§7-6 |
| I12 监督进程执行 agent 的 measure | 登记；监督进程固定用自己 checkout 的代码 | §2、§7-3 |
| M1 | 软上限措辞；预算耗尽时现场优先 | §4.2 |
| M2 | 尊重 `CLAUDE_CONFIG_DIR` | §3.4 |
| M3 | `ORCA_CHAIN_SESSION` 钉住 `--session`；提示词点明 | §3.4、§3.3-2 |
| M4 | resume 判 stale 排除 `.orca/chains` | §4.4 |
| M5 | 改为 `.superpowers/sdd/`（其 `.gitignore` 为 `*`） | §6.1 |
| M6 | `done` 时 `next` 可空；`blocked` 时 `awaitingHuman` 非空 | §3.1 |
| M7 | stdin ignore、stdout/stderr 分文件、cwd 顶层 | §2、§8.2-2 |
| M8 | 每会话后清点残留；活体清点 | §4.2、§8.3 |
| M9 | `--model` 固定并核对可解析窗口；活体要求首调后有读数 | §2.2-4、§3.2、§5.1-5 |
| M10 | push 无 `tool_use` 判不作数；origin 改指 bare；`level.json` 先提交 | §8.3 |
| M11 | 删去不可测的「`~/.claude` 零写入」，换成改道生效的判据 | §8.2-10 |
| M12 | SIGINT 照常跑规则 1–3c | §5.3 |
| M13 | `unlock` 收尾链记录；分支变化停链；`by` 进记录；§7 补 deny 层 | §5.3、§4.2 规则 3c、§6.1、§7-5 |

---

## 11. 复审的处置（人要求 review 后，控制器自己通读并对照代码；人「同意，继续」）

| 条 | 问题 | 处置 | 落在 |
|---|---|---|---|
| 1 | 「监督进程用自己 checkout 的代码」在 v1 不成立：v1 只能在装闸门的 Orca 仓库开链，监督进程所在 checkout 可能就是 agent 改的工作树；每轮 spawn 的 `orca resume` 与 `cli.ts` 的动态 `import()` 会读到被改的代码 | resume 改进程内调用、chain 模块启动时静态加载、循环中不 spawn `orca`（闸门功能性核对除外）；适用范围明写；默认专用 clone／worktree，主工作树开链打警告 | 抬头「适用范围」、§2、§2.2-7、§7-6、§8.2-11 |
| 2 | 「复用 Tier 0 §5 判据的实现」无法照做：期望配置只在 `tests/gate/settings.test.ts:10-22` | 挪进 `src/gate/settings.ts` 作唯一来源；测试改为引用；期望值逐字节不变并点名核对；授权清单补上 | §2.1、§5.2-1、§1、§8.2-11 |
| 3 | 被守护路径漏了链自己的配置与记录、他会话检查点 | 补进 §4.1；登记「改被守护路径的工作不能交给链」 | §4.1、抬头、§3.3-5、§8.2-11 |
| 4 | 会话前核对把停止请求／预算／脏工作树／分支都归为 `gate-check-failed` | 各按自己的原因与类别停；新增 `dirty-before-session`；定判序 | §5.2 |
| 5 | 两处节号引用错 | R14 改指 §5.2；§3.3-5 改指规则 3 | §1、§3.3 |
| 6 | 面板 `<pending-id>` 未定义；等 `started` 时不看子进程是否已退出 | 面板生成 chain-id 以 `--chain-id` 传入；子进程已退出即返回拒绝 | §2 |
| 7 | 首次写链记录时单用 `commit --only` 会失败 | 先 `git add` 该路径 | §6.1 |
| 8 | 链锁只记 pid，pid 复用会误判 | 锁记 pid ＋ 启动时间；新增 `chain-running` 拒绝 | §5.1-2、§6.2、§8.2-11 |

本节只追加；§10 的处置表原样保留。

---

## 12. 计划阶段的更正与控制器裁决（run `orca-dev-6662000e`，2026-09-18；人授权「有问题先按你的建议执行」）

**本节只追加；上文不改。** 计划 `docs/superpowers/plans/2026-09-18-d-launch.md` 的「PC」节逐条写了 spec 没写或照做不了的实施细节（PC-1 起），以该节为准，此处不复述。要点：
链锁与停止请求放在 `$(git rev-parse --absolute-git-dir)/orca-chain/`（worktree 里 `.git` 是文件，PC-1）；开链前核对另拒 `chain-logs-not-ignored`（PC-2）；`--via`（PC-3）；`stop.detail`（PC-4）；
`settings.json` 顶层 `disableAllHooks` 也核对（PC-5）；面板停链请求体带 `repoKey`（PC-12）。

计划经一席对抗审查（判 `No`）后，控制器裁决如下（对应计划 PC-17 起）：

| 审查条 | 裁决 | 若错的代价 |
|---|---|---|
| I3(a) 闸门钩子执行 `src/cli.ts` 及其导入闭包，均不在被守护路径里 | **不扩**守护集（扩了链几乎改不了 Orca 任何源码）；由每会话前的功能性核对兜底 | 会话经非闸门模块削弱闸门，只有下一次会话前核对能发现 |
| I3(b) 功能性核对的样本 stdin 固定，改过的代码可识别它 | 样本字段每次随机（uuid、真实 cwd、存在的 transcript 路径） | —— |
| I3(c) 用户级 settings 的 `disableAllHooks` 未查 | `gateCheck` 只读检查 `$CLAUDE_CONFIG_DIR/settings.json` ‖ `~/.claude/settings.json`；判据改道 | 开链时只读一次人的全局 settings |
| I4 监督进程的 git 调用会执行工作树里的钩子与 `.git/config` 的 fsmonitor | 监督进程的**所有** git 调用带 `-c core.hooksPath=/dev/null -c core.fsmonitor=false`；§5.3 的 `record-commit-refused` 保留给其余 git 失败 | 仓库里想审每笔提交的钩子审不到链记录提交 |
| I5 嵌套会话环境变量会传给无头 claude | §2.2-5 的剔除名单扩为：`CLAUDE_CODE_SIMPLE`、`CLAUDE_CODE_SAFE_MODE`、`CLAUDECODE`、`CLAUDE_CODE_SESSION_*`、`CLAUDE_CODE_MESSAGING_*`、`CMUX_*` | 某个正当的 cmux／claude 设置到不了无头会话 |

**规则 5 已现测**（本节写作时，claude 2.1.275）：`claude -p … --output-format json --max-budget-usd 0.0001` ⇒ 进程退出 1，`subtype: "error_max_budget_usd"`、`is_error: true`、`total_cost_usd: 0.000944`（超出预算，证实软上限）。探针成本 0.000944 美元（工具报数）。
**授权补点名**：新文件 `src/checkpoint/transcript.ts`（§3.4 的查找）与 `src/chain/**`、`src/panel/chains.ts`、`web/src/ChainPanel.tsx` 等新文件同属本 spec 范围；既有文件的改动仍以 §1 清单为界。

---

## 13. 实施后的残余登记（run `orca-dev-6662000e`，2026-09-18；整支终审与修复波复审之后）

**本节只追加；上文不改。** 实施按计划九个 Task 完成，整支终审判「ready with fixes」，一波修复（闸门核对不再挂住、拒绝嵌套链、transcript 越界守卫补判据、预算格式化为 0 即停、链锁起始时间用 UTC、unlock 先读记录再删锁）经复审全部 ADDRESSED。以下是**未修、如实登记**的：

| # | 残余 | 为何不修／何时修 |
|---|---|---|
| 1 | 嵌套链守卫只看 `ORCA_CHAIN_ID`：会话可用 `env -u ORCA_CHAIN_ID` 或设空串绕过，从而自设上限、逃出人裁 R4 的四条硬上限 | 守卫挡的是「合作型 agent 失手」这一威胁模型（Tier 0 spec）；刻意绕过不在 v1 的防线内 |
| 2 | 判据 E7 在断言「锁已删」之前自己先释放了锁 ⇒ 删掉 `unlock` 里的删锁一行，全部判据照绿（复审现测） | Rule 9 缺口，一行可修，下一轮修 |
| 3 | 闸门核对在子进程退出即定论后，不再杀钩子自己的进程组 ⇒ 同组残留进程活过核对（复审现测 `sleep 3172` 存活） | 判定仍正确，链不再挂住；下一轮在 settle 里补 `kill(-pid)` |
| 4 | 11abdbe 之前写下的链锁记的是本地时区起始时间，新代码按 UTC 读会判为「持有者不在」 | 至今没有任何真链跑过（活体验收待人点头）；误判只能经人手 `unlock` 生效 |
| 5 | 钩子退出 1 s 之后才到的 stderr 被丢弃 | 安全方向：只会误停，不会误放 |


---

## 14. E7 与闸门同组残留已修（2026-09-19）

归属：Codex task `01a0b792-9ebb-79d0-ba91-604825a9f974`；观测基点 `fd4d82c`，
修复提交 `4707eda92ad51f77dd3807ea57cc9a2585f054db`。人明确要求修 §13 第 2、3 条并同意继续。
本节追加，§13 原文保留；其中第 2、3 条的“下一轮修”由本次代码与变异证据取代。

- E7：锁不存在的断言移到测试自己的 `lock.release()` 之前。
  在本地 clone 删除 `src/chain/command.ts` 的 `await removeChainLock(repo)`：
  旧 E7 仍为 RC 0；新 E7 为 RC 1，实测锁仍存在（true），预期 false。
- settle：对钩子进程组调用 `process.kill(-child.pid, "SIGKILL")`，保留现有 stderr drain。
  新 K18 确认两个核对样本都启动了同组 `sleep 3172`，在测试清理之前检查它们已退出。
  旧生产代码下 RC 1；修复后 E7/K18 聚焦跑 RC 0；只删除新增 kill 一行后 K18 再次 RC 1。
  K18 teardown 清理变异遗留；K16 迟到 stderr 既有判据在全量跑中通过。

变异仅在 `git clone --local` 副本 `/tmp/orca-0919-fix-vfp4q8y7/repo`：
命令为 `node_modules/.bin/vitest run tests/chain/cli.test.ts -t E7`、
`node_modules/.bin/vitest run tests/chain/gateCheck.test.ts -t K18`；修复聚焦跑两文件 `-t 'E7|K18'`。
聚焦跑未匹配项有意不执行，不能代替全量通过。
settle 源文件 SHA256：修复版 `c12e3df69ed9ed711827f6f9f4756b9f85f2bebc29d5a0f116f922d37a2627cd`，
删 kill 版 `8e80ca2344fd3e6d32a7e913ce913e6851dca075df7912599ef5c3dac16d8aa8`。
副本以 `git show HEAD:<path>` 还原四个测试/生产文件后，`git diff` 与 `git diff --cached` 输出均 0 字节。
原始日志在上述临时目录的 e7-before/e7-after/k18-before/fixed/k18-mutation.log；已整份读回，临时目录不保证永久保留。

修复工作树（随后提交为 `4707eda`）现测 `rtk proxy npm run typecheck` RC 0；
`rtk proxy npm test` RC 0，129 files / 1075 tests 全部通过，无跳过；
完整日志 `/tmp/orca-tests-0919.log` 已按连续范围整份读回（初次工具总输出截断的段已重读）。
此次未重复全套 `npm run verify`；开工在 `fd4d82c` 跑的完整 verify 基线通过，见新 handoff。
真实 `~/.orca` 仍不存在。§13 第 1、4、5 条不因这次修复被宣布解决。

Claude Code 额度恢复时间由人告知为 2026-09-22 09:00 Asia/Shanghai；活体验收仍待人选 model 并点头。
Codex 替代测试路径的架构建议在 `2026-09-19-task-control-design.md`，不等于当前 chain 已支持 Codex。
