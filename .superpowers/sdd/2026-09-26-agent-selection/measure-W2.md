

# 计划分节 W2：T3（fake claude CLI、fake codex `.argv`、runner 环境变量、`ClaudeAgentAdapter`）与 T6（`ccloop run --agents --agent-selection`）

> **归属**：Orca 控制器会话 `75ec878e` 派出的计划写作席 **W2**（Claude Opus 5.5），2026-09-26。
> **观测锚点**：ccloop 主题行 `docs(handoff): roll the Orca section: C5-C7 and C-3 landed here for the handoff delivery round`（`f4e49a2`）；Orca 主题行 `chore(checkpoint): orca-dev-75ec878e, level 335434 of 1000000 (T1 330000, T2 450000, band 1)`（`545f452`）。**行号会移动 ⇒ 引用前现测。**
> **本分节的全部代码与判据已由 W2 在 ccloop `f4e49a2` 的 `git clone --local` 副本里整份跑过**：`scratchpad/W2/ccloop/`（`node_modules` 软链到主仓）。T1 的三个文件在副本里用**探针桩**顶替（`src/agents/{types,table,materialize,registry}.ts`，文件头标 `PROBE STUB`，只实现本分节用到的名字），所以 T3／T6 的红绿与变异结论成立的前提是 T1 按骨架的名字与 §0 W2-6、W2-7、W2-8 的假定落地；T1 落地后**必须在真 T1 上重跑本分节全部判据与变异**。日志都在 `scratchpad/W2/`（`t3-*.log`、`t6-*.log`、`mut-*.log`）。
> 主树只写本文件；没有碰两仓任何别的文件。

---

## W2 现量

### 代码事实（本分节的步骤依赖它们）

测量命令：`cat -n <file>`（ccloop `f4e49a2`，Orca `545f452`），读回整份输出；grep 在本机被改写成 rg，行号一律取 `cat -n` 的输出。

| # | 事实 | file:line |
|---|---|---|
| 1 | codex 的进程形状：`spawn(config.command[0], args, {detached:true, env:process.env})`；`kill` 对 `-child.pid` 发信号；`once("spawn")` 里先 `ps -o lstart=`、写 `process.json`、`await context.onProcessRegistered?.(registration)`，**之后**才 `child.stdin.end(prompt)`；中止＝SIGTERM 组、`killGraceMs` 后 SIGKILL 组；`finish()` 无条件再 SIGKILL 一次组 | ccloop `src/runtime/codex/runCodexPhase.ts:19`（签名）、`:47`（spawn）、`:51`（kill）、`:52-66`（finish／stop）、`:89-100`（注册在前、prompt 在后）|
| 2 | `CodexAdapter` 构造只收一个参数；`phase()` 调 `runCodexPhase(this.config, {phase, prompt, context})`；中止的 execute 在 `observedTokens===null` 时答 `null` | `src/runtime/codex/codexAdapter.ts:19`、`:22`、`:38-46` |
| 3 | runner 写死 `execFile("claude", ["-p","--output-format","json","--json-schema",<schema>, prompt])`（prompt 走 argv，不走 stdin）；runner 自己的 stdin 是 JSON 请求，读完才起 claude；claude 子进程**不 detached** ⇒ 与 runner 同组；runner 的 SIGTERM 处理只 `child.kill` claude 本身 | `scripts/claude-phase-runner.mjs:379-396`、`:431-433`、`:283`、`:371-377` |
| 4 | 旧 `SubprocessClaudeAdapter`：非 detached spawn、中止只 `child.kill("SIGTERM")`、从不调 `onProcessRegistered` | `src/runtime/claude/subprocessClaudeAdapter.ts:25-28`、`:48-50`、`:89` |
| 5 | runner 请求形状 `ClaudePhaseRequest`（plan／verify 无 `partialOutcomeRecoveryWindowMs`，execute 有） | `src/runtime/claude/types.ts:7-21` |
| 6 | fake codex：`mode=argv[2]`、`marker=argv[3]`、`args` 取 `exec` 之后；marker 被**覆盖写**成 `{args,cwd,prompt,pid}`；`.calls` 追加 phase；`.tasks` 只在 script 模式追加 `<phase> <key\|->`；hang 类模式在写 `.calls` 之前就返回；不认 `--version` | `tests/fixtures/fake-codex.mjs:3`、`:5`、`:11`、`:13-16`、`:25`、`:38` |
| 7 | prompt 里的任务句式（fake 靠它取脚本键）：plan `Plan one isolated L2 attempt for task X.`、execute `Execute one isolated attempt for task X.`、verify `Verify task X.` | `src/runtime/claude/prompts.ts:15`、`:33`、`:55` |
| 8 | runner 的三个 schema：plan 有 `properties.summary`、execute 是 `oneOf`、verify 有 `properties.approved`（fake claude 据此分阶段） | `scripts/claude-phase-runner.mjs:9-80` |
| 9 | control worker 的注册写法（`processes.json` 数组追加 `registeredAt`）、`parseCodexConfig`、`new CodexAdapter(config)`、注册回调里的「prompt 前闩住」 | `src/control/worker.ts:49-64`、`:107`、`:153`、`:157-164` |
| 10 | 停机证明：`probeAll` 对空数组恒 `true`；`proveStopped` 要 sealed worker＋owner lease 释放＋两次 quiet | `src/control/stopProof.ts:100-108`、`:110-138` |
| 11 | `tsconfig.json`：`rootDir "."`、`outDir "dist"`；`npm run build` 不拷 `scripts/` ⇒ build 后模块在 `dist/src/runtime/claude/`，runner 仍在仓根 `scripts/` | `tsconfig.json:8-9`；`package.json` 的 `build` 脚本 |
| 12 | `cli.ts`：`ParsedArgs` 联合、flag 两两配对的解析、`run` 缺 `--adapter` ⇒ `missing required flags`、`loadAdapter` 的参数类型、codex soft 提示、sweep 在 `loadAdapter` 之前返回 | `src/cli.ts:19-48`、`:138-141`、`:178-188`、`:231-233`、`:319-324` |
| 13 | 可复用夹具：`codexFixture(mode)` 建 git 仓（`answer.txt` 0→42 的 contract，taskId `codex-test`）、`runDir`、`context`、fake codex 配置 | `tests/runtime/codex/fixture.ts:10-29` |
| 14 | Orca 的 `ccloopWorld` 读 `${marker}.calls`／`${marker}.tasks`（一个 marker） | Orca `tests/control/fixtures/ccloopWorld.ts:132`、`:134` |
| 15 | 本机探针：副本里跑 `tests/runtime/claude/subprocessClaudeAdapter.test.ts`、`tests/controller/runLoop.integration.test.ts`、`tests/runtime/codex/`（全部）、`tests/cli/`（全部）＋本分节新文件：**全绿**（`t3-existing.log`：13 文件 179/179；`t6-final.log`：3 文件 53/53——那是删掉一条弱判据、加 codex 判据之前的数，最终 `agentsRun` 11/11 见 `t6-probe3.log`）；`tsc --noEmit` RC 0（`t6-tsc4.log`）；`npm run build` 后 `dist` 里的 `claudeRunnerPath()` 指向存在的 runner（`t3-dist.log`） | 命令见各 Task |

### 与 spec／骨架不一致或骨架没写到的地方（**控制器裁定**；正文按「建议」一栏写）

| # | 问题 | 建议 |
|---|---|---|
| W2-1 | **fake codex 答 `--version` 没有归属**。spec §4.8 只让 fake claude 答 `--version`；但 §4.2 的 `agent-version-drift` 要求 capabilities／accept／`ccloop run` 对**每条**安装记录跑 `command --version`，T5／T6／T7／T16 的 codex 安装记录指向 fake codex，不答就永远 drift | 放进 T3（本分节 Step 3.2 已写）：`--version` 为最后一个参数且无 `exec` ⇒ 打印 `9.9.9-fake\n`、退出 0、不写任何文件 |
| W2-2 | 两个 fake 的版本串。T1 的 `probeVersion` 怎么取版本（整段 trim？cc-switch 的正则 `\d+\.\d+\.\d+(-[\w.]+)?`？）骨架没定 | 两个 fake 都打印 `9.9.9-fake\n`：trim 与该正则都得 `9.9.9-fake`。**需要 T1 确认 `probeVersion` 以 `[...command, "--version"]` 调用（`--version` 是最后一个参数）**——fake claude 要求它是 mode 前缀之后**唯一**的参数，fake codex 要求它是最后一个且没有 `exec` |
| W2-3 | `AgentError` 的 `message` 形状骨架没定。T6 的 CLI 判据按 stderr 含错误码断言（`main` 打印 `error.message`） | T1 定为 `message` 以 `code` 开头（桩里是 `detail===undefined ? code : \`${code}: ${detail}\``）。T3 的判据只读 `.code`，不受影响 |
| W2-4 | 选择文件本身坏了（不是 JSON、多字段、`configHash` 不是 64 位 hex）用什么码？Global Constraints 的码表里没有 | 新码 `agent-selection-file-invalid`（与 `agent-selection-invalid`「model 字符不合」分开，免一码两义）。控制器若要并进已有码，改 T6 的实现与判据各一处 |
| W2-5 | spec §4.7 的证据文件表是 `{request.json, stdout.json, stderr.log, process.json, outcome.json}` | 另加 `usage.json`（runner 给了 `usageEvidence` 时，同 codex 的 `usage.json`）与失败时的 `decode-error.txt`（同 codex）。判据按完整列表钉 |
| W2-6 | 判据 3（空洞成立的回归）在 T3 只能做到**适配器层**：T3 时 worker 还没接描述（那是 T5）。本分节的判据用与 `worker.ts:49-64` 同形的测试内回调写 `processes.json` | **T5 必须再加一条 worker 层的同名判据**：control 起 claude kind 的 run，`processes.json` 非空、组活着时 `proveStopped` 为 `null`，变异同样是删 `onProcessRegistered`。另：本分节判据 3 的 `accepted.protocol: 1` 字面量抄自 `tests/control/stopProof.test.ts:44`；若 T5 把 `AcceptedRecordV1.protocol` 改成 `2`，那条字面量由 T5 一并改（它是本分节新加的判据，不属「既有」） |
| W2-7 | 骨架 `resolveAgent(table, partial, deps?)` 没写默认是否跑 `--version` | 本分节假定：不传 `deps.probeVersion` 时跑真探测，不等 ⇒ 抛 `AgentError("agent-version-drift")`；T6 只调它、不自己再探。T1 若另定，T6 的实现要补探测 |
| W2-8 | 骨架没给 selection 的 zod schema 导出 | T6 在 `cli.ts` 里就地定义选择文件 schema（`strict`）。T1 若导出 `agentSelectionSchema`，T6 改用它（行为不变） |
| W2-9 | `ClaudeAgentAdapter` 的构造函数也拒不能表达的上下文档位（`agent-context-unsupported`），与 T1 的 `validateSelection` 重复 | 故意保留：适配器被直接构造（绕过描述）时照样 fail closed；有判据与变异 |
| W2-10 | 被中止的 claude execute：runner 收到 SIGTERM 时会打一份 partial 结果到 stdout、退出 0；本适配器与 `CodexAdapter` 一样**丢弃**它（reason 已是 `aborted` ⇒ execute 答 `null`）。旧 `SubprocessClaudeAdapter` 会把那份 partial 当结果 | 按 spec §4.7「被中止 ⇒ `ClaudePhaseAborted`」与 codex 对齐；登记，不在本轮恢复 partial |
| W2-11 | `.argv` 记什么：spec 只说「argv 逐次追加」 | fake claude 记 mode 前缀之后的全部参数（即真 claude 会收到的）；fake codex 记从 `exec` 起的全部参数（即真 codex 会收到的）。两边都不记 `--version` 调用 |
| W2-12 | T2 与 T6 都改 `src/cli.ts`（T2 加 `agents detect|validate` 子命令） | T6 的编辑全部以**内容锚点**给出，不依赖行号；谁后落谁按锚点重放 |
| W2-13 | `ccloop run --agents` 是否要核选择文件的 0600／非软链 | spec 只说「由 Orca 写 0600」，没要求 ccloop 核。本分节**不核**（Rule 2）；控制器要核就加 `O_NOFOLLOW`＋mode 检查与一条判据 |
| W2-14 | ccloop Rule 15 只管「改既有判据」。`fake-codex.mjs` 是既有判据共用的夹具；本分节对它**只加**两行（`--version` 早退、`.argv` 追加），现跑确认它的既有判据全绿 | 控制器确认「只加不改」对夹具成立；若要人指名，列进 awaitingHuman |
| W2-15 | Orca 侧：混组 E2E 有两个 marker（fake claude 一个、fake codex 一个），`ccloopWorld` 的 `calls()`／`scripted()` 今天只读一个 marker | 不属本分节；提醒 T7／T16：两份 `.calls`／`.tasks` 格式相同，读者按 marker 分开读或拼接 |

### 会红的既有判据

**无**（现跑）。副本里本分节全部改动叠上之后，受影响面的既有判据文件全绿：`tests/runtime/claude/subprocessClaudeAdapter.test.ts`（28/28，runner 未设环境变量时行为不变）、`tests/controller/runLoop.integration.test.ts`（67/67，同样用 runner）、`tests/runtime/codex/` 全部（`runCodexPhase`、`fakeCodexScript`、`fakeCodexDelay`、`abortedUsage`、`adapter`、`transport`、`fileBoundary`、`protocol`）、`tests/cli/cli.test.ts`、`tests/cli/codex.test.ts`（日志 `t3-existing.log`、`t6-final.log`）。本分节**不改任何既有判据**。

---
