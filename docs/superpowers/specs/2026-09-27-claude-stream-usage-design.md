# claude 中止前观测用量（stream-json 逐条 usage）设计

- 作者：Orca 控制器会话 `4d2e426e`（Claude Opus 5.5），2026-09-27
- 观测锚点：ccloop 主题行 `docs(handoff): real claude also ran a 1M window and a two-task reconciliation once each`；Orca 主题行 `test(control): drive real claude through a 1M window and a two-task reconciliation in the live acceptance script`
- 进度源：`.superpowers/sdd/2026-09-27-claude-stream-usage/progress.md`（本 spec 落地时新建）
- 证据：`.superpowers/sdd/2026-09-27-claude-stream-usage/evidence/`
- 路径：architectural（跨 ccloop／Orca，改变 claude 阶段中止时的用量语义）。
- 修订：同一会话在人审时自审出 C1（观测路径）、C2（stream 体积）、I1（deadline 的歧义）、m1（花费精度），人 2026-09-27「同意，继续」后就地改入（本 spec 未发布）；过程记在台账 §2。人在对话里逐段认可了 §3 与 §5 的设计（2026-09-27：「对，继续下一段」「同意，继续」），并选了方案 B（见 §2.3）。

## 1. 要解决的问题

真 claude 下，一个阶段在中途被中止（handoff-stop、handoff 请求带的 deadline、SIGTERM —— 都经 `abortSignal` 走 adapter 的 `aborted` 路径）时，ccloop 报的用量**一律是 `null`**：

- runner 用 `claude -p --output-format json` 调 claude，这个模式只在进程退出时打印一份汇总回包，进程被杀就什么也没有。
- `src/runtime/claude/claudeAgentAdapter.ts` 的 `ClaudePhaseAborted` 把 `observedTokens` 写死为 `null`；中止的 execute 直接返回 `null`。

Orca 的规则（`src/control/usage.ts`、`budget.ts`、`driverHandoff.ts`、`checkpoints.ts`）：中止的阶段必须有一个**已知的正安全整数**用量，run 才可续；任何 `null` ⇒ run `settled-unrecoverable`（`usage-unsettled`）、组的 `usageUnknown` 置真、之后的领取全部被挡。`null` 从不当 0（handoff 投递 spec C-3 明文禁止）。

⇒ 今天在真 claude 下，一次 handoff deadline 中止或 handoff-stop 就会让整个组卡住。

⚠️ 本 spec 的「deadline」一律指 **handoff 请求带的 deadline**（ccloop control worker 到点后经 `abortSignal` 中止，`tests/control/handoffDeadlineUsage.test.ts` 就是这个形状）。**run 自己的运行时预算耗尽、或安装记录的 `timeoutMs` 到期**走的是 adapter 自己的 `timeout` 路径（`claudeAgentAdapter.ts` 里 `min(installation.timeoutMs, timeRemainingMs)` 那个计时器），见 §3.4。codex 没有这个问题：它的 NDJSON 里有 `turn.completed.usage`，ccloop 在中止时读最后一条（主题行 `feat(codex): report usage observed before a phase was aborted`）。

agent 选择 spec §11 把这件事登记为「下一片，字段形状要真 claude 实测」。本 spec 就是那一片。

## 2. 实测（claude 2.1.283，n＝1 每项，人批准的付费探针）

命令与脚本在 `evidence/probe.mjs`、`evidence/probe-partial.mjs`；调用都带 `agents detect` 草稿的隔离参数（含关 auto memory）与 `--max-budget-usd 2`，去掉全部 `CLAUDE*` 环境变量，cwd 是一次性 git 仓库，任务是「建 `answer.txt` 并读回」，带一个 object `--json-schema`。三次调用前后 `~/.claude/projects` 顶层条目相同。

### 2.1 `--output-format stream-json --verbose`（2026-09-27T05:55:58Z–05:56:18Z）

`evidence/complete.lines.json`，正常跑完，claude 自报 `total_cost_usd` ＝ `0.16708079999999997`：

1. 每条 `assistant` 事件带 `message.usage`。三条消息的 `input_tokens`／`cache_creation_input_tokens`／`cache_read_input_tokens` **逐条相加等于** `result.usage`（6／19,060／37,484，逐位相等）。⇒ 这三项是**每条消息各自的量，要相加**（第三方参考代码 ralph-orchestrator 说「取峰值」，对这个版本不成立）。
2. `assistant` 事件里的 `output_tokens` 是消息**开头**的快照（16／16／24，和 56），`result` 是 354；这些事件的 `stop_reason` 都是 `null`。
3. `result` 事件仍带 `structured_output`（与 `json` 回包同名同形），也带 `usage`、`total_cost_usd`、`modelUsage`。
4. 三条消息 id 互不相同，没看到同一 id 的 `assistant` 事件重复出现。

`evidence/killed.lines.json`：同样的调用，在第一条带 usage 的 `assistant` 事件到达时发 SIGTERM（5,306 ms）。退出码 143，**没有 `result` 事件**；被杀前流里有 `system/init`、一条 `assistant`（usage：input 2、cache 创建 1,610、cache 读取 16,975、output 16）、一条 `rate_limit_event`。stderr 为空。花费工具没给（没有 `result`）；上限 $2。

### 2.2 再加 `--include-partial-messages`（2026-09-27T07:37:44Z–07:38:01Z）

`evidence/partial.lines.json`，正常跑完，claude 自报 `total_cost_usd` ＝ `0.1670808`：

5. 每条消息的事件顺序：`stream_event/message_start`（带开头快照，与 §2.1 第 2 条同值）→ `assistant` → `stream_event/message_delta`（带**该消息最终的完整 usage**：输入、两个 cache 字段、`output_tokens`）→ `stream_event/message_stop`。
6. 三条 `message_delta` 的 `output_tokens` 为 153／85／118，**和 356 ＝ `result.usage.output_tokens` 356**；输入与 cache 三项与 `message_start` 同值，相加等于 `result`。
7. `message_delta` 不带消息 id，要与它之前最近的 `message_start`（带 `message.id`）配对。第三条消息里，工具结果（`user` 事件）出现在 `message_delta` 之前，配对仍按 `message_start` 走。
8. **体积**：这次调用的 stream 共 25,082 字节、输出 356 token，约 70.5 字节／输出 token（§2.1 不加该参数时 9,197 字节、约 26.0）；大头是逐块的 `content_block_delta`。此外 `user` 事件会原样回显工具结果（读文件时就是文件内容）。命令：对 `evidence/*.lines.json` 逐行求 UTF-8 字节和（本会话对话里的 python）。

### 2.3 由此得出的语义与人的选择

- 已收尾（见过 `message_delta`）的消息：用量**准确**。
- 被杀时正在生成的消息：只有 `message_start` 的快照，输出部分偏低 ⇒ 总数是**下界**。
- 方案（对话里给过 A／B／C）：A ＝ 只用 `assistant` 事件（输出偏低）；**B ＝ 加 `--include-partial-messages`，已收尾消息用 `message_delta`**；C ＝ 中止时按上限记账。**人选 B**（2026-09-27）。

### 2.4 顺带看到、本轮不处理（登记）

- 去掉全部 `CLAUDE*` 变量后，claude 仍在 `/tmp/cc-socks/<pid>.sock` 开 socket（init 事件的 `messaging_socket_path`）；三次调用（含被 SIGTERM 的那次）退出后都自己删掉了。SIGKILL 下是否残留没量。
- init 事件列出内置插件 `agents-md`、`telemetry`（`--setting-sources project,local` 不关它们）。

## 3. 设计（人已认可）

### 3.1 ccloop runner（`scripts/claude-phase-runner.mjs`）

1. 调 claude 的参数由 `-p --output-format json --json-schema <schema> …` 改为 `-p --output-format stream-json --verbose --include-partial-messages --json-schema <schema> …`（`--model` 与额外参数、prompt 的相对顺序不变）。
2. stdout **边到边按行解析**（NDJSON）；不能解析的行跳过，不报错。进程结束时若缓冲区里还有不带换行的最后一行，也尝试解析（一份 `json` 回包就是一行 `type: "result"`，所以只吐一行回包的替身照样可用）。
   🔴 **不保留整条流。** 今天 runner 把 claude 的 stdout 整条累积（`scripts/claude-phase-runner.mjs` 里 `stdout += chunk`）并设 `maxBuffer: 10 * 1024 * 1024`；stream 体积是 `json` 模式的数倍（§2.2 第 8 条），还回显工具结果，照旧累积会让长 execute 在 stream 模式下撞上限而失败。改为只保留三样：`result` 那一行、观测状态、stdout 的**滚动末尾 8,192 字符**（供 B2「非零退出时错误带 stdout 末尾」使用，字符数与今天一致）。未收尾的行缓冲也设上限（超过 10 MiB 的单行视为不可解析、丢弃并继续）。
3. **正常跑完**：取 `type: "result"` 的那一行作为回包，交给今天的 `buildUsageEvidence`，结构化输出取 `structured_output` ⇒ **正常阶段的 `tokenUsage` 与 `usageEvidence` 逐位不变**。没有 `result` 行 ⇒ 按今天「回包无法解析」的失败路径走。
4. **观测**：以消息 id 为键，每条消息记最新一份 usage —— `message_start` 时写入开头快照、标 `open`；配对的 `message_delta` 到来时覆盖为最终值、标 `closed`。`assistant` 事件的 usage 不参与（它与 `message_start` 同值，参与只会增加重复计数的风险）。
5. **观测总数**的口径与 `buildUsageEvidence` 相同：对每条消息按同一白名单选输入字段、输出字段，再加 `cacheFields` 两项；各消息相加；非有限值、负数跳过该字段；总数不是正安全整数 ⇒ 视为没有观测。
6. **观测文件的路径由 adapter 给**：adapter 在启动 runner 的环境里加 `CCLOOP_CLAUDE_OBSERVED_USAGE_PATH` ＝ `<该阶段证据目录>/observed-usage.json`。runner 与处理 `CCLOOP_CLAUDE_COMMAND`／`_EXTRA_ARGS` 一样，把它从传给 claude 的环境里剥掉（审阅 C1：runner 的 cwd 是 **worktree**，不给路径就只能写进 worktree，混进 diff）。变量缺失 ⇒ runner 不写观测（旧调用方行为不变）。
   每次观测变化后，**原子写**（同目录临时文件＋rename，文件 `0600`）到该路径：`{ schema: "ccloop-claude-observed-usage-v1", total, messages: [{ id, state: "open"|"closed", fields }], source: "stream-before-abort", lowerBound: true, openMessage: <是否有 open 的消息> }`。**不能等退出时才写**：adapter 在宽限期后会 SIGKILL 整个进程组。
7. 中止路径（SIGTERM／SIGINT 的 `handleInterrupt`、非零退出）不改退出码与现有输出，只是观测文件已经在盘上。

### 3.2 ccloop adapter（`src/runtime/claude/claudeAgentAdapter.ts`）

1. adapter 启动 runner 时设 `CCLOOP_CLAUDE_OBSERVED_USAGE_PATH`（§3.1 第 6 条）；`outcome.json` 记下该路径。
2. `ClaudePhaseAborted.observedTokens` 由写死 `null` 改为 `number | null`：阶段以 `aborted` 收尾时读该阶段的 `observed-usage.json`，`total` 是正安全整数 ⇒ 填入；文件不存在、解析失败、`total` 非法 ⇒ `null`（**不当 0**）。
3. 中止的 execute：**有观测就抛 `ClaudePhaseAborted`（带用量），没有才返回 `null`** —— 与 codex adapter 同形（`codexAdapter.ts` 那一行），于是 `runLoop` 以「只有用量、没有结果」记下这个阶段（`settlePhase(…, {tokenUsage}, true)`）。
4. 证据：观测文件留在阶段证据目录里，由 ccloop 既有的证据保留机制带走；`usage.json` 仍只在正常跑完时写。

### 3.3 Orca

**不改代码。** 它已经只要一个已知的正整数；有了它，中止的 run 可续、组不置 `usageUnknown`。

### 3.4 不在本轮

- adapter 自己的 `timeout`（run 的运行时预算耗尽或安装记录的 `timeoutMs` 到期；今天走通用 Error，不是 `ClaudePhaseAborted`）—— 行为不变，用量仍为 `null`。codex 在这条路径上同样不报用量（`codexAdapter.ts` 只在 `aborted` 时抛带用量的错误），两边口径一致。
- `usageObservation` 能力值仍答 `phase-end`（与 codex 一致；它描述的是「阶段末才有完整用量」）。
- 旧 `SubprocessClaudeAdapter` 与 `tests/fixtures/fake-claude.mjs` 不动。
- §2.4 两件。
- 已知的诚实限度：被杀时 open 的那条消息输出偏低，总数是**下界**；codex 那边报的是最后一个已完成 turn，同样是下界。证据里写明，不外推为「准确用量」。

## 4. 错误处理

| 情形 | 结果 |
|---|---|
| 流里一条 usage 都没有就被杀 | 没有观测文件 ⇒ `observedTokens: null` ⇒ 与今天相同（run 不可续、组 `usageUnknown`） |
| 最后一行被撕断 | 跳过；已写的观测文件不受影响 |
| usage 字段非有限值、负数 | 跳过该字段；总数不是正安全整数 ⇒ 不写观测／视为没有 |
| 观测文件写到一半被 SIGKILL | rename 是原子的，读到的要么是上一版要么是新版 |
| 观测文件损坏或 schema 不符 | adapter 视为没有观测 ⇒ `null` |
| 正常跑完却没有 `result` 行 | 按今天「回包无法解析」失败 |
| 单行超过 10 MiB | 该行丢弃、继续解析；若丢的正是 `result` ⇒ 按上一行失败 |
| 没有 `CCLOOP_CLAUDE_OBSERVED_USAGE_PATH` | 不写观测；中止时 `null`（与今天相同） |

## 5. 判据、fake 与变异（人已认可）

### 5.1 fake（夹具改动，不是判据）

`tests/fixtures/fake-claude-cli.mjs`：

- 同时认 `--output-format json` 与 `stream-json`，并接受 `--verbose`、`--include-partial-messages`（今天遇到未知参数就拒）。
- `stream-json` 下按 §2.2 的顺序吐：`system/init` → 一条消息的 `message_start`／`assistant`／`message_delta`／`message_stop` → `result`（`usage` 与今天 `json` 回包同值 `{input_tokens:12, output_tokens:3}`，使 N1 可比）。消息的 usage 取固定值，使各判据能逐位断言。
- 新模式：`usage-then-hang`（吐完一整条消息后挂住）、`start-then-hang`（只吐 `message_start` 后挂住）、`flood`（在 `result` 之前吐超过 10 MiB 的 `content_block_delta` 行，再正常收尾）。原 `hang` 仍一字不吐。
- `script` 模式的条目支持 `usageBeforeDelay`（照 fake codex）：在 `delayMs` 之前先吐一整条消息的事件。
- `json` 模式行为一字不变 ⇒ 直接调 fake 的既有判据（`tests/runtime/claude/fakeClaudeCli.test.ts`）不受影响。

### 5.2 新判据（只加）

| | 位置（ccloop，除 O1） | 钉什么 |
|---|---|---|
| N1 | `tests/runtime/claude/` | 正常跑完：stream 路径的 `tokenUsage`／`usageEvidence` 与同一份 `result.usage` 走 `json` 路径的值逐位相等 |
| N2 | 同上 | `usage-then-hang` 下中止：`observedTokens` ＝ 该消息 `message_delta` 的总和；观测文件 `openMessage: false`、`lowerBound: true` |
| N3 | 同上 | `start-then-hang` 下中止：`observedTokens` ＝ `message_start` 快照的总和；`openMessage: true` |
| N4 | 同上 | 中止的 execute 有观测 ⇒ 抛 `ClaudePhaseAborted` 带用量（不返回 `null`）；`runLoop` 记为 `completedWithResult: false`、`tokenUsage` ＝ 观测值 |
| N5 | 同上 | 撕断的末行、非法值、总数为 0 ⇒ `observedTokens: null` |
| N6 | 同上 | 观测文件写好后对 runner 进程组发 SIGKILL（不给 SIGTERM）⇒ adapter 仍读到观测值 |
| N7 | 同上 | 替身读 runner **实际传给它的** argv：含 `--output-format stream-json`、`--verbose`、`--include-partial-messages`（fake 只认形状的教训，见 Orca handoff §6） |
| N9 | `tests/runtime/claude/` | `CCLOOP_CLAUDE_OBSERVED_USAGE_PATH` 到达 runner、**不在** claude 子进程的环境里（替身打印自己的环境）；中止后观测文件在证据目录，worktree 里没有多出任何文件 |
| N10 | 同上 | `flood` 模式：阶段成功，`tokenUsage` 与 N1 相同 |
| N8 | `tests/control/` | 与 `handoffDeadlineUsage.test.ts` 同形的 claude 版：deadline 中止、带观测 ⇒ handoff 记录不把被中止的阶段列为缺失，用量为观测值 |
| O1 | Orca `tests/control/` | 端到端：fake claude（`usageBeforeDelay`），执行中途 handoff-stop（不是 run 运行时预算耗尽，见 §1）⇒ run 可续（`continuable`）、组 `usageUnknown` 为假；续跑落地 |

`tests/runtime/claude/claudeAgentAdapter.test.ts` 里钉「中止时 `observedTokens` 为 `null`」的那条判据（`hang` 模式，一字不吐）**原样成立、不改**：它编码的正是「什么都没观测到 ⇒ `null`」。

### 5.3 要人逐条点名改写的既有判据

⚠️ **更正（本会话对话里的说法）**：对话里说「只有两条」，不对。全树扫描（ccloop `tests/`，找钉 claude argv 位置或长度的断言）得出**四条**：新增的两个参数会让 `--model` 与 prompt 在 argv 里整体后移。每条只改 argv 的前缀、位置与长度断言，其余断言不动：

1. `tests/runtime/claude/claudeAgentAdapter.test.ts > ClaudeAgentAdapter (Orca agent selection, spec §4.7) > passes the selected model to the claude CLI and returns the structured answer with its usage`（前缀、`--model` 位置、长度 8、prompt 位置）
2. `tests/runtime/claude/claudeAgentAdapter.test.ts > ClaudeAgentAdapter (Orca agent selection, spec §4.7) > selects the 1M context window by the [1m] model suffix`（`--model` 位置）
3. `tests/runtime/claude/claudePhaseRunnerEnv.test.ts > claude phase runner command and extra arguments (Orca agent selection) > runs \`claude\` from PATH with its original arguments when neither variable is set`（长度 6、前缀、prompt 位置）
4. `tests/runtime/claude/claudePhaseRunnerEnv.test.ts > claude phase runner command and extra arguments (Orca agent selection) > runs the named argv tuple with the extra arguments before the prompt, never splitting on whitespace`（长度 8、`slice(5)`）

改写后每条旁边写明它现在编码什么、依据哪条人裁。实施时若全量又红出别的既有判据，**停下报人**，不自改。

### 5.4 变异（在 `git clone --local` 副本里，每条都要看见红）

| | 变异 | 预期红 |
|---|---|---|
| M1 | 不写观测文件 | N2、N3、N4、N6、N8、N9、O1 |
| M2 | 已收尾消息用 `message_start` 的值，忽略 `message_delta` | N2（值不等） |
| M3 | 不按消息 id 去重（`message_start` 与 `message_delta` 各记一份） | N2 |
| M4 | 总数为 0 也写入／也当观测 | N5 |
| M5 | 只在进程退出时写观测文件 | N6 |
| M6 | 去掉三个新参数（回到 `json`） | N7（N1 可能也红） |
| M7 | adapter 回到写死 `null` | N2、N3、N4、N8、O1 |
| M8 | 中止的 execute 有观测也返回 `null` | N4 |
| M9 | runner 不剥 `CCLOOP_CLAUDE_OBSERVED_USAGE_PATH` | N9 |
| M10 | 观测文件写到 cwd（worktree）而不是给定路径 | N9（N2 等也可能红） |
| M11 | 回到整条累积 stdout（带 10 MiB 上限） | N10 |

「预期红」是预言；实测不符时照实记下再处理，不改预言充数。

## 6. 成功判据（命令）

1. ccloop（scratchpad `git clone --local`，软链 `node_modules`，`npm run build`，先 `cd` 进 clone，HOME 与四个 XDG 根改道）：`npm run typecheck` RC 0；`npm run build` RC 0；全量 `vitest --reporter=json` 后 `node scripts/check-known-reds.mjs <json>` **RC 0**。
2. Orca（全新 clone，先 `npm run build --workspace web`；`ORCA_CCLOOP_BIN` ＝ 上面 ccloop clone 的 `dist/cli.js`；`ORCA_AGENTS_TABLE` ＝ fake codex `integration` 模式夹具表；HOME 与四个 XDG 根改道）：全量 RC 0、0 pending；真实 `~/.orca` 前后 `stat` 相同。
3. §5.4 每条变异：副本里跑相关文件，失败名单与预期对照记入台账；副本判据文件与工作树逐字节相同。
4. **付费验证（另需人点头）**：`scripts/live-driver-acceptance.ts --claude` 加一个「执行中途 deadline 中止 → 续跑落地」场景，真 claude 跑一次，n＝1。

## 7. 仓库外写入（Rule 17）

本轮不新增仓库外写入：观测文件写在 ccloop 的阶段证据目录（run 目录内）。付费验证沿用 `live-driver-acceptance.ts` 既有的改道与快照检查（`~/.orca`、`~/.claude/projects`）。
