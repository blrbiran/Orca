# `corrections` / `overturned` 字段形状 —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 把 `overturned` 的六个必填字段与 `corrections` 的 DB 侧 schema 落成代码，并把检查 5 的作用域按事件类型分档，使 `overturned` 在它唯一的真实用例（跨 run 推翻）上写得出来。

**Architecture:** 三层不变 —— `schema.ts` 定形状、`validateLine.ts` 按事件名路由到穷尽映射、`validateFile.ts` 判引用存在性；作用域由调用方**必填**传入，`cli.ts` 与 `writer.ts` 各自负责把它建全。`corrections` 是**纯 schema**，无 DB、无写入方、无 CLI。

**Tech Stack:** TypeScript (ESM, `"type": "module"`)、zod ^3.23.8、vitest ^2.0.5、tsx。

**Spec:** `docs/superpowers/specs/2026-09-05-corrections-overturned-design.md`
**台账（13 条裁决，带理由与代价）:** `.decisions/orca-dev-c1c3c2ec.jsonl`

## Global Constraints

- **不许实施者自改判据。** 本计划**只授权改写三条**既有判据（Task 1 的 A/B、Task 2 的 C），**逐条点名在对应步骤里**。碰到第四条 ⇒ **停下来找人**，不许自己改。
- **每个新分支配一条删掉【它自己】的变异，并且必须【被看见】打红。** 靠崩溃变红不算证据；红必须红在目标断言上。
- **变异只在 `git clone --local` 副本里做。** 主工作树用 `shasum -a 256` 证明零触碰。
- **绝不过滤验证性跑**：一律 `命令 > 文件 2>&1; echo $?` 再整份读回。
- **`.superpowers/` 与 `.decisions/` 之外的历史文本不许就地改**；已发布文本只能追加具名 ERRATUM。
- **本机 `rm`/`cp` 有 `-i` alias** ⇒ 一律 `/bin/rm -rf`、`cat pristine > target`。
- **push / 合并 main / 删分支或 worktree：每次单独找人。控制器不许 push。**
- **成功判据：`npm run verify` exit 0。** 开工基线 **50 files / 165 tests**。

## File Structure

| 文件 | 责任 | 本轮动作 |
|---|---|---|
| `src/ledger/schema.ts` | 事件形状的唯一真相源 | 加 `overturnedEventSchema` ＋ 穷尽映射 `REFERENCE_EVENT_SCHEMAS` |
| `src/ledger/validateLine.ts` | 单行检查 1–4 ＋ 路由 | 路由改吃映射；降级**保持 `bound` 专属**并加注释 |
| `src/ledger/validateFile.ts` | 检查 5（引用存在性） | 作用域分档；新增**必填**参数 |
| `src/cli.ts` | `validate` 子命令 | 两趟：先收 id，再带作用域验 |
| `src/ledger/writer.ts` | 落盘前的闸门 | **一律**建作用域；Check A 扩到 `overturned` |
| `src/corrections/schema.ts`（**新**） | corrections 的 DB 侧形状 | 新建 |
| `tests/ledger/overturnedEvent.test.ts`（**新**） | `overturned` 的字段判据 | 新建 |
| `tests/ledger/correctionSchema.test.ts`（**新**） | corrections 的判据 | 新建 |

---

## Task 1: `overturnedEventSchema` ＋ 穷尽路由映射

**Files:**
- Modify: `src/ledger/schema.ts`（在 `boundEventSchema` 之后追加）
- Modify: `src/ledger/validateLine.ts`（路由那一段）
- Create: `tests/ledger/overturnedEvent.test.ts`
- Modify（**已授权改写**）: `tests/ledger/validateLine.test.ts` 两处 —— 见 Step 6/7

**Interfaces:**
- Produces: `overturnedEventSchema`、`OverturnedEvent`、`REFERENCE_EVENT_SCHEMAS: Record<ReferenceEventName, z.ZodTypeAny>`
- Consumes: 既有 `referenceEventSchema`、`boundEventSchema`、`isReferenceEventName`

- [ ] **Step 1: 写失败判据**

新建 `tests/ledger/overturnedEvent.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { validateLine } from "../../src/ledger/validateLine.js";

/** 六字段齐全的 overturned —— spec §3 的字面示例。 */
function overturned(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    ev: "overturned",
    id: "run-7c/3",
    correctionId: "c_01J9X",
    replacedBy: "run-9d/2",
    at: "2026-09-05T18:04:11Z",
    run: "run-9d",
    ...over,
  });
}

describe("overturned — spec §3: six required fields, none optional", () => {
  it("accepts a complete overturned", () => {
    expect(validateLine(overturned()).verdict).toBe("ok");
  });

  // M1×6. 只追加的台账里，可选字段就是永远拿不到的字段（裁决 orca-dev-c1c3c2ec/5）。
  for (const field of ["ev", "id", "correctionId", "replacedBy", "at", "run"]) {
    it(`rejects an overturned missing ${field}`, () => {
      const parsed = JSON.parse(overturned()) as Record<string, unknown>;
      delete parsed[field];
      const result = validateLine(JSON.stringify(parsed));
      // 缺 ev 时走的是「unknown ev」那条，同样必须是 rejected，不是 downgraded。
      expect(result.verdict).toBe("rejected");
    });
  }

  // 6.1：这条降级有两道独立守卫，冗余守卫钉不住；这里钉的是【结果】不是守卫。
  it("rejects — does not downgrade — an overturned missing a required field", () => {
    const result = validateLine(overturned({ correctionId: undefined }));
    expect(result.verdict).toBe("rejected");
  });

  it("keeps passthrough: an extra note field does not make it invalid", () => {
    expect(validateLine(overturned({ note: "落地于本笔提交" })).verdict).toBe("ok");
  });
});
```

- [ ] **Step 2: 跑它，确认它红**

```bash
npx vitest run tests/ledger/overturnedEvent.test.ts > /tmp/t1.txt 2>&1; echo $?
```
Expected: **FAIL** —— `accepts a complete overturned` 之外的每条 `rejects …` 都失败（今天 `overturned` 只钉 `ev` ＋ `id`，缺字段照样 `ok`）。**整份读回 `/tmp/t1.txt` 确认失败原因是断言，不是导入错误。**

- [ ] **Step 3: 加 schema**

在 `src/ledger/schema.ts` 的 `boundEventSchema` 定义之后追加：

```ts
/**
 * overturned 是三个引用类事件里唯一被完整钉死的那个 —— 它零存量（现测
 * decision 87 / bound 7 / superseded 0 / overturned 0），所以没有任何历史行
 * 需要被宽 schema 保护，而它一旦写下就再也改不了。六个字段全部必填：
 * 只追加的文件里，可选字段就是永远拿不到的字段。
 *
 * ev 必须显式覆盖成 literal —— referenceEventSchema.ev 是三个名字的 z.enum，
 * 不覆盖的话这个 schema 就不是「只认 overturned」的（裁决 orca-dev-c1c3c2ec/3 复审 4）。
 * bound 有同款松弛，那是既有的，本轮不动。
 */
export const overturnedEventSchema = referenceEventSchema.extend({
  ev: z.literal("overturned"),
  correctionId: z.string().min(1),
  replacedBy: z.string().min(1),
  at: z.string().min(1),
  run: z.string().min(1),
});

export type OverturnedEvent = z.infer<typeof overturnedEventSchema>;

/**
 * 事件名 → schema 的穷尽映射。做成 Record<ReferenceEventName, …> 而不是一串
 * 三元，是为了让「加了第四个引用类事件名却忘了给它 schema」变成一个
 * 编译错误而不是一次静默的 unknown ev。M7 钉的就是这条。
 */
export const REFERENCE_EVENT_SCHEMAS: Record<ReferenceEventName, z.ZodTypeAny> = {
  bound: boundEventSchema,
  superseded: referenceEventSchema,
  overturned: overturnedEventSchema,
};
```

- [ ] **Step 4: 路由改吃映射**

在 `src/ledger/validateLine.ts`：把 import 里的 `boundEventSchema` 换成 `REFERENCE_EVENT_SCHEMAS`（`referenceEventSchema` 若不再被引用则一并移除），并把

```ts
    const schema = ev === "bound" ? boundEventSchema : referenceEventSchema;
```

整行换成

```ts
    const schema = REFERENCE_EVENT_SCHEMAS[ev];
```

同时在 `issuesAreOnlyMissingAttribution` 的调用处（`if (ev === "bound" && …)`）**上方**追加注释：

```ts
      // ⚠️ 这条降级有【两道彼此独立的守卫】：这里的 ev === "bound"，以及
      // ATTRIBUTION_FIELDS 只含 taskId / runId。overturned 的字段一个都不在
      // 后者里，所以单独放宽任何一道都不会有判据变红 —— 冗余守卫按构造就
      // 钉不住。这句注释是它唯一的护栏（spec §6.1，裁决 orca-dev-c1c3c2ec/10）。
      // 【不要】为此编一条「能红」的判据：那样的判据什么也证明不了。
```

- [ ] **Step 5: 跑判据，确认变绿**

```bash
npx vitest run tests/ledger/overturnedEvent.test.ts > /tmp/t1b.txt 2>&1; echo $?
```
Expected: **PASS**，10 条全绿。

- [ ] **Step 6: 改写既有判据 A（人已指名授权）**

`tests/ledger/validateLine.test.ts` —— 把

```ts
  it("accepts overturned with only ev and id", () => {
    expect(validateLine(line({ ev: "overturned", id: "run-7c/3" })).verdict).toBe("ok");
  });
```

整块换成

```ts
  // 编码的是裁决 orca-dev-c1c3c2ec/5：overturned 的合法来源只有面板 correction
  // 一种，correctionId 必填，因此「只有 ev 与 id」不再是一条合法记录。原判据
  // 编码的是它的前身（决策 orca-dev-09cc3ea1/5，引用类事件只钉 ev ＋ id）。
  // 这是收紧，不是放宽。完整的六字段判据在 tests/ledger/overturnedEvent.test.ts。
  it("rejects overturned with only ev and id — it now carries four more required fields", () => {
    expect(validateLine(line({ ev: "overturned", id: "run-7c/3" })).verdict).toBe("rejected");
  });
```

⚠️ **`accepts superseded with only ev and id`（紧邻上方那条）一字不动** —— 实测 `superseded` 仍走宽 schema。

- [ ] **Step 7: 改写既有判据 B（人已指名授权）**

同文件，把

```ts
  it("still accepts superseded and overturned without those fields", () => {
    // Deliberately not tightened: only bound carries "which task implemented
    // this". Requiring the fields everywhere would be scope this plan has no
    // authority to take.
    expect(validateLine(JSON.stringify({ ev: "superseded", id: "run-7c/3" })).verdict).toBe("ok");
    expect(validateLine(JSON.stringify({ ev: "overturned", id: "run-7c/3" })).verdict).toBe("ok");
  });
```

整块换成

```ts
  it("still accepts superseded without those fields", () => {
    // superseded 仍然只钉 ev 与 id。原判据把 overturned 和它并列，理由是
    // 「Requiring the fields everywhere would be scope this plan has no
    // authority to take」—— 那条边界属于 P1；裁决 orca-dev-c1c3c2ec/5 越过了
    // 它，但【只对 overturned】。superseded 没有被本轮碰过，这半条原样保留。
    expect(validateLine(JSON.stringify({ ev: "superseded", id: "run-7c/3" })).verdict).toBe("ok");
  });
```

- [ ] **Step 8: 跑整套，确认没有第四条被打红**

```bash
npm test -- --run > /tmp/t1c.txt 2>&1; echo $?
```
Expected: **exit 0**。⚠️ **若出现本计划没点名的第三条红判据 ⇒ 停下来找人，不许自己改。**

- [ ] **Step 9: 变异 M1（抽样两条）与 M7**

```bash
SP=<scratchpad>; /bin/rm -rf $SP/mut && git clone --local . $SP/mut > $SP/clone.txt 2>&1; echo $?
cp $SP/mut/src/ledger/schema.ts $SP/mut/schema.pristine
shasum -a 256 src/ledger/schema.ts src/ledger/validateLine.ts > $SP/main-before.txt
```

- **M1-correctionId**：副本里把 `correctionId: z.string().min(1),` 改成 `correctionId: z.string().min(1).optional(),` ⇒ 跑 `npx vitest run tests/ledger/overturnedEvent.test.ts`，**期望红在 `rejects an overturned missing correctionId`**。
- **M1-ev**：把 `ev: z.literal("overturned"),` 整行删掉 ⇒ **期望红**（`ev` 退回三选一枚举，`{ev:"bound", …}` 会被 overturned 的 schema 接受）。若不红，说明没有判据在钉 literal ⇒ **补一条断言 `validateLine` 对 `overturned` schema 直接喂 `ev:"bound"` 的行为**，不要跳过。
- **M7**：把 `REFERENCE_EVENT_SCHEMAS` 里 `overturned: overturnedEventSchema,` 整行删掉 ⇒ 跑 `npx tsc --noEmit -p tsconfig.json`，**期望退出码非 0**（这条是编译期红，不看测试颜色）。

每条之间 `cat $SP/mut/schema.pristine > $SP/mut/src/ledger/schema.ts` 还原。三条跑完：

```bash
shasum -a 256 src/ledger/schema.ts src/ledger/validateLine.ts > $SP/main-after.txt
diff $SP/main-before.txt $SP/main-after.txt; echo "主树零触碰 rc=$?"
/bin/rm -rf $SP/mut
```

- [ ] **Step 10: 提交**

```bash
git add src/ledger/schema.ts src/ledger/validateLine.ts tests/ledger/overturnedEvent.test.ts tests/ledger/validateLine.test.ts
git commit -m "feat(ledger): pin overturned's six required fields and route reference events through an exhaustive map"
```

---

## Task 2: 检查 5 分档 ＋ 解析域**必填**

**Files:**
- Modify: `src/ledger/validateFile.ts`
- Modify（调用点补参）: `src/cli.ts`、`src/ledger/writer.ts`、`tests/ledger/validateFile.test.ts`（11 处）、`tests/ledger/writer.test.ts`（2 处）
- Modify（**已授权改写**）: `tests/ledger/validateFile.test.ts` 的 overturned 那一条 —— 见 Step 5

**Interfaces:**
- Produces: `export interface ResolutionScope { externalDecisionIds: ReadonlySet<string> }`；`validateFile(rawLines: string[], scope: ResolutionScope): FileVerdict`
- Consumes: Task 1 的 `REFERENCE_EVENT_SCHEMAS`（间接，经 `validateLine`）

- [ ] **Step 1: 写失败判据**

在 `tests/ledger/validateFile.test.ts` 末尾追加（沿用文件顶部既有的 `decisionLine` 辅助）：

```ts
function overturnedLine(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    ev: "overturned",
    id: "run-7c/1",
    correctionId: "c_1",
    replacedBy: "run-9d/1",
    at: "2026-09-05T18:04:11Z",
    run: "run-9d",
    ...over,
  });
}

describe("check 5 的作用域按事件类型分档（裁决 orca-dev-c1c3c2ec/4）", () => {
  // M3：overturned.id 跨文件可解析。fix agent 永远在新的一轮、写新文件，
  // 被推翻的那条 decision 按定义在别的文件里 —— 要求同文件等于让它写不出来。
  it("resolves an overturned's id against the external scope", () => {
    const result = validateFile(
      [decisionLine("run-9d/1"), overturnedLine()],
      { externalDecisionIds: new Set(["run-7c/1"]) },
    );
    expect(result.verdict).toBe("ok");
  });

  // M5：解析不到就是 rejected，不是静默通过。
  it("rejects an overturned whose id is in neither this file nor the scope", () => {
    const result = validateFile(
      [decisionLine("run-9d/1"), overturnedLine()],
      { externalDecisionIds: new Set() },
    );
    expect(result.verdict).toBe("rejected");
    const line = result.lines[1].result;
    expect(line.verdict === "rejected" ? line.reasons.join(" ") : "").toContain("run-7c/1");
  });

  // M4：replacedBy 【不】跨文件 —— 它是 fix agent 自己新写的那条 decision，
  // 必然与这条 overturned 同 run、同文件。放宽它会让「闭环在 git 内可遍历」失效。
  it("does NOT resolve replacedBy against the external scope", () => {
    const result = validateFile(
      [overturnedLine()],
      { externalDecisionIds: new Set(["run-7c/1", "run-9d/1"]) },
    );
    expect(result.verdict).toBe("rejected");
    const line = result.lines[0].result;
    expect(line.verdict === "rejected" ? line.reasons.join(" ") : "").toContain("run-9d/1");
  });

  // bound 维持文件内 —— 实测本仓库 7 条 bound 全部与自己的 decision 同文件。
  it("does NOT resolve a bound's id against the external scope", () => {
    const result = validateFile(
      [boundLine("run-7c/1")],
      { externalDecisionIds: new Set(["run-7c/1"]) },
    );
    expect(result.verdict).toBe("rejected");
  });
});
```

- [ ] **Step 2: 跑它，确认它红**

```bash
npx vitest run tests/ledger/validateFile.test.ts > /tmp/t2.txt 2>&1; echo $?
```
Expected: **FAIL**（`validateFile` 目前只接一个参数；四条新判据全红）。整份读回确认。

- [ ] **Step 3: 实现**

`src/ledger/validateFile.ts` 全文改成：

```ts
import { REFERENCE_EVENT_TYPES } from "./schema.js";
import { validateLine } from "./validateLine.js";
import type { ValidationResult } from "./types.js";

export interface LineVerdict {
  lineNumber: number;
  result: ValidationResult;
}

export interface FileVerdict {
  verdict: "ok" | "downgraded" | "rejected";
  lines: LineVerdict[];
}

/**
 * 本文件之外、同一个 .decisions/ 目录里其它台账贡献的 decision id。
 *
 * 【必填，不是可选】—— 裁决 orca-dev-c1c3c2ec/11。可选参数会把作用域留成
 * 「记得传」，而本轮已经踩过一次同形状的坑（写入方按「这次追加的是什么」
 * 建域，而校验器按「整份文件里有什么」判）。文件内作用域的调用方显式传空
 * 集合，那句 `new Set()` 就是这条判据在说「我度量的是文件内」。
 */
export interface ResolutionScope {
  externalDecisionIds: ReadonlySet<string>;
}

const REFERENCE_EVENTS = new Set<string>(REFERENCE_EVENT_TYPES);

/**
 * spec §3.8 check 5，作用域按事件类型分档（A′ spec 的 ERRATUM 2）：
 *
 * | 引用                       | 作用域   | 为什么                                   |
 * |----------------------------|----------|------------------------------------------|
 * | bound.id                   | 文件内   | 它天然与自己的 decision 同 run           |
 * | overturned.replacedBy      | 文件内   | fix agent 自己新写的 decision，同 run     |
 * | overturned.id / superseded | 目录级   | 跨 run 是它们的常态                       |
 *
 * 依据：decision id 的实际形状是 <run-id>/<n>，全局唯一且自带出处；「必须在
 * 同一文件」从来不是这个 id 的语义要求，只是检查 5 写下时手上只有单文件这
 * 一个视角。
 *
 * 顺序仍然不作要求 —— spec 的措辞是「存在于本文件」，不是「在它之前」。
 */
export function validateFile(rawLines: string[], scope: ResolutionScope): FileVerdict {
  const entries: Array<{ lineNumber: number; raw: string }> = [];
  rawLines.forEach((raw, index) => {
    if (raw.trim().length > 0) {
      entries.push({ lineNumber: index + 1, raw });
    }
  });

  const fileDecisionIds = new Set<string>();
  for (const entry of entries) {
    try {
      const parsed = JSON.parse(entry.raw) as { ev?: unknown; id?: unknown };
      if (parsed.ev === "decision" && typeof parsed.id === "string") {
        fileDecisionIds.add(parsed.id);
      }
    } catch {
      // 解析不了的行留给 validateLine 去拒；这里只收 id。
    }
  }

  const scopedIds = new Set<string>(fileDecisionIds);
  for (const id of scope.externalDecisionIds) scopedIds.add(id);

  const unresolved = (ev: string, what: string, id: unknown, where: "file" | "scope"): ValidationResult => ({
    verdict: "rejected",
    reasons: [
      `${ev} references unknown decision id in ${what}: ${JSON.stringify(id)}` +
        (where === "scope"
          ? ` (searched this file plus ${scope.externalDecisionIds.size} external id(s); validate the whole .decisions/ directory to widen the scope)`
          : " (this reference must resolve inside its own file)"),
    ],
  });

  const lines: LineVerdict[] = entries.map((entry) => {
    const result = validateLine(entry.raw);
    if (result.verdict === "rejected") {
      return { lineNumber: entry.lineNumber, result };
    }

    let parsed: { ev?: unknown; id?: unknown; replacedBy?: unknown };
    try {
      parsed = JSON.parse(entry.raw) as { ev?: unknown; id?: unknown; replacedBy?: unknown };
    } catch {
      return { lineNumber: entry.lineNumber, result };
    }

    if (typeof parsed.ev === "string" && REFERENCE_EVENTS.has(parsed.ev)) {
      const fileScoped = parsed.ev === "bound";
      const pool = fileScoped ? fileDecisionIds : scopedIds;
      if (typeof parsed.id !== "string" || !pool.has(parsed.id)) {
        return {
          lineNumber: entry.lineNumber,
          result: unresolved(parsed.ev, "id", parsed.id, fileScoped ? "file" : "scope"),
        };
      }
      if (parsed.ev === "overturned") {
        if (typeof parsed.replacedBy !== "string" || !fileDecisionIds.has(parsed.replacedBy)) {
          return {
            lineNumber: entry.lineNumber,
            result: unresolved(parsed.ev, "replacedBy", parsed.replacedBy, "file"),
          };
        }
      }
    }

    return { lineNumber: entry.lineNumber, result };
  });

  const hasRejected = lines.some((l) => l.result.verdict === "rejected");
  const hasDowngraded = lines.some((l) => l.result.verdict === "downgraded");

  return {
    verdict: hasRejected ? "rejected" : hasDowngraded ? "downgraded" : "ok",
    lines,
  };
}
```

- [ ] **Step 4: 给全部既有调用点补参（12 处，度量的东西一字未变）**

在 `tests/ledger/validateFile.test.ts`、`tests/ledger/writer.test.ts`、`src/cli.ts`、`src/ledger/writer.ts` 里，把每个 `validateFile(X)` 改成 `validateFile(X, { externalDecisionIds: new Set() })`。
⚠️ `src/cli.ts` 与 `src/ledger/writer.ts` 两处**只是先补空集合让它编译过**，Task 3／Task 4 再把真作用域接上。

- [ ] **Step 5: 改写既有判据 C（人已指名授权，spec §6.2）**

`tests/ledger/validateFile.test.ts` —— 把

```ts
  it("rejects when an overturned references an id that does not exist", () => {
    const result = validateFile([JSON.stringify({ ev: "overturned", id: "run-7c/9" })], { externalDecisionIds: new Set() });
    expect(result.verdict).toBe("rejected");
  });
```

整块换成

```ts
  // 编码裁决 orca-dev-c1c3c2ec/13。原判据的字面量只有 ev 与 id，Task 1 之后
  // 它会先被 schema 拒、根本走不到检查 5 —— 判据照绿，名字却还写着
  // "references an id that does not exist"。这里补齐五个字段，让【唯一】的
  // 缺陷是那个不可解析的 id，并断言拒绝的【理由】，不再只断文件级判词。
  it("rejects when an otherwise-valid overturned references an id that does not exist", () => {
    const result = validateFile(
      [decisionLine("run-9d/1"), overturnedLine({ id: "run-7c/9" })],
      { externalDecisionIds: new Set() },
    );
    expect(result.verdict).toBe("rejected");
    const line = result.lines[1].result;
    expect(line.verdict === "rejected" ? line.reasons.join(" ") : "").toContain("run-7c/9");
  });
```

⚠️ **紧邻上方的 `superseded` 那条一字不动** —— 实测它不受影响（`superseded` 保持宽 schema，仍是被检查 5 拒的）。

- [ ] **Step 6: 跑整套**

```bash
npm test -- --run > /tmp/t2b.txt 2>&1; echo $?
```
Expected: **exit 0**。整份读回。

- [ ] **Step 7: 变异 M3 / M4 / M5**

副本里逐条做，每条之间从 pristine 还原：
- **M3**：`const pool = fileScoped ? fileDecisionIds : scopedIds;` → `const pool = fileDecisionIds;` ⇒ 期望红在 `resolves an overturned's id against the external scope`。
- **M4**：`!fileDecisionIds.has(parsed.replacedBy)` → `!scopedIds.has(parsed.replacedBy)` ⇒ 期望红在 `does NOT resolve replacedBy against the external scope`。
- **M5**：把 `id` 那个 `return { … unresolved(…) }` 整块删掉（改成不 return） ⇒ 期望红在 `rejects an overturned whose id is in neither…`。

三条都要**整份读回测试输出，确认红在点名的那条断言上**，不是红在崩溃或别的判据上。

- [ ] **Step 8: 提交**

```bash
git add src/ledger/validateFile.ts src/cli.ts src/ledger/writer.ts tests/ledger/validateFile.test.ts tests/ledger/writer.test.ts
git commit -m "feat(ledger): scope check 5 by event type and make the resolution scope a required argument"
```

---

## Task 3: `orca validate` 改两趟

**Files:**
- Modify: `src/cli.ts`（`runValidate`）
- Modify: `tests/cli/cli.test.ts`（追加判据）

**Interfaces:**
- Consumes: Task 2 的 `ResolutionScope`
- Produces: 无新导出

- [ ] **Step 1: 写失败判据**

在 `tests/cli/cli.test.ts` 末尾追加：

```ts
import { mkdtemp, writeFile } from "node:fs/promises";

describe("validate — 目录级解析域（裁决 orca-dev-c1c3c2ec/4）", () => {
  function decision(id: string, run: string): string {
    return JSON.stringify({
      ev: "decision", id, at: "2026-09-05T18:04:11Z", run,
      question: "q", chose: "c",
      alternatives: [{ option: "o", why_not: "w" }],
      because: "b",
      undo: { how: "git checkout <sha> -- README.md", cost: "x", blast_radius: "y" },
      scope: "repo", kind: "scheduling",
    });
  }

  it("resolves an overturned against a decision that lives in a sibling ledger file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orca-cli-scope-"));
    await writeFile(join(dir, "run-7c.jsonl"), decision("run-7c/1", "run-7c") + "\n");
    await writeFile(
      join(dir, "run-9d.jsonl"),
      decision("run-9d/1", "run-9d") + "\n" +
        JSON.stringify({
          ev: "overturned", id: "run-7c/1", correctionId: "c_1",
          replacedBy: "run-9d/1", at: "2026-09-05T18:04:11Z", run: "run-9d",
        }) + "\n",
    );
    expect(await main(["validate", dir])).toBe(0);
  });

  it("still rejects when that decision exists in no file in the directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orca-cli-scope-"));
    await writeFile(
      join(dir, "run-9d.jsonl"),
      decision("run-9d/1", "run-9d") + "\n" +
        JSON.stringify({
          ev: "overturned", id: "run-7c/1", correctionId: "c_1",
          replacedBy: "run-9d/1", at: "2026-09-05T18:04:11Z", run: "run-9d",
        }) + "\n",
    );
    expect(await main(["validate", dir])).toBe(1);
  });
});
```

- [ ] **Step 2: 跑它，确认第一条红**

```bash
npx vitest run tests/cli/cli.test.ts > /tmp/t3.txt 2>&1; echo $?
```
Expected: **FAIL**，第一条判据得到 1 而不是 0（`runValidate` 仍逐文件独立验）。

- [ ] **Step 3: 实现两趟**

`src/cli.ts` 的 `runValidate`：把「读文件 → 立刻 `validateFile`」的单趟循环，换成先收后验：

```ts
  // 两趟：一条 overturned 引用的 decision 按定义住在【别的】run 的文件里
  // （fix agent 永远是新的一轮），所以单趟逐文件验判不了它。第一趟把这次扫到
  // 的全部文件的 decision id 收齐，第二趟带着它验 —— 于是「解析不到」这个
  // 结论的作用域就等于「本次扫到的东西」，而拒绝消息会把这个作用域说出来。
  const texts = new Map<string, string>();
  const allDecisionIds = new Set<string>();
  for (const file of files) {
    const text = await readFile(file, "utf8");
    texts.set(file, text);
    for (const raw of text.split("\n")) {
      if (raw.trim().length === 0) continue;
      try {
        const parsed = JSON.parse(raw) as { ev?: unknown; id?: unknown };
        if (parsed.ev === "decision" && typeof parsed.id === "string") allDecisionIds.add(parsed.id);
      } catch {
        // 解析不了的行由第二趟的 validateFile 去拒。
      }
    }
  }

  for (const file of files) {
    const verdict = validateFile(texts.get(file)!.split("\n"), { externalDecisionIds: allDecisionIds });
    // …以下逐行打印与 sawRejected / sawDowngraded 的累计【一字不改】…
  }
```

- [ ] **Step 4: 跑判据 ＋ 整套**

```bash
npx vitest run tests/cli/cli.test.ts > /tmp/t3b.txt 2>&1; echo $?
npm run verify > /tmp/t3c.txt 2>&1; echo $?
```
Expected: 两者都 **0**。

- [ ] **Step 5: 变异**

副本里把第二趟的 `{ externalDecisionIds: allDecisionIds }` 改成 `{ externalDecisionIds: new Set() }`
⇒ 期望红在 `resolves an overturned against a decision that lives in a sibling ledger file`。

- [ ] **Step 6: 提交**

```bash
git add src/cli.ts tests/cli/cli.test.ts
git commit -m "feat(cli): resolve reference events against every ledger the validate run scanned"
```

---

## Task 4: `writer.ts` —— 一律建作用域 ＋ Check A 扩到 `overturned`

**Files:**
- Modify: `src/ledger/writer.ts`
- Modify: `tests/ledger/writer.test.ts`（追加判据）

**Interfaces:**
- Consumes: Task 2 的 `ResolutionScope`
- Produces: 无新导出（`appendEvent` 签名不变）

- [ ] **Step 1: 写失败判据**

在 `tests/ledger/writer.test.ts` 末尾追加（沿用既有的 `tempDir` / `validDecision` 辅助）：

```ts
function overturnedFor(id: string, replacedBy: string, run: string) {
  return { ev: "overturned", id, correctionId: "c_1", replacedBy, at: "2026-09-05T18:04:11Z", run };
}

describe("appendEvent — 跨文件引用与作用域（裁决 orca-dev-c1c3c2ec/9）", () => {
  it("accepts an overturned whose id lives in a sibling ledger in the same directory", async () => {
    const dir = await tempDir();
    await appendEvent(dir, "run-7c", validDecision("run-7c/1"));
    await appendEvent(dir, "run-9d", validDecision("run-9d/1"));
    await expect(
      appendEvent(dir, "run-9d", overturnedFor("run-7c/1", "run-9d/1", "run-9d")),
    ).resolves.toBeUndefined();
  });

  // M10：这条是本轮 spec 初稿最严重的错误的判据。作用域必须【一律】建，
  // 因为预演校验每次都重验整份文件 —— 按「这次追加的是什么」建域，会让
  // 写完 overturned 之后的下一次追加把它判成不可解析并抛错。
  it("still accepts a later, unrelated append to a file that already holds a cross-file overturned", async () => {
    const dir = await tempDir();
    await appendEvent(dir, "run-7c", validDecision("run-7c/1"));
    await appendEvent(dir, "run-9d", validDecision("run-9d/1"));
    await appendEvent(dir, "run-9d", overturnedFor("run-7c/1", "run-9d/1", "run-9d"));
    await expect(
      appendEvent(dir, "run-9d", validDecision("run-9d/2")),
    ).resolves.toBeUndefined();
  });

  // M6：Check A 扩到 overturned —— run 必须命名它落进去的那个文件。
  it("refuses an overturned whose run field does not name the file it lands in", async () => {
    const dir = await tempDir();
    await appendEvent(dir, "run-7c", validDecision("run-7c/1"));
    await appendEvent(dir, "run-9d", validDecision("run-9d/1"));
    await expect(
      appendEvent(dir, "run-9d", overturnedFor("run-7c/1", "run-9d/1", "run-7c")),
    ).rejects.toThrow(/does not match the ledger file/);
  });
});
```

⚠️ `validDecision(id)` 既有辅助产出的 `run` 字段必须与 `appendEvent` 的 runId 一致 —— 若它硬编码了 `probe`，**在本 describe 里改用本地辅助**，不要动既有辅助（那会波及别的判据）。

- [ ] **Step 2: 跑它，确认三条都红**

```bash
npx vitest run tests/ledger/writer.test.ts > /tmp/t4.txt 2>&1; echo $?
```
Expected: **FAIL**，三条都红。整份读回，确认红的是断言不是导入。

- [ ] **Step 3: 实现**

`src/ledger/writer.ts`：

(a) 顶部 import 增加 `readdir`：`import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";`

(b) Check A 那段整体换成：

```ts
  // Check A: 一条 decision 或 overturned 的 run 字段必须命名它落进去的那个文件。
  // C 会在同一个进程里、对好几个仓库写好几份台账；run 与文件名不符会让下游
  // 的每一次归属都错，而所有既有检查照绿。overturned 一并纳入是裁决
  // orca-dev-c1c3c2ec/5 的直接后果：它的 run 是归属的一半（另一半是 at）。
  const evName = (event as { ev?: unknown }).ev;
  const run = (event as { run?: unknown }).run;
  if ((evName === "decision" || evName === "overturned") && run !== runId) {
    throw new Error(
      `refusing to append: run field ${JSON.stringify(run)} does not match the ledger file for run ${JSON.stringify(runId)}`,
    );
  }
```

(c) 在读 `existingText` 之后、`validateFile` 调用之前，插入：

```ts
  // 【一律】建跨文件解析域，与本次追加的是什么事件无关。
  //
  // 这里曾经写过一个「只在追加 overturned / superseded 时才扫目录」的优化，
  // 它是错的：下面的预演校验重验的是【整份文件】，所以只要文件里已经躺着一条
  // 跨文件的 overturned，任何一次后续追加（哪怕是一条普通 decision）都会把它
  // 判成不可解析并抛错。作用域的需要由「文件里有什么」决定，不由「这次追加的
  // 是什么」决定 —— 裁决 orca-dev-c1c3c2ec/9，判据见 writer.test.ts 里那条
  // "still accepts a later, unrelated append"。
  const externalDecisionIds = new Set<string>();
  const siblings = await readdir(decisionsDir).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [] as string[];
    throw error;
  });
  for (const name of siblings) {
    if (!name.endsWith(".jsonl") || name === `${runId}.jsonl`) continue;
    const text = await readFile(join(decisionsDir, name), "utf8");
    for (const raw of text.split("\n")) {
      if (raw.trim().length === 0) continue;
      try {
        const parsed = JSON.parse(raw) as { ev?: unknown; id?: unknown };
        if (parsed.ev === "decision" && typeof parsed.id === "string") externalDecisionIds.add(parsed.id);
      } catch {
        // 别的台账里解析不了的行不是本次追加的问题。
      }
    }
  }
```

(d) 预演调用改成 `validateFile((existingText + payload).split("\n"), { externalDecisionIds })`。

- [ ] **Step 4: 跑判据 ＋ 整套**

```bash
npx vitest run tests/ledger/writer.test.ts > /tmp/t4b.txt 2>&1; echo $?
npm run verify > /tmp/t4c.txt 2>&1; echo $?
```
Expected: 两者都 **0**。

- [ ] **Step 5: 变异 M10 / M6**

- **M10**：副本里把 `const externalDecisionIds = new Set<string>();` 之后的整段扫目录逻辑，包进
  `if (evName === "overturned" || evName === "superseded") { … }` ⇒
  **期望红在 `still accepts a later, unrelated append to a file that already holds a cross-file overturned`**。
  ⚠️ 这条是本轮最重要的变异 —— **必须亲眼看见它红在那一条上**，红在别处不算。
- **M6**：把 `(evName === "decision" || evName === "overturned")` 改回 `evName === "decision"` ⇒
  期望红在 `refuses an overturned whose run field does not name the file it lands in`。

- [ ] **Step 6: 提交**

```bash
git add src/ledger/writer.ts tests/ledger/writer.test.ts
git commit -m "fix(ledger): build the cross-file resolution scope on every append, not only for reference events"
```

---

## Task 5: `src/corrections/schema.ts`

**Files:**
- Create: `src/corrections/schema.ts`
- Create: `tests/ledger/correctionSchema.test.ts`

**Interfaces:**
- Produces: `CORRECTION_KINDS`、`CorrectionKind`、`correctionSchema`、`Correction`
- Consumes: 无

- [ ] **Step 1: 写失败判据**

新建 `tests/ledger/correctionSchema.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { correctionSchema } from "../../src/corrections/schema.js";

function correction(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "c_01J9X",
    projectKey: "github.com/blrbiran/ccloop",
    decisionId: "run-7c/3",
    kind: "not_my_taste",
    chose_instead: "把检查 5 提升到目录级",
    because: "同一文件那个约束不是 id 的语义要求",
    at: "2026-09-05T18:04:11Z",
    by: "biran",
    ...over,
  };
}

describe("correction — spec §4（DB 侧，可迁移）", () => {
  it("accepts a complete not_my_taste correction", () => {
    expect(correctionSchema.safeParse(correction()).success).toBe(true);
  });

  // M9×7：chose_instead 【不】在其中，它由下面 M8 那两条独管。
  for (const field of ["id", "projectKey", "decisionId", "kind", "because", "at", "by"]) {
    it(`rejects a correction missing ${field}`, () => {
      const value = correction();
      delete value[field];
      expect(correctionSchema.safeParse(value).success).toBe(false);
    });
  }

  // M8：只有「人要另一个」这一类才必须说出那个「另一个」（裁决 orca-dev-c1c3c2ec/12）。
  it("rejects a not_my_taste correction with no chose_instead", () => {
    const value = correction();
    delete value.chose_instead;
    expect(correctionSchema.safeParse(value).success).toBe(false);
  });

  for (const kind of ["wrong", "stale"]) {
    it(`accepts a ${kind} correction with no chose_instead — it may have no alternative to name`, () => {
      const value = correction({ kind });
      delete value.chose_instead;
      expect(correctionSchema.safeParse(value).success).toBe(true);
    });
  }

  it("rejects an unknown kind", () => {
    expect(correctionSchema.safeParse(correction({ kind: "dunno" })).success).toBe(false);
  });
});
```

- [ ] **Step 2: 跑它，确认它红**

```bash
npx vitest run tests/ledger/correctionSchema.test.ts > /tmp/t5.txt 2>&1; echo $?
```
Expected: **FAIL**（模块不存在）。

- [ ] **Step 3: 实现**

新建 `src/corrections/schema.ts`：

```ts
import { z } from "zod";

/**
 * corrections 住 DB，不住台账（A′ §4.1，裁决 orca-dev-c1c3c2ec/1）。
 *
 * ⚠️ 严格度比 src/ledger/ 低一档，那是有意的：DB 可迁移，加列改列回填都是
 * 普通 migration，而台账只追加、错过就永远补不上。本轮【不承诺】这个形状
 * 是终局；它没有 DB、没有写入方、也没有 CLI 子命令（spec §4.2）。
 */
export const CORRECTION_KINDS = ["wrong", "not_my_taste", "stale"] as const;
export type CorrectionKind = (typeof CORRECTION_KINDS)[number];

const correctionShape = z
  .object({
    id: z.string().min(1),
    /**
     * git remote URL —— 与 ccmem 的 project_key 同口径。必填，因为 decision id
     * 说不出它的台账住在哪个仓库：run id 是 orca-<taskId>-<hash8>，hash 只吃
     * 契约字节与 base commit，里面没有仓库标识。
     */
    projectKey: z.string().min(1),
    decisionId: z.string().min(1),
    kind: z.enum(CORRECTION_KINDS),
    chose_instead: z.string().min(1).optional(),
    /** 人的理由 —— 对记忆层来说这是全表最值钱的字段（A′ §4.3）。 */
    because: z.string().min(1),
    at: z.string().min(1),
    by: z.string().min(1),
  })
  .strict();

/**
 * 只有「人要另一个」这一类才必须说出那个「另一个」（裁决 orca-dev-c1c3c2ec/12）。
 * wrong（事实错）与 stale（当时对现在不对）都可能指不出替代项 —— 逼它们必填，
 * 拿到的会是被迫编造的内容，而那种污染回填不掉：事后无法区分「人当时真这么想」
 * 和「人被迫填了个字」。放宽可逆，编造不可逆。
 */
export const correctionSchema = correctionShape.superRefine((value, ctx) => {
  if (value.kind === "not_my_taste" && value.chose_instead === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["chose_instead"],
      message: "required when kind is not_my_taste",
    });
  }
});

export type Correction = z.infer<typeof correctionShape>;
```

- [ ] **Step 4: 跑判据 ＋ 整套**

```bash
npx vitest run tests/ledger/correctionSchema.test.ts > /tmp/t5b.txt 2>&1; echo $?
npm run verify > /tmp/t5c.txt 2>&1; echo $?
```
Expected: 两者都 **0**。

- [ ] **Step 5: 变异 M8 / M9 抽样**

- **M8**：副本里把整个 `.superRefine(…)` 删掉（`export const correctionSchema = correctionShape;`）
  ⇒ 期望红在 `rejects a not_my_taste correction with no chose_instead`，**且 `wrong` / `stale` 那两条仍绿**
  （若它们也红，说明分档写反了）。
- **M9-projectKey**：把 `projectKey: z.string().min(1),` 改成 `.optional()` ⇒ 期望红在 `rejects a correction missing projectKey`。

- [ ] **Step 6: 提交**

```bash
git add src/corrections/schema.ts tests/ledger/correctionSchema.test.ts
git commit -m "feat(corrections): pin the DB-side correction shape, with chose_instead required only for not_my_taste"
```

---

## Task 6: 全表变异复跑 ＋ 收尾

**Files:** 无生产改动（**若这一步需要改生产代码，说明前面某个任务没做完**）

- [ ] **Step 1: 重跑【全部】变异**

⚠️ **代码在后续任务里改过，之前跑过的变异必须重跑** —— 这是 ccloop 用血换来的一条。
逐条重跑 **M1-correctionId / M1-ev / M3 / M4 / M5 / M6 / M7 / M8 / M9-projectKey / M10**，
每条：`git clone --local` 副本 → 变异 → 整份读回测试输出 → **确认红在点名的那条断言上** → 从 pristine 还原。

记一张表：变异名 · 期望红的判据名 · 实际红的判据名 · 是否一致。**不一致就是发现，不是噪音。**

- [ ] **Step 2: 主树零触碰证明**

```bash
git status --porcelain > /tmp/t6a.txt 2>&1; cat /tmp/t6a.txt   # 应为空
git diff | wc -c; git diff --cached | wc -c                     # 都应为 0
```

- [ ] **Step 3: 收尾验证**

```bash
npm run verify > /tmp/t6b.txt 2>&1; echo $?
npm run ledger -- validate .decisions > /tmp/t6c.txt 2>&1; echo $?
```
Expected: `verify` **0**；`validate` **2**，且降级行**仍然只有** `orca-dev-09cc3ea1.jsonl` 的 8–14 行。
⚠️ **若冒出第八条降级行 ⇒ 那条「本仓库允许的降级的确切集合」判据会红，停下来查，不许放宽它。**

- [ ] **Step 4: 记台账**

把本轮执行期间做的判断（尤其**与计划不符的地方**）经 `appendEvent` 写进 `.decisions/orca-dev-<本会话>.jsonl`。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "test(ledger): re-run every named mutation after the last code change"
```

---

## Self-Review

**1. Spec coverage** —— 逐节对照：

| spec 节 | 落在哪 |
|---|---|
| §3 `overturned` 六字段 ＋ `ev` literal ＋ passthrough | Task 1 |
| §3.1 闭环可遍历（`replacedBy` 文件内） | Task 2 Step 3 ＋ 判据 |
| §3.2 不带 kind / taskId；`replacedBy` 的顺序约束 | Task 4 Step 3(c) 的注释兑现顺序约束 |
| §4 corrections 八字段 ＋ `chose_instead` 分档 | Task 5 |
| §5 五个文件的改动 | Task 1–5 逐一 |
| §5.1 一律建域 ／ 解析域必填 ／ 不加第四个 verdict | Task 4 ／ Task 2 ／ Task 2 Step 3（`unresolved` 仍返回 `rejected`） |
| §6 变异表 M1×6/M3–M7/M8/M9×7/M10 | Task 1/2/3/4/5 各自 ＋ Task 6 复跑 |
| §6.1 冗余守卫**只写注释不编判据** | Task 1 Step 4 |
| §6.2 判据 C 的授权改写 | Task 2 Step 5 |
| §7 六项登记项 | **本计划不做**，spec 已登记 |
| §9 成功判据 | Task 6 Step 3 |

⚠️ **一处 spec 未覆盖、由计划补上的**：spec §6.2 只登记了**一条**需授权改写的既有判据；
本计划开工普查现测出 **三条**（A/B 在 `validateLine.test.ts`，C 在 `validateFile.test.ts`），
**A 与 B 已另行取得人的指名授权**，落在 Task 1 Step 6/7。**这与 P1 那轮「计划说 2 条、实测 12 条」是同一形状。**

**2. Placeholder scan** —— 已扫：无 TBD／TODO／"similar to Task N"／"add appropriate error handling"。
每个代码步骤都带可粘贴的代码块；每个跑步骤都带命令与期望退出码。

**3. Type consistency** —— 核过：
`ResolutionScope.externalDecisionIds`（`ReadonlySet<string>`）在 Task 2/3/4 三处名字与类型一致；
`REFERENCE_EVENT_SCHEMAS` 在 Task 1 定义、仅在 `validateLine.ts` 消费；
`overturnedLine()` 辅助在 Task 2 Step 1 定义、Task 2 Step 5 复用（**同文件**）；
`overturnedFor()` 在 Task 4 自带（**不同文件，不能跨文件复用**）；
`correctionSchema` 导出名在 Task 5 定义与判据两处一致。
