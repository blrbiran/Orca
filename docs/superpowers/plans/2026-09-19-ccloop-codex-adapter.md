# ccloop Codex CLI Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ccloop 通过具名 `codex` adapter 执行 plan/execute/verify，留存真实用量与原始日志，提供隔离的 Codex 替代测试路径。

**Architecture:** 在 ccloop 新增 Codex 配置、输出协议、进程执行器和 RuntimeAdapter 接线。每 phase 启动一个新的 ephemeral Codex exec，接收 JSONL 和结构化最终消息；不借用 Claude 可执行程序或 Claude 包装器。先交付 ccloop 独立可测的软件，再由后续 Orca 控制底座计划接入。

**Tech Stack:** 现有 TypeScript、Node.js、zod、vitest；macOS/Linux 进程组；不新增 npm 依赖。

**Spec:** `docs/superpowers/specs/2026-09-19-task-control-design.md` §10、§13，用户已在 `9b92218` 后批准并要求继续。

归属：Codex task `01a0b792-9ebb-79d0-ba91-604825a9f974`，2026-09-19。
代码基点：ccloop `befb91f9e581ea1369d0ca796246847fa2e6a967`，Orca `9b92218`。
本计划保存在 Orca，所有下述源码路径除明确标注外均相对 `/Users/biran/code/skills/loop/ccloop`。

## Global Constraints

- “Orca 控制 ccloop；ccloop 负责具体 agents 的执行适配。”本切片不修改 Orca chain、scheduler 或 Web。
- “紧急改变的是实施顺序，不改变长期适配优先级。”Claude Code > Codex CLI > OpenCode > oh-my-pi > pi。
- “实时用量、发停止信号和及时退出都不是 token 硬限额的证明。”此 adapter 只允许显式 `budgetMode: "soft"`；严格模式按名拒绝。
- “未知结算继续占用预留”属于后续控制底座；本切片对缺失／无效／含混零用量拒绝成功结果，不能给当前 controller 一个默认 0。
- “不得启用 bypass sandbox / hook trust / ignore rules 以让验收强行通过。”不加入这些参数，不关闭目标仓库规则。
- “Claude 真机验收仍列 awaitingHuman”——9 月 22 日 09:00 后也不在本计划中自动跑 Claude。
- ccloop Rule 15：只新增测试文件，不修改既有判据。Rule 17：变异只在本地 clone，改代码后重跑变异；证明还原的两个 diff 字节数。
- 所有 shell 命令加 `rtk proxy`；验证命令重定向并整份读回，核对 vitest RUN 路径与进程退出码。
- 原生 ccloop resume/sweep 保持其现有恢复含义；本切片不实现 §13.3 新交接协议，不宣称 paused 可续接或跨 agent 原生 session 恢复。
- 不 push、不合并、不删除分支/worktree；开发分支使用 `codex/` 前缀。现有规则和历史注释不就地删改。

## Review Focus

1. 配置中的 command/model 像参数注入、可执行文件缺失：不用 shell、模型作为单个 argv，缺失直接失败，不找 Claude 或后续 PATH（Task 1/2）。
2. JSONL 被任意分块，终态重复或缺失：只接受完整且一致的一次 exec 结果，重复用量不累加（Task 1/2）。
3. abort 已触发、child 忽略 SIGTERM、后代持有 pipe：不提前成功、不挂住、不把清理后的状态当断言证据（Task 2）。
4. 模型在结构化结果里伪造 tokenUsage、零用量来自 CLI 默认值：只信事件证据，未知不能当零（Task 1/3）。
5. execute 已写文件后失败／超时：原始日志保留，controller 捕获／发布的真实产物可读，不把失败的模型 JSON当成功（Task 3/4）。

## 边界与已经核实的依据

本机 `codex exec --help`（0.155.1）支持 `--json --output-schema -o --ephemeral --sandbox --model -C`。
源码快照 `/Users/biran/code/skills/agent/codex` 的 `6478a751fde8884b2fdc76486fe23175a8e795d4`：
`sdk/typescript/src/events.ts`、`items.ts` 和 `codex-rs/exec/src/event_processor_with_jsonl_output.rs`。
`turn.completed.usage` 来自 thread total；未收到 usage 时实现会给默认零。源码快照不等于已安装二进制的服务实测。
因此只启动 fresh exec、不调用 exec resume；一阶段仅接受一个 distinct completed 总量，不能把事件逐行求和。
全零值不能区分真实零与未观测，按 `codex-usage-unavailable` 拒绝，并保存原始事件供核对。

配置建议如下；这里的 model 是离线测试专用假名，不可用于真调用：

```json
{
  "command": ["/absolute/path/to/codex"],
  "model": "fixture-model",
  "budgetMode": "soft",
  "sandbox": "read-only",
  "timeoutMs": 120000,
  "killGraceMs": 250
}
```

`command[0]` 必须绝对路径；其余项仅作可执行程序的固定前缀参数（测试用绝对 node + fake.mjs），
末尾由代码追加完整 exec 参数。真实配置必须指向 Codex 本体，不接受自由 exec args、profile、shell 字符串。
计划/验证阶段固定 read-only；execute 使用配置的 read-only 或 workspace-write，禁止 danger-full-access。
继承用户配置与规则，不传 ignore-user-config；实际配置/权限阻止验收时如实记录，不能修改它们强行通过。

目录布局：`<runDir>/codex/<attempt>/<phase>/<uuid>/`，目录 0700，文件 0600，
保存 `schema.json`、`final.json`、`events.jsonl`、`stderr.log`、`process.json`、`outcome.json`。
UUID 避免同 phase 重试读到旧 final；outcome 保存 executable、argv、版本观测、退出原因、用量判定，
不复制环境变量或 auth 文件。不做本切片日志自动删除。

## Task 1: 配置与结果协议

**Files:** Create `src/runtime/codex/protocol.ts`; Create `tests/runtime/codex/protocol.test.ts`。

**Interfaces:**

```ts
type CodexPhase = "plan" | "execute" | "verify";
type CodexConfig = {
  command: [string, ...string[]]; model: string; budgetMode: "soft";
  sandbox: "read-only" | "workspace-write"; timeoutMs: number; killGraceMs: number;
};
// These exports are defined in protocol.ts, not copied into callers.
parseCodexConfig(raw: unknown): CodexConfig;
phaseJsonSchema(phase: CodexPhase): Record<string, unknown>;
decodeCodexResult(phase: CodexPhase, events: string, final: string):
  AttemptPlan | ExecutionResult | VerificationResult;
```

- [ ] 写下列核心红测（import 新模块和 vitest），并在同文件按表补全输入：

```ts
const event = (usage: unknown) => JSON.stringify({type: "turn.completed", usage}) + "\n";
const final = JSON.stringify({summary: "inspect target", primaryTargetPaths: ["answer.txt"]});
it("counts cached input once and ignores an identical completed duplicate", () => {
  const line = event({input_tokens: 12, cached_input_tokens: 8, output_tokens: 3});
  expect(decodeCodexResult("plan", line + line, final)).toMatchObject({tokenUsage: 15});
});
it("refuses synthesized zero usage", () => {
  expect(() => decodeCodexResult("plan", event({input_tokens: 0, output_tokens: 0}), final))
    .toThrow("codex-usage-unavailable");
});
it("does not accept success-shaped payload without completion", () => {
  expect(() => decodeCodexResult("plan", "", final)).toThrow("codex-no-completion");
});
```

输入表：负数、非整数、超安全整数、字符串、缺 input/output、不同的两个 completed、
`turn.failed`、顶层 `error`、坏 JSONL、final 非 JSON、错 phase 字段、伪造 tokenUsage/usageEvidence。
未知但合法的事件 type 可忽略；已知 error 即使之后 completed 也拒绝。零成本不得伪造成美元 0。
- [ ] 在 ccloop 根运行并完整读回：

```sh
rtk proxy sh -c 'node_modules/.bin/vitest run tests/runtime/codex/protocol.test.ts > /tmp/codex-protocol.log 2>&1; rc=$?; cat /tmp/codex-protocol.log; exit "$rc"'
```

初次预期 RC 非 0，原因是新模块未实现；最终必须全部断言通过，不能把 import 错误当变异成功。
- [ ] 实现 strict zod 配置。拒绝未知 key、相对 command[0]、空 model、非正 timeout、负 grace、strict mode。
输出 schema 使用 JSON Schema object、required 全字段、additionalProperties:false：
plan 为 summary/string 与 primaryTargetPaths/string[]；execute 为 changedFiles/string[]、diffPatch/string、
commandOutputs/string[]、stdoutStderrLog/string；verify 为 RuntimeAdapter VerificationResult 的业务字段，
failingCommand 为 string|null，其余字符串/字符串数组/布尔按现有类型。execute 也接受既有 partial 形状，
用 anyOf 分开完整与 partial（后者增加 completionStatus:"partial"、failureType:timeout|error、failureMessage）。
本地 zod 再校验所有业务字段；tokenUsage/usageEvidence 不属于模型 schema，出现即拒绝。

用量归一化核心：

```ts
const integer = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
if (!integer(input) || !integer(output) || !Number.isSafeInteger(input + output))
  throw new Error("codex-usage-invalid");
if (input + output === 0) throw new Error("codex-usage-unavailable");
// cached/reasoning fields are subsets; no addition to input + output.
const tokenUsage = input + output;
```

附加现有 `UsageEvidence`：usageStatus present；input_tokens/output_tokens finite；camelCase 字段 absent；
selectedInputField/input_tokens，selectedOutputField/output_tokens，normalizedTotal=tokenUsage。
若有 cached_input_tokens 则要求整数且 <=input，reasoning_output_tokens 同理 <=output；保留原始事件，不把附加字段拷入业务结果。
- [ ] 同一命令转绿；在本地 clone 分别删除 no-completion guard、把 tokenUsage 改成 input+output+cached、
移除模型字段拒绝、放过零值，各自必须由具名测试变红；还原后重跑。
- [ ] 提交：`rtk proxy git add src/runtime/codex/protocol.ts tests/runtime/codex/protocol.test.ts`；
`rtk proxy git commit -m 'feat(codex): validate phase results and usage evidence'`。

## Task 2: 有界进程执行与原始证据

**Files:** Create `src/runtime/codex/runCodexPhase.ts`; Create `tests/fixtures/fake-codex.mjs`;
Create `tests/runtime/codex/runCodexPhase.test.ts`。

**Interfaces:** consumes Task 1 exports；produces：

```ts
type PhaseRequest = { phase: CodexPhase; prompt: string; context: AttemptContext };
type PhaseOutcome = {
  reason: "completed" | "aborted" | "timeout" | "spawn-error" | "exit-error" | "output-limit" | "io-error";
  code: number | null; signal: NodeJS.Signals | null;
  events: string; final: string | null; evidenceDir: string;
};
runCodexPhase(config: CodexConfig, request: PhaseRequest): Promise<PhaseOutcome>;
```

- [ ] fixture 使用明确的 Node 入口，不靠 PATH：`command:[process.execPath, absoluteFakePath, mode, markerPath]`。
fixture 模式 `ok` 核心如下（argv 中第一个 `exec` 之后才是 adapter 生成参数）：

```js
import { writeFileSync } from "node:fs";
const execIndex = process.argv.indexOf("exec");
const args = process.argv.slice(execIndex + 1);
const value = (flag) => args[args.indexOf(flag) + 1];
let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", c => { prompt += c; });
process.stdin.on("end", () => {
  writeFileSync(process.argv[3], JSON.stringify({args, cwd:process.cwd(), prompt}));
  writeFileSync(value("-o"), '{"summary":"fixture","primaryTargetPaths":["answer.txt"]}');
  process.stdout.write('{"type":"turn.completed","usage":{"input_tokens":12,"output_tokens":3}}\n');
});
```

mode 在 argv[2]、markerPath 在 argv[3]；完整 fixture 按 mode 分支，不能启动任何真实 agent。
增加 `bad-json`、`nonzero`、`missing-final`、`hang`、`ignore-term`、`child-holds-pipe`、`split-utf8` 模式。
同组 child 写自己的 pid 和启动标记；测试观察其存活后才能触发 abort，teardown 只清理测试创建的进程。
- [ ] 新测断言：cwd 等于 context.worktreePath；stdin 含 prompt；argv 全数组比对；
模型字符串 `fixture;touch nope` 是单参数；绝对不存在命令 spawn-error，fixture marker 不出现；
pre-aborted 不 spawn；成功后同组 child 在测试 cleanup 前退出；ignore-term 被 SIGKILL；
退出后持管后代不让 Promise 挂住；split UTF-8 还原正确；原始 stderr 和 JSONL 留在 evidenceDir；
missing final 不读取其他调用留下的文件。用测试实际 pid 查进程，不用仅看退出码代替清理验证。
- [ ] 红测命令：

```sh
rtk proxy sh -c 'node_modules/.bin/vitest run tests/runtime/codex/runCodexPhase.test.ts > /tmp/codex-process.log 2>&1; rc=$?; cat /tmp/codex-process.log; exit "$rc"'
```

- [ ] 参数和启动的实现骨架如下；schema/final 路径均来自此次 UUID 证据目录：

```ts
const args = [...config.command.slice(1), "exec", "--json", "--ephemeral", "--color", "never",
  "--model", config.model, "--sandbox", request.phase === "execute" ? config.sandbox : "read-only",
  "-C", request.context.worktreePath, "--output-schema", schemaPath, "-o", finalPath, "-"];
const child = spawn(config.command[0], args, {
  cwd: request.context.worktreePath, detached: true,
  stdio: ["pipe", "pipe", "pipe"], env: process.env,
});
```

先检查 abort，再创建 agent；创建后先装 error/exit/close/stdin-error/abort 监听再写 stdin，
安装 abort listener 后再次检查 aborted，封住检查与安装之间竞态。用 StringDecoder 解 UTF-8。
在写 prompt 前持久记录 process.json 的 pid/pgid 及通过 ps 读取的进程启动标识，供验收 watchdog 清理；
记录失败则终止此 child，不能继续模型调用。这里的启动标识不是 ccloop 自己的 buildProcessInstanceId。
从 spawn 起启用 timeoutMs deadline，最短取配置超时与 context 当前剩余总时长；剩余<=0 不 spawn。
abort/timeout 锁存原因，SIGTERM 到负 pid，killGraceMs 后 SIGKILL；即使 parent 提前退出也回收同组。
正常 exit 允许最多 1000ms drain 等 close；到期 kill group、销毁管道。完成解析只在 drain 后，
非 0／signal／abort 不能升级 completed。所有 timer/listener 必须只清理一次，最终日志流完成写入后 resolve。
stdout/stderr/final 各 16 MiB 上限；超过即终止并记 output-limit，保留截断标记而非冒充完整日志。
final 必须为普通文件、非符号链接，读取只限此次路径；读写错误记 io-error，不能默默丢证据。
- [ ] 转绿后在 clone 删除 group kill、pre-abort guard、deadline、UUID 隔离各自变异。
必须观察红在行为断言；所有故障测试自身用 10s deadline（进程普通测试 30s test timeout），防变异挂死整套。
- [ ] 提交三个本 task 文件：`rtk proxy git commit -m 'feat(codex): run isolated phases with bounded process cleanup'`，提交前逐个 `git add` 上述路径。

## Task 3: RuntimeAdapter 与 controller 真实接缝

**Files:** Create `src/runtime/codex/codexAdapter.ts`; Create `tests/runtime/codex/adapter.test.ts`;
Create `tests/controller/codex.integration.test.ts`。
只读复用 `src/runtime/claude/prompts.ts` 的三个纯 prompt builder；它们不运行 Claude，不迁移/重写旧模块。

**Interfaces:** `class CodexAdapter implements RuntimeAdapter`，constructor(rawConfig:unknown)，
plan/execute/verify 签名完全沿用 `src/runtime/types.ts`。构造解析配置但不 spawn。

- [ ] 新测试创建独立 Git fixture（配置本地 test user，提交 answer.txt），通过实际 runLoop 调 adapter，
fake 根据 phase schema 的 properties 判定 plan/execute/verify，execute 写 answer.txt 为 `42\n`，
并返回完整业务字段；verifierType 必须为 agent，verify 传 approved=true，requiredChecks 用 Node 读取 answer.txt 比对。
当前 controller 在 requiredChecks 通过后才调用 agent verifier；command verifier 会跳过 adapter.verify，不能用于三阶段覆盖。
测试从真实 run 读取终态、attempt ref、plan/execute/verify artifacts，不用测试自己预先写入的状态断言成功。
每 phase 用量 15，最终剩余预算应为起始预算-45；缓存不再重复扣。
- [ ] 加下面的 adapter 语义测试（ctx 由本测试 fixture 使用 loopContractSchema.parse 构造，state 用完整 RunState）：

```ts
const abort = new AbortController(); abort.abort();
const stopped = new CodexAdapter(config);
expect(await stopped.execute({...ctx, abortSignal: abort.signal})).toBeNull();
await expect(stopped.plan({...ctx, abortSignal: abort.signal})).rejects.toThrow("codex-aborted");
await expect(stopped.verify({...ctx, abortSignal: abort.signal})).rejects.toThrow("codex-aborted");
```

另测：execute 写完 answer 后 hang 到 controller deadline，controller 现有 recovery 的 attempt ref 能读到 answer 内容；
fake 非0但 final 看似完整不能成功；usage 缺失不得让 controller 继续 verify；部分模型 execute 结果必须保留 partial 标记。
- [ ] 红测命令：

```sh
rtk proxy sh -c 'node_modules/.bin/vitest run tests/runtime/codex/adapter.test.ts tests/controller/codex.integration.test.ts > /tmp/codex-adapter.log 2>&1; rc=$?; cat /tmp/codex-adapter.log; exit "$rc"'
```

- [ ] 实现统一私有 phase 方法：调用 Task 2，completed 且 final!=null 才调用 decodeCodexResult；
其他情况抛 `codex-<reason>` 并带 evidenceDir。execute 仅在 context.abortSignal.aborted 时返回 null，
让现有 controller 的超时捕获负责机械恢复；不生成凭空的 complete/partial 成功对象。
plan/verify 的 abort 仍抛错。phase 业务校验后返回对应类型；不要 `as T` 跳过运行时验证。
结果附带现有 usageEvidence；额外诊断只放 evidenceDir，不扩充现有 RunState。
本 task 不修改 controller，若它不能保留已写产物，先报告具体失败并修订范围，不能删除对应测试。
- [ ] 转绿；clone 内将 execute-abort 改为虚假完整成功、丢弃 usageEvidence、忽略非0退出，各观察新测试变红。
- [ ] 提交 task 文件，主题 `feat(codex): adapt phases to ccloop runtime outcomes`。

## Task 4: CLI 接线与全量离线验证

**Files:** Modify `src/cli.ts`, `src/sweep/sweepRuns.ts`（仅 adapterName 类型）；
Create `tests/cli/codex.test.ts`; Create `docs/codex-adapter.md`。

**Interfaces:** run/resume/sweep 接受 adapter `scripted|claude|codex`，run/resume 的既有退出码不变；
sweep 仍在领取前不构造 adapter，不改扫描与接管规则。

- [ ] 新增 parseArgs 的三命令完整对象断言、unknown adapter 拒绝，main 通过假 Codex 跑真实 fixture 的集成测试。
CLI 进程显式 `process.execPath + --import tsx + src/cli.ts`，独立 cwd；不得依赖当前 shell PATH 的 codex。
strict 配置下 main 返回1且无 fake marker；软配置日志明确提醒 soft，无严格保证。
`ls/unlock` 的 CLI 使用不引入 adapter；原 scripted/claude 用现有测试回归，不改这些测试。
- [ ] 运行红测：

```sh
rtk proxy sh -c 'node_modules/.bin/vitest run tests/cli/codex.test.ts > /tmp/codex-cli.log 2>&1; rc=$?; cat /tmp/codex-cli.log; exit "$rc"'
```

- [ ] 三个 ParsedArgs adapter union、两处 parse guard、buildAdapter 参数和 sweep 的 adapterName 类型增加 codex。
buildAdapter 保留 scripted 分支，新增以下分支，最后仍为原 Claude 分支：

```ts
if (adapter === "codex") return new CodexAdapter(config);
```

run/resume 输出 soft 提示；sweep 使用现有 adapter banner 外另加 soft 提示，但不提前构造适配器。
文档写配置全字段、证据目录、支持的能力和错误名称，明确原生 resume 并非新任务交接。
新增 union 造成既有测试失败时先核实断言是否确实覆盖 invalid adapter，不能自行改旧测试。
- [ ] 转绿；clone 删除 buildAdapter codex 分支、漏一个命令 parse guard、把strict放行，分别观察 red。
- [ ] 全量命令（执行器支持至少 600000ms 或后台，不截断验证）：

```sh
rtk proxy sh -c 'npm run typecheck > /tmp/ccloop-codex-typecheck.log 2>&1; rc=$?; cat /tmp/ccloop-codex-typecheck.log; exit "$rc"'
rtk proxy sh -c 'npm test > /tmp/ccloop-codex-tests.log 2>&1; rc=$?; cat /tmp/ccloop-codex-tests.log; exit "$rc"'
rtk proxy sh -c 'npm run build > /tmp/ccloop-codex-build.log 2>&1; rc=$?; cat /tmp/ccloop-codex-build.log; exit "$rc"'
```

若工具显示截断，按连续区间读取保存的日志直至整份看完；不能筛选通过/失败摘要替代。
全量跑无跳过，计数由实际输出记录，不预填。检查真实 `~/.orca` 未出现、没有 fake child 残留。
- [ ] 提交 task 文件，主题 `feat(cli): expose the codex runtime adapter`。

## Task 5: 一次隔离真机验收与证据交接

**Files:** Create `scripts/validate-codex-adapter.mjs`; Create `tests/validation/codexAdapter.test.ts`;
Append `docs/codex-adapter.md` 验收记录。此脚本不加入 npm test 自动执行。

**Interfaces:** `node scripts/validate-codex-adapter.mjs --codex <absolute-bin> --model <name> --output <new-dir>`。
参数缺失或 output 已存在时 RC1，不创建 agent；脚本失败不得重试或退回 Claude。

- [ ] 用假 Codex 测脚本的成功、坏结果、额度错误、不完整参数、新目录独占创建，证明失败只有一次逻辑验收。
调用进程的入口为 Task 4 构建好的 dist/cli.js，配置明确 budgetMode soft，不伪装严格验收。
从子 CLI exit、loop-state、独立检查 answer.txt=42、三阶段证据完整性共同决定 RC0，不能只看模型自报 succeeded。
- [ ] 先红后绿命令：

```sh
rtk proxy sh -c 'node_modules/.bin/vitest run tests/validation/codexAdapter.test.ts > /tmp/codex-validation.log 2>&1; rc=$?; cat /tmp/codex-validation.log; exit "$rc"'
```

- [ ] 脚本用 mkdtemp 建 repo（无远端），提交 answer.txt=0 与最小 AGENTS.md：只修改 answer.txt，
不联网、不读其他路径、不安装工具、不提交、不启动子 agent。生成满足 loopContractSchema 的契约：
taskId codex-smoke、目标 answer=42、maxAttempts1、perAttemptTimeoutMs120000、总时长360000、
tokenBudget100000（软上限，不是预计消耗）、partialOutcomeRecoveryWindowMs1000、allowlist answer.txt、
maxFilesTouched1、agent verifier、requiredChecks 为绝对 Node 可执行程序读取 answer.txt 的比较脚本。
比较脚本位于 output 下独立路径，由 controller 在 attempt cwd 执行；测试同时核对第三阶段调用证据，不能只数 final 文件。
outer wrapper 420000ms deadline；watchdog 读取本次 output 内 process.json 并持续记录实际 child 身份。
Codex 是 detached 进程组，只杀 ccloop 的组不够：watchdog 必须核对启动标识后逐个回收已登记的 Codex 组，
再回收 CLI；组长已退出时用先前观测的同组成员身份核对，不对未知／复用 pid 盲杀。
假验收增加“ccloop 被外层超时终止、Codex 忽略 TERM”场景，清理前观察 child 确实存活，清理后确认无残留。
清点有无法确认的进程则验收失败并报告身份，不能宣布清理完成。留下整个 output 供审阅。
保存 codex --version、三阶段 raw logs、controller状态、Git产物、实际usage和退出码；拿不到美元成本写 unknown。

验收命令模板（执行前填入经过本地核对的绝对可执行路径和可用模型，不能照抄假名）：

```sh
rtk proxy node scripts/validate-codex-adapter.mjs --codex "$CODEX_TEST_BIN" --model "$CODEX_TEST_MODEL" --output "$CODEX_TEST_OUTPUT"
```

三个变量是执行参数，不是隐藏默认值；执行者必须先输出非敏感 resolved path/model/output 供记录。
用户批准本计划后授权这一次三阶段有界验收；若模型尚未指定，先沿用并记录用户本机明确配置的 model，
没有该配置再请求模型选择，不猜一个服务端可用名。本轮只编写计划，不产生模型调用。
一次运行内 plan/execute/verify 各一个 fresh exec，至多三次 CLI 启动；底层请求次数不等于三，按 raw usage 记账。
额度/auth失败立即停止后续阶段并记录未完成；不能等到9月22日自动改用Claude。
- [ ] clone 变异删除独立 answer 检查，让 fake 自报成功但不改文件，脚本必须由对应测试打红；
删 outer timeout 后 hang fixture 要由测试外层限时失败；恢复确认两个 diff 字节数为0。
- [ ] 脚本与新测试加完后重跑 Task4 的 typecheck/npm test/build；通过后只执行上面一次真实验收。
真机失败保留具体证据，不把离线全绿包装成活体通过。
- [ ] 提交脚本、测试与验收文档，主题 `test(codex): add an isolated live acceptance harness`。

## 开工与收尾清单

- [ ] 读两仓规则和 handoff；现查 ccloop local/remote main、工作树和在飞修改，不能把本计划基点当当前状态。
- [ ] 创建隔离 checkout 时用 using-git-worktrees；多仓只改本计划 ccloop 文件，不占用其他人的分支。
- [ ] 开工 ccloop typecheck/npm test/build 各完整读回，保存基线；环境失败单列，不用修改判据掩盖。
- [ ] 每 task 变异只在 clone，未提交代码复制进去；保存变异前后源 hash、命令、RC和完整日志，
  结束以 git show 还原自己的测试/生产文件，量 git diff 和 git diff --cached 字节数，清理自己的 fake children。
- [ ] 最后独立整支审查；本地提交，追加两仓必要 handoff，不 push/merge/delete worktree。
- [ ] 报告分别列离线验证、真机验证、尚未实现能力。下一计划是 §13.6 控制底座，不把它塞进本切片。

## 自审与执行方式

规格映射：§10 参数/结果/取消/用量 → Tasks1–3；具名 CLI → Task4；隔离真机 → Task5。
§13 严格封顶、全组账本、新交接、归档一致性是后续子系统；本切片通过显式 soft 与能力边界避免假装已实现。
Review Focus 五类分别在任务中有行为测试及故障条件；既有判据零改动；新增依赖零。
计划里的测试文件和脚本是待创建交付物，以上命令尚未运行，不代表当前仓库已存在这些能力。

建议 **Native**：五个任务按配置→进程→adapter→CLI→验收顺序强依赖，当前会话连续实现可减少接口漂移，
完成后由独立 reviewer 做整支审查。也可选择 subagent-driven，逐任务实施与独立审查。
本计划等待书面审阅及执行方式选择；未开始产品实现。
