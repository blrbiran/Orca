# D1 水位 ＋ D2 检查点与开工 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`（推荐）或
> `superpowers:executing-plans` 逐任务实施本计划。步骤用 `- [ ]` 复选框跟踪。
> ⚠️ **勾选复选框是进度状态，不是改写论断，照勾。改某个 Task 的【内容】才需要另起一节写具名更正。**

**Goal:** 让 Claude Code 开发会话自己知道何时该交接（`orca level`），把交接写成代码测过的检查点（`orca checkpoint write`），并用一条命令完成开工核对（`orca resume`）。

**Architecture:** `src/level/` 是运行时无关的核心（读数形状、阈值、判定）加一个 Claude Code 读数适配器和一个钩子垫片；
`src/checkpoint/` 管检查点的 schema、覆盖判定、写入（代码跑实测、填水位、只提交这一个文件）与开工核对。
Claude Code 通过仓库级 `.claude/settings.json` 的 `PostToolUse` 钩子调用 `orca level --hook claude-code`，垫片只转发文字，不做判断（Rule 5）。

**Tech Stack:** Node v22.13.1 ／ TypeScript 5.5 ／ zod 3 ／ vitest 2 ／ tsx 4

**Spec:** `docs/superpowers/specs/2026-09-17-checkpoint-handoff-design.md` —— **本计划从它论证，执行者两份都要读，尤其 §9（本会话对齐的四项裁定）。**

**归属**：run `orca-dev-8df1943a`，2026-09-17，观测锚点为 spec 最后一笔修订提交（`git log -1 -- <spec>`）。

---

## Global Constraints（**每个 Task 的要求都隐含本节**）

1. **语言**：本文正文中文；*** **代码、代码注释、CLI help 文本、注入给 agent 的文字、commit message 一律英文。** ***
2. **范围**：只做 D1、D2。*** **不做无头拉起会话、不做 Tier 0 闸门、不改 ccloop。** *** v1 只实现 Claude Code 适配器。
3. **对既有生产代码的改动仅限**：`src/cli.ts` 的 USAGE 追加三段、`main` 追加三个分派、追加三个 `run*` 函数；`README.md` 追加一节。
   *** **其余既有 `src/**`、既有判据、既有注释一个字节都不动。** *** 超出这条 ⇒ 停下报人（spec §5「改既有生产代码之前的具名授权」）。
4. **Rule 17**：本计划**不写**任何用户全局数据。`<repo>/.orca/`（仓库内，被 git 跟踪）**不是** `~/.orca`（用户全局，verify:panel 要求不存在）——两者别混。
   实测输出落 `os.tmpdir()` 下的 `mkdtemp` 目录（临时文件，不是用户数据）。*** **判据一律用 `mkdtemp` 造的仓库与 transcript，绝不读写真实 `~/.claude/projects/**`**（唯一例外是 Task 2 取夹具快照、Task 7 活体验收，都是只读取样，且写明命令）。 ***
5. **读不到就说读不到**：任何「拿不到读数」的路径返回 `NoReading` 并**每次注入**，*** **绝不以 0 或默认 1M 代替**（spec §3.1、§4）。 ***
6. **先红**：每个 Task 先落一个**能编译的桩**再跑判据，红必须落在**具名断言**上，**不许红在模块加载**。
7. **变异纪律**（CLAUDE.md Rule 9／15）：每个 Task 末尾的「点名变异」表由**另一席**执行，只在 `git clone --local` 副本里做；副本 `ln -s` 主仓库的 `node_modules`；
   变异前后各取 `shasum -a 256`，**不相等才算落上去**，变异行读回；只跑该 Task 的测试文件，**必须看见红在表里写的那条 `it`**；销毁副本 `/bin/rm -rf "${CLONE:?}"`（本机 `rm`／`cp` 有 `-i` alias）。
   红不了的变异**如实登记「红不了」及原因**，不许删掉不报。
8. **绝不过滤验证性跑**：`命令 > 文件 2>&1; echo "RC=$?" >> 文件` 再**整份读回**；验证性跑走 `rtk proxy`，git 验证走 `/usr/bin/git`。
9. **每次编辑后做字节扫描**（除 `\t` `\n` 外的 < 0x20 字节必须为 0）；提交前看 `git diff --stat` 有没有 `Bin`。
10. **push／合并进 main／删分支或 worktree 每一次都要人单独点头。控制器不许 push。**
11. **子进程一律 `execFile`／`spawn` 传参数组**；唯一走 `/bin/sh -c` 的是检查点里的实测命令（它们本来就是 shell 命令，信任级别与 npm scripts 相同，spec §9 第 3 项）。

字节扫描命令（每次编辑后对碰过的文件跑）：

```bash
python3 - <file>... <<'PY'
import sys
for p in sys.argv[1:]:
    b = open(p, 'rb').read()
    bad = [i for i, c in enumerate(b) if c < 32 and c not in (9, 10)]
    print(p, "control_bytes", len(bad), bad[:5])
PY
```

---

## 现行基线（**开工前自己重测，不要信本文**）

```bash
cd /Users/biran/code/skills/loop/Orca
rtk proxy npm run verify > "$TMPDIR/verify-start.txt" 2>&1; echo "VERIFY_RC=$?" >> "$TMPDIR/verify-start.txt"
ls ~/.orca > "$TMPDIR/orca-start.txt" 2>&1; echo "LS_RC=$?" >> "$TMPDIR/orca-start.txt"
```

本计划写下时（2026-09-17，run `orca-dev-8df1943a` 现测）：`VERIFY_RC=0`；npm test **100 files / 608 tests**；verify:scheduler **51 / 167**；verify:panel **PASS 0–13**；web **8 / 26**；`ls ~/.orca` RC 1。

**全部落地后的预期**（由各 Task 的 `it` 条数算出 —— **是预言，Task 7 现测验收**）：
npm test **107 files / 661 tests**（+7 文件：`trigger` 9、`claudeCode` 10、`config` 5、`covering` 6、`hook` 8、`write` 8、`resume` 7 ＝ +53）；scheduler 51/167、verify:panel PASS 0–13、web 8/26 **不变**。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `src/level/types.ts` | 新建 | `Reading`／`NoReading`／`levelOf` |
| `src/level/trigger.ts` | 新建 | 纯函数：生效阈值、水位档、`decide` 出注入文字 |
| `src/level/config.ts` | 新建 | 读 `<repo>/.orca/level.json`（阈值、窗口表），缺省 330K／450K |
| `src/level/claudeCode.ts` | 新建 | 纯函数：Claude Code transcript 文本 → `Reading \| NoReading` |
| `src/level/readLevel.ts` | 新建 | 配置 ＋ 读 transcript ＋ 适配器，出读数与阈值（钩子与写检查点共用） |
| `src/level/invocation.ts` | 新建 | 拼出可粘贴执行的 orca 命令行（绝对路径、单引号转义） |
| `src/level/hook.ts` | 新建 | Claude Code 钩子垫片：stdin → 读数 → 判定 → `hookSpecificOutput` JSON |
| `src/checkpoint/schema.ts` | 新建 | 草稿与检查点的 zod schema、`runIdFor`、`describeLevel`、`CheckpointRejection` |
| `src/checkpoint/covering.ts` | 新建 | 找本会话覆盖到最高档的检查点，坏文件点名 |
| `src/checkpoint/measure.ts` | 新建 | 跑一条实测命令，输出落文件，返回退出码 |
| `src/checkpoint/write.ts` | 新建 | `writeCheckpoint`：拒脏树 → 填水位 → 跑实测 → 写 → 只提交该文件 |
| `src/checkpoint/resume.ts` | 新建 | `resume`：定位检查点 → 打印 → 之后的提交 → 过期 → 重跑 → 发布状态 → 待人 |
| `src/cli.ts` | 追加 | `level`、`checkpoint write`、`resume` 三个子命令 |
| `scripts/sanitize-claude-transcript.mjs` | 新建 | 从真实 transcript 生成脱敏夹具（只留结构键与 usage 数字） |
| `tests/fixtures/level/claude-code-session.jsonl` | 新建 | 脱敏夹具 |
| `tests/helpers/{transcript,checkpoint,tempRepo,runCli,session}.ts` | 新建 | 判据共用的造数工具（不含 `.test.`，不被 vitest 收集） |
| `tests/level/{trigger,claudeCode,config,hook}.test.ts` | 新建 | 见各 Task |
| `tests/checkpoint/{covering,write,resume}.test.ts` | 新建 | 见各 Task |
| `.claude/settings.json` | 新建 | 仓库级 `PostToolUse` 钩子（Task 7） |
| `README.md` | 追加 | 一节 `Checkpoint handoff` |

---

### Task 1: 水位核心 —— 读数形状与触发判定（spec §3.1、§4）

**Files:**
- Create: `src/level/types.ts`、`src/level/trigger.ts`
- Test: `tests/level/trigger.test.ts`

**Interfaces:**
- Produces:
  - `type Runtime = "claude-code"`
  - `interface Reading { kind: "reading"; runtime; sessionRef: string; promptTokens: number; outputTokens: number; windowTokens: number; compactionReserveTokens?: number; observedAt: string }`
  - `interface NoReading { kind: "no-reading"; runtime; sessionRef: string; reason: string }`
  - `levelOf(r: Reading): number`
  - `interface Thresholds { t1: number; t2: number }`、`type Band = 0 | 1 | 2`、`interface Covering { path: string; band: 1 | 2 }`
  - `type Decision = { kind: "silent" } | { kind: "write" | "inform" | "breach" | "no-reading"; text: string }`
  - `effectiveThresholds(r: Reading, configured: Thresholds): Thresholds`、`bandOf(level: number, effective: Thresholds): Band`
  - `decide(input: Reading | NoReading, configured: Thresholds, covering: Covering | null, writeCommand: string): Decision`

- [ ] **Step 1: 落桩**

```ts
// src/level/types.ts
export type Runtime = "claude-code";

/** D spec §3.1. One reading of how much of the context window the next call will carry. */
export interface Reading {
  kind: "reading";
  runtime: Runtime;
  sessionRef: string;
  promptTokens: number;
  outputTokens: number;
  windowTokens: number;
  compactionReserveTokens?: number;
  observedAt: string;
}

/** Never replaced by a zero: a missing reading is reported every time (D spec §4). */
export interface NoReading {
  kind: "no-reading";
  runtime: Runtime;
  sessionRef: string;
  reason: string;
}

export function levelOf(reading: Reading): number {
  return 0;
}
```

```ts
// src/level/trigger.ts
import type { NoReading, Reading } from "./types.js";

export interface Thresholds {
  t1: number;
  t2: number;
}
export type Band = 0 | 1 | 2;
export interface Covering {
  path: string;
  band: 1 | 2;
}
export type Decision = { kind: "silent" } | { kind: "write" | "inform" | "breach" | "no-reading"; text: string };

export function effectiveThresholds(reading: Reading, configured: Thresholds): Thresholds {
  return configured;
}

export function bandOf(level: number, effective: Thresholds): Band {
  return 0;
}

export function decide(
  input: Reading | NoReading,
  configured: Thresholds,
  covering: Covering | null,
  writeCommand: string,
): Decision {
  return { kind: "silent" };
}
```

- [ ] **Step 2: 写判据**

```ts
// tests/level/trigger.test.ts
import { describe, expect, it } from "vitest";
import { decide } from "../../src/level/trigger.js";
import type { NoReading, Reading } from "../../src/level/types.js";

const CONFIGURED = { t1: 330_000, t2: 450_000 };
const WRITE = "WRITE-COMMAND";

function reading(prompt: number, output: number, windowTokens = 1_000_000, reserve?: number): Reading {
  return {
    kind: "reading",
    runtime: "claude-code",
    sessionRef: "s",
    promptTokens: prompt,
    outputTokens: output,
    windowTokens,
    ...(reserve === undefined ? {} : { compactionReserveTokens: reserve }),
    observedAt: "2026-09-17T00:00:00.000Z",
  };
}

describe("decide (D spec section 4)", () => {
  it("stays silent one token below T1", () => {
    expect(decide(reading(329_999, 0), CONFIGURED, null, WRITE)).toEqual({ kind: "silent" });
  });

  it("counts the last call's output: a prompt one below T1 plus one output token reaches T1 (spec 3.1)", () => {
    expect(decide(reading(329_999, 1), CONFIGURED, null, WRITE).kind).toBe("write");
  });

  it("asks for a checkpoint with the reading, both thresholds and the command to run", () => {
    expect(decide(reading(340_000, 5), CONFIGURED, null, WRITE)).toEqual({
      kind: "write",
      text: "orca level: 340005 of 1000000 tokens (T1 330000, T2 450000). Write a checkpoint now. WRITE-COMMAND",
    });
  });

  it("does not ask again once this band has a checkpoint (spec 9, item 10)", () => {
    expect(decide(reading(340_000, 5), CONFIGURED, { path: "/r/x.json", band: 1 }, WRITE)).toEqual({
      kind: "inform",
      text: "orca level: 340005 of 1000000 tokens (T1 330000, T2 450000). A checkpoint for this band is at /r/x.json.",
    });
  });

  it("past T2 a band-1 checkpoint does not cover: breach, still asking for a checkpoint", () => {
    const d = decide(reading(450_000, 0), CONFIGURED, { path: "/p", band: 1 }, WRITE);
    expect(d.kind).toBe("breach");
    expect(d.kind !== "silent" && d.text.endsWith(WRITE)).toBe(true);
  });

  it("past T2 with a band-2 checkpoint: breach pointing at it, without asking to write again", () => {
    expect(decide(reading(460_000, 0), CONFIGURED, { path: "/p2", band: 2 }, WRITE)).toEqual({
      kind: "breach",
      text:
        "orca level: 460000 of 1000000 tokens (T1 330000, T2 450000) is past T2, the session limit. " +
        "A checkpoint for this band is at /p2: hand off now.",
    });
  });

  it("a window smaller than both thresholds pulls them down to it (Codex measured 258,400)", () => {
    expect(decide(reading(258_399, 0, 258_400), CONFIGURED, null, WRITE)).toEqual({ kind: "silent" });
    const d = decide(reading(258_400, 0, 258_400), CONFIGURED, null, WRITE);
    expect(d.kind).toBe("breach");
    expect(d.kind !== "silent" && d.text.startsWith("orca level: 258400 of 258400 tokens (T1 258400, T2 258400)")).toBe(true);
  });

  it("subtracts the runtime's compaction reserve from the window", () => {
    expect(decide(reading(300_000, 0, 400_000, 100_000), CONFIGURED, null, WRITE).kind).toBe("breach");
  });

  it("a missing reading is reported every time, even with a covering checkpoint", () => {
    const none: NoReading = { kind: "no-reading", runtime: "claude-code", sessionRef: "s", reason: "no model attachment in transcript" };
    expect(decide(none, CONFIGURED, { path: "/p", band: 2 }, WRITE)).toEqual({
      kind: "no-reading",
      text: "orca level: no reading — no model attachment in transcript",
    });
  });
});
```

- [ ] **Step 3: 跑判据，确认红在具名断言上**

Run: `rtk proxy npx vitest run tests/level/trigger.test.ts > "$TMPDIR/t1-red.txt" 2>&1; echo "RC=$?" >> "$TMPDIR/t1-red.txt"`，整份读回。
Expected: RC≠0；「stays silent one token below T1」**绿**（桩恒 silent，它的牙齿来自变异 M1-2），其余 8 条红在 `expect` 上，**没有**模块加载错误。

- [ ] **Step 4: 实现**

```ts
// src/level/types.ts —— 只替换 levelOf
/** D spec 3.1: prompt plus output of the last call — a conservative estimate, never a lower bound. */
export function levelOf(reading: Reading): number {
  return reading.promptTokens + reading.outputTokens;
}
```

```ts
// src/level/trigger.ts —— 替换三个函数体
import { levelOf } from "./types.js";

export function effectiveThresholds(reading: Reading, configured: Thresholds): Thresholds {
  const usable = reading.windowTokens - (reading.compactionReserveTokens ?? 0);
  return { t1: Math.min(configured.t1, usable), t2: Math.min(configured.t2, usable) };
}

// When the window pulls T1 and T2 together, a level at T1 is also at T2 and lands in band 2 (spec 4).
export function bandOf(level: number, effective: Thresholds): Band {
  if (level >= effective.t2) return 2;
  if (level >= effective.t1) return 1;
  return 0;
}

export function decide(
  input: Reading | NoReading,
  configured: Thresholds,
  covering: Covering | null,
  writeCommand: string,
): Decision {
  if (input.kind === "no-reading") {
    return { kind: "no-reading", text: `orca level: no reading — ${input.reason}` };
  }
  const effective = effectiveThresholds(input, configured);
  const level = levelOf(input);
  const band = bandOf(level, effective);
  if (band === 0) return { kind: "silent" };

  const head = `orca level: ${level} of ${input.windowTokens} tokens (T1 ${effective.t1}, T2 ${effective.t2})`;
  if (band === 2) {
    if (covering !== null && covering.band >= band) {
      return { kind: "breach", text: `${head} is past T2, the session limit. A checkpoint for this band is at ${covering.path}: hand off now.` };
    }
    return {
      kind: "breach",
      text: `${head} is past T2, the session limit. Write a checkpoint and hand off now; this overrun is recorded in the checkpoint. ${writeCommand}`,
    };
  }
  if (covering !== null && covering.band >= band) {
    return { kind: "inform", text: `${head}. A checkpoint for this band is at ${covering.path}.` };
  }
  return { kind: "write", text: `${head}. Write a checkpoint now. ${writeCommand}` };
}
```

- [ ] **Step 5: 跑绿**：同 Step 3 命令写到 `t1-green.txt`，整份读回。Expected: `9 passed`，RC=0。然后 `rtk proxy npm run typecheck` 重定向读回，RC=0。

- [ ] **Step 6: 字节扫描 ＋ 提交**

```bash
git add src/level/types.ts src/level/trigger.ts tests/level/trigger.test.ts
git commit -m "feat(level): decide what to tell an agent from a context-window reading"
```

**点名变异（另一席在 clone 副本执行）：**

| # | 变异 | 必须红的 `it` |
|---|---|---|
| M1-1 | `levelOf` 去掉 `+ reading.outputTokens` | counts the last call's output… |
| M1-2 | `bandOf` 第二行 `>=` 改 `>` | counts the last call's output… |
| M1-3 | `effectiveThresholds` 直接 `return configured` | a window smaller than both thresholds… |
| M1-4 | 删掉 `- (reading.compactionReserveTokens ?? 0)` | subtracts the runtime's compaction reserve… |
| M1-5 | 两处 `covering.band >= band` 改 `>` | does not ask again once this band has a checkpoint |
| M1-6 | 两处覆盖条件改为 `covering !== null` | past T2 a band-1 checkpoint does not cover… |
| M1-7 | `no-reading` 分支改 `return { kind: "silent" }` | a missing reading is reported every time… |

---

### Task 2: Claude Code 读数适配器 ＋ 仓库配置（spec §2.1、§3.1、§9 第 9 项）

**Files:**
- Create: `src/level/claudeCode.ts`、`src/level/config.ts`、`scripts/sanitize-claude-transcript.mjs`、`tests/helpers/transcript.ts`、`tests/fixtures/level/claude-code-session.jsonl`
- Test: `tests/level/claudeCode.test.ts`、`tests/level/config.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `Reading`、`NoReading`、`Thresholds`
- Produces:
  - `readClaudeCodeTranscript(text: string, sessionRef: string, windows: Record<string, number>): Reading | NoReading`
  - `interface LevelConfig { t1: number; t2: number; windows: Record<string, number> }`
  - `DEFAULT_THRESHOLDS: Thresholds`（330,000／450,000）、`LEVEL_CONFIG_PATH = ".orca/level.json"`
  - `loadLevelConfig(repo: string): Promise<LevelConfig>`（缺文件 ⇒ 缺省；坏 ⇒ 抛 `LevelConfigRejection`）
  - 测试工具 `tests/helpers/transcript.ts`：`SESSION`、`modelRow(modelId, sessionId?)`、`usageRow(u, opts?)`、`jsonl(rows)`

**「不是读数」的类别与各自的样本**（spec §3.1 清单中适用于 Claude Code 的部分，§9 现测）：
侧链（`isSidechain: true`）、`model = "<synthetic>"`（usage 全 0，现测 105 条）、同 msg id 多行（现测 2435 次重复 usage 全一致 ⇒ 取最后一行即可，**不单设分支**）、
追加中的残行、混入别的会话、缺 usage 计数、没有模型 attachment、窗口未知。
⚠️ **压缩边界无样本**（本机 `compact_boundary` 零命中，spec §9）⇒ 不设分支；滞后读数只会偏高，方向安全。

- [ ] **Step 1: 落桩与测试工具**

```ts
// src/level/claudeCode.ts
import type { NoReading, Reading } from "./types.js";

export function readClaudeCodeTranscript(text: string, sessionRef: string, windows: Record<string, number>): Reading | NoReading {
  return { kind: "no-reading", runtime: "claude-code", sessionRef, reason: "not implemented" };
}
```

```ts
// src/level/config.ts
import type { Thresholds } from "./trigger.js";

export const LEVEL_CONFIG_PATH = ".orca/level.json";
export const DEFAULT_THRESHOLDS: Thresholds = { t1: 330_000, t2: 450_000 };
export interface LevelConfig {
  t1: number;
  t2: number;
  windows: Record<string, number>;
}
export class LevelConfigRejection extends Error {}

export async function loadLevelConfig(repo: string): Promise<LevelConfig> {
  return { ...DEFAULT_THRESHOLDS, windows: { stub: 1 } };
}
```

```ts
// tests/helpers/transcript.ts
export const SESSION = "0a1b2c3d-0000-4000-8000-000000000000";

export interface Usage {
  input: number;
  cacheRead: number;
  cacheCreation: number;
  output: number;
}

export function modelRow(modelId: string, sessionId = SESSION): Record<string, unknown> {
  return { type: "attachment", sessionId, attachment: { type: "model", identity: { modelId } } };
}

export function usageRow(
  u: Usage,
  opts: { sessionId?: string; sidechain?: boolean; model?: string; at?: string } = {},
): { type: string; sessionId: string; isSidechain: boolean; timestamp: string; message: { model: string; usage: Record<string, number> } } {
  return {
    type: "assistant",
    sessionId: opts.sessionId ?? SESSION,
    isSidechain: opts.sidechain ?? false,
    timestamp: opts.at ?? "2026-09-17T00:00:00.000Z",
    message: {
      model: opts.model ?? "claude-opus-5",
      usage: {
        input_tokens: u.input,
        cache_read_input_tokens: u.cacheRead,
        cache_creation_input_tokens: u.cacheCreation,
        output_tokens: u.output,
      },
    },
  };
}

export const jsonl = (rows: object[]): string => `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`;
```

`scripts/sanitize-claude-transcript.mjs`（shebang 必须是第一行）：

```js
#!/usr/bin/env node
// D spec 7 item 7: a fixture keeps only what the Claude Code reading adapter looks at —
// structure keys and usage counts. No message content, no tool input, no paths.
import { readFileSync, writeFileSync } from "node:fs";

const [input, output, session] = process.argv.slice(2);
if (!input || !output || !session) {
  console.error("usage: sanitize-claude-transcript.mjs <transcript> <fixture> <replacement-session-id>");
  process.exit(1);
}
const kept = [];
for (const line of readFileSync(input, "utf8").split("\n")) {
  if (line.trim() === "") continue;
  const row = JSON.parse(line);
  if (row.type === "attachment" && row.attachment?.type === "model") {
    kept.push({ type: row.type, sessionId: session, attachment: { type: "model", identity: { modelId: row.attachment.identity?.modelId } } });
  } else if (row.type === "assistant" && row.message?.usage) {
    const u = row.message.usage;
    kept.push({
      type: row.type,
      sessionId: session,
      isSidechain: row.isSidechain,
      timestamp: row.timestamp,
      message: {
        id: row.message.id,
        model: row.message.model,
        usage: {
          input_tokens: u.input_tokens,
          cache_read_input_tokens: u.cache_read_input_tokens,
          cache_creation_input_tokens: u.cache_creation_input_tokens,
          output_tokens: u.output_tokens,
        },
      },
    });
  }
}
writeFileSync(output, `${kept.map((r) => JSON.stringify(r)).join("\n")}\n`);
console.log(`kept ${kept.length} rows`);
```

- [ ] **Step 2: 生成真实夹具与独立探针读数（只读取样）**

```bash
cd /Users/biran/code/skills/loop/Orca
S="$TMPDIR/d1-fixture"; mkdir -p "$S"
T=$(ls -t ~/.claude/projects/-Users-biran-code-skills-loop-Orca/*.jsonl | head -1)   # 执行本 Task 的会话自己的 transcript
python3 - "$T" "$S/snap.jsonl" <<'PY'
import sys
d = open(sys.argv[1], 'rb').read()
open(sys.argv[2], 'wb').write(d[:d.rfind(b'\n') + 1])   # complete lines only: the runtime is still appending
PY
mkdir -p tests/fixtures/level
node scripts/sanitize-claude-transcript.mjs "$S/snap.jsonl" tests/fixtures/level/claude-code-session.jsonl 0a1b2c3d-f1f1-4f1f-8f1f-f1f1f1f1f1f1 > "$S/sanitize.txt" 2>&1; echo "RC=$?" >> "$S/sanitize.txt"
python3 - "$S/snap.jsonl" > "$S/probe.txt" 2>&1 <<'PY'
import json, sys
last = None
for line in open(sys.argv[1]):
    o = json.loads(line)
    m = o.get('message') or {}
    if o.get('type') != 'assistant' or o.get('isSidechain') or not m.get('usage') or m.get('model') == '<synthetic>':
        continue
    u = m['usage']
    last = (u['input_tokens'] + u['cache_read_input_tokens'] + u['cache_creation_input_tokens'], u['output_tokens'], o['timestamp'])
print(last)
PY
echo "RC=$?" >> "$S/probe.txt"
```

整份读回 `sanitize.txt`、`probe.txt`（两个 RC=0）。再核夹具**没有内容字段**：
`python3 -c "import json;print(sorted({k for l in open('tests/fixtures/level/claude-code-session.jsonl') for k in json.loads(l)}))"` 输出只能是
`['attachment', 'isSidechain', 'message', 'sessionId', 'timestamp', 'type']` 的子集。夹具行数 > 0 且含至少一条 `attachment` 行，否则停下报人。

- [ ] **Step 3: 写判据**

`PROBE` 三个值**原样抄 `probe.txt` 打印的元组**（这是测量值，不是占位；抄完在本 Task 的提交说明里写出来）。

```ts
// tests/level/claudeCode.test.ts
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readClaudeCodeTranscript } from "../../src/level/claudeCode.js";
import { SESSION, jsonl, modelRow, usageRow } from "../helpers/transcript.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "level");
const FIXTURE_SESSION = "0a1b2c3d-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
// Printed by the independent python probe in Task 2 Step 2, run on the same snapshot the fixture was made from.
const PROBE = { prompt: 0, output: 0, at: "" };

const U = (input: number, cacheRead: number, cacheCreation: number, output: number) => ({ input, cacheRead, cacheCreation, output });
const none = (reason: string) => ({ kind: "no-reading", runtime: "claude-code", sessionRef: SESSION, reason });

describe("readClaudeCodeTranscript (D spec 2.1, 3.1, 9)", () => {
  it("reads the sanitized real transcript to the numbers an independent probe printed", async () => {
    const text = await readFile(join(fixtures, "claude-code-session.jsonl"), "utf8");
    expect(readClaudeCodeTranscript(text, FIXTURE_SESSION, {})).toEqual({
      kind: "reading",
      runtime: "claude-code",
      sessionRef: FIXTURE_SESSION,
      promptTokens: PROBE.prompt,
      outputTokens: PROBE.output,
      windowTokens: 1_000_000,
      observedAt: PROBE.at,
    });
  });

  it("takes the last main-chain call and sums input, cache read and cache creation", () => {
    const text = jsonl([
      modelRow("claude-opus-5[1m]"),
      usageRow(U(1, 2, 3, 4), { at: "2026-09-17T01:00:00.000Z" }),
      usageRow(U(10, 200, 30, 7), { at: "2026-09-17T02:00:00.000Z" }),
    ]);
    expect(readClaudeCodeTranscript(text, SESSION, {})).toEqual({
      kind: "reading",
      runtime: "claude-code",
      sessionRef: SESSION,
      promptTokens: 240,
      outputTokens: 7,
      windowTokens: 1_000_000,
      observedAt: "2026-09-17T02:00:00.000Z",
    });
  });

  it("ignores a sidechain call made after the main chain's last one", () => {
    const text = jsonl([modelRow("claude-opus-5[1m]"), usageRow(U(5, 5, 5, 5)), usageRow(U(900_000, 0, 0, 0), { sidechain: true })]);
    expect(readClaudeCodeTranscript(text, SESSION, {})).toMatchObject({ kind: "reading", promptTokens: 15 });
  });

  it("ignores a <synthetic> row, whose usage is all zero (measured: 105 of them)", () => {
    const text = jsonl([modelRow("claude-opus-5[1m]"), usageRow(U(100, 0, 0, 1)), usageRow(U(0, 0, 0, 0), { model: "<synthetic>" })]);
    expect(readClaudeCodeTranscript(text, SESSION, {})).toMatchObject({ kind: "reading", promptTokens: 100 });
  });

  it("a usage row missing a count is no reading, not zero", () => {
    const row = usageRow(U(1, 1, 1, 1));
    delete row.message.usage.cache_read_input_tokens;
    expect(readClaudeCodeTranscript(jsonl([modelRow("claude-opus-5[1m]"), row]), SESSION, {})).toEqual(
      none("usage on line 2 lacks a count for cache_read_input_tokens"),
    );
  });

  it("skips a torn final line still being appended, but a malformed line in the middle is no reading", () => {
    const good = jsonl([modelRow("claude-opus-5[1m]"), usageRow(U(1, 0, 0, 0))]);
    expect(readClaudeCodeTranscript(`${good}{"type":"assist`, SESSION, {}).kind).toBe("reading");
    expect(readClaudeCodeTranscript(`${good}{"type":"assist\n${jsonl([usageRow(U(2, 0, 0, 0))])}`, SESSION, {})).toEqual(
      none("transcript line 3 is not JSON"),
    );
  });

  it("the last model attachment decides the window, and [1m] means one million", () => {
    const switched = jsonl([modelRow("claude-opus-5[1m]"), usageRow(U(1, 0, 0, 0)), modelRow("claude-opus-5"), usageRow(U(2, 0, 0, 0))]);
    expect(readClaudeCodeTranscript(switched, SESSION, { "claude-opus-5": 200_000 })).toMatchObject({ windowTokens: 200_000 });
    const back = jsonl([modelRow("claude-opus-5"), modelRow("claude-opus-5[1m]"), usageRow(U(1, 0, 0, 0))]);
    expect(readClaudeCodeTranscript(back, SESSION, {})).toMatchObject({ windowTokens: 1_000_000 });
  });

  it("a model with no known window is no reading, never an assumed million (spec 3.1)", () => {
    const text = jsonl([modelRow("claude-opus-5"), usageRow(U(1, 0, 0, 0))]);
    expect(readClaudeCodeTranscript(text, SESSION, {})).toEqual(
      none("no window size known for model claude-opus-5; add it to .orca/level.json windows"),
    );
  });

  it("a row from another session is no reading", () => {
    const other = "ffffffff-0000-4000-8000-000000000000";
    const text = jsonl([modelRow("claude-opus-5[1m]"), usageRow(U(1, 0, 0, 0), { sessionId: other })]);
    expect(readClaudeCodeTranscript(text, SESSION, {})).toEqual(none(`transcript line 2 belongs to session ${other}, not ${SESSION}`));
  });

  it("before any call, or without a model attachment, there is no reading", () => {
    expect(readClaudeCodeTranscript(jsonl([modelRow("claude-opus-5[1m]")]), SESSION, {})).toEqual(none("no main-chain call with usage yet"));
    expect(readClaudeCodeTranscript(jsonl([usageRow(U(1, 0, 0, 0))]), SESSION, {})).toEqual(none("no model attachment in transcript"));
  });
});
```

```ts
// tests/level/config.test.ts
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LevelConfigRejection, loadLevelConfig } from "../../src/level/config.js";

async function repoWith(content?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "orca-level-config-"));
  if (content !== undefined) {
    await mkdir(join(dir, ".orca"));
    await writeFile(join(dir, ".orca", "level.json"), content);
  }
  return dir;
}

describe("loadLevelConfig (D spec 4: thresholds live in repository config)", () => {
  it("defaults to Rule 6's 330,000 and 450,000 when the repository has no config", async () => {
    expect(await loadLevelConfig(await repoWith())).toEqual({ t1: 330_000, t2: 450_000, windows: {} });
  });

  it("reads thresholds and the window table from .orca/level.json", async () => {
    const repo = await repoWith(JSON.stringify({ t1: 1000, t2: 2000, windows: { "claude-opus-5": 200_000 } }));
    expect(await loadLevelConfig(repo)).toEqual({ t1: 1000, t2: 2000, windows: { "claude-opus-5": 200_000 } });
  });

  it("refuses a config that is not JSON, naming the file", async () => {
    await expect(loadLevelConfig(await repoWith("{"))).rejects.toThrow(".orca/level.json is not JSON");
  });

  it("refuses an unknown key instead of ignoring it", async () => {
    await expect(loadLevelConfig(await repoWith(JSON.stringify({ t3: 1 })))).rejects.toThrow(LevelConfigRejection);
  });

  it("refuses t1 at or above t2", async () => {
    await expect(loadLevelConfig(await repoWith(JSON.stringify({ t1: 450_000 })))).rejects.toThrow(
      "t1 (450000) must be below t2 (450000)",
    );
  });
});
```

- [ ] **Step 4: 跑判据，确认红在具名断言上**

Run: `rtk proxy npx vitest run tests/level/claudeCode.test.ts tests/level/config.test.ts > "$TMPDIR/t2-red.txt" 2>&1; echo "RC=$?" >> "$TMPDIR/t2-red.txt"`，整份读回。
Expected: 15 条全红在 `expect` 上（桩的 `windows: { stub: 1 }` 让「defaults」与「reads」都红；三条 reject 因桩不抛而红）。**若有一条桩下就绿，逐条点名它的牙齿来自哪条变异再继续。**

- [ ] **Step 5: 实现**

```ts
// src/level/claudeCode.ts
import type { NoReading, Reading } from "./types.js";

const USAGE_FIELDS = ["input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "output_tokens"] as const;
const ONE_MILLION_SUFFIX = "[1m]";

/**
 * D spec 2.1 and 9. The prompt size of the last main-chain call, from the transcript Claude Code writes.
 * The window comes from the last model attachment: `message.model` does not tell the 1M variant apart
 * (measured), `attachment.identity.modelId` does. Every row that is not a reading is skipped by name
 * below; anything the adapter cannot account for is a NoReading, never a zero.
 */
export function readClaudeCodeTranscript(
  text: string,
  sessionRef: string,
  windows: Record<string, number>,
): Reading | NoReading {
  const none = (reason: string): NoReading => ({ kind: "no-reading", runtime: "claude-code", sessionRef, reason });
  const lines = text.split("\n");
  let modelId: string | undefined;
  let last: { prompt: number; output: number; at: string } | undefined;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "") continue;
    // JSON of unknown shape; every field used below is checked before it is trusted.
    let row: any;
    try {
      row = JSON.parse(line);
    } catch {
      // The runtime appends while we read: only a final segment with no newline after it may be torn.
      if (i === lines.length - 1) continue;
      return none(`transcript line ${i + 1} is not JSON`);
    }
    if (typeof row !== "object" || row === null) return none(`transcript line ${i + 1} is not an object`);
    if (typeof row.sessionId === "string" && row.sessionId !== sessionRef) {
      return none(`transcript line ${i + 1} belongs to session ${row.sessionId}, not ${sessionRef}`);
    }
    if (row.type === "attachment" && row.attachment?.type === "model") {
      const id = row.attachment.identity?.modelId;
      if (typeof id !== "string" || id === "") return none(`model attachment on line ${i + 1} has no identity.modelId`);
      modelId = id;
      continue;
    }
    if (row.type !== "assistant" || row.isSidechain === true) continue;
    const usage = row.message?.usage;
    if (usage === undefined || usage === null) continue;
    // Measured: rows the runtime synthesizes carry an all-zero usage and are not a model call.
    if (row.message.model === "<synthetic>") continue;
    for (const field of USAGE_FIELDS) {
      const value = usage[field];
      if (!Number.isInteger(value) || value < 0) return none(`usage on line ${i + 1} lacks a count for ${field}`);
    }
    if (typeof row.timestamp !== "string") return none(`usage on line ${i + 1} has no timestamp`);
    last = {
      prompt: usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens,
      output: usage.output_tokens,
      at: row.timestamp,
    };
  }

  if (last === undefined) return none("no main-chain call with usage yet");
  if (modelId === undefined) return none("no model attachment in transcript");
  const windowTokens = modelId.endsWith(ONE_MILLION_SUFFIX) ? 1_000_000 : windows[modelId];
  if (windowTokens === undefined) {
    return none(`no window size known for model ${modelId}; add it to .orca/level.json windows`);
  }
  return {
    kind: "reading",
    runtime: "claude-code",
    sessionRef,
    promptTokens: last.prompt,
    outputTokens: last.output,
    windowTokens,
    observedAt: last.at,
  };
}
```

```ts
// src/level/config.ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { Thresholds } from "./trigger.js";

export const LEVEL_CONFIG_PATH = ".orca/level.json";
// CLAUDE.md Rule 6, in context-window occupancy. Changing the cadence is a committed config change, not a judgment call (D spec 4).
export const DEFAULT_THRESHOLDS: Thresholds = { t1: 330_000, t2: 450_000 };

export interface LevelConfig {
  t1: number;
  t2: number;
  windows: Record<string, number>;
}

export class LevelConfigRejection extends Error {}

const ConfigSchema = z
  .object({
    t1: z.number().int().positive().optional(),
    t2: z.number().int().positive().optional(),
    windows: z.record(z.string().min(1), z.number().int().positive()).optional(),
  })
  .strict();

export async function loadLevelConfig(repo: string): Promise<LevelConfig> {
  let text: string;
  try {
    text = await readFile(join(repo, LEVEL_CONFIG_PATH), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ...DEFAULT_THRESHOLDS, windows: {} };
    throw new LevelConfigRejection(`${LEVEL_CONFIG_PATH} cannot be read: ${(err as Error).message}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new LevelConfigRejection(`${LEVEL_CONFIG_PATH} is not JSON`);
  }
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new LevelConfigRejection(`${LEVEL_CONFIG_PATH}: ${issues}`);
  }
  const t1 = parsed.data.t1 ?? DEFAULT_THRESHOLDS.t1;
  const t2 = parsed.data.t2 ?? DEFAULT_THRESHOLDS.t2;
  if (t1 >= t2) throw new LevelConfigRejection(`${LEVEL_CONFIG_PATH}: t1 (${t1}) must be below t2 (${t2})`);
  return { t1, t2, windows: parsed.data.windows ?? {} };
}
```

- [ ] **Step 6: 跑绿**：同 Step 4 命令写到 `t2-green.txt`，整份读回。Expected: `15 passed`，RC=0；`rtk proxy npm run typecheck` 重定向读回 RC=0。

- [ ] **Step 7: 字节扫描 ＋ 提交**（提交说明写出 `PROBE` 三个值与夹具行数）

```bash
git add src/level/claudeCode.ts src/level/config.ts scripts/sanitize-claude-transcript.mjs tests/helpers/transcript.ts \
  tests/fixtures/level/claude-code-session.jsonl tests/level/claudeCode.test.ts tests/level/config.test.ts
git commit -m "feat(level): read a Claude Code session's context window from its transcript"
```

**点名变异：**

| # | 变异 | 必须红的 `it` |
|---|---|---|
| M2-1 | `prompt` 去掉 `+ usage.cache_creation_input_tokens` | takes the last main-chain call… |
| M2-2 | 删掉 `\|\| row.isSidechain === true` | ignores a sidechain call… |
| M2-3 | 删掉 `<synthetic>` 那行 `continue` | ignores a <synthetic> row… |
| M2-4 | 计数校验整段删掉（缺值即 `undefined` 参与相加） | a usage row missing a count is no reading… |
| M2-5 | 残行分支改成恒 `continue` | skips a torn final line… |
| M2-6 | `modelId = id` 改成 `modelId ??= id`（取第一条） | the last model attachment decides the window… |
| M2-7 | `windows[modelId]` 改 `windows[modelId] ?? 1_000_000` | a model with no known window is no reading… |
| M2-8 | 删掉会话不符那条 `return` | a row from another session is no reading |
| M2-9 | 删掉 `if (t1 >= t2)` 那行 | refuses t1 at or above t2 |
| M2-10 | `.strict()` 删掉 | refuses an unknown key… |

---
### Task 3: 检查点 schema ＋ 覆盖判定（spec §9 第 1、10 项）

**Files:**
- Create: `src/checkpoint/schema.ts`、`src/checkpoint/covering.ts`、`tests/helpers/checkpoint.ts`
- Test: `tests/checkpoint/covering.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `Covering`
- Produces:
  - `CHECKPOINT_DIR = ".orca/checkpoints"`、`AWAITING_KINDS`
  - `DraftSchema`／`type Draft = { next: string[]; open: string[]; awaitingHuman: {kind, what}[]; measure: string[] }`
  - `CheckpointSchema`／`type Checkpoint`（字段见下方代码，`strict`）
  - `type LevelRecord = Checkpoint["level"]`、`describeLevel(level: LevelRecord): string`
  - `runIdFor(sessionRef: string): string | null`
  - `class CheckpointRejection extends Error { code: string; exitCode: number }`
  - `findCovering(repo: string, sessionRef: string): Promise<{ covering: Covering | null; problems: string[] }>`
  - 测试工具 `tests/helpers/checkpoint.ts`：`checkpointFixture(overrides?)`、`putCheckpoint(repo, name, value)`

**本 Task 自定的两处（可逆，Rule 1 第 2 档）**：
- **v1 的待人队列 ＝ 检查点的 `awaitingHuman` 字段**（spec §7 第 2 项），四个 `kind` 对应 spec §5 的四类，由 `resume` 列出，不接面板。反方：面板已有「未审高位决策」待办；回应：接面板要改既有生产代码（Global Constraint 3），v1 先让链条自己能读到。
- **`runId` ＝ `orca-dev-` ＋ 会话 id 前 8 位十六进制**，与 `.decisions/orca-dev-*.jsonl` 现行命名同口径。

- [ ] **Step 1: 落桩与测试工具**

```ts
// src/checkpoint/schema.ts —— 桩：schema 完整（它是数据定义，不是逻辑），两个函数返回错值
import { z } from "zod";

export const CHECKPOINT_DIR = ".orca/checkpoints";
export const AWAITING_KINDS = ["irreversible", "tied-evidence", "named-authorization", "ccloop-change"] as const;

const Sha = z.string().regex(/^[0-9a-f]{40}$/);
const Text = z.string().min(1);
const Awaiting = z.object({ kind: z.enum(AWAITING_KINDS), what: Text }).strict();

/** What the agent writes: only the judgment (D spec 5 step 2). Everything measurable is filled in by code. */
export const DraftSchema = z
  .object({
    next: z.array(Text).min(1),
    open: z.array(Text).default([]),
    awaitingHuman: z.array(Awaiting).default([]),
    measure: z.array(Text).default([]),
  })
  .strict();
export type Draft = z.infer<typeof DraftSchema>;

const LevelRecordSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("reading"),
      level: z.number().int().nonnegative(),
      windowTokens: z.number().int().positive(),
      t1: z.number().int().positive(),
      t2: z.number().int().positive(),
      band: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    })
    .strict(),
  z.object({ kind: z.literal("no-reading"), reason: Text }).strict(),
]);

// Main spec 2.2: an observation is {command, value, commit}, so "commit is behind" is machine-decidable.
const MeasurementSchema = z
  .object({ command: Text, exitCode: z.number().int(), commit: Sha, observedAt: z.string().datetime(), outputPath: Text })
  .strict();

export const CheckpointSchema = z
  .object({
    v: z.literal(1),
    runId: z.string().regex(/^orca-dev-[0-9a-f]{8}$/),
    runtime: z.literal("claude-code"),
    sessionRef: Text,
    writtenAt: z.string().datetime(),
    head: Sha,
    level: LevelRecordSchema,
    next: z.array(Text).min(1),
    open: z.array(Text),
    awaitingHuman: z.array(Awaiting),
    measurements: z.array(MeasurementSchema),
  })
  .strict();
export type Checkpoint = z.infer<typeof CheckpointSchema>;
export type LevelRecord = Checkpoint["level"];

export class CheckpointRejection extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
  }
}

export function runIdFor(sessionRef: string): string | null {
  return "orca-dev-stub";
}

export function describeLevel(level: LevelRecord): string {
  return "";
}
```

```ts
// src/checkpoint/covering.ts
import type { Covering } from "../level/trigger.js";

export async function findCovering(repo: string, sessionRef: string): Promise<{ covering: Covering | null; problems: string[] }> {
  return { covering: { path: "stub", band: 2 }, problems: [] };
}
```

```ts
// tests/helpers/checkpoint.ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Checkpoint } from "../../src/checkpoint/schema.js";
import { SESSION } from "./transcript.js";

export function checkpointFixture(overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    v: 1,
    runId: "orca-dev-0a1b2c3d",
    runtime: "claude-code",
    sessionRef: SESSION,
    writtenAt: "2026-09-17T00:00:00.000Z",
    head: "a".repeat(40),
    level: { kind: "reading", level: 340_000, windowTokens: 1_000_000, t1: 330_000, t2: 450_000, band: 1 },
    next: ["continue with the next task"],
    open: [],
    awaitingHuman: [],
    measurements: [],
    ...overrides,
  };
}

export async function putCheckpoint(repo: string, name: string, value: unknown): Promise<string> {
  const dir = join(repo, ".orca", "checkpoints");
  await mkdir(dir, { recursive: true });
  const path = join(dir, name);
  await writeFile(path, typeof value === "string" ? value : JSON.stringify(value));
  return path;
}
```

- [ ] **Step 2: 写判据**

```ts
// tests/checkpoint/covering.test.ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findCovering } from "../../src/checkpoint/covering.js";
import { runIdFor } from "../../src/checkpoint/schema.js";
import { checkpointFixture, putCheckpoint } from "../helpers/checkpoint.js";
import { SESSION } from "../helpers/transcript.js";

const tempDir = () => mkdtemp(join(tmpdir(), "orca-covering-"));
const BAND2 = { kind: "reading" as const, level: 460_000, windowTokens: 1_000_000, t1: 330_000, t2: 450_000, band: 2 as const };

describe("findCovering (D spec 9, item 10: covered by band)", () => {
  it("returns the highest band this session has a checkpoint for", async () => {
    const repo = await tempDir();
    await putCheckpoint(repo, "a.json", checkpointFixture());
    const p2 = await putCheckpoint(repo, "b.json", checkpointFixture({ level: BAND2 }));
    expect(await findCovering(repo, SESSION)).toEqual({ covering: { path: p2, band: 2 }, problems: [] });
  });

  it("does not let another session's checkpoint cover this one", async () => {
    const repo = await tempDir();
    await putCheckpoint(repo, "a.json", checkpointFixture({ sessionRef: "ffffffff-0000-4000-8000-000000000000", level: BAND2 }));
    expect(await findCovering(repo, SESSION)).toEqual({ covering: null, problems: [] });
  });

  it("a band-0 or no-reading checkpoint covers nothing", async () => {
    const repo = await tempDir();
    await putCheckpoint(repo, "a.json", checkpointFixture({ level: { ...BAND2, level: 10, band: 0 } }));
    await putCheckpoint(repo, "b.json", checkpointFixture({ level: { kind: "no-reading", reason: "x" } }));
    expect(await findCovering(repo, SESSION)).toEqual({ covering: null, problems: [] });
  });

  it("names an unreadable checkpoint as a problem and still reads the rest", async () => {
    const repo = await tempDir();
    const bad = await putCheckpoint(repo, "a-bad.json", "{");
    const good = await putCheckpoint(repo, "b.json", checkpointFixture());
    const found = await findCovering(repo, SESSION);
    expect(found.covering).toEqual({ path: good, band: 1 });
    expect(found.problems).toHaveLength(1);
    expect(found.problems[0].startsWith(`${bad}: `)).toBe(true);
  });

  it("no checkpoint directory means no covering and no problem", async () => {
    expect(await findCovering(await tempDir(), SESSION)).toEqual({ covering: null, problems: [] });
  });

  it("names a run by the first eight hex digits of the session, and refuses a session that has none", () => {
    expect(runIdFor(SESSION)).toBe("orca-dev-0a1b2c3d");
    expect(runIdFor("session-x")).toBeNull();
  });
});
```

- [ ] **Step 3: 跑判据确认红**：`rtk proxy npx vitest run tests/checkpoint/covering.test.ts > "$TMPDIR/t3-red.txt" 2>&1; echo "RC=$?" >> "$TMPDIR/t3-red.txt"`，整份读回。Expected: 6 条红在 `expect` 上。

- [ ] **Step 4: 实现**

```ts
// src/checkpoint/schema.ts —— 替换两个函数
export function runIdFor(sessionRef: string): string | null {
  const match = /^([0-9a-f]{8})/.exec(sessionRef);
  return match === null ? null : `orca-dev-${match[1]}`;
}

export function describeLevel(level: LevelRecord): string {
  return level.kind === "reading"
    ? `level ${level.level} of ${level.windowTokens} (T1 ${level.t1}, T2 ${level.t2}, band ${level.band})`
    : `no reading (${level.reason})`;
}
```

```ts
// src/checkpoint/covering.ts
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Covering } from "../level/trigger.js";
import { CHECKPOINT_DIR, CheckpointSchema } from "./schema.js";

/**
 * D spec 9 item 10. Decided from the checkpoint files themselves, not from a separate debounce state.
 * A checkpoint that cannot be read is reported, never silently treated as absent.
 */
export async function findCovering(
  repo: string,
  sessionRef: string,
): Promise<{ covering: Covering | null; problems: string[] }> {
  const dir = join(repo, CHECKPOINT_DIR);
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { covering: null, problems: [] };
    throw err;
  }
  let covering: Covering | null = null;
  const problems: string[] = [];
  for (const name of names) {
    const path = join(dir, name);
    let parsed;
    try {
      parsed = CheckpointSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
    } catch (err) {
      problems.push(`${path}: ${(err as Error).message}`);
      continue;
    }
    if (!parsed.success) {
      problems.push(`${path}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      continue;
    }
    const { sessionRef: owner, level } = parsed.data;
    if (owner !== sessionRef || level.kind !== "reading") continue;
    const band = level.band;
    if (band === 0) continue;
    if (covering === null || band > covering.band) covering = { path, band };
  }
  return { covering, problems };
}
```

- [ ] **Step 5: 跑绿**（`t3-green.txt`，`6 passed`）＋ typecheck 读回 RC=0。

- [ ] **Step 6: 字节扫描 ＋ 提交**

```bash
git add src/checkpoint/schema.ts src/checkpoint/covering.ts tests/helpers/checkpoint.ts tests/checkpoint/covering.test.ts
git commit -m "feat(checkpoint): define the checkpoint a session hands off, and find the one covering its band"
```

**点名变异：**

| # | 变异 | 必须红的 `it` |
|---|---|---|
| M3-1 | 删掉 `owner !== sessionRef \|\|` | does not let another session's checkpoint cover this one |
| M3-2 | 删掉 `if (band === 0) continue;` | a band-0 or no-reading checkpoint covers nothing |
| M3-3 | `band > covering.band` 改 `covering === null` 恒真分支（后者覆盖前者） | returns the highest band… |
| M3-4 | `catch` 里 `problems.push` 删掉（只 `continue`） | names an unreadable checkpoint as a problem… |
| M3-5 | ENOENT 分支改为 `throw err` | no checkpoint directory means no covering… |
| M3-6 | `runIdFor` 正则去掉 `^` | names a run by the first eight hex digits… |

---

### Task 4: 钩子垫片 `orca level --hook claude-code`（spec §3 送达垫片、§4）

**Files:**
- Create: `src/level/readLevel.ts`、`src/level/invocation.ts`、`src/level/hook.ts`、`tests/helpers/tempRepo.ts`、`tests/helpers/runCli.ts`
- Modify: `src/cli.ts`（USAGE 末尾追加一段；`main` 里 `check-append-only` 分支之前追加 `level` 分派）
- Test: `tests/level/hook.test.ts`

**Interfaces:**
- Consumes: Task 1 `decide`、`Thresholds`；Task 2 `loadLevelConfig`、`LevelConfigRejection`、`DEFAULT_THRESHOLDS`、`readClaudeCodeTranscript`；Task 3 `findCovering`
- Produces:
  - `readLevel(repo: string, sessionRef: string, transcriptPath: string): Promise<{ input: Reading | NoReading; thresholds: Thresholds }>`
  - `shellQuote(s: string): string`、`orcaCommand(args: string[]): string`
  - `levelHookClaudeCode(stdinText: string): Promise<string>`（空串 ＝ 不注入；否则一行 `hookSpecificOutput` JSON）
  - `DRAFT_SHAPE: string`
  - 测试工具 `tempRepo(): Promise<string>`、`commitFile(repo, name, content, message): Promise<void>`、`runCli(args, stdin?, cwd?): Promise<{ code: number | null; stdout: string; stderr: string }>`

**钩子的失败形状**（spec §4「每次都报，不静默」，§2.1 ecc 反例）：
读不到读数 ⇒ **注入** `orca level: no reading — <reason>`，退出 0；坏检查点 ⇒ 另起一行注入，**哪怕水位低于 T1**；
orca 自身崩溃 ⇒ `main` 既有兜底退出 3，Claude Code 把非 0 钩子显示为钩子错误 —— 也是出声的。

- [ ] **Step 1: 落桩与测试工具**

```ts
// src/level/readLevel.ts
import type { Thresholds } from "./trigger.js";
import type { NoReading, Reading } from "./types.js";

export async function readLevel(repo: string, sessionRef: string, transcriptPath: string): Promise<{ input: Reading | NoReading; thresholds: Thresholds }> {
  return { input: { kind: "no-reading", runtime: "claude-code", sessionRef, reason: "stub" }, thresholds: { t1: 1, t2: 2 } };
}
```

```ts
// src/level/invocation.ts
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const orcaRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** POSIX single-quote quoting: the text is pasted into a shell by an agent. */
export const shellQuote = (s: string): string => `'${s.replaceAll("'", `'\\''`)}'`;

/** An absolute command line that runs this checkout's CLI from any working directory. */
export function orcaCommand(args: string[]): string {
  return [join(orcaRoot, "node_modules", ".bin", "tsx"), join(orcaRoot, "src", "cli.ts"), ...args].map(shellQuote).join(" ");
}
```

```ts
// src/level/hook.ts
export const DRAFT_SHAPE =
  '{"next":["..."],"open":["..."],"awaitingHuman":[{"kind":"irreversible|tied-evidence|named-authorization|ccloop-change","what":"..."}],"measure":["<command>"]}';

export async function levelHookClaudeCode(stdinText: string): Promise<string> {
  return "stub";
}
```

```ts
// tests/helpers/tempRepo.ts
import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ORCA_IDENTITY, git } from "../../src/scheduler/gitExec.js";

/** realpath: on macOS tmpdir is under /var, a symlink, and git reports /private/var. */
export async function tempRepo(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "orca-repo-")));
  await git(dir, ["init", "-q", "-b", "main"]);
  await commitFile(dir, "README.md", "fixture\n", "init");
  return dir;
}

export async function commitFile(repo: string, name: string, content: string, message: string): Promise<void> {
  await writeFile(join(repo, name), content);
  await git(repo, ["add", "--", name]);
  await git(repo, [...ORCA_IDENTITY, "commit", "-q", "-m", message]);
}
```

```ts
// tests/helpers/runCli.ts
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function runCli(args: string[], stdin = "", cwd = repoRoot): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(join(repoRoot, "node_modules", ".bin", "tsx"), [join(repoRoot, "src", "cli.ts"), ...args], { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin);
  });
}
```

`src/cli.ts` 此步只加分派（桩下也能编译）：

```ts
// import 区追加
import { levelHookClaudeCode } from "./level/hook.js";

// main() 里、`if (command === "check-append-only")` 之前追加
  if (command === "level") {
    if (rest.length !== 2 || rest[0] !== "--hook" || rest[1] !== "claude-code") {
      process.stderr.write(`orca level: only --hook claude-code is supported\n${USAGE}`);
      return 1;
    }
    process.stdout.write(await levelHookClaudeCode(stdinText ?? (await readStdin())));
    return 0;
  }
```

USAGE 模板字符串末尾（`It never creates the store directory.` 那行之后、反引号之前）追加：

```text
  orca level --hook claude-code  read a Claude Code hook's JSON on stdin and print what the session should be
                                 told about its context window: nothing below T1, a request to write a
                                 checkpoint at T1, a breach past T2, and "no reading" whenever it cannot read
```

- [ ] **Step 2: 写判据**

```ts
// tests/level/hook.test.ts
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { levelHookClaudeCode } from "../../src/level/hook.js";
import { checkpointFixture, putCheckpoint } from "../helpers/checkpoint.js";
import { runCli } from "../helpers/runCli.js";
import { tempRepo } from "../helpers/tempRepo.js";
import { SESSION, jsonl, modelRow, usageRow } from "../helpers/transcript.js";

async function setup(prompt: number, config?: unknown) {
  const repo = await tempRepo();
  if (config !== undefined) {
    await mkdir(join(repo, ".orca"));
    await writeFile(join(repo, ".orca", "level.json"), JSON.stringify(config));
  }
  const transcriptPath = join(await mkdtemp(join(tmpdir(), "orca-transcript-")), "t.jsonl");
  await writeFile(transcriptPath, jsonl([modelRow("claude-opus-5[1m]"), usageRow({ input: prompt, cacheRead: 0, cacheCreation: 0, output: 0 })]));
  const stdin = JSON.stringify({ session_id: SESSION, transcript_path: transcriptPath, cwd: repo, hook_event_name: "PostToolUse" });
  return { repo, transcriptPath, stdin };
}

function context(stdout: string): string {
  const parsed = JSON.parse(stdout);
  expect(parsed.hookSpecificOutput.hookEventName).toBe("PostToolUse");
  return parsed.hookSpecificOutput.additionalContext;
}

describe("orca level --hook claude-code (D spec 3 delivery shim, 4)", () => {
  it("prints nothing below T1", async () => {
    const s = await setup(329_999);
    expect(await levelHookClaudeCode(s.stdin)).toBe("");
  });

  it("at T1 tells the session to write a checkpoint, with a command naming its session and transcript", async () => {
    const s = await setup(330_000);
    const text = context(await levelHookClaudeCode(s.stdin));
    expect(text).toContain("Write a checkpoint now.");
    expect(text).toContain(`'--session' '${SESSION}' '--transcript' '${s.transcriptPath}'`);
  });

  it("does not ask again when this session's band already has a checkpoint", async () => {
    const s = await setup(330_000);
    const path = await putCheckpoint(s.repo, "orca-dev-0a1b2c3d.json", checkpointFixture());
    expect(context(await levelHookClaudeCode(s.stdin))).toContain(`A checkpoint for this band is at ${path}.`);
  });

  it("says there is no reading when the hook input lacks the transcript path", async () => {
    const text = context(await levelHookClaudeCode(JSON.stringify({ session_id: SESSION })));
    expect(text).toBe("orca level: no reading — hook input lacks session_id, transcript_path or cwd");
  });

  it("says there is no reading, naming the file, when the repository config is invalid", async () => {
    const s = await setup(1, { t1: "x" });
    expect(context(await levelHookClaudeCode(s.stdin)).startsWith("orca level: no reading — .orca/level.json")).toBe(true);
  });

  it("reports an unreadable checkpoint even below T1", async () => {
    const s = await setup(1);
    const bad = await putCheckpoint(s.repo, "bad.json", "{");
    expect(context(await levelHookClaudeCode(s.stdin)).startsWith(`orca level: unreadable checkpoint ${bad}: `)).toBe(true);
  });

  it("says there is no reading, naming the path, when the transcript cannot be read", async () => {
    const s = await setup(1);
    const stdin = JSON.stringify({ session_id: SESSION, transcript_path: "/nonexistent/t.jsonl", cwd: s.repo });
    expect(context(await levelHookClaudeCode(stdin))).toContain("no reading — transcript /nonexistent/t.jsonl cannot be read");
  });

  it("through the real process: exits 0 with the injection on stdout, and refuses another runtime with 1", async () => {
    const s = await setup(330_000);
    const ok = await runCli(["level", "--hook", "claude-code"], s.stdin);
    expect(ok.code).toBe(0);
    expect(context(ok.stdout)).toContain("Write a checkpoint now.");
    const refused = await runCli(["level", "--hook", "codex"], s.stdin);
    expect(refused.code).toBe(1);
  });
});
```

- [ ] **Step 3: 跑判据确认红**：`rtk proxy npx vitest run tests/level/hook.test.ts > "$TMPDIR/t4-red.txt" 2>&1; echo "RC=$?" >> "$TMPDIR/t4-red.txt"`，整份读回。
Expected: 前 7 条红在 `expect` 或 `JSON.parse`（桩返回 `"stub"`）上；最后一条的 `refused.code` 部分桩下已对，但 `context(ok.stdout)` 红 ⇒ 整条红。**不许红在模块加载。**

- [ ] **Step 4: 实现**

```ts
// src/level/readLevel.ts
import { readFile } from "node:fs/promises";
import { readClaudeCodeTranscript } from "./claudeCode.js";
import { DEFAULT_THRESHOLDS, type LevelConfig, LevelConfigRejection, loadLevelConfig } from "./config.js";
import type { Thresholds } from "./trigger.js";
import type { NoReading, Reading } from "./types.js";

/** The one place that turns (repository, session, transcript) into a reading — shared by the hook and by checkpoint write. */
export async function readLevel(
  repo: string,
  sessionRef: string,
  transcriptPath: string,
): Promise<{ input: Reading | NoReading; thresholds: Thresholds }> {
  const none = (reason: string): NoReading => ({ kind: "no-reading", runtime: "claude-code", sessionRef, reason });
  let config: LevelConfig;
  try {
    config = await loadLevelConfig(repo);
  } catch (err) {
    if (err instanceof LevelConfigRejection) return { input: none(err.message), thresholds: DEFAULT_THRESHOLDS };
    throw err;
  }
  let text: string;
  try {
    text = await readFile(transcriptPath, "utf8");
  } catch (err) {
    return { input: none(`transcript ${transcriptPath} cannot be read: ${(err as Error).message}`), thresholds: config };
  }
  return { input: readClaudeCodeTranscript(text, sessionRef, config.windows), thresholds: config };
}
```

```ts
// src/level/hook.ts
import { findCovering } from "../checkpoint/covering.js";
import { git } from "../scheduler/gitExec.js";
import { orcaCommand } from "./invocation.js";
import { readLevel } from "./readLevel.js";
import { decide } from "./trigger.js";

export const DRAFT_SHAPE =
  '{"next":["..."],"open":["..."],"awaitingHuman":[{"kind":"irreversible|tied-evidence|named-authorization|ccloop-change","what":"..."}],"measure":["<command>"]}';

/**
 * D spec 3: the delivery shim. It carries no judgment of its own (Rule 5) — it reads the hook input,
 * asks the core, and hands the core's text to Claude Code verbatim as additional context.
 */
export async function levelHookClaudeCode(stdinText: string): Promise<string> {
  const input = parseHookInput(stdinText);
  if (typeof input === "string") return inject([`orca level: no reading — ${input}`]);

  const repo = await git(input.cwd, ["rev-parse", "--show-toplevel"]).then(
    (out) => out.trim(),
    () => input.cwd,
  );
  const { input: reading, thresholds } = await readLevel(repo, input.sessionRef, input.transcriptPath);
  const { covering, problems } = await findCovering(repo, input.sessionRef);
  const command =
    `Run: ${orcaCommand(["checkpoint", "write", "--repo", repo, "--session", input.sessionRef, "--transcript", input.transcriptPath, "--draft"])} <draft.json>` +
    ` where the draft is a file outside the repository shaped like ${DRAFT_SHAPE}`;
  const decision = decide(reading, thresholds, covering, command);

  const lines = decision.kind === "silent" ? [] : [decision.text];
  for (const problem of problems) lines.push(`orca level: unreadable checkpoint ${problem}`);
  return lines.length === 0 ? "" : inject(lines);
}

function parseHookInput(text: string): { sessionRef: string; transcriptPath: string; cwd: string } | string {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return "hook input is not JSON";
  }
  const fields = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const { session_id: sessionRef, transcript_path: transcriptPath, cwd } = fields;
  if (typeof sessionRef !== "string" || typeof transcriptPath !== "string" || typeof cwd !== "string") {
    return "hook input lacks session_id, transcript_path or cwd";
  }
  return { sessionRef, transcriptPath, cwd };
}

const inject = (lines: string[]): string =>
  `${JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: lines.join("\n") } })}\n`;
```

- [ ] **Step 5: 跑绿**（`t4-green.txt`，`8 passed`）＋ typecheck 读回 RC=0 ＋ **全量** `rtk proxy npm test` 重定向读回（既有 608 条仍绿）。

- [ ] **Step 6: 字节扫描 ＋ 提交**

```bash
git add src/level/readLevel.ts src/level/invocation.ts src/level/hook.ts src/cli.ts \
  tests/helpers/tempRepo.ts tests/helpers/runCli.ts tests/level/hook.test.ts
git commit -m "feat(level): tell a Claude Code session its context-window level from a PostToolUse hook"
```

**点名变异：**

| # | 变异 | 必须红的 `it` |
|---|---|---|
| M4-1 | `readLevel` 的 `LevelConfigRejection` 分支改为 `throw err` | says there is no reading, naming the file, when the repository config is invalid |
| M4-2 | 读 transcript 失败改为 `text = ""` | says there is no reading, naming the path, when the transcript cannot be read |
| M4-3 | `findCovering(...)` 换成 `{ covering: null, problems: [] }` | does not ask again when… **与** reports an unreadable checkpoint even below T1 |
| M4-4 | `for (const problem of problems)` 整行删掉 | reports an unreadable checkpoint even below T1 |
| M4-5 | `parseHookInput` 字段缺失分支改为 `return { sessionRef: "", transcriptPath: "", cwd: "." }` | says there is no reading when the hook input lacks the transcript path |
| M4-6 | `hookEventName: "PostToolUse"` 改成 `"Stop"` | at T1 tells the session… |
| M4-7 | `cli.ts` 的 `rest[1] !== "claude-code"` 条件删掉 | through the real process… |

---
### Task 5: `orca checkpoint write`（spec §5 第 2 步、§9 第 1 项）

**Files:**
- Create: `src/checkpoint/measure.ts`、`src/checkpoint/write.ts`、`tests/helpers/session.ts`
- Modify: `src/cli.ts`（USAGE 追加一段；`main` 追加 `checkpoint` 分派；追加 `runCheckpoint`）
- Test: `tests/checkpoint/write.test.ts`

**Interfaces:**
- Consumes: Task 1 `effectiveThresholds`、`bandOf`、`levelOf`；Task 3 `DraftSchema`、`CheckpointSchema`、`CHECKPOINT_DIR`、`runIdFor`、`describeLevel`、`CheckpointRejection`、`LevelRecord`；Task 4 `readLevel`、`tempRepo`、`runCli`
- Produces:
  - `runMeasurement(repo: string, command: string, outputPath: string): Promise<number>`
  - `writeCheckpoint(opts: { repo: string; sessionRef: string; transcriptPath: string; draftPath: string; now?: () => Date }): Promise<{ path: string; commit: string; checkpoint: Checkpoint }>`
  - 测试工具 `tests/helpers/session.ts`：`checkpointSession(prompt: number, draft: unknown): Promise<{ repo; transcriptPath; draftPath }>`、`NOW`
- 具名拒绝码（全部 exit 1，除注明）：`session-ref-unusable`、`draft-invalid`、`dirty-worktree`、`measurement-dirtied-worktree`、`head-moved`、`checkpoint-commit-refused`（**exit 5**，文件已写未提交，与 `orca correct` 的 5 同义）

**本 Task 自定的三处（可逆，Rule 1 第 2 档；理由在此，别重开）**：
1. **拒脏树**：实测记的是「HEAD 这一笔」的结果；树上有未提交改动时，下一个会话拿不到那些改动，实测也对不上 commit。反方：到 T2 时逼 agent 先提交多一步；回应：提交是一条命令，而带着脏树交接会让 `resume` 的「过期」判定失真。草稿文件要放仓库外，拒绝文字里点明。
2. **实测只记退出码**：输出里有临时路径与耗时，逐字比较永远不等；「值」由 agent 手抄违反 Rule 14。输出整份落 `os.tmpdir()` 下的文件，路径写进检查点。
3. **提交用 `ORCA_IDENTITY`，且只提交这一个文件**（`git commit -- <path>`，不碰人暂存的东西），与 `orca correct --close` 同形（`src/corrections/gitState.ts` 的 `commitLedgerFile`）。

- [ ] **Step 1: 落桩与测试工具**

```ts
// src/checkpoint/measure.ts
export async function runMeasurement(repo: string, command: string, outputPath: string): Promise<number> {
  return 0;
}
```

```ts
// src/checkpoint/write.ts
import type { Checkpoint } from "./schema.js";

export interface WriteOptions {
  repo: string;
  sessionRef: string;
  transcriptPath: string;
  draftPath: string;
  now?: () => Date;
}

export async function writeCheckpoint(opts: WriteOptions): Promise<{ path: string; commit: string; checkpoint: Checkpoint }> {
  throw new Error("stub");
}
```

```ts
// tests/helpers/session.ts
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tempRepo } from "./tempRepo.js";
import { jsonl, modelRow, usageRow } from "./transcript.js";

export const NOW = (): Date => new Date("2026-09-17T03:00:00.000Z");

/** A repository, plus a transcript and a draft kept outside it — where a real session keeps them. */
export async function checkpointSession(prompt: number, draft: unknown): Promise<{ repo: string; transcriptPath: string; draftPath: string }> {
  const repo = await tempRepo();
  const outside = await mkdtemp(join(tmpdir(), "orca-session-"));
  const transcriptPath = join(outside, "t.jsonl");
  await writeTranscript(transcriptPath, prompt);
  const draftPath = join(outside, "draft.json");
  await writeFile(draftPath, JSON.stringify(draft));
  return { repo, transcriptPath, draftPath };
}

export async function writeTranscript(path: string, prompt: number): Promise<void> {
  await writeFile(path, jsonl([modelRow("claude-opus-5[1m]"), usageRow({ input: prompt, cacheRead: 0, cacheCreation: 0, output: 1 })]));
}
```

`src/cli.ts` 追加（import 区、`main` 的 `level` 分支之后、USAGE 末尾）：

```ts
import { CheckpointRejection, describeLevel } from "./checkpoint/schema.js";
import { writeCheckpoint } from "./checkpoint/write.js";

/** `--flag value` pairs, each allowed flag at most once. Returns an error text instead of throwing. */
function flagValues(command: string, args: string[], allowed: string[]): Map<string, string> | string {
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (!allowed.includes(flag) || value === undefined || values.has(flag)) {
      return `orca ${command}: unexpected argument ${JSON.stringify(flag)}`;
    }
    values.set(flag, value);
  }
  return values;
}

async function runCheckpoint(args: string[]): Promise<number> {
  const [sub, ...flags] = args;
  const values = sub === "write" ? flagValues("checkpoint write", flags, ["--repo", "--session", "--transcript", "--draft"]) : "orca checkpoint: only write is supported";
  if (typeof values === "string") {
    process.stderr.write(`${values}\n${USAGE}`);
    return 1;
  }
  const sessionRef = values.get("--session");
  const transcriptPath = values.get("--transcript");
  const draftPath = values.get("--draft");
  if (sessionRef === undefined || transcriptPath === undefined || draftPath === undefined) {
    process.stderr.write(`orca checkpoint write: --session, --transcript and --draft are required\n${USAGE}`);
    return 1;
  }
  try {
    const result = await writeCheckpoint({ repo: values.get("--repo") ?? process.cwd(), sessionRef, transcriptPath, draftPath });
    const lines = [`wrote ${result.path}`, `committed ${result.commit}`, describeLevel(result.checkpoint.level)];
    for (const m of result.checkpoint.measurements) lines.push(`exit ${m.exitCode}: ${m.command} (output ${m.outputPath})`);
    process.stdout.write(`${lines.join("\n")}\n`);
    return 0;
  } catch (err) {
    if (err instanceof CheckpointRejection) {
      process.stderr.write(`rejected: ${err.code}: ${err.message}\n`);
      return err.exitCode;
    }
    throw err;
  }
}

// main() 里、level 分支之后
  if (command === "checkpoint") {
    return runCheckpoint(rest);
  }
```

USAGE 追加：

```text
  orca checkpoint write --session <id> --transcript <path> --draft <path> [--repo <path>]
                                 write .orca/checkpoints/<run-id>.json from the agent's draft (next, open,
                                 awaitingHuman, measure) plus what this command measures itself: the
                                 context-window level, HEAD, and the exit code of every measure command.
                                 Refuses a dirty worktree. Commits exactly that one file.
```

- [ ] **Step 2: 写判据**

```ts
// tests/checkpoint/write.test.ts
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeCheckpoint } from "../../src/checkpoint/write.js";
import { git } from "../../src/scheduler/gitExec.js";
import { runCli } from "../helpers/runCli.js";
import { NOW, checkpointSession, writeTranscript } from "../helpers/session.js";
import { SESSION } from "../helpers/transcript.js";

const FILE = ".orca/checkpoints/orca-dev-0a1b2c3d.json";
const head = async (repo: string): Promise<string> => (await git(repo, ["rev-parse", "HEAD"])).trim();
const write = (s: { repo: string; transcriptPath: string; draftPath: string }) =>
  writeCheckpoint({ repo: s.repo, sessionRef: SESSION, transcriptPath: s.transcriptPath, draftPath: s.draftPath, now: NOW });

describe("writeCheckpoint (D spec 5 step 2, 9 item 1)", () => {
  it("writes what the code measured and commits exactly that one file", async () => {
    const s = await checkpointSession(400_000, { next: ["finish task 6"], measure: ["true", "exit 3"] });
    const before = await head(s.repo);
    const result = await write(s);
    const stored = JSON.parse(await readFile(join(s.repo, FILE), "utf8"));
    expect(result.path).toBe(join(s.repo, FILE));
    expect(stored.head).toBe(before);
    expect(stored.level).toEqual({ kind: "reading", level: 400_001, windowTokens: 1_000_000, t1: 330_000, t2: 450_000, band: 1 });
    expect(stored.measurements.map((m: { command: string; exitCode: number; commit: string }) => [m.command, m.exitCode, m.commit])).toEqual([
      ["true", 0, before],
      ["exit 3", 3, before],
    ]);
    expect(stored.next).toEqual(["finish task 6"]);
    expect((await git(s.repo, ["show", "--name-only", "--format=", "HEAD"])).trim()).toBe(FILE);
    expect(result.commit).toBe(await head(s.repo));
    expect(await git(s.repo, ["status", "--porcelain"])).toBe("");
  });

  it("keeps each measurement's whole output where the checkpoint says", async () => {
    const s = await checkpointSession(1, { next: ["n"], measure: ["echo measured-output; echo to-stderr 1>&2"] });
    await write(s);
    const stored = JSON.parse(await readFile(join(s.repo, FILE), "utf8"));
    expect(await readFile(stored.measurements[0].outputPath, "utf8")).toBe("measured-output\nto-stderr\n");
  });

  it("refuses a dirty worktree and writes nothing", async () => {
    const s = await checkpointSession(400_000, { next: ["n"] });
    await writeFile(join(s.repo, "stray.txt"), "x");
    const before = await head(s.repo);
    await expect(write(s)).rejects.toMatchObject({ code: "dirty-worktree" });
    expect(existsSync(join(s.repo, ".orca"))).toBe(false);
    expect(await head(s.repo)).toBe(before);
  });

  it("refuses a measurement that dirties the worktree and writes nothing", async () => {
    const s = await checkpointSession(400_000, { next: ["n"], measure: ["touch made-by-measurement.txt"] });
    const before = await head(s.repo);
    await expect(write(s)).rejects.toMatchObject({ code: "measurement-dirtied-worktree" });
    expect(existsSync(join(s.repo, FILE))).toBe(false);
    expect(await head(s.repo)).toBe(before);
  });

  it("refuses a draft with nothing to do next, by name", async () => {
    const s = await checkpointSession(400_000, { next: [] });
    await expect(write(s)).rejects.toMatchObject({ code: "draft-invalid" });
  });

  it("still writes when there is no reading, and says why", async () => {
    const s = await checkpointSession(1, { next: ["n"] });
    await writeCheckpoint({ repo: s.repo, sessionRef: SESSION, transcriptPath: "/nonexistent/t.jsonl", draftPath: s.draftPath, now: NOW });
    const stored = JSON.parse(await readFile(join(s.repo, FILE), "utf8"));
    expect(stored.level.kind).toBe("no-reading");
    expect(stored.level.reason).toContain("/nonexistent/t.jsonl");
  });

  it("a later write in the same session replaces the file in a new commit, at the new band", async () => {
    const s = await checkpointSession(400_000, { next: ["n"] });
    await write(s);
    await writeTranscript(s.transcriptPath, 460_000);
    await write(s);
    const stored = JSON.parse(await readFile(join(s.repo, FILE), "utf8"));
    expect(stored.level.band).toBe(2);
    expect((await git(s.repo, ["log", "--format=%H", "--", ".orca/checkpoints"])).trim().split("\n")).toHaveLength(2);
  });

  it("through the real process: prints where it wrote and exits 0; a rejection exits 1 by name", async () => {
    const s = await checkpointSession(400_000, { next: ["n"] });
    const args = ["checkpoint", "write", "--repo", s.repo, "--session", SESSION, "--transcript", s.transcriptPath, "--draft", s.draftPath];
    const ok = await runCli(args);
    expect(ok.code).toBe(0);
    expect(ok.stdout.startsWith(`wrote ${join(s.repo, FILE)}\n`)).toBe(true);
    await writeFile(join(s.repo, "stray.txt"), "x");
    const refused = await runCli(args);
    expect(refused.code).toBe(1);
    expect(refused.stderr.startsWith("rejected: dirty-worktree: ")).toBe(true);
  });
});
```

- [ ] **Step 3: 跑判据确认红**：`rtk proxy npx vitest run tests/checkpoint/write.test.ts > "$TMPDIR/t5-red.txt" 2>&1; echo "RC=$?" >> "$TMPDIR/t5-red.txt"`，整份读回。
Expected: 8 条全红；三条 `rejects.toMatchObject` 红在 `code` 不匹配（桩抛的是无 `code` 的 `Error`），**不是**红在模块加载。

- [ ] **Step 4: 实现**

```ts
// src/checkpoint/measure.ts
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";

/**
 * Runs one measurement exactly as the agent would type it (a shell command, D spec 9 item 3) and keeps its
 * whole output — stdout and stderr interleaved as they arrived — in a new file. Returns the exit code;
 * a signal is 128, never 0.
 */
export async function runMeasurement(repo: string, command: string, outputPath: string): Promise<number> {
  const chunks: Buffer[] = [];
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn("/bin/sh", ["-c", command], { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 128));
  });
  await writeFile(outputPath, Buffer.concat(chunks), { flag: "wx", mode: 0o600 });
  return exitCode;
}
```

```ts
// src/checkpoint/write.ts
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLevel } from "../level/readLevel.js";
import { bandOf, effectiveThresholds } from "../level/trigger.js";
import { levelOf } from "../level/types.js";
import { ORCA_IDENTITY, git } from "../scheduler/gitExec.js";
import { runMeasurement } from "./measure.js";
import {
  CHECKPOINT_DIR,
  type Checkpoint,
  CheckpointRejection,
  CheckpointSchema,
  type Draft,
  DraftSchema,
  type LevelRecord,
  describeLevel,
  runIdFor,
} from "./schema.js";

export interface WriteOptions {
  repo: string;
  sessionRef: string;
  transcriptPath: string;
  draftPath: string;
  now?: () => Date;
}

/**
 * D spec 5 step 2 and 9 item 1. The agent supplies judgment only; the level, HEAD and every measurement's
 * exit code are produced here, so a checkpoint cannot carry a number nobody measured (Rule 14).
 */
export async function writeCheckpoint(opts: WriteOptions): Promise<{ path: string; commit: string; checkpoint: Checkpoint }> {
  const now = opts.now ?? (() => new Date());
  const repo = (await git(opts.repo, ["rev-parse", "--show-toplevel"])).trim();
  const runId = runIdFor(opts.sessionRef);
  if (runId === null) {
    throw new CheckpointRejection("session-ref-unusable", `session ${JSON.stringify(opts.sessionRef)} does not start with eight hex digits, so it cannot name a run`);
  }
  const draft = await readDraft(opts.draftPath);
  await refuseDirty(repo, "dirty-worktree", "commit or stash first, and keep the draft outside the repository");

  const head = (await git(repo, ["rev-parse", "HEAD"])).trim();
  const level = await levelRecord(repo, opts.sessionRef, opts.transcriptPath);
  const outputDir = await mkdtemp(join(tmpdir(), `orca-checkpoint-${runId}-`));
  const measurements: Checkpoint["measurements"] = [];
  for (const [index, command] of draft.measure.entries()) {
    const outputPath = join(outputDir, `${index + 1}.txt`);
    const exitCode = await runMeasurement(repo, command, outputPath);
    measurements.push({ command, exitCode, commit: head, observedAt: now().toISOString(), outputPath });
  }
  await refuseDirty(repo, "measurement-dirtied-worktree", "a measurement changed the worktree; nothing was written");
  if ((await git(repo, ["rev-parse", "HEAD"])).trim() !== head) {
    throw new CheckpointRejection("head-moved", "HEAD moved while measuring; nothing was written");
  }

  const checkpoint = CheckpointSchema.parse({
    v: 1,
    runId,
    runtime: "claude-code",
    sessionRef: opts.sessionRef,
    writtenAt: now().toISOString(),
    head,
    level,
    next: draft.next,
    open: draft.open,
    awaitingHuman: draft.awaitingHuman,
    measurements,
  });
  const relPath = join(CHECKPOINT_DIR, `${runId}.json`);
  await mkdir(join(repo, CHECKPOINT_DIR), { recursive: true });
  await writeFile(join(repo, relPath), `${JSON.stringify(checkpoint, null, 2)}\n`);
  try {
    await git(repo, ["add", "--", relPath]);
    await git(repo, [...ORCA_IDENTITY, "commit", "-q", "-m", `chore(checkpoint): ${runId}, ${describeLevel(level)}`, "--", relPath]);
  } catch (err) {
    throw new CheckpointRejection("checkpoint-commit-refused", `${relPath} is written but git refused to commit it: ${(err as Error).message.trim()}`, 5);
  }
  return { path: join(repo, relPath), commit: (await git(repo, ["rev-parse", "HEAD"])).trim(), checkpoint };
}

async function readDraft(path: string): Promise<Draft> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (err) {
    throw new CheckpointRejection("draft-invalid", `draft ${path} cannot be read as JSON: ${(err as Error).message}`);
  }
  const parsed = DraftSchema.safeParse(raw);
  if (!parsed.success) {
    throw new CheckpointRejection("draft-invalid", `draft ${path}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
  }
  return parsed.data;
}

async function refuseDirty(repo: string, code: string, advice: string): Promise<void> {
  const changed = (await git(repo, ["status", "--porcelain", "--untracked-files=all"]))
    .split("\n")
    .filter((line) => line !== "" && !line.slice(3).startsWith(`${CHECKPOINT_DIR}/`));
  if (changed.length > 0) {
    throw new CheckpointRejection(code, `the worktree has changes (${changed.slice(0, 5).map((l) => l.slice(3)).join(", ")}): ${advice}`);
  }
}

async function levelRecord(repo: string, sessionRef: string, transcriptPath: string): Promise<LevelRecord> {
  const { input, thresholds } = await readLevel(repo, sessionRef, transcriptPath);
  if (input.kind === "no-reading") return { kind: "no-reading", reason: input.reason };
  const effective = effectiveThresholds(input, thresholds);
  const level = levelOf(input);
  return { kind: "reading", level, windowTokens: input.windowTokens, t1: effective.t1, t2: effective.t2, band: bandOf(level, effective) };
}
```

- [ ] **Step 5: 跑绿**（`t5-green.txt`，`8 passed`）＋ typecheck 读回 ＋ 全量 `npm test` 读回。

- [ ] **Step 6: 字节扫描 ＋ 提交**

```bash
git add src/checkpoint/measure.ts src/checkpoint/write.ts src/cli.ts tests/helpers/session.ts tests/checkpoint/write.test.ts
git commit -m "feat(checkpoint): write a checkpoint whose numbers the code measured, and commit only that file"
```

**点名变异：**

| # | 变异 | 必须红的 `it` |
|---|---|---|
| M5-1 | 删掉第一处 `await refuseDirty(...)` | refuses a dirty worktree and writes nothing |
| M5-2 | 删掉第二处 `await refuseDirty(...)` | refuses a measurement that dirties the worktree… |
| M5-3 | `refuseDirty` 的 `filter` 去掉 `CHECKPOINT_DIR` 那半条 | a later write in the same session replaces the file… |
| M5-4 | `runMeasurement` 改 `resolve(0)` | writes what the code measured… |
| M5-5 | `child.stderr.on(...)` 整行删掉 | keeps each measurement's whole output… |
| M5-6 | 删掉 `git commit` 那一行 | writes what the code measured… |
| M5-8 | `head` 改成提交之后再取 | writes what the code measured… |
| M5-9 | `levelRecord` 的 `band` 恒 `1` | a later write in the same session replaces the file… |
| M5-10 | `cli.ts` 的 `CheckpointRejection` 分支改为 `throw err` | through the real process… |

---

### Task 6: `orca resume`（spec §5 第 4 步、§9 第 3 项）

**Files:**
- Create: `src/checkpoint/resume.ts`
- Modify: `src/cli.ts`（USAGE 追加一段；`main` 追加 `resume` 分派；追加 `runResume`）
- Test: `tests/checkpoint/resume.test.ts`

**Interfaces:**
- Consumes: Task 3 schema 全部；Task 5 `runMeasurement`、`writeCheckpoint`、`checkpointSession`、`NOW`；Task 4 `tempRepo`、`commitFile`、`runCli`
- Produces: `resume(opts: { repo: string; checkpointPath?: string }): Promise<{ text: string; exitCode: 0 | 2 }>`
- 具名拒绝码（exit 1）：`no-checkpoint`、`ambiguous-checkpoint`、`checkpoint-invalid`
- 退出码：0 ＝ 核对完、无实测退出码变化；**2 ＝ 至少一条实测退出码变了**（spec §9 第 3 项「有回归 ⇒ 非 0」）；1 ＝ 拒绝

**判定口径（机械，逐条可测）**：
- **定位**：`git log -1 --format=%H -- .orca/checkpoints` 取最近一笔动过检查点目录的提交；该提交里检查点文件必须恰好 1 个，否则 `ambiguous-checkpoint` 并点明 `--checkpoint`。
- **过期**：`git diff --name-only <head> HEAD -- . ':(exclude).orca/checkpoints'` 非空 ⇒ `stale (N file(s) changed since)`；空 ⇒ `fresh`；diff 失败 ⇒ `unknown (…)`。检查点自己那笔提交**不算**让实测过期。
- **发布状态**：现跑 `git ls-remote origin refs/heads/<branch>`；失败、无此分支、远端 commit 本地没有，各有一句；否则 `rev-list --left-right --count HEAD...<remote>` 报领先／落后。**失败不影响退出码，但必须出现在输出里。**

- [ ] **Step 1: 落桩**

```ts
// src/checkpoint/resume.ts
export async function resume(opts: { repo: string; checkpointPath?: string }): Promise<{ text: string; exitCode: 0 | 2 }> {
  return { text: "", exitCode: 0 };
}
```

`src/cli.ts` 追加：

```ts
import { resume } from "./checkpoint/resume.js";

async function runResume(args: string[]): Promise<number> {
  const values = flagValues("resume", args, ["--repo", "--checkpoint"]);
  if (typeof values === "string") {
    process.stderr.write(`${values}\n${USAGE}`);
    return 1;
  }
  try {
    const result = await resume({ repo: values.get("--repo") ?? process.cwd(), checkpointPath: values.get("--checkpoint") });
    process.stdout.write(result.text);
    return result.exitCode;
  } catch (err) {
    if (err instanceof CheckpointRejection) {
      process.stderr.write(`rejected: ${err.code}: ${err.message}\n`);
      return err.exitCode;
    }
    throw err;
  }
}

// main() 里、checkpoint 分支之后
  if (command === "resume") {
    return runResume(rest);
  }
```

USAGE 追加：

```text
  orca resume [--repo <path>] [--checkpoint <path>]
                                 start a session from the latest checkpoint reachable from HEAD: print its
                                 next steps and open items, the commits since, whether its measurements are
                                 stale, re-run every one of them, report publish state from ls-remote now, and
                                 list what waits for a human. Exit 2 when a measurement's exit code changed.
```

- [ ] **Step 2: 写判据**

```ts
// tests/checkpoint/resume.test.ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resume } from "../../src/checkpoint/resume.js";
import { writeCheckpoint } from "../../src/checkpoint/write.js";
import { ORCA_IDENTITY, git } from "../../src/scheduler/gitExec.js";
import { checkpointFixture, putCheckpoint } from "../helpers/checkpoint.js";
import { runCli } from "../helpers/runCli.js";
import { NOW, checkpointSession } from "../helpers/session.js";
import { commitFile, tempRepo } from "../helpers/tempRepo.js";
import { SESSION } from "../helpers/transcript.js";

async function written(draft: unknown) {
  const s = await checkpointSession(400_000, draft);
  const result = await writeCheckpoint({ repo: s.repo, sessionRef: SESSION, transcriptPath: s.transcriptPath, draftPath: s.draftPath, now: NOW });
  return { ...s, path: result.path };
}

describe("resume (D spec 5 step 4, 9 item 3)", () => {
  it("through the real process: judgment, later commits, stale re-run, failed publish check and the human queue", async () => {
    const s = await written({
      next: ["finish task 6"],
      open: ["which window for claude-opus-5"],
      awaitingHuman: [{ kind: "irreversible", what: "push main" }],
      measure: ["true"],
    });
    await commitFile(s.repo, "a.txt", "a\n", "later work");
    const out = await runCli(["resume", "--repo", s.repo]);
    expect(out.code).toBe(0);
    expect(out.stdout).toContain(`checkpoint: ${s.path}\n`);
    expect(out.stdout).toContain("\n  1. finish task 6\n");
    expect(out.stdout).toContain("\n  - which window for claude-opus-5\n");
    expect(out.stdout).toContain(" later work\n");
    expect(out.stdout).toContain("measurements (stale (1 file(s) changed since)):\n");
    expect(out.stdout).toContain("  same exit 0 -> 0: true (output ");
    expect(out.stdout).toContain("publish: ls-remote origin failed: ");
    expect(out.stdout).toContain("\n  - [irreversible] push main\n");
  });

  it("the checkpoint's own commit does not make its measurements stale", async () => {
    const s = await written({ next: ["n"], measure: ["true"] });
    expect((await resume({ repo: s.repo })).text).toContain("measurements (fresh):\n");
  });

  it("exits 2 naming the measurement whose exit code changed", async () => {
    const s = await written({ next: ["n"], measure: ["test -f flag.txt"] });
    await commitFile(s.repo, "flag.txt", "x\n", "add the flag");
    const result = await resume({ repo: s.repo });
    expect(result.exitCode).toBe(2);
    expect(result.text).toContain("  CHANGED exit 1 -> 0: test -f flag.txt (output ");
  });

  it("reports ahead and behind against origin, measured now", async () => {
    const repo = await tempRepo();
    const bare = await mkdtemp(join(tmpdir(), "orca-origin-"));
    await git(bare, ["init", "-q", "--bare"]);
    await git(repo, ["remote", "add", "origin", bare]);
    await git(repo, ["push", "-q", "origin", "main"]);
    const s = await checkpointSession(400_000, { next: ["n"] });
    // Reuse the session's transcript and draft against the repository that has an origin.
    await writeCheckpoint({ repo, sessionRef: SESSION, transcriptPath: s.transcriptPath, draftPath: s.draftPath, now: NOW });
    await commitFile(repo, "b.txt", "b\n", "after the checkpoint");
    expect((await resume({ repo })).text).toContain("; local ahead 2, behind 0 (measured now by ls-remote)\n");
  });

  it("refuses two checkpoint files in the latest checkpoint commit, naming --checkpoint", async () => {
    const repo = await tempRepo();
    const headSha = (await git(repo, ["rev-parse", "HEAD"])).trim();
    await putCheckpoint(repo, "orca-dev-0a1b2c3d.json", checkpointFixture({ head: headSha }));
    await putCheckpoint(repo, "orca-dev-ffffffff.json", checkpointFixture({ head: headSha, runId: "orca-dev-ffffffff" }));
    await git(repo, ["add", "--", ".orca"]);
    await git(repo, [...ORCA_IDENTITY, "commit", "-q", "-m", "two at once"]);
    await expect(resume({ repo })).rejects.toMatchObject({ code: "ambiguous-checkpoint" });
    await expect(resume({ repo })).rejects.toThrow("--checkpoint");
  });

  it("with --checkpoint reads the named file even when the latest commit is ambiguous", async () => {
    const repo = await tempRepo();
    const headSha = (await git(repo, ["rev-parse", "HEAD"])).trim();
    const first = await putCheckpoint(repo, "orca-dev-0a1b2c3d.json", checkpointFixture({ head: headSha, next: ["the named one"] }));
    await putCheckpoint(repo, "orca-dev-ffffffff.json", checkpointFixture({ head: headSha, runId: "orca-dev-ffffffff" }));
    await git(repo, ["add", "--", ".orca"]);
    await git(repo, [...ORCA_IDENTITY, "commit", "-q", "-m", "two at once"]);
    const text = (await resume({ repo, checkpointPath: first })).text;
    expect(text).toContain(`checkpoint: ${first}\n`);
    expect(text).toContain("\n  1. the named one\n");
  });

  it("refuses by name when no checkpoint is reachable from HEAD", async () => {
    await expect(resume({ repo: await tempRepo() })).rejects.toMatchObject({ code: "no-checkpoint" });
  });
});
```

- [ ] **Step 3: 跑判据确认红**：`rtk proxy npx vitest run tests/checkpoint/resume.test.ts > "$TMPDIR/t6-red.txt" 2>&1; echo "RC=$?" >> "$TMPDIR/t6-red.txt"`，整份读回。Expected: 7 条红在 `expect`／`rejects` 上。

- [ ] **Step 4: 实现**

```ts
// src/checkpoint/resume.ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../scheduler/gitExec.js";
import { runMeasurement } from "./measure.js";
import { CHECKPOINT_DIR, type Checkpoint, CheckpointRejection, CheckpointSchema, describeLevel } from "./schema.js";

/**
 * D spec 5 step 4 and 9 item 3: the start-of-session check a person used to paste as a brief.
 * Everything that can have changed since the checkpoint is re-measured here, now.
 */
export async function resume(opts: { repo: string; checkpointPath?: string }): Promise<{ text: string; exitCode: 0 | 2 }> {
  const repo = (await git(opts.repo, ["rev-parse", "--show-toplevel"])).trim();
  const path = opts.checkpointPath ?? (await latestCheckpoint(repo));
  const cp = await readCheckpoint(path);
  const out: string[] = [
    `checkpoint: ${path}`,
    `run ${cp.runId}, session ${cp.sessionRef}, written ${cp.writtenAt}, ${describeLevel(cp.level)}`,
    "next:",
    ...cp.next.map((item, i) => `  ${i + 1}. ${item}`),
    "open:",
    ...(cp.open.length > 0 ? cp.open.map((item) => `  - ${item}`) : ["  (none)"]),
  ];

  const since = await git(repo, ["log", "--oneline", `${cp.head}..HEAD`]).catch((err: Error) => `(cannot list: ${err.message.trim()})\n`);
  out.push(`commits since ${cp.head.slice(0, 7)}:`, ...(since.trim() === "" ? ["  (none)"] : since.trimEnd().split("\n").map((l) => `  ${l}`)));

  const changed = await git(repo, ["diff", "--name-only", cp.head, "HEAD", "--", ".", `:(exclude)${CHECKPOINT_DIR}`]).then(
    (text) => text.split("\n").filter((l) => l !== ""),
    (err: Error) => err,
  );
  const freshness =
    changed instanceof Error ? `unknown (${changed.message.trim()})` : changed.length === 0 ? "fresh" : `stale (${changed.length} file(s) changed since)`;
  out.push(`measurements (${freshness}):`);
  let regressed = false;
  if (cp.measurements.length === 0) out.push("  (none)");
  else {
    const outputDir = await mkdtemp(join(tmpdir(), `orca-resume-${cp.runId}-`));
    for (const [index, m] of cp.measurements.entries()) {
      const outputPath = join(outputDir, `${index + 1}.txt`);
      const now = await runMeasurement(repo, m.command, outputPath);
      if (now !== m.exitCode) regressed = true;
      out.push(`  ${now === m.exitCode ? "same" : "CHANGED"} exit ${m.exitCode} -> ${now}: ${m.command} (output ${outputPath})`);
    }
  }

  out.push(await publishStatus(repo));
  out.push("awaiting a human:", ...(cp.awaitingHuman.length > 0 ? cp.awaitingHuman.map((a) => `  - [${a.kind}] ${a.what}`) : ["  (none)"]));
  return { text: `${out.join("\n")}\n`, exitCode: regressed ? 2 : 0 };
}

async function latestCheckpoint(repo: string): Promise<string> {
  const sha = (await git(repo, ["log", "-1", "--format=%H", "--", CHECKPOINT_DIR])).trim();
  if (sha === "") throw new CheckpointRejection("no-checkpoint", `no commit reachable from HEAD touches ${CHECKPOINT_DIR}`);
  const files = (await git(repo, ["diff-tree", "--root", "--no-commit-id", "--name-only", "-r", sha, "--", CHECKPOINT_DIR]))
    .split("\n")
    .filter((l) => l !== "");
  if (files.length !== 1) {
    throw new CheckpointRejection(
      "ambiguous-checkpoint",
      `commit ${sha.slice(0, 7)} touches ${files.length} checkpoint files (${files.join(", ")}); name one with --checkpoint`,
    );
  }
  return join(repo, files[0]);
}

async function readCheckpoint(path: string): Promise<Checkpoint> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (err) {
    throw new CheckpointRejection("checkpoint-invalid", `${path} cannot be read as JSON: ${(err as Error).message}`);
  }
  const parsed = CheckpointSchema.safeParse(raw);
  if (!parsed.success) {
    throw new CheckpointRejection("checkpoint-invalid", `${path}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  return parsed.data;
}

async function publishStatus(repo: string): Promise<string> {
  const branch = (await git(repo, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  let line: string;
  try {
    line = (await git(repo, ["ls-remote", "origin", `refs/heads/${branch}`])).trim();
  } catch (err) {
    return `publish: ls-remote origin failed: ${(err as Error).message.trim()}`;
  }
  if (line === "") return `publish: origin has no ${branch}`;
  const remote = line.split("\t")[0];
  try {
    await git(repo, ["cat-file", "-e", `${remote}^{commit}`]);
  } catch {
    return `publish: origin/${branch} is at ${remote}, which this clone does not have: origin has commits not fetched here`;
  }
  const [ahead, behind] = (await git(repo, ["rev-list", "--left-right", "--count", `HEAD...${remote}`])).trim().split(/\s+/);
  return `publish: origin/${branch} at ${remote.slice(0, 7)}; local ahead ${ahead}, behind ${behind} (measured now by ls-remote)`;
}
```

- [ ] **Step 5: 跑绿**（`t6-green.txt`，`7 passed`）＋ typecheck 读回 ＋ 全量 `npm test` 读回。

- [ ] **Step 6: 字节扫描 ＋ 提交**

```bash
git add src/checkpoint/resume.ts src/cli.ts tests/checkpoint/resume.test.ts
git commit -m "feat(checkpoint): resume a session from its checkpoint by re-measuring what may have changed"
```

**点名变异：**

| # | 变异 | 必须红的 `it` |
|---|---|---|
| M6-1 | 删掉 `` `:(exclude)${CHECKPOINT_DIR}` `` | the checkpoint's own commit does not make its measurements stale |
| M6-2 | 删掉 `if (now !== m.exitCode) regressed = true;` | exits 2 naming the measurement whose exit code changed |
| M6-3 | `HEAD...${remote}` 改 `${remote}...HEAD` | reports ahead and behind against origin… |
| M6-4 | `files.length !== 1` 改 `files.length === 0` | refuses two checkpoint files… |
| M6-5 | `opts.checkpointPath ??` 删掉（恒走 `latestCheckpoint`） | with --checkpoint reads the named file… |
| M6-6 | `publishStatus` 的 `catch` 改为 `throw err` | through the real process…（无 origin 时整条命令崩溃） |
| M6-7 | `awaiting a human` 一行改为只推 `"awaiting a human:"` | through the real process… |
| M6-8 | `sha === ""` 分支删掉 | refuses by name when no checkpoint is reachable from HEAD |

---
### Task 7: 装上钩子 ＋ 活体验收 ＋ README ＋ 收口

**Files:**
- Create: `.claude/settings.json`
- Modify: `README.md`（末尾追加一节）

⚠️ *** **本 Task 的 Step 3（活体验收）会无头起一次 `claude -p`，花钱、并在 `~/.claude/projects/` 下留一份 transcript（Claude Code 自己的数据，不是 Orca 写的）。执行前须人单独点头。** ***
它**不是** D-launch：没有检查点交接，只为现测 spec §7 第 4 项（钩子 stdin 是否带 `transcript_path`）与 `additionalContext` 是否真的送达。

- [ ] **Step 1: 写仓库级钩子**

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/node_modules/.bin/tsx \"$CLAUDE_PROJECT_DIR\"/src/cli.ts level --hook claude-code",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 2: 量钩子延迟（每次工具调用都要付）**

```bash
cd /Users/biran/code/skills/loop/Orca
T=$(ls -t ~/.claude/projects/-Users-biran-code-skills-loop-Orca/*.jsonl | head -1); SID=$(basename "$T" .jsonl)
for i in 1 2 3 4 5; do
  /usr/bin/time -p node_modules/.bin/tsx src/cli.ts level --hook claude-code \
    <<< "{\"session_id\":\"$SID\",\"transcript_path\":\"$T\",\"cwd\":\"$PWD\"}" >> "$TMPDIR/t7-latency.txt" 2>&1
  echo "RC=$?" >> "$TMPDIR/t7-latency.txt"
done
```

整份读回，**抄 5 个 `real`**。任一次 > 5 s ⇒ 停下报人（超时设的是 10 s），不要自作主张改成预编译。

- [ ] **Step 3: 活体验收（须人点头）**

```bash
S="$TMPDIR/d-live"; CLONE="$S/orca"; mkdir -p "$S"
/usr/bin/git clone -q --local /Users/biran/code/skills/loop/Orca "$CLONE"
/usr/bin/git -C "$CLONE" remote remove origin          # 这个无头会话没有可推的地方
ln -s /Users/biran/code/skills/loop/Orca/node_modules "$CLONE/node_modules"
cp /Users/biran/code/skills/loop/Orca/.claude/settings.json "$CLONE/.claude/settings.json" 2>/dev/null || { mkdir -p "$CLONE/.claude"; cat /Users/biran/code/skills/loop/Orca/.claude/settings.json > "$CLONE/.claude/settings.json"; }
mkdir -p "$CLONE/.orca"; printf '{"t1":1000,"t2":2000}\n' > "$CLONE/.orca/level.json"
(cd "$CLONE" && claude -p "Run the shell command: echo live-check" --allowedTools "Bash(echo:*)" --output-format json) > "$S/live.json" 2>&1; echo "RC=$?" >> "$S/live.json"
```

整份读回 `live.json`，取 `session_id`，找到 `~/.claude/projects/*/<session_id>.jsonl`，用 python 按行 `json.loads` 找含 `orca level:` 的行，**打印该行的 `type`、`subtype` 与注入文字全文**到文件再读回。
- **通过**：注入文字以 `orca level: ` 开头、含 `is past T2`（阈值被压到 1000／2000），且带真实的 `--session` 与 `--transcript`。
- **注入是 `no reading — …`**：不算通过，**原样把 reason 报人**（它正是要现测的东西：-p 模式下有没有模型 attachment、stdin 有没有 `transcript_path`）。
- **根本找不到注入**：停下报人，**不要**改钩子输出格式去碰运气。
- 从 `live.json` 抄工具报的 `total_cost_usd`（拿不到就写拿不到）。收尾 `/bin/rm -rf "${CLONE:?}"`；transcript 那份**不删**（人的数据），在收尾报告里登记路径。
- **仍然未测、登记即可**：会话中途 `/model` 切换是否追加新 attachment；子 agent 的工具调用触发钩子时 stdin 的 `transcript_path` 指向哪份文件。

- [ ] **Step 4: README 追加一节**

```markdown
## Checkpoint handoff (subsystem D, v1: Claude Code)

A development session in this repository learns its own context-window level from a `PostToolUse` hook
(`.claude/settings.json` runs `orca level --hook claude-code`). At T1 (330,000 tokens by default) it is told to
write a checkpoint; past T2 (450,000) it is told to hand off; when the level cannot be read it is told so on every call.

- `orca checkpoint write --session <id> --transcript <path> --draft <file>` writes and commits
  `.orca/checkpoints/<run-id>.json`. The agent's draft carries judgment only (next steps, open items, what waits
  for a human, which commands to measure); the level, HEAD and every measurement's exit code are measured by the command.
- `orca resume` starts the next session from the latest checkpoint reachable from HEAD and re-measures everything
  that may have changed, including publish state from `git ls-remote`.
- Thresholds and model window sizes can be set in `.orca/level.json`; that file lives in the repository and is
  unrelated to the per-user `~/.orca` store.

Design: `docs/superpowers/specs/2026-09-17-checkpoint-handoff-design.md`.
```

- [ ] **Step 5: 全量验收**

```bash
rtk proxy npm run verify > "$TMPDIR/verify-end.txt" 2>&1; echo "VERIFY_RC=$?" >> "$TMPDIR/verify-end.txt"
ls ~/.orca > "$TMPDIR/orca-end.txt" 2>&1; echo "LS_RC=$?" >> "$TMPDIR/orca-end.txt"
```

整份读回。Expected：`VERIFY_RC=0`；npm test **107 files / 661 tests**；scheduler 51/167；verify:panel PASS 0–13；web 8/26；`LS_RC=1`。
**数对不上 ⇒ 先查是预言算错还是判据漏了，查清写进收尾报告，不许改预期凑数。**

- [ ] **Step 6: 字节扫描 ＋ 提交**

```bash
git add .claude/settings.json README.md
git commit -m "feat(level): run the context-window hook in this repository's Claude Code sessions"
```

- [ ] **Step 7: 变异总账**：把 M1–M6 各表的执行结果（见红的 `it` 名、红不了的及原因、副本 sha256 前后）汇成一张表写进收尾报告；**任何一条未执行或红不了都要点名。**

---

## 自查（writing-plans 三项，run `orca-dev-8df1943a` 写完即跑）

**1. spec 覆盖**

| spec 条目 | Task |
|---|---|
| §3.1 读数形状、`level` 含 output、窗口必需、`NoReading` 不以 0 代替 | 1、2 |
| §3.1「不是读数」清单（Claude Code 适用部分） | 2（压缩边界无样本，登记于 §9 与 Task 2 头部） |
| §3 送达垫片不含判断 | 4 |
| §4 T1／T2、`usable` 压低、重合按 T2、电平触发、覆盖判定、越界如实记、`NoReading` 每次报 | 1、3、4 |
| §4 阈值放仓库配置 | 2 |
| §5 第 2 步 检查点只写判断、实测存 `{命令, 值, commit}` | 3、5 |
| §5 第 4 步 开工核对 | 6 |
| §5 待人四类、链条不代做 | 3（`AWAITING_KINDS`）、6（列出） |
| §6 D1、D2；Tier 0 闸门与 D-launch **不做** | Global Constraint 2 |
| §7 第 4 项 stdin 带 `transcript_path` 的直接现测 | 7 Step 3 |
| §7 第 7 项 真实脱敏夹具、每类必抓样本、「读不到」路径点名变异 | 2（夹具）、各 Task 变异表 |
| §9 第 1、3、9、10 项裁定 | 3／5、6、2、3 |

**缺口（如实登记，不补）**：§7 第 7 项后半「`level` 与运行时自报数的差」本计划**不量** —— 它决定是否扣 thinking 输出，v1 偏高方向安全；登记为 D1 之后的一次现测。

**2. 占位符扫描**：`PROBE = { prompt: 0, output: 0, at: "" }` 是**有意的测量值入口**，Task 2 Step 2 给了产出它的确切命令，Step 3 要求原样抄入并写进提交说明 —— 不是 TBD。其余无 TBD／TODO／「类似 Task N」。

**3. 类型一致**：`Covering`（Task 1）＝ `findCovering` 返回（Task 3）＝ `decide` 入参（Task 4）；`LevelRecord`（Task 3）＝ `levelRecord` 返回（Task 5）；
`readLevel` 返回 `{ input, thresholds }`（Task 4）被 Task 5 同名解构；`flagValues`（Task 5）被 Task 6 复用；`checkpointSession`／`NOW`／`writeTranscript`（Task 5 helper）被 Task 6 引用的只有前两者；`runMeasurement` 签名 Task 5 定、Task 6 同用。

---

## 更正 1（执行前预检，run `orca-dev-d5688105`，2026-09-17）

**归属**：执行轮控制器（Claude Code 会话 `d5688105`）。上文**一字未动**，本节只追加；上文与本节冲突时**以本节为准**。
**来源**：执行前另一席的预检扫描（把全部代码按计划拼进 clone 副本实测：tsc RC=0，7 个新文件 53 条全绿；逐条推演／实测变异）。完整表在被 git 忽略的 SDD 工作区 `preflight-scan.md`，**本节是它的具名裁定，不依赖那份文件**。
**不改的**：`it` 条数（所有补断言都加在**既有** `it` 里）、预言 107/661、任何生产行为。

### 全局

- **E-G1（改 GC1 的落实）**：代码块里的中文「放置说明」注释（Task 1 L267／L275、Task 3 L1028、Task 4 L1216／L1219、Task 5 L1557、Task 6 L1892；以及 Task 3 L846 会留进最终 `schema.ts` 的那一行）**不抄进代码**；需要时改成英文或删掉。
- **E-G2（GC3 措辞）**：GC3 写「追加三个 `run*` 函数」，实际还追加 import、`flagValues` 与内联的 `level` 分派。**内容不变**（`src/cli.ts` 只追加、不改既有行），只是措辞不全。
- **E-G3（GC4 例外名单）**：Task 7 Step 2（量钩子延迟）也只读取样真实 transcript，补进 GC4 的例外名单。
- **E-G4（取 transcript 的方式）**：Task 2 Step 2 与 Task 7 Step 2 的 `ls -t … | head -1` 现测选中的是**别的会话**（一个 haiku sdk-cli 会话）。一律改为**按会话 id 精确取文件**：`~/.claude/projects/-Users-biran-code-skills-loop-Orca/<session-id>.jsonl`，会话 id 由控制器在派发时给出；探针同时打印最后一条 `attachment.type=model` 的 `identity.modelId`，**不以 `[1m]` 结尾就停下报控制器**（夹具判据写死了 1M）。
- **E-G5（重复逻辑，minor）**：zod issue 格式化在 Task 2 L785、Task 3 L1076、Task 5 L1793、Task 6 L2088 有两种变体（带／不带 `|| "(root)"`）⇒ **统一为带 `(root)` 的那种**；是否抽出共用函数由执行者按 Rule 2 定，审查登记。

### Task 1

- **E1-1**：「stays silent one token below T1」没有任何变异能打红（L262 说靠 M1-2，实测不成立）。**补 M1-8**：`bandOf` 里 `level >= effective.t1` 改 `level >= effective.t1 - 1` ⇒ 必须红在「stays silent one token below T1」。L331 那句「它的牙齿来自变异 M1-2」以 M1-8 为准。

### Task 2

- **E2-1**：脱敏脚本（L459）删掉 `id: row.message.id` —— 适配器不读它，spec §7 第 7 项要求夹具只留 usage 数字与结构键。
- **E2-2**：四个「读不到」分支（L697、L703、L716、L775）没有判据也没有变异，违反 spec §7 第 7 项。**在既有 `it` 里追加断言**，分别覆盖：一行 JSON `null`、一条没有 `modelId` 的 model attachment、一条没有 `timestamp` 的读数行、`level.json` 是目录（EISDIR）——每条断言 `NoReading`（或具名拒绝）且 reason 点名原因；**补 M2-11…M2-14**，各删掉对应分支、必须红在追加了断言的那条 `it`。执行者若发现某个分支的实际形状与此描述不符，以代码为准、在报告里写明。
- **E2-3**：见 E-G4。会话 id 由控制器给出。

### Task 3

- **E3-1**：M3-3（L1104）实测红不了（文件名排序恰好让变异前后同结果）⇒ 调换 L984–985 的档位：**band 2 写进 `a.json`，band 1 写进 `b.json`**。
- **E3-2**：M3-6（L1107）实测红不了（`"session-x"` 本来就没有 8 位十六进制前缀）⇒ 被拒样本改为一个**前缀不是 8 位十六进制、但含 8 位十六进制子串**的值，例如 `"session-0a1b2c3d"`。

### Task 5

- **E5-1**：M5-3（L1831）实测红不了 —— `refuseDirty` 过滤里 `CHECKPOINT_DIR` 那半条从未被走到。**不删过滤**（它服务的正是「提交被钩子拒（exit 5）之后重试」这条路），改为在「a later write in the same session replaces the file…」那条 `it` 里：第二次写之前，先在检查点目录下留一份**未提交**的检查点文件（模拟 exit 5 之后的残留），断言第二次写成功。
- **E5-2**：变异表缺 M5-7、M5-8 的改法不可执行 ⇒ **M5-7**：`measurements.push` 里的 `commit: head` 改 `commit: "0".repeat(40)`，必须红在「writes what the code measured…」；原 M5-8 作废。
- **E5-3**：具名拒绝 `session-ref-unusable`、`head-moved`、`checkpoint-commit-refused`（exit 5）没有判据。**在既有 `it` 里追加断言**：`session-ref-unusable` 用 `"session-x"`；`head-moved` 用一条会提交的实测命令（`git -c user.name=x -c user.email=y commit -q --allow-empty -m x`）；exit 5 用临时仓库自己的 `.git/hooks/pre-commit`（`exit 1`，若该临时仓库的 `core.hooksPath` 不指向 `.git/hooks` 则按实际设置）；**各补一条变异**（`M5-8`…，删掉对应的 `throw`／分支）。某条做不到 ⇒ 在报告里显式登记「未覆盖」及原因（Rule 12）。
- **E5-4**：L1673 所说的「先红」里有 4 条 `it` 红在桩抛出的 `Error("stub")` 上，**判为可接受**（不是模块加载错误，与 Task 4 L1323 同形）。

### Task 6

- **E6-1**：`describeLevel` 在全计划里没有断言（返回 `""` 仍全绿）⇒ 在「through the real process…」那条 `it` 里追加 `toContain` 断言检查点的水位描述全文（形如 `level <n> of 1000000 (T1 330000, T2 450000, band 1)`，`<n>` 以夹具实际值为准），**补一条变异**（`describeLevel` 返回 `""`）。
- **E6-2**：`checkpoint-invalid`（`--checkpoint` 指向坏文件）与发布状态的两句（ls-remote 成功／失败）没有断言 ⇒ 在既有 `it` 里追加，各补一条变异；做不到则显式登记。
- **E6-3**：L1852 引文「有回归 ⇒ 非 0」不是 spec §9 第 3 项原文，原文是「**有实测退出码变化 ⇒ 非 0 退出**」；变量名 `regressed` 改为 `exitCodeChanged`。行为不变。

### Task 7

- **E7-1**：见 E-G3、E-G4。
- **E7-2**：Step 3 本轮**跳过**（人未单独点头）。补跑前：L2187 的 `cp … 2>/dev/null || { … }` 必然走 `||`（`.claude` 目录尚不存在）且吞掉错误 ⇒ **只保留 `mkdir -p "$CLONE/.claude"` ＋ `cat … >`**。
- **E7-3（待人，不改行为）**：仓库级钩子作用于**本仓库的所有 Claude Code 会话**：① 不带 `[1m]` 且配置表里没有窗口的模型（现测本仓库最近 40 份 transcript 里 12 份是 haiku sdk-cli 会话）每次工具调用都会被注入 `no reading`（spec §4 要求每次都报，行为正确）；② 没有 `node_modules` 的 checkout 每次都报钩子错误。**是否在 `.orca/level.json` 登记其它模型的窗口，由人定**；收尾报告列入待人事项。
