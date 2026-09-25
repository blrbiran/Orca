# 计划分片 W3：T5 —— ccloop control 走安装表（envelope v2、capabilities v3、accept 物化、worker 经描述建 adapter）

> **归属**：Orca 控制器会话 `75ec878e` 派出的计划写作席 W3（Claude Opus 5.5），2026-09-26。
> **观测锚点**：ccloop 主题行 `docs(handoff): roll the Orca section: C5-C7 and C-3 landed here for the handoff delivery round`（写作时 `f4e49a2`）；Orca 主题行 `chore(checkpoint): orca-dev-75ec878e, level 335434 of 1000000 (T1 330000, T2 450000, band 1)`。**行号会移动 ⇒ 实施前现测。**
> **探针**：全部只在 `scratchpad/W3/` 下：`ccloop-base/`（基线副本，`npm run build` 后逐文件跑）、`ccloop-probe/`（最小行为探针：envelope 升 2＋claim 加 `agent`、capabilities 要 `{agent}`、`--agents` 形态、binding 改名、worker 要物化配置 —— 用来**现量**哪些既有判据会红）。主树零触碰。
> **消费的别席产物（按骨架名字）**：T1 `src/agents/{types,registry,table,materialize}.ts`（`AgentError`、`getDescriptor`、`readAgentsTable`、`parseAgentsTable`、`assertAgentsTablePath`、`resolveAgent`、`probeVersion`、类型）；T3 `tests/fixtures/fake-claude-cli.mjs`、`ClaudeAgentAdapter`、fake codex 的 `.argv`；T4 `phases-completed.json` 计数（T4 改 `worker.ts` 的 `onPhaseSettled`，本 Task 对 `worker.ts` 一律用**锚点**改，不用行号）。

---

## W3 现量

### (一) 本 Task 依赖的现量

| # | 现量 | 证据（file:line ＋ 命令） |
|---|---|---|
| 1 | control 命令形态写死 `--adapter codex --adapter-config <file>`，5 个 argv；非 codex ⇒ `control-adapter-unsupported`；配置文件路径检查 realpath＝自身、普通文件 | ccloop `src/control/command.ts:113-137`（`:120-123`）；命令 `cat -n src/control/command.ts` |
| 2 | `capabilities` 答常量、响应 schema `protocol: z.literal(2)` 八键 | `command.ts:27-47`（schema）、`:143-154`（常量） |
| 3 | 退出码：`ControlProtocolError` ⇒ 2，其余 ⇒ 1；stderr ＝ `error.message` | `command.ts:212-218` |
| 4 | Orca 侧：`ccloopPort` 把非 0 退出包成 `control-peer-exit`，detail ＝ `<退出码>:<stderr 去空白>`；驱动环 accept 见到 `2:` 前缀 ⇒ `blockRun(... "accept-refused:<detail>")`，其余 ⇒ 当 `unknown` 重试 | Orca `src/control/ccloopPort.ts:38-39`；`src/control/executionDriver.ts:358-362`（`Read` 读） |
| 5 | envelope：`StartEnvelopeV1.protocol: 1`、`ClaimV1` 无 agent；`startEnvelopeSchema` 字面量 1；`capabilities` 负载 `z.object({}).strict()`；`protocolVersion()` 读顶层 `protocol`，否则读 `input.protocol`；`version !== 1` ⇒ `control-protocol-unsupported` | `src/control/protocol.ts:27-39`、`:53-64`、`:110-124`、`:143-151`（`:145`）、`:163-170`（`:164`）、`:224-230`、`:246` |
| 6 | `StartEnvelopeV1` 的 src 消费者：`accept.ts`、`collect.ts`、`handoff.ts`、`paths.ts`、`resultRepository.ts`、`worker.ts`、`protocol.ts`；`ClaimV1`／`ControlPayloadV1` 只在 `protocol.ts` | `grep -rn -e StartEnvelopeV1 … src scripts`；`grep -rn -E "ClaimV1|ControlPayloadV1|ControlRequestV1|ControlMethodV1" src tests scripts`（`scratchpad/W3/grep-types.txt`） |
| 7 | accept：已有记录 ⇒ 先重放（不读配置）；否则 `parseCodexConfig(readConfig(path))`、`canonicalHash(config) !== claim.configHash` ⇒ `control-config-hash-mismatch`；把 codex 配置写进 `control/config.json` | `src/control/accept.ts:85-89`（重放）、`:91-95`、`:112-116`；`AdapterBindingV1` `:39-45`；`readConfig` `:47-60` |
| 8 | worker：`parseCodexConfig(readJson("config.json"))`、`runLoop(..., () => new CodexAdapter(config), …)` | `src/control/worker.ts:3-4`（import）、`:106-107`、`:153` |
| 9 | 🔴 fake codex **不答 `--version`**：`node tests/fixtures/fake-codex.mjs integration <m> --version </dev/null` 写出 marker 文件、`JSON.parse` 崩、RC 1 | `tests/fixtures/fake-codex.mjs:3-11`、`:19`；日志 `scratchpad/W3/fc-version.log` |
| 10 | 🔴 `tsconfig.json` 的 `include` 含 `tests/**/*.ts` ⇒ `npm run build`（E2E 前必跑）也对**测试文件**做类型检查，任一测试文件类型错 ⇒ `dist/cli.js` 不生成 | `tsconfig.json`；`package.json` 的 `build` 脚本（`tsc -p tsconfig.json && node -e …`）；探针 `scratchpad/W3/probe-build.log`（类型错 ⇒ `dist/cli.js` 缺失） |
| 11 | 三个 phase 的 prompt 是 claude／codex 共用的（`Plan one isolated L2 attempt for task <id>.` 等）⇒ fake claude CLI 的 `script` 模式可按同样的 task 键取条目 | `src/runtime/claude/prompts.ts:15`；`fake-codex.mjs:34` |
| 12 | 旧 claude runner 以 worktree 为 cwd 起 claude | `scripts/claude-phase-runner.mjs:199`、`:214`、`:392` |
| 13 | `verify-control-protocol.mjs` 要 `ORCA_CCLOOP_BIN`＋`ORCA_CCLOOP_ADAPTER_CONFIG`，先 build 再核「fixture 配置」（`model==="fixture"` 且 `command` 含 `fake-codex.mjs`），再跑 `tests/control`、`tests/controller/codex.integration.test.ts`、`tests/runtime/codex` | `scripts/verify-control-protocol.mjs:9-13`、`:21`、`:28-37`、`:44-51`；Orca 调用方 `scripts/verify-control.mjs:6-11`（T7 改 env） |
| 14 | 基线（`ccloop-base`，`npm run build` RC 0，逐文件 json reporter）：protocol 7/7、accept 7/7、workerLaunch 1/1、command 7/7、resultRepository 2/2、handoffDeadlineUsage 1/1、collect 3/3、handoff 6/6、materialize 14/14、worker 8/8、endToEnd 6/6、handoffEnteredPhases 7/7、usage 4/4、stopProof 2/3（红的是已登记已知红 `quiet execution proof > does not treat leader exit…`，`scripts/check-known-reds.mjs:40`） | 命令 `./node_modules/.bin/vitest run tests/control/<f>.test.ts --reporter=json --outputFile=…`（逐个、串行）；汇总 `scratchpad/W3/base-summ.txt` |
| 15 | 探针（`ccloop-probe`）现量的红：见下方「会红的既有判据」；类型红见 `scratchpad/W3/probe-tsc.log`（9 个测试文件：accept、collect、endToEnd、handoff×2 处、handoffDeadlineUsage、handoffEnteredPhases、protocol、workerLaunch） | `scratchpad/W3/probe-summ.txt`、`probe-e2e.txt`、`probe-tsc.log` |
| 16 | 其余 11 个候选文件（台账 §1：`tests/runtime/codex/{protocol,fileBoundary,abortedUsage}`、`tests/cli/{cli,codex}`、`tests/sweep/sweepRuns`、`tests/control/{materialize,worker,stopProof,usage}`、`tests/validation/{evidence,prepareA04}`、`scripts/validate-codex-adapter.mjs`）**不因 T5 红**：它们只经 `ccloop run/resume/sweep --adapter`（T5 不动 `cli.ts` 的 `parseArgs`，T6 的事）或 `parseCodexConfig`（T5 不动）；T5 改的四个 src 文件没有被它们 import（唯一 import `src/control/` 的非 control 测试是 `tests/runtime/codex/fakeCodexDelay.test.ts`，它读 `materialize.ts`，T5 不动）；`tests/cli/*.test.ts` 不含 `control` 路由判据 | `grep -n -E "…" <11 个文件>`（`scratchpad/W3/grep-other.txt`，106 行命中全是 `run/resume/sweep` 与 `parseCodexConfig`）；`grep -rln "src/control/" tests validation scripts`；`grep -n control tests/cli/*.test.ts`；探针里 `worker`、`materialize`、`usage`、`stopProof` 与基线逐条相同 |

### (二) 与 spec／骨架不符之处（**控制器裁定**；正文按「建议」一栏写）

| 编号 | 不符 | 建议 |
|---|---|---|
| D-W3-1 | 🔴 T5 起 accept／capabilities 要跑 `<command> --version`（spec §4.2、骨架 `resolveAgent` 的 `probeVersion`），而写作时 **fake codex 不答 `--version`**（现量 9：写 marker、崩）⇒ 所有 codex 的 control 判据都会在 accept 处失败 | **已裁（控制器 2026-09-26，转自 W2）**：fake codex 与 fake claude CLI 都由 **T3** 答 `--version`。T5 只在 Step 0 核它，并要求该分支**不写任何文件**（marker、`.calls`、`.tasks`、`.argv`）—— `endToEnd` 的 `.calls` 断言、`handoff` 的 marker 轮询靠这个；若 T3 的实现会写文件，T5 停下报控制器，不改 T3 的文件 |
| D-W3-2 | `AgentError` 过 control 边界时的退出码与 stderr 形状，骨架／spec 都没定 | **退出码 2（具名拒绝）；stderr ＝ `error.message` 原文**（控制器裁定 2：`message` 以码开头，`<code>` 或 `<code>: <detail>`，CLI 原样打印 —— 与 `ccloop agents` 同一规矩，不另起一套）。理由：Orca 驱动环只对 `2:` 前缀做确定性阻塞（现量 4），版本漂移／安装缺失重试十次无意义。**给 T7／T11 的解析约定**：`control-peer-exit` 的 detail 是 `2:<code>[: <detail>]` ⇒ ccloop 码 ＝ `detail.slice(2)` 到第一个 `:` 为止（码本身不含 `:`）。判据对 stderr 一律断言「第一个 token 是码」（`/^<code>(: .*)?\n$/`），不断言 detail 原文 |
| D-W3-3 | worker 要校验 `control/config.json`（今天 `parseCodexConfig` 校验），骨架没有物化配置的解析函数 | **已由 T1 提供**（W1-8／W1-9 与控制器 W1-19 转达）：`parseMaterializedAgentConfig(raw)`（`src/agents/materialize.ts`），坏了抛 `AgentError("agent-config-invalid")`（kind 不一、多键、schema 字面量不对）或安装记录／选择各自的码。T5 的 worker 直接调它；它的内部分支与变异归 T1，T5 只负责「worker 读回时经过它」这一条接线（变异 M13） |
| D-W3-4 | 🔴 线上 zod schema 与 **ESM 循环 import**：T1 在 `src/agents/types.ts` 定义并导出 `contextWindowSchema`／`agentSelectionSchema`／`partialSelectionSchema`，且 `types.ts` 从 `../control/protocol.js` import `idSchema`（值）；T5 的 `protocol.ts` 要用这两个选择 schema 造 `claimSchema` 与 capabilities 负载（模块顶层求值）。若 `protocol.ts` 再从 `agents/types.ts` import 它们 ⇒ `types ⇄ protocol` 成环，先加载哪一边都会在顶层碰到另一边尚在 TDZ 的 `const`（`ReferenceError`） | **把三个 schema 的定义挪进 `src/control/protocol.ts`（紧跟 `idSchema`），`src/agents/types.ts` 改为从 protocol 转出口**（`export { contextWindowSchema, agentSelectionSchema, partialSelectionSchema } from "../control/protocol.js";`）。依赖方向保持 T1 定下的 `agents → control/protocol` 单向，定义只有一份，T1 的 import 点（`materialize.ts` 等从 `./types.js` 取）不用改。备选：`protocol.ts` 本地另写一份同形 schema（两份定义，Rule 7 不取）。schema 只核类型形状（`model: z.string()` 不设上下限），model 语义约束留给 kind 的 `validateSelection`，这样错误码才是 spec §7 的 `agent-selection-invalid` |
| D-W3-13 | **控制器裁定 W1-19**：T4 新写的 `tests/control/phasesCompleted.test.ts` ＞ the control worker counts completed phases ＞ writes one count per phase a registering adapter completed, and the run still proves isolation 按 v1 envelope＋codex `config.json` 造 worker 输入，T5 之后必红 | T5 整条改写：v2 envelope＋`sealCodex` 的物化配置；「只数带结果完成的阶段」「三条注册」「仍给隔离证明」三个断言一字不动（Step 11） |
| D-W3-5 | `probeVersion(command)` 的调用形状 | **已裁（控制器 2026-09-26）**：`[...command, "--version"]`，`--version` 在最后。T5 的判据不写死版本字面量：夹具用 `probeVersion(command)` 现取替身答的版本写表（`agentsFixture.ts`），漂移用例写 `"0.0.0-stale"` 并先断言它不等于现取值；`.argv` 若也记了版本探测行，claude 判据按 `includes("--version")` 滤掉 |
| D-W3-12 | **控制器裁定（2026-09-26，转自 W2）**：W2 的判据 3（`processes.json` 非空、组活着时 `proveStopped` 为 `null`）只覆盖孤立的 `ClaudeAgentAdapter`；T5 要在 **worker 层**再证一次 | 新判据 `agentsControl.test.ts` ＞ claude process registration through the control worker (agent selection) ＞ registers the claude phase's process group in processes.json, and that record proves nothing while the group lives（Step 5 文件内、Step 11／13 跑），变异 M16 ＝ 删掉 worker 传给 `runLoop` 的 `onProcessRegistered` 接线。「组活着 ⇒ null」要单独量组：真 worker 在跑时 `proveStopped` 本来就因「worker 未封存、lease 未释放」而为 null（`stopProof.test.ts` ＞ quiet execution proof ＞ requires a sealed worker and released owner lease），直接断言它会**空洞成立**；所以把 worker 登记的那几条抄进一个「其余条件都满足」（封存、lease 已释放）的探针目录，只让进程组决定结果，停机后同一探针必须给出证明 |
| D-W3-6 | capabilities 表级视图：spec §4.6 为 `{id, kind, defaults, contextOptions}`，骨架多一个 `version` | 按骨架（带 `version`）。另：骨架 `AgentResolutionV1.capabilities` 注释「the eight fields, no protocol」—— 去掉 `protocol` 后是 **7** 个键（现量 2）；schema 按 7 个写 |
| D-W3-7 | 类型改名 | `StartEnvelopeV1→StartEnvelopeV2`、`ClaimV1→ClaimV2`（形状变了）、`AdapterBindingV1→AgentBindingV1`；新增 `CapabilitiesRequestV3`；**保留** `ControlMethodV1`／`ControlRequestV1`／`ControlPayloadV1` 与 `protocol.test.ts` 的 describe 名 `control protocol v1`（它们指方法集，不指 envelope 版本；改名只是搬动） |
| D-W3-8 | 表级视图（`agent: null`）要不要跑 `--version` | 不跑（spec 只对「带选择」与 accept 要求核对；表级视图是给面板列 agent 的，跑一遍 N 个 CLI 没有读者） |
| D-W3-9 | 🔴 跨仓时序：T5 落地后，Orca 里凡是用真 ccloop build 走 `--adapter` 的判据（`ccloopPort.ts:38`、`webCcloopSmoke`、`handoffE2E`、`verify-control.mjs`）在 T7 落地前都红；ccloop `verify-control-protocol.mjs` 改读 `ORCA_AGENTS_TABLE`，与 T7 的 Orca `scripts/verify-control.mjs` 必须同名 | 控制器按波次：T5 与 T7 之间不跑 Orca 的 control 门；T7 的 Orca 侧 env 名用 `ORCA_AGENTS_TABLE` |
| D-W3-10 | `assertAgentsTablePath` 的边界：spec 5d「accept 之后把表写坏，collect 仍成功」要求它**不读内容** | **已由 W1 的正文确认**：T1 的 `assertAgentsTablePath` 只做 `isAbsolute`＋`realpath`＋`lstat().isFile()`，不打开读内容（plan-part-W1 Step 1.14 的代码）；T5 的判据只把表**内容**写坏、不删表 |
| D-W3-11 | ccloop `CLAUDE.md` Rule 15（a）要人**指名到具体测试**；台账 §0 的人裁是概括授权 | 本分片把每条被改写的判据全名列在下方；控制器按台账 §0「事后逐条列名报人」转人（ccloop Rule 18：控制器不代人宣布） |

---

### Task 5: ccloop control 走安装表

**Files:**（以 T1／T2／T4 落地后的文件为底 —— 控制器裁定 W1-19）
- Modify: `src/control/protocol.ts`（整文件替换，写作时 266 行；T1 只把 `:99` 的 `const idSchema` 改成 `export const`，替换稿已含 → 见 Step 3）
- Modify: `src/agents/types.ts`（T1 的文件：三个选择 schema 的定义换成从 protocol 转出口，D-W3-4 → 见 Step 3）
- Modify（改写 T4 新判据）: `tests/control/phasesCompleted.test.ts`（D-W3-13 → 见 Step 11）
- Modify: `src/control/command.ts`（整文件替换，220 行 → 见 Step 9）
- Modify: `src/control/accept.ts`（整文件替换，146 行 → 见 Step 6）
- Modify: `src/control/worker.ts`（锚点编辑：import 两行、写作时 `:106-107` 两行、`:153` 一行 —— T4 在 `:20` 后加 import、在 `onPhaseSettled` 里加计数，行号会移，一律按锚点文本改）
- Modify: `src/control/{handoff,collect,paths,resultRepository}.ts`（`StartEnvelopeV1` → `StartEnvelopeV2`，纯改名）
- Modify: `scripts/verify-control-protocol.mjs`（整文件替换，51 行）
- Create: `tests/control/agentsFixture.ts`（测试共用：表、安装记录、封存配置、v2 envelope）
- Create: `tests/control/agentsControl.test.ts`（新判据）
- Create: `tests/control/claudeEndToEnd.test.ts`（新判据，经 built CLI）
- Test（改写既有）: `tests/control/{protocol,command,accept,endToEnd,handoff,handoffDeadlineUsage,workerLaunch,collect,handoffEnteredPhases,resultRepository}.test.ts`

**Interfaces:**
- Consumes（T1）：`AgentError`（`message` 以码开头）、`AgentSelectionV1`、`PartialSelectionV1`、`InstallationV1`、`AgentsTableV1`、`MaterializedAgentConfigV1`（`src/agents/types.ts`）；`getDescriptor`（`registry.ts`）；`readAgentsTable`、`parseAgentsTable`、`assertAgentsTablePath`（`table.ts`）；`resolveAgent`、`probeVersion`、`parseMaterializedAgentConfig`（`materialize.ts`，W1-8）；`idSchema`（T1 已导出于 `protocol.ts`）。（T4）：`recordCompletedPhase`／`proveStopped` 的计数闸、`tests/control/phasesCompleted.test.ts`。（T3）：`tests/fixtures/fake-claude-cli.mjs`（`script <marker> <scriptPath>`、答 `--version`、`.calls`／`.argv`）、`ClaudeAgentAdapter` 由 claude 描述的 `createAdapter` 返回。（T4）：`proveStopped` 的计数闸（claude E2E 的 `stopProof.isolated` 依赖它与 T3 的进程组注册）。
- Produces：`StartEnvelopeV2`、`ClaimV2`、`CapabilitiesRequestV3`（`protocol.ts`）；`contextWindowSchema`、`agentSelectionSchema`、`partialSelectionSchema` 的定义迁入 `protocol.ts`、`agents/types.ts` 原名转出口（D-W3-4）；`AgentBindingV1`（`accept.ts`）；`ControlContextV1`（`command.ts`）；线上：`ccloop control <method> --agents <table>`、envelope `protocol: 2`＋`claim.agent`、capabilities 请求 `{agent: PartialSelectionV1 | null}`、应答 `{protocol:3, installations:[{id, kind, defaults, contextOptions, version}]}` 或 `{protocol:3, selection, configHash, timeoutMs, killGraceMs, capabilities}`；`AgentError` ⇒ 退出码 2、stderr ＝ `message`（首 token 为码，D-W3-2）；`<sourceDir>/control/config.json` ＝ 物化配置的 canonical JSON。

约定：下文 `$C=/Users/biran/code/skills/loop/ccloop`，`$S=/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/75ec878e-a6d3-4299-9a4b-b76dd574b77a/scratchpad/T5`（先 `mkdir -p $S`）。所有命令在 `$C` 下跑；验证输出一律重定向到 `$S` 再整份读回。

- [ ] **Step 0: 前置核对（T1–T4 已落地；fake 替身答 `--version` 且不写文件）**

```bash
cd $C && /usr/bin/git log --oneline -8 > $S/t5-pre-log.txt 2>&1
ls src/agents/types.ts src/agents/registry.ts src/agents/table.ts src/agents/materialize.ts tests/fixtures/fake-claude-cli.mjs > $S/t5-pre-files.txt 2>&1; echo rc=$? >> $S/t5-pre-files.txt
mkdir -p $S/pre && node tests/fixtures/fake-codex.mjs integration $S/pre/codex-marker --version </dev/null > $S/t5-pre-codex.txt 2>&1; echo rc=$? >> $S/t5-pre-codex.txt; ls $S/pre >> $S/t5-pre-codex.txt 2>&1
echo '{}' > $S/pre/script.json && node tests/fixtures/fake-claude-cli.mjs script $S/pre/claude-marker $S/pre/script.json --version </dev/null > $S/t5-pre-claude.txt 2>&1; echo rc=$? >> $S/t5-pre-claude.txt; ls $S/pre >> $S/t5-pre-claude.txt 2>&1
```
Expected：`t5-pre-files.txt` 末行 `rc=0`；两个 `--version` 各打一行含 `x.y.z` 版本号的 stdout、`rc=0`（T3 所做，D-W3-1）；`ls $S/pre` 只有 `script.json`（没有 `codex-marker*`、`claude-marker*`）。任一条不满足 ⇒ 停下报控制器，不改 T3 的替身。另核 T1／T4 的名字都在：

```bash
/usr/bin/grep -n "export const idSchema\|export const contextWindowSchema\|export const agentSelectionSchema\|export const partialSelectionSchema\|export function parseMaterializedAgentConfig\|export async function recordCompletedPhase\|completedWithResult" src/control/protocol.ts src/agents/types.ts src/agents/materialize.ts src/control/stopProof.ts src/controller/runLoop.ts src/control/worker.ts > $S/t5-pre-names.txt 2>&1; echo rc=$? >> $S/t5-pre-names.txt
```
Expected：`protocol.ts` 1 行（`idSchema`）、`types.ts` 3 行、`materialize.ts` 1 行、`stopProof.ts` 1 行、`runLoop.ts` 与 `worker.ts` 各有 `completedWithResult`，末行 `rc=0`。

- [ ] **Step 1: 建测试共用夹具 `tests/control/agentsFixture.ts`**

```ts
import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { LoopContract } from "../../src/contract/schema.js";
import { probeVersion, resolveAgent } from "../../src/agents/materialize.js";
import { parseAgentsTable } from "../../src/agents/table.js";
import type { AgentSelectionV1, AgentsTableV1, InstallationV1, MaterializedAgentConfigV1 } from "../../src/agents/types.js";
import type { StartEnvelopeV2 } from "../../src/control/protocol.js";
import type { CodexConfig } from "../../src/runtime/codex/protocol.js";

/**
 * Shared by the control criteria since agent selection (2026-09-26): an agents table the way readAgentsTable
 * demands it (0600 file in an owner-only directory), installation records whose `version` is whatever the
 * fixture command itself answers to `--version`, and the sealed config accept would write.
 */
export const FAKE_CODEX = resolve("tests/fixtures/fake-codex.mjs");
export const FAKE_CLAUDE_CLI = resolve("tests/fixtures/fake-claude-cli.mjs");

/** A selection for fixtures whose provider never runs: the envelope schema requires one, nothing resolves it. */
export const FIXTURE_SELECTION: AgentSelectionV1 = { agent: "codex", model: "fixture", contextWindow: "agent-default" };

async function probed(command: [string, ...string[]]): Promise<string> {
  const version = await probeVersion(command);
  if (version === null) throw new Error(`fixture command answers no --version: ${command.join(" ")}`);
  return version;
}

export async function codexInstallation(
  config: Pick<CodexConfig, "command" | "sandbox" | "budgetMode" | "timeoutMs" | "killGraceMs">,
): Promise<InstallationV1> {
  return {
    kind: "codex",
    command: config.command,
    version: await probed(config.command),
    configDir: null,
    timeoutMs: config.timeoutMs,
    killGraceMs: config.killGraceMs,
    sandbox: config.sandbox,
    budgetMode: config.budgetMode,
  };
}

export async function claudeInstallation(
  command: [string, ...string[]],
  limits: { timeoutMs: number; killGraceMs: number } = { timeoutMs: 10_000, killGraceMs: 50 },
): Promise<InstallationV1> {
  return { kind: "claude", command, version: await probed(command), configDir: null, ...limits };
}

/** Writes `<dir>/agents.json` (0600); `dir` defaults to a fresh mkdtemp directory (0700, owned by this process). */
export async function writeAgentsTable(
  installations: Record<string, InstallationV1>,
  dir?: string,
): Promise<{ path: string; table: AgentsTableV1 }> {
  const parent = dir ?? await realpath(await mkdtemp(join(tmpdir(), "ccloop-agents-table-")));
  const table = parseAgentsTable({ schema: "ccloop-agents-table-v1", installations });
  const path = join(parent, "agents.json");
  await writeFile(path, `${JSON.stringify(table, null, 2)}\n`, { mode: 0o600 });
  return { path, table };
}

/** What accept seals for this codex config: the materialized config, its hash, and the filled selection. */
export async function sealCodex(
  config: CodexConfig,
): Promise<{ config: MaterializedAgentConfigV1; configHash: string; selection: AgentSelectionV1 }> {
  const table = parseAgentsTable({ schema: "ccloop-agents-table-v1", installations: { codex: await codexInstallation(config) } });
  const { config: sealed, resolution } = await resolveAgent(table, { agent: "codex", model: config.model, contextWindow: "agent-default" });
  return { config: sealed, configHash: resolution.configHash, selection: resolution.selection };
}

export function controlContract(repoPath: string): LoopContract {
  return {
    objective: { taskId: "task-1", goal: "work", successCondition: "done", nonGoals: [] },
    context: { repoPath, targetPaths: ["src"], relevantDocs: [], buildTestCommands: ["npm test"], constraints: [] },
    executionPolicy: { autonomyLevel: "L2", maxAttempts: 1, perAttemptTimeoutMs: 1_000, totalRuntimeBudgetMs: 2_000, tokenBudget: 1_000, worktreeRequired: true, partialOutcomeRecoveryWindowMs: 100 },
    safetyPolicy: { allowlistPaths: ["src"], denylistPaths: [], maxFilesTouched: 10, humanGateConditions: [] },
    verification: { verifierType: "command", requiredChecks: ["npm test"], rejectOn: ["failure"], evidenceRequired: [] },
    escalationAndExit: { escalationTargets: [], pauseOn: [], stopOn: [], terminalStates: ["succeeded", "blocked_waiting_human", "exhausted", "cancelled", "failed"] },
  };
}

export function startEnvelope(input: {
  sourceDir: string;
  targetRepo: string;
  contract: LoopContract;
  agent: AgentSelectionV1;
  configHash: string;
}): StartEnvelopeV2 {
  const amount = { tokens: 10, activeMs: 20, attempts: 1, sessions: 1 };
  return {
    protocol: 2,
    claim: {
      groupId: "group-1", workItemId: "work-1", taskId: "task-1", runId: "run-1", generation: 1, graphVersion: 1,
      targetVersion: 1, commandId: "command-1", configHash: input.configHash, agent: input.agent,
      grant: { work: amount, handoff: amount }, ownerToken: "owner-1",
    },
    contractHash: "b".repeat(64),
    inputCheckpoint: null,
    work: { contract: input.contract, targetRepo: input.targetRepo, base: "main", sourceDir: input.sourceDir },
  };
}
```

（`StartEnvelopeV2` 是 type import，Step 3 之前 vitest 的 esbuild 会把它擦掉，不影响 RED 跑。）

- [ ] **Step 2: 改写 `tests/control/protocol.test.ts`（整文件替换），加一条新判据**

```ts
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalHash,
  parseControlRequest,
  type StartEnvelopeV2,
} from "../../src/control/protocol.js";
import { controlRoot } from "../../src/control/paths.js";
import { FIXTURE_SELECTION } from "./agentsFixture.js";

const amount = { tokens: 10, activeMs: 20, attempts: 1, sessions: 1 };

// Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): every criterion in this
// file reads a protocol-2 start envelope whose claim carries a full agent selection (spec §4.6); the envelope is
// otherwise the one the v1 criteria read.
async function fixture(): Promise<{ root: string; envelope: StartEnvelopeV2 }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "ccloop-control-protocol-")));
  await mkdir(join(root, "input", "checkpoint-1"), { recursive: true });
  return {
    root,
    envelope: {
      protocol: 2,
      claim: {
        groupId: "group-1",
        workItemId: "work-1",
        taskId: "task-1",
        runId: "run-1",
        generation: 1,
        graphVersion: 2,
        targetVersion: 3,
        commandId: "command-1",
        configHash: "a".repeat(64),
        agent: FIXTURE_SELECTION,
        grant: { work: amount, handoff: amount },
        ownerToken: "owner-1",
      },
      contractHash: "b".repeat(64),
      inputCheckpoint: null,
      work: {
        contract: {
          objective: {
            taskId: "task-1",
            goal: "implement the task",
            successCondition: "the task passes",
            nonGoals: [],
          },
          context: {
            repoPath: root,
            targetPaths: ["src"],
            relevantDocs: [],
            buildTestCommands: ["npm test"],
            constraints: [],
          },
          executionPolicy: {
            autonomyLevel: "L2",
            maxAttempts: 2,
            perAttemptTimeoutMs: 1_000,
            totalRuntimeBudgetMs: 2_000,
            tokenBudget: 1_000,
            worktreeRequired: true,
            partialOutcomeRecoveryWindowMs: 100,
          },
          safetyPolicy: {
            allowlistPaths: ["src"],
            denylistPaths: [],
            maxFilesTouched: 10,
            humanGateConditions: [],
          },
          verification: {
            verifierType: "command",
            requiredChecks: ["npm test"],
            rejectOn: ["failure"],
            evidenceRequired: [],
          },
          escalationAndExit: {
            escalationTargets: [],
            pauseOn: [],
            stopOn: [],
            terminalStates: [
              "succeeded",
              "blocked_waiting_human",
              "exhausted",
              "cancelled",
              "failed",
            ],
          },
        },
        targetRepo: root,
        base: "main",
        sourceDir: root,
      },
    },
  };
}

describe("control protocol v1", () => {
  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the strict payload of every
  // method round-trips with a protocol-2 envelope, and capabilities carries a partial selection or null (spec §4.6)
  // where it used to carry an empty object.
  it("round-trips the strict payload for every method", async () => {
    const { envelope } = await fixture();
    const request = {
      protocol: 1 as const,
      requestId: "request-1",
      runId: envelope.claim.runId,
      generation: envelope.claim.generation,
      reason: "budget" as const,
      deadlineAt: "2026-09-19T10:00:00+08:00",
    };
    const ref = { artifactId: "artifact-1", hash: "c".repeat(64) };

    expect(parseControlRequest("capabilities", { agent: null })).toEqual({ agent: null });
    expect(parseControlRequest("capabilities", { agent: { agent: "claude", model: "opus" } })).toEqual({
      agent: { agent: "claude", model: "opus" },
    });
    expect(parseControlRequest("accept", envelope)).toEqual(envelope);
    expect(parseControlRequest("inspect", envelope)).toEqual(envelope);
    expect(parseControlRequest("handoff", { input: envelope, request })).toEqual({ input: envelope, request });
    expect(parseControlRequest("collect", { input: envelope, afterSeq: 0 })).toEqual({ input: envelope, afterSeq: 0 });
    expect(parseControlRequest("read-evidence", { input: envelope, ref })).toEqual({ input: envelope, ref });
  });

  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the retired envelope
  // (protocol 1) and an unknown one (3) are both refused by name, apart from invalid requests; a capabilities request
  // must name its agent field (null for the table view), so `{}` is invalid like any extra key.
  it("names unsupported protocol versions separately from invalid requests", async () => {
    const { envelope } = await fixture();
    expect(() => parseControlRequest("accept", { ...envelope, protocol: 1 })).toThrow(
      "control-protocol-unsupported",
    );
    expect(() => parseControlRequest("accept", { ...envelope, protocol: 3 })).toThrow(
      "control-protocol-unsupported",
    );
    expect(() => parseControlRequest("accept", { ...envelope, extra: true })).toThrow(
      "control-request-invalid",
    );
    expect(() => parseControlRequest("capabilities", { extra: true })).toThrow("control-request-invalid");
    expect(() => parseControlRequest("capabilities", { agent: null, extra: true })).toThrow("control-request-invalid");
    expect(() => parseControlRequest("capabilities", {})).toThrow("control-request-invalid");
  });

  it("rejects unsafe integers, malformed identities, and malformed hashes", async () => {
    const { envelope } = await fixture();
    expect(() =>
      parseControlRequest("accept", {
        ...envelope,
        claim: { ...envelope.claim, generation: Number.MAX_SAFE_INTEGER + 1 },
      }),
    ).toThrow("control-request-invalid");
    expect(() =>
      parseControlRequest("accept", {
        ...envelope,
        claim: { ...envelope.claim, runId: "../run" },
      }),
    ).toThrow("control-request-invalid");
    expect(() => parseControlRequest("accept", { ...envelope, contractHash: "nope" })).toThrow(
      "control-request-invalid",
    );
    expect(() =>
      parseControlRequest("collect", { input: envelope, afterSeq: Number.MAX_SAFE_INTEGER + 1 }),
    ).toThrow("control-request-invalid");
    expect(() =>
      parseControlRequest("read-evidence", {
        input: envelope,
        ref: { artifactId: "artifact-1", hash: "F".repeat(64) },
      }),
    ).toThrow("control-request-invalid");
  });

  it("requires a canonical absolute sourceDir with no symlink ancestor", async () => {
    const { root, envelope } = await fixture();
    expect(() =>
      parseControlRequest("accept", { ...envelope, work: { ...envelope.work, sourceDir: "relative" } }),
    ).toThrow("control-request-invalid");

    const alias = `${root}-alias`;
    await symlink(root, alias);
    expect(() =>
      parseControlRequest("accept", { ...envelope, work: { ...envelope.work, sourceDir: alias } }),
    ).toThrow("control-request-invalid");
  });

  it("keeps an input bundle inside the canonical source input directory", async () => {
    const { root, envelope } = await fixture();
    const outside = await realpath(await mkdtemp(join(tmpdir(), "ccloop-control-outside-")));
    const checkpoint = {
      predecessorRunId: "run-0",
      checkpointId: "checkpoint-1",
      checkpointHash: "d".repeat(64),
      bundlePath: outside,
    };
    expect(() => parseControlRequest("accept", { ...envelope, inputCheckpoint: checkpoint })).toThrow(
      "control-request-invalid",
    );

    const inside = { ...checkpoint, bundlePath: join(root, "input", "checkpoint-1") };
    expect(parseControlRequest("accept", { ...envelope, inputCheckpoint: inside })).toEqual({
      ...envelope,
      inputCheckpoint: inside,
    });
  });

  it("canonicalizes object keys recursively while preserving array order", () => {
    const left = { z: [{ b: 2, a: 1 }, 3], a: { y: true, x: null } };
    const right = { a: { x: null, y: true }, z: [{ a: 1, b: 2 }, 3] };
    const reorderedArray = { ...right, z: [3, { a: 1, b: 2 }] };
    const expected = createHash("sha256")
      .update('{"a":{"x":null,"y":true},"z":[{"a":1,"b":2},3]}')
      .digest("hex");
    expect(canonicalHash(left)).toBe(expected);
    expect(canonicalHash(right)).toBe(expected);
    expect(canonicalHash(reorderedArray)).not.toBe(expected);
  });

  it("derives the control root from the accepted source directory", async () => {
    const { root, envelope } = await fixture();
    expect(controlRoot(envelope)).toBe(join(root, "control"));
  });

  // Agent selection (2026-09-26), spec §4.6: the claim carries the FULL selection (every field, no extra key, a
  // positive safe integer or "agent-default" window, an id-shaped installation); capabilities carries at most a
  // partial one. Model strings are not judged here: the kind's validateSelection names them (spec §7).
  it("requires a full agent selection on the claim and at most a partial one on capabilities", async () => {
    const { envelope } = await fixture();
    const { agent: _agent, ...claimWithoutAgent } = envelope.claim;
    expect(() => parseControlRequest("accept", { ...envelope, claim: claimWithoutAgent })).toThrow(
      "control-request-invalid",
    );
    for (const agent of [
      { agent: "codex", model: "fixture" },
      { ...FIXTURE_SELECTION, extra: true },
      { ...FIXTURE_SELECTION, contextWindow: 0 },
      { ...FIXTURE_SELECTION, contextWindow: "1m" },
      { ...FIXTURE_SELECTION, agent: "../codex" },
    ]) {
      expect(() => parseControlRequest("accept", { ...envelope, claim: { ...envelope.claim, agent } })).toThrow(
        "control-request-invalid",
      );
    }
    expect(parseControlRequest("capabilities", { agent: { contextWindow: 1_000_000 } })).toEqual({
      agent: { contextWindow: 1_000_000 },
    });
    expect(() => parseControlRequest("capabilities", { agent: { agent: "claude", extra: true } })).toThrow(
      "control-request-invalid",
    );
  });
});
```

- [ ] **Step 2b: 跑，确认红**

```bash
./node_modules/.bin/vitest run tests/control/protocol.test.ts > $S/t5-protocol-red.log 2>&1; echo rc=$? >> $S/t5-protocol-red.log
```
Expected：`rc=1`；红 6 条：`round-trips…`、`names unsupported…`、`rejects unsafe integers…`、`requires a canonical absolute sourceDir…`、`keeps an input bundle…`（v2 envelope 被旧码以 `control-protocol-unsupported` 拒）、`requires a full agent selection…`；绿 2 条：`canonicalizes…`、`derives the control root…`。

- [ ] **Step 3: 实现 `src/control/protocol.ts`（整文件替换）**

```ts
import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";
import type { AgentSelectionV1, PartialSelectionV1 } from "../agents/types.js";
import { loopContractSchema, type LoopContract } from "../contract/schema.js";

export type ControlMethodV1 =
  | "capabilities"
  | "accept"
  | "inspect"
  | "handoff"
  | "collect"
  | "read-evidence";

export interface AmountV1 {
  tokens: number;
  activeMs: number;
  attempts: number;
  sessions: number;
}

export interface GrantV1 {
  work: AmountV1;
  handoff: AmountV1;
}

export interface ClaimV2 {
  groupId: string;
  workItemId: string;
  taskId: string | null;
  runId: string;
  generation: number;
  graphVersion: number;
  targetVersion: number;
  commandId: string;
  /** Agent selection (2026-09-26), spec §4.6: the canonical hash of the config `agent` materializes to. */
  configHash: string;
  /** The full selection, descriptor defaults already filled; accept re-materializes it and checks configHash. */
  agent: AgentSelectionV1;
  grant: GrantV1;
  ownerToken: string;
}

export interface ArtifactRefV1 {
  artifactId: string;
  hash: string;
}

export interface InputCheckpointV1 {
  predecessorRunId: string;
  checkpointId: string;
  checkpointHash: string;
  bundlePath: string;
}

export interface StartEnvelopeV2 {
  protocol: 2;
  claim: ClaimV2;
  contractHash: string;
  inputCheckpoint: InputCheckpointV1 | null;
  work: {
    contract: LoopContract;
    targetRepo: string;
    base: string;
    sourceDir: string;
  };
}

export interface HandoffRequestV1 {
  protocol: 1;
  requestId: string;
  runId: string;
  generation: number;
  reason: "budget" | "context" | "human" | "graph-change" | "shutdown";
  deadlineAt: string;
}

/** Agent selection (2026-09-26), spec §4.6: null asks for the table view, a partial selection for one resolution. */
export interface CapabilitiesRequestV3 {
  agent: PartialSelectionV1 | null;
}

export type ControlRequestV1 =
  | { method: "capabilities"; agent: PartialSelectionV1 | null }
  | { method: "accept"; input: StartEnvelopeV2 }
  | { method: "inspect"; input: StartEnvelopeV2 }
  | { method: "handoff"; input: StartEnvelopeV2; request: HandoffRequestV1 }
  | { method: "collect"; input: StartEnvelopeV2; afterSeq: number }
  | { method: "read-evidence"; input: StartEnvelopeV2; ref: ArtifactRefV1 };

export type ControlPayloadV1 =
  | CapabilitiesRequestV3
  | StartEnvelopeV2
  | { input: StartEnvelopeV2; request: HandoffRequestV1 }
  | { input: StartEnvelopeV2; afterSeq: number }
  | { input: StartEnvelopeV2; ref: ArtifactRefV1 };

export class ControlProtocolError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ControlProtocolError";
  }
}

const safeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positiveSafeInteger = safeInteger.refine((value) => value > 0);
export const idSchema = z.string().min(1).max(200).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const amountSchema = z
  .object({
    tokens: safeInteger,
    activeMs: safeInteger,
    attempts: safeInteger,
    sessions: safeInteger,
  })
  .strict();
const grantSchema = z.object({ work: amountSchema, handoff: amountSchema }).strict();
// Agent selection (2026-09-26): wire shapes only. What a model string may be is the kind's validateSelection's
// call (agent-selection-invalid, spec §7), so `model` is any string here. Defined here, not in src/agents/types.ts
// (which re-exports them): types.ts imports idSchema from this module, so importing these back would be a cycle.
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
const claimSchema = z
  .object({
    groupId: idSchema,
    workItemId: idSchema,
    taskId: idSchema.nullable(),
    runId: idSchema,
    generation: positiveSafeInteger,
    graphVersion: safeInteger,
    targetVersion: safeInteger,
    commandId: idSchema,
    configHash: hashSchema,
    agent: agentSelectionSchema,
    grant: grantSchema,
    ownerToken: idSchema,
  })
  .strict();

export const artifactRefSchema = z.object({ artifactId: idSchema, hash: hashSchema }).strict();
const inputCheckpointSchema = z
  .object({
    predecessorRunId: idSchema,
    checkpointId: idSchema,
    checkpointHash: hashSchema,
    bundlePath: z.string().min(1),
  })
  .strict();
const workSchema = z
  .object({
    contract: loopContractSchema,
    targetRepo: z.string().min(1),
    base: z.string().min(1),
    sourceDir: z.string().min(1),
  })
  .strict();
const startEnvelopeSchema = z
  .object({
    protocol: z.literal(2),
    claim: claimSchema,
    contractHash: hashSchema,
    inputCheckpoint: inputCheckpointSchema.nullable(),
    work: workSchema,
  })
  .strict();
export const handoffRequestSchema = z
  .object({
    protocol: z.literal(1),
    requestId: idSchema,
    runId: idSchema,
    generation: positiveSafeInteger,
    reason: z.enum(["budget", "context", "human", "graph-change", "shutdown"]),
    deadlineAt: z.string().datetime({ offset: true }),
  })
  .strict();

const payloadSchemas = {
  capabilities: z.object({ agent: partialSelectionSchema.nullable() }).strict(),
  accept: startEnvelopeSchema,
  inspect: startEnvelopeSchema,
  handoff: z.object({ input: startEnvelopeSchema, request: handoffRequestSchema }).strict(),
  collect: z.object({ input: startEnvelopeSchema, afterSeq: safeInteger }).strict(),
  "read-evidence": z.object({ input: startEnvelopeSchema, ref: artifactRefSchema }).strict(),
} satisfies Record<ControlMethodV1, z.ZodTypeAny>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  const encoded = JSON.stringify(canonicalize(value));
  if (encoded === undefined) throw new ControlProtocolError("control-request-invalid");
  return encoded;
}

export function canonicalHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function isWithin(parent: string, child: string): boolean {
  const difference = relative(parent, child);
  return difference === "" || (!difference.startsWith(`..${sep}`) && difference !== ".." && !isAbsolute(difference));
}

function validateCanonicalDirectory(path: string): string {
  if (!isAbsolute(path)) throw new ControlProtocolError("control-request-invalid");
  try {
    const canonical = realpathSync(path);
    if (canonical !== path || !lstatSync(path).isDirectory()) {
      throw new ControlProtocolError("control-request-invalid");
    }
    return canonical;
  } catch (error) {
    if (error instanceof ControlProtocolError) throw error;
    throw new ControlProtocolError("control-request-invalid");
  }
}

function validateEnvelopePaths(envelope: StartEnvelopeV2): void {
  const sourceDir = validateCanonicalDirectory(envelope.work.sourceDir);
  if (!isAbsolute(envelope.work.targetRepo)) throw new ControlProtocolError("control-request-invalid");
  if (envelope.inputCheckpoint === null) return;
  const bundle = validateCanonicalDirectory(envelope.inputCheckpoint.bundlePath);
  const inputRoot = resolve(sourceDir, "input");
  if (!isWithin(inputRoot, bundle) || bundle === inputRoot) {
    throw new ControlProtocolError("control-request-invalid");
  }
}

function protocolVersion(raw: unknown): unknown {
  if (raw === null || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  if ("protocol" in record) return record.protocol;
  const input = record.input;
  return input !== null && typeof input === "object" ? (input as Record<string, unknown>).protocol : undefined;
}

export function parseControlRequest(method: "capabilities", raw: unknown): CapabilitiesRequestV3;
export function parseControlRequest(method: "accept" | "inspect", raw: unknown): StartEnvelopeV2;
export function parseControlRequest(
  method: "handoff",
  raw: unknown,
): { input: StartEnvelopeV2; request: HandoffRequestV1 };
export function parseControlRequest(method: "collect", raw: unknown): { input: StartEnvelopeV2; afterSeq: number };
export function parseControlRequest(
  method: "read-evidence",
  raw: unknown,
): { input: StartEnvelopeV2; ref: ArtifactRefV1 };
export function parseControlRequest(method: ControlMethodV1, raw: unknown): ControlPayloadV1;
export function parseControlRequest(method: ControlMethodV1, raw: unknown): ControlPayloadV1 {
  const version = protocolVersion(raw);
  // Agent selection (2026-09-26), spec §5: the start envelope is protocol 2; a v1 envelope is refused by name.
  // Handoff requests stay protocol 1 and are nested, so this reads the envelope's number (spec §5 M4).
  if (version !== undefined && version !== 2) {
    throw new ControlProtocolError("control-protocol-unsupported");
  }
  try {
    const payload = payloadSchemas[method].parse(raw) as ControlPayloadV1;
    if (method === "accept" || method === "inspect") validateEnvelopePaths(payload as StartEnvelopeV2);
    if (method === "handoff" || method === "collect" || method === "read-evidence") {
      validateEnvelopePaths((payload as { input: StartEnvelopeV2 }).input);
    }
    return payload;
  } catch (error) {
    if (error instanceof ControlProtocolError) throw error;
    throw new ControlProtocolError("control-request-invalid");
  }
}

export function attachControlMethod(method: ControlMethodV1, payload: ControlPayloadV1): ControlRequestV1 {
  if (method === "capabilities") return { method, agent: (payload as CapabilitiesRequestV3).agent };
  if (method === "accept" || method === "inspect") return { method, input: payload as StartEnvelopeV2 };
  return { method, ...(payload as Record<string, unknown>) } as ControlRequestV1;
}
```

（`contextWindowSchema`／`agentSelectionSchema`／`partialSelectionSchema` 三段与 T1 在 `src/agents/types.ts` 写的逐字同形 —— 实施前把 T1 落地后的那三段与上面三段 `diff` 一次，不同就以 T1 的为准抄进来，并报控制器。）

再改 `src/agents/types.ts`（D-W3-4，断环）：把 T1 写的

```ts
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
```
整段换成

```ts
// Agent selection (2026-09-26), plan T5 D-W3-4: the wire selection schemas live in src/control/protocol.ts (the
// start envelope and the capabilities request are built from them at module load); re-exported here under the same
// names so that this module, which imports idSchema from protocol.ts, never forms an import cycle with it.
export { contextWindowSchema, agentSelectionSchema, partialSelectionSchema } from "../control/protocol.js";
```
（`types.ts` 顶部的 `import { idSchema } from "../control/protocol.js";` 与 `import { z } from "zod";` 若因此在本文件内不再被使用，保留不动 —— tsconfig 未开 `noUnusedLocals`，Rule 3。）

```bash
./node_modules/.bin/vitest run tests/agents > $S/t5-agents-regress.log 2>&1; echo rc=$? >> $S/t5-agents-regress.log
```
Expected：`rc=0`，条数与 T1 落地时相同（读回日志与 T1 的 `t1*-green.log` 汇总行比对）—— 证明转出口不改 T1 的任何行为。

再把其余 src 消费者改名（纯改名，无行为变化）：

```bash
/usr/bin/sed -i '' 's/StartEnvelopeV1/StartEnvelopeV2/g' src/control/handoff.ts src/control/collect.ts src/control/paths.ts src/control/resultRepository.ts
/usr/bin/grep -rn "StartEnvelopeV1\|ClaimV1" src > $S/t5-rename.txt 2>&1; echo rc=$? >> $S/t5-rename.txt
```
Expected：`t5-rename.txt` 只剩 `accept.ts`、`worker.ts` 的命中（Step 6、Step 12 处理）与末行 `rc=0`。

- [ ] **Step 4: 跑，确认绿**

```bash
./node_modules/.bin/vitest run tests/control/protocol.test.ts > $S/t5-protocol-green.log 2>&1; echo rc=$? >> $S/t5-protocol-green.log
```
Expected：`rc=0`，8/8。

- [ ] **Step 5: 改写 `tests/control/accept.test.ts`（整文件替换），并建 `tests/control/agentsControl.test.ts` 的 accept 部分**

`tests/control/accept.test.ts`：

```ts
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { LoopContract } from "../../src/contract/schema.js";
import { resolveAgent } from "../../src/agents/materialize.js";
import { acceptStart, inspectStart } from "../../src/control/accept.js";
import { canonicalHash, canonicalJson, ControlProtocolError, type StartEnvelopeV2 } from "../../src/control/protocol.js";
import { readAccepted, writeAccepted } from "../../src/control/store.js";
import { codexInstallation, writeAgentsTable } from "./agentsFixture.js";

const amount = { tokens: 10, activeMs: 20, attempts: 1, sessions: 1 };
const worker = resolve("node_modules/.bin/tsx");
const workerFixture = resolve("tests/fixtures/control-worker.mjs");

function contract(root: string): LoopContract {
  return {
    objective: { taskId: "task-1", goal: "work", successCondition: "done", nonGoals: [] },
    context: {
      repoPath: root,
      targetPaths: ["src"],
      relevantDocs: [],
      buildTestCommands: ["npm test"],
      constraints: [],
    },
    executionPolicy: {
      autonomyLevel: "L2" as const,
      maxAttempts: 2,
      perAttemptTimeoutMs: 1_000,
      totalRuntimeBudgetMs: 2_000,
      tokenBudget: 1_000,
      worktreeRequired: true as const,
      partialOutcomeRecoveryWindowMs: 100,
    },
    safetyPolicy: {
      allowlistPaths: ["src"],
      denylistPaths: [],
      maxFilesTouched: 10,
      humanGateConditions: [],
    },
    verification: {
      verifierType: "command" as const,
      requiredChecks: ["npm test"],
      rejectOn: ["failure"],
      evidenceRequired: [],
    },
    escalationAndExit: {
      escalationTargets: [],
      pauseOn: [],
      stopOn: [],
      terminalStates: [
        "succeeded",
        "blocked_waiting_human",
        "exhausted",
        "cancelled",
        "failed",
      ],
    },
  };
}

// Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): every criterion below
// accepts through an agents table (one codex installation for the same fake-codex command the v1 fixture named) and a
// protocol-2 envelope whose claim carries the resolved selection and the materialized config's canonical hash.
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "ccloop-control-accept-")));
  await mkdir(join(root, "input"));
  const installation = await codexInstallation({
    command: [process.execPath, resolve("tests/fixtures/fake-codex.mjs"), "success", join(root, "marker")],
    budgetMode: "soft",
    sandbox: "workspace-write",
    timeoutMs: 1_000,
    killGraceMs: 100,
  });
  const { path: tablePath, table } = await writeAgentsTable({ codex: installation }, root);
  const { config, resolution } = await resolveAgent(table, { agent: "codex", model: "fixture" });
  const envelope: StartEnvelopeV2 = {
    protocol: 2,
    claim: {
      groupId: "group-1",
      workItemId: "work-1",
      taskId: "task-1",
      runId: "run-1",
      generation: 1,
      graphVersion: 1,
      targetVersion: 1,
      commandId: "command-1",
      configHash: resolution.configHash,
      agent: resolution.selection,
      grant: { work: amount, handoff: amount },
      ownerToken: "owner-1",
    },
    contractHash: "b".repeat(64),
    inputCheckpoint: null,
    work: { contract: contract(root), targetRepo: root, base: "main", sourceDir: root },
  };
  return { root, tablePath, config, envelope, launchFile: join(root, "agent-launches") };
}

function binding(tablePath: string, launchFile: string) {
  return {
    agentsTablePath: tablePath,
    workerCommand: [worker, workerFixture],
    workerEnv: { CCLOOP_CONTROL_LAUNCH_FILE: launchFile },
    receiptTimeoutMs: 2_000,
  };
}

async function launchRows(path: string): Promise<string[]> {
  try {
    return (await readFile(path, "utf8")).trim().split("\n").filter(Boolean);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

describe("durable control acceptance", () => {
  it("persists accepted before one exclusive worker claim and replays idempotently", async () => {
    const f = await fixture();
    const first = await acceptStart(f.envelope, binding(f.tablePath, f.launchFile));
    const second = await acceptStart(f.envelope, binding(f.tablePath, f.launchFile));
    expect(first.kind).toBe("accepted");
    expect(second).toEqual(first);
    await expect.poll(() => launchRows(f.launchFile)).toEqual(["launch"]);
    expect(["claimed", "sealed"]).toContain((await readAccepted(f.root)).launch);
  });

  it("serializes concurrent identical accepts into one durable launch", async () => {
    const f = await fixture();
    const [left, right] = await Promise.all([
      acceptStart(f.envelope, binding(f.tablePath, f.launchFile)),
      acceptStart(f.envelope, binding(f.tablePath, f.launchFile)),
    ]);
    expect([left.kind, right.kind]).toContain("accepted");
    expect([left.kind, right.kind].every((kind) => kind === "accepted" || kind === "unknown")).toBe(true);
    await expect.poll(() => launchRows(f.launchFile)).toEqual(["launch"]);
  });

  it("refuses the same identity with a different envelope", async () => {
    const f = await fixture();
    await acceptStart(f.envelope, binding(f.tablePath, f.launchFile));
    const changed = { ...f.envelope, contractHash: "c".repeat(64) };
    await expect(acceptStart(changed, binding(f.tablePath, f.launchFile))).rejects.toMatchObject({
      code: "control-envelope-conflict",
    });
  });

  it("recovers a dropped accept response through inspect without another worker", async () => {
    const f = await fixture();
    await acceptStart(f.envelope, binding(f.tablePath, f.launchFile));
    const recovered = await inspectStart(f.envelope);
    expect(recovered.kind).toBe("accepted");
    await expect.poll(() => launchRows(f.launchFile)).toHaveLength(1);
  });

  it("keeps an intended crash ambiguous and never launches a replacement", async () => {
    const f = await fixture();
    await writeAccepted(f.root, {
      protocol: 1,
      envelopeHash: canonicalHash(f.envelope),
      executionId: "execution-1",
      configHash: f.envelope.claim.configHash,
      generation: 1,
      acceptedAt: new Date().toISOString(),
      launch: "intended",
      worker: null,
    });
    expect(await inspectStart(f.envelope)).toEqual({ kind: "unknown" });
    expect(await acceptStart(f.envelope, binding(f.tablePath, f.launchFile))).toEqual({ kind: "unknown" });
    await expect(readFile(f.launchFile, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): what accept seals is the
  // materialized agent config (installation plus filled selection), byte-for-byte its canonical JSON; rewriting the
  // table afterwards changes neither a replayed accept nor the sealed bytes (the replay never reads the table).
  it("seals the materialized agent config so later table drift has no effect", async () => {
    const f = await fixture();
    await acceptStart(f.envelope, binding(f.tablePath, f.launchFile));
    const sealed = await readFile(join(f.root, "control", "config.json"), "utf8");
    expect(sealed).toBe(`${canonicalJson(f.config)}\n`);
    await writeFile(f.tablePath, "{}\n");
    expect(await acceptStart(f.envelope, binding(f.tablePath, f.launchFile))).toMatchObject({ kind: "accepted" });
    expect(await readFile(join(f.root, "control", "config.json"), "utf8")).toBe(sealed);
  });

  it("rejects a claim config hash mismatch before creating a worker", async () => {
    const f = await fixture();
    const bad = { ...f.envelope, claim: { ...f.envelope.claim, configHash: "d".repeat(64) } };
    await expect(acceptStart(bad, binding(f.tablePath, f.launchFile))).rejects.toBeInstanceOf(
      ControlProtocolError,
    );
    await expect(readFile(f.launchFile, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
```

`tests/control/agentsControl.test.ts`（新建；本步先写完整文件，后面各组实现各自让一部分转绿）：

```ts
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import type { LoopContract } from "../../src/contract/schema.js";
import { resolveAgent } from "../../src/agents/materialize.js";
import { acceptStart } from "../../src/control/accept.js";
import { collectExecution } from "../../src/control/collect.js";
import { runControlCommand } from "../../src/control/command.js";
import { requestHandoff } from "../../src/control/handoff.js";
import { atomicReplacePrivateFile, ensurePrivateDirectory } from "../../src/control/paths.js";
import { canonicalHash, canonicalJson } from "../../src/control/protocol.js";
import { proveStopped, type StopProofRecord } from "../../src/control/stopProof.js";
import { readAcceptedOptional, writeAccepted } from "../../src/control/store.js";
import { runControlWorker } from "../../src/control/worker.js";
import {
  FAKE_CLAUDE_CLI,
  FAKE_CODEX,
  claudeInstallation,
  codexInstallation,
  controlContract,
  sealCodex,
  startEnvelope,
  writeAgentsTable,
} from "./agentsFixture.js";

// Agent selection (2026-09-26), spec §4.2, §4.5, §4.6, §9 criteria 5c, 5d and 6: control runs over an installation
// table. Additive criteria; the rewritten v1 criteria live in their own files.
const workerCommand = [resolve("node_modules/.bin/tsx"), resolve("tests/fixtures/control-worker.mjs")];
const execFileAsync = promisify(execFile);

async function sourceRoot(prefix: string): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  await mkdir(join(dir, "input"));
  return dir;
}

async function launches(path: string): Promise<string[]> {
  try {
    return (await readFile(path, "utf8")).trim().split("\n").filter(Boolean);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function twoAgentTable(dir: string) {
  const script = join(dir, "script.json");
  await writeFile(script, "{}\n", { mode: 0o600 });
  return await writeAgentsTable({
    claude: await claudeInstallation([process.execPath, FAKE_CLAUDE_CLI, "script", join(dir, "claude-marker"), script]),
    codex: await codexInstallation({
      command: [process.execPath, FAKE_CODEX, "integration", join(dir, "codex-marker")],
      sandbox: "workspace-write",
      budgetMode: "soft",
      timeoutMs: 1_000,
      killGraceMs: 100,
    }),
  }, dir);
}

async function acceptFixture() {
  const dir = await sourceRoot("ccloop-agents-accept-");
  const { path, table } = await twoAgentTable(dir);
  const { config, resolution } = await resolveAgent(table, { agent: "codex", model: "fixture" });
  const envelope = startEnvelope({
    sourceDir: dir,
    targetRepo: dir,
    contract: controlContract(dir),
    agent: resolution.selection,
    configHash: resolution.configHash,
  });
  return { dir, path, table, config, envelope, launchFile: join(dir, "agent-launches") };
}

function binding(path: string, launchFile: string) {
  return { agentsTablePath: path, workerCommand, workerEnv: { CCLOOP_CONTROL_LAUNCH_FILE: launchFile }, receiptTimeoutMs: 2_000 };
}

/** A named rejection (D-W3-2): exit 2, nothing on stdout, stderr one line whose first token is the code. */
function expectNamed(result: { code: number; stdout: string; stderr: string }, code: string): void {
  expect(result.code, result.stderr).toBe(2);
  expect(result.stdout).toBe("");
  expect(result.stderr).toMatch(new RegExp(`^${code}(: [^\\n]*)?\\n$`));
}

describe("control over the installation table (agent selection)", { timeout: 30_000 }, () => {
  it("answers capabilities for a selection with descriptor defaults filled, given fields echoed, and the materialized config's hash", async () => {
    const dir = await sourceRoot("ccloop-agents-capabilities-");
    const { path, table } = await twoAgentTable(dir);

    const claude = await runControlCommand(["capabilities", "--agents", path], JSON.stringify({ agent: { agent: "claude", model: "opus" } }));
    expect(claude.code, claude.stderr).toBe(0);
    const claudeAnswer = JSON.parse(claude.stdout);
    const claudeSelection = { agent: "claude", model: "opus", contextWindow: "agent-default" };
    expect(claudeAnswer.selection).toEqual(claudeSelection);
    expect(claudeAnswer).toMatchObject({
      protocol: 3,
      configHash: canonicalHash({ schema: "ccloop-agent-config-v1", kind: "claude", installation: table.installations.claude, selection: claudeSelection }),
      timeoutMs: table.installations.claude!.timeoutMs,
      killGraceMs: table.installations.claude!.killGraceMs,
      capabilities: { contextWindowTokens: null },
    });

    const codex = await runControlCommand(["capabilities", "--agents", path], JSON.stringify({ agent: { agent: "codex" } }));
    expect(codex.code, codex.stderr).toBe(0);
    const codexAnswer = JSON.parse(codex.stdout);
    const codexSelection = { agent: "codex", model: "gpt-6-sol", contextWindow: "agent-default" };
    expect(codexAnswer.selection).toEqual(codexSelection);
    expect(codexAnswer).toMatchObject({
      protocol: 3,
      configHash: canonicalHash({ schema: "ccloop-agent-config-v1", kind: "codex", installation: table.installations.codex, selection: codexSelection }),
      timeoutMs: 1_000,
      killGraceMs: 100,
    });
  });

  it("names a missing installation, a drifted CLI version, and an unsafe table with exit 2 and the code first", async () => {
    const dir = await sourceRoot("ccloop-agents-errors-");
    const { path, table } = await twoAgentTable(dir);
    expectNamed(await runControlCommand(["capabilities", "--agents", path], JSON.stringify({ agent: { agent: "missing" } })), "agent-installation-missing");

    expect(table.installations.claude!.version).not.toBe("0.0.0-stale");
    const drifted = await writeAgentsTable({ claude: { ...table.installations.claude!, version: "0.0.0-stale" } });
    expectNamed(await runControlCommand(["capabilities", "--agents", drifted.path], JSON.stringify({ agent: { agent: "claude" } })), "agent-version-drift");

    await chmod(path, 0o660);
    expectNamed(await runControlCommand(["capabilities", "--agents", path], JSON.stringify({ agent: null })), "agents-table-invalid");
  });

  it("refuses the retired --adapter forms for every control method", async () => {
    const dir = await sourceRoot("ccloop-agents-retired-");
    const { path } = await twoAgentTable(dir);
    for (const method of ["capabilities", "accept", "inspect", "handoff", "collect", "read-evidence"]) {
      for (const argv of [[method, "--adapter", "codex", "--adapter-config", path], [method, "--adapter-config", path]]) {
        expect(await runControlCommand(argv, JSON.stringify({ agent: null }))).toEqual({
          code: 1, stdout: "", stderr: "control-command-invalid\n",
        });
      }
    }
  });

  it("reads the table only for capabilities and accept: a table broken after accept blocks neither inspect nor collect", async () => {
    const f = await acceptFixture();
    expect((await acceptStart(f.envelope, binding(f.path, f.launchFile))).kind).toBe("accepted");
    await expect.poll(() => launches(f.launchFile)).toEqual(["launch"]);
    await writeFile(f.path, "not json\n");
    expectNamed(await runControlCommand(["capabilities", "--agents", f.path], JSON.stringify({ agent: null })), "agents-table-invalid");
    const inspected = await runControlCommand(["inspect", "--agents", f.path], JSON.stringify(f.envelope));
    expect(inspected.code, inspected.stderr).toBe(0);
    expect(JSON.parse(inspected.stdout)).toMatchObject({ kind: "accepted" });
    const collected = await runControlCommand(["collect", "--agents", f.path], JSON.stringify({ input: f.envelope, afterSeq: 0 }));
    expect(collected.code, collected.stderr).toBe(0);
    expect(JSON.parse(collected.stdout)).toEqual({ events: [], candidate: null, terminal: null });
  });
});

describe("accept under the installation table (agent selection)", { timeout: 30_000 }, () => {
  it("seals the materialized agent config whose canonical hash the claim carries", async () => {
    const f = await acceptFixture();
    await acceptStart(f.envelope, binding(f.path, f.launchFile));
    const sealed = await readFile(join(f.dir, "control", "config.json"), "utf8");
    expect(sealed).toBe(`${canonicalJson(f.config)}\n`);
    expect(JSON.parse(sealed)).toEqual({
      schema: "ccloop-agent-config-v1",
      kind: "codex",
      installation: f.table.installations.codex,
      selection: f.envelope.claim.agent,
    });
    expect(canonicalHash(JSON.parse(sealed))).toBe(f.envelope.claim.configHash);
  });

  it("refuses a claim whose selection changed after its configHash was taken, before any worker", async () => {
    const f = await acceptFixture();
    const changed = { ...f.envelope, claim: { ...f.envelope.claim, agent: { ...f.envelope.claim.agent, model: "fixture-2" } } };
    await expect(acceptStart(changed, binding(f.path, f.launchFile))).rejects.toMatchObject({ code: "control-config-hash-mismatch" });
    expect(await readAcceptedOptional(f.dir)).toBeNull();
    expect(await launches(f.launchFile)).toEqual([]);
  });

  it("refuses a CLI whose --version drifted from the table, before anything is persisted", async () => {
    const f = await acceptFixture();
    expect(f.table.installations.codex!.version).not.toBe("0.0.0-stale");
    const drifted = await writeAgentsTable({ ...f.table.installations, codex: { ...f.table.installations.codex!, version: "0.0.0-stale" } });
    await expect(acceptStart(f.envelope, binding(drifted.path, f.launchFile))).rejects.toMatchObject({ code: "agent-version-drift" });
    expect(await readAcceptedOptional(f.dir)).toBeNull();
    expect(await launches(f.launchFile)).toEqual([]);
  });
});

describe("worker adapter from the sealed config (agent selection)", { timeout: 30_000 }, () => {
  it("refuses a sealed config whose schema or kind does not hold, before any phase", async () => {
    for (const corrupt of [
      (config: Record<string, unknown>) => ({ ...config, schema: "ccloop-agent-config-v0" }),
      (config: Record<string, unknown>) => ({ ...config, kind: "claude" }),
    ]) {
      const dir = await sourceRoot("ccloop-agents-worker-");
      const sealed = await sealCodex({
        command: [process.execPath, FAKE_CODEX, "integration", join(dir, "codex-marker")],
        model: "fixture",
        budgetMode: "soft",
        sandbox: "workspace-write",
        timeoutMs: 1_000,
        killGraceMs: 100,
      });
      const envelope = startEnvelope({ sourceDir: dir, targetRepo: dir, contract: controlContract(dir), agent: sealed.selection, configHash: sealed.configHash });
      const controlDir = join(dir, "control");
      await ensurePrivateDirectory(dir, controlDir);
      await atomicReplacePrivateFile(dir, join(controlDir, "config.json"), Buffer.from(canonicalJson(corrupt(sealed.config as unknown as Record<string, unknown>))));
      await atomicReplacePrivateFile(dir, join(controlDir, "envelope.json"), Buffer.from(canonicalJson(envelope)));
      await writeAccepted(dir, {
        protocol: 1, envelopeHash: canonicalHash(envelope), executionId: "execution-1", configHash: sealed.configHash,
        generation: 1, acceptedAt: new Date().toISOString(), launch: "intended", worker: null,
      });
      await expect(runControlWorker(["--source-dir", dir, "--execution-id", "execution-1", "--nonce", "nonce-1"])).rejects.toMatchObject({ code: "agent-config-invalid" });
      expect(JSON.parse(await readFile(join(controlDir, "worker-error.json"), "utf8")).message).toMatch(/^agent-config-invalid(: |$)/);
      await expect(readFile(join(dir, "codex-marker"))).rejects.toMatchObject({ code: "ENOENT" });
    }
  });
});

// Controller ruling (2026-09-26, from W2): the ClaudeAgentAdapter's own registration criterion does not reach the
// worker, so prove it here: a control worker running a claude installation registers the phase's process group, and
// that registration decides the stop proof. A live worker's proof is already null for other reasons (unsealed worker,
// affirmed lease), so the registrations are judged in a probe directory where everything else would allow a proof.
describe("claude process registration through the control worker (agent selection)", { timeout: 60_000 }, () => {
  it("registers the claude phase's process group in processes.json, and that record proves nothing while the group lives", async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "ccloop-agents-claude-worker-")));
    const repo = join(dir, "target"), sourceDir = join(dir, "source"), marker = join(dir, "claude-marker"), script = join(dir, "script.json");
    await mkdir(repo);
    await mkdir(join(sourceDir, "input"), { recursive: true });
    for (const args of [["init", "-q"], ["config", "user.name", "Test"], ["config", "user.email", "test@example.invalid"]]) await execFileAsync("git", args, { cwd: repo });
    await writeFile(join(repo, "answer.txt"), "0\n");
    await execFileAsync("git", ["add", "."], { cwd: repo });
    await execFileAsync("git", ["commit", "-qm", "base"], { cwd: repo });
    await writeFile(script, JSON.stringify({ "task-1": { files: { "answer.txt": "42\n" }, delayMs: { plan: 30_000 } } }), { mode: 0o600 });
    const { table } = await writeAgentsTable({
      claude: await claudeInstallation([process.execPath, FAKE_CLAUDE_CLI, "script", marker, script], { timeoutMs: 60_000, killGraceMs: 50 }),
    }, dir);
    const { config, resolution } = await resolveAgent(table, { agent: "claude" });
    const contract: LoopContract = {
      objective: { taskId: "task-1", goal: "Set answer.txt to 42", successCondition: "answer is 42", nonGoals: [] },
      context: { repoPath: repo, targetPaths: ["answer.txt"], relevantDocs: [], buildTestCommands: ["true"], constraints: [] },
      executionPolicy: { autonomyLevel: "L2", maxAttempts: 1, perAttemptTimeoutMs: 60_000, totalRuntimeBudgetMs: 120_000, tokenBudget: 1_000, worktreeRequired: true, partialOutcomeRecoveryWindowMs: 100 },
      safetyPolicy: { allowlistPaths: ["answer.txt"], denylistPaths: [], maxFilesTouched: 2, humanGateConditions: [] },
      verification: { verifierType: "agent", requiredChecks: ["true"], rejectOn: ["failure"], evidenceRequired: [] },
      escalationAndExit: { escalationTargets: [], pauseOn: [], stopOn: [], terminalStates: ["succeeded", "blocked_waiting_human", "exhausted", "cancelled", "failed"] },
    };
    const envelope = startEnvelope({ sourceDir, targetRepo: repo, contract, agent: resolution.selection, configHash: resolution.configHash });
    const controlDir = join(sourceDir, "control");
    await ensurePrivateDirectory(sourceDir, controlDir);
    await atomicReplacePrivateFile(sourceDir, join(controlDir, "config.json"), Buffer.from(canonicalJson(config)));
    await atomicReplacePrivateFile(sourceDir, join(controlDir, "envelope.json"), Buffer.from(canonicalJson(envelope)));
    await writeAccepted(sourceDir, {
      protocol: 1, envelopeHash: canonicalHash(envelope), executionId: "execution-1", configHash: resolution.configHash,
      generation: 1, acceptedAt: new Date().toISOString(), launch: "intended", worker: null,
    });

    const worker = runControlWorker(["--source-dir", sourceDir, "--execution-id", "execution-1", "--nonce", "nonce-1"]);
    let registered: Array<{ pid: number; pgid: number }> = [];
    await expect.poll(async () => {
      try { registered = JSON.parse(await readFile(join(controlDir, "processes.json"), "utf8")); } catch { registered = []; }
      return registered.length;
    }, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
    expect(registered[0]).toMatchObject({ phase: "plan" });
    expect(() => process.kill(-registered[0]!.pgid, 0)).not.toThrow();

    const probe = await realpath(await mkdtemp(join(tmpdir(), "ccloop-agents-claude-probe-")));
    await mkdir(join(probe, "control"));
    await mkdir(join(probe, "run"));
    await writeFile(join(probe, "run", "owner-record.json"), JSON.stringify({
      runId: "task-1", logicalSessionId: "session-1", currentOwnerEpoch: 1, currentProcessInstanceId: "process-1",
      lastAffirmedAt: new Date().toISOString(), ownerStatus: "current", supersededByEpoch: null, leaseAffirmedAt: null,
    }));
    await writeFile(join(probe, "control", "processes.json"), JSON.stringify(registered));
    const record: StopProofRecord = {
      sourceDir: probe,
      accepted: {
        protocol: 1, envelopeHash: "a".repeat(64), executionId: "execution-1", configHash: "b".repeat(64), generation: 1,
        acceptedAt: new Date().toISOString(), launch: "sealed", worker: { pid: process.pid, startedAt: new Date().toISOString(), nonce: "nonce-1" },
      },
    };
    expect(await proveStopped(record, { graceMs: 20 })).toBeNull();

    expect(await requestHandoff(envelope, {
      protocol: 1, requestId: "request-1", runId: "run-1", generation: 1, reason: "shutdown", deadlineAt: new Date(Date.now() + 150).toISOString(),
    })).toEqual({ kind: "latched", requestId: "request-1" });
    await worker;
    expect(await proveStopped(record, { graceMs: 20 })).toMatchObject({ executionId: "execution-1", isolated: true });
    expect((await collectExecution(envelope, 0)).candidate?.stopProof).toMatchObject({ isolated: true });
  });
});
```

（这条的「红」由两处看得见：Step 11 的旧 worker 读不了物化配置 ⇒ `processes.json` 等不到一条；变异 M16 删掉 worker 给 `runLoop` 的 `onProcessRegistered` 接线 ⇒ 同样等不到一条。「组活着 ⇒ null」与「组没了 ⇒ 证明」用**同一个**探针目录先后各断一次，所以 null 只能来自进程组还活着，不是空洞的。）

- [ ] **Step 5b: 跑 accept 相关，确认红**

```bash
./node_modules/.bin/vitest run tests/control/accept.test.ts > $S/t5-accept-red.log 2>&1; echo rc=$? >> $S/t5-accept-red.log
./node_modules/.bin/vitest run tests/control/agentsControl.test.ts -t "accept under the installation table" > $S/t5-agents-accept-red.log 2>&1; echo rc=$? >> $S/t5-agents-accept-red.log
```
Expected：accept.test `rc=1`，红 6 条（除 `keeps an intended crash ambiguous…` 外全红：旧 `acceptStart` 读 `adapterBinding.adapterConfigPath`＝`undefined`）；agentsControl 该 describe 3 条全红。

- [ ] **Step 6: 实现 `src/control/accept.ts`（整文件替换）**

```ts
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { resolveAgent } from "../agents/materialize.js";
import { readAgentsTable } from "../agents/table.js";
import { atomicReplacePrivateFile, ensurePrivateDirectory } from "./paths.js";
import {
  canonicalHash,
  canonicalJson,
  ControlProtocolError,
  type StartEnvelopeV2,
} from "./protocol.js";
import { launchWorker, workerIdentityMatches, type WorkerLaunchDeps } from "./workerLauncher.js";
import {
  markAcceptedUnknown,
  readAccepted,
  readAcceptedOptional,
  withAcceptedLock,
  writeAccepted,
  type AcceptedRecordV1,
} from "./store.js";
import { testCrashPoint } from "./testCrashPoint.js";

export type ExecutionStatusV1 =
  | { kind: "absent" }
  | { kind: "accepted"; executionId: string; configHash: string }
  | { kind: "unknown" }
  | {
      kind: "stopped";
      proof: {
        executionId: string;
        generation: number;
        isolated: true;
        source: { artifactId: string; hash: string };
      };
    };

export interface AgentBindingV1 {
  agentsTablePath: string;
  workerCommand?: string[];
  workerEnv?: Record<string, string>;
  receiptTimeoutMs?: number;
}

async function status(record: AcceptedRecordV1): Promise<ExecutionStatusV1> {
  if (record.launch === "intended" || record.launch === "unknown") return { kind: "unknown" };
  if (record.launch === "claimed" && !(await workerIdentityMatches(record.worker))) return { kind: "unknown" };
  return { kind: "accepted", executionId: record.executionId, configHash: record.configHash };
}

function assertEnvelope(record: AcceptedRecordV1, input: StartEnvelopeV2): void {
  if (record.envelopeHash !== canonicalHash(input)) {
    throw new ControlProtocolError("control-envelope-conflict");
  }
}

export async function inspectStart(input: StartEnvelopeV2): Promise<ExecutionStatusV1> {
  const record = await readAcceptedOptional(input.work.sourceDir);
  if (record === null) return { kind: "absent" };
  assertEnvelope(record, input);
  return await status(record);
}

export async function acceptStart(
  input: StartEnvelopeV2,
  binding: AgentBindingV1,
): Promise<ExecutionStatusV1> {
  const existing = await readAcceptedOptional(input.work.sourceDir);
  if (existing !== null) {
    assertEnvelope(existing, input);
    return await status(existing);
  }

  // Agent selection (2026-09-26), spec §4.6: materialize the claimed selection against the table (which also runs
  // `<command> --version` against the recorded version: agent-version-drift); the claim's configHash must be the
  // materialized config's canonical hash. A replayed accept above never reads the table (spec §4.2, I4).
  const table = await readAgentsTable(binding.agentsTablePath);
  const { config, resolution } = await resolveAgent(table, input.claim.agent);
  const configHash = resolution.configHash;
  if (configHash !== input.claim.configHash) {
    throw new ControlProtocolError("control-config-hash-mismatch");
  }

  const proposed: AcceptedRecordV1 = {
    protocol: 1,
    envelopeHash: canonicalHash(input),
    executionId: `execution-${randomUUID()}`,
    configHash,
    generation: input.claim.generation,
    acceptedAt: new Date().toISOString(),
    launch: "intended",
    worker: null,
  };
  const prepared = await withAcceptedLock(input.work.sourceDir, async () => {
    const raced = await readAcceptedOptional(input.work.sourceDir);
    if (raced !== null) return { created: false as const, record: raced };
    const controlDir = join(input.work.sourceDir, "control");
    await ensurePrivateDirectory(input.work.sourceDir, controlDir);
    await atomicReplacePrivateFile(
      input.work.sourceDir,
      join(controlDir, "config.json"),
      Buffer.from(`${canonicalJson(config)}\n`),
    );
    await atomicReplacePrivateFile(
      input.work.sourceDir,
      join(controlDir, "envelope.json"),
      Buffer.from(`${canonicalJson(input)}\n`),
    );
    await writeAccepted(input.work.sourceDir, proposed);
    return { created: true as const, record: proposed };
  });
  if (!prepared.created) {
    assertEnvelope(prepared.record, input);
    return await status(prepared.record);
  }
  const record = prepared.record;
  await testCrashPoint("accepted-fsynced");

  const defaultWorker = [process.execPath, fileURLToPath(new URL("./worker.js", import.meta.url))];
  const launchDeps: WorkerLaunchDeps = {
    sourceDir: input.work.sourceDir,
    workerCommand: binding.workerCommand ?? defaultWorker,
    workerEnv: binding.workerEnv,
    receiptTimeoutMs: binding.receiptTimeoutMs,
  };
  try {
    await launchWorker(record, launchDeps);
  } catch {
    await markAcceptedUnknown(input.work.sourceDir, record.executionId).catch(() => undefined);
    return { kind: "unknown" };
  }
  return await inspectStart(input);
}
```

（与旧文件的差：删 `constants`／`open`／`parseCodexConfig` import 与 `readConfig`；`AdapterBindingV1`→`AgentBindingV1`；`:91-92` 两行换成读表＋`resolveAgent`；其余逐字相同，含未使用的 `readAccepted` import —— 不顺手清理，Rule 3。）

- [ ] **Step 7: 跑，确认 accept 转绿**

```bash
./node_modules/.bin/vitest run tests/control/accept.test.ts > $S/t5-accept-green.log 2>&1; echo rc=$? >> $S/t5-accept-green.log
./node_modules/.bin/vitest run tests/control/agentsControl.test.ts -t "accept under the installation table" > $S/t5-agents-accept-green.log 2>&1; echo rc=$? >> $S/t5-agents-accept-green.log
```
Expected：两者 `rc=0`（7/7；3/3，其余被 `-t` 跳过 —— 读回日志核 `skipped` 数为 6，正是另三个 describe 的 4＋1＋1 条）。

- [ ] **Step 8: 改写 `tests/control/command.test.ts`（整文件替换），跑确认红**

```ts
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentsTableV1 } from "../../src/agents/types.js";
import { runControlCommand } from "../../src/control/command.js";
import {
  atomicReplacePrivateFile,
  ensurePrivateDirectory,
  readPrivateFile,
} from "../../src/control/paths.js";
import { FAKE_CLAUDE_CLI, FAKE_CODEX, claudeInstallation, codexInstallation, writeAgentsTable } from "./agentsFixture.js";

const cliPath = resolve("src/cli.ts");
const tsxPath = resolve("node_modules/.bin/tsx");

async function runCli(args: string[], input: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(tsxPath, [cliPath, ...args], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.stdin.end(input);
  const code = await new Promise<number | null>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("close", resolveExit);
  });
  return { code, stdout, stderr };
}

// Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the criteria of the
// boundary describe below run `control <method> --agents <table>` against a two-installation table (fake claude CLI,
// fake codex) instead of `--adapter codex --adapter-config <file>` (spec §4.5).
async function tableFixture(): Promise<{ root: string; path: string; table: AgentsTableV1 }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "ccloop-control-command-")));
  const script = join(root, "script.json");
  await writeFile(script, "{}\n", { mode: 0o600 });
  const { path, table } = await writeAgentsTable({
    claude: await claudeInstallation([process.execPath, FAKE_CLAUDE_CLI, "script", join(root, "claude-marker"), script]),
    codex: await codexInstallation({
      command: [process.execPath, FAKE_CODEX, "integration", join(root, "codex-marker")],
      sandbox: "workspace-write",
      budgetMode: "soft",
      timeoutMs: 1_000,
      killGraceMs: 100,
    }),
  }, root);
  return { root, path, table };
}

describe("control command boundary", () => {
  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): a relative agents table is
  // refused before dispatch as a named rejection (exit 2, D-W3-2) whose stderr starts with the table's own code, with
  // nothing on stdout.
  it("rejects a relative agents table before dispatch", async () => {
    const result = await runControlCommand(["capabilities", "--agents", "relative.json"], JSON.stringify({ agent: null }));
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^agents-table-invalid(: .*)?\n$/);
  });

  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the retired protocol-1
  // envelope is a named protocol rejection (exit 2) with nothing on stdout.
  it("maps named protocol rejections to exit 2 without contaminating stdout", async () => {
    const { path } = await tableFixture();
    const result = await runControlCommand(["accept", "--agents", path], JSON.stringify({ protocol: 1 }));
    expect(result).toEqual({ code: 2, stdout: "", stderr: "control-protocol-unsupported\n" });
  });

  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): malformed JSON and a
  // handler failure that is no named rejection both exit 1 with nothing on stdout, under the --agents form.
  it("maps malformed JSON and non-protocol failures to exit 1", async () => {
    const { path } = await tableFixture();
    const malformed = await runControlCommand(["capabilities", "--agents", path], "{");
    expect(malformed.code).toBe(1);
    expect(malformed.stdout).toBe("");

    const failed = await runControlCommand(
      ["capabilities", "--agents", path],
      JSON.stringify({ agent: null }),
      { handle: async () => Promise.reject(new Error("boom")) },
    );
    expect(failed).toEqual({ code: 1, stdout: "", stderr: "boom\n" });
  });

  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): nothing is printed unless
  // the handler's answer passes the protocol-3 capabilities schema; the retired v2 eight-field answer is refused as
  // well as an arbitrary one.
  it("does not print until a handler result passes the response schema", async () => {
    const { path } = await tableFixture();
    for (const answer of [
      { protocol: 1, durableAccept: "yes" },
      {
        protocol: 2,
        usageObservation: "phase-end",
        budgetEnforcement: "soft",
        contextObservation: "unavailable",
        handoffControl: "durable",
        handoffExecution: "mechanical-in-run-v1",
        contextWindowTokens: null,
        requestBoundProof: null,
      },
    ]) {
      const result = await runControlCommand(
        ["capabilities", "--agents", path],
        JSON.stringify({ agent: null }),
        { handle: async () => answer },
      );
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("control-response-invalid");
    }
  });

  // This criterion was rewritten in place under human authorization (2026-09-24,
  // "task 1 3 5 6 都同意授权") to assert the v2 eight-field capability vocabulary
  // instead of the v1 seven-field one. See ccloop/CLAUDE.md Rule 15 and
  // docs/superpowers/specs/2026-09-24-g1-control-wire-contract-design.md §5.1.
  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the real CLI routes
  // `control capabilities --agents <table>` with `{agent:null}` before legacy parsing and prints exactly one JSON
  // value, the protocol-3 table view: one row per installation, sorted by id, with its kind's descriptor defaults,
  // expressible context windows, and the table's recorded version.
  it("routes the real CLI through control before legacy parsing and emits one JSON value", async () => {
    const { path, table } = await tableFixture();
    const result = await runCli(["control", "capabilities", "--agents", path], `${JSON.stringify({ agent: null })}\n`);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      protocol: 3,
      installations: [
        {
          id: "claude",
          kind: "claude",
          defaults: { model: "claude-opus-5-5", contextWindow: "agent-default" },
          contextOptions: ["agent-default", 1_000_000],
          version: table.installations.claude!.version,
        },
        {
          id: "codex",
          kind: "codex",
          defaults: { model: "gpt-6-sol", contextWindow: "agent-default" },
          contextOptions: ["agent-default"],
          version: table.installations.codex!.version,
        },
      ],
    });
    expect(result.stdout.trim().split("\n")).toHaveLength(1);
  });
});

describe("private control paths", () => {
  it("creates new private directories and atomically replaces private files", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "ccloop-control-paths-")));
    const nested = join(root, "control", "events");
    const file = join(nested, "event.json");
    await ensurePrivateDirectory(root, nested);
    await atomicReplacePrivateFile(root, file, Buffer.from("first"));
    await atomicReplacePrivateFile(root, file, Buffer.from("second"));
    expect((await lstat(nested)).mode & 0o777).toBe(0o700);
    expect((await lstat(file)).mode & 0o777).toBe(0o600);
    expect((await readPrivateFile(root, file)).toString()).toBe("second");
  });

  it("rejects symlink ancestors and leaf symlinks without chmodding existing user paths", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "ccloop-control-paths-")));
    await mkdir(join(root, "existing"), { mode: 0o755 });
    const outside = await realpath(await mkdtemp(join(tmpdir(), "ccloop-control-target-")));
    await symlink(outside, join(root, "linked"));
    await expect(ensurePrivateDirectory(root, join(root, "linked", "child"))).rejects.toThrow(
      "control-path-invalid",
    );
    expect((await lstat(join(root, "existing"))).mode & 0o777).toBe(0o755);

    const target = join(root, "target");
    const leaf = join(root, "leaf");
    await writeFile(target, "secret", { mode: 0o600 });
    await symlink(target, leaf);
    await expect(readPrivateFile(root, leaf)).rejects.toThrow("control-path-invalid");

    const descriptor = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    await descriptor.close();
    expect(dirname(target)).toBe(root);
    expect(await readFile(target, "utf8")).toBe("secret");
  });
});
```

```bash
./node_modules/.bin/vitest run tests/control/command.test.ts > $S/t5-command-red.log 2>&1; echo rc=$? >> $S/t5-command-red.log
./node_modules/.bin/vitest run tests/control/agentsControl.test.ts -t "control over the installation table" > $S/t5-agents-command-red.log 2>&1; echo rc=$? >> $S/t5-agents-command-red.log
```
Expected：command.test `rc=1`，`control command boundary` 5 条全红（旧 `parseCommand` 对 `--agents` 答 `control-command-invalid`）、`private control paths` 2 条绿；agentsControl 该 describe 4 条全红。

- [ ] **Step 9: 实现 `src/control/command.ts`（整文件替换）**

```ts
import { z } from "zod";
import { resolveAgent } from "../agents/materialize.js";
import { getDescriptor } from "../agents/registry.js";
import { assertAgentsTablePath, readAgentsTable } from "../agents/table.js";
import { AgentError } from "../agents/types.js";
import {
  agentSelectionSchema,
  artifactRefSchema,
  attachControlMethod,
  ControlProtocolError,
  parseControlRequest,
  type ControlMethodV1,
  type ControlRequestV1,
} from "./protocol.js";
import { acceptStart } from "./accept.js";
import { collectExecution, inspectExecution } from "./collect.js";
import { MAX_CONTROL_BYTES, readEvidence } from "./evidence.js";
import { requestHandoff } from "./handoff.js";

export interface ControlCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ControlContextV1 {
  agentsTablePath: string;
}

export interface ControlCommandDeps {
  handle?: (request: ControlRequestV1, context: ControlContextV1) => Promise<unknown>;
}

const contextWindowSchema = z.union([
  z.literal("agent-default"),
  z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
]);
const capabilityViewSchema = z
  .object({
    usageObservation: z.enum(["realtime", "phase-end", "unavailable"]),
    budgetEnforcement: z.enum(["bounded", "soft", "unavailable"]),
    contextObservation: z.enum(["realtime", "phase-end", "unavailable"]),
    handoffControl: z.enum(["durable", "phase-end", "unavailable"]),
    handoffExecution: z.enum(["mechanical-in-run-v1", "model-assisted-v1"]).nullable(),
    contextWindowTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
    requestBoundProof: z
      .object({
        scheme: z.literal("adapter-request-bound-v1"),
        version: z.string().min(1),
        workDimensions: z.array(z.string()),
        handoffDimensions: z.array(z.string()),
        evidenceKind: z.string().min(1),
      })
      .strict()
      .nullable(),
  })
  .strict();
// Agent selection (2026-09-26), spec §4.6: capabilities answers protocol 3, either the table view (request
// `{agent:null}`) or one resolution of a partial selection (the capability view carries no `protocol` of its own).
const capabilitiesSchema = z.union([
  z
    .object({
      protocol: z.literal(3),
      installations: z.array(
        z
          .object({
            id: z.string().min(1),
            kind: z.string().min(1),
            defaults: z.object({ model: z.string().min(1), contextWindow: contextWindowSchema }).strict(),
            contextOptions: z.array(contextWindowSchema).min(1),
            version: z.string().min(1),
          })
          .strict(),
      ),
    })
    .strict(),
  z
    .object({
      protocol: z.literal(3),
      selection: agentSelectionSchema,
      configHash: z.string().regex(/^[a-f0-9]{64}$/),
      timeoutMs: z.number().int().positive().max(2_147_483_647),
      killGraceMs: z.number().int().nonnegative().max(60_000),
      capabilities: capabilityViewSchema,
    })
    .strict(),
]);
const executionStatusSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("absent") }).strict(),
  z.object({ kind: z.literal("accepted"), executionId: z.string().min(1), configHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ kind: z.literal("unknown") }).strict(),
  z.object({
    kind: z.literal("stopped"),
    proof: z.object({
      executionId: z.string().min(1),
      generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      isolated: z.literal(true),
      source: artifactRefSchema,
    }).strict(),
  }).strict(),
]);
const handoffAckSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("latched"), requestId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("complete"), requestId: z.string().min(1), checkpointId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("unknown"), requestId: z.string().min(1) }).strict(),
]);
const evidenceSchema = z
  .object({ artifactId: z.string().min(1), hash: z.string().regex(/^[a-f0-9]{64}$/), base64: z.string() })
  .strict();
const safeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const amountSchema = z.object({ tokens: safeInteger, activeMs: safeInteger, attempts: safeInteger, sessions: safeInteger }).strict();
const usageEventSchema = z.object({
  runId: z.string().min(1),
  generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  eventSeq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  bucket: z.enum(["work", "handoff"]),
  cumulative: amountSchema.nullable(),
  source: artifactRefSchema,
}).strict();
const terminalSchema = z.object({
  status: z.enum(["succeeded", "blocked_waiting_human", "exhausted", "cancelled", "failed"]),
  currentAttempt: safeInteger,
  attemptsUsed: safeInteger,
  lastTransitionAt: z.string(),
  waitingOnHuman: z.boolean(),
  stopReason: z.string().nullable(),
  budgetSnapshot: z.object({ attemptsRemaining: safeInteger, timeRemainingMs: safeInteger, tokenBudgetRemaining: safeInteger }).strict(),
  recentFailures: z.array(z.object({ rejectCategory: z.string(), primaryTargetPaths: z.array(z.string()), failingCommand: z.string().nullable() }).strict()),
}).strict();
const collectionSchema = z.object({
  events: z.array(usageEventSchema),
  candidate: z.object({
    groupId: z.string().min(1), workItemId: z.string().min(1), taskId: z.string().min(1).nullable(), runId: z.string().min(1),
    generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), graphVersion: safeInteger, targetVersion: safeInteger,
    checkpointId: z.string().min(1), usageHighWater: safeInteger, result: z.enum(["complete", "partial", "failed"]),
    artifacts: z.array(artifactRefSchema), snapshot: artifactRefSchema.nullable(), missing: z.array(z.string()),
    unresolvedRequestIds: z.array(z.string()),
    stopProof: z.object({ executionId: z.string().min(1), generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), isolated: z.literal(true), source: artifactRefSchema }).strict().nullable(),
    terminalOutcome: z.string().min(1), handoff: artifactRefSchema,
  }).strict().nullable(),
  terminal: terminalSchema.nullable(),
}).strict();

const METHODS = new Set<ControlMethodV1>([
  "capabilities",
  "accept",
  "inspect",
  "handoff",
  "collect",
  "read-evidence",
]);

async function parseCommand(argv: string[]): Promise<{ method: ControlMethodV1; agentsTablePath: string }> {
  const method = argv[0] as ControlMethodV1 | undefined;
  if (method === undefined || !METHODS.has(method)) throw new Error("control-command-invalid");
  // Agent selection (2026-09-26), spec §4.5: `--agents <table>` is the only form; `--adapter`/`--adapter-config`
  // are no longer accepted. Every method checks the path's shape; only capabilities and accept read the table
  // (spec §4.2, I4: a broken table must not block collecting a run already in flight).
  if (argv.length !== 3 || argv[1] !== "--agents") throw new Error("control-command-invalid");
  const agentsTablePath = argv[2]!;
  await assertAgentsTablePath(agentsTablePath);
  return { method, agentsTablePath };
}

async function tableView(agentsTablePath: string): Promise<unknown> {
  const table = await readAgentsTable(agentsTablePath);
  return {
    protocol: 3,
    installations: Object.keys(table.installations).sort().map((id) => {
      const installation = table.installations[id]!;
      const descriptor = getDescriptor(installation.kind);
      return {
        id,
        kind: installation.kind,
        defaults: descriptor.defaults,
        contextOptions: descriptor.contextOptions,
        version: installation.version,
      };
    }),
  };
}

async function defaultHandler(request: ControlRequestV1, context: ControlContextV1): Promise<unknown> {
  if (request.method === "capabilities") {
    if (request.agent === null) return await tableView(context.agentsTablePath);
    const { resolution } = await resolveAgent(await readAgentsTable(context.agentsTablePath), request.agent);
    return { protocol: 3, ...resolution };
  }
  if (request.method === "accept") {
    return await acceptStart(request.input, { agentsTablePath: context.agentsTablePath });
  }
  if (request.method === "inspect") {
    return await inspectExecution(request.input);
  }
  if (request.method === "handoff") {
    return await requestHandoff(request.input, request.request);
  }
  if (request.method === "collect") {
    return await collectExecution(request.input, request.afterSeq);
  }
  if (request.method === "read-evidence") {
    const bytes = await readEvidence(request.input.work.sourceDir, request.ref);
    return { ...request.ref, base64: bytes.toString("base64") };
  }
  throw new ControlProtocolError("control-method-unavailable");
}

function validateResponse(method: ControlMethodV1, value: unknown): unknown {
  try {
    if (method === "capabilities") return capabilitiesSchema.parse(value);
    if (method === "accept" || method === "inspect") return executionStatusSchema.parse(value);
    if (method === "handoff") return handoffAckSchema.parse(value);
    if (method === "collect") return collectionSchema.parse(value);
    if (method === "read-evidence") return evidenceSchema.parse(value);
    return value;
  } catch {
    throw new Error("control-response-invalid");
  }
}

export async function runControlCommand(
  argv: string[],
  stdin: string,
  deps: ControlCommandDeps = {},
): Promise<ControlCommandResult> {
  try {
    const command = await parseCommand(argv);
    let raw: unknown;
    try {
      raw = JSON.parse(stdin) as unknown;
    } catch {
      throw new Error("control-json-invalid");
    }
    const payload = parseControlRequest(command.method, raw);
    const request = attachControlMethod(command.method, payload);
    const value = await (deps.handle ?? defaultHandler)(request, { agentsTablePath: command.agentsTablePath });
    const validated = validateResponse(command.method, value);
    const stdout = `${JSON.stringify(validated)}\n`;
    if (Buffer.byteLength(stdout) > MAX_CONTROL_BYTES) {
      throw new ControlProtocolError("control-response-too-large");
    }
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      // Agent selection (2026-09-26), D-W3-2: an agent error is a named rejection like a protocol one (exit 2). Its
      // message starts with its code, so Orca reads the code back from `control-peer-exit` as `2:<code>[: <detail>]`.
      code: error instanceof ControlProtocolError || error instanceof AgentError ? 2 : 1,
      stdout: "",
      stderr: `${message}\n`,
    };
  }
}
```

（与旧文件的差：import（删 `lstat`／`realpath`／`isAbsolute`，加 agents 四个）、`ControlCommandDeps` 的 context 类型、`capabilitiesSchema`（v2 八键 → v3 两形；其中 `capabilityViewSchema` 的 7 个键与 T1 的 `CapabilityViewV1` 同形）、`parseCommand`、新增 `tableView`、`defaultHandler` 的 capabilities 与 accept 两支、catch 的退出码多认 `AgentError`；其余 schema、stderr 形状与 `validateResponse` 逐字相同。`agentSelectionSchema` 从 `./protocol.js` 取（D-W3-4）。）

- [ ] **Step 10: 跑，确认 command 转绿**

```bash
./node_modules/.bin/vitest run tests/control/command.test.ts > $S/t5-command-green.log 2>&1; echo rc=$? >> $S/t5-command-green.log
./node_modules/.bin/vitest run tests/control/agentsControl.test.ts -t "control over the installation table" > $S/t5-agents-command-green.log 2>&1; echo rc=$? >> $S/t5-agents-command-green.log
```
Expected：`rc=0`（7/7；4/4）。

- [ ] **Step 11: 改写 worker 路径的三条既有判据（含 T4 的新判据），跑确认红**

`tests/control/handoff.test.ts` —— 四处锚点编辑：

(a) import：把
```ts
import {
  canonicalJson,
  canonicalHash,
  type HandoffRequestV1,
  type StartEnvelopeV1,
} from "../../src/control/protocol.js";
```
换成
```ts
import {
  canonicalJson,
  canonicalHash,
  type HandoffRequestV1,
  type StartEnvelopeV2,
} from "../../src/control/protocol.js";
import { parseCodexConfig } from "../../src/runtime/codex/protocol.js";
import { FIXTURE_SELECTION, sealCodex } from "./agentsFixture.js";
```

(b) `fixture()` 返回类型：`  envelope: StartEnvelopeV1;` → `  envelope: StartEnvelopeV2;`

(c) `fixture()` 里的 envelope：把
```ts
  const envelope: StartEnvelopeV1 = {
    protocol: 1,
    claim: { groupId: "group-1", workItemId: "work-1", taskId: "task-1", runId: "run-1", generation: 2, graphVersion: 3, targetVersion: 4, commandId: "command-1", configHash: canonicalHash(config), grant: { work: amount, handoff: amount }, ownerToken: "owner-1" },
```
换成
```ts
  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): every criterion reading
  // this fixture gets a protocol-2 envelope whose claim carries a selection; no provider runs here, so nothing
  // resolves it and its assertions are unchanged.
  const envelope: StartEnvelopeV2 = {
    protocol: 2,
    claim: { groupId: "group-1", workItemId: "work-1", taskId: "task-1", runId: "run-1", generation: 2, graphVersion: 3, targetVersion: 4, commandId: "command-1", configHash: canonicalHash(config), agent: FIXTURE_SELECTION, grant: { work: amount, handoff: amount }, ownerToken: "owner-1" },
```

(d) 「watches…」一条的开头：把
```ts
  it("watches a latched deadline through packet, zero handoff usage, seal, and released lease", async () => {
    const runtime = await codexFixture("hang");
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
```
换成
```ts
  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the worker now reads the
  // sealed materialized agent config (codex installation + selection) and a protocol-2 envelope whose configHash is
  // that config's hash, and builds its adapter through the codex descriptor; the deadline, packet, zero handoff usage,
  // seal and released-lease assertions are unchanged.
  it("watches a latched deadline through packet, zero handoff usage, seal, and released lease", async () => {
    const runtime = await codexFixture("hang");
    await mkdir(join(runtime.dir, "input"));
    const sealed = await sealCodex(parseCodexConfig(runtime.config));
    const amount = { tokens: 100, activeMs: 10_000, attempts: 1, sessions: 1 };
    const envelope: StartEnvelopeV2 = {
      protocol: 2,
      claim: { groupId: "group-1", workItemId: "work-1", taskId: "task-1", runId: "run-1", generation: 1, graphVersion: 1, targetVersion: 1, commandId: "command-1", configHash: sealed.configHash, agent: sealed.selection, grant: { work: amount, handoff: amount }, ownerToken: "owner-1" },
      contractHash: "c".repeat(64),
      inputCheckpoint: null,
      work: { contract: runtime.contract, targetRepo: runtime.repo, base: "main", sourceDir: runtime.dir },
    };
    const controlDir = join(runtime.dir, "control");
    await ensurePrivateDirectory(runtime.dir, controlDir);
    await atomicReplacePrivateFile(runtime.dir, join(controlDir, "config.json"), Buffer.from(canonicalJson(sealed.config)));
```

`tests/control/handoffDeadlineUsage.test.ts` —— 三处锚点编辑：

(a) `import { canonicalHash, canonicalJson, type HandoffRequestV1, type StartEnvelopeV1 } from "../../src/control/protocol.js";` 换成
```ts
import { canonicalHash, canonicalJson, type HandoffRequestV1, type StartEnvelopeV2 } from "../../src/control/protocol.js";
import { parseCodexConfig } from "../../src/runtime/codex/protocol.js";
import { sealCodex } from "./agentsFixture.js";
```

(b) 把
```ts
    runtime.config.command.push(scriptPath);
    await mkdir(join(runtime.dir, "input"));
    const amount = { tokens: 100, activeMs: 60_000, attempts: 1, sessions: 1 };
    const envelope: StartEnvelopeV1 = {
      protocol: 1,
      claim: { groupId: "group-1", workItemId: "work-1", taskId: "task-1", runId: "run-1", generation: 1, graphVersion: 1, targetVersion: 1, commandId: "command-1", configHash: canonicalHash(runtime.config), grant: { work: amount, handoff: amount }, ownerToken: "owner-1" },
```
换成
```ts
    runtime.config.command.push(scriptPath);
    await mkdir(join(runtime.dir, "input"));
    // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the worker reads the
    // sealed materialized agent config for the same script-mode fake codex and a protocol-2 envelope carrying its
    // hash and selection; the booked-usage, partial-candidate and packet assertions are unchanged.
    const sealed = await sealCodex(parseCodexConfig(runtime.config));
    const amount = { tokens: 100, activeMs: 60_000, attempts: 1, sessions: 1 };
    const envelope: StartEnvelopeV2 = {
      protocol: 2,
      claim: { groupId: "group-1", workItemId: "work-1", taskId: "task-1", runId: "run-1", generation: 1, graphVersion: 1, targetVersion: 1, commandId: "command-1", configHash: sealed.configHash, agent: sealed.selection, grant: { work: amount, handoff: amount }, ownerToken: "owner-1" },
```

(c) `    await atomicReplacePrivateFile(runtime.dir, join(controlDir, "config.json"), Buffer.from(canonicalJson(runtime.config)));` 换成
```ts
    await atomicReplacePrivateFile(runtime.dir, join(controlDir, "config.json"), Buffer.from(canonicalJson(sealed.config)));
```

`tests/control/phasesCompleted.test.ts`（T4 的新判据，D-W3-13）—— 两处锚点编辑：

(a) 把 `import { canonicalHash, canonicalJson, type StartEnvelopeV1 } from "../../src/control/protocol.js";` 换成
```ts
import { canonicalHash, canonicalJson, type StartEnvelopeV2 } from "../../src/control/protocol.js";
import { parseCodexConfig } from "../../src/runtime/codex/protocol.js";
import { sealCodex } from "./agentsFixture.js";
```

(b) 把 describe「the control worker counts completed phases」下那条 it 的开头
```ts
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
```
换成
```ts
  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"; controller ruling W1-19): the
  // worker reads the sealed materialized agent config for the same integration-mode fake codex and a protocol-2
  // envelope carrying its hash and selection; it still counts exactly the three phases completed with a result, the
  // codex adapter still registers three groups, and the run still proves isolation.
  it("writes one count per phase a registering adapter completed, and the run still proves isolation", async () => {
    const runtime = await codexFixture("integration");
    await mkdir(join(runtime.dir, "input"));
    const sealed = await sealCodex(parseCodexConfig(runtime.config));
    const amount = { tokens: 100, activeMs: 10_000, attempts: 1, sessions: 1 };
    const envelope: StartEnvelopeV2 = {
      protocol: 2,
      claim: { groupId: "group-1", workItemId: "work-1", taskId: "task-1", runId: "run-1", generation: 1, graphVersion: 1, targetVersion: 1, commandId: "command-1", configHash: sealed.configHash, agent: sealed.selection, grant: { work: amount, handoff: amount }, ownerToken: "owner-1" },
      contractHash: "c".repeat(64),
      inputCheckpoint: null,
      work: { contract: runtime.contract, targetRepo: runtime.repo, base: "main", sourceDir: runtime.dir },
    };
    const controlDir = join(runtime.dir, "control");
    await ensurePrivateDirectory(runtime.dir, controlDir);
    await atomicReplacePrivateFile(runtime.dir, join(controlDir, "config.json"), Buffer.from(canonicalJson(sealed.config)));
```
（以 T4 落地后的文件为准：若 T4 的实际文本与上面「原文」不逐字相同，按 T4 的文本做同样三处替换 —— `StartEnvelopeV1/protocol: 1/configHash: canonicalHash(runtime.config)` 换成 v2＋`sealed`、`config.json` 写 `sealed.config` —— 断言一字不动，并在台账记差异。）

```bash
./node_modules/.bin/vitest run tests/control/handoff.test.ts > $S/t5-handoff-red.log 2>&1; echo rc=$? >> $S/t5-handoff-red.log
./node_modules/.bin/vitest run tests/control/handoffDeadlineUsage.test.ts > $S/t5-deadline-red.log 2>&1; echo rc=$? >> $S/t5-deadline-red.log
./node_modules/.bin/vitest run tests/control/phasesCompleted.test.ts > $S/t5-phases-red.log 2>&1; echo rc=$? >> $S/t5-phases-red.log
./node_modules/.bin/vitest run tests/control/agentsControl.test.ts > $S/t5-agents-worker-red.log 2>&1; echo rc=$? >> $S/t5-agents-worker-red.log
```
Expected：handoff `rc=1`，只红 `watches a latched deadline…`（旧 worker `parseCodexConfig` 拒物化配置，`codex-config-invalid: …`），其余 5 条绿；deadline `rc=1`，1 条红；phasesCompleted `rc=1`，只红 `the control worker counts completed phases ＞ writes one count per phase…`，其余与 T4 落地时同绿；agentsControl `rc=1`，红 2 条（`refuses a sealed config whose schema or kind does not hold…`：抛 `codex-config-invalid` 而无 `code: "agent-config-invalid"`；`registers the claude phase's process group…`：`processes.json` 等不到一条），其余 7 条绿。

- [ ] **Step 12: 实现 `src/control/worker.ts`（锚点编辑）**

(a) 把
```ts
import { CodexAdapter } from "../runtime/codex/codexAdapter.js";
import { parseCodexConfig } from "../runtime/codex/protocol.js";
```
换成
```ts
import { parseMaterializedAgentConfig } from "../agents/materialize.js";
import { getDescriptor } from "../agents/registry.js";
```

(b) `import { canonicalJson, parseControlRequest, type StartEnvelopeV1 } from "./protocol.js";` 换成
```ts
import { canonicalJson, parseControlRequest, type StartEnvelopeV2 } from "./protocol.js";
```

(c) 把
```ts
    const envelope = parseControlRequest("accept", await readJson(sourceDir, "envelope.json")) as StartEnvelopeV1;
    const config = parseCodexConfig(await readJson(sourceDir, "config.json"));
```
换成
```ts
    const envelope = parseControlRequest("accept", await readJson(sourceDir, "envelope.json")) as StartEnvelopeV2;
    // Agent selection (2026-09-26), spec §4.6: accept sealed the materialized agent config; re-check it with the
    // rules that admitted it (agent-config-invalid, controller ruling W1-19) before any phase runs.
    const config = parseMaterializedAgentConfig(await readJson(sourceDir, "config.json"));
```

(d) 把 `    await runLoop(contract, runDir, () => new CodexAdapter(config), {` 换成
```ts
    await runLoop(contract, runDir, () => getDescriptor(config.kind).createAdapter(config), {
```

```bash
/usr/bin/grep -rn "StartEnvelopeV1\|ClaimV1\|parseCodexConfig\|CodexAdapter" src/control > $S/t5-src-residue.txt 2>&1; echo rc=$? >> $S/t5-src-residue.txt
```
Expected：`t5-src-residue.txt` 只有末行 `rc=1`（零命中）。

- [ ] **Step 13: 跑，确认 worker 路径转绿**

```bash
./node_modules/.bin/vitest run tests/control/handoff.test.ts > $S/t5-handoff-green.log 2>&1; echo rc=$? >> $S/t5-handoff-green.log
./node_modules/.bin/vitest run tests/control/handoffDeadlineUsage.test.ts > $S/t5-deadline-green.log 2>&1; echo rc=$? >> $S/t5-deadline-green.log
./node_modules/.bin/vitest run tests/control/agentsControl.test.ts > $S/t5-agents-green.log 2>&1; echo rc=$? >> $S/t5-agents-green.log
```
```bash
./node_modules/.bin/vitest run tests/control/phasesCompleted.test.ts > $S/t5-phases-green.log 2>&1; echo rc=$? >> $S/t5-phases-green.log
```
Expected：四者 `rc=0`（6/6；1/1；9/9；phasesCompleted 与 T4 落地时同数全绿）。

- [ ] **Step 14: 其余只换输入形状的判据（断言一字不动），然后全量类型检查**

`tests/control/workerLaunch.test.ts`：
- `import { canonicalHash, type StartEnvelopeV1 } from "../../src/control/protocol.js";` → `import { canonicalHash, type StartEnvelopeV2 } from "../../src/control/protocol.js";` 并在其下加一行 `import { FIXTURE_SELECTION } from "./agentsFixture.js";`
- `async function fixture(): Promise<{ root: string; envelope: StartEnvelopeV1 }> {` → `…StartEnvelopeV2 }> {`
- 把
```ts
  const envelope: StartEnvelopeV1 = {
    protocol: 1,
    claim: { groupId: "group-1", workItemId: "work-1", taskId: "task-1", runId: "run-1", generation: 1, graphVersion: 1, targetVersion: 1, commandId: "command-1", configHash: "a".repeat(64), grant: { work: amount, handoff: amount }, ownerToken: "owner-1" },
```
换成
```ts
  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the fixture is a
  // protocol-2 envelope whose claim carries a selection; the identity assertion is unchanged.
  const envelope: StartEnvelopeV2 = {
    protocol: 2,
    claim: { groupId: "group-1", workItemId: "work-1", taskId: "task-1", runId: "run-1", generation: 1, graphVersion: 1, targetVersion: 1, commandId: "command-1", configHash: "a".repeat(64), agent: FIXTURE_SELECTION, grant: { work: amount, handoff: amount }, ownerToken: "owner-1" },
```

`tests/control/collect.test.ts`：
- `import { canonicalHash, type StartEnvelopeV1 } from "../../src/control/protocol.js";` → `…type StartEnvelopeV2 }…`，其下加 `import { FIXTURE_SELECTION } from "./agentsFixture.js";`
- `async function fixture(): Promise<{ root: string; envelope: StartEnvelopeV1 }> {` → `…StartEnvelopeV2 }> {`
- 把
```ts
    envelope: {
      protocol: 1,
      claim: { groupId: "group-1", workItemId: "work-1", taskId: "task-1", runId: "run-1", generation: 1, graphVersion: 1, targetVersion: 1, commandId: "command-1", configHash: canonicalHash(config), grant: { work: amount, handoff: amount }, ownerToken: "owner-1" },
```
换成
```ts
    // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the fixture is a
    // protocol-2 envelope whose claim carries a selection; collection and evidence assertions are unchanged.
    envelope: {
      protocol: 2,
      claim: { groupId: "group-1", workItemId: "work-1", taskId: "task-1", runId: "run-1", generation: 1, graphVersion: 1, targetVersion: 1, commandId: "command-1", configHash: canonicalHash(config), agent: FIXTURE_SELECTION, grant: { work: amount, handoff: amount }, ownerToken: "owner-1" },
```

`tests/control/handoffEnteredPhases.test.ts`：
- `import { canonicalHash, type HandoffRequestV1, type StartEnvelopeV1 } from "../../src/control/protocol.js";` → `…type StartEnvelopeV2 }…`，其下加 `import { FIXTURE_SELECTION } from "./agentsFixture.js";`
- `async function fixture(): Promise<{ runDir: string; envelope: StartEnvelopeV1; request: HandoffRequestV1 }> {` → `…StartEnvelopeV2…`
- 把
```ts
  const envelope: StartEnvelopeV1 = {
    protocol: 1,
    claim: { groupId: "group-1", workItemId: "work-1", taskId: "task-1", runId: "run-1", generation: 2, graphVersion: 3, targetVersion: 4, commandId: "command-1", configHash: canonicalHash(config), grant: { work: amount, handoff: amount }, ownerToken: "owner-1" },
```
换成
```ts
  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the fixture is a
  // protocol-2 envelope whose claim carries a selection; the entered-phase assertions are unchanged.
  const envelope: StartEnvelopeV2 = {
    protocol: 2,
    claim: { groupId: "group-1", workItemId: "work-1", taskId: "task-1", runId: "run-1", generation: 2, graphVersion: 3, targetVersion: 4, commandId: "command-1", configHash: canonicalHash(config), agent: FIXTURE_SELECTION, grant: { work: amount, handoff: amount }, ownerToken: "owner-1" },
```

`tests/control/resultRepository.test.ts`：
- `import type { StartEnvelopeV1 } from "../../src/control/protocol.js";` → `import type { StartEnvelopeV2 } from "../../src/control/protocol.js";`
- 把
```ts
  // Only the fields materializeResultRepository reads on the attempt>0, worktree-gone path.
  const envelope = {
    protocol: 1, claim: { runId: "run-mine" }, contractHash: "0".repeat(64), inputCheckpoint: null,
    work: { contract: { context: { repoPath: repo } }, targetRepo: repo, base, sourceDir },
  } as unknown as StartEnvelopeV1;
```
换成
```ts
  // Only the fields materializeResultRepository reads on the attempt>0, worktree-gone path.
  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the cast names the
  // protocol-2 envelope type; the fields read and both assertions are unchanged.
  const envelope = {
    protocol: 2, claim: { runId: "run-mine" }, contractHash: "0".repeat(64), inputCheckpoint: null,
    work: { contract: { context: { repoPath: repo } }, targetRepo: repo, base, sourceDir },
  } as unknown as StartEnvelopeV2;
```

```bash
./node_modules/.bin/tsc --noEmit -p tsconfig.json > $S/t5-tsc-mid.log 2>&1; echo rc=$? >> $S/t5-tsc-mid.log
for f in workerLaunch collect handoffEnteredPhases resultRepository; do ./node_modules/.bin/vitest run tests/control/$f.test.ts > $S/t5-$f.log 2>&1; echo "$f rc=$?"; done > $S/t5-inputonly.txt 2>&1
```
Expected：`t5-tsc-mid.log` 只剩 `tests/control/endToEnd.test.ts` 的错误（它在 Step 15 改）＋ `rc=2`；`t5-inputonly.txt` 四行全 `rc=0`（1/1、3/3、7/7、2/2）。

- [ ] **Step 15: 改写 `tests/control/endToEnd.test.ts`（整文件替换），新建 `tests/control/claudeEndToEnd.test.ts`**

`tests/control/endToEnd.test.ts`：

```ts
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { LoopContract } from "../../src/contract/schema.js";
import { resolveAgent } from "../../src/agents/materialize.js";
import { canonicalHash, type HandoffRequestV1, type StartEnvelopeV2 } from "../../src/control/protocol.js";
import { codexInstallation, writeAgentsTable } from "./agentsFixture.js";

const binary=resolve("dist/cli.js"),fakeCodex=resolve("tests/fixtures/fake-codex.mjs");
const roots:string[]=[];
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});

// Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): every criterion below drives
// the built CLI as `control <method> --agents <table>` over a one-installation table (the same fake-codex command the
// v1 adapter config named) with a protocol-2 envelope whose claim carries the resolved selection and configHash;
// every identity, evidence, handoff and crash-recovery assertion is unchanged.
async function fixture(mode="integration",runId="run-1"){
 const root=await realpath(await mkdtemp(join(tmpdir(),"ccloop-protocol-e2e-")));roots.push(root);const repo=join(root,"target"),sourceDir=join(root,"source"),marker=join(root,"codex-marker");
 await mkdir(repo,{mode:0o700});await mkdir(sourceDir,{mode:0o700});await mkdir(join(sourceDir,"input"),{mode:0o700});
 for(const args of [["init","-q"],["config","user.name","Test"],["config","user.email","test@example.invalid"]])await commandRaw("git",args,undefined,repo);
 await writeFile(join(repo,"answer.txt"),"0\n");await writeFile(join(repo,"check.cjs"),'if(require("fs").readFileSync("answer.txt","utf8")!=="42\\n")process.exit(1);\n');await commandRaw("git",["add","."],undefined,repo);await commandRaw("git",["commit","-qm","base"],undefined,repo);
 const installation=await codexInstallation({command:[process.execPath,fakeCodex,mode,marker],budgetMode:"soft",sandbox:"workspace-write",timeoutMs:10000,killGraceMs:50});
 const {path:tablePath,table}=await writeAgentsTable({codex:installation},root);const {resolution}=await resolveAgent(table,{agent:"codex",model:"fixture"});
 const check=`${process.execPath} check.cjs`;const contract:LoopContract={objective:{taskId:"task-1",goal:"Set answer.txt to 42",successCondition:"answer is 42",nonGoals:[]},context:{repoPath:repo,targetPaths:["answer.txt"],relevantDocs:[],buildTestCommands:[check],constraints:[]},executionPolicy:{autonomyLevel:"L2",maxAttempts:1,perAttemptTimeoutMs:10000,totalRuntimeBudgetMs:30000,tokenBudget:1000,worktreeRequired:true,partialOutcomeRecoveryWindowMs:100},safetyPolicy:{allowlistPaths:["answer.txt"],denylistPaths:[],maxFilesTouched:2,humanGateConditions:[]},verification:{verifierType:"agent",requiredChecks:[check],rejectOn:["failure"],evidenceRequired:[]},escalationAndExit:{escalationTargets:[],pauseOn:[],stopOn:[],terminalStates:["succeeded","blocked_waiting_human","exhausted","cancelled","failed"]}};
 const grant={tokens:2000,activeMs:120000,attempts:6,sessions:3};const envelope:StartEnvelopeV2={protocol:2,claim:{groupId:"group-1",workItemId:"work-1",taskId:"task-1",runId,generation:1,graphVersion:2,targetVersion:1,commandId:"command-1",configHash:resolution.configHash,agent:resolution.selection,grant:{work:grant,handoff:{tokens:200,activeMs:30000,attempts:1,sessions:1}},ownerToken:"owner-1"},contractHash:canonicalHash(contract),inputCheckpoint:null,work:{contract,targetRepo:repo,base:"HEAD",sourceDir}};
 return {root,repo,sourceDir,marker,tablePath,envelope};
}

function commandRaw(executable:string,args:string[],input?:string,cwd?:string,env:NodeJS.ProcessEnv=process.env):Promise<{code:number|null;signal:NodeJS.Signals|null;stdout:string;stderr:string}>{return new Promise((resolve,reject)=>{const child=spawn(executable,args,{cwd,env,stdio:["pipe","pipe","pipe"]});let stdout="",stderr="";child.stdout.on("data",b=>stdout+=b);child.stderr.on("data",b=>stderr+=b);child.on("error",reject);child.on("exit",(code,signal)=>resolve({code,signal,stdout,stderr}));child.stdin.end(input);});}
async function call(f:Awaited<ReturnType<typeof fixture>>,method:string,payload:unknown,env:NodeJS.ProcessEnv=process.env){return commandRaw(binary,["control",method,"--agents",f.tablePath],JSON.stringify(payload),undefined,env);}
async function accepted(f:Awaited<ReturnType<typeof fixture>>,env:NodeJS.ProcessEnv=process.env){const result=await call(f,"accept",f.envelope,env);expect(result.code,result.stderr).toBe(0);return JSON.parse(result.stdout);}
async function collection(f:Awaited<ReturnType<typeof fixture>>){for(let i=0;i<200;i++){const result=await call(f,"collect",{input:f.envelope,afterSeq:0});expect(result.code,result.stderr).toBe(0);const value=JSON.parse(result.stdout);if(value.candidate?.stopProof&&value.terminal)return value;await sleep(50);}throw new Error("collection timeout");}
async function rows(path:string){try{return (await readFile(path,"utf8")).trim().split("\n").filter(Boolean);}catch{return [];}}
async function waitFile(path:string){for(let i=0;i<200;i++){try{return await readFile(path,"utf8");}catch{}await sleep(20);}throw new Error(`marker timeout: ${path}`);}
async function killAndWait(child:ReturnType<typeof spawn>){if(child.exitCode!==null)return;const exited=new Promise<void>(resolve=>child.once("close",()=>resolve()));if(!child.pid)throw new Error("crash child has no pid");process.kill(child.pid,"SIGKILL");await Promise.race([exited,sleep(5000).then(()=>{throw new Error(`SIGKILL did not close child ${child.pid}`);})]);}

describe("control protocol through the built CLI",{timeout:120000},()=>{
 it("keeps one execution identity across dropped/duplicate accept and exposes complete evidence",async()=>{await chmod(binary,0o755);const f=await fixture();const first=await accepted(f);const recovered=await call(f,"inspect",f.envelope);expect(JSON.parse(recovered.stdout)).toMatchObject({executionId:first.executionId});expect((await accepted(f)).executionId).toBe(first.executionId);
  const done=await collection(f);expect(done.events.map((event:any)=>event.bucket)).toEqual(["work","work","work","handoff"]);expect(done.candidate.stopProof.isolated).toBe(true);expect(await readFile(join(f.sourceDir,"repo","answer.txt"),"utf8")).toBe("42\n");expect((await commandRaw("git",["show-ref","refs/ccloop/run/attempts/1"],undefined,f.repo)).code).toBe(0);const evidence=await call(f,"read-evidence",{input:f.envelope,ref:done.candidate.handoff});expect(evidence.code,evidence.stderr).toBe(0);expect(createHash("sha256").update(Buffer.from(JSON.parse(evidence.stdout).base64,"base64")).digest("hex")).toBe(done.candidate.handoff.hash);expect(await rows(f.marker+".calls")).toEqual(["plan","execute","verify"]);
 });
 it("deduplicates named handoff and rejects old generation or changed envelope without another phase",async()=>{await chmod(binary,0o755);const f=await fixture();await accepted(f);await collection(f);const request:HandoffRequestV1={protocol:1,requestId:"request-1",runId:"run-1",generation:1,reason:"context",deadlineAt:new Date(Date.now()+30000).toISOString()};for(let i=0;i<2;i++){const result=await call(f,"handoff",{input:f.envelope,request});expect(result.code,result.stderr).toBe(0);expect(JSON.parse(result.stdout).requestId).toBe(request.requestId);}const old=await call(f,"handoff",{input:f.envelope,request:{...request,requestId:"old",generation:2}});expect(old.code).toBe(2);const conflict=await call(f,"inspect",{...f.envelope,contractHash:"f".repeat(64)});expect(conflict.code).toBe(2);expect(await rows(f.marker+".calls")).toEqual(["plan","execute","verify"]);
 });
 it.each(["accepted-fsynced","worker-claimed","handoff-fsynced","candidate-fsynced"])("recovers the synchronized SIGKILL boundary: %s",async point=>{await chmod(binary,0o755);const f=await fixture();const marker=join(f.root,`crash-${point}`),env={...process.env,NODE_ENV:"test",CCLOOP_CONTROL_TEST_CRASH_POINT:point,CCLOOP_CONTROL_TEST_CRASH_MARKER:marker};
  if(point==="accepted-fsynced"){const child=spawn(binary,["control","accept","--agents",f.tablePath],{env,stdio:["pipe","ignore","ignore"]});child.stdin.end(JSON.stringify(f.envelope));await waitFile(marker);await killAndWait(child);const replay=await call(f,"accept",f.envelope);expect(JSON.parse(replay.stdout)).toEqual({kind:"unknown"});expect(await rows(f.marker+".calls")).toHaveLength(0);return;}
  await accepted(f,env);if(point==="worker-claimed"||point==="candidate-fsynced"){await waitFile(marker);const record=JSON.parse(await readFile(join(f.sourceDir,"control","accepted.json"),"utf8"));process.kill(record.worker.pid,"SIGKILL");await sleep(100);const replay=await call(f,"accept",f.envelope);expect(JSON.parse(replay.stdout)).toEqual({kind:"unknown"});if(point==="candidate-fsynced"){const report=JSON.parse((await call(f,"collect",{input:f.envelope,afterSeq:0})).stdout);expect(report.candidate).not.toBeNull();expect(report.candidate.stopProof).toBeNull();}return;}
  await collection(f);const request={protocol:1,requestId:"request-1",runId:"run-1",generation:1,reason:"context",deadlineAt:new Date(Date.now()+30000).toISOString()};const child=spawn(binary,["control","handoff","--agents",f.tablePath],{env,stdio:["pipe","ignore","ignore"]});child.stdin.end(JSON.stringify({input:f.envelope,request}));await waitFile(marker);await killAndWait(child);const replay=await call(f,"handoff",{input:f.envelope,request});expect(replay.code,replay.stderr).toBe(0);expect(await rows(f.marker+".calls")).toEqual(["plan","execute","verify"]);
 });
});
```

（与旧文件的差只有：import 三行、`fixture` 里 `config`／`configPath` 两句换成 `installation`／`tablePath`／`resolution` 两句、envelope 的 `protocol`／`configHash`／`agent`、返回的 `configPath`→`tablePath`、`call` 与两处 `spawn` 的 argv。）

`tests/control/claudeEndToEnd.test.ts`（新建）：

```ts
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { LoopContract } from "../../src/contract/schema.js";
import { canonicalHash, type StartEnvelopeV2 } from "../../src/control/protocol.js";
import { FAKE_CLAUDE_CLI, claudeInstallation, writeAgentsTable } from "./agentsFixture.js";

// Agent selection (2026-09-26), spec §4.6, §4.7, §4.7b: the claimed selection travels envelope -> accept -> sealed
// config -> worker -> the claude descriptor's adapter -> the claude CLI's argv, and a claude run still earns a stop
// proof (its process groups were registered). Additive.
const binary = resolve("dist/cli.js");
const roots: string[] = [];
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

function commandRaw(executable: string, args: string[], input?: string, cwd?: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((done, reject) => {
    const child = spawn(executable, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (b) => { stdout += b; });
    child.stderr.on("data", (b) => { stderr += b; });
    child.on("error", reject);
    child.on("exit", (code) => done({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

describe("control through the built CLI with a claude installation (agent selection)", { timeout: 120_000 }, () => {
  it("carries the claimed selection to the claude CLI's argv and still proves the run stopped", async () => {
    await chmod(binary, 0o755);
    const root = await realpath(await mkdtemp(join(tmpdir(), "ccloop-claude-e2e-")));
    roots.push(root);
    const repo = join(root, "target"), sourceDir = join(root, "source"), marker = join(root, "claude-marker"), script = join(root, "script.json");
    await mkdir(repo, { mode: 0o700 });
    await mkdir(sourceDir, { mode: 0o700 });
    await mkdir(join(sourceDir, "input"), { mode: 0o700 });
    for (const args of [["init", "-q"], ["config", "user.name", "Test"], ["config", "user.email", "test@example.invalid"]]) await commandRaw("git", args, undefined, repo);
    await writeFile(join(repo, "answer.txt"), "0\n");
    await writeFile(join(repo, "check.cjs"), 'if(require("fs").readFileSync("answer.txt","utf8")!=="42\\n")process.exit(1);\n');
    await commandRaw("git", ["add", "."], undefined, repo);
    await commandRaw("git", ["commit", "-qm", "base"], undefined, repo);
    await writeFile(script, JSON.stringify({ "task-1": { files: { "answer.txt": "42\n" } } }), { mode: 0o600 });
    const { path } = await writeAgentsTable({
      claude: await claudeInstallation([process.execPath, FAKE_CLAUDE_CLI, "script", marker, script], { timeoutMs: 10_000, killGraceMs: 50 }),
    }, root);
    const call = (method: string, payload: unknown) => commandRaw(binary, ["control", method, "--agents", path], JSON.stringify(payload));

    const probed = await call("capabilities", { agent: { agent: "claude", contextWindow: 1_000_000 } });
    expect(probed.code, probed.stderr).toBe(0);
    const resolution = JSON.parse(probed.stdout);
    expect(resolution.selection).toEqual({ agent: "claude", model: "claude-opus-5-5", contextWindow: 1_000_000 });
    expect(resolution.capabilities.contextWindowTokens).toBe(1_000_000);

    const check = `${process.execPath} check.cjs`;
    const contract: LoopContract = {
      objective: { taskId: "task-1", goal: "Set answer.txt to 42", successCondition: "answer is 42", nonGoals: [] },
      context: { repoPath: repo, targetPaths: ["answer.txt"], relevantDocs: [], buildTestCommands: [check], constraints: [] },
      executionPolicy: { autonomyLevel: "L2", maxAttempts: 1, perAttemptTimeoutMs: 10_000, totalRuntimeBudgetMs: 30_000, tokenBudget: 1_000, worktreeRequired: true, partialOutcomeRecoveryWindowMs: 100 },
      safetyPolicy: { allowlistPaths: ["answer.txt"], denylistPaths: [], maxFilesTouched: 2, humanGateConditions: [] },
      verification: { verifierType: "agent", requiredChecks: [check], rejectOn: ["failure"], evidenceRequired: [] },
      escalationAndExit: { escalationTargets: [], pauseOn: [], stopOn: [], terminalStates: ["succeeded", "blocked_waiting_human", "exhausted", "cancelled", "failed"] },
    };
    const grant = { tokens: 2_000, activeMs: 120_000, attempts: 6, sessions: 3 };
    const envelope: StartEnvelopeV2 = {
      protocol: 2,
      claim: {
        groupId: "group-1", workItemId: "work-1", taskId: "task-1", runId: "run-1", generation: 1, graphVersion: 2, targetVersion: 1,
        commandId: "command-1", configHash: resolution.configHash, agent: resolution.selection,
        grant: { work: grant, handoff: { tokens: 200, activeMs: 30_000, attempts: 1, sessions: 1 } }, ownerToken: "owner-1",
      },
      contractHash: canonicalHash(contract),
      inputCheckpoint: null,
      work: { contract, targetRepo: repo, base: "HEAD", sourceDir },
    };
    const accepted = await call("accept", envelope);
    expect(accepted.code, accepted.stderr).toBe(0);

    let done: any = null;
    for (let i = 0; i < 200 && done === null; i++) {
      const result = await call("collect", { input: envelope, afterSeq: 0 });
      expect(result.code, result.stderr).toBe(0);
      const value = JSON.parse(result.stdout);
      if (value.candidate?.stopProof && value.terminal) done = value;
      else await sleep(50);
    }
    expect(done, "collection timeout").not.toBeNull();
    expect(done.terminal.status).toBe("succeeded");
    expect(done.candidate.stopProof.isolated).toBe(true);
    expect(await readFile(join(sourceDir, "repo", "answer.txt"), "utf8")).toBe("42\n");
    expect((await readFile(`${marker}.calls`, "utf8")).trim().split("\n")).toEqual(["plan", "execute", "verify"]);
    const phaseArgv = (await readFile(`${marker}.argv`, "utf8")).trim().split("\n")
      .map((line) => JSON.parse(line) as string[])
      .filter((argv) => !argv.includes("--version"));
    expect(phaseArgv).toHaveLength(3);
    for (const argv of phaseArgv) expect(argv[argv.indexOf("--model") + 1]).toBe("claude-opus-5-5[1m]");
  });
});
```

- [ ] **Step 16: 类型检查、build、跑两条 E2E**

```bash
./node_modules/.bin/tsc --noEmit -p tsconfig.json > $S/t5-tsc.log 2>&1; echo rc=$? >> $S/t5-tsc.log
npm run build > $S/t5-build.log 2>&1; echo rc=$? >> $S/t5-build.log
./node_modules/.bin/vitest run tests/control/endToEnd.test.ts > $S/t5-e2e.log 2>&1; echo rc=$? >> $S/t5-e2e.log
./node_modules/.bin/vitest run tests/control/claudeEndToEnd.test.ts > $S/t5-claude-e2e.log 2>&1; echo rc=$? >> $S/t5-claude-e2e.log
```
Expected：`t5-tsc.log` 只有 `rc=0`；build `rc=0` 且 `dist/cli.js` 存在；endToEnd `rc=0`（6/6）；claudeEndToEnd `rc=0`（1/1）。（两条 E2E 的 RED 不单独跑：build 在所有测试文件类型通过前做不出来，现量 10；它们的「看得见的红」由 Step 20 的变异 M12 与探针的 `probe-e2e.txt` 承担。）

- [ ] **Step 17: 改写 `scripts/verify-control-protocol.mjs`（整文件替换）**

```js
import { createHash } from "node:crypto";
import { constants, readFileSync, realpathSync } from "node:fs";
import { accessSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
const binary = process.env.ORCA_CCLOOP_BIN;
const tablePath = process.env.ORCA_AGENTS_TABLE;
if (!binary || !tablePath) {
  throw new Error("verify:control requires ORCA_CCLOOP_BIN and ORCA_AGENTS_TABLE");
}

// Agent selection (2026-09-26): the formal gate runs over an agents table, and refuses one in which ANY
// installation names something other than a test fixture CLI (fake codex or the CLI-level fake claude).
const canonicalTablePath = realpathSync(tablePath);
const tableBytes = readFileSync(canonicalTablePath);
const table = JSON.parse(tableBytes.toString());
const installations =
  table !== null && typeof table === "object" && table.installations !== null && typeof table.installations === "object"
    ? Object.values(table.installations)
    : [];
if (
  table?.schema !== "ccloop-agents-table-v1" ||
  installations.length === 0 ||
  !installations.every(
    (installation) =>
      Array.isArray(installation?.command) &&
      installation.command.some((value) => /fake-(codex|claude-cli)\.mjs$/.test(String(value))),
  )
) {
  throw new Error("formal control verification refuses a non-fixture agents table");
}

const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run("npm", ["run", "build"]);
const expected = realpathSync(join(root, "dist", "cli.js"));
const actual = realpathSync(binary);
if (actual !== expected) throw new Error(`ORCA_CCLOOP_BIN must name this build: ${expected}`);
accessSync(actual, constants.X_OK);
if (!statSync(actual).isFile()) throw new Error("ORCA_CCLOOP_BIN is not a regular file");

process.stdout.write(`${JSON.stringify({
  binary: actual,
  agentsTable: canonicalTablePath,
  agentsTableSha256: createHash("sha256").update(tableBytes).digest("hex"),
})}\n`);

const vitest = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));
run(process.execPath, [
  vitest,
  "run",
  "tests/control",
  "tests/controller/codex.integration.test.ts",
  "tests/runtime/codex",
]);
```

（与旧文件的差：env 名 `ORCA_CCLOOP_ADAPTER_CONFIG`→`ORCA_AGENTS_TABLE`；fixture 检查从「单一 codex 配置的 `model==="fixture"` 且命令含 fake-codex」改为「表里**每一条**安装记录的命令都含 fake codex 或 fake claude CLI」—— `model` 已不在表里（在选择里），「每一条」比旧的「那一条」不松；表检查挪到 build 之前（拒收时不白跑 build）；输出键名随之改。）

- [ ] **Step 18: 验证脚本的拒收与放行**

```bash
mkdir -p -m 700 $S/verify
printf '{"schema":"ccloop-agents-table-v1","installations":{"codex":{"kind":"codex","command":["%s","%s/tests/fixtures/fake-codex.mjs","integration","/tmp/m"],"version":"0.0.0","configDir":null,"timeoutMs":1000,"killGraceMs":50,"sandbox":"workspace-write","budgetMode":"soft"},"claude":{"kind":"claude","command":["/usr/bin/true"],"version":"0.0.0","configDir":null,"timeoutMs":1000,"killGraceMs":50}}}\n' "$(command -v node)" "$C" > $S/verify/mixed.json
printf '{"schema":"ccloop-agents-table-v1","installations":{"codex":{"kind":"codex","command":["%s","%s/tests/fixtures/fake-codex.mjs","integration","/tmp/m"],"version":"0.0.0","configDir":null,"timeoutMs":1000,"killGraceMs":50,"sandbox":"workspace-write","budgetMode":"soft"}}}\n' "$(command -v node)" "$C" > $S/verify/fixture.json
chmod 600 $S/verify/*.json
ORCA_CCLOOP_BIN=$C/dist/cli.js ORCA_AGENTS_TABLE=$S/verify/mixed.json node scripts/verify-control-protocol.mjs > $S/t5-verify-mixed.log 2>&1; echo rc=$? >> $S/t5-verify-mixed.log
ORCA_CCLOOP_BIN=$C/dist/cli.js ORCA_AGENTS_TABLE=$S/verify/fixture.json npm run verify:control > $S/t5-verify.log 2>&1; echo rc=$? >> $S/t5-verify.log
```
Expected：`t5-verify-mixed.log` 含 `formal control verification refuses a non-fixture agents table` 且末行 `rc=1`（没有 build 输出）；`t5-verify.log` 首个 JSON 行的 `agentsTable` 是 `$S/verify/fixture.json` 的 realpath，vitest 汇总行全绿（`tests/control` 下除已登记已知红 `stopProof … does not treat leader exit…` 外无红 —— 若出现该条，按 `scripts/check-known-reds.mjs` 判别，别的红一律停下），末行 `rc=0` 或已知红导致的非 0（读汇总逐条核）。

- [ ] **Step 19: 看 diff、提交**

```bash
/usr/bin/git status --short > $S/t5-status.txt 2>&1
/usr/bin/git diff --stat > $S/t5-diffstat.txt 2>&1
/usr/bin/git diff > $S/t5-diff.patch 2>&1
```
读回三份（CLAUDE.md：提交前看 diff）。只应出现：本 Task Files 清单里的文件（`src/control/{protocol,command,accept,worker,handoff,collect,paths,resultRepository}.ts`、`src/agents/types.ts`、`scripts/verify-control-protocol.mjs`、11 个既有测试文件（含 T4 的 `phasesCompleted.test.ts`）、3 个新文件）。

```bash
/usr/bin/git add src/control/protocol.ts src/control/command.ts src/control/accept.ts src/control/worker.ts src/control/handoff.ts src/control/collect.ts src/control/paths.ts src/control/resultRepository.ts src/agents/types.ts scripts/verify-control-protocol.mjs tests/control/agentsFixture.ts tests/control/agentsControl.test.ts tests/control/claudeEndToEnd.test.ts tests/control/protocol.test.ts tests/control/command.test.ts tests/control/accept.test.ts tests/control/endToEnd.test.ts tests/control/handoff.test.ts tests/control/handoffDeadlineUsage.test.ts tests/control/phasesCompleted.test.ts tests/control/workerLaunch.test.ts tests/control/collect.test.ts tests/control/handoffEnteredPhases.test.ts tests/control/resultRepository.test.ts
/usr/bin/git commit -F - <<'EOF'
feat(control): drive control through the installation table

`ccloop control <method> --agents <table>` replaces --adapter and
--adapter-config. The start envelope is protocol 2 and its claim carries
the full agent selection; capabilities answers protocol 3, the table view
for {agent:null} or one resolution of a partial selection; accept
materializes the claimed selection, checks the claim's configHash and the
CLI's --version, and seals the materialized config; the worker builds its
adapter through the sealed config's descriptor. Only capabilities and
accept read the table. Agent errors are named rejections (exit 2, their
message on stderr, code first). The selection wire schemas move into
control/protocol.ts and agents/types.ts re-exports them, so the two
modules never import each other's values. The v1 control criteria are
rewritten to the new shapes under the 2026-09-26 human ruling;
verify:control reads ORCA_AGENTS_TABLE.

Co-Authored-By: <实施席自己的模型> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR
EOF
/usr/bin/git log --oneline -1 > $S/t5-commit.txt 2>&1
```

- [ ] **Step 20: 具名变异（只在 `git clone --local` 副本里；每条打完跑指定文件、看见红、还原并证明零字节 diff）**

```bash
/usr/bin/git clone --local -q $C $S/t5-mut && cd $S/t5-mut && ln -s $C/node_modules node_modules
```
每条变异：用 python 对下表「原文」做**恰一次**替换（`assert s.count(old)==1`）→ 跑「判据」列的文件（M12 先 `npm run build`）重定向到 `$S/mut-<id>.log` → 读回、确认列出的判据红 → `/usr/bin/git -C $S/t5-mut checkout -- <文件>` → `/usr/bin/git -C $S/t5-mut diff | wc -c` 与 `/usr/bin/git -C $S/t5-mut diff --cached | wc -c` 都是 `0`（重定向到文件读回）。结果逐条记进 `mutations.md`。

| id | 文件 | 原文 → 变异 | 判据（必须红） |
|---|---|---|---|
| M1 | `src/control/protocol.ts` | `if (version !== undefined && version !== 2) {` → `if (version !== undefined && version !== 2 && version !== 1) {` | `protocol.test.ts` ＞ control protocol v1 ＞ names unsupported protocol versions separately from invalid requests |
| M2 | `src/control/protocol.ts` | `capabilities: z.object({ agent: partialSelectionSchema.nullable() }).strict(),` → `capabilities: z.object({ agent: partialSelectionSchema.nullable().optional() }).strict(),` | 同上（`{}` 不再被拒） |
| M3 | `src/control/protocol.ts` | `    agent: agentSelectionSchema,` → `    agent: agentSelectionSchema.optional(),` | `protocol.test.ts` ＞ … ＞ requires a full agent selection on the claim and at most a partial one on capabilities |
| M4 | `src/control/command.ts` | `if (argv.length !== 3 \|\| argv[1] !== "--agents") throw new Error("control-command-invalid");` → `if (argv.length !== 3) throw new Error("control-command-invalid");` | `agentsControl.test.ts` ＞ control over the installation table (agent selection) ＞ refuses the retired --adapter forms for every control method |
| M5 | `src/control/command.ts` | `code: error instanceof ControlProtocolError \|\| error instanceof AgentError ? 2 : 1,` → `code: error instanceof ControlProtocolError ? 2 : 1,` | `command.test.ts` ＞ control command boundary ＞ rejects a relative agents table before dispatch；`agentsControl.test.ts` ＞ … ＞ names a missing installation, a drifted CLI version, and an unsafe table with exit 2 and the code first |
| M6 | `src/control/command.ts` | 删整行 `    if (request.agent === null) return await tableView(context.agentsTablePath);` | `command.test.ts` ＞ control command boundary ＞ routes the real CLI through control before legacy parsing and emits one JSON value |
| M7 | `src/control/command.ts` | `    return { protocol: 3, ...resolution };` → `    return await tableView(context.agentsTablePath);` | `agentsControl.test.ts` ＞ … ＞ answers capabilities for a selection with descriptor defaults filled, given fields echoed, and the materialized config's hash |
| M8 | `src/control/command.ts` | `  await assertAgentsTablePath(agentsTablePath);` → `  await readAgentsTable(agentsTablePath);` | `agentsControl.test.ts` ＞ … ＞ reads the table only for capabilities and accept: a table broken after accept blocks neither inspect nor collect |
| M9 | `src/control/accept.ts` | 删 `  if (configHash !== input.claim.configHash) {` 起的三行 if 块 | `accept.test.ts` ＞ durable control acceptance ＞ rejects a claim config hash mismatch before creating a worker；`agentsControl.test.ts` ＞ accept under the installation table (agent selection) ＞ refuses a claim whose selection changed after its configHash was taken, before any worker |
| M10 | `src/control/accept.ts` | `Buffer.from(\`${canonicalJson(config)}\n\`),` → `Buffer.from(\`${canonicalJson(input.claim.agent)}\n\`),` | `accept.test.ts` ＞ … ＞ seals the materialized agent config so later table drift has no effect；`agentsControl.test.ts` ＞ accept under … ＞ seals the materialized agent config whose canonical hash the claim carries |
| M11 | `src/control/accept.ts` | `await resolveAgent(table, input.claim.agent);` → `await resolveAgent(table, input.claim.agent, { probeVersion: async () => table.installations[input.claim.agent.agent]?.version ?? null });` | `agentsControl.test.ts` ＞ accept under … ＞ refuses a CLI whose --version drifted from the table, before anything is persisted |
| M12 | `src/control/worker.ts` | `() => getDescriptor(config.kind).createAdapter(config)` → `() => getDescriptor("codex").createAdapter(config)`（改后 `npm run build`） | `claudeEndToEnd.test.ts` ＞ control through the built CLI with a claude installation (agent selection) ＞ carries the claimed selection to the claude CLI's argv and still proves the run stopped |
| M13 | `src/control/worker.ts` | `const config = parseMaterializedAgentConfig(await readJson(sourceDir, "config.json"));` → `const config = (await readJson(sourceDir, "config.json")) as MaterializedAgentConfigV1;`（并在 import 区加 `import type { MaterializedAgentConfigV1 } from "../agents/types.js";`，只为让变异可编译） | `agentsControl.test.ts` ＞ worker adapter from the sealed config (agent selection) ＞ refuses a sealed config whose schema or kind does not hold, before any phase（`parseMaterializedAgentConfig` 自己的 schema／kind 分支与变异归 T1） |
| M14 | （作废：原「删 kind 检查」变异的被测分支已归 T1 的 `parseMaterializedAgentConfig`，见 D-W3-3） | — | — |
| M15 | `scripts/verify-control-protocol.mjs` | `!installations.every(` → `!installations.some(` | Step 18 第一条（`mixed.json`）：变异下不再打印拒收句（设 `ORCA_CCLOOP_BIN=/nonexistent`，让它在 build 之后于 `realpathSync` 处以别的错误退出，免跑 vitest）⇒ 「RC≠0 且 stderr 含拒收句」这条判据红 |
| M16 | `src/control/worker.ts` | 删掉传给 `runLoop` 的整段 `      onProcessRegistered: async (registration) => {` … `      },`（写作时 `worker.ts:157-164` 那 8 行：`await registerProcess(...)`、读 handoff 请求、`control-handoff-latched-before-prompt`） | `agentsControl.test.ts` ＞ claude process registration through the control worker (agent selection) ＞ registers the claude phase's process group in processes.json, and that record proves nothing while the group lives（等不到一条注册）；连带 `claudeEndToEnd.test.ts` 那条（T4 的计数闸下拿不到 `stopProof`，改后需 `npm run build`） |

（M11 说明：T5 自己的分支是「accept 经 `resolveAgent` 的真探测」；漂移比对本身在 T1，其变异归 T1。M12 说明：这是「worker 经描述建 adapter」唯一的承重判据，codex 判据看不见它。M16 说明：控制器裁定 D-W3-12 点名的变异；W2 的适配器级判据看不见 worker 这一段接线。）

- [ ] **Step 21: 台账**

在 `progress.md` 追加 T5 一节：提交主题行、Step 4/7/10/13/14/16/18 的日志路径与计数、M1–M15 结果、下方「会红的既有判据」逐条全名（改写前名 → 改写后名）。

**Existing criteria that will go red（现量：`scratchpad/W3/probe-summ.txt`、`probe-e2e.txt`、`probe-tsc.log`；改写代码见上文各 Step；每条旁已放注释 `// Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): <它现在编码什么>`）**

A. **运行时红（25 条；断言整条改写或输入整条换形，均不放宽）**

| # | 判据全名（文件 ＞ describe ＞ it） | 红因（探针实测） | 改写（Step） |
|---|---|---|---|
| 1 | `tests/control/protocol.test.ts` ＞ control protocol v1 ＞ round-trips the strict payload for every method | v2 envelope／`{}` 的 capabilities 被拒 | 用 v2 envelope；capabilities 改为 `{agent:null}` 与一个部分选择各一 round-trip（Step 2） |
| 2 | 同文件 ＞ control protocol v1 ＞ names unsupported protocol versions separately from invalid requests | `protocol: 2` 不再 unsupported | 1 与 3 都 unsupported；保留原「extra 键」「capabilities extra」两条，另加 `{}` 与 `{agent:null, extra}` 为 invalid（Step 2） |
| 3 | 同文件 ＞ control protocol v1 ＞ rejects unsafe integers, malformed identities, and malformed hashes | v1 夹具先被 unsupported 拒 | 断言不动，夹具换 v2（Step 2） |
| 4 | 同文件 ＞ control protocol v1 ＞ requires a canonical absolute sourceDir with no symlink ancestor | 同上 | 同上 |
| 5 | 同文件 ＞ control protocol v1 ＞ keeps an input bundle inside the canonical source input directory | 同上 | 同上 |
| 6 | `tests/control/command.test.ts` ＞ control command boundary ＞ rejects a relative adapter config before dispatch | `--adapter` 形态退役 | **改名** ＞ rejects a relative agents table before dispatch：`--agents relative.json` ⇒ `{code:2, stdout:"", stderr:"agents-table-invalid\n"}`（原 `toContain` 收紧为 `toEqual`）（Step 8） |
| 7 | 同文件 ＞ control command boundary ＞ maps named protocol rejections to exit 2 without contaminating stdout | 同上 | `--agents <table>`＋`{protocol:1}` ⇒ `{code:2, stderr:"control-protocol-unsupported\n"}` |
| 8 | 同文件 ＞ control command boundary ＞ maps malformed JSON and non-protocol failures to exit 1 | 同上；且 `{}` 不再是合法 capabilities | `--agents`；handler 失败用 `{agent:null}` 负载；断言不动 |
| 9 | 同文件 ＞ control command boundary ＞ does not print until a handler result passes the response schema | 同上 | `--agents`；除原 `{protocol:1, durableAccept}` 外，退役的 v2 八键应答也必须被拒 |
| 10 | 同文件 ＞ control command boundary ＞ routes the real CLI through control before legacy parsing and emits one JSON value | 同上；应答改 v3 | `control capabilities --agents <table>`＋`{agent:null}` ⇒ v3 表级视图逐字（两条安装、按 id 排序、描述默认值字面量、`contextOptions`、表里版本）；保留 2026-09-24 的旧注释原文，其后追加新注释 |
| 11 | `tests/control/accept.test.ts` ＞ durable control acceptance ＞ persists accepted before one exclusive worker claim and replays idempotently | binding 形状改（`agentsTablePath`）；configHash 含义改 | 夹具走表＋v2；断言不动（Step 5） |
| 12 | 同文件 ＞ … ＞ serializes concurrent identical accepts into one durable launch | 同上 | 同上 |
| 13 | 同文件 ＞ … ＞ refuses the same identity with a different envelope | 同上 | 同上 |
| 14 | 同文件 ＞ … ＞ recovers a dropped accept response through inspect without another worker | 同上 | 同上 |
| 15 | 同文件 ＞ … ＞ seals the canonical config so later external drift has no effect | 同上；封存物改为物化配置 | **改名** ＞ seals the materialized agent config so later table drift has no effect：封存字节 ＝ `canonicalJson(物化配置)+"\n"`（新增）；把**表**写坏后重放仍 accepted、封存字节不变（原断言对象由 codex 配置换成表） |
| 16 | 同文件 ＞ … ＞ rejects a claim config hash mismatch before creating a worker | 同上 | 夹具走表＋v2；断言不动 |
| 17 | `tests/control/endToEnd.test.ts` ＞ control protocol through the built CLI ＞ keeps one execution identity across dropped/duplicate accept and exposes complete evidence | `control-command-invalid`（探针） | 夹具走表＋v2、`--agents`；断言不动（Step 15） |
| 18 | 同文件 ＞ … ＞ deduplicates named handoff and rejects old generation or changed envelope without another phase | 同上 | 同上 |
| 19 | 同文件 ＞ … ＞ recovers the synchronized SIGKILL boundary: accepted-fsynced | 同上（marker timeout） | 同上；`spawn` 的 argv 改 `--agents` |
| 20 | 同文件 ＞ … ＞ recovers the synchronized SIGKILL boundary: worker-claimed | 同上 | 同上 |
| 21 | 同文件 ＞ … ＞ recovers the synchronized SIGKILL boundary: handoff-fsynced | 同上 | 同上；`spawn` 的 argv 改 `--agents` |
| 22 | 同文件 ＞ … ＞ recovers the synchronized SIGKILL boundary: candidate-fsynced | 同上 | 同上 |
| 23 | `tests/control/handoff.test.ts` ＞ named handoff request ＞ watches a latched deadline through packet, zero handoff usage, seal, and released lease | worker 读 `config.json` 为 codex 配置；envelope v1 | `config.json` 写物化配置、claim 带其哈希与选择；断言不动（Step 11） |
| 24 | `tests/control/handoffDeadlineUsage.test.ts` ＞ deadline-aborted execute with observed usage (Orca handoff delivery C-3) ＞ books the observed tokens as a known cumulative and still hands off a partial candidate that answers its request | 同上 | 同上 |
| 24a | `tests/control/phasesCompleted.test.ts`（T4 新写，T5 时已是既有判据）＞ the control worker counts completed phases ＞ writes one count per phase a registering adapter completed, and the run still proves isolation | 同上（W1 的计划正文：v1 envelope＋codex `config.json`；**未现跑**，T4 未落地，按与 #23 同一机理静态推定，Step 11 的 RED 跑会实测） | 同上；控制器裁定 W1-19（Step 11）。同文件其余判据只因 import 行的类型名变化，不消费 envelope，不算改写 |

B. **只因类型红、输入换形而断言一字不动（20 条；vitest 下原本仍绿，但 `tsc`／`npm run build` 红 —— 现量 10）**

| # | 判据全名 | 改写 |
|---|---|---|
| 25 | `tests/control/protocol.test.ts` ＞ control protocol v1 ＞ derives the control root from the accepted source directory | 夹具 v2（Step 2） |
| 26 | `tests/control/accept.test.ts` ＞ durable control acceptance ＞ keeps an intended crash ambiguous and never launches a replacement | 夹具走表＋v2、binding 参数（Step 5） |
| 27 | `tests/control/workerLaunch.test.ts` ＞ worker process identity ＞ does not accept a recycled live PID with a mismatched UTC start identity | 夹具 v2（Step 14） |
| 28 | `tests/control/collect.test.ts` ＞ control collection ＞ filters afterSeq without renumbering | 同上 |
| 29 | 同文件 ＞ bounded evidence reads ＞ rechecks the content hash on every read | 同上 |
| 30 | 同文件 ＞ bounded evidence reads ＞ rejects traversal, symlink, FIFO, and evidence over 16 MiB | 同上 |
| 31 | `tests/control/handoff.test.ts` ＞ named handoff request ＞ fsyncs before an idempotent ack and rejects changed or stale identity | 夹具 v2（Step 11 (b)(c)） |
| 32 | 同文件 ＞ named handoff request ＞ starts no phase when already latched and starts no next phase after a cooperative boundary | 同上 |
| 33 | 同文件 ＞ named handoff request ＞ persists an external deadline abort as handoff interruption rather than failure or exhaustion | 同上 |
| 34 | 同文件 ＞ mechanical handoff packet ＞ derives blocked facts and explicit logs without an LLM call | 同上 |
| 35 | 同文件 ＞ mechanical handoff packet ＞ allows request:null only for natural terminal runs and retains handoff refs for every result | 同上（其上 2026-09-25 的 ruling-88 注释原文保留） |
| 36–41 | `tests/control/handoffEnteredPhases.test.ts` ＞ handoff packet of a run stopped between phases (ccloop C7) ＞ 六条：does not list the execute and verify files of an attempt stopped at the boundary after plan／does not list the verify file of an attempt stopped after execute, once execute was entered and wrote its file／still lists an entered phase whose file is absent: execute, and verify after execution_finished／counts only the current attempt's events as entered／does not list an entered phase's file as missing when a handoff deadline interrupted it (D-C7' (α))／keeps requiring all three phase files for terminal runs, with or without a request | 夹具 v2（Step 14） |
| 42 | 同文件 ＞ handoff candidate of a deadline-interrupted run (ccloop C6 with C7) ＞ answers its request: result stays partial, no unresolved request on candidate or packet, nothing missing | 同上 |
| 43 | `tests/control/resultRepository.test.ts` ＞ the result repository a control run materializes (Orca execution driver C1/C2) ＞ C2 reads its own run's attempt ref, not the shared path-derived one a later run overwrote | 类型名 `StartEnvelopeV2`、cast 内 `protocol: 2`（Step 14） |
| 44 | 同文件 ＞ … ＞ C1 shares the object store by hard links instead of copying it | 同上 |

C. **门脚本**：`scripts/verify-control-protocol.mjs`（非 vitest 判据；fixture 守卫由「那一份 codex 配置」改为「表里每一条安装」，Step 17；拒收由 Step 18 与 M15 验证）。

D. **现量确认不因 T5 红、不动**：`tests/control/protocol.test.ts` ＞ control protocol v1 ＞ canonicalizes object keys recursively while preserving array order；`tests/control/command.test.ts` ＞ private control paths ＞ 两条；`tests/control/{worker,materialize,usage,stopProof}.test.ts` 全部（`stopProof` 那条已知红与基线相同）；台账 §1 其余 11 个文件（现量 16）。

**合计**：会被改写的既有 vitest 判据 **45 条**（A 25 ＝ 探针实测 24 ＋ T4 新判据 1；B 20），分布在 11 个文件；另 1 个门脚本。另有**新增**判据 10 条（`protocol.test.ts` 1、`agentsControl.test.ts` 9 —— 其中 worker 层 claude 注册 1 条出自控制器裁定 D-W3-12）＋ `claudeEndToEnd.test.ts` 1 条。
