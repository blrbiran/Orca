# 子系统 E 第一刀（`orca correct`）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**归属**：run `orca-dev-0382dc91`，2026-09-07。**本文件是新建文档，不是活文档的重写。**

**Goal**：实现 `orca correct` 子命令与 corrections 存储层，让**第一条真的 `overturned` 能落进目标仓库的 `.decisions/`**。

**Architecture**：三层。(1) `src/ledger/writer.ts` 新增 `appendEvents` 批量入口（`appendEvent` 变成它的单元素包装），
让「新 decision ＋ overturned」**一次落盘**，结构性消灭孤儿 decision；(2) `src/corrections/**` 新增一个用户级 JSONL 存储
（路径可由 `ORCA_CORRECTIONS_DIR` 改道、mkdir 锁、临界区内查重、显式 mode）与一套**纯派生**函数；
(3) `src/cli.ts` 挂上第五个子命令，两种模式（只记／闭环）跑**同一套只读预检**，闭环模式额外取 repo 锁、
一次落盘、并**只提交它自己写的那一个文件**。

**Tech Stack**：TypeScript (ESM, `node16` 解析) ／ Node 22 ／ vitest 2 ／ zod 3。**不新增任何依赖**
（现测 `dependencies` 只有 `zod`，`os` 字段只允许 darwin／linux）。

**Spec**：`docs/superpowers/specs/2026-09-06-corrections-store-and-writer-design.md`
⚠️ *** **读法：§14.0 推翻对照表 → §14 全文；§14 没推翻的部分，才回 §1–§13 去读。§0–§13 是已发布文本。** ***
三份评审报告：`.superpowers/sdd/2026-09-06-corrections-store-and-writer/external-review{,-2,-3}.md`。

---

## Global Constraints

**每个任务的要求都隐含包含本节。**

1. **成功判据（CLAUDE.md Rule 4）**：`rtk proxy npm run verify` **exit 0**。
   ⚠️ *** **它打印两个判据数，别混着比。** *** 开工基线（**2026-09-07 现测，观测锚点 `e2f081b`**）：
   **全仓 60 files / 317 tests**、**scheduler 档 51 / 167**。收尾期望 = 基线 ＋ 本刀新增（**收尾现测，不预写死**）。
2. **判据一律走改道后的临时目录**（CLAUDE.md Rule 17）：*** **任何触碰 corrections 存储的判据必须先把
   `process.env.ORCA_CORRECTIONS_DIR` 指到 `mkdtemp` 出来的目录，并在 `finally` 里恢复原值。** ***
   ⚠️ **一条会写进使用者真实 `~/.orca/` 的判据是不可接受的，哪怕它「只写一行」。**
3. **权限**：新建目录 mode `0o700`、新建文件 mode `0o600`，**显式给，不从 umask 继承**；
   **已存在的文件不改它的 mode**。
4. **退出码**（§14.14）：`0` 成功（含「落盘与提交都已完成」的空操作）／`1` 输入被拒（重试不会成功）／
   `3` 未预期异常／**`4` 瞬态：某把锁被别人持有**（`repo-locked`、`corrections-store-busy`）／
   **`5` 台账已落盘、提交没完成**（`ledger-commit-refused`）。
   ⚠️ **`2` 不许复用** —— 它在 `orca validate` 上已有稳定含义，且 `package.json` 的 `verify` 里有
   `|| [ $? -eq 2 ]` 在吃它。
5. **不许改既有判据。** 重构 `writer.ts` 时**先看见 `tests/ledger/writer.test.ts` 全部既有判据在重构前后都绿**；
   **任何一条变红 ⇒ 停手升人**，不许顺手改判据（CLAUDE.md Rule 9 ／ ccloop 铁律 2）。
   同样**要复跑但不改**：`tests/ledger/validateFile.test.ts` 的「允许的 downgraded 行的确切集合」那条。
6. **变异纪律**（每个任务末尾都有一步）：每条变异只在 `git clone --local` 副本里做；
   未提交的改动**先 `cat` 进副本并用 `diff` 证明逐字节相同**；*** **变异前后各取一次 `shasum -a 256`，
   不相等才算落上去了** ***；*** **红必须红在目标断言上，靠崩溃变红不算证据。** ***
7. **绝不过滤验证性跑**（CLAUDE.md Rule 14）：`grep`／`tail`／`head`／`sed` 都算过滤，管道还会吞退出码。
   **一律 `rtk proxy … > 文件 2>&1` 再整份 `cat` 读回。**
8. **注释铁律**：`src/scheduler/runId.ts` 的文档注释是**已发布文本** ⇒ Task 4 里只能**追加**一句，不许就地改。
9. **不可逆动作需人单独授权**（CLAUDE.md Rule 15）：**不 push、不建分支、不合并、不删任何分支或 worktree。**
   本刀的验收在**一次性仓库**里做，**不在本仓库的 `.decisions/` 里做**。
10. **代码与注释用英文，散文用中文**（本仓库既有约定：`src/**` 与 `tests/**` 的注释全是英文）。
11. **每完成一个任务提交一笔**，提交信息用祈使句、说清「买到了什么」，并按会话规则带 Co-Authored-By。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/ledger/writer.ts` | 新增 `appendEvents(dir, runId, events[])`；`appendEvent` 变成它的单元素包装 | **改**（§14.19 第 12 项：边界扩大到 A′ 核心） |
| `src/corrections/paths.ts` | 存储目录／文件／锁目录的路径解析 ＋ 两个 mode 常量 | 新建 |
| `src/corrections/rejection.ts` | `CorrectRejection`（带 `code` 与 `exitCode`）—— CLI 靠它把具名拒绝映射到退出码 | 新建 |
| `src/corrections/projectKey.ts` | `normalizeRemoteUrl` ＋ `projectKeyOf`（**故意不实现 ccmem 的 `path:` fallback**） | 新建 |
| `src/corrections/fields.ts` | 🔴 *** **`CORRECTION_FIELDS` —— 字段序列的唯一定义**；规范 JSON ＋ correction id ＋ fix run id 都从它来 *** | 新建 |
| `src/corrections/storeLock.ts` | store 锁：父目录递归建、锁目录非递归 mkdir、短退避、超时具名拒绝 | 新建 |
| `src/corrections/store.ts` | 读全文／查重／追加，**临界区在这里，不在命令层** | 新建 |
| `src/corrections/derive.ts` | 从 correction ＋ 原 decision 派生两行（纯函数，`at` 由调用方注入） | 新建 |
| `src/corrections/originalDecision.ts` | 在 `<repo>/.decisions/` 里按 id 找原 decision | 新建 |
| `src/corrections/gitState.ts` | 闭-3 的只读状态守卫 ＋ 闭-8 的提交（`add -- path` ＋ `commit … -- path`） | 新建 |
| `src/corrections/correct.ts` | 参数解析、模式判定、共用预检、两条模式线的编排 | 新建 |
| `src/cli.ts` | 挂 `correct` 子命令、`USAGE` 补一段、把 `CorrectRejection` 映射到退出码 | **改** |
| `tests/corrections/*.test.ts` | 本刀的判据（E1–E21） | 新建 |
| `README.md` | 第五个子命令、两种模式、六个退出码 | **改**（Task 10） |

**为什么切这么细**：`fields.ts` 单独成文件是因为 §14.11 的整条修法就是「**`by` 只能有一处定义**」——
它必须是一个变异能落在上面的、单一的具名常量。`storeLock.ts` 与 `store.ts` 分开是因为 §7.3 已经裁定
**不与 `repoLock.ts` 合并**，而锁的重试语义与存储的查重语义是两件事。

---

## 变异跑法（**每个任务的最后一步都引用本节**）

```bash
# 0) 位置：scratchpad，不在本仓库里
M=/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/<session>/scratchpad/mut
/bin/rm -rf "$M"; mkdir -p "$M"
git clone --local . "$M/copy" > "$M/clone.log" 2>&1; echo "CLONE_RC=$?"

# 1) clone 只克隆【已提交】状态。未提交的改动必须自己搬过去，并证明逐字节相同：
cat src/corrections/store.ts > "$M/copy/src/corrections/store.ts"
diff src/corrections/store.ts "$M/copy/src/corrections/store.ts" > "$M/diff.log" 2>&1; echo "DIFF_RC=$?"   # 期望 0

# 2) 变异前后各取一次 sha256 —— 不相等才算落上去了
shasum -a 256 "$M/copy/<目标文件>" > "$M/before.sha"
python3 - <<'PY'   # 或 sed -i''，但必须【整行锚点 ＋ 命中数 ==1 否则退出】
...
PY
shasum -a 256 "$M/copy/<目标文件>" > "$M/after.sha"
diff "$M/before.sha" "$M/after.sha" > /dev/null; echo "MUTATED=$?"   # 期望 1（不相等）

# 3) 在副本里跑那一条判据，整份读回，看红在哪条断言上
(cd "$M/copy" && npx vitest run <判据文件> -t '<判据名>') > "$M/red.log" 2>&1; echo "RC=$?"
cat "$M/red.log"

# 4) 用完删副本前，先证明「副本的判据文件 vs 工作树的判据文件」零差异
diff "$M/copy/tests/corrections/<file>.test.ts" tests/corrections/<file>.test.ts > /dev/null; echo "SAME=$?"
/bin/rm -rf "$M"
```

⚠️ **本机 `rm` 与 `cp` 都有 `-i` alias** ⇒ **一律 `/bin/rm -rf` 与 `cat pristine > target`**，
否则会静默挂在确认提示上直到超时。
⚠️ **代码改了以后，之前跑过的变异要重跑。**

---
### Task 1: `appendEvents` —— 让闭环成为**一次落盘**

**为什么第一个做**：§14.1 的整条修法（C1 ／ I8 ／ I9 三条一起消掉）都建立在它上面，
而它是唯一会动 A′ 核心（`src/ledger/writer.ts`）的一步 —— **先把它做完并看见既有判据全绿，后面才敢往上盖东西。**

**Files:**
- Modify: `src/ledger/writer.ts`（`appendEvent` 变成 `appendEvents` 的单元素包装）
- Test: `tests/ledger/appendEvents.test.ts`（**新文件**；`tests/ledger/writer.test.ts` 一个字节不改）

**Interfaces:**
- Produces: `export async function appendEvents(decisionsDir: string, runId: string, events: unknown[]): Promise<void>`
  —— 契约：空批抛错；逐条过 Check A ＋ `validateLine`；Check B 同时查**批内**与**批与文件之间**；
  separator 只在**整批最前面**加一次；前瞻校验拿 `existingText ＋ 整批 payload` 一起过一次 `validateFile`；
  **一次 `appendFile`**。
- Produces: `appendEvent` 签名与行为**逐字不变**（既有调用方与既有判据都不动）。

- [ ] **Step 1: 先看见既有判据是绿的（重构前的基准）**

```bash
rtk proxy npx vitest run tests/ledger/writer.test.ts > /tmp/w-before.log 2>&1; echo "RC=$?"; cat /tmp/w-before.log
```
期望：**PASS**。把 `Tests  N passed` 那一行抄下来 —— Step 6 要拿它逐条比。

- [ ] **Step 2: 写失败判据**

创建 `tests/ledger/appendEvents.test.ts`：

```ts
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendEvents } from "../../src/ledger/writer.js";

function validDecision(id: string, overrides: Record<string, unknown> = {}) {
  return {
    ev: "decision",
    id,
    at: "2026-09-07T00:00:00.000Z",
    run: id.split("/")[0],
    question: "用哪种锁",
    chose: "文件租约",
    alternatives: [{ option: "进程内互斥", why_not: "跨进程无效" }],
    because: "跨进程",
    undo: { how: "git revert <ref>", cost: "一次重跑", blast_radius: "仅本仓库" },
    scope: "repo",
    kind: "interface",
    ...overrides,
  };
}

function overturnedFor(id: string, replacedBy: string, run: string) {
  return {
    ev: "overturned",
    id,
    correctionId: "c_deadbeefdeadbeef",
    replacedBy,
    at: "2026-09-07T00:00:00.000Z",
    run,
  };
}

const tempDir = () => mkdtemp(join(tmpdir(), "orca-batch-"));

describe("appendEvents (spec §14.1)", () => {
  // The positive observation the two "nothing happened" criteria below need:
  // without it, deleting the whole function would leave them both green.
  it("lands a decision and the overturned that replaces it in one file, in order", async () => {
    const dir = await tempDir();
    await appendEvents(dir, "fx", [validDecision("fx/1"), overturnedFor("fx/1", "fx/1", "fx")]);

    const lines = (await readFile(join(dir, "fx.jsonl"), "utf8")).split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]).ev).toBe("decision");
    expect(JSON.parse(lines[1]).ev).toBe("overturned");
    expect(lines[2]).toBe("");
  });

  // E9b — interface-contract criterion (registered §14.19 item 18: no product
  // caller can produce an empty batch, so this does NOT count as coverage of
  // C1/I8/I9). An empty batch's payload would be nothing but the separator,
  // which appends a lone "\n" to a file with no trailing newline.
  it("refuses an empty batch", async () => {
    const dir = await tempDir();
    await expect(appendEvents(dir, "fx", [])).rejects.toThrow(/empty batch/);
    expect(existsSync(join(dir, "fx.jsonl"))).toBe(false);
  });

  // E18b — interface-contract criterion (same registration).
  it("refuses a batch that carries the same decision id twice", async () => {
    const dir = await tempDir();
    await expect(
      appendEvents(dir, "fx", [validDecision("fx/1"), validDecision("fx/1", { question: "别的" })]),
    ).rejects.toThrow(/duplicate decision id "fx\/1"/);
    expect(existsSync(join(dir, "fx.jsonl"))).toBe(false);
  });

  // E18 — THE central claim of §14.1: there is no state in which the decision
  // was written and the overturned was not. The second event is rejected
  // (replacedBy resolves to nothing), so the file must not exist at all.
  it("writes nothing when the second event of the batch is rejected", async () => {
    const dir = await tempDir();
    await expect(
      appendEvents(dir, "fx", [validDecision("fx/1"), overturnedFor("fx/1", "fx/999", "fx")]),
    ).rejects.toThrow(/replacedBy/);
    expect(existsSync(join(dir, "fx.jsonl"))).toBe(false);
  });

  // E9 (ledger half): a target repo's ledger legitimately has no trailing
  // newline (spec §9.2 Fix 2). appendFile only concatenates bytes.
  it("does not glue the batch onto a file that has no trailing newline", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "fx.jsonl"), JSON.stringify(validDecision("fx/1")));

    await appendEvents(dir, "fx", [validDecision("fx/2"), overturnedFor("fx/1", "fx/2", "fx")]);

    const lines = (await readFile(join(dir, "fx.jsonl"), "utf8")).split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });
});
```

- [ ] **Step 3: 跑它，确认它红**

```bash
rtk proxy npx vitest run tests/ledger/appendEvents.test.ts > /tmp/t1-red.log 2>&1; echo "RC=$?"; cat /tmp/t1-red.log
```
期望：**FAIL**，五条都红在 `appendEvents is not a function`（导出还不存在）。

- [ ] **Step 4: 实现**

把 `src/ledger/writer.ts` 的 `appendEvent` 改写成下面这样（**注释是新写的，不是从别处搬的**；
原函数体的每一段注释原样保留在新函数里，只在必要处补一句说明「批」的含义）：

```ts
export async function appendEvents(
  decisionsDir: string,
  runId: string,
  events: unknown[],
): Promise<void> {
  // spec §14.1: an empty batch's payload would be nothing but the separator,
  // which appends a lone newline to a file that had none. Refusing is not
  // defensive programming — it is the only shape of this call that can
  // corrupt a ledger while reporting success.
  if (events.length === 0) {
    throw new Error("refusing to append: empty batch");
  }

  if (!RUN_ID.test(runId)) {
    throw new Error(`invalid run id: ${JSON.stringify(runId)}`);
  }

  const lines: string[] = [];
  for (const event of events) {
    // Check A (unchanged): a decision's run field must name the file it lands in.
    const evName = (event as { ev?: unknown }).ev;
    const run = (event as { run?: unknown }).run;
    if ((evName === "decision" || evName === "overturned") && run !== runId) {
      throw new Error(
        `refusing to append: run field ${JSON.stringify(run)} does not match the ledger file for run ${JSON.stringify(runId)}`,
      );
    }

    const line = JSON.stringify(event);
    const result = validateLine(line);
    if (result.verdict === "rejected") {
      throw new Error(`refusing to append: rejected: ${result.reasons.join("; ")}`);
    }
    if (result.verdict === "downgraded") {
      throw new Error(
        `refusing to append: downgraded to tier 0, this decision is not the agent's to make: ${result.reasons.join("; ")}`,
      );
    }
    lines.push(line);
  }

  const filePath = join(decisionsDir, `${runId}.jsonl`);
  const existingText = await readFile(filePath, "utf8").catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  });

  // Check B, now over two scopes rather than one: the batch against the file,
  // AND the batch against itself. The second scope is new and has no product
  // caller (registered, spec §14.19 item 18) — it exists because a batch is
  // written in one appendFile, so a duplicate inside it could never be caught
  // by the file-scoped pass that runs before the write.
  const fileDecisionIds = new Set<string>();
  for (const existing of existingText.split("\n")) {
    if (existing.trim().length === 0) continue;
    try {
      const parsedExisting = JSON.parse(existing) as { ev?: unknown; id?: unknown };
      if (parsedExisting.ev === "decision" && typeof parsedExisting.id === "string") {
        fileDecisionIds.add(parsedExisting.id);
      }
    } catch {
      // A line that does not parse is validateFile's problem, not this check's.
      continue;
    }
  }
  const batchDecisionIds = new Set<string>();
  for (const event of events) {
    if ((event as { ev?: unknown }).ev !== "decision") continue;
    const id = (event as { id?: unknown }).id;
    if (fileDecisionIds.has(id as string) || batchDecisionIds.has(id as string)) {
      throw new Error(`refusing to append: duplicate decision id ${JSON.stringify(id)}`);
    }
    batchDecisionIds.add(id as string);
  }

  // Separator: once, in front of the whole batch. Inside the batch the lines
  // are joined by a newline, so `payload` is again exactly (a) what check 5 is
  // validated against and (b) what lands on disk.
  const separator = existingText.length > 0 && !existingText.endsWith("\n") ? "\n" : "";
  const payload = `${separator}${lines.join("\n")}\n`;

  const externalDecisionIds = new Set<string>();
  const siblings = await readdir(decisionsDir).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [] as string[];
    throw error;
  });
  for (const name of siblings) {
    if (!name.endsWith(".jsonl") || name === `${runId}.jsonl`) continue;
    const siblingText = await readFile(join(decisionsDir, name), "utf8");
    for (const raw of siblingText.split("\n")) {
      if (raw.trim().length === 0) continue;
      try {
        const parsedSibling = JSON.parse(raw) as { ev?: unknown; id?: unknown };
        if (parsedSibling.ev === "decision" && typeof parsedSibling.id === "string") {
          externalDecisionIds.add(parsedSibling.id);
        }
      } catch {
        // An unparseable line in someone else's ledger is not this append's problem.
      }
    }
  }

  const prospective = validateFile((existingText + payload).split("\n"), { externalDecisionIds });
  if (prospective.verdict !== "ok") {
    const reasons = prospective.lines
      .filter((l) => l.result.verdict !== "ok")
      .flatMap((l) => (l.result.verdict === "ok" ? [] : l.result.reasons));
    throw new Error(`refusing to append: ${prospective.verdict}: ${reasons.join("; ")}`);
  }

  await mkdir(decisionsDir, { recursive: true });
  await appendFile(filePath, payload);
}

/**
 * The single-event entry point, kept as a one-line wrapper rather than a
 * parallel implementation: a hand-copied second copy of the checks above is
 * exactly the drift this repository has already paid for once (see RUN_ID's
 * comment). Measured before the refactor and again after: every criterion in
 * tests/ledger/writer.test.ts observes this path unchanged, and a
 * single-element batch produces byte-identical payload bytes.
 */
export async function appendEvent(
  decisionsDir: string,
  runId: string,
  event: unknown,
): Promise<void> {
  await appendEvents(decisionsDir, runId, [event]);
}
```

⚠️ **`appendEvent` 原有的整段注释不要删** —— 把它们**随对应的代码段一起搬进 `appendEvents`**。
那些注释记的是 Check A／Check B／separator／外部 id 扫描各自**为什么存在**，
删掉等于把三轮评审买来的理由丢了。

- [ ] **Step 5: 跑新判据，确认它绿**

```bash
rtk proxy npx vitest run tests/ledger/appendEvents.test.ts > /tmp/t1-green.log 2>&1; echo "RC=$?"; cat /tmp/t1-green.log
```
期望：**5 passed**。

- [ ] **Step 6: 🔴 确认既有判据在重构前后都绿**

```bash
rtk proxy npx vitest run tests/ledger > /tmp/t1-ledger.log 2>&1; echo "RC=$?"; cat /tmp/t1-ledger.log
```
期望：`tests/ledger/writer.test.ts` 的通过条数**与 Step 1 抄下来的那个数逐字相同**，
且 `tests/ledger/validateFile.test.ts` 的「允许的 downgraded 行的确切集合」那条仍绿。
⚠️ *** **任何一条变红 ⇒ 停手升人，不许顺手改判据。** ***

- [ ] **Step 7: 跑变异（按「变异跑法」一节）**

| 变异 | 落点 | 期望红在 |
|---|---|---|
| 删掉 `if (events.length === 0) throw` | `writer.ts` | `refuses an empty batch` 的 `rejects.toThrow` |
| 把末尾改成 `for (const line of lines) await appendFile(filePath, …)`（每事件一次 append） | `writer.ts` | `writes nothing when the second event of the batch is rejected` 的 `existsSync === false`（**E18 的中心主张**） |
| 删掉 `batchDecisionIds` 那一格判断 | `writer.ts` | `refuses a batch that carries the same decision id twice` |
| 把 `separator` 写死成 `""` | `writer.ts` | `does not glue the batch onto a file…` 的 `JSON.parse` 不抛 |

⚠️ **第二条变异要小心**：per-event `appendFile` 必须**在前瞻校验之后**才落，否则它红在别的地方。
变异的写法是**只把最后那一句 `appendFile(filePath, payload)` 换成循环**，其余一行不动。

- [ ] **Step 8: 提交**

```bash
git add src/ledger/writer.ts tests/ledger/appendEvents.test.ts
git commit -m "$(cat <<'MSG'
feat(ledger): append a batch in one write, so a closed loop has no half-written state

MSG
)"
```
（提交信息正文说清：这一步买到的是「不存在『decision 写了、overturned 没写』这个中间状态」，
并注明 E9b／E18b 是接口契约判据、不计入 C1／I8／I9 的覆盖。按会话规则带 Co-Authored-By。）

---

### Task 2: `projectKey` —— 与 ccmem 逐字相同的那把键

**Files:**
- Create: `src/corrections/projectKey.ts`
- Create: `src/corrections/rejection.ts`
- Test: `tests/corrections/projectKey.test.ts`

**Interfaces:**
- Produces: `export function normalizeRemoteUrl(remote: string): string`
- Produces: `export const TARGET_HAS_NO_REMOTE = "target-has-no-remote"`
- Produces: `export async function projectKeyOf(repo: string): Promise<string>` —— 取不到 remote ⇒ 抛 `CorrectRejection`
- Produces: `export class CorrectRejection extends Error { code: string; exitCode: 1 | 4 | 5 }`
- Consumes: 无（Task 1 与它无关）

- [ ] **Step 1: 写失败判据**

创建 `tests/corrections/projectKey.test.ts`：

```ts
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { CorrectRejection } from "../../src/corrections/rejection.js";
import { TARGET_HAS_NO_REMOTE, normalizeRemoteUrl, projectKeyOf } from "../../src/corrections/projectKey.js";

const execFileAsync = promisify(execFile);

async function repoWithRemote(remote?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "orca-pk-"));
  await execFileAsync("git", ["init"], { cwd: dir });
  if (remote !== undefined) {
    await execFileAsync("git", ["remote", "add", "origin", remote], { cwd: dir });
  }
  return dir;
}

describe("projectKey (spec §2.3, ruling 5)", () => {
  // E1a. ⚠️ The mutation for this one does NOT delete the git@ branch:
  // deleting it sends "git@host:p.git" into new URL(), which throws, and a
  // criterion that goes red on a crash proves nothing about the string.
  it("turns an scp-style remote into host/path", () => {
    expect(normalizeRemoteUrl("git@github.com:biran/orca.git")).toBe("github.com/biran/orca");
  });

  // E1b
  it("turns an https remote into host/path and strips .git", () => {
    expect(normalizeRemoteUrl("https://github.com/biran/orca.git")).toBe("github.com/biran/orca");
  });

  // The drift risk registered in spec §9 item 4 made concrete: these are the
  // exact outputs ccmem's scripts/lib/project-key.mjs produces for the same
  // two inputs (read 2026-09-07, not executed — ccmem is not a runtime
  // dependency, ruling 5). If ccmem changes its normaliser, cross-project
  // aggregation silently splits and nothing here goes red; that is the
  // accepted cost, named here so the next reader finds it.
  it("keeps a trailing .git only when it is not the suffix", () => {
    expect(normalizeRemoteUrl("git@github.com:biran/orca.github")).toBe("github.com/biran/orca.github");
  });

  // E2. ⚠️ Message asserted BEFORE the code: an earlier assertion short-circuits
  // the later ones, so what this criterion measures has to come first.
  it("refuses a target with no remote instead of falling back to a path key", async () => {
    const dir = await repoWithRemote();
    const error = await projectKeyOf(dir).then(
      () => { throw new Error("projectKeyOf resolved, but this target has no remote"); },
      (e: unknown) => e,
    );
    expect((error as Error).message).toContain("has no remote");
    expect(error).toBeInstanceOf(CorrectRejection);
    expect((error as CorrectRejection).code).toBe(TARGET_HAS_NO_REMOTE);
    expect((error as CorrectRejection).exitCode).toBe(1);
    // ccmem's fallback shape, which this deliberately does not implement.
    expect((error as Error).message).not.toContain("path:");
  });

  it("reads the remote out of a real repository", async () => {
    const dir = await repoWithRemote("https://github.com/biran/orca.git");
    expect(await projectKeyOf(dir)).toBe("github.com/biran/orca");
  });
});
```

⚠️ *** **拿 rejection 一律用 `.then(onFulfilled, onRejected)` 并在 onFulfilled 里 throw** ***
—— 不要用 `.catch(e => e)`：promise 成功时它给出 `undefined`，会让后面三条断言全在断言 `undefined`
（ccloop 实测栽过一次）。

- [ ] **Step 2: 跑它，确认它红**

```bash
rtk proxy npx vitest run tests/corrections/projectKey.test.ts > /tmp/t2-red.log 2>&1; echo "RC=$?"; cat /tmp/t2-red.log
```
期望：**FAIL**（模块不存在）。

- [ ] **Step 3: 实现**

`src/corrections/rejection.ts`：

```ts
/**
 * A named refusal `orca correct` can make, carrying the exit code the CLI
 * should answer with. Spec §14.14: 1 = the input is wrong and retrying will
 * not help; 4 = someone else holds a lock (transient, retry later); 5 = the
 * ledger is on disk but the commit did not happen (re-run the same --close).
 *
 * 3 is deliberately NOT in the union: it is what cli.ts's top-level arm
 * answers for an exception nobody anticipated, and a rejection that named
 * itself 3 would be claiming the opposite of what it knows.
 * 2 is deliberately not reusable either — `orca validate` already answers 2
 * for a downgraded ledger and `package.json`'s verify script tolerates it.
 */
export type CorrectExitCode = 1 | 4 | 5;

export class CorrectRejection extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly exitCode: CorrectExitCode = 1,
  ) {
    super(message);
    this.name = "CorrectRejection";
  }
}
```

`src/corrections/projectKey.ts`：

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CorrectRejection } from "./rejection.js";

const execFileAsync = promisify(execFile);

/**
 * A byte-for-byte port of ccmem's scripts/lib/project-key.mjs (read
 * 2026-09-07; ccmem is NOT called at runtime — ruling 5 of spec §1). The two
 * regexes are copied verbatim on purpose: this key has to equal the key ccmem
 * derives for the same repository, or cross-project aggregation splits in two
 * without anything failing. The drift risk that copying creates is registered
 * in spec §9 item 4 rather than papered over.
 *
 * ⚠️ ccmem's third branch — the `path:<sha256(cwd)>` fallback for a directory
 * with no remote — is deliberately NOT ported. Upstream spec §4.1 item 3 says
 * a target with no remote URL cannot produce a correction at all, so orca
 * never reaches that branch; implementing it would silently create rows keyed
 * by a local path that no other machine can resolve.
 */
export function normalizeRemoteUrl(remote: string): string {
  if (remote.startsWith("git@")) {
    const match = remote.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
    if (match) {
      const [, host, repo] = match;
      return `${host}/${repo}`;
    }
  }

  const url = new URL(remote);
  return `${url.hostname}${url.pathname.replace(/\.git$/, "")}`;
}

export const TARGET_HAS_NO_REMOTE = "target-has-no-remote";

/**
 * ⚠️ `git config --get remote.origin.url`, not `git remote get-url origin` —
 * the former is what ccmem runs, and the two disagree on repositories where
 * `insteadOf` rewriting is configured.
 */
export async function projectKeyOf(repo: string): Promise<string> {
  const remote = await execFileAsync("git", ["config", "--get", "remote.origin.url"], { cwd: repo })
    .then(({ stdout }) => stdout.trim())
    .catch(() => "");

  if (remote.length === 0) {
    throw new CorrectRejection(
      TARGET_HAS_NO_REMOTE,
      `${repo} has no remote: a correction is keyed by the repository's remote URL (the same key ccmem indexes by), ` +
        `and there is nothing to derive it from here`,
    );
  }

  return normalizeRemoteUrl(remote);
}
```

- [ ] **Step 4: 跑它，确认它绿**

```bash
rtk proxy npx vitest run tests/corrections/projectKey.test.ts > /tmp/t2-green.log 2>&1; echo "RC=$?"; cat /tmp/t2-green.log
```

- [ ] **Step 5: 跑变异**

| 变异 | 落点 | 期望红在 |
|---|---|---|
| **E1a**：把 `git@` 分支的 `return \`${host}/${repo}\`` 改成 `return \`${host}:${repo}\``（**别删这个分支**） | `projectKey.ts` | `turns an scp-style remote into host/path` 的**字符串比较** |
| **E1b**：删掉 `.replace(/\.git$/, "")` | `projectKey.ts` | `turns an https remote into host/path and strips .git` |
| **E2**：删掉 `if (remote.length === 0) throw` 那道守卫 | `projectKey.ts` | `refuses a target with no remote…` 的**第一条消息断言** |

- [ ] **Step 6: 提交**

```bash
git add src/corrections/projectKey.ts src/corrections/rejection.ts tests/corrections/projectKey.test.ts
git commit -m "feat(corrections): derive the same project key ccmem does, and refuse a target with no remote"
```

---
### Task 3: 存储路径与 store 锁

**Files:**
- Create: `src/corrections/paths.ts`
- Create: `src/corrections/storeLock.ts`
- Test: `tests/corrections/storeLock.test.ts`

**Interfaces:**
- Consumes: `CorrectRejection`（Task 2）
- Produces: `correctionsDir(env?)` / `correctionsFile(dir)` / `storeLockDir(dir)` /
  `CORRECTIONS_DIR_MODE = 0o700` / `CORRECTIONS_FILE_MODE = 0o600`
- Produces: `CORRECTIONS_STORE_BUSY = "corrections-store-busy"` / `STORE_LOCK_TIMEOUT_MS = 1_000` /
  `acquireStoreLock(dir, timeoutMs?): Promise<StoreLock>` / `withStoreLock<T>(dir, fn): Promise<T>`

- [ ] **Step 1: 写失败判据**

创建 `tests/corrections/storeLock.test.ts`：

```ts
import { existsSync } from "node:fs";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CorrectRejection } from "../../src/corrections/rejection.js";
import { CORRECTIONS_DIR_MODE, storeLockDir } from "../../src/corrections/paths.js";
import { CORRECTIONS_STORE_BUSY, acquireStoreLock } from "../../src/corrections/storeLock.js";

const tempDir = () => mkdtemp(join(tmpdir(), "orca-lock-"));

describe("corrections store lock (spec §7.2 / §7.3 / §14.8)", () => {
  // §14.8 (I3): repoLock's non-recursive mkdir is safe only because
  // <repo>/.git is guaranteed to exist. ORCA_CORRECTIONS_DIR is not — on a
  // fresh machine the very first `orca correct` used to die on
  // "ENOENT: … mkdir '…/.orca/.corrections-lock'".
  it("creates the store directory before the lock directory inside it", async () => {
    const parent = await tempDir();
    const dir = join(parent, "nested", ".orca");
    const lock = await acquireStoreLock(dir);
    try {
      expect(existsSync(storeLockDir(dir))).toBe(true);
    } finally {
      await lock.release();
    }
  });

  // E7: exclusive, and the second attempt does NOT overwrite the first's info.
  it("refuses a second holder and leaves the first holder's info intact", async () => {
    const dir = await tempDir();
    const first = await acquireStoreLock(dir);
    try {
      const infoBefore = await readFile(join(storeLockDir(dir), "info"), "utf8");
      const error = await acquireStoreLock(dir, 60).then(
        () => { throw new Error("acquired a lock someone else already holds"); },
        (e: unknown) => e,
      );
      expect((error as Error).message).toContain(storeLockDir(dir));
      expect((error as CorrectRejection).code).toBe(CORRECTIONS_STORE_BUSY);
      expect(await readFile(join(storeLockDir(dir), "info"), "utf8")).toBe(infoBefore);
    } finally {
      await first.release();
    }
  });

  // E8: the timeout is a named rejection with exit 4, and the message carries
  // what a person needs to go find the holder — the lock path and the pid.
  it("times out with a named rejection carrying the lock path and the holder's pid", async () => {
    const dir = await tempDir();
    const first = await acquireStoreLock(dir);
    try {
      const error = await acquireStoreLock(dir, 60).then(
        () => { throw new Error("acquired a lock someone else already holds"); },
        (e: unknown) => e,
      );
      expect((error as Error).message).toContain(`pid ${process.pid}`);
      expect((error as Error).message).toContain(storeLockDir(dir));
      expect((error as CorrectRejection).code).toBe(CORRECTIONS_STORE_BUSY);
      expect((error as CorrectRejection).exitCode).toBe(4);
    } finally {
      await first.release();
    }
  });

  it("releases so the next holder can take it, and releasing twice is not an error", async () => {
    const dir = await tempDir();
    const first = await acquireStoreLock(dir);
    await first.release();
    await first.release();
    const second = await acquireStoreLock(dir);
    await second.release();
    expect(existsSync(storeLockDir(dir))).toBe(false);
  });

  // E17 (directory half). ⚠️ umask is pinned explicitly and RESTORED: without
  // pinning, a machine whose umask is 077 gets 0700 for free and the mutation
  // that removes the mode argument stays green; without restoring, every later
  // criterion in this same process inherits the changed umask.
  it("creates the store directory 0700 whatever the umask is", async () => {
    const parent = await tempDir();
    const dir = join(parent, ".orca");
    const previousUmask = process.umask(0o022);
    try {
      const lock = await acquireStoreLock(dir);
      await lock.release();
      expect((await stat(dir)).mode & 0o777).toBe(CORRECTIONS_DIR_MODE);
    } finally {
      process.umask(previousUmask);
    }
  });
});
```

- [ ] **Step 2: 跑它，确认它红**（模块不存在）

```bash
rtk proxy npx vitest run tests/corrections/storeLock.test.ts > /tmp/t3-red.log 2>&1; echo "RC=$?"; cat /tmp/t3-red.log
```

- [ ] **Step 3: 实现 `src/corrections/paths.ts`**

```ts
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * spec §4 + CLAUDE.md Rule 17. The environment variable is not a convenience:
 * without it every criterion in this subsystem would write into the developer's
 * real ~/.orca. A criterion that touches a person's actual user data is
 * unacceptable even if it only writes one line.
 *
 * ⚠️ os.homedir(), never the literal "~" — node does not expand it, so the
 * shell spelling would create a directory whose name really is "~".
 */
export function correctionsDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.ORCA_CORRECTIONS_DIR;
  if (override !== undefined && override.length > 0) return override;
  return join(homedir(), ".orca");
}

export const correctionsFile = (dir: string): string => join(dir, "corrections.jsonl");
export const storeLockDir = (dir: string): string => join(dir, ".corrections-lock");

/**
 * spec §14.17. Given explicitly, never inherited from the umask — this is user
 * data outside any repository. Existing files' modes are left alone: they are a
 * person's, and changing them is a decision this program does not get to make.
 */
export const CORRECTIONS_DIR_MODE = 0o700;
export const CORRECTIONS_FILE_MODE = 0o600;
```

- [ ] **Step 4: 实现 `src/corrections/storeLock.ts`**

```ts
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CORRECTIONS_DIR_MODE, CORRECTIONS_FILE_MODE, storeLockDir } from "./paths.js";
import { CorrectRejection } from "./rejection.js";

export const CORRECTIONS_STORE_BUSY = "corrections-store-busy";

/**
 * spec §7.3: unlike the repo lock — which covers a whole round and is refused
 * outright — this one covers a single append and should retry briefly rather
 * than make a person re-type the command. About a second, then a named
 * refusal. Stale recovery is deliberately NOT done here either: guessing that
 * a pid is dead is exactly the kind of guess repoLock.ts refuses to make. What
 * this gives a person instead is an executable way out — the message says
 * which directory to look at and who claims to hold it.
 */
export const STORE_LOCK_TIMEOUT_MS = 1_000;
const RETRY_INTERVAL_MS = 25;

export interface StoreLock {
  release(): Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function acquireStoreLock(
  dir: string,
  timeoutMs: number = STORE_LOCK_TIMEOUT_MS,
): Promise<StoreLock> {
  // §14.8: the PARENT is created recursively (it may not exist at all on a
  // fresh machine); the lock directory itself stays non-recursive, because
  // that is the entire mutual-exclusion mechanism — a recursive mkdir succeeds
  // against a directory that already exists and would hand two processes the
  // same lock. `flock` was not chosen for the reason repoLock.ts records: it
  // degrades to a no-op on platforms without fcntl, and Rule 12 does not allow
  // a silent degradation.
  await mkdir(dir, { recursive: true, mode: CORRECTIONS_DIR_MODE });

  const lockDir = storeLockDir(dir);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await mkdir(lockDir);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (Date.now() >= deadline) {
        const info = await readFile(join(lockDir, "info"), "utf8").catch(() => "(no info file)");
        throw new CorrectRejection(
          CORRECTIONS_STORE_BUSY,
          `another process holds the corrections store lock (${lockDir}) — it says: ${info.trim()}`,
          4,
        );
      }
      await sleep(RETRY_INTERVAL_MS);
    }
  }

  await writeFile(join(lockDir, "info"), `pid ${process.pid}\nacquired ${new Date().toISOString()}\n`, {
    mode: CORRECTIONS_FILE_MODE,
  });

  let released = false;
  return {
    release: async () => {
      if (released) return;
      released = true;
      await rm(lockDir, { recursive: true, force: true });
    },
  };
}

/**
 * The critical section as one shape, so that every caller releases in a
 * `finally` by construction rather than by remembering to. §14.3 (second
 * seat, C-B) is the reason this is not left to call sites: a release written
 * as the last statement is skipped by every rejection in front of it, and the
 * rejections here are the EXPECTED path.
 */
export async function withStoreLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const lock = await acquireStoreLock(dir);
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}
```

- [ ] **Step 5: 跑它，确认它绿**

- [ ] **Step 6: 跑变异**

| 变异 | 落点 | 期望红在 |
|---|---|---|
| 把 `await mkdir(lockDir)` 改成 `await mkdir(lockDir, { recursive: true })` | `storeLock.ts` | `refuses a second holder…`（互斥没了，第二次直接成功） |
| **E8**：超时那一支改成 `return { release: async () => {} }`（静默放行） | `storeLock.ts` | `times out with a named rejection…` 的**消息断言** |
| **E17**：去掉 `mkdir(dir, { recursive: true, mode: … })` 的 `mode` | `storeLock.ts` | `creates the store directory 0700 whatever the umask is` |
| 把父目录的 `recursive: true` 去掉 | `storeLock.ts` | `creates the store directory before the lock directory inside it`（ENOENT） |

⚠️ **E7 的 spec 点名变异「删掉取锁」落在调用点上，不在本模块** —— 它在 Task 5 跑。

- [ ] **Step 7: 提交**

```bash
git add src/corrections/paths.ts src/corrections/storeLock.ts tests/corrections/storeLock.test.ts
git commit -m "feat(corrections): put the store behind a lock that says who holds it and times out by name"
```

---

### Task 4: 字段序列的**唯一定义** —— correction id 与 fix run id

🔴 **本任务是 §14.11 的整条修法**：第三席实测发现 `by` **经由两条路**进入 run id 的派生
（规范 JSON 一条、correction id 一条），所以「从规范 JSON 里删掉 `by`」这条变异**没有落点** ——
删了它 run id 照样不同，E6 照绿。**处置是让两条路共用一处具名常量。**

⚠️ **一处必须记在台账里的判断**：spec §4 把 correction id 写成
`sha256(projectKey|decisionId|at|because|by)` 前 16 位，而 §14.0 的对照表把「§4 correction id 的字段序列」
**改为与 run id 共用一处具名常量**。本计划据此把 id 的派生输入改为**规范 JSON 本身**
（覆盖 `CORRECTION_FIELDS` 的全部字段，含 `kind` 与 `chose_instead`）。
**理由**：§14.11 的结论句写的是 *** 「run id 是【整条 correction 行】与【它的 id】的函数」*** ——
要让「整条行」与「id」共用一处定义，只有把两者都建立在同一个规范 JSON 上；
若 id 仍只取 5 个字段的管道拼接，那就还是**两处定义**，而两处定义正是这条修法要消灭的东西。
⚠️ **实施者：这一条要写进本轮台账，并在 `fields.ts` 的注释里指名它推翻了 §4 的字面公式。**

**Files:**
- Create: `src/corrections/fields.ts`
- Modify: `src/scheduler/runId.ts`（**只追加一句文档注释，不改行为**）
- Test: `tests/corrections/fields.test.ts`

**Interfaces:**
- Consumes: `deriveRunId`（`src/scheduler/runId.ts`，既有）、`Correction`（`src/corrections/schema.ts`，既有）
- Produces: `CORRECTION_FIELDS` / `canonicalCorrectionJson(row)` / `deriveCorrectionId(row)` /
  `deriveFixRunId(row, correctionId)` / `type CorrectionRow = Omit<Correction, "id">`

- [ ] **Step 1: 写失败判据**

创建 `tests/corrections/fields.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import {
  CORRECTION_FIELDS,
  canonicalCorrectionJson,
  deriveCorrectionId,
  deriveFixRunId,
} from "../../src/corrections/fields.js";
import type { CorrectionRow } from "../../src/corrections/fields.js";

const row = (overrides: Partial<CorrectionRow> = {}): CorrectionRow => ({
  projectKey: "github.com/biran/orca",
  decisionId: "orca-dev-1/1",
  kind: "not_my_taste",
  chose_instead: "改用文件租约",
  because: "进程内互斥跨进程无效",
  at: "2026-09-07T00:00:00.000Z",
  by: "amy",
  ...overrides,
});

describe("correction id and fix run id (spec §14.11)", () => {
  it("derives the same id from the same row, every time", () => {
    expect(deriveCorrectionId(row())).toBe(deriveCorrectionId(row()));
    expect(deriveCorrectionId(row())).toMatch(/^c_[0-9a-f]{16}$/);
  });

  it("shapes the fix run id the way the scheduler shapes every other run id", () => {
    expect(deriveFixRunId(row(), deriveCorrectionId(row()))).toMatch(/^orca-fix-[0-9a-f]{8}$/);
  });

  // 🔴 THE invariant A' §3.1 rests on, at unit level: two people correcting
  // the same decision must not write the same file. `by` is the field that
  // makes their rows differ, and it reaches the run id by two routes — through
  // the canonical JSON, and through the correction id that is the run id's
  // third input. Both routes are fed by CORRECTION_FIELDS, which is why
  // removing `by` from that one constant is a mutation with a single landing
  // point (E6 in Task 9 is the command-level half of this).
  it("makes both the correction id and the run id depend on who wrote the row", () => {
    const amy = row({ by: "amy" });
    const bob = row({ by: "bob" });
    expect(deriveCorrectionId(bob)).not.toBe(deriveCorrectionId(amy));
    expect(deriveFixRunId(bob, deriveCorrectionId(bob))).not.toBe(
      deriveFixRunId(amy, deriveCorrectionId(amy)),
    );
  });

  it("serialises the fields in the declared order and omits the absent optional one", () => {
    const withoutAlternative = row({ kind: "wrong", chose_instead: undefined });
    const parsed = Object.keys(JSON.parse(canonicalCorrectionJson(withoutAlternative)));
    expect(parsed).not.toContain("chose_instead");
    expect(parsed).toEqual(CORRECTION_FIELDS.filter((f) => f !== "chose_instead"));
  });
});
```

- [ ] **Step 2: 跑它，确认它红**

- [ ] **Step 3: 实现 `src/corrections/fields.ts`**

```ts
import { createHash } from "node:crypto";
import { deriveRunId } from "../scheduler/runId.js";
import type { Correction } from "./schema.js";

/** A correction row before its id exists — the id is a function of everything else. */
export type CorrectionRow = Omit<Correction, "id">;

/**
 * 🔴 The ONE definition of which fields identify a correction, and in what
 * order. Both derivations below read it: the correction id (a hash of the
 * canonical JSON) and the fix run id (deriveRunId over the canonical JSON,
 * keyed by that same correction id).
 *
 * Why one constant and not two: `by` reaches the run id by TWO routes — the
 * canonical JSON, and the correction id that is deriveRunId's third argument.
 * With two definitions, deleting `by` from one of them leaves the other
 * intact, both run ids still differ, and the criterion that is supposed to
 * pin "two people never write the same ledger file" cannot be made to go red
 * by any mutation at all (measured by the third review seat). One constant is
 * what gives that mutation a single place to land.
 *
 * ⚠️ This supersedes spec §4's literal formula
 * `sha256(projectKey|decisionId|at|because|by)`: §14.0's table changes the id's
 * field sequence to "the same named constant the run id uses", and §14.11's
 * conclusion says the run id is a function of THE WHOLE correction row plus its
 * id. Keeping a pipe-joined five-field subset for the id would have left two
 * definitions standing, which is the defect being fixed.
 */
export const CORRECTION_FIELDS = [
  "projectKey",
  "decisionId",
  "kind",
  "chose_instead",
  "because",
  "at",
  "by",
] as const;

/**
 * Field order comes from CORRECTION_FIELDS, not from the object's own key
 * order: two rows built by different code paths must hash the same.
 * An absent optional field is omitted rather than written as null, so a row
 * that never had a `chose_instead` and one that had it removed cannot exist as
 * two different byte sequences.
 */
export function canonicalCorrectionJson(row: CorrectionRow): string {
  const canonical: Record<string, unknown> = {};
  for (const field of CORRECTION_FIELDS) {
    const value = (row as Record<string, unknown>)[field];
    if (value !== undefined) canonical[field] = value;
  }
  return JSON.stringify(canonical);
}

export function deriveCorrectionId(row: CorrectionRow): string {
  const hash = createHash("sha256").update(canonicalCorrectionJson(row), "utf8");
  return `c_${hash.digest("hex").slice(0, 16)}`;
}

/**
 * spec §7.1: the run id is derived from the correction row AS STORED, never
 * from the command line. The stored row is what a later `--close` reads back,
 * so the same correction always resolves to the same ledger file — which is
 * what makes a second `--close` collide with Check B instead of quietly
 * writing a second overturned into a different file (§14.1).
 *
 * deriveRunId is reused rather than re-implemented (spec §12 finding 4): a
 * hand-copied derivation across a module boundary drifts silently. `orca-fix-`
 * is its `orca-<taskId>-<hash8>` shape with the task id "fix".
 */
export function deriveFixRunId(row: CorrectionRow, correctionId: string): string {
  return deriveRunId("fix", Buffer.from(canonicalCorrectionJson(row), "utf8"), correctionId);
}
```

- [ ] **Step 4: 给 `runId.ts` 追加一句文档注释（§14.16 第 2 条）**

⚠️ *** **`runId.ts` 的注释是已发布文本 —— 只许追加，不许就地改一个字。** ***
在 `deriveRunId` 那段文档注释的**末尾**追加：

```ts
 * ⚠️ ADDENDUM (2026-09-07, subsystem E): this function has a second caller
 * that is not a scheduled task — src/corrections/fields.ts derives a fix run
 * id as deriveRunId("fix", <the correction row's canonical JSON>, <the
 * correction id>). It passes a correction row where the doc above says
 * "contract bytes" and a correction id where it says "base commit". Nothing
 * about the behaviour changes; the shape and the guarantee ("same three
 * inputs, same output") are exactly what that caller wants. It does NOT go
 * through allocateRunId, so the EEXIST → -2/-3 escalation does not apply to
 * it: two colliding corrections would land two `<run>/1` decisions in one
 * file, which appendEvents' Check B refuses loudly (spec §14.16).
```

- [ ] **Step 5: 跑它，确认它绿；并确认 `runId.test.ts` 仍绿**

```bash
rtk proxy npx vitest run tests/corrections/fields.test.ts tests/scheduler/runId.test.ts > /tmp/t4.log 2>&1; echo "RC=$?"; cat /tmp/t4.log
```

- [ ] **Step 6: 跑变异**

| 变异 | 落点 | 期望红在 |
|---|---|---|
| 🔴 从 `CORRECTION_FIELDS` 里删掉 `"by"` | `fields.ts` | `makes both the correction id and the run id depend on who wrote the row` —— **两条断言都该红** |
| 把 `canonicalCorrectionJson` 改成 `JSON.stringify(row)`（用对象自己的键序） | `fields.ts` | `serialises the fields in the declared order…` |
| 把 `deriveCorrectionId` 的 slice 改成 `slice(0, 8)` | `fields.ts` | `derives the same id from the same row, every time` 的正则 |

- [ ] **Step 7: 提交**

```bash
git add src/corrections/fields.ts src/scheduler/runId.ts tests/corrections/fields.test.ts
git commit -m "feat(corrections): give the field sequence one definition, so 'by' has one place to be deleted from"
```

---

### Task 5: 存储层 —— 读、查重、追加（**临界区在这里**）

**Files:**
- Create: `src/corrections/store.ts`
- Test: `tests/corrections/store.test.ts`

**Interfaces:**
- Consumes: `withStoreLock` / `correctionsFile` / `CORRECTIONS_FILE_MODE`（Task 3）、
  `CorrectRejection`（Task 2）、`correctionSchema`（既有）
- Produces:
  - `CORRECTION_ALREADY_RECORDED = "correction-already-recorded"`
  - `DUPLICATE_CORRECTION_ID = "duplicate-correction-id"`
  - `CORRECTION_NOT_FOUND = "correction-not-found"`
  - `readCorrections(dir): Promise<Correction[]>`
  - `appendCorrectionLocked(dir, row): Promise<void>` —— **调用方必须已持锁**
  - `recordCorrection(dir, row, { again }): Promise<void>` —— **整个临界区**
  - `loadCorrection(dir, id): Promise<Correction>` —— 持锁读一行，找不到就具名拒绝

- [ ] **Step 1: 写失败判据**

创建 `tests/corrections/store.test.ts`：

```ts
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CORRECTIONS_FILE_MODE, correctionsFile } from "../../src/corrections/paths.js";
import { withStoreLock } from "../../src/corrections/storeLock.js";
import { CorrectRejection } from "../../src/corrections/rejection.js";
import {
  CORRECTION_ALREADY_RECORDED,
  DUPLICATE_CORRECTION_ID,
  appendCorrectionLocked,
  readCorrections,
  recordCorrection,
} from "../../src/corrections/store.js";
import { deriveCorrectionId } from "../../src/corrections/fields.js";
import type { Correction } from "../../src/corrections/schema.js";

const tempDir = () => mkdtemp(join(tmpdir(), "orca-store-"));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function correction(overrides: Partial<Correction> = {}): Correction {
  const base = {
    projectKey: "github.com/biran/orca",
    decisionId: "orca-dev-1/1",
    kind: "not_my_taste" as const,
    chose_instead: "改用文件租约",
    because: "进程内互斥跨进程无效",
    at: "2026-09-07T00:00:00.000Z",
    by: "amy",
    ...overrides,
  };
  return { id: deriveCorrectionId(base), ...base };
}

describe("corrections store (spec §4, §4.1, §14.6, §14.7)", () => {
  it("appends a row and reads it back", async () => {
    const dir = await tempDir();
    const row = correction();
    await recordCorrection(dir, row, { again: false });
    expect(await readCorrections(dir)).toEqual([row]);
  });

  // E10a, part 1: the semantic duplicate check, and the id it points at.
  it("refuses a second correction on the same decision by the same person", async () => {
    const dir = await tempDir();
    const first = correction();
    await recordCorrection(dir, first, { again: false });

    const second = correction({ at: "2026-09-07T00:00:01.000Z", because: "另一句理由" });
    const error = await recordCorrection(dir, second, { again: false }).then(
      () => { throw new Error("recorded a second correction that should have been refused"); },
      (e: unknown) => e,
    );
    expect((error as Error).message).toContain(first.id);
    expect((error as CorrectRejection).code).toBe(CORRECTION_ALREADY_RECORDED);
    expect(await readCorrections(dir)).toHaveLength(1);
  });

  // E10a, part 2 — the half that pins `projectKey` in the key (§14.6). A
  // decision id carries no repository identity and is itself derived, so the
  // same `<run>/<n>` shows up in every clone and fork; without projectKey a
  // person correcting the same decision id in a second repository is told
  // "already corrected" and pushed towards --again, which turns the whole
  // guard off.
  it("allows the same decision id in a different project", async () => {
    const dir = await tempDir();
    await recordCorrection(dir, correction(), { again: false });
    const elsewhere = correction({ projectKey: "github.com/biran/ccloop" });
    await recordCorrection(dir, elsewhere, { again: false });
    expect(await readCorrections(dir)).toHaveLength(2);
  });

  // E10b
  it("records a second one when --again is explicit, and keeps both", async () => {
    const dir = await tempDir();
    const first = correction();
    await recordCorrection(dir, first, { again: false });
    const second = correction({ at: "2026-09-07T00:00:01.000Z" });
    await recordCorrection(dir, second, { again: true });

    const rows = await readCorrections(dir);
    expect(rows.map((r) => r.id)).toEqual([first.id, second.id]);
  });

  // E10c. ⚠️ The fixture pins BOTH `--again` and a byte-identical `at`:
  // without --again the semantic check refuses first and this criterion would
  // prove nothing about the id check; without pinning `at` the two ids differ
  // by construction and the criterion goes red against the UNMUTATED
  // implementation too (third seat).
  it("refuses the very same row replayed, even with --again", async () => {
    const dir = await tempDir();
    const row = correction();
    await recordCorrection(dir, row, { again: false });
    const error = await recordCorrection(dir, { ...row }, { again: true }).then(
      () => { throw new Error("recorded the same row twice"); },
      (e: unknown) => e,
    );
    expect((error as CorrectRejection).code).toBe(DUPLICATE_CORRECTION_ID);
    expect(await readCorrections(dir)).toHaveLength(1);
  });

  // E9 (corrections half)
  it("does not glue a row onto a file that has no trailing newline", async () => {
    const dir = await tempDir();
    const existing = correction({ by: "bob" });
    await writeFile(correctionsFile(dir), JSON.stringify(existing), { mode: CORRECTIONS_FILE_MODE });

    await recordCorrection(dir, correction(), { again: false });

    const lines = (await readFile(correctionsFile(dir), "utf8")).split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });

  // E17 (file half). umask pinned and restored, same reasoning as Task 3.
  it("creates the corrections file 0600 whatever the umask is", async () => {
    const dir = await tempDir();
    const previousUmask = process.umask(0o022);
    try {
      await recordCorrection(dir, correction(), { again: false });
      expect((await stat(correctionsFile(dir))).mode & 0o777).toBe(CORRECTIONS_FILE_MODE);
    } finally {
      process.umask(previousUmask);
    }
  });

  // 🔴 E10d — the read and the judgement are inside the SAME lock hold.
  //
  // ⚠️ The barrier is one-sided on purpose (§14.7): in the unmutated
  // implementation the read happens under the lock, so the two sides can never
  // both be past it at the same time, and a rendezvous barrier would deadlock
  // the correct implementation. P1 holds the lock, signals, sleeps, and only
  // THEN appends — so P2's early (mutated) read sees an empty store.
  //
  // ⚠️ P1's sleep is well under STORE_LOCK_TIMEOUT_MS: if it were longer, the
  // unmutated run would be let through by the timeout (exit 4) rather than by
  // the duplicate check, and this criterion would be green for the wrong
  // reason. The assertion names the duplicate rejection for that reason.
  it("holds the lock across the read, the judgement and the append", async () => {
    const dir = await tempDir();
    const first = correction();
    const second = correction({ at: "2026-09-07T00:00:01.000Z" });

    let signal!: () => void;
    const p1InLock = new Promise<void>((resolve) => { signal = resolve; });

    const p1 = withStoreLock(dir, async () => {
      signal();
      await sleep(200);
      await appendCorrectionLocked(dir, first);
    });

    await p1InLock;
    const p2 = recordCorrection(dir, second, { again: false }).then(
      () => { throw new Error("the second writer got past a check that should have refused it"); },
      (e: unknown) => e,
    );

    await p1;
    const error = await p2;
    expect((error as Error).message).toContain(first.id);
    expect((error as CorrectRejection).code).toBe(CORRECTION_ALREADY_RECORDED);
    expect(await readCorrections(dir)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 跑它，确认它红**

- [ ] **Step 3: 实现 `src/corrections/store.ts`**

```ts
import { appendFile, readFile } from "node:fs/promises";
import { CORRECTIONS_FILE_MODE, correctionsFile } from "./paths.js";
import { CorrectRejection } from "./rejection.js";
import { withStoreLock } from "./storeLock.js";
import { correctionSchema } from "./schema.js";
import type { Correction } from "./schema.js";

export const CORRECTION_ALREADY_RECORDED = "correction-already-recorded";
export const DUPLICATE_CORRECTION_ID = "duplicate-correction-id";
export const CORRECTION_NOT_FOUND = "correction-not-found";

export async function readCorrections(dir: string): Promise<Correction[]> {
  const text = await readFile(correctionsFile(dir), "utf8").catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  });

  const rows: Correction[] = [];
  for (const raw of text.split("\n")) {
    if (raw.trim().length === 0) continue;
    rows.push(correctionSchema.parse(JSON.parse(raw)));
  }
  return rows;
}

/**
 * The raw append. The caller must already hold the store lock — this is not
 * checked, because the only way to check it would be to take the lock here,
 * and the whole point of the split is that the read, the judgement and the
 * append happen inside ONE hold (§14.7).
 *
 * The separator is the same lesson the ledger writer records: `appendFile`
 * concatenates bytes and inserts nothing, so a store whose last line has no
 * newline would get the new row glued onto the end of the old one — reported
 * as success, unparseable on disk.
 *
 * `mode` applies only when this call CREATES the file. An existing file keeps
 * whatever mode it has: that is a person's data and this program does not get
 * to decide it (§14.17).
 */
export async function appendCorrectionLocked(dir: string, row: Correction): Promise<void> {
  correctionSchema.parse(row);

  const file = correctionsFile(dir);
  const existingText = await readFile(file, "utf8").catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  });
  const separator = existingText.length > 0 && !existingText.endsWith("\n") ? "\n" : "";
  await appendFile(file, `${separator}${JSON.stringify(row)}\n`, { mode: CORRECTIONS_FILE_MODE });
}

/**
 * The critical section: acquire → read → judge → append → release, with the
 * release in a `finally` by construction (withStoreLock).
 *
 * Two checks, not one. The id check alone is nearly unreachable in practice —
 * an id is derived from a row that contains `at`, so running the same command
 * twice produces two different ids and two rows land silently, inflating the
 * denominator of A' §4.4's fix rate with nothing reporting it (§4.1). The
 * semantic check is the one a person actually trips, and `--again` is what
 * makes "yes, I really mean a second one" an explicit act rather than a silent
 * side effect.
 *
 * The key includes projectKey (§14.6): decision ids are derived and repeat
 * across clones and forks.
 */
export async function recordCorrection(
  dir: string,
  row: Correction,
  opts: { again: boolean },
): Promise<void> {
  await withStoreLock(dir, async () => {
    const rows = await readCorrections(dir);

    if (rows.some((existing) => existing.id === row.id)) {
      throw new CorrectRejection(
        DUPLICATE_CORRECTION_ID,
        `a correction with id ${row.id} is already in the store — this exact row has already been recorded`,
      );
    }

    if (!opts.again) {
      const existing = rows.find(
        (candidate) =>
          candidate.projectKey === row.projectKey &&
          candidate.decisionId === row.decisionId &&
          candidate.by === row.by,
      );
      if (existing !== undefined) {
        throw new CorrectRejection(
          CORRECTION_ALREADY_RECORDED,
          `${row.by} has already corrected ${row.decisionId} in ${row.projectKey}: correction ${existing.id} ` +
            `(recorded ${existing.at}). Pass --again to record another one on purpose.`,
        );
      }
    }

    await appendCorrectionLocked(dir, row);
  });
}

export async function loadCorrection(dir: string, id: string): Promise<Correction> {
  return withStoreLock(dir, async () => {
    const found = (await readCorrections(dir)).find((row) => row.id === id);
    if (found === undefined) {
      throw new CorrectRejection(
        CORRECTION_NOT_FOUND,
        `no correction with id ${JSON.stringify(id)} in ${correctionsFile(dir)}`,
      );
    }
    return found;
  });
}
```

- [ ] **Step 4: 跑它，确认它绿**

- [ ] **Step 5: 跑变异**

| 变异 | 落点 | 期望红在 |
|---|---|---|
| **E10a**：从语义查重的键里去掉 `candidate.projectKey === row.projectKey` | `store.ts` | `allows the same decision id in a different project` |
| **E10b**：把 `if (!opts.again)` 改成 `if (true)` | `store.ts` | `records a second one when --again is explicit…` |
| **E10c**：删掉 id 查重整段 | `store.ts` | `refuses the very same row replayed, even with --again` |
| **E10d**：把 `readCorrections` ＋ 两道判断**移到 `withStoreLock` 之外**（取锁前） | `store.ts` | `holds the lock across the read…` —— 两行都落盘 |
| **E7**：把 `recordCorrection` 的 `withStoreLock(dir, fn)` 换成直接 `await fn()`（**删掉取锁**） | `store.ts` | 同上（E10d 的夹具同时钉住它） |
| **E9**：把 `separator` 写死成 `""` | `store.ts` | `does not glue a row onto a file that has no trailing newline` |
| **E17**：去掉 `appendFile` 的 `{ mode }` | `store.ts` | `creates the corrections file 0600 whatever the umask is` |

- [ ] **Step 6: 提交**

```bash
git add src/corrections/store.ts tests/corrections/store.test.ts
git commit -m "feat(corrections): judge duplicates inside the lock, and make a second correction an explicit act"
```

---
### Task 6: 派生表 —— 从 correction ＋ 原 decision 到落盘的两行

**Files:**
- Create: `src/corrections/derive.ts`
- Test: `tests/corrections/derive.test.ts`

**Interfaces:**
- Consumes: `DecisionEvent` / `OverturnedEvent`（`src/ledger/schema.ts`，既有）、`Correction`
- Produces:
  ```ts
  export interface DeriveInput {
    correction: Correction;                       // 带 id
    original: DecisionEvent;
    choseInstead: string;                         // 存储行的 chose_instead，或 --chose-instead 补给的
    undo: { how: string; cost?: string; blastRadius?: string };
    at: string;                                   // 🔴 真实落笔时刻，由调用方注入
    runId: string;                                // deriveFixRunId 的产物
  }
  export interface DerivedRows { decision: DecisionEvent; overturned: OverturnedEvent }
  export function deriveRows(input: DeriveInput): DerivedRows
  ```

- [ ] **Step 1: 写失败判据**

创建 `tests/corrections/derive.test.ts`：

```ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendEvents } from "../../src/ledger/writer.js";
import { deriveRows } from "../../src/corrections/derive.js";
import type { DecisionEvent } from "../../src/ledger/schema.js";
import type { Correction } from "../../src/corrections/schema.js";

const original: DecisionEvent = {
  ev: "decision",
  id: "orca-dev-1/1",
  at: "2026-09-01T00:00:00.000Z",
  run: "orca-dev-1",
  question: "用哪种锁",
  chose: "进程内互斥",
  alternatives: [{ option: "文件租约", why_not: "当时觉得太重" }],
  because: "实现最快",
  undo: { how: "git revert <ref>", cost: "要回滚三个仓库的 W 分支", blast_radius: "三个仓库" },
  scope: "repo",
  kind: "interface",
};

const correction: Correction = {
  id: "c_1111111111111111",
  projectKey: "github.com/biran/orca",
  decisionId: "orca-dev-1/1",
  kind: "not_my_taste",
  chose_instead: "改用文件租约",
  because: "进程内互斥跨进程无效",
  at: "2026-09-05T00:00:00.000Z",
  by: "amy",
};

const input = {
  correction,
  original,
  choseInstead: "改用文件租约",
  undo: { how: "删掉 src/scheduler/pool.ts 里的进程内互斥" },
  at: "2026-09-07T12:00:00.000Z",
  runId: "orca-fix-abcd1234",
};

describe("derived rows (spec §5 as revised by §14.2 / §14.5 / §14.22)", () => {
  // 🔴 E13. Both rows deep-equal, not just the decision: overturned's schema
  // is a `.passthrough()` extension, so an extra or misspelled field on THAT
  // row is accepted by zod — and `correctionId`, the join key A' §4.4's fix
  // rate is computed on, lives exactly there. Nothing but deep equality holds
  // that line.
  it("derives both rows field by field", () => {
    const { decision, overturned } = deriveRows(input);

    expect(decision).toEqual({
      ev: "decision",
      id: "orca-fix-abcd1234/1",
      at: "2026-09-07T12:00:00.000Z",
      run: "orca-fix-abcd1234",
      question: "用哪种锁",
      chose: "改用文件租约",
      alternatives: [
        { option: "进程内互斥", why_not: "人在 correction c_1111111111111111 里推翻了它：进程内互斥跨进程无效" },
      ],
      because: "进程内互斥跨进程无效",
      undo: {
        how: "删掉 src/scheduler/pool.ts 里的进程内互斥",
        cost: "要回滚三个仓库的 W 分支（继承自 orca-dev-1/1）",
        blast_radius: "三个仓库（继承自 orca-dev-1/1）",
      },
      scope: "repo",
      kind: "interface",
      evidence: ["correction c_1111111111111111", "overturns orca-dev-1/1"],
    });

    expect(overturned).toEqual({
      ev: "overturned",
      id: "orca-dev-1/1",
      correctionId: "c_1111111111111111",
      replacedBy: "orca-fix-abcd1234/1",
      at: "2026-09-07T12:00:00.000Z",
      run: "orca-fix-abcd1234",
    });
  });

  // E16 (unit half; the command-level half is Task 9). §14.5 overturned §5's
  // "back-fill the correction's at" wholesale: upstream defines overturned.at
  // as the moment it was written, and back-filling silently changed the
  // MEANING of an append-only field. It also bought nothing — the correction's
  // own `at` is reachable through correctionId.
  it("stamps both rows with the injected write moment, not the correction's", () => {
    const { decision, overturned } = deriveRows(input);
    expect(decision.at).toBe("2026-09-07T12:00:00.000Z");
    expect(overturned.at).toBe("2026-09-07T12:00:00.000Z");
    expect(decision.at).not.toBe(correction.at);
  });

  // 🔴 E21 (§14.22): the two overrides exist because an inherited undo.cost can
  // be an outright lie — "roll back three repositories" attached to a choice
  // that touches one file — and the ledger is append-only, so "we can add a
  // flag later" is never true for a row already written.
  it("uses the human's undo cost and blast radius when given, with no inheritance note", () => {
    const { decision } = deriveRows({
      ...input,
      undo: { how: "删掉那处互斥", cost: "改一个文件", blastRadius: "仅本仓库" },
    });
    expect(decision.undo.cost).toBe("改一个文件");
    expect(decision.undo.blast_radius).toBe("仅本仓库");
    expect(decision.undo.cost).not.toContain("继承自");
    expect(decision.undo.blast_radius).not.toContain("继承自");
  });

  // E12: the derived undo.how is the human's, so a non-executable one is
  // refused by the ledger writer's check 3 instead of landing as a Tier 0
  // downgraded row. This is what makes ruling 4 (undo.how is the human's to
  // fill) a gate rather than a decoration.
  it("fails the append instead of writing a downgraded row when undo.how is prose", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orca-derive-"));
    const { decision, overturned } = deriveRows({ ...input, undo: { how: "改一下" } });
    await expect(appendEvents(dir, "orca-fix-abcd1234", [decision, overturned])).rejects.toThrow(
      /downgraded to tier 0/,
    );
  });
});
```

- [ ] **Step 2: 跑它，确认它红**

- [ ] **Step 3: 实现 `src/corrections/derive.ts`**

```ts
import type { DecisionEvent, OverturnedEvent } from "../ledger/schema.js";
import type { Correction } from "./schema.js";

export interface DeriveInput {
  correction: Correction;
  original: DecisionEvent;
  choseInstead: string;
  undo: { how: string; cost?: string; blastRadius?: string };
  /**
   * 🔴 The real moment this row is being written, injected rather than read
   * from a clock in here — spec §14.5. Two reasons it is a parameter: the two
   * rows must carry the SAME stamp, and a criterion has to be able to pin what
   * that stamp was.
   */
  at: string;
  runId: string;
}

export interface DerivedRows {
  decision: DecisionEvent;
  overturned: OverturnedEvent;
}

/**
 * An inherited undo field says so, in the row itself. The reader of a ledger
 * line has no other way to tell "the person weighed this" from "we copied it
 * off the decision being overturned", and the reverse of a choice does not
 * generally cost what the choice cost (spec §9 item 3).
 */
function inherited(value: string, originalId: string): string {
  return `${value}（继承自 ${originalId}）`;
}

/**
 * spec §5's derivation table, as revised by §14.2 / §14.5 / §14.22.
 *
 * Pure: same inputs, same two rows. Everything non-deterministic (the clock,
 * the run id, which correction row this is) is an argument, which is what lets
 * E13 deep-equal both rows instead of picking at them field by field.
 */
export function deriveRows(input: DeriveInput): DerivedRows {
  const { correction, original, choseInstead, undo, at, runId } = input;
  const decisionId = `${runId}/1`;

  const decision: DecisionEvent = {
    ev: "decision",
    id: decisionId,
    at,
    run: runId,
    // The question did not change; the answer did. Copied verbatim on purpose.
    question: original.question,
    chose: choseInstead,
    // why_not is not a copy of `because`: it carries the correction's id, so a
    // reader of this alternative can find out who refused the old option and
    // where they said why. An unattributed reason is the shape CLAUDE.md
    // Rule 13 exists to prevent.
    alternatives: [
      {
        option: original.chose,
        why_not: `人在 correction ${correction.id} 里推翻了它：${correction.because}`,
      },
    ],
    because: correction.because,
    undo: {
      // The human's, always (ruling 4): this is the field the Tier 0 gate
      // reads, and a derived one would make that gate unable to ever fire.
      how: undo.how,
      cost: undo.cost ?? inherited(original.undo.cost, original.id),
      blast_radius: undo.blastRadius ?? inherited(original.undo.blast_radius, original.id),
    },
    scope: original.scope,
    kind: original.kind,
    evidence: [`correction ${correction.id}`, `overturns ${original.id}`],
  };

  const overturned: OverturnedEvent = {
    ev: "overturned",
    id: original.id,
    correctionId: correction.id,
    replacedBy: decisionId,
    at,
    run: runId,
  };

  return { decision, overturned };
}
```

- [ ] **Step 4: 跑它，确认它绿**

- [ ] **Step 5: 跑变异（E13 的七条 ＋ E16 ＋ E21 ＋ E12）**

| # | 变异 | 落在哪一行 | 期望红在 |
|---|---|---|---|
| 1 | `chose` 与 `alternatives[0].option` **对调** | decision | E13 的 `toEqual` |
| 2 | `correctionId: correction.id` 改成 `correctionId: correction.decisionId` | **overturned** | E13 的第二个 `toEqual` |
| 3 | `replacedBy: decisionId` 改成 `replacedBy: original.id` | overturned | 同上 |
| 4 | `question: original.question` 改成 `question: correction.because` | decision | E13 的第一个 `toEqual` |
| 5 | `scope`／`kind` 改成写死 `"repo"` / `"interface"`（**夹具的原 decision 要先改成别的值**，否则常量恰好相等） | decision | 同上 |
| 6 | `evidence` 两条顺序对调 | decision | 同上 |
| 7 | 往 `overturned` 上多写一个字段（如 `chose_instead: correction.chose_instead`） | overturned | 同上 —— *** **schema 是 passthrough，只有 deep-equal 拦得住它** *** |
| 8 | **E16**：`at` 改回 `correction.at` | 两行 | `stamps both rows with the injected write moment…` |
| 9 | **E21**：把 `undo.cost ?? …` 改成 `inherited(original.undo.cost, original.id)`（**解析了参数但不接进派生**） | decision | `uses the human's undo cost…` |
| 10 | **E12**：`how: undo.how` 改成 `how: "git revert <ref>"` | decision | `fails the append instead of writing a downgraded row…` |

⚠️ **第 5 条要先改夹具**：现在夹具的 `scope`／`kind` 就是 `"repo"`／`"interface"`，
写死同一个值的变异**恰好不改变输出**。⇒ *** **变异前把夹具原 decision 的 `scope` 改成 `"task"`、`kind` 改成 `"boundary"`，
并把期望值一起改** ***（在副本里改，主工作树不动），否则这条变异跑出来是绿的而你会以为它证明了什么。

- [ ] **Step 6: 提交**

```bash
git add src/corrections/derive.ts tests/corrections/derive.test.ts
git commit -m "feat(corrections): derive both ledger rows from the correction, and pin every field of both"
```

---

### Task 7: 命令表面 —— 参数解析、模式判定、退出码

🔴 **本任务实现 §14.24：表达了闭环意图，就不许半途。**

⚠️ *** **一处必须报给人的后果**（实施者：写进本轮台账，并在收尾报告里点名）：
按 §14.24 的字面规则，`--chose-instead` 一出现就算表达了闭环意图 ⇒
*** **`kind=not_my_taste` 的 correction 再也不能「只记不闭环」** *** —— 因为 `correctionSchema` 要求
`not_my_taste` 必须带 `chose_instead`。§14.4 讨论「只记模式记下的」时只举了 `wrong`／`stale`，
与这条推论一致，但 spec 从未明写它。**本计划按 §14.24 的字面实现（它是最新裁决且明确推翻 §3），
并把这条后果登记出来等人裁。** ***

**Files:**
- Create: `src/corrections/args.ts`
- Modify: `src/cli.ts`（`USAGE` ＋ `correct` 分支 ＋ 退出码映射）
- Test: `tests/corrections/args.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type UndoArgs = { how: string; cost?: string; blastRadius?: string };
  export type ParsedCorrect =
    | { mode: "record"; repo: string; by: string; decisionId: string; kind: CorrectionKind;
        because: string; choseInstead?: string; again: boolean }
    | { mode: "close-new"; repo: string; by: string; decisionId: string; kind: CorrectionKind;
        because: string; choseInstead: string; again: boolean; undo: UndoArgs }
    | { mode: "close-existing"; repo: string; by: string; correctionId: string;
        choseInstead?: string; undo: UndoArgs };
  export const MISSING_CLOSING_HALF = "incomplete-closing-intent";
  export const CLOSE_ARG_CONFLICT = "close-argument-conflict";
  export const MISSING_IDENTITY = "no-git-identity";
  export async function parseCorrectArgs(argv: string[]): Promise<ParsedCorrect>
  ```
- Consumes: `CorrectRejection`（Task 2）

- [ ] **Step 1: 写失败判据**

创建 `tests/corrections/args.test.ts`（**纯参数层，不碰仓库、不碰存储**）：

```ts
import { describe, expect, it } from "vitest";
import { CorrectRejection } from "../../src/corrections/rejection.js";
import {
  CLOSE_ARG_CONFLICT,
  MISSING_CLOSING_HALF,
  parseCorrectArgs,
} from "../../src/corrections/args.js";

const base = ["--repo", "/tmp/r", "--by", "amy", "--decision", "orca-dev-1/1", "--kind", "wrong", "--because", "错了"];

const rejectionOf = async (argv: string[]): Promise<CorrectRejection> =>
  parseCorrectArgs(argv).then(
    () => { throw new Error(`parse accepted ${argv.join(" ")}`); },
    (e: unknown) => e as CorrectRejection,
  );

describe("orca correct argument surface (spec §3 as revised by §14.4 / §14.24)", () => {
  it("records only, when neither closing argument is given", async () => {
    const parsed = await parseCorrectArgs(base);
    expect(parsed.mode).toBe("record");
  });

  it("closes the loop when both closing arguments are given", async () => {
    const parsed = await parseCorrectArgs([...base, "--chose-instead", "别的", "--undo-how", "删掉 src/a.ts 那处"]);
    expect(parsed.mode).toBe("close-new");
  });

  // 🔴 E3 — the defect this replaces: with mode inferred from "are both
  // present", mistyping `--undo-hwo` silently produced a record-only run that
  // exited 0, and the person believed they had closed the loop. The message
  // has to name which half is missing; both branches exit non-zero, so the
  // message is the ONLY thing that distinguishes the fixed behaviour.
  it("refuses a half-expressed closing intent and names the missing half", async () => {
    const missingUndo = await rejectionOf([...base, "--chose-instead", "别的"]);
    expect(missingUndo.message).toContain("--undo-how");
    expect(missingUndo.code).toBe(MISSING_CLOSING_HALF);
    expect(missingUndo.exitCode).toBe(1);

    const missingChose = await rejectionOf([...base, "--undo-how", "删掉 src/a.ts 那处"]);
    expect(missingChose.message).toContain("--chose-instead");
    expect(missingChose.code).toBe(MISSING_CLOSING_HALF);
  });

  // §14.4: --close is exclusive with the values that already live on the
  // stored row...
  it("refuses --close together with the fields that are already on the stored row", async () => {
    const error = await rejectionOf([
      "--repo", "/tmp/r", "--by", "amy", "--close", "c_1", "--undo-how", "删掉 src/a.ts 那处", "--kind", "wrong",
    ]);
    expect(error.message).toContain("--kind");
    expect(error.code).toBe(CLOSE_ARG_CONFLICT);
  });

  // ...but NOT with the three undo fields, which are not among the
  // correction's eight fields and therefore cannot be on that row.
  it("accepts --close together with the three undo arguments", async () => {
    const parsed = await parseCorrectArgs([
      "--repo", "/tmp/r", "--by", "amy", "--close", "c_1",
      "--undo-how", "删掉 src/a.ts 那处", "--undo-cost", "改一个文件", "--undo-blast-radius", "仅本仓库",
    ]);
    expect(parsed).toMatchObject({
      mode: "close-existing",
      correctionId: "c_1",
      undo: { how: "删掉 src/a.ts 那处", cost: "改一个文件", blastRadius: "仅本仓库" },
    });
  });

  it("refuses --close without --undo-how, which the stored row cannot supply", async () => {
    const error = await rejectionOf(["--repo", "/tmp/r", "--by", "amy", "--close", "c_1"]);
    expect(error.message).toContain("--undo-how");
    expect(error.code).toBe(MISSING_CLOSING_HALF);
  });

  // spec §3 / §12 finding 2: `by` is min(1) in the schema, so an unset git
  // identity would otherwise fail four layers down with "field missing" — a
  // message that never mentions the machine's git config.
  it("says the machine has no git identity rather than letting the schema complain", async () => {
    const error = await rejectionOf([
      "--repo", "/tmp/r", "--decision", "orca-dev-1/1", "--kind", "wrong", "--because", "错了",
      "--no-git-identity-for-test",
    ]);
    expect(error.message).toContain("git config user.name");
  });
});
```

⚠️ **最后一条判据里的 `--no-git-identity-for-test` 是个占位** —— 实施时**不许**真加这样一个开关。
改成：`parseCorrectArgs(argv, { gitUserName?: () => Promise<string | undefined> })` 的**第二个参数**是测试用接缝
（本仓库既有先例：`makeSandbox` 的 `resolveCcloopBin`），判据传一个返回 `undefined` 的 resolver。
**判据文件里要按这个接缝把这条重写**，别留占位。

- [ ] **Step 2: 跑它，确认它红**

- [ ] **Step 3: 实现 `src/corrections/args.ts`**

要点（**逐条对应 spec**）：

1. `flagValue(name)` 与 `cli.ts` 现有 `runRun` 同形（`indexOf` ＋ `+1`）；**未知 flag 一律拒**
   （`--undo-hwo` 必须是「未知参数」而不是「被忽略」—— 这是 E3 那个缺陷的第二道保险）。
2. `--by` 缺省从 `git config user.name` 取；**取不到当场拒**，码 `MISSING_IDENTITY`，
   消息里点名 `git config user.name`。
3. **模式判定（§14.24）**：
   ```ts
   const expressedClosingIntent = choseInstead !== undefined || undoHow !== undefined || close !== undefined;
   ```
   - `close !== undefined` ⇒ `close-existing`；此时 `--decision` / `--kind` / `--because` / `--again`
     **任一出现即拒**（`CLOSE_ARG_CONFLICT`，消息点名是哪一个）；`--chose-instead` **不在这里判**
     —— 它是**条件互斥**，要看存储行有没有，留给 Task 9（闭-6 之前）。
   - 否则 `expressedClosingIntent` ⇒ 两个都要有，缺哪个就说哪个（`MISSING_CLOSING_HALF`）。
   - 否则 ⇒ `record`。
4. `--again` 只对 `record` / `close-new` 有意义。
5. **`--repo` 缺省 `process.cwd()`**。

- [ ] **Step 4: 把 `correct` 挂上 `cli.ts`**

```ts
if (command === "correct") {
  return runCorrect(rest);
}
```

`USAGE` 追加（**与既有四行同一风格**）：

```
  orca correct --decision <run-id>/<n> --kind wrong|not_my_taste|stale --because <text>
               [--repo <path>] [--by <who>] [--again]
               [--chose-instead <text> --undo-how <text> [--undo-cost <text>] [--undo-blast-radius <text>]]
                                 record a human's correction; giving either closing argument means
                                 closing the loop, which also writes the two ledger rows and commits them
  orca correct --close <correctionId> --undo-how <text> [--repo <path>] [--chose-instead <text>]
                                 finish (or re-try) the closing half of a correction already recorded
```

`runCorrect` 的骨架（Task 8／9／10 往里填）：

```ts
async function runCorrect(args: string[]): Promise<number> {
  try {
    return await correct(args);
  } catch (err) {
    // A named refusal answers with its own exit code (spec §14.14). Anything
    // else is not this handler's to diagnose — it falls through to the
    // top-level arm, which answers 3.
    if (err instanceof CorrectRejection) {
      process.stderr.write(`rejected: ${err.code}: ${err.message}\n`);
      return err.exitCode;
    }
    throw err;
  }
}
```

- [ ] **Step 5: 跑判据 ＋ 跑 `tests/cli/cli.test.ts`（既有，必须仍绿）**

```bash
rtk proxy npx vitest run tests/corrections/args.test.ts tests/cli/cli.test.ts > /tmp/t7.log 2>&1; echo "RC=$?"; cat /tmp/t7.log
```

- [ ] **Step 6: 跑变异**

| 变异 | 落点 | 期望红在 |
|---|---|---|
| **E3**：把模式判定改回「两个都在才闭环，否则只记」（**第二版的行为**） | `args.ts` | `refuses a half-expressed closing intent…` 的**消息断言** |
| 把 `MISSING_CLOSING_HALF` 的消息改成不提具体是哪个 flag | `args.ts` | 同上（两条都该红） |
| 让 `--close` 与 `--undo-cost` 互斥 | `args.ts` | `accepts --close together with the three undo arguments` |
| 删掉 `--by` 取不到时的当场拒 | `args.ts` | `says the machine has no git identity…` |

- [ ] **Step 7: 提交**

```bash
git add src/corrections/args.ts src/cli.ts tests/corrections/args.test.ts
git commit -m "feat(cli): once a closing intent is expressed, refuse to finish it halfway"
```

---
### Task 8: 只记模式跑通端到端（**共用只读预检在这一步落地**）

**Files:**
- Create: `tests/corrections/harness.ts`
- Create: `src/corrections/correct.ts`（本任务只填只记那条线）
- Test: `tests/corrections/record.test.ts`

**Interfaces:**
- Produces: `export async function correct(argv: string[]): Promise<number>`
- Produces: `export async function sharedPreflight(repo: string): Promise<string>` —— 返回 `projectKey`
- Consumes: Task 2／3／4／5／7 的全部导出、`unlockableTargetRejection` ＋ `TARGET_NOT_A_GIT_REPO`（既有）

- [ ] **Step 1: 写测试夹具 `tests/corrections/harness.ts`**

```ts
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { appendEvent } from "../../src/ledger/writer.js";
import type { DecisionEvent } from "../../src/ledger/schema.js";

export { captureStreams, runCli } from "../scheduler/sandbox.js";

const execFileAsync = promisify(execFile);
const ID = ["-c", "user.name=fixture", "-c", "user.email=fixture@invalid"];

export async function git(repo: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", [...ID, ...args], { cwd: repo });
  return stdout;
}

/**
 * 🔴 CLAUDE.md Rule 17. Every criterion that touches the corrections store runs
 * inside this: ORCA_CORRECTIONS_DIR is pointed at a throwaway directory and the
 * previous value is restored in a `finally`. A criterion that wrote into a
 * person's real ~/.orca would be unacceptable even if it only wrote one line.
 */
export async function withCorrectionsDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "orca-corrections-"));
  const previous = process.env.ORCA_CORRECTIONS_DIR;
  process.env.ORCA_CORRECTIONS_DIR = dir;
  try {
    return await fn(dir);
  } finally {
    if (previous === undefined) delete process.env.ORCA_CORRECTIONS_DIR;
    else process.env.ORCA_CORRECTIONS_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
}

export const ORIGINAL: DecisionEvent = {
  ev: "decision",
  id: "orca-dev-1/1",
  at: "2026-09-01T00:00:00.000Z",
  run: "orca-dev-1",
  question: "用哪种锁",
  chose: "进程内互斥",
  alternatives: [{ option: "文件租约", why_not: "当时觉得太重" }],
  because: "实现最快",
  undo: { how: "git revert <ref>", cost: "要回滚三个仓库的 W 分支", blast_radius: "三个仓库" },
  scope: "repo",
  kind: "interface",
};

export interface TargetRepo {
  path: string;
  decisionsDir: string;
  cleanup(): Promise<void>;
}

/** A throwaway target repo with a remote, one commit, and one decision to overturn. */
export async function makeTargetRepo(options: { remote?: string; seedDecision?: boolean } = {}): Promise<TargetRepo> {
  const root = await mkdtemp(join(tmpdir(), "orca-target-"));
  const path = join(root, "repo");
  await mkdir(path, { recursive: true });
  await git(path, ["init"]);
  await git(path, ["remote", "add", "origin", options.remote ?? "https://github.com/biran/orca.git"]);
  await writeFile(join(path, "README.md"), "seed\n");
  await git(path, ["add", "-A"]);
  await git(path, ["commit", "-m", "init"]);

  const decisionsDir = join(path, ".decisions");
  if (options.seedDecision !== false) {
    await appendEvent(decisionsDir, "orca-dev-1", ORIGINAL);
    await git(path, ["add", "-A"]);
    await git(path, ["commit", "-m", "seed the decision to be overturned"]);
  }

  return { path, decisionsDir, cleanup: () => rm(root, { recursive: true, force: true }) };
}
```

- [ ] **Step 2: 写失败判据 `tests/corrections/record.test.ts`**

```ts
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCorrections } from "../../src/corrections/store.js";
import { captureStreams, git, makeTargetRepo, runCli, withCorrectionsDir } from "./harness.js";

const recordArgs = (repo: string, overrides: string[] = []) => [
  "correct", "--repo", repo, "--by", "amy",
  "--decision", "orca-dev-1/1", "--kind", "wrong", "--because", "那个前提当时就不成立",
  ...overrides,
];

describe("orca correct — record only (spec §14.3 记-1…记-3)", () => {
  it("writes one row keyed by the repository's remote, stamped now", async () => {
    const target = await makeTargetRepo();
    try {
      await withCorrectionsDir(async (dir) => {
        const before = new Date().toISOString();
        const { result: rc } = await captureStreams(() => runCli(recordArgs(target.path)));
        const after = new Date().toISOString();

        expect(rc).toBe(0);
        const rows = await readCorrections(dir);
        expect(rows).toHaveLength(1);
        expect(rows[0].projectKey).toBe("github.com/biran/orca");
        expect(rows[0].decisionId).toBe("orca-dev-1/1");
        expect(rows[0].by).toBe("amy");
        expect(rows[0].at >= before && rows[0].at <= after).toBe(true);
        expect(rows[0].id).toMatch(/^c_[0-9a-f]{16}$/);
      });
    } finally {
      await target.cleanup();
    }
  });

  // 🔴 E20 (§14.3, second seat I-E): record-only must stay usable while a round
  // is in flight. The repo lock is held for the whole of `orca run`, so taking
  // it here would mean a person cannot write down what they think for as long
  // as orca is working.
  it("records while another process holds the repo lock", async () => {
    const target = await makeTargetRepo();
    try {
      await mkdir(join(target.path, ".git", "orca-lock"), { recursive: true });
      await withCorrectionsDir(async (dir) => {
        const { result: rc } = await captureStreams(() => runCli(recordArgs(target.path)));
        expect(rc).toBe(0);
        expect(await readCorrections(dir)).toHaveLength(1);
      });
    } finally {
      await target.cleanup();
    }
  });

  // 🔴 E2b (§14.3, third seat): both modes run the SAME read-only preflight.
  // A linked worktree's `.git` is a file, so the closing mode can never take
  // the repo lock there — and if record-only skipped the check, the store
  // would end up holding a row that can never be closed from the checkout the
  // person is standing in, with nothing saying why.
  it("refuses a linked worktree in record mode too, by the same code", async () => {
    const target = await makeTargetRepo();
    try {
      const linked = join(target.path, "..", "linked");
      await git(target.path, ["worktree", "add", "-b", "wt", linked]);
      await withCorrectionsDir(async (dir) => {
        const { result: rc, stderr } = await captureStreams(() => runCli(recordArgs(linked)));
        expect(stderr).toContain("rejected: target-not-a-git-repo:");
        // §14.9: the predicate and the code are reused; the MESSAGE is not.
        // The existing one says "this round … the repo lock it takes before
        // reading anything", and `orca correct` is not a round — record mode
        // takes no lock at all.
        expect(stderr).not.toContain("this round");
        expect(rc).toBe(1);
        expect(existsSync(join(dir, "corrections.jsonl"))).toBe(false);
      });
    } finally {
      await target.cleanup();
    }
  });

  it("refuses a second correction on the same decision by the same person, and takes --again", async () => {
    const target = await makeTargetRepo();
    try {
      await withCorrectionsDir(async (dir) => {
        expect((await captureStreams(() => runCli(recordArgs(target.path)))).result).toBe(0);

        const second = await captureStreams(() => runCli(recordArgs(target.path)));
        expect(second.stderr).toContain("rejected: correction-already-recorded:");
        expect(second.result).toBe(1);

        const third = await captureStreams(() => runCli(recordArgs(target.path, ["--again"])));
        expect(third.result).toBe(0);
        expect(await readCorrections(dir)).toHaveLength(2);
      });
    } finally {
      await target.cleanup();
    }
  });
});
```

⚠️ **第四条判据里两次 `orca correct` 的 `at` 必然不同**（真实时钟，毫秒级），
所以两条 correction 的 id 也不同 —— *** **这正是 §4.1 说的「id 查重在现实中撞不上」，
本条判据靠的是语义查重，不是 id 查重。** ***

- [ ] **Step 3: 跑它，确认它红**

- [ ] **Step 4: 实现 `src/corrections/correct.ts` 的只记那条线**

```ts
import { TARGET_NOT_A_GIT_REPO, unlockableTargetRejection } from "../scheduler/preflight.js";
import { parseCorrectArgs } from "./args.js";
import { deriveCorrectionId } from "./fields.js";
import { correctionsDir } from "./paths.js";
import { projectKeyOf } from "./projectKey.js";
import { CorrectRejection } from "./rejection.js";
import { recordCorrection } from "./store.js";

/**
 * 記-2 / 闭-2: ONE read-only preflight, run by both modes (§14.3, third seat).
 * Splitting it was what let a linked worktree accept a row that could never be
 * closed from the checkout the person was standing in.
 *
 * All of it reads: `stat` + `git rev-parse` + `git config`. No lock is taken
 * here, which is what lets record-only run while a round holds the repo lock.
 *
 * §14.9: `unlockableTargetRejection`'s PREDICATE and CODE are reused — writing
 * a second spelling of `target-not-a-git-repo` is a bill this repository has
 * already paid twice (planFile.ts and planReport.ts each record one). Its
 * MESSAGE is not reused: it says "this round … the repo lock it takes before
 * reading anything", and `orca correct` is not a round. Changing the existing
 * message instead would take `runOnNonGitTarget.test.ts` red, and this round
 * has no authority to rewrite an existing criterion.
 */
export async function sharedPreflight(repo: string): Promise<string> {
  const rejection = await unlockableTargetRejection(repo);
  if (rejection !== undefined) {
    throw new CorrectRejection(
      TARGET_NOT_A_GIT_REPO,
      `${repo} is not the root of a git repository (its .git must be a directory): ` +
        `orca correct reads the ledger under <repo>/.decisions and, when it closes a loop, ` +
        `puts its lock at <repo>/.git/orca-lock`,
    );
  }
  return projectKeyOf(repo);
}

export async function correct(argv: string[]): Promise<number> {
  const parsed = await parseCorrectArgs(argv);
  const dir = correctionsDir();
  const projectKey = await sharedPreflight(parsed.repo);

  if (parsed.mode === "record") {
    const row = {
      projectKey,
      decisionId: parsed.decisionId,
      kind: parsed.kind,
      chose_instead: parsed.choseInstead,
      because: parsed.because,
      at: new Date().toISOString(),
      by: parsed.by,
    };
    const id = deriveCorrectionId(row);
    await recordCorrection(dir, { id, ...row }, { again: parsed.again });
    process.stdout.write(`recorded correction ${id} against ${parsed.decisionId} in ${projectKey}\n`);
    return 0;
  }

  // Closing modes land in Task 9 and Task 10.
  throw new Error("unreachable until task 9");
}
```

- [ ] **Step 5: 跑判据，确认它绿**

- [ ] **Step 6: 跑变异**

| 变异 | 落点 | 期望红在 |
|---|---|---|
| **E20**：在只记那条线前面插一句 `await acquireRepoLock(parsed.repo)` | `correct.ts` | `records while another process holds the repo lock`（exit 4） |
| **E2b**：让只记模式跳过 `sharedPreflight` 的 `.git` 检查（只调 `projectKeyOf`） | `correct.ts` | `refuses a linked worktree in record mode too` |
| 把 `at` 改成写死常量 | `correct.ts` | `writes one row keyed by … stamped now` 的时刻区间断言 |

- [ ] **Step 7: 提交**

```bash
git add src/corrections/correct.ts tests/corrections/harness.ts tests/corrections/record.test.ts
git commit -m "feat(correct): record a correction without taking any lock, behind the preflight both modes share"
```

---

### Task 9: 闭环骨架 —— 守卫、锁、次序、一次落盘（**不含提交**）

**Files:**
- Create: `src/corrections/originalDecision.ts`
- Create: `src/corrections/gitState.ts`（本任务只填守卫，提交留给 Task 10）
- Modify: `src/corrections/correct.ts`
- Test: `tests/corrections/close.test.ts`

**Interfaces:**
- Produces: `DECISION_NOT_FOUND = "original-decision-not-found"` /
  `readOriginalDecision(decisionsDir, decisionId): Promise<DecisionEvent>`
- Produces: `TARGET_MID_OPERATION = "target-mid-git-operation"` /
  `midOperationRejection(repo): Promise<PlanRejection | undefined>`
- Produces: `REPO_LOCKED = "repo-locked"` / `MISSING_CHOSE_INSTEAD = "no-chose-instead"`
- Consumes: `acquireRepoLock`（既有）、`appendEvents`（Task 1）、`deriveRows`（Task 6）、
  `loadCorrection` / `recordCorrection`（Task 5）、`deriveFixRunId`（Task 4）

- [ ] **Step 0: 🔴 先量守卫的边界，别猜**

§14.3 的两条实测是本任务的前提，**实施者必须自己重跑一次**（不同 git 版本上结论可能不同）：

```bash
P=/private/tmp/claude-501/.../scratchpad/guard; /bin/rm -rf "$P"; mkdir -p "$P"
# 造「cherry-pick 冲突已解决、尚未 --continue」，逐项打印 .git 下的状态文件与部分提交能不能做
# ⇒ 期望复现 spec §14.3：CHERRY_PICK_HEAD 存在、MERGE_HEAD 不存在、无 rebase 目录、
#   HEAD 未 detached、unmerged 为 0，而 `git commit -m … -- <path>` 得
#   `fatal: cannot do a partial commit during a cherry-pick.` EXIT=128
# 同一脚本再量 cherry-pick -n / revert -n / merge --squash / 冲突已解决的 revert
# ⇒ spec 说这四种【允许】部分提交 ⇒ 守卫不许拦它们
```

⚠️ *** **如果实测与 spec 不符（例如 `cherry-pick -n` 也留下 `CHERRY_PICK_HEAD`），停手升人。** ***
那意味着「守卫拦谁」这条设计判断需要人重新拍，不是实施者顺手决定的事。
**把整份实测输出落盘留证。**

- [ ] **Step 1: 写失败判据 `tests/corrections/close.test.ts`**

（下列每条都是一个 `it`，**消息断言一律排在退出码断言前面** —— 前面的断言会先短路，
要量什么就把它放在第一位。）

```ts
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCorrections } from "../../src/corrections/store.js";
import { captureStreams, git, makeTargetRepo, runCli, withCorrectionsDir } from "./harness.js";

const closeArgs = (repo: string, overrides: string[] = []) => [
  "correct", "--repo", repo, "--by", "amy",
  "--decision", "orca-dev-1/1", "--kind", "not_my_taste", "--because", "进程内互斥跨进程无效",
  "--chose-instead", "改用文件租约",
  "--undo-how", "删掉 src/scheduler/pool.ts 里的那处互斥",
  ...overrides,
];

async function ledgerFiles(decisionsDir: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  return (await readdir(decisionsDir).catch(() => [] as string[])).filter((n) => n.endsWith(".jsonl")).sort();
}
```

| 判据 | 夹具 | 断言（**第一条就是要量的那件事**） |
|---|---|---|
| **闭环跑通（正向观测）** | 干净仓库 ＋ 已 seed 的原 decision | exit 0；`.decisions/` 多出一个 `orca-fix-*.jsonl`；它恰有两行，第一行 `ev==="decision"`、第二行 `ev==="overturned"` 且 `replacedBy === <新 id>`、`id === "orca-dev-1/1"` |
| **E16（命令层）** | 同上 | 两行的 `at` **都落在调用前后两次 `new Date().toISOString()` 之间**，且**都不等于** correction 行的 `at` |
| **E21（命令层）** | 加 `--undo-cost 改一个文件` | 落盘 decision 的 `undo.cost === "改一个文件"` 且**不含**「继承自」；不给时**含**「继承自 orca-dev-1/1」 |
| **E11(a)** | `--decision orca-dev-1/99` | `stderr` 含 `rejected: original-decision-not-found:` **且不含** `references unknown decision id`（那是检查 5 的措辞，离原因太远）；exit 1 |
| **E11(b)（真正钉次序的那条）** | 同上 | *** **corrections 文件不存在、`.decisions/` 的文件名集合与调用前逐字相同** *** |
| **E8b** | 预先 `mkdir <repo>/.git/orca-lock` | `stderr` 含 `rejected: repo-locked:`；**exit 4**；corrections 文件不存在；`.decisions/` 未变 |
| **E19** | 先记一条同 `(projectKey, decisionId, by)` 的 correction，再跑闭环（不带 `--again`） | 拒绝之后 *** **`<repo>/.git/orca-lock` 不存在** *** —— 否则该仓库对 `orca run` 永久关门 |
| **E15** | Step 0 造出来的「冲突已解决、未 `--continue`」的 cherry-pick | `stderr` 含 `rejected: target-mid-git-operation:` 且点名 `cherry-pick`；exit 1；**corrections 文件与 `.decisions/` 都一个字节没变** |
| **E4′（故障注入）** | `--undo-how 改一下`（散文，过不了可执行谓词） | *** **corrections 行已在盘上**（`readCorrections` 长度 1）**而 `.decisions/` 没有新文件** ***；exit 非 0 |
| **E3b** | 先只记一条 `kind=wrong`（无 `chose_instead`），再 `--close <id>` 不给 `--chose-instead` | `stderr` 含 `rejected: no-chose-instead:` **且消息点名 `--chose-instead`**；exit 1；`.decisions/` 未变 |
| **`--close` 的条件互斥** | 存储行**已有** `chose_instead`，`--close` 又给一个 | `stderr` 含 `rejected: close-argument-conflict:`；exit 1 |
| **🔴 E6** | **直接写** corrections 文件两行：除 `by`（`amy`／`bob`）外**逐字节相同**（含 `at`），id 用 `deriveCorrectionId` 各自算 | *** **两次 `--close` 都 exit 0**；`.decisions/` 里出现**两个不同的** `orca-fix-*.jsonl`；两个文件各有一条 `overturned` *** |

⚠️ *** **E6 的夹具为什么直接写文件而不走 CLI** ***：两个人的 `at` 必须**逐字节相同**，否则
两条 correction 的 id 本来就不同 —— *** **变异（从 `CORRECTION_FIELDS` 去掉 `by`）会照绿，判据不可证伪** ***（§14.11(a)）。
而 CLI 的 `at` 取自真实时钟，无法在不加时钟接缝的前提下钉住。**直接写存储文件是这条判据的输入，不是绕过被测路径**
（被测的是 `--close` 这条路）。
⚠️ **变异后的预期红**：两条 correction 算出同一个 id ⇒ 第二次 `--close` 读回的是**第一条**、
派生出**同一个 run id** ⇒ 撞上幂等两问 ⇒ 报「已经闭过环」并 exit 0 ⇒
*** **红在「`.decisions/` 里应该有两个文件」这条断言上**，不是崩溃。 ***

- [ ] **Step 2: 跑它，确认它红**

- [ ] **Step 3: 实现 `src/corrections/originalDecision.ts`**

```ts
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { decisionEventSchema } from "../ledger/schema.js";
import type { DecisionEvent } from "../ledger/schema.js";
import { CorrectRejection } from "./rejection.js";

export const DECISION_NOT_FOUND = "original-decision-not-found";

/**
 * spec §5: reject a decision id that is not there, HERE — not by letting
 * appendEvents' check 5 catch it later. Check 5's message is about a reference
 * that would not resolve; the actual cause is that the person mistyped
 * `--decision`, and a message four layers from the cause is the shape §12
 * finding 2 and §14.13 keep killing.
 */
export async function readOriginalDecision(
  decisionsDir: string,
  decisionId: string,
): Promise<DecisionEvent> {
  const names = await readdir(decisionsDir).catch(() => [] as string[]);
  for (const name of names) {
    if (!name.endsWith(".jsonl")) continue;
    const text = await readFile(join(decisionsDir, name), "utf8");
    for (const raw of text.split("\n")) {
      if (raw.trim().length === 0) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue; // Someone else's malformed line is `orca validate`'s problem.
      }
      const candidate = (parsed as { ev?: unknown; id?: unknown });
      if (candidate.ev === "decision" && candidate.id === decisionId) {
        return decisionEventSchema.parse(parsed);
      }
    }
  }

  throw new CorrectRejection(
    DECISION_NOT_FOUND,
    `no decision with id ${JSON.stringify(decisionId)} in ${decisionsDir} — check the --decision argument`,
  );
}
```

- [ ] **Step 4: 实现 `src/corrections/gitState.ts` 的守卫**（按 Step 0 的实测结果定名单）

```ts
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const TARGET_MID_OPERATION = "target-mid-git-operation";

/**
 * 闭-3: every one of these reads, and all of them run BEFORE anything is
 * written (§14.3, third seat). The reason they exist is measured, not
 * defensive: `git commit -m … -- <path>` — a PARTIAL commit — is refused
 * during a cherry-pick with `fatal: cannot do a partial commit during a
 * cherry-pick`, exit 128, and in the first version that refusal arrived AFTER
 * the two ledger rows had irreversibly landed.
 *
 * ⚠️ The rejection surface of a partial commit is wider than an ordinary
 * commit's. Measured (2026-09-07, re-run at implementation time — see the
 * plan's Task 9 Step 0): with a cherry-pick whose conflicts are resolved but
 * not continued, CHERRY_PICK_HEAD exists while MERGE_HEAD does not, there is
 * no rebase directory, HEAD is not detached, and there are no unmerged
 * entries — so a guard built from the obvious three lets it straight through.
 */
export async function midOperationRejection(
  repo: string,
): Promise<{ code: string; message: string } | undefined> {
  const gitDir = join(repo, ".git");
  const present = async (name: string): Promise<boolean> =>
    stat(join(gitDir, name)).then(() => true, () => false);

  const states: Array<[string, boolean]> = [
    ["a merge", await present("MERGE_HEAD")],
    ["a cherry-pick", await present("CHERRY_PICK_HEAD")],
    ["a revert", await present("REVERT_HEAD")],
    ["a rebase", (await present("rebase-merge")) || (await present("rebase-apply"))],
  ];

  const detached = await execFileAsync("git", ["symbolic-ref", "--quiet", "HEAD"], { cwd: repo })
    .then(() => false)
    .catch(() => true);
  if (detached) states.push(["a detached HEAD", true]);

  const active = states.find(([, isActive]) => isActive);
  if (active === undefined) return undefined;

  return {
    code: TARGET_MID_OPERATION,
    message:
      `${repo} is in the middle of ${active[0]} — orca correct commits the ledger by path, and git refuses a ` +
      `partial commit in this state. Finish or abort it and re-run the same command; nothing has been written.`,
  };
}
```

- [ ] **Step 5: 把闭环那条线填进 `src/corrections/correct.ts`**

**次序不许动**（§14.3；每一步旁边那句注释是它存在的理由）：

```ts
  // 闭-3: read-only guards, all of them before any write.
  const midOperation = await midOperationRejection(parsed.repo);
  if (midOperation !== undefined) {
    throw new CorrectRejection(midOperation.code, midOperation.message);
  }

  const decisionsDir = join(parsed.repo, ".decisions");

  // 闭-4: for the non---close path the decision id is right there on the
  // command line, so this read costs nothing and moves the "you mistyped
  // --decision" rejection AHEAD of every write. The second seat's I-F ("the
  // original can only be read after the stored row") is true for --close and
  // ONLY for --close; applying it to both paths is what made a typo write a
  // permanent junk correction row first and reject afterwards.
  let original =
    parsed.mode === "close-new" ? await readOriginalDecision(decisionsDir, parsed.decisionId) : undefined;

  // 闭-5: the repo lock, and from here on everything is inside try/finally.
  // §14.3 (second seat, C-B): the rejections below are the EXPECTED path — a
  // release written as the last statement is skipped by every one of them, and
  // the leftover lock directory then blocks every future `orca run` on this
  // repository until someone deletes it by hand.
  const repoLock = await acquireRepoLock(parsed.repo).catch((err: unknown) => {
    throw new CorrectRejection(
      REPO_LOCKED,
      `another orca process holds the repo lock on ${parsed.repo}: ${(err as Error).message}`,
      4,
    );
  });

  try {
    // 闭-6: the store's critical section (its own lock, inside this one —
    // the order is fixed at repo → store, and `orca run` never takes the
    // store lock, so the two cannot deadlock).
    let row: Correction;
    if (parsed.mode === "close-existing") {
      row = await loadCorrection(dir, parsed.correctionId);
      if (row.chose_instead !== undefined && parsed.choseInstead !== undefined) {
        throw new CorrectRejection(
          CLOSE_ARG_CONFLICT,
          `correction ${row.id} already says what was chosen instead (${row.chose_instead}); ` +
            `--chose-instead may only supply one that is missing`,
        );
      }
      original = await readOriginalDecision(decisionsDir, row.decisionId);
    } else {
      const base = { projectKey, decisionId: parsed.decisionId, kind: parsed.kind,
        chose_instead: parsed.choseInstead, because: parsed.because,
        at: new Date().toISOString(), by: parsed.by };
      row = { id: deriveCorrectionId(base), ...base };
      await recordCorrection(dir, row, { again: parsed.again });
    }

    const choseInstead = row.chose_instead ?? parsed.choseInstead;
    if (choseInstead === undefined) {
      // §14.4 (C4): a `wrong`/`stale` row recorded in record-only mode has no
      // chose_instead, and the new decision's `chose` can come from nowhere
      // else. Refused by name here rather than four layers down in the schema.
      throw new CorrectRejection(
        MISSING_CHOSE_INSTEAD,
        `correction ${row.id} does not say what was chosen instead — pass --chose-instead to supply it`,
      );
    }

    const { id: _id, ...rowFields } = row;
    const runId = deriveFixRunId(rowFields, row.id);

    // 闭-7 (Task 10 adds the branch-independent idempotence questions in front
    // of this): ONE landing, both rows, one appendFile.
    const at = new Date().toISOString();
    const { decision, overturned } = deriveRows({
      correction: row, original: original as DecisionEvent, choseInstead,
      undo: parsed.undo, at, runId,
    });
    await appendEvents(decisionsDir, runId, [decision, overturned]);

    // 闭-8 lands in Task 10.
    return 0;
  } finally {
    await repoLock.release();
  }
```

- [ ] **Step 6: 跑判据，确认全绿**

- [ ] **Step 7: 跑变异**

| 变异 | 落点 | 期望红在 |
|---|---|---|
| **E11(a)**：把 `DECISION_NOT_FOUND` 的消息换成检查 5 的措辞 | `originalDecision.ts` | E11(a) 的**消息断言** |
| **E11(b)**：把闭-4 那句 `readOriginalDecision` 移到 `recordCorrection` **之后** | `correct.ts` | E11(b) 的「corrections 文件不存在」 |
| **E15**：把守卫名单砍成只有 merge／rebase／detached | `gitState.ts` | E15 的**消息断言** |
| **E8b**：删掉闭-5 整段取锁 | `correct.ts` | E8b 的 `rejected: repo-locked:` |
| **E19**：把 `await repoLock.release()` 从 `finally` 挪到 `return 0` 前面 | `correct.ts` | E19 的「`orca-lock` 不存在」 |
| **E4′**：调换闭-6 与闭-7（先 `appendEvents` 再 `recordCorrection`） | `correct.ts` | E4′ 的「corrections 行已在盘上」 |
| **E3b**：删掉 `choseInstead === undefined` 那道拒绝 | `correct.ts` | E3b 的**消息断言** |
| **E16**：把 `at` 改成 `row.at` | `correct.ts` | E16 的时刻区间断言 |
| **🔴 E6**：从 `CORRECTION_FIELDS` 去掉 `"by"`（**变异落在 `fields.ts`**） | `fields.ts` | E6 的「`.decisions/` 里应该有两个文件」 |

⚠️ **E6 这条变异 Task 4 已经跑过一次（单元层）** —— *** **代码改了以后要重跑，本轮在命令层再跑一次。** ***

- [ ] **Step 8: 提交**

```bash
git add src/corrections/originalDecision.ts src/corrections/gitState.ts src/corrections/correct.ts tests/corrections/close.test.ts
git commit -m "feat(correct): guard, lock and order the closing path so a rejection never leaves a write behind"
```

---
### Task 10: 提交与幂等 —— 闭-8、exit 5、以及**分支无关**的那两问

**Files:**
- Modify: `src/corrections/gitState.ts`（加提交与幂等两问）
- Modify: `src/corrections/correct.ts`（闭-7 前面加幂等、闭-8 落地）
- Test: `tests/corrections/commit.test.ts`

**Interfaces:**
- Produces: `LEDGER_COMMIT_REFUSED = "ledger-commit-refused"` /
  `commitLedgerFile(repo, relPath, message): Promise<void>` /
  `alreadyCommitted(repo, relPath, correctionId): Promise<{ commit: string; refs: string } | undefined>`
- Consumes: `git` ＋ `ORCA_IDENTITY`（`src/scheduler/gitExec.ts`，既有）

- [ ] **Step 1: 写失败判据 `tests/corrections/commit.test.ts`**

| 判据 | 夹具 | 断言（**要量的那件事排第一**） |
|---|---|---|
| **E14** | 干净仓库跑一次闭环 | `git status --porcelain` **为空**；`git show --name-only --format= HEAD` **只列出** `.decisions/<runId>.jsonl` |
| **🔴 E14b** | 跑闭环**之前**先 `git add` 一个别的文件（`mine.txt`） | HEAD 那一笔**仍只含**台账文件；*** **`mine.txt` 仍在索引里**（`git diff --cached --name-only` 含它） *** |
| **🔴 E5a** | 同一条 `--close` 跑第二次 | 第二次 exit 0；*** **整个 `.decisions/` 里 `overturned` 的总条数仍为 1** ***；`.decisions/` 的文件名集合未变 |
| **🔴 E5c（分支无关）** | 在分支 `W` 上闭环并提交 → `git checkout -` 回主线 → 重跑同一条 `--close` | exit 0；**主线工作树没有新写入**（`git status --porcelain` 为空、`.decisions/` 文件名集合未变）；`stdout` **点名它在哪个 ref 上**（含 `W` 或那笔提交的 sha） |
| **🔴 E5b（恢复路径）** | 装一个 `exit 1` 的 `.git/hooks/pre-commit`，跑闭环 | 第一趟：`stderr` 含 `rejected: ledger-commit-refused:`、**exit 5**、`git status --porcelain` **列出**台账路径。删掉钩子后重跑同一条 `--close`：*** **`git rev-parse HEAD` 变了、`git status --porcelain` 不再列出该路径** ***、exit 0 |

⚠️ **E5b 的第二半必须断言 HEAD 与 porcelain**，不能只断言「exit 0」——
*** **第三席实测：只断言非 0／为 0 时，「重跑不再尝试提交」这条变异全程满足。** ***

判据骨架（其余条同形，此处给出最要紧的两条的完整代码）：

```ts
it("commits only the ledger file, and leaves what the person had staged staged", async () => {
  const target = await makeTargetRepo();
  try {
    await withCorrectionsDir(async () => {
      await writeFile(join(target.path, "mine.txt"), "mine\n");
      await git(target.path, ["add", "--", "mine.txt"]);

      const { result: rc } = await captureStreams(() => runCli(closeArgs(target.path)));
      expect(rc).toBe(0);

      const committed = (await git(target.path, ["show", "--name-only", "--format=", "HEAD"]))
        .split("\n").filter((l) => l.length > 0);
      expect(committed).toHaveLength(1);
      expect(committed[0]).toMatch(/^\.decisions\/orca-fix-[0-9a-f]{8}\.jsonl$/);

      const staged = await git(target.path, ["diff", "--cached", "--name-only"]);
      expect(staged).toContain("mine.txt");
    });
  } finally {
    await target.cleanup();
  }
});

it("re-running the same close after a hook refused the commit finishes it", async () => {
  const target = await makeTargetRepo();
  try {
    await withCorrectionsDir(async (dir) => {
      const hook = join(target.path, ".git", "hooks", "pre-commit");
      await writeFile(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });

      const first = await captureStreams(() => runCli(closeArgs(target.path)));
      expect(first.stderr).toContain("rejected: ledger-commit-refused:");
      expect(first.result).toBe(5);
      expect(await git(target.path, ["status", "--porcelain"])).toContain(".decisions/");

      const headBefore = (await git(target.path, ["rev-parse", "HEAD"])).trim();
      await rm(hook);

      const correctionId = (await readCorrections(dir))[0].id;
      const second = await captureStreams(() =>
        runCli(["correct", "--repo", target.path, "--by", "amy", "--close", correctionId,
          "--undo-how", "删掉 src/scheduler/pool.ts 里的那处互斥"]),
      );
      expect((await git(target.path, ["rev-parse", "HEAD"])).trim()).not.toBe(headBefore);
      expect(await git(target.path, ["status", "--porcelain"])).not.toContain(".decisions/");
      expect(second.result).toBe(0);
    });
  } finally {
    await target.cleanup();
  }
});
```

- [ ] **Step 2: 跑它，确认它红**

- [ ] **Step 3: 在 `gitState.ts` 里实现提交与幂等两问**

```ts
import { ORCA_IDENTITY, git } from "../scheduler/gitExec.js";
import { CorrectRejection } from "./rejection.js";

export const LEDGER_COMMIT_REFUSED = "ledger-commit-refused";

/**
 * 闭-8. Two halves, both required (measured 2026-09-06 in a throwaway repo,
 * re-measured at implementation time):
 *
 *   git add -- <path> ; git commit -m …            → commits the WHOLE index,
 *                                                    sweeping in what the
 *                                                    person had staged
 *   git commit -m … -- <path>   (alone)            → `error: pathspec … did
 *                                                    not match any file(s)
 *                                                    known to git` — the
 *                                                    ledger file is untracked
 *   git add -- <path> ; git commit -m … -- <path>  → ✅ only the ledger file,
 *                                                    the person's staging intact
 *
 * ORCA_IDENTITY for the same reason land.ts uses it: this is an accounting
 * commit. WHO made the correction is carried by the row's `by` and by the
 * message, not by the committer.
 *
 * No `--no-verify`: the target repository's hooks are not orca's to bypass
 * (registered, §14.19 item 16). No `git reset` on failure either — undoing a
 * person's index is not this program's business.
 */
export async function commitLedgerFile(repo: string, relPath: string, message: string): Promise<void> {
  await git(repo, ["add", "--", relPath]);
  try {
    await git(repo, [...ORCA_IDENTITY, "commit", "-m", message, "--", relPath]);
  } catch (err) {
    throw new CorrectRejection(
      LEDGER_COMMIT_REFUSED,
      `the ledger rows are written to ${relPath} and staged, but git refused the commit: ` +
        `${(err as Error).message.trim()} — fix that and re-run the same --close, which will finish this step`,
      5,
    );
  }
}

/**
 * 🔴 The idempotence question, asked of the REPOSITORY rather than of this
 * worktree (§14.1, third seat). A closing commit lands on whatever branch the
 * person is standing on — after a round that is usually W — so asking only
 * "is the row in the file in front of me" answers "no" the moment they switch
 * back to the main line, and the same correction gets written a second time.
 * With §14.5's real write moments the two versions differ byte for byte, which
 * turns an append-only file that was supposed to be structurally
 * conflict-proof into a content conflict at merge time.
 *
 * `-S<correctionId>` is a pickaxe over every ref: it finds the commit that
 * introduced this correction id into that path, wherever it lives.
 */
export async function alreadyCommitted(
  repo: string,
  relPath: string,
  correctionId: string,
): Promise<{ commit: string; refs: string } | undefined> {
  const log = await git(repo, ["log", "--all", `-S${correctionId}`, "--format=%H", "--", relPath]).catch(
    () => "",
  );
  const commit = log.trim().split("\n")[0];
  if (commit === undefined || commit.length === 0) return undefined;

  const refs = await git(repo, ["for-each-ref", "--contains", commit, "--format=%(refname)"]).catch(() => "");
  return { commit, refs: refs.trim().split("\n").filter((r) => r.length > 0).join(", ") || "(no ref)" };
}
```

- [ ] **Step 4: 把幂等两问与闭-8 接进 `correct.ts`**

```ts
    const relPath = join(".decisions", `${runId}.jsonl`);

    // Question 2 first: if the rows are already committed somewhere, both
    // halves are done and there is nothing left to do. §14.1 (second seat,
    // C-D): exit 0 here must mean landed AND committed — a friendly "already
    // done" that only checked the file would make a hook-refused commit
    // permanently unrecoverable, because every re-run would report success.
    const committed = await alreadyCommitted(parsed.repo, relPath, row.id);
    if (committed !== undefined) {
      process.stdout.write(
        `correction ${row.id} was already closed: ${relPath} at ${committed.commit} (${committed.refs})\n`,
      );
      return 0;
    }

    // Question 1: written in this worktree but not committed — finish the
    // commit rather than writing the rows a second time.
    const alreadyWritten = await readFile(join(decisionsDir, `${runId}.jsonl`), "utf8")
      .then((text) => text.includes(row.id))
      .catch(() => false);

    if (!alreadyWritten) {
      const at = new Date().toISOString();
      const { decision, overturned } = deriveRows({ /* …as in Task 9… */ });
      await appendEvents(decisionsDir, runId, [decision, overturned]);
    }

    await commitLedgerFile(
      parsed.repo,
      relPath,
      `ledger: overturn ${original.id} after ${row.by}'s correction ${row.id}`,
    );
    process.stdout.write(`closed correction ${row.id}: ${relPath} committed on the current branch\n`);
    return 0;
```

- [ ] **Step 5: 跑判据，确认全绿**

- [ ] **Step 6: 跑变异**

| 变异 | 落点 | 期望红在 |
|---|---|---|
| **E14**：删掉 `commitLedgerFile` 那一句调用 | `correct.ts` | E14 的 `git status --porcelain` 为空 |
| **E14b**：去掉 `commit` 的 `"--", relPath`（保留 `add -- relPath`） | `gitState.ts` | E14b 的「HEAD 那一笔只含台账文件」 |
| **E5a**：把 `deriveFixRunId` 的第二个入参换成 `Buffer.from(new Date().toISOString())` | `fields.ts` | E5a 的「`overturned` 总条数仍为 1」 |
| **E5c**：把幂等改成只问工作树（删掉 `alreadyCommitted` 那一问） | `correct.ts` | E5c 的「主线工作树没有新写入」 |
| **E5b**：让重跑不再尝试提交（`if (!alreadyWritten) { … } else return 1;`） | `correct.ts` | E5b 第二半的 **HEAD 与 porcelain** 断言 |

- [ ] **Step 7: 提交**

```bash
git add src/corrections/gitState.ts src/corrections/correct.ts tests/corrections/commit.test.ts
git commit -m "feat(correct): commit only the ledger file it wrote, and make re-running the close finish it"
```

---

### Task 11: 验收、文档、收尾

🔴 **§10 那条只在本刀成立的验收**：*** **在一次性目标仓库里跑一次真的 `orca correct` 闭环，
让第一条 `overturned` 真的落盘，并用 `orca validate` 判它 ok。** ***
⚠️ *** **在一次性仓库里做，不在本仓库的 `.decisions/` 里做 —— 那是不可逆的。** ***

- [ ] **Step 1: 手跑一次真闭环（**不是判据，是验收**）**

```bash
V=/private/tmp/claude-501/.../scratchpad/accept; /bin/rm -rf "$V"; mkdir -p "$V/repo" "$V/corrections"
cd "$V/repo" && git init && git remote add origin https://github.com/biran/throwaway.git \
  && git -c user.name=t -c user.email=t@invalid commit --allow-empty -m init
# 用本仓库的 tsx 跑：先造一条原 decision，再 correct
cd /Users/biran/code/skills/loop/Orca
ORCA_CORRECTIONS_DIR="$V/corrections" npx tsx src/cli.ts correct \
  --repo "$V/repo" --by "$(git config user.name)" \
  --decision '<原 decision id>' --kind not_my_taste --because '<理由>' \
  --chose-instead '<新选择>' --undo-how '<可执行的撤销说明>' > "$V/correct.log" 2>&1
echo "CORRECT_RC=$?"; cat "$V/correct.log"
npx tsx src/cli.ts validate "$V/repo/.decisions" > "$V/validate.log" 2>&1
echo "VALIDATE_RC=$?"; cat "$V/validate.log"
```

**期望**：`CORRECT_RC=0`；`VALIDATE_RC=0` 且输出 `ok: N ledger file(s)`；
`$V/repo` 的 `git status --porcelain` **为空**；HEAD 那一笔只含 `.decisions/orca-fix-*.jsonl`。
⚠️ *** **原 decision 要先真的写进 `$V/repo/.decisions/`** ***（用 `appendEvent` 或手写一行合法的 decision）。
**整份日志留在 scratchpad 里，收尾报告要引它。**

- [ ] **Step 2: 更新 `README.md`**

补三处，**每一句都要与刚跑过的那次验收一致**（README 是活文档，但**写进去的每个结构性断言都必须现测**）：
1. 子命令表加 `orca correct` 两种模式；
2. **六个退出码**（0／1／3／4／5，外加 `validate` 的 2）；
3. corrections 存储的位置与改道方式（`ORCA_CORRECTIONS_DIR`）、文件权限、
   以及**它写在仓库外面**这件事。

- [ ] **Step 3: 🔴 跑完整判据 ＋ 现测两个数**

```bash
rtk proxy npm run verify > /tmp/final-verify.log 2>&1; echo "VERIFY_RC=$?"; cat /tmp/final-verify.log
```
**期望 exit 0**；把**两个**判据数（全仓 / scheduler 档）都抄进收尾报告，
并与开工基线 **60/317、51/167** 对照说明**新增了多少条**。
⚠️ **别混着比。**

- [ ] **Step 4: 交叉引用机械扫一遍（§14.23 第 7 条）**

把本计划与 spec 里出现的每一个 `§14.x` 引用拿去比对**实际存在的小节标题**，零悬空引用才算完。
⚠️ *** **写下一条记法和执行一条记法是两件事** *** —— 上一轮就是在写完这条记法的同一次自查里
发现 §14.0 指着一个当时并不存在的 §14.24。

- [ ] **Step 5: 记台账**

`.decisions/orca-dev-0382dc91.jsonl`，**全部经 `appendEvent`**（不手写文件）。至少这几条：
1. **correction id 的派生输入从「5 字段管道拼接」改为「规范 JSON」** —— 依据 §14.0 ＋ §14.11，
   被否掉的那条（保留 §4 字面公式）的代价是**两处定义仍然存在，E6 的变异仍然没有单一落点**；
2. **§14.24 的字面实现使 `kind=not_my_taste` 不能再「只记不闭环」** —— 登记为**待人裁**；
3. `parseCorrectArgs` 的**测试接缝**（注入 `git config user.name` 的读取），被否掉的是「真加一个 CLI 开关」；
4. Task 9 Step 0 的守卫实测结论（若与 spec 不符则是**升人**，不是决策）。

- [ ] **Step 6: 更新三份 handoff**

- **Orca**：`docs/handoff/handoff.md` **追加一节**（不就地改上文），写清：做完了什么、
  两个判据数的现测值与观测锚点、每条实测都带命令、**没做的事**（未 push／未派评审／
  裁决甲的 `plan` 那一半仍未动／子系统 D 仍未开）、以及下一件事。
- **ccloop**：*** **只在「📌 Orca 那条线」那一节里整节重写**，不新增编号章节 *** （人 2026-09-02 定的规矩）。
  本刀对它的实质影响：`orca correct` **从设计变成了代码** —— 它现在是一个真的会**改目标仓库工作树并自己提交**
  的写入方。**动笔前先现测它的工作树是干净的，收尾用「节外内容 sha256 前后相同」证明没碰别人的东西。**
- **ccmem**：⚠️ *** **先问人。** *** 上一轮人明确说**另一个 agent 正在改 ccmem**，本轮零触碰是默认档。

- [ ] **Step 7: 收尾现测远端**

```bash
git ls-remote origin refs/heads/main > /tmp/final-remote.log 2>&1; cat /tmp/final-remote.log
git log --oneline -1
```
⚠️ *** **同一会话里远端被人推动是常态**（已连续四个会话发生）。 ***
⇒ **收尾这一次现测是必须的**：它决定本轮新写的注释与文档从此刻起属于「已发布」还是「未发布」。
⚠️ *** **不 push。控制器不许 push。** ***

- [ ] **Step 8: 报花费**

**只抄钩子报出来的数**（CLAUDE.md Rule 14）。**拿不到就说拿不到，不许自估。**

---

## Self-Review（**本计划写完后当场自查，三项**）

### 1. spec 覆盖

| spec 小节 | 落在哪个任务 |
|---|---|
| §14.1 一次落盘 ＋ 空批 ＋ 批内 Check B | Task 1（E9b／E18／E18b／E9-ledger） |
| §14.1 分支无关的幂等两问 ＋「exit 0 要求落盘与提交都完成」 | Task 10（E5c／E5a／E5b） |
| §14.2 逐字段派生 ＋ 七条变异 | Task 6（E13） |
| §14.3 共用只读预检 | Task 8（E2b）＋ Task 9 |
| §14.3 只记模式不取 repo 锁 | Task 8（E20） |
| §14.3 闭-3 状态守卫（含 cherry-pick／revert） | Task 9（E15 ＋ Step 0 的实测） |
| §14.3 闭-4 提前读原 decision | Task 9（E11(b)） |
| §14.3 提交的确切写法 ＋ 前提 | Task 10（E14／E14b） |
| §14.3 锁在 `finally` 里释放 | Task 9（E19） |
| §14.3 残留表 | Task 9（E4′）＋ Task 10（E5b 的 exit 5 残留） |
| §14.4 `--close` 条件互斥 ＋ 没有 `chose_instead` 就拒 | Task 7（互斥）＋ Task 9（E3b） |
| §14.5 两个 `at` 都是写入时刻 | Task 6（单元）＋ Task 9（E16 命令层） |
| §14.6 语义查重的键含 `projectKey` | Task 5（E10a） |
| §14.7 查重的读与追加在同一次持锁内 | Task 5（E10d，单边 barrier ＋ sleep 短于超时） |
| §14.8 store 锁父目录递归建 | Task 3 |
| §14.9 复用谓词与码、不复用消息 | Task 8（E2b 断言 `not.toContain("this round")`） |
| §14.10 E4′ 故障注入 | Task 9 |
| §14.11 `by` 只有一处定义 | Task 4（单元）＋ Task 9（E6 命令层） |
| §14.13 判据钉理由不钉退出码、变异不许靠崩溃 | 全篇：每条拒绝判据都断言消息，E1a 的变异改为「返回错但合法的值」 |
| §14.14 六个退出码 | Task 7（映射）＋ Task 3（4）＋ Task 10（5） |
| §14.16 `runId.ts` 追加注释 | Task 4 Step 4 |
| §14.17 权限 ＋ umask 钉住并恢复 | Task 3（目录）＋ Task 5（文件） |
| §14.18 判据表（**现测 33 行**：`grep -c` 表内以 `| **E…**` 开头的行，2026-09-07） | E1a/E1b/E2/E2b/E3/E3b/E4′/E5a/E5b/E5c/E6/E7/E8/E8b/E9/E9b/E10a/E10b/E10c/E10d/E11/E12/E13/E14/E14b/E15/E16/E17/E18/E18b/E19/E20/E21 —— **逐条有家** |
| §14.22 两个 undo 覆盖参数 | Task 6（E21）＋ Task 7（不与 `--close` 互斥） |
| §14.24 表达了闭环意图就不许半途 | Task 7（E3） |
| §10 真闭环验收 ＋ `orca validate` 判 ok | Task 11 Step 1 |

**缺口（登记，不掩饰）**：
- *** **§14.19 第 14 项「闭环模式在一轮 `orca run` 在飞时不可用」没有判据** *** ——
  它是 E8b 的同一条机制的另一面，E8b 已经钉住「repo 锁被持有 ⇒ exit 4 且零写入」。**不另造判据。**
- *** **§7.4「跨机共享文件系统上互斥不成立」没有判据，也不该有** *** —— 它是**已登记不做**的边界（§9 第 5 项）。
- **§14.19 第 17 项（`why_not` 永久是模板散文）** 是已接受的代价，E13 的 deep-equal 顺带钉住了它的文本。

### 2. 占位符扫描

本计划中**唯一**的占位是 Task 7 判据里的 `--no-git-identity-for-test`，
**已在同一步用「改成注入式 resolver」写明处置**，并明令不许把占位留进代码。
其余每一步都给了可直接运行的命令或可直接粘贴的代码。
⚠️ Task 10 Step 4 的代码块里有一处 `/* …as in Task 9… */` —— *** **实施时必须写全，不许照抄这个注释。** ***

### 3. 类型一致

- `CorrectRejection(code, message, exitCode)` 在 Task 2 定义，Task 3／5／7／8／9／10 全部按同一签名使用；
- `deriveFixRunId(row: CorrectionRow, correctionId: string)` 的第一个入参是**不含 `id`** 的行 ——
  Task 9 用 `const { id: _id, ...rowFields } = row` 取出来，与 Task 4 的 `CorrectionRow = Omit<Correction, "id">` 一致；
- `deriveRows` 的 `undo` 字段名是 `{ how, cost?, blastRadius? }`（camelCase），
  落盘后的字段名是 `blast_radius`（snake_case，schema 定的）—— **两者不是同一个名字，别混**；
- `midOperationRejection` 与 `unlockableTargetRejection` 都返回 `{ code, message } | undefined`，
  与 `PlanRejection` 结构相同，可直接互换。

---

## Execution Handoff

计划已保存到 `docs/superpowers/plans/2026-09-07-corrections-store-and-writer.md`。
