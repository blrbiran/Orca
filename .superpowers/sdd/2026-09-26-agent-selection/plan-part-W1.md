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

### Task 1: agent 描述、安装表与物化（ccloop）

**Files**

- Modify: `src/control/protocol.ts:99`（`const idSchema` ⇒ `export const idSchema`）
- Modify: `src/runtime/codex/codexAdapter.ts:19`、`:22`（可选第二参 `extraEnv`）
- Modify: `src/runtime/codex/runCodexPhase.ts:19`、`:47`（可选第三参 `extraEnv`，spawn 的 `env` 叠加它）
- Create: `src/agents/types.ts`、`src/agents/registry.ts`、`src/agents/claude.ts`、`src/agents/codex.ts`、`src/agents/table.ts`、`src/agents/materialize.ts`
- Test（新）：`tests/agents/registry.test.ts`、`tests/runtime/codex/extraEnv.test.ts`、`tests/agents/table.test.ts`、`tests/agents/materialize.test.ts`

**Interfaces**

- Consumes：`canonicalHash`（`src/control/protocol.ts:190`）、`idSchema`（本 Task 导出）、`parseCodexConfig`／`CodexConfig`、`CodexAdapter`、`RuntimeAdapter`。
- Produces（骨架名，另见 W1-3／W1-7／W1-8 的增补）：`ContextWindow`、`AgentSelectionV1`、`PartialSelectionV1`、`InstallationV1`、`AgentsTableV1`、`MaterializedAgentConfigV1`、`AgentResolutionV1`、`CapabilityViewV1`、`AgentError`；`AgentDescriptor`、`getDescriptor`、`listDescriptors`；`readAgentsTable`、`parseAgentsTable`、`assertAgentsTablePath`；`resolveAgent`、`agentConfigHash`、`probeVersion`；`toCodexConfig`；`CodexAdapter(rawConfig, extraEnv?)`、`runCodexPhase(config, request, extraEnv?)`。

#### 1a 描述与注册表

- [ ] **Step 1.1 写失败判据** `tests/agents/registry.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { claudeDescriptor, claudeModelArgument } from "../../src/agents/claude.js";
import { codexDescriptor, toCodexConfig } from "../../src/agents/codex.js";
import { getDescriptor, listDescriptors } from "../../src/agents/registry.js";
import { AGENT_ERROR_CODES, AgentError, type AgentSelectionV1, type MaterializedAgentConfigV1 } from "../../src/agents/types.js";
import { CodexAdapter } from "../../src/runtime/codex/codexAdapter.js";

function config(kind: "claude" | "codex", selection: Partial<AgentSelectionV1> = {}): MaterializedAgentConfigV1 {
  const extras = kind === "codex" ? { sandbox: "workspace-write", budgetMode: "soft" } : {};
  return {
    schema: "ccloop-agent-config-v1",
    kind,
    installation: { kind, command: ["/bin/echo"], version: "1.2.3", configDir: null, timeoutMs: 1000, killGraceMs: 50, ...extras },
    selection: { agent: kind, model: kind === "claude" ? "claude-opus-5-5" : "gpt-6-sol", contextWindow: "agent-default", ...selection },
  };
}

describe("agent descriptors", () => {
  it("registers exactly claude and codex, and names an unknown kind as a missing installation", () => {
    expect(listDescriptors().map((descriptor) => descriptor.kind)).toEqual(["claude", "codex"]);
    expect(getDescriptor("codex")).toBe(codexDescriptor);
    expect(() => getDescriptor("opencode")).toThrow(expect.objectContaining({ code: "agent-installation-missing" }));
  });

  // Controller ruling (2026-09-26): a CLI prints an AgentError's message verbatim, so it must start with the code.
  it("puts the code first in an AgentError's message, with the detail after it", () => {
    expect(new AgentError("agent-version-drift", "claude: table 2.1.282, observed 2.1.283").message).toBe("agent-version-drift: claude: table 2.1.282, observed 2.1.283");
    expect(new AgentError("agent-unselected").message).toBe("agent-unselected");
    expect(AGENT_ERROR_CODES).toContain("agent-selection-file-invalid");
  });

  it("carries the defaults Task 0 measured (progress §1): claude-opus-5-5 with 1M expressible, gpt-6-sol default-only", () => {
    expect(claudeDescriptor.defaults).toEqual({ model: "claude-opus-5-5", contextWindow: "agent-default" });
    expect(claudeDescriptor.contextOptions).toEqual(["agent-default", 1_000_000]);
    expect(claudeDescriptor.configDirEnv).toBe("CLAUDE_CONFIG_DIR");
    expect(codexDescriptor.defaults).toEqual({ model: "gpt-6-sol", contextWindow: "agent-default" });
    expect(codexDescriptor.contextOptions).toEqual(["agent-default"]);
    expect(codexDescriptor.configDirEnv).toBe("CODEX_HOME");
  });

  // A model becomes a CLI argument (spec §12 I14): it must never be readable as a flag or split into two arguments.
  it.each([
    ["", "empty"],
    ["-p", "flag-like"],
    ["--dangerously-skip-permissions", "flag-like"],
    ["claude opus", "space"],
    ["claude\topus", "tab"],
    ["claude\nopus", "newline"],
    ["claude\u0000opus", "control character"],
    ["x".repeat(201), "longer than 200"],
  ])("rejects the model %j (%s) for both kinds as agent-selection-invalid", (model) => {
    for (const descriptor of [claudeDescriptor, codexDescriptor]) {
      expect(() => descriptor.validateSelection({ agent: descriptor.kind, model, contextWindow: "agent-default" }))
        .toThrow(expect.objectContaining({ code: "agent-selection-invalid" }));
    }
  });

  it("accepts opaque models it cannot interpret, including aliases with a [1m] suffix and 200 characters", () => {
    for (const model of ["opus", "sonnet[1m]", "litellm/anthropic/claude-x", "x".repeat(200)]) {
      expect(() => claudeDescriptor.validateSelection({ agent: "claude", model, contextWindow: "agent-default" })).not.toThrow();
    }
  });

  it("accepts a context window only when the kind can express it", () => {
    expect(() => claudeDescriptor.validateSelection({ agent: "claude", model: "opus", contextWindow: 1_000_000 })).not.toThrow();
    expect(() => claudeDescriptor.validateSelection({ agent: "claude", model: "opus", contextWindow: 200_000 }))
      .toThrow(expect.objectContaining({ code: "agent-context-unsupported" }));
    expect(() => codexDescriptor.validateSelection({ agent: "codex", model: "gpt-6-sol", contextWindow: 1_000_000 }))
      .toThrow(expect.objectContaining({ code: "agent-context-unsupported" }));
  });

  // Spec §12 I6: a requested window is not an observation; only claude's verified 1M mapping is reported.
  it("reports contextWindowTokens only for claude's verified 1M mapping and null otherwise", () => {
    expect(claudeDescriptor.capabilities(config("claude", { contextWindow: 1_000_000 })).contextWindowTokens).toBe(1_000_000);
    expect(claudeDescriptor.capabilities(config("claude")).contextWindowTokens).toBeNull();
    expect(codexDescriptor.capabilities(config("codex"))).toEqual({
      usageObservation: "phase-end",
      budgetEnforcement: "soft",
      contextObservation: "unavailable",
      handoffControl: "durable",
      handoffExecution: "mechanical-in-run-v1",
      contextWindowTokens: null,
      requestBoundProof: null,
    });
  });

  it("spells 1M for the claude CLI as the [1m] model suffix and nothing else", () => {
    expect(claudeModelArgument({ agent: "claude", model: "claude-opus-5-5", contextWindow: 1_000_000 })).toBe("claude-opus-5-5[1m]");
    expect(claudeModelArgument({ agent: "claude", model: "claude-opus-5-5", contextWindow: "agent-default" })).toBe("claude-opus-5-5");
  });

  it("builds the codex runtime config from the installation and the selected model", () => {
    const materialized = config("codex", { model: "gpt-6-luna" });
    expect(toCodexConfig(materialized)).toEqual({
      command: ["/bin/echo"], model: "gpt-6-luna", budgetMode: "soft", sandbox: "workspace-write", timeoutMs: 1000, killGraceMs: 50,
    });
    expect(codexDescriptor.createAdapter(materialized)).toBeInstanceOf(CodexAdapter);
  });

  // Agent selection plan T1 -> T3: T3 rewrites this criterion when ClaudeAgentAdapter exists.
  it("does not yet build a claude adapter", () => {
    expect(() => claudeDescriptor.createAdapter(config("claude"))).toThrow(expect.objectContaining({ code: "agent-adapter-unavailable" }));
  });
});
```

- [ ] **Step 1.2 写失败判据** `tests/runtime/codex/extraEnv.test.ts`：

```ts
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { codexDescriptor } from "../../../src/agents/codex.js";
import type { MaterializedAgentConfigV1 } from "../../../src/agents/types.js";
import { parseCodexConfig } from "../../../src/runtime/codex/protocol.js";
import { runCodexPhase } from "../../../src/runtime/codex/runCodexPhase.js";
import { codexFixture } from "./fixture.js";

// Records the CODEX_HOME the spawned CLI saw, then exits without answering (the phase itself is not under test).
async function envProbe(dir: string): Promise<{ command: [string, ...string[]]; seen: string }> {
  const script = join(dir, "env-probe.mjs");
  const seen = join(dir, "seen.json");
  await writeFile(script, `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(seen)}, JSON.stringify(process.env.CODEX_HOME ?? null));`, { mode: 0o600 });
  return { command: [process.execPath, script], seen };
}

// Spec §4.2 / §12 I14: a table record's configDir is part of the hashed config, so the CLI must actually run with it.
describe("codex config directory", () => {
  it("runs the CLI with extraEnv on top of the inherited environment", async () => {
    const f = await codexFixture("integration");
    const probe = await envProbe(f.dir);
    const config = parseCodexConfig({ ...f.config, command: probe.command });
    await runCodexPhase(config, { phase: "plan", prompt: "p", context: f.context }, { CODEX_HOME: "/tmp/codex-home-a" });
    expect(JSON.parse(await readFile(probe.seen, "utf8"))).toBe("/tmp/codex-home-a");
    await runCodexPhase(config, { phase: "plan", prompt: "p", context: f.context });
    expect(JSON.parse(await readFile(probe.seen, "utf8"))).toBe(process.env.CODEX_HOME ?? null);
  });

  it("sets CODEX_HOME from the installation's configDir through the descriptor's adapter", async () => {
    const f = await codexFixture("integration");
    const probe = await envProbe(f.dir);
    const materialized: MaterializedAgentConfigV1 = {
      schema: "ccloop-agent-config-v1",
      kind: "codex",
      installation: { kind: "codex", command: probe.command, version: "0.155.1", configDir: "/tmp/codex-home-b", timeoutMs: 10_000, killGraceMs: 50, sandbox: "workspace-write", budgetMode: "soft" },
      selection: { agent: "codex", model: "gpt-6-sol", contextWindow: "agent-default" },
    };
    await expect(codexDescriptor.createAdapter(materialized).plan(f.context)).rejects.toThrow();
    expect(JSON.parse(await readFile(probe.seen, "utf8"))).toBe("/tmp/codex-home-b");
  });
});
```

- [ ] **Step 1.3 跑红**：

```sh
cd $C && ./node_modules/.bin/vitest run tests/agents/registry.test.ts tests/runtime/codex/extraEnv.test.ts > $S/t1a-red.log 2>&1; echo rc=$?
```

Expected：`rc=1`；两个文件都是 `Failed to load url ../../src/agents/claude.js`／`../../../src/agents/codex.js … Does the file exist?`，`Tests  no tests`（现量 15）。整份读回 `$S/t1a-red.log`。

- [ ] **Step 1.4 导出 `idSchema`**：`src/control/protocol.ts`

```diff
diff --git a/src/control/protocol.ts b/src/control/protocol.ts
index 4ac2f7e..554457e 100644
--- a/src/control/protocol.ts
+++ b/src/control/protocol.ts
@@ -97,5 +97,5 @@ export class ControlProtocolError extends Error {
 const safeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
 const positiveSafeInteger = safeInteger.refine((value) => value > 0);
-const idSchema = z.string().min(1).max(200).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/);
+export const idSchema = z.string().min(1).max(200).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/);
 const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
 const amountSchema = z
```

- [ ] **Step 1.5 `extraEnv`**：`src/runtime/codex/runCodexPhase.ts` 与 `src/runtime/codex/codexAdapter.ts`

```diff
diff --git a/src/runtime/codex/runCodexPhase.ts b/src/runtime/codex/runCodexPhase.ts
index 9b254ac..f2b0b50 100644
--- a/src/runtime/codex/runCodexPhase.ts
+++ b/src/runtime/codex/runCodexPhase.ts
@@ -17,5 +17,5 @@ export type PhaseOutcome = {
 const LIMIT=16*1024*1024;
 const execFileAsync=promisify(execFile);
-export async function runCodexPhase(config:CodexConfig, request:PhaseRequest):Promise<PhaseOutcome> {
+export async function runCodexPhase(config:CodexConfig, request:PhaseRequest, extraEnv?:Record<string,string>):Promise<PhaseOutcome> {
   const {context,phase}=request;
   const root=join(context.runDir,"codex",String(context.attempt),phase);
@@ -45,5 +45,5 @@ export async function runCodexPhase(config:CodexConfig, request:PhaseRequest):Pr
   await save("final.json","");await save("events.jsonl","");await save("stderr.log","");logsCreated=true;
   await new Promise<void>(resolve=>{
-    const child=spawn(config.command[0],args,{cwd:context.worktreePath,detached:true,stdio:["pipe","pipe","pipe"],env:process.env});
+    const child=spawn(config.command[0],args,{cwd:context.worktreePath,detached:true,stdio:["pipe","pipe","pipe"],env:{...process.env,...extraEnv}});
     const out=new StringDecoder("utf8"),err=new StringDecoder("utf8");
     let outBytes=0,errBytes=0,done=false,exited=false;
```

```diff
diff --git a/src/runtime/codex/codexAdapter.ts b/src/runtime/codex/codexAdapter.ts
index 5340d78..8641907 100644
--- a/src/runtime/codex/codexAdapter.ts
+++ b/src/runtime/codex/codexAdapter.ts
@@ -17,8 +17,9 @@ export class CodexPhaseAborted extends Error {
 export class CodexAdapter implements RuntimeAdapter {
   private readonly config: CodexConfig;
-  constructor(rawConfig: unknown) { this.config = parseCodexConfig(rawConfig); }
+  // Agent selection (2026-09-26): extraEnv carries the installation's config directory (CODEX_HOME) to the CLI.
+  constructor(rawConfig: unknown, private readonly extraEnv?: Record<string, string>) { this.config = parseCodexConfig(rawConfig); }
 
   private async phase<P extends CodexPhase>(phase: P, prompt: string, context: AttemptContext): Promise<PhaseResults[P]> {
-    const outcome = await runCodexPhase(this.config, { phase, prompt, context });
+    const outcome = await runCodexPhase(this.config, { phase, prompt, context }, this.extraEnv);
     if (outcome.reason === "aborted") throw new CodexPhaseAborted(outcome.evidenceDir, outcome.observedTokens);
     if (outcome.reason !== "completed" || outcome.final === null) {
```

- [ ] **Step 1.6 新建** `src/agents/types.ts`：

```ts
import { join } from "node:path";
import { z } from "zod";
import { idSchema } from "../control/protocol.js";

/** Agent selection (spec 2026-09-26 §3): a context window is "agent-default" or a positive safe integer, never null. */
export type ContextWindow = "agent-default" | number;
export interface AgentSelectionV1 { agent: string; model: string; contextWindow: ContextWindow }
export interface PartialSelectionV1 { agent?: string; model?: string; contextWindow?: ContextWindow }
export interface InstallationV1 {
  kind: string;
  command: [string, ...string[]];
  version: string;
  configDir: string | null;
  timeoutMs: number;
  killGraceMs: number;
  [extra: string]: unknown;
}
export interface AgentsTableV1 { schema: "ccloop-agents-table-v1"; installations: Record<string, InstallationV1> }
/** The eight capability fields of the control wire, without `protocol`. */
export interface CapabilityViewV1 {
  usageObservation: "realtime" | "phase-end" | "unavailable";
  budgetEnforcement: "bounded" | "soft" | "unavailable";
  contextObservation: "realtime" | "phase-end" | "unavailable";
  handoffControl: "durable" | "phase-end" | "unavailable";
  handoffExecution: "mechanical-in-run-v1" | "model-assisted-v1" | null;
  contextWindowTokens: number | null;
  requestBoundProof: {
    scheme: "adapter-request-bound-v1";
    version: string;
    workDimensions: string[];
    handoffDimensions: string[];
    evidenceKind: string;
  } | null;
}
export interface MaterializedAgentConfigV1 {
  schema: "ccloop-agent-config-v1";
  kind: string;
  installation: InstallationV1;
  selection: AgentSelectionV1;
}
export interface AgentResolutionV1 {
  selection: AgentSelectionV1;
  configHash: string;
  timeoutMs: number;
  killGraceMs: number;
  capabilities: CapabilityViewV1;
}

/** Every code an AgentError can carry (agent selection spec §7, plus the plan's additions). */
export const AGENT_ERROR_CODES = [
  "agents-table-invalid",
  "agent-installation-missing",
  "agent-context-unsupported",
  "agent-selection-invalid",
  "agent-version-drift",
  "agent-unselected",
  "agent-config-invalid",
  "agent-selection-file-invalid",
  "agents-command-invalid",
  "agent-adapter-unavailable",
] as const;
export type AgentErrorCode = (typeof AGENT_ERROR_CODES)[number];

/** A named agent failure. `message` starts with the code (`<code>` or `<code>: <detail>`), so a CLI prints it verbatim. */
export class AgentError extends Error {
  constructor(readonly code: AgentErrorCode, readonly detail?: string) {
    super(detail === undefined ? code : `${code}: ${detail}`);
    this.name = "AgentError";
  }
}

export const contextWindowSchema = z.union([
  z.literal("agent-default"),
  z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
]);
export const agentSelectionSchema = z
  .object({ agent: idSchema, model: z.string(), contextWindow: contextWindowSchema })
  .strict();
export const partialSelectionSchema = z
  .object({ agent: idSchema.optional(), model: z.string().optional(), contextWindow: contextWindowSchema.optional() })
  .strict();

const MODEL_MAX_LENGTH = 200;
/**
 * Spec §4.1 / §12 I14: a model is an opaque string to Orca, but it becomes a CLI argument here, so it may not
 * look like a flag, carry whitespace or control characters, or run past 200 characters.
 */
export function assertModel(model: string): void {
  if (model.length === 0 || model.length > MODEL_MAX_LENGTH || model.startsWith("-") || /[\s\p{Cc}]/u.test(model)) {
    throw new AgentError("agent-selection-invalid", `model ${JSON.stringify(model.slice(0, MODEL_MAX_LENGTH))}`);
  }
}

export function assertContextOption(options: ContextWindow[], selection: AgentSelectionV1): void {
  if (!options.includes(selection.contextWindow)) {
    throw new AgentError("agent-context-unsupported", `context window ${String(selection.contextWindow)}`);
  }
}

/** Candidate directories shared by every kind, in search order (after cc-switch's build_tool_search_paths). */
export function commonSearchDirs(input: { home: string; platform: NodeJS.Platform }): string[] {
  return [
    join(input.home, ".local", "bin"),
    join(input.home, ".npm-global", "bin"),
    join(input.home, "n", "bin"),
    join(input.home, ".volta", "bin"),
    join(input.home, ".bun", "bin"),
    join(input.home, ".local", "share", "mise", "shims"),
    ...(input.platform === "darwin" ? ["/opt/homebrew/bin"] : []),
    "/usr/local/bin",
  ];
}
```

- [ ] **Step 1.7 新建** `src/agents/registry.ts`（`draftInstallationExtras` 是 W1-3 的增补）：

```ts
import type { z } from "zod";
import type { RuntimeAdapter } from "../runtime/types.js";
import { claudeDescriptor } from "./claude.js";
import { codexDescriptor } from "./codex.js";
import {
  AgentError,
  type AgentSelectionV1,
  type CapabilityViewV1,
  type ContextWindow,
  type MaterializedAgentConfigV1,
} from "./types.js";

/**
 * One agent kind (spec 2026-09-26 §4.1). A new kind is one descriptor plus one adapter, registered below;
 * Orca never sees more than the kind string.
 */
export interface AgentDescriptor {
  kind: string;
  binary: string;
  searchDirs(input: { home: string; env: NodeJS.ProcessEnv; platform: NodeJS.Platform }): string[];
  configDirEnv: string;
  defaults: { model: string; contextWindow: ContextWindow };
  contextOptions: ContextWindow[];
  /** Kind-only installation fields, merged into the strict installation schema. */
  installationExtras: z.ZodRawShape;
  /** The values `agents detect` writes for installationExtras in a draft table. */
  draftInstallationExtras: Record<string, unknown>;
  validateSelection(selection: AgentSelectionV1): void;
  capabilities(config: MaterializedAgentConfigV1): CapabilityViewV1;
  createAdapter(config: MaterializedAgentConfigV1): RuntimeAdapter;
}

const DESCRIPTORS: readonly AgentDescriptor[] = [claudeDescriptor, codexDescriptor];

export function getDescriptor(kind: string): AgentDescriptor {
  const descriptor = DESCRIPTORS.find((candidate) => candidate.kind === kind);
  if (descriptor === undefined) throw new AgentError("agent-installation-missing", `unknown agent kind ${JSON.stringify(kind)}`);
  return descriptor;
}

export function listDescriptors(): AgentDescriptor[] {
  return [...DESCRIPTORS];
}
```

- [ ] **Step 1.8 新建** `src/agents/claude.ts`（`createAdapter` 的临时抛错见 W1-10）：

```ts
import { join } from "node:path";
import type { AgentDescriptor } from "./registry.js";
import {
  AgentError,
  assertContextOption,
  assertModel,
  commonSearchDirs,
  type AgentSelectionV1,
  type ContextWindow,
} from "./types.js";

const ONE_MILLION = 1_000_000;
const CONTEXT_OPTIONS: ContextWindow[] = ["agent-default", ONE_MILLION];

/**
 * The one place the 1M window is spelled for the claude CLI: `--model <model>[1m]` (Task 0, progress §1:
 * the claude 2.1.282 binary carries "append [1m] to the model name for 1M").
 */
export function claudeModelArgument(selection: AgentSelectionV1): string {
  return selection.contextWindow === ONE_MILLION ? `${selection.model}[1m]` : selection.model;
}

export const claudeDescriptor: AgentDescriptor = {
  kind: "claude",
  binary: "claude",
  searchDirs: ({ home, platform }) => [join(home, ".claude", "local"), ...commonSearchDirs({ home, platform })],
  configDirEnv: "CLAUDE_CONFIG_DIR",
  defaults: { model: "claude-opus-5-5", contextWindow: "agent-default" },
  contextOptions: CONTEXT_OPTIONS,
  installationExtras: {},
  draftInstallationExtras: {},
  validateSelection(selection) {
    assertModel(selection.model);
    assertContextOption(CONTEXT_OPTIONS, selection);
  },
  capabilities(config) {
    return {
      usageObservation: "phase-end",
      budgetEnforcement: "soft",
      contextObservation: "unavailable",
      handoffControl: "durable",
      handoffExecution: "mechanical-in-run-v1",
      // Spec §12 I6: only a mapping Task 0 verified is reported; "agent-default" stays unknown (null).
      contextWindowTokens: config.selection.contextWindow === ONE_MILLION ? ONE_MILLION : null,
      requestBoundProof: null,
    };
  },
  createAdapter() {
    // Agent selection plan T1: ClaudeAgentAdapter lands in T3, which replaces this line.
    throw new AgentError("agent-adapter-unavailable", "claude");
  },
};
```

- [ ] **Step 1.9 新建** `src/agents/codex.ts`：

```ts
import { z } from "zod";
import { CodexAdapter } from "../runtime/codex/codexAdapter.js";
import { parseCodexConfig, type CodexConfig } from "../runtime/codex/protocol.js";
import type { AgentDescriptor } from "./registry.js";
import {
  assertContextOption,
  assertModel,
  commonSearchDirs,
  type ContextWindow,
  type MaterializedAgentConfigV1,
} from "./types.js";

const CONTEXT_OPTIONS: ContextWindow[] = ["agent-default"];

/** The codex runtime's own config, taken from a materialized agent config; parseCodexConfig keeps its constraints. */
export function toCodexConfig(config: MaterializedAgentConfigV1): CodexConfig {
  const { installation, selection } = config;
  return parseCodexConfig({
    command: installation.command,
    model: selection.model,
    budgetMode: installation.budgetMode,
    sandbox: installation.sandbox,
    timeoutMs: installation.timeoutMs,
    killGraceMs: installation.killGraceMs,
  });
}

export const codexDescriptor: AgentDescriptor = {
  kind: "codex",
  binary: "codex",
  searchDirs: ({ home, platform }) => commonSearchDirs({ home, platform }),
  configDirEnv: "CODEX_HOME",
  defaults: { model: "gpt-6-sol", contextWindow: "agent-default" },
  contextOptions: CONTEXT_OPTIONS,
  installationExtras: { sandbox: z.enum(["read-only", "workspace-write"]), budgetMode: z.literal("soft") },
  draftInstallationExtras: { sandbox: "workspace-write", budgetMode: "soft" },
  validateSelection(selection) {
    assertModel(selection.model);
    assertContextOption(CONTEXT_OPTIONS, selection);
  },
  capabilities() {
    return {
      usageObservation: "phase-end",
      budgetEnforcement: "soft",
      contextObservation: "unavailable",
      handoffControl: "durable",
      handoffExecution: "mechanical-in-run-v1",
      contextWindowTokens: null,
      requestBoundProof: null,
    };
  },
  createAdapter(config) {
    const { configDir } = config.installation;
    return new CodexAdapter(toCodexConfig(config), configDir === null ? undefined : { CODEX_HOME: configDir });
  },
};
```

- [ ] **Step 1.10 跑绿＋类型**：

```sh
cd $C && ./node_modules/.bin/vitest run tests/agents/registry.test.ts tests/runtime/codex/extraEnv.test.ts > $S/t1a-green.log 2>&1; echo rc=$?
./node_modules/.bin/tsc --noEmit -p tsconfig.json > $S/t1a-tsc.log 2>&1; echo tsc=$?
./node_modules/.bin/vitest run tests/runtime/codex tests/control/protocol.test.ts > $S/t1a-existing.log 2>&1; echo rc=$?
```

Expected：`rc=0`（registry 17、extraEnv 2）；`tsc=0` 且日志为空；既有 codex 运行时与 protocol 判据全绿（写作席副本 10 文件 80/80）。

- [ ] **Step 1.11 提交**（1a）：

```sh
cd $C && /usr/bin/git add src/control/protocol.ts src/runtime/codex/codexAdapter.ts src/runtime/codex/runCodexPhase.ts src/agents/types.ts src/agents/registry.ts src/agents/claude.ts src/agents/codex.ts tests/agents/registry.test.ts tests/runtime/codex/extraEnv.test.ts
/usr/bin/git commit -F - <<'MSG'
feat(agents): add agent descriptors for claude and codex with selection validation

Agent selection (2026-09-26) spec §4.1: one descriptor per kind with its defaults,
expressible context windows, model constraints and capability view; codex runs with
the installation's CODEX_HOME through a new optional extraEnv.

Co-Authored-By: <实施席自己的模型> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR
MSG
```

#### 1b 安装表

- [ ] **Step 1.12 写失败判据** `tests/agents/table.test.ts`：

```ts
import { chmod, mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertAgentsTablePath, parseAgentsTable, readAgentsTable } from "../../src/agents/table.js";

const claude = { kind: "claude", command: ["/usr/local/bin/claude"], version: "2.1.282", configDir: null, timeoutMs: 1_800_000, killGraceMs: 5_000 };
const codex = { kind: "codex", command: ["/usr/local/bin/codex", "--flag"], version: "0.155.1", configDir: "/Users/me/.codex", timeoutMs: 1_800_000, killGraceMs: 5_000, sandbox: "workspace-write", budgetMode: "soft" };
const table = { schema: "ccloop-agents-table-v1", installations: { claude, codex } };
const invalid = expect.objectContaining({ code: "agents-table-invalid" });

async function privateDir(): Promise<string> {
  return await realpath(await mkdtemp(join(tmpdir(), "ccloop-agents-table-")));
}

async function writeTable(dir: string, value: unknown = table, mode = 0o600): Promise<string> {
  const path = join(dir, "agents.json");
  await writeFile(path, typeof value === "string" ? value : JSON.stringify(value), { mode });
  await chmod(path, mode);
  return path;
}

describe("agents table schema", () => {
  it("accepts the spec §4.2 example with a kind-specific extra per codex record", () => {
    expect(parseAgentsTable(table)).toEqual(table);
  });

  it("accepts an empty table (detect found nothing)", () => {
    expect(parseAgentsTable({ schema: "ccloop-agents-table-v1", installations: {} }).installations).toEqual({});
  });

  // Spec §3: env/secretEnv are reserved for the provider slice and must be refused until then, not ignored.
  it.each([
    ["env on claude", { claude: { ...claude, env: { ANTHROPIC_BASE_URL: "http://x" } } }],
    ["secretEnv on codex", { codex: { ...codex, secretEnv: ["TOKEN"] } }],
    ["a codex extra on claude", { claude: { ...claude, sandbox: "workspace-write" } }],
    ["codex without sandbox", { codex: { ...codex, sandbox: undefined } }],
    ["codex with a strict budget", { codex: { ...codex, budgetMode: "strict" } }],
    ["an unknown kind", { other: { ...claude, kind: "opencode" } }],
    ["a record without kind", { claude: { ...claude, kind: undefined } }],
    ["a relative command", { claude: { ...claude, command: ["claude"] } }],
    ["an empty command", { claude: { ...claude, command: [] } }],
    ["a relative configDir", { claude: { ...claude, configDir: ".claude" } }],
    ["an empty version", { claude: { ...claude, version: "" } }],
    ["timeoutMs above the timer ceiling", { claude: { ...claude, timeoutMs: 2_147_483_648 } }],
    ["killGraceMs above 60s", { claude: { ...claude, killGraceMs: 60_001 } }],
    ["an id that is not an idSchema id", { "-claude": claude }],
  ])("refuses %s", (_name, installations) => {
    expect(() => parseAgentsTable({ schema: "ccloop-agents-table-v1", installations })).toThrow(invalid);
  });

  it("refuses another schema name and extra top-level keys", () => {
    expect(() => parseAgentsTable({ ...table, schema: "ccloop-agents-table-v2" })).toThrow(invalid);
    expect(() => parseAgentsTable({ ...table, defaults: {} })).toThrow(invalid);
  });
});

describe("reading the agents table", () => {
  it("reads a private regular file in a private directory", async () => {
    const path = await writeTable(await privateDir());
    expect(await readAgentsTable(path)).toEqual(table);
  });

  it("refuses a symlink even when it points at a valid table", async () => {
    const dir = await privateDir();
    const target = await writeTable(dir);
    const link = join(dir, "link.json");
    await symlink(target, link);
    // ELOOP comes from the no-follow open itself, before any later check could run.
    await expect(readAgentsTable(link)).rejects.toMatchObject({ code: "agents-table-invalid", detail: expect.stringContaining("ELOOP") });
  });

  it("refuses a directory, a relative path and a missing file", async () => {
    const dir = await privateDir();
    await mkdir(join(dir, "agents.json"), { mode: 0o700 });
    await expect(readAgentsTable(join(dir, "agents.json"))).rejects.toMatchObject({ code: "agents-table-invalid", detail: "table is not a regular file" });
    await expect(readAgentsTable("agents.json")).rejects.toThrow(invalid);
    await expect(readAgentsTable(join(dir, "missing.json"))).rejects.toThrow(invalid);
  });

  // O_NOFOLLOW guards only the last component; a symlinked directory on the way is caught by the realpath check.
  it("refuses a path that reaches the table through a symlinked directory", async () => {
    const dir = await privateDir();
    await mkdir(join(dir, "real"), { mode: 0o700 });
    const path = await writeTable(join(dir, "real"));
    await symlink(join(dir, "real"), join(dir, "alias"));
    await expect(readAgentsTable(join(dir, "alias", "agents.json"))).rejects.toMatchObject({ code: "agents-table-invalid", detail: "table path is not its own realpath" });
    expect(await readAgentsTable(path)).toEqual(table);
  });

  // Spec §12 I14: whoever can write the table chooses the binary every run executes.
  it("refuses a group- or world-writable table", async () => {
    for (const mode of [0o620, 0o602]) {
      const path = await writeTable(await privateDir(), table, mode);
      await expect(readAgentsTable(path)).rejects.toThrow(invalid);
    }
  });

  it("refuses a table whose directory is group- or world-writable", async () => {
    for (const mode of [0o770, 0o707]) {
      const dir = await privateDir();
      const path = await writeTable(dir);
      await chmod(dir, mode);
      await expect(readAgentsTable(path)).rejects.toThrow(invalid);
    }
  });

  it("refuses a table owned by another user", async () => {
    const path = await writeTable(await privateDir());
    await expect(readAgentsTable(path, { euid: process.geteuid!() + 1 })).rejects.toThrow(invalid);
  });

  it("refuses bytes that are not JSON and JSON that is not a table", async () => {
    await expect(readAgentsTable(await writeTable(await privateDir(), "{not json"))).rejects.toThrow(invalid);
    await expect(readAgentsTable(await writeTable(await privateDir(), { schema: "ccloop-agents-table-v1" }))).rejects.toThrow(invalid);
  });
});

// Spec §12 I4: a broken table must not stand in the way of collecting runs already in flight.
describe("checking only the table path's shape", () => {
  it("accepts a canonical regular file whatever its content or mode", async () => {
    await expect(assertAgentsTablePath(await writeTable(await privateDir(), "{not json", 0o666))).resolves.toBeUndefined();
  });

  it("refuses a symlink, a directory and a relative path", async () => {
    const dir = await privateDir();
    const target = await writeTable(dir);
    await symlink(target, join(dir, "link.json"));
    await expect(assertAgentsTablePath(join(dir, "link.json"))).rejects.toThrow(invalid);
    await expect(assertAgentsTablePath(dir)).rejects.toThrow(invalid);
    await expect(assertAgentsTablePath("agents.json")).rejects.toThrow(invalid);
  });

  it("refuses a path that reaches the table through a symlinked directory", async () => {
    const dir = await privateDir();
    await mkdir(join(dir, "real"), { mode: 0o700 });
    const path = await writeTable(join(dir, "real"));
    await symlink(join(dir, "real"), join(dir, "alias"));
    await expect(assertAgentsTablePath(join(dir, "alias", "agents.json"))).rejects.toThrow(invalid);
    await expect(assertAgentsTablePath(path)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 1.13 跑红**：

```sh
cd $C && ./node_modules/.bin/vitest run tests/agents/table.test.ts > $S/t1b-red.log 2>&1; echo rc=$?
```

Expected：`rc=1`，`Failed to load url ../../src/agents/table.js`。

- [ ] **Step 1.14 新建** `src/agents/table.ts`：

```ts
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { z } from "zod";
import { idSchema } from "../control/protocol.js";
import { getDescriptor } from "./registry.js";
import { AgentError, type AgentsTableV1, type InstallationV1 } from "./types.js";

const MAX_TABLE_BYTES = 1024 * 1024;
const commonInstallation = {
  kind: z.string().min(1),
  command: z.tuple([z.string().min(1).refine(isAbsolute)]).rest(z.string()),
  version: z.string().min(1),
  configDir: z.string().min(1).refine(isAbsolute).nullable(),
  timeoutMs: z.number().int().positive().max(2_147_483_647),
  killGraceMs: z.number().int().nonnegative().max(60_000),
};
const tableShape = z
  .object({ schema: z.literal("ccloop-agents-table-v1"), installations: z.record(z.unknown()) })
  .strict();
const kindShape = z.object({ kind: z.string() }).passthrough();

function invalid(detail: string): AgentError {
  return new AgentError("agents-table-invalid", detail);
}

/** One installation record, checked against the common fields plus its kind's strict extras. */
export function parseInstallation(raw: unknown): InstallationV1 {
  const kind = kindShape.safeParse(raw);
  if (!kind.success) throw invalid("installation has no kind");
  let extras: z.ZodRawShape;
  try {
    extras = getDescriptor(kind.data.kind).installationExtras;
  } catch {
    throw invalid(`unknown agent kind ${JSON.stringify(kind.data.kind)}`);
  }
  const parsed = z.object({ ...commonInstallation, ...extras }).strict().safeParse(raw);
  if (!parsed.success) throw invalid(parsed.error.message);
  return parsed.data as InstallationV1;
}

export function parseAgentsTable(raw: unknown): AgentsTableV1 {
  const table = tableShape.safeParse(raw);
  if (!table.success) throw invalid(table.error.message);
  const installations: Record<string, InstallationV1> = {};
  for (const [id, entry] of Object.entries(table.data.installations)) {
    if (!idSchema.safeParse(id).success) throw invalid(`installation id ${JSON.stringify(id)}`);
    try {
      installations[id] = parseInstallation(entry);
    } catch (error) {
      throw invalid(`${id}: ${error instanceof AgentError ? error.detail ?? error.code : String(error)}`);
    }
  }
  return { schema: "ccloop-agents-table-v1", installations };
}

function assertPrivate(metadata: { uid: number; mode: number }, euid: number, what: string): void {
  if (metadata.uid !== euid) throw invalid(`${what} is not owned by the effective user`);
  if ((metadata.mode & 0o022) !== 0) throw invalid(`${what} is group- or world-writable`);
}

/**
 * Spec §4.2 / §12 I14: the table is read only through a no-follow handle, must be a regular file whose path
 * is its own realpath, and it and its directory must belong to the effective user and be writable by no one
 * else. `deps.euid` exists so a criterion can observe the owner check without root.
 */
export async function readAgentsTable(path: string, deps: { euid?: number } = {}): Promise<AgentsTableV1> {
  if (!isAbsolute(path)) throw invalid("table path is not absolute");
  const euid = deps.euid ?? process.geteuid!();
  let handle;
  let text: string;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw invalid("table is not a regular file");
    assertPrivate(metadata, euid, "table");
    if (metadata.size > MAX_TABLE_BYTES) throw invalid("table is larger than 1 MiB");
    if ((await realpath(path)) !== path) throw invalid("table path is not its own realpath");
    const parent = await lstat(dirname(path));
    if (!parent.isDirectory()) throw invalid("table directory is not a directory");
    assertPrivate(parent, euid, "table directory");
    text = (await handle.readFile()).toString("utf8");
  } catch (error) {
    if (error instanceof AgentError) throw error;
    throw invalid(error instanceof Error ? error.message : String(error));
  } finally {
    await handle?.close();
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw invalid("table is not JSON");
  }
  return parseAgentsTable(raw);
}

/** Spec §12 I4: methods other than capabilities/accept check only the path's shape, never the content. */
export async function assertAgentsTablePath(path: string): Promise<void> {
  if (!isAbsolute(path)) throw invalid("table path is not absolute");
  try {
    const canonical = await realpath(path);
    const metadata = await lstat(path);
    if (canonical !== path || !metadata.isFile()) throw invalid("table path is not a canonical regular file");
  } catch (error) {
    if (error instanceof AgentError) throw error;
    throw invalid(error instanceof Error ? error.message : String(error));
  }
}
```

- [ ] **Step 1.15 跑绿**：

```sh
cd $C && ./node_modules/.bin/vitest run tests/agents/table.test.ts > $S/t1b-green.log 2>&1; echo rc=$?
./node_modules/.bin/tsc --noEmit -p tsconfig.json > $S/t1b-tsc.log 2>&1; echo tsc=$?
```

Expected：`rc=0`（28 条）；`tsc=0`。

- [ ] **Step 1.16 提交**（1b）：

```sh
cd $C && /usr/bin/git add src/agents/table.ts tests/agents/table.test.ts
/usr/bin/git commit -F - <<'MSG'
feat(agents): read the agents table with schema and ownership checks

Agent selection (2026-09-26) spec §4.2, §12 I4/I14: a strict per-kind installation
schema; the table is read through a no-follow handle, must be its own realpath, and it
and its directory must belong to the effective user and be writable by no one else.
Methods that must not be blocked by a broken table check only the path's shape.

Co-Authored-By: <实施席自己的模型> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR
MSG
```

#### 1c 物化、哈希与版本核对

- [ ] **Step 1.17 写失败判据** `tests/agents/materialize.test.ts`（判据 2：同表同选择同哈希、改该条任一字段哈希变、**改另一条不变**；判据 5c 的库级部分：版本漂移）：

```ts
import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentConfigHash, parseMaterializedAgentConfig, probeVersion, resolveAgent } from "../../src/agents/materialize.js";
import type { AgentsTableV1, PartialSelectionV1 } from "../../src/agents/types.js";
import { canonicalHash } from "../../src/control/protocol.js";

async function script(body: string): Promise<string[]> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "ccloop-agents-version-")));
  const path = join(dir, "cli.mjs");
  await writeFile(path, body, { mode: 0o600 });
  return [process.execPath, path];
}

const table: AgentsTableV1 = {
  schema: "ccloop-agents-table-v1",
  installations: {
    claude: { kind: "claude", command: ["/opt/claude"], version: "2.1.282", configDir: null, timeoutMs: 1_800_000, killGraceMs: 5_000 },
    codex: { kind: "codex", command: ["/opt/codex"], version: "0.155.1", configDir: null, timeoutMs: 900_000, killGraceMs: 2_000, sandbox: "workspace-write", budgetMode: "soft" },
  },
};
const versions: Record<string, string> = { "/opt/claude": "2.1.282", "/opt/codex": "0.155.1" };
const probe = async (command: string[]) => versions[command[0]!] ?? null;

describe("probing an installed CLI's version", () => {
  it("answers the x.y.z the real CLIs print (claude 2.1.282, codex-cli 0.155.1 as measured on this machine)", async () => {
    expect(await probeVersion(await script('console.log("2.1.282 (Claude Code)")'))).toBe("2.1.282");
    expect(await probeVersion(await script('console.log("codex-cli 0.155.1")'))).toBe("0.155.1");
    expect(await probeVersion(await script('console.log("tool 1.0.0-beta.2 build")'))).toBe("1.0.0-beta.2");
  });

  it("passes the command's own arguments before --version", async () => {
    expect(await probeVersion([...(await script('console.log(process.argv.slice(2).join(" ") === "script m --version" ? "3.4.5" : "0.0.0")')), "script", "m"])).toBe("3.4.5");
  });

  it("answers null, not a guess, when the CLI fails, prints no version, is missing, or hangs", async () => {
    expect(await probeVersion(await script('console.log("2.1.282"); process.exitCode = 1'))).toBeNull();
    expect(await probeVersion(await script('console.log("no version here")'))).toBeNull();
    expect(await probeVersion(["/nonexistent/ccloop-agent-cli"])).toBeNull();
    expect(await probeVersion(await script("setInterval(() => {}, 1000)"), { timeoutMs: 200 })).toBeNull();
    expect(await probeVersion(await script('process.stdout.write("1.2.3 ".repeat(20000))'))).toBeNull();
  });
});

describe("resolving a selection against the table", () => {
  it("fills unset fields from the descriptor and echoes the fields the request gave verbatim", async () => {
    const { resolution, config } = await resolveAgent(table, { agent: "claude", model: "opus" }, { probeVersion: probe });
    expect(resolution.selection).toEqual({ agent: "claude", model: "opus", contextWindow: "agent-default" });
    expect(config).toEqual({ schema: "ccloop-agent-config-v1", kind: "claude", installation: table.installations.claude, selection: resolution.selection });
    expect(resolution.configHash).toBe(canonicalHash(config));
    expect((await resolveAgent(table, { agent: "codex" }, { probeVersion: probe })).resolution).toMatchObject({
      selection: { agent: "codex", model: "gpt-6-sol", contextWindow: "agent-default" },
      timeoutMs: 900_000,
      killGraceMs: 2_000,
      capabilities: { contextWindowTokens: null, budgetEnforcement: "soft" },
    });
  });

  it("reports the 1M window as a capability only when it was selected", async () => {
    const { resolution } = await resolveAgent(table, { agent: "claude", contextWindow: 1_000_000 }, { probeVersion: probe });
    expect(resolution.capabilities.contextWindowTokens).toBe(1_000_000);
  });

  it("names each refusal", async () => {
    await expect(resolveAgent(table, {}, { probeVersion: probe })).rejects.toMatchObject({ code: "agent-unselected" });
    await expect(resolveAgent(table, { agent: "gemini" }, { probeVersion: probe })).rejects.toMatchObject({ code: "agent-installation-missing" });
    // An inherited property is not an installation: the refusal names the requested id, not a missing kind.
    await expect(resolveAgent(table, { agent: "toString" }, { probeVersion: probe })).rejects.toMatchObject({ code: "agent-installation-missing", detail: "toString" });
    await expect(resolveAgent(table, { agent: "codex", contextWindow: 1_000_000 }, { probeVersion: probe })).rejects.toMatchObject({ code: "agent-context-unsupported" });
    await expect(resolveAgent(table, { agent: "claude", model: "-p" }, { probeVersion: probe })).rejects.toMatchObject({ code: "agent-selection-invalid" });
  });

  // Spec §12 C6: an in-place upgrade changes neither the table nor the hash; only the probe can see it.
  it("refuses an installation whose CLI no longer reports the table's version", async () => {
    await expect(resolveAgent(table, { agent: "claude" }, { probeVersion: async () => "2.1.283" })).rejects.toMatchObject({ code: "agent-version-drift" });
    await expect(resolveAgent(table, { agent: "claude" }, { probeVersion: async () => null })).rejects.toMatchObject({ code: "agent-version-drift" });
  });

  it("probes the real CLI when no probe is injected", async () => {
    const command = await script('console.log("7.8.9 (Fake)")');
    const real: AgentsTableV1 = { schema: "ccloop-agents-table-v1", installations: { claude: { ...table.installations.claude!, command: command as [string, ...string[]], version: "7.8.9" } } };
    expect((await resolveAgent(real, { agent: "claude" })).resolution.selection.agent).toBe("claude");
    const drifted: AgentsTableV1 = { schema: "ccloop-agents-table-v1", installations: { claude: { ...real.installations.claude!, version: "7.8.8" } } };
    await expect(resolveAgent(drifted, { agent: "claude" })).rejects.toMatchObject({ code: "agent-version-drift" });
  });
});

// Spec §9 criterion 2 (§12 I13): the hash covers exactly one installation record plus the selection.
describe("materialized config hash", () => {
  const hashOf = async (source: AgentsTableV1, partial: PartialSelectionV1 = { agent: "claude" }) =>
    (await resolveAgent(source, partial, { probeVersion: async (command) => (command[0] === "/opt/claude2" ? "2.1.282" : probe(command)) })).resolution.configHash;

  it("is stable for the same table and selection", async () => {
    expect(await hashOf(table)).toBe(await hashOf(structuredClone(table)));
  });

  it("changes with every field of the selected record and of the selection", async () => {
    const base = await hashOf(table);
    const claude = table.installations.claude!;
    for (const changed of [
      { ...claude, command: ["/opt/claude2"] as [string, ...string[]] },
      { ...claude, configDir: "/Users/me/.claude-work" },
      { ...claude, timeoutMs: 1_800_001 },
      { ...claude, killGraceMs: 5_001 },
    ]) {
      expect(await hashOf({ ...table, installations: { ...table.installations, claude: changed } })).not.toBe(base);
    }
    expect(await hashOf(table, { agent: "claude", model: "opus" })).not.toBe(base);
    expect(await hashOf(table, { agent: "claude", contextWindow: 1_000_000 })).not.toBe(base);
  });

  it("does not change when another installation record changes", async () => {
    const base = await hashOf(table);
    const codex = { ...table.installations.codex!, timeoutMs: 1 };
    expect(await hashOf({ ...table, installations: { ...table.installations, codex } })).toBe(base);
    const { claude } = table.installations;
    expect(await hashOf({ ...table, installations: { claude: claude! } })).toBe(base);
  });

  it("is the canonical hash of the materialized config", async () => {
    const { config, resolution } = await resolveAgent(table, { agent: "codex" }, { probeVersion: probe });
    expect(agentConfigHash(config)).toBe(resolution.configHash);
  });
});

describe("reading back a materialized config", () => {
  it("round-trips what resolution materialized", async () => {
    const { config } = await resolveAgent(table, { agent: "codex", model: "gpt-6-luna" }, { probeVersion: probe });
    expect(parseMaterializedAgentConfig(JSON.parse(JSON.stringify(config)))).toEqual(config);
  });

  it("refuses a kind that differs from the installation, a bad selection and extra keys", async () => {
    const { config } = await resolveAgent(table, { agent: "claude" }, { probeVersion: probe });
    expect(() => parseMaterializedAgentConfig({ ...config, kind: "codex" })).toThrow(expect.objectContaining({ code: "agent-config-invalid" }));
    expect(() => parseMaterializedAgentConfig({ ...config, selection: { ...config.selection, contextWindow: 5 } })).toThrow(expect.objectContaining({ code: "agent-context-unsupported" }));
    expect(() => parseMaterializedAgentConfig({ ...config, extra: 1 })).toThrow(expect.objectContaining({ code: "agent-config-invalid" }));
    expect(() => parseMaterializedAgentConfig({ ...config, installation: { ...config.installation, env: {} } })).toThrow(expect.objectContaining({ code: "agents-table-invalid" }));
  });
});
```

- [ ] **Step 1.18 跑红**：

```sh
cd $C && ./node_modules/.bin/vitest run tests/agents/materialize.test.ts > $S/t1c-red.log 2>&1; echo rc=$?
```

Expected：`rc=1`，`Failed to load url ../../src/agents/materialize.js`。

- [ ] **Step 1.19 新建** `src/agents/materialize.ts`：

```ts
import { spawn } from "node:child_process";
import { z } from "zod";
import { canonicalHash } from "../control/protocol.js";
import { getDescriptor } from "./registry.js";
import { parseInstallation } from "./table.js";
import {
  AgentError,
  agentSelectionSchema,
  type AgentResolutionV1,
  type AgentsTableV1,
  type MaterializedAgentConfigV1,
  type PartialSelectionV1,
} from "./types.js";

const VERSION_PATTERN = /\d+\.\d+\.\d+(?:-[\w.]+)?/;
const VERSION_OUTPUT_LIMIT = 64 * 1024;
const VERSION_TIMEOUT_MS = 10_000;

/**
 * Runs `<command> --version` once (spec §4.2 / §12 C6) and answers the first `x.y.z[-tag]` in its stdout, or
 * null when it cannot be run, exits non-zero, prints no version, prints too much, or outlives the timeout.
 */
export function probeVersion(command: string[], options: { timeoutMs?: number } = {}): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    let output = "";
    const child = spawn(command[0]!, [...command.slice(1), "--version"], { stdio: ["ignore", "pipe", "ignore"], env: process.env });
    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(null);
    }, options.timeoutMs ?? VERSION_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > VERSION_OUTPUT_LIMIT) {
        child.kill("SIGKILL");
        finish(null);
      }
    });
    child.on("error", () => finish(null));
    child.on("close", (code) => finish(code === 0 ? (VERSION_PATTERN.exec(output)?.[0] ?? null) : null));
  });
}

export function agentConfigHash(config: MaterializedAgentConfigV1): string {
  return canonicalHash(config);
}

/**
 * Fills the partial selection from the installation's descriptor defaults, validates it, materializes the
 * config and checks the installed version (spec §4.6). Fields the partial carries are echoed verbatim (M5).
 */
export async function resolveAgent(
  table: AgentsTableV1,
  partial: PartialSelectionV1,
  deps: { probeVersion?: (command: string[]) => Promise<string | null> } = {},
): Promise<{ config: MaterializedAgentConfigV1; resolution: AgentResolutionV1 }> {
  if (partial.agent === undefined) throw new AgentError("agent-unselected");
  const installation = Object.hasOwn(table.installations, partial.agent) ? table.installations[partial.agent] : undefined;
  if (installation === undefined) throw new AgentError("agent-installation-missing", partial.agent);
  const descriptor = getDescriptor(installation.kind);
  const selection = {
    agent: partial.agent,
    model: partial.model ?? descriptor.defaults.model,
    contextWindow: partial.contextWindow ?? descriptor.defaults.contextWindow,
  };
  descriptor.validateSelection(selection);
  const config: MaterializedAgentConfigV1 = { schema: "ccloop-agent-config-v1", kind: installation.kind, installation, selection };
  const observed = await (deps.probeVersion ?? probeVersion)(installation.command);
  if (observed !== installation.version) {
    throw new AgentError("agent-version-drift", `${partial.agent}: table ${installation.version}, observed ${observed ?? "none"}`);
  }
  return {
    config,
    resolution: {
      selection,
      configHash: agentConfigHash(config),
      timeoutMs: installation.timeoutMs,
      killGraceMs: installation.killGraceMs,
      capabilities: descriptor.capabilities(config),
    },
  };
}

const materializedShape = z
  .object({ schema: z.literal("ccloop-agent-config-v1"), kind: z.string(), installation: z.unknown(), selection: agentSelectionSchema })
  .strict();

/** Reads back a config.json written at accept; the same checks as resolution, minus the version probe. */
export function parseMaterializedAgentConfig(raw: unknown): MaterializedAgentConfigV1 {
  const parsed = materializedShape.safeParse(raw);
  if (!parsed.success) throw new AgentError("agent-config-invalid", parsed.error.message);
  const installation = parseInstallation(parsed.data.installation);
  if (installation.kind !== parsed.data.kind) throw new AgentError("agent-config-invalid", "kind differs from the installation's kind");
  getDescriptor(installation.kind).validateSelection(parsed.data.selection);
  return { schema: "ccloop-agent-config-v1", kind: installation.kind, installation, selection: parsed.data.selection };
}
```

- [ ] **Step 1.20 跑绿**：

```sh
cd $C && ./node_modules/.bin/vitest run tests/agents tests/runtime/codex/extraEnv.test.ts > $S/t1c-green.log 2>&1; echo rc=$?
./node_modules/.bin/tsc --noEmit -p tsconfig.json > $S/t1c-tsc.log 2>&1; echo tsc=$?
```

Expected：`rc=0`（registry 17、table 28、materialize 14、extraEnv 2）；`tsc=0`。

- [ ] **Step 1.21 提交**（1c）：

```sh
cd $C && /usr/bin/git add src/agents/materialize.ts tests/agents/materialize.test.ts
/usr/bin/git commit -F - <<'MSG'
feat(agents): materialize a selection, hash it and probe the installed version

Agent selection (2026-09-26) spec §4.2, §4.6, §12 C6/I13: a partial selection is
filled from the descriptor, validated and materialized; its canonical hash covers one
installation record plus the selection; `<command> --version` must still report the
table's version, else agent-version-drift.

Co-Authored-By: <实施席自己的模型> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR
MSG
```

- [ ] **Step 1.22 变异（每个新分支一条，全部要看见红）**。在副本里做，副本建在 T1 三笔提交之后：

```sh
/usr/bin/git clone --local -q $C $S/t1-mut && ln -s $C/node_modules $S/t1-mut/node_modules
cat > $S/mutate.py <<'PY'
# Usage: python3 mutate.py <clone> <spec.json> <out-dir>
# Applies each mutation alone, runs its tests with the full log saved, restores the file, and proves the restore.
import json, os, subprocess, sys
repo, spec, out = sys.argv[1], json.load(open(sys.argv[2])), sys.argv[3]
os.makedirs(out, exist_ok=True)
summary = open(os.path.join(out, "summary.txt"), "w")
for index, m in enumerate(spec, 1):
    path = os.path.join(repo, m["file"]); original = open(path).read()
    if original.count(m["old"]) != 1:
        summary.write(f"{m['name']}: ANCHOR-COUNT {original.count(m['old'])}\n"); continue
    open(path, "w").write(original.replace(m["old"], m["new"]))
    try:
        log = os.path.join(out, f"{index:02d}.log")
        with open(log, "w") as handle:
            code = subprocess.run([os.path.join(repo, "node_modules/.bin/vitest"), "run", *m["tests"]], cwd=repo, stdout=handle, stderr=subprocess.STDOUT, timeout=600).returncode
        summary.write(f"{m['name']}: rc={code} {'RED' if code else 'GREEN(!)'} log={log}\n")
    finally:
        open(path, "w").write(original)
    summary.flush()
diff = subprocess.run(["/usr/bin/git", "diff", "--stat"], cwd=repo, capture_output=True, text=True).stdout
summary.write(f"restore check (git diff --stat, expect empty): {diff!r}\n")
PY
cat > $S/t1-mut.json <<'JSON'
[
 {
  "name": "M1 model may start with -",
  "file": "src/agents/types.ts",
  "old": " || model.startsWith(\"-\")",
  "new": "",
  "tests": [
   "tests/agents/registry.test.ts"
  ]
 },
 {
  "name": "M2 model may carry whitespace/control",
  "file": "src/agents/types.ts",
  "old": " || /[\\s\\p{Cc}]/u.test(model)",
  "new": "",
  "tests": [
   "tests/agents/registry.test.ts"
  ]
 },
 {
  "name": "M3 model length unbounded",
  "file": "src/agents/types.ts",
  "old": " || model.length > MODEL_MAX_LENGTH",
  "new": "",
  "tests": [
   "tests/agents/registry.test.ts"
  ]
 },
 {
  "name": "M3b empty model allowed",
  "file": "src/agents/types.ts",
  "old": "model.length === 0 || ",
  "new": "",
  "tests": [
   "tests/agents/registry.test.ts"
  ]
 },
 {
  "name": "M4 context option unchecked",
  "file": "src/agents/types.ts",
  "old": "if (!options.includes(selection.contextWindow)) {",
  "new": "if (false) {",
  "tests": [
   "tests/agents/registry.test.ts"
  ]
 },
 {
  "name": "M5 claude reports requested window always",
  "file": "src/agents/claude.ts",
  "old": "contextWindowTokens: config.selection.contextWindow === ONE_MILLION ? ONE_MILLION : null,",
  "new": "contextWindowTokens: ONE_MILLION,",
  "tests": [
   "tests/agents/registry.test.ts"
  ]
 },
 {
  "name": "M6 claude 1M never reported",
  "file": "src/agents/claude.ts",
  "old": "contextWindowTokens: config.selection.contextWindow === ONE_MILLION ? ONE_MILLION : null,",
  "new": "contextWindowTokens: null,",
  "tests": [
   "tests/agents/registry.test.ts",
   "tests/agents/materialize.test.ts"
  ]
 },
 {
  "name": "M7 [1m] suffix dropped",
  "file": "src/agents/claude.ts",
  "old": "? `${selection.model}[1m]` :",
  "new": "? selection.model :",
  "tests": [
   "tests/agents/registry.test.ts"
  ]
 },
 {
  "name": "M8 codex configDir not passed",
  "file": "src/agents/codex.ts",
  "old": "configDir === null ? undefined : { CODEX_HOME: configDir }",
  "new": "undefined",
  "tests": [
   "tests/runtime/codex/extraEnv.test.ts"
  ]
 },
 {
  "name": "M9 extraEnv not spread",
  "file": "src/runtime/codex/runCodexPhase.ts",
  "old": "env:{...process.env,...extraEnv}",
  "new": "env:process.env",
  "tests": [
   "tests/runtime/codex/extraEnv.test.ts"
  ]
 },
 {
  "name": "M10 adapter drops extraEnv",
  "file": "src/runtime/codex/codexAdapter.ts",
  "old": "{ phase, prompt, context }, this.extraEnv);",
  "new": "{ phase, prompt, context });",
  "tests": [
   "tests/runtime/codex/extraEnv.test.ts"
  ]
 },
 {
  "name": "M11 installation not strict",
  "file": "src/agents/table.ts",
  "old": "z.object({ ...commonInstallation, ...extras }).strict()",
  "new": "z.object({ ...commonInstallation, ...extras })",
  "tests": [
   "tests/agents/table.test.ts"
  ]
 },
 {
  "name": "M12 installation id unchecked",
  "file": "src/agents/table.ts",
  "old": "if (!idSchema.safeParse(id).success) throw invalid(`installation id ${JSON.stringify(id)}`);",
  "new": "",
  "tests": [
   "tests/agents/table.test.ts"
  ]
 },
 {
  "name": "M13 no O_NOFOLLOW",
  "file": "src/agents/table.ts",
  "old": "constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK",
  "new": "constants.O_RDONLY | constants.O_NONBLOCK",
  "tests": [
   "tests/agents/table.test.ts"
  ]
 },
 {
  "name": "M14 non-regular file allowed",
  "file": "src/agents/table.ts",
  "old": "if (!metadata.isFile()) throw invalid(\"table is not a regular file\");",
  "new": "",
  "tests": [
   "tests/agents/table.test.ts"
  ]
 },
 {
  "name": "M15 file mode/owner unchecked",
  "file": "src/agents/table.ts",
  "old": "    assertPrivate(metadata, euid, \"table\");\n",
  "new": "",
  "tests": [
   "tests/agents/table.test.ts"
  ]
 },
 {
  "name": "M16 parent unchecked",
  "file": "src/agents/table.ts",
  "old": "    assertPrivate(parent, euid, \"table directory\");\n",
  "new": "",
  "tests": [
   "tests/agents/table.test.ts"
  ]
 },
 {
  "name": "M17 owner check dropped",
  "file": "src/agents/table.ts",
  "old": "  if (metadata.uid !== euid) throw invalid(`${what} is not owned by the effective user`);\n",
  "new": "",
  "tests": [
   "tests/agents/table.test.ts"
  ]
 },
 {
  "name": "M18 writability check dropped",
  "file": "src/agents/table.ts",
  "old": "  if ((metadata.mode & 0o022) !== 0) throw invalid(`${what} is group- or world-writable`);\n",
  "new": "",
  "tests": [
   "tests/agents/table.test.ts"
  ]
 },
 {
  "name": "M19 realpath check dropped",
  "file": "src/agents/table.ts",
  "old": "    if ((await realpath(path)) !== path) throw invalid(\"table path is not its own realpath\");\n",
  "new": "",
  "tests": [
   "tests/agents/table.test.ts"
  ]
 },
 {
  "name": "M20 shape check: symlink allowed",
  "file": "src/agents/table.ts",
  "old": "if (canonical !== path || !metadata.isFile()) throw invalid(\"table path is not a canonical regular file\");",
  "new": "if (!metadata.isFile()) throw invalid(\"table path is not a canonical regular file\");",
  "tests": [
   "tests/agents/table.test.ts"
  ]
 },
 {
  "name": "M21 shape check: directory allowed",
  "file": "src/agents/table.ts",
  "old": "if (canonical !== path || !metadata.isFile()) throw invalid(\"table path is not a canonical regular file\");",
  "new": "if (canonical !== path) throw invalid(\"table path is not a canonical regular file\");",
  "tests": [
   "tests/agents/table.test.ts"
  ]
 },
 {
  "name": "M22 probe ignores exit code",
  "file": "src/agents/materialize.ts",
  "old": "finish(code === 0 ? (VERSION_PATTERN.exec(output)?.[0] ?? null) : null)",
  "new": "finish(VERSION_PATTERN.exec(output)?.[0] ?? null)",
  "tests": [
   "tests/agents/materialize.test.ts"
  ]
 },
 {
  "name": "M23 probe output unbounded",
  "file": "src/agents/materialize.ts",
  "old": "      if (output.length > VERSION_OUTPUT_LIMIT) {\n        child.kill(\"SIGKILL\");\n        finish(null);\n      }\n",
  "new": "",
  "tests": [
   "tests/agents/materialize.test.ts"
  ]
 },
 {
  "name": "M24 probe never times out",
  "file": "src/agents/materialize.ts",
  "old": "    const timer = setTimeout(() => {\n      child.kill(\"SIGKILL\");\n      finish(null);\n    }, options.timeoutMs ?? VERSION_TIMEOUT_MS);",
  "new": "    const timer = undefined;",
  "tests": [
   "tests/agents/materialize.test.ts"
  ]
 },
 {
  "name": "M25 probe omits own args",
  "file": "src/agents/materialize.ts",
  "old": "[...command.slice(1), \"--version\"]",
  "new": "[\"--version\"]",
  "tests": [
   "tests/agents/materialize.test.ts"
  ]
 },
 {
  "name": "M26 no version drift check",
  "file": "src/agents/materialize.ts",
  "old": "if (observed !== installation.version) {",
  "new": "if (false) {",
  "tests": [
   "tests/agents/materialize.test.ts"
  ]
 },
 {
  "name": "M27 inherited property as installation",
  "file": "src/agents/materialize.ts",
  "old": "Object.hasOwn(table.installations, partial.agent) ? table.installations[partial.agent] : undefined",
  "new": "table.installations[partial.agent]",
  "tests": [
   "tests/agents/materialize.test.ts"
  ]
 },
 {
  "name": "M28 selection not validated",
  "file": "src/agents/materialize.ts",
  "old": "  descriptor.validateSelection(selection);\n  const config",
  "new": "  const config",
  "tests": [
   "tests/agents/materialize.test.ts"
  ]
 },
 {
  "name": "M29 defaults not filled (model)",
  "file": "src/agents/materialize.ts",
  "old": "model: partial.model ?? descriptor.defaults.model,",
  "new": "model: partial.model ?? \"claude-opus-5-5\",",
  "tests": [
   "tests/agents/materialize.test.ts"
  ]
 },
 {
  "name": "M30 hash over whole table",
  "file": "src/agents/materialize.ts",
  "old": "configHash: agentConfigHash(config),",
  "new": "configHash: canonicalHash({ config, table }),",
  "tests": [
   "tests/agents/materialize.test.ts"
  ]
 },
 {
  "name": "M31 readback kind mismatch allowed",
  "file": "src/agents/materialize.ts",
  "old": "  if (installation.kind !== parsed.data.kind) throw new AgentError(\"agent-config-invalid\", \"kind differs from the installation's kind\");\n",
  "new": "",
  "tests": [
   "tests/agents/materialize.test.ts"
  ]
 },
 {
  "name": "M32 unselected falls to missing",
  "file": "src/agents/materialize.ts",
  "old": "  if (partial.agent === undefined) throw new AgentError(\"agent-unselected\");\n",
  "new": "",
  "tests": [
   "tests/agents/materialize.test.ts"
  ]
 },
 {
  "name": "M33 message is the bare code",
  "file": "src/agents/types.ts",
  "old": "super(detail === undefined ? code : `${code}: ${detail}`);",
  "new": "super(code);",
  "tests": [
   "tests/agents/registry.test.ts"
  ]
 },
 {
  "name": "M34 message is the detail only",
  "file": "src/agents/types.ts",
  "old": "super(detail === undefined ? code : `${code}: ${detail}`);",
  "new": "super(detail ?? code);",
  "tests": [
   "tests/agents/registry.test.ts"
  ]
 }
]
JSON
python3 $S/mutate.py $S/t1-mut $S/t1-mut.json $S/t1-mut-logs; echo rc=$?
```

Expected：`$S/t1-mut-logs/summary.txt` 里 35 条**全部** `RED`，最后一行 `restore check (git diff --stat, expect empty): ''`（副本是已提交状态，还原后应无差异；另核 `git diff --cached` 字节数为 0）。写作席以终版代码与判据整批复跑：`scratchpad/W1/final-t1-mut-final/summary.txt`（M1–M32，33 条）＋ `final-r1/summary.txt`（M33、M34）全部 RED（写作席的副本是未提交的开发树，所以那里的 restore check 打印的是功能改动本身的 stat，与跑变异前逐字相同）。每条的完整日志在 `$S/t1-mut-logs/NN.log`，整份读回后逐条抄进台账 `mutations.md`（名字、被删的分支、红在哪条判据）。

  注（写作席首轮看到的两条 GREEN 与处置，已并入上面的判据，实施席不必重演）：
  - M19「删掉 realpath 核对」首轮绿：经符号链接目录到达的表，会先被「父目录 `lstat` 不是目录」拒掉 ⇒ 判据改为断言 `detail: "table path is not its own realpath"`。
  - M20「形状核对放过软链」首轮绿：末级软链先被 `lstat().isFile()` 拒掉 ⇒ 补一条「经符号链接目录到达」的判据，只有 realpath 核对抓得到。
  - `O_NOFOLLOW`（M13）与「非普通文件」（M14）若只断言码不可观测（后面的核对也会拒）⇒ 判据断言 `detail`（`ELOOP`／`table is not a regular file`）。

---

### Task 2: `ccloop agents detect|validate`（ccloop）

**Files**

- Create: `src/agents/detect.ts`、`src/agents/command.ts`
- Modify: `src/cli.ts:4`（import）、`:277` 之前（分派 `agents`）
- Test（新）：`tests/agents/detect.test.ts`、`tests/agents/command.test.ts`

**Interfaces**

- Consumes：`listDescriptors`、`AgentDescriptor.{binary, searchDirs, draftInstallationExtras}`、`probeVersion`、`readAgentsTable`、`AgentError`（T1）。
- Produces：`detectAgents`、`DetectResultV1`、`CandidateV1`（骨架名）；`runAgentsCommand(argv, deps?) → {code, stdout, stderr}`（W1-8）；CLI `ccloop agents detect [--home <dir>] [--path <PATH>]`（stdout 一行 `DetectResultV1` JSON，RC 0）、`ccloop agents validate <table>`（stdout 一行 `{"installations":[{id, ok, error?}]}`，RC 0 ⇔ 全部 ok；表不可读 ⇒ stdout 空、stderr 一行 `agents-table-invalid: <detail>`、RC 1）；参数错 ⇒ stderr `agents-command-invalid`、RC 1。stderr 一律是 `AgentError.message` 原文（裁定 2）。

- [ ] **Step 2.1 写失败判据** `tests/agents/detect.test.ts`（spec §9 判据 1：候选顺序、realpath 去重、`isPathDefault`、不可运行记 `runnable:false`；§12 I14：相对 PATH、他人可写目录、不可执行文件）：

```ts
import { chmod, mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectAgents, type CandidateV1 } from "../../src/agents/detect.js";

async function root(): Promise<string> {
  return await realpath(await mkdtemp(join(tmpdir(), "ccloop-agents-detect-")));
}

async function cli(dir: string, name: string, version: string | null, mode = 0o700): Promise<string> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, name);
  await writeFile(path, version === null ? "#!/bin/sh\nexit 3\n" : `#!/bin/sh\necho "${version} (fake)"\n`, { mode });
  await chmod(path, mode);
  return path;
}

// The unit criteria inject the probe, so no real CLI on this machine is ever executed; they keep only candidates
// under the fake root, because /usr/local/bin (and /opt/homebrew/bin on darwin) cannot be redirected.
function under(prefix: string, list: CandidateV1[] | undefined): CandidateV1[] {
  return (list ?? []).filter((candidate) => candidate.path.startsWith(prefix));
}

const versions = new Map<string, string>();
const probe = async (command: string[]) => versions.get(command[0]!) ?? null;

describe("detecting installed agents (spec §9 criterion 1)", () => {
  it("lists search directories before PATH, deduplicates by realpath and drafts the PATH default", async () => {
    const r = await root();
    const home = join(r, "home");
    const local = await cli(join(home, ".local", "bin"), "claude", "2.1.282");
    const volta = await cli(join(home, ".volta", "bin"), "claude", "2.1.200");
    const pathA = join(r, "pathA");
    await mkdir(pathA, { mode: 0o700 });
    await symlink(volta, join(pathA, "claude"));
    const pathB = await cli(join(r, "pathB"), "claude", "2.0.0");
    for (const [path, version] of [[local, "2.1.282"], [volta, "2.1.200"], [join(pathA, "claude"), "2.1.200"], [pathB, "2.0.0"]] as const) versions.set(path, version);

    const result = await detectAgents({ home, path: [pathA, join(r, "pathB")].join(delimiter), platform: "linux", probe });
    expect(under(r, result.candidates.claude)).toEqual([
      { path: local, realpath: local, version: "2.1.282", runnable: true, source: "search-dir", isPathDefault: false },
      { path: volta, realpath: volta, version: "2.1.200", runnable: true, source: "search-dir", isPathDefault: true },
      { path: pathB, realpath: pathB, version: "2.0.0", runnable: true, source: "path", isPathDefault: false },
    ]);
    // The draft takes what PATH would run, not the first candidate listed.
    expect(result.table.installations.claude).toEqual({
      kind: "claude", command: [volta], version: "2.1.200", configDir: null, timeoutMs: 1_800_000, killGraceMs: 5_000,
    });
  });

  it("records a candidate whose --version fails as not runnable and drafts the first runnable one instead", async () => {
    const r = await root();
    const home = join(r, "home");
    const broken = await cli(join(r, "path"), "codex", null);
    const working = await cli(join(home, ".local", "bin"), "codex", "0.155.1");
    versions.set(working, "0.155.1");
    const result = await detectAgents({ home, path: join(r, "path"), platform: "linux", probe });
    expect(under(r, result.candidates.codex)).toEqual([
      { path: working, realpath: working, version: "0.155.1", runnable: true, source: "search-dir", isPathDefault: false },
      { path: broken, realpath: broken, version: null, runnable: false, source: "path", isPathDefault: true, error: "version-probe-failed" },
    ]);
    expect(result.table.installations.codex).toEqual({
      kind: "codex", command: [working], version: "0.155.1", configDir: null, timeoutMs: 1_800_000, killGraceMs: 5_000,
      sandbox: "workspace-write", budgetMode: "soft",
    });
  });

  // Spec §12 I14: a relative PATH entry resolves against whatever the cwd is; a world-writable directory lets anyone plant a binary.
  it("never searches relative PATH entries, world-writable directories or non-executable files", async () => {
    const r = await root();
    const open = await cli(join(r, "open"), "claude", "9.9.9");
    await chmod(join(r, "open"), 0o777);
    const plain = await cli(join(r, "plain"), "claude", "9.9.8", 0o600);
    versions.set(open, "9.9.9");
    versions.set(plain, "9.9.8");
    const relative = await cli(join(r, "rel", "bin"), "claude", "9.9.7");
    versions.set("rel/bin/claude", "9.9.7");
    versions.set(relative, "9.9.7");
    const cwd = process.cwd();
    process.chdir(r);
    try {
      const result = await detectAgents({ home: join(r, "home"), path: ["rel/bin", join(r, "open"), join(r, "plain")].join(delimiter), platform: "linux", probe });
      expect(result.candidates.claude!.filter((candidate) => candidate.path.startsWith(r) || candidate.path.startsWith("rel"))).toEqual([]);
    } finally {
      process.chdir(cwd);
    }
  });

  it("drafts nothing for a kind whose only candidates are not runnable", async () => {
    const r = await root();
    const broken = await cli(join(r, "path"), "codex", null);
    const result = await detectAgents({ home: join(r, "home"), path: join(r, "path"), platform: "linux", probe });
    expect(under(r, result.candidates.codex)).toMatchObject([{ path: broken, runnable: false }]);
    expect(result.table.installations.codex).toBeUndefined();
  });

  it("leaves a kind with no candidate out of the draft and lists it with no candidates", async () => {
    const r = await root();
    const result = await detectAgents({ home: join(r, "home"), path: join(r, "none"), platform: "linux", probe: async () => null });
    expect(result.schema).toBe("ccloop-agents-detect-v1");
    expect(Object.keys(result.candidates)).toEqual(["claude", "codex"]);
    expect(result.candidates.codex!.every((candidate) => !candidate.runnable)).toBe(true);
    expect(result.table.installations).toEqual({});
  });

  it("runs the real --version probe when none is injected", async () => {
    const r = await root();
    const path = await cli(join(r, "bin"), "claude", "2.1.282");
    const result = await detectAgents({ home: join(r, "home"), path: join(r, "bin"), platform: "linux" });
    expect(under(r, result.candidates.claude)).toEqual([
      { path, realpath: path, version: "2.1.282", runnable: true, source: "path", isPathDefault: true },
    ]);
  });
});
```

- [ ] **Step 2.2 写失败判据** `tests/agents/command.test.ts`：

```ts
import { chmod, mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runAgentsCommand } from "../../src/agents/command.js";
import { main } from "../../src/cli.js";

async function root(): Promise<string> {
  return await realpath(await mkdtemp(join(tmpdir(), "ccloop-agents-command-")));
}

async function cli(dir: string, version: string): Promise<string> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, "claude");
  await writeFile(path, `#!/bin/sh\necho "${version} (fake)"\n`, { mode: 0o700 });
  return path;
}

async function tableWith(r: string, installations: Record<string, unknown>): Promise<string> {
  const path = join(r, "agents.json");
  await writeFile(path, JSON.stringify({ schema: "ccloop-agents-table-v1", installations }), { mode: 0o600 });
  await chmod(path, 0o600);
  return path;
}

const record = (command: string, version: string) => ({ kind: "claude", command: [command], version, configDir: null, timeoutMs: 1000, killGraceMs: 50 });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ccloop agents validate", () => {
  it("answers ok per installation and exits 0 only when every recorded version is what the CLI reports", async () => {
    const r = await root();
    const current = await cli(join(r, "a"), "2.1.282");
    const upgraded = await cli(join(r, "b"), "2.1.283");
    const good = await runAgentsCommand(["validate", await tableWith(r, { claude: record(current, "2.1.282") })]);
    expect(good).toEqual({ code: 0, stdout: `${JSON.stringify({ installations: [{ id: "claude", ok: true }] })}\n`, stderr: "" });
    const drifted = await runAgentsCommand(["validate", await tableWith(r, { claude: record(current, "2.1.282"), work: record(upgraded, "2.1.282") })]);
    expect(drifted.code).toBe(1);
    expect(JSON.parse(drifted.stdout)).toEqual({ installations: [{ id: "claude", ok: true }, { id: "work", ok: false, error: "agent-version-drift" }] });
  });

  it("names an unreadable table and prints nothing on stdout", async () => {
    const r = await root();
    const path = await tableWith(r, {});
    await chmod(path, 0o660);
    const result = await runAgentsCommand(["validate", path]);
    expect(result).toMatchObject({ code: 1, stdout: "" });
    expect(result.stderr).toBe("agents-table-invalid: table is group- or world-writable\n");
  });
});

describe("ccloop agents detect", () => {
  it("prints the detect result for the given home and PATH", async () => {
    const r = await root();
    const inHome = await cli(join(r, "home", ".local", "bin"), "2.1.282");
    const path = await cli(join(r, "bin"), "2.1.282");
    // The probe is injected so no real CLI on this machine runs; only the fake one answers a version.
    const result = await runAgentsCommand(["detect", "--home", join(r, "home"), "--path", join(r, "bin")], {
      probe: async (command) => (command[0] === path || command[0] === inHome ? "2.1.282" : null),
    });
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.schema).toBe("ccloop-agents-detect-v1");
    expect(parsed.candidates.claude).toContainEqual({ path: inHome, realpath: inHome, version: "2.1.282", runnable: true, source: "search-dir", isPathDefault: false });
    expect(parsed.candidates.claude).toContainEqual({ path, realpath: path, version: "2.1.282", runnable: true, source: "path", isPathDefault: true });
    expect(parsed.table.installations.claude).toMatchObject({ command: [path], version: "2.1.282" });
  });

  it.each([[["detect", "--home"]], [["detect", "--shell", "zsh"]], [["validate"]], [["validate", "a", "b"]], [["list"]], [[]]])(
    "refuses %j as agents-command-invalid",
    async (argv) => {
      expect(await runAgentsCommand(argv)).toEqual({ code: 1, stdout: "", stderr: "agents-command-invalid\n" });
    },
  );
});

describe("the ccloop CLI entry", () => {
  it("routes `agents` to the agents command before run/resume flag parsing", async () => {
    const r = await root();
    const path = await cli(join(r, "bin"), "2.1.282");
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    expect(await main(["agents", "validate", await tableWith(r, { claude: record(path, "2.1.282") })])).toBe(0);
    expect(stdout).toHaveBeenCalledWith(`${JSON.stringify({ installations: [{ id: "claude", ok: true }] })}\n`);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(await main(["agents", "list"])).toBe(1);
    expect(stderr).toHaveBeenCalledWith("agents-command-invalid\n");
  });
});
```

- [ ] **Step 2.3 跑红**：

```sh
cd $C && ./node_modules/.bin/vitest run tests/agents/detect.test.ts tests/agents/command.test.ts > $S/t2-red.log 2>&1; echo rc=$?
```

Expected：`rc=1`；`Failed to load url ../../src/agents/detect.js`、`… ../../src/agents/command.js`。

- [ ] **Step 2.4 新建** `src/agents/detect.ts`：

```ts
import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import { probeVersion } from "./materialize.js";
import { listDescriptors } from "./registry.js";
import type { AgentsTableV1, InstallationV1 } from "./types.js";

export interface CandidateV1 {
  path: string;
  realpath: string;
  version: string | null;
  runnable: boolean;
  source: string;
  isPathDefault: boolean;
  error?: string;
}
export interface DetectResultV1 {
  schema: "ccloop-agents-detect-v1";
  table: AgentsTableV1;
  candidates: Record<string, CandidateV1[]>;
}

const DRAFT_TIMEOUT_MS = 1_800_000;
const DRAFT_KILL_GRACE_MS = 5_000;

/** Spec §4.3 / §12 I14: relative PATH entries and world-writable directories are never searched. */
async function searchable(dir: string): Promise<boolean> {
  if (!isAbsolute(dir)) return false;
  try {
    const metadata = await stat(dir);
    return metadata.isDirectory() && (metadata.mode & 0o002) === 0;
  } catch {
    return false;
  }
}

async function executableRealpath(path: string): Promise<string | null> {
  try {
    if (!(await stat(path)).isFile()) return null;
    await access(path, constants.X_OK);
    return await realpath(path);
  } catch {
    return null;
  }
}

/**
 * Finds every installation of every registered kind (spec §4.3): the descriptor's directories first, then PATH,
 * deduplicated by realpath; runs `--version` once per candidate. Reads only; writes nothing anywhere.
 * No login shell: `home` and `path` are the whole environment it searches, so a criterion can redirect both.
 */
export async function detectAgents(input: {
  home: string;
  path: string;
  platform: NodeJS.Platform;
  probe?: typeof probeVersion;
}): Promise<DetectResultV1> {
  const probe = input.probe ?? probeVersion;
  const pathDirs = input.path.split(delimiter).filter((dir) => dir !== "");
  const installations: Record<string, InstallationV1> = {};
  const candidates: Record<string, CandidateV1[]> = {};
  for (const descriptor of listDescriptors()) {
    const found: Array<{ path: string; realpath: string; source: string }> = [];
    const seen = new Set<string>();
    let pathDefault: string | null = null;
    const sources: Array<[string, string[]]> = [
      ["search-dir", descriptor.searchDirs({ home: input.home, env: { PATH: input.path }, platform: input.platform })],
      ["path", pathDirs],
    ];
    for (const [source, dirs] of sources) {
      for (const dir of dirs) {
        if (!(await searchable(dir))) continue;
        const path = join(dir, descriptor.binary);
        const real = await executableRealpath(path);
        if (real === null) continue;
        if (source === "path" && pathDefault === null) pathDefault = real;
        if (seen.has(real)) continue;
        seen.add(real);
        found.push({ path, realpath: real, source });
      }
    }
    const listed: CandidateV1[] = [];
    for (const candidate of found) {
      const version = await probe([candidate.path]);
      listed.push({
        ...candidate,
        version,
        runnable: version !== null,
        isPathDefault: candidate.realpath === pathDefault,
        ...(version === null ? { error: "version-probe-failed" } : {}),
      });
    }
    candidates[descriptor.kind] = listed;
    const chosen = listed.find((candidate) => candidate.isPathDefault && candidate.runnable) ?? listed.find((candidate) => candidate.runnable);
    if (chosen !== undefined) {
      installations[descriptor.kind] = {
        kind: descriptor.kind,
        command: [chosen.path],
        version: chosen.version!,
        configDir: null,
        timeoutMs: DRAFT_TIMEOUT_MS,
        killGraceMs: DRAFT_KILL_GRACE_MS,
        ...descriptor.draftInstallationExtras,
      };
    }
  }
  return { schema: "ccloop-agents-detect-v1", table: { schema: "ccloop-agents-table-v1", installations }, candidates };
}
```

- [ ] **Step 2.5 新建** `src/agents/command.ts`：

```ts
import { homedir } from "node:os";
import { detectAgents } from "./detect.js";
import { probeVersion } from "./materialize.js";
import { readAgentsTable } from "./table.js";
import { AgentError } from "./types.js";

export interface AgentsCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

function detectFlags(argv: string[]): { home?: string; path?: string } {
  const flags: { home?: string; path?: string } = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if ((name !== "--home" && name !== "--path") || value === undefined) throw new AgentError("agents-command-invalid");
    flags[name === "--home" ? "home" : "path"] = value;
  }
  return flags;
}

/** `ccloop agents detect [--home <dir>] [--path <PATH>]` and `ccloop agents validate <table>` (spec §4.3, §4.4). */
export async function runAgentsCommand(
  argv: string[],
  deps: { probe?: typeof probeVersion } = {},
): Promise<AgentsCommandResult> {
  try {
    if (argv[0] === "detect") {
      const flags = detectFlags(argv.slice(1));
      const result = await detectAgents({
        home: flags.home ?? homedir(),
        path: flags.path ?? process.env.PATH ?? "",
        platform: process.platform,
        probe: deps.probe,
      });
      return { code: 0, stdout: `${JSON.stringify(result)}\n`, stderr: "" };
    }
    if (argv[0] === "validate" && argv.length === 2) {
      const table = await readAgentsTable(argv[1]!);
      const probe = deps.probe ?? probeVersion;
      const installations: Array<{ id: string; ok: boolean; error?: string }> = [];
      for (const [id, installation] of Object.entries(table.installations)) {
        const observed = await probe(installation.command);
        installations.push(observed === installation.version ? { id, ok: true } : { id, ok: false, error: "agent-version-drift" });
      }
      return {
        code: installations.every((row) => row.ok) ? 0 : 1,
        stdout: `${JSON.stringify({ installations })}\n`,
        stderr: "",
      };
    }
    throw new AgentError("agents-command-invalid");
  } catch (error) {
    // An AgentError's message starts with its code, so the first stderr token is always the code.
    const message = error instanceof Error ? error.message : String(error);
    return { code: 1, stdout: "", stderr: `${message}\n` };
  }
}
```

- [ ] **Step 2.6 接进 CLI**：`src/cli.ts`

```diff
diff --git a/src/cli.ts b/src/cli.ts
index 6f85da8..1976704 100644
--- a/src/cli.ts
+++ b/src/cli.ts
@@ -2,4 +2,5 @@
 import { readFile } from "node:fs/promises";
 import { pathToFileURL } from "node:url";
+import { runAgentsCommand } from "./agents/command.js";
 import { runControlCommand } from "./control/command.js";
 import { loadContract } from "./contract/loadContract.js";
@@ -275,4 +276,12 @@ export async function main(argv: string[]): Promise<number> {
     }
 
+    // Agent selection (2026-09-26) §4.3/§4.4: `agents` prints to stdout only and writes nothing anywhere.
+    if (argv[0] === "agents") {
+      const result = await runAgentsCommand(argv.slice(1));
+      if (result.stdout !== "") process.stdout.write(result.stdout);
+      if (result.stderr !== "") process.stderr.write(result.stderr);
+      return result.code;
+    }
+
     const parsed = parseArgs(argv);
 
```

- [ ] **Step 2.7 跑绿**：

```sh
cd $C && ./node_modules/.bin/vitest run tests/agents/detect.test.ts tests/agents/command.test.ts tests/cli/cli.test.ts > $S/t2-green.log 2>&1; echo rc=$?
./node_modules/.bin/tsc --noEmit -p tsconfig.json > $S/t2-tsc.log 2>&1; echo tsc=$?
```

Expected：`rc=0`（detect 6、command 10、cli 35）；`tsc=0`。

- [ ] **Step 2.8 提交**：

```sh
cd $C && /usr/bin/git add src/agents/detect.ts src/agents/command.ts src/cli.ts tests/agents/detect.test.ts tests/agents/command.test.ts
/usr/bin/git commit -F - <<'MSG'
feat(agents): detect installed agents and validate an agents table from the CLI

Agent selection (2026-09-26) spec §4.3, §4.4: `ccloop agents detect` lists every
candidate of every kind (search directories before PATH, deduplicated by realpath,
skipping relative PATH entries and world-writable directories) and drafts a table;
`ccloop agents validate` re-probes each record's version. Both only print.

Co-Authored-By: <实施席自己的模型> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR
MSG
```

- [ ] **Step 2.9 变异**（spec §9 判据 1 点名的两条：去掉去重 ⇒ 红（D1）；PATH 扫描挪到最前 ⇒ 红（D2））：

```sh
/usr/bin/git clone --local -q $C $S/t2-mut && ln -s $C/node_modules $S/t2-mut/node_modules
cat > $S/t2-mut.json <<'JSON'
[
 {
  "name": "D1 no realpath dedupe",
  "file": "src/agents/detect.ts",
  "old": "        if (seen.has(real)) continue;\n",
  "new": "",
  "tests": [
   "tests/agents/detect.test.ts"
  ]
 },
 {
  "name": "D2 PATH scanned first",
  "file": "src/agents/detect.ts",
  "old": "    const sources: Array<[string, string[]]> = [\n      [\"search-dir\", descriptor.searchDirs({ home: input.home, env: { PATH: input.path }, platform: input.platform })],\n      [\"path\", pathDirs],\n    ];",
  "new": "    const sources: Array<[string, string[]]> = [\n      [\"path\", pathDirs],\n      [\"search-dir\", descriptor.searchDirs({ home: input.home, env: { PATH: input.path }, platform: input.platform })],\n    ];",
  "tests": [
   "tests/agents/detect.test.ts"
  ]
 },
 {
  "name": "D3 PATH default not recorded",
  "file": "src/agents/detect.ts",
  "old": "        if (source === \"path\" && pathDefault === null) pathDefault = real;\n",
  "new": "",
  "tests": [
   "tests/agents/detect.test.ts"
  ]
 },
 {
  "name": "D4 relative PATH entries searched",
  "file": "src/agents/detect.ts",
  "old": "  if (!isAbsolute(dir)) return false;\n",
  "new": "",
  "tests": [
   "tests/agents/detect.test.ts"
  ]
 },
 {
  "name": "D5 world-writable dirs searched",
  "file": "src/agents/detect.ts",
  "old": "metadata.isDirectory() && (metadata.mode & 0o002) === 0",
  "new": "metadata.isDirectory()",
  "tests": [
   "tests/agents/detect.test.ts"
  ]
 },
 {
  "name": "D6 non-executable files listed",
  "file": "src/agents/detect.ts",
  "old": "    await access(path, constants.X_OK);\n",
  "new": "",
  "tests": [
   "tests/agents/detect.test.ts"
  ]
 },
 {
  "name": "D7 draft takes first runnable",
  "file": "src/agents/detect.ts",
  "old": "listed.find((candidate) => candidate.isPathDefault && candidate.runnable) ?? ",
  "new": "",
  "tests": [
   "tests/agents/detect.test.ts"
  ]
 },
 {
  "name": "D8 non-runnable drafted",
  "file": "src/agents/detect.ts",
  "old": "?? listed.find((candidate) => candidate.runnable);",
  "new": "?? listed[0];",
  "tests": [
   "tests/agents/detect.test.ts"
  ]
 },
 {
  "name": "D9 draft extras dropped",
  "file": "src/agents/detect.ts",
  "old": "        ...descriptor.draftInstallationExtras,\n",
  "new": "",
  "tests": [
   "tests/agents/detect.test.ts"
  ]
 },
 {
  "name": "D10 validate ignores drift",
  "file": "src/agents/command.ts",
  "old": "observed === installation.version ? { id, ok: true }",
  "new": "true ? { id, ok: true }",
  "tests": [
   "tests/agents/command.test.ts"
  ]
 },
 {
  "name": "D11 validate always rc 0",
  "file": "src/agents/command.ts",
  "old": "code: installations.every((row) => row.ok) ? 0 : 1,",
  "new": "code: 0,",
  "tests": [
   "tests/agents/command.test.ts"
  ]
 },
 {
  "name": "D12 detect flags ignored",
  "file": "src/agents/command.ts",
  "old": "        home: flags.home ?? homedir(),",
  "new": "        home: homedir(),",
  "tests": [
   "tests/agents/command.test.ts"
  ]
 },
 {
  "name": "D13 unknown detect flag accepted",
  "file": "src/agents/command.ts",
  "old": "if ((name !== \"--home\" && name !== \"--path\") || value === undefined)",
  "new": "if (value === undefined)",
  "tests": [
   "tests/agents/command.test.ts"
  ]
 },
 {
  "name": "D14 main does not route agents",
  "file": "src/cli.ts",
  "old": "    if (argv[0] === \"agents\") {",
  "new": "    if (argv[0] === \"agents-disabled\") {",
  "tests": [
   "tests/agents/command.test.ts"
  ]
 },
 {
  "name": "D15 stderr drops the detail",
  "file": "src/agents/command.ts",
  "old": "const message = error instanceof Error ? error.message : String(error);",
  "new": "const message = error instanceof AgentError ? error.code : error instanceof Error ? error.message : String(error);",
  "tests": [
   "tests/agents/command.test.ts"
  ]
 }
]
JSON
python3 $S/mutate.py $S/t2-mut $S/t2-mut.json $S/t2-mut-logs; echo rc=$?
```

Expected：`summary.txt` 15 条全部 `RED`，`restore check … ''`。写作席终版复跑：`scratchpad/W1/final-t2-mut/summary.txt`（D1–D14）＋ `final-r2/summary.txt`（D15）全部 RED；首轮 D8、D12 曾 GREEN，已补判据「drafts nothing for a kind whose only candidates are not runnable」与 command 判据里的 home 候选（本文判据已含）。逐条记 `mutations.md`。

---

### Task 4: 停机证明通用闸（ccloop）

**Files**

- Modify: `src/controller/runLoop.ts:1180-1187`（观测类型加 `completedWithResult`）、`:1216-1234`（`settlePhase` 加 `usageOnly`、观测赋值）、`:1834`（错误路径传 `true`）
- Modify: `src/control/stopProof.ts:7`（import）、`:65` 之前（计数读写）、`:118-119` 之后（闸）
- Modify: `src/control/worker.ts:20` 之后（import）、`:165-166`（计数）
- Test（新）：`tests/control/phasesCompleted.test.ts`

**Interfaces**

- Consumes：`atomicReplacePrivateFile`、`readPrivateFile`（`src/control/paths.ts`）、`canonicalJson`。
- Produces：`RunControlHooks.onPhaseSettled` 的观测新增 `completedWithResult: boolean`（W1-17）；`recordCompletedPhase(sourceDir): Promise<void>`（写 `<sourceDir>/control/phases-completed.json` ＝ `{"count": n}`，0600，原子替换）；`proveStopped` 在 `count > 0 && processes.length === 0` 或计数文件不可读时返回 `null`（骨架「停机证明」一条）。

**「带结果完成」的判定（W1-17 的现量结论）**：观测形状里没有这一位（现量 5）；`tokenUsage` 不行（错误路径 `:1834` 带着中止前观测到的 usage、却没有结果）；`usageEvidence` 不行（结果可以不带它，如 required-check 失败的 verify）。⇒ 由 `settlePhase` 自己说：`completedWithResult = !usageOnly && result !== undefined && result !== null`，错误路径标 `usageOnly = true`。逐调用点（现量 6）：`:1389`／`:1512`／`:1637` 恒真；`:1363`／`:1426`／`:1434`／`:1611` 取决于中止或超时时 adapter 是否交回了结果（codex 的 execute 被中止且无 usage 时交回 `null` ⇒ 假）；`:1368`／`:1617` 恒假；`:1834` 恒假。

- [ ] **Step 4.1 写失败判据** `tests/control/phasesCompleted.test.ts`（spec §9 判据 5b，外加观测位与 worker 接线）：

```ts
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import type { LoopContract } from "../../src/contract/schema.js";
import { collectExecution } from "../../src/control/collect.js";
import { atomicReplacePrivateFile, ensurePrivateDirectory } from "../../src/control/paths.js";
import { canonicalHash, canonicalJson, type StartEnvelopeV1 } from "../../src/control/protocol.js";
import { proveStopped, recordCompletedPhase, type StopProofRecord } from "../../src/control/stopProof.js";
import { writeAccepted } from "../../src/control/store.js";
import { runControlWorker } from "../../src/control/worker.js";
import { runLoop, type RunControlHooks } from "../../src/controller/runLoop.js";
import type { RuntimeAdapter } from "../../src/runtime/types.js";
import { codexFixture } from "../runtime/codex/fixture.js";

const execFileAsync = promisify(execFile);
type Observation = Parameters<NonNullable<RunControlHooks["onPhaseSettled"]>>[0];

async function loopFixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "ccloop-phases-completed-")));
  const repo = join(root, "repo");
  await mkdir(repo);
  for (const args of [["init", "-q"], ["config", "user.email", "test@example.com"], ["config", "user.name", "Test"]]) await execFileAsync("git", args, { cwd: repo });
  await writeFile(join(repo, "value.txt"), "0\n");
  await execFileAsync("git", ["add", "value.txt"], { cwd: repo });
  await execFileAsync("git", ["commit", "-qm", "base"], { cwd: repo });
  const contract: LoopContract = {
    objective: { taskId: "phases-completed", goal: "observe phases", successCondition: "done", nonGoals: [] },
    context: { repoPath: repo, targetPaths: ["value.txt"], relevantDocs: [], buildTestCommands: ["true"], constraints: [] },
    executionPolicy: { autonomyLevel: "L2", maxAttempts: 1, perAttemptTimeoutMs: 100, totalRuntimeBudgetMs: 2_000, tokenBudget: 1_000, worktreeRequired: true, partialOutcomeRecoveryWindowMs: 100 },
    safetyPolicy: { allowlistPaths: ["value.txt"], denylistPaths: [], maxFilesTouched: 2, humanGateConditions: [] },
    verification: { verifierType: "agent", requiredChecks: ["true"], rejectOn: ["failure"], evidenceRequired: [] },
    escalationAndExit: { escalationTargets: [], pauseOn: [], stopOn: [], terminalStates: ["succeeded", "blocked_waiting_human", "exhausted", "cancelled", "failed"] },
  };
  return { root, runDir: join(root, "run"), contract };
}

// An adapter that answers every phase without ever starting a process or calling onProcessRegistered.
const silent: RuntimeAdapter = {
  plan: async () => ({ summary: "plan", primaryTargetPaths: ["value.txt"], tokenUsage: 1 }),
  execute: async () => ({ changedFiles: [], diffPatch: "", commandOutputs: [], stdoutStderrLog: "", tokenUsage: 1 }),
  verify: async () => ({ approved: true, rejectCategory: "", primaryTargetPaths: ["value.txt"], failingCommand: null, safeToRetry: false, evidence: ["ok"], pauseSignals: [], stopSignals: [], tokenUsage: 1 }),
};

async function stoppedSource(): Promise<{ sourceDir: string; record: StopProofRecord }> {
  const sourceDir = await realpath(await mkdtemp(join(tmpdir(), "ccloop-phases-proof-")));
  await mkdir(join(sourceDir, "control"));
  await mkdir(join(sourceDir, "run"));
  await writeFile(join(sourceDir, "run", "owner-record.json"), JSON.stringify({
    runId: "task-1", logicalSessionId: "session-1", currentOwnerEpoch: 1, currentProcessInstanceId: "process-1",
    lastAffirmedAt: new Date().toISOString(), ownerStatus: "current", supersededByEpoch: null, leaseAffirmedAt: null,
  }));
  await writeFile(join(sourceDir, "control", "processes.json"), "[]\n");
  return {
    sourceDir,
    record: {
      sourceDir,
      accepted: {
        protocol: 1, envelopeHash: "a".repeat(64), executionId: "execution-1", configHash: "b".repeat(64), generation: 1,
        acceptedAt: new Date().toISOString(), launch: "sealed", worker: { pid: process.pid, startedAt: new Date().toISOString(), nonce: "nonce-1" },
      },
    },
  };
}

describe("phase settlement reports whether the phase completed with a result", () => {
  it("is true for each phase that returned its result", async () => {
    const f = await loopFixture();
    const observed: Observation[] = [];
    await runLoop(f.contract, f.runDir, silent, { onPhaseSettled: async (value) => { observed.push(value); } });
    expect(observed.map(({ phase, completedWithResult }) => ({ phase, completedWithResult }))).toEqual([
      { phase: "plan", completedWithResult: true },
      { phase: "execute", completedWithResult: true },
      { phase: "verify", completedWithResult: true },
    ]);
  });

  it("is false for a phase that timed out without a result", async () => {
    const f = await loopFixture();
    f.contract.executionPolicy.perAttemptTimeoutMs = 20;
    const observed: Observation[] = [];
    await runLoop(f.contract, f.runDir, {
      ...silent,
      plan: async ({ abortSignal }) => {
        await new Promise<void>((resolve) => abortSignal?.addEventListener("abort", () => resolve(), { once: true }));
        return undefined as never;
      },
    }, { onPhaseSettled: async (value) => { observed.push(value); } });
    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({ phase: "plan", completedWithResult: false });
  });

  // Usage observed before an abort (Orca handoff delivery C-3) is settled like a result but is not one.
  it("is false for a phase that threw, even when it carried observed usage", async () => {
    for (const error of [new Error("plain"), Object.assign(new Error("aborted with usage"), { observedTokens: 7 })]) {
      const f = await loopFixture();
      const observed: Observation[] = [];
      await runLoop(f.contract, f.runDir, { ...silent, plan: async () => { throw error; } }, { onPhaseSettled: async (value) => { observed.push(value); } });
      expect(observed).toHaveLength(1);
      expect(observed[0]).toMatchObject({ phase: "plan", completedWithResult: false, tokenUsage: "observedTokens" in error ? 7 : null });
    }
  });
});

describe("stop proof against zero registrations (spec §4.7b, §9 criterion 5b)", () => {
  it("still proves isolation when nothing registered and no phase completed", async () => {
    const f = await stoppedSource();
    expect(await proveStopped(f.record, { graceMs: 0 })).toMatchObject({ executionId: "execution-1", isolated: true });
  });

  it("gives no proof when an adapter completed a phase without registering its process", async () => {
    const f = await stoppedSource();
    const loop = await loopFixture();
    // Mirrors src/control/worker.ts's onPhaseSettled: a phase that completed with a result is counted.
    await runLoop(loop.contract, loop.runDir, silent, {
      onPhaseSettled: async (observation) => {
        if (observation.completedWithResult) await recordCompletedPhase(f.sourceDir);
      },
    });
    expect(JSON.parse(await readFile(join(f.sourceDir, "control", "phases-completed.json"), "utf8"))).toEqual({ count: 3 });
    expect(await proveStopped(f.record, { graceMs: 0 })).toBeNull();
  });

  it("proves isolation for completed phases whose registered groups are quiet", async () => {
    const f = await stoppedSource();
    await writeFile(join(f.sourceDir, "control", "processes.json"), JSON.stringify([{ pid: 123, pgid: 123, startedAt: "start", phase: "plan", registeredAt: new Date().toISOString() }]));
    await recordCompletedPhase(f.sourceDir);
    expect(await proveStopped(f.record, { graceMs: 0, probeGroup: async () => "quiet" })).toMatchObject({ isolated: true });
  });

  it("counts privately and fails closed on a count it cannot read", async () => {
    const f = await stoppedSource();
    await recordCompletedPhase(f.sourceDir);
    await recordCompletedPhase(f.sourceDir);
    const path = join(f.sourceDir, "control", "phases-completed.json");
    expect(await readFile(path, "utf8")).toBe('{"count":2}\n');
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    await writeFile(path, '{"count":-1}\n');
    await expect(recordCompletedPhase(f.sourceDir)).rejects.toThrow("control-phases-completed-invalid");
    await writeFile(join(f.sourceDir, "control", "processes.json"), JSON.stringify([{ pid: 123, pgid: 123, startedAt: "start", phase: "plan", registeredAt: new Date().toISOString() }]));
    expect(await proveStopped(f.record, { graceMs: 0, probeGroup: async () => "quiet" })).toBeNull();
  });
});

describe("the control worker counts completed phases", () => {
  it("writes one count per phase a registering adapter completed, and the run still proves isolation", async () => {
    const runtime = await codexFixture("integration");
    await mkdir(join(runtime.dir, "input"));
    const amount = { tokens: 100, activeMs: 10_000, attempts: 1, sessions: 1 };
    const envelope: StartEnvelopeV1 = {
      protocol: 1,
      claim: { groupId: "group-1", workItemId: "work-1", taskId: "task-1", runId: "run-1", generation: 1, graphVersion: 1, targetVersion: 1, commandId: "command-1", configHash: canonicalHash(runtime.config), grant: { work: amount, handoff: amount }, ownerToken: "owner-1" },
      contractHash: "c".repeat(64),
      inputCheckpoint: null,
      work: { contract: runtime.contract, targetRepo: runtime.repo, base: "main", sourceDir: runtime.dir },
    };
    const controlDir = join(runtime.dir, "control");
    await ensurePrivateDirectory(runtime.dir, controlDir);
    await atomicReplacePrivateFile(runtime.dir, join(controlDir, "config.json"), Buffer.from(canonicalJson(runtime.config)));
    await atomicReplacePrivateFile(runtime.dir, join(controlDir, "envelope.json"), Buffer.from(canonicalJson(envelope)));
    await writeAccepted(runtime.dir, {
      protocol: 1, envelopeHash: canonicalHash(envelope), executionId: "execution-1", configHash: envelope.claim.configHash,
      generation: 1, acceptedAt: new Date().toISOString(), launch: "intended", worker: null,
    });

    await runControlWorker(["--source-dir", runtime.dir, "--execution-id", "execution-1", "--nonce", "nonce-1"]);

    expect(JSON.parse(await readFile(join(controlDir, "phases-completed.json"), "utf8"))).toEqual({ count: 3 });
    expect(JSON.parse(await readFile(join(controlDir, "processes.json"), "utf8"))).toHaveLength(3);
    expect((await collectExecution(envelope, 0)).candidate?.stopProof).toMatchObject({ isolated: true });
  });
});
```

- [ ] **Step 4.2 跑红**：

```sh
cd $C && ./node_modules/.bin/vitest run tests/control/phasesCompleted.test.ts > $S/t4-red.log 2>&1; echo rc=$?
```

Expected：`rc=1`，`Tests  7 failed | 1 passed (8)`（写作席在未改动的副本 `scratchpad/W1/base` 上实跑，`t4-red.log`）。唯一绿的是「still proves isolation when nothing registered and no phase completed」—— 它守的是**今天已成立**的行为（零注册且零完成 ⇒ 仍给证明）；它在 Step 4.8 的变异 P7 下必须变红，那条变异就是它的「RED 阶段即绿」凭据，记 `mutations.md`。

- [ ] **Step 4.3 观测位**：`src/controller/runLoop.ts`

```diff
diff --git a/src/controller/runLoop.ts b/src/controller/runLoop.ts
index 9e099cd..5e2e950 100644
--- a/src/controller/runLoop.ts
+++ b/src/controller/runLoop.ts
@@ -1184,4 +1184,7 @@ export interface RunControlHooks {
     tokenUsage: number | null;
     usageEvidence: UsageEvidence | undefined;
+    // Agent selection (2026-09-26) §4.7b: true only when the phase returned its result; a phase settled
+    // with no result, or only with usage observed before an abort, is false.
+    completedWithResult: boolean;
   }) => Promise<void>;
   onProcessRegistered?: (process: {
@@ -1219,4 +1222,5 @@ export async function runLoopFromState(
     elapsedMs: number,
     result?: { tokenUsage?: number; usageEvidence?: UsageEvidence } | null,
+    usageOnly = false,
   ): Promise<void> => {
     const key = `${attempt}:${phase}`;
@@ -1231,4 +1235,5 @@ export async function runLoopFromState(
       tokenUsage: result?.tokenUsage ?? null,
       usageEvidence: result?.usageEvidence,
+      completedWithResult: !usageOnly && result !== undefined && result !== null,
     });
   };
@@ -1832,5 +1837,5 @@ export async function runLoopFromState(
         const failedPhase = activePhase;
         if (activePhase !== null) {
-          await settlePhase(activePhase, attempt, error.elapsedMs, error.tokenUsage === null ? undefined : { tokenUsage: error.tokenUsage });
+          await settlePhase(activePhase, attempt, error.elapsedMs, error.tokenUsage === null ? undefined : { tokenUsage: error.tokenUsage }, true);
         }
 
```

- [ ] **Step 4.4 计数与闸**：`src/control/stopProof.ts`

```diff
diff --git a/src/control/stopProof.ts b/src/control/stopProof.ts
index c481a68..7261a14 100644
--- a/src/control/stopProof.ts
+++ b/src/control/stopProof.ts
@@ -5,5 +5,5 @@ import { z } from "zod";
 import { canonicalJson, type ArtifactRefV1 } from "./protocol.js";
 import type { AcceptedRecordV1 } from "./store.js";
-import { readPrivateFile } from "./paths.js";
+import { atomicReplacePrivateFile, readPrivateFile } from "./paths.js";
 import { writeEvidence } from "./evidence.js";
 
@@ -63,4 +63,30 @@ async function readProcesses(sourceDir: string): Promise<RegisteredProcessV1[] |
 }
 
+const completedSchema = z.object({ count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict();
+
+function completedPath(sourceDir: string): string {
+  return join(sourceDir, "control", "phases-completed.json");
+}
+
+/** Absent means no phase completed with a result (0); unreadable or malformed means unknown (null). */
+async function readCompletedPhases(sourceDir: string): Promise<number | null> {
+  try {
+    const parsed = completedSchema.safeParse(await readJson(sourceDir, completedPath(sourceDir)));
+    return parsed.success ? parsed.data.count : null;
+  } catch (error) {
+    return (error as NodeJS.ErrnoException).code === "ENOENT" ? 0 : null;
+  }
+}
+
+/**
+ * Agent selection (2026-09-26) §4.7b / §12 C7: the worker counts every phase that completed with a result.
+ * Such a phase ran a provider process, so a run that counted one but registered none cannot prove isolation.
+ */
+export async function recordCompletedPhase(sourceDir: string): Promise<void> {
+  const current = await readCompletedPhases(sourceDir);
+  if (current === null) throw new Error("control-phases-completed-invalid");
+  await atomicReplacePrivateFile(sourceDir, completedPath(sourceDir), Buffer.from(`${canonicalJson({ count: current + 1 })}\n`));
+}
+
 async function ownerReleased(sourceDir: string): Promise<boolean> {
   try {
@@ -118,4 +144,7 @@ export async function proveStopped(record: StopProofRecord, deps: StopProofDeps
   const second = await readProcesses(record.sourceDir);
   if (second === null || !(await probeAll(second, probe))) return null;
+  // §4.7b: zero registrations prove isolation only when no phase completed with a result.
+  const completed = await readCompletedPhases(record.sourceDir);
+  if (completed === null || (completed > 0 && second.length === 0)) return null;
 
   const evidence = {
```

- [ ] **Step 4.5 worker 计数**：`src/control/worker.ts`（T5 之后这里的 `config`／`CodexAdapter` 会换，但这一行不动）

```diff
diff --git a/src/control/worker.ts b/src/control/worker.ts
index 98556fc..10e91e2 100644
--- a/src/control/worker.ts
+++ b/src/control/worker.ts
@@ -19,4 +19,5 @@ import {
 } from "./store.js";
 import { readProcessStartedAt } from "./workerLauncher.js";
+import { recordCompletedPhase } from "./stopProof.js";
 import { testCrashPoint } from "./testCrashPoint.js";
 import { materializeResultRepository } from "./resultRepository.js";
@@ -164,4 +165,5 @@ export async function runControlWorker(argv: string[]): Promise<void> {
       },
       onPhaseSettled: async (observation) => {
+        if (observation.completedWithResult) await recordCompletedPhase(sourceDir);
         if (observation.tokenUsage !== null) {
           const next = cumulativeTokens + observation.tokenUsage;
```

- [ ] **Step 4.6 跑绿＋回归**：

```sh
cd $C && ./node_modules/.bin/vitest run tests/control/phasesCompleted.test.ts > $S/t4-green.log 2>&1; echo rc=$?
./node_modules/.bin/tsc --noEmit -p tsconfig.json > $S/t4-tsc.log 2>&1; echo tsc=$?
./node_modules/.bin/vitest run tests/control/stopProof.test.ts tests/control/worker.test.ts tests/control/handoff.test.ts tests/control/handoffEnteredPhases.test.ts tests/control/handoffDeadlineUsage.test.ts tests/control/collect.test.ts --no-file-parallelism > $S/t4-existing.log 2>&1; echo rc=$?
```

Expected：`rc=0`（8/8）；`tsc=0`；回归一行 `rc=1` 且**唯一**红是现量 16 的已知红（`quiet execution proof > does not treat leader exit …`，5 s 超时）—— 若还有别的红，停下报控制器。

- [ ] **Step 4.7 提交**：

```sh
cd $C && /usr/bin/git add src/controller/runLoop.ts src/control/stopProof.ts src/control/worker.ts tests/control/phasesCompleted.test.ts
/usr/bin/git commit -F - <<'MSG'
feat(control): refuse a stop proof when completed phases registered no process

Agent selection (2026-09-26) spec §4.7b, §12 C7: phase settlement now says whether the
phase completed with a result; the control worker counts those phases in
control/phases-completed.json, and proveStopped gives no proof when that count is
above zero while processes.json is empty, so an adapter that never registers its
process can no longer make isolation hold vacuously.

Co-Authored-By: <实施席自己的模型> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR
MSG
```

- [ ] **Step 4.8 变异**（spec §9 判据 5b 点名的「删掉这条检查 ⇒ 红」是 P4）：

```sh
/usr/bin/git clone --local -q $C $S/t4-mut && ln -s $C/node_modules $S/t4-mut/node_modules
cat > $S/t4-mut.json <<'JSON'
[
 {
  "name": "P1 every settled phase counts",
  "file": "src/controller/runLoop.ts",
  "old": "completedWithResult: !usageOnly && result !== undefined && result !== null,",
  "new": "completedWithResult: true,",
  "tests": [
   "tests/control/phasesCompleted.test.ts"
  ]
 },
 {
  "name": "P2 usage-only settlement counts",
  "file": "src/controller/runLoop.ts",
  "old": "completedWithResult: !usageOnly && result !== undefined && result !== null,",
  "new": "completedWithResult: result !== undefined && result !== null,",
  "tests": [
   "tests/control/phasesCompleted.test.ts"
  ]
 },
 {
  "name": "P3 error path not marked usage-only",
  "file": "src/controller/runLoop.ts",
  "old": "{ tokenUsage: error.tokenUsage }, true);",
  "new": "{ tokenUsage: error.tokenUsage });",
  "tests": [
   "tests/control/phasesCompleted.test.ts"
  ]
 },
 {
  "name": "P4 no zero-registration gate",
  "file": "src/control/stopProof.ts",
  "old": "  if (completed === null || (completed > 0 && second.length === 0)) return null;\n",
  "new": "",
  "tests": [
   "tests/control/phasesCompleted.test.ts"
  ]
 },
 {
  "name": "P5 unreadable count ignored",
  "file": "src/control/stopProof.ts",
  "old": "if (completed === null || (completed > 0 && second.length === 0)) return null;",
  "new": "if (completed !== null && completed > 0 && second.length === 0) return null;",
  "tests": [
   "tests/control/phasesCompleted.test.ts"
  ]
 },
 {
  "name": "P6 worker does not count",
  "file": "src/control/worker.ts",
  "old": "        if (observation.completedWithResult) await recordCompletedPhase(sourceDir);\n",
  "new": "",
  "tests": [
   "tests/control/phasesCompleted.test.ts"
  ]
 },
 {
  "name": "P7 absent count is unknown",
  "file": "src/control/stopProof.ts",
  "old": "return (error as NodeJS.ErrnoException).code === \"ENOENT\" ? 0 : null;",
  "new": "return null;",
  "tests": [
   "tests/control/phasesCompleted.test.ts"
  ]
 },
 {
  "name": "P8 bad count restarts at 0",
  "file": "src/control/stopProof.ts",
  "old": "  if (current === null) throw new Error(\"control-phases-completed-invalid\");\n",
  "new": "",
  "tests": [
   "tests/control/phasesCompleted.test.ts"
  ]
 },
 {
  "name": "P9 any completed phase blocks proof",
  "file": "src/control/stopProof.ts",
  "old": "(completed > 0 && second.length === 0)",
  "new": "(completed > 0)",
  "tests": [
   "tests/control/phasesCompleted.test.ts"
  ]
 }
]
JSON
python3 $S/mutate.py $S/t4-mut $S/t4-mut.json $S/t4-mut-logs; echo rc=$?
```

Expected：9 条全部 `RED`（写作席终版复跑：`scratchpad/W1/final-t4-mut/summary.txt`），`restore check … ''`。逐条记 `mutations.md`。

- [ ] **Step 4.9 E2E 回归**（worker 与停机证明走真 CLI）：

```sh
cd $S/t4-mut && npm run build > $S/t4-build.log 2>&1; echo build=$?
./node_modules/.bin/vitest run tests/control/endToEnd.test.ts > $S/t4-e2e.log 2>&1; echo rc=$?
```

Expected：`build=0`；`rc=0`（6/6；写作席 `scratchpad/W1/e2e.log`）。在副本里 build，是因为 `dist/` 被 gitignore、主树 build 会在主树留下产物。

---

## W1 交给控制器的决定

1. W1-3：`AgentDescriptor` 加 `draftInstallationExtras`（改骨架接口）。
2. W1-9：码表 `AGENT_ERROR_CODES` 里本分部新增的码是否并入全仓字面量表；`agent-adapter-unavailable` 由 T3 删除（连同码表里那一项）。
3. W1-10／W1-18：T3 要做的两件本分部依赖的事（换掉 claude `createAdapter` 的临时抛错并整条改写其判据；给 fake codex 加 `--version`）。
4. W1-17：T4 对 `runLoop.ts` 的外科改动（观测加 `completedWithResult`）。
5. W1-19：T5 整条改写 `tests/control/phasesCompleted.test.ts` 的 worker 接线判据；T5／T6 以本分部落地后的 `worker.ts`／`cli.ts`／`protocol.ts` 为底。
