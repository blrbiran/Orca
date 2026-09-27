# claude 中止前观测用量（stream-json）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 ccloop 在 claude 阶段被中止时报出「中止前从 stream-json 观测到的用量（下界）」，使 Orca 下被 handoff deadline 中止的 claude run 可续。

**Architecture:** ccloop 的 claude runner 改用 `--output-format stream-json --verbose --include-partial-messages`，逐行解析、不保留整条流；按消息 id 累计 `message_start`／`message_delta` 的 usage，每次变化原子写到 adapter 经 `CCLOOP_CLAUDE_OBSERVED_USAGE_PATH` 给的路径；adapter 在 `aborted` 时读它，填 `ClaudePhaseAborted.observedTokens`。正常跑完仍用 `result` 事件，记账逐位不变。Orca 不改代码，只加一条端到端判据。

**Tech Stack:** Node 22 ESM（`.mjs` runner 与 fake）、TypeScript、vitest。

**Spec:** `docs/superpowers/specs/2026-09-27-claude-stream-usage-design.md`（Orca）。读计划前先读 spec §2–§5。进度源 `.superpowers/sdd/2026-09-27-claude-stream-usage/progress.md`。

## Global Constraints

- ccloop 仓 `/Users/biran/code/skills/loop/ccloop`，Orca 仓 `/Users/biran/code/skills/loop/Orca`。两仓都**直接在 `main` 上落本地提交**；**绝不 `git push`**，不开分支、不删分支、不建 worktree。
- 提交信息结尾两行：`Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` 与 `Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN`。
- ccloop 跑判据前 `export ECC_GATEGUARD=off DISABLE_OMC=1`；用 `./node_modules/.bin/vitest run <file>`；输出重定向到文件再整份读回（不许 `| tail`／`| grep`）。
- ccloop **主树不跑 `npm run build`、不跑全量**；只跑本 Task 点名的判据文件（它们不依赖 `dist/`）。
- **不许改既有判据**，唯一例外是 spec §5.3 点名的四条（全在 Task 2），且只改 argv 的前缀、位置、长度断言。别的既有判据红了 ⇒ **停下报控制器**，不要改它。
- 新旧常量：观测文件 schema `"ccloop-claude-observed-usage-v1"`；环境变量 `CCLOOP_CLAUDE_OBSERVED_USAGE_PATH`；stdout 失败末尾 `FAILURE_OUTPUT_TAIL = 8192`（不变）；单行上限 `10 * 1024 * 1024` 字节。
- fake 的固定 usage（各判据逐位断言用）：`message_start` ＝ `{input_tokens:2, cache_creation_input_tokens:100, cache_read_input_tokens:1000, output_tokens:1}`（总 1103）；`message_delta` ＝ `{input_tokens:2, cache_creation_input_tokens:100, cache_read_input_tokens:1000, output_tokens:7}`（总 1109）；`result.usage` ＝ `{input_tokens:12, output_tokens:3}`（总 15，与今天 `json` 回包同值）。
- 仓库外零写入：判据只写 `mkdtemp` 临时目录。
- 注释风格照邻近代码：英文，写「为什么」，新改写处写明依据的人裁。

## Review Focus

1. **正常阶段记账不变**：stream 下 `tokenUsage`／`usageEvidence` 必须与今天 `json` 回包算出的逐位相等（Task 2 N1）。
2. **观测文件绝不落进 worktree**：runner 的 cwd 是 worktree；没有 env 路径时一个字节都不写（Task 2 N9a、Task 3 N9b）。
3. **大流不失败**：超过 10 MiB 的增量行不能让阶段失败（Task 2 N10）。
4. **`null` 不当 0**：没有观测、观测为 0、文件损坏 ⇒ `observedTokens` 为 `null`（Task 2 N5、Task 3 N5b）。
5. **观测是边跑边写的**：runner 还活着时文件就在盘上（Task 2 N6）。

---

### Task 1: fake claude CLI 支持 stream-json（ccloop）

**Files:**
- Modify: `tests/fixtures/fake-claude-cli.mjs`
- Test: `tests/runtime/claude/fakeClaudeCli.test.ts`（**只追加** 新 `it`，不改既有）

**Interfaces:**
- Produces（后续 Task 依赖）：fake 的新 argv 形态与模式——
  - 接受布尔参数 `--verbose`、`--include-partial-messages`；`--output-format` 接受 `json` 或 `stream-json`。
  - `stream-json` 下正常回答按行输出：`{"type":"system","subtype":"init"}`、`{"type":"stream_event","event":{"type":"message_start","message":{"id":"msg_fake_1","usage":<START>}}}`、`{"type":"assistant","message":{"id":"msg_fake_1","usage":<START>,"content":[]}}`、`{"type":"stream_event","event":{"type":"message_delta","usage":<DELTA>}}`、`{"type":"stream_event","event":{"type":"message_stop"}}`、`{"type":"result","subtype":"success","is_error":false,"structured_output":<body>,"usage":{"input_tokens":12,"output_tokens":3}}`（每行以 `\n` 结尾）。
  - 新模式 `usage-then-hang`（吐 init＋一整条消息后永不回答）、`start-then-hang`（吐 init＋`message_start` 后永不回答）、`flood`（init、`message_start` 后吐 11 × 1024 行 `content_block_delta`、每行约 1 KiB，再正常收尾）。
  - `script` 模式条目 `usageBeforeDelay: true`：若该阶段有 `delayMs`，在等待前先吐 init＋一整条消息。
  - `<marker>` JSON 增加字段 `observedUsagePathEnv: process.env.CCLOOP_CLAUDE_OBSERVED_USAGE_PATH ?? null`。
  - `json` 模式输出一字不变；`hang`／`grandchild` 仍一字不吐。

- [ ] **Step 1: 写失败的判据**（追加到 `fakeClaudeCli.test.ts` 的 describe 末尾；`launch`、`workdir`、`prompts`、`schemas` 是文件里已有的 helper）

```ts
  // Orca claude stream usage (2026-09-27, spec §5.1): the runner now asks for stream-json; the fake answers in
  // claude 2.1.283's measured event order (spec §2.2) with fixed usage the runner and adapter criteria assert.
  const streamArgs = (phase: Phase, prompt: string) =>
    ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--json-schema", JSON.stringify(schemas[phase]), prompt];
  const lines = (stdout: string) => stdout.split("\n").filter((line) => line !== "").map((line) => JSON.parse(line));

  it("answers stream-json in claude's event order, closing each message with its final usage", async () => {
    const cwd = await workdir();
    const result = await launch(cwd, ["ok", join(cwd, "marker.json"), ...streamArgs("plan", prompts.plan("a"))]);
    expect(result.code).toBe(0);
    const events = lines(result.stdout);
    expect(events.map((e) => e.type === "stream_event" ? `stream:${e.event.type}` : e.type)).toEqual(
      ["system", "stream:message_start", "assistant", "stream:message_delta", "stream:message_stop", "result"]);
    expect(events[1].event.message.usage).toEqual({ input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 1 });
    expect(events[3].event.usage).toEqual({ input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 7 });
    expect(events[5]).toMatchObject({ type: "result", usage: { input_tokens: 12, output_tokens: 3 } });
    expect(Object.keys(events[5].structured_output)).toContain("summary");
  });

  it("stops after one closed message in usage-then-hang and after message_start in start-then-hang", async () => {
    for (const [mode, last] of [["usage-then-hang", "stream:message_stop"], ["start-then-hang", "stream:message_start"]] as const) {
      const cwd = await workdir();
      const child = spawn(process.execPath, [fakeCli, mode, join(cwd, "marker.json"), ...streamArgs("plan", prompts.plan("a"))], { cwd, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      child.stdout.on("data", (chunk) => { stdout += String(chunk); });
      await expect.poll(() => stdout.includes(last === "stream:message_stop" ? '"message_stop"' : '"message_start"'), { timeout: 5000 }).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 300));
      child.kill("SIGKILL");
      const kinds = lines(stdout).map((e) => e.type === "stream_event" ? `stream:${e.event.type}` : e.type);
      expect(kinds.at(-1)).toBe(last);
      expect(kinds).not.toContain("result");
    }
  });

  it("floods more than 10 MiB of deltas before its result in flood mode", async () => {
    const cwd = await workdir();
    const result = await launch(cwd, ["flood", join(cwd, "marker.json"), ...streamArgs("plan", prompts.plan("a"))]);
    expect(result.code).toBe(0);
    expect(Buffer.byteLength(result.stdout)).toBeGreaterThan(10 * 1024 * 1024);
    expect(lines(result.stdout).at(-1)).toMatchObject({ type: "result", usage: { input_tokens: 12, output_tokens: 3 } });
  });

  it("reports one closed message before a scripted delay when usageBeforeDelay is set", async () => {
    const cwd = await workdir();
    const scriptPath = join(cwd, "script.json");
    await writeFile(scriptPath, JSON.stringify({ a: { files: { "a.txt": "A\n" }, delayMs: { execute: 30_000 }, usageBeforeDelay: true } }));
    const child = spawn(process.execPath, [fakeCli, "script", join(cwd, "marker.json"), scriptPath, ...streamArgs("execute", prompts.execute("a"))], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    await expect.poll(() => stdout.includes('"message_delta"'), { timeout: 5000 }).toBe(true);
    child.kill("SIGKILL");
    expect(stdout).not.toContain('"result"');
  });

  it("records whether the observed-usage path reached it", async () => {
    const cwd = await workdir();
    await launch(cwd, ["ok", join(cwd, "marker.json"), ...streamArgs("plan", prompts.plan("a"))]);
    expect(JSON.parse(await readFile(join(cwd, "marker.json"), "utf8")).observedUsagePathEnv).toBeNull();
  });
```

若文件顶部没有 `spawn`、`fakeCli`、`writeFile`、`Phase` 的 import／定义，照文件既有写法补上（`fakeCli` 与 `launch` 用的是同一路径）。`launch` 若不接受 `env`，最后一条判据用默认环境即可（测试进程里没有该变量）。

- [ ] **Step 2: 跑，确认红**

Run: `cd /Users/biran/code/skills/loop/ccloop && ECC_GATEGUARD=off DISABLE_OMC=1 ./node_modules/.bin/vitest run tests/runtime/claude/fakeClaudeCli.test.ts > /tmp/t1-red.log 2>&1; echo rc=$?; cat /tmp/t1-red.log`（日志路径可换成自己的临时目录）
Expected: 新增 5 条红（`expected -p --output-format json …` 或 `unknown argument --verbose`），既有全绿。

- [ ] **Step 3: 实现 fake**

在参数循环里把 `--verbose`、`--include-partial-messages` 当布尔参数（`if (arg === "--verbose" || arg === "--include-partial-messages") continue;`）；把校验改为 `outputFormat !== "json" && outputFormat !== "stream-json"`，失败信息改为 `expected -p --output-format json|stream-json --json-schema <schema> [--model <model>] <prompt>`（**先 grep 既有判据是否断言这句文字；若有，保留原文字不改并只放宽条件**）。marker JSON 加 `observedUsagePathEnv`。

加这些 helper（放在 `const respond` 之前）：

```js
const START_USAGE = { input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 1 };
const DELTA_USAGE = { input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 7 };
const stream = outputFormat === "stream-json";
const emit = (event) => new Promise((resolve) => { if (process.stdout.write(`${JSON.stringify(event)}\n`)) resolve(); else process.stdout.once("drain", resolve); });
const emitInit = () => emit({ type: "system", subtype: "init", model: model ?? "fake" });
const emitStart = () => emit({ type: "stream_event", event: { type: "message_start", message: { id: "msg_fake_1", usage: START_USAGE } } });
const emitClosedMessage = async () => {
  await emitStart();
  await emit({ type: "assistant", message: { id: "msg_fake_1", usage: START_USAGE, content: [] } });
  await emit({ type: "stream_event", event: { type: "message_delta", usage: DELTA_USAGE } });
  await emit({ type: "stream_event", event: { type: "message_stop" } });
};
```

`hang`／`grandchild` 分支之前加三种新模式（`usage-then-hang`、`start-then-hang` 只在 `stream` 下吐事件；都写 `.calls`？**不写**，与 `hang` 一致）：

```js
if (mode === "usage-then-hang" || mode === "start-then-hang") {
  if (stream) { await emitInit(); if (mode === "usage-then-hang") await emitClosedMessage(); else await emitStart(); }
  setInterval(() => {}, 1000);
}
```

并把原来的 `if (mode === "hang" || mode === "grandchild") { … } else { … }` 改成 `else if (mode === "hang" || …) { … } else { … }`。在正常回答分支里，`respond` 改为：

```js
  const respond = async () => {
    if (mode === "script" && phase === "execute") for (const [path, content] of Object.entries(entry.files)) writeFileSync(path, content);
    const envelope = { type: "result", subtype: "success", is_error: false, structured_output: body, usage: { input_tokens: 12, output_tokens: 3 } };
    if (!stream) { process.stdout.write(JSON.stringify(envelope)); return; }
    if (!openedBeforeDelay) { await emitInit(); await emitClosedMessage(); }
    await emit(envelope);
  };
```

`flood` 模式在 `stream` 下、`respond` 里 `emitInit()` 之后、`emitClosedMessage()` 之前插入：

```js
    if (mode === "flood") {
      await emitStart();
      const text = "x".repeat(1000);
      for (let i = 0; i < 11 * 1024; i += 1) await emit({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } } });
    }
```

（`flood` 走与 `ok` 相同的 body；让 `mode === "flood"` 在 phase 判定与 body 构造上等同 `ok`。）`usageBeforeDelay`：

```js
  let openedBeforeDelay = false;
  const delay = entry?.delayMs?.[phase];
  if (!refused) {
    if (delay === undefined) await respond();
    else {
      if (stream && entry?.usageBeforeDelay === true) { await emitInit(); await emitClosedMessage(); openedBeforeDelay = true; }
      setTimeout(() => { void respond(); }, delay);
    }
  }
```

（`let openedBeforeDelay` 要声明在 `respond` 之前。）文件头注释的 Modes 一行补上三种新模式与 `stream-json`。

- [ ] **Step 4: 跑，确认绿**

同 Step 2 的命令。Expected: 整个文件全绿（新 5 条＋既有）。

- [ ] **Step 5: 提交**

```bash
cd /Users/biran/code/skills/loop/ccloop && git add tests/fixtures/fake-claude-cli.mjs tests/runtime/claude/fakeClaudeCli.test.ts && git commit -F - <<'EOF'
test(claude): let the fake claude CLI answer stream-json in the order real claude streams it

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN
EOF
```

---

### Task 2: runner 逐行读 stream、记观测、不保留整条流（ccloop）

**Files:**
- Create: `scripts/claude-stream.mjs`（纯函数：usage 口径、行切分、观测累计、原子写）
- Modify: `scripts/claude-phase-runner.mjs`（把 `USAGE_FIELDS`／`CACHE_USAGE_FIELDS`／`inspectUsageField`／`buildUsageEvidence` **原样搬进** `claude-stream.mjs` 并 import 回来；`runClaude` 改用 `spawn`；`claudeEnv` 剥新变量）
- Create: `tests/runtime/claude/claudeStream.test.ts`（N5 单元）
- Create: `tests/runtime/claude/claudePhaseRunnerStream.test.ts`（N1、N6、N7、N9a、N10）
- Modify（spec §5.3 点名改写 #3、#4）：`tests/runtime/claude/claudePhaseRunnerEnv.test.ts`
- Modify（spec §5.3 点名改写 #1、#2）：`tests/runtime/claude/claudeAgentAdapter.test.ts`

**Interfaces:**
- Consumes: Task 1 的 fake。
- Produces（Task 3 依赖）：
  - `scripts/claude-stream.mjs` 导出 `buildUsageEvidence(envelope)`（与搬前逐字相同）、`createLineSplitter(onLine, maxLineBytes = 10 * 1024 * 1024)` → `{ push(chunk: string): void, end(): void }`、`createUsageObserver()` → `{ observe(event): boolean, snapshot(): { total: number | null, messages: Array<{ id: string, state: "open" | "closed", fields: Record<string, number> }>, openMessage: boolean } }`、`writeObservation(path, snapshot)`（同步、原子、`0o600`）、`OBSERVED_USAGE_SCHEMA = "ccloop-claude-observed-usage-v1"`。
  - runner 调 claude 的 argv：`[...command.slice(1), "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--json-schema", <schema>, ...extraArgs, prompt]`。
  - 观测文件内容：`{ schema, total, messages, source: "stream-before-abort", lowerBound: true, openMessage }`，只在 `total !== null` 且变化时写。

- [ ] **Step 1: 写 `claudeStream.test.ts`（N5 与观测口径）**

```ts
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script without types
import { createLineSplitter, createUsageObserver, writeObservation, OBSERVED_USAGE_SCHEMA } from "../../../scripts/claude-stream.mjs";

// Orca claude stream usage (2026-09-27), spec §3.1 items 2, 4, 5 and §4: what the runner counts from claude's stream.
const START = { input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 1 };
const DELTA = { ...START, output_tokens: 7 };
const start = (id: string, usage: unknown = START) => ({ type: "stream_event", event: { type: "message_start", message: { id, usage } } });
const delta = (usage: unknown = DELTA) => ({ type: "stream_event", event: { type: "message_delta", usage } });
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

describe("claude stream observation (spec §3.1)", () => {
  it("counts each message once: its message_start snapshot until message_delta closes it", () => {
    const o = createUsageObserver();
    expect(o.observe(start("m1"))).toBe(true);
    expect(o.snapshot()).toMatchObject({ total: 1103, openMessage: true });
    expect(o.observe({ type: "assistant", message: { id: "m1", usage: START } })).toBe(false);
    expect(o.observe(delta())).toBe(true);
    expect(o.snapshot()).toMatchObject({ total: 1109, openMessage: false, messages: [{ id: "m1", state: "closed" }] });
    o.observe(start("m2"));
    expect(o.snapshot()).toMatchObject({ total: 1109 + 1103, openMessage: true });
  });

  it("gives no total for nothing, for zero, and skips non-finite or negative fields", () => {
    const o = createUsageObserver();
    expect(o.snapshot().total).toBeNull();
    o.observe(start("m0", { input_tokens: 0, output_tokens: 0 }));
    expect(o.snapshot().total).toBeNull();
    const p = createUsageObserver();
    p.observe(start("m1", { input_tokens: 5, output_tokens: -3, cache_read_input_tokens: "7" }));
    expect(p.snapshot().total).toBe(5);
  });

  it("ignores a message_delta with no open message and events that are not usage", () => {
    const o = createUsageObserver();
    expect(o.observe(delta())).toBe(false);
    expect(o.observe({ type: "result", usage: { input_tokens: 9 } })).toBe(false);
    expect(o.snapshot().total).toBeNull();
  });

  it("splits lines across chunks, parses a last line without newline at end, and drops a line over the cap", () => {
    const seen: string[] = [];
    const s = createLineSplitter((line: string) => seen.push(line), 16);
    s.push('{"a":1}\n{"b"'); s.push(':2}\n'); s.push("x".repeat(40)); s.push("\n{\"c\":3}");
    s.end();
    expect(seen).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  });

  it("writes the observation atomically with mode 0600", async () => {
    const dir = await mkdtemp(join(tmpdir(), "claude-stream-")); dirs.push(dir);
    const o = createUsageObserver(); o.observe(start("m1"));
    const path = join(dir, "observed-usage.json");
    writeObservation(path, o.snapshot());
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ schema: OBSERVED_USAGE_SCHEMA, total: 1103, messages: [{ id: "m1", state: "open", fields: START }], source: "stream-before-abort", lowerBound: true, openMessage: true });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });
});
```

- [ ] **Step 2: 跑，确认红**（模块不存在）

Run: `cd /Users/biran/code/skills/loop/ccloop && ECC_GATEGUARD=off DISABLE_OMC=1 ./node_modules/.bin/vitest run tests/runtime/claude/claudeStream.test.ts > <tmp>/t2a.log 2>&1; echo rc=$?; cat <tmp>/t2a.log`
Expected: 失败于 import。

- [ ] **Step 3: 写 `scripts/claude-stream.mjs`**

```js
// Orca claude stream usage (2026-09-27), spec docs/superpowers/specs/2026-09-27-claude-stream-usage-design.md in
// the Orca repository: the claude phase runner reads claude's `--output-format stream-json` line by line. This
// module holds the parts that need no process: the usage measure (moved here unchanged from the runner), the line
// splitter, and the observation of usage streamed before a phase ends.
import { renameSync, writeFileSync } from "node:fs";

<把 claude-phase-runner.mjs 里 USAGE_FIELDS、那段 Orca paid round 注释、CACHE_USAGE_FIELDS、inspectUsageField、buildUsageEvidence 逐字剪切到这里，并在 buildUsageEvidence 前加 export>

export const OBSERVED_USAGE_SCHEMA = "ccloop-claude-observed-usage-v1";

/** Feed text chunks; `onLine` gets each complete line. A line longer than `maxLineBytes` is dropped, not kept. */
export function createLineSplitter(onLine, maxLineBytes = 10 * 1024 * 1024) {
  let buffer = "";
  let dropping = false;
  const emit = (line) => { if (line.trim() !== "") onLine(line); };
  return {
    push(chunk) {
      let text = chunk;
      for (;;) {
        const newline = text.indexOf("\n");
        if (newline < 0) break;
        const line = buffer + text.slice(0, newline);
        buffer = "";
        if (!dropping && Buffer.byteLength(line) <= maxLineBytes) emit(line);
        dropping = false;
        text = text.slice(newline + 1);
      }
      if (dropping) return;
      buffer += text;
      if (Buffer.byteLength(buffer) > maxLineBytes) { buffer = ""; dropping = true; }
    },
    end() {
      if (!dropping && buffer !== "") emit(buffer);
      buffer = "";
      dropping = false;
    },
  };
}

/** One message's count: the fields buildUsageEvidence would count, skipping any that are not finite and >= 0. */
function messageTotal(usage) {
  const evidence = buildUsageEvidence({ usage });
  const values = [
    evidence.selectedInputField && evidence.fields[evidence.selectedInputField].value,
    evidence.selectedOutputField && evidence.fields[evidence.selectedOutputField].value,
    ...Object.values(evidence.cacheFields).filter((field) => field.status === "finite").map((field) => field.value),
  ].filter((value) => typeof value === "number" && Number.isFinite(value) && value >= 0);
  return values.reduce((sum, value) => sum + value, 0);
}

/**
 * Spec §2 (claude 2.1.283, measured): input and cache counts are per message and add up across messages; a
 * message_start carries an opening snapshot whose output is low, and the message_delta that follows it carries the
 * message's final usage. So each message counts once, by its latest usage. `assistant` events repeat the
 * message_start usage and are not counted.
 */
export function createUsageObserver() {
  const messages = new Map();
  let current = null;
  return {
    observe(event) {
      const inner = event && event.type === "stream_event" ? event.event : null;
      if (!inner || typeof inner !== "object") return false;
      if (inner.type === "message_start" && inner.message && typeof inner.message.id === "string" && inner.message.usage && typeof inner.message.usage === "object") {
        current = inner.message.id;
        messages.set(current, { id: current, state: "open", fields: inner.message.usage });
        return true;
      }
      if (inner.type === "message_delta" && current !== null && messages.has(current) && inner.usage && typeof inner.usage === "object") {
        messages.set(current, { id: current, state: "closed", fields: inner.usage });
        return true;
      }
      return false;
    },
    snapshot() {
      const list = [...messages.values()];
      const sum = list.reduce((total, message) => total + messageTotal(message.fields), 0);
      return { total: Number.isSafeInteger(sum) && sum > 0 ? sum : null, messages: list, openMessage: list.some((message) => message.state === "open") };
    },
  };
}

/** Temp file in the same directory, then rename: a reader sees the previous version or this one, never half. */
export function writeObservation(path, snapshot) {
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, JSON.stringify({ schema: OBSERVED_USAGE_SCHEMA, total: snapshot.total, messages: snapshot.messages, source: "stream-before-abort", lowerBound: true, openMessage: snapshot.openMessage }), { mode: 0o600 });
  renameSync(temporary, path);
}
```

注意 `messageTotal` 里 `fields[...].value` 对非有限值不存在（`inspectUsageField` 只在 finite 时给 `value`），负数由 `value >= 0` 滤掉；`cache_read_input_tokens: "7"` 是 `invalid_type`，被滤掉。

- [ ] **Step 4: 跑 `claudeStream.test.ts`，确认绿**（同 Step 2 命令）

- [ ] **Step 5: 写 `claudePhaseRunnerStream.test.ts`（N1、N6、N7、N9a、N10）**

```ts
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script without types
import { buildUsageEvidence } from "../../../scripts/claude-stream.mjs";

// Orca claude stream usage (2026-09-27), spec §3.1 and §5.2 N1, N6, N7, N9, N10: the runner against the CLI-level fake.
const runner = fileURLToPath(new URL("../../../scripts/claude-phase-runner.mjs", import.meta.url));
const fakeCli = fileURLToPath(new URL("../../fixtures/fake-claude-cli.mjs", import.meta.url));
const dirs: string[] = [];
const children: number[] = [];
afterEach(async () => {
  for (const pid of children.splice(0)) { try { process.kill(-pid, "SIGKILL"); } catch {} }
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function world() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "claude-runner-stream-"))); dirs.push(dir);
  const worktree = join(dir, "worktree"), evidence = join(dir, "evidence");
  await import("node:fs/promises").then((fs) => Promise.all([fs.mkdir(worktree), fs.mkdir(evidence)]));
  return { dir, worktree, evidence, marker: join(dir, "marker.json"), observed: join(evidence, "observed-usage.json") };
}

function start(w: Awaited<ReturnType<typeof world>>, mode: string, withPath = true) {
  const env: NodeJS.ProcessEnv = { ...process.env, CCLOOP_CLAUDE_COMMAND: JSON.stringify([process.execPath, fakeCli, mode, w.marker]), CCLOOP_CLAUDE_EXTRA_ARGS: "[]" };
  if (withPath) env.CCLOOP_CLAUDE_OBSERVED_USAGE_PATH = w.observed; else delete env.CCLOOP_CLAUDE_OBSERVED_USAGE_PATH;
  const child = spawn(process.execPath, [runner], { cwd: w.worktree, env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
  children.push(child.pid!);
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  const done = new Promise<{ code: number | null }>((resolve) => child.on("close", (code) => resolve({ code })));
  child.stdin.end(JSON.stringify({ phase: "plan", prompt: "Plan one isolated L2 attempt for task t.", attempt: 1, runDir: w.dir, worktreePath: w.worktree }));
  return { child, done, out: () => stdout, err: () => stderr };
}

describe("claude phase runner over stream-json (Orca claude stream usage)", () => {
  it("N1: books a completed phase exactly as the json envelope's usage would have been booked", async () => {
    const w = await world();
    const run = start(w, "ok");
    expect((await run.done).code).toBe(0);
    const answer = JSON.parse(run.out());
    const expected = buildUsageEvidence({ usage: { input_tokens: 12, output_tokens: 3 } });
    expect(answer.usageEvidence).toEqual(expected);
    expect(answer.tokenUsage).toBe(15);
  }, 20_000);

  it("N7: hands the claude CLI stream-json, --verbose and --include-partial-messages", async () => {
    const w = await world();
    await start(w, "ok").done;
    const [argv] = (await readFile(`${w.marker}.argv`, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as string[]);
    expect(argv!.slice(0, 6)).toEqual(["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--json-schema"]);
  }, 20_000);

  it("N6: puts the observation on disk while claude is still running, and it survives a SIGKILL of the group", async () => {
    const w = await world();
    const run = start(w, "usage-then-hang");
    await expect.poll(() => existsSync(w.observed), { timeout: 10_000 }).toBe(true);
    expect(run.child.exitCode).toBeNull();
    process.kill(-run.child.pid!, "SIGKILL");
    await run.done;
    expect(JSON.parse(await readFile(w.observed, "utf8"))).toMatchObject({ total: 1109, openMessage: false, lowerBound: true, source: "stream-before-abort" });
  }, 20_000);

  it("N9a: keeps the observed-usage path from claude, and writes nothing into the worktree without one", async () => {
    const w = await world();
    await start(w, "ok").done;
    expect(JSON.parse(await readFile(w.marker, "utf8")).observedUsagePathEnv).toBeNull();
    const bare = await world();
    const run = start(bare, "usage-then-hang", false);
    await expect.poll(async () => (await readFile(`${bare.marker}.argv`, "utf8").catch(() => "")) !== "", { timeout: 10_000 }).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    process.kill(-run.child.pid!, "SIGKILL");
    await run.done;
    expect(await readdir(bare.worktree)).toEqual([]);
    expect(await readdir(bare.evidence)).toEqual([]);
  }, 20_000);

  it("N10: does not fail a phase whose stream runs past 10 MiB", async () => {
    const w = await world();
    const run = start(w, "flood");
    expect((await run.done).code).toBe(0);
    expect(JSON.parse(run.out()).tokenUsage).toBe(15);
  }, 60_000);
});
```

- [ ] **Step 6: 跑，确认红**：`claudePhaseRunnerStream.test.ts` 5 条应红（N7 argv 仍是 json；N6 无文件；N10 撞 maxBuffer 或 fake 在 json 下不吐 flood；N1 可能因 fake 在 json 下仍绿——记录实际结果即可）。

- [ ] **Step 7: 改 runner**

1. 顶部加 `import { spawn } from "node:child_process";`（若已有 `execFile` 的 import，保留它给别处用；`runClaude` 不再用 `execFile`）与 `import { buildUsageEvidence, createLineSplitter, createUsageObserver, writeObservation } from "./claude-stream.mjs";`，删除搬走的四段定义。
2. `claudeEnv()` 改为同时剥 `CCLOOP_CLAUDE_OBSERVED_USAGE_PATH`，注释补一句：`// Orca claude stream usage (2026-09-27): so is the observation path the adapter hands this runner.`
3. `runClaude` 改为：

```js
async function runClaude(request, claudeCommand, extraArgs) {
  const schema = getSchemaForPhase(request.phase);
  // Orca claude stream usage (2026-09-27), spec §3.1: stream-json with partial messages, so the usage claude spends is
  // seen as it streams and survives an abort. Read line by line and never kept whole: the stream is several times the
  // size of the json envelope and echoes tool results (spec §2.2 item 8), so the old 10 MiB buffer could fail a long
  // execute. Kept: the result line, the observation, and the last FAILURE_OUTPUT_TAIL characters for failures (B2).
  const child = spawn(
    claudeCommand[0],
    [...claudeCommand.slice(1), "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--json-schema", JSON.stringify(schema), ...extraArgs, request.prompt],
    { cwd: request.worktreePath, env: claudeEnv(), stdio: ["pipe", "pipe", "pipe"] },
  );
  child.stdin?.end();
  trackClaudeProcessClose(child);
  currentClaudeProcess = child;
  const observationPath = process.env.CCLOOP_CLAUDE_OBSERVED_USAGE_PATH;
  const observer = createUsageObserver();
  let resultEvent = null;
  const splitter = createLineSplitter((line) => {
    let event;
    try { event = JSON.parse(line); } catch { return; }
    if (event && event.type === "result") { resultEvent = event; return; }
    if (observer.observe(event) && observationPath) {
      const snapshot = observer.snapshot();
      if (snapshot.total !== null) {
        try { writeObservation(observationPath, snapshot); } catch (error) { process.stderr.write(`claude-runner: observation not written: ${String(error)}\n`); }
      }
    }
  });
  try {
    return await new Promise((resolve, reject) => {
      let stdoutTail = "", stdoutLength = 0, stderr = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdoutLength += chunk.length;
        stdoutTail = (stdoutTail + chunk).slice(-FAILURE_OUTPUT_TAIL);
        splitter.push(chunk);
      });
      child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
      child.on("error", reject);
      child.on("close", (code) => {
        splitter.end();
        if (code !== 0) { reject(new Error(failureMessage(code, { tail: stdoutTail, length: stdoutLength }, stderr))); return; }
        resolve({ envelope: resultEvent, stderr });
      });
    });
  } finally {
    currentClaudeProcess = null;
  }
}
```

4. `failureMessage`／`outputTail` 改成接受 stdout 的 `{tail, length}`，**产出的文字与今天逐字相同**：

```js
function outputTail(text, length = text.length) {
  const kept = text.slice(-FAILURE_OUTPUT_TAIL);
  return length > FAILURE_OUTPUT_TAIL ? `[${length - FAILURE_OUTPUT_TAIL} earlier characters dropped]${kept}` : kept;
}

function failureMessage(code, stdout, stderr) {
  return [
    `claude exited with code ${code}`,
    stderr ? `stderr: ${outputTail(stderr)}` : null,
    stdout.length > 0 ? `stdout: ${outputTail(stdout.tail, stdout.length)}` : null,
  ].filter((line) => line !== null).join("\n");
}
```

5. `main()` 里 `const envelope = JSON.parse(result.stdout);` 改为：

```js
    const envelope = result.envelope;
    if (envelope === null) throw new Error("Claude CLI did not return structured_output");
```

（与今天「回包不是对象／没有 structured_output」落到同一个错误文字；后面 `structured` 的判断照旧。）

- [ ] **Step 8: 点名改写 spec §5.3 的四条**（只改 argv 断言，旁边加注释）

`claudePhaseRunnerEnv.test.ts`：
- `runs \`claude\` from PATH …`：`toHaveLength(6)` → `toHaveLength(8)`；`slice(0, 4)` 那行 → `expect(argv!.slice(0, 6)).toEqual(["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--json-schema"]);`；`argv![5]` → `argv![7]`。
- `runs the named argv tuple …`：`toHaveLength(8)` → `toHaveLength(10)`；`slice(5)` → `slice(7)`。

`claudeAgentAdapter.test.ts`：
- `passes the selected model …`：`slice(0, 4)` 行同上改为 `slice(0, 6)` 的六元素；`slice(5, 7)` → `slice(7, 9)`；`toHaveLength(8)` → `toHaveLength(10)`；`argv![7]` → `argv![9]`。
- `selects the 1M context window …`：`slice(5, 7)` → `slice(7, 9)`。

每条被改的断言上方加一行：

```ts
    // Rewritten for Orca claude stream usage (2026-09-27, spec §5.3, named by the human with the spec): the runner now
    // asks for stream-json with --verbose and --include-partial-messages, which moves --model and the prompt two places.
```

- [ ] **Step 9: 跑 runtime/claude 全目录，确认绿**

Run: `cd /Users/biran/code/skills/loop/ccloop && ECC_GATEGUARD=off DISABLE_OMC=1 ./node_modules/.bin/vitest run tests/runtime/claude > <tmp>/t2.log 2>&1; echo rc=$?; cat <tmp>/t2.log`
Expected: 全绿。**若 `claudePhaseRunnerFailure`、`claudePhaseSchemas`、`claudePhaseUsageCache`、`subprocessClaudeAdapter` 等既有判据有红，停下报控制器**（不要改它们）。

- [ ] **Step 10: 提交**

```bash
cd /Users/biran/code/skills/loop/ccloop && git add scripts/claude-stream.mjs scripts/claude-phase-runner.mjs tests/runtime/claude/claudeStream.test.ts tests/runtime/claude/claudePhaseRunnerStream.test.ts tests/runtime/claude/claudePhaseRunnerEnv.test.ts tests/runtime/claude/claudeAgentAdapter.test.ts && git commit -F - <<'EOF'
feat(claude): read claude's stream line by line and keep the usage it streamed on disk

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN
EOF
```

---

### Task 3: adapter 把观测报成中止阶段的用量（ccloop）

**Files:**
- Modify: `src/runtime/claude/claudeAgentAdapter.ts`
- Test: `tests/runtime/claude/claudeAgentAdapter.test.ts`（**只追加**；`fixture()` 的 `mode` 联合类型可加新模式——这是 helper，不是判据）

**Interfaces:**
- Consumes: Task 2 的环境变量名、观测文件 schema 与内容。
- Produces: `export class ClaudePhaseAborted { readonly observedTokens: number | null; constructor(evidenceDir: string, observedTokens: number | null) }`；`export async function readObservedTokens(path: string): Promise<number | null>`；观测文件路径 ＝ `<evidenceDir>/observed-usage.json`。

- [ ] **Step 1: 写失败的判据**（追加到 `claudeAgentAdapter.test.ts` 末尾；`fixture` 的 `mode` 类型扩为 `"ok" | "hang" | "grandchild" | "usage-then-hang" | "start-then-hang"`）

```ts
// Orca claude stream usage (2026-09-27), spec §3.2 and §5.2 N2-N5, N9: an aborted phase reports what claude streamed.
describe("ClaudeAgentAdapter, usage observed before an abort (Orca claude stream usage)", () => {
  const abortWhenObserved = async (f: Awaited<ReturnType<typeof fixture>>, phase: "plan" | "execute") => {
    const abort = new AbortController();
    const running = phase === "plan" ? new ClaudeAgentAdapter(f.config).plan({ ...f.context, abortSignal: abort.signal }) : new ClaudeAgentAdapter(f.config).execute({ ...f.context, abortSignal: abort.signal });
    const root = join(f.context.runDir, "claude", String(f.context.attempt), phase);
    let observed = "";
    await expect.poll(async () => {
      try { const [call] = await readdir(root); observed = join(root, call!, "observed-usage.json"); return existsSync(observed); } catch { return false; }
    }, { timeout: 10_000 }).toBe(true);
    abort.abort();
    return { outcome: await running.then((value) => ({ value }), (error: unknown) => ({ error })), observed };
  };

  it("N2: a phase aborted after a closed message reports that message's final usage as a lower bound", async () => {
    const f = await fixture("usage-then-hang");
    const { outcome, observed } = await abortWhenObserved(f, "plan");
    expect((outcome as { error: unknown }).error).toBeInstanceOf(ClaudePhaseAborted);
    expect(((outcome as { error: ClaudePhaseAborted }).error).observedTokens).toBe(1109);
    expect(JSON.parse(await readFile(observed, "utf8"))).toMatchObject({ total: 1109, openMessage: false, lowerBound: true });
  }, 20_000);

  it("N3: a phase aborted inside a message reports that message's opening snapshot and says a message was open", async () => {
    const f = await fixture("start-then-hang");
    const { outcome, observed } = await abortWhenObserved(f, "plan");
    expect(((outcome as { error: ClaudePhaseAborted }).error).observedTokens).toBe(1103);
    expect(JSON.parse(await readFile(observed, "utf8"))).toMatchObject({ total: 1103, openMessage: true });
  }, 20_000);

  it("N4: an aborted execute that observed usage throws it instead of answering null", async () => {
    const f = await fixture("usage-then-hang");
    const { outcome } = await abortWhenObserved(f, "execute");
    expect("error" in outcome).toBe(true);
    expect(((outcome as { error: ClaudePhaseAborted }).error).observedTokens).toBe(1109);
  }, 20_000);

  it("N9b: the observation lands in the call's evidence directory and nothing new appears in the worktree", async () => {
    const f = await fixture("usage-then-hang");
    const before = (await exec("git", ["status", "--porcelain"], { cwd: f.context.worktreePath })).stdout;
    const { observed } = await abortWhenObserved(f, "plan");
    expect(observed.startsWith(join(f.context.runDir, "claude"))).toBe(true);
    expect((await exec("git", ["status", "--porcelain"], { cwd: f.context.worktreePath })).stdout).toBe(before);
  }, 20_000);

  it("N5b: reads no usage from a missing, corrupt, zero or foreign observation file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "claude-observed-"));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const path = join(dir, "observed-usage.json");
    expect(await readObservedTokens(path)).toBeNull();
    for (const body of ["{", JSON.stringify({ schema: "ccloop-claude-observed-usage-v1", total: 0 }), JSON.stringify({ schema: "other", total: 5 }), JSON.stringify({ schema: "ccloop-claude-observed-usage-v1", total: 1.5 })]) {
      await writeFile(path, body);
      expect(await readObservedTokens(path)).toBeNull();
    }
    await writeFile(path, JSON.stringify({ schema: "ccloop-claude-observed-usage-v1", total: 42 }));
    expect(await readObservedTokens(path)).toBe(42);
  });
});
```

补 import：`readObservedTokens` 从 adapter 模块导入；`mkdtemp`、`tmpdir` 若未导入则补。**若 `f.context.worktreePath` 不是 git 仓库**，N9b 改为比较 `readdir(f.context.worktreePath)` 前后相同。

- [ ] **Step 2: 跑，确认红**：`vitest run tests/runtime/claude/claudeAgentAdapter.test.ts` → 新增 5 条红（`observedTokens` 为 null／`readObservedTokens` 未导出）。

- [ ] **Step 3: 实现**

```ts
/**
 * A phase stopped by the abort signal. Orca claude stream usage (2026-09-27), spec §3.2: the runner writes the usage
 * claude streamed before the stop (a lower bound: a message still open counts its opening snapshot) to the call's
 * evidence directory, and that total is carried here; no observation stays null, never 0.
 */
export class ClaudePhaseAborted extends Error {
  constructor(readonly evidenceDir: string, readonly observedTokens: number | null = null) {
    super(`claude-aborted: ${evidenceDir}`);
    this.name = "ClaudePhaseAborted";
  }
}

const OBSERVED_USAGE_FILE = "observed-usage.json";

/** The runner's observation, or null when there is none it can vouch for (missing, corrupt, foreign, not > 0). */
export async function readObservedTokens(path: string): Promise<number | null> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as { schema?: unknown; total?: unknown };
    return parsed.schema === "ccloop-claude-observed-usage-v1" && Number.isSafeInteger(parsed.total) && (parsed.total as number) > 0 ? parsed.total as number : null;
  } catch { return null; }
}
```

- `import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";`
- `run()` 的 env 里加 `CCLOOP_CLAUDE_OBSERVED_USAGE_PATH: join(evidenceDir, OBSERVED_USAGE_FILE),`；`persist()` 写的 `outcome.json` 加字段 `observedUsagePath: join(evidenceDir, OBSERVED_USAGE_FILE)`。
- `phase()`：`if (outcome.reason === "aborted") throw new ClaudePhaseAborted(outcome.evidenceDir, await readObservedTokens(join(outcome.evidenceDir, OBSERVED_USAGE_FILE)));`
- `execute()` 的 catch 改为（注释照 codex）：

```ts
      // As CodexAdapter (Orca claude stream usage, 2026-09-27): an aborted execute that was observed spending tokens
      // throws, so runLoop can settle that usage; one that was not keeps answering null exactly as before.
      if (context.abortSignal?.aborted && !(error instanceof ClaudePhaseAborted && error.observedTokens !== null)) return null;
      throw error;
```

- [ ] **Step 4: 跑 `tests/runtime/claude` 全目录，确认绿**；既有「中止时 `observedTokens` 为 null」那条（`hang` 模式）必须仍绿。别的既有判据红 ⇒ 停下报。

- [ ] **Step 5: `npm run typecheck`**（ccloop 主树，允许：它不写 `dist/`）→ RC 0。

- [ ] **Step 6: 提交**

```bash
cd /Users/biran/code/skills/loop/ccloop && git add src/runtime/claude/claudeAgentAdapter.ts tests/runtime/claude/claudeAgentAdapter.test.ts && git commit -F - <<'EOF'
feat(claude): report the usage claude streamed before a phase was aborted

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN
EOF
```

---

### Task 4: control 层 N8 —— handoff deadline 中止的 claude execute 记下观测用量（ccloop）

**Files:**
- Create: `tests/control/claudeHandoffDeadlineUsage.test.ts`
- Modify（只加 export）: `tests/control/agentsFixture.ts` —— 加 `sealClaude`，形状照 `sealCodex`。

**Interfaces:**
- Consumes: Task 1 的 `script` 模式 `usageBeforeDelay`（stream 下）；Task 3 的 adapter。
- Produces: `export async function sealClaude(installation: …): Promise<{ config, configHash, selection }>`（与 `sealCodex` 同返回形状）。

- [ ] **Step 1: 读 `tests/control/handoffDeadlineUsage.test.ts` 与 `agentsFixture.ts` 的 `sealCodex`／`claudeInstallation`**，照它们写 `sealClaude`（用 `claudeInstallation([process.execPath, FAKE_CLAUDE_CLI, "script", marker, scriptPath], { timeoutMs: 60_000, killGraceMs: 300 })` 构造安装，再按 `sealCodex` 的做法物化、求 hash；selection ＝ `{ agent: "claude", model: "claude-opus-5-5", contextWindow: "agent-default" }`）。

- [ ] **Step 2: 写判据**：复制 `handoffDeadlineUsage.test.ts` 的整条 `it` 为新文件，改动只有：
  - 用 `sealClaude` 与 fake claude 的 `script` 模式；脚本 `{ "codex-test": { files: { "answer.txt": "42\n" }, delayMs: { execute: 30_000 }, usageBeforeDelay: true } }`（任务 id 沿用 `runtime.contract` 的 `codex-test`）；
  - 等待条件改为：`join(runtime.runDir, "claude", "1", "execute")` 下某个 `call-*` 目录里 `observed-usage.json` 存在；
  - `.calls` 断言 `"plan\nexecute\n"` 读 claude marker 的 `.calls`；
  - 用量断言：plan 以 `result` 记 15，execute 中止时观测 1109 ⇒ `[["work", 15], ["work", 1124], ["handoff", 0]]`；
  - 顶部注释写明：Orca claude stream usage (2026-09-27) spec §5.2 N8，claude 版的 C-3；只加。
  其余断言（worktree 里 `answer.txt` 仍是 `"0\n"`、candidate `partial` 且 `unresolvedRequestIds: []`、packet 的 request、events 里的 `handoff deadline interrupted execute in attempt 1`）原样保留。

- [ ] **Step 3: 跑**：`vitest run tests/control/claudeHandoffDeadlineUsage.test.ts` → 绿。若红，先确认是本 Task 的写法问题还是产品行为；产品行为不符 ⇒ 停下报控制器。

- [ ] **Step 4: 提交**

```bash
cd /Users/biran/code/skills/loop/ccloop && git add tests/control/claudeHandoffDeadlineUsage.test.ts tests/control/agentsFixture.ts && git commit -F - <<'EOF'
test(control): book the usage a claude execute streamed before the handoff deadline cut it

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN
EOF
```

---

### Task 5: Orca O1 —— fake claude 下 handoff deadline 中止的 run 可续并落地（Orca）

**Files:**
- Modify: `tests/control/agentSelectionE2E.test.ts`（**只追加** 一条 `it`；文件内 helper `handoffStop` 加可选 `payload = {}` 参数，默认行为不变）

**Interfaces:**
- Consumes: ccloop Task 1–3 的 build（控制器给 `ORCA_CCLOOP_BIN` ＝ scratchpad 里 ccloop clone 的 `dist/cli.js`，`ORCA_AGENTS_TABLE` 夹具表）。

- [ ] **Step 1: 写判据**（放在 C3 之后；helper 都在本文件：`world`、`confirmAgentGroup`、`startConfirmed`、`inExecute`、`handoffStop`、`requestState`、`panelSelections`、`runsOf`、`settledAll`、`noBlocked`、`until`、`raw`、`readDriverRun`）

```ts
  // Orca claude stream usage (2026-09-27), spec §5.2 O1: the goal of that round. Under fake claude an execute cut at the
  // handoff request's deadline (not waited out: the phase sleeps 120 s) reports the usage it streamed, so the run is not
  // usage-unknown, its checkpoint is continuable and the continuation lands -- as handoffE2E's deadline case under codex.
  it("D1: under fake claude, an execute cut at the handoff deadline reports its streamed usage and its continuation lands", async () => {
    const w = await world([{ taskId: "a", targetPaths: ["a1.txt", "a2.txt"] }], {}, { claudeScript: {
      a: { files: { "a1.txt": "A1\n" }, delayMs: { execute: 120_000 }, usageBeforeDelay: true },
      "a#continuation": { files: { "a1.txt": "A1\n", "a2.txt": "A2\n" } },
    } });
    const runtime = await w.boot(); try {
      await confirmAgentGroup(runtime, w.repoId, { defaultAgent: "claude", perAgent: {} });
      await startConfirmed(runtime, 10_000_000);
      runtime.startPump(50);
      await inExecute(w, runtime, ["a"]);
      const [a] = runsOf(runtime, "a");
      const stoppedAt = Date.now();
      const [requestId] = await handoffStop(runtime, { handoffDeadlineAt: new Date(stoppedAt + 3_000).toISOString() });
      await until(() => ["settled-recoverable", "settled-unrecoverable", "outcome-unknown"].includes(requestState(runtime, requestId!)), 120_000, "the request to settle");
      expect(Date.now() - stoppedAt).toBeLessThan(60_000);
      expect(requestState(runtime, requestId!)).toBe("settled-recoverable");
      const parked = readDriverRun(runtime.store, a!.runId) as unknown as Record<string, any>;
      expect(parked.unknown.work).toBe(false);
      const workUsage = runtime.store.db.prepare("SELECT body FROM usage_events WHERE run_id=? ORDER BY seq").all(a!.runId)
        .map((row) => JSON.parse(String(row.body)) as { bucket: string; cumulative: { tokens: number } | null })
        .filter((event) => event.bucket === "work");
      expect(workUsage.length).toBeGreaterThanOrEqual(2);
      expect(workUsage.every((event) => event.cumulative !== null)).toBe(true);
      expect(workUsage.at(-1)!.cumulative!.tokens).toBeGreaterThan(workUsage[0]!.cumulative!.tokens);
      expect(readControlGroup(runtime.store, runtime.epoch, "g").ledger.usageUnknown).toBe(false);
      const selections = panelSelections(runtime);
      expect(selections.map((selection) => selection.taskId)).toEqual(["a"]);
      const resumed = await runtime.service.resumeFromHandoff(raw(runtime, `resume-${++seq}`, "resume-from-handoff", { selections }));
      expect("error" in resumed ? resumed.error : resumed.result.kind).toBe("resumed-from-handoff");
      await until(() => { noBlocked(runtime); return settledAll(runtime, ["a"]); }, 240_000, "the continuation to land");
      expect([w.show("a1.txt"), w.show("a2.txt")]).toEqual(["A1", "A2"]);
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });
```

`handoffStop` 改为 `async function handoffStop(runtime: ControlRuntime, payload: Record<string, unknown> = {}): Promise<string[]>`，内部 `raw(..., "handoff-stop", payload)`。若 `handoffStop` 在 `handoffE2E.test.ts` 里的 payload 字段名不是 `handoffDeadlineAt`，以那个文件为准。

- [ ] **Step 2: 跑**（控制器给的 env；在 Orca **全新 clone** 里跑，或主树只跑这一个文件）：`ORCA_CCLOOP_BIN=… ORCA_AGENTS_TABLE=… HOME=<tmp> XDG_*=<tmp> ./node_modules/.bin/vitest run tests/control/agentSelectionE2E.test.ts -t D1 > <tmp>/t5.log 2>&1` → 绿。再用**本轮之前**的 ccloop build（控制器提供）跑一次 ⇒ 应红（`settled-unrecoverable` 或 `usageUnknown`）——这就是 M7 的端到端形态，记下结果。

- [ ] **Step 3: 提交**（Orca）

```bash
cd /Users/biran/code/skills/loop/Orca && git add tests/control/agentSelectionE2E.test.ts && git commit -F - <<'EOF'
test(control): continue a claude run cut at the handoff deadline, now that ccloop reports what claude streamed

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN
EOF
```

---

### Task 6: 变异、两仓全量门、台账（控制器自己做）

- [ ] ccloop：scratchpad `git clone --local`，软链 `node_modules`，`npm run build`；`cd` 进 clone；HOME 与四个 XDG 根改道；跑 spec §5.4 M1–M11（每条改一处、跑相关文件、记失败名单、`git checkout -- .` 还原、`git diff | wc -c` 为 0）。
- [ ] ccloop 全量：`vitest run --reporter=json --outputFile=<tmp>/full.json`；`node scripts/check-known-reds.mjs <tmp>/full.json` RC 0；`npm run typecheck`、`npm run build` RC 0。
- [ ] Orca：全新 clone，`npm run build --workspace web`，`ORCA_CCLOOP_BIN` ＝ 上面 clone 的 `dist/cli.js`，夹具表 fake codex `integration`；全量 RC 0、0 pending；真实 `~/.orca` 前后 `stat` 相同。
- [ ] `pgrep -fl "ccloop-agents-version|worker.js|fake-claude-cli"` 核孤儿进程（杀要人授权）。
- [ ] 台账 §3 起记：每个 Task 的提交主题行、点名改写的四条、变异表实测、全量结果；handoff 三份滚动。
