# 指标核心与查询（E2）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 造出 `orca metrics` —— 一件**纯只读**的事，从各目标仓库的 `.decisions/**` 与全局 corrections store 算出 A′ §4.4 的纠正率、修复率与积压，并交出一个 E3／E4 能直接消费、可逐字节 golden 比对的输出形状。

**Architecture:** 四层，边界照 spec §5：`collect.ts`（fs ＋ git，仓库发现与读取）→ `compute.ts`（**零 fs、零时钟、零 git 的纯函数**，口径的唯一持有者）→ `report.ts`（渲染；耗时只走 stderr）→ `cli.ts` 的第六个子命令。三个辅助单元（`types.ts`／`highTier.ts`／`lenientRead.ts`）从这四层里切出来，**不改变 spec §5 的责任边界**，只是让每个文件保持单一责任。

**Tech Stack:** TypeScript（ESM，`"type": "module"`，相对 import **必须带 `.js` 后缀**）、zod ^3.23.8、vitest ^2.0.5、tsx、Node ^22。**不新增任何依赖** —— 本仓库根依赖今天只有 `zod` 一个，E2 不动它。

**Spec:** `docs/superpowers/specs/2026-09-08-metrics-core-and-query-design.md`
**上游 spec：** `docs/superpowers/specs/2026-08-29-decision-ledger-design.md`（A′，**含本轮新追加的 ERRATUM 3／4／5**）

---

## Global Constraints

以下每一条都是 spec 的项目级要求，**每个任务的验收都隐含包含本节**。数值与措辞逐字抄自 spec。

1. *** **E2 一个字节都不写。** *** 不建任何新存储、不引入任何新写入方、**不取任何已有的锁**（spec §2、§5.1）。
2. *** **`compute.ts` 必须是纯的：零 fs、零时钟、零 git。** *** `now` 由调用方注入（spec §4.3、§5）。
   ⚠️ 这是本设计经外审后**一个字都没改**的那一块，**不许在实施时松动**。
3. **不改台账 schema、不改 `CORRECTION_FIELDS`、不改 `src/corrections/store.ts` 的严格读**（spec §0、§5.3）。
   宽容读取器是**新增的、只给读侧**；`store.ts` 的 `readCorrections` 一个字不动。
4. **扫描耗时只走 stderr，永不进 `--json`**（spec §4.1、§6 第 3 条）—— 它逐次必变，进了输出就再也做不了 golden 比对。
5. **每一个集合都有一条全序，一处都不许依赖 `readdir` 顺序**（spec §6 第 2 条）：
   仓库按 `projectKey` 字典序；`unresolved_decisions` / `unkeyable_repos` / `malformed_lines` 按各自主键字典序；
   kind 桶按 `DECISION_KINDS` / `CORRECTION_KINDS` 的**声明顺序**。
6. **顶层字段名逐一写死在一个常量里**，形状照抄 `src/corrections/fields.ts` 的
   `] as const satisfies …`；序列化按该常量的顺序，**不按对象自身的 key 顺序**（spec §6 第 1 条）。
7. **积压年龄用挂钟**；单调钟只用于扫描耗时（`performance.now()`）（spec §4.1）。
8. **新增退出码 6** ＝「有坏行，但报告已整份打印」。**既有码不动**：
   `1` 输入错、`2` 台账 downgraded（`orca validate` 已占）、`3` 未预料异常、`4` 锁被别人持有、`5` 台账已落盘未提交。
9. *** **Rule 17：判据一律走 `ORCA_CORRECTIONS_DIR` 改道到临时目录。** ***
   **每个任务收尾都要现测 `ls ~/.orca` 仍不存在** —— E2 是只读的，这条应当**平凡成立，正因如此才值得测**（spec §7）。
10. **变异只在 `git clone --local` 副本里做**，主工作树全程零触碰；副本**只克隆已提交状态**（要变异未提交的改动必须先 `cat` 进副本并 `diff` 证明逐字节相同）；
    新副本**没有 `node_modules`** ⇒ `ln -s <主仓库>/node_modules <副本>/node_modules`，再走 `./node_modules/.bin/vitest`。
    🔴 *** **副本的 remote 是路径式** *** ⇒ **绝不要把副本留在任何判据的 `--root` 底下**，否则它会以 `unkeyable_repos` 的身份出现在你自己的判据输出里（spec §8）。
11. *** **一条变异在被【看到】打红之前，它不是判据。** *** 每新增一个分支，点名那条删掉**它自己**的变异，确认它存在且被看见红（CLAUDE.md Rule 9）。
12. **Rule 14：成本、耗时、条数只报工具给出的数，拿不到就说拿不到，不许自估。**
13. **每个任务收尾跑 `rtk proxy npm run verify`（整份重定向到文件再读回，不许 `grep`／`tail` 过滤）。**
    开工基线（观测于 `06b63a7`）：**exit 0**，全仓 **73 files / 398 tests**、scheduler **51 / 167**。
    ⚠️ *** **两个判据数别混着比。** ***

### 本计划替 spec 裁掉的三处（**都是 spec 未定死的，逐条给依据；不同意就在执行前推翻，别默默改**）

| | spec 留白 | 本计划的裁法 | 依据 |
|---|---|---|---|
| **裁一** | §3.4.2 说在 `archive/` 里「定点查那一个文件名」，**但没说 `archive/` 有没有子目录** | *** **在 `archive/` 下【递归】找该 basename** ***，找到多于一个 ⇒ 硬拒（同一个文件名出现两次是真歧义） | 现测 `tests/ledger/appendOnly.test.ts:30` 的归档夹具路径是 `.decisions/archive/2026/run-7c.jsonl` —— *** **归档【有】年份子目录** *** ⇒ 只查 `archive/<basename>` 会漏掉全部真实归档 |
| **裁二** | §3.3 说按 cohort 分桶，**没说桶的粒度** | **固定按月 `YYYY-MM`**，不加 `--bucket` 开关 | Rule 2（YAGNI）：一个没人要过的粒度开关是投机。粒度可改，且改它不影响接口形状 ⇒ 可逆 ⇒ 按 CLAUDE.md Rule 1 第 2 档自裁。**登记在 §「已知边界」** |
| **裁三** | §3.3 要求「输出里必须有一个显式字段说明该桶仍在回填」，**没说那个字段长什么样** | 每个桶带 *** **`counted_through`（＝本次的 as-of）** ***，**不用 `still_backfilling: true`** | **一个恒为 `true` 的布尔是【不可能红】的字段**（Rule 9：钉「什么都没发生」必须配正向观测）。而 cohort 桶**没有关闭时刻** ⇒ 诚实的布尔只能恒真。`counted_through` 随 `--as-of` 变 ⇒ **变异「改成读挂钟 now」在 `--as-of` 跑下 golden 立刻红** |

---

## File Structure

| 文件 | 责任 | 属 spec §5 的哪一层 |
|---|---|---|
| `src/metrics/types.ts` | 观测集类型、输出类型、顶层字段序常量 `METRICS_FIELDS` | 跨层（纯类型 ＋ 常量） |
| `src/metrics/highTier.ts` | 对 `DECISION_KINDS` 的**编译期穷尽分类**（high／low） | compute 的输入常量 |
| `src/metrics/rejection.ts` | `MetricsRejection`（具名硬拒 ＋ 退出码），形状照抄 `corrections/rejection.ts` | cli 的错误通道 |
| `src/metrics/lenientRead.ts` | 宽容行读取器 ＋ `malformed_lines`。**只给读侧** | collect |
| `src/metrics/collect.ts` | 仓库发现（§2.1）、读台账与 corrections、`--as-of` 过滤、归档定点查 | **collect** |
| `src/metrics/compute.ts` | 观测集 → 指标对象。*** 零 fs、零时钟、零 git *** | **compute** |
| `src/metrics/report.ts` | `--json` 与人读表格；**耗时走 stderr** | **report** |
| `src/cli.ts`（改） | `orca metrics` 第六个子命令 ＋ USAGE | **cli** |

**为什么切出 `types.ts`／`highTier.ts`／`lenientRead.ts`**：spec §5 的四格表定的是**责任边界**，不是文件数。
这三个单元各自只有一个责任，且**各自带着自己的变异落点**（分别是第 17、15、7 条）——
塞进 `collect.ts`／`compute.ts` 会让那两个文件同时承担四五件事，评审时无法只否掉其中一件。

---

## Task 1: 高位分类 —— 用编译期穷尽代替第二份白名单

**Files:**
- Create: `src/metrics/highTier.ts`
- Test: `tests/metrics/highTier.test.ts`

**Interfaces:**
- Consumes: `DECISION_KINDS`、`DecisionKind`（`src/ledger/types.ts`，现测 7 个，含 `reconcile`）
- Produces:
  - `export const KIND_TIER: Record<DecisionKind, "high" | "low">`
  - `export function isHighTier(scope: DecisionScope, kind: DecisionKind): boolean`

- [ ] **Step 1: 写会失败的判据**

`tests/metrics/highTier.test.ts`：

```typescript
import { describe, expect, it } from "vitest";
import { DECISION_KINDS } from "../../src/ledger/types.js";
import { KIND_TIER, isHighTier } from "../../src/metrics/highTier.js";

describe("high-tier classification (E2 spec §3.6, A' §3.6 as corrected by ERRATUM 4)", () => {
  // 变异 14 的落点：换回 A' 那份 6 个 kind 的白名单 ⇒ 这条红。
  it("sorts reconcile high — the kind A' §3.6's six-name whitelist left at the bottom", () => {
    expect(KIND_TIER.reconcile).toBe("high");
    expect(isHighTier("repo", "reconcile")).toBe(true);
    expect(isHighTier("cross-repo", "reconcile")).toBe(true);
  });

  // A' §3.6 的另一半：scope 不在 {cross-repo, repo} 就沉底,哪怕 kind 是高位的。
  it("keeps A' §3.6's scope half: a file- or task-scoped decision sinks whatever its kind", () => {
    expect(isHighTier("file", "dependency")).toBe(false);
    expect(isHighTier("task", "reconcile")).toBe(false);
  });

  // 这条是 §3.6 的「治那一类」那一半的运行期一半:编译期一半见 Step 5。
  it("classifies every kind in DECISION_KINDS — no kind may be missing", () => {
    for (const kind of DECISION_KINDS) {
      expect(KIND_TIER[kind]).toMatch(/^(high|low)$/);
    }
    expect(Object.keys(KIND_TIER)).toHaveLength(DECISION_KINDS.length);
  });

  it("keeps the six A' already named high, so this is a widening and not a rewrite", () => {
    for (const kind of ["dependency", "interface", "scheduling", "abandon", "criteria", "boundary"] as const) {
      expect(KIND_TIER[kind]).toBe("high");
    }
  });
});
```

- [ ] **Step 2: 跑它，确认它红**

Run: `rtk proxy npx vitest run tests/metrics/highTier.test.ts > /tmp/t1.txt 2>&1; echo RC=$?; cat /tmp/t1.txt`
Expected: FAIL —— `Cannot find module '../../src/metrics/highTier.js'`

⚠️ **这次的红是「模块不存在」，不是判据红。** 它只证明判据跑到了，**不证明判据承重** —— 承重靠 Step 5 的变异。

- [ ] **Step 3: 写最小实现**

`src/metrics/highTier.ts`：

```typescript
import { DECISION_KINDS } from "../ledger/types.js";
import type { DecisionKind, DecisionScope } from "../ledger/types.js";

/**
 * A' §3.6's high-tier set, as corrected by A' ERRATUM 4.
 *
 * 🔴 An exhaustive classification, NOT a second whitelist. A' §3.6 spells six
 * kinds out in prose; DECISION_KINDS has seven, and the seventh — reconcile,
 * whose own comment calls it "an order of magnitude riskier" — sank to the
 * bottom because nobody updated the prose. Copying that list into a seventh
 * name here would buy exactly the same silence for the eighth kind.
 *
 * Keying a Record by DecisionKind is what makes adding a kind to
 * DECISION_KINDS without classifying it a COMPILE error rather than a silent
 * "low". Same lever as REFERENCE_EVENT_SCHEMAS in ledger/schema.ts and as
 * CORRECTION_FIELDS' `satisfies` in corrections/fields.ts, whose comment says
 * the constraint is there because it "buys a compile error".
 */
export const KIND_TIER: Record<DecisionKind, "high" | "low"> = {
  dependency: "high",
  interface: "high",
  scheduling: "high",
  abandon: "high",
  criteria: "high",
  boundary: "high",
  // A' ERRATUM 4: a class its own source calls an order of magnitude riskier
  // is precisely one that "cuts off future options" — A' §3.6's own test.
  reconcile: "high",
};

/**
 * A' §3.6's rule verbatim: scope ∈ {cross-repo, repo} AND kind in the
 * high set. Both halves, because dropping the scope half would promote every
 * file-scoped naming decision the ledger was told never to report.
 */
const HIGH_SCOPES: ReadonlySet<DecisionScope> = new Set<DecisionScope>(["cross-repo", "repo"]);

export function isHighTier(scope: DecisionScope, kind: DecisionKind): boolean {
  return HIGH_SCOPES.has(scope) && KIND_TIER[kind] === "high";
}

/** Declaration order, for the total order §6 item 2 requires on kind buckets. */
export const KIND_ORDER: readonly DecisionKind[] = DECISION_KINDS;
```

- [ ] **Step 4: 跑判据，确认绿**

Run: `rtk proxy npx vitest run tests/metrics/highTier.test.ts > /tmp/t1.txt 2>&1; echo RC=$?; cat /tmp/t1.txt`
Expected: PASS，4 条全绿

- [ ] **Step 5: 🔴 跑两条变异，各自【看到】红**

**变异 15（spec §8 第 15 条）—— 这条的红是 `tsc`，不是 vitest：**

```bash
D=$(mktemp -d)/copy && git clone --local . "$D" && ln -s "$PWD/node_modules" "$D/node_modules"
cat src/metrics/highTier.ts > "$D/src/metrics/highTier.ts"   # 副本只有已提交状态,先补上工作树版本
diff src/metrics/highTier.ts "$D/src/metrics/highTier.ts" && echo "COPY_IS_BYTE_IDENTICAL"
shasum -a 256 "$D/src/ledger/types.ts"                        # 变异前
# 变异:给 DECISION_KINDS 加第八个 kind,不动 KIND_TIER
python3 - "$D" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1]) / "src/ledger/types.ts"
t = p.read_text()
old = '  "reconcile",\n] as const;'
assert t.count(old) == 1, f"anchor hit {t.count(old)} times, expected 1"
p.write_text(t.replace(old, '  "reconcile",\n  "fabricated",\n] as const;'))
PY
shasum -a 256 "$D/src/ledger/types.ts"                        # 变异后:两个 sha 不等才算落上去
(cd "$D" && ./node_modules/.bin/tsc --noEmit -p tsconfig.json > /tmp/m15.txt 2>&1; echo "TSC_RC=$?" >> /tmp/m15.txt)
cat /tmp/m15.txt
```

Expected: *** **`TSC_RC` 非 0，且报错指向 `KIND_TIER` 缺少属性 `fabricated`。** ***
⚠️ **看到红之后要读一眼错在哪** —— 红在别的地方（比如语法错）就是**假红**，不算。

**变异 14（spec §8 第 14 条）：**

```bash
python3 - "$D" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1]) / "src/metrics/highTier.ts"
t = p.read_text()
old = '  reconcile: "high",'
assert t.count(old) == 1
p.write_text(t.replace(old, '  reconcile: "low",'))
PY
(cd "$D" && ./node_modules/.bin/vitest run tests/metrics/highTier.test.ts > /tmp/m14.txt 2>&1; echo "RC=$?" >> /tmp/m14.txt)
cat /tmp/m14.txt
```

Expected: *** **红在 `sorts reconcile high …` 这一条上。** *** 红在别条 ⇒ 假红。

- [ ] **Step 6: 证明主工作树零触碰，删副本**

```bash
rtk proxy git diff > /tmp/wt.txt 2>&1;        wc -c < /tmp/wt.txt   # 期望只含本任务新增的两个文件
rtk proxy git status --porcelain > /tmp/p.txt 2>&1; cat /tmp/p.txt
/bin/rm -rf "$(dirname "$D")"                 # ⚠️ 本机 rm 有 -i alias,必须走 /bin/rm
ls ~/.orca 2>&1 || echo "ORCA_STILL_ABSENT"   # Rule 17
```

- [ ] **Step 7: 全量判据 ＋ 提交**

```bash
rtk proxy npm run verify > /tmp/v1.txt 2>&1; echo "VERIFY_RC=$?" >> /tmp/v1.txt; cat /tmp/v1.txt
git add src/metrics/highTier.ts tests/metrics/highTier.test.ts
git commit -m "feat(metrics): classify every decision kind at compile time, not in a second whitelist"
```

---

## Task 2: 宽容读取器 —— 坏行排除 ＋ 点名，`store.ts` 一个字不动

**Files:**
- Create: `src/metrics/types.ts`、`src/metrics/lenientRead.ts`
- Test: `tests/metrics/lenientRead.test.ts`

**Interfaces:**
- Consumes: `correctionSchema`（`src/corrections/schema.ts`）、`decisionEventSchema` / `overturnedEventSchema`（`src/ledger/schema.ts`）
- Produces:
  - `export interface MalformedLine { file: string; line: number; bytes: number; reason: string }`
  - `export interface LenientRead<T> { rows: T[]; malformed: MalformedLine[]; lastLineLooksTorn: boolean }`
  - `export function readCorrectionsLeniently(file: string): Promise<LenientRead<Correction>>`
  - `export function readLedgerLeniently(file: string): Promise<LenientRead<DecisionEvent | OverturnedEvent>>`

- [ ] **Step 1: 写会失败的判据**

`tests/metrics/lenientRead.test.ts`：

```typescript
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCorrections } from "../../src/corrections/store.js";
import { readCorrectionsLeniently } from "../../src/metrics/lenientRead.js";

const tempDir = () => mkdtemp(join(tmpdir(), "orca-metrics-lenient-"));

const GOOD = JSON.stringify({
  id: "c_0000000000000001", projectKey: "github.com/biran/orca", decisionId: "orca-dev-1/1",
  kind: "wrong", because: "证据不对", at: "2026-09-01T00:00:00.000Z", by: "amy",
});
const GOOD2 = JSON.stringify({
  id: "c_0000000000000002", projectKey: "github.com/biran/orca", decisionId: "orca-dev-1/2",
  kind: "stale", because: "世界变了", at: "2026-09-02T00:00:00.000Z", by: "amy",
});

describe("lenient read (E2 spec §5.2, §5.3)", () => {
  // 变异 7 的落点:静默排除坏行 ⇒ malformed 为空 ⇒ 这条红。
  it("names a MIDDLE bad line instead of throwing, and keeps every good row", async () => {
    const dir = await tempDir();
    const file = join(dir, "corrections.jsonl");
    await writeFile(file, `${GOOD}\n{ not json\n${GOOD2}\n`);

    const read = await readCorrectionsLeniently(file);

    expect(read.rows.map((r) => r.id)).toEqual(["c_0000000000000001", "c_0000000000000002"]);
    expect(read.malformed).toHaveLength(1);
    expect(read.malformed[0].line).toBe(2);
    expect(read.malformed[0].file).toBe(file);
    expect(read.malformed[0].bytes).toBe(Buffer.byteLength("{ not json", "utf8"));
    expect(read.lastLineLooksTorn).toBe(false);
  });

  // §5.2 第四格:坏行恰好是最后一行 ⇒ 说「很可能有一次写入正在进行」,且不置非 0。
  it("separates a torn LAST line from a corrupt middle one — they get different verdicts", async () => {
    const dir = await tempDir();
    const file = join(dir, "corrections.jsonl");
    await writeFile(file, `${GOOD}\n${GOOD2.slice(0, 40)}`);   // 无末尾换行的半行

    const read = await readCorrectionsLeniently(file);

    expect(read.rows.map((r) => r.id)).toEqual(["c_0000000000000001"]);
    expect(read.lastLineLooksTorn).toBe(true);
    expect(read.malformed).toHaveLength(1);
    expect(read.malformed[0].reason).toContain("still being written");
  });

  // 🔴 变异 21 的【正向对照】。spec §8 第 21 条钉的是「什么都没发生」——
  // 「store.ts 没被改」本身不可能红,所以这里正向观测严格读取器【仍然抛】。
  it("leaves store.ts strict: readCorrections still throws on the same file", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "corrections.jsonl"), `${GOOD}\n{ not json\n${GOOD2}\n`);

    const error = await readCorrections(dir).then(
      () => { throw new Error("readCorrections accepted a malformed line — the strict reader was loosened"); },
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("the strict reader was loosened");
  });

  it("a schema-valid JSON line that is not a correction is malformed, not silently kept", async () => {
    const dir = await tempDir();
    const file = join(dir, "corrections.jsonl");
    await writeFile(file, `{"id":"c_x","projectKey":"k"}\n${GOOD}\n`);

    const read = await readCorrectionsLeniently(file);
    expect(read.rows).toHaveLength(1);
    expect(read.malformed[0].line).toBe(1);
    expect(read.malformed[0].reason).toContain("decisionId");
  });

  it("a missing file reads as empty, not as an error — a repo with no corrections is normal", async () => {
    const dir = await tempDir();
    const read = await readCorrectionsLeniently(join(dir, "corrections.jsonl"));
    expect(read.rows).toEqual([]);
    expect(read.malformed).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑它，确认它红**

Run: `rtk proxy npx vitest run tests/metrics/lenientRead.test.ts > /tmp/t2.txt 2>&1; echo RC=$?; cat /tmp/t2.txt`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 写最小实现**

`src/metrics/types.ts`：

```typescript
/**
 * A line that could not be turned into a row. spec §5.2: excluded from the
 * computation, named in the output, and the report still prints in full.
 *
 * `bytes` rather than the text itself: a corrections line carries a person's
 * own words, and a metrics report is the kind of thing that gets pasted into
 * a chat. The length is enough to tell a truncated write from a garbage line.
 */
export interface MalformedLine {
  file: string;
  line: number;
  bytes: number;
  reason: string;
}

export interface LenientRead<T> {
  rows: T[];
  malformed: MalformedLine[];
  /**
   * spec §5.2 row 4: a bad LAST line with no trailing newline is the expected
   * race of reading an append-only file, not corruption — it does not set a
   * non-zero exit. Anywhere else is corruption, because §1.7 measured that
   * store.ts's writer glues a newline onto a torn tail and turns it into a
   * middle line for good.
   */
  lastLineLooksTorn: boolean;
}
```

`src/metrics/lenientRead.ts`：

```typescript
import { readFile } from "node:fs/promises";
import type { z } from "zod";
import { correctionSchema } from "../corrections/schema.js";
import type { Correction } from "../corrections/schema.js";
import { decisionEventSchema, overturnedEventSchema } from "../ledger/schema.js";
import type { DecisionEvent, OverturnedEvent } from "../ledger/schema.js";
import type { LenientRead, MalformedLine } from "./types.js";

/**
 * 🔴 NEW, and for the READ SIDE ONLY. src/corrections/store.ts's
 * readCorrections stays strict and is not touched (spec §0, §5.3).
 *
 * Why not just loosen the existing one: readCorrections is called from inside
 * the store lock by recordCorrection and loadCorrection. A lenient reader
 * there would let the duplicate check skip a torn last line and then append
 * after it — §1.7's measured shape, made permanent. A locked writer must not
 * tolerate a tear; a read-only report must not die of one.
 */
async function readLines(file: string): Promise<{ lines: string[]; endsWithNewline: boolean } | undefined> {
  const text = await readFile(file, "utf8").catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  });
  if (text === undefined) return undefined;
  return { lines: text.split("\n"), endsWithNewline: text.endsWith("\n") };
}

function readLeniently<T>(
  file: string,
  raw: { lines: string[]; endsWithNewline: boolean } | undefined,
  parse: (value: unknown) => { ok: true; row: T } | { ok: false; reason: string },
): LenientRead<T> {
  if (raw === undefined) return { rows: [], malformed: [], lastLineLooksTorn: false };

  const rows: T[] = [];
  const malformed: MalformedLine[] = [];
  let lastLineLooksTorn = false;

  // The final element of split("\n") is "" when the file ends with a newline.
  // Any other final element is a line nobody terminated — a write in flight.
  const lastIndex = raw.lines.length - 1;

  for (let i = 0; i < raw.lines.length; i += 1) {
    const line = raw.lines[i];
    if (line.trim().length === 0) continue;

    const isUnterminatedTail = i === lastIndex && !raw.endsWithNewline;

    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      malformed.push({
        file,
        line: i + 1,
        bytes: Buffer.byteLength(line, "utf8"),
        reason: isUnterminatedTail
          ? `unterminated last line, still being written: ${(error as Error).message}`
          : `not valid JSON: ${(error as Error).message}`,
      });
      if (isUnterminatedTail) lastLineLooksTorn = true;
      continue;
    }

    const parsed = parse(value);
    if (parsed.ok) {
      rows.push(parsed.row);
      continue;
    }
    malformed.push({
      file,
      line: i + 1,
      bytes: Buffer.byteLength(line, "utf8"),
      reason: isUnterminatedTail ? `unterminated last line, still being written: ${parsed.reason}` : parsed.reason,
    });
    if (isUnterminatedTail) lastLineLooksTorn = true;
  }

  return { rows, malformed, lastLineLooksTorn };
}

function issuesOf(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ");
}

export async function readCorrectionsLeniently(file: string): Promise<LenientRead<Correction>> {
  return readLeniently<Correction>(file, await readLines(file), (value) => {
    const result = correctionSchema.safeParse(value);
    return result.success ? { ok: true, row: result.data } : { ok: false, reason: issuesOf(result.error) };
  });
}

/**
 * Only the two event types this cut reads: decision (the denominator) and
 * overturned (the fix rate's numerator). A `bound` or a `superseded` is a
 * legal ledger line that carries neither number — skipped, and NOT reported as
 * malformed, or every ledger in the repository would report seven "bad" lines.
 */
export type LedgerRow = DecisionEvent | OverturnedEvent;

export async function readLedgerLeniently(file: string): Promise<LenientRead<LedgerRow>> {
  return readLeniently<LedgerRow>(file, await readLines(file), (value) => {
    const ev = (value as { ev?: unknown }).ev;
    if (ev === "decision") {
      const result = decisionEventSchema.safeParse(value);
      return result.success ? { ok: true, row: result.data } : { ok: false, reason: issuesOf(result.error) };
    }
    if (ev === "overturned") {
      const result = overturnedEventSchema.safeParse(value);
      return result.success ? { ok: true, row: result.data } : { ok: false, reason: issuesOf(result.error) };
    }
    if (ev === "bound" || ev === "superseded") {
      return { ok: false, reason: "__skip__" };
    }
    return { ok: false, reason: `unknown ev: ${JSON.stringify(ev)}` };
  });
}
```

⚠️ **`__skip__` 是个占位，Step 3 不许就这么留着。** 正确写法是让 `parse` 返回三态。执行者**必须**把 `parse` 的返回类型改成：

```typescript
type ParseOutcome<T> = { ok: true; row: T } | { ok: false; reason: string } | { skip: true };
```

并在 `readLeniently` 里 `if ("skip" in parsed) continue;`。**下面 Step 4 的第 6 条判据就是钉这个的。**

- [ ] **Step 4: 补上钉 `bound` 不算坏行的那条判据**

追加到 `tests/metrics/lenientRead.test.ts`：

```typescript
import { readLedgerLeniently } from "../../src/metrics/lenientRead.js";

it("skips bound and superseded without calling them malformed", async () => {
  const dir = await tempDir();
  const file = join(dir, "run.jsonl");
  await writeFile(file, `${JSON.stringify({ ev: "bound", id: "orca-dev-1/1", taskId: "T1", runId: "r" })}\n`);

  const read = await readLedgerLeniently(file);
  expect(read.rows).toEqual([]);
  expect(read.malformed).toEqual([]);   // ← 若用 "__skip__" 占位,这里会拿到一条假的 malformed ⇒ 红
});
```

- [ ] **Step 5: 跑判据，确认全绿**

Run: `rtk proxy npx vitest run tests/metrics/lenientRead.test.ts > /tmp/t2.txt 2>&1; echo RC=$?; cat /tmp/t2.txt`
Expected: PASS，6 条全绿

- [ ] **Step 6: 🔴 跑变异 7 与变异 21，各自【看到】红**

```bash
D=$(mktemp -d)/copy && git clone --local . "$D" && ln -s "$PWD/node_modules" "$D/node_modules"
for f in src/metrics/types.ts src/metrics/lenientRead.ts tests/metrics/lenientRead.test.ts; do
  mkdir -p "$D/$(dirname "$f")"; cat "$f" > "$D/$f"; diff "$f" "$D/$f" || echo "COPY_DIFFERS: $f"
done

# 变异 7:静默排除坏行(不记 malformed)
shasum -a 256 "$D/src/metrics/lenientRead.ts"
python3 - "$D" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1]) / "src/metrics/lenientRead.ts"
t = p.read_text()
old = "      malformed.push({\n        file,\n        line: i + 1,"
assert t.count(old) == 1, f"anchor hit {t.count(old)} times"
p.write_text(t.replace(old, "      if (false) malformed.push({\n        file,\n        line: i + 1,"))
PY
shasum -a 256 "$D/src/metrics/lenientRead.ts"   # 两个 sha 不等才算落上去
(cd "$D" && ./node_modules/.bin/vitest run tests/metrics/lenientRead.test.ts > /tmp/m7.txt 2>&1; echo RC=$? >> /tmp/m7.txt)
cat /tmp/m7.txt
```

Expected: 红在 `names a MIDDLE bad line …` 上（`malformed` 长度为 0）。

**变异 21 —— 让 `store.ts` 也用宽容读取器：**

```bash
python3 - "$D" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1]) / "src/corrections/store.ts"
t = p.read_text()
old = "    rows.push(correctionSchema.parse(JSON.parse(raw)));"
assert t.count(old) == 1
p.write_text(t.replace(old, "    const r = correctionSchema.safeParse(JSON.parse(raw)); if (r.success) rows.push(r.data);"))
PY
(cd "$D" && ./node_modules/.bin/vitest run tests/metrics/lenientRead.test.ts > /tmp/m21.txt 2>&1; echo RC=$? >> /tmp/m21.txt)
cat /tmp/m21.txt
```

Expected: *** **红在 `leaves store.ts strict …` 上** *** —— 即 `readCorrections` 不再抛。
⚠️ 这条变异**同时应当打红 `tests/corrections/store.test.ts` 里的既有判据** —— 顺便跑一遍确认，那是「既有判据也在守它」的证据。

- [ ] **Step 7: 还原证明 ＋ 提交**

```bash
/bin/rm -rf "$(dirname "$D")"
rtk proxy git status --porcelain > /tmp/p.txt 2>&1; cat /tmp/p.txt
ls ~/.orca 2>&1 || echo "ORCA_STILL_ABSENT"
rtk proxy npm run verify > /tmp/v2.txt 2>&1; echo "VERIFY_RC=$?" >> /tmp/v2.txt; cat /tmp/v2.txt
git add src/metrics/types.ts src/metrics/lenientRead.ts tests/metrics/lenientRead.test.ts
git commit -m "feat(metrics): read a torn store without dying of it, and without loosening the locked writer"
```

---

## Task 3: 仓库发现与四种坏情况

**Files:**
- Create: `src/metrics/rejection.ts`、`src/metrics/collect.ts`（第一半）
- Test: `tests/metrics/discover.test.ts`

**Interfaces:**
- Consumes: `projectKeyOf` / `TARGET_HAS_NO_REMOTE` / `TARGET_REMOTE_NOT_KEYABLE`（`src/corrections/projectKey.ts`）、`CorrectRejection`
- Produces:
  - `export class MetricsRejection extends Error { code: string; exitCode: 1 }`
  - `export const KEY_MATCHES_MULTIPLE_PATHS = "key-matches-multiple-paths"`
  - `export const UNRESOLVED_PROJECT_KEYS = "unresolved-project-keys"`
  - `export const REPO_PATH_MISSING = "repo-path-missing"`
  - `export interface DiscoveredRepo { projectKey: string; path: string }`
  - `export interface UnkeyableRepo { path: string; reason: string }`
  - `export function discoverRepos(opts: { root?: string; repos: ReadonlyArray<{ projectKey: string; path: string }> }): Promise<{ repos: DiscoveredRepo[]; unkeyable: UnkeyableRepo[] }>`
  - `export function enforceIntegrityGate(repos: readonly DiscoveredRepo[], keysInStore: readonly string[]): void`

- [ ] **Step 1: 写会失败的判据**

`tests/metrics/discover.test.ts`：

```typescript
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  KEY_MATCHES_MULTIPLE_PATHS,
  MetricsRejection,
  REPO_PATH_MISSING,
  UNRESOLVED_PROJECT_KEYS,
  discoverRepos,
  enforceIntegrityGate,
} from "../../src/metrics/collect.js";

const execFileAsync = promisify(execFile);

/** A repo with a URL-shaped remote — §7 says a bare `git init` is NOT enough. */
async function repoWithRemote(root: string, name: string, remote: string): Promise<string> {
  const path = join(root, name);
  await mkdir(join(path, ".decisions"), { recursive: true });
  await execFileAsync("git", ["init", "-q"], { cwd: path });
  await execFileAsync("git", ["remote", "add", "origin", remote], { cwd: path });
  await writeFile(join(path, ".decisions", "orca-dev-1.jsonl"), "");
  return path;
}

describe("repo discovery (E2 spec §2.1, §2.1.1)", () => {
  it("scans --root for repos with .decisions/ and keys them by remote", async () => {
    const root = await mkdtemp(join(tmpdir(), "orca-metrics-root-"));
    await repoWithRemote(root, "a", "https://github.com/biran/a.git");
    await repoWithRemote(root, "b", "git@github.com:biran/b.git");

    const found = await discoverRepos({ root, repos: [] });

    // §6 item 2: projectKey 字典序,不是 readdir 顺序。
    expect(found.repos.map((r) => r.projectKey)).toEqual(["github.com/biran/a", "github.com/biran/b"]);
    expect(found.unkeyable).toEqual([]);
  });

  // 变异 13 方向一的落点:改成硬拒 ⇒ 这条红。
  it("skips a repo it cannot key BUT names it — a --local clone must not kill the command", async () => {
    const root = await mkdtemp(join(tmpdir(), "orca-metrics-root-"));
    await repoWithRemote(root, "good", "https://github.com/biran/good.git");
    await repoWithRemote(root, "pathy", "/tmp/some/bare.git");   // §1.8 的路径式 remote

    const found = await discoverRepos({ root, repos: [] });

    expect(found.repos.map((r) => r.projectKey)).toEqual(["github.com/biran/good"]);
    expect(found.unkeyable).toHaveLength(1);
    expect(found.unkeyable[0].path).toContain("pathy");
    expect(found.unkeyable[0].reason).toContain("not a URL");
  });

  // 变异 13 方向二:静默跳过 ⇒ 这条红。两个方向各一条,spec §8 第 13 条要求的。
  it("a repo with no remote at all is also named, not silently dropped", async () => {
    const root = await mkdtemp(join(tmpdir(), "orca-metrics-root-"));
    const path = join(root, "bare");
    await mkdir(join(path, ".decisions"), { recursive: true });
    await execFileAsync("git", ["init", "-q"], { cwd: path });

    const found = await discoverRepos({ root, repos: [] });
    expect(found.repos).toEqual([]);
    expect(found.unkeyable.map((u) => u.path)).toEqual([path]);
  });

  // 变异 12 的落点。⚠️ 夹具让两个路径的 decision 条数【不同】——
  // 「任选一个」在两边相同时会照绿(spec §8 第 12 条点名的加固形状)。
  it("refuses when one projectKey maps to two paths, and lists both", async () => {
    const root = await mkdtemp(join(tmpdir(), "orca-metrics-root-"));
    const one = await repoWithRemote(root, "one", "https://github.com/biran/same.git");
    const two = await repoWithRemote(root, "two", "https://github.com/biran/same.git");
    await writeFile(join(one, ".decisions", "orca-dev-1.jsonl"), "");
    await writeFile(join(two, ".decisions", "orca-dev-1.jsonl"), "\n\n");   // 两边条数不同

    const error = await discoverRepos({ root, repos: [] }).then(
      () => { throw new Error("accepted a projectKey that maps to two paths"); },
      (e: unknown) => e,
    );
    expect((error as MetricsRejection).code).toBe(KEY_MATCHES_MULTIPLE_PATHS);
    expect((error as Error).message).toContain(one);
    expect((error as Error).message).toContain(two);
  });

  it("refuses a --repo whose path does not exist", async () => {
    const error = await discoverRepos({ repos: [{ projectKey: "k", path: "/nope/nothing/here" }] }).then(
      () => { throw new Error("accepted a --repo path that is not there"); },
      (e: unknown) => e,
    );
    expect((error as MetricsRejection).code).toBe(REPO_PATH_MISSING);
  });

  // 变异 11 的落点:改成静默略过 ⇒ 这条红。
  it("the integrity gate refuses a store key that neither mechanism resolves, and names it", () => {
    expect(() =>
      enforceIntegrityGate([{ projectKey: "github.com/biran/a", path: "/a" }], ["github.com/biran/a", "github.com/biran/ghost"]),
    ).toThrowError(/github\.com\/biran\/ghost/);

    try {
      enforceIntegrityGate([], ["github.com/biran/ghost"]);
      throw new Error("the gate did not fire");
    } catch (e) {
      expect((e as MetricsRejection).code).toBe(UNRESOLVED_PROJECT_KEYS);
    }
  });

  it("the gate stays quiet when every store key resolves", () => {
    expect(() => enforceIntegrityGate([{ projectKey: "k", path: "/k" }], ["k"])).not.toThrow();
  });
});
```

- [ ] **Step 2: 跑它，确认它红**

Run: `rtk proxy npx vitest run tests/metrics/discover.test.ts > /tmp/t3.txt 2>&1; echo RC=$?; cat /tmp/t3.txt`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 写 `src/metrics/rejection.ts`**

```typescript
/**
 * A named refusal `orca metrics` can make. Shape copied from
 * src/corrections/rejection.ts so the two subsystems answer the same way.
 *
 * Only exit code 1 — "the input is wrong and retrying will not help". This
 * cut takes no lock (spec §5.1), so there is no 4; it writes nothing, so
 * there is no 5. Exit 6 is NOT a rejection: it means the report printed in
 * full and some lines were bad (spec §5.2), and it is returned by the CLI
 * rather than thrown.
 */
export class MetricsRejection extends Error {
  readonly exitCode = 1 as const;
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "MetricsRejection";
  }
}
```

- [ ] **Step 4: 写 `src/metrics/collect.ts` 的第一半**

```typescript
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { CorrectRejection } from "../corrections/rejection.js";
import { projectKeyOf } from "../corrections/projectKey.js";
import { MetricsRejection } from "./rejection.js";

export const KEY_MATCHES_MULTIPLE_PATHS = "key-matches-multiple-paths";
export const UNRESOLVED_PROJECT_KEYS = "unresolved-project-keys";
export const REPO_PATH_MISSING = "repo-path-missing";

export interface DiscoveredRepo {
  projectKey: string;
  path: string;
}

export interface UnkeyableRepo {
  path: string;
  reason: string;
}

export interface DiscoverOptions {
  root?: string;
  repos: ReadonlyArray<{ projectKey: string; path: string }>;
}

/**
 * spec §2.1: two mechanisms, no persistent registry.
 *
 * Scanning --root catches the well-behaved repository nobody remembered to
 * mention — the one with decisions and zero corrections, which is exactly the
 * one whose absence inflates the correction rate. --repo is a READ-SIDE
 * argument for repositories outside that root; it is not persisted anywhere,
 * because a registry would cost a writer, a lock, a slice of Rule 17 surface,
 * and the risk that 43 existing criteria start writing into a real ~/.orca
 * (spec §1.9, §12.2 item 2), while buying nothing the gate below does not.
 */
export async function discoverRepos(opts: DiscoverOptions): Promise<{
  repos: DiscoveredRepo[];
  unkeyable: UnkeyableRepo[];
}> {
  const byKey = new Map<string, string[]>();
  const unkeyable: UnkeyableRepo[] = [];

  for (const explicit of opts.repos) {
    const info = await stat(explicit.path).catch(() => undefined);
    if (info === undefined || !info.isDirectory()) {
      // spec §2.1.1 row 4: it contributes zero decisions, so accepting it
      // shrinks the denominator in silence — the same poison as row 1.
      throw new MetricsRejection(
        REPO_PATH_MISSING,
        `--repo ${explicit.projectKey}=${explicit.path}: no such directory. It would contribute 0 decisions, ` +
          `which silently lowers the correction rate's denominator.`,
      );
    }
    push(byKey, explicit.projectKey, explicit.path);
  }

  if (opts.root !== undefined) {
    for (const candidate of await candidateRepos(opts.root)) {
      let key: string;
      try {
        key = await projectKeyOf(candidate);
      } catch (error) {
        // spec §2.1.1 row 2: skip but NAME. A `git clone --local` copy really
        // does appear under a root — the mutation discipline in §8 creates
        // them — and refusing the whole command for one copy is out of
        // proportion. Staying silent is the other failure: nobody would ever
        // learn that a repository was left out.
        if (error instanceof CorrectRejection) {
          unkeyable.push({ path: candidate, reason: error.message });
          continue;
        }
        throw error;
      }
      push(byKey, key, candidate);
    }
  }

  const repos: DiscoveredRepo[] = [];
  for (const [projectKey, paths] of byKey) {
    const unique = [...new Set(paths)].sort();
    if (unique.length > 1) {
      // spec §2.1.1 row 3: picking one is a GUESS and counting both is double
      // counting. The gate below can never catch this, because it only fires
      // when a key resolves to nothing.
      throw new MetricsRejection(
        KEY_MATCHES_MULTIPLE_PATHS,
        `projectKey ${projectKey} resolves to ${unique.length} paths:\n${unique.map((p) => `  ${p}`).join("\n")}\n` +
          `Picking one would be a guess and counting both would double the decisions. ` +
          `Point --repo at the one you mean, or move the other out of --root.`,
      );
    }
    repos.push({ projectKey, path: unique[0] });
  }

  // §6 item 2: a total order, never readdir's.
  repos.sort((a, b) => (a.projectKey < b.projectKey ? -1 : a.projectKey > b.projectKey ? 1 : 0));
  unkeyable.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { repos, unkeyable };
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const existing = map.get(key);
  if (existing === undefined) map.set(key, [value]);
  else existing.push(value);
}

/**
 * A candidate is a directory holding `.decisions/`. Recursion stops there and
 * at `node_modules` / `.git`: nesting a target repo inside another target
 * repo's .decisions is not a shape this system creates.
 */
async function candidateRepos(root: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 4) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    if (entries.some((e) => e.isDirectory() && e.name === ".decisions")) {
      found.push(dir);
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      await walk(join(dir, entry.name), depth + 1);
    }
  };
  await walk(root, 0);
  return found.sort();
}

/**
 * spec §2.1.1 row 1. A correction carries a projectKey and nothing else (§1.2);
 * if that key resolves to no repository, that repository's decisions are
 * missing from the denominator, and the correction rate rises with nothing
 * saying so. Refusing by name is the only handling that cannot be misread —
 * and the message has to say what to do, because the fix is one --repo away.
 */
export function enforceIntegrityGate(
  repos: readonly DiscoveredRepo[],
  keysInStore: readonly string[],
): void {
  const known = new Set(repos.map((r) => r.projectKey));
  const missing = [...new Set(keysInStore)].filter((k) => !known.has(k)).sort();
  if (missing.length === 0) return;

  throw new MetricsRejection(
    UNRESOLVED_PROJECT_KEYS,
    `the corrections store has ${missing.length} projectKey(s) that neither --root nor --repo resolves:\n` +
      `${missing.map((k) => `  ${k}`).join("\n")}\n` +
      `Their decisions are not in the denominator, so the correction rate would read high. ` +
      `Add --repo <projectKey>=<path> for each, or widen --root.`,
  );
}
```

- [ ] **Step 5: 跑判据，确认全绿**

Run: `rtk proxy npx vitest run tests/metrics/discover.test.ts > /tmp/t3.txt 2>&1; echo RC=$?; cat /tmp/t3.txt`
Expected: PASS，7 条全绿

- [ ] **Step 6: 🔴 跑变异 11、12、13（两个方向），四次各自【看到】红**

```bash
D=$(mktemp -d)/copy && git clone --local . "$D" && ln -s "$PWD/node_modules" "$D/node_modules"
for f in $(rtk proxy git status --porcelain | awk '{print $2}'); do
  mkdir -p "$D/$(dirname "$f")"; cat "$f" > "$D/$f"; diff "$f" "$D/$f" || echo "COPY_DIFFERS: $f"
done
pristine="$D/src/metrics/collect.ts.pristine"; cat "$D/src/metrics/collect.ts" > "$pristine"

run_mutation () {                 # $1 = 名字, $2 = python 改码脚本
  cat "$pristine" > "$D/src/metrics/collect.ts"
  shasum -a 256 "$D/src/metrics/collect.ts"
  python3 - "$D" <<PY
$2
PY
  shasum -a 256 "$D/src/metrics/collect.ts"      # 不等才算落上去
  (cd "$D" && ./node_modules/.bin/vitest run tests/metrics/discover.test.ts > "/tmp/$1.txt" 2>&1; echo RC=$? >> "/tmp/$1.txt")
  cat "/tmp/$1.txt"
}
```

| 变异 | 改什么 | 期望红在哪条 |
|---|---|---|
| **11** | `enforceIntegrityGate` 的 `throw` 改成 `return` | `the integrity gate refuses a store key …` |
| **12** | 一 key 多路径改成 `repos.push({ projectKey, path: unique[0] })`（任选一个） | `refuses when one projectKey maps to two paths …` |
| **13a** | `unkeyable.push(…); continue;` 改成 `throw error;` | `skips a repo it cannot key BUT names it …` |
| **13b** | `unkeyable.push(…); continue;` 改成只 `continue;` | `skips a repo it cannot key BUT names it …` **与** `a repo with no remote at all …` |

⚠️ **每一条都要【看到】红，且读一眼红在不在点名的那条上。** 红在别条 ⇒ 假红，回去改判据。

- [ ] **Step 7: 还原 ＋ 提交**

```bash
/bin/rm -rf "$(dirname "$D")"
rtk proxy git status --porcelain > /tmp/p.txt 2>&1; cat /tmp/p.txt
ls ~/.orca 2>&1 || echo "ORCA_STILL_ABSENT"
rtk proxy npm run verify > /tmp/v3.txt 2>&1; echo "VERIFY_RC=$?" >> /tmp/v3.txt; cat /tmp/v3.txt
git add src/metrics/rejection.ts src/metrics/collect.ts tests/metrics/discover.test.ts
git commit -m "feat(metrics): find the repositories, and refuse the two shapes that would quietly shrink the denominator"
```

---

## Task 4: 读取、`--as-of` 过滤、以及两种「未来行」分开判

**Files:**
- Modify: `src/metrics/collect.ts`（追加第二半）、`src/metrics/types.ts`（追加观测集类型）
- Test: `tests/metrics/collectAsOf.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `readCorrectionsLeniently` / `readLedgerLeniently`、Task 3 的 `discoverRepos` / `enforceIntegrityGate`
- Produces:
  - `export const FUTURE_ROWS_WITHOUT_AS_OF = "future-rows-without-as-of"`
  - `export interface Observations { asOf: string; asOfMode: "explicit" | "wall_clock"; decisions: …; overturned: …; corrections: …; excludedAsFuture: number; unresolvedDecisions: …; unkeyableRepos: UnkeyableRepo[]; malformed: MalformedLine[] }`
  - `export function collect(opts: CollectOptions): Promise<Observations>`

- [ ] **Step 1: 先把观测集类型写进 `src/metrics/types.ts`**

```typescript
import type { DecisionKind, DecisionScope } from "../ledger/types.js";
import type { CorrectionKind } from "../corrections/schema.js";

/** One decision, flattened to just what the metrics need. */
export interface DecisionObservation {
  projectKey: string;
  id: string;
  at: string;
  kind: DecisionKind;
  scope: DecisionScope;
  /**
   * spec §3.4: validateLine's verdict decides membership. `rejected` lines do
   * NOT enter the denominator (they are not legal records); `downgraded` ones
   * DO (the record is legal, the decision just had to go to a human — A' §1.1).
   */
  verdict: "ok" | "downgraded";
}

export interface CorrectionObservation {
  id: string;
  projectKey: string;
  decisionId: string;
  kind: CorrectionKind;
  at: string;
}

/** An overturned row, already resolved back to the correction it closes. */
export interface OverturnedObservation {
  correctionId: string;
  at: string;
}

/** spec §3.4.1: a correction whose decision is outside what was scanned. */
export interface UnresolvedDecision {
  correctionId: string;
  projectKey: string;
  decisionId: string;
}
```

- [ ] **Step 2: 写会失败的判据**

`tests/metrics/collectAsOf.test.ts`（只列本任务的四条；夹具工厂与 Task 3 同形，**照抄不引用**，因为执行者可能乱序读任务）：

```typescript
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { FUTURE_ROWS_WITHOUT_AS_OF, MetricsRejection, collect } from "../../src/metrics/collect.js";

const execFileAsync = promisify(execFile);

async function repoWithRemote(root: string, name: string, remote: string): Promise<string> {
  const path = join(root, name);
  await mkdir(join(path, ".decisions"), { recursive: true });
  await execFileAsync("git", ["init", "-q"], { cwd: path });
  await execFileAsync("git", ["remote", "add", "origin", remote], { cwd: path });
  return path;
}

function decision(id: string, at: string): string {
  return JSON.stringify({
    ev: "decision", id, at, run: id.split("/")[0], question: "q", chose: "a",
    alternatives: [{ option: "b", why_not: "no" }], because: "r",
    undo: { how: "git revert abc123", cost: "low", blast_radius: "one file" },
    scope: "repo", kind: "interface",
  });
}

describe("collect + --as-of (E2 spec §4.2)", () => {
  it("filters rows newer than --as-of and reports how many, exit 0 territory", async () => {
    const root = await mkdtemp(join(tmpdir(), "orca-metrics-asof-"));
    const repo = await repoWithRemote(root, "a", "https://github.com/biran/a.git");
    await writeFile(join(repo, ".decisions", "orca-dev-1.jsonl"),
      `${decision("orca-dev-1/1", "2026-01-01T00:00:00.000Z")}\n${decision("orca-dev-1/2", "2099-01-01T00:00:00.000Z")}\n`);
    const store = await mkdtemp(join(tmpdir(), "orca-metrics-store-"));

    const obs = await collect({ root, repos: [], correctionsDir: store, asOf: "2026-06-01T00:00:00.000Z" });

    expect(obs.decisions.map((d) => d.id)).toEqual(["orca-dev-1/1"]);
    expect(obs.excludedAsFuture).toBe(1);
    expect(obs.asOfMode).toBe("explicit");
    expect(obs.asOf).toBe("2026-06-01T00:00:00.000Z");
  });

  // 变异 5 的落点:两种模式【同样处置】⇒ 这条与下一条必有一条红。
  it("WITHOUT --as-of, a future row is a named refusal — not a silent skip", async () => {
    const root = await mkdtemp(join(tmpdir(), "orca-metrics-asof-"));
    const repo = await repoWithRemote(root, "a", "https://github.com/biran/a.git");
    await writeFile(join(repo, ".decisions", "orca-dev-1.jsonl"),
      `${decision("orca-dev-1/1", "2099-01-01T00:00:00.000Z")}\n`);
    const store = await mkdtemp(join(tmpdir(), "orca-metrics-store-"));

    const error = await collect({
      root, repos: [], correctionsDir: store, now: () => "2026-09-09T00:00:00.000Z",
    }).then(
      () => { throw new Error("a row dated 2099 was accepted with no --as-of"); },
      (e: unknown) => e,
    );
    expect((error as MetricsRejection).code).toBe(FUTURE_ROWS_WITHOUT_AS_OF);
    // 消息不许说「时钟偏斜」以外的假话,也不许在这一格说「你传了个更早的时间」。
    expect((error as Error).message).toContain("orca-dev-1/1");
    expect((error as Error).message).not.toContain("--as-of you passed");
  });

  // 🔴 变异 20 的【正向对照】。「读侧不取锁」是「什么都没发生」,不可能直接红。
  it("reads while `orca correct` holds the store lock — the read side takes nothing", async () => {
    const root = await mkdtemp(join(tmpdir(), "orca-metrics-asof-"));
    await repoWithRemote(root, "a", "https://github.com/biran/a.git");
    const store = await mkdtemp(join(tmpdir(), "orca-metrics-store-"));

    const { withStoreLock } = await import("../../src/corrections/storeLock.js");
    let collected = false;
    await withStoreLock(store, async () => {
      // 若读侧取了同一把锁,这个 await 会挂到超时 ⇒ 判据超时红。
      await collect({ root, repos: [], correctionsDir: store, now: () => "2026-09-09T00:00:00.000Z" });
      collected = true;
    });
    expect(collected).toBe(true);
  }, 5000);

  it("carries every malformed line and every unkeyable repo through to the observations", async () => {
    const root = await mkdtemp(join(tmpdir(), "orca-metrics-asof-"));
    const repo = await repoWithRemote(root, "a", "https://github.com/biran/a.git");
    await writeFile(join(repo, ".decisions", "orca-dev-1.jsonl"), `{ not json\n`);
    const store = await mkdtemp(join(tmpdir(), "orca-metrics-store-"));

    const obs = await collect({ root, repos: [], correctionsDir: store, now: () => "2026-09-09T00:00:00.000Z" });
    expect(obs.malformed).toHaveLength(1);
    expect(obs.malformed[0].line).toBe(1);
  });
});
```

- [ ] **Step 3: 跑它，确认它红**

Run: `rtk proxy npx vitest run tests/metrics/collectAsOf.test.ts > /tmp/t4.txt 2>&1; echo RC=$?; cat /tmp/t4.txt`
Expected: FAIL —— `collect` 未导出

- [ ] **Step 4: 实现 `collect`（追加到 `src/metrics/collect.ts`）**

```typescript
export const FUTURE_ROWS_WITHOUT_AS_OF = "future-rows-without-as-of";

export interface CollectOptions extends DiscoverOptions {
  correctionsDir: string;
  /** ISO 8601. Given ⇒ filter mode; absent ⇒ wall-clock mode (spec §4.2). */
  asOf?: string;
  /** spec §4.3: injected, never read from a clock in here. */
  now?: () => string;
}

/**
 * spec §4.2, rewritten after review finding C1.
 *
 * --as-of has ONE meaning: filter the input set to what existed at that
 * instant. It is not a `now` substitute wearing a guard. The original design
 * kept a "negative age ⇒ refuse" guard alongside it, which meant any store
 * holding a row newer than the --as-of refused the query outright — the exact
 * historical query the flag exists for. And the guard's message blamed clock
 * skew, when the ordinary cause was a person passing an earlier time.
 *
 * So the guard lives in the one place it is true: when NO --as-of was given,
 * as-of is the wall clock, and no legal path produces a row dated after it.
 */
export async function collect(opts: CollectOptions): Promise<Observations> {
  const asOfMode = opts.asOf === undefined ? "wall_clock" : "explicit";
  const asOf = opts.asOf ?? (opts.now ?? (() => new Date().toISOString()))();
  if (Number.isNaN(Date.parse(asOf))) {
    throw new MetricsRejection("as-of-not-a-timestamp", `--as-of ${JSON.stringify(asOf)} is not an ISO 8601 timestamp`);
  }

  const { repos, unkeyable } = await discoverRepos(opts);
  const malformed: MalformedLine[] = [];
  const decisions: DecisionObservation[] = [];
  const overturnedRows: OverturnedObservation[] = [];
  const future: string[] = [];

  const keep = (at: string, label: string): boolean => {
    if (Date.parse(at) <= Date.parse(asOf)) return true;
    future.push(label);
    return false;
  };

  for (const repo of repos) {
    for (const file of await ledgerFiles(repo.path)) {
      const read = await readLedgerLeniently(file);
      malformed.push(...read.malformed);
      for (const row of read.rows) {
        if (row.ev === "decision") {
          if (!keep(row.at, row.id)) continue;
          // spec §3.4: rejected lines are out of the denominator, downgraded ones in.
          const verdict = validateLine(JSON.stringify(row));
          if (verdict.verdict === "rejected") continue;
          decisions.push({
            projectKey: repo.projectKey, id: row.id, at: row.at,
            kind: row.kind, scope: row.scope,
            verdict: verdict.verdict === "downgraded" ? "downgraded" : "ok",
          });
        } else {
          if (!keep(row.at, `${row.correctionId} (overturned)`)) continue;
          overturnedRows.push({ correctionId: row.correctionId, at: row.at });
        }
      }
    }
  }

  const storeRead = await readCorrectionsLeniently(correctionsFile(opts.correctionsDir));
  malformed.push(...storeRead.malformed);
  const corrections: CorrectionObservation[] = [];
  for (const row of storeRead.rows) {
    if (!keep(row.at, row.id)) continue;
    corrections.push({
      id: row.id, projectKey: row.projectKey, decisionId: row.decisionId, kind: row.kind, at: row.at,
    });
  }

  if (asOfMode === "wall_clock" && future.length > 0) {
    throw new MetricsRejection(
      FUTURE_ROWS_WITHOUT_AS_OF,
      `${future.length} row(s) are dated after now (${asOf}), and no --as-of was given:\n` +
        `${[...future].sort().map((f) => `  ${f}`).join("\n")}\n` +
        `No legal path produces these — it is clock skew or a bad \`at\`. ` +
        `Pass --as-of to ask what the numbers looked like at a chosen instant instead.`,
    );
  }

  // 🔴 The gate runs on the FULL set of keys in the store, not on the filtered
  // one: a key whose only correction is newer than --as-of still names a
  // repository whose decisions belong in the denominator of later queries, and
  // hiding it here would make the gate's silence depend on the flag.
  enforceIntegrityGate(repos, storeRead.rows.map((r) => r.projectKey));

  const { unresolvedDecisions, resolvedOverturned } = await resolveAcrossArchive(
    repos, corrections, overturnedRows, decisions,
  );

  return {
    asOf, asOfMode, decisions, corrections,
    overturned: resolvedOverturned,
    excludedAsFuture: future.length,
    unresolvedDecisions,
    unkeyableRepos: unkeyable,
    malformed: malformed.sort(byMalformedKey),
    lastLineLooksTorn: storeRead.lastLineLooksTorn,
  };
}

function byMalformedKey(a: MalformedLine, b: MalformedLine): number {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  return a.line - b.line;
}

/** Top-level *.jsonl only — spec §3.4.1 / A' §3.7.1: archive/ is not scanned by default. */
async function ledgerFiles(repo: string): Promise<string[]> {
  const dir = join(repo, ".decisions");
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
    .map((e) => join(dir, e.name))
    .sort();
}
```

⚠️ **`resolveAcrossArchive` 是 Task 5 的交付。** 本任务先写一个只做 `unresolvedDecisions` 的版本
（`resolvedOverturned` 直接返回 `overturnedRows`），Task 5 再把归档定点查加进去 —— **那时会新增它自己的判据与变异**。

- [ ] **Step 5: 跑判据，确认全绿**

Run: `rtk proxy npx vitest run tests/metrics/collectAsOf.test.ts > /tmp/t4.txt 2>&1; echo RC=$?; cat /tmp/t4.txt`
Expected: PASS，4 条全绿

- [ ] **Step 6: 🔴 变异 5 —— 两种模式同样处置**

```bash
# 方向 a:给了 --as-of 也拒 ⇒ 第一条红
# 方向 b:没给 --as-of 也静默过滤 ⇒ 第二条红
```

对 `if (asOfMode === "wall_clock" && future.length > 0)` 分别改成 `if (future.length > 0)` 与 `if (false)`，
**两次各自跑、各自看到红，并确认红在点名的那一条上**。spec §8 第 5 条要求的正是「两条判据必有一条红」。

- [ ] **Step 7: 还原 ＋ 提交**

```bash
/bin/rm -rf "$(dirname "$D")"
rtk proxy git status --porcelain > /tmp/p.txt 2>&1; cat /tmp/p.txt
ls ~/.orca 2>&1 || echo "ORCA_STILL_ABSENT"
rtk proxy npm run verify > /tmp/v4.txt 2>&1; echo "VERIFY_RC=$?" >> /tmp/v4.txt; cat /tmp/v4.txt
git add src/metrics/collect.ts src/metrics/types.ts tests/metrics/collectAsOf.test.ts
git commit -m "feat(metrics): let --as-of filter the input set instead of tripping the guard it was added for"
```

---

## Task 5: 归档定点查 —— 别让一次 `git mv` 复活一条已修完的纠正

**Files:**
- Modify: `src/metrics/collect.ts`（`resolveAcrossArchive`）
- Test: `tests/metrics/archiveLookup.test.ts`

**Interfaces:**
- Consumes: `deriveFixRunId`（`src/corrections/fields.ts`）、`CorrectionRow`
- Produces: `resolveAcrossArchive` 的完整版（内部函数，经 `collect` 暴露）

⚠️ **本任务落地 §「本计划替 spec 裁掉的三处」的裁一：`archive/` 下【递归】找 basename。**

- [ ] **Step 1: 写会失败的判据**

`tests/metrics/archiveLookup.test.ts`：

```typescript
// 夹具要点:一条 correction,它的 overturned 落在 archive/2026/orca-fix-<hash8>.jsonl,
// 而 .decisions/ 顶层【没有】那个文件。
it("finds an overturned that archiving moved into archive/<year>/, so a closed correction stays closed", async () => {
  // …建仓库、写 corrections 行、用 deriveFixRunId 算出文件名、把它写进 archive/2026/…
  const obs = await collect({ root, repos: [], correctionsDir: store, asOf: "2026-09-09T00:00:00.000Z" });

  // 变异 10 的落点:不查 archive ⇒ 这条 correction 变成积压 ⇒ 两个断言都红。
  expect(obs.overturned.map((o) => o.correctionId)).toEqual([correctionId]);
  expect(obs.unresolvedDecisions).toEqual([]);
});

it("looks for exactly the one derived filename, not a full archive scan", async () => {
  // 在 archive/ 里另放 200 个无关 *.jsonl,断言它们【没有】被读进来:
  // 观测方式是往其中一个写一行【坏 JSON】,然后断言 obs.malformed 里没有它。
  expect(obs.malformed.map((m) => m.file)).not.toContain(noiseFile);
});

it("refuses when the derived filename appears twice under archive/ — that is a real ambiguity", async () => {
  // archive/2025/<name>.jsonl 与 archive/2026/<name>.jsonl 同名
  await expect(collect({ … })).rejects.toThrowError(/appears in 2 places/);
});
```

⚠️ **第二条判据是本任务最重要的一条** —— 它钉的是「定点查，不是全扫」。
*** **只断言「找到了」的判据，全扫也会绿** *** ⇒ 必须**正向观测「无关文件没被读」**。

- [ ] **Step 2: 跑它，确认它红**

Run: `rtk proxy npx vitest run tests/metrics/archiveLookup.test.ts > /tmp/t5.txt 2>&1; echo RC=$?; cat /tmp/t5.txt`

- [ ] **Step 3: 实现**

```typescript
/**
 * spec §3.4.2, review finding C4.
 *
 * The fix rate's numerator comes from `overturned` rows, and `orca correct
 * --close` writes them into its OWN new run file (§1.11). That file ages like
 * any other and gets `git mv`'d into archive/. Once it does, the default scan
 * cannot see it, and a correction closed months ago reappears as backlog:
 * the fix rate drops and "age of the oldest open correction" reports one that
 * is not open. The failure points at "nobody is doing the work", which is the
 * worst possible direction for it to point.
 *
 * The cheap exact fix: deriveFixRunId is a pure function of the correction
 * ROW, and the file is named `<runId>.jsonl`. So for each correction with no
 * overturned in the default scan, compute the one filename it could possibly
 * be in and look for that one name. No full archive scan — the cost is one
 * directory walk per repository plus one stat per open correction.
 *
 * 🔴 The walk is RECURSIVE, which spec §3.4.2 does not say. Measured reason:
 * tests/ledger/appendOnly.test.ts's archive fixture is
 * `.decisions/archive/2026/run-7c.jsonl` — archiving nests by year, so looking
 * only at `archive/<name>.jsonl` would miss every real archive.
 *
 * Two hits for one derived name is a genuine ambiguity (the same correction
 * closed into two files), and guessing between them would silently pick a
 * number. It refuses.
 */
```

实现要点（执行者按此写，**不要发挥**）：

1. 对每条 correction，用它在 store 里的**原样字段**构造 `CorrectionRow`（`Omit<Correction,"id">`），
   调 `deriveFixRunId(row, correction.id)` 得到 `runId`，目标 basename ＝ `${runId}.jsonl`。
   ⚠️ *** **必须用 store 里读回的那一行，不是重新拼的** *** —— `deriveFixRunId` 是全行的函数（`fields.ts` 的注释写明了）。
2. 只对**默认扫描里没有 `overturned` 的** correction 做这件事。
3. 在 `<repo>/.decisions/archive/` 下递归收集 basename ＝ 目标名的文件；0 个 ⇒ 仍算未闭环；1 个 ⇒ 读它、取其中 `correctionId` 匹配的 `overturned`；≥2 个 ⇒ `MetricsRejection`，消息里写 `appears in N places` ＋ 全部路径。
4. `unresolvedDecisions`：一条 correction 的 `decisionId` 在**已扫到的 decisions 里找不到** ⇒ 进这个字段，**并且它不进任何 `decision.kind` 桶**（spec §3.4.1）。字段里带 `correctionId` ＋ `projectKey` ＋ `decisionId`，按 `correctionId` 字典序。

- [ ] **Step 4: 跑判据，确认全绿**

- [ ] **Step 5: 🔴 变异 10 —— 不查 archive**

把递归查那一段改成直接返回「没找到」，跑判据：
Expected: *** **红在 `finds an overturned that archiving moved …`** ***，且**积压条数与最老年龄都变**（spec §8 第 10 条的期望）。
⚠️ **同时确认第二条判据（无关文件没被读）在这个变异下【仍然绿】** —— 它守的是另一件事，两条不该同时红。

- [ ] **Step 6: 🔴 变异 8／9 —— 决策扫不到的两种坏法**

| 变异 | 改什么 | 期望 |
|---|---|---|
| **8** | 「决策扫不到 ⇒ 报告」改回硬拒 | *** **必须有一条「仓库里有 `archive/` 时 `orca metrics` 仍能出报告」的判据变红** *** |
| **9** | 把扫不到的 correction 塞进一个默认 kind 桶 | 桶计数变 ⇒ 红 |

- [ ] **Step 7: 还原 ＋ 提交**

```bash
git add src/metrics/collect.ts tests/metrics/archiveLookup.test.ts
git commit -m "feat(metrics): look up an archived fix run by its one derived name, so archiving cannot revive closed work"
```

---

## Task 6: `compute.ts` —— 口径的唯一持有者，零 fs／零时钟／零 git

**Files:**
- Create: `src/metrics/compute.ts`
- Modify: `src/metrics/types.ts`（输出类型）
- Test: `tests/metrics/compute.test.ts`、`tests/metrics/computePurity.test.ts`

**Interfaces:**
- Consumes: Task 4／5 的 `Observations`、Task 1 的 `KIND_TIER` / `KIND_ORDER` / `isHighTier`
- Produces: `export function computeMetrics(obs: Observations): MetricsReport`

- [ ] **Step 1: 把输出类型写进 `src/metrics/types.ts`**

```typescript
/**
 * spec §6: this is the interface E3 and E4 take away, so it cannot be empty
 * and it cannot depend on anyone's readdir order.
 *
 * 🔴 The names are load-bearing (§6 item 4). Two denominators live in this
 * object and they are DIFFERENT SETS: the correction rate excludes `stale`
 * from its numerator (a stale correction is the world changing, not the agent
 * being wrong — A' §4.2 as corrected by A' ERRATUM 3), while the repair rate
 * keeps `stale` in its denominator (an unrepaired stale IS the backlog). Every
 * field below carries the qualifier in its own name so that no reader can
 * subtract one from the other and believe the result.
 */
export interface CorrectionRateBucket {
  bucket: string;                        // "YYYY-MM", cohort by decision.at
  numerator_corrections_excluding_stale: number;
  denominator_decisions: number;
  rate_excluding_stale: number | null;   // null when the denominator is 0
  /**
   * 🔴 spec §3.3 requires an explicit per-bucket statement that a cohort
   * bucket is still filling in. A boolean would have to be a constant `true`
   * — a cohort bucket never closes, a decision from any month can be
   * corrected tomorrow — and a constant field is one no mutation can turn
   * red. This carries the as-of instead: the number is what was observable
   * through this instant, and re-running with a later --as-of can only raise
   * it. It also gives the "read the wall clock instead of as-of" mutation a
   * place to land in the golden diff.
   */
  counted_through: string;
}
```

（`RepairRateBucket`、`Backlog`、`MetricsReport` 同形，执行者按 Step 3 的实现补齐；**每个数值字段名都要带限定词**。）

顶层字段序常量：

```typescript
/**
 * Serialization order comes from here, not from the object's own key order —
 * the same lever as CORRECTION_FIELDS in corrections/fields.ts, whose comment
 * says the `satisfies` constraint "buys a compile error" for a typo'd name.
 * Without a written-down order there is no byte-exact golden to diff against
 * (spec §6 item 1, review finding C2).
 */
export const METRICS_FIELDS = [
  "as_of",
  "as_of_mode",
  "repos",
  "correction_rate",
  "repair_rate",
  "backlog",
  "breakdown_by_correction_kind_including_stale",
  "review_coverage",
  "excluded_as_future",
  "unresolved_decisions",
  "unkeyable_repos",
  "malformed_lines",
] as const satisfies readonly (keyof MetricsReport)[];
```

- [ ] **Step 2: 写会失败的判据**（`tests/metrics/compute.test.ts`）

判据用**手搓的 `Observations` 字面量**，不碰 fs —— 这本身就是「compute 是纯的」的一半证明。
**每条都钉字面数字，不钉 `compute.ts` 里的常量**（spec §8 第 1 条点名的加固形状）：

```typescript
const OBS: Observations = {
  asOf: "2026-09-09T00:00:00.000Z", asOfMode: "explicit",
  decisions: [
    d("orca-dev-1/1", "2026-01-05T00:00:00.000Z", "interface", "repo", "ok"),
    d("orca-dev-1/2", "2026-01-06T00:00:00.000Z", "reconcile", "repo", "downgraded"),
    d("orca-dev-1/3", "2026-02-01T00:00:00.000Z", "dependency", "file", "ok"),
  ],
  corrections: [
    c("c_a", "orca-dev-1/1", "wrong",  "2026-03-01T00:00:00.000Z"),
    c("c_b", "orca-dev-1/2", "stale",  "2026-03-02T00:00:00.000Z"),
    c("c_c", "orca-dev-1/3", "not_my_taste", "2026-04-01T00:00:00.000Z"),
  ],
  overturned: [{ correctionId: "c_a", at: "2026-05-01T00:00:00.000Z" }],
  excludedAsFuture: 0, unresolvedDecisions: [], unkeyableRepos: [], malformed: [], lastLineLooksTorn: false,
};

// 变异 1:删掉排除条件 ⇒ 分子从 2 变 3 ⇒ 红。
it("keeps stale OUT of the correction rate's numerator", () => {
  const r = computeMetrics(OBS);
  expect(r.correction_rate.numerator_corrections_excluding_stale).toBe(2);
  expect(r.correction_rate.corrections_total_including_stale).toBe(3);
});

// 变异 2:也把 stale 排除 ⇒ 分母从 3 变 2 ⇒ 红。
it("keeps stale IN the repair rate's denominator — an unrepaired stale is the backlog", () => {
  const r = computeMetrics(OBS);
  expect(r.repair_rate.denominator_corrections_including_stale).toBe(3);
  expect(r.repair_rate.numerator_overturned).toBe(1);
});

// 变异 4 的【正向观测】——「downgraded 进分母」是「什么都不做」,删不掉。
it("counts a downgraded decision in the denominator and a rejected one out of it", () => {
  const r = computeMetrics(OBS);
  expect(r.correction_rate.denominator_decisions).toBe(3);   // 三条全进,含那条 downgraded
});

// 变异 19 的加固形状:钉【年龄的字面值】,不只钉「跑出来了」。
it("ages the backlog against as_of, in literal milliseconds", () => {
  const r = computeMetrics(OBS);
  expect(r.backlog.open_corrections).toBe(2);                 // c_b 与 c_c
  expect(r.backlog.oldest_correction_id).toBe("c_b");
  expect(r.backlog.oldest_age_ms).toBe(
    Date.parse("2026-09-09T00:00:00.000Z") - Date.parse("2026-03-02T00:00:00.000Z"),
  );
});

// 变异 16:换成按事件时间分桶 ⇒ 桶归属变。
it("buckets the correction rate by decision.at, not by correction.at", () => {
  const r = computeMetrics(OBS);
  expect(r.correction_rate.buckets.map((b) => b.bucket)).toEqual(["2026-01", "2026-02"]);
  expect(r.correction_rate.buckets[0].denominator_decisions).toBe(2);
  expect(r.correction_rate.buckets[0].counted_through).toBe("2026-09-09T00:00:00.000Z");
});

it("the rate may exceed 1 and says so rather than clamping", () => { /* --again 的形状 */ });

it("reports review coverage as unavailable, and taints both rates with the caveat", () => {
  const r = computeMetrics(OBS);
  expect(r.review_coverage.available).toBe(false);
  expect(r.correction_rate.caveats.join(" ")).toContain("review coverage");
});

it("splits stale's repair rate out and names the known bias", () => {
  const r = computeMetrics(OBS);
  expect(r.repair_rate.stale_only.known_bias).toContain("chose_instead");
});
```

- [ ] **Step 3: 实现 `computeMetrics`**

**硬约束（执行者必须逐条守）：**
- 文件**顶部不许有任何 `node:` import**，不许 `new Date()`／`Date.now()`／`performance.now()`；
  只允许 `Date.parse` 做纯字符串→数字换算。
- 所有集合出口前排序：桶按 `bucket` 字典序；kind 桶按 `KIND_ORDER` / `CORRECTION_KINDS` 声明顺序；
  `unresolved_decisions` 按 `correctionId`；`unkeyable_repos` 按 `path`；`malformed_lines` 按 `(file, line)`。
- 分母为 0 ⇒ 率是 `null`，**不是 0**（`0/0` 和「一条都没被纠正」不是同一件事）。
- `caveats` 在 `review_coverage.available === false` 时**必须**含一句点名 review coverage 的话（A′ §4.4）；
  `unresolved_decisions` 非空时**必须**再加一句（spec §3.4.1 末行）。

- [ ] **Step 4: 写纯度判据**（`tests/metrics/computePurity.test.ts`）

```typescript
// 这条是机械可判的,且它守的门有人走:任何人往 compute.ts 里加一行 readFile 都会红。
it("compute.ts imports nothing from node: and reads no clock", async () => {
  const src = await readFile(new URL("../../src/metrics/compute.ts", import.meta.url), "utf8");
  expect(src).not.toMatch(/from\s+"node:/);
  expect(src).not.toMatch(/\bnew Date\s*\(/);
  expect(src).not.toMatch(/\bDate\.now\s*\(/);
  expect(src).not.toMatch(/\bperformance\.now\s*\(/);
});

// 正向观测:同样的输入两次,逐字节相同的输出。
it("is deterministic: the same observations twice give byte-identical JSON", () => {
  expect(JSON.stringify(computeMetrics(OBS))).toBe(JSON.stringify(computeMetrics(OBS)));
});
```

- [ ] **Step 5: 跑判据，确认全绿**

- [ ] **Step 6: 🔴 跑变异 1／2／3／4／16／19，每条各自看到红**

| 变异 | 改什么 | 期望红在 |
|---|---|---|
| 1 | 删掉 `kind !== "stale"` 过滤 | `keeps stale OUT …`（分子 2→3） |
| 2 | 修复率分母也排除 stale | `keeps stale IN …`（分母 3→2） |
| 3 | 让 `rejected` 也进分母 | Task 4 那条 verdict 判据 ＋ 本任务分母 |
| 4 | ⚠️ 删不掉 ⇒ **靠正向观测**：夹具那条 downgraded 若被排除，分母 3→2 | `counts a downgraded decision …` |
| 16 | 按 `correction.at` 分桶 | `buckets the correction rate by decision.at …` |
| 19 | `now` 改成直接 `new Date()` | `ages the backlog against as_of …` **与** 纯度判据 |

- [ ] **Step 7: 还原 ＋ 提交**

```bash
git add src/metrics/compute.ts src/metrics/types.ts tests/metrics/compute.test.ts tests/metrics/computePurity.test.ts
git commit -m "feat(metrics): compute both rates in one pure place, with the asymmetry written into the field names"
```

---

## Task 7: 输出形状与渲染 —— 让 golden 写得出来

**Files:**
- Create: `src/metrics/report.ts`
- Test: `tests/metrics/report.test.ts`

**Interfaces:**
- Produces:
  - `export function renderJson(report: MetricsReport): string`（按 `METRICS_FIELDS` 排序，末尾一个 `\n`）
  - `export function renderTable(report: MetricsReport): string`
  - `export function renderTiming(ms: number): string`（**调用方写 stderr**）

- [ ] **Step 1: 写会失败的判据**

```typescript
// 🔴 变异 17 的加固形状(spec §8 第 17 条):在一台机器上「照绿」是这条判据的默认坏法。
// ⇒ 判据自己打乱输入顺序再跑两次,断言两次输出【逐字节相同】。
it("is order-independent: shuffling every input collection changes no byte of the JSON", () => {
  const a = renderJson(computeMetrics(OBS));
  const shuffled: Observations = {
    ...OBS,
    decisions: [...OBS.decisions].reverse(),
    corrections: [...OBS.corrections].reverse(),
    unkeyableRepos: [...OBS.unkeyableRepos].reverse(),
    malformed: [...OBS.malformed].reverse(),
  };
  expect(renderJson(computeMetrics(shuffled))).toBe(a);
});

it("serializes top-level keys in METRICS_FIELDS order, not the object's own", () => {
  const parsed = Object.keys(JSON.parse(renderJson(computeMetrics(OBS))));
  expect(parsed).toEqual([...METRICS_FIELDS]);
});

// 变异 18 的落点:把耗时放进 --json ⇒ golden diff 红。
it("puts no per-run-varying quantity in the JSON — scan duration is not a field", () => {
  const json = renderJson(computeMetrics(OBS));
  expect(json).not.toContain("duration");
  expect(json).not.toContain("elapsed");
  expect(json).not.toContain("_ms\":");   // oldest_age_ms 例外,见下一条
});

it("keeps oldest_age_ms — it varies with as_of, not with the run", () => {
  expect(JSON.parse(renderJson(computeMetrics(OBS))).backlog).toHaveProperty("oldest_age_ms");
});

it("the human table names the review-coverage caveat where a person will read it", () => {
  expect(renderTable(computeMetrics(OBS))).toContain("review coverage");
});
```

⚠️ 第三条与第四条互相约束：**执行者要把 `_ms\":` 那条断言改成精确的两条**（禁 `scan_ms`／`duration_ms`，
留 `oldest_age_ms`），**不要为了让判据绿而把 `oldest_age_ms` 改名**。

- [ ] **Step 2–4:** 跑红 → 实现 → 跑绿（同前）

- [ ] **Step 5: 🔴 变异 17／18**

| 变异 | 改什么 | 期望 |
|---|---|---|
| 17 | 去掉 `METRICS_FIELDS` 排序，直接 `JSON.stringify(report)` | `serializes top-level keys …` 红；**并确认打乱那条也红** |
| 18 | 把 `scan_ms` 放进 JSON | `puts no per-run-varying quantity …` 红 |

- [ ] **Step 6: 提交**

```bash
git add src/metrics/report.ts tests/metrics/report.test.ts
git commit -m "feat(metrics): pin the output's field order and every collection's total order, so a golden can exist"
```

---

## Task 8: `orca metrics` 子命令 ＋ spec §7 那条端到端成功判据

**Files:**
- Modify: `src/cli.ts`
- Create: `tests/metrics/cli.test.ts`、`tests/fixtures/metrics/golden.json`
- Test: `tests/metrics/cli.test.ts`

**Interfaces:**
- Consumes: 前七个任务的全部
- Produces: `orca metrics [--root <dir>] [--repo <key>=<path>]… [--as-of <ISO>] [--json]`

- [ ] **Step 1: 写会失败的判据 —— spec §7 逐字落地**

```typescript
describe("orca metrics (E2 spec §7)", () => {
  // ⚠️ 每个仓库必须【显式加】URL 形状的 remote:
  //    git init 无 remote ⇒ TARGET_HAS_NO_REMOTE;git clone --local 是路径式 ⇒ NOT_KEYABLE。
  it("matches the golden byte for byte", async () => {
    const { root, store } = await buildFixture();   // 见 Step 2
    const out = captureStdout(() => main([
      "metrics", "--root", root, "--as-of", "2026-09-09T00:00:00.000Z", "--json",
    ]));
    expect(await out.code).toBe(0);
    expect(out.text).toBe(await readFile(GOLDEN, "utf8"));
  });

  it("① the integrity gate: a store key neither mechanism resolves ⇒ non-zero", async () => { … expect(code).toBe(1); });
  it("② one projectKey on two paths ⇒ non-zero", async () => { … expect(code).toBe(1); });
  it("③ no --as-of and a row dated 2099 ⇒ non-zero", async () => { … expect(code).toBe(1); });

  // 🔴 spec §7 ④ 与 §8 第 6 条都点名了这条的加固形状。
  it("④ a corrupt MIDDLE line ⇒ exit 6, AND the report still prints in full", async () => {
    const { root, store } = await buildFixture({ corruptMiddleLine: true });
    const out = captureStdout(() => main(["metrics", "--root", root, "--as-of", "…", "--json"]));
    expect(await out.code).toBe(6);
    // ⚠️ 只断言退出码的话,把 §5.2 改回硬拒【也会绿】。必须断言 stdout 非空。
    expect(out.text.length).toBeGreaterThan(0);
    expect(JSON.parse(out.text).malformed_lines).toHaveLength(1);
  });

  it("a torn LAST line is exit 0, and says a write may be in flight", async () => { … expect(code).toBe(0); });
});
```

- [ ] **Step 2: 建夹具 —— 逐条照 spec §7**

```
两个一次性 git 仓库,各 `git remote add origin https://…`(显式,理由见判据注释)
各有【已知条数】的 decision,含一条 rejected、一条 downgraded
其中一条被一条真的 overturned 推翻,且那条 overturned 所在的 fix run 文件被 `git mv` 进 archive/(钉 §3.4.2)
ORCA_CORRECTIONS_DIR 指向一次性 corrections 目录,已知条数的 correction,含一条 stale
```

⚠️ *** **夹具目录一律建在 `mkdtemp` 下，绝不建在本仓库树内，也绝不让任何 `--root` 覆盖到本仓库或它的 clone 副本。** ***

- [ ] **Step 3: 生成 golden 并**人眼读一遍**再写死**

```bash
rtk proxy npx tsx src/cli.ts metrics --root <夹具> --as-of 2026-09-09T00:00:00.000Z --json > tests/fixtures/metrics/golden.json 2>/tmp/stderr.txt
cat tests/fixtures/metrics/golden.json      # ⚠️ 整份读一遍,别让一个错的数字被固化成 golden
cat /tmp/stderr.txt                          # 耗时应当【只】出现在这里
```

⚠️ *** **golden 是判据的一半，写死一个错数字等于把 bug 变成规范。** *** 逐个数对着夹具的已知条数核一遍。

- [ ] **Step 4: 改 `src/cli.ts`**

- USAGE 加第六行（照既有格式）
- `main` 加 `if (command === "metrics") return runMetrics(rest);`
- `runMetrics` 接住 `MetricsRejection` → 打 `rejected: <code>: <message>`、返回 `err.exitCode`
- 有 `malformed_lines` 且 `lastLineLooksTorn` 为假 ⇒ **先整份打印报告，再** 返回 6
- 耗时：`performance.now()` 前后差，`process.stderr.write` —— **永不进 stdout**

- [ ] **Step 5: 跑判据 ＋ 全量 verify**

```bash
rtk proxy npx vitest run tests/metrics/ > /tmp/t8.txt 2>&1; echo RC=$?; cat /tmp/t8.txt
rtk proxy npm run verify > /tmp/v8.txt 2>&1; echo "VERIFY_RC=$?" >> /tmp/v8.txt; cat /tmp/v8.txt
```

Expected: `VERIFY_RC=0`；全仓判据数应为 **398 ＋ 本计划新增的条数**（**现测，别抄这句**）。

- [ ] **Step 6: 🔴 变异 6 —— §5.2 改回硬拒**

把「打印报告再返回 6」改成「直接返回 1，不打印」：
Expected: *** **红在 `stdout.length > 0` 那条断言上** *** —— 若只断言退出码，这条变异**照绿**。

- [ ] **Step 7: 🔴 收尾三件**

```bash
ls ~/.orca 2>&1 || echo "ORCA_STILL_ABSENT"          # Rule 17,spec §7 末行明写要测
rtk proxy git status --porcelain > /tmp/p.txt 2>&1; cat /tmp/p.txt
git ls-remote origin refs/heads/main                  # ⚠️ 收尾必核:它同时是「本轮有没有改过已发布文本」的唯一检测手段
git add src/cli.ts tests/metrics/cli.test.ts tests/fixtures/metrics/golden.json
git commit -m "feat(cli): add orca metrics, the sixth subcommand, reading everything and writing nothing"
```

---

## 已知边界与登记项（**执行完照抄进收尾文档，不掩饰**）

1. **cohort 桶固定按月**（本计划裁二），无 `--bucket` 开关。可逆。
2. **`--root` 之外、且没被 `--repo` 指出的仓库仍会被漏掉**（spec §10 第 2 项）——
   完整性闸门只发现「有纠正但找不到」，*** **发现不了「有决策、零纠正、且两条机制都没覆盖」的乖仓库** ***。
3. **`stale` 的修复率系统性偏低**（spec §3.2.1／A′ ERRATUM 3）——本刀只拆开输出并标注，**不改 E1 的生产代码**。
4. **审阅覆盖率无数据**，两个率都必须带显式标注输出（spec §3.5）。**E3 落地前这个窗口一直开着。**
5. **归档定点查只覆盖 `overturned`**（spec §10 第 6 项）。
6. **`compute.ts` 的纯度靠一条【读源码文本】的判据守**，不是靠类型系统。它守得住 `node:` import 与三种时钟，**守不住经参数传进来的副作用函数**。登记，不假装更强。

---

## Self-Review

**1. Spec coverage** —— 逐节对照，无缺口：

| spec 节 | 落在哪 |
|---|---|
| §2.1 仓库发现 ／ §2.1.1 四种坏情况 | Task 3 |
| §3.1 两个 kind 切法 ／ §3.2 stale 不对称 ／ §3.2.1 已知偏差 | Task 6 |
| §3.3 cohort ＋ 单报积压 | Task 6（裁二、裁三） |
| §3.4 边界情形 ／ §3.4.1 扫不到 ／ §3.4.2 归档定点查 | Task 4（§3.4）＋ Task 5（§3.4.1／§3.4.2，裁一） |
| §3.5 不算覆盖率 ＋ 显式标注 | Task 6 |
| §3.6 高位穷尽分类 | Task 1 |
| §4.1 时钟分工 ／ §4.2 `--as-of` ／ §4.3 `now` 注入 | Task 4（§4.2）＋ Task 6（§4.3）＋ Task 8（§4.1 耗时走 stderr） |
| §5 模块边界 ／ §5.1 不取锁 ／ §5.2 坏行 ／ §5.3 宽容读取器只给读侧 | File Structure ＋ Task 4（§5.1 正向对照）＋ Task 2（§5.2／§5.3） |
| §6 输出形状四条 | Task 6（字段常量）＋ Task 7（排序、耗时不进 JSON、命名） |
| §7 成功判据（golden ＋ 四条 fail-loud ＋ `ls ~/.orca`） | Task 8 |
| §8 二十一条变异 | 1,2,3,4,16,19→T6；5,20→T4；6→T8；7,21→T2；8,9,10→T5；11,12,13→T3；14,15→T1；17,18→T7 —— **21 条全部有落点** |
| §10 登记项 | 本计划「已知边界」节 |

**2. Placeholder scan** —— 扫到并修掉两处：
- Task 2 Step 3 的 `"__skip__"` 是**故意留下的错误示范**，已在正文点名要求改成三态 `ParseOutcome<T>`，并由 Step 4 的判据钉住。**保留，因为它是陷阱说明而不是占位符。**
- Task 5／6／7 的判据用了 `…` 省略夹具搭建。⚠️ **这是真占位** —— 执行者必须照 Task 3／4 的 `repoWithRemote`／`decision` 工厂**照抄一份到该文件**（不跨文件 import 夹具，因为任务可能乱序执行）。**已在 Task 4 Step 2 写明这条纪律。**

**3. Type consistency** —— 逐个核过：
`Observations` 的字段名（`asOf`／`asOfMode`／`decisions`／`corrections`／`overturned`／`excludedAsFuture`／`unresolvedDecisions`／`unkeyableRepos`／`malformed`／`lastLineLooksTorn`）在 Task 4 定义、Task 5／6／7 使用，**拼写一致**；
输出侧字段（`numerator_corrections_excluding_stale`／`denominator_corrections_including_stale`／`corrections_total_including_stale`／`oldest_age_ms`／`counted_through`）**蛇形命名，与内部驼峰刻意不同** —— 内部是 TS，输出是 E3／E4 的接口。
⚠️ **`MetricsReport` 与 `METRICS_FIELDS` 的 `satisfies` 互相约束** ⇒ 字段名打错会编译不过，这是这一处一致性的机械保障。
