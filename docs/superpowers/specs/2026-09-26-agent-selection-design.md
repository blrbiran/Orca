# Agent 选择：安装表、分层默认值、claude 走 ccloop control —— 设计

> **归属**：Orca 控制器会话 `75ec878e`（Claude Opus 5.5），2026-09-26。
> **人裁（本会话逐项点选或原话）**：
> - 「claude 走 ccloop control 模式」扩为：每个用户可设默认 agent、默认 model、默认上下文长度；task 等各层可覆盖；同一次 ccloop run 用同一组值；为 opencode／oh-my-pi／pi／litellm 多 provider 预留接口；subagent 级切换「不排除后续」。
> - 拆分：「片 1 ＋ 片 2 合并一轮」（agent 接口的缝＋claude 实现，与分层默认值同轮）。
> - 「用户」＝「身份先留接口」：按本机操作者实现，偏好按 `operatorId` 分键。
> - 冻结方式：「A＋C 合并」（安装表是机器事实、选择随 envelope 下发），「不介意大改，想要为以后打好基础，项目暂时没有上线」。
> - 安装表：「各个 agent 有一个默认的文件，先检测本机安装的 agent，再基于安装表微调」，参考 cc-switch（人授权读其源码）。
> - 第 1 节（概念与分层）、第 2 节（ccloop 侧，含三点：`--adapter` 形态直接换掉、`configHash` 重定义为物化配置的哈希、stream-json 延后）、第 3 节（Orca 侧）、第 4 节（错误、判据、不做的事）逐节同意。
> - profile 升 v2、删 adapter 身份字段：「同意删」。面板 UI：「本轮做全」。
>
> **观测锚点**：Orca 主题行 `docs(handoff): the handoff delivery round is done; claude over control is next` 那一笔；
> ccloop 主题行 `docs(handoff): roll the Orca section: C5-C7 and C-3 landed here for the handoff delivery round` 那一笔。
> **行号会移动 ⇒ 引用前现测。** 标「**控制器决定**」的是人没逐条点过、按 Rule 1 自决的；标「**Task 0 现量**」的是写 spec 时未量清、计划第一个 Task 必须先量并据实改落点的。
> ⚠️ **§12（复审裁定）优先于正文**；正文已按 §12 就地改过，§12 记的是每条发现的处置。
> 上游 spec：`2026-09-25-handoff-delivery-design.md`（§13.4 ＞ §13 ＞ §12 ＞ §11 ＞ 正文）、`2026-09-25-execution-driver-design.md`（§11、§12 优先）、`2026-09-19-web-recoverable-control-design.md`。

---

## 1. 问题（现量）

### 1.1 ccloop control 只接 codex

- `src/control/command.ts:123`：`if (argv[2] !== "codex") throw new Error("control-adapter-unsupported")`。
- `src/control/accept.ts:91`、`src/control/worker.ts:107`：`parseCodexConfig(...)`；`worker.ts:153`：`runLoop(contract, runDir, () => new CodexAdapter(config), …)`。
- `capabilities` 答一份与配置无关的常量（`command.ts` 的 `defaultHandler`），`contextWindowTokens: null`。

### 1.2 🔴 现有 claude 适配器放进 control 会让停机证明空洞成立

`src/runtime/claude/subprocessClaudeAdapter.ts` 的 `runPhase`：非 `detached` spawn、只对子进程发 `SIGTERM`、**从不调 `context.onProcessRegistered`**。而：

- `src/control/stopProof.ts` 的 `probeAll(processes, probe)` 对空数组恒 `true` ⇒ 在 claude 下 `processes.json` 恒为 `[]`，**`isolated: true` 空洞成立**（跨仓词表不一致第五次：「isolated」＝「所有已注册进程组都静默」，零注册时它不再意味着隔离）。
- `worker.ts` 的「prompt 前闩住」检查（`control-handoff-latched-before-prompt`）挂在 `onProcessRegistered` 上 ⇒ claude 下永不触发。

### 1.3 usage 也只在阶段末

`scripts/claude-phase-runner.mjs` 用 `claude -p --output-format json`，usage 取自最后一次性打出的信封（`buildUsageEvidence`）⇒ 阶段被中止时没有可观测的 usage，与真 codex 同形（④ 的 D-C3）。

### 1.4 Orca 侧写死 codex 的地方

`src/panel/controlAssembly.ts:135`（选端口）、`src/control/ccloopPort.ts:33-35`（端口选项与校验）、`src/control/executionPort.ts:24`、`src/control/driverLanding.ts:285`（解冲突 `ccloop run`）、`src/control/webProtocol.ts:143`（profile 只对 codex 加约束）。

### 1.5 选择表达不出来，profile 的 adapter 身份没绑到任何东西

- 一个面板只有一份 `ORCA_CCLOOP_ADAPTER_CONFIG`；任务的 `configHash` 来自人手写的 plan 文件（`src/scheduler/planFile.ts` 的 `planTaskSchema`），且必须等于那唯一一份配置的 canonical hash（ccloop `accept.ts` 核）⇒ **「按任务换模型」今天表达不出来**。
- execution profile 快照声明了 `adapter`／`adapterConfigRef`／`modelPolicyRef` 与 `resolved.adapterConfigContentHash` 等（`webProtocol.ts` 的 `executionProfileSnapshotSchema`），但 `src/` 里**没有任何代码**把它们与端口实际用的配置对上（`grep adapterConfigRef src` 只命中 schema 定义）。

### 1.6 已经具备、本设计复用的

- **冻结机制**：claim 的 `configHash` 在 ccloop accept 时核对；Orca 的 continuation（`continuation.ts:35`）、驱动环（`executionDriver.ts:314`）、dispatch（`dispatch.ts:24`）都按 `configHash` 相等核身份 ⇒ **「同一次 run 同一组值」已被机械保证**，只要让 `configHash` 覆盖选择。
- **命令台账**：`set-workspace-mode`（`src/control/workspaceSettings.ts`）是「操作者设置走 `orca-raw-command-v1`、带 `expectedRevision`」的现成形状。
- **提案版本**：`proposal-edit` 推进 `proposalVersion`，`confirm` 绑定 `proposalVersion`（`webProtocol.ts` 的 `confirmPayloadSchema`）。

### 1.7 cc-switch 的参考（人授权读源码，`/Users/biran/code/skills/cc-switch`；控制器抽查三处引用已核）

- 支持的 app：`src-tauri/src/app_config.rs` 的 `enum AppType`（Claude／ClaudeDesktop／Codex／Gemini／GrokBuild／OpenCode／OpenClaw／Hermes／Pi／Mcode）。**没有一张统一的 agent 注册表**，二进制名、配置目录、npm 包分散在十几个文件里。
- 探测（`src-tauri/src/commands/misc.rs`）：先在登录 shell 跑 `<tool> --version`（exit 127 ＝ 没装）；没找到再按 `build_tool_search_paths` 的候选目录扫（`~/.local/bin`、npm-global、`~/n/bin`、volta、mise、homebrew、fnm、nvm，外加每种 agent 自己的目录），最后扫 PATH；版本用正则 `\d+\.\d+\.\d+(-[\w.]+)?` 取。
- 多份安装全列：`enumerate_tool_installations` ＋ `struct ToolInstallation { path, version, runnable, error, source, is_path_default, real }` —— **本设计安装表的行模板**。
- 1M 上下文：`claude_desktop_config.rs` 的 `ONE_M_CONTEXT_MARKER = "[1m]"`，写在 model 名的后缀上；代理转发时剥掉后缀、改发 beta header。
- 导入：首次运行把现有配置导入为 `default`；补齐缺失的字段，**从不覆盖已有值**。
- cc-switch 不读 `CLAUDE_CONFIG_DIR`／`CODEX_HOME` 这两个环境变量（它从真身路径推出 `CODEX_HOME` 传给 installer，M2）；本设计把配置目录记进安装记录（§4.2 `configDir`）。

---

## 2. 范围

**做**：
1. ccloop：agent 注册表（描述、安装表 schema、探测、选择校验、适配器工厂）；`ccloop agents detect|validate`；`control` 改为 `--agents <table>`；envelope v2（claim 带选择）；`capabilities` 带选择；新 `ClaudeAgentAdapter`（进程组注册）；CLI 层的 fake claude（新文件，§4.8）；`ccloop run` 加 `--agents --agent-selection`。
2. Orca：四层解析（出厂 → 操作者 → 组 → 任务）、三个槽位（worker／estimator／reconcile）、确认时冻结、profile v2、端口改为「一个二进制＋一张表」、`orca agents init|show`、plan 文件 `agent` 字段（删 `configHash`）、两个新命令动词、面板设置页与提案视图的选择编辑。
3. 驱动环 E2E（fake claude＋fake codex 混组）与全套门。

**不做**（每条都登记在 §11）：真 claude 付费跑；stream-json 逐条 usage；opencode／oh-my-pi／pi／litellm 的实际接入（只留注册表接口）；subagent 级切换；多用户身份与鉴权；删旧的 `SubprocessClaudeAdapter`；`capabilities` 计算化（`requestBoundProof` 仍 `null`）；⑤ 预算预估链；strict 组。

---

## 3. 概念

| 概念 | 是什么 | 住在哪 | 谁写 |
|---|---|---|---|
| **Agent 描述**（descriptor） | 每种 agent kind 一项：二进制名、候选目录顺序、版本探测命令、配置目录及其环境变量、出厂默认 model、能表达的上下文档位、`validateSelection`、`createAdapter` | ccloop 代码常量（`src/agents/`） | 随代码发布 |
| **安装表**（installation table） | 按 `installationId` 分键：`{kind, command, version, timeoutMs, killGraceMs, …kind 专属字段}` | 一个 JSON 文件，Orca 默认 `~/.orca/agents.json`，可由 `ORCA_AGENTS_TABLE` 改道（§8） | `agents detect` 出草稿，人（或代劳的 agent）微调 |
| **选择**（selection，`agent-selection-v1`） | `{agent: installationId, model: string, contextWindow: "agent-default" \| positiveSafeInteger}`（§12 I6：不用 `null`，免得与能力里「`null`＝不知道」混义） | 解析后冻结在 work item 与 start envelope claim 里 | 由分层解析得出 |
| **偏好层** | 各层对选择的部分覆盖（只写想覆盖的字段） | 见 §6.2 | 操作者、plan 文件、面板 |
| **物化配置** | `{schema: "ccloop-agent-config-v1", kind, installation: <表里那一条>, selection: <填满默认值后>}` | 只存在于计算中与 ccloop `<sourceDir>/control/config.json` | ccloop 计算 |

**不变量**：
- **I1**：一次 ccloop run 从 accept 到 settle 只用一份物化配置；它的 canonical hash 就是 claim 的 `configHash`。续跑继承前任的同一份选择；解冲突 run 用组冻结的 reconcile 选择（§6.1），它的 `configHash` 由 `ccloop run` 核对（§4.9）。
- **I2**：model 与上下文对 Orca 是**不透明值**；只有该 kind 的 `validateSelection` 判断能否表达、`createAdapter` 负责翻译成 CLI 参数。Orca 不据上下文长度截断、压缩或估算。
- **I3**：**物化规则只住在 ccloop 一处**（Rule 5）。Orca 不重算 `configHash`，一律从 `control capabilities` 的应答里拿。
- **I4**：安装表里**不放密钥**。将来 provider 类记录（如 litellm 端点）只存环境变量**名**。

**为以后预留的接口**：
- 新 agent kind ＝ 一个描述 ＋ 一个适配器，注册进 `src/agents/registry.ts`；Orca 零改动（kind 对 Orca 也是不透明值，面板从 `agents show` 的应答里取列表）。
- 多 provider：同一 kind 的第二条安装记录（例：`{id: "claude-litellm", kind: "claude", env: {ANTHROPIC_BASE_URL: …}, secretEnv: ["ANTHROPIC_AUTH_TOKEN"]}`），**选择层不改**；model 字符串（如 `litellm/anthropic/claude-…`）由该 kind 的适配器解释。`env`／`secretEnv` 两个字段**本轮不实现**，schema 以 `.strict()` 拒收，届时随 provider 那一片一起加 —— **控制器决定**：预留的是「按 id 分键」这个形状，不是字段。
- subagent 级切换：会破 I1，届时与 `agent-selection-v2` 一起设计，**本轮不留字段**。

---

## 4. ccloop 侧

### 4.1 注册表与描述（`src/agents/`）

```ts
interface AgentDescriptor<I, S> {
  kind: string;                       // "claude" | "codex"（今天）
  binary: string;                     // "claude" | "codex"
  searchDirs(env, home, platform): string[];     // 有序候选目录
  configDir: { envVar: string | null; fallback: string };  // CLAUDE_CONFIG_DIR / CODEX_HOME
  defaults: { model: string; contextWindow: "agent-default" | number };
  contextOptions: Array<"agent-default" | number>;   // 能表达的档位
  installationSchema: ZodType<I>;     // kind 专属字段，strict
  validateSelection(sel): S;          // 表达不了 ⇒ throw 具名错误；model 一律拒以 `-` 开头、含空白/控制字符、超 200 字符（§12 I14）
  capabilities(installation: I, sel: S): CapabilityViewV2;
  createAdapter(installation: I, sel: S): RuntimeAdapter;
}
```

- **claude**：`defaults = {model: "claude-opus-5-5", contextWindow: "agent-default"}`（Task 0 现量：人给的 `opus-5.5` 不是 CLI 认的拼写）；能表达的档位 `"agent-default"` 与 `1_000_000`（⇒ `--model <model>[1m]`，Task 0 已核实，见下）。
  🔴 **Task 0 现量**：1M 怎么传给 claude CLI。本机 `claude --help`（2.1.282）的 `--model` 只写了「别名或全名」，**没写 `[1m]` 后缀**；另有 `--autocompact <auto|tokens>`（100k–1M）。cc-switch 用 `[1m]` 后缀，但那是 `settings.json` 的 env 路径，不是 `--model` 参数。⇒ Task 0 先做零成本的核对（`--help`、源码或文档、不发请求的参数解析），核不清就把 `1_000_000` 档位**关掉**（`validateSelection` 拒 `agent-context-unsupported`），留到真 claude 付费跑那一片再开。**不许在没核清时假定它能用。**
  ✅ **Task 0 已核实（台账 §1）**：本机 claude 二进制内含 `append [1m] to the model name for 1M`、别名表 `…,"sonnet[1m]","opus[1m]","fable[1m]",…`、全名 `claude-opus-5-5[1m]` ⇒ 1M ＝ `--model <model>[1m]`，档位开启。真 claude 是否真的拿到 1M 窗口，要付费跑才能观测（§11）。
- **codex**：`defaults = {model: "gpt-6-sol", contextWindow: "agent-default"}`（人给的例子，与人本机 `~/.codex/config.toml` 一致，台账 §1）；本轮只表达 `"agent-default"`。installation 专属字段：`sandbox`、`budgetMode: "soft"`（沿用 `parseCodexConfig` 的约束）。

### 4.2 安装表 schema（`agents-table-v1`）

```json
{
  "schema": "ccloop-agents-table-v1",
  "installations": {
    "claude": { "kind": "claude", "command": ["/abs/path/claude"], "version": "2.1.282", "configDir": null,
                "timeoutMs": 1800000, "killGraceMs": 5000 },
    "codex":  { "kind": "codex", "command": ["/abs/path/codex"], "version": "…", "configDir": null,
                "timeoutMs": 1800000, "killGraceMs": 5000, "sandbox": "workspace-write", "budgetMode": "soft" }
  }
}
```

- 读表：`O_NOFOLLOW`、必须是普通文件、`realpath` 等于自身（沿用 `command.ts` 对 `--adapter-config` 的检查）；不合法 ⇒ `agents-table-invalid`。
- `installationId` 用 `idSchema`；`command` 是 argv 元组 `[绝对路径, ...参数]`（与 `parseCodexConfig` 一致，§12 C2；E2E 的 fake 靠参数开动），存**找到时的路径**，不存 realpath（M3；nvm 装的 CLI 是 `#!/usr/bin/env node` 脚本，worker 的 PATH 里须有 node）。
- `timeoutMs ≤ 2_147_483_647`、`killGraceMs ≤ 60_000`（沿用 `protocol.ts` 的上限，M10）。
- `configDir`：`null` 或绝对路径；非 `null` 时 spawn 显式设置该 kind 的配置目录环境变量（claude ⇒ `CLAUDE_CONFIG_DIR`，codex ⇒ `CODEX_HOME`），因为它在记录里所以进哈希（§12 I14）。
- `version`：探测时记下的版本串。**accept 与 capabilities 各跑一次 `command --version`，与表里的 `version` 不等 ⇒ `agent-version-drift`**（§12 C6：原地升级、自动更新不改表也不改哈希，只有这样才抓得到）。
- 读表还要求：属主 ＝ euid、`mode & 0o022 == 0`，父目录同样（§12 I14）。
- **只有 `capabilities` 与 `accept` 解析表**；`inspect`／`handoff`／`collect`／`read-evidence` 只核 `--agents` 的路径形状、不读内容（§12 I4：表坏了不许挡在飞 run 的回收）。

### 4.3 探测：`ccloop agents detect [--home <dir>] [--path <PATH>]`

（⚠️ 与 claude CLI 自己的 `--agents` 参数、`agents` 子命令同名但无关，M8。）

- 对每个描述：先按 `searchDirs` 与 `PATH` 找出**全部**候选（**跳过非绝对路径的 PATH 条目与全局可写目录**，§12 I14），按 realpath 去重；每个跑 `<path> --version`（超时 10 s，只跑这一条命令），记 `{path, realpath, version, runnable, source, isPathDefault}`（仿 cc-switch `ToolInstallation`）。
- **不走登录 shell**（**控制器决定**，与 cc-switch 不同）：登录 shell 会执行人的 rc 文件，结果不可复现、判据也没法改道；我们用显式的候选目录表 ＋ 调用方给的 `PATH`，`--home`／`--path` 让判据能完全改道。代价：只装在 rc 文件里临时加的目录下的 agent 探不到 —— 人在草稿里手填即可。
- 输出（只到 stdout，**ccloop 不往用户目录写任何东西**）：`{schema: "ccloop-agents-detect-v1", table: <草稿安装表，每种 kind 选 isPathDefault 那一份，否则第一份 runnable>, candidates: {<kind>: [...全部候选]}}`。
- 什么都没探到的 kind 不进草稿表，只出现在 `candidates` 里（空数组）。

### 4.4 `ccloop agents validate <table>`

校验表（§4.2）并对每条跑一次 `--version`；输出每条的 `{id, ok, error?}`；RC 0 ⇔ 全部 ok。Orca 的 `agents show` 用它。

### 4.5 control 命令形态（直接换掉，人裁）

`ccloop control <method> --agents <table>`。`--adapter`／`--adapter-config` 在 control 下**不再接受**（`control-command-invalid`）。

### 4.6 envelope v2 与 `capabilities`

**StartEnvelopeV2** ＝ V1，改动只有：`protocol: 2`；`claim` 新增 `agent: AgentSelectionV1`（**已填满默认值的完整选择**）；`configHash` 的含义改为「物化配置的 canonical hash」。`HandoffRequestV1` 不变。

**`capabilities`**：请求 `{agent: PartialSelection | null}`。
- `null` ⇒ 答表级视图：`{protocol: 3, installations: [{id, kind, defaults, contextOptions}]}`（面板用来列 agent）。
- 非 `null` ⇒ 先用描述默认值补满，再 `validateSelection`，再物化，再做 `--version` 核对 ⇒ 答 `{protocol: 3, selection: <完整选择>, configHash, timeoutMs, killGraceMs, capabilities: <CapabilityViewV1 八字段，不带 protocol>}`。
  - **请求里给了的字段原样回显**（不把别名规范化成全名，M5）——Orca 的来源标注靠逐字段比对。
  - `capabilities.contextWindowTokens`：只在描述里有 **Task 0 核实过的**映射时非 `null`（今天只有 claude 的 `1_000_000` ⇔ `[1m]`）；`"agent-default"` ⇒ `null`（＝不知道），**不把请求值冒充观测值**（§12 I6）。
  - `timeoutMs`／`killGraceMs` 来自物化配置，Orca 冻结在 work item 上（§12 I5）。
- 🔴 **线上协议版本**：capabilities 的应答形状变了 ⇒ `protocol` 从 2 升到 3（**控制器决定**：沿用「形状变则升号」的已有做法，G1 缝 A 就是 1→2）。Orca 的 `capabilitiesSchema` 同步改。

**accept**：按 `claim.agent.agent` 在表里找安装记录 → `validateSelection(claim.agent)` → 物化 → `canonicalHash` 必须等于 `claim.configHash`，否则 `control-config-hash-mismatch`；物化配置写进 `<sourceDir>/control/config.json`（取代今天的 codex 配置）；`--version` 不等 ⇒ `agent-version-drift`。
**升级不跨越在飞的 run**：v1 时 accept 的 run，升级后的 worker／inspect 读不回（项目未上线，接受；§12 I1）。
**worker**：读 `config.json` → 按 `kind` 取描述 → `createAdapter(installation, selection)`。

### 4.7 `ClaudeAgentAdapter`（新写，旧的不动）

形状照 `src/runtime/codex/runCodexPhase.ts`：
- `spawn(node, [claude-phase-runner, …], {detached: true})`，runner 通过环境变量拿到安装表里的 claude 绝对路径、`--model` 参数与上下文参数（Task 0 定形）。**runner 与 claude 子进程同属该进程组。**
- `once("spawn")` 后取 `ps -o lstart=` 做进程身份，**先 `await context.onProcessRegistered(...)` 再写 stdin 的 prompt**（与 codex 同序；闩住检查因此生效）。
- 超时 `min(installation.timeoutMs, state.budgetSnapshot.timeRemainingMs)`；中止：对 `-pgid` 发 `SIGTERM`，`killGraceMs` 后 `SIGKILL`。
- 证据：`run/claude/<attempt>/<phase>/call-*/{request.json, stdout.json, stderr.log, process.json, outcome.json}`，0600／0700。
- usage：沿用 runner 的 `usageEvidence`／`tokenUsage`；被中止 ⇒ 抛带 `observedTokens: null` 的 `ClaudePhaseAborted`（形状同 `CodexPhaseAborted`），**不当 0、不估**。
- runner（`scripts/claude-phase-runner.mjs`）只**加**：从环境变量取 argv 元组（JSON 数组，**不按空白切分**）与额外参数（JSON 数组，含 `--model <model>[1m]`），缺省仍是 `claude`、旧路径行为不变（§12 I14）。
- `request.json` 不记录环境变量（M6）。
- ⚠️ 已知限制：claude 的工具（Bash 等）若把子进程放进**另一个进程组或会话**，按 `-pgid` 杀不到、停机探测也看不到 —— 登记 §11，别把判据 5 读成「整棵树都杀掉了」（§12 I15）。

### 4.7b 停机证明不再对「零注册」空洞成立（§12 C7，对所有 kind 生效）

worker 在 `onPhaseSettled` 里对**带结果完成**的阶段计数（一个带结果完成的阶段必然起过 provider 进程），落盘 `<sourceDir>/control/phases-completed.json`。
`proveStopped`：计数 > 0 且 `processes.json` 为空 ⇒ 返回 `null`（不给 isolated）。被中止于 spawn 之前的阶段不计数，零注册在那种情况下是真的隔离。
这样将来任何一个忘了调 `onProcessRegistered` 的适配器都会让停机证明失败，而不是空洞成立。

### 4.8 CLI 层的 fake claude（`tests/fixtures/fake-claude-cli.mjs`，新文件）

⚠️ 既有的 `tests/fixtures/fake-claude.mjs` 是 **runner 层**的替身（读一个 JSON 请求、直接答结构化结果），给旧 `SubprocessClaudeAdapter` 用 —— **原样不动**（§12 C1）。
新文件站在 **`claude` 二进制**这一层：解析 `-p --output-format json --json-schema <schema> [--model <m>] <prompt>`，打印 `{structured_output, usage}`；答 `--version`；模式与 marker 同 fake codex（`script <marker> <scriptPath>`，经 `command` 元组的参数传入）。
- `.calls`（每次一行 phase）与 `.tasks`（`<phase> <entry key|->`）**格式与 fake codex 完全相同**，`ccloopWorld` 的 `calls()`／`scripted()` 不改就能读。
- 脚本条目支持 `delayMs`、按 `<task>#continuation` 取（C5 的三项）。**不做 `usageBeforeDelay`**：claude 走 json 信封、中止恒报 `null`，没有读者（§12 I13）。
- **argv 逐次追加到新的 `<marker>.argv`（每次调用一行 JSON 数组）**；fake codex 同样改成追加到 `.argv`（今天 `fake-codex.mjs` 把 `args` 覆盖写进 marker，保留不动，只加 `.argv`）。E2E 用 `.argv` 证明选择一路到了 CLI 参数。

### 4.9 `ccloop run --agents <table> --agent-selection <file>`

与旧 flag 互斥（判据覆盖）；Orca 的解冲突 run 走这个形态。选择文件 `{selection, configHash}`、0600，由 Orca 写在该解冲突 run 自己的 workdir 里；ccloop 物化后比对哈希与 `--version`，不等 ⇒ 以 `control-config-hash-mismatch`／`agent-version-drift` 退出非 0（§12 C5）。
`ccloop resume`／`sweep` **本轮不加** `--agents` 形态：`--agents` 起的 run 不可 resume／sweep（驱动环对解冲突孤儿走 `reconcile-orphan-unknown`，不走 resume），登记 §11（§12 I11）。

### 4.10 既有判据（**不许自改，人按人裁 88 指名**）

人 2026-09-26「同意修改几个仓库的现有test」⇒ 概括授权，改写的每一条事后逐条列名进台账报人（人裁 88 (b)(c) 照旧）。两仓都算（§12 I12，含 Orca 的 `fake-ccloop-control.mjs`、`ccloopWorld.ts`、`webCcloopSmoke`、`handoffE2E`）。预计受影响：`tests/control/command.test.ts` 钉死八字段那一条；control accept／worker／endToEnd 里写死 `--adapter codex` 与 v1 envelope 的判据；`verify-control-protocol.mjs`。**未被指名的一条不动**；能「只加不改」的一律只加。

---

## 5. 线上契约变化汇总（两仓同步落地）

| 项 | 旧 | 新 |
|---|---|---|
| control 调用 | `--adapter codex --adapter-config <file>` | `--agents <table>` |
| start envelope | `protocol: 1` | `protocol: 2`，claim 加 `agent` |
| `configHash` | codex 配置的 canonical hash | 物化配置 `{schema, kind, installation, selection}` 的 canonical hash |
| `capabilities` 请求 | `{}` | `{agent: PartialSelection \| null}` |
| `capabilities` 应答 | `protocol: 2` 八字段 | `protocol: 3`：表级视图或 `{selection, configHash, capabilities}` |
| 解冲突 run | `ccloop run --adapter codex --adapter-config` | `ccloop run --agents --agent-selection` |

**版本号并存**（M4）：envelope `protocol: 2`、capabilities `protocol: 3`、handoff request `protocol: 1`；ccloop `protocolVersion()` 对 handoff／collect／read-evidence 读的是 `input.protocol`（envelope 的 2）。

### 5.1 消费者清单（§12 I1／I2／I10／I11，计划据此逐项落点；行号引用前现测）

| 改动 | ccloop | Orca |
|---|---|---|
| envelope v2 ＋ `claim.agent` | `src/control/protocol.ts`（claim schema、`protocolVersion`）、`worker.ts`（读 `envelope.json`）、`accept.ts` | `src/control/schema.ts`（`startEnvelopeSchema`）、`executionPort.ts`（`StartEnvelope`）、`startEnvelope.ts`（拼 claim）、`dispatch.ts`（`protocol!==1` 闸）、`ownership.ts`（`assertClaimIdentity` 键表）、`schedulerBridge.ts`（`claimOnly`）；造 run 行处拷 `agent`：`webDispatch.ts`、`continuation.ts`、`budget.ts`、`service.ts` |
| capabilities v3 | `command.ts`（`defaultHandler`、响应 schema） | `webProtocol.ts`（`capabilitiesSchema`）、`types.ts`（`Capabilities`）、`budget.ts`（`assertCapabilities`）、`ccloopPort.ts`、`unconfiguredPort.ts`、`profiles.ts`（probe）；测试替身 `tests/control/fixtures/fake-ccloop-control.mjs`（**替身本身就是判据**，G1 §7.2）、`ccloopWorld.ts`（不再自己重算 `configHash`） |
| `--agents` 取代 `--adapter*` | `command.ts`、`cli.ts`（`run` 的新形态） | `ccloopPort.ts`、`executionPort.ts`、`controlAssembly.ts`、`driverLanding.ts`、`scheduler/ccloopRunner.ts`（`runTask` 被旧 `orca run` 与解冲突共用：旧 `orca run` 保留 `--adapter` 形态） |
| `ORCA_CCLOOP_ADAPTER_CONFIG` → `ORCA_AGENTS_TABLE` | — | `panel/controlOptions.ts`、`panel/controlConfig.ts`（含 `execution-port-adapter-config-mismatch` 不变量）、`control/unconfiguredPort.ts`、`web/src/ControlPanel.tsx`、`scripts/verify-control.mjs`、`scripts/live-driver-acceptance.ts`、`src/cli.ts` |
| 封闭 schema／枚举跟改 | — | `commandVerbSchema`、raw／effective 两套 variants、result kinds、`web/src/controlTypes.ts`、`controlPlanSchema`、`planTaskSchema`／`planFileSchema`、`workSchema`、`executionSnapshotSchema`、命令台账 scope（新 `operator`） |

**升级不跨越在飞的 run**（项目未上线，接受）。

🔴 **推送顺序**（沿用 G1 的教训）：两仓的这几笔要么都在远端、要么都不在；**先推 ccloop 再推 Orca**。推送归人（Rule 15），本设计只把顺序写进 awaitingHuman。

---

## 6. Orca 侧

### 6.1 槽位

| 槽位 | 粒度 | 可覆盖的层 | 缺省 |
|---|---|---|---|
| worker | 按任务 | 操作者 → 组 → 任务 | — |
| estimator（`budget-estimate` run） | 按组 | 操作者 worker 默认 < 操作者 `estimator` < 组 `estimatorAgent` | 见 §6.3 |
| reconcile（解冲突 run） | 按组 | 操作者 worker 默认 < 操作者 `reconcile` < 组 worker（`agent`）< 组 `reconcileAgent` | 见 §6.3 |

handoff 是 `mechanical-in-run-v1`、零模型调用 ⇒ 无槽位。goal-review 今天没有执行路径 ⇒ **本轮不设槽位**（**控制器决定**，有了执行路径再加）。

### 6.2 各层载体

| 层 | 载体 | 写入 |
|---|---|---|
| 0 出厂 | ccloop 描述 | 不可写 |
| 1 操作者 | 控制 store 新表 `agent_preferences(operator_id PK, revision, doc_json)`，`doc = {defaultAgent?, perAgent: {<installationId>: {model?, contextWindow?}}, estimator?: PartialSelection, reconcile?: PartialSelection}` | 新动词 `set-agent-preferences`（`orca-raw-command-v1`、`expectedRevision`、目标是当前 `panelOperatorId`） |
| 2 组 | plan 文件顶层 `agent?`、`estimatorAgent?`、`reconcileAgent?`；面板组级设置 | 新动词 `proposal-set-agent`（目标 group 或 task，推进 `proposalVersion`） |
| 3 任务 | plan 文件任务字段 `agent?`；面板逐任务设置 | 同上 |

- 每层都是 `PartialSelection = {agent?, model?, contextWindow?}`；合并规则的形式定义见 §6.3。
- **换 agent 会丢掉为别的 agent 设的 model／上下文**（**控制器决定**：否则「操作者默认 claude，任务改成 codex」会解析出 `codex + claude-opus-5-5`，必错）；形式定义见 §6.3。
- plan 文件的 `configHash` 字段**删除**（`planTaskSchema` 改；带 `configHash` 的 plan 被拒，判据覆盖）；`targetVersion` 不变。
- `ControlPlanV1.tasks[].configHash` 删除（它进 `planHash`）；已发布的 Web spec 按 Rule 13 另起一节 ERRATUM（§12 I3）。草稿 work item 的 `configHash` 改为 `null`，确认时写入。
- 命令台账新增目标 `{kind: "operator", operatorId}` 与 scope `operator`，revision 取自 `agent_preferences.revision`（仿 `repositoryRevision`，§12 I10）。
- 🔴 **信任边界**：model 是浏览器发来的自由字符串，放宽了 Web spec §3.1「浏览器只发稳定 id、组命令、可编辑数值策略」—— Web spec 另起一节 ERRATUM；ccloop `validateSelection` 做字符约束（§4.1），面板不做任何拼接（§12 I14）。

### 6.3 解析（纯函数，`src/control/agentSelection.ts`）

输入：一个槽位的**有序层列表** `L = [l_1 … l_n]`（优先级从低到高），每层 `{name, agent?, model?, contextWindow?}`；另给操作者的 `perAgent` 表。各槽位的层序：
- worker：`[操作者{agent: defaultAgent}, 组{plan 顶层 agent ⊕ 面板组级}, 任务{plan 任务 agent ⊕ 面板任务级}]`
- estimator：`[操作者{agent: defaultAgent}, 操作者.estimator, 组.estimatorAgent]`
- reconcile：`[操作者{agent: defaultAgent}, 操作者.reconcile, 组{agent}, 组.reconcileAgent]`

（同一层里 plan 文件与面板都给了值：面板覆盖 plan，逐字段。）

```
eff(l_0) = undefined
eff(l_i) = l_i.agent ?? eff(l_{i-1})              // 每层「生效的 agent」
A = eff(l_n);  A === undefined ⇒ throw agent-unselected
for f in [model, contextWindow]:
  v = 最高优先级的 l_i 使 eff(l_i) === A 且 l_i[f] !== undefined 的那个值
  v ??= perAgent[A]?.[f]                          // 来源 "operator-agent"
  // 仍 undefined ⇒ 留空，由 ccloop 用描述默认值补（来源 "descriptor"）
```

输出 `{partial, provenance: {agent, model, contextWindow: 层名 | "operator-agent" | "descriptor"}}`。
- 它**只合并**，不补描述默认值（I3）；`"descriptor"` 由 capabilities 应答与 `partial` 逐字段比得出（依赖 §4.6 的原样回显，M5）。
- 裁定（§12 I8）：(a) 任务层显式写了与上层相同的 agent ⇒ 上层为 A 设的 model 照样有效（`eff` 相同）；(b) model 与上下文同一规则；(c) 输入形状如上；(d) 组级值总是胜过操作者级值；(e) 哪层都没给 agent ⇒ `agent-unselected`。

### 6.4 冻结（确认时）

confirm 改为**异步**，形状仿 `importControlPlanAsync`（§12 C4）：
1. 事务外：对每个任务的 worker 槽、组的 reconcile 槽求 `partial`（§6.3）；按 `partial` 的 canonical JSON 去重后调 `port.capabilities({agent: partial})`；
2. 任何一个失败 ⇒ **整次 confirm 拒**：`agent-selection-rejected:<taskId|slot>:<ccloop 码>`；
3. 算 `selectionsHash` ＝ 逐槽位 `{partial, selection, configHash}` 的 canonical hash；**confirm payload 新增 `selectionsHash`**（面板预解析时算出、随确认发来）；两者不等 ⇒ `agent-selection-changed`（守「冻结的就是用户看到的」：操作者偏好、安装表都不推进 `proposalVersion`）；
4. 事务内：重核 `proposalVersion` 与 `selectionsHash`，写入 work item 的 `agent`（完整选择）、`agentProvenance`、`configHash`、`timeoutMs`、`killGraceMs`、能力交集；组记录写 reconcile 的同一组字段；执行快照升 v2，带上逐任务的这些字段与组的 reconcile 选择（§12 I3）；`readConfirmedTaskExecution` 与 `controlViews` 以快照为权威核对；
5. 确认之后改操作者默认值，**对已确认的组不生效**。

**派活闸门用哪个选择**（§12 C3，逐调用点）：`webDispatch.ts` 的 `scheduleStart`／`deliverScheduledStart`、`dispatch.ts` 的两处 `assertCapabilities`、续跑、reconcile-start ⇒ 用**该 run 冻结的** `agent`；handoff profile 的探测 ⇒ 用被 handoff 的那个 run 的选择（handoff 无槽位）；估算 ⇒ 冻结的 estimator 选择；只有面板的 profile 展示（`controlConfig.ts` 的 `readView`）用操作者默认。旧 `service.ts`／`stopIntent.ts`（model-assisted handoff）同样用各自 run 的冻结选择。

`budget-estimate` 在 plan 导入时就跑（`planImport.ts`）⇒ estimator 槽**只在导入时**冻结（确认不写 estimator，§12 I9）。**estimator 解析失败不拒导入**，退化为今天的 `blocked-capability`（保持现行为，`ccloopWorld` 靠它）。`webService.ts` 里估算 run 的 `configHash: estimate.profile.profileHash` 改成冻结的 estimator `configHash`（§12 C5，消除 `configHash` 的第二种意思）；估算 run 今天没人执行（⑤），冻结值只记录。`reestimate` 按**当时**的层 0–2（含面板上后改的组级 estimator 值）重新解析并冻结给那一次预估 run；已跑完的预估不回改。

### 6.5 profile v2

- 删：`profile.adapter`、`adapterConfigRef`、`modelPolicyRef`、`resolved.adapterConfigContentHash`／`modelPolicyContentHash`／`adapterImplementationHash`／`adapterProtocolVersion`；`webProtocol.ts:143` 的「codex 必须 phase-end／soft」约束随之删（能力改由选择的 capabilities 应答给出，I3）。
- 留：`profileId`、`allowedWorkKinds`、`contextTokenizer`、`workMaxOutputTokens`、`capabilities`（声明）、`estimatorPreflight`、`resolved` 里的 tokenizer／proof／secret 哈希。
- schema 名 `orca-execution-profile-snapshot-v2`；v1 拒收（项目未上线，**人裁**「不介意大改」）。
- 能力交集：`intersectCapabilities(profile.declared, capabilitiesOf(selection))`，**按 (profile, 选择) 求**，在冻结时算一次、随 work item 冻结；`router.probe(profile)` 的面板展示改为对「操作者默认选择」求。
- ⚠️ §9.1 的挂账「生产 execution profile 快照」**没被做掉**，只是形状变了；它仍归人。
- ⚠️ `contextTokenizer`／`estimatorPreflight.tokenizer` 仍在 profile 里、与模型身份脱钩：一个组里混 kind 时分词器前提可能错 —— 本轮登记 §11，不修（§12 I7）。

### 6.6 端口与环境

- `createCcloopExecutionPort({binary, agentsTablePath, timeoutMs})`；每次调用带 `--agents <table>`；`accept`／`inspect`／… 的 envelope 自带选择。
- `ORCA_CCLOOP_ADAPTER_CONFIG` → `ORCA_AGENTS_TABLE`（`realpath` 等于自身、普通文件；判据指向 `/private/tmp/…` 下 0600 的表，指向副本 build 的 fake claude／fake codex）。
- `handoffGraceMsOf(run)`：读 work item 上**冻结的** `killGraceMs`（来自 capabilities v3 应答）；Orca **不解析安装表**（§12 I5）。
- `driverLanding.ts` 的解冲突 run：写 `{selection, configHash}` 选择文件 → `ccloop run --agents <table> --agent-selection <file>`（ccloop 核哈希，§4.9）。
- 其余消费者见 §5.1。

### 6.7 CLI

- `orca agents init`：调 `ccloop agents detect`；表不存在 ⇒ 写入（目录 0700、文件 0600）；**表已存在 ⇒ 写 `<table>.draft.json`（0600）并打印与现表的 diff，绝不覆盖**；草稿已存在 ⇒ 覆盖草稿（草稿是 Orca 自己的产物）。临时文件只清自己命名模式的、不跟随软链（M6）。
- `orca agents show`：调 `ccloop agents validate` 与 `control capabilities {agent: null}`，打印每条安装记录与当前操作者默认值的解析结果。

### 6.8 面板 UI（本轮做全，人裁）

- **设置页「Agents」**：列出安装表（来自 capabilities 表级视图）；编辑操作者默认值（默认 agent、每个 agent 的 model／上下文、estimator／reconcile 槽）→ `set-agent-preferences`；上下文档位用该 kind 的 `contextOptions` 做下拉，**不允许自由输入**。
- **提案视图**：组级与逐任务的选择编辑 → `proposal-set-agent`；每个任务显示解析结果，**每个字段标来源层**；确认前对当前 `proposalVersion` 预解析一次，失败的任务标红并显示 ccloop 的错误码。
- 确认请求绑定用户看到的 `proposalVersion`（已有机制）。

---

## 7. 错误（一律具名、fail closed）

| 情形 | 在哪一步 | 错误码 |
|---|---|---|
| 表文件软链／非普通文件／JSON 坏／schema 不合 | 读表 | `agents-table-invalid` |
| 选择的 installationId 不在表里 | capabilities／accept | `agent-installation-missing` |
| 上下文档位该 kind 表达不了 | 同上 | `agent-context-unsupported` |
| model 为空或不合该 kind | 同上 | `agent-selection-invalid` |
| 表那一条在确认后被改 | accept | `control-config-hash-mismatch`（已有） |
| 任一槽位解析失败 | confirm／plan 导入 | `agent-selection-rejected:<taskId|slot>:<ccloop 码>` |
| `set-agent-preferences` 的 revision 过期 | 命令台账 | 已有的 revision 冲突码 |
| 哪一层都没给 agent | 解析 | `agent-unselected` |
| 表里的 `version` 与 `command --version` 不等 | capabilities／accept／`ccloop run` | `agent-version-drift` |
| 确认时的 `selectionsHash` 与重新解析不等 | confirm | `agent-selection-changed` |
| 表的属主不是 euid 或组／他人可写 | 读表 | `agents-table-invalid` |

---

## 8. 仓库外写入登记（Rule 17）

| 路径 | 谁触发 | 模式 | 失败残留 |
|---|---|---|---|
| `$ORCA_AGENTS_TABLE`，缺省 `~/.orca/agents.json` | `orca agents init`（表不存在时） | 目录 0700、文件 0600；已存在的目录／文件**不改 mode** | 原子替换（先写临时文件再 rename）；失败时残留一个同目录的临时文件，下次 init 清掉 |
| `<table>.draft.json` | `orca agents init`（表已存在时） | 0600 | 同上 |

ccloop 侧**零**仓库外写入（detect／validate 只读、只打 stdout）。判据一律用改道后的临时目录，并沿用 Orca 端到端判据「`HOME` 与四个 XDG 根改道、断言零写入」的形状。

---

## 9. 判据与变异（成功判据全部是 0／非 0 命令，计划逐条写成命令）

**ccloop**：
1. 探测：假 `HOME`＋假 `PATH` 下候选目录顺序、realpath 去重、`isPathDefault`、不可运行的候选记 `runnable:false`。变异：去掉去重 ⇒ 红；把 PATH 扫描挪到最前 ⇒ 红。
2. 表校验与物化哈希稳定：同一表＋同一选择 ⇒ 同一哈希；改该条任一字段 ⇒ 哈希变；**改另一条安装记录 ⇒ 该条哈希不变**（§12 I13）。
3. 🔴 **空洞成立的回归判据**：`ClaudeAgentAdapter` 下 `processes.json` 非空；进程组还活着时 `proveStopped` 返回 `null`。**变异：删掉 `onProcessRegistered` 调用 ⇒ 必须红**（这是本轮最承重的一条）。
4. prompt 在注册之后才写：注册回调挂起在测试控制的 promise 上，放行**之前**量 fake claude CLI 的 `.argv` 为空、runner 未收到 stdin。变异：把写 stdin 挪到注册之前 ⇒ 红（§12 I13：不靠进程被杀前后的时序）。
5. 中止杀整组：fake claude CLI 是 runner 的子进程，它再拉起的进程是 runner 的孙进程（M9）；中止后 `killGraceMs` 内孙进程不存在。变异：只 kill 子进程不 kill 组 ⇒ 红。
5b. 停机证明（§4.7b）：一个不注册的替身 adapter 带结果跑完一个阶段 ⇒ `proveStopped` 为 `null`。变异：删掉这条检查 ⇒ 红。
5c. `agent-version-drift`：表里 `version` 与 fake CLI `--version` 不等 ⇒ capabilities／accept／`ccloop run` 都拒。
5d. 表坏了不挡回收：accept 之后把表写坏，collect 仍成功（§4.2）。表是软链／非普通文件／组可写 ⇒ `agents-table-invalid`。
6. envelope v2／capabilities v3 的 schema 与 accept 的哈希核对（改选择任一字段 ⇒ `control-config-hash-mismatch`）；control 下 `--adapter` 被拒；envelope `protocol: 1` 被拒；`ccloop run` 的 `--agents` 与 `--adapter` 互斥；`--agent-selection` 的 `configHash` 不等 ⇒ 退出非 0；`env`／`secretEnv` 被 strict 拒收；model 以 `-` 开头或含空白 ⇒ `agent-selection-invalid`。

**Orca**：
7. `resolveSelection` 纯函数：§6.3 裁定 (a)–(e) 每条一个判据；来源标注。变异：去掉 `eff(l_i) === A` 这一条件 ⇒ 红。
8. 冻结：任一任务解析失败 ⇒ 整次 confirm 拒且零 work item 写入；预解析之后改操作者默认值、再带旧 `selectionsHash` 确认 ⇒ `agent-selection-changed`；**确认之后把操作者默认改成另一个 agent，再派活 ⇒ 发出的 envelope `claim.agent`、fake 的 `.argv` 里的 `--model`、闸门探测用的选择都是冻结值**（§12 I13／C3：不许读回存储里的值当判据）。
8b. 命令与 plan：`proposal-set-agent` 推进 `proposalVersion`；`set-agent-preferences` revision 过期被拒；plan 带 `configHash` 被拒、`agent` 字段被接受；`handoffGraceMs` 按 run 的冻结值取。
9. profile v2：v1 快照拒收；能力按 (profile, 选择) 求交。
10. `orca agents init`：表不存在写入且模式 0700／0600；表存在只写草稿、原表逐字节不变（`cmp`）；残留临时文件被下次 init 清掉、不跟随软链。
11. **驱动环 E2E（fake claude＋fake codex 混组）**：操作者默认 claude／`claude-opus-5-5`，某一任务覆盖成 codex；确认 → 跑完 → 落到 `orca/<g>`；fake claude CLI 的 `.argv` 出现 `--model claude-opus-5-5`（或设了 1M 时 `…[1m]`），fake codex 的 `.argv` 出现它自己的 model；**解冲突 run 的 reconcile 选择也要出现在 `.argv`**。**再在 fake claude 下各跑一次 ④ 的 handoff、续跑、三路冲突**。
12. 面板：设置页、提案视图、确认绑定 `proposalVersion` 的 web 测试。
13. 全套门：两仓 typecheck、全量测试（json reporter ＋ 机械判定器）、`verify:*`、`--ws check`、`check-claude-md-lines`、`check-hooks-path`、ccloop `check-known-reds` 全 RC 0（已登记 flake 除外，按判别式处理）。

**方法**（承 §6.14）：RED 阶段就绿的判据，先打一条删掉被测分支的变异；每新增一个分支点名删掉它自己的那条变异并看见红；变异只在 `git clone --local` 副本里做；每一波后复审、全部完成后终审。

---

## 10. 实施分波（计划据此展开）

| 波 | 内容 | 依赖 |
|---|---|---|
| 0 | Task 0 现量：1M 怎么传给 claude、两个 CLI 接受的默认 model 写法、受影响的既有判据全名清单（报人指名） | — |
| 1 | ccloop：注册表、描述、表 schema、detect／validate、`ClaudeAgentAdapter`、停机证明（§4.7b）、CLI 层 fake claude | 0 |
| 2 | 线上 v2／v3：ccloop control 与 Orca 端口同步改；`ccloop run --agents` | 1 |
| 3 | Orca：`resolveSelection`、偏好表与两个动词、plan 文件、冻结、profile v2、解冲突 run、`orca agents` | 2 |
| 4 | 面板：设置页、提案视图 | 3 |
| 5 | E2E（fake claude＋fake codex 混组、④ 三件在 fake claude 下）与全套门；终审 | 4 |

每波之后派一席复审；全部完成后一席终审（④ 的复审＋终审共抓出 8 条 Critical，**不省**）。

---

## 11. 登记（不做但记下的）

- 真 claude 付费跑：另问人；先用 proposal-edit 封顶（默认每任务 3M token、3 次尝试）。
- stream-json 逐条 usage（让 claude 下 deadline 中止的 run 可续）：下一片，字段形状要真 claude 实测。
- opencode／oh-my-pi／pi／litellm：注册表接口已留，各自一片。
- 安装记录的 `env`／`secretEnv`（provider 端点）：随 provider 那一片加。
- subagent 级切换：破 I1，另立设计。
- 多用户身份与鉴权：偏好已按 `operatorId` 分键，身份接入另立。
- 旧 `SubprocessClaudeAdapter` 与 `ccloop run --adapter claude`：保留不动，清理另立。
- 探测不走登录 shell 的代价（rc 文件里临时加的目录探不到）：人在草稿里手填。
- `ccloop resume`／`sweep` 不支持 `--agents` 起的 run（§4.9）。
- claude 工具进程若另开进程组／会话，杀不到也探不到（§4.7）。
- profile 的分词器与模型身份脱钩（§6.5）。
- 真 claude 的 `-p` 会往配置目录写会话；付费跑那一片按 Rule 17 登记，考虑 `--no-session-persistence`（M7）。
- 真 claude 下 `[1m]` 是否真的给到 1M 窗口：付费跑才能观测。

---

## 12. 复审裁定（2026-09-26，独立复审席；报告 `.superpowers/sdd/2026-09-26-agent-selection/spec-review.md`）

复审报 7 Critical／15 Important／10 Minor；控制器抽查 C1（`fake-codex.mjs:25`、`ccloopWorld.ts:130-132`）、C2（`ccloopWorld.ts:76`）、C3（`webDispatch.ts:85`／`:165`、`dispatch.ts:52`／`:77`）、C4（`webService.ts:387` 同步）、C5（`webService.ts:292`）、I10（`commandLedger.ts` scope 三种）属实。**全部接受，无驳回**；正文已就地改（本 spec 未发布、本会话所写）。处置：

| 发现 | 处置（落点） |
|---|---|
| C1 fake claude 站错层 | 新文件 CLI 层替身；旧 runner 层替身不动；argv 进 `.argv`，`.calls`／`.tasks` 格式不变（§4.8） |
| C2 `command` 单路径 | 改 argv 元组（§4.2） |
| C3 闸门不带选择 | 逐调用点定选择（§6.4 末段）；判据 8 |
| C4 确认绑定空洞、confirm 同步 | confirm 异步＋`selectionsHash`＋`agent-selection-changed`（§6.4） |
| C5 reconcile／estimate 的 `configHash` 无核对方 | 选择文件带 `configHash`、`ccloop run` 核（§4.9）；estimate 的 `profileHash` 改掉（§6.4） |
| C6 原地升级抓不到 | accept／capabilities／run 跑 `--version` 比对，`agent-version-drift`（§4.2） |
| C7 零注册空洞只修了 claude | 通用：带结果完成的阶段计数 > 0 且零注册 ⇒ 无证明（§4.7b） |
| I1／I2／I10／I11／I12 消费者漏列 | §5.1 清单；§4.10 两仓都算 |
| I3 plan／快照／面板权威 | 草稿 `configHash:null`、快照 v2、Web spec ERRATUM（§6.2、§6.4） |
| I4 表坏挡回收 | 只有 capabilities／accept 读表（§4.2）；判据 5d |
| I5 `killGraceMs` 两边不一 | capabilities 回带、冻结在 work item（§4.6、§6.6） |
| I6 `null` 两义、请求值冒充观测 | 字段改名 `contextWindow: "agent-default"\|number`；能力只报核实过的映射（§3、§4.6） |
| I7 profile 分词器 | 登记 §11 |
| I8 合并规则歧义 | §6.3 形式定义＋(a)–(e) 裁定；`agent-unselected` |
| I9 estimator 两处冻结 | 只在导入冻结；失败退化 `blocked-capability`（§6.4） |
| I13 判据问题 | 判据 2、4、8 改写；5b–5d、6、8b 补齐；`usageBeforeDelay` 删 |
| I14 安全 | 表属主／mode；detect 跳过相对与全局可写目录；model 字符约束；runner 参数走 JSON；`configDir` 进记录；Web spec 信任边界 ERRATUM |
| I15 工具进程逃组 | 登记 §11 |
| M1–M10 | 就地改（§3、§1.7、§4.2、§5、§6.3、§6.7、§4.3、§9） |

另：人 2026-09-26「同意修改几个仓库的现有test」写进 §4.10。Task 0 的三项现量（1M 写法、两个默认 model、受影响判据文件）记在台账 §1 并已写进 §4.1。


---

## 13. 实施期更正（2026-09-26，控制器会话 `ab5a693c` 追加；上文一字未动）

> 本 spec 已发布（`ls-remote` 现测远端含本文件）⇒ 上文原文逐字保留，偏离与新增一律在本节登记。
> 来源：进度台账 `.superpowers/sdd/2026-09-26-agent-selection/progress.md` 的 `Ruling:` 行、各波复审报告 `wave1..5-review.md`、计划 §0 的 R1–R8。**冲突时本节优先于上文与 §12。**
> 每条都是控制器替人做的决定（人：「执行过程中如果有问题，先按你的建议执行。执行完在最后阶段报给我审核」），**人要审**。

### 13.1 对正文的偏离

| # | 正文 | 实际 | 依据 |
|---|---|---|---|
| D1 | §6.4／§6.2：estimator 槽在导入时按操作者 → 组 → plan 分层解析，plan 文件可写 estimator | 导入时 estimator 只解析操作者两层（worker 默认 < `operator.estimator`）；plan 文件**不加** `estimatorAgent`；组级 estimator 只来自面板 `proposal-set-agent`（slot estimator），在 reestimate 时生效 | 计划 R7（W5-M16）：选项 A 会放宽受保护判据 `planImport.test.ts > immutable plan import > rechecks revision after a successful in-flight probe before source I/O`；估算 run 今天无执行方（⑤），导入时 plan 层不生效无实际后果 |
| D2 | §6.2「逐字段合并」 | 面板对组层／任务层是**整层替换**，不与 plan 值逐字段合并 | 计划 R6（W5-M4） |
| D3 | §6.4 闸门探测 | 组内对冻结选择去重后探测；任一降级 ⇒ 整组阻塞 | W5-M12 |
| D4 | §6.5 上下文阈值 | 上下文阈值仍按 profile 声明的窗口判，不按冻结选择的 `contextWindow` | W5-M15；波 3 复审 M-4 指出交集已可廉价取得，未改 |
| D5 | §6.4 预览 | `resolveGroupSelections` 分预览／确认两种模式：预览把瞬时失败记为逐槽 `unavailable`（`selectionsHash` 为 null、不可确认）；确认仍抛出、可重试 | 波 3 I-1 |
| D6 | §6.4 `selectionsHash` | hash 只含 `{partial, selection, configHash}`，**不含来源层（provenance）**；来源改变而选择不变时不作废确认 | 波 3 M-2（按正文定义如此，登记其时间窗） |
| D7 | §5.1 升级 | **无迁移**：T11 之前确认的组、v1 profile 文件、带 `configHash` 的 plan 文件、缺 `estimatorSlot` 的估算记录一律拒或 `recovery-blocked` | T10／T11 Ruling（项目未上线） |
| D8 | `orca agents show` | 不读控制 store | 计划 R8（M-8） |
| D9 | 面板 | 仍要求 `ORCA_CCLOOP_BIN` 与 `ORCA_AGENTS_TABLE` 两个 env 都给；缺省路径只给 `orca agents` | 计划 R8（M-9） |
| D10 | §4.2 端口 | Orca `ccloopPort` 构造时只核表路径形状（绝对、非软链），存在性交 ccloop 的 capabilities／accept 判 —— 保住 ccloop「删表不挡回收」 | 波 2 I-1 |
| D11 | §4.2 C6 版本比对 | 观测到版本且不等 ⇒ 具名 `agent-version-drift`；**探不到版本（`probeVersion` 为 null）⇒ 非具名失败**（control 退 1 ⇒ Orca 视为 unknown 可重试，由 `INSPECT_UNKNOWN_LIMIT` 兜底；`run --agents` ⇒ `reconcile-spawn`）。代价：`probeFailureCode` 诊断粒度变粗 | 波 2 I-3 |

### 13.2 正文未写、实施期新增的契约

- **退出码两套约定**（P20）：`ccloop control` 的具名拒绝退 2、stderr `<code>[: detail]`；`ccloop run --agents` 的拒绝退 1（2 ＝ run 跑完未成功）。Orca 的解冲突路径自己解释 `run --agents` 的退出码，不复用 `ccloopPort` 的 `"2:"` 前缀判定；codex 非拒绝型 exit 1 的 stderr 首行恒为 budget 提示，Orca 取首个非提示行作原因（波 2 I-2）。
- **新阻塞码**（`drive.blockedReason`，`reconcile-*` 家族）：`reconcile-refused:<code>`（T7）、`reconcile-agent-unfrozen`（波 3 I-2：组记录的 reconcile 冻结值与快照不一致 ⇒ 不起解冲突 run）。
- **新码**：`agent-selection-file-invalid`、`agent-config-invalid`、`agents-command-invalid`（R2）。
- **确认时的瞬时错误**经面板映射为 500 `control-internal-error`（既有兜底，非本轮引入；T14 minor）。
- **面板**：`unavailable` 槽不自动轮询，给手动 Re-read，另有一次有界重试与请求序号守卫（T15 Ruling）；`agent-selection-rejected` 后预览作废（波 4 M-1）。
- **测试专用钩子** `ControlAssemblyInput.wrapPort`（T16）：CLI 与 `live-driver-acceptance` 均不设；不设时行为不变（波 5 复审核）。

### 13.3 登记（不修）

- 旧服务路径 `ControlService.startClaim`（`dispatch.ts`）与 `claimContinuation`（`continuation.ts`）没有「活偏好不泄漏」判据：波 5 复审的条件泄漏变异 L2／L4 全绿。复审以逐行扫生产调用方判为**生产不可达**（`ControlService` 只在 recovery 构造且不走这两支；面板 continue-task 走 `WebControlService`）。将来接回生产前要先补判据（可选：限定 import `readAgentPreferences` 的文件）。
- reestimate 事务内不重核操作者层（T10 minor／波 3 M-3）；冻结的 `agentCapabilities` 只写不读（波 3 M-4）。
- T7 的 `versionOf` 用 `execFileSync` 无超时（波 5 m-2）；零写入守卫抓不到只改 mtime、不查真 HOME（波 5 m-3）。
- 其余 deferred minor 以台账 `Task N: minor (deferred)` 行为准。

### 13.4 D10 更正（2026-09-26，终审 I-1；上文 §13.1 D10 一字未动，本节单独记更正）

> 依据：终审报告 `.superpowers/sdd/2026-09-26-agent-selection/final-review.md` I-1；修复报告
> `.superpowers/sdd/2026-09-26-agent-selection/final-fix-report.md`。**人要审**（同 §13 头部）。

D10 写的「Orca `ccloopPort` 构造时只核表路径形状……保住 ccloop『删表不挡回收』」只对了一半：
`ccloopPort.ts` 的端口构造（波 2 I-1 已修）确实只核形状，但生产装配路径上还有**第二道**独立的存在性检查——
`src/panel/controlConfig.ts` 的 `createTrustedControlConfig`（`assembleControlRuntime` 唯一的调用方，在
`server.ts` 监听之前跑）对 `agentsTablePath` 做的是 `checkedPath(..., "file")`，表文件不在就抛
`control-trusted-config-invalid:path-missing`，**整个面板进程装配失败**，比波 2 I-1 描述的后果更重：
不只是执行端口，评审／决策面板本身也起不来，在飞 run 的 inspect／collect／handoff 全部做不了。

终审的探针 `scratchpad/final/orca/tests/panel/finalProbe.test.ts`（PROBE-B）实测复现：同一份表被删除后，
`assembleControlRuntime` 在装配阶段就抛出上述错误，而不是像 D10 所说那样把「表存在与否」完全交给 ccloop 在
capabilities／accept 时判定。

**更正**：`createTrustedControlConfig` 现在对 `agentsTablePath` 复用 `ccloopPort.ts` 导出的
`agentsTablePath()` 同一个形状检查（绝对路径；若有东西在，必须是 canonical 的普通文件、不是软链；
路径上什么都没有则放行），不再单独调用 `checkedPath(..., "file")`。至此 D10 描述的保证——「一张被删的表
不得挡住已在飞的 run 的回收」——在生产唯一的调用路径（`controlAssembly.ts` → `createTrustedControlConfig`）
上才真正成立；此前它只在端口构造这一层成立，从未传到装配层。

判据：`tests/panel/controlConfig.test.ts`（新增 describe「the agents table path is checked by shape
only, not by existence」，3 条：缺表装配成功、相对路径仍拒、软链表仍拒）与
`tests/panel/controlAssemblyDriver.test.ts`（新增一条：`assembleControlRuntime` 在表被删除后仍装配成功
且驱动仍起来）。变异：把 `agentsTablePath(input.agentsTablePath)` 改回
`checkedPath(input.agentsTablePath, "file")`，上述 4 条判据全部转红。

### 13.5 终审其余更正与补登（2026-09-26，控制器会话 `ab5a693c`；终审报告 `.superpowers/sdd/2026-09-26-agent-selection/final-review.md`；D10 的更正见 13.4；13.1–13.4 原文保留）

- **更正 D11**：「探不到版本 ⇒ unknown 可重试」只对 accept 路径成立。在派活闸门路径上，探测失败经 `probeFailureCode` 判为降级 ⇒ 写 `claim-capability-unavailable` 组级阻塞 ⇒ 此后的 wake 一律 deferred，直到人 recovery-retry（终审 m-2）。仍是 fail closed。
- **登记（要人裁，付费真 claude 那一轮之前必须定）**：安装记录的 `version` 进 `configHash`（ccloop `agentConfigHash` 哈希整份物化配置），而开跑的组不能重新冻结（`prestart` 拒 running／review／done）。⇒ CLI 原地升级后，已开跑组剩下的任务、续跑、解冲突先报 `agent-version-drift`，改表后又报 `control-config-hash-mismatch`，**永久无出路**；不会跑错 agent（终审 I-2，`hashprobe` 实测两份只差 version 的配置 hash 不等）。可选：(a) hash 不含 version，版本只由漂移检查管；(b) 给 running 组加「重新冻结某槽」的动词，走 preview／`selectionsHash`；(c) 只登记，并在付费轮关掉 claude 自动更新。
- **补登的契约**（终审 m-1）：面板读路由 `GET /api/control/agents`、`/api/control/operator/agent-preferences`、`/api/control/groups/:g/agent-preview`；预览逐槽 `resolved|rejected|unavailable`、`selectionsHash: string|null`；组视图 `agents.reconcile`；schema 名 `orca-agents-view-v1`、`orca-agent-preferences-v1`；`GET /agents` 的具名拒绝把 ccloop stderr 的 detail 原样透给浏览器；capabilities 表级视图比 §4.6 多一个 `version` 字段；`configDir: null` ＝ 继承 worker 所在环境、不进哈希（同一 configHash 可在不同账户下跑）；确认后开跑前改组级 estimator 会把提案打回可编辑并清掉全部冻结字段；注册只读路由时即 mint `panelOperatorId`。
- **D6 的时间窗**：偏好 revision 变了而解析出的选择不变时，旧预览仍能确认，冻结的来源层可能与屏幕上显示的不同。
- **登记（不修）**：派活用 run 行的 `agent`／`configHash`，未与确认快照比对（解冲突已经比对；只在存储损坏时有差别，m-4）；claude model 以 `[1m]` 结尾可绕过上下文档位（m-5）；`handoffGraceMsOf` 在冻结值无效时退回 0 而非上限（m-6）；`versionOf` 无超时，另有 `scripts/live-driver-acceptance.ts` 在 live 模式对真 codex 同步跑 `--version`（m-3）；真 CLI 的 `--version` 会不会写配置目录没量过，且 `probeVersion` 不设 `CLAUDE_CONFIG_DIR`／`CODEX_HOME`（m-8，付费轮前在改道 HOME 下量）。
