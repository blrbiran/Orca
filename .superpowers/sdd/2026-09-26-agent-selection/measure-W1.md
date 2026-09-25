

# 计划分部 W1：T1（agent 描述、安装表、物化）、T2（detect／validate）、T4（停机证明通用闸）

> **归属**：计划写作席 W1，Orca 控制器会话 `75ec878e` 派出（Claude Opus 5.5），2026-09-26。
> **观测锚点**：ccloop 主题行 `docs(handoff): roll the Orca section: C5-C7 and C-3 landed here for the handoff delivery round`（`/usr/bin/git log -1 --format='%h %s'` ⇒ `f4e49a2`）。**行号会移动 ⇒ 引用前现测。**
> **本分部的代码与判据都在写作席的副本里整份跑过**：`scratchpad/W1/ccloop`（`git clone --local` 自 `f4e49a2`，`node_modules` 软链到真仓）。下文的代码块是从副本里逐字取出的（生成脚本读文件拼进本文，不是手抄）。日志都在 `scratchpad/W1/`：`t1-*.log`、`t2*.log`、`t4*.log`、`existing.log`、`e2e.log`、`*-mut*.log`。
> **本分部只动 ccloop。** 实施席在真仓 `main` 上落提交；变异只在自己的 `git clone --local` 副本里做。

下文记号：

```sh
C=/Users/biran/code/skills/loop/ccloop
S=/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/75ec878e-a6d3-4299-9a4b-b76dd574b77a/scratchpad/<实施席 id>
mkdir -p $S
```

## W1 现量

### 一、步骤依赖的现量（命令：`grep -n` 于真仓 `$C`，结果重定向到 `scratchpad/W1/measure.txt` 整份读回；另有注明的除外）

| # | 现量 | file:line | 命令／日志 |
|---|---|---|---|
| 1 | `idSchema` 未导出（T1 的表与选择 schema 要复用它） | `src/control/protocol.ts:99` `const idSchema = …` | `grep -n "^const idSchema"` |
| 2 | ccloop 里**没有** `CapabilityViewV1` 类型；control 的八字段只作为 zod schema 住在 `command.ts:27-47`（带 `protocol: 2`）；Orca 的同名类型在 `Orca/src/control/webProtocol.ts:76-86`（`capabilityViewSchema`），字段一致 | `src/control/command.ts:27`；Orca `webProtocol.ts:76` | `sed -n` 读源 |
| 3 | `CodexAdapter` 构造只收一个参数，`runCodexPhase` 两个参数，spawn 时 `env:process.env` | `src/runtime/codex/codexAdapter.ts:19`、`:22`；`src/runtime/codex/runCodexPhase.ts:19`、`:47` | `grep -n` |
| 4 | `parseCodexConfig` 的约束：`command` 为 `[绝对路径, ...参数]`、`model` `trim().min(1)`、`budgetMode: "soft"`、`sandbox ∈ {read-only, workspace-write}`、`timeoutMs ≤ 2_147_483_647`、`killGraceMs ≤ 60_000`，`.strict()` | `src/runtime/codex/protocol.ts:6-18` | `cat -n` |
| 5 | `onPhaseSettled` 的观测形状只有 `{phase, attempt, elapsedMs, tokenUsage, usageEvidence}`，**没有**「是否带结果」 | `src/controller/runLoop.ts:1180-1187` | `sed -n 1170,1245p` |
| 6 | `settlePhase` 的全部调用点：带结果 `:1389`、`:1512`、`:1637`；可能带结果（handoff 中止／超时时 `result` 可空）`:1363`、`:1426`、`:1434`、`:1611`；无结果 `:1368`、`:1617`；**错误路径**把「中止前观测到的 usage」包成 `{tokenUsage}` 冒充 result 传入 `:1834` | `src/controller/runLoop.ts` 各行 | `grep -n "settlePhase("` |
| 7 | 命令型 verifier 与 required-check 失败的 verify 阶段**带结果但不起 provider 进程**（`tokenUsage: 0`） | `src/controller/runLoop.ts:212`、`:290` | `sed -n 195,300p` |
| 8 | worker 的 `onPhaseSettled` 在 `:165`；`proveStopped` 的第二次读 `processes.json` 在 `stopProof.ts:118`；`probeAll` 对空数组恒 `true`（`:100-108`）；`collect.ts:40`、`:54` 是 `proveStopped` 的仅有调用方 | `src/control/worker.ts:165`；`src/control/stopProof.ts:100-119`；`src/control/collect.ts:40`、`:54` | `grep -n` |
| 9 | `readPrivateFile` 对 ENOENT 原样抛出（其余一律 `control-path-invalid`），T4 靠它区分「没有计数文件」 | `src/control/paths.ts:89-104` | `cat -n` |
| 10 | `main` 在 `parseArgs` 之前先分派 `control`（`:268-275`）；`agents` 按同一形状插在 `:277` 之前 | `src/cli.ts:268`、`:277` | `grep -n` |
| 11 | 现有 in-process worker 判据的做法（写 `config.json`／`envelope.json`／`accepted.json` 后直接 `await runControlWorker(...)`）：T4 的接线判据照抄 | `tests/control/handoff.test.ts:180-221` | `sed -n 150,280p` |
| 12 | fake codex **不答 `--version`**：`--version` 调用会等 stdin 结束、覆盖写 marker、再因 `--output-schema` 缺失而崩 | `tests/fixtures/fake-codex.mjs:5-19` | `cat -n` |
| 13 | 本机 `claude --version` ⇒ `2.1.282 (Claude Code)`；`codex --version` ⇒ `codex-cli 0.155.1` | — | `(claude --version; codex --version) > scratchpad/W1/versions.txt 2>&1` |
| 14 | 本机目录权限：`/opt/homebrew/bin` 是 `drwxrwxr-x biran admin`（**组可写**），`/usr/local/bin` `drwxr-xr-x root`；`/opt/homebrew/bin/claude` 存在（软链到 `cli.js`），`~/.local/bin/claude`、`/usr/local/bin/{claude,codex}` 不存在 | — | `ls -ld`／`ls -l`（W1 会话内） |
| 15 | 缺模块时 vitest 的报错原文：`Error: Failed to load url ../../src/agents/<x>.js (resolved id: …) … Does the file exist?`，`Tests  no tests`，RC 1 | — | 副本里临时探针，`scratchpad/W1/probe-missing.log` |
| 16 | 已知红：`tests/control/stopProof.test.ts ＞ quiet execution proof ＞ does not treat leader exit as group quiet and proves only after the full tree is gone`（5 s 超时）在 `scripts/check-known-reds.mjs:40` 的名单里；它不写 `phases-completed.json`，T4 不改变它 | `scripts/check-known-reds.mjs:40` | `grep -n "leader exit"`；`scratchpad/W1/existing.log` |

### 二、spec／骨架与代码不符之处（**不静默偏离**；每条给建议，由控制器裁定。下文 Task 正文**按建议一栏写**）

| # | 不符 | 建议（本分部正文即按此写） |
|---|---|---|
| W1-1 | 骨架 `AgentResolutionV1.capabilities: CapabilityViewV1`，但 ccloop 没有这个类型（现量 2） | T1 在 `src/agents/types.ts` 定义 `CapabilityViewV1`（八字段，与 Orca `capabilityViewSchema` 同形，不带 `protocol`）。T5 改 `command.ts` 的 capabilities 应答 schema 时可从这里取类型 |
| W1-2 | 骨架 `AgentError` 构造是 `(readonly code: string, detail?)`，`message` 未定 | **控制器已裁（2026-09-26，见本节末「已并入的控制器裁定」(2)）**：`message` 以码开头 ——无 detail 时 ＝ `code`，有 detail 时 ＝ `` `${code}: ${detail}` ``；`detail` 也 `readonly`；`code` 收窄为 `AgentErrorCode`（码表 `AGENT_ERROR_CODES`，见 W1-9）。CLI 调用方原样打印 `message`，第一个 token 就是码 |
| W1-3 | 骨架 `AgentDescriptor` 没有「detect 草稿里 kind 专属字段取什么值」（codex 的 `sandbox`／`budgetMode`） | **加一个字段** `draftInstallationExtras: Record<string, unknown>`（claude `{}`，codex `{sandbox:"workspace-write", budgetMode:"soft"}`）。否则 `detect.ts` 只能按 kind 写死，kind 知识漏出描述。**要改骨架接口 ⇒ 控制器定** |
| W1-4 | 骨架 `searchDirs(input: {home, env, platform})` 有 `env`，但骨架 `detectAgents` 的输入没有 `env`（只有 `home`／`path`） | `detectAgents` 传 `env: {PATH: input.path}`；两个描述都**不读 `env`**（不读 `NVM_BIN` 之类，免得判据漏改道）。nvm 装的 CLI 靠调用方给的 `PATH` 找到（本机 claude／codex 都在 nvm 的 bin 里，现量 13） |
| W1-5 | spec §4.3「`--home`／`--path` 让判据能**完全**改道」做不到：候选目录里有两个系统目录 `/usr/local/bin` 与（darwin）`/opt/homebrew/bin`，不随 `home` 改道；本机 `/opt/homebrew/bin/claude` 就存在（现量 14） | 不为此加参数（Rule 2）。判据：(a) 单元判据注入 `probe`，**本机任何真 CLI 都不执行**；(b) 断言只看假根下的候选（相对顺序不变）；(c) 单元判据用 `platform: "linux"` 以免扫 homebrew。登记：`/usr/local/bin` 在别的机器上可能有候选，只会多出被过滤掉的行 |
| W1-6 | spec §4.3「跳过全局可写目录」没定义「全局」 | ＝ **他人可写**（`mode & 0o002`）。组可写不跳：本机 `/opt/homebrew/bin` 是 `0775 admin`（现量 14），按组可写跳过会漏掉 homebrew 装的 agent |
| W1-7 | 骨架 `readAgentsTable(path)`、`probeVersion(command)` 各只有一个参数；「属主 ＝ euid」不用 root 无法在判据里造出反例，「超时」不注入就要等 10 s | 各加**可选**第二参：`readAgentsTable(path, deps?: {euid?: number})`、`probeVersion(command, options?: {timeoutMs?: number})`。`typeof probeVersion` 仍可赋给 `(command: string[]) => Promise<string \| null>` |
| W1-8 | 骨架没列、但本分部需要导出（给 T3／T5／T6 用或自用）的名字 | `types.ts`：`contextWindowSchema`、`agentSelectionSchema`、`partialSelectionSchema`（T5 的 envelope `claim.agent` 与 capabilities 请求用）、`assertModel`、`assertContextOption`、`commonSearchDirs`；`claude.ts`：`claudeDescriptor`、`claudeModelArgument(selection)`（**1M ⇔ `[1m]` 的唯一拼写处**，T3 的 `ClaudeAgentAdapter` 应调它而不是自己拼）；`codex.ts`：`codexDescriptor`、`toCodexConfig`（骨架已列）；`table.ts`：`parseInstallation`；`materialize.ts`：`parseMaterializedAgentConfig`（worker 读回 `config.json` 用，T5）；新文件 `src/agents/command.ts`：`runAgentsCommand`；`stopProof.ts`：`recordCompletedPhase` |
| W1-9 | 本分部新引入、不在 Global Constraints 字面量表里的错误码 | `AGENT_ERROR_CODES`（`src/agents/types.ts`）＝ spec §7 的六个 agent 码 ＋ `agent-config-invalid`（`config.json` 读回不合）＋ `agent-selection-file-invalid`（**控制器已裁**，T6 的 `--agent-selection` 文件不合时用）＋ `agents-command-invalid`（`ccloop agents` 参数错）＋ `agent-adapter-unavailable`（**临时**，见 W1-10）。另有非 AgentError 的 `control-phases-completed-invalid`（T4 计数文件坏）。T3／T5／T6 新增 AgentError 码时**必须**加进这张表（类型会拦）。请控制器决定哪些并入全仓字面量表 |
| W1-10 | 骨架要求描述有 `createAdapter`，但 claude 的适配器是 T3 的产物，而 T3 依赖 T1 | T1 的 `claudeDescriptor.createAdapter` 抛 `AgentError("agent-adapter-unavailable", "claude")`，并有判据 `tests/agents/registry.test.ts ＞ agent descriptors ＞ does not yet build a claude adapter` 钉住它。**T3 必须**把这一行换成 `new ClaudeAgentAdapter(config)` 并**整条改写**该判据（它是 T1 新写的判据，不是既有判据，但仍按「整条改写不放宽」处理：改成断言返回 `ClaudeAgentAdapter` 实例） |
| W1-11 | 骨架把 `CodexAdapter` 第二参 `extraEnv` 与 `runCodexPhase` 的 `extraEnv` 写在「ccloop 其余」里，没归到哪个 Task | 归 **T1**：codex 描述的 `createAdapter` 要用它（`configDir` ⇒ `CODEX_HOME`），且有判据（`tests/runtime/codex/extraEnv.test.ts`）。`runCodexPhase` 的 `extraEnv` 是**第三个位置参数** |
| W1-12 | 表里有未知 kind 时用哪个码：spec §7 只列「表 schema 不合 ⇒ `agents-table-invalid`」；骨架 `getDescriptor` 抛 `agent-installation-missing` | 读表时未知 kind ＝ `agents-table-invalid`（表本身不合）；`getDescriptor` 在表外被调时仍抛 `agent-installation-missing` |
| W1-13 | partial 里没有 `agent` 时 ccloop 答什么：spec §7 只在 Orca「解析」一步列 `agent-unselected` | ccloop 的 `resolveAgent` 同样抛 `agent-unselected`（同一个事实同一个码） |
| W1-14 | `version` 存什么：spec 说「探测时记下的版本串」 | 存 `--version` 输出里第一个 `\d+\.\d+\.\d+(?:-[\w.]+)?`（cc-switch 的正则），不存整行；漂移比较用同一抽取。本机 ⇒ `2.1.282`、`0.155.1` |
| W1-15 | `assertAgentsTablePath` 的「路径形状」 | ＝ 今天 `--adapter-config` 的检查（绝对、`realpath` 等于自身、`lstat` 是普通文件），**不看内容、不看属主与 mode**。代价：表被**删掉**时 inspect／collect 也会被挡（与今天 `--adapter-config` 被删一样）；spec 判据 5d 只要求「写坏内容」不挡回收 —— 登记，不扩大 |
| W1-16 | spec §4.7b「一个带结果完成的阶段必然起过 provider 进程」**不严格成立**：命令型 verifier／required-check 失败的 verify 带结果但不起进程（现量 7） | 照计数，不特判：verify 只在 plan 与 execute 都带结果完成之后才会跑，而这两阶段必然调 adapter；只要 adapter 注册过，`processes.json` 就非空、闸不误伤。只有「adapter 从不注册」这一种情况会让闸拒证明 —— 那正是闸要抓的 |
| W1-17 | 「带结果完成」怎么机械判（现量 5、6）：观测里没有这一位；`tokenUsage`／`usageEvidence` 都不是它的代理（错误路径带 `tokenUsage` 却无结果；结果可以没有 `usageEvidence`） | 在 `runLoop.ts` 的观测里**加一个字段** `completedWithResult: boolean`：`settlePhase` 新增第 5 个参数 `usageOnly = false`，错误路径（现 `:1834`）传 `true`；值 ＝ `!usageOnly && result !== undefined && result !== null`。这是对 `runLoop.ts` 的外科改动（3 处），骨架写的「从 worker 的 onPhaseSettled 写」照旧成立 |
| W1-18 | fake codex 不答 `--version`（现量 12）：T5 的 capabilities／accept 与 T6 的 `ccloop run` 一跑 `probeVersion` 就会得 `null` ⇒ `agent-version-drift` | **不在本分部改**（fake 归 T3）。建议 T3 给 fake codex 也加 `--version`（与 fake claude CLI 同形：`argv` 里有 `--version` 就打印版本、退出 0、不读 stdin、不写 marker），否则 T5 的 E2E 全红 |
| W1-19 | 文件冲突：T4 与 T5 都改 `src/control/worker.ts`；T2 与 T6 都改 `src/cli.ts`；T1 与 T5 都改 `src/control/protocol.ts` | 依赖顺序已保证 T1、T2、T4 先落；T5／T6 的写作席要以本分部落地后的文件为底（锚点见各 Task）。**T5 必须整条改写** T4 新写的 `tests/control/phasesCompleted.test.ts ＞ the control worker counts completed phases ＞ …`（它按今天的 v1 envelope 与 codex `config.json` 造 worker 输入） |

### 已并入的控制器裁定（2026-09-26，写作期间收到；按 W2／W6 的跨 Task 发现）

1. `probeVersion(command)` 跑 `[...command, "--version"]`，`--version` 放**最后**（fake CLI 先吃模式参数）—— 代码 `spawn(command[0], [...command.slice(1), "--version"])` 即此；判据「passes the command's own arguments before --version」与变异 M25 钉住。
2. `AgentError.message` 以码开头（`agent-version-drift: <detail>`），CLI 原样打印 —— 见 W1-2；判据「puts the code first in an AgentError's message …」与变异 M33／M34；`ccloop agents` 的 stderr 因此是 `message` 原文（变异 D15）。
3. `resolveAgent` **默认**探版本（`deps.probeVersion` 只做替换），漂移 ⇒ `AgentError("agent-version-drift")` —— 判据「probes the real CLI when no probe is injected」与变异 M26。
4. 码表加 `agent-selection-file-invalid` —— 见 W1-9。
5. （W6-14）`probeVersion` 取 stdout 里 `/\d+\.\d+\.\d+(?:-[\w.]+)?/` 的第一处匹配（与 cc-switch 的 `(-[\w.]+)?` 等价，只把分组改成非捕获），无匹配／进程失败／超时（10 s）⇒ `null`；表的 `version` 存的正是这个串 —— 见 W1-14。
6. （W6-17）T4 **不改** `tests/control/stopProof.test.ts` 的任何 describe／it 文字（新判据全在新文件 `tests/control/phasesCompleted.test.ts`），所以 `scripts/check-known-reds.mjs` 不用动。

### 三、会红的既有判据

**本分部三个 Task 都没有让任何既有判据变红**（只加不改）。现跑（副本 `scratchpad/W1/ccloop`，三个 Task 全部打上之后）：

- `./node_modules/.bin/vitest run tests/control/stopProof.test.ts tests/control/worker.test.ts tests/control/handoff.test.ts tests/control/handoffEnteredPhases.test.ts tests/control/handoffDeadlineUsage.test.ts tests/control/collect.test.ts tests/cli/cli.test.ts --no-file-parallelism > existing.log 2>&1` ⇒ 7 文件 62/63，唯一红是现量 16 的已知红（5 s 超时）。
- `./node_modules/.bin/vitest run tests/runtime/codex tests/control/protocol.test.ts > t1-existing.log 2>&1` ⇒ 10 文件 80/80（含新的 `extraEnv.test.ts`）。
- `npm run build > build.log 2>&1` RC 0 后 `./node_modules/.bin/vitest run tests/control/endToEnd.test.ts > e2e.log 2>&1` ⇒ 6/6。
- `./node_modules/.bin/tsc --noEmit -p tsconfig.json` ⇒ RC 0（`t1-tsc.log`、`t2-tsc.log`、`t4-tsc.log` 均为空）。

**没有跑全量**（brief 禁止）；全量归 T17。T1 之后受影响面按 import 图只到上面这些文件：`protocol.ts` 只多一个 `export`；`CodexAdapter`／`runCodexPhase` 只多可选参数；`runLoop.ts` 只在观测对象上多一个字段（既有判据对观测都用 `map`／`toMatchObject`，`tests/control/worker.test.ts:70`、`:136`、`:157`，`tests/control/handoff.test.ts:171` 只数调用次数）。

**本分部新写、后续 Task 必须整条改写的判据**（不是既有判据，但照「整条改写不放宽」处理）：见 W1-10（T3）、W1-19（T5）。

---
