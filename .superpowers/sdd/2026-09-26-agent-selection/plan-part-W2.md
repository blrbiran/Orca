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

### Task 3：CLI 层 fake claude、fake codex `.argv`／`--version`、runner 环境变量、codex `extraEnv`、`ClaudeAgentAdapter`

**Files:**
- Create: `tests/fixtures/fake-claude-cli.mjs`
- Modify: `tests/fixtures/fake-codex.mjs:3`（在 `const mode=…` 之后插两行；其余不动）
- Modify: `scripts/claude-phase-runner.mjs:379-396`（`runClaude`）、`:431-436`（`main` 开头）
- Modify: `src/runtime/codex/runCodexPhase.ts:19`、`:47`
- Modify: `src/runtime/codex/codexAdapter.ts:19`、`:22`
- Create: `src/runtime/claude/claudeAgentAdapter.ts`
- Test（全部新文件）：`tests/runtime/claude/fakeClaudeCli.test.ts`、`tests/runtime/codex/fakeCodexArgv.test.ts`、`tests/runtime/claude/claudePhaseRunnerEnv.test.ts`、`tests/runtime/codex/extraEnv.test.ts`、`tests/runtime/claude/claudeAgentAdapter.test.ts`

**Interfaces:**
- Consumes（T1）：`src/agents/types.ts` 的 `MaterializedAgentConfigV1`、`AgentError`（`.code`）。
- Produces：`ClaudeAgentAdapter`（`constructor(config: MaterializedAgentConfigV1)`，实现 `RuntimeAdapter`）、`ClaudePhaseAborted`（`evidenceDir: string`、`observedTokens: null`）、`claudeRunnerPath(): string`；runner 环境变量 `CCLOOP_CLAUDE_COMMAND`／`CCLOOP_CLAUDE_EXTRA_ARGS`（JSON 数组）；`runCodexPhase(config, request, extraEnv?: Record<string,string>)`；`new CodexAdapter(rawConfig, extraEnv?)`；`tests/fixtures/fake-claude-cli.mjs`（`ok|script|hang|grandchild` 模式；`.argv`／`.calls`／`.tasks`；`--version` ⇒ `9.9.9-fake`）；fake codex 的 `.argv` 与 `--version`。T1 的 claude 描述 `createAdapter` ＝ `new ClaudeAgentAdapter(config)`；codex 描述 `createAdapter` ＝ `new CodexAdapter(toCodexConfig(config), config.installation.configDir === null ? undefined : { CODEX_HOME: config.installation.configDir })`。

命令约定（每步都用）：`C=/Users/biran/code/skills/loop/ccloop`；`S=/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/75ec878e-a6d3-4299-9a4b-b76dd574b77a/scratchpad/<实施席 id>/T3`（先 `mkdir -p $S`）；在 `$C` 下跑；每个日志跑完**整份读回**。

#### 3.1 CLI 层 fake claude

- [ ] **Step 3.1.1：写失败的判据** —— 新建 `tests/runtime/claude/fakeClaudeCli.test.ts`：

```ts
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// Orca agent selection (2026-09-26), spec §4.8: the CLI-layer fake claude. Orca's ccloopWorld reads
// `.calls` and `.tasks` with the readers it already uses for fake codex, so both formats are pinned here
// to fake codex's exactly; `.argv` is how the E2E sees a selection reach the CLI.
const fake = fileURLToPath(new URL("../../fixtures/fake-claude-cli.mjs", import.meta.url));
const CONTINUATION = "Treat continuation input fields unfinished, pendingDecisions, and awaitingHuman as required planning inputs.";
// The fixture tells phases apart by the --json-schema the phase runner passes (scripts/claude-phase-runner.mjs).
const schemas = {
  plan: { type: "object", properties: { summary: {}, primaryTargetPaths: {} } },
  execute: { oneOf: [{}, {}] },
  verify: { type: "object", properties: { approved: {} } },
} as const;
const prompts = {
  plan: (task: string) => `Return JSON only.\nPlan one isolated L2 attempt for task ${task}.\nGoal: x`,
  execute: (task: string) => `Return JSON only.\nExecute one isolated attempt for task ${task}.\nGoal: x`,
  verify: (task: string) => `Return JSON only.\nVerify task ${task}.\nGoal: x`,
} as const;
type Phase = keyof typeof schemas;
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function workdir(): Promise<string> {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), "fake-claude-cli-")));
  roots.push(cwd);
  return cwd;
}

function launch(cwd: string, argv: string[]): Promise<{ code: number | null; stdout: string; stderr: string; elapsedMs: number }> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fake, ...argv], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr, elapsedMs: Date.now() - startedAt }));
  });
}

const claudeArgs = (phase: Phase, prompt: string, model?: string) =>
  ["-p", "--output-format", "json", "--json-schema", JSON.stringify(schemas[phase]), ...(model === undefined ? [] : ["--model", model]), prompt];

async function scripted(cwd: string, phase: Phase, prompt: string, script: Record<string, unknown>) {
  const scriptPath = join(cwd, "script.json");
  await writeFile(scriptPath, JSON.stringify(script));
  return launch(cwd, ["script", join(cwd, "marker.json"), scriptPath, ...claudeArgs(phase, prompt, "claude-opus-5-5")]);
}

describe("fake claude CLI (Orca agent selection, spec §4.8)", () => {
  it("answers --version and writes nothing", async () => {
    const cwd = await workdir();
    const result = await launch(cwd, ["script", join(cwd, "marker.json"), join(cwd, "script.json"), "--version"]);
    expect(result).toMatchObject({ code: 0, stdout: "9.9.9-fake\n" });
    for (const suffix of ["", ".argv", ".calls", ".tasks"]) expect(existsSync(join(cwd, `marker.json${suffix}`))).toBe(false);
  });

  it("prints the claude json envelope with structured_output and usage for each phase", async () => {
    const cwd = await workdir();
    for (const phase of ["plan", "execute", "verify"] as const) {
      const result = await launch(cwd, ["ok", join(cwd, "marker.json"), ...claudeArgs(phase, prompts[phase]("a"))]);
      expect(result.code).toBe(0);
      const envelope = JSON.parse(result.stdout);
      expect(envelope.usage).toEqual({ input_tokens: 12, output_tokens: 3 });
      expect(Object.keys(envelope.structured_output)).toContain({ plan: "summary", execute: "changedFiles", verify: "approved" }[phase]);
    }
    expect(await readFile(join(cwd, "marker.json.calls"), "utf8")).toBe("plan\nexecute\nverify\n");
  });

  it("appends one JSON argv line per call and keeps fake codex's .calls and .tasks formats", async () => {
    const cwd = await workdir();
    const script = { a: { files: { "a.txt": "A\n" } } };
    for (const phase of ["plan", "execute", "verify"] as const) expect((await scripted(cwd, phase, prompts[phase]("a"), script)).code).toBe(0);
    expect(await readFile(join(cwd, "a.txt"), "utf8")).toBe("A\n");
    expect(await readFile(join(cwd, "marker.json.calls"), "utf8")).toBe("plan\nexecute\nverify\n");
    expect(await readFile(join(cwd, "marker.json.tasks"), "utf8")).toBe("plan a\nexecute a\nverify a\n");
    const argv = (await readFile(join(cwd, "marker.json.argv"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(argv).toEqual([claudeArgs("plan", prompts.plan("a"), "claude-opus-5-5"), claudeArgs("execute", prompts.execute("a"), "claude-opus-5-5"), claudeArgs("verify", prompts.verify("a"), "claude-opus-5-5")]);
  });

  it("uses the <task>#continuation entry when the prompt carries ccloop's continuation constraint", async () => {
    const cwd = await workdir();
    const script = { a: { files: { "a.txt": "first\n" } }, "a#continuation": { files: { "a.txt": "continued\n" } } };
    expect((await scripted(cwd, "execute", `${prompts.execute("a")}\n${CONTINUATION}`, script)).code).toBe(0);
    expect(await readFile(join(cwd, "a.txt"), "utf8")).toBe("continued\n");
    expect(await readFile(join(cwd, "marker.json.tasks"), "utf8")).toBe("execute a#continuation\n");
  });

  it("sleeps delayMs for the named phase before answering", async () => {
    const cwd = await workdir();
    const result = await scripted(cwd, "plan", prompts.plan("a"), { a: { files: {}, delayMs: { plan: 600 } } });
    expect(result.code).toBe(0);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(600);
    expect(JSON.parse(result.stdout).structured_output.summary).toBe("fixture");
  });

  it("refuses by name, writes no file and prints no answer when the script has no execute entry for the task", async () => {
    const cwd = await workdir();
    const result = await scripted(cwd, "execute", prompts.execute("c"), { a: { files: { "a.txt": "A\n" } } });
    expect(result.code).toBe(3);
    expect(result.stderr).toContain("fake-claude-cli script has no entry for task c");
    expect(result.stdout).toBe("");
    expect(existsSync(join(cwd, "a.txt"))).toBe(false);
    expect(await readFile(join(cwd, "marker.json.tasks"), "utf8")).toBe("execute -\n");
  });

  it("rejects an argument the phase runner never passes, so runner drift is loud", async () => {
    const cwd = await workdir();
    const result = await launch(cwd, ["ok", join(cwd, "marker.json"), "-p", "--output-format", "json", "--json-schema", "{}", "--verbose", "x"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("fake-claude-cli: unknown argument --verbose");
  });
});
```

- [ ] **Step 3.1.2：跑，确认红**

`./node_modules/.bin/vitest run tests/runtime/claude/fakeClaudeCli.test.ts > $S/t3-1-red.log 2>&1; echo rc=$?`

预期：`rc=1`，7 条全红——夹具文件不存在，node 以 `Cannot find module …/fake-claude-cli.mjs` 退出 1（`code` 期望 0／2／3 而得 1；读 marker 文件 ENOENT）。

- [ ] **Step 3.1.3：实现** —— 新建 `tests/fixtures/fake-claude-cli.mjs`：

```js
// Orca agent selection (2026-09-26), spec §4.8: a stand-in for the `claude` BINARY (the CLI layer), reached
// through ClaudeAgentAdapter -> scripts/claude-phase-runner.mjs. The older tests/fixtures/fake-claude.mjs
// stands in for the runner layer and stays untouched (spec §12 C1).
//
// argv: <mode> <marker> [<scriptPath>, only in mode "script"] ...<the arguments the real claude receives>
// Modes: "ok" (fixed answers), "script" (answers per task, as fake codex's script mode), "hang" (never
// answers), "grandchild" (starts a TERM-ignoring grandchild, not detached so it stays in the runner's process group, then never answers).
// Files next to <marker>, all appended, one line per call:
//   <marker>.argv   the claude arguments as one JSON array (every call except `--version`)
//   <marker>.calls  `<phase>`                     (fake codex's format; not written by hang/grandchild)
//   <marker>.tasks  `<phase> <entry key or ->`   (fake codex's format; script mode only)
// <marker> itself is overwritten with {args, cwd, prompt, model, claudeConfigDir, pid} on every call.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";

const mode = process.argv[2], marker = process.argv[3];
const args = process.argv.slice(mode === "script" ? 5 : 4);
if (args.length === 1 && args[0] === "--version") {
  await new Promise((resolve) => process.stdout.write("9.9.9-fake\n", resolve));
  process.exit(0);
}
appendFileSync(`${marker}.argv`, `${JSON.stringify(args)}\n`);

const fail = (message) => { process.stderr.write(`fake-claude-cli: ${message}\n`); process.exit(2); };
let print = false, outputFormat, schemaText, model = null, prompt;
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "-p") { print = true; continue; }
  if (arg === "--output-format" || arg === "--json-schema" || arg === "--model") {
    const value = args[index + 1];
    if (value === undefined) fail(`missing value for ${arg}`);
    if (arg === "--output-format") outputFormat = value;
    if (arg === "--json-schema") schemaText = value;
    if (arg === "--model") model = value;
    index += 1;
    continue;
  }
  if (arg.startsWith("-")) fail(`unknown argument ${arg}`);
  if (index !== args.length - 1) fail(`unexpected positional argument ${JSON.stringify(arg)}`);
  prompt = arg;
}
if (!print || outputFormat !== "json" || schemaText === undefined || prompt === undefined) {
  fail("expected -p --output-format json --json-schema <schema> [--model <model>] <prompt>");
}
writeFileSync(marker, JSON.stringify({ args, cwd: process.cwd(), prompt, model, claudeConfigDir: process.env.CLAUDE_CONFIG_DIR ?? null, pid: process.pid }));

if (mode === "hang" || mode === "grandchild") {
  if (mode === "grandchild") {
    const grandchild = spawn(process.execPath, ["-e", 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'], { stdio: "ignore" });
    writeFileSync(`${marker}.grandchild`, String(grandchild.pid));
  }
  setInterval(() => {}, 1000);
} else {
  const CONTINUATION = "Treat continuation input fields unfinished, pendingDecisions, and awaitingHuman as required planning inputs.";
  const schema = JSON.parse(schemaText);
  const phase = schema.oneOf ? "execute" : schema.properties?.approved ? "verify" : "plan";
  let body = { summary: "fixture", primaryTargetPaths: ["answer.txt"] };
  if (phase === "execute") body = { changedFiles: ["answer.txt"], diffPatch: "fixture patch", commandOutputs: ["changed answer"], stdoutStderrLog: "fixture execution" };
  if (phase === "verify") body = { approved: true, rejectCategory: "", primaryTargetPaths: ["answer.txt"], failingCommand: null, safeToRetry: false, evidence: [], pauseSignals: [], stopSignals: [] };
  appendFileSync(`${marker}.calls`, `${phase}\n`);
  let entry, refused = false;
  if (mode === "script") {
    const task = { plan: /^Plan one isolated L2 attempt for task (.+)\.$/m, execute: /^Execute one isolated attempt for task (.+)\.$/m, verify: /^Verify task (.+)\.$/m }[phase].exec(prompt)?.[1];
    const script = task === undefined ? {} : JSON.parse(readFileSync(process.argv[4], "utf8"));
    const key = prompt.includes(CONTINUATION) && script[`${task}#continuation`] !== undefined ? `${task}#continuation` : script[task] !== undefined ? task : undefined;
    entry = key === undefined ? undefined : script[key];
    appendFileSync(`${marker}.tasks`, `${phase} ${key ?? "-"}\n`);
    if (phase === "execute" && entry === undefined) {
      process.stderr.write(`fake-claude-cli script has no entry for task ${task}\n`);
      process.exitCode = 3;
      refused = true;
    }
  }
  const respond = () => {
    if (mode === "script" && phase === "execute") for (const [path, content] of Object.entries(entry.files)) writeFileSync(path, content);
    process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, structured_output: body, usage: { input_tokens: 12, output_tokens: 3 } }));
  };
  const delay = entry?.delayMs?.[phase];
  if (!refused) { if (delay === undefined) respond(); else setTimeout(respond, delay); }
}
```

- [ ] **Step 3.1.4：跑，确认绿**

`./node_modules/.bin/vitest run tests/runtime/claude/fakeClaudeCli.test.ts > $S/t3-1-green.log 2>&1; echo rc=$?` ⇒ `rc=0`，`Tests 7 passed (7)`。

- [ ] **Step 3.1.5：提交**

```bash
/usr/bin/git -C $C add tests/fixtures/fake-claude-cli.mjs tests/runtime/claude/fakeClaudeCli.test.ts
/usr/bin/git -C $C commit -m "test(claude): add a CLI-layer fake claude with fake codex's call logs

Orca agent selection (2026-09-26), spec §4.8: stands in for the claude binary itself,
answers --version, and logs .argv/.calls/.tasks in fake codex's formats.

Co-Authored-By: <实施席自己的模型> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR"
```

#### 3.2 fake codex：`.argv` 与 `--version`

- [ ] **Step 3.2.1：写失败的判据** —— 新建 `tests/runtime/codex/fakeCodexArgv.test.ts`：

```ts
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parseCodexConfig } from "../../../src/runtime/codex/protocol.js";
import { runCodexPhase } from "../../../src/runtime/codex/runCodexPhase.js";
import { codexFixture } from "./fixture.js";

// Orca agent selection (2026-09-26), spec §4.8: fake codex also appends each call's codex arguments to
// `<marker>.argv` and answers `--version`, so the mixed-agent E2E can see each selection reach its CLI and
// ccloop can probe the fake's version. The marker file itself keeps being overwritten as before.
const fake = fileURLToPath(new URL("../../fixtures/fake-codex.mjs", import.meta.url));
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

describe("fake codex .argv and --version (Orca agent selection)", () => {
  it("appends one JSON array line per call, from `exec` on, including the model", async () => {
    const f = await codexFixture("ok");
    dirs.push(f.dir);
    for (const phase of ["plan", "verify"] as const) {
      expect((await runCodexPhase(parseCodexConfig({ ...f.config, model: `model-${phase}` }), { phase, prompt: "p", context: f.context })).reason).toBe("completed");
    }
    const lines = (await readFile(`${f.marker}.argv`, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as string[]);
    expect(lines).toHaveLength(2);
    expect(lines.map((argv) => argv[0])).toEqual(["exec", "exec"]);
    expect(lines.map((argv) => argv[argv.indexOf("--model") + 1])).toEqual(["model-plan", "model-verify"]);
    expect(JSON.parse(await readFile(f.marker, "utf8")).args).toEqual(lines[1]!.slice(1));
  });

  it("answers --version and writes nothing", async () => {
    const f = await codexFixture("script");
    dirs.push(f.dir);
    const result = await new Promise<{ code: number | null; stdout: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [fake, "script", f.marker, `${f.dir}/script.json`, "--version"], { stdio: ["ignore", "pipe", "inherit"] });
      let stdout = "";
      child.stdout.on("data", (chunk) => { stdout += String(chunk); });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout }));
    });
    expect(result).toEqual({ code: 0, stdout: "9.9.9-fake\n" });
    for (const suffix of ["", ".argv", ".calls", ".tasks"]) expect(existsSync(`${f.marker}${suffix}`)).toBe(false);
  });
});
```

- [ ] **Step 3.2.2：跑，确认红**

`./node_modules/.bin/vitest run tests/runtime/codex/fakeCodexArgv.test.ts > $S/t3-2-red.log 2>&1; echo rc=$?`

预期：`rc=1`，2 条全红——第一条读 `.argv` ENOENT；第二条 fake codex 不认 `--version`：stdin 关闭即写 marker，再把 `exec` 缺失时的 `args[0]`（node 可执行文件）当 schema 读、`JSON.parse` 抛错、退出 1（期望 `{code:0, stdout:"9.9.9-fake\n"}` 且不写文件）。

- [ ] **Step 3.2.3：实现** —— `tests/fixtures/fake-codex.mjs`，锚点是第 3 行，只插不改：

before：
```js
const mode=process.argv[2], marker=process.argv[3];
const CONTINUATION="Treat continuation input fields unfinished, pendingDecisions, and awaitingHuman as required planning inputs.";
```
after：
```js
const mode=process.argv[2], marker=process.argv[3];
// Orca agent selection (2026-09-26), spec §4.8: `--version` with no `exec` answers a fixed version and
// writes nothing; every other call appends what the real codex would receive (from `exec` on) as one
// JSON array line to `<marker>.argv`. Every mode below is otherwise unchanged.
if(process.argv.at(-1)==="--version"&&!process.argv.includes("exec")) {await new Promise(resolve=>process.stdout.write("9.9.9-fake\n",resolve));process.exit(0);}
appendFileSync(marker+".argv",JSON.stringify(process.argv.slice(process.argv.indexOf("exec")))+"\n");
const CONTINUATION="Treat continuation input fields unfinished, pendingDecisions, and awaitingHuman as required planning inputs.";
```

- [ ] **Step 3.2.4：跑新判据与 fake codex 的全部既有判据**

`./node_modules/.bin/vitest run tests/runtime/codex tests/cli/codex.test.ts > $S/t3-2-green.log 2>&1; echo rc=$?` ⇒ `rc=0`，本分节现测：11 文件全绿（含 `fakeCodexScript`、`fakeCodexDelay`、`runCodexPhase`）。

- [ ] **Step 3.2.5：提交**

```bash
/usr/bin/git -C $C add tests/fixtures/fake-codex.mjs tests/runtime/codex/fakeCodexArgv.test.ts
/usr/bin/git -C $C commit -m "test(codex): log each fake codex call's argv and answer --version

Orca agent selection (2026-09-26), spec §4.8: additive only; every existing mode
is unchanged and the marker file is still overwritten as before.

Co-Authored-By: <实施席自己的模型> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR"
```

#### 3.3 runner：`CCLOOP_CLAUDE_COMMAND`／`CCLOOP_CLAUDE_EXTRA_ARGS`

- [ ] **Step 3.3.1：写失败的判据** —— 新建 `tests/runtime/claude/claudePhaseRunnerEnv.test.ts`：

```ts
import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// Orca agent selection (2026-09-26), spec §4.7 and §12 I14: the phase runner takes the claude command and
// extra arguments from CCLOOP_CLAUDE_COMMAND / CCLOOP_CLAUDE_EXTRA_ARGS as JSON arrays. Unset, it must run
// `claude` from PATH with exactly the arguments it always used — the older SubprocessClaudeAdapter still
// depends on that.
const runner = fileURLToPath(new URL("../../../scripts/claude-phase-runner.mjs", import.meta.url));
const fakeCli = fileURLToPath(new URL("../../fixtures/fake-claude-cli.mjs", import.meta.url));
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

async function world() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "claude-runner-env-")));
  dirs.push(dir);
  const pathMarker = join(dir, "path-claude.json");
  // A `claude` on PATH that forwards to the CLI-layer fake, so its argv lands in <pathMarker>.argv.
  await writeFile(join(dir, "claude"), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakeCli)} ok ${JSON.stringify(pathMarker)} "$@"\n`);
  await chmod(join(dir, "claude"), 0o755);
  return { dir, pathMarker };
}

function runRunner(cwd: string, env: NodeJS.ProcessEnv): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runner], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.stdin.on("error", () => {});
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify({ phase: "plan", prompt: "Plan one isolated L2 attempt for task t.", attempt: 1, runDir: cwd, worktreePath: cwd }));
  });
}

const argvOf = async (marker: string) => (await readFile(`${marker}.argv`, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as string[]);

describe("claude phase runner command and extra arguments (Orca agent selection)", () => {
  it("runs `claude` from PATH with its original arguments when neither variable is set", async () => {
    const w = await world();
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${w.dir}:${process.env.PATH ?? ""}` };
    delete env.CCLOOP_CLAUDE_COMMAND; delete env.CCLOOP_CLAUDE_EXTRA_ARGS;
    const result = await runRunner(w.dir, env);
    expect(result.code).toBe(0);
    const [argv] = await argvOf(w.pathMarker);
    expect(argv).toHaveLength(6);
    expect(argv!.slice(0, 4)).toEqual(["-p", "--output-format", "json", "--json-schema"]);
    expect(argv![5]).toBe("Plan one isolated L2 attempt for task t.");
    expect(JSON.parse(result.stdout)).toMatchObject({ summary: "fixture", tokenUsage: 15 });
  });

  it("runs the named argv tuple with the extra arguments before the prompt, never splitting on whitespace", async () => {
    const w = await world();
    const marker = join(w.dir, "named-claude.json");
    const result = await runRunner(w.dir, {
      ...process.env,
      PATH: `${w.dir}:${process.env.PATH ?? ""}`,
      CCLOOP_CLAUDE_COMMAND: JSON.stringify([process.execPath, fakeCli, "ok", marker]),
      CCLOOP_CLAUDE_EXTRA_ARGS: JSON.stringify(["--model", "model with spaces[1m]"]),
    });
    expect(result.code).toBe(0);
    const [argv] = await argvOf(marker);
    expect(argv).toHaveLength(8);
    expect(argv!.slice(5)).toEqual(["--model", "model with spaces[1m]", "Plan one isolated L2 attempt for task t."]);
    expect(existsSync(`${w.pathMarker}.argv`)).toBe(false);
  });

  it.each([
    ["CCLOOP_CLAUDE_COMMAND", "claude --flag"],
    ["CCLOOP_CLAUDE_COMMAND", "[]"],
    ["CCLOOP_CLAUDE_COMMAND", "[\"\"]"],
    ["CCLOOP_CLAUDE_EXTRA_ARGS", "\"--model x\""],
    ["CCLOOP_CLAUDE_EXTRA_ARGS", "[\"--model\", 1]"],
  ])("refuses %s=%s by name and launches nothing", async (name, value) => {
    const w = await world();
    const result = await runRunner(w.dir, { ...process.env, PATH: `${w.dir}:${process.env.PATH ?? ""}`, [name]: value });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain(`claude-runner-env-invalid: ${name}`);
    expect(existsSync(`${w.pathMarker}.argv`)).toBe(false);
  });
});
```

- [ ] **Step 3.3.2：跑，确认红**

`./node_modules/.bin/vitest run tests/runtime/claude/claudePhaseRunnerEnv.test.ts > $S/t3-3-red.log 2>&1; echo rc=$?`

预期：`rc=1`，6 红 1 绿——runner 不读这两个变量，总是跑 PATH 上的 `claude`：「runs the named argv tuple…」读 `named-claude.json.argv` ENOENT；五条 `refuses …` 得 `code 0`（期望 2）。**「unset 时原样」那条在 RED 就绿**（它编码的正是旧行为），它的变异见 3.3.5 的 R4。

- [ ] **Step 3.3.3：实现** —— `scripts/claude-phase-runner.mjs` 两处。

(a) `runClaude`（锚点 `async function runClaude(request) {` 起到 `request.prompt,\n    ],`）：

before：
```js
async function runClaude(request) {
  const schema = getSchemaForPhase(request.phase);
  const child = execFile(
    "claude",
    [
      "-p",
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(schema),
      request.prompt,
    ],
```
after：
```js
// Orca agent selection (2026-09-26), spec §4.7 and §12 I14: ClaudeAgentAdapter names the claude binary and
// the extra arguments (`--model <model>[1m]`) as JSON arrays in these two variables, never as a
// whitespace-split string. Unset, the runner behaves exactly as before: `claude` from PATH, no extra argument.
function readArgvEnv(name, fallback, requireCommand) {
  const raw = process.env[name];
  if (raw === undefined) {
    return fallback;
  }

  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`claude-runner-env-invalid: ${name} is not JSON`);
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== "string") || (requireCommand && (value.length === 0 || value[0] === ""))) {
    throw new Error(`claude-runner-env-invalid: ${name} must be a JSON array of strings${requireCommand ? " naming a command" : ""}`);
  }

  return value;
}

async function runClaude(request, claudeCommand, extraArgs) {
  const schema = getSchemaForPhase(request.phase);
  const child = execFile(
    claudeCommand[0],
    [
      ...claudeCommand.slice(1),
      "-p",
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(schema),
      ...extraArgs,
      request.prompt,
    ],
```

(b) `main` 开头：

before：
```js
async function main() {
  const request = await readStdin();
  currentRequest = request;

  try {
    const result = await runClaude(request);
```
after：
```js
async function main() {
  let claudeCommand;
  let extraArgs;
  try {
    claudeCommand = readArgvEnv("CCLOOP_CLAUDE_COMMAND", ["claude"], true);
    extraArgs = readArgvEnv("CCLOOP_CLAUDE_EXTRA_ARGS", [], false);
  } catch (error) {
    process.stderr.write(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
    return;
  }

  const request = await readStdin();
  currentRequest = request;

  try {
    const result = await runClaude(request, claudeCommand, extraArgs);
```

- [ ] **Step 3.3.4：跑新判据与 runner 的全部既有使用者**

`./node_modules/.bin/vitest run tests/runtime/claude/claudePhaseRunnerEnv.test.ts tests/runtime/claude/subprocessClaudeAdapter.test.ts tests/controller/runLoop.integration.test.ts > $S/t3-3-green.log 2>&1; echo rc=$?` ⇒ `rc=0`（本分节现测：7／28／67 全绿）。

- [ ] **Step 3.3.5：提交**

```bash
/usr/bin/git -C $C add scripts/claude-phase-runner.mjs tests/runtime/claude/claudePhaseRunnerEnv.test.ts
/usr/bin/git -C $C commit -m "feat(claude): let the phase runner take the claude argv and extra arguments as JSON

Orca agent selection (2026-09-26), spec §4.7 and §12 I14: CCLOOP_CLAUDE_COMMAND and
CCLOOP_CLAUDE_EXTRA_ARGS are JSON arrays, never split on whitespace; unset, the runner
runs claude from PATH with its original arguments.

Co-Authored-By: <实施席自己的模型> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR"
```

#### 3.4 codex `extraEnv`（`configDir` ⇒ `CODEX_HOME`）

- [ ] **Step 3.4.1：写失败的判据** —— 新建 `tests/runtime/codex/extraEnv.test.ts`：

```ts
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CodexAdapter } from "../../../src/runtime/codex/codexAdapter.js";
import { parseCodexConfig } from "../../../src/runtime/codex/protocol.js";
import { runCodexPhase } from "../../../src/runtime/codex/runCodexPhase.js";
import { codexFixture } from "./fixture.js";

// Orca agent selection (2026-09-26), spec §4.2: an installation's configDir reaches codex as CODEX_HOME
// through runCodexPhase's optional extraEnv; without it the child inherits the environment as before.
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

async function probe() {
  const f = await codexFixture("unused");
  dirs.push(f.dir);
  const script = join(f.dir, "env-probe.mjs"), out = join(f.dir, "codex-home.txt");
  // Stands in for the codex binary: records CODEX_HOME and exits without an answer.
  await writeFile(script, `import { writeFileSync } from "node:fs";\nwriteFileSync(process.argv[2], process.env.CODEX_HOME ?? "unset");\n`);
  return { ...f, out, config: parseCodexConfig({ ...f.config, command: [process.execPath, script, out] }) };
}

describe("codex extraEnv (Orca agent selection)", () => {
  it("sets the variables it is given on the codex process", async () => {
    const f = await probe();
    await runCodexPhase(f.config, { phase: "plan", prompt: "p", context: f.context }, { CODEX_HOME: "/tmp/ccloop-codex-home-fixture" });
    expect(await readFile(f.out, "utf8")).toBe("/tmp/ccloop-codex-home-fixture");
  });

  it("inherits the environment unchanged without extraEnv", async () => {
    const f = await probe();
    await runCodexPhase(f.config, { phase: "plan", prompt: "p", context: f.context });
    expect(await readFile(f.out, "utf8")).toBe(process.env.CODEX_HOME ?? "unset");
  });

  it("passes CodexAdapter's second argument to every phase", async () => {
    const f = await probe();
    await expect(new CodexAdapter(f.config, { CODEX_HOME: "/tmp/ccloop-codex-home-adapter" }).plan(f.context)).rejects.toThrow(/^codex-/);
    expect(await readFile(f.out, "utf8")).toBe("/tmp/ccloop-codex-home-adapter");
  });
});
```

- [ ] **Step 3.4.2：跑，确认红**

`./node_modules/.bin/vitest run tests/runtime/codex/extraEnv.test.ts > $S/t3-4-red.log 2>&1; echo rc=$?`

预期：`rc=1`，2 红 1 绿——多出的实参被忽略，探针写的是 `unset`（或本机继承的 `CODEX_HOME`）。**「inherits the environment unchanged」在 RED 就绿**，它的变异见 E3。

- [ ] **Step 3.4.3：实现**

`src/runtime/codex/runCodexPhase.ts:19`，before：
```ts
export async function runCodexPhase(config:CodexConfig, request:PhaseRequest):Promise<PhaseOutcome> {
```
after：
```ts
// Orca agent selection (2026-09-26): `extraEnv` carries an installation's configDir as CODEX_HOME; absent, the
// child inherits this process's environment exactly as before.
export async function runCodexPhase(config:CodexConfig, request:PhaseRequest, extraEnv?:Record<string,string>):Promise<PhaseOutcome> {
```
`:47`，before：`…detached:true,stdio:["pipe","pipe","pipe"],env:process.env});` after：`…detached:true,stdio:["pipe","pipe","pipe"],env:{...process.env,...extraEnv}});`

`src/runtime/codex/codexAdapter.ts:19`，before：
```ts
  constructor(rawConfig: unknown) { this.config = parseCodexConfig(rawConfig); }
```
after：
```ts
  // Orca agent selection (2026-09-26): the optional `extraEnv` (CODEX_HOME from an installation's configDir)
  // reaches every phase's codex process; without it nothing changes.
  constructor(rawConfig: unknown, private readonly extraEnv?: Record<string, string>) { this.config = parseCodexConfig(rawConfig); }
```
`:22`，before：`const outcome = await runCodexPhase(this.config, { phase, prompt, context });` after：`const outcome = await runCodexPhase(this.config, { phase, prompt, context }, this.extraEnv);`

- [ ] **Step 3.4.4：跑**

`./node_modules/.bin/vitest run tests/runtime/codex tests/cli/codex.test.ts > $S/t3-4-green.log 2>&1; echo rc=$?` ⇒ `rc=0`。

- [ ] **Step 3.4.5：提交**

```bash
/usr/bin/git -C $C add src/runtime/codex/runCodexPhase.ts src/runtime/codex/codexAdapter.ts tests/runtime/codex/extraEnv.test.ts
/usr/bin/git -C $C commit -m "feat(codex): pass an optional extra environment to the codex process

Orca agent selection (2026-09-26), spec §4.2: an installation's configDir reaches
codex as CODEX_HOME; without it the environment is inherited as before.

Co-Authored-By: <实施席自己的模型> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR"
```

#### 3.5 `ClaudeAgentAdapter`（判据 3、4、5）

- [ ] **Step 3.5.1：写失败的判据** —— 新建 `tests/runtime/claude/claudeAgentAdapter.test.ts`：

```ts
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { AgentError, type MaterializedAgentConfigV1 } from "../../../src/agents/types.js";
import { proveStopped, type StopProofRecord } from "../../../src/control/stopProof.js";
import { ClaudeAgentAdapter, ClaudePhaseAborted, claudeRunnerPath } from "../../../src/runtime/claude/claudeAgentAdapter.js";
import type { AttemptContext } from "../../../src/runtime/types.js";
import { codexFixture } from "../codex/fixture.js";

// Orca agent selection (2026-09-26), spec §4.7 and §9 criteria 3, 4, 5: ClaudeAgentAdapter drives the
// claude CLI (here tests/fixtures/fake-claude-cli.mjs) through scripts/claude-phase-runner.mjs in a
// registered process group. These criteria exist because the older SubprocessClaudeAdapter never
// registered anything, which made the control stop proof hold vacuously (spec §1.2).
const exec = promisify(execFile);
const fakeCli = fileURLToPath(new URL("../../fixtures/fake-claude-cli.mjs", import.meta.url));
const alive = async (pid: number) => exec("ps", ["-o", "stat=", "-p", String(pid)]).then((r) => r.stdout.trim().length > 0 && !r.stdout.trim().startsWith("Z"), () => false);
const pgidOf = async (pid: number) => Number((await exec("ps", ["-o", "pgid=", "-p", String(pid)])).stdout.trim());
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const f of cleanup.splice(0).reverse()) await f(); });

async function fixture(mode: "ok" | "hang" | "grandchild", selection: Partial<MaterializedAgentConfigV1["selection"]> = {}, installation: Partial<MaterializedAgentConfigV1["installation"]> = {}) {
  const f = await codexFixture("unused");
  const marker = join(f.dir, "claude-marker.json");
  cleanup.push(async () => {
    for (const path of [marker, `${marker}.grandchild`]) {
      try {
        const raw = await readFile(path, "utf8");
        const pid = path === marker ? JSON.parse(raw).pid as number : Number(raw);
        if (await alive(pid)) process.kill(pid, "SIGKILL");
      } catch {}
    }
    await rm(f.dir, { recursive: true, force: true });
  });
  const config: MaterializedAgentConfigV1 = {
    schema: "ccloop-agent-config-v1",
    kind: "claude",
    installation: { kind: "claude", command: [process.execPath, fakeCli, mode, marker], version: "9.9.9-fake", configDir: null, timeoutMs: 20_000, killGraceMs: 300, ...installation },
    selection: { agent: "claude", model: "claude-opus-5-5", contextWindow: "agent-default", ...selection },
  };
  const context: AttemptContext = { ...f.context };
  return { ...f, marker, config, context };
}

const argvLines = async (marker: string): Promise<string[][]> =>
  (await readFile(`${marker}.argv`, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as string[]);

describe("ClaudeAgentAdapter (Orca agent selection, spec §4.7)", () => {
  it("finds the phase runner script from the source tree", () => {
    expect(existsSync(claudeRunnerPath())).toBe(true);
  });

  it("passes the selected model to the claude CLI and returns the structured answer with its usage", async () => {
    const f = await fixture("ok");
    const plan = await new ClaudeAgentAdapter(f.config).plan(f.context);
    expect(plan).toMatchObject({ summary: "fixture", primaryTargetPaths: ["answer.txt"], tokenUsage: 15 });
    const [argv] = await argvLines(f.marker);
    expect(argv!.slice(0, 4)).toEqual(["-p", "--output-format", "json", "--json-schema"]);
    expect(argv!.slice(5, 7)).toEqual(["--model", "claude-opus-5-5"]);
    expect(argv).toHaveLength(8);
    expect(argv![7]).toContain("Plan one isolated L2 attempt for task codex-test.");
  });

  it("selects the 1M context window by the [1m] model suffix", async () => {
    const f = await fixture("ok", { contextWindow: 1_000_000 });
    await new ClaudeAgentAdapter(f.config).plan(f.context);
    const [argv] = await argvLines(f.marker);
    expect(argv!.slice(5, 7)).toEqual(["--model", "claude-opus-5-5[1m]"]);
  });

  it("refuses at construction a context window the claude CLI cannot express", async () => {
    const f = await fixture("ok", { contextWindow: 200_000 });
    let caught: unknown;
    try { new ClaudeAgentAdapter(f.config); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(AgentError);
    expect((caught as AgentError).code).toBe("agent-context-unsupported");
  });

  it("sets CLAUDE_CONFIG_DIR only when the installation names a configDir", async () => {
    const withDir = await fixture("ok", {}, { configDir: "/tmp/ccloop-claude-config-fixture" });
    await new ClaudeAgentAdapter(withDir.config).plan(withDir.context);
    expect(JSON.parse(await readFile(withDir.marker, "utf8")).claudeConfigDir).toBe("/tmp/ccloop-claude-config-fixture");
    const inherited = await fixture("ok");
    await new ClaudeAgentAdapter(inherited.config).plan(inherited.context);
    expect(JSON.parse(await readFile(inherited.marker, "utf8")).claudeConfigDir).toBe(process.env.CLAUDE_CONFIG_DIR ?? null);
  });

  it("keeps private per-call evidence and does not record the environment in request.json", async () => {
    const f = await fixture("ok");
    await new ClaudeAgentAdapter(f.config).plan(f.context);
    const root = join(f.context.runDir, "claude", "1", "plan");
    const [call] = await readdir(root);
    const dir = join(root, call!);
    expect((await readdir(dir)).sort()).toEqual(["outcome.json", "process.json", "request.json", "stderr.log", "stdout.json", "usage.json"]);
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    for (const name of await readdir(dir)) expect((await stat(join(dir, name))).mode & 0o777).toBe(0o600);
    const request = await readFile(join(dir, "request.json"), "utf8");
    expect(JSON.parse(request)).toMatchObject({ phase: "plan", attempt: 1, worktreePath: f.context.worktreePath });
    expect(request).not.toContain("CCLOOP_CLAUDE");
    expect(JSON.parse(await readFile(join(dir, "outcome.json"), "utf8"))).toMatchObject({ reason: "completed", extraArgs: ["--model", "claude-opus-5-5"], claudeCommand: f.config.installation.command });
  });

  it("times out a hanging CLI by itself and leaves no process of the group behind", async () => {
    const f = await fixture("hang", {}, { timeoutMs: 500 });
    await expect(new ClaudeAgentAdapter(f.config).plan(f.context)).rejects.toThrow(/^claude-timeout: /);
    const { pid } = JSON.parse(await readFile(f.marker, "utf8"));
    await expect.poll(() => alive(pid), { timeout: 2000 }).toBe(false);
  }, 10_000);

  // §9 criterion 3 — the vacuous-stop-proof regression. Mutation: delete the onProcessRegistered call.
  it("registers the runner's process group, so the stop proof refuses while that group is alive", async () => {
    const f = await fixture("hang");
    const sourceDir = join(f.dir, "source");
    await mkdir(join(sourceDir, "control"), { recursive: true });
    await mkdir(join(sourceDir, "run"));
    await writeFile(join(sourceDir, "run", "owner-record.json"), JSON.stringify({
      runId: "task-1", logicalSessionId: "session-1", currentOwnerEpoch: 1, currentProcessInstanceId: "process-1",
      lastAffirmedAt: new Date().toISOString(), ownerStatus: "current", supersededByEpoch: null, leaseAffirmedAt: null,
    }));
    const processesPath = join(sourceDir, "control", "processes.json");
    await writeFile(processesPath, "[]\n");
    const record: StopProofRecord = {
      sourceDir,
      accepted: {
        protocol: 1, envelopeHash: "a".repeat(64), executionId: "execution-1", configHash: "b".repeat(64), generation: 2,
        acceptedAt: new Date().toISOString(), launch: "sealed", worker: { pid: process.pid, startedAt: new Date().toISOString(), nonce: "nonce-1" },
      },
    };
    const abort = new AbortController();
    // The same file shape the control worker's registerProcess keeps (src/control/worker.ts).
    const context: AttemptContext = {
      ...f.context,
      abortSignal: abort.signal,
      onProcessRegistered: async (registration) => {
        const existing = JSON.parse(await readFile(processesPath, "utf8")) as unknown[];
        await writeFile(processesPath, JSON.stringify([...existing, { ...registration, registeredAt: new Date().toISOString() }]));
      },
    };
    const running = new ClaudeAgentAdapter(f.config).plan(context);
    await expect.poll(() => existsSync(`${f.marker}.argv`), { timeout: 5000 }).toBe(true);
    await expect.poll(() => readFile(f.marker, "utf8").then(() => true, () => false), { timeout: 2000 }).toBe(true);
    const registered = JSON.parse(await readFile(processesPath, "utf8")) as Array<{ pid: number; pgid: number; phase: string }>;
    expect(registered).toHaveLength(1);
    expect(registered[0]).toMatchObject({ phase: "plan" });
    expect(registered[0]!.pgid).toBe(registered[0]!.pid);
    const cliPid = JSON.parse(await readFile(f.marker, "utf8")).pid as number;
    expect(await pgidOf(cliPid)).toBe(registered[0]!.pgid);
    expect(await proveStopped(record, { graceMs: 20 })).toBeNull();
    abort.abort();
    const error = await running.then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(ClaudePhaseAborted);
    expect((error as ClaudePhaseAborted).observedTokens).toBeNull();
    // Control: once the registered group is gone the same record does prove the stop.
    await expect.poll(async () => (await proveStopped(record, { graceMs: 20 }))?.isolated ?? false, { timeout: 3000 }).toBe(true);
  }, 20_000);

  // §9 criterion 4 — the prompt is written only after registration returns. Held on a test-controlled
  // promise, not on kill timing. Mutation: move `await writeRequest()` above `await context.onProcessRegistered`.
  it("writes nothing to the runner until the registration callback has returned", async () => {
    const f = await fixture("ok");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let beforeRelease: { cliStarted: boolean; requestWritten: boolean } | undefined;
    const root = join(f.context.runDir, "claude", "1", "plan");
    const context: AttemptContext = {
      ...f.context,
      onProcessRegistered: async () => {
        // Give a runner that did receive its request ample time to start the CLI (it takes well under a second).
        let cliStarted = false;
        for (const deadline = Date.now() + 3000; Date.now() < deadline && !cliStarted; await sleep(50)) cliStarted = existsSync(`${f.marker}.argv`);
        const [call] = await readdir(root);
        beforeRelease = { cliStarted, requestWritten: existsSync(join(root, call!, "request.json")) };
        await gate;
      },
    };
    const running = new ClaudeAgentAdapter(f.config).plan(context);
    await expect.poll(() => beforeRelease, { timeout: 8000 }).toBeDefined();
    expect(beforeRelease).toEqual({ cliStarted: false, requestWritten: false });
    release();
    expect(await running).toMatchObject({ summary: "fixture" });
    expect(await argvLines(f.marker)).toHaveLength(1);
  }, 20_000);

  // §9 criterion 5 — stopping kills the whole group, including the CLI's own child (the runner's
  // grandchild, spec M9). Mutation: in `kill`, signal `child.pid` instead of `-child.pid`.
  it("kills the runner's grandchild within killGraceMs of an abort", async () => {
    const f = await fixture("grandchild");
    const abort = new AbortController();
    const running = new ClaudeAgentAdapter(f.config).execute({ ...f.context, abortSignal: abort.signal });
    await expect.poll(() => readFile(`${f.marker}.grandchild`, "utf8").then(Number, () => 0), { timeout: 5000 }).toBeGreaterThan(0);
    const grandchild = Number(await readFile(`${f.marker}.grandchild`, "utf8"));
    const registered = JSON.parse(await readFile(join((await readdir(join(f.context.runDir, "claude", "1", "execute"))).map((call) => join(f.context.runDir, "claude", "1", "execute", call))[0]!, "process.json"), "utf8")) as { pgid: number };
    expect(await pgidOf(grandchild)).toBe(registered.pgid);
    expect(await alive(grandchild)).toBe(true);
    abort.abort();
    expect(await running).toBeNull();
    await expect.poll(() => alive(grandchild), { timeout: f.config.installation.killGraceMs + 500 }).toBe(false);
  }, 20_000);
});
```

要点（写给复审）：判据 4 **不靠杀进程的时序**——注册回调挂在测试控制的 `gate` 上；挂起期间量两样：适配器还没写 `request.json`（确定性，适配器层），且 3 s 内 fake CLI 没被拉起（`.argv` 不存在，进程层；收到请求的 runner 起 CLI 远不到 1 s）；放行之后才出现唯一一行 `.argv`。判据 5 先断言孙进程与注册的进程组**同组**（否则判据空洞），再中止。判据 3 的对照：组没了之后同一个 record **能**给出证明，证明前面的 `null` 不是夹具坏了。

- [ ] **Step 3.5.2：跑，确认红**

`./node_modules/.bin/vitest run tests/runtime/claude/claudeAgentAdapter.test.ts > $S/t3-5-red.log 2>&1; echo rc=$?`

预期：`rc=1`，整文件在收集阶段失败：`Failed to load url ../../../src/runtime/claude/claudeAgentAdapter.js`（模块不存在）。

- [ ] **Step 3.5.3：实现** —— 新建 `src/runtime/claude/claudeAgentAdapter.ts`：

```ts
import { execFile, spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { AgentError, type MaterializedAgentConfigV1 } from "../../agents/types.js";
import type { AttemptContext, AttemptPlan, ExecutePhaseResult, ExecutionResult, RuntimeAdapter, VerificationResult } from "../types.js";
import { buildExecutorPrompt, buildPlannerPrompt, buildVerifierPrompt } from "./prompts.js";
import type { ClaudePhaseRequest } from "./types.js";

// Orca agent selection (2026-09-26), spec §4.7: the claude adapter that ccloop control can run. Its process
// handling follows runCodexPhase: the phase runner is the leader of its own process group (the claude CLI
// and anything that CLI starts without detaching stay in it), the group is registered BEFORE the prompt is
// written, and stopping signals the whole group. SubprocessClaudeAdapter stays as it was (spec §11).
const LIMIT = 16 * 1024 * 1024;
const ONE_MILLION = 1_000_000;
const execFileAsync = promisify(execFile);

/** scripts/ is not copied by the build: from dist/src/runtime/claude/ the source tree is one level higher. */
export function claudeRunnerPath(): string {
  const up = fileURLToPath(new URL("../../../", import.meta.url));
  const root = basename(up) === "dist" ? dirname(up) : up;
  return join(root, "scripts", "claude-phase-runner.mjs");
}

/** A phase stopped by the abort signal. The runner reports usage only at phase end, so nothing was observed. */
export class ClaudePhaseAborted extends Error {
  readonly observedTokens: null = null;
  constructor(readonly evidenceDir: string) {
    super(`claude-aborted: ${evidenceDir}`);
    this.name = "ClaudePhaseAborted";
  }
}

type Outcome = {
  reason: "completed" | "aborted" | "timeout" | "spawn-error" | "exit-error" | "output-limit" | "io-error";
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  evidenceDir: string;
};

export class ClaudeAgentAdapter implements RuntimeAdapter {
  private readonly extraArgs: string[];

  constructor(private readonly config: MaterializedAgentConfigV1) {
    const { model, contextWindow } = config.selection;
    if (contextWindow !== "agent-default" && contextWindow !== ONE_MILLION) {
      throw new AgentError("agent-context-unsupported", `claude cannot express contextWindow ${contextWindow}`);
    }
    // Task 0 (台账 §1): the claude CLI selects the 1M context window by the `[1m]` suffix on the model name.
    this.extraArgs = ["--model", contextWindow === ONE_MILLION ? `${model}[1m]` : model];
  }

  private async run(request: ClaudePhaseRequest, context: AttemptContext): Promise<Outcome> {
    const installation = this.config.installation;
    const phase = request.phase;
    const root = join(context.runDir, "claude", String(context.attempt), phase);
    await mkdir(root, { recursive: true, mode: 0o700 });
    const evidenceDir = await mkdtemp(join(root, "call-"));
    const save = async (name: string, data: string) => writeFile(join(evidenceDir, name), data, { mode: 0o600 });
    const runner = claudeRunnerPath();
    const result: Outcome = { reason: "completed", code: null, signal: null, stdout: "", evidenceDir };
    let stderr = "", ioError: string | undefined, stdoutTruncated = false, stderrTruncated = false;
    const persist = async (): Promise<Outcome> => {
      await save("outcome.json", JSON.stringify({
        reason: result.reason, code: result.code, signal: result.signal, evidenceDir,
        runner, claudeCommand: installation.command, extraArgs: this.extraArgs, configDir: installation.configDir,
        ioError, stdoutTruncated, stderrTruncated,
      }, null, 2));
      return result;
    };
    if (context.abortSignal?.aborted) { result.reason = "aborted"; return persist(); }
    const timeout = Math.min(installation.timeoutMs, context.state.budgetSnapshot.timeRemainingMs);
    if (timeout <= 0) { result.reason = "timeout"; return persist(); }
    // Pre-create the raw logs with private permissions; the streams append to them.
    await save("stdout.json", ""); await save("stderr.log", "");
    // The environment is not recorded in request.json (spec M6); outcome.json names the command and arguments.
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      CCLOOP_CLAUDE_COMMAND: JSON.stringify(installation.command),
      CCLOOP_CLAUDE_EXTRA_ARGS: JSON.stringify(this.extraArgs),
    };
    if (installation.configDir !== null) env.CLAUDE_CONFIG_DIR = installation.configDir;
    await new Promise<void>((resolve) => {
      const child = spawn(process.execPath, [runner], { cwd: context.worktreePath, detached: true, stdio: ["pipe", "pipe", "pipe"], env });
      const out = new StringDecoder("utf8"), err = new StringDecoder("utf8");
      let outBytes = 0, errBytes = 0, done = false, exited = false;
      let killTimer: NodeJS.Timeout | undefined, drainTimer: NodeJS.Timeout | undefined;
      const kill = (signal: NodeJS.Signals) => {
        if (child.pid === undefined) return;
        try { process.kill(-child.pid, signal); }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== "ESRCH") { ioError = String(e); result.reason = "io-error"; } }
      };
      const finish = () => {
        if (done) return;
        done = true;
        kill("SIGKILL");
        clearTimeout(timer); clearTimeout(killTimer); clearTimeout(drainTimer);
        context.abortSignal?.removeEventListener("abort", abort);
        result.stdout += out.end(); stderr += err.end();
        child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
        resolve();
      };
      const stop = (reason: Outcome["reason"]) => {
        if (done || killTimer) return;
        if (result.reason === "completed") result.reason = reason;
        kill("SIGTERM");
        killTimer = setTimeout(() => { kill("SIGKILL"); finish(); }, installation.killGraceMs);
      };
      const abort = () => stop("aborted");
      const timer = setTimeout(() => stop("timeout"), timeout);
      const writeRequest = async () => {
        await save("request.json", JSON.stringify(request, null, 2));
        child.stdin.end(JSON.stringify(request));
      };
      child.on("error", () => { result.reason = "spawn-error"; finish(); });
      child.stdin.on("error", (e) => { ioError = String(e); if (!exited) stop("io-error"); });
      child.stdout.on("data", (b: Buffer) => {
        const kept = b.subarray(0, Math.max(0, LIMIT - outBytes)); outBytes += b.length;
        try { appendFileSync(join(evidenceDir, "stdout.json"), kept); } catch (e) { ioError = String(e); stop("io-error"); }
        result.stdout += out.write(kept);
        if (outBytes > LIMIT) { stdoutTruncated = true; stop("output-limit"); }
      });
      child.stderr.on("data", (b: Buffer) => {
        const kept = b.subarray(0, Math.max(0, LIMIT - errBytes)); errBytes += b.length;
        try { appendFileSync(join(evidenceDir, "stderr.log"), kept); } catch (e) { ioError = String(e); stop("io-error"); }
        stderr += err.write(kept);
        if (errBytes > LIMIT) { stderrTruncated = true; stop("output-limit"); }
      });
      child.on("exit", (code, signal) => {
        exited = true; result.code = code; result.signal = signal;
        if (result.reason === "completed" && (code !== 0 || signal !== null)) result.reason = "exit-error";
        if (!done) drainTimer = setTimeout(finish, 1000);
      });
      child.on("close", finish);
      context.abortSignal?.addEventListener("abort", abort, { once: true });
      if (context.abortSignal?.aborted) abort();
      child.once("spawn", () => {
        void (async () => {
          try {
            const { stdout } = await execFileAsync("ps", ["-o", "lstart=", "-p", String(child.pid)], { env: { ...process.env, TZ: "UTC", LC_ALL: "C" }, timeout: 1000 });
            if (!stdout.trim()) throw new Error("process identity unavailable");
            const registration = { pid: child.pid!, pgid: child.pid!, startedAt: stdout.trim(), phase };
            await save("process.json", JSON.stringify(registration, null, 2));
            // Registered before the prompt exists anywhere the runner can read it (spec §4.7, §9 criterion 4).
            await context.onProcessRegistered?.(registration);
            if (!done && result.reason === "completed") await writeRequest();
          } catch (e) { ioError = String(e); stop("io-error"); }
        })();
      });
    });
    return persist();
  }

  private async phase<T>(request: ClaudePhaseRequest, context: AttemptContext): Promise<T> {
    const outcome = await this.run(request, context);
    if (outcome.reason === "aborted") throw new ClaudePhaseAborted(outcome.evidenceDir);
    if (outcome.reason !== "completed") throw new Error(`claude-${outcome.reason}: ${outcome.evidenceDir}`);
    let parsed: unknown;
    try { parsed = JSON.parse(outcome.stdout); } catch { parsed = undefined; }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      await writeFile(join(outcome.evidenceDir, "decode-error.txt"), "runner stdout is not a JSON object", { mode: 0o600 });
      throw new Error(`claude-result-invalid: ${outcome.evidenceDir}`);
    }
    const usageEvidence = (parsed as { usageEvidence?: unknown }).usageEvidence;
    if (usageEvidence !== undefined) await writeFile(join(outcome.evidenceDir, "usage.json"), JSON.stringify(usageEvidence, null, 2), { mode: 0o600 });
    return parsed as T;
  }

  private base(context: AttemptContext) {
    return { attempt: context.attempt, runDir: context.runDir, worktreePath: context.worktreePath };
  }

  plan(context: AttemptContext): Promise<AttemptPlan> {
    return this.phase<AttemptPlan>({ phase: "plan", prompt: buildPlannerPrompt(context.contract), ...this.base(context) }, context);
  }

  async execute(context: AttemptContext): Promise<ExecutePhaseResult> {
    try {
      return await this.phase<ExecutionResult>({
        phase: "execute", prompt: buildExecutorPrompt(context), ...this.base(context),
        partialOutcomeRecoveryWindowMs: context.contract.executionPolicy.partialOutcomeRecoveryWindowMs,
      }, context);
    } catch (error) {
      // As CodexAdapter: an aborted execute with no observed usage answers null. Claude never observes any.
      if (context.abortSignal?.aborted) return null;
      throw error;
    }
  }

  verify(context: AttemptContext): Promise<VerificationResult> {
    return this.phase<VerificationResult>({ phase: "verify", prompt: buildVerifierPrompt(context), ...this.base(context) }, context);
  }
}
```

- [ ] **Step 3.5.4：跑，确认绿**

`./node_modules/.bin/vitest run tests/runtime/claude/claudeAgentAdapter.test.ts > $S/t3-5-green.log 2>&1; echo rc=$?` ⇒ `rc=0`，`Tests 10 passed (10)`（本分节现测约 6 s；判据 4 自带 3 s 观察窗）。

- [ ] **Step 3.5.5：typecheck 与 build 后的 runner 路径**

```bash
npm run typecheck > $S/t3-tsc.log 2>&1; echo rc=$?                      # 期望 rc=0
```
build 只在 `git clone --local` 副本里做（`dist/` 被 gitignore，但不在主树跑 build 以免与在飞的 Orca E2E 争用）：提交后 `/usr/bin/git clone --local $C $S/dist-check && ln -s $C/node_modules $S/dist-check/node_modules && cd $S/dist-check && npm run build > $S/t3-build.log 2>&1; echo rc=$?`，然后

```bash
node --input-type=module -e 'import("./dist/src/runtime/claude/claudeAgentAdapter.js").then(async m=>{const p=m.claudeRunnerPath();const {existsSync}=await import("node:fs");console.log(p, existsSync(p));process.exitCode=existsSync(p)?0:1;})' > $S/t3-dist.log 2>&1; echo rc=$?
```
期望 `rc=0`，输出 `<副本>/scripts/claude-phase-runner.mjs true`（本分节现测如此）。

- [ ] **Step 3.5.6：提交**

```bash
/usr/bin/git -C $C add src/runtime/claude/claudeAgentAdapter.ts tests/runtime/claude/claudeAgentAdapter.test.ts
/usr/bin/git -C $C commit -m "feat(claude): add ClaudeAgentAdapter with a registered process group

Orca agent selection (2026-09-26), spec §4.7: the phase runner leads its own process
group, the group is registered before the prompt is written, stopping signals the whole
group, and an aborted phase reports observedTokens null. SubprocessClaudeAdapter is
unchanged.

Co-Authored-By: <实施席自己的模型> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR"
```

#### 3.6 变异表（变异席在 ccloop 的 `git clone --local` 副本里做；副本是**已提交**状态 ⇒ 在 3.5.6 之后克隆；每条：先跑绿基线，改前后 `shasum -a 256`，跑列出的文件，`cat` 原文件还原后比 `shasum`，副本 `git diff` 与 `git diff --cached` 字节数为 0）

W2 已在 `scratchpad/W2/ccloop` 逐条跑过（日志 `scratchpad/W2/mut-<V>.log`），「期望红」一栏是现测结果。

| V | 文件 | 变异 | 跑哪个判据文件 | 期望红（且仅） |
|---|---|---|---|---|
| M3 | `src/runtime/claude/claudeAgentAdapter.ts` | 删 `await context.onProcessRegistered?.(registration);` 一行 | `claudeAgentAdapter.test.ts` | 「registers the runner's process group…」＋「writes nothing to the runner until…」（后者因回调永不被调、`beforeRelease` 恒 undefined） |
| M4 | 同上 | 把 `if (!done && result.reason === "completed") await writeRequest();` 挪到 `await context.onProcessRegistered?.(registration);` **之前** | 同上 | 仅「writes nothing to the runner until…」 |
| M5 | 同上 | `kill` 里 `process.kill(-child.pid, signal)` 改为 `process.kill(child.pid, signal)` | 同上 | 仅「kills the runner's grandchild within killGraceMs…」（afterEach 会按 `.grandchild` 收尸） |
| M1m | 同上 | `contextWindow === ONE_MILLION ? \`${model}[1m]\` : model]` 改为 `model]` | 同上 | 仅「selects the 1M context window…」 |
| Mctx | 同上 | 删构造函数里的 `if (contextWindow !== "agent-default" && contextWindow !== ONE_MILLION) { throw … }` 三行 | 同上 | 仅「refuses at construction a context window…」 |
| MconfigDir | 同上 | 删 `if (installation.configDir !== null) env.CLAUDE_CONFIG_DIR = installation.configDir;` | 同上 | 仅「sets CLAUDE_CONFIG_DIR only when…」 |
| R1 | `scripts/claude-phase-runner.mjs` | `claudeCommand[0],` 改回 `"claude",` 并删 `...claudeCommand.slice(1),` | `claudePhaseRunnerEnv.test.ts` | 仅「runs the named argv tuple…」 |
| R2 | 同上 | 删 `...extraArgs,` | 同上 | 仅「runs the named argv tuple…」 |
| R3 | 同上 | 删 `readArgvEnv` 里 `if (!Array.isArray(value) \|\| …) { throw … }` 整块 | 同上 | 四条 `refuses …`（`[]`、`[""]`、`"--model x"`、`["--model", 1]`）；`claude --flag` 仍被 JSON 解析那一支拒，照绿 |
| R4 | 同上 | `readArgvEnv("CCLOOP_CLAUDE_EXTRA_ARGS", [], false)` 的缺省 `[]` 改为 `["--model", "x"]` | 同上 | 仅「runs `claude` from PATH with its original arguments…」（RED 阶段就绿的那条） |
| F1 | `tests/fixtures/fake-codex.mjs` | 删 `appendFileSync(marker+".argv",…)` 一行 | `fakeCodexArgv.test.ts` | 仅「appends one JSON array line per call…」 |
| F2 | 同上 | 删 `if(process.argv.at(-1)==="--version"…)` 一行 | 同上 | 仅「answers --version and writes nothing」 |
| FC1 | `tests/fixtures/fake-claude-cli.mjs` | 删 `appendFileSync(\`${marker}.argv\`, …)` 一行 | `fakeClaudeCli.test.ts` | 仅「appends one JSON argv line per call…」 |
| FC2 | 同上 | `if (args.length === 1 && args[0] === "--version") {` 改为 `if (false) {` | 同上 | 仅「answers --version and writes nothing」 |
| E1 | `src/runtime/codex/runCodexPhase.ts` | `env:{...process.env,...extraEnv}` 改回 `env:process.env` | `extraEnv.test.ts` | 「sets the variables…」＋「passes CodexAdapter's second argument…」 |
| E2 | `src/runtime/codex/codexAdapter.ts` | `, this.extraEnv);` 改为 `);` | 同上 | 仅「passes CodexAdapter's second argument…」 |
| E3 | `src/runtime/codex/runCodexPhase.ts` | `env:{...process.env,...extraEnv}` 改为 `env:{...process.env,...extraEnv,CODEX_HOME:"/wrong"}` | 同上 | 三条全红（含 RED 阶段就绿的「inherits … unchanged」） |

- [ ] **Step 3.6.1：把上表的结果（V、前后 sha256、红的判据全名、还原字节数）记进 `.superpowers/sdd/2026-09-26-agent-selection/mutations.md`**（该文件按 Orca Rule 13 只追加）。

---

### Task 6：`ccloop run --agents <table> --agent-selection <file>`

**Files:**
- Modify: `src/cli.ts`：imports（`:1-4` 之后）、`ParsedArgs`（`:19-48`，在第一个 `run` 成员之后加一个成员）、`parseArgs`（`:178` 的 `const runDir = values.get("--run-dir");` 之前插一块）、`loadAdapter` 的参数类型（`:231`）、新函数 `runWithAgents`（插在 `loadAdapter` 之后、`// L3 §5.4's escape hatch.` 注释之前）、`main`（`:319` 的 `// \`sweep\` returns HERE` 注释之前插两行）
- Test（新文件）：`tests/cli/agentsRun.test.ts`

**Interfaces:**
- Consumes（T1）：`readAgentsTable(path)`（`src/agents/table.ts`）、`resolveAgent(table, partial, deps?)`（`src/agents/materialize.ts`，缺省跑 `--version` 探测，W2-7）、`getDescriptor(kind).createAdapter(config)`（`src/agents/registry.ts`）、类型 `AgentsTableV1`、`AgentSelectionV1`；（T3）fake claude CLI、fake codex 的 `--version`。
- Produces：`ParsedArgs` 新成员 `{command:"run"; contractPath; runDir; agentsTablePath; agentSelectionPath}`；选择文件 `{selection: AgentSelectionV1, configHash: string}`（`strict`）；错误：`--agents and --adapter are mutually exclusive`、`--agents is only supported by run`、`agent-selection-file-invalid`（W2-4）、`control-config-hash-mismatch`、`agent-version-drift`（来自 T1）；退出码：成功 0、run 未成功 2、任何拒绝 1。T12 的 `driverLanding.ts` 以此形态起解冲突 run。

命令约定同 T3，`S=…/scratchpad/<实施席 id>/T6`。

- [ ] **Step 6.1：写失败的判据** —— 新建 `tests/cli/agentsRun.test.ts`：

```ts
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { resolveAgent } from "../../src/agents/materialize.js";
import type { AgentSelectionV1, AgentsTableV1 } from "../../src/agents/types.js";
import { parseArgs } from "../../src/cli.js";
import { codexFixture, exec } from "../runtime/codex/fixture.js";

// Orca agent selection (2026-09-26), spec §4.9, §9 criteria 5c and 6: `ccloop run --agents <table>
// --agent-selection <file>` is how Orca's reconcile run starts. The file carries the selection Orca froze and
// its configHash; ccloop re-materializes against the table as it is now and refuses a drifted version or a
// different hash before reading the contract or starting anything.
const fakeCli = fileURLToPath(new URL("../fixtures/fake-claude-cli.mjs", import.meta.url));
const cli = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));
const loader = fileURLToPath(new URL("../../node_modules/tsx/dist/loader.mjs", import.meta.url));
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

async function world(tableVersion = "9.9.9-fake") {
  const f = await codexFixture("integration");
  dirs.push(f.dir);
  const marker = join(f.dir, "claude-marker.json"), scriptPath = join(f.dir, "script.json");
  await writeFile(scriptPath, JSON.stringify({ "codex-test": { files: { "answer.txt": "42\n" } } }));
  const table: AgentsTableV1 = {
    schema: "ccloop-agents-table-v1",
    installations: {
      "claude-fake": { kind: "claude", command: [process.execPath, fakeCli, "script", marker, scriptPath], version: tableVersion, configDir: null, timeoutMs: 10_000, killGraceMs: 50 },
    },
  };
  const tablePath = join(f.dir, "agents.json"), selectionPath = join(f.dir, "selection.json"), contractPath = join(f.dir, "contract.json");
  await writeFile(tablePath, JSON.stringify(table), { mode: 0o600 });
  await writeFile(contractPath, JSON.stringify(f.contract));
  const selection: AgentSelectionV1 = { agent: "claude-fake", model: "claude-opus-5-5", contextWindow: 1_000_000 };
  return { ...f, marker, table, tablePath, selectionPath, contractPath, selection };
}

async function runCli(w: Awaited<ReturnType<typeof world>>): Promise<{ code: number; stdout: string; stderr: string }> {
  return exec(process.execPath, ["--import", loader, cli, "run", "--contract", w.contractPath, "--run-dir", w.runDir, "--agents", w.tablePath, "--agent-selection", w.selectionPath], { cwd: w.dir, timeout: 20_000 })
    .then((r) => ({ ...r, code: 0 }), (e: { stdout: string; stderr: string; code: number }) => ({ stdout: e.stdout, stderr: e.stderr, code: e.code }));
}

describe("ccloop run --agents --agent-selection (Orca agent selection, spec §4.9)", () => {
  it("parses the agents form of run", () => {
    expect(parseArgs(["run", "--contract", "c", "--run-dir", "r", "--agents", "t", "--agent-selection", "s"]))
      .toEqual({ command: "run", contractPath: "c", runDir: "r", agentsTablePath: "t", agentSelectionPath: "s" });
  });

  it.each([
    [["run", "--contract", "c", "--run-dir", "r", "--agents", "t", "--agent-selection", "s", "--adapter", "codex"], "--agents and --adapter are mutually exclusive"],
    [["run", "--contract", "c", "--run-dir", "r", "--agents", "t", "--agent-selection", "s", "--adapter-config", "a"], "--agents and --adapter are mutually exclusive"],
    [["run", "--contract", "c", "--run-dir", "r", "--agents", "t"], "missing required flags"],
    [["run", "--contract", "c", "--run-dir", "r", "--agent-selection", "s"], "missing required flags"],
    [["resume", "--run-dir", "r", "--agents", "t", "--agent-selection", "s"], "--agents is only supported by run"],
  ])("refuses %j", (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(message);
  });

  it("runs the selected installation, whose model reaches the claude CLI", async () => {
    const w = await world();
    const { resolution } = await resolveAgent(w.table, w.selection);
    await writeFile(w.selectionPath, JSON.stringify({ selection: w.selection, configHash: resolution.configHash }), { mode: 0o600 });
    const result = await runCli(w);
    expect(result.code).toBe(0);
    expect(JSON.parse(await readFile(join(w.runDir, "loop-state.json"), "utf8")).status).toBe("succeeded");
    expect((await readFile(`${w.marker}.calls`, "utf8")).trim().split("\n")).toEqual(["plan", "execute", "verify"]);
    const argv = (await readFile(`${w.marker}.argv`, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as string[]);
    expect(argv.map((args) => args[args.indexOf("--model") + 1])).toEqual(["claude-opus-5-5[1m]", "claude-opus-5-5[1m]", "claude-opus-5-5[1m]"]);
  }, 30_000);

  it("runs a codex installation the same way, with codex's soft-budget notice", async () => {
    const w = await world();
    const table: AgentsTableV1 = {
      schema: "ccloop-agents-table-v1",
      installations: {
        "codex-fake": { kind: "codex", command: [...w.config.command] as [string, ...string[]], version: "9.9.9-fake", configDir: null, timeoutMs: 10_000, killGraceMs: 50, sandbox: "workspace-write", budgetMode: "soft" },
      },
    };
    await writeFile(w.tablePath, JSON.stringify(table), { mode: 0o600 });
    const selection: AgentSelectionV1 = { agent: "codex-fake", model: "gpt-6-sol", contextWindow: "agent-default" };
    const { resolution } = await resolveAgent(table, selection);
    await writeFile(w.selectionPath, JSON.stringify({ selection, configHash: resolution.configHash }), { mode: 0o600 });
    const result = await runCli(w);
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("Codex budgetMode=soft");
    const argv = (await readFile(`${w.config.command[3]}.argv`, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as string[]);
    expect(argv.map((args) => args[args.indexOf("--model") + 1])).toEqual(["gpt-6-sol", "gpt-6-sol", "gpt-6-sol"]);
  }, 30_000);

  it("refuses a selection file whose configHash differs, before anything runs", async () => {
    const w = await world();
    await writeFile(w.selectionPath, JSON.stringify({ selection: w.selection, configHash: "0".repeat(64) }), { mode: 0o600 });
    const result = await runCli(w);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("control-config-hash-mismatch");
    expect(existsSync(`${w.marker}.argv`)).toBe(false);
    expect(existsSync(join(w.runDir, "loop-state.json"))).toBe(false);
  }, 30_000);

  it("refuses an installation whose --version no longer matches the table, before anything runs", async () => {
    const w = await world("0.0.1");
    // The hash Orca would have frozen for this table: computed with the table's own version answered.
    const { resolution } = await resolveAgent(w.table, w.selection, { probeVersion: async () => "0.0.1" });
    await writeFile(w.selectionPath, JSON.stringify({ selection: w.selection, configHash: resolution.configHash }), { mode: 0o600 });
    const result = await runCli(w);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("agent-version-drift");
    expect(existsSync(`${w.marker}.argv`)).toBe(false);
    expect(existsSync(join(w.runDir, "loop-state.json"))).toBe(false);
  }, 30_000);

  it("refuses a malformed selection file by name", async () => {
    const w = await world();
    await writeFile(w.selectionPath, JSON.stringify({ selection: { ...w.selection, extra: true }, configHash: "0".repeat(64) }), { mode: 0o600 });
    const result = await runCli(w);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("agent-selection-file-invalid");
  }, 30_000);
});
```

- [ ] **Step 6.2：跑，确认红**

`./node_modules/.bin/vitest run tests/cli/agentsRun.test.ts > $S/t6-red.log 2>&1; echo rc=$?`

预期：`rc=1`。今天的 `parseArgs` 对没有 `--adapter` 的 `run` 一律抛 `missing required flags`：「parses the agents form」红；两条「mutually exclusive」与「--agents is only supported by run」红（消息不同）；五条 E2E 红（`code 1`、stderr 只有 `missing required flags`）；合计 9 红 2 绿。**两条 `missing required flags` 的 refuses 在 RED 就绿**（今天的消息恰好相同），它们的变异见 T6M6。

- [ ] **Step 6.3：实现** —— `src/cli.ts` 五处（内容锚点；T2 若先落，行号会移，按锚点重放）。

(a) imports，before：
```ts
import { pathToFileURL } from "node:url";
import { runControlCommand } from "./control/command.js";
```
after：
```ts
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { resolveAgent } from "./agents/materialize.js";
import { getDescriptor } from "./agents/registry.js";
import { readAgentsTable } from "./agents/table.js";
import { runControlCommand } from "./control/command.js";
```

(b) `ParsedArgs`，before（第一个 `run` 成员的尾与 `resume` 成员的头）：
```ts
      adapter: "scripted" | "claude" | "codex";
      adapterConfigPath: string;
    }
  | {
      command: "resume";
```
after：
```ts
      adapter: "scripted" | "claude" | "codex";
      adapterConfigPath: string;
    }
  // Orca agent selection (2026-09-26), spec §4.9: the agents-table form of `run`, used by Orca's reconcile run.
  | {
      command: "run";
      contractPath: string;
      runDir: string;
      agentsTablePath: string;
      agentSelectionPath: string;
    }
  | {
      command: "resume";
```

(c) `parseArgs`，before：
```ts
  const runDir = values.get("--run-dir");
  const adapter = values.get("--adapter");
```
after：
```ts
  // Orca agent selection (2026-09-26), spec §4.9: `--agents <table> --agent-selection <file>` replaces
  // --adapter/--adapter-config instead of combining with them, and only `run` takes it — a run started this
  // way cannot be resumed or swept (spec §11). `sweep` never reaches here: without --adapter it has already
  // refused above as missing required flags.
  const agentsTablePath = values.get("--agents");
  const agentSelectionPath = values.get("--agent-selection");
  if (agentsTablePath !== undefined || agentSelectionPath !== undefined) {
    if (values.has("--adapter") || values.has("--adapter-config")) {
      throw new Error("--agents and --adapter are mutually exclusive");
    }
    if (command !== "run") {
      throw new Error("--agents is only supported by run");
    }
    const agentsRunDir = values.get("--run-dir");
    const agentsContractPath = values.get("--contract");
    if (!agentsRunDir || !agentsContractPath || !agentsTablePath || !agentSelectionPath) {
      throw new Error("missing required flags");
    }
    return { command, contractPath: agentsContractPath, runDir: agentsRunDir, agentsTablePath, agentSelectionPath };
  }

  const runDir = values.get("--run-dir");
  const adapter = values.get("--adapter");
```

(d) `loadAdapter` 的参数类型（新成员没有 `adapter`，`Extract` 须排除它，否则 typecheck 红），before：
```ts
async function loadAdapter(parsed: Extract<ParsedArgs, { command: "run" | "resume" }>): Promise<RuntimeAdapter> {
```
after：
```ts
async function loadAdapter(parsed: Extract<ParsedArgs, { command: "run" | "resume"; adapterConfigPath: string }>): Promise<RuntimeAdapter> {
```
并在该函数的 `}` 之后、`// L3 §5.4's escape hatch.` 之前插入：
```ts
const selectionFileSchema = z.object({
  selection: z.object({
    agent: z.string().min(1),
    model: z.string().min(1),
    contextWindow: z.union([z.literal("agent-default"), z.number().int().positive().max(Number.MAX_SAFE_INTEGER)]),
  }).strict(),
  configHash: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

// Orca agent selection (2026-09-26), spec §4.9 and §12 C5: the selection Orca froze for this run is
// materialized here against the table as it is NOW. resolveAgent probes `<command> --version` and refuses a
// drifted installation (agent-version-drift); a table entry edited since Orca froze the selection changes the
// hash (control-config-hash-mismatch). Either refusal happens before the contract is read or anything runs.
async function runWithAgents(parsed: Extract<ParsedArgs, { agentsTablePath: string }>): Promise<number> {
  const table = await readAgentsTable(parsed.agentsTablePath);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(parsed.agentSelectionPath, "utf8"));
  } catch (error) {
    throw new Error(`agent-selection-file-invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  const file = selectionFileSchema.safeParse(raw);
  if (!file.success) throw new Error(`agent-selection-file-invalid: ${file.error.message}`);
  const { config, resolution } = await resolveAgent(table, file.data.selection);
  if (resolution.configHash !== file.data.configHash) {
    throw new Error(`control-config-hash-mismatch: selection file ${file.data.configHash}, materialized ${resolution.configHash}`);
  }
  const adapter = getDescriptor(config.kind).createAdapter(config);
  // The same notice `run --adapter codex` prints below.
  if (config.kind === "codex") console.error("Codex budgetMode=soft: token usage is accounted after each phase; no strict token cap is guaranteed.");
  const contract = await loadContract(parsed.contractPath);
  const finalState = await runLoop(contract, parsed.runDir, adapter);
  return finalState.status === "succeeded" ? 0 : 2;
}
```

(e) `main`，在 `    // \`sweep\` returns HERE — before loadAdapter, …` 这一注释块**之前**插入（放在 codex 提示那一行之前，是为了 `"agentsTablePath" in parsed` 的假支把 `parsed` 收窄成带 `adapter` 的成员，下面 `parsed.adapter` 才过 typecheck）：
```ts
    // The agents-table form of `run` (spec §4.9) builds its adapter from the table, not from --adapter.
    if ("agentsTablePath" in parsed) return await runWithAgents(parsed);

```

- [ ] **Step 6.4：跑，确认绿；既有 CLI 判据不红；typecheck**

```bash
./node_modules/.bin/vitest run tests/cli > $S/t6-green.log 2>&1; echo rc=$?     # 期望 rc=0：agentsRun 11/11，cli.test.ts、codex.test.ts 全绿
npm run typecheck > $S/t6-tsc.log 2>&1; echo rc=$?                            # 期望 rc=0
```

- [ ] **Step 6.5：提交**

```bash
/usr/bin/git -C $C add src/cli.ts tests/cli/agentsRun.test.ts
/usr/bin/git -C $C commit -m "feat(cli): run with an agents table and a frozen selection

Orca agent selection (2026-09-26), spec §4.9 and §12 C5: ccloop run --agents <table>
--agent-selection <file> re-materializes the selection, refuses a drifted version or a
different configHash before anything runs, and is mutually exclusive with --adapter.

Co-Authored-By: <实施席自己的模型> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR"
```

- [ ] **Step 6.6：变异表**（同 3.6 的做法；6.5 之后克隆；只跑 `tests/cli/agentsRun.test.ts`；W2 现测结果在「期望红」栏，日志 `scratchpad/W2/mut-T6M*.log`）

| V | 变异（`src/cli.ts`） | 期望红（且仅） |
|---|---|---|
| T6M1 | 删 `if (resolution.configHash !== file.data.configHash) { throw … }` 整块 | 仅「refuses a selection file whose configHash differs…」 |
| T6M2 | 删 `if (values.has("--adapter") \|\| values.has("--adapter-config")) { throw … }` 整块 | 两条「--agents and --adapter are mutually exclusive」 |
| T6M3 | `await resolveAgent(table, file.data.selection)` 改为传 `{ probeVersion: async () => table.installations[file.data.selection.agent]!.version }` | 仅「refuses an installation whose --version no longer matches…」 |
| T6M4 | 删 `if (command !== "run") { throw … }` 整块 | 仅「refuses ["resume",…]」 |
| T6M5 | 删 `if (!file.success) throw …` 一行（其后 `file.data.` 改读 `raw`） | 仅「refuses a malformed selection file by name」 |
| T6M6 | `if (!agentsRunDir \|\| !agentsContractPath \|\| !agentsTablePath \|\| !agentSelectionPath)` 改为 `if (!agentsRunDir \|\| !agentsContractPath)` | 两条 `missing required flags` 的 refuses（RED 阶段就绿的那两条） |
| T6M7 | 删 `runWithAgents` 里 `if (config.kind === "codex") console.error(…)` 一行 | 仅「runs a codex installation the same way…」 |

结果记进 `mutations.md`（只追加）。

---

### 给控制器的交接要点

1. W2-1 到 W2-15 待裁；其中 **W2-2／W2-3／W2-7 是对 T1 的要求**（`probeVersion` 以 `[...command,"--version"]` 调用；`AgentError.message` 以 code 开头；`resolveAgent` 缺省跑探测），与 T1 写作席的分节对一下。
2. **W2-6：T5 要补一条 worker 层的判据 3**，本分节的只到适配器层。
3. T1 落地后在真 T1 上重跑本分节全部判据与 3.6、6.6 两张变异表（本分节是在 T1 探针桩上现测的）。
